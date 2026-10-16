import React, {useCallback, useEffect, useMemo, useRef, useState} from 'react';
import {useFreshDocument} from '../app/freshness';
import {titlesWithPersonalState} from '../../../../packages/client-core/src/freshness-hub';
import {NativeModules, View, type LayoutChangeEvent} from 'react-native';
import {useSafeAreaInsets} from 'react-native-safe-area-context';
import {useNavigation, type RouteProp} from '@react-navigation/native';
import type {NativeStackNavigationProp} from '@react-navigation/native-stack';
import type {ContentEntry} from '../../../../packages/client-core/src/library-content';
import {PersonalSavedService, type PersonalResourceEntry, type PersonalSavedSnapshot} from '../../../../packages/client-core/src/personal-saved';
import {SavedService, type PlaylistCard, type PlaylistOccurrence, type SavedEntry, type SavedRoute, type SavedSnapshot} from '../../../../packages/client-core/src/saved';
import {captionFor, iconFor, progressFor, shapeFor, useArtwork, viewerScope} from '../app/content';
import {useOpenEntry} from '../app/open';
import type {ContentStackParams} from '../app/routes';
import {useSession} from '../app/session';
import {Button, CardRow, ConfirmSheet, Card, Divider, ListRow, Notice, PageHeader, PageList, Ring, Skeleton, StateView, Tabs, Text, WindowedGrid, alpha, gridColumns, useTheme, type GridWindow, type IconName} from '../ui';
import {historyRows, type CardRowModel, type DayRowModel} from '../app/list-rows';
import {say} from '../app/errors';
import {useQuietRefresh} from '../app/quiet-refresh';
import {RootHeaderActions} from './Home';
import {useI18n} from '../app/i18n';
import {usePullToRefresh} from '../app/refresh';
import {useAppendedPages, useEndReached} from '../app/paging';
import type {I18n, MessageId} from '../app/i18n';
import {RowGuide} from './title/RowGuide';
import {useGroupBrowse, useGroupWindow} from '../app/group-browse';
import {acrossScope} from '../app/group-scope';
import {GroupBar} from './GroupBrowse';
import type {AcrossGroup} from '../../../../packages/client-core/src/presentation/browse-groups';

const listDependencies = Object.freeze([...titlesWithPersonalState()]);

type SavedTab = 'watchlist' | 'favorites' | 'playlists' | 'collections' | 'views' | 'history';
type PersonalTab = 'collections' | 'views' | 'history';
const isPersonal = (tab: SavedTab): tab is PersonalTab => tab === 'collections' || tab === 'views' || tab === 'history';

const tabIds: readonly {id: SavedTab; label: MessageId}[] = [
  {id: 'watchlist', label: 'saved.tab.watchlist'},
  {id: 'favorites', label: 'saved.tab.favorites'},
  {id: 'playlists', label: 'saved.tab.playlists'},
  {id: 'collections', label: 'saved.tab.collections'},
  {id: 'views', label: 'saved.tab.savedViews'},
  {id: 'history', label: 'saved.tab.history'},
];

const emptyCopy: Record<Exclude<SavedTab, 'collections' | 'views'>, {icon: IconName; title: MessageId; message: MessageId}> = {
  watchlist: {icon: 'bookmark', title: 'web.saved.empty.watchlist', message: 'web.saved.empty.watchlistBody'},
  favorites: {icon: 'heart', title: 'web.saved.empty.favorites', message: 'web.saved.empty.favoritesBody'},
  playlists: {icon: 'queue', title: 'web.saved.empty.playlists', message: 'web.saved.empty.playlistsBody'},
  history: {icon: 'clock', title: 'web.saved.empty.history', message: 'web.saved.empty.historyBody'},
};

const requestId = () => Promise.resolve(NativeModules.PorticoRuntime.newRequestId()).then((v: string) => v.toLowerCase());

const isPlaylistCard = (entry: SavedEntry): entry is PlaylistCard => entry.kind === 'playlist';
const isOccurrence = (entry: SavedEntry): entry is PlaylistOccurrence => entry.kind === 'playlist_entry';
const isMedia = (entry: SavedEntry): entry is ContentEntry => !isPlaylistCard(entry) && !isOccurrence(entry);

/** Binds a SavedService (watchlist, favorites, playlists, one playlist) to React. */
function useSavedService(route: SavedRoute | null) {
  const {api, session} = useSession();
  const scope = useMemo(() => viewerScope(session, api), [session, api]);
  const service = useMemo(() => new SavedService({api, scope, requestId}), [api, scope]);
  // The list on screen follows this profile's saved titles and watched state, and the libraries behind them, in place.
  useFreshDocument(listDependencies, context => service.revalidate(context), () => service.getSnapshot().phase === 'ready');
  const [snapshot, setSnapshot] = useState<SavedSnapshot>(service.getSnapshot());
  useEffect(() => {
    setSnapshot(service.getSnapshot());
    const unsubscribe = service.subscribe(() => setSnapshot(service.getSnapshot()));
    return () => {
      unsubscribe();
      service.dispose();
    };
  }, [service]);
  const key = route ? JSON.stringify(route) : '';
  // A replaced service (a renewed sign-in) starts idle, so the same route is selected on it again.
  const last = useRef<{key: string; service: unknown}>({key: '', service: null});
  useEffect(() => {
    if (!route) {
      last.current = {key: '', service: null};
      return;
    }
    if (last.current.key === key && last.current.service === service) return;
    last.current = {key, service};
    // select() validates the route synchronously; a refusal must not escape the effect.
    Promise.resolve().then(() => service.select(route)).catch(() => {});
  }, [service, key, route]);
  const refresh = useCallback(() => void service.refresh().catch(() => {}), [service]);
  const retry = useCallback(() => void service.retry().catch(() => {}), [service]);
  const next = useCallback((sectionId: string) => void service.next(sectionId).catch(() => {}), [service]);
  return {snapshot, refresh, retry, next};
}

/** Binds the PersonalSavedService: history, and the viewer's collections and saved views. */
function usePersonalService(route: SavedRoute | null) {
  const {api, session} = useSession();
  const scope = useMemo(() => viewerScope(session, api), [session, api]);
  const service = useMemo(() => new PersonalSavedService(api, scope, requestId), [api, scope]);
  useFreshDocument(listDependencies, context => service.revalidate(context), () => !!service.getSnapshot().viewerFence);
  const [snapshot, setSnapshot] = useState<PersonalSavedSnapshot>(service.getSnapshot());
  useEffect(() => {
    setSnapshot(service.getSnapshot());
    const unsubscribe = service.subscribe(() => setSnapshot(service.getSnapshot()));
    return () => {
      unsubscribe();
      service.dispose();
    };
  }, [service]);
  const key = route ? JSON.stringify(route) : '';
  const last = useRef<{key: string; service: unknown}>({key: '', service: null});
  useEffect(() => {
    if (!route || (last.current.key === key && last.current.service === service)) return;
    last.current = {key, service};
    Promise.resolve().then(() => service.select(route)).catch(() => {});
  }, [service, key, route]);
  const refresh = useCallback(() => void service.refresh().catch(() => {}), [service]);
  const next = useCallback(() => void service.next().catch(() => {}), [service]);
  const clearHistory = useCallback(() => service.mutate({action: 'clear-history'}), [service]);
  return {snapshot, refresh, next, clearHistory};
}

/** Measures the screen so grids fit beside the rail rather than the whole window. */
function useContentWidth() {
  const {window, metrics, space} = useTheme();
  const [width, setWidth] = useState(0);
  const onLayout = useCallback((e: LayoutChangeEvent) => setWidth(e.nativeEvent.layout.width), []);
  return {onLayout, gridWidth: (width || window.width - metrics.railWidth) - space.page * 2};
}

const knownSorts = ['title', 'added', 'year', 'duration', 'last_played', 'rating', 'episode', 'track', 'artist', 'album', 'author', 'release', 'random'];
const sortLabel = (i18n: I18n, labelKey: string) => {
  const id = labelKey.replace(/^sort\./, '');
  if (knownSorts.includes(id)) return i18n.t('lib.sortField', {field: id});
  const raw = id.replace(/_/g, ' ');
  return raw.charAt(0).toUpperCase() + raw.slice(1);
};

/**
 * Saved: watchlist, favorites, playlists and history for the signed-in
 * profile. The server authors each projection; the screen only picks the tab,
 * a sort where offered, and pages.
 */
export function SavedScreen({route}: {route: RouteProp<ContentStackParams, 'Saved'>}) {
  const initial = route.params?.view;
  const navigation = useNavigation<NativeStackNavigationProp<ContentStackParams>>();
  const {space, isTV} = useTheme();
  const insets = useSafeAreaInsets();
  const i18n = useI18n();
  const tabs = useMemo(() => tabIds.map(t => ({id: t.id, label: i18n.t(t.label)})), [i18n]);
  const {onLayout, gridWidth} = useContentWidth();
  const [tab, setTab] = useState<SavedTab>(initial ?? 'watchlist');
  const [sort, setSort] = useState<Partial<Record<SavedTab, {sort: string; direction: 'asc' | 'desc'}>>>({});
  useEffect(() => {
    if (initial) setTab(initial);
  }, [initial]);

  // The library's whole Sort and Filter on My List, Favorites and History, across every library as
  // one list. Each list shows its own order (the history by day) until a sort or filter is chosen.
  const across: AcrossGroup | undefined = tab === 'watchlist' ? 'watchlist' : tab === 'favorites' ? 'favorites' : tab === 'history' ? 'history' : undefined;
  const groupScope = useMemo(() => (across ? acrossScope(across) : undefined), [across]);
  const group = useGroupBrowse(groupScope);
  const sortedWindow = useGroupWindow(group);
  const sortedOn = group.engaged && !!sortedWindow.list;
  const savedRoute: SavedRoute | null = useMemo(() => (isPersonal(tab) ? null : {view: tab, ...(across ? {} : sort[tab] ?? {})}), [tab, sort, across]);
  const saved = useSavedService(savedRoute);
  const personalRoute = useMemo<SavedRoute | null>(() => (isPersonal(tab) ? {view: tab} : null), [tab]);
  const history = usePersonalService(personalRoute);

  const projection = saved.snapshot.projection;
  // APL-SAVED-01: no sort chips over an empty list.
  const hasEntries = !!projection?.sections.some(section => section.entries.length);
  // Playlists keep the one sort the server gives the list of them; the other lists have the library's.
  const sorts = !isPersonal(tab) && tab !== 'playlists' && !across && hasEntries ? projection?.sorts ?? [] : [];
  const activeSort = sort[tab]?.sort ?? projection?.query.sort ?? sorts[0]?.id;
  const activeDirection = sort[tab]?.direction ?? (projection?.query.direction as 'asc' | 'desc' | undefined);

  const refresh = isPersonal(tab) ? history.refresh : saved.refresh;
  // The server says the list changed under the screen: it is read again quietly, and only a list still refused says so.
  const savedStuck = useQuietRefresh(!isPersonal(tab) && saved.snapshot.phase === 'refresh-required', saved.refresh);
  // APL-SYS-07: pull to refresh (touch) and a quiet refresh after a long absence.
  const pull = usePullToRefresh(refresh, {busy: isPersonal(tab) ? history.snapshot.loading : saved.snapshot.phase === 'loading'});
  // APL-SYS-08: the next page loads as the list nears its end; earlier pages stay.
  const pageable = saved.snapshot.projection?.sections.find(s => s.nextCursor);
  const loadMore = () => {
    if (isPersonal(tab)) {
      if (!history.snapshot.loading && !history.snapshot.error && history.snapshot.nextCursor) history.next();
    } else if (pageable && saved.snapshot.phase === 'ready') saved.next(pageable.id);
  };
  const onScroll = useEndReached(loadMore);

  // A watchlist or favorites list can hold thousands of titles: it scrolls in the windowed grid,
  // which mounts only the cells on screen (O(visible)) and asks for the next page near its end.
  const mediaTab = !isPersonal(tab) && tab !== 'playlists';
  const savedSections = useMemo(() => saved.snapshot.projection?.sections ?? [], [saved.snapshot.projection]);
  const savedPage = useMemo(() => savedSections.flatMap(s => s.entries), [savedSections]);
  const savedEntries = useAppendedPages(JSON.stringify(saved.snapshot.route), saved.snapshot.pagination.cursor, savedPage, entryKey);
  const media = useMemo(() => savedEntries.filter(isMedia), [savedEntries]);
  const renderMedia = useMediaCard();
  const {metrics} = useTheme();
  const grid = useMemo<GridWindow<ContentEntry>>(() => ({
    ensureRange: (_first, last) => { if (pageable && saved.snapshot.phase === 'ready' && last >= media.length - 20) saved.next(pageable.id); },
    slotAt: index => media[index] ? {kind: 'item', key: media[index]!.id, item: media[index]!} : {kind: 'placeholder', key: `pending:${index}`},
    pageOf: index => Math.floor(index / 60),
    // The screen re-renders on every snapshot and hands the grid a new window, so rows follow it.
    subscribePage: () => () => {},
    getPageVersion: () => `${media.length}:${saved.snapshot.phase}`,
  }), [media, pageable, saved]);
  // Every other tab is one list that is itself the page's scroller, so only the rows near the
  // viewport are mounted however many pages have been read: History (a heading per day over rows
  // of cards), and the names under Playlists, Collections and Saved views.
  const personalKey = JSON.stringify(history.snapshot.route);
  const historyPage = useMemo(() => history.snapshot.entries.filter(hasMedia), [history.snapshot.entries]);
  const historyEntries = useAppendedPages(personalKey, history.snapshot.cursor, historyPage, entryKey);
  const resources = useAppendedPages(personalKey, history.snapshot.cursor, history.snapshot.resources, entryKey);
  const cardWidth = useCallback((kinds: readonly ContentEntry['kind'][]) => {
    const shape = dominantShape(kinds);
    return shape === 'landscape' ? metrics.landscapeWidth : shape === 'square' ? metrics.squareWidth : metrics.posterWidth;
  }, [metrics]);
  const {rows, historyShown} = useMemo<{rows: SavedRow[]; historyShown: number}>(() => {
    if (tab === 'history') {
      const columns = new Map<string, number>();
      const built = historyRows(historyEntries, iso => (iso ? dayLabel(iso, i18n) : i18n.t('saved.earlier')), day => {
        const count = gridColumns(gridWidth, cardWidth(day.map(e => e.media.kind)), space.gutter).columns;
        for (const entry of day) columns.set(entry.id, count);
        return count;
      });
      return {rows: built.rows.map(row => (row.kind === 'cards' ? {...row, columns: columns.get(row.items[0]!.id) ?? 1} : row)), historyShown: built.shown};
    }
    if (tab === 'collections' || tab === 'views') return {rows: resources.map((resource, index) => ({kind: 'resource' as const, key: resource.id, resource, first: index === 0, last: index === resources.length - 1})), historyShown: 0};
    if (tab === 'playlists') return {rows: savedEntries.filter(isPlaylistCard).map((card, index) => ({kind: 'playlist' as const, key: card.id, card, first: index === 0})), historyShown: 0};
    return {rows: [], historyShown: 0};
  }, [tab, historyEntries, resources, savedEntries, i18n, gridWidth, cardWidth, space.gutter]);
  const renderHistory = useHistoryCard();
  const renderRow = useCallback(({item: row}: {item: SavedRow}) => {
    switch (row.kind) {
      case 'day': return <Text variant="heading" style={{marginHorizontal: space.page, marginBottom: space.sm, marginTop: space.sm}}>{row.label}</Text>;
      case 'cards': return <CardRow items={row.items} first={row.first} columnWidth={Math.max(1, Math.floor((gridWidth - space.gutter * (row.columns - 1)) / row.columns))} keyOf={entryKey} renderItem={renderHistory} />;
      case 'playlist': return <PlaylistRow card={row.card} first={row.first} onOpen={() => navigation.push('Playlist', {playlistId: row.card.navigation.entityId, title: row.card.title})} />;
      case 'resource': return <ResourceRow resource={row.resource} first={row.first} last={row.last} onOpen={() => navigation.push('SavedResource', {resourceId: row.resource.id, title: row.resource.name})} />;
    }
  }, [space, gridWidth, renderHistory, navigation]);
  const header = <PageHeader title={i18n.t('saved.title')} actions={<RootHeaderActions />} />;
  const tabRow = (
    <View>
      {/* TV: the guide hands focus to a tab (never to itself), so arriving from the rail always shows focus. */}
      <RowGuide><Tabs items={tabs} selected={tab} onSelect={id => setTab(id as SavedTab)} /></RowGuide>
    </View>
  );
  const sortRow = groupScope && (hasEntries || tab === 'history' && historyEntries.length > 0 || group.engaged) ? <GroupBar group={group} /> : sorts.length ? (
    <View style={{flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', gap: space.sm, paddingHorizontal: space.page, paddingVertical: space.md}}>
      <Text variant="label" tone="tertiary" style={{marginRight: space.xs}}>{i18n.t('saved.sort')}</Text>
      {sorts.map(s => {
        const active = activeSort === s.id;
        const direction = active ? activeDirection : undefined;
        return (
          <Button key={s.id} size="sm" variant="secondary" selected={active} label={sortLabel(i18n, s.labelKey)}
            trailingIcon={active ? (direction === 'desc' ? 'chevronDown' : 'chevronUp') : undefined}
            onPress={() => setSort(prev => ({...prev, [tab]: {sort: s.id, direction: active && direction === 'asc' ? 'desc' : 'asc'}}))} />
        );
      })}
    </View>
  ) : <View style={{height: isTV ? space.xl : space.lg}} />;
  if (sortedOn && sortedWindow.list) {
    const empty = sortedWindow.snapshot.total === 0 && sortedWindow.snapshot.status === 'ready';
    return (
      <View style={{flex: 1}} onLayout={onLayout}>
        {isTV ? null : <View style={{paddingTop: insets.top}}>{header}{tabRow}</View>}
        <WindowedGrid<ContentEntry> topInset={false} list={sortedWindow.list as unknown as GridWindow<ContentEntry>} total={sortedWindow.snapshot.total} itemWidth={metrics.posterWidth} aspect={1.5}
          renderItem={renderMedia} refreshControl={pull} header={<>{isTV ? header : null}{isTV ? tabRow : null}{sortRow}</>}
          footer={empty ? <StateView icon="filter" title={i18n.t('library.noMatch')} message={i18n.t('library.noMatchBody')} action={i18n.t('library.clearFilters')} onAction={group.reset} />
            : sortedWindow.snapshot.status === 'error' && !sortedWindow.snapshot.total ? <StateView icon="error" title={i18n.t('lib.viewLoadFailed')} message={say(sortedWindow.snapshot.error, 'library', 'load')} action={i18n.t('action.tryAgain')} onAction={() => sortedWindow.list?.retry()} /> : null} />
      </View>
    );
  }
  if (mediaTab && media.length) {
    const shapes = new Set(media.slice(0, 60).map(e => shapeFor(e.kind)));
    const dominant = shapes.size === 1 ? shapeFor(media[0]!.kind) : 'poster';
    const itemWidth = dominant === 'landscape' ? metrics.landscapeWidth : dominant === 'square' ? metrics.squareWidth : metrics.posterWidth;
    const notice = saved.snapshot.phase === 'error' ? <Notice tone="error" message={say(saved.snapshot.error, 'saved', 'load')} action={i18n.t('saved.retry')} onAction={saved.retry} style={{marginHorizontal: space.page, marginBottom: space.lg}} />
      : savedStuck ? <Notice tone="warning" message={say(saved.snapshot.error ?? 'stale', 'saved', 'load')} action={i18n.t('action.refresh')} onAction={saved.refresh} style={{marginHorizontal: space.page, marginBottom: space.lg}} /> : null;
    return (
      <View style={{flex: 1}} onLayout={onLayout}>
        {/* Touch: the title and tabs stay put above the grid, clear of the status bar. */}
        {isTV ? null : <View style={{paddingTop: insets.top}}>{header}{tabRow}</View>}
        <WindowedGrid topInset={false} list={grid} total={media.length + (pageable ? 60 : 0)} itemWidth={itemWidth} aspect={dominant === 'landscape' ? 9 / 16 : dominant === 'square' ? 1 : 1.5}
          renderItem={renderMedia} refreshControl={pull} header={<>{isTV ? header : null}{isTV ? tabRow : null}{sortRow}{notice}</>} />
      </View>
    );
  }


  return (
    <View style={{flex: 1}} onLayout={onLayout}>
      {/* Touch: the title and tabs stay put above the list, clear of the status bar (as on the grid tabs). */}
      {isTV ? null : <View style={{paddingTop: insets.top}}>{header}{tabRow}</View>}
      <PageList
        data={rows}
        keyExtractor={rowKey}
        renderItem={renderRow}
        refreshControl={pull}
        onScroll={onScroll}
        scrollEventThrottle={100}
        // A first page shorter than the screen never scrolls, so the list's own end is a second cue.
        onEndReached={loadMore}
        onEndReachedThreshold={1.5}
        contentStyle={isTV ? undefined : {paddingTop: 0}}
        ListHeaderComponent={
          <>
            {isTV ? header : null}
            {isTV ? tabRow : null}
            {sortRow}
            {tab === 'collections' || tab === 'views' ? (
              <ResourcesStatus tab={tab} snapshot={history.snapshot} count={resources.length} onRefresh={history.refresh} />
            ) : tab === 'history' ? (
              <HistoryStatus snapshot={history.snapshot} count={historyEntries.length} shown={historyShown} width={gridWidth} onRefresh={history.refresh} onClear={history.clearHistory} />
            ) : (
              <SavedStatus tab={tab} snapshot={saved.snapshot} count={savedEntries.length} width={gridWidth} changedStuck={savedStuck} onRetry={saved.retry} onRefresh={saved.refresh} />
            )}
          </>
        }
        ListFooterComponent={<MoreSpinner busy={isPersonal(tab) ? history.snapshot.loading && (historyEntries.length > 0 || resources.length > 0) : !!pageable && saved.snapshot.phase === 'loading' && savedEntries.length > 0} />}
      />
    </View>
  );
}

/**
 * One row of the list under a tab. History is headings and rows of cards; playlists, collections
 * and saved views are one name per row.
 */
type SavedRow =
  | DayRowModel
  | (CardRowModel<HistoryEntry> & {columns: number})
  | {kind: 'playlist'; key: string; card: PlaylistCard; first: boolean}
  | {kind: 'resource'; key: string; resource: PersonalSavedSnapshot['resources'][number]; first: boolean; last: boolean};
type HistoryEntry = PersonalResourceEntry & {media: ContentEntry};
const rowKey = (row: SavedRow) => row.key;
const hasMedia = (entry: PersonalResourceEntry): entry is HistoryEntry => !entry.hidden && !!entry.media;

/** The width a card of this shape asks for; a mixed set reads as posters. */
function dominantShape(kinds: readonly ContentEntry['kind'][]): 'poster' | 'landscape' | 'square' {
  const shapes = new Set(kinds.map(kind => shapeFor(kind)));
  const only = shapes.size === 1 ? shapeFor(kinds[0]!) : 'poster';
  return only === 'landscape' || only === 'square' ? only : 'poster';
}

/** Errors, the first load and the empty state for Watchlist, Favorites and Playlists. */
function SavedStatus({tab, snapshot, count, width, changedStuck, onRetry, onRefresh}: {tab: Exclude<SavedTab, PersonalTab>; snapshot: SavedSnapshot; count: number; width: number; /** The list changed under the screen and quiet re-reads have not brought it back. */ changedStuck: boolean; onRetry: () => void; onRefresh: () => void}) {
  const {space} = useTheme();
  const i18n = useI18n();
  const loaded = !!snapshot.projection?.sections.length;
  const loadingFresh = snapshot.phase === 'loading' && !loaded;
  const empty = snapshot.phase === 'ready' && !count;
  return (
    <View>
      {snapshot.phase === 'error' && !loaded ? (
        <StateView icon="warning" title={i18n.t('saved.loadFailed')} message={say(snapshot.error, 'saved', 'load')} action={i18n.t('action.tryAgain')} onAction={onRetry} />
      ) : snapshot.phase === 'error' ? (
        <Notice tone="error" message={say(snapshot.error, 'saved', 'load')} action={i18n.t('saved.retry')} onAction={onRetry} style={{marginHorizontal: space.page, marginBottom: space.lg}} />
      ) : changedStuck ? (
        <Notice tone="warning" message={say(snapshot.error ?? 'stale', 'saved', 'load')} action={i18n.t('action.refresh')} onAction={onRefresh} style={{marginHorizontal: space.page, marginBottom: space.lg}} />
      ) : null}
      {loadingFresh ? tab === 'playlists' ? <LoadingRows /> : <LoadingGrid width={width} /> : null}
      {empty ? <StateView icon={emptyCopy[tab].icon} title={snapshot.projection?.empty?.fallback ?? i18n.t(emptyCopy[tab].title)} message={i18n.t(emptyCopy[tab].message)} /> : null}
    </View>
  );
}

/** Errors, the first load, the empty state and Clear history, above the days. */
function HistoryStatus({snapshot, count, shown, width, onRefresh, onClear}: {snapshot: PersonalSavedSnapshot; count: number; shown: number; width: number; onRefresh: () => void; onClear: () => Promise<unknown>}) {
  const {space} = useTheme();
  const i18n = useI18n();
  const [clearing, setClearing] = useState(false);
  const loadingFresh = snapshot.loading && !count;
  const empty = !snapshot.loading && !snapshot.error && !count && snapshot.route !== null;
  return (
    <View>
      {snapshot.error && !count ? (
        <StateView icon="warning" title={i18n.t('saved.historyLoadFailed')} message={say(snapshot.error, 'saved', 'load')} action={i18n.t('action.tryAgain')} onAction={onRefresh} />
      ) : snapshot.error ? (
        <Notice tone={snapshot.error.conflict ? 'warning' : 'error'} message={say(snapshot.error, 'saved', 'load')} action={i18n.t('action.refresh')} onAction={onRefresh} style={{marginHorizontal: space.page, marginBottom: space.lg}} />
      ) : null}
      {loadingFresh ? <LoadingGrid width={width} /> : null}
      {empty ? <StateView icon={emptyCopy.history.icon} title={i18n.t(emptyCopy.history.title)} message={i18n.t(emptyCopy.history.message)} /> : null}
      {shown ? <View style={{paddingHorizontal: space.page, alignItems: 'flex-end'}}><Button variant="ghost" size="sm" icon="trash" label={i18n.t('web.saved.clearHistory')} onPress={() => setClearing(true)} /></View> : null}
      <ConfirmSheet open={clearing} onDismiss={() => setClearing(false)} title={i18n.t('web.saved.clearHistoryTitle')} consequence={i18n.t('web.saved.clearHistoryBody')} confirmLabel={i18n.t('web.saved.clearHistoryAction')} onConfirm={onClear} />
    </View>
  );
}

function dayLabel(iso: string, i18n: ReturnType<typeof useI18n>): string {
  const then = new Date(iso);
  if (Number.isNaN(then.getTime())) return i18n.t('saved.earlier');
  const start = (d: Date) => new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
  const days = Math.round((start(new Date()) - start(then)) / 86400000);
  if (days <= 0) return i18n.t('saved.today');
  if (days === 1) return i18n.t('relative.yesterday');
  if (days < 7) return i18n.date(then, 'weekday');
  return i18n.date(then, 'medium');
}

const resourceCopy = {
  collections: {icon: 'collection' as const, title: 'web.saved.empty.collections' as MessageId, message: 'web.saved.empty.collectionsBody' as MessageId},
  views: {icon: 'filter' as const, title: 'web.saved.empty.views' as MessageId, message: 'web.saved.empty.viewsBody' as MessageId},
};

/** Errors, the first load and the empty state for the viewer's collections or saved views. */
function ResourcesStatus({tab, snapshot, count, onRefresh}: {tab: 'collections' | 'views'; snapshot: PersonalSavedSnapshot; count: number; onRefresh: () => void}) {
  const {space} = useTheme();
  const i18n = useI18n();
  const copy = resourceCopy[tab];
  return (
    <View>
      {snapshot.error && !count ? (
        <StateView icon="warning" title={i18n.t('saved.listLoadFailed')} message={say(snapshot.error, 'saved', 'load')} action={i18n.t('action.tryAgain')} onAction={onRefresh} />
      ) : snapshot.error ? (
        <Notice tone="warning" message={say(snapshot.error, 'saved', 'load')} action={i18n.t('action.refresh')} onAction={onRefresh} style={{marginHorizontal: space.page, marginBottom: space.lg}} />
      ) : null}
      {snapshot.loading && !count ? <StateView loading title={i18n.t('saved.loading')} /> : null}
      {!snapshot.loading && !snapshot.error && !count && snapshot.route !== null ? <StateView icon={copy.icon} title={i18n.t(copy.title)} message={i18n.t(copy.message)} /> : null}
    </View>
  );
}

/** A collection or saved view: a name, not a poster. The rows read as one panel, each its own list cell. */
function ResourceRow({resource, first, last, onOpen}: {resource: PersonalSavedSnapshot['resources'][number]; first: boolean; last: boolean; onOpen: () => void}) {
  const {space, colors, metrics} = useTheme();
  const i18n = useI18n();
  const corner = metrics.radius.panel;
  const edge = alpha(colors.lineSoft, 0.9);
  return (
    <View style={{marginHorizontal: space.page, backgroundColor: colors.raised, borderColor: edge, borderLeftWidth: 1, borderRightWidth: 1, borderTopWidth: first ? 1 : 0, borderBottomWidth: last ? 1 : 0, borderTopLeftRadius: first ? corner : 0, borderTopRightRadius: first ? corner : 0, borderBottomLeftRadius: last ? corner : 0, borderBottomRightRadius: last ? corner : 0}}>
      {first ? null : <Divider inset={space.md} />}
      <ListRow icon={resource.kind === 'view' ? 'filter' : 'collection'} title={resource.name} subtitle={resource.summary || (resource.visibility === 'server' ? i18n.t('saved.sharedWithEveryone') : undefined)} meta={resource.kind === 'view' ? undefined : i18n.t('count.items', {count: resource.entryCount})} trailingIcon="forward" onPress={onOpen} />
    </View>
  );
}

/** One media card; its shape follows the entry's kind. */
function useMediaCard() {
  const artwork = useArtwork();
  const open = useOpenEntry();
  return useCallback((entry: ContentEntry, w: number) => {
    const shape = shapeFor(entry.kind);
    return (
      <Card
        title={entry.title}
        subtitle={captionFor(entry)}
        source={artwork(shape === 'landscape' ? entry.backdropUrl ?? entry.posterUrl : entry.posterUrl ?? entry.backdropUrl)}
        shape={shape}
        width={w}
        progress={progressFor(entry)}
        watched={entry.watched === true}
        unavailable={entry.available === false}
        icon={entry.posterUrl || entry.backdropUrl ? undefined : iconFor(entry.kind)}
        onPress={() => open(entry)}
        onLongPress={() => open(entry, 'more')}
      />
    );
  }, [artwork, open]);
}

function relativeTime(i18n: I18n, iso?: string): string | undefined {
  if (!iso || !Number.isFinite(Date.parse(iso))) return undefined;
  return i18n.relativeTime(iso);
}

/** A history card carries the viewing position and when it was last touched. */
function useHistoryCard() {
  const i18n = useI18n();
  const artwork = useArtwork();
  const open = useOpenEntry();
  return useCallback((row: HistoryEntry, w: number) => {
    const entry = row.media;
    const shape = shapeFor(entry.kind);
    const progress = row.completed ? 0 : entry.duration && row.positionSeconds ? Math.min(1, row.positionSeconds / entry.duration) : progressFor(entry);
    return (
      <Card
        title={entry.title}
        subtitle={relativeTime(i18n, row.updatedAt) ?? captionFor(entry)}
        source={artwork(shape === 'landscape' ? entry.backdropUrl ?? entry.posterUrl : entry.posterUrl ?? entry.backdropUrl)}
        shape={shape}
        width={w}
        progress={progress}
        badge={row.completed ? i18n.t('saved.watched') : undefined}
        icon={entry.posterUrl || entry.backdropUrl ? undefined : iconFor(entry.kind)}
        onPress={() => open(entry)}
        onLongPress={() => open(entry, 'more')}
      />
    );
  }, [i18n, artwork, open]);
}

function PlaylistRow({card, first, onOpen}: {card: PlaylistCard; first: boolean; onOpen: () => void}) {
  const {space} = useTheme();
  const i18n = useI18n();
  return (
    <View style={{paddingHorizontal: space.page - space.sm}}>
      {first ? null : <Divider inset={space.sm} />}
      <ListRow title={card.title} subtitle={card.subtitle} meta={card.count !== undefined ? i18n.t('count.items', {count: card.count}) : undefined} icon="queue" trailingIcon="forward" onPress={onOpen} />
    </View>
  );
}

const entryKey = (entry: {id: string}) => entry.id;

/** The next page on its way, under what is already listed. */
function MoreSpinner({busy}: {busy: boolean}) {
  const {space} = useTheme();
  return busy ? <View style={{alignItems: 'center', paddingVertical: space.lg}}><Ring size={24} thickness={2} /></View> : null;
}

function LoadingGrid({width}: {width: number}) {
  const {space, metrics} = useTheme();
  const columns = Math.max(2, Math.floor((width + space.gutter) / (metrics.posterWidth + space.gutter)));
  const columnWidth = Math.floor((width - space.gutter * (columns - 1)) / columns);
  return (
    <View style={{paddingHorizontal: space.page, flexDirection: 'row', flexWrap: 'wrap', gap: space.gutter}}>
      {Array.from({length: columns * 2}).map((_, i) => (
        <Skeleton key={i} width={columnWidth} height={columnWidth * 1.5} />
      ))}
    </View>
  );
}

function LoadingRows() {
  const {space, metrics} = useTheme();
  return (
    <View style={{paddingHorizontal: space.page, gap: space.md}}>
      {[0, 1, 2, 3].map(i => (
        <Skeleton key={i} height={metrics.hit} radius={metrics.radius.control} />
      ))}
    </View>
  );
}

