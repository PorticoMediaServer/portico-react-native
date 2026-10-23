import test from 'node:test';
import assert from 'node:assert/strict';
import * as React from 'react';
import {screenModule} from './helpers/screen-harness.mjs';
import {createHookHost} from './hook-driver.ts';
import {sameFence, playbackFence} from '../../../packages/player-core/src/index.ts';
import {defaultI18n} from '../../../packages/i18n/src/index.ts';
import {NativeWatchControls} from '../src-next/screens/watch/controls.ts';

let event: (event: {eventType: string; eventKeyAction: number}) => void;
const motion = {timing: () => ({duration: 0})};
const {NativeWatchChrome} = await screenModule(new URL('../src-next/screens/watch/WatchChrome.tsx', import.meta.url), {
  react: {...React, default: React}, 'react-native': {View: 'View', Text: 'Text', useTVEventHandler: (handler: typeof event) => {event = handler;}},
  'react-native-reanimated': {default: {View: 'Animated'}, cancelAnimation() {}, useAnimatedStyle: (value: () => unknown) => value(), useSharedValue: (value: unknown) => React.useRef({value}).current, withTiming: (value: unknown) => value},
  'react-native-svg': {default: 'Svg', Defs: 'Defs', LinearGradient: 'Gradient', Path: 'Path', Rect: 'Rect', Stop: 'Stop', Text: 'SvgText'},
  '../../../../../packages/player-core/src': {sameFence}, '../../../../../packages/client-core/src/presentation/kit-model': {playbackIdentity() {}},
  '../../../../../packages/client-core/src/presentation/kit-model/text': {clockText: String}, '../../../../../packages/i18n/src': {defaultI18n},
  '../../kit/controls': {Button: 'Button', Focusable: 'Focusable'}, '../../kit/focus': {FocusRegion: 'FocusRegion'}, '../../kit/Icon': {Icon: 'Icon'},
  '../../kit/theme': {nativeType: () => ({}), useTheme: () => ({isTV: true, colors: {}, type: {body: {}, bodyStrong: {}, caption: {}}})},
  '../../kit/useMotion': {useMotion: () => motion}, './controls': {NativeWatchControls}, './WatchTimeline': {NativeWatchTimeline: 'Timeline'},
});
const fence = playbackFence({kind: 'queue', playback: {scope: {serverId: 'server', accountId: 'account', profileId: 'profile', controllerId: 'controller', controllerEpoch: 'epoch', commandLaneId: 'lane', authority: 'local'}, run: 1}, sessionId: 'session', itemId: 'item', sourceId: 'version', entryId: 'entry', generation: 1});

test('TV first Select event plus its genuine picture press only reveals; second press toggles playback', () => {
  const controls = new NativeWatchControls(true), commands: string[] = [];
  const source = {fence, retired: false, dock: {local: {expanded: true}}, queue: {}, capabilities: {play: true, pause: true, seek: true}, playback: {intent: 'playing', positionSeconds: 17, duration: 100}};
  const playback = {getSnapshot: () => source, toggle: async () => {commands.push('toggle');}};
  let tree: any;
  controls.source(fence, {expanded: true, autoHide: true, hiddenByPanel: false, paused: false, scrubbing: false, focusHeld: false});
  const host = createHookHost(() => {tree = NativeWatchChrome({source, controls, playback, text: {t: defaultI18n.t}, quality: 'Original', width: 1920, height: 1080, compact: false, skipBackSeconds: 10, skipForwardSeconds: 30, onMinimize() {}, onPanel() {}, reportError(error: unknown) {throw error;}});});
  host.mount();
  try {
    const picture = tree.props.children[0];
    event!({eventType: 'select', eventKeyAction: 0}); picture.props.onPress();
    assert.equal(controls.getSnapshot().visible, true); assert.equal(controls.getSnapshot().focus, 'toggle'); assert.deepEqual(commands, []);
    host.flush();
    const descendants = (node: any): any[] => Array.isArray(node) ? node.flatMap(descendants) : React.isValidElement(node) ? [node, ...descendants((node as any).props.children)] : [];
    const toggle = descendants(tree).find(node => node.props.testID === 'watch-toggle');
    toggle.props.onPress(); assert.deepEqual(commands, ['toggle']);
  } finally {host.unmount(); controls.dispose();}
});
