import React, {useEffect, useRef, useState, useSyncExternalStore} from 'react';
import {ScrollView, Text, View} from 'react-native';
import type {ContentEntry} from '../../../../../packages/client-core/src/library-content';
import {episodeLabel, type TextEnvironment} from '../../../../../packages/client-core/src/presentation/kit-model';
import {durationText} from '../../../../../packages/client-core/src/presentation/kit-model/text';
import {defaultI18n} from '../../../../../packages/i18n/src';
import {Artwork, type ArtworkSource} from '../../kit/artwork';
import {Button, Focusable} from '../../kit/controls';
import {useTheme} from '../../kit/theme';
import {NativeSeasonsSheet} from './SeasonsSheet';
import type {NativeTitleController} from './title-controller';

/** collections 37/38: the episode list inside the player (sideways) and the season
 * sheet the upright tab shares. Only the workspace's own seasons and episodes are
 * drawn; the playing episode carries its level mark, progress and Playing label, and
 * the next one says Up next. Choosing another episode stays in the same playback. */
export type NativeWatchEpisodesProps = Readonly<{
  controller: NativeTitleController;
  currentId: string;
  playing: boolean;
  text: TextEnvironment;
  artwork: (path?: string) => ArtworkSource | undefined;
  onPlay: (entry: ContentEntry) => void;
  onClose: () => void;
  /** foldable4/5: the episodes that follow the playing one, with no panel chrome. */
  pane?: boolean;
}>

const numbering = (entry: ContentEntry) => entry.absoluteNumber !== undefined ? {mode: 'absolute' as const, number: entry.absoluteNumber}
  : entry.dateBased && entry.airDate ? {mode: 'date' as const, day: entry.airDate}
    : entry.seasonNumber === 0 ? {mode: 'special' as const} : {mode: 'seasonal' as const, season: entry.seasonNumber, episode: entry.episodeNumber};

export function NativeWatchEpisodes({controller, currentId, playing, text, artwork, onPlay, onClose, pane = false}: NativeWatchEpisodesProps) {
  const theme = useTheme(), t = defaultI18n.t;
  const snapshot = useSyncExternalStore(controller.subscribe, controller.getSnapshot);
  const [seasonsOpen, setSeasonsOpen] = useState(false);
  const scroll = useRef<ScrollView>(null);
  useEffect(() => {void controller.open().catch(() => {});}, [controller]);
  const workspace = snapshot.workspace, data = workspace?.data;
  const seasons = snapshot.seasons, episodes = snapshot.episodes;
  const selected = data?.selected.seasonId ?? null;
  const season = seasons.find(value => value.id === selected) ?? seasons[0];
  const nextUp = data?.nextUp;
  const count = season?.episodeCount;
  const seasonLabel = season ? (season.number === 0 ? t('next.kit.specials') : t('next.kit.season', {number: season.number})) : t('title.seasons');
  const loading = workspace?.phase === 'loading' || workspace?.phase === 'idle';
  // foldable4/5 draw the episodes that follow the playing one. The controller
  // pages a bounded list, so an absent current episode means the order relative
  // to it is unknown: no rows are claimed as following, and no earlier row is
  // ever dressed up as one.
  const playingIndex = episodes.findIndex(entry => entry.id === currentId);
  const following = pane ? (playingIndex >= 0 ? episodes.slice(playingIndex + 1) : []) : episodes;
  const row = (entry: ContentEntry) => {
    const isPlaying = entry.id === currentId;
    const isNext = !isPlaying && nextUp?.id === entry.id;
    const progress = !isPlaying && entry.progressSeconds && entry.duration ? Math.max(0, Math.min(1, entry.progressSeconds / entry.duration)) : undefined;
    return <Focusable key={entry.id} focusId={`episodes-${entry.id}`} testID={`episodes-${entry.id}`} focusKind="row" accessibilityRole="button"
      accessibilityLabel={[entry.displayTitle ?? entry.title, isPlaying ? t('player.miniPlaying') : isNext ? t('player.queue') : undefined].filter(Boolean).join(', ')}
      onPress={() => {if (!isPlaying) onPlay(entry);}} onFocus={() => {}} style={({focused}) => ({minHeight: pane ? 66 : 64, paddingHorizontal: pane ? 8 : 10, paddingVertical: 8, borderRadius: 10,
        flexDirection: 'row', alignItems: 'center', gap: 12, backgroundColor: focused ? 'rgba(237,245,250,.12)' : 'transparent'})}>
      <View style={{width: pane ? 88 : 84, height: pane ? 50 : 48, borderRadius: 8, overflow: 'hidden', backgroundColor: theme.colors.raised}}>
        <Artwork source={artwork(entry.stillUrl ?? data?.show?.backdropUrl)} width={pane ? 88 : 84} height={pane ? 50 : 48} style={{opacity: .45}}/>
      </View>
      <View style={{flex: 1, minWidth: 0}}>
        <View style={{flexDirection: 'row', alignItems: 'center', gap: 8}}>
          <Text numberOfLines={1} style={{flexShrink: 1, fontFamily: 'Manrope-SemiBold', fontSize: 15, fontWeight: '600', color: theme.colors.text}}>{entry.displayTitle ?? entry.title}</Text>
          {isPlaying && <View style={{flexDirection: 'row', alignItems: 'center', gap: 6}}>
            <View style={{flexDirection: 'row', alignItems: 'flex-end', gap: 2, height: 12}}>{[.55, 1, .38].map((factor, index) =>
              <View key={index} style={{width: 3, height: 12 * factor, borderRadius: 1.5, backgroundColor: theme.colors.accentStrong}}/>)}</View>
            <Text style={{fontFamily: 'Manrope-Bold', fontSize: 12, fontWeight: '700', color: theme.colors.accentStrong}}>{t('player.miniPlaying')}</Text>
          </View>}
          {isNext && <Text style={{fontFamily: 'Manrope-Bold', fontSize: 12, fontWeight: '700', color: theme.colors.textSecondary}}>{t('player.queue')}</Text>}
        </View>
        <Text numberOfLines={1} style={{marginTop: 2, fontFamily: 'Manrope-SemiBold', fontSize: 12.5, fontWeight: '600', color: theme.colors.textTertiary}}>
          {[episodeLabel(numbering(entry), 'player', text), entry.duration ? durationText(entry.duration, text.t) : undefined].filter(Boolean).join(' · ')}</Text>
        {progress !== undefined && <View style={{height: 3, borderRadius: 2, marginTop: 5, backgroundColor: 'rgba(237,245,250,.18)'}}>
          <View style={{height: 3, borderRadius: 2, width: `${progress * 100}%`, backgroundColor: theme.colors.accentStrong}}/></View>}
      </View>
      {isPlaying && playing && <View style={{width: 4, height: 24, borderRadius: 2, backgroundColor: theme.colors.accentStrong}}/>}
    </Focusable>;
  };
  return <View testID="watch-episodes-panel" style={{flex: 1, backgroundColor: pane ? 'transparent' : theme.colors.raised, borderRadius: pane || theme.isTV ? 0 : 20, overflow: 'hidden'}}>
    {!pane && <View style={{flexDirection: 'row', alignItems: 'center', gap: 10, paddingHorizontal: 16, paddingTop: 12, paddingBottom: 8}}>
      <Text accessibilityRole="header" numberOfLines={1} style={{fontFamily: 'Manrope-ExtraBold', fontSize: 18, fontWeight: '800', letterSpacing: -.02, color: theme.colors.text, flexShrink: 1}}>{t('title.episodes')}</Text>
      <View style={{flex: 1}}/>
      <Button testID="watch-episodes-seasons" variant="glass" size="small" trailingIcon="i-chdown" onPress={() => setSeasonsOpen(true)}>{seasonLabel}</Button>
      <Button testID="watch-episodes-close" variant="text" iconOnly icon="i-close" accessibilityLabel={t('action.close')} onPress={onClose}/>
    </View>}
    {!pane && count !== undefined && <Text style={{paddingHorizontal: 16, paddingBottom: 6, fontFamily: 'Manrope-SemiBold', fontSize: 12.5, fontWeight: '600', color: theme.colors.textTertiary}}>
      {defaultI18n.number(count, {useGrouping: false})} · {t('title.episodes')}</Text>}
    {pane && following.length > 0 && <Text testID="watch-episodes-pane-heading" accessibilityRole="header" style={{paddingHorizontal: 0, paddingBottom: 4,
      fontFamily: 'Manrope-Bold', fontSize: 12.5, fontWeight: '700', color: theme.colors.accentStrong}}>{t('player.post.upNext')}</Text>}
    <ScrollView ref={scroll} style={{flex: 1}} contentContainerStyle={pane ? {paddingHorizontal: 8, paddingBottom: 12, gap: 10} : {paddingHorizontal: 8, paddingBottom: 16}} scrollEventThrottle={32}
      onScroll={event => {
        // foldable3g/5: the season keeps going as the list reaches its end.
        const {contentOffset, contentSize, layoutMeasurement} = event.nativeEvent;
        if (contentSize.height - contentOffset.y - layoutMeasurement.height < layoutMeasurement.height) void controller.moreEpisodes().catch(() => {});
      }}>
      {loading && !episodes.length && <Text style={{padding: 16, color: theme.colors.textTertiary}}>{t('next.states.loading')}</Text>}
      {following.map(row)}
    </ScrollView>
    {!pane && <NativeSeasonsSheet open={seasonsOpen} onOpenChange={setSeasonsOpen} seasons={seasons} total={seasons.length} selectedId={selected}
      onSelect={id => {void controller.season(id).catch(() => {});}} hideWatched={false} onHideWatched={() => {}}/>}
  </View>;
}
