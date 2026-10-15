import type {QueueAnchor, QueueBrowseSelector, Selector} from '../../../../packages/client-core/src/playback-v1/index';
import type {BrowseNode, BrowseSortSelection} from '../../../../packages/client-core/src/browse';

/**
 * Container plays on Playback v1 (Client Playback Migration): a show, a season, an album, an
 * artist, a disc, a collection, a playlist or a book plays or shuffles as one server request
 * (`playSelector`) that the server snapshots, however large, instead of the page of entries the
 * screen has loaded. Pure, so node tests cover the choice (test/container-play.test.ts); the
 * player calls `containerPlay`.
 *
 * A sorted or filtered list, and a saved view or personal collection, plays the same way: the
 * server's own query (`viewSequence`, `groupSequence`) or the saved resource (`savedSequence`),
 * so Play, Shuffle and play-from-here cover exactly what the list shows, however long, never the
 * rows loaded.
 */

/** Containers the v1 selector names directly. */
export type ContainerKind = 'show' | 'season' | 'album' | 'artist' | 'disc' | 'collection' | 'playlist' | 'book';
const KINDS: ReadonlySet<string> = new Set<ContainerKind>(['show', 'season', 'album', 'artist', 'disc', 'collection', 'playlist', 'book']);

/**
 * The container a sequence comes from; `shuffle` plays it in the server's shuffle. In a playlist,
 * `entryId` is the pressed occurrence, so the copy pressed plays when a title is in it twice.
 * `query` is a library's browse (a sorted or filtered list); `saved` a saved view or personal
 * collection by its id.
 */
export type SequenceContainer =
  | Readonly<{kind: ContainerKind; id: string; shuffle?: boolean; entryId?: string}>
  | Readonly<{kind: 'query'; query: QueueBrowseSelector; shuffle?: boolean}>
  | Readonly<{kind: 'saved'; id: string; shuffle?: boolean}>;

/**
 * The container a screen passes with Play or Shuffle, or undefined (the loaded entries play).
 * A disc page names its catalog navigation id (`albumId:disc:N`); the v1 disc selector takes
 * `albumId:N`, so the id is mapped (an unmappable disc falls back to the entry list). An
 * episode group that isn't a season (an arc, a range, a year) would need the show with a range,
 * which the v1 selector can't express yet, so it falls back to the entry list. Popular tracks
 * (a top-5 list) always play their own five as an item list, so callers pass no container.
 */
export function sequenceContainer(kind: string | undefined, id: string | undefined, o: {shuffle?: boolean; group?: boolean} = {}): SequenceContainer | undefined {
  if (!kind || !id || !KINDS.has(kind) || o.group) return undefined;
  if (kind === 'disc') {
    const mapped = discSelectorId(id);
    if (!mapped) return undefined;
    return {kind: 'disc', id: mapped, ...(o.shuffle ? {shuffle: true} : {})};
  }
  return {kind: kind as ContainerKind, id, ...(o.shuffle ? {shuffle: true} : {})};
}

/**
 * A disc page id (`albumId:disc:N`, the catalog's navigation id) as the playbackv1 disc
 * container id (`albumId:N`), or undefined when the page id doesn't parse.
 */
export function discSelectorId(id: string): string | undefined {
  const at = id.indexOf(':disc:');
  if (at < 0) return undefined;
  const album = id.slice(0, at);
  const raw = id.slice(at + ':disc:'.length);
  if (!album || !/^\d{1,4}$/.test(raw)) return undefined;
  return `${album}:${Number(raw)}`;
}

/** A playlist played from one of its rows: that occurrence, not the title's first copy. */
export function occurrenceSequence(playlistId: string, entryId: string): SequenceContainer {
  return {kind: 'playlist', id: playlistId, entryId};
}

/** A saved view or personal collection, whole, in its own order (or the server's shuffle). */
export function savedSequence(id: string, o: {shuffle?: boolean} = {}): SequenceContainer {
  return {kind: 'saved', id, ...(o.shuffle ? {shuffle: true} : {})};
}

/**
 * The list on screen as the server's browse query: the library, the pivot, the conditions (what
 * the list is of, then the viewer's filters) and the sort, exactly as the list itself is read. A
 * published list (a Home row's See all) sends its own query and sorts. Undefined until the list
 * has a library and a pivot.
 */
export function viewSequence(view: Readonly<{libraryId?: string; pivot?: string; predicates?: readonly BrowseNode[]; sort?: BrowseSortSelection; query?: BrowseNode; sorts?: readonly BrowseSortSelection[]}>, o: {shuffle?: boolean} = {}): SequenceContainer | undefined {
  if (!view.libraryId || !view.pivot) return undefined;
  const conditions = view.sorts ? view.query : view.predicates?.length ? {all: [...view.predicates]} : undefined;
  const sort = view.sorts ? [...view.sorts] : view.sort ? [view.sort] : undefined;
  return {kind: 'query', query: {libraryId: view.libraryId, pivot: view.pivot, ...(conditions ? {query: conditions} : {}), ...(sort ? {sort} : {})}, ...(o.shuffle ? {shuffle: true} : {})};
}

/**
 * A group's sorted or filtered list (`useGroupBrowse`) as the server's query, or undefined while
 * the group shows its own list (its own container plays then).
 */
export function groupSequence(group: Readonly<{engaged: boolean; scope?: Readonly<{libraryId: string; pivot: string}>; predicates: readonly BrowseNode[]; sort: BrowseSortSelection}>, o: {shuffle?: boolean} = {}): SequenceContainer | undefined {
  if (!group.engaged || !group.scope) return undefined;
  return viewSequence({libraryId: group.scope.libraryId, pivot: group.scope.pivot, predicates: group.predicates, sort: group.sort}, o);
}

/** The selector a sequence names. */
export function containerSelector(container: SequenceContainer): Selector {
  if (container.kind === 'query') return {query: container.query};
  if (container.kind === 'saved') return {saved: {id: container.id}};
  return {container: {kind: container.kind, id: container.id}};
}

/**
 * What the player sends for a play action: one `playSelector` with a container, else null (the
 * entry list). Play starts at the pressed entry (`anchor`, the pressed playlist occurrence when
 * there is one); Shuffle lets the server choose the first entry.
 */
export function containerPlay(container: SequenceContainer | undefined, firstItemId: string, startSeconds: number): {selector: Selector; options: {shuffle?: boolean; anchor?: QueueAnchor; startSeconds?: number}} | null {
  if (!container) return null;
  const entryId = 'entryId' in container ? container.entryId : undefined;
  return {
    selector: containerSelector(container),
    options: container.shuffle ? {shuffle: true} : {anchor: entryId ? {entryId, itemId: firstItemId} : {itemId: firstItemId}, ...(startSeconds > 0 ? {startSeconds} : {})},
  };
}
