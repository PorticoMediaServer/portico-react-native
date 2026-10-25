import React, {useMemo, useState, useSyncExternalStore} from 'react';
import {Pressable, ScrollView, Text, View} from 'react-native';
import {defaultI18n} from '../../../../../../packages/i18n/src';
import {playbackIdentity} from '../../../../../../packages/client-core/src/presentation/kit-model';
import {clockText} from '../../../../../../packages/client-core/src/presentation/kit-model/text';
import {listeningNoticeKey} from '../../../../../../packages/client-core/src/audio-effects';
import {Focusable} from '../../../kit/controls';
import {AmbientArt, Artwork} from '../../../kit/artwork';
import {Icon, type IconName} from '../../../kit/Icon';
import {useTheme, nativeType} from '../../../kit/theme';
import {nativeEqualizer} from '../../../platform/playback/equalizer';
import type {NativePlaybackRuntimeSnapshot} from '../../../platform/playback/types';
import type {NativeShellRuntime} from '../../../shell/runtime';
import type {DockAction} from '../../../kit/dock/types';
import {NativeWatchEqualizer, type NativeEqualizerCopy} from '../../watch/Equalizer';
import {MusicSignalLine, MusicSignalSheet, musicSignalView} from './MusicSignal';
import {nativeMusicSignal} from './signal-facts';

const t = defaultI18n.t;
const NOTE_KEY = listeningNoticeKey;

function copy(): NativeEqualizerCopy {
  return {
    title: t('next.media.eq.title'), back: t('action.back'), thisDevice: t('device.thisDevice'), bands: t('next.media.eq.bands'),
    preamp: t('next.media.eq.preamp'), reset: t('next.media.eq.reset'), musicAndAudiobooks: t('next.settingsSpec.account.music.title'),
    notBitPerfect: t('next.media.eq.help'),
    gain: (value, unit) => unit ? t('next.media.eq.db', {value}) : String(value),
    frequency: (index, accessible) => {
      const hz = [31, 62, 125, 250, 500, 1000, 2000, 4000, 8000, 16000][index] ?? 0;
      return hz >= 1000 ? t('next.media.eq.khz', {frequency: hz / 1000}) : t('next.media.eq.hz', {frequency: hz});
    },
  };
}

/** tv-player 7 / phone-player music Now playing, with the signal-path line (music-plus 3 and 5),
 * its sheet, the EQ shortcut and the pause-you-did-not-make notice. Queue and dock chrome stay
 * with the dock and the watch lane's shell; this surface owns no player, store or queue. */
export function NativeMusicNowPlaying({snapshot, runtime, onCommand, onMinimize, onClose}: {
  snapshot: NativePlaybackRuntimeSnapshot; runtime: NativeShellRuntime;
  onCommand: (type: DockAction) => void; onMinimize: () => void; onClose: () => void;
}) {
  const theme = useTheme(), tv = theme.isTV, equalizer = useSyncExternalStore(nativeEqualizer.subscribe, nativeEqualizer.getSnapshot);
  const [panel, setPanel] = useState<'signal' | 'more' | 'eq' | null>(null);
  const identity = useMemo(() => snapshot.subject ? playbackIdentity(snapshot.subject, 'dock', runtime.text) : undefined, [snapshot.subject, runtime.text]);
  const signal = useMemo(() => {
    const input = nativeMusicSignal(snapshot, equalizer.value);
    return input ? musicSignalView(input) : undefined;
  }, [snapshot, equalizer.value]);
  const art = runtime.artwork(snapshot.entry?.posterUrl ?? snapshot.entry?.backdropUrl), ambient = runtime.ambient(snapshot.entry?.posterUrl ?? snapshot.entry?.backdropUrl);
  const position = snapshot.playback.positionSeconds, duration = snapshot.playback.duration;
  const playing = snapshot.playback.intent === 'playing' && snapshot.playback.phase !== 'ended';
  const notice = snapshot.playback.listeningNotice ? NOTE_KEY(snapshot.playback.listeningNotice) : undefined;
  const progress = duration > 0 ? Math.min(1, Math.max(0, position / duration)) : 0;
  const from = snapshot.entry?.kind === 'album' ? t('player.fromAlbum') : snapshot.entry?.kind === 'artist' ? t('player.fromArtist') : undefined;
  const fromName = snapshot.entry?.displayTitle ?? snapshot.entry?.title;
  const transport = <View style={{flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: tv ? 34 : 26}}>
    {([['previous', 'i-prev', t('player.previous')], [playing ? 'pause' : 'play', playing ? 'i-pause' : 'i-play', t(playing ? 'action.pause' : 'action.play')],
      ['next', 'i-next', t('player.next')]] as const).map(([type, icon, label]) => <Focusable key={type} focusId={`music-${type}`} testID={`music-${type}`}
      accessibilityRole="button" accessibilityLabel={label} hasTVPreferredFocus={type === (playing ? 'pause' : 'play')} focusRadius={44}
      onPress={() => onCommand(type)} style={{width: tv ? 84 : 64, height: tv ? 84 : 64, borderRadius: 44, alignItems: 'center', justifyContent: 'center',
        backgroundColor: type === (playing ? 'pause' : 'play') ? theme.colors.text : 'rgba(237,245,250,.12)'}}>
      <Icon name={icon as IconName} size={tv ? 40 : 28} color={type === (playing ? 'pause' : 'play') ? theme.colors.ink : theme.colors.text}/>
    </Focusable>)}</View>;
  const scrub = <View style={{marginTop: tv ? 26 : 16}}>
    <View style={{height: tv ? 6 : 4, borderRadius: 3, backgroundColor: 'rgba(237,245,250,.18)'}}><View style={{height: '100%', width: `${progress * 100}%`, borderRadius: 3, backgroundColor: theme.colors.accentStrong}}/></View>
    <View style={{flexDirection: 'row', marginTop: 8}}>
      <Text style={[nativeType({size: tv ? 22 : 12, weight: 600, tracking: 0, lineHeight: 'normal'}, theme.textScale), {color: theme.colors.text, fontVariant: ['tabular-nums']}]}>{clockText(position)}</Text>
      <View style={{flex: 1}}/>
      <Text style={[nativeType({size: tv ? 22 : 12, weight: 600, tracking: 0, lineHeight: 'normal'}, theme.textScale), {color: theme.colors.textSecondary, fontVariant: ['tabular-nums']}]}>{clockText(Math.max(0, duration - position))}</Text>
    </View>
  </View>;
  const noticeNode = notice ? <View accessibilityLiveRegion="polite" accessibilityRole="alert" testID="music-listening-notice"
    style={{flexDirection: 'row', alignItems: 'center', gap: tv ? 12 : 8, alignSelf: tv ? 'flex-end' : 'center', marginTop: tv ? 0 : 12,
      paddingHorizontal: tv ? 20 : 12, paddingVertical: tv ? 12 : 8, borderRadius: tv ? 14 : 10, backgroundColor: 'rgba(7,16,24,.62)'}}>
    <Icon name="i-pause" size={tv ? 28 : 14} color={theme.colors.accentStrong}/>
    <Text style={[nativeType({size: tv ? 24 : 13, weight: 700, tracking: 0, lineHeight: 'normal'}, theme.textScale), {color: theme.colors.textSecondary}]}>{t(notice)}</Text>
  </View> : undefined;
  const moreButton = <Focusable focusId="music-more" testID="music-more" accessibilityRole="button" accessibilityLabel={t('player.more')}
    onPress={() => setPanel(value => value === 'more' ? null : 'more')} style={{width: tv ? 64 : 44, height: tv ? 64 : 44, borderRadius: 32, alignItems: 'center', justifyContent: 'center', backgroundColor: 'rgba(237,245,250,.12)'}}>
    <Icon name="i-more" size={tv ? 28 : 22} color={theme.colors.text}/>
  </Focusable>;
  const panels = <>
    {panel === 'signal' && signal ? <View style={{position: 'absolute', inset: 0, zIndex: 20}}><MusicSignalSheet view={signal} onClose={() => setPanel(null)}/></View> : null}
    {panel === 'more' && <View style={{position: 'absolute', inset: 0, zIndex: 20, backgroundColor: 'rgba(7,16,24,.72)'}}>
      <View style={{position: 'absolute', ...(tv ? {right: 96, top: 160, width: 460} : {left: 16, right: 16, bottom: 24}), padding: 18, borderRadius: 16, backgroundColor: theme.colors.raised}}>
        <Text style={[nativeType({size: tv ? 26 : 16, weight: 800, tracking: -.02, lineHeight: 'normal'}, theme.textScale), {color: theme.colors.text, marginBottom: 10}]}>{t('player.more')}</Text>
        {signal ? <Focusable focusId="music-more-signal" accessibilityRole="button" accessibilityLabel={t('player.signal.title')} hasTVPreferredFocus={tv}
          onPress={() => setPanel('signal')} style={{paddingVertical: 12, flexDirection: 'row', alignItems: 'center', gap: 12}}>
          <Icon name="i-pulse" size={tv ? 24 : 18} color={theme.colors.textSecondary}/>
          <Text style={[nativeType({size: tv ? 22 : 14.5, weight: 600, tracking: 0, lineHeight: 'normal'}, theme.textScale), {color: theme.colors.text}]}>{t('player.signal.title')}</Text>
        </Focusable> : null}
        {equalizer.supported ? <Focusable focusId="music-more-eq" accessibilityRole="button" accessibilityLabel={t('next.media.eq.title')} onPress={() => setPanel('eq')}
          style={{paddingVertical: 12, flexDirection: 'row', alignItems: 'center', gap: 12}}>
          <Icon name="i-gauge" size={tv ? 24 : 18} color={theme.colors.textSecondary}/>
          <Text style={[nativeType({size: tv ? 22 : 14.5, weight: 600, tracking: 0, lineHeight: 'normal'}, theme.textScale), {color: theme.colors.text}]}>{t('next.media.eq.title')}</Text>
          <View style={{flex: 1}}/>
          <Text style={[nativeType({size: tv ? 20 : 13, weight: 600, tracking: 0, lineHeight: 'normal'}, theme.textScale), {color: theme.colors.textTertiary}]}>{t(equalizer.value?.on ? 'next.media.eq.on' : 'next.media.eq.off')}</Text>
        </Focusable> : null}
        <Focusable focusId="music-more-close" accessibilityRole="button" accessibilityLabel={t('action.close')} onPress={() => setPanel(null)} style={{paddingVertical: 12}}>
          <Text style={[nativeType({size: tv ? 22 : 14.5, weight: 600, tracking: 0, lineHeight: 'normal'}, theme.textScale), {color: theme.colors.textSecondary}]}>{t('action.close')}</Text>
        </Focusable>
      </View>
    </View>}
    {panel === 'eq' ? <View style={{position: 'absolute', inset: 0, zIndex: 20, backgroundColor: theme.colors.ink}}>
      <NativeWatchEqualizer onBack={() => setPanel('more')} copy={copy()} reportError={runtime.reportError} store={nativeEqualizer}/>
    </View> : null}
  </>;
  if (tv) return <View testID="native-music-now-playing" style={{position: 'absolute', inset: 0, backgroundColor: theme.colors.ink}}>
    {ambient ? <AmbientArt source={ambient} treatment="title" style={{position: 'absolute', inset: 0}}/> : null}
    <View pointerEvents="none" style={{position: 'absolute', inset: 0, backgroundColor: 'rgba(7,16,24,.62)'}}/>
    <View style={{position: 'absolute', left: 0, right: 0, top: 64, flexDirection: 'row', alignItems: 'center', paddingHorizontal: 96}}>
      {from && fromName ? <Text style={[nativeType({size: 24, weight: 700, tracking: 0, lineHeight: 'normal'}, theme.textScale), {color: theme.colors.textSecondary}]}>{from}<Text style={{color: theme.colors.text}}> {fromName}</Text></Text> : null}
      <View style={{flex: 1}}/>
      {noticeNode}
      {moreButton}
    </View>
    <View style={{position: 'absolute', left: 200, top: 200, width: 380, height: 380, borderRadius: 18, overflow: 'hidden', backgroundColor: theme.colors.raised}}>
      {art ? <Artwork source={art} width={380} height={380} priority/> : null}
    </View>
    <View style={{position: 'absolute', left: 660, top: 200, width: 1060}}>
      <Text numberOfLines={2} style={[nativeType({size: 64, weight: 800, tracking: -.04, lineHeight: 66}, theme.textScale), {color: theme.colors.text}]}>{identity?.title ?? ''}</Text>
      {identity ? <Text numberOfLines={1} style={[nativeType({size: 28, weight: 700, tracking: 0, lineHeight: 'normal'}, theme.textScale), {marginTop: 10, color: theme.colors.textSecondary}]}>{identity.subtitle.map(part => part.text).join('  ')}</Text> : null}
      {signal ? <View style={{marginTop: 20}}><MusicSignalLine view={signal} onPress={() => setPanel('signal')}/></View> : null}
      {scrub}
      <View style={{marginTop: 30}}>{transport}</View>
    </View>
    {panels}
  </View>;
  return <View testID="native-music-now-playing" style={{position: 'absolute', inset: 0, backgroundColor: theme.colors.ink}}>
    {ambient ? <AmbientArt source={ambient} treatment="title" style={{position: 'absolute', inset: 0}}/> : null}
    <View pointerEvents="none" style={{position: 'absolute', inset: 0, backgroundColor: 'rgba(7,16,24,.72)'}}/>
    <ScrollView contentContainerStyle={{paddingTop: 52, paddingHorizontal: 20, paddingBottom: 28}} showsVerticalScrollIndicator={false}>
      <View style={{flexDirection: 'row', alignItems: 'center', gap: 8}}>
        <Focusable focusId="music-minimize" accessibilityRole="button" accessibilityLabel={t('player.minimize')} onPress={onMinimize}
          style={{width: 44, height: 44, borderRadius: 22, alignItems: 'center', justifyContent: 'center'}}><Icon name="i-down" size={26} color={theme.colors.text}/></Focusable>
        <View style={{flex: 1, minWidth: 0}}>
          {from && fromName ? <><Text style={[nativeType({size: 11.5, weight: 600, tracking: 0, lineHeight: 'normal'}, theme.textScale), {color: theme.colors.textTertiary}]}>{from}</Text>
            <Text numberOfLines={1} style={[nativeType({size: 13, weight: 700, tracking: 0, lineHeight: 'normal'}, theme.textScale), {color: theme.colors.text}]}>{fromName}</Text></> : null}
        </View>
        <Pressable accessibilityRole="button" accessibilityLabel={t('player.close')} onPress={onClose} style={{width: 40, height: 40, alignItems: 'center', justifyContent: 'center'}}>
          <Icon name="i-close" size={22} color={theme.colors.textSecondary}/>
        </Pressable>
      </View>
      <View style={{alignSelf: 'center', width: 300, height: 300, borderRadius: 14, overflow: 'hidden', marginTop: 18, backgroundColor: theme.colors.raised}}>
        {art ? <Artwork source={art} width={300} height={300} priority/> : null}
      </View>
      <Text numberOfLines={2} style={[nativeType({size: 26, weight: 800, tracking: -.03, lineHeight: 'normal'}, theme.textScale), {marginTop: 18, color: theme.colors.text, textAlign: 'center'}]}>{identity?.title ?? ''}</Text>
      {identity ? <Text numberOfLines={1} style={[nativeType({size: 15, weight: 600, tracking: 0, lineHeight: 'normal'}, theme.textScale), {marginTop: 4, color: theme.colors.textSecondary, textAlign: 'center'}]}>{identity.subtitle.map(part => part.text).join('  ')}</Text> : null}
      {signal ? <View style={{alignSelf: 'center', marginTop: 12}}><MusicSignalLine view={signal} onPress={() => setPanel('signal')}/></View> : null}
      {scrub}
      <View style={{marginTop: 18}}>{transport}</View>
      {noticeNode}
      <View style={{flexDirection: 'row', justifyContent: 'flex-end', marginTop: 14}}>{moreButton}</View>
    </ScrollView>
    {panels}
  </View>;
}
