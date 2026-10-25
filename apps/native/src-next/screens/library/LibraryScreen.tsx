import React, {useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore, type ReactNode, type RefObject} from 'react';
import {ScrollView, StyleSheet, Text, View, useWindowDimensions, type StyleProp, type TextStyle} from 'react-native';
import {useSafeAreaInsets} from 'react-native-safe-area-context';
import {defaultI18n, type MessageId} from '../../../../../packages/i18n/src';
import type {Library} from '../../../../../packages/client-core/src';
import type {ContentEntry} from '../../../../../packages/client-core/src/library-content';
import type {BrowseNode} from '../../../../../packages/client-core/src/browse';
import {browseToolbarModel} from '../../../../../packages/client-core/src/presentation/kit-model';
import {libraryTabs, type LibraryTabId} from '../../../../../packages/client-core/src/presentation/library-tabs';
import {serverTextLabel} from '../../../../../packages/client-core/src/presentation/server-text';
import {PosterCard, SquareCard, type CardSelection} from '../../kit/cards';
import {AmbientArt} from '../../kit/artwork';
import {Button, Focusable} from '../../kit/controls';
import {FocusRegion, useFocusRegistry} from '../../kit/focus';
import {LibraryHeader, LibraryMenu, LibrarySwitcher, StickyBrowseHeader, ViewToggle, type BrowseLabels} from '../../kit/browse';
import {browseType, alpha} from '../../kit/browse/presentation';
import {Icon} from '../../kit/Icon';
import {WindowedGrid, AlphabetRail, type LayoutSelection, type WindowedGridHandle} from '../../kit/layout';
import {GridSkeleton, SkeletonBlock, StateView, showSkeleton} from '../../kit/states';
import {useTheme, type Theme} from '../../kit/theme';
import {BlurView, glassRecipe} from '../../platform/native-blur';
import type {NativeShellRuntime} from '../../shell/runtime';
import {homeCardText} from '../home/model';
import {createDestinationEntryFocus, nativeDestinationFocusIds, type NativeDestinationActivationPort} from '../destinations/focus';
import {useDestinationEntryFocus} from '../destinations/useEntryFocus';
import {NativeLibraryDestination, nativeLibraryEntryKey, nativeLibraryCanSave, type NativeLibrarySnapshot, type NativeLibraryViewDraft} from './model';
import {LibraryToolbar} from './LibraryToolbar';
import {LibraryListRow} from './LibraryListRow';
import {NativeLibraryDirectory} from './directory';
import {LibraryFilters} from './LibraryFilters';
import {LibraryJumpSheet} from './LibraryJumpSheet';
import {libraryJumpLetter, libraryJumpLetters} from './jump';
import type {NativeLibraryFilterDraft} from './filters';
import {libraryAppliedFilters} from './applied-filters';
import {hiddenReadingLibraryOnTV, isReadingLibraryKind} from '../read/platform';
import type {NativeEntryMenuState} from '../destinations/entry-actions';
import type {NativeMarkAllRequest} from './mark-all';

export type NativeLibraryActions = Readonly<{
  dispose?: () => void;
  menuState?: NativeEntryMenuState;
  open: (entry: ContentEntry) => void;
  play: (entry: ContentEntry) => void;
  menu: (entry: ContentEntry, anchorRef?: RefObject<View | null>) => void;
  isMenuOpen?: (entry: ContentEntry) => boolean;
  saveView: (destination: NativeLibraryDestination, draft: NativeLibraryViewDraft) => void;
  /** The host's count-aware bulk command: one durable job over the view the viewer sees. */
  markAll?: (request: NativeMarkAllRequest) => void;
}>;
export type NativeLibrarySelectionPort = Readonly<{
  /** Enter this library's actual current selection context without selecting an item. */
  start: () => void;
  subscribe: (listener: () => void) => () => void;
  getSnapshot: () => LayoutSelection;
  register: (source: NativeLibrarySnapshot, entries: readonly ContentEntry[], first: number, last: number) => () => void;
  item: (entry: ContentEntry) => CardSelection;
  render: () => ReactNode;
}>;
export type NativeLibraryScreenProps = Readonly<{
  destination: NativeLibraryDestination;
  runtime: NativeShellRuntime;
  activation: NativeDestinationActivationPort;
  libraries: readonly Library[];
  directory: NativeLibraryDirectory;
  labels: BrowseLabels;
  actions: NativeLibraryActions;
  selection?: NativeLibrarySelectionPort;
  owner: boolean;
}>;
const noSubscribe = () => () => {};
const noSelection = () => undefined;

/** Screen-local geometry named for this lane. Numbers come from the phone frame's
 * own CSS: the compact row is 44 high, the back control 38 with its optical -4
 * offset, the pivot strip 46 with a 3px accent underline, and the count row
 * `padding: 10px 20px`. */
const nativeLibraryR46 = StyleSheet.create({
  header: {borderBottomWidth: 1},
  navRow: {height: 44, paddingLeft: 12, paddingRight: 10, flexDirection: 'row', alignItems: 'center'},
  back: {height: 38, marginLeft: -4, paddingRight: 6, justifyContent: 'center'},
  backContent: {flexDirection: 'row', alignItems: 'center'},
  /** The switcher centres on the screen, not on the space the row leaves; the
   * side bounds keep a long library name clear of both controls. */
  centre: {position: 'absolute', left: 118, right: 118, top: 0, height: 44, alignItems: 'center', justifyContent: 'center'},
  centreInner: {maxWidth: '100%'},
  trailing: {marginLeft: 'auto'},
  tabStrip: {paddingHorizontal: 20, gap: 24},
  tab: {height: 46, justifyContent: 'center'},
  tabUnderline: {position: 'absolute', left: 0, right: 0, bottom: 0, height: 3, borderRadius: 3},
  wash: {position: 'absolute', top: 0, left: 0, right: 0, height: 470, overflow: 'hidden'},
  count: {paddingHorizontal: 20, paddingTop: 10, paddingBottom: 10},
});

/** The wash behind the compact row belongs to the Listen and Read libraries
 * (phone-app 15a and the Books row). Movies, TV Shows and Anime are flat. */
export function libraryWashKind(kind: string): boolean {
  return kind === 'music' || kind === 'audiobook' || isReadingLibraryKind(kind);
}

/** Phone Library's compact header (phone-app #r2a 4): one 44 row with
 * "‹ Libraries", the centred switcher and ⋯, then the pivot strip. The
 * switcher is centred on the screen itself, not on the space the row leaves. */
export function LibraryCompactHeader({switcher, menu, wash, children, onLibraries, testID}: {
  switcher?: ReactNode; menu?: ReactNode; wash?: boolean; children?: ReactNode; onLibraries: () => void; testID?: string;
}) {
  const theme = useTheme(), insets = useSafeAreaInsets(), recipe = glassRecipe();
  return <View testID={testID} style={[nativeLibraryR46.header, {paddingTop: insets.top, backgroundColor: alpha(theme.colors.ink, wash ? .62 : .84),
    borderBottomColor: alpha(theme.colors.text, .07), zIndex: theme.layers.sticky}]}>
    {recipe.nativeBlur && <BlurView pointerEvents="none" style={StyleSheet.absoluteFill} blurType="dark" blurAmount={24} reducedTransparencyFallbackColor={theme.colors.ink}/>}
    <View style={nativeLibraryR46.navRow}>
      <Focusable accessibilityRole="button" focusKind="row" onPress={onLibraries} accessibilityLabel={defaultI18n.t('next.browse.native.libraries')} style={nativeLibraryR46.back}>
        <View style={nativeLibraryR46.backContent}>
          <Icon name="i-left" size={22} color={theme.colors.textSecondary}/>
          <Text style={[browseType(theme, 16, 600), {color: theme.colors.textSecondary}]}>{defaultI18n.t('next.browse.native.libraries')}</Text>
        </View>
      </Focusable>
      <View pointerEvents="box-none" style={nativeLibraryR46.centre}><View style={nativeLibraryR46.centreInner}>{switcher}</View></View>
      <View style={nativeLibraryR46.trailing}>{menu}</View>
    </View>
    {children}
  </View>;
}

/** The pivot strip: it scrolls on a phone because Music and Audiobooks have more
 * pivots than fit (phone-app 15a), and stays one drawn row on TV. */
export function LibraryTabs({items, selected, enabled, disabled, regionId, leftEdge, downEdge, phone, onSelect, onFocusTab}: {
  items: readonly Readonly<{id: LibraryTabId; label: MessageId}>[]; selected: string; enabled: boolean; disabled?: boolean;
  regionId: string; leftEdge: string; downEdge?: string; phone: boolean; onSelect: (id: LibraryTabId) => void; onFocusTab?: (id: LibraryTabId) => void;
}) {
  const theme = useTheme();
  const strip = items.map(tab => <Focusable key={tab.id} focusId={tab.id} accessibilityRole="tab" accessibilityLabel={defaultI18n.t(tab.label)}
    accessibilityState={{selected: selected === tab.id}} disabled={!enabled || !!disabled} onPress={() => onSelect(tab.id)}
    onFocus={theme.isTV ? () => onFocusTab?.(tab.id) : undefined}
    style={theme.isTV ? {height: 64, justifyContent: 'center', borderBottomWidth: selected === tab.id ? 4 : 0, borderBottomColor: theme.colors.accentStrong}
      : phone ? nativeLibraryR46.tab
      : {height: 46, justifyContent: 'center', borderBottomWidth: selected === tab.id ? 4 : 0, borderBottomColor: theme.colors.accentStrong}}>
    <Text style={[browseType(theme, theme.isTV ? 24 : 15.5, 700), {color: selected === tab.id ? theme.colors.text : theme.colors.textTertiary}]}>{defaultI18n.t(tab.label)}</Text>
    {phone && selected === tab.id && <View style={[nativeLibraryR46.tabUnderline, {backgroundColor: theme.colors.accent}]}/>}
  </Focusable>);
  return <FocusRegion id={regionId} entry="browse" orientation="horizontal" enabled={enabled} edges={{left: leftEdge, ...(downEdge ? {down: downEdge} : {})}}
    style={phone ? undefined : {flexDirection: 'row', gap: theme.isTV ? 32 : 28, paddingHorizontal: theme.isTV ? 0 : 20}}>
    {phone ? <ScrollView horizontal showsHorizontalScrollIndicator={false} style={{flexGrow: 0, flexShrink: 0}} contentContainerStyle={nativeLibraryR46.tabStrip}>{strip}</ScrollView> : strip}
  </FocusRegion>;
}

/** The drawn result count: its own left-aligned row under the toolbar on a
 * phone (`.cnt`), and the toolbar's trailing text on TV. */
export function LibraryResultCount({phone, style, children, controls}: {phone: boolean; style?: StyleProp<TextStyle>; children: ReactNode; controls?: ReactNode}) {
  const theme = useTheme();
  const count = <Text accessibilityLiveRegion="polite" style={[browseType(theme, phone ? 13 : 22, 600), {color: theme.colors.textTertiary}, !controls && phone ? nativeLibraryR46.count : undefined, style]}>{children}</Text>;
  return controls ? <View style={[nativeLibraryR46.count, {flexDirection: 'row', alignItems: 'center', gap: 10}]}>{count}<View style={{marginLeft: 'auto'}}>{controls}</View></View> : count;
}

/** The actual library route, independently retained below a title page. The
 * initial TV card is a real producer entity, never an index or placeholder. */
export function LibraryScreen(props: NativeLibraryScreenProps) {
  const {destination, runtime, activation, directory, libraries, actions} = props, theme = useTheme(), registry = useFocusRegistry(), dimensions = useWindowDimensions();
  useSyncExternalStore(actions.menuState?.subscribe ?? noSubscribe, actions.menuState?.getSnapshot ?? (() => 0));
  const entryRequest = useMemo(() => createDestinationEntryFocus(registry), [registry]);
  const [entered, setEntered] = useState(false), onEntered = useCallback(() => setEntered(true), []);
  const state = useSyncExternalStore(destination.subscribe, destination.getSnapshot);
  const summaries = useSyncExternalStore(directory.subscribe, directory.getSnapshot);
  const active = useSyncExternalStore(activation.subscribe, activation.getSnapshot);
  const ids = nativeDestinationFocusIds(runtime.getSnapshot().authority);
  useEffect(() => {void destination.load().catch(runtime.reportError); void directory.load().catch(runtime.reportError);}, [destination, directory, runtime]);
  // The drawn loading page waits the kit's own skeleton delay before drawing shapes; the
  // header and tabs are already known, the count and posters are the only missing facts.
  const loading = (state.phase === 'loading' || state.phase === 'idle') && !state.collection;
  const [loadingElapsed, setLoadingElapsed] = useState(0);
  useEffect(() => {
    if (!loading) {setLoadingElapsed(0); return;}
    const started = Date.now(), timer = setInterval(() => setLoadingElapsed(Date.now() - started), 120);
    return () => clearInterval(timer);
  }, [loading, state.library.id, state.tab.id]);
  // tv-focus 46: a library with no titles yet draws one action, never an empty grid.
  const empty = state.phase === 'ready' && state.unfilteredTotal?.total === 0;
  const emptyRegion = `${ids.libraryTabs(state.library.id)}.empty`;
  // tv-focus 46/F-STATE-17: once the empty page holds focus, the first titles
  // arriving behind it never move focus; the page stays until the person goes
  // Down or Right into the new grid (or leaves it towards the tabs/rail).
  const scope = `${state.library.id}|${state.tab.id}`, scopeRef = useRef(scope), [emptyHeld, setEmptyHeld] = useState(false);
  useEffect(() => {
    if (scopeRef.current !== scope) {scopeRef.current = scope; setEmptyHeld(empty);}
    else if (empty) setEmptyHeld(true);
  }, [empty, scope]);
  const emptyShown = empty || emptyHeld;
  const firstCard = state.collection?.itemAt(0), firstCardRegion = firstCard ? ids.libraryCard(state.library.id, nativeLibraryEntryKey(firstCard)) : undefined;
  useDestinationEntryFocus(active, emptyShown && theme.isTV ? {regionId: emptyRegion, childId: 'browse-home'} : undefined);
  const pivots: Readonly<Record<string, string>> = {movie: 'movies', show: 'shows', episode: 'episodes', artist: 'artists', album: 'albums', song: 'songs', book: 'books', author: 'authors', series: 'series', ebook: 'books', comic: 'titles'};
  const choices = libraries.filter(library => !theme.isTV || !hiddenReadingLibraryOnTV(library.kind)).map(library => {
    const summary = summaries.libraries.find(value => value.id === library.id)?.summary;
    return {id: library.id, name: library.name, count: summary && <View style={{flexDirection: 'row', gap: 12}}>{summary.counts.filter(part => pivots[part.kind]).map(part => <Text key={part.kind}
      style={[browseType(theme, theme.isTV ? 22 : 14), {color: theme.colors.textTertiary}]}>{defaultI18n.t(part.atLeast ? 'lib.countAtLeast' : 'lib.count', {count: part.count, pivot: pivots[part.kind]})}</Text>)}</View>};
  });
  const tabs = <LibraryTabs items={libraryTabs(state.library.kind)} selected={state.tab.id} enabled={active.visible} phone={theme.platform === 'phone'}
    disabled={theme.isTV && active.intent === 'enter' && !entered} regionId={ids.libraryTabs(state.library.id)} leftEdge={ids.rail} downEdge={emptyShown ? emptyRegion : undefined}
    onSelect={id => {void destination.load(id).catch(runtime.reportError);}} onFocusTab={id => {void destination.load(id).catch(runtime.reportError);}}/>;
  const switcher = <LibrarySwitcher value={state.library.id} libraries={choices} onValueChange={id => runtime.onDestination({kind: 'library', libraryId: id})} trigger={theme.isTV ? 'chevron' : 'name'}/>;
  const latestArtwork = summaries.libraries.find(library => library.id === state.library.id)?.summary.latestArtwork;
  const source = latestArtwork ? runtime.ambient(latestArtwork) : undefined;
  // The phone's wash sits behind the pinned header and the first rows (`.lwash`).
  const washed = !!source && theme.platform === 'phone' && libraryWashKind(state.library.kind);
  const wash = washed ? <View pointerEvents="none" style={nativeLibraryR46.wash}><AmbientArt source={source} treatment="library"/></View> : undefined;
  const ambient = source && !washed ? <AmbientArt source={source} treatment="library"/> : undefined;
  // The menu's Mark all covers exactly this view: the pivot and filters the viewer sees, with
  // the view's own count. The job captures membership itself, so nothing here is a client tally.
  const markAll = (): void => {
    const view = state.collection?.getSnapshot();
    if (!view || view.total === undefined || !actions.markAll) return;
    const predicates = state.predicates;
    const filter = predicates.length === 0 ? undefined : predicates.length === 1 ? predicates[0] : {all: predicates};
    const sort = state.sort ? [{field: state.sort.field, direction: state.sort.direction}] : undefined;
    actions.markAll({selector: {query: {libraryId: state.library.id, pivot: state.tab.pivot ?? '',
      ...(filter ? {filter} : {}), ...(sort ? {sort} : {})}},
      pivot: state.tab.pivot ?? 'other', viewTotal: view.total, viewAtLeast: view.totalIsLowerBound === true,
      read: isReadingLibraryKind(state.library.kind),
      // The cards' watched marks come from the fetched page, so the view that submitted the job
      // reloads itself when the job is applied — and only while it is still the same view.
      applied: () => {
        const now = destination.getSnapshot();
        if (now.predicates === predicates && now.sort === state.sort) destination.setQuery(predicates, state.sort);
      }});
  };
  const menu = <LibraryMenu {...runtime.libraryMenu(state.library)}
    canSaveView={!!state.sort && nativeLibraryCanSave(state, {predicates: state.predicates, sort: state.sort})} onSaveView={() => {
      if (state.sort && nativeLibraryCanSave(state, {predicates: state.predicates, sort: state.sort})) actions.saveView(destination, {predicates: state.predicates, sort: state.sort});
    }} onMarkAll={actions.markAll && state.collection ? markAll : undefined}/>;
  const header = theme.isTV ? <LibraryHeader name={state.library.name} switcher={switcher} ambient={ambient}>{tabs}</LibraryHeader>
    : theme.platform === 'phone' ? <LibraryCompactHeader switcher={switcher} menu={menu} wash={washed}
      onLibraries={() => runtime.onDestination({kind: 'libraries'})}>{tabs}</LibraryCompactHeader>
    : <StickyBrowseHeader name={state.library.name} switcher={switcher} ambient={ambient} menu={menu}
      onLibraries={() => runtime.onDestination({kind: 'libraries'})}>{tabs}</StickyBrowseHeader>;
  return <View testID={`native-library-${encodeURIComponent(state.library.id)}`} pointerEvents={active.visible ? 'auto' : 'none'} accessibilityElementsHidden={!active.visible}
    importantForAccessibility={active.visible ? 'auto' : 'no-hide-descendants'} style={{flex: 1, backgroundColor: theme.colors.ink}}>
    {wash}
    {header}
    {summaries.phase === 'error' && <StateView {...runtime.error(summaries.error, () => {void directory.load().catch(runtime.reportError);})}/>}
    {state.phase === 'error' ? <StateView {...runtime.error(state.error, destination.retry)}/>
      : state.collection ? <View style={{flex: 1}}>
        <LibraryGrid {...props} source={state} entryRequest={entryRequest} onEntered={onEntered} entryCovered={emptyShown}/>
        {emptyShown && <View testID="library-empty-page" style={{position: 'absolute', inset: 0, backgroundColor: theme.colors.ink}}>
          <LibraryEmpty runtime={runtime} regionId={emptyRegion} upRegionId={ids.libraryTabs(state.library.id)} firstCardRegion={firstCardRegion}
            onLeave={() => {if (!empty) setEmptyHeld(false);}}/>
        </View>}
      </View>
      : loading ? <LibraryLoading theme={theme} width={dimensions.width} height={dimensions.height} elapsedMs={loadingElapsed}/>
      : emptyShown ? <LibraryEmpty runtime={runtime} regionId={emptyRegion} upRegionId={ids.libraryTabs(state.library.id)}/>
      : state.tab.shows === 'rows' ? <ScrollView>
        {state.discover.error && <StateView {...runtime.error(state.discover.error, destination.retry)}/>}
        {state.discover.appended.map(section => <View key={section.id}>
        <Text accessibilityRole="header" style={[browseType(theme, theme.isTV ? 32 : 19, 700), {color: theme.colors.text, marginHorizontal: theme.gutter, marginTop: 28}]}>{serverTextLabel(defaultI18n, section.heading)}</Text>
        <ScrollView horizontal scrollEventThrottle={100} contentContainerStyle={{paddingHorizontal: theme.gutter, gap: theme.isTV ? 28 : 10, paddingVertical: 16}}
          onScroll={event => {
            if (!active.visible || !section.nextCursor) return;
            const {contentOffset, contentSize, layoutMeasurement} = event.nativeEvent;
            if (contentOffset.x + layoutMeasurement.width >= contentSize.width - 10 * (theme.isTV ? 228 : 122)) void destination.nextDiscover(section.id).catch(runtime.reportError);
          }}>
          {section.entries.map(entry => <LibraryCard key={nativeLibraryEntryKey(entry)} entry={entry} width={theme.isTV ? 200 : 112} runtime={runtime} actions={actions}/>) }
        </ScrollView>
      </View>)}</ScrollView> : null}
    {props.selection?.render()}
  </View>;
}

/** The drawn loading page: the real header and tabs are already above it, and the
 * count and posters are the only unknown shapes. Skeleton positions use the same
 * grid geometry as the loaded page, so nothing jumps when the first page lands. */
function LibraryLoading({theme, width, height, elapsedMs}: {theme: Theme; width: number; height: number; elapsedMs: number}) {
  const tv = theme.isTV, columns = tv ? 7 : 3, gap = tv ? 32 : 10;
  const cardWidth = tv ? 200 : Math.floor((width - 62) / 3);
  const contentWidth = tv ? Math.max(0, width - theme.gutter - 72) : Math.max(0, width - 32);
  return <View testID="library-loading" style={{flex: 1, overflow: 'hidden'}}>
    {showSkeleton(elapsedMs) && <View style={{paddingHorizontal: tv ? theme.gutter : 16, marginTop: tv ? 24 : 10, marginBottom: tv ? 22 : 12}}>
      <SkeletonBlock width={tv ? 160 : 80} height={tv ? 22 : 11} radius={tv ? 11 : 6}/>
    </View>}
    <View style={{paddingHorizontal: tv ? theme.gutter : 16}}>
      <GridSkeleton testID="library-loading-grid" elapsedMs={elapsedMs} scrollOffset={0} viewportHeight={Math.max(0, height - (tv ? 300 : 240))}
        width={contentWidth} columns={columns} cardWidth={cardWidth} gap={gap} rowGap={tv ? 40 : 22} totalCount={columns * 3}/>
    </View>
  </View>;
}

/** tv-focus 46: the composed empty-library page. Header and pivot strip stay
 * above it; the one action enters first and leads Home. */
function LibraryEmpty({runtime, regionId, upRegionId, firstCardRegion, onLeave}: {runtime: NativeShellRuntime; regionId: string; upRegionId: string; firstCardRegion?: string; onLeave?: () => void}) {
  const theme = useTheme(), ids = nativeDestinationFocusIds(runtime.getSnapshot().authority);
  return <FocusRegion id={regionId} entry="browse-home" order={['browse-home']} edges={{up: upRegionId, left: ids.rail,
    ...(firstCardRegion ? {down: firstCardRegion, right: firstCardRegion} : {})}} style={{flex: 1, justifyContent: 'center'}}>
    <StateView testID="library-empty" variant="centered" title={defaultI18n.t('library.emptyLibrary')} body={defaultI18n.t('library.emptyLibraryBody')}>
      <Button focusId="browse-home" testID="library-empty-browse-home" variant="primary" size="hero" onBlur={onLeave}
        onPress={() => runtime.onDestination({kind: 'home'})}>{defaultI18n.t('saved.browseHome')}</Button>
    </StateView>
  </FocusRegion>;
}

function LibraryGrid({destination, runtime, activation, actions, labels, selection, owner, source, entryRequest, onEntered, entryCovered = false}: NativeLibraryScreenProps & {source: NativeLibrarySnapshot; entryRequest: ReturnType<typeof createDestinationEntryFocus>; onEntered: () => void; entryCovered?: boolean}) {
  const theme = useTheme(), dimensions = useWindowDimensions(), registry = useFocusRegistry(), grid = useRef<WindowedGridHandle>(null);
  const collection = source.collection!, state = useSyncExternalStore(collection.subscribe, collection.getSnapshot);
  const pageSubscribe = useCallback((listener: () => void) => collection.subscribePage(0, listener), [collection]);
  const pageVersion = useCallback(() => collection.getPageVersion(0), [collection]);
  useSyncExternalStore(pageSubscribe, pageVersion);
  const active = useSyncExternalStore(activation.subscribe, activation.getSnapshot);
  const selected = useSyncExternalStore(selection?.subscribe ?? noSubscribe, selection?.getSnapshot ?? noSelection);
  const authority = runtime.getSnapshot().authority;
  const ids = useMemo(() => nativeDestinationFocusIds(authority), [authority]), first = collection.itemAt(0);
  const firstKey = first && nativeLibraryEntryKey(first), firstAddress = useMemo(() => firstKey ? {regionId: ids.libraryCard(source.library.id, firstKey), childId: firstKey} : undefined, [firstKey, ids, source.library.id]);
  const top = useCallback(() => grid.current?.scrollToIndex(0), []);
  useEffect(() => {if (source.queryRevision > 0) top();}, [source.queryRevision, top]);
  const entered = useCallback(() => {top(); onEntered();}, [onEntered, top]);
  const tvActivation = useMemo(() => ({...active, visible: active.visible && theme.isTV && !entryCovered}), [active, entryCovered, theme.isTV]);
  useDestinationEntryFocus(tvActivation, firstAddress, entered, entryRequest);
  useEffect(() => runtime.registerScrollToTop({kind: 'library', libraryId: source.library.id}, () => {
    top(); if (firstAddress) registry.focus(firstAddress);
  }), [firstAddress, registry, runtime, source.library.id, top]);
  const toolbar = useMemo(() => browseToolbarModel(source.capabilities!, source.library.kind, source.predicates, source.sort!, {...runtime.text, owner, textEntry: !theme.isTV}),
    [owner, runtime.text, source.capabilities, source.library.kind, source.predicates, source.sort, theme.isTV]);
  const [visible, setVisible] = useState({first: source.memory.firstVisibleIndex, last: source.memory.firstVisibleIndex});
  const geometry = useRef(0), [view, setView] = useState<{mode: 'grid' | 'list'; anchor: number; generation: number}>({mode: 'grid', anchor: source.memory.firstVisibleIndex, generation: 0});
  const list = theme.platform === 'phone' && view.mode === 'list';
  const [jumpOpen, setJumpOpen] = useState(false), jumpAnchor = useRef<View>(null);
  const jumpLetters = useMemo(() => libraryJumpLetters(state.positionIndex), [state.positionIndex]);
  const jumpLetter = useMemo(() => libraryJumpLetter(jumpLetters, visible.first), [jumpLetters, visible.first]);
  const [filterDraft, setFilterDraft] = useState<NativeLibraryFilterDraft>();
  const filterState = useSyncExternalStore(filterDraft?.subscribe ?? noSubscribe, filterDraft?.getSnapshot ?? noSelection);
  const filterOpening = useRef(0);
  // Keep the closed surface mounted so its own exit motion/focus return can finish.
  const closeFilters = useCallback(() => filterDraft?.dispose(), [filterDraft]);
  useEffect(() => {if (!active.visible) {filterDraft?.dispose(); setFilterDraft(undefined);}}, [active.visible, filterDraft]);
  const initialIndex = useRef(source.memory.firstVisibleIndex).current;
  const offset = useRef(destination.getMemory().offset), range = useRef(visible), registered = useRef<(() => void) | undefined>(undefined);
  useEffect(() => {const held = registered; return () => {held.current?.(); held.current = undefined;};}, [collection]);
  const changedRange = useCallback((firstIndex: number, lastIndex: number) => {
    if (geometry.current !== view.generation) return;
    range.current = {first: firstIndex, last: lastIndex}; setVisible(range.current); destination.remember(firstIndex, offset.current);
    const entries: ContentEntry[] = [];
    for (let index = firstIndex; index <= lastIndex; index++) {const entry = collection.itemAt(index); if (entry) entries.push(entry);}
    registered.current?.(); registered.current = selection?.register(destination.getSnapshot(), entries, firstIndex, lastIndex);
  }, [collection, destination, selection, view.generation]);
  const changedOffset = useCallback((measured: number) => {if (geometry.current !== view.generation) return; offset.current = measured; destination.remember(range.current.first, measured);}, [destination, view.generation]);
  const changeView = (mode: 'grid' | 'list') => {
    if (!active.visible || theme.platform !== 'phone' || mode === view.mode) return;
    geometry.current++; offset.current = 0;
    destination.remember(range.current.first, 0);
    setView({mode, anchor: range.current.first, generation: geometry.current});
  };
  const base = source.tab.fixedFilter ?? [], filtered = JSON.stringify(source.predicates) !== JSON.stringify(base);
  const applied = libraryAppliedFilters(toolbar.applied.filter(node => !base.some(fixed => JSON.stringify(fixed) === JSON.stringify(node))), source.capabilities!, labels);
  const appliedRegion = `${ids.libraryToolbar(source.library.id)}.applied`;
  const total = source.unfilteredTotal;
  const count = state.total === undefined ? undefined : filtered && total
    ? defaultI18n.t('title.shownOfTotal', {shown: `${defaultI18n.number(state.total)}${state.totalIsLowerBound ? defaultI18n.t('next.browse.native.countPlus') : ''}`,
      total: defaultI18n.t(total.totalIsLowerBound ? 'lib.countAtLeast' : 'lib.count', {count: total.total, pivot: source.tab.pivot ?? 'other'})})
    : defaultI18n.t(state.totalIsLowerBound ? 'lib.countAtLeast' : 'lib.count', {count: state.total, pivot: source.tab.pivot ?? 'other'});
  const width = list ? dimensions.width - 32 : theme.isTV ? 200 : Math.floor((dimensions.width - 62) / 3), gap = list ? 0 : theme.isTV ? 32 : 10;
  const columns = list ? 1 : theme.isTV ? 7 : 3;
  return <View style={{flex: 1}}>
    <FocusRegion id={ids.libraryToolbar(source.library.id)} entry={theme.isTV ? 'sort' : 'filters'} orientation="horizontal" enabled={active.visible} edges={{left: ids.rail, up: ids.libraryTabs(source.library.id)}}>
      <LibraryToolbar model={toolbar} labels={labels} filterCount={source.predicates.length} filtersOpen={filterState?.open ?? false}
        canSave={nativeLibraryCanSave(source, {predicates: source.predicates, sort: source.sort!})}
        onFilters={() => {filterDraft?.dispose(); filterOpening.current++; setFilterDraft(destination.createFilters());}}
        onSort={sort => destination.setQuery(source.predicates, sort)} onReshuffle={() => destination.setQuery(source.predicates, {...source.sort!, seed: Math.floor(Math.random() * 4294967296)})}
        onQuick={destination.setQuick} onSave={() => actions.saveView(destination, {predicates: source.predicates, sort: source.sort!})}
        onJump={() => setJumpOpen(true)} jumpEnabled={!!state.positionIndex && !!Object.keys(state.positionIndex).length} jumpAnchor={jumpAnchor}
        onSelect={selection?.start} selecting={selected?.active ?? false}/>
    </FocusRegion>
    {!!applied.length ? <FocusRegion id={appliedRegion} entry={applied[0].id} orientation="horizontal" enabled={active.visible}
      edges={{left: ids.rail, up: ids.libraryToolbar(source.library.id), ...(firstKey ? {down: ids.libraryCard(source.library.id, firstKey)} : {})}}
      style={{paddingHorizontal: theme.gutter, paddingTop: theme.isTV ? 24 : 10, paddingBottom: theme.isTV ? 14 : theme.platform === 'phone' ? 0 : 10, flexDirection: 'row', alignItems: 'center', gap: theme.isTV ? 12 : 8, flexWrap: 'wrap'}}>
      {applied.map(filter => <Focusable key={filter.id} focusId={filter.id} disabled={!active.visible} accessibilityLabel={defaultI18n.t('next.browse.native.removeFilter', {field: filter.fieldName})}
        onPress={() => destination.setQuery(source.predicates.filter(node => JSON.stringify(node) !== filter.id))}
        style={{height: theme.isTV ? 52 : 30, borderRadius: theme.isTV ? 14 : theme.platform === 'phone' ? 9 : 17, paddingLeft: theme.isTV ? 20 : 11, paddingRight: theme.platform === 'phone' ? 8 : 7, flexDirection: 'row', alignItems: 'center', gap: 7, backgroundColor: theme.isTV ? alpha(theme.colors.accent, .18) : theme.platform === 'phone' ? theme.colors.raisedHigh : theme.colors.raisedBright,
          borderWidth: theme.isTV ? 1.5 : 0, borderColor: alpha(theme.colors.accentStrong, .5)}}>
        <Text numberOfLines={1} style={[browseType(theme, theme.isTV ? 20 : 13, 600), {color: theme.colors.text}]}>{filter.label}</Text><Icon name="i-close" size={theme.isTV ? 22 : 14} color={theme.colors.textSecondary}/>
      </Focusable>)}
      <Focusable focusId="clear" disabled={!active.visible} onPress={() => destination.setQuery(base as readonly BrowseNode[])} style={{height: theme.isTV ? 52 : 30, justifyContent: 'center', paddingHorizontal: 8}}>
        <Text style={[browseType(theme, theme.isTV ? 20 : 13, 600), {color: theme.colors.textTertiary}]}>{defaultI18n.t('next.browse.native.clearAll')}</Text>
      </Focusable>
      {count && theme.platform !== 'phone' && <Text style={[browseType(theme, theme.isTV ? 22 : 13, 600), {color: theme.colors.textTertiary, marginLeft: 'auto'}]}>{count}</Text>}
    </FocusRegion> : count && theme.platform !== 'phone' && <Text style={[browseType(theme, theme.isTV ? 22 : 13, 600), {color: theme.colors.textTertiary, marginHorizontal: theme.gutter, marginTop: theme.isTV ? 24 : 10, marginBottom: theme.isTV ? 40 : 10}]}>{count}</Text>}
    {count && theme.platform === 'phone' && <LibraryResultCount phone controls={<ViewToggle value={view.mode} onValueChange={changeView}/>}>{count}</LibraryResultCount>}
    {state.status === 'error' && <StateView {...runtime.error(state.error, destination.retry)}/>}
    <WindowedGrid key={view.generation} ref={grid} testID={list ? "library-list" : "library-grid"} collection={collection} getKey={nativeLibraryEntryKey} itemWidth={width} itemHeight={list ? 70 : width * 1.5 + (theme.isTV ? 72 : 43)}
      gap={gap} rowGap={list ? 0 : theme.isTV ? 40 : 22} gutter={theme.isTV ? theme.gutter : 16} rightGutter={list ? 16 : theme.isTV ? 72 : 26} selection={selected}
      onVisibleRange={changedRange} onScrollOffset={changedOffset} initialIndex={view.generation ? view.anchor : initialIndex} paddingBottom={28} style={{flex: 1}}
      renderPlaceholder={() => <View style={{width, height: list ? 70 : width * 1.5, borderRadius: theme.isTV ? 14 : 8, backgroundColor: theme.colors.raised}}/>}
      renderItem={(entry, context) => {
        const key = nativeLibraryEntryKey(entry);
        return <FocusRegion id={ids.libraryCard(source.library.id, key)} entry={key} entryPolicy="entry" order={[key]} enabled={active.visible}
          edges={{...(context.index % columns === 0 ? {left: ids.rail} : {}), ...(context.index < columns ? {up: applied.length ? appliedRegion : ids.libraryToolbar(source.library.id)} : {})}}>
          {list ? <LibraryListRow entry={entry} width={width} runtime={runtime} actions={actions} disabled={!active.visible} selected={context.selection} focusId={key} onFocus={context.onFocus} onBlur={context.onBlur}/> : <LibraryCard entry={entry} width={width} runtime={runtime} actions={actions} disabled={!active.visible} selected={context.selection} focusId={key} onFocus={context.onFocus} onBlur={context.onBlur}/>}
        </FocusRegion>;
      }}/>
    {state.positionIndex && state.total !== undefined && source.sort?.field === 'title' && source.sort.direction === 'asc' && !source.predicates.length && <AlphabetRail positionIndex={state.positionIndex}
      total={state.total} firstVisible={visible.first} lastVisible={visible.last} testID="library-alphabet" onJump={index => grid.current?.scrollToIndex(index)}
      height={theme.isTV ? 514 : 480} style={{position: 'absolute', right: theme.isTV ? 40 : 2, top: theme.isTV ? 174 : 110}}/>}
    <LibraryJumpSheet open={jumpOpen} panelId={`${ids.libraryToolbar(source.library.id)}.jump`} letters={jumpLetters} selected={jumpLetter}
      onSelect={key => {setJumpOpen(false); grid.current?.scrollToLetter(key);}} onClose={() => setJumpOpen(false)}/>
    {filterDraft && <LibraryFilters key={filterOpening.current} draft={filterDraft} source={source} runtime={runtime} labels={labels} owner={owner} onClose={closeFilters}
      onSave={view => actions.saveView(destination, view)}/>}
  </View>;
}

function LibraryCard({entry, width, runtime, actions, selected, disabled, focusId, onFocus, onBlur}: {entry: ContentEntry; width: number; runtime: NativeShellRuntime; actions: NativeLibraryActions; selected?: CardSelection; disabled?: boolean; focusId?: string; onFocus?: () => void; onBlur?: () => void}) {
  const menuAnchorRef = useRef<View>(null), text = homeCardText(entry, false, runtime.text);
  // tv-player 9: the album that is playing carries the same still meter on its card.
  const adapter = runtime.playback;
  const playing = useSyncExternalStore(adapter?.subscribe ?? (() => () => {}), adapter?.getSnapshot ?? (() => undefined));
  const playingAlbum = entry.kind === 'album' && playing?.entry?.album?.id === entry.id;
  const props = {focusId, disabled, title: entry.displayTitle || entry.title, width, titleLines: 2 as const, caption: text.caption, artwork: runtime.artwork(entry.posterUrl), watched: entry.watched, playing: playingAlbum,
    onNavigate: () => actions.open(entry), onPlay: entry.playback ? () => actions.play(entry) : undefined, onMore: () => actions.menu(entry, menuAnchorRef), selection: selected,
    menuAnchorRef, moreExpanded: actions.isMenuOpen?.(entry), onFocus, onBlur};
  return ['album', 'song', 'book', 'audiobook_file'].includes(entry.kind) ? <SquareCard {...props}/> : <PosterCard {...props}/>;
}
