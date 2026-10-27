import test from 'node:test';
import assert from 'node:assert/strict';
import * as React from 'react';
import {screenModule} from './helpers/screen-harness.mjs';
import {act, createHookHost} from './hook-driver.ts';
import {NativeTogetherController} from '../src-next/screens/settings-live/together-controller.ts';
import {NativeScreenLifetime} from '../src-next/screens/settings-live/lifetime.ts';
const react = {...React, default: React};
const module = await screenModule(new URL('../src-next/screens/settings-live/TogetherScreen.tsx', import.meta.url), {
  react, 'react-native': {ScrollView: 'ScrollView', Share: {}, Text: 'Text', View: 'View'},
  'react-native-safe-area-context': {useSafeAreaInsets: () => ({top: 0})},
  '../../../../../packages/i18n/src': {defaultI18n: {t: (s: string) => s}},
  '../../../../../packages/client-core/src/media-item': {}, '../../../../../packages/contracts/src/routes': {},
  '../../../../../packages/client-core/src/social-playback': {}, '../../kit/controls': {Button: 'Button', Focusable: 'Focusable', Segmented: 'Segmented', TextField: 'TextField'},
  '../../kit/focus': {FocusRegion: 'FocusRegion'}, '../../kit/overlays': {Dialog: 'Dialog', Banner: 'Banner', Menu: 'Menu'},
  '../../kit/artwork': {AmbientArt: 'AmbientArt', Artwork: 'Artwork', ProfileFace: 'ProfileFace'}, '../../kit/Icon': {Icon: 'Icon'}, '../../kit/states': {StateView: 'StateView'},
  '../../kit/shell/visual': {alpha: () => '', shellType: () => ({})}, '../../kit/theme': {useTheme: () => ({isTV: false, width: 390, colors: {raised: 'a', text: 'b', textSecondary: 'c', textTertiary: 'd', line: 'e', raisedHigh: 'f'}})},
  '../../shell/tv-focus': {tvFocusIds: () => ({surface: (s: string) => s, rail: 'rail'})}, '../destinations': {NativeTVKeyboard: 'Keyboard'},
  './Screen': {Screen: 'Screen', ScreenText: 'ScreenText', useScreenEntry: () => {}}, './together-presentation': {nativeTogetherLobbyFaces: () => []},
  './TogetherTVRoom': {NativeTogetherTVRoom: 'TVRoom'},
});
const find = (node: any, id: string): any => {
  if (!node) return undefined;
  if (Array.isArray(node)) return node.map(value => find(value, id)).find(Boolean);
  if (node.props?.testID === id) return node;
  return find(node.props?.children, id);
};
function fixture(phase = 'idle') {
  const group = {id: 'group', viewerMemberId: 'member', endedReason: 'ended'}, listeners = new Set<() => void>();
  let state: any = {phase, group: ['idle', 'left'].includes(phase) ? undefined : group, directory: [], busy: false}, back = 0, ends = 0;
  let pending: any, resolveJoin!: (value: boolean) => void;
  const lifetime = new NativeScreenLifetime({authority: () => ({serverId: 's', accountId: 'a', profileId: 'profile', epoch: 'e', viewerFence: 'v'}), current: () => true, subscribeAuthority: () => () => {}});
  const service: any = {getSnapshot: () => state, subscribe: (fn: () => void) => {listeners.add(fn); return () => listeners.delete(fn);},
    refreshDirectory: async () => {}, end: async () => {ends++;}, create: async () => false,
    join: (_code: string, _who: string, lifetime: any) => {pending = lifetime; return new Promise<boolean>(resolve => {resolveJoin = resolve;});}};
  const controller = new NativeTogetherController(lifetime, service);
  const snapshot = {route: {kind: 'together'}, revision: 1};
  const context = {account: {profiles: []}, navigation: {getSnapshot: () => snapshot, subscribe: () => () => {}}, session: () => ({sessionFamilyId: 'f', tokenGeneration: '1', authorizationHorizon: 'h', deviceId: 'd', installationId: 'i'})};
  let tree: any; const host = createHookHost(() => {tree = module.NativeTogetherScreen({controller, media: {}, ports: {context}, runtime: {text: {t: (s: string) => s}, getSnapshot: () => ({profile: {name: 'Name'}}), reportError: assert.fail}, onBack: () => {back++;}});});
  host.mount();
  return {host, tree: () => tree, pageBack: () => find(tree.type(tree.props), 'together-page-back').props.onPress(), back: () => back, ends: () => ends, pending: () => pending, resolveJoin: (value: boolean) => resolveJoin(value), dispose: () => {host.unmount(); controller.dispose(); lifetime.dispose();}};
}
for (const phase of ['idle', 'left', 'live', 'ended'] as const) test(`handheld Together ${phase} page offers exit without ending the room`, () => {
  const f = fixture(phase);
  try {f.pageBack(); assert.equal(f.back(), 1); assert.equal(f.ends(), 0);}
  finally {f.dispose();}
});
test('lobby form closes before page back', async () => {
  const f = fixture();
  try {
    await act(() => find(f.tree(), 'together-start').props.onPress());
    f.pageBack(); assert.equal(f.back(), 0);
    await act(() => {}); f.pageBack(); assert.equal(f.back(), 1); assert.equal(f.ends(), 0);
  } finally {f.dispose();}
});


test('back closes an in-flight join form and aborts its original operation before leaving', async () => {
  const f = fixture();
  try {
    await act(() => find(f.tree(), 'together-join').props.onPress());
    await act(() => {find(f.tree(), 'together-code').props.onChangeText('ABCDEFGH'); find(f.tree(), 'together-display-name').props.onChangeText('Viewer');});
    const dialog = find(f.tree(), 'together-form');
    await act(() => dialog.props.footer.props.onPress());
    assert.ok(f.pending()); assert.equal(f.pending().isCurrent(), true);
    await act(() => f.pageBack());
    assert.equal(f.pending().signal.aborted, true); assert.equal(f.pending().isCurrent(), false); assert.equal(f.back(), 0);
    f.resolveJoin(false); await act(async () => {});
    f.pageBack(); assert.equal(f.back(), 1); assert.equal(f.ends(), 0);
  } finally {f.dispose();}
});

test('failed join leaves the lobby form escapable without an End command', async () => {
  const f = fixture();
  try {
    await act(() => find(f.tree(), 'together-join').props.onPress());
    await act(() => {find(f.tree(), 'together-code').props.onChangeText('ABCDEFGH'); find(f.tree(), 'together-display-name').props.onChangeText('Viewer');});
    await act(() => find(f.tree(), 'together-form').props.footer.props.onPress());
    f.resolveJoin(false); await act(async () => {});
    await act(() => f.pageBack()); assert.equal(f.back(), 0);
    f.pageBack(); assert.equal(f.back(), 1); assert.equal(f.ends(), 0);
  } finally {f.dispose();}
});
