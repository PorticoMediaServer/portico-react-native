import {routePath} from '../../../../packages/contracts/src/routes';
import {scopeBrowseCapabilities} from './browse-options';
import {useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore} from 'react';
import {Platform} from 'react-native';
import {createWindowedCollection, type FetchPage, type WindowedCollection} from '../../../../packages/client-core/src/collections/index';
import type {ContentEntry, ContentSeeAll} from '../../../../packages/client-core/src/library-content';
import {parseBrowseCapabilities, parseBrowseFacets, type BrowseCapabilities, type BrowseFacetValue, type BrowseNode, type BrowseSortSelection} from '../../../../packages/client-core/src/browse';
import {browsePageSource} from './browse-page-source.ts';
import type {Predicate as PagePredicate} from './browse-page-source.ts';
import {useSession} from './session';
import {useFreshDocument} from './freshness';
import {titlesWithPersonalState} from '../../../../packages/client-core/src/freshness-hub';
import {say} from './errors';
import {serviceText} from '../../../../packages/client-core/src/presentation/service-text';
import {appliedFilterLabel} from '../../../../packages/client-core/src/presentation/index';
import {activeI18n} from './errors';
export {browsePageSource as appleBrowsePageSource};
export type {PagePredicate};

/**
 * Library browsing on the server's expression engine. The server publishes the
 * vocabulary (fields, operators, sorts, quick filters) per library and pivot;
 * this hook only assembles requests from it and pages results. Filters live in
 * the URL as a compact JSON list of predicates so a view is linkable.
 */
export type Predicate = Extract<BrowseNode, {field: string}>;

/** The vocabulary last read for each library and pivot, and the reads under way. */
const capabilityCache = new Map<string, BrowseCapabilities>();
const capabilityReads = new Map<string, Promise<BrowseCapabilities>>();
/**
 * A library's sorts and filters. What was read last is shown at once, and it is read again every
 * time the library is opened, so a change on the server (a new field, a sort that has gone)
 * arrives without restarting the app. `attempt`: bump it to read again after a failure.
 */
export function useBrowseCapabilities(libraryId: string | undefined, pivot: string | undefined, attempt = 0, surfaceId = 'library') {
  const {api, session} = useSession();
  const [state, setState] = useState<{capabilities?: BrowseCapabilities; error?: string}>({});
  useEffect(() => {
    if (!libraryId || !pivot) { setState({}); return; }
    const key = `${session?.sessionFamilyId ?? ''}/${session?.viewer.profileId ?? ''}:${libraryId}:${pivot}`;
    const held = capabilityCache.get(key);
    if (held) setState({capabilities: held});
    let read = capabilityReads.get(key);
    if (!read) {
      const started = api.request<unknown>(routePath('get_libraries_id_browse_capabilities', {id: libraryId}) + `?pivot=${encodeURIComponent(pivot)}`, 'GET').then(parseBrowseCapabilities);
      read = started;
      capabilityReads.set(key, started);
      started.then(c => { if (!sameVocabulary(capabilityCache.get(key), c)) capabilityCache.set(key, c); }, () => {}).finally(() => { if (capabilityReads.get(key) === started) capabilityReads.delete(key); });
    }
    let cancelled = false;
    read.then(
      // An unchanged answer keeps the object the screen already has, so nothing redraws or asks again.
      () => { if (!cancelled) setState(current => { const now = capabilityCache.get(key); return now && current.capabilities !== now ? {capabilities: now} : current; }); },
      // A recheck that fails leaves the vocabulary already on screen; only a first read reports it.
      e => { if (!cancelled && !held) setState({error: say(e, 'library', 'load')}); },
    );
    return () => { cancelled = true; };
  }, [api, session?.sessionFamilyId, session?.viewer.profileId, libraryId, pivot, attempt]);
  const capabilities = useMemo(() => state.capabilities && state.capabilities.library.id === libraryId && pivot ? scopeBrowseCapabilities(state.capabilities, pivot, surfaceId) : undefined, [state.capabilities, libraryId, pivot, surfaceId]);
  return {...state, capabilities};
}

/**
 * PERF-01 / PERF-02 / TV-LIB-01: a library's Browse results as a windowed collection. Only the
 * pages near the viewport are requested and held (at most `maxResidentPages` × 60 entries,
 * whatever the library size); a filter or sort change swaps in a new generation without
 * flashing to empty; letter jumps use the server's position index.
 *
 * Paging follows `./browse-page-source.ts` with bucket re-anchoring for non-title sorts.
 */
export function useBrowseWindow(input: {libraryId?: string; pivot?: string; predicates: readonly Predicate[]; sort?: BrowseSortSelection; published?: ContentSeeAll; enabled: boolean}) {
  const {api} = useSession();
  const {libraryId, pivot, predicates, sort, published, enabled} = input;
  const fetchFor = useCallback((): FetchPage<ContentEntry> => {
    if (!libraryId || !pivot) return async () => ({items: [], total: 0});
    return browsePageSource(api, {libraryId, pivot, predicates, sort, ...(published ? {query: published.query, sorts: published.sort} : {})});
  }, [api, libraryId, pivot, predicates, sort, published]);
  // One store per library and pivot; a new query is a new generation of the same store.
  const list = useMemo<WindowedCollection<ContentEntry> | null>(
    () => (enabled && libraryId && pivot ? createWindowedCollection<ContentEntry>({fetchPage: fetchFor(), pageSize: 60, maxResidentPages: Platform.isTV ? 5 : 8, keyOf: e => e.id}) : null),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [api, libraryId, pivot, enabled],
  );
  useEffect(() => () => list?.dispose(), [list]);
  const queryKey = JSON.stringify(published ? [published.pivot, published.query, published.sort] : [predicates, sort]);
  const firstQuery = useRef(queryKey);
  useEffect(() => {
    if (!list) return;
    if (firstQuery.current === queryKey) return;
    firstQuery.current = queryKey;
    list.invalidate(fetchFor());
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [list, queryKey]);
  // The list follows its library and this profile's marks while its screen is in front: the same
  // list is read again behind the one on screen (a new reading has a new revision) and swapped in
  // whole, at the same place, once the remote or the finger has been still for a moment. Cells
  // keep their keys, so focus stays on the cell it was on.
  const latestFetch = useRef(fetchFor);
  latestFetch.current = fetchFor;
  const markCurrent = useFreshDocument(
    useMemo(() => (list && libraryId ? titlesWithPersonalState(libraryId) : []), [list, libraryId]),
    context => (list ? list.revalidate({fetchPage: latestFetch.current(), hold: context.settle}) : Promise.resolve()),
    () => list?.getSnapshot().total !== undefined,
  );
  useEffect(() => { markCurrent(); }, [list, queryKey, markCurrent]);
  const subscribe = useCallback((listener: () => void) => list?.subscribe(listener) ?? (() => {}), [list]);
  const snapshot = useSyncExternalStore(subscribe, () => list?.getSnapshot() ?? idleSnapshot);
  return {list, snapshot};
}
function sameVocabulary(a: BrowseCapabilities | undefined, b: BrowseCapabilities): boolean {
  return !!a && JSON.stringify(a) === JSON.stringify(b);
}
const idleSnapshot = Object.freeze({generation: 0, total: undefined, status: 'idle' as const, error: undefined, positionIndex: undefined, refreshing: false});

export function useFacets(libraryId: string | undefined) {
  const {api} = useSession();
  return useCallback(async (field: string, q = ''): Promise<readonly BrowseFacetValue[]> => {
    if (!libraryId) return [];
    const params = new URLSearchParams({field, limit: '100'});
    if (q) params.set('q', q);
    const raw = await api.request<unknown>(routePath('get_library_facets', {id: libraryId}) + `?${params}`, 'GET');
    return parseBrowseFacets(raw, field).values;
  }, [api, libraryId]);
}

/** Field and quick-filter names come from the catalogue (`filter.field.*`, `filter.quick.*`), as on the web; a field the catalogue has no name for yet is said as plain words from its key. */
function catalogueLabel(prefix: 'filter.field.' | 'filter.quick.', ...keys: string[]): string | undefined {
  const i18n = activeI18n();
  const has = i18n.has as (id: string) => boolean;
  for (const key of keys) { const id = prefix + key; if (key && has(id)) return (i18n.t as (id: string) => string)(id); }
  return undefined;
}
const sentence = (key: string) => key.replace(/([A-Z])/g, ' $1').toLowerCase().replace(/^./, c => c.toUpperCase());
/** Fields a server names two ways: both read the one catalogue entry. */
const SAME_FIELD: Readonly<Record<string, string>> = {addedAt: 'dateAdded', personalRating: 'userRating', durationSeconds: 'duration', lastPlayedAt: 'lastPlayed', communityRating: 'audienceRating'};
export function fieldLabel(id: string, labelKey?: string): string {
  // P6: For you isn't a field; it names itself from the catalogue.
  if (labelKey === 'sort.forYou') return serviceText('sort.forYou');
  const key = (labelKey ?? '').replace(/^browse\.field\./, '').replace(/^sort\./, '') || id;
  return catalogueLabel('filter.field.', key, id, SAME_FIELD[key] ?? '', SAME_FIELD[id] ?? '') ?? sentence(key);
}
export function quickFilterLabel(labelKey: string): string {
  const key = labelKey.replace(/^filter\./, '');
  return catalogueLabel('filter.quick.', key) ?? sentence(key);
}
export function predicateLabel(p: Predicate, capabilities?: BrowseCapabilities): string {
  return appliedFilterLabel(p, id => fieldLabel(id, capabilities?.fields.find(f => f.id === id)?.labelKey), activeI18n().t);
}
