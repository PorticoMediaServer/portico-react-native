import {readFile} from 'node:fs/promises';
import {createRequire} from 'node:module';
import {compileFunction} from 'node:vm';
import {dirname, join} from 'node:path';
import {screenModule} from './screen-harness.mjs';
import * as model from '../../src-next/kit/dock/model.ts';
import {currentMorphFence} from '../../src-next/kit/dock/morph-fence.ts';
import {playerPostureCrossFadeMs} from '../../src-next/platform/layout/player-presentation.ts';
import {sameFence} from '../../../../packages/player-core/src/index.ts';
import {NativeVideoSnapshotCapture} from '../../src-next/shell/video-snapshot.ts';
import {sameAuthority} from '../../src-next/shell/model.ts';
import {bindNativeDock} from '../../src-next/kit/dock/native-binding.ts';
import {nativeShellBackTransition} from '../../src-next/shell/playback.ts';
import * as watchSlotLayout from '../../src-next/shell/watch-slot-layout.ts';
const require = createRequire(import.meta.url);
const React = require(join(dirname(require.resolve('react')), 'cjs/react.production.js'));

// Real production Fabric store commit checks and nested-update accounting.
// Native hosts and animation clocks alone are controlled; no parent rerender pump.
export async function fabricPlayback(runtime, tv = true, watch) {
  const errors = [], commits = [], nativeProps = [], callbacks = [];
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
  const Container = ({children, ref}) => {
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
  const theme = {isTV: tv, layers: {player: 30}, colors: {shadow: '#000', dim: '#000'}, layout: {gutter: {tvRight: 96}}};
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
    './DockNotice': {DockNotice: () => null}, './useDockPresence': {useDockPresence}});
  const NativeHost = props => {
    nativeProps.push(props);
    const {ref} = props;
    React.useLayoutEffect(() => {ref?.({tag: 71}); return () => ref?.(null);}, [ref]);
    return null;
  };
  const {createNativeShellPlaybackAdapter} = await screenModule(new URL('../../src-next/platform/playback/native.tsx', import.meta.url), {
    react, 'react-native': {...native, AppState: {addEventListener: () => ({remove() {}})}, Dimensions: {get: () => ({width: 1920, height: 1080})},
      NativeEventEmitter: class {addListener() {return {remove() {}};}}, NativeModules: {PorticoPlaybackModule: {}, PorticoRuntime: {playbackRequestId: () => 'request'}},
      UIManager: {hasViewManagerConfig: () => true}, findNodeHandle: node => node.tag, requireNativeComponent: () => NativeHost},
    '../../../../../packages/client-core/src/playback-v1/options': {CapabilityPublisher: class {async publish() {}}},
    '../../../../../packages/client-core/src/playback-v1/local-http': {localV1Http: () => ({})},
    '../../../../../packages/client-core/src/presentation/service-text': {serviceText: key => key},
    './engine-choice': {chooseEngine() {}, parseEngineFeatures: () => ({})}, './engine-media': {planEngineOf() {}, requiredSubtitleRendering() {}},
    './capability-document': {deviceCapabilityDocument: () => ({})}, './NativeListeningAdapter': {},
    './runtime': {NativePlaybackRuntime: class {constructor() {return runtime;}}}, './scope-http': {PlaybackScopeHttp: class {}},
    '../video-snapshot': {createVideoSnapshotCapture: () => ({cancel() {}, dispose() {}})}});
  const adapter = createNativeShellPlaybackAdapter({appVersion: 'test', api: {},
    session: () => ({viewer: {authority: 'local', profileId: 'profile'}}), authority: () => runtime.getSnapshot().authority,
    subscribeSettings: () => () => {}, settings: () => ({engine: 'native'})});
  const {NativePlaybackLayer} = await screenModule(new URL('../../src-next/shell/NativePlaybackLayer.tsx', import.meta.url), {...common,
    '../../../../packages/player-core/src': {sameFence}, '../kit/theme': {useTheme: () => theme}, '../kit/focus': {focusTestID: () => 'playback'}, './tv-focus': {tvFocusIds: () => ({surface: () => 'playback'})},
    '../kit/dock': {DockHost, PlayerMorph, usePlayerMorph, bindNativeDock},
    '../../../../packages/client-core/src/presentation/kit-model': {playbackIdentity: () => ({id: 'item', kind: 'video', title: 'Film', subtitle: []})},
    './model': {sameAuthority}, './playback': {nativeShellBackTransition}, './video-snapshot': {NativeVideoSnapshotCapture: Capture}, './watch-slot-layout': watchSlotLayout});
  const shell = {reportError: error => errors.push(error), text: {}, artwork() {}, ambient() {}, getSnapshot: () => ({}), watch};
  let parentRenders = 0;
  function Parent() {parentRenders++; return React.createElement(NativePlaybackLayer, {adapter, runtime: shell, authority: runtime.getSnapshot().authority});}
  const settle = async () => {for (let n = 0; n < 12; n++) await new Promise(resolve => setImmediate(resolve)); if (errors.length) throw errors[0];};
  exports.render(React.createElement(Parent), 11, undefined, true, {onUncaughtError: error => errors.push(error), onCaughtError: error => errors.push(error), onRecoverableError: error => errors.push(error)});
  try {await settle();} catch (error) {exports.stopSurface(11); throw error;}
  return {adapter, commits, nativeProps, callbacks, errors, settle, get parentRenders() {return parentRenders;},
    get captureClears() {return captureClears;},
    async resize(width, height) {window = {width, height}; for (const listener of dimensionListeners) listener(); await settle();},
    async unmount() {exports.stopSurface(11); await settle();}};
}
