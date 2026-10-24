import assert from 'node:assert/strict';
import test from 'node:test';
import * as React from 'react';
import {act, createHookHost} from './hook-driver';
import {screenModule} from './helpers/screen-harness.mjs';
import {createFocusRegistry} from '../src-next/kit/focus/registry';
import {createTheme} from '../src-next/kit/theme';
import * as shellModel from '../src-next/shell/model';
import * as focusModel from '../src-next/shell/tv-focus';

const nodes = (node: any): any[] => Array.isArray(node) ? node.flatMap(nodes) : node?.props ? [node, ...nodes(node.props.children)] : [];
const authority = {serverId: 's', accountId: 'a', profileId: 'p', epoch: 'e', viewerFence: 'v'};

test('the real TV shell retains its exact page opener through rail, route and player lifetimes and current OK resets Home', async () => {
  const registry = createFocusRegistry(), ids = focusModel.tvFocusIds(authority), requests: string[] = [];
  const row = {regionId: ids.row('continue'), childId: 'actual-card'};
  registry.configure({id: row.regionId, order: [row.childId], entry: row.childId, screenStart: ids.start});
  registry.attach(row, {requestTVFocus() {requests.push('card'); registry.didFocus(row);}});
  registry.configure({id: ids.spotlight, order: ['play'], entry: 'play'});
  registry.attach(ids.start, {requestTVFocus() {requests.push('play'); registry.didFocus(ids.start);}});
  const theme = createTheme({isTV: true, width: 1920}), motion = {transforms: false, timing: () => ({duration: 0})};
  const useShared = (value: number) => React.useRef({value}).current;
  let railBack: (() => boolean) | undefined, tree: any, root: any;
  let snapshot: any = {authority, destination: {kind: 'home'}, libraries: [], hasLiveTV: false, profile: {}, account: {}, selectionActive: false,
    homeVisible: true, homeObscured: false, mediaExpanded: false};
  const navigations: unknown[] = [], tops: unknown[] = [];
  const runtime = {getSnapshot: () => snapshot, subscribe: () => () => {}, reportError(error: unknown) {throw error;},
    onDestination: (destination: unknown) => navigations.push(destination), scrollToTop: (destination: unknown) => tops.push(destination),
    memory: {read: async () => undefined, remember: async () => {}},
    registerTVRailBack: (fn: () => boolean) => {railBack = fn; return () => {railBack = undefined;};},
    renderRoutes() {}, renderSelection() {}, renderDestination() {}};
  const {NativeShell} = await screenModule(new URL('../src-next/shell/NativeShell.tsx', import.meta.url), {
    react: {...React, default: React}, 'react-native': {View: 'View', useWindowDimensions: () => ({width: 1920, height: 1080})},
    'react-native-reanimated': {default: {View: 'AnimatedView'}, useAnimatedStyle: (fn: () => unknown) => fn(), useSharedValue: useShared, withTiming: (v: unknown) => v},
    'react-native-safe-area-context': {useSafeAreaInsets: () => ({bottom: 0})}, '../kit/overlays': {OverlaysProvider: 'OverlaysProvider'},
    '../kit/shell': {AccountMenu: 'AccountMenu'}, '../kit/browse': {}, '../kit/theme': {useTheme: () => theme}, '../kit/useMotion': {useMotion: () => motion},
    '../kit/focus': {useFocusRegistry: () => registry}, './tv-focus': focusModel, '../screens/home/HomeScreen': {HomeScreen: 'HomeScreen'}, './model': shellModel,
    './PhoneTabBar': {}, './MediumRail': {MediumRail: 'MediumRail'}, './chrome': {nativeScreenChromeHidden: () => false, subscribeNativeScreenChrome: () => () => {}}, './PhoneHomeHeader': {}, './TVRail': {TVRail: 'TVRail'}, './TVProfileMenu': {TVProfileMenu: 'ProfileMenu'},
    './NativePlaybackLayer': {}, './DesktopHeader': {},
  });
  const frames = new Map<number, FrameRequestCallback>(); let sequence = 0;
  const previousFrame = globalThis.requestAnimationFrame, previousCancel = globalThis.cancelAnimationFrame;
  globalThis.requestAnimationFrame = fn => {frames.set(++sequence, fn); return sequence;};
  globalThis.cancelAnimationFrame = id => {frames.delete(id);};
  const rootHost = createHookHost(() => {root = NativeShell({runtime});});
  let sessionHost: ReturnType<typeof createHookHost> | undefined;
  try {
    rootHost.mount();
    const session = nodes(root).find(node => typeof node.type === 'function');
    sessionHost = createHookHost(() => {tree = session.type({runtime, snapshot});});
    await act(() => {sessionHost!.mount();});
    const rail = () => nodes(tree).find(node => node.type === 'TVRail');
    await act(() => {registry.didFocus(row); registry.didFocus({regionId: ids.rail, childId: 'home'}); rail().props.onExpandedChange(true);});
    assert.equal(registry.isRegionActive(row.regionId), true, 'rail retains the exact row opener, including its physical slot');
    assert.equal(railBack!(), true);
    assert.deepEqual(requests, ['card']);
    assert.equal(registry.capture()?.childId, row.childId);
    await act(() => rail().props.onNavigate({kind: 'home'}));
    assert.deepEqual(navigations, [], 'OK on the current rail item does not recreate the destination');
    assert.deepEqual(tops, [{kind: 'home'}]);
    await act(() => rail().props.onNavigate({kind: 'saved'}));
    assert.deepEqual(navigations, [{kind: 'saved'}]);
    for (const patch of [{mediaExpanded: true}, {homeVisible: false}]) {
      registry.didFocus(row);
      await act(() => {snapshot = {...snapshot, ...patch}; sessionHost!.rerender();});
      assert.equal(registry.isRegionActive(row.regionId), true);
      registry.didBlur(row); await Promise.resolve();
      await act(() => {snapshot = {...snapshot, homeVisible: true, mediaExpanded: false}; sessionHost!.rerender();});
      for (const [id, fn] of [...frames]) {frames.delete(id); fn(0);}
      assert.equal(requests.at(-1), 'card');
      assert.equal(registry.capture()?.childId, row.childId);
    }
    const library = {regionId: 'actual-library-region', childId: 'actual-library-card'};
    registry.configure({id: library.regionId, entry: library.childId, order: [library.childId]});
    registry.attach(library, {requestTVFocus() {requests.push('library-card'); registry.didFocus(library);}});
    await act(() => {snapshot = {...snapshot, destination: {kind: 'saved'}, homeVisible: false}; sessionHost!.rerender(); registry.didFocus(library);
      registry.didFocus({regionId: ids.rail, childId: 'saved'}); rail().props.onExpandedChange(true);});
    assert.equal(railBack!(), true);
    assert.equal(requests.at(-1), 'library-card', 'rail return memory follows the actual destination page, not a former Home address');
    await act(() => {snapshot = {...snapshot, destination: {kind: 'library', libraryId: 'movies'}, railDestination: {kind: 'library', libraryId: 'movies'},
      contentVisible: false, libraries: [{id: 'movies'}]}; sessionHost!.rerender();});
    assert.deepEqual(rail().props.destination, {kind: 'library', libraryId: 'movies'});
    const topsBefore = tops.length;
    await act(() => rail().props.onNavigate({kind: 'library', libraryId: 'movies'}));
    assert.deepEqual(navigations.at(-1), {kind: 'library', libraryId: 'movies'}, 'OK on a title-highlighted library opens the real page');
    assert.equal(tops.length, topsBefore, 'a retained hidden origin is not scrolled instead of navigating');
  } finally {
    sessionHost?.unmount(); rootHost.unmount();
    globalThis.requestAnimationFrame = previousFrame; globalThis.cancelAnimationFrame = previousCancel;
  }
  assert.equal(railBack, undefined);
});

test('the real rail declares current-page entry and semantic Right return; native focus alone never navigates', async () => {
  const {hooks} = await import('./helpers/screen-harness.mjs');
  const {motionRules} = await import('../../../packages/design/src/index');
  const {defaultI18n} = await import('../../../packages/i18n/src');
  const h = hooks(), ids = focusModel.tvFocusIds(authority), changes: boolean[] = [], navigations: unknown[] = [];
  const registry = createFocusRegistry(), returnTo = {regionId: ids.row('continue'), childId: 'remembered-card'};
  const nativeCard = {requestTVFocus() {throw new Error('Right must stay native, with no application focus request');}};
  registry.configure({id: returnTo.regionId, entry: 'first-card', order: ['first-card', returnTo.childId]});
  registry.attach(returnTo, nativeCard);
  const theme = createTheme({isTV: true, width: 1920});
  const {TVRail} = await screenModule(new URL('../src-next/shell/TVRail.tsx', import.meta.url), {
    react: h.react, '@portico/design': {motionRules}, 'react-native': {Image: 'Image', ScrollView: 'ScrollView', Text: 'Text', View: 'View', findNodeHandle: (host: unknown) => host === nativeCard ? 719 : 720},
    'react-native-svg': {default: 'Svg', Defs: 'Defs', LinearGradient: 'Gradient', Rect: 'Rect', Stop: 'Stop', Path: 'Path'},
    'react-native-reanimated': {default: {View: 'AnimatedView', Text: 'AnimatedText'}, useAnimatedStyle: (fn: () => unknown) => fn(), useSharedValue: (value: number) => ({value}), withTiming: (value: unknown) => value, withDelay: (_delay: unknown, value: unknown) => value},
    '../../../../packages/i18n/src': {defaultI18n}, '../kit/controls': {Focusable: 'Focusable'},
    '../kit/focus': {FocusRegion: 'FocusRegion', useFocusRegistry: () => registry, focusTestID: (await import('../src-next/kit/focus/registry')).focusTestID}, './tv-focus': focusModel,
    '../kit/artwork': {ProfileFace: 'ProfileFace'}, '../kit/Icon': {Icon: 'Icon'}, '../kit/theme': {useTheme: () => theme},
    '../kit/useMotion': {useMotion: () => ({transforms: false, timing: () => ({duration: 0})})}, './model': shellModel,
  });
  const render = () => h.render(() => TVRail({authority, libraries: [], hasLiveTV: false, destination: {kind: 'home'}, profile: {id: 'p', name: 'Actual'},
    onNavigate: (next: unknown) => navigations.push(next), onProfile() {}, profileRef: {current: null}, onExpandedChange: (open: boolean) => changes.push(open),
    returnTo}));
  const tree = render();
  const region = nodes(tree).find(node => node.type === 'FocusRegion');
  assert.equal(region.props.entry, 'home'); assert.equal(region.props.entryPolicy, 'entry');
  assert.equal(region.props.orientation, 'vertical');
  assert.equal(region.props.edges.right, ids.row('continue'));
  const search = nodes(tree).find(node => node.type === 'Focusable' && node.props.focusId === 'search');
  const controls = (value: unknown) => nodes(value).filter(node => node.type === 'Focusable');
  assert.ok(controls(tree).every(node => node.props.nextFocusRight === 719), 'all rail entries, including Profile, target the exact live card rather than its region entry');
  registry.attach(returnTo, null);
  assert.ok(controls(render()).every(node => node.props.nextFocusRight === undefined), 'a removed host leaves native region fallback intact');
  registry.attach(returnTo, {requestTVFocus() {}});
  assert.ok(controls(render()).every(node => node.props.nextFocusRight === 720), 'a reattached card replaces the old native handle');
  registry.configure({id: returnTo.regionId, enabled: false});
  const hidden = render();
  assert.ok(controls(hidden).every(node => node.props.nextFocusRight === undefined), 'a hidden destination cannot be a native return target');
  assert.equal(nodes(hidden).find(node => node.type === 'FocusRegion').props.edges.right, undefined,
    'the region guide must also release the hidden page, rather than routing native Right to its disabled guide');
  registry.configure({id: returnTo.regionId, enabled: true});
  const restored = render();
  assert.equal(nodes(restored).find(node => node.type === 'FocusRegion').props.edges.right, returnTo.regionId);
  assert.ok(controls(restored).every(node => node.props.nextFocusRight === 720), 'reactivation restores the current real native host');
  region.props.onFocusChange(true);
  assert.deepEqual(changes, [true]); assert.deepEqual(navigations, []);
  assert.equal(search.props.onFocus, undefined, 'Up/Down has no application navigation handler');
  search.props.onPress(); assert.deepEqual(navigations, [{kind: 'search'}]);
});
