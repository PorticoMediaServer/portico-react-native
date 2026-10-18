import React, {forwardRef, useCallback, useEffect, useImperativeHandle, useMemo, useRef, useState, useSyncExternalStore} from 'react';
import {ScrollView, TVFocusGuideView, View, type StyleProp, type ViewStyle} from 'react-native';
import {useSafeAreaInsets} from 'react-native-safe-area-context';
import Animated, {Easing, interpolateColor, useAnimatedStyle, useSharedValue, withTiming, type SharedValue} from 'react-native-reanimated';
import type {Library} from '../../../../packages/client-core/src/index';
import {mediaFamilyIcon} from '../../../../packages/design/src/index';
import {iconFor} from '../../../../packages/client-core/src/presentation/index';
import {BrandMark, Focusable, Icon, Text, Wordmark, alpha, spec, useSpecPlatform, useTheme, type FocusableHandle, type IconName} from '../ui';
import {railBrowsing} from '../ui/theme';
import {useUnreadCount} from '../app/inbox';
import {useServerPreferences} from '../app/server-preferences';
import {useI18n, type MessageId} from '../app/i18n';
import {createRailExpansion, type RailExpansion} from './rail-expansion';
import {railBrandGeometry, railGeometry, railRowHeight, type RailGeometry} from './rail-geometry';
import type {PinnedResource} from '../../../../packages/client-core/src/library-pins';
import {pinnedResourceIcon} from '../app/pins';

const NO_PINS: readonly PinnedResource[] = [];
/** The panel's right border. */
const railBorder = 1;

export type RailKey = 'Home' | 'Search' | 'Saved' | 'Channels' | 'Settings' | 'Downloads' | `library:${string}` | `pin:${string}`;

type Item = {key: RailKey; label: string; icon: IconName; kind?: string};

/** TV-RAIL-08: the shared family icon, except Anime (the family shares TV's monitor, which made the two
 * rows identical while the rail is collapsed) and an unknown kind (a library, not a movie). */
/** A library's icon, the web's (`iconFor`): Anime has its own, not a second TV. Unknown kinds read as a library. */
export const railLibraryIcon = (kind: string): IconName => (mediaFamilyIcon(kind) ? iconFor(kind) : 'library') as IconName;

const primary: (Omit<Item, 'label'> & {labelId: MessageId})[] = [
  {key: 'Home', labelId: 'web.shell.home', icon: 'home'},
  {key: 'Search', labelId: 'web.shell.search', icon: 'search'},
  {key: 'Saved', labelId: 'web.shell.saved', icon: 'saved'},
  // Channels: Live TV, Library Channels and Recordings in one destination (shown when a source exists).
  {key: 'Channels', labelId: 'channels.title', icon: 'channels'},
  // A wide tablet has the rail in place of the tab bar, so Downloads is a destination here too
  // (offered by the same rule as the tab; never on television).
  {key: 'Downloads', labelId: 'web.shell.downloads', icon: 'download'},
];

/**
 * The persistent left rail. Television and iPad: icons at rest, expands to
 * icons + labels while focused or hovered. iPhone: a compact icon column.
 * Selected destination carries the accent bar; libraries use family icons.
 */
export type RailHandle = {focus: () => void; isFocused: () => boolean};

export const Rail = forwardRef<RailHandle, {libraries: readonly Library[]; /** Pinned collections, saved views and playlists, between the destinations and the libraries. */ pinned?: readonly PinnedResource[]; selected: RailKey; onSelect: (key: RailKey) => void; profileName?: string; serverName?: string; showChannels?: boolean; /** Offered on a wide tablet when this profile may download or has downloads on the device. */ showDownloads?: boolean; onFocusChange?: (focused: boolean) => void; /** 0 collapsed → 1 expanded, for the shell to push the content aside (APL-SHELL-07). */ expansion?: SharedValue<number>; /** Libraries with a running scan (ONB-04): a dot on the entry. */ scanning?: ReadonlySet<string>}>(function Rail({libraries, pinned = NO_PINS, selected, onSelect, profileName, serverName, showChannels = true, showDownloads = false, onFocusChange, expansion, scanning}, ref) {
  const i18n = useI18n();
  const {colors, space, metrics, isTV, window, motion} = useTheme();
  const insets = useSafeAreaInsets();
  // The profile's "Show unread badge" preference decides whether unread notifications mark Settings.
  const unread = useUnreadCount();
  const badges = useServerPreferences().value<boolean>('notifications.badges', true);
  const compact = !isTV && window.width < 700;
  // PERF-06: expansion lives in a shared value, never in React state. Opening writes the shared
  // value (panel position, label/wordmark opacity and the background crossfade all read it on the
  // UI thread) and notifies the labels' a11y channel; rail items have no subscription and keep
  // stable props, so a toggle performs zero RailItem renders.
  const progress = useSharedValue(0);
  const ctl = useMemo<RailExpansion>(() => createRailExpansion({shared: progress, collapsedWidth: metrics.railWidth, expandedWidth: metrics.railWidthExpanded}), [progress, metrics.railWidth, metrics.railWidthExpanded]);
  const timing = {duration: motion.reduce ? 0 : motion.standard, easing: Easing.out(Easing.cubic)};
  const setExpanded = useCallback((next: boolean) => {
    const open = next && !compact;
    if (open) ctl.expand();
    else ctl.collapseNow();
    const target = open ? 1 : 0;
    progress.value = withTiming(target, timing);
    if (expansion) expansion.value = withTiming(target, timing);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [compact, motion.reduce, motion.standard, ctl, progress, expansion]);
  // Orientation (compact) can change while open: snap the visuals without touching items.
  useEffect(() => {
    const target = ctl.isExpanded() && !compact ? 1 : 0;
    progress.value = withTiming(target, timing);
    if (expansion) expansion.value = withTiming(target, timing);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [compact]);
  // APL-SHELL-06: focus is tracked per item. The container's own onFocus/onBlur do not fire
  // reliably for moves between descendants on tvOS Fabric, which let the collapse timer win while
  // focus was still inside. The rail only collapses (and only reports that it lost focus) once no
  // item has had focus for a moment.
  const blurTimer = useRef<ReturnType<typeof setTimeout>>(undefined);
  // TV-SHELL-01: the Menu key's "may leave the app" flag follows focus exactly (no debounce), so a
  // Menu pressed just after focus left the rail never exits; only the visual collapse waits.
  // tvOS may report the next item's focus before the previous item's blur, so a blur only counts
  // when it is for the item that still holds focus.
  const focusedKey = useRef<string | undefined>(undefined);
  React.useEffect(() => () => clearTimeout(blurTimer.current), []);
  const items_ref = useRef(new Map<string, FocusableHandle | null>());
  // Real focus, separate from `expanded` (which pointer hover also sets), so
  // the shell's Menu-key decision is about focus and nothing else.
  const focusedRef = useRef(false);
  // Resting on a destination that is not the one on screen means the viewer is still choosing;
  // a screen that finishes loading meanwhile leaves focus where they put it.
  const resting = useRef<string | undefined>(undefined);
  const browse = (key: string | undefined) => { resting.current = key; railBrowsing.current = key !== undefined && key !== selected; };
  React.useEffect(() => { railBrowsing.current = resting.current !== undefined && resting.current !== selected; }, [selected]);
  React.useEffect(() => () => { railBrowsing.current = false; }, []);
  useImperativeHandle(ref, () => ({focus: () => (items_ref.current.get(selected) ?? items_ref.current.values().next().value)?.focus(), isFocused: () => focusedRef.current}), [selected]);
  // Entering the rail from the content always lands on the destination on screen, not on whatever
  // was focused last (NAV-8). The guide redirects entry to it.
  const [entry, setEntry] = useState<View | null>(null);
  React.useEffect(() => {
    const frame = requestAnimationFrame(() => setEntry((items_ref.current.get(selected)?.node?.() as View | null | undefined) ?? null));
    return () => cancelAnimationFrame(frame);
  }, [selected, libraries]);
  const scroller = useRef<ScrollView>(null);
  // PERF-06: the panel is always railWidthExpanded wide; when collapsed it sits left by exactly
  // the difference, so only railWidth shows. The slide and the background crossfade run on the UI
  // thread (transform + color, never a layout property), with the same timing the shell uses to
  // push the content aside.
  const collapsedBg = alpha(colors.ink, isTV ? 0.5 : 0.72);
  // A plain number captured by the worklet: calling ctl.collapsedX() inside it would be a
  // synchronous call from the UI runtime into a JS-thread function, which Reanimated refuses.
  const collapsedX = ctl.collapsedX();
  const panelStyle = useAnimatedStyle(() => ({
    width: metrics.railWidthExpanded,
    transform: [{translateX: (1 - progress.value) * collapsedX}],
    backgroundColor: interpolateColor(progress.value, [0, 1], [collapsedBg, colors.ink]),
  }), [collapsedBg, colors.ink, collapsedX, metrics.railWidthExpanded, progress]);
  // TV-RAIL-02: collapsed, only the panel's rightmost railWidth is on screen. The header, the
  // dividers and each row's foreground are counter-translated by exactly the panel's slide, so
  // they stay where the viewer sees them through the whole animation (no midpoint switch of
  // margin, padding or display); the rows' Focusables never move within the panel, so their native
  // focus frames are the same in every state. See rail-geometry.ts.
  const paddingX = isTV ? space.md : compact ? 6 : space.sm;
  const geo = useMemo(() => railGeometry({railWidth: metrics.railWidth, railWidthExpanded: metrics.railWidthExpanded, paddingX, border: railBorder, icon: compact ? 22 : metrics.icon, gap: space.md, dividerInset: space.xs}), [metrics.railWidth, metrics.railWidthExpanded, paddingX, compact, metrics.icon, space.md, space.xs]);
  const {hiddenWidth, collapsedInner, dividerInset, dividerWidth} = geo;
  const counter = useAnimatedStyle(() => ({transform: [{translateX: hiddenWidth * (1 - progress.value)}]}), [progress, hiddenWidth]);
  // A divider is a full-width line scaled (a transform, never a layout property) to the row
  // surface's width less its insets, about its left end.
  const dividerStyle = useAnimatedStyle(() => {
    const p = progress.value;
    const scaleX = (collapsedInner + hiddenWidth * p - 2 * dividerInset) / dividerWidth;
    return {transform: [{translateX: hiddenWidth * (1 - p) - (dividerWidth / 2) * (1 - scaleX)}, {scaleX}]};
  }, [progress, collapsedInner, hiddenWidth, dividerInset, dividerWidth]);
  // TV-RAIL-07: the brand is the wordmark alone when open and the symbol alone when closed, and
  // its P is identical in both: same height, top and left (Justin, 18 Oct 2026; as on the web).
  // The symbol is drawn at the wordmark's height and origin, which is where the wordmark's own P is
  // (brand-ink.ts), and that P is centred in the collapsed column like the row icons.
  const brandHeight = isTV ? 52 : 36;
  const brandSlot = brandHeight + (isTV ? 10 : 8);
  const brand = useMemo(() => railBrandGeometry({brandHeight, slotHeight: brandSlot, collapsedInner}), [brandHeight, brandSlot, collapsedInner]);
  // Item objects and callbacks are stable across expansion toggles, so the memoised RailItems
  // below skip re-rendering when the rail opens or closes.
  const items: Item[] = useMemo(() => [
    ...primary.filter(i => (i.key === 'Channels' ? showChannels : i.key === 'Downloads' ? showDownloads : true)).map(({labelId, ...rest}) => ({...rest, label: i18n.t(labelId)})),
    ...pinned.map<Item>(p => ({key: `pin:${p.kind}:${p.id}`, label: p.name, icon: pinnedResourceIcon(p.kind)})),
    ...libraries.map<Item>(l => ({key: `library:${l.id}`, label: l.name, icon: railLibraryIcon(l.kind), kind: l.kind})),
  ], [libraries, pinned, showChannels, showDownloads, i18n]);
  // A rule before the pinned items, before the libraries, and between pinned and other libraries.
  const dividers = useMemo(() => {
    const out = new Set<string>();
    const firstPin = items.find(i => i.key.startsWith('pin:'));
    const firstLibrary = items.find(i => i.key.startsWith('library:'));
    if (firstPin) out.add(firstPin.key);
    if (firstLibrary) out.add(firstLibrary.key);
    const firstUnpinned = libraries.findIndex(l => l.pinned !== true);
    if (firstUnpinned > 0) out.add(`library:${libraries[firstUnpinned]!.id}`);
    return out;
  }, [items, libraries]);
  // ONB-04: a scanning library carries the same dot as an unread badge (decorative; the library
  // screen header carries the words). Applied at render so `items` stays memoised on scan changes.
  const scanningDot = (item: Item) => item.key.startsWith('library:') && !!scanning?.has(item.key.slice('library:'.length));
  const latest = useRef({onSelect, onFocusChange});
  latest.current = {onSelect, onFocusChange};
  const handleFocus = useCallback((key: RailKey, index?: number) => {
    clearTimeout(blurTimer.current);
    focusedKey.current = key;
    focusedRef.current = true;
    latest.current.onFocusChange?.(true);
    setExpanded(true);
    browse(key);
    if (index === 0) scroller.current?.scrollTo({y: 0, animated: false});
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [setExpanded]);
  const handleBlur = useCallback((key: RailKey) => {
    if (focusedKey.current !== key) return;
    focusedKey.current = undefined;
    clearTimeout(blurTimer.current);
    focusedRef.current = false;
    latest.current.onFocusChange?.(false);
    // TV-RAIL-03: focus truth changes at once (the Menu exit gate needs it), but the rail only closes
    // once no item has held focus for 140 ms, so stepping between items never starts a collapse.
    blurTimer.current = setTimeout(() => {
      if (focusedRef.current) return;
      setExpanded(false);
      browse(undefined);
    }, 140);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [setExpanded]);
  const handlePress = useCallback((key: RailKey) => {
    latest.current.onSelect(key);
  }, []);
  const top = Math.max(insets.top, isTV ? 60 : 0);
  const settingsItem: Item = useMemo(() => ({key: 'Settings', label: profileName ? profileName : i18n.t('web.shell.settings'), icon: 'account'}), [profileName, i18n]);
  // TV-RAIL-06: it reads as the profile's name, but says where it goes and whose server it is.
  const settingsA11y = [i18n.t('web.shell.settings'), profileName, serverName].filter(Boolean).join(', ');
  // The rail always occupies its collapsed width in the layout and opens OVER the content. If it
  // widened in the flow instead, everything beside it would re-measure and shift while the focus
  // engine was in the middle of choosing where to go.
  // Its only child is absolute, so this footprint has no in-flow height of its own: it must grow to
  // fill the focus guide's column (alignSelf only stretches it across), or the rail is clipped to
  // its padding and every destination disappears.
  const Footprint = isTV ? TVFocusGuideView : View;
  return (
    <Footprint {...(isTV ? {destinations: entry ? [entry] : undefined} : {})} style={{width: metrics.railWidth, flexGrow: 1, alignSelf: 'stretch', zIndex: 20}}>
    <Animated.View
      style={[
        {
          // Always the full height of the screen, however few destinations it holds.
          position: 'absolute',
          left: 0,
          top: 0,
          bottom: 0,
          paddingTop: top + (isTV ? space.md : space.md),
          paddingBottom: Math.max(insets.bottom, isTV ? 40 : space.md),
          paddingHorizontal: paddingX,
          borderRightWidth: railBorder,
          borderRightColor: alpha(colors.lineSoft, 0.7),
          overflow: 'hidden',
        },
        panelStyle,
      ]}
      onPointerEnter={() => !compact && setExpanded(true)}
      onPointerLeave={() => { if (!focusedRef.current) setExpanded(false); }}>
      <View style={{marginBottom: space.lg, height: brandSlot}}>
        <Animated.View style={[{position: 'absolute', left: 0, top: 0, bottom: 0, width: geo.expandedInner}, counter]}>
          {/* The symbol under the wordmark: the wordmark fades in over it with the same P on the same pixels. */}
          <RailA11y style={{position: 'absolute', left: brand.x, top: brand.y}} ctl={ctl} shared={progress} visibleWhen="collapsed" forceHidden={compact}>
            <BrandMark size={brand.size} />
          </RailA11y>
          <RailA11y style={{position: 'absolute', left: brand.x, top: brand.y}} ctl={ctl} shared={progress} visibleWhen="expanded" forceHidden={compact}>
            <Wordmark height={brand.size} />
          </RailA11y>
        </Animated.View>
      </View>
      <ScrollView ref={scroller} showsVerticalScrollIndicator={false} contentContainerStyle={{gap: compact ? 2 : isTV ? 4 : space.xs, paddingVertical: isTV ? 4 : 0, paddingHorizontal: isTV ? 4 : 0}} style={[{flex: 1}, isTV ? {marginHorizontal: -4} : null]}>
        {items.map((item, index) => (
          <React.Fragment key={item.key}>
            {dividers.has(item.key) ? (
              <View style={{height: 1, marginVertical: space.sm}}>
                <Animated.View style={[{position: 'absolute', top: 0, left: dividerInset, width: dividerWidth, height: 1, backgroundColor: alpha(colors.lineSoft, 0.8)}, dividerStyle]} />
              </View>
            ) : null}
            <RailItem ref={h => { items_ref.current.set(item.key, h); }} item={item} active={selected === item.key} compact={compact} shared={progress} ctl={ctl} geo={geo} forceHidden={compact} badge={scanningDot(item)} onFocus={handleFocus} onBlur={handleBlur} onPress={handlePress} focusIndex={index} />
          </React.Fragment>
        ))}
      </ScrollView>
      <RailItem ref={h => { items_ref.current.set('Settings', h); }} item={settingsItem} sub={serverName} badge={badges && unread > 0} a11yLabel={settingsA11y} a11yValue={badges && unread > 0 ? i18n.t('notifications.unreadLabel', {count: unread}) : undefined} active={selected === 'Settings'} compact={compact} shared={progress} ctl={ctl} geo={geo} forceHidden={compact} onFocus={handleFocus} onBlur={handleBlur} onPress={handlePress} />
    </Animated.View>
    </Footprint>
  );
});

/**
 * PERF-06: labels and the wordmark are always mounted, in a layout that never changes.
 * Visibility is opacity from the shared value, and this view is its only owner (TV-RAIL-02: no
 * second fade above it, which darkened the hand-over); assistive technology follows the a11y
 * channel. Re-renders only this small subtree — never the `RailItem` above it.
 * The collapsed-only content (the brand symbol) stays fully drawn until the rail is fully open:
 * the wordmark fading in over it carries the same P on the same pixels, so the P never dims and
 * only the letters after it appear.
 */
function RailA11y({ctl, shared, visibleWhen, forceHidden, style, children}: {ctl: RailExpansion; shared: {value: number}; visibleWhen: 'expanded' | 'collapsed'; /** Compact rails never show labels. */ forceHidden: boolean; /** Layout of the block itself (its flex space, or its place in the header). */ style?: StyleProp<ViewStyle>; children: React.ReactNode}) {
  const hidden = useSyncExternalStore(ctl.subscribeA11y, () => forceHidden || (visibleWhen === 'expanded') !== ctl.isExpanded());
  const visibility = useAnimatedStyle(() => ({
    opacity: forceHidden ? 0 : visibleWhen === 'expanded' ? shared.value : shared.value < 1 ? 1 : 0,
  }), [shared, visibleWhen, forceHidden]);
  return (
    <Animated.View style={[style, visibility]} accessibilityElementsHidden={hidden} importantForAccessibility={hidden ? 'no-hide-descendants' : 'auto'}>
      {children}
    </Animated.View>
  );
}

const RailItem = React.memo(forwardRef<FocusableHandle, {item: Item; active: boolean; compact: boolean; shared: SharedValue<number>; ctl: RailExpansion; /** The rail's geometry (memoised: a stable prop). */ geo: RailGeometry; forceHidden: boolean; sub?: string; badge?: boolean; /** What assistive technology says, when it is more than the visible label. */ a11yLabel?: string; /** State the row's dot shows (unread notifications). */ a11yValue?: string; onFocus: (key: RailKey, index?: number) => void; onBlur: (key: RailKey) => void; onPress: (key: RailKey) => void; /** Scroll position reset when the first destination takes focus. */ focusIndex?: number}>(function RailItem({item, active, compact, shared, ctl, geo, forceHidden, sub, badge, a11yLabel, a11yValue, onFocus, onBlur, onPress, focusIndex}, ref) {
  const {colors, space, metrics, isTV, type, motion} = useTheme();
  const platform = useSpecPlatform();
  const labelRole = isTV ? 'bodyStrong' : 'captionStrong';
  // APL-SHELL-05: 64 pt on television (the ten-foot minimum) so every destination fits 1080p.
  // TV-RAIL-05: a row with a subtitle (Settings) is a subtitle row (rowSpec), tall enough for both
  // lines at any text size, open or closed alike; it may still grow with its text.
  const size = railRowHeight({single: compact ? 48 : isTV ? metrics.control : 56, withSubtitle: sub && !compact ? spec.row.minHeight.withSubtitle[platform] : undefined, titleLine: type[labelRole].lineHeight ?? 0, subtitleLine: type[spec.row.subtitle.role].lineHeight ?? 0, paddingY: spec.row.paddingY[platform]});
  // TV-RAIL-04: the row's own focus treatment (focusSpec, rows): a ring inside the visible surface
  // and the row focus scale, about that surface. Focus never replaces the fill. Driven here, so the
  // Focusable's own ring (outside a full-width host that is mostly off screen) stays off.
  const focus = useSharedValue(0);
  const focusTiming = {duration: motion.reduce ? 0 : motion.quick, easing: Easing.out(Easing.cubic)};
  const rowScale = isTV ? spec.focus.scale.row.tv : 1;
  // TV-RAIL-02: the foreground undoes the panel's slide, so the icon and label never move on
  // screen; only the surface's width follows the panel's visible edge. Its formulas are
  // foregroundX and surfaceWidth in rail-geometry.ts. The surface is an absolute decorative leaf:
  // its width is the only layout the animation touches, and nothing else is laid out around it.
  const {hiddenWidth, collapsedInner, expandedInner} = geo;
  const foreground = useAnimatedStyle(() => {
    const p = shared.value;
    const scale = 1 + (rowScale - 1) * focus.value;
    return {transform: [{translateX: hiddenWidth * (1 - p) + ((collapsedInner + hiddenWidth * p) / 2 - expandedInner / 2) * (1 - scale)}, {scale}]};
  }, [shared, focus, rowScale, hiddenWidth, collapsedInner, expandedInner]);
  const surface = useAnimatedStyle(() => ({width: collapsedInner + hiddenWidth * shared.value}), [shared, collapsedInner, hiddenWidth]);
  const ring = useAnimatedStyle(() => ({opacity: focus.value}), [focus]);
  return (
    <Focusable
      ref={ref}
      accessibilityRole="button"
      accessibilityLabel={a11yLabel ?? item.label}
      accessibilityValue={a11yValue ? {text: a11yValue} : undefined}
      accessibilityState={{selected: active}}
      radius={metrics.radius.control}
      scale={1}
      ring={false}
      onFocus={() => { focus.value = withTiming(1, focusTiming); onFocus(item.key, focusIndex); }}
      onBlur={() => { focus.value = withTiming(0, focusTiming); onBlur(item.key); }}
      onPress={() => onPress(item.key)}
      style={{alignSelf: 'stretch'}}>
      {({focused, hovered}) => (
        <Animated.View style={[{minHeight: size, flexDirection: 'row', alignItems: 'center', gap: space.md, paddingLeft: geo.iconX, paddingRight: space.md}, foreground]}>
          {/* The visible surface: fill, selected bar and focus ring. Without a focus ring (iPad), keyboard focus keeps its fill. */}
          <Animated.View pointerEvents="none" style={[{position: 'absolute', left: 0, top: 0, bottom: 0, borderRadius: metrics.radius.control, backgroundColor: hovered ? alpha(colors.raisedHigh, 0.6) : active ? alpha(colors.accent, 0.14) : focused && !isTV ? colors.raisedHigh : 'transparent'}, surface]}>
            {active ? <View style={{position: 'absolute', left: 0, top: '25%', bottom: '25%', width: 3, borderRadius: 2, backgroundColor: colors.accent}} /> : null}
            {isTV ? <Animated.View style={[{position: 'absolute', left: 0, top: 0, right: 0, bottom: 0, borderRadius: metrics.radius.control, borderWidth: spec.focus.ringWidth.tv, borderColor: colors.focus}, ring]} /> : null}
          </Animated.View>
          <View>
            <Icon name={item.icon} size={compact ? 22 : metrics.icon} color={active || focused ? colors.text : colors.textSecondary} />
            {badge ? <View style={{position: 'absolute', top: -2, right: -4, width: 9, height: 9, borderRadius: 5, backgroundColor: colors.accent}} /> : null}
          </View>
          {/* TV-RAIL-01/02: the icon is centred in the collapsed surface by geometry (geo.iconX), so the
              label keeps its place and only fades. */}
          <RailA11y style={{flex: 1, minWidth: 0}} ctl={ctl} shared={shared} visibleWhen="expanded" forceHidden={forceHidden}>
            <Text variant={labelRole} lines={1} style={{color: active || focused ? colors.text : colors.textSecondary}}>{item.label}</Text>
            {sub ? <Text variant={spec.row.subtitle.role} tone="tertiary" lines={1}>{sub}</Text> : null}
          </RailA11y>
        </Animated.View>
      )}
    </Focusable>
  );
}));
