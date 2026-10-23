import test from 'node:test';
import assert from 'node:assert/strict';
import {defaultI18n} from '../../../packages/i18n/src';
import {nativeDestinationLifetime} from '../src-next/screens/destinations/lifetime';
import {hooks, screenModule} from './helpers/screen-harness.mjs';

test('the ordinary Downloads route registers its own real-data renderer and exact eleven copy bindings', async () => {
  const host = hooks(); let kind: string | undefined, factory: any, retired = 0;
  const device = {getSnapshot: () => ({entries: []})};
  const {nativeDownloadsCopy} = await screenModule(new URL('../src-next/screens/downloads/register.tsx', import.meta.url), {
    react: host.react, 'react-native': {View: 'View', useWindowDimensions: () => ({width: 390, height: 844})}, 'react-native-safe-area-context': {useSafeAreaInsets: () => ({bottom: 34})},
    '../../shell/route-registry': {nativeShellRoutes: {registerRoute: (key: string, create: any) => {kind = key; factory = create;}}},
    '../../shell/model': {phoneBarHeight: () => 84, shellLayout: () => ({tabs: true})}, '../../shell/routes': {titleRoute: (entry: unknown) => ({kind: 'title', entry})},
    './DownloadsScreen': {DownloadsScreen: 'Downloads'}, './device': {createNativeDownloadsDevice: () => ({device, dispose: () => {retired++;}})},
  });
  assert.equal(kind, 'downloads');
  assert.equal(Object.keys(nativeDownloadsCopy).length, 11);
  assert.equal(defaultI18n.t(nativeDownloadsCopy.emptyBody), "Press and hold a title and choose Download. It's kept here to watch without a connection.");
  assert.equal(defaultI18n.t(nativeDownloadsCopy.storageLimitHelp), 'The most space downloads may use on this phone');
  let backs = 0;
  const renderer = factory({current: () => true, authority: () => ({}), navigation: {back: () => {backs++;}}});
  const route = renderer.render({kind: 'downloads'}, {});
  assert.equal(route.props.device, device);
  route.props.back(); assert.equal(backs, 1);
  const tree = host.render(() => route.type(route.props));
  assert.equal(tree.props.style.marginBottom, 84, 'the retained Saved navigation remains visible below the actual route');
  renderer.dispose(); assert.equal(retired, 1);
});

test('Downloads storage authority retires old actions, requests and disconnects without touching a newer viewer', async () => {
  const host = hooks(), connections: any[] = []; let disposed = 0, disconnects = 0;
  const deviceSnapshot = {entries: [], supported: true};
  const device = {
    connect: (...args: any[]) => {connections.push(args);}, disconnect: () => {disconnects++;}, adopt() {},
    getSnapshot: () => deviceSnapshot, subscribe: () => () => {}, open: async () => {}, setSettings: async () => {},
    pause: async () => {}, resume: async () => {}, remove: async () => {}, removeOthers: async () => {},
    displayFacts: async () => ({}), localMedia: async () => ({}), playable: () => '', playabilityReason: () => null, note: () => '',
  };
  const {createNativeDownloadsDevice} = await screenModule(new URL('../src-next/screens/downloads/device.ts', import.meta.url), {
    react: host.react,
    '../../../../../packages/client-core/src/downloads-service': {DownloadsService: class {dispose() {disposed++;}}},
    '../destinations/lifetime': {nativeDestinationLifetime},
    '../../platform/offline-downloads': {offlineDownloads: device, createNativeOfflineDownloadsAdapter: (_: undefined, actual: unknown) => actual},
  });
  const viewer = {serverId: 'server', accountId: 'account', profileId: 'first', authority: 'local'};
  const authority = {...viewer, epoch: 'epoch', viewerFence: 'home-fence'};
  let current = true, finish: (value: unknown) => void = () => {};
  const context = {session: () => ({viewer}), authority: () => authority, current: () => current,
    api: {baseUrl: 'https://server.test', mediaUrl: (path: string) => path, request: () => new Promise(resolve => {finish = resolve;})}};
  const first = createNativeDownloadsDevice(context);
  await first.device.open();
  assert.equal(connections[0][2], viewer);
  assert.equal(first.device.openOffline, undefined);
  const retainedSaved = createNativeDownloadsDevice(context);
  assert.equal(retainedSaved.device.getSnapshot(), first.device.getSnapshot(), 'Saved and Downloads read the same authority-local native snapshot');
  await retainedSaved.device.open();
  assert.equal(connections.length, 1, 'a route round trip cannot create a second native connection');
  first.dispose(); first.dispose();
  assert.equal(disconnects, 0, 'closing one borrower leaves the retained Saved hub connected');
  assert.throws(() => first.device.setSettings({wifiOnly: false}), {code: 'cancelled'}, 'a disposed route cannot mutate through another retained borrower');
  assert.deepEqual(retainedSaved.device.getSnapshot().entries, []);
  const request = connections[0][0].request('/actual');
  current = false; finish({private: 'old'});
  await assert.rejects(request, {code: 'cancelled'});
  assert.throws(() => first.device.getSnapshot(), {code: 'cancelled'});
  assert.throws(() => first.device.setSettings({wifiOnly: false}), {code: 'cancelled'});
  const second = createNativeDownloadsDevice({...context, current: () => true});
  await second.device.open();
  retainedSaved.dispose(); assert.equal(disconnects, 0, 'old disposal leaves the newer singleton connection intact');
  second.dispose(); assert.equal(disconnects, 1); assert.equal(disposed, 2);
});
