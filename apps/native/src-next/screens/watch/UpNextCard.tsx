import React from 'react';
import {Text, View} from 'react-native';
import type {QueuePlaybackView} from '../../../../../packages/client-core/src/queue-controller';
import type {UpNextCountdown, UpNextOffer} from '../../../../../packages/client-core/src/up-next';
import {clockText} from '../../../../../packages/client-core/src/presentation/kit-model/text';
import {defaultI18n} from '../../../../../packages/i18n/src';
import {Artwork, type ArtworkSource} from '../../kit/artwork';
import {Button} from '../../kit/controls';
import {useTheme} from '../../kit/theme';

type Item = QueuePlaybackView['items'][number];

/** tv-player 5 and 6: the next episode offered over the closing credits. Its
 * picture is the item's own still, dimmed; nothing starts early unless the
 * viewer turned that on, and credits followed by a scene never count down. */
export type NativeUpNextCardProps = Readonly<{
  item: Item;
  artwork?: ArtworkSource;
  offer: UpNextOffer;
  countdown: UpNextCountdown | null;
  /** The credits end before the title does: a scene follows them. */
  sceneAfter: boolean;
  /** The post-play countdown the bar fills from. */
  countdownTotal: number;
  onPlayNow: () => void;
  onWatchCredits: () => void;
  onSkipCredits: () => void;
}>;

export function NativeUpNextCard({item, artwork, countdown, countdownTotal, sceneAfter, onPlayNow, onWatchCredits, onSkipCredits}: NativeUpNextCardProps) {
  const theme = useTheme(), t = defaultI18n.t;
  const code = item.episode ? t('next.kit.episodeCode', {season: item.episode.seasonNumber, episode: item.episode.number}) : undefined;
  const minutes = item.durationMs && item.durationMs > 0 ? t('next.kit.duration.minutes', {minutes: Math.round(item.durationMs / 60_000)}) : undefined;
  return <View testID="watch-up-next" style={{width: sceneAfter ? 780 : 680, padding: 26, borderRadius: 22, backgroundColor: 'rgba(9,19,27,.84)',
    boxShadow: '0 30px 80px -20px rgba(0,0,0,.85), inset 0 0 0 1px rgba(237,245,250,.1)'}}>
    <View style={{flexDirection: 'row', alignItems: 'center', gap: 24}}>
      <View style={{width: 256, height: 144, borderRadius: 12, overflow: 'hidden', backgroundColor: '#0b1822'}}>
        <Artwork source={artwork} width={256} height={144} style={{opacity: .34}}/>
      </View>
      <View style={{flex: 1, minWidth: 0}}>
        <Text style={{fontFamily: 'Manrope-Bold', fontSize: 20, fontWeight: '700', color: theme.colors.accentStrong}}>{t('player.post.upNext')}</Text>
        <Text numberOfLines={2} style={{fontFamily: 'Manrope-ExtraBold', fontSize: 34, lineHeight: 37.4, fontWeight: '800', letterSpacing: -.85, marginTop: 6, marginBottom: 4, color: theme.colors.text}}>{item.title}</Text>
        {(code || minutes) && <Text style={{fontFamily: 'Manrope-SemiBold', fontSize: 22, fontWeight: '600', color: theme.colors.textSecondary}}>{[code, minutes].filter(Boolean).join(' · ')}</Text>}
        {countdown && <View style={{flexDirection: 'row', alignItems: 'baseline', marginTop: 10}}>
          {countdown.automatic
            ? <Text style={{fontSize: 20, fontWeight: '600', color: theme.colors.textTertiary}}>{t('player.post.playingIn', {seconds: countdown.seconds})}</Text>
            : <><Text style={{fontSize: 20, fontWeight: '600', color: theme.colors.textTertiary}}>{t('player.post.startsIn', {time: ''})}</Text>
              <Text style={{fontSize: 20, fontWeight: '600', color: theme.colors.text}}>{clockText(countdown.seconds)}</Text></>}
        </View>}
      </View>
    </View>
    {countdown?.automatic && <View style={{height: 4, borderRadius: 2, marginTop: 18, overflow: 'hidden', backgroundColor: 'rgba(237,245,250,.16)'}}>
      <View style={{height: 4, borderRadius: 2, backgroundColor: '#fff', width: `${Math.max(0, Math.min(1, countdown.seconds / Math.max(1, countdownTotal))) * 100}%`}}/>
    </View>}
    <View style={{flexDirection: 'row', gap: 18, marginTop: 24}}>
      <Button focusId="watch-up-next-play" testID="watch-up-next-play" variant="primary" size="hero" hasTVPreferredFocus icon="i-play" onPress={onPlayNow}>{t('player.post.playNow')}</Button>
      {sceneAfter && <Button focusId="watch-up-next-skip" testID="watch-up-next-skip" variant="glass" size="hero" icon="i-next" onPress={onSkipCredits}>{t('player.skip', {kind: 'credits'})}</Button>}
      <Button focusId="watch-up-next-watch" testID="watch-up-next-watch" variant="glass" size="hero" onPress={onWatchCredits}>{t('player.post.watchCredits')}</Button>
    </View>
    {sceneAfter && <View style={{flexDirection: 'row', alignItems: 'center', gap: 12, marginTop: 20}}>
      <View style={{width: 9, height: 9, borderRadius: 4.5, backgroundColor: theme.colors.accentStrong}}/>
      <Text style={{fontSize: 20, fontWeight: '600', color: theme.colors.textSecondary}}>{t('player.post.sceneAfterSkip')}</Text>
    </View>}
  </View>;
}
