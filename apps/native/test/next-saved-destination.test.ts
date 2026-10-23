import test from 'node:test';
import assert from 'node:assert/strict';
import {NativeSavedDestination, savedDirectoryCount, savedProjectionCount} from '../src-next/screens/saved/model.ts';
import type {SavedApi} from '../../../packages/client-core/src/saved.ts';

const scope = {serverId: 'server-a', viewerId: 'local/account-a/profile-a'};
function response(path: string) {
  const url = new URL(path, 'https://test.invalid');
  if (url.pathname.includes('saved-pins')) return {serverId: scope.serverId, viewerFence: 'pins-fence', revision: 1,
    order: [{kind: 'collection', id: 'second-by-name', name: 'Zebra', pinRevision: 1}, {kind: 'playlist', id: 'first-by-name', name: 'Alpha', pinRevision: 2}]};
  if (url.pathname.includes('saved-resources')) return {serverId: scope.serverId, viewerFence: 'resources-fence', revision: 1,
    resources: [], nextCursor: url.searchParams.get('kind') === 'collection' ? 'next-resource-page' : ''};
  const view = url.searchParams.get('view')!;
  return {
    scope: {serverId: scope.serverId, libraryId: '', libraryKind: 'mixed', view, entityId: '', viewerFence: 'saved-fence'},
    revision: {catalog: 1, viewer: 1}, heading: {key: 'saved.title', fallback: ''},
    navigation: [{id: view, labelKey: 'saved.title', view}],
    query: {sort: 'title', direction: 'asc', category: view === 'playlists' ? '' : 'all', q: '', limit: 40, searchMode: 'none'},
    sorts: [], filters: [], ...(view === 'playlists' ? {actions: []} : {}), sections: [{id: 'items', type: 'grid', heading: {key: 'saved.title', fallback: ''}, entries: [], totalCount: 12, nextCursor: ''}],
  };
}

test('the Saved hub reads six bounded canonical projections and keeps real pin order', async () => {
  const calls: string[] = [];
  const api: SavedApi = {request: async <T>(path: string) => {calls.push(path); return response(path) as T;}};
  const hub = new NativeSavedDestination({api, scope, requestId: async () => 'operation-id', current: () => true});
  try {
    const loading = hub.load(); assert.equal(hub.load(), loading, 'a concurrent mount shares the same bounded read');
    await loading;
    const snapshot = hub.getSnapshot();
    assert.equal(snapshot.phase, 'ready'); assert.equal(calls.length, 6);
    assert.ok(calls.every(path => !path.includes('cursor=')), 'the hub does not scan directories or whole libraries');
    assert.deepEqual(snapshot.pins.map(pin => pin.id), ['second-by-name', 'first-by-name']);
    assert.equal(savedProjectionCount(snapshot.myList), 12);
    assert.equal(savedDirectoryCount(snapshot.collections), undefined, 'one partial resource page is not the total');
    assert.equal(savedDirectoryCount(snapshot.views), 0, 'an exhausted empty directory has a known count');
  } finally {hub.dispose();}
});

test('retiring the actual viewer aborts pending reads and clears all private hub snapshots', async () => {
  const pending: {path: string; resolve: (value: unknown) => void; signal?: AbortSignal}[] = [];
  let current = true;
  const api: SavedApi = {request: <T>(path: string, _method?: string, _body?: unknown, signal?: AbortSignal) => new Promise<T>(resolve => {pending.push({path, signal, resolve: value => resolve(value as T)});})};
  const hub = new NativeSavedDestination({api, scope, requestId: async () => 'operation-id', current: () => current});
  const loading = hub.load();
  current = false;
  const closed = hub.getSnapshot();
  assert.equal(closed.phase, 'idle'); assert.deepEqual(closed.pins, []);
  assert.equal(closed.myList.projection, null); assert.deepEqual(closed.collections.resources, []);
  assert.ok(pending.every(read => read.signal?.aborted));
  for (const read of pending) read.resolve(response(read.path));
  await loading;
  assert.equal(hub.getSnapshot(), closed, 'late reads cannot recreate the retired profile view');
});

test('an authenticated producer failure is retained as an error, not an empty Saved success', async () => {
  const api: SavedApi = {request: async <T>(path: string) => {
    if (path.includes('view=favorites')) throw Object.assign(new Error('private diagnostic'), {status: 403, code: 'forbidden'});
    return response(path) as T;
  }};
  const hub = new NativeSavedDestination({api, scope, requestId: async () => 'operation-id', current: () => true});
  try {await hub.load(); assert.equal(hub.getSnapshot().phase, 'error'); assert.ok(hub.getSnapshot().error);}
  finally {hub.dispose();}
});
