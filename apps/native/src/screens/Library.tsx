import {offeredBrowseSort} from '../app/browse-options';
import {viewSequence, type SequenceContainer} from '../app/container-play';
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
import {Button, Dropdown, FocusGroup, FocusScopeContext, ListRow, Notice, Page, PageHeader, Skeleton, StateView, Tabs, WindowedGrid, cardFocusKey, focusReturn, useFocusResolver, useTheme, type DropdownAnchor, type FocusResolver, type IconName, type WindowedGridHandle} from '../ui';
import {windowLanding, windowResolver} from '../ui/focus-lists';
import {LoadingShelves, RootHeaderActions, SectionView, useSectionCards} from './Home';
import {BrowsePreviewContext, BrowseStage, LibraryStrip, useBrowsePreview, useStageLayout, useStageTop, useStripHeight} from './BrowseStage';
import {GenreCard, LibraryPlaylists} from './LibraryTabs';
import {categoryDestination, genreFilter, isContinueRow, libraryTab, libraryTabForPivot, libraryTabs, type LibraryTab, type LibraryTabId} from '../../../../packages/client-core/src/presentation/index';
import {captionFor, formatClock} from '../app/content';
import {usePlayerActions, usePlayingItemId} from '../app/player-actions';
import type {BrowseSortSelection} from '../../../../packages/client-core/src/browse';
import {useBrowseCapabilities, useBrowseWindow, type Predicate} from '../app/browse';
import {useLibraryMemory} from '../app/library-memory';
import {linkedView, offeredFilters, openingView, tabView, type LibraryView} from '../app/library-view';
import {AlphabetRail, BrowseBar, LetterRail} from './BrowseFilters';
import {say} from '../app/errors';
import {useQuietRefresh} from '../app/quiet-refresh';
import {useI18n} from '../app/i18n';
import {usePullToRefresh} from '../app/refresh';
import type {I18n} from '../app/i18n';
import {RowGuide} from './title/RowGuide';
import {withoutNotInterested} from '../app/not-interested';
import {useTurnedDown} from '../app/not-interested-hook';
import {isRecommendationRow} from '../../../../packages/client-core/src/recommendation-feedback';

type Tab = LibraryTabId;

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
  const {libraryId, tab: initialTab, category: linkedCategory, genre} = route.params;
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
  const kind = library?.kind ?? '';
  // A category link (a genre, a decade, a studio, a series) is the tab that lists its titles with
  // the category as one ordinary filter, so it has every sort and filter the tab has. A category
  // this app does not know keeps the server's own page for it.
  const group = useMemo(() => (linkedCategory && kind ? categoryDestination(kind, linkedCategory) : undefined), [linkedCategory, kind]);
  const category = group || (linkedCategory && !kind) ? undefined : linkedCategory;
  const owner = session.session?.viewer.role === 'owner';
  const tabOptions = useMemo(() => ({owner, unmatched: true}), [owner]);
  // A library opened plainly comes back on the tab this profile last used here, with that tab's
  // last sort and filters. A link that names a tab, a category or a genre is shown as it is and
  // changes nothing that is remembered.
  const {memory, ready: memoryReady} = useLibraryMemory();
  const opening = useCallback((): LibraryView<Tab> => (group ? linkedView<Tab>(group.tab, [group.predicate]) : openingView<Tab>({tab: initialTab, category: linkedCategory, genre}, kind ? memory.recall(libraryId) : undefined, libraryTabs(kind, tabOptions).map(item => item.id), 'discover')),
    [initialTab, linkedCategory, group, genre, kind, memory, libraryId, tabOptions]);
  const [view, setView] = useState<LibraryView<Tab>>(opening);
  const [published, setPublished] = useState<ContentSeeAll | null>(null);
  // Once the person has chosen something here, what was remembered no longer decides the screen.
  const touched = useRef(false);
  const arrived = useRef(`${libraryId}\n${initialTab ?? ''}\n${linkedCategory ?? ''}`);
  useEffect(() => {
    const place = `${libraryId}\n${initialTab ?? ''}\n${linkedCategory ?? ''}`;
    if (arrived.current !== place) { arrived.current = place; touched.current = false; setPublished(null); }
    // The saved choices and the library's kind can arrive a moment after the screen: they still decide how it opens.
    // An opening that says what is already on screen changes nothing (no redraw, nothing asked again).
    if (!touched.current && !genre) { const next = opening(); setView(current => (JSON.stringify(current) === JSON.stringify(next) ? current : next)); }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [initialTab, linkedCategory, libraryId, kind, memoryReady, memory]);
  const {tab, sort} = view;
  const setPredicates = useCallback((next: readonly Predicate[]) => setView(current => ({...current, filters: next, recalled: false})), []);
  const active: LibraryTab = libraryTab(kind, tab, tabOptions);
  const playlists = active.shows === 'playlists';
  const pivot = library && !playlists ? active.pivot : undefined;
  const engine = !!pivot && !category;
  const content: ContentRoute = useMemo(() => (playlists ? {libraryId, view: 'discover'} : {libraryId, view: tab as ContentView, ...(category ? {category} : {}), ...sort}), [libraryId, tab, playlists, category, sort]);
  const {snapshot, retry, refresh, next} = useContent(engine ? {libraryId, view: 'discover'} : content);
  // The server says the list changed under the screen: it is read again quietly, and only a list still refused says so.
  const changedStuck = useQuietRefresh(!engine && active.shows !== 'playlists' && snapshot.phase === 'refresh-required', refresh);
  // A tab of groups (Genres, Series) is a list of the library's own; titles narrowed to a group are that group's titles.
  const opens = active.opens;
  const {capabilities, error: capabilityError} = useBrowseCapabilities(engine ? libraryId : undefined, pivot, capabilityAttempt, !opens && (genre || view.filters.some(f => ['genre', 'series', 'decade', 'collection', 'memberOf'].includes(f.field))) ? 'group-titles' : 'library');
  // The viewer's own filters. A remembered one this library no longer offers is left out, not sent.
  const chosen = useMemo(() => offeredFilters(view, capabilities?.fields) as readonly Predicate[], [view, capabilities]);
  // A tab's own conditions (Unmatched) come before the viewer's and are not shown as chips.
  const predicates = useMemo(() => (active.fixedFilter ? [...(active.fixedFilter as readonly Predicate[]), ...chosen] : chosen), [active.fixedFilter, chosen]);
  // A genre pressed on a title page opens the grid filtered to it; the bar shows it as an applied filter like any other.
  useEffect(() => {
    if (!genre) return;
    setView(linkedView<Tab>('browse', [genreFilter(genre) as Predicate]));
  }, [genre, libraryId]);
  // The filter bar can edit flat predicates; a published See all keeps the complete expression.
  const seeAll = (section: ContentSection) => {
    const own = section.seeAll;
    const target = own ? libraryTabForPivot(kind, own.pivot)?.id : undefined;
    if (!own || !target) return;
    touched.current = true;
    setPublished(own);
    setView(linkedView<Tab>(target));
  };
  // What the person chooses on this screen is remembered for the next plain visit.
  const pickTab = (id: Tab) => {
    touched.current = true;
    setPublished(null);
    memory.rememberTab(libraryId, id);
    setView(tabView<Tab>(memory.recall(libraryId), id));
  };
  const pickFilters = (next: readonly Predicate[]) => {
    touched.current = true;
    memory.rememberTab(libraryId, tab);
    memory.rememberFilters(libraryId, tab, next);
    setPredicates(next);
  };
  const pickSort = (next: {sort: string; direction: 'asc' | 'desc'}) => {
    touched.current = true;
    memory.rememberTab(libraryId, tab);
    memory.rememberSort(libraryId, tab, {field: next.sort, direction: next.direction});
    setView(current => ({...current, sort: next}));
  };
  const engineSort = useMemo<BrowseSortSelection>(() => {
    const picked = sort.sort ? capabilities?.sorts.find(x => x.id === sort.sort) : undefined;
    // The viewer's choice for this tab; without one, the order the tab opens in (Recently aired:
    // the latest episode first), and failing that the server's own for the pivot.
    return offeredBrowseSort(capabilities, (sort.sort && picked ? {field: sort.sort, direction: sort.direction ?? picked.defaultDirection} : undefined) ?? active.defaultSort);
  }, [sort.sort, sort.direction, capabilities, active]);
  // A genre opens the tab it groups (Albums), filtered to it.
  const openGroup = useCallback((entry: ContentEntry) => {
    if (!opens) return;
    touched.current = true;
    setPublished(null);
    setView(linkedView<Tab>(opens.tab, [{field: opens.field, operator: 'in', value: [entry.title]} as Predicate]));
  }, [opens]);
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
  // The same list as the server's query, for a song pressed to play the whole list on from there.
  const listSequence = useMemo(() => viewSequence({libraryId, pivot, predicates, sort: engineSort, ...(published && published.pivot === pivot ? {query: published.query, sorts: published.sort} : {})}), [libraryId, pivot, predicates, engineSort, published]);
  const projection = snapshot.projection;
  const tabs = useMemo(() => libraryTabs(kind, tabOptions).map(item => ({id: item.id, label: i18n.t(item.label)})), [kind, tabOptions, i18n]);
  const sorts = projection?.sorts ?? [];
  // APL-SYS-07: pull to refresh on touch; on TV it refreshes itself when it has gone stale.
  const pull = usePullToRefresh(engine ? () => browse.list?.invalidate() : refresh);
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
  const titleBlock = <PageHeader eyebrow={system?.name} title={library?.name ?? projection?.heading.fallback ?? i18n.t('lib.fallbackTitle')} subtitle={scan.scanning ? i18n.t('web.library.scanning', {count: i18n.number(scan.found)}) : undefined} onTitlePress={!isTV && libraries.length > 1 ? setSwitcher : undefined} actions={<RootHeaderActions />} />;
  const tabStrip = <Tabs items={tabs} selected={tab} onSelect={id => pickTab(id as Tab)} entryFocus={false} />;
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
  // TV (Justin, 18 Oct 2026): the library's own navigation is one slim strip at the top, in the
  // same place on Discover and on every grid, apart from the preview's words; the rail stays the
  // way between libraries. Its tabs at the left, its name at the right (a running scan under it).
  const stripHeight = useStripHeight();
  const stageTop = useStageTop();
  const libraryName = library?.name ?? projection?.heading.fallback ?? i18n.t('lib.fallbackTitle');
  const tvTabs = <Tabs items={tabs} selected={tab} onSelect={id => pickTab(id as Tab)} entryFocus={false} inset={space.xs} />;
  const strip = () => (
    <RowGuide><LibraryStrip name={libraryName} status={scan.scanning ? i18n.t('web.library.scanning', {count: i18n.number(scan.found)}) : undefined} tabs={tvTabs} height={stripHeight} /></RowGuide>
  );
  // Discover on TV is the browsing stage: the focused card's preview above, its rows moved by focus
  // beneath. A Discover made only of grids or lists stays a page, with no preview.
  const sections = playlists ? NO_SECTIONS : snapshot.sections;
  const discoverStage = isTV && tab === 'discover' && !playlists && !engine && !category && !(snapshot.phase === 'ready' && sections.length > 0 && !sections.some(x => x.type === 'rail'));
  const shown = useMemo(() => sections.map(raw => (tab === 'discover' && isRecommendationRow(raw) ? withoutNotInterested(raw, turnedDown, true) : raw)), [sections, tab, turnedDown]);
  const preview = useBrowsePreview(`library\n${libraryId}\n${scope.serverId}\n${session.session?.viewer.accountId ?? ''}\n${session.session?.viewer.profileId ?? ''}`);
  const stage = useStageLayout(stripHeight);
  useEffect(() => {
    if (!discoverStage) return;
    const firstRow = shown.find(x => x.entries.length);
    const firstEntry = firstRow?.entries[0];
    const first = firstRow && firstEntry ? {entry: firstEntry, group: firstRow.id, resume: isContinueRow(firstRow.id) && !!firstEntry.playback} : undefined;
    if (!preview.getSnapshot().touched) preview.seed(first);
    else preview.reconcile((group, id) => shown.find(x => x.id === group)?.entries.find(e => e.id === id), first);
  }, [discoverStage, shown, preview]);
  if (engine) {
    return (
      <View style={{flex: 1}}>
        <EngineResults
          sequence={listSequence}
          libraryId={libraryId}
          libraryKind={library?.kind ?? ''}
          window={browse}
          // Television: the strip, then the grid's own row (Sort, the quick and promoted filters,
          // Filter, Save view and the count, as on the web), both staying put above the grid.
          renderStrip={isTV ? () => (
            <>
              {strip()}
              {published?.pivot === pivot ? <RowGuide><View style={{flexDirection: 'row', paddingHorizontal: space.page, paddingVertical: space.sm}}><Button size="sm" variant="secondary" label={i18n.t('library.clearFilters')} onPress={() => setPublished(null)} /></View></RowGuide>
                : capabilities ? <BrowseBar owner={owner} libraryId={libraryId} capabilities={capabilities} predicates={chosen} onChange={pickFilters} sort={engineSort} onSort={next => pickSort({sort: next.field, direction: next.direction})} total={browse.snapshot.total} totalIsLowerBound={browse.snapshot.totalIsLowerBound} onSaveView={opens ? undefined : saveView} /> : null}
            </>
          ) : undefined}
          renderHeader={() => (isTV ? (
            <>
              {capabilityError ? <Notice tone="error" title={i18n.t('lib.optionsLoadFailed')} message={capabilityError} action={i18n.t('action.tryAgain')} onAction={() => setCapabilityAttempt(n => n + 1)} style={{marginHorizontal: space.page, marginBottom: space.lg}} /> : null}
            </>
          ) : (
            <>
              {header}
              {published?.pivot === pivot ? <View style={{paddingHorizontal: space.page, paddingVertical: space.md}}><Button variant="secondary" label={i18n.t('library.clearFilters')} onPress={() => setPublished(null)} /></View> : capabilities ? <BrowseBar owner={owner} libraryId={libraryId} capabilities={capabilities} predicates={chosen} onChange={pickFilters} sort={engineSort} onSort={next => pickSort({sort: next.field, direction: next.direction})} total={browse.snapshot.total} totalIsLowerBound={browse.snapshot.totalIsLowerBound} onSaveView={opens ? undefined : saveView} /> : <View style={{height: space.lg}} />}
              {capabilityError ? <Notice tone="error" title={i18n.t('lib.optionsLoadFailed')} message={capabilityError} action={i18n.t('action.tryAgain')} onAction={() => setCapabilityAttempt(n => n + 1)} style={{marginHorizontal: space.page, marginBottom: space.lg}} /> : null}
            </>
          ))}
          sortField={published?.pivot === pivot ? published.sort[0]?.field ?? engineSort.field : engineSort.field}
          filtered={!!(published?.pivot === pivot && published.query) || chosen.length > 0}
          tab={active}
          onOpenGroup={opens ? openGroup : undefined}
          onClearFilters={() => { setPublished(null); pickFilters([]); }}
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
  if (discoverStage) {
    const loadingFirst = snapshot.phase === 'loading' && !sections.length;
    const body = loadingFirst ? <LoadingShelves />
      : snapshot.phase === 'error' && !sections.length ? <StateView icon="error" title={i18n.t('lib.loadFailed')} message={say(snapshot.error, 'library', 'load')} action={i18n.t('action.tryAgain')} onAction={retry} />
      : snapshot.phase === 'ready' && !sections.length ? <StateView icon={(mediaFamilyIcon(library?.kind ?? '') ?? 'film') as IconName} title={scan.scanning ? i18n.t('web.library.scanningTitle') : (projection?.empty?.fallback ?? i18n.t('library.emptyLibrary'))} message={scan.scanning ? i18n.t('web.library.scanningBody') : i18n.t(owner ? 'web.empty.libraryOwnerBody' : 'web.empty.libraryMemberBody')} />
      : !sections.length ? <LoadingShelves />
      : undefined;
    const notice = changedStuck ? <Notice tone="warning" message={say(snapshot.error ?? 'stale', 'library', 'load')} action={i18n.t('action.refresh')} onAction={refresh} style={{marginHorizontal: space.page, marginTop: space.sm}} /> : null;
    return (
      <BrowsePreviewContext.Provider value={preview}>
        <View style={{flex: 1}}>
          <BrowseStage
            store={preview}
            layout={stage}
            strip={strip()}
            stripHeight={stripHeight}
            identity={{title: libraryName}}
            loading={loadingFirst}
            notice={notice}
            rows={shown}
            keyExtractor={sectionKey}
            renderRow={({item: section, index}) => <SectionView row={index} entryFocus={index === 0} origin={tab === 'discover' && isRecommendationRow(section) ? 'recommendation' : undefined} section={section} libraryId={libraryId} loadingMore={snapshot.phase === 'loading'} onMore={section.nextCursor ? () => next(section.id) : undefined} onSeeAll={section.type === 'rail' && section.seeAll && libraryTabForPivot(kind, section.seeAll.pivot) ? () => seeAll(section) : undefined} />}
            body={body}
            focusRows={SECTION_FOCUS_ROWS}
            snaps={snapsRow}
          />
          {switcherMenu}
        </View>
      </BrowsePreviewContext.Provider>
    );
  }
  const pageBody = (
    <>
        {playlists ? <LibraryPlaylists /> : null}
        {!playlists && tab === 'browse' && sorts.length ? (
          <View style={{flexDirection: 'row', flexWrap: 'wrap', gap: space.sm, paddingHorizontal: space.page, paddingVertical: space.md}}>
            {sorts.map(s => {
              const active = (projection?.query.sort ?? sorts[0]?.id) === s.id;
              const direction = active ? projection?.query.direction : undefined;
              return <Button key={s.id} size="sm" variant="secondary" selected={active} label={sortLabel(i18n, s.labelKey)} trailingIcon={active ? (direction === 'desc' ? 'chevronDown' : 'chevronUp') : undefined} onPress={() => pickSort({sort: s.id, direction: active && direction === 'asc' ? 'desc' : 'asc'})} />;
            })}
          </View>
        ) : (
          <View style={{height: space.lg}} />
        )}
        {playlists ? null : snapshot.phase === 'loading' && !snapshot.sections.length ? (
          <LoadingGrid />
        ) : snapshot.phase === 'error' && !snapshot.sections.length ? (
          <StateView icon="error" title={i18n.t('lib.loadFailed')} message={say(snapshot.error, 'library', 'load')} action={i18n.t('action.tryAgain')} onAction={retry} />
        ) : changedStuck ? (
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
    </>
  );
  if (isTV) {
    // The strip stays put at the top; what is under it scrolls by focus, and Down from the strip
    // comes back to what was last used there.
    return (
      <View style={{flex: 1}}>
        <View style={{height: stageTop}} />
        {strip()}
        <FocusGroup style={{flex: 1}}><Page refreshControl={pull} contentStyle={{paddingTop: 0}}>{pageBody}</Page></FocusGroup>
        {switcherMenu}
      </View>
    );
  }
  return (
    <View style={{flex: 1}}>
      <Page stickyHeaderIndices={[1]} refreshControl={pull}>
        {header.props.children}
        {pageBody}
      </Page>
      {switcherMenu}
    </View>
  );
}

const NO_SECTIONS: readonly ContentSection[] = [];
const sectionKey = (section: ContentSection) => section.id;
/** Discover's rows for focus coming back after playback: a row is its section, numbered from 0. */
const SECTION_FOCUS_ROWS = {group: (section: ContentSection) => section.id, first: (section: ContentSection) => section.entries[0]?.id, base: 0} as const;
/** A row of cards comes to rest at the top of the stage; a grid or a list inside Discover scrolls as usual. */
const snapsRow = (section: ContentSection) => section.type === 'rail';

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
/** TV: the letter keys' column (ten-foot keys) and its gap from the grid. */
const useTvRail = () => { const {metrics, space} = useTheme(); return {width: metrics.controlSmall, gap: space.md}; };

function EngineResults({window: {list, snapshot}, renderHeader, renderStrip, sortField, libraryId, libraryKind, filtered, onClearFilters, pivot, refreshControl, blocked, scanning, tab, onOpenGroup, owner = false, sequence}: {/** The list as the server's query: a pressed song plays it whole on from there. */ sequence?: SequenceContainer; /** The owner's empty library says where a scan starts; a member's says who adds media. */ owner?: boolean; /** The tab drawn: its entries are titles (cards), tracks (rows) or groups (genre cards). */ tab: LibraryTab; onOpenGroup?: (entry: ContentEntry) => void; libraryId: string; libraryKind: string; window: ReturnType<typeof useBrowseWindow>; /** The header above the grid. */ renderHeader: () => React.ReactElement; /** TV: the library's strip and the grid's own row, pinned above the grid. */ renderStrip?: () => React.ReactNode; sortField: string; filtered: boolean; onClearFilters: () => void; pivot: string; refreshControl?: React.ReactElement<RefreshControlProps>; /** The library's filters couldn't load, so no results are coming: no skeleton (the header says why). */ blocked?: boolean; /** A scan is running: the empty state says so instead of "Nothing here". */ scanning?: boolean}) {
  const i18n = useI18n();
  const {space, isTV, metrics, window} = useTheme();
  const playing = usePlayingItemId();
  const player = usePlayerActions();
  const grid = useRef<WindowedGridHandle>(null);
  const [letter, setLetter] = useState<string>();
  // TV: the title a letter jumped to, where Left from the letters goes (once).
  const landing = useRef<number | undefined>(undefined);
  useEffect(() => { setLetter(undefined); landing.current = undefined; }, [snapshot.generation]);
  const anchors = useMemo(() => Object.entries(snapshot.positionIndex ?? {}).map(([key, index]) => ({key, index})).sort((a, b) => a.index - b.index), [snapshot.positionIndex]);
  const first = list?.slotAt(0);
  const firstEntry = first?.kind === 'item' ? first.item : undefined;
  const {width, renderCard, shape, open, artwork} = useSectionCards(firstEntry ? [firstEntry] : [], libraryId, true);
  const tracks = tab.shows === 'tracks';
  const groups = tab.shows === 'genres';
  // Songs are rows (cover, title, artist and album, length); a tap plays the song, a long press has the rest.
  // A song plays on through the list in the order shown: the whole list, from the server's query,
  // starting at the one pressed. Without the query, the songs already loaded after it are the queue
  // (bounded; nothing is fetched to build it).
  const playFrom = useCallback((index: number) => {
    if (!list) return;
    const pressed = list.slotAt(index);
    if (sequence && pressed.kind === 'item' && pressed.item.playback) { player.playSequence([pressed.item], 0, 0, sequence); return; }
    const queue: ContentEntry[] = [];
    for (let i = index; i < index + 200; i++) { const slot = list.slotAt(i); if (slot.kind !== 'item') break; if (slot.item.playback) queue.push(slot.item); }
    if (queue.length) player.playSequence(queue, 0, 0);
  }, [list, player, sequence]);
  const renderTrack = useCallback((entry: ContentEntry, _width: number, index: number) => (
    <ListRow focusKey={cardFocusKey('tracks', entry.id)} focusPlace={{column: index}} title={entry.title} subtitle={[entry.artist?.name ?? captionFor(entry), entry.album?.name].filter(Boolean).join(' · ')} meta={entry.duration ? formatClock(entry.duration) : undefined} source={artwork(entry.posterUrl ?? entry.backdropUrl)} shape="square" selected={playing === entry.id} onPress={() => (entry.playback ? playFrom(index) : open(entry, 'open', libraryId))} onLongPress={() => open(entry, 'more', libraryId)} />
  ), [artwork, open, libraryId, playing, playFrom]);
  const renderGroup = useCallback((entry: ContentEntry, w?: number) => <GenreCard libraryId={libraryId} entry={entry} width={w} onPress={() => onOpenGroup?.(entry)} />, [libraryId, onOpenGroup]);
  const aspect = tracks ? 64 / Math.max(1, window.width) : groups ? 1 : shape === 'landscape' ? 9 / 16 : shape === 'square' || shape === 'circle' ? 1 : 1.5;
  const jump = (key: string) => {
    const index = list?.indexOfLetter(key) ?? anchors.find(a => a.key === key)?.index;
    if (index === undefined) return;
    setLetter(key);
    landing.current = index;
    grid.current?.scrollToIndex(index);
  };
  const failed = snapshot.status === 'error';
  const empty = snapshot.total === 0 && snapshot.status === 'ready';
  // M20 + W1: the rail follows anchor presence for default browsing (behind
  // presence for older servers), not the sort. An ad hoc query has no anchors
  // and never shows the rail.
  // On TV the letters are a column of ten-foot keys down the grid's right (`LetterRail`).
  // For you ranks by taste: it has no letters to jump to.
  const rail = anchors.length > 0 && !filtered && sortField === 'title' && !groups;
  // TV: focus coming back after playback to a card or a song in the grid (`focus-lists.ts`). It is
  // found where it was, close by or in any page held; an unloaded place is read first; a title
  // that has gone hands over to the one now in its place (the last, when the list got shorter).
  const windowRef = useRef(list);
  windowRef.current = list;
  const totalRef = useRef(snapshot.total);
  totalRef.current = snapshot.total;
  const groupRef = useRef(tracks ? 'tracks' : groups ? undefined : 'cards');
  groupRef.current = tracks ? 'tracks' : groups ? undefined : 'cards';
  const gridResolver = useMemo<FocusResolver>(() => windowResolver<ContentEntry>({
    group: () => groupRef.current,
    list: () => windowRef.current,
    total: () => totalRef.current,
    keyOf: entry => entry.id,
    scrollTo: index => grid.current?.scrollToIndex(index),
  }), []);
  useFocusResolver(gridResolver);
  const stageTop = useStageTop();
  const tvRail = useTvRail();
  const scope = React.useContext(FocusScopeContext);
  // Left from the letters after a jump: the title jumped to (focus would otherwise go back to the
  // card last used, scrolled away by the jump), once its page has arrived and its card is drawn;
  // a key, the screen leaving or another viewer ends the wait. Without a jump the grid's own memory
  // decides. Asked a frame later, after whatever the same press did.
  const leaveLetters = () => {
    const index = landing.current;
    landing.current = undefined;
    if (index === undefined) return;
    const locate = windowLanding<ContentEntry>({list: () => windowRef.current, index, group: () => groupRef.current, keyOf: entry => entry.id, ensure: at => grid.current?.scrollToIndex(at)});
    requestAnimationFrame(() => focusReturn.follow(scope, locate));
  };
  const top = (
    <>
      {/* The letter rail narrows the grid, not the page header: the header keeps the screen's full width so its buttons do not move between tabs. */}
      <View style={{marginRight: rail && !isTV ? -RAIL_WIDTH : 0}}>{renderHeader()}</View>
      {failed && snapshot.total ? <Notice tone="warning" message={say(snapshot.error, 'library', 'load')} action={i18n.t('action.tryAgain')} onAction={() => list?.retry()} style={{marginHorizontal: space.page, marginBottom: space.md}} /> : null}
    </>
  );
  const footer = blocked && !list ? null
    : !list || (snapshot.status === 'loading' && snapshot.total === undefined) ? <LoadingGrid />
    : failed && !snapshot.total ? <StateView icon="error" title={i18n.t('lib.viewLoadFailed')} message={say(snapshot.error, 'library', 'load')} action={i18n.t('action.tryAgain')} onAction={() => list.retry()} />
    // APL-LIB-02: "No titles match" only when filters are on; otherwise the pivot's own empty state.
    : empty ? (filtered ? <StateView icon="filter" title={i18n.t('library.noMatch')} message={i18n.t('library.noMatchBody')} action={i18n.t('library.clearFilters')} onAction={onClearFilters} /> : scanning ? <StateView icon={(mediaFamilyIcon(libraryKind) ?? 'film') as IconName} title={i18n.t('web.library.scanningTitle')} message={i18n.t('web.library.scanningBody')} /> : pivot === 'collections' ? <StateView icon="collection" title={i18n.t('library.emptyCollections')} message={i18n.t('library.emptyCollectionsBody')} /> : groups ? <StateView icon="category" title={i18n.t('library.genres.empty')} message={i18n.t('library.genres.emptyBody')} /> : pivot === 'series' ? <StateView icon="collection" title={i18n.t('library.emptySeries')} message={i18n.t('library.emptySeriesBody')} /> : <StateView icon={(mediaFamilyIcon(libraryKind) ?? 'film') as IconName} title={i18n.t('library.emptyLibrary')} message={i18n.t(owner ? 'web.empty.libraryOwnerBody' : 'web.empty.libraryMemberBody')} />)
    : null;
  const pinned = !!renderStrip;
  const body = list ? (
    <WindowedGrid ref={grid} list={list} total={snapshot.total} itemWidth={tracks ? window.width : groups ? metrics.squareWidth : width || metrics.posterWidth} aspect={aspect} renderItem={tracks ? renderTrack : groups ? renderGroup : renderCard} header={top} footer={footer} generation={snapshot.generation} refreshControl={refreshControl} pinnedAbove={pinned} />
  ) : (
    <Page refreshControl={refreshControl} contentStyle={pinned ? {paddingTop: 0} : undefined}>{top}{footer}</Page>
  );
  if (pinned) {
    // TV: the strip stays at the top while the grid moves under it; Down from it comes back to the
    // card last used. The letters stand in the grid's right gutter, the grid narrowed beside them.
    const letters = rail && anchors.length >= 4;
    return (
      <View style={{flex: 1}}>
        <View style={{height: stageTop}} />
        {renderStrip!()}
        <View style={{flex: 1}}>
          <FocusGroup style={{flex: 1, marginRight: letters ? tvRail.width + tvRail.gap : 0}}>{body}</FocusGroup>
          {letters ? (
            <View style={{position: 'absolute', top: 0, bottom: space.lg, right: space.page, width: tvRail.width}}>
              <LetterRail index={anchors} current={letter} sortField={sortField} onJump={jump} onLeave={leaveLetters} />
            </View>
          ) : null}
        </View>
      </View>
    );
  }
  return (
    <View style={{flex: 1, paddingRight: rail && !isTV ? RAIL_WIDTH : 0}}>
      {body}
      {rail && !isTV ? <AlphabetRail index={anchors} current={letter} sortField={sortField} onJump={jump} /> : null}
    </View>
  );
}
