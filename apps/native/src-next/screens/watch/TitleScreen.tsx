import React, {useEffect, useLayoutEffect, useRef, useState, useSyncExternalStore, type ReactNode} from 'react';
import {ScrollView, Text, View, useWindowDimensions, type LayoutChangeEvent} from 'react-native';
import type {ContentEntry} from '../../../../../packages/client-core/src/library-content';
import {cardText, episodeLabel, playbackIdentity, titleFactParts, type TextEnvironment} from '../../../../../packages/client-core/src/presentation/kit-model';
import {defaultI18n} from '../../../../../packages/i18n/src';
import {AmbientArt, Artwork, type AmbientArtSource, type ArtworkSource} from '../../kit/artwork';
import {EpisodeTile, PosterCard, type EpisodeTileProps, type PosterCardProps} from '../../kit/cards';
import {Button, Chip, Focusable, ResumeButton, Tabs} from '../../kit/controls';
import {Icon} from '../../kit/Icon';
import {HeroMetadata} from '../../kit/layout/Hero';
import {StateLayout, TitleSkeleton} from '../../kit/states';
import {presentError} from '../../../../../packages/client-core/src/presentation/errors';
import {nativeType, useTheme} from '../../kit/theme';
import type {NativeTitleController} from './title-controller';
import type {NativeTitleTab} from './title-memory';
import {TitlePeople} from './TitlePeople';
import {NativeTitleEpisodePlate} from './TitleEpisodePlate';
import {NativeSeasonsSheet} from './SeasonsSheet';
import {TVEpisodeBrowser} from './TVEpisodeBrowser';
import {NativeShowSettingsSheet} from './ShowSettingsSheet';
import type {NativePlaybackAdapter, NativePlaybackRuntimeSnapshot} from '../../platform/playback/types';
import {sameFence} from '../../../../../packages/player-core/src';
import {durationText} from '../../../../../packages/client-core/src/presentation/kit-model/text';
import {usePlatformPosture} from '../../platform/platformPosture';
import {mediumRailMetrics} from '../../shell/model';

export type NativeTitleScreenProps = Readonly<{
  controller: NativeTitleController;
  text: TextEnvironment;
  artwork: (path: string | undefined) => ArtworkSource | undefined;
  ambient: (path: string | undefined) => AmbientArtSource | undefined;
  back: () => void;
  navigate: (entry: ContentEntry) => void;
  more: (entry: ContentEntry, anchorRef?: React.RefObject<View | null>) => void;
  reportError: (error: unknown) => void;
  renderError: (error: unknown, retry: () => void) => ReactNode;
  /** Exact approved About label from the canonical catalogue owner. */
  aboutLabel: string;
  /** The saved server display for a named gone-title state; never a synthesized name. */
  serverName?: string;
  /** A real native download action, absent on a server/device where it is not offered. */
  download?: (entry: ContentEntry) => void;
  /** A registered person route, where the shell has one. */
  person?: (personId: string) => void;
  /** The signed-in viewer owns this server; Show settings is drawn for owners. */
  owner?: boolean;
  /** A real catalogue collection named by the title's detail projection. */
  openCollection?: (collection: Readonly<{id: string; name: string; libraryId: string; memberCount: number; posterUrls: readonly string[]}>) => void;
  /** Current producer state and command, never a fabricated default grant. */
  myList?: Readonly<{selected: boolean; change: (selected: boolean) => Promise<void>}>;
  /** Live captured entry from the actual menu owner, not local open state. */
  menu?: Readonly<{subscribe: (listener: () => void) => () => void; getSnapshot: () => ContentEntry | undefined}>;
  /** Keep the actual selection port even while inactive for accessibility. */
  selection?: (entry: ContentEntry) => EpisodeTileProps['selection'];
  /** The upright Watch page reuses the retained real title body. Its Play/Pause
   * controls the exact existing session; it never starts another queue. */
  watch?: Readonly<{source: NativePlaybackRuntimeSnapshot; width: number; playback: Pick<NativePlaybackAdapter, 'getSnapshot' | 'toggle'>}>;
}>;
const noMenuSubscribe = () => () => {};
const noMenuSnapshot = () => undefined;

/** The retained title route. Technical facts exist only in its separate File info surface. */
export function NativeTitleScreen(props: NativeTitleScreenProps) {
  const {controller, text} = props, snapshot = useSyncExternalStore(controller.subscribe, controller.getSnapshot);
  const menuEntry = useSyncExternalStore(props.menu?.subscribe ?? noMenuSubscribe, props.menu?.getSnapshot ?? noMenuSnapshot);
  const openEpisode = useSyncExternalStore(controller.episode.subscribe, controller.episode.getSnapshot);
  const menuIsOpen = (entry: ContentEntry) => !!menuEntry && menuEntry.id === entry.id && menuEntry.kind === entry.kind && menuEntry.libraryId === entry.libraryId;
  const theme = useTheme(), viewport = useWindowDimensions(), t = defaultI18n.t;
  const posture = usePlatformPosture();
  const fold = posture.status === 'available' && posture.window?.width === viewport.width && posture.window.height === viewport.height
    ? posture.folds.find(value => value.orientation === 'vertical' && value.bounds.left > 0 && value.bounds.left < viewport.width) : undefined;
  const rail = mediumRailMetrics.width;
  const divider = fold ? Math.min(viewport.width - 280, Math.max(rail + 280, fold.bounds.left)) : viewport.width;
  const twoPane = !props.watch && theme.platform === 'tablet' && viewport.width > viewport.height && !!fold;
  // tablet-play3: an upright tablet draws the phone's watch page with larger
  // targets, the title block and its buttons on one row, and 224 pt episode stills.
  const tabletWatch = !!props.watch && props.watch.width >= 600;
  const leftWidth = twoPane ? divider - rail : viewport.width, rightWidth = twoPane ? viewport.width - divider : viewport.width;
  const bodyWidth = props.watch?.width ?? (twoPane ? rightWidth : viewport.width);
  const scroll = useRef<ScrollView>(null), titleMore = useRef<View>(null), titlePlay = useRef<View>(null), bodyTop = useRef(0), cells = useRef(new Map<string, {y: number; height: number}>());
  const [collapsed, setCollapsed] = useState(false), [elapsed, setElapsed] = useState(0);
  const [seasonsOpen, setSeasonsOpen] = useState(false), [settingsOpen, setSettingsOpen] = useState(false), [settingsBusy, setSettingsBusy] = useState(false);
  const [tvFocus, setTvFocus] = useState<{play?: number; episodes?: number; related?: number}>({});
  const captureTag = (key: keyof typeof tvFocus) => theme.isTV ? (event: LayoutChangeEvent) => {
    const tag = event.target;
    if (typeof tag === 'number' && tag > 0 && tag !== tvFocus[key]) setTvFocus(value => ({...value, [key]: tag}));
  } : undefined;
  const tab = snapshot.place.tab, focusDown = theme.isTV ? (tab === 'episodes' ? tvFocus.episodes : tab === 'related' ? tvFocus.related : undefined) : undefined;
  const pendingAnchor = useRef<ReturnType<NativeTitleController['memory']['getSnapshot']>['anchor'] | undefined>(controller.memory.getSnapshot().anchor);
  const detail = snapshot.detail?.data, workspace = snapshot.workspace?.data;
  const myList = props.myList ?? (detail?.actions.some(action => action.id === 'watchlist' && action.enabled)
    ? {selected: detail.personal.watchlisted, change: (value: boolean) => controller.personal({action: 'watchlist', value})} : undefined);
  const show = ['show', 'season', 'episode'].includes(snapshot.entry.kind);
  const loading = show ? snapshot.workspace?.phase === 'loading' : snapshot.detail?.phase === 'loading';
  useEffect(() => {void controller.open().catch(props.reportError);}, [controller, props.reportError]);
  useEffect(() => {
    if (!loading) {setElapsed(0); return;}
    const begin = Date.now(), timers = [setTimeout(() => setElapsed(Date.now() - begin), 300), setTimeout(() => setElapsed(Date.now() - begin), 8000)];
    return () => {for (const timer of timers) clearTimeout(timer);};
  }, [loading]);
  useEffect(() => {
    if (openEpisode.phase !== 'idle') controller.episode.close();
    // An open episode belongs to its own season page; leaving it closes the plate.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [controller, snapshot.place.tab, snapshot.place.seasonId, snapshot.place.group]);
  const restore = () => {
    const anchor = pendingAnchor.current;
    if (!anchor) return;
    const cell = anchor.itemId ? cells.current.get(anchor.itemId) : undefined;
    if (cell || !anchor.itemId) {
      scroll.current?.scrollTo({y: cell ? Math.max(0, bodyTop.current + cell.y + anchor.offset) : anchor.offset, animated: false});
      pendingAnchor.current = undefined;
    }
  };
  useLayoutEffect(() => {pendingAnchor.current = controller.memory.getSnapshot().anchor; cells.current.clear();}, [controller, snapshot.place.tab, snapshot.place.seasonId, snapshot.place.group, viewport.width, viewport.height, bodyWidth]);
  if (snapshot.retired) return null;
  const title = workspace?.show.title ?? snapshot.entry.displayTitle ?? detail?.item.title ?? snapshot.entry.title;
  const backdrop = workspace?.show.backdropUrl ?? detail?.item.backdropUrl ?? snapshot.entry.backdropUrl;
  const source = props.ambient(backdrop), foreground = props.artwork(backdrop);
  const selectedTab = snapshot.place.tab;
  const tabs = <Tabs testID="watch-title-tabs" value={selectedTab} onValueChange={value => controller.tab(value as NativeTitleTab)} items={[
    ...(show ? [{value: 'episodes', label: t('title.episodes')}] : []), {value: 'related', label: t('next.controls.moreLikeThis')}, {value: 'details', label: t('title.details')},
  ]} contentContainerStyle={{paddingHorizontal: theme.isTV ? 0 : 20}}/>;
  const play = () => {void controller.play().catch(props.reportError);};
  const toggle = () => {const watch = props.watch, fence = watch?.source.fence;
    if (watch && fence && !watch.source.retired && sameFence(watch.playback.getSnapshot().fence, fence)) void watch.playback.toggle(fence).catch(props.reportError);
  };
  const headerFor = (showTitle: boolean) => !theme.isTV && !props.watch && <View style={{position: 'absolute', top: 0, left: 0, right: 0, height: 50, flexDirection: 'row', alignItems: 'center', paddingHorizontal: 10, zIndex: 10, backgroundColor: collapsed ? theme.colors.ink : 'transparent'}}>
    <Button testID="watch-title-back" variant="icon" icon="i-left" iconOnly accessibilityLabel={t('action.back')} onPress={props.back}/>
    {collapsed && showTitle && <Text numberOfLines={1} style={[theme.type.bodyStrong, {flex: 1, textAlign: 'center', color: theme.colors.text}]}>{title}</Text>}
  </View>;
  const header = headerFor(true);
  if (loading && !detail && !workspace) return <TitleSkeleton elapsedMs={elapsed} pressed={{title, ...(source ? {art: {source, foreground}} : {})}}
    shell={header} tabs={tabs} playAction={props.watch ? {id: 'toggle', label: t(props.watch.source.playback.intent === 'playing' ? 'action.pause' : 'action.play'), onPress: toggle}
      : snapshot.entry.playback ? {id: 'play', label: t('action.play'), onPress: play} : undefined}/>;
  const error = show ? snapshot.workspace?.error : snapshot.detail?.error;
  if (error && !detail && !workspace) {
    const presented = presentError(error, 'detail');
    // states13: a gone title is named from the captured route entry and the saved server display,
    // never from a fresh read; a permission refusal reveals neither that name nor its art. Search
    // for title and Remove Continue are not drawn: the shell has no search-query route and the
    // title route carries no such offered command.
    const captured = (snapshot.entry.displayTitle || snapshot.entry.title).trim();
    if (!theme.isTV && presented.category === 'permission') {
      return <View style={{flex: 1}}>
        <StateLayout testID="watch-title-restricted" icon="i-lock" contentTop={250} backdropHeight={420}
          title={presented.title} body={presented.body}/>
        {headerFor(false)}
      </View>;
    }
    if (!theme.isTV && presented.category === 'not-found' && captured && props.serverName) {
      return <View style={{flex: 1}}>
        <StateLayout testID="watch-title-removed" icon="i-not" contentTop={250} backdropHeight={420}
          title={t('next.states.removed', {title: captured, server: props.serverName})}
          body={t('next.states.removedBody')}/>
        {header}
      </View>;
    }
    return <View style={{flex: 1}}>{props.renderError(error, () => {void (show ? controller.workspace.retry() : controller.detail.refresh()).catch(props.reportError);})}{header}</View>;
  }
  const primary = detail?.actions.find(action => action.enabled && action.playback && action.id !== 'start_over');
  const playback = primary?.playback ?? workspace?.nextUp?.playback ?? snapshot.entry.playback;
  const progress = detail?.personal.progressSeconds ?? snapshot.entry.progressSeconds;
  const resuming = !!playback?.startSeconds && (progress ?? 0) > 0;
  const duration = detail?.item.duration ?? snapshot.entry.duration;
  const startOver = detail?.actions.some(action => action.id === 'start_over' && action.enabled && action.playback);
  const remainingTitle = duration !== undefined && progress !== undefined ? durationText(Math.max(0, duration - progress), text.t) : undefined;
  const playMenu = theme.isTV ? () => props.more(snapshot.entry, titlePlay) : undefined;
  const contentRating = workspace?.show.contentRating ?? detail?.facts?.contentRating ?? snapshot.entry.contentRating;
  const factSource = titleFactParts({year: workspace?.show.year ?? detail?.item.year ?? snapshot.entry.year, durationSeconds: show ? undefined : duration,
    genres: workspace?.show.genres ?? detail?.metadata.genres.map(genre => genre.name) ?? snapshot.entry.genres, contentRating}, text, theme.isTV ? 'video' : 'home-movie');
  // The phone frame draws the rating as its own tag after genre and length; keep it out of the plain facts row.
  const ratingFact = theme.isTV ? undefined : contentRating ? {id: 'content-rating' as const, text: contentRating, role: 'supplement' as const} : undefined;
  const facts = theme.isTV ? factSource : [...factSource.filter(fact => fact.id !== 'content-rating'), ...(ratingFact ? [ratingFact] : [])];
  const heroHeight = props.watch ? 0 : theme.isTV ? 660 : Math.min(660, viewport.height * .69), overview = workspace?.show.overview ?? detail?.item.overview ?? snapshot.entry.overview;
  const watching = props.watch?.source, watchIdentity = watching?.subject ? playbackIdentity(watching.subject, 'full', text) : undefined;
  const remaining = watching && Number.isFinite(watching.playback.positionSeconds) && watching.playback.positionSeconds >= 0
    ? durationText(Math.max(0, watching.playback.duration - watching.playback.positionSeconds), text.t) : undefined;
  const shownFacts = props.watch ? [...facts.filter(fact => fact.id !== 'duration'), ...(remaining ? [{id: 'remaining', text: text.t('next.kit.remaining', {time: remaining}), role: 'supplement' as const}] : [])] : facts;
  const shownRating = props.watch ? undefined : shownFacts.find(fact => fact.id === 'content-rating'), metadataFacts = shownFacts.filter(fact => fact.id !== 'content-rating');
  const episodes = snapshot.episodes;
  const selectedSeason = (snapshot.seasons ?? []).find(season => season.id === workspace?.selected.seasonId);
  const currentSeasonLabel = workspace?.selected.group ? workspace.groups.find(group => group.id === workspace.selected.group)?.title ?? t('title.seasons')
    : selectedSeason ? selectedSeason.title || t('title.season', {number: selectedSeason.number}) : t('title.seasons');
  const seasonProgress = selectedSeason?.episodeCount !== undefined ? t('title.seasonProgress', {watched: selectedSeason.watchedCount ?? 0, total: selectedSeason.episodeCount}) : undefined;
  const remember = (y: number) => {
    setCollapsed(old => (y > heroHeight - 50) === old ? old : y > heroHeight - 50);
    if (y < bodyTop.current) {controller.remember({itemId: null, offset: y}); return;}
    const local = Math.max(0, y - bodyTop.current);
    const first = [...cells.current].filter(([, cell]) => cell.y + cell.height > local).sort((a, b) => a[1].y - b[1].y)[0];
    if (first) controller.remember({itemId: first[0], offset: Math.max(0, local - first[1].y)});
  };
  const cell = (id: string, children: ReactNode) => <View key={id} onLayout={event => {cells.current.set(id, event.nativeEvent.layout); restore();}}>{children}</View>;
  const detailRows = [
    {label: t('title.releaseDate'), value: detail?.facts?.releaseDate ? new Intl.DateTimeFormat(text.locale ?? 'en-US', {month: 'long', day: 'numeric', year: 'numeric', timeZone: 'UTC'}).format(new Date(detail.facts.releaseDate)) : undefined},
    {label: t('title.genres'), value: detail?.metadata.genres.map(genre => genre.name).join(', ')},
    {label: t('title.ratings'), value: detail?.metadata.ratings.map(rating => `${rating.provider} ${rating.value}`).join(', ')},
    {label: t('title.studio'), value: workspace?.show.studio ?? detail?.facts?.studio},
    {label: t('title.added'), value: detail?.item.addedAt ? new Intl.DateTimeFormat(text.locale ?? 'en-US', {month: 'long', day: 'numeric', year: 'numeric'}).format(new Date(detail.item.addedAt)) : undefined},
  ].filter(row => row.value);
  // A show's own workspace carries its credits; a movie's detail read carries them.
  const credits = detail?.metadata.credits ?? (workspace?.show.credits ?? []).map(credit => ({
    id: credit.id ?? `show-credit-${credit.ordinal}`, name: credit.name, role: credit.role ?? '', department: credit.department ?? '',
    provider: '', ...(credit.portraitUrl ? {portraitUrl: credit.portraitUrl} : {})})), creditNames = (departments: readonly string[]) =>
    [...new Set(credits.filter(credit => departments.includes(credit.department.toLowerCase())).map(credit => credit.name))];
  const directors = creditNames(['directing', 'director', 'direction']), writers = creditNames(['writing', 'writer', 'writers']);
  const castNames = [...new Set(credits.filter(credit => ['acting', 'cast'].includes(credit.department.toLowerCase())).map(credit => credit.name))];
  const heroNode = (
      <View style={props.watch ? {paddingTop: 18, paddingBottom: 18} : {height: heroHeight}}>
        <AmbientArt source={source} foreground={foreground} treatment="title" height={props.watch ? 520 : heroHeight + 120}/>
        <View style={props.watch ? {paddingHorizontal: 20} : {position: 'absolute', left: theme.isTV ? 200 : 20, right: theme.isTV ? 200 : 20, bottom: theme.isTV ? 60 : 24}}>
          {theme.isTV && !props.watch && detail?.collections?.[0] ? <Focusable testID="watch-title-collection" focusKind="row" focusRadius={8}
            onPress={() => props.openCollection?.({...detail.collections![0]!, libraryId: detail.scope.libraryId})}
            style={{alignSelf: 'flex-start', flexDirection: 'row', alignItems: 'center', gap: 10, marginBottom: 12}}>
            <Icon name="i-layers" size={24} color={theme.colors.accentStrong}/>
            <Text style={[nativeType({size: 24, weight: 700, tracking: 0, lineHeight: 'normal'}, theme.textScale), {color: theme.colors.accentStrong}]}>{detail.collections[0].name}</Text>
            <Text style={[nativeType({size: 22, weight: 500, tracking: 0, lineHeight: 'normal'}, theme.textScale), {color: theme.colors.textSecondary}]}>{t('next.browse.filmCount', {count: detail.collections[0].memberCount})}</Text>
          </Focusable> : null}
          <View style={tabletWatch ? {flexDirection: 'row', alignItems: 'flex-end', gap: 24} : undefined}>
          <View style={tabletWatch ? {flex: 1, minWidth: 0} : undefined}>
          <Text accessibilityRole="header" numberOfLines={2} style={[nativeType({size: props.watch ? 28 : theme.isTV ? 76 : 40, weight: 800, tracking: props.watch ? -.035 : -.04, lineHeight: props.watch ? 30.8 : theme.isTV ? 84 : 43}, theme.textScale), {color: theme.colors.text, marginBottom: props.watch ? 5 : 12}]}>{title}</Text>
          {props.watch && watchIdentity?.subtitle.length ? <Text numberOfLines={1} style={[nativeType({size: 15, weight: 700, tracking: 0, lineHeight: 'normal'}, theme.textScale), {color: theme.colors.text, marginBottom: 6}]}>{watchIdentity.subtitle.map(part => part.text).join(' ')}</Text> : null}
          <View style={{flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', gap: 10}}>
            <HeroMetadata facts={metadataFacts}/>
            {shownRating ? <View style={{borderWidth: 1, borderColor: theme.colors.lineStrong, borderRadius: 4, paddingHorizontal: 7, paddingVertical: 1}}>
              <Text style={[theme.type.meta, {color: theme.colors.textSecondary}]}>{shownRating.text}</Text></View> : null}
          </View>
          </View>
          <View style={{flexDirection: 'row', gap: 10, marginTop: props.watch ? (tabletWatch ? 0 : 16) : 22, flexShrink: tabletWatch ? 0 : undefined}}>
            {props.watch ? <Button testID="watch-body-toggle" focusId="watch-body-toggle" style={tabletWatch ? undefined : {flex: 1}} disabled={!watching?.fence || watching.retired || !watching.capabilities.play && !watching.capabilities.pause}
              icon={watching?.playback.intent === 'playing' ? 'i-pause' : 'i-play'} onPress={toggle}>{t(watching?.playback.intent === 'playing' ? 'action.pause' : 'action.play')}</Button>
              : playback && (theme.isTV && resuming && duration && progress !== undefined
                ? <ResumeButton ref={titlePlay} testID="watch-title-play" focusId="watch-title-play" hasTVPreferredFocus icon="i-play" onPress={play} onLongPressAction={playMenu} onLayout={captureTag('play')} nextFocusDown={focusDown}
                    progress={progress / duration} remaining={remainingTitle ? text.t('next.kit.remaining', {time: remainingTitle}) : undefined}>{t('entry.resume')}</ResumeButton>
                : <Button ref={titlePlay} testID="watch-title-play" focusId="watch-title-play" hasTVPreferredFocus={theme.isTV} icon="i-play" onPress={play} onLongPressAction={playMenu} onLayout={captureTag('play')} nextFocusDown={focusDown}>{t(resuming ? 'entry.resume' : 'entry.play')}</Button>)}
            {!props.watch && theme.isTV && resuming && startOver && <Button focusId="watch-title-start-over" variant="glass" icon="i-replay" nextFocusDown={focusDown} onPress={() => {void controller.play(snapshot.entry, true).catch(props.reportError);}}>{t('action.startOver')}</Button>}
            {myList && <Button variant="glass" icon={myList.selected ? 'i-check' : 'i-plus'} iconOnly={!theme.isTV} nextFocusDown={focusDown} accessibilityLabel={t(myList.selected ? 'entry.removeFromWatchlist' : 'entry.addToWatchlist')} onPress={() => {void myList.change(!myList.selected).catch(props.reportError);}}>{t('next.controls.myList')}</Button>}
            {!props.watch && theme.isTV && detail?.actions.some(action => action.id === 'watched' && action.enabled) && <Button focusId="watch-title-watched" variant="glass" icon="i-check" iconOnly nextFocusDown={focusDown}
              accessibilityLabel={t(detail.personal.watched ? 'entry.markUnwatched' : 'entry.markWatched')} accessibilityState={{selected: detail.personal.watched}}
              onPress={() => {void controller.personal({action: 'watched', value: !detail.personal.watched}).catch(props.reportError);}}/>}
            {props.download && !theme.isTV && <Button variant="glass" icon="i-dl" iconOnly accessibilityLabel={t('next.cards.download')} onPress={() => props.download!(snapshot.entry)}/>}
            <Button ref={titleMore} variant="glass" icon="i-more" iconOnly nextFocusDown={focusDown} accessibilityLabel={t('card.more', {title})} accessibilityState={{expanded: menuIsOpen(snapshot.entry)}} onPress={() => props.more(snapshot.entry, titleMore)}/>
          </View>
          </View>
          {!props.watch && !theme.isTV && resuming && duration && progress !== undefined && <View style={{marginTop: 16, gap: 8}}>
            <View style={{height: 4, backgroundColor: '#edf5fa26'}}><View style={{height: 4, width: `${Math.min(1, progress / duration) * 100}%`, backgroundColor: theme.colors.accentStrong}}/></View>
            <View style={{flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 12}}>
              {remainingTitle ? <Text style={[theme.type.caption, {color: theme.colors.textSecondary}]}>{text.t('next.kit.remaining', {time: remainingTitle})}</Text> : <View/>}
              {startOver && <Button variant="text" size="small" icon="i-replay" onPress={() => {void controller.play(snapshot.entry, true).catch(props.reportError);}}>{t('action.startOver')}</Button>}
            </View>
          </View>}
          {!props.watch && overview && <Text numberOfLines={theme.isTV ? 3 : 2} style={[theme.type.body, {color: theme.colors.textSecondary, marginTop: 18}]}>{overview}</Text>}
          {!props.watch && theme.isTV && (directors.length > 0 || castNames.length > 0) && <View style={{flexDirection: 'row', flexWrap: 'wrap', columnGap: 24, rowGap: 6, marginTop: 14}}>
            {directors.length > 0 && <Text style={[theme.type.caption, {color: theme.colors.textTertiary}]}>{t('title.directedBy', {names: defaultI18n.list(directors)})}</Text>}
            {castNames.length > 0 && <Text style={[theme.type.caption, {color: theme.colors.textTertiary}]}>{t('title.starring', {names: defaultI18n.list(castNames.slice(0, 3))})}</Text>}
          </View>}
        </View>
      </View>
  );
  const playingEpisodeId = props.watch?.source.entry?.id, nextEpisodeId = workspace?.nextUp?.id;
  const bodyNode = (
      <View onLayout={event => {bodyTop.current = event.nativeEvent.layout.y; restore();}} style={{paddingHorizontal: theme.isTV ? 200 : 20, paddingTop: 20, paddingBottom: 60, gap: 20}}>
        {selectedTab === 'episodes' && workspace && (theme.isTV ? <TVEpisodeBrowser seasons={snapshot.seasons} selectedSeasonId={workspace.selected.seasonId ?? null}
          episodes={episodes} nextUp={workspace.nextUp} show={{title: workspace.show.title, overview: workspace.show.overview}}
          open={openEpisode} text={text} artwork={props.artwork} more={props.more}
          onSeasonFocus={() => controller.episode.close()} onEpisodeFocus={entry => controller.episode.open(entry)}
          onSelectSeason={id => {void controller.season(id).catch(props.reportError);}}
          onPlayEpisode={entry => {void controller.play(entry).catch(props.reportError);}}
          onPlaySeason={id => {void controller.playSeason(id).catch(props.reportError);}}
          onMarkSeason={(id, watched) => {void controller.markSeason(id, watched).catch(props.reportError);}}
          onMoreSeasons={() => {void controller.moreSeasons().catch(props.reportError);}}
          onMoreEpisodes={() => {void controller.moreEpisodes().catch(props.reportError);}}
          onRetryEpisode={() => controller.episode.retry()} renderError={props.renderError}/>
          : <>
          <View style={{flexDirection: 'row', alignItems: 'center', gap: 10}}>
            <Button testID="watch-seasons-open" variant="glass" size="small" trailingIcon="i-chdown" style={{flexShrink: 0}} onPress={() => setSeasonsOpen(true)}>{currentSeasonLabel}</Button>
            {seasonProgress ? <Text numberOfLines={1} style={[theme.type.caption, {color: theme.colors.textTertiary, flexShrink: 1}]}>{seasonProgress}</Text> : null}
            <View style={{flex: 1}}/>
            {props.owner && <Button testID="watch-show-settings-open" variant="icon" icon="i-more" iconOnly accessibilityLabel={t('card.more', {title})} onPress={() => setSettingsOpen(true)}/>}
          </View>
          {episodes.map(entry => {
            const numbering = entry.absoluteNumber !== undefined ? {mode: 'absolute' as const, number: entry.absoluteNumber} : entry.dateBased && entry.airDate ? {mode: 'date' as const, day: entry.airDate} : entry.seasonNumber === 0 ? {mode: 'special' as const} : {mode: 'seasonal' as const, season: entry.seasonNumber, episode: entry.episodeNumber};
            const model = cardText({id: entry.id, kind: entry.kind, title: entry.displayTitle ?? entry.title, episode: numbering, durationSeconds: entry.duration, positionSeconds: entry.progressSeconds}, 'in-show', text);
            const plate = !theme.isTV && openEpisode.entry?.id === entry.id && openEpisode.entry.kind === 'episode';
            return cell(entry.id, plate ? <NativeTitleEpisodePlate entry={entry} code={episodeLabel(numbering, 'player', text)} width={bodyWidth - 40}
              still={props.artwork(entry.stillUrl)} backdrop={props.artwork(entry.stillUrl ?? workspace.show.backdropUrl)} snapshot={openEpisode}
              more={props.more} download={props.download} onClose={() => controller.episode.close()} onPlay={() => {void controller.episode.play().catch(props.reportError);}}
              onStartOver={() => {void controller.episode.play(true).catch(props.reportError);}}
              onPersonal={intent => {void controller.episode.personal(intent).catch(props.reportError);}}
              onNeighbour={neighbour => props.navigate({id: neighbour.id, kind: 'episode', title: neighbour.title, libraryId: workspace.show.libraryId, show: {id: workspace.show.id, name: workspace.show.title}})}
              onRetry={() => controller.episode.retry()} renderError={props.renderError} locale={text.locale ?? 'en-US'}/>
              : <TitleEpisode entry={entry} more={props.more} moreExpanded={menuIsOpen(entry)} selection={props.selection?.(entry)} title={entry.displayTitle ?? entry.title} label={model.caption} caption={model.detail} width={theme.isTV ? 356 : bodyWidth - 40} layout={theme.isTV ? 'tile' : 'row'} artWidth={tabletWatch ? 224 : undefined} watched={entry.watched} progress={model.progress}
                status={entry.id === playingEpisodeId ? t('player.miniPlaying') : entry.id === nextEpisodeId ? t('player.queue') : undefined}
                artwork={props.artwork(entry.stillUrl ?? workspace.show.backdropUrl)} backdropFallback={!entry.stillUrl} synopsis={entry.overview}
                {...(theme.isTV && entry.playback ? {primaryAction: 'play' as const, onPlay: () => {void controller.play(entry).catch(props.reportError);}} : {primaryAction: 'navigate' as const})}
                onNavigate={() => theme.isTV ? props.navigate(entry) : controller.episode.open(entry)} onDownload={props.download ? () => props.download!(entry) : undefined}/>);
          })}
        </>)}
        {selectedTab === 'related' && detail?.related?.rows.map((row, rowIndex) => cell(row.id, <View><Text style={[theme.isTV ? theme.type.rowHeading : theme.type.heading, {color: theme.colors.text, marginBottom: 14}]}>{row.heading}</Text>
          <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{gap: 10}}>{row.entries.map((entry, entryIndex) => <TitleRelated key={entry.id} entry={entry} more={props.more} moreExpanded={menuIsOpen(entry)} selection={props.selection?.(entry)} title={entry.displayTitle ?? entry.title} artwork={props.artwork(entry.posterUrl)} width={theme.isTV ? 214 : (bodyWidth - 60) / 3}
            onLayout={rowIndex === 0 && entryIndex === 0 ? captureTag('related') : undefined} nextFocusUp={rowIndex === 0 && entryIndex === 0 && theme.isTV ? tvFocus.play : undefined} onNavigate={() => props.navigate(entry)}/>)}</ScrollView></View>))}
        {selectedTab === 'details' && cell('details', <View style={{gap: 16}}>
          <Text style={[theme.isTV ? theme.type.rowHeading : theme.type.heading, {color: theme.colors.text}]}>{props.aboutLabel}</Text>
          {theme.isTV && detail?.facts?.tagline ? <Text style={[theme.type.body, {color: theme.colors.textTertiary, fontStyle: 'italic'}]}>{detail.facts.tagline}</Text> : null}
          {overview && <Text style={[theme.type.body, {color: theme.colors.textSecondary}]}>{overview}</Text>}
          <View style={{backgroundColor: theme.colors.raisedHigh, borderRadius: 14, paddingHorizontal: 14}}>{detailRows.map(row => <View key={row.label} style={{flexDirection: 'row', gap: 14, paddingVertical: 12, borderBottomWidth: 1, borderColor: theme.colors.line}}><Text style={[theme.type.caption, {width: 90, color: theme.colors.textTertiary}]}>{row.label}</Text><Text style={[theme.type.body, {flex: 1, color: theme.colors.text}]}>{row.value}</Text></View>)}</View>
          {!theme.isTV && detail?.collections?.[0] ? <Focusable testID="title-collection-card" focusKind="row" focusRadius={14}
            onPress={() => props.openCollection?.({...detail.collections![0]!, libraryId: detail.scope.libraryId})}
            style={{flexDirection: 'row', alignItems: 'center', gap: 14, paddingHorizontal: 12, paddingVertical: 10, borderRadius: 14, backgroundColor: theme.colors.raised}}>
            <View style={{width: 58, height: 54}}>
              {detail.collections[0].posterUrls.slice(0, 2).map((poster, index) => <Artwork key={poster} source={props.artwork(poster)} width={36} height={54}
                style={{position: 'absolute', top: 0, left: index * 22, borderRadius: 5, transform: [{rotate: index ? '6deg' : '-7deg'}]}}/>)}
            </View>
            <View style={{flex: 1, minWidth: 0}}>
              <Text style={[theme.type.captionStrong, {color: theme.colors.accentStrong}]}>{t('next.home.collection')}</Text>
              <Text numberOfLines={1} style={[theme.type.bodyStrong, {color: theme.colors.text}]}>{detail.collections[0].name}</Text>
              <Text style={[theme.type.caption, {color: theme.colors.textSecondary}]}>{t('next.collection.filmsOnServer', {count: detail.collections[0].memberCount})}</Text>
            </View>
            <Icon name="i-right" size={18} color={theme.colors.textTertiary}/>
          </Focusable> : null}
          {credits.length ? <View style={{gap: 10}}>
            <Text style={[theme.isTV ? theme.type.rowHeading : theme.type.heading, {color: theme.colors.text}]}>{t('web.metadata.tabPeople')}</Text>
            <TitlePeople credits={credits} artwork={props.artwork} onPerson={props.person}/>
            {(directors.length > 0 || writers.length > 0) && <View style={{gap: 2}}>
              {directors.length ? <Text style={[theme.type.caption, {color: theme.colors.textTertiary}]}>{t('title.directedBy', {names: defaultI18n.list(directors)})}</Text> : null}
              {writers.length ? <Text style={[theme.type.caption, {color: theme.colors.textTertiary}]}>{t('title.writtenBy', {names: defaultI18n.list(writers)})}</Text> : null}
            </View>}
          </View> : null}
        </View>)}
      </View>
  );
  return <View testID="watch-title-screen" style={{flex: 1, backgroundColor: theme.colors.ink}}>
    {twoPane ? <View style={{flex: 1, flexDirection: 'row'}}>
      <ScrollView style={{width: leftWidth, alignSelf: 'stretch'}} scrollEventThrottle={32} showsVerticalScrollIndicator={false}>
        {heroNode}
        <View style={{paddingHorizontal: 20, paddingTop: 18, paddingBottom: 48, gap: 10}}>
          {credits.length ? <><Text style={[theme.isTV ? theme.type.rowHeading : theme.type.heading, {color: theme.colors.text}]}>{t('web.metadata.tabPeople')}</Text>
            <TitlePeople credits={credits} artwork={props.artwork} onPerson={props.person}/></> : null}
          {directors.length ? <Text style={[theme.type.caption, {color: theme.colors.textTertiary}]}>{t('title.directedBy', {names: defaultI18n.list(directors)})}</Text> : null}
          {writers.length ? <Text style={[theme.type.caption, {color: theme.colors.textTertiary}]}>{t('title.writtenBy', {names: defaultI18n.list(writers)})}</Text> : null}
        </View>
      </ScrollView>
      <View style={{width: rightWidth}}>
        <View style={{backgroundColor: theme.colors.ink}}>{tabs}</View>
        <ScrollView ref={scroll} onScroll={event => {
          const {contentOffset, contentSize, layoutMeasurement} = event.nativeEvent;
          if (selectedTab === 'episodes' && contentSize.height - contentOffset.y - layoutMeasurement.height < layoutMeasurement.height) void controller.moreEpisodes().catch(props.reportError);
        }} scrollEventThrottle={32}>{bodyNode}</ScrollView>
      </View>
    </View> : <ScrollView ref={scroll} stickyHeaderIndices={[1]} onScroll={event => {
      remember(event.nativeEvent.contentOffset.y);
      const {contentOffset, contentSize, layoutMeasurement} = event.nativeEvent;
      if (selectedTab === 'episodes' && contentSize.height - contentOffset.y - layoutMeasurement.height < layoutMeasurement.height) void controller.moreEpisodes().catch(props.reportError);
    }} scrollEventThrottle={32}>
      {heroNode}
      <View style={{backgroundColor: theme.colors.ink}}>{tabs}</View>
      {bodyNode}
    </ScrollView>}{header}
  </View>;
}

/** The actual card owns the measured native ref. Its callback stays argument-free
 * for touch, keyboard and TV; capture authority still comes from the real entry. */
export function TitleEpisode({entry, more, ...props}: EpisodeTileProps & {entry: ContentEntry; more: NativeTitleScreenProps['more']}) {
  const anchor = useRef<View>(null);
  return <EpisodeTile {...props} menuAnchorRef={anchor} onMore={() => more(entry, anchor)}/>;
}
export function TitleRelated({entry, more, ...props}: PosterCardProps & {entry: ContentEntry; more: NativeTitleScreenProps['more']}) {
  const anchor = useRef<View>(null);
  return <PosterCard {...props} menuAnchorRef={anchor} onMore={() => more(entry, anchor)}/>;
}
