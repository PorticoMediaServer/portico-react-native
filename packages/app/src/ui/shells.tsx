import React, {createContext, useCallback, useContext, useEffect, useMemo, useRef, useState} from 'react';
import {Animated, ScrollView, StyleSheet, Text, View, type NativeScrollEvent, type NativeSyntheticEvent, type StyleProp, type ViewStyle} from 'react-native';
import {PorticoIcon, type PorticoIconId} from '@portico-react-native/icons';
import {SafeAreaView, useSafeAreaInsets} from 'react-native-safe-area-context';
import {color, font} from './tokens';
import {Focusable, UnderlineTabs} from './primitives';
import {HeaderUtilities} from './sharedComponents';
import {type PrimaryDestination, usePorticoNavigationActions} from './navigation';
import {useReducedMotion} from './useReducedMotion';
import {productText} from './productCopy';
import {useMobileChromeMetrics} from './mobileChromeMetrics';
import {usePorticoAuth} from '@portico-react-native/infrastructure';
import {TV_COLLAPSED_CONTENT_INSET} from './tv/frameGeometry';

const primaryItems: ReadonlyArray<{
  id: PrimaryDestination;
  label: string;
  icon: PorticoIconId;
}> = [
  {id: 'home', label: productText('navigation.home'), icon: 'navigation.home'},
  {id: 'library', label: 'Library', icon: 'navigation.library'},
  {id: 'channels', label: 'Channels', icon: 'navigation.channels'},
  {id: 'saved', label: productText('navigation.saved'), icon: 'navigation.saved'},
  {id: 'downloads', label: productText('download.page-title'), icon: 'preference.downloads'},
];

type AnimatedInset = number | Animated.Value | Animated.AnimatedInterpolation<number>;
const TvContentInsetContext = createContext<AnimatedInset>(TV_COLLAPSED_CONTENT_INSET);

/**
 * Supplies the animated rail inset to standard React Navigation content.
 */
export function TvContentInsetProvider({children, value}: {children: React.ReactNode; value: AnimatedInset}) {
  return <TvContentInsetContext.Provider value={value}>{children}</TvContentInsetContext.Provider>;
}
type MobileHeaderContextValue = {
  onScroll: (event: NativeSyntheticEvent<NativeScrollEvent>) => void;
  scrollY: Animated.Value;
  surface: Animated.Value | Animated.AnimatedInterpolation<string> | string;
  divider: Animated.Value | Animated.AnimatedInterpolation<string> | string;
};
const MobileHeaderContext = createContext<MobileHeaderContextValue | undefined>(undefined);
const MOBILE_SCROLL_CACHE_LIMIT = 128;
const MOBILE_CHROME_CACHE_LIMIT = 32;
const mobileScrollOffsets = new Map<string, number>();
const mobileChromeHeights = new Map<string, number>();

function lruGet<T>(cache: Map<string, T>, key: string): T | undefined {
  const value = cache.get(key);
  if (value === undefined) return undefined;
  cache.delete(key);
  cache.set(key, value);
  return value;
}

function lruSet<T>(cache: Map<string, T>, key: string, value: T, limit: number) {
  cache.delete(key);
  cache.set(key, value);
  while (cache.size > limit) cache.delete(cache.keys().next().value!);
}

function canonicalMobileScopePart(value: unknown): unknown {
  if (value === undefined) return ['undefined'];
  if (value === null) return ['null'];
  if (typeof value !== 'object') return [typeof value, String(value)];
  if (Array.isArray(value)) {
    return ['array', value.map(canonicalMobileScopePart).sort((left, right) => JSON.stringify(left).localeCompare(JSON.stringify(right)))];
  }
  return ['object', Object.entries(value as Record<string, unknown>).sort(([left], [right]) => left.localeCompare(right)).map(([key, entry]) => [key, canonicalMobileScopePart(entry)])];
}

/** Builds collision-resistant route state keys for mobile scroll restoration. */
export function mobileChromeScope(...parts: unknown[]): string {
  return JSON.stringify(parts.map(canonicalMobileScopePart));
}

export function mobileScrollOffset(value: Animated.Value): number {
  const candidate = value as unknown as {__getValue?: () => number};
  return typeof candidate.__getValue === 'function' ? Math.max(0, candidate.__getValue()) : 0;
}

export function useMobileHomeScroll() {
  const context = useContext(MobileHeaderContext);
  return context ? {onScroll: context.onScroll, scrollY: context.scrollY} : {onScroll: undefined, scrollY: undefined};
}

export function mobileShellChromePolicy(routeName: string) {
  const ownsChrome = routeName === 'home';
  return {
    fullBleed: routeName === 'home' || routeName === 'detail' || routeName === 'player',
    ownsChrome,
    reservesContentSpace: false,
  } as const;
}

export function mobileShellShowsProductChrome(
  chromePolicy: Pick<ReturnType<typeof mobileShellChromePolicy>, 'ownsChrome'>,
  showProductChrome: boolean,
) {
  return showProductChrome && chromePolicy.ownsChrome;
}

export function useMobileChromeScroll(scope = 'mobile') {
  const scrollY = useMemo(() => new Animated.Value(lruGet(mobileScrollOffsets, scope) ?? 0), [scope]);
  const onScroll = useMemo(
    () => Animated.event(
      [{nativeEvent: {contentOffset: {y: scrollY}}}],
      {listener: event => {
        const nativeEvent = event.nativeEvent as NativeScrollEvent;
        lruSet(mobileScrollOffsets, scope, Math.max(0, nativeEvent.contentOffset.y), MOBILE_SCROLL_CACHE_LIMIT);
      }, useNativeDriver: false},
    ),
    [scope, scrollY],
  );
  return {initialOffset: lruGet(mobileScrollOffsets, scope) ?? 0, onScroll, scrollY};
}

function mobileChromeHeightEstimate(insetTop: number, pivot: boolean, controlRows: number): number {
  return insetTop + 58 + (pivot ? 49 : 0) + controlRows * 49;
}

export function MobileChromePivot({active, onChange, tabs}: {active: string; onChange(value: string): void; tabs: readonly string[]}) {
  const scrollRef = useRef<ScrollView>(null);
  const viewportWidth = useRef(0);
  const contentWidth = useRef(0);
  const tabLayouts = useRef(new Map<string, {width: number; x: number}>());
  const reducedMotion = useReducedMotion();
  const reveal = useCallback((tab: string) => {
    const layout = tabLayouts.current.get(tab);
    const viewport = viewportWidth.current;
    const content = contentWidth.current;
    if (!layout || viewport <= 0 || content <= viewport) return;
    const centered = layout.x - Math.max(0, (viewport - layout.width) / 2);
    const maxOffset = Math.max(0, content - viewport);
    scrollRef.current?.scrollTo({x: Math.max(0, Math.min(centered, maxOffset)), animated: !reducedMotion});
  }, [reducedMotion]);
  useEffect(() => reveal(active), [active, reveal]);
  return <ScrollView
    contentContainerStyle={styles.mobileChromePivotScroll}
    horizontal
    onContentSizeChange={width => {
      contentWidth.current = width;
      reveal(active);
    }}
    onLayout={event => {
      viewportWidth.current = event.nativeEvent.layout.width;
      reveal(active);
    }}
    ref={scrollRef}
    showsHorizontalScrollIndicator={false}>
    <UnderlineTabs
      active={active}
      onChange={value => {
        onChange(value);
        reveal(value);
      }}
      onTabLayout={(tab, x, width) => {
        tabLayouts.current.set(tab, {width, x});
        if (tab === active) reveal(tab);
      }}
      platform="mobile"
      tabs={tabs}
    />
  </ScrollView>;
}

export function MobileChromeScaffold({
  children,
  controlRows,
  controls,
  header,
  pivot,
  scrollY,
  testID,
}: {
  children: React.ReactElement;
  controlRows?: number;
  controls?: React.ReactNode;
  header: React.ReactNode;
  pivot?: React.ReactNode;
  scrollY: Animated.Value;
  testID?: string;
}) {
  const insets = useSafeAreaInsets();
  const {setPrimaryHeaderBottom, setTotalChromeHeight} = useMobileChromeMetrics();
  const reducedMotion = useReducedMotion();
  const [isScrolled, setIsScrolled] = useState(() => mobileScrollOffset(scrollY) > 0);
  useEffect(() => {
    if (!reducedMotion) return undefined;
    const listener = scrollY.addListener(({value}) => setIsScrolled(value > 0));
    return () => scrollY.removeListener(listener);
  }, [reducedMotion, scrollY]);
  const resolvedControlRows = controls ? Math.max(0, controlRows ?? 1) : 0;
  const chromeKey = `${testID ?? 'mobile'}:${insets.top}:${pivot ? 'pivot' : 'header'}:${resolvedControlRows}`;
  const estimatedChromeHeight = mobileChromeHeightEstimate(insets.top, Boolean(pivot), resolvedControlRows);
  const [chromeMeasurement, setChromeMeasurement] = useState<{key: string; height: number}>(() => ({key: chromeKey, height: lruGet(mobileChromeHeights, chromeKey) ?? estimatedChromeHeight}));
  const chromeHeight = chromeMeasurement.key === chromeKey
    ? chromeMeasurement.height
    : lruGet(mobileChromeHeights, chromeKey) ?? estimatedChromeHeight;
  useEffect(() => {
    const cached = lruGet(mobileChromeHeights, chromeKey);
    if (cached !== undefined && (chromeMeasurement.key !== chromeKey || cached !== chromeMeasurement.height)) setChromeMeasurement({key: chromeKey, height: cached});
  }, [chromeKey, chromeMeasurement]);
  const initialOffset = mobileScrollOffset(scrollY);
  const surface = reducedMotion ? (isScrolled ? color.scrim : color.transparent) : scrollY.interpolate({
    inputRange: [0, 24],
    outputRange: [color.transparent, color.scrim],
    extrapolate: 'clamp',
  });
  const divider = reducedMotion ? (isScrolled ? color.lineSoft : color.transparent) : scrollY.interpolate({
    inputRange: [0, 24],
    outputRange: [color.transparent, color.lineSoft],
    extrapolate: 'clamp',
  });
  const childProps = children.props as {contentContainerStyle?: StyleProp<ViewStyle>; contentOffset?: {x: number; y: number}};
  const contentPaddingTop = StyleSheet.flatten(childProps.contentContainerStyle)?.paddingTop;
  const content = React.cloneElement(children as React.ReactElement<any>, {
    contentContainerStyle: [childProps.contentContainerStyle, {paddingTop: (typeof contentPaddingTop === 'number' ? contentPaddingTop : 0) + chromeHeight}],
    contentOffset: childProps.contentOffset ?? {x: 0, y: initialOffset},
  });
  return (
    <View style={styles.mobileScaffold} testID={testID}>
      <Animated.View
        onLayout={event => {
          const nextHeight = Math.ceil(event.nativeEvent.layout.height);
          lruSet(mobileChromeHeights, chromeKey, nextHeight, MOBILE_CHROME_CACHE_LIMIT);
          if (nextHeight !== chromeHeight || chromeMeasurement.key !== chromeKey) setChromeMeasurement({key: chromeKey, height: nextHeight});
          setTotalChromeHeight(nextHeight);
        }}
        style={[styles.mobileScaffoldChrome, {backgroundColor: surface, borderBottomColor: divider, paddingTop: insets.top}]}
      >
        <View onLayout={event => setPrimaryHeaderBottom(Math.ceil(insets.top + event.nativeEvent.layout.height))} style={styles.mobilePrimaryHeader}>{header}</View>
        {pivot ? <View style={styles.mobileChromePivot}>{pivot}</View> : null}
        {controls ? <View style={styles.mobileChromeControls}>{controls}</View> : null}
      </Animated.View>
      <View style={styles.mobileScaffoldBody}>{content}</View>
    </View>
  );
}

export function TvSafeContent({children, enabled = true, fill = false, style}: {children: React.ReactNode; enabled?: boolean; fill?: boolean; style?: StyleProp<ViewStyle>}) {
  const paddingLeft = useContext(TvContentInsetContext);
  if (!enabled) return <View style={[fill && styles.tvSafeContentFill, style]}>{children}</View>;
  return <Animated.View style={[fill && styles.tvSafeContentFill, {paddingLeft}, style]}>{children}</Animated.View>;
}

export function MobileShell({children, ownsPrimaryNavigation, showProductChrome = true}: {children: React.ReactNode; ownsPrimaryNavigation: boolean; showProductChrome?: boolean}) {
  const {route, selectPrimary} = usePorticoNavigationActions();
  const auth = usePorticoAuth();
  // A signed-in account keeps its primary navigation available while the
  // selected server is unavailable. This also gives pushed offline/recovery
  // surfaces a deterministic way back without a route or focus reset.
  const primary = isPrimary(route.name) || !auth.session;
  const chromePolicy = mobileShellChromePolicy(route.name);
  const {onScroll, scrollY} = useMobileChromeScroll(mobileChromeScope('home', auth.session?.serverId, auth.session?.viewerScope.profileId));
  const {setPrimaryHeaderBottom} = useMobileChromeMetrics();
  const reducedMotion = useReducedMotion();
  const [isScrolled, setIsScrolled] = useState(() => mobileScrollOffset(scrollY) > 0);
  useEffect(() => {
    if (!reducedMotion) return undefined;
    const listener = scrollY.addListener(({value}) => setIsScrolled(value > 0));
    return () => scrollY.removeListener(listener);
  }, [reducedMotion, scrollY]);
  const surface = reducedMotion ? (isScrolled ? color.scrim : color.transparent) : scrollY.interpolate({inputRange: [0, 24], outputRange: [color.transparent, color.scrim], extrapolate: 'clamp'});
  const divider = reducedMotion ? (isScrolled ? color.lineSoft : color.transparent) : scrollY.interpolate({inputRange: [0, 24], outputRange: [color.transparent, color.lineSoft], extrapolate: 'clamp'});
  const mobileHeader = useMemo<MobileHeaderContextValue>(() => ({onScroll, scrollY, surface, divider}), [divider, onScroll, scrollY, surface]);
  return (
    <MobileHeaderContext.Provider value={mobileHeader}>
      <View style={styles.root}>
        <SafeAreaView
          edges={['left', 'right']}
          style={styles.mobileContent}>
          {children}
        </SafeAreaView>
        {mobileShellShowsProductChrome(chromePolicy, showProductChrome) ? <MobileHomeChrome onLayout={height => setPrimaryHeaderBottom(height)} /> : null}
        {showProductChrome && ownsPrimaryNavigation && primary ? <MobilePrimaryBar onSelect={selectPrimary} selected={isPrimary(route.name) ? route.name : 'home'} /> : null}
      </View>
    </MobileHeaderContext.Provider>
  );
}

/** Portico's established five-item visual bar, hosted by either shell or tab navigator. */
export function MobilePrimaryBar({
  onSelect,
  selected,
}: {
  onSelect(destination: PrimaryDestination): void;
  selected: PrimaryDestination;
}) {
  const insets = useSafeAreaInsets();
  return (
    <View style={[styles.bottomNav, {height: 64 + insets.bottom, paddingBottom: insets.bottom}]} testID="portico-four-mobile-navigation">
      {primaryItems.map(item => {
        const isSelected = selected === item.id;
        return (
          <Focusable
            accessibilityLabel={item.label}
            accessibilityRole="tab"
            accessibilityState={{selected: isSelected}}
            key={item.id}
            onPress={() => onSelect(item.id)}
            platform="mobile"
            style={styles.bottomNavItem}
            focusedStyle={styles.bottomNavItemFocused}
            pressedStyle={styles.bottomNavItemPressed}>
            <PorticoIcon color={isSelected ? color.screenBlueStrong : color.dimSilver} id={item.icon} size={23} state={isSelected ? 'selected' : 'default'} />
            <Text style={[styles.bottomNavLabel, isSelected && styles.bottomNavLabelSelected]}>{item.label}</Text>
            <View style={[styles.bottomNavRule, isSelected && styles.bottomNavRuleSelected]} />
          </Focusable>
        );
      })}
    </View>
  );
}

function MobileHomeChrome({onLayout}: {onLayout(height: number): void}) {
  const {openSearch} = usePorticoNavigationActions();
  const {surface, divider} = useContext(MobileHeaderContext)!;
  return (
      <Animated.View onLayout={event => onLayout(Math.ceil(event.nativeEvent.layout.height))} pointerEvents="box-none" style={[styles.mobileTopChrome, styles.mobileTopChromeSurface, {backgroundColor: surface, borderBottomColor: divider}]} testID="portico-mobile-top-chrome">
        <HeaderUtilities artworkHeader onSearch={openSearch} platform="mobile" />
      </Animated.View>
  );
}

function isPrimary(value: string | undefined): value is PrimaryDestination {
  return value === 'home' || value === 'library' || value === 'channels' || value === 'saved' || value === 'downloads';
}

const styles = StyleSheet.create({
  root: {backgroundColor: color.projector, flex: 1},
  mobileContent: {flex: 1},
  mobileTopChrome: {left: 0, position: 'absolute', right: 0, top: 0, zIndex: 65},
  mobileTopChromeSurface: {borderBottomWidth: 1},
  mobileScaffold: {backgroundColor: color.projector, flex: 1},
  mobileScaffoldBody: {flex: 1},
  mobileScaffoldChrome: {borderBottomWidth: 1, left: 0, position: 'absolute', right: 0, top: 0, zIndex: 65},
  mobilePrimaryHeader: {paddingHorizontal: 16},
  mobileChromePivot: {paddingHorizontal: 16},
  mobileChromePivotScroll: {flexGrow: 0},
  mobileChromeControls: {paddingBottom: 12, paddingHorizontal: 16},
  bottomNav: {backgroundColor: color.projector, borderTopColor: color.line, borderTopWidth: 1, flexDirection: 'row', height: 64, zIndex: 60},
  bottomNavItem: {alignItems: 'center', borderColor: color.transparent, borderTopWidth: 2, flex: 1, justifyContent: 'center', paddingTop: 5},
  bottomNavItemFocused: {backgroundColor: color.recess},
  bottomNavItemPressed: {backgroundColor: color.raisedSlate},
  bottomNavLabel: {color: color.dimSilver, fontFamily: font.medium, fontSize: 10, lineHeight: 14, marginTop: 3},
  bottomNavLabelSelected: {color: color.screenBlueStrong},
  bottomNavRule: {backgroundColor: color.transparent, bottom: 0, height: 2, position: 'absolute', width: 28},
  bottomNavRuleSelected: {backgroundColor: color.screenBlue},
  tvSafeContentFill: {flex: 1, minWidth: 0},
});
