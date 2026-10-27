import test from 'node:test';
import assert from 'node:assert/strict';
import * as React from 'react';
import {screenModule} from './helpers/screen-harness.mjs';
import {act, createHookHost} from './hook-driver.ts';
import {NativeTogetherController} from '../src-next/screens/settings-live/together-controller.ts';
import {parseGroupSnapshot} from '../../../packages/client-core/src/social-playback.ts';
import {GroupSessionService} from '../../../packages/client-core/src/group-session.ts';
import {NativeScreenLifetime} from '../src-next/screens/settings-live/lifetime.ts';
import {NativeShellNavigation} from '../src-next/shell/routes';
import {nativeTogetherPages} from '../src-next/screens/settings-live/together-page';
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
function fixture(phase = 'idle', actualService?: any) {
  const group = {id: 'group', viewerMemberId: 'member', endedReason: 'ended'}, listeners = new Set<() => void>();
  let state: any = {phase, group: ['idle', 'left'].includes(phase) ? undefined : group, directory: [], busy: false}, back = 0, ends = 0;
  let pending: any, resolveJoin!: (value: boolean) => void; const calls: string[] = [];
  const lifetime = new NativeScreenLifetime({authority: () => ({serverId: 's', accountId: 'a', profileId: 'profile', epoch: 'e', viewerFence: 'v'}), current: () => true, subscribeAuthority: () => () => {}});
  const begin = (kind: string, proof: any) => {calls.push(kind); pending = proof; return new Promise<boolean>(resolve => {resolveJoin = resolve;});};
  const service: any = {getSnapshot: () => state, subscribe: (fn: () => void) => {listeners.add(fn); return () => listeners.delete(fn);},
    refreshDirectory: async () => {}, end: async () => {ends++;}, create: (_draft: unknown, proof: any) => begin('create', proof), open: (_id: string, proof: any) => begin('open', proof),
    join: (_code: string, _who: string, proof: any) => begin('join', proof)};
  const controller = new NativeTogetherController(lifetime, actualService ?? service);
  const authority = () => lifetime.authority, navigation = new NativeShellNavigation(authority(), authority);
  navigation.open({kind: 'together'}, authority());
  const authorityListeners = new Set<() => void>(); let principal = '1';
  const context = {account: {profiles: []}, navigation, current: () => lifetime.current(), subscribeAuthority: (fn: () => void) => {authorityListeners.add(fn); return () => authorityListeners.delete(fn);},
    session: () => ({sessionFamilyId: 'f', tokenGeneration: principal, authorizationHorizon: 'h', deviceId: 'd', installationId: 'i'})};
  const pages = nativeTogetherPages(context as any, lifetime);
  const capture = () => pages.capture(navigation.getSnapshot().route as {kind: 'together'});
  let page = capture();
  const runtime = {text: {t: (s: string) => s}, getSnapshot: () => ({profile: {name: 'Name'}}), reportError: assert.fail};
  let tree: any;
  const mount = () => {const currentPage = page; const host = createHookHost(() => {tree = module.NativeTogetherScreen({page: currentPage, controller, media: {}, ports: {context}, runtime,
    onBack: () => {const snapshot = navigation.getSnapshot(); currentPage.back(); if (navigation.getSnapshot() !== snapshot) back++;}});}); host.mount(); return host;};
  let host = mount();
  return {get host() {return host;}, tree: () => tree, navigation, page: () => page, calls,
    directory: () => {state = {...state, directory: [{id: 'offered', name: 'Offered', members: [], permissions: {isHost: false}, timeline: {state: 'paused'}}]}; for (const fn of listeners) fn();},
    pageBack: () => find(tree.type(tree.props), 'together-page-back').props.onPress(), back: () => back, ends: () => ends, pending: () => pending,
    leave: () => navigation.back(authority()), unmount: () => host.unmount(),
    revisit: () => {host.unmount(); navigation.open({kind: 'together'}, authority()); page = capture(); host = mount();},
    restore: () => {host.unmount(); navigation.open({kind: 'account'}, authority()); navigation.back(authority()); page = capture(); host = mount();},
    replacePrincipal: () => {principal = '2'; for (const fn of authorityListeners) fn();},
    resolveJoin: (value: boolean) => resolveJoin(value), dispose: () => {host.unmount(); pages.dispose(); navigation.dispose(); controller.dispose(); lifetime.dispose();}};

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


test('late successful server join after page Back is not adopted by the real authority service', async () => {
  let answer!: (value: any) => void, requestSignal: AbortSignal | undefined, streams = 0;
  const service = new GroupSessionService({api: {baseUrl: 'https://example.invalid', request: async (path, _method, _body, signal) => {
    if (path === '/v1/groups') return {protocolVersion: '1.0', serverTime: '2026-09-16T20:00:00Z', groups: []} as any;
    requestSignal = signal; return new Promise<any>(resolve => {answer = resolve;});
  }}, stream: async () => {streams++; return new Response(null, {status: 200});}, key: () => 'key'});
  const f = fixture('idle', service);
  const timestamp = '2026-09-16T20:00:00Z';
  const host = {id: 'mem_1', displayName: 'Host', private: false, role: 'host', state: 'joined', readiness: 'ready', positionUs: '0', reportedAt: timestamp, presence: 'connected', joinedAt: timestamp};
  const group = {id: 'grp_1', name: 'Night', state: 'playing', hostAuthority: 'host-only', hostMemberId: 'mem_1', revision: '7', playbackRevision: '3', settingsRevision: '1', governanceRevision: '1', queueRevision: '2', reconnectGeneration: '1', lastCommand: 'play', lastCommandId: 'p', endedReason: '', eventOrdinal: '9', createdAt: timestamp, updatedAt: timestamp,
    permissions: {isHost: true, canControl: true, canManageQueue: true}, authority: {deviceId: 'dev_1', playbackId: 'pb1', state: 'bound'}, host: {presence: 'connected', lastSeenAt: timestamp, pauseAt: null, endAt: null},
    timeline: {itemId: 'item', currentEntryId: 'ent_1', state: 'playing', anchorPositionUs: '10000000', anchorAt: timestamp, rate: {numerator: '1', denominator: '1'}, queuePosition: 0, waitUntil: null},
    settings: {shuffleEnabled: false, repeatMode: 'none'}, sync: {noCorrectionUnderMs: 750, rateCorrectionMinimum: '0.90', rateCorrectionMaximum: '1.10', rateCorrectionMaxMs: 4000, seekAtOrOverMs: 3000},
    readiness: {aggregate: 'ready', ready: 1, buffering: 0, lagging: 0, stale: 0, memberCount: 1}, members: [host], queue: null, viewerMemberId: 'mem_1'};
  try {
    await act(() => find(f.tree(), 'together-join').props.onPress());
    await act(() => {find(f.tree(), 'together-code').props.onChangeText('ABCDEFGH'); find(f.tree(), 'together-display-name').props.onChangeText('Viewer');});
    await act(() => find(f.tree(), 'together-form').props.footer.props.onPress());
    assert.ok(requestSignal); await act(() => f.pageBack()); assert.equal(requestSignal!.aborted, true);
    const accepted = {protocolVersion: '1.0', serverTime: timestamp, group};
    assert.equal(parseGroupSnapshot(accepted).group.id, 'grp_1');
    answer(accepted); await act(async () => {});
    assert.equal(service.getSnapshot().phase, 'idle'); assert.equal(service.getSnapshot().group, undefined); assert.equal(streams, 0);
    await act(() => f.pageBack()); assert.equal(f.back(), 1); assert.equal(f.ends(), 0);
    f.dispose(); assert.equal(service.getSnapshot().phase, 'idle', 'page disposal does not dispose authority service');
  } finally {f.dispose(); service.dispose();}
});

for (const retirement of ['exit', 'unmount', 'revisit', 'principal'] as const) test(`retained original Together lobby actions refuse after ${retirement}`, async () => {
  const f = fixture();
  try {
    await act(() => f.directory());
    const join = find(f.tree(), 'together-join').props.onPress, start = find(f.tree(), 'together-start').props.onPress;
    const open = find(f.tree(), 'together-group-offered').props.onPress, back = find(f.tree().type(f.tree().props), 'together-page-back').props.onPress;
    if (retirement === 'principal') f.replacePrincipal();
    else if (retirement === 'unmount') f.unmount();
    else {f.leave(); if (retirement === 'revisit') f.revisit();}
    await act(() => {join(); start(); open(); back();});
    assert.deepEqual(f.calls, []); assert.equal(f.back(), 0); assert.equal(f.ends(), 0);
    assert.equal(find(f.tree(), 'together-form').props.open, false);
    if (retirement === 'revisit') {
      await act(() => find(f.tree(), 'together-join').props.onPress());
      assert.equal(find(f.tree(), 'together-form').props.open, true);
    }
  } finally {f.dispose();}
});

for (const kind of ['join', 'start'] as const) test(`old ${kind} submit, close, fields and Back cannot cancel a reopened form's original request`, async () => {
  const f = fixture();
  try {
    await act(() => find(f.tree(), `together-${kind}`).props.onPress());
    if (kind === 'join') await act(() => find(f.tree(), 'together-code').props.onChangeText('ABCDEFGH'));
    await act(() => find(f.tree(), 'together-display-name').props.onChangeText('Original viewer'));
    const oldDialog = find(f.tree(), 'together-form'), oldSubmit = oldDialog.props.footer.props.onPress;
    const oldField = find(f.tree(), 'together-display-name').props.onChangeText;
    const oldBack = find(f.tree().type(f.tree().props), 'together-page-back').props.onPress;
    await act(() => oldDialog.props.onOpenChange(false));
    await act(() => find(f.tree(), 'together-join').props.onPress());
    await act(() => {find(f.tree(), 'together-code').props.onChangeText('IJKLMNOP'); find(f.tree(), 'together-display-name').props.onChangeText('Current viewer');});
    await act(() => find(f.tree(), 'together-form').props.footer.props.onPress());
    const originalPending = f.pending(); assert(originalPending?.isCurrent()); assert.equal(originalPending.signal.aborted, false);
    await act(() => {oldSubmit(); oldDialog.props.onOpenChange(false); oldBack(); oldField('Stale viewer');});
    assert.deepEqual(f.calls, ['join']); assert.equal(f.pending(), originalPending); assert.equal(originalPending.isCurrent(), true); assert.equal(originalPending.signal.aborted, false);
    assert.equal(find(f.tree(), 'together-form').props.open, true); assert.equal(find(f.tree(), 'together-display-name').props.value, 'Current viewer');
    f.resolveJoin(true); await act(async () => {});
    assert.equal(find(f.tree(), 'together-form').props.open, false, 'live original success closes only its own form');
  } finally {f.dispose();}
});

test('retained submit after page exit/revisit refuses while a successor original join remains current', async () => {
  const f = fixture();
  try {
    await act(() => find(f.tree(), 'together-join').props.onPress());
    const oldSubmit = find(f.tree(), 'together-form').props.footer.props.onPress;
    f.leave(); f.revisit();
    await act(() => find(f.tree(), 'together-join').props.onPress());
    await act(() => {find(f.tree(), 'together-code').props.onChangeText('ABCDEFGH'); find(f.tree(), 'together-display-name').props.onChangeText('Viewer');});
    await act(() => find(f.tree(), 'together-form').props.footer.props.onPress());
    const original = f.pending(); await act(() => oldSubmit());
    assert.deepEqual(f.calls, ['join']); assert.equal(original.signal.aborted, false); assert.equal(original.isCurrent(), true);
    f.resolveJoin(false); await act(async () => {});
  } finally {f.dispose();}
});


test('returning to the same actual Together occurrence issues a fresh page opening without reviving its old form callbacks', async () => {
  const f = fixture();
  try {
    await act(() => find(f.tree(), 'together-join').props.onPress());
    const old = find(f.tree(), 'together-form').props.footer.props.onPress, page = f.page();
    const occurrence = f.navigation.presentationStack().at(-1)?.occurrence;
    f.restore();
    assert.equal(f.navigation.presentationStack().at(-1)?.occurrence, occurrence);
    assert.notEqual(f.page().key, page.key); assert.equal(page.current(), false); assert.equal(f.page().current(), true);
    assert.equal(find(f.tree(), 'together-form').props.open, false);
    await act(() => old()); assert.deepEqual(f.calls, []);
    await act(() => find(f.tree(), 'together-join').props.onPress());
    assert.equal(find(f.tree(), 'together-form').props.open, true);
    await act(() => f.pageBack()); assert.equal(find(f.tree(), 'together-form').props.open, false);
  } finally {f.dispose();}
});
