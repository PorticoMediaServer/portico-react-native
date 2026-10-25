import {NativeModules} from 'react-native';
import {PlaybackService, type PlaybackSession} from '../../../../../packages/client-core/src/index';
import {DetailService, type DetailProjection} from '../../../../../packages/client-core/src/detail';
import type {ContentEntry} from '../../../../../packages/client-core/src/library-content';
import type {WholeGroupQuery} from '../../../../../packages/client-core/src/presentation/browse-groups';
import {parseMediaItem} from '../../../../../packages/client-core/src/media-item';
import {encodedRoutePath, routePath} from '../../../../../packages/contracts/src/routes';
import {SessionsClient} from '../../../../../packages/client-core/src/playback-v1/sessions';
import {localV1Http} from '../../../../../packages/client-core/src/playback-v1/local-http';
import {call, type V1Request, type V1Response} from '../../../../../packages/client-core/src/playback-v1/http';
import {PlaybackOptionsClient} from '../../../../../packages/client-core/src/playback-v1/options';
import {V1QueuePlayer, serverSupportsQueueTransitions} from '../../../../../packages/client-core/src/playback-v1/v1-queue-player';
import {QueueClient} from '../../../../../packages/client-core/src/playback-v1/queue';
import {V1ChannelControl, serverSupportsV1Channels} from '../../../../../packages/client-core/src/playback-v1/channel-control';
import {channelSeconds, type ChannelReference} from '../../../../../packages/client-core/src/playback/linear-protocol';
import {fetchGuideSourceSummaries} from '../../../../../packages/client-core/src/guide/directory';
import type {HomeChannel} from '../../../../../packages/client-core/src/home';
import type {HomeSelectionPlaybackPort, HomeSelectionPlaybackRequest} from '../../../../../packages/client-core/src/home-selection/types';
import type {SelectionContext} from '../../../../../packages/client-core/src/selection-model/index';
import {obj, parseQueue, parseSession, type Session, type PlaybackOptions, type QueueHeader} from '../../../../../packages/client-core/src/playback-v1/types';
import type {PlaybackChoices} from '../../../../../packages/client-core/src/playback-v1/choices';
import type {SegmentInput} from '../../../../../packages/client-core/src/playback-v1/queue';
import {qualityOptionRequest, type QualityOption} from '../../../../../packages/client-core/src/playback-v1/quality';
import {SubtitleService} from '../../../../../packages/client-core/src/subtitles';
import {forcedChoiceOf, parseSubtitleLines} from '../../../../../packages/client-core/src/subtitle-originals';
import {forcedImageLinesPath} from './forced-image';
import type {PlaybackSubject, CardSubject} from '../../../../../packages/client-core/src/presentation/kit-model';
import {serviceText} from '../../../../../packages/client-core/src/presentation/service-text';
import {PlaybackDock, PlayerSessionChoices, activeSegment, skipsAutomatically, skipTarget, parseQueueSnapshot, playbackFence, sameFence, sameScope, type ChannelPlaybackFence, type QueuePlaybackFence, type DockPlayback, type DockTransition, type PlaybackFence, type QueueScope, type SegmentMarker, type RemoteDock} from '../../../../../packages/player-core/src';
import {NativePlaybackCoordinator, type NativeBinding} from './NativePlaybackCoordinator';
import {nativeExternalPresentationBinding, sameNativePresentation} from './external-presentation';
import {NativePlayback, automaticSteps} from './native-playback';
import {PlaybackScopeHttp} from './scope-http';
import {NativeOfflinePlayback, type NativeOfflineSource} from './offline-playback';
import type {OfflineEntry} from '../../../platform/offline-downloads';
import {captionStyle} from './caption-style';
import {boundSubtitleControls, type NativePlaybackSubtitleControls} from './subtitle-controls';
import {uploadPickedSubtitle} from './subtitle-file-upload';
import {deviceDrawnTrack, engineSubtitleRender, externalSubtitlePreparation, fontsUrlOf, linesUrlOf, parseSubtitleFonts, type SubtitleFonts} from './engine-media';
import {classifyPlaybackFailure} from './playback-failure';
import {nativeListeningFor, serverPlaybackV1Kinds} from './native-listening-kinds';
import {selectionSegments, selectionStartSeconds} from './selection';
import type {VideoSnapshotCapture, VideoSnapshotSource} from '../video-snapshot';
import type {NativeExternalPresentationLifetime, NativePlaybackReadLifetime, NativeOfflinePlaybackLifetime, NativePlaybackStart, NativePlaybackChannelStart, NativePlaybackVersionSelection, NativePlaybackRuntimeOptions, NativePlaybackRuntimeSnapshot, NativePlaybackVideoSnapshot, PlaybackAuthority} from './types';

const authorityKey = (value: PlaybackAuthority) => JSON.stringify([value.serverId, value.accountId, value.profileId, value.epoch, value.viewerFence]);
const wireId = (value: unknown): value is string => typeof value === 'string' && /^[A-Za-z0-9_.-]{1,128}$/.test(value);
const audioKind = (kind: string | undefined) => kind === 'song' || kind === 'track' || kind === 'audiobook_file' || kind === 'audiobook';
const kindOf = (kind: string | undefined): 'video' | 'music' | 'audiobook' => kind === 'song' || kind === 'track' ? 'music' : kind === 'audiobook_file' || kind === 'audiobook' ? 'audiobook' : 'video';
const offlineContentKind = (kind: string | undefined) => kind === 'movie' || kind === 'episode' || kind === 'song' || kind === 'audiobook_file' ? kind : undefined;
const subjectOf = (entry: ContentEntry, detail?: DetailProjection): PlaybackSubject => {
  const item = detail?.item, episode = item?.episode;
  const card: CardSubject = {
    id: entry.id, kind: entry.kind, title: entry.title,
    artist: item?.song?.artist ?? entry.artist?.name, album: item?.song?.albumTitle ?? entry.album?.name,
    author: entry.author, durationSeconds: entry.duration,
    ...(episode ? {show: {id: episode.showId, title: episode.showTitle}, episode: episode.numbering === 'date' ? {mode: 'date' as const, day: episode.airDate} : episode.numbering === 'absolute' ? {mode: 'absolute' as const, number: episode.number} : episode.numbering === 'special' ? {mode: 'special' as const} : {mode: 'seasonal' as const, season: episode.seasonNumber ?? undefined, episode: episode.number}} : entry.episodeNumber === undefined ? {} : {episode: {mode: 'seasonal' as const, season: entry.seasonNumber, episode: entry.episodeNumber}}),
  };
  const kind = kindOf(entry.kind);
  return {kind, item: card};
};
type Bookmark = Readonly<{playback: DockPlayback; entry?: ContentEntry; subject?: PlaybackSubject; queueId?: string; entryId?: string; channel?: ChannelReference; offline?: NativeOfflineSource}>;
type SourceDetail = {
  service: DetailService; sourceEpoch: number; sourceKey: string;
  intentId: number; sessionId: string; generation: number; itemId: string; libraryId: string;
  responseFence?: string;
};

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
  private readonly sessionFamilyId: string;
  private readonly scope: QueueScope;
  private readonly http: PlaybackScopeHttp;
  private readonly optionsClient: PlaybackOptionsClient;
  private readonly offline?: NativeOfflinePlayback;
  private offlineSource?: NativeOfflineSource;
  private snapshot: NativePlaybackRuntimeSnapshot;
  private listeners = new Set<() => void>();
  private offs: (() => void)[] = [];
  private connected = false;
  private retired = false;
  private startEpoch = 0;
  private versionMenuEpoch = 0;
  private startController?: AbortController;
  private offlineLifetimeOff?: () => void;
  private selectionControllers = new Set<AbortController>();
  private enqueueTail: Promise<unknown> = Promise.resolve();
  private channelControl?: V1ChannelControl;
  private channelCleanup?: () => void;
  private channel?: HomeChannel;
  private sourceEpoch = 0;
  private sourceController?: AbortController;
  private sourceKey = '';
  private subtitleService?: SubtitleService;
  private subtitleOff?: () => void;
  private subtitleFileController?: AbortController;
  private externalPresentationBinding?: NativeBinding | null;
  private externalController?: AbortController;
  private externalEpoch = 0;
  private pictureRequests = 0;
  private pictureBinding?: NativeBinding;
  private fonts?: SubtitleFonts | 'pending';
  private fontsKey?: string;
  private forcedImage?: {fence: PlaybackFence; path: string; epoch: number; controller: AbortController; mixed?: boolean};
  private detail?: SourceDetail;
  private detailOff?: () => void;
  private entry?: ContentEntry;
  private subject?: PlaybackSubject;
  private options?: PlaybackOptions;
  private bookmarks = new Map<string, Bookmark>();
  private updating = false;
  private factDepth = 0;
  private factPublication = false;
  private preparing = false;
  private transitionEpoch?: number;
  private expanded = false;
  private expandAtStart?: number;
  private displaySubtitles = true;
  private serverKinds: readonly string[] = [];
  private transitions = false;
  private effectiveRate = 0;
  private supportedRates: readonly number[] = [];
  private surfaceOwner?: object;
  private surfaceTag?: number;
  private surfaceTagOwner?: object;
  private snapshotCapture?: VideoSnapshotCapture;
  private captureFence?: PlaybackFence;
  private captureSource?: VideoSnapshotSource;
  private captureEpoch = 0;
  private routeRecovery?: ReturnType<typeof setTimeout>;
  private recoverySince = 0;
  private completionTimer?: unknown;
  private completionKey = '';
  private skipped = new Set<string>();
  private cleanupSessions = new Set<string>();

  constructor(options: NativePlaybackRuntimeOptions) {
    this.o = options;
    this.bound = Object.freeze({...options.authority()});
    const session = options.session(), viewer = session?.viewer;
    if (!session || !viewer || !['local', 'hosted'].includes(viewer.authority) || viewer.serverId !== this.bound.serverId || viewer.accountId !== this.bound.accountId || viewer.profileId !== this.bound.profileId) throw new Error('Invalid playback authority.');
    this.sessionFamilyId = session.sessionFamilyId;
    // These are the actual controller identifiers V1QueuePlayer publishes (its constructor).
    this.scope = Object.freeze({serverId: viewer.serverId, authority: viewer.authority as 'local' | 'hosted', accountId: viewer.accountId, profileId: viewer.profileId, controllerId: 'v1', controllerEpoch: 'v1', commandLaneId: 'v1'});
    this.http = new PlaybackScopeHttp(localV1Http(options.api), () => this.currentAuthority(), (request, response) => this.retiredStart(request, response));
    this.optionsClient = new PlaybackOptionsClient(this.http);
    this.path = new NativePlayback({http: this.http, key: options.requestId, timers: options.timers});
    if (options.offlineDevice) this.offline = new NativeOfflinePlayback(options.session, options.offlineDevice);
    this.playback = new PlaybackService(this.offline?.wrap(this.path.transport) ?? this.path.transport, options.requestId, {queueRequired: true, deferRecovery: true});
    this.queue = new V1QueuePlayer({http: this.http, api: this.path.transport, playback: this.playback, viewer: this.scope, key: options.requestId, events: options.events,
      transitions: () => this.transitions, native: options.nativeListening, nativeFor: kind => nativeListeningFor(this.serverKinds)(kind),
      audiobookPreferences: () => this.o.settings().audiobook ?? {skipBackMs:15000,skipForwardMs:30000,resumeRewindMs:0},
      retainQueueIds: () => this.retainedQueueIds()});
    // Video completion remains held for the later player. Music follows the server's real policy.
    this.queue.setCompletionPolicy(({kind}) => audioKind(kind) ? 'advance' : 'hold');
    this.dock = new PlaybackDock(this.scope, this.offline?.owner());
    this.coordinator = new NativePlaybackCoordinator(this.playback, options.transport, options.requestId,
      state => {
        if (!state.session) return '';
        if (state.session.mode === 'local') {
          const url = this.offline?.mediaUrl(state.session);
          if (url) return url;
          if (state.phase !== 'error') this.playback.fail(state.intentId, serviceText('downloads.offline.notPlayableHere')); return '';
        }
        try { return options.api.mediaUrl(state.session.streamUrl); }
        catch { this.playback.fail(state.intentId, serviceText('queuePlayer.startFailed')); return ''; }
      }, fact => this.acceptFact(fact), options.engines);
    this.snapshot = this.makeSnapshot(0);
  }
  getSnapshot = () => this.snapshot;
  subscribe = (listener: () => void) => { this.listeners.add(listener); return () => { this.listeners.delete(listener); }; };
  private authorityMatches(): boolean {
    const session = this.o.session(), viewer = session?.viewer;
    return session?.sessionFamilyId === this.sessionFamilyId && authorityKey(this.o.authority()) === authorityKey(this.bound) && viewer?.serverId === this.scope?.serverId && viewer.accountId === this.scope.accountId && viewer.profileId === this.scope.profileId && viewer.authority === this.scope.authority;
  }
  private retiredStart(request: V1Request, response: V1Response): void {
    if (request.method !== 'POST' || ![200, 201].includes(response.status) || !this.authorityMatches()) return;
    let session: Session;
    if (request.path === routePath('create_queue')) {
      // A combined queue create can also return a real session after its caller
      // retires. Scope HTTP rejects that response before the core can abandon it.
      if (!obj(request.body) || request.body.owner !== 'device' || !obj(request.body.startPlayback) || !obj(response.body)) return;
      try {
        const queue = parseQueue(response.body.queue);
        session = parseSession(response.body.session);
        if (session.role !== 'local' || session.queue?.queueId !== queue.id || !queue.current || session.queue.entryId !== queue.current.entryId) return;
      } catch {return;}
    } else if (request.path === routePath('start_playback_session')) {
      try {session = parseSession(response.body);} catch {return;}
      const body = request.body as {itemId?: unknown; queue?: {queueId?: unknown; entryId?: unknown}} | undefined;
      if (!body || !body.queue && typeof body.itemId !== 'string') return;
      if (body.queue ? session.queue?.queueId !== body.queue.queueId || session.queue?.entryId !== body.queue.entryId : session.itemId !== body.itemId) return;
    } else return;
    if (this.playback.getSnapshot().session?.id === session.id) return;
    this.stopOwnedSession(session.id);
  }
  private stopOwnedSession(id: string, positionMs?: number): void {
    if (!this.authorityMatches() || this.cleanupSessions.has(id)) return;
    this.cleanupSessions.add(id);
    while (this.cleanupSessions.size > 32) this.cleanupSessions.delete(this.cleanupSessions.values().next().value!);
    const cleanup = new PlaybackScopeHttp(localV1Http(this.o.api), () => this.authorityMatches());
    const off = this.o.subscribeAuthority(() => { if (!this.authorityMatches()) cleanup.dispose(); });
    void new SessionsClient(cleanup, this.o.timers).stop(id, positionMs).catch(() => {}).finally(() => { off(); cleanup.dispose(); });
  }
  private currentAuthority(): boolean { return !this.retired && this.authorityMatches(); }
  private active(): boolean { if (!this.currentAuthority()) { this.dispose(); return false; } return true; }
  private matches(fence: PlaybackFence): boolean {
    if (!this.active() || !this.snapshot.fence || !sameFence(this.snapshot.fence, fence)) return false;
    const live = fence.kind === 'local' ? this.fence() : fence;
    return !!live && sameFence(live, fence);
  }
  private request = async <T>(path: string, method = 'GET', body?: unknown, signal?: AbortSignal): Promise<T> => {
    if (!['GET', 'POST', 'PUT', 'PATCH', 'DELETE'].includes(method)) throw new Error('Invalid playback request method.');
    return (await call(this.http, {path, method: method as V1Request['method'], body, signal})).body as T;
  };

  connect(): void {
    if (this.connected || !this.active()) return;
    this.connected = true;
    this.offs.push(this.path.bind(this.playback, () => this.queue));
    this.offs.push(this.playback.subscribe(() => this.changed()));
    if (this.o.offlineDevice) this.offs.push(this.o.offlineDevice.subscribe(() => {if (this.active()) this.changed();}));
    this.offs.push(this.queue.subscribe(() => this.changed()));
    this.offs.push(this.path.subscribeSessions(() => this.changed()));
    this.offs.push(this.queue.connect());
    this.offs.push(this.coordinator.subscribe(() => { if (this.captureSource && !this.isSnapshotSourceCurrent(this.captureSource)) this.cancelSnapshot(); this.publish(); }));
    this.offs.push(this.o.subscribeAuthority(() => { if (!this.active()) return; void this.refreshAuthority(); }));
    // X-02: the profile's Sound settings are what the listening engine renders with, so the
    // same adopt path the web player uses runs here on start and on every settings change.
    const adoptAudioEffects = () => {
      const effects = this.o.settings().audioEffects;
      if (!effects) return;
      this.playback.adoptAudioEffectsPreference(effects);
      // The engine's own rate matcher, when this build has one. A rejected mode stays
      // unapplied: the signal path reports the observed output rate, never the setting.
      const bridge = (NativeModules as unknown as {PorticoPlaybackModule?: {setAudioSampleRateMatching?: (mode: string) => Promise<unknown>}}).PorticoPlaybackModule?.setAudioSampleRateMatching;
      if (effects.sampleRateMatching && typeof bridge === 'function')
        void Promise.resolve(bridge(effects.sampleRateMatching)).catch(error => {if (__DEV__) console.warn('[audio-sample-rate]', error);});
    };
    adoptAudioEffects();
    this.offs.push(this.o.subscribeSettings(() => { if (this.active()) { adoptAudioEffects(); this.queue.listening.refreshAudiobookPreferences(); this.applyOptions(); this.coordinator.reconsiderEngine(); this.publish(); } }));
    this.offs.push(this.choices.subscribe(() => {
      // Source binding resets these choices while changed() is still selecting
      // the next source. That path applies once after the new source is ready.
      if (this.updating || this.transitionEpoch !== undefined || !this.active()) return;
      this.applyOptions(); this.publish();
    }));
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
    if (route && route.phase !== 'ready') {this.cancelSnapshot(); this.externalPresentationBinding = null; this.pictureBinding = undefined; this.externalController?.abort();}
    this.coordinator.setConnection(!route || route.phase === 'ready');
    if (route && route.phase !== 'ready') this.publish();
  }
  refreshAuthority = async (): Promise<void> => {
    if (!this.active()) return;
    await this.playback.refreshPlaybackAuthority();
    if (this.active()) await this.o.nativeListening?.refresh();
    if (this.active()) await this.detail?.service.refresh();
  };
  flush = () => this.path.controller.flush();

  private beginOperation(retainScope?: AbortSignal): number {
    const epoch = ++this.startEpoch;
    this.externalController?.abort(); this.pictureBinding = undefined;
    this.offlineLifetimeOff?.(); this.offlineLifetimeOff = undefined;
    this.startController?.abort();
    for (const controller of [...this.selectionControllers]) {
      if (controller.signal === retainScope) continue;
      this.selectionControllers.delete(controller);
      controller.abort();
    }
    this.channelControl?.close(); this.channelControl = undefined;
    this.channelCleanup?.(); this.channelCleanup = undefined;
    this.channel = undefined;
    this.transitionEpoch = undefined; this.preparing = false;
    this.expandAtStart = undefined;
    return epoch;
  }

  /** The same exact Home document/route guard is supplied to its selection controller. */
  selectionPlayback = (isCurrent: (context: SelectionContext) => boolean): HomeSelectionPlaybackPort => ({
    play: request => this.playSelection(request, isCurrent),
    enqueue: request => {
      const epoch = this.startEpoch, source = this.sourceEpoch;
      const result = this.enqueueTail.then(() => this.enqueueSelection(request, isCurrent, epoch, source));
      this.enqueueTail = result.catch(() => {});
      return result;
    },
    playChannel: (channel, context, signal) => this.playChannel(channel, context, signal, isCurrent),
  });
  private selectionCurrent(context: SelectionContext, signal: AbortSignal, current: (context: SelectionContext) => boolean): boolean {
    const scope = context.scope;
    return !signal.aborted && this.currentAuthority() && scope.serverId === this.scope.serverId && scope.authority === this.scope.authority && scope.accountId === this.scope.accountId && scope.profileId === this.scope.profileId && scope.privacyFence === this.bound.viewerFence && current(context);
  }
  private assertSelection(context: SelectionContext, signal: AbortSignal, current: (context: SelectionContext) => boolean): void {
    if (!this.selectionCurrent(context, signal, current)) throw new Error(signal.aborted ? 'cancelled' : 'stale_selection_context');
  }
  private selectionScope(signal: AbortSignal, current: () => boolean) {
    const controller = new AbortController();
    const abort = () => controller.abort();
    signal.addEventListener('abort', abort, {once: true}); if (signal.aborted) abort();
    this.selectionControllers.add(controller);
    const unguard = this.http.guard(controller.signal, current);
    return {signal: controller.signal, close: () => { unguard(); signal.removeEventListener('abort', abort); this.selectionControllers.delete(controller); controller.abort(); }};
  }
  private rememberCurrent(): void {
    const old = this.dock.getSnapshot().local;
    if (!old) return;
    this.remember(old);
    if (this.snapshot.fence && sameFence(old.fence, this.snapshot.fence)) this.playback.pause();
  }
  private async playSelection(request: HomeSelectionPlaybackRequest, current: (context: SelectionContext) => boolean) {
    this.assertSelection(request.context, request.signal, current);
    const segments = selectionSegments(request.items, true), epoch = this.beginOperation();
    const valid = () => epoch === this.startEpoch && this.selectionCurrent(request.context, request.signal, current);
    const scoped = this.selectionScope(request.signal, valid);
    try {
      this.connect();
      await this.queue.cancel();
      this.assertSelection(request.context, scoped.signal, current); if (!valid()) throw new Error('stale_selection_context');
      await this.o.capabilitiesReady();
      this.assertSelection(request.context, scoped.signal, current); if (!valid()) throw new Error('stale_selection_context');
      const capabilities = await this.request<unknown>(routePath('get_capabilities'), 'GET', undefined, scoped.signal);
      if (!valid()) throw new Error('stale_selection_context');
      this.serverKinds = serverPlaybackV1Kinds(capabilities); this.transitions = serverSupportsQueueTransitions(capabilities);
      this.rememberCurrent();
      const first = request.items[0]!;
      this.entry = 'entry' in first && first.entry.id === first.target.itemId ? first.entry : undefined;
      this.subject = this.entry ? subjectOf(this.entry) : undefined; this.options = undefined;
      this.expanded = this.entry ? !audioKind(this.entry.kind) : true;
      this.expandAtStart = epoch;
      this.preparing = true;
      // Only the canonical core owns the create/adopt path and its pre-adoption context fence.
      const queue = await this.queue.playSegments(segments, {startSeconds: selectionStartSeconds(request.items), signal: scoped.signal, isCurrent: valid});
      if (!valid()) throw new Error('stale_selection_context');
      return {queue};
    } catch (error) {
      if (epoch === this.startEpoch && this.currentAuthority()) { await this.queue.cancel(); this.playback.leave(); this.changed(); }
      throw error;
    } finally {
      scoped.close();
      if (epoch === this.startEpoch) { this.preparing = false; this.changed(); }
    }
  }
  private async enqueueSelection(request: HomeSelectionPlaybackRequest & {placement: 'next' | 'end'}, current: (context: SelectionContext) => boolean, epoch: number, source: number) {
    this.assertSelection(request.context, request.signal, current);
    if (request.placement !== 'next' && request.placement !== 'end') throw new Error('invalid_queue_placement');
    const segments = selectionSegments(request.items, false);
    const valid = () => epoch === this.startEpoch && source === this.sourceEpoch && this.selectionCurrent(request.context, request.signal, current);
    if (!valid()) throw new Error('stale_selection_context');
    const scoped = this.selectionScope(request.signal, valid);
    const client = new QueueClient({send: request => this.http.send({...request, signal: scoped.signal})}, this.o.requestId);
    const check = () => { if (!valid()) throw new Error('stale_selection_context'); };
    try {
      this.connect(); check();
      const held = this.queue.getSnapshot().view?.queue;
      if (!held) {
        const created = await client.create(segments, {signal: scoped.signal, retainQueueIds: this.retainedQueueIds()}); check();
        await this.queue.open(created.queue.id, scoped.signal); check();
        this.changed(); return {queue: created.queue};
      }
      let queue = await client.header(held.id, scoped.signal); check();
      const ordered = request.placement === 'next' ? [...segments].reverse() : segments;
      for (const segment of ordered) {
        check(); queue = (await client.addSegment(queue.id, queue.revision, request.placement, segment)).queue; check();
      }
      await this.queue.refresh(scoped.signal); check();
      this.changed(); return {queue};
    } finally { scoped.close(); }
  }

  private async playChannel(channel: HomeChannel, context: SelectionContext, signal: AbortSignal, current: (context: SelectionContext) => boolean): Promise<void> {
    this.assertSelection(context, signal, current);
    const value = channel.channel, source = channel.source;
    if (!value.tuneAvailable || value.tuneUnavailableReason || value.hidden || value.sourceId !== source.id || value.generation !== source.generation || value.provenance !== source.provenance || !['live-source', 'library-channel'].includes(value.provenance) || !wireId(source.generation) || !wireId(source.id) || !wireId(value.id) || value.provenance === 'library-channel' && source.id !== value.id) throw new Error('invalid_channel_target');
    const epoch = this.beginOperation();
    const valid = () => epoch === this.startEpoch && this.selectionCurrent(context, signal, current);
    const scoped = this.selectionScope(signal, valid);
    try {
      this.connect(); await this.queue.cancel();
      if (!valid()) throw new Error('stale_selection_context');
      await this.o.capabilitiesReady();
      if (!valid()) throw new Error('stale_selection_context');
      const capabilities = await this.request<unknown>(routePath('get_capabilities'), 'GET', undefined, scoped.signal);
      if (!valid()) throw new Error('stale_selection_context');
      if (!serverSupportsV1Channels(capabilities)) throw new Error('channel_playback_unavailable');
      this.rememberCurrent(); this.channel = channel; this.expanded = true;
      await this.openChannel({kind: value.provenance, sourceId: source.id, channelId: value.id, generation: value.generation}, epoch, scoped.signal, valid, 'playing');
      this.changed();
    } catch (error) {
      if (epoch === this.startEpoch && this.currentAuthority()) { this.playback.leave(); this.changed(); }
      throw error;
    } finally { scoped.close(); }
  }

  /** Route/Guide playback uses the same installed channel owner. The source's
   * generation/provenance is re-read; only the real channel POST grants tuning. */
  startChannel = async (input: NativePlaybackChannelStart): Promise<void> => {
    if (!wireId(input.sourceId) || !wireId(input.channelId) || !input.timezone || input.lifetime.signal.aborted || !input.lifetime.isCurrent() || !this.currentAuthority()) return;
    const epoch = this.beginOperation();
    const current = () => this.currentAuthority() && epoch === this.startEpoch && !input.lifetime.signal.aborted && input.lifetime.isCurrent();
    const scoped = this.selectionScope(input.lifetime.signal, current);
    try {
      this.connect(); await this.queue.cancel(); if (!current()) return;
      await this.o.capabilitiesReady(); if (!current()) return;
      const [capabilities, directory] = await Promise.all([
        this.request<unknown>(routePath('get_capabilities'), 'GET', undefined, scoped.signal),
        fetchGuideSourceSummaries({request: (path, method, body, signal) => this.request(path, method, body, signal)}, this.bound.serverId, input.timezone, scoped.signal),
      ]);
      if (!current()) return;
      if (!serverSupportsV1Channels(capabilities)) throw new Error('channel_playback_unavailable');
      const sources = directory.sources.filter(source => source.id === input.sourceId);
      if (sources.length !== 1 || !wireId(sources[0]!.generation)) throw new Error('channel_source_unavailable');
      const source = sources[0]!;
      if (source.provenance === 'library-channel' && input.sourceId !== input.channelId) throw new Error('invalid_channel_target');
      this.rememberCurrent(); this.channel = undefined; this.expanded = true;
      await this.openChannel({kind: source.provenance, sourceId: source.id, channelId: input.channelId, generation: source.generation}, epoch, scoped.signal, current, 'playing');
      if (current()) this.changed();
    } catch (error) {
      if (current()) {this.playback.leave(); this.changed(); throw error;}
    } finally {scoped.close();}
  };

  private async openChannel(reference: ChannelReference, epoch: number, signal: AbortSignal, beforeAdoption: () => boolean, state: 'playing' | 'paused'): Promise<void> {
    let adopted = false, opening = false;
    const valid = () => epoch === this.startEpoch && this.currentAuthority() && (adopted || !signal.aborted && beforeAdoption());
    const scoped = this.selectionScope(signal, valid);
    let control: V1ChannelControl | undefined;
    let rejectStart: ((error: Error) => void) | undefined;
    const abort = () => { if (!adopted) { control?.close(); rejectStart?.(new Error('cancelled')); } };
    signal.addEventListener('abort', abort, {once: true});
    const close = () => { signal.removeEventListener('abort', abort); control?.close(); scoped.close(); rejectStart?.(new Error('stale_selection_context')); rejectStart = undefined; };
    try {
      // DELETE cleanup stays bound to its original authority after a Home context expires.
      control = new V1ChannelControl({key: this.o.requestId, http: {send: async request => {
        if (request.method === 'DELETE') return this.http.send(request);
        if (!valid()) { control?.close(); throw new Error('stale_selection_context'); }
        const response = await this.http.send(adopted ? request : {...request, signal: scoped.signal});
        if (!valid()) control?.close();
        return response;
      }}});
      const channelControl = control;
      this.playback.useChannelPlayback({
        open: async (reference, sink, options) => {
          opening = true;
          // open() can return before its ordered join seek. Await the service's real session.
          let resolveStart!: () => void;
          const joined = new Promise<void>((resolve, reject) => { resolveStart = resolve; rejectStart = reject; });
          void joined.catch(() => {});
          await channelControl.open(reference, {
            state: value => {
              if (!valid()) { close(); return; }
              sink.state(value);
              if (!adopted && this.playback.getSnapshot().session?.id === value.playbackId) {
                adopted = true; scoped.close(); signal.removeEventListener('abort', abort); rejectStart = undefined; resolveStart();
              }
            },
            error: (message, terminal) => { if (valid()) sink.error(message, terminal); if (!adopted) { rejectStart?.(new Error('channel_playback_failed')); rejectStart = undefined; } },
          }, options);
          await joined;
        },
        recover: () => channelControl.recover(), pause: () => channelControl.pause(), resume: () => channelControl.resume(),
        seek: seconds => channelControl.seek(seconds), goLive: () => channelControl.goLive(), retry: () => channelControl.retry(),
        observe: (seconds, seekId, errorCode) => channelControl.observe(seconds, seekId, errorCode),
        close: () => { if (opening) close(); else channelControl.close(); },
      });
      this.channelControl = control; this.channelCleanup = close;
      this.entry = undefined; this.subject = undefined; this.options = undefined;
      await this.playback.playChannel(reference, {state});
      if (!valid()) throw new Error('stale_selection_context');
      if (this.playback.getSnapshot().phase === 'error' || !this.playback.getSnapshot().session) throw new Error('channel_playback_failed');
    } catch (error) { close(); throw error; }
  }

  start = async (input: NativePlaybackStart): Promise<void> => {
    const caller = input.lifetime;
    const callerCurrent = () => !caller?.signal.aborted && caller?.isCurrent() !== false;
    if (!callerCurrent()) return;
    this.connect();
    if (!this.active()) return;
    if (!wireId(input.target.itemId) || input.target.startSeconds !== undefined && (!Number.isFinite(input.target.startSeconds) || input.target.startSeconds < 0)) throw new Error('Invalid playback target.');
    const epoch = this.beginOperation();
    const controller = new AbortController(); this.startController = controller;
    const abort = () => controller.abort();
    caller?.signal.addEventListener('abort', abort, {once: true});
    if (caller?.signal.aborted) abort();
    const current = () => this.active() && epoch === this.startEpoch && !controller.signal.aborted && callerCurrent();
    const scoped = this.selectionScope(controller.signal, current);
    try {
      await this.queue.cancel(); if (!current()) return;
      await this.o.capabilitiesReady(); if (!current()) return;
      const [offered, capabilities] = await Promise.all([
        this.optionsClient.options(input.target.itemId, {}, scoped.signal),
        this.request<unknown>(routePath('get_capabilities'), 'GET', undefined, scoped.signal),
      ]);
      if (!current()) return;
      await this.startOffered(input, offered, capabilities, epoch, undefined, {signal: scoped.signal, isCurrent: current});
    } catch (error) {if (current()) throw error;}
    finally {
      caller?.signal.removeEventListener('abort', abort); scoped.close();
      if (this.startController === controller) this.startController = undefined;
    }
  };

  /** Opens the actual verified device file through this same player. No server
   * options, queue creation or source URL is supplied by the screen. */
  startOffline = async (entry: OfflineEntry, lifetime: NativeOfflinePlaybackLifetime): Promise<void> => {
    const admitted = () => !lifetime.signal.aborted && this.currentAuthority() && lifetime.isCurrent();
    const retired = () => Object.assign(new Error('cancelled'), {name: 'AbortError'});
    if (!admitted()) throw retired();
    if (!this.offline) throw new Error(serviceText('downloads.offline.notPlayableHere'));
    const epoch = this.beginOperation(), controller = new AbortController(); this.startController = controller;
    const abort = () => controller.abort();
    lifetime.signal.addEventListener('abort', abort, {once: true});
    const unfollow = () => lifetime.signal.removeEventListener('abort', abort); this.offlineLifetimeOff = unfollow;
    const current = () => epoch === this.startEpoch && !controller.signal.aborted && admitted();
    const scoped = this.selectionScope(controller.signal, current);
    let accepted = false;
    try {
      const source = await this.offline.prepare(entry, current);
      if (!current()) throw retired();
      if (!offlineContentKind(source.metadata.kind)) throw new Error(serviceText('downloads.offline.notPlayableHere'));
      this.rememberCurrent(); await this.queue.cancel();
      if (!current() || !source.current()) throw retired();
      this.bindOffline(source);
      this.expanded = !audioKind(source.metadata.kind);
      this.preparing = true;
      await this.playback.playLocal(source.itemId, () => this.makeOfflineSession(source), undefined, {signal: controller.signal, isCurrent: current});
      const session = this.playback.getSnapshot().session;
      accepted = !!session && this.offlineSource === source && !!this.offline.mediaUrl(session);
      if (!accepted) {
        if (!current()) throw retired();
        throw new Error(this.playback.getSnapshot().error || serviceText('downloads.offline.notPlayableHere'));
      }
    } catch (error) {
      if (!current()) throw retired();
      throw error;
    } finally {
      scoped.close();
      if (!accepted) {unfollow(); controller.abort(); if (this.offlineLifetimeOff === unfollow) this.offlineLifetimeOff = undefined;}
      if (epoch === this.startEpoch) {this.preparing = false; this.changed();}
    }
  };

  private bindOffline(source: NativeOfflineSource): void {
    const contentKind = offlineContentKind(source.metadata.kind);
    if (!contentKind) throw new Error(serviceText('downloads.offline.notPlayableHere'));
    this.offlineSource = source; this.entry = undefined; this.options = undefined;
    this.subject = {kind: kindOf(contentKind), item: {id: source.itemId, title: source.metadata.title, kind: contentKind}};
  }

  private makeOfflineSession(source: NativeOfflineSource): PlaybackSession {
    const session = source.session();
    // The real service has already assigned this play's run. Validate and bind
    // the full local identity before its session can reach the native engine.
    if (!this.offline?.fence(session, this.playback.getSnapshot().playbackRun)) throw new Error(serviceText('downloads.offline.notPlayableHere'));
    return session;
  }

  private readonly cataloguePort = Object.freeze({
    playSegments: (segments: readonly SegmentInput[], options: NonNullable<Parameters<V1QueuePlayer['playSegments']>[1]> = {}) => {
      // P0-PHONE-ALBUM-PLAYBACK proof: temporary __DEV__-only, sanitized call arguments
      // (container kind/id and order only). Removed after the proof run.
      if (__DEV__) console.log('[P0-ALBUM-PROOF]', new Date().toISOString(), JSON.stringify(segments.map(segment => ({
        source: {container: 'container' in segment.source ? {kind: segment.source.container.kind, id: segment.source.container.id} : null},
        order: segment.order ? {mode: segment.order.mode, ...(segment.order.mode === 'shuffle' && segment.order.seed ? {seed: segment.order.seed} : {})} : null,
      }))));
      return this.playCatalogueSegments(segments, options);
    },
    enqueueSegments: (segments: readonly SegmentInput[], placement: 'next' | 'end', lifetime: Readonly<{signal: AbortSignal; isCurrent: () => boolean}>) => {
      // Capture the queue/source epochs before waiting behind another append: a call queued
      // for queue A must never adopt a source B that replaced it while it waited.
      const epoch = this.startEpoch, source = this.sourceEpoch;
      const result = this.enqueueTail.then(() => this.enqueueCatalogueSegments(segments, placement, lifetime, epoch, source));
      this.enqueueTail = result.catch(() => {});
      return result;
    },
  });
  /** Borrow the genuine authority-local player. This port has no Home context,
   * selection membership, page expansion or independent queue/session store. */
  cataloguePlayback = () => this.cataloguePort;

  private async playCatalogueSegments(segments: readonly SegmentInput[], options: NonNullable<Parameters<V1QueuePlayer['playSegments']>[1]>): Promise<QueueHeader> {
    const {signal, isCurrent} = options;
    if (!signal || !isCurrent) throw new Error('native_catalogue_lifetime_required');
    if (!segments.length || options.startSeconds !== undefined && (!Number.isFinite(options.startSeconds) || options.startSeconds < 0 || options.startSeconds > 1e9)) throw new Error('native_catalogue_selection_invalid');
    const admitted = () => !signal.aborted && this.currentAuthority() && isCurrent();
    const retired = () => Object.assign(new Error('native_catalogue_retired'), {name: 'AbortError'});
    if (!admitted()) throw retired();
    const epoch = this.beginOperation(), valid = () => epoch === this.startEpoch && admitted();
    const scoped = this.selectionScope(signal, valid);
    const assertCurrent = () => {if (!valid()) throw retired();};
    try {
      this.connect();
      await this.queue.cancel(); assertCurrent();
      await this.o.capabilitiesReady(); assertCurrent();
      const capabilities = await this.request<unknown>(routePath('get_capabilities'), 'GET', undefined, scoped.signal); assertCurrent();
      this.serverKinds = serverPlaybackV1Kinds(capabilities); this.transitions = serverSupportsQueueTransitions(capabilities);
      this.rememberCurrent(); assertCurrent();
      this.entry = undefined; this.subject = undefined; this.options = undefined;
      this.expanded = true; this.expandAtStart = epoch; this.preparing = true;
      const queue = await this.queue.playSegments(segments, {...options, signal: scoped.signal, isCurrent: valid});
      assertCurrent(); return queue;
    } catch (error) {
      if (epoch === this.startEpoch && this.currentAuthority()) {await this.queue.cancel(); this.playback.leave(); this.changed();}
      throw error;
    } finally {
      scoped.close();
      if (epoch === this.startEpoch) {this.preparing = false; this.changed();}
    }
  }

  /** Append segments to the same queue this runtime already plays. The caller's
   * group/follower authority decides whether the append is offered; the queue,
   * CAS and adoption stay here and in the one queue owner. */
  private async enqueueCatalogueSegments(segments: readonly SegmentInput[], placement: 'next' | 'end',
    lifetime: Readonly<{signal: AbortSignal; isCurrent: () => boolean}>, epoch: number, source: number): Promise<QueueHeader> {
    const admitted = () => !lifetime.signal.aborted && this.currentAuthority() && lifetime.isCurrent();
    const retired = () => Object.assign(new Error('native_catalogue_retired'), {name: 'AbortError'});
    if (!admitted() || !segments.length) throw retired();
    if (placement !== 'next' && placement !== 'end') throw Object.assign(new Error('native_catalogue_placement_invalid'), {code: 'invalid_queue_placement'});
    const valid = () => epoch === this.startEpoch && source === this.sourceEpoch && admitted();
    if (!valid()) throw retired();
    const scoped = this.selectionScope(lifetime.signal, valid);
    const client = new QueueClient({send: request => this.http.send({...request, signal: scoped.signal})}, this.o.requestId);
    const check = () => {if (!valid()) throw retired();};
    try {
      this.connect(); check();
      const held = this.queue.getSnapshot().view?.queue;
      if (!held) {
        check();
        const created = await client.create(segments, {signal: scoped.signal, retainQueueIds: this.retainedQueueIds()}); check();
        await this.queue.open(created.queue.id, scoped.signal); check();
        this.changed(); return created.queue;
      }
      let queue = await client.header(held.id, scoped.signal); check();
      const ordered = placement === 'next' ? [...segments].reverse() : segments;
      for (const segment of ordered) {check(); queue = (await client.addSegment(queue.id, queue.revision, placement, segment)).queue; check();}
      await this.queue.refresh(scoped.signal); check(); this.changed(); return queue;
    } finally {scoped.close();}
  }

  /** Play the server-owned whole group, never the screen's loaded preview.
   * The caller supplies its genuine route/member lifetime through adoption. */
  startGroup = async (input: Readonly<{query: WholeGroupQuery; shuffle: boolean; signal: AbortSignal; isCurrent: () => boolean}>): Promise<void> => {
    const admitted = () => !input.signal.aborted && this.currentAuthority() && input.isCurrent();
    if (!admitted()) throw Object.assign(new Error('native_group_retired'), {name: 'AbortError'});
    const epoch = this.beginOperation(), valid = () => epoch === this.startEpoch && admitted();
    const scoped = this.selectionScope(input.signal, valid);
    const assertCurrent = () => {if (!valid()) throw Object.assign(new Error('native_group_retired'), {name: 'AbortError'});};
    try {
      this.connect();
      await this.queue.cancel(); assertCurrent();
      await this.o.capabilitiesReady(); assertCurrent();
      const capabilities = await this.request<unknown>(routePath('get_capabilities'), 'GET', undefined, scoped.signal); assertCurrent();
      this.serverKinds = serverPlaybackV1Kinds(capabilities); this.transitions = serverSupportsQueueTransitions(capabilities);
      this.rememberCurrent(); assertCurrent();
      this.entry = undefined; this.subject = undefined; this.options = undefined;
      this.expanded = true; this.expandAtStart = epoch; this.preparing = true;
      await this.queue.playSegments([{source: {query: input.query}, ...(input.shuffle ? {order: {mode: 'shuffle' as const}} : {})}], {signal: scoped.signal, isCurrent: valid});
      assertCurrent();
    } catch (error) {
      if (epoch === this.startEpoch && this.currentAuthority()) {await this.queue.cancel(); this.playback.leave(); this.changed();}
      throw error;
    } finally {
      scoped.close();
      if (epoch === this.startEpoch) {this.preparing = false; this.changed();}
    }
  };

  /** A menu cannot start a version from another authority or replace a newer source. Its
   * cached options prove what was drawn; a fresh scoped read proves it is still offered. */
  startVersion = async (input: NativePlaybackStart, selection: NativePlaybackVersionSelection): Promise<void> => {
    this.connect();
    if (!this.active()) return;
    let epoch = this.startEpoch;
    const menu = ++this.versionMenuEpoch, lifetime = selection.lifetime;
    const authority = authorityKey(selection.authority), expected = selection.expectedFence ? playbackFence(selection.expectedFence) : undefined;
    const versionId = selection.versionId;
    const sameSource = () => expected ? sameFence(this.snapshot.fence, expected) : this.snapshot.fence === undefined;
    // A captured output belongs to preflight. Once this command owns the queue intent,
    // the core's generation/adoption guard must allow its own newly accepted output.
    let dispatching = false;
    const current = () => !lifetime.signal.aborted && lifetime.isCurrent() && this.currentAuthority() && epoch === this.startEpoch && menu === this.versionMenuEpoch && authority === authorityKey(this.bound) && (dispatching || sameSource());
    if (!current()) return;
    if (!wireId(input.target.itemId) || !wireId(versionId) || selection.options.itemId !== input.target.itemId || selection.options.versions.filter(value => value.id === versionId).length !== 1) throw new Error(serviceText('queuePlayer.unsupported'));
    const scoped = this.selectionScope(lifetime.signal, current);
    try {
      await this.o.capabilitiesReady();
      if (!current()) return;
      const [offered, capabilities] = await Promise.all([
        this.optionsClient.options(input.target.itemId, {}, scoped.signal),
        this.request<unknown>(routePath('get_capabilities'), 'GET', undefined, scoped.signal),
      ]);
      if (!current()) return;
      if (offered.itemId !== input.target.itemId || offered.versions.filter(value => value.id === versionId).length !== 1) throw new Error(serviceText('queuePlayer.unsupported'));
      // This final read owns resume. An earlier card/menu position has no authority here.
      const positionMs = offered.resume?.positionMs ?? 0;
      if (!Number.isFinite(positionMs) || positionMs < 0) throw new Error(serviceText('queuePlayer.unsupported'));
      const fresh = {...input, target: {...input.target, startSeconds: positionMs / 1000}};
      epoch = this.beginOperation(scoped.signal);
      await this.queue.cancel();
      if (!current()) return;
      dispatching = true;
      await this.startOffered(fresh, offered, capabilities, epoch, versionId, {signal: scoped.signal, isCurrent: current});
    } catch (error) { if (!current() || scoped.signal.aborted) return; throw error; }
    finally { scoped.close(); }
  };

  private async startOffered(input: NativePlaybackStart, offered: PlaybackOptions, capabilities: unknown, epoch: number, versionId?: string, lifetime?: Readonly<{signal: AbortSignal; isCurrent: () => boolean}>): Promise<void> {
    const current = () => this.active() && epoch === this.startEpoch && !lifetime?.signal.aborted && lifetime?.isCurrent() !== false;
    if (!current()) return;
    if (offered.itemId !== input.target.itemId || !offered.versions.length) throw new Error(serviceText('queuePlayer.unsupported'));
    this.serverKinds = serverPlaybackV1Kinds(capabilities);
    this.transitions = serverSupportsQueueTransitions(capabilities);
    const old = this.dock.getSnapshot().local;
    if (old) {
      this.remember(old);
      if (this.snapshot.fence && sameFence(old.fence, this.snapshot.fence)) this.playback.pause();
    }
    if (!current()) return; // A synchronous pause subscriber may retire the chooser or start another item.
    this.preparing = true;
    this.entry = input.entry.id === input.target.itemId ? input.entry : undefined;
    this.subject = this.entry ? subjectOf(this.entry) : undefined;
    this.options = offered;
    this.expanded = !audioKind(offered.kind);
    try {
      if (!current()) return;
      await this.queue.playItem(input.target.itemId, input.target.startSeconds, undefined, undefined, undefined, versionId ? {versionId} : undefined, lifetime);
      if (epoch === this.startEpoch && this.active() && !lifetime?.signal.aborted && lifetime?.isCurrent() !== false && this.queue.getSnapshot().error) { this.playback.pause(); throw new Error(serviceText('queuePlayer.startFailed')); }
    }
    finally { if (epoch === this.startEpoch) { this.preparing = false; this.changed(); } }
  }

  /** Info reads borrow the actual queue occurrence. Unlike a replan, a read must
   * remain on the captured generation/revision and must never adopt its reply. */
  readSession = async (fence: PlaybackFence, lifetime: NativePlaybackReadLifetime): Promise<Session | undefined> => {
    if (fence.kind !== 'queue' || !this.matches(fence) || lifetime.signal.aborted || !lifetime.isCurrent()) return;
    const original = this.currentSession(), queue = this.queue.getSnapshot().view?.queue, start = this.startEpoch, route = this.o.api.getRouteSnapshot();
    if (!original || original.kind !== 'vod' || original.role !== 'local' || original.state === 'ended' || original.end || !queue || original.queue?.queueId !== queue.id
      || original.queue.entryId !== fence.entryId || original.versionId !== fence.sourceId || queue.currentEntryId !== fence.entryId
      || queue.currentPlaybackId !== original.id || route && route.phase !== 'ready') return;
    const current = () => {
      const session = this.currentSession(), live = this.fence(), heldQueue = this.queue.getSnapshot().view?.queue, liveRoute = this.o.api.getRouteSnapshot();
      return this.currentAuthority() && this.startEpoch === start && !lifetime.signal.aborted && lifetime.isCurrent()
        && !!live && sameFence(live, fence) && session?.id === original.id && session.revision === original.revision
        && heldQueue?.id === queue.id && heldQueue.revision === queue.revision && heldQueue.currentEntryId === fence.entryId
        && heldQueue.currentPlaybackId === original.id && (route ? liveRoute?.phase === 'ready' && liveRoute.revision === route.revision && liveRoute.origin === route.origin : liveRoute === null);
    };
    const scoped = this.selectionScope(lifetime.signal, current);
    const unroute = this.o.api.subscribeRoute(() => {if (!current()) scoped.close();});
    try {
      if (!current()) return;
      const fresh = await new SessionsClient(this.http, this.o.timers).get(original.id, scoped.signal);
      if (!current() || fresh.id !== original.id || fresh.revision !== original.revision || fresh.kind !== 'vod'
        || fresh.role !== original.role || fresh.state === 'ended' || fresh.end
        || fresh.itemId !== original.itemId || fresh.versionId !== original.versionId
        || fresh.presentation.generation !== fence.generation || fresh.queue?.queueId !== queue.id
        || fresh.queue.entryId !== fence.entryId) return;
      return fresh;
    } catch (error) {
      if (scoped.signal.aborted || !current()) return;
      throw error;
    } finally { unroute(); scoped.close(); }
  };

  private currentSession(): Session | undefined {
    const held = this.playback.getSnapshot().session;
    const session = held ? this.path.session(held.id) ?? this.queue.currentSession() : undefined;
    return held && session?.id === held.id && session.presentation.generation === held.generation ? session : undefined;
  }
  private detailProjection(): DetailProjection | undefined {
    const binding = this.detail, state = this.playback.getSnapshot();
    if (!binding || !this.currentAuthority() || binding.sourceEpoch !== this.sourceEpoch || binding.sourceKey !== this.sourceKey
      || state.channel || state.intentId !== binding.intentId || state.itemId !== binding.itemId
      || state.session?.id !== binding.sessionId || state.session.generation !== binding.generation
      || this.entry?.id !== binding.itemId || this.entry.libraryId !== binding.libraryId) return;
    const snapshot = binding.service.getSnapshot(), data = snapshot.data;
    if (snapshot.scope.serverId !== this.bound.serverId || snapshot.scope.viewerId !== this.bound.profileId
      || snapshot.target?.itemId !== binding.itemId || snapshot.target.libraryId !== binding.libraryId
      || data?.scope.serverId !== this.bound.serverId || data.scope.itemId !== binding.itemId || data.scope.libraryId !== binding.libraryId
      || data.item.id !== binding.itemId || data.item.libraryId !== binding.libraryId || data.scope.viewerFence !== binding.responseFence) return;
    return data;
  }
  private fence(): PlaybackFence | undefined {
    const state = this.playback.getSnapshot(), session = this.currentSession(), view = this.queue.getSnapshot().view;
    if (state.session?.mode === 'local') return this.offline?.fence(state.session, state.playbackRun);
    if (state.channel && state.session && state.session.generation > 0 && state.playbackRun > 0) {
      const reference = state.channel, common = {kind: 'channel' as const, playback: {scope: this.scope, run: state.playbackRun}, sessionId: state.session.id, generation: state.session.generation, channelId: reference.channelId, channelGeneration: reference.generation};
      return reference.kind === 'live-source'
        ? playbackFence({...common, channelKind: 'live-source', sourceId: reference.sourceId})
        : playbackFence({...common, channelKind: 'library-channel', sourceId: reference.sourceId});
    }
    if (!state.session || !state.itemId || !session?.versionId || !session.queue?.entryId || state.playbackRun < 1 || this.preparing && this.options?.itemId !== state.itemId) return undefined;
    if (view && !sameScope(view.queue.scope, this.scope)) return undefined;
    const episode = this.detailProjection()?.item.episode;
    return playbackFence({kind: 'queue', playback: {scope: this.scope, run: state.playbackRun}, sessionId: state.session.id, itemId: state.itemId,
      sourceId: session.versionId, entryId: session.queue.entryId, generation: state.session.generation,
      ...(episode?.showId ? {showId: episode.showId} : {}), ...(episode?.seasonId ? {seasonId: episode.seasonId} : {})});
  }
  private local(fence: PlaybackFence): DockPlayback {
    const state = this.playback.getSnapshot(), queue = this.queue.getSnapshot().view?.queue;
    const common = {positionSeconds: state.positionSeconds, playing: state.intent === 'playing' && state.phase !== 'error' && state.phase !== 'ended', expanded: this.expanded};
    if (fence.kind === 'channel') return {...common, fence, kind: 'live', queue: null};
    if (fence.kind === 'local') return {...common, fence, kind: kindOf(this.offlineSource?.metadata.kind), queue: null};
    // A building window is not a completed server-authoritative queue projection.
    let readyQueue: DockPlayback['queue'] = null;
    if (queue) { try { readyQueue = parseQueueSnapshot(queue, this.scope); } catch { /* Keep the validated v1 window in snapshot.queue; never invent a stricter projection. */ } }
    const kind = this.entry?.id === fence.itemId ? this.entry.kind : this.options?.itemId === fence.itemId ? this.options.kind : this.queue.getSnapshot().view?.items.find(item => item.entryId === fence.entryId)?.kind;
    return {...common, fence, kind: kindOf(kind) as 'video' | 'music' | 'audiobook', queue: readyQueue};
  }
  private changed(): void {
    if (this.updating || this.transitionEpoch !== undefined || !this.active()) return;
    this.updating = true;
    try {
      const state = this.playback.getSnapshot(), fence = this.fence();
      if (state.channel) {
        const channel = state.channel, linear = state.linear;
        const name = linear?.name || this.channel?.channel.name;
        if (name) this.subject = {kind: 'channel', id: channel.channelId, sourceId: channel.sourceId, channelName: name,
          ...(linear?.programme?.title ? {programmeTitle: linear.programme.title} : {}), live: true};
      }
      if (fence) {
        if (fence.kind === 'queue' && this.expandAtStart === this.startEpoch) {
          this.expanded = !audioKind(this.queue.getSnapshot().view?.items.find(item => item.entryId === fence.entryId)?.kind);
          this.expandAtStart = undefined;
        }
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
        const previous = this.snapshot.playback;
        // A new error needs attention once for its actual intent/source. Repeated error
        // notifications must respect Back without clearing the error or retiring the Surface.
        if (state.phase === 'error' && !this.expanded && (previous.phase !== 'error' || previous.intentId !== state.intentId
          || previous.session?.id !== state.session?.id || previous.session?.generation !== state.session?.generation)) {
          this.expanded = true; this.dock.expand(fence);
        }
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
    const state = this.playback.getSnapshot(), fence = playback.fence;
    const current = state.session?.id === fence.sessionId && (fence.kind === 'channel' || fence.kind === 'local' && this.offlineSource?.entryId === fence.entryId || this.entry?.id === fence.itemId);
    this.bookmarks.set(playback.fence.sessionId, {playback, entry: current ? this.entry : previous?.entry, subject: current ? this.subject : previous?.subject,
      queueId: playback.queue?.id ?? (session?.id === playback.fence.sessionId ? session.queue?.queueId : previous?.queueId),
      ...(fence.kind === 'queue' ? {entryId: fence.entryId} : fence.kind === 'local' ? {offline: current ? this.offlineSource : previous?.offline} : {channel: current ? state.channel : previous?.channel})});
    while (this.bookmarks.size > 8) this.bookmarks.delete(this.bookmarks.keys().next().value!);
  }
  private retainedQueueIds(): readonly string[] {
    if (!this.currentAuthority()) throw new Error('Playback authority retired.');
    const state = this.dock.getSnapshot(), session = this.currentSession();
    const queueId = (value: DockPlayback | null): string | undefined => {
      if (!value || value.fence.kind !== 'queue') return;
      if (!sameScope(value.fence.playback.scope, this.scope)) throw new Error('Invalid playback bookmark scope.');
      const saved = this.bookmarks.get(value.fence.sessionId);
      if (session?.id === value.fence.sessionId && session.queue?.entryId === value.fence.entryId) return session.queue.queueId;
      if (saved && sameFence(saved.playback.fence, value.fence)) return saved.queueId;
      return value.queue?.id;
    };
    // Only normalized current/parked/resume state grants candidates. The older cache may
    // contain superseded sessions, and a new subject's kind is not known at create time.
    const candidates = [session?.queue?.queueId ?? queueId(state.local), queueId(state.parkedAudio), queueId(state.resumeVideo)];
    const ids = [...new Set(candidates.filter((id): id is string => id !== undefined))];
    if (ids.length > 3) throw new Error('Too many playback queue bookmarks.');
    return Object.freeze(ids);
  }
  private selectSource(key: string): void {
    this.cancelSnapshot();
    this.clearForcedImage();
    this.externalPresentationBinding = undefined; this.pictureBinding = undefined;
    this.sourceKey = key; const epoch = ++this.sourceEpoch;
    this.sourceController?.abort();
    this.subtitleOff?.(); this.subtitleOff = undefined;
    const subtitles = this.subtitleService; this.subtitleService = undefined; subtitles?.stop();
    this.detailOff?.(); this.detailOff = undefined;
    this.detail?.service.dispose(); this.detail = undefined; this.fonts = undefined; this.fontsKey = undefined;
    this.options = this.options?.itemId === this.playback.getSnapshot().itemId ? this.options : undefined;
    this.effectiveRate = 0; this.supportedRates = [];
    if (!key) { if (!this.preparing && this.playback.getSnapshot().phase === 'idle') { this.entry = undefined; this.subject = undefined; } return; }
    const controller = new AbortController(); this.sourceController = controller;
    const state = this.playback.getSnapshot(), itemId = state.itemId!, session = this.currentSession();
    if (state.session?.mode === 'local') {this.options = undefined; return;}
    if (state.channel) return; // Live references are never catalogue/subtitle endpoint IDs.
    if (this.entry?.id !== itemId) { this.entry = undefined; this.subject = undefined; }
    else this.subject = subjectOf(this.entry);
    const valid = () => {
      const current = this.playback.getSnapshot();
      return this.active() && epoch === this.sourceEpoch && key === this.sourceKey && !controller.signal.aborted
        && !current.channel && current.intentId === state.intentId && current.itemId === itemId
        && current.session?.id === state.session?.id && current.session?.generation === state.session?.generation;
    };
    void this.optionsClient.options(itemId, session?.versionId ? {versionId: session.versionId} : {}, controller.signal).then(value => {
      if (!valid() || value.itemId !== itemId) return; this.options = value; this.applyOptions(); this.publish();
    }).catch(() => {});
    void this.request<unknown>(encodedRoutePath('get_items_id', {id: encodeURIComponent(itemId)}), 'GET', undefined, controller.signal).then(raw => {
      if (!valid()) return;
      const item = parseMediaItem(raw);
      if (item.id !== itemId) return;
      const kind = item.kind === 'track' ? 'song' : item.kind === 'audiobook' ? 'audiobook_file' : item.kind;
      if (!['movie', 'episode', 'extra', 'song', 'audiobook_file'].includes(kind)) return;
      this.entry = {...this.entry, ...item, kind: kind as ContentEntry['kind']}; this.subject = subjectOf(this.entry);
      const detail = new DetailService({api: {request: async <T>(path: string, method?: string, body?: unknown, signal?: AbortSignal): Promise<T> => {
        if (!valid() || !signal) throw new Error('Playback detail source retired.');
        // DetailService owns its read signal; bind that actual request to this source too.
        const unguard = this.http.guard(signal, valid);
        try { return await this.request<T>(path, method, body, signal); }
        finally { unguard(); }
      }}, scope: {serverId: this.bound.serverId, viewerId: this.bound.profileId}, requestId: async () => this.o.requestId()});
      const binding: SourceDetail = {service: detail, sourceEpoch: epoch, sourceKey: key, intentId: state.intentId,
        sessionId: state.session!.id, generation: state.session!.generation, itemId, libraryId: item.libraryId};
      this.detail = binding;
      this.detailOff = detail.subscribe(() => {
        if (!valid() || this.detail !== binding) return;
        const snapshot = detail.getSnapshot();
        // Home and Detail issue different fence namespaces. Pin only the genuine decoded
        // response from this bound service; its parser checks server/library/item scope.
        if (binding.responseFence === undefined && snapshot.phase === 'ready' && snapshot.data) binding.responseFence = snapshot.data.scope.viewerFence;
        const data = this.detailProjection();
        this.subject = this.entry ? subjectOf(this.entry, data) : undefined;
        this.changed();
      });
      void detail.select({itemId, libraryId: item.libraryId});
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
    if (!state.session || !fence) { this.clearForcedImage(); this.coordinator.setOptions(1, null, null); return; }
    if (fence.kind === 'channel') {
      this.clearForcedImage();
      this.coordinator.setOptions(1, null, {binding: {intentId: state.intentId, sessionId: state.session.id, generation: state.session.generation}, mode: 'off'});
      return;
    }
    const baseRate = this.local(fence).kind === 'audiobook' ? settings.audiobookRate : this.local(fence).kind === 'music' ? 1 : settings.videoRate;
    const rate = this.choices.get('speed', fence.playback, baseRate);
    if (fence.kind === 'local') {
      this.clearForcedImage();
      this.coordinator.setOptions(rate, null, {binding: {intentId: state.intentId, sessionId: state.session.id, generation: state.session.generation}, mode: 'off'});
      return;
    }
    this.path.setRate(rate);
    const session = this.currentSession(), plan = this.subtitleService?.getSnapshot().plan;
    this.path.setTracks(session?.presentation.audioTrackId, session?.presentation.subtitle?.trackId ?? null);
    const style = captionStyle({
      ...settings.subtitles,
      size: this.choices.get('subtitleSize', fence.playback, settings.subtitles.size),
      // The existing player offers three box overrides. Outline/shadow remain
      // genuine profile choices; do not narrow them to that older choice set.
      background: this.choices.has('subtitleBackground', fence.playback)
        ? this.choices.get('subtitleBackground', fence.playback, 'none') : settings.subtitles.background,
    });
    const binding = {intentId: state.intentId, sessionId: state.session.id, generation: state.session.generation};
    let subtitles: Record<string, unknown> | null = null;
    let forcedPath: string | undefined;
    const visible = this.displaySubtitles && this.expanded;
    const burned = session?.presentation.subtitle?.delivery === 'burn' || plan?.mode === 'track' && plan.renderer === 'burn_in';
    const drawn = deviceDrawnTrack(plan, session), selected = plan?.mode === 'track' && !this.subtitleService?.getSnapshot().suppressed ? plan.selected : null;
    const listUrl = fontsUrlOf(plan, session);
    if (visible && listUrl && listUrl !== this.fontsKey) {
      this.fontsKey = listUrl; this.fonts = 'pending'; const epoch = this.sourceEpoch;
      void this.request<unknown>(listUrl, 'GET', undefined, this.sourceController?.signal).then(raw => {
        if (this.active() && epoch === this.sourceEpoch && this.fontsKey === listUrl) { this.fonts = parseSubtitleFonts(raw, listUrl); this.applyOptions(); }
      }).catch(() => { if (this.active() && epoch === this.sourceEpoch && this.fontsKey === listUrl) { this.fonts = parseSubtitleFonts(null, listUrl); this.applyOptions(); } });
    }
    if (plan) subtitles = {binding, mode: 'off', revision: plan.revision};
    if (visible && plan && !burned && (selected || drawn)) {
      // mediaUrl enforces the current selected origin/media grant. No raw URL concatenation.
      const engine = this.coordinator.getEngine() === 'mpv' ? 'mpv' : 'native';
      // A native engine may genuinely install the rich subtitle producer too.
      // Plain cue documents retain their existing platform selection path.
      const rendering = this.o.engineFeatures(engine).subtitleRendering.filter(kind => engine === 'mpv' || kind !== 'text');
      const render = engineSubtitleRender(plan, state.session, rendering, path => this.o.api.mediaUrl(path), this.fonts, session);
      if (selected && plan.documentUrl || render) {
        const resource = selected ?? drawn?.resource;
        if (engine === 'mpv') {
          // The service keeps a route-relative media path. Resolve it through
          // the same authority-local route used by the actual native producer.
          try {forcedPath = forcedImageLinesPath(this.o.api.mediaUrl(state.session.streamUrl), render, resource, linesUrlOf(plan, session));}
          catch { /* an unavailable route cannot grant an optional filter */ }
        }
        subtitles = {binding, mode: 'track', revision: plan.revision, resourceId: selected?.id ?? drawn?.id, resourceRevision: resource?.revision ?? 1,
          manifestName: resource?.manifestName, origin: resource?.origin ?? 'embedded', language: resource?.language ?? '', title: resource?.title ?? '', offsetUs: selected ? plan.offsetUs : '0',
          ...(selected && plan.documentUrl ? {documentUrl: this.o.api.mediaUrl(plan.documentUrl)} : {}), ...(render ? {render} : {}), refreshRevision: 0, style};
      }
    }
    this.readForcedImage(fence, forcedPath);
    if (subtitles && this.forcedImageAvailable(fence) && this.choices.get('forcedOnly', fence.playback, false)) subtitles = {...subtitles, forcedOnly: true};
    this.coordinator.setOptions(rate, null, subtitles);
    const version = this.options?.versions.find(value => value.id === session?.versionId);
    this.path.setAutomatic(session?.presentation.quality.mode === 'automatic' ? {steps: automaticSteps(this.options?.qualities ?? []), originalKbps: version?.bitrateKbps} : null);
  }

  private clearForcedImage(): void {
    this.forcedImage?.controller.abort(); this.forcedImage = undefined;
  }

  private forcedImageAvailable(fence: PlaybackFence | undefined): boolean {
    const read = this.forcedImage, phase = this.playback.getSnapshot().phase;
    return !!fence && fence.kind === 'queue' && !!read?.mixed && read.epoch === this.sourceEpoch
      && !read.controller.signal.aborted && sameFence(read.fence, fence) && this.expanded && this.displaySubtitles
      && this.coordinator.getEngine() === 'mpv' && (phase === 'ready' || phase === 'starting');
  }

  private readForcedImage(fence: PlaybackFence, path: string | undefined): void {
    const source = this.sourceController?.signal, previous = this.forcedImage;
    if (!path || fence.kind !== 'queue' || !source || source.aborted) { this.clearForcedImage(); return; }
    if (previous?.path === path && previous.epoch === this.sourceEpoch && sameFence(previous.fence, fence)) return;
    this.clearForcedImage();
    const read = {fence, path, epoch: this.sourceEpoch, controller: new AbortController(), mixed: undefined as boolean | undefined};
    this.forcedImage = read;
    const abort = () => read.controller.abort(); source.addEventListener('abort', abort, {once: true});
    const current = () => this.active() && this.forcedImage === read && read.epoch === this.sourceEpoch
      && !read.controller.signal.aborted && this.matches(fence);
    void this.request<unknown>(path, 'GET', undefined, read.controller.signal).then(raw => {
      if (!current()) return;
      read.mixed = forcedChoiceOf(parseSubtitleLines(raw)); this.applyOptions(); this.publish();
    }).catch(() => { if (current()) {read.mixed = false; this.publish();} })
      .finally(() => source.removeEventListener('abort', abort));
  }

  setForcedOnly = (fence: PlaybackFence, on: boolean): boolean => {
    if (typeof on !== 'boolean' || !this.matches(fence) || !this.forcedImageAvailable(fence)) return false;
    return this.choices.set('forcedOnly', fence.playback, on, fence);
  };

  private makeSnapshot(sequence: number): NativePlaybackRuntimeSnapshot {
    const playback = this.playback.getSnapshot(), nextFence = this.retired ? undefined : this.fence(), queue = this.queue.getSnapshot(), view = queue.view;
    const previousFence = this.snapshot?.fence;
    // Progress is a new observation, not a new Surface/source lifetime. Metadata
    // can change within the same playback fence and must still reach consumers.
    const fence = nextFence && sameFence(previousFence, nextFence)
      && (nextFence.kind !== 'queue' || previousFence?.kind === 'queue' && previousFence.showId === nextFence.showId && previousFence.seasonId === nextFence.seasonId)
      ? previousFence : nextFence;
    const currentIndex = fence?.kind === 'queue' ? view?.items.findIndex(item => item.entryId === fence.entryId) ?? -1 : -1;
    const ready = !!fence && !this.retired && (playback.phase === 'ready' || playback.phase === 'starting');
    const session = this.currentSession();
    const nativeBinding = this.coordinator.getBinding(), acknowledgement = this.externalPresentationBinding;
    const externalPresentationBinding = acknowledgement === undefined ? undefined : acknowledgement && fence && !this.retired
      && !playback.pendingSeek && !playback.failedSeek && playback.phase !== 'error' && nativeBinding
      && sameNativePresentation(acknowledgement, nativeBinding) && acknowledgement.intentId === playback.intentId
      && acknowledgement.sessionId === fence.sessionId && acknowledgement.generation === fence.generation
      && acknowledgement.itemId === playback.itemId ? acknowledgement : null;
    const seekWindow = playback.channel && playback.linear ? {startSeconds: channelSeconds(playback.linear.media.windowStartUs), endSeconds: channelSeconds(playback.linear.media.windowEndUs)} : undefined;
    return Object.freeze({authority: this.bound, sequence, dock: this.dock.getSnapshot(), playback, fence, subject: this.subject, entry: this.entry, queue, session,
      ...(fence && this.forcedImageAvailable(fence) ? {forcedOnly: Object.freeze({on: this.choices.get('forcedOnly', fence.playback, false)})} : {}),
      options: this.options, subtitles: this.subtitleService?.getSnapshot(), seekWindow, engine: this.coordinator.getEngine() === 'mpv' ? 'mpv' : 'native', lease: this.coordinator.getSnapshot(), effectiveRate: playback.nativeListening?.effectiveRate ?? this.effectiveRate, supportedRates: playback.nativeListening?.supportedRates ?? this.supportedRates, externalPresentationBinding,
      ...(this.o.pictureInPictureControls ? {pictureInPicture: Object.freeze({request: this.pictureRequests, ...(this.pictureBinding && externalPresentationBinding && sameNativePresentation(this.pictureBinding, externalPresentationBinding) ? {binding: this.pictureBinding} : {})})} : {}), retired: this.retired,
      capabilities: Object.freeze({play: ready && playback.intent === 'paused', pause: ready && playback.intent === 'playing', stop: !!fence, seek: ready && (seekWindow ? seekWindow.endSeconds > seekWindow.startSeconds : playback.duration > 0),
        previous: ready && fence?.kind === 'queue' && (playback.positionSeconds > 3 || currentIndex > 0), next: ready && fence?.kind === 'queue' && !!view && view.next.reason !== 'end', cast: ready && fence?.kind === 'queue' && !!this.o.openDestinations,
        quality: ready && !playback.nativeListening && !!this.options?.qualities.length, version: ready && !playback.nativeListening && (this.options?.versions.length ?? 0) > 1,
        audioTrack: ready && !playback.nativeListening && !!this.options?.versions.find(value => value.id === session?.versionId)?.audio.length,
        subtitleTrack: ready && !playback.nativeListening && !!this.subtitleService?.getSnapshot().plan,
        subtitlesCanHide: fence?.kind === 'queue' && session?.presentation.subtitle?.delivery !== 'burn' && session?.presentation.decision.subtitles?.action !== 'burn' && this.subtitleService?.getSnapshot().plan?.renderer !== 'burn_in'})});
  }
  private publish(): void {
    // A native fact can synchronously publish through the path, service and
    // queue before its observation is settled. React must see that transaction
    // once, after all those listeners have run, rather than re-enter their fanout.
    if (this.factDepth) { this.factPublication = true; return; }
    this.snapshot = this.makeSnapshot(this.snapshot.sequence + 1);
    for (const listener of [...this.listeners]) listener();
  }

  private acceptFact(fact: any): void {
    if (!this.active()) return;
    this.factDepth++;
    try { this.applyFact(fact); }
    finally {
      if (--this.factDepth === 0 && this.factPublication) {
        this.factPublication = false;
        this.publish();
      }
    }
  }
  private applyFact(fact: any): void {
    this.externalPresentationBinding = nativeExternalPresentationBinding(fact, this.coordinator.getBinding());
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
    if (!fence || fence.kind !== 'queue' || state.phase !== 'ready' || state.intent !== 'playing' || state.pendingSeek || state.failedSeek) return;
    const modes = this.o.settings().skips;
    const markers = (this.options?.markers ?? []).flatMap((marker): SegmentMarker[] => {
      const kind = marker.type;
      // Wire preview/other markers have no corresponding skip kind in player-core.
      if (kind !== 'intro' && kind !== 'recap' && kind !== 'credits' && kind !== 'commercial') return [];
      return [{id: marker.id, kind, startSeconds: marker.startMs / 1000, endSeconds: marker.endMs / 1000, automaticSafe: marker.automaticSafe}];
    });
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
  replay = async (fence: PlaybackFence): Promise<void> => {
    if (!this.matches(fence)) return;
    if (fence.kind === 'channel') { this.channelControl?.retry(); return; }
    if (fence.kind === 'local') {
      if (this.playback.getSnapshot().phase === 'error') await this.playback.retry();
      else {this.playback.seek(0); this.playback.resume();}
      return;
    }
    if (this.playback.hasNativeOwner() && this.o.nativeListening) await this.o.nativeListening.action('retry', 0);
    else await this.queue.playItem(fence.itemId, 0);
  };
  seek = async (fence: PlaybackFence, seconds: number): Promise<void> => {
    if (!this.matches(fence) || !Number.isFinite(seconds) || seconds < 0 || !this.snapshot.capabilities.seek) return;
    const window = this.snapshot.seekWindow;
    if (fence.kind === 'channel' && (!window || seconds < window.startSeconds || seconds > window.endSeconds)) return;
    this.playback.seek(seconds);
  };
  skip = async (fence: PlaybackFence, seconds: number): Promise<void> => { if (this.matches(fence) && Number.isFinite(seconds)) await this.seek(fence, Math.max(0, this.playback.getSnapshot().positionSeconds + seconds)); };
  previous = async (fence: PlaybackFence): Promise<void> => { if (this.matches(fence) && this.snapshot.capabilities.previous) await this.queue.previous(); };
  next = async (fence: PlaybackFence): Promise<void> => { const view = this.queue.getSnapshot().view; if (this.matches(fence) && this.snapshot.capabilities.next && view) await this.queue.next(view.queue.id, view.queue.revision); };
  goLive = async (fence: PlaybackFence): Promise<void> => { if (this.matches(fence) && fence.kind === 'channel') this.channelControl?.goLive(); };

  /** The remote dock's own transitions: this app's player is not the source of any of them. */
  beginRemote = async (value: RemoteDock): Promise<void> => {
    if (!this.active()) return;
    // The explicit connection start may only retire the playback it was captured
    // from; a replacement dock playback is never stopped by a late handoff.
    const local = this.dock.getSnapshot().local;
    if (local && !sameFence(local.fence, value.playback.fence)) return;
    await this.onTransition(this.dock.beginRemote(value, Date.now()));
  };
  updateRemote = async (value: RemoteDock): Promise<void> => { if (this.active()) await this.onTransition(this.dock.remote(value, Date.now())); };
  dismissRemote = async (id: string): Promise<void> => { if (this.active()) await this.onTransition(this.dock.dismissRemote(id)); };
  continueHere = async (id: string): Promise<void> => { if (this.active()) await this.onTransition(this.dock.continueHere(id)); };
  setSleepTimer = async (fence: PlaybackFence, minutes: number | null): Promise<void> => { if (this.matches(fence)) await this.playback.setListeningDeadline('sleep', minutes); };
  stop = async (fence: PlaybackFence): Promise<void> => { if (this.matches(fence)) await this.onTransition(this.dock.close(fence)); };
  open = (fence: PlaybackFence): void => { if (this.matches(fence)) { this.expanded = true; this.dock.expand(fence); this.applyOptions(); this.publish(); } };
  collapse = (fence: PlaybackFence): void => { if (this.matches(fence)) { this.expanded = false; this.dock.collapse(fence); this.applyOptions(); this.publish(); } };
  setSubtitleDisplay(visible: boolean): void { if (this.displaySubtitles !== visible) { this.displaySubtitles = visible; this.applyOptions(); } }
  subtitleControls = (fence: PlaybackFence): NativePlaybackSubtitleControls | undefined => {
    const service = this.subtitleService, epoch = this.sourceEpoch, key = this.sourceKey;
    const plan = service?.getSnapshot().plan;
    if (!service || !plan || fence.kind !== 'queue' || !this.matches(fence) || plan.sessionId !== fence.sessionId || plan.generation !== fence.generation) return undefined;
    const current = () => this.matches(fence) && this.subtitleService === service && this.sourceEpoch === epoch && this.sourceKey === key
      && service.getSnapshot().plan?.sourceId === plan.sourceId;
    const picker = this.o.subtitleFilePicker, sourceSignal = this.sourceController?.signal;
    return boundSubtitleControls(service, current, picker && sourceSignal ? async (metadata, caller) => {
      if (!current()) return false;
      this.subtitleFileController?.abort();
      const controller = new AbortController(); this.subtitleFileController = controller;
      const abort = () => controller.abort();
      sourceSignal.addEventListener('abort', abort, {once: true});
      if (sourceSignal.aborted) controller.abort();
      try {
        return await uploadPickedSubtitle(picker, async (input, lifetime) => {
          await service.save(input, undefined, lifetime);
          if (service.getSnapshot().error) throw new Error(serviceText('player.subtitles.changeFailed'));
        }, {signal: controller.signal, isCurrent: current}, caller, metadata);
      } finally {
        sourceSignal.removeEventListener('abort', abort); controller.abort();
        if (this.subtitleFileController === controller) this.subtitleFileController = undefined;
      }
    } : undefined);
  };
  cast = async (fence: PlaybackFence): Promise<void> => { if (this.matches(fence) && this.o.openDestinations) await this.o.openDestinations(fence); };

  /** Same queue occurrence/session, then an actual native acknowledgement. The
   * caller owns host/navigation lifetime; the accepted new generation is ours. */
  prepareExternalPresentation = async (fence: PlaybackFence, lifetime: NativeExternalPresentationLifetime): Promise<NativeBinding | undefined> => {
    if (fence.kind !== 'queue' || !this.matches(fence) || lifetime.signal.aborted || !lifetime.isCurrent()) return;
    const original = this.currentSession(), playback = this.playback.getSnapshot(), controllerState = this.path.controller.getSnapshot();
    if (!original || original.kind !== 'vod' || original.id !== fence.sessionId || !original.queue || original.queue.entryId !== fence.entryId || playback.nativeListening
      || playback.phase !== 'ready' || playback.pendingSeek || playback.failedSeek || controllerState.changing
      || !controllerState.observation || controllerState.observation.generation !== original.presentation.generation
      || !Number.isFinite(controllerState.observation.positionMs) || controllerState.observation.state === 'idle' || controllerState.observation.state === 'error') return;
    const subtitles = this.subtitleService?.getSnapshot();
    const preparation = externalSubtitlePreparation(subtitles?.suppressed ? null : subtitles?.plan, original);
    if (preparation.kind === 'unavailable') return;
    this.externalController?.abort();
    const controller = this.externalController = new AbortController(), epoch = ++this.externalEpoch, start = this.startEpoch;
    let generation: number | undefined;
    const current = () => {
      const state = this.playback.getSnapshot(), session = this.queue.currentSession(), queue = this.queue.getSnapshot().view?.queue;
      try {return this.active() && !controller.signal.aborted && !lifetime.signal.aborted && lifetime.isCurrent()
        && epoch === this.externalEpoch && start === this.startEpoch && state.intentId === playback.intentId
        && state.session?.id === original.id && session?.id === original.id
        && queue?.id === original.queue!.queueId && queue.currentEntryId === original.queue!.entryId && queue.currentPlaybackId === original.id
        && (generation === undefined || state.session.generation === generation);}
      catch {return false;}
    };
    const abort = () => controller.abort();
    lifetime.signal.addEventListener('abort', abort, {once: true});
    if (lifetime.signal.aborted) controller.abort();
    const retire = this.subscribe(() => {if (!current()) controller.abort();});
    try {
      const adopted = preparation.kind === 'burn'
        ? await this.queue.changePlayback(preparation.choices, {signal: controller.signal, isCurrent: current, recoverEnded: false}) : original;
      if (!current() || !adopted || adopted.id !== original.id || adopted.queue?.queueId !== original.queue.queueId || adopted.queue.entryId !== original.queue.entryId
        || adopted.versionId !== original.versionId || adopted.presentation.audioTrackId !== original.presentation.audioTrackId) return;
      if (preparation.kind === 'burn' && (adopted.presentation.generation <= original.presentation.generation || adopted.presentation.subtitle?.trackId !== preparation.trackId || adopted.presentation.subtitle.delivery !== 'burn')) return;
      generation = adopted.presentation.generation;
      return await this.waitForExternalPresentation(controller.signal, current, binding => {
        if (binding.sessionId !== adopted.id || binding.generation !== generation || binding.intentId !== playback.intentId || binding.itemId !== playback.itemId) return false;
        if (preparation.kind !== 'burn') return true;
        const plan = this.subtitleService?.getSnapshot().plan;
        return plan?.sessionId === adopted.id && plan.generation === generation && plan.sourceId === preparation.sourceId;
      });
    } catch (error) {
      if (!current()) return;
      throw error;
    } finally {
      retire(); lifetime.signal.removeEventListener('abort', abort); controller.abort();
      if (this.externalController === controller) this.externalController = undefined;
    }
  };

  private waitForExternalPresentation(signal: AbortSignal, current: () => boolean, accepts: (binding: NativeBinding) => boolean): Promise<NativeBinding | undefined> {
    return new Promise(resolve => {
      let finished = false, timer: unknown, unsubscribe = () => {};
      const finish = (binding?: NativeBinding) => {
        if (finished) return; finished = true; unsubscribe(); signal.removeEventListener('abort', aborted);
        if (timer !== undefined) {if (this.o.timers?.clearTimer) this.o.timers.clearTimer(timer); else clearTimeout(timer as ReturnType<typeof setTimeout>);}
        resolve(binding);
      };
      const aborted = () => finish();
      const check = () => {
        if (signal.aborted || !current()) {finish(); return;}
        const binding = this.snapshot.externalPresentationBinding;
        if (binding && accepts(binding)) finish(binding);
      };
      unsubscribe = this.subscribe(check); signal.addEventListener('abort', aborted, {once: true});
      timer = this.o.timers?.setTimer ? this.o.timers.setTimer(() => finish(), 10000) : setTimeout(() => finish(), 10000);
      check();
    });
  }

  /** True acknowledges a fenced retained-view request, never that PiP started. */
  requestPictureInPicture = async (fence: PlaybackFence, lifetime: NativeExternalPresentationLifetime): Promise<boolean> => {
    if (!this.o.pictureInPictureControls) return false;
    const pending = this.prepareExternalPresentation(fence, lifetime), epoch = this.externalEpoch;
    const binding = await pending, ready = this.snapshot.externalPresentationBinding;
    if (!binding || !ready || !this.active() || epoch !== this.externalEpoch || lifetime.signal.aborted || !lifetime.isCurrent()
      || !sameNativePresentation(binding, ready) || this.pictureRequests >= Number.MAX_SAFE_INTEGER) return false;
    this.pictureRequests++; this.pictureBinding = binding; this.publish(); return true;
  };

  change = async (fence: PlaybackFence, choice: PlaybackChoices): Promise<void> => {
    if (!this.matches(fence)) return;
    if (this.playback.hasNativeOwner()) throw new Error(serviceText('player.opt.unavailable'));
    const options = this.options, version = options?.versions.find(value => value.id === this.currentSession()?.versionId);
    if (choice.quality && !options?.qualities.some(value => value.mode === choice.quality!.mode && (value.mode !== 'fixed' || value.id === ('id' in choice.quality! ? choice.quality!.id : undefined)))) throw new Error('Invalid playback quality.');
    if (!options || choice.versionId && !options.versions.some(value => value.id === choice.versionId) || choice.audioTrackId && !version?.audio.some(value => value.id === choice.audioTrackId) || choice.subtitleTrackId && !version?.subtitles.some(value => value.id === choice.subtitleTrackId) && !this.subtitleService?.getSnapshot().plan?.resources.some(value => value.id === choice.subtitleTrackId && value.enabled)) throw new Error('Invalid playback choice.');
    await this.playback.changePlayback(choice);
  };
  chooseQuality = async (fence: PlaybackFence, choice: QualityOption): Promise<void> => {
    if (!this.matches(fence)) return;
    if (this.playback.hasNativeOwner()) throw new Error(serviceText('player.opt.unavailable'));
    if (!this.options?.qualities.some(value => value.mode === choice.mode && value.id === choice.id)) return;
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
    if (!transition.effects.length) {
      this.expanded = transition.state.local?.expanded ?? false;
      this.applyOptions(); this.publish(); return;
    }
    const epoch = this.beginOperation();
    const controller = new AbortController(); this.startController = controller;
    this.transitionEpoch = epoch;
    let restored: PlaybackFence | undefined;
    try {
      await this.queue.cancel();
      if (!this.active() || epoch !== this.startEpoch) return;
      this.expanded = transition.state.local?.expanded ?? false;
      for (const effect of transition.effects) {
        if (!this.active() || epoch !== this.startEpoch) return;
        const fence = this.fence();
        if (effect.kind === 'restore') {
          const saved = this.bookmarks.get(effect.playback.fence.sessionId);
          if (!saved) throw new Error('Playback bookmark is unavailable.');
          this.entry = saved.entry; this.subject = saved.subject; this.expanded = false;
          if (effect.playback.fence.kind === 'channel') {
            if (!saved.channel) throw new Error('Playback bookmark is unavailable.');
            const valid = () => this.currentAuthority() && epoch === this.startEpoch && !controller.signal.aborted;
            await this.openChannel(saved.channel, epoch, controller.signal, valid, 'paused');
            if (!valid()) return;
            const current = this.fence(), linear = this.playback.getSnapshot().linear;
            const position = effect.playback.positionSeconds;
            if (!current || current.kind !== 'channel' || !linear || position < channelSeconds(linear.media.windowStartUs) || position > channelSeconds(linear.media.windowEndUs)) {
              this.playback.leave(); throw new Error('channel_position_unavailable');
            }
            try {
              await this.restoreChannelPosition(current, position, epoch, controller.signal);
            } catch (error) {
              // Retire only this restore's paused session, never a replacement that won.
              if (epoch === this.startEpoch && this.currentAuthority()) this.playback.leave();
              throw error;
            }
          } else if (effect.playback.fence.kind === 'local') {
            const valid = () => this.currentAuthority() && epoch === this.startEpoch && !controller.signal.aborted;
            if (!this.offline || !saved.offline || !saved.offline.current()) throw new Error(serviceText('downloads.offline.notPlayableHere'));
            const source = await this.offline.reopen(saved.offline, valid);
            if (!valid()) return;
            this.bindOffline(source);
            await this.playback.playLocal(source.itemId, () => this.makeOfflineSession(source), effect.playback.positionSeconds,
              {initialIntent: 'paused', signal: controller.signal, isCurrent: valid});
            if (!valid()) return;
            const local = this.fence();
            if (!local || local.kind !== 'local') throw new Error(this.playback.getSnapshot().error || serviceText('downloads.offline.notPlayableHere'));
          } else {
            if (!saved.queueId || !saved.entryId) throw new Error('Playback bookmark is unavailable.');
            // Canonical restore starts the actual queue entry paused, with no transient play.
            await this.queue.restorePaused(saved.queueId, saved.entryId, effect.playback.positionSeconds);
          }
          if (this.active() && epoch === this.startEpoch) {
            if (this.playback.getSnapshot().intent !== 'paused') throw new Error('Playback bookmark did not restore paused.');
            restored = this.fence();
          }
        } else if (fence && sameFence(fence, effect.playback.fence)) {
          this.remember(effect.playback);
          if (effect.kind === 'pause') this.playback.pause();
          else { this.playback.leave(); this.coordinator.reconsiderEngine(); }
        }
      }
    } catch (error) {
      if (epoch !== this.startEpoch || !this.currentAuthority()) return;
      throw error;
    } finally {
      if (this.transitionEpoch === epoch) { this.transitionEpoch = undefined; this.changed(); }
    }
    return restored && epoch === this.startEpoch ? {fence: restored, epoch} : undefined;
  };

  private restoreChannelPosition(fence: ChannelPlaybackFence, seconds: number, epoch: number, signal: AbortSignal): Promise<void> {
    const before = this.playback.getSnapshot();
    const previousSeek = before.linear?.desired.seek?.seekCommandId;
    return new Promise((resolve, reject) => {
      let off = () => {}, done = false;
      let seekId: string | undefined;
      let cancelTimer = () => {};
      const finish = (error?: Error) => {
        if (done) return; done = true; off(); cancelTimer(); signal.removeEventListener('abort', abort); error ? reject(error) : resolve();
      };
      const check = () => {
        const state = this.playback.getSnapshot(), current = this.fence(), linear = state.linear;
        // A server-resolved seek can change media generation. Its session, service run,
        // source and channel reference must still be the ones this restore actually opened.
        if (signal.aborted || epoch !== this.startEpoch || !this.currentAuthority() || current?.kind !== 'channel' || current.generation < fence.generation || !sameFence(current, {...fence, generation: current.generation})) return finish(new Error('stale_selection_context'));
        if (state.phase === 'error' || state.failedSeek || state.seekError || state.intent !== 'paused') return finish(new Error('channel_position_unavailable'));
        if (!linear || seconds < channelSeconds(linear.media.windowStartUs) || seconds > channelSeconds(linear.media.windowEndUs)) return finish(new Error('channel_position_unavailable'));
        const seek = linear.desired.seek;
        if (!seek || seek.seekCommandId === previousSeek || state.seekRevision <= before.seekRevision) return;
        if (seek.positionUs === null || Math.abs(channelSeconds(seek.positionUs) - seconds) > .001 || seekId !== undefined && seekId !== seek.seekCommandId) return finish(new Error('channel_position_unavailable'));
        seekId = seek.seekCommandId;
        if (seek.bufferGeneration === linear.media.bufferGeneration && linear.acknowledgedSeekCommandId === seekId && !state.pendingSeek && Math.abs(state.positionSeconds - seconds) < .25) finish();
      };
      const abort = () => finish(new Error('cancelled'));
      const timeout = () => finish(new Error('channel_position_unavailable'));
      const timers = this.o.timers;
      if (timers?.setTimer && timers.clearTimer) {
        const clear = timers.clearTimer, timer = timers.setTimer(timeout, 15000);
        cancelTimer = () => clear(timer);
      } else {
        const timer = setTimeout(timeout, 15000);
        cancelTimer = () => clearTimeout(timer);
      }
      if (done) { cancelTimer(); return; }
      off = this.playback.subscribe(check); signal.addEventListener('abort', abort, {once: true});
      if (signal.aborted) { abort(); return; }
      this.playback.seek(seconds); check();
    });
  }

  /** The native surface is an exclusive attachment; a second mounted Surface is rejected. */
  installSnapshotCapture(capture: VideoSnapshotCapture): void {
    if (this.snapshotCapture) throw new Error('Snapshot capture is already bound.');
    if (this.retired) { capture.dispose(); return; }
    this.snapshotCapture = capture;
  }
  setSurfaceTag(owner: object, tag: number | null): void {
    if (this.surfaceOwner && this.surfaceOwner !== owner || this.surfaceTagOwner && this.surfaceTagOwner !== owner) throw new Error('Playback surface is already mounted.');
    const next = tag !== null && Number.isSafeInteger(tag) && tag > 0 ? tag : undefined;
    if (this.surfaceTag !== next) this.cancelSnapshot();
    this.surfaceTag = next; this.surfaceTagOwner = next === undefined ? undefined : owner;
  }
  private snapshotSource(fence: PlaybackFence): VideoSnapshotSource | undefined {
    if (!this.matches(fence) || !this.surfaceOwner || this.surfaceTagOwner !== this.surfaceOwner || !this.surfaceTag) return;
    const state = this.playback.getSnapshot(), binding = this.coordinator.getBinding(), engine = this.coordinator.getEngine();
    if (state.nativeListening || !binding || binding.lease !== this.coordinator.getSnapshot() || binding.intentId !== state.intentId || binding.sessionId !== fence.sessionId || binding.generation !== fence.generation || binding.itemId !== state.itemId || !['native', 'mpv'].includes(engine)) return;
    return Object.freeze({reactTag: this.surfaceTag, engine: engine as 'native' | 'mpv', lease: binding.lease,
      binding: Object.freeze({intentId: binding.intentId, sessionId: binding.sessionId, generation: binding.generation, itemId: binding.itemId})});
  }
  isSnapshotSourceCurrent = (source: VideoSnapshotSource): boolean => {
    if (!this.captureFence || !this.currentAuthority()) return false;
    const actual = this.snapshotSource(this.captureFence);
    return !!actual && actual.reactTag === source.reactTag && actual.engine === source.engine && actual.lease === source.lease && actual.binding.intentId === source.binding.intentId && actual.binding.sessionId === source.binding.sessionId && actual.binding.generation === source.binding.generation && actual.binding.itemId === source.binding.itemId;
  };
  private cancelSnapshot(): void {
    ++this.captureEpoch; this.captureFence = undefined; this.captureSource = undefined; this.snapshotCapture?.cancel();
  }
  captureVideoSnapshot = async (fence: PlaybackFence, options?: {signal?: AbortSignal}): Promise<NativePlaybackVideoSnapshot> => {
    const source = this.snapshotSource(fence), capture = this.snapshotCapture;
    if (!source || !capture) throw new Error('snapshot_unavailable');
    if (this.captureSource) throw new Error('snapshot_busy');
    const epoch = ++this.captureEpoch;
    this.captureFence = fence; this.captureSource = source;
    try {
      const result = await capture.capture(source, options);
      if (epoch !== this.captureEpoch || !this.isSnapshotSourceCurrent(result.source)) { await result.release(); throw new Error('snapshot_stale'); }
      let released: Promise<void> | undefined;
      return Object.freeze({fence, image: result.image, release: () => released ??= result.release().finally(() => { if (epoch === this.captureEpoch) { this.captureFence = undefined; this.captureSource = undefined; } })});
    } catch (error) {
      if (epoch === this.captureEpoch) { this.captureFence = undefined; this.captureSource = undefined; }
      throw error;
    }
  };
  attachSurface(owner: object): () => void {
    if (this.surfaceOwner && this.surfaceOwner !== owner) throw new Error('Playback surface is already mounted.');
    this.surfaceOwner = owner; this.connect();
    return () => { if (this.surfaceOwner === owner) { this.cancelSnapshot(); this.surfaceTag = undefined; this.surfaceTagOwner = undefined; this.surfaceOwner = undefined; queueMicrotask(() => { if (!this.surfaceOwner) this.dispose(); }); } };
  }
  dispose = (): void => {
    if (this.retired) return;
    const state = this.playback.getSnapshot();
    // An ordinary shell unmount stops its exact server session at the settled position. On an
    // authority change, no request is sent with the next viewer's credentials: the old lease
    // expires server-side, while the engine and every old request are torn down immediately.
    if (state.session && !this.playback.hasNativeOwner() && this.authorityMatches()) {
      this.stopOwnedSession(state.session.id, Math.max(0, Math.round(state.positionSeconds * 1000)));
    }
    this.beginOperation(); this.retired = true; ++this.sourceEpoch; this.externalPresentationBinding = null;
    this.cancelSnapshot(); this.snapshotCapture?.dispose();
    this.startController?.abort(); this.sourceController?.abort(); this.clearForcedImage(); this.http.dispose(); this.clearCompletion();
    const identity = this.snapshot.fence?.playback; if (identity) this.choices.stop(identity); this.skipped.clear();
    if (this.routeRecovery) clearTimeout(this.routeRecovery);
    this.subtitleOff?.(); this.subtitleService?.stop(); this.subtitleService = undefined;
    this.detailOff?.(); this.detailOff = undefined;
    this.detail?.service.dispose(); this.detail = undefined;
    for (const off of this.offs.splice(0).reverse()) off();
    this.coordinator.stop(); this.queue.dispose(); this.playback.leave(); this.path.dispose(); this.offline?.dispose();
    void this.o.nativeListening?.detach(true).catch(() => {});
    this.o.disposeCapabilities();
    this.dock.reset(this.scope); this.bookmarks.clear(); this.entry = undefined; this.subject = undefined; this.options = undefined;
    this.publish(); this.listeners.clear();
  };
}
