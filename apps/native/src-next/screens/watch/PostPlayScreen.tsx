import React, {useEffect, useMemo, useSyncExternalStore} from 'react';
import {ScrollView, Text, View} from 'react-native';
import Svg, {Defs, LinearGradient, Rect, Stop} from 'react-native-svg';
import {DetailService, type DetailApi, type DetailScope, type PersonalIntent} from '../../../../../packages/client-core/src/detail';
import type {ContentEntry} from '../../../../../packages/client-core/src/library-content';
import {defaultI18n} from '../../../../../packages/i18n/src';
import {Artwork, type ArtworkSource} from '../../kit/artwork';
import {Button, Focusable} from '../../kit/controls';
import {FocusRegion} from '../../kit/focus';
import {Icon} from '../../kit/Icon';
import {useTheme} from '../../kit/theme';

/** tv-player 7: a film with nothing queued ends on its own backdrop, with Replay
 * focused, a rating and the server's related titles. The episode cards stay as
 * they are; this screen is the end of a title the queue has nothing after. */
export type NativeWatchPostPlayProps = Readonly<{
  entry: ContentEntry;
  api: DetailApi;
  scope: DetailScope;
  requestId: () => Promise<string>;
  current: () => boolean;
  artwork: (path?: string) => ArtworkSource | undefined;
  onReplay: () => void;
  onClose: () => void;
  onOpen: (entry: ContentEntry) => void;
  reportError: (error: unknown) => void;
}>;

export function NativeWatchPostPlay({entry, api, scope, requestId, current, artwork, onReplay, onClose, onOpen, reportError}: NativeWatchPostPlayProps) {
  const theme = useTheme(), t = defaultI18n.t;
  const service = useMemo(() => new DetailService({api, scope, requestId}), [api, scope, requestId]);
  const snapshot = useSyncExternalStore(service.subscribe, service.getSnapshot);
  useEffect(() => {
    if (entry.libraryId) void service.select({libraryId: entry.libraryId, itemId: entry.id}).catch(error => {if (current()) reportError(error);});
    return () => service.dispose();
  }, [service, entry.libraryId, entry.id, current, reportError]);
  const detail = snapshot.data && snapshot.data.item.id === entry.id ? snapshot.data : undefined;
  const rating = detail?.personal.rating ?? null;
  const stars = rating === null ? 0 : Math.round(rating / 2);
  const rate = (value: number | null) => {
    if (!current() || !detail) return;
    const intent: PersonalIntent = {action: 'rating', value};
    void service.mutate(intent).catch(error => {if (current()) reportError(error);});
  };
  const related = detail?.related?.rows.flatMap(row => row.entries).filter((row, index, all) => all.findIndex(other => other.id === row.id) === index).slice(0, 12) ?? [];
  const hours = entry.duration && entry.duration >= 3600 ? Math.floor(entry.duration / 3600) : undefined;
  const minutes = entry.duration ? Math.round(entry.duration % 3600 / 60) : undefined;
  const runtime = entry.duration ? hours ? t('next.kit.duration.hoursMinutes', {hours, minutes}) : t('next.kit.duration.minutes', {minutes: Math.round(entry.duration / 60)}) : undefined;
  return <View testID="watch-post-play" style={{position: 'absolute', inset: 0}}>
    <Artwork source={artwork(entry.backdropUrl)} style={{position: 'absolute', inset: 0}}/>
    <Svg pointerEvents="none" width="100%" height="100%" style={{position: 'absolute', inset: 0}}><Defs>
      <LinearGradient id="post-scrim" x1="0" y1="0" x2="1" y2="0"><Stop offset="0" stopColor="#071018" stopOpacity={.94}/><Stop offset=".55" stopColor="#071018" stopOpacity={.55}/><Stop offset="1" stopColor="#071018" stopOpacity={.2}/></LinearGradient>
      <LinearGradient id="post-foot" x1="0" y1="1" x2="0" y2="0"><Stop offset="0" stopColor="#071018" stopOpacity={.95}/><Stop offset="1" stopColor="#071018" stopOpacity={0}/></LinearGradient>
    </Defs><Rect width="100%" height="100%" fill="url(#post-scrim)"/><Rect width="100%" height="100%" fill="url(#post-foot)"/></Svg>
    <FocusRegion id="watch-post" orientation="vertical" entry="watch-post-replay" style={{position: 'absolute', left: 96, top: 84, width: 1000}}>
      <Text style={{fontFamily: 'Manrope-SemiBold', fontSize: 24, fontWeight: '600', marginBottom: 16, color: theme.colors.textSecondary}}>{t('player.post.finished')}</Text>
      <Text numberOfLines={2} style={{fontFamily: 'Manrope-ExtraBold', fontSize: 120, lineHeight: 120, fontWeight: '800', letterSpacing: -3.6, marginBottom: 22, color: theme.colors.text}}>{entry.displayTitle ?? entry.title}</Text>
      <View style={{flexDirection: 'row', alignItems: 'center', gap: 26, marginBottom: 18}}>
        {entry.year !== undefined && <Text style={{fontFamily: 'Manrope-ExtraBold', fontSize: 24, fontWeight: '800', color: theme.colors.text}}>{defaultI18n.number(entry.year, {useGrouping: false})}</Text>}
        {runtime && <Text style={{fontFamily: 'Manrope-SemiBold', fontSize: 24, fontWeight: '600', color: theme.colors.textSecondary}}>{runtime}</Text>}
      </View>
      <View style={{flexDirection: 'row', alignItems: 'center', gap: 18}}>
        <Button focusId="watch-post-replay" testID="watch-post-replay" variant="primary" size="hero" hasTVPreferredFocus icon="i-replay" onPress={onReplay}>{t('player.post.replay')}</Button>
        <Button focusId="watch-post-close" testID="watch-post-close" variant="glass" size="hero" onPress={onClose}>{t('player.post.close')}</Button>
      </View>
      {detail && <View style={{flexDirection: 'row', alignItems: 'center', gap: 12, marginTop: 30}}>
        <Text style={{fontFamily: 'Manrope-Bold', fontSize: 22, fontWeight: '700', marginRight: 10, color: theme.colors.textTertiary}}>{t('player.rateThis')}</Text>
        {[1, 2, 3, 4, 5].map(star => <Focusable key={star} focusId={`watch-post-star-${star}`} testID={`watch-post-star-${star}`} accessibilityRole="button" accessibilityLabel={t('player.rated', {stars: star})}
          accessibilityState={{selected: star <= stars}} onPress={() => rate(star === stars ? null : star * 2)}
          style={{width: 56, height: 56, borderRadius: 28, alignItems: 'center', justifyContent: 'center', backgroundColor: star <= stars ? 'rgba(92,179,226,.22)' : 'rgba(237,245,250,.1)'}}>
          <Icon name={star <= stars ? 'i-star-f' : 'i-star'} size={28} color={star <= stars ? theme.colors.accentStrong : theme.colors.textSecondary}/>
        </Focusable>)}
      </View>}
    </FocusRegion>
    {related.length > 0 && <View style={{position: 'absolute', left: 96, right: 96, top: 578}}>
      <Text style={{fontFamily: 'Manrope-ExtraBold', fontSize: 30, fontWeight: '800', marginBottom: 18, color: theme.colors.text}}>{t('player.moreLike', {title: entry.displayTitle ?? entry.title})}</Text>
      <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{gap: 22}}>
        <FocusRegion id="watch-post-related" orientation="horizontal" entry={`watch-post-related-${related[0]!.id}`}>
          {related.map(row => <Focusable key={row.id} focusId={`watch-post-related-${row.id}`} testID={`watch-post-related-${row.id}`} accessibilityRole="button" accessibilityLabel={row.title}
            onPress={() => {if (current()) onOpen(row);}} style={{width: 184}}>
            {({focused}) => <>
              <View style={{width: 184, height: 276, borderRadius: 12, overflow: 'hidden', backgroundColor: '#0b1822', ...(focused ? {borderWidth: 2, borderColor: theme.colors.focus} : {})}}>
                <Artwork source={artwork(row.posterUrl)} width={184} height={276}/>
              </View>
              <Text numberOfLines={1} style={{fontFamily: 'Manrope-SemiBold', fontSize: 22, fontWeight: '600', marginTop: 10, color: focused ? theme.colors.accentStrong : theme.colors.text}}>{row.title}</Text>
              {row.year !== undefined && <Text style={{fontFamily: 'Manrope-Medium', fontSize: 20, fontWeight: '500', color: theme.colors.textTertiary}}>{defaultI18n.number(row.year, {useGrouping: false})}</Text>}
            </>}
          </Focusable>)}
        </FocusRegion>
      </ScrollView>
    </View>}
  </View>;
}
