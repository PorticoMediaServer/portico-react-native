import type {AudioStream, SubtitleStream} from '../../../../../packages/client-core/src/playback-v1/types';
import type {PlaybackChoices} from '../../../../../packages/client-core/src/playback-v1/choices';
import type {LocalMedia} from '../../../platform/local-playback';
import type {StoredSubtitle} from '../../../platform/offline-subtitle-files';
import type {AudioTrackBinding, NativeAudioTrackCommand} from './audio-track-selection';

export type NativeLocalTracksSnapshot = Readonly<{
  binding: AudioTrackBinding;
  audio: readonly AudioStream[];
  subtitles: readonly (SubtitleStream & {unavailable?: boolean})[];
  audioTrackId?: string;
  subtitleTrackId: string | null;
  subtitleOffsetMs: number;
  subtitleTimingSupported: boolean;
  subtitleError?: boolean;
}>;
export type NativeLocalAudioTrackCommand = Readonly<{
  binding: AudioTrackBinding; revision: number; catalogRevision: number; trackId: string;
}>;
type Audio = AudioStream & Readonly<{streamIndex?: number}>;
type PendingAudio = Readonly<{id: string; revision: number; catalogRevision?: number; streamIndex?: number}>;
const record = (value: unknown): value is Record<string, unknown> => !!value && typeof value === 'object' && !Array.isArray(value);
const integer = (value: unknown, min: number, max: number): value is number => typeof value === 'number' && Number.isSafeInteger(value) && value >= min && value <= max;
const text = (value: unknown): string => typeof value === 'string' ? value.slice(0, 512).replace(/[\u0000-\u001f\u007f]/g, '') : '';
const localFile = (address: string, directory: URL): boolean => {
  try {const url = new URL(address), path = decodeURIComponent(url.pathname), base = decodeURIComponent(directory.pathname);
    return url.protocol === 'file:' && !url.hostname && !url.search && !url.hash
      && !/[\\\u0000-\u001f\u007f]/.test(path) && !path.split('/').some(part => part === '.' || part === '..')
      && path.startsWith(base) && path.length > base.length;
  } catch {return false;}
};

/** Choices owned by one admitted downloaded file. No API, server session or title memory. */
export class NativeOfflineTracks {
  private readonly binding: AudioTrackBinding;
  private readonly stored: readonly StoredSubtitle[];
  private snapshot: NativeLocalTracksSnapshot;
  private engine = '';
  private instance?: string;
  private rendering: readonly string[] = [];
  private availableRendering: readonly string[] = [];
  private audio: readonly Audio[] = [];
  private catalogRevision?: number;
  private audioRevision = 0;
  private pendingAudio?: PendingAudio;
  private subtitleRevision = 1;
  constructor(media: LocalMedia, binding: AudioTrackBinding) {
    this.binding = Object.freeze({...binding});
    const directory = new URL('.', media.fileUrl), offered = media.extras?.subtitles ?? [];
    const counts = new Map<string, number>();
    for (const track of offered) counts.set(track.id, (counts.get(track.id) ?? 0) + 1);
    this.stored = Object.freeze(offered.filter(track => {
      return !!track.id && counts.get(track.id) === 1 && localFile(track.url, directory);
    }).map(track => Object.freeze({...track,
      textUrl: track.textUrl && localFile(track.textUrl, directory) ? track.textUrl : undefined,
      fonts: track.fonts?.filter(font => localFile(font.url, directory)),
    })));
    this.snapshot = Object.freeze({binding: this.binding, audio: [], subtitles: [], subtitleTrackId: null, subtitleOffsetMs: 0, subtitleTimingSupported: false});
  }
  getSnapshot = (): NativeLocalTracksSnapshot => this.snapshot;
  private publish(change: Partial<NativeLocalTracksSnapshot> = {}): void {this.snapshot = Object.freeze({...this.snapshot, ...change});}
  configure(engine: string, instance: string | undefined, rendering: readonly string[], availableRendering: readonly string[] = rendering, timingSupported = true): void {
    if (engine !== this.engine || instance !== this.instance) {
      // This object still owns the same admitted file/binding. Its already-proven mpv
      // absolute stream index can be rechecked after reload; an opaque native ID cannot.
      const retained = engine === 'mpv' && this.engine === 'mpv' ? this.pendingAudio : undefined;
      this.engine = engine; this.instance = instance; this.audio = []; this.catalogRevision = undefined;
      this.pendingAudio = retained ? Object.freeze({...retained, revision: ++this.audioRevision}) : undefined;
      this.publish({audio: [], audioTrackId: undefined});
    }
    if (timingSupported !== this.snapshot.subtitleTimingSupported) this.publish({subtitleTimingSupported: timingSupported, ...(!timingSupported ? {subtitleOffsetMs: 0} : {})});
    if (JSON.stringify([this.rendering, this.availableRendering]) === JSON.stringify([rendering, availableRendering])) return;
    this.rendering = [...rendering]; this.availableRendering = [...availableRendering];
    this.publish({subtitles: Object.freeze(this.stored.map(track => Object.freeze({id: track.id, format: track.format, source: 'downloaded' as const,
      language: track.language, title: track.title, default: track.default, forced: track.forced, sdh: false,
      ...(this.playable(track) ? {} : {unavailable: true})})))});
  }
  private playable(track: StoredSubtitle): boolean {
    return track.format === 'vtt' || !!track.textUrl || this.availableRendering.includes(track.format);
  }
  requiredRendering(): string | undefined {
    const track = this.stored.find(value => value.id === this.snapshot.subtitleTrackId);
    return track && ['ass', 'pgs', 'vobsub', 'dvb'].includes(track.format) ? track.format : undefined;
  }
  /** Facts have already passed the coordinator's instance/sequence/source fences. */
  accept(fact: Record<string, unknown>): 'changed' | 'failed' | undefined {
    if (fact.type === 'subtitleStatus' && this.snapshot.subtitleTrackId && typeof fact.error === 'string') {
      this.publish({subtitleError: !!fact.error || undefined}); return 'changed';
    }
    if (fact.type === 'mediaInfo' && Array.isArray(fact.audioTracks)) {
      const catalog = this.engine === 'native' && integer(fact.audioTrackCatalogRevision, 1, Number.MAX_SAFE_INTEGER) ? fact.audioTrackCatalogRevision : undefined;
      if (this.engine !== 'mpv' && catalog === undefined) return;
      const audio: Audio[] = [], selected: string[] = [], ids = new Set<string>();
      for (const value of fact.audioTracks.slice(0, 64)) {
        if (!record(value) || value.external === true) continue;
        const streamIndex = this.engine === 'mpv' && integer(value.streamIndex, 0, 65535) ? value.streamIndex : undefined;
        const id = this.engine === 'mpv' ? streamIndex === undefined ? '' : `a${streamIndex}`
          : typeof value.id === 'string' && value.id.length <= 512 && text(value.id) === value.id ? value.id : '';
        if (!id || ids.has(id)) return;
        ids.add(id);
        const track: Audio = Object.freeze({id, codec: text(value.codec), language: text(value.language), title: text(value.title),
          ...(integer(value.channels, 1, 64) ? {channels: value.channels} : {}),
          default: value.default === true, commentary: value.commentary === true, visualImpaired: value.visualImpaired === true,
          atmos: value.atmos === true, ...(streamIndex === undefined ? {} : {streamIndex})});
        audio.push(track); if (value.selected === true) selected.push(id);
      }
      if (this.catalogRevision !== catalog) this.pendingAudio = undefined;
      this.catalogRevision = catalog; this.audio = Object.freeze(audio);
      this.publish({audio: this.audio, audioTrackId: selected.length === 1 ? selected[0] : undefined});
      return 'changed';
    }
    const pending = this.pendingAudio;
    if (!pending || fact.audioTrackRevision !== pending.revision) return;
    const mpv = this.engine === 'mpv';
    if (mpv ? fact.streamIndex !== pending.streamIndex : fact.trackId !== pending.id || fact.catalogRevision !== pending.catalogRevision) return;
    if (fact.type === (mpv ? 'audioTrackApplied' : 'localAudioTrackApplied')) {
      this.publish({audioTrackId: pending.id}); return 'changed';
    }
    if (fact.type === (mpv ? 'audioTrackFailed' : 'localAudioTrackFailed')) {
      this.pendingAudio = undefined; return 'failed';
    }
  }
  choose(choice: PlaybackChoices): void {
    if (Object.keys(choice).some(key => !['audioTrackId', 'subtitleTrackId', 'subtitleOffsetMs'].includes(key))) throw new Error('Invalid local playback choice.');
    const audio = choice.audioTrackId === undefined ? undefined : this.audio.find(track => track.id === choice.audioTrackId);
    const subtitle = choice.subtitleTrackId == null ? undefined : this.stored.find(track => track.id === choice.subtitleTrackId);
    if (choice.audioTrackId !== undefined && !audio || choice.subtitleTrackId != null && (!subtitle || !this.playable(subtitle))
      || choice.subtitleOffsetMs !== undefined && (!Number.isSafeInteger(choice.subtitleOffsetMs) || Math.abs(choice.subtitleOffsetMs) > 600_000
        || choice.subtitleOffsetMs !== 0 && !this.snapshot.subtitleTimingSupported)) throw new Error('Invalid local playback choice.');
    if (audio) this.pendingAudio = Object.freeze({id: audio.id, revision: ++this.audioRevision,
      ...(this.engine === 'mpv' ? {streamIndex: audio.streamIndex} : {catalogRevision: this.catalogRevision})});
    if (choice.subtitleTrackId !== undefined || choice.subtitleOffsetMs !== undefined) {
      const selected = choice.subtitleTrackId === undefined ? this.snapshot.subtitleTrackId : choice.subtitleTrackId;
      this.subtitleRevision++;
      this.publish({subtitleTrackId: selected, subtitleError: undefined, subtitleOffsetMs: selected === null ? 0 : choice.subtitleOffsetMs ?? (selected === this.snapshot.subtitleTrackId ? this.snapshot.subtitleOffsetMs : 0)});
    }
  }
  audioCommand(): NativeAudioTrackCommand | null {
    const pending = this.pendingAudio;
    return this.engine === 'mpv' && pending?.streamIndex !== undefined
      ? {binding: this.binding, revision: pending.revision, streamIndex: pending.streamIndex} : null;
  }
  localAudioCommand(): NativeLocalAudioTrackCommand | null {
    const pending = this.pendingAudio;
    return this.engine === 'native' && pending?.catalogRevision !== undefined
      ? {binding: this.binding, revision: pending.revision, catalogRevision: pending.catalogRevision, trackId: pending.id} : null;
  }
  subtitleCommand(style: unknown, visible: boolean): Record<string, unknown> {
    const selected = this.stored.find(track => track.id === this.snapshot.subtitleTrackId);
    const base = {binding: this.binding, revision: this.subtitleRevision};
    if (!visible || !selected || !this.playable(selected)) return {...base, mode: 'off'};
    const rich = selected.format !== 'vtt' && this.rendering.includes(selected.format);
    if (!rich && selected.format !== 'vtt' && !selected.textUrl) return {...base, mode: 'off'};
    return {...base, mode: 'track', resourceId: selected.id, resourceRevision: selected.revision ?? 1,
      origin: 'sidecar', language: selected.language, title: selected.title, offsetUs: String(this.snapshot.subtitleOffsetMs * 1000), refreshRevision: 0, style,
      ...(rich ? {...(selected.textUrl ? {documentUrl: selected.textUrl} : {}), render: {kind: selected.format, url: selected.url,
        ...(selected.format === 'vobsub' ? {companionUrl: selected.url.replace(/\.idx$/i, '.sub')} : {}),
        ...(selected.fonts?.length ? {fonts: selected.fonts} : {})}}
      : {documentUrl: selected.format === 'vtt' ? selected.url : selected.textUrl})};
  }
}
