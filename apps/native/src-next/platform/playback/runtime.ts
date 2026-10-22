import {PlaybackService, type PlaybackSnapshot} from '../../../../../packages/client-core/src/index';
import {DetailService, type DetailProjection} from '../../../../../packages/client-core/src/detail';
import type {ContentEntry} from '../../../../../packages/client-core/src/library-content';
import {parseMediaItem} from '../../../../../packages/client-core/src/media-item';
import {encodedRoutePath, routePath} from '../../../../../packages/contracts/src/routes';
import {SessionsClient} from '../../../../../packages/client-core/src/playback-v1/sessions';
import {localV1Http} from '../../../../../packages/client-core/src/playback-v1/local-http';
import {call, type V1Request} from '../../../../../packages/client-core/src/playback-v1/http';
import {PlaybackOptionsClient} from '../../../../../packages/client-core/src/playback-v1/options';
import {V1QueuePlayer, serverSupportsQueueTransitions} from '../../../../../packages/client-core/src/playback-v1/v1-queue-player';
import type {Session, PlaybackOptions} from '../../../../../packages/client-core/src/playback-v1/types';
import type {PlaybackChoices} from '../../../../../packages/client-core/src/playback-v1/choices';
import {qualityOptionRequest, type QualityOption} from '../../../../../packages/client-core/src/playback-v1/quality';
import {SubtitleService} from '../../../../../packages/client-core/src/subtitles';
import type {PlaybackSubject, CardSubject} from '../../../../../packages/client-core/src/presentation/kit-model';
import {serviceText} from '../../../../../packages/client-core/src/presentation/service-text';
import {PlaybackDock, PlayerSessionChoices, activeSegment, skipsAutomatically, skipTarget, parseQueueSnapshot, playbackFence, sameFence, sameScope, type DockPlayback, type DockTransition, type PlaybackFence, type QueueScope} from '../../../../../packages/player-core/src';
import {NativePlaybackCoordinator} from './NativePlaybackCoordinator';
import {NativePlayback, automaticSteps} from './native-playback';
import {PlaybackScopeHttp} from './scope-http';
import {captionStyle} from './caption-style';
import {deviceDrawnTrack, engineSubtitleRender, fontsUrlOf, parseSubtitleFonts, type SubtitleFonts} from './engine-media';
import {classifyPlaybackFailure} from './playback-failure';
import {nativeListeningFor, serverPlaybackV1Kinds} from './native-listening-kinds';
import type {NativePlaybackStart, NativePlaybackRuntimeOptions, NativePlaybackRuntimeSnapshot, PlaybackAuthority} from './types';

const authorityKey = (value: PlaybackAuthority) => JSON.stringify([value.serverId, value.accountId, value.profileId, value.epoch, value.viewerFence]);
const wireId = (value: unknown): value is string => typeof value === 'string' && /^[A-Za-z0-9_.-]{1,128}$/.test(value);
const audioKind = (kind: string | undefined) => kind === 'song' || kind === 'track' || kind === 'audiobook_file' || kind === 'audiobook';
const kindOf = (kind: string | undefined): DockPlayback['kind'] => kind === 'song' || kind === 'track' ? 'music' : kind === 'audiobook_file' || kind === 'audiobook' ? 'audiobook' : 'video';
const subjectOf = (entry: ContentEntry, detail?: DetailProjection): PlaybackSubject => {
  const item = detail?.item, episode = item?.episode;
  const card: CardSubject = {
    id: entry.id, kind: entry.kind, title: entry.title,
    artist: item?.song?.artist ?? entry.artist?.name, album: item?.song?.albumTitle ?? entry.album?.name,
    author: entry.author, durationSeconds: entry.duration,
    ...(episode ? {show: {id: episode.showId, title: episode.showTitle}, episode: episode.numbering === 'date' ? {mode: 'date' as const, day: episode.airDate} : episode.numbering === 'absolute' ? {mode: 'absolute' as const, number: episode.number} : episode.numbering === 'special' ? {mode: 'special' as const} : {mode: 'seasonal' as const, season: episode.seasonNumber ?? undefined, episode: episode.number}} : entry.episodeNumber === undefined ? {} : {episode: {mode: 'seasonal' as const, season: entry.seasonNumber, episode: entry.episodeNumber}}),
  };
  const kind = kindOf(entry.kind);
  return {kind: kind === 'video' || kind === 'live' ? 'video' : kind, item: card};
};
type Bookmark = Readonly<{playback: DockPlayback; entry?: ContentEntry; subject?: PlaybackSubject; queueId?: string; entryId?: string}>;

/** Actual session, queue and native-engine wiring. Construct one per selected authority.
 * The production factory in native.tsx supplies the existing native modules and one view. */
export class NativePlaybackRuntime {
  readonly playback: PlaybackService;
  readonly path: NativePlayback;
  readonly queue: V1QueuePlayer;
  readonly coordinator: NativePlaybackCoordinator;
  readonly dock: PlaybackDock;
  readonly choices = new PlayerSessionChoices();
  private readonly o: NativePlaybackRuntimeOptions;
  private readonly bound: PlaybackAuthority;
  private readonly scope: QueueScope;
  private readonly http: PlaybackScopeHttp;
  private readonly optionsClient: PlaybackOptionsClient;
  private snapshot: NativePlaybackRuntimeSnapshot;
  private listeners = new Set<() => void>();
  private offs: (() => void)[] = [];
  private connected = false;
  private retired = false;
  private startEpoch = 0;
  private startController?: AbortController;
  private sourceEpoch = 0;
  private sourceController?: AbortController;
  private sourceKey = '';
  private subtitleService?: SubtitleService;
  private subtitleOff?: () => void;
  private fonts?: SubtitleFonts | 'pending';
  private fontsKey?: string;
  private detail?: DetailService;
  private entry?: ContentEntry;
  private subject?: PlaybackSubject;
  private options?: PlaybackOptions;
  private bookmarks = new Map<string, Bookmark>();
  private updating = false;
  private preparing = false;
  private transitionEpoch?: number;
  private expanded = false;
  private displaySubtitles = true;
  private serverKinds: readonly string[] = [];
  private transitions = false;
  private effectiveRate = 0;
  private supportedRates: readonly number[] = [];
  private surfaceOwner?: object;
  private routeRecovery?: ReturnType<typeof setTimeout>;
  private recoverySince = 0;
  private completionTimer?: unknown;
  private completionKey = '';
  private skipped = new Set<string>();

  constructor(options: NativePlaybackRuntimeOptions) {
    this.o = options;
    this.bound = Object.freeze({...options.authority()});
    const viewer = options.session()?.viewer;
    if (!viewer || !['local', 'hosted'].includes(viewer.authority) || viewer.serverId !== this.bound.serverId || viewer.accountId !== this.bound.accountId || viewer.profileId !== this.bound.profileId) throw new Error('Invalid playback authority.');
    // These are the actual controller identifiers V1QueuePlayer publishes (its constructor).
    this.scope = Object.freeze({serverId: viewer.serverId, authority: viewer.authority as 'local' | 'hosted', accountId: viewer.accountId, profileId: viewer.profileId, controllerId: 'v1', controllerEpoch: 'v1', commandLaneId: 'v1'});
    this.http = new PlaybackScopeHttp(localV1Http(options.api), () => this.currentAuthority());
    this.optionsClient = new PlaybackOptionsClient(this.http);
    this.path = new NativePlayback({http: this.http, key: options.requestId, timers: options.timers});
    this.playback = new PlaybackService(this.path.transport, options.requestId, {queueRequired: true, deferRecovery: true});
    this.queue = new V1QueuePlayer({http: this.http, api: this.path.transport, playback: this.playback, viewer: this.scope, key: options.requestId, events: options.events,
      transitions: () => this.transitions, native: options.nativeListening, nativeFor: kind => nativeListeningFor(this.serverKinds)(kind)});
    // Video completion remains held for the later player. Music follows the server's real policy.
    this.queue.setCompletionPolicy(({kind}) => audioKind(kind) ? 'advance' : 'hold');
    this.dock = new PlaybackDock(this.scope);
    this.coordinator = new NativePlaybackCoordinator(this.playback, options.transport, options.requestId,
      state => {
        if (!state.session) return '';
        try { return options.api.mediaUrl(state.session.streamUrl); }
        catch { this.playback.fail(state.intentId, serviceText('queuePlayer.startFailed')); return ''; }
      }, fact => this.acceptFact(fact), options.engines);
    this.snapshot = this.makeSnapshot(0);
  }
  getSnapshot = () => this.snapshot;
  subscribe = (listener: () => void) => { this.listeners.add(listener); return () => { this.listeners.delete(listener); }; };
  private authorityMatches(): boolean {
    const viewer = this.o.session()?.viewer;
    return authorityKey(this.o.authority()) === authorityKey(this.bound) && viewer?.serverId === this.scope?.serverId && viewer.accountId === this.scope.accountId && viewer.profileId === this.scope.profileId && viewer.authority === this.scope.authority;
  }
  private currentAuthority(): boolean { return !this.retired && this.authorityMatches(); }
  private active(): boolean { if (!this.currentAuthority()) { this.dispose(); return false; } return true; }
  private matches(fence: PlaybackFence): boolean { return this.active() && !!this.snapshot.fence && sameFence(this.snapshot.fence, fence); }
  private request = async <T>(path: string, method = 'GET', body?: unknown, signal?: AbortSignal): Promise<T> => {
    if (!['GET', 'POST', 'PUT', 'PATCH', 'DELETE'].includes(method)) throw new Error('Invalid playback request method.');
    return (await call(this.http, {path, method: method as V1Request['method'], body, signal})).body as T;
  };

  connect(): void {
    if (this.connected || !this.active()) return;
    this.connected = true;
    this.offs.push(this.path.bind(this.playback, () => this.queue));
    this.offs.push(this.playback.subscribe(() => this.changed()));
    this.offs.push(this.queue.subscribe(() => this.changed()));
    this.offs.push(this.path.subscribeSessions(() => this.changed()));
    this.offs.push(this.queue.connect());
    this.offs.push(this.coordinator.subscribe(() => this.publish()));
    this.offs.push(this.o.subscribeAuthority(() => { if (!this.active()) return; void this.refreshAuthority(); }));
    this.offs.push(this.o.subscribeSettings(() => { if (this.active()) { this.applyOptions(); this.coordinator.reconsiderEngine(); this.publish(); } }));
    this.offs.push(this.o.api.subscribeRoute(() => this.routeChanged()));
    this.offs.push(this.o.events.on('session.updated', event => { if (this.active() && event.resource?.kind === 'session') this.path.transport.sessionUpdated(event.resource.id, event.revision, event.data); }));
    this.offs.push(this.o.events.onResync(() => { if (this.active()) { void this.queue.refresh().catch(() => {}); void this.refreshAuthority(); } }));
    this.routeChanged();
    this.coordinator.start();
    void this.playback.startRecovery();
    this.changed();
  }
  private routeChanged(): void {
    if (!this.active()) return;
    const route = this.o.api.getRouteSnapshot();
    this.coordinator.setConnection(!route || route.phase === 'ready');
  }
  refreshAuthority = async (): Promise<void> => {
    if (!this.active()) return;
    await this.playback.refreshPlaybackAuthority();
    if (this.active()) await this.o.nativeListening?.refresh();
  };
  flush = () => this.path.controller.flush();

  start = async (input: NativePlaybackStart): Promise<void> => {
    this.connect();
    if (!this.active()) return;
    if (!wireId(input.target.itemId) || input.target.startSeconds !== undefined && (!Number.isFinite(input.target.startSeconds) || input.target.startSeconds < 0)) throw new Error('Invalid playback target.');
    const epoch = ++this.startEpoch;
    this.transitionEpoch = undefined; this.preparing = false;
    await this.queue.cancel();
    if (!this.active() || epoch !== this.startEpoch) return;
    this.startController?.abort();
    const controller = new AbortController(); this.startController = controller;
    await this.o.capabilitiesReady();
    if (!this.active() || epoch !== this.startEpoch) return;
    let offered: PlaybackOptions, capabilities: unknown;
    try {
      [offered, capabilities] = await Promise.all([
        this.optionsClient.options(input.target.itemId, {}, controller.signal),
        this.request<unknown>(routePath('get_capabilities'), 'GET', undefined, controller.signal),
      ]);
    } catch (error) { if (epoch !== this.startEpoch || controller.signal.aborted || !this.active()) return; throw error; }
    if (!this.active() || epoch !== this.startEpoch) return;
    if (offered.itemId !== input.target.itemId || !offered.versions.length) throw new Error(serviceText('queuePlayer.unsupported'));
    this.serverKinds = serverPlaybackV1Kinds(capabilities);
    this.transitions = serverSupportsQueueTransitions(capabilities);
    const old = this.dock.getSnapshot().local;
    if (old) {
      this.remember(old);
      if (this.snapshot.fence && sameFence(old.fence, this.snapshot.fence)) this.playback.pause();
    }
    this.preparing = true;
    this.entry = input.entry.id === input.target.itemId ? input.entry : undefined;
    this.subject = this.entry ? subjectOf(this.entry) : undefined;
    this.options = offered;
    this.expanded = !audioKind(offered.kind);
    try {
      await this.queue.playItem(input.target.itemId, input.target.startSeconds);
      if (epoch === this.startEpoch && this.active() && this.queue.getSnapshot().error) { this.playback.pause(); throw new Error(serviceText('queuePlayer.startFailed')); }
    }
    finally { if (epoch === this.startEpoch) { this.preparing = false; this.changed(); } }
  };

  private currentSession(): Session | undefined {
    const held = this.playback.getSnapshot().session;
    const session = held ? this.path.session(held.id) ?? this.queue.currentSession() : undefined;
    return held && session?.id === held.id && session.presentation.generation === held.generation ? session : undefined;
  }
  private fence(): PlaybackFence | undefined {
    const state = this.playback.getSnapshot(), session = this.currentSession(), view = this.queue.getSnapshot().view;
    if (!state.session || !state.itemId || !session?.versionId || !session.queue?.entryId || state.playbackRun < 1 || this.preparing && this.options?.itemId !== state.itemId) return undefined;
    if (view && !sameScope(view.queue.scope, this.scope)) return undefined;
    const data = this.detail?.getSnapshot().data;
    const episode = data?.item.id === state.itemId && data.scope.viewerFence === this.bound.viewerFence ? data.item.episode : undefined;
    return playbackFence({playback: {scope: this.scope, run: state.playbackRun}, sessionId: state.session.id, itemId: state.itemId,
      sourceId: session.versionId, entryId: session.queue.entryId, generation: state.session.generation,
      ...(episode?.showId ? {showId: episode.showId} : {}), ...(episode?.seasonId ? {seasonId: episode.seasonId} : {})});
  }
  private local(fence: PlaybackFence): DockPlayback {
    const state = this.playback.getSnapshot(), queue = this.queue.getSnapshot().view?.queue;
    // A building window is not a completed server-authoritative queue projection.
    let readyQueue: DockPlayback['queue'] = null;
    if (queue) { try { readyQueue = parseQueueSnapshot(queue, this.scope); } catch { /* Keep the validated v1 window in snapshot.queue; never invent a stricter projection. */ } }
    return {fence, kind: kindOf(this.currentSession()?.kind === 'audio' ? this.entry?.kind ?? this.options?.kind : this.entry?.kind), queue: readyQueue,
      positionSeconds: state.positionSeconds, playing: state.intent === 'playing' && state.phase !== 'error' && state.phase !== 'ended', expanded: this.expanded};
  }
  private changed(): void {
    if (this.updating || this.transitionEpoch !== undefined || !this.active()) return;
    this.updating = true;
    try {
      const state = this.playback.getSnapshot(), fence = this.fence();
      if (fence) {
        this.choices.begin(fence.playback); this.choices.bindSource(fence);
        const local = this.local(fence), before = this.dock.getSnapshot().local;
        if (before && sameFence(before.fence, fence)) this.dock.update(local);
        else {
          if (before) this.remember(before);
          const transition = this.dock.start(local);
          // Old sources are already fenced/retired by PlaybackService + coordinator. Never stop
          // the new generation in response to an effect naming the previous generation.
          for (const effect of transition.effects) if (effect.kind === 'pause') this.remember(effect.playback);
        }
        if (state.phase === 'error' && !this.expanded) { this.expanded = true; this.dock.expand(fence); }
      }
      const key = state.session && state.itemId && (state.phase === 'starting' || state.phase === 'ready') ? `${state.intentId}/${state.session.id}/${state.session.generation}/${state.itemId}` : '';
      if (key !== this.sourceKey) this.selectSource(key);
      this.applyOptions();
      this.completionChanged();
      this.publish();
    } finally { this.updating = false; }
  }
  private remember(playback: DockPlayback): void {
    const session = this.currentSession();
    const previous = this.bookmarks.get(playback.fence.sessionId);
    const current = this.playback.getSnapshot().session?.id === playback.fence.sessionId && this.entry?.id === playback.fence.itemId;
    this.bookmarks.set(playback.fence.sessionId, {playback, entry: current ? this.entry : previous?.entry, subject: current ? this.subject : previous?.subject,
      queueId: playback.queue?.id ?? (session?.id === playback.fence.sessionId ? session.queue?.queueId : previous?.queueId), entryId: playback.fence.entryId});
    while (this.bookmarks.size > 8) this.bookmarks.delete(this.bookmarks.keys().next().value!);
  }
  private selectSource(key: string): void {
    this.sourceKey = key; const epoch = ++this.sourceEpoch;
    this.sourceController?.abort();
    this.subtitleOff?.(); this.subtitleOff = undefined;
    const subtitles = this.subtitleService; this.subtitleService = undefined; subtitles?.stop();
    this.detail?.dispose(); this.detail = undefined; this.fonts = undefined; this.fontsKey = undefined;
    this.options = this.options?.itemId === this.playback.getSnapshot().itemId ? this.options : undefined;
    this.effectiveRate = 0; this.supportedRates = [];
    if (!key) { if (!this.preparing && this.playback.getSnapshot().phase === 'idle') { this.entry = undefined; this.subject = undefined; } return; }
    const controller = new AbortController(); this.sourceController = controller;
    const state = this.playback.getSnapshot(), itemId = state.itemId!, session = this.currentSession();
    if (this.entry?.id !== itemId) { this.entry = undefined; this.subject = undefined; }
    const valid = () => this.active() && epoch === this.sourceEpoch && !controller.signal.aborted;
    void this.optionsClient.options(itemId, session?.versionId ? {versionId: session.versionId} : {}, controller.signal).then(value => {
      if (!valid() || value.itemId !== itemId) return; this.options = value; this.applyOptions(); this.publish();
    }).catch(() => {});
    void this.request<unknown>(encodedRoutePath('get_items_id', {id: encodeURIComponent(itemId)}), 'GET', undefined, controller.signal).then(async raw => {
      if (!valid()) return;
      const item = parseMediaItem(raw);
      if (item.id !== itemId) return;
      const kind = item.kind === 'track' ? 'song' : item.kind === 'audiobook' ? 'audiobook_file' : item.kind;
      if (!['movie', 'episode', 'extra', 'song', 'audiobook_file'].includes(kind)) return;
      this.entry = {...this.entry, ...item, kind: kind as ContentEntry['kind']}; this.subject = subjectOf(this.entry);
      const detail = new DetailService({api: {request: this.request}, scope: {serverId: this.bound.serverId, viewerId: this.bound.profileId}, requestId: async () => this.o.requestId()});
      this.detail = detail;
      await detail.select({itemId, libraryId: item.libraryId});
      if (!valid() || this.detail !== detail) return;
      const data = detail.getSnapshot().data;
      if (data?.scope.viewerFence === this.bound.viewerFence && this.entry) this.subject = subjectOf(this.entry, data);
      this.changed();
    }).catch(() => {});
    if (state.session && session?.kind === 'vod') {
      const service = new SubtitleService({request: this.request}, {itemId, sessionId: state.session.id, generation: state.session.generation}, this.o.requestId,
        {install: presentation => valid() && this.playback.installSubtitlePresentation(presentation)});
      this.subtitleService = service;
      this.subtitleOff = service.subscribe(() => { if (valid()) { this.applyOptions(); this.publish(); } });
      service.setPolling(false); service.start();
    }
  }

  private applyOptions(): void {
    if (this.retired) return;
    const state = this.playback.getSnapshot(), fence = this.fence(), settings = this.o.settings();
    if (!state.session || !fence) { this.coordinator.setOptions(1, null, null); return; }
    const baseRate = this.local(fence).kind === 'audiobook' ? settings.audiobookRate : this.local(fence).kind === 'music' ? 1 : settings.videoRate;
    const rate = this.choices.get('speed', fence.playback, baseRate);
    this.path.setRate(rate);
    const session = this.currentSession(), plan = this.subtitleService?.getSnapshot().plan;
    this.path.setTracks(session?.presentation.audioTrackId, session?.presentation.subtitle?.trackId ?? null);
    const style = captionStyle(this.choices.get('subtitleSize', fence.playback, settings.subtitleSize), this.choices.get('subtitleBackground', fence.playback, settings.subtitleBackground));
    const binding = {intentId: state.intentId, sessionId: state.session.id, generation: state.session.generation};
    let subtitles: Record<string, unknown> | null = null;
    const visible = this.displaySubtitles && this.expanded;
    const drawn = deviceDrawnTrack(plan, session), selected = plan?.mode === 'track' && !this.subtitleService?.getSnapshot().suppressed ? plan.selected : null;
    const listUrl = fontsUrlOf(plan, session);
    if (visible && listUrl && listUrl !== this.fontsKey) {
      this.fontsKey = listUrl; this.fonts = 'pending'; const epoch = this.sourceEpoch;
      void this.request<unknown>(listUrl, 'GET', undefined, this.sourceController?.signal).then(raw => {
        if (this.active() && epoch === this.sourceEpoch && this.fontsKey === listUrl) { this.fonts = parseSubtitleFonts(raw, listUrl); this.applyOptions(); }
      }).catch(() => { if (this.active() && epoch === this.sourceEpoch && this.fontsKey === listUrl) { this.fonts = parseSubtitleFonts(null, listUrl); this.applyOptions(); } });
    }
    if (plan) subtitles = {binding, mode: 'off', revision: plan.revision};
    if (visible && plan && (selected || drawn)) {
      // mediaUrl enforces the current selected origin/media grant. No raw URL concatenation.
      const render = this.coordinator.getEngine() === 'mpv' ? engineSubtitleRender(plan, state.session, this.o.engineFeatures('mpv').subtitleRendering, path => this.o.api.mediaUrl(path), this.fonts, session) : undefined;
      if (selected && plan.documentUrl || render) {
        const resource = selected ?? drawn?.resource;
        subtitles = {binding, mode: 'track', revision: plan.revision, resourceId: selected?.id ?? drawn?.id, resourceRevision: resource?.revision ?? 1,
          manifestName: resource?.manifestName, origin: resource?.origin ?? 'embedded', language: resource?.language ?? '', title: resource?.title ?? '', offsetUs: selected ? plan.offsetUs : '0',
          ...(selected && plan.documentUrl ? {documentUrl: this.o.api.mediaUrl(plan.documentUrl)} : {}), ...(render ? {render} : {}), refreshRevision: 0, style};
      }
    }
    this.coordinator.setOptions(rate, null, subtitles);
    const version = this.options?.versions.find(value => value.id === session?.versionId);
    this.path.setAutomatic(session?.presentation.quality.mode === 'automatic' ? {steps: automaticSteps(this.options?.qualities ?? []), originalKbps: version?.bitrateKbps} : null);
  }

  private makeSnapshot(sequence: number): NativePlaybackRuntimeSnapshot {
    const playback = this.playback.getSnapshot(), fence = this.retired ? undefined : this.fence(), queue = this.queue.getSnapshot(), view = queue.view;
    const currentIndex = view?.items.findIndex(item => item.entryId === fence?.entryId) ?? -1;
    const ready = !!fence && !this.retired && (playback.phase === 'ready' || playback.phase === 'starting');
    const session = this.currentSession();
    return Object.freeze({authority: this.bound, sequence, dock: this.dock.getSnapshot(), playback, fence, subject: this.subject, entry: this.entry, queue, session,
      options: this.options, subtitles: this.subtitleService?.getSnapshot(), engine: this.coordinator.getEngine() === 'mpv' ? 'mpv' : 'native', lease: this.coordinator.getSnapshot(), effectiveRate: playback.nativeListening?.effectiveRate ?? this.effectiveRate, supportedRates: playback.nativeListening?.supportedRates ?? this.supportedRates, retired: this.retired,
      capabilities: Object.freeze({play: ready && playback.intent === 'paused', pause: ready && playback.intent === 'playing', stop: !!fence, seek: ready && playback.duration > 0,
        previous: ready && (playback.positionSeconds > 3 || currentIndex > 0), next: ready && !!view && view.next.reason !== 'end', cast: ready && !!this.o.openDestinations,
        subtitlesCanHide: session?.presentation.subtitle?.delivery !== 'burn' && session?.presentation.decision.subtitles?.action !== 'burn' && this.subtitleService?.getSnapshot().plan?.renderer !== 'burn_in'})});
  }
  private publish(): void { this.snapshot = this.makeSnapshot(this.snapshot.sequence + 1); for (const listener of [...this.listeners]) listener(); }

  private acceptFact(fact: any): void {
    if (!this.active()) return;
    this.path.engineFact(fact);
    const before = this.playback.getSnapshot();
    if (typeof fact.effectiveRate === 'number') this.effectiveRate = fact.effectiveRate;
    if (Array.isArray(fact.supportedRates)) this.supportedRates = Object.freeze(fact.supportedRates.filter((rate: unknown): rate is number => typeof rate === 'number' && Number.isFinite(rate) && rate >= .5 && rate <= 3));
    if (fact.type === 'systemPaused') this.playback.pause();
    else if (fact.type === 'ready') this.playback.ready(before.intentId);
    else if (fact.type === 'stalled') this.playback.recovering(before.intentId, true);
    else if (fact.type === 'seekApplied') this.playback.seekApplied(before.intentId, fact.seekRevision, fact.position, fact.paused ? 'paused' : 'playing');
    else if (fact.type === 'seekFailed') this.playback.seekFailed(before.intentId, fact.seekRevision, serviceText('queuePlayer.startFailed'));
    else if (fact.type === 'progress' || fact.type === 'ended') { this.recoverySince = 0; if (this.routeRecovery) clearTimeout(this.routeRecovery); this.playback.recovering(before.intentId, false); this.playback.fact(before.intentId, fact.position, fact.type === 'ended' ? 'ended' : fact.paused ? 'paused' : 'playing'); }
    else if (fact.type === 'error') {
      const failure = classifyPlaybackFailure(fact);
      if (failure.network && this.o.api.getRouteConnection()) {
        this.recoverySince ||= Date.now();
        if (Date.now() - this.recoverySince < 90_000) {
          this.playback.recovering(before.intentId, true);
          if (this.routeRecovery) clearTimeout(this.routeRecovery);
          this.routeRecovery = setTimeout(() => { if (this.active() && this.playback.getSnapshot().intentId === before.intentId) void this.o.api.recoverRoute().catch(() => {}); }, 1000);
          return;
        }
      }
      if (failure.engine) this.playback.engineFailed(before.intentId, failure.engine, '', serviceText('queuePlayer.unsupported'));
      else this.playback.fail(before.intentId, serviceText('queuePlayer.startFailed'));
    }
    if (fact.rateError && before.intent === 'playing') this.playback.pause();
    this.automaticSkip();
    this.publish();
  }

  private automaticSkip(): void {
    const state = this.playback.getSnapshot(), fence = this.fence();
    if (!fence || state.phase !== 'ready' || state.intent !== 'playing' || state.pendingSeek || state.failedSeek) return;
    const modes = this.o.settings().skips;
    const markers = (this.options?.markers ?? []).map(marker => ({id: marker.id, kind: marker.type, startSeconds: marker.startMs / 1000, endSeconds: marker.endMs / 1000, automaticSafe: marker.automaticSafe}));
    const prefix = `${fence.playback.run}/${fence.sourceId}/`;
    const dismissed = new Set([...this.skipped].filter(key => key.startsWith(prefix)).map(key => key.slice(prefix.length)));
    const marker = activeSegment(markers, state.positionSeconds, modes, dismissed);
    if (!marker || !skipsAutomatically(marker, modes)) return;
    this.skipped.add(prefix + marker.id);
    this.playback.markerSkipped(marker.id, 'automatic', state.positionSeconds);
    this.playback.seek(skipTarget(marker, state.duration));
  }

  private clearCompletion(): void {
    if (this.completionTimer !== undefined) (this.o.timers?.clearTimer ?? (timer => clearTimeout(timer as ReturnType<typeof setTimeout>)))(this.completionTimer);
    this.completionTimer = undefined; this.completionKey = '';
  }
  private completionChanged(): void {
    const held = this.queue.getSnapshot().completion, fence = this.fence();
    if (!held || !fence || held.sessionId !== fence.sessionId) { this.clearCompletion(); return; }
    if (held.postPlay.passoutCheckDue) { this.clearCompletion(); this.expanded = true; this.dock.expand(fence); return; }
    if (!held.postPlay.autoplay || !held.nextAvailable) { this.clearCompletion(); return; }
    if (this.completionKey === held.sessionId) return;
    this.clearCompletion(); this.completionKey = held.sessionId;
    this.completionTimer = (this.o.timers?.setTimer ?? ((fn, ms) => setTimeout(fn, ms)))(() => {
      this.completionTimer = undefined;
      if (this.matches(fence) && this.queue.getSnapshot().completion === held) void this.queue.continueCompletion('automatic').catch(() => {});
    }, held.postPlay.countdownSeconds * 1000);
  }

  toggle = async (fence: PlaybackFence): Promise<void> => { if (this.matches(fence)) { const state = this.playback.getSnapshot(); if (state.intent === 'playing') this.playback.pause(); else this.playback.resume(); } };
  replay = async (fence: PlaybackFence): Promise<void> => { if (this.matches(fence)) await this.queue.playItem(fence.itemId, 0); };
  seek = async (fence: PlaybackFence, seconds: number): Promise<void> => { if (this.matches(fence) && Number.isFinite(seconds) && seconds >= 0 && this.snapshot.capabilities.seek) this.playback.seek(seconds); };
  skip = async (fence: PlaybackFence, seconds: number): Promise<void> => { if (this.matches(fence) && Number.isFinite(seconds)) await this.seek(fence, Math.max(0, this.playback.getSnapshot().positionSeconds + seconds)); };
  previous = async (fence: PlaybackFence): Promise<void> => { if (this.matches(fence) && this.snapshot.capabilities.previous) await this.queue.previous(); };
  next = async (fence: PlaybackFence): Promise<void> => { const view = this.queue.getSnapshot().view; if (this.matches(fence) && this.snapshot.capabilities.next && view) await this.queue.next(view.queue.id, view.queue.revision); };
  stop = async (fence: PlaybackFence): Promise<void> => { if (this.matches(fence)) await this.onTransition(this.dock.close(fence)); };
  open = (fence: PlaybackFence): void => { if (this.matches(fence)) { this.expanded = true; this.dock.expand(fence); this.applyOptions(); this.publish(); } };
  collapse = (fence: PlaybackFence): void => { if (this.matches(fence)) { this.expanded = false; this.dock.collapse(fence); this.applyOptions(); this.publish(); } };
  setSubtitleDisplay(visible: boolean): void { if (this.displaySubtitles !== visible) { this.displaySubtitles = visible; this.applyOptions(); } }
  cast = async (fence: PlaybackFence): Promise<void> => { if (this.matches(fence) && this.o.openDestinations) await this.o.openDestinations(fence); };

  change = async (fence: PlaybackFence, choice: PlaybackChoices): Promise<void> => {
    if (!this.matches(fence)) return;
    const options = this.options, version = options?.versions.find(value => value.id === this.currentSession()?.versionId);
    if (choice.quality && !options?.qualities.some(value => value.mode === choice.quality!.mode && (value.mode !== 'fixed' || value.id === ('id' in choice.quality! ? choice.quality!.id : undefined)))) throw new Error('Invalid playback quality.');
    if (!options || choice.versionId && !options.versions.some(value => value.id === choice.versionId) || choice.audioTrackId && !version?.audio.some(value => value.id === choice.audioTrackId) || choice.subtitleTrackId && !version?.subtitles.some(value => value.id === choice.subtitleTrackId) && !this.subtitleService?.getSnapshot().plan?.resources.some(value => value.id === choice.subtitleTrackId && value.enabled)) throw new Error('Invalid playback choice.');
    await this.playback.changePlayback(choice);
  };
  chooseQuality = async (fence: PlaybackFence, choice: QualityOption): Promise<void> => {
    if (!this.matches(fence) || !this.options?.qualities.some(value => value.mode === choice.mode && value.id === choice.id)) return;
    this.path.forgetAutomaticStep(); await this.playback.changePlayback({quality: qualityOptionRequest(choice)});
  };
  setRate = (fence: PlaybackFence, rate: number): void => {
    if (!this.matches(fence) || !this.snapshot.supportedRates.includes(rate)) return;
    if (this.choices.set('speed', fence.playback, rate, fence)) { this.playback.setPlaybackRate(rate); this.applyOptions(); this.publish(); }
  };
  onTransition = async (transition: DockTransition): Promise<void> => { await this.applyTransition(transition); };

  /** Resume actions name the offered bookmark. They never toggle whatever became current. */
  restoreBookmark = async (expected: PlaybackFence, playExplicitly: boolean): Promise<PlaybackFence | undefined> => {
    if (!this.active()) return;
    const state = this.dock.getSnapshot();
    const offered = [state.parkedAudio, state.resumeVideo, state.local].find(value => value && sameFence(value.fence, expected));
    const saved = this.bookmarks.get(expected.sessionId);
    if (!offered || !saved || !sameFence(saved.playback.fence, expected)) return;
    let transition: DockTransition;
    if (state.parkedAudio && sameFence(state.parkedAudio.fence, expected)) transition = this.dock.restoreAudio();
    else if (state.resumeVideo && sameFence(state.resumeVideo.fence, expected)) transition = this.dock.restoreVideo();
    else transition = {state, effects: [{kind: 'restore', playback: offered, playing: false}]};
    const result = await this.applyTransition(transition);
    if (!result || result.epoch !== this.startEpoch || !this.matches(result.fence)) return;
    if (playExplicitly) this.playback.resume();
    return result.fence;
  };

  private applyTransition = async (transition: DockTransition): Promise<{fence: PlaybackFence; epoch: number} | undefined> => {
    if (!this.active() || transition.state !== this.dock.getSnapshot()) return;
    const epoch = ++this.startEpoch;
    this.transitionEpoch = epoch;
    let restored: PlaybackFence | undefined;
    try {
      await this.queue.cancel();
      if (!this.active() || epoch !== this.startEpoch) return;
      this.startController?.abort();
      this.expanded = transition.state.local?.expanded ?? false;
      for (const effect of transition.effects) {
        if (!this.active() || epoch !== this.startEpoch) return;
        const fence = this.fence();
        if (effect.kind === 'restore') {
          const saved = this.bookmarks.get(effect.playback.fence.sessionId);
          if (!saved?.queueId || !saved.entryId) throw new Error('Playback bookmark is unavailable.');
          this.entry = saved.entry; this.subject = saved.subject; this.expanded = false;
          // Root owns the canonical method: it starts the actual saved entry/session paused.
          await this.queue.restorePaused(saved.queueId, saved.entryId, effect.playback.positionSeconds);
          if (this.active() && epoch === this.startEpoch) { this.playback.pause(); restored = this.fence(); }
        } else if (fence && sameFence(fence, effect.playback.fence)) {
          this.remember(effect.playback);
          if (effect.kind === 'pause') this.playback.pause();
          else { this.playback.leave(); this.coordinator.reconsiderEngine(); }
        }
      }
    } finally {
      if (this.transitionEpoch === epoch) { this.transitionEpoch = undefined; this.changed(); }
    }
    return restored && epoch === this.startEpoch ? {fence: restored, epoch} : undefined;
  };

  /** The native surface is an exclusive attachment; a second mounted Surface is rejected. */
  attachSurface(owner: object): () => void {
    if (this.surfaceOwner && this.surfaceOwner !== owner) throw new Error('Playback surface is already mounted.');
    this.surfaceOwner = owner; this.connect();
    return () => { if (this.surfaceOwner === owner) { this.surfaceOwner = undefined; queueMicrotask(() => { if (!this.surfaceOwner) this.dispose(); }); } };
  }
  dispose = (): void => {
    if (this.retired) return;
    const state = this.playback.getSnapshot();
    // An ordinary shell unmount stops its exact server session at the settled position. On an
    // authority change, no request is sent with the next viewer's credentials: the old lease
    // expires server-side, while the engine and every old request are torn down immediately.
    if (state.session && !this.playback.hasNativeOwner() && this.authorityMatches()) {
      const cleanup = new PlaybackScopeHttp(localV1Http(this.o.api), () => this.authorityMatches());
      const off = this.o.subscribeAuthority(() => { if (!this.authorityMatches()) cleanup.dispose(); });
      void new SessionsClient(cleanup, this.o.timers).stop(state.session.id, Math.max(0, Math.round(state.positionSeconds * 1000))).catch(() => {}).finally(() => { off(); cleanup.dispose(); });
    }
    this.retired = true; ++this.startEpoch; ++this.sourceEpoch;
    this.startController?.abort(); this.sourceController?.abort(); this.http.dispose(); this.clearCompletion();
    const identity = this.snapshot.fence?.playback; if (identity) this.choices.stop(identity); this.skipped.clear();
    if (this.routeRecovery) clearTimeout(this.routeRecovery);
    this.subtitleOff?.(); this.subtitleService?.stop(); this.subtitleService = undefined;
    this.detail?.dispose(); this.detail = undefined;
    for (const off of this.offs.splice(0).reverse()) off();
    this.coordinator.stop(); this.queue.dispose(); this.playback.leave(); this.path.dispose();
    void this.o.nativeListening?.detach(true).catch(() => {});
    this.o.disposeCapabilities();
    this.dock.reset(this.scope); this.bookmarks.clear(); this.entry = undefined; this.subject = undefined; this.options = undefined;
    this.publish(); this.listeners.clear();
  };
}
