import {expandedListeningOccupant} from '../../src-next/shell/listening-presentation.ts';
import {listeningCoverFixture} from './screen-harness.mjs';
import {defaultI18n} from '../../../../packages/i18n/src/index.ts';
import * as signalPath from '../../src-next/screens/destinations/music/signal-path-model.ts';
import {nativeEqualizer} from '../../platform/equalizer.ts';
import {listeningNoticeKey} from '../../../../packages/client-core/src/audio-effects.ts';
import {readFile} from 'node:fs/promises';
import {createRequire} from 'node:module';
import {compileFunction} from 'node:vm';
import {dirname, join} from 'node:path';
import {surfacePaintFixture, screenModule} from './screen-harness.mjs';
import {offlineDownloads} from '../../platform/offline-downloads.ts';
import * as model from '../../src-next/kit/dock/model.ts';
import {currentMorphFence} from '../../src-next/kit/dock/morph-fence.ts';
import {playerPostureCrossFadeMs} from '../../src-next/platform/layout/player-presentation.ts';
import {sameFence} from '../../../../packages/player-core/src/index.ts';
import {NativeVideoSnapshotCapture} from '../../src-next/shell/video-snapshot.ts';
import {sameAuthority} from '../../src-next/shell/model.ts';
import {bindNativeDock} from '../../src-next/kit/dock/native-binding.ts';
import {nativeShellBackTransition} from '../../src-next/shell/playback.ts';
import * as watchSlotLayout from '../../src-next/shell/watch-slot-layout.ts';
import * as shellModel from '../../src-next/shell/model.ts';
import * as tvFocus from '../../src-next/shell/tv-focus.ts';
import {createFocusRegistry} from '../../src-next/kit/focus/registry.ts';
const require = createRequire(import.meta.url);
const React = require(join(dirname(require.resolve('react')), 'cjs/react.production.js'));

// Real production Fabric store commit checks and nested-update accounting.
// Native hosts and animation clocks alone are controlled; no parent rerender pump.
export async function fabricPlayback(runtime, tv = true, watch, withShell = false) {
  const errors = [], commits = [], nativeProps = [], callbacks = [], containers = [];
  let captureClears = 0;
  class Capture extends NativeVideoSnapshotCapture {
    clear() {captureClears++; return super.clear();}
  }
  const exports = {};
  const privateInterface = {ReactNativeViewConfigRegistry: {get: () => ({})}, createPublicRootInstance: () => ({}),
    RawEventEmitter: {emit() {}}, ReactFiberErrorDialog: {showErrorDialog: () => true}};
  const fabric = {createChildSet: () => [], appendChildToSet: (set, child) => set.push(child),
    completeRoot: () => commits.push(runtime.getSnapshot()), unstable_getCurrentEventPriority: () => 32};
  const rendererPath = require.resolve('react-native/Libraries/Renderer/implementations/ReactFabric-prod.js');
  compileFunction(await readFile(rendererPath, 'utf8'), ['require', 'exports', 'nativeFabricUIManager'])(
    name => name.endsWith('ReactNativePrivateInitializeCore') ? {} : name.endsWith('ReactNativePrivateInterface') ? privateInterface : name === 'react' ? React : require(name), exports, fabric);
  const react = {...React, default: React};
  const Container = props => {
    containers.push(props);
    const {children, ref} = props;
    React.useLayoutEffect(() => {
      if (!ref || typeof ref !== 'object') return;
      ref.current = {measureInWindow: callback => callback(0, 0)};
      return () => {ref.current = null;};
    }, [ref]);
    return React.createElement(React.Fragment, null, children);
  };
  const animated = {default: {View: Container}, useSharedValue: value => React.useRef({value}).current, useAnimatedStyle: fn => fn(), useAnimatedReaction: (prepare, reaction) => {
      const previous = React.useRef(null);
      React.useEffect(() => {const value = prepare(); reaction(value, previous.current); previous.current = value;});
    },
    cancelAnimation() {}, runOnJS: fn => fn, runOnUI: fn => fn, withDelay: (_ms, value) => value,
    withTiming: (value, _config, finish) => {if (finish) callbacks.push(() => finish(true)); return value;},
    withSpring: (value, _config, finish) => {if (finish) callbacks.push(() => finish(true)); return value;}};
  const pan = () => new Proxy({}, {get: (_target, name) => name === 'then' ? undefined : () => pan()});
  const theme = {isTV: tv, layers: {player: 30, navigation: 20, menu: 40}, colors: {ink: '#000', shadow: '#000', dim: '#000'}, layout: {gutter: {tvRight: 96}}};
  const motion = {reduce: false, transforms: true, timing: () => ({duration: 180}), spring: () => ({damping: 20})};
  let window = {width: 1920, height: 1080};
  const dimensionListeners = new Set();
  const subscribeDimensions = listener => {dimensionListeners.add(listener); return () => dimensionListeners.delete(listener);};
  const currentDimensions = () => window;
  const native = {View: Container, Image: () => null, Platform: {OS: 'android', isTV: tv, Version: 35, constants: {}},
    BackHandler: {addEventListener: () => ({remove() {}})}, useWindowDimensions: () => React.useSyncExternalStore(subscribeDimensions, currentDimensions)};
  const common = {react, 'react-native': native, 'react-native-reanimated': animated, 'react-native-gesture-handler': {Gesture: {Pan: pan}, GestureDetector: Container},
    '../../../../../packages/player-core/src/index': {sameFence}, '../theme': {useTheme: () => theme}, '../useMotion': {useMotion: () => motion},
    '../Icon': {Icon: () => null}, './model': model, './morph-fence': {currentMorphFence}, './visual': {alpha: () => '#000', dockStyles: {fill: {}}}};
  const {usePlayerMorph, PlayerMorph} = await screenModule(new URL('../../src-next/kit/dock/PlayerMorph.tsx', import.meta.url), {...common, '../../platform/layout/player-presentation': {playerPostureCrossFadeMs}});
  const {useDockPresence} = await screenModule(new URL('../../src-next/kit/dock/useDockPresence.ts', import.meta.url), common);
  const {DockHost} = await screenModule(new URL('../../src-next/kit/dock/DockHost.tsx', import.meta.url), {...common,
    'react-native-safe-area-context': {useSafeAreaInsets: () => ({bottom: 0})}, './MediaBar': {MediaBar: () => null}, './NowPlayingCard': {NowPlayingCard: () => null},
    './DockNotice': {DockNotice: () => null}, './DockClearance': {useDockClearanceReport() {}}, './useDockPresence': {useDockPresence}});
  const NativeHost = props => {
    nativeProps.push(props);
    const {ref} = props;
    React.useLayoutEffect(() => {ref?.({tag: 71}); return () => ref?.(null);}, [ref]);
    return null;
  };
  const dynamicRange = await screenModule(new URL('../../src-next/platform/playback/dynamic-range-matching.ts', import.meta.url), {react, 'react-native': {Platform: {OS: 'android', isTV: true}, NativeModules: {PorticoPlaybackModule: {}}}});
  const {createNativeShellPlaybackAdapter} = await screenModule(new URL('../../src-next/platform/playback/native.tsx', import.meta.url), {
    react, 'react-native': {...native, AppState: {addEventListener: () => ({remove() {}})}, Dimensions: {get: () => ({width: 1920, height: 1080})},
      NativeEventEmitter: class {addListener() {return {remove() {}};}}, NativeModules: {PorticoPlaybackModule: {}, PorticoRuntime: {playbackRequestId: () => 'request'}},
      UIManager: {hasViewManagerConfig: () => true}, findNodeHandle: node => node.tag, requireNativeComponent: () => NativeHost},
    '../../../../../packages/client-core/src/playback-v1/options': {CapabilityPublisher: class {async publish() {}}},
    '../../../../../packages/client-core/src/playback-v1/local-http': {localV1Http: () => ({})},
    '../../../../../packages/client-core/src/presentation/service-text': {serviceText: key => key},
    './dynamic-range-matching': dynamicRange,
    './engine-choice': {chooseEngine() {}, parseEngineFeatures: () => ({})}, './engine-media': {planEngineOf() {}, requiredSubtitleRendering() {}},
    './capability-document': {deviceCapabilityDocument: () => ({})}, './NativeListeningAdapter': {},
    '../../../platform/offline-downloads': {offlineDownloads},
    './runtime': {NativePlaybackRuntime: class {constructor() {return runtime;}}}, './scope-http': {PlaybackScopeHttp: class {}},
    '../video-snapshot': {createVideoSnapshotCapture: () => ({cancel() {}, dispose() {}})}});
  const adapter = createNativeShellPlaybackAdapter({appVersion: 'test', api: {},
    session: () => ({viewer: {authority: 'local', profileId: 'profile'}}), authority: () => runtime.getSnapshot().authority,
    subscribeSettings: () => () => {}, settings: () => ({engine: 'native'})});
  const signalFacts = await screenModule(new URL('../../src-next/screens/destinations/music/signal-facts.ts', import.meta.url), {react, 'react-native': native});
  const signalView = await screenModule(new URL('../../src-next/screens/destinations/music/MusicSignal.tsx', import.meta.url), {react, 'react-native': native, '../../../../../../packages/i18n/src': {defaultI18n}, '../../../kit/Icon': {Icon: 'Icon'}, '../../../kit/controls': {Focusable: 'Focusable'}, '../../../kit/theme': {useTheme: () => theme, nativeType: () => ({})}, './signal-path-model': signalPath});
  const {NativePlaybackLayer} = await screenModule(new URL('../../src-next/shell/NativePlaybackLayer.tsx', import.meta.url), {
    '../kit/dock/DockClearance': {DockClearanceProvider: 'DockClearanceProvider'},
    '../kit/dock/InitialPicturePresentation': {InitialPicturePresentation: 'InitialPicturePresentation'},
    '../kit/dock/initial-picture-model': {initialPictureKey: () => 'initial-picture'},
    './listening-presentation': {expandedListeningOccupant},
    '../kit/dock/ListeningCoverBridge': listeningCoverFixture,
    '../kit/dock/PlayerMorphBridge': {PlayerMorphProvider: 'PlayerMorphProvider', useInitialPlayerPagePaint: () => undefined, usePlayerMorphPublication() {}},...common,
    '../../../../packages/player-core/src': {sameFence}, '../kit/theme': {useTheme: () => theme}, '../kit/focus': {focusTestID: () => 'playback'}, './tv-focus': {tvFocusIds: () => ({surface: () => 'playback'})},
    '../screens/destinations/music/NowPlayingScreen': {NowPlayingScreen: 'NowPlayingScreen'},
    '../screens/destinations/music/NowPlayingLyrics': {NowPlayingLyrics: 'NowPlayingLyrics'},
    '../screens/destinations/music/ListeningNotice': {NativeListeningNotice: 'ListeningNotice'},
    '../screens/destinations/music/MusicSignal': signalView, '../screens/destinations/music/signal-facts': signalFacts,
    '../platform/playback/equalizer': {nativeEqualizer}, '../../../../packages/client-core/src/audio-effects': {listeningNoticeKey},
    '../kit/dock': {DockHost, PlayerMorph, usePlayerMorph, bindNativeDock},
    '../kit/dock/model': model,
    '../kit/dock/model.ts': model,
    '../../../../packages/client-core/src/presentation/kit-model': {playbackIdentity: () => ({id: 'item', kind: 'video', title: 'Film', subtitle: []})},
    './model': {sameAuthority}, './playback': {nativeShellBackTransition}, './video-snapshot': {NativeVideoSnapshotCapture: Capture}, './watch-slot-layout': watchSlotLayout});
  const shell = {reportError: error => errors.push(error), text: {}, artwork() {}, ambient() {}, getSnapshot: () => ({}), watch};
  const chrome = {mounts: 0, unmounts: 0, renders: 0};
  function WatchProbe() {
    chrome.renders++;
    React.useEffect(() => {chrome.mounts++; return () => {chrome.unmounts++;};}, []);
    return null;
  }
  let NativeShell;
  if (withShell) {
    // The actual shell/wrapper/layer reconcile together. Home, menus and native
    // hosts remain controlled; this does not establish genuine App entry/UI.
    const snapshot = {authority: runtime.getSnapshot().authority, destination: {kind: 'home'}, libraries: [], profile: {}, account: {},
      selectionActive: false, homeVisible: true, mediaExpanded: true};
    Object.assign(shell, {getSnapshot: () => snapshot, subscribe: () => () => {}, playback: adapter,
      memory: {read: async () => undefined}, renderRoutes: () => null, renderSelection: () => null, renderDestination: () => null,
      renderWatch: () => React.createElement(WatchProbe)});
    const registry = createFocusRegistry(), Empty = () => null;
    ({NativeShell} = await screenModule(new URL('../../src-next/shell/NativeShell.tsx', import.meta.url), {
    '../kit/overlays/SurfacePaintHost': surfacePaintFixture,
    '../kit/dock/DockClearance': {DockClearanceProvider: 'DockClearanceProvider'},
    './listening-presentation': {expandedListeningOccupant},
    '../kit/dock/ListeningCoverBridge': listeningCoverFixture,
    '../kit/dock/PlayerMorphBridge': {PlayerMorphProvider: 'PlayerMorphProvider', useInitialPlayerPagePaint: () => undefined, usePlayerMorphPublication() {}},...common,
      'react-native-safe-area-context': {useSafeAreaInsets: () => ({bottom: 0})},
      '../kit/overlays': {OverlaysProvider: Container}, '../kit/shell': {AccountMenu: Empty}, '../kit/browse': {},
      '../kit/theme': {useTheme: () => theme}, '../kit/useMotion': {useMotion: () => motion},
      '../kit/focus': {useFocusRegistry: () => registry}, './tv-focus': tvFocus, './model': shellModel,
      '../screens/home/HomeScreen': {HomeScreen: Empty}, './NativePlaybackLayer': {NativePlaybackLayer},
      './PhoneTabBar': {PhoneTabBar: Empty}, './MediumRail': {MediumRail: Empty}, './chrome': {nativeScreenChromeHidden: () => false, subscribeNativeScreenChrome: () => () => {}}, './PhoneHomeHeader': {PhoneHomeHeader: Empty}, './DesktopHeader': {DesktopHeader: Empty},
      './TVRail': {TVRail: Empty}, './TVProfileMenu': {TVProfileMenu: Empty}}));
  }
  let parentRenders = 0;
  function Parent() {parentRenders++; return withShell ? React.createElement(NativeShell, {runtime: shell})
    : React.createElement(NativePlaybackLayer, {adapter, runtime: shell, authority: runtime.getSnapshot().authority});}
  const settle = async () => {for (let n = 0; n < 12; n++) await new Promise(resolve => setImmediate(resolve)); if (errors.length) throw errors[0];};
  exports.render(React.createElement(Parent), 11, undefined, true, {onUncaughtError: error => errors.push(error), onCaughtError: error => errors.push(error), onRecoverableError: error => errors.push(error)});
  try {await settle();} catch (error) {exports.stopSurface(11); throw error;}
  return {adapter, commits, nativeProps, callbacks, errors, settle, get parentRenders() {return parentRenders;},
    chrome, get watchWrapper() {return containers.findLast(props => props.children?.type === WatchProbe);},
    get captureClears() {return captureClears;},
    async resize(width, height) {window = {width, height}; for (const listener of dimensionListeners) listener(); await settle();},
    async unmount() {exports.stopSurface(11); await settle();}};
}
