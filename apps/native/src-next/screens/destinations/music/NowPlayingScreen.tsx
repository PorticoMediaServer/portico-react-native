import React, {useCallback, useEffect, useId, useRef, useState} from 'react';
import {BackHandler, ScrollView, Text, View} from 'react-native';
import {Gesture, GestureDetector} from 'react-native-gesture-handler';
import type {QueuePlaybackView} from '../../../../../../packages/client-core/src/queue-controller';
import type {MessageId} from '../../../../../../packages/i18n/src';
import {useSyncExternalStore} from 'react';
import {nativeEqualizer} from '../../../platform/playback/equalizer';
import {registerOverlayKeys} from '../../../platform/overlay-keys';
import {NativeWatchEqualizer, type NativeEqualizerCopy} from '../../watch/Equalizer';
import {MusicSignalLine, MusicSignalSheet, type MusicSignalView} from './MusicSignal';
import {defaultI18n} from '../../../../../../packages/i18n/src';
import {clockText} from '../../../../../../packages/client-core/src/presentation/kit-model/text';
import {AmbientArt, Artwork} from '../../../kit/artwork';
import {Button} from '../../../kit/controls';
import {Icon} from '../../../kit/Icon';
import {useTheme} from '../../../kit/theme';
import {browseType} from '../../../kit/browse/presentation';
import {commandAllowed, dockCommand, playbackPosition, seekBounds, seekTo} from '../../../kit/dock/model';
import type {DockCommand, DockOccupant} from '../../../kit/dock/types';
import {NowPlayingQueue} from './NowPlayingQueue';
import {MusicFocusRegion, TVMusicFocus, TVMusicSeek} from './TVMusicFocus';
import {NativeListeningNotice} from './ListeningNotice';
import {TVNowPlayingScreen} from './TVNowPlayingScreen';
import type {NativeListeningQueuePolicy} from '../../../shell/listening-queue-policy';

const t = defaultI18n.t;
const equalizerCopy = (): NativeEqualizerCopy => ({title: t('next.media.eq.title'), back: t('action.back'), thisDevice: t('device.thisDevice'),
  bands: t('next.media.eq.bands'), preamp: t('next.media.eq.preamp'), reset: t('next.media.eq.reset'),
  musicAndAudiobooks: t('next.settingsSpec.account.music.title'), notBitPerfect: t('next.media.eq.help'),
  gain: (value, unit) => unit ? t('next.media.eq.db', {value}) : String(value),
  frequency: (index) => {const hz = [31, 62, 125, 250, 500, 1000, 2000, 4000, 8000, 16000][index] ?? 0;
    return hz >= 1000 ? t('next.media.eq.khz', {frequency: hz / 1000}) : t('next.media.eq.hz', {frequency: hz});}});

/** tablet-play9/10: the listening surface for music and audiobooks. The real
 * dock occupant supplies the picture, identity, transport capabilities and seek
 * window; the listening owner supplies the queue. Wide windows put the queue
 * beside the now-playing column at 366 pt (the main column never drops below a
 * usable cover); narrower ones stack it under the column, toggled by Up next. */
export type NowPlayingScreenProps = Readonly<{
  occupant: DockOccupant;
  queue?: QueuePlaybackView;
  artwork?: React.ComponentProps<typeof NowPlayingQueue>['artwork'];
  /** The song's own synced lyrics body (the caller owns its reader); drawn as a
   * tab of the side panel, or under Up next on a narrow window. */
  lyrics?: React.ReactNode;
  width: number;
  height: number;
  topInset?: number;
  bottomInset?: number;
  onAction: (command: DockCommand) => void;
  onQueuePlay?: (queueId: string, entryId: string, revision: string) => void;
  onAddToPlaylist?: () => void;
  queuePolicy?: NativeListeningQueuePolicy;
  onClose: () => void;
  /** music-plus (MC-8): the committed plan plus the engine's own current-song facts. */
  signal?: MusicSignalView;
  /** listening-notices: a pause the viewer did not make. */
  notice?: MessageId;
  reportError?: (error: unknown) => void;
  testID?: string;
}>;

const QUEUE_WIDTH = 366;
const SIDE_BY_SIDE = 700;

export function NowPlayingScreen(props: NowPlayingScreenProps) {
  const theme = useTheme();
  return theme.isTV ? <TVNowPlayingScreen {...props} equalizerCopy={equalizerCopy()}/> : <TouchNowPlayingScreen {...props}/>;
}

function TouchNowPlayingScreen({occupant, queue, artwork, width, height, topInset = 0, bottomInset = 0, onAction, onQueuePlay, onClose, signal, notice, reportError = () => {}, testID = 'now-playing', lyrics}: NowPlayingScreenProps) {
  const theme = useTheme(), {presentation: p, playback} = occupant;
  const focus = useId();
  const [sheet, setSheet] = useState<'queue' | 'lyrics' | null>(null), [panelTab, setPanelTab] = useState<'queue' | 'lyrics'>('queue'), [panel, setPanel] = useState<'signal' | 'eq' | null>(null), track = useRef(0);
  // music-plus 6/6b and listening-notices 8: the signal sheet (like the EQ panel) is the top
  // surface while it is open, so Back closes it rather than folding the player, and focus returns
  // to the line that opened it.
  const signalRef = useRef<View | null>(null);
  const closePanel = useCallback(() => {
    setPanel(null);
    if (theme.isTV && panel !== 'signal') requestAnimationFrame(() => (signalRef.current as unknown as {requestTVFocus?: () => void} | null)?.requestTVFocus?.());
  }, [theme.isTV, panel]);
  useEffect(() => {
    if (!panel || (theme.isTV && panel === 'signal')) return;
    const back = BackHandler.addEventListener('hardwareBackPress', () => {closePanel(); return true;});
    const release = theme.isTV ? registerOverlayKeys(key => {if (key === 'escape' || key === 'menu') {closePanel(); return true;} return false;}) : () => {};
    return () => {back.remove(); release();};
  }, [panel, closePanel, theme.isTV]);
  const equalizer = useSyncExternalStore(nativeEqualizer.subscribe, nativeEqualizer.getSnapshot);
  const wide = width >= SIDE_BY_SIDE, side = wide && !!(queue || lyrics), position = playbackPosition(occupant), bounds = seekBounds(occupant);
  const span = bounds ? Math.max(0, bounds.end - bounds.start) : 0;
  const fraction = bounds && span > 0 ? Math.min(1, Math.max(0, (position - bounds.start) / span)) : 0;
  const act = (type: Parameters<typeof dockCommand>[1]) => {if (commandAllowed(occupant, type)) onAction(dockCommand(occupant, type));};
  const to = (x: number) => {
    if (!bounds || !track.current || !Number.isFinite(x)) return;
    const command = seekTo(occupant, bounds.start + Math.min(1, Math.max(0, x / track.current)) * span);
    if (command) onAction(command);
  };
  const scrub = Gesture.Pan().enabled(!!bounds && p.capabilities.seek && span > 0).runOnJS(true).minDistance(0)
    .onBegin(event => to(event.x)).onUpdate(event => to(event.x));
  const facts = p.identity.subtitle.map(part => part.text).filter(Boolean).join(' · ');
  const album = (p.album ?? []).map(part => part.text).filter(Boolean).join(' · ');
  const cover = Math.max(160, Math.min(410, wide ? width - QUEUE_WIDTH - 120 : width - 96));
  const column = <View testID={`${testID}-column`} style={{flex: 1, minWidth: 0, alignItems: 'center', paddingHorizontal: 28, paddingTop: wide ? 36 : 20}}>
    {p.artwork ? <Artwork source={p.artwork} width={cover} height={cover} style={{borderRadius: 14}}/> : null}
    <Text numberOfLines={2} accessibilityRole="header" style={[browseType(theme, wide ? 34 : 26, 800, -0.03), {marginTop: 26, textAlign: 'center', color: theme.colors.text}]}>{p.identity.title}</Text>
    {facts ? <Text numberOfLines={1} style={[browseType(theme, 15, 500), {marginTop: 8, textAlign: 'center', color: theme.colors.textSecondary}]}>{facts}</Text> : null}
    {album ? <Text numberOfLines={1} style={[browseType(theme, 13, 500), {marginTop: 4, textAlign: 'center', color: theme.colors.textTertiary}]}>{album}</Text> : null}
    {signal ? <MusicFocusRegion id={`${focus}.signal`} entry="music-signal-line" edges={{down: `${focus}.progress`}} style={{alignSelf: 'center', marginTop: 12}}><MusicSignalLine view={signal} focusRef={signalRef} onPress={() => setPanel('signal')}/></MusicFocusRegion> : null}
    {notice && !theme.isTV ? <View accessibilityLiveRegion="polite" accessibilityRole="alert" testID={`${testID}-notice`} style={{flexDirection: 'row', alignItems: 'center', gap: 8, marginTop: 12, paddingHorizontal: 12, paddingVertical: 7, borderRadius: 10, backgroundColor: 'rgba(7,16,24,.5)'}}>
      <Icon name="i-pause" size={14} color={theme.colors.accentStrong}/>
      <Text style={[browseType(theme, 13, 600), {color: theme.colors.textSecondary}]}>{t(notice)}</Text>
    </View> : null}
    <View style={{width: '100%', maxWidth: 520, marginTop: 24}}>
      {theme.isTV ? <MusicFocusRegion id={`${focus}.progress`} entry="seek" edges={{up: signal ? `${focus}.signal` : undefined, down: `${focus}.transport`}}>
        <TVMusicSeek occupant={occupant} onAction={onAction} enabled={!panel} testID={`${testID}-scrubber`}/>
      </MusicFocusRegion> : <GestureDetector gesture={scrub}><View testID={`${testID}-scrubber`} accessibilityRole="adjustable" accessibilityLabel={t('player.queue')}
        accessibilityValue={{min: 0, max: Math.round(span), now: Math.round(Math.max(0, Math.min(span, position - (bounds?.start ?? 0))))}}
        onLayout={event => {track.current = event.nativeEvent.layout.width;}}
        style={{height: 28, justifyContent: 'center'}}>
        <View style={{height: 4, borderRadius: 2, backgroundColor: 'rgba(237,245,250,.18)'}}>
          <View style={{width: `${fraction * 100}%`, height: 4, borderRadius: 2, backgroundColor: theme.colors.accentStrong}}/>
        </View>
      </View></GestureDetector>}
      <View style={{flexDirection: 'row', justifyContent: 'space-between', marginTop: 2}}>
        <Text style={[browseType(theme, 12.5, 600), {color: theme.colors.textSecondary, fontVariant: ['tabular-nums']}]}>{clockText(Math.max(0, position - (bounds?.start ?? 0)))}</Text>
        <Text style={[browseType(theme, 12.5, 600), {color: theme.colors.textTertiary, fontVariant: ['tabular-nums']}]}>{clockText(span || p.durationSeconds)}</Text>
      </View>
    </View>
    <MusicFocusRegion id={`${focus}.transport`} entry="toggle" orientation="horizontal" edges={{up: `${focus}.progress`}} style={{flexDirection: 'row', alignItems: 'center', gap: 28, marginTop: 20}}>
      <Button testID={`${testID}-previous`} variant="glass" iconOnly icon="i-prev" accessibilityLabel={t('player.previous')}
        disabled={!p.capabilities.previous} onPress={() => act('previous')}/>
      <Button focusId={theme.isTV ? 'toggle' : undefined} testID={`${testID}-toggle`} variant="primary" iconOnly icon={playback.playing ? 'i-pause' : 'i-play'}
        accessibilityLabel={t(playback.playing ? 'action.pause' : 'action.play')}
        disabled={playback.playing ? !p.capabilities.pause : !p.capabilities.play} onPress={() => act(playback.playing ? 'pause' : 'play')}/>
      <Button testID={`${testID}-next`} variant="glass" iconOnly icon="i-next" accessibilityLabel={t('player.next')}
        disabled={!p.capabilities.next} onPress={() => act('next')}/>
    </MusicFocusRegion>
    <View style={{flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 12, marginTop: 26, marginBottom: 24}}>
      {!side && queue ? <Button testID={`${testID}-queue-toggle`} variant={sheet === 'queue' ? 'primary' : 'glass'} size="small" icon="i-queue"
        accessibilityState={{expanded: sheet === 'queue'}} onPress={() => setSheet(open => open === 'queue' ? null : 'queue')}>{t('player.queue')}</Button> : null}
      {!side && lyrics ? <Button testID={`${testID}-lyrics-toggle`} variant={sheet === 'lyrics' ? 'primary' : 'glass'} size="small" icon="i-cc"
        accessibilityState={{expanded: sheet === 'lyrics'}} onPress={() => setSheet(open => open === 'lyrics' ? null : 'lyrics')}>{t('player.lyrics')}</Button> : null}
      {equalizer.supported ? <Button testID={`${testID}-equalizer`} variant="glass" size="small" icon="i-gauge" accessibilityLabel={t('next.media.eq.title')}
        onPress={() => setPanel('eq')}>{t('next.media.eq.title')}</Button> : null}
      <Button testID={`${testID}-close`} variant="glass" size="small" icon="i-down" accessibilityLabel={t('player.minimize')} onPress={onClose}>{t('action.close')}</Button>
    </View>
    {!side && sheet ? <View style={{width: '100%', maxWidth: 560, height: Math.max(280, Math.round(height * .42)), borderRadius: 16, overflow: 'hidden', backgroundColor: 'rgba(237,245,250,.06)'}}>
      {sheet === 'lyrics' && lyrics ? lyrics : queue ? <NowPlayingQueue testID={`${testID}-queue`} view={queue} onPlay={onQueuePlay} artwork={theme.isTV ? artwork : undefined}/> : null}
    </View> : null}
  </View>;
  return <TVMusicFocus id={focus} visible={!panel} entry="toggle" onClose={onClose}><View testID={testID} style={{position: 'absolute', inset: 0, backgroundColor: theme.colors.ink}}>
    {p.ambient ? <View pointerEvents="none" style={{position: 'absolute', top: 0, left: 0, right: 0, height: Math.min(height, 720), overflow: 'hidden'}}>
      <AmbientArt source={p.ambient} treatment="title" style={{position: 'absolute', inset: 0}}/>
      <View style={{position: 'absolute', inset: 0, backgroundColor: 'rgba(7,16,24,.5)'}}/>
    </View> : null}
    <View style={{flex: 1, paddingTop: topInset, paddingBottom: bottomInset}}>
      {panel === 'signal' && signal ? <View style={{position: 'absolute', inset: 0, zIndex: 30}}><MusicSignalSheet view={signal} onClose={closePanel} contextTitle={p.identity.title} returnFocusRef={signalRef}/></View> : null}
      {panel === 'eq' ? <View style={{position: 'absolute', inset: 0, zIndex: 30, backgroundColor: theme.colors.ink}}>
        <NativeWatchEqualizer onBack={closePanel} copy={equalizerCopy()} reportError={reportError} store={nativeEqualizer}/>
      </View> : null}
      {side ? <View style={{flex: 1, flexDirection: 'row'}}>
        <ScrollView contentContainerStyle={{flexGrow: 1, justifyContent: 'center'}} style={{flex: 1, minWidth: 0}} showsVerticalScrollIndicator={false}>{column}</ScrollView>
        <View style={{width: QUEUE_WIDTH, borderLeftWidth: 1, borderLeftColor: theme.colors.line, backgroundColor: 'rgba(9,19,27,.66)'}}>
          <View style={{flexDirection: 'row', alignItems: 'center', gap: 10, paddingHorizontal: 14, paddingTop: 20, paddingBottom: 6}}>
            {queue && lyrics ? <>
              <Button testID={`${testID}-tab-queue`} variant={panelTab === 'queue' ? 'primary' : 'glass'} size="small" icon="i-queue"
                onPress={() => setPanelTab('queue')}>{t('player.queue')}</Button>
              <Button testID={`${testID}-tab-lyrics`} variant={panelTab === 'lyrics' ? 'primary' : 'glass'} size="small" icon="i-cc"
                onPress={() => setPanelTab('lyrics')}>{t('player.lyrics')}</Button>
            </> : <View style={{flexDirection: 'row', alignItems: 'center', gap: 10}}>
              <Icon name={lyrics ? 'i-cc' : 'i-queue'} size={20} color={theme.colors.textSecondary}/>
              <Text style={[browseType(theme, 20, 800, -0.02), {color: theme.colors.text}]}>{t(lyrics ? 'player.lyrics' : 'player.queue')}</Text>
            </View>}
          </View>
          {queue && lyrics && panelTab === 'lyrics' && lyrics ? lyrics : queue ? <NowPlayingQueue testID={`${testID}-queue`} view={queue} onPlay={onQueuePlay} artwork={theme.isTV ? artwork : undefined}/> : lyrics}
        </View>
      </View> : <ScrollView contentContainerStyle={{flexGrow: 1}} showsVerticalScrollIndicator={false}>{column}</ScrollView>}
    </View>
    {theme.isTV && notice && <NativeListeningNotice notice={notice} persistent/>}
  </View></TVMusicFocus>;
}
