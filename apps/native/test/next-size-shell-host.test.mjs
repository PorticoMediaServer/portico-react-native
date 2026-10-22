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

function environment({isTV = false, width = 599, height = 900} = {}) {
  let window = {width, height, scale: 2, fontScale: 1};
  let insets = {top: 24, right: 0, bottom: 34, left: 0};
  const dimensionListeners = new Set(), insetListeners = new Set();
  const Dimensions = {get: key => {assert.equal(key, 'window'); return window;},
    addEventListener: (event, fn) => {assert.equal(event, 'change'); dimensionListeners.add(fn); return {remove: () => dimensionListeners.delete(fn)};}};
  const {default: useWindowDimensions} = load('../node_modules/react-native/Libraries/Utilities/useWindowDimensions.js', {react: React, './Dimensions': Dimensions});
  const View = host('View'), Text = host('Text');
  const ScrollView = React.forwardRef(function ScrollViewHost(props, ref) {
    const instance = React.useRef({scrollY: 0, scrollTo({y}) {this.scrollY = y;}});
    React.useImperativeHandle(ref, () => instance.current, []);
    return React.createElement('ScrollView', {...props, nativeInstance: instance.current}, props.children);
  });
  const native = {View, Text, ScrollView, Image: host('Image'), RefreshControl: host('RefreshControl'), Platform: {OS: 'android', isTV}, useWindowDimensions,
    AppState: {currentState: 'active', addEventListener: () => ({remove() {}})}, useTVEventHandler() {}};
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
    './model': shellModel, './tv-focus': tvFocus};
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
    './NativePlaybackLayer': {NativePlaybackLayer: () => React.createElement(Lifetime, {kind: 'playback'})}});
  let shellSnapshot = {authority, destination: {kind: 'home'}, libraries: [{id: 'read', name: 'Read', kind: 'books'}, {id: 'movie', name: 'Movies', kind: 'movie'}],
    hasLiveTV: true, profile, homeVisible: true, mediaExpanded: false, homeObscured: false, selectionActive: false, account: {viewerRole: 'owner'}};
  const shellListeners = new Set();
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
  const runtime = {getSnapshot: () => shellSnapshot, subscribe: fn => {shellListeners.add(fn); return () => shellListeners.delete(fn);},
    memory: {read: async () => undefined, remember: async () => {}}, reportError: error => {throw error;},
    scrollToTop: () => {scrollRequests++;}, onDestination: destination => {shellSnapshot = {...shellSnapshot, destination}; for (const fn of shellListeners) fn();},
    registerScrollToTop: (destination, move) => {anchors.set(destination.kind, move); return () => anchors.delete(destination.kind);},
    renderDestination: () => React.createElement(Page, {ref: pageRef}), renderRoutes: () => null, renderSelection: () => null,
    home: {subscribe: () => () => {}, getSnapshot: () => homeSnapshot, load: async () => {loads++;}},
    artwork: () => undefined, ambient: () => undefined, heroArt: () => undefined, onArtworkError() {}, libraryMenu: () => ({}),
    text: {t: defaultI18n.t, locale: 'en-US'}, actions: {customize() {}}, playback: {}};
  function Probe() {
    return React.createElement('SizeProbe', {sizeClass: theme.useSizeClass(), platform: theme.useTheme().platform, isTV: theme.useTheme().isTV});
  }
  const tree = () => React.createElement(theme.ThemeProvider, null, React.createElement(Probe), React.createElement(NativeShell, {runtime}));
  const flatten = style => Array.isArray(style) ? Object.assign({}, ...style.map(flatten)) : style ?? {};
  let renderer;
  return {theme, TouchNavigation, runtime, lifetimes, pageRef, anchors,
    get loads() {return loads;}, get scrollRequests() {return scrollRequests;}, get listenerCount() {return dimensionListeners.size;},
    get root() {return renderer.root;}, get renderer() {return renderer;}, flatten,
    async mount() {await act(async () => {renderer = create(tree(), {createNodeMock: element => ({testID: element.props.testID, scrollY: 0, scrollTo({y}) {this.scrollY = y;}})});});},
    async resize(next, nextInsets) {await act(async () => {window = {...window, ...next}; for (const fn of [...dimensionListeners]) fn({window});
      if (nextInsets) {insets = {...insets, ...nextInsets}; for (const fn of [...insetListeners]) fn();}});},
    async navigate(kind) {await act(async () => runtime.onDestination({kind}));},
    async press(id) {await act(async () => renderer.root.findAllByType('Focusable').find(node => node.props.testID === id).props.onPress());},
    async dispose() {await act(async () => renderer.unmount()); assert.equal(dimensionListeners.size, 0); assert.equal(insetListeners.size, 0);},
  };
}

const byID = (f, id) => f.root.findAll(node => typeof node.type === 'string' && node.props.testID === id);
const assertClass = (f, sizeClass, chrome) => {
  assert.equal(f.root.findByType('SizeProbe').props.sizeClass, sizeClass);
  for (const id of ['phone-tab-bar', 'touch-rail', 'touch-sidebar']) assert.equal(byID(f, id).length, id === chrome ? 1 : 0, id);
};

function captureChrome(f, width, name) {
  const directory = process.env.PORTICO_SIZE_SHELL_CAPTURE_DIR;
  if (!directory) return;
  mkdirSync(directory, {recursive: true});
  const chrome = f.root.findAll(node => typeof node.type === 'string' && ['phone-tab-bar', 'touch-rail', 'touch-sidebar'].includes(node.props.testID))[0];
  const serialize = node => {
    if (typeof node === 'string') return [node];
    const nested = node.children.flatMap(serialize);
    if (typeof node.type !== 'string') return nested;
    return [{type: node.type,
      props: Object.fromEntries(['style', 'contentContainerStyle', 'testID', 'name', 'size', 'color', 'accessibilityLabel'].filter(key => key in node.props).map(key => [key, node.props[key]])),
      children: nested}];
  };
  // Host-only subtree, excluding React elements held in render props and refs.
  writeFileSync(`${directory}/${name}.json`, JSON.stringify({width, height: 900, tree: serialize(chrome)[0]}, null, 2));
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
