import test from 'node:test';
import assert from 'node:assert/strict';
import * as React from 'react';
import {screenModule} from './helpers/screen-harness.mjs';

// Contract source for BLK-PLAY-001: the Apple factory must forward the five
// already-installed runtime commands unchanged. This drives the real native.ios
// factory with mocked platform modules and a fake runtime; it does not run a
// player, touch native code or claim a device result.

const calls: {name: string; args: unknown[]; self: object}[] = [];
class FakeRuntime {
  queue = {playEntry: function (this: object, ...args: unknown[]) {calls.push({name: 'queuePlay', args, self: this});}};
  dock = {};
  installSnapshotCapture = () => {};
  isSnapshotSourceCurrent = () => true;
  refreshAuthority = async () => {};
  flush = async () => {};
  getSnapshot = () => ({fence: undefined, lease: undefined});
  subscribe = () => () => {};
  constructor(public options: unknown) {}
  start = () => {};
  startVersion = () => {};
  selectionPlayback = () => {};
  cataloguePlayback = () => {};
  change = () => {};
  chooseQuality = () => {};
  setRate = () => {};
  subtitleControls = () => ({});
  readSession = () => {};
  prepareExternalPresentation = () => {};
  requestPictureInPicture = () => {};
  onTransition = () => {};
  toggle = () => {};
  replay = () => {};
  retry = (...args: unknown[]) => {calls.push({name: 'retry', args, self: this});};
  setQueuePolicy = (...args: unknown[]) => {calls.push({name: 'setQueuePolicy', args, self: this});};
  editQueue = (...args: unknown[]) => {calls.push({name: 'editQueue', args, self: this});};
  selectQueuedEntry = (...args: unknown[]) => {calls.push({name: 'selectQueuedEntry', args, self: this});};
  seek = () => {};
  skip = () => {};
  previous = () => {};
  next = () => {};
  stop = () => {};
  goLive = () => {};
  setSleepTimer = () => {};
  beginRemote = () => {};
  updateRemote = () => {};
  dismissRemote = () => {};
  continueHere = () => {};
  restoreBookmark = () => {};
  open = () => {};
  dispose = () => {};
  captureVideoSnapshot = () => {};
}

const viewer = {authority: 'local', serverId: 'server', accountId: 'account', profileId: 'profile'};
const authority = {serverId: 'server', accountId: 'account', profileId: 'profile', epoch: 'epoch', viewerFence: 'f'.repeat(64)};
const nativeModules = {
  PorticoPlaybackModule: {acquire: async () => ({lease: 'lease', instanceId: 'instance'}), command: async () => ({}), release: async () => {}},
  PorticoRuntime: {playbackRequestId: () => 'request', getConstants: () => ({pictureInPictureSupported: false})},
};
const native = {
  Platform: {OS: 'ios', isTV: false, Version: '17.0'},
  NativeModules: nativeModules,
  NativeEventEmitter: class {addListener() {return {remove() {}};}},
  AppState: {addEventListener: () => ({remove() {}})},
  UIManager: {hasViewManagerConfig: () => true},
  requireNativeComponent: () => 'PorticoPlayer',
  findNodeHandle: () => 1,
};
const theme = {colors: {ink: '#000'}, platform: 'phone'};
const modules = {
  react: {...React, default: React},
  'react-native': native,
  '../../../../../packages/client-core/src/playback-v1/options': {CapabilityPublisher: class {publish = async () => {}}},
  '../../../../../packages/client-core/src/playback-v1/local-http': {localV1Http: () => ({})},
  '../../../../../packages/client-core/src/presentation/service-text': {serviceText: (key: string) => key},
  './engine-choice': {parseEngineFeatures: () => ({})},
  './capability-document.ios': {deviceCapabilityDocument: () => ({})},
  './NativeListeningAdapter': {NativeListeningV1Adapter: class {}},
  './runtime': {NativePlaybackRuntime: FakeRuntime},
  './scope-http': {PlaybackScopeHttp: class {constructor() {}}},
  './subtitle-file-picker.ios': {appleSubtitleFilePicker: () => {}},
  '../../../platform/offline-downloads': {offlineDownloads: {getSnapshot: () => ({supported: false})}},
  '../video-snapshot': {createVideoSnapshotCapture: () => ({})},
  './types': {},
  '../../kit/theme': {useTheme: () => theme},
};

const {createNativeShellPlaybackAdapter} = await screenModule(new URL('../src-next/platform/playback/native.ios.tsx', import.meta.url), modules);
const options = {
  appVersion: 'test', session: () => ({viewer}), authority: () => authority,
  api: {baseUrl: 'https://server.invalid', getRouteConnection: () => ({})},
  settings: () => ({overrides: {}}), subscribeSettings: () => () => {},
};
const adapter = createNativeShellPlaybackAdapter(options as never);
const runtime = adapter.runtime as unknown as FakeRuntime;

test('Apple factory forwards the five existing runtime ports without substitution', () => {
  assert.strictEqual(adapter.retry, runtime.retry);
  assert.strictEqual(adapter.selectQueuedEntry, runtime.selectQueuedEntry);
  assert.strictEqual(adapter.setQueuePolicy, runtime.setQueuePolicy);
  assert.strictEqual(adapter.editQueue, runtime.editQueue);
  assert.notStrictEqual(adapter.queuePlay, runtime.queue.playEntry);
});

test('forwarded commands dispatch to the exact runtime with original arguments', () => {
  calls.length = 0;
  const signal = new AbortController().signal;
  adapter.retry('fence' as never, 7 as never, 'request' as never, signal as never);
  adapter.selectQueuedEntry('fence' as never, 'entry' as never, 7 as never, signal as never);
  adapter.setQueuePolicy('fence' as never, 'repeat-all' as never, 7 as never);
  adapter.editQueue('fence' as never, 'entry' as never, 7 as never);
  assert.equal(calls[0]?.name, 'retry');
  assert.equal(calls[0]?.self, runtime);
  assert.deepEqual(calls[0]?.args, ['fence', 7, 'request', signal]);
  assert.equal(calls[1]?.name, 'selectQueuedEntry');
  assert.equal(calls[1]?.self, runtime);
  assert.deepEqual(calls[1]?.args, ['fence', 'entry', 7, signal]);
  assert.equal(calls[2]?.name, 'setQueuePolicy');
  assert.equal(calls[2]?.self, runtime);
  assert.deepEqual(calls[2]?.args, ['fence', 'repeat-all', 7]);
  assert.equal(calls[3]?.name, 'editQueue');
  assert.equal(calls[3]?.self, runtime);
  assert.deepEqual(calls[3]?.args, ['fence', 'entry', 7]);
});

test('queuePlay keeps the queue receiver and forwards the exact arguments', () => {
  calls.length = 0;
  const signal = new AbortController().signal;
  adapter.queuePlay('entry' as never, 7 as never, signal as never);
  assert.equal(calls.length, 1);
  assert.equal(calls[0]?.name, 'queuePlay');
  assert.equal(calls[0]?.self, runtime.queue);
  assert.deepEqual(calls[0]?.args, ['entry', 7, signal]);
});
