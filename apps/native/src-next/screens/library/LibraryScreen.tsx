import React, {useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore, type ReactNode, type RefObject} from 'react';
import {ScrollView, Text, View, useWindowDimensions} from 'react-native';
import {defaultI18n} from '../../../../../packages/i18n/src';
import type {Library} from '../../../../../packages/client-core/src';
import type {ContentEntry} from '../../../../../packages/client-core/src/library-content';
import type {BrowseNode} from '../../../../../packages/client-core/src/browse';
import {browseToolbarModel} from '../../../../../packages/client-core/src/presentation/kit-model';
import {libraryTabs} from '../../../../../packages/client-core/src/presentation/library-tabs';
import {serverTextLabel} from '../../../../../packages/client-core/src/presentation/server-text';
import {PosterCard, SquareCard, type CardSelection} from '../../kit/cards';
import {Focusable} from '../../kit/controls';
import {FocusRegion, useFocusRegistry} from '../../kit/focus';
import {LibraryHeader, LibraryMenu, LibrarySwitcher, StickyBrowseHeader, type BrowseLabels} from '../../kit/browse';
import {Menu} from '../../kit/overlays';
import {browseType, alpha} from '../../kit/browse/presentation';
import {Icon} from '../../kit/Icon';
import {WindowedGrid, AlphabetRail, type LayoutSelection, type WindowedGridHandle} from '../../kit/layout';
import {StateView} from '../../kit/states';
import {useTheme} from '../../kit/theme';
import type {NativeShellRuntime} from '../../shell/runtime';
import {homeCardText} from '../home/model';
import {createDestinationEntryFocus, nativeDestinationFocusIds, type NativeDestinationActivationPort} from '../destinations/focus';
import {useDestinationEntryFocus} from '../destinations/useEntryFocus';
import {NativeLibraryDestination, nativeLibraryEntryKey, type NativeLibrarySnapshot, type NativeLibraryViewDraft} from './model';
import {LibraryToolbar} from './LibraryToolbar';
import {NativeLibraryDirectory} from './directory';
import {LibraryFilters} from './LibraryFilters';
import type {NativeLibraryFilterDraft} from './filters';
import {libraryAppliedFilters} from './applied-filters';

export type NativeLibraryActions = Readonly<{
  open: (entry: ContentEntry) => void;
  play: (entry: ContentEntry) => void;
  menu: (entry: ContentEntry, anchorRef?: RefObject<View | null>) => void;
  isMenuOpen?: (entry: ContentEntry) => boolean;
  saveView: (destination: NativeLibraryDestination, draft: NativeLibraryViewDraft) => void;
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

/** The actual library route, independently retained below a title page. The
 * initial TV card is a real producer entity, never an index or placeholder. */
export function LibraryScreen(props: NativeLibraryScreenProps) {
  const {destination, runtime, activation, directory, libraries, actions} = props, theme = useTheme(), registry = useFocusRegistry();
  const entryRequest = useMemo(() => createDestinationEntryFocus(registry), [registry]);
  const [entered, setEntered] = useState(false), onEntered = useCallback(() => setEntered(true), []);
  const state = useSyncExternalStore(destination.subscribe, destination.getSnapshot);
  const summaries = useSyncExternalStore(directory.subscribe, directory.getSnapshot);
  const active = useSyncExternalStore(activation.subscribe, activation.getSnapshot);
  const ids = nativeDestinationFocusIds(runtime.getSnapshot().authority);
  useEffect(() => {void destination.load().catch(runtime.reportError); void directory.load().catch(runtime.reportError);}, [destination, directory, runtime]);
  const pivots: Readonly<Record<string, string>> = {movie: 'movies', show: 'shows', episode: 'episodes', artist: 'artists', album: 'albums', song: 'songs', book: 'books', author: 'authors', series: 'series'};
  const choices = libraries.filter(library => !theme.isTV || library.kind !== 'books').map(library => {
    const summary = summaries.libraries.find(value => value.id === library.id)?.summary;
    return {id: library.id, name: library.name, count: summary && <View style={{flexDirection: 'row', gap: 12}}>{summary.counts.filter(part => pivots[part.kind]).map(part => <Text key={part.kind}
      style={[browseType(theme, theme.isTV ? 22 : 14), {color: theme.colors.textTertiary}]}>{defaultI18n.t(part.atLeast ? 'lib.countAtLeast' : 'lib.count', {count: part.count, pivot: pivots[part.kind]})}</Text>)}</View>};
  });
  const tabs = <FocusRegion id={ids.libraryTabs(state.library.id)} entry="browse" orientation="horizontal" enabled={active.visible}
    edges={{left: ids.rail}} style={{flexDirection: 'row', gap: theme.isTV ? 32 : 28, paddingHorizontal: theme.isTV ? 0 : 20}}>
    {libraryTabs(state.library.kind).map(tab => <Focusable key={tab.id} focusId={tab.id} accessibilityRole="tab" accessibilityLabel={defaultI18n.t(tab.label)}
      accessibilityState={{selected: state.tab.id === tab.id}} disabled={!active.visible || theme.isTV && active.intent === 'enter' && !entered} onPress={() => {void destination.load(tab.id).catch(runtime.reportError);}}
      onFocus={theme.isTV ? () => {void destination.load(tab.id).catch(runtime.reportError);} : undefined}
      style={{height: theme.isTV ? 64 : 46, justifyContent: 'center', borderBottomWidth: state.tab.id === tab.id ? 4 : 0, borderBottomColor: theme.colors.accentStrong}}>
      <Text style={[browseType(theme, theme.isTV ? 24 : 15.5, 700), {color: state.tab.id === tab.id ? theme.colors.text : theme.colors.textTertiary}]}>{defaultI18n.t(tab.label)}</Text>
    </Focusable>)}
  </FocusRegion>;
  const switcher = <LibrarySwitcher value={state.library.id} libraries={choices} onValueChange={id => runtime.onDestination({kind: 'library', libraryId: id})} trigger={theme.isTV ? 'chevron' : 'name'}/>;
  const header = theme.isTV ? <LibraryHeader name={state.library.name} switcher={switcher}>{tabs}</LibraryHeader>
    : <StickyBrowseHeader name={state.library.name} switcher={switcher} menu={<LibraryMenu {...runtime.libraryMenu(state.library)}/>}
      onLibraries={() => runtime.onDestination({kind: 'libraries'})}>{tabs}</StickyBrowseHeader>;
  return <View testID={`native-library-${encodeURIComponent(state.library.id)}`} pointerEvents={active.visible ? 'auto' : 'none'} accessibilityElementsHidden={!active.visible}
    importantForAccessibility={active.visible ? 'auto' : 'no-hide-descendants'} style={{flex: 1, backgroundColor: theme.colors.ink}}>
    {header}
    {summaries.phase === 'error' && <StateView {...runtime.error(summaries.error, () => {void directory.load().catch(runtime.reportError);})}/>}
    {state.phase === 'error' ? <StateView {...runtime.error(state.error, destination.retry)}/>
      : state.collection ? <LibraryGrid {...props} source={state} entryRequest={entryRequest} onEntered={onEntered}/>
      : state.tab.shows === 'rows' ? <ScrollView>{state.discover.appended.map(section => <View key={section.id}>
        <Text accessibilityRole="header" style={[browseType(theme, theme.isTV ? 32 : 19, 700), {color: theme.colors.text, marginHorizontal: theme.gutter, marginTop: 28}]}>{serverTextLabel(defaultI18n, section.heading)}</Text>
        <ScrollView horizontal contentContainerStyle={{paddingHorizontal: theme.gutter, gap: theme.isTV ? 28 : 10, paddingVertical: 16}}>
          {section.entries.map(entry => <LibraryCard key={nativeLibraryEntryKey(entry)} entry={entry} width={theme.isTV ? 200 : 112} runtime={runtime} actions={actions}/>) }
        </ScrollView>
      </View>)}</ScrollView> : null}
    {props.selection?.render()}
  </View>;
}

function LibraryGrid({destination, runtime, activation, actions, labels, selection, owner, source, entryRequest, onEntered}: NativeLibraryScreenProps & {source: NativeLibrarySnapshot; entryRequest: ReturnType<typeof createDestinationEntryFocus>; onEntered: () => void}) {
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
  const tvActivation = useMemo(() => ({...active, visible: active.visible && theme.isTV}), [active, theme.isTV]);
  useDestinationEntryFocus(tvActivation, firstAddress, entered, entryRequest);
  useEffect(() => runtime.registerScrollToTop({kind: 'library', libraryId: source.library.id}, () => {
    top(); if (firstAddress) registry.focus(firstAddress);
  }), [firstAddress, registry, runtime, source.library.id, top]);
  const toolbar = useMemo(() => browseToolbarModel(source.capabilities!, source.library.kind, source.predicates, source.sort!, {...runtime.text, owner, textEntry: !theme.isTV}),
    [owner, runtime.text, source.capabilities, source.library.kind, source.predicates, source.sort, theme.isTV]);
  const [visible, setVisible] = useState({first: source.memory.firstVisibleIndex, last: source.memory.firstVisibleIndex});
  const [jumpOpen, setJumpOpen] = useState(false), jumpAnchor = useRef<View>(null);
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
    range.current = {first: firstIndex, last: lastIndex}; setVisible(range.current); destination.remember(firstIndex, offset.current);
    const entries: ContentEntry[] = [];
    for (let index = firstIndex; index <= lastIndex; index++) {const entry = collection.itemAt(index); if (entry) entries.push(entry);}
    registered.current?.(); registered.current = selection?.register(destination.getSnapshot(), entries, firstIndex, lastIndex);
  }, [collection, destination, selection]);
  const changedOffset = useCallback((measured: number) => {offset.current = measured; destination.remember(range.current.first, measured);}, [destination]);
  const base = source.tab.fixedFilter ?? [], filtered = JSON.stringify(source.predicates) !== JSON.stringify(base);
  const applied = libraryAppliedFilters(toolbar.applied.filter(node => !base.some(fixed => JSON.stringify(fixed) === JSON.stringify(node))), source.capabilities!, labels);
  const appliedRegion = `${ids.libraryToolbar(source.library.id)}.applied`;
  const total = source.unfilteredTotal;
  const count = state.total === undefined ? undefined : filtered && total
    ? defaultI18n.t('title.shownOfTotal', {shown: `${defaultI18n.number(state.total)}${state.totalIsLowerBound ? defaultI18n.t('next.browse.native.countPlus') : ''}`,
      total: defaultI18n.t(total.totalIsLowerBound ? 'lib.countAtLeast' : 'lib.count', {count: total.total, pivot: source.tab.pivot ?? 'other'})})
    : defaultI18n.t(state.totalIsLowerBound ? 'lib.countAtLeast' : 'lib.count', {count: state.total, pivot: source.tab.pivot ?? 'other'});
  const width = theme.isTV ? 200 : Math.floor((dimensions.width - 62) / 3), gap = theme.isTV ? 32 : 10;
  const columns = theme.isTV ? 7 : 3;
  return <View style={{flex: 1}}>
    <FocusRegion id={ids.libraryToolbar(source.library.id)} entry={theme.isTV ? 'sort' : 'filters'} orientation="horizontal" enabled={active.visible} edges={{left: ids.rail, up: ids.libraryTabs(source.library.id)}}>
      <LibraryToolbar model={toolbar} labels={labels} filterCount={source.predicates.length} filtersOpen={filterState?.open ?? false}
        onFilters={() => {filterDraft?.dispose(); filterOpening.current++; setFilterDraft(destination.createFilters());}}
        onSort={sort => destination.setQuery(source.predicates, sort)} onReshuffle={() => destination.setQuery(source.predicates, {...source.sort!, seed: Math.floor(Math.random() * 4294967296)})}
        onQuick={destination.setQuick} onSave={() => actions.saveView(destination, {predicates: source.predicates, sort: source.sort!})}
        onJump={() => setJumpOpen(true)} jumpEnabled={!!state.positionIndex && !!Object.keys(state.positionIndex).length} jumpAnchor={jumpAnchor}
        onSelect={selection?.start} selecting={selected?.active ?? false}/>
    </FocusRegion>
    {!!applied.length ? <FocusRegion id={appliedRegion} entry={applied[0].id} orientation="horizontal" enabled={active.visible}
      edges={{left: ids.rail, up: ids.libraryToolbar(source.library.id), ...(firstKey ? {down: ids.libraryCard(source.library.id, firstKey)} : {})}}
      style={{paddingHorizontal: theme.gutter, paddingTop: theme.isTV ? 24 : 10, paddingBottom: theme.isTV ? 14 : 10, flexDirection: 'row', alignItems: 'center', gap: theme.isTV ? 12 : 8, flexWrap: 'wrap'}}>
      {applied.map(filter => <Focusable key={filter.id} focusId={filter.id} disabled={!active.visible} accessibilityLabel={defaultI18n.t('next.browse.native.removeFilter', {field: filter.fieldName})}
        onPress={() => destination.setQuery(source.predicates.filter(node => JSON.stringify(node) !== filter.id))}
        style={{height: theme.isTV ? 52 : 30, borderRadius: theme.isTV ? 14 : 17, paddingLeft: theme.isTV ? 20 : 11, paddingRight: 7, flexDirection: 'row', alignItems: 'center', gap: 7, backgroundColor: theme.isTV ? alpha(theme.colors.accent, .18) : theme.colors.raisedBright,
          borderWidth: theme.isTV ? 1.5 : 0, borderColor: alpha(theme.colors.accentStrong, .5)}}>
        <Text numberOfLines={1} style={[browseType(theme, theme.isTV ? 20 : 13, 600), {color: theme.colors.text}]}>{filter.label}</Text><Icon name="i-close" size={theme.isTV ? 22 : 14} color={theme.colors.textSecondary}/>
      </Focusable>)}
      <Focusable focusId="clear" disabled={!active.visible} onPress={() => destination.setQuery(base as readonly BrowseNode[])} style={{height: theme.isTV ? 52 : 30, justifyContent: 'center', paddingHorizontal: 8}}>
        <Text style={[browseType(theme, theme.isTV ? 20 : 13, 600), {color: theme.colors.textTertiary}]}>{defaultI18n.t('next.browse.native.clearAll')}</Text>
      </Focusable>
      {count && <Text style={[browseType(theme, theme.isTV ? 22 : 13, 600), {color: theme.colors.textTertiary, marginLeft: 'auto'}]}>{count}</Text>}
    </FocusRegion> : count && <Text style={[browseType(theme, theme.isTV ? 22 : 13, 600), {color: theme.colors.textTertiary, marginHorizontal: theme.gutter, marginTop: theme.isTV ? 24 : 10, marginBottom: theme.isTV ? 40 : 10}]}>{count}</Text>}
    {state.status === 'error' && <StateView {...runtime.error(state.error, destination.retry)}/>}
    <WindowedGrid ref={grid} testID="library-grid" collection={collection} getKey={nativeLibraryEntryKey} itemWidth={width} itemHeight={width * 1.5 + (theme.isTV ? 72 : 43)}
      gap={gap} rowGap={theme.isTV ? 40 : 22} gutter={theme.isTV ? theme.gutter : 16} rightGutter={theme.isTV ? 72 : 26} selection={selected}
      onVisibleRange={changedRange} onScrollOffset={changedOffset} initialIndex={initialIndex} paddingBottom={28} style={{flex: 1}}
      renderPlaceholder={() => <View style={{width, height: width * 1.5, borderRadius: theme.isTV ? 14 : 8, backgroundColor: theme.colors.raised}}/>}
      renderItem={(entry, context) => {
        const key = nativeLibraryEntryKey(entry);
        return <FocusRegion id={ids.libraryCard(source.library.id, key)} entry={key} entryPolicy="entry" order={[key]} enabled={active.visible}
          edges={{...(context.index % columns === 0 ? {left: ids.rail} : {}), ...(context.index < columns ? {up: applied.length ? appliedRegion : ids.libraryToolbar(source.library.id)} : {})}}>
          <LibraryCard entry={entry} width={width} runtime={runtime} actions={actions} disabled={!active.visible} selected={context.selection} focusId={key} onFocus={context.onFocus} onBlur={context.onBlur}/>
        </FocusRegion>;
      }}/>
    {state.positionIndex && state.total !== undefined && source.sort?.field === 'title' && source.sort.direction === 'asc' && !source.predicates.length && <AlphabetRail positionIndex={state.positionIndex}
      total={state.total} firstVisible={visible.first} lastVisible={visible.last} testID="library-alphabet" onJump={index => grid.current?.scrollToIndex(index)}
      height={theme.isTV ? 514 : 480} style={{position: 'absolute', right: theme.isTV ? 40 : 2, top: theme.isTV ? 174 : 110}}/>}
    <Menu open={jumpOpen} onOpenChange={setJumpOpen} anchorRef={jumpAnchor} returnFocusRef={jumpAnchor} title={defaultI18n.t('next.browse.native.jumpTo')}
      items={Object.keys(state.positionIndex ?? {}).map(key => ({id: key, label: key, onSelect: () => grid.current?.scrollToLetter(key)}))}/>
    {filterDraft && <LibraryFilters key={filterOpening.current} draft={filterDraft} source={source} runtime={runtime} labels={labels} owner={owner} onClose={closeFilters}
      onSave={view => actions.saveView(destination, view)}/>}
  </View>;
}

function LibraryCard({entry, width, runtime, actions, selected, disabled, focusId, onFocus, onBlur}: {entry: ContentEntry; width: number; runtime: NativeShellRuntime; actions: NativeLibraryActions; selected?: CardSelection; disabled?: boolean; focusId?: string; onFocus?: () => void; onBlur?: () => void}) {
  const menuAnchorRef = useRef<View>(null), text = homeCardText(entry, false, runtime.text);
  const props = {focusId, disabled, title: entry.displayTitle || entry.title, width, titleLines: 2 as const, caption: text.caption, artwork: runtime.artwork(entry.posterUrl), watched: entry.watched,
    onNavigate: () => actions.open(entry), onPlay: entry.playback ? () => actions.play(entry) : undefined, onMore: () => actions.menu(entry, menuAnchorRef), selection: selected,
    menuAnchorRef, moreExpanded: actions.isMenuOpen?.(entry), onFocus, onBlur};
  return ['album', 'song', 'book', 'audiobook_file'].includes(entry.kind) ? <SquareCard {...props}/> : <PosterCard {...props}/>;
}
