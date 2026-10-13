import {Lyrics} from './Lyrics';
import {FeedbackSheet} from '../screens/Notifications';
import {DestinationSheet} from './Destinations';
import React, {useCallback, useEffect, useRef, useState, useSyncExternalStore} from 'react';

const noSubscribe = () => () => {};
/** The volume slider needs a native build that has it; older builds simply don't show one. */
const hasVolumeView = !!(UIManager as {hasViewManagerConfig?: (name: string) => boolean}).hasViewManagerConfig?.('PorticoVolumeView');
const noSnapshot = () => null;
import {BackHandler, NativeEventEmitter, NativeModules, Pressable, StyleSheet, TVFocusGuideView, UIManager, View, useTVEventHandler} from 'react-native';
import {useSafeAreaInsets} from 'react-native-safe-area-context';
import Svg, {Defs, LinearGradient, Rect, Stop} from 'react-native-svg';
import Animated, {Easing, useAnimatedStyle, useSharedValue, withTiming} from 'react-native-reanimated';
import {NativePlayer, VolumeSlider} from '../bridge/NativeViews';
import {useI18n} from '../app/i18n';
import {say} from '../app/errors';
import {useSystemMedia, systemPosterPath, type SystemMediaCommand} from '../bridge/NativeSystemMedia';
import {useArtwork} from '../app/content';
import {Artwork, Button, Icon, StateView, Text, showToast, useTheme, type FocusableHandle} from '../ui';
import {Timeline} from './Timeline';
import {PostPlay} from './PostPlay';
import {SkipPrompt, usePlayerMarkers, type SkipMode} from './SkipPrompt';
import {useSession} from '../app/session';
import {useServerPreferences} from '../app/server-preferences';
import type {PlayerEngine} from './usePlayer';
import {useCurrentActivity} from '../bridge/NativeActivity';
import {PlayerOptions, QueueToggle, optionBoxesFor, upcomingEntries, type OptionAnchor, type OptionKey} from './PlayerOptions';
import {scrubTarget, useSiriRemoteTouch} from '../bridge/NativeSiriRemote';
import {activeI18n} from '../app/errors';
import {GroupPill} from './GroupPill';
import {endedCopy} from './ended-copy';
import {cannotPlayReason} from './cannot-play';
import {failureFor} from './failure-facts';
import {word} from '../app/new-words';
import {canStepChannel, channelStep, tunedChannel} from './channel-lineup';
import {MiniGuideSheet, currentLiveProgramme} from './MiniGuide';
import {useDVRClient} from '../app/dvr';
import {defaultRecordingOptions} from '../../../../packages/client-core/src/dvr';
import {channelTimeline} from '../../../../packages/client-core/src/playback/channel-timeline';
import {formatBehindSec, isBehindLive, programmeRangeLabel} from '../../../../packages/client-core/src/presentation/index';


/**
 * Full-screen player chrome over the native video surface. Visible controls
 * sit on localized shadows that fade into the picture; chrome hides after a
 * few seconds of playback and returns on any input. Pause/Play is the only
 * filled control. Five option boxes open one bounded sheet each.
 */
export function VideoPlayer({engine}: {engine: PlayerEngine}) {
  const {colors, space, metrics, isTV, window, motion} = useTheme();
  const insets = useSafeAreaInsets();
  const artwork = useArtwork();
  const {state, identity, isAudio} = engine;
  // Music moves by track, not by seconds: no 10/30-second skip and no Speed (an audiobook keeps both).
  const isMusic = identity.kind === 'song';
  const episodeLine = identity.kind === 'episode' && identity.seriesTitle ? [identity.seriesTitle, identity.episodeCode].filter(Boolean).join(' · ') : undefined;
  // Shuffle and repeat are for listening; on television a film or episode never shows them.
  const queueModes = !state.channel && (isAudio || !isTV);
  const prefs = useServerPreferences();
  const skipBack = prefs.value<number>('playback.skipBackSeconds', 10);
  const skipForward = prefs.value<number>('playback.skipForwardSeconds', 30);
  const skipModes: Record<string, SkipMode> = {intro: prefs.value('playback.introSkip', 'ask'), credits: prefs.value('playback.creditsSkip', 'ask'), recap: prefs.value('playback.recapSkip', 'ask'), outro: prefs.value('playback.creditsSkip', 'ask'), commercial: 'ask'};
  const {api, session} = useSession();
  const i18n = useI18n();
  const markers = usePlayerMarkers(engine.service, api, session, identity.libraryId, state.channel ? undefined : state.itemId, state.session?.id);
  const [chrome, setChrome] = useState(true);
  const [option, setOptionNow] = useState<OptionKey | null>(null);
  const [anchor, setAnchor] = useState<OptionAnchor>();
  const [fromMenu, setFromMenu] = useState(false);
  // TV: Menu (or a choice) closes the panel and focus returns to the box that opened it.
  const boxes = useRef(new Map<OptionKey, FocusableHandle | null>());
  const opener = useRef<OptionKey | null>(null);
  const optionRef = useRef<OptionKey | null>(null);
  optionRef.current = option;
  // QA: the focus return is cancelled if the player closes first.
  const focusReturn = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  useEffect(() => () => clearTimeout(focusReturn.current), []);
  const setOption = useCallback((next: OptionKey | null) => {
    const prev = optionRef.current;
    if (next === null && isTV && opener.current) {
      const box = boxes.current.get(opener.current);
      clearTimeout(focusReturn.current);
      focusReturn.current = setTimeout(() => box?.focus(), 60);
    }
    if (next !== null && prev === null) opener.current = next;
    setFromMenu(next !== null && (prev === 'menu' || (prev !== null && fromMenuRef.current)));
    optionRef.current = next;
    setOptionNow(next);
  }, [isTV]);
  const fromMenuRef = useRef(false);
  fromMenuRef.current = fromMenu;
  const openFrom = (key: OptionKey, node: FocusableHandle | null | undefined) => {
    const view = node?.node?.();
    if (view && !isTV) view.measureInWindow((x, y, width, height) => { setAnchor({x, y, width, height}); setOption(key); });
    else { setAnchor(undefined); setOption(key); }
  };
  const [report, setReport] = useState(false);
  const [destinations, setDestinations] = useState(false);
  const [timelineFocused, setTimelineFocused] = useState(false);
  /* MU4 FEAT-07: the mini guide overlay and the in-player Record action (options menu only). */
  const [guideOpen, setGuideOpen] = useState(false);
  const dvr = useDVRClient();
  const tuned = state.channel ? tunedChannel() : undefined;
  const liveProgramme = tuned ? currentLiveProgramme(tuned) : null;
  const canRecordLive = !!state.channel && !!dvr && !!tuned && tuned.recordAvailable && !!liveProgramme;
  const recordLive = () => {
    if (!dvr || !tuned || !tuned.recordAvailable || !liveProgramme) { showToast({message: i18n.t('guide.cantRecord'), icon: 'warning'}); return; }
    void dvr.schedule({channel: tuned, programme: liveProgramme, series: false}, defaultRecordingOptions)
      .then(() => showToast({message: i18n.t('guide.recordedShortcut', {title: liveProgramme.title}), icon: 'dvr'}),
        e => showToast({message: say(e, 'live', 'save'), icon: 'warning'}));
  };
  const timeBare = (ms: number) => {
    try {
      const parts = new Intl.DateTimeFormat(i18n.locale, {hour: 'numeric', minute: '2-digit'}).formatToParts(new Date(ms));
      return parts.filter(p => p.type !== 'dayPeriod').map(p => p.value).join('').replace(/\s+/g, ' ').trim() || i18n.time(ms);
    } catch { return i18n.time(ms); }
  };
  const liveBehindSec = state.linear ? channelTimeline(state.linear, state.positionSeconds).behind : 0;
  const liveProgrammeLabel = state.linear?.programme ? programmeRangeLabel(state.linear.programme.startMs, state.linear.programme.endMs, (ms, meridiem) => (meridiem ? i18n.time(ms) : timeBare(ms))) : undefined;
  const liveBehindLabel = isBehindLive(liveBehindSec) ? i18n.t('player.live.behindLive', {duration: formatBehindSec(liveBehindSec)}) : undefined;
  const inactivity = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const playing = state.intent === 'playing' && state.phase === 'ready';
  const playingRef = useRef(playing);
  playingRef.current = playing;
  const reveal = useCallback(() => {
    setChrome(true);
    if (inactivity.current) clearTimeout(inactivity.current);
    // IOS-PLAYER-01: paused controls stay up until playback resumes.
    if (!playingRef.current) return;
    inactivity.current = setTimeout(() => {
      if (!option) setChrome(false);
    }, 4000);
  }, [option]);
  useEffect(() => {
    if (playing && !option && !isAudio) reveal();
    else {
      setChrome(true);
      if (inactivity.current) clearTimeout(inactivity.current);
    }
    return () => {
      if (inactivity.current) clearTimeout(inactivity.current);
    };
  }, [playing, option, isAudio, reveal]);
  // Television: Menu hides chrome first, then leaves the player (audio keeps
  // playing in the shell's now-playing pill; video stops).
  useEffect(() => {
    const sub = BackHandler.addEventListener('hardwareBackPress', () => {
      if (option) {
        setOption(null);
        return true;
      }
      if (isTV && chrome && playing) {
        setChrome(false);
        return true;
      }
      if (isAudio) engine.collapse();
      else engine.leave();
      return true;
    });
    return () => sub.remove();
  }, [option, chrome, playing, isTV, isAudio, engine, setOption]);
  // Set below, once the failure is known: media that can never be played is not started again.
  const neverPlays = useRef(false);
  useTVEventHandler(event => {
    if (event.eventType === 'menu') return;
    if (event.eventType !== 'focus' && event.eventType !== 'blur') reveal();
    if (event.eventType === 'playPause' && (event.eventKeyAction == null || event.eventKeyAction === 1) && !neverPlays.current) engine.toggle();
    if (timelineFocused && !option) {
      if (event.eventType === 'left') engine.seekBy(-skipBack);
      if (event.eventType === 'right') engine.seekBy(skipForward);
      if (event.eventType === 'select') engine.toggle();
    }
  });
  const fade = useSharedValue(1);
  useEffect(() => {
    fade.value = withTiming(chrome ? 1 : 0, {duration: motion.reduce ? 0 : motion.standard, easing: Easing.out(Easing.cubic)});
  }, [chrome, fade, motion]);
  const chromeStyle = useAnimatedStyle(() => ({opacity: fade.value}));
  const bottomInset = Math.max(insets.bottom, isTV ? 60 : space.md);
  const topInset = Math.max(insets.top, isTV ? 60 : space.md);
  const side = isTV ? 80 : Math.max(insets.left, space.lg);
  const controlSize = isTV ? 'lg' : 'md';
  const busy = state.phase === 'starting' || (state.pendingSeek !== undefined && state.phase === 'ready') || !!state.recovering;
  const errored = state.phase === 'error';
  // While a card sits over the chrome (post-play, error), the chrome behind it must not take focus.
  const overlayUp = state.phase === 'ended' || errored;
  const compact = !isTV && window.width < 700;
  // TV-PLAYER-01: while the post-play or error card is up, the chrome guide leaves the focus
  // engine. When it comes back (Replay, Try again) tvOS does not re-enumerate the guide on its
  // own, so focus stayed wherever the card left it and the controls were unreachable. The guide
  // is remounted (keyed on the overlay) and focus is put on Pause/Play once.
  const playButton = useRef<FocusableHandle>(null);
  // QA P1 (TV): the same holds when the chrome hides and comes back (focusable false → true):
  // tvOS kept focus on the scrubber and nothing else could be reached. Each reveal is a fresh
  // guide, so the transport and the option boxes are enumerated again.
  const chromeEpoch = useRef(0);
  const chromeWas = useRef(chrome);
  if (isTV && chrome && !chromeWas.current) chromeEpoch.current += 1;
  chromeWas.current = chrome;
  const hadOverlay = useRef(overlayUp);
  const returnedFromOverlay = useRef(false);
  useEffect(() => {
    if (hadOverlay.current && !overlayUp && isTV) {
      returnedFromOverlay.current = true;
      setChrome(true);
      const timer = setTimeout(() => playButton.current?.focus(), 150);
      hadOverlay.current = overlayUp;
      return () => clearTimeout(timer);
    }
    hadOverlay.current = overlayUp;
  }, [overlayUp, isTV]);
  const queue = engine.service.getQueueController();
  const queueState = useSyncExternalStore(queue?.subscribe ?? noSubscribe, queue?.getSnapshot ?? noSnapshot);
  const needsQueueRecovery = queueState?.phase === 'recovery-required';
  // Bug (a)/(b): a play that arrives before this device's playback queue has connected (cold
  // launch, JS reload) used to fail at once with a developer message. It now waits for the queue,
  // shows "Getting ready", and plays as soon as the queue is ready (for up to 20 s), instead of
  // leaving every attempt failed.
  const connection = engine.service.getQueueConnection();
  const queueConnecting = errored && !state.channel && !identity.offline && !connection.error && (!queue || queueState?.phase === 'loading');
  const [queueTimedOut, setQueueTimedOut] = useState(false);
  const waitingForQueue = queueConnecting && !queueTimedOut;
  // A failure that trying again cannot mend (the title or its file is gone, this profile may not
  // play it, this device cannot and the server has nothing else to offer) is said plainly, with
  // no "Try again". Live channels and downloads keep their own messages.
  const routePhase = api.getRouteSnapshot()?.phase;
  const cannotPlay = errored && !waitingForQueue && !state.ended && !state.channel && !identity.offline && !needsQueueRecovery && state.cleanupPending === 0
    ? cannotPlayReason({error: state.error, routeReady: routePhase === undefined || routePhase === 'ready', ...failureFor(state.intentId, state.itemId ?? identity.itemId)})
    : null;
  neverPlays.current = !!cannotPlay;
  const replayWhenReady = useRef<{itemId: string; position: number} | undefined>(undefined);
  useEffect(() => {
    if (!queueConnecting) return;
    const itemId = state.itemId ?? identity.itemId;
    if (itemId && !replayWhenReady.current) replayWhenReady.current = {itemId, position: state.positionSeconds};
    setQueueTimedOut(false);
    const timer = setTimeout(() => setQueueTimedOut(true), 20000);
    return () => clearTimeout(timer);
  }, [queueConnecting, state.itemId, identity.itemId, state.positionSeconds]);
  useEffect(() => {
    const pending = replayWhenReady.current;
    if (!pending || !queue || queueState?.phase !== 'ready' || !errored) return;
    replayWhenReady.current = undefined;
    engine.play(pending.itemId, pending.position, identity.itemId === pending.itemId ? {id: pending.itemId, title: identity.title, posterUrl: identity.posterUrl, backdropUrl: identity.backdropUrl, libraryId: identity.libraryId, kind: (identity.kind ?? 'movie') as never} as never : undefined);
  }, [queue, queueState?.phase, errored, engine, identity]);
  // OS-01/03/06: publish the video to the lock screen, Control Center, the Apple TV's remote app
  // and AirPlay. Every command comes back as an ordinary player intent (Watch Together rules and
  // progress reporting stay in the engine). Audio is published by the native listening owner.
  const queueEntries = queueState?.view?.queue?.entries;
  const currentAt = queueEntries ? queueEntries.findIndex(e => e.id === queueState?.view?.queue?.currentEntryId) : -1;
  const canNext = !!queueEntries && currentAt >= 0 && queueEntries.slice(currentAt + 1).some(e => !e.hidden && !e.removed);
  const canPrevious = !!queueEntries && currentAt > 0;
  const upcoming = upcomingEntries(queueState?.view ?? null);
  // iPad and TV: a sixth box for what doesn't fit the five (Up next, Playback info, Report).
  const hasMore = !compact && (upcoming.length > 0 || (!isTV && !state.channel));
  const systemItemId = state.itemId ?? identity.itemId;
  // Next and Previous move through the queue. Live TV has none: its own are the channel steps.
  const stepInQueue = (action: 'next' | 'previous') => { if (!state.channel) engine.step(action); };
  const resumeAfterInterruption = useRef(false);
  const route = useSystemMedia(
    isAudio || !engine.active || !systemItemId || !session
      ? null
      : {
          itemId: systemItemId,
          title: identity.title || 'Now playing',
          subtitle: identity.subtitle,
          seriesTitle: identity.seriesTitle,
          origin: api.baseUrl,
          bearer: session.accessToken,
          posterPath: systemPosterPath(identity.posterUrl),
          durationSeconds: state.duration,
          live: !!state.channel,
          skipBackSeconds: skipBack,
          skipForwardSeconds: skipForward,
          canNext,
          canPrevious,
          markers: markers?.markers.map(m => ({kind: m.kind, startSeconds: m.startSeconds, endSeconds: m.endSeconds})),
        },
    (c: SystemMediaCommand) => {
      if (c.itemId !== systemItemId) return;
      switch (c.command) {
        // An interruption (a call, Siri, an alarm) resumes only what it paused: a video the viewer
        // had paused stays paused when the interruption ends.
        case 'play': if (c.reason === 'interruption' && !resumeAfterInterruption.current) break; resumeAfterInterruption.current = false; if (!playing) engine.toggle(); break;
        case 'pause': if (c.reason === 'interruption') resumeAfterInterruption.current = state.intent === 'playing'; if (playing) engine.toggle(); break;
        case 'toggle': engine.toggle(); break;
        case 'skip': engine.seekBy(c.deltaSeconds); break;
        case 'seek': engine.seekTo(c.positionSeconds); break;
        case 'next': stepInQueue('next'); break;
        case 'previous': stepInQueue('previous'); break;
      }
    },
  );
  const [pipUnavailable, setPipUnavailable] = useState(false);
  const lyricsAllowed = isAudio && identity.kind === 'song' && prefs.value<boolean>('playback.showSyncedLyrics', true);
  const [lyricsOn, setLyricsOn] = useState(true);
  const lyricsShown = lyricsAllowed && lyricsOn;
  // OS-03 (iOS): Handoff/Spotlight/Siri learn the title being played.
  useCurrentActivity(isAudio || !systemItemId || state.channel ? null : {itemId: systemItemId, title: identity.title || 'Now playing', subtitle: [identity.seriesTitle, identity.subtitle].filter(Boolean).join(' · ') || undefined, webUrl: session?.viewer.authority === 'hosted' ? `https://web.getportico.tv/media/${encodeURIComponent(systemItemId)}` : undefined});
  // FEAT-12 / OS-05 (tvOS): with the timeline focused, sliding a finger on the Siri Remote's
  // surface scrubs the existing timeline, and lifting it seeks there.
  const [scrub, setScrub] = useState<number>();
  const touchStart = useRef<{x: number; seconds: number}>(undefined);
  useSiriRemoteTouch(isTV && timelineFocused && !state.channel && !overlayUp && state.duration > 0, touch => {
    if (touch.phase === 'began') { touchStart.current = {x: touch.x, seconds: state.pendingSeek?.positionSeconds ?? state.positionSeconds}; return; }
    const start = touchStart.current;
    if (!start) return;
    const target = scrubTarget(start.seconds, start.x, touch.x, state.duration);
    if (touch.phase === 'changed') setScrub(target);
    else { touchStart.current = undefined; setScrub(undefined); if (Math.abs(target - start.seconds) >= 1) engine.seekTo(target); }
  });
  // A lost create/stop response leaves a saved request; reconcile it first.
  useEffect(() => {
    if (errored && state.cleanupPending > 0) engine.service.retryCleanup();
  }, [errored, state.cleanupPending, engine.service]);
  const channelSteps = !!state.channel && canStepChannel();
  const stepChannel = (delta: 1 | -1) => { void channelStep(delta).then(next => { if (next) engine.tune(next.channel, next.lineup); }); };
  const optionValue = (key: OptionKey): string => {
    switch (key) {
      case 'speed':
        return engine.speedState.desired === 1 ? i18n.t('player.opt.normalSpeed') : `${engine.speedState.desired}×`;
      case 'audio': {
        const audio = state.audio;
        const current = audio.plan?.renditions.find(r => r.id === (audio.pending?.renditionId ?? audio.observedRenditionId ?? audio.plan?.defaultRenditionId));
        return current?.label ?? (audio.availability === 'loading' ? i18n.t('player.opt.loadingAudio') : i18n.t('player.opt.defaultTrack'));
      }
      case 'subtitles': {
        const plan = engine.subtitles.snapshot.plan;
        return plan && plan.mode === 'track' && plan.selected && !engine.subtitles.snapshot.suppressed ? plan.selected.language || plan.selected.title : i18n.t('player.opt.off');
      }
      case 'quality': {
        const chosen = engine.quality.offers?.sources.flatMap(src => src.qualities).find(q => q.id === engine.quality.selected);
        return chosen ? chosen.label : state.session?.mode === 'hls' ? 'Automatic · converted' : 'Automatic';
      }
      case 'sleep':
        return state.listeningDeadlines?.sleepAtMs ? 'On' : 'Off';
      default:
        return '';
    }
  };
  // APP-06: the native view owns the AVPictureInPictureController, and it is the
  // only thing that delivers `stopped` and `restore`. Unmounting it when PiP
  // starts released that owner and stranded `pipActive` on, so the full player
  // could never come back and — with no mini bar for video — no player surface
  // was left at all. While PiP is running the view stays mounted with nothing
  // drawn: the system window is the presentation, and this is only the owner.
  // Picture in Picture changes arrive on the playback module's event channel, for this player's
  // lease only. (A view event prop reached JavaScript through RCTEventEmitter, which a New
  // Architecture production bundle never registers: the first one crashed the Release app.)
  const onPictureInPicture = useRef<(event: {state: string; subtitlesCarried?: boolean}) => void>(() => {});
  onPictureInPicture.current = event => {
    const value = event.state;
    if (value === 'unavailable') {
      setPipUnavailable(true);
      return;
    }
    // IOS-PLAYER-02: say why nothing happened.
    if (value === 'failed') {
      showToast({message: activeI18n().t('player.pipUnavailable'), icon: 'pip'});
      engine.setPipActive(false);
      return;
    }
    if (value === 'started') {
      engine.setPipActive(true);
      engine.collapse();
    } else engine.setPipActive(false);
  };
  const pipLease = useRef('');
  pipLease.current = engine.lease ?? '';
  useEffect(() => {
    const module = NativeModules.PorticoPlaybackModule;
    if (!module) return undefined;
    const sub = new NativeEventEmitter(module).addListener('PorticoPictureInPicture', (change: {lease?: string; state: string; subtitlesCarried?: boolean}) => {
      if (change.lease && change.lease === pipLease.current) onPictureInPicture.current(change);
    });
    return () => sub.remove();
  }, []);
  const pictureInPicture = (
    <NativePlayer
      style={isAudio || engine.pipActive ? {width: 1, height: 1, position: 'absolute'} : StyleSheet.absoluteFill}
      lease={engine.lease ?? ''}
      pictureInPictureRequest={engine.pipRequest}
    />
  );
  if (engine.pipActive && !isAudio)
    return (
      <View pointerEvents="none" style={{position: 'absolute', width: 1, height: 1, opacity: 0}}>
        {pictureInPicture}
      </View>
    );
  return (
    <View style={[StyleSheet.absoluteFill, {backgroundColor: colors.black, zIndex: 40}]}>
      {isAudio ? (
        // APL-AUDIO-01: artwork and lyrics share the screen between the top bar and the controls.
        <View style={[StyleSheet.absoluteFill, {alignItems: 'center', backgroundColor: colors.ink, paddingTop: topInset + (isTV ? 120 : 72), paddingBottom: bottomInset + (isTV ? 320 : 220), gap: space.lg}]}>
          <View style={{flex: lyricsShown ? 0 : 1, justifyContent: 'center'}}>
            <Artwork source={artwork(identity.posterUrl)} shape="square" width={Math.min(window.width, window.height) * (lyricsShown ? (isTV ? 0.22 : 0.4) : isTV ? 0.42 : 0.7)} title={identity.title} icon="music" radius={metrics.radius.panel} />
          </View>
          {lyricsShown ? <Lyrics engine={engine} /> : null}
        </View>
      ) : null}
      {pictureInPicture}
      {!isTV && !isAudio ? <Pressable style={StyleSheet.absoluteFill} onPress={() => (chrome && playing ? setChrome(false) : reveal())} accessibilityLabel={chrome ? i18n.t('player.hideControls') : i18n.t('player.showControls')} /> : null}
      {!isAudio && !state.channel ? <PostPlay engine={engine} /> : null}
      {!isAudio && !state.channel && state.phase === 'ready' ? <SkipPrompt markers={markers} position={state.positionSeconds} sessionId={state.session?.id} modes={skipModes} onSeek={engine.seekTo} onSkipped={(id, mode, at) => engine.service.markerSkipped(id, mode, at)} bottom={bottomInset + (isTV ? 260 : 190)} /> : null}
      {route.external && !isAudio ? (
        <View pointerEvents="none" style={[StyleSheet.absoluteFill, {alignItems: 'center', justifyContent: 'center', backgroundColor: colors.black}]}>
          <Icon name={route.kind === 'airplay' ? 'airplay' : 'tvDevice'} size={isTV ? 96 : 56} color={colors.textSecondary} />
          <Text variant={isTV ? 'heading' : 'subheading'} style={{marginTop: space.md}}>{route.name ? i18n.t('player.playingOn', {name: route.name}) : i18n.t('player.playingOnAnotherScreen')}</Text>
        </View>
      ) : null}
      {queueState?.phase === 'preparing' && !errored && !state.session ? (
        // A v1 queue whose first entry the server is still choosing (a very large shuffle), or a
        // command waiting on an entry still being snapshotted: quiet, then explained after 10 s.
        <View pointerEvents="none" style={[StyleSheet.absoluteFill, {alignItems: 'center', justifyContent: 'center'}]}><QueuePreparing /></View>
      ) : (busy && !errored) || waitingForQueue ? <View pointerEvents="none" style={[StyleSheet.absoluteFill, {alignItems: 'center', justifyContent: 'center'}]}><StateView loading title={state.recovering ? i18n.t('player.reconnecting') : waitingForQueue ? i18n.t('player.gettingReady') : ''} /></View> : null}
      {errored && !waitingForQueue && state.ended ? (
        // The server ended this session (the owner stopped it): say why, in the same message slot,
        // with only Close. No retry and no advance.
        <View style={[StyleSheet.absoluteFill, {alignItems: 'center', justifyContent: 'center', padding: space.xl}]}>
          <StateView icon="info" title={endedCopy(state.ended, i18n.t).title} message={endedCopy(state.ended, i18n.t).message} />
          <View style={{flexDirection: 'row', gap: space.sm}}>
            <Button variant="ghost" label={i18n.t('action.close')} hasTVPreferredFocus={isTV} onPress={engine.leave} />
          </View>
        </View>
      ) : cannotPlay ? (
        // Never playable: what is wrong, in one sentence, and the way out. Nothing to try again.
        <View style={[StyleSheet.absoluteFill, {alignItems: 'center', justifyContent: 'center', padding: space.xl}]}>
          <StateView icon="info" title={word('player.cannotPlay.title', undefined, i18n)} message={word(`player.cannotPlay.${cannotPlay}`, {title: identity.title || word('player.cannotPlay.thisTitle', undefined, i18n)}, i18n)} />
          <View style={{flexDirection: 'row', gap: space.sm}}>
            <Button variant="ghost" label={i18n.t('action.close')} hasTVPreferredFocus={isTV} onPress={engine.leave} />
          </View>
        </View>
      ) : errored && !waitingForQueue ? (
        <View style={[StyleSheet.absoluteFill, {alignItems: 'center', justifyContent: 'center', padding: space.xl}]}>
          <StateView
            icon="warning"
            title={needsQueueRecovery ? i18n.t('player.unfinishedTitle') : i18n.t('player.stoppedTitle')}
            message={needsQueueRecovery ? i18n.t('player.unconfirmedBody') : state.cleanupPending > 0 ? i18n.t('player.finishingBody') : state.error ? say(state.error, 'playback') : i18n.t('player.unplayableBody')}
            action={needsQueueRecovery ? i18n.t('player.checkAgain') : state.cleanupPending > 0 ? i18n.t('player.checkAgain') : i18n.t('action.tryAgain')}
            onAction={needsQueueRecovery ? () => void queue?.check(true).catch(() => {}) : state.cleanupPending > 0 ? () => engine.service.retryCleanup() : !queue && connection.retry ? () => { const itemId = state.itemId ?? identity.itemId; if (itemId) replayWhenReady.current = {itemId, position: state.positionSeconds}; connection.retry?.(); } : engine.toggle}
            loading={state.cleanupPending > 0 && !state.cleanupError}
          />
          <View style={{flexDirection: 'row', gap: space.sm}}>
            {needsQueueRecovery ? <Button variant="danger" label={i18n.t('player.discardAndPlayAgain')} onPress={() => void queue?.cancel().catch(() => {}).then(() => engine.retry())} /> : null}
            <Button variant="ghost" label={i18n.t('action.close')} onPress={engine.leave} />
          </View>
        </View>
      ) : null}
      {/* focusable={false} on a guide removes the whole subtree from the tvOS focus engine; pointerEvents alone only affects touch. */}
      <TVFocusGuideView key={overlayUp ? 'overlay' : `chrome:${chromeEpoch.current}`} focusable={chrome && !overlayUp} style={StyleSheet.absoluteFill} pointerEvents={chrome ? 'box-none' : 'none'}>
      <Animated.View pointerEvents={chrome ? 'box-none' : 'none'} style={[StyleSheet.absoluteFill, chromeStyle]}>
        <Scrim position="top" height={isTV ? 260 : 160} />
        <Scrim position="bottom" height={isTV ? 420 : 300} />
        <View style={{position: 'absolute', top: topInset, left: side, right: side, flexDirection: 'row', alignItems: 'center', gap: space.md}}>
          <View style={{flex: 1, minWidth: 0}}>
            {/* An episode reads "Severance · S1 E2", with its own title under it. */}
            <Text variant={isTV ? 'heading' : 'subheading'} lines={1}>{episodeLine ?? identity.title}</Text>
            {episodeLine || identity.subtitle || identity.artist ? <Text variant="caption" tone="secondary" lines={1}>{episodeLine ? identity.title : identity.artist ? [identity.artist, identity.album].filter(Boolean).join(' · ') : identity.subtitle}</Text> : null}
          </View>
          <GroupPill />
          {lyricsAllowed ? <Button variant="ghost" round icon="lyrics" selected={lyricsOn} accessibilityLabel={i18n.t('player.lyrics')} accessibilityState={{selected: lyricsOn}} onPress={() => setLyricsOn(v => !v)} /> : null}
          {!isTV && !state.channel ? <Button variant="ghost" round icon="cast" accessibilityLabel={i18n.t('player.playOn')} onPress={() => setDestinations(true)} /> : null}
          {!isAudio && !pipUnavailable ? <Button variant="ghost" round icon="pip" accessibilityLabel={i18n.t('player.pictureInPicture')} onPress={engine.requestPip} /> : null}
          {!isTV ? <Button variant="ghost" round icon={isAudio ? 'chevronDown' : 'close'} accessibilityLabel={i18n.t(isAudio ? 'player.minimize' : 'player.close')} onPress={isAudio ? engine.collapse : engine.leave} /> : null}
        </View>
        <View style={{position: 'absolute', left: side, right: side, bottom: bottomInset, gap: isTV ? space.lg : space.md}}>
          <TVFocusGuideView trapFocusLeft trapFocusRight>
            <Timeline position={state.positionSeconds} duration={state.duration} pending={scrub ?? state.pendingSeek?.positionSeconds} live={!!state.channel} onSeek={engine.seekTo} focused={timelineFocused} onFocusChange={setTimelineFocused} hasTVPreferredFocus={isTV && !overlayUp && !returnedFromOverlay.current} programmeLabel={liveProgrammeLabel} behindLabel={liveBehindLabel} />
          </TVFocusGuideView>
          <View style={{flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: isTV ? space.lg : space.md}}>
            {queueModes ? <QueueToggle engine={engine} kind="shuffle" size={controlSize} /> : null}
            {/* FEAT-07: on a channel tuned from the guide, Previous and Next change channel. */}
            <Button variant="ghost" transport="control" icon="previous" accessibilityLabel={i18n.t(channelSteps ? 'player.channelDown' : 'player.previous')} disabled={channelSteps ? false : !canPrevious} onPress={() => (channelSteps ? stepChannel(-1) : stepInQueue('previous'))} />
            {isMusic ? null : <Button variant="ghost" transport="control" icon="back10" iconNumber={skipBack} accessibilityLabel={i18n.t('player.skipBackSeconds', {seconds: skipBack})} disabled={!!state.channel} onPress={() => engine.seekBy(-skipBack)} />}
            <Button ref={playButton} variant="primary" transport="primary" icon={playing ? 'pause' : 'play'} accessibilityLabel={playing ? i18n.t('action.pause') : i18n.t('action.play')} onPress={engine.toggle} />
            {isMusic ? null : <Button variant="ghost" transport="control" icon="forward10" iconNumber={skipForward} accessibilityLabel={i18n.t('player.skipForwardSeconds', {seconds: skipForward})} disabled={!!state.channel} onPress={() => engine.seekBy(skipForward)} />}
            <Button variant="ghost" transport="control" icon="next" accessibilityLabel={i18n.t(channelSteps ? 'player.channelUp' : 'player.next')} disabled={channelSteps ? false : !canNext} onPress={() => (channelSteps ? stepChannel(1) : stepInQueue('next'))} />
            {queueModes ? <QueueToggle engine={engine} kind="repeat" size={controlSize} /> : null}
          </View>
          {/* APL-PLAYER-03: the system volume slider, trailing, outside the centered transport. */}
          {!isTV && !compact && hasVolumeView ? <View style={{position: 'absolute', right: 0, bottom: 64, width: 160, height: 32, justifyContent: 'center'}}><VolumeSlider style={{height: 32}} /></View> : null}
          {compact ? (
            <View style={{flexDirection: 'row', justifyContent: 'center'}}>
              <Button variant="outline" size="sm" icon="settings" label={i18n.t('player.opt.menu')} onPress={() => setOption('menu')} />
            </View>
          ) : (
            <View style={{flexDirection: 'row', justifyContent: 'center', gap: space.sm, flexWrap: 'wrap'}}>
              {optionBoxesFor(isMusic).map(o => (
                <Button key={o.key} ref={h => { boxes.current.set(o.key, h); }} variant="outline" size="sm" icon={o.icon} label={`${o.label} · ${optionValue(o.key)}`} onPress={() => openFrom(o.key, boxes.current.get(o.key))} />
              ))}
              {hasMore ? <Button ref={h => { boxes.current.set('menu', h); }} variant="outline" size="sm" icon="more" label={i18n.t('title.more')} onPress={() => openFrom('menu', boxes.current.get('menu'))} /> : null}
            </View>
          )}
        </View>
      </Animated.View>
      </TVFocusGuideView>
      <PlayerOptions option={option} anchor={anchor} fromMenu={fromMenu} compact={compact} engine={engine} valueOf={optionValue} upcoming={upcoming.length} onClose={() => setOption(null)} onPick={key => { setAnchor(undefined); setOption(key); }} onReport={!isTV && !state.channel ? () => setReport(true) : undefined} isChannel={!!state.channel} onMiniGuide={() => setGuideOpen(true)} canRecordLive={canRecordLive} onRecordLive={recordLive} />
      {state.channel ? <MiniGuideSheet open={guideOpen} onClose={() => setGuideOpen(false)} engine={engine} /> : null}
      {!isTV ? <DestinationSheet open={destinations} onClose={() => setDestinations(false)} engine={engine} /> : null}
      {report ? <FeedbackSheet open onClose={() => setReport(false)} itemId={state.itemId} playbackSessionId={state.session?.id} title={identity.title} /> : null}
    </View>
  );
}

/** "Getting your queue ready…"; after 10 s of waiting it also says the queue is still loading. */
function QueuePreparing() {
  const i18n = useI18n();
  const [slow, setSlow] = useState(false);
  useEffect(() => { const timer = setTimeout(() => setSlow(true), 10000); return () => clearTimeout(timer); }, []);
  return <StateView loading title={i18n.t('web.queue.preparing')} message={slow ? i18n.t('web.queue.stillBuilding') : undefined} />;
}

function Scrim({position, height}: {position: 'top' | 'bottom'; height: number}) {
  const {colors} = useTheme();
  const [width, setWidth] = useState(0);
  return (
    <View pointerEvents="none" onLayout={e => setWidth(e.nativeEvent.layout.width)} style={{position: 'absolute', left: 0, right: 0, [position]: 0, height}}>
      {width > 0 ? (
        <Svg width={width} height={height} viewBox={`0 0 ${width} ${height}`}>
          <Defs>
            <LinearGradient id={`scrim-${position}`} x1="0" y1={position === 'top' ? '0' : '1'} x2="0" y2={position === 'top' ? '1' : '0'}>
              <Stop offset="0" stopColor={colors.black} stopOpacity={0.78} />
              <Stop offset="0.6" stopColor={colors.black} stopOpacity={0.35} />
              <Stop offset="1" stopColor={colors.black} stopOpacity={0} />
            </LinearGradient>
          </Defs>
          <Rect x={0} y={0} width={width} height={height} fill={`url(#scrim-${position})`} />
        </Svg>
      ) : null}
    </View>
  );
}
