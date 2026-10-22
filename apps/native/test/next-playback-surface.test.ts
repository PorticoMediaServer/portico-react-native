import test from 'node:test';
import assert from 'node:assert/strict';
import * as React from 'react';
import {sameFence, type PlaybackFence} from '../../../packages/player-core/src/index.ts';
import {currentMorphFence} from '../src-next/kit/dock/morph-fence.ts';
import {releaseDock, validRect} from '../src-next/kit/dock/model.ts';
import {act, createHookHost} from './hook-driver.ts';
import {screenModule} from './helpers/screen-harness.mjs';

// Runs the real factory/Surface and PlayerMorph with controlled native hosts,
// external-store delivery and animation callbacks. This is prop/lifecycle proof;
// Android layout, SurfaceFlinger visibility and pixels require device evidence.
const fence: PlaybackFence = {kind: 'queue', playback: {scope: {serverId: 'server', authority: 'local', accountId: 'account', profileId: 'profile', controllerId: 'controller', controllerEpoch: 'epoch', commandLaneId: 'lane'}, run: 1},
  sessionId: 'session', sourceId: 'source', itemId: 'item', entryId: 'entry', generation: 1};
const frame = {x: 0, y: 0, width: 1920, height: 1080};
const dockFrame = {x: 12, y: 720, width: 160, height: 90};
const flatten = (style: any): Record<string, any> => Array.isArray(style) ? Object.assign({}, ...style.map(flatten)) : style ?? {};
function mount(component: any, initial: any) {
  let props = initial, tree: any;
  const host = createHookHost(() => {tree = component(props);});
  host.mount();
  return {host, get tree() {return tree;}, update(next: any) {props = next; host.rerender();}};
}

async function surfaceFixture() {
  let snapshot: any = {engine: 'native', lease: '', fence: undefined};
  let attachments = 0, detachments = 0, subscriptions = 0;
  const listeners = new Set<() => void>(), tags: {owner: object; tag: number | null}[] = [], subtitles: boolean[] = [], requested: string[] = [];
  const runtime = {
    subscribe: (listener: () => void) => {subscriptions++; listeners.add(listener); return () => {subscriptions--; listeners.delete(listener);};},
    getSnapshot: () => snapshot,
    attachSurface: (_owner: object) => {attachments++; return () => {detachments++;};},
    setSurfaceTag: (owner: object, tag: number | null) => {tags.push({owner, tag});},
    setSubtitleDisplay: (visible: boolean) => {subtitles.push(visible);},
    installSnapshotCapture() {},
  };
  const {createNativeShellPlaybackAdapter} = await screenModule(new URL('../src-next/platform/playback/native.tsx', import.meta.url), {
    react: {...React, default: React},
    'react-native': {
      AppState: {addEventListener: () => ({remove() {}})}, Dimensions: {get: () => ({width: 1920, height: 1080})},
      NativeEventEmitter: class {addListener() {return {remove() {}};}},
      NativeModules: {PorticoPlaybackModule: {}, PorticoRuntime: {playbackRequestId: () => 'request'}},
      Platform: {OS: 'android', isTV: true, Version: 35, constants: {}},
      UIManager: {hasViewManagerConfig: () => true}, findNodeHandle: (node: {tag: number}) => node.tag,
      requireNativeComponent: (name: string) => {requested.push(name); return name;},
    },
    '../../../../../packages/client-core/src/playback-v1/options': {CapabilityPublisher: class {async publish() {}}},
    '../../../../../packages/client-core/src/playback-v1/local-http': {localV1Http: () => ({})},
    '../../../../../packages/client-core/src/presentation/service-text': {serviceText: (key: string) => key},
    './engine-choice': {chooseEngine() {}, parseEngineFeatures: () => ({})},
    './engine-media': {planEngineOf() {}, requiredSubtitleRendering() {}},
    './capability-document': {deviceCapabilityDocument: () => ({})},
    './NativeListeningAdapter': {}, './runtime': {NativePlaybackRuntime: class {constructor() {return runtime;}}},
    './scope-http': {PlaybackScopeHttp: class {}}, '../video-snapshot': {createVideoSnapshotCapture: () => ({})},
  });
  const adapter = createNativeShellPlaybackAdapter({
    appVersion: 'test', api: {}, session: () => ({viewer: {authority: 'local', profileId: 'profile'}}),
    authority: () => ({serverId: 'server', accountId: 'account', profileId: 'profile', epoch: 'epoch', viewerFence: 'viewer'}),
    subscribeSettings: () => () => {}, settings: () => ({engine: 'native'}),
  });
  return {adapter, tags, subtitles, requested, get attachments() {return attachments;}, get detachments() {return detachments;}, get subscriptions() {return subscriptions;},
    async publish(next: any) {snapshot = next; await act(() => {for (const listener of listeners) listener();});},
  };
}

test('the actual native host hides on close before lease release and keeps its type/ref/owner for the next source', async () => {
  const d = await surfaceFixture();
  const props = {expandedBounds: frame, dockBounds: dockFrame, docked: false, subtitlesVisible: true};
  const surface = mount(d.adapter.Surface, props);
  const type = surface.tree.type, ref = surface.tree.props.ref;
  ref({tag: 71});
  try {
    assert.equal(flatten(surface.tree.props.style).display, 'none', 'idle hiding must reach the native host itself');
    assert.equal(surface.tree.props.lease, '');
    await d.publish({engine: 'native', lease: 'actual-lease', fence});
    assert.equal(flatten(surface.tree.props.style).display, 'flex');
    assert.equal(surface.tree.props.lease, 'actual-lease');
    surface.update({...props, docked: true, subtitlesVisible: false});
    assert.equal(flatten(surface.tree.props.style).width, dockFrame.width);
    assert.equal(d.subtitles.at(-1), false);
    // Runtime close can publish fence-less idle before the async coordinator
    // releases its old lease. Neither publication may leave a black host visible.
    await d.publish({engine: 'native', lease: 'actual-lease', fence: undefined});
    assert.equal(flatten(surface.tree.props.style).display, 'none');
    await d.publish({engine: 'native', lease: '', fence: undefined});
    assert.equal(flatten(surface.tree.props.style).display, 'none');
    const next = {...fence, sessionId: 'session-next', generation: 2};
    await d.publish({engine: 'native', lease: '', fence: next});
    assert.equal(flatten(surface.tree.props.style).display, 'none');
    await d.publish({engine: 'native', lease: 'next-lease', fence: next});
    assert.equal(flatten(surface.tree.props.style).display, 'flex');
    assert.strictEqual(surface.tree.type, type);
    assert.strictEqual(surface.tree.props.ref, ref);
    assert.equal(surface.tree.key, null);
    assert.equal(d.attachments, 1);
    assert.equal(d.detachments, 0);
    assert.equal(d.subscriptions, 1);
    assert.deepEqual(d.requested, ['PorticoPlayer']);
    assert.equal(d.tags.length, 1);
  } finally {ref(null); surface.host.unmount();}
  assert.strictEqual(d.tags[0]!.owner, d.tags[1]!.owner);
  assert.deepEqual(d.tags.map(value => value.tag), [71, null]);
  assert.equal(d.detachments, 1);
  assert.equal(d.subscriptions, 0);
});

test('a leased native host stays hidden for missing or invalid target bounds', async () => {
  const d = await surfaceFixture();
  await d.publish({engine: 'native', lease: 'actual-lease', fence});
  const props = {expandedBounds: frame, docked: false, subtitlesVisible: false};
  const surface = mount(d.adapter.Surface, props);
  try {
    assert.equal(flatten(surface.tree.props.style).display, 'flex');
    surface.update({...props, docked: true});
    assert.equal(flatten(surface.tree.props.style).display, 'none');
    for (const bounds of [{...frame, width: 0}, {...frame, height: -1}, {...frame, x: NaN}, {...frame, width: Infinity}]) {
      surface.update({...props, expandedBounds: bounds});
      assert.equal(flatten(surface.tree.props.style).display, 'none');
      for (const key of ['left', 'top', 'width', 'height']) assert.equal(Number.isFinite(flatten(surface.tree.props.style)[key]), true);
    }
    surface.update(props);
    assert.equal(flatten(surface.tree.props.style).display, 'flex');
    assert.equal(d.attachments, 1);
  } finally {surface.host.unmount();}
});

test('PlayerMorph projects close to its existing wrapper/child and rejects late settlement from the closed source', async () => {
  const reactions: ((value: any, previous: any) => void)[] = [];
  const {PlayerMorph} = await screenModule(new URL('../src-next/kit/dock/PlayerMorph.tsx', import.meta.url), {
    react: {...React, default: React}, 'react-native': {Platform: {OS: 'android'}, View: 'View'},
    'react-native-gesture-handler': {Gesture: {}},
    'react-native-reanimated': {default: {View: 'AnimatedView'}, useSharedValue: (value: any) => React.useRef({value}).current,
      useAnimatedStyle: (fn: () => any) => fn(), useAnimatedReaction: (_prepare: any, react: any) => {reactions.push(react);},
      cancelAnimation() {}, runOnJS: (fn: any) => fn, withTiming: (value: any) => value},
    '../../../../../packages/player-core/src/index': {}, '../Icon': {Icon: 'Icon'},
    '../theme': {useTheme: () => ({layers: {player: 30}, colors: {shadow: '#000', dim: '#000'}})},
    '../useMotion': {useMotion: () => ({reduce: false, transforms: true, timing: () => ({duration: 180})})},
    './morph-fence': {currentMorphFence}, './model': {releaseDock, validRect}, './visual': {alpha: () => '#000', dockStyles: {fill: {position: 'absolute', inset: 0}}},
  });
  const child = React.createElement('PersistentNativeSurface'), presentations: any[] = [], contexts: any[] = [];
  const props = {controller: {progress: {value: 0}, velocity: {value: 0}, dragging: {value: false}},
    fence: undefined as PlaybackFence | undefined, docked: false, fullFrame: frame, dockFrame,
    children: (context: any) => {contexts.push(context); return child;}, onPresentationChange: (value: any) => {presentations.push(value);}};
  const morph = mount(PlayerMorph, props);
  const childOf = () => morph.tree.props.children[0].props.children[0];
  try {
    assert.equal(flatten(morph.tree.props.style).display, 'none');
    assert.equal(contexts.at(-1).active, false);
    assert.strictEqual(childOf(), child);
    await act(() => morph.update({...props, fence}));
    assert.equal(flatten(morph.tree.props.style).display, 'flex');
    assert.equal(contexts.at(-1).active, true);
    const late = reactions.at(-1)!;
    await act(() => morph.update(props));
    const count = presentations.length;
    await act(() => late({active: true, p: 1, v: 0, drag: false, goal: 1}, {active: true, p: .5, v: .1, drag: false, goal: 1}));
    assert.equal(flatten(morph.tree.props.style).display, 'none');
    assert.equal(contexts.at(-1).active, false);
    assert.equal(presentations.length, count);
    assert.strictEqual(childOf(), child);
    const next = {...fence, sessionId: 'next-session', generation: 2};
    await act(() => morph.update({...props, fence: next}));
    assert.equal(sameFence(presentations.at(-1).fence, next), true);
    assert.equal(flatten(morph.tree.props.style).display, 'flex');
    assert.strictEqual(childOf(), child);
  } finally {morph.host.unmount();}
});
