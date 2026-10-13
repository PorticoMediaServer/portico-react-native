import React, {useCallback, useMemo, useRef} from 'react';
import {FocusGroup, PreferredFocusContext} from './Focusable';
import {uiI18n} from './i18n';
import {FlatList, View, type ListRenderItem, type StyleProp, type ViewStyle} from 'react-native';
import {Button} from './Button';
import {Text} from './Text';
import {useEntryFocus, useTheme} from './theme';
import {Arriving, useArrivals} from './Arriving';

export type ShelfProps<T> = {
  title?: string;
  subtitle?: string;
  data: readonly T[];
  keyExtractor: (item: T, index: number) => string;
  renderItem: ListRenderItem<T>;
  /** Fixed card width so the list can snap and size itself. */
  itemWidth: number;
  /** Caption height reserved below artwork; used to size the row. */
  itemHeight?: number;
  onSeeAll?: () => void;
  seeAllLabel?: string;
  /** Extra leading content (a featured/hero card). */
  leading?: React.ReactNode;
  style?: StyleProp<ViewStyle>;
  /** First shelf on a screen should take initial focus on television. */
  preferFocus?: boolean;
  onEndReached?: () => void;
};

/**
 * Horizontal recommendation row. Owns the header (title + See all), page
 * gutters, snap, and television focus memory so moving up/down between
 * shelves returns to the last card in each row.
 */
export function Shelf<T>({title, subtitle, data, keyExtractor, renderItem, itemWidth, onSeeAll, seeAllLabel = uiI18n().t('action.seeAll'), leading, style, preferFocus = false, onEndReached}: ShelfProps<T>) {
  const {space, isTV, window} = useTheme();
  // TV: the first card claims entry focus once there is one (Search results, a screen's first row).
  const claim = useEntryFocus(isTV && preferFocus && data.length > 0);
  const gap = space.gutter;
  const visible = Math.ceil(window.width / (itemWidth + gap)) + 2;
  const getItemLayout = useCallback((_: unknown, index: number) => ({length: itemWidth + gap, offset: (itemWidth + gap) * index, index}), [itemWidth, gap]);
  const contentStyle = useMemo(() => ({paddingHorizontal: space.page, gap}), [space.page, gap]);
  const header = useMemo(() => (leading ? <View style={{marginRight: gap}}>{leading}</View> : null), [leading, gap]);
  const listStyle = useMemo(() => (isTV ? {paddingVertical: space.md, marginVertical: -space.md, overflow: 'visible' as const} : undefined), [isTV, space.md]);
  // A card that arrives after the row was first shown (a quiet refresh, the next page) fades in.
  const arriving = useArrivals(data, keyExtractor);
  const keyOf = useRef(keyExtractor);
  keyOf.current = keyExtractor;
  const arrived = useCallback<NonNullable<typeof renderItem>>(info => <Arriving on={arriving(keyOf.current(info.item, info.index))}>{renderItem?.(info) ?? null}</Arriving>, [renderItem, arriving]);
  const snapped = useCallback<NonNullable<typeof renderItem>>(info => (
    <View {...({scrollSnapAlign: 'start'} as object)}>
      {info.index === 0 && claim ? <PreferredFocusContext.Provider value>{arrived(info)}</PreferredFocusContext.Provider> : arrived(info)}
    </View>
  ), [arrived, claim]);
  const content = (
    <FlatList
      horizontal
      data={data as T[]}
      keyExtractor={keyExtractor}
      renderItem={isTV ? snapped : arrived}
      getItemLayout={getItemLayout}
      showsHorizontalScrollIndicator={false}
      snapToInterval={isTV ? undefined : itemWidth + gap}
      decelerationRate="fast"
      // On television the row follows focus: the focused card comes to rest a page gutter in from
      // the left, rather than wherever the system happened to reveal it.
      snapToAlignment={isTV ? ('item' as never) : 'start'}
      {...(isTV ? ({snapToItemPadding: space.page} as object) : null)}
      contentContainerStyle={contentStyle}
      ListHeaderComponent={header}
      onEndReachedThreshold={0.6}
      onEndReached={onEndReached}
      // PERF-02: mount about one screen of cards plus a small lead, not ten screens' worth.
      // Focus moves one card at a time, so a one-viewport lead is enough for the focus engine.
      initialNumToRender={visible}
      maxToRenderPerBatch={4}
      windowSize={3}
      updateCellsBatchingPeriod={50}
      removeClippedSubviews={false}
      // Space for the television focus scale so neighbours are not clipped.
      style={listStyle}
    />
  );
  return (
    <View style={[{marginBottom: isTV ? space.xl : space.xl}, style]} {...(isTV ? ({scrollSnapOffset: Math.round(window.height * 0.28)} as object) : null)}>
      {title ? (
        <View style={{flexDirection: 'row', alignItems: 'flex-end', justifyContent: 'space-between', paddingHorizontal: space.page, marginBottom: space.md}}>
          <View style={{flex: 1, paddingRight: space.md}}>
            <Text variant="heading" lines={1}>{title}</Text>
            {subtitle ? <Text variant="caption" tone="tertiary" lines={1}>{subtitle}</Text> : null}
          </View>
          {onSeeAll ? <Button variant="ghost" size="sm" label={seeAllLabel} trailingIcon="forward" onPress={onSeeAll} /> : null}
        </View>
      ) : null}
      {/* Each row remembers its last card once it has been visited; Left from the first card must reach the rail, so only Right is trapped. */}
      <FocusGroup trapRight>{content}</FocusGroup>
    </View>
  );
}
