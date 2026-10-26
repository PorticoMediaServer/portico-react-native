import * as playerCore from '../../../packages/player-core/src/index.ts';
import * as upNext from '../../../packages/client-core/src/up-next.ts';
import {channelSeconds} from '../../../packages/client-core/src/playback/linear-protocol.ts';
import {playbackIdentity} from '../../../packages/client-core/src/presentation/kit-model/index.ts';
import test from 'node:test';
import assert from 'node:assert/strict';
import * as React from 'react';
import {screenModule} from './helpers/screen-harness.mjs';
import {createHookHost} from './hook-driver.ts';
import {sameFence, playbackFence} from '../../../packages/player-core/src/index.ts';
import {defaultI18n} from '../../../packages/i18n/src/index.ts';
import * as registryModule from '../src-next/kit/focus/registry.ts';
import * as hostRefModule from '../src-next/kit/focus/useHostRef.ts';
import {NativeWatchControls} from '../src-next/screens/watch/controls.ts';

const gesture = () => {const value: Record<string, unknown> = {}; for (const key of ['enabled', 'runOnJS', 'activeOffsetY', 'failOffsetX', 'onEnd']) value[key] = () => value; return value;};
const focusRegistry = registryModule.createFocusRegistry();
let event: (event: {eventType: string; eventKeyAction: number}) => void;
let isTV = true;
const motion = {timing: () => ({duration: 0})};
const {NativeWatchChrome} = await screenModule(new URL('../src-next/screens/watch/WatchChrome.tsx', import.meta.url), {
  '../../kit/dock/PlayerMorphBridge': {usePublishedPlayerMorph: () => undefined},
  './useSkipPromptMotion': {useSkipPromptMotion: (value: unknown) => ({value, interactive: !!value, bodyStyle: {}, positionStyle: {}})},
  react: {...React, default: React}, 'react-native': {View: 'View', Text: 'Text', useTVEventHandler: (handler: typeof event) => {event = handler;}},
  'react-native-reanimated': {Easing: {linear: (value: number) => value}, default: {View: 'Animated'}, cancelAnimation() {}, useAnimatedStyle: (value: () => unknown) => value(), useSharedValue: (value: unknown) => React.useRef({value}).current, withTiming: (value: unknown) => value},
  'react-native-gesture-handler': {Gesture: {Pan: gesture}, GestureDetector: 'GestureDetector'},
  '../../../../../packages/client-core/src/up-next': upNext, '../../../../../packages/client-core/src/playback/linear-protocol': {channelSeconds},
  './useSkipPromptMotion': {useSkipPromptMotion: (value: unknown) => ({value, interactive: !!value, bodyStyle: {}, positionStyle: {}})},
  './TVControlLabel': {TVControlLabel: 'TVControlLabel'}, '../settings-live/GroupPill': {NativeTVGroupPill: 'GroupPill'},
  './live-guide': {noLiveGuideSubscription: () => () => {}, emptyLiveGuide: () => ({})},
  './live-actions': {noLiveActionsSubscription: () => () => {}, emptyLiveActions: () => ({})},
  '../../../../../packages/client-core/src/guide/now-next': {nowNext: () => ({})},
  '../../../../../packages/client-core/src/playback-messages': {playbackUserMessage: String},
  './TVMiniGuide': {NativeMiniGuide: 'MiniGuide'}, './TVLiveActions': {TVLiveActions: 'LiveActions'},
  './UpNextCard': {NativeUpNextCard: 'UpNextCard'}, '../../kit/artwork': {Artwork: 'Artwork'},
  'react-native-svg': {default: 'Svg', Defs: 'Defs', LinearGradient: 'Gradient', Path: 'Path', Rect: 'Rect', Stop: 'Stop', Text: 'SvgText'},
  '../../../../../packages/player-core/src': playerCore, '../../../../../packages/client-core/src/presentation/kit-model': {playbackIdentity},
  '../../../../../packages/client-core/src/presentation/kit-model/text': {clockText: String}, '../../../../../packages/i18n/src': {defaultI18n},
  '../../kit/controls': {Button: 'Button', Focusable: 'Focusable'}, '../../kit/focus': {FocusRegion: 'FocusRegion', useFocusRegistry: () => focusRegistry}, '../../kit/Icon': {Icon: 'Icon'},
  '../../kit/theme': {nativeType: () => ({}), useTheme: () => ({isTV, colors: {}, type: {body: {}, bodyStrong: {}, caption: {}}})},
  '../../kit/useMotion': {useMotion: () => motion, useReducedMotion: () => true}, './controls': {NativeWatchControls}, './WatchTimeline': {NativeWatchTimeline: 'Timeline'},
});
const fence = playbackFence({kind: 'queue', playback: {scope: {serverId: 'server', accountId: 'account', profileId: 'profile', controllerId: 'controller', controllerEpoch: 'epoch', commandLaneId: 'lane', authority: 'local'}, run: 1}, sessionId: 'session', itemId: 'item', sourceId: 'version', entryId: 'entry', generation: 1});

test('TV first Select event plus its genuine picture press only reveals; second press toggles playback', () => {
  const controls = new NativeWatchControls(true), commands: string[] = [];
  const source = {fence, retired: false, dock: {local: {expanded: true}}, queue: {}, capabilities: {play: true, pause: true, seek: true}, playback: {intent: 'playing', positionSeconds: 17, duration: 100}};
  const playback = {getSnapshot: () => source, toggle: async () => {commands.push('toggle');}};
  let tree: any;
  controls.source(fence, {expanded: true, autoHide: true, hiddenByPanel: false, paused: false, scrubbing: false, focusHeld: false});
  const host = createHookHost(() => {tree = NativeWatchChrome({source, controls, playback, text: {t: defaultI18n.t}, quality: 'Original', width: 1920, height: 1080, compact: false, skipBackSeconds: 10, skipForwardSeconds: 30, skipModes: {intro: 'ask', recap: 'ask', credits: 'ask'}, onMinimize() {}, onPanel() {}, reportError(error: unknown) {throw error;}});});
  host.mount();
  try {
    const all = (node: any): any[] => Array.isArray(node) ? node.flatMap(all) : React.isValidElement(node) ? [node, ...all((node as any).props.children)] : [];
    const picture = all(tree).find(node => node.props.testID === 'watch-picture');
    event!({eventType: 'select', eventKeyAction: 0}); picture.props.onPress();
    assert.equal(controls.getSnapshot().visible, true); assert.equal(controls.getSnapshot().focus, 'toggle'); assert.deepEqual(commands, []);
    host.flush();
    const descendants = (node: any): any[] => Array.isArray(node) ? node.flatMap(descendants) : React.isValidElement(node) ? [node, ...descendants((node as any).props.children)] : [];
    const toggle = descendants(tree).find(node => node.props.testID === 'watch-toggle');
    toggle.props.onPress(); assert.deepEqual(commands, ['toggle']);
  } finally {host.unmount(); controls.dispose();}
});

test('every genuine chrome child mounts the strict focus target hook with unique stable semantic caller IDs', async () => {
  const contexts: {current: unknown}[] = [];
  const focus = await screenModule(new URL('../src-next/kit/focus/FocusRegion.tsx', import.meta.url), {
    react: {...React, default: React, createContext: (current: unknown) => {const value = {current}; contexts.push(value); return value;}, useContext: (context: {current: unknown}) => context.current},
    'react-native': {findNodeHandle: () => null, TVFocusGuideView: 'Guide', View: 'View'}, '../theme': {useTheme: () => ({isTV})}, './registry': registryModule, './useHostRef': hostRefModule,
  });
  const descendants = (node: any): any[] => Array.isArray(node) ? node.flatMap(descendants) : React.isValidElement(node) ? [node, ...descendants((node as any).props.children)] : [];
  for (const {tv, compact} of [{tv: false, compact: false}, {tv: false, compact: true}, {tv: true, compact: false}]) {
    isTV = tv;
    const controls = new NativeWatchControls(tv), currentFence = {...fence, showId: 'show'};
    const source = {fence: currentFence, retired: false, dock: {local: {expanded: true}}, queue: {view: {next: {available: false}, postPlay: {}, items: [{entryId: 'one'}, {entryId: 'two'}]}}, capabilities: {play: true, pause: true, seek: true, audioTrack: true, subtitleTrack: true, previous: true, next: true}, playback: {intent: 'playing', positionSeconds: 17, duration: 100}};
    const playback = {getSnapshot: () => source, toggle: async () => {}, skip: async () => {}, previous: async () => {}, next: async () => {}};
    controls.source(currentFence, {expanded: true, autoHide: true, hiddenByPanel: false, paused: false, scrubbing: false, focusHeld: false}); controls.reveal(currentFence);
    let tree: any;
    const host = createHookHost(() => {tree = NativeWatchChrome({source, controls, playback, text: {t: defaultI18n.t}, quality: 'Original', width: 1920, height: 1080, compact, skipBackSeconds: 10, skipForwardSeconds: 30, skipModes: {intro: 'ask', recap: 'ask', credits: 'ask'},
      onMinimize() {}, onPictureInPicture() {}, onCast() {}, onFullWindow() {}, reportError: assert.fail});});
    host.mount();
    try {
      const region = descendants(tree).find(node => node.type === 'FocusRegion' && node.props.id === 'watch-controls'); assert.equal(region.props.id, 'watch-controls');
      const targets = descendants(region).filter(node => node.type === 'Button' || node.type === 'Focusable');
      const ids = targets.map(node => node.props.focusId);
      assert.equal(new Set(ids).size, targets.length); assert.ok(ids.every(id => typeof id === 'string' && id.startsWith('watch-')));
      assert.ok(ids.includes('watch-skip-back')); assert.ok(ids.includes('watch-skip-forward')); assert.ok(ids.includes('watch-option-quality'));
      const registry = registryModule.createFocusRegistry(); registry.configure({id: 'watch-controls', orientation: 'horizontal', entry: 'watch-toggle'});
      contexts[0]!.current = registry; contexts[1]!.current = 'watch-controls';
      for (const target of targets) {
        let binding: any;
        const mounted = createHookHost(() => {binding = focus.useFocusTarget({focusId: target.props.focusId, testID: target.props.testID, disabled: target.props.disabled});});
        mounted.mount(); try {assert.equal(binding.testID, target.props.testID);} finally {mounted.unmount();}
      }
    } finally {host.unmount(); controls.dispose();}
  }
  isTV = true;
});

const descendants = (node: any): any[] => Array.isArray(node) ? node.flatMap(descendants) : React.isValidElement(node) ? [node, ...descendants((node as any).props.children)] : [];

for (const kind of ['skip', 'undo', 'up-next']) for (const visible of [false, true]) test(`a ${kind} arrival with controls ${visible ? 'up preserves Quality' : 'hidden owns focus and Back stays in playback'}`, () => {
  isTV = true;
  const entry = kind === 'skip' ? 'watch-skip-action' : kind === 'undo' ? 'watch-skip-undo' : 'watch-up-next-play';
  const controls = new NativeWatchControls(true), requested: string[] = [];
  const source = {fence, retired: false, dock: {local: {expanded: true}}, queue: kind === 'up-next' ? {view: {items: [{entryId: 'next', title: 'Next episode'}], next: {entryId: 'next', available: true}, postPlay: {autoplay: false}}} : {}, options: {itemId: 'item', versions: [], markers: [{id: 'intro', automaticSafe: true, type: kind === 'up-next' ? 'credits' : 'intro', startMs: kind === 'up-next' ? 70000 : 10000, endMs: kind === 'up-next' ? 99000 : 30000}]},
    capabilities: {play: true, pause: true, seek: true}, playback: {intent: 'playing', positionSeconds: kind === 'undo' ? 17 : 1, duration: 100}};
  const playback = {getSnapshot: () => source, seek: async () => {}};
  controls.source(fence, {expanded: true, autoHide: true, hiddenByPanel: false, paused: false, scrubbing: false, focusHeld: false});
  if (visible) controls.reveal(fence);
  const release = focusRegistry.mountRegion('watch-skip', {});
  focusRegistry.configure({id: 'watch-skip', entry, orientation: 'horizontal'});
  focusRegistry.attach({regionId: 'watch-skip', childId: entry}, {requestTVFocus: () => {
    requested.push('skip'); focusRegistry.didFocus({regionId: 'watch-skip', childId: entry});
  }});
  let tree: any;
  const host = createHookHost(() => {tree = NativeWatchChrome({source, controls, playback, text: {t: defaultI18n.t}, quality: 'Original', width: 1920, height: 1080, compact: false,
    skipBackSeconds: 10, skipForwardSeconds: 30, skipModes: {intro: kind === 'undo' ? 'auto' : 'ask', recap: 'ask', credits: 'ask'}, onMinimize() {}, reportError: assert.fail});});
  host.mount();
  try {
    focusRegistry.didFocus({regionId: visible ? 'watch-controls' : 'watch-surface', childId: visible ? 'watch-option-quality' : 'watch-picture'});
    source.playback.positionSeconds = kind === 'up-next' ? 80 : kind === 'undo' ? 29 : 17; host.rerender(); for (let pass = 0; pass < 6 && host.flush(); pass++) {}
    const prompt = descendants(tree).find(node => node.props.testID === entry || kind === 'up-next' && node.type === 'UpNextCard');
    assert.ok(prompt); if (kind !== 'up-next') assert.equal(prompt.props.hasTVPreferredFocus, false);
    if (visible) {
      assert.deepEqual(requested, []); assert.equal(focusRegistry.capture()?.childId, 'watch-option-quality');
      const region = descendants(tree).find(node => node.props.id === 'watch-transport');
      assert.equal(region.props.edges.right, 'watch-skip');
    } else {
      assert.ok(requested.length > 0); assert.equal(controls.getSnapshot().visible, false);
      event!({eventType: 'select', eventKeyAction: 0}); assert.equal(controls.getSnapshot().visible, false);
      assert.equal(controls.back(fence), 'controls'); host.flush();
      assert.equal(controls.getSnapshot().visible, false);
      assert.equal(descendants(tree).some(node => node.props.testID === entry || kind === 'up-next' && node.type === 'UpNextCard'), false);
      assert.equal(controls.back(fence), 'player');
      source.playback.positionSeconds += 1; host.rerender();
      assert.equal(descendants(tree).some(node => node.props.testID === entry || kind === 'up-next' && node.type === 'UpNextCard'), false);
    }
  } finally {host.unmount(); focusRegistry.attach({regionId: 'watch-skip', childId: entry}, null); release(); controls.dispose();}
});

test('seek preview keeps transport native targets mounted for a guide-based Down return', () => {
  isTV = true;
  const controls = new NativeWatchControls(true);
  const source = {fence, retired: false, dock: {local: {expanded: true}}, queue: {}, capabilities: {play: true, pause: true, seek: true}, playback: {intent: 'paused', positionSeconds: 17, duration: 100}};
  const playback = {getSnapshot: () => source};
  controls.source(fence, {expanded: true, autoHide: true, hiddenByPanel: false, paused: false, scrubbing: false, focusHeld: false}); controls.reveal(fence);
  focusRegistry.didFocus({regionId: 'watch-seek-region', childId: 'watch-seek'});
  let tree: any;
  const host = createHookHost(() => {tree = NativeWatchChrome({source, controls, playback, text: {t: defaultI18n.t}, quality: 'Original', width: 1920, height: 1080, compact: false,
    skipBackSeconds: 10, skipForwardSeconds: 30, skipModes: {intro: 'ask', recap: 'ask', credits: 'ask'}, onMinimize() {}, reportError: assert.fail});});
  host.mount();
  try {
    const find = (id: string) => descendants(tree).find(node => node.props.id === id);
    const timeline = descendants(tree).find(node => node.type === 'Timeline' && node.props.tv && node.props.enabled);
    timeline.props.onPreview(25); host.flush();
    const hidden = find('watch-transport');
    assert.equal(hidden.props.style.opacity, 0);
    assert.ok(descendants(hidden).some(node => node.props.focusId === 'watch-option-quality'));
    assert.equal(find('watch-seek-region').props.edges.down, 'watch-transport');
    assert.equal(hidden.props.edges.up, 'watch-seek-region');
    assert.equal(find('watch-group').props.edges.down, 'watch-seek-region');
    assert.equal(timeline.props.nextFocusUp, undefined);
    assert.equal(timeline.props.onExitPreview, undefined, 'no delayed JS focus mover');
    focusRegistry.didFocus({regionId: 'watch-transport', childId: 'watch-option-quality'}); host.flush();
    assert.equal(find('watch-transport').props.style.opacity, 1);
    assert.equal(focusRegistry.capture()?.childId, 'watch-option-quality');
  } finally {host.unmount(); controls.dispose();}
});
