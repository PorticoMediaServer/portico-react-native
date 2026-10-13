/**
 * Which cards of a list have just arrived.
 *
 * A list is drawn as it is the first time it has anything to show: nothing fades in on opening a
 * screen. After that, a title that was not in the list a moment ago (a quiet refresh brought it,
 * or the next page was read) is "arriving" for a short while, and its card fades in when it is
 * first drawn. Cards that were in the list all along and are only now scrolled into view are not
 * arriving, and neither is anything once the short while has passed.
 *
 * No React and no native code: tested under Node.
 */
export const ARRIVAL_WINDOW_MS = 1500;
/** Beyond this many at once it is a different list, not new cards in the same one: nothing fades. */
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
    const added = keys.filter(key => !this.known!.has(key));
    this.known = new Set(keys);
    if (!added.length || added.length > ARRIVAL_LIMIT) return;
    for (const key of added) this.fresh.set(key, now);
  }

  /** Whether the card for `key` should fade in if it is drawn for the first time now. */
  arriving(key: string, now: number): boolean {
    const at = this.fresh.get(key);
    return at !== undefined && now - at <= ARRIVAL_WINDOW_MS;
  }
}
