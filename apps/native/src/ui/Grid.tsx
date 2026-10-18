import React, {useCallback, useMemo, useState, useSyncExternalStore} from 'react';
import {useReportScroll} from './NavBar';
import {FlatList, View, VirtualizedList, type FlatListProps, type RefreshControlProps, type StyleProp, type ViewStyle} from 'react-native';
import {useSafeAreaInsets} from 'react-native-safe-area-context';
import {useTheme} from './theme';
import {gridColumns} from './grid-columns';
import {Arriving, useArrivals} from './Arriving';
import {WindowArrivals} from './arrivals';

export {gridColumns};

/**
 * One row of cards, for a grid whose rows are the cells of the page's own list (so the list
 * mounts only the rows near the viewport). Lays out exactly as a `Grid` row does.
 */
export function CardRow<T>({items, first = 0, columnWidth, gap, keyOf, renderItem, style}: {items: readonly T[]; /** Index of the row's first item in the whole list. */ first?: number; columnWidth: number; gap?: number; keyOf: (item: T) => string; renderItem: (item: T, columnWidth: number, index: number) => React.ReactElement; style?: StyleProp<ViewStyle>}) {
  const {space} = useTheme();
  return (
    <View style={[{flexDirection: 'row', gap: gap ?? space.gutter, marginBottom: space.lg, paddingHorizontal: space.page}, style]}>
      {items.map((item, i) => (
        <View key={keyOf(item)} style={{width: columnWidth}}>
          {renderItem(item, columnWidth, first + i)}
        </View>
      ))}
    </View>
  );
}

export type GridProps<T> = Omit<FlatListProps<T>, 'numColumns' | 'renderItem' | 'data'> & {
  data: readonly T[];
  /** Preferred column width; the grid picks the column count that fits. */
  itemWidth: number;
  /** Available width override (defaults to the measured container). */
  width?: number;
  renderItem: (item: T, columnWidth: number, index: number) => React.ReactElement;
  /** Gap between columns and rows. */
  gap?: number;
  /** Apply page gutters (off when the grid already sits inside a padded block). */
  gutter?: boolean;
};

/**
 * Responsive grid. Column count is derived from the measured width and the
 * preferred card width, so a phone, an iPad in landscape and a television all
 * fill their rows edge to edge with evenly sized cards.
 */
export function Grid<T>({data, itemWidth, width, renderItem, gap, gutter = true, contentContainerStyle, ...rest}: GridProps<T>) {
  const {space, window, isTV, metrics} = useTheme();
  const [measured, setMeasured] = useState(0);
  const [slot, setSlot] = useState(0);
  const spacing = gap ?? space.gutter;
  const padding = gutter ? space.page * 2 : 0;
  const fallback = window.width - (isTV ? metrics.railWidth : 0) - padding;
  const available = width ?? (measured > 0 ? measured - padding : fallback);
  const {columns, columnWidth} = gridColumns(available, itemWidth, spacing);
  const rows = useMemo(() => {
    const out: T[][] = [];
    for (let i = 0; i < data.length; i += columns) out.push(data.slice(i, i + columns));
    return out;
  }, [data, columns]);
  // A card that arrives after the grid was first shown (a quiet refresh, "Show more") fades in.
  const keyOf = rest.keyExtractor;
  const arriving = useArrivals(data, (item, index) => (keyOf ? keyOf(item, index) : String(index)));
  const renderRow = (row: T[], rowIndex: number) => (
    <View key={rowIndex} style={{flexDirection: 'row', gap: spacing, marginBottom: space.lg}}>
      {row.map((item, i) => (
        <View key={rest.keyExtractor ? rest.keyExtractor(item, rowIndex * columns + i) : String(i)} style={{width: columnWidth}}>
          {/* Only cards with a key of their own can be told apart from the ones that were there. */}
          <Arriving on={!!keyOf && arriving(keyOf(item, rowIndex * columns + i))}>{renderItem(item, columnWidth, rowIndex * columns + i)}</Arriving>
        </View>
      ))}
    </View>
  );
  // Inside a scrolling page (scrollEnabled={false}) a list is laid out at its full height, so it
  // cannot virtualise and its end-reached metrics are meaningless: it would page through the whole
  // library by itself (PERF-01). A nested grid therefore never pages; a paging grid must be the
  // page's scroller (`PagedGrid`) or offer an explicit "Show more".
  if (__DEV__ && rest.scrollEnabled === false && rest.onEndReached) console.warn('[Grid] a nested grid cannot page on end-reached; use PagedGrid or a Show more button');
  if (rest.scrollEnabled === false) {
    return (
      <View onLayout={e => setMeasured(e.nativeEvent.layout.width)} style={[{paddingHorizontal: gutter ? space.page : 0}, contentContainerStyle as object]}>
        {rows.map(renderRow)}
      </View>
    );
  }
  const list = (
    <FlatList
      {...(rest as object)}
      onLayout={e => setMeasured(e.nativeEvent.layout.width)}
      data={rows}
      keyExtractor={(_, index) => String(index)}
      style={isTV ? {height: slot} : (rest as {style?: object}).style}
      contentContainerStyle={[{paddingHorizontal: gutter ? space.page : 0}, contentContainerStyle]}
      renderItem={({item: row, index: rowIndex}) => renderRow(row, rowIndex)}
    />
  );
  // tvOS: the list's ScrollView sits in a style-less focus guide that shrink-wraps, so it takes
  // its slot's measured height instead of `flex: 1` (as WindowedGrid and PageList do).
  if (!isTV) return list;
  return <View style={[{flex: 1}, (rest as {style?: object}).style]} onLayout={e => setSlot(e.nativeEvent.layout.height)}>{slot ? list : null}</View>;
}

/** The part of a windowed collection the grid reads (client-core `WindowedCollection`). */
export type GridWindow<T> = {
  ensureRange(first: number, last: number): void;
  slotAt(index: number): {kind: 'item'; key: string; item: T} | {kind: 'placeholder'; key: string};
  pageOf(index: number): number;
  subscribePage(page: number, listener: () => void): () => void;
  getPageVersion(page: number): string;
};

export type WindowedGridHandle = {scrollToIndex: (index: number) => void};

export type WindowedGridProps<T> = {
  list: GridWindow<T>;
  /** Items in the collection; undefined until the first page answers. */
  total: number | undefined;
  itemWidth: number;
  /** Artwork height ÷ width for the placeholder cards. */
  aspect: number;
  renderItem: (item: T, columnWidth: number, index: number) => React.ReactElement;
  header?: React.ReactElement | null;
  footer?: React.ReactElement | null;
  gap?: number;
  contentStyle?: StyleProp<ViewStyle>;
  /** Changes whenever a new generation swaps in (scroll back to the top). */
  generation?: number;
  /** APL-SYS-07: the system pull-to-refresh on touch (`usePullToRefresh`). */
  refreshControl?: React.ReactElement<RefreshControlProps>;
  /** False when something pinned above the grid already clears the status bar (touch only). */
  topInset?: boolean;
  /**
   * Something pinned above the grid clears the top on every platform (a TV library's strip): no
   * inset, only, on TV, room for the focused card to grow without being cut by the grid's top.
   */
  pinnedAbove?: boolean;
};

/**
 * PERF-01 / PERF-02 / TV-LIB-01: a grid over a windowed collection that is itself the page
 * scroller. Nothing is sized by the collection: rows come from `getItemCount`/`getItem` (no
 * array of `total`), only rows near the viewport mount, each row re-renders only when its own
 * page arrives, and unloaded cells are placeholders with stable keys. The visible range is
 * reported to the store, which fetches, prefetches and evicts pages.
 */
function WindowedGridInner<T>({list, total, itemWidth, aspect, renderItem, header, footer, gap, contentStyle, generation = 0, refreshControl, topInset = true, pinnedAbove = false}: WindowedGridProps<T>, ref: React.ForwardedRef<WindowedGridHandle>) {
  const {space, window, isTV, metrics} = useTheme();
  const insets = useSafeAreaInsets();
  const [measured, setMeasured] = useState(0);
  const [rowHeight, setRowHeight] = useState(0);
  const [headerHeight, setHeaderHeight] = useState(0);
  const listRef = React.useRef<VirtualizedList<number>>(null);
  // A card a quiet re-read put where another was fades in; one scrolled to does not (`WindowArrivals`).
  // Another list (a new generation, or another store) starts again before any row of it is drawn.
  const arrivals = React.useRef<{tracker: WindowArrivals; list: GridWindow<T>; generation: number} | null>(null);
  if (!arrivals.current) arrivals.current = {tracker: new WindowArrivals(), list, generation};
  else if (arrivals.current.list !== list || arrivals.current.generation !== generation) { arrivals.current.tracker.reset(); arrivals.current.list = list; arrivals.current.generation = generation; }
  const tracker = arrivals.current.tracker;
  const spacing = gap ?? space.gutter;
  const fallback = window.width - (isTV ? metrics.railWidth : 0);
  const available = (measured > 0 ? measured : fallback) - space.page * 2;
  const columns = Math.max(1, Math.floor((available + spacing) / (itemWidth + spacing)));
  const columnWidth = Math.floor((available - spacing * (columns - 1)) / columns);
  const rows = total === undefined ? 2 : Math.ceil(total / columns);
  const rowStride = rowHeight || columnWidth * aspect + 56 + space.lg;
  // TV: a focused card grows (focusScale, its ring and glow) past its row; the first row keeps that
  // room above it, and a row scrolled to keeps the same room under the grid's top edge (Android's
  // focus scrolling leaves the fading edge clear), so no card's top is ever cut.
  const focusRoom = isTV ? space.lg : 0;
  const topPad = pinnedAbove ? focusRoom : isTV ? Math.max(insets.top, 60) - space.lg : topInset ? insets.top : 0;
  React.useImperativeHandle(ref, () => ({
    scrollToIndex: (index: number) => {
      const row = Math.floor(index / columns);
      list.ensureRange(row * columns, (row + 3) * columns - 1);
      listRef.current?.scrollToOffset({offset: headerHeight + row * rowStride, animated: false});
    },
  }), [columns, list, headerHeight, rowStride]);
  React.useEffect(() => { listRef.current?.scrollToOffset({offset: 0, animated: false}); }, [generation]);
  React.useEffect(() => { list.ensureRange(0, columns * 4 - 1); }, [list, columns, generation]);
  // VirtualizedList keeps the first `onViewableItemsChanged` it is given, so the callback reads the
  // current list and columns through refs: a new list (library, tab or pivot change) must load too.
  const columnsRef = React.useRef(columns);
  columnsRef.current = columns;
  const listRef2 = React.useRef(list);
  listRef2.current = list;
  const onViewable = React.useRef(({viewableItems}: {viewableItems: {index: number | null}[]}) => {
    const indices = viewableItems.map(v => v.index).filter((i): i is number => i !== null);
    if (!indices.length) return;
    const c = columnsRef.current;
    listRef2.current.ensureRange(Math.min(...indices) * c, (Math.max(...indices) + 1) * c - 1);
  });
  // Row height comes from row 0 once its cards have loaded (placeholders have no caption), and
  // again whenever the column width changes it.
  const measureRow = useCallback((height: number) => setRowHeight(h => (Math.abs(h - height) > 0.5 ? height : h)), []);
  React.useEffect(() => { setRowHeight(0); }, [columnWidth]);
  const renderRow = useCallback(({index: row}: {index: number}) => (
    <GridRow list={list} row={row} columns={columns} columnWidth={columnWidth} aspect={aspect} spacing={spacing} total={total} renderItem={renderItem} arrivals={tracker} onMeasure={row === 0 ? measureRow : undefined} />
  ), [list, columns, columnWidth, aspect, spacing, total, renderItem, tracker, measureRow]);
  // tvOS: VirtualizedList wraps its ScrollView in a style-less focus guide that shrink-wraps, so
  // the list takes its slot's measured height instead of `flex: 1` (see PageList).
  const [slot, setSlot] = useState(0);
  const report = useReportScroll();
  const scroller = (
    <VirtualizedList<number>
      ref={listRef}
      data={rows}
      getItemCount={() => rows}
      getItem={(_, index) => index}
      keyExtractor={index => `row:${index}`}
      renderItem={renderRow}
      getItemLayout={rowHeight ? (_, index) => ({length: rowHeight, offset: headerHeight + rowHeight * index, index}) : undefined}
      onLayout={e => setMeasured(e.nativeEvent.layout.width)}
      fadingEdgeLength={focusRoom || undefined}
      // The header (with the top inset) is measured so row offsets are exact for letter jumps.
      ListHeaderComponent={<View onLayout={e => setHeaderHeight(e.nativeEvent.layout.height)} style={{paddingTop: topPad}}>{header}</View>}
      ListFooterComponent={footer}
      onViewableItemsChanged={onViewable.current}
      viewabilityConfig={{itemVisiblePercentThreshold: 1}}
      initialNumToRender={3}
      maxToRenderPerBatch={2}
      windowSize={isTV ? 3 : 5}
      updateCellsBatchingPeriod={50}
      // tvOS focus needs neighbouring rows to exist to move into them.
      removeClippedSubviews={false}
      style={isTV ? {height: slot} : {flex: 1}}
      contentContainerStyle={[{paddingBottom: insets.bottom + space.xxxl}, contentStyle]}
      keyboardShouldPersistTaps="handled"
      refreshControl={refreshControl}
      onScroll={isTV ? undefined : report}
      scrollEventThrottle={32}
    />
  );
  if (!isTV) return scroller;
  return <View style={{flex: 1}} onLayout={e => setSlot(e.nativeEvent.layout.height)}>{slot ? scroller : null}</View>;
}
export const WindowedGrid = React.forwardRef(WindowedGridInner) as <T>(props: WindowedGridProps<T> & {ref?: React.Ref<WindowedGridHandle>}) => React.ReactElement;

function GridRowInner<T>({list, row, columns, columnWidth, aspect, spacing, total, renderItem, arrivals, onMeasure}: {list: GridWindow<T>; row: number; columns: number; columnWidth: number; aspect: number; spacing: number; total: number | undefined; renderItem: (item: T, columnWidth: number, index: number) => React.ReactElement; arrivals: WindowArrivals; onMeasure?: (height: number) => void}) {
  const {space, colors, metrics} = useTheme();
  const first = row * columns;
  const last = total === undefined ? first + columns - 1 : Math.min(first + columns, total) - 1;
  const firstPage = list.pageOf(first);
  const lastPage = list.pageOf(Math.max(first, last));
  // Re-render only when this row's own page(s) change.
  const subscribe = useCallback((listener: () => void) => {
    const a = list.subscribePage(firstPage, listener);
    const b = lastPage !== firstPage ? list.subscribePage(lastPage, listener) : undefined;
    return () => { a(); b?.(); };
  }, [list, firstPage, lastPage]);
  useSyncExternalStore(subscribe, () => `${list.getPageVersion(firstPage)}|${list.getPageVersion(lastPage)}`);
  const cells: React.ReactElement[] = [];
  let loaded = true;
  for (let index = first; index <= last; index++) {
    const slot = list.slotAt(index);
    if (slot.kind !== 'item') loaded = false;
    cells.push(
      <View key={slot.key} style={{width: columnWidth}}>
        {slot.kind === 'item' ? <Arriving on={arrivals.drawn(index, slot.key, Date.now())}>{renderItem(slot.item, columnWidth, index)}</Arriving> : <View style={{width: columnWidth, height: columnWidth * aspect, borderRadius: metrics.radius.card, backgroundColor: colors.raised}} />}
      </View>,
    );
  }
  return (
    <View onLayout={onMeasure && loaded ? e => onMeasure(e.nativeEvent.layout.height) : undefined} style={{flexDirection: 'row', gap: spacing, paddingBottom: space.lg, paddingHorizontal: space.page}}>
      {cells}
    </View>
  );
}
const GridRow = React.memo(GridRowInner) as typeof GridRowInner;
