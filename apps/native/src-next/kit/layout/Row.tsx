import React, {useEffect, useId, useRef, useState, useSyncExternalStore, type ReactNode} from 'react';
import {Pressable, Text, View, type StyleProp, type ViewStyle} from 'react-native';
import Svg, {Defs, LinearGradient, Rect, Stop} from 'react-native-svg';
import Animated, {runOnJS, useAnimatedScrollHandler, useSharedValue} from 'react-native-reanimated';
import {defaultI18n} from '../../../../../packages/i18n/src';
import {Icon} from '../Icon';
import {useTheme} from '../theme';
import {FocusItem, FocusRegion, focusTestID, useOptionalFocusRegistry, type FocusRegionProps} from '../focus';
import {reconcileRowSlots, indexRowSlots, visibleRowSlots, rowNeedsPage, type RowPage} from './row-state';
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

export function Row<T>({title, subtitle, items, getKey, getFocusId = getKey, renderItem, itemWidth, itemHeight, gap, gutter, rightGutter, onSeeAll, selection, onVisibleRange, onItemFocus, onRepeatingChange, style, testID, focus, paging, initialViewportWidth = 0}: RowProps<T>) {
  const theme = useTheme();
  const [width, setWidth] = useState(initialViewportWidth), [offset, setOffset] = useState(0), [hovered, setHovered] = useState(false), [focused, setFocused] = useState<string>();
  const registry = useOptionalFocusRegistry();
  const subscribe = registry?.subscribe ?? noopSubscribe, getSnapshot = registry?.getSnapshot ?? zeroSnapshot;
  useSyncExternalStore(subscribe, getSnapshot, getSnapshot);
  const owned = focus ? !!registry?.isRegionActive(focus.id) : focused !== undefined;
  const previous = useRef<{items: readonly T[]; owned: boolean; page?: RowPage<T>; index: ReturnType<typeof indexRowSlots<T>>} | undefined>(undefined);
  const before = previous.current;
  if (!before || before.items !== items || before.owned !== owned || before.page?.waitingId !== paging?.waitingId || before.page?.waitingItem !== paging?.waitingItem || before.page?.hasMore !== paging?.hasMore || before.page?.failed !== paging?.failed) {
    previous.current = {items, owned, page: paging, index: indexRowSlots(reconcileRowSlots(before?.index.slots ?? [], items, getKey, theme.isTV && owned, paging, getFocusId))};
  }
  const rowIndex = previous.current!.index;
  const focusedSlot = focused ? rowIndex.byFocus.get(focused) : undefined;
  const remembered = focus ? registry?.remembered(focus.id) : focused;
  const [arrowFocus, setArrowFocus] = useState<'back' | 'forward' | 'all'>();
  const anchor = useFocusAnchor(true, focused !== undefined);
  const anchorItem = anchor.anchor;
  const stride = itemWidth + (gap ?? theme.spec.shelf.gap[theme.platform]);
  const leading = gutter ?? theme.gutter, trailing = rightGutter ?? (theme.isTV ? theme.layout.gutter.tvRight : theme.gutter);
  // The TV track starts directly below the heading margin. Reserve room above
  // its viewport for the scaled outer ring without moving the drawn card edge.
  const top = theme.isTV ? Math.ceil(itemHeight * (theme.spec.focus.scale.card.tv - 1) / 2 + (theme.spec.focus.offsetOuter.tv + theme.spec.focus.ringWidth.tv) * theme.spec.focus.scale.card.tv) : theme.spec.shelf.phonePaddingTop;
  const bottom = theme.isTV ? Math.max(14, top) : theme.spec.shelf.phonePaddingBottom;
  const extent = leading + Math.max(0, rowIndex.length * stride - (stride - itemWidth)) + trailing;
  const first = Math.max(0, Math.floor((offset - leading) / stride));
  const last = Math.min(rowIndex.length - 1, Math.max(first, Math.ceil((offset + width - leading) / stride) - 1));
  const visible = visibleRowSlots(rowIndex, first, last, focused, remembered);
  useEffect(() => {if (width && last >= first) onVisibleRange?.(first, Math.min(items.length - 1, last));}, [first, items.length, last, onVisibleRange, width]);
  const anchorIntent = useRef('');
  useEffect(() => {
    const intent = `${focused}:${focusedSlot?.position}:${width}:${itemWidth}:${leading}:${trailing}:${stride}`;
    if (intent === anchorIntent.current || !focusedSlot || !width) return;
    anchorIntent.current = intent;
    // motion.html 4.1: content arrivals alone never retarget a focused slot.
    anchorItem(leading + focusedSlot.position * stride, itemWidth, width, extent, leading, trailing);
  }, [anchorItem, extent, focused, focusedSlot, itemWidth, leading, stride, trailing, width]);
  const requestedPage = useRef<string | undefined>(undefined);
  useEffect(() => {
    const waitingId = paging?.waitingId;
    if (!waitingId || requestedPage.current === waitingId || !rowNeedsPage(focusedSlot?.position ?? last, items.length, paging)) return;
    requestedPage.current = waitingId;
    paging?.requestNext();
  }, [focusedSlot?.position, items.length, last, paging]);
  useEffect(() => {onRepeatingChange?.(anchor.repeating);}, [anchor.repeating, onRepeatingChange]);
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
const noopSubscribe = () => () => {};
const zeroSnapshot = () => 0;
export type {RowPage} from './row-state';
export {Row as Shelf};
