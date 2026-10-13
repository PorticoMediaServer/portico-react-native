import type {BrowseCapabilities, BrowseNode, BrowseSortSelection} from '../../../../packages/client-core/src/browse';

/**
 * A group of a library's titles (a collection, an album's or an artist's songs, a season's
 * episodes, an author's books, a person's titles, a list) as something the common browse route
 * can sort and filter: the library and pivot its members are read as, the server's surface for
 * this kind of group, and the condition that makes a title a member.
 *
 * The condition is the group. It is sent with every request, ahead of anything the viewer
 * chooses; it is never shown as a filter and nothing the viewer does can take it away, so
 * clearing the filters returns to the whole group and never to the whole library.
 *
 * No React and no native code: tested under Node.
 */
export type GroupPredicate = Extract<BrowseNode, {field: string}>;
export type GroupSurface = 'collection-titles' | 'container-titles' | 'person-titles' | 'list-titles' | 'group-titles' | 'saved-view';
/** `base` is one condition for most groups; a saved view's is the whole expression it was saved with. */
export type GroupScope = Readonly<{libraryId: string; pivot: string; surface: GroupSurface; base: readonly BrowseNode[]}>;

/** The pivot a library's titles are browsed as, by its kind: what a collection, a person's page or a list holds of it. */
export function titlePivot(libraryKind: string | undefined): string | undefined {
  switch (libraryKind) {
    case 'movie': return 'movies';
    case 'tv': case 'anime': return 'shows';
    case 'music': return 'albums';
    case 'audiobook': return 'books';
    default: return undefined;
  }
}

/** A collection's titles in its library. */
export const collectionScope = (libraryId: string, libraryKind: string | undefined, collectionId: string): GroupScope | undefined => {
  const pivot = titlePivot(libraryKind);
  return pivot && libraryId && collectionId ? {libraryId, pivot, surface: 'collection-titles', base: [{field: 'collection', operator: 'equals', value: collectionId}]} : undefined;
};
/** What belongs to a title that holds others: a show's or a season's episodes, an album's or an artist's songs, an author's books. */
export const containerScope = (libraryId: string, pivot: string, containerId: string | undefined): GroupScope | undefined =>
  (libraryId && containerId ? {libraryId, pivot, surface: 'container-titles', base: [{field: 'memberOf', operator: 'equals', value: containerId}]} : undefined);
/** The titles a person is credited on, within one library. */
export const personScope = (libraryId: string, libraryKind: string | undefined, personId: string): GroupScope | undefined => {
  const pivot = titlePivot(libraryKind);
  return pivot && libraryId && personId ? {libraryId, pivot, surface: 'person-titles', base: [{field: 'person', operator: 'equals', value: personId}]} : undefined;
};
/** The titles on one of the profile's lists (a playlist, a personal collection), within one library. */
export const listScope = (libraryId: string, pivot: string | undefined, listId: string): GroupScope | undefined =>
  (pivot && libraryId && listId ? {libraryId, pivot, surface: 'list-titles', base: [{field: 'list', operator: 'equals', value: listId}]} : undefined);
/** The pivot a playlist's entries are browsed as in a library of this kind: the things a playlist holds (films, episodes, songs). */
export function playlistPivot(libraryKind: string | undefined): string | undefined {
  switch (libraryKind) {
    case 'movie': return 'movies';
    case 'tv': case 'anime': return 'episodes';
    case 'music': return 'songs';
    default: return undefined;
  }
}
/**
 * A saved view: the library, pivot and expression it was saved with. Its own sort is its own
 * order; what the viewer adds narrows it further and never widens it.
 */
export const savedViewScope = (definition: Readonly<{libraryId: string; pivot: string; query: BrowseNode | null}> | undefined): GroupScope | undefined =>
  (definition && definition.libraryId && definition.pivot ? {libraryId: definition.libraryId, pivot: definition.pivot, surface: 'saved-view', base: definition.query ? [definition.query] : []} : undefined);
/** Titles that share a name the library groups by (a book series) or a mark of the viewer's own (My List, Favorites). */
export const namedGroupScope = (libraryId: string, pivot: string | undefined, base: GroupPredicate): GroupScope | undefined =>
  (pivot && libraryId ? {libraryId, pivot, surface: 'group-titles', base: [base]} : undefined);

/**
 * Whether the server's vocabulary, already narrowed to the scope's pivot and surface, lets the
 * group be sorted and filtered: the pivot lists titles (not groups of them), the surface is one
 * the server names, every part of the group's condition is something it accepts, and it offers
 * at least one sort. A server that offers none of this simply shows the group as it always has.
 */
export function groupBrowsable(capabilities: BrowseCapabilities | undefined, scope: GroupScope | undefined): boolean {
  if (!capabilities || !scope) return false;
  const pivot = capabilities.resolvedPivot;
  if (!pivot || pivot.id !== scope.pivot || !pivot.browsable || pivot.aggregate) return false;
  const surface = capabilities.surfaces?.find(candidate => candidate.id === scope.surface);
  if (capabilities.surfaces && !surface) return false;
  // A surface that names its membership field is entered through that field and no other.
  if (surface?.membershipField && !scope.base.some(node => 'field' in node && node.field === surface.membershipField)) return false;
  // (A saved view's expression is the server's own, saved through this same vocabulary: it is sent back as it is.)
  if (!scope.base.every(node => !('field' in node) || capabilities.fields.some(field => field.id === node.field && field.operators.includes(node.operator)))) return false;
  return capabilities.sorts.length > 0;
}

/** What the server is asked: the group's own condition first, then the viewer's filters. */
export function groupPredicates(scope: GroupScope, chosen: readonly GroupPredicate[]): readonly BrowseNode[] {
  return [...scope.base, ...chosen];
}

/** One identity for a scope, for state that must start again when the group changes. */
export function groupKey(scope: GroupScope | undefined): string {
  return scope ? JSON.stringify([scope.libraryId, scope.pivot, scope.surface, scope.base]) : '';
}

/**
 * The viewer's choices for one group: a sort (none: the group's own order) and filters. "Engaged"
 * means the list on screen is the server's sorted and filtered answer and not the group's own
 * page: any filter, or any chosen sort.
 */
export type GroupChoice = Readonly<{sort?: BrowseSortSelection; predicates: readonly GroupPredicate[]}>;
export const noGroupChoice: GroupChoice = Object.freeze({predicates: Object.freeze([])});
export const groupEngaged = (choice: GroupChoice): boolean => !!choice.sort || choice.predicates.length > 0;

/**
 * The libraries a cross-library group is sorted and filtered in, the one holding most of its
 * titles first: those among `libraries` that hold any of `held` (the library of each title the
 * screen has read so far), or all of `libraries` when the screen has read none yet.
 */
export function groupLibraries<L extends Readonly<{id: string}>>(libraries: readonly L[], held: readonly (string | undefined)[]): readonly L[] {
  const counts = new Map<string, number>();
  for (const id of held) if (id) counts.set(id, (counts.get(id) ?? 0) + 1);
  const holding = libraries.filter(library => counts.has(library.id));
  return holding.length ? [...holding].sort((a, b) => (counts.get(b.id) ?? 0) - (counts.get(a.id) ?? 0)) : libraries;
}
