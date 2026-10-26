import React, {createContext, useCallback, useContext, useEffect, useId, useLayoutEffect, useMemo, useRef, useState} from 'react';
import {BackHandler, ScrollView, Text, View} from 'react-native';
import {Gesture, GestureDetector} from 'react-native-gesture-handler';
import Animated, {runOnJS, useAnimatedStyle, useSharedValue} from 'react-native-reanimated';
import type {QueuePlaybackView} from '../../../../../../packages/client-core/src/queue-controller';
import type {V1QueueEditIntent, V1QueuePolicyIntent} from '../../../../../../packages/client-core/src/playback-v1/v1-queue-player';
import type {PlaybackFence} from '../../../../../../packages/player-core/src';
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
import {GestureCommitScope} from '../../../kit/controls/gesture-commit';
import {Icon} from '../../../kit/Icon';
import {useTheme} from '../../../kit/theme';
import {ListeningGroup, useListeningCoverSlot, useListeningPageOwner, useListeningPageHeight, useListeningPagePresent, useListeningPaintPermit, useListeningPageStyle} from '../../../kit/dock/ListeningCoverBridge';
import {browseType} from '../../../kit/browse/presentation';
import {commandAllowed, dockCommand, playbackPosition, seekBounds, seekTo} from '../../../kit/dock/model';
import type {DockCommand, DockOccupant} from '../../../kit/dock/types';
import {NowPlayingQueue, nowPlayingQueueEntry, nowPlayingQueueWindow} from './NowPlayingQueue';
import {ListeningSongActions, ListeningFavoritePaint, listeningSongFavorite} from './ListeningSongActions';
import {MusicFocusRegion, TVMusicFocus, TVMusicSeek} from './TVMusicFocus';
import {NativeListeningNotice} from './ListeningNotice';
import {TVNowPlayingScreen} from './TVNowPlayingScreen';
import type {NativeListeningQueuePolicy} from '../../../shell/listening-queue-policy';
import type {NativePlaybackReadLifetime} from '../../../platform/playback/types';
import type {NativeListeningSong} from '../../../shell/listening-song-detail';
import {RetainedOverlay} from '../../../kit/overlays/SurfacePaintHost';
import {usePublishedPlayerMorph} from '../../../kit/dock/PlayerMorphBridge';
import {useOverlayPaintMode} from '../../../kit/overlays/OverlayPaintContext';
import {NowPlayingLyrics} from './NowPlayingLyrics';
import {useTVPanelPresence} from '../../../kit/overlays/TVPanelMotion';

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
  /** TV presentation only; no extra listening session or command lifetime. */
  tvOpen?: boolean;
  /** A single pure backdrop is hosted beside the persistent player on touch. */
  backgroundHosted?: boolean;
  onTVExited?: () => void;
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
  /** The touch opening-and-route lease both guarded controls borrow; TV's own hook owns one. */
  policyLifetime?: NativePlaybackReadLifetime;
  /** A retained Try again for the failed output this screen drew, through the adapter's retry port. */
  retry?: Readonly<{enabled: boolean; run: (fence: PlaybackFence) => void}>;
  /** The real Play on controller, opened only for the output and page this screen drew. */
  playOn?: Readonly<{enabled: boolean; open: (fence: PlaybackFence) => void}>;
  /** The guarded queue edit for loaded upcoming rows, bound to the fence this screen drew. */
  queueEdit?: Readonly<{enabled: boolean; lease?: object; apply: (fence: PlaybackFence, intent: V1QueueEditIntent, queueId: string, expectedRevision: string) => void}>;
  /** The current song's issued Detail token and its one favorite ticket; touch only. */
  song?: Readonly<{token?: NativeListeningSong; pending: boolean; favorite: (token: NativeListeningSong, value: boolean) => void}>;
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
const ListeningChromeGate = createContext(false);
const listeningPaintTypes = [ListeningSurface, ListeningSwipeArea, ListeningColumn, ListeningPageBackground, ListeningGroup, MusicFocusRegion, MusicSignalLine, MusicSignalSheet, ListeningFavoritePaint, View, Text, ScrollView, Artwork, AmbientArt, Button, Icon, React.Fragment];
const listeningPaintOmissions = [GestureDetector, NowPlayingQueue, NowPlayingLyrics, ListeningSongActions, NativeWatchEqualizer];

export function NowPlayingScreen(props: NowPlayingScreenProps) {
  const theme = useTheme();
  return theme.isTV ? <TVNowPlayingScreen {...props} equalizerCopy={equalizerCopy()}/> : <TouchNowPlayingScreen {...props}/>;
}

/** This retained snapshot is paint only; the host's live adapters remain authoritative. */
export function TVListeningRoute({value, scope, onPresenceChange}: {value?: NowPlayingScreenProps; scope: string; onPresenceChange?: (present: boolean) => void}) {
  const presence = useTVPanelPresence(value, scope);
  const present = presence.value !== undefined, report = useRef(onPresenceChange);
  report.current = onPresenceChange;
  useLayoutEffect(() => {onPresenceChange?.(present);}, [onPresenceChange, present]);
  useLayoutEffect(() => () => report.current?.(false), []);
  return presence.value ? <NowPlayingScreen {...presence.value} tvOpen={presence.open} onTVExited={presence.exited}/> : null;
}

function TouchNowPlayingScreen({occupant, queue, artwork, width, height, topInset = 0, bottomInset = 0, backgroundHosted = false, onAction, onQueuePlay, queuePolicy, policyLifetime, retry, playOn, queueEdit, song, onClose, signal, notice, reportError = () => {}, testID = 'now-playing', lyrics}: NowPlayingScreenProps) {
  const theme = useTheme(), {presentation: p, playback} = occupant;
  const paintPermit = useListeningPaintPermit(playback.fence);
  // Repeat and shuffle are the queue's own facts, and the answer to a change is the server's
  // queue read that follows, never a locally flipped control. A request keeps the exact queue
  // and revision this screen drew, so a queue that moved on refuses it.
  const drawnFence = playback.fence, drawnQueue = queue?.queue, lifetime = policyLifetime;
  // Only the accepted window for exactly this queue and revision may name what the run started
  // from; anything else leaves the line off rather than borrowing an album's own title.
  const drawnWindow = queue ? nowPlayingQueueWindow(queue) : undefined;
  const currentFacts = drawnQueue?.currentEntryId ? nowPlayingQueueEntry(drawnWindow, drawnQueue.currentEntryId) : undefined;
  const currentSegmentId = currentFacts?.available === true ? currentFacts.segmentId : undefined;
  const playingFrom = currentSegmentId ? drawnWindow?.segments.find(segment => segment.id === currentSegmentId && segment.label)?.label : undefined;
  const policyReady = !!drawnQueue && drawnFence.kind === 'queue' && !!lifetime && !!queuePolicy?.canApply(drawnFence);
  const shuffled = !!drawnQueue?.shuffled, repeat = drawnQueue?.repeat ?? 'off';
  // The edit port exists only while the accepted window really matches the drawn queue and
  // names each row once; the pane then asks that same window for a row's own facts.
  const queueEditPort = queueEdit?.enabled && drawnWindow ? {enabled: true, lease: queueEdit.lease, fenceKey: JSON.stringify(playback.fence),
    entry: (entryId: string) => nowPlayingQueueEntry(drawnWindow, entryId),
    apply: (intent: V1QueueEditIntent, queueId: string, expectedRevision: string) => queueEdit.apply(playback.fence, intent, queueId, expectedRevision)} : undefined;
  const changePolicy = (intent: V1QueuePolicyIntent) => {
    if (!policyReady || !drawnQueue || !lifetime || !queuePolicy) return;
    void queuePolicy.apply(drawnFence, {queueId: drawnQueue.id, expectedRevision: drawnQueue.revision, intent}, lifetime).catch(reportError);
  };
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
  // The touch bar previews on the UI thread. The gesture binds at BEGIN to the
  // occupant, bounds and callback this screen was actually drawing, so its own
  // successful lift can only ever invoke those: a successor that arrives mid-drag
  // retires both the paint and the captured pair instead of receiving the seek.
  const travel = useSharedValue(0), paintFraction = useSharedValue(0), dragFraction = useSharedValue<number | null>(null);
  type BeginSeek = Readonly<{occupant: DockOccupant; start: number; span: number; onAction: (command: DockCommand) => void}>;
  const fenceKey = JSON.stringify(occupant.playback.fence ?? null);
  const scopeGeneration = useRef(0);
  const scopes = useRef<Readonly<{key: string; start?: number; end?: number; enabled: boolean; span: number; generation: number; value: GestureCommitScope<BeginSeek>}> | undefined>(undefined);
  const prior = scopes.current;
  if (!prior || prior.key !== fenceKey || prior.start !== bounds?.start || prior.end !== bounds?.end || prior.enabled !== p.capabilities.seek || prior.span !== span) {
    scopes.current = {key: fenceKey, start: bounds?.start, end: bounds?.end, enabled: p.capabilities.seek, span, generation: ++scopeGeneration.current, value: new GestureCommitScope<BeginSeek>()};
  }
  const seekScope = scopes.current!.value, drawnScope = scopes.current!.generation;
  const scopeTicket = useSharedValue(0), activeScope = useSharedValue(0), dragRun = useSharedValue(0), dragTicket = useSharedValue(0), dragArmed = useSharedValue(false);
  useEffect(() => {if (dragFraction.value === null) paintFraction.value = fraction;}, [dragFraction, paintFraction, fraction]);
  useLayoutEffect(() => {
    const ticket = seekScope.activate(); scopeTicket.value = ticket; activeScope.value = drawnScope;
    dragArmed.value = false; dragFraction.value = null;
    return () => {
      if (!seekScope.retire(ticket)) return;
      scopeTicket.value = 0; activeScope.value = 0; dragArmed.value = false; dragFraction.value = null;
    };
  }, [seekScope, drawnScope, activeScope, scopeTicket, dragArmed, dragFraction]);
  const bindSeek = (valid: boolean, ticket: number, run: number) => {
    seekScope.bind(ticket, run, valid && bounds && span > 0 ? {occupant, start: bounds.start, span, onAction} : undefined);
  };
  const commitSeek = (at: number, success: boolean, ticket: number, run: number) => {
    const bound = seekScope.claim(ticket, run);
    if (success !== true || !Number.isFinite(at) || !bound) return;
    const command = seekTo(bound.occupant, bound.start + Math.min(1, Math.max(0, at)) * bound.span);
    if (command) bound.onAction(command);
  };
  const discardBound = (ticket: number, run: number) => {seekScope.discard(ticket, run);};
  const scrub = Gesture.Pan().enabled(!!bounds && p.capabilities.seek && span > 0).minDistance(0)
    .onBegin(event => {
      if (activeScope.value !== drawnScope) return;
      const valid = travel.value > 0 && Number.isFinite(event.x);
      const ticket = scopeTicket.value, run = ++dragRun.value;
      dragTicket.value = ticket;
      runOnJS(bindSeek)(valid, ticket, run);
      dragArmed.value = valid && ticket > 0;
      if (!valid || ticket <= 0) return;
      dragFraction.value = Math.min(1, Math.max(0, event.x / travel.value));
    })
    .onUpdate(event => {
      if (activeScope.value !== drawnScope || !dragArmed.value || dragTicket.value !== scopeTicket.value || !(travel.value > 0) || !Number.isFinite(event.x)) return;
      dragFraction.value = Math.min(1, Math.max(0, event.x / travel.value));
    })
    .onEnd((event, success) => {
      if (activeScope.value !== drawnScope || !dragArmed.value || dragTicket.value !== scopeTicket.value || success !== true || !(travel.value > 0) || !Number.isFinite(event.x)) return;
      dragArmed.value = false;
      runOnJS(commitSeek)(Math.min(1, Math.max(0, event.x / travel.value)), true, dragTicket.value, dragRun.value);
    })
    .onFinalize(() => {if (activeScope.value !== drawnScope) return; dragArmed.value = false; dragFraction.value = null; runOnJS(discardBound)(dragTicket.value, dragRun.value);});
  const fillPaint = useAnimatedStyle(() => {
    const at = dragFraction.value ?? paintFraction.value;
    return {transform: [{translateX: -(1 - at) * travel.value / 2}, {scaleX: at}]};
  });
  const favoritePaint = song ? listeningSongFavorite(song.token, song.pending) : undefined;
  const facts = p.identity.subtitle.map(part => part.text).filter(Boolean).join(' · ');
  const album = (p.album ?? []).map(part => part.text).filter(Boolean).join(' · ');
  const cover = Math.max(160, Math.min(410, wide ? width - QUEUE_WIDTH - 120 : width - 96));
  const column = <ListeningColumn testID={`${testID}-column`} fence={playback.fence} source={p.artwork} playingFrom={playingFrom} cover={cover} wide={wide} height={height}>
    <ListeningSwipeArea fence={playback.fence}><ListeningGroup fence={playback.fence} index={0} height={height}>
    <Text numberOfLines={2} accessibilityRole="header" style={[browseType(theme, wide ? 34 : 26, 800, -0.03), {marginTop: 26, textAlign: 'center', color: theme.colors.text}]}>{p.identity.title}</Text>
    {facts ? <Text numberOfLines={1} style={[browseType(theme, 15, 500), {marginTop: 8, textAlign: 'center', color: theme.colors.textSecondary}]}>{facts}</Text> : null}
    {album ? <Text numberOfLines={1} style={[browseType(theme, 13, 500), {marginTop: 4, textAlign: 'center', color: theme.colors.textTertiary}]}>{album}</Text> : null}
    {favoritePaint ? <ListeningFavoritePaint {...favoritePaint} onPress={() => {if (song?.token) song.favorite(song.token, !favoritePaint.favorite);}}/> : null}
    {signal ? <MusicFocusRegion id={`${focus}.signal`} entry="music-signal-line" edges={{down: `${focus}.progress`}} style={{alignSelf: 'center', marginTop: 12}}><MusicSignalLine view={signal} focusRef={theme.isTV ? signalRef : undefined} onPress={() => setPanel('signal')}/></MusicFocusRegion> : null}
    {retry?.enabled ? <View style={{marginTop: 16}}><Button testID={`${testID}-retry`} variant="primary" icon="i-retry"
      onPress={() => retry.run(playback.fence)}>{t('next.states.tryAgain')}</Button></View> : null}
    </ListeningGroup></ListeningSwipeArea>
    <ListeningGroup fence={playback.fence} index={1} height={height}>
    <View style={{width: '100%', maxWidth: 520, marginTop: 24}}>
      {theme.isTV ? <MusicFocusRegion id={`${focus}.progress`} entry="seek" edges={{up: signal ? `${focus}.signal` : undefined, down: `${focus}.transport`}}>
        <TVMusicSeek occupant={occupant} onAction={onAction} enabled={!panel} testID={`${testID}-scrubber`}/>
      </MusicFocusRegion> : <GestureDetector gesture={scrub}><View testID={`${testID}-scrubber`} accessibilityRole="adjustable" accessibilityLabel={t('player.queue')}
        accessibilityValue={{min: 0, max: Math.round(span), now: Math.round(Math.max(0, Math.min(span, position - (bounds?.start ?? 0))))}}
        onLayout={event => {track.current = event.nativeEvent.layout.width; travel.value = event.nativeEvent.layout.width;}}
        style={{height: 28, justifyContent: 'center'}}>
        <View style={{height: 4, borderRadius: 2, backgroundColor: 'rgba(237,245,250,.18)'}}>
          <Animated.View style={[{position: 'absolute', top: 0, bottom: 0, left: 0, right: 0, borderRadius: 2, backgroundColor: theme.colors.accentStrong}, fillPaint]}/>
        </View>
      </View></GestureDetector>}
      <View style={{flexDirection: 'row', justifyContent: 'space-between', marginTop: 2}}>
        <Text style={[browseType(theme, 12.5, 600), {color: theme.colors.textSecondary, fontVariant: ['tabular-nums']}]}>{clockText(Math.max(0, position - (bounds?.start ?? 0)))}</Text>
        <Text style={[browseType(theme, 12.5, 600), {color: theme.colors.textTertiary, fontVariant: ['tabular-nums']}]}>{clockText(span || p.durationSeconds)}</Text>
      </View>
    </View>
    <MusicFocusRegion id={`${focus}.transport`} entry="toggle" orientation="horizontal" edges={{up: `${focus}.progress`}} style={{flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: policyReady ? 12 : 28, marginTop: 20}}>
      {policyReady ? <Button testID={`${testID}-shuffle`} variant={shuffled ? 'primary' : 'glass'} iconOnly icon="i-shuffle"
        accessibilityLabel={t('next.dock.shuffle')} accessibilityState={{selected: shuffled}} onPress={() => changePolicy({action: 'shuffle', shuffled: !shuffled})}/> : null}
      <Button testID={`${testID}-previous`} variant="glass" iconOnly icon="i-prev" accessibilityLabel={t('player.previous')}
        disabled={!p.capabilities.previous} onPress={() => act('previous')}/>
      <Button focusId={theme.isTV ? 'toggle' : undefined} testID={`${testID}-toggle`} variant="primary" iconOnly icon={playback.playing ? 'i-pause' : 'i-play'}
        accessibilityLabel={t(playback.playing ? 'action.pause' : 'action.play')}
        disabled={playback.playing ? !p.capabilities.pause : !p.capabilities.play} onPress={() => act(playback.playing ? 'pause' : 'play')}/>
      <Button testID={`${testID}-next`} variant="glass" iconOnly icon="i-next" accessibilityLabel={t('player.next')}
        disabled={!p.capabilities.next} onPress={() => act('next')}/>
      {policyReady ? <Button testID={`${testID}-repeat`} variant={repeat === 'off' ? 'glass' : 'primary'} iconOnly icon="i-repeat"
        accessibilityLabel={t(repeat === 'off' ? 'next.dock.repeatOff' : repeat === 'all' ? 'next.dock.repeatAll' : 'next.dock.repeatOne')}
        accessibilityState={{selected: repeat !== 'off'}} onPress={() => changePolicy({action: 'repeat', repeat: repeat === 'off' ? 'all' : repeat === 'all' ? 'one' : 'off'})}/> : null}
    </MusicFocusRegion>
    </ListeningGroup>
    <ListeningGroup fence={playback.fence} index={2} height={height}>
    {notice && !theme.isTV ? <View accessibilityLiveRegion="polite" accessibilityRole="alert" testID={`${testID}-notice`} style={{flexDirection: 'row', alignItems: 'center', gap: 8, marginTop: 14, paddingHorizontal: 12, paddingVertical: 7, borderRadius: 10, backgroundColor: 'rgba(7,16,24,.5)'}}>
      <Icon name="i-pause" size={14} color={theme.colors.accentStrong}/>
      <Text style={[browseType(theme, 13, 600), {color: theme.colors.textSecondary}]}>{t(notice)}</Text>
    </View> : null}
    <View style={{flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 12, marginTop: 26, marginBottom: 24}}>
      {!side && queue ? <Button testID={`${testID}-queue-toggle`} variant={sheet === 'queue' ? 'primary' : 'glass'} size="small" icon="i-queue"
        accessibilityState={{expanded: sheet === 'queue'}} onPress={() => setSheet(open => open === 'queue' ? null : 'queue')}>{t('player.queue')}</Button> : null}
      {!side && lyrics ? <Button testID={`${testID}-lyrics-toggle`} variant={sheet === 'lyrics' ? 'primary' : 'glass'} size="small" icon="i-cc"
        accessibilityState={{expanded: sheet === 'lyrics'}} onPress={() => setSheet(open => open === 'lyrics' ? null : 'lyrics')}>{t('player.lyrics')}</Button> : null}
      {playOn?.enabled ? <Button testID={`${testID}-play-on`} variant="glass" size="small" icon="i-cast" accessibilityLabel={t('player.playOn')}
        onPress={() => playOn.open(playback.fence)}>{t('device.thisDevice')}</Button> : null}
      {equalizer.supported ? <Button testID={`${testID}-equalizer`} variant="glass" size="small" icon="i-gauge" accessibilityLabel={t('next.media.eq.title')}
        onPress={() => setPanel('eq')}>{t('next.media.eq.title')}</Button> : null}
      <Button testID={`${testID}-close`} variant="glass" size="small" icon="i-down" accessibilityLabel={t('player.minimize')} onPress={onClose}>{t('action.close')}</Button>
    </View>
    {!side && sheet ? <View style={{width: '100%', maxWidth: 560, height: Math.max(280, Math.round(height * .42)), borderRadius: 16, overflow: 'hidden', backgroundColor: 'rgba(237,245,250,.06)'}}>
      {sheet === 'lyrics' && lyrics ? lyrics : queue ? <NowPlayingQueue testID={`${testID}-queue`} view={queue} onPlay={onQueuePlay} artwork={artwork} queueEdit={queueEditPort}/> : null}
    </View> : null}
    </ListeningGroup>
  </ListeningColumn>;
  return <TVMusicFocus id={focus} visible={!panel} entry="toggle" onClose={onClose}><RetainedOverlay permit={paintPermit} allowedTypes={listeningPaintTypes} omitTypes={listeningPaintOmissions}><ListeningSurface fence={playback.fence} testID={testID} blocked={!!panel || !!sheet}>
    {!backgroundHosted && <ListeningPageBackground fence={playback.fence} height={height} ambient={p.ambient}/>}
    <View style={{flex: 1, paddingTop: topInset, paddingBottom: bottomInset}}>
      {panel === 'signal' && signal ? <View style={{position: 'absolute', inset: 0, zIndex: 30}}><MusicSignalSheet view={signal} onClose={closePanel} contextTitle={p.identity.title} returnFocusRef={signalRef}/></View> : null}
      {panel === 'eq' ? <View style={{position: 'absolute', inset: 0, zIndex: 30, backgroundColor: theme.colors.ink}}>
        <NativeWatchEqualizer onBack={closePanel} copy={equalizerCopy()} reportError={reportError} store={nativeEqualizer}/>
      </View> : null}
      {side ? <View style={{flex: 1, flexDirection: 'row'}}>
        {column}
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
          {queue && lyrics && panelTab === 'lyrics' && lyrics ? lyrics : queue ? <NowPlayingQueue testID={`${testID}-queue`} view={queue} onPlay={onQueuePlay} artwork={artwork} queueEdit={queueEditPort}/> : lyrics}
        </View>
      </View> : column}
    </View>
    {theme.isTV && notice && <NativeListeningNotice notice={notice} persistent/>}
  </ListeningSurface></RetainedOverlay></TVMusicFocus>;
}


function ListeningColumn({fence, source, playingFrom, cover, wide, height, measureOnly = false, testID, children}: {
  fence: PlaybackFence; source: DockOccupant['presentation']['artwork']; playingFrom?: string; cover: number; wide: boolean; height: number;
  measureOnly?: boolean; testID?: string; children?: React.ReactNode;
}) {
  const theme = useTheme(), coverSlot = useRef<View>(null);
  const gesture = useListeningChromeGesture(fence, measureOnly);
  const present = useListeningPagePresent(fence);
  const sharedCover = useListeningCoverSlot(fence, 'full', coverSlot, !measureOnly || !present);
  return <ScrollView onScroll={sharedCover.measure} scrollEventThrottle={16} pointerEvents={measureOnly ? 'none' : 'auto'}
    contentContainerStyle={{flexGrow: 1, ...(wide ? {justifyContent: 'center' as const} : {})}}
    style={{flex: 1, minWidth: 0, ...(measureOnly ? {opacity: 0} : {})}} showsVerticalScrollIndicator={false}>
    <View testID={testID} style={{flex: 1, minWidth: 0, alignItems: 'center', paddingHorizontal: 28, paddingTop: wide ? 36 : 20}}>
      {playingFrom ? <ListeningGroup fence={fence} index={0} height={height}><Text numberOfLines={1} style={[browseType(theme, 13, 600), {marginBottom: 14, textAlign: 'center', color: theme.colors.textSecondary}]}>{t('next.music.playingFrom', {source: playingFrom})}</Text></ListeningGroup> : null}
      {source ? <ListeningCoverTarget gesture={gesture} slot={coverSlot} onLayout={sharedCover.measure} size={cover}>
        {!measureOnly && <Animated.View style={sharedCover.style}><Artwork source={source} width={cover} height={cover} style={{borderRadius: 14}}/></Animated.View>}
      </ListeningCoverTarget> : null}
      {children}
    </View>
  </ScrollView>;
}
export function ListeningPageBackground({fence, height, ambient, fallbackVisible = true}: {fallbackVisible?: boolean; fence: PlaybackFence; height: number; ambient: DockOccupant['presentation']['ambient']}) {
  const theme = useTheme(), reportHeight = useListeningPageHeight(), style = useListeningPageStyle(fence, height, fallbackVisible);
  return <Animated.View pointerEvents="none" accessible={false} accessibilityElementsHidden importantForAccessibility="no-hide-descendants" onLayout={event => reportHeight(event.nativeEvent.layout.height)}
    style={[{position: 'absolute', inset: 0, backgroundColor: theme.colors.ink, zIndex: theme.layers.player + 1}, style]}>
    {ambient ? <View style={{position: 'absolute', top: 0, left: 0, right: 0, height: Math.min(height, 720), overflow: 'hidden'}}>
      <AmbientArt source={ambient} treatment="title" style={{position: 'absolute', inset: 0}}/>
      <View style={{position: 'absolute', inset: 0, backgroundColor: 'rgba(7,16,24,.5)'}}/>
    </View> : null}
  </Animated.View>;
}
/** Paint only from the admitted mini descriptor. No full screen, queue/lyrics,
 * song read, guarded callback, controller or output is created by this preview. */
export function ListeningPagePreview({occupant, queue, width, height, topInset, bottomInset}: {
  occupant: DockOccupant; queue?: QueuePlaybackView; width: number; height: number; topInset: number; bottomInset: number;
}) {
  const present = useListeningPagePresent(occupant.playback.fence);
  const wide = width >= SIDE_BY_SIDE, side = wide && !!queue;
  const window = queue ? nowPlayingQueueWindow(queue) : undefined;
  const current = queue?.queue?.currentEntryId ? nowPlayingQueueEntry(window, queue.queue.currentEntryId) : undefined;
  const segment = current?.available === true ? window?.segments.find(value => value.id === current.segmentId && value.label)?.label : undefined;
  const cover = Math.max(160, Math.min(410, wide ? width - QUEUE_WIDTH - 120 : width - 96));
  return <View pointerEvents="none" accessible={false} accessibilityElementsHidden importantForAccessibility="no-hide-descendants" style={{position: 'absolute', inset: 0, opacity: present ? 0 : 1}}>
    <View style={{flex: 1, paddingTop: topInset, paddingBottom: bottomInset, flexDirection: side ? 'row' : 'column'}}>
      <ListeningColumn fence={occupant.playback.fence} source={occupant.presentation.artwork} playingFrom={segment} cover={cover} wide={wide} height={height} measureOnly/>
      {side && <View style={{width: QUEUE_WIDTH}}/>}
    </View>
  </View>;
}


/** Only static audited UI outlives its publisher. This root owns no reader,
 * command, playback lease, queue or song controller. */
function ListeningSurface({fence, testID, children, blocked = false}: {fence: PlaybackFence; testID?: string; children: React.ReactNode; blocked?: boolean}) {
  const mode = useOverlayPaintMode(), theme = useTheme();
  useListeningPageOwner(fence);
  if (!mode.visible) return null;
  return <ListeningChromeGate.Provider value={blocked}><View testID={testID} pointerEvents={mode.interactive ? 'box-none' : 'none'} accessible={false}
    accessibilityElementsHidden={!mode.interactive} importantForAccessibility={mode.interactive ? 'auto' : 'no-hide-descendants'}
    style={{position: 'absolute', inset: 0, zIndex: theme.layers.player}}>{children}</View></ListeningChromeGate.Provider>;
}


/** The cover is the physical swipe target, leaving queue/lyrics scrolling and
 * the scrubber to their original recognisers. Every target has its own handler. */
function ListeningCoverTarget({gesture, slot, onLayout, size, children}: {gesture?: ReturnType<NonNullable<ReturnType<typeof usePublishedPlayerMorph>>['chromeGesture']>; slot: React.RefObject<View | null>; onLayout: () => void; size: number; children: React.ReactNode}) {
  const view = <View ref={slot} collapsable={false} onLayout={onLayout} style={{width: size, height: size}}>{children}</View>;
  return gesture ? <GestureDetector gesture={gesture}>{view}</GestureDetector> : view;
}


function useListeningChromeGesture(fence: PlaybackFence, disabled: boolean) {
  const blocked = useContext(ListeningChromeGate), mode = useOverlayPaintMode();
  const controller = usePublishedPlayerMorph(fence), current = useSharedValue(false), permit = useListeningPaintPermit(fence);
  const allowed = !disabled && !blocked && mode.interactive;
  useLayoutEffect(() => {current.value = allowed; return () => {current.value = false;};}, [current, allowed]);
  return useMemo(() => controller?.chromeGesture(allowed, current, permit?.current), [controller, allowed, current, permit]);
}
function ListeningSwipeArea({fence, children}: {fence: PlaybackFence; children: React.ReactNode}) {
  const gesture = useListeningChromeGesture(fence, false);
  const view = <View style={{width: '100%', alignItems: 'center'}}>{children}</View>;
  return gesture ? <GestureDetector gesture={gesture}>{view}</GestureDetector> : view;
}
