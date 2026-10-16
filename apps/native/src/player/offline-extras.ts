import type {SegmentMarkerSet} from '../../../../packages/client-core/src/segment-markers';
import type {TrickplaySet} from '../../../../packages/client-core/src/trickplay';
import type {OfflineExtras} from '../bridge/offline-downloads';
import {isLocalSource} from '../bridge/local-playback';
import type {CaptionStyle} from './caption-style';
import {chaptersOf, kindOfFormat, type PlayerChapter, type SubtitleKind} from './engine-media';
import {forcedChoiceOf} from '../../../../packages/client-core/src/subtitle-originals';

/**
 * What a download brought with it, in the player's own terms: its subtitle tracks (files on this
 * device), its chapters and its skip markers. A download has no server session, so none of this
 * is asked of the server; the offline player reads it from what was stored beside the file.
 */
export type OfflineSubtitleTrack = Readonly<{id: string; language: string; title: string; forced: boolean; default: boolean; kind: SubtitleKind; url: string; /** A styled track's attached fonts: files on this device. */ fonts?: readonly Readonly<{name: string; url: string}>[];
  /** An image track whose lines are partly forced: "Forced only" changes what is shown (the count came with the download). */
  forcedChoice?: boolean}>;

/** The subtitle tracks stored with a download that some engine of this build can draw. */
export function offlineSubtitleTracks(extras: OfflineExtras | undefined, drawable: readonly string[]): readonly OfflineSubtitleTrack[] {
  const out: OfflineSubtitleTrack[] = [];
  for (const s of (extras?.subtitles ?? []).slice(0, 64)) {
    if (!s || typeof s.id !== 'string' || !isLocalSource(s.url)) continue;
    const kind = s.format === 'vtt' ? 'text' : kindOfFormat(s.format);
    // A text track is a WebVTT file every engine draws; anything richer needs an engine that draws it.
    if (kind === 'text' ? s.format !== 'vtt' : !drawable.includes(kind)) continue;
    // A styled track's fonts are files on this device too, at most sixteen; anything else is left out.
    const fonts = kind === 'ass' && Array.isArray(s.fonts) ? s.fonts.slice(0, 16).filter(f => !!f && typeof f.name === 'string' && f.name.length <= 160 && isLocalSource(f.url)).map(f => Object.freeze({name: f.name, url: f.url})) : [];
    const forcedChoice = (kind === 'pgs' || kind === 'vobsub') && forcedChoiceOf(s.lines);
    out.push(Object.freeze({id: s.id, language: s.language ?? '', title: s.title ?? '', forced: s.forced === true, default: s.default === true, kind, url: s.url, ...(fonts.length ? {fonts: Object.freeze(fonts)} : {}), ...(forcedChoice ? {forcedChoice: true} : {})}));
  }
  return Object.freeze(out);
}

/** A download's chapters, as the player's chapter list, with the thumbnails that came with it. */
export function offlineChapters(extras: OfflineExtras | undefined): readonly PlayerChapter[] {
  const raw = (extras?.bundle as {chapters?: unknown} | undefined)?.chapters;
  const chapters = chaptersOf(raw);
  const images = extras?.chapterImages;
  if (!images || !Array.isArray(raw)) return chapters;
  // Matched by start: `chaptersOf` keeps each chapter's start and orders by it.
  const byStart = new Map<number, string>();
  for (const entry of raw.slice(0, 500)) {
    const c = entry as {index?: unknown; startSeconds?: unknown} | null;
    const image = typeof c?.index === 'number' ? images[c.index] : undefined;
    if (image && isLocalSource(image) && typeof c?.startSeconds === 'number') byStart.set(Math.round(c.startSeconds * 10), image);
  }
  return byStart.size ? chapters.map(c => { const image = byStart.get(Math.round(c.startSeconds * 10)); return image ? {...c, thumbnail: image} : c; }) : chapters;
}

/** A download's scrubbing previews, as the player's trickplay set: its sheets are files on this device. */
export function offlineTrickplay(extras: OfflineExtras | undefined): TrickplaySet | null {
  const set = extras?.bundle?.trickplay, tiles = extras?.trickplayTiles ?? [];
  if (!set || !tiles.length || !tiles.every(isLocalSource)) return null;
  const perSheet = set.columns * set.rows;
  if (!(perSheet > 0) || tiles.length < Math.ceil(set.frameCount / perSheet) || !(set.intervalSeconds > 0)) return null;
  return Object.freeze({
    id: set.id, sourceId: 'download', sourceRevision: 'download', width: set.columns * set.tileWidth, height: set.rows * set.tileHeight,
    tileWidth: set.tileWidth, tileHeight: set.tileHeight, columns: set.columns, rows: set.rows, intervalSeconds: set.intervalSeconds,
    durationSeconds: set.durationSeconds, sourceOffsetSeconds: set.sourceOffsetSeconds, tileCount: tiles.length, frameCount: set.frameCount,
    stale: false, revision: 'download', tilesUrl: '', thumbnailsUrl: '', tileUrls: Object.freeze([...tiles]),
  });
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
 * the server's cue document; an engine that draws tracks itself is given the file as well. A
 * styled track is given with the fonts that came attached to it; a VobSub track by its index
 * (the pictures are the `.sub` file beside it); a DVB or PGS track as its one file.
 */
export function offlineSubtitleCommand(track: OfflineSubtitleTrack | undefined, binding: Readonly<{intentId: number; sessionId: string; generation: number}>, revision: number, engineDraws: readonly string[], style: CaptionStyle, forcedOnly = false): Record<string, unknown> {
  if (!track) return {binding, mode: 'off', revision};
  const render = engineDraws.includes(track.kind) ? {kind: track.kind, url: track.url, ...(track.kind === 'ass' && track.fonts?.length ? {fonts: track.fonts} : {})} : undefined;
  if (track.kind !== 'text' && !render) return {binding, mode: 'off', revision};
  return {
    binding, mode: 'track', revision, resourceId: track.id, resourceRevision: 1, origin: 'download', language: track.language, title: track.title, offsetUs: '0', refreshRevision: 0,
    ...(track.kind === 'text' ? {documentUrl: track.url} : {}), ...(render ? {render} : {}), ...(render && forcedOnly && track.forcedChoice ? {forcedOnly: true} : {}), style,
  };
}
