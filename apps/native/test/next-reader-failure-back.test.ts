import test from 'node:test';
import assert from 'node:assert/strict';
import * as React from 'react';
import {act, createHookHost} from './hook-driver.ts';
import {screenModule} from './helpers/screen-harness.mjs';
import {appleReaderEntry, readerAssetEntry, readerNavigationAllowed, readerDelivery} from '../src-next/screens/read/asset-origin';
import {defaultI18n} from '../../../packages/i18n/src';

// BLK-MOB-001: the native host replaces the whole guest with Retry when a Read
// fails, so these vectors exercise the actual unmodified ReadNativeHost render
// and its supplied onBack. Hooks and effects run through the dependency-free
// driver; layout, safe-area pixels and WebView lifecycle remain platform
// evidence. Vectors are sources only for the native reviewer.

type Node = {type: unknown; props: Record<string, any>};
const stub = (name: string) => (props: Record<string, any>) => React.createElement(name, props, props.children);
const flatten = (style: any): Record<string, any> => Array.isArray(style) ? Object.assign({}, ...style.map(flatten)) : style ?? {};
const childrenOf = (node: Node): unknown[] => {
  const children = node.props?.children;
  return Array.isArray(children) ? children.flat(Infinity) : children === undefined || children === null ? [] : [children];
};
function* nodes(value: unknown): Generator<Node> {
  if (Array.isArray(value)) {for (const item of value) yield* nodes(item); return;}
  if (!value || typeof value !== 'object' || !('props' in value)) return;
  const node = value as Node; yield node;
  for (const child of childrenOf(node)) yield* nodes(child);
}
const find = (tree: unknown, match: (node: Node) => boolean): Node | undefined => {
  for (const node of nodes(tree)) if (match(node)) return node;
  return undefined;
};
const byTestID = (tree: unknown, testID: string) => find(tree, node => node.props?.testID === testID);
const byType = (tree: unknown, type: string) => find(tree, node => node.type === type);

type Fixture = Readonly<{versions: 'pending' | 'reject' | 'ready'; width?: number}>;

async function harness(fixture: Fixture) {
  let hostCalls = 0, current = true, versionCalls = 0;
  const disposals: string[] = [], listeners = new Set<() => void>();
  const reader = {dispose: () => disposals.push('host'), confirm() {}, setActive() {}, setCrease() {}, setCreaseRef() {}};
  const session = {manifest: {format: 'pdf', revision: 'r'.repeat(64)}, progress: async () => null, close: async () => {disposals.push('session');}};
  const client = {
    versions: () => {versionCalls++; return fixture.versions === 'pending' ? new Promise(() => {}) : fixture.versions === 'reject' ? Promise.reject(new Error('versions_rejected')) : Promise.resolve({versions: [{sourceId: 'source', inventoryAvailable: true}]});},
    open: async () => session,
    dispose() {},
  };
  const context = {
    api: {reading: () => client},
    current: () => current,
    session: () => ({sessionFamilyId: 'family', viewer: {authority: 'local', serverId: 'server', accountId: 'account', profileId: 'profile', role: 'owner'}}),
    subscribeAuthority(listener: () => void) {listeners.add(listener); return () => {listeners.delete(listener);};},
    navigation: {getSnapshot: () => ({route: {kind: 'read', itemId: 'item', sourceId: 'source'}}), retainedRoutes: () => [], allows: () => true, open: () => true, back() {}},
    authority: () => ({kind: 'owner'}),
  };
  const width = fixture.width ?? 390;
  const {ReadNativeHost} = await screenModule(new URL('../src-next/screens/read/ReadNativeHost.tsx', import.meta.url), {
    react: {...React, default: React},
    'react-native': {
      AppState: {addEventListener: () => ({remove() {}})}, View: stub('View'),
      NativeModules: {PorticoReaderAssets: {bundle: async () => ({url: appleReaderEntry})}},
      useWindowDimensions: () => ({width, height: width === 390 ? 844 : 1024}),
    },
    'react-native-safe-area-context': {useSafeAreaInsets: () => ({top: 47, bottom: 34, left: 0, right: 0})},
    'react-native-webview': {default: 'WebView'},
    '../../../../../packages/client-core/src': {
      createReadingHost: () => {hostCalls++; return reader;}, preferenceValue: () => undefined,
      ReadingError: class extends Error {},
    },
    '../../../../../packages/client-core/src/route-identity': {routeBase64: () => 'route'},
    '../../../../../packages/i18n/src': {defaultI18n},
    '../../platform/server-connections': {nativeRouteCrypto: {random: () => new Uint8Array(24).fill(1)}},
    '../../platform/reading-highlights-save': {readingHighlightsSavePort: () => ({})},
    '../downloads/device': {createNativeDownloadsDevice: () => ({dispose() {}, device: {open: async () => {}}})},
    '../../../platform/offline-downloads': {offlineDownloads: {getSnapshot: () => ({entries: []}), publicationSource: () => ({sourceId: 'source'}), readingSession: async () => session}},
    '../../kit/states': {LoadingPaint: stub('LoadingPaint'), StateView: stub('StateView'), SkeletonBlock: 'SkeletonBlock'},
    '../../kit/controls/Button': {Button: stub('Button')},
    '../../kit/theme': {useTheme: () => ({colors: {ink: '#000'}})},
    '../../platform/platformPosture': {usePlatformPosture: () => ({status: 'unavailable'})},
    './asset-origin': {readerAssetEntry, readerNavigationAllowed, readerDelivery},
    './startup-diagnostics': {readerBridgeDiagnostic: () => undefined, readerStartupDiagnostic: () => undefined, readerStartupProbe: ''},
    './annotation-journal': {NativeAnnotationJournal: class {bind() {} unbind() {} dispose() {}}, nativeAnnotationIdentity: () => ({}), nativeAnnotationLeaseOf: () => ({})},
    './annotation-session': {nativeAnnotationBridge: (value: any) => value.session},
    './annotation-sync': {NativeAnnotationSync: class {flush() {return Promise.resolve();} subscribe() {return () => {};} getSnapshot() {return {};} dispose() {}}},
    './annotation-authoring': {NATIVE_OFFLINE_ANNOTATION_AUTHORING: false},
  });
  return {ReadNativeHost, context, reader, get hostCalls() {return hostCalls;}, get versionCalls() {return versionCalls;}, setCurrent(value: boolean) {current = value; for (const listener of [...listeners]) listener();}, disposals};
}

function mount(component: (props: any) => unknown, props: any) {
  let tree: unknown;
  const host = createHookHost(() => {tree = component(props);});
  return {host, get tree() {return tree;}, update(next: any) {props = next; host.rerender();}};
}

const propsFor = (context: any, overrides: Record<string, unknown> = {}) => ({
  context, target: {itemId: 'item', sourceId: 'source'}, active: true,
  preferences: {getSnapshot: () => ({effective: {}, effectiveSource: {}, fields: []}), subscribe: () => () => {}},
  onBack() {}, onOpenSettings() {}, ...overrides,
});

test('initial loading draws the supplied native Back outside the guest and no duplicate Retry', async () => {
  const fixture = await harness({versions: 'pending'});
  let backs = 0;
  const view = mount(fixture.ReadNativeHost, propsFor(fixture.context, {onBack: () => {backs++;}}));
  view.host.mount();
  assert.ok(byType(view.tree, 'LoadingPaint'), 'the unopened reader keeps the loading paint');
  assert.equal(byType(view.tree, 'StateView'), undefined, 'loading is not the failure StateView');
  const back = byTestID(view.tree, 'native-read-host-back');
  assert.ok(back, 'the loading/no-guest state must render the native Back affordance');
  assert.equal(back!.type, 'Button');
  assert.equal(back!.props.icon, 'i-left');
  assert.equal(back!.props.accessibilityLabel, defaultI18n.t('action.back'));
  assert.equal(flatten(back!.props.style).height, 38, 'phone Back uses the authored 38px control');
  const wrapper = find(view.tree, node => node.props?.pointerEvents === 'box-none');
  assert.ok(wrapper, 'the Back sits in its own safe-area overlay');
  assert.equal(flatten(wrapper!.props.style).top, 55, 'safe-area top (47) plus the authored 8px offset');
  assert.equal(flatten(wrapper!.props.style).left, 12, 'authored leading gutter');
  back!.props.onPress();
  assert.equal(backs, 1, 'active Back presses the supplied callback once');
  view.update(propsFor(fixture.context, {active: false, onBack: () => {backs++;}}));
  byTestID(view.tree, 'native-read-host-back')!.props.onPress();
  assert.equal(backs, 1, 'inactive render never calls the supplied callback');
  view.host.unmount();
});

test('a rejected versions/read step keeps Retry and the native Back reachable', async () => {
  const fixture = await harness({versions: 'reject'});
  let backs = 0;
  const view = mount(fixture.ReadNativeHost, propsFor(fixture.context, {onBack: () => {backs++;}}));
  await act(async () => {view.host.mount(); await new Promise<void>(resolve => setImmediate(resolve));});
  const state = byType(view.tree, 'StateView');
  assert.ok(state, 'the failed read keeps the existing StateView');
  assert.equal(state!.props.primaryAction.id, 'retry', 'Retry stays the existing primary action');
  assert.equal(state!.props.primaryAction.label, defaultI18n.t('next.states.tryAgain'));
  const back = byTestID(view.tree, 'native-read-host-back');
  assert.ok(back, 'the failure state must keep a native Back outside the guest');
  back!.props.onPress();
  assert.equal(backs, 1, 'the live failure Back calls the supplied callback once');
  assert.equal(fixture.versionCalls, 1);
  await act(async () => {
    state!.props.primaryAction.onPress();
    await new Promise<void>(resolve => setImmediate(resolve));
  });
  assert.equal(fixture.versionCalls, 2, 'Retry repeats the same target versions step');
  assert.ok(byTestID(view.tree, 'native-read-host-back'), 'Back stays reachable after Retry');
  view.host.unmount();
});

test('a healthy guest renders no duplicate native Back and a WebView failure projects Back with Retry', async () => {
  const fixture = await harness({versions: 'ready'});
  let backs = 0;
  const view = mount(fixture.ReadNativeHost, propsFor(fixture.context, {onBack: () => {backs++;}}));
  await act(async () => {view.host.mount(); await new Promise<void>(resolve => setImmediate(resolve));});
  const guest = byType(view.tree, 'WebView');
  assert.ok(guest, 'the opened reader hands the document to the guest');
  assert.equal(fixture.hostCalls > 0, true, 'the healthy path creates the reading host');
  assert.equal(byTestID(view.tree, 'native-read-host-back'), undefined, 'the healthy guest already owns the only Back');
  guest!.props.onError();
  await act(async () => {await new Promise<void>(resolve => setImmediate(resolve));});
  assert.ok(byType(view.tree, 'StateView'), 'WebView onError projects the existing failure state');
  assert.equal(byType(view.tree, 'StateView')!.props.primaryAction.id, 'retry');
  const back = byTestID(view.tree, 'native-read-host-back');
  assert.ok(back, 'the projected failure gets the native Back');
  back!.props.onPress();
  assert.equal(backs, 1);
  assert.equal(fixture.hostCalls, 1, 'a failure does not silently open a second reader host');
  view.host.unmount();
});

test('tablet width uses the authored 44px Back control', async () => {
  const fixture = await harness({versions: 'pending', width: 834});
  const view = mount(fixture.ReadNativeHost, propsFor(fixture.context));
  view.host.mount();
  const back = byTestID(view.tree, 'native-read-host-back');
  assert.ok(back);
  assert.equal(flatten(back!.props.style).height, 44, 'tablet-read.html .rtop .back is 44px');
  view.host.unmount();
});
