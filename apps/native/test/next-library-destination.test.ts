import test from 'node:test';
import assert from 'node:assert/strict';
import {NativeLibraryDestination, nativeLibraryEntryKey} from '../src-next/screens/library/model.ts';
import type {BrowseCapabilities, BrowseRequestBody} from '../../../packages/client-core/src/browse.ts';
import type {LibraryContentApi} from '../../../packages/client-core/src/library-content.ts';

const scope = {serverId: 'server', viewerId: JSON.stringify(['local', 'account', 'profile'])};
const library = {id: 'actual-movies', name: 'Movies', kind: 'movie'};
const tick = () => new Promise<void>(resolve => setImmediate(resolve));
const pivot = {id: 'movies', labelKey: 'library.tab.movies', entityKinds: ['movie'], defaultSort: [{field: 'title', direction: 'asc'}],
  supportedViews: ['grid'], browsable: true, sorts: ['title'], filters: ['favorite'] } as const;
const capabilities: BrowseCapabilities = {
  library: {...library, defaultView: 'browse', pinned: false}, pivots: [pivot], resolvedPivot: pivot,
  fields: [{id: 'favorite', labelKey: 'filter.favorite', type: 'boolean', operators: ['equals'], controlHint: 'toggle', complexity: 'quick', cost: 'indexed', applicableKinds: ['movie']}],
  sorts: [{id: 'title', labelKey: 'sort.title', directions: ['asc', 'desc'], defaultDirection: 'asc', expensive: false, applicableKinds: ['movie']}],
  quickFilters: [{id: 'favorites', labelKey: 'saved.tab.favorites', query: {field: 'favorite', operator: 'equals', value: true}}],
  surfaces: [{id: 'library', endpoint: '/v1/libraries/{id}/browse', paging: 'keyset', sorts: ['title'], filters: ['favorite']}],
  queryLimits: {maximumDepth: 6, maximumClauses: 50, maximumBytes: 8192, maximumSorts: 1, defaultLimit: 40, maximumLimit: 100, cursorTtlMs: 600000},
};
function page(body: BrowseRequestBody, total = 50000) {
  const start = body.range?.start ?? 0, count = Math.min(body.limit ?? 40, total - start);
  return {pivot: body.pivot, applied: {query: body.query ?? null, sort: body.sort, seek: null},
    entries: Array.from({length: count}, (_, offset) => ({id: `actual-${start + offset}`, libraryId: library.id, kind: 'movie', title: `Title ${start + offset}`})),
    pageInfo: {start, total, revision: 'catalogue-1', totalIsLowerBound: false, hasMore: start + count < total, nextCursor: ''}, positionIndex: [{key: 'M', index: 48000}]};
}

test('Library reads the actual ID and vocabulary, with bounded sparse pages even after a far jump', async () => {
  const calls: {path: string; body?: BrowseRequestBody}[] = [];
  const api: LibraryContentApi = {request: async <T>(path: string, _method?: string, body?: unknown) => {
    calls.push({path, body: body as BrowseRequestBody});
    return (path.includes('capabilities') ? capabilities : page(body as BrowseRequestBody)) as T;
  }};
  const destination = new NativeLibraryDestination({api, scope, library, current: () => true});
  try {
    const loading = destination.load(); assert.equal(destination.load(), loading, 'focus and OK share the same pending producer read'); await loading; await tick();
    const state = destination.getSnapshot(), collection = state.collection!;
    assert.equal(state.phase, 'ready'); assert.equal(calls[0].path, '/v1/libraries/actual-movies/browse-capabilities?pivot=movies');
    assert.equal(collection.itemAt(0)?.id, 'actual-0'); assert.equal(collection.getSnapshot().total, 50000);
    collection.ensureRange(48000, 48006); await tick(); await tick();
    assert.ok(collection.itemAt(48000)); assert.ok(collection.resident().items <= 240);
    assert.ok(calls.length <= 7, 'a far jump never walks intervening catalogue pages');
    assert.ok(calls.filter(call => call.body).every(call => call.body!.limit === 60));
    assert.ok(calls.slice(2).filter(call => call.body).every(call => call.body!.range?.revision === 'catalogue-1'));
    destination.remember(48000, 32000);
    assert.equal(destination.getMemory().firstVisibleId, nativeLibraryEntryKey(collection.itemAt(48000)!));
    assert.equal(destination.getMemory().offset, 32000);
    let changes = 0; const unsubscribe = destination.subscribe(() => {changes++;});
    destination.remember(48000, 32007.75);
    assert.equal(destination.getMemory().offset, 32007.75); assert.equal(changes, 0, 'measured movement within the same visible row does not rerender the page per pixel');
    unsubscribe();
  } finally {destination.dispose();}
});

test('Library sends the published quick filter and sort to the server without local result filtering', async () => {
  const bodies: BrowseRequestBody[] = [];
  const api: LibraryContentApi = {request: async <T>(path: string, _method?: string, raw?: unknown) => {
    if (path.includes('capabilities')) return capabilities as T;
    const body = raw as BrowseRequestBody; bodies.push(body); return page(body, 3) as T;
  }};
  const destination = new NativeLibraryDestination({api, scope, library, current: () => true});
  try {
    await destination.load(); await tick(); destination.setQuick('favorites', true); await tick();
    assert.deepEqual(bodies.at(-1)?.query, capabilities.quickFilters[0].query);
    assert.equal(destination.getSnapshot().collection?.itemAt(0)?.id, 'actual-0', 'the server page remains authoritative');
    assert.throws(() => destination.setQuery([], {field: 'invented-sort', direction: 'asc'}));
    assert.throws(() => destination.setQuick('invented-preset', true));
  } finally {destination.dispose();}
});

test('Library refuses another library vocabulary and never falls back by name or list index', async () => {
  let requests = 0;
  const api: LibraryContentApi = {request: async <T>() => {requests++; return {...capabilities, library: {...capabilities.library, id: 'other-library'}} as T;}};
  const destination = new NativeLibraryDestination({api, scope, library, current: () => true});
  try {await destination.load(); assert.equal(destination.getSnapshot().phase, 'error'); assert.equal(destination.getSnapshot().collection, undefined); assert.equal(requests, 1);}
  finally {destination.dispose();}
});

test('removing the actual library or retiring the viewer aborts its pages and clears private content', async () => {
  let current = true, release!: (value: unknown) => void, signal: AbortSignal | undefined;
  const api: LibraryContentApi = {request: async <T>(path: string, _method?: string, _body?: unknown, nextSignal?: AbortSignal) => {
    if (path.includes('capabilities')) return capabilities as T;
    signal = nextSignal; return await new Promise<T>(resolve => {release = value => resolve(value as T);});
  }};
  const destination = new NativeLibraryDestination({api, scope, library, current: () => current});
  await destination.load(); const collection = destination.getSnapshot().collection!;
  current = false; const closed = destination.getSnapshot();
  assert.equal(closed.collection, undefined); assert.ok(signal?.aborted);
  release(page({pivot: 'movies', sort: [{field: 'title', direction: 'asc'}], range: {start: 0}, limit: 60})); await tick();
  assert.equal(collection.itemAt(0), undefined); assert.equal(destination.getSnapshot(), closed);
});
