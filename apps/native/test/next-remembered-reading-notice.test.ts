import test from 'node:test';
import assert from 'node:assert/strict';
import * as React from 'react';
import {act, createHookHost} from './hook-driver.ts';
import {screenModule} from './helpers/screen-harness.mjs';

type Node = {type: unknown; props: Record<string, any>};
function find(value: unknown, type: string): Node | undefined {
  if (Array.isArray(value)) {for (const child of value) {const found = find(child, type); if (found) return found;} return;}
  if (!value || typeof value !== 'object' || !('props' in value)) return;
  const node = value as Node; if (node.type === type) return node;
  return find(node.props.children, type);
}

test('saved-only Settings shows a local notice and closes onto the same original guest', async () => {
  let root = true, ownerCurrent = true, closes = 0; const listeners = new Set<() => void>();
  const snapshot = {phase: 'ready'};
  const owner = {current: () => ownerCurrent, snapshot: () => snapshot, ensure: async () => snapshot,
    subscribe: (listener: () => void) => {listeners.add(listener); return () => {listeners.delete(listener);};},
    dispose: async () => {closes++; ownerCurrent = false;}};
  const reading = {owner, preferences: {getSnapshot: () => ({}), subscribe: () => () => {}}};
  const {RememberedReadingScreen} = await screenModule(new URL('../src-next/screens/downloads/RememberedReadingScreen.tsx', import.meta.url), {
    react: {...React, default: React}, 'react-native': {View: 'View'},
    '../../../../../packages/i18n/src': {defaultI18n: {t: (key: string) => key}},
    '../../kit/overlays/surface': {Dialog: 'Dialog'}, '../../kit/controls': {Button: 'Button'},
    '../../kit/states': {LoadingPaint: 'LoadingPaint', SkeletonBlock: 'SkeletonBlock', StateView: 'StateView'},
    '../read/NativeReadingGuestHost': {NativeReadingGuestHost: 'NativeReadingGuestHost'},
  });
  let tree: unknown; const host = createHookHost(() => {tree = RememberedReadingScreen({reading, noticeCopy: {title: 'Reading settings', body: 'Reading settings aren’t available in this saved-only opening.'}, current: () => root, onBack() {}});});
  await act(() => host.mount());
  const original = find(tree, 'NativeReadingGuestHost')!; const oldSettings = original.props.onSettings;
  await act(() => oldSettings());
  assert.equal(find(tree, 'NativeReadingGuestHost')!.props.owner, owner);
  assert.equal(find(tree, 'NativeReadingGuestHost')!.props.active, false);
  const notice = find(tree, 'Dialog')!; assert.ok(notice);
  const close = notice.props.footer.props.onPress;
  await act(() => close());
  assert.equal(find(tree, 'Dialog'), undefined);
  assert.equal(find(tree, 'NativeReadingGuestHost')!.props.owner, owner);
  assert.equal(find(tree, 'NativeReadingGuestHost')!.props.active, true);
  assert.equal(closes, 0);
  root = false; await act(() => oldSettings()); assert.equal(find(tree, 'Dialog'), undefined);
  await act(() => close()); assert.equal(find(tree, 'Dialog'), undefined);
  host.unmount(); assert.equal(closes, 1);
});
