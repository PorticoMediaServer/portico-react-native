import React, {forwardRef, useCallback, useEffect, useImperativeHandle, useMemo, useState, useSyncExternalStore, type ReactNode} from 'react';
import {View, type StyleProp, type ViewStyle} from 'react-native';
import Animated, {runOnJS, useAnimatedScrollHandler, useSharedValue} from 'react-native-reanimated';
import type {WindowedCollection} from '../../../../../packages/client-core/src/collections/windowed';
import {useTheme} from '../theme';
import {useFocusAnchor} from './FocusAnchor';
import {gridWindow} from './model';
import {itemSelection, type LayoutItemContext, type LayoutSelection} from './types';

export type WindowedGridHandle = {scrollToIndex: (index: number) => void; scrollToLetter: (key: string) => void};
export type WindowedGridProps<T> = {
  collection: WindowedCollection<T>;
  getKey: (item: T) => string;
  renderItem: (item: T, context: LayoutItemContext) => ReactNode;
  renderPlaceholder: (index: number) => ReactNode;
  itemWidth: number;
  itemHeight: number;
  gap?: number;
  rowGap?: number;
  gutter?: number;
  rightGutter?: number;
  paddingTop?: number;
  paddingBottom?: number;
  stickyOffset?: number;
  overscanRows?: number;
  initialIndex?: number;
  selection: LayoutSelection;
  onVisibleRange?: (first: number, last: number) => void;
  onItemFocus?: (item: T, index: number) => void;
  style?: StyleProp<ViewStyle>;
  testID?: string;
};

function Grid<T>({collection, getKey, renderItem, renderPlaceholder, itemWidth, itemHeight, gap, rowGap, gutter, rightGutter, paddingTop = 0, paddingBottom = 0, stickyOffset = 0, overscanRows = 2, initialIndex = 0, selection, onVisibleRange, onItemFocus, style, testID}: WindowedGridProps<T>, ref: React.ForwardedRef<WindowedGridHandle>) {
  const theme = useTheme();
  const columnGap = gap ?? (theme.isTV ? 28 : 12), verticalGap = rowGap ?? (theme.isTV ? 36 : 22);
  const leading = gutter ?? theme.gutter, trailing = rightGutter ?? (theme.isTV ? theme.layout.gutter.tvRight : theme.gutter);
  const [viewport, setViewport] = useState({width: 0, height: 0});
  const [scroll, setScroll] = useState(0), [focused, setFocused] = useState<number>();
  const anchor = useFocusAnchor(false, focused !== undefined);
  const snapshot = useSyncExternalStore(collection.subscribe, collection.getSnapshot, collection.getSnapshot);
  const columns = Math.max(1, Math.floor((viewport.width - leading - trailing + columnGap) / (itemWidth + columnGap)));
  const stride = itemHeight + verticalGap;
  const total = snapshot.total ?? collection.pageSize;
  const window = gridWindow(total, columns, stride, Math.max(0, scroll + stickyOffset - paddingTop), Math.max(0, viewport.height - stickyOffset), overscanRows);
  const firstMounted = window.startRow * columns, lastMounted = Math.min(total - 1, (window.endRow + 1) * columns - 1);
  const firstPage = collection.pageOf(firstMounted), lastPage = collection.pageOf(Math.max(firstMounted, lastMounted));
  const subscribePages = useCallback((listener: () => void) => {
    const cleanup = [];
    for (let page = firstPage; page <= lastPage; page++) cleanup.push(collection.subscribePage(page, listener));
    return () => cleanup.forEach(run => run());
  }, [collection, firstPage, lastPage]);
  const pageVersion = useCallback(() => {
    const values = [];
    for (let page = firstPage; page <= lastPage; page++) values.push(collection.getPageVersion(page));
    return values.join('|');
  }, [collection, firstPage, lastPage]);
  useSyncExternalStore(subscribePages, pageVersion, pageVersion);
  useEffect(() => {
    if (!viewport.height || window.last < window.first) return;
    collection.ensureRange(window.first, window.last);
    onVisibleRange?.(window.first, window.last);
  }, [collection, onVisibleRange, viewport.height, window.first, window.last]);
  const height = paddingTop + Math.max(0, window.height - verticalGap) + paddingBottom;
  const moveToIndex = useCallback((index: number) => {
    const bounded = Math.max(0, Math.min(total - 1, Math.floor(index)));
    anchor.move(Math.max(0, Math.min(height - viewport.height, paddingTop + Math.floor(bounded / columns) * stride - stickyOffset)));
  }, [anchor, columns, height, paddingTop, stickyOffset, stride, total, viewport.height]);
  useImperativeHandle(ref, () => ({scrollToIndex: moveToIndex, scrollToLetter(key) {
    const index = collection.indexOfLetter(key);
    if (index !== undefined) moveToIndex(index);
  }}), [collection, moveToIndex]);
  const initialOffset = useMemo(() => ({x: 0, y: Math.max(0, paddingTop + Math.floor(initialIndex / columns) * stride - stickyOffset)}), [columns, initialIndex, paddingTop, stickyOffset, stride]);
  const reported = useSharedValue('');
  const scrollOffset = anchor.offset;
  const onScroll = useAnimatedScrollHandler(event => {
    scrollOffset.value = event.contentOffset.y;
    const y = event.contentOffset.y, next = `${Math.floor((y + stickyOffset - paddingTop) / stride)}:${Math.ceil((y + viewport.height - paddingTop) / stride)}`;
    if (reported.value !== next) {reported.value = next; runOnJS(setScroll)(y);}
  });
  const indices: number[] = [];
  for (let index = firstMounted; index <= lastMounted; index++) indices.push(index);
  // Keep only the actually focused cell alive during an interrupted row scroll.
  if (theme.isTV && focused !== undefined && focused < total && !indices.includes(focused)) indices.push(focused);
  return <Animated.ScrollView ref={anchor.scrollRef} testID={testID} style={style} contentOffset={initialOffset}
    onLayout={event => setViewport(event.nativeEvent.layout)} onScroll={onScroll} scrollEventThrottle={16}
    onScrollBeginDrag={anchor.stop} onTouchStart={anchor.stop} scrollAnimationEnabled={false} removeClippedSubviews={false}>
    <View style={{height, position: 'relative'}}>
      {indices.map(index => {
        const slot = collection.slotAt(index), id = slot.kind === 'item' ? getKey(slot.item) : slot.key;
        const focus = () => {
          setFocused(index);
          anchor.anchor(paddingTop + Math.floor(index / columns) * stride, itemHeight, viewport.height, height, stickyOffset + (theme.isTV ? 24 : 0), theme.isTV ? 24 : 0);
          if (slot.kind === 'item') onItemFocus?.(slot.item, index);
        };
        return <View key={id} testID={testID ? `${testID}-cell-${id}` : undefined} style={{position: 'absolute', top: paddingTop + Math.floor(index / columns) * stride, left: leading + index % columns * (itemWidth + columnGap), width: itemWidth, height: itemHeight}}>
          {slot.kind === 'item' ? renderItem(slot.item, {index, id, selection: itemSelection(selection, id), onFocus: focus, onBlur: () => setFocused(current => current === index ? undefined : current)}) : renderPlaceholder(index)}
        </View>;
      })}
    </View>
  </Animated.ScrollView>;
}

export const WindowedGrid = forwardRef(Grid) as <T>(props: WindowedGridProps<T> & {ref?: React.Ref<WindowedGridHandle>}) => React.ReactElement;
