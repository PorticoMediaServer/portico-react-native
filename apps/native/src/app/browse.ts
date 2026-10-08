import {useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore} from 'react';
import {Platform} from 'react-native';
import {createWindowedCollection, type FetchPage, type WindowedCollection} from '../../../../packages/client-core/src/collections/index';
import type {ContentEntry, ContentSeeAll} from '../../../../packages/client-core/src/library-content';
import {parseBrowseCapabilities, parseBrowseFacets, type BrowseCapabilities, type BrowseFacetValue, type BrowseNode, type BrowseSortSelection} from '../../../../packages/client-core/src/browse';
import {browsePageSource} from './browse-page-source.ts';
import type {Predicate as PagePredicate} from './browse-page-source.ts';
import {useSession} from './session';
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

const capabilityCache = new Map<string, Promise<BrowseCapabilities>>();
/** `attempt`: bump it to read again after a failure (a failed read is not cached). */
export function useBrowseCapabilities(libraryId: string | undefined, pivot: string | undefined, attempt = 0) {
  const {api, session} = useSession();
  const [state, setState] = useState<{capabilities?: BrowseCapabilities; error?: string}>({});
  useEffect(() => {
    if (!libraryId || !pivot) { setState({}); return; }
    const key = `${session?.sessionFamilyId ?? ''}/${session?.viewer.profileId ?? ''}:${libraryId}:${pivot}`;
    let promise = capabilityCache.get(key);
    if (!promise) {
      promise = api.request<unknown>(`/v1/libraries/${encodeURIComponent(libraryId)}/browse-capabilities?pivot=${encodeURIComponent(pivot)}`, 'GET').then(parseBrowseCapabilities);
      capabilityCache.set(key, promise);
      promise.catch(() => capabilityCache.delete(key));
    }
    let cancelled = false;
    promise.then(c => { if (!cancelled) setState({capabilities: c}); }, e => { if (!cancelled) setState({error: say(e, 'library', 'load')}); });
    return () => { cancelled = true; };
  }, [api, session?.sessionFamilyId, session?.viewer.profileId, libraryId, pivot, attempt]);
  return state;
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
  const subscribe = useCallback((listener: () => void) => list?.subscribe(listener) ?? (() => {}), [list]);
  const snapshot = useSyncExternalStore(subscribe, () => list?.getSnapshot() ?? idleSnapshot);
  return {list, snapshot};
}
const idleSnapshot = Object.freeze({generation: 0, total: undefined, status: 'idle' as const, error: undefined, positionIndex: undefined, refreshing: false});

export function useFacets(libraryId: string | undefined) {
  const {api} = useSession();
  return useCallback(async (field: string, q = ''): Promise<readonly BrowseFacetValue[]> => {
    if (!libraryId) return [];
    const params = new URLSearchParams({field, limit: '100'});
    if (q) params.set('q', q);
    const raw = await api.request<unknown>(`/v1/libraries/${encodeURIComponent(libraryId)}/facets?${params}`, 'GET');
    return parseBrowseFacets(raw, field).values;
  }, [api, libraryId]);
}

const fieldNames: Record<string, string> = {genre: 'Genre', decade: 'Decade', year: 'Year', title: 'Title', dateAdded: 'Date added', addedAt: 'Date added', playState: 'Play state', availability: 'Availability', resolution: 'Resolution', contentRating: 'Content rating', studio: 'Studio', network: 'Network', tag: 'Tag', label: 'Label', audioLanguage: 'Audio language', dynamicRange: 'Dynamic range', releaseDate: 'Release date', series: 'Series', person: 'Person', actor: 'Actor', director: 'Director', writer: 'Writer', rating: 'Rating', userRating: 'Your rating', personalRating: 'Your rating', favorite: 'Favorite', watchlisted: 'My List', duration: 'Duration', durationSeconds: 'Duration', entityKind: 'Type', collection: 'Collection', artist: 'Artist', album: 'Album', author: 'Author', narrator: 'Narrator', lastPlayed: 'Last played', lastPlayedAt: 'Last played', played: 'Played', communityRating: 'Audience rating', audienceRating: 'Audience rating', criticRating: 'Critic rating'}; // lint-strings-allow: server field-name map (only Title/Label match the lint's prop list; needs server label IDs like the web editor)
const sentence = (key: string) => key.replace(/([A-Z])/g, ' $1').toLowerCase().replace(/^./, c => c.toUpperCase());
export function fieldLabel(id: string, labelKey?: string): string {
  // P6: For you isn't a field; it names itself from the catalogue.
  if (labelKey === 'sort.forYou') return serviceText('sort.forYou');
  const key = (labelKey ?? '').replace(/^browse\.field\./, '').replace(/^sort\./, '') || id;
  return fieldNames[key] ?? fieldNames[id] ?? sentence(key);
}
export function quickFilterLabel(labelKey: string): string {
  const key = labelKey.replace(/^filter\./, '');
  const names: Record<string, string> = {inProgress: 'In progress', unplayed: 'Unplayed', unwatched: 'Unwatched', recentlyAdded: 'Recently added', favorites: 'Favorites', watchlist: 'My List', hd: 'HD', uhd: '4K', unavailable: 'Unavailable', played: 'Played', notStarted: 'Not started', finished: 'Finished'};
  return names[key] ?? sentence(key);
}
export function predicateLabel(p: Predicate, capabilities?: BrowseCapabilities): string {
  return appliedFilterLabel(p, id => fieldLabel(id, capabilities?.fields.find(f => f.id === id)?.labelKey), activeI18n().t);
}
