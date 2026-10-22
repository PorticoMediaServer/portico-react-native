import test from 'node:test';
import assert from 'node:assert/strict';
import {createHookHost} from './hook-driver.ts';
import {useFocusedMenu} from '../src-next/kit/controls/useFocusedMenu.ts';
import {dispatchMenuKey} from '../src-next/platform/menu-key.ts';

const menu = {eventType: 'menu', eventKeyAction: 1};
const dispatch = () => dispatchMenuKey(menu, 'android', true);

test('only the real focused enabled TV control owns Menu-up; Select and Menu-down stay native', () => {
  let focused = false, disabled = false, isTV = true;
  let count = 0;
  const action = () => {count++;};
  const host = createHookHost(() => useFocusedMenu(isTV, focused, disabled, action));
  host.mount();
  assert.equal(dispatch(), false);
  focused = true; host.rerender();
  assert.equal(dispatchMenuKey({eventType: 'select', eventKeyAction: 1}, 'android', true), false);
  assert.equal(dispatchMenuKey({eventType: 'menu', eventKeyAction: 0}, 'android', true), false);
  assert.equal(dispatchMenuKey(menu, 'ios', true), false);
  assert.equal(dispatch(), true); assert.equal(count, 1);
  disabled = true; host.rerender();
  assert.equal(dispatch(), false);
  disabled = false; focused = false; host.rerender();
  assert.equal(dispatch(), false);
  focused = true; isTV = false; host.rerender();
  assert.equal(dispatch(), false);
  host.unmount();
});

test('replacement actions, blur, and unmount cannot leave a stale context action', () => {
  const calls: string[] = [];
  let action: (() => void) | undefined = () => calls.push('old');
  let focused = true;
  const host = createHookHost(() => useFocusedMenu(true, focused, false, action));
  host.mount(); dispatch();
  action = () => calls.push('new'); host.rerender(); dispatch();
  assert.deepEqual(calls, ['old', 'new']);
  action = undefined; host.rerender(); assert.equal(dispatch(), false);
  action = () => calls.push('restored'); host.rerender();
  focused = false; host.rerender(); assert.equal(dispatch(), false);
  focused = true; host.rerender();
  host.unmount(); assert.equal(dispatch(), false);
});

test('a late blur cleanup cannot unregister the next focused control', () => {
  const calls: string[] = [];
  let firstFocused = true;
  const firstAction = () => calls.push('first');
  const secondAction = () => calls.push('second');
  const first = createHookHost(() => useFocusedMenu(true, firstFocused, false, firstAction));
  const second = createHookHost(() => useFocusedMenu(true, true, false, secondAction));
  first.mount(); second.mount();
  firstFocused = false; first.rerender();
  assert.equal(dispatch(), true); assert.deepEqual(calls, ['second']);
  first.unmount(); second.unmount();
  assert.equal(dispatch(), false);
});
