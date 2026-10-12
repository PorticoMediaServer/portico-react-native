/**
 * Next and Previous in the player (the transport, the mini bar, the system's media commands):
 * the native listening owner moves its own queue; every other playback, video included, moves
 * through the device queue.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import {PlaybackService} from '../../../packages/client-core/src/index.ts';
import {queueItemInput} from '../../../packages/client-core/src/queue-controller.ts';
import {FakePlaybackServer, type FakeRequest} from '../../../packages/client-core/src/playback-v1/testing/fake-server.ts';
import {V1PlaybackApi} from '../../../packages/client-core/src/playback-v1/legacy-bridge.ts';
import {V1QueuePlayer} from '../../../packages/client-core/src/playback-v1/v1-queue-player.ts';
import {stepQueue} from '../src/player/queue-step.ts';

type Call = readonly [string, ...unknown[]];

function harness(o: {nativeOwner?: boolean; queue?: boolean; next?: 'ready' | 'end' | 'unavailable'} = {}) {
  const calls: Call[] = [];
  const view = {queue: {id: 'q1', revision: '7'}, next: {reason: o.next ?? 'ready'}};
  const queue = {
    getSnapshot: () => ({view}),
    next: async (queueId: string, revision: string) => { calls.push(['queue.next', queueId, revision]); },
    previous: async () => { calls.push(['queue.previous']); },
  };
  const service = {
    hasNativeOwner: () => !!o.nativeOwner,
    systemListeningAction: async (action: 'next' | 'previous') => { calls.push(['native', action]); },
    getQueueController: () => (o.queue === false ? undefined : queue),
  };
  return {service, calls};
}

test('Next on a video queue advances the device queue at its current revision', async () => {
  const {service, calls} = harness();
  await stepQueue(service, 'next');
  assert.deepEqual(calls, [['queue.next', 'q1', '7']]);
});

test('Previous on a video queue goes back through the device queue', async () => {
  const {service, calls} = harness();
  await stepQueue(service, 'previous');
  assert.deepEqual(calls, [['queue.previous']]);
});

test('the native listening owner still moves its own queue', async () => {
  const {service, calls} = harness({nativeOwner: true});
  await stepQueue(service, 'next');
  await stepQueue(service, 'previous');
  assert.deepEqual(calls, [['native', 'next'], ['native', 'previous']]);
});

test('Next does nothing at the end of the queue, or when there is no queue', async () => {
  const end = harness({next: 'end'});
  await stepQueue(end.service, 'next');
  assert.deepEqual(end.calls, []);
  const none = harness({queue: false});
  await stepQueue(none.service, 'next');
  await stepQueue(none.service, 'previous');
  assert.deepEqual(none.calls, []);
});

// The real device queue: its view calls Next unavailable when the entry right after the current
// one can't be played, while the player still offers Next for the playable title beyond it. The
// server steps past such entries, so the request has to reach it.
test('Next is sent when the entry right after the current one is unavailable but a later one plays', async () => {
  const server = new FakePlaybackServer();
  const advances: string[] = [];
  const withheld = (entries: unknown) => (Array.isArray(entries) ? entries.map(e => (e.itemId === 'movie-2' ? {...e, available: false} : e)) : entries);
  const http = {send: async (request: FakeRequest) => {
    if (request.method === 'POST' && request.path.endsWith(':advance')) advances.push(String((request.body as {reason?: unknown}).reason));
    const response = await server.handle(request);
    const body = response.body as {window?: unknown; items?: unknown} | undefined;
    return body && typeof body === 'object' ? {...response, body: {...body, ...('window' in body ? {window: withheld(body.window)} : {}), ...('items' in body ? {items: withheld(body.items)} : {})}} : response;
  }};
  let serial = 0;
  const api = new V1PlaybackApi(http, {timers: {setTimer: () => 0, clearTimer: () => {}}, key: () => `k${++serial}`});
  const playback = new PlaybackService(api, () => `r${++serial}`, {queueRequired: true, deferRecovery: true});
  const player = new V1QueuePlayer({http, api, playback, viewer: {serverId: 'server', authority: 'local', accountId: 'account', profileId: 'profile'}, key: () => `q${++serial}-key-000000`, pendingPollMs: 10});
  const stop = player.connect();
  try {
    await player.playEntries(['movie-1', 'movie-2', 'movie-3'].map(queueItemInput));
    for (let i = 0; i < 30; i++) await new Promise(r => setImmediate(r));
    const view = player.getSnapshot().view!;
    const at = view.queue.entries.findIndex(e => e.id === view.queue.currentEntryId);
    assert.equal(at, 0);
    assert.deepEqual(view.next, {entryId: view.queue.entries[1]!.id, available: false, reason: 'unavailable'});
    assert.ok(view.queue.entries.slice(at + 1).some(e => !e.hidden && !e.removed), 'the player offers Next');
    await stepQueue(playback, 'next');
    assert.deepEqual(advances, ['next']);
  } finally { stop(); player.dispose(); }
});
