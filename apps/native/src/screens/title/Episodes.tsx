import React, {useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore} from 'react';
import {useSafeAreaInsets} from 'react-native-safe-area-context';
import {TVFocusGuideView, View, VirtualizedList, type RefreshControlProps, type ViewToken} from 'react-native';
import Animated, {Easing, useAnimatedStyle, useSharedValue, withTiming} from 'react-native-reanimated';
import Svg, {Defs, RadialGradient, Rect, Stop} from 'react-native-svg';
import type {WindowedCollection} from '../../../../../packages/client-core/src/collections/index';
import type {ContentEntry} from '../../../../../packages/client-core/src/library-content';
import {formatDuration, progressFor, useArtwork} from '../../app/content';
import {useI18n, type I18n} from '../../app/i18n';
import {titleTintHue} from '../../../../../packages/client-core/src/presentation/index';
import {cardFocusKey, Artwork, Button, Focusable, Icon, ProgressBar, ProgressLine, Skeleton, Text, alpha, useReportScroll, useSpecPlatform, useTheme, type FocusableHandle} from '../../ui';
import {ArtworkPlacementContext} from '../../ui/ArtworkPipeline';
import {episodeCode} from './facts';
import {episodeArt} from './layout';
import {DETAILS_IN_MS, LANDING_HOLD, LANDING_MS, PLATE_RADIUS, episodeRowLayout, plateColors, type PlateColors} from './episode-open';

/**
 * Episodes for the show page (Spec — Title Pages §2), over a windowed collection: only the pages
 * near the viewport are resident, rows re-render only when their own page arrives, and unloaded
 * rows are placeholders with stable keys. Landscape 16:9 stills; an episode without a still of
 * its own shows a placeholder in the show's colour with its episode code, never the show
 * backdrop repeated as every episode's art.
 *
 * An episode opens in place (Justin, 18 Oct 2026), on a soft plate in the show's own colour —
 * never a sheet, a panel, an outline or a bar. The next-up episode wears a small "Next up" (or
 * "Continue") chip after its title; the episode the page was opened for wears the plate a moment.
 *
 * - Television: a list of episodes on the left with the focused one shown large beside it
 *   (still, title, air date and runtime, synopsis). Select plays or resumes; long-press, or
 *   "Episode details" beside the still, opens the episode there, in the preview's place, until
 *   focus moves to another episode or Back closes it.
 * - iPhone/iPad: a vertical list, still on the left and text on the right with the air date,
 *   runtime and a two-line synopsis. The still plays (a round Play in its middle); the text opens
 *   the episode under its row, and closes it again.
 */

export type EpisodeHandlers = {
  onPlay: (index: number) => void;
  /** Opens the episode in place, or closes it when it is the one open. */
  onDetails: (index: number) => void;
  onMore?: (entry: ContentEntry) => void;
};

/** What the list marks: the episode open in place, the one the page was opened for, and the next-up chip. */
export type EpisodeMarks = {open?: {id: string; index: number}; landingId?: string; nextUpId?: string; /** The chip's words ("Next up", "Continue"). */ tag?: string};
/** The opened episode's details (`EpisodeDetails`), drawn by the screen that owns its actions. */
export type RenderDetails = (entry: ContentEntry, index: number, layout: {columns: boolean}) => React.ReactNode;

/** The item at `index`, re-rendering only when its page changes. */
export function useSlot(list: WindowedCollection<ContentEntry>, index: number): ContentEntry | undefined {
  const page = list.pageOf(index);
  const subscribe = useCallback((listener: () => void) => list.subscribePage(page, listener), [list, page]);
  useSyncExternalStore(subscribe, () => list.getPageVersion(page));
  const slot = list.slotAt(index);
  return slot.kind === 'item' ? slot.item : undefined;
}

export function episodeTitle(i18n: I18n, entry: ContentEntry): string {
  const code = episodeCode(i18n, entry);
  return code ? `${code} · ${entry.title}` : entry.title;
}

/** "Aired Jan 20, 2008 · 47m": what a row says under the title. An episode whose files are not on disk right now says so first. */
export function episodeMeta(i18n: I18n, entry: ContentEntry): string | undefined {
  const parts = [entry.available === false ? i18n.t('card.unavailable') : undefined, entry.airDate ? i18n.t('title.airedOn', {date: formatAirDate(entry.airDate)}) : undefined, entry.duration ? formatDuration(entry.duration) : undefined].filter(Boolean);
  return parts.length ? parts.join(' · ') : undefined;
}

/** "Jan 20, 2008" without a timezone shift (air dates are calendar dates). */
export function formatAirDate(iso: string): string {
  const d = new Date(iso.slice(0, 10) + 'T00:00:00');
  return Number.isNaN(d.getTime()) ? iso : d.toLocaleDateString(undefined, {year: 'numeric', month: 'short', day: 'numeric'});
}

/** The show whose episodes are on screen: its placeholders and plates take its tint (Spec — Page Content §0.2). */
export const EpisodeTintContext = React.createContext<string | undefined>(undefined);

/** Reports the visible range to the store (and one page either side is prefetched by it). */
function useViewable(list: WindowedCollection<ContentEntry>) {
  const latest = useRef(list);
  latest.current = list;
  return useRef(({viewableItems}: {viewableItems: ViewToken[]}) => {
    const indices = viewableItems.map(v => v.index).filter((i): i is number => i !== null);
    if (indices.length) latest.current.ensureRange(Math.min(...indices), Math.max(...indices));
  }).current;
}

// ── The plate ────────────────────────────────────────────────────────────────

/** The plate's colours, in the tint of the show on screen. */
function usePlateColors(): PlateColors {
  const seed = React.useContext(EpisodeTintContext);
  const {colors} = useTheme();
  return useMemo(() => plateColors(seed ?? '', colors.ink, colors.text, colors.raised), [seed, colors.ink, colors.text, colors.raised]);
}

/** The tint's wash, strongest at the top-left and gone before `height` (the row's bottom edge), so the plate below stays one colour. */
function PlateWash({height, plate}: {height: number; plate: PlateColors}) {
  return (
    <Svg pointerEvents="none" width="100%" height={height} style={{position: 'absolute', left: 0, right: 0, top: 0}}>
      <Defs>
        <RadialGradient id="plateWash" cx="0" cy="0" fx="0" fy="0" rx="0.7" ry="1" gradientUnits="objectBoundingBox">
          <Stop offset="0" stopColor={plate.tint} stopOpacity={plate.washAlpha} />
          <Stop offset="1" stopColor={plate.tint} stopOpacity={0} />
        </RadialGradient>
      </Defs>
      <Rect x="0" y="0" width="100%" height={height} fill="url(#plateWash)" />
    </Svg>
  );
}

/** One opaque plate (and its soft shadow) behind an opened row and its details: no seam between them. */
function Plate({wash, style, children}: {wash: number; style?: object; children: React.ReactNode}) {
  const {colors} = useTheme();
  const plate = usePlateColors();
  return (
    <View style={[{borderRadius: PLATE_RADIUS, boxShadow: `0px 10px 24px -12px ${alpha(colors.black, 0.7)}`}, style]}>
      <View style={{borderRadius: PLATE_RADIUS, overflow: 'hidden', backgroundColor: plate.plate}}>
        <PlateWash height={wash} plate={plate} />
        {children}
      </View>
    </View>
  );
}

/** The opened details fade and settle in (none with Reduce Motion). */
function Arrive({children}: {children: React.ReactNode}) {
  const {motion} = useTheme();
  const shown = useSharedValue(motion.reduce ? 1 : 0);
  useEffect(() => {
    shown.value = withTiming(1, {duration: motion.reduce ? 0 : DETAILS_IN_MS, easing: Easing.out(Easing.cubic)});
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  const style = useAnimatedStyle(() => ({opacity: shown.value, transform: [{translateY: (1 - shown.value) * -4}]}));
  return <Animated.View style={style}>{children}</Animated.View>;
}

/** The episode the page was opened for: the plate a moment, then nothing (the screen lets go of it after `LANDING_MS`). */
function LandingPlate({inset}: {inset: number}) {
  const {motion} = useTheme();
  const plate = usePlateColors();
  const shown = useSharedValue(1);
  useEffect(() => {
    if (motion.reduce) return;
    const fade = setTimeout(() => { shown.value = withTiming(0, {duration: LANDING_MS * (1 - LANDING_HOLD), easing: Easing.out(Easing.cubic)}); }, LANDING_MS * LANDING_HOLD);
    return () => clearTimeout(fade);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  const style = useAnimatedStyle(() => ({opacity: shown.value}));
  return <Animated.View pointerEvents="none" style={[{position: 'absolute', top: 0, bottom: 0, left: inset, right: inset, borderRadius: PLATE_RADIUS, backgroundColor: plate.solid}, style]} />;
}

/** "Next up" or "Continue", after the next-up episode's title. */
function NextUpTag({label}: {label: string}) {
  const {colors, space, metrics} = useTheme();
  return (
    <View style={{flexShrink: 0, borderRadius: metrics.radius.pill, backgroundColor: alpha(colors.accent, 0.18), paddingHorizontal: space.sm, paddingVertical: space.xxs}}>
      <Text variant="label" lines={1} style={{color: colors.accentHover, fontWeight: '700'}}>{label}</Text>
    </View>
  );
}

/** Play in the middle of a still: quiet at rest (touch has no hover), full on focus or pointer hover. */
function PlayBadge({emphasis}: {emphasis: boolean}) {
  const {colors, isTV} = useTheme();
  const size = isTV ? 56 : emphasis ? 40 : 34;
  return (
    <View pointerEvents="none" style={{position: 'absolute', inset: 0, alignItems: 'center', justifyContent: 'center', backgroundColor: emphasis ? alpha(colors.ink, 0.35) : undefined}}>
      <View style={{width: size, height: size, borderRadius: size / 2, alignItems: 'center', justifyContent: 'center', backgroundColor: emphasis ? colors.accent : alpha(colors.ink, 0.6)}}>
        <Icon name="play" size={Math.round(size * 0.45)} color={emphasis ? colors.accentInk : colors.text} />
      </View>
    </View>
  );
}

// ── Television: a list with the focused episode shown large ────────────────

/** The height of one television episode row. */
const TV_ROW = 92;

export function EpisodeBrowser({list, total, initialIndex = 0, jump, marks, handlers, renderDetails, onClose}: {
  list: WindowedCollection<ContentEntry>;
  total: number;
  initialIndex?: number;
  /** "Jump to": bring this position into view (a new object each time); `focus` moves focus to it too (the episode the page was opened for). */
  jump?: {index: number; focus?: boolean};
  marks: EpisodeMarks;
  handlers: EpisodeHandlers;
  renderDetails: RenderDetails;
  /** Closes the open episode (focus moved to another one). */
  onClose: () => void;
}) {
  const {space, window, metrics, isTV} = useTheme();
  const i18n = useI18n();
  const artwork = useArtwork();
  const plate = usePlateColors();
  const listRef = useRef<VirtualizedList<number>>(null);
  const onViewable = useViewable(list);
  const start = Math.max(0, Math.min(initialIndex, total - 1));
  const [focused, setFocused] = React.useState(start);
  React.useEffect(() => { setFocused(start); list.ensureRange(start, start + 8); }, [list, start]);
  // The row that focus goes back to: the open episode's, or the one a jump asked to focus.
  const [anchor, setAnchor] = useState<number | undefined>(undefined);
  const anchorRef = useRef<FocusableHandle>(null);
  const [focusAsk, setFocusAsk] = useState(0);
  React.useEffect(() => {
    if (!jump || jump.index >= total) return;
    list.ensureRange(jump.index, jump.index + 8);
    listRef.current?.scrollToIndex({index: jump.index, animated: false});
    setFocused(jump.index);
    if (jump.focus) { setAnchor(jump.index); setFocusAsk(n => n + 1); }
  }, [jump, list, total]);
  useEffect(() => { if (focusAsk) anchorRef.current?.focus(); }, [focusAsk]);
  // Open: the preview is the open episode's details. Moving to another episode closes it; Back
  // (or anything else that closes it) puts focus back on its row, as the pane's controls go.
  const open = marks.open;
  const openIndex = open?.index;
  const closedByFocus = useRef(false);
  const wasOpen = useRef<number | undefined>(undefined);
  useEffect(() => {
    if (openIndex !== undefined) setAnchor(openIndex);
    else if (wasOpen.current !== undefined && !closedByFocus.current) anchorRef.current?.focus();
    closedByFocus.current = false;
    wasOpen.current = openIndex;
  }, [openIndex]);
  // Leaving the pane to the left lands on the open episode's row, not whichever row is nearest;
  // otherwise coming back to the list returns to the row last used there.
  const [target, setTarget] = useState<View | null>(null);
  useEffect(() => {
    if (!isTV) return;
    const node = openIndex !== undefined && anchor === openIndex ? anchorRef.current?.node?.() ?? null : null;
    setTarget(prev => (prev === node ? prev : node));
  }, [isTV, openIndex, anchor]);
  const onFocused = useCallback((index: number) => {
    setFocused(index);
    if (openIndex !== undefined && index !== openIndex) { closedByFocus.current = true; onClose(); }
  }, [openIndex, onClose]);
  const shownIndex = Math.min(openIndex ?? focused, Math.max(0, total - 1));
  const shown = useSlot(list, shownIndex);
  const opened = open && shown?.id === open.id;
  // Six rows are in view; the page scrolls on past the list once its last row is left.
  const height = Math.min(total, 6) * TV_ROW;
  const listWidth = Math.round((window.width - space.page * 2) * 0.42);
  const previewWidth = Math.min(window.width - space.page * 2 - listWidth - space.xxxl, 780);
  const still = shown ? episodeArt(shown) : undefined;
  const meta = shown ? episodeMeta(i18n, shown) : undefined;
  const renderItem = useCallback(({index}: {index: number}) => <TvEpisodeRow list={list} index={index} marks={marks} handlers={handlers} onFocused={onFocused} focusRef={index === anchor ? anchorRef : undefined} />, [list, marks, handlers, onFocused, anchor]);
  return (
    <View style={{flexDirection: 'row', gap: space.xxxl, paddingHorizontal: space.page, alignItems: 'flex-start'}}>
      <TVFocusGuideView destinations={target ? [target] : undefined} autoFocus={!target} style={{width: listWidth, height}}>
        <VirtualizedList<number>
          ref={listRef}
          data={total}
          getItemCount={() => total}
          getItem={(_, index) => index}
          keyExtractor={index => `episode:${index}`}
          getItemLayout={(_, index) => ({length: TV_ROW, offset: TV_ROW * index, index})}
          initialScrollIndex={start > 3 ? start : undefined}
          renderItem={renderItem}
          onViewableItemsChanged={onViewable}
          viewabilityConfig={{itemVisiblePercentThreshold: 10}}
          initialNumToRender={8}
          maxToRenderPerBatch={6}
          windowSize={5}
          removeClippedSubviews={false}
          showsVerticalScrollIndicator={false}
          style={{width: listWidth, height}}
        />
      </TVFocusGuideView>
      <View style={{width: previewWidth, gap: space.md}}>
        <View style={{borderRadius: metrics.radius.card, overflow: 'hidden', alignSelf: 'flex-start'}}>
          {shown && still ? (still.kind === 'still' ? <Artwork source={artwork(still.path)} shape="landscape" width={previewWidth} title={shown.title} priority /> : <EpisodeStillPlaceholder code={episodeCode(i18n, shown)} width={previewWidth} />) : <Skeleton width={previewWidth} height={Math.round(previewWidth * 9 / 16)} radius={metrics.radius.card} />}
          {shown ? <ProgressLine value={shown.watched ? 0 : progressFor(shown)} /> : null}
        </View>
        {shown && opened ? (
          <Arrive>
            <View style={{borderRadius: PLATE_RADIUS, overflow: 'hidden', backgroundColor: plate.plate, padding: space.md}}>
              <PlateWash height={240} plate={plate} />
              {renderDetails(shown, shownIndex, {columns: false})}
            </View>
          </Arrive>
        ) : shown ? (
          <View style={{gap: space.xs}}>
            <Text variant="heading" lines={1}>{episodeTitle(i18n, shown)}</Text>
            {meta ? <Text variant="caption" tone="tertiary" lines={1}>{meta}</Text> : null}
            {shown.overview ? <Text variant="body" tone="secondary" lines={4}>{shown.overview}</Text> : null}
            <View style={{flexDirection: 'row', marginTop: space.xs}}>
              <Button variant="secondary" icon="info" label={i18n.t('title.episodeDetails')} onPress={() => handlers.onDetails(shownIndex)} />
            </View>
          </View>
        ) : null}
      </View>
    </View>
  );
}

const TvEpisodeRow = React.memo(function TvEpisodeRow({list, index, marks, handlers, onFocused, focusRef}: {list: WindowedCollection<ContentEntry>; index: number; marks: EpisodeMarks; handlers: EpisodeHandlers; onFocused: (index: number) => void; focusRef?: React.Ref<FocusableHandle>}) {
  const {metrics, space, colors} = useTheme();
  const i18n = useI18n();
  const plate = usePlateColors();
  const entry = useSlot(list, index);
  const label = entry ? episodeTitle(i18n, entry) : '';
  const meta = entry ? episodeMeta(i18n, entry) : undefined;
  const progress = entry && !entry.watched ? progressFor(entry) : 0;
  const open = !!entry && marks.open?.id === entry.id;
  const landed = !!entry && !open && entry.id === marks.landingId;
  const tag = entry && entry.id === marks.nextUpId ? marks.tag : undefined;
  return (
    <Focusable
      ref={focusRef}
      ring={false}
      scale={1}
      radius={metrics.radius.control}
      accessibilityRole="button"
      accessibilityLabel={label ? `${i18n.t('entry.play')}, ${[label, tag].filter(Boolean).join(', ')}` : undefined}
      accessibilityHint={entry?.overview}
      accessibilityState={{expanded: open}}
      longPressLabel={i18n.t('title.episodeDetails')}
      onFocus={() => onFocused(index)}
      onPress={entry ? () => handlers.onPlay(index) : undefined}
      onLongPress={entry ? () => handlers.onDetails(index) : undefined}
      style={{height: TV_ROW}}>
      {({focused}) => (
        <View style={{flex: 1, flexDirection: 'row', alignItems: 'center', gap: space.md, paddingHorizontal: space.md, marginVertical: space.xxs, borderRadius: focused ? metrics.radius.control : PLATE_RADIUS, backgroundColor: focused ? colors.text : open ? plate.solid : 'transparent'}}>
          {landed && !focused ? <LandingPlate inset={0} /> : null}
          <Text variant="bodyStrong" lines={1} style={{width: 44, color: focused ? colors.ink : colors.textTertiary}}>{entry?.episodeNumber ?? ''}</Text>
          <View style={{flex: 1, minWidth: 0, gap: space.xxs}}>
            {entry ? (
              <View style={{flexDirection: 'row', alignItems: 'center', gap: space.sm}}>
                <Text variant="subheading" lines={1} style={{flexShrink: 1, color: focused ? colors.ink : entry.watched ? colors.textSecondary : colors.text}}>{entry.title}</Text>
                {tag ? <NextUpTag label={tag} /> : null}
              </View>
            ) : <Skeleton height={18} width="60%" />}
            {meta ? <Text variant="caption" lines={1} style={{color: focused ? alpha(colors.ink, 0.72) : colors.textTertiary}}>{meta}</Text> : null}
            {progress > 0 ? <ProgressBar value={progress} height={3} style={{maxWidth: 220}} /> : null}
          </View>
          {entry?.watched ? <Icon name="check" size={metrics.iconSmall} color={focused ? colors.ink : colors.textSecondary} /> : null}
        </View>
      )}
    </Focusable>
  );
});

/**
 * M26: an episode without a still of its own — its episode code, large, on the show's colour
 * (a stable tint from the show's id until the server publishes a dominant colour).
 */
export function EpisodeStillPlaceholder({code, width}: {code?: string; width: number}) {
  const {colors, metrics, space} = useTheme();
  const seed = React.useContext(EpisodeTintContext);
  return (
    <View style={{width, height: Math.round(width * 9 / 16), borderRadius: metrics.radius.card, backgroundColor: seed ? `hsl(${titleTintHue(seed)}, 32%, 22%)` : colors.raised, alignItems: 'center', justifyContent: 'center', padding: space.sm}}>
      {code ? <Text variant="heading" align="center" lines={2}>{code}</Text> : null}
    </View>
  );
}

// ── iPhone/iPad: the page is the list ───────────────────────────────────────

/** Row geometry for the vertical list: fixed, so scrolling and "Jump to" are exact. */
export function useEpisodeRowGeometry() {
  const {space} = useTheme();
  const platform = useSpecPlatform();
  const still = platform === 'phone' ? 136 : 240;
  const stillHeight = Math.round(still * 9 / 16);
  const text = platform === 'phone' ? 76 : 96;
  return {still, stillHeight, height: Math.max(stillHeight, text) + space.md * 2};
}

export type EpisodeListHandle = {
  scrollToIndex: (index: number) => void;
  /** Brings a row into view a little below the top (the episode the page was opened for). */
  reveal: (index: number) => void;
};

/**
 * The show page on iPhone/iPad: one virtualised list whose header is the hero and the season
 * switcher, rows are the season's episodes (windowed), and footer holds the remaining sections.
 * Rows are one height; the open episode's row also holds its details, measured once, so the rows
 * after it (and "Jump to") stay exact.
 */
export const EpisodeList = React.forwardRef(function EpisodeList({list, total, marks, handlers, renderDetails, header, footer, empty, refreshControl}: {list: WindowedCollection<ContentEntry> | null; total: number; marks: EpisodeMarks; handlers: EpisodeHandlers; renderDetails: RenderDetails; header: React.ReactElement; footer?: React.ReactElement | null; empty?: React.ReactElement | null; refreshControl?: React.ReactElement<RefreshControlProps>}, ref: React.ForwardedRef<EpisodeListHandle>) {
  const geometry = useEpisodeRowGeometry();
  const {space, window} = useTheme();
  const insets = useSafeAreaInsets();
  const [headerHeight, setHeaderHeight] = React.useState(0);
  const report = useReportScroll();
  const listRef = useRef<VirtualizedList<number>>(null);
  const count = list ? total : 0;
  const onViewable = useRef(({viewableItems}: {viewableItems: ViewToken[]}) => {
    const indices = viewableItems.map(v => v.index).filter((i): i is number => i !== null);
    if (indices.length) current.current?.ensureRange(Math.min(...indices), Math.max(...indices));
  }).current;
  const current = useRef(list);
  current.current = list;
  React.useEffect(() => { list?.ensureRange(0, 8); }, [list]);
  // The open row's extra height (its details), as last measured.
  const [measured, setMeasured] = useState<{id: string; height: number}>();
  const open = marks.open;
  const extra = open && measured?.id === open.id ? measured.height : 0;
  const layout = useCallback((index: number) => episodeRowLayout(index, {row: geometry.height, header: headerHeight, open: open?.index, extra}), [geometry.height, headerHeight, open?.index, extra]);
  const onMeasure = useCallback((id: string, height: number) => setMeasured(prev => (prev?.id === id && prev.height === height ? prev : {id, height})), []);
  React.useImperativeHandle(ref, () => ({
    scrollToIndex: (index: number) => {
      list?.ensureRange(index, index + 8);
      listRef.current?.scrollToOffset({offset: layout(index).offset, animated: true});
    },
    reveal: (index: number) => {
      list?.ensureRange(Math.max(0, index - 2), index + 8);
      listRef.current?.scrollToOffset({offset: Math.max(0, layout(index).offset - Math.round(window.height * 0.3)), animated: true});
    },
  }), [list, layout, window.height]);
  const renderItem = useCallback(({index}: {index: number}) => (list ? <EpisodeRow list={list} index={index} geometry={geometry} marks={marks} handlers={handlers} renderDetails={renderDetails} onMeasure={onMeasure} /> : null), [list, geometry, marks, handlers, renderDetails, onMeasure]);
  return (
    <VirtualizedList<number>
      ref={listRef}
      data={count}
      getItemCount={() => count}
      getItem={(_, index) => index}
      keyExtractor={index => `episode:${index}`}
      getItemLayout={(_, index) => layout(index)}
      renderItem={renderItem}
      ListHeaderComponent={<View onLayout={e => setHeaderHeight(e.nativeEvent.layout.height)}>{header}</View>}
      ListFooterComponent={<View>{count === 0 ? empty : null}{footer}</View>}
      onViewableItemsChanged={onViewable}
      viewabilityConfig={{itemVisiblePercentThreshold: 1}}
      initialNumToRender={8}
      maxToRenderPerBatch={6}
      windowSize={7}
      updateCellsBatchingPeriod={50}
      style={{flex: 1}}
      refreshControl={refreshControl}
      contentContainerStyle={{paddingBottom: insets.bottom + space.xxxl}}
      keyboardShouldPersistTaps="handled"
      onScroll={report}
      scrollEventThrottle={32}
    />
  );
});

const EpisodeRow = React.memo(function EpisodeRow({list, index, geometry, marks, handlers, renderDetails, onMeasure}: {list: WindowedCollection<ContentEntry>; index: number; geometry: ReturnType<typeof useEpisodeRowGeometry>; marks: EpisodeMarks; handlers: EpisodeHandlers; renderDetails: RenderDetails; onMeasure: (id: string, extra: number) => void}) {
  const {space, window} = useTheme();
  const platform = useSpecPlatform();
  const entry = useSlot(list, index);
  const expanded = !!entry && marks.open?.id === entry.id && marks.open.index === index;
  const tag = entry && entry.id === marks.nextUpId ? marks.tag : undefined;
  // The plate bleeds a little past the row's content, so the still stays on the page's edge.
  const bleed = space.sm;
  const row = <EpisodeRowView entry={entry} position={index} geometry={geometry} inset={expanded ? bleed : undefined} expanded={expanded} landed={!expanded && !!entry && entry.id === marks.landingId} tag={tag} onPlay={() => handlers.onPlay(index)} onDetails={() => handlers.onDetails(index)} onMore={handlers.onMore} />;
  if (!expanded || !entry) return row;
  // Wide: the details sit under the row's text, the people and files beside them; phone: under the whole row.
  const indent = platform === 'phone' ? bleed : bleed + geometry.still + space.md;
  const columns = window.width - (space.page - bleed) * 2 - indent - bleed >= 640;
  return (
    <View onLayout={e => onMeasure(entry.id, Math.max(0, e.nativeEvent.layout.height - geometry.height))}>
      <Plate wash={geometry.height} style={{marginHorizontal: space.page - bleed, marginBottom: space.lg}}>
        {row}
        <Arrive>
          <View style={{paddingLeft: indent, paddingRight: bleed + space.sm, paddingBottom: space.lg}}>
            {renderDetails(entry, index, {columns})}
          </View>
        </Arrive>
      </Plate>
    </View>
  );
});

/**
 * One episode as a row: the still (Play in its middle; it plays), then the title (a step larger
 * than the rest, Justin 18 Oct 2026) with its Next up chip, air date · runtime and a two-line synopsis (opens the episode under the row, and closes
 * it), a progress line on the still and a check once watched.
 */
export const EpisodeRowView = React.memo(function EpisodeRowView({entry, position, geometry, inset, expanded = false, landed = false, tag, onPlay, onDetails, onMore}: {entry: ContentEntry | undefined; /** Its place on the page, for artwork priority. */ position: number; geometry: ReturnType<typeof useEpisodeRowGeometry>; /** Its own side padding (inside a plate); the page's edge otherwise. */ inset?: number; expanded?: boolean; landed?: boolean; tag?: string; onPlay: () => void; onDetails: () => void; onMore?: (entry: ContentEntry) => void}) {
  const {space, colors, metrics} = useTheme();
  const i18n = useI18n();
  const artwork = useArtwork();
  const label = entry ? episodeTitle(i18n, entry) : '';
  const meta = entry ? episodeMeta(i18n, entry) : undefined;
  const still = entry ? episodeArt(entry) : undefined;
  const placement = useMemo(() => ({row: 1 + position, group: 'episodes', column: 0}), [position]);
  const playable = !!entry?.playback;
  return (
    <View style={{height: geometry.height, flexDirection: 'row', alignItems: 'center', gap: space.md, paddingHorizontal: inset ?? space.page}}>
      {landed ? <LandingPlate inset={space.page - space.sm} /> : null}
      <Focusable ring={false} radius={metrics.radius.card} focusKey={entry ? cardFocusKey('episodes', entry.id) : undefined} focusPlace={{column: position}} accessibilityRole="button" accessibilityLabel={label ? (playable ? i18n.t('card.play', {title: label}) : i18n.t('title.aboutEpisode', {title: label})) : undefined} onPress={entry ? (playable ? onPlay : onDetails) : undefined} onLongPress={entry && onMore ? () => onMore(entry) : undefined}>
        {({focused, hovered}) => (
          <View style={{borderRadius: metrics.radius.card, overflow: 'hidden'}}>
            {entry && still ? (
              <ArtworkPlacementContext.Provider value={placement}>
                {still.kind === 'still' ? (
                  <Artwork source={artwork(still.path)} shape="landscape" width={geometry.still} title={entry.title} />
                ) : (
                  // A playable row's still carries the play badge at rest (touch has no hover), so its code
                  // gives way: the row's own title already names the episode.
                  <EpisodeStillPlaceholder code={playable ? undefined : episodeCode(i18n, entry)} width={geometry.still} />
                )}
              </ArtworkPlacementContext.Provider>
            ) : <Skeleton width={geometry.still} height={geometry.stillHeight} radius={metrics.radius.card} />}
            {entry ? <ProgressLine value={entry.watched ? 0 : progressFor(entry)} /> : null}
            {playable ? <PlayBadge emphasis={focused || hovered} /> : null}
          </View>
        )}
      </Focusable>
      <Focusable ring={false} radius={metrics.radius.control} style={{flex: 1, minWidth: 0, alignSelf: 'stretch', justifyContent: 'center'}} accessibilityRole="button" accessibilityLabel={label ? [i18n.t('title.aboutEpisode', {title: label}), tag].filter(Boolean).join(', ') : undefined} accessibilityHint={expanded ? undefined : entry?.overview} accessibilityState={{expanded}} onPress={entry ? onDetails : undefined} onLongPress={entry && onMore ? () => onMore(entry) : undefined}>
        {entry ? (
          <View style={{gap: space.xxs}}>
            <View style={{flexDirection: 'row', alignItems: 'center', gap: space.xs}}>
              <Text variant="subheading" lines={1} tone={entry.watched ? 'secondary' : 'primary'} style={{flexShrink: 1}}>{label}</Text>
              {tag ? <NextUpTag label={tag} /> : null}
              {entry.watched ? <Icon name="check" size={metrics.iconSmall} color={colors.textTertiary} /> : null}
            </View>
            {meta ? <Text variant="caption" tone="tertiary" lines={1}>{meta}</Text> : null}
            {/* Open, the synopsis is read whole in the details below. */}
            {entry.overview && !expanded ? <Text variant="caption" tone="secondary" lines={2}>{entry.overview}</Text> : null}
          </View>
        ) : (
          <View style={{gap: space.xs}}>
            <Skeleton height={16} width="70%" />
            <Skeleton height={12} width="30%" />
          </View>
        )}
      </Focusable>
    </View>
  );
});
