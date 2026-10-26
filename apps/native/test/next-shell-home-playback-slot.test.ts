import {DockVideoExitImages} from '../src-next/kit/dock/video-exit-paint.ts';
import {expandedListeningOccupant} from '../src-next/shell/listening-presentation.ts';
import assert from 'node:assert/strict';
import test from 'node:test';
import {PlaybackDock, playbackFence} from '../../../packages/player-core/src';
import {focusTestID} from '../src-next/kit/focus/registry';
import {tvFocusIds} from '../src-next/shell/tv-focus';
import {createTheme} from '../src-next/kit/theme';
import {sameAuthority} from '../src-next/shell/model';
import {sameFence} from '../../../packages/player-core/src';
import * as watchSlotLayout from '../src-next/shell/watch-slot-layout.ts';
import {hooks, screenModule} from './helpers/screen-harness.mjs';

const authority = {serverId: 'server', accountId: 'account', profileId: 'profile', epoch: 'epoch', viewerFence: 'viewer'};
const fence = playbackFence({kind: 'queue', playback: {scope: {serverId: 'server', authority: 'local', accountId: 'account', profileId: 'profile', controllerId: 'controller', controllerEpoch: 'epoch', commandLaneId: 'lane'}, run: 1}, sessionId: 'session', itemId: 'item', sourceId: 'source', entryId: 'entry', generation: 1});
const nodes = (node: any): any[] => Array.isArray(node) ? node.flatMap(nodes) : node?.type ? [node, ...nodes(node.props.children)] : [];

test('actual playback layer converts measured window slot to its own origin and rejects stale measurements', async () => {
  const h = hooks(), dock = new PlaybackDock(fence.playback.scope);
  dock.start({kind: 'video', fence, queue: null, positionSeconds: 540, playing: true, expanded: false});
  let current = {authority, fence, dock: dock.getSnapshot(), playback: {duration: 5700}, subject: {}, capabilities: {}};
  const adapter = {getSnapshot: () => current, subscribe: () => () => {}, Surface: 'ActualSurface', dock};
  const morph = {dragging: {value: false}, dockX: {value: 0}, dockFade: {value: 1}};
  const {NativePlaybackLayer} = await screenModule(new URL('../src-next/shell/NativePlaybackLayer.tsx', import.meta.url), {
    './listening-presentation': {expandedListeningOccupant},
    '../kit/dock/video-exit-paint': {DockVideoExitImages},
    '../kit/dock/DockHandover': {DockVideoExitProvider: 'DockVideoExitProvider', DockVideoExitCanvas: 'DockVideoExitCanvas'},
    '../kit/dock/InitialPicturePresentation': {InitialPicturePresentation: 'InitialPicturePresentation'},
    '../kit/dock/initial-picture-model': {initialPictureKey: () => 'initial-picture'},
    '../kit/dock/PlayerMorphBridge': {PlayerMorphProvider: 'PlayerMorphProvider', useInitialPlayerPagePaint: () => undefined, usePlayerMorphPublication() {}},
    react: h.react, 'react-native': {BackHandler: {}, Image: 'Image', Platform: {OS: 'android'}, View: 'View', useWindowDimensions: () => ({width: 390, height: 844})},
    'react-native-gesture-handler': {GestureDetector: 'GestureDetector'}, '../../../../packages/player-core/src': {sameFence},
    'react-native-reanimated': {default: {View: 'Animated.View'}, useAnimatedStyle: (style: () => unknown) => style()},
    '../kit/focus': {focusTestID}, './tv-focus': {tvFocusIds},
    '../kit/theme': {useTheme: () => createTheme({isTV: false, width: 390})},
    '../kit/dock': {DockHost: 'DockHost', PlayerMorph: 'PlayerMorph', bindNativeDock: () => () => {}, usePlayerMorph: () => morph},
    '../../../../packages/client-core/src/presentation/kit-model': {playbackIdentity: () => ({title: 'Fixture'})},
    './model': {sameAuthority}, './playback': {}, './video-snapshot': {NativeVideoSnapshotCapture: class {async clear() {} async prepare() {}}},
    './watch-slot-layout': watchSlotLayout, './TVStartFailure': {TVStartFailure: 'TVStartFailure'}, './TouchStartFailure': {TouchStartFailure: 'TouchStartFailure'},
  });
  const runtime = {text: {}, reportError() {}, artwork: () => undefined, ambient: () => undefined};
  const render = () => h.render(() => NativePlaybackLayer({adapter, runtime, authority}));
  const callbacks: ((x: number, y: number) => void)[] = [];
  let tree = render();
  const host = {measureInWindow: (callback: (x: number, y: number) => void) => callbacks.push(callback)};
  tree.props.ref.current = host;
  const slot = {x: 16, y: 654, width: 80, height: 45};
  const onSlot = nodes(tree).find(node => node.type === 'DockHost').props.onVideoSlot;
  onSlot(slot);
  assert.deepEqual(nodes(render()).find(node => node.type === 'PlayerMorph').props.dockFrame, {x: 0, y: 0, width: 390, height: 844});
  callbacks.shift()!(0, -45);
  tree = render();
  const frame = () => nodes(render()).find(node => node.type === 'PlayerMorph').props.dockFrame;
  assert.deepEqual(frame(), {x: 16, y: 699, width: 80, height: 45}, 'measured viewport inset is removed without a platform offset');
  assert.equal(nodes(tree).find(node => node.type === 'PlayerMorph').props.children[0]({bounds: {x: 0, y: 0, width: 80, height: 45}}).type, 'ActualSurface');

  onSlot({...slot, x: 20}); onSlot({...slot, x: 24});
  callbacks.shift()!(0, -45);
  assert.equal(frame().x, 16, 'older asynchronous measurement cannot replace the latest slot');
  callbacks.shift()!(4, -45);
  assert.deepEqual(frame(), {x: 20, y: 699, width: 80, height: 45});
  onSlot({...slot, x: 80}); current = {...current, authority: {...authority, viewerFence: 'retired'}};
  callbacks.shift()!(0, -45); current = {...current, authority};
  assert.equal(frame().x, 20, 'authority retirement rejects the measurement');
  onSlot({...slot, x: 90}); current = {...current, fence: {...fence, generation: 2}};
  callbacks.shift()!(0, -45); current = {...current, fence};
  assert.equal(frame().x, 20, 'source generation retirement rejects the measurement');
  onSlot({...slot, x: 100}); tree.props.ref.current = null;
  callbacks.shift()!(0, -45);
  assert.equal(frame().x, 20, 'detached host rejects the measurement');
});
