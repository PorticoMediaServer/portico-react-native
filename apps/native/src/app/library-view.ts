import {libraryOpening, rememberedTab, type RememberedFilter, type RememberedLibrary} from '../../../../packages/client-core/src/library-memory';
import {genreFilter, libraryTabs, type LibraryTab, type LibraryTabId} from '../../../../packages/client-core/src/presentation/index';

/**
 * What the library screen shows: the tab, and that tab's sort and filters. Platform-neutral, so
 * the rules for how a library opens are tested without a device.
 *
 * A library opened plainly (from the rail, the tab bar or the library switcher) reopens the way
 * this profile left it. A library opened through a link that names a tab, a category or a genre
 * shows what the link says and leaves what is remembered alone.
 */
export type ViewSort = Readonly<{sort?: string; direction?: 'asc' | 'desc'}>;
export type ViewFilter = Readonly<{field: string; operator: string; value?: unknown}>;
export type LibraryView<Tab extends string = string> = Readonly<{
  tab: Tab;
  sort: ViewSort;
  filters: readonly ViewFilter[];
  /** The filters were put there from memory, not by a link or by hand just now: one the library no longer offers is dropped instead of failing the page. */
  recalled: boolean;
}>;

const noSort: ViewSort = Object.freeze({});
const noFilters: readonly ViewFilter[] = Object.freeze([]);

/** What a link to the library names. All absent: a plain visit. */
export type LibraryLink<Tab extends string = string> = Readonly<{tab?: Tab; category?: string; genre?: string}>;

/**
 * The view a library opens on. `tabs` are the tabs it has for this person now, first one first;
 * a remembered tab that is no longer among them is ignored.
 */
export function openingView<Tab extends string>(link: LibraryLink<Tab>, remembered: RememberedLibrary | undefined, tabs: readonly Tab[], fallback: Tab): LibraryView<Tab> {
  const named = link.tab !== undefined || !!link.category || !!link.genre;
  const opening = libraryOpening({tab: link.tab, other: named && link.tab === undefined}, remembered, tabs);
  if (!opening.remembered) return {tab: link.tab ?? fallback, sort: noSort, filters: noFilters, recalled: false};
  // With no remembered tab the choices are those of the tab the library opens on by itself.
  const tab = (opening.tab as Tab | undefined) ?? fallback;
  return {tab, sort: opening.sort ? {sort: opening.sort.field, direction: opening.sort.direction} : noSort, filters: opening.filters ?? noFilters, recalled: !!opening.filters?.length};
}

/** The view a tab comes back with when the person picks it: its own last sort and filters. */
export function tabView<Tab extends string>(remembered: RememberedLibrary | undefined, tab: Tab): LibraryView<Tab> {
  const kept = rememberedTab(remembered, tab);
  return {tab, sort: kept?.sort ? {sort: kept.sort.field, direction: kept.sort.direction} : noSort, filters: kept?.filters ?? noFilters, recalled: !!kept?.filters?.length};
}

/** A tab shown because a link, a row's "See all" or a genre asked for it, with the filters it names. */
export function linkedView<Tab extends string>(tab: Tab, filters: readonly ViewFilter[] = noFilters): LibraryView<Tab> {
  return {tab, sort: noSort, filters, recalled: false};
}

/** The filters to ask the server with: remembered ones the library no longer offers are left out. */
export function offeredFilters<F extends ViewFilter>(view: Readonly<{filters: readonly F[]; recalled: boolean}>, fields: readonly Readonly<{id: string; operators: readonly string[]}>[] | undefined): readonly F[] {
  if (!view.recalled || !fields) return view.filters;
  const kept = view.filters.filter(filter => fields.some(field => field.id === filter.field && field.operators.includes(filter.operator)));
  return kept.length === view.filters.length ? view.filters : kept;
}

export type {RememberedFilter};

/**
 * The order a tab opens in when the viewer has chosen none (Recently aired: the latest episode
 * first). It is only where the tab starts: the viewer may choose any sort the server offers, and
 * the choice is remembered for the tab like any other. The shared tab list names this
 * `defaultSort`; the copy this app was last built against still calls it `fixedSort`. Both read
 * the same here, so the app follows the shared list whichever it carries.
 */
export function tabDefaultSort(tab: LibraryTab): Readonly<{field: string; direction: 'asc' | 'desc'}> | undefined {
  const named = tab as LibraryTab & {defaultSort?: Readonly<{field: string; direction: 'asc' | 'desc'}>; fixedSort?: Readonly<{field: string; direction: 'asc' | 'desc'}>};
  return named.defaultSort ?? named.fixedSort;
}

/** The field a tab of groups opens another tab filtered by (Music's Genres open Albums by genre; an audiobook library's Series open Books by series). */
const GROUP_TAB_FIELD: Readonly<Record<string, string>> = {genres: 'genre', series: 'series'};

/**
 * Where a tab of groups sends a group that is pressed: the tab that lists its titles, and the
 * field that names the group. The shared tab list says so for the tabs it knows (`opens`); a
 * Series tab that does not say yet opens Books, as the web does.
 */
export function groupTabOpens(tab: LibraryTab, tabs: readonly LibraryTab[]): Readonly<{tab: LibraryTabId; field: string}> | undefined {
  if (tab.opens) return tab.opens;
  const field = GROUP_TAB_FIELD[tab.id];
  if (!field || tab.id !== 'series') return undefined;
  const titles = tabs.find(other => other.id === 'browse' && !!other.pivot);
  return titles ? {tab: titles.id, field} : undefined;
}

/**
 * Where a category link leads ("genre:Drama", "decade:1990", "studio:Pixar", "series:Dune"): the
 * library tab that lists those titles, with the category as one ordinary filter. The viewer then
 * has every sort and filter the tab has. Undefined for a category this app does not know (it is
 * shown as the server composes it). The same rule as the web's `categoryDestination`.
 */
export function categoryDestination(kind: string, category: string): Readonly<{tab: LibraryTabId; predicate: ViewFilter}> | undefined {
  const at = category.indexOf(':');
  if (at <= 0 || at === category.length - 1) return undefined;
  const field = category.slice(0, at), value = category.slice(at + 1);
  if (field !== 'genre' && field !== 'decade' && field !== 'studio' && field !== 'series') return undefined;
  if (field === 'decade' && !/^\d{4}$/.test(value)) return undefined;
  const tabs = libraryTabs(kind);
  const group = tabs.map(tab => groupTabOpens(tab, tabs)).find(opens => opens?.field === field);
  // A genre reads as the filter a genre pressed on a title page applies, so its chip and the Genre control agree.
  const predicate: ViewFilter = field === 'genre' ? genreFilter(value) : {field, operator: 'in', value: [field === 'decade' ? Number(value) : value]};
  return {tab: group?.tab ?? 'browse', predicate};
}
