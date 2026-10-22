import React, {useEffect, useId, useState, type ReactNode} from 'react';
import {Pressable, Text, View, type StyleProp, type ViewStyle} from 'react-native';
import Svg, {Defs, LinearGradient, Rect, Stop} from 'react-native-svg';
import Animated, {runOnJS, useAnimatedScrollHandler, useSharedValue} from 'react-native-reanimated';
import {defaultI18n} from '../../../../../packages/i18n/src';
import {Icon} from '../Icon';
import {useTheme} from '../theme';
import {useFocusAnchor} from './FocusAnchor';
import {MotionItem} from './MotionItem';
import {itemSelection, type LayoutItemContext, type LayoutSelection} from './types';

export type RowProps<T> = {
  title: string;
  subtitle?: ReactNode;
  items: readonly T[];
  getKey: (item: T) => string;
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
};

function ArrowBackdrop({back}: {back: boolean}) {
  const {colors} = useTheme(), id = useId();
  return <Svg pointerEvents="none" accessible={false} width="100%" height="100%" style={{position: 'absolute', inset: 0}}>
    <Defs><LinearGradient id={id} x1={back ? '0' : '100%'} x2={back ? '100%' : '0'} y1="0" y2="0">
      <Stop offset="0" stopColor={colors.ink} stopOpacity={.9} /><Stop offset="1" stopColor={colors.ink} stopOpacity={0} />
    </LinearGradient></Defs><Rect width="100%" height="100%" fill={`url(#${id})`} />
  </Svg>;
}

export function Row<T>({title, subtitle, items, getKey, renderItem, itemWidth, itemHeight, gap, gutter, rightGutter, onSeeAll, selection, onVisibleRange, onItemFocus, onRepeatingChange, style, testID}: RowProps<T>) {
  const theme = useTheme();
  const [width, setWidth] = useState(0), [offset, setOffset] = useState(0), [hovered, setHovered] = useState(false), [focused, setFocused] = useState<number>();
  const [arrowFocus, setArrowFocus] = useState<'back' | 'forward' | 'all'>();
  const anchor = useFocusAnchor(true, focused !== undefined);
  const stride = itemWidth + (gap ?? theme.spec.shelf.gap[theme.platform]);
  const leading = gutter ?? theme.gutter, trailing = rightGutter ?? (theme.isTV ? theme.layout.gutter.tvRight : theme.gutter);
  const top = theme.isTV ? 10 : theme.spec.shelf.phonePaddingTop, bottom = theme.isTV ? 14 : theme.spec.shelf.phonePaddingBottom;
  const extent = leading + Math.max(0, items.length * stride - (stride - itemWidth)) + trailing;
  const first = Math.max(0, Math.floor((offset - leading) / stride));
  const last = Math.min(items.length - 1, Math.max(first, Math.ceil((offset + width - leading) / stride) - 1));
  const indices: number[] = [];
  for (let index = Math.max(0, first - 2); index <= Math.min(items.length - 1, last + 2); index++) indices.push(index);
  if (focused !== undefined && focused < items.length && !indices.includes(focused)) indices.push(focused);
  useEffect(() => {if (width && last >= first) onVisibleRange?.(first, last);}, [first, last, onVisibleRange, width]);
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
      {onSeeAll && !theme.isTV ? <Pressable accessibilityRole="button" accessibilityLabel={title} accessibilityHint={defaultI18n.t('shelf.seeAll')} onPress={onSeeAll}
        onFocus={() => setArrowFocus('all')} onBlur={() => setArrowFocus(undefined)} style={[{minHeight: 24, flexDirection: 'row', alignItems: 'center', flexShrink: 1}, controlStyle(arrowFocus === 'all')]}>
        <Text accessibilityRole="header" numberOfLines={1} style={[theme.type.rowHeading, {color: theme.colors.text, flexShrink: 1}]}>{title}</Text><Icon name="i-right" size={18} color={theme.colors.textTertiary} />
      </Pressable> : <Text accessibilityRole="header" numberOfLines={1} style={[theme.type.rowHeading, {color: theme.colors.text, flexShrink: 1}]}>{title}</Text>}
      {subtitle && <View style={{flexShrink: 1}}>{typeof subtitle === 'string' ? <Text numberOfLines={1} style={[theme.type.rowSubtitle, {color: theme.colors.textTertiary}]}>{subtitle}</Text> : subtitle}</View>}
      {onSeeAll && theme.isTV && <Pressable onPress={onSeeAll} accessibilityRole="button" onFocus={() => setArrowFocus('all')} onBlur={() => setArrowFocus(undefined)} style={[{marginLeft: 'auto', minHeight: theme.targets.tenFoot, justifyContent: 'center'}, controlStyle(arrowFocus === 'all')]}>
        <Text style={[theme.type.seeAll, {color: theme.colors.textTertiary}]}>{defaultI18n.t('shelf.seeAll')}</Text>
      </Pressable>}
    </View>
    <Animated.ScrollView horizontal ref={anchor.scrollRef} onLayout={event => setWidth(event.nativeEvent.layout.width)}
      onScroll={onScroll} scrollEventThrottle={16} showsHorizontalScrollIndicator={false} onScrollBeginDrag={anchor.stop}
      snapToInterval={theme.isTV ? undefined : stride} decelerationRate="fast" disableIntervalMomentum={!theme.isTV}
      scrollAnimationEnabled={false} onTouchStart={anchor.stop} removeClippedSubviews={false}>
      <View style={{width: extent, height: itemHeight + top + bottom}}>
        {indices.map(index => {
          const item = items[index], id = getKey(item);
          return <MotionItem key={id} style={{position: 'absolute', left: leading + index * stride, top, width: itemWidth, height: itemHeight}}>
            {renderItem(item, {id, index, selection: itemSelection(selection, id), onFocus: () => {
              setFocused(index); anchor.anchor(leading + index * stride, itemWidth, width, extent, leading, trailing); onItemFocus?.(item, index);
            }, onBlur: () => setFocused(current => current === index ? undefined : current)})}
          </MotionItem>;
        })}
      </View>
    </Animated.ScrollView>
    {!theme.isTV && hovered && width > 0 && extent > width && (['back', 'forward'] as const).map(direction => {
      const back = direction === 'back', available = back ? offset > 0 : offset + width < extent - 1;
      return available && <Pressable key={direction} accessibilityRole="button" accessibilityLabel={defaultI18n.t(back ? 'shelf.scrollBack' : 'shelf.scrollForward')}
        onPress={() => anchor.move(Math.max(0, Math.min(extent - width, anchor.offset.value + (back ? -1 : 1) * Math.max(stride, Math.floor((width - leading - trailing) / stride) * stride))))}
        onFocus={() => setArrowFocus(direction)} onBlur={() => setArrowFocus(undefined)}
        style={[{position: 'absolute', top: theme.spec.shelf.arrowTop, bottom: theme.spec.shelf.arrowBottom, width: theme.spec.shelf.arrowWidth, left: back ? 0 : undefined, right: back ? undefined : 0, alignItems: 'center', justifyContent: 'center', zIndex: theme.layers.rowArrow}, controlStyle(arrowFocus === direction)]}>
        <ArrowBackdrop back={back} /><Icon name={back ? 'i-left' : 'i-right'} size={24} />
      </Pressable>;
    })}
  </View>;
}

export {Row as Shelf};
