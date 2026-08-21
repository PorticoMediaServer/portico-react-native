import {useQuery} from '@tanstack/react-query';
import type {
  BrowseLibraryRequest,
  BrowseExpression,
  CollectionSummary,
  DVRRecording,
  Library,
  LibraryBrowseCapabilities,
  LibraryCategory,
  LibraryFacetValue,
  MediaCard,
  MediaItem as ClientMediaItem,
  PlaylistSummary,
  PorticoClient,
  ProductMessageId,
  SuggestionsResponse,
} from '@portico/client-core';
import {usePorticoAuth} from '@portico-react-native/infrastructure';
import type {MediaAction, MediaItem, MediaShape} from '../ui-compat/contract';
import {cursorPageState, mergeUniqueById} from './pagination';

export type ConnectedLibraryTab = LibraryBrowseCapabilities['pivots'][number];
export type LibraryFilterPredicate = {field: string; operator: string; value: null | string | number | boolean | (string | number | boolean)[]};

export interface ConnectedLibrary {
  id: string;
  name: string;
  description: string;
  kind: LibraryBrowseCapabilities['library']['kind'];
  count: number;
  tabs: ConnectedLibraryTab[];
  fields: LibraryBrowseCapabilities['fields'];
  sorts: LibraryBrowseCapabilities['sorts'];
}

export interface LibraryCatalog {
  libraries: ConnectedLibrary[];
  serverName: string;
}

export function useLibraryCatalog(selectedLibraryId?: string) {
  const auth = usePorticoAuth();
  const client = auth.session?.client;
  const serverId = auth.session?.serverId ?? auth.session?.serverName;
  return useQuery({
    enabled: Boolean(client),
    queryKey: ['library-catalog', serverId, selectedLibraryId ?? 'default'],
    queryFn: ({signal}) => loadLibraryCatalog(client!, auth.session!.serverName, signal, selectedLibraryId),
    staleTime: 60_000,
  });
}

export async function loadLibraryCatalog(client: PorticoClient, serverName: string, signal?: AbortSignal, selectedLibraryId?: string): Promise<LibraryCatalog> {
  const [page, contract] = await Promise.all([
    client.libraries({signal}),
    client.productContract({signal}),
  ]);
  const descriptions = new Map(contract.libraryKinds.map(kind => [kind.id, kind.description]));
  const selected = page.items.find(library => library.id === selectedLibraryId) ?? page.items[0];
  const capabilities = selected ? await client.libraryBrowseCapabilities(selected.id, {signal}) : undefined;
  return {
    libraries: page.items.map(library => library.id === selected?.id && capabilities
      ? connectedLibrary(library, capabilities, descriptions)
      : provisionalLibrary(library, descriptions)),
    serverName,
  };
}

function provisionalLibrary(library: Library, descriptions: Map<string, string>): ConnectedLibrary {
  const kind = library.type === 'movie' ? 'movies'
    : library.type === 'show' ? 'tv'
    : library.type === 'audiobook' ? 'audiobooks'
    : library.type === 'recorded-tv' ? 'recorded-tv'
    : library.type === 'anime' ? 'anime'
    : 'music';
  return {
    id: library.id,
    name: library.name,
    description: descriptions.get(kind) ?? '',
    kind,
    count: library.count,
    tabs: [],
    fields: [],
    sorts: [],
  };
}

function connectedLibrary(
  library: Library,
  capabilities: LibraryBrowseCapabilities,
  descriptions: Map<string, string>,
): ConnectedLibrary {
  return {
    id: library.id,
    name: library.name,
    description: descriptions.get(capabilities.library.kind) ?? '',
    kind: capabilities.library.kind,
    count: library.count,
    tabs: capabilities.pivots,
    fields: capabilities.fields,
    sorts: capabilities.sorts,
  };
}

export interface LibraryPage {
  items: MediaItem[];
  rows: LibraryDiscoveryRow[];
  facets: LibraryFacetGroup[];
  resources: LibraryResource[];
  schedule: LibraryScheduleEntry[];
  total: number;
  presentation: 'media' | 'shelves' | 'facets' | 'resources' | 'schedule';
  hasMore: boolean;
  nextCursor?: string;
}

export interface LibraryFacet {
  id: string;
  title: string;
  detail?: string;
  count: number;
  artwork?: string;
  query: BrowseExpression;
}

export interface LibraryFacetGroup {id: string; title: string; items: LibraryFacet[]}
export interface LibraryResource {id: string; title: string; summary?: string; itemCount: number; kind: 'collection' | 'playlist'}
export interface LibraryScheduleEntry {
  id: string;
  title: string;
  subtitle: string;
  status: DVRRecording['status'];
  statusMessageId: ProductMessageId;
}

export interface LibraryDiscoveryRow {
  id: string;
  title: string;
  items: MediaItem[];
  shape: MediaShape;
}

export async function loadLibraryPage(
  client: PorticoClient,
  library: ConnectedLibrary,
  tab: ConnectedLibraryTab,
  options: {filtered?: boolean; filters?: BrowseExpression[]; sortLabel: string; sortDirection?: 'asc' | 'desc'; seekPrefix?: string; facetQuery?: BrowseExpression; resourceId?: string; cursor?: string},
  signal?: AbortSignal,
): Promise<LibraryPage> {
  if (tab.id === 'discover') {
    const response = await client.libraryDiscover(library.id, {limit: 200}, {signal});
    const rows = (response.rows ?? [])
      .map(row => discoveryRow(row, client))
      .filter(row => row.items.length > 0);
    // Older compatible servers can omit rows but still return suggestions.
    // Keep that response honest by rendering one explicitly named shelf rather
    // than silently flattening away server row titles when rows are present.
    const fallbackItems = response.items.map(suggestion => detailCard(suggestion.item, client));
    const fallbackRows: LibraryDiscoveryRow[] = fallbackItems.length ? [{
      id: 'library-discover-suggestions',
      title: 'Suggestions',
      items: fallbackItems,
      shape: shapeForLibraryRow(tab.entityKinds[0]),
    }] : [];
    const visibleRows = rows.length ? rows : fallbackRows;
    return {
      items: visibleRows.flatMap(row => row.items),
      rows: visibleRows,
      facets: [], resources: [], schedule: [],
      total: visibleRows.reduce((total, row) => total + row.items.length, 0),
      presentation: 'shelves', hasMore: false,
    };
  }

  if (tab.id === 'categories' || tab.id === 'genres' || tab.id === 'authors' || tab.id === 'series') {
    if (options.facetQuery) return loadFacetResults(client, library, tab, options, signal);
    const rawFacetPage = tab.id === 'authors' || tab.id === 'series'
      ? (await (tab.id === 'authors' ? client.libraryAuthors(library.id, {cursor: options.cursor, limit: 100}, {signal}) : client.librarySeries(library.id, {cursor: options.cursor, limit: 100}, {signal})))
      : (await client.libraryCategories(library.id, {signal})).items
        .filter(category => tab.id !== 'genres' || category.group === 'genre')
        .map(categoryFacet);
    const rawFacets = Array.isArray(rawFacetPage) ? rawFacetPage : rawFacetPage.items.map(facetValue);
    const cursor = Array.isArray(rawFacetPage) ? {hasMore: false} : cursorPageState(rawFacetPage.pageInfo);
    return {
      items: [], rows: [], resources: [], schedule: [],
      facets: groupFacets(rawFacets), total: Array.isArray(rawFacetPage) ? rawFacets.length : rawFacetPage.pageInfo.total ?? rawFacets.length, presentation: 'facets', ...cursor,
    };
  }

  if (tab.id === 'collections' || tab.id === 'playlists') {
    const kind = tab.id === 'collections' ? 'collection' : 'playlist';
    if (options.resourceId) {
      if (kind === 'collection') {
        const response = await client.collectionItems(options.resourceId, {cursor: options.cursor, limit: 50}, {signal});
        return {items: response.items.map(item => browseCard(item, client)), rows: [], facets: [], resources: [], schedule: [], total: response.pageInfo.total ?? response.items.length, presentation: 'media', ...cursorPageState(response.pageInfo)};
      }
      const response = await client.playlistItems(options.resourceId, {cursor: options.cursor, limit: 50}, {signal});
      return {items: response.items.map(entry => browseCard(entry.media, client)), rows: [], facets: [], resources: [], schedule: [], total: response.pageInfo.total ?? response.items.length, presentation: 'media', ...cursorPageState(response.pageInfo)};
    }
    const response = kind === 'collection'
      ? await client.collections({cursor: options.cursor, libraryId: library.id, limit: 50}, {signal})
      : await client.playlists({cursor: options.cursor, libraryId: library.id, limit: 50}, {signal});
    return {
      items: [], rows: [], facets: [], schedule: [],
      resources: response.items.map(item => resourceSummary(item, kind)),
      total: response.pageInfo.total ?? response.items.length,
      presentation: 'resources', ...cursorPageState(response.pageInfo),
    };
  }

  if (tab.id === 'schedule') {
    const response = await client.dvrSchedule({cursor: options.cursor, limit: 50}, {signal});
    return {items: [], rows: [], facets: [], resources: [], schedule: response.items.map(scheduleEntry), total: response.pageInfo.total ?? response.items.length, presentation: 'schedule', ...cursorPageState(response.pageInfo)};
  }

  if (!tab.browseSupported) throw new Error(`${tab.label} is declared by the server but has no supported client endpoint.`);

  const selectedSort = library.sorts.find(sort => sort.label === options.sortLabel);
  const defaultSort = tab.defaultSort;
  const request: BrowseLibraryRequest = {
    pivot: tab.id,
    cursor: options.cursor,
    limit: 50,
    sort: selectedSort
      ? [{field: selectedSort.id, direction: selectedSort.directions.includes(options.sortDirection ?? selectedSort.defaultDirection) ? options.sortDirection ?? selectedSort.defaultDirection : selectedSort.defaultDirection}]
      : defaultSort,
    query: combineBrowseExpressions([...(options.filters ?? []), ...(options.filtered ? [{field: 'playState', operator: 'equals', value: 'unplayed'} as BrowseExpression] : [])]),
    seek: !options.cursor && options.seekPrefix ? {prefix: options.seekPrefix} : undefined,
  };
  const response = await client.browseLibrary(library.id, request, {signal});
  return {
    items: response.items.map(item => browseCard(item, client)),
    rows: [], facets: [], resources: [], schedule: [],
    total: response.pageInfo.total ?? response.items.length,
    presentation: 'media', ...cursorPageState(response.pageInfo),
  };
}

async function loadFacetResults(
  client: PorticoClient,
  library: ConnectedLibrary,
  tab: ConnectedLibraryTab,
  options: {filtered?: boolean; filters?: BrowseExpression[]; sortLabel: string; sortDirection?: 'asc' | 'desc'; facetQuery?: BrowseExpression; cursor?: string},
  signal?: AbortSignal,
): Promise<LibraryPage> {
  const contentPivot = library.tabs.find(candidate => candidate.browseSupported && candidate.id !== 'discover');
  if (!contentPivot || !options.facetQuery) throw new Error(`The server did not declare a browsable media pivot for ${tab.label}.`);
  const selectedSort = availableSorts(library, contentPivot).find(sort => sort.label === options.sortLabel);
  const response = await client.browseLibrary(library.id, {
    pivot: contentPivot.id,
    cursor: options.cursor,
    limit: 50,
    query: combineBrowseExpressions([options.facetQuery, ...(options.filters ?? []), ...(options.filtered ? [{field: 'playState', operator: 'equals', value: 'unplayed'} as BrowseExpression] : [])].filter((value): value is BrowseExpression => Boolean(value))),
    sort: selectedSort ? [{field: selectedSort.id, direction: selectedSort.directions.includes(options.sortDirection ?? selectedSort.defaultDirection) ? options.sortDirection ?? selectedSort.defaultDirection : selectedSort.defaultDirection}] : contentPivot.defaultSort,
  }, {signal});
  return {items: response.items.map(item => browseCard(item, client)), rows: [], facets: [], resources: [], schedule: [], total: response.pageInfo.total ?? response.items.length, presentation: 'media', ...cursorPageState(response.pageInfo)};
}

export function combineBrowseExpressions(expressions: BrowseExpression[] | undefined): BrowseExpression | undefined {
  if (!expressions?.length) return undefined;
  return expressions.length === 1 ? expressions[0] : {all: expressions};
}

export function supportsAlphabetSeek(library: ConnectedLibrary, tab: ConnectedLibraryTab, sortLabel: string, direction: 'asc' | 'desc'): boolean {
  if (!tab.browseSupported || direction !== 'asc') return false;
  const selected = availableSorts(library, tab).find(sort => sort.label === sortLabel);
  const field = selected?.id ?? tab.defaultSort[0]?.field;
  return field === 'title' || field === 'sortTitle';
}

export function mergeLibraryPages(pages: LibraryPage[]): LibraryPage | undefined {
  const first = pages[0];
  const last = pages.at(-1);
  if (!first || !last) return undefined;
  const facetGroups = new Map<string, LibraryFacetGroup>();
  for (const page of pages) for (const group of page.facets) {
    const existing = facetGroups.get(group.id);
    facetGroups.set(group.id, {...group, items: mergeUniqueById(existing?.items ?? [], group.items)});
  }
  return {
    ...first,
    items: mergeUniqueById(...pages.map(page => page.items)),
    rows: first.rows,
    facets: [...facetGroups.values()],
    resources: mergeUniqueById(...pages.map(page => page.resources)),
    schedule: mergeUniqueById(...pages.map(page => page.schedule)),
    total: Math.max(...pages.map(page => page.total)),
    hasMore: last.hasMore,
    nextCursor: last.nextCursor,
  };
}

function categoryFacet(category: LibraryCategory): LibraryFacet {
  return {id: category.id, title: category.name, detail: category.description, count: category.count, artwork: category.image, query: facetPredicate(category.filter, category.group)};
}

function facetValue(value: LibraryFacetValue): LibraryFacet {
  return {id: value.id, title: value.name, count: value.count, artwork: value.image, query: facetPredicate(value.filter, value.entityKind === 'audiobook-series' ? 'series' : 'author')};
}

export function facetPredicate(filter: string, fallbackField: string): BrowseExpression {
  const separator = filter.indexOf(':');
  const prefix = separator > 0 ? filter.slice(0, separator) : fallbackField;
  const rawValue = separator > 0 ? filter.slice(separator + 1) : filter;
  const field = ({rating: 'contentRating', label: 'tag'} as Record<string, string>)[prefix] ?? prefix;
  const numeric = field === 'year' || field === 'decade';
  return {field, operator: field === 'genre' || field === 'tag' ? 'contains' : 'equals', value: numeric && Number.isFinite(Number(rawValue)) ? Number(rawValue) : rawValue};
}

function groupFacets(facets: LibraryFacet[]): LibraryFacetGroup[] {
  const groups = new Map<string, LibraryFacet[]>();
  for (const facet of facets) {
    const field = 'field' in facet.query ? facet.query.field : 'category';
    groups.set(field, [...(groups.get(field) ?? []), facet]);
  }
  return [...groups].map(([id, items]) => ({id, title: facetGroupLabel(id), items}));
}

function facetGroupLabel(id: string) {
  return ({genre: 'Genres', style: 'Styles', year: 'Years', decade: 'Decades', contentRating: 'Ratings', studio: 'Studios', artist: 'Artists', albumArtist: 'Album Artists', tag: 'Tags', author: 'Authors', narrator: 'Narrators', series: 'Series', show: 'Shows', season: 'Seasons', network: 'Networks', country: 'Countries'} as Record<string, string>)[id] ?? `${id.charAt(0).toUpperCase()}${id.slice(1)}`;
}

function resourceSummary(item: CollectionSummary | PlaylistSummary, kind: LibraryResource['kind']): LibraryResource {
  return {id: item.id, title: item.title, summary: item.summary, itemCount: item.itemCount, kind};
}

function scheduleEntry(recording: DVRRecording): LibraryScheduleEntry {
  const starts = new Date(recording.startsAt);
  const ends = new Date(recording.endsAt);
  const time = Number.isFinite(starts.getTime()) ? starts.toLocaleString() : 'Time unavailable';
  const minutes = Number.isFinite(starts.getTime()) && Number.isFinite(ends.getTime()) ? Math.max(0, Math.round((ends.getTime() - starts.getTime()) / 60_000)) : 0;
  return {
    id: recording.id,
    title: recording.title,
    subtitle: `${time}${minutes ? ` · ${minutes}m` : ''}`,
    status: recording.status,
    statusMessageId: recordingStatusMessageId(recording.status),
  };
}

function recordingStatusMessageId(
  status: DVRRecording['status'],
): ProductMessageId {
  const messageIds: Record<DVRRecording['status'], ProductMessageId> = {
    scheduled: 'media.kind.recording',
    running: 'library.quick-in-progress',
    complete: 'media.version-ready',
    incomplete: 'dvr.recording-failed',
    failed: 'dvr.recording-failed',
  };
  return messageIds[status];
}

function discoveryRow(
  row: NonNullable<SuggestionsResponse['rows']>[number],
  client: PorticoClient,
): LibraryDiscoveryRow {
  return {
    id: row.id,
    title: row.title,
    items: row.items.map(item => detailCard(item, client)),
    shape: shapeForLibraryRow(row.type),
  };
}

function shapeForLibraryRow(hint: string | undefined): MediaShape {
  const normalized = hint?.toLowerCase();
  if (normalized === 'square' || normalized === 'album' || normalized === 'artist') return 'square';
  if (normalized === 'landscape') return 'landscape';
  return 'poster';
}

export function availableSorts(library: ConnectedLibrary, tab: ConnectedLibraryTab) {
  const kinds = new Set(tab.entityKinds);
  return library.sorts.filter(sort => !sort.applicableKinds?.length || sort.applicableKinds.some(kind => kinds.has(kind)));
}

export function supportsUnwatchedFilter(library: ConnectedLibrary, tab: ConnectedLibraryTab) {
  return tab.browseSupported && library.fields.some(field =>
    field.id === 'playState'
    && field.operators.includes('equals')
    && (field.allowedValues?.includes('unplayed') ?? false),
  );
}

function browseCard(item: MediaCard, client: PorticoClient): MediaItem {
  const fields = item.fields ?? {};
  const progress = progressPercent(item.userState.progressSeconds, item.durationSeconds, item.userState.watched);
  return {
    id: item.id,
    kind: mediaKind(item.entityKind),
    title: item.title,
    subtitle: item.subtitle,
    summary: stringField(fields, 'summary'),
    year: item.year,
    contentRating: stringField(fields, 'contentRating'),
    duration: durationLabel(item.durationSeconds),
    genre: stringField(fields, 'genre'),
    poster: imageURL(item.artwork.poster, client, 780),
    backdrop: imageURL(item.artwork.backdrop || item.artwork.thumb, client, 1920),
    shape: shapeFor(item.entityKind),
    progress,
    actions: consumerActions(item.actions),
  };
}

function detailCard(item: ClientMediaItem, client: PorticoClient): MediaItem {
  return {
    id: item.id,
    kind: mediaKind(item.type),
    title: item.title,
    subtitle: item.tagline ?? item.parentTitle,
    summary: item.summary,
    year: item.year,
    contentRating: item.contentRating,
    duration: durationLabel(item.durationSeconds),
    genre: item.genres[0],
    poster: imageURL(item.images.poster, client, 780),
    backdrop: imageURL(item.displayImages?.backdrop || item.images.backdrop || item.images.thumb, client, 1920),
    shape: shapeFor(item.type),
    progress: progressPercent(item.state.progressSeconds, item.durationSeconds, item.state.watched),
    parentId: item.parentId,
    parentTitle: item.parentTitle,
    childIds: item.children?.map(child => child.id),
    actions: consumerActions(item.actions),
  };
}

function imageURL(path: string | undefined, client: PorticoClient, width: number) {
  return path ? client.imageResourceUrl(path, {width}) : '';
}

function stringField(fields: Record<string, unknown>, key: string) {
  const value = fields[key];
  if (typeof value === 'string') return value;
  if (Array.isArray(value)) return value.filter((entry): entry is string => typeof entry === 'string').join(', ');
  return undefined;
}

function durationLabel(seconds?: number) {
  if (!seconds) return undefined;
  const minutes = Math.round(seconds / 60);
  const hours = Math.floor(minutes / 60);
  const remainder = minutes % 60;
  return hours ? `${hours}h${remainder ? ` ${remainder}m` : ''}` : `${minutes}m`;
}

function progressPercent(progressSeconds: number, durationSeconds: number | undefined, watched: boolean) {
  if (watched || !durationSeconds || progressSeconds <= 0) return undefined;
  return Math.min(100, Math.max(0, progressSeconds / durationSeconds * 100));
}

function consumerActions(actions: readonly string[]): MediaAction[] {
  const supported = new Set<MediaAction>(['play', 'watchlist.add', 'watchlist.remove', 'favorite.add', 'favorite.remove', 'watched.set', 'queue.add']);
  return actions.filter((action): action is MediaAction => supported.has(action as MediaAction));
}

function shapeFor(kind: string): MediaItem['shape'] {
  return ['artist', 'album', 'track', 'author', 'book'].includes(kind) ? 'square'
    : ['episode', 'recording', 'live-channel', 'live-program'].includes(kind) ? 'landscape'
      : 'poster';
}

function mediaKind(kind: string): MediaItem['kind'] {
  if (kind === 'series' || kind === 'audiobook-series') return 'collection';
  if (kind === 'audiobook') return 'book';
  const supported = new Set<MediaItem['kind']>(['movie', 'show', 'season', 'episode', 'person', 'collection', 'artist', 'album', 'track', 'author', 'book', 'chapter', 'recording', 'live-channel', 'live-program']);
  return supported.has(kind as MediaItem['kind']) ? kind as MediaItem['kind'] : 'collection';
}
