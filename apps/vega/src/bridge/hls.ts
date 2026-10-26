import {MediaSource, type SourceBuffer, type VideoPlayer} from '@amazon-devices/react-native-w3cmedia';
import {trace} from '../debug';
import {checkResponse, onCredentialExposure, originOf, requestCredentials} from './credential-boundary';
import {isVideoCodec, liveStart, numberAt, parseMaster, parseMedia, segmentAtDate, segmentNumbered, type Playlist, type Rendition, type Segment} from './hls-playlist';

export type {Rendition};

/**
 * Plays the server's HLS through media source extensions: the app fetches the playlists and the
 * segments, and hands the bytes to the media element. On Vega this is the only way to play from a
 * server reached over plain HTTP (the element refuses to open such an address itself), and the
 * only way to play HLS at all (the element has no HLS client).
 *
 * It reads what the Portico server writes (`hls-playlist.ts`), in two ways:
 *
 * - **A title.** Positions are seconds from the start of the playlist. The segments are given to
 *   the element with the timestamps they carry, which do not start at zero: `offset` is the
 *   difference, found from the first segment.
 * - **A live channel** (`originMs` given). The playlist slides and a change of programme restarts
 *   the segments' own clock, so nothing can be read from their timestamps. Each segment is asked
 *   to follow the one before it wherever its own clock says it belongs (the source buffer's
 *   `sequence` mode), where each one really landed is read back from the buffer, and a position
 *   is the moment of broadcast the playlist gives for that segment, counted from the channel's
 *   origin. Where the device does not place segments in sequence, a change of programme lands
 *   somewhere else in the element's time and playback is carried across to it.
 *
 * Because every byte passes through here, this is also where the connection is measured for
 * Automatic quality: how fast the segments came while they were being fetched one after another.
 */

/**
 * Why a stream stopped. `status` is the server's answer when it gave one (400 to 599). `network`
 * is true when it gave none, or gave one that waiting may change. `refused` is set when the
 * media element would not take the stream at all (`unsupported`) or its bytes (`decode`).
 */
export class SourceError extends Error {
  constructor(readonly network: boolean, detail: string, readonly status = 0, readonly refused: '' | 'unsupported' | 'decode' = '') { super(detail); }
}

/** Only a refused rendition playlist (422) requests the contract's default fallback. */
export class AudioRenditionUnavailable extends SourceError {}
export type AudioSelectionOwner = Readonly<{current: () => boolean; sourceCurrent: () => boolean; willMutate: () => void}>;
export type AudioSelection = Readonly<{done: Promise<void>; cancel: () => void}>;
type AudioOperation = {owner: AudioSelectionOwner; controller: AbortController; baseGeneration: number; commitGeneration?: number;
  cancelled: boolean; completed: boolean; mutated: boolean; writing: boolean; clock?: () => boolean; current: () => boolean};

const AHEAD_S = 30, BEHIND_S = 30, RELOAD_MS = 4000, IDLE_MS = 400;
/** The server answers 503 while it is still writing a segment. */
const PREPARING_TRIES = 30, PREPARING_MS = 1000;
/** A measurement of the connection is said only while it is fresh, and only from a download big
 * enough to say something. */
const FRESH_MS = 15000, MEASURED_BYTES = 65536;

const wait = (ms: number) => new Promise<void>(resolve => setTimeout(resolve, ms));

type Track = {kind: 'video' | 'audio'; url: string; playlist: Playlist; buffer: SourceBuffer; /** The number of the segment to fetch next. */ next: number; loaded: number};
/** A segment in the element's own time: where it landed in the buffer. */
type Placed = {number: number; start: number; end: number; dateMs?: number};
type Arrival = {dateMs: number; resolve(elementTime: number): void; reject(error: Error): void};

export class HlsSource {
  private readonly source = new MediaSource();
  private tracks: Track[] = [];
  private renditions: Rendition[] = [];
  private generation = 0;
  private closed = false;
  private requests = new Set<XMLHttpRequest>();
  private readonly pending = new Set<() => void>();
  private audioOperation?: AudioOperation;
  private audioDirty = false;
  private audioHold?: AudioOperation;
  private readonly pumpRuns = new Map<number, Promise<void | 'held'>>();
  /** Where playback is headed while a seek is being asked for. */
  private target: number | undefined;
  /**
   * A title: how far the element's clock runs ahead of the playlist's. The server's segments do
   * not start at zero (its packager starts them a second in), and a media source keeps the
   * timestamps it is given; a player with its own HLS client hides this. Positions given to and
   * by this class are the playlist's; `elementTime` and `position` convert.
   */
  private offset = 0;
  /** A live channel: the segments in the buffer, oldest first, and a seek waiting for its segment. */
  private placed: Placed[] = [];
  private arrival: Arrival | undefined;
  private begin = NaN;
  private samples: {bytes: number; ms: number; at: number}[] = [];

  /** `originMs`: the channel's origin (milliseconds since 1970) for a live channel; absent for a title. */
  private readonly stopExposure: () => void;
  constructor(private readonly player: VideoPlayer, private readonly url: string, private readonly failed: (error: SourceError) => void, private readonly originMs?: number) {
    this.stopExposure = onCredentialExposure(({origin, origins = [origin]}) => {
      if (!this.closed && origins.includes(originOf(this.url))) { this.close(); this.failed(new SourceError(false, 'media credential exposed')); }
    });
  }

  private get live(): boolean { return this.originMs !== undefined; }

  /** The element's clock for a position in a title. */
  elementTime(position: number): number { return position + this.offset; }

  /** Where playback is: seconds into the title, or on the channel's timeline. NaN while a
   * channel's place is not known yet. */
  position(): number {
    const now = Number(this.player.currentTime);
    if (!this.live) return Math.max(0, now - this.offset);
    const at = this.placedAt(now);
    if (!at || at.dateMs === undefined) return NaN;
    return (at.dateMs + Math.max(0, Math.min(at.end, now) - at.start) * 1000 - this.originMs!) / 1000;
  }

  /** A channel: the element's time to begin at once the stream is open. NaN for a title. */
  beginning(): number { return this.begin; }

  /** Which of `audio()` is playing, or -1. */
  audioIndex(): number {
    const track = this.tracks.find(candidate => candidate.kind === 'audio');
    if (this.closed || !track || this.audioDirty || !this.spans(track.buffer).some(([start, end]) => start <= Number(this.player.currentTime) && end > Number(this.player.currentTime))) return -1;
    return this.renditions.findIndex(rendition => rendition.url === track.url);
  }

  /** Whether the stream has a picture (known once it is open). */
  hasPicture(): boolean { return this.tracks.some(track => track.kind === 'video'); }

  /** The audio renditions the server offers, in its order (empty when audio is with the video). */
  audio(): readonly Rendition[] { return this.renditions; }

  /**
   * What the downloads of the last few seconds say of the connection, in kilobits a second, or
   * undefined when nothing fresh was measured (a full buffer downloads nothing, and an old figure
   * says nothing about the connection now).
   */
  throughputKbps(): number | undefined {
    const now = Date.now();
    this.samples = this.samples.filter(sample => now - sample.at <= FRESH_MS);
    const bytes = this.samples.reduce((sum, sample) => sum + sample.bytes, 0), ms = this.samples.reduce((sum, sample) => sum + sample.ms, 0);
    if (!bytes || !ms) return undefined;
    return Math.max(1, Math.min(1000000, Math.round((bytes * 8) / ms)));
  }

  /** Seconds of media held ahead of where playback is. */
  bufferedSeconds(): number {
    const track = this.tracks[0];
    if (!track) return 0;
    try {
      const ranges = track.buffer.buffered, now = Number(this.player.currentTime);
      for (let index = 0; index < ranges.length; index++) if (ranges.start(index) <= now + 0.1 && ranges.end(index) > now) return Math.max(0, ranges.end(index) - now);
    } catch { /* not readable while updating */ }
    return 0;
  }

  private get<T extends 'text' | 'arraybuffer'>(url: string, type: T, signal?: AbortSignal): Promise<T extends 'text' ? string : ArrayBuffer> {
    return new Promise((resolve, reject) => {
      let active: XMLHttpRequest | undefined, retry: ReturnType<typeof setTimeout> | undefined;
      const clean = () => {clearTimeout(retry); signal?.removeEventListener('abort', abort);};
      const refuse = (error: SourceError) => {clean(); reject(error);};
      const accept = (value: any) => {clean(); resolve(value);};
      const abort = () => {clearTimeout(retry); try {active?.abort();} catch { /* already completed */ } refuse(new SourceError(false, 'superseded'));};
      if (signal?.aborted) {abort(); return;}
      signal?.addEventListener('abort', abort, {once: true});
      const attempt = (left: number) => {
        if (this.closed || signal?.aborted) { refuse(new SourceError(false, this.closed ? 'closed' : 'superseded')); return; }
        try { if (originOf(url) !== originOf(this.url)) throw new Error('Media origin changed.'); requestCredentials(url, {}, null); } catch { refuse(new SourceError(false, 'invalid media origin')); return; }
        const request = new XMLHttpRequest(); active = request;
        this.requests.add(request);
        request.open('GET', url);
        request.responseType = type;
        request.timeout = 20000;
        request.withCredentials = false;
        request.setRequestHeader('Cache-Control', 'no-store');
        const limit = type === 'text' ? 1048576 : 33554432;
        const sent = Date.now();
        let answered = 0;
        const invalid = () => {
          if (request.status === 0 && !request.responseURL) return false;
          try { checkResponse(url, request.responseURL, request.status, true); } catch { this.requests.delete(request); request.abort(); refuse(new SourceError(false, 'media redirect')); return true; }
          const size = type === 'text' ? request.responseText?.length ?? 0 : (request.response as ArrayBuffer | null)?.byteLength ?? 0;
          if (Number(request.getResponseHeader('Content-Length')) > limit || size > limit) { this.requests.delete(request); request.abort(); refuse(new SourceError(false, 'media response too large')); return true; }
          return false;
        };
        request.onreadystatechange = () => { if (request.readyState >= 2) { if (invalid()) return; if (!answered) answered = Date.now(); } };
        request.onprogress = () => { invalid(); };
        const done = () => {this.requests.delete(request); if (active === request) active = undefined;};
        request.onload = () => {
          done();
          if (invalid()) return;
          const status = request.status;
          if (signal?.aborted) {refuse(new SourceError(false, 'superseded')); return;}
          if (status === 503 && left > 0) { retry = setTimeout(() => attempt(left - 1), PREPARING_MS); return; }
          if (status < 200 || status >= 300) { refuse(new SourceError(status === 0 || status === 408 || status === 429 || status >= 500, `status ${status}`, status >= 400 && status <= 599 ? status : 0)); return; }
          if (type === 'arraybuffer') this.measure((request.response as ArrayBuffer | null)?.byteLength ?? 0, answered || sent, sent);
          accept((type === 'text' ? request.responseText : request.response) as never);
        };
        request.onerror = () => { done(); refuse(new SourceError(true, 'request failed')); };
        request.ontimeout = () => { done(); refuse(new SourceError(true, 'request timed out')); };
        request.onabort = () => { done(); refuse(new SourceError(false, 'closed')); };
        try {request.send();} catch {done(); refuse(new SourceError(true, 'request failed'));}
      };
      attempt(PREPARING_TRIES);
    });
  }

  /**
   * One download, as a measurement of the connection. The time counted is from the server's
   * first word to the last byte, so a segment the server was still writing does not read as a
   * slow connection; when that time is too short to mean anything, the whole request is counted.
   */
  private measure(bytes: number, answered: number, sent: number): void {
    if (bytes < MEASURED_BYTES) return;
    const now = Date.now();
    const ms = now - answered >= 20 ? now - answered : Math.max(1, now - sent);
    this.samples.push({bytes, ms, at: now});
    if (this.samples.length > 6) this.samples.shift();
  }

  /**
   * Opens the stream on the media element, to start at `position` (seconds into a title; on the
   * channel's timeline for a channel, where anything that is not a number means "where live
   * viewing begins"). Resolves once the first picture data is in and the clocks can be told
   * apart; a failure is reported to `failed`.
   */
  async open(position: number): Promise<void> {
    const generation = ++this.generation;
    try {
      this.assertCurrent(generation);
      const text = await this.get(this.url, 'text');
      this.assertCurrent(generation);
      const master = parseMaster(text, this.url);
      // A media playlist given directly is one muxed track.
      const video = master?.video ?? this.url, codecs = master?.codecs ?? [];
      this.renditions = master?.audio ?? [];
      const chosen = this.renditions.find(rendition => rendition.isDefault) ?? this.renditions[0];
      const [videoList, audioList] = await Promise.all([
        master ? this.get(video, 'text').then(body => this.read(body, video)) : Promise.resolve(this.read(text, video)),
        chosen ? this.get(chosen.url, 'text').then(body => this.read(body, chosen.url)) : Promise.resolve(null),
      ]);
      this.assertCurrent(generation);
      await this.attach(generation);
      this.assertCurrent(generation);
      const videoCodecs = codecs.filter(isVideoCodec), audioCodecs = codecs.filter(codec => !isVideoCodec(codec));
      // Music and audiobooks are a stream with no picture: its one track is the sound.
      const soundOnly = codecs.length > 0 && videoCodecs.length === 0;
      const packets = (list: Playlist) => !list.init && /\.(ts|aac)(\?|$)/i.test(list.segments[0]?.url ?? '');
      // With separate audio the first track carries the picture only; otherwise both are in it.
      const firstType = soundOnly
        ? `${packets(videoList) ? 'video/mp2t' : 'audio/mp4'}; codecs="${audioCodecs.join(',')}"`
        : `${packets(videoList) ? 'video/mp2t' : 'video/mp4'}; codecs="${(audioList ? videoCodecs : codecs).join(',') || 'avc1.64001f,mp4a.40.2'}"`;
      this.tracks = [{kind: soundOnly ? 'audio' : 'video', url: video, playlist: videoList, buffer: this.add(firstType), next: 0, loaded: Date.now()}];
      if (audioList && chosen && !soundOnly) {
        // The server writes its audio renditions as MPEG-TS; the media source takes that as it is.
        const type = `${packets(audioList) ? 'video/mp2t' : 'audio/mp4'}; codecs="${audioCodecs.join(',') || 'mp4a.40.2'}"`;
        this.tracks.push({kind: 'audio', url: chosen.url, playlist: audioList, buffer: this.add(type), next: 0, loaded: Date.now()});
      }
      if (this.live) { await this.openLive(position, generation); return; }
      const total = Math.max(...this.tracks.map(track => track.playlist.segments.reduce((sum, segment) => sum + segment.duration, 0)));
      if (total > 0 && videoList.ended) { try { this.source.duration = total; } catch { /* the element works it out */ } }
      for (const track of this.tracks) await this.start(track, generation);
      // Filled from where playback will begin: the element is still at zero until it is sent there.
      this.assertCurrent(generation);
      this.target = position;
      this.point(position);
      const video0 = this.tracks[0], first = segmentNumbered(video0.playlist, video0.next);
      if (first) {
        await this.append(video0.buffer, await this.get(first.url, 'arraybuffer'), generation);
        this.assertCurrent(generation);
        video0.next = first.number + 1;
        try {
          const ranges = video0.buffer.buffered;
          const shift = ranges.length ? ranges.start(0) - first.start : 0;
          // A frame's worth of difference is how the picture is stored, not a shifted clock.
          this.offset = Number.isFinite(shift) && Math.abs(shift) > 0.1 ? shift : 0;
        } catch { this.offset = 0; }
        trace(`hls clock offset ${this.offset.toFixed(3)} s`);
      }
      this.assertCurrent(generation);
      this.startPump(generation);
    } catch (error) {
      if (generation === this.generation) this.fail(error);
    }
  }

  /** A channel: begin at `position` on its timeline, or where live viewing begins. */
  private async openLive(position: number, generation: number): Promise<void> {
    this.assertCurrent(generation);
    for (const track of this.tracks) {
      this.assertCurrent(generation);
      // Each segment follows the one before it, whatever its own clock says (a new programme
      // restarts it). A device that will not do that keeps the segments' own times, and playback
      // is carried over the gaps (`cross`).
      try { track.buffer.mode = 'sequence' as never; } catch { /* the segments' own times are used */ }
      await this.start(track, generation);
    }
    this.assertCurrent(generation);
    const list = this.tracks[0].playlist;
    const wanted = Number.isFinite(position) ? this.originMs! + position * 1000 : NaN;
    const first = (Number.isFinite(wanted) ? segmentAtDate(list, wanted) : undefined) ?? liveStart(list);
    if (!first) throw new SourceError(true, 'the channel has no segments yet');
    for (const track of this.tracks) track.next = first.number;
    const landed = await this.feed(this.tracks[0], first, generation);
    this.assertCurrent(generation);
    // Inside the segment when a moment was asked for and it holds that moment.
    const into = landed && Number.isFinite(wanted) && landed.dateMs !== undefined ? Math.max(0, Math.min(landed.end - landed.start, (wanted - landed.dateMs) / 1000)) : 0;
    this.begin = landed ? landed.start + into : NaN;
    trace(`hls channel begins at segment ${first.number}, element time ${this.begin.toFixed(2)}`);
    this.assertCurrent(generation);
    this.startPump(generation);
  }

  private read(text: string, url: string): Playlist {
    trace('hls playlist ' + (url.split('/').pop() ?? '').split('?')[0] + ': ' + text.split(/\r?\n/).filter(Boolean).slice(0, 12).map(line => line.trim().replace(/[A-Za-z0-9_-]{30,}/g, '<long>')).join(' | ').slice(0, 700));
    return parseMedia(text, url);
  }

  /** A source buffer for `type`, or the element's refusal of it. */
  private add(type: string): SourceBuffer {
    try { return this.source.addSourceBuffer(type); } catch (error) { throw new SourceError(false, `${type}: ${String((error as Error)?.message ?? error)}`, 0, 'unsupported'); }
  }

  private assertCurrent(generation: number, operation?: AudioOperation): void {
    if (this.closed) throw new SourceError(false, 'closed');
    if (generation !== this.generation || (operation && !operation.current())) throw new SourceError(false, 'superseded');
  }

  private attach(generation: number): Promise<void> {
    this.assertCurrent(generation);
    return new Promise((resolve, reject) => {
      let timer: ReturnType<typeof setTimeout> | undefined;
      const finish = (error?: SourceError) => {
        clearTimeout(timer); this.source.removeEventListener('sourceopen', opened); this.pending.delete(cancel);
        if (error) reject(error); else resolve();
      };
      const opened = () => finish();
      const cancel = () => finish(new SourceError(false, 'closed'));
      if (this.closed) {cancel(); return;}
      this.pending.add(cancel);
      this.source.addEventListener('sourceopen', opened);
      timer = setTimeout(() => finish(new SourceError(false, 'media source did not open')), 10000);
      try { this.player.srcObject = this.source as never; }
      catch (error) { finish(new SourceError(false, String((error as Error)?.message ?? error))); }
    });
  }

  /** The track's initialization segment. */
  private async start(track: Track, generation: number): Promise<void> {
    this.assertCurrent(generation);
    if (!track.playlist.init) return;
    await this.append(track.buffer, await this.get(track.playlist.init, 'arraybuffer'), generation);
  }

  /** Wait for an existing buffer operation; closing the source retires its wait immediately. */
  private free(buffer: SourceBuffer, signal?: AbortSignal): Promise<void> {
    return new Promise((resolve, reject) => {
      if (this.closed || signal?.aborted) {reject(new SourceError(false, this.closed ? 'closed' : 'superseded')); return;}
      let busy = false;
      try { busy = buffer.updating; } catch { /* asked as it was removed */ }
      if (!busy) { resolve(); return; }
      let timer: ReturnType<typeof setTimeout> | undefined;
      const finish = (error?: SourceError) => {
        clearTimeout(timer); buffer.removeEventListener('updateend', done); signal?.removeEventListener('abort', cancel); this.pending.delete(cancel);
        if (error) reject(error); else resolve();
      };
      const done = () => finish();
      const cancel = () => finish(new SourceError(false, signal?.aborted ? 'superseded' : 'closed'));
      this.pending.add(cancel); signal?.addEventListener('abort', cancel, {once: true});
      timer = setTimeout(done, 5000);
      buffer.addEventListener('updateend', done);
    });
  }

  private async append(buffer: SourceBuffer, data: ArrayBuffer, generation: number, operation?: AudioOperation): Promise<void> {
    await this.free(buffer, operation?.controller.signal);
    this.assertCurrent(generation, operation);
    return new Promise((resolve, reject) => {
      const off = () => { buffer.removeEventListener('updateend', done); buffer.removeEventListener('error', broke); operation?.controller.signal.removeEventListener('abort', cancel); this.pending.delete(cancel); };
      const done = () => { off(); resolve(); };
      const broke = () => { off(); reject(new SourceError(false, 'append failed', 0, 'decode')); };
      const cancel = () => {off(); try {if (operation && buffer.updating) buffer.abort();} catch { /* source retirement owns any partial pipeline */ } reject(new SourceError(false, operation?.controller.signal.aborted ? 'superseded' : 'closed'));};
      this.pending.add(cancel); operation?.controller.signal.addEventListener('abort', cancel, {once: true});
      buffer.addEventListener('updateend', done);
      buffer.addEventListener('error', broke);
      try { this.audioMutation(generation, operation, () => buffer.appendBuffer(data)); } catch (error) { off(); reject(new SourceError(false, String((error as Error)?.message ?? error), 0, 'decode')); }
    });
  }

  /** A superseded seek/audio switch cannot remove a successor's buffered data. */
  private async remove(buffer: SourceBuffer, from: number, to: number, generation: number, operation?: AudioOperation): Promise<void> {
    this.assertCurrent(generation, operation);
    if (!(to > from)) return;
    await this.free(buffer, operation?.controller.signal);
    this.assertCurrent(generation, operation);
    return new Promise((resolve, reject) => {
      const off = () => {buffer.removeEventListener('updateend', done); operation?.controller.signal.removeEventListener('abort', cancel); this.pending.delete(cancel);};
      const done = () => {off(); resolve();};
      const cancel = () => {off(); try {if (operation && buffer.updating) buffer.abort();} catch { /* removal may already be in flight */ } reject(new SourceError(false, operation?.controller.signal.aborted ? 'superseded' : 'closed'));};
      this.pending.add(cancel); operation?.controller.signal.addEventListener('abort', cancel, {once: true});
      buffer.addEventListener('updateend', done);
      try { this.audioMutation(generation, operation, () => buffer.remove(from, to)); } catch (error) {off(); reject(error instanceof SourceError ? error : new SourceError(false, 'buffer removal failed'));}
    });
  }

  private spans(buffer: SourceBuffer): [number, number][] {
    try {
      const ranges = buffer.buffered, spans: [number, number][] = [];
      for (let index = 0; index < ranges.length; index++) spans.push([ranges.start(index), ranges.end(index)]);
      return spans;
    } catch { return []; }
  }

  private ranges(track: Track): string {
    return this.spans(track.buffer).map(([start, end]) => `${start.toFixed(2)}-${end.toFixed(2)}`).join(',') || 'nothing';
  }

  private covered(track: Track, position: number): boolean {
    const at = position + this.offset;
    return this.spans(track.buffer).some(([start, end]) => start <= at + 0.05 && end > at + 0.5);
  }

  /** Aims every track at `position` seconds of a title. */
  private point(position: number): void {
    for (const track of this.tracks) track.next = numberAt(track.playlist, position);
  }

  /**
   * Called before the element is sent to `position`. Answers the element's time for it.
   *
   * A title: at once. What is already buffered there is kept; otherwise the tracks are emptied
   * and filled again from the segment that holds it, and the element waits there for the data.
   *
   * A channel: once the segment that was on air at that moment is in the buffer (at once when it
   * already is). A moment that has left the channel's window is its oldest segment; one that has
   * not been broadcast yet is where live viewing begins.
   */
  seek(position: number): number | Promise<number> {
    if (this.audioOperation) this.retireAudio(this.audioOperation);
    if (this.audioDirty) return this.live ? Promise.reject(new SourceError(false, 'audio pipeline interrupted')) : this.elementTime(position);
    if (this.closed || !this.tracks.length) return this.live ? Promise.reject(new SourceError(false, 'closed')) : this.elementTime(position);
    if (this.live) return this.seekLive(position);
    this.target = position;
    if (this.tracks.every(track => this.covered(track, position))) return this.elementTime(position);
    const generation = ++this.generation;
    void (async () => {
      try {
        for (const track of this.tracks) await this.remove(track.buffer, 0, Number.MAX_SAFE_INTEGER, generation);
        if (generation !== this.generation || this.closed) return;
        this.point(position);
        this.startPump(generation);
      } catch (error) {
        if (generation === this.generation) this.fail(error);
      }
    })();
    return this.elementTime(position);
  }

  private seekLive(position: number): Promise<number> {
    const dateMs = this.originMs! + position * 1000;
    this.arrival?.reject(new SourceError(false, 'superseded'));
    this.arrival = undefined;
    const held = this.placed.find(entry => entry.dateMs !== undefined && dateMs >= entry.dateMs && dateMs < entry.dateMs + (entry.end - entry.start) * 1000);
    if (held) return Promise.resolve(held.start + (dateMs - held.dateMs!) / 1000);
    const generation = ++this.generation;
    return new Promise<number>((resolve, reject) => {
      this.arrival = {dateMs, resolve, reject};
      void (async () => {
        try {
          for (const track of this.tracks) await this.remove(track.buffer, 0, Number.MAX_SAFE_INTEGER, generation);
          if (generation !== this.generation || this.closed) return;
          this.placed = [];
          const list = this.tracks[0].playlist;
          const on = segmentAtDate(list, dateMs), first = on ?? liveStart(list);
          if (!first) throw new SourceError(true, 'the channel has no segments');
          // A moment not broadcast yet is where live viewing begins: that is what is arrived at.
          if (!on && this.arrival) this.arrival = {...this.arrival, dateMs: first.dateMs ?? dateMs};
          for (const track of this.tracks) track.next = first.number;
          this.startPump(generation);
        } catch (error) {
          if (generation === this.generation) this.fail(error);
        }
      })();
    });
  }

  /** The element has arrived (or the seek was given up). */
  settled(): void { this.target = undefined; }

  private audioRanges(buffer: SourceBuffer): [number, number][] {
    try {
      const ranges = buffer.buffered, result: [number, number][] = [];
      for (let index = 0; index < ranges.length; index++) {
        const from = ranges.start(index), to = ranges.end(index);
        if (!Number.isFinite(from) || !Number.isFinite(to) || to < from) throw new Error();
        result.push([from, to]);
      }
      return result;
    } catch {throw new SourceError(false, 'audio buffer clock unavailable');}
  }

  /** Retiring an operation never leaves a stopped pump pretending to be current audio. */
  private retireAudio(operation: AudioOperation): void {
    if (operation.cancelled) return;
    const owns = this.audioOperation === operation, held = this.audioHold === operation;
    if (held) this.audioHold = undefined;
    if (owns) this.audioOperation = undefined;
    operation.cancelled = true;
    operation.controller.abort();
    if (!owns || operation.completed || this.closed || !operation.owner.sourceCurrent()) return;
    if (operation.mutated || operation.writing || this.audioDirty) {this.fail(new SourceError(false, 'audio pipeline interrupted')); return;}
    // This is a fresh root-source retirement operation. No retired continuation may resume a pump.
    if (operation.commitGeneration === this.generation) this.startPump(++this.generation);
    else if (held && operation.commitGeneration === undefined) this.startPump(this.generation);
  }

  private audioMutation(generation: number, operation: AudioOperation | undefined, write: () => void): void {
    this.assertCurrent(generation, operation);
    if (operation) {
      if (operation.clock && !operation.clock()) throw new SourceError(false, 'audio clock moved before mutation');
      operation.owner.willMutate();
      this.assertCurrent(generation, operation); // facts can synchronously retire the original owner
      if (operation.clock && !operation.clock()) throw new SourceError(false, 'audio clock moved before mutation');
      operation.writing = true;
    }
    try {
      write();
      if (operation) {operation.mutated = true; this.audioDirty = true;}
    } finally {if (operation) operation.writing = false;}
  }

  private async audioBarrier(operation: AudioOperation): Promise<void> {
    const signal = operation.controller.signal;
    await new Promise<void>((resolve, reject) => {
      const done = () => {signal.removeEventListener('abort', cancel); resolve();};
      const cancel = () => {signal.removeEventListener('abort', cancel); reject(new SourceError(false, 'superseded'));};
      if (signal.aborted) {cancel(); return;}
      signal.addEventListener('abort', cancel, {once: true});
      void Promise.allSettled([...this.pumpRuns.values()]).then(done);
    });
  }

  /** Real media at the active element clock, not a requested URL or init segment, commits a choice. */
  selectAudio(index: number, owner: AudioSelectionOwner): AudioSelection {
    if (this.audioOperation) this.retireAudio(this.audioOperation);
    const controller = new AbortController(), capturedOwner = Object.freeze({...owner});
    const operation: AudioOperation = {owner: capturedOwner, controller, baseGeneration: this.generation, cancelled: false, completed: false, mutated: false, writing: false,
      current: () => !this.closed && !operation.cancelled && this.audioOperation === operation && capturedOwner.current()
        && this.generation === (operation.commitGeneration ?? operation.baseGeneration)};
    this.audioOperation = operation;
    const done = this.changeAudio(index, operation);
    return Object.freeze({done, cancel: () => this.retireAudio(operation)});
  }

  private async changeAudio(index: number, operation: AudioOperation): Promise<void> {
    const requireCurrent = () => this.assertCurrent(operation.commitGeneration ?? operation.baseGeneration, operation);
    try {
      requireCurrent();
      const rendition = this.renditions[index], track = this.tracks.find(candidate => candidate.kind === 'audio');
      if (!rendition || !track) throw new SourceError(false, 'no such audio rendition');
      if (this.audioIndex() === index) {operation.completed = true; return;}
      let text: string;
      try {text = await this.get(rendition.url, 'text', operation.controller.signal);}
      catch (error) {if (error instanceof SourceError && error.status === 422) throw new AudioRenditionUnavailable(false, 'rendition playlist unavailable', 422); throw error;}
      requireCurrent();
      const playlist = this.read(text, rendition.url);
      const init = playlist.init ? await this.get(playlist.init, 'arraybuffer', operation.controller.signal) : undefined;
      requireCurrent();
      const position = this.target ?? this.position();
      if (!Number.isFinite(position)) throw new SourceError(false, 'audio clock unavailable');
      const segment = this.live ? segmentAtDate(playlist, this.originMs! + position * 1000) : segmentNumbered(playlist, numberAt(playlist, position));
      if (!segment) throw new SourceError(false, 'audio segment unavailable at current clock');
      const media = await this.get(segment.url, 'arraybuffer', operation.controller.signal);
      requireCurrent();
      const now = this.target ?? this.position();
      const start = this.live && segment.dateMs !== undefined ? (segment.dateMs - this.originMs!) / 1000 : segment.start;
      if (!Number.isFinite(now) || now < start || now >= start + segment.duration) throw new SourceError(false, 'audio clock moved during preparation');
      operation.clock = () => {
        const at = this.target ?? this.position();
        return Number.isFinite(at) && at >= start && at < start + segment.duration;
      };
      // Hold new work, then let the working pump finish accepted IO and update its cursors.
      // The generation is still the working pump's until this cancellable barrier settles.
      this.audioHold = operation;
      await this.audioBarrier(operation); requireCurrent();
      if (!operation.clock()) throw new SourceError(false, 'audio clock moved during preparation');
      let sequenceStart: number | undefined;
      if (this.live) {
        if (String(track.buffer.mode) !== 'sequence') throw new SourceError(false, 'audio sequence alignment unavailable');
        const placed = this.placedAt(Number(this.player.currentTime));
        if (!placed || placed.dateMs === undefined || segment.dateMs === undefined) throw new SourceError(false, 'audio alignment unavailable');
        sequenceStart = placed.start + (segment.dateMs - placed.dateMs) / 1000;
      }
      // All candidate bytes are in hand. The actually committed track/pump stayed live until here.
      operation.commitGeneration = ++this.generation;
      requireCurrent();
      await this.remove(track.buffer, 0, Number.MAX_SAFE_INTEGER, operation.commitGeneration, operation);
      requireCurrent();
      if (this.audioRanges(track.buffer).length) throw new SourceError(false, 'previous audio remained after removal');
      if (sequenceStart !== undefined) {
        await this.free(track.buffer, operation.controller.signal); requireCurrent();
        this.audioMutation(operation.commitGeneration, operation, () => {track.buffer.timestampOffset = sequenceStart!;});
      }
      if (init) await this.append(track.buffer, init, operation.commitGeneration, operation);
      requireCurrent();
      await this.append(track.buffer, media, operation.commitGeneration, operation);
      requireCurrent();
      const clock = Number(this.player.currentTime);
      if (!this.audioRanges(track.buffer).some(([from, to]) => from <= clock && to > clock)) throw new SourceError(false, 'selected audio did not cover the playback clock');
      track.url = rendition.url; track.playlist = playlist; track.loaded = Date.now(); track.next = segment.number + 1;
      requireCurrent();
      this.audioDirty = false; operation.completed = true;
      if (this.audioHold === operation) this.audioHold = undefined;
      this.startPump(operation.commitGeneration);
    } catch (error) {
      const held = this.audioHold === operation;
      if (held) this.audioHold = undefined;
      if (operation.current() && operation.owner.sourceCurrent()) {
        if (operation.mutated || operation.writing || this.audioDirty) this.fail(error);
        else if (operation.commitGeneration === this.generation) this.startPump(++this.generation);
        else if (held && operation.commitGeneration === undefined) this.startPump(this.generation);
      }
      operation.completed = true;
      throw error;
    }
  }

  // ── A channel's segments in the element's time ──────────────────────────

  /** The segment in the buffer that holds the element's time `now`: the one it is in, else the
   * last one that began before it. */
  private placedAt(now: number): Placed | undefined {
    let before: Placed | undefined;
    for (const entry of this.placed) {
      if (now >= entry.start - 0.05 && now < entry.end) return entry;
      if (entry.start <= now && (!before || entry.start > before.start)) before = entry;
    }
    return before ?? this.placed[0];
  }

  /** Fetches and appends one segment of `track`. For the first track of a channel, answers where
   * it landed in the element's time. */
  private async feed(track: Track, segment: Segment, generation: number): Promise<Placed | undefined> {
    this.assertCurrent(generation);
    const current = () => generation === this.generation && !this.closed;
    const data = await this.get(segment.url, 'arraybuffer');
    if (!current()) return undefined;
    const clock = this.live && track === this.tracks[0];
    const before = clock ? this.spans(track.buffer) : [];
    await this.append(track.buffer, data, generation);
    if (!current()) return undefined;
    track.next = segment.number + 1;
    if (!clock) return undefined;
    // Where it landed: the stretch of the buffer that is new. It follows the last segment when
    // the device places segments in sequence (or the stream's clock simply went on); after a
    // change of programme on a device that does not, it is a stretch somewhere else.
    const after = this.spans(track.buffer);
    const last = this.placed[this.placed.length - 1];
    let landed: [number, number] | undefined;
    const grown = last ? after.find(([start, end]) => start <= last.end + 0.25 && end > last.end + 0.05) : undefined;
    if (grown && last) landed = [last.end, grown[1]];
    else {
      const fresh = after.find(([start, end]) => !before.some(([s, e]) => Math.abs(s - start) < 0.01 && Math.abs(e - end) < 0.01));
      const was = fresh ? before.find(([s]) => Math.abs(s - fresh[0]) < 0.01) : undefined;
      if (fresh) landed = [was ? was[1] : fresh[0], fresh[1]];
    }
    if (!landed) return undefined;
    const entry: Placed = {number: segment.number, start: landed[0], end: landed[1], ...(segment.dateMs !== undefined ? {dateMs: segment.dateMs} : {})};
    this.placed.push(entry);
    const arrival = this.arrival;
    if (arrival) {
      // The moment asked for is in this segment, or (clamped to the channel's window) before it.
      const length = (entry.end - entry.start) * 1000;
      if (entry.dateMs === undefined || arrival.dateMs < entry.dateMs + length) {
        this.arrival = undefined;
        arrival.resolve(entry.start + (entry.dateMs === undefined ? 0 : Math.max(0, arrival.dateMs - entry.dateMs) / 1000));
      }
    }
    return entry;
  }

  /** A channel on a device that keeps the segments' own times: where the buffer stops because the
   * next segment landed elsewhere (a change of programme), playback is carried to it. */
  private cross(): void {
    const now = Number(this.player.currentTime);
    const here = this.placedAt(now);
    if (!here || this.player.paused || now < here.end - 0.2) return;
    const next = this.placed.find(entry => entry.number === here.number + 1);
    if (!next || Math.abs(next.start - here.end) < 0.25) return;
    trace(`hls channel carried from ${now.toFixed(2)} to ${next.start.toFixed(2)}`);
    try { this.player.currentTime = next.start + 0.01; } catch { /* the next pass tries again */ }
  }

  /** A channel: what has been played and left behind is given back. */
  private async trim(generation: number): Promise<void> {
    const here = this.placedAt(Number(this.player.currentTime));
    if (!here) return;
    let kept = 0;
    for (let index = this.placed.indexOf(here) - 1; index >= 0; index--) {
      const entry = this.placed[index];
      if (kept < BEHIND_S) { kept += entry.end - entry.start; continue; }
      for (const track of this.tracks) await this.remove(track.buffer, entry.start, entry.end, generation);
      this.assertCurrent(generation);
      this.placed.splice(index, 1);
    }
  }

  /** Keeps each track filled a little ahead of where playback is. */
  private startPump(generation: number): void {
    if (this.closed || this.audioHold || generation !== this.generation || this.pumpRuns.has(generation)) return;
    const run = this.pump(generation);
    this.pumpRuns.set(generation, run);
    void run.then(reason => {
      if (this.pumpRuns.get(generation) === run) this.pumpRuns.delete(generation);
      // A hold can be retired while an old run is completing. Resume only that current root.
      if (reason === 'held' && !this.closed && !this.audioHold && generation === this.generation) this.startPump(generation);
    });
  }

  private async pump(generation: number): Promise<void | 'held'> {
    try {
      while (generation === this.generation && !this.closed) {
        if (this.audioHold) return 'held';
        const position = this.target ?? this.position();
        let fed = false, finished = true;
        if (this.live) this.cross();
        for (const track of this.tracks) {
          if (this.audioHold) return 'held';
          // A playlist that is still growing (or sliding) is read again for its new segments.
          const reload = this.live ? Math.min(RELOAD_MS, Math.max(1000, track.playlist.targetDuration * 500)) : RELOAD_MS;
          if (!track.playlist.ended && track.next >= track.playlist.sequence + track.playlist.segments.length && Date.now() - track.loaded > reload) {
            const playlist = this.read(await this.get(track.url, 'text'), track.url);
            if (generation !== this.generation) return;
            if (this.audioHold) return 'held';
            track.playlist = playlist; track.loaded = Date.now();
          }
          const segment = segmentNumbered(track.playlist, track.next);
          if (!segment) { if (!track.playlist.ended) finished = false; continue; }
          finished = false;
          if (this.live) {
            // Enough is held ahead unless a seek is still waiting for its segment.
            const last = this.placed[this.placed.length - 1];
            if (!this.arrival && last && last.end - Number(this.player.currentTime) > AHEAD_S && Number(this.player.currentTime) >= this.placed[0].start - 0.05) continue;
          } else if (segment.start > position + AHEAD_S) continue;
          try {
            await this.feed(track, segment, generation);
          } catch (error) {
            // A channel's segment that the server no longer has (viewing was paused while the
            // channel moved on): the playlist is read again, and playback goes on from the oldest
            // segment it still lists. A segment the playlist still names is a real failure.
            const gone = this.live && error instanceof SourceError && (error.status === 404 || error.status === 410);
            if (!gone || generation !== this.generation) throw error;
            const playlist = this.read(await this.get(track.url, 'text'), track.url);
            if (generation !== this.generation) return;
            if (this.audioHold) return 'held';
            track.playlist = playlist; track.loaded = Date.now();
            if (track.next >= playlist.sequence) throw error;
            continue;
          }
          if (generation !== this.generation) return;
          if (this.audioHold) return 'held';
          fed = true;
          trace(`hls ${track.kind} segment ${segment.number} (${segment.start.toFixed(2)}+${segment.duration.toFixed(2)}) buffered ${this.ranges(track)} at ${Number(this.player.currentTime).toFixed(2)}`);
          if (!this.live && position > BEHIND_S * 2) await this.remove(track.buffer, 0, position - BEHIND_S + this.offset, generation);
        }
        if (this.audioHold) return 'held';
        if (this.live && fed) await this.trim(generation);
        if (finished) { try { if (this.source.readyState === 'open') this.source.endOfStream(); } catch { /* already ended */ } }
        if (!fed) await wait(IDLE_MS);
      }
    } catch (error) {
      if (generation === this.generation) this.fail(error);
    }
  }

  private fail(error: unknown): void {
    if (this.closed) return;
    const known = error instanceof SourceError ? error : new SourceError(false, String((error as Error)?.message ?? error));
    if (known.message === 'closed' || known.message === 'superseded') return;
    this.arrival?.reject(known);
    this.arrival = undefined;
    this.failed(known);
  }

  close(): void {
    if (this.closed) return;
    this.stopExposure();
    this.closed = true;
    if (this.audioOperation) this.retireAudio(this.audioOperation);
    this.generation++;
    for (const cancel of [...this.pending]) cancel();
    this.arrival?.reject(new SourceError(false, 'closed'));
    this.arrival = undefined;
    for (const request of [...this.requests]) { try { request.abort(); } catch { /* finished */ } }
  }
}
