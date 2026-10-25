import React, {useEffect, useRef, useState} from 'react';
import {ScrollView, Text, View} from 'react-native';
import type {ContentEntry} from '../../../../../packages/client-core/src/library-content';
import type {WorkspaceSeason} from '../../../../../packages/client-core/src/show-workspace';
import {cardText, episodeLabel, type TextEnvironment} from '../../../../../packages/client-core/src/presentation/kit-model';
import {durationText} from '../../../../../packages/client-core/src/presentation/kit-model/text';
import {defaultI18n} from '../../../../../packages/i18n/src';
import {Focusable} from '../../kit/controls';
import {EpisodeTile} from '../../kit/cards';
import type {ArtworkSource} from '../../kit/artwork';
import {Menu, type MenuEntry} from '../../kit/overlays';
import {browseType} from '../../kit/browse/presentation';
import {useTheme} from '../../kit/theme';
import type {NativeTitleEpisodeSnapshot} from './title-episode';

export type TVEpisodeBrowserProps = Readonly<{
  seasons: readonly WorkspaceSeason[];
  selectedSeasonId: string | null;
  episodes: readonly ContentEntry[];
  nextUp?: ContentEntry;
  show: Readonly<{title: string; overview?: string}>;
  open: NativeTitleEpisodeSnapshot;
  text: TextEnvironment;
  artwork: (path: string | undefined) => ArtworkSource | undefined;
  more: (entry: ContentEntry, anchor: React.RefObject<View | null>) => void;
  onSeasonFocus: () => void;
  onEpisodeFocus: (entry: ContentEntry) => void;
  onSelectSeason: (id: string) => void;
  onPlayEpisode: (entry: ContentEntry) => void;
  onPlaySeason: (id: string) => void;
  onMarkSeason: (id: string, watched: boolean) => void;
  onMoreSeasons: () => void;
  onMoreEpisodes: () => void;
  onRetryEpisode: () => void;
  renderError: (error: unknown, retry: () => void) => React.ReactNode;
}>;

type Focus = Readonly<{kind: 'season'; season: WorkspaceSeason}> | Readonly<{kind: 'episode'; entry: ContentEntry}>;

const numbering = (entry: ContentEntry) => entry.absoluteNumber !== undefined ? {mode: 'absolute' as const, number: entry.absoluteNumber}
  : entry.dateBased && entry.airDate ? {mode: 'date' as const, day: entry.airDate}
    : entry.seasonNumber === 0 ? {mode: 'special' as const} : {mode: 'seasonal' as const, season: entry.seasonNumber, episode: entry.episodeNumber};

/** tv-detail frames 5a–5d: the season side list, the horizontal episode row and
 * the focus band that describes whatever holds focus. Only the visible page is
 * drawn; the list pages are the workspace's own. */
export function TVEpisodeBrowser(props: TVEpisodeBrowserProps) {
  const theme = useTheme(), t = defaultI18n.t, {episodes, open, nextUp} = props;
  const fallback = nextUp && episodes.some(entry => entry.id === nextUp.id) ? nextUp : episodes[0];
  const [focus, setFocus] = useState<Focus>(() => fallback ? {kind: 'episode', entry: fallback} : {kind: 'season', season: props.seasons[0]!});
  const [menu, setMenu] = useState<WorkspaceSeason>();
  const [listTag, setListTag] = useState<any>(), [rowTag, setRowTag] = useState<any>();
  const selectTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  useEffect(() => () => {if (selectTimer.current) clearTimeout(selectTimer.current);}, []);
  useEffect(() => {
    const current = focus.kind === 'episode' ? episodes.some(entry => entry.id === focus.entry.id) : props.seasons.some(season => season.id === focus.season.id);
    if (current) return;
    const next = nextUp && episodes.some(entry => entry.id === nextUp.id) ? nextUp : episodes[0];
    if (next) setFocus({kind: 'episode', entry: next}); else if (props.seasons[0]) setFocus({kind: 'season', season: props.seasons[0]});
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [episodes, props.seasons, nextUp]);
  const selectedSeason = focus.kind === 'season' ? focus.season : props.seasons.find(season => season.id === props.selectedSeasonId) ?? props.seasons[0];
  const seasonFocus = (season: WorkspaceSeason) => {
    setFocus({kind: 'season', season}); props.onSeasonFocus();
    if (selectTimer.current) clearTimeout(selectTimer.current);
    selectTimer.current = setTimeout(() => props.onSelectSeason(season.id), 250);
  };
  const episodeFocus = (entry: ContentEntry) => {setFocus({kind: 'episode', entry}); props.onEpisodeFocus(entry);};
  const selected = (season: WorkspaceSeason) => season.id === props.selectedSeasonId;
  const seasonMenu: MenuEntry[] = menu ? [
    {id: 'play-season', label: t('title.playSeason'), icon: 'i-play', onSelect: () => props.onPlaySeason(menu.id)},
    {id: 'mark-season', label: t(menu.watchedCount !== undefined && menu.episodeCount !== undefined && menu.watchedCount >= menu.episodeCount ? 'title.markSeasonUnwatched' : 'title.markSeasonWatched'),
      icon: 'i-check', onSelect: () => props.onMarkSeason(menu.id, !(menu.watchedCount !== undefined && menu.episodeCount !== undefined && menu.watchedCount >= menu.episodeCount))},
  ] : [];
  return <View style={{flexDirection: 'row', gap: 80}}>
    <View style={{width: 320}}>
      <ScrollView showsVerticalScrollIndicator={false} onScroll={event => {const {contentOffset, contentSize, layoutMeasurement} = event.nativeEvent;
        if (contentSize.height - contentOffset.y - layoutMeasurement.height < layoutMeasurement.height) props.onMoreSeasons();}} scrollEventThrottle={64}>
        {props.seasons.map(season => {
          const active = selected(season) || (focus.kind === 'season' && focus.season.id === season.id);
          const total = season.episodeCount, watched = season.watchedCount;
          const counted = watched !== undefined && total !== undefined && total > 0;
          return <Focusable key={season.id} testID={`tv-season-${season.id}`} focusKind="row" focusRadius={12} accessibilityRole="button"
            accessibilityState={{selected: selected(season)}} hasTVPreferredFocus={focus.kind === 'season' && focus.season.id === season.id}
            nextFocusRight={rowTag} onLayout={active ? event => setListTag(event.target) : undefined}
            onFocus={() => seasonFocus(season)} onPress={() => {props.onSelectSeason(season.id); props.onSeasonFocus();}}
            onLongPressAction={() => setMenu(season)} onLongPress={() => setMenu(season)}
            style={{minHeight: 72, marginBottom: 22, paddingHorizontal: 18, paddingVertical: 10, borderRadius: 12, justifyContent: 'center',
              backgroundColor: active ? '#409fd424' : 'transparent', overflow: 'hidden'}}>
            {active && <View pointerEvents="none" style={{position: 'absolute', left: 0, top: 10, bottom: 10, width: 3, borderTopRightRadius: 3, borderBottomRightRadius: 3, backgroundColor: theme.colors.accent}}/>}
            <Text numberOfLines={1} style={[browseType(theme, 26, 700), {color: theme.colors.text}]}>{season.title || t('title.season', {number: season.number})}</Text>
            {counted ? <View style={{marginTop: 4}}>
              <View style={{height: 4, borderRadius: 2, backgroundColor: '#edf5fa29'}}><View style={{height: 4, width: `${Math.min(1, watched! / total!) * 100}%`, borderRadius: 2, backgroundColor: theme.colors.accentStrong}}/></View>
              <Text style={[browseType(theme, 22, 600), {color: theme.colors.textTertiary, marginTop: 4}]}>{t('title.seasonProgress', {watched, total})}</Text>
            </View>
              : total !== undefined ? <Text style={[browseType(theme, 22, 600), {color: theme.colors.textTertiary, marginTop: 2}]}>{t('count.episodes', {count: total})}</Text> : null}
          </Focusable>;
        })}
      </ScrollView>
    </View>
    <View style={{flex: 1, minWidth: 0}}>
      <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{gap: 24, paddingRight: 24, paddingBottom: 2}}
        onScroll={event => {const {contentOffset, contentSize, layoutMeasurement} = event.nativeEvent;
          if (contentSize.width - contentOffset.x - layoutMeasurement.width < layoutMeasurement.width) props.onMoreEpisodes();}} scrollEventThrottle={64}>
        {episodes.map(entry => {
          const model = cardText({id: entry.id, kind: entry.kind, title: entry.displayTitle ?? entry.title, episode: numbering(entry), durationSeconds: entry.duration, positionSeconds: entry.progressSeconds}, 'in-show', props.text);
          const upNext = nextUp?.id === entry.id;
          // tv-detail frames 5 to 8 draw one muted label under the title and the length as a badge on the still.
          return <TVTile key={entry.id} entry={entry} title={entry.displayTitle ?? entry.title} label={model.caption} width={356}
            length={entry.duration === undefined ? undefined : durationText(entry.duration, t)} status={upNext ? t('player.post.upNext') : undefined}
            watched={entry.watched} progress={model.progress} artwork={props.artwork(entry.stillUrl)} backdropFallback={!entry.stillUrl} more={props.more}
            primaryAction="play" onLayout={upNext ? event => setRowTag(event.target) : undefined} hasTVPreferredFocus={focus.kind === 'episode' && focus.entry.id === entry.id}
            nextFocusLeft={listTag} onFocus={() => episodeFocus(entry)} onPlay={() => props.onPlayEpisode(entry)}/>;
        })}
      </ScrollView>
      <FocusBand focus={focus} show={props.show} open={props.open} nextUp={nextUp} text={props.text} onRetry={props.onRetryEpisode} renderError={props.renderError}/>
    </View>
    <Menu open={!!menu} onOpenChange={open => {if (!open) setMenu(undefined);}} title={menu ? menu.title || t('title.season', {number: menu.number}) : ''} items={seasonMenu}/>
  </View>;
}

export function TVTile({entry, more, ...props}: React.ComponentProps<typeof EpisodeTile> & {entry: ContentEntry; more: TVEpisodeBrowserProps['more']}) {
  const anchor = useRef<View>(null);
  return <EpisodeTile {...props} menuAnchorRef={anchor} onMore={() => more(entry, anchor)}/>;
}

export function FocusBand({focus, show, open, nextUp, text, onRetry, renderError}: {
  focus: Focus; show: TVEpisodeBrowserProps['show']; open: NativeTitleEpisodeSnapshot; nextUp?: ContentEntry; text: TextEnvironment;
  onRetry: () => void; renderError: TVEpisodeBrowserProps['renderError'];
}) {
  const theme = useTheme(), t = defaultI18n.t;
  if (focus.kind === 'season') {
    const season = focus.season;
    return <View testID="tv-episode-band" style={{marginTop: 30}}>
      <Text accessibilityRole="header" style={[browseType(theme, 42, 800, -.03), {color: theme.colors.text}]}>{season.title || t('title.season', {number: season.number})}</Text>
      <View style={{flexDirection: 'row', gap: 20, marginTop: 8}}>
        {season.firstAired ? <Text style={[browseType(theme, 22, 600), {color: theme.colors.textTertiary}]}>{season.firstAired.slice(0, 4)}</Text> : null}
        {season.episodeCount !== undefined ? <Text style={[browseType(theme, 22, 600), {color: theme.colors.textTertiary}]}>{t('count.episodes', {count: season.episodeCount})}</Text> : null}
      </View>
      {season.overview ? <Text numberOfLines={3} style={[browseType(theme, 24, 500), {color: theme.colors.textSecondary, lineHeight: 36, marginTop: 12}]}>{season.overview}</Text> : null}
      <View style={{flexDirection: 'row', alignItems: 'center', gap: 14, marginTop: 20}}>
        <View style={{paddingHorizontal: 10, height: 38, borderRadius: 9, borderWidth: 1.5, borderColor: '#edf5fa4d', justifyContent: 'center'}}>
          <Text style={[browseType(theme, 20, 700), {color: theme.colors.textSecondary}]}>{t('next.layout.holdOk')}</Text></View>
        <Text style={[browseType(theme, 22, 600), {color: theme.colors.textTertiary}]}>{t('next.watch.seasonOptions')}</Text>
      </View>
    </View>;
  }
  const entry = focus.entry, data = open.entry?.id === entry.id ? open.data : undefined;
  const episode = data?.item.episode;
  const code = episodeLabel(numbering(entry), 'player', text);
  const credits = data?.metadata.credits ?? [];
  const cast = credits.filter(credit => ['acting', 'cast'].includes(credit.department.toLowerCase()));
  const names = (ids: readonly string[]) => [...new Set(credits.filter(credit => ids.includes(credit.department.toLowerCase())).map(credit => credit.name))];
  const directors = names(['directing', 'director', 'direction']), writers = names(['writing', 'writer', 'writers']);
  const progress = data?.personal.progressSeconds ?? entry.progressSeconds ?? 0, duration = data?.item.duration ?? entry.duration;
  const resuming = progress > 0 && !(data?.personal.watched ?? entry.watched);
  const remaining = duration !== undefined ? durationText(Math.max(0, duration - progress), t) : undefined;
  const rating = data?.facts?.contentRating ?? entry.contentRating;
  const airDate = entry.airDate ?? episode?.airDate;
  return <View testID="tv-episode-band" style={{marginTop: 30, flexDirection: 'row', gap: 40}}>
    <View style={{flex: 1.5, minWidth: 0}}>
      <Text accessibilityRole="header" numberOfLines={2} style={[browseType(theme, 42, 800, -.03), {color: theme.colors.text}]}>{entry.displayTitle ?? entry.title}</Text>
      <View style={{flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', columnGap: 18, rowGap: 8, marginTop: 8}}>
        {code ? <Text style={[browseType(theme, 24, 700), {color: theme.colors.text}]}>{code.text}</Text> : null}
        {airDate ? <Text style={[browseType(theme, 22, 500), {color: theme.colors.textSecondary}]}>{defaultI18n.date(airDate, 'long')}</Text> : null}
        {duration !== undefined ? <Text style={[browseType(theme, 22, 500), {color: theme.colors.textSecondary}]}>{durationText(duration, t)}</Text> : null}
        {rating ? <View style={{paddingHorizontal: 10, height: 40, borderRadius: 6, borderWidth: 1, borderColor: '#edf5fa40', justifyContent: 'center'}}>
          <Text style={[browseType(theme, 20, 600), {color: theme.colors.textSecondary}]}>{rating}</Text></View> : null}
      </View>
      {(data?.item.overview ?? entry.overview) ? <Text numberOfLines={3} style={[browseType(theme, 24, 500), {color: theme.colors.textSecondary, lineHeight: 36, marginTop: 12}]}>{data?.item.overview ?? entry.overview}</Text> : null}
      {resuming && remaining ? <View style={{flexDirection: 'row', alignItems: 'center', gap: 16, marginTop: 14}}>
        <View style={{width: 320, height: 6, borderRadius: 3, backgroundColor: '#edf5fa29'}}><View style={{height: 6, width: `${duration ? Math.min(1, progress / duration) * 100 : 0}%`, borderRadius: 3, backgroundColor: theme.colors.accentStrong}}/></View>
        <Text style={[browseType(theme, 24, 700), {color: theme.colors.text}]}>{t('entry.resume')}<Text style={{fontWeight: '500', color: theme.colors.textSecondary}}>, {t('next.kit.remaining', {time: remaining})}</Text></Text>
      </View> : data?.personal.watched ? <Text style={[browseType(theme, 24, 700), {color: theme.colors.textSecondary, marginTop: 14}]}>{t('card.watched')}</Text> : null}
      {open.phase === 'error' && open.error ? <View style={{marginTop: 12}}>{renderError(open.error, onRetry)}</View> : null}
      <View style={{flexDirection: 'row', alignItems: 'center', gap: 14, marginTop: 18}}>
        <View style={{paddingHorizontal: 10, height: 38, borderRadius: 9, borderWidth: 1.5, borderColor: '#edf5fa4d', justifyContent: 'center'}}>
          <Text style={[browseType(theme, 20, 700), {color: theme.colors.textSecondary}]}>{t('next.layout.holdOk')}</Text></View>
        <Text style={[browseType(theme, 22, 600), {color: theme.colors.textTertiary}]}>{t('next.watch.episodeOptions')}</Text>
      </View>
    </View>
    {credits.length > 0 && <View style={{flex: 1, minWidth: 0, paddingTop: 4, gap: 14}}>
      {cast.length > 0 && <View style={{flexDirection: 'row', gap: 18}}>
        <Text style={[browseType(theme, 22, 600), {color: theme.colors.textTertiary, width: 150}]}>{t('next.watch.guestStars')}</Text>
        <View style={{flex: 1, gap: 4}}>
          {cast.slice(0, 3).map(credit => <Text key={credit.id} style={[browseType(theme, 22, 600), {color: theme.colors.text}]}>{credit.name}
            {credit.role ? <Text style={{fontWeight: '500', color: theme.colors.textSecondary}}>{'  '}{credit.role}</Text> : null}</Text>)}
          {cast.length > 3 ? <Text style={[browseType(theme, 22, 500), {color: theme.colors.textTertiary}]}>{t('next.watch.andMore', {count: cast.length - 3})}</Text> : null}
        </View>
      </View>}
      {directors.length > 0 && <Text style={[browseType(theme, 22, 600), {color: theme.colors.text}]}>{t('title.directedBy', {names: directors.join(', ')})}</Text>}
      {writers.length > 0 && <Text style={[browseType(theme, 22, 600), {color: theme.colors.text}]}>{t('title.writtenBy', {names: writers.join(', ')})}</Text>}
    </View>}
  </View>;
}
