import {libraryOpening, rememberedTab, type RememberedFilter, type RememberedLibrary} from '../../../../packages/client-core/src/library-memory';

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
