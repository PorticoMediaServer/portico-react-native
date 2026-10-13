import test from 'node:test';
import assert from 'node:assert/strict';
import {replanEngine} from '../src/player/engine-replan.ts';

function make(inPlace: boolean) {
  const state = {intent: 'paused' as 'playing' | 'paused', positionSeconds: 42, queue: ['current', 'next'], sessionId: 's1'};
  const changes: unknown[] = [];
  const playback = {
    changesInPlace: () => inPlace,
    changePlayback: (choices: unknown) => { changes.push(choices); return Promise.resolve(); },
  };
  return {state, changes, playback};
}

test('a changed Player setting re-plans the playing session in place, with one request', async () => {
  const {state, changes, playback} = make(true);
  await replanEngine(playback as never);
  assert.deepEqual(changes, [{replan: true}]);
  // Nothing of the session is touched from here: the same session, queue, position and pause.
  assert.deepEqual(state, {intent: 'paused', positionSeconds: 42, queue: ['current', 'next'], sessionId: 's1'});
});

test('a download or a channel is never re-planned', async () => {
  const {changes, playback} = make(false);
  await replanEngine(playback as never);
  assert.deepEqual(changes, []);
});

test('a refused change is the caller’s to hear of', async () => {
  const playback = {changesInPlace: () => true, changePlayback: () => Promise.reject(new Error('refused'))};
  await assert.rejects(replanEngine(playback as never), /refused/);
});
