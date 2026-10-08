import React, {useCallback, useEffect, useMemo, useRef, useState} from 'react';
import {View, type RefreshControlProps} from 'react-native';
import type {RouteProp} from '@react-navigation/native';
import type {ContentEntry, ContentRoute, ContentSection, ContentSeeAll, ContentView} from '../../../../packages/client-core/src/library-content';
import {useContent} from '../app/content';
import {useLibraryScan} from '../app/library-scan';
import {useLibrariesContext} from '../app/libraries-context';
import type {ContentStackParams} from '../app/routes';
import {useSession} from '../app/session';
import {PersonalSavedService} from '../../../../packages/client-core/src/personal-saved';
import {viewerScope} from '../app/content';
import {requestId} from '../app/detail';
import {useNavigation} from '@react-navigation/native';
import type {NativeStackNavigationProp} from '@react-navigation/native-stack';
import {mediaFamilyIcon} from '../../../../packages/design/src/index';
import {Button, Dropdown, ListRow, Notice, Page, PageHeader, Skeleton, StateView, Tabs, WindowedGrid, useTheme, type DropdownAnchor, type IconName, type WindowedGridHandle} from '../ui';
import {RootHeaderActions, SectionView, useSectionCards} from './Home';
import {GenreCard, LibraryPlaylists} from './LibraryTabs';
import {genreFilter, libraryTab, libraryTabForPivot, libraryTabs, type LibraryTab, type LibraryTabId} from '../../../../packages/client-core/src/presentation/index';
import {captionFor, formatClock} from '../app/content';
import {usePlayerActions, usePlayingItemId} from '../app/player-actions';
import type {BrowseSortSelection} from '../../../../packages/client-core/src/browse';
import {useBrowseCapabilities, useBrowseWindow, type Predicate} from '../app/browse';
import {AlphabetRail, BrowseBar} from './BrowseFilters';
import {say} from '../app/errors';
import {useI18n} from '../app/i18n';
import {usePullToRefresh} from '../app/refresh';
import type {I18n} from '../app/i18n';
import {RowGuide} from './title/RowGuide';
import {withoutNotInterested} from '../app/not-interested';
import {useTurnedDown} from '../app/not-interested-hook';
import {isRecommendationRow} from '../../../../packages/client-core/src/recommendation-feedback';

type Tab = LibraryTabId;
const fallbackSort: BrowseSortSelection = {field: 'title', direction: 'asc'};

const knownSorts = ['title', 'added', 'year', 'duration', 'last_played', 'rating', 'episode', 'track', 'artist', 'album', 'author', 'release', 'random'];
const sortLabel = (i18n: I18n, key: string): string => {
  const id = key.replace(/^sort\./, '');
  return knownSorts.includes(id) ? i18n.t('lib.sortField', {field: id}) : id.charAt(0).toUpperCase() + id.slice(1).replace(/_/g, ' ');
};

/**
 * One library. Its tabs are authored in client-core (`library-tabs.ts`): Discover first, then the
 * kind's own. Discover reads the server's rows; every other tab reads the browse engine, except
 * Playlists (the viewer's own).
 */
export function LibraryScreen({route}: {route: RouteProp<ContentStackParams, 'Library'>}) {
  const {libraryId, tab: initialTab, category, genre} = route.params;
  const {items: libraries} = useLibrariesContext();
  const library = libraries.find(l => l.id === libraryId);
  const session = useSession();
  const {system} = session;
  const {space, isTV} = useTheme();
  const i18n = useI18n();
  const turnedDown = useTurnedDown();
  const navigation = useNavigation<NativeStackNavigationProp<ContentStackParams>>();
  const [capabilityAttempt, setCapabilityAttempt] = useState(0);
  const [switcher, setSwitcher] = useState<DropdownAnchor>();
  const [tab, setTab] = useState<Tab>(initialTab ?? 'discover');
  const [sort, setSort] = useState<{sort?: string; direction?: 'asc' | 'desc'}>({});
  const [published, setPublished] = useState<ContentSeeAll | null>(null);
  useEffect(() => {
    setTab(initialTab ?? 'discover');
    setSort({});
    setPublished(null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [initialTab, libraryId]);
  const kind = library?.kind ?? '';
  const owner = session.session?.viewer.role === 'owner';
  const tabOptions = useMemo(() => ({owner, unmatched: true}), [owner]);
  const active: LibraryTab = libraryTab(kind, tab, tabOptions);
  const playlists = active.shows === 'playlists';
  const pivot = library && !playlists ? active.pivot : undefined;
  const engine = !!pivot && !category;
  const content: ContentRoute = useMemo(() => (playlists ? {libraryId, view: 'discover'} : {libraryId, view: tab as ContentView, ...(category ? {category} : {}), ...sort}), [libraryId, tab, playlists, category, sort]);
  const {snapshot, retry, refresh, next} = useContent(engine ? {libraryId, view: 'discover'} : content);
  const {capabilities, error: capabilityError} = useBrowseCapabilities(engine ? libraryId : undefined, pivot, capabilityAttempt);
  const [chosen, setPredicates] = useState<readonly Predicate[]>([]);
  // A tab's own conditions (Unmatched) come before the viewer's and are not shown as chips.
  const predicates = useMemo(() => (active.fixedFilter ? [...(active.fixedFilter as readonly Predicate[]), ...chosen] : chosen), [active.fixedFilter, chosen]);
  // The filter bar can edit flat predicates; a published See all keeps the complete expression.
  const pendingPredicates = useRef<readonly Predicate[] | null>(null);
  useEffect(() => { setPredicates(pendingPredicates.current ?? []); pendingPredicates.current = null; }, [libraryId, tab]);
  // A genre pressed on a title page opens the grid filtered to it; the bar shows it as an applied filter like any other.
  useEffect(() => {
    if (!genre) return;
    const mine = [genreFilter(genre) as Predicate];
    pendingPredicates.current = mine;
    setTab('browse');
    setPredicates(mine);
  }, [genre, libraryId]);
  const seeAll = (section: ContentSection) => {
    const own = section.seeAll;
    const target = own ? libraryTabForPivot(kind, own.pivot)?.id : undefined;
    if (!own || !target) return;
    setPublished(own);
    pendingPredicates.current = [];
    if (target === tab) { setPredicates([]); pendingPredicates.current = null; }
    else setTab(target);
  };
  const engineSort = useMemo<BrowseSortSelection>(() => {
    if (active.fixedSort) return active.fixedSort;
    const picked = sort.sort ? capabilities?.sorts.find(x => x.id === sort.sort) : undefined;
    if (sort.sort && picked) return {field: sort.sort, direction: sort.direction ?? picked.defaultDirection};
    return capabilities?.resolvedPivot?.defaultSort[0] ?? fallbackSort;
  }, [sort.sort, sort.direction, capabilities, active.fixedSort]);
  // A genre opens the tab it groups (Albums), filtered to it.
  const openGroup = useCallback((entry: ContentEntry) => {
    const opens = active.opens;
    if (!opens) return;
    setPublished(null);
    pendingPredicates.current = [{field: opens.field, operator: 'in', value: [entry.title]} as Predicate];
    setTab(opens.tab);
  }, [active.opens]);
  // Names the current filters and sort as a saved view; the server reruns it whenever it is opened.
  const saveView = useCallback(async (name: string) => {
    if (!pivot) return;
    const service = new PersonalSavedService(session.api, viewerScope(session.session, session.api), requestId);
    try {
      await service.select({view: 'views'});
      await service.mutate({action: 'create', kind: 'view', name, definition: {libraryId, pivot, query: predicates.length ? {all: predicates} : null, sort: [engineSort], presentation: 'grid'}});
    } finally { service.dispose(); }
  }, [session.api, session.session, libraryId, pivot, predicates, engineSort]);
  const browse = useBrowseWindow({libraryId, pivot, predicates, sort: engineSort, published: published && published.pivot === pivot ? published : undefined, enabled: engine && !!capabilities});
  const projection = snapshot.projection;
  const tabs = useMemo(() => libraryTabs(kind, tabOptions).map(item => ({id: item.id, label: i18n.t(item.label)})), [kind, tabOptions, i18n]);
  const sorts = projection?.sorts ?? [];
  // APL-SYS-07: pull to refresh on touch; on TV it refreshes itself when it has gone stale.
  const pull = usePullToRefresh(engine ? () => browse.list?.invalidate() : refresh, {auto: !engine});
  // ONB-04: the header and empty state reflect the running scan, if any.
  const scope = useMemo(() => viewerScope(session.session, session.api), [session.session, session.api]);
  const scan = useLibraryScan(session.api, scope.serverId, libraryId);
  // MU2: when a scan finishes, refresh once so the titles that arrived appear.
  const finishedSeen = useRef<number | undefined>(undefined);
  useEffect(() => {
    if (finishedSeen.current === undefined) {
      finishedSeen.current = scan.finished;
      return;
    }
    if (scan.finished === finishedSeen.current) return;
    finishedSeen.current = scan.finished;
    if (engine) browse.list?.invalidate();
    else refresh();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [scan.finished]);
  const titleBlock = <PageHeader eyebrow={isTV && engine && browse.snapshot.total !== undefined ? [system?.name, i18n.t('lib.count', {count: browse.snapshot.total, pivot: capabilities?.resolvedPivot?.id ?? pivot ?? ''})].filter(Boolean).join(' · ') : system?.name} title={library?.name ?? projection?.heading.fallback ?? i18n.t('lib.fallbackTitle')} subtitle={scan.scanning ? i18n.t('web.library.scanning', {count: i18n.number(scan.found)}) : undefined} onTitlePress={!isTV && libraries.length > 1 ? setSwitcher : undefined} actions={<RootHeaderActions />} />;
  const tabStrip = <Tabs items={tabs} selected={tab} onSelect={id => { setPublished(null); setTab(id as Tab); }} entryFocus={false} />;
  const header = (
    <>
      {titleBlock}
      <View>
        {/* TV: the guide hands focus to a tab (never to itself), so the strip always shows where focus is. */}
        <RowGuide>{tabStrip}</RowGuide>
      </View>
    </>
  );
  const switcherMenu = <Dropdown open={!!switcher} anchor={switcher} onClose={() => setSwitcher(undefined)} items={libraries.map(l => ({id: l.id, label: l.name, icon: (mediaFamilyIcon(l.kind) ?? 'film') as IconName, selected: l.id === libraryId}))} onSelect={id => navigation.setParams({libraryId: id, tab: undefined, category: undefined})} />;
  if (engine) {
    return (
      <View style={{flex: 1}}>
        <EngineResults
          libraryId={libraryId}
          libraryKind={library?.kind ?? ''}
          window={browse}
          renderHeader={jumpTo => (isTV ? (
            // Television: two rows. The title, then one row with the tabs, Sort, Filter and Jump to,
            // so the tabs are one Up from the grid and nothing sits between the header and the cards.
            <>
              {titleBlock}
              <RowGuide>
                <View style={{flexDirection: 'row', alignItems: 'center', gap: space.md, paddingRight: space.page, marginBottom: space.lg}}>
                  <View style={{flex: 1, minWidth: 0}}>{tabStrip}</View>
                  {published?.pivot === pivot ? <Button size="sm" variant="secondary" label={i18n.t('library.clearFilters')} onPress={() => setPublished(null)} /> : capabilities && active.shows !== 'genres' ? <BrowseBar inline trailing={jumpTo} owner={owner} fixedSort={!!active.fixedSort} libraryId={libraryId} capabilities={capabilities} predicates={chosen} onChange={setPredicates} sort={engineSort} onSort={next => setSort({sort: next.field, direction: next.direction})} /> : jumpTo}
                </View>
              </RowGuide>
              {capabilityError ? <Notice tone="error" title={i18n.t('lib.optionsLoadFailed')} message={capabilityError} action={i18n.t('action.tryAgain')} onAction={() => setCapabilityAttempt(n => n + 1)} style={{marginHorizontal: space.page, marginBottom: space.lg}} /> : null}
            </>
          ) : (
            <>
              {header}
              {published?.pivot === pivot ? <View style={{paddingHorizontal: space.page, paddingVertical: space.md}}><Button variant="secondary" label={i18n.t('library.clearFilters')} onPress={() => setPublished(null)} /></View> : capabilities && active.shows !== 'genres' ? <BrowseBar owner={owner} fixedSort={!!active.fixedSort} libraryId={libraryId} capabilities={capabilities} predicates={chosen} onChange={setPredicates} sort={engineSort} onSort={next => setSort({sort: next.field, direction: next.direction})} total={browse.snapshot.total} onSaveView={saveView} /> : <View style={{height: space.lg}} />}
              {capabilityError ? <Notice tone="error" title={i18n.t('lib.optionsLoadFailed')} message={capabilityError} action={i18n.t('action.tryAgain')} onAction={() => setCapabilityAttempt(n => n + 1)} style={{marginHorizontal: space.page, marginBottom: space.lg}} /> : null}
            </>
          ))}
          sortField={published?.pivot === pivot ? published.sort[0]?.field ?? engineSort.field : engineSort.field}
          filtered={!!(published?.pivot === pivot && published.query) || chosen.length > 0}
          tab={active}
          onOpenGroup={active.opens ? openGroup : undefined}
          onClearFilters={() => { setPublished(null); setPredicates([]); }}
          pivot={pivot ?? ''}
          refreshControl={pull}
          blocked={!!capabilityError && !capabilities}
          scanning={scan.scanning}
          owner={owner}
        />
        {switcherMenu}
      </View>
    );
  }
  return (
    <View style={{flex: 1}}>
      <Page stickyHeaderIndices={isTV ? undefined : [1]} refreshControl={pull}>
        {header.props.children}
        {playlists ? <LibraryPlaylists /> : null}
        {!playlists && tab === 'browse' && sorts.length ? (
          <View style={{flexDirection: 'row', flexWrap: 'wrap', gap: space.sm, paddingHorizontal: space.page, paddingVertical: space.md}}>
            {sorts.map(s => {
              const active = (projection?.query.sort ?? sorts[0]?.id) === s.id;
              const direction = active ? projection?.query.direction : undefined;
              return <Button key={s.id} size="sm" variant="secondary" selected={active} label={sortLabel(i18n, s.labelKey)} trailingIcon={active ? (direction === 'desc' ? 'chevronDown' : 'chevronUp') : undefined} onPress={() => setSort({sort: s.id, direction: active && direction === 'asc' ? 'desc' : 'asc'})} />;
            })}
          </View>
        ) : (
          <View style={{height: space.lg}} />
        )}
        {playlists ? null : snapshot.phase === 'loading' && !snapshot.sections.length ? (
          <LoadingGrid />
        ) : snapshot.phase === 'error' && !snapshot.sections.length ? (
          <StateView icon="error" title={i18n.t('lib.loadFailed')} message={say(snapshot.error, 'library', 'load')} action={i18n.t('action.tryAgain')} onAction={retry} />
        ) : snapshot.phase === 'refresh-required' ? (
          <Notice tone="warning" message={say(snapshot.error ?? 'stale', 'library', 'load')} action={i18n.t('action.refresh')} onAction={refresh} style={{marginHorizontal: space.page, marginBottom: space.lg}} />
        ) : null}
        {(playlists ? [] : snapshot.sections).map((raw, index) => {
          // P5: Discover's recommendation rows offer Not interested and drop a card turned down.
          const recommendation = tab === 'discover' && isRecommendationRow(raw);
          const section = recommendation ? withoutNotInterested(raw, turnedDown, true) : raw;
          // TV: the first section's first card is the screen's entry focus (not the rail).
          return <SectionView key={section.id} row={index} entryFocus={index === 0} origin={recommendation ? 'recommendation' : undefined} section={section} libraryId={libraryId} hideTitle={tab === 'browse' && snapshot.sections.length === 1} loadingMore={snapshot.phase === 'loading'} onMore={section.nextCursor ? () => next(section.id) : undefined} onSeeAll={section.type === 'rail' && section.seeAll && libraryTabForPivot(kind, section.seeAll.pivot) ? () => seeAll(section) : undefined} />;
        })}
        {!playlists && snapshot.phase === 'ready' && !snapshot.sections.length ? <StateView icon={(mediaFamilyIcon(library?.kind ?? '') ?? 'film') as IconName} title={scan.scanning ? i18n.t('web.library.scanningTitle') : (projection?.empty?.fallback ?? i18n.t('library.emptyLibrary'))} message={scan.scanning ? i18n.t('web.library.scanningBody') : i18n.t(owner ? 'web.empty.libraryOwnerBody' : 'web.empty.libraryMemberBody')} /> : null}
      </Page>
      {switcherMenu}
    </View>
  );
}

function LoadingGrid() {
  const {space, metrics, window} = useTheme();
  const columns = Math.max(2, Math.floor((window.width - space.page * 2) / (metrics.posterWidth + space.gutter)));
  return (
    <View style={{paddingHorizontal: space.page, flexDirection: 'row', flexWrap: 'wrap', gap: space.gutter}}>
      {Array.from({length: columns * 2}).map((_, i) => (
        <Skeleton key={i} width={metrics.posterWidth} height={metrics.posterWidth * 1.5} />
      ))}
    </View>
  );
}

/** The space the phone's letter rail takes beside the grid. */
const RAIL_WIDTH = 22;

function EngineResults({window: {list, snapshot}, renderHeader, sortField, libraryId, libraryKind, filtered, onClearFilters, pivot, refreshControl, blocked, scanning, tab, onOpenGroup, owner = false}: {/** The owner's empty library says where a scan starts; a member's says who adds media. */ owner?: boolean; /** The tab drawn: its entries are titles (cards), tracks (rows) or groups (genre cards). */ tab: LibraryTab; onOpenGroup?: (entry: ContentEntry) => void; libraryId: string; libraryKind: string; window: ReturnType<typeof useBrowseWindow>; /** The header, given the television Jump to control (or nothing) to place in its row. */ renderHeader: (jumpTo: React.ReactNode) => React.ReactElement; sortField: string; filtered: boolean; onClearFilters: () => void; pivot: string; refreshControl?: React.ReactElement<RefreshControlProps>; /** The library's filters couldn't load, so no results are coming: no skeleton (the header says why). */ blocked?: boolean; /** A scan is running: the empty state says so instead of "Nothing here". */ scanning?: boolean}) {
  const i18n = useI18n();
  const {space, isTV, metrics, window} = useTheme();
  const playing = usePlayingItemId();
  const player = usePlayerActions();
  const grid = useRef<WindowedGridHandle>(null);
  const [letter, setLetter] = useState<string>();
  useEffect(() => setLetter(undefined), [snapshot.generation]);
  const anchors = useMemo(() => Object.entries(snapshot.positionIndex ?? {}).map(([key, index]) => ({key, index})).sort((a, b) => a.index - b.index), [snapshot.positionIndex]);
  const first = list?.slotAt(0);
  const firstEntry = first?.kind === 'item' ? first.item : undefined;
  const {width, renderCard, shape, open, artwork} = useSectionCards(firstEntry ? [firstEntry] : [], libraryId, true);
  const tracks = tab.shows === 'tracks';
  const groups = tab.shows === 'genres';
  // Songs are rows (cover, title, artist and album, length); a tap plays the song, a long press has the rest.
  // A song plays on through the list in the order shown: the songs already loaded after it are the queue (bounded; nothing is fetched to build it).
  const playFrom = useCallback((index: number) => {
    if (!list) return;
    const queue: ContentEntry[] = [];
    for (let i = index; i < index + 200; i++) { const slot = list.slotAt(i); if (slot.kind !== 'item') break; if (slot.item.playback) queue.push(slot.item); }
    if (queue.length) player.playSequence(queue, 0, 0);
  }, [list, player]);
  const renderTrack = useCallback((entry: ContentEntry, _width: number, index: number) => (
    <ListRow title={entry.title} subtitle={[entry.artist?.name ?? captionFor(entry), entry.album?.name].filter(Boolean).join(' · ')} meta={entry.duration ? formatClock(entry.duration) : undefined} source={artwork(entry.posterUrl ?? entry.backdropUrl)} shape="square" selected={playing === entry.id} onPress={() => (entry.playback ? playFrom(index) : open(entry, 'open', libraryId))} onLongPress={() => open(entry, 'more', libraryId)} />
  ), [artwork, open, libraryId, playing, playFrom]);
  const renderGroup = useCallback((entry: ContentEntry, w?: number) => <GenreCard libraryId={libraryId} entry={entry} width={w} onPress={() => onOpenGroup?.(entry)} />, [libraryId, onOpenGroup]);
  const aspect = tracks ? 64 / Math.max(1, window.width) : groups ? 1 : shape === 'landscape' ? 9 / 16 : shape === 'square' || shape === 'circle' ? 1 : 1.5;
  const jump = (key: string) => {
    const index = list?.indexOfLetter(key) ?? anchors.find(a => a.key === key)?.index;
    if (index === undefined) return;
    setLetter(key);
    grid.current?.scrollToIndex(index);
  };
  const failed = snapshot.status === 'error';
  const empty = snapshot.total === 0 && snapshot.status === 'ready';
  // M20 + W1: the rail follows anchor presence for default browsing (behind
  // presence for older servers), not the sort. An ad hoc query has no anchors
  // and never shows the rail.
  // On TV the anchors ride the existing Jump-to pattern in the same place.
  // For you ranks by taste: it has no letters to jump to.
  const rail = anchors.length > 0 && !filtered && sortField === 'title' && !tab.fixedSort && !groups;
  const top = (
    <>
      {/* The letter rail narrows the grid, not the page header: the header keeps the screen's full width so its buttons do not move between tabs. */}
      <View style={{marginRight: rail && !isTV ? -RAIL_WIDTH : 0}}>{renderHeader(rail && isTV ? <AlphabetRail index={anchors} current={letter} sortField={sortField} onJump={jump} /> : null)}</View>
      {failed && snapshot.total ? <Notice tone="warning" message={say(snapshot.error, 'library', 'load')} action={i18n.t('action.tryAgain')} onAction={() => list?.retry()} style={{marginHorizontal: space.page, marginBottom: space.md}} /> : null}
    </>
  );
  const footer = blocked && !list ? null
    : !list || (snapshot.status === 'loading' && snapshot.total === undefined) ? <LoadingGrid />
    : failed && !snapshot.total ? <StateView icon="error" title={i18n.t('lib.viewLoadFailed')} message={say(snapshot.error, 'library', 'load')} action={i18n.t('action.tryAgain')} onAction={() => list.retry()} />
    // APL-LIB-02: "No titles match" only when filters are on; otherwise the pivot's own empty state.
    : empty ? (filtered ? <StateView icon="filter" title={i18n.t('library.noMatch')} message={i18n.t('library.noMatchBody')} action={i18n.t('library.clearFilters')} onAction={onClearFilters} /> : scanning ? <StateView icon={(mediaFamilyIcon(libraryKind) ?? 'film') as IconName} title={i18n.t('web.library.scanningTitle')} message={i18n.t('web.library.scanningBody')} /> : pivot === 'collections' ? <StateView icon="collection" title={i18n.t('library.emptyCollections')} message={i18n.t('library.emptyCollectionsBody')} /> : groups ? <StateView icon="category" title={i18n.t('library.genres.empty')} message={i18n.t('library.genres.emptyBody')} /> : pivot === 'series' ? <StateView icon="collection" title={i18n.t('library.emptySeries')} message={i18n.t('library.emptySeriesBody')} /> : <StateView icon={(mediaFamilyIcon(libraryKind) ?? 'film') as IconName} title={i18n.t('library.emptyLibrary')} message={i18n.t(owner ? 'web.empty.libraryOwnerBody' : 'web.empty.libraryMemberBody')} />)
    : null;
  return (
    <View style={{flex: 1, paddingRight: rail && !isTV ? RAIL_WIDTH : 0}}>
      {list ? (
        <WindowedGrid ref={grid} list={list} total={snapshot.total} itemWidth={tracks ? window.width : groups ? metrics.squareWidth : width || metrics.posterWidth} aspect={aspect} renderItem={tracks ? renderTrack : groups ? renderGroup : renderCard} header={top} footer={footer} generation={snapshot.generation} refreshControl={refreshControl} />
      ) : (
        <Page refreshControl={refreshControl}>{top}{footer}</Page>
      )}
      {rail && !isTV ? <AlphabetRail index={anchors} current={letter} sortField={sortField} onJump={jump} /> : null}
    </View>
  );
}
