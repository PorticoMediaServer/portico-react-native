import React, {useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore} from 'react';
import {ScrollView, Text, View} from 'react-native';
import {defaultI18n} from '../../../../../../packages/i18n/src';
import type {ContentEntry} from '../../../../../../packages/client-core/src/library-content';
import {durationText} from '../../../../../../packages/client-core/src/presentation/kit-model/text';
import {savedListFilters, type HistoryPeriod, type SavedListFilter, type SavedListSort, type SavedRoute} from '../../../../../../packages/client-core/src/saved';
import {Artwork} from '../../../kit/artwork';
import {Button, Chip, Focusable} from '../../../kit/controls';
import {PosterCard, SquareCard} from '../../../kit/cards';
import {Dialog, Menu} from '../../../kit/overlays';
import {StateView} from '../../../kit/states';
import {FocusRegion} from '../../../kit/focus';
import type {NativeSavedSelectionPort} from '../../saved/SavedScreen';
import {browseType} from '../../../kit/browse/presentation';
import {useTheme} from '../../../kit/theme';
import type {NativeShellRuntime} from '../../../shell/runtime';
import type {NativeDestinationActivationPort} from '../focus';
import {nativeDestinationFocusIds} from '../focus';
import type {NativeEntryActions} from '../entry-actions';
import {SavedTVTabs} from '../../saved/SavedTVTabs';
import {SavedTVDirectory} from '../../saved/SavedTVDirectory';
import type {NativeSavedViewDestination} from '../../saved/view-model';
import type {NativeTVSavedController, NativeTVSavedTab} from './model';

const t = defaultI18n.t;
const factLine = (text: string) => Object.freeze([{id: 'caption', text, role: 'value' as const}]);
type Tab = NativeTVSavedTab;
type Actions = Pick<NativeEntryActions, 'menu' | 'isMenuOpen' | 'play'>;
const sorts: readonly Readonly<{id: Exclude<SavedListSort, 'updated'>; label: Parameters<typeof t>[0]}>[] = [
  {id: 'added', label: 'web.saved.sort.added'}, {id: 'title', label: 'web.saved.sort.title'},
  {id: 'year', label: 'web.saved.sort.year'}, {id: 'duration', label: 'web.saved.sort.duration'},
  {id: 'progress', label: 'web.saved.sort.progress'},
];
const filters: readonly Readonly<{id: SavedListFilter; label: Parameters<typeof t>[0]}>[] = [
  {id: 'all', label: 'search.chip.all'}, {id: 'unwatched', label: 'filter.quick.unwatched'}, {id: 'inProgress', label: 'filter.quick.inProgress'},
];
const periods: readonly HistoryPeriod[] = ['24h', '7d', '30d', '90d', 'all'];
const periodLabel: Record<HistoryPeriod, Parameters<typeof t>[0]> = {['24h']: 'saved.today', '7d': 'web.saved.thisWeek', '30d': 'web.saved.days', '90d': 'web.saved.days', all: 'web.saved.allTime'};

const emptyFor: Record<Tab, Readonly<{title: Parameters<typeof t>[0]; body: Parameters<typeof t>[0]}>> = {
  watchlist: {title: 'web.saved.empty.watchlist', body: 'web.saved.empty.watchlistBody'},
  favorites: {title: 'web.saved.empty.favorites', body: 'web.saved.empty.favoritesBody'},
  playlists: {title: 'web.saved.empty.playlists', body: 'web.saved.empty.playlistsBody'},
  collections: {title: 'web.saved.empty.collections', body: 'web.saved.empty.collectionsBody'},
  views: {title: 'web.saved.empty.views', body: 'web.saved.empty.viewsBody'},
  history: {title: 'web.saved.empty.history', body: 'web.saved.empty.historyBody'},
};

function dayLabel(value: string | undefined, locale: string | undefined): string | undefined {
  if (!value) return undefined;
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) return undefined;
  const now = new Date(), at = new Date(date.getFullYear(), date.getMonth(), date.getDate()), today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const days = Math.round((today.getTime() - at.getTime()) / 86400000);
  if (days === 0) return t('saved.today');
  if (days === 1) return t('relative.yesterday');
  return new Intl.DateTimeFormat(locale ?? 'en-US', {weekday: 'long'}).format(date);
}

function clock(value: string | undefined, locale: string | undefined): string | undefined {
  if (!value) return undefined;
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) return undefined;
  return new Intl.DateTimeFormat(locale ?? 'en-US', {hour: 'numeric', minute: '2-digit'}).format(date);
}

function historyLine(entry: ContentEntry): string {
  if (entry.kind === 'episode') return [entry.seasonNumber !== undefined && entry.episodeNumber !== undefined ? t('title.episodeCode', {season: entry.seasonNumber, episode: entry.episodeNumber}) : undefined, entry.title].filter(Boolean).join(' · ');
  if (['song', 'album', 'artist'].includes(entry.kind)) return [entry.artist?.name, entry.album?.name].filter(Boolean).join(' · ') || entry.subtitle || '';
  if (entry.kind === 'book' || entry.kind === 'audiobook_file') return entry.author ?? '';
  if (entry.kind === 'movie') return [t('search.kind.movie'), entry.year === undefined ? undefined : defaultI18n.number(entry.year, {useGrouping: false})].filter(Boolean).join(' · ');
  return entry.subtitle ?? '';
}

function Empty({tab, browseHome}: {tab: Tab; browseHome: () => void}) {
  const copy = emptyFor[tab];
  const body = [t(copy.body), tab === 'watchlist' ? t('saved.holdHint') : ''].filter(Boolean).join(' ');
  return <StateView testID="saved-empty" variant="centered" title={t(copy.title)} body={body} primaryAction={{id: 'browse-home', label: t('saved.browseHome'), onPress: browseHome}}/>;
}

function HistoryRow({entry, updatedAt, positionSeconds, completed, runtime, actions, openEntry}: {
  entry: ContentEntry; updatedAt?: string; positionSeconds?: number; completed?: boolean; runtime: NativeShellRuntime; actions: Actions; openEntry: (entry: ContentEntry) => void;
}) {
  const theme = useTheme(), progress = entry.duration && positionSeconds !== undefined ? Math.max(0, Math.min(1, positionSeconds / entry.duration)) : undefined;
  const remaining = entry.duration && positionSeconds !== undefined ? durationText(Math.max(0, entry.duration - positionSeconds), runtime.text.t) : undefined;
  const video = ['movie', 'episode', 'show', 'season', 'extra'].includes(entry.kind), art = runtime.artwork(video ? entry.backdropUrl ?? entry.stillUrl : entry.posterUrl);
  return <Focusable testID={`saved-history-${encodeURIComponent(entry.id)}`} accessibilityRole="button" accessibilityLabel={entry.show?.name ?? entry.displayTitle ?? entry.title}
    onPress={() => entry.playback ? actions.play(entry) : openEntry(entry)} onLongPressAction={() => actions.menu(entry)} focusKind="row" focusRadius={16} style={{height: 104}}>
    {({focused}) => <View style={{height: 104, marginBottom: 8, flexDirection: 'row', alignItems: 'center', gap: 26, paddingLeft: 14, paddingRight: 28, borderRadius: 16, backgroundColor: focused ? theme.colors.raisedHigh : undefined}}>
      <View style={{width: 156, height: 88, borderRadius: 10, overflow: 'hidden', backgroundColor: theme.colors.raised, flexShrink: 0}}>
        {art ? <Artwork source={art} width={156} height={88}/> : null}
        {!video && art ? <View style={{position: 'absolute', left: 42, top: 8, width: 72, height: 72, borderRadius: 6, overflow: 'hidden', borderWidth: 1, borderColor: theme.colors.line}}><Artwork source={art} width={72} height={72}/></View> : null}
      </View>
      <View style={{flex: 1, minWidth: 0}}>
        <Text numberOfLines={1} style={[browseType(theme, 28, 700), {color: theme.colors.text}]}>{entry.show?.name ?? entry.displayTitle ?? entry.title}</Text>
        <Text numberOfLines={1} style={[browseType(theme, 22, 400), {color: theme.colors.textTertiary, marginTop: 3}]}>{historyLine(entry)}</Text>
      </View>
      <View style={{width: 280, flexShrink: 0}}>
        {completed ? <Text style={[browseType(theme, 21), {color: theme.colors.textTertiary}]}>{t('saved.watched')}</Text> : <>
          {progress !== undefined ? <View style={{height: 6, borderRadius: 6, backgroundColor: 'rgba(237,245,250,.18)', marginBottom: 8}}><View style={{height: 6, width: `${progress * 100}%`, borderRadius: 6, backgroundColor: theme.colors.accentStrong}}/></View> : null}
          {remaining ? <Text style={[browseType(theme, 21), {color: theme.colors.textTertiary}]}>{t('next.kit.remaining', {time: remaining})}</Text> : null}
        </>}
      </View>
      <Text style={[browseType(theme, 23), {width: 140, textAlign: 'right', color: theme.colors.textSecondary, fontVariant: ['tabular-nums'], flexShrink: 0}]}>{clock(updatedAt, runtime.text.locale) ?? ''}</Text>
    </View>}
  </Focusable>;
}

/** tv-more1–5: the TV Saved landing with the six drawn tabs and server-owned bodies. */
export function TVSavedScreen({controller, runtime, actions, activation, authority, openSaved, openEntry, browseHome, initialTab, selection}: {
  controller: NativeTVSavedController; runtime: NativeShellRuntime; actions: Actions; activation: NativeDestinationActivationPort;
  authority: Parameters<typeof nativeDestinationFocusIds>[0]; initialTab: Tab; selection?: NativeSavedSelectionPort;
  openSaved: (route: SavedRoute) => void; openEntry: (entry: ContentEntry) => void; browseHome: () => void;
}) {
  const theme = useTheme(), snapshot = useSyncExternalStore(controller.subscribe, controller.getSnapshot);
  const [tab, setTab] = useState<Tab>(initialTab), [sort, setSort] = useState<Exclude<SavedListSort, 'updated'>>('added');
  const [filter, setFilter] = useState<SavedListFilter>('all'), [period, setPeriod] = useState<HistoryPeriod>('7d');
  const [sortOpen, setSortOpen] = useState(false), [filterOpen, setFilterOpen] = useState(false), [clearOpen, setClearOpen] = useState(false);
  const sortAnchor = useRef<View>(null), filterAnchor = useRef<View>(null);
  const ids = useMemo(() => nativeDestinationFocusIds(authority), [authority]);
  const active = useSyncExternalStore(activation.subscribe, activation.getSnapshot);
  const run = useCallback((work: Promise<unknown>) => {void work.catch(runtime.reportError);}, [runtime]);
  const started = useRef(false);
  useEffect(() => {if (started.current) return; started.current = true; run(controller.select(tab, {sort, filter, period})); run(controller.summary());}, [controller, filter, period, run, sort, tab]);
  const choose = useCallback((next: Tab) => {if (next === tab) return; setTab(next); run(controller.select(next, {sort, filter, period}));}, [controller, filter, period, run, sort, tab]);
  const tabsState = useMemo(() => ({phase: snapshot.phase, route: {view: tab} as const, error: snapshot.error}), [snapshot.phase, snapshot.error, tab]);
  const tabsDestination = useMemo(() => ({
    subscribe: controller.subscribe, getSnapshot: () => tabsState,
    select: (route: {view?: string}) => {const next = route.view as Tab; if (next && next !== tab) choose(next); return Promise.resolve();},
  }) as unknown as NativeSavedViewDestination, [choose, controller, tabsState, tab]);
  const count = tab === 'watchlist' || tab === 'favorites'
    ? (snapshot.counts?.posters ?? 0) + (snapshot.counts?.squares ?? 0)
    : tab === 'playlists' ? snapshot.playlists?.sections.reduce((sum, section) => sum + section.totalCount, 0) ?? 0
      : tab === 'history' ? snapshot.entries.length : snapshot.resources.length;
  const posters = (tab === 'watchlist' || tab === 'favorites' ? snapshot.posters?.sections.flatMap(section => section.entries) ?? [] : [])
    .filter((entry): entry is ContentEntry => entry.kind !== 'playlist' && entry.kind !== 'playlist_entry' && !['album', 'song', 'book', 'audiobook_file', 'artist'].includes(entry.kind));
  const squares = (tab === 'watchlist' || tab === 'favorites' ? snapshot.squares?.sections.flatMap(section => section.entries) ?? [] : [])
    .filter((entry): entry is ContentEntry => entry.kind !== 'playlist' && entry.kind !== 'playlist_entry');
  const posterCount = snapshot.counts?.posters ?? posters.length, squareCount = snapshot.counts?.squares ?? squares.length;
  const card = (entry: ContentEntry) => <PosterCard key={entry.id} testID={`saved-poster-${encodeURIComponent(entry.id)}`} width={200} title={entry.displayTitle ?? entry.title} caption={factLine(historyLine(entry))} artwork={runtime.artwork(entry.posterUrl)}
    onNavigate={() => openEntry(entry)} onMore={() => actions.menu(entry, undefined, select?.(entry))} moreExpanded={actions.isMenuOpen(entry)} selection={selection?.item(entry)}/>;
  const square = (entry: ContentEntry) => <SquareCard key={entry.id} testID={`saved-square-${encodeURIComponent(entry.id)}`} width={200} title={entry.displayTitle ?? entry.title} caption={factLine(entry.artist?.name ?? entry.author ?? '')} artwork={runtime.artwork(entry.posterUrl)}
    onNavigate={() => openEntry(entry)} onMore={() => actions.menu(entry, undefined, select?.(entry))} moreExpanded={actions.isMenuOpen(entry)} selection={selection?.item(entry)}/>;
  /** The menu's Select starts this screen's own canonical Saved selection on that title. */
  const select = selection ? (entry: ContentEntry) => () => {void selection.item(entry).onEnter();} : undefined;
  const heading = (title: string, detail: number) => <View style={{flexDirection: 'row', alignItems: 'baseline', gap: 16, marginTop: 40, marginBottom: 18}}>
    <Text style={[browseType(theme, 32, 700, -.019), {color: theme.colors.text}]}>{title}</Text><Text style={[browseType(theme, 22, 600), {color: theme.colors.textTertiary}]}>{defaultI18n.number(detail)}</Text>
  </View>;
  const directoryView = tab === 'playlists' || tab === 'collections' || tab === 'views' ? tab : undefined;
  const body = snapshot.phase === 'error' ? <StateView testID="saved-error" variant="centered" {...runtime.error(snapshot.error, () => {run(controller.select(tab, {sort, filter, period}));})}/>
    : snapshot.phase !== 'ready' ? null
      : tab === 'history' ? (snapshot.entries.length ? <View>
        {snapshot.entries.map((row, index) => {const day = dayLabel(row.updatedAt, runtime.text.locale), previous = index ? dayLabel(snapshot.entries[index - 1]?.updatedAt, runtime.text.locale) : undefined;
          return <React.Fragment key={row.id}>{day && day !== previous ? <View style={{flexDirection: 'row', alignItems: 'center', gap: 16, marginTop: index ? 30 : 6, marginBottom: 10}}><Text style={[browseType(theme, 22, 700), {color: theme.colors.textTertiary}]}>{day}</Text></View> : null}
            {row.media ? <HistoryRow entry={row.media} updatedAt={row.updatedAt} positionSeconds={row.positionSeconds} completed={row.completed} runtime={runtime} actions={actions} openEntry={openEntry}/> : null}</React.Fragment>;})}
      </View> : <Empty tab="history" browseHome={browseHome}/>)
        : tab === 'watchlist' || tab === 'favorites' ? ((posters.length || squares.length)
          ? <View>
            {posters.length ? <>{squareCount ? heading(t('saved.postersHeading'), posterCount) : null}<View style={{flexDirection: 'row', flexWrap: 'wrap', gap: 32, rowGap: 40}}>{posters.map(card)}</View></> : null}
            {squares.length ? <>{posterCount ? heading(t('saved.squaresHeading'), squareCount) : null}<View style={{flexDirection: 'row', flexWrap: 'wrap', gap: 32, rowGap: 40}}>{squares.map(square)}</View></> : null}
          </View> : <Empty tab={tab} browseHome={browseHome}/>)
        : null;
  // tv-more1/3 draw the server's own quick filters, with counts in the Filters menu; a server
  // that publishes none keeps the two the page has always offered.
  const publishedFilters = (snapshot.posters?.filters ?? snapshot.squares?.filters ?? []).flatMap(filter => filter.options)
    .filter(option => (savedListFilters as readonly string[]).includes(option.id));
  const quickFilters = publishedFilters.filter(option => option.id !== 'all');
  const sortLabel = sorts.find(value => value.id === sort)?.label ?? 'web.saved.sort.added';
  return <View testID="native-tv-saved" style={{flex: 1, backgroundColor: theme.colors.ink}}>
    <ScrollView contentContainerStyle={{paddingBottom: 64}} showsVerticalScrollIndicator={false}>
      {/* LibraryHeader already carries the page's 200 inset; collections.html 15-17 draw the
          tabs row from there, with the six tab labels 34 apart. */}
      <SavedTVTabs destination={tabsDestination} reportError={runtime.reportError} authority={authority} activation={activation} contentRegionId={ids.savedGrid}/>
      {directoryView ? <View style={{height: 860, paddingTop: 12}}>
        <SavedTVDirectory view={directoryView} destination={controller.source(directoryView)} runtime={runtime} libraries={runtime.getSnapshot().libraries}
          enabled={active.visible} regionId={ids.savedGrid} edges={{up: ids.savedTabs, left: ids.rail}} select={route => {if (route.view === 'playlists') run(controller.select('playlists', {sort: route.sort, direction: route.direction, filter: route.filter}));}}
          openPlaylist={card => openSaved({view: 'playlist', playlistId: card.id})} openResource={value => openSaved({view: 'resource', resourceId: value.id})}/>
      </View> : <FocusRegion id={ids.savedGrid} enabled={active.visible} orientation="vertical" edges={{up: ids.savedTabs, left: ids.rail}}>
      <View style={{flexDirection: 'row', alignItems: 'center', gap: 14, paddingLeft: theme.gutter, paddingRight: theme.layout.gutter.tvRight, paddingTop: 24}}>
        {tab !== 'history' ? <>
          <Button focusId="saved-sort" ref={sortAnchor} variant="glass" icon="i-sort" size="compact" onPress={() => setSortOpen(true)} accessibilityLabel={t('saved.sort')}>{t(sortLabel)}</Button>
          <Button focusId="saved-filter" ref={filterAnchor} variant="glass" icon="i-filter" size="compact" onPress={() => setFilterOpen(true)} accessibilityLabel={t('filter.title')}>{t('filter.title')}</Button>
          <View style={{width: 1.5, height: 40, backgroundColor: theme.colors.line, marginHorizontal: 6}}/>
          {quickFilters.length
            ? quickFilters.map(option => <Chip focusId={`saved-filter-${option.id}`} key={option.id} selected={filter === option.id}
              onPress={() => {const next = filter === option.id ? 'all' as const : option.id as SavedListFilter; setFilter(next); run(controller.select(tab, {sort, filter: next, period}));}}>{option.label}</Chip>)
            : filters.filter(value => value.id !== 'all').map(value => <Chip focusId={`saved-filter-${value.id}`} key={value.id} selected={filter === value.id}
              onPress={() => {const next = filter === value.id ? 'all' as const : value.id; setFilter(next); run(controller.select(tab, {sort, filter: next, period}));}}>{t(value.label)}</Chip>)}
        </> : <>
          <Button variant="glass" icon="i-sort" size="compact" disabled accessibilityLabel={t('saved.sort')}>{t('web.saved.sort.recent')}</Button>
          {periods.map(value => <Chip focusId={`saved-period-${value}`} key={value} selected={period === value} onPress={() => {setPeriod(value); run(controller.select(tab, {sort, filter, period: value}));}}>
            {value === '30d' || value === '90d' ? t('web.saved.days', {count: value === '30d' ? 30 : 90}) : t(periodLabel[value])}
          </Chip>)}
          <Button focusId="saved-clear-history" variant="glass" icon="i-trash" size="compact" style={{marginLeft: 'auto'}} onPress={() => setClearOpen(true)}>{t('web.saved.clearHistory')}</Button>
        </>}
        <Text style={[browseType(theme, 22), {marginLeft: tab === 'history' ? 0 : 'auto', color: theme.colors.textTertiary}]}>{t('count.titles', {count})}</Text>
      </View>
      <View style={{paddingLeft: theme.gutter, paddingRight: theme.layout.gutter.tvRight, paddingTop: 38, minHeight: 520}}>{body}</View>
      </FocusRegion>}
    </ScrollView>
    <Menu open={sortOpen} onOpenChange={setSortOpen} anchorRef={sortAnchor} title={t('saved.sort')} placement="bottom-start" items={sorts.map(value => ({id: value.id, label: t(value.label), selected: value.id === sort,
      onSelect: () => {setSort(value.id); run(controller.select(tab, {sort: value.id, filter, period}));}}))}/>
    <Menu open={filterOpen} onOpenChange={setFilterOpen} anchorRef={filterAnchor} title={t('filter.title')} placement="bottom-start" items={publishedFilters.length
      ? publishedFilters.map(option => ({id: option.id, label: option.label, trailing: defaultI18n.number(option.count), selected: option.id === filter,
        onSelect: () => {setFilter(option.id as SavedListFilter); run(controller.select(tab, {sort, filter: option.id as SavedListFilter, period}));}}))
      : filters.map(value => ({id: value.id, label: t(value.label), selected: value.id === filter,
        onSelect: () => {setFilter(value.id); run(controller.select(tab, {sort, filter: value.id, period}));}}))}/>
    <Dialog open={clearOpen} onOpenChange={setClearOpen} title={t('web.saved.clearHistoryTitle')} description={t('web.saved.clearHistoryBody')}
      footer={<><Button variant="glass" onPress={() => setClearOpen(false)}>{t('action.cancel')}</Button><Button variant="primary" onPress={() => {setClearOpen(false); run(controller.clearHistory(period));}}>{t('web.saved.clearHistoryAction')}</Button></>}><View/></Dialog>
    {selection?.render()}
  </View>;
}
