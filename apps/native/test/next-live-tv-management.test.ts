import assert from 'node:assert/strict';
import test from 'node:test';
import {React, fabricHost} from './helpers/fabric-host.mjs';
import {screenModule} from './helpers/screen-harness.mjs';
import {defaultI18n, catalogue, enUS} from '../../../packages/i18n/src';
import * as dvr from '../../../packages/client-core/src/dvr';
import * as channels from '../../../packages/client-core/src/channel-guide';
import * as guide from '../../../packages/client-core/src/guide';
import * as directory from '../../../packages/client-core/src/guide/directory';
import * as kitModel from '../../../packages/client-core/src/presentation/kit-model';
import * as guidePresentation from '../src-next/screens/settings-live/guide-presentation';
import * as guidePan from '../src-next/screens/settings-live/guide-pan-model';
import * as rules from '../src-next/screens/settings-live/recording-rule-presentation';
import * as shellModel from '../src-next/shell/model';
import {tvFocusIds} from '../src-next/shell/tv-focus';
import {createTheme, nativeType} from '../src-next/kit/theme';
import {stateSentenceParts} from '../src-next/kit/states/sentence-parts';
import {NativeScreenLifetime} from '../src-next/screens/settings-live/lifetime';
import {NativeLiveController} from '../src-next/screens/settings-live/live-controller';
import {nativeServerAdmission} from '../src-next/screens/settings-live/server/tv-server-reader';
import type {DirectSnapshot} from '../../../packages/client-core/src/profile-management';
import {NativeLiveOwnerController} from '../src-next/screens/settings-live/live-owner-controller';
const nodes = (tree: any): any[] => Array.isArray(tree) ? tree.flatMap(nodes) : tree ? [tree, ...nodes(tree.children)] : [];
const noop = () => {}, subscribe = () => noop;
const jsx = (type: any, props: any) => React.createElement(type, props);

// The installed Fabric reconciler runs actual screen branches/effects. Native host
// widgets and editor outlets are controlled; even a closed editor mount is observed.
async function fixture({isTV = true, role = 'owner', primary = 'main', canManage = true, disabled = false, failed = false, populated = false, origin = 'https://server.example/'} = {}) {
  const host = await fabricHost(), listeners = new Set<() => void>(), admin: string[] = [], editors: string[] = [], backs = new Set<() => boolean>();
  const retirement = new AbortController(); let disposed = false, disposedReads = 0;
  let theme = createTheme({isTV, width: isTV ? 1920 : 400}), current = true;
  let authority = {serverId: 'server', accountId: 'owner', profileId: 'main', epoch: 'one', viewerFence: 'fence'};
  let route: any = {revision: 1, route: {kind: 'main'}, destination: {kind: 'live'}};
  let shell: any = {authority, destination: route.destination, contentVisible: true, mediaExpanded: false};
  const listen = (fn: () => void) => {listeners.add(fn); return () => {listeners.delete(fn);};};
  const lifetime = new NativeScreenLifetime({authority: () => authority, current: () => current, subscribeAuthority: listen});
  const api = {request: async <T,>(path: string) => {
    if (path.includes('/admin/')) {admin.push(path); throw new Error('No TV administration allowed');}
    if (failed) throw new Error('Guide unavailable');
    return {protocolVersion: '1.0', serverId: 'server', viewerFence: 'guide', revision: 'one', sources: populated ? [{id: 'source', name: 'A real source', generation: 'one', publishedAt: '2026-10-26T00:00:00Z', availableStart: '2026-10-26T00:00:00Z', availableEnd: '2026-10-28T00:00:00Z', provenance: 'live-source', refreshState: 'ready', position: 0, recordAvailable: true, guideDays: 2, channelCount: 0, favoriteCount: 0, groups: [], groupCounts: [], unavailableReasons: {}}] : [], total: 0, channels: [], nextCursor: ''} as T;
  }};
  const controller = new NativeLiveController(lifetime, api, 'America/Halifax'); await controller.loadSources();
  if (populated) {assert.equal(controller.getSnapshot().sources.length, 1); assert.equal(controller.getSnapshot().error, undefined);}
  if (failed) assert.ok(controller.getSnapshot().error);
  const owner = new NativeLiveOwnerController(lifetime, api, () => 'operation');
  const account: DirectSnapshot = {authority: 'local', serverId: 'server', canManage,
    capabilities: {manageAccount: canManage, managePeople: canManage && role !== 'member', manageServer: canManage && role !== 'member', manageSignIn: canManage && role === 'owner'},
    account: {id: 'owner', username: 'Owner', role: role as DirectSnapshot['account']['role'], primaryProfileId: primary, revision: 1, disabled, allowedLibraries: []},
    profiles: [{id: primary, name: 'Main', primary: true, position: 0, art: 'blue', revision: 1, pinRevision: 0, pinRequired: false}]};
  const context: any = {api: {baseUrl: origin}, account, authority: () => authority,
    current: () => current, navigation: {subscribe: listen, getSnapshot: () => {if (disposed) {disposedReads++; throw new Error('native_shell_cancelled');} return route;}, isCurrent: () => current}};
  const runtime: any = {retirementSignal: retirement.signal, subscribe: listen, getSnapshot: () => {if (disposed) {disposedReads++; throw new Error('native_shell_cancelled');} return shell;}, text: {t: defaultI18n.t, locale: 'en-US'},
    error: (_: unknown, retry: () => void) => ({title: 'Unavailable', primaryAction: {id: 'retry', label: 'Retry', onPress: retry}}), reportError: (error: unknown) => {throw error;}, onDestination: noop};
  const useScreenBack = (_: unknown, fn: () => boolean, enabled: boolean) => React.useEffect(() => {if (enabled) {backs.add(fn); return () => {backs.delete(fn);};}}, [fn, enabled]);
  const pageBack = {enabled: false, page: undefined as any}, entries: any[] = [];
  const native = {View: 'View', Text: 'Text', ScrollView: 'ScrollView', FlatList: 'FlatList', VirtualizedList: 'VirtualizedList', Platform: {OS: 'android'},
    BackHandler: {addEventListener: (_: string, fn: () => boolean) => {backs.add(fn); return {remove: () => backs.delete(fn)};}}, useWindowDimensions: () => ({width: theme.width, height: 1080})};
  const controls = {Button: 'Button', Chip: 'Chip', Focusable: 'Focusable', Segmented: 'Segmented', Select: 'Select', Switch: 'Switch'};
  const focus = {FocusRegion: 'Region', FocusItem: 'FocusItem', useFocusRegistry: () => ({subscribe, cellPosition: () => undefined})};
  const handoff = await screenModule(new URL('../src-next/tv/auth/TVHandoff.tsx', import.meta.url), {
    react: {...React, default: React}, 'react-native': native, 'react-native-qrcode-svg': {default: 'QR'}, '../../../../../packages/i18n/src': {defaultI18n, catalogue, enUS},
    '../../kit/controls': controls, '../../kit/focus': focus, '../../kit/theme': {useTheme: () => theme, nativeType}, '../../kit/states/sentence-parts': {stateSentenceParts},
    '../../platform/native-blur': {}, '../../screens/destinations/useEntryFocus': {}, './TVAuthLayout': {}, './entry-revision': {},
  });
  const common: any = {react: {...React, default: React}, 'react-native': native,
    'react-native-svg': {default: 'Svg', Defs: 'Defs', LinearGradient: 'LinearGradient', Pattern: 'Pattern', Rect: 'Rect', Stop: 'Stop'},
    '../../../../../packages/i18n/src': {defaultI18n}, '../../../../../packages/client-core/src/dvr': dvr, '../../../../../packages/client-core/src/presentation/kit-model': kitModel,
    '../../kit/controls': controls, '../../kit/focus': focus, '../../kit/overlays': {Dialog: 'Dialog', Menu: 'Menu', ToastHost: 'ToastHost'}, '../../kit/artwork': {}, '../../kit/Icon': {Icon: 'Icon'},
    '../../kit/states': {StateView: (props: any) => jsx('StateView', props)}, '../../kit/shell/visual': {alpha: (value: string) => value, shellType: () => ({})},
    '../../kit/theme': {useTheme: () => theme}, '../../shell/tv-focus': {tvFocusIds}, './Screen': {Screen: 'Screen', ScreenText: 'ScreenText', useScreenBack, useScreenEntry: () => noop}, './recording-rule-presentation': rules};
  const recordingModule = await screenModule(new URL('../src-next/screens/settings-live/RecordingsScreen.tsx', import.meta.url), {...common,
    '../../../../../packages/client-core/src/presentation/title-page': {}, '../../../../../packages/client-core/src/media-item': {}, '../../../../../packages/client-core/src/library-content': {}, '../../../../../packages/contracts/src/routes': {},
    './LiveOwnerRecording': {NewRuleSheet: (props: any) => {editors.push(`new-rule:${props.open}`); return jsx('NewRuleEditor', props);}},
  });
  const recordingState = {query: {view: 'upcoming'}, loading: false, busy: false, accessDenied: false, page: {recordings: [], rules: [], captureAvailable: true}};
  const recordings: any = {lifetime, subscribe, getSnapshot: () => recordingState, load: async () => {}, loadFacts: async () => {}};
  const {NativeLiveScreen} = await screenModule(new URL('../src-next/screens/settings-live/LiveScreen.tsx', import.meta.url), {...common,
    'react-native-safe-area-context': {useSafeAreaInsets: () => ({top: 0, bottom: 0, left: 0, right: 0})}, 'react-native-gesture-handler': {GestureDetector: 'GestureDetector'},
    'react-native-reanimated': {default: {View: 'AnimatedView'}, useAnimatedStyle: (fn: () => unknown) => fn()}, '../../../../../packages/client-core/src/channel-guide': channels,
    '../../../../../packages/client-core/src/guide': guide, '../../../../../packages/client-core/src/guide/directory': directory, './GuideLoadingMarker': {GuideLoadingMarker: 'Loading'},
    '../../platform/platformPosture': {usePlatformPosture: () => ({status: 'unavailable'})}, '../../shell/model': shellModel, './RecordingsScreen': recordingModule, '../../tv/layout/guide-focus': {},
    '../destinations/useTVPageBack': {useTVPageBack: (_r: unknown, _d: unknown, enabled: boolean, page: any) => {pageBack.enabled = enabled; pageBack.page = page;}},
    '../destinations/useEntryFocus': {useDestinationEntryFocus: (...args: any[]) => entries.push(args)}, './guide-presentation': guidePresentation,
    './useGuideTimePan': {useGuideTimePan: () => ({active: false, position: {value: 0}})}, './guide-pan-model': guidePan, './LivePhonePicker': {NativeLivePhonePicker: 'PhonePicker'},
    './LiveOwnerScreen': {NativeLiveOwnerScreen: (props: any) => {editors.push(`owner:${props.initialAction}`); return jsx('OwnerEditor', props);}},
    './LiveSeriesRule': {NativeSeriesRuleSheet: 'SeriesRule'}, './server/tv-server-reader': {nativeServerAdmission}, '../../tv/auth': handoff, '../../tv/auth/TVHandoff': handoff,
  });
  const ports = {context};
  let showingRecordings = false;
  const render = () => host.render(showingRecordings ? jsx(recordingModule.NativeRecordingsScreen, {controller: recordings, ports, runtime, owner, onGuide: noop}) : jsx(NativeLiveScreen, {controller, recordings, owner, ports, runtime})); await render();
  const all = () => nodes(host.root), find = (id: string) => all().find(node => node.props?.testID === id);
  return {host, all, find, admin, editors, backs, pageBack, entries,
    disposeRuntime() {retirement.abort(); disposed = true;}, disposedReads: () => disposedReads,
    async press(id = 'live-owner-open') {const node = find(id); assert.ok(node, id); assert.ok(!node.props.disabled); node.props.onPress(); await host.settle();},
    async action(which: string) {const action = find('live-no-sources')?.props[which]; assert.ok(action); action.onPress(); await host.settle();},
    async replace(change: string) {
      if (change === 'viewer') {authority = {...authority, profileId: 'other'}; shell = {...shell, authority};}
      if (change === 'route') route = {...route, revision: route.revision + 1};
      if (change === 'secondary') context.account = {...context.account, account: {...context.account.account, primaryProfileId: 'other'}};
      if (change === 'disabled') context.account = {...context.account, account: {...context.account.account, disabled: true}};
      if (change === 'canManage') context.account = {...context.account, canManage: false};
      if (change === 'hidden') shell = {...shell, contentVisible: false};
      if (change === 'retire') current = false;
      for (const fn of [...listeners]) fn(); await render();
    },
    async tv() {theme = createTheme({isTV: true, width: 1920}); await render();},
    async recordings() {showingRecordings = true; await render();},
    async close() {await host.unmount(); controller.dispose(); owner.dispose(); lifetime.dispose();},
  };
}

for (const entry of ['manage', 'primaryAction', 'secondaryAction']) test(`TV ${entry} offers only public web management and returns through Back`, async () => {
  const f = await fixture(); try {
    const oldGuide = f.pageBack.page;
    if (entry === 'manage') await f.press(); else await f.action(entry);
    assert.equal(f.all().find(node => node.type === 'QR')?.props.value, 'https://server.example/settings?scope=server&section=live');
    assert.equal(f.pageBack.enabled, false); assert.equal(f.pageBack.page.current(), false);
    assert.equal(oldGuide.current(), false, 'retained Guide ownership cannot react while handoff owns Back');
    assert.ok(f.backs.size); [...f.backs][0]!(); await f.host.settle();
    assert.ok(f.find('live-no-sources')); assert.ok(!f.find('tv-management-handoff'));
    assert.deepEqual(f.editors, []); assert.deepEqual(f.admin, []);
    assert.ok(f.entries.some(([value, target]) => value.visible && target.childId === 'live-owner-open'));
  } finally {await f.close();}
});
for (const change of ['viewer', 'route', 'secondary', 'hidden', 'retire', 'disabled', 'canManage']) test(`TV management retires original opening and callbacks on ${change}`, async () => {
  const f = await fixture(); try {
    const oldOpen = f.find('live-owner-open').props.onPress; await f.press(); const oldBack = [...f.backs][0]!;
    await f.replace(change); oldOpen(); oldBack(); await f.host.settle();
    assert.ok(!f.find('tv-management-handoff')); assert.deepEqual(f.editors, []); assert.deepEqual(f.admin, []);
    if (change === 'route') {await f.press(); oldBack(); await f.host.settle(); assert.ok(f.find('tv-management-handoff'));}
  } finally {await f.close();}
});
for (const [role, primary] of [['member', 'main'], ['admin', 'main'], ['owner', 'other'], ['owner', 'main']]) test(`TV ${role}/${primary} never mounts administrative New-rule`, async () => {
  const f = await fixture({role, primary}); try {
    if (role !== 'owner' || primary !== 'main') {assert.ok(!f.find('live-owner-open')); assert.equal(f.find('live-no-sources')?.props.secondaryAction, undefined);}
    await f.recordings(); assert.ok(!f.find('recordings-new-rule')); assert.deepEqual(f.editors, []); assert.deepEqual(f.admin, []);
  } finally {await f.close();}
});
test('private or invalid origins cannot enable setup actions or publish QR data', async () => {
  for (const origin of ['invalid', 'file://server/', 'https://user:secret@server/', 'https://server/?token=private', 'https://server/#private']) {
    const f = await fixture({origin}); try {
      assert.equal(f.find('live-owner-open')?.props.disabled, true);
      for (const action of ['primaryAction', 'secondaryAction']) assert.equal(f.find('live-no-sources')?.props[action]?.disabled, true);
      f.find('live-owner-open').props.onPress(); await f.host.settle(); assert.ok(!f.all().some(node => node.type === 'QR')); assert.deepEqual(f.admin, []);
    } finally {await f.close();}
  }
});
for (const action of ['primaryAction', 'secondaryAction']) test(`mobile ${action} still opens its editor; retained initial intent cannot mount on TV`, async () => {
  const f = await fixture({isTV: false}); try {
    await f.action(action); assert.ok(f.all().some(node => node.type === 'OwnerEditor'));
    f.editors.length = 0; await f.tv(); assert.ok(!f.all().some(node => node.type === 'OwnerEditor')); assert.deepEqual(f.editors, []);
    await f.recordings(); assert.ok(!f.find('recordings-new-rule')); assert.deepEqual(f.editors, []); assert.deepEqual(f.admin, []);
  } finally {await f.close();}
});
test('mobile owner retains New-rule; a retained open sheet is excluded when the same screen becomes TV', async () => {
  const f = await fixture({isTV: false}); try {
    await f.recordings(); const sheet = f.all().find(node => node.type === 'NewRuleEditor'); assert.ok(sheet); sheet.props.onOpenChange(true); await f.host.settle();
    assert.ok(f.editors.includes('new-rule:true')); f.editors.length = 0;
    await f.tv(); assert.deepEqual(f.editors, []); assert.deepEqual(f.admin, []);
  } finally {await f.close();}
});

for (const state of ['failed', 'populated']) test(`TV management remains view-only with ${state} Guide sources`, async () => {
  const f = await fixture({failed: state === 'failed', populated: state === 'populated'}); try {
    assert.ok(!f.find('live-no-sources'));
    await f.press(); assert.ok(f.find('tv-management-handoff'));
    assert.deepEqual(f.admin, []); assert.deepEqual(f.editors, []);
  } finally {await f.close();}
});

for (const denied of [{disabled: true}, {canManage: false}]) test(`TV initial admission refuses ${JSON.stringify(denied)} without URL publication`, async () => {
  const f = await fixture(denied); try {
    assert.ok(!f.find('live-owner-open'));
    assert.equal(f.find('live-no-sources')?.props.secondaryAction, undefined);
    assert.ok(!f.all().some(node => node.type === 'QR')); assert.deepEqual(f.editors, []); assert.deepEqual(f.admin, []);
  } finally {await f.close();}
});

test('disposed original runtime refuses retained initial setup and Back before either guarded getter', async () => {
  const f = await fixture(); try {
    const initial = f.find('live-owner-open').props.onPress, add = f.find('live-no-sources').props.primaryAction.onPress;
    await f.press(); const oldBack = [...f.backs][0]!;
    f.disposeRuntime();
    assert.doesNotThrow(() => {initial(); add(); oldBack();});
    assert.equal(f.disposedReads(), 0); assert.deepEqual(f.admin, []);
  } finally {await f.close();}
});
