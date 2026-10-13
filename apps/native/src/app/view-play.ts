/**
 * Playing a saved view.
 *
 * A saved view is a stored query, read one page at a time as the viewer scrolls. Play and Shuffle
 * mean the view, not the pages that happen to be on screen, so before starting the rest of the
 * view is read, up to what one play request can hold. A view longer than that plays its first
 * part and says so. (The server cannot yet take the view itself as the thing to play; when it
 * can, the view is named as a container and none of this reading is needed.)
 */

/** The most titles one play request carries (the server's limit for a list of titles). */
export const VIEW_PLAY_LIMIT = 500;
/** Pages read at most; with 40 to a page this is well past the limit above. */
const MAX_PAGES = 32;

export type ViewPage<T> = Readonly<{entries: readonly T[]; nextCursor: string}>;

export type GatheredView<T> = Readonly<{
  entries: readonly T[];
  /** False when the view holds more than was gathered. */
  complete: boolean;
}>;

/**
 * `loaded` plus the pages after `nextCursor`, without duplicates, until the view ends or `limit`
 * playable titles are in hand. `readPage` rejects when a page cannot be read; that failure is the
 * caller's to show, and nothing is played from a view that is only partly known for that reason.
 */
export async function gatherView<T>(
  loaded: readonly T[],
  nextCursor: string,
  readPage: (cursor: string) => Promise<ViewPage<T>>,
  o: {keyOf: (item: T) => string; playable: (item: T) => boolean; limit?: number; signal?: AbortSignal},
): Promise<GatheredView<T>> {
  const limit = o.limit ?? VIEW_PLAY_LIMIT;
  const seen = new Set<string>();
  const out: T[] = [];
  let playable = 0;
  let full = false;
  const take = (items: readonly T[]) => {
    for (const item of items) {
      const key = o.keyOf(item);
      if (seen.has(key)) continue;
      if (o.playable(item)) {
        if (playable >= limit) { full = true; return; }
        playable++;
      }
      seen.add(key);
      out.push(item);
    }
  };
  take(loaded);
  let cursor = nextCursor;
  for (let page = 0; cursor && !full && page < MAX_PAGES; page++) {
    if (o.signal?.aborted) throw Object.assign(new Error('Cancelled'), {name: 'AbortError', code: 'cancelled'});
    const next = await readPage(cursor);
    take(next.entries);
    // A cursor that does not move would read the same page for ever.
    if (next.nextCursor === cursor) { cursor = ''; break; }
    cursor = next.nextCursor;
  }
  return {entries: out, complete: !full && !cursor};
}
