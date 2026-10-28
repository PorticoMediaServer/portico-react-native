import test from 'node:test';
import assert from 'node:assert/strict';
import {screenModule} from './helpers/screen-harness.mjs';
import {serviceText} from '../../../packages/client-core/src/presentation/service-text.ts';
import * as capabilityReadiness from '../src-next/platform/playback/capability-readiness.ts';

type ApplePicker = typeof import('../src-next/platform/playback/subtitle-file-picker.ios').appleSubtitleFilePicker;
const file = (patch: Record<string, unknown> = {}) => ({data: 'YQ==', format: 'srt', title: 'selected.srt', ...patch});
const native = () => ({pick: async (_id: string): Promise<unknown> => file(), cancel: async (_id: string): Promise<unknown> => true});
async function port(bridge: Record<string, unknown> | undefined = native(), id: unknown = async () => 'request-1', platform = {OS: 'ios', isTV: false}): Promise<ApplePicker> {
  return (await screenModule(new URL('../src-next/platform/playback/subtitle-file-picker.ios.ts', import.meta.url), {
    react: {default: {}},
    'react-native': {NativeModules: {PorticoSubtitleFiles: bridge, PorticoRuntime: {newRequestId: id}}, Platform: platform},
    '../../../../../packages/client-core/src/presentation/service-text': {serviceText},
  })).appleSubtitleFilePicker as ApplePicker;
}
const signal = () => new AbortController().signal;
const generic = {message: serviceText('player.subtitles.changeFailed')};

test('Apple picker is exposed only with its actual complete phone/tablet bridge', async () => {
  for (const bridge of [undefined, {}, {pick: async () => file()}, {cancel: async () => true}]) {
    // Passing undefined intentionally differs from the helper's default fixture.
    const value = bridge === undefined ? await port({}, undefined) : await port(bridge);
    assert.equal(value, undefined);
  }
  assert.equal(await port(native(), null), undefined);
  assert.equal(await port(native(), async () => 'id', {OS: 'ios', isTV: true}), undefined);
  assert.equal(await port(native(), async () => 'id', {OS: 'android', isTV: false}), undefined);
  assert.ok(await port());
});

test('Apple returns only bounded selected bytes using a genuine native request identifier', async () => {
  const calls: unknown[] = [];
  const p = await port({pick: async (id: string) => {calls.push(['pick', id]); return file();}, cancel: async (id: string) => {calls.push(['cancel', id]); return true;}}, async () => {calls.push('native-id'); return 'native-uuid';});
  const result = await p!.pick(signal());
  assert.deepEqual(result, file());assert.ok(Object.isFrozen(result));assert.deepEqual(calls, ['native-id', ['pick', 'native-uuid']]);
  const pair = await port({...native(), pick: async () => file({format: 'idx', title: 'selected.idx', companion: 'Yg=='})});
  assert.deepEqual(await pair!.pick(signal()), file({format: 'idx', title: 'selected.idx', companion: 'Yg=='}));
});

test('pre-abort and abort during native ID allocation never present a picker', async () => {
  let picks = 0, ids = 0, finish!: (id: string) => void;
  const p = await port({...native(), pick: async () => {picks++;return file();}}, () => {ids++;return new Promise<string>(resolve => {finish = resolve;});});
  const first = new AbortController();first.abort();assert.equal(await p!.pick(first.signal), undefined);assert.equal(ids, 0);
  const pending = new AbortController(), result = p!.pick(pending.signal);pending.abort();assert.equal(await result, undefined);
  finish('late-id');await Promise.resolve();assert.equal(picks, 0);
});

test('abort returns promptly, cancels exactly its request and discards a late native selection', async () => {
  let complete!: (value: unknown) => void, began!: () => void;
  const started = new Promise<void>(resolve => {began = resolve;}), cancelled: string[] = [];
  const p = await port({pick: () => {began();return new Promise(resolve => {complete = resolve;});}, cancel: async (id: string) => {cancelled.push(id);throw Error('private cancel diagnostic');}}, async () => 'owned-request');
  const controller = new AbortController(), result = p!.pick(controller.signal);await started;controller.abort();
  assert.equal(await result, undefined);assert.deepEqual(cancelled, ['owned-request']);complete(file());await Promise.resolve();
});

test('an old abort/receipt cannot cancel or replace another native picker request', async () => {
  const controllers = [new AbortController(),new AbortController()];
  let id = 0, finishOld!: (value: unknown) => void, began!: () => void;
  const started = new Promise<void>(resolve => {began = resolve;}), cancelled: string[] = [];
  const p = await port({pick: (key: string) => key === 'id-1' ? new Promise(resolve => {finishOld = resolve;began();}) : Promise.resolve(file({title:'new.srt'})), cancel: async (key: string) => {cancelled.push(key);return true;}}, async () => `id-${++id}`);
  const old = p!.pick(controllers[0]!.signal);await started;controllers[0]!.abort();assert.equal(await old, undefined);
  assert.equal((await p!.pick(controllers[1]!.signal))?.title, 'new.srt');finishOld(file({title:'old.srt'}));await Promise.resolve();
  controllers[1]!.abort();assert.deepEqual(cancelled, ['id-1'], 'completed request removes its abort listener');
});

test('native user cancellation is silent, all other diagnostic text stays out of UI errors', async () => {
  const cancelled = await port({...native(),pick: async () => {throw Object.assign(Error('private path'),{code:'cancelled'});}});
  assert.equal(await cancelled!.pick(signal()), undefined);
  for (const failing of [async () => {throw Error('private file path');}, () => {throw Error('private synchronous path');}]) {
    const p = await port({...native(),pick:failing});await assert.rejects(p!.pick(signal()),generic);
  }
});

test('malformed native identities, payloads, companions and private extra fields are refused', async () => {
  for (const value of ['', '../id', 42, 'x'.repeat(129)]) {
    let picks = 0;const p = await port({...native(),pick: async () => {picks++;return file();}}, async () => value);
    await assert.rejects(p!.pick(signal()),generic);assert.equal(picks, 0);
  }
  for (const value of [null,[],{},file({data:''}),file({data:'YR=='}),file({data:'YQ='}),file({format:'mks'}),file({companion:'Yg=='}),file({format:'idx'}),file({fileURL:'file:///private/path'}),file({title:''}),file({title:'x'.repeat(161)})]) {
    const p = await port({...native(),pick:async () => value});await assert.rejects(p!.pick(signal()),generic);
  }
});

test('Apple enforces the native text limit without decoding or storing a second file copy', async () => {
  const exact = Buffer.alloc(4*1024*1024).toString('base64');
  const p = await port({...native(),pick:async () => file({data:exact})});assert.equal((await p!.pick(signal()))?.data, exact);
  const over = await port({...native(),pick:async () => file({data:Buffer.alloc(4*1024*1024+1).toString('base64')})});
  await assert.rejects(over!.pick(signal()),generic);
});

test('the actual Apple factory injects only the installed platform picker into its existing runtime', async () => {
  for (const kind of ['handheld', 'tv', 'missing'] as const) {
    let picks = 0, callerPicks = 0;
    const platform = {OS: 'ios', isTV: kind === 'tv', Version: 27};
    const actual = await port(kind === 'missing' ? {} : {...native(), pick: async () => {picks++;return file();}}, async () => 'factory-request', platform);
    let captured: any;
    const runtime = {installSnapshotCapture() {}, queue: {playEntry: () => {assert.fail('unexpected queue.playEntry');}}};
    const {createNativeShellPlaybackAdapter} = await screenModule(new URL('../src-next/platform/playback/native.ios.tsx', import.meta.url), {
      react: {default: {}},
      'react-native': {
        NativeModules: {PorticoPlaybackModule: {}, PorticoRuntime: {playbackRequestId: () => 'playback-request'}},
        NativeEventEmitter: class {addListener() {return {remove() {}};}},
        Platform: platform, UIManager: {hasViewManagerConfig: () => true}, requireNativeComponent: () => 'PorticoPlayer',
        AppState: {addEventListener: () => ({remove() {}})},
      },
      '../../../../../packages/client-core/src/playback-v1/options': {CapabilityPublisher: class {async publish() {}}},
      '../../../../../packages/client-core/src/playback-v1/local-http': {localV1Http: () => ({})},
      '../../../../../packages/client-core/src/presentation/service-text': {serviceText},
      './engine-choice': {parseEngineFeatures: () => ({})},
      './dynamic-range-matching': {nativeDynamicRangeMatchingAvailable: () => false}, './capability-readiness': capabilityReadiness,
      './capability-document.ios': {deviceCapabilityDocument: () => ({})},
      './NativeListeningAdapter': {},
      './runtime': {NativePlaybackRuntime: class {constructor(options: unknown) {captured = options;return runtime;}}},
      './scope-http': {PlaybackScopeHttp: class {dispose() {}}},
      './subtitle-file-picker.ios': {appleSubtitleFilePicker: actual},
      '../../../platform/offline-downloads': {offlineDownloads: {getSnapshot: () => ({supported: false})}},
      '../video-snapshot': {createVideoSnapshotCapture: () => ({})},
    });
    const adapter = createNativeShellPlaybackAdapter({
      appVersion: 'test', api: {}, session: () => ({viewer: {authority: 'local', profileId: 'profile'}}),
      authority: () => ({serverId: 'server', accountId: 'account', profileId: 'profile', epoch: 'epoch', viewerFence: 'viewer'}),
      settings: () => ({engine: 'native'}), subscribeSettings: () => () => {},
      subtitleFilePicker: {pick: async () => {callerPicks++;return file();}},
    });
    assert.strictEqual(adapter.runtime, runtime);
    assert.strictEqual(captured.subtitleFilePicker, actual);
    assert.equal(picks, 0, 'factory construction must not open the native picker');
    if (kind === 'handheld') assert.deepEqual(await captured.subtitleFilePicker.pick(signal()), file());
    else assert.equal(captured.subtitleFilePicker, undefined, 'TV/missing native bridge never inherit a caller-supplied picker');
    assert.equal(picks, kind === 'handheld' ? 1 : 0);
    assert.equal(callerPicks, 0);
    captured.disposeCapabilities();
  }
});
