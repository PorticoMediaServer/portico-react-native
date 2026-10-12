/**
 * Next and Previous in the player (the transport, the mini bar, the system's media commands):
 * the native listening owner moves its own queue; every other playback, video included, moves
 * through the device queue.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import {stepQueue} from '../src/player/queue-step.ts';

type Call = readonly [string, ...unknown[]];

function harness(o: {nativeOwner?: boolean; queue?: boolean; nextAvailable?: boolean} = {}) {
  const calls: Call[] = [];
  const view = {queue: {id: 'q1', revision: '7'}, next: {available: o.nextAvailable ?? true}};
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

test('Next does nothing when the queue has nothing playable next, or there is no queue', async () => {
  const end = harness({nextAvailable: false});
  await stepQueue(end.service, 'next');
  assert.deepEqual(end.calls, []);
  const none = harness({queue: false});
  await stepQueue(none.service, 'next');
  await stepQueue(none.service, 'previous');
  assert.deepEqual(none.calls, []);
});
