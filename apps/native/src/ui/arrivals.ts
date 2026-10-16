/**
 * Which cards of a list have just arrived.
 *
 * A list is drawn as it is the first time it has anything to show: nothing fades in on opening a
 * screen. After that, a title that was not in the list a moment ago (a quiet refresh brought it,
 * or the next page was read) is "arriving" for a short while, and its card fades in when it is
 * first drawn. Cards that were in the list all along and are only now scrolled into view are not
 * arriving, and neither is anything once the short while has passed. More than `ARRIVAL_LIMIT` new
 * cards where most of the old ones went is a different list (another sort, another library), not
 * new cards: nothing fades. However many titles arrive beside the ones already shown (a scan
 * bringing hundreds), each may fade: only the ones drawn in the short while do.
 *
 * No React and no native code: tested under Node.
 */
export const ARRIVAL_WINDOW_MS = 1500;
/** More new cards than this at once, with most of the old ones gone, is a different list. A windowed grid fades no more than this many in one short while. */
export const ARRIVAL_LIMIT = 60;

export class Arrivals {
  private known: Set<string> | null = null;
  private fresh = new Map<string, number>();

  /** Tell it the list's keys each time the list is drawn. */
  update(keys: readonly string[], now: number): void {
    for (const [key, at] of this.fresh) if (now - at > ARRIVAL_WINDOW_MS) this.fresh.delete(key);
    if (!this.known) {
      // Nothing to show yet is not the first showing: the first cards to come are not "new".
      if (keys.length) this.known = new Set(keys);
      return;
    }
    const previous = this.known;
    const next = new Set(keys);
    const added = keys.filter(key => !previous.has(key));
    let kept = 0;
    for (const key of previous) if (next.has(key)) kept++;
    this.known = next;
    // Many new cards where most of the old ones went is another list; many new beside the old ones is a scan's worth.
    if (!added.length || (added.length > ARRIVAL_LIMIT && kept * 2 < previous.size)) return;
    for (const key of added) this.fresh.set(key, now);
  }

  /** Whether the card for `key` should fade in if it is drawn for the first time now. */
  arriving(key: string, now: number): boolean {
    const at = this.fresh.get(key);
    return at !== undefined && now - at <= ARRIVAL_WINDOW_MS;
  }
}

/**
 * The same for a windowed grid (a library, a person's titles, a saved list), which never holds the
 * whole list: only the cards it draws, place by place. A card drawn where another card was drawn
 * before, and not seen anywhere in the grid yet, has arrived (a quiet re-read put it there). A card
 * drawn where only a placeholder or nothing was (the page was read as the viewer scrolled) has not:
 * it was in the list all along. A title that only moved (one arrived above it) was seen already.
 * More than `ARRIVAL_LIMIT` arrivals in one short while is a different list, and nothing more fades.
 */
export class WindowArrivals {
  private shown = new Map<number, string>();
  private known = new Set<string>();
  private fresh = new Map<string, number>();
  /** The most places and titles remembered; beyond it the grid starts again (nothing fades for a moment). */
  static readonly REMEMBERED = 20_000;

  /** The list changed altogether (another library, sort or filter): start again. */
  reset(): void { this.shown.clear(); this.known.clear(); this.fresh.clear(); }

  /** A card for `key` is drawn at `index`: whether it should fade in if this is its first drawing. */
  drawn(index: number, key: string, now: number): boolean {
    for (const [k, at] of this.fresh) if (now - at > ARRIVAL_WINDOW_MS) this.fresh.delete(k);
    const at = this.fresh.get(key);
    if (at !== undefined) { this.shown.set(index, key); return true; }
    const before = this.shown.get(index);
    const arrived = before !== undefined && before !== key && !this.known.has(key) && this.fresh.size < ARRIVAL_LIMIT;
    if (this.known.size >= WindowArrivals.REMEMBERED || this.shown.size >= WindowArrivals.REMEMBERED) { this.shown.clear(); this.known.clear(); }
    this.shown.set(index, key);
    this.known.add(key);
    if (arrived) this.fresh.set(key, now);
    return arrived;
  }
}
