import test from 'node:test';
import assert from 'node:assert/strict';
import {NativeLibraryDestination, nativeLibraryEntryKey} from '../src-next/screens/library/model.ts';
import type {BrowseCapabilities, BrowseNode, BrowseRequestBody} from '../../../packages/client-core/src/browse.ts';
import type {LibraryContentApi} from '../../../packages/client-core/src/library-content.ts';
import {NativeLibraryFilterDraft} from '../src-next/screens/library/filters.ts';
import {libraryFilterChange, libraryFilterField} from '../src-next/screens/library/filter-controls.ts';

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

const filterCapabilities: BrowseCapabilities = {...capabilities,
  pivots: [{...pivot, filters: ['favorite', 'genre', 'year', 'decade']}], resolvedPivot: {...pivot, filters: ['favorite', 'genre', 'year', 'decade']},
  fields: [...capabilities.fields,
    {id: 'genre', labelKey: 'filter.field.genre', type: 'identity-set', operators: ['contains-any', 'contains-all'], controlHint: 'facet-multi-select', complexity: 'quick', cost: 'indexed', applicableKinds: ['movie'], facetSource: {field: 'genre', endpoint: '/v1/libraries/actual-movies/facets'}},
    {id: 'year', labelKey: 'filter.field.year', type: 'number', operators: ['in'], controlHint: 'number-range', complexity: 'quick', cost: 'indexed', applicableKinds: ['movie']},
    {id: 'decade', labelKey: 'filter.field.year', type: 'number', operators: ['in'], controlHint: 'facet-multi-select', complexity: 'quick', cost: 'indexed', applicableKinds: ['movie']}],
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

test('Library filter draft stages edits, reads exact counts and sends the full contextual query for bounded facets', async () => {
  const calls: {path: string; body?: any}[] = [], applied: unknown[] = [];
  const initial: BrowseNode = {field: 'favorite', operator: 'equals', value: true};
  const api: LibraryContentApi = {request: async <T>(path: string, _method?: string, body?: unknown) => {
    calls.push({path, body});
    return (path.includes('/counts') ? {counts: [{id: 'draft', total: 10, totalIsLowerBound: false, revision: 'revision1'}]}
      : {field: 'genre', total: 2, values: [{value: 'Drama', label: 'Drama', count: 5}, {value: 'Comedy', label: 'Comedy', count: 2}]}) as T;
  }};
  const draft = new NativeLibraryFilterDraft({api, capabilities: filterCapabilities, pivot: 'movies', sort: {field: 'title', direction: 'asc'}, predicates: [initial], fixed: [], current: () => true,
    apply: value => applied.push(value), onDispose() {}});
  try {
    draft.refresh(); draft.setOpenFields(['genre']); await tick();
    assert.equal(draft.getSnapshot().count.value?.total, 10);
    assert.equal(applied.length, 0);
    const firstFacet = new URL(calls.find(value => value.path.includes('facets'))!.path, 'https://example.invalid');
    assert.equal(firstFacet.searchParams.get('limit'), '200');
    assert.deepEqual(JSON.parse(firstFacet.searchParams.get('query')!), initial);
    const genre: BrowseNode = {field: 'genre', operator: 'contains-any', value: ['Drama']};
    draft.setPredicates([initial, genre]);
    assert.equal(draft.apply(), false, 'a stale count does not enable Apply');
    draft.refresh(); await tick();
    const counted = calls.filter(value => value.path.includes('/counts')).at(-1)!;
    assert.deepEqual(counted.body.queries[0].query, {all: [initial, genre]});
    const facet = new URL(calls.filter(value => value.path.includes('facets')).at(-1)!.path, 'https://example.invalid');
    assert.deepEqual(JSON.parse(facet.searchParams.get('query')!), {all: [initial, genre]}, 'the server, not the caller, removes the counted facet condition');
    assert.equal(draft.apply(), true); assert.deepEqual(applied, [[initial, genre]]);
    assert.equal(draft.getSnapshot().open, false);
    assert.equal(calls.some(value => /\/browse$/.test(value.path)), false, 'counts do not load full result pages');
  } finally {draft.dispose();}
});

test('Library filter draft aborts superseded searches and hides late retired viewer data', async () => {
  const pending: {path: string; signal?: AbortSignal; resolve: (value: unknown) => void}[] = [];
  let current = true;
  const api: LibraryContentApi = {request: async <T>(path: string, _method?: string, _body?: unknown, signal?: AbortSignal) =>
    await new Promise<T>(resolve => pending.push({path, signal, resolve: value => resolve(value as T)}))};
  const draft = new NativeLibraryFilterDraft({api, capabilities: filterCapabilities, pivot: 'movies', sort: {field: 'title', direction: 'asc'}, predicates: [], fixed: [], current: () => current,
    apply() {assert.fail('a retired viewer must not apply');}, onDispose() {}});
  draft.refresh(); draft.setOpenFields(['genre']); draft.search('genre', 'Dr');
  assert.equal(pending[1].signal?.aborted, true);
  pending[1].resolve({field: 'genre', total: 1, values: [{value: 'old', label: 'Old', count: 1}]}); await tick();
  assert.equal(draft.getSnapshot().facets.genre?.value, undefined);
  current = false; assert.equal(draft.getSnapshot().open, false); assert.ok(pending.every(value => value.signal?.aborted));
  pending[0].resolve({counts: [{id: 'draft', total: 9, totalIsLowerBound: false, revision: 'old'}]});
  pending[2].resolve({field: 'genre', total: 1, values: [{value: 'private', label: 'Private', count: 1}]}); await tick();
  assert.deepEqual(draft.getSnapshot().facets, {}); assert.equal(draft.apply(), false);
});

test('Library filter controls preserve negative-only values, typed decades, fixed predicates and cross-field alternatives', () => {
  const genre = filterCapabilities.fields.find(field => field.id === 'genre')!, year = filterCapabilities.fields.find(field => field.id === 'year')!;
  const negative: BrowseNode = {not: {field: 'genre', operator: 'contains-any', value: ['Drama']}};
  const state = libraryFilterField(genre, [negative], undefined, new Date('2026-10-23T00:00:00Z'));
  assert.equal(state.kind, 'values'); if (state.kind !== 'values') assert.fail();
  assert.deepEqual(state.excluded, ['Drama']); assert.deepEqual(state.included, []);
  assert.deepEqual(libraryFilterChange(filterCapabilities, genre, [negative], state, [], new Date()), [negative]);
  const fixed: BrowseNode = {field: 'favorite', operator: 'equals', value: true};
  const alternative: BrowseNode = {any: [{field: 'genre', operator: 'contains-any', value: ['Comedy']}, fixed]};
  const changed = libraryFilterChange(filterCapabilities, year, [alternative, fixed], {kind: 'values', included: ['1980'], excluded: [], mode: 'any'}, [fixed], new Date());
  assert.deepEqual(changed, [alternative, fixed, {field: 'decade', operator: 'in', value: [1980]}]);
  assert.equal(libraryFilterField(year, changed, undefined, new Date()).summary, '1980s');
});

test('An actual Library query change or destination disposal retires its open filter session', async () => {
  const api: LibraryContentApi = {request: async <T>(path: string, _method?: string, raw?: unknown) =>
    (path.includes('capabilities') ? capabilities : page(raw as BrowseRequestBody, 3)) as T};
  const destination = new NativeLibraryDestination({api, scope, library, current: () => true});
  try {
    await destination.load(); await tick();
    const draft = destination.createFilters(), before = destination.getSnapshot().queryRevision;
    destination.setQuick('favorites', true);
    assert.equal(destination.getSnapshot().queryRevision, before + 1, 'an actual query change requests a native scroll reset without refocusing results');
    assert.equal(draft.getSnapshot().open, false);
    const next = destination.createFilters(); destination.dispose(); assert.equal(next.getSnapshot().open, false);
  } finally {destination.dispose();}
});
