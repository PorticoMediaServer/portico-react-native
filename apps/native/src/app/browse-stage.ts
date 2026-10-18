/**
 * A television's browsing stage (Home, a library's Discover; Justin, 18 Oct 2026): the preview of
 * the focused card above, and below it the rows, moved by focus so that the row with focus always
 * rests in the same place: wholly on screen, with a glimpse of the next one under it.
 *
 * The geometry is worked out before anything is drawn, from the type and card sizes the rows will
 * use, so the preview never changes height as rows of different shapes take focus.
 */

/** Sizes of one row as `Shelf` and `Card` draw it on television. */
export type ShelfMetrics = Readonly<{
  /** The row's title line: the taller of its heading and its See all button. */
  header: number;
  /** Below the title line, before the cards. */
  headerGap: number;
  /** The tallest artwork a row may hold (a poster). */
  art: number;
  /** The caption block under a card, with room for a third line. */
  caption: number;
  /** Below the row, before the next one. */
  below: number;
}>;

/** The height of a row of the tallest cards. */
export function shelfHeight(m: ShelfMetrics): number {
  return Math.ceil(m.header + m.headerGap + m.art + m.caption + m.below);
}

export type StageInput = Readonly<{
  /** The screen's height. */
  height: number;
  /** Above everything (the safe area). */
  top: number;
  /** The library's tabs, when the stage has them; 0 on Home. */
  strip: number;
  /** One row of the tallest cards (`shelfHeight`). */
  row: number;
  /** How much of the next row shows under the focused one. */
  peek: number;
  /** The least the preview may have. */
  minHero: number;
  /** The least of the next row that still reads as a glimpse. */
  minPeek: number;
}>;

export type StageLayout = Readonly<{
  /** The preview's height, between the tabs (or the top) and the rows. */
  hero: number;
  /** The rows' viewport: one row and the glimpse of the next. */
  viewport: number;
  /** Space after the last row, so it too can come to rest at the top of the viewport. */
  tail: number;
}>;

export function stageLayout(input: StageInput): StageLayout {
  const room = Math.max(0, input.height - input.top - input.strip);
  const row = Math.max(0, input.row);
  // First the glimpse gives way, then the preview, down to their least; past that the row itself is cut.
  let peek = Math.max(0, input.peek);
  let hero = room - row - peek;
  if (hero < input.minHero) {
    peek = Math.max(Math.min(input.minPeek, peek), peek - (input.minHero - hero));
    hero = room - row - peek;
  }
  hero = Math.max(Math.min(input.minHero, room), hero);
  const viewport = Math.max(0, room - hero);
  return {hero: Math.floor(hero), viewport: Math.ceil(viewport), tail: Math.max(0, Math.ceil(viewport - row))};
}

/** What the preview has room to say: lines for the title and for the synopsis. */
export type HeroText = Readonly<{titleLines: 1 | 2; overviewLines: number}>;

/**
 * Lines for a preview `height` tall. The title, the line under it and the facts always show; the
 * title takes a second line, and the synopsis up to three, only where there is room for them.
 */
export function heroText(height: number, sizes: Readonly<{padding: number; title: number; line: number; meta: number; overview: number; gap: number; resume: number}>): HeroText {
  const fixed = sizes.padding + sizes.title + sizes.line + sizes.meta + sizes.resume + sizes.gap * 3;
  let left = height - fixed;
  const titleLines: 1 | 2 = left >= sizes.title + sizes.overview * 2 ? 2 : 1;
  if (titleLines === 2) left -= sizes.title;
  const overviewLines = Math.max(0, Math.min(3, Math.floor(left / sizes.overview)));
  return {titleLines, overviewLines};
}
