import {classifyPlaybackFailure} from './playback-failure';
import {PlayerOffersService, type PlayerOffersSnapshot} from '../../../../packages/client-core/src/player-offers';
import {activeI18n} from '../app/errors';
import {topShelfChanged} from '../app/top-shelf';
import {viewerScope} from '../app/content';
import {SubtitleService, type SubtitleSnapshot} from '../../../../packages/client-core/src/subtitles';
import {advancePendingChoice, takePendingTrackChoice, type PendingChoiceProgress} from '../../../../packages/client-core/src/pending-track-choice';
import {useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore} from 'react';
import {AppState, NativeEventEmitter, NativeModules, Platform} from 'react-native';
import type {GuideChannel} from '../../../../packages/client-core/src/channel-guide';
import {channelTuned, type Lineup} from './channel-lineup';
import type {ContentEntry} from '../../../../packages/client-core/src/library-content';
import {NativePlaybackCoordinator} from '../bridge/NativePlaybackCoordinator';
import {playbackRates, speedFor} from '../bridge/NativePlaybackSpeed';
import {useNativeAudioSelection} from '../bridge/useNativeAudioSelection';
import {useNativePlayback} from '../bridge/useNativePlayback';
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
import {usePreferences} from '../app/preferences';
import {engineFeatures, engineTransport, mpvAvailable} from '../bridge/player-engines';
import {chooseEngine, localRuleFacts, parseEngineSetting, type EngineKind} from './engine-choice';
import {engineSettingStore} from './engine-setting-store';
import {chaptersOf, engineSubtitleRender, fontsUrlOf, parseSubtitleFonts, planEngineOf, renderingToRequest, requiredSubtitleRendering, type EngineMedia, type SubtitleFonts} from './engine-media';

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
const extraTitles = new Map<string, Partial<NowPlaying>>();

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
  const {playback, playbackState, ensureQueue, v1Queue, playLocal} = useNativePlayback(api, session);
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
  type DolbyPendingSingle = {kind: 'single'; itemId: string; startSeconds: number; entry?: ContentEntry};
  type DolbyPendingSequence = {kind: 'sequence'; entries: readonly ContentEntry[]; index: number; startSeconds: number; container?: SequenceContainer};
  const [dolbyPending, setDolbyPending] = useState<DolbyPendingSingle | DolbyPendingSequence | null>(null);
  const dolbyAcknowledged = useRef<Set<string>>(new Set());
  /* MU4 COMPAT-01: 4K/HDR facts per item from the same pre-play read (never a new request),
   * and a bitmap-track confirm pending on it (Cancel keeps the current track). */
  const sourceFactsRef = useRef(new Map<string, SourceFacts>());
  const sourceFacts = useCallback((itemId: string | undefined) => (itemId ? sourceFactsRef.current.get(itemId) : undefined), []);
  const chaptersRef = useRef(new Map<string, ReturnType<typeof chaptersOf>>());
  const [bitmapPending, setBitmapPending] = useState<BitmapConfirm | null>(null);
  const bitmapAcknowledged = useRef(new Set<string>());
  const sessionKey = playbackState.session?.id;
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
  const audioSelection = useNativeAudioSelection(playback, api, session, identity.libraryId);
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
    speed.prefer(speedKind === 'song' ? 1 : speedKind === 'audiobook_file' ? audiobookSpeed : videoSpeed);
  }, [speed, speedItem, speedKind, videoSpeed, audiobookSpeed]);
  useEffect(() => {
    if (playbackState.nativeListening) speed.reconcileNative(playbackState.nativeListening);
  }, [speed, playbackState.nativeListening]);

  const isAudio = identity.kind === 'song' || identity.kind === 'audiobook_file';
  // The Player setting (Automatic, this device's own player, or mpv) and what decides the engine
  // for the title in hand. Everything is read through refs: the coordinator asks on every change
  // of the playback snapshot, before it takes a lease, so a title never starts on one engine only
  // to be moved to the other.
  const engineSetting = parseEngineSetting(usePreferences().preferences.playerEngine);
  const engineInputs = useRef<{setting: typeof engineSetting; audio: boolean; rendering?: string}>({setting: engineSetting, audio: isAudio});
  engineInputs.current.setting = engineSetting;
  engineInputs.current.audio = isAudio;
  const chooseEngineFor = useCallback((snapshot: PlaybackSnapshot): EngineKind => {
    const session = snapshot.session;
    if (!session) return 'native';
    const local = isLocalSource(session.streamUrl);
    const planEngine = planEngineOf(session);
    return chooseEngine({
      setting: engineInputs.current.setting,
      mpvAvailable,
      planEngine,
      nativeOnly: !!snapshot.channel || !!snapshot.nativeListening || !!session.audio || engineInputs.current.audio,
      requiredSubtitleRendering: engineInputs.current.rendering,
      nativeSubtitleRendering: engineFeatures('native').subtitleRendering,
      ...(planEngine ? {} : localRuleFacts({address: session.streamUrl, local, platform: Platform.OS === 'android' ? 'android' : 'apple'})),
    });
  }, []);
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
    if (f.intentId !== before.intentId) return;
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
  const engineKind = useSyncExternalStore(bridge.subscribe, bridge.getEngine) as EngineKind;
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
  // Quality: the server's real ladder for this item and session. Choosing a rung restarts the
  // same title at the same position with that rung; "auto" lets the server decide again.
  const offerScope = useMemo(() => viewerScope(session, api), [session, api]);
  const offersService = useMemo(() => (offerScope ? new PlayerOffersService({api, scope: offerScope}) : null), [api, offerScope?.serverId, offerScope?.viewerId, identity.itemId, identity.libraryId, playbackState.session?.id]); // eslint-disable-line react-hooks/exhaustive-deps
  const offers = useSyncExternalStore(offersService?.subscribe ?? noSubtitleSubscribe, offersService?.getSnapshot ?? noOffers);
  useEffect(() => {
    if (!offersService || isAudio || !identity.itemId || !identity.libraryId) return;
    try { void offersService.select({libraryId: identity.libraryId, itemId: identity.itemId, ...(playbackState.session?.id ? {sessionId: playbackState.session.id} : {})}).catch(() => {}); } catch {}
    return () => offersService.dispose();
  }, [offersService, isAudio, identity.itemId, identity.libraryId, playbackState.session?.id]);
  const [quality, setQualityChoice] = useState('auto');
  useEffect(() => setQualityChoice('auto'), [identity.itemId]);
  const offersData = offers?.phase === 'ready' && offers.data?.scope.itemId === identity.itemId ? offers.data : null;
  // The Player setting changed while a title the server planned for a named engine is playing:
  // once the server has the new setting, the title is asked for again from where it stands, so
  // the plan (and with it the engine) follows the viewer's choice. The queue is kept, as for a
  // change of quality. Where the plan names no engine the coordinator has already moved the title.
  const settingSeen = useRef(engineSetting);
  const qualityNow = useRef(quality);
  qualityNow.current = quality;
  useEffect(() => {
    if (settingSeen.current === engineSetting) return;
    settingSeen.current = engineSetting;
    const state = playback.getSnapshot(), session = state.session, itemId = state.itemId, intent = state.intentId;
    if (!session || !itemId || state.channel || engineInputs.current.audio || isLocalSession(session.id) || !planEngineOf(session) || !['starting', 'ready'].includes(state.phase)) return;
    void engineSettingStore.whenSettled(4000).then(() => {
      const now = playback.getSnapshot();
      if (now.intentId !== intent || now.itemId !== itemId || now.session?.id !== session.id || !['starting', 'ready'].includes(now.phase) || engineInputs.current.setting !== engineSetting) return;
      void playback.play(itemId, now.pendingSeek?.positionSeconds ?? now.positionSeconds ?? 0, undefined, qualityNow.current === 'auto' ? undefined : qualityNow.current).catch(() => {});
    });
  }, [engineSetting, playback]);
  const setQuality = useCallback((id: string) => {
    const itemId = playback.getSnapshot().itemId;
    if (!itemId) return;
    setQualityChoice(id);
    void playback.play(itemId, playback.getSnapshot().positionSeconds || 0, undefined, id === 'auto' ? undefined : id).catch(() => {});
  }, [playback]);

  // Subtitles: the native player draws the text; this side chooses what it draws. The selection
  // is bound to the exact session generation, so a stale choice can never reach a new stream.
  const subtitleScope = !isAudio && playbackState.session && !isLocalSession(playbackState.session.id) && playbackState.itemId && !playbackState.channel && !['error', 'ended', 'idle'].includes(playbackState.phase) ? playbackState.session : undefined;
  const subtitleService = useMemo(() => subtitleScope && playbackState.itemId ? new SubtitleService(api, {itemId: playbackState.itemId, sessionId: subtitleScope.id, generation: subtitleScope.generation}, operationId, {
    positionUs: () => String(Math.max(0, Math.round((playback.getSnapshot().pendingSeek?.positionSeconds ?? playback.getSnapshot().positionSeconds) * 1e6))),
    install: presentation => playback.getSnapshot().intentId === playbackState.intentId && playback.installSubtitlePresentation(presentation),
  }) : null, [api, playback, playbackState.itemId, playbackState.intentId, subtitleScope?.id, subtitleScope?.generation]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    subtitleService?.start();
    const listener = AppState.addEventListener('change', next => { if (next === 'active') void subtitleService?.refresh(); });
    return () => { listener.remove(); subtitleService?.stop(); };
  }, [subtitleService]);
  const subtitles = useSyncExternalStore(subtitleService?.subscribe ?? noSubtitleSubscribe, subtitleService?.getSnapshot ?? noSubtitles);
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
      chooseSubtitle: id => { const resource = id ? plan?.resources.find(r => r.id === id) : null; if (resource !== undefined) void subtitleService?.choose(resource).catch(() => {}); },
    });
  }, [playbackState.session, playbackState.itemId, playbackState.audio, playbackState.audioTracks, subtitles.plan, subtitles.busy, subtitleService, playback]);
  // A styled track's attached fonts: the list is read once per track, for the engine to fetch.
  const subtitleFontsUrl = engineKind === 'mpv' && !subtitles.suppressed ? fontsUrlOf(subtitles.plan) : undefined;
  const [subtitleFonts, setSubtitleFonts] = useState<SubtitleFonts | null>(null);
  useEffect(() => {
    if (!subtitleFontsUrl) { setSubtitleFonts(null); return; }
    let live = true;
    const settle = (raw: unknown) => { if (live) setSubtitleFonts(parseSubtitleFonts(raw, subtitleFontsUrl)); };
    void api.request<unknown>(subtitleFontsUrl, 'GET').then(settle, () => settle(null));
    return () => { live = false; };
  }, [api, subtitleFontsUrl]);
  const subtitleCommand = useMemo(() => {
    const plan = subtitles.plan, session = playbackState.session;
    if (!plan || !session || plan.sessionId !== session.id) return null;
    const binding = {intentId: playbackState.intentId, sessionId: session.id, generation: session.generation};
    if (plan.mode !== 'track' || !plan.selected || subtitles.suppressed) return {binding, mode: 'off', revision: plan.revision};
    // An engine that draws styled and image subtitles itself (mpv) is told where the track is;
    // the cue document, when there is one, is what it falls back to. The native engine draws the
    // cue document and is never given `render`.
    const render = engineKind === 'mpv' ? engineSubtitleRender(plan, session, engineFeatures('mpv').subtitleRendering, path => new URL(path, api.baseUrl).href, subtitleFontsUrl ? (subtitleFonts?.key === subtitleFontsUrl ? subtitleFonts : 'pending') : undefined) : undefined;
    if (!plan.documentUrl && !render) return {binding, mode: 'off', revision: plan.revision};
    return {binding, mode: 'track', revision: plan.revision, resourceId: plan.selected.id, resourceRevision: plan.selected.revision, manifestName:plan.selected.manifestName, origin: plan.selected.origin, language: plan.selected.language, title: plan.selected.title, offsetUs: plan.offsetUs, ...(plan.documentUrl ? {documentUrl: new URL(plan.documentUrl, api.baseUrl).href} : {}), refreshRevision: 0, ...(render ? {render} : {})};
  }, [subtitles.plan, subtitles.suppressed, playbackState.session, playbackState.intentId, api, engineKind, subtitleFontsUrl, subtitleFonts]);
  // A chosen track the server delivers for the device to draw, in a kind only mpv draws, moves
  // the title to mpv (and back when the choice changes).
  const neededRendering = subtitles.plan && playbackState.session && subtitles.plan.sessionId === playbackState.session.id && !subtitles.suppressed ? requiredSubtitleRendering(subtitles.plan) : undefined;
  useEffect(() => { engineInputs.current.rendering = neededRendering; bridge.reconsiderEngine(); }, [bridge, neededRendering]);
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
  }, [api, identity.itemId, identity.kind, identity.seriesTitle, identity.artist, identity.offline]);

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
      void playback.play(itemId, startSeconds).catch(() => {});
    },
    [api, playback, ensureQueue],
  );
  /** The newest play intent: a preflight that answers after a newer play, or after the player
   * was closed, must not start its title. */
  const intent = useRef(0);
  /** Behind presence: older servers have no Dolby reason and read as no warning (fail open). */
  const checkDolbyFor = useCallback(async (itemId: string): Promise<boolean> => {
    const read = api.request<unknown>(`/v1/items/${encodeURIComponent(itemId)}/playback-options`, 'GET').then(raw => {
      // MU4 COMPAT-01: keep the source facts from this same answer for the subtitle warning,
      // and the title's chapters for the lock screen's Next and Previous.
      sourceFactsRef.current.set(itemId, sourceFactsOf(raw));
      if (sourceFactsRef.current.size > 50) sourceFactsRef.current.delete(sourceFactsRef.current.keys().next().value!);
      chaptersRef.current.set(itemId, chaptersOf((raw as {chapters?: unknown} | null)?.chapters));
      if (chaptersRef.current.size > 50) chaptersRef.current.delete(chaptersRef.current.keys().next().value!);
      return dolbyVisionWarningNeeded(raw);
    }, () => false);
    // The check is a courtesy, not a gate: a busy or distant server must not hold every start
    // for as long as the request takes. After a short wait the title starts without it (the
    // answer is still kept when it arrives).
    return Promise.race([read, new Promise<boolean>(resolve => setTimeout(() => resolve(false), 1500))]);
  }, [api]);
  const play = useCallback(
    (itemId: string, startSeconds: number, entry?: ContentEntry) => {
      const mine = ++intent.current;
      if (!mayCarryVideo(entry?.kind) || dolbyAcknowledged.current.has(itemId)) { startSingle(itemId, startSeconds, entry); return; }
      void checkDolbyFor(itemId).then(needs => {
        if (mine !== intent.current) return;
        if (!needs) startSingle(itemId, startSeconds, entry);
        else setDolbyPending({kind: 'single', itemId, startSeconds, entry});
      });
    },
    [startSingle, checkDolbyFor],
  );
  /** OS-07: play a download in this player. What it shows comes from the download itself (no
   * library, so no quality ladder or audio choices), and its progress stays on the device. */
  const playOffline = useCallback(
    (media: LocalMedia, display: OfflineDisplay) => {
      declared.current = media.itemId;
      describeGeneration.current++;
      setIdentity({itemId: media.itemId, title: display.title, subtitle: display.subtitle, posterUrl: display.artworkUrl, kind: display.kind, offline: true});
      setPipActive(false);
      setExpanded(true);
      return playLocal(media);
    },
    [playLocal],
  );
  const tune = useCallback(
    (channel: GuideChannel, lineup?: Lineup) => {
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
        void v1.playSelector(plan.selector, plan.options).catch(() => startSingle(first.playback!.itemId, startSeconds, first));
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
      void queue.playEntries(playable.map(e => queueItemInput(e.playback!.itemId)), {startSeconds}).catch(() => startSingle(first.playback!.itemId, startSeconds, first));
    },
    [playback, startSingle, ensureQueue, v1Queue],
  );
  const playSequence = useCallback(
    (entries: readonly ContentEntry[], index: number, startSeconds: number, container?: SequenceContainer) => {
      const mine = ++intent.current;
      const first = entries.slice(index).filter(e => e.playback)[0];
      const firstId = first?.playback?.itemId;
      if (!firstId) { startSequenceInner(entries, index, startSeconds, container); return; }
      if (!mayCarryVideo(first?.kind) || dolbyAcknowledged.current.has(firstId)) { startSequenceInner(entries, index, startSeconds, container); return; }
      void checkDolbyFor(firstId).then(needs => {
        if (mine !== intent.current) return;
        if (!needs) startSequenceInner(entries, index, startSeconds, container);
        else setDolbyPending({kind: 'sequence', entries, index, startSeconds, container});
      });
    },
    [startSequenceInner, checkDolbyFor],
  );
  const confirmDolby = useCallback(() => {
    const pending = dolbyPending;
    if (!pending) return;
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
    // A download retries from its own file, where it stopped (the service kept how to make it).
    if (identityRef.current.offline) {
      void playback.retry().catch(() => {});
      return;
    }
    // A title that never started (a resume that failed before its first frame) retries at the
    // position it was asked for, not at 0:00 (demo, 23 Sep).
    void playback.play(itemId, playback.recoveryTarget() ?? (state.positionSeconds || 0)).catch(() => {});
  }, [playback]);
  const toggle = useCallback(() => {
    const state = playback.getSnapshot();
    if (state.phase === 'error') retry();
    else if (groupControl.current?.toggle(state.intent === 'playing')) return;
    else if (state.intent === 'playing') playback.pause();
    else playback.resume();
  }, [playback, retry]);
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
  /** Chooses one of a file's audio tracks. An engine that switches tracks itself (mpv, playing the
   * file as it is) does so at once, in the same session; otherwise the server is asked for the
   * title again with that track, from the same position. */
  const selectAudioTrack = useCallback((streamIndex: number): Promise<void> => {
    const state = playback.getSnapshot(), session = state.session;
    const inEngine = bridge.getEngine() === 'mpv' && engineFeatures('mpv').audioTrackSwitching && !!session && (session.mode === 'direct' || isLocalSession(session.id)) && !!state.audioTracks?.tracks.some(t => t.streamIndex === streamIndex);
    if (!inEngine || !session) return playback.selectAudioTrack(streamIndex);
    bridge.setAudioTrack({binding: {intentId: state.intentId, sessionId: session.id, generation: session.generation}, revision: ++engineAudioRevision.current, streamIndex});
    return Promise.resolve();
  }, [playback, bridge]);
  /** The kind to ask the server for when choosing `resource`, so an engine that draws styled or
   * image subtitles itself gets the original track instead of having it burned into the picture.
   * Undefined: the ordinary choice. The viewer's Player setting decides which engines count. */
  const subtitleRendering = useCallback((resource: Parameters<typeof renderingToRequest>[0]) => {
    const audio = engineInputs.current.audio, setting = engineInputs.current.setting;
    const usable = setting === 'native' || !mpvAvailable || audio || !!playback.getSnapshot().channel ? engineFeatures('native').subtitleRendering : [...new Set([...engineFeatures('native').subtitleRendering, ...engineFeatures('mpv').subtitleRendering])];
    return renderingToRequest(resource, usable);
  }, [playback]);
  const itemChapters = engineMedia && engineMedia.intentId === playbackState.intentId && engineMedia.chapters.length ? engineMedia.chapters : identity.itemId && identity.itemId === playbackState.itemId ? chaptersRef.current.get(identity.itemId) ?? [] : [];
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
    subtitles: {service: subtitleService, snapshot: subtitles},
    quality: {selected: quality, offers: offersData, choose: setQuality},
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
