/**
 * TV-PLAYER-03: how each kind of list answers for its controls while focus comes back after
 * playback (`focus-return.ts`). These are the lists' whole policy, kept apart from the screens so
 * the policy the screens run is the one the tests run. A screen gives each one the list as it is
 * when asked (refs, not render-time values) and a way to scroll.
 *
 * - `rowsResolver`: a screen of rows (Home, a library's Discover). It brings the row holding a
 *   card into view and leaves the card to the row; a row that has gone hands over to the row now
 *   in its place.
 * - `arrayResolver`: a list whose entries are all in memory (a row of cards, a playlist's own
 *   entries as read so far). It brings the card into view; one that has gone hands over to its
 *   neighbour, the entry now nearest its old place.
 * - `windowResolver`: a list over a windowed collection (a library grid, a season's episodes, an
 *   album's or a book's tracks, a sorted list). Only some pages are in memory, so it tells three
 *   things apart (`locateInWindow`): the entry is there (where it was, close by, or anywhere in
 *   the pages held); the part where it was is not loaded yet (it asks for it, and waits); or that
 *   part is loaded and the entry is not in it, nor in any page held (gone: its neighbour, the
 *   entry now at its old place, or the last one when the list got shorter).
 *
 * Bounded work: nothing reads the whole list. An entry that moved further than `radius` from its
 * old place, onto a page no longer held, is taken as gone; that needs the list to have changed
 * order under the player and is the documented limit.
 */
import {LOOKUP_CONTAINER, LOOKUP_FOUND, LOOKUP_LOADING, LOOKUP_UNKNOWN, cardFocusKey, lookupGone, parseCardFocusKey, type FocusLookup, type FocusResolver} from './focus-return';

/** A screen's rows: each row's group (in its cards' keys) and first card, and the row number the first row has in places. */
export function rowsResolver<T>({rows, group, first, base, scrollTo}: {rows: () => readonly T[]; group: (row: T) => string; first: (row: T) => string | undefined; base: number; scrollTo: (index: number) => void}): FocusResolver {
  return {
    resolve(key, place) {
      const card = parseCardFocusKey(key);
      const now = rows();
      if (!card || !now.length) return LOOKUP_UNKNOWN;
      const index = now.findIndex(row => group(row) === card.group);
      if (index >= 0) { scrollTo(index); return LOOKUP_CONTAINER; }
      // A card with no row number (a list section's row) counts as the first row's.
      const at = Math.min(Math.max(0, (place.row ?? base) - base), now.length - 1);
      const id = first(now[at]!);
      return lookupGone(id === undefined ? undefined : cardFocusKey(group(now[at]!), id));
    },
  };
}

/**
 * A list held in memory. `usable` leaves out entries with nothing to focus (a hidden playlist
 * entry): one that has become unusable counts as gone, and hands over to the nearest usable
 * entry (none: the return gives up); `loading` is true while the list is still being read. `more`, for a list read page by
 * page: asks for the next page when the entry's old place is past what has been read, and says
 * whether there is one (so the entry is waited for, not taken as gone).
 */
export function arrayResolver<T>({group, items, keyOf, scrollTo, usable, loading, more}: {group: string | (() => string | undefined); items: () => readonly T[]; keyOf: (item: T, index: number) => string; scrollTo: (index: number) => void; usable?: (item: T) => boolean; loading?: () => boolean; more?: () => boolean}): FocusResolver {
  return {
    resolve(key, place) {
      const card = parseCardFocusKey(key);
      const own = typeof group === 'function' ? group() : group;
      if (!card || own === undefined || card.group !== own) return LOOKUP_UNKNOWN;
      const now = items();
      const index = now.findIndex((item, i) => keyOf(item, i) === card.entryId);
      if (index >= 0 && (!usable || usable(now[index]!))) { scrollTo(index); return LOOKUP_FOUND; }
      if (loading?.()) return LOOKUP_LOADING;
      if (index < 0 && place.column !== undefined && place.column >= now.length && more?.()) { if (now.length) scrollTo(now.length - 1); return LOOKUP_LOADING; }
      // Still listed but nothing to focus there now (hidden): its neighbours, from where it is.
      const near = nearestUsable(now, index >= 0 ? index : Math.min(Math.max(0, place.column ?? 0), now.length - 1), usable);
      return lookupGone(near === undefined ? undefined : cardFocusKey(own, keyOf(now[near]!, near)));
    },
  };
}

function nearestUsable<T>(items: readonly T[], at: number, usable?: (item: T) => boolean): number | undefined {
  if (!items.length) return undefined;
  if (!usable) return at;
  for (let d = 0; d < items.length; d++) {
    if (at + d < items.length && usable(items[at + d]!)) return at + d;
    if (at - d >= 0 && d > 0 && usable(items[at - d]!)) return at - d;
  }
  return undefined;
}

/** The part of a windowed collection (client-core `WindowedCollection`) this reads: never more than its resident pages. */
export type WindowLike<T> = {
  slotAt(index: number): {kind: 'item'; item: T} | {kind: 'placeholder'};
  ensureRange(first: number, last: number): void;
  indexOfKey?(key: string): number | undefined;
};

export type WindowLocation =
  | Readonly<{kind: 'found'; index: number}>
  | Readonly<{kind: 'loading'; first: number; last: number; center: number}>
  | Readonly<{kind: 'gone'; index?: number; next?: string}>;

/**
 * Where entry `id`, last seen at `index`, is in the list now. `total` is the list's length, unknown
 * until its first page has answered; `keyOf` is the collection's key for an entry.
 */
export function locateInWindow<T>(list: WindowLike<T>, total: number | undefined, id: string, index: number, keyOf: (item: T) => string, radius = 24): WindowLocation {
  if (total === undefined) return {kind: 'loading', first: Math.max(0, index - radius), last: index + radius, center: Math.max(0, index)};
  if (total <= 0) return {kind: 'gone'};
  const center = Math.min(Math.max(0, index), total - 1);
  const first = Math.max(0, center - radius), last = Math.min(total - 1, center + radius);
  let unloaded = false;
  // Nearest first: where it was, then outwards.
  for (let d = 0; d <= radius; d++) {
    for (const i of d ? [center - d, center + d] : [center]) {
      if (i < first || i > last) continue;
      const slot = list.slotAt(i);
      if (slot.kind !== 'item') { unloaded = true; continue; }
      if (keyOf(slot.item) === id) return {kind: 'found', index: i};
    }
  }
  // Moved further, onto a page still held.
  const resident = list.indexOfKey?.(id);
  if (resident !== undefined && resident >= 0 && resident < total) return {kind: 'found', index: resident};
  if (unloaded) return {kind: 'loading', first, last, center};
  const slot = list.slotAt(center);
  return {kind: 'gone', index: center, next: slot.kind === 'item' ? keyOf(slot.item) : undefined};
}

/**
 * A list over a windowed collection. `group` is the group in its cards' keys (undefined: none
 * now); `scrollTo` brings a position into view (and asks for its page, as a grid's does).
 */
export function windowResolver<T>({group, list, total, keyOf, scrollTo, radius}: {group: string | (() => string | undefined); list: () => WindowLike<T> | null | undefined; total: () => number | undefined; keyOf: (item: T) => string; scrollTo: (index: number) => void; radius?: number}): FocusResolver {
  return {
    resolve(key, place): FocusLookup {
      const card = parseCardFocusKey(key);
      const own = typeof group === 'function' ? group() : group;
      const window = list();
      if (!card || own === undefined || card.group !== own || !window) return LOOKUP_UNKNOWN;
      if (place.column === undefined) {
        // A key without a place (none was given): only what is in memory can say.
        const at = window.indexOfKey?.(card.entryId);
        if (at === undefined) return LOOKUP_UNKNOWN;
        scrollTo(at);
        return LOOKUP_FOUND;
      }
      const where = locateInWindow(window, total(), card.entryId, place.column, keyOf, radius);
      if (where.kind === 'found') { scrollTo(where.index); return LOOKUP_FOUND; }
      if (where.kind === 'loading') {
        window.ensureRange(where.first, where.last);
        scrollTo(where.center);
        return LOOKUP_LOADING;
      }
      return lookupGone(where.next === undefined ? undefined : cardFocusKey(own, where.next));
    },
  };
}
