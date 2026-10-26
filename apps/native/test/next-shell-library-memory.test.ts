import test from 'node:test';
import assert from 'node:assert/strict';
import * as React from 'react';
import {act, createHookHost} from './hook-driver';
import {surfacePaintFixture, screenModule} from './helpers/screen-harness.mjs';
import {createFocusRegistry} from '../src-next/kit/focus/registry';
import {createTheme} from '../src-next/kit/theme';
import * as shellModel from '../src-next/shell/model';
import * as focusModel from '../src-next/shell/tv-focus';

const nodes = (node: any): any[] => Array.isArray(node) ? node.flatMap(nodes) : node?.props ? [node, ...nodes(node.props.children)] : [];
test('a real screen-owned Library destination is remembered and a late initial read cannot restore its old ID', async () => {
  const authority = {serverId: 'server', accountId: 'account', profileId: 'profile', epoch: 'epoch', viewerFence: 'actual'};
  const theme = createTheme({width: 390, isTV: false}), registry = createFocusRegistry(), writes: string[] = [], navigations: any[] = [];
  let finish!: (id: string) => void, snapshot: any = {authority, destination: {kind: 'home'}, contentVisible: true, libraries: [
    {id: 'new', name: 'Actual new', kind: 'movie'}, {id: 'old', name: 'Actual old', kind: 'movie'},
  ], account: {actions: []}, profile: {}, hasLiveTV: false, homeVisible: true, selectionActive: false};
  const runtime = {getSnapshot: () => snapshot, subscribe: () => () => {}, reportError(error: unknown) {throw error;},
    memory: {read: () => new Promise<string>(resolve => {finish = resolve;}), remember: async (_scope: unknown, id: string) => {writes.push(id);}},
    onDestination: (destination: unknown) => {navigations.push(destination); snapshot = {...snapshot, destination};},
    renderRoutes() {}, renderSelection() {}, renderDestination() {}, scrollToTop() {}};
  const {NativeShell} = await screenModule(new URL('../src-next/shell/NativeShell.tsx', import.meta.url), {
    '../kit/overlays/SurfacePaintHost': surfacePaintFixture,
    '../kit/dock/DockClearance': {DockClearanceProvider: 'DockClearanceProvider'},
    '../kit/dock/PlayerMorphBridge': {PlayerMorphProvider: 'PlayerMorphProvider', usePlayerMorphPublication() {}},
    '../platform/tv-menu': {useTVMenuCapture: () => {}},
    react: {...React, default: React}, 'react-native': {View: 'View', useWindowDimensions: () => ({width: 390, height: 844})},
    'react-native-reanimated': {default: {View: 'AnimatedView'}, useAnimatedStyle: (fn: () => unknown) => fn(), useSharedValue: (value: number) => React.useRef({value}).current, withTiming: (value: unknown) => value},
    'react-native-safe-area-context': {useSafeAreaInsets: () => ({top: 44, bottom: 34})}, '../kit/overlays': {OverlaysProvider: 'OverlaysProvider'},
    '../kit/shell': {AccountMenu: 'AccountMenu'}, '../kit/theme': {useTheme: () => theme}, '../kit/useMotion': {useMotion: () => ({transforms: false, timing: () => ({duration: 0})})},
    '../kit/focus': {useFocusRegistry: () => registry}, './tv-focus': focusModel, './model': shellModel, '../screens/home/HomeScreen': {HomeScreen: 'HomeScreen'},
    './PhoneTabBar': {PhoneTabBar: 'PhoneTabBar'}, './MediumRail': {MediumRail: 'MediumRail'}, './chrome': {nativeScreenChromeHidden: () => false, subscribeNativeScreenChrome: () => () => {}}, './PhoneHomeHeader': {PhoneHomeHeader: 'PhoneHomeHeader'}, './TVRail': {}, './TVProfileMenu': {}, './NativePlaybackLayer': {}, './DesktopHeader': {},
  });
  let root: any, tree: any;
  const rootHost = createHookHost(() => {root = NativeShell({runtime});}); rootHost.mount();
  const session = nodes(root).find(node => typeof node.type === 'function');
  const page = createHookHost(() => {tree = session.type({runtime, snapshot});});
  try {
    await act(() => page.mount());
    await act(() => {snapshot = {...snapshot, contentVisible: false}; page.rerender();});
    assert.equal(nodes(tree).some(node => node.type === 'PhoneTabBar'), false, 'a full-screen account route draws no tab bar underneath');
    await act(() => {snapshot = {...snapshot, contentVisible: true, destination: {kind: 'library', libraryId: 'new'}}; page.rerender();});
    assert.deepEqual(writes, ['new']);
    await act(() => {snapshot = {...snapshot, destination: {kind: 'home'}}; page.rerender(); finish('old');});
    await act(() => nodes(tree).find(node => node.type === 'PhoneTabBar').props.onSelect('libraries'));
    assert.deepEqual(navigations.at(-1), {kind: 'library', libraryId: 'new'});
  } finally {await act(() => {page.unmount(); rootHost.unmount();});}
});
