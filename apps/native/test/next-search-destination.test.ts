import test from 'node:test';
import assert from 'node:assert/strict';
import {NativeSearchDestination, nativeSearchEntryKey} from '../src-next/screens/search/model.ts';
import type {LibraryContentApi} from '../../../packages/client-core/src/library-content.ts';
import type {SearchEntry, SearchGroup} from '../../../packages/client-core/src/search.ts';

const scope = {serverId: 'server-a', viewerId: 'local/account-a/profile-a'};
const history = {serverId: scope.serverId, viewerFence: 'search-history-fence', maxEntries: 8,
  entries: [{q: 'severance', updatedAt: '2026-10-23T00:00:00Z', uses: 1}]};
const tick = () => new Promise<void>(resolve => setImmediate(resolve));
const deferred = <T>() => {let resolve!: (value: T) => void; const promise = new Promise<T>(done => {resolve = done;}); return {promise, resolve};};
function result(path: string, ids: string[], nextCursor = '') {
  const query = new URL(path, 'https://test.invalid').searchParams;
  const group = (query.get('group') || 'movies') as SearchGroup;
  return {
    scope: {serverId: scope.serverId, libraryId: '', libraryKind: 'mixed', view: 'search', entityId: '', viewerFence: 'search-fence'},
    revision: {catalog: 1, viewer: 1},
    query: {q: query.get('q'), group: query.get('group') || '', groups: [group], limit: 40,
      sort: 'relevance', direction: 'desc', libraryIds: [], recorded: query.get('record') === '1'},
    capabilities: {groups: [{id: group, title: '', available: true, reason: '', sorts: ['relevance']}],
      sorts: ['relevance'], directions: ['desc'], maxLimit: 40, groupBudgetMs: 1000},
    groups: [{id: group, entityKind: 'movie', title: '', status: 'success', errorCode: '', totalCount: 3,
      totalCountExact: true, nextCursor, items: ids.map(id => ({id, kind: 'movie', title: id, libraryId: 'movies', navigation: {view: 'item', entityId: id}}))}],
  };
}
function setup(request: LibraryContentApi['request']) {
  let current = true, remember = true;
  const errors: unknown[] = [];
  const destination = new NativeSearchDestination({api: {request}, scope, current: () => current,
    rememberHistory: () => remember, reportError: error => errors.push(error)});
  return {destination, errors, retire: () => {current = false; destination.dispose();}, historyOff: () => {remember = false;}};
}

test('the actual search service appends cursor pages and keeps real result identities', async () => {
  const calls: string[] = [];
  const {destination} = setup(async <T>(path: string) => {
    calls.push(path);
    if (path.includes('/history')) return history as T;
    return result(path, path.includes('cursor=') ? ['movie-b', 'movie-c'] : ['movie-a', 'movie-b'], path.includes('cursor=') ? '' : 'next-page') as T;
  });
  try {
    destination.setText('matrix'); destination.selectGroup('movies');
    await tick(); await destination.next('movies');
    assert.equal(destination.getSnapshot().search.phase, 'ready');
    assert.deepEqual(destination.getSnapshot().groups[0]?.items.map(entry => entry.id), ['movie-a', 'movie-b', 'movie-c']);
    assert.equal(calls.length, 2);
    assert.equal(new URL(calls[1], 'https://test.invalid').searchParams.get('cursor'), 'next-page');
    const entry = destination.getSnapshot().groups[0].items[0];
    assert.equal(nativeSearchEntryKey('movies', entry), JSON.stringify(['movies', 'movie', 'movie-a']));
  } finally {destination.dispose();}
});

test('a newly typed query cancels and cannot publish an older response', async () => {
  const slow = deferred<unknown>(), signals: AbortSignal[] = [];
  const {destination} = setup(async <T>(path: string, _method?: string, _body?: unknown, signal?: AbortSignal) => {
    if (signal) signals.push(signal);
    if (path.includes('old-query')) return await slow.promise as T;
    return path.includes('/history') ? history as T : result(path, ['new-result']) as T;
  });
  try {
    destination.setText('old-query'); const pending = destination.commit();
    destination.setText('new-query'); await destination.commit();
    slow.resolve(result('/v1/search?q=old-query&record=1', ['old-result'])); await pending;
    assert.equal(signals[0].aborted, true);
    assert.equal(destination.getSnapshot().text, 'new-query');
    assert.deepEqual(destination.getSnapshot().groups[0]?.items.map(entry => entry.id), ['new-result']);
  } finally {destination.dispose();}
});

test('history reads cannot restore erased history after Clear', async () => {
  const oldRead = deferred<unknown>(); let read = 0;
  const {destination} = setup(async <T>(_path: string, method?: string) => {
    if (method === 'DELETE') return undefined as T;
    return (++read === 1 ? history : await oldRead.promise) as T;
  });
  try {
    await destination.refreshHistory();
    assert.equal(destination.getSnapshot().recent.length, 1);
    const pending = destination.refreshHistory();
    await destination.clearHistory();
    oldRead.resolve(history); await pending;
    assert.deepEqual(destination.getSnapshot().recent, []);
    assert.equal(destination.getSnapshot().clearing, false);
  } finally {destination.dispose();}
});

test('disabled search history is never requested or recorded', async () => {
  const calls: string[] = [];
  const controls = setup(async <T>(path: string) => {calls.push(path); return result(path, []) as T;});
  try {
    controls.historyOff(); await controls.destination.refreshHistory();
    controls.destination.setText('no-history'); await controls.destination.commit();
    assert.equal(calls.length, 1);
    assert.equal(new URL(calls[0], 'https://test.invalid').searchParams.has('record'), false);
    assert.deepEqual(controls.destination.getSnapshot().recent, []);
  } finally {controls.destination.dispose();}
});

test('retiring a viewer clears retained content, aborts history and stops the debounce', async () => {
  const late = deferred<unknown>(); let signal: AbortSignal | undefined, calls = 0;
  const controls = setup(async <T>(_path: string, _method?: string, _body?: unknown, value?: AbortSignal) => {
    calls++; signal = value; return await late.promise as T;
  });
  const pending = controls.destination.refreshHistory();
  controls.destination.setText('waiting'); controls.retire();
  late.resolve(history); await pending;
  await new Promise(resolve => setTimeout(resolve, 280));
  assert.equal(signal?.aborted, true);
  assert.equal(calls, 1);
  assert.equal(controls.destination.getSnapshot().text, '');
  assert.deepEqual(controls.destination.getSnapshot().recent, []);
  assert.equal(controls.destination.getSnapshot().search.data, null);
});

test('group and media kind are part of a mixed selection key', () => {
  const movie = {id: 'shared-id', kind: 'movie'} as SearchEntry;
  const song = {id: 'shared-id', kind: 'song'} as SearchEntry;
  assert.notEqual(nativeSearchEntryKey('movies', movie), nativeSearchEntryKey('songs', song));
});
