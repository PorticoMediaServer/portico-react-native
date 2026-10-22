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
import {CollectionBanner, LiveCard, PosterCard, RankedCard, SquareCard, WideCard, type CardProps} from '../../kit/cards';
import {Hero, FocusPreviewHero, Row, type HeroCandidate} from '../../kit/layout';
import {useFocusAnchor} from '../../kit/layout/FocusAnchor';
import type {ArtworkRenderContext, LayoutItemContext} from '../../kit/layout/types';
import {itemSelection} from '../../kit/layout/types';
import {StateView, HomeSkeleton} from '../../kit/states';
import {useTheme} from '../../kit/theme';
import type {NativeShellRuntime} from '../../shell/runtime';
import {sameAuthority, type ShellAuthority} from '../../shell/model';
import {authorizedHome, homeCardText, homePlayTarget, initialHomeFocus, pageAtVisibleEnd, platformRows} from './model';

type HomeCandidate = HeroCandidate & {entry: ContentEntry; target?: ContentEntry; primaryLabel?: string};
const t = defaultI18n.t;

/** Server-authored Home only. No whole-library reads, local ranking or metadata inference. */
export function HomeScreen({runtime, authority, active = true, heroObscured = false, railExpanded = false, bottomInset = 0, onScrolledChange}: {
  runtime: NativeShellRuntime; authority: ShellAuthority; active?: boolean; heroObscured?: boolean; railExpanded?: boolean; bottomInset?: number; onScrolledChange?: (scrolled: boolean) => void;
}) {
  const theme = useTheme(), dimensions = useWindowDimensions();
  const desktop = theme.layoutMode === 'desktop';
  const heroHeight = theme.isTV ? 820 : theme.spec.hero.homeHeight[theme.platform];
  const snapshot = useSyncExternalStore(runtime.home.subscribe, runtime.home.getSnapshot);
  const heroActive = active && !heroObscured && !runtime.getSnapshot().selectionActive;
  const document = authorizedHome(snapshot.document, authority);
  const [foreground, setForeground] = useState(AppState.currentState === 'active'), [loadingElapsed, setLoadingElapsed] = useState(0);
  const [heroVisible, setHeroVisible] = useState(true), [visibleRows, setVisibleRows] = useState<ReadonlySet<string>>(new Set());
  const [focus, setFocus] = useState<{rowId: string; entryId: string}>(), [heroFocused, setHeroFocused] = useState(false), [repeating, setRepeating] = useState(false);
  const [activeIndex, setActiveIndex] = useState(0);
  const [refreshing, setRefreshing] = useState(false);
  const scrolled = useRef(false);
  const rowPositions = useRef(new Map<string, {y: number; height: number}>()), offset = useRef(0);
  const vertical = useFocusAnchor(false, theme.isTV && active);
  const moveToTop = vertical.move;
  useEffect(() => runtime.registerScrollToTop({kind: 'home'}, () => moveToTop(0)), [runtime, moveToTop]);
  const current = useCallback(() => sameAuthority(authority, runtime.getSnapshot().authority), [authority, runtime]);
  const guarded = (run: () => void) => {if (current()) run();};
  const readLibraries = new Set(runtime.getSnapshot().libraries.filter(library => library.kind === 'books').map(library => library.id));
  const rows = document ? platformRows(document, theme.isTV ? 'tv' : 'phone', readLibraries) : [];
  const viewportHeight = theme.isTV ? 1080 : dimensions.height;
  const viewportWidth = theme.isTV ? 1920 : dimensions.width;

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
  const initialFocus = initialHomeFocus(rows);
  const focusedRow = rows.find(row => row.id === focus?.rowId), focusedEntry = focusedRow?.entries.find(entry => entry.id === focus?.entryId);
  const preview = focusedEntry ? {
    id: focusedEntry.id, title: homeCardText(focusedEntry, true, runtime.text).title, entry: focusedEntry,
    facts: homeTitleFactParts(focusedEntry, runtime.text), overview: focusedEntry.overview,
    target: focusedRow && homePlayTarget(focusedRow, focusedEntry),
  } satisfies HomeCandidate : undefined;
  const candidates: readonly HomeCandidate[] = useMemo(() => document ? homeSpotlightModels(document).map(model => ({
    id: model.entry.id, title: model.entry.title, entry: model.entry, overview: model.overview,
    reason: serverTextLabel(defaultI18n, model.reason.text), facts: homeTitleFactParts(model.entry, runtime.text),
    target: model.primary?.entry, primaryLabel: model.primary ? t(model.primary.label.key, model.primary.label.params) : undefined,
  })) : [], [document, runtime.text]);
  const renderArtwork = (candidate: HomeCandidate, context: ArtworkRenderContext) => <AmbientArt source={runtime.ambient(candidate.entry.backdropUrl ?? candidate.entry.posterUrl)}
    foreground={runtime.artwork(candidate.entry.backdropUrl ?? candidate.entry.posterUrl)} treatment={theme.layoutMode === 'phone' ? 'phone' : 'hero'} visible={active && foreground && context.visible} priority
    onReady={context.onReady} onError={context.onError} foregroundStyle={context.foregroundStyle} width={viewportWidth} height={theme.isTV ? 900 : heroHeight}/>;
  const activate = (entry: ContentEntry, target: ContentEntry | undefined) => guarded(() => {
    if (target?.playback) runtime.actions.play(entry, target.playback); else runtime.actions.navigate(entry);
  });
  const heroActions = (candidate: HomeCandidate) => {
    const offers = homeEntryCapabilities(candidate.entry, {platform: theme.isTV ? 'tv' : 'phone-app', playbackAvailable: !!runtime.playback});
    return <>
      {offers.playable && candidate.target?.playback && <Button icon="i-play" variant="primary" size="hero" hasTVPreferredFocus={theme.isTV && !initialFocus} onFocus={() => setHeroFocused(true)} onBlur={() => setHeroFocused(false)} onPress={() => activate(candidate.entry, candidate.target)}>{candidate.primaryLabel ?? t('next.home.play')}</Button>}
      {offers.watchlisted !== undefined && <Button icon={offers.watchlisted ? 'i-check' : 'i-plus'} variant="glass" size="hero" onFocus={() => setHeroFocused(true)} onBlur={() => setHeroFocused(false)} onPress={() => {
        if (current()) void runtime.actions.myList(candidate.entry, !offers.watchlisted).then(() => {if (current()) return runtime.home.revalidate();}).catch(runtime.reportError);
      }}>{t('next.home.myList')}</Button>}
      {theme.isTV && offers.details && <Button variant="glass" size="hero" onFocus={() => setHeroFocused(true)} onBlur={() => setHeroFocused(false)} onPress={() => guarded(() => runtime.actions.navigate(candidate.entry))}>{t('action.details')}</Button>}
    </>;
  };
  const onRowFocus = (row: HomeRow, entry: ContentEntry) => {
    setFocus({rowId: row.id, entryId: entry.id}); setHeroFocused(false);
    // Focus changes the TV hero/row geometry. Anchor after that real layout has landed.
    requestAnimationFrame(() => {
      if (!current()) return;
      const box = rowPositions.current.get(row.id);
      if (box) vertical.anchor(box.y, box.height, viewportHeight, contentHeight.current, 588, 96);
    });
  };
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
    showsVerticalScrollIndicator={false} contentContainerStyle={{paddingBottom: bottomInset + (theme.isTV ? 96 : 24)}}>
    <View style={{height: theme.isTV ? preview && !railExpanded ? 588 : 820 : desktop ? heroHeight + theme.spec.shelf.homeOverlap : 588}}>
      {theme.isTV && preview && !railExpanded ? <FocusPreviewHero focusedEntry={preview} repeating={repeating || vertical.repeating} active={heroActive} visible={active && foreground && heroVisible}
        renderArtwork={renderArtwork} renderReason={candidate => <View style={{flexDirection: 'row', gap: 16, marginBottom: 16}}>{homeCardText(candidate.entry, true, runtime.text).caption.map(part => <Text key={part.id} numberOfLines={1} style={[theme.type.eyebrow, {color: theme.colors.accentStrong, flexShrink: 1}]}>{part.text}</Text>)}</View>}
        renderHint={candidate => <View style={{flexDirection: 'row', gap: 12, alignItems: 'center'}}><Text style={[theme.type.captionStrong, {color: theme.colors.textSecondary}]}>{t('next.layout.ok')}</Text><Text style={[theme.type.caption, {color: theme.colors.textTertiary, marginRight: 32}]}>{t(candidate.target?.progressSeconds ? 'next.home.resume' : 'next.home.play')}</Text><Text style={[theme.type.captionStrong, {color: theme.colors.textSecondary}]}>{t('next.layout.holdOk')}</Text><Text style={[theme.type.caption, {color: theme.colors.textTertiary}]}>{t('next.layout.moreOptions')}</Text></View>}
        onPreviewError={(error, candidate) => runtime.onArtworkError(error, candidate.entry)}/>
        : <Hero candidates={candidates} activeIndex={activeIndex} onIndexChange={setActiveIndex} heroFocused={heroFocused && !railExpanded}
          active={heroActive} visible={active && foreground && heroVisible} variant={theme.isTV ? 'tv' : desktop ? 'desktop' : 'phone-app'} height={heroHeight}
          renderArtwork={renderArtwork} renderActions={heroActions} onArtworkError={(error, candidate) => runtime.onArtworkError(error, candidate.entry)}/>}
    </View>
    {rows.map((row, rowIndex) => {
      const shown = active && foreground && (visibleRows.has(row.id) || !rowPositions.current.has(row.id) && rowIndex === 0);
      const presentation = homeRowPresentation(row), wide = row.artworkShape === 'landscape', square = row.artworkShape === 'square';
      const ranked = presentation.cards.some(card => card.rank !== undefined);
      const width = ranked ? theme.isTV ? 318 : desktop ? theme.spec.shelf.rank.width : 186
        : wide ? desktop || theme.isTV ? theme.spec.card.width.wide[theme.platform] : theme.spec.card.width.phoneMockWide
        : square ? theme.spec.card.width.square[theme.platform] : theme.spec.card.width.poster[theme.platform];
      const posterWidth = ranked ? theme.isTV ? 214 : desktop ? theme.spec.shelf.rank.posterWidth : 116 : width;
      const height = wide ? width * 9 / 16 : square ? width + (theme.isTV ? 80 : 54) : posterWidth * 1.5 + (theme.isTV ? 80 : 48);
      const title = serverTextLabel(defaultI18n, presentation.title), subtitle = serverTextLabel(defaultI18n, presentation.subtitle);
      const range = (first: number, last: number) => {if (!current()) return; runtime.setHomeWindow(row, rowIndex, first, last, shown); if (shown && pageAtVisibleEnd(row, last)) void runtime.home.more(row.id);};
      return <HomeWindow key={row.id} runtime={runtime} row={row} sectionOrder={rowIndex} visible={shown}><View onLayout={event => {rowPositions.current.set(row.id, event.nativeEvent.layout); updateViewport(offset.current);}} style={{marginBottom: theme.isTV ? 30 : 18}}>
        {row.live ? <HomeLiveRow row={row} runtime={runtime} visible={shown} itemWidth={theme.isTV ? 400 : desktop ? theme.spec.card.live.width.web : theme.spec.card.live.width.phone} onRange={range} current={current}/>
          : row.collection ? <View style={{paddingHorizontal: theme.gutter}}><CollectionBanner title={row.collection.collection.name} kindLabel={t('next.home.collection')} covers={row.collection.members.flatMap(entry => {const artwork = runtime.artwork(entry.posterUrl); return artwork ? [artwork] : [];})}
            body={homeCollectionCaption(row.collection, runtime.text)[0]?.text}
            width={viewportWidth - theme.gutter - (theme.isTV ? 96 : theme.gutter)} backdrop={runtime.artwork(row.collection.backdropUrl)} ambient={runtime.ambient(row.collection.backdropUrl)} visible={shown}
            selection={itemSelection(runtime.selection(row.id), row.collection.collection.id)} onMore={() => guarded(() => runtime.actions.collectionMore(row.collection!, row.id))}
            primaryAction="navigate" onNavigate={() => guarded(() => runtime.actions.seeAll(row.seeAll ?? {type: 'collection', resourceId: row.collection!.collection.id, libraryId: row.collection!.collection.libraryId}))}/></View>
          : <Row title={title} subtitle={subtitle || undefined} items={presentation.cards} getKey={item => item.entry.id} itemWidth={width} itemHeight={height}
            gutter={theme.gutter} rightGutter={theme.isTV ? 96 : theme.gutter} selection={runtime.selection(row.id)} onVisibleRange={range}
            onSeeAll={row.seeAll ? () => guarded(() => runtime.actions.seeAll(row.seeAll!)) : undefined} onRepeatingChange={setRepeating}
            onItemFocus={item => onRowFocus(row, item.entry)} renderItem={(item, context) => <HomeCard runtime={runtime} row={row} entry={item.entry} rank={item.rank} context={context}
              width={width} rowIndex={rowIndex} visible={shown} preferred={theme.isTV && initialFocus?.rowId === row.id && initialFocus.entryId === item.entry.id}
              current={current}/>}/>} 
      </View></HomeWindow>;
    })}
    <View style={{paddingHorizontal: theme.gutter, paddingVertical: 24}}><Button variant="text" size="compact" onPress={() => guarded(runtime.actions.customize)}>{t('home.customize.action')}</Button></View>
  </Animated.ScrollView>;
}

function HomeWindow({runtime, row, sectionOrder, visible, children}: {runtime: NativeShellRuntime; row: HomeRow; sectionOrder: number; visible: boolean; children: React.ReactNode}) {
  useEffect(() => {
    runtime.setHomeWindow(row, sectionOrder, 0, Math.min(127, (row.live?.channels.length ?? row.entries.length) - 1), visible);
    return () => runtime.setHomeWindow(row, sectionOrder, 0, -1, false);
  }, [runtime, row, sectionOrder, visible]);
  return children;
}

function HomeCard({runtime, row, entry, rank, context, width, rowIndex, visible, preferred, current}: {
  runtime: NativeShellRuntime; row: HomeRow; entry: ContentEntry; rank?: number; context: LayoutItemContext; width: number; rowIndex: number; visible: boolean; preferred: boolean; current: () => boolean;
}) {
  const theme = useTheme(), text = homeCardText(entry, row.kind === 'continue' || row.id === 'continue_books', runtime.text), target = homePlayTarget(row, entry);
  const navigate = () => {if (current()) runtime.actions.navigate(entry);};
  const offers = homeEntryCapabilities(entry, {platform: theme.isTV ? 'tv' : 'phone-app', playbackAvailable: !!runtime.playback});
  const play = offers.playable && target?.playback ? () => {if (current()) runtime.actions.play(entry, target.playback!);} : undefined;
  const actions = play && (theme.isTV || row.kind === 'continue') ? {primaryAction: 'play' as const, onPlay: play, onNavigate: navigate}
    : {primaryAction: 'navigate' as const, onNavigate: navigate, ...(play ? {onPlay: play} : {})};
  const props: CardProps = {...text, ...actions, width, visible, onFocus: context.onFocus, onBlur: context.onBlur, selection: context.selection, hasTVPreferredFocus: preferred,
    onMore: () => {if (current()) runtime.actions.more(entry, row.id);}};
  const art = runtime.artwork(row.artworkShape === 'landscape' ? entry.backdropUrl ?? entry.posterUrl : entry.posterUrl);
  return <ArtworkPlacementContext.Provider value={{row: rowIndex + 1, column: context.index, group: row.id}}>
    {rank ? <RankedCard {...props} rank={rank} artwork={art} isNew={entry.new} watched={entry.watched}/>
      : row.artworkShape === 'landscape' ? <WideCard {...props} artwork={art} progress={text.progress} watched={entry.watched}/>
      : row.artworkShape === 'square' ? <SquareCard {...props} artwork={art} progress={text.progress} watched={entry.watched} isNew={entry.new}/>
      : <PosterCard {...props} artwork={art} watched={entry.watched} isNew={entry.new}/>}
  </ArtworkPlacementContext.Provider>;
}

function HomeLiveRow({row, runtime, visible, itemWidth, onRange, current}: {row: HomeRow; runtime: NativeShellRuntime; visible: boolean; itemWidth: number; onRange: (first: number, last: number) => void; current: () => boolean}) {
  const theme = useTheme(), live = row.live!;
  // Projection time, expiry and server-issued marks define the bounded row. No lineup scan.
  const observed = Date.parse(live.observedAt);
  if (Date.now() >= Date.parse(live.expiresAt)) return null;
  return <Row title={serverTextLabel(defaultI18n, row.titleText, row.title)} items={live.channels} getKey={item => JSON.stringify([item.channel.sourceId, item.channel.id])}
    itemWidth={itemWidth} itemHeight={theme.isTV ? 225 : theme.layoutMode === 'desktop' ? theme.spec.card.live.height.web : theme.spec.card.live.height.phone} selection={runtime.selection(row.id)} onVisibleRange={onRange}
    onSeeAll={row.seeAll ? () => {if (current()) runtime.actions.seeAll(row.seeAll!);} : undefined}
    renderItem={(item: HomeChannel, context) => {
      const channel = item.channel, programme = channel.programmes.find(value => Date.parse(value.start) <= observed && Date.parse(value.end) > observed);
      const parts: readonly FactPart[] = programme ? programmeFactParts({startMs: Date.parse(programme.start), endMs: Date.parse(programme.end), subtitle: programme.subtitle, flags: programme.flags, recording: !!programme.recordingId}, runtime.text, observed) : [];
      const range = programme && programmeTimeRange(Date.parse(programme.start), Date.parse(programme.end), runtime.text);
      return <LiveCard title={programme?.title ?? channel.name} channel={channel.name} number={channel.number} sourceName={item.source.name}
        mark={{id: channel.id, sourceId: channel.sourceId, ...channel.mark}} logo={runtime.artwork(channel.logoPath)} width={itemWidth} visible={visible}
        flags={parts.filter(part => part.role === 'status')} caption={parts.filter(part => part.id === 'remaining')} range={range?.text}
        progress={programme ? (observed - Date.parse(programme.start)) / (Date.parse(programme.end) - Date.parse(programme.start)) : undefined}
        primaryAction="navigate" onNavigate={() => {if (current()) runtime.actions.channel(item);}} onMore={() => {if (current()) runtime.actions.channelMore(item);}}
        onFocus={context.onFocus} onBlur={context.onBlur} selection={context.selection}/>;
    }}/>;
}
