import React, {useCallback, useEffect, useState, useSyncExternalStore} from 'react';
import {StyleSheet, Text, View, useKeplerAppStateManager, type LayoutChangeEvent, type ViewProps} from '@amazon-devices/react-native-kepler';
import {KeplerVideoSurfaceView, VideoPlayer} from '@amazon-devices/react-native-w3cmedia';
import {trace} from '../debug';
import {ModuleEvents, failure, withEvents} from './events';
import {HlsSource} from './hls';
import {uuid} from './random';
import {applySubtitles, clearSubtitles, subtitleDisplay, tickSubtitles, type SubtitleCommand} from './subtitles';
import {TransportKeys} from './system-media';

/**
 * `NativeModules.PorticoPlaybackModule` and the `PorticoPlayer` view, over the SDK's W3C media
 * element. The contract is the Apple controller's (`PorticoPlaybackController`): one engine,
 * leased to one owner; driven by commands that each carry the whole desired state and a rising
 * revision; reporting facts that carry the binding they belong to, a rising sequence and the
 * revision of the last command applied. Events: `PorticoPlaybackFact`,
 * `PorticoListeningSnapshot`, `PorticoPictureInPicture`.
 *
 * What the media element cannot do (SDK 0.24): change speed (`supportedRates` is `[1]`), open an
 * `http:` address, or play HLS from an address. The server's HLS is played by `hls.ts`, which
 * fetches the segments itself; a file plays from its address when that is HTTPS.
 *
 * Music and audiobooks play here too. Apple hands them to a native owner (the `listening…`
 * methods) so that they go on while JavaScript sleeps; a Vega app's JavaScript runs while it
 * plays, so the shared queue player keeps them itself and those methods refuse or do nothing
 * (`overrides/native/bridge/native-listening-kinds.ts`).
 */
export const playbackEvents = new ModuleEvents();

type Binding = Readonly<{lease: string; intentId: number; sessionId: string; generation: number; itemId: string}>;
type PendingSeek = Readonly<{revision: number; positionSeconds: number}>;
type AudioBinding = Readonly<Record<string, unknown>>;
type AudioCommand = Readonly<{binding: AudioBinding; epoch: number; renditions: readonly Readonly<{id: string; name: string}>[]; defaultRenditionId: string; pending: Readonly<{revision: number; renditionId: string}> | null}>;
type Command = Readonly<{
  binding: Binding;
  source: string;
  paused: boolean;
  rate: number;
  commandRevision: number;
  pendingSeek?: PendingSeek | null;
  connectionState?: string;
  routeRevision?: number;
  timelineOriginMs?: number | null;
  audio?: AudioCommand | null;
  subtitles?: SubtitleCommand | null;
}>;

const MAX = 9007199254740991;
const whole = (value: unknown, least: number): value is number => typeof value === 'number' && Number.isFinite(value) && Math.floor(value) === value && value >= least && value <= MAX;
const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);

const PROGRESS_MS = 500, SUBTITLE_MS = 100;
const SEEK_LIMIT_MS = 10000;
// The Apple module's words, which the shared player shows as they are.
const RATE_UNAVAILABLE = 'This speed is unavailable for this media. Choose a supported speed, then press Play.';
const SEEK_UNAVAILABLE = 'That position is not available yet. Try seeking again.';
const NETWORK_ERROR = 'The media connection was interrupted. Verifying another route.';
const MEDIA_ERROR = 'This media could not be played. Check its format or try again.';

const instanceId = uuid();
let lease: string | undefined, owner: string | undefined;
let commandRevision = 0, factSequence = 0;
let accepted: Command | undefined;
let engine: Engine | undefined;
/** The surface the mounted `PorticoPlayer` view draws on. */
let surface: string | null = null;
/** The app's component, which the system addresses transport keys to. */
let component: unknown;

/** One media element playing one source for one binding. */
class Engine {
  readonly id = uuid();
  private readonly player = new VideoPlayer();
  private opened = false;
  private closed = false;
  private ready = false;
  private shown = false;
  private waiting = false;
  private over = false;
  private failed = false;
  private wantPaused = true;
  private attached: string | null = null;
  private seekRevision = -1;
  private seek?: {revision: number; timer: ReturnType<typeof setTimeout>};
  private ticker?: ReturnType<typeof setInterval>;
  private captions?: ReturnType<typeof setInterval>;
  private audioKey = '';
  private audioRevision = 0;
  private audioSequence = 0;
  private readonly listeners: [string, () => void][] = [];
  private hls?: HlsSource;
  private keyed = false;
  private described = false;
  private filled = false;

  constructor(readonly binding: Binding, readonly source: string, private start: number) {
    void this.open();
  }

  private on(type: string, listener: () => void): void {
    this.listeners.push([type, listener]);
    const traced = () => { trace('media ' + type); listener(); };
    this.listeners[this.listeners.length - 1][1] = traced;
    this.player.addEventListener(type, traced);
  }

  private async open(): Promise<void> {
    try {
      await this.player.initialize();
    } catch (error) {
      trace(`player initialize failed: ${String((error as Error)?.message ?? error)}`, true);
      this.fail(false, 'engine_error', 'initialize');
      return;
    }
    if (this.closed) { void this.player.deinitialize().catch(() => {}); return; }
    this.opened = true;
    this.on('loadedmetadata', () => { this.described = true; this.loaded(); });
    this.on('playing', () => { this.waiting = false; if (!this.shown) { this.shown = true; this.publish('firstFrame'); } this.publish('rateStatus'); });
    this.on('pause', () => this.publish('rateStatus'));
    // Running dry while playing is a stall; waiting for a seek or for the first picture is not.
    this.on('waiting', () => { this.waiting = true; if (this.shown && !this.seek) this.publish('stalled'); });
    this.on('seeked', () => this.sought(true));
    this.on('ended', () => { this.over = true; this.publish('ended'); });
    this.on('error', () => {
      const code = Number((this.player.error as {code?: number} | null)?.code);
      // 2 is the network; 3 a decode failure; 4 a source the element will not take.
      this.fail(code === 2, code === 3 ? 'decode_error' : code === 4 ? 'source_not_supported' : 'engine_error', `media error ${code}`);
    });
    this.player.autoplay = false;
    this.attach();
    this.takeKeys();
    if (/\.m3u8(\?|#|$)/i.test(this.source)) {
      this.hls = new HlsSource(this.player, this.source, error => this.fail(error.network, 'engine_error', error.message));
      // Filled from where playback will start, not from the beginning.
      const first = accepted && engine === this ? accepted.pendingSeek?.positionSeconds : undefined;
      void this.hls.open(first ?? this.start).then(() => { this.filled = true; this.loaded(); });
    } else if (/^https:/i.test(this.source)) {
      this.filled = true;
      this.player.src = this.source;
    } else {
      // The element opens an address itself only over HTTPS (see `capability-profile.ts`).
      this.fail(false, 'source_not_supported', 'insecure address');
      return;
    }
    this.ticker = setInterval(() => { if (this.ready && !this.over && !this.failed) this.publish('progress'); }, PROGRESS_MS);
    this.captions = setInterval(() => { if (this.ready && engine === this) tickSubtitles(this.position()); }, SUBTITLE_MS);
  }

  /** The remote's transport keys and voice requests go to the shared player, not to the element. */
  private takeKeys(): void {
    if (this.keyed || !component || !this.opened || this.closed) return;
    this.keyed = true;
    void this.player.setMediaControlFocus(component as never, new TransportKeys()).catch(error => trace(`media control focus: ${String((error as Error)?.message ?? error)}`, true));
  }

  /** Gives the element the view's surface, or takes it away. */
  attach(): void {
    this.takeKeys();
    if (!this.opened || this.closed || this.attached === surface) return;
    try {
      if (this.attached) this.player.clearSurfaceHandle(this.attached);
      if (surface) this.player.setSurfaceHandle(surface);
      this.attached = surface;
    } catch (error) {
      trace(`surface: ${String((error as Error)?.message ?? error)}`, true);
    }
  }

  /** Ready once the element knows what it is playing and the stream has its first data. */
  private loaded(): void {
    if (this.closed || this.ready || this.failed || !this.described || !this.filled) return;
    this.ready = true;
    // A source reopened under the same binding (another route to the same item) resumes where it was.
    if (this.start > 0) { this.hls?.seek(this.start); try { this.player.currentTime = this.elementTime(this.start); } catch { /* starts from the beginning */ } }
    this.publish('ready');
    if (accepted && engine === this) this.apply(accepted);
    // Nothing sent the element anywhere: it plays from where the stream was filled.
    if (!this.seek) this.hls?.settled();
  }

  apply(command: Command): void {
    this.wantPaused = command.paused;
    if (!this.ready || this.closed || this.failed) return;
    const pending = command.pendingSeek;
    if (pending && pending.revision > this.seekRevision) {
      this.seekRevision = pending.revision;
      if (this.seek) clearTimeout(this.seek.timer);
      this.seek = {revision: pending.revision, timer: setTimeout(() => this.sought(false), SEEK_LIMIT_MS)};
      this.over = false;
      const position = Math.max(0, pending.positionSeconds);
      this.hls?.seek(position);
      // The element says nothing when it is sent to where it already is.
      if (Math.abs(Number(this.player.currentTime) - this.elementTime(position)) < 0.25) this.sought(true);
      else { try { this.player.currentTime = this.elementTime(position); } catch { this.sought(false); } }
    }
    applySubtitles(command.subtitles, error => this.publish('subtitleStatus', {error}));
    this.applyAudio(command.audio);
    if (this.wantPaused) { if (!this.player.paused) this.player.pause(); }
    else if (this.player.paused && !this.over) void this.player.play().catch(() => this.fail(false, 'engine_error', 'play'));
  }

  /**
   * The player's audio choice. The server's renditions are known to the player by the names in
   * the playlist; which of them this stream has is told once (`audioMapped`), then what is
   * playing (`audioObserved`), and each change asked for is answered (`audioApplied` or
   * `audioFailed`).
   */
  private applyAudio(audio: AudioCommand | null | undefined): void {
    const hls = this.hls;
    if (!audio || !hls || !Array.isArray(audio.renditions)) return;
    const stamp = {audioBinding: audio.binding, audioEpoch: audio.epoch};
    const offered = hls.audio();
    const indexOf = (id: string) => { const name = audio.renditions.find(rendition => rendition.id === id)?.name; return name === undefined ? -1 : offered.findIndex(rendition => rendition.name === name); };
    const playing = () => audio.renditions.find(rendition => rendition.name === offered[hls.audioIndex()]?.name)?.id ?? null;
    const key = JSON.stringify([audio.binding, audio.epoch]);
    if (key !== this.audioKey) {
      this.audioKey = key; this.audioRevision = 0; this.audioSequence = 0;
      this.publish('audioMapped', {...stamp, renditionIds: audio.renditions.filter(rendition => indexOf(rendition.id) >= 0).map(rendition => rendition.id)});
      this.publish('audioObserved', {...stamp, audioSequence: ++this.audioSequence, renditionId: playing()});
    }
    const pending = audio.pending;
    if (!pending || pending.revision <= this.audioRevision) return;
    this.audioRevision = pending.revision;
    const index = indexOf(pending.renditionId);
    if (index < 0) { this.publish('audioUnavailable', {...stamp, renditionId: pending.renditionId}); this.publish('audioFailed', {...stamp, audioRevision: pending.revision}); return; }
    hls.selectAudio(index).then(
      () => {
        if (key !== this.audioKey) return;
        this.publish('audioApplied', {...stamp, audioRevision: pending.revision, renditionId: pending.renditionId});
        this.publish('audioObserved', {...stamp, audioSequence: ++this.audioSequence, renditionId: playing()});
      },
      () => { if (key === this.audioKey) this.publish('audioFailed', {...stamp, audioRevision: pending.revision}); },
    );
  }

  private sought(applied: boolean): void {
    const seek = this.seek;
    if (!seek || this.closed) return;
    clearTimeout(seek.timer);
    this.seek = undefined;
    this.hls?.settled();
    this.publish(applied ? 'seekApplied' : 'seekFailed', {seekRevision: seek.revision, error: applied ? '' : SEEK_UNAVAILABLE});
  }

  private fail(network: boolean, code: string, detail: string): void {
    if (this.closed || this.failed) return;
    this.failed = true;
    try { this.player.pause(); } catch { /* never started */ }
    this.publish('error', {paused: true, networkError: network, engineCode: network ? '' : code, errorDetail: detail, error: network ? NETWORK_ERROR : MEDIA_ERROR});
  }

  /** The element's clock for a position in the item (they differ for a stream: see `hls.ts`). */
  private elementTime(position: number): number { return this.hls ? this.hls.elementTime(position) : position; }

  /** Where playback is in the item, in seconds. */
  position(): number {
    if (!this.opened) return this.start;
    const position = this.hls ? this.hls.position() : Number(this.player.currentTime);
    return Number.isFinite(position) ? position : 0;
  }

  private publish(type: string, extra: Readonly<Record<string, unknown>> = {}): void {
    if (this.closed || engine !== this || !lease || !accepted) return;
    const paused = this.opened ? this.player.paused : true;
    const moving = this.ready && !paused && !this.waiting && !this.over && !this.failed;
    if (type !== 'progress' || factSequence % 4 === 0) trace(`fact ${type} at ${this.position().toFixed(2)} paused=${paused} moving=${moving} seek=${!!this.seek} ${JSON.stringify(extra).slice(0, 160)}`);
    playbackEvents.emit('PorticoPlaybackFact', {
      instanceId, type, intentId: this.binding.intentId, position: this.position(), paused: paused && !this.seek, error: '',
      effectiveRate: moving ? 1 : 0, supportedRates: [1], rateReady: this.ready, rateWaiting: this.waiting && !paused,
      rateError: this.ready && accepted.rate !== 1 ? RATE_UNAVAILABLE : '', monotonicSeconds: Date.now() / 1000,
      ...extra,
      itemInstanceId: this.id, binding: this.binding, factSequence: ++factSequence, lastCommandRevision: commandRevision,
      seeking: !!this.seek || !!accepted.pendingSeek,
    });
  }

  close(): void {
    if (this.closed) return;
    this.closed = true;
    if (this.ticker) clearInterval(this.ticker);
    if (this.captions) clearInterval(this.captions);
    clearSubtitles();
    if (this.seek) clearTimeout(this.seek.timer);
    this.hls?.close();
    if (!this.opened) return;
    for (const [type, listener] of this.listeners) this.player.removeEventListener(type, listener);
    try { this.player.pause(); } catch { /* not playing */ }
    try { if (this.attached) this.player.clearSurfaceHandle(this.attached); } catch { /* the view went first */ }
    void this.player.deinitialize().catch(() => {});
  }
}

function acquire(name: string): Promise<{lease: string; instanceId: string}> {
  if (typeof name !== 'string' || name.length < 1 || name.length > 128 || (lease && owner !== name)) return Promise.reject(failure('owner_busy', 'Another player owns playback.'));
  if (!lease) { owner = name; lease = uuid(); commandRevision = 0; factSequence = 0; accepted = undefined; }
  return Promise.resolve({lease, instanceId});
}

/** The Apple controller's checks, in its order and with its words. */
function refusal(command: Command): string | null {
  const binding = command?.binding;
  if (!binding || typeof binding !== 'object' || binding.lease !== lease || !lease) return 'Playback lease is no longer active.';
  if (typeof command.paused !== 'boolean') return 'Invalid paused flag.';
  if (typeof command.source !== 'string' || typeof command.rate !== 'number' || !Number.isFinite(command.rate)) return 'Invalid playback command.';
  if (!whole(binding.intentId, 1) || !whole(binding.generation, 1)) return 'Invalid playback binding.';
  if (!whole(command.commandRevision, 1)) return 'Invalid playback revision.';
  if (command.commandRevision < commandRevision) return 'Stale playback command.';
  if (command.commandRevision === commandRevision) return same(accepted, command) ? null : 'Conflicting playback command.';
  if (typeof binding.sessionId !== 'string' || typeof binding.itemId !== 'string') return 'Invalid playback binding.';
  if (command.connectionState !== undefined && (!['ready', 'verifying'].includes(command.connectionState) || !whole(command.routeRevision, 0))) return 'Invalid route transition.';
  if (accepted?.routeRevision !== undefined && (command.routeRevision === undefined || command.routeRevision < accepted.routeRevision)) return 'Stale route transition.';
  return null;
}

function command(value: Command): Promise<boolean> {
  const problem = refusal(value);
  trace(`command r${value?.commandRevision} paused=${value?.paused} seek=${JSON.stringify(value?.pendingSeek ?? null)} subtitles=${value?.subtitles?.mode ?? 'none'} audio=${value?.audio ? `${value.audio.renditions?.length} renditions, pending ${JSON.stringify(value.audio.pending)}` : 'none'}${problem ? ' refused: ' + problem : ''}`, !!problem);
  if (problem) return Promise.reject(failure('command_rejected', problem));
  if (value.commandRevision === commandRevision) return Promise.resolve(true);
  commandRevision = value.commandRevision;
  accepted = value;
  if (!engine || !same(engine.binding, value.binding) || engine.source !== value.source) {
    // The same binding with another address is another route to the same item: it carries on.
    const carried = engine && same(engine.binding, value.binding) ? engine.position() : 0;
    engine?.close();
    engine = value.source ? new Engine(value.binding, value.source, carried) : undefined;
  }
  engine?.apply(value);
  return Promise.resolve(true);
}
function release(held: string): Promise<boolean> {
  if (held && held === lease) {
    engine?.close();
    engine = undefined;
    lease = undefined;
    owner = undefined;
    accepted = undefined;
  }
  return Promise.resolve(true);
}

const unavailable = () => Promise.reject(failure('listening_unavailable', 'This device has no separate listening owner.'));

export const PorticoPlaybackModule = withEvents({
  acquire,
  command,
  release,
  adoptListeningSession: unavailable,
  listeningSessionUpdated: (..._args: unknown[]): Promise<void> => Promise.resolve(),
  purgeAudioCache: (): Promise<void> => Promise.resolve(),
  listeningAdvance: unavailable,
  listeningRoute: (..._args: unknown[]): Promise<void> => Promise.resolve(),
  listeningAction: unavailable,
  listeningSnapshot: (..._args: unknown[]): Promise<null> => Promise.resolve(null),
  acknowledgeListening: (..._args: unknown[]): Promise<void> => Promise.resolve(),
  listeningPolicy: (..._args: unknown[]): Promise<void> => Promise.resolve(),
  listeningDeadlines: (..._args: unknown[]): Promise<void> => Promise.resolve(),
  listeningCredentials: (..._args: unknown[]): Promise<void> => Promise.resolve(),
  retireListening: (..._args: unknown[]): Promise<void> => Promise.resolve(),
  listeningMetadata: (..._args: unknown[]): void => {},
  listeningSkipIntervals: (_back: number, _forward: number): void => {},
}, playbackEvents);

/**
 * The surface the picture is drawn on. As on Apple, the view's lifetime and the lease's are
 * separate: the engine plays without a surface, and takes whichever one is mounted.
 */
export function PorticoPlayer({lease: _lease, pictureInPictureRequest: _request, children: _children, onLayout, ...view}: ViewProps & {lease: string; pictureInPictureRequest?: number}): React.ReactElement {
  const app = useKeplerAppStateManager();
  component ??= app.getComponentInstance();
  const created = useCallback((handle: string) => { surface = handle; engine?.attach(); }, []);
  const destroyed = useCallback(() => { surface = null; engine?.attach(); }, []);
  useEffect(() => destroyed, [destroyed]);
  const [size, setSize] = useState({width: 0, height: 0});
  const laidOut = useCallback((event: LayoutChangeEvent) => { const {width, height} = event.nativeEvent.layout; setSize({width, height}); onLayout?.(event); }, [onLayout]);
  return React.createElement(View, {...view, onLayout: laidOut},
    React.createElement(KeplerVideoSurfaceView, {style: StyleSheet.absoluteFill, onSurfaceViewCreated: created, onSurfaceViewDestroyed: destroyed}),
    React.createElement(SubtitleLabel, size));
}

/**
 * The subtitle text, laid out as the Apple view lays it out: a band nine tenths of the picture
 * wide, text centered in white on a 70% black backing, sized to the picture (3.5% of its width,
 * between 12 and 40), a twelfth of the picture's height up from the bottom, or at the top when
 * the cue says so. (The Apple view measures the picture inside the view; here the view's own
 * size is used, which differs only for a picture narrower than the screen.)
 */
function SubtitleLabel({width, height}: {width: number; height: number}): React.ReactElement | null {
  const cue = useSyncExternalStore(subtitleDisplay.subscribe, subtitleDisplay.current);
  if (!cue.text || !width || !height) return null;
  const fontSize = Math.max(12, Math.min(40, width * 0.035));
  return React.createElement(View, {
    pointerEvents: 'none',
    accessible: true,
    style: [{position: 'absolute', left: width * 0.05, width: width * 0.9, maxHeight: height * 0.6, paddingVertical: 4, backgroundColor: 'rgba(0,0,0,0.7)'}, cue.top ? {top: 8} : {bottom: Math.max(8, height * 0.08)}],
  }, React.createElement(Text, {style: {color: '#ffffff', textAlign: 'center', fontSize, lineHeight: Math.round(fontSize * 1.25), fontWeight: '500', fontStyle: cue.italic ? 'italic' : 'normal'}}, cue.text));
}
