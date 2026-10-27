import test, {after} from 'node:test';
import assert from 'node:assert/strict';
import * as React from 'react';
import {createReadingHost} from '../../../packages/client-core/src';
import {routeBase64} from '../../../packages/client-core/src/route-identity';
import {appleReaderEntry, readerAssetEntry, readerNavigationAllowed, readerDelivery} from '../src-next/screens/read/asset-origin';
import {createReadingSessionOwner} from '../src-next/screens/read/reading-session-owner';
import {act, createHookHost} from './hook-driver';
import {screenModule} from './helpers/screen-harness.mjs';

const previousDev = Object.getOwnPropertyDescriptor(globalThis, '__DEV__');
Object.defineProperty(globalThis, '__DEV__', {configurable: true, value: false});
after(() => {if (previousDev) Object.defineProperty(globalThis, '__DEV__', previousDev); else Reflect.deleteProperty(globalThis, '__DEV__');});

type Node = {type: unknown; props: Record<string, any>};
function find(value: unknown, type: string): Node | undefined {
  if (Array.isArray(value)) {for (const child of value) {const found = find(child, type); if (found) return found;} return;}
  if (!value || typeof value !== 'object' || !('props' in value)) return;
  const node = value as Node; return node.type === type ? node : find(node.props.children, type);
}

/** Exercises the real logical owner, bridge, guest component and WebView
 * element with in-memory session ports. Route projection is tested separately;
 * this is not a device or a signed-publication enrollment test. */
test('twenty original sessions can evict and restore real guest components without reopening', async () => {
  const {ReadingGuestView, createReadingGuestBridge} = await screenModule(new URL('../src-next/screens/read/ReadingGuestView.tsx', import.meta.url), {
    react: {...React, default: React}, 'react-native-webview': {default: 'WebView'},
    '../../../../../packages/client-core/src': {createReadingHost}, '../../../../../packages/client-core/src/route-identity': {routeBase64},
    '../../platform/server-connections': {nativeRouteCrypto: {random: () => new Uint8Array(24).fill(7)}},
    '../../platform/reading-highlights-save': {readingHighlightsSavePort: () => async () => 'cancelled'},
    './asset-origin': {readerNavigationAllowed, readerDelivery}, './startup-diagnostics': {readerStartupDiagnostic: () => undefined, readerStartupProbe: ''},
  });
  const {NativeReadingGuestHost} = await screenModule(new URL('../src-next/screens/read/NativeReadingGuestHost.tsx', import.meta.url), {
    react: {...React, default: React}, 'react-native': {View: 'View', NativeModules: {PorticoReaderAssets: {bundle: async () => ({url: appleReaderEntry})}}, useWindowDimensions: () => ({width: 390, height: 844})},
    'react-native-webview': {default: 'WebView'}, 'react-native-safe-area-context': {useSafeAreaInsets: () => ({top: 47})},
    '../../../../../packages/i18n/src': {defaultI18n: {t: (key: string) => key}},
    '../../kit/states': {LoadingPaint: 'LoadingPaint', StateView: 'StateView', SkeletonBlock: 'SkeletonBlock'}, '../../kit/controls/Button': {Button: 'Button'},
    '../../kit/theme': {useTheme: () => ({colors: {ink: '#000'}})}, '../../platform/platformPosture': {usePlatformPosture: () => ({status: 'unavailable'})},
    './asset-origin': {readerAssetEntry}, './ReadingGuestView': {ReadingGuestView, createReadingGuestBridge},
  });
  let opens = 0, closes = 0; const sessions: any[] = [], progresses: any[] = [], owners: ReturnType<typeof createReadingSessionOwner>[] = [];
  const mounted = new Map<number, {host: ReturnType<typeof createHookHost>; tree: () => unknown; setActive: (value: boolean) => void}>();
  const preferences = {getSnapshot: () => ({} as any), subscribe: () => () => {}};
  const settle = async () => {await act(async () => {await new Promise<void>(resolve => setImmediate(resolve));});};
  const mount = async (index: number, active: boolean) => {
    let tree: unknown, isActive = active; const host = createHookHost(() => {tree = NativeReadingGuestHost({owner: owners[index], active: isActive, preferences, onBack() {}, onSettings() {}});});
    await act(async () => {host.mount(); await new Promise<void>(resolve => setImmediate(resolve));});
    const boundary = find(tree, 'ReadingGuestView'); assert.ok(boundary);
    const webview = ReadingGuestView(boundary!.props); assert.equal(webview.type, 'WebView');
    mounted.set(index, {host, tree: () => tree, setActive: value => {isActive = value; host.rerender();}}); return webview;
  };
  try {
    for (let index = 0; index < 20; index++) {
      const signal = new AbortController(), progress = {progress: {sourceId: `source-${index}`, sourceRevision: 'a'.repeat(64),
        location: {format: 'pdf', pageIndex: index, progression: 0}, revision: 1, observedAt: 1, stale: false}}, session = {manifest: {sessionId: `session-${index}`, itemId: `item-${index}`, sourceId: `source-${index}`, revision: 'a'.repeat(64), format: 'pdf', size: 100, metadata: {title: `Item ${index}`}}, signal: signal.signal,
        progress: async () => progress, close: async () => {closes++;}, headPDF: async () => ({}), readRange: async () => new Uint8Array(),
        readAsset: async () => new Uint8Array(), page: async () => ({}), saveProgress: async () => ({saved: false, progress: null})};
      sessions.push(session); progresses.push(progress);
      const owner = createReadingSessionOwner({current: () => true, subscribe: () => () => {}, acquire: async () => {opens++; return {session: session as any, release() {}};}});
      owners.push(owner); await owner.ensure();
      if (mounted.size === 2) {const oldest = mounted.keys().next().value!; mounted.get(oldest)!.host.unmount(); mounted.delete(oldest);}
      await act(() => {for (const item of mounted.values()) item.setActive(false);});
      await mount(index, true); assert.ok(mounted.size <= 2);
      assert.equal([...mounted.values()].filter(item => (item.tree() as Node).props.pointerEvents === 'auto').length, 1);
      assert.equal(opens, index + 1); assert.equal(closes, 0);
    }
    for (let index = 19; index >= 0; index--) {
      for (const item of mounted.values()) item.host.unmount(); mounted.clear(); await settle();
      await mount(index, true); assert.equal(owners[index]!.snapshot().manifest, sessions[index].manifest);
      assert.equal(owners[index]!.snapshot().manifest?.sourceId, `source-${index}`);
      assert.equal(owners[index]!.snapshot().confirmedProgress, progresses[index]); assert.equal(opens, 20); assert.equal(closes, 0);
    }
  } finally {
    for (const item of mounted.values()) item.host.unmount();
    await Promise.all(owners.map(owner => owner.dispose()));
  }
  assert.equal(closes, 20);
});
