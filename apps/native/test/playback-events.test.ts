/** APL-HOME-03 / TV-PLAYER-03: progress broadcasts and invoker focus return. */
import test from 'node:test';
import assert from 'node:assert/strict';
import {createHookHost, act} from './hook-driver.ts';
import {emitPlaybackChange, rememberInvoker, restoreInvoker, useRefreshOnPlayback} from '../src/app/playback-events.ts';

test('a progress change refreshes every subscriber once, debounced', (t) => {
  t.mock.timers.enable({apis: ['setTimeout'], now: 1_800_000_000_000});
  let a = 0;
  let b = 0;
  const ha = createHookHost(() => {
    useRefreshOnPlayback(() => a++);
  });
  const hb = createHookHost(() => {
    useRefreshOnPlayback(() => b++, change => change.reason === 'ended');
  });
  ha.mount();
  hb.mount();
  emitPlaybackChange({positionSeconds: 1, completed: false, reason: 'progress'});
  emitPlaybackChange({positionSeconds: 2, completed: false, reason: 'progress'});
  t.mock.timers.tick(999);
  assert.equal(a, 0);
  assert.equal(b, 0);
  t.mock.timers.tick(1);
  assert.equal(a, 1, 'neighbouring changes share one refresh');
  assert.equal(b, 0, 'the filter declined progress');
  emitPlaybackChange({itemId: 'm1', positionSeconds: 10, completed: true, reason: 'ended'});
  t.mock.timers.tick(1000);
  assert.equal(a, 2);
  assert.equal(b, 1);
  ha.unmount();
  hb.unmount();
  // After unmount nothing is scheduled or delivered.
  emitPlaybackChange({positionSeconds: 11, completed: true, reason: 'ended'});
  t.mock.timers.tick(5000);
  assert.equal(a, 2);
  assert.equal(b, 1);
  t.mock.timers.reset();
});

test('focus returns to the control that started playback', (t) => {
  t.mock.timers.enable({apis: ['setTimeout'], now: 1_800_000_000_000});
  // No invoker remembered: nothing scheduled, nothing thrown.
  restoreInvoker();
  t.mock.timers.tick(10000);
  let focused = 0;
  const handle = {focus: () => focused++};
  rememberInvoker(handle);
  restoreInvoker();
  assert.equal(focused, 0, 'focus returns after a beat, not synchronously');
  t.mock.timers.tick(250);
  assert.equal(focused, 1);
  rememberInvoker(null);
  restoreInvoker();
  t.mock.timers.tick(10000);
  assert.equal(focused, 1, 'clearing the invoker cancels the return');
  t.mock.timers.reset();
});

test('broadcasts never throw, even with no subscribers', () => {
  assert.doesNotThrow(() => emitPlaybackChange({positionSeconds: 0, completed: false, reason: 'closed'}));
});
