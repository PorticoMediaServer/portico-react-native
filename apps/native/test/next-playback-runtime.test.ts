import test from 'node:test';
import assert from 'node:assert/strict';
import {HttpLocalApi, type LocalSession} from '../../../packages/client-core/src/index.ts';
import {FakePlaybackServer, type FakeRequest, type FakeResponse} from '../../../packages/client-core/src/playback-v1/testing/fake-server.ts';
import {routePath} from '../../../packages/contracts/src/routes.ts';
import {queueItemInput} from '../../../packages/client-core/src/queue-controller.ts';
import {NativePlaybackRuntime} from '../src-next/platform/playback/runtime.ts';
import type {NativePlaybackSettings, PlaybackAuthority} from '../src-next/platform/playback/types.ts';
import {nativeEngineFeatures} from '../src-next/platform/playback/engine-choice.ts';
import type {NativePlaybackTransport} from '../src-next/platform/playback/NativePlaybackCoordinator.ts';
import type {HomeChannel} from '../../../packages/client-core/src/home.ts';
import type {HomeSelectionPlaybackItem} from '../../../packages/client-core/src/home-selection/types.ts';
import type {SelectionContext} from '../../../packages/client-core/src/selection-model/index.ts';
import type {VideoSnapshotSource} from '../src-next/platform/video-snapshot.ts';

const settle = async (count = 40) => { for (let i = 0; i < count; i++) await new Promise(resolve => setImmediate(resolve)); };
type Command = Record<string, any>;
class Engine implements NativePlaybackTransport {
  commands: Command[] = [];
  released: string[] = [];
  subscriptions = 0;
  listener?: (fact: any) => void;
  position = 0;
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
        this.emit('seekApplied', {seekRevision: command.pendingSeek.revision});
      } else this.emit('progress');
    });
  }
  emit(type: string, extra: Command = {}) {
    const command = this.last;
    if (!command) return;
    this.listener?.({type, instanceId: 'engine-instance', binding: command.binding, intentId: command.binding.intentId,
      factSequence: ++this.sequence, lastCommandRevision: command.commandRevision, position: this.position, paused: command.paused,
      effectiveRate: command.paused ? 0 : command.rate, supportedRates: [.5, 1, 1.5, 2], ...extra});
  }
  get lastCommand() { return this.commands.at(-1)!; }
}

function fixture() {
  const server = new FakePlaybackServer({audioItem: id => id.startsWith('song'), itemKind: id => id.startsWith('song') ? 'song' : 'movie'});
  const engine = new Engine(), requests: FakeRequest[] = [];
  let serial = 0;
  let authority: PlaybackAuthority = {serverId: 'server', accountId: 'account', profileId: 'profile', epoch: 'epoch-1', viewerFence: 'viewer-fence'};
  let session: LocalSession | undefined = {accessToken: '', expiresAt: '2099-01-01T00:00:00Z', viewer: {serverId: 'server', accountId: 'account', profileId: 'profile', authority: 'local', role: 'owner'}, sessionFamilyId: 'family', tokenGeneration: '1', authorizationHorizon: 'horizon'};
  const authorityListeners = new Set<() => void>();
  const eventListeners = new Map<string, Set<(event: any) => void>>();
  const resyncListeners = new Set<() => void>();
  let before: ((request: FakeRequest) => Promise<void>) | undefined;
  const channelSeeks = new Map<string, {id: string; positionMs: number; acknowledged: boolean}>();
  let channelWindow = {startMs: 20000, endMs: 120000};
  const fetcher: typeof fetch = async (input, init) => {
    const url = new URL(String(input)), path = url.pathname + url.search;
    const request: FakeRequest = {method: init?.method ?? 'GET', path, body: typeof init?.body === 'string' ? JSON.parse(init.body) : undefined,
      headers: Object.fromEntries(new Headers(init?.headers)), signal: init?.signal ?? undefined};
    requests.push(request);
    await before?.(request);
    let response: FakeResponse;
    if (path === routePath('get_capabilities')) response = {status: 200, headers: {}, body: {features: {playback_v1_kinds: 'movie,episode,song,audiobook_file', playback_v1_channels: 'enabled'}}};
    else if (/^\/v1\/items\/[^/]+$/.test(path)) {
      const id = decodeURIComponent(url.pathname.split('/').at(-1)!);
      response = {status: 200, headers: {}, body: {id, libraryId: 'library', kind: id.startsWith('song') ? 'song' : 'movie', title: id, durationMs: 180000, progressMs: 0, available: true}};
    } else {
      response = await server.handle(request);
      if (path.includes('/playback-options') && response.status === 200) {
        const body = response.body as Record<string, unknown>, id = body.itemId as string;
        response = {...response, body: {...body, kind: id.startsWith('song') ? 'song' : 'movie', markers: [{id: 'intro-1', type: 'intro', startMs: 10000, endMs: 70000, confidence: 'manual', automaticSafe: true}]}};
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
  let settings: NativePlaybackSettings = {engine: 'automatic', videoRate: 1, audiobookRate: 1, subtitleSize: 'medium', subtitleBackground: 'translucent', skips: {intro: 'ask', recap: 'ask', credits: 'ask'}};
  const settingsListeners = new Set<() => void>();
  let disposedCapabilities = 0;
  const runtime = new NativePlaybackRuntime({api, authority: () => authority, session: () => session,
    subscribeAuthority: listener => { authorityListeners.add(listener); return () => { authorityListeners.delete(listener); }; },
    events: {on(type, listener) { const set = eventListeners.get(type) ?? new Set(); set.add(listener); eventListeners.set(type, set); return () => { set.delete(listener); }; }, onResync(listener) { resyncListeners.add(listener); return () => { resyncListeners.delete(listener); }; }},
    settings: () => settings, subscribeSettings: listener => { settingsListeners.add(listener); return () => { settingsListeners.delete(listener); }; },
    requestId: () => `request-${++serial}-000000000000`, transport: engine, engines: {initial: 'native', choose: () => 'native', transport: () => engine},
    engineFeatures: () => nativeEngineFeatures, capabilitiesReady: async () => {}, disposeCapabilities: () => { disposedCapabilities++; }, timers: {setTimer: () => 0, clearTimer: () => {}},
  });
  const start = async (id: string, startSeconds = 30) => { await runtime.start({entry: {id, kind: id.startsWith('song') ? 'song' : 'movie', title: id, libraryId: 'library', playback: {itemId: id, startSeconds}}, target: {itemId: id, startSeconds}}); await settle(); };
  return {server, engine, runtime, requests, start,
    channelWindow: (startSeconds: number, endSeconds: number) => { channelWindow = {startMs: startSeconds * 1000, endMs: endSeconds * 1000}; },
    intercept: (fn: typeof before) => { before = fn; },
    changeAuthority: () => { authority = {...authority, epoch: 'epoch-2'}; session = undefined; for (const listener of [...authorityListeners]) listener(); },
    settings: (patch: Partial<NativePlaybackSettings>) => { settings = {...settings, ...patch}; for (const listener of settingsListeners) listener(); },
    get disposedCapabilities() { return disposedCapabilities; },
    get subscriptions() { return authorityListeners.size + settingsListeners.size + resyncListeners.size + [...eventListeners.values()].reduce((sum, set) => sum + set.size, 0); },
  };
}

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
    const quality = before.options!.qualities.find(option => option.mode === 'fixed' && option.id === '720p')!;
    await d.runtime.chooseQuality(original, quality); await settle();
    const changed = d.runtime.getSnapshot();
    assert.equal(changed.fence?.sessionId, original.sessionId);
    assert.ok(changed.fence!.generation > original.generation);
    assert.equal(changed.session?.presentation.quality.id, '720p');
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

const selectionContext = (): SelectionContext => ({scope: {serverId: 'server', authority: 'local', accountId: 'account', profileId: 'profile', viewId: 'home', privacyFence: 'viewer-fence'}, revision: {catalogRevision: '1', viewerRevision: '2'}});
function selected(id: string, kind: 'movie' | 'show' | 'album' = 'movie', target = id): HomeSelectionPlaybackItem {
  return {identity: {id, kind, libraryId: 'library'}, entry: {id, kind, libraryId: 'library', title: id, playback: {itemId: target}}, target: {itemId: target}};
}
function homeChannel(): HomeChannel {
  return {source: {id: 'source-1', name: 'source-1', generation: 'g1', publishedAt: '2026-10-22T00:00:00Z', availableStart: '2026-10-22T00:00:00Z', availableEnd: '2026-10-23T00:00:00Z', provenance: 'live-source', refreshState: 'ready'},
    channel: {id: 'channel-1', sourceId: 'source-1', provenance: 'live-source', name: 'channel-1', number: '1', group: '', generation: 'g1', programmes: [], tuneAvailable: true, recordAvailable: false, tuneUnavailableReason: '', recordUnavailableReason: '', favorite: false, hidden: false, preferenceRevision: 1, mark: {text: '1', seed: 'channel-1'}}};
}

test('Home mixed Play returns the real queue receipt and adopts it through this runtime native engine', async () => {
  const d = fixture(), context = selectionContext(), signal = new AbortController().signal;
  try {
    const collection: HomeSelectionPlaybackItem = {identity: {id: 'collection-1', kind: 'collection', libraryId: 'library'}, collection: {collection: {id: 'collection-1', libraryId: 'library', name: 'collection-1', itemCount: 12, revision: 1}, members: []}};
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
    const live = d.runtime.getSnapshot().fence!; await d.runtime.toggle(live); await d.runtime.seek(live, 44); await settle();
    await d.start('song-1', 19);
    const requestCount = d.requests.length, commandCount = d.engine.commands.length;
    const restored = await d.runtime.restoreBookmark(live, false); await settle();
    assert.equal(restored?.kind, 'channel'); assert.notEqual(restored?.sessionId, live.sessionId);
    assert.equal(d.runtime.getSnapshot().playback.intent, 'paused'); assert.equal(d.runtime.getSnapshot().playback.positionSeconds, 44);
    const start = d.requests.slice(requestCount).find(request => request.method === 'POST' && (request.body as any)?.channelId)!;
    assert.equal((start.body as any).state, 'paused');
    assert.ok(d.engine.commands.slice(commandCount).filter(command => command.binding.itemId === 'channel-1').every(command => command.paused === true));
    assert.equal(d.server.session(restored!.sessionId)?.state, 'paused');
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
