import React, {useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore} from 'react';
import {AppState, RefreshControl, Text, View, useWindowDimensions} from 'react-native';
import Animated, {runOnJS, useAnimatedScrollHandler} from 'react-native-reanimated';
import {defaultI18n} from '../../../../../packages/i18n/src';
import type {HomeChannel, HomeRow} from '../../../../../packages/client-core/src/home';
import type {ContentEntry} from '../../../../../packages/client-core/src/library-content';
import {homeCollectionCaption, homeRowPresentation, homeSpotlightModels, homeTitleFactParts} from '../../../../../packages/client-core/src/presentation/home-spotlight';
import {homeEntryCapabilities} from '../../../../../packages/client-core/src/home-selection';
import {serverTextLabel} from '../../../../../packages/client-core/src/presentation/server-text';
import {programmeFactParts, programmeTimeRange, type FactPart} from '../../../../../packages/client-core/src/presentation/kit-model';
import {ArtworkPlacementContext} from '../../platform/ArtworkPipeline';
import {AmbientArt} from '../../kit/artwork';
import {Button} from '../../kit/controls';
import {FocusItem, FocusRegion, useFocusRegistry, type FocusRegionProps} from '../../kit/focus';
import {tvFocusIds, tvHomeRegionMap} from '../../shell/tv-focus';
import {NativeHomePaging} from '../../shell/home-paging';
import {tvHomeRows} from './tv-presentation';
import {CollectionBanner, LiveCard, PosterCard, RankedCard, SquareCard, WideCard, type CardProps} from '../../kit/cards';
import {Hero, FocusPreviewHero, Row, type HeroCandidate} from '../../kit/layout';
import {useFocusAnchor} from '../../kit/layout/FocusAnchor';
import type {ArtworkRenderContext, LayoutItemContext} from '../../kit/layout/types';
import {itemSelection} from '../../kit/layout/types';
import {StateView, HomeSkeleton, SkeletonBlock} from '../../kit/states';
import {nativeType, useTheme, type Theme} from '../../kit/theme';
import {homeActionDiagnostics} from '../../platform/home-action-diagnostics';
import type {NativeShellRuntime} from '../../shell/runtime';
import {MusicMixesRow} from '../destinations/music/MusicMixesRow';
import {sameAuthority, type ShellAuthority} from '../../shell/model';
import {HomeHeroFacts, HomeRemoteHint} from './HomeHeroFacts';
import {authorizedHome, homeCardText, homePlayTarget, homeRowHasContent, pageAtVisibleEnd, platformRows} from './model';

type HomeCandidate = HeroCandidate & {entry: ContentEntry; target?: ContentEntry; primaryLabel?: string};

/**
 * Phone Home measurements the drawn frame states outside the shared kit:
 * phone-app.html `.phone .row{margin-top:28px}` and `.phone .row-head .sub{font-size:13px}`
 * (kit.css's shared row-subtitle role is 14). TV and desktop keep their shipped values.
 */
export function homeRowSpacing(theme: Theme) {
  return theme.isTV ? {marginBottom: 30} : theme.platform === 'tablet' ? {marginTop: 26} : theme.layoutMode === 'phone' && theme.platform === 'phone' ? {marginTop: 28} : {marginBottom: 18};
}

/** The hero reserves only its drawn height; the first row's 28 px gap comes from its own margin. */
export function homeHeroBlock(theme: Theme, heroHeight: number, preview: boolean): number {
  return theme.isTV ? (preview ? 588 : 820) : theme.platform === 'tablet' ? heroHeight : theme.layoutMode === 'phone' && theme.platform === 'phone' ? heroHeight : theme.layoutMode === 'desktop' ? heroHeight + theme.spec.shelf.homeOverlap : 588;
}

/**
 * The medium window draws two hero compositions in foldable.html: upright the hero is
 * half the window (440 of 880), and sideways it is the 392 px frame 3f authors. The
 * 392 is drawn, never derived.
 */
export const MEDIUM_SIDEWAYS_HERO = 392;
export const mediumHeroHeight = (width: number, height: number): number => width > height ? MEDIUM_SIDEWAYS_HERO : Math.round(height / 2);
/** foldable.html `.md .ph-hero.sbs .copy`: inset 28, sideways width 320 and upright 300, bottom 30. */
export const mediumCopySide = (width: number, height: number) => ({inset: 28, width: width > height ? 320 : 300, bottom: 30});
/** foldable.html frame 7 draws `--bw:60%` upright and frame 3f the default 66% sideways. */
export const mediumBackdropFraction = (width: number, height: number): number => width > height ? 0.66 : 0.6;
/** foldable.html draws the sideways lockup at 50 px and frame 7 the upright one at 42 px. */
export const mediumLockupSize = (width: number, height: number): number => width > height ? 50 : 42;
/**
 * The drawn size keeps the handheld lockup's own line box and tracking ratios, so the
 * three values stay one coherent column rather than a bare number.
 */
export function mediumLockupStyle(theme: Theme, width: number, height: number) {
  const role = theme.type.lockup, size = mediumLockupSize(width, height), roleSize = role.fontSize ?? size, ratio = size / (roleSize / theme.textScale);
  return {fontSize: roleSize * ratio, lineHeight: (role.lineHeight ?? roleSize) * ratio, letterSpacing: (role.letterSpacing ?? 0) * ratio, marginBottom: 12};
}
/** foldable.html `.phone.md .card{width:140px}` and `.card.wide{width:292px}`. */
export const mediumCardWidth = (wide: boolean): number => wide ? 292 : 140;
/** foldable.html `.phone.md .card .t{font-size:14px}` and `.card .s{font-size:12.5px}`. */
export const mediumCardType = {title: {fontSize: 14}, caption: {fontSize: 12.5}} as const;
/** foldable.html `.phone.md .row-head h2{font-size:21px}`; the row heading role carries 19. */
export const mediumHeadingStyle = {fontSize: 21} as const;

/** The drawn phone row sub-line is 13 px; the shared rowSubtitle role carries 14. */
export function homeRowSubtitle(theme: Theme) {
  return theme.layoutMode === 'phone' ? theme.type.caption : theme.type.rowSubtitle;
}

/** kit.css draws the phone scroll 96 px deep over an 84 px bar; other platforms keep their padding. */
export function homeContentBottom(theme: Theme, bottomInset: number): number {
  return bottomInset + (theme.isTV ? 96 : theme.platform === 'tablet' ? 40 : theme.layoutMode === 'phone' && theme.platform === 'phone' ? 12 : 24);
}

/** Server-authored Home only. No whole-library reads, local ranking or metadata inference. */
export function HomeScreen({runtime, authority, active = true, heroObscured = false, railExpanded = false, bottomInset = 0, onScrolledChange}: {
  runtime: NativeShellRuntime; authority: ShellAuthority; active?: boolean; heroObscured?: boolean; railExpanded?: boolean; bottomInset?: number; onScrolledChange?: (scrolled: boolean) => void;
}) {
  const registry = useFocusRegistry();
  const focusRevision = useSyncExternalStore(registry.subscribe, registry.getSnapshot, registry.getSnapshot);
  const ids = useMemo(() => tvFocusIds(authority), [authority]);
  const theme = useTheme(), dimensions = useWindowDimensions(), t = runtime.text.t;
  const labels = useMemo(() => ({t, has: defaultI18n.has}), [t]);
  const desktop = theme.layoutMode === 'desktop', medium = theme.platform === 'tablet' && !theme.isTV;
  // Confirmed Appearance effects: the drawn card is 100 percent, and the picture is drawn unless the viewer turned backdrops off.
  const cardScale = (runtime.appearanceCardSizePercent ?? 100) / 100, showBackdrops = runtime.appearanceShowBackdrops !== false;
  const windowWidth = theme.isTV ? 1920 : dimensions.width, windowHeight = theme.isTV ? 1080 : dimensions.height;
  const heroHeight = theme.isTV ? 820 : medium ? mediumHeroHeight(windowWidth, windowHeight) : theme.spec.hero.homeHeight[theme.platform];
  const snapshot = useSyncExternalStore(runtime.home.subscribe, runtime.home.getSnapshot);
  const heroActive = active && !heroObscured && !runtime.getSnapshot().selectionActive;
  const document = authorizedHome(snapshot.document, authority);
  const [foreground, setForeground] = useState(AppState.currentState === 'active'), [loadingElapsed, setLoadingElapsed] = useState(0);
  const [heroVisible, setHeroVisible] = useState(true), [visibleRows, setVisibleRows] = useState<ReadonlySet<string>>(new Set());
  const [focus, setFocusState] = useState<{rowId: string; entryId: string}>(), [heroFocused, setHeroFocused] = useState(false), [repeating, setRepeating] = useState(false);
  const focusTarget = useRef<typeof focus>(undefined), canAnchor = useRef(false);
  canAnchor.current = theme.isTV && active && !railExpanded;
  const setFocus = useCallback((next: typeof focus) => {
    if (focusTarget.current?.rowId === next?.rowId && focusTarget.current?.entryId === next?.entryId) return;
    focusTarget.current = next; setFocusState(next);
  }, []);
  const [activeIndex, setActiveIndex] = useState(0);
  const [refreshing, setRefreshing] = useState(false);
  const scrolled = useRef(false), spotlightEntered = useRef(false);
  const rowPositions = useRef(new Map<string, {y: number; height: number}>()), offset = useRef(0);
  const vertical = useFocusAnchor(false, theme.isTV && active);
  const moveToTop = vertical.move;
  useEffect(() => runtime.registerScrollToTop({kind: 'home'}, () => {moveToTop(0, true); if (theme.isTV) {setFocus(undefined); registry.focus(ids.start);}}), [runtime, moveToTop, theme.isTV, registry, ids.start, setFocus]);
  useEffect(() => {if (!theme.isTV) return; return runtime.registerTVPageBack?.(() => {
    const selected = registry.capture();
    if (vertical.offset.value <= 0 && selected?.regionId === ids.spotlight && selected.childId === 'play') return false;
    moveToTop(0, true); setFocus(undefined); registry.focus(ids.start); return true;
  });}, [ids.start, ids.spotlight, moveToTop, registry, runtime, setFocus, theme.isTV, vertical.offset]);
  const current = useCallback(() => {
    try {return sameAuthority(authority, runtime.getSnapshot().authority);}
    catch (error) {if (error instanceof Error && error.name === 'AbortError') return false; throw error;}
  }, [authority, runtime]);
  useEffect(() => {
    if (!theme.isTV || spotlightEntered.current) return;
    // Only the unopened page may acquire entry focus. An already focused rail,
    // row or overlay owns it even when the Home document/artwork arrives later.
    if (registry.capture() || railExpanded) {spotlightEntered.current = true; return;}
    if (!heroActive || !foreground || !current() || !registry.host(ids.spotlight) || !registry.child(ids.start)) return;
    // HeroCopy mounts after its artwork is ready. The guide and actual Play
    // host must both exist before issuing this one platform lifecycle request.
    if (registry.focus(ids.start)) spotlightEntered.current = true;
  }, [current, focusRevision, foreground, heroActive, ids, railExpanded, registry, theme.isTV]);
  const pages = useMemo(() => new NativeHomePaging(runtime.home, () => sameAuthority(authority, runtime.getSnapshot().authority), error => runtime.reportError(error)), [authority, runtime]);
  const pagingRevision = useSyncExternalStore(pages.subscribe, pages.getSnapshot, pages.getSnapshot);
  useEffect(() => pages.activate(), [pages]);
  useEffect(() => {
    const saved = registry.capture();
    const row = document?.rows.find(value => ids.row(value.id) === saved?.regionId);
    const page = row && pages.state(row.id), fulfilled = page?.fulfilled;
    const entryId = fulfilled?.firstItemId;
    if (row && entryId && saved?.childId === page?.hostId) {
      setFocus({rowId: row.id, entryId});
      setHeroFocused(false);
    }
  }, [document, ids, pages, pagingRevision, registry, setFocus]);
  const guarded = (run: () => void) => {if (current()) run();};
  const readLibraries = new Set(runtime.getSnapshot().libraries.filter(library => library.kind === 'books').map(library => library.id));
  const incomingRows = document ? platformRows(document, theme.isTV ? 'tv' : 'phone', readLibraries).filter(homeRowHasContent).map(row => theme.isTV ? pages.present(row) : row) : [];
  const previousRows = useRef<readonly HomeRow[]>([]);
  const occupied = theme.isTV && (registry.isRegionActive(ids.spotlight) || previousRows.current.some(row => registry.isRegionActive(ids.row(row.id))));
  const rows = theme.isTV ? tvHomeRows(previousRows.current, incomingRows, rowId => registry.isRegionActive(ids.row(rowId)), occupied) : incomingRows;
  previousRows.current = rows;
  const regionMap = tvHomeRegionMap(authority, rows.map(row => row.id));
  const ranges = useRef(new Map<string, {first: number; last: number; keys?: readonly string[]}>());
  const viewportHeight = windowHeight, viewportWidth = windowWidth;

  useEffect(() => {if (current()) void runtime.home.load();}, [current, runtime]);
  useEffect(() => {const sub = AppState.addEventListener('change', state => setForeground(state === 'active')); return () => sub.remove();}, []);
  useEffect(() => {
    if (snapshot.phase !== 'loading' && snapshot.phase !== 'idle') return;
    const started = Date.now();
    const timer = setInterval(() => setLoadingElapsed(Date.now() - started), 120);
    return () => clearInterval(timer);
  }, [snapshot.phase]);
  useEffect(() => {
    if (!active || !foreground || !document) return;
    const expiry = Math.min(...document.rows.flatMap(row => row.live ? [Date.parse(row.live.expiresAt)] : []));
    if (!Number.isFinite(expiry)) return;
    const timer = setTimeout(() => {if (current()) void runtime.home.revalidate().catch(runtime.reportError);}, Math.max(0, expiry - Date.now()));
    return () => clearTimeout(timer);
  }, [active, current, document, foreground, runtime]);
  const updateViewport = useCallback((y: number) => {
    offset.current = y;
    setHeroVisible(y < heroHeight);
    if (scrolled.current !== (y > 0)) {scrolled.current = y > 0; onScrolledChange?.(scrolled.current);}
    const visible = new Set<string>();
    for (const [id, box] of rowPositions.current) if (box.y + box.height > y && box.y < y + viewportHeight - bottomInset) visible.add(id);
    setVisibleRows(previous => previous.size === visible.size && [...visible].every(id => previous.has(id)) ? previous : visible);
  }, [bottomInset, heroHeight, onScrolledChange, viewportHeight]);
  const onScroll = useAnimatedScrollHandler(event => {vertical.offset.value = event.contentOffset.y; runOnJS(updateViewport)(event.contentOffset.y);});
  const focusedRow = rows.find(row => row.id === focus?.rowId), focusedEntry = focusedRow?.entries.find(entry => entry.id === focus?.entryId);
  const preview = focusedEntry ? {
    id: focusedEntry.id, title: homeCardText(focusedEntry, true, runtime.text).title, entry: focusedEntry,
    facts: homeTitleFactParts(focusedEntry, runtime.text), overview: focusedEntry.overview,
    target: focusedRow && homePlayTarget(focusedRow, focusedEntry),
  } satisfies HomeCandidate : undefined;
  const candidates: readonly HomeCandidate[] = useMemo(() => document ? homeSpotlightModels(document).map(model => ({
    id: model.entry.id, title: model.entry.displayTitle || model.entry.title, entry: model.entry, overview: model.overview,
    reason: serverTextLabel(labels, model.reason.text), facts: homeTitleFactParts(model.entry, runtime.text),
    target: model.primary?.entry, primaryLabel: model.primary ? t(model.primary.label.key, model.primary.label.params) : undefined,
  })) : [], [document, runtime.text, labels, t]);
  const renderArtwork = (candidate: HomeCandidate, context: ArtworkRenderContext) => <AmbientArt source={runtime.ambient(candidate.entry.backdropUrl ?? candidate.entry.posterUrl)}
    foreground={showBackdrops ? runtime.artwork(candidate.entry.backdropUrl ?? candidate.entry.posterUrl) : undefined} treatment={theme.layoutMode === 'phone' ? 'phone' : 'hero'} visible={active && foreground && context.visible} priority
    onReady={context.onReady} onError={context.onError} foregroundStyle={context.foregroundStyle} width={viewportWidth} height={theme.isTV ? 900 : heroHeight}
    foregroundFraction={medium ? mediumBackdropFraction(windowWidth, windowHeight) : undefined} foregroundFade={medium ? 'left' : undefined}
    position={medium ? {x: 0.38, y: 0.22} : undefined}/>;
  const activate = (entry: ContentEntry, target: ContentEntry | undefined) => guarded(() => {
    if (target?.playback) runtime.actions.play(entry, target.playback); else runtime.actions.navigate(entry);
  });
  const heroActions = (candidate: HomeCandidate) => {
    const offers = homeEntryCapabilities(candidate.entry, {platform: theme.isTV ? 'tv' : 'phone-app', playbackAvailable: !!runtime.playback});
    const order = [...(offers.playable && candidate.target?.playback ? ['play'] : []), ...(offers.watchlisted !== undefined ? ['my-list'] : []), ...(offers.details ? ['details'] : [])];
    return <HomeRegion focus={theme.isTV ? {...regionMap.spotlight, entry: order[0], orientation: 'horizontal', order,
      style: {flexDirection: 'row', alignItems: 'center', gap: theme.isTV ? 18 : 12}} : undefined}>
      {offers.playable && candidate.target?.playback && <Button focusId="play" icon="i-play" variant="primary" size="hero" onFocus={() => {spotlightEntered.current = true; setHeroFocused(true); if (theme.isTV) {moveToTop(0, true); setFocus(undefined);}}} onBlur={() => setHeroFocused(false)} onPress={() => activate(candidate.entry, candidate.target)}
        onLongPressAction={theme.isTV ? () => guarded(() => runtime.actions.more(candidate.entry)) : undefined}>{candidate.primaryLabel ?? t('next.home.play')}</Button>}
      {offers.watchlisted !== undefined && <Button focusId="my-list" icon={offers.watchlisted ? 'i-check' : 'i-plus'} variant="glass" size="hero" onFocus={() => {spotlightEntered.current = true; setHeroFocused(true); if (theme.isTV) {moveToTop(0, true); setFocus(undefined);}}} onBlur={() => setHeroFocused(false)} onPress={() => {
        if (current()) void runtime.actions.myList(candidate.entry, !offers.watchlisted).then(() => {if (current()) return runtime.home.revalidate();}).catch(runtime.reportError);
      }}>{t('next.home.myList')}</Button>}
      {theme.isTV && offers.details && <Button focusId="details" variant="glass" size="hero" onFocus={() => {spotlightEntered.current = true; setHeroFocused(true); if (theme.isTV) {moveToTop(0, true); setFocus(undefined);}}} onBlur={() => setHeroFocused(false)} onPress={() => guarded(() => runtime.actions.navigate(candidate.entry))}>{t('action.details')}</Button>}
    </HomeRegion>;
  };
  const onRowFocus = (row: HomeRow, entryId: string) => {
    if (theme.isTV) spotlightEntered.current = true;
    setFocus({rowId: row.id, entryId}); setHeroFocused(false);
    if (focus?.rowId === row.id && focus.entryId === entryId) return;
    const target = focusTarget.current;
    // Focus changes the TV hero/row geometry. Anchor after that real layout has landed.
    requestAnimationFrame(() => {
      if (!current() || !canAnchor.current || focusTarget.current !== target) return;
      const box = rowPositions.current.get(row.id);
      if (box) vertical.anchor(box.y, box.height, viewportHeight, contentHeight.current, 588, 96);
    });
  };
  const spotlight = <Hero candidates={candidates} activeIndex={activeIndex} onIndexChange={setActiveIndex} heroFocused={heroFocused && !railExpanded}
    testID={theme.isTV ? ids.surface('hero') : undefined} active={heroActive && (!theme.isTV || !preview)} visible={active && foreground && heroVisible} variant={theme.isTV ? 'tv' : desktop ? 'desktop' : 'phone-app'} height={heroHeight}
    copySide={medium ? mediumCopySide(windowWidth, windowHeight) : undefined} lockupStyle={medium ? mediumLockupStyle(theme, windowWidth, windowHeight) : undefined}
    renderArtwork={renderArtwork} renderMetadata={candidate => <HomeHeroFacts facts={candidate.facts ?? []}/>} renderActions={heroActions} onArtworkError={(error, candidate) => runtime.onArtworkError(error, candidate.entry)}/>;
  const contentHeight = useRef(viewportHeight);
  if (!document) return snapshot.error ? <StateView {...runtime.error(snapshot.error, () => guarded(() => {void runtime.home.retry();}))}/>
    : <HomeSkeleton elapsedMs={loadingElapsed} visible={active && foreground}/>;
  if (!document.spotlight.length && !rows.length) return <>{runtime.renderHomeEmpty()}</>;

  return <Animated.ScrollView ref={vertical.scrollRef} testID="native-home" scrollEventThrottle={16} onScroll={onScroll}
    refreshControl={theme.isTV ? undefined : <RefreshControl refreshing={refreshing} tintColor={theme.colors.text} onRefresh={() => {
      if (!current() || refreshing) return;
      setRefreshing(true);
      void runtime.home.revalidate().catch(runtime.reportError).finally(() => {if (current()) setRefreshing(false);});
    }}/>}
    onContentSizeChange={(_, height) => {contentHeight.current = height;}} onScrollBeginDrag={vertical.stop}
    showsVerticalScrollIndicator={false} contentContainerStyle={{paddingBottom: homeContentBottom(theme, bottomInset)}}>
    <View style={{height: homeHeroBlock(theme, heroHeight, !!preview)}}>
      {/* tv-focus frames1..3: the real spotlight controls stay mounted for native
          Up guides while the preview covers them. Focus restores the spotlight. */}
      {theme.isTV ? <View pointerEvents={preview ? 'none' : 'box-none'} style={{position: 'absolute', inset: 0}}>{spotlight}</View> : spotlight}
      {theme.isTV && preview && <View pointerEvents="none" style={{position: 'absolute', left: 0, right: 0, top: 0, height: heroHeight, backgroundColor: theme.colors.ink}}><FocusPreviewHero focusedEntry={preview} repeating={repeating || vertical.repeating} active={heroActive} visible={active && foreground && heroVisible}
        renderArtwork={renderArtwork} renderReason={candidate => <View style={{flexDirection: 'row', gap: 16, marginBottom: 16}}>{homeCardText(candidate.entry, true, runtime.text).caption.map(part => <Text key={part.id} numberOfLines={1} style={[theme.type.eyebrow, {color: theme.colors.accentStrong, flexShrink: 1, includeFontPadding: false}]}>{part.text}</Text>)}</View>}
        renderMetadata={candidate => <HomeHeroFacts facts={candidate.facts ?? []} continuation={homeCardText(candidate.entry, true, runtime.text)}/>}
        renderHint={candidate => <HomeRemoteHint resume={!!candidate.target?.progressSeconds} text={runtime.text}/>}
        onPreviewError={(error, candidate) => runtime.onArtworkError(error, candidate.entry)}/></View>}
    </View>
    {rows.map((row, rowIndex) => {
      const sourceRow = document.rows.find(value => value.id === row.id);
      if (!sourceRow) return null;
      const physicalIds = theme.isTV ? row.live ? row.live.channels.map(item => JSON.stringify([item.channel.sourceId, item.channel.id])) : row.entries.map(entry => entry.id) : undefined;
      const shown = active && foreground && (visibleRows.has(row.id) || !rowPositions.current.has(row.id) && rowIndex === 0);
      const presentation = homeRowPresentation(row), wide = row.artworkShape === 'landscape', square = row.artworkShape === 'square';
      const ranked = presentation.cards.some(card => card.rank !== undefined);
      const drawnWidth = ranked ? theme.isTV ? 318 : desktop ? theme.spec.shelf.rank.width : 186
        : wide ? medium ? mediumCardWidth(true) : desktop || theme.isTV ? theme.spec.card.width.wide[theme.platform] : theme.spec.card.width.phoneMockWide
        : square ? theme.spec.card.width.square[theme.platform] : medium ? mediumCardWidth(false) : theme.spec.card.width.poster[theme.platform];
      const width = cardScale === 1 ? drawnWidth : Math.round(drawnWidth * cardScale);
      const posterWidth = ranked ? Math.round((theme.isTV ? 214 : desktop ? theme.spec.shelf.rank.posterWidth : 116) * cardScale) : width;
      const height = wide ? width * 9 / 16 : square ? width + (theme.isTV ? 80 : 54) : posterWidth * 1.5 + (theme.isTV ? 80 : 48);
      const pending = pages.state(row.id), waitingItem = presentation.cards.at(-1);
      const waitingId = pending?.loading ? pending.waitingId : ids.page(row.id, row.nextCursor);
      const paging = theme.isTV && waitingItem && !row.live && !row.collection ? {hasMore: !!row.nextCursor || !!pending?.loading,
        loading: !!pending?.loading || !!snapshot.paging?.has(row.id) || !shown, failed: !!pending?.failed && pending.cursor === row.nextCursor,
        waitingId, waitingItem, fulfilled: pending?.fulfilled, requestNext: () => {if (shown && current()) void pages.request(sourceRow, waitingId);}} : undefined;
      const title = serverTextLabel(labels, presentation.title), subtitle = serverTextLabel(labels, presentation.subtitle);
      // The drawn phone subtitle is 13 px; the shared role carries 14 until the kit models it.
      const rowSubtitle = subtitle ? theme.layoutMode === 'phone' && theme.platform === 'phone'
        ? <Text numberOfLines={1} style={[homeRowSubtitle(theme), {color: theme.colors.textTertiary, includeFontPadding: false}]}>{subtitle}</Text>
        : subtitle : undefined;
      const retainedIds = theme.isTV && registry.isRegionActive(ids.row(row.id)) && focus?.rowId === row.id ? [focus.entryId] : undefined;
      const range = (first: number, last: number) => {if (!current()) return; const keys = ranges.current.get(row.id)?.keys; ranges.current.set(row.id, {first, last, keys}); runtime.setHomeWindow(sourceRow, rowIndex, first, last, shown, physicalIds, retainedIds, keys); if (shown && (!theme.isTV || row.live) && pageAtVisibleEnd(row, last, theme.isTV ? 10 : 3)) void runtime.home.more(row.id);};
      const visibleKeys = (keys: readonly string[]) => {if (!current()) return; const before = ranges.current.get(row.id) ?? {first: 0, last: -1};
        ranges.current.set(row.id, {...before, keys}); runtime.setHomeWindow(sourceRow, rowIndex, before.first, before.last, shown, physicalIds, retainedIds, keys);};
      return <HomeWindow key={row.id} runtime={runtime} row={sourceRow} sectionOrder={rowIndex} visible={shown} physicalIds={physicalIds} retainedIds={retainedIds} range={ranges.current.get(row.id)}><View onLayout={event => {const box = event.nativeEvent.layout;
        rowPositions.current.set(row.id, box); updateViewport(offset.current);
        // Initial focus can precede the compact hero layout. Re-anchor against
        // this measured box rather than retaining the previous hero's offset.
        if (canAnchor.current && focus?.rowId === row.id && focusTarget.current?.rowId === row.id && current()) vertical.anchor(box.y, box.height, viewportHeight, contentHeight.current, 588, 96);}} style={homeRowSpacing(theme)}>
        {row.live ? <HomeLiveRow row={row} runtime={runtime} visible={shown} itemWidth={theme.isTV ? 400 : desktop ? theme.spec.card.live.width.web : theme.spec.card.live.width.phone} onRange={range} onVisibleKeys={visibleKeys} onItemFocus={item => onRowFocus(row, JSON.stringify([item.channel.sourceId, item.channel.id]))} current={current} focus={theme.isTV ? regionMap.rows.get(row.id) : undefined} viewportWidth={viewportWidth}/>
          : row.collection ? <HomeRegion focus={theme.isTV ? {...regionMap.rows.get(row.id)!, orientation: 'horizontal', order: [ids.collection(row.collection)]} : undefined}><FocusItem focusId={ids.collection(row.collection)}><View style={{paddingHorizontal: theme.gutter}}><HomeCollectionCard row={row} runtime={runtime}
            width={viewportWidth - theme.gutter - (theme.isTV ? 96 : theme.gutter)} visible={shown} current={current} onFocus={() => onRowFocus(row, row.collection!.collection.id)}/></View></FocusItem></HomeRegion>
          : <Row title={title} subtitle={rowSubtitle} items={presentation.cards} getKey={item => item.entry.id} getFocusId={item => ids.entry(item.entry)} focus={theme.isTV ? regionMap.rows.get(row.id) : undefined} initialViewportWidth={viewportWidth} testID={theme.isTV ? ids.row(row.id) : undefined} itemWidth={width} itemHeight={height}
            gutter={medium ? 24 : theme.gutter} rightGutter={medium ? 24 : theme.isTV ? 96 : theme.gutter} gap={medium ? 14 : undefined} headingStyle={medium ? mediumHeadingStyle : undefined} selection={runtime.selection(row.id)} paging={paging} onVisibleRange={range} onVisibleKeys={visibleKeys}
            onSeeAll={row.seeAll ? () => guarded(() => runtime.actions.seeAll(row.seeAll!)) : undefined} onRepeatingChange={setRepeating}
            onItemFocus={item => onRowFocus(row, item.entry.id)} renderItem={(item, context) => <View style={{width, height}}><HomeCard runtime={runtime} row={row} entry={item.entry} rank={item.rank} context={context}
              width={width} rowIndex={rowIndex} visible={shown} preferred={false}
              current={current}/>{context.waiting && <View pointerEvents="none" style={{position: 'absolute', inset: 0, backgroundColor: theme.colors.ink}}><SkeletonBlock width={width} height={height}/></View>}</View>}/>}
      </View></HomeWindow>;
    })}
    {runtime.mixes ? <HomeRegion><MusicMixesRow port={runtime.mixes} artwork={runtime.artwork} reportError={runtime.reportError} title={t('music.mixesForYou')} onOpen={runtime.musicDiscover}/></HomeRegion> : null}
    <HomeRegion focus={theme.isTV ? {...regionMap.customize, order: ['customize']} : undefined}><View style={theme.isTV ? {paddingHorizontal: theme.gutter, paddingVertical: 24} : {marginTop: 34, marginHorizontal: 24, alignItems: 'center', gap: 12}}><Button focusId="customize" variant={theme.isTV ? 'text' : 'glass'} size={theme.isTV ? 'compact' : undefined} icon={theme.isTV ? undefined : 'i-sliders'} style={theme.isTV ? undefined : {height: 48, paddingHorizontal: 22}} onPress={() => guarded(runtime.actions.customize)}>{t('home.customize.action')}</Button>
      {!theme.isTV && <Text style={[nativeType({size: 13, weight: 400, tracking: 0, lineHeight: 19.5}, theme.textScale), {color: theme.colors.textTertiary, textAlign: 'center'}]}>{t('next.home.customizeDescription')}</Text>}
    </View></HomeRegion>
  </Animated.ScrollView>;
}

function HomeRegion({focus, children}: {focus?: Omit<FocusRegionProps, 'children'>; children: React.ReactNode}) {
  return focus ? <FocusRegion {...focus}>{children}</FocusRegion> : <>{children}</>;
}

function HomeWindow({runtime, row, sectionOrder, visible, physicalIds, retainedIds, range, children}: {runtime: NativeShellRuntime; row: HomeRow; sectionOrder: number; visible: boolean; physicalIds?: readonly string[]; retainedIds?: readonly string[]; range?: {first: number; last: number; keys?: readonly string[]}; children: React.ReactNode}) {
  const {isTV} = useTheme(), rowId = row.id, latest = useRef({row, sectionOrder});
  latest.current = {row, sectionOrder};
  // Updating a measured range is not an unmount. Cleanup belongs only to this
  // row's lifetime; otherwise registration publishes recursively recreate it.
  useEffect(() => {
    if (isTV) return;
    runtime.setHomeWindow(row, sectionOrder, 0, Math.min(127, (row.live?.channels.length ?? row.entries.length) - 1), visible);
  }, [isTV, runtime, row, sectionOrder, visible]);
  useEffect(() => {
    if (!isTV) return;
    runtime.setHomeWindow(row, sectionOrder, range?.first ?? 0, range?.last ?? (row.collection ? 0 : -1), visible, physicalIds, retainedIds, range?.keys);
  }, [isTV, runtime, row, sectionOrder, visible, physicalIds, retainedIds, range]);
  useEffect(() => () => {const current = latest.current; runtime.setHomeWindow(current.row, current.sectionOrder, 0, -1, false);}, [runtime, rowId]);
  return children;
}

function HomeCard({runtime, row, entry, rank, context, width, rowIndex, visible, preferred, medium = false, current}: {
  runtime: NativeShellRuntime; row: HomeRow; entry: ContentEntry; rank?: number; context: LayoutItemContext; width: number; rowIndex: number; visible: boolean; preferred: boolean; medium?: boolean; current: () => boolean;
}) {
  const theme = useTheme(), anchor = useRef<View>(null), text = homeCardText(entry, row.kind === 'continue' || row.id === 'continue_books', runtime.text), target = homePlayTarget(row, entry);
  const navigate = () => {if (current()) runtime.actions.navigate(entry);};
  const offers = homeEntryCapabilities(entry, {platform: theme.isTV ? 'tv' : 'phone-app', playbackAvailable: !!runtime.playback});
  const play = offers.playable && target?.playback ? () => {homeActionDiagnostics.action('home-card', 'primary-play'); if (current()) runtime.actions.play(entry, target.playback!);} : undefined;
  const actions = play && (theme.isTV || row.kind === 'continue') ? {primaryAction: 'play' as const, onPlay: play, onNavigate: navigate}
    : {primaryAction: 'navigate' as const, onNavigate: navigate, ...(play ? {onPlay: play} : {})};
  const props: CardProps = {...text, ...actions, width, visible, onFocus: context.onFocus, onBlur: context.onBlur, selection: context.selection, hasTVPreferredFocus: preferred, testID: context.testID,
    ...(medium ? {titleTextStyle: mediumCardType.title, captionTextStyle: mediumCardType.caption} : {}),
    menuAnchorRef: anchor, moreExpanded: runtime.selection(row.id).isMenuOpen?.(entry.id),
    accessibilityState: {expanded: !!runtime.selection(row.id).isMenuOpen?.(entry.id)},
    onMore: () => {if (current()) runtime.actions.more(entry, row.id, anchor);}};
  const art = runtime.artwork(row.artworkShape === 'landscape' ? entry.backdropUrl ?? entry.posterUrl : entry.posterUrl);
  return <ArtworkPlacementContext.Provider value={{row: rowIndex + 1, column: context.index, group: row.id}}>
    {rank ? <RankedCard {...props} rank={rank} artwork={art} isNew={entry.new} watched={entry.watched}/>
      : row.artworkShape === 'landscape' ? <WideCard {...props} artwork={art} progress={text.progress} watched={entry.watched}/>
      : row.artworkShape === 'square' ? <SquareCard {...props} artwork={art} progress={text.progress} watched={entry.watched} isNew={entry.new}/>
      : <PosterCard {...props} artwork={art} watched={entry.watched} isNew={entry.new}/>}
  </ArtworkPlacementContext.Provider>;
}

function HomeCollectionCard({row, runtime, width, visible, current, onFocus}: {row: HomeRow; runtime: NativeShellRuntime; width: number; visible: boolean; current: () => boolean; onFocus: () => void}) {
  const anchor = useRef<View>(null), collection = row.collection!, t = runtime.text.t;
  return <CollectionBanner onFocus={onFocus} title={collection.collection.name} kindLabel={t('next.home.collection')}
    covers={collection.members.flatMap(entry => {const artwork = runtime.artwork(entry.posterUrl); return artwork ? [artwork] : [];})}
    body={homeCollectionCaption(collection, runtime.text)[0]?.text} width={width} backdrop={runtime.artwork(collection.backdropUrl)} ambient={runtime.ambient(collection.backdropUrl)} visible={visible}
    menuAnchorRef={anchor} moreExpanded={runtime.selection(row.id).isMenuOpen?.(collection.collection.id)} accessibilityState={{expanded: !!runtime.selection(row.id).isMenuOpen?.(collection.collection.id)}}
    selection={itemSelection(runtime.selection(row.id), collection.collection.id)} onMore={() => {if (current()) runtime.actions.collectionMore(collection, row.id, anchor);}}
    primaryAction="navigate" onNavigate={() => {if (current()) runtime.actions.seeAll(row.seeAll ?? {type: 'collection', resourceId: collection.collection.id, libraryId: collection.collection.libraryId});}}/>;
}

function HomeLiveRow({row, runtime, visible, itemWidth, onRange, onVisibleKeys, onItemFocus, current, focus, viewportWidth}: {row: HomeRow; runtime: NativeShellRuntime; visible: boolean; itemWidth: number; onRange: (first: number, last: number) => void; onVisibleKeys: (keys: readonly string[]) => void; onItemFocus: (item: HomeChannel) => void; current: () => boolean; focus?: Omit<FocusRegionProps, 'children' | 'order' | 'orientation'>; viewportWidth: number}) {
  const theme = useTheme(), live = row.live!, labels = {t: runtime.text.t, has: defaultI18n.has}, medium = theme.platform === 'tablet' && !theme.isTV;
  // Projection time, expiry and server-issued marks define the bounded row. No lineup scan.
  const observed = Date.parse(live.observedAt);
  if (Date.now() >= Date.parse(live.expiresAt)) return null;
  // The drawn live row carries its server-authored sub-line ("Synthetic Live TV").
  const subtitle = serverTextLabel(labels, row.subtitleText);
  const rowSubtitle = subtitle && theme.layoutMode === 'phone' && theme.platform === 'phone'
    ? <Text numberOfLines={1} style={[homeRowSubtitle(theme), {color: theme.colors.textTertiary, includeFontPadding: false}]}>{subtitle}</Text>
    : undefined;
  return <Row title={serverTextLabel(labels, row.titleText, row.title)} subtitle={rowSubtitle} items={live.channels} getKey={item => JSON.stringify([item.channel.sourceId, item.channel.id])} getFocusId={item => JSON.stringify(['channel', item.channel.sourceId, item.channel.id])} focus={focus} initialViewportWidth={viewportWidth}
    itemWidth={itemWidth} itemHeight={theme.isTV ? 225 : theme.layoutMode === 'desktop' ? theme.spec.card.live.height.web : theme.spec.card.live.height.phone} selection={runtime.selection(row.id)} onVisibleRange={onRange} onVisibleKeys={onVisibleKeys} onItemFocus={onItemFocus}
    gutter={medium ? 24 : undefined} rightGutter={medium ? 24 : undefined} gap={medium ? 14 : undefined} headingStyle={medium ? mediumHeadingStyle : undefined}
    onSeeAll={row.seeAll ? () => {if (current()) runtime.actions.seeAll(row.seeAll!);} : undefined}
    renderItem={(item: HomeChannel, context) => <HomeChannelCard rowId={row.id} item={item} context={context} runtime={runtime} current={current} visible={visible} observed={observed} width={itemWidth}/>}/>;
}

function HomeChannelCard({rowId, item, context, runtime, current, visible, observed, width}: {rowId: string; item: HomeChannel; context: LayoutItemContext; runtime: NativeShellRuntime; current: () => boolean; visible: boolean; observed: number; width: number}) {
  const anchor = useRef<View>(null), channel = item.channel, programme = channel.programmes.find(value => Date.parse(value.start) <= observed && Date.parse(value.end) > observed);
  const parts: readonly FactPart[] = programme ? programmeFactParts({startMs: Date.parse(programme.start), endMs: Date.parse(programme.end), subtitle: programme.subtitle, flags: programme.flags, recording: !!programme.recordingId}, runtime.text, observed) : [];
  const range = programme && programmeTimeRange(Date.parse(programme.start), Date.parse(programme.end), runtime.text);
  return <LiveCard testID={context.testID} title={programme?.title ?? channel.name} channel={channel.name} number={channel.number} sourceName={item.source.name}
    mark={{id: channel.id, sourceId: channel.sourceId, ...channel.mark}} logo={runtime.artwork(channel.logoPath)} width={width} visible={visible}
    flags={parts.filter(part => part.role === 'status')} caption={parts.filter(part => part.id === 'remaining')} range={range?.text}
    progress={programme ? (observed - Date.parse(programme.start)) / (Date.parse(programme.end) - Date.parse(programme.start)) : undefined}
    menuAnchorRef={anchor} moreExpanded={runtime.selection(rowId).isMenuOpen?.(JSON.stringify([item.channel.sourceId, item.channel.id]))} accessibilityState={{expanded: !!runtime.selection(rowId).isMenuOpen?.(JSON.stringify([item.channel.sourceId, item.channel.id]))}}
    primaryAction="navigate" onNavigate={() => {if (current()) runtime.actions.channel(item);}} onMore={() => {if (current()) runtime.actions.channelMore(item, anchor);}}
    onFocus={context.onFocus} onBlur={context.onBlur} selection={context.selection}/>;
}
