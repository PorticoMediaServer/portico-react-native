import type {PlaybackSession} from '../../../../packages/client-core/src/index';
import type {SubtitlePlan, SubtitleResource, SubtitleService} from '../../../../packages/client-core/src/subtitles';

/**
 * What crosses between the player screen and an engine that does more than the platform's own
 * player (ENGINE-CONTRACT.md): the engine the plan names, the subtitle track the engine is to
 * draw itself, and what the engine found in the file.
 *
 * STAND-INS. Three server fields are read here that this repository's copy of
 * `packages/client-core` does not carry yet. Each is read defensively from the raw object and is
 * simply absent until the shared package has it; when it does, the three readers below become
 * plain typed property reads and nothing else changes:
 *
 * - `PlaybackSession.engine` ("native" | "mpv"): the session presentation's `engine`.
 * - `SubtitleResource.deliveries` (`{format, url?, companionUrl?, fontsUrl?}[]`) and the
 *   `renderer: 'client'` value of a subtitle plan.
 * - `SubtitleService.choose(resource, offsetUs, rendering)`: the third argument.
 */
export type SubtitleKind = 'text' | 'ass' | 'pgs' | 'vobsub' | 'dvb';
const kinds: readonly SubtitleKind[] = ['text', 'ass', 'pgs', 'vobsub', 'dvb'];
/** Richest first: when a track can be had several ways, the one that keeps most of it. */
const preference: readonly SubtitleKind[] = ['ass', 'pgs', 'vobsub', 'dvb', 'text'];
const originalPath = /^\/v1\/media\/[A-Za-z0-9_-]+\/subtitles\/[A-Za-z0-9_-]+\/[1-9]\d*(?:\.vtt|\/original\.(?:ass|ssa|sup|idx|sub|mks)|\/fonts)?$/;

export type SubtitleDelivery = Readonly<{format: SubtitleKind; url?: string; fontsUrl?: string}>;
export type SubtitleFonts = Readonly<{key: string; fonts: readonly Readonly<{name: string; url: string}>[]}>;
export type SubtitleRender = Readonly<{
  kind: SubtitleKind;
  embedded?: Readonly<{language?: string; title?: string}>;
  url?: string;
  fonts?: readonly Readonly<{name: string; url: string}>[];
}>;

/** The engine the server's plan named for this session, when it named one. */
export function planEngineOf(session: PlaybackSession | undefined): 'native' | 'mpv' | undefined {
  const engine = (session as {engine?: unknown} | undefined)?.engine;
  return engine === 'native' || engine === 'mpv' ? engine : undefined;
}

/** The ways the server offers to hand a track to the device (`deliveries`), validated. */
export function deliveriesOf(resource: SubtitleResource | null | undefined): readonly SubtitleDelivery[] {
  const raw = (resource as {deliveries?: unknown} | null | undefined)?.deliveries;
  if (!Array.isArray(raw)) return [];
  const out: SubtitleDelivery[] = [];
  for (const entry of raw.slice(0, 8)) {
    if (!entry || typeof entry !== 'object') continue;
    const d = entry as Record<string, unknown>;
    if (!kinds.includes(d.format as SubtitleKind)) continue;
    const path = (v: unknown) => (typeof v === 'string' && v.length <= 1024 && originalPath.test(v) ? v : undefined);
    out.push({format: d.format as SubtitleKind, ...(path(d.url) ? {url: path(d.url)} : {}), ...(path(d.fontsUrl) ? {fontsUrl: path(d.fontsUrl)} : {})});
  }
  return out;
}

/** The kind a track is in its original form, from its format. */
export function kindOfFormat(format: string | undefined): SubtitleKind {
  switch (format) {
    case 'ass': case 'ssa': return 'ass';
    case 'pgs': case 'sup': return 'pgs';
    case 'vobsub': case 'idx': return 'vobsub';
    case 'dvb': return 'dvb';
    default: return 'text';
  }
}

/**
 * The kind to ask the server to deliver a track in, for an engine that draws `rendering` itself:
 * the richest kind both the track and the engine have. Undefined when the track has nothing but
 * plain text (the ordinary selection), or the engine draws only text.
 */
export function renderingToRequest(resource: SubtitleResource, rendering: readonly string[]): SubtitleKind | undefined {
  const offered = deliveriesOf(resource).map(d => d.format);
  return preference.find(kind => kind !== 'text' && rendering.includes(kind) && offered.includes(kind));
}

/** Chooses a track, asking for it in `rendering` when the engine will draw it itself. */
export function chooseSubtitle(service: SubtitleService, resource: SubtitleResource | null, rendering?: SubtitleKind): Promise<void> {
  if (!resource || !rendering) return service.choose(resource) as Promise<void>;
  const choose = service.choose as unknown as (this: SubtitleService, resource: SubtitleResource, offsetUs: string, rendering: SubtitleKind) => Promise<void>;
  return choose.call(service, resource, resource.offsetUs, rendering);
}

/** The delivery the device is to draw for the chosen track: the one that came with an address. */
function chosenDelivery(plan: SubtitlePlan): SubtitleDelivery | undefined {
  const deliveries = deliveriesOf(plan.selected).filter(d => !!d.url);
  return preference.map(kind => deliveries.find(d => d.format === kind)).find(Boolean);
}

/**
 * The kind the device itself must draw for the chosen track: set when the server delivers the
 * track for the device to draw (`renderer: 'client'`) in a kind richer than plain text. The
 * engine in use must then be one that draws that kind.
 */
export function requiredSubtitleRendering(plan: SubtitlePlan | null | undefined): SubtitleKind | undefined {
  if (!plan || plan.mode !== 'track' || !plan.selected || (plan.renderer as string) !== 'client') return undefined;
  const kind = chosenDelivery(plan)?.format;
  return kind && kind !== 'text' ? kind : undefined;
}

/** The address of the list of fonts attached to the chosen styled track, when it has one. */
export function fontsUrlOf(plan: SubtitlePlan | null | undefined): string | undefined {
  if (!plan || plan.mode !== 'track' || !plan.selected) return undefined;
  const delivery = chosenDelivery(plan);
  return delivery?.format === 'ass' ? delivery.fontsUrl : undefined;
}

/** A font list answer (`{fonts: [{name, url}]}`), kept only as addresses under the list's own. */
export function parseSubtitleFonts(raw: unknown, listUrl: string): SubtitleFonts {
  const list = raw && typeof raw === 'object' && Array.isArray((raw as {fonts?: unknown}).fonts) ? ((raw as {fonts: unknown[]}).fonts) : [];
  const fonts: {name: string; url: string}[] = [];
  for (const entry of list.slice(0, 16)) {
    const f = entry as {name?: unknown; url?: unknown} | null;
    if (!f || typeof f.name !== 'string' || f.name.length > 160 || typeof f.url !== 'string' || !f.url.startsWith(listUrl + '/') || !/^\d+$/.test(f.url.slice(listUrl.length + 1))) continue;
    fonts.push({name: f.name, url: f.url});
  }
  return Object.freeze({key: listUrl, fonts: Object.freeze(fonts)});
}

/**
 * Where the chosen track is, for an engine that draws `rendering` itself (the command's
 * `subtitles.render`). Undefined when the engine should draw the server's plain cue document
 * instead, as the platform's own player always does.
 *
 * - The original subtitle file, when the server delivered one in a kind the engine draws.
 * - The track inside the media itself, when the file is played as it is and the track came from
 *   it: the engine then needs no second download, and a styled track keeps its attached fonts.
 * `fonts` is the fetched font list for a styled file that has one; while it is still being
 * fetched (`'pending'`) nothing is returned, so the track is added once, with its fonts.
 */
export function engineSubtitleRender(plan: SubtitlePlan, session: PlaybackSession, rendering: readonly string[], absolute: (path: string) => string, fonts?: SubtitleFonts | 'pending'): SubtitleRender | undefined {
  const selected = plan.selected;
  if (plan.mode !== 'track' || !selected) return undefined;
  const delivery = chosenDelivery(plan);
  const inFile = session.mode === 'direct' && selected.origin === 'embedded';
  const kind = delivery && rendering.includes(delivery.format) ? delivery.format : inFile ? kindOfFormat(selected.format) : undefined;
  if (!kind || !rendering.includes(kind)) return undefined;
  const url = delivery && delivery.format === kind && delivery.url ? absolute(delivery.url) : undefined;
  if (!inFile && !url) return undefined;
  const wantsFonts = !!url && kind === 'ass' && !!delivery?.fontsUrl && !inFile;
  if (wantsFonts && fonts === 'pending') return undefined;
  const list = wantsFonts && fonts && fonts !== 'pending' && fonts.key === delivery!.fontsUrl ? fonts.fonts.map(f => ({name: f.name, url: absolute(f.url)})) : [];
  return Object.freeze({
    kind,
    ...(inFile ? {embedded: Object.freeze({...(selected.language ? {language: selected.language} : {}), ...(selected.title ? {title: selected.title} : {})})} : {}),
    ...(url ? {url} : {}),
    ...(list.length ? {fonts: Object.freeze(list)} : {}),
  });
}

/** What an engine reported finding in the file (its `mediaInfo` fact). */
export type EngineMedia = Readonly<{
  intentId: number;
  chapters: readonly Readonly<{startSeconds: number; title: string}>[];
  video?: Readonly<{width?: number; height?: number; framesPerSecond?: number; codec?: string; dynamicRange?: string; outputDynamicRange?: string; hardwareDecoding?: boolean}>;
}>;

/** A chapter list from an engine fact or from the server's playback options, bounded and in order. */
export function chaptersOf(raw: unknown): readonly Readonly<{startSeconds: number; title: string}>[] {
  if (!Array.isArray(raw)) return [];
  const out: {startSeconds: number; title: string}[] = [];
  for (const entry of raw.slice(0, 500)) {
    const c = entry as {startSeconds?: unknown; startMs?: unknown; title?: unknown} | null;
    const start = typeof c?.startSeconds === 'number' ? c.startSeconds : typeof c?.startMs === 'number' ? c.startMs / 1000 : NaN;
    if (!Number.isFinite(start) || start < 0) continue;
    out.push({startSeconds: start, title: typeof c?.title === 'string' ? c.title.slice(0, 256) : ''});
  }
  return out.sort((a, b) => a.startSeconds - b.startSeconds);
}
