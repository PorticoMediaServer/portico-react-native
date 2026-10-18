/** APL-HOME-03 / TV-PLAYER-03: progress broadcasts, and focus going back when the player closes. */
import test from 'node:test';
import assert from 'node:assert/strict';
import {createHookHost, act} from './hook-driver.ts';
import {Platform, pressRemote} from './react-native-stub.mjs';
import {emitPlaybackChange, focusReturn, usePlayerFocusReturn, useRefreshOnPlayback} from '../src/app/playback-events.ts';

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

test('focus goes back once the player stops covering the screens, for the viewer it was captured for', () => {
  focusReturn.setOwner('');
  let covering = false;
  let viewer = 'server\naccount\nprofile-a';
  let asked = 0;
  const unregister = focusReturn.register('home', 'action:play', {focus: () => { asked++; focusReturn.focused('home', 'action:play'); }});
  const host = createHookHost(() => usePlayerFocusReturn(covering, viewer, true));
  host.mount();
  focusReturn.focused('home', 'action:play');
  assert.ok(focusReturn.capture(), 'captured as playback starts');
  covering = true;
  host.rerender();
  assert.equal(focusReturn.state().returning, undefined, 'nothing returns while the player covers the screens');
  covering = false;
  host.rerender();
  assert.ok(focusReturn.state().returning, 'the player closed: the return is under way');
  focusReturn.cancel();
  // A new viewer forgets the origin before the player closes.
  focusReturn.focused('home', 'action:play');
  focusReturn.capture();
  covering = true;
  host.rerender();
  viewer = 'server\naccount\nprofile-b';
  host.rerender();
  covering = false;
  host.rerender();
  assert.equal(focusReturn.state().returning, undefined);
  assert.equal(asked, 0);
  host.unmount();
  unregister();
  focusReturn.setOwner('');
});

test('off television the player never moves focus', () => {
  focusReturn.setOwner('viewer');
  let covering = true;
  const host = createHookHost(() => usePlayerFocusReturn(covering, 'viewer', false));
  host.mount();
  focusReturn.focused('shell', 'action:now-playing');
  focusReturn.capture();
  covering = false;
  host.rerender();
  assert.equal(focusReturn.state().returning, undefined);
  host.unmount();
  focusReturn.setOwner('');
});

test('broadcasts never throw, even with no subscribers', () => {
  assert.doesNotThrow(() => emitPlaybackChange({positionSeconds: 0, completed: false, reason: 'closed'}));
});

test('TV: a key pressed on the remote while focus is on its way back ends the return; a release does not', () => {
  focusReturn.setOwner('');
  let covering = true;
  let asked = 0;
  const unregister = focusReturn.register('home', 'action:play', {focus: () => { asked++; }});
  const host = createHookHost(() => usePlayerFocusReturn(covering, 'viewer', true));
  host.mount();
  covering = false;
  host.rerender();
  focusReturn.focused('home', 'action:play');
  focusReturn.capture();
  covering = true;
  host.rerender();
  covering = false;
  host.rerender();
  assert.ok(focusReturn.state().returning, 'under way');
  // The Back that closed the player is released after the return began: not the person moving on.
  pressRemote({eventType: 'menu', eventKeyAction: 1});
  assert.ok(focusReturn.state().returning);
  pressRemote({eventType: 'down', eventKeyAction: 0});
  assert.equal(focusReturn.state().returning, undefined, 'Down ended it');
  assert.equal(asked, 0);
  host.unmount();
  unregister();
});

test('TV on Android: a key pressed while focus is on its way back ends the return, though Android reports it only by its release', () => {
  focusReturn.setOwner('');
  const before = Platform.OS;
  Platform.OS = 'android';
  try {
    let covering = true;
    let asked = 0;
    const unregister = focusReturn.register('home', 'action:play', {focus: () => { asked++; }});
    const host = createHookHost(() => usePlayerFocusReturn(covering, 'viewer', true));
    host.mount();
    covering = false;
    host.rerender();
    focusReturn.focused('home', 'action:play');
    focusReturn.capture();
    covering = true;
    host.rerender();
    covering = false;
    host.rerender();
    assert.ok(focusReturn.state().returning, 'under way');
    pressRemote({eventType: 'down', eventKeyAction: 1});
    assert.equal(focusReturn.state().returning, undefined, 'Down ended it (its release is the only report)');
    assert.equal(asked, 0);
    host.unmount();
    unregister();
  } finally { Platform.OS = before; }
});

test('TV: the player host going away forgets the origin and the return it started; a new host starts afresh', () => {
  focusReturn.setOwner('');
  let covering = false;
  const unregister = focusReturn.register('home', 'action:play', {focus: () => {}});
  const host = createHookHost(() => usePlayerFocusReturn(covering, 'viewer', true));
  host.mount();
  focusReturn.focused('home', 'action:play');
  assert.ok(focusReturn.capture());
  covering = true;
  host.rerender();
  host.unmount();
  assert.equal(focusReturn.state().origin, undefined, 'forgotten with its host');
  assert.equal(focusReturn.state().owner, '');
  // The same viewer, a new host: it owns the screens again, and nothing old comes back.
  covering = false;
  const again = createHookHost(() => usePlayerFocusReturn(covering, 'viewer', true));
  again.mount();
  assert.equal(focusReturn.state().owner, 'viewer');
  covering = true;
  again.rerender();
  covering = false;
  again.rerender();
  assert.equal(focusReturn.state().returning, undefined);
  again.unmount();
  unregister();
});
