import React, {useRef} from 'react';
import {uiI18n} from './i18n';
import {FlatList, ScrollView, View, VirtualizedList, type FlatListProps, type ScrollViewProps, type StyleProp, type ViewStyle, type VirtualizedListProps} from 'react-native';
import {useSafeAreaInsets} from 'react-native-safe-area-context';
import {Button} from './Button';
import {Focusable} from './Focusable';
import {Icon} from './Icon';
import {Text} from './Text';
import {useTheme} from './theme';
import {useNavTitle, useReportScroll} from './NavBar';

/**
 * Page header: title, optional eyebrow (server / library name), and a row of
 * utility actions. Kept as one component so every destination lines up.
 */
export function PageHeader({title, eyebrow, subtitle, actions, onBack, backLabel = uiI18n().t('action.back'), onTitlePress, style}: {title: string; eyebrow?: string; subtitle?: string; actions?: React.ReactNode; onBack?: () => void; backLabel?: string; onTitlePress?: (anchor: {x: number; y: number; width: number; height: number}) => void; style?: StyleProp<ViewStyle>}) {
  const {space, colors, metrics, isTV} = useTheme();
  // A pushed screen's header names it for the navigation bar that takes over once this has scrolled away.
  useNavTitle(title, onBack);
  const titleRef = useRef<View>(null);
  const pressTitle = () => {
    const node = titleRef.current;
    if (!node || !onTitlePress) return;
    node.measureInWindow((x, y, width, height) => onTitlePress({x, y, width, height}));
  };
  return (
    <View style={[{paddingHorizontal: space.page, paddingTop: space.lg, paddingBottom: space.md, gap: space.sm}, style]}>
      {/* APL-SET-04: on television the remote's Back/Menu is authoritative, so no on-screen Back competes for the first focus. */}
      {onBack && !isTV ? <Button variant="ghost" size="sm" icon="back" label={backLabel} onPress={onBack} style={{marginLeft: -space.sm}} /> : null}
      <View style={{flexDirection: 'row', alignItems: 'flex-end', justifyContent: 'space-between', gap: space.md}}>
        <View style={{flex: 1}}>
          {eyebrow ? <Text variant="label" tone="tertiary" lines={1}>{eyebrow}</Text> : null}
          {onTitlePress ? (
            <Focusable accessibilityRole="button" accessibilityLabel={uiI18n().t('library.switchLabel', {title})} radius={metrics.radius.small} scale={1} ring={false} onPress={pressTitle} style={{alignSelf: 'flex-start'}}>
              <View ref={titleRef} collapsable={false} style={{flexDirection: 'row', alignItems: 'center', gap: space.xs}}>
                <Text variant="title" lines={1}>{title}</Text>
                <Icon name="chevronDown" size={metrics.iconSmall} color={colors.textSecondary} />
              </View>
            </Focusable>
          ) : (
            <Text variant="title" lines={1}>{title}</Text>
          )}
          {subtitle ? <Text variant="caption" tone="secondary" lines={1}>{subtitle}</Text> : null}
        </View>
        {actions ? <View style={{flexDirection: 'row', gap: space.sm, alignItems: 'center'}}>{actions}</View> : null}
      </View>
    </View>
  );
}

/** Vertical scrolling page body with safe-area bottom padding. On touch, the status bar gets an
 * opaque backing so scrolled content never runs under the clock (IOS-HOME-01, for every page). */
export function Page({children, style, contentStyle, ...rest}: ScrollViewProps & {children: React.ReactNode; contentStyle?: StyleProp<ViewStyle>}) {
  const insets = useSafeAreaInsets();
  const {space, isTV, colors} = useTheme();
  // The backing appears only once content has moved under the status bar, so the page's own
  // atmosphere shows at rest. State changes only when the threshold is crossed.
  const [scrolled, setScrolled] = React.useState(false);
  const report = useReportScroll();
  const onScroll: ScrollViewProps['onScroll'] = e => {
    const past = e.nativeEvent.contentOffset.y > 4;
    if (past !== scrolled) setScrolled(past);
    report(e);
    rest.onScroll?.(e);
  };
  const scroll = (
    <ScrollView {...rest} onScroll={isTV ? rest.onScroll : onScroll} scrollEventThrottle={rest.scrollEventThrottle ?? 32} {...(isTV ? ({snapToAlignment: 'item'} as object) : null)} style={[{flex: 1}, style]} contentContainerStyle={[{paddingTop: isTV ? Math.max(insets.top, 60) - space.lg : insets.top, paddingBottom: insets.bottom + space.xxxl}, contentStyle]} keyboardShouldPersistTaps="handled">
      {children}
    </ScrollView>
  );
  if (isTV || !insets.top) return scroll;
  return (
    <View style={{flex: 1}}>
      {scroll}
      {scrolled ? <View pointerEvents="none" style={{position: 'absolute', top: 0, left: 0, right: 0, height: insets.top, backgroundColor: colors.ink}} /> : null}
    </View>
  );
}

/**
 * PERF-02: a page whose body is a list of rows (Home's shelves). Same insets and snapping as
 * `Page`, but only the rows near the viewport are mounted.
 */
export function PageList<T>({contentStyle, ...rest}: FlatListProps<T> & {contentStyle?: StyleProp<ViewStyle>}) {
  const insets = useSafeAreaInsets();
  const {space, isTV} = useTheme();
  // tvOS: VirtualizedList wraps its ScrollView in a style-less TVFocusGuideView, which shrink-wraps,
  // so `flex: 1` on the list collapsed it to one point and the page drew nothing. On television the
  // list gets the measured height of its slot instead.
  const [height, setHeight] = React.useState(0);
  const report = useReportScroll();
  const list = (
    <FlatList
      initialNumToRender={3}
      maxToRenderPerBatch={2}
      windowSize={isTV ? 3 : 5}
      updateCellsBatchingPeriod={50}
      removeClippedSubviews={false}
      keyboardShouldPersistTaps="handled"
      // No item snapping here: on a FlatList the snap targets are the cells, and tvOS snapped the
      // page past its header on first focus. Focus-driven scrolling keeps the focused row in view.
      {...rest}
      onScroll={isTV ? rest.onScroll : e => { report(e); rest.onScroll?.(e); }}
      scrollEventThrottle={rest.scrollEventThrottle ?? 32}
      style={[isTV ? {height} : {flex: 1}, rest.style]}
      contentContainerStyle={[{paddingTop: isTV ? Math.max(insets.top, 60) - space.lg : insets.top, paddingBottom: insets.bottom + space.xxxl}, contentStyle]}
    />
  );
  if (!isTV) return list;
  return <View style={{flex: 1}} onLayout={e => setHeight(e.nativeEvent.layout.height)}>{height ? list : null}</View>;
}

/**
 * `PageList` for a list whose rows are counted rather than held in an array (`getItemCount` and
 * `getItem`, as a windowed collection is read): a page whose list can switch between its own rows
 * and a windowed one keeps one scroller, so the header above them is never drawn again.
 */
export function PageRows<T>({contentStyle, listRef, ...rest}: VirtualizedListProps<T> & {contentStyle?: StyleProp<ViewStyle>; listRef?: React.Ref<VirtualizedList<T>>}) {
  const insets = useSafeAreaInsets();
  const {space, isTV} = useTheme();
  const [height, setHeight] = React.useState(0);
  const report = useReportScroll();
  const list = (
    <VirtualizedList<T>
      ref={listRef}
      initialNumToRender={12}
      maxToRenderPerBatch={10}
      windowSize={isTV ? 5 : 7}
      updateCellsBatchingPeriod={50}
      removeClippedSubviews={false}
      keyboardShouldPersistTaps="handled"
      {...rest}
      onScroll={isTV ? rest.onScroll : e => { report(e); rest.onScroll?.(e); }}
      scrollEventThrottle={rest.scrollEventThrottle ?? 32}
      style={[isTV ? {height} : {flex: 1}, rest.style]}
      contentContainerStyle={[{paddingTop: isTV ? Math.max(insets.top, 60) - space.lg : insets.top, paddingBottom: insets.bottom + space.xxxl}, contentStyle]}
    />
  );
  if (!isTV) return list;
  return <View style={{flex: 1}} onLayout={e => setHeight(e.nativeEvent.layout.height)}>{height ? list : null}</View>;
}

/** Content block with page gutters. */
export function Section({children, title, style, gutter = true}: {children: React.ReactNode; title?: string; style?: StyleProp<ViewStyle>; gutter?: boolean}) {
  const {space} = useTheme();
  return (
    <View style={[{paddingHorizontal: gutter ? space.page : 0, marginBottom: space.xl, gap: space.md}, style]}>
      {title ? <Text variant="heading">{title}</Text> : null}
      {children}
    </View>
  );
}
