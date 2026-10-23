import React, {useEffect, useLayoutEffect, useRef, useState, useSyncExternalStore, type ReactNode} from 'react';
import {ScrollView, Text, View, useWindowDimensions} from 'react-native';
import type {ContentEntry} from '../../../../../packages/client-core/src/library-content';
import {cardText, titleFactParts, type TextEnvironment} from '../../../../../packages/client-core/src/presentation/kit-model';
import {defaultI18n} from '../../../../../packages/i18n/src';
import {AmbientArt, type AmbientArtSource, type ArtworkSource} from '../../kit/artwork';
import {EpisodeTile, PosterCard} from '../../kit/cards';
import {Button, Tabs} from '../../kit/controls';
import {HeroMetadata} from '../../kit/layout/Hero';
import {TitleSkeleton} from '../../kit/states';
import {nativeType, useTheme} from '../../kit/theme';
import type {NativeTitleController} from './title-controller';
import type {NativeTitleTab} from './title-memory';

export type NativeTitleScreenProps = Readonly<{
  controller: NativeTitleController;
  text: TextEnvironment;
  artwork: (path: string | undefined) => ArtworkSource | undefined;
  ambient: (path: string | undefined) => AmbientArtSource | undefined;
  back: () => void;
  navigate: (entry: ContentEntry) => void;
  more: (entry: ContentEntry) => void;
  reportError: (error: unknown) => void;
  renderError: (error: unknown, retry: () => void) => ReactNode;
  /** Exact approved About label from the canonical catalogue owner. */
  aboutLabel: string;
  /** A real native download action, absent on a server/device where it is not offered. */
  download?: (entry: ContentEntry) => void;
  /** Current producer state and command, never a fabricated default grant. */
  myList?: Readonly<{selected: boolean; change: (selected: boolean) => Promise<void>}>;
}>;

/** The retained title route. Technical facts exist only in its separate File info surface. */
export function NativeTitleScreen(props: NativeTitleScreenProps) {
  const {controller, text} = props, snapshot = useSyncExternalStore(controller.subscribe, controller.getSnapshot);
  const theme = useTheme(), viewport = useWindowDimensions(), t = defaultI18n.t;
  const scroll = useRef<ScrollView>(null), bodyTop = useRef(0), cells = useRef(new Map<string, {y: number; height: number}>());
  const [collapsed, setCollapsed] = useState(false), [elapsed, setElapsed] = useState(0);
  const pendingAnchor = useRef<ReturnType<NativeTitleController['memory']['getSnapshot']>['anchor'] | undefined>(controller.memory.getSnapshot().anchor);
  const detail = snapshot.detail?.data, workspace = snapshot.workspace?.data;
  const show = ['show', 'season', 'episode'].includes(snapshot.entry.kind);
  const loading = show ? snapshot.workspace?.phase === 'loading' : snapshot.detail?.phase === 'loading';
  useEffect(() => {void controller.open().catch(props.reportError);}, [controller, props.reportError]);
  useEffect(() => {
    if (!loading) {setElapsed(0); return;}
    const begin = Date.now(), timers = [setTimeout(() => setElapsed(Date.now() - begin), 300), setTimeout(() => setElapsed(Date.now() - begin), 8000)];
    return () => {for (const timer of timers) clearTimeout(timer);};
  }, [loading]);
  const restore = () => {
    const anchor = pendingAnchor.current;
    if (!anchor) return;
    const cell = anchor.itemId ? cells.current.get(anchor.itemId) : undefined;
    if (cell || !anchor.itemId) {
      scroll.current?.scrollTo({y: cell ? Math.max(0, bodyTop.current + cell.y + anchor.offset) : 0, animated: false});
      pendingAnchor.current = undefined;
    }
  };
  useLayoutEffect(() => {pendingAnchor.current = controller.memory.getSnapshot().anchor; cells.current.clear();}, [controller, snapshot.place.tab, snapshot.place.seasonId, snapshot.place.group, viewport.width, viewport.height]);
  if (snapshot.retired) return null;
  const title = workspace?.show.title ?? detail?.item.title ?? snapshot.entry.title;
  const backdrop = workspace?.show.backdropUrl ?? detail?.item.backdropUrl ?? snapshot.entry.backdropUrl;
  const source = props.ambient(backdrop), foreground = props.artwork(backdrop);
  const selectedTab = snapshot.place.tab;
  const tabs = <Tabs testID="watch-title-tabs" value={selectedTab} onValueChange={value => controller.tab(value as NativeTitleTab)} items={[
    ...(show ? [{value: 'episodes', label: t('title.episodes')}] : []), {value: 'related', label: t('next.controls.moreLikeThis')}, {value: 'details', label: t('title.details')},
  ]} contentContainerStyle={{paddingHorizontal: theme.isTV ? 0 : 20}}/>;
  const play = () => {void controller.play().catch(props.reportError);};
  const header = !theme.isTV && <View style={{position: 'absolute', top: 0, left: 0, right: 0, height: 50, flexDirection: 'row', alignItems: 'center', paddingHorizontal: 10, zIndex: 10, backgroundColor: collapsed ? theme.colors.ink : 'transparent'}}>
    <Button testID="watch-title-back" variant="icon" icon="i-left" iconOnly accessibilityLabel={t('action.back')} onPress={props.back}/>
    {collapsed && <Text numberOfLines={1} style={[theme.type.bodyStrong, {flex: 1, textAlign: 'center', color: theme.colors.text}]}>{title}</Text>}
  </View>;
  if (loading && !detail && !workspace) return <TitleSkeleton elapsedMs={elapsed} pressed={{title, ...(source ? {art: {source, foreground}} : {})}}
    shell={header} tabs={tabs} playAction={snapshot.entry.playback ? {id: 'play', label: t('action.play'), onPress: play} : undefined}/>;
  const error = show ? snapshot.workspace?.error : snapshot.detail?.error;
  if (error && !detail && !workspace) return <View style={{flex: 1}}>{props.renderError(error, () => {void (show ? controller.workspace.retry() : controller.detail.refresh()).catch(props.reportError);})}{header}</View>;
  const primary = detail?.actions.find(action => action.enabled && action.playback && action.id !== 'start_over');
  const playback = primary?.playback ?? workspace?.nextUp?.playback ?? snapshot.entry.playback;
  const progress = detail?.personal.progressSeconds ?? snapshot.entry.progressSeconds;
  const resuming = !!playback?.startSeconds && (progress ?? 0) > 0;
  const duration = detail?.item.duration ?? snapshot.entry.duration;
  const facts = titleFactParts({year: workspace?.show.year ?? detail?.item.year ?? snapshot.entry.year, durationSeconds: show ? undefined : duration,
    genres: workspace?.show.genres ?? detail?.metadata.genres.map(genre => genre.name) ?? snapshot.entry.genres, contentRating: workspace?.show.contentRating ?? detail?.facts?.contentRating ?? snapshot.entry.contentRating}, text, theme.isTV ? 'video' : 'home-movie');
  const heroHeight = theme.isTV ? 660 : Math.min(660, viewport.height * .69), overview = workspace?.show.overview ?? detail?.item.overview ?? snapshot.entry.overview;
  const episodes = workspace?.episodes.sections[0]?.entries ?? [];
  const remember = (y: number) => {
    setCollapsed(old => (y > heroHeight - 50) === old ? old : y > heroHeight - 50);
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
  return <View testID="watch-title-screen" style={{flex: 1, backgroundColor: theme.colors.ink}}>
    <ScrollView ref={scroll} stickyHeaderIndices={[1]} onScroll={event => remember(event.nativeEvent.contentOffset.y)} scrollEventThrottle={32}>
      <View style={{height: heroHeight}}>
        <AmbientArt source={source} foreground={foreground} treatment="title" height={heroHeight + 120}/>
        <View style={{position: 'absolute', left: theme.isTV ? 200 : 20, right: theme.isTV ? 200 : 20, bottom: theme.isTV ? 60 : 24}}>
          <Text accessibilityRole="header" numberOfLines={2} style={[nativeType({size: theme.isTV ? 76 : 40, weight: 800, tracking: -.04, lineHeight: theme.isTV ? 84 : 43}), {color: theme.colors.text, marginBottom: 12}]}>{title}</Text>
          <HeroMetadata facts={facts}/>
          <View style={{flexDirection: 'row', gap: 10, marginTop: 22}}>
            {playback && <Button testID="watch-title-play" focusId="watch-title-play" hasTVPreferredFocus={theme.isTV} icon="i-play" onPress={play}>{t(resuming ? 'entry.resume' : 'entry.play')}</Button>}
            {props.myList && <Button variant="glass" icon={props.myList.selected ? 'i-check' : 'i-plus'} iconOnly={!theme.isTV} accessibilityLabel={t(props.myList.selected ? 'entry.removeFromWatchlist' : 'entry.addToWatchlist')} onPress={() => {void props.myList!.change(!props.myList!.selected).catch(props.reportError);}}>{t('next.controls.myList')}</Button>}
            {props.download && !theme.isTV && <Button variant="glass" icon="i-dl" iconOnly accessibilityLabel={t('next.cards.download')} onPress={() => props.download!(snapshot.entry)}/>}
            <Button variant="glass" icon="i-more" iconOnly accessibilityLabel={t('card.more', {title})} onPress={() => props.more(snapshot.entry)}/>
          </View>
          {resuming && duration && progress !== undefined && <View style={{marginTop: 16, gap: 10}}>
            <View style={{height: 4, backgroundColor: '#edf5fa26'}}><View style={{height: 4, width: `${Math.min(1, progress / duration) * 100}%`, backgroundColor: theme.colors.accentStrong}}/></View>
            {detail?.actions.some(action => action.id === 'start_over' && action.enabled && action.playback) && <Button variant="text" size="small" onPress={() => {void controller.play(snapshot.entry, true).catch(props.reportError);}}>{t('action.startOver')}</Button>}
          </View>}
          {overview && <Text numberOfLines={theme.isTV ? 3 : 2} style={[theme.type.body, {color: theme.colors.textSecondary, marginTop: 18}]}>{overview}</Text>}
        </View>
      </View>
      <View style={{backgroundColor: theme.colors.ink}}>{tabs}</View>
      <View onLayout={event => {bodyTop.current = event.nativeEvent.layout.y; restore();}} style={{paddingHorizontal: theme.isTV ? 200 : 20, paddingTop: 20, paddingBottom: 60, gap: 20}}>
        {selectedTab === 'episodes' && workspace && <>
          <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{gap: 8}}>{workspace.seasons.map(season => <Button key={season.id} size="small" variant="glass" accessibilityState={{selected: workspace.selected.seasonId === season.id}} onPress={() => {void controller.season(season.id).catch(props.reportError);}}>{season.title || t('title.season', {number: season.number})}</Button>)}</ScrollView>
          {episodes.map(entry => {
            const model = cardText({id: entry.id, kind: entry.kind, title: entry.title, episode: entry.absoluteNumber !== undefined ? {mode: 'absolute', number: entry.absoluteNumber} : entry.seasonNumber === 0 ? {mode: 'special'} : {mode: 'seasonal', season: entry.seasonNumber, episode: entry.episodeNumber}, durationSeconds: entry.duration, positionSeconds: entry.progressSeconds}, 'in-show', text);
            return cell(entry.id, <EpisodeTile title={entry.title} label={model.caption} caption={model.detail} width={theme.isTV ? 356 : viewport.width - 40} layout={theme.isTV ? 'tile' : 'row'} watched={entry.watched} progress={model.progress}
              artwork={props.artwork(entry.stillUrl ?? workspace.show.backdropUrl)} backdropFallback={!entry.stillUrl} synopsis={entry.overview}
              primaryAction={theme.isTV ? 'play' : 'navigate'} onNavigate={() => props.navigate(entry)} onMore={() => props.more(entry)} onPlay={entry.playback ? () => {void controller.play(entry).catch(props.reportError);} : undefined} onDownload={props.download ? () => props.download!(entry) : undefined}/>);
          })}
        </>}
        {selectedTab === 'related' && detail?.related?.rows.map(row => cell(row.id, <View><Text style={[theme.type.heading, {color: theme.colors.text, marginBottom: 14}]}>{row.heading}</Text>
          <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{gap: 10}}>{row.entries.map(entry => <PosterCard key={entry.id} title={entry.title} artwork={props.artwork(entry.posterUrl)} width={theme.isTV ? 214 : (viewport.width - 60) / 3} onNavigate={() => props.navigate(entry)} onMore={() => props.more(entry)}/>)}</ScrollView></View>))}
        {selectedTab === 'details' && cell('details', <View style={{gap: 16}}>
          <Text style={[theme.type.heading, {color: theme.colors.text}]}>{props.aboutLabel}</Text>
          {overview && <Text style={[theme.type.body, {color: theme.colors.textSecondary}]}>{overview}</Text>}
          <View style={{backgroundColor: theme.colors.raisedHigh, borderRadius: 14, paddingHorizontal: 14}}>{detailRows.map(row => <View key={row.label} style={{flexDirection: 'row', gap: 14, paddingVertical: 12, borderBottomWidth: 1, borderColor: theme.colors.line}}><Text style={[theme.type.caption, {width: 90, color: theme.colors.textTertiary}]}>{row.label}</Text><Text style={[theme.type.body, {flex: 1, color: theme.colors.text}]}>{row.value}</Text></View>)}</View>
          {detail?.metadata.credits.length ? <View style={{gap: 8}}><Text style={[theme.type.heading, {color: theme.colors.text}]}>{t('web.metadata.tabPeople')}</Text>{detail.metadata.credits.map(credit => <Text key={credit.id} style={[theme.type.body, {color: theme.colors.text}]}>{credit.name}</Text>)}</View> : null}
        </View>)}
      </View>
    </ScrollView>{header}
  </View>;
}
