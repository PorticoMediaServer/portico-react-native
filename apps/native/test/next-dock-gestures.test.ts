import test from 'node:test';
import assert from 'node:assert/strict';
import * as React from 'react';
import {PlaybackDock, sameFence, type DockPlayback, type QueuePlaybackFence, type QueueScope} from '../../../packages/player-core/src/index.ts';
import {defaultI18n} from '../../../packages/i18n/src/index.ts';
import * as model from '../src-next/kit/dock/model.ts';
import {currentMorphFence} from '../src-next/kit/dock/morph-fence.ts';
import {act, createHookHost} from './hook-driver.ts';
import {screenModule as transformModule} from './helpers/screen-harness.mjs';

// The same tests can read an immutable git-show base mirror for red evidence.
const screenModule = (file: URL, modules: any) => transformModule(process.env.NATIVE_DOCK_BASE_DIR && file.pathname.includes('/src-next/')
  ? new URL('file://' + process.env.NATIVE_DOCK_BASE_DIR + file.pathname.slice(file.pathname.indexOf('/src-next/'))) : file, modules);

// Real hook/component bodies and gesture factory callbacks. Controlled UI/JS
// queues establish ownership, not RNGH native scheduling or actual motion.
const scope: QueueScope = {serverId: 'server', authority: 'local', accountId: 'account', profileId: 'profile', controllerId: 'controller', controllerEpoch: 'epoch', commandLaneId: 'lane'};
const fence: QueuePlaybackFence = {kind: 'queue', playback: {scope, run: 1}, sessionId: 'session', sourceId: 'source', itemId: 'item', entryId: 'entry', generation: 1};
const initial = {fence, kind: 'video', queue: null, positionSeconds: 75, playing: true, expanded: true} satisfies DockPlayback;
const authority = {serverId: 'server', accountId: 'account', profileId: 'profile', epoch: 1, viewerFence: 'viewer'};
type Animation = {to: any; complete?: (finished: boolean) => void; apply?: () => void; owner?: any; cancelled?: boolean};
function elements(node: any): any[] {
  if (Array.isArray(node)) return node.flatMap(elements);
  return React.isValidElement<any>(node) ? [node, ...elements(node.props.children)] : [];
}
async function rig({reduced = false, docked = false, kind = 'video', os = 'android', tv = false}: {reduced?: boolean; docked?: boolean; kind?: 'video' | 'music'; os?: string; tv?: boolean} = {}) {
  const animations: Animation[] = [], cancelled: any[] = [], js: (() => void)[] = [], actions: any[] = [], transitions: any[] = [], requests: number[] = [];
  const reactions: any[] = [], measurements: any[] = [];
  let now = 0;
  const shared = (initialValue: any) => {
    const ref = React.useRef<any>(null);
    if (!ref.current) {
      let value = initialValue, pending: Animation | undefined;
      const cell = {get value() {return value;}, set value(next: any) {
        if (pending) pending.cancelled = true;
        pending = undefined;
        if (next && typeof next === 'object' && '__animation' in next) {
          pending = next; next.owner = cell; next.apply = () => {value = next.to;};
        } else value = next;
      }, cancel() {if (pending) pending.cancelled = true; pending = undefined;}};
      ref.current = cell;
    }
    return ref.current;
  };
  const animate = (to: any, _config: any, complete?: Animation['complete']) => {const value = {__animation: true, to, complete}; animations.push(value); return value;};
  const animated = {default: {View: 'AnimatedView'}, useSharedValue: shared, useAnimatedStyle: (read: () => any) => ({read}),
    withTiming: animate, withSpring: animate, withDelay: (_: any, animation: any) => animation,
    cancelAnimation: (value: any) => {cancelled.push(value); value.cancel?.();},
    runOnJS: (fn: (...args: any[]) => void) => (...args: any[]) => js.push(() => fn(...args)),
    useAnimatedReaction: (read: () => any, callback: (next: any, previous: any) => void) => {
      const cell = React.useRef<any>({previous: null}); cell.current.read = read; cell.current.callback = callback;
      React.useEffect(() => {reactions.push(cell.current); return () => {reactions.splice(reactions.indexOf(cell.current), 1);};}, []);
    },
  };
  const pan = () => {
    const callbacks: any = {}, config: any = {};
    const result: any = {callbacks, config};
    for (const name of ['onBegin', 'onStart', 'onUpdate', 'onEnd', 'onFinalize']) result[name] = (fn: any) => {callbacks[name] = fn; return result;};
    for (const name of ['activeOffsetX', 'activeOffsetY', 'failOffsetX', 'failOffsetY', 'enabled']) result[name] = (value: any) => {config[name] = value; return result;};
    return result;
  };
  const Gesture = {Pan: pan, Race: (...gestures: any[]) => ({gestures})};
  const motion = {reduce: reduced, transforms: !reduced, timing: () => ({duration: reduced ? 160 : 180}), spring: () => reduced ? undefined : {damping: 20}};
  const theme = {isTV: tv, layers: {player: 30}, colors: {text: '#fff', shadow: '#000'}, layout: {gutter: {tvRight: 96}}};
  const react = {...React, default: React};
  const native = {View: 'View', Text: 'Text', Image: 'Image', ActivityIndicator: 'ActivityIndicator', Platform: {OS: os, isTV: tv},
    NativeModules: {PorticoHaptics: {selection: async () => {requests.push(now); return true;}}},
    BackHandler: {addEventListener: () => ({remove() {}})}, useWindowDimensions: () => ({width: 400, height: 800})};
  const visual = {alpha: () => '#000', DockFacts: 'DockFacts', dockStyles: {fill: {position: 'absolute', inset: 0}}, dockType: () => ({})};
  const common = {react, 'react-native': native, 'react-native-reanimated': animated, 'react-native-gesture-handler': {Gesture, GestureDetector: 'GestureDetector'},
    '../../../../../packages/player-core/src/index': {sameFence}, '../theme': {useTheme: () => theme}, '../useMotion': {useMotion: () => motion},
    '../Icon': {Icon: 'Icon'}, './visual': visual, './model': model};
  const {selectionHaptic} = await screenModule(new URL('../src-next/platform/haptics.ts', import.meta.url), {react, 'react-native': native});
  const {usePlayerMorph, PlayerMorph} = await screenModule(new URL('../src-next/kit/dock/PlayerMorph.tsx', import.meta.url), {...common, './morph-fence': {currentMorphFence}});
  const {useDockPresence} = await screenModule(new URL('../src-next/kit/dock/useDockPresence.ts', import.meta.url), common);
  const {MediaBar} = await screenModule(new URL('../src-next/kit/dock/MediaBar.tsx', import.meta.url), {...common,
    '../../../../../packages/i18n/src/index': {defaultI18n}, '../../../../../packages/client-core/src/presentation/kit-model/text': {clockText: () => ''},
    '../artwork': {Artwork: 'Artwork'}, '../controls': {Button: 'Button', Focusable: 'Focusable'}, '../overlays': {Popover: 'Popover'},
    '../../platform/native-blur': {BlurView: 'BlurView'}, '../../platform/haptics': {selectionHaptic}});
  const {DockHost} = await screenModule(new URL('../src-next/kit/dock/DockHost.tsx', import.meta.url), {...common,
    'react-native-safe-area-context': {useSafeAreaInsets: () => ({bottom: 0})}, './MediaBar': {MediaBar}, './NowPlayingCard': {NowPlayingCard: 'NowPlayingCard'},
    './DockNotice': {DockNotice: 'DockNotice'}, './useDockPresence': {useDockPresence}});
  const dock = new PlaybackDock(scope); dock.start({...initial, kind, expanded: !docked});
  let snapshot: any;
  const Surface = () => null;
  const adapter = {dock, Surface, subscribe: () => () => {}, getSnapshot: () => snapshot, onTransition: async (transition: any) => {transitions.push(transition);}, captureVideoSnapshot: async () => undefined};
  const refresh = () => {const local = dock.getSnapshot().local; snapshot = {authority, dock: dock.getSnapshot(), fence: local?.fence,
    subject: {}, playback: {duration: 100, phase: 'playing'}, capabilities: {play: true, pause: true, stop: true, seek: true, previous: false, next: false, cast: false}};};
  refresh();
  const {NativePlaybackLayer} = await screenModule(new URL('../src-next/shell/NativePlaybackLayer.tsx', import.meta.url), {
    ...common, '../../../../packages/player-core/src': {sameFence}, '../kit/theme': {useTheme: () => theme},
    '../kit/dock': {DockHost, PlayerMorph, usePlayerMorph, bindNativeDock: () => async (command: any) => {actions.push(command);}},
    '../../../../packages/client-core/src/presentation/kit-model': {playbackIdentity: () => ({id: 'item', kind: 'video', title: 'Film', subtitle: []})},
    './model': {sameAuthority: (a: any, b: any) => JSON.stringify(a) === JSON.stringify(b)}, './playback': {nativeShellBackTransition: () => undefined},
    './video-snapshot': {NativeVideoSnapshotCapture: class {matches() {return true;} async clear() {} async prepare() {}}},
  });
  const runtime = {reportError: (error: any) => {throw error;}, text: {}, artwork() {}, ambient() {}};
  let tree: any, hostTree: any, barTree: any, pictureTree: any, hostProps: any, barProps: any, pictureProps: any;
  let barHost: ReturnType<typeof createHookHost> | undefined, closed = false;
  let extraPicture: any = {}, extraBar: any = {};
  const layerHost = createHookHost(() => {tree = NativePlaybackLayer({adapter, runtime, authority});
    elements(tree).find(node => node.props.testID === 'native-persistent-playback').props.ref.current = {measureInWindow: (cb: any) => cb(0, 0)};
  });
  const dockHost = createHookHost(() => {hostTree = DockHost(hostProps);});
  const pictureHost = createHookHost(() => {pictureTree = PlayerMorph({...pictureProps, ...extraPicture});});
  layerHost.mount();
  hostProps = elements(tree).find(node => node.type === DockHost).props; dockHost.mount();
  pictureProps = elements(tree).find(node => node.type === PlayerMorph).props; pictureHost.mount();
  async function sync() {
    await act(() => {});
    if (closed) return;
    hostProps = elements(tree).find(node => node.type === DockHost).props; dockHost.rerender();
    pictureProps = elements(tree).find(node => node.type === PlayerMorph).props; pictureHost.rerender();
    await act(() => {});
    const bar = elements(hostTree).find(node => node.type === MediaBar);
    if (bar) {
      barProps = bar.props;
      if (!barHost) {barHost = createHookHost(() => {barTree = MediaBar({...barProps, ...extraBar});}); barHost.mount();} else barHost.rerender();
      await act(() => {});
    } else {barHost?.unmount(); barHost = undefined; barTree = undefined;}
  }
  await sync();
  const controller = () => elements(tree).find(node => node.type === PlayerMorph).props.controller;
  const fullPan = () => elements(tree).find(node => node.type === 'GestureDetector').props.gesture;
  const aside = () => {const gesture = elements(barTree).find(node => node.type === 'GestureDetector').props.gesture; return gesture.gestures?.[0] ?? gesture;};
  const opener = () => elements(barTree).find(node => node.type === 'Focusable' && node.props.delayLongPress === 500).props;
  const flushJS = async () => {await act(() => {while (js.length) js.shift()!();}); await sync();};
  const complete = async (animation: Animation, force = false) => {if (!animation.cancelled || force) {animation.apply?.(); animation.complete?.(true);} await flushJS();};
  const tickPicture = async () => {const reaction = reactions.at(-1); const next = reaction.read(); reaction.callback(next, reaction.previous); reaction.previous = next; await flushJS();};
  const tick = async () => {for (const reaction of reactions) {const next = reaction.read(); reaction.callback(next, reaction.previous); reaction.previous = next;} await flushJS();};
  return {dock, adapter, Surface, animations, cancelled, requests, actions, transitions, controller, fullPan, aside, opener, flushJS, complete, tick, tickPicture, measurements,
    get tree() {return tree;}, get hostTree() {return hostTree;}, get barTree() {return barTree;}, get pictureTree() {return pictureTree;},
    async render() {refresh(); layerHost.rerender(); await sync();},
    async replace(render = true) {dock.start({...initial, kind, expanded: !docked, fence: {...fence, sourceId: 'replacement', generation: 2}}); refresh(); if (render) {layerHost.rerender(); await sync();}},
    async media(extra: any) {extraBar = extra; barHost!.rerender(); await act(() => {});},
    async picture(extra: any) {extraPicture = extra; pictureHost.rerender(); await act(() => {});},
    async layout() {const slot = elements(barTree).find(node => node.props.collapsable === false); slot.props.ref.current = {measureInWindow: (cb: any) => {measurements.push(true); cb(24, 700, 80, 45);}}; slot.props.onLayout(); await sync();},
    time(value: number) {now = value;},
    close() {if (closed) return; closed = true; barHost?.unmount(); pictureHost.unmount(); dockHost.unmount(); layerHost.unmount();},
  };
}
const vertical = {translationY: 600, velocityY: 1000}, horizontal = {translationX: 300, velocityX: 1000};

test('queued real morph release cannot collapse/expand replacement B in the same authority, with or without rerender', async () => {
  for (const docked of [false, true]) for (const render of [false, true]) {
    const r = await rig({docked});
    try {const pan = docked ? elements(r.barTree).find(node => node.type === 'GestureDetector').props.gesture.gestures[1] : r.fullPan();
      const event = docked ? {translationY: -600, velocityY: -1000} : vertical;
      pan.callbacks.onBegin(); pan.callbacks.onUpdate(event); pan.callbacks.onEnd(event, true);
      await r.replace(render); await r.flushJS();
      assert.equal(r.dock.getSnapshot().local?.expanded, !docked); assert.equal(r.transitions.length, 0);
    } finally {r.close();}
  }
});
test('successful current release dispatches once, while transition replacement and unmount retire queued release', async () => {
  const r = await rig();
  try {const pan = r.fullPan(); pan.callbacks.onBegin(); pan.callbacks.onUpdate(vertical); pan.callbacks.onEnd(vertical, true); await r.flushJS();
    assert.equal(r.dock.getSnapshot().local?.expanded, false); assert.equal(r.transitions.length, 1);
  } finally {r.close();}
  for (const stop of ['unmount', 'transition', 'new-pan']) {const r = await rig();
    try {const pan = r.fullPan(); pan.callbacks.onBegin(); pan.callbacks.onUpdate(vertical); pan.callbacks.onEnd(vertical, true);
      if (stop === 'unmount') r.close(); else if (stop === 'new-pan') pan.callbacks.onBegin(); else {r.dock.collapse(fence); await r.render();}
      await r.flushJS(); assert.equal(r.transitions.length, 0, stop);
    } finally {r.close();}
  }
});
test('ACTIVE unsuccessful vertical pan restores its goal without releasing, including reduced motion', async () => {
  for (const reduced of [false, true]) {const r = await rig({reduced});
    try {const pan = r.fullPan(); pan.callbacks.onBegin(); pan.callbacks.onUpdate(vertical); pan.callbacks.onEnd(vertical, false); pan.callbacks.onFinalize(vertical, false); await r.flushJS();
      assert.equal(r.transitions.length, 0); assert.equal(r.dock.getSnapshot().local?.expanded, true); assert.equal(r.controller().dragging.value, false); assert.equal(r.animations.at(-1)!.to, 0, 'cancel returns to the current expanded goal');
    } finally {r.close();}
  }
});
test('unsuccessful aside cancels x AND fade; late completion cannot close in normal or reduced motion', async () => {
  for (const reduced of [false, true]) {const r = await rig({reduced, docked: true});
    try {const pan = r.aside(); pan.callbacks.onBegin(); pan.callbacks.onUpdate(horizontal); pan.callbacks.onEnd(horizontal, false); pan.callbacks.onFinalize(horizontal, false);
      for (const animation of [...r.animations]) await r.complete(animation);
      await r.flushJS(); assert.deepEqual(r.actions, []);
      assert.ok(r.cancelled.includes(r.controller().dockX)); assert.ok(r.cancelled.includes(r.controller().dockFade));
    } finally {r.close();}
  }
});
test('old aside dismiss completions and queued callbacks are retired on source, visibility and unmount', async () => {
  for (const reduced of [false, true]) for (const stop of ['source', 'visibility', 'unmount', 'new-pan']) {const r = await rig({reduced, docked: true});
    try {const pan = r.aside(); pan.callbacks.onBegin(); pan.callbacks.onUpdate(horizontal); pan.callbacks.onEnd(horizontal, true);
      const finish = r.animations.filter(value => value.complete).at(-1)!;
      assert.ok(finish);
      // Queue the real finish on JS before retirement too; dispatch must check live ownership.
      finish.complete?.(true);
      if (stop === 'source') await r.replace();
      else if (stop === 'visibility') {r.dock.expand(fence); await r.render();}
      else if (stop === 'new-pan') pan.callbacks.onBegin();
      else r.close();
      await r.complete(finish, true); await r.flushJS(); assert.deepEqual(r.actions, [], `${reduced}/${stop}`);
    } finally {r.close();}
  }
});
test('expanding outgoing DockHost keeps distinct physical detector gesture identities', async () => {
  const r = await rig({docked: true});
  try {r.dock.expand(fence); await r.render();
    const full = r.fullPan(), dock = elements(r.barTree).find(node => node.type === 'GestureDetector').props.gesture;
    assert.ok(r.barTree, 'outgoing presence still mounted');
    assert.ok(!dock.gestures.includes(full), 'one PanGesture must never be attached in both detectors');
    assert.equal(dock.gestures[1].config.enabled, false, 'outgoing dock pan has no input ownership');
  } finally {r.close();}
});
test('horizontal drag/fade transforms the actual common ancestor of chrome, Surface and retained preview', async () => {
  const r = await rig({docked: true, reduced: true});
  try {await r.layout(); const pan = r.aside(); pan.callbacks.onBegin(); pan.callbacks.onUpdate(horizontal);
    const host = elements(r.tree).find(node => node.type === 'AnimatedView' && elements(node).some(child => child.type?.name === 'PlayerMorph') && elements(node).some(child => child.type?.name === 'DockHost'));
    assert.ok(host, 'the actual picture and chrome share the moving host');
    const read = () => host.props.style.find((style: any) => style?.read).read();
    assert.equal(read().transform[0].translateX, 300);
    const measured = r.measurements.length; await r.layout(); assert.equal(r.measurements.length, measured, 'dragged window coordinates never overwrite the settled slot');
    const chrome = elements(r.barTree).find(node => node.type === 'AnimatedView').props.style.find((style: any) => style?.read).read();
    assert.equal(chrome.transform[0].translateX, 0, 'shared motion is applied once'); assert.equal(chrome.opacity, 1);
    const surface = elements(r.pictureTree).find(node => node.type === r.Surface); assert.ok(surface);
    await r.tick(); r.controller().dragging.value = true; r.controller().progress.value = .5;
    await r.picture({androidSnapshot: {fence, image: 'last-frame'}}); await r.tick();
    assert.ok(elements(r.pictureTree).some(node => node.type === 'AnimatedView' && node.props.children === 'last-frame'));
    pan.callbacks.onEnd(horizontal, true); const fade = r.animations.filter(value => value.to === 0 && value.complete).at(-1)!;
    fade.apply?.(); assert.equal(read().opacity, 0);
    assert.strictEqual(elements(r.pictureTree).find(node => node.type === r.Surface).type, surface.type);
  } finally {r.close();}
});
test('steady reduced snapshot/fullFrame object churn never restarts the picture fade; actual transition fades once', async () => {
  const r = await rig({reduced: true});
  try {const count = r.animations.length; for (let i = 0; i < 4; i++) {r.dock.update({...initial, positionSeconds: 76 + i}); await r.render();}
    assert.equal(r.animations.length, count, 'facts/frame identities are not morph transitions');
    r.dock.collapse(fence); await r.render(); const after = r.animations.length;
    assert.ok(after > count, 'a real transition still animates');
    await r.render(); assert.equal(r.animations.length, after);
    r.controller().progress.value = 1; r.controller().velocity.value = 0; await r.tickPicture(); await r.tickPicture();
    assert.equal(r.animations.length, after, 'settlement reaction does not replay the reduced transition fade');
  } finally {r.close();}
});
test('actual 500ms local hold requests policy-respecting selection haptic once and opens its menu', async () => {
  for (const kind of ['music', 'video'] as const) {const r = await rig({docked: true, kind});
    try {const hold = r.opener(); assert.equal(hold.delayLongPress, 500); hold.onPressIn();
      r.time(499); assert.deepEqual(r.requests, []);
      r.time(500); hold.onLongPressAction(); hold.onLongPressAction(); await r.flushJS();
      assert.deepEqual(r.requests, [500]); assert.equal(elements(r.barTree).find(node => node.type === 'Popover').props.open, true);
      hold.onPressOut(); hold.onPressIn(); r.time(1000); hold.onLongPressAction(); await r.flushJS(); assert.deepEqual(r.requests, [500, 1000]);
    } finally {r.close();}
  }
});
test('stale/unmounted/invisible holds do not request feedback; platform haptic policy remains authoritative', async () => {
  for (const stop of ['source', 'source-before-render', 'visibility', 'unmount', 'release']) {const r = await rig({docked: true});
    try {const hold = r.opener(); hold.onPressIn();
      if (stop === 'source') await r.replace(); else if (stop === 'source-before-render') await r.replace(false); else if (stop === 'visibility') {r.dock.expand(fence); await r.render();} else if (stop === 'release') hold.onPressOut(); else r.close();
      hold.onLongPressAction(); await r.flushJS(); assert.deepEqual(r.requests, [], stop);
    } finally {r.close();}
  }
  const r = await rig({docked: true, os: 'web'});
  try {const hold = r.opener(); hold.onPressIn(); hold.onLongPressAction(); await r.flushJS(); assert.deepEqual(r.requests, []);} finally {r.close();}
});

// Positive completion matters: ownership checks must preserve a current dismiss.
test('successful current aside completion closes exactly once in normal and reduced motion', async () => {
  for (const reduced of [false, true]) {const r = await rig({docked: true, reduced});
    try {const pan = r.aside(); pan.callbacks.onBegin(); pan.callbacks.onUpdate(horizontal); pan.callbacks.onEnd(horizontal, true); pan.callbacks.onFinalize(horizontal, true);
      const finish = r.animations.filter(value => value.complete).at(-1)!;
      await r.complete(finish); await r.complete(finish, true);
      assert.equal(r.actions.length, 1); assert.equal(r.actions[0].type, 'close'); assert.ok(sameFence(r.actions[0].fence, fence));
    } finally {r.close();}
  }
});
test('interrupted vertical source callbacks cannot move replacement progress or release it', async () => {
  const r = await rig();
  try {const pan = r.fullPan(); pan.callbacks.onBegin(); pan.callbacks.onUpdate(vertical); await r.replace();
    const progress = r.controller().progress.value; pan.callbacks.onUpdate({translationY: 800, velocityY: 2000}); pan.callbacks.onEnd(vertical, true); pan.callbacks.onFinalize(vertical, false); await r.flushJS();
    assert.equal(r.controller().progress.value, progress); assert.equal(r.transitions.length, 0);
  } finally {r.close();}
});

test('a standalone morph consumer keeps local bar movement without a hosted picture ancestor', async () => {
  const r = await rig({docked: true});
  try {await r.media({morph: {...r.controller(), dockMotionHosted: false}});
    const pan = r.aside(); pan.callbacks.onBegin(); pan.callbacks.onUpdate(horizontal);
    const chrome = elements(r.barTree).find(node => node.type === 'AnimatedView').props.style.find((style: any) => style?.read).read();
    assert.equal(chrome.transform[0].translateX, 300);
  } finally {r.close();}
});
