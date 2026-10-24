/**
 * The native apps' one playback path.
 *
 *   PlaybackService            what the screens read and command (shared with the web)
 *        │  snapshot ▼   ▲ facts
 *   NativePlaybackCoordinator  holds the lease on a player engine and sends it commands
 *        │                     (`bridge/NativePlaybackCoordinator`, two engines, one contract)
 *   NativePlayback             this file: the server's side of the same session
 *        │
 *   PlaybackSessionController  the server session: timeline, re-plan, lease, server end
 *
 * The engines are native modules that load what the service's snapshot names, so here the session
 * controller's player port is an observer: it never loads or seeks anything, it is told what the
 * engine in use reports (`engineFact`) and the controller turns that into the session's timeline.
 * Everything the server needs to hear or decide goes through the controller: progress and the
 * lease, a change of quality, version, audio or subtitle track (one `PATCH`, the same session and
 * queue entry, the next generation), a player failure (the same `PATCH`), a stop with the last
 * position, and the server ending the session or its lease lapsing.
 *
 * `transport` is the playback service's `PlaybackApi` and the queue player's session transport.
 * `session(id)` is the server's own account of a session: the engine it named, the quality in
 * force, the audio and subtitle tracks it chose.
 *
 * Music and audiobooks handed to the native listening owner, live channels (their own session
 * control) and downloads (no server session) are not this path's: the controller is never
 * attached to them.
 */
import type {PlaybackApi, PlaybackService, PlaybackSession, PlaybackSnapshot, SessionEndInfo} from '../../../../../packages/client-core/src/index';
import type {PlayerFailureCode} from '../../../../../packages/client-core/src/client-profile';
import {AutomaticQuality, fixedQualities, fixedQualityOf, qualityRequest, type FixedQuality} from '../../../../../packages/client-core/src/playback-v1/choices';
import {PlaybackApiError, idempotencyKey, type V1Http, type V1Request} from '../../../../../packages/client-core/src/playback-v1/http';
import {PlaybackOptionsClient} from '../../../../../packages/client-core/src/playback-v1/options';
import type {MediaPlayer, PlayerEvent, PlayerObservation, PlayerSource, PlayerState} from '../../../../../packages/client-core/src/playback-v1/port';
import {parseObservedPlayback, type ObservedPlayback} from '../../../../../packages/client-core/src/playback-v1/observed-playback';
import type {QualityOption} from '../../../../../packages/client-core/src/playback-v1/quality';
import {PlaybackSessionController, SessionsClient, type SessionChange, type SessionChangeContext, type StartOptions, type StartTarget, type Timers} from '../../../../../packages/client-core/src/playback-v1/sessions';
import {requireSessionChangeCurrent} from '../../../../../packages/client-core/src/playback-v1/change-context';
import {toPlaybackSession} from '../../../../../packages/client-core/src/playback-v1/session-shape';
import type {Session} from '../../../../../packages/client-core/src/playback-v1/types';
import type {QueueSessionTransport} from '../../../../../packages/client-core/src/playback-v1/v1-queue-player';

/** What the binding tells the player screen in words (the screen owns the wording). */
export type NativePlaybackNotice = Readonly<{type: 'qualityLowered' | 'qualityRaised'; step?: FixedQuality}>;

/** An engine fact as the coordinator accepted it (ENGINE-CONTRACT.md): already fenced to the
 * engine, lease, intent, session and generation in use. */
export type EngineFact = Readonly<{
  type?: unknown; position?: unknown; paused?: unknown; rate?: unknown;
  binding?: Readonly<{sessionId?: unknown; generation?: unknown}>;
  /** What the engine measured of the connection, and how much it holds ahead of the picture. */
  throughputKbps?: unknown; bufferedSeconds?: unknown; droppedFrames?: unknown;
  /** Actual current renderer snapshot only, never a source plan or capability. */
  observedPlayback?: unknown;
}>;

/** Ends this device caused itself: a queue move replaced the session, or the title played out. */
const OWN_ENDS: readonly string[] = ['replaced', 'completed', 'ended'];

type LeaseOwner = {recoverLease(sessionId: string, positionSeconds: number): Promise<boolean>};
export type AutomaticConfig = Readonly<{steps: readonly FixedQuality[]; originalKbps?: number}>;

export type NativePlaybackHost = Readonly<{
  http: V1Http;
  key?: () => string;
  timers?: Timers;
}>;

/**
 * The session controller's player port. The engine is driven elsewhere (the coordinator), so
 * every command here is a no-op; what it holds is the newest reading of the engine in use, which
 * the controller reports.
 */
class ObservedEngine implements MediaPlayer {
  private generation = 0;
  private reading?: PlayerObservation;
  private rate = 1;
  private audioTrackId?: string;
  private subtitleTrackId?: string | null;
  private readonly listeners = new Set<(event: PlayerEvent) => void>();

  load(source: PlayerSource): void {
    this.generation = source.generation;
    this.reading = undefined;
  }
  play(): void {}
  pause(): void {}
  seek(): void {}
  setRate(rate: number): void { this.rate = rate; }
  selectSidecarSubtitle(): void {}
  observe(): PlayerObservation {
    return this.reading ?? Object.freeze({generation: this.generation, state: 'idle' as const, positionMs: 0, rate: this.rate});
  }
  onEvent(listener: (event: PlayerEvent) => void): () => void {
    this.listeners.add(listener);
    return () => { this.listeners.delete(listener); };
  }
  dispose(): void { this.listeners.clear(); }

  /** The tracks in force, reported with the timeline (spec §17). */
  tracks(audioTrackId: string | undefined, subtitleTrackId: string | null | undefined): void {
    this.audioTrackId = audioTrackId;
    this.subtitleTrackId = subtitleTrackId;
  }
  get loaded(): number { return this.generation; }
  get state(): PlayerState | undefined { return this.reading?.generation === this.generation ? this.reading.state : undefined; }

  /** A reading from the engine for `generation`. Older generations are dropped by the controller's own gate. */
  report(generation: number, state: PlayerState, positionMs: number, cause: 'time' | 'state' | 'seeked', extra: Readonly<{bufferedMs?: number; bandwidthKbps?: number; droppedFrames?: number; observedPlayback?: ObservedPlayback}> = {}): void {
    const observation: PlayerObservation = Object.freeze({
      generation, state, positionMs: Math.max(0, Math.round(positionMs)), rate: this.rate,
      ...(extra.bufferedMs !== undefined ? {bufferedMs: extra.bufferedMs} : {}),
      ...(extra.bandwidthKbps !== undefined ? {bandwidthKbps: extra.bandwidthKbps} : {}),
      ...(extra.droppedFrames !== undefined ? {droppedFrames: extra.droppedFrames} : {}),
      ...(extra.observedPlayback !== undefined ? {observedPlayback: extra.observedPlayback} : {}),
      ...(this.audioTrackId !== undefined ? {audioTrackId: this.audioTrackId} : {}),
      ...(this.subtitleTrackId !== undefined ? {subtitleTrackId: this.subtitleTrackId} : {}),
    });
    if (generation === this.generation) this.reading = observation;
    for (const listener of [...this.listeners]) listener({type: cause, observation});
  }
}

/** Remembers the highest timeline `seq` sent for each session, for a native owner that takes one
 * over and must continue from it. */
function countingReports(http: V1Http, seqs: Map<string, number>): V1Http {
  const timeline = /^\/v1\/playback\/sessions\/([^/]+)\/timeline$/;
  return {
    send(request: V1Request) {
      const match = request.method === 'POST' ? timeline.exec(request.path) : null;
      const seq = match ? (request.body as {seq?: unknown} | undefined)?.seq : undefined;
      if (match && typeof seq === 'number' && Number.isSafeInteger(seq)) {
        const id = decodeURIComponent(match[1]!);
        seqs.set(id, Math.max(seqs.get(id) ?? 0, seq));
        if (seqs.size > 32) seqs.delete(seqs.keys().next().value!);
      }
      return http.send(request);
    },
  };
}

const finite = (value: unknown): number | undefined => (typeof value === 'number' && Number.isFinite(value) ? value : undefined);

export class NativePlayback {
  readonly controller: PlaybackSessionController;
  readonly transport: PlaybackApi & QueueSessionTransport & {sessionUpdated(sessionId: string, revision?: string, data?: unknown): void; session(id: string): Session | undefined};
  private readonly host: NativePlaybackHost;
  private readonly engine = new ObservedEngine();
  private readonly client: SessionsClient;
  private readonly options: PlaybackOptionsClient;
  private readonly known = new Map<string, Session>();
  private readonly seqs = new Map<string, number>();
  private readonly positions = new Map<string, number>();
  private readonly retired = new Set<string>();
  private readonly changedListeners = new Set<(session: Session) => void>();
  private readonly endedListeners = new Set<(sessionId: string, end: SessionEndInfo) => void>();
  private readonly sessionListeners = new Set<() => void>();
  private readonly noticeListeners = new Set<(notice: NativePlaybackNotice) => void>();
  private service?: PlaybackService;
  private lease?: () => LeaseOwner | undefined;
  private attached = '';
  private disposed = false;
  private lastState?: PlayerState;
  private automatic?: AutomaticQuality;
  private automaticConfig?: AutomaticConfig;
  private automaticItem?: string;
  private automaticStep?: FixedQuality;
  private decidedAt = 0;
  private offs: (() => void)[] = [];

  constructor(host: NativePlaybackHost) {
    this.host = host;
    const http = countingReports(host.http, this.seqs);
    this.client = new SessionsClient(http, host.timers);
    this.options = new PlaybackOptionsClient(host.http);
    this.controller = new PlaybackSessionController({
      http, player: this.engine, timers: host.timers, key: host.key,
      // The engines seek inside the stream they hold; the server follows the requests.
      serverSeek: () => false,
      wantsPlaying: () => this.service?.getSnapshot().intent === 'playing',
      onServerEnded: (session, end) => this.serverEnded(session.id, end),
      onLeaseExpired: (session, positionMs) => void this.leaseExpired(session, positionMs),
    });
    this.transport = this.makeTransport();
    this.offs.push(this.controller.subscribe(() => this.controllerChanged()));
  }

  // ── Wiring ──────────────────────────────────────────────────────────────

  /** Join the service this path serves. `lease` names the queue player that can start an entry
   * again when its session's lease lapsed. Returns the undo. */
  bind(service: PlaybackService, lease?: () => LeaseOwner | undefined): () => void {
    this.service = service;
    this.lease = lease;
    const off = service.subscribe(() => this.apply(service.getSnapshot()));
    this.apply(service.getSnapshot());
    return () => { off(); if (this.service === service) { this.service = undefined; this.lease = undefined; } };
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    for (const off of this.offs.splice(0)) off();
    this.controller.dispose();
    this.engine.dispose();
    this.endedListeners.clear();
    this.changedListeners.clear();
    this.sessionListeners.clear();
    this.noticeListeners.clear();
  }

  /** The server's account of a session: the engine it named, the quality and tracks in force. */
  session = (id: string | undefined): Session | undefined => (id ? this.known.get(id) : undefined);
  /** Called when what `session(id)` answers may have changed. */
  subscribeSessions = (listener: () => void): (() => void) => { this.sessionListeners.add(listener); return () => { this.sessionListeners.delete(listener); }; };
  private sessionsChanged() { for (const l of [...this.sessionListeners]) l(); }

  onNotice(listener: (notice: NativePlaybackNotice) => void): () => void {
    this.noticeListeners.add(listener);
    return () => { this.noticeListeners.delete(listener); };
  }

  /** The speed the viewer chose, reported with the timeline. */
  setRate(rate: number): void { if (Number.isFinite(rate) && rate > 0) this.engine.setRate(rate); }

  /** The tracks in force for the timeline: the audio track playing and the subtitle shown (`null`: off). */
  setTracks(audioTrackId: string | undefined, subtitleTrackId: string | null | undefined): void { this.engine.tracks(audioTrackId, subtitleTrackId); }

  // ── Following the service ───────────────────────────────────────────────

  /** The controller holds the session the service is playing, and nothing else. */
  private apply(next: PlaybackSnapshot): void {
    if (this.disposed) return;
    const session = next.session;
    const ours = !!session && session.protocol === 'v1' && !next.channel && !next.nativeListening && next.phase !== 'error' && next.phase !== 'idle';
    if (!session || !ours) { this.release(); return; }
    const key = `${session.id}:${session.generation}`;
    if (this.attached === key) return;
    const known = this.known.get(session.id);
    // The controller may already hold a newer presentation of this session (a change whose
    // answer has not reached the service yet): the service catches up.
    if (!known || known.presentation.generation !== session.generation) return;
    this.attached = key;
    this.lastState = undefined;
    this.controller.attach(known, {autoplay: next.intent === 'playing', startPositionMs: Math.max(0, Math.round((next.pendingSeek?.positionSeconds ?? session.resumeSeconds) * 1000))});
  }

  private release(): void {
    const held = this.controller.getSnapshot();
    if (held.session && held.observation) this.remember(held.session.id, held.observation.positionMs);
    if (held.session) this.controller.detach();
    this.attached = '';
    this.lastState = undefined;
  }

  private remember(id: string, positionMs: number): void {
    this.positions.set(id, positionMs);
    if (this.positions.size > 32) this.positions.delete(this.positions.keys().next().value!);
  }

  // ── Facts from the engine in use ────────────────────────────────────────

  /**
   * One accepted engine fact. Readings become the session's timeline; the connection's measured
   * throughput and stalls feed Automatic quality. Nothing here changes what the service does
   * with the fact.
   */
  engineFact(fact: EngineFact): void {
    const held = this.controller.getSnapshot().session;
    const sessionId = fact.binding?.sessionId, generation = finite(fact.binding?.generation);
    if (this.disposed || !held || sessionId !== held.id || generation === undefined || generation !== held.presentation.generation) return;
    let observedPlayback: ObservedPlayback | undefined;
    try {observedPlayback = parseObservedPlayback(fact.observedPlayback);}
    catch {observedPlayback = Object.freeze({});} // Invalid output must not interrupt progress or lease renewal.
    const position = finite(fact.position);
    const extra = {
      ...(observedPlayback !== undefined ? {observedPlayback} : {}),
      ...(finite(fact.bufferedSeconds) !== undefined ? {bufferedMs: Math.max(0, Math.round(finite(fact.bufferedSeconds)! * 1000))} : {}),
      ...(finite(fact.throughputKbps) !== undefined && finite(fact.throughputKbps)! > 0 ? {bandwidthKbps: Math.round(finite(fact.throughputKbps)!)} : {}),
      ...(finite(fact.droppedFrames) !== undefined ? {droppedFrames: Math.max(0, Math.round(finite(fact.droppedFrames)!))} : {}),
    };
    const rate = finite(fact.rate);
    if (rate !== undefined && rate > 0) this.engine.setRate(rate);
    switch (fact.type) {
      case 'progress': {
        if (position === undefined) return;
        const state: PlayerState = fact.paused === true ? 'paused' : 'playing';
        const cause = state === this.lastState ? 'time' : 'state';
        this.lastState = state;
        this.engine.report(generation, state, position * 1000, cause, extra);
        if (extra.bandwidthKbps !== undefined) this.automatic?.sample(extra.bandwidthKbps);
        this.decide();
        return;
      }
      case 'seekApplied':
        if (position === undefined) return;
        this.lastState = fact.paused === true ? 'paused' : 'playing';
        this.engine.report(generation, this.lastState, position * 1000, 'seeked', extra);
        return;
      case 'stalled': {
        const at = this.controller.getSnapshot().observation;
        if (this.lastState === 'buffering' || !at || at.generation !== generation) return;
        this.lastState = 'buffering';
        this.engine.report(generation, 'buffering', at.positionMs, 'state', extra);
        this.automatic?.stalled();
        this.decide();
        return;
      }
      case 'ended':
        this.lastState = 'ended';
        this.engine.report(generation, 'ended', (position ?? (this.controller.getSnapshot().observation?.positionMs ?? 0) / 1000) * 1000, 'state', extra);
        return;
    }
  }

  // ── The controller's news ───────────────────────────────────────────────

  /** A presentation the controller adopted by itself (a change made from another device, a 412
   * recovery) reaches the screens, and the engine, through the service. */
  private controllerChanged(): void {
    const held = this.controller.getSnapshot().session, service = this.service;
    if (!held || !service) return;
    const before = this.known.get(held.id);
    if (before !== held) { this.known.set(held.id, held); this.sessionsChanged(); }
    const shown = service.getSnapshot().session;
    if (shown?.id === held.id && held.presentation.generation > shown.generation) service.installPresentation(toPlaybackSession(held, shown.duration));
  }

  private serverEnded(sessionId: string, end: SessionEndInfo): void {
    if (this.retired.has(sessionId)) return;
    // This device's own doing (the queue moved on, the title finished) is not news to it, even
    // when the server's notice of it overtakes the answer that carries the next session.
    if (OWN_ENDS.includes(end.reason)) return;
    this.known.delete(sessionId);
    for (const l of [...this.endedListeners]) l(sessionId, end);
  }

  /** The lease lapsed while this device could not report (asleep in a pocket, a long outage): the
   * queue starts its entry again where it was. Only when that cannot be done does the viewer see why. */
  private async leaseExpired(session: Session, positionMs: number): Promise<void> {
    const service = this.service, snapshot = service?.getSnapshot();
    if (!service || snapshot?.session?.id !== session.id) return;
    // A title that had finished or already failed stays as it is.
    if (snapshot.phase !== 'starting' && snapshot.phase !== 'ready') { if (snapshot.phase !== 'ended') this.serverEnded(session.id, {reason: 'lease_expired'}); return; }
    service.recovering(snapshot.intentId, true);
    const owner = this.lease?.();
    const recovered = await (owner?.recoverLease(session.id, positionMs / 1000).catch(() => false) ?? Promise.resolve(false));
    const now = service.getSnapshot();
    service.recovering(now.intentId, false);
    if (!recovered && now.session?.id === session.id && now.phase !== 'error') this.serverEnded(session.id, {reason: 'lease_expired'});
  }

  // ── Automatic quality ───────────────────────────────────────────────────

  /**
   * Automatic quality for the playing title: on with what the source offers, or off (null). It
   * starts where the session is (the original, or the step the server put in force) and asks the
   * server to step down on a sustained shortfall or repeated stalls, and back up after sustained
   * headroom, from what the engine measures of the connection.
   */
  setAutomatic(config: AutomaticConfig | null): void {
    const snapshot = this.service?.getSnapshot();
    const item = snapshot?.itemId;
    if (!config) { if (this.automatic) { this.automatic = undefined; this.automaticConfig = undefined; this.automaticStep = undefined; } return; }
    const same = this.automatic && this.automaticItem === item && this.automaticConfig && JSON.stringify(this.automaticConfig) === JSON.stringify(config);
    if (same) return;
    const inForce = fixedQualityOf(this.known.get(snapshot?.session?.id ?? '')?.presentation.quality);
    const carried = (this.automaticStep && config.steps.find(s => s.id === this.automaticStep!.id)) ?? (inForce && config.steps.find(s => s.id === inForce.id));
    this.automatic = new AutomaticQuality({...config, now: this.host.timers?.now, ...(carried ? {startAt: carried} : {})});
    this.automaticConfig = config;
    this.automaticItem = item;
    this.automaticStep = carried;
  }

  /** The viewer picked a quality themselves: Automatic forgets where it had stepped to. */
  forgetAutomaticStep(): void { this.automaticStep = undefined; }
  /** What the engine last measured of the connection, in kilobits a second. */
  get throughputKbps(): number | undefined { return this.automatic?.estimate ?? this.controller.getSnapshot().observation?.bandwidthKbps; }

  private decide(): void {
    const auto = this.automatic, service = this.service;
    if (!auto || !service) return;
    const at = (this.host.timers?.now ?? Date.now)();
    if (at - this.decidedAt < 1000) return;
    this.decidedAt = at;
    const snapshot = service.getSnapshot();
    if (snapshot.channel || snapshot.phase !== 'ready' || snapshot.pendingSeek || snapshot.nativeListening) return;
    const step = auto.decide();
    if (step === undefined) return;
    const lowered = !!step && (!this.automaticStep || step.height < this.automaticStep.height);
    this.automaticStep = step ?? undefined;
    for (const l of [...this.noticeListeners]) l({type: lowered ? 'qualityLowered' : 'qualityRaised', ...(step ? {step} : {})});
    const estimate = auto.estimate;
    void service.changePlayback({quality: qualityRequest('automatic', step ?? undefined), ...(estimate !== undefined ? {throughputKbps: Math.round(estimate)} : {})}).catch(() => {});
  }

  // ── PlaybackApi and the queue player's transport ────────────────────────

  private keep(session: Session): Session {
    this.known.set(session.id, session);
    // Bounded: sessions leave by retire, forget and stop; this is the backstop.
    if (this.known.size > 16) this.known.delete(this.known.keys().next().value!);
    this.sessionsChanged();
    return session;
  }

  private dropped(id: string): void {
    this.known.delete(id);
    this.positions.delete(id);
    if (this.controller.getSnapshot().session?.id === id) { this.controller.detach(); this.attached = ''; this.lastState = undefined; }
    this.sessionsChanged();
  }

  private makeTransport(): NativePlayback['transport'] {
    const self = this;
    const duration = async (itemId: string, versionId?: string, signal?: AbortSignal): Promise<number> => {
      if (!itemId) return 0;
      try {
        const o = await self.options.options(itemId, {}, signal);
        const v = o.versions.find(x => x.id === (versionId ?? o.preferred?.versionId)) ?? o.versions[0];
        return v ? v.durationMs / 1000 : 0;
      } catch { return 0; } // The engine reports the duration once it has the media.
    };
    const start = async (target: StartTarget, options: StartOptions, key: string = (self.host.key ?? idempotencyKey)(), durationSeconds?: number, signal?: AbortSignal) => {
      const session = self.keep(await self.client.start(target, options, key, {signal}));
      return {session, playback: toPlaybackSession(session, durationSeconds ?? await duration(session.itemId ?? '', session.versionId, signal))};
    };
    return {
      start,
      duration,
      adopt: (session: Session, durationSeconds: number) => toPlaybackSession(self.keep(session), durationSeconds),
      retire(id: string) { self.retired.add(id); if (self.retired.size > 64) self.retired.delete(self.retired.values().next().value!); self.dropped(id); },
      forget(id: string) { self.dropped(id); },
      reportedSeq: (id: string) => self.seqs.get(id) ?? 0,
      session: (id: string) => self.known.get(id),
      async change(id: string, change: SessionChange, durationSeconds: number, context?: SessionChangeContext) {
        requireSessionChangeCurrent(context);
        if (self.controller.getSnapshot().session?.id !== id) throw new PlaybackApiError(410, 'session_ended', 'never');
        const updated = await self.controller.change(change, context);
        requireSessionChangeCurrent(context);
        if (!updated) throw new PlaybackApiError(410, 'session_ended', 'never');
        return {session: self.keep(updated), playback: toPlaybackSession(updated, durationSeconds)};
      },
      createPlayback: (itemId: string, requestId: string, signal?: AbortSignal) => start({itemId}, {startFrom: 'resume', state: 'playing'}, requestId, undefined, signal).then(r => r.playback),
      async stopPlayback(id: string, signal?: AbortSignal) {
        const held = self.controller.getSnapshot();
        if (held.session?.id === id && held.phase !== 'ended') {
          await self.controller.stop();
          self.controller.detach();
          self.attached = '';
        } else if (!self.retired.has(id)) {
          await self.client.stop(id, self.positions.get(id), signal);
        }
        self.known.delete(id);
        self.positions.delete(id);
        self.sessionsChanged();
      },
      // Progress is the controller's timeline, fed by the engine's own readings. Only the end is
      // waited for here: the queue moves on once the server has it.
      async progressPlayback(id: string, payload: {generation: number; sequence: number; positionSeconds: number; state: 'playing' | 'paused' | 'ended'}) {
        if (self.retired.has(id)) return;
        // A session this path no longer holds (one left over from before the app was closed, kept
        // in the service's journal): its last known place travels with the stop that follows.
        if (self.controller.getSnapshot().session?.id !== id) { if (Number.isFinite(payload.positionSeconds) && payload.positionSeconds >= 0) self.remember(id, payload.positionSeconds * 1000); return; }
        if (payload.state !== 'ended') return;
        // The service knows the title ended; the engine's own report of it may have been fenced
        // off on its way here (a seek settling at the very end), so the end is said again.
        if (self.engine.state !== 'ended' && self.engine.loaded === payload.generation) { self.lastState = 'ended'; self.engine.report(payload.generation, 'ended', payload.positionSeconds * 1000, 'state'); }
        await self.controller.confirmEnded();
      },
      async markerSkipped(id: string, skipped: Readonly<{markerId: string; mode: 'automatic' | 'manual'; positionMs: number}>) {
        if (self.controller.getSnapshot().session?.id === id) self.controller.noteSkip(skipped);
      },
      // The engine could not play the presentation: the server is told, and re-plans the same
      // session another way where the picture was. The queue and its place are untouched.
      async reportPlayerFailure(sessionId: string, code: PlayerFailureCode, detail: string, positionSeconds: number) {
        if (self.controller.getSnapshot().session?.id !== sessionId) return {escalates: false};
        try {
          const updated = await self.controller.change({failure: {code, detail: detail.replace(/[\x00-\x1f\x7f]/g, ' ').slice(0, 500)}, positionMs: Math.max(0, Math.round(positionSeconds * 1000))});
          if (!updated) return {escalates: false};
          const session = self.keep(updated);
          for (const listener of self.changedListeners) listener(session);
          return {escalates: true, session: toPlaybackSession(session, 0)};
        } catch (e) {
          // unsupported_media: that was the last way to deliver the file.
          if (e instanceof PlaybackApiError && (e.code === 'unsupported_media' || e.status === 404 || e.status === 410)) return {escalates: false};
          return null;
        }
      },
      onSessionChanged(listener: (session: Session) => void) {
        self.changedListeners.add(listener);
        return () => { self.changedListeners.delete(listener); };
      },
      onServerEnded(listener: (sessionId: string, end: SessionEndInfo) => void) {
        self.endedListeners.add(listener);
        return () => { self.endedListeners.delete(listener); };
      },
      sessionUpdated(sessionId: string, revision?: string, data?: unknown) {
        if (self.retired.has(sessionId)) return;
        const d = data && typeof data === 'object' ? data as {state?: unknown; reason?: unknown; generation?: unknown} : undefined;
        if (d?.state === 'ended' && typeof d.reason === 'string' && OWN_ENDS.includes(d.reason)) return;
        // Every report this device sends moves the session's revision; only an end or a new
        // presentation is worth reading the session again for.
        const held = self.controller.getSnapshot().session;
        if (d && d.state !== 'ended' && typeof d.generation === 'number' && held?.id === sessionId && d.generation <= held.presentation.generation) return;
        void self.controller.sessionUpdated(sessionId, revision, data);
      },
    };
  }
}

/** The fixed qualities a title's quality menu offers (playback options `qualities`), best first. */
export function automaticSteps(qualities: readonly QualityOption[]): readonly FixedQuality[] {
  return fixedQualities.filter(step => qualities.some(q => q.mode === 'fixed' && q.id === step.id + 'p'));
}

export type {PlaybackSession};
