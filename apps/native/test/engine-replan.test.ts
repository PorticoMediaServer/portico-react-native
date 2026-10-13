import test from 'node:test';
import assert from 'node:assert/strict';
import {replanEngine} from '../src/player/engine-replan.ts';

function make(intent: 'playing' | 'paused') {
  const state = {intent, phase: 'ready', positionSeconds: 42, queue: ['current', 'next']};
  let finish!: () => void;
  const calls: boolean[] = [];
  const playback = {
    getSnapshot: () => state,
    pause: () => { state.intent = 'paused'; },
  };
  const queue = {
    check: (retry?: boolean) => {
      calls.push(retry === true);
      state.phase = 'starting';
      state.intent = 'playing';
      return new Promise<void>(resolve => { finish = () => { state.phase = 'ready'; resolve(); }; });
    },
  };
  return {state, calls, playback, queue, finish: () => finish()};
}

test('replanning uses the current-entry operation and preserves position and Up Next', async () => {
  const {state, calls, playback, queue, finish} = make('playing');
  const pending = replanEngine(playback as never, queue);
  assert.deepEqual(calls, [true]);
  assert.equal(state.positionSeconds, 42);
  assert.deepEqual(state.queue, ['current', 'next']);
  finish();
  await pending;
  assert.equal(state.intent, 'playing');
});

test('a paused title is paused before the new session can be adopted', async () => {
  const {state, playback, queue, finish} = make('paused');
  const pending = replanEngine(playback as never, queue);
  assert.equal(state.phase, 'starting');
  assert.equal(state.intent, 'paused');
  finish();
  await pending;
  assert.equal(state.intent, 'paused');
});

test('a viewer resume during replanning is preserved when the request finishes', async () => {
  const {state, playback, queue, finish} = make('paused');
  const pending = replanEngine(playback as never, queue);
  state.intent = 'playing';
  finish();
  await pending;
  assert.equal(state.intent, 'playing');
});
