/**
 * Next and Previous while watching with a group: for the title the group is showing they are
 * the group's. The host's goes out as a group command, anyone else is told only the host can,
 * and neither moves or seeks this device on its own. Outside a matching group the device queue
 * moves as usual. The queue here is the real device queue player.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import {PlaybackService} from '../../../packages/client-core/src/index.ts';
import {queueItemInput} from '../../../packages/client-core/src/queue-controller.ts';
import {FakePlaybackServer, type FakeRequest} from '../../../packages/client-core/src/playback-v1/testing/fake-server.ts';
import {NativePlayback} from '../src/player/native-playback.ts';
import {V1QueuePlayer} from '../../../packages/client-core/src/playback-v1/v1-queue-player.ts';
import {groupStep, stepQueue} from '../src/player/queue-step.ts';

const viewer = {serverId: 'server', authority: 'local' as const, accountId: 'account', profileId: 'profile'};
const settle = async (n = 30) => { for (let i = 0; i < n; i++) await new Promise(r => setImmediate(r)); };

/** A three-title device queue playing its second title, `seconds` in. */
async function playing(seconds: number) {
  const server = new FakePlaybackServer();
  const advances: string[] = [];
  const http = {send: (request: FakeRequest) => {
    if (request.method === 'POST' && request.path.endsWith(':advance')) advances.push(String((request.body as {reason?: unknown}).reason));
    return server.handle(request);
  }};
  let serial = 0;
  const path = new NativePlayback({http, timers: {setTimer: () => 0, clearTimer: () => {}}, key: () => `k${++serial}`});
  const api = path.transport;
  const playback = new PlaybackService(api, () => `r${++serial}`, {queueRequired: true, deferRecovery: true});
  path.bind(playback);
  const player = new V1QueuePlayer({http, api, playback, viewer, key: () => `q${++serial}-key-000000`, pendingPollMs: 10});
  const stop = player.connect();
  const close = () => { stop(); player.dispose(); };
  try {
    await player.playEntries(['movie-1', 'movie-2', 'movie-3'].map(queueItemInput));
    await settle();
    const first = player.getSnapshot().view!;
    await player.next(first.queue.id, first.queue.revision);
    await settle();
    advances.length = 0;
    // The engine's part: ready, the start position reached, then `seconds` of playing.
    const intent = playback.getSnapshot().intentId;
    playback.ready(intent);
    const start = playback.getSnapshot().pendingSeek;
    if (start) playback.seekApplied(intent, start.revision, start.positionSeconds, 'playing');
    playback.fact(intent, seconds, 'playing');
    assert.equal(playback.getSnapshot().positionSeconds, seconds);
    assert.equal(playback.getSnapshot().pendingSeek, undefined);
  } catch (e) { close(); throw e; }
  return {playback, player, advances, close};
}

/** Watch Together's handler for the title on screen, as the app installs it. */
function group(canControl: boolean | null) {
  const sent: string[] = [];
  let refused = 0;
  const control = {step: (action: 'next' | 'previous') => groupStep(canControl === null ? undefined : {permissions: {canControl}}, action, {transport: a => { sent.push(a); }, refuse: () => { refused++; }})};
  return {control, sent, refusals: () => refused};
}

test('the host\'s Previous, well into a title, goes to the group and does not seek this device', async () => {
  const {playback, player, advances, close} = await playing(10);
  try {
    const together = group(true);
    await stepQueue(playback, 'previous', together.control);
    await settle();
    assert.deepEqual(together.sent, ['previous']);
    assert.equal(playback.getSnapshot().pendingSeek, undefined, 'no local seek');
    assert.equal(playback.getSnapshot().positionSeconds, 10);
    assert.deepEqual(advances, [], 'the device queue did not move');
    assert.equal(player.getSnapshot().view?.queue.currentEntryId, player.getSnapshot().view?.queue.entries[1]?.id);
  } finally { close(); }
});

test('the host\'s Next goes to the group and leaves the device queue where it is', async () => {
  const {playback, advances, close} = await playing(10);
  try {
    const together = group(true);
    await stepQueue(playback, 'next', together.control);
    await settle();
    assert.deepEqual(together.sent, ['next']);
    assert.deepEqual(advances, []);
  } finally { close(); }
});

test('a participant\'s Next and Previous are refused: no group command, no local seek, no queue move', async () => {
  const {playback, advances, close} = await playing(10);
  try {
    const together = group(false);
    await stepQueue(playback, 'previous', together.control);
    await stepQueue(playback, 'next', together.control);
    await settle();
    assert.deepEqual(together.sent, []);
    assert.equal(together.refusals(), 2);
    assert.equal(playback.getSnapshot().pendingSeek, undefined, 'no local seek');
    assert.deepEqual(advances, []);
  } finally { close(); }
});

test('outside the group\'s title the device queue moves: Previous restarts after three seconds, Next advances', async () => {
  const {playback, advances, close} = await playing(10);
  try {
    const together = group(null);
    await stepQueue(playback, 'previous', together.control);
    await settle();
    assert.equal(playback.getSnapshot().pendingSeek?.positionSeconds, 0, 'restarts this title');
    assert.deepEqual(advances, []);
    await stepQueue(playback, 'next', together.control);
    await settle();
    assert.deepEqual(advances, ['next']);
    assert.deepEqual(together.sent, []);
    assert.equal(together.refusals(), 0);
  } finally { close(); }
});
