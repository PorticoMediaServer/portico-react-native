import React, {useEffect, useMemo, useState, useSyncExternalStore} from 'react';
import {Text, View, useWindowDimensions} from 'react-native';
import type {BrowseNode, BrowseSortSelection} from '../../../../../packages/client-core/src/browse';
import type {ContentEntry} from '../../../../../packages/client-core/src/library-content';
import type {Library} from '../../../../../packages/client-core/src';
import {browseToolbarModel} from '../../../../../packages/client-core/src/presentation/kit-model';
import {defaultI18n} from '../../../../../packages/i18n/src';
import type {BrowseLabels} from '../../kit/browse';
import {BrowseToolbar, FilteredEmpty} from '../../kit/browse';
import {Button, Chip} from '../../kit/controls';
import {PosterCard} from '../../kit/cards';
import {WindowedGrid} from '../../kit/layout';
import {StateView} from '../../kit/states';
import {browseType} from '../../kit/browse/presentation';
import {useTheme} from '../../kit/theme';
import type {NativeShellBootstrapContext} from '../../shell/bootstrap';
import type {NativeShellRuntime} from '../../shell/runtime';
import {nativeDestinationLifetime} from '../destinations/lifetime';
import {homeCardText} from '../home/model';
import {libraryAppliedFilters} from '../library/applied-filters';
import {NativeLibraryDestination, nativeLibraryEntryKey} from '../library/model';
import {LibraryFilters} from '../library/LibraryFilters';
import type {NativeLibraryFilterDraft} from '../library/filters';

const noopSubscribe = () => () => {};

/** tablet-read#1b: the Books pivot as the authored browsable grid — the shared
 * Browse toolbar over real capabilities and quick filters — with the real
 * Filters panel docked beside it in landscape. Cards open the book's own
 * destination (VideoTV); this surface never opens the reader itself. */
export function NativeReadingBooks({context, runtime, library, owner, labels, filterWidth = 360}: {
  context: NativeShellBootstrapContext; runtime: NativeShellRuntime; library: Library; owner: boolean; labels: BrowseLabels; filterWidth?: number;
}) {
  const theme = useTheme(), dimensions = useWindowDimensions(), lifetime = useMemo(() => nativeDestinationLifetime(context), [context]);
  const current = () => lifetime.current() && context.libraries().some(value => value.id === library.id && value.kind === library.kind);
  const destination = useMemo(() => new NativeLibraryDestination({api: context.api, scope: lifetime.scope, library, current}), [context, lifetime, library]);
  const state = useSyncExternalStore(destination.subscribe, destination.getSnapshot);
  const [filters, setFilters] = useState<NativeLibraryFilterDraft>();
  useEffect(() => {void destination.load(); return () => destination.dispose();}, [destination]);
  useEffect(() => () => filters?.dispose(), [filters]);
  const collection = state.collection, capabilities = state.capabilities, sort = state.sort, pivot = state.tab.pivot;
  const pageStore = useMemo(() => ({subscribe: (notify: () => void) => collection ? collection.subscribe(notify) : noopSubscribe(),
    getSnapshot: () => collection?.getSnapshot()}), [collection]);
  const page = useSyncExternalStore(pageStore.subscribe, pageStore.getSnapshot);
  const model = useMemo(() => capabilities && sort ? browseToolbarModel(capabilities, library.kind, state.predicates, sort,
    {...runtime.text, owner, textEntry: true}) : undefined, [capabilities, library.kind, owner, runtime.text, sort, state.predicates]);
  const applied = capabilities && model ? libraryAppliedFilters(model.applied, capabilities, labels) : [];
  const base = (state.tab.fixedFilter ?? []) as readonly BrowseNode[];
  const filtered = JSON.stringify(state.predicates) !== JSON.stringify(base);
  const total = page?.total, unfiltered = state.unfilteredTotal;
  const resultCount = total === undefined ? '' : filtered && unfiltered
    ? defaultI18n.t('title.shownOfTotal', {shown: `${defaultI18n.number(total)}${page?.totalIsLowerBound ? defaultI18n.t('next.browse.native.countPlus') : ''}`,
        total: defaultI18n.t(unfiltered.totalIsLowerBound ? 'lib.countAtLeast' : 'lib.count', {count: unfiltered.total, pivot: pivot ?? 'other'})})
    : defaultI18n.t(page?.totalIsLowerBound ? 'lib.countAtLeast' : 'lib.count', {count: total, pivot: pivot ?? 'other'});
  const applyQuery = (predicates: readonly BrowseNode[]) => {
    if (!filters) {destination.setQuery(predicates); return;}
    filters.setPredicates(predicates); // Debounced count/facet refresh of the same panel.
    filters.applyLive(); // The mounted grid takes the query; the panel stays open.
  };
  const closeFilters = () => {filters?.dispose(); setFilters(undefined);};
  const openFilters = () => {
    if (filters) {closeFilters(); return;}
    if (!current() || !capabilities || !sort || !state.collection) return;
    setFilters(destination.createFilters({live: true}));
  };
  const applySort = (next: BrowseSortSelection) => {
    destination.setQuery(state.predicates, next, filters);
    if (filters) {filters.dispose(); setFilters(destination.createFilters({live: true}));}
  };
  const quick = (id: string, checked: boolean) => {
    const preset = capabilities?.quickFilters.find(value => value.id === id);
    if (!preset) return;
    const same = (node: BrowseNode) => JSON.stringify(node) === JSON.stringify(preset.query);
    applyQuery([...state.predicates.filter(node => !same(node)), ...(checked ? [preset.query] : [])]);
  };
  const width = dimensions.width, docked = width > dimensions.height;
  const pane = filters && docked ? filterWidth : 0;
  const columns = Math.max(2, Math.min(5, Math.floor((width - theme.gutter * 2 - pane) / 168)));
  const gap = 16, cardWidth = Math.max(120, Math.floor((width - theme.gutter * 2 - gap * (columns - 1) - pane) / columns));
  const cardHeight = cardWidth * 1.5 + 48;
  return <View style={{flex: 1}}>
    {model ? <BrowseToolbar testID="reading-books-toolbar" model={model} labels={labels} resultCount={resultCount}
      onFilters={openFilters} onQuickChange={quick} onSortChange={applySort}
      onReshuffle={() => {if (sort) applySort({...sort, seed: (sort.seed ?? 0) + 1});}}/> : null}
    {applied.length ? <View style={{flexDirection: 'row', alignItems: 'center', gap: 8, flexWrap: 'wrap', paddingHorizontal: theme.gutter, paddingTop: 10}}>
      {applied.map(row => <Chip key={row.id} testID={`reading-books-applied-${row.id}`} onPress={() => applyQuery(state.predicates.filter(value => JSON.stringify(value) !== row.id))}
        accessibilityLabel={defaultI18n.t('next.browse.native.removeFilter', {field: row.fieldName})}>{row.label}</Chip>)}
      <Button variant="text" size="small" onPress={() => applyQuery(base)}>{defaultI18n.t('next.browse.native.clearAll')}</Button>
    </View> : null}
    {state.phase === 'error' ? <StateView {...runtime.error(state.error, () => {void destination.load(state.tab.id).catch(runtime.reportError);})}/>
      : collection ? <View style={{flex: 1, flexDirection: 'row'}}>
        {total === 0 ? (filtered
          ? <View style={{flex: 1}}><FilteredEmpty testID="reading-books-filtered-empty" onClearFilters={() => applyQuery(base)}/></View>
          : <StateView testID="reading-books-empty" variant="inline" title={defaultI18n.t('library.emptyLibrary')} body={defaultI18n.t('library.emptyLibraryBody')} style={{flex: 1}}/>)
          : <WindowedGrid testID="reading-books-grid" collection={collection} getKey={nativeLibraryEntryKey} itemWidth={cardWidth} itemHeight={cardHeight}
            gap={gap} rowGap={20} gutter={theme.gutter} rightGutter={theme.gutter} style={{flex: 1}} initialIndex={state.memory.firstVisibleIndex}
            onVisibleRange={first => destination.remember(first, 0)}
            renderPlaceholder={() => <View style={{width: cardWidth, height: cardWidth * 1.5, borderRadius: 10, backgroundColor: theme.colors.raised}}/>}
            renderItem={(entry: ContentEntry) => {
              const text = homeCardText(entry, false, runtime.text);
              return <PosterCard title={text.title} caption={text.caption} width={cardWidth} artwork={runtime.artwork(entry.posterUrl)} visible
                testID={`reading-book-${entry.id}`} onNavigate={() => runtime.actions.navigate(entry)}/>;
            }}/>}
        {filters && docked ? <View style={{width: filterWidth, borderLeftWidth: 1, borderLeftColor: theme.colors.line, backgroundColor: theme.colors.ink}}>
          <LibraryFilters docked draft={filters} source={state} runtime={runtime} owner={owner} labels={labels} onClose={closeFilters}/>
        </View> : null}
      </View>
      : <Text style={[browseType(theme, 14, 500), {color: theme.colors.textTertiary, padding: 20}]}>{defaultI18n.t('status.loading')}</Text>}
    {filters && !docked ? <LibraryFilters draft={filters} source={state} runtime={runtime} owner={owner} labels={labels} onClose={closeFilters}/> : null}
  </View>;
}
