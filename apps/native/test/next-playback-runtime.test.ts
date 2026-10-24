import test from 'node:test';
import {fabricPlayback} from './helpers/fabric-playback-harness.mjs';
import assert from 'node:assert/strict';
import {HttpLocalApi, type LocalSession} from '../../../packages/client-core/src/index.ts';
import {FakePlaybackServer, type FakeRequest, type FakeResponse} from '../../../packages/client-core/src/playback-v1/testing/fake-server.ts';
import {encodedRoutePath, routePath} from '../../../packages/contracts/src/routes.ts';
import {queueItemInput} from '../../../packages/client-core/src/queue-controller.ts';
import {NativePlaybackRuntime} from '../src-next/platform/playback/runtime.ts';
import type {NativePlaybackSettings, PlaybackAuthority} from '../src-next/platform/playback/types.ts';
import {nativeEngineFeatures, type EngineFeatures} from '../src-next/platform/playback/engine-choice.ts';
import type {NativePlaybackTransport} from '../src-next/platform/playback/NativePlaybackCoordinator.ts';
import type {HomeChannel} from '../../../packages/client-core/src/home.ts';
import type {HomeSelectionPlaybackItem} from '../../../packages/client-core/src/home-selection/types.ts';
import type {SelectionContext} from '../../../packages/client-core/src/selection-model/index.ts';
import type {VideoSnapshotSource} from '../src-next/platform/video-snapshot.ts';
import type {Marker} from '../../../packages/client-core/src/playback-v1/types.ts';
import type {NativeSubtitleFilePicker} from '../src-next/platform/playback/subtitle-file-upload.ts';
import {externalSubtitlePreparation} from '../src-next/platform/playback/engine-media.ts';
import {NativeWatchOutlet, type NativeExpandedVideoSlot, type NativeWatchLease} from '../src-next/shell/watch-outlet.ts';
import type {NativeOfflinePlaybackDevice} from '../src-next/platform/playback/offline-playback.ts';
import type {OfflineEntry, OfflineSnapshot} from '../platform/offline-downloads.ts';
import type {LocalMedia, LocalProgress} from '../platform/local-playback.ts';
import {readNativePlaybackInfo} from '../src-next/screens/watch/playback-info.ts';
import {committedInfo, infoWords} from './helpers/playback-info.ts';
import type {ObservedPlayback} from '../../../packages/client-core/src/playback-v1/observed-playback.ts';
import type {PlaybackInfoWords} from '../../../packages/client-core/src/playback-info-projection.ts';

const settle = async (count = 40) => { for (let i = 0; i < count; i++) await new Promise(resolve => setImmediate(resolve)); };
const versionLifetime = (isCurrent: () => boolean = () => true) => ({signal: new AbortController().signal, isCurrent});
const record = (value: unknown): value is Record<string, unknown> => typeof value === 'object' && value !== null;
const seekRequest = (request: FakeRequest, positionMs: number) => request.method === 'PATCH' && record(request.body) && record(request.body.seek) && request.body.seek.positionMs === positionMs;
const playingRequest = (request: FakeRequest) => record(request.body) && request.body.state === 'playing';
type Command = Record<string, any>;
class Engine implements NativePlaybackTransport {
  commands: Command[] = [];
  released: string[] = [];
  subscriptions = 0;
  listener?: (fact: any) => void;
  position = 0;
  acknowledgeSeeks = true;
  externalReady = false;
  private sequence = 0;
  private leases = 0;
  private key = '';
  private last?: Command;
  async acquire() { this.sequence = 0; return {lease: `lease-${++this.leases}`, instanceId: 'engine-instance'}; }
  async release(lease: string) { this.released.push(lease); }
  subscribe(listener: (fact: any) => void) { this.subscriptions++; this.listener = listener; return () => { this.subscriptions--; if (this.listener === listener) this.listener = undefined; }; }
  async command(command: Command) {
    this.commands.push(command); this.last = command;
    queueMicrotask(() => {
      const key = JSON.stringify(command.binding) + command.source;
      if (key !== this.key) { this.key = key; this.emit('ready'); }
      if (command.pendingSeek) {
        this.position = command.pendingSeek.positionSeconds;
        if (this.acknowledgeSeeks) this.emit('seekApplied', {seekRevision: command.pendingSeek.revision});
      } else this.emit('progress');
    });
  }
  emit(type: string, extra: Command = {}) {
    const command = this.last;
    if (!command) return;
    this.listener?.({type, instanceId: 'engine-instance', binding: command.binding, intentId: command.binding.intentId,
      factSequence: ++this.sequence, lastCommandRevision: command.commandRevision, position: this.position, paused: command.paused,
      effectiveRate: command.paused ? 0 : command.rate, supportedRates: [.5, 1, 1.5, 2], ...(this.externalReady ? {externalPresentationBinding: command.binding} : {}), ...extra});
  }
  get lastCommand() { return this.commands.at(-1)!; }
}

const homeFence = 'a'.repeat(64), detailFence = 'b'.repeat(64);
const itemKind = (id: string) => id.startsWith('song') ? 'song' as const : id.startsWith('episode') ? 'episode' as const : 'movie' as const;
function fixture(groupedVersions = false, subtitleFilePicker?: NativeSubtitleFilePicker, features: EngineFeatures = nativeEngineFeatures, pictureControls = false, offlineDevice?: NativeOfflinePlaybackDevice, engineKind: 'native' | 'mpv' = 'native') {
  const server = new FakePlaybackServer({audioItem: id => id.startsWith('song'), itemKind});
  const engine = new Engine(), requests: FakeRequest[] = [];
  let serial = 0;
  let resumePositionMs: number | null | undefined;
  let authority: PlaybackAuthority = {serverId: 'server', accountId: 'account', profileId: 'profile', epoch: 'epoch-1', viewerFence: homeFence};
  let session: LocalSession | undefined = {accessToken: '', expiresAt: '2099-01-01T00:00:00Z', viewer: {serverId: 'server', accountId: 'account', profileId: 'profile', authority: 'local', role: 'owner'}, sessionFamilyId: 'family', tokenGeneration: '1', authorizationHorizon: 'horizon'};
  const authorityListeners = new Set<() => void>();
  const eventListeners = new Map<string, Set<(event: any) => void>>();
  const resyncListeners = new Set<() => void>();
  const timers = new Map<number, {ms: number; run: () => void}>();
  let timerSerial = 0;
  let before: ((request: FakeRequest) => Promise<void>) | undefined;
  let respond: ((request: FakeRequest) => FakeResponse | undefined | Promise<FakeResponse | undefined>) | undefined;
  const channelSeeks = new Map<string, {id: string; positionMs: number; acknowledged: boolean}>();
  let channelWindow = {startMs: 20000, endMs: 120000};
  let markers: readonly Marker[] = [{id: 'intro-1', type: 'intro', startMs: 10000, endMs: 70000, confidence: 'manual', automaticSafe: true}];
  const fetcher: typeof fetch = async (input, init) => {
    const url = new URL(String(input)), path = url.pathname + url.search;
    const request: FakeRequest = {method: init?.method ?? 'GET', path, body: typeof init?.body === 'string' ? JSON.parse(init.body) : undefined,
      headers: Object.fromEntries(new Headers(init?.headers)), signal: init?.signal ?? undefined};
    requests.push(request);
    await before?.(request);
    let response: FakeResponse;
    const supplied = await respond?.(request);
    if (supplied) response = supplied;
    else if (path === routePath('get_capabilities')) response = {status: 200, headers: {}, body: {features: {playback_v1_kinds: 'movie,episode,song,audiobook_file', playback_v1_channels: 'enabled'}}};
    else if (path.startsWith(routePath('get_guide_sources') + '?')) response = guideSources();
    else if (/^\/v1\/items\/[^/]+$/.test(path)) {
      const id = decodeURIComponent(url.pathname.split('/').at(-1)!);
      response = {status: 200, headers: {}, body: {id, libraryId: 'library', kind: itemKind(id), title: id, durationMs: 180000, progressMs: 0, available: true}};
    } else {
      response = await server.handle(request);
      if (path.includes('/playback-options') && response.status === 200) {
        const body = response.body as Record<string, unknown>, id = body.itemId as string;
        const versions = body.versions as readonly Record<string, unknown>[];
        response = {...response, body: {...body, kind: itemKind(id), markers,
          ...(resumePositionMs === null ? {resume: undefined} : resumePositionMs !== undefined ? {resume: {positionMs: resumePositionMs, partIndex: 0}} : {}),
          ...(groupedVersions ? {versions:[...versions,{...versions[0],id:'v2',label:'Second version'}]} : {})}};
      }
    }
    // The existing fake owns session/revision/timeline receipts. Add its missing linear
    // projection at the test boundary, using the actual V1ChannelControl response schema.
    const body = response.body as {kind?: string; id?: string; presentation?: Record<string, unknown>} | undefined;
    if (body?.kind === 'channel' && body.id && body.presentation) {
      const seek = (request.body as {seek?: {id: string; live?: boolean; positionMs: number}} | undefined)?.seek;
      if (seek) channelSeeks.set(body.id, {id: seek.id, positionMs: seek.live ? 120000 : seek.positionMs, acknowledged: false});
      const held = channelSeeks.get(body.id);
      response = {...response, body: {...body, presentation: {...body.presentation, linear: {name: 'channel-1', originMs: 0, windowStartMs: channelWindow.startMs, windowEndMs: channelWindow.endMs, liveEdgeMs: channelWindow.endMs, state: 'ready',
        ...(held ? {seek: held, confirmedPositionMs: held.positionMs} : {})}}}};
    }
    if (path.endsWith('/timeline') && request.method === 'POST') {
      const id = url.pathname.split('/').at(-2)!, held = channelSeeks.get(id);
      if (held && (request.body as {positionMs: number}).positionMs === held.positionMs) held.acknowledged = true;
    }
    return new Response(response.status === 204 ? null : JSON.stringify(response.body), {status: response.status, headers: response.headers});
  };
  const api = new HttpLocalApi('https://portico.test', '', fetcher);
  // Observe the genuine scope-to-API boundary without replacing its deadline or transport.
  const scopedRequests: {path: string; signal?: AbortSignal}[] = [];
  const requestRaw = api.requestRaw.bind(api);
  api.requestRaw = (path, method, options = {}) => {
    scopedRequests.push({path, signal: options.signal});
    return requestRaw(path, method, options);
  };
  let settings: NativePlaybackSettings = {engine: 'automatic', videoRate: 1, audiobookRate: 1, subtitles: {size: 'medium', color: 'white', background: 'translucent', position: 'bottom', font: 'default', keepStyling: true, useSystemCaptionStyle: false}, skips: {intro: 'ask', recap: 'ask', credits: 'ask'}};
  const settingsListeners = new Set<() => void>();
  let disposedCapabilities = 0;
  const runtime = new NativePlaybackRuntime({api, authority: () => authority, session: () => session,
    subscribeAuthority: listener => { authorityListeners.add(listener); return () => { authorityListeners.delete(listener); }; },
    events: {on(type, listener) { const set = eventListeners.get(type) ?? new Set(); set.add(listener); eventListeners.set(type, set); return () => { set.delete(listener); }; }, onResync(listener) { resyncListeners.add(listener); return () => { resyncListeners.delete(listener); }; }},
    settings: () => settings, subscribeSettings: listener => { settingsListeners.add(listener); return () => { settingsListeners.delete(listener); }; },
    requestId: () => `request-${++serial}-000000000000`, transport: engine, engines: {initial: engineKind, choose: () => engineKind, transport: () => engine},
    engineFeatures: () => features, capabilitiesReady: async () => {}, disposeCapabilities: () => { disposedCapabilities++; }, subtitleFilePicker, offlineDevice, ...(pictureControls ? {pictureInPictureControls: true as const} : {}),
    timers: {
      setTimer: (fn, ms) => { const id = ++timerSerial; timers.set(id, {ms, run: () => { timers.delete(id); fn(); }}); return id; },
      clearTimer: id => { if (typeof id === 'number') timers.delete(id); },
    },
  });
  const start = async (id: string, startSeconds = 30) => { await runtime.start({entry: {id, kind: itemKind(id), title: id, libraryId: 'library', playback: {itemId: id, startSeconds}}, target: {itemId: id, startSeconds}}); await settle(); };
  return {server, engine, runtime, requests, scopedRequests, start,
    groupedVersions: (value: boolean) => { groupedVersions = value; },
    resume: (value: number | null) => { resumePositionMs = value; },
    markers: (value: readonly Marker[]) => { markers = value; },
    pendingTimers: (ms: number) => [...timers.values()].filter(timer => timer.ms === ms),
    channelWindow: (startSeconds: number, endSeconds: number) => { channelWindow = {startMs: startSeconds * 1000, endMs: endSeconds * 1000}; },
    intercept: (fn: typeof before) => { before = fn; },
    respond: (fn: typeof respond) => { respond = fn; },
    authority: (patch: Partial<PlaybackAuthority>, notify = true) => { authority = {...authority, ...patch}; if (notify) for (const listener of [...authorityListeners]) listener(); },
    family: (id: string) => { if (session) session = {...session, sessionFamilyId: id}; },
    changeAuthority: () => { authority = {...authority, epoch: 'epoch-2'}; session = undefined; for (const listener of [...authorityListeners]) listener(); },
    settings: (patch: Partial<NativePlaybackSettings>) => { settings = {...settings, ...patch}; for (const listener of settingsListeners) listener(); },
    get disposedCapabilities() { return disposedCapabilities; },
    get subscriptions() { return authorityListeners.size + settingsListeners.size + resyncListeners.size + [...eventListeners.values()].reduce((sum, set) => sum + set.size, 0); },
  };
}

function subtitleResponse(d: ReturnType<typeof fixture>, request: FakeRequest): FakeResponse | undefined {
    const match = /^\/v1\/items\/([^/]+)\/playback\/([^/]+)\/subtitles$/.exec(request.path);
    if (match) return {status: 200, headers: {}, body: {version: 1, sessionId: decodeURIComponent(match[2]), generation: d.runtime.playback.getSnapshot().session!.generation,
      sourceId: 'physical-source-1', revision: 1, catalogRevision: 1, renderer: 'external_text', mode: 'off', offAvailable: true, offsetUs: '0', selected: null, resources: [], discovered: []}};
    if (request.method === 'GET' && /^\/v1\/items\/[^/]+\/subtitles$/.test(request.path)) return {status: 200, headers: {}, body: {version: 1,
      itemId: decodeURIComponent(request.path.split('/')[3]), revision: 1, canShare: false,
      sources: [{id: 'physical-source-1', durationUs: '180000000', inventoryRevision: 1, available: true, timingKnown: true}], resources: [], discovered: [], provider: {id: 'provider', enabled: true}}};
    if (request.method === 'POST' && request.path.endsWith('/subtitles/search')) return {status: 200, headers: {}, body: {version: 1, page: 1, candidates: []}};
    if (request.method === 'POST' && /^\/v1\/items\/[^/]+\/subtitles$/.test(request.path) && record(request.body)) return {status: 200, headers: {}, body: {operationId: request.body.operationId, resourceId: 'uploaded-resource', revision: 1, catalogRevision: 2}};
}

function richSubtitleResponses(d: ReturnType<typeof fixture>, offsetMs: number | undefined = 1250, lines?: {engine: 'native' | 'mpv'; read(request: FakeRequest): FakeResponse | Promise<FakeResponse>}) {
  const burned = new Set<string>();
  const resource = (sessionId = d.runtime.playback.getSnapshot().session?.id) => ({id: 'rich-resource', sourceId: 'physical-source-1', revision: 3, scope: 'personal', language: 'en', title: 'Actual rich resource',
    format: 'vobsub', origin: 'sidecar', rights: '', offsetUs: '500000', canManage: true, enabled: true, pinned: true, renderer: sessionId && burned.has(sessionId) ? 'burn_in' : 'client', default: false, forced: false});
  d.respond(async request => {
    if (lines && request.method === 'GET' && request.path.endsWith('/lines')) return lines.read(request);
    const match = /^\/v1\/items\/([^/]+)\/playback\/([^/]+)\/subtitles$/.exec(request.path);
    if (match) {const sessionId = decodeURIComponent(match[2]), selected = resource(sessionId); return {status: 200, headers: {}, body: {version: 1, sessionId, generation: d.runtime.playback.getSnapshot().session!.generation,
      sourceId: selected.sourceId, revision: burned.has(sessionId) ? 2 : 1, catalogRevision: 1, renderer: selected.renderer, mode: 'track', offAvailable: true, offsetUs: '500000', selected, resources: [selected], discovered: []}};}
    if (request.method === 'GET' && /^\/v1\/items\/[^/]+\/subtitles$/.test(request.path)) {
      const response = subtitleResponse(d, request)!;
      return {...response, body: {...response.body as object, resources: [resource()]}};
    }
    if (request.method === 'POST' && request.path === routePath('create_queue') || /^\/v1\/playback\/sessions(?:\/[^/]+)?$/.test(request.path)) {
      if (request.method === 'PATCH' && record(request.body) && record(request.body.subtitles) && request.body.subtitles.delivery === 'burn') burned.add(decodeURIComponent(request.path.split('/').at(-1)!));
      const response = await d.server.handle(request);
      const shape = (session: any) => ({...session, presentation: {...session.presentation, ...(lines ? {engine: lines.engine} : {}),
        subtitle: {trackId: 'rich-resource', kind: 'vobsub', delivery: burned.has(session.id) ? 'burn' : 'device'},
        subtitles: [{trackId: 'rich-resource', format: 'vobsub', url: `/v1/media/subtitles/grant-${session.id}/rich-resource/3/original.idx`,
          companionUrl: `/v1/media/subtitles/grant-${session.id}/rich-resource/3/original.sub`, ...(lines ? {linesUrl: `/v1/media/subtitles/grant-${session.id}/rich-resource/3/lines`} : {}), timeDomain: 'source-relative', ...(offsetMs === undefined ? {} : {offsetMs})}]}});
      const body = response.body as any;
      return response.status < 300 && body ? {...response, body: body.session ? {...body, session: shape(body.session)} : body.presentation ? shape(body) : body} : response;
    }
    return subtitleResponse(d, request);
  });
}

/** Controlled output of the verified device boundary. These binding tests do not
 * establish native receipt/signature or file-system verification. */
function admittedDownload() {
  const entry: OfflineEntry = {id: 'copy', itemId: 'movie', kind: 'movie', libraryId: 'library', title: 'Movie', subtitle: '', quality: 'original', artworkUrl: '', state: 'ready', error: '', waiting: '', held: false, bytes: 10, bytesDone: 10, addedAt: 1, onServer: false, changedOnServer: false,
    receipt: {receiptId: 'receipt', algorithm: 'ed25519', keyId: 'key', payload: 'fixture', signature: 'fixture', revision: 1,
      claims: {kind: 'portico.download-receipt', version: '1', receiptId: 'receipt', keyId: 'key', viewer: {authority: 'local', serverId: 'server', accountId: 'account', profileId: 'profile'}, itemId: 'movie', preparationId: 'preparation', quality: 'original', qualityLabel: 'Original', artifact: {sha256: 'a'.repeat(64), bytes: 10}, issuedAt: '2026-01-01T00:00:00Z', expiresAt: '2100-01-01T00:00:00Z'}}};
  let snapshot: OfflineSnapshot = {supported: true, ready: true, entries: [entry], settings: {wifiOnly: true, deleteWatched: false, autoNext: false, limitBytes: 0}, freeBytes: 100, usedBytes: 10, otherBytes: 0, pendingProgress: 0};
  let serial = 0;
  const media: LocalMedia = {entryId: entry.id, itemId: entry.itemId, playId: 'play_fixture', fileUrl: 'file:///private/Downloads/copy/movie.mp4', durationSeconds: 600, startSeconds: 42};
  let load = async (): Promise<LocalMedia> => ({...media, playId: `play_fixture${++serial}`});
  const progress: LocalProgress[] = [], listeners = new Set<() => void>();
  const device: NativeOfflinePlaybackDevice = {getSnapshot: () => snapshot, subscribe: listener => {listeners.add(listener);return () => {listeners.delete(listener);};}, localMedia: () => load(), playabilityReason: () => null, recordProgress: value => {progress.push(value);}};
  return {entry, media, progress, device, load: (next: typeof load) => {load = next;}, entries: (entries: readonly OfflineEntry[]) => {snapshot = {...snapshot, entries};for (const listener of listeners) listener();}, get subscriptions() {return listeners.size;}};
}

test('the genuine local maker reaches the same native engine and dock without server playback requests', async () => {
  const local = admittedDownload(), d = fixture(false, undefined, nativeEngineFeatures, false, local.device);
  const owner = {}, offSurface = d.runtime.attachSurface(owner); d.runtime.setSurfaceTag(owner, 71);
  try {
    await settle(); assert.equal(d.runtime.queue.getSnapshot().phase, 'ready');
    const before = d.requests.length;
    const controller = new AbortController();
    await d.runtime.startOffline(local.entry, {signal: controller.signal, isCurrent: () => true}); await settle();
    const snapshot = d.runtime.getSnapshot(), fence = snapshot.fence;
    assert.equal(fence?.kind, 'local'); assert.equal(snapshot.playback.session?.id, 'local:copy:1');
    assert.equal(snapshot.playback.positionSeconds, 42); assert.equal(snapshot.dock.local?.queue, null);
    assert.equal(snapshot.session, undefined); assert.equal(snapshot.options, undefined);
    assert.equal(d.engine.commands.at(-1)?.source, local.media.fileUrl);
    assert.deepEqual(d.requests.slice(before), [], 'local source/detail/subtitle routing never asks the server');
    if (!fence || fence.kind !== 'local') throw new Error('missing genuine local fence');
    assert.deepEqual(fence.playback.scope, {authority: 'local', serverId: 'server', accountId: 'account', profileId: 'profile', sessionFamilyId: 'family'});
    assert.equal(fence.playId, 'play_fixture1'); assert.equal(fence.artifact.sha256, 'a'.repeat(64));
    controller.abort(); await settle();
    assert.equal(d.runtime.getSnapshot().playback.session?.id, snapshot.playback.session?.id, 'closing the accepted action never stops the source');
    d.engine.position = 51; d.engine.emit('progress'); await d.runtime.toggle(fence); await settle();
    assert.equal(local.progress.at(-1)?.playId, fence.playId); assert.equal(local.progress.at(-1)?.positionSeconds, 51);
    await d.runtime.onTransition(d.runtime.dock.close(fence)); await settle();
    assert.equal(d.requests.some(request => request.path.includes('/local:') || request.path.includes('/local%3A')), false);
  } finally {offSurface(); d.runtime.dispose();}
});

test('a late admitted native file cannot replace a competing Play or cross caller/viewer retirement', async () => {
  for (const retire of ['abort', 'member', 'family', 'play'] as const) {
    const local = admittedDownload(), d = fixture(false, undefined, nativeEngineFeatures, false, local.device);
    try {
      await d.start('movie-original'); let release!: (media: LocalMedia) => void, current = true;
      local.load(() => new Promise(resolve => {release = resolve;}));
      const controller = new AbortController();
      const pending = d.runtime.startOffline(local.entry, {signal: controller.signal, isCurrent: () => current});
      await settle(2);
      if (retire === 'abort') controller.abort(); else if (retire === 'member') current = false;
      else if (retire === 'family') d.family('replacement'); else await d.start('movie-next');
      release(local.media); await assert.rejects(pending, {name: 'AbortError'}); await settle();
      assert.equal(d.engine.commands.some(command => command.source === local.media.fileUrl), false, retire);
      if (retire === 'play') assert.equal(d.runtime.getSnapshot().playback.itemId, 'movie-next');
    } finally {d.runtime.dispose();}
  }
});

test('a parked local bookmark reopens paused on the same Surface and only explicit Play can resume it', async () => {
  const local = admittedDownload(), d = fixture(false, undefined, nativeEngineFeatures, false, local.device);
  const owner = {}, offSurface = d.runtime.attachSurface(owner); d.runtime.setSurfaceTag(owner, 71);
  try {
    await settle();
    await d.runtime.startOffline(local.entry, {signal: new AbortController().signal, isCurrent: () => true}); await settle();
    const original = d.runtime.getSnapshot(), fence = original.fence!;
    d.engine.position = 73; d.engine.emit('progress'); await settle();
    await d.start('song-next');
    assert.equal(d.runtime.dock.getSnapshot().resumeVideo?.fence.kind, 'local');
    assert.deepEqual(d.runtime.dock.getSnapshot().resumeVideo?.fence, fence);
    const before = d.engine.commands.length;
    const restored = await d.runtime.restoreBookmark(fence, false); await settle();
    const after = d.runtime.getSnapshot();
    assert.equal(restored?.kind, 'local', JSON.stringify({phase: after.playback.phase, intent: after.playback.intent, sessionId: after.playback.session?.id, fence: after.fence}));
    assert.notEqual(restored?.sessionId, fence.sessionId);
    const snapshot = d.runtime.getSnapshot();
    assert.equal(snapshot.playback.intent, 'paused'); assert.equal(snapshot.playback.positionSeconds, 73);
    assert.ok(snapshot.lease); assert.throws(() => d.runtime.attachSurface({}), /already mounted/);
    d.runtime.setSurfaceTag(owner, 71); assert.equal(snapshot.dock.local?.queue, null);
    if (!restored || restored.kind !== 'local') throw new Error('missing genuine restored local source');
    assert.equal(restored.playId, 'play_fixture2');
    const commands = d.engine.commands.slice(before).filter(command => command.binding.sessionId === restored.sessionId);
    assert.ok(commands.length > 0); assert.ok(commands.every(command => command.paused === true), 'restore never transiently plays');
    await d.runtime.toggle(restored); await settle(); assert.equal(d.runtime.getSnapshot().playback.intent, 'playing');
    assert.equal(d.requests.some(request => request.path.includes('/local:') || request.path.includes('/local%3A')), false);
  } finally {offSurface(); d.runtime.dispose();}
});

test('local Retry retains its live caller context and never falls into the device queue', async () => {
  const local = admittedDownload(), d = fixture(false, undefined, nativeEngineFeatures, false, local.device);
  const owner = {}, offSurface = d.runtime.attachSurface(owner); d.runtime.setSurfaceTag(owner, 71);
  try {
    await settle();
    await d.runtime.startOffline(local.entry, {signal: new AbortController().signal, isCurrent: () => true}); await settle();
    const original = d.runtime.getSnapshot(); d.runtime.playback.fail(original.playback.intentId, 'fixture_failure'); await settle();
    await d.runtime.replay(original.fence!); await settle();
    const retry = d.runtime.getSnapshot(); assert.equal(retry.fence?.kind, 'local');
    assert.notEqual(retry.fence?.sessionId, original.fence?.sessionId);
    assert.equal(retry.fence?.kind === 'local' ? retry.fence.playId : undefined, 'play_fixture1');
    assert.equal(retry.playback.phase, 'ready'); assert.ok(retry.lease);
    // A failed decoder may acquire a fresh lease; the actual Surface owner/tag remains.
    assert.throws(() => d.runtime.attachSurface({}), /already mounted/); d.runtime.setSurfaceTag(owner, 71);
    assert.equal(d.requests.some(request => request.method === 'POST' && /\/playback\/sessions$/.test(request.path)), false);
  } finally {offSurface(); d.runtime.dispose();}
});

test('withdrawn device admission removes the local fence and refuses retained controls', async () => {
  const local = admittedDownload(), d = fixture(false, undefined, nativeEngineFeatures, false, local.device);
  const owner = {}, offSurface = d.runtime.attachSurface(owner); d.runtime.setSurfaceTag(owner, 71);
  try {
    await settle();
    await d.runtime.startOffline(local.entry, {signal: new AbortController().signal, isCurrent: () => true}); await settle();
    const fence = d.runtime.getSnapshot().fence!;
    assert.equal(local.subscriptions, 1);
    local.entries([]); await settle();
    assert.equal(d.runtime.getSnapshot().fence, undefined);
    const before = d.engine.commands.length;
    await d.runtime.toggle(fence); await d.runtime.seek(fence, 100); await settle();
    assert.equal(d.engine.commands.length, before, 'withdrawn-source controls cannot send a native command');
  } finally {offSurface(); d.runtime.dispose(); assert.equal(local.subscriptions, 0);}
});

test('a background server queue refresh cannot adopt over the accepted local source', async () => {
  const local = admittedDownload(), d = fixture(false, undefined, nativeEngineFeatures, false, local.device);
  const owner = {}, offSurface = d.runtime.attachSurface(owner); d.runtime.setSurfaceTag(owner, 71);
  try {
    await d.start('movie-server');
    await d.runtime.startOffline(local.entry, {signal: new AbortController().signal, isCurrent: () => true}); await settle();
    const original = d.runtime.getSnapshot();
    await d.runtime.queue.refresh(); await settle();
    assert.equal(d.runtime.getSnapshot().playback.session?.id, original.playback.session?.id);
    assert.equal(d.runtime.getSnapshot().fence?.kind, 'local');
  } finally {offSurface(); d.runtime.dispose();}
});

test('native Info uses only fresh canonical report/observation facts and never adopts or caches them', async () => {
  const d = fixture(); await d.start('movie');
  try {
    const held = d.runtime.getSnapshot(), fence = held.fence!, names = infoWords(), path = encodedRoutePath('get_playback_session', {id: fence.sessionId});
    const readsBefore = d.requests.filter(request => request.method === 'GET' && request.path === path).length;
    let observed: ObservedPlayback | undefined, report = true;
    d.respond(async request => {
      if (request.method !== 'GET' || request.path !== path) return;
      const response = await d.server.handle(request);
      return {...response, body: {...response.body as object, playbackInfo: report ? committedInfo : undefined, observedPlayback: observed}};
    });
    const lifetime = {signal: new AbortController().signal, isCurrent: () => true};
    const unknownOutput = await readNativePlaybackInfo(d.runtime, fence, names.words, lifetime);
    assert.equal(unknownOutput?.revision, held.session?.revision); assert.deepEqual(unknownOutput?.fence, fence);
    const sound = unknownOutput?.comparison.sections.find(section => section.kind === 'sound');
    assert.equal(sound?.rows.find(row => row.field === 'sampleRate')?.source, '96');
    assert.equal(sound?.rows.find(row => row.field === 'sampleRate')?.delivered, '48');
    assert.equal(sound?.rows.some(row => row.field === 'output'), false);
    assert.equal(sound?.rows.some(row => row.field === 'channels' && /7\.1|stereo/i.test(row.source ?? '')), false);
    assert.deepEqual(names.outputs, []); assert.deepEqual(names.measured, [undefined]);
    assert.equal(unknownOutput?.comparison.networkAndBitrate, undefined, 'estimated bitrate is not measured delivery');
    observed = {audio: {handling: 'pcm', codec: 'pcm', channels: 2, sampleRate: 44100}, deliveredBitrateKbps: 1234};
    const actualOutput = await readNativePlaybackInfo(d.runtime, fence, names.words, lifetime);
    const actualSound = actualOutput?.comparison.sections.find(section => section.kind === 'sound');
    assert.deepEqual(names.outputs.at(-1), observed.audio);
    assert.equal(actualSound?.rows.find(row => row.field === 'output')?.delivered, 'pcm:44100');
    assert.equal(actualSound?.rows.find(row => row.field === 'sampleRate')?.delivered, '48', 'encoding facts remain committed media facts');
    assert.equal(actualOutput?.comparison.networkAndBitrate, '1234');
    report = false; observed = {};
    assert.equal(await readNativePlaybackInfo(d.runtime, fence, names.words, lifetime), undefined, 'missing report never falls back to prior data/options');
    assert.equal(d.runtime.getSnapshot().session, held.session, 'Info never adopts the GET response');
    assert.ok(Object.isFrozen(unknownOutput)); assert.ok(Object.isFrozen(unknownOutput?.comparison));
    assert.equal(d.requests.filter(request => request.method === 'GET' && request.path === path).length - readsBefore, 3, 'every read is fresh');
  } finally {d.runtime.dispose();}
});

test('native Info refuses missing read ports and discards results/errors when its actual owner retires during projection', async () => {
  const d = fixture(); await d.start('movie');
  try {
    const fence = d.runtime.getSnapshot().fence!, names = infoWords(), path = encodedRoutePath('get_playback_session', {id: fence.sessionId});
    let current = true, fail = false;
    const lifetime = {signal: new AbortController().signal, isCurrent: () => current};
    const before = d.requests.length;
    assert.equal(await readNativePlaybackInfo({getSnapshot: d.runtime.getSnapshot}, fence, names.words, lifetime), undefined);
    assert.equal(d.requests.length, before);
    d.respond(async request => {
      if (request.method !== 'GET' || request.path !== path) return;
      const response = await d.server.handle(request);
      return {...response, body: {...response.body as object, playbackInfo: committedInfo}};
    });
    const words: PlaybackInfoWords = {...names.words, reason: () => {current = false; if (fail) throw new Error('retired_formatter'); return undefined;}};
    assert.equal(await readNativePlaybackInfo(d.runtime, fence, words, lifetime), undefined);
    current = true; fail = true;
    assert.equal(await readNativePlaybackInfo(d.runtime, fence, words, lifetime), undefined);
  } finally {d.runtime.dispose();}
});

test('a fresh fenced VOD session read uses the genuine endpoint without adopting or replanning', async () => {
  const d = fixture(); await d.start('movie');
  try {
    const held = d.runtime.getSnapshot(), fence = held.fence!;
    const before = d.requests.length, commands = d.engine.commands.length;
    const session = await d.runtime.readSession(fence, {signal: new AbortController().signal, isCurrent: () => true});
    assert.equal(session?.id, held.session?.id); assert.equal(session?.revision, held.session?.revision);
    assert.equal(session?.presentation.generation, fence.generation);
    assert.deepEqual(d.requests.slice(before).map(request => [request.method, request.path]), [['GET', encodedRoutePath('get_playback_session', {id: fence.sessionId})]]);
    assert.equal(d.runtime.getSnapshot().session, held.session, 'GET never adopts a session');
    assert.equal(d.engine.commands.length, commands, 'GET never replans the native source');
  } finally {d.runtime.dispose();}
});

test('session reads discard late responses after caller retirement, viewer replacement or competing Play', async () => {
  for (const retire of ['abort', 'member', 'family', 'play'] as const) {
    const d = fixture(); await d.start('movie');
    try {
      const fence = d.runtime.getSnapshot().fence!, controller = new AbortController(); let current = true;
      const path = encodedRoutePath('get_playback_session', {id: fence.sessionId});
      let release!: () => void, entered!: () => void;
      const started = new Promise<void>(resolve => {entered = resolve;});
      d.intercept(request => request.method === 'GET' && request.path === path ? new Promise<void>(resolve => {release = resolve; entered();}) : Promise.resolve());
      const pending = d.runtime.readSession(fence, {signal: controller.signal, isCurrent: () => current});
      await started;
      if (retire === 'abort') {
        controller.abort();
        assert.equal(d.scopedRequests.filter(request => request.path === path).at(-1)?.signal?.aborted, true);
      }
      else if (retire === 'member') current = false;
      else if (retire === 'family') d.family('replacement-family');
      else await d.start('movie-next');
      release(); assert.equal(await pending, undefined, retire);
      if (retire === 'play') assert.equal(d.runtime.getSnapshot().playback.itemId, 'movie-next');
    } finally {d.runtime.dispose();}
  }
});

test('retired callers, stale fences and non-VOD sessions never dispatch an Info read', async () => {
  const d = fixture(); await d.start('movie');
  try {
    const fence = d.runtime.getSnapshot().fence!, aborted = new AbortController(); aborted.abort();
    let before = d.requests.length;
    assert.equal(await d.runtime.readSession(fence, {signal: aborted.signal, isCurrent: () => true}), undefined);
    assert.equal(await d.runtime.readSession(fence, {signal: new AbortController().signal, isCurrent: () => false}), undefined);
    assert.equal(d.requests.length, before);
    await d.start('song-1'); before = d.requests.length;
    assert.equal(await d.runtime.readSession(fence, {signal: new AbortController().signal, isCurrent: () => true}), undefined);
    assert.equal(await d.runtime.readSession(d.runtime.getSnapshot().fence!, {signal: new AbortController().signal, isCurrent: () => true}), undefined);
    assert.equal(d.requests.length, before);
  } finally {d.runtime.dispose();}
});

test('fresh session reads refuse mismatched response revision, source, generation or occurrence', async () => {
  for (const mismatch of ['revision', 'source', 'generation', 'occurrence', 'role', 'ended'] as const) {
    const d = fixture(); await d.start('movie');
    try {
      const held = d.runtime.getSnapshot(), fence = held.fence!, path = encodedRoutePath('get_playback_session', {id: fence.sessionId});
      d.respond(async request => {
        if (request.method !== 'GET' || request.path !== path) return;
        const response = await d.server.handle(request), body = response.body as Record<string, unknown>;
        return {...response, body: {...body,
          ...(mismatch === 'revision' ? {revision: '999'} : mismatch === 'source' ? {versionId: 'other-version'}
            : mismatch === 'role' ? {role: 'receiver'} : mismatch === 'ended' ? {state: 'ended'}
            : mismatch === 'generation' ? {presentation: {...body.presentation as object, generation: fence.generation + 1}}
            : {queue: {...body.queue as object, entryId: 'other-occurrence'}})}};
      });
      assert.equal(await d.runtime.readSession(fence, {signal: new AbortController().signal, isCurrent: () => true}), undefined, mismatch);
      assert.equal(d.runtime.getSnapshot().session, held.session);
    } finally {d.runtime.dispose();}
  }
});

test('the app-local strict transport guards native controller adoption and never restarts an ended session', async () => {
  for (const retire of ['signal', 'member'] as const) {
    const d = fixture(), controller = new AbortController(); let current = true;
    let finish!: (response: FakeResponse) => void, held!: FakeResponse, sent: FakeRequest | undefined;
    try {
      await d.start('movie-1');
      const before = d.runtime.queue.currentSession()!;
      d.respond(async request => {
        if (request.method === 'PATCH' && request.path.endsWith('/' + before.id)) {sent = request; held = await d.server.handle(request); return new Promise(resolve => {finish = resolve;});}
      });
      const pending = d.runtime.queue.changePlayback({audioTrackId: 'a2'}, {signal: controller.signal, isCurrent: () => current, recoverEnded: false});
      await settle(); assert.ok(sent);
      if (retire === 'signal') {controller.abort(); assert.equal(sent.signal?.aborted, true);} else current = false;
      finish(held); await assert.rejects(pending, {name: 'AbortError'}); await settle();
      assert.equal(d.runtime.path.controller.getSnapshot().session?.presentation.generation, before.presentation.generation);
      assert.equal(d.runtime.queue.currentSession()?.presentation.generation, before.presentation.generation);
      assert.equal(d.engine.commands.some(command => command.binding.generation > before.presentation.generation), false);
    } finally {d.runtime.dispose();}
  }
  const d = fixture();
  try {
    await d.start('movie-1'); const original = d.runtime.queue.currentSession()!, sent = d.requests.length;
    d.respond(request => request.method === 'PATCH' ? {status: 410, headers: {}, body: {error: {code: 'session_ended', message: 'session_ended'}}} : undefined);
    await assert.rejects(d.runtime.queue.changePlayback({audioTrackId: 'a2'}, {...versionLifetime(), recoverEnded: false}), (error: any) => error.status === 410);
    assert.equal(d.runtime.queue.currentSession()?.id, original.id);
    assert.equal(d.requests.slice(sent).some(request => request.method === 'POST' || request.path.endsWith('/timeline')), false);
  } finally {d.runtime.dispose();}
});

test('an installed native rich producer receives the actual companion and complete file correction', async () => {
  const d = fixture(false, undefined, {...nativeEngineFeatures, subtitleRendering: ['text', 'vobsub']}); richSubtitleResponses(d);
  try {
    await d.start('movie-1');
    assert.equal(d.runtime.getSnapshot().subtitles?.plan?.mode, 'track', d.runtime.getSnapshot().subtitles?.error ?? 'actual current rich plan required');
    const subtitles = d.engine.lastCommand.subtitles;
    assert.equal(subtitles.mode, 'track'); assert.equal(subtitles.offsetUs, '500000');
    assert.equal(subtitles.render.kind, 'vobsub'); assert.equal(subtitles.render.offsetMs, 1250); assert.equal(subtitles.render.timeDomain, 'source-relative');
    assert.match(subtitles.render.url, /\/original.idx$/); assert.match(subtitles.render.companionUrl, /\/original.sub$/);
    assert.equal(d.runtime.getSnapshot().engine, 'native');
  } finally {d.runtime.dispose();}
});

test('complete caption preferences update the same bound subtitle source and retire with its authority', async () => {
  const d = fixture(false, undefined, {...nativeEngineFeatures, subtitleRendering: ['text', 'vobsub']}); richSubtitleResponses(d);
  try {
    await d.start('movie-1');
    const fence = d.runtime.getSnapshot().fence!, binding = d.engine.lastCommand.subtitles.binding;
    const original = d.engine.lastCommand.subtitles.style;
    const sent = d.requests.length;
    const subtitles = {size: 'extra-large', color: 'cyan', background: 'shadow', position: 'top', font: 'serif', keepStyling: false, useSystemCaptionStyle: true} as const;
    d.settings({subtitles}); await settle();
    assert.deepEqual(d.engine.lastCommand.subtitles.style, {...subtitles, scale: 1.6});
    assert.deepEqual(d.engine.lastCommand.subtitles.binding, binding);
    assert.deepEqual(d.runtime.getSnapshot().fence, fence);
    assert.equal(original.color, 'white', 'an old command is not mutated');
    assert.equal(d.requests.slice(sent).some(request => request.method !== 'GET'), false, 'appearance does not replan or replace the session');
    assert.equal(d.runtime.choices.set('subtitleSize', fence.playback, 'small'), true);
    assert.equal(d.runtime.choices.set('subtitleBackground', fence.playback, 'opaque'), true);
    await settle();
    assert.deepEqual(d.engine.lastCommand.subtitles.style, {...subtitles, size: 'small', scale: 0.8, background: 'opaque'});
    d.changeAuthority(); await settle();
    const count = d.engine.commands.length;
    d.settings({subtitles: {...subtitles, color: 'yellow'}}); await settle();
    assert.equal(d.engine.commands.length, count, 'retired preferences cannot issue another native command');
  } finally {d.runtime.dispose();}
});

test('only actual current mixed image lines expose a fenced mpv Forced-only choice', async () => {
  const d = fixture(false, undefined, {...nativeEngineFeatures, subtitleRendering: ['text', 'vobsub']}, false, undefined, 'mpv');
  richSubtitleResponses(d, 1250, {engine: 'mpv', read: () => ({status: 200, headers: {}, body: {forced: 1, total: 3}})});
  try {
    await d.start('movie-1');
    const snapshot = d.runtime.getSnapshot(), fence = snapshot.fence!, binding = d.engine.lastCommand.binding;
    assert.equal(snapshot.engine, 'mpv'); assert.deepEqual(snapshot.forcedOnly, {on: false});
    const sent = d.requests.length;
    assert.equal(d.runtime.setForcedOnly(fence, true), true); await settle();
    assert.deepEqual(d.runtime.getSnapshot().forcedOnly, {on: true});
    assert.equal(d.engine.lastCommand.subtitles.forcedOnly, true); assert.deepEqual(d.engine.lastCommand.binding, binding);
    assert.equal(d.runtime.setForcedOnly({...fence, generation: fence.generation + 1}, false), false);
    assert.equal(d.requests.slice(sent).some(request => request.method !== 'GET'), false, 'filtering never replans or replaces the session');
    assert.equal(d.runtime.setForcedOnly(fence, false), true); await settle();
    assert.equal(d.engine.lastCommand.subtitles.forcedOnly, undefined);
  } finally {d.runtime.dispose();}
});

test('unknown, invalid, all-forced and unforced image metadata never enable the choice; native gets no guessed filter', async () => {
  for (const body of [{forced: 0, total: 3}, {forced: 3, total: 3}, {forced: 4, total: 3}, {forced: '1', total: 3}]) {
    const d = fixture(false, undefined, {...nativeEngineFeatures, subtitleRendering: ['text', 'vobsub']}, false, undefined, 'mpv');
    richSubtitleResponses(d, 1250, {engine: 'mpv', read: () => ({status: 200, headers: {}, body})});
    try {await d.start('movie-1'); assert.equal(d.runtime.getSnapshot().forcedOnly, undefined); assert.equal(d.runtime.setForcedOnly(d.runtime.getSnapshot().fence!, true), false);}
    finally {d.runtime.dispose();}
  }
  const d = fixture(false, undefined, {...nativeEngineFeatures, subtitleRendering: ['text', 'vobsub']});
  richSubtitleResponses(d, 1250, {engine: 'native', read: () => {throw new Error('Native filtering is not installed.');}});
  try {await d.start('movie-1'); assert.equal(d.runtime.getSnapshot().forcedOnly, undefined); assert.equal(d.requests.some(request => request.path.endsWith('/lines')), false);}
  finally {d.runtime.dispose();}
});

test('late image counts cannot grant a filter after source replacement, collapse or authority retirement', async () => {
  for (const retire of ['source', 'collapse', 'authority'] as const) {
    const d = fixture(false, undefined, {...nativeEngineFeatures, subtitleRendering: ['text', 'vobsub']}, false, undefined, 'mpv');
    let finish!: (response: FakeResponse) => void, first: FakeRequest | undefined;
    richSubtitleResponses(d, 1250, {engine: 'mpv', read: request => {
      if (!first) {first = request; return new Promise(resolve => {finish = resolve;});}
      return {status: 200, headers: {}, body: {forced: 0, total: 3}};
    }});
    try {
      await d.start('movie-1'); const fence = d.runtime.getSnapshot().fence!;
      assert.ok(first); assert.equal(d.runtime.getSnapshot().forcedOnly, undefined);
      if (retire === 'source') await d.start('movie-2');
      else if (retire === 'collapse') await d.runtime.collapse(fence);
      else {d.changeAuthority(); await settle();}
      assert.equal(first.signal?.aborted, true, retire);
      finish({status: 200, headers: {}, body: {forced: 1, total: 3}}); await settle();
      assert.equal(d.runtime.getSnapshot().forcedOnly, undefined, retire);
      assert.equal(d.runtime.setForcedOnly(fence, true), false, retire);
      assert.equal(d.engine.commands.some(command => command.subtitles?.forcedOnly === true), false, retire);
    } finally {d.runtime.dispose();}
  }
});

test('PiP replan preserves the actual source/track/file clock then waits for new-generation native acknowledgement', async () => {
  const d = fixture(false, undefined, {...nativeEngineFeatures, subtitleRendering: ['text', 'vobsub']}, true); richSubtitleResponses(d);
  try {
    await d.start('movie-1'); d.engine.position = 37; d.engine.emit('progress'); await settle();
    const source = d.runtime.getSnapshot();
    assert.equal(source.playback.phase, 'ready'); assert.equal(!!source.playback.pendingSeek, false); assert.equal(!!source.playback.failedSeek, false);
    assert.equal(!!d.runtime.path.controller.getSnapshot().changing, false); assert.ok(source.pictureInPicture);
    assert.equal(source.subtitles?.suppressed, false);
    assert.equal(externalSubtitlePreparation(source.subtitles?.plan, source.session!).kind, 'burn');
    const pending = d.runtime.requestPictureInPicture(source.fence!, versionLifetime());
    await settle();
    const change = d.requests.find(request => request.method === 'PATCH' && record(request.body) && record(request.body.subtitles) && request.body.subtitles.delivery === 'burn');
    assert.ok(change && record(change.body)); assert.deepEqual(change.body.subtitles, {trackId: 'rich-resource', delivery: 'burn'});
    assert.equal(change.body.subtitleOffsetMs, 1250, 'complete file correction wins over the separate 500ms plan fallback');
    assert.equal(change.body.positionMs, 37000); assert.equal(d.runtime.getSnapshot().session?.id, source.session?.id);
    assert.equal(d.runtime.getSnapshot().session?.versionId, source.session?.versionId);
    assert.ok(d.runtime.getSnapshot().fence!.generation > source.fence!.generation);
    assert.equal(d.runtime.getSnapshot().pictureInPicture?.request, 0, 'ready/firstFrame without native acknowledgement never requests PiP');
    d.engine.externalReady = true; d.engine.emit('progress');
    assert.equal(await pending, true);
    const request = d.runtime.getSnapshot().pictureInPicture!;
    assert.equal(request.request, 1); assert.deepEqual(request.binding, d.engine.lastCommand.binding);
    await d.start('movie-2'); assert.equal(d.runtime.getSnapshot().pictureInPicture?.request, 1); assert.equal(d.runtime.getSnapshot().pictureInPicture?.binding, undefined);
  } finally {d.runtime.dispose();}
});

test('external source readiness cannot survive caller close or an unknown old-binary acknowledgement', async () => {
  const d = fixture(false, undefined, nativeEngineFeatures, true);
  try {
    await d.start('movie-1');
    // Current subtitle identity is present but no loaded plan: no invented Off or burn choice.
    assert.equal(await d.runtime.requestPictureInPicture(d.runtime.getSnapshot().fence!, versionLifetime()), false);
    assert.equal(d.runtime.getSnapshot().pictureInPicture?.request, 0);
  } finally {d.runtime.dispose();}
  const rich = fixture(false, undefined, {...nativeEngineFeatures, subtitleRendering: ['text', 'vobsub']}, true); richSubtitleResponses(rich);
  try {
    await rich.start('movie-1'); const caller = new AbortController(), generation = rich.runtime.getSnapshot().fence!.generation;
    const pending = rich.runtime.requestPictureInPicture(rich.runtime.getSnapshot().fence!, {signal: caller.signal, isCurrent: () => !caller.signal.aborted});
    await settle(); assert.ok(rich.runtime.getSnapshot().fence!.generation > generation); caller.abort(); assert.equal(await pending, false);
    rich.engine.externalReady = true; rich.engine.emit('progress'); await settle();
    assert.equal(rich.runtime.getSnapshot().pictureInPicture?.request, 0);
  } finally {rich.runtime.dispose();}
});

test('an old binary without an external acknowledgement times out without a PiP request', async () => {
  const d = fixture(false, undefined, {...nativeEngineFeatures, subtitleRendering: ['text', 'vobsub']}, true); richSubtitleResponses(d);
  try {
    await d.start('movie-1');
    const generation = d.runtime.getSnapshot().fence!.generation, sessionId = d.runtime.getSnapshot().session!.id, pending = d.runtime.requestPictureInPicture(d.runtime.getSnapshot().fence!, versionLifetime());
    await settle(); assert.ok(d.runtime.getSnapshot().fence!.generation > generation);
    const timers = d.pendingTimers(10000); assert.ok(timers.length >= 1);
    // Session keepalive and the external-ready deadline share this duration.
    // Let each actual scheduled callback run; the current session remains owned.
    for (const timer of timers) timer.run();
    assert.equal(await pending, false); assert.equal(d.runtime.getSnapshot().pictureInPicture?.request, 0);
    assert.equal(d.runtime.getSnapshot().session?.id, sessionId);
    assert.equal(d.requests.filter(request => request.method === 'POST' && request.path === '/v1/playback/sessions').length, 1);
  } finally {d.runtime.dispose();}
});

test('subtitle controls use the real source service and retire with its session and authority', async () => {
  const d = fixture();
  d.respond(request => subtitleResponse(d, request));
  try {
    assert.equal(d.runtime.getSnapshot().fence, undefined);
    await d.start('movie-1');
    const fence = d.runtime.getSnapshot().fence!, controls = d.runtime.subtitleControls(fence);
    assert.ok(controls, 'controls require the actual loaded plan for this session/generation');
    assert.equal(controls.addFile, undefined, 'an absent platform picker never advertises Add file');
    await controls.search('en', 'provider query', 1);
    assert.ok(d.requests.some(request => request.method === 'POST' && request.path === '/v1/items/movie-1/subtitles/search' && record(request.body) && request.body.sourceId === 'physical-source-1'));
    await d.start('movie-2');
    const count = d.requests.length;
    await assert.rejects(controls.search('en', 'stale query'));
    assert.equal(d.requests.length, count, 'a retained old sheet sends no command to the replaced source');
    assert.equal(d.runtime.subtitleControls(fence), undefined);
    const current = d.runtime.getSnapshot().fence!, currentControls = d.runtime.subtitleControls(current);
    assert.ok(currentControls);
    d.changeAuthority();
    await assert.rejects(currentControls.refresh());
    assert.equal(d.runtime.subtitleControls(current), undefined);
  } finally { d.runtime.dispose(); }
});

test('the installed picker uploads through the actual current source service and preserves caller metadata', async () => {
  const d = fixture(false, {pick: async () => ({data: 'SURYCg==', companion: 'U1VCCg==', format: 'idx', title: 'Chosen file'})});
  d.respond(request => subtitleResponse(d, request));
  try {
    await d.start('movie-1');
    const controls = d.runtime.subtitleControls(d.runtime.getSnapshot().fence!)!;
    assert.ok(controls.addFile);
    assert.equal(await controls.addFile({language: 'fr', rights: 'Viewer supplied rights', scope: 'personal', offsetUs: '-500000'}, versionLifetime()), true);
    const upload = d.requests.find(request => request.method === 'POST' && request.path === '/v1/items/movie-1/subtitles');
    assert.ok(upload && record(upload.body));
    assert.deepEqual(upload.body, {data: 'SURYCg==', companion: 'U1VCCg==', format: 'idx', title: 'Chosen file', language: 'fr', rights: 'Viewer supplied rights', scope: 'personal', offsetUs: '-500000', operationId: upload.body.operationId, sourceId: 'physical-source-1', expectedRevision: 0});
  } finally {d.runtime.dispose();}
});

test('retiring the real source cancels its picker and a late native result cannot upload to the replacement', async () => {
  let finish!: (value: {data: string; format: 'srt'; title: string}) => void, pickerSignal: AbortSignal | undefined;
  const d = fixture(false, {pick: signal => {pickerSignal = signal; return new Promise(resolve => {finish = resolve;});}});
  d.respond(request => subtitleResponse(d, request));
  try {
    await d.start('movie-1');
    const controls = d.runtime.subtitleControls(d.runtime.getSnapshot().fence!)!;
    const pending = controls.addFile!({language: 'en', rights: '', scope: 'personal', offsetUs: '0'}, versionLifetime());
    await d.start('movie-2');
    assert.equal(pickerSignal?.aborted, true); assert.equal(await pending, false);
    finish({data: 'U1JUCg==', format: 'srt', title: 'Late file'}); await settle();
    assert.equal(d.requests.filter(request => request.method === 'POST' && /^\/v1\/items\/[^/]+\/subtitles$/.test(request.path)).length, 0);
  } finally {d.runtime.dispose();}
});

test('a sheet close during a real subtitle upload aborts its request and cannot acknowledge its late receipt', async () => {
  const d = fixture(false, {pick: async () => ({data: 'U1JUCg==', format: 'srt', title: 'Chosen file'})});
  let finish!: (response: FakeResponse) => void, upload: FakeRequest | undefined;
  d.respond(request => {
    if (request.method === 'POST' && request.path === '/v1/items/movie-1/subtitles') {upload = request; return new Promise(resolve => {finish = resolve;});}
    return subtitleResponse(d, request);
  });
  try {
    await d.start('movie-1');
    const caller = new AbortController(), controls = d.runtime.subtitleControls(d.runtime.getSnapshot().fence!)!;
    const pending = controls.addFile!({language: 'en', rights: '', scope: 'personal', offsetUs: '0'}, {signal: caller.signal, isCurrent: () => !caller.signal.aborted});
    await settle(); assert.ok(upload); caller.abort(); assert.equal(upload.signal?.aborted, true);
    finish(subtitleResponse(d, upload)!); assert.equal(await pending, false);
  } finally {d.runtime.dispose();}
});

test('a start creates the actual queue and session and commands the native port at the requested position', async () => {
  const d = fixture();
  try {
    await d.start('movie-1', 30);
    const state = d.runtime.getSnapshot();
    assert.equal(state.playback.phase, 'ready', state.playback.error);
    assert.equal(state.playback.positionSeconds, 30);
    assert.equal(state.fence?.sessionId, state.playback.session?.id);
    assert.ok(state.fence?.kind === 'queue');
    assert.equal(state.fence?.sourceId, state.session?.versionId);
    assert.equal(state.fence?.entryId, state.session?.queue?.entryId);
    assert.equal(state.queue.view?.queue.id, state.session?.queue?.queueId);
    assert.equal(d.engine.lastCommand.binding.sessionId, state.fence?.sessionId);
    assert.ok(d.engine.lastCommand.source.startsWith('https://portico.test/'));
    assert.equal(state.capabilities.cast, false);
    assert.ok(d.requests.some(request => request.method === 'POST' && request.path === routePath('start_playback_session')) || d.requests.some(request => request.method === 'POST' && request.path.includes('/playback/sessions')));
    assert.ok(d.server.session(state.fence!.sessionId));
  } finally { d.runtime.dispose(); }
});

test('only an accepted current native fact publishes external readiness and old binaries remain unknown', async () => {
  const d = fixture();
  try {
    await d.start('movie-1');
    assert.equal(d.runtime.getSnapshot().externalPresentationBinding, undefined);
    const binding = {...d.engine.lastCommand.binding};
    d.engine.emit('progress', {externalPresentationBinding: binding});
    assert.deepEqual(d.runtime.getSnapshot().externalPresentationBinding, binding);
    assert.ok(Object.isFrozen(d.runtime.getSnapshot().externalPresentationBinding));
    d.engine.emit('progress', {externalPresentationBinding: {...binding, generation: binding.generation + 1}});
    assert.equal(d.runtime.getSnapshot().externalPresentationBinding, null);
    d.engine.emit('progress', {externalPresentationBinding: binding});
    assert.deepEqual(d.runtime.getSnapshot().externalPresentationBinding, binding);
    d.engine.emit('progress', {externalPresentationBinding: null});
    assert.equal(d.runtime.getSnapshot().externalPresentationBinding, null);
    d.engine.emit('progress');
    assert.equal(d.runtime.getSnapshot().externalPresentationBinding, undefined);
    await d.start('movie-2');
    d.engine.emit('progress', {externalPresentationBinding: binding});
    assert.equal(d.runtime.getSnapshot().externalPresentationBinding, null, 'the old presentation never grants readiness to a replacement');
    d.changeAuthority(); assert.equal(d.runtime.getSnapshot().externalPresentationBinding, null, 'retiring the authority explicitly withholds external readiness');
  } finally {d.runtime.dispose();}
});

test('pause, resume and a correlated seek change real engine commands, while stale fences do nothing', async () => {
  const d = fixture();
  try {
    await d.start('movie-1');
    const fence = d.runtime.getSnapshot().fence!;
    await d.runtime.toggle(fence); await settle();
    assert.equal(d.engine.lastCommand.paused, true);
    await d.runtime.toggle(fence); await settle();
    assert.equal(d.engine.lastCommand.paused, false);
    await d.runtime.seek(fence, 74); await settle();
    assert.equal(d.runtime.getSnapshot().playback.positionSeconds, 74);
    assert.equal(d.runtime.getSnapshot().playback.pendingSeek, undefined);
    await d.start('movie-2');
    const count = d.engine.commands.length, current = d.runtime.getSnapshot().fence!;
    await d.runtime.seek(fence, 2); await d.runtime.stop(fence); await d.runtime.toggle(fence); await settle();
    assert.equal(d.engine.commands.length, count);
    assert.equal(d.runtime.getSnapshot().fence?.sessionId, current.sessionId);
    assert.equal(d.runtime.getSnapshot().playback.intent, 'playing');
  } finally { d.runtime.dispose(); }
});

for (const kind of ['queue', 'live'] as const) test(`Back keeps an actual ${kind} playback error collapsed through repeated source notifications`, async () => {
  const d = fixture();
  try {
    if (kind === 'queue') await d.start('movie-1', 31);
    else { await d.runtime.selectionPlayback(() => true).playChannel(homeChannel(), selectionContext(), new AbortController().signal); await settle(); }
    const initial = d.runtime.getSnapshot(), fence = initial.fence!;
    d.runtime.collapse(fence);
    d.engine.emit('error', {deliveryError: true, networkError: false}); await settle();
    const failed = d.runtime.getSnapshot();
    assert.equal(failed.playback.phase, 'error');
    assert.ok(failed.playback.error);
    assert.equal(failed.playback.intent, 'paused');
    assert.equal(failed.dock.local?.expanded, true, 'a new actual error still breaks through the quiet dock');
    assert.deepEqual(failed.fence, fence);

    for (const collapse of [() => d.runtime.collapse(fence), () => d.runtime.onTransition(d.runtime.dock.collapse(fence))]) {
      d.runtime.open(fence);
      assert.equal(d.runtime.getSnapshot().dock.local?.expanded, true, 'explicit Open remains available during the error');
      await collapse();
      const seen: boolean[] = [], sent = d.requests.length;
      const off = d.runtime.subscribe(() => { seen.push(d.runtime.getSnapshot().dock.local?.expanded ?? false); });
      try {
        if (kind === 'queue') await d.runtime.queue.refresh();
        await d.runtime.refreshAuthority();
        d.settings({subtitles: {size: 'large', color: 'white', background: 'translucent', position: 'bottom', font: 'default', keepStyling: true, useSystemCaptionStyle: false}});
        d.engine.emit('error', {deliveryError: true, networkError: false});
        d.engine.emit('progress'); await settle();
        const collapsed = d.runtime.getSnapshot();
        assert.equal(collapsed.dock.local?.expanded, false);
        assert.ok(seen.length > 0); assert.ok(seen.every(expanded => !expanded), 'no transient full Surface reopen after Back');
        assert.equal(collapsed.playback.phase, 'error', 'Back never hides or clears the actual service error');
        assert.equal(collapsed.playback.error, failed.playback.error);
        assert.equal(collapsed.playback.intent, 'paused');
        assert.deepEqual(collapsed.fence, fence);
        assert.equal(collapsed.lease, initial.lease);
        assert.equal(d.engine.released.length, 0);
        assert.equal(d.engine.subscriptions, 1);
        assert.equal(d.server.session(fence.sessionId)?.ended, false);
        assert.equal(d.requests.slice(sent).some(request => request.method === 'DELETE' || playingRequest(request)), false);
      } finally { off(); }
    }
  } finally { d.runtime.dispose(); }
});

test('presentation replacement rejects stale completion and a dismissed error does not mask a fresh same-item source error', async () => {
  const d = fixture();
  try {
    await d.start('movie-1');
    const original = d.runtime.getSnapshot(), oldCommand = d.engine.lastCommand, listener = d.engine.listener!;
    d.runtime.collapse(original.fence!);
    await d.runtime.chooseQuality(original.fence!, original.options!.qualities.find(option => option.mode === 'fixed' && option.id === '720p-high')!); await settle();
    const replacement = d.runtime.getSnapshot(), fence = replacement.fence!;
    assert.equal(replacement.playback.phase, 'ready');
    assert.equal(fence.sessionId, original.fence!.sessionId);
    assert.ok(fence.generation > original.fence!.generation);
    assert.equal(replacement.dock.local?.expanded, false, 'a source replan preserves the collapsed presentation');
    for (const type of ['error', 'ended']) listener({type, instanceId: 'engine-instance', binding: oldCommand.binding, intentId: oldCommand.binding.intentId,
      factSequence: 999999, lastCommandRevision: oldCommand.commandRevision, position: 180, paused: true, deliveryError: true, networkError: false});
    await settle();
    assert.equal(d.runtime.getSnapshot().playback.phase, 'ready');
    assert.equal(d.runtime.getSnapshot().dock.local?.expanded, false);
    assert.deepEqual(d.runtime.getSnapshot().fence, fence);
    d.engine.emit('error', {deliveryError: true, networkError: false}); await settle();
    assert.equal(d.runtime.getSnapshot().playback.phase, 'error');
    assert.equal(d.runtime.getSnapshot().dock.local?.expanded, true, 'the replacement generation gets its own actual error attention');
    d.runtime.collapse(fence);
    // Replanning an errored session genuinely replaces the session instead of bumping
    // its presentation generation. Its real new identity must get fresh error attention.
    await d.runtime.chooseQuality(fence, original.options!.qualities.find(option => option.mode === 'fixed' && option.id === '720p-high')!); await settle();
    const retried = d.runtime.getSnapshot();
    assert.equal(retried.playback.phase, 'ready');
    assert.notEqual(retried.fence?.sessionId, fence.sessionId);
    assert.equal(retried.playback.itemId, 'movie-1');
    assert.equal(retried.dock.local?.expanded, false);
    d.engine.emit('error', {deliveryError: true, networkError: false}); await settle();
    assert.equal(d.runtime.getSnapshot().playback.phase, 'error');
    assert.equal(d.runtime.getSnapshot().dock.local?.expanded, true);
    d.runtime.collapse(retried.fence!);
    await d.start('movie-2');
    const next = d.runtime.getSnapshot();
    assert.notEqual(next.playback.intentId, replacement.playback.intentId);
    assert.equal(next.dock.local?.expanded, true, 'a new video start keeps its normal opening intent');
    d.runtime.collapse(fence);
    assert.equal(d.runtime.getSnapshot().dock.local?.expanded, true, 'the old source cannot collapse a replacement');
  } finally { d.runtime.dispose(); }
});

test('queue advancement retains its real run and gives a new entry error attention after a prior Back', async () => {
  const d = fixture();
  try {
    d.runtime.connect();
    await d.runtime.queue.playEntries([queueItemInput('movie-1'), queueItemInput('movie-2')], {startSeconds: 0}); await settle();
    const first = d.runtime.getSnapshot().fence!;
    d.engine.emit('error', {deliveryError: true, networkError: false}); await settle();
    d.runtime.collapse(first);
    // Use the actual queue control: error snapshots correctly offer no Next capability.
    const queue = d.runtime.getSnapshot().queue.view!.queue;
    await d.runtime.queue.next(queue.id, queue.revision); await settle();
    const next = d.runtime.getSnapshot(), fence = next.fence!;
    assert.equal(next.playback.phase, 'ready');
    assert.equal(fence.playback.run, first.playback.run);
    assert.notEqual(fence.sessionId, first.sessionId);
    assert.ok(fence.kind === 'queue' && first.kind === 'queue');
    assert.notEqual(fence.entryId, first.entryId);
    assert.equal(next.dock.local?.expanded, false);
    d.engine.emit('error', {deliveryError: true, networkError: false}); await settle();
    assert.equal(d.runtime.getSnapshot().playback.phase, 'error');
    assert.equal(d.runtime.getSnapshot().dock.local?.expanded, true);
  } finally { d.runtime.dispose(); }
});

test('audio handover restores its original queue entry and settled place in a fresh paused session', async () => {
  const d = fixture();
  try {
    await d.start('song-1', 41);
    const music = d.runtime.getSnapshot();
    await d.start('movie-1', 7);
    assert.equal(d.runtime.getSnapshot().dock.parkedAudio?.fence.sessionId, music.fence!.sessionId);
    const video = d.runtime.getSnapshot().fence!;
    const commandCount = d.engine.commands.length;
    await d.runtime.stop(video); await settle();
    const restored = d.runtime.getSnapshot();
    assert.equal(restored.playback.itemId, 'song-1');
    assert.equal(restored.playback.positionSeconds, 41);
    assert.equal(restored.playback.intent, 'paused');
    assert.notEqual(restored.fence?.sessionId, music.fence!.sessionId);
    assert.equal(restored.session?.queue?.queueId, music.session?.queue?.queueId);
    assert.ok(restored.fence?.kind === 'queue' && music.fence?.kind === 'queue');
    assert.equal(restored.fence?.entryId, music.fence!.entryId);
    assert.ok(d.engine.commands.slice(commandCount).filter(command => command.binding.itemId === 'song-1').every(command => command.paused === true));
    assert.equal(d.server.session(restored.fence!.sessionId)?.state, 'paused');
  } finally { d.runtime.dispose(); }
});

test('an explicit bookmark restore never resumes a newer replacement that wins during the paused start', async () => {
  const d = fixture();
  let release!: () => void;
  try {
    await d.start('song-1', 41); const music = d.runtime.getSnapshot().fence!;
    await d.start('movie-1', 7);
    const held = new Promise<void>(resolve => { release = resolve; });
    let entered = false;
    d.intercept(async request => { if (request.method === 'POST' && (request.body as {state?: string})?.state === 'paused' && !entered) { entered = true; await held; } });
    const restoring = d.runtime.restoreBookmark(music, true);
    await settle(); assert.equal(entered, true);
    await d.start('movie-2', 19);
    const winner = d.runtime.getSnapshot().fence!;
    await d.runtime.toggle(winner); await settle();
    release(); assert.equal(await restoring, undefined); await settle();
    assert.equal(d.runtime.getSnapshot().fence?.sessionId, winner.sessionId);
    assert.equal(d.runtime.getSnapshot().playback.intent, 'paused');
    assert.equal(d.engine.lastCommand.binding.sessionId, winner.sessionId);
    assert.equal(d.engine.lastCommand.paused, true);
  } finally { release?.(); d.runtime.dispose(); }
});

test('a create retains all three actual dock queue candidates and the next create retires superseded extras', async () => {
  const d = fixture();
  const queueId = () => { const queue = d.runtime.getSnapshot().session?.queue; assert.ok(queue); return queue.queueId; };
  const queueStatus = async (id: string) => (await d.server.handle({method: 'GET', path: encodedRoutePath('get_queue', {id: encodeURIComponent(id)})})).status;
  try {
    await d.start('movie-a', 11); const a = queueId(), videoA = d.runtime.getSnapshot().fence;
    await d.start('song-b', 22); const b = queueId(), audioB = d.runtime.getSnapshot().fence;
    await d.start('movie-c', 33); const c = queueId();
    assert.equal(new Set([a, b, c]).size, 3);
    assert.deepEqual(d.runtime.getSnapshot().dock.resumeVideo?.fence, videoA);
    assert.deepEqual(d.runtime.getSnapshot().dock.parkedAudio?.fence, audioB);
    let sent = d.requests.length;
    await d.start('movie-d', 44); const current = queueId();
    const create = d.requests.slice(sent).find(request => request.method === 'POST' && request.path === routePath('create_queue'));
    assert.ok(create && record(create.body));
    assert.deepEqual(create.body.retainQueueIds, [c, b, a]);
    for (const id of [a, b, c, current]) assert.equal(await queueStatus(id), 200);
    sent = d.requests.length;
    await d.runtime.selectionPlayback(() => true).play({context: selectionContext(), signal: new AbortController().signal, items: [selected('movie-e')]}); await settle();
    const next = queueId();
    const selectionCreate = d.requests.slice(sent).find(request => request.method === 'POST' && request.path === routePath('create_queue'));
    assert.ok(selectionCreate && record(selectionCreate.body));
    assert.deepEqual(selectionCreate.body.retainQueueIds, [current, b, a]);
    assert.equal(await queueStatus(c), 404, 'a superseded local video is not retained just because it remains in the bookmark cache');
    for (const id of [a, b, current, next]) assert.equal(await queueStatus(id), 200);
    assert.deepEqual(d.runtime.getSnapshot().dock.resumeVideo?.fence, videoA);
    assert.deepEqual(d.runtime.getSnapshot().dock.parkedAudio?.fence, audioB);
  } finally { d.runtime.dispose(); }
});

test('Home selection handover retains the exact audio fence and restores its original queue paused', async () => {
  const d = fixture();
  try {
    await d.start('song-1', 41);
    const music = d.runtime.getSnapshot(); assert.ok(music.fence?.kind === 'queue' && music.session?.queue);
    const sent = d.requests.length;
    await d.runtime.selectionPlayback(() => true).play({context: selectionContext(), signal: new AbortController().signal, items: [selected('movie-selection')]}); await settle();
    const video = d.runtime.getSnapshot(); assert.ok(video.fence?.kind === 'queue');
    assert.deepEqual(video.dock.parkedAudio?.fence, music.fence);
    const create = d.requests.slice(sent).find(request => request.method === 'POST' && request.path === routePath('create_queue'));
    assert.ok(create && record(create.body));
    assert.deepEqual(create.body.retainQueueIds, [music.session.queue.queueId]);
    const commanded = d.engine.commands.length;
    await d.runtime.stop(video.fence); await settle();
    const restored = d.runtime.getSnapshot(); assert.ok(restored.fence?.kind === 'queue');
    assert.equal(restored.session?.queue?.queueId, music.session.queue.queueId);
    assert.equal(restored.fence.entryId, music.fence.entryId);
    assert.notEqual(restored.fence.sessionId, music.fence.sessionId);
    assert.equal(restored.playback.positionSeconds, 41);
    assert.equal(restored.playback.intent, 'paused');
    const commands = d.engine.commands.slice(commanded).filter(command => command.binding.sessionId === restored.fence?.sessionId);
    assert.ok(commands.length > 0); assert.ok(commands.every(command => command.paused === true));
  } finally { d.runtime.dispose(); }
});

test('current video and parked audio from the same actual mixed queue retain that queue only once', async () => {
  const d = fixture();
  try {
    d.runtime.connect();
    await d.runtime.queue.playEntries([queueItemInput('song-1'), queueItemInput('movie-1')], {startSeconds: 0}); await settle();
    const music = d.runtime.getSnapshot(); assert.ok(music.fence?.kind === 'queue' && music.session?.queue);
    await d.runtime.next(music.fence); await settle();
    const video = d.runtime.getSnapshot(); assert.ok(video.fence?.kind === 'queue');
    assert.equal(video.session?.queue?.queueId, music.session.queue.queueId);
    assert.deepEqual(video.dock.parkedAudio?.fence, music.fence);
    const sent = d.requests.length;
    await d.start('movie-2', 17);
    const create = d.requests.slice(sent).find(request => request.method === 'POST' && request.path === routePath('create_queue'));
    assert.ok(create && record(create.body));
    assert.deepEqual(create.body.retainQueueIds, [music.session.queue.queueId]);
  } finally { d.runtime.dispose(); }
});

test('profile retirement aborts pending source reads, releases the engine and removes every listener', async () => {
  const d = fixture();
  try {
    await d.start('movie-1'); const fence = d.runtime.getSnapshot().fence!, oldListener = d.engine.listener;
    const sent = d.requests.length;
    d.changeAuthority(); await settle();
    assert.equal(d.runtime.getSnapshot().retired, true);
    assert.equal(d.runtime.getSnapshot().dock.local, null);
    assert.equal(d.runtime.getSnapshot().fence, undefined);
    assert.equal(d.engine.subscriptions, 0);
    assert.equal(d.subscriptions, 0);
    assert.equal(d.disposedCapabilities, 1);
    assert.ok(d.engine.released.length > 0);
    oldListener?.({type: 'progress', binding: d.engine.lastCommand.binding, instanceId: 'engine-instance', factSequence: 99999, lastCommandRevision: d.engine.lastCommand.commandRevision, position: 90, intentId: d.engine.lastCommand.binding.intentId});
    await d.runtime.toggle(fence); await d.runtime.seek(fence, 1); await settle();
    assert.equal(d.requests.length, sent);
    assert.equal(d.runtime.getSnapshot().playback.phase, 'idle');
  } finally { d.runtime.dispose(); }
});

test('automatic safe intro skipping still uses the real seek while docked and Ask stays quiet', async () => {
  const d = fixture();
  try {
    await d.start('movie-1', 12); const fence = d.runtime.getSnapshot().fence!;
    d.runtime.collapse(fence); await settle();
    assert.equal(d.runtime.getSnapshot().dock.local?.expanded, false);
    assert.equal(d.runtime.getSnapshot().playback.positionSeconds, 12);
    d.settings({skips: {intro: 'auto', recap: 'ask', credits: 'ask'}});
    d.engine.emit('progress'); await settle();
    assert.equal(d.runtime.getSnapshot().playback.positionSeconds, 69);
    assert.equal(d.runtime.getSnapshot().playback.pendingSeek, undefined);
    assert.equal(d.runtime.getSnapshot().dock.local?.expanded, false);
  } finally { d.runtime.dispose(); }
});

test('unsupported wire markers cannot mask an authoritative intro during automatic skipping', async () => {
  const d = fixture();
  try {
    d.markers([
      {id: 'other-1', type: 'other', startMs: 0, endMs: 170000, confidence: 'manual', automaticSafe: true},
      {id: 'preview-1', type: 'preview', startMs: 0, endMs: 170000, confidence: 'manual', automaticSafe: true},
      {id: 'intro-1', type: 'intro', startMs: 10000, endMs: 70000, confidence: 'manual', automaticSafe: true},
    ]);
    await d.start('movie-1', 12);
    const fence = d.runtime.getSnapshot().fence;
    assert.ok(fence);
    d.runtime.collapse(fence);
    d.settings({skips: {intro: 'auto', recap: 'ask', credits: 'ask'}});
    d.engine.emit('progress'); await settle();
    assert.equal(d.runtime.getSnapshot().playback.positionSeconds, 69);
    assert.equal(d.runtime.getSnapshot().playback.pendingSeek, undefined);
    assert.equal(d.runtime.getSnapshot().dock.local?.expanded, false);
  } finally { d.runtime.dispose(); }
});

test('queue previous, next and replay use actual entries and keep one playback run', async () => {
  const d = fixture();
  try {
    d.runtime.connect();
    await d.runtime.queue.playEntries([queueItemInput('movie-1'), queueItemInput('movie-2')], {startSeconds: 0}); await settle();
    const first = d.runtime.getSnapshot().fence!, run = first.playback.run;
    assert.equal(d.runtime.getSnapshot().capabilities.next, true);
    await d.runtime.next(first); await settle();
    const second = d.runtime.getSnapshot().fence!;
    assert.ok(second.kind === 'queue');
    assert.equal(second.itemId, 'movie-2'); assert.equal(second.playback.run, run);
    await d.runtime.previous(second); await settle();
    const previous = d.runtime.getSnapshot().fence!;
    assert.ok(previous.kind === 'queue');
    assert.equal(previous.itemId, 'movie-1');
    await d.runtime.replay(previous); await settle();
    assert.equal(d.runtime.getSnapshot().playback.positionSeconds, 0);
    assert.equal(d.runtime.getSnapshot().fence?.playback.run, run);
  } finally { d.runtime.dispose(); }
});

test('a second native surface attachment is rejected and unmount tears down one actual lease', async () => {
  const d = fixture();
  try {
    const detach = d.runtime.attachSurface({});
    assert.throws(() => d.runtime.attachSurface({}), /already mounted/);
    await d.start('movie-1'); const sessionId = d.runtime.getSnapshot().fence!.sessionId; detach(); await settle();
    assert.equal(d.runtime.getSnapshot().retired, true);
    assert.equal(d.engine.subscriptions, 0);
    assert.equal(d.engine.released.length, 1);
    assert.equal(d.server.session(sessionId)?.ended, true);
  } finally { d.runtime.dispose(); }
});

test('quality and audio changes replan the real session and fence old generation callbacks', async () => {
  const d = fixture();
  try {
    await d.start('movie-1', 30);
    const before = d.runtime.getSnapshot(), original = before.fence!, oldCommand = d.engine.lastCommand, listener = d.engine.listener!;
    d.runtime.setRate(original, 1.5); await settle();
    assert.equal(d.engine.lastCommand.rate, 1.5);
    const quality = before.options!.qualities.find(option => option.mode === 'fixed' && option.id === '720p-high')!;
    await d.runtime.chooseQuality(original, quality); await settle();
    const changed = d.runtime.getSnapshot();
    assert.equal(changed.fence?.sessionId, original.sessionId);
    assert.ok(changed.fence!.generation > original.generation);
    assert.equal(changed.session?.presentation.quality.id, '720p-high');
    assert.equal(d.engine.lastCommand.rate, 1.5);
    const stablePosition = changed.playback.positionSeconds;
    listener({type: 'progress', instanceId: 'engine-instance', binding: oldCommand.binding, intentId: oldCommand.binding.intentId, factSequence: 999999,
      lastCommandRevision: oldCommand.commandRevision, position: 2, paused: false});
    await d.runtime.seek(original, 2); await settle();
    assert.equal(d.runtime.getSnapshot().playback.positionSeconds, stablePosition);
    const fence = d.runtime.getSnapshot().fence!;
    await d.runtime.change(fence, {audioTrackId: 'a2'}); await settle();
    assert.equal(d.runtime.getSnapshot().session?.presentation.audioTrackId, 'a2');
    await d.start('movie-2');
    assert.equal(d.engine.lastCommand.rate, 1, 'a fresh playback reads Settings instead of the prior session override');
  } finally { d.runtime.dispose(); }
});

test('a selected grouped version uses the command final Options resume rather than a caller or earlier menu position', async () => {
  const d=fixture(true);
  try {
    d.resume(27000);await d.start('movie-1',13);
    const state=d.runtime.getSnapshot(), options=state.options!;
    assert.equal(options.resume?.positionMs,27000);d.resume(4500);
    assert.deepEqual(options.versions.map(value=>value.id),['v1','v2']);
    await d.runtime.startVersion({entry:state.entry!,target:{itemId:'movie-1',startSeconds:17}},
      {lifetime:versionLifetime(),authority:state.authority,options,versionId:'v2',expectedFence:state.fence});
    await settle();
    assert.equal(d.runtime.getSnapshot().session?.versionId,'v2',JSON.stringify({requests:d.requests.slice(-12),before:state.fence,after:d.runtime.getSnapshot().fence}));
    assert.equal(d.runtime.getSnapshot().playback.positionSeconds,4.5);
    assert.ok(d.requests.some(request=>request.method==='POST' && record(request.body) && request.body.versionId==='v2'));
  } finally {d.runtime.dispose();}
});

test('version selection rejects another authority, mismatched item and a no-longer-offered id', async () => {
  const d=fixture(true);
  try {
    await d.start('movie-1'); const state=d.runtime.getSnapshot(), options=state.options!, input={entry:state.entry!,target:{itemId:'movie-1'}};
    const before=d.requests.length;
    await d.runtime.startVersion(input,{lifetime:versionLifetime(),authority:{...state.authority,epoch:'old'},options,versionId:'v2',expectedFence:state.fence});
    assert.equal(d.requests.length,before);
    await assert.rejects(d.runtime.startVersion(input,{lifetime:versionLifetime(),authority:state.authority,options:{...options,itemId:'other'},versionId:'v2',expectedFence:state.fence}));
    await assert.rejects(d.runtime.startVersion(input,{lifetime:versionLifetime(),authority:state.authority,options:{...options,versions:[...options.versions,options.versions[1]]},versionId:'v2',expectedFence:state.fence}));
    d.groupedVersions(false);
    await assert.rejects(d.runtime.startVersion(input,{lifetime:versionLifetime(),authority:state.authority,options,versionId:'v2',expectedFence:state.fence}));
    assert.equal(d.runtime.getSnapshot().session?.id,state.session?.id);
    assert.equal(d.runtime.getSnapshot().session?.versionId,'v1');
  } finally {d.runtime.dispose();}
});

test('a version menu opened with no source cannot replace playback that started meanwhile', async () => {
  const d=fixture(true);
  try {
    await d.start('movie-1'); const state=d.runtime.getSnapshot(), before=d.requests.length;
    await d.runtime.startVersion({entry:state.entry!,target:{itemId:'movie-1'}},
      {lifetime:versionLifetime(),authority:state.authority,options:state.options!,versionId:'v2',expectedFence:undefined});
    assert.equal(d.requests.length,before);assert.equal(d.runtime.getSnapshot().session?.id,state.session?.id);
  } finally {d.runtime.dispose();}
});

test('a delayed version revalidation cannot replace a later playback source', async () => {
  const d=fixture(true);let release=()=>{};
  try {
    await d.start('movie-1'); const state=d.runtime.getSnapshot();
    const held=new Promise<void>(resolve=>{release=resolve;});let entered=false;
    d.intercept(async request=>{if(request.path.includes('/movie-1/playback-options')&&!entered){entered=true;await held;}});
    const late=d.runtime.startVersion({entry:state.entry!,target:{itemId:'movie-1'}},
      {lifetime:versionLifetime(),authority:state.authority,options:state.options!,versionId:'v2',expectedFence:state.fence});
    await settle();assert.equal(entered,true);await d.start('movie-current',27);
    release();await late;await settle();
    assert.equal(d.runtime.getSnapshot().playback.itemId,'movie-current');
    assert.equal(d.requests.some(request=>request.method==='POST' && record(request.body) && request.body.versionId==='v2'),false);
  } finally {release();d.runtime.dispose();}
});

test('a superseded preflight cannot create or mount a late session for its previous source', async () => {
  const d = fixture();
  let release!: () => void;
  try {
    const held = new Promise<void>(resolve => { release = resolve; });
    let entered = false;
    d.intercept(async request => { if (request.path.includes('/items/movie-old/playback-options') && !entered) { entered = true; await held; } });
    const oldStart = d.runtime.start({entry: {id: 'movie-old', kind: 'movie', title: 'movie-old', playback: {itemId: 'movie-old'}}, target: {itemId: 'movie-old'}});
    await settle(); assert.equal(entered, true);
    await d.start('movie-current', 27);
    release(); await oldStart; await settle();
    assert.equal(d.runtime.getSnapshot().playback.itemId, 'movie-current');
    assert.equal(d.runtime.getSnapshot().playback.positionSeconds, 27);
    assert.ok(d.engine.commands.every(command => command.binding.itemId !== 'movie-old'));
    assert.equal(d.requests.some(request => request.method === 'POST' && JSON.stringify(request.body).includes('movie-old')), false);
  } finally { release?.(); d.runtime.dispose(); }
});

const selectionContext = (): SelectionContext => ({scope: {serverId: 'server', authority: 'local', accountId: 'account', profileId: 'profile', viewId: 'home', privacyFence: homeFence}, revision: {catalogRevision: '1', viewerRevision: '2'}});
function selected(id: string, kind: 'movie' | 'show' | 'album' = 'movie', target = id): HomeSelectionPlaybackItem {
  return {identity: {id, kind, libraryId: 'library'}, entry: {id, kind, libraryId: 'library', title: id, playback: {itemId: target}}, target: {itemId: target}};
}
function homeChannel(): HomeChannel {
  return {actions: {play: true, favorite: false}, source: {id: 'source-1', name: 'source-1', generation: 'g1', publishedAt: '2026-10-22T00:00:00Z', availableStart: '2026-10-22T00:00:00Z', availableEnd: '2026-10-23T00:00:00Z', provenance: 'live-source', refreshState: 'ready'},
    channel: {id: 'channel-1', sourceId: 'source-1', provenance: 'live-source', name: 'channel-1', number: '1', group: '', generation: 'g1', programmes: [], tuneAvailable: true, recordAvailable: false, tuneUnavailableReason: '', recordUnavailableReason: '', favorite: false, hidden: false, preferenceRevision: 1, mark: {text: '1', seed: 'channel-1'}}};
}

test('Home mixed Play returns the real queue receipt and adopts it through this runtime native engine', async () => {
  const d = fixture(), context = selectionContext(), signal = new AbortController().signal;
  try {
    const collection: HomeSelectionPlaybackItem = {identity: {id: 'collection-1', kind: 'collection', libraryId: 'library'}, collection: {mediaKind: 'movie', collection: {id: 'collection-1', libraryId: 'library', name: 'collection-1', itemCount: 12, revision: 1}, members: []}};
    const result = await d.runtime.selectionPlayback(candidate => candidate === context).play({context, signal, items: [selected('movie-1'), selected('album-1', 'album', 'song-1'), collection]});
    await settle();
    assert.equal(result.queue.id, d.runtime.getSnapshot().session?.queue?.queueId);
    assert.equal(result.queue.total, 25);
    assert.ok(d.server.queue(result.queue.id));
    assert.equal(d.engine.lastCommand.binding.itemId, 'movie-1');
    const create = d.requests.find(request => request.method === 'POST' && request.path === routePath('create_queue'))!;
    assert.deepEqual((create.body as any).segments.map((segment: any) => segment.source), [{items: {ids: ['movie-1']}}, {container: {kind: 'album', id: 'album-1'}}, {container: {kind: 'collection', id: 'collection-1'}}]);
    assert.equal(d.runtime.getSnapshot().dock.local?.queue, null, 'the exact v1 window is retained without manufacturing a strict queue snapshot');
  } finally { d.runtime.dispose(); }
});

test('Home Play next preserves pick order with real chained If-Match receipts and does not restart playback', async () => {
  const d = fixture(), context = selectionContext();
  try {
    await d.start('movie-current'); const session = d.runtime.getSnapshot().fence!.sessionId;
    const result = await d.runtime.selectionPlayback(() => true).enqueue({context, signal: new AbortController().signal, placement: 'next', items: [selected('movie-picked'), selected('show-picked', 'show', 'episode-picked'), selected('movie-last')]});
    await settle();
    const additions = d.requests.filter(request => request.method === 'POST' && request.path.endsWith('/segments'));
    assert.deepEqual(additions.map(request => (request.body as any).source), [{items: {ids: ['movie-last']}}, {container: {kind: 'show', id: 'show-picked'}}, {items: {ids: ['movie-picked']}}]);
    assert.equal(new Set(additions.map(request => request.headers?.['if-match'])).size, 3);
    assert.ok(additions.every(request => !!request.headers?.['idempotency-key']));
    assert.equal(result.queue.total, 15);
    assert.equal(d.runtime.getSnapshot().fence?.sessionId, session);
    assert.equal(d.runtime.getSnapshot().queue.view?.items[1]?.itemId, 'movie-picked');
    assert.equal(d.runtime.getSnapshot().queue.view?.items.at(-1)?.itemId, 'movie-last');
  } finally { d.runtime.dispose(); }
});

test('enqueue without a current queue returns and opens an actual idle queue without creating a session', async () => {
  const d = fixture();
  try {
    const result = await d.runtime.selectionPlayback(() => true).enqueue({context: selectionContext(), signal: new AbortController().signal, placement: 'end', items: [selected('movie-1'), selected('movie-2')]});
    await settle();
    assert.equal(result.queue.id, d.runtime.getSnapshot().queue.view?.queue.id);
    assert.equal(result.queue.total, 2);
    assert.equal(d.runtime.getSnapshot().playback.session, undefined);
    assert.equal(d.engine.commands.length, 0);
    assert.equal(d.requests.some(request => request.method === 'POST' && request.path === routePath('start_playback_session')), false);
  } finally { d.runtime.dispose(); }
});

test('stale Home scope is refused before dispatch and a newer start wins over a delayed selection create', async () => {
  const d = fixture(), context = selectionContext(); let release!: () => void;
  try {
    const port = d.runtime.selectionPlayback(() => true);
    await assert.rejects(port.play({context: {...context, scope: {...context.scope, privacyFence: 'older'}}, signal: new AbortController().signal, items: [selected('movie-old')]}), /stale_selection_context/);
    assert.equal(d.requests.length, 0);
    const held = new Promise<void>(resolve => { release = resolve; }); let entered = false;
    d.intercept(async request => { if (!entered && request.method === 'POST' && request.path === routePath('create_queue')) { entered = true; await held; } });
    const old = port.play({context, signal: new AbortController().signal, items: [selected('movie-old')]});
    const rejected = assert.rejects(old);
    await settle(); assert.equal(entered, true);
    await d.start('movie-new', 18); const winner = d.runtime.getSnapshot().fence!;
    await d.runtime.toggle(winner); await settle();
    release(); await rejected; await settle();
    assert.equal(d.runtime.getSnapshot().fence?.sessionId, winner.sessionId);
    assert.equal(d.runtime.getSnapshot().playback.intent, 'paused');
    assert.ok(d.engine.commands.every(command => command.binding.itemId !== 'movie-old'));
  } finally { release?.(); d.runtime.dispose(); }
});

test('a changed Home revision after a queue read prevents every enqueue write', async () => {
  const d = fixture(), context = selectionContext(); let release!: () => void, current = true;
  try {
    await d.start('movie-current'); const queueId = d.runtime.getSnapshot().session!.queue!.queueId;
    const held = new Promise<void>(resolve => { release = resolve; }); let entered = false;
    d.intercept(async request => { if (!entered && request.method === 'GET' && request.path.endsWith(`/queues/${queueId}`)) { entered = true; await held; } });
    const queued = d.runtime.selectionPlayback(() => current).enqueue({context, signal: new AbortController().signal, placement: 'end', items: [selected('movie-added')]});
    const rejected = assert.rejects(queued);
    await settle(); assert.equal(entered, true); current = false; release(); await rejected; await settle();
    assert.equal(d.requests.some(request => request.method === 'POST' && request.path.endsWith('/segments')), false);
    assert.equal(d.runtime.getSnapshot().playback.itemId, 'movie-current');
  } finally { release?.(); d.runtime.dispose(); }
});

function guideSources(overrides: Record<string, unknown> = {}): FakeResponse {
  return {status: 200, headers: {}, body: {protocolVersion: '1.0', serverId: 'server', viewerFence: homeFence, revision: 'directory-1', sources: [
    {...homeChannel().source, position: 0, recordAvailable: false, guideDays: 1, channelCount: 1, favoriteCount: 0, groups: [], groupCounts: [], unavailableReasons: {}, ...overrides},
  ]}};
}

test('a genuine channel route resolves the current directory generation and adopts the existing queue-free engine', async () => {
  const d = fixture();
  try {
    d.respond(request => request.path.startsWith(routePath('get_guide_sources') + '?') ? guideSources({generation: 'g2'}) : undefined);
    await d.runtime.startChannel({sourceId: 'source-1', channelId: 'channel-1', timezone: 'America/Halifax', lifetime: versionLifetime()}); await settle();
    const snapshot = d.runtime.getSnapshot(), fence = snapshot.fence;
    assert.ok(fence?.kind === 'channel'); assert.equal(fence.channelGeneration, 'g2');
    assert.equal(fence.sourceId, 'source-1'); assert.equal(fence.channelId, 'channel-1');
    assert.equal(snapshot.session, undefined); assert.equal(snapshot.dock.local?.queue, null);
    assert.equal(d.engine.lastCommand.binding.sessionId, fence.sessionId);
    assert.ok(d.requests.some(request => request.path === routePath('get_guide_sources') + '?timezone=America%2FHalifax'));
    assert.equal(d.requests.some(request => request.method === 'POST' && request.path === routePath('create_queue')), false);
  } finally {d.runtime.dispose();}
});

for (const retirement of ['signal', 'member', 'authority'] as const) test(`channel directory revalidation cannot adopt after route caller retirement: ${retirement}`, async () => {
  const d = fixture(), controller = new AbortController(); let current = true, release!: () => void, entered = false;
  const held = new Promise<void>(resolve => {release = resolve;});
  try {
    d.intercept(async request => {if (request.path.startsWith(routePath('get_guide_sources') + '?')) {entered = true; await held;}});
    const pending = d.runtime.startChannel({sourceId: 'source-1', channelId: 'channel-1', timezone: 'UTC', lifetime: {signal: controller.signal, isCurrent: () => current}});
    await settle(); assert.equal(entered, true);
    if (retirement === 'signal') controller.abort(); else if (retirement === 'member') current = false; else d.changeAuthority();
    release(); await pending; await settle();
    assert.equal(d.runtime.getSnapshot().fence, undefined);
    assert.equal(d.requests.some(request => request.method === 'POST' && record(request.body) && 'channelId' in request.body), false);
  } finally {release?.(); d.runtime.dispose();}
});

test('an absent source or mismatched library-channel target never starts a channel session', async () => {
  for (const overrides of [{id: 'different-source'}, {provenance: 'library-channel'}]) {
    const d = fixture();
    try {
      d.respond(request => request.path.startsWith(routePath('get_guide_sources') + '?') ? guideSources(overrides) : undefined);
      await assert.rejects(d.runtime.startChannel({sourceId: 'source-1', channelId: 'channel-1', timezone: 'UTC', lifetime: versionLifetime()}), /channel_source_unavailable|invalid_channel_target/);
      assert.equal(d.requests.some(request => request.method === 'POST' && record(request.body) && 'channelId' in request.body), false);
    } finally {d.runtime.dispose();}
  }
});

test('the real channel control mounts a queue-free channel fence and rejects retired channel controls', async () => {
  const d = fixture(), context = selectionContext(), channel = homeChannel();
  try {
    const port = d.runtime.selectionPlayback(() => true);
    await port.playChannel(channel, context, new AbortController().signal); await settle();
    const first = d.runtime.getSnapshot(), fence = first.fence!;
    assert.equal(fence.kind, 'channel');
    assert.ok(fence.kind === 'channel');
    assert.equal(fence.channelId, channel.channel.id); assert.equal(fence.sourceId, channel.source.id); assert.equal(fence.channelGeneration, 'g1');
    assert.equal(first.dock.local?.kind, 'live'); assert.equal(first.dock.local?.queue, null);
    assert.equal(first.session, undefined, 'live is not a fabricated catalogue Session');
    assert.equal(d.engine.lastCommand.binding.sessionId, fence.sessionId);
    assert.equal('entryId' in fence, false); assert.equal('itemId' in fence, false);
    assert.deepEqual(first.seekWindow, {startSeconds: 20, endSeconds: 120});
    assert.equal(first.capabilities.previous, false); assert.equal(first.capabilities.next, false);
    const collapseRequests = d.requests.length;
    await d.runtime.onTransition(d.runtime.dock.collapse(fence)); await settle();
    assert.equal(d.runtime.getSnapshot().fence?.sessionId, fence.sessionId);
    assert.equal(d.runtime.getSnapshot().dock.local?.expanded, false);
    assert.equal(d.requests.slice(collapseRequests).some(request => request.method === 'DELETE'), false);
    assert.equal(d.server.session(fence.sessionId)?.ended, false);
    await d.runtime.toggle(fence); await settle(); assert.equal(d.engine.lastCommand.paused, true);
    await d.runtime.seek(fence, 47); await settle(); assert.equal(d.runtime.getSnapshot().playback.positionSeconds, 47);
    const before = d.requests.length; await d.runtime.seek(fence, 1); await settle(); assert.equal(d.requests.length, before);
    await port.playChannel(channel, context, new AbortController().signal); await settle();
    const second = d.runtime.getSnapshot().fence!;
    assert.notEqual(second.sessionId, fence.sessionId); assert.ok(second.playback.run > fence.playback.run);
    await d.runtime.stop(fence); await d.runtime.toggle(fence); await settle();
    assert.equal(d.runtime.getSnapshot().fence?.sessionId, second.sessionId);
    assert.equal(d.server.session(fence.sessionId)?.ended, true);
    assert.equal(d.requests.some(request => request.path.includes('/items/channel-1')), false);
  } finally { d.runtime.dispose(); }
});

test('restoring a live bookmark starts paused and seeks only within its actual new retained window', async () => {
  const d = fixture();
  try {
    await d.runtime.selectionPlayback(() => true).playChannel(homeChannel(), selectionContext(), new AbortController().signal); await settle();
    const initial = d.runtime.getSnapshot().fence;
    assert.ok(initial?.kind === 'channel');
    await d.runtime.toggle(initial); await d.runtime.seek(initial, 44); await settle();
    const live = d.runtime.getSnapshot().fence;
    assert.ok(live?.kind === 'channel');
    assert.equal(live.sessionId, initial.sessionId);
    assert.equal(live.playback.run, initial.playback.run);
    assert.ok(live.generation > initial.generation, 'the actual seek changed media generation');
    await d.start('song-1', 19);
    assert.deepEqual(d.runtime.getSnapshot().dock.resumeVideo?.fence, live);
    const requestCount = d.requests.length, commandCount = d.engine.commands.length;
    assert.equal(await d.runtime.restoreBookmark(initial, true), undefined, 'the retired generation cannot restore or resume');
    assert.equal(d.requests.length, requestCount);
    assert.equal(d.engine.commands.length, commandCount);
    const restored = await d.runtime.restoreBookmark(live, false); await settle();
    assert.ok(restored?.kind === 'channel'); assert.notEqual(restored.sessionId, live.sessionId);
    assert.ok(restored.playback.run > live.playback.run);
    assert.deepEqual(d.runtime.getSnapshot().fence, restored);
    assert.deepEqual(d.runtime.getSnapshot().dock.local?.fence, restored);
    assert.equal(restored.channelId, live.channelId); assert.equal(restored.sourceId, live.sourceId);
    assert.equal(restored.channelGeneration, live.channelGeneration);
    assert.equal(d.runtime.getSnapshot().playback.intent, 'paused'); assert.equal(d.runtime.getSnapshot().playback.positionSeconds, 44);
    const requests = d.requests.slice(requestCount);
    const start = requests.find(request => request.method === 'POST' && record(request.body) && request.body.channelId);
    assert.ok(start && record(start.body)); assert.equal(start.body.state, 'paused');
    const seek = requests.find(request => seekRequest(request, 44000));
    assert.ok(seek && record(seek.body) && record(seek.body.seek));
    assert.equal(d.runtime.getSnapshot().playback.linear?.acknowledgedSeekCommandId, seek.body.seek.id);
    assert.equal(requests.some(playingRequest), false);
    const commands = d.engine.commands.slice(commandCount).filter(command => command.binding.sessionId === restored.sessionId);
    assert.ok(commands.length > 0); assert.ok(commands.every(command => command.paused === true));
    assert.equal(d.server.session(restored.sessionId)?.state, 'paused');
    assert.equal(d.pendingTimers(15000).length, 0);
  } finally { d.runtime.dispose(); }
});

async function parkLive(d: ReturnType<typeof fixture>, seconds = 44) {
  await d.runtime.selectionPlayback(() => true).playChannel(homeChannel(), selectionContext(), new AbortController().signal); await settle();
  const initial = d.runtime.getSnapshot().fence;
  assert.ok(initial?.kind === 'channel');
  await d.runtime.toggle(initial); await d.runtime.seek(initial, seconds); await settle();
  const live = d.runtime.getSnapshot().fence;
  assert.ok(live?.kind === 'channel');
  assert.equal(d.runtime.getSnapshot().playback.positionSeconds, seconds);
  await d.start('song-1', 19);
  assert.deepEqual(d.runtime.getSnapshot().dock.resumeVideo?.fence, live);
  return live;
}

test('explicit live restore waits for its own acknowledged seek when the saved position equals the join target', async () => {
  const d = fixture();
  try {
    const live = await parkLive(d, 120), sent = d.requests.length, commanded = d.engine.commands.length;
    d.intercept(async request => { if (seekRequest(request, 120000)) d.engine.acknowledgeSeeks = false; });
    let completed = false;
    const restoring = d.runtime.restoreBookmark(live, true).then(result => { completed = true; return result; });
    await settle();
    const waiting = d.runtime.getSnapshot();
    assert.ok(waiting.playback.session && waiting.playback.pendingSeek);
    assert.equal(waiting.playback.pendingSeek.positionSeconds, 120);
    assert.equal(waiting.playback.session.resumeSeconds, 120);
    assert.equal(waiting.playback.linear?.desired.seek?.positionUs, '120000000');
    assert.notEqual(waiting.playback.linear?.acknowledgedSeekCommandId, waiting.playback.linear?.desired.seek?.seekCommandId);
    assert.equal(completed, false);
    assert.equal(waiting.playback.intent, 'paused');
    assert.equal(d.server.session(waiting.playback.session.id)?.state, 'paused');
    d.engine.emit('progress'); await settle();
    assert.equal(completed, false, 'uncorrelated progress cannot acknowledge the restore seek');
    assert.equal(d.requests.slice(sent).some(playingRequest), false);
    const commands = d.engine.commands.slice(commanded).filter(command => command.binding.sessionId === waiting.playback.session?.id);
    assert.ok(commands.length > 0); assert.ok(commands.every(command => command.paused === true));
    d.engine.emit('seekApplied', {seekRevision: waiting.playback.pendingSeek.revision});
    const restored = await restoring; await settle();
    assert.ok(restored?.kind === 'channel');
    assert.equal(restored.sessionId, waiting.playback.session.id);
    assert.deepEqual(d.runtime.getSnapshot().fence, restored);
    assert.equal(d.runtime.getSnapshot().playback.pendingSeek, undefined);
    assert.equal(d.runtime.getSnapshot().playback.positionSeconds, 120);
    assert.equal(d.runtime.getSnapshot().playback.intent, 'playing');
    assert.equal(d.server.session(restored.sessionId)?.state, 'playing');
    assert.equal(d.pendingTimers(15000).length, 0);
  } finally { d.runtime.dispose(); }
});

test('a competing play during a live restore seek keeps the replacement paused and retires only the restored channel', async () => {
  const d = fixture();
  try {
    const live = await parkLive(d);
    d.intercept(async request => { if (seekRequest(request, 44000)) d.engine.acknowledgeSeeks = false; });
    const restoring = d.runtime.restoreBookmark(live, true);
    await settle();
    const waiting = d.runtime.getSnapshot();
    assert.ok(waiting.playback.pendingSeek && waiting.playback.session);
    const obsolete = d.engine.lastCommand;
    d.engine.acknowledgeSeeks = true;
    await d.start('movie-2', 19);
    const winner = d.runtime.getSnapshot().fence;
    assert.ok(winner?.kind === 'queue');
    await d.runtime.toggle(winner); await settle();
    assert.equal(await restoring, undefined);
    d.engine.listener?.({type: 'seekApplied', instanceId: 'engine-instance', binding: obsolete.binding, intentId: obsolete.binding.intentId,
      factSequence: 99999, lastCommandRevision: obsolete.commandRevision, position: 44, paused: true, seekRevision: waiting.playback.pendingSeek.revision});
    await settle();
    assert.deepEqual(d.runtime.getSnapshot().fence, winner);
    assert.equal(d.runtime.getSnapshot().playback.intent, 'paused');
    assert.equal(d.engine.lastCommand.binding.sessionId, winner.sessionId);
    assert.equal(d.engine.lastCommand.paused, true);
    assert.equal(d.server.session(waiting.playback.session.id)?.ended, true);
    assert.equal(d.server.session(winner.sessionId)?.ended, false);
    assert.equal(d.pendingTimers(15000).length, 0);
  } finally { d.runtime.dispose(); }
});

test('a failed live bookmark seek rejects and closes its fresh paused session without autoplay', async () => {
  const d = fixture();
  try {
    const live = await parkLive(d), sent = d.requests.length;
    d.intercept(async request => { if (seekRequest(request, 44000)) d.engine.acknowledgeSeeks = false; });
    const rejected = assert.rejects(d.runtime.restoreBookmark(live, true), /channel_position_unavailable/);
    await settle();
    const waiting = d.runtime.getSnapshot();
    assert.ok(waiting.playback.pendingSeek && waiting.playback.session);
    d.engine.emit('seekFailed', {seekRevision: waiting.playback.pendingSeek.revision});
    await rejected; await settle();
    assert.equal(d.runtime.getSnapshot().playback.session, undefined);
    assert.equal(d.runtime.getSnapshot().playback.intent, 'paused');
    assert.equal(d.server.session(waiting.playback.session.id)?.ended, true);
    assert.equal(d.requests.slice(sent).some(playingRequest), false);
    assert.equal(d.pendingTimers(15000).length, 0);
  } finally { d.runtime.dispose(); }
});

test('an unacknowledged live restore times out and removes its wait before closing the paused session', async () => {
  const d = fixture();
  try {
    const live = await parkLive(d), sent = d.requests.length;
    d.intercept(async request => { if (seekRequest(request, 44000)) d.engine.acknowledgeSeeks = false; });
    const rejected = assert.rejects(d.runtime.restoreBookmark(live, true), /channel_position_unavailable/);
    await settle();
    const waiting = d.runtime.getSnapshot();
    assert.ok(waiting.playback.pendingSeek && waiting.playback.session);
    const deadlines = d.pendingTimers(15000);
    assert.equal(deadlines.length, 1);
    const deadline = deadlines[0]; assert.ok(deadline); deadline.run();
    await rejected; await settle();
    assert.equal(d.pendingTimers(15000).length, 0);
    assert.equal(d.runtime.getSnapshot().playback.session, undefined);
    assert.equal(d.server.session(waiting.playback.session.id)?.ended, true);
    assert.equal(d.requests.slice(sent).some(playingRequest), false);
    d.engine.acknowledgeSeeks = true;
    await d.start('movie-after-timeout', 17);
    const winner = d.runtime.getSnapshot().fence; assert.ok(winner);
    deadline.run(); await settle();
    assert.deepEqual(d.runtime.getSnapshot().fence, winner);
    assert.equal(d.runtime.getSnapshot().playback.intent, 'playing');
  } finally { d.runtime.dispose(); }
});

// This port exercises runtime source/ref fencing only. Actual PixelCopy/private PNG output
// belongs to the generic native bridge and still needs its own device verification slot.
test('snapshot capture receives the actual mounted tag/lease/binding and releases a stale result', async () => {
  const d = fixture(), owner = {}; let resolve!: (value: any) => void, source!: VideoSnapshotSource, released = 0, cancelled = 0, disposed = 0;
  try {
    d.runtime.attachSurface(owner); d.runtime.setSurfaceTag(owner, 71);
    d.runtime.installSnapshotCapture({capture: async value => { source = value; return new Promise(done => { resolve = done; }); }, cancel: () => { cancelled++; }, dispose: () => { disposed++; }});
    await d.start('movie-1'); const fence = d.runtime.getSnapshot().fence!;
    const capture = d.runtime.captureVideoSnapshot(fence), rejected = assert.rejects(capture, /snapshot_stale/);
    assert.equal(source.reactTag, 71); assert.equal(source.lease, d.engine.lastCommand.binding.lease);
    const binding = d.engine.lastCommand.binding;
    assert.deepEqual(source.binding, {intentId: binding.intentId, sessionId: binding.sessionId, generation: binding.generation, itemId: binding.itemId});
    assert.equal(d.runtime.isSnapshotSourceCurrent(source), true);
    await d.start('movie-2'); assert.equal(d.runtime.isSnapshotSourceCurrent(source), false);
    resolve({source, image: {uri: 'file:///private/frame.png', width: 160, height: 90}, release: async () => { released++; }});
    await rejected; assert.equal(released, 1); assert.ok(cancelled > 0);
    d.runtime.dispose(); assert.equal(disposed, 1);
  } finally { d.runtime.dispose(); }
});

test('a retained snapshot carries its exact fence and unmount invalidates its source before reuse', async () => {
  const d = fixture(), owner = {}; let source!: VideoSnapshotSource, released = 0;
  try {
    d.runtime.attachSurface(owner); d.runtime.setSurfaceTag(owner, 71);
    d.runtime.installSnapshotCapture({capture: async value => { source = value; return {source: value, image: {uri: 'file:///private/frame.png', width: 160, height: 90}, release: async () => { released++; }}; }, cancel: () => {}, dispose: () => {}});
    await d.start('movie-1'); const fence = d.runtime.getSnapshot().fence!;
    const frame = await d.runtime.captureVideoSnapshot(fence); assert.equal(frame.fence, fence);
    await assert.rejects(d.runtime.captureVideoSnapshot(fence), /snapshot_busy/);
    d.runtime.setSurfaceTag(owner, null); assert.equal(d.runtime.isSnapshotSourceCurrent(source), false);
    await frame.release(); await frame.release(); assert.equal(released, 1);
    await assert.rejects(d.runtime.captureVideoSnapshot(fence), /snapshot_unavailable/);
  } finally { d.runtime.dispose(); }
});

test('a cancelled Home start cannot adopt a late response and a denied channel never sends a start', async () => {
  const d = fixture(), controller = new AbortController(); let release!: () => void;
  try {
    const channel = homeChannel();
    await assert.rejects(d.runtime.selectionPlayback(() => true).playChannel({...channel, channel: {...channel.channel, tuneAvailable: false, tuneUnavailableReason: 'permission-denied'}}, selectionContext(), controller.signal), /invalid_channel_target/);
    assert.equal(d.requests.length, 0);
    const held = new Promise<void>(resolve => { release = resolve; }); let entered = false;
    d.intercept(async request => { if (!entered && request.method === 'POST' && request.path === routePath('create_queue')) { entered = true; await held; } });
    const playing = d.runtime.selectionPlayback(() => true).play({context: selectionContext(), signal: controller.signal, items: [selected('movie-cancelled')]});
    const rejected = assert.rejects(playing);
    await settle(); assert.equal(entered, true); controller.abort(); release(); await rejected; await settle();
    assert.equal(d.runtime.getSnapshot().playback.session, undefined);
    assert.ok(d.engine.commands.every(command => command.binding.itemId !== 'movie-cancelled'));
  } finally { release?.(); d.runtime.dispose(); }
});

test('an expired live bookmark stays paused and cannot seek outside the newly reported window', async () => {
  const d = fixture();
  try {
    await d.runtime.selectionPlayback(() => true).playChannel(homeChannel(), selectionContext(), new AbortController().signal); await settle();
    const live = d.runtime.getSnapshot().fence!;
    await d.runtime.toggle(live); await d.runtime.seek(live, 44); await settle();
    await d.start('song-1', 19);
    // The same real bookmark is retained, but its next server window has moved past it.
    d.channelWindow(80, 120);
    const offered = d.runtime.dock.getSnapshot().resumeVideo!.fence, sent = d.requests.length;
    await assert.rejects(d.runtime.restoreBookmark(offered, true), /channel_position_unavailable/); await settle();
    const starts = d.requests.slice(sent).filter(request => request.method === 'POST' && (request.body as any)?.channelId);
    assert.equal(starts.length, 1); assert.equal((starts[0]!.body as any).state, 'paused');
    assert.equal(d.requests.slice(sent).some(request => request.method === 'PATCH' && (request.body as any)?.seek?.positionMs === 44000), false);
    assert.equal(d.runtime.getSnapshot().playback.session, undefined);
  } finally { d.runtime.dispose(); }
});

test('an aggregate audio start uses its actual first queue kind and music speed policy', async () => {
  const d = fixture();
  try {
    d.settings({videoRate: 1.5, audiobookRate: 2});
    await d.runtime.selectionPlayback(() => true).play({context: selectionContext(), signal: new AbortController().signal, items: [selected('song-album', 'album', 'song-album-0')]}); await settle();
    assert.equal(d.runtime.getSnapshot().playback.itemId, 'song-album-0');
    assert.equal(d.runtime.getSnapshot().dock.local?.kind, 'music');
    assert.equal(d.runtime.getSnapshot().dock.local?.expanded, false);
    assert.equal(d.engine.lastCommand.rate, 1);
  } finally { d.runtime.dispose(); }
});

const detailPath = (id: string) => encodedRoutePath('get_items_id_detail', {id: encodeURIComponent(id)}) + '?related=all';
function episodeDetail(id: string, viewerFence = detailFence, showId = 'show-1') {
  return {scope: {serverId: 'server', libraryId: 'library', itemId: id, viewerFence}, revision: {catalog: 1, viewer: 1},
    item: {id, libraryId: 'library', kind: 'episode', title: id, durationMs: 180000, progressMs: 0, available: true,
      episode: {showId, showTitle: showId, seasonId: `${showId}-season-2`, seasonNumber: 2, numbering: 'seasonal', number: 3,
        localIdentityStatus: 'identified', providerMatchStatus: 'matched', orderingBasis: 'aired', sourceBoundary: 'library'}},
    personal: {revision: 1}, actions: [], metadata: {status: 'available'}, markers: []};
}
const detailResponse = (body: unknown): FakeResponse => ({status: 200, headers: {}, body});
function assertEpisodeDetail(d: ReturnType<typeof fixture>, showId?: string) {
  const snapshot = d.runtime.getSnapshot();
  assert.ok(snapshot.fence?.kind === 'queue');
  assert.equal(snapshot.fence.showId, showId);
  assert.equal(snapshot.fence.seasonId, showId ? `${showId}-season-2` : undefined);
  assert.equal(snapshot.dock.local?.fence.kind, 'queue');
  if (snapshot.dock.local?.fence.kind === 'queue') {
    assert.equal(snapshot.dock.local.fence.showId, showId);
    assert.equal(snapshot.dock.local.fence.seasonId, showId ? `${showId}-season-2` : undefined);
  }
  assert.ok(snapshot.subject?.kind === 'video');
  assert.deepEqual(snapshot.subject.item.show, showId ? {id: showId, title: showId} : undefined);
  assert.equal(snapshot.authority.viewerFence, homeFence, 'the genuine Home fence is never replaced by a Detail fence');
  assert.equal(snapshot.retired, false);
}

test('a genuine detail response with a different Home fence supplies episode metadata on the actual native session', async () => {
  const d = fixture();
  try {
    d.respond(request => request.path === detailPath('episode-1') ? detailResponse(episodeDetail('episode-1')) : undefined);
    await d.start('episode-1');
    assert.notEqual(homeFence, detailFence);
    assertEpisodeDetail(d, 'show-1');
    const snapshot = d.runtime.getSnapshot();
    assert.equal(snapshot.fence?.sessionId, snapshot.session?.id);
    assert.ok(snapshot.fence?.kind === 'queue');
    assert.equal(snapshot.fence.sourceId, snapshot.session?.versionId);
    assert.equal(snapshot.fence?.generation, snapshot.session?.presentation.generation);
    assert.equal(d.engine.lastCommand.binding.sessionId, snapshot.session?.id);
    assert.equal(snapshot.playback.phase, 'ready');
    const request = d.requests.find(value => value.path === detailPath('episode-1'));
    assert.equal(request?.method, 'GET');
    assert.equal(request?.signal?.aborted, false);
  } finally { d.runtime.dispose(); }
});

test('a genuine different-fence song detail also supplies the native dock artist and album', async () => {
  const d = fixture();
  const episode = episodeDetail('song-1');
  const body = {...episode, item: {id: 'song-1', libraryId: 'library', kind: 'song', title: 'song-1', durationMs: 180000, available: true,
    song: {albumId: 'album-1', albumTitle: 'album-1', albumArtist: 'artist-1', artist: 'artist-1', providerMatchStatus: 'matched'}}};
  try {
    d.respond(request => request.path === detailPath('song-1') ? detailResponse(body) : undefined);
    await d.start('song-1');
    const snapshot = d.runtime.getSnapshot();
    assert.ok(snapshot.subject?.kind === 'music');
    assert.equal(snapshot.subject.item.artist, 'artist-1');
    assert.equal(snapshot.subject.item.album, 'album-1');
    assert.equal(snapshot.authority.viewerFence, homeFence);
    assert.equal(snapshot.fence?.sessionId, snapshot.session?.id);
    assert.equal(snapshot.dock.local?.kind, 'music');
  } finally { d.runtime.dispose(); }
});

test('wrong server, library, item and malformed detail responses cannot supply native episode metadata', async () => {
  const body = episodeDetail('episode-1');
  const rejected = [
    {...body, scope: {...body.scope, serverId: 'other-server'}},
    {...body, scope: {...body.scope, libraryId: 'other-library'}},
    {...body, scope: {...body.scope, itemId: 'episode-other'}},
    {...body, item: {...body.item, id: 'episode-other'}},
    {...body, item: {...body.item, libraryId: 'other-library'}},
    {...body, scope: {...body.scope, viewerFence: ''}},
  ];
  for (const raw of rejected) {
    const d = fixture();
    try {
      d.respond(request => request.path === detailPath('episode-1') ? detailResponse(raw) : undefined);
      await d.start('episode-1');
      assert.equal(d.requests.filter(request => request.path === detailPath('episode-1')).length, 1);
      assertEpisodeDetail(d);
      assert.equal(d.runtime.getSnapshot().playback.phase, 'ready', 'the real session is independent of rejected detail metadata');
    } finally { d.runtime.dispose(); }
  }
});

test('a detail response that arrives after another item starts cannot overwrite its native metadata', async () => {
  const d = fixture(); let finish!: (response: FakeResponse) => void, oldRequest: FakeRequest | undefined;
  try {
    d.respond(request => {
      if (request.path === detailPath('episode-old')) { oldRequest = request; return new Promise(resolve => { finish = resolve; }); }
      if (request.path === detailPath('episode-current')) return detailResponse(episodeDetail('episode-current', detailFence, 'show-current'));
    });
    await d.start('episode-old'); assert.ok(oldRequest);
    await d.start('episode-current'); assertEpisodeDetail(d, 'show-current');
    const winner = d.runtime.getSnapshot().fence;
    assert.equal(oldRequest.signal?.aborted, true);
    finish(detailResponse(episodeDetail('episode-old', detailFence, 'show-obsolete'))); await settle();
    assertEpisodeDetail(d, 'show-current');
    assert.deepEqual(d.runtime.getSnapshot().fence, winner);
    assert.equal(d.runtime.getSnapshot().entry?.id, 'episode-current');
  } finally { finish?.(detailResponse(episodeDetail('episode-old'))); d.runtime.dispose(); }
});

test('a late detail response for the same item cannot cross an actual presentation generation', async () => {
  const d = fixture(); let finish!: (response: FakeResponse) => void, oldRequest: FakeRequest | undefined, reads = 0;
  try {
    d.respond(request => {
      if (request.path !== detailPath('episode-1')) return;
      if (++reads === 1) { oldRequest = request; return new Promise(resolve => { finish = resolve; }); }
      return detailResponse(episodeDetail('episode-1', 'c'.repeat(64), 'show-current'));
    });
    await d.start('episode-1'); const before = d.runtime.getSnapshot(); assert.ok(before.fence && oldRequest);
    const quality = before.options!.qualities.find(option => option.mode === 'fixed' && option.id === '720p-high')!;
    await d.runtime.chooseQuality(before.fence, quality); await settle();
    assert.ok(d.runtime.getSnapshot().fence!.generation > before.fence.generation);
    assert.equal(d.runtime.getSnapshot().fence!.sessionId, before.fence.sessionId);
    assert.equal(oldRequest.signal?.aborted, true);
    assertEpisodeDetail(d, 'show-current');
    finish(detailResponse(episodeDetail('episode-1', detailFence, 'show-obsolete'))); await settle();
    assertEpisodeDetail(d, 'show-current');
    await d.runtime.toggle(before.fence); await settle();
    assert.equal(d.runtime.getSnapshot().playback.intent, 'playing', 'the retired source fence still cannot control the new generation');
  } finally { finish?.(detailResponse(episodeDetail('episode-1'))); d.runtime.dispose(); }
});

test('same-item source replacement clears old detail metadata while its new genuine response is pending', async () => {
  const d = fixture(); let finish!: (response: FakeResponse) => void, pending: FakeRequest | undefined;
  try {
    d.respond(request => request.path === detailPath('episode-1') ? detailResponse(episodeDetail('episode-1')) : undefined);
    await d.start('episode-1'); assertEpisodeDetail(d, 'show-1');
    const before = d.runtime.getSnapshot(); assert.ok(before.fence);
    d.respond(request => { if (request.path === detailPath('episode-1')) { pending = request; return new Promise(resolve => { finish = resolve; }); } });
    const quality = before.options!.qualities.find(option => option.mode === 'fixed' && option.id === '720p-high')!;
    await d.runtime.chooseQuality(before.fence, quality); await settle(); assert.ok(pending);
    assertEpisodeDetail(d);
    finish(detailResponse(episodeDetail('episode-1', 'c'.repeat(64), 'show-new-source'))); await settle();
    assertEpisodeDetail(d, 'show-new-source');
  } finally { finish?.(detailResponse(episodeDetail('episode-1'))); d.runtime.dispose(); }
});

test('late genuine detail responses cannot cross any current native authority input before owner notification', async () => {
  for (const patch of [{serverId: 'other-server'}, {accountId: 'other-account'}, {profileId: 'other-profile'}, {epoch: 'other-epoch'}, {viewerFence: 'd'.repeat(64)}]) {
    const d = fixture(); let finish!: (response: FakeResponse) => void, pending: FakeRequest | undefined;
    try {
      d.respond(request => { if (request.path === detailPath('episode-1')) { pending = request; return new Promise(resolve => { finish = resolve; }); } });
      await d.start('episode-1'); assert.ok(pending);
      const scoped = d.scopedRequests.find(request => request.path === detailPath('episode-1'));
      assert.ok(scoped?.signal);
      assert.notEqual(scoped.signal, pending.signal, 'the real API owns a separate deadline signal');
      d.authority(patch, false);
      finish(detailResponse(episodeDetail('episode-1'))); await settle();
      const snapshot = d.runtime.getSnapshot();
      assert.equal(snapshot.retired, true);
      assert.equal(snapshot.fence, undefined);
      assert.equal(snapshot.subject, undefined);
      assert.equal(snapshot.dock.local, null);
      assert.equal(scoped.signal.aborted, true, 'the playback scope retires its actual request signal');
      // withinDeadline has completed and detached its child by this point. It is not
      // an in-flight request that scope disposal can still abort.
      assert.equal(pending.signal?.aborted, false);
      assert.equal(d.engine.subscriptions, 0);
      assert.equal(d.subscriptions, 0);
    } finally { finish?.(detailResponse(episodeDetail('episode-1'))); d.runtime.dispose(); }
  }
});

test('a changed genuine Detail fence clears native metadata and cannot rebind within the same source lifetime', async () => {
  const d = fixture(); let body = episodeDetail('episode-1');
  try {
    d.respond(request => request.path === detailPath('episode-1') ? detailResponse(body) : undefined);
    await d.start('episode-1'); assertEpisodeDetail(d, 'show-1'); const session = d.runtime.getSnapshot().session;
    body = episodeDetail('episode-1', 'c'.repeat(64), 'show-other-fence');
    await d.runtime.refreshAuthority(); await settle(); assertEpisodeDetail(d);
    assert.equal(d.runtime.getSnapshot().session?.id, session?.id);
    assert.equal(d.runtime.getSnapshot().session?.presentation.generation, session?.presentation.generation);
    // DetailService can decode a retry after clearing its data. The runtime's original
    // response-fence binding must still reject that different fence on this source.
    await d.runtime.refreshAuthority(); await settle(); assertEpisodeDetail(d);
    assert.ok(d.requests.filter(request => request.path === detailPath('episode-1')).length >= 3);
  } finally { d.runtime.dispose(); }
});

test('detail denial or invalid scope removes previously accepted native show and season metadata', async () => {
  for (const response of [
    {status: 401, headers: {}, body: {error: {code: 'unauthorized', message: 'unauthorized'}}},
    {status: 403, headers: {}, body: {error: {code: 'forbidden', message: 'forbidden'}}},
    {status: 404, headers: {}, body: {error: {code: 'not_found', message: 'not_found'}}},
    detailResponse({...episodeDetail('episode-1'), scope: {...episodeDetail('episode-1').scope, libraryId: 'other-library'}}),
  ]) {
    const d = fixture(); let denied = false;
    try {
      d.respond(request => request.path === detailPath('episode-1') ? denied ? response : detailResponse(episodeDetail('episode-1')) : undefined);
      await d.start('episode-1'); assertEpisodeDetail(d, 'show-1');
      denied = true; await d.runtime.refreshAuthority(); await settle();
      assertEpisodeDetail(d);
    } finally { d.runtime.dispose(); }
  }
});

test('same-detail-fence refreshes update native metadata while a transient read failure retains its validated data', async () => {
  const d = fixture(); let response = detailResponse(episodeDetail('episode-1'));
  try {
    d.respond(request => request.path === detailPath('episode-1') ? response : undefined);
    await d.start('episode-1'); assertEpisodeDetail(d, 'show-1');
    response = {status: 503, headers: {}, body: {error: {code: 'busy', message: 'busy'}}};
    await d.runtime.refreshAuthority(); await settle(); assertEpisodeDetail(d, 'show-1');
    response = detailResponse(episodeDetail('episode-1', detailFence, 'show-current'));
    await d.runtime.refreshAuthority(); await settle(); assertEpisodeDetail(d, 'show-current');
  } finally { d.runtime.dispose(); }
});


test('production Fabric playback progress settles without a parent render and keeps the actual Surface', async () => {
  const d = fixture();
  let ui: Awaited<ReturnType<typeof fabricPlayback>> | undefined;
  try {
    await d.start('movie-1', 0);
    ui = await fabricPlayback(d.runtime);
    const ref = ui.nativeProps.at(-1)!.ref, lease = d.runtime.getSnapshot().lease;
    const captureClears = ui.captureClears;
    for (let n = 1; n <= 100; n++) {
      d.engine.position = n / 2;
      d.engine.emit('progress', {decodedWidth: 320, decodedHeight: 180});
      await ui.settle();
      assert.equal(d.runtime.getSnapshot().playback.positionSeconds, n / 2);
    }
    assert.equal(ui.parentRenders, 1, 'no unrelated parent render may rescue the subscription chain');
    assert.equal(ui.captureClears, captureClears, 'progress must not feed back through source-lifecycle capture cleanup');
    assert.strictEqual(ui.nativeProps.at(-1)!.ref, ref);
    assert.equal(d.runtime.getSnapshot().lease, lease);
    assert.equal(d.engine.released.length, 0);
    assert.equal(d.engine.subscriptions, 1);
  } finally {await ui?.unmount(); d.runtime.dispose();}
});

test('production Fabric window settlement preserves the actual Surface owner/ref/tag, runtime lease and playing session', async () => {
  const d = fixture();
  const owners: object[] = [], tags: {owner: object; tag: number | null}[] = [];
  const attachSurface = d.runtime.attachSurface.bind(d.runtime), setSurfaceTag = d.runtime.setSurfaceTag.bind(d.runtime);
  d.runtime.attachSurface = owner => {owners.push(owner); return attachSurface(owner);};
  d.runtime.setSurfaceTag = (owner, tag) => {tags.push({owner, tag}); setSurfaceTag(owner, tag);};
  let ui: Awaited<ReturnType<typeof fabricPlayback>> | undefined;
  try {
    await d.start('movie-1', 0);
    ui = await fabricPlayback(d.runtime);
    const initial = d.runtime.getSnapshot(), ref = ui.nativeProps.at(-1)!.ref;
    const commands = d.engine.commands.length, requests = d.requests.length;
    assert.equal(initial.playback.phase, 'ready');
    assert.equal(d.engine.lastCommand.paused, false);
    assert.equal(owners.length, 1);
    assert.deepEqual(tags.map(value => value.tag), [71]);
    for (const [width, height] of [[890, 626], [840, 880], [626, 890], [890, 626], [466, 678]]) {
      await ui.resize(width, height);
      const props: {ref: unknown; lease: string; surfaceActive: boolean; style: {width: number; height: number}} = ui.nativeProps.at(-1)!;
      assert.equal(props.style.width, width);
      assert.equal(props.style.height, height);
      assert.strictEqual(props.ref, ref);
      assert.equal(props.lease, initial.lease);
      assert.equal(props.surfaceActive, true, 'bounds alone keep the live producer active');
      assert.strictEqual(d.runtime.getSnapshot().fence, initial.fence);
      assert.equal(d.runtime.getSnapshot().playback.phase, initial.playback.phase);
      assert.equal(d.runtime.getSnapshot().retired, false);
      assert.equal(d.engine.commands.length, commands, 'geometry sends no pause/stop/source/seek command');
      assert.equal(d.engine.lastCommand.paused, false);
      assert.equal(d.requests.length, requests, 'geometry creates no playback session or server mutation');
      assert.equal(owners.length, 1);
      assert.equal(tags.length, 1);
      assert.strictEqual(tags[0]!.owner, owners[0]);
      assert.equal(d.engine.released.length, 0);
      assert.equal(d.engine.subscriptions, 1);
    }
    assert.equal(ui.parentRenders, 1, 'the persistent layer handles dimensions without replacing the shell');
    await ui.unmount(); ui = undefined;
    assert.deepEqual(tags.map(value => value.tag), [71, null]);
    assert.equal(d.runtime.getSnapshot().retired, true, 'actual unmount still executes the authority cleanup microtask');
    assert.equal(d.engine.released.length, 1);
    assert.equal(d.engine.subscriptions, 0);
  } finally {await ui?.unmount(); d.runtime.dispose();}
});


test('production Fabric canonical watch outlet and actual shell wrapper keep one Surface owner and engine lease', async () => {
  const d = fixture(), owners: object[] = [], tags: (number | null)[] = [];
  let window = {width: 1920, height: 1080}, lease: NativeWatchLease, subscriptions = 0;
  let ui: Awaited<ReturnType<typeof fabricPlayback>> | undefined;
  const watch = new NativeWatchOutlet(() => ({authority: d.runtime.getSnapshot().authority, fence: d.runtime.getSnapshot().fence, window}));
  const subscribe = watch.subscribe;
  watch.subscribe = listener => {subscriptions++; const off = subscribe(listener); return () => {subscriptions--; off();};};
  const attachSurface = d.runtime.attachSurface.bind(d.runtime), setSurfaceTag = d.runtime.setSurfaceTag.bind(d.runtime);
  d.runtime.attachSurface = owner => {owners.push(owner); return attachSurface(owner);};
  d.runtime.setSurfaceTag = (owner, tag) => {tags.push(tag); setSurfaceTag(owner, tag);};
  const publish = async (next?: NativeExpandedVideoSlot) => {if (next) assert.equal(lease.publish(next), true); else lease.clear(); await ui!.settle();};
  try {
    await d.start('movie-1', 0);
    const initial = d.runtime.getSnapshot(), commands = d.engine.commands.length, requests = d.requests.length;
    lease = watch.register(initial.authority);
    ui = await fabricPlayback(d.runtime, true, watch, true);
    const ref = ui.nativeProps.at(-1)!.ref;
    assert.equal(ui.nativeProps.at(-1)!.style.display, 'none', 'a real outlet without a picture cannot create a full-window host');
    assert.equal(ui.watchWrapper.pointerEvents, 'box-none');
    assert.equal(ui.watchWrapper.style.zIndex, 31);
    assert.ok(ui.watchWrapper.style.zIndex < 40);
    assert.equal(ui.chrome.mounts, 1);
    window = {width: 840, height: 880}; watch.invalidate();
    await ui.resize(840, 880);
    for (const [revision, width, height] of [[1, 840, 472.5], [2, 445, 626], [3, 840, 880]]) {
      await publish({authority: initial.authority, fence: initial.fence!, layoutRevision: revision, window: {width: 840, height: 880}, frameInWindow: {x: 0, y: 0, width, height}});
      const props: {style: {width: number; height: number; display: string}; ref: unknown; lease: string} = ui.nativeProps.at(-1)!;
      assert.equal(props.style.width, width);
      assert.equal(props.style.height, height);
      assert.equal(props.style.display, 'flex');
      assert.strictEqual(props.ref, ref);
      assert.equal(props.lease, initial.lease);
      await publish();
      assert.equal(ui.nativeProps.at(-1)!.style.display, 'none');
      assert.strictEqual(ui.nativeProps.at(-1)!.ref, ref);
      assert.strictEqual(d.runtime.getSnapshot().fence, initial.fence);
      assert.equal(d.runtime.getSnapshot().retired, false);
      assert.equal(owners.length, 1);
      assert.deepEqual(tags, [71]);
      assert.equal(d.engine.released.length, 0);
      assert.equal(d.engine.commands.length, commands);
      assert.equal(d.requests.length, requests);
    }
    await publish({authority: initial.authority, fence: initial.fence!, layoutRevision: 4, window, frameInWindow: {x: 0, y: 0, width: 840, height: 472.5}});
    window = {width: 890, height: 626}; watch.invalidate();
    await ui.resize(890, 626);
    assert.equal(ui.nativeProps.at(-1)!.style.display, 'none', 'a window revision invalidates the real outlet without detaching Surface');
    const oldLease = lease;
    lease = watch.register(initial.authority);
    assert.equal(oldLease.publish({authority: initial.authority, fence: initial.fence!, layoutRevision: 100, window, frameInWindow: {x: 0, y: 0, width: 890, height: 626}}), false);
    await publish({authority: initial.authority, fence: initial.fence!, layoutRevision: 0, window, frameInWindow: {x: 0, y: 0, width: 890, height: 626}});
    assert.equal(ui.nativeProps.at(-1)!.style.width, 890);
    assert.equal(ui.nativeProps.at(-1)!.style.height, 626);
    assert.strictEqual(ui.nativeProps.at(-1)!.ref, ref);
    assert.equal(ui.chrome.mounts, 1);
    assert.equal(ui.chrome.unmounts, 0);
    await ui.adapter.onTransition(ui.adapter.dock.collapse(initial.fence!)); await ui.settle();
    assert.equal(ui.adapter.getSnapshot().dock.local?.expanded, false);
    await publish();
    assert.equal(ui.adapter.getSnapshot().dock.local?.expanded, false, 'watch invalidation cannot expand a docked video');
    assert.equal(owners.length, 1); assert.deepEqual(tags, [71]);
    assert.equal(d.engine.commands.length, commands);
    assert.equal(d.engine.released.length, 0);
    assert.equal(ui.parentRenders, 1);
    await ui.unmount(); ui = undefined;
    assert.deepEqual(tags, [71, null]);
    assert.equal(d.runtime.getSnapshot().retired, true);
    assert.equal(d.engine.released.length, 1);
    assert.equal(subscriptions, 0);
  } finally {await ui?.unmount(); watch.dispose(); d.runtime.dispose();}
});

test('one accepted fact publishes its settled progress once and retains the current source identity', async () => {
  const d = fixture();
  try {
    await d.start('movie-1', 0);
    const initial = d.runtime.getSnapshot(), facts: ReturnType<NativePlaybackRuntime['getSnapshot']>[] = [];
    const off = d.runtime.subscribe(() => facts.push(d.runtime.getSnapshot()));
    try {
      d.engine.emit('stalled');
      assert.equal(d.runtime.getSnapshot().playback.recovering, true);
      facts.length = 0;
      const revision = d.runtime.playback.getSnapshot().revision;
      d.engine.position = 1;
      d.engine.emit('progress', {decodedWidth: 320, decodedHeight: 180});
      assert.equal(facts.length, 1, 'recovery clearance and observed progress are one native publication');
      assert.equal(facts[0]!.playback.positionSeconds, 1);
      assert.equal(facts[0]!.playback.recovering, undefined);
      assert.ok(facts[0]!.playback.revision > revision, 'core still accepts the actual fact');
      assert.strictEqual(facts[0]!.fence, initial.fence, 'progress is not a new source lifecycle');
      facts.length = 0;
      const repeatedRevision = d.runtime.playback.getSnapshot().revision;
      d.engine.emit('progress', {decodedWidth: 320, decodedHeight: 180});
      assert.equal(facts.length, 1, 'a genuine repeated observation must still be accepted and published');
      assert.ok(facts[0]!.playback.revision > repeatedRevision);
      assert.equal(facts[0]!.playback.positionSeconds, 1);
      d.engine.position = 2;
      d.engine.emit('progress');
      assert.equal(facts.at(-1)!.playback.positionSeconds, 2, 'publication continues after a repeated fact');
    } finally {off();}
  } finally {d.runtime.dispose();}
});

test('Fabric playback facts, source replacements, controls and unmount retain native ordering', async () => {
  const d = fixture();
  let ui: Awaited<ReturnType<typeof fabricPlayback>> | undefined;
  try {
    await d.start('movie-1', 0);
    ui = await fabricPlayback(d.runtime);
    const first = d.runtime.getSnapshot(), ref = ui.nativeProps.at(-1)!.ref;
    const listener = d.engine.listener!, oldCommand = d.engine.lastCommand;
    let publications = 0;
    const off = d.runtime.subscribe(() => publications++);
    try {
      d.engine.emit('firstFrame', {decodedWidth: 320, decodedHeight: 180});
      await ui.settle();
      assert.equal(publications, 1);
      assert.strictEqual(d.runtime.getSnapshot().fence, first.fence);
      const beforeDuplicate = d.runtime.getSnapshot();
      listener({type: 'progress', instanceId: 'engine-instance', binding: oldCommand.binding,
        factSequence: 1, lastCommandRevision: oldCommand.commandRevision, position: 99, paused: false});
      assert.strictEqual(d.runtime.getSnapshot(), beforeDuplicate, 'duplicate/out-of-order packets never publish');
      for (const [field, value] of [['intentId', -1], ['sessionId', 'stale-session'], ['generation', 999], ['itemId', 'stale-item']] as const) {
        listener({type: 'progress', instanceId: 'engine-instance', binding: {...oldCommand.binding, [field]: value},
          factSequence: 99999, lastCommandRevision: oldCommand.commandRevision, position: 99, paused: false});
        assert.strictEqual(d.runtime.getSnapshot(), beforeDuplicate, field);
      }
      // These are the same public callbacks the rendered dock binds.
      await ui.adapter.toggle(first.fence!); await ui.settle();
      assert.equal(d.engine.lastCommand.paused, true);
      await ui.adapter.toggle(first.fence!); await ui.settle();
      assert.equal(d.engine.lastCommand.paused, false);
      await ui.adapter.seek(first.fence!, 14); await ui.settle();
      assert.equal(d.runtime.getSnapshot().playback.positionSeconds, 14);
      await ui.adapter.onTransition(ui.adapter.dock.collapse(first.fence!)); await ui.settle();
      ui.adapter.open(first.fence!); ui.adapter.open(first.fence!); await ui.settle();
      assert.equal(d.runtime.getSnapshot().dock.local?.expanded, true);
      await d.runtime.chooseQuality(first.fence!, first.options!.qualities.find(option => option.mode === 'fixed' && option.id === '720p-high')!);
      await ui.settle();
      const replacement = d.runtime.getSnapshot();
      assert.equal(replacement.fence?.sessionId, first.fence?.sessionId);
      assert.notEqual(replacement.fence?.generation, first.fence?.generation);
      assert.notStrictEqual(replacement.fence, first.fence);
      listener({type: 'progress', instanceId: 'engine-instance', binding: oldCommand.binding,
        factSequence: 99999, lastCommandRevision: oldCommand.commandRevision, position: 99, paused: false});
      assert.strictEqual(d.runtime.getSnapshot(), replacement, 'old generation cannot cross source replacement');
      d.engine.position = 15; d.engine.emit('progress'); await ui.settle();
      assert.equal(d.runtime.getSnapshot().playback.positionSeconds, 15);
      await d.start('movie-2', 0); await ui.settle();
      const next = d.runtime.getSnapshot(), commandCount = d.engine.commands.length;
      listener({type: 'progress', instanceId: 'engine-instance', binding: oldCommand.binding,
        factSequence: 99999, lastCommandRevision: oldCommand.commandRevision, position: 99, paused: false});
      await ui.adapter.toggle(first.fence!); await ui.adapter.seek(first.fence!, 77); ui.adapter.open(first.fence!);
      await ui.settle();
      assert.equal(d.runtime.getSnapshot().playback.itemId, 'movie-2');
      assert.equal(d.engine.commands.length, commandCount, 'old rendered callbacks cannot command the replacement');
      assert.equal(d.runtime.getSnapshot().fence?.sessionId, next.fence?.sessionId);
      d.engine.position = 2; d.engine.emit('progress'); await ui.settle();
      assert.equal(d.runtime.getSnapshot().playback.positionSeconds, 2);
      assert.strictEqual(ui.nativeProps.at(-1)!.ref, ref);
      assert.equal(ui.parentRenders, 1);
      assert.equal(d.engine.released.length, 0);
      assert.equal(d.engine.subscriptions, 1);
    } finally {off();}
    await ui.unmount(); ui = undefined;
    const retired = d.runtime.getSnapshot(), requests = d.requests.length;
    assert.equal(retired.retired, true);
    assert.equal(d.engine.subscriptions, 0);
    assert.equal(d.subscriptions, 0);
    assert.equal(d.engine.released.length, 1);
    listener({type: 'progress', instanceId: 'engine-instance', binding: oldCommand.binding,
      factSequence: 999999, lastCommandRevision: oldCommand.commandRevision, position: 99, paused: false});
    await d.runtime.toggle(first.fence!); await settle();
    assert.strictEqual(d.runtime.getSnapshot(), retired);
    assert.equal(d.requests.length, requests, 'late facts/control callbacks do not reopen disposed work');
  } finally {await ui?.unmount(); d.runtime.dispose();}
});

test('authority retirement during native fact delivery cannot expose old progress to Fabric', async () => {
  const d = fixture();
  let ui: Awaited<ReturnType<typeof fabricPlayback>> | undefined;
  try {
    await d.start('movie-1', 0);
    ui = await fabricPlayback(d.runtime);
    const position = d.runtime.getSnapshot().playback.positionSeconds;
    d.authority({epoch: 'retired'}, false);
    d.engine.position = 99; d.engine.emit('progress'); await ui.settle();
    assert.equal(d.runtime.getSnapshot().retired, true);
    assert.notEqual(d.runtime.getSnapshot().playback.positionSeconds, 99);
    assert.equal(position, 0);
    assert.equal(d.runtime.getSnapshot().fence, undefined);
    assert.equal(d.engine.subscriptions, 0);
    assert.equal(d.subscriptions, 0);
    assert.equal(ui.parentRenders, 1);
  } finally {await ui?.unmount(); d.runtime.dispose();}
});


test('version start without a fresh resume starts at zero rather than caller position', async () => {
  const d=fixture(true);
  try {
    await d.start('movie-1',25);const state=d.runtime.getSnapshot();d.resume(null);
    await d.runtime.startVersion({entry:state.entry!,target:{itemId:'movie-1',startSeconds:99}},
      {lifetime:versionLifetime(),authority:state.authority,options:state.options!,versionId:'v2',expectedFence:state.fence});
    await settle();assert.equal(d.runtime.getSnapshot().session?.versionId,'v2');
    assert.equal(d.runtime.getSnapshot().playback.positionSeconds,0);
  } finally {d.runtime.dispose();}
});

test('a closed or removed chooser cannot start after its final Options read resolves', async () => {
  for(const closing of ['abort','owner'] as const) {
    const d=fixture(true),controller=new AbortController();let release=()=>{},owned=true;
    try {
      await d.start('movie-1');const state=d.runtime.getSnapshot();
      const held=new Promise<void>(resolve=>{release=resolve;});let entered=false;
      d.intercept(async request=>{if(request.path.includes('/movie-1/playback-options')&&!entered){entered=true;await held;}});
      const late=d.runtime.startVersion({entry:state.entry!,target:{itemId:'movie-1'}},
        {lifetime:{signal:controller.signal,isCurrent:()=>owned},authority:state.authority,options:state.options!,versionId:'v2',expectedFence:state.fence});
      await settle();assert.equal(entered,true);
      if(closing==='abort')controller.abort();else owned=false;
      release();await late;await settle();
      assert.equal(d.runtime.getSnapshot().session?.id,state.session?.id,closing);
      assert.equal(d.requests.some(request=>request.method==='POST'&&record(request.body)&&request.body.versionId==='v2'),false,closing);
    } finally {release();d.runtime.dispose();}
  }
});

test('a closed chooser cannot adopt a version session returned after its own start was sent', async () => {
  for(const closing of ['abort','owner'] as const) {
    const d=fixture(true),controller=new AbortController();let release=()=>{},owned=true,created='';
    try {
      await d.start('movie-1');const state=d.runtime.getSnapshot();
      const held=new Promise<void>(resolve=>{release=resolve;});let entered=false;
      d.respond(async request=>{
        if(request.method!=='POST'||!record(request.body)||request.body.versionId!=='v2'||entered)return;
        entered=true;await held;
        const response=await d.server.handle(request);
        assert.equal(response.status,201);assert.ok(record(response.body)&&typeof response.body.id==='string');
        created=response.body.id;return response;
      });
      const late=d.runtime.startVersion({entry:state.entry!,target:{itemId:'movie-1'}},
        {lifetime:{signal:controller.signal,isCurrent:()=>owned},authority:state.authority,options:state.options!,versionId:'v2',expectedFence:state.fence});
      await settle();assert.equal(entered,true);
      if(closing==='abort')controller.abort();else owned=false;
      release();await late;await settle();
      assert.notEqual(d.runtime.getSnapshot().session?.versionId,'v2',closing);
      assert.ok(created,'the actual fake server created a session after cancellation');
      assert.ok(d.requests.some(request=>request.method==='DELETE'&&request.path===encodedRoutePath('stop_playback_session',{id:encodeURIComponent(created)})),closing+': retire the real late session');
      assert.equal(d.server.session(created)?.ended,true,closing);
    } finally {release();d.runtime.dispose();}
  }
});

test('late version cleanup survives ordinary disposal but never uses a replacement principal or family', async () => {
  for (const closing of ['dispose', 'authority', 'family'] as const) {
    const d = fixture(true); let release = () => {}, entered = false, created = '';
    try {
      await d.start('movie-1'); const state = d.runtime.getSnapshot();
      const held = new Promise<void>(resolve => {release = resolve;});
      d.respond(async request => {
        if (request.method !== 'POST' || !record(request.body) || request.body.versionId !== 'v2' || entered) return;
        entered = true; await held;
        const response = await d.server.handle(request);
        assert.equal(response.status, 201); assert.ok(record(response.body) && typeof response.body.id === 'string');
        created = response.body.id; return response;
      });
      const late = d.runtime.startVersion({entry:state.entry!,target:{itemId:'movie-1'}},
        {lifetime:versionLifetime(),authority:state.authority,options:state.options!,versionId:'v2',expectedFence:state.fence});
      await settle(); assert.equal(entered, true);
      if (closing === 'dispose') d.runtime.dispose();
      else if (closing === 'authority') d.authority({epoch:'replacement'}, false);
      else d.family('replacement-family');
      release(); await late; await settle(); assert.ok(created);
      const stopped = d.requests.some(request => request.method === 'DELETE' && request.path === encodedRoutePath('stop_playback_session',{id:encodeURIComponent(created)}));
      assert.equal(stopped, closing === 'dispose', closing);
      assert.equal(d.runtime.getSnapshot().session?.versionId === 'v2', false);
      assert.equal(d.runtime.getSnapshot().retired, true);
    } finally {release();d.runtime.dispose();}
  }
});

test('whole-group Play and Shuffle send the actual selector, never a loaded preview list', async () => {
  const query = {libraryId: '*', pivot: 'titles', query: {field: 'homeRow', operator: 'equals' as const, value: 'actual-row'}, sort: [{field: 'groupOrder', direction: 'asc' as const}]};
  for (const shuffle of [false, true]) {
    const d = fixture();
    try {
      // This canonical fake has no query resolver. Keep its actual 422 rather
      // than fabricate a positive server grouping or an adopted session.
      await assert.rejects(d.runtime.startGroup({query, shuffle, signal: new AbortController().signal, isCurrent: () => true}));
      const creates = d.requests.filter(request => request.method === 'POST' && request.path === routePath('create_queue'));
      assert.equal(creates.length, 1);
      assert.deepEqual((creates[0]!.body as any).segments, [{source: {query}, ...(shuffle ? {order: {mode: 'shuffle'}} : {})}]);
      assert.equal(d.runtime.getSnapshot().fence, undefined);
    } finally {d.runtime.dispose();}
  }
});

test('whole-group caller retirement during capabilities prevents a late queue creation', async () => {
  const query = {libraryId: '*', pivot: 'titles', query: {field: 'homeRow', operator: 'equals' as const, value: 'actual-row'}, sort: [{field: 'groupOrder', direction: 'asc' as const}]};
  for (const retirement of ['signal', 'member'] as const) {
    const d = fixture(), controller = new AbortController(); let current = true;
    try {
      d.intercept(async request => {if (request.path === routePath('get_capabilities')) {if (retirement === 'signal') controller.abort(); else current = false;}});
      await assert.rejects(d.runtime.startGroup({query, shuffle: false, signal: controller.signal, isCurrent: () => current}));
      assert.equal(d.requests.some(request => request.path === routePath('create_queue')), false);
      assert.equal(d.runtime.getSnapshot().fence, undefined);
    } finally {d.runtime.dispose();}
  }
});

test('regular start caller lifetime rejects a retired row during its real options read', async () => {
  for (const closing of ['abort', 'member'] as const) {
    const d = fixture(), controller = new AbortController(); let owned = true, release = () => {}, entered = false;
    try {
      const held = new Promise<void>(resolve => {release = resolve;});
      d.respond(async request => {if (request.path.includes('/movie-2/playback-options')) {entered = true; await held;} return undefined;});
      const start = d.runtime.start({entry: {id: 'movie-2', kind: 'movie', title: 'Actual row', libraryId: 'library'}, target: {itemId: 'movie-2', startSeconds: 17},
        lifetime: {signal: controller.signal, isCurrent: () => owned}});
      await settle(); assert.equal(entered, true);
      if (closing === 'abort') controller.abort(); else owned = false;
      release(); await start; await settle();
      assert.equal(d.requests.some(request => request.method === 'POST' && request.path === routePath('start_playback_session')), false);
      assert.equal(d.runtime.getSnapshot().session, undefined);
    } finally {release(); d.runtime.dispose();}
  }
});

test('regular start lifetime abandons the actual late 201 session after row retirement', async () => {
  const d = fixture(), controller = new AbortController(); let owned = true, entered = false, created = '', release = () => {};
  try {
    const held = new Promise<void>(resolve => {release = resolve;});
    d.respond(async request => {
      if (request.method !== 'POST' || request.path !== routePath('start_playback_session') || entered) return;
      entered = true; await held;
      const response = await d.server.handle(request);
      assert.equal(response.status, 201); assert.ok(record(response.body) && typeof response.body.id === 'string');
      created = response.body.id; return response;
    });
    const start = d.runtime.start({entry: {id: 'movie-2', kind: 'movie', title: 'Actual row', libraryId: 'library'}, target: {itemId: 'movie-2', startSeconds: 17},
      lifetime: {signal: controller.signal, isCurrent: () => owned}});
    await settle(); assert.equal(entered, true); owned = false;
    release(); await start; await settle();
    assert.ok(created); assert.equal(d.runtime.getSnapshot().session, undefined);
    assert.ok(d.requests.some(request => request.method === 'DELETE' && request.path === encodedRoutePath('stop_playback_session', {id: encodeURIComponent(created)})));
    assert.equal(d.server.session(created)?.ended, true);
  } finally {release(); d.runtime.dispose();}
});


test('non-Home catalogue execution returns the genuine mixed queue and keeps the same engine after caller settlement', async () => {
  const d = fixture(), controller = new AbortController();
  const segments = [{source: {items: {ids: ['movie-1', 'movie-2']}}}, {source: {container: {kind: 'album', id: 'album-actual'}}}] as const;
  try {
    const port = d.runtime.cataloguePlayback(); assert.equal(port, d.runtime.cataloguePlayback());
    const queue = await port.playSegments(segments, {signal: controller.signal, isCurrent: () => true}); await settle();
    assert.equal(queue.id, d.runtime.getSnapshot().session?.queue?.queueId); assert.equal(queue.total, 14);
    assert.ok(d.server.queue(queue.id)); assert.equal(d.engine.lastCommand.binding.itemId, 'movie-1');
    const create = d.requests.find(request => request.method === 'POST' && request.path === routePath('create_queue'))!;
    assert.deepEqual((create.body as any).segments, segments);
    const session = d.runtime.getSnapshot().fence!.sessionId; controller.abort(); await settle();
    assert.equal(d.runtime.getSnapshot().fence?.sessionId, session); assert.equal(d.server.session(session)?.ended, false);
  } finally {d.runtime.dispose();}
});

for (const closing of ['signal', 'member'] as const) test(`non-Home catalogue lifetime reaches actual capability preflight: ${closing}`, async () => {
  const d = fixture(), controller = new AbortController(); let current = true;
  try {
    d.intercept(async request => {if (request.path === routePath('get_capabilities')) {if (closing === 'signal') controller.abort(); else current = false;}});
    await assert.rejects(d.runtime.cataloguePlayback().playSegments([{source: {items: {ids: ['movie-1']}}}], {signal: controller.signal, isCurrent: () => current}));
    assert.equal(d.requests.some(request => request.path === routePath('create_queue')), false);
  } finally {d.runtime.dispose();}
});

test('a retired catalogue caller abandons the exact session from a late real combined queue 201', async () => {
  const d = fixture(), controller = new AbortController(); let release!: () => void, entered = false, created = '';
  const held = new Promise<void>(resolve => {release = resolve;});
  try {
    d.respond(async request => {
      if (request.method !== 'POST' || request.path !== routePath('create_queue') || entered) return;
      entered = true; await held; const response = await d.server.handle(request);
      assert.equal(response.status, 201);
      const body = response.body as {session?: {id: string}}; created = body.session!.id; return response;
    });
    const pending = d.runtime.cataloguePlayback().playSegments([{source: {items: {ids: ['movie-1']}}}], {signal: controller.signal, isCurrent: () => true});
    const rejected = assert.rejects(pending); await settle(); assert.equal(entered, true);
    controller.abort(); release(); await rejected; await settle();
    assert.ok(created); assert.equal(d.runtime.getSnapshot().fence, undefined);
    assert.ok(d.requests.some(request => request.method === 'DELETE' && request.path === encodedRoutePath('stop_playback_session', {id: created})));
    assert.equal(d.server.session(created)?.ended, true);
  } finally {release?.(); d.runtime.dispose();}
});


for (const closing of ['member', 'dispose', 'authority', 'family'] as const) test(`late combined queue cleanup retains the original principal boundary: ${closing}`, async () => {
  const d = fixture(); let release!: () => void, entered = false, created = '', current = true;
  const held = new Promise<void>(resolve => {release = resolve;});
  try {
    d.respond(async request => {
      if (request.method !== 'POST' || request.path !== routePath('create_queue') || entered) return;
      entered = true; await held; const response = await d.server.handle(request);
      assert.equal(response.status, 201); created = (response.body as {session: {id: string}}).session.id; return response;
    });
    const pending = d.runtime.cataloguePlayback().playSegments([{source: {items: {ids: ['movie-1']}}}], {signal: new AbortController().signal, isCurrent: () => current});
    const rejected = assert.rejects(pending); await settle(); assert.equal(entered, true);
    if (closing === 'member') current = false; else if (closing === 'dispose') d.runtime.dispose();
    else if (closing === 'authority') d.authority({epoch: 'replacement'}, false); else d.family('replacement-family');
    release(); await rejected; await settle(); assert.ok(created);
    const stopped = d.requests.some(request => request.method === 'DELETE' && request.path === encodedRoutePath('stop_playback_session', {id: created}));
    assert.equal(stopped, closing === 'member' || closing === 'dispose');
    assert.notEqual(d.runtime.getSnapshot().fence?.sessionId, created);
  } finally {release?.(); d.runtime.dispose();}
});

test('late combined cleanup refuses a session that does not match its returned queue', async () => {
  const d = fixture(), controller = new AbortController(); let release!: () => void, entered = false, created = '';
  const held = new Promise<void>(resolve => {release = resolve;});
  try {
    d.respond(async request => {
      if (request.method !== 'POST' || request.path !== routePath('create_queue') || entered) return;
      entered = true; await held; const response = await d.server.handle(request);
      const body = response.body as {queue: {id: string}; session: {id: string}}; created = body.session.id;
      return {...response, body: {...body, queue: {...body.queue, id: 'unrelated-queue'}}};
    });
    const pending = d.runtime.cataloguePlayback().playSegments([{source: {items: {ids: ['movie-1']}}}], {signal: controller.signal, isCurrent: () => true});
    const rejected = assert.rejects(pending); await settle(); assert.equal(entered, true);
    controller.abort(); release(); await rejected; await settle(); assert.ok(created);
    assert.equal(d.requests.some(request => request.method === 'DELETE' && request.path === encodedRoutePath('stop_playback_session', {id: created})), false);
  } finally {release?.(); d.runtime.dispose();}
});


const timelineBodies = (requests: FakeRequest[]) => requests.filter(request => request.method === 'POST' && request.path.endsWith('/timeline')).map(request => request.body as Record<string, any>);

test('accepted renderer output reaches the existing timeline as an immutable scalar whitelist, with no plan inference', async () => {
  const d = fixture();
  try {
    await d.start('movie-1'); await d.runtime.flush();
    assert.equal(timelineBodies(d.requests).at(-1)?.observedPlayback, undefined, 'source quality and session plan are not observed output');
    const measured = {video: {width: 1920, height: 1080, privatePath: '/not-a-report-field'}, hardwareModel: 'not-a-report-field'};
    d.engine.emit('progress', {observedPlayback: measured});
    measured.video.width = 9;
    await d.runtime.flush(); await settle();
    assert.deepEqual(timelineBodies(d.requests).at(-1)?.observedPlayback, {video: {width: 1920, height: 1080}});
    assert.equal(Object.isFrozen(d.runtime.path.controller.getSnapshot().observation?.observedPlayback?.video), true);
    d.engine.emit('progress', {observedPlayback: {}}); await d.runtime.flush();
    assert.deepEqual(timelineBodies(d.requests).at(-1)?.observedPlayback, {}, 'explicit empty renderer snapshot clears output');
    d.engine.emit('progress'); await d.runtime.flush();
    assert.equal(timelineBodies(d.requests).at(-1)?.observedPlayback, undefined, 'omitted renderer facts remain unknown');
    d.engine.position = 47; d.engine.emit('progress', {observedPlayback: {audio: {channels: Infinity}}});
    await d.runtime.flush();
    const last = timelineBodies(d.requests).at(-1)!;
    assert.equal(last.positionMs, 47000); assert.deepEqual(last.observedPlayback, {}, 'invalid output clears without dropping progress/lease');
  } finally {d.runtime.dispose();}
});

test('renderer output cannot cross a presentation generation or stale native binding', async () => {
  const d = fixture();
  try {
    await d.start('movie-1'); const previous = d.engine.lastCommand.binding, source = d.runtime.getSnapshot();
    d.engine.emit('progress', {observedPlayback: {video: {width: 1920, height: 1080}}}); await d.runtime.flush();
    const quality = source.options!.qualities.find(option => option.mode === 'fixed' && option.id === '720p-high')!;
    await d.runtime.chooseQuality(source.fence!, quality); await settle();
    assert.notEqual(d.engine.lastCommand.binding.generation, previous.generation);
    const current = d.runtime.path.controller.getSnapshot().observation;
    assert.equal(current?.observedPlayback, undefined, 'replacement never inherits prior output facts');
    d.runtime.path.engineFact({type: 'progress', position: 91, binding: previous, observedPlayback: {video: {width: 999}}});
    assert.equal(d.runtime.path.controller.getSnapshot().observation, current, 'common path rejects old same-session presentation before parsing/reporting');
    d.engine.emit('progress', {binding: previous, observedPlayback: {video: {width: 888}}});
    await d.runtime.flush(); await settle();
    const last = timelineBodies(d.requests).at(-1)!;
    assert.equal(last.generation, d.engine.lastCommand.binding.generation); assert.equal(last.observedPlayback, undefined);
  } finally {d.runtime.dispose();}
});
