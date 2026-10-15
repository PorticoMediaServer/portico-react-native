import {useCallback, useEffect, useMemo, useState, useSyncExternalStore} from 'react';
import {acrossLibraries, type BrowseSortSelection} from '../../../../packages/client-core/src/browse';
import {titlesWithPersonalState} from '../../../../packages/client-core/src/freshness-hub';
import {useBrowseCapabilities, useBrowseWindow, type Predicate} from './browse';
import {offeredBrowseSort} from './browse-options';
import {BrowsePages, type BrowsePagesSnapshot} from './browse-pages';
import {useFreshDocument} from './freshness';
import {groupBrowsable, groupEngaged, groupKey, groupKeepsOwnOrder, groupPredicates, noGroupChoice, type GroupChoice, type GroupPredicate, type GroupScope} from './group-scope';
import {groupMemoryId, groupMemoryScope, groupMemoryTab, groupOrderSort, offersGroupOrder} from '../../../../packages/client-core/src/presentation/browse-groups';
import {libraryMemoryFor} from './library-memory';
import {viewerScope} from './viewer-scope';
import {useSession} from './session';

/**
 * The same Sort and Filter the library has, for a group of its titles (Justin, 14 October: the
 * same options whichever part or sub-group of a library is on screen). The group keeps its own
 * order (a collection's, an album's track order, a season's episode order, a person's credits)
 * until the viewer chooses a sort or a filter; from then on what is listed is the server's answer
 * to the common browse route, within the group (`group-scope.ts`).
 *
 * The choices are remembered on the device for each group, as a library tab's are: a group reopens
 * with the sort and filters it was left with (client-core `groupMemoryScope`).
 */
export function useGroupBrowse(scope: GroupScope | undefined) {
  const key = groupKey(scope);
  const {capabilities: read} = useBrowseCapabilities(scope?.libraryId, scope?.pivot, 0, scope?.surface ?? 'library');
  const available = groupBrowsable(read, scope);
  const capabilities = available ? read : undefined;
  const {session, api} = useSession();
  const viewer = viewerScope(session, api);
  const memory = useMemo(() => libraryMemoryFor(groupMemoryScope(viewer)), [viewer]);
  const memoryReady = useSyncExternalStore(memory.subscribe.bind(memory), () => memory.isReady);
  const memoryId = scope ? groupMemoryId(scope.libraryId, scope.pivot, scope.base) : '';
  // What this group was left with, until something is chosen here.
  const recalled = useMemo<GroupChoice>(() => {
    const left = memoryId ? memory.recall(memoryId)?.tabs[groupMemoryTab] : undefined;
    return left ? {...(left.sort ? {sort: left.sort} : {}), predicates: (left.filters ?? []) as readonly GroupPredicate[]} : noGroupChoice;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [memory, memoryId, memoryReady]);
  const [held, setHeld] = useState<{key: string; choice: GroupChoice}>({key: '', choice: noGroupChoice});
  const choice = held.key === key ? held.choice : recalled;
  const engaged = available && groupEngaged(choice);
  // A group whose order the server keeps under a filter stays in it until a sort is chosen.
  const keepsOwn = groupKeepsOwnOrder(scope) && offersGroupOrder(capabilities?.sorts);
  /** The sort in force once engaged: the viewer's, else the group's own order or the server's own for the pivot. */
  const sort = useMemo<BrowseSortSelection>(() => (!choice.sort && keepsOwn ? {field: groupOrderSort, direction: 'asc'} : offeredBrowseSort(capabilities, choice.sort)), [capabilities, choice.sort, keepsOwn]);
  /** The group's own order is the one in use: no sort chosen, and no filter or one the server keeps it under. */
  const ownSelected = !choice.sort && (!engaged || keepsOwn);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  // (The list store types its conditions as single ones; it sends whatever it is given under one conjunction, a saved view's whole expression included.)
  const predicates = useMemo<readonly Predicate[]>(() => (scope ? (groupPredicates(scope, choice.predicates as readonly Predicate[]) as readonly Predicate[]) : []), [key, choice.predicates]);
  const change = useCallback((patch: Partial<GroupChoice>) => setHeld(current => ({key, choice: {...(current.key === key ? current.choice : recalled), ...patch}})), [key, recalled]);
  const setSort = useCallback((next: BrowseSortSelection | undefined) => {
    if (memoryId) memory.rememberSort(memoryId, groupMemoryTab, next ? {field: next.field, direction: next.direction} : undefined);
    change({sort: next});
  }, [change, memory, memoryId]);
  const setPredicates = useCallback((next: readonly Predicate[]) => {
    if (memoryId) memory.rememberFilters(memoryId, groupMemoryTab, next);
    change({predicates: next});
  }, [change, memory, memoryId]);
  /** Back to the group as it is by itself: no filters, its own order. */
  const reset = useCallback(() => {
    if (memoryId) { memory.rememberSort(memoryId, groupMemoryTab, undefined); memory.rememberFilters(memoryId, groupMemoryTab, []); }
    setHeld({key, choice: noGroupChoice});
  }, [key, memory, memoryId]);
  return useMemo(() => ({scope, capabilities, available, choice, engaged, ownSelected, sort, predicates, setSort, setPredicates, reset}), [scope, capabilities, available, choice, engaged, ownSelected, sort, predicates, setSort, setPredicates, reset]);
}
export type GroupBrowse = ReturnType<typeof useGroupBrowse>;

/**
 * The group's sorted and filtered titles as a windowed list, for a screen whose list is already
 * one (an album's songs, a season's episodes, a person's titles): it takes the place of the
 * screen's own list while the viewer's choices are on, in the same scroller, so nothing above it
 * is drawn again and television focus stays where it is. Null while the group shows its own order.
 */
export function useGroupWindow(group: GroupBrowse, enabled = true) {
  return useBrowseWindow({libraryId: group.scope?.libraryId, pivot: group.scope?.pivot, predicates: group.predicates, sort: group.sort, enabled: enabled && group.engaged});
}

const idlePages: BrowsePagesSnapshot = Object.freeze({status: 'idle', entries: Object.freeze([]), hasMore: false, loadingMore: false});

/**
 * The group's sorted and filtered titles for a list that sits inside a page (`BrowsePages`): the
 * first page, then more when the viewer asks. It follows the library and this profile's marks
 * while its screen is in front, like every other list.
 */
export function useGroupPages(group: GroupBrowse, enabled = true) {
  const {api} = useSession();
  const libraryId = enabled ? group.scope?.libraryId : undefined;
  const pivot = group.scope?.pivot;
  const pages = useMemo(() => (libraryId ? new BrowsePages(api, libraryId) : null), [api, libraryId]);
  useEffect(() => () => pages?.dispose(), [pages]);
  const {engaged, predicates, sort} = group;
  useEffect(() => { pages?.select(engaged && pivot ? {pivot, predicates, sort} : null); }, [pages, engaged, pivot, predicates, sort]);
  useFreshDocument(
    useMemo(() => (pages && libraryId ? titlesWithPersonalState(libraryId === acrossLibraries ? undefined : libraryId) : []), [pages, libraryId]),
    context => (pages ? pages.refresh(context.settle) : Promise.resolve()),
    () => pages?.getSnapshot().status === 'ready',
  );
  const subscribe = useCallback((listener: () => void) => pages?.subscribe(listener) ?? (() => {}), [pages]);
  const snapshot = useSyncExternalStore(subscribe, () => pages?.getSnapshot() ?? idlePages);
  return {pages, snapshot};
}
