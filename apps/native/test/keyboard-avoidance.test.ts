import test from 'node:test';
import assert from 'node:assert/strict';
import * as React from 'react';
import {createHookHost, act} from './hook-driver.ts';
import {screenModule} from './helpers/screen-harness.mjs';

type Event = 'keyboardDidShow' | 'keyboardDidHide';

async function fixture({os = 'android', visible = false, isTV = false, showWhileSubscribing = false} = {}) {
  const listeners = new Map<Event, Set<() => void>>();
  const visibility = {value: visible};
  let changedWhileSubscribing = false;
  const keyboard = {
    isVisible: () => visibility.value,
    addListener(event: Event, listener: () => void) {
      const set = listeners.get(event) ?? new Set<() => void>();
      set.add(listener);
      listeners.set(event, set);
      if (showWhileSubscribing && !changedWhileSubscribing) {
        visibility.value = true;
        changedWhileSubscribing = true;
      }
      return {remove: () => set.delete(listener)};
    },
  };
  const module = await screenModule(new URL('../src/ui/keyboard-avoidance.ts', import.meta.url), {
    react: React,
    'react-native': {Keyboard: keyboard, Platform: {OS: os, isTV}},
  });
  let enabled: boolean | undefined;
  const host = createHookHost(() => { enabled = module.useKeyboardAvoidanceEnabled(); });
  host.mount();
  return {
    host,
    enabled: () => enabled,
    subscriptions: () => [...listeners.values()].reduce((total, set) => total + set.size, 0),
    // KeyboardImpl updates its visibility before delivering component listeners.
    emit(event: Event, _metrics = {screenY: 0, height: 0}) {
      visibility.value = event === 'keyboardDidShow';
      for (const listener of listeners.get(event) ?? []) listener();
    },
  };
}

test('Android only applies keyboard avoidance while its keyboard is visible', async () => {
  const f = await fixture();
  try {
    assert.equal(f.enabled(), false);
    assert.equal(f.subscriptions(), 2);
    for (let cycle = 0; cycle < 3; cycle++) {
      await act(() => f.emit('keyboardDidShow', {screenY: 480, height: 320}));
      assert.equal(f.enabled(), true, 'typing keeps edge-to-edge keyboard avoidance');
      await act(() => f.emit('keyboardDidHide', {screenY: 0, height: 0}));
      assert.equal(f.enabled(), false, 'Fabric hide coordinates cannot pad away the form');
    }
  } finally { f.host.unmount(); }
  assert.equal(f.subscriptions(), 0);
});

test('the guard is enabled immediately when mounted with an open Android keyboard', async () => {
  const f = await fixture({visible: true});
  try {
    assert.equal(f.enabled(), true);
    await act(() => f.emit('keyboardDidHide'));
    assert.equal(f.enabled(), false);
  } finally { f.host.unmount(); }
});

test('visibility changed while subscribing is read from the current keyboard snapshot', async () => {
  const f = await fixture({showWhileSubscribing: true});
  try {
    assert.equal(f.enabled(), true);
    await act(() => f.emit('keyboardDidHide'));
    assert.equal(f.enabled(), false);
  } finally { f.host.unmount(); }
});

test('Android TV keeps avoidance while editing and removes it when the remote hides the keyboard', async () => {
  const f = await fixture({isTV: true});
  try {
    await act(() => f.emit('keyboardDidShow'));
    assert.equal(f.enabled(), true);
    await act(() => f.emit('keyboardDidHide'));
    assert.equal(f.enabled(), false);
  } finally { f.host.unmount(); }
});

test('iPhone and Apple TV retain native keyboard avoidance behavior without Android listeners', async () => {
  for (const isTV of [false, true]) {
    const f = await fixture({os: 'ios', isTV});
    try {
      assert.equal(f.enabled(), true);
      assert.equal(f.subscriptions(), 0);
      await act(() => f.emit('keyboardDidHide'));
      assert.equal(f.enabled(), true);
    } finally { f.host.unmount(); }
  }
});
