import test from 'node:test';
import assert from 'node:assert/strict';
import {screenModule} from './helpers/screen-harness.mjs';

async function factory({tv = false, supported = true, bridge = {localFile() {}}, override}: {
  tv?: boolean; supported?: boolean; bridge?: Record<string, unknown> | null; override?: object;
} = {}) {
  let captured: any;
  const deviceCalls: string[] = [], starts: unknown[][] = [];
  const device = {
    getSnapshot: () => {deviceCalls.push('snapshot');return {supported};},
    open: () => {deviceCalls.push('open');}, connect: () => {deviceCalls.push('connect');},
    adopt: () => {deviceCalls.push('adopt');}, localMedia: () => {deviceCalls.push('file');},
    recordProgress: () => {deviceCalls.push('journal');},
  };
  const started = Promise.resolve();
  const runtime = {installSnapshotCapture() {}, startOffline: (...args: unknown[]) => {starts.push(args);return started;},
    queue: {playEntry: () => {assert.fail('unexpected queue.playEntry');}}};
  const {createNativeShellPlaybackAdapter} = await screenModule(new URL('../src-next/platform/playback/native.ios.tsx', import.meta.url), {
    react: {default: {}},
    'react-native': {
      NativeModules: {PorticoPlaybackModule: {}, PorticoRuntime: {playbackRequestId: () => 'request'}, ...(bridge ? {PorticoDownloads: bridge} : {})},
      NativeEventEmitter: class {addListener() {return {remove() {}};}},
      Platform: {OS: 'ios', isTV: tv, Version: 27}, UIManager: {hasViewManagerConfig: () => true},
      requireNativeComponent: () => 'PorticoPlayer', AppState: {addEventListener: () => ({remove() {}})},
    },
    '../../../../../packages/client-core/src/playback-v1/options': {CapabilityPublisher: class {async publish() {}}},
    '../../../../../packages/client-core/src/playback-v1/local-http': {localV1Http: () => ({})},
    '../../../../../packages/client-core/src/presentation/service-text': {serviceText: (key: string) => key},
    './engine-choice': {parseEngineFeatures: () => ({})},
    './capability-document.ios': {deviceCapabilityDocument: () => ({})},
    './NativeListeningAdapter': {},
    './runtime': {NativePlaybackRuntime: class {constructor(options: unknown) {captured = options;return runtime;}}},
    './scope-http': {PlaybackScopeHttp: class {dispose() {}}},
    './subtitle-file-picker.ios': {appleSubtitleFilePicker: undefined},
    '../../../platform/offline-downloads': {offlineDownloads: device},
    '../video-snapshot': {createVideoSnapshotCapture: () => ({})},
  });
  const adapter = createNativeShellPlaybackAdapter({
    appVersion: 'test', api: {}, session: () => ({viewer: {authority: 'local', profileId: 'profile'}}),
    authority: () => ({serverId: 'server', accountId: 'account', profileId: 'profile', epoch: 'epoch', viewerFence: 'viewer'}),
    settings: () => ({engine: 'native'}), subscribeSettings: () => () => {},
    ...(override ? {offlineDevice: override} : {}),
  });
  await Promise.resolve();
  captured.disposeCapabilities();
  return {adapter, captured, device, deviceCalls, runtime, starts, started};
}

test('Apple installs the same existing offline device and exact runtime forwarder without opening, adopting or connecting it', async () => {
  const x = await factory();
  assert.strictEqual(x.captured.offlineDevice, x.device);
  assert.strictEqual(x.adapter.runtime, x.runtime);
  assert.strictEqual(x.adapter.startOffline, x.runtime.startOffline);
  assert.deepEqual(x.deviceCalls, ['snapshot']);
  assert.deepEqual(x.starts, []);
  const entry = {id: 'download', itemId: 'movie'}, lifetime = {signal: new AbortController().signal, isCurrent: () => true};
  assert.strictEqual(x.adapter.startOffline(entry, lifetime), x.started);
  await x.started;
  assert.equal(x.starts.length, 1);
  assert.strictEqual(x.starts[0]![0], entry);
  assert.strictEqual(x.starts[0]![1], lifetime);
  assert.deepEqual(x.deviceCalls, ['snapshot'], 'the factory never resolves a file or writes another journal');
});

test('Apple never advertises offline playback on TV or without its supported installed native file bridge, even with a supplied device', async () => {
  const override = {getSnapshot: () => ({supported: true})};
  for (const options of [{tv: true}, {bridge: null}, {bridge: {}}, {bridge: {localFile: true}}, {supported: false}]) {
    const x = await factory({...options, override});
    assert.equal(x.captured.offlineDevice, undefined);
    assert.equal(x.adapter.startOffline, undefined);
    assert.equal('startOffline' in x.adapter, false);
    assert.deepEqual(x.starts, []);
    assert.ok(x.deviceCalls.every(call => call === 'snapshot'));
  }
});

test('an explicitly supplied offline device is preserved only behind the genuine Apple file bridge', async () => {
  const override = {};
  const x = await factory({override});
  assert.strictEqual(x.captured.offlineDevice, override);
  assert.strictEqual(x.adapter.startOffline, x.runtime.startOffline);
  assert.deepEqual(x.starts, []);
});
