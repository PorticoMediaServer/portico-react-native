import type {ContentEntry} from '../../../../../packages/client-core/src/library-content';
import {titleTintHue} from '../../../../../packages/client-core/src/presentation/index';

/**
 * The rules behind an episode opened in place on the show page (Spec — Title Pages §3, Justin
 * 18 Oct 2026), kept apart from the views so they can be tested: which row wears the Next up chip,
 * where rows sit once one is open, where a landing episode is likely to be, and the colours of the
 * plate an opened episode sits on.
 */

/** The opened episode's plate fades and grows in over this long. */
export const DETAILS_IN_MS = 180;
/** The episode the page was opened for wears the plate this long, then nothing... */
export const LANDING_MS = 2200;
/** ...holding it for this share of the time before it fades. */
export const LANDING_HOLD = 0.4;
/** The plate's corner radius. */
export const PLATE_RADIUS = 16;

/** The chip on the next-up episode's own row: "Continue" when it is in progress, else "Next up". */
export function nextUpChip(entry: Pick<ContentEntry, 'id'> | undefined, nextUp: Pick<ContentEntry, 'id' | 'progressSeconds' | 'watched'> | undefined): 'title.nextUp' | 'title.continueEpisode' | undefined {
  if (!entry || !nextUp || entry.id !== nextUp.id) return undefined;
  return (nextUp.progressSeconds ?? 0) > 0 && !nextUp.watched ? 'title.continueEpisode' : 'title.nextUp';
}

/** Choosing an episode's text opens it; choosing it again closes it. One is open at a time. */
export function toggledEpisode(open: string | undefined, id: string): string | undefined {
  return open === id ? undefined : id;
}

/**
 * Where row `index` sits in the vertical list (for `getItemLayout`): every row is one height, but
 * the open one also holds its details (`extra`, measured once), which pushes the rows after it.
 */
export function episodeRowLayout(index: number, geometry: {row: number; header: number; open?: number; extra: number}): {length: number; offset: number; index: number} {
  const {row, header, open, extra} = geometry;
  const length = row + (index === open ? extra : 0);
  const offset = header + row * index + (open !== undefined && index > open ? extra : 0);
  return {length, offset, index};
}

type Numbered = Pick<ContentEntry, 'seasonNumber' | 'episodeNumber' | 'absoluteNumber'>;

/**
 * Where the episode the page was opened for probably is in its season's list, from its number and
 * the first row's, so only the pages around it are read (a show of a thousand episodes is never
 * walked). The caller looks for the episode itself around this guess.
 */
export function landingGuess(landing: Numbered, first: Numbered | undefined, total: number): number {
  if (!first || total <= 0) return 0;
  let guess = 0;
  if (landing.absoluteNumber != null && first.absoluteNumber != null) guess = landing.absoluteNumber - first.absoluteNumber;
  else if (landing.episodeNumber != null && first.episodeNumber != null && landing.seasonNumber === first.seasonNumber) guess = landing.episodeNumber - first.episodeNumber;
  return Math.max(0, Math.min(total - 1, guess));
}

/** "Breaking Bad · Season 2" (or "· Specials") over an opened episode. */
export function episodeContext(t: (key: 'title.specials' | 'title.season', values?: {number: number}) => string, showTitle: string | undefined, seasonNumber: number | undefined): string {
  const season = seasonNumber === 0 ? t('title.specials') : seasonNumber != null ? t('title.season', {number: seasonNumber}) : undefined;
  return [showTitle, season].filter(Boolean).join(' · ');
}

// ── The plate's colours ─────────────────────────────────────────────────────

type Rgb = readonly [number, number, number];

function hexRgb(hex: string): Rgb {
  const h = hex.replace('#', '').slice(0, 6);
  return [parseInt(h.slice(0, 2), 16), parseInt(h.slice(2, 4), 16), parseInt(h.slice(4, 6), 16)];
}

function rgbHex([r, g, b]: Rgb): string {
  return '#' + [r, g, b].map(v => Math.round(Math.max(0, Math.min(255, v))).toString(16).padStart(2, '0')).join('');
}

function hslRgb(hue: number, saturation: number, lightness: number): Rgb {
  const c = (1 - Math.abs(2 * lightness - 1)) * saturation;
  const x = c * (1 - Math.abs(((hue / 60) % 2) - 1));
  const m = lightness - c / 2;
  const [r, g, b] = hue < 60 ? [c, x, 0] : hue < 120 ? [x, c, 0] : hue < 180 ? [0, c, x] : hue < 240 ? [0, x, c] : hue < 300 ? [x, 0, c] : [c, 0, x];
  return [(r + m) * 255, (g + m) * 255, (b + m) * 255];
}

/** `amount` of `top` mixed into `base` (CSS color-mix in sRGB). */
function mix(top: Rgb, amount: number, base: Rgb): Rgb {
  return [0, 1, 2].map(i => top[i]! * amount + base[i]! * (1 - amount)) as unknown as Rgb;
}

export type PlateColors = Readonly<{
  /** The show's tint, hsl(hue 40% 30%): the wash is this at `washAlpha`. */
  tint: string;
  washAlpha: number;
  /** The opened row and its details: one opaque colour, so they meet without a seam. */
  plate: string;
  /** The landing row's plate (and a card's details plate). */
  solid: string;
}>;

/**
 * The plate in the show's own colour (the hue its missing-still placeholders take, from its id):
 * the tint 16% into 5% text over the page, opaque; the landing plate the tint 18% into a raised
 * surface. The wash is the tint at 34%, radial from the row's top-left.
 */
export function plateColors(seed: string, page: string, text: string, raised: string): PlateColors {
  const tint = hslRgb(titleTintHue(seed), 0.4, 0.3);
  return {
    tint: rgbHex(tint),
    washAlpha: 0.34,
    plate: rgbHex(mix(tint, 0.16, mix(hexRgb(text), 0.05, hexRgb(page)))),
    solid: rgbHex(mix(tint, 0.18, hexRgb(raised))),
  };
}
