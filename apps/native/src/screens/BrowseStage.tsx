import React, {createContext, useContext, useEffect, useMemo, useRef, useSyncExternalStore} from 'react';
import {FlatList, Image, ScrollView, View, type ListRenderItem} from 'react-native';
import {useSafeAreaInsets} from 'react-native-safe-area-context';
import {browsePreview} from '../../../../packages/client-core/src/presentation/index';
import {type BrowsePreviewStore, type PreviewFocus} from '../app/browse-preview';
export {useBrowsePreview} from '../app/browse-preview';
import {heroText, shelfHeight, stageLayout, type StageLayout} from '../app/browse-stage';
import {formatDuration, useArtwork} from '../app/content';
import {useI18n} from '../app/i18n';
import {Artwork, Backdrop, FocusGroup, ProgressBar, Skeleton, Text, cardFocusKey, parseCardFocusKey, useFocusResolver, useTheme, type FocusResolver} from '../ui';
import {ArtworkPlacementContext} from '../ui/ArtworkPipeline';

/**
 * TV browsing (Justin, 18 Oct 2026): Home and a library's Discover show a large, passive preview
 * of the card with focus, and below it the rows. The rows move with focus so the row with focus
 * always rests in the same place, wholly on screen with a glimpse of the next one; the preview
 * stays put above them and never scrolls. Nothing in the preview can be focused: Select on the
 * card is the action (a Continue card resumes, any other card opens its page).
 *
 * Full grids keep their grids, with no preview, and title pages keep their own hero.
 */

/** The preview of the screen the cards are on; none off the browsing stage (a grid, a title page). */
export const BrowsePreviewContext = createContext<BrowsePreviewStore | null>(null);

export function useBrowsePreviewContext(): BrowsePreviewStore | null {
  return useContext(BrowsePreviewContext);
}

/** APL-HOME-02: no "1m" for a short clip. */
export const previewDuration = (seconds: number) => (seconds >= 120 ? formatDuration(seconds) : '');

/** The stage's geometry on this screen: Home has no strip, a library has its tabs (`strip`, measured from `useStripHeight`). */
export function useStageLayout(strip: number): StageLayout & {top: number} {
  const {space, metrics, type, window} = useTheme();
  const insets = useSafeAreaInsets();
  const top = Math.max(insets.top, 60) - space.lg;
  return useMemo(() => {
    const line = (role: keyof typeof type) => type[role].lineHeight ?? 0;
    // A row as Shelf draws it: the title line (a See all button is the taller), the cards (a
    // poster is the tallest artwork) and their captions with room for an episode's third line.
    const caption = Math.max(Math.ceil(space.sm + line('captionStrong') + 1 + 2 * line('micro')), 60);
    const row = shelfHeight({header: Math.max(line('heading'), metrics.controlSmall), headerGap: space.md, art: metrics.posterWidth * 1.5, caption, below: space.xl});
    const peek = strip ? space.xxxl : space.xxxl + space.md;
    return {top, ...stageLayout({height: window.height, top, strip, row, peek, minHero: Math.round(window.height * (strip ? 0.26 : 0.34)), minPeek: space.xxl})};
  }, [space, metrics, type, window.height, top, strip]);
}

/** TV: where a screen's content starts below the top of the screen (the stage and a library's strip). */
export function useStageTop(): number {
  const {space} = useTheme();
  return Math.max(useSafeAreaInsets().top, 60) - space.lg;
}

/** The library tabs' strip height on the stage (the same strip sits above a library's grids). */
export function useStripHeight(): number {
  const {space, type} = useTheme();
  return (type.subheading.lineHeight ?? 0) + space.md * 2 + 1 + space.md;
}

/** What the preview says before any card has been seen: where the viewer is ("Home" on the server). */
export type StageIdentity = Readonly<{eyebrow?: string; title: string}>;

export function BrowseStage<T>({store, layout, strip, stripHeight = 0, identity, notice, loading = false, rows, keyExtractor, renderRow, initialRows = 3, footer, body, focusRows, snaps}: {
  store: BrowsePreviewStore;
  layout: StageLayout & {top: number};
  /** The library's tabs; nothing on Home. */
  strip?: React.ReactNode;
  /** The strip's height (`useStripHeight`), which the layout was worked out with. */
  stripHeight?: number;
  identity: StageIdentity;
  /** A notice about the rows (they could not be read again), over the preview's top. */
  notice?: React.ReactNode;
  /** The first read is under way: the preview's place is held by a quiet skeleton. */
  loading?: boolean;
  rows: readonly T[];
  keyExtractor: (row: T, index: number) => string;
  renderRow: ListRenderItem<T>;
  /** Rows drawn at first: enough to hold the row browsing starts on. */
  initialRows?: number;
  /** After the last row (Home's Customise). */
  footer?: React.ReactNode;
  /** Instead of the rows (the first load, a failure, an empty Home): drawn in the rows' place, and focusable. */
  body?: React.ReactNode;
  /**
   * The rows' cards for focus coming back after playback: each row's group in its cards' focus
   * keys, its first card's id, and the artwork row the first row is numbered from (`row` of
   * `useSectionCards`). A row the list has not mounted is scrolled to; a row that has gone hands
   * over to the row now in its place.
   */
  focusRows?: Readonly<{group: (row: T) => string; first: (row: T) => string | undefined; base: number}>;
  /** Whether a row comes to rest at the top when it takes focus (a row of cards); a taller block (a grid inside Discover) scrolls as usual. */
  snaps?: (row: T) => boolean;
}) {
  const list = useRef<FlatList<T>>(null);
  const latest = useRef({rows, focusRows});
  latest.current = {rows, focusRows};
  const hasFocusRows = !!focusRows;
  const resolver = useMemo<FocusResolver | undefined>(() => (!hasFocusRows ? undefined : {
    reveal: key => {
      const card = parseCardFocusKey(key);
      const {rows: now, focusRows: named} = latest.current;
      if (!card || !named) return false;
      const index = now.findIndex(row => named.group(row) === card.group);
      if (index < 0) return false;
      list.current?.scrollToIndex({index, animated: false});
      return true;
    },
    fallback: (key, place) => {
      const card = parseCardFocusKey(key);
      const {rows: now, focusRows: named} = latest.current;
      if (!card || !named || !now.length || now.some(row => named.group(row) === card.group)) return undefined;
      const index = Math.min(Math.max(0, (place.row ?? named.base) - named.base), now.length - 1);
      const first = named.first(now[index]!);
      return first === undefined ? undefined : cardFocusKey(named.group(now[index]!), first);
    },
  }), [hasFocusRows]);
  useFocusResolver(resolver);
  // Each row comes to rest at the top of the viewport when anything in it takes focus.
  const snapped = useMemo<ListRenderItem<T>>(() => info => (!snaps || snaps(info.item) ? <View collapsable={false} {...({scrollSnapOffset: 0} as object)}>{renderRow(info)}</View> : renderRow(info)), [renderRow, snaps]);
  const listStyle = useMemo(() => ({height: layout.viewport, overflow: 'hidden' as const}), [layout.viewport]);
  const contentStyle = useMemo(() => ({paddingBottom: layout.tail}), [layout.tail]);
  return (
    <View style={{flex: 1}}>
      <PreviewBackdrop store={store} height={layout.top + stripHeight + layout.hero + 120} />
      <View style={{height: layout.top}} />
      {strip ?? null}
      <View style={{height: layout.hero}}>
        {loading ? <PreviewSkeleton height={layout.hero} /> : <PreviewHero store={store} height={layout.hero} identity={identity} />}
        {notice ? <View style={{position: 'absolute', top: 0, left: 0, right: 0}}>{notice}</View> : null}
      </View>
      {/* Down from the tabs comes back to the card last used here, not to whichever is nearest. */}
      <FocusGroup style={listStyle}>
        {body ? <ScrollView style={listStyle} showsVerticalScrollIndicator={false}>{body}</ScrollView> : (
          <FlatList
            ref={list}
            data={rows as T[]}
            keyExtractor={keyExtractor}
            renderItem={snapped}
            style={listStyle}
            contentContainerStyle={contentStyle}
            // The rows follow focus (each row's marker above), never a free scroll.
            {...({snapToAlignment: 'item'} as object)}
            showsVerticalScrollIndicator={false}
            initialNumToRender={Math.max(3, initialRows)}
            maxToRenderPerBatch={2}
            windowSize={5}
            updateCellsBatchingPeriod={50}
            removeClippedSubviews={false}
            // A row far from the window (focus coming back to it after playback) is reached in two steps.
            onScrollToIndexFailed={info => list.current?.scrollToOffset({offset: info.averageItemLength * info.index, animated: false})}
            ListFooterComponent={footer ? <View collapsable={false} {...({scrollSnapOffset: 0} as object)}>{footer}</View> : null}
          />
        )}
      </FocusGroup>
    </View>
  );
}

/** The focused card's artwork behind the preview: wide art as it is, a softened cover when that is all there is. */
function PreviewBackdrop({store, height}: {store: BrowsePreviewStore; height: number}) {
  const {backdrops, colors} = useTheme();
  const artwork = useArtwork();
  const snapshot = useSyncExternalStore(store.subscribe, store.getSnapshot);
  const art = snapshot.art?.entry;
  // "Show backdrops" off: the plain lit canvas, as on Home before.
  if (!backdrops || !art) return null;
  if (art.backdropUrl) return <Backdrop source={artwork(art.backdropUrl)} height={height} align="right" opacity={0.85} />;
  const cover = art.posterUrl ?? art.stillUrl;
  if (!cover) return null;
  return (
    <View pointerEvents="none" style={{position: 'absolute', left: 0, right: 0, top: 0, height, overflow: 'hidden'}}>
      <Image source={artwork(cover)} blurRadius={40} resizeMode="cover" style={{position: 'absolute', left: -32, right: -32, top: -32, bottom: -32, opacity: 0.45}} />
      <Backdrop height={height} />
      <View style={{position: 'absolute', left: 0, right: 0, bottom: 0, height: height * 0.4, backgroundColor: colors.ink, opacity: 0.35}} />
    </View>
  );
}

/** The words about the focused card, at once; its cover (when it has no wide art) once focus has settled. */
function PreviewHero({store, height, identity}: {store: BrowsePreviewStore; height: number; identity: StageIdentity}) {
  const i18n = useI18n();
  const {space, type, window} = useTheme();
  const artwork = useArtwork();
  const snapshot = useSyncExternalStore(store.subscribe, store.getSnapshot);
  const focus = snapshot.focus;
  const preview = useMemo(() => (focus ? browsePreview(focus.entry, i18n.t, {duration: previewDuration, resume: focus.resume}) : undefined), [focus, i18n]);
  const line = (role: keyof typeof type) => type[role].lineHeight ?? 0;
  const lines = heroText(height, {padding: space.lg + space.xl, title: line('display'), line: line('heading'), meta: line('body'), overview: line('body'), gap: space.xs, resume: preview?.resume || preview?.progress ? line('bodyStrong') + space.sm : 0});
  if (!preview) {
    return (
      <View pointerEvents="none" style={{flex: 1, justifyContent: 'flex-end', paddingHorizontal: space.page, paddingBottom: space.xl}}>
        {identity.eyebrow ? <Text variant="label" tone="tertiary" lines={1}>{identity.eyebrow}</Text> : null}
        <Text variant="title" lines={1}>{identity.title}</Text>
      </View>
    );
  }
  // The cover sits beside the words only when the card has no wide art, and only once focus has settled on it.
  const settled = snapshot.art && snapshot.art.entry.id === preview.entry.id && snapshot.art.group === focus!.group;
  const coverHeight = Math.min(height - space.lg - space.xl, 300);
  const coverWidth = preview.coverShape === 'square' ? coverHeight : Math.round(coverHeight * (2 / 3));
  const cover = preview.art === 'cover' && settled ? artwork(preview.artUrl) : undefined;
  return (
    <View pointerEvents="none" accessibilityElementsHidden importantForAccessibility="no-hide-descendants" style={{flex: 1, justifyContent: 'flex-end', paddingHorizontal: space.page, paddingTop: space.lg, paddingBottom: space.xl}}>
      <View style={{flexDirection: 'row', alignItems: 'flex-end', gap: space.xl, maxWidth: window.width * 0.62}}>
        {preview.art === 'cover' ? (
          <View style={{width: coverWidth, height: coverHeight}}>
            {cover ? <ArtworkPlacementContext.Provider value={HERO_PLACEMENT}><Artwork source={cover} shape={preview.coverShape} width={coverWidth} title={preview.title} priority /></ArtworkPlacementContext.Provider> : null}
          </View>
        ) : null}
        <View style={{flex: 1, minWidth: 0}}>
          <Text variant="display" lines={lines.titleLines}>{preview.title}</Text>
          {preview.line ? <Text variant="heading" lines={1} style={{marginTop: space.xs}}>{preview.line}</Text> : null}
          {preview.meta ? <Text variant="body" tone="secondary" lines={1} style={{marginTop: space.xs}}>{preview.meta}</Text> : null}
          {preview.overview && lines.overviewLines ? <Text variant="body" tone="secondary" lines={lines.overviewLines} style={{marginTop: space.sm, maxWidth: 760}}>{preview.overview}</Text> : null}
          {preview.resume || preview.progress > 0 ? (
            <View style={{flexDirection: 'row', alignItems: 'center', gap: space.md, marginTop: space.sm}}>
              {preview.progress > 0 ? <ProgressBar value={preview.progress} style={{width: 280}} /> : null}
              {preview.resume ? <Text variant="bodyStrong" tone="secondary" lines={1}>{preview.resume}</Text> : null}
            </View>
          ) : null}
        </View>
      </View>
    </View>
  );
}

const HERO_PLACEMENT = {row: 0, column: 0, priority: true} as const;

/** The preview's place while the first rows are read: words only (no buttons to stand in for). */
function PreviewSkeleton({height}: {height: number}) {
  const {space} = useTheme();
  return (
    <View style={{height, justifyContent: 'flex-end', gap: space.sm, paddingHorizontal: space.page, paddingBottom: space.xl}}>
      <Skeleton width={520} height={56} />
      <Skeleton width={360} height={24} />
      <Skeleton width={640} height={22} />
    </View>
  );
}

/** Where browsing starts, as the preview's first subject. */
export function previewFocusOf(entry: PreviewFocus['entry'] | undefined, group: string | undefined, resume: boolean): PreviewFocus | undefined {
  return entry && group !== undefined ? {entry, group, resume} : undefined;
}

/**
 * TV: a library's own navigation (Discover, its kind's tabs, and on a grid Sort, Filter and Jump
 * to), one slim strip at the top, in the same place on Discover and on every grid, and kept apart
 * from the preview's words. The library's name and a short line above it (the server, or the
 * grid's count) sit at its start. Up from the first row reaches it; Down goes back to the card last
 * used below. The left rail stays the way between libraries and the app's other places.
 */
export function LibraryStrip({name, eyebrow, tabs, trailing, height}: {name: string; eyebrow?: string; tabs: React.ReactNode; trailing?: React.ReactNode; height: number}) {
  const {space, window} = useTheme();
  return (
    <View style={{height, flexDirection: 'row', alignItems: 'center', gap: space.lg, paddingLeft: space.page, paddingRight: space.page, paddingBottom: space.md}}>
      <View style={{maxWidth: window.width * 0.2, flexShrink: 0}}>
        {eyebrow ? <Text variant="label" tone="tertiary" lines={1}>{eyebrow}</Text> : null}
        <Text variant="heading" lines={1}>{name}</Text>
      </View>
      <View style={{flex: 1, minWidth: 0}}>{tabs}</View>
      {trailing ? <View style={{flexDirection: 'row', alignItems: 'center', gap: space.md}}>{trailing}</View> : null}
    </View>
  );
}
