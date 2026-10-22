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
  const fetcher: typeof fetch = async (input, init) => {
    const url = new URL(String(input)), path = url.pathname + url.search;
    const request: FakeRequest = {method: init?.method ?? 'GET', path, body: typeof init?.body === 'string' ? JSON.parse(init.body) : undefined,
      headers: Object.fromEntries(new Headers(init?.headers)), signal: init?.signal ?? undefined};
    requests.push(request);
    await before?.(request);
    let response: FakeResponse;
    if (path === routePath('get_capabilities')) response = {status: 200, headers: {}, body: {features: {playback_v1_kinds: 'movie,episode,song,audiobook_file'}}};
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
    assert.equal(second.itemId, 'movie-2'); assert.equal(second.playback.run, run);
    await d.runtime.previous(second); await settle();
    const previous = d.runtime.getSnapshot().fence!;
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
    await d.start('movie-1'); detach(); await settle();
    assert.equal(d.runtime.getSnapshot().retired, true);
    assert.equal(d.engine.subscriptions, 0);
    assert.equal(d.engine.released.length, 1);
  } finally { d.runtime.dispose(); }
});
