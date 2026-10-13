import type {SegmentMarkerSet} from '../../../../packages/client-core/src/segment-markers';
import type {OfflineExtras} from '../bridge/offline-downloads';
import {isLocalSource} from '../bridge/local-playback';
import type {CaptionStyle} from './caption-style';
import {chaptersOf, kindOfFormat, type PlayerChapter, type SubtitleKind} from './engine-media';

/**
 * What a download brought with it, in the player's own terms: its subtitle tracks (files on this
 * device), its chapters and its skip markers. A download has no server session, so none of this
 * is asked of the server; the offline player reads it from what was stored beside the file.
 */
export type OfflineSubtitleTrack = Readonly<{id: string; language: string; title: string; forced: boolean; default: boolean; kind: SubtitleKind; url: string}>;

/** The subtitle tracks stored with a download that some engine of this build can draw. */
export function offlineSubtitleTracks(extras: OfflineExtras | undefined, drawable: readonly string[]): readonly OfflineSubtitleTrack[] {
  const out: OfflineSubtitleTrack[] = [];
  for (const s of (extras?.subtitles ?? []).slice(0, 64)) {
    if (!s || typeof s.id !== 'string' || !isLocalSource(s.url)) continue;
    const kind = s.format === 'vtt' ? 'text' : kindOfFormat(s.format);
    // A text track is a WebVTT file every engine draws; anything richer needs an engine that draws it.
    if (kind === 'text' ? s.format !== 'vtt' : !drawable.includes(kind)) continue;
    out.push(Object.freeze({id: s.id, language: s.language ?? '', title: s.title ?? '', forced: s.forced === true, default: s.default === true, kind, url: s.url}));
  }
  return Object.freeze(out);
}

/** A download's chapters, as the player's chapter list. */
export function offlineChapters(extras: OfflineExtras | undefined): readonly PlayerChapter[] {
  return chaptersOf((extras?.bundle as {chapters?: unknown} | undefined)?.chapters);
}

/** The container of a download's file, as the server described it. */
export function offlineContainer(extras: OfflineExtras | undefined): string | undefined {
  const container = (extras?.bundle as {media?: {container?: unknown}} | undefined)?.media?.container;
  return typeof container === 'string' && container ? container : undefined;
}

const markerKinds = ['intro', 'recap', 'credits', 'commercial', 'outro'] as const;

/** A download's skip markers, in the shape the Skip prompt reads. Ids are local to the download. */
export function offlineMarkers(extras: OfflineExtras | undefined, itemId: string): SegmentMarkerSet | null {
  const raw = (extras?.bundle as {markers?: unknown} | undefined)?.markers;
  const markers = (Array.isArray(raw) ? raw : []).slice(0, 64).flatMap((entry, index) => {
    const m = entry as {kind?: unknown; startSeconds?: unknown; endSeconds?: unknown; automatic?: unknown} | null;
    const kind = markerKinds.find(k => k === m?.kind), start = m?.startSeconds, end = m?.endSeconds;
    if (!kind || typeof start !== 'number' || typeof end !== 'number' || !Number.isFinite(start) || !Number.isFinite(end) || start < 0 || end <= start) return [];
    return [Object.freeze({id: `offline-${index}`, kind, startSeconds: start, endSeconds: end, automaticSafe: m?.automatic === true})];
  });
  return markers.length ? Object.freeze({sourceId: itemId, revision: 'offline', markers: Object.freeze(markers)}) : null;
}

/**
 * The engine's subtitle command for a chosen download track (ENGINE-CONTRACT.md, section 7). A
 * text track is a WebVTT file on this device: the native engine reads and draws it as it draws
 * the server's cue document; an engine that draws tracks itself is given the file as well.
 */
export function offlineSubtitleCommand(track: OfflineSubtitleTrack | undefined, binding: Readonly<{intentId: number; sessionId: string; generation: number}>, revision: number, engineDraws: readonly string[], style: CaptionStyle): Record<string, unknown> {
  if (!track) return {binding, mode: 'off', revision};
  const render = engineDraws.includes(track.kind) ? {kind: track.kind, url: track.url} : undefined;
  if (track.kind !== 'text' && !render) return {binding, mode: 'off', revision};
  return {
    binding, mode: 'track', revision, resourceId: track.id, resourceRevision: 1, origin: 'download', language: track.language, title: track.title, offsetUs: '0', refreshRevision: 0,
    ...(track.kind === 'text' ? {documentUrl: track.url} : {}), ...(render ? {render} : {}), style,
  };
}
