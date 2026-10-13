/**
 * Row models for lists that grow as the viewer scrolls (History, playlists, a saved view).
 *
 * The screen hands these rows to one virtualised list, so only the rows near the viewport are
 * mounted however many pages have been read. Building the rows is plain arithmetic over what
 * has been loaded; nothing here renders.
 */

export {gridColumns} from '../ui/grid-columns';

export type CardRowModel<T> = {kind: 'cards'; key: string; first: number; items: readonly T[]};

/** `items` cut into rows of `columns`. A row is keyed by its first item, so earlier rows keep their identity as pages arrive. */
export function cardRows<T>(items: readonly T[], columns: number, keyOf: (item: T) => string, prefix = 'cards'): CardRowModel<T>[] {
  const out: CardRowModel<T>[] = [];
  const step = Math.max(1, Math.floor(columns));
  for (let i = 0; i < items.length; i += step) out.push({kind: 'cards', key: `${prefix}:${keyOf(items[i]!)}`, first: i, items: items.slice(i, i + step)});
  return out;
}

export type DayRowModel = {kind: 'day'; key: string; label: string};

type Dated = {id: string; hidden: boolean; media?: {id: string}; updatedAt?: string};

/**
 * History as rows: one card per title (its latest position; the list arrives newest first),
 * under a heading per day. `columnsFor` answers per day because a day's cards share one shape.
 */
export function historyRows<T extends Dated>(entries: readonly T[], dayOf: (iso: string | undefined) => string, columnsFor: (day: readonly T[]) => number): {rows: (DayRowModel | CardRowModel<T>)[]; shown: number} {
  const seen = new Set<string>();
  const days: {label: string; entries: T[]}[] = [];
  for (const entry of entries) {
    const id = entry.media?.id;
    if (entry.hidden || !id || seen.has(id)) continue;
    seen.add(id);
    const label = dayOf(entry.updatedAt);
    const last = days[days.length - 1];
    if (last && last.label === label) last.entries.push(entry);
    else days.push({label, entries: [entry]});
  }
  const rows: (DayRowModel | CardRowModel<T>)[] = [];
  for (const day of days) {
    // A day is named by its first title, which never changes once it is listed.
    rows.push({kind: 'day', key: `day:${day.entries[0]!.id}`, label: day.label});
    rows.push(...cardRows(day.entries, columnsFor(day.entries), e => e.id, 'history'));
  }
  return {rows, shown: seen.size};
}
