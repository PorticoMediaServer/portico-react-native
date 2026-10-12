import React, {useCallback, useEffect, useMemo, useRef, useState} from 'react';
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
import {Button, ConfirmSheet, Card, Divider, Grid, ListRow, Notice, Page, PageHeader, Ring, Skeleton, StateView, Surface, Tabs, Text, WindowedGrid, useTheme, type GridWindow, type IconName} from '../ui';
import {say} from '../app/errors';
import {RootHeaderActions} from './Home';
import {useI18n} from '../app/i18n';
import {usePullToRefresh} from '../app/refresh';
import {useAppendedPages, useEndReached} from '../app/paging';
import type {I18n, MessageId} from '../app/i18n';
import {RowGuide} from './title/RowGuide';

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

  const savedRoute: SavedRoute | null = useMemo(() => (isPersonal(tab) ? null : {view: tab, ...(sort[tab] ?? {})}), [tab, sort]);
  const saved = useSavedService(savedRoute);
  const personalRoute = useMemo<SavedRoute | null>(() => (isPersonal(tab) ? {view: tab} : null), [tab]);
  const history = usePersonalService(personalRoute);

  const projection = saved.snapshot.projection;
  // APL-SAVED-01: no sort chips over an empty list.
  const hasEntries = !!projection?.sections.some(section => section.entries.length);
  const sorts = !isPersonal(tab) && tab !== 'playlists' && hasEntries ? projection?.sorts ?? [] : [];
  const activeSort = sort[tab]?.sort ?? projection?.query.sort ?? sorts[0]?.id;
  const activeDirection = sort[tab]?.direction ?? (projection?.query.direction as 'asc' | 'desc' | undefined);

  const refresh = isPersonal(tab) ? history.refresh : saved.refresh;
  // APL-SYS-07: pull to refresh (touch) and a quiet refresh after a long absence.
  const pull = usePullToRefresh(refresh, {busy: isPersonal(tab) ? history.snapshot.loading : saved.snapshot.phase === 'loading'});
  // APL-SYS-08: the next page loads as the list nears its end; earlier pages stay.
  const pageable = saved.snapshot.projection?.sections.find(s => s.nextCursor);
  const onScroll = useEndReached(() => {
    if (isPersonal(tab)) {
      if (!history.snapshot.loading && !history.snapshot.error && history.snapshot.nextCursor) history.next();
    } else if (pageable && saved.snapshot.phase === 'ready') saved.next(pageable.id);
  });

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
  const header = <PageHeader title={i18n.t('saved.title')} actions={<RootHeaderActions />} />;
  const tabRow = (
    <View>
      {/* TV: the guide hands focus to a tab (never to itself), so arriving from the rail always shows focus. */}
      <RowGuide><Tabs items={tabs} selected={tab} onSelect={id => setTab(id as SavedTab)} /></RowGuide>
    </View>
  );
  const sortRow = sorts.length ? (
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
  if (mediaTab && media.length) {
    const shapes = new Set(media.slice(0, 60).map(e => shapeFor(e.kind)));
    const dominant = shapes.size === 1 ? shapeFor(media[0]!.kind) : 'poster';
    const itemWidth = dominant === 'landscape' ? metrics.landscapeWidth : dominant === 'square' ? metrics.squareWidth : metrics.posterWidth;
    const notice = saved.snapshot.phase === 'error' ? <Notice tone="error" message={say(saved.snapshot.error, 'saved', 'load')} action={i18n.t('saved.retry')} onAction={saved.retry} style={{marginHorizontal: space.page, marginBottom: space.lg}} />
      : saved.snapshot.phase === 'refresh-required' ? <Notice tone="warning" message={say(saved.snapshot.error ?? 'stale', 'saved', 'load')} action={i18n.t('action.refresh')} onAction={saved.refresh} style={{marginHorizontal: space.page, marginBottom: space.lg}} /> : null;
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
      <Page stickyHeaderIndices={isTV ? undefined : [1]} refreshControl={pull} onScroll={onScroll} scrollEventThrottle={100}>
        {header}
        {tabRow}
        {sorts.length ? (
          <View style={{flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', gap: space.sm, paddingHorizontal: space.page, paddingVertical: space.md}}>
            <Text variant="label" tone="tertiary" style={{marginRight: space.xs}}>{i18n.t('saved.sort')}</Text>
            {sorts.map(s => {
              const active = activeSort === s.id;
              const direction = active ? activeDirection : undefined;
              return (
                <Button
                  key={s.id}
                  size="sm"
                  variant="secondary"
                  selected={active}
                  label={sortLabel(i18n, s.labelKey)}
                  trailingIcon={active ? (direction === 'desc' ? 'chevronDown' : 'chevronUp') : undefined}
                  onPress={() => setSort(prev => ({...prev, [tab]: {sort: s.id, direction: active && direction === 'asc' ? 'desc' : 'asc'}}))}
                />
              );
            })}
          </View>
        ) : (
          <View style={{height: isTV ? space.xl : space.lg}} />
        )}
        {tab === 'collections' || tab === 'views' ? (
          <ResourcesTab tab={tab} snapshot={history.snapshot} onRefresh={history.refresh} onOpen={r => navigation.push('SavedResource', {resourceId: r.id, title: r.name})} />
        ) : tab === 'history' ? (
          <HistoryTab snapshot={history.snapshot} width={gridWidth} onRefresh={history.refresh} onClear={history.clearHistory} />
        ) : (
          <SavedTabView tab={tab} snapshot={saved.snapshot} width={gridWidth} onRetry={saved.retry} onRefresh={saved.refresh} onOpenPlaylist={card => navigation.push('Playlist', {playlistId: card.navigation.entityId, title: card.title})} />
        )}
      </Page>
    </View>
  );
}

function SavedTabView({tab, snapshot, width, onRetry, onRefresh, onOpenPlaylist}: {tab: Exclude<SavedTab, PersonalTab>; snapshot: SavedSnapshot; width: number; onRetry: () => void; onRefresh: () => void; onOpenPlaylist: (card: PlaylistCard) => void}) {
  const {space} = useTheme();
  const i18n = useI18n();
  const sections = useMemo(() => snapshot.projection?.sections ?? [], [snapshot.projection]);
  const page = useMemo(() => sections.flatMap(s => s.entries), [sections]);
  const entries = useAppendedPages(JSON.stringify(snapshot.route), snapshot.pagination.cursor, page, entryKey);
  const pageable = sections.find(s => s.nextCursor);
  const loadingFresh = snapshot.phase === 'loading' && !sections.length;
  const empty = snapshot.phase === 'ready' && !entries.length;
  return (
    <View>
      {snapshot.phase === 'error' && !sections.length ? (
        <StateView icon="warning" title={i18n.t('saved.loadFailed')} message={say(snapshot.error, 'saved', 'load')} action={i18n.t('action.tryAgain')} onAction={onRetry} />
      ) : snapshot.phase === 'error' ? (
        <Notice tone="error" message={say(snapshot.error, 'saved', 'load')} action={i18n.t('saved.retry')} onAction={onRetry} style={{marginHorizontal: space.page, marginBottom: space.lg}} />
      ) : snapshot.phase === 'refresh-required' ? (
        <Notice tone="warning" message={say(snapshot.error ?? 'stale', 'saved', 'load')} action={i18n.t('action.refresh')} onAction={onRefresh} style={{marginHorizontal: space.page, marginBottom: space.lg}} />
      ) : null}
      {loadingFresh ? tab === 'playlists' ? <LoadingRows /> : <LoadingGrid width={width} /> : null}
      {empty ? <StateView icon={emptyCopy[tab].icon} title={snapshot.projection?.empty?.fallback ?? i18n.t(emptyCopy[tab].title)} message={i18n.t(emptyCopy[tab].message)} /> : null}
      {tab === 'playlists' ? <PlaylistList entries={entries} onOpen={onOpenPlaylist} /> : <MediaGrid entries={entries.filter(isMedia)} width={width} />}
      <MoreSpinner busy={!!pageable && snapshot.phase === 'loading' && entries.length > 0} />
    </View>
  );
}

function HistoryTab({snapshot, width, onRefresh, onClear}: {snapshot: PersonalSavedSnapshot; width: number; onRefresh: () => void; onClear: () => Promise<unknown>}) {
  const {space} = useTheme();
  const i18n = useI18n();
  const [clearing, setClearing] = useState(false);
  const all = useAppendedPages(JSON.stringify(snapshot.route), snapshot.cursor, snapshot.entries, entryKey);
  const loadingFresh = snapshot.loading && !all.length;
  const empty = !snapshot.loading && !snapshot.error && !all.length && snapshot.route !== null;
  // APL-SAVED-01: one row per title (its latest position), grouped by day.
  const days = useMemo(() => {
    const seen = new Set<string>();
    const out: {label: string; entries: PersonalResourceEntry[]}[] = [];
    for (const entry of all) {
      const id = entry.media?.id;
      if (entry.hidden || !id || seen.has(id)) continue;
      seen.add(id);
      const label = entry.updatedAt ? dayLabel(entry.updatedAt, i18n) : i18n.t('saved.earlier');
      const group = out[out.length - 1]?.label === label ? out[out.length - 1] : (out.push({label, entries: []}), out[out.length - 1]);
      group.entries.push(entry);
    }
    return out;
  }, [all, i18n]);
  return (
    <View>
      {snapshot.error && !all.length ? (
        <StateView icon="warning" title={i18n.t('saved.historyLoadFailed')} message={say(snapshot.error, 'saved', 'load')} action={i18n.t('action.tryAgain')} onAction={onRefresh} />
      ) : snapshot.error ? (
        <Notice tone={snapshot.error.conflict ? 'warning' : 'error'} message={say(snapshot.error, 'saved', 'load')} action={i18n.t('action.refresh')} onAction={onRefresh} style={{marginHorizontal: space.page, marginBottom: space.lg}} />
      ) : null}
      {loadingFresh ? <LoadingGrid width={width} /> : null}
      {empty ? <StateView icon={emptyCopy.history.icon} title={i18n.t(emptyCopy.history.title)} message={i18n.t(emptyCopy.history.message)} /> : null}
      {days.length ? <View style={{paddingHorizontal: space.page, alignItems: 'flex-end'}}><Button variant="ghost" size="sm" icon="trash" label={i18n.t('web.saved.clearHistory')} onPress={() => setClearing(true)} /></View> : null}
      {days.map(day => (
        <View key={day.label} style={{marginBottom: space.lg}}>
          <Text variant="heading" style={{marginHorizontal: space.page, marginBottom: space.sm}}>{day.label}</Text>
          <HistoryGrid entries={day.entries} width={width} />
        </View>
      ))}
      <MoreSpinner busy={snapshot.loading && all.length > 0} />
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

/** The viewer's collections or saved views, as a list: each is a name, not a poster. */
function ResourcesTab({tab, snapshot, onRefresh, onOpen}: {tab: 'collections' | 'views'; snapshot: PersonalSavedSnapshot; onRefresh: () => void; onOpen: (resource: PersonalSavedSnapshot['resources'][number]) => void}) {
  const {space} = useTheme();
  const i18n = useI18n();
  const copy = resourceCopy[tab];
  const rows = useAppendedPages(JSON.stringify(snapshot.route), snapshot.cursor, snapshot.resources, entryKey);
  return (
    <View>
      {snapshot.error && !rows.length ? (
        <StateView icon="warning" title={i18n.t('saved.listLoadFailed')} message={say(snapshot.error, 'saved', 'load')} action={i18n.t('action.tryAgain')} onAction={onRefresh} />
      ) : snapshot.error ? (
        <Notice tone="warning" message={say(snapshot.error, 'saved', 'load')} action={i18n.t('action.refresh')} onAction={onRefresh} style={{marginHorizontal: space.page, marginBottom: space.lg}} />
      ) : null}
      {snapshot.loading && !rows.length ? <StateView loading title={i18n.t('saved.loading')} /> : null}
      {!snapshot.loading && !snapshot.error && !rows.length && snapshot.route !== null ? <StateView icon={copy.icon} title={i18n.t(copy.title)} message={i18n.t(copy.message)} /> : null}
      {rows.length ? (
        <View style={{paddingHorizontal: space.page}}>
          <Surface padded={false}>
            {rows.map((r, i) => (
              <View key={r.id}>
                {i ? <Divider inset={space.md} /> : null}
                <ListRow icon={r.kind === 'view' ? 'filter' : 'collection'} title={r.name} subtitle={r.summary || (r.visibility === 'server' ? i18n.t('saved.sharedWithEveryone') : undefined)} meta={r.kind === 'view' ? undefined : i18n.t('count.items', {count: r.entryCount})} trailingIcon="forward" onPress={() => onOpen(r)} />
              </View>
            ))}
          </Surface>
        </View>
      ) : null}
      <MoreSpinner busy={snapshot.loading && rows.length > 0} />
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
        icon={entry.posterUrl || entry.backdropUrl ? undefined : iconFor(entry.kind)}
        onPress={() => open(entry)}
        onLongPress={() => open(entry, 'more')}
      />
    );
  }, [artwork, open]);
}

/** Cards for media entries; shape follows each entry's kind. */
function MediaGrid({entries, width}: {entries: readonly ContentEntry[]; width: number}) {
  const {metrics} = useTheme();
  const artwork = useArtwork();
  const open = useOpenEntry();
  if (!entries.length) return null;
  const shapes = new Set(entries.map(e => shapeFor(e.kind)));
  const dominant = shapes.size === 1 ? shapeFor(entries[0].kind) : 'poster';
  const itemWidth = dominant === 'landscape' ? metrics.landscapeWidth : dominant === 'square' ? metrics.squareWidth : metrics.posterWidth;
  return (
    <Grid
      data={entries}
      width={width}
      itemWidth={itemWidth}
      keyExtractor={e => e.id}
      scrollEnabled={false}
      renderItem={(entry, w) => {
        const shape = shapeFor(entry.kind);
        return (
          <Card
            title={entry.title}
            subtitle={captionFor(entry)}
            source={artwork(shape === 'landscape' ? entry.backdropUrl ?? entry.posterUrl : entry.posterUrl ?? entry.backdropUrl)}
            shape={shape}
            width={w}
            progress={progressFor(entry)}
            icon={entry.posterUrl || entry.backdropUrl ? undefined : iconFor(entry.kind)}
            onPress={() => open(entry)}
            onLongPress={() => open(entry, 'more')}
          />
        );
      }}
    />
  );
}

function relativeTime(i18n: I18n, iso?: string): string | undefined {
  if (!iso || !Number.isFinite(Date.parse(iso))) return undefined;
  return i18n.relativeTime(iso);
}

/** History cards carry the viewing position and when it was last touched. */
function HistoryGrid({entries, width}: {entries: readonly PersonalResourceEntry[]; width: number}) {
  const {metrics} = useTheme();
  const i18n = useI18n();
  const artwork = useArtwork();
  const open = useOpenEntry();
  const rows = useMemo(() => entries.filter((e): e is PersonalResourceEntry & {media: ContentEntry} => !e.hidden && !!e.media), [entries]);
  if (!rows.length) return null;
  const shapes = new Set(rows.map(e => shapeFor(e.media.kind)));
  const dominant = shapes.size === 1 ? shapeFor(rows[0].media.kind) : 'poster';
  const itemWidth = dominant === 'landscape' ? metrics.landscapeWidth : dominant === 'square' ? metrics.squareWidth : metrics.posterWidth;
  return (
    <Grid
      data={rows}
      width={width}
      itemWidth={itemWidth}
      keyExtractor={e => e.id}
      scrollEnabled={false}
      renderItem={(row, w) => {
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
      }}
    />
  );
}

function PlaylistList({entries, onOpen}: {entries: readonly SavedEntry[]; onOpen: (card: PlaylistCard) => void}) {
  const {space} = useTheme();
  const i18n = useI18n();
  const cards = entries.filter(isPlaylistCard);
  if (!cards.length) return null;
  return (
    <View style={{paddingHorizontal: space.page - space.sm}}>
      {cards.map((card, index) => (
        <View key={card.id}>
          {index > 0 ? <Divider inset={space.sm} /> : null}
          <ListRow title={card.title} subtitle={card.subtitle} meta={card.count !== undefined ? i18n.t('count.items', {count: card.count}) : undefined} icon="queue" trailingIcon="forward" onPress={() => onOpen(card)} />
        </View>
      ))}
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

