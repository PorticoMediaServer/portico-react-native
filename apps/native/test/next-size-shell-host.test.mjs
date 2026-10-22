import assert from 'node:assert/strict';
import test from 'node:test';
import {compileFunction} from 'node:vm';
import {fileURLToPath} from 'node:url';
import {createRequire} from 'node:module';
import {mkdirSync, writeFileSync} from 'node:fs';
import {transformFileSync} from '@babel/core';
import React from 'react';
import {act, create} from 'react-test-renderer';
import * as core from '../../../packages/client-core/src/index.ts';
import {routePath} from '../../../packages/contracts/src/routes.ts';
import * as design from '../../../packages/design/src/index.ts';
import {defaultI18n} from '../../../packages/i18n/src/index.ts';
import * as shellModel from '../src-next/shell/model.ts';
import * as tvFocus from '../src-next/shell/tv-focus.ts';
import * as registryModule from '../src-next/kit/focus/registry.ts';
import * as homeModel from '../src-next/screens/home/model.ts';
import * as homePresentation from '../../../packages/client-core/src/presentation/home-spotlight.ts';
import * as homeCapabilities from '../../../packages/client-core/src/home-selection/index.ts';
import * as serverText from '../../../packages/client-core/src/presentation/server-text.ts';
import * as kitModel from '../../../packages/client-core/src/presentation/kit-model/index.ts';
import * as layoutModel from '../src-next/kit/layout/model.ts';
import {NativeHomePaging} from '../src-next/shell/home-paging.ts';
import {tvHomeRows} from '../src-next/screens/home/tv-presentation.ts';
import * as postureStore from '../src-next/platform/platformPostureStore.ts';
import {brandSymbol} from '../assets/brandSymbol.ts';
import {NativeShellRouteRegistry} from '../src-next/shell/route-registry.ts';
import {createNavigationActivity} from '../src-next/shell/navigation-tools.ts';

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

// A real React reconciler and the installed RN useWindowDimensions implementation.
// Only native hosts, animation/blur bridges and visual children are adapters.
// These tests establish component/ref continuity, not native layout or playback.
function sourceModule(relative, modules) {
  const file = fileURLToPath(new URL(relative, import.meta.url));
  const {code} = transformFileSync(file, {configFile: fileURLToPath(new URL('../babel.config.js', import.meta.url)), compact: false, retainLines: true});
  const module = {exports: {}};
  compileFunction(code, ['require', 'module', 'exports'], {filename: file})(name => {
    if (!(name in modules)) throw new Error(`Missing host adapter: ${name} from ${relative}`);
    return modules[name];
  }, module, module.exports);
  return module.exports;
}

const require = createRequire(import.meta.url);
function load(relative, modules) {
  return sourceModule(relative, new Proxy(modules, {has: (target, name) => name in target || name === 'react/jsx-runtime' || String(name).startsWith('@babel/runtime/'),
    get: (target, name) => name in target ? target[name] : require(String(name))}));
}
const children = ({children: content}) => content;
const host = (name, lifecycle) => React.forwardRef(function Host(props, ref) {
  React.useEffect(() => {lifecycle?.mount?.(); return () => lifecycle?.unmount?.();}, []);
  return React.createElement(name, {...props, ref}, typeof props.children === 'function' ? props.children({focused: false, hovered: false, pressed: false}) : props.children);
});
const authority = {serverId: 'server', accountId: 'account', profileId: 'profile', epoch: 'epoch', viewerFence: 'fence'};
const profile = {id: 'profile', name: 'Justin', color: '#28404f'};

function environment({isTV = false, width = 599, height = 900, os = 'android', role = 'owner'} = {}) {
  let window = {width, height, scale: 2, fontScale: 1};
  let insets = {top: 24, right: 0, bottom: 34, left: 0};
  const dimensionListeners = new Set(), insetListeners = new Set(), appListeners = new Set();
  const routes = new NativeShellRouteRegistry();
  const Dimensions = {get: key => {assert.equal(key, 'window'); return window;},
    addEventListener: (event, fn) => {assert.equal(event, 'change'); dimensionListeners.add(fn); return {remove: () => dimensionListeners.delete(fn)};}};
  const {default: useWindowDimensions} = load('../node_modules/react-native/Libraries/Utilities/useWindowDimensions.js', {react: React, './Dimensions': Dimensions});
  const View = host('View'), Text = host('Text');
  const ScrollView = React.forwardRef(function ScrollViewHost(props, ref) {
    const instance = React.useRef({scrollY: 0, scrollTo({y}) {this.scrollY = y;}});
    React.useImperativeHandle(ref, () => instance.current, []);
    return React.createElement('ScrollView', {...props, nativeInstance: instance.current}, props.children);
  });
  const postureListeners = new Set();
  const postureCounts = {subscriptions: 0, removals: 0, reads: 0};
  const postureModule = {getSnapshot: async () => {postureCounts.reads++; return {revision: 0, status: 'pending', window: null, folds: []};}};
  class NativeEventEmitter {
    constructor(module) {assert.strictEqual(module, postureModule);}
    addListener(event, listener) {
      assert.equal(event, 'PorticoPostureChanged'); postureCounts.subscriptions++; postureListeners.add(listener);
      return {remove() {postureCounts.removals++; postureListeners.delete(listener);}};
    }
  }
  const native = {View, Text, ScrollView, Image: host('Image'), RefreshControl: host('RefreshControl'), Platform: {OS: os, isTV}, useWindowDimensions,
    NativeEventEmitter, NativeModules: {PorticoPosture: postureModule},
    AppState: {currentState: 'active', addEventListener: (_event, fn) => {appListeners.add(fn); return {remove: () => appListeners.delete(fn)};}}, useTVEventHandler() {}};
  const platformPosture = load('../src-next/platform/platformPosture.ts', {react: React, 'react-native': native, './platformPostureStore': postureStore});
  const windowPosture = load('../src-next/shell/WindowPosture.tsx', {react: React, '../platform/platformPosture': platformPosture});
  const safeArea = {useSafeAreaInsets: () => React.useSyncExternalStore(fn => {insetListeners.add(fn); return () => insetListeners.delete(fn);}, () => insets)};
  const {useSizeClass} = load('../src-next/kit/useSizeClass.ts', {'react-native': native, '../../../../packages/client-core/src': core});
  const theme = load('../src-next/kit/theme.ts', {react: React, 'react-native': native, '@portico/design': design,
    '../../../../packages/client-core/src': core, './useSizeClass': {useSizeClass}});
  const motion = {transforms: false, timing: () => ({duration: 0})};
  const reanimated = {View, ScrollView, useAnimatedStyle: fn => fn(), useSharedValue: initial => React.useRef({value: initial}).current,
    useAnimatedRef: () => React.useRef(null), useAnimatedScrollHandler: fn => fn, useAnimatedReaction() {}, cancelAnimation() {},
    scrollTo: (ref, x, y) => ref.current?.scrollTo({x, y}), withTiming: value => value, runOnJS: fn => fn};
  reanimated.default = reanimated;
  const registry = registryModule.createFocusRegistry();
  const focus = {useFocusRegistry: () => registry, FocusRegion: children, FocusItem: children};
  const lifetimes = {provider: {mount: 0, unmount: 0}, playback: {mount: 0, unmount: 0}, page: {mount: 0, unmount: 0}};
  function Lifetime({kind, children: content}) {
    const token = React.useRef({});
    React.useEffect(() => {lifetimes[kind].mount++; return () => {lifetimes[kind].unmount++;};}, [kind]);
    return React.createElement(kind, {token: token.current}, content);
  }
  const controls = {Focusable: host('Focusable'), Button: host('Button')};
  const icon = {Icon: host('Icon')}, artwork = {ProfileFace: host('ProfileFace'), AmbientArt: host('AmbientArt')};
  const blur = {BlurView: host('BlurView'), phoneTabBarRecipe: () => ({paddingX: 12, paddingTop: 10, gap: 4, blur: 18, alpha: .72})};
  const common = {react: React, 'react-native': native, 'react-native-reanimated': reanimated, 'react-native-safe-area-context': safeArea,
    '../../../../packages/i18n/src': {defaultI18n}, '../../../../packages/client-core/src': core, '../kit/theme': theme,
    '../kit/controls': controls, '../kit/Icon': icon, '../kit/artwork': artwork, '../platform/native-blur': blur,
    './model': shellModel, './tv-focus': tvFocus, '../../assets/brandSymbol': {brandSymbol}, '../../assets/wordmark.png': 'wordmark.png',
    'react-native-svg': {__esModule: true, default: host('Svg'), Defs: host('Defs'), LinearGradient: host('LinearGradient'), Rect: host('Rect'), Stop: host('Stop'), SvgXml: host('SvgXml')}};
  const {useNavigationTools} = load('../src-next/shell/useNavigationTools.ts', {react: React, 'react-native': native, './route-registry': {nativeShellRoutes: routes}});
  const {TouchNavigation} = load('../src-next/shell/TouchNavigation.tsx', common);
  const {PhoneTabBar} = load('../src-next/shell/PhoneTabBar.tsx', common);
  const {useFocusAnchor} = load('../src-next/kit/layout/FocusAnchor.ts', {react: React, 'react-native': native, 'react-native-reanimated': reanimated,
    '../theme': theme, '../useMotion': {useMotion: () => motion}, './model': layoutModel});
  const layout = {Hero: host('Hero'), FocusPreviewHero: host('FocusPreviewHero'), Row: host('Row')};
  const {HomeScreen} = load('../src-next/screens/home/HomeScreen.tsx', {react: React, 'react-native': native, 'react-native-reanimated': reanimated,
    '../../../../../packages/i18n/src': {defaultI18n}, '../../../../../packages/client-core/src/presentation/home-spotlight': homePresentation,
    '../../../../../packages/client-core/src/home-selection': homeCapabilities, '../../../../../packages/client-core/src/presentation/server-text': serverText,
    '../../../../../packages/client-core/src/presentation/kit-model': kitModel, '../../platform/ArtworkPipeline': {ArtworkPlacementContext: React.createContext({})},
    '../../kit/artwork': artwork, '../../kit/controls': controls, '../../kit/focus': focus, '../../shell/tv-focus': tvFocus,
    '../../shell/home-paging': {NativeHomePaging}, './tv-presentation': {tvHomeRows}, '../../kit/cards': {}, '../../kit/layout': layout,
    '../../kit/layout/FocusAnchor': {useFocusAnchor}, '../../kit/layout/types': {}, '../../kit/states': {}, '../../kit/theme': theme,
    '../../shell/model': shellModel, './HomeHeroFacts': {}, './model': homeModel});
  const {NativeShell} = load('../src-next/shell/NativeShell.tsx', {...common, '../kit/overlays': {OverlaysProvider: props => React.createElement(Lifetime, {...props, kind: 'provider'})},
    '../kit/shell': {AccountMenu: host('AccountMenu')}, '../kit/browse': {StickyBrowseHeader: host('StickyBrowseHeader'), LibrarySwitcher: host('LibrarySwitcher'), LibraryMenu: host('LibraryMenu')},
    '../kit/useMotion': {useMotion: () => motion}, '../kit/focus': focus, '../screens/home/HomeScreen': {HomeScreen},
    './PhoneTabBar': {PhoneTabBar}, './PhoneHomeHeader': {PhoneHomeHeader: host('PhoneHomeHeader')}, './TouchNavigation': {TouchNavigation},
    './TVRail': {TVRail: host('TVRail')}, './TVProfileMenu': {TVProfileMenu: host('TVProfileMenu')},
    './useNavigationTools': {useNavigationTools}, './NativePlaybackLayer': {NativePlaybackLayer: () => React.createElement(Lifetime, {kind: 'playback'})}, './WindowPosture': windowPosture});
  let shellSnapshot = {authority, destination: {kind: 'home'}, libraries: [{id: 'read', name: 'Read', kind: 'books'}, {id: 'movie', name: 'Movies', kind: 'movie'}],
    hasLiveTV: true, profile, homeVisible: true, mediaExpanded: false, homeObscured: false, selectionActive: false, unreadNotificationCount: 4, unreadNotifications: true, serverName: 'Home server', account: {viewerRole: role, accountLine: 'actual.username',
      actions: [{id: 'notifications', onPress: () => {opened.push('notifications');}}], serverAction: {onPress: () => {opened.push('server-dashboard');}}}};
  const shellListeners = new Set(), sourceListeners = new Set(), feedListeners = new Set(), opened = [], requests = [];
  let retired = false, activityCount = 2, activityFailure;
  const feed = {on: (_type, fn) => {feedListeners.add(fn); return () => feedListeners.delete(fn);}, onResync: fn => {feedListeners.add(fn); return () => feedListeners.delete(fn);}};
  const activityBody = () => {const stamp = '2026-10-22T07:00:00Z'; return {scope: {serverId: 'server', viewerFence: 'a'.repeat(64)}, observedAt: stamp, serverName: 'Home server',
    streams: {count: activityCount, convertingCount: 0, overflow: {count: Math.max(0, activityCount - 3), convertingCount: 0}, items: Array.from({length: Math.min(3, activityCount)}, (_, i) => ({id: 'session-' + i, user: {id: 'user'}, profile: {id: 'profile', name: 'Profile'}, device: {id: 'device', name: 'Device'}, kind: 'vod', state: 'playing', startedAt: stamp, problem: false, converting: false, positionMs: 0, decision: {}}))},
    scans: [], tasks: {count: 0, items: []}, update: {available: false, state: 'unconfigured', current: 'dev'}, health: {degraded: false}};};
  const navigationActivity = createNavigationActivity({api: {requestRaw: async (path, method, options) => {requests.push({path, method, ...options}); return {status: activityFailure ?? 200, headers: {}, body: activityFailure ? {error: {code: 'not_permitted'}} : activityBody()};}},
    events: feed, current: () => !retired, session: () => ({sessionFamilyId: 'family', viewer: {serverId: 'server', accountId: 'account', profileId: 'profile', authority: 'local', role}}), authority: () => authority,
    subscribeAuthority: fn => {sourceListeners.add(fn); return () => sourceListeners.delete(fn);}});
  const doc = {serverId: 'server', viewerFence: 'fence', rows: [], spotlight: [{entry: {id: 'movie', libraryId: 'movie', kind: 'movie', title: 'Title', available: true}, reason: {text: {code: 'recently_added', fallback: 'New in Movies'}}}]};
  const homeSnapshot = {phase: 'ready', document: doc};
  const anchors = new Map();
  const pageRef = React.createRef();
  const Page = React.forwardRef(function Page(_, ref) {
    const state = React.useRef({topVisibleItem: 'item-17', offsetWithinItem: 12, query: 'retained'});
    React.useImperativeHandle(ref, () => state.current, []);
    return React.createElement(Lifetime, {kind: 'page'}, React.createElement('Page', {state: state.current}));
  });
  let loads = 0, scrollRequests = 0;
  function PostureProbe() {return React.createElement('PostureProbe', {snapshot: windowPosture.useWindowPosture()});}
  const runtime = {navigationActivity, getSnapshot: () => shellSnapshot, subscribe: fn => {shellListeners.add(fn); return () => shellListeners.delete(fn);},
    memory: {read: async () => undefined, remember: async () => {}}, reportError: error => {throw error;},
    scrollToTop: () => {scrollRequests++;}, onDestination: destination => {shellSnapshot = {...shellSnapshot, destination}; for (const fn of shellListeners) fn();},
    registerScrollToTop: (destination, move) => {anchors.set(destination.kind, move); return () => anchors.delete(destination.kind);},
    renderDestination: () => React.createElement(Page, {ref: pageRef}), renderRoutes: () => React.createElement(PostureProbe), renderSelection: () => null,
    home: {subscribe: () => () => {}, getSnapshot: () => homeSnapshot, load: async () => {loads++;}},
    artwork: () => undefined, ambient: () => undefined, heroArt: () => undefined, onArtworkError() {}, libraryMenu: () => ({}),
    text: {t: defaultI18n.t, locale: 'en-US'}, actions: {customize() {}}, playback: {}};
  function Probe() {
    return React.createElement('SizeProbe', {sizeClass: theme.useSizeClass(), platform: theme.useTheme().platform, isTV: theme.useTheme().isTV});
  }
  const tree = () => React.createElement(theme.ThemeProvider, null, React.createElement(Probe), React.createElement(NativeShell, {runtime}));
  const flatten = style => Array.isArray(style) ? Object.assign({}, ...style.map(flatten)) : style ?? {};
  let renderer;
  return {theme, TouchNavigation, runtime, routes, opened, requests, navigationActivity, feedListeners, lifetimes, pageRef, anchors, posture: platformPosture.platformPosture, postureCounts,
    get loads() {return loads;}, get scrollRequests() {return scrollRequests;}, get listenerCount() {return dimensionListeners.size;},
    get root() {return renderer.root;}, get renderer() {return renderer;}, flatten,
    async update(patch) {await act(async () => {shellSnapshot = {...shellSnapshot, ...patch}; for (const fn of [...shellListeners]) fn();});},
    async registerTools() {let release; await act(async () => {release = [routes.register('notifications', {render: () => React.createElement('NotificationsTestScreen')}), routes.register('server-dashboard', {render: () => React.createElement('ActivityTestScreen')})];}); return async () => {await act(async () => release.forEach(fn => fn()));};},
    async background(value) {await act(async () => {native.AppState.currentState = value; for (const fn of [...appListeners]) fn(value);});},
    async activity(count, failure) {activityCount = count; activityFailure = failure; await act(async () => navigationActivity?.service.load());},
    async retire() {await act(async () => {retired = true; for (const fn of [...sourceListeners]) fn();});},
    async mount() {await act(async () => {renderer = create(tree(), {createNodeMock: element => ({testID: element.props.testID, scrollY: 0, scrollTo({y}) {this.scrollY = y;}})});});},
    async resize(next, nextInsets) {await act(async () => {window = {...window, ...next}; for (const fn of [...dimensionListeners]) fn({window});
      if (nextInsets) {insets = {...insets, ...nextInsets}; for (const fn of [...insetListeners]) fn();}});},
    async navigate(kind) {await act(async () => runtime.onDestination({kind}));},
    async emitPosture(value) {await act(async () => {for (const fn of [...postureListeners]) fn(value);});},
    async press(id) {await act(async () => renderer.root.findAllByType('Focusable').find(node => node.props.testID === id).props.onPress());},
    async dispose() {await act(async () => renderer.unmount()); navigationActivity?.service.dispose(); assert.equal(sourceListeners.size, 0); assert.equal(feedListeners.size, 0); assert.equal(appListeners.size, 0); assert.equal(dimensionListeners.size, 0); assert.equal(insetListeners.size, 0);
      assert.equal(postureListeners.size, 0); assert.equal(postureCounts.subscriptions, postureCounts.removals);},
  };
}

const byID = (f, id) => f.root.findAll(node => typeof node.type === 'string' && node.props.testID === id);
const assertClass = (f, sizeClass, chrome) => {
  assert.equal(f.root.findByType('SizeProbe').props.sizeClass, sizeClass);
  for (const id of ['phone-tab-bar', 'touch-rail', 'touch-sidebar']) assert.equal(byID(f, id).length, id === chrome ? 1 : 0, id);
};

function captureChrome(f, width, name, height = 900) {
  const directory = process.env.PORTICO_SIZE_SHELL_CAPTURE_DIR;
  if (!directory) return;
  mkdirSync(directory, {recursive: true});
  const chrome = f.root.findAll(node => typeof node.type === 'string' && ['phone-tab-bar', 'touch-rail', 'touch-sidebar'].includes(node.props.testID))[0];
  const serialize = node => {
    if (typeof node === 'string') return [node];
    const nested = node.children.flatMap(serialize);
    if (typeof node.type !== 'string') return nested;
    return [{type: node.type,
      props: Object.fromEntries(['style', 'contentContainerStyle', 'testID', 'name', 'size', 'color', 'accessibilityLabel', 'source', 'xml', 'width', 'height', 'id', 'x1', 'y1', 'x2', 'y2', 'offset', 'stopColor', 'stopOpacity', 'fill'].filter(key => key in node.props).map(key => [key, node.props[key]])),
      children: nested}];
  };
  // Host-only subtree, excluding React elements held in render props and refs.
  writeFileSync(`${directory}/${name}.json`, JSON.stringify({width, height, tree: serialize(chrome)[0]}, null, 2));
}

test('real RN window hook switches 599/600/1023/1024 live and retains actual Home, scroll host, provider and playback', async () => {
  const f = environment(); await f.mount();
  try {
    assertClass(f, 'compact', 'phone-tab-bar');
    captureChrome(f, 599, 'compact-599');
    const homeInstance = byID(f, 'native-home')[0], scroll = homeInstance.props.nativeInstance, anchor = f.anchors.get('home');
    scroll.scrollY = 734;
    await act(async () => homeInstance.props.onScroll({contentOffset: {x: 0, y: 734}}));
    for (const [width, sizeClass, chrome] of [[600, 'medium', 'touch-rail'], [1023, 'medium', 'touch-rail'], [1024, 'expanded', 'touch-sidebar'],
      [626, 'medium', 'touch-rail'], [466, 'compact', 'phone-tab-bar'], [1180, 'expanded', 'touch-sidebar'], [820, 'medium', 'touch-rail'], [599, 'compact', 'phone-tab-bar']]) {
      await f.resize({width}); assertClass(f, sizeClass, chrome);
      captureChrome(f, width, `${sizeClass}-${width}`);
      assert.strictEqual(byID(f, 'native-home')[0], homeInstance, 'actual Home scroll host stays reconciled');
      assert.strictEqual(byID(f, 'native-home')[0].props.nativeInstance, scroll, 'native ref retained');
      assert.equal(scroll.scrollY, 734, 'scroll host offset retained');
      assert.strictEqual(f.anchors.get('home'), anchor, 'actual Home anchor registration retained');
    }
    assert.equal(f.loads, 1, 'no Home reload from chrome changes');
    assert.equal(f.scrollRequests, 0, 'resize never navigates or requests scroll-to-top');
    assert.deepEqual(f.lifetimes.provider, {mount: 1, unmount: 0});
    assert.deepEqual(f.lifetimes.playback, {mount: 1, unmount: 0});
    assert.equal(byID(f, 'native-home').length, 1, 'one Home, no hidden duplicate');
  } finally {await f.dispose();}
});

test('rotation, density, height and safe-area updates follow latest logical width and retain page instance/ref/anchor', async () => {
  const f = environment({width: 626, height: 890}); await f.mount();
  try {
    await f.navigate('search'); const page = f.pageRef.current, instance = f.root.findByType('Page');
    await f.resize({width: 890, height: 626}, {top: 0, left: 26, right: 0, bottom: 20});
    assertClass(f, 'medium', 'touch-rail');
    assert.equal(f.flatten(byID(f, 'native-shell-content')[0].props.style).marginLeft, 110);
    await f.resize({height: 1400, scale: 4, fontScale: 1.3}, {top: 60, left: 0, bottom: 48});
    assertClass(f, 'medium', 'touch-rail');
    await f.resize({width: 466, height: 678}); assertClass(f, 'compact', 'phone-tab-bar');
    await f.resize({width: 1024, height: 768}); assertClass(f, 'expanded', 'touch-sidebar');
    assert.strictEqual(f.pageRef.current, page); assert.strictEqual(f.root.findByType('Page'), instance);
    assert.deepEqual(page, {topVisibleItem: 'item-17', offsetWithinItem: 12, query: 'retained'});
    assert.deepEqual(f.lifetimes.page, {mount: 1, unmount: 0}); assert.equal(f.scrollRequests, 0);
  } finally {await f.dispose();}
});

test('touch rail keeps TV order including Read, bottom Settings/profile and 44-point controls; expanded sidebar collapses visibly', async () => {
  const f = environment({width: 600}); await f.mount();
  try {
    const ids = () => f.root.findAllByType('Focusable').map(node => node.props.testID).filter(id => id?.startsWith('touch-nav-'));
    assert.deepEqual(ids(), ['touch-nav-search', 'touch-nav-home', 'touch-nav-library:read', 'touch-nav-library:movie', 'touch-nav-live', 'touch-nav-saved', 'touch-nav-settings', 'touch-nav-profile']);
    for (const node of f.root.findAllByType('Focusable')) assert.ok(f.flatten(node.props.style).minHeight >= 44);
    await f.resize({width: 1024}); assertClass(f, 'expanded', 'touch-sidebar');
    await f.press('touch-nav-toggle'); assertClass(f, 'expanded', 'touch-rail');
    assert.equal(f.flatten(byID(f, 'native-shell-content')[0].props.style).marginLeft, 84);
    await f.resize({width: 466}); await f.resize({width: 1180}); assertClass(f, 'expanded', 'touch-rail');
    await f.press('touch-nav-toggle'); assertClass(f, 'expanded', 'touch-sidebar');
    assert.equal(f.flatten(byID(f, 'native-shell-content')[0].props.style).marginLeft, 248);
    await f.press('touch-nav-library:read');
    assert.deepEqual(f.runtime.getSnapshot().destination, {kind: 'library', libraryId: 'read'});
  } finally {await f.dispose();}
});

test('TV at 1920 uses the D-pad rail regardless of expanded size class', async () => {
  const f = environment({isTV: true, width: 1920, height: 1080}); await f.mount();
  try {
    assert.equal(f.root.findByType('SizeProbe').props.sizeClass, 'expanded');
    assert.equal(f.root.findByType('SizeProbe').props.isTV, true);
    assert.equal(f.root.findAllByType('TVRail').length, 1);
    for (const id of ['phone-tab-bar', 'touch-sidebar', 'touch-rail']) assert.equal(byID(f, id).length, 0);
    await f.resize({width: 599, height: 400});
    assert.equal(f.root.findAllByType('TVRail').length, 1);
    assert.equal(f.root.findByType('SizeProbe').props.platform, 'tv');
  } finally {await f.dispose();}
});

test('checked posture subscription is read-only and never overrides RN width or replaces page, scroll, provider or playback', async () => {
  const f = environment({width: 626}); await f.mount();
  try {
    assert.deepEqual(f.postureCounts, {subscriptions: 1, removals: 0, reads: 1});
    const home = byID(f, 'native-home')[0], scroll = home.props.nativeInstance, anchor = f.anchors.get('home');
    scroll.scrollY = 411;
    const fold = {bounds: {left: 0, top: 440, right: 1920, bottom: 450}, state: 'half-opened', orientation: 'horizontal', isSeparating: true, occlusion: 'none'};
    for (const report of [
      {revision: 1, status: 'available', window: {width: 1920, height: 900}, folds: [fold]},
      {revision: 2, status: 'available', window: {width: 466, height: 678}, folds: [{...fold, state: 'flat', orientation: 'vertical'}]},
      {revision: 3, status: 'available', window: {width: 1024, height: 768}, folds: []},
    ]) {
      await f.emitPosture(report);
      const snapshot = f.root.findByType('PostureProbe').props.snapshot;
      assert.strictEqual(snapshot, f.posture.getSnapshot()); assert.equal(snapshot.status, 'available');
      assert.ok(Object.isFrozen(snapshot)); assert.deepEqual(snapshot.folds, report.folds);
      assertClass(f, 'medium', 'touch-rail');
      assert.strictEqual(byID(f, 'native-home')[0], home); assert.strictEqual(byID(f, 'native-home')[0].props.nativeInstance, scroll);
      assert.equal(scroll.scrollY, 411); assert.strictEqual(f.anchors.get('home'), anchor);
      assert.deepEqual(f.runtime.getSnapshot().destination, {kind: 'home'});
    }
    await f.resize({width: 466}); assertClass(f, 'compact', 'phone-tab-bar');
    await f.navigate('search'); const page = f.root.findByType('Page'), ref = f.pageRef.current;
    for (const [revision, status] of [[4, 'pending'], [5, 'unavailable']]) {
      await f.emitPosture({revision, status, window: null, folds: []});
      assert.equal(f.root.findByType('PostureProbe').props.snapshot.status, status);
      assertClass(f, 'compact', 'phone-tab-bar'); assert.strictEqual(f.root.findByType('Page'), page); assert.strictEqual(f.pageRef.current, ref);
    }
    await f.resize({width: 1024}); assertClass(f, 'expanded', 'touch-sidebar');
    assert.strictEqual(f.root.findByType('Page'), page); assert.strictEqual(f.pageRef.current, ref);
    assert.deepEqual(ref, {topVisibleItem: 'item-17', offsetWithinItem: 12, query: 'retained'});
    assert.equal(f.loads, 1); assert.equal(f.scrollRequests, 0);
    assert.deepEqual(f.lifetimes.provider, {mount: 1, unmount: 0}); assert.deepEqual(f.lifetimes.playback, {mount: 1, unmount: 0});
    assert.deepEqual(f.postureCounts, {subscriptions: 1, removals: 0, reads: 1});
  } finally {await f.dispose();}
});

test('unsupported Apple posture stays unavailable while native shell size follows live RN width', async () => {
  const f = environment({width: 626, os: 'ios'}); await f.mount();
  try {
    assert.deepEqual(f.root.findByType('PostureProbe').props.snapshot, {status: 'unavailable', window: null, folds: []});
    assertClass(f, 'medium', 'touch-rail'); await f.resize({width: 466}); assertClass(f, 'compact', 'phone-tab-bar');
    assert.deepEqual(f.postureCounts, {subscriptions: 0, removals: 0, reads: 0});
  } finally {await f.dispose();}
});

test('registered real callbacks and canonical service supply only genuine unread/stream counters without remounting Home', async () => {
  const f = environment({width: 600}); await f.mount();
  try {
    const home = byID(f, 'native-home')[0], scroll = home.props.nativeInstance, anchor = f.anchors.get('home'); scroll.scrollY = 512;
    assert.equal(byID(f, 'touch-nav-notifications').length, 0); assert.equal(byID(f, 'touch-nav-activity').length, 0);
    assert.equal(f.requests.length, 0, 'no owner request without a genuine registered destination');
    const release = await f.registerTools();
    assert.equal(f.requests.length, 1); assert.equal(f.requests[0].path, routePath('get_admin_activity'));
    assert.equal(f.requests[0].method, 'GET'); assert.equal(f.requests[0].headers['Cache-Control'], 'no-cache, no-store');
    assert.equal(byID(f, 'touch-nav-notifications-count')[0].findByType('Text').children[0], '4');
    assert.equal(byID(f, 'touch-nav-activity-count')[0].findByType('Text').children[0], '2');
    for (const id of ['notifications', 'activity']) assert.equal(byID(f, `touch-nav-${id}`)[0].findAllByType('Text').length, 1, 'rail utility has only a counter, no label');
    await f.press('touch-nav-notifications'); await f.press('touch-nav-activity'); assert.deepEqual(f.opened, ['notifications', 'server-dashboard']);
    await f.update({unreadNotificationCount: undefined, unreadNotifications: true});
    assert.equal(byID(f, 'touch-nav-notifications-count').length, 0, 'boolean unread never becomes fabricated numeric one');
    await f.update({unreadNotificationCount: 0}); assert.equal(byID(f, 'touch-nav-notifications-count').length, 0);
    await f.activity(0); assert.equal(byID(f, 'touch-nav-activity-count')[0].findByType('Text').children[0], '0', 'server-confirmed idle count');
    await f.activity(0, 403); assert.equal(byID(f, 'touch-nav-activity-count').length, 0, 'denial clears the previous private count');
    await f.resize({width: 1024});
    assert.equal(byID(f, 'touch-nav-username')[0].children[0], 'actual.username'); assert.equal(byID(f, 'touch-nav-server')[0].children[0], 'Home server');
    assert.ok(byID(f, 'touch-nav-notifications')[0].findAllByType('Text').some(node => node.children.includes('Notifications')));
    assert.ok(byID(f, 'touch-nav-activity')[0].findAllByType('Text').some(node => node.children.includes('Server activity')));
    const stale = byID(f, 'touch-nav-notifications')[0].props.onPress;
    await release(); assert.equal(byID(f, 'touch-nav-activity').length, 0); stale(); assert.equal(f.opened.length, 2, 'stale callback rechecks route capability');
    assert.strictEqual(byID(f, 'native-home')[0], home); assert.strictEqual(home.props.nativeInstance, scroll); assert.equal(scroll.scrollY, 512); assert.strictEqual(f.anchors.get('home'), anchor);
    assert.deepEqual(f.lifetimes.provider, {mount: 1, unmount: 0}); assert.deepEqual(f.lifetimes.playback, {mount: 1, unmount: 0});
  } finally {await f.dispose();}
});

test('Activity owner visibility follows foreground, live width, selection and retirement; member/admin never read', async () => {
  for (const role of ['member', 'admin']) {
    const f = environment({width: 1024, role}); await f.mount();
    try {const release = await f.registerTools(); assert.equal(byID(f, 'touch-nav-activity').length, 0); assert.equal(f.requests.length, 0); assert.equal(f.navigationActivity, undefined); await release();}
    finally {await f.dispose();}
  }
  const f = environment({width: 626}); await f.mount();
  try {
    const release = await f.registerTools(); assert.equal(f.navigationActivity.service.getSnapshot().phase, 'ready');
    await f.background('background'); assert.equal(f.navigationActivity.service.getSnapshot().document, undefined); assert.equal(f.feedListeners.size, 0);
    await f.background('active'); assert.equal(f.navigationActivity.service.getSnapshot().phase, 'ready');
    await f.resize({width: 466}); assert.equal(f.navigationActivity.service.getSnapshot().document, undefined); assert.equal(f.feedListeners.size, 0);
    await f.resize({width: 626}); assert.equal(f.navigationActivity.service.getSnapshot().phase, 'ready');
    await f.update({selectionActive: true}); assert.equal(f.navigationActivity.service.getSnapshot().document, undefined); assert.equal(byID(f, 'touch-rail').length, 0);
    await f.update({selectionActive: false}); assert.equal(f.navigationActivity.service.getSnapshot().phase, 'ready');
    await f.retire(); assert.equal(f.navigationActivity.service.getSnapshot().document, undefined); assert.equal(f.feedListeners.size, 0); await release();
  } finally {await f.dispose();}
});

test('short windows scroll only genuine libraries with measured edge fades and keep pinned footer and page state', async () => {
  const f = environment({width: 890, height: 626}); await f.mount();
  try {
    const release = await f.registerTools(); await f.navigate('search');
    const page = f.root.findByType('Page'), ref = f.pageRef.current;
    const libraries = ['movie', 'tv', 'anime', 'music', 'audiobook', 'books', 'comics'].map((kind, i) => ({id: 'real-' + i, name: kind, kind}));
    await f.update({libraries});
    const list = byID(f, 'touch-nav-libraries')[0], viewport = byID(f, 'touch-nav-library-viewport')[0];
    const ids = list.findAllByType('Focusable').map(node => node.props.testID);
    assert.deepEqual(ids, libraries.map(lib => 'touch-nav-library:' + lib.id));
    assert.deepEqual(list.findAllByType('Icon').map(node => node.props.name), ['i-film', 'i-tvlib', 'i-category', 'i-music', 'i-headphones', 'i-book', 'i-panels']);
    for (const id of ['primary', 'secondary', 'footer']) {const group = byID(f, 'touch-nav-' + id)[0]; assert.equal(f.flatten(group.props.style).flexShrink, 0); assert.equal(list.findAll(node => node === group).length, 0);}
    assert.equal(byID(f, 'touch-nav-brand').length, 0, 'medium rail has no brand or collapse control');
    await act(async () => {viewport.props.onLayout({nativeEvent: {layout: {height: 140}}}); list.props.onContentSizeChange(72, 350);});
    assert.equal(byID(f, 'touch-nav-library-fade-top').length, 0); assert.equal(byID(f, 'touch-nav-library-fade-bottom').length, 1);
    captureChrome(f, 890, 'medium-short-890', 626);
    await act(async () => list.props.onScroll({nativeEvent: {contentOffset: {y: 100}}}));
    assert.equal(byID(f, 'touch-nav-library-fade-top').length, 1); assert.equal(byID(f, 'touch-nav-library-fade-bottom').length, 1);
    await act(async () => list.props.onScroll({nativeEvent: {contentOffset: {y: 210}}}));
    assert.equal(byID(f, 'touch-nav-library-fade-top').length, 1); assert.equal(byID(f, 'touch-nav-library-fade-bottom').length, 0);
    await f.update({libraries: libraries.slice(0, 2)});
    await act(async () => list.props.onContentSizeChange(72, 90));
    assert.equal(byID(f, 'touch-nav-library-fade-top').length, 0); assert.equal(byID(f, 'touch-nav-library-fade-bottom').length, 0, 'shrinking content clamps stale native scroll offset');
    await f.update({libraries});
    await f.resize({width: 1024, height: 626}, {bottom: 20, top: 24});
    await act(async () => byID(f, 'touch-nav-libraries')[0].props.onContentSizeChange(224, 314)); captureChrome(f, 1024, 'expanded-short-1024', 626);
    await f.press('touch-nav-toggle'); captureChrome(f, 1024, 'collapsed-short-1024', 626);
    for (const node of f.root.findAllByType('Focusable')) assert.ok(f.flatten(node.props.style).minHeight >= 44, node.props.testID);
    await f.resize({width: 466, height: 678}); await f.resize({width: 626, height: 890});
    assert.strictEqual(f.root.findByType('Page'), page); assert.strictEqual(f.pageRef.current, ref); assert.equal(ref.topVisibleItem, 'item-17');
    await release();
  } finally {await f.dispose();}
});
