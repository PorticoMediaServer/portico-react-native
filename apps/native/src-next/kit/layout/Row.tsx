import React, {useEffect, useId, useLayoutEffect, useMemo, useRef, useState, useSyncExternalStore, type ReactNode} from 'react';
import {Pressable, Text, View, type StyleProp, type ViewStyle} from 'react-native';
import Svg, {Defs, LinearGradient, Rect, Stop} from 'react-native-svg';
import Animated, {runOnJS, useAnimatedScrollHandler, useSharedValue} from 'react-native-reanimated';
import {defaultI18n} from '../../../../../packages/i18n/src';
import {Icon} from '../Icon';
import {useTheme} from '../theme';
import {FocusItem, FocusProvider, FocusRegion, focusTestID, useOptionalFocusRegistry, type FocusRegionProps} from '../focus';
import {reconcileRowSlots, indexRowSlots, visibleRowSlots, rowNeedsPage, type RowPage} from './row-state';
import {useRowPageBoundary} from '../focus/page-boundary';
import {useFocusAnchor} from './FocusAnchor';
import {MotionItem} from './MotionItem';
import {itemSelection, type LayoutItemContext, type LayoutSelection} from './types';

export type RowProps<T> = {
  title: string;
  subtitle?: ReactNode;
  items: readonly T[];
  getKey: (item: T) => string;
  /** Focus identity may include kind/source/library while selection retains its existing data key. */
  getFocusId?: (item: T) => string;
  renderItem: (item: T, context: LayoutItemContext) => ReactNode;
  itemWidth: number;
  itemHeight: number;
  gap?: number;
  gutter?: number;
  rightGutter?: number;
  onSeeAll?: () => void;
  selection: LayoutSelection;
  onVisibleRange?: (first: number, last: number) => void;
  /** Raw data keys for intersecting real slots only; excludes overscan, waiting and separately pinned focus. */
  onVisibleKeys?: (keys: readonly string[]) => void;
  onItemFocus?: (item: T, index: number) => void;
  onRepeatingChange?: (repeating: boolean) => void;
  style?: StyleProp<ViewStyle>;
  testID?: string;
  /** Actual measured width may be supplied before native onLayout (Home uses its measured viewport). */
  initialViewportWidth?: number;
  focus?: Omit<FocusRegionProps, 'children' | 'order' | 'orientation'>;
  paging?: RowPage<T>;
};

function ArrowBackdrop({back}: {back: boolean}) {
  const {colors} = useTheme(), id = useId();
  return <Svg pointerEvents="none" accessible={false} width="100%" height="100%" style={{position: 'absolute', inset: 0}}>
    <Defs><LinearGradient id={id} x1={back ? '0' : '100%'} x2={back ? '100%' : '0'} y1="0" y2="0">
      <Stop offset="0" stopColor={colors.ink} stopOpacity={.9} /><Stop offset="1" stopColor={colors.ink} stopOpacity={0} />
    </LinearGradient></Defs><Rect width="100%" height="100%" fill={`url(#${id})`} />
  </Svg>;
}

export function Row<T>(props: RowProps<T>) {
  return <FocusProvider><RowContent {...props} /></FocusProvider>;
}

function RowContent<T>({title, subtitle, items, getKey, getFocusId = getKey, renderItem, itemWidth, itemHeight, gap, gutter, rightGutter, onSeeAll, selection, onVisibleRange, onVisibleKeys, onItemFocus, onRepeatingChange, style, testID, focus, paging, initialViewportWidth = 0}: RowProps<T>) {
  const theme = useTheme();
  const [width, setWidth] = useState(initialViewportWidth), [offset, setOffset] = useState(0), [hovered, setHovered] = useState(false), [focused, setFocused] = useState<string>();
  const registry = useOptionalFocusRegistry();
  const subscribe = registry?.subscribe ?? noopSubscribe, getSnapshot = registry?.getSnapshot ?? zeroSnapshot;
  useSyncExternalStore(subscribe, getSnapshot, getSnapshot);
  const owned = focus ? !!registry?.isRegionActive(focus.id) : focused !== undefined;
  const regionId = focus?.id;
  const previous = useRef<{regionId?: string; index: ReturnType<typeof indexRowSlots<T>>} | undefined>(undefined);
  const fulfilledId = paging?.fulfilled?.waitingId, fulfilledItem = paging?.fulfilled?.firstItemId;
  const waitingId = paging?.waitingId, waitingItem = paging?.waitingItem, hasMore = paging?.hasMore, failed = paging?.failed;
  const rowIndex = useMemo(() => {
    const before = previous.current?.regionId === regionId ? previous.current?.index.slots ?? [] : [];
    return indexRowSlots(reconcileRowSlots(before, items, getKey, theme.isTV && owned,
      waitingId && waitingItem !== undefined ? {waitingId, waitingItem, hasMore: !!hasMore, failed, loading: false, requestNext: noop,
        fulfilled: fulfilledId ? {waitingId: fulfilledId, firstItemId: fulfilledItem} : undefined} : undefined, getFocusId));
  }, [failed, fulfilledId, fulfilledItem, getFocusId, getKey, hasMore, items, owned, regionId, theme.isTV, waitingId, waitingItem]);
  useLayoutEffect(() => {previous.current = {regionId, index: rowIndex};}, [regionId, rowIndex]);
  const focusedSlot = focused ? rowIndex.byFocus.get(focused) : undefined;
  const remembered = focus ? registry?.remembered(focus.id) : focused;
  const [arrowFocus, setArrowFocus] = useState<'back' | 'forward' | 'all'>();
  const anchor = useFocusAnchor(true, focused !== undefined, theme.isTV ? 'start' : 'visible');
  const anchorItem = anchor.anchor;
  const stride = itemWidth + (gap ?? theme.spec.shelf.gap[theme.platform]);
  const leading = gutter ?? theme.gutter, trailing = rightGutter ?? (theme.isTV ? theme.layout.gutter.tvRight : theme.gutter);
  // The TV track starts directly below the heading margin. Reserve room above
  // its viewport for the scaled outer ring without moving the drawn card edge.
  const top = theme.isTV ? Math.ceil(itemHeight * (theme.spec.focus.scale.card.tv - 1) / 2 + (theme.spec.focus.offsetOuter.tv + theme.spec.focus.ringWidth.tv) * theme.spec.focus.scale.card.tv) : theme.spec.shelf.phonePaddingTop;
  const bottom = theme.isTV ? Math.max(14, top) : theme.spec.shelf.phonePaddingBottom;
  const naturalExtent = leading + Math.max(0, rowIndex.length * stride - (stride - itemWidth)) + trailing;
  // Every real TV slot, including a short row's last card, must be able to
  // reach the left safe edge. This is blank track space, never a focus target.
  const extent = theme.isTV && rowIndex.length ? Math.max(naturalExtent, width + (rowIndex.length - 1) * stride) : naturalExtent;
  const first = Math.max(0, Math.floor((offset - leading) / stride));
  const last = Math.min(rowIndex.length - 1, Math.max(first, Math.ceil((offset + width - leading) / stride) - 1));
  const recovery = focus ? registry?.recovery(focus.id) ?? [] : focused ? [{childId: focused, order: previous.current?.index.order ?? []}] : [];
  const visible = visibleRowSlots(rowIndex, first, last, focused, remembered, recovery);
  useEffect(() => {if (width && last >= first) onVisibleRange?.(first, Math.min(items.length - 1, last));}, [first, items.length, last, onVisibleRange, width]);
  const visibleKeys = useMemo(() => {
    const keys: string[] = [];
    if (width) for (let position = first; position <= last; position++) {
      const slot = rowIndex.byPosition.get(position);
      if (slot && !slot.waiting && leading + position * stride < offset + width && leading + position * stride + itemWidth > offset) keys.push(slot.id);
    }
    return keys;
  }, [first, itemWidth, last, leading, offset, rowIndex, stride, width]);
  useEffect(() => {onVisibleKeys?.(visibleKeys);}, [onVisibleKeys, visibleKeys]);
  const anchorIntent = useRef('');
  useEffect(() => {
    if (!focusedSlot || !width) {anchorIntent.current = ''; return;}
    const intent = `${focused}:${focusedSlot?.position}:${width}:${itemWidth}:${leading}:${trailing}:${stride}`;
    if (intent === anchorIntent.current) return;
    anchorIntent.current = intent;
    // motion.html 4.1: content arrivals alone never retarget a focused slot.
    anchorItem(leading + focusedSlot.position * stride, itemWidth, width, extent, leading, trailing);
  }, [anchorItem, extent, focused, focusedSlot, itemWidth, leading, stride, trailing, width]);
  const requestedPage = useRef<string | undefined>(undefined);
  useEffect(() => {
    const requestId = paging?.waitingId;
    if (!requestId || requestedPage.current === requestId || !rowNeedsPage(focusedSlot?.position ?? last, items.length, paging)) return;
    requestedPage.current = requestId;
    paging?.requestNext();
  }, [focusedSlot?.position, items.length, last, paging]);
  useEffect(() => {onRepeatingChange?.(anchor.repeating);}, [anchor.repeating, onRepeatingChange]);
  // Native boundary notifications request data only; the native guide still chooses every target.
  useRowPageBoundary(theme.isTV && !!focus, registry, focus?.id, rowIndex.slots.filter(slot => !slot.waiting).at(-1)?.focusId, paging);
  const reported = useSharedValue('');
  const scrollOffset = anchor.offset;
  const onScroll = useAnimatedScrollHandler(event => {
    const x = event.contentOffset.x;
    scrollOffset.value = x;
    const next = `${Math.floor((x - leading) / stride)}:${Math.ceil((x + width - leading) / stride)}`;
    if (reported.value !== next) {reported.value = next; runOnJS(setOffset)(x);}
  });
  const controlStyle = (selected: boolean) => ({borderWidth: selected ? theme.spec.focus.ringWidth[theme.platform] : 0, borderColor: theme.colors.focus, borderRadius: theme.baseRadii.control});
  return <View testID={testID} onPointerEnter={() => setHovered(true)} onPointerLeave={() => setHovered(false)} style={style}>
    <View style={{flexDirection: 'row', alignItems: 'baseline', gap: theme.spec.shelf.headingGap[theme.platform], paddingLeft: leading, paddingRight: trailing, marginBottom: theme.spec.shelf.headingMargin[theme.platform]}}>
      {onSeeAll && !theme.isTV ? <Pressable testID={testID ? `${testID}-see-all` : undefined} accessibilityRole="button" accessibilityLabel={title} accessibilityHint={defaultI18n.t('shelf.seeAll')} onPress={onSeeAll}
        onFocus={() => setArrowFocus('all')} onBlur={() => setArrowFocus(undefined)} style={[{minHeight: 24, flexDirection: 'row', alignItems: 'center', flexShrink: 1}, controlStyle(arrowFocus === 'all')]}>
        <Text accessibilityRole="header" numberOfLines={1} style={[theme.type.rowHeading, {color: theme.colors.text, flexShrink: 1, includeFontPadding: false}]}>{title}</Text><Icon name="i-right" size={18} color={theme.colors.textTertiary} />
      </Pressable> : <Text accessibilityRole="header" numberOfLines={1} style={[theme.type.rowHeading, {color: theme.colors.text, flexShrink: 1, includeFontPadding: false}]}>{title}</Text>}
      {subtitle && <View style={{flexShrink: 1}}>{typeof subtitle === 'string' ? <Text numberOfLines={1} style={[theme.type.rowSubtitle, {color: theme.colors.textTertiary, includeFontPadding: false}]}>{subtitle}</Text> : subtitle}</View>}

    </View>
    <RowRegion focus={theme.isTV ? focus : undefined} order={rowIndex.order}>
    <Animated.ScrollView horizontal ref={anchor.scrollRef} style={theme.isTV ? {marginTop: -top} : undefined} onLayout={event => setWidth(event.nativeEvent.layout.width)}
      onScroll={onScroll} scrollEventThrottle={16} showsHorizontalScrollIndicator={false} onScrollBeginDrag={anchor.stop}
      snapToInterval={theme.isTV ? undefined : stride} decelerationRate="fast" disableIntervalMomentum={!theme.isTV}
      scrollAnimationEnabled={false} onTouchStart={anchor.stop} removeClippedSubviews={false}>
      <View style={{width: extent, height: itemHeight + top + bottom}}>
        {visible.map(slot => {
          const {item, id, focusId, waiting, position} = slot;
          const itemTestID = focus ? focusTestID(focus.id, focusId) : testID ? `${testID}-item-${encodeURIComponent(focusId)}` : undefined;
          return <MotionItem key={focusId} style={{position: 'absolute', left: leading + position * stride, top, width: itemWidth, height: itemHeight}}>
            <FocusItem focusId={focusId} testID={itemTestID} waiting={waiting}>{renderItem(item, {id, focusId, testID: itemTestID, waiting, index: position, selection: itemSelection(selection, id), onFocus: () => {
              setFocused(focusId); if (!waiting) onItemFocus?.(item, position);
            }, onBlur: () => setFocused(current => current === focusId ? undefined : current)})}</FocusItem>
          </MotionItem>;
        })}
      </View>
    </Animated.ScrollView>
    </RowRegion>
    {!theme.isTV && hovered && width > 0 && extent > width && (['back', 'forward'] as const).map(direction => {
      const back = direction === 'back', available = back ? offset > 0 : offset + width < extent - 1;
      return available && <Pressable testID={testID ? `${testID}-scroll-${direction}` : undefined} key={direction} accessibilityRole="button" accessibilityLabel={defaultI18n.t(back ? 'shelf.scrollBack' : 'shelf.scrollForward')}
        onPress={() => anchor.move(Math.max(0, Math.min(extent - width, anchor.offset.value + (back ? -1 : 1) * Math.max(stride, Math.floor((width - leading - trailing) / stride) * stride))))}
        onFocus={() => setArrowFocus(direction)} onBlur={() => setArrowFocus(undefined)}
        style={[{position: 'absolute', top: theme.spec.shelf.arrowTop, bottom: theme.spec.shelf.arrowBottom, width: theme.spec.shelf.arrowWidth, left: back ? 0 : undefined, right: back ? undefined : 0, alignItems: 'center', justifyContent: 'center', zIndex: theme.layers.rowArrow}, controlStyle(arrowFocus === direction)]}>
        <ArrowBackdrop back={back} /><Icon name={back ? 'i-left' : 'i-right'} size={24} />
      </Pressable>;
    })}
  </View>;
}

function RowRegion({focus, order, children}: {focus?: RowProps<unknown>['focus']; order: readonly string[]; children: ReactNode}) {
  return focus ? <FocusRegion {...focus} orientation="horizontal" order={order} entry={focus.entry ?? order[0]}>{children}</FocusRegion> : <>{children}</>;
}
const noop = () => {};
const noopSubscribe = () => () => {};
const zeroSnapshot = () => 0;
export type {RowPage} from './row-state';
export {Row as Shelf};
