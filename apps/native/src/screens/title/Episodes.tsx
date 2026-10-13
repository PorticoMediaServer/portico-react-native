import React, {useCallback, useMemo, useRef, useSyncExternalStore} from 'react';
import {useSafeAreaInsets} from 'react-native-safe-area-context';
import {View, VirtualizedList, type RefreshControlProps, type ViewToken} from 'react-native';
import type {WindowedCollection} from '../../../../../packages/client-core/src/collections/index';
import type {ContentEntry} from '../../../../../packages/client-core/src/library-content';
import {formatDuration, progressFor, useArtwork} from '../../app/content';
import {useI18n, type I18n} from '../../app/i18n';
import {titleTintHue} from '../../../../../packages/client-core/src/presentation/index';
import {Artwork, Button, Focusable, Icon, ProgressBar, ProgressLine, Skeleton, Text, alpha, useReportScroll, useSpecPlatform, useTheme} from '../../ui';
import {ArtworkPlacementContext} from '../../ui/ArtworkPipeline';
import {episodeCode} from './facts';
import {episodeArt} from './layout';

/**
 * Episodes for the show page (Spec — Title Pages §2), over a windowed collection: only the pages
 * near the viewport are resident, rows re-render only when their own page arrives, and unloaded
 * rows are placeholders with stable keys. Landscape 16:9 stills; an episode without a still of
 * its own shows a placeholder in the show's colour with its episode code, never the show
 * backdrop repeated as every episode's art.
 *
 * - Television: a list of episodes on the left with the focused one shown large beside it
 *   (still, title, air date and runtime, synopsis). Select plays or resumes; long-press, or
 *   "Episode details" beside the still, opens the episode panel.
 * - iPhone/iPad: a vertical list, still on the left and text on the right with the air date,
 *   runtime and a two-line synopsis. Tapping the still plays; tapping the text opens the
 *   episode sheet.
 */

export type EpisodeHandlers = {
  onPlay: (index: number) => void;
  onDetails: (index: number) => void;
  onMore?: (entry: ContentEntry) => void;
};

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

/** The show whose episodes are on screen: its placeholders take its tint (Spec — Page Content §0.2). */
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

// ── Television: a list with the focused episode shown large ────────────────

/** The height of one television episode row. */
const TV_ROW = 92;

export function EpisodeBrowser({list, total, initialIndex = 0, jump, highlightId, handlers}: {list: WindowedCollection<ContentEntry>; total: number; initialIndex?: number; /** "Jump to": bring this position into view (a new object each time). */ jump?: {index: number}; highlightId?: string; handlers: EpisodeHandlers}) {
  const {space, window, metrics} = useTheme();
  const i18n = useI18n();
  const artwork = useArtwork();
  const listRef = useRef<VirtualizedList<number>>(null);
  const onViewable = useViewable(list);
  const start = Math.max(0, Math.min(initialIndex, total - 1));
  const [focused, setFocused] = React.useState(start);
  React.useEffect(() => { setFocused(start); list.ensureRange(start, start + 8); }, [list, start]);
  React.useEffect(() => {
    if (!jump || jump.index >= total) return;
    list.ensureRange(jump.index, jump.index + 8);
    listRef.current?.scrollToIndex({index: jump.index, animated: false});
    setFocused(jump.index);
  }, [jump, list, total]);
  const shown = useSlot(list, Math.min(focused, Math.max(0, total - 1)));
  // Six rows are in view; the page scrolls on past the list once its last row is left.
  const height = Math.min(total, 6) * TV_ROW;
  const listWidth = Math.round((window.width - space.page * 2) * 0.42);
  const previewWidth = Math.min(window.width - space.page * 2 - listWidth - space.xxxl, 780);
  const still = shown ? episodeArt(shown) : undefined;
  const meta = shown ? episodeMeta(i18n, shown) : undefined;
  const renderItem = useCallback(({index}: {index: number}) => <TvEpisodeRow list={list} index={index} highlightId={highlightId} handlers={handlers} onFocused={setFocused} />, [list, highlightId, handlers]);
  return (
    <View style={{flexDirection: 'row', gap: space.xxxl, paddingHorizontal: space.page, alignItems: 'flex-start'}}>
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
      <View style={{width: previewWidth, gap: space.md}}>
        <View style={{borderRadius: metrics.radius.card, overflow: 'hidden', alignSelf: 'flex-start'}}>
          {shown && still ? (still.kind === 'still' ? <Artwork source={artwork(still.path)} shape="landscape" width={previewWidth} title={shown.title} priority /> : <EpisodeStillPlaceholder code={episodeCode(i18n, shown)} width={previewWidth} />) : <Skeleton width={previewWidth} height={Math.round(previewWidth * 9 / 16)} radius={metrics.radius.card} />}
          {shown ? <ProgressLine value={shown.watched ? 0 : progressFor(shown)} /> : null}
        </View>
        {shown ? (
          <View style={{gap: space.xs}}>
            <Text variant="heading" lines={1}>{episodeTitle(i18n, shown)}</Text>
            {meta ? <Text variant="caption" tone="tertiary" lines={1}>{meta}</Text> : null}
            {shown.overview ? <Text variant="body" tone="secondary" lines={4}>{shown.overview}</Text> : null}
            <View style={{flexDirection: 'row', marginTop: space.xs}}>
              <Button variant="secondary" icon="info" label={i18n.t('title.episodeDetails')} onPress={() => handlers.onDetails(Math.min(focused, total - 1))} />
            </View>
          </View>
        ) : null}
      </View>
    </View>
  );
}

const TvEpisodeRow = React.memo(function TvEpisodeRow({list, index, highlightId, handlers, onFocused}: {list: WindowedCollection<ContentEntry>; index: number; highlightId?: string; handlers: EpisodeHandlers; onFocused: (index: number) => void}) {
  const {metrics, space, colors} = useTheme();
  const i18n = useI18n();
  const entry = useSlot(list, index);
  const label = entry ? episodeTitle(i18n, entry) : '';
  const meta = entry ? episodeMeta(i18n, entry) : undefined;
  const progress = entry && !entry.watched ? progressFor(entry) : 0;
  return (
    <Focusable
      ring={false}
      scale={1}
      radius={metrics.radius.control}
      accessibilityRole="button"
      accessibilityLabel={label ? `${i18n.t('entry.play')}, ${label}` : undefined}
      accessibilityHint={entry?.overview}
      onFocus={() => onFocused(index)}
      onPress={entry ? () => handlers.onPlay(index) : undefined}
      onLongPress={entry ? () => handlers.onDetails(index) : undefined}
      style={{height: TV_ROW}}>
      {({focused}) => (
        <View style={{flex: 1, flexDirection: 'row', alignItems: 'center', gap: space.md, paddingHorizontal: space.md, marginVertical: space.xxs, borderRadius: metrics.radius.control, backgroundColor: focused ? colors.text : entry && entry.id === highlightId ? alpha(colors.accent, 0.16) : 'transparent'}}>
          <Text variant="bodyStrong" lines={1} style={{width: 44, color: focused ? colors.ink : colors.textTertiary}}>{entry?.episodeNumber ?? ''}</Text>
          <View style={{flex: 1, minWidth: 0, gap: space.xxs}}>
            {entry ? <Text variant="bodyStrong" lines={1} style={{color: focused ? colors.ink : entry.watched ? colors.textSecondary : colors.text}}>{entry.title}</Text> : <Skeleton height={18} width="60%" />}
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
export function EpisodeStillPlaceholder({code, width}: {code: string; width: number}) {
  const {colors, metrics, space} = useTheme();
  const seed = React.useContext(EpisodeTintContext);
  return (
    <View style={{width, height: Math.round(width * 9 / 16), borderRadius: metrics.radius.card, backgroundColor: seed ? `hsl(${titleTintHue(seed)}, 32%, 22%)` : colors.raised, alignItems: 'center', justifyContent: 'center', padding: space.sm}}>
      <Text variant="heading" align="center" lines={2}>{code}</Text>
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

export type EpisodeListHandle = {scrollToIndex: (index: number) => void};

/**
 * The show page on iPhone/iPad: one virtualised list whose header is the hero and the season
 * switcher, rows are the season's episodes (windowed), and footer holds the remaining sections.
 */
export const EpisodeList = React.forwardRef(function EpisodeList({list, total, highlightId, handlers, header, footer, empty, refreshControl}: {list: WindowedCollection<ContentEntry> | null; total: number; highlightId?: string; handlers: EpisodeHandlers; header: React.ReactElement; footer?: React.ReactElement | null; empty?: React.ReactElement | null; refreshControl?: React.ReactElement<RefreshControlProps>}, ref: React.ForwardedRef<EpisodeListHandle>) {
  const geometry = useEpisodeRowGeometry();
  const {space} = useTheme();
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
  React.useImperativeHandle(ref, () => ({
    scrollToIndex: (index: number) => {
      list?.ensureRange(index, index + 8);
      listRef.current?.scrollToOffset({offset: headerHeight + index * geometry.height, animated: true});
    },
  }), [list, headerHeight, geometry.height]);
  const renderItem = useCallback(({index}: {index: number}) => (list ? <EpisodeRow list={list} index={index} geometry={geometry} highlightId={highlightId} handlers={handlers} /> : null), [list, geometry, highlightId, handlers]);
  return (
    <VirtualizedList<number>
      ref={listRef}
      data={count}
      getItemCount={() => count}
      getItem={(_, index) => index}
      keyExtractor={index => `episode:${index}`}
      getItemLayout={(_, index) => ({length: geometry.height, offset: headerHeight + geometry.height * index, index})}
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

const EpisodeRow = React.memo(function EpisodeRow({list, index, geometry, highlightId, handlers}: {list: WindowedCollection<ContentEntry>; index: number; geometry: ReturnType<typeof useEpisodeRowGeometry>; highlightId?: string; handlers: EpisodeHandlers}) {
  const entry = useSlot(list, index);
  return <EpisodeRowView entry={entry} position={index} geometry={geometry} highlighted={!!entry && entry.id === highlightId} onPlay={() => handlers.onPlay(index)} onDetails={() => handlers.onDetails(index)} onMore={handlers.onMore} />;
});

/**
 * One episode as a row: still (plays), then title, air date · runtime and a two-line synopsis
 * (opens the episode sheet), a progress line on the still and a check once watched. Also the
 * pinned Next up row, which has an episode but no place in the list.
 */
export const EpisodeRowView = React.memo(function EpisodeRowView({entry, position, geometry, highlighted, onPlay, onDetails, onMore}: {entry: ContentEntry | undefined; /** Its place on the page, for artwork priority. */ position: number; geometry: ReturnType<typeof useEpisodeRowGeometry>; highlighted?: boolean; onPlay: () => void; onDetails: () => void; onMore?: (entry: ContentEntry) => void}) {
  const {space, colors, metrics} = useTheme();
  const i18n = useI18n();
  const artwork = useArtwork();
  const label = entry ? episodeTitle(i18n, entry) : '';
  const meta = entry ? episodeMeta(i18n, entry) : undefined;
  const still = entry ? episodeArt(entry) : undefined;
  const placement = useMemo(() => ({row: 1 + position, group: 'episodes', column: 0}), [position]);
  return (
    <View style={{height: geometry.height, flexDirection: 'row', alignItems: 'center', gap: space.md, paddingHorizontal: space.page, backgroundColor: highlighted ? alpha(colors.accent, 0.08) : undefined}}>
      <Focusable ring={false} radius={metrics.radius.card} accessibilityRole="button" accessibilityLabel={label ? `${i18n.t('entry.play')}, ${label}` : undefined} onPress={entry ? onPlay : undefined} onLongPress={entry && onMore ? () => onMore(entry) : undefined}>
        <View style={{borderRadius: metrics.radius.card, overflow: 'hidden'}}>
          {entry && still ? (
            <ArtworkPlacementContext.Provider value={placement}>
              {still.kind === 'still' ? (
                <Artwork source={artwork(still.path)} shape="landscape" width={geometry.still} title={entry.title} />
              ) : (
                <EpisodeStillPlaceholder code={episodeCode(i18n, entry)} width={geometry.still} />
              )}
            </ArtworkPlacementContext.Provider>
          ) : <Skeleton width={geometry.still} height={geometry.stillHeight} radius={metrics.radius.card} />}
          {entry ? <ProgressLine value={entry.watched ? 0 : progressFor(entry)} /> : null}
          {entry ? (
            <View pointerEvents="none" style={{position: 'absolute', left: space.xs, bottom: space.xs, borderRadius: metrics.radius.pill, backgroundColor: alpha(colors.ink, 0.72), padding: space.xs}}>
              <Icon name="play" size={metrics.iconSmall - 4} color={colors.text} />
            </View>
          ) : null}
        </View>
      </Focusable>
      <Focusable ring={false} radius={metrics.radius.control} style={{flex: 1, minWidth: 0, alignSelf: 'stretch', justifyContent: 'center'}} accessibilityRole="button" accessibilityLabel={label ? i18n.t('title.aboutEpisode', {title: label}) : undefined} accessibilityHint={entry?.overview} onPress={entry ? onDetails : undefined} onLongPress={entry && onMore ? () => onMore(entry) : undefined}>
        {entry ? (
          <View style={{gap: space.xxs}}>
            <View style={{flexDirection: 'row', alignItems: 'center', gap: space.xs}}>
              <Text variant="bodyStrong" lines={1} tone={entry.watched ? 'secondary' : 'primary'} style={{flexShrink: 1}}>{label}</Text>
              {entry.watched ? <Icon name="check" size={metrics.iconSmall} color={colors.textTertiary} /> : null}
            </View>
            {meta ? <Text variant="caption" tone="tertiary" lines={1}>{meta}</Text> : null}
            {entry.overview ? <Text variant="caption" tone="secondary" lines={2}>{entry.overview}</Text> : null}
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
