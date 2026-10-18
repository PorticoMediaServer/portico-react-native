import React, {useCallback, useEffect, useMemo, useState, useSyncExternalStore} from 'react';
import {useUnreadCount} from '../app/inbox';
import {Image, View, type ImageSourcePropType} from 'react-native';
import Svg, {Defs, LinearGradient, Rect, Stop} from 'react-native-svg';
import type {ContentEntry, ContentSection} from '../../../../packages/client-core/src/library-content';
import {captionFor, cardLinesFor, formatDuration, iconFor, lengthFor, progressFor, shapeFor, useArtwork} from '../app/content';
import {homeHero, isContinueRow as isContinueRowId, type HomeHero} from '../../../../packages/client-core/src/presentation/index';
import {useHome} from '../app/home';
import {present} from '../app/errors';
import {useSavedTitles} from '../app/saved-index';
import {homeRowSequence, type SequenceContainer} from '../app/container-play';
import {useI18n} from '../app/i18n';
import {HomeCustomise} from './HomeCustomise';
import {HomeEmpty} from './HomeEmpty';
import type {HomeRow} from '../../../../packages/client-core/src/home';
import {useOpenEntry} from '../app/open';
import {useSession} from '../app/session';
import {useNavigation} from '@react-navigation/native';
import type {NativeStackNavigationProp} from '@react-navigation/native-stack';
import {useSafeAreaInsets} from 'react-native-safe-area-context';
import type {ContentStackParams} from '../app/routes';
import {Artwork, Backdrop, Button, Card, Grid, ListRow, Notice, PageList, ProgressBar, Shelf, Skeleton, StateView, Text, useEntryFocus, useInitialFocus, useScreenTitle, useTheme, Wordmark} from '../ui';
import {indexTitles} from '../bridge/NativeActivity';
import {ArtworkPlacementContext} from '../ui/ArtworkPipeline';
import {useInvoker} from '../app/playback-events';
import {usePlayerActions, type EntryOrigin} from '../app/player-actions';
import {continueHiddenSnapshot, continueScope, hiddenFor, isContinueRow, onContinueChanged, settleContinueHidden, subscribeContinueHidden, withoutRemoved} from '../app/continue-watching';
import {usePullToRefresh} from '../app/refresh';
import {withoutNotInterested} from '../app/not-interested';
import {useTurnedDown} from '../app/not-interested-hook';
import {isRecommendationRow} from '../../../../packages/client-core/src/recommendation-feedback';
import {homeRowHeading, homeViewResourceId} from '../../../../packages/client-core/src/home';
import {serverTextLabel} from '../../../../packages/client-core/src/presentation/server-text';
import type {I18n} from '../app/i18n';
import {useLibrariesContext} from '../app/libraries-context';
import type {ShapeFamily} from '../../../../packages/client-core/src/presentation/index';

/**
 * Home: what the viewer was last in the middle of as a hero, then the server's authored
 * rows (Continue Watching, Recently Added, Trending…). No client ranking.
 */
export function HomeScreen() {
  const {state, refresh, more, saveLayout, resetLayout, loadLayout} = useHome();
  const i18n = useI18n();
  // Home has no page header of its own to name it for a screen reader.
  useScreenTitle(i18n.t('web.shell.home'));
  const failure = present(state.error, 'home', {retrying: state.retrying, i18n});
  // OS-02: Continue Watching and My List become Spotlight results and titles Siri can play.
  // Continue Watching is a Home row. My List is not on Home, so it is read for this on its own;
  // the index is written once both are known, and each write replaces both.
  const savedTitles = useSavedTitles(state.document);
  useEffect(() => {
    const rows = state.document?.rows;
    if (!rows || !savedTitles) return;
    const titles = (ids: readonly string[]) => rows.filter(r => ids.includes(r.id) || ids.includes(r.kind)).flatMap(r => r.entries).filter(e => e.playback || e.kind === 'movie' || e.kind === 'episode').map(e => ({itemId: e.playback?.itemId ?? e.id, title: e.title, subtitle: captionFor(e)}));
    indexTitles({continueWatching: titles(['continue_watching', 'continue']), saved: savedTitles});
  }, [state.document, savedTitles]);
  const {system, api, session} = useSession();
  const {space, isTV, metrics} = useTheme();
  const artwork = useArtwork();
  const open = useOpenEntry();
  const [customise, setCustomise] = useState(false);
  const [scrolled, setScrolled] = useState(false);
  const document = state.document;
  // X-12: a title removed from Continue Watching leaves the row at once (Undo puts it back); Home
  // reloads when the server's row changed, and the server's own row takes over from there.
  const scope = continueScope(session?.viewer.serverId ?? api.baseUrl, session?.viewer.accountId, session?.viewer.profileId);
  const hidden = useSyncExternalStore(subscribeContinueHidden, continueHiddenSnapshot);
  const removed = useMemo(() => hiddenFor(hidden, scope), [hidden, scope]);
  useEffect(() => { if (document) settleContinueHidden(scope, document.rows); }, [document, scope]);
  useEffect(() => onContinueChanged(changed => { if (changed === scope) void refresh(); }), [scope, refresh]);
  // P5: a recommendation turned down leaves its rows at once (Undo puts it back).
  const turnedDown = useTurnedDown();
  const rows = useMemo(() => withoutRemoved(document?.rows ?? [], removed).map(r => withoutNotInterested(r, turnedDown)).filter(r => r.entries.length), [document, removed, turnedDown]);
  // The hero is the server's choice: the newer of the two Continue rows' first entries. A title
  // just removed from Continue Watching leaves the hero with the row.
  const hero = useMemo(() => homeHero(document, i18n.t, {duration: heroDuration, hidden: removed}), [document, i18n, removed]);
  const heroArt = hero ? artwork(hero.entry.backdropUrl ?? hero.entry.posterUrl) : undefined;
  // The server sends its slower shelves as placeholders, filled in a moment later: until one has,
  // Home is still loading, not empty (it never flashes "Nothing here yet"). At most a few seconds, in
  // case a shelf never arrives.
  const pendingShelves = !rows.length && !hero && !!document?.rows.some(r => r.deferred && !r.entries.length);
  const [gaveUp, setGaveUp] = useState(false);
  useEffect(() => {
    if (!pendingShelves) { setGaveUp(false); return; }
    const timer = setTimeout(() => setGaveUp(true), PENDING_SHELVES_MS);
    return () => clearTimeout(timer);
  }, [pendingShelves]);
  const loadingFirst = (state.phase === 'loading' && !document) || (pendingShelves && !gaveUp);
  // Stable per row so rows sit out unrelated re-renders; paging state is read per row.
  const paging = state.paging;
  // QA (TV): with no hero, the first row's first card takes the opening focus.
  const firstRowFocus = !hero;
  // P7: a recommendation row with no library of its own (Recommended, Trending now, Picks for you)
  // opens as its own paged page; a saved view's row opens the view's page.
  const navigation = useNavigation<NativeStackNavigationProp<ContentStackParams>>();
  const seeAllFor = useCallback((row: HomeRow): (() => void) | undefined => {
    const view = homeViewResourceId(row.id);
    if (view) return () => navigation.push('SavedResource', {resourceId: view, title: row.title});
    if (!row.libraryId && isRecommendationRow(row)) return () => navigation.push('HomeRow', {rowId: row.id, title: serverTextLabel(i18n, row.titleText, row.title)});
    return undefined;
  }, [navigation, i18n]);
  const renderRow = useCallback(({item: row, index}: {item: HomeRow; index: number}) => (
    <SectionView section={sectionOf(row)} row={index + 1} entryFocus={firstRowFocus && index === 0} origin={isContinueRow(row) ? 'continue_watching' : isRecommendationRow(row) ? 'recommendation' : undefined} onMore={row.nextCursor && !paging.has(row.id) ? () => void more(row.id) : undefined} onSeeAll={seeAllFor(row)} alwaysSeeAll={!!homeViewResourceId(row.id)} sequence={rowSequence(row)} />
  ), [paging, more, firstRowFocus, seeAllFor]);
  const heroHeight = metrics.heroHeight;
  const topInset = useSafeAreaInsets().top;
  // Home refreshes whenever the app or this screen comes back (not only after five minutes): it is
  // where Continue Watching and what was just added are expected to be current.
  const pull = usePullToRefresh(refresh);
  return (
    <View style={{flex: 1}}>
      {!isTV ? <HeaderUtilities backed={scrolled} /> : null}
      {/* Television: the backdrop stays behind the rows (the page moves by focus). Touch: it is part of the page and scrolls away with it. */}
      {hero && isTV ? <HeroArt hero={hero} source={heroArt} height={heroHeight + 120} /> : null}
      <PageList
        refreshControl={pull}
        onScroll={e => { const y = e.nativeEvent.contentOffset.y > 8; if (y !== scrolled) setScrolled(y); }}
        scrollEventThrottle={64}
        data={rows}
        keyExtractor={row => row.id}
        renderItem={renderRow}
        ListHeaderComponent={
          <>
            {hero && !isTV ? <View pointerEvents="none" style={{position: 'absolute', top: -topInset, left: 0, right: 0, height: heroHeight + 80 + topInset}}><HeroArt hero={hero} source={heroArt} height={heroHeight + 80 + topInset} /></View> : null}
            {hero ? (
              <Hero hero={hero} eyebrow={serverTextLabel(i18n, hero.row.titleText, hero.row.title)} cover={hero.art === 'cover' ? artwork(hero.entry.posterUrl) : undefined} onPlay={() => open(hero.entry, 'play')} onDetails={() => open(hero.entry)} />
            ) : loadingFirst ? (
              // APL-SHELL-08: the first load reserves the hero's place, so the rows don't jump when it arrives.
              <HeroSkeleton />
            ) : (
              // Touch: below the floating header (wordmark and buttons), never under it.
              <View style={{paddingHorizontal: space.page, paddingTop: isTV ? space.xl : metrics.control + space.lg, paddingBottom: space.lg}}>
                <Text variant="label" tone="tertiary">{system?.name ?? i18n.t('web.home.serverFallback')}</Text>
                <Text variant="title">{i18n.t('web.shell.home')}</Text>
              </View>
            )}
            {loadingFirst ? (
              <LoadingShelves />
            ) : state.phase === 'loading' && state.staleRefresh && document ? (
              <Notice tone="warning" message={i18n.t('error.changed')} action={i18n.t('action.refresh')} onAction={refresh} style={{marginHorizontal: space.page, marginBottom: space.lg}} />
            ) : state.phase === 'error' && !document ? (
              <StateView icon="warning" title={failure.title} message={failure.body} action={failure.actionLabel} onAction={failure.actionLabel ? refresh : undefined} />
            ) : state.phase === 'error' ? (
              <Notice tone="warning" message={failure.body} action={failure.actionLabel} onAction={failure.actionLabel ? refresh : undefined} style={{marginHorizontal: space.page, marginBottom: space.lg}} />
            ) : null}
          </>
        }
        ListFooterComponent={
          <>
            {document && !rows.length && !hero && !loadingFirst ? <HomeEmpty /> : null}
            {document && !loadingFirst ? <View style={{paddingHorizontal: space.page, paddingBottom: space.xl, alignItems: 'flex-end'}}><Button size="sm" variant="ghost" icon="settings" label={i18n.t('home.customize.action')} onPress={() => setCustomise(true)} /></View> : null}
          </>
        }
      />
      {document ? <HomeCustomise open={customise} onClose={() => setCustomise(false)} onSave={saveLayout} onReset={resetLayout} loadLayout={loadLayout} /> : null}
    </View>
  );
}

/** A Home row of songs, episodes or parts plays on from the one pressed: the whole row as Home holds it, from the server. */
function rowSequence(row: HomeRow): SequenceContainer | undefined {
  const kinds = row.entries.map(e => e.kind);
  return kinds.some(kind => kind === 'song' || kind === 'episode' || kind === 'audiobook_file' || kind === 'chapter') ? homeRowSequence(row.id, kinds) : undefined;
}

function sectionOf(row: HomeRow): ContentSection {
  // P7: named by its titleText ("Drama for you", "More with Ada Lovelace"), the server's words otherwise.
  return {id: row.id, type: 'rail', heading: homeRowHeading(row), entries: row.entries, totalCount: row.total, nextCursor: row.nextCursor};
}

function HeroSkeleton() {
  const {space, isTV, metrics} = useTheme();
  return (
    <View style={{minHeight: metrics.heroHeight, justifyContent: 'flex-end', gap: space.sm, paddingHorizontal: space.page, paddingBottom: space.xl}}>
      <Skeleton width={isTV ? 520 : 220} height={isTV ? 56 : 36} />
      <Skeleton width={isTV ? 260 : 140} height={isTV ? 22 : 16} />
      <View style={{flexDirection: 'row', gap: space.sm, marginTop: space.lg}}>
        <Skeleton width={isTV ? 180 : 110} height={metrics.control} radius={metrics.radius.control} />
        <Skeleton width={isTV ? 180 : 110} height={metrics.control} radius={metrics.radius.control} />
      </View>
    </View>
  );
}

/** How long Home waits for its first shelf before it says there is nothing here. */
const PENDING_SHELVES_MS = 10_000;

/** APL-HOME-02: no "1m" for a short clip. */
const heroDuration = (seconds: number) => (seconds >= 120 ? formatDuration(seconds) : '');

/** Behind the hero: wide artwork as it is, or a softened copy of the cover when that is all there is. */
function HeroArt({hero, source, height}: {hero: HomeHero; source?: ImageSourcePropType; height: number}) {
  const {colors, backdrops, isTV, window} = useTheme();
  // "Show backdrops" off: Home keeps its plain lit canvas behind the hero.
  if (!backdrops) return null;
  // Phones: the identity sits over the art, so one top-to-bottom shade and no side shade (heroSpec.scrim.phoneOverlay).
  if (hero.art === 'backdrop') return <Backdrop source={source} height={height} align={!isTV && window.width < 700 ? 'overlay' : 'right'} opacity={0.85} />;
  return (
    <View pointerEvents="none" style={{position: 'absolute', left: 0, right: 0, top: 0, height, overflow: 'hidden'}}>
      {source ? <Image source={source} blurRadius={40} resizeMode="cover" style={{position: 'absolute', left: -32, right: -32, top: -32, bottom: -32, opacity: 0.45}} /> : null}
      <Backdrop height={height} />
      <View style={{position: 'absolute', left: 0, right: 0, bottom: 0, height: height * 0.4, backgroundColor: colors.ink, opacity: 0.35}} />
    </View>
  );
}

/** Home's hero. Every word on it comes from `homeHero` (client-core), so each client says the same. */
export function Hero({hero, eyebrow, cover, onPlay, onDetails}: {hero: HomeHero; eyebrow?: string; cover?: ImageSourcePropType; onPlay: () => void; onDetails: () => void}) {
  const i18n = useI18n();
  const {space, isTV, metrics, window} = useTheme();
  const initial = useInitialFocus();
  const invoker = useInvoker();
  const {entry} = hero;
  const coverWidth = isTV ? 260 : 112;
  return (
    <View style={{minHeight: metrics.heroHeight, justifyContent: 'flex-end', paddingHorizontal: space.page, paddingTop: isTV ? space.xxl : space.xl, paddingBottom: space.xl, maxWidth: isTV ? window.width * 0.62 : undefined}}>
      <View style={{flexDirection: 'row', alignItems: 'flex-end', gap: isTV ? space.xl : space.md}}>
        {cover ? <Artwork source={cover} shape={hero.coverShape} width={coverWidth} title={hero.title} /> : null}
        <View style={{flex: 1, minWidth: 0}}>
          {eyebrow ? <Text variant="label" tone="tertiary" lines={1}>{eyebrow}</Text> : null}
          <Text variant="display" lines={2} style={{marginTop: space.xs}}>{hero.title}</Text>
          {hero.line ? <Text variant="heading" lines={1} style={{marginTop: space.xs}}>{hero.line}</Text> : null}
          {hero.meta ? <Text variant="body" tone="secondary" style={{marginTop: space.xs}} lines={1}>{hero.meta}</Text> : null}
        </View>
      </View>
      {entry.overview ? (
        <Text variant={isTV ? 'body' : 'caption'} tone="secondary" lines={isTV ? 3 : 2} style={{marginTop: space.sm, maxWidth: isTV ? 760 : 520}}>
          {entry.overview}
        </Text>
      ) : null}
      {hero.progress > 0 ? <ProgressBar value={hero.progress} style={{marginTop: space.md, maxWidth: isTV ? 420 : 240}} /> : null}
      <View style={{flexDirection: 'row', gap: space.sm, marginTop: space.lg}}>
        <Button ref={invoker.ref} variant="primary" icon="play" label={hero.playLabel} onPress={() => { invoker.remember(); onPlay(); }} hasTVPreferredFocus={initial} size={isTV ? 'lg' : 'md'} />
        <Button variant="secondary" icon="info" label={i18n.t('action.details')} onPress={onDetails} size={isTV ? 'lg' : 'md'} />
      </View>
    </View>
  );
}

/** One title's card. Its handlers are made here, once per entry, so the memoised Card holds. */
const EntryCard = React.memo(function EntryCard({entry, shape, width, preferred, libraryId, origin, open, artwork, resume, detailLine}: {entry: ContentEntry; /** A Continue Watching card: what is left as the caption (an episode reads as everywhere else). */ resume?: boolean; /** The row holds an episode: every card keeps room for its third line. */ detailLine?: boolean; /** X-14: one geometry per row. */ shape: ReturnType<typeof shapeFor>; width?: number; preferred: boolean; libraryId?: string; origin?: EntryOrigin; open: ReturnType<typeof useOpenEntry>; artwork: ReturnType<typeof useArtwork>}) {
  const onPress = useCallback(() => open(entry, 'open', libraryId), [open, entry, libraryId]);
  const onLongPress = useCallback(() => open(entry, 'more', libraryId, origin), [open, entry, libraryId, origin]);
  const lines = cardLinesFor(entry, resume);
  return (
    <Card
      hasTVPreferredFocus={preferred}
      title={lines.title}
      subtitle={lines.caption}
      detail={lines.detail}
      detailLine={detailLine}
      source={artwork(shape === 'landscape' ? entry.backdropUrl ?? entry.posterUrl : entry.posterUrl ?? entry.backdropUrl)}
      shape={shape}
      width={width}
      watched={entry.watched === true && entry.kind !== 'category' && entry.kind !== 'collection'}
      unavailable={entry.available === false}
      titleLines={entry.kind === 'book' ? 2 : 1}
      progress={progressFor(entry)}
      icon={entry.posterUrl || entry.backdropUrl ? undefined : iconFor(entry.kind)}
      onPress={onPress}
      onLongPress={onLongPress}
    />
  );
});

const shapeFamilies = new Set<string>(['movie', 'tv', 'anime', 'audiobook', 'music']);

/** One card geometry per section (X-14) and a stable card renderer for shelves, grids and paged grids. */
export function useSectionCards(entries: readonly ContentEntry[], libraryId?: string, entryFocus = false, placement?: {row: number; group?: string}, origin?: EntryOrigin) {
  const {metrics, isTV} = useTheme();
  const artwork = useArtwork();
  const open = useOpenEntry();
  const claim = useEntryFocus(entryFocus && entries.length > 0);
  const first = entries[0];
  // APL-LIB-01: the library's family decides the shape where the kind alone can't (a music
  // library's collections are square), and before the first entry arrives (the placeholders).
  const libraries = useLibrariesContext();
  const kind = libraryId ? libraries.items.find(l => l.id === libraryId)?.kind : undefined;
  const family = kind && shapeFamilies.has(kind) ? (kind as ShapeFamily) : undefined;
  const shape = first ? shapeFor(first.kind, 'shelf', family) : family === 'music' ? 'square' : 'poster';
  const width = shape === 'landscape' ? metrics.landscapeWidth : shape === 'square' ? metrics.squareWidth : shape === 'circle' ? (isTV ? 150 : 84) : metrics.posterWidth;
  // Stable, so the rows' cells (and the memoised cards inside them) sit out a focus move.
  // PERF-03: each card tells the artwork scheduler where it sits (row, then column).
  const row = placement?.row ?? 0;
  const group = placement?.group;
  const resume = !!group && isContinueRowId(group);
  // An episode's card has three lines (show, episode, "S1 · E3"): its row keeps room for them on every card.
  const detailLine = entries.some(entry => entry.kind === 'episode');
  const renderCard = useCallback((entry: ContentEntry, w?: number, index = -1) => (
    <ArtworkPlacementContext.Provider value={{row, group, column: Math.max(0, index)}}>
      <EntryCard entry={entry} shape={shape} width={w} preferred={isTV && claim && index === 0} libraryId={libraryId} origin={origin} open={open} artwork={artwork} resume={resume} detailLine={detailLine} />
    </ArtworkPlacementContext.Provider>
  ), [shape, isTV, claim, libraryId, origin, open, artwork, row, group, resume, detailLine]);
  return {shape, width, renderCard, open, artwork};
}

/** Renders one authored section as a shelf, grid or list. */
/**
 * A section's title. A heading whose key is a row title code (`home.row.*`: a Home row, a Discover
 * personal row, a title page's More like X) is the catalogue message with its params, else the
 * server's words (P7).
 */
export function sectionTitle(i18n: Pick<I18n, 't' | 'has'>, heading: ContentSection['heading']): string {
  return heading.key.startsWith('home.row.') ? serverTextLabel(i18n, heading, heading.fallback) : heading.fallback;
}

export function SectionView({section, onSeeAll, onMore, hideTitle = false, libraryId, entryFocus = false, loadingMore = false, row, origin, alwaysSeeAll = false, sequence}: {/** The list as the server's query: a pressed row plays it whole on from there, not just what is loaded. */ sequence?: SequenceContainer; /** See all even when the row shows everything it has (a saved view's page holds more). */ alwaysSeeAll?: boolean; /** Position on the screen, for artwork order. */ row?: number; /** X-12: the cards' place, for their long-press menu. */ origin?: EntryOrigin; /** The first card takes focus when the screen opens. */ entryFocus?: boolean; section: ContentSection; onSeeAll?: () => void; onMore?: () => void; hideTitle?: boolean; /** The library this section belongs to, for entries the server did not stamp (engine results). */ libraryId?: string; loadingMore?: boolean}) {
  const {space} = useTheme();
  const i18n = useI18n();
  const {width, renderCard, open, artwork} = useSectionCards(section.entries, libraryId, entryFocus, {row: row ?? 0, group: section.id}, origin);
  const player = usePlayerActions();
  const first = section.entries[0];
  const renderShelfCard = useCallback(({item, index}: {item: ContentEntry; index: number}) => renderCard(item, undefined, index), [renderCard]);
  if (!first) return null;
  const title = sectionTitle(i18n, section.heading);
  if (section.type === 'list') {
    return (
      <View style={{paddingHorizontal: space.page, marginBottom: space.xl}}>
        {!hideTitle ? <Text variant="heading" style={{marginBottom: space.sm}}>{title}</Text> : null}
        {section.entries.map(entry => (
          // APL-AUDIO-03: a track plays (with the rest of the list queued after it); details stay one long-press away.
          <ListRow key={entry.id} title={entry.title} subtitle={captionFor(entry)} meta={lengthFor(entry)} source={artwork(entry.posterUrl ?? entry.backdropUrl)} shape={shapeFor(entry.kind)} progress={progressFor(entry)} watched={entry.watched} unavailable={entry.available === false}
            onPress={() => {
              if (sequence && entry.playback) player.playSequence([entry], 0, 0, sequence);
              else if ((entry.kind === 'song' || entry.kind === 'audiobook_file') && entry.playback) {
                const playable = section.entries.filter(e => e.playback);
                player.playSequence(playable, playable.indexOf(entry), 0);
              } else open(entry, 'open', libraryId);
            }}
            onLongPress={() => open(entry, 'more', libraryId, origin)} />
        ))}
      </View>
    );
  }
  if (section.type === 'grid') {
    return (
      <View style={{marginBottom: space.xl}}>
        {!hideTitle ? <Text variant="heading" style={{marginBottom: space.md, marginHorizontal: space.page}}>{title}</Text> : null}
        <Grid data={section.entries} itemWidth={width} keyExtractor={e => e.id} renderItem={renderCard} scrollEnabled={false} />
        {/* PERF-01: a grid inside a page never pages by itself; the next page is the viewer's choice. */}
        {onMore ? <View style={{alignItems: 'center'}}><Button variant="secondary" label={i18n.t('action.showMore')} loading={loadingMore} onPress={onMore} /></View> : null}
      </View>
    );
  }
  return <Shelf title={title} data={section.entries} itemWidth={width} keyExtractor={e => e.id} renderItem={renderShelfCard} onSeeAll={section.totalCount > section.entries.length || section.seeAll || alwaysSeeAll ? onSeeAll : undefined} seeAllLabel={section.totalCount ? i18n.t('shelf.seeAllCount', {count: i18n.number(section.totalCount)}) : i18n.t('shelf.seeAll')} onEndReached={onMore} />;
}

function LoadingShelves() {
  const {space, metrics} = useTheme();
  return (
    <View style={{paddingHorizontal: space.page, gap: space.xl}}>
      {[0, 1].map(row => (
        <View key={row} style={{gap: space.md}}>
          <Skeleton width={180} height={metrics.icon} radius={6} />
          <View style={{flexDirection: 'row', gap: space.gutter}}>
            {[0, 1, 2, 3, 4, 5, 6].map(i => (
              <Skeleton key={i} width={metrics.posterWidth} height={metrics.posterWidth * 1.5} />
            ))}
          </View>
        </View>
      ))}
    </View>
  );
}

/** The bell: opens Notifications, with a dot while something is unread. */
/** The root header's search, bell and account icons: a heavier line than the default 1.75, so they
 * read over any artwork (Justin, 18 Oct). */
const HEADER_ICON_STROKE = 2.5;

function NotificationsButton() {
  const navigation = useNavigation<NativeStackNavigationProp<ContentStackParams>>();
  const i18n = useI18n();
  const {colors} = useTheme();
  const unread = useUnreadCount();
  return (
    <View>
      <Button variant="ghost" round icon="bell" iconStrokeWidth={HEADER_ICON_STROKE} accessibilityLabel={unread ? i18n.t('notifications.unreadLabel', {count: unread}) : i18n.t('notifications.title')} onPress={() => navigation.push('Notifications')} />
      {unread ? <View pointerEvents="none" style={{position: 'absolute', top: 8, right: 8, width: 8, height: 8, borderRadius: 4, backgroundColor: colors.accent}} /> : null}
    </View>
  );
}

/** IOS-SHELL-01/03: the same search, bell and account buttons on every handheld root's header. */
export function RootHeaderActions({extra}: {extra?: React.ReactNode}) {
  const navigation = useNavigation<NativeStackNavigationProp<ContentStackParams>>();
  const i18n = useI18n();
  const {isTV} = useTheme();
  if (isTV) return extra ? <>{extra}</> : null;
  return (
    <>
      {extra}
      <Button variant="ghost" round icon="search" iconStrokeWidth={HEADER_ICON_STROKE} accessibilityLabel={i18n.t('web.search.title')} onPress={() => navigation.push('Search')} />
      <NotificationsButton />
      <Button variant="ghost" round icon="account" iconStrokeWidth={HEADER_ICON_STROKE} accessibilityLabel={i18n.t('lib.accountAndSettings')} onPress={() => navigation.push('Settings')} />
    </>
  );
}

/** How far the header's scrim fades out below the bar, over the artwork. */
const HEADER_SCRIM_FADE = 48;

/** Handheld Home header: the Portico wordmark where another root shows its title, then search, notifications and account. */
export function HeaderUtilities({backed = false}: {/** IOS-HOME-01: content has scrolled under the bar, so it gets a backing and a hairline. */ backed?: boolean}) {
  const navigation = useNavigation<NativeStackNavigationProp<ContentStackParams>>();
  const insets = useSafeAreaInsets();
  const {space, colors} = useTheme();
  const i18n = useI18n();
  const [bar, setBar] = useState({width: 0, height: 0});
  const barHeight = bar.height;
  return (
    <View pointerEvents="box-none" onLayout={e => setBar({width: e.nativeEvent.layout.width, height: e.nativeEvent.layout.height})} style={{position: 'absolute', top: 0, left: 0, right: 0, zIndex: 5, paddingTop: insets.top + space.xs, paddingBottom: space.xs, paddingLeft: space.page, paddingRight: space.sm, flexDirection: 'row', alignItems: 'center', gap: space.xs, backgroundColor: backed ? colors.ink : 'transparent', borderBottomWidth: backed ? 1 : 0, borderBottomColor: colors.lineSoft}}>
      {/* Over artwork, a soft shade behind the bar keeps the wordmark and icons legible on any backdrop. */}
      {!backed && barHeight ? (
        // The bar's own measured width, padding included ("100%" would stop short by its padding).
        <Svg pointerEvents="none" width={Math.ceil(bar.width)} height={Math.ceil(barHeight + HEADER_SCRIM_FADE)} style={{position: 'absolute', top: 0, left: 0}}>
          <Defs>
            <LinearGradient id="headerScrim" x1="0" y1="0" x2="0" y2="1">
              <Stop offset="0" stopColor={colors.ink} stopOpacity={0.7} />
              <Stop offset={String(barHeight / (barHeight + HEADER_SCRIM_FADE))} stopColor={colors.ink} stopOpacity={0.45} />
              <Stop offset="1" stopColor={colors.ink} stopOpacity={0} />
            </LinearGradient>
          </Defs>
          <Rect x={0} y={0} width="100%" height="100%" fill="url(#headerScrim)" />
        </Svg>
      ) : null}
      <View style={{flex: 1}}><Wordmark height={28} /></View>
      <Button variant="ghost" round icon="search" iconStrokeWidth={HEADER_ICON_STROKE} accessibilityLabel={i18n.t('web.search.title')} onPress={() => navigation.push('Search')} />
      <NotificationsButton />
      <Button variant="ghost" round icon="account" iconStrokeWidth={HEADER_ICON_STROKE} accessibilityLabel={i18n.t('lib.accountAndSettings')} onPress={() => navigation.push('Settings')} />
    </View>
  );
}
