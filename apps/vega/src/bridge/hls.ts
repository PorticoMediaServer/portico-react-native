import {MediaSource, type SourceBuffer, type VideoPlayer} from '@amazon-devices/react-native-w3cmedia';
import {trace} from '../debug';

/**
 * Plays the server's HLS through media source extensions: the app fetches the playlists and the
 * segments, and hands the bytes to the media element. On Vega this is the only way to play from a
 * server reached over plain HTTP (the element refuses to open such an address itself), and the
 * only way to play HLS at all (the element has no HLS client).
 *
 * It reads what the Portico server writes, not HLS in general: one video variant in fragmented
 * MP4 with an `EXT-X-MAP`; audio as separate renditions in MPEG-TS or fragmented MP4, or muxed
 * with the video; complete (`VOD`) or still growing playlists; no encryption, no discontinuities.
 */
export type Rendition = Readonly<{name: string; language: string; url: string; isDefault: boolean}>;
type Segment = Readonly<{url: string; start: number; duration: number}>;
type Playlist = {init: string | null; segments: Segment[]; ended: boolean};
type Master = {video: string; codecs: string[]; audio: Rendition[]};

export class SourceError extends Error {
  constructor(readonly network: boolean, detail: string) { super(detail); }
}

const AHEAD_S = 30, BEHIND_S = 30, RELOAD_MS = 4000, IDLE_MS = 400;
/** The server answers 503 while it is still writing a segment. */
const PREPARING_TRIES = 30, PREPARING_MS = 1000;

const wait = (ms: number) => new Promise<void>(resolve => setTimeout(resolve, ms));

function attributes(line: string): Record<string, string> {
  const found: Record<string, string> = {};
  const pattern = /([A-Z0-9-]+)=("[^"]*"|[^,]*)/g;
  for (let match = pattern.exec(line); match; match = pattern.exec(line)) found[match[1]] = match[2].replace(/^"|"$/g, '');
  return found;
}

const lines = (text: string) => text.split(/\r?\n/).map(line => line.trim()).filter(Boolean);

function parseMaster(text: string, base: string): Master | null {
  const all = lines(text);
  let best: {url: string; codecs: string[]; bandwidth: number} | undefined;
  const audio: Rendition[] = [];
  all.forEach((line, index) => {
    if (line.startsWith('#EXT-X-MEDIA:')) {
      const a = attributes(line);
      if (a.TYPE === 'AUDIO' && a.URI) audio.push({name: a.NAME ?? '', language: a.LANGUAGE ?? '', url: new URL(a.URI, base).href, isDefault: a.DEFAULT === 'YES'});
    } else if (line.startsWith('#EXT-X-STREAM-INF:')) {
      const a = attributes(line), next = all[index + 1];
      const bandwidth = Number(a.BANDWIDTH) || 0;
      if (next && !next.startsWith('#') && (!best || bandwidth > best.bandwidth)) best = {url: new URL(next, base).href, codecs: (a.CODECS ?? '').split(',').map(codec => codec.trim()).filter(Boolean), bandwidth};
    }
  });
  return best ? {video: best.url, codecs: best.codecs, audio} : null;
}

function parseMedia(text: string, base: string): Playlist {
  trace('hls playlist ' + (base.split('/').pop() ?? '').split('?')[0] + ': ' + lines(text).slice(0, 12).map(line => line.replace(/[A-Za-z0-9_-]{30,}/g, '<long>')).join(' | ').slice(0, 700));
  const playlist: Playlist = {init: null, segments: [], ended: false};
  let at = 0, duration = 0;
  for (const line of lines(text)) {
    if (line.startsWith('#EXT-X-MAP:')) { const uri = attributes(line).URI; if (uri) playlist.init = new URL(uri, base).href; }
    else if (line.startsWith('#EXTINF:')) duration = Number(line.slice(8).split(',')[0]) || 0;
    else if (line === '#EXT-X-ENDLIST') playlist.ended = true;
    else if (!line.startsWith('#')) { playlist.segments.push({url: new URL(line, base).href, start: at, duration}); at += duration; duration = 0; }
  }
  return playlist;
}

const isVideoCodec = (codec: string) => /^(avc|hvc|hev|dvh|av01|vp0)/i.test(codec);

type Track = {kind: 'video' | 'audio'; url: string; playlist: Playlist; buffer: SourceBuffer; next: number; loaded: number};

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
   * How far the element's clock runs ahead of the playlist's. The server's segments do not start
   * at zero (its packager starts them a second in), and a media source keeps the timestamps it is
   * given; a player with its own HLS client hides this. Positions given to and by this class are
   * the playlist's; `elementTime` and `position` convert.
   */
  private offset = 0;

  constructor(private readonly player: VideoPlayer, private readonly url: string, private readonly failed: (error: SourceError) => void) {}

  /** The element's clock for a playlist position. */
  elementTime(position: number): number { return position + this.offset; }
  /** The playlist position the element is at. */
  position(): number { return Math.max(0, this.player.currentTime - this.offset); }

  /** Which of `audio()` is playing, or -1. */
  audioIndex(): number { const track = this.tracks.find(candidate => candidate.kind === 'audio'); return track ? this.renditions.findIndex(rendition => rendition.url === track.url) : -1; }

  /** Whether the stream has a picture (known once it is open). */
  hasPicture(): boolean { return this.tracks.some(track => track.kind === 'video'); }

  /** The audio renditions the server offers, in its order (empty when audio is with the video). */
  audio(): readonly Rendition[] { return this.renditions; }

  private get<T extends 'text' | 'arraybuffer'>(url: string, type: T): Promise<T extends 'text' ? string : ArrayBuffer> {
    return new Promise((resolve, reject) => {
      const attempt = (left: number) => {
        if (this.closed) { reject(new SourceError(false, 'closed')); return; }
        const request = new XMLHttpRequest();
        this.requests.add(request);
        request.open('GET', url);
        request.responseType = type;
        request.timeout = 20000;
        const done = () => this.requests.delete(request);
        request.onload = () => {
          done();
          if (request.status === 503 && left > 0) { setTimeout(() => attempt(left - 1), PREPARING_MS); return; }
          if (request.status < 200 || request.status >= 300) { reject(new SourceError(request.status === 0 || request.status >= 500, `status ${request.status}`)); return; }
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
   * Opens the stream on the media element, to start at `position` seconds. Resolves once the
   * first picture data is in and the clocks can be told apart; a failure is reported to `failed`.
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
        master ? this.get(video, 'text').then(body => parseMedia(body, video)) : Promise.resolve(parseMedia(text, video)),
        chosen ? this.get(chosen.url, 'text').then(body => parseMedia(body, chosen.url)) : Promise.resolve(null),
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
      this.tracks = [{kind: soundOnly ? 'audio' : 'video', url: video, playlist: videoList, buffer: this.source.addSourceBuffer(firstType), next: 0, loaded: Date.now()}];
      if (audioList && chosen && !soundOnly) {
        // The server writes its audio renditions as MPEG-TS; the media source takes that as it is.
        const type = `${packets(audioList) ? 'video/mp2t' : 'audio/mp4'}; codecs="${audioCodecs.join(',') || 'mp4a.40.2'}"`;
        this.tracks.push({kind: 'audio', url: chosen.url, playlist: audioList, buffer: this.source.addSourceBuffer(type), next: 0, loaded: Date.now()});
      }
      const total = Math.max(...this.tracks.map(track => track.playlist.segments.reduce((sum, segment) => sum + segment.duration, 0)));
      if (total > 0 && videoList.ended) { try { this.source.duration = total; } catch { /* the element works it out */ } }
      for (const track of this.tracks) await this.start(track);
      // Filled from where playback will begin: the element is still at zero until it is sent there.
      this.target = position;
      this.point(position);
      const video0 = this.tracks[0], first = video0.playlist.segments[video0.next];
      if (first) {
        await this.append(video0.buffer, await this.get(first.url, 'arraybuffer'));
        if (this.closed) return;
        video0.next++;
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

  private append(buffer: SourceBuffer, data: ArrayBuffer): Promise<void> {
    return new Promise((resolve, reject) => {
      const off = () => { buffer.removeEventListener('updateend', done); buffer.removeEventListener('error', broke); };
      const done = () => { off(); resolve(); };
      const broke = () => { off(); reject(new SourceError(false, 'append failed')); };
      buffer.addEventListener('updateend', done);
      buffer.addEventListener('error', broke);
      try { buffer.appendBuffer(data); } catch (error) { off(); reject(new SourceError(false, String((error as Error)?.message ?? error))); }
    });
  }

  private remove(buffer: SourceBuffer, from: number, to: number): Promise<void> {
    return new Promise(resolve => {
      if (!(to > from)) { resolve(); return; }
      const done = () => { buffer.removeEventListener('updateend', done); resolve(); };
      buffer.addEventListener('updateend', done);
      try { buffer.remove(from, to); } catch { buffer.removeEventListener('updateend', done); resolve(); }
    });
  }

  private ranges(track: Track): string {
    try {
      const ranges = track.buffer.buffered, parts: string[] = [];
      for (let index = 0; index < ranges.length; index++) parts.push(`${ranges.start(index).toFixed(2)}-${ranges.end(index).toFixed(2)}`);
      return parts.join(',') || 'nothing';
    } catch { return 'unreadable'; }
  }

  private covered(track: Track, position: number): boolean {
    try {
      const ranges = track.buffer.buffered;
      const at = position + this.offset;
      for (let index = 0; index < ranges.length; index++) if (ranges.start(index) <= at + 0.05 && ranges.end(index) > at + 0.5) return true;
    } catch { /* not readable while updating */ }
    return false;
  }

  /** Aims every track at `position`. */
  private point(position: number): void {
    for (const track of this.tracks) {
      const segments = track.playlist.segments;
      const index = segments.findIndex(segment => segment.start + segment.duration > position);
      // At or past the end of a finished stream (an item reopened where it was left, at its end):
      // the last segment, so that the element has something to arrive at and can end.
      track.next = index >= 0 ? index : track.playlist.ended ? Math.max(0, segments.length - 1) : segments.length;
    }
  }

  /**
   * Called before the element is sent to `position`. What is already buffered there is kept;
   * otherwise the tracks are emptied and filled again from the segment that holds it.
   */
  seek(position: number): void {
    if (this.closed || !this.tracks.length) return;
    this.target = position;
    if (this.tracks.every(track => this.covered(track, position))) return;
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
  }

  /** The element has arrived (or the seek was given up). */
  settled(): void { this.target = undefined; }

  /** Switches to another audio rendition, keeping the picture. Resolves once its sound is in place. */
  async selectAudio(index: number): Promise<void> {
    const rendition = this.renditions[index], track = this.tracks.find(candidate => candidate.kind === 'audio');
    if (!rendition || !track) throw new SourceError(false, 'no such audio rendition');
    if (track.url === rendition.url) return;
    const generation = ++this.generation;
    const playlist = parseMedia(await this.get(rendition.url, 'text'), rendition.url);
    if (generation !== this.generation || this.closed) throw new SourceError(false, 'superseded');
    await this.remove(track.buffer, 0, Number.MAX_SAFE_INTEGER);
    track.url = rendition.url; track.playlist = playlist; track.loaded = Date.now();
    await this.start(track);
    const position = this.target ?? this.position();
    const at = playlist.segments.findIndex(segment => segment.start + segment.duration > position);
    track.next = at < 0 ? playlist.segments.length : at;
    void this.pump(generation);
  }

  /** Keeps each track filled a little ahead of where playback is. */
  private async pump(generation: number): Promise<void> {
    try {
      while (generation === this.generation && !this.closed) {
        const position = this.target ?? this.position();
        let fed = false, finished = true;
        for (const track of this.tracks) {
          // A playlist that is still growing is read again for its new segments.
          if (!track.playlist.ended && track.next >= track.playlist.segments.length && Date.now() - track.loaded > RELOAD_MS) {
            const playlist = parseMedia(await this.get(track.url, 'text'), track.url);
            if (generation !== this.generation) return;
            track.playlist = playlist; track.loaded = Date.now();
          }
          const segment = track.playlist.segments[track.next];
          if (!segment) { if (!track.playlist.ended) finished = false; continue; }
          finished = false;
          if (segment.start > position + AHEAD_S) continue;
          const data = await this.get(segment.url, 'arraybuffer');
          if (generation !== this.generation) return;
          await this.append(track.buffer, data);
          if (generation !== this.generation) return;
          track.next++;
          fed = true;
          trace(`hls ${track.kind} segment ${track.next - 1} (${segment.start.toFixed(2)}+${segment.duration.toFixed(2)}) buffered ${this.ranges(track)} at ${this.player.currentTime.toFixed(2)}`);
          if (position > BEHIND_S * 2) await this.remove(track.buffer, 0, position - BEHIND_S + this.offset);
        }
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
    this.failed(known);
  }

  close(): void {
    this.closed = true;
    this.generation++;
    for (const request of [...this.requests]) { try { request.abort(); } catch { /* finished */ } }
  }
}
