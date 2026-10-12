/**
 * A whole show or playlist asked for from this device: every member the server lists becomes
 * wanted here, however many there are. Members past the first page are read a bounded batch at a
 * time, each batch carrying on where the last one stopped, so a very large request is neither cut
 * short nor read from the start again each time its counts change.
 *
 * Drives the real `OfflineDownloads` against the native stub and a paging server.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import {device, NativeModules} from './react-native-stub.mjs';
import type {DownloadsService} from '../../../packages/client-core/src/index';
import type * as OfflineModule from '../src/bridge/offline-downloads.ts';

const VIEWER = {authority: 'local', accountId: 'account-a', profileId: 'profile-a', serverId: 'server-1'};
const OWNER = JSON.stringify([VIEWER.authority, VIEWER.accountId, VIEWER.profileId, VIEWER.serverId]);
const REQUEST = 'request-1';
const member = (n: number) => `item-${n}`;
const ARTIFACT = {fileName: 'f.mp4', bytes: 10, sha256: 'a'.repeat(64), contentType: 'video/mp4'};

/** The server's view of one container request: `total` members in order, read 100 at a time
 * after a member id, as `GET /v1/downloads/requests/{id}?limit&cursor` answers. */
function containerServer(initialTotal: number) {
  const state = {total: initialTotal, ready: 0, fail: undefined as ((cursor: string) => boolean) | undefined, stuck: false};
  const cursors: string[] = [];
  const page = (after: number) => {
    const items = Array.from({length: Math.min(100, Math.max(0, state.total - after))}, (_, i) => ({itemId: member(after + i)}));
    const last = after + items.length;
    return {requestId: REQUEST, total: state.total, totalKnown: true, state: 'preparing', ready: state.ready, preparing: 0, queued: state.total - state.ready, failed: 0, paused: 0, items,
      ...(last < state.total ? {nextCursor: member(last - 1)} : {})};
  };
  const api = {
    baseUrl: 'http://server.test',
    mediaUrl: (p: string) => 'http://server.test' + p,
    async request<T>(path: string): Promise<T> {
      if (path === '/v1/downloads/receipt-keys') return {keys: []} as T;
      const url = new URL('http://server.test' + path);
      if (url.pathname !== '/v1/downloads/requests/' + REQUEST) throw new Error('no route: ' + path);
      const cursor = url.searchParams.get('cursor') ?? '';
      cursors.push(cursor);
      if (state.fail?.(cursor)) throw new Error('network unavailable');
      const answer = page(cursor ? Number(cursor.slice('item-'.length)) + 1 : 0);
      return (state.stuck && answer.nextCursor ? {...answer, nextCursor: cursor} : answer) as T;
    },
  };
  const listeners = new Set<() => void>();
  let prepared: unknown[] = [];
  const service = {
    getSnapshot: () => ({items: prepared, requests: [{request: page(0)}], busy: [] as string[], error: undefined}),
    subscribe: (fn: () => void) => { listeners.add(fn); return () => listeners.delete(fn); },
    async grant(preparation: {id: string; itemId: string}) {
      return {preparationId: preparation.id, itemId: preparation.itemId, url: '/grant/' + preparation.id, token: 't', issuedAt: '', expiresAt: '', replayWindowSeconds: 60, artifact: ARTIFACT};
    },
    publish() { for (const fn of listeners) fn(); },
    dispose() {},
  };
  /** The server finishes preparing the first `count` members. */
  const ready = (count: number) => {
    state.ready = count;
    prepared = Array.from({length: count}, (_, i) => ({id: 'prep-' + i, itemId: member(i), libraryId: 'lib', quality: 'original', state: 'ready', reason: '', createdAt: '', updatedAt: '', expiresAt: '', bytesDone: 10, artifact: ARTIFACT}));
    service.publish();
  };
  return {api, service, state, cursors, ready};
}

let previous: typeof OfflineModule | undefined;
async function bridge(): Promise<typeof OfflineModule> {
  previous?.offlineDownloads.disconnect();
  previous?.offlineDownloads.dispose();
  device.reset();
  previous = (await import('../src/bridge/offline-downloads.ts?v=' + Math.random())) as typeof OfflineModule;
  return previous;
}
const wanted = (): string[] => Object.keys((JSON.parse(device.state || '{}').wanted ?? {})[OWNER] ?? {});
/** Waits until no page has been asked for and nothing has been saved for a few turns. */
async function quiet(cursors: string[]) {
  for (let calm = 0, seen = -1, saved = ''; calm < 5;) {
    await new Promise(done => setTimeout(done, 5));
    if (cursors.length === seen && device.state === saved) calm++; else { calm = 0; seen = cursors.length; saved = device.state; }
  }
}

test('every member of a very large request is enrolled, a bounded batch and a bounded list at a time', async () => {
  const {offlineDownloads} = await bridge();
  const s = containerServer(5_443);
  let saves = 0, largest = 0;
  const firstSaveAfter: number[] = [];
  const write = NativeModules.PorticoDownloads.writeState;
  NativeModules.PorticoDownloads.writeState = async (json: string) => {
    saves++; firstSaveAfter.push(s.cursors.length);
    largest = Math.max(largest, Object.keys(JSON.parse(json).wanted?.[OWNER] ?? {}).length);
    return write(json);
  };
  try {
    offlineDownloads.connect(s.api as any, s.service as unknown as DownloadsService, VIEWER);
    await quiet(s.cursors);
    // The list of members waiting to be collected fills, and the reading waits there.
    assert.equal(wanted().length, 5_000);
    assert.equal(s.cursors.length, 49);
    assert.equal(offlineDownloads.getSnapshot().error, undefined);
    // The first six hundred are prepared and come to the device: the reading goes on to the end.
    s.ready(600);
    await quiet(s.cursors);
    assert.equal(device.started.length, 600);
    const waiting = wanted();
    assert.equal(waiting.length, 4_843);
    assert.ok(waiting.includes(member(5_442)) && waiting.includes(member(5_200)), 'members past the first fifty pages are wanted');
    assert.ok(!waiting.includes(member(0)) && waiting.includes(member(600)));
    // Every member was either collected or is waiting: none was skipped.
    assert.equal(new Set([...device.started.map((d: {itemId: string}) => d.itemId), ...waiting]).size, 5_443);
    // 54 continuation pages after the first hundred, none asked for twice.
    assert.equal(s.cursors.length, 54);
    assert.equal(new Set(s.cursors).size, 54);
    // Bounded: a batch is saved before the next reads on, and the waiting list stays within its
    // limit (a page may carry it at most one page past).
    assert.ok(saves >= 2 && firstSaveAfter[0]! <= 50, `first save after ${firstSaveAfter[0]} pages`);
    assert.ok(largest < 5_100, `the list reached ${largest}`);
    assert.equal(offlineDownloads.getSnapshot().error, undefined);
  } finally { NativeModules.PorticoDownloads.writeState = write; }
});

test('a change in the request\'s counts reads on from where the reading stopped, not from the start', async () => {
  const {offlineDownloads} = await bridge();
  const s = containerServer(1_250);
  offlineDownloads.connect(s.api as any, s.service as unknown as DownloadsService, VIEWER);
  await quiet(s.cursors);
  assert.equal(wanted().length, 1_250);
  const before = s.cursors.length;
  // An unchanged request asks for nothing more.
  s.service.publish();
  await quiet(s.cursors);
  assert.equal(s.cursors.length, before);
  // Members become ready: only the last page is looked at again.
  s.state.ready = 40;
  s.service.publish();
  await quiet(s.cursors);
  assert.deepEqual(s.cursors.slice(before), [member(1_199)]);
  // The server lists more members: they are read from the end of what was read.
  s.state.total = 1_480;
  s.service.publish();
  await quiet(s.cursors);
  assert.equal(wanted().length, 1_480);
  assert.deepEqual(s.cursors.slice(before + 1), [member(1_199), member(1_299), member(1_399)]);
});

test('a page that cannot be read stops the reading until the request changes, then it carries on', async () => {
  const {offlineDownloads} = await bridge();
  const s = containerServer(900);
  s.state.fail = cursor => cursor === member(499);
  offlineDownloads.connect(s.api as any, s.service as unknown as DownloadsService, VIEWER);
  await quiet(s.cursors);
  assert.equal(wanted().length, 500);
  const before = s.cursors.length;
  s.service.publish();
  await quiet(s.cursors);
  assert.equal(s.cursors.length, before, 'no retry while nothing has changed');
  s.state.fail = undefined;
  s.state.ready = 3;
  s.service.publish();
  await quiet(s.cursors);
  assert.equal(wanted().length, 900);
  assert.equal(s.cursors[before], member(499), 'the reading resumes at the page that failed');
});

test('a server whose cursor never advances does not keep the device reading for ever', async () => {
  const {offlineDownloads} = await bridge();
  const s = containerServer(2_000);
  s.state.stuck = true;
  offlineDownloads.connect(s.api as any, s.service as unknown as DownloadsService, VIEWER);
  await quiet(s.cursors);
  assert.ok(s.cursors.length <= 2, `${s.cursors.length} pages read`);
});
