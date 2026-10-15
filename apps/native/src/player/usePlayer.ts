import {classifyPlaybackFailure} from './playback-failure';
import {PlayerOffersService, type PlayerOffersSnapshot} from '../../../../packages/client-core/src/player-offers';
import {activeI18n} from '../app/errors';
import {topShelfChanged} from '../app/top-shelf';
import {viewerScope} from '../app/content';
import {SubtitleService, type SubtitleSnapshot} from '../../../../packages/client-core/src/subtitles';
import {advancePendingChoice, takePendingTrackChoice, type PendingChoiceProgress} from '../../../../packages/client-core/src/pending-track-choice';
import {takePendingVersion} from '../app/pending-version';
import {pauseNextStart} from '../app/paused-load';
import {useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore} from 'react';
import {AppState, NativeEventEmitter, NativeModules, Platform} from 'react-native';
import type {GuideChannel} from '../../../../packages/client-core/src/channel-guide';
import {channelTuned, type Lineup} from './channel-lineup';
import type {ContentEntry} from '../../../../packages/client-core/src/library-content';
import {NativePlaybackCoordinator} from '../bridge/NativePlaybackCoordinator';
import {playbackRates, speedFor} from '../bridge/NativePlaybackSpeed';
import {useNativeAudioSelection} from '../bridge/useNativeAudioSelection';
import {useNativePlayback} from '../bridge/useNativePlayback';
import {playerSettingsSupport} from '../bridge/native-listening-kinds';
import {containerPlay, type SequenceContainer} from '../app/container-play';
import {queueItemInput} from '../../../../packages/client-core/src/queue-controller';
import {useSession} from '../app/session';
import {emitPlaybackChange, restoreInvoker} from '../app/playback-events';
import {audioEffectsAvailability, musicAudioEffects} from '../../../../packages/client-core/src/music-preferences';
import {publishAudioRenderAvailability} from '../app/audio-render-status';
import {useServerPreferences} from '../app/server-preferences';
import {isLocalSession, isLocalSource, type LocalMedia} from '../bridge/local-playback';
import type {OfflineDisplay} from '../bridge/offline-downloads';
import {dolbyVisionWarningNeeded, mayCarryVideo} from './dolby-vision';
import {stepQueue} from './queue-step';
import {sourceFactsOf, type SourceFacts} from '../../../../packages/client-core/src/presentation/index';
import {audioTrackLabel, type PlaybackSnapshot} from '../../../../packages/client-core/src/index';
import {localV1Http} from '../../../../packages/client-core/src/playback-v1/local-http';
import {PlaybackOptionsClient} from '../../../../packages/client-core/src/playback-v1/options';
import {audioStreamIndex} from '../../../../packages/client-core/src/playback-v1/choices';
import {qualityOptionRequest, type QualityOption} from '../../../../packages/client-core/src/playback-v1/quality';
import {parseOptions, type PlaybackOptions as TitleOptions} from '../../../../packages/client-core/src/playback-v1/types';
import type {SubtitleResource} from '../../../../packages/client-core/src/subtitles';
import type {SegmentMarkerSet} from '../../../../packages/client-core/src/segment-markers';
import {parseTrickplay, preferredTrickplaySet, type TrickplayView} from '../../../../packages/client-core/src/trickplay';
import {usePreferences} from '../app/preferences';
import {engineFeatures, engineTransport, mpvAvailable} from '../bridge/player-engines';
import {showToast} from '../ui';
import {chooseEngine, localRuleFacts, parseEngineSetting, type EngineKind} from './engine-choice';
import {engineSettingStore} from './engine-setting-store';
import {replanEngine} from './engine-replan';
import {chaptersOf, deviceDrawnTrack, engineSubtitleRender, fontsUrlOf, kindOfFormat, parseSubtitleFonts, planEngineOf, renderingToRequest, requiredSubtitleRendering, type EngineMedia, type SubtitleFonts, type SubtitleKind} from './engine-media';
import {automaticSteps} from './native-playback';
import {noteEngineFact} from './failure-facts';
import {captionStyle} from './caption-style';
import {offlineChapters, offlineContainer, offlineMarkers, offlineSubtitleCommand, offlineSubtitleTracks} from './offline-extras';

/**
 * An operation id for a subtitle choice: an idempotency key, not a secret. Hermes has no `crypto`,
 * so the shared generator (`newInstallationId`) throws here; choosing subtitles crashed on it.
 */
const ID_ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_';
function operationId(): string {
  let text = '';
  for (let i = 0; i < 43; i++) text += ID_ALPHABET[Math.floor(Math.random() * 64)];
  return text;
}

export type NowPlaying = {
  itemId?: string;
  title: string;
  subtitle?: string;
  posterUrl?: string;
  backdropUrl?: string;
  kind?: string;
  libraryId?: string;
  artist?: string;
  album?: string;
  channel?: boolean;
  /** The show an episode belongs to (Now Playing, lock screen, Siri Remote app). */
  seriesTitle?: string;
  /** An episode's number as a code ("S1 E2"), for the player's title line. */
  episodeCode?: string;
  /** OS-07: played from a download on this device (no queue, quality, subtitles or server lookups). */
  offline?: boolean;
};

/** MU4 COMPAT-01: a bitmap subtitle choice awaiting its once-per-play confirm. */
export type BitmapConfirm = {resource: {id: string; language: string; format?: string; renderer?: string}; onConfirm: () => void};

/** Show titles for episodes and artist/album for songs, looked up once per item. */
const titleCaches = new WeakMap<object, Map<string, Partial<NowPlaying>>>();

/** A song on a handheld starts in the mini player (the list it came from stays in view); the
 * television has no mini player, and everything else opens full. */
const opensFull = (kind?: string) => Platform.isTV || kind !== 'song';

/**
 * The player engine: binds the shared PlaybackService to the native AVPlayer
 * through the carried-over coordinator, and exposes a small command surface
 * for the chrome. Presentation state (expanded / collapsed) lives here so the
 * shell, mini bar and full player agree.
 */
const RECOVERY_GIVE_UP_MS = 90000;
const noSubtitles = (): SubtitleSnapshot => emptySubtitles;
const emptySubtitles: SubtitleSnapshot = Object.freeze({catalog: null, plan: null, busy: false, loading: false, suppressed: true, error: null, canRetry: false, candidates: []});
const noSubtitleSubscribe = () => () => {};
const noOffers = (): PlayerOffersSnapshot | null => null;

export function usePlayerEngine() {
  const {api, session} = useSession();
  const extraTitles = useMemo(() => {
    let cache = titleCaches.get(api);
    if (!cache) { cache = new Map(); titleCaches.set(api, cache); }
    return cache;
  }, [api]);
  const {playback, playbackState, ensureQueue, v1Queue, playLocal, path} = useNativePlayback(api, session);
  // The server's own account of the session being played: the engine it named, the quality in
  // force, the tracks it chose. Read through the session path, which hears of every re-plan.
  const sessionId = playbackState.session?.id;
  const v1Session = useSyncExternalStore(path.subscribeSessions, useCallback(() => path.session(sessionId), [path, sessionId]));
  const presentation = v1Session && v1Session.presentation.generation === playbackState.session?.generation ? v1Session.presentation : undefined;
  // X-02: the viewer's music preferences (gapless, crossfade, normalization) are what the native
  // listening owner renders with, on sign-in, profile selection and every change. Until the server
  // answers (or offline) the device's cached copy applies.
  const musicPreferences = useServerPreferences().snapshot;
  useEffect(() => {
    if (musicPreferences) playback.adoptAudioEffectsPreference(musicAudioEffects(musicPreferences));
  }, [musicPreferences, playback]);
  useEffect(() => publishAudioRenderAvailability(audioEffectsAvailability(playbackState.session)), [playbackState.session]);
  // While watching with a group, play, pause and seeking belong to the group; a handler
  // returns true when it took the intent, and the local player is left to follow.
  const groupControl = useRef<GroupControl | null>(null);
  const setGroupControl = useCallback((control: GroupControl | null) => { groupControl.current = control; }, []);
  const [identity, setIdentity] = useState<NowPlaying>({title: ''});
  const [expanded, setExpanded] = useState(false);
  const [pipRequest, setPipRequest] = useState(0);
  const [pipActive, setPipActive] = useState(false);
  /* M27 Dolby Vision warning: pending play intent awaiting confirmation, and item ids already
   * acknowledged for this session (so it isn't asked twice per item). */
  type DolbyPendingSingle = {intent: number; kind: 'single'; itemId: string; startSeconds: number; entry?: ContentEntry};
  type DolbyPendingSequence = {intent: number; kind: 'sequence'; entries: readonly ContentEntry[]; index: number; startSeconds: number; container?: SequenceContainer};
  const [dolbyPending, setDolbyPending] = useState<DolbyPendingSingle | DolbyPendingSequence | null>(null);
  const dolbyAcknowledged = useRef<Set<string>>(new Set());
  /* MU4 COMPAT-01: 4K/HDR facts per item from the same pre-play read (never a new request),
   * and a bitmap-track confirm pending on it (Cancel keeps the current track). */
  const sourceFactsRef = useRef(new Map<string, SourceFacts>());
  const sourceFacts = useCallback((itemId: string | undefined) => (itemId ? sourceFactsRef.current.get(itemId) : undefined), []);
  const chaptersRef = useRef(new Map<string, ReturnType<typeof chaptersOf>>());
  const [bitmapPending, setBitmapPending] = useState<BitmapConfirm | null>(null);
  const bitmapAcknowledged = useRef(new Set<string>());
  const sessionKey = sessionId;
  useEffect(() => { bitmapAcknowledged.current.clear(); setBitmapPending(null); }, [sessionKey]); // eslint-disable-line react-hooks/exhaustive-deps
  const requestBitmapConfirm = useCallback((resource: BitmapConfirm['resource'], onConfirm: () => void) => {
    setBitmapPending({resource, onConfirm});
  }, []);
  const confirmBitmap = useCallback(() => {
    const pending = bitmapPending;
    if (!pending) return;
    bitmapAcknowledged.current.add(pending.resource.id);
    setBitmapPending(null);
    pending.onConfirm();
  }, [bitmapPending]);
  const dismissBitmap = useCallback(() => setBitmapPending(null), []);
  const isBitmapAcked = useCallback((id: string) => bitmapAcknowledged.current.has(id), []);
  // The audio track the server chose for this presentation (the one asked for, or the language
  // this profile last picked for the show or film): what the Audio menu ticks.
  const plannedAudioTrack = useRef<number | null>(null);
  plannedAudioTrack.current = audioStreamIndex(presentation?.audioTrackId) ?? null;
  const audioSelection = useNativeAudioSelection(playback, api, session, identity.libraryId, plannedAudioTrack);
  const plannedAudioIndex = plannedAudioTrack.current;
  const plannedAudioTold = useRef('');
  useEffect(() => {
    const state = playback.getSnapshot(), tracks = state.audioTracks;
    if (plannedAudioIndex === null || !tracks || tracks.pending !== undefined || tracks.selected === plannedAudioIndex || !tracks.tracks.some(t => t.streamIndex === plannedAudioIndex)) return;
    // Said once for each presentation: a choice the viewer makes afterwards is theirs.
    const key = `${state.session?.id}:${state.session?.generation}:${plannedAudioIndex}`;
    if (plannedAudioTold.current === key) return;
    plannedAudioTold.current = key;
    playback.installAudioTracks(state.intentId, tracks.tracks, plannedAudioIndex);
  }, [playback, plannedAudioIndex, playbackState.audioTracks]);
  const speed = useMemo(() => speedFor(playback), [playback]);
  const speedState = useSyncExternalStore(speed.subscribe, speed.getSnapshot);
  useEffect(() => speed.invalidate(playbackState.intentId), [speed, playbackState.intentId]);
  // The profile's default speed for video and for audiobooks is where each title starts; a song
  // always plays at the speed it was recorded. Settings offered these and nothing applied them.
  const speedPreferences = useServerPreferences();
  const videoSpeed = speedPreferences.value<number>('playback.defaultSpeed', 1);
  const audiobookSpeed = speedPreferences.value<number>('audiobooks.defaultSpeed', 1);
  const speedItem = playbackState.channel ? undefined : playbackState.itemId;
  const speedKind = identity.itemId === speedItem ? identity.kind : undefined;
  useEffect(() => {
    if (!speedItem || !speedKind) return;
    // A device whose player has one speed plays at it, whatever the profile prefers elsewhere.
    speed.prefer(speedKind === 'song' || !playerSettingsSupport.playbackSpeed ? 1 : speedKind === 'audiobook_file' ? audiobookSpeed : videoSpeed);
  }, [speed, speedItem, speedKind, videoSpeed, audiobookSpeed]);
  useEffect(() => {
    if (playbackState.nativeListening) speed.reconcileNative(playbackState.nativeListening);
  }, [speed, playbackState.nativeListening]);

  const isAudio = identity.kind === 'song' || identity.kind === 'audiobook_file';
  // The Player setting (Automatic, this device's own player, or mpv) and what decides the engine
  // for the title in hand. Everything is read through refs: the coordinator asks on every change
  // of the playback snapshot, before it takes a lease, so a title never starts on one engine only
  // to be moved to the other.
  const devicePreferences = usePreferences();
  const engineSetting = parseEngineSetting(devicePreferences.preferences.playerEngine);
  // Image subtitles show only their forced lines when the viewer asks (mpv, `sub-forced-events-only`).
  const forcedOnly = devicePreferences.preferences.subtitleForcedOnly;
  const engineInputs = useRef<{setting: typeof engineSetting; audio: boolean; rendering?: string; container?: string}>({setting: engineSetting, audio: isAudio});
  engineInputs.current.setting = engineSetting;
  engineInputs.current.audio = isAudio;
  const engineNow = useRef<() => EngineKind>(() => 'native');
  const chooseEngineFor = useCallback((snapshot: PlaybackSnapshot): EngineKind => {
    const session = snapshot.session;
    if (!session) return 'native';
    const local = isLocalSource(session.streamUrl);
    // The server names the engine in its plan. While its account of the session is of another
    // presentation than the one the service holds (a re-plan on its way), the engine stays.
    const plan = planEngineOf(session, path.session(session.id));
    const nativeOnly = !!snapshot.channel || !!snapshot.nativeListening || !!session.audio || engineInputs.current.audio;
    if (plan.stale && mpvAvailable && !nativeOnly) return engineNow.current();
    return chooseEngine({
      setting: engineInputs.current.setting,
      mpvAvailable,
      planEngine: plan.engine,
      nativeOnly,
      requiredSubtitleRendering: engineInputs.current.rendering,
      nativeSubtitleRendering: engineFeatures('native').subtitleRendering,
      ...(plan.engine ? {} : localRuleFacts({address: session.streamUrl, local, platform: Platform.OS === 'android' ? 'android' : 'apple', container: local ? engineInputs.current.container : undefined})),
    });
  }, [path]);
  /** What the engine found in the file (mpv): chapters, the picture, its tracks. */
  const [engineMedia, setEngineMedia] = useState<EngineMedia | null>(null);
  const engineAudioRevision = useRef(0);
  // A home server sleeps, reboots and sits behind bad Wi-Fi. AVPlayer plays out its own buffer
  // before it reports a failed item, so a network failure here means the buffer is already
  // empty: the viewer is told "Reconnecting", and playback is retried with backoff. It ends only
  // when the failure is not a network one, or after a long stretch with nothing to play.
  const routeRecovery = useRef<{attempts: number; position: number; intent: number; since: number; timer?: ReturnType<typeof setTimeout>; giveUp?: ReturnType<typeof setTimeout>}>({attempts: 0, position: 0, intent: 0, since: 0});
  useEffect(() => () => { clearTimeout(routeRecovery.current.timer); clearTimeout(routeRecovery.current.giveUp); }, []);
  // The give-up used to be checked only when another error arrived, and a failed item reports
  // once: with the route offline "Reconnecting…" could stay on screen for ever.
  const armGiveUp = (recovery: {since: number; intent: number; giveUp?: ReturnType<typeof setTimeout>}, intentId: number) => {
    clearTimeout(recovery.giveUp);
    recovery.giveUp = setTimeout(() => {
      if (recovery.since && playback.getSnapshot().intentId === intentId && playback.getSnapshot().recovering) playback.fail(intentId, 'The server could not be reached. Your playback position is retained.');
    }, RECOVERY_GIVE_UP_MS);
  };
  const factHandler = useRef<(f: any) => void>(() => {});
  factHandler.current = (f: any) => {
    const before = playback.getSnapshot();
    // The error card reads what the engine in use last said of an attempt, whichever engine it is.
    noteEngineFact(f, before.itemId);
    if (f.intentId !== before.intentId) return;
    // The server's session hears what the engine reports: its timeline, and what Automatic
    // quality needs to know of the connection.
    path.engineFact(f);
    if (routeRecovery.current.intent !== before.intentId) {
      clearTimeout(routeRecovery.current.timer);
      clearTimeout(routeRecovery.current.giveUp);
      routeRecovery.current = {attempts: 0, position: 0, intent: before.intentId, since: 0};
    }
    if (f.type === 'progress' && Number.isFinite(f.position) && Math.abs(f.position - routeRecovery.current.position) > 1) {
      routeRecovery.current.position = f.position;
      routeRecovery.current.attempts = 0;
      if (routeRecovery.current.since) {
        routeRecovery.current.since = 0;
        clearTimeout(routeRecovery.current.timer);
        clearTimeout(routeRecovery.current.giveUp);
        playback.recovering(before.intentId, false);
      }
    }
    // The buffer ran dry while the item is still healthy. The viewer is told the player is
    // waiting; the next progress that moves clears it. Nothing is failed on a stall alone.
    if (f.type === 'stalled') {
      const recovery = routeRecovery.current;
      if (!recovery.since) {
        recovery.since = Date.now();
        playback.recovering(before.intentId, true);
        armGiveUp(recovery, before.intentId);
      }
      return;
    }
    // Subtitle renderer status is not a playback observation; it used to fall through and be
    // recorded as one.
    if (f.type === 'subtitleStatus') return;
    // The system paused the video while the app was away (or the engine had to, to leave the
    // screen): the intent follows, so the button says Play and one press continues.
    if (f.type === 'systemPaused') {
      if (before.intent === 'playing' && !groupControl.current?.toggle(true)) playback.pause();
      return;
    }
    if (f.type === 'mediaInfo') {
      setEngineMedia({intentId: f.intentId, chapters: chaptersOf(f.chapters), video: f.video && typeof f.video === 'object' ? f.video : undefined});
      // A download has no server to name its audio tracks: the engine's own list is offered.
      if (before.session && isLocalSession(before.session.id) && Array.isArray(f.audioTracks) && bridgeRef.current?.getEngine() === 'mpv') {
        const tracks = (f.audioTracks as any[]).filter(t => Number.isInteger(t?.streamIndex));
        const selected = tracks.find(t => t.selected === true)?.streamIndex ?? null;
        playback.installAudioTracks(f.intentId, tracks.map((t, i) => ({streamIndex: t.streamIndex, label: audioTrackLabel({title: typeof t.title === 'string' ? t.title : undefined, language: typeof t.language === 'string' ? t.language : undefined, channels: typeof t.channels === 'number' ? t.channels : undefined, codec: typeof t.codec === 'string' ? t.codec : ''}, i + 1), language: typeof t.language === 'string' ? t.language : undefined, channels: typeof t.channels === 'number' ? t.channels : undefined, codec: typeof t.codec === 'string' ? t.codec : ''})), selected);
      }
      return;
    }
    // The engine switched a direct-played file's audio track itself (no new session).
    if (f.type === 'audioTrackApplied') {
      const tracks = before.audioTracks;
      if (tracks && Number.isInteger(f.streamIndex)) playback.installAudioTracks(f.intentId, tracks.tracks, f.streamIndex);
      return;
    }
    if (f.type === 'audioTrackFailed') {
      // The engine could not find the track: ask the server for the title with that track instead.
      bridgeRef.current?.setAudioTrack(null);
      if (Number.isInteger(f.streamIndex)) void playback.selectAudioTrack(f.streamIndex).catch(() => {});
      return;
    }
    const failure = classifyPlaybackFailure(f);
    if (f.type === 'error' && failure.network && api.getRouteConnection()) {
      const recovery = routeRecovery.current;
      if (!recovery.since) armGiveUp(recovery, before.intentId);
      recovery.since ||= Date.now();
      if (Date.now() - recovery.since <= RECOVERY_GIVE_UP_MS) {
        playback.recovering(before.intentId, true);
        clearTimeout(recovery.timer);
        recovery.timer = setTimeout(() => {
          if (playback.getSnapshot().intentId === recovery.intent) void api.recoverRoute().catch(() => {});
        }, Math.min(1000 * 2 ** recovery.attempts, 10000));
        recovery.attempts++;
        return;
      }
    }
    if (audioSelection.coordinator.acceptFact(f)) return;
    speed.observe(f);
    if (f.rateError && before.intent === 'playing') playback.pause();
    if (f.type === 'seekApplied') {
      playback.seekApplied(f.intentId, f.seekRevision, f.position, f.paused ? 'paused' : 'playing');
      return;
    }
    if (f.type === 'firstFrame' || f.type === 'rateStatus') return;
    if (f.type === 'ready') playback.ready(f.intentId);
    else if (f.type === 'seekFailed') playback.seekFailed(f.intentId, f.seekRevision, f.error);
    else if (f.type === 'error') {
      // The engine refusing what it was given is not yet the viewer's problem: the server is
      // told which route failed and the title comes back through the next one up.
      const engine = failure.engine;
      if (engine) playback.engineFailed(f.intentId, engine, typeof f.errorDetail === 'string' ? f.errorDetail.slice(0, 120) : '', f.error);
      else playback.fail(f.intentId, f.error);
    }
    else playback.fact(f.intentId, f.position, f.type === 'ended' ? 'ended' : f.paused ? 'paused' : 'playing');
  };
  const bridge = useMemo(() => {
    const module = NativeModules.PorticoPlaybackModule;
    const emitter = new NativeEventEmitter(module);
    return new NativePlaybackCoordinator(
      playback,
      {
        acquire: owner => module.acquire(owner),
        command: value => module.command(value),
        release: lease => module.release(lease),
        subscribe: listener => {
          const sub = emitter.addListener('PorticoPlaybackFact', listener);
          return () => sub.remove();
        },
      },
      () => NativeModules.PorticoRuntime.playbackRequestId(),
      snapshot => (!snapshot.session ? '' : isLocalSource(snapshot.session.streamUrl) ? snapshot.session.streamUrl : api.mediaUrl(snapshot.session.streamUrl)),
      f => factHandler.current(f),
      // Two engines, one contract (Native/ENGINE-CONTRACT.md): the coordinator holds a lease on
      // whichever one `chooseEngineFor` names, and moves the title across when that changes.
      {initial: 'native', choose: chooseEngineFor, transport: engine => (engine === 'mpv' ? engineTransport('mpv') : engineTransport('native'))},
    );
  }, [playback, api, chooseEngineFor]);
  const bridgeRef = useRef(bridge);
  bridgeRef.current = bridge;
  engineNow.current = () => bridge.getEngine() as EngineKind;
  const engineKind = useSyncExternalStore(bridge.subscribe, bridge.getEngine) as EngineKind;
  // The plan may name another engine for the same session (a re-plan): asked again when it does.
  useEffect(() => path.subscribeSessions(() => bridge.reconsiderEngine()), [path, bridge]);
  // A change of the setting, or learning that the title is music, is acted on at once: the title
  // moves to the other engine at the position it had reached, in the same session and queue.
  useEffect(() => bridge.reconsiderEngine(), [bridge, engineSetting, isAudio]);
  useEffect(() => { setEngineMedia(null); bridge.setAudioTrack(null); }, [bridge, playbackState.intentId, playbackState.session?.id, playbackState.session?.generation, engineKind]);
  useEffect(() => {
    const update = () => bridge.setConnection(!api.getRouteSnapshot() || api.getRouteSnapshot()?.phase === 'ready');
    update();
    bridge.start();
    playback.setStartupProbe(() => bridge.diagnostics());
    const detach = api.subscribeRoute(update);
    return () => {
      detach();
      bridge.stop();
      playback.setStartupProbe(undefined);
    };
  }, [bridge, api, playback]);
  // The session-bound offer: its markers, the source's facts for Playback info, and the owner's
  // switches. (Quality is not chosen from it: that is the title's options, below.)
  const offerScope = useMemo(() => viewerScope(session, api), [session, api]);
  const offersService = useMemo(() => (offerScope ? new PlayerOffersService({api, scope: offerScope}) : null), [api, offerScope?.serverId, offerScope?.viewerId, identity.itemId, identity.libraryId, playbackState.session?.id]); // eslint-disable-line react-hooks/exhaustive-deps
  const offers = useSyncExternalStore(offersService?.subscribe ?? noSubtitleSubscribe, offersService?.getSnapshot ?? noOffers);
  useEffect(() => {
    if (!offersService || isAudio || !identity.itemId || !identity.libraryId) return;
    try { void offersService.select({libraryId: identity.libraryId, itemId: identity.itemId, ...(playbackState.session?.id ? {sessionId: playbackState.session.id} : {})}).catch(() => {}); } catch {}
    return () => offersService.dispose();
  }, [offersService, isAudio, identity.itemId, identity.libraryId, playbackState.session?.id]);
  const offersData = offers?.phase === 'ready' && offers.data?.scope.itemId === identity.itemId ? offers.data : null;

  // What the title offers (`playback-options`): its versions, its quality menu, its chapters and
  // the tracks the server would choose. Read for the version being played, and kept per title so
  // the pre-play read is not asked for twice.
  const optionsClient = useMemo(() => new PlaybackOptionsClient(localV1Http(api)), [api]);
  const optionsKnown = useRef(new Map<string, TitleOptions>());
  const [titleOptions, setTitleOptions] = useState<TitleOptions | null>(null);
  const serverVideo = playbackState.session?.protocol === 'v1' && !playbackState.channel && !playbackState.nativeListening && !playbackState.session.audio;
  const optionsItem = serverVideo ? playbackState.itemId : undefined;
  const optionsVersion = v1Session?.versionId;
  useEffect(() => {
    if (!optionsItem) { setTitleOptions(null); return; }
    const key = `${optionsItem}/${optionsVersion ?? ''}`;
    const generic = optionsKnown.current.get(`${optionsItem}/`);
    // The answer read before the title started is the answer for the version it chose to play.
    const known = optionsKnown.current.get(key) ?? (generic && (!optionsVersion || generic.preferred?.versionId === optionsVersion) ? generic : undefined);
    setTitleOptions(known ?? generic ?? null);
    if (known) return;
    let live = true;
    void optionsClient.options(optionsItem, optionsVersion ? {versionId: optionsVersion} : {}).then(options => {
      optionsKnown.current.set(key, options);
      if (optionsKnown.current.size > 24) optionsKnown.current.delete(optionsKnown.current.keys().next().value!);
      if (live) setTitleOptions(options);
    }, () => {});
    return () => { live = false; };
  }, [optionsClient, optionsItem, optionsVersion]);
  const options = titleOptions && titleOptions.itemId === playbackState.itemId ? titleOptions : null;
  const playingVersion = options?.versions.find(v => v.id === (v1Session?.versionId ?? options.preferred?.versionId)) ?? options?.versions[0];

  // Quality. The default is the original; the title's menu is the server's (the original,
  // Automatic, then each fixed quality below the picture); the tick is the quality in force on
  // the session. A choice re-plans the session where it stands: the same session, the same place
  // in the queue, Up Next untouched.
  const qualityInForce = presentation?.quality;
  const [qualityBusy, setQualityBusy] = useState(false);
  const chooseQuality = useCallback((option: QualityOption): Promise<void> => {
    path.forgetAutomaticStep();
    const throughputKbps = path.throughputKbps;
    setQualityBusy(true);
    return playback.changePlayback({quality: qualityOptionRequest(option), ...(option.mode === 'fixed' && throughputKbps ? {throughputKbps: Math.round(throughputKbps)} : {})}).finally(() => setQualityBusy(false));
  }, [playback, path]);
  const chooseVersion = useCallback((versionId: string): Promise<void> => playback.changePlayback({versionId}), [playback]);
  // Automatic: this device measures its connection as it plays and asks the server to move down a
  // step when the connection cannot carry the picture, and back up when it can.
  const automaticOn = serverVideo && qualityInForce?.mode === 'automatic';
  const automaticKey = automaticOn && options ? JSON.stringify([options.itemId, playingVersion?.id, options.qualities.map(q => q.id ?? q.mode)]) : '';
  useEffect(() => {
    if (!automaticOn) { path.setAutomatic(null); return; }
    path.setAutomatic({steps: automaticSteps(options?.qualities ?? []), ...(playingVersion?.bitrateKbps ? {originalKbps: playingVersion.bitrateKbps} : {})});
  }, [path, automaticOn, automaticKey]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => () => path.setAutomatic(null), [path]);
  useEffect(() => path.onNotice(notice => {
    const i18n = activeI18n();
    const quality = notice.step ? i18n.t('quality.height', {height: notice.step.height}) : i18n.t('player.quality.original');
    showToast({message: i18n.t(notice.type === 'qualityLowered' ? 'web.player.quality.lowered' : 'web.player.quality.raised', {quality}), icon: 'quality'});
  }), [path]);

  // The Player setting changed while a server title is playing. The server plans for the setting
  // it holds, so once it has the new one the playing session is planned again in place: the same
  // session on the same queue entry, with Up Next, the position, a pause and every choice kept.
  // (A download has no plan: the coordinator has already moved it.)
  const settingSeen = useRef(engineSetting);
  useEffect(() => {
    if (settingSeen.current === engineSetting) return;
    settingSeen.current = engineSetting;
    const state = playback.getSnapshot(), session = state.session, itemId = state.itemId, intent = state.intentId;
    if (!session || !itemId || state.channel || engineInputs.current.audio || isLocalSession(session.id) || !path.session(session.id) || !['starting', 'ready'].includes(state.phase)) return;
    void engineSettingStore.whenSettled(4000, engineSetting).then(() => {
      const now = playback.getSnapshot();
      if (now.intentId !== intent || now.itemId !== itemId || now.session?.id !== session.id || !['starting', 'ready'].includes(now.phase) || engineInputs.current.setting !== engineSetting) return;
      void replanEngine(playback).catch(() => {});
    });
  }, [engineSetting, playback, path]);

  // Subtitles: the native player draws the text; this side chooses what it draws. The selection
  // is bound to the exact session generation, so a stale choice can never reach a new stream.
  const subtitleScope = !isAudio && playbackState.session && !isLocalSession(playbackState.session.id) && playbackState.itemId && !playbackState.channel && !['error', 'ended', 'idle'].includes(playbackState.phase) ? playbackState.session : undefined;
  const subtitleService = useMemo(() => subtitleScope && playbackState.itemId ? new SubtitleService(api, {itemId: playbackState.itemId, sessionId: subtitleScope.id, generation: subtitleScope.generation}, operationId, {
    install: presentation => playback.getSnapshot().intentId === playbackState.intentId && playback.installSubtitlePresentation(presentation),
  }) : null, [api, playback, playbackState.itemId, playbackState.intentId, subtitleScope?.id, subtitleScope?.generation]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    subtitleService?.start();
    const listener = AppState.addEventListener('change', next => { if (next === 'active') void subtitleService?.refresh(); });
    return () => { listener.remove(); subtitleService?.stop(); };
  }, [subtitleService]);
  const subtitles = useSyncExternalStore(subtitleService?.subscribe ?? noSubtitleSubscribe, subtitleService?.getSnapshot ?? noSubtitles);
  /**
   * Chooses a subtitle track (`null`: off). The choice is a change to the playing session, so the
   * server decides how the track reaches the screen from what this device's engines draw: plain
   * cues beside the stream, the original file for an engine that draws it itself (moving the
   * title to that engine when the Player setting allows), or, failing both, in the picture. The
   * session, the queue and the position are kept, and the server remembers the choice for the
   * show. A timing correction (`offsetUs`) travels with the track. It is the only way a choice is
   * made: a session that refuses is the answer, and the subtitles stay as they were. A session
   * that moved on since (another change landed first) is read again and asked once more.
   */
  const chooseSubtitleTrack = useCallback(async (resource: SubtitleResource | null, offsetUs?: string): Promise<void> => {
    if (!playback.changesInPlace()) throw new Error('Subtitles cannot be changed on this playback.');
    const offset = Number(offsetUs ?? resource?.offsetUs ?? 0);
    const change = resource ? {subtitleTrackId: resource.id, subtitleOffsetMs: Number.isFinite(offset) ? Math.max(-600000, Math.min(600000, Math.round(offset / 1000))) : 0} : {subtitleTrackId: null};
    try { await playback.changePlayback(change); }
    catch (error) {
      if ((error as {status?: unknown} | null)?.status !== 409) throw error;
      await subtitleService?.refresh();
      await playback.changePlayback(change);
    }
    void subtitleService?.refresh();
  }, [playback, subtitleService]);
  // Pick before play: the title page's audio and subtitle choice, applied by the shared rule
  // (client-core `pending-track-choice`): audio first, then subtitles on the session left standing.
  const pendingChoice = useRef<PendingChoiceProgress>({});
  useEffect(() => { pendingChoice.current = {choice: playbackState.itemId ? takePendingTrackChoice(playbackState.itemId) : undefined}; }, [playbackState.itemId]);
  useEffect(() => {
    const session = playbackState.session;
    if (!session || pendingChoice.current.choice?.itemId !== playbackState.itemId) return;
    const plan = subtitles.plan && subtitles.plan.sessionId === session.id ? subtitles.plan : undefined;
    pendingChoice.current = advancePendingChoice(pendingChoice.current, {
      sessionId: session.id,
      audio: {availability: playbackState.audio.availability, renditions: playbackState.audio.plan?.renditions},
      tracks: playbackState.audioTracks,
      subtitles: subtitleService && plan ? {mode: plan.mode, selectedId: plan.selected?.id, busy: subtitles.busy, resources: plan.resources} : undefined,
    }, {
      selectRendition: id => { playback.selectAudio(id); },
      selectTrack: stream => { void playback.selectAudioTrack(stream).catch(() => {}); },
      chooseSubtitle: id => { const resource = id ? plan?.resources.find(r => r.id === id) : null; if (resource !== undefined) void chooseSubtitleTrack(resource).catch(() => {}); },
    });
  }, [playbackState.session, playbackState.itemId, playbackState.audio, playbackState.audioTracks, subtitles.plan, subtitles.busy, subtitleService, playback, chooseSubtitleTrack]);
  const subtitlePlan = subtitles.plan && playbackState.session && subtitles.plan.sessionId === playbackState.session.id ? subtitles.plan : null;
  // A track the engine reads from the file it is playing: the server's own copy of the choice is
  // off then, and the session's presentation is what says which track shows.
  const deviceTrack = useMemo(() => (presentation ? deviceDrawnTrack(subtitlePlan, v1Session) : undefined), [presentation, subtitlePlan, v1Session]);
  // Portico's caption style (the profile's size and background), applied by every engine on top
  // of the system's own caption settings.
  const captionSize = speedPreferences.value<string>('playback.subtitleSize', 'medium'), captionBackground = speedPreferences.value<string>('playback.subtitleBackground', 'translucent');
  const captions = useMemo(() => captionStyle(captionSize, captionBackground), [captionSize, captionBackground]);
  // A styled track's attached fonts: the list is read once per track, for the engine to fetch.
  const subtitleFontsUrl = engineKind === 'mpv' && !subtitles.suppressed ? fontsUrlOf(subtitlePlan, presentation ? v1Session : undefined) : undefined;
  const [subtitleFonts, setSubtitleFonts] = useState<SubtitleFonts | null>(null);
  useEffect(() => {
    if (!subtitleFontsUrl) { setSubtitleFonts(null); return; }
    let live = true;
    const settle = (raw: unknown) => { if (live) setSubtitleFonts(parseSubtitleFonts(raw, subtitleFontsUrl)); };
    void api.request<unknown>(subtitleFontsUrl, 'GET').then(settle, () => settle(null));
    return () => { live = false; };
  }, [api, subtitleFontsUrl]);
  // A download's own subtitle tracks (files on this device), chosen here and nowhere else.
  const [offlineExtras, setOfflineExtras] = useState<LocalMedia['extras']>();
  const localSession = isLocalSession(playbackState.session?.id) ? playbackState.session : undefined;
  const offlineTracks = useMemo(() => (localSession ? offlineSubtitleTracks(offlineExtras, mpvAvailable && engineSetting !== 'native' ? engineFeatures('mpv').subtitleRendering : engineFeatures('native').subtitleRendering) : []), [localSession?.id, offlineExtras, engineSetting]); // eslint-disable-line react-hooks/exhaustive-deps
  const [offlineSubtitle, setOfflineSubtitle] = useState<{id: string | null; revision: number}>({id: null, revision: 1});
  useEffect(() => setOfflineSubtitle(prev => ({id: null, revision: prev.revision + 1})), [localSession?.id]);
  const offlineTrack = offlineTracks.find(t => t.id === offlineSubtitle.id);
  const chooseOfflineSubtitle = useCallback((id: string | null) => setOfflineSubtitle(prev => ({id, revision: prev.revision + 1})), []);
  const subtitleCommand = useMemo(() => {
    const session = playbackState.session;
    if (!session) return null;
    const binding = {intentId: playbackState.intentId, sessionId: session.id, generation: session.generation};
    if (localSession) return offlineSubtitleCommand(offlineTrack, binding, offlineSubtitle.revision, engineFeatures(engineKind).subtitleRendering, captions);
    const plan = subtitlePlan;
    if (!plan) return null;
    const selected = plan.mode === 'track' && !subtitles.suppressed ? plan.selected : null;
    if (!selected && !deviceTrack) return {binding, mode: 'off', revision: plan.revision};
    // An engine that draws styled and image subtitles itself (mpv) is told where the track is;
    // the cue document, when there is one, is what it falls back to. The native engine draws the
    // cue document and is never given `render`.
    const render = engineKind === 'mpv' ? engineSubtitleRender(plan, session, engineFeatures('mpv').subtitleRendering, path => new URL(path, api.baseUrl).href, subtitleFontsUrl ? (subtitleFonts?.key === subtitleFontsUrl ? subtitleFonts : 'pending') : undefined, presentation ? v1Session : undefined) : undefined;
    const documentUrl = selected ? plan.documentUrl : undefined;
    if (!documentUrl && !render) return {binding, mode: 'off', revision: plan.revision};
    const track = selected ?? deviceTrack?.resource;
    return {binding, mode: 'track', revision: plan.revision, resourceId: selected?.id ?? deviceTrack!.id, resourceRevision: track?.revision ?? 1, manifestName: track?.manifestName, origin: track?.origin ?? 'embedded', language: track?.language ?? '', title: track?.title ?? '', offsetUs: selected ? plan.offsetUs : '0', ...(documentUrl ? {documentUrl: new URL(documentUrl, api.baseUrl).href} : {}), refreshRevision: 0, ...(render ? {render} : {}), ...(render && (render.kind === 'pgs' || render.kind === 'vobsub') && forcedOnly ? {forcedOnly: true} : {}), style: captions};
  }, [subtitlePlan, subtitles.suppressed, deviceTrack, playbackState.session, playbackState.intentId, api, engineKind, subtitleFontsUrl, subtitleFonts, presentation, v1Session, captions, localSession, offlineTrack, offlineSubtitle.revision, forcedOnly]);
  // A chosen track the device is to draw in a kind only mpv draws moves the title to mpv (and
  // back when the choice changes). The server's plan names mpv for such a track already; this
  // holds for a download, and for the moment before a plan arrives.
  const neededRendering: SubtitleKind | undefined = localSession ? (offlineTrack && offlineTrack.kind !== 'text' ? offlineTrack.kind : undefined) : !subtitles.suppressed || deviceTrack ? requiredSubtitleRendering(subtitlePlan, presentation ? v1Session : undefined) : undefined;
  useEffect(() => { engineInputs.current.rendering = neededRendering; bridge.reconsiderEngine(); }, [bridge, neededRendering]);
  // What a download says of its own file decides whether the platform player can open it.
  useEffect(() => { engineInputs.current.container = localSession ? offlineContainer(offlineExtras) : undefined; bridge.reconsiderEngine(); }, [bridge, localSession?.id, offlineExtras]); // eslint-disable-line react-hooks/exhaustive-deps
  // The timeline says which tracks are in force and at what speed (spec §17).
  const shownSubtitleId = subtitlePlan && subtitlePlan.mode === 'track' && !subtitles.suppressed ? subtitlePlan.selected?.id ?? null : deviceTrack?.id ?? null;
  useEffect(() => path.setTracks(presentation?.audioTrackId, presentation ? shownSubtitleId : undefined), [path, presentation?.audioTrackId, presentation, shownSubtitleId]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => path.setRate(speedState.desired), [path, speedState.desired]);
  // A file played as it is by an engine that chooses among its audio tracks itself (mpv) starts
  // on the track the server chose: the one asked for, or the language this profile last picked.
  const plannedAudio = engineKind === 'mpv' && presentation?.mode === 'direct' ? audioStreamIndex(presentation.audioTrackId) : undefined;
  useEffect(() => {
    const session = playback.getSnapshot().session;
    if (plannedAudio === undefined || !session || !engineFeatures('mpv').audioTrackSwitching) return;
    bridge.setAudioTrack({binding: {intentId: playback.getSnapshot().intentId, sessionId: session.id, generation: session.generation}, revision: ++engineAudioRevision.current, streamIndex: plannedAudio});
  }, [bridge, playback, plannedAudio, playbackState.intentId, playbackState.session?.id, playbackState.session?.generation, engineKind]);
  useEffect(() => bridge.setOptions(speedState.desired, audioSelection.command, subtitleCommand), [bridge, speedState.desired, audioSelection.command, subtitleCommand]);
  const lease = useSyncExternalStore(bridge.subscribe, bridge.getSnapshot);
  useEffect(() => {
    if (lease) audioSelection.coordinator.retryMapping();
  }, [lease, audioSelection.coordinator]);
  // Lock screen / Now Playing metadata for the native listening owner.
  useEffect(() => {
    const owner = playbackState.nativeListening?.owner;
    if (owner && identity.itemId === playbackState.itemId)
      NativeModules.PorticoPlaybackModule.listeningMetadata(owner, {playbackId: playbackState.session?.id, itemId: playbackState.itemId, title: identity.title, artist: identity.artist ?? '', album: identity.album ?? '', posterUrl: identity.posterUrl ?? null});
  }, [playbackState.nativeListening?.owner, playbackState.session?.id, playbackState.itemId, identity]);

  const active = playbackState.phase !== 'idle';

  /* APP-07: the item whose presentation identity is deliberately on screen.
   *
   * An explicit play declares its item, so the identity it set is not treated as
   * stale while playback catches up. Anything the queue moves to on its own was
   * never declared, which is exactly the case that used to keep the first item's
   * title, artwork, media kind, library and Now Playing identity. */
  const declared = useRef<string | undefined>(undefined);
  const describeGeneration = useRef(0);
  useEffect(() => {
    const itemId = playbackState.itemId;
    if (!itemId || playbackState.channel || itemId === declared.current) return;
    declared.current = itemId;
    const generation = ++describeGeneration.current;
    // The old item's details are wrong the moment the queue moves on, so they go
    // now; the record that replaces them arrives a moment later.
    setIdentity({itemId, title: ''});
    void api.item(itemId).then(item => {
      if (generation !== describeGeneration.current) return;
      setIdentity({itemId, title: item.title, posterUrl: item.posterUrl, backdropUrl: item.backdropUrl, kind: item.kind, libraryId: item.libraryId});
    }, () => {});
  }, [api, playbackState.itemId, playbackState.channel]);

  // F-native OS-01 / APL-AUDIO-02: episodes publish their show's name, and songs their artist and
  // album (Now Playing, the mini bar, the lock screen). Entries don't carry them, so they are read
  // once from the item's detail and remembered.
  useEffect(() => {
    const itemId = identity.itemId;
    const wants = identity.kind === 'episode' ? !identity.seriesTitle : identity.kind === 'song' ? !identity.artist : false;
    if (!itemId || !wants || identity.offline) return;
    const known = extraTitles.get(itemId);
    if (known) { setIdentity(prev => (prev.itemId === itemId ? {...prev, ...known} : prev)); return; }
    let live = true;
    void api.request<{item?: {episode?: {showTitle?: unknown; seasonNumber?: unknown; number?: unknown}; song?: {albumArtist?: unknown; artist?: unknown; albumTitle?: unknown}}}>(`/v1/items/${encodeURIComponent(itemId)}/detail`, 'GET').then(raw => {
      const text = (v: unknown) => (typeof v === 'string' && v ? v : undefined);
      const number = (v: unknown) => (typeof v === 'number' && Number.isInteger(v) && v >= 0 ? v : undefined);
      const ep = raw?.item?.episode;
      const code = ep && number(ep.number) ? (number(ep.seasonNumber) ? activeI18n().t('title.episodeCode', {season: number(ep.seasonNumber)!, episode: number(ep.number)!}) : activeI18n().t('title.episodeOnly', {episode: number(ep.number)!})) : undefined;
      const extra: Partial<NowPlaying> = ep ? {seriesTitle: text(ep.showTitle), episodeCode: code} : raw?.item?.song ? {artist: text(raw.item.song.artist) ?? text(raw.item.song.albumArtist), album: text(raw.item.song.albumTitle)} : {};
      if (!Object.values(extra).some(Boolean)) return;
      extraTitles.set(itemId, extra);
      if (extraTitles.size > 500) extraTitles.delete(extraTitles.keys().next().value!);
      if (live) setIdentity(prev => (prev.itemId === itemId ? {...prev, ...extra} : prev));
    }, () => {});
    return () => { live = false; };
  }, [api, extraTitles, identity.itemId, identity.kind, identity.seriesTitle, identity.artist, identity.offline]);

  const startSingle = useCallback(
    (itemId: string, startSeconds: number, entry?: ContentEntry) => {
      declared.current = itemId;
      const generation = ++describeGeneration.current;
      setIdentity({itemId, title: entry?.title ?? '', subtitle: entry?.subtitle, posterUrl: entry?.posterUrl, backdropUrl: entry?.backdropUrl, kind: entry?.kind, libraryId: entry?.libraryId});
      // A play that names only the item (a handoff, a deep link) reads its title at once, in
      // parallel with starting playback, rather than showing a placeholder until playback settles.
      if (!entry?.title) {
        void api.item(itemId).then(item => {
          if (generation !== describeGeneration.current) return;
          setIdentity({itemId, title: item.title, posterUrl: item.posterUrl, backdropUrl: item.backdropUrl, kind: item.kind, libraryId: item.libraryId});
        }, () => {});
      }
      setPipActive(false);
      setExpanded(opensFull(entry?.kind));
      ensureQueue();
      // Pick before play: a version chosen on the title's page is the one the title starts on.
      const versionId = takePendingVersion(itemId);
      void playback.play(itemId, startSeconds, undefined, undefined, undefined, versionId ? {versionId} : undefined).catch(() => {});
    },
    [api, playback, ensureQueue],
  );
  /** The newest play intent: a preflight that answers after a newer play, or after the player
   * was closed, must not start its title. */
  const intent = useRef(0);
  useEffect(() => () => { intent.current++; describeGeneration.current++; }, [playback]);
  /** Behind presence: older servers have no Dolby reason and read as no warning (fail open). */
  const checkDolbyFor = useCallback(async (itemId: string): Promise<boolean> => {
    const read = api.request<unknown>(`/v1/items/${encodeURIComponent(itemId)}/playback-options`, 'GET').then(raw => {
      // MU4 COMPAT-01: keep the source facts from this same answer for the subtitle warning,
      // and the title's chapters for the lock screen's Next and Previous.
      sourceFactsRef.current.set(itemId, sourceFactsOf(raw));
      if (sourceFactsRef.current.size > 50) sourceFactsRef.current.delete(sourceFactsRef.current.keys().next().value!);
      chaptersRef.current.set(itemId, chaptersOf((raw as {chapters?: unknown} | null)?.chapters));
      if (chaptersRef.current.size > 50) chaptersRef.current.delete(chaptersRef.current.keys().next().value!);
      // The same answer is the title's options (its quality menu, versions and tracks) once it plays.
      try { optionsKnown.current.set(`${itemId}/`, parseOptions(raw)); } catch { /* an answer this app cannot read is asked for again when the title plays */ }
      return dolbyVisionWarningNeeded(raw);
    }, () => false);
    // The check is a courtesy, not a gate: a busy or distant server must not hold every start
    // for as long as the request takes. After a short wait the title starts without it (the
    // answer is still kept when it arrives).
    return Promise.race([read, new Promise<boolean>(resolve => setTimeout(() => resolve(false), 1500))]);
  }, [api]);
  /** A start that was asked to begin paused: the pause waits for the load (`pauseNextStart`). */
  const stopPausedStart = useRef(() => {});
  useEffect(() => () => stopPausedStart.current(), [playback]);
  const play = useCallback(
    (itemId: string, startSeconds: number, entry?: ContentEntry, start?: Readonly<{/** Begin paused: the title is loaded and shows its frame, silent, until someone presses Play (a Watch Together room that is paused). */ paused?: boolean}>) => {
      const mine = ++intent.current;
      setDolbyPending(null);
      // Armed before the load is asked for, so the first thing the engine hears of the title is "paused".
      stopPausedStart.current();
      stopPausedStart.current = start?.paused ? pauseNextStart(playback, itemId, playback.getSnapshot().intentId) : () => {};
      if (!mayCarryVideo(entry?.kind) || dolbyAcknowledged.current.has(itemId)) { startSingle(itemId, startSeconds, entry); return; }
      void checkDolbyFor(itemId).then(needs => {
        if (mine !== intent.current) return;
        if (!needs) startSingle(itemId, startSeconds, entry);
        else setDolbyPending({intent: mine, kind: 'single', itemId, startSeconds, entry});
      });
    },
    [startSingle, checkDolbyFor, playback],
  );
  /** OS-07: play a download in this player. What it shows comes from the download itself (no
   * library, so no quality ladder or audio choices), and its progress stays on the device. */
  const playOffline = useCallback(
    async (pendingMedia: LocalMedia | Promise<LocalMedia>, display: OfflineDisplay) => {
      const mine = ++intent.current;
      setDolbyPending(null);
      const media = await pendingMedia;
      if (mine !== intent.current) return;
      declared.current = media.itemId;
      describeGeneration.current++;
      setIdentity({itemId: media.itemId, title: display.title, subtitle: display.subtitle, posterUrl: display.artworkUrl, kind: display.kind, offline: true});
      // What came with the download: its subtitle files, chapters and skip markers.
      setOfflineExtras(media.extras);
      setPipActive(false);
      setExpanded(true);
      return playLocal(media);
    },
    [playLocal],
  );
  const tune = useCallback(
    (channel: GuideChannel, lineup?: Lineup) => {
      intent.current++;
      setDolbyPending(null);
      channelTuned(channel, lineup);
      declared.current = undefined;
      describeGeneration.current++;
      setIdentity({title: channel.name, kind: 'channel', channel: true});
      setPipActive(false);
      setExpanded(true);
      void playback.playChannel({kind: channel.provenance, sourceId: channel.sourceId, channelId: channel.id, generation: channel.generation}).catch(() => {});
    },
    [playback],
  );
  /** Play `entries[index]` and queue what follows it, so Up Next has somewhere to go. */
  const startSequenceInner = useCallback(
    (entries: readonly ContentEntry[], index: number, startSeconds: number, container?: SequenceContainer) => {
      const playable = entries.slice(index).filter(e => e.playback);
      const first = playable[0];
      if (!first?.playback) return;
      ensureQueue();
      // A whole show, season, collection, playlist or book is one server request.
      const plan = containerPlay(container, first.playback.itemId, startSeconds);
      const v1 = plan ? v1Queue() : undefined;
      if (plan && v1) {
        declared.current = first.playback.itemId;
        describeGeneration.current++;
        setIdentity({itemId: first.playback.itemId, title: first.title, subtitle: first.subtitle, posterUrl: first.posterUrl, backdropUrl: first.backdropUrl, kind: first.kind, libraryId: first.libraryId});
        setPipActive(false);
        setExpanded(opensFull(first.kind));
        void v1.playSelector(plan.selector, plan.options).catch(() => {});
        return;
      }
      const queue = playback.getQueueController();
      if (!queue || playable.length === 1) {
        startSingle(first.playback.itemId, startSeconds, first);
        return;
      }
      declared.current = first.playback.itemId;
      describeGeneration.current++;
      setIdentity({itemId: first.playback.itemId, title: first.title, subtitle: first.subtitle, posterUrl: first.posterUrl, backdropUrl: first.backdropUrl, kind: first.kind, libraryId: first.libraryId});
      setPipActive(false);
      setExpanded(opensFull(first.kind));
      void queue.playEntries(playable.map(e => queueItemInput(e.playback!.itemId)), {startSeconds}).catch(() => {});
    },
    [playback, startSingle, ensureQueue, v1Queue],
  );
  const playSequence = useCallback(
    (entries: readonly ContentEntry[], index: number, startSeconds: number, container?: SequenceContainer) => {
      const mine = ++intent.current;
      setDolbyPending(null);
      const first = entries.slice(index).filter(e => e.playback)[0];
      const firstId = first?.playback?.itemId;
      if (!firstId) { startSequenceInner(entries, index, startSeconds, container); return; }
      if (!mayCarryVideo(first?.kind) || dolbyAcknowledged.current.has(firstId)) { startSequenceInner(entries, index, startSeconds, container); return; }
      void checkDolbyFor(firstId).then(needs => {
        if (mine !== intent.current) return;
        if (!needs) startSequenceInner(entries, index, startSeconds, container);
        else setDolbyPending({intent: mine, kind: 'sequence', entries, index, startSeconds, container});
      });
    },
    [startSequenceInner, checkDolbyFor],
  );
  const confirmDolby = useCallback(() => {
    const pending = dolbyPending;
    if (!pending || pending.intent !== intent.current) return;
    if (pending.kind === 'single') {
      dolbyAcknowledged.current.add(pending.itemId);
      setDolbyPending(null);
      startSingle(pending.itemId, pending.startSeconds, pending.entry);
    } else {
      const first = pending.entries.slice(pending.index).filter(e => e.playback)[0];
      if (first?.playback) dolbyAcknowledged.current.add(first.playback.itemId);
      setDolbyPending(null);
      startSequenceInner(pending.entries, pending.index, pending.startSeconds, pending.container);
    }
  }, [dolbyPending, startSingle, startSequenceInner]);
  const dismissDolby = useCallback(() => setDolbyPending(null), []);
  /** Advance past a held completion through the server's post-play policy. */
  const advance = useCallback(async (mode: 'automatic' | 'manual' | 'still-watching') => {
    await playback.getQueueController()?.continueCompletion(mode);
  }, [playback]);
  const identityRef = useRef(identity);
  identityRef.current = identity;
  /** After an error the old request is gone; start a fresh one for the same item. */
  const retry = useCallback(() => {
    const state = playback.getSnapshot();
    const itemId = state.itemId ?? identityRef.current.itemId;
    // The server ended it (the owner stopped it): no retry from here; the person plays again deliberately.
    if (!itemId || state.ended) return;
    intent.current++;
    setDolbyPending(null);
    // A download retries from its own file, where it stopped (the service kept how to make it).
    if (identityRef.current.offline) {
      void playback.retry().catch(() => {});
      return;
    }
    // A title that never started (a resume that failed before its first frame) retries at the
    // position it was asked for, not at 0:00 (demo, 23 Sep).
    void playback.play(itemId, playback.recoveryTarget() ?? (state.positionSeconds || 0)).catch(() => {});
  }, [playback]);
  /** Someone asked for the title to play: a start that was to begin paused no longer is. */
  const cancelPausedStart = useCallback(() => { stopPausedStart.current(); stopPausedStart.current = () => {}; }, []);
  const toggle = useCallback(() => {
    cancelPausedStart();
    const state = playback.getSnapshot();
    if (state.phase === 'error') retry();
    else if (groupControl.current?.toggle(state.intent === 'playing')) return;
    else if (state.intent === 'playing') playback.pause();
    else playback.resume();
  }, [playback, retry, cancelPausedStart]);
  const seekBy = useCallback((delta: number) => {
    const state = playback.getSnapshot();
    const target = Math.max(0, Math.min(state.duration || Infinity, (state.pendingSeek?.positionSeconds ?? state.positionSeconds) + delta));
    if (groupControl.current?.seek(target)) return;
    playback.seek(target);
  }, [playback]);
  const seekTo = useCallback((seconds: number) => { if (!groupControl.current?.seek(Math.max(0, seconds))) playback.seek(Math.max(0, seconds)); }, [playback]);
  // Next and Previous: the group's while watching its title together, otherwise the queue's.
  const step = useCallback((action: 'next' | 'previous') => { void stepQueue(playback, action, groupControl.current).catch(() => {}); }, [playback]);
  // APL-HOME-03: a finished title, and a minute of playing, also count as a change of progress.
  useEffect(() => {
    if (playbackState.phase === 'ended') emitPlaybackChange({itemId: playbackState.itemId, positionSeconds: playbackState.positionSeconds, completed: true, reason: 'ended'});
  }, [playbackState.phase]); // eslint-disable-line react-hooks/exhaustive-deps
  const playingNow = playbackState.intent === 'playing' && playbackState.phase === 'ready';
  useEffect(() => {
    if (!playingNow) return;
    const timer = setInterval(() => { const snap = playback.getSnapshot(); emitPlaybackChange({itemId: snap.itemId, positionSeconds: snap.positionSeconds, completed: false, reason: 'progress'}); }, 60000);
    return () => clearInterval(timer);
  }, [playingNow, playback]);
  const leave = useCallback(() => {
    intent.current++;
    setDolbyPending(null);
    const snap = playback.getSnapshot();
    emitPlaybackChange({itemId: snap.itemId, positionSeconds: snap.positionSeconds, completed: snap.phase === 'ended', reason: 'closed'});
    playback.leave();
    topShelfChanged();
    if (Platform.isTV) restoreInvoker();
    setExpanded(false);
    setPipActive(false);
  }, [playback]);
  /** Chooses one of a file's audio tracks. For a title from the server the choice is a change to
   * the playing session: the server re-plans it with that track where it stands and remembers the
   * language for the rest of the show. A download has no server: an engine that switches tracks
   * itself (mpv) does so at once. */
  const selectAudioTrack = useCallback((streamIndex: number): Promise<void> => {
    const state = playback.getSnapshot(), session = state.session;
    const inEngine = bridge.getEngine() === 'mpv' && engineFeatures('mpv').audioTrackSwitching && !!session && isLocalSession(session.id) && !!state.audioTracks?.tracks.some(t => t.streamIndex === streamIndex);
    if (!inEngine || !session) return playback.selectAudioTrack(streamIndex);
    bridge.setAudioTrack({binding: {intentId: state.intentId, sessionId: session.id, generation: session.generation}, revision: ++engineAudioRevision.current, streamIndex});
    return Promise.resolve();
  }, [playback, bridge]);
  /** The kind an engine of this device would draw `resource` in itself, so the menu can say
   * whether a styled or image track will be drawn on the device or has to be burned into the
   * picture. Undefined: plain text, or no engine here draws it. The viewer's Player setting
   * decides which engines count. */
  const subtitleRendering = useCallback((resource: Parameters<typeof renderingToRequest>[0]) => {
    const audio = engineInputs.current.audio, setting = engineInputs.current.setting;
    const usable = setting === 'native' || !mpvAvailable || audio || !!playback.getSnapshot().channel ? engineFeatures('native').subtitleRendering : [...new Set([...engineFeatures('native').subtitleRendering, ...engineFeatures('mpv').subtitleRendering])];
    return renderingToRequest(resource, usable);
  }, [playback]);
  // Chapters: the server's for the title (with their pictures), else what the engine found in the
  // file, else what a download brought with it.
  // A chapter's picture is the server's chapter image (`thumbnailUrl` of the session's chapter
  // list), matched to the title's chapters by start; a chapter without one has none.
  const chapterSession = serverVideo && playbackState.session && !isLocalSession(playbackState.session.id) && !playbackState.channel ? playbackState.session.id : undefined;
  const [chapterImages, setChapterImages] = useState<{session: string; images: ReadonlyMap<number, string>}>();
  useEffect(() => {
    if (!chapterSession || !(options?.chapters?.length)) return;
    let live = true;
    void api.request<unknown>(`/v1/playback/sessions/${encodeURIComponent(chapterSession)}/chapters?limit=100`, 'GET').then(raw => {
      const list = (raw as {chapters?: unknown} | null)?.chapters;
      const images = new Map<number, string>();
      for (const entry of Array.isArray(list) ? list.slice(0, 100) : []) {
        const c = entry as {startSeconds?: unknown; thumbnailUrl?: unknown} | null;
        if (typeof c?.startSeconds === 'number' && typeof c.thumbnailUrl === 'string' && /^\/v1\/items\/[^?#]+\/chapters\/[^?#]+\/image$/.test(c.thumbnailUrl) && c.thumbnailUrl.length <= 1024) images.set(Math.round(c.startSeconds * 10), c.thumbnailUrl);
      }
      if (live) setChapterImages({session: chapterSession, images});
    }, () => {});
    return () => { live = false; };
  }, [api, chapterSession, options?.chapters?.length]);
  const serverChapters = useMemo(() => {
    const listed = chaptersOf(options?.chapters);
    const images = chapterImages && chapterImages.session === chapterSession ? chapterImages.images : undefined;
    return images?.size ? listed.map(c => { const image = images.get(Math.round(c.startSeconds * 10)); return image && !c.thumbnail ? {...c, thumbnail: image} : c; }) : listed;
  }, [options, chapterImages, chapterSession]);
  const downloadChapters = useMemo(() => (localSession ? offlineChapters(offlineExtras) : []), [localSession?.id, offlineExtras]); // eslint-disable-line react-hooks/exhaustive-deps
  const itemChapters = serverChapters.length ? serverChapters : engineMedia && engineMedia.intentId === playbackState.intentId && engineMedia.chapters.length ? engineMedia.chapters : localSession ? downloadChapters : identity.itemId && identity.itemId === playbackState.itemId ? chaptersRef.current.get(identity.itemId) ?? [] : [];
  // A download's skip markers (the server's come with the session's offer).
  const downloadMarkers = useMemo<SegmentMarkerSet | null>(() => (localSession && playbackState.itemId ? offlineMarkers(offlineExtras, playbackState.itemId) : null), [localSession?.id, offlineExtras, playbackState.itemId]); // eslint-disable-line react-hooks/exhaustive-deps
  // Scrub previews: the server's sprite sheets for this title, where it has made them.
  const [trickplayView, setTrickplayView] = useState<TrickplayView | null>(null);
  const trickplayItem = serverVideo && identity.itemId === playbackState.itemId ? playbackState.itemId : undefined;
  const trickplayLibrary = trickplayItem ? identity.libraryId : undefined;
  const serverId = session?.viewer.serverId;
  useEffect(() => {
    setTrickplayView(null);
    if (!trickplayItem || !trickplayLibrary || !serverId) return;
    let live = true;
    void api.request<unknown>(`/v1/items/${encodeURIComponent(trickplayItem)}/trickplay`, 'GET').then(raw => {
      if (!live) return;
      try { setTrickplayView(parseTrickplay(raw, serverId, {libraryId: trickplayLibrary, itemId: trickplayItem})); } catch { /* no previews for this title */ }
    }, () => {});
    return () => { live = false; };
  }, [api, serverId, trickplayItem, trickplayLibrary]);
  const trickplay = useMemo(() => (trickplayView ? preferredTrickplaySet(trickplayView, offersData?.current?.sourceId) ?? preferredTrickplaySet(trickplayView) : null), [trickplayView, offersData?.current?.sourceId]);
  const collapse = useCallback(() => setExpanded(false), []);
  const expand = useCallback(() => setExpanded(true), []);
  const requestPip = useCallback(() => setPipRequest(v => v + 1), []);
  const setRate = useCallback((rate: number) => speed.select(rate), [speed]);
  return {
    service: playback,
    state: playbackState,
    identity,
    active,
    isAudio,
    expanded,
    lease,
    pipRequest,
    pipActive,
    setPipActive,
    audioSelection,
    subtitles: {
      service: subtitleService, snapshot: subtitles,
      /** The track on screen: the selection's, or one the engine reads from the file it plays. */
      shownId: shownSubtitleId,
      /** Image subtitles drawn here by mpv: show only their forced lines (kept by this device). Null when that does not apply. */
      forcedOnly: subtitleCommand && (subtitleCommand as {render?: {kind?: string}}).render && ['pgs', 'vobsub'].includes((subtitleCommand as {render: {kind?: string}}).render.kind ?? '') ? {on: forcedOnly, set: (on: boolean) => devicePreferences.update({subtitleForcedOnly: on})} : null,
      /** Choose a track, or turn subtitles off (`null`), with an optional timing correction: a change to the playing session. */
      choose: chooseSubtitleTrack,
      /** A download's own tracks, and the one chosen. */
      offline: localSession ? {tracks: offlineTracks, selectedId: offlineTrack?.id ?? null, choose: chooseOfflineSubtitle} : null,
    },
    /** The title's quality menu (the server's), the quality in force, and the session's offer. */
    quality: {options: options?.qualities ?? [], inForce: qualityInForce, busy: qualityBusy, choose: chooseQuality, offers: offersData},
    /** The title's versions and the one playing, when it has more than one. */
    versions: {list: options?.versions ?? [], playingId: playingVersion?.id, choose: chooseVersion},
    /** The server's account of the presentation being played (engine, decision, tracks). */
    presentation,
    trickplay,
    /** A download's skip markers; null for anything else. */
    downloadMarkers,
    speedState,
    rates: playbackRates,
    /** The engine playing now ("native" or "mpv") and what it does not do: the chrome hides
     * Picture in Picture and AirPlay while an engine without them is active. */
    engineKind,
    engineFeatures: engineFeatures(engineKind),
    engineMedia: engineMedia && engineMedia.intentId === playbackState.intentId ? engineMedia : null,
    /** The viewer has a choice of player for what is on screen (a video, on a build with mpv). */
    engineSelectable: mpvAvailable && !isAudio && !playbackState.channel,
    chapters: itemChapters,
    selectAudioTrack,
    subtitleRendering,
    play,
    cancelPausedStart,
    playOffline,
    playSequence,
    advance,
    tune,
    toggle,
    retry,
    seekBy,
    seekTo,
    step,
    leave,
    collapse,
    expand,
    requestPip,
    setRate,
    setGroupControl,
    dolbyPending,
    confirmDolby,
    dismissDolby,
    sourceFacts,
    bitmapPending,
    requestBitmapConfirm,
    confirmBitmap,
    dismissBitmap,
    isBitmapAcked,
    describe: (next: NowPlaying) => {
      declared.current = next.itemId;
      describeGeneration.current++;
      setIdentity(next);
    },
  };
}

export type PlayerEngine = ReturnType<typeof usePlayerEngine>;
export type GroupControl = {toggle(playing: boolean): boolean; seek(seconds: number): boolean; step(action: 'next' | 'previous'): boolean};
