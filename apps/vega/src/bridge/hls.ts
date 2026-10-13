import {MediaSource, type SourceBuffer, type VideoPlayer} from '@amazon-devices/react-native-w3cmedia';
import {trace} from '../debug';
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
  constructor(private readonly player: VideoPlayer, private readonly url: string, private readonly failed: (error: SourceError) => void, private readonly originMs?: number) {}

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
  audioIndex(): number { const track = this.tracks.find(candidate => candidate.kind === 'audio'); return track ? this.renditions.findIndex(rendition => rendition.url === track.url) : -1; }

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

  private get<T extends 'text' | 'arraybuffer'>(url: string, type: T): Promise<T extends 'text' ? string : ArrayBuffer> {
    return new Promise((resolve, reject) => {
      const attempt = (left: number) => {
        if (this.closed) { reject(new SourceError(false, 'closed')); return; }
        const request = new XMLHttpRequest();
        this.requests.add(request);
        request.open('GET', url);
        request.responseType = type;
        request.timeout = 20000;
        const sent = Date.now();
        let answered = 0;
        request.onreadystatechange = () => { if (!answered && request.readyState >= 2) answered = Date.now(); };
        const done = () => this.requests.delete(request);
        request.onload = () => {
          done();
          const status = request.status;
          if (status === 503 && left > 0) { setTimeout(() => attempt(left - 1), PREPARING_MS); return; }
          if (status < 200 || status >= 300) { reject(new SourceError(status === 0 || status === 408 || status === 429 || status >= 500, `status ${status}`, status >= 400 && status <= 599 ? status : 0)); return; }
          if (type === 'arraybuffer') this.measure((request.response as ArrayBuffer | null)?.byteLength ?? 0, answered || sent, sent);
          resolve((type === 'text' ? request.responseText : request.response) as never);
        };
        request.onerror = () => { done(); reject(new SourceError(true, 'request failed')); };
        request.ontimeout = () => { done(); reject(new SourceError(true, 'request timed out')); };
        request.onabort = () => { done(); reject(new SourceError(false, 'closed')); };
        request.send();
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
    try {
      const text = await this.get(this.url, 'text');
      const master = parseMaster(text, this.url);
      // A media playlist given directly is one muxed track.
      const video = master?.video ?? this.url, codecs = master?.codecs ?? [];
      this.renditions = master?.audio ?? [];
      const chosen = this.renditions.find(rendition => rendition.isDefault) ?? this.renditions[0];
      const [videoList, audioList] = await Promise.all([
        master ? this.get(video, 'text').then(body => this.read(body, video)) : Promise.resolve(this.read(text, video)),
        chosen ? this.get(chosen.url, 'text').then(body => this.read(body, chosen.url)) : Promise.resolve(null),
      ]);
      if (this.closed) return;
      await this.attach();
      if (this.closed) return;
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
      if (this.live) { await this.openLive(position); return; }
      const total = Math.max(...this.tracks.map(track => track.playlist.segments.reduce((sum, segment) => sum + segment.duration, 0)));
      if (total > 0 && videoList.ended) { try { this.source.duration = total; } catch { /* the element works it out */ } }
      for (const track of this.tracks) await this.start(track);
      // Filled from where playback will begin: the element is still at zero until it is sent there.
      this.target = position;
      this.point(position);
      const video0 = this.tracks[0], first = segmentNumbered(video0.playlist, video0.next);
      if (first) {
        await this.append(video0.buffer, await this.get(first.url, 'arraybuffer'));
        if (this.closed) return;
        video0.next = first.number + 1;
        try {
          const ranges = video0.buffer.buffered;
          const shift = ranges.length ? ranges.start(0) - first.start : 0;
          // A frame's worth of difference is how the picture is stored, not a shifted clock.
          this.offset = Number.isFinite(shift) && Math.abs(shift) > 0.1 ? shift : 0;
        } catch { this.offset = 0; }
        trace(`hls clock offset ${this.offset.toFixed(3)} s`);
      }
      void this.pump(++this.generation);
    } catch (error) {
      this.fail(error);
    }
  }

  /** A channel: begin at `position` on its timeline, or where live viewing begins. */
  private async openLive(position: number): Promise<void> {
    for (const track of this.tracks) {
      // Each segment follows the one before it, whatever its own clock says (a new programme
      // restarts it). A device that will not do that keeps the segments' own times, and playback
      // is carried over the gaps (`cross`).
      try { track.buffer.mode = 'sequence' as never; } catch { /* the segments' own times are used */ }
      await this.start(track);
    }
    const list = this.tracks[0].playlist;
    const wanted = Number.isFinite(position) ? this.originMs! + position * 1000 : NaN;
    const first = (Number.isFinite(wanted) ? segmentAtDate(list, wanted) : undefined) ?? liveStart(list);
    if (!first) throw new SourceError(true, 'the channel has no segments yet');
    for (const track of this.tracks) track.next = first.number;
    const landed = await this.feed(this.tracks[0], first);
    if (this.closed) return;
    // Inside the segment when a moment was asked for and it holds that moment.
    const into = landed && Number.isFinite(wanted) && landed.dateMs !== undefined ? Math.max(0, Math.min(landed.end - landed.start, (wanted - landed.dateMs) / 1000)) : 0;
    this.begin = landed ? landed.start + into : NaN;
    trace(`hls channel begins at segment ${first.number}, element time ${this.begin.toFixed(2)}`);
    void this.pump(++this.generation);
  }

  private read(text: string, url: string): Playlist {
    trace('hls playlist ' + (url.split('/').pop() ?? '').split('?')[0] + ': ' + text.split(/\r?\n/).filter(Boolean).slice(0, 12).map(line => line.trim().replace(/[A-Za-z0-9_-]{30,}/g, '<long>')).join(' | ').slice(0, 700));
    return parseMedia(text, url);
  }

  /** A source buffer for `type`, or the element's refusal of it. */
  private add(type: string): SourceBuffer {
    try { return this.source.addSourceBuffer(type); } catch (error) { throw new SourceError(false, `${type}: ${String((error as Error)?.message ?? error)}`, 0, 'unsupported'); }
  }

  private attach(): Promise<void> {
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new SourceError(false, 'media source did not open')), 10000);
      this.source.addEventListener('sourceopen', () => { clearTimeout(timer); resolve(); });
      try { this.player.srcObject = this.source as never; } catch (error) { clearTimeout(timer); reject(new SourceError(false, String((error as Error)?.message ?? error))); }
    });
  }

  /** The track's initialization segment. */
  private async start(track: Track): Promise<void> {
    if (!track.playlist.init) return;
    await this.append(track.buffer, await this.get(track.playlist.init, 'arraybuffer'));
  }

  /** A source buffer does one thing at a time: resolves once it is free (or, at worst, after five
   * seconds, when the call that follows says for itself what is wrong). */
  private free(buffer: SourceBuffer): Promise<void> {
    return new Promise(resolve => {
      let busy = false;
      try { busy = buffer.updating; } catch { /* asked as it was removed */ }
      if (!busy) { resolve(); return; }
      const done = () => { clearTimeout(timer); buffer.removeEventListener('updateend', done); resolve(); };
      const timer = setTimeout(done, 5000);
      buffer.addEventListener('updateend', done);
    });
  }

  private async append(buffer: SourceBuffer, data: ArrayBuffer): Promise<void> {
    await this.free(buffer);
    return new Promise((resolve, reject) => {
      const off = () => { buffer.removeEventListener('updateend', done); buffer.removeEventListener('error', broke); };
      const done = () => { off(); resolve(); };
      const broke = () => { off(); reject(new SourceError(false, 'append failed', 0, 'decode')); };
      buffer.addEventListener('updateend', done);
      buffer.addEventListener('error', broke);
      try { buffer.appendBuffer(data); } catch (error) { off(); reject(new SourceError(false, String((error as Error)?.message ?? error), 0, 'decode')); }
    });
  }

  /** Takes `from` to `to` out of the buffer. An append still in flight (one a seek has just
   * overtaken) is waited for first: a buffer refuses a removal while it is busy, and what that
   * append brought would otherwise be left behind. */
  private async remove(buffer: SourceBuffer, from: number, to: number): Promise<void> {
    if (!(to > from)) return;
    await this.free(buffer);
    return new Promise(resolve => {
      const done = () => { buffer.removeEventListener('updateend', done); resolve(); };
      buffer.addEventListener('updateend', done);
      try { buffer.remove(from, to); } catch { buffer.removeEventListener('updateend', done); resolve(); }
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
    if (this.closed || !this.tracks.length) return this.live ? Promise.reject(new SourceError(false, 'closed')) : this.elementTime(position);
    if (this.live) return this.seekLive(position);
    this.target = position;
    if (this.tracks.every(track => this.covered(track, position))) return this.elementTime(position);
    const generation = ++this.generation;
    void (async () => {
      try {
        for (const track of this.tracks) await this.remove(track.buffer, 0, Number.MAX_SAFE_INTEGER);
        if (generation !== this.generation || this.closed) return;
        this.point(position);
        await this.pump(generation);
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
          for (const track of this.tracks) await this.remove(track.buffer, 0, Number.MAX_SAFE_INTEGER);
          if (generation !== this.generation || this.closed) return;
          this.placed = [];
          const list = this.tracks[0].playlist;
          const on = segmentAtDate(list, dateMs), first = on ?? liveStart(list);
          if (!first) throw new SourceError(true, 'the channel has no segments');
          // A moment not broadcast yet is where live viewing begins: that is what is arrived at.
          if (!on && this.arrival) this.arrival = {...this.arrival, dateMs: first.dateMs ?? dateMs};
          for (const track of this.tracks) track.next = first.number;
          await this.pump(generation);
        } catch (error) {
          if (generation === this.generation) this.fail(error);
        }
      })();
    });
  }

  /** The element has arrived (or the seek was given up). */
  settled(): void { this.target = undefined; }

  /** Switches to another audio rendition, keeping the picture. Resolves once its sound is in place. */
  async selectAudio(index: number): Promise<void> {
    const rendition = this.renditions[index], track = this.tracks.find(candidate => candidate.kind === 'audio');
    if (!rendition || !track) throw new SourceError(false, 'no such audio rendition');
    if (track.url === rendition.url) return;
    const generation = ++this.generation;
    const playlist = this.read(await this.get(rendition.url, 'text'), rendition.url);
    if (generation !== this.generation || this.closed) throw new SourceError(false, 'superseded');
    await this.remove(track.buffer, 0, Number.MAX_SAFE_INTEGER);
    track.url = rendition.url; track.playlist = playlist; track.loaded = Date.now();
    await this.start(track);
    track.next = numberAt(playlist, this.target ?? this.position());
    void this.pump(generation);
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
  private async feed(track: Track, segment: Segment, generation?: number): Promise<Placed | undefined> {
    const current = () => generation === undefined || (generation === this.generation && !this.closed);
    const data = await this.get(segment.url, 'arraybuffer');
    if (!current()) return undefined;
    const clock = this.live && track === this.tracks[0];
    const before = clock ? this.spans(track.buffer) : [];
    await this.append(track.buffer, data);
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
  private async trim(): Promise<void> {
    const here = this.placedAt(Number(this.player.currentTime));
    if (!here) return;
    let kept = 0;
    for (let index = this.placed.indexOf(here) - 1; index >= 0; index--) {
      const entry = this.placed[index];
      if (kept < BEHIND_S) { kept += entry.end - entry.start; continue; }
      for (const track of this.tracks) await this.remove(track.buffer, entry.start, entry.end);
      this.placed.splice(index, 1);
    }
  }

  /** Keeps each track filled a little ahead of where playback is. */
  private async pump(generation: number): Promise<void> {
    try {
      while (generation === this.generation && !this.closed) {
        const position = this.target ?? this.position();
        let fed = false, finished = true;
        if (this.live) this.cross();
        for (const track of this.tracks) {
          // A playlist that is still growing (or sliding) is read again for its new segments.
          const reload = this.live ? Math.min(RELOAD_MS, Math.max(1000, track.playlist.targetDuration * 500)) : RELOAD_MS;
          if (!track.playlist.ended && track.next >= track.playlist.sequence + track.playlist.segments.length && Date.now() - track.loaded > reload) {
            const playlist = this.read(await this.get(track.url, 'text'), track.url);
            if (generation !== this.generation) return;
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
          await this.feed(track, segment, generation);
          if (generation !== this.generation) return;
          fed = true;
          trace(`hls ${track.kind} segment ${segment.number} (${segment.start.toFixed(2)}+${segment.duration.toFixed(2)}) buffered ${this.ranges(track)} at ${Number(this.player.currentTime).toFixed(2)}`);
          if (!this.live && position > BEHIND_S * 2) await this.remove(track.buffer, 0, position - BEHIND_S + this.offset);
        }
        if (this.live && fed) await this.trim();
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
    this.closed = true;
    this.generation++;
    this.arrival?.reject(new SourceError(false, 'closed'));
    this.arrival = undefined;
    for (const request of [...this.requests]) { try { request.abort(); } catch { /* finished */ } }
  }
}
