import React, {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import {
  ActivityIndicator,
  AppState,
  Image,
  StyleSheet,
  Text,
  View,
  useTVEventHandler,
} from 'react-native';
import {useQuery} from '@tanstack/react-query';
import {
  currentNetworkAllowsStreaming,
  currentPlaybackNetworkContext,
  getServerSession,
  productErrorMessageId,
  requestServerRouteRefresh,
  subscribeServerRouteChanges,
  subscribePlaybackNetworkContext,
  type ApplePlaybackNetworkContext,
  usePorticoAuth,
  usePorticoViewerPreferences,
  useViewerRuntime,
} from '@portico-react-native/infrastructure';
import {
  ApplePlayer,
  canCommitPreparedHandoff,
  formatPlayerTime,
  getGoogleCastState,
  googleCastController,
  sourceWithMediaGrant,
  subscribeToGoogleCastState,
  type ApplePlaybackDescriptor,
  type ApplePlaybackProgress,
  type ApplePlaybackState,
  type ApplePlayerCapabilities,
  type ApplePlayerHandle,
  type GoogleCastState,
} from '@portico-react-native/player';
import {
  createPlaybackAutomationState,
  playbackSegmentAutomationDecision,
  playerContentMode,
  portableSleepTimer,
  reducePlaybackAutomation,
  reduceUpNextCountdown,
  reduceWatchWithFriendsSnapshot,
  segmentLabel,
  sleepTimerShouldStop,
  type MediaSegment,
  type PortableSleepTimer,
  type PlaybackResponse,
  type PlaybackPreparedResponse,
  type PlaybackAutomationState,
  type PorticoClient,
  type WatchWithFriendsGroup,
  type WatchWithFriendsSyncState,
  type UpNextCountdownState,
} from '@porticomediaserver/client-core';
import {useSafeAreaInsets} from 'react-native-safe-area-context';
import {PorticoIcon} from '@portico-react-native/icons';
import type {PrototypePlatform} from '../../ui-compat/contract';
import {
  createCastBootstrap,
  detailViewModel,
  googleCastContentType,
  handoffPlaybackTarget,
  isTrustedInsecureHost,
  playbackClientProfileForTarget,
  PORTICO_CAST_BOOTSTRAP_PLACEHOLDER,
  playbackIntentForApplePreferences,
  playbackServerOrigins,
  shouldAttemptNativePlaybackRecovery,
  startRoutedPlayback,
  validatePlaybackResponse,
  type NativePlaybackTarget,
} from '../../data';
import {color} from '../tokens';
import {
  ControlButton,
  Focusable,
  IconButton,
  TVLogicalFocusContainerBoundary,
} from '../primitives';
import {usePorticoNavigationActions} from '../navigation';
import {usePrototypeUi, type PlayerPanelId} from '../uiState';
import {usePersistentPlayback} from '../playbackSession';
import {
  FiveControlTransport,
  MobileAudioPresenter,
  MobileVideoUtilityHeader,
} from '../playerPresenters';
import {createTVPlayerFocusContainers, TV_PLAYER_FOCUS, TV_PLAYER_FOCUS_ENTRY} from '../playerFocusTopology';
import {PlayerQueueHistory, queueAfterReturningToPrevious} from '../playerQueueHistory';
import {boundedPlayerPosition, playerTimelinePressTarget, playerTimelineRemoteDelta} from '../playerTimelineModel';
import {PersistentPlaybackBridge} from '../playerSessionBridge';
import {PlayerUtilityDock, PlayerUtilityPanel} from '../playerUtilityPresenters';
import {playerQualitySelectionAllowed, playerSubtitleSelection} from '../playerSelectionModel';
import {PlayerGenerationFence} from '../playerGenerationFence';
import {
  productBody,
  productErrorBody,
  productText,
  productTitle,
} from '../productCopy';
import {
  watchWithFriendsPlaybackAuthority,
  type WatchWithFriendsConnectionStatus,
} from '../watchWithFriendsPlaybackAuthority';
import {tvBackOverrideRegistry} from '../tvNavigationBack';
import {useTVLogicalFocus} from '../tvNavigationFocus';
import {styles} from './styles';

import {PLAYBACK_START_TIMEOUT_MS, playbackRequestId, playerChromeMustRemainVisible, shuffledQueueMediaIds, takeRequestedPlaybackStart} from '../playerRuntimeModel';
import {
  promoteQueueItem,
  promoteWatchGroupItemAfterCurrent,
  watchGroupUpcomingItems,
} from '../queueNavigation';

type ApplePostPlayState =
  | {phase: 'inactive'}
  | {phase: 'preparing'; nextTitle: string}
  | {phase: 'countdown'; prepared: PlaybackPreparedResponse}
  | {phase: 'passout'; nextTitle: string}
  | {phase: 'cancelled'; nextTitle: string}
  | {phase: 'failed'; nextTitle: string; message: string};

function TVPlayerFocusRestorer({focusId, onRestored}: {focusId: string; onRestored(): void}) {
  const {focus} = useTVLogicalFocus();
  useEffect(() => {
    let mounted = true;
    void focus(focusId).then(result => {
      if (mounted && result.status === 'focused') onRestored();
    });
    return () => { mounted = false; };
  }, [focus, focusId, onRestored]);
  return null;
}

function TVTimelineRemoteHandler({
  enabled,
  focused,
  intervalSeconds,
  onSeekBy,
}: {
  enabled: boolean;
  focused(): boolean;
  intervalSeconds: number;
  onSeekBy(delta: number): void;
}) {
  useTVEventHandler(event => {
    if (!enabled || !focused()) return;
    const delta = playerTimelineRemoteDelta(
      event.eventType,
      intervalSeconds,
    );
    if (delta !== undefined) onSeekBy(delta);
  });
  return null;
}

export function PlayerScreen({
  dvr = false,
  intentRevision = 0,
  libraryChannel = false,
  mediaId,
  platform,
  live = false,
  watchWithFriendsGroupId,
}: {
  dvr?: boolean;
  intentRevision?: number;
  libraryChannel?: boolean;
  mediaId: string;
  platform: PrototypePlatform;
  live?: boolean;
  watchWithFriendsGroupId?: string;
}) {
  const television = platform === 'tv';
  const activeSession = usePorticoAuth().session!;
  const client = activeSession.client;
  const viewerRuntime = useViewerRuntime();
  const {back, collapsePlayer, openWatchWithFriendsPlayer} = usePorticoNavigationActions();
  const {session: playerSession} = usePersistentPlayback();
  const {playerPanel: panel, setPlayerPanel: setPanel} = usePrototypeUi();
  const tvPlayerFocusContainers = useMemo(
    () => createTVPlayerFocusContainers(Boolean(panel)),
    [panel],
  );
  const insets = useSafeAreaInsets();
  const playerBottomSafeArea = useMemo(
    () => ({paddingBottom: Math.max(24, insets.bottom + 12)}),
    [insets.bottom],
  );
  const playerRef = useRef<ApplePlayerHandle>(null);
  const playbackRef = useRef<PlaybackResponse | undefined>(undefined);
  const launchDescriptorRef = useRef<{
    kind: 'media' | 'live' | 'dvr' | 'library-channel';
    sourceId: string;
  }>({
    kind: libraryChannel ? 'library-channel' : live ? 'live' : dvr ? 'dvr' : 'media',
    sourceId: mediaId,
  });
  const progressRef = useRef<ApplePlaybackProgress>({
    positionSeconds: 0,
    durationSeconds: 0,
    isPlaying: false,
  });
  const completionCommittedSessionRef = useRef<string | undefined>(undefined);
  const progressMailboxPromiseRef = useRef<Promise<unknown> | undefined>(
    undefined,
  );
  const renewingGrantRef = useRef(false);
  const nativeRecoveryAttemptRef = useRef(0);
  const routeRecoveryEpochRef = useRef(new PlayerGenerationFence());
  const routeRecoveryInFlightRef = useRef(false);
  const progressWidthRef = useRef(0);
  const nativeStateRef = useRef<ApplePlaybackState>('loading');
  const watchSyncStateRef = useRef<WatchWithFriendsSyncState | undefined>(undefined);
  const watchRateResetRef = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const castConnectedRef = useRef(false);
  const castReceiverReadyRef = useRef<
    | {
        castSessionId?: string;
        receiverId: string;
        receiverPublicKey: string;
        receiverChallenge: string;
        nonce?: string;
      }
    | undefined
  >(undefined);
  const castReceiverReadyNonceRef = useRef<string | undefined>(undefined);
  const castReceiverSessionRef = useRef<
    | {castSessionId?: string; receiverSessionId: string; generation: number}
    | undefined
  >(undefined);
  const castReceiverOwnedRef = useRef(false);
  const castSessionIdRef = useRef('');
  const castLoadedSourceRef = useRef<string | undefined>(undefined);
  const castExpectedSourceRef = useRef<string | undefined>(undefined);
  const castHasLoadedRef = useRef(false);
  const castWasPlayingRef = useRef(false);
  const castCompletionHandledRef = useRef(false);
  const playbackTargetRef = useRef<NativePlaybackTarget>('apple');
  const targetSwitchInFlightRef = useRef<NativePlaybackTarget | undefined>(
    undefined,
  );
  const desiredPlaybackTargetRef = useRef<NativePlaybackTarget>('apple');
  const blockedPlaybackTargetRef = useRef<NativePlaybackTarget | undefined>(
    undefined,
  );
  const playbackOperationEpochRef = useRef(new PlayerGenerationFence());
  const playbackOperationsRef = useRef(new Set<Promise<unknown>>());
  const playbackStartupAbortRef = useRef<AbortController | undefined>(undefined);
  const shutdownRequestedRef = useRef(false);
  const shutdownPromiseRef = useRef<Promise<void> | undefined>(undefined);
  const automationStateRef = useRef<PlaybackAutomationState>(
    createPlaybackAutomationState(),
  );
  const countdownStateRef = useRef<UpNextCountdownState>({phase: 'inactive'});
  const preparedNextRef = useRef<PlaybackPreparedResponse | undefined>(
    undefined,
  );
  const playbackHistoryRef = useRef(new PlayerQueueHistory());
  const panelInvokerRef = useRef<Exclude<PlayerPanelId, null> | undefined>(undefined);
  const preparedCompletionSessionRef = useRef<string | undefined>(undefined);
  const playbackFailureKindRef = useRef<
    'cast-load' | 'grant' | 'native' | 'target'
  >('native');
  const [playback, setPlayback] = useState<PlaybackResponse>();
  const [startError, setStartError] = useState<string>();
  const [playbackFailure, setPlaybackFailure] = useState<string>();
  const [routeReconnecting, setRouteReconnecting] = useState(false);
  const [startRevision, setStartRevision] = useState(0);
  const [nativeState, setNativeState] = useState<ApplePlaybackState>('loading');
  const [progress, setProgress] = useState<ApplePlaybackProgress>(
    progressRef.current,
  );
  const [ended, setEnded] = useState(false);
  const [postPlay, setPostPlay] = useState<ApplePostPlayState>({
    phase: 'inactive',
  });
  const [postPlayRemaining, setPostPlayRemaining] = useState(0);
  const progressFocusedRef = useRef(false);
  const [chromeVisible, setChromeVisible] = useState(true);
  const [controlBusy, setControlBusy] = useState(false);
  const [playbackTarget, setPlaybackTarget] =
    useState<NativePlaybackTarget>('apple');
  const [targetSwitchRevision, setTargetSwitchRevision] = useState(0);
  const [castState, setCastState] = useState<GoogleCastState>({
    configured: false,
    canPause: false,
    canSeek: false,
    connected: false,
    contentURL: '',
    deviceName: '',
    durationSeconds: 0,
    idleReason: 'none',
    isLive: false,
    playerState: 'idle',
    positionSeconds: 0,
    recovering: false,
  });
  const viewerPreferences = usePorticoViewerPreferences();
  const preferences = viewerPreferences.values;
  const preferencesReadyForLaunch = viewerPreferences.readStatus !== 'loading';
  const launchPreferencesRef = useRef(preferences);
  if (!playbackRef.current && viewerPreferences.readStatus === 'ready')
    launchPreferencesRef.current = preferences;
  const launchPreferences = launchPreferencesRef.current;
  const revealPlayerChrome = useCallback(() => setChromeVisible(true), []);
  const keepChromeVisible = playerChromeMustRemainVisible({
    ended,
    hasError: Boolean(playbackFailure || startError || routeReconnecting),
    panelOpen: Boolean(panel),
    state: nativeState,
  });
  useEffect(() => {
    if (keepChromeVisible) {
      setChromeVisible(true);
      return undefined;
    }
    if (!chromeVisible) return undefined;
    const timer = setTimeout(() => setChromeVisible(false), 4_000);
    return () => clearTimeout(timer);
  }, [chromeVisible, keepChromeVisible]);
  const playbackNetworkContextRef = useRef<ApplePlaybackNetworkContext>({
    networkClass: 'unknown' as const,
    transportClass: 'unknown' as const,
  });
  useEffect(
    () => subscribePlaybackNetworkContext(context => {
      playbackNetworkContextRef.current = context;
    }),
    [],
  );
  const playbackPreferenceIntent = useCallback(
    (subtitleMode?: 'off' | 'text' | 'burn_in') =>
      playbackIntentForApplePreferences(launchPreferences, {
        ...playbackNetworkContextRef.current,
        ...(subtitleMode ? {subtitleMode} : {}),
      }),
    [launchPreferences],
  );
  const [watchGroup, setWatchGroup] = useState<WatchWithFriendsGroup>();
  const watchGroupRef = useRef<WatchWithFriendsGroup | undefined>(undefined);
  const watchApplyGroupRef = useRef<
    ((group: WatchWithFriendsGroup) => void) | undefined
  >(undefined);
  const [watchGroupStatus, setWatchGroupStatus] =
    useState<WatchWithFriendsConnectionStatus>(
      watchWithFriendsGroupId ? 'reconnecting' : 'unavailable',
    );
  const [watchGroupError, setWatchGroupError] = useState<string>();
  const [watchConnectionRevision, setWatchConnectionRevision] = useState(0);
  const [playerCapabilities, setPlayerCapabilities] =
    useState<ApplePlayerCapabilities>();
  const initialAudioCollapseSessionRef = useRef<string | undefined>(undefined);
  const [playbackRate, setPlaybackRate] = useState(1);
  const [playerVolume, setPlayerVolume] = useState(1);
  const [mobileAudioExpanded, setMobileAudioExpanded] = useState(false);
  const [restoreUtilityFocusId, setRestoreUtilityFocusId] = useState<Exclude<PlayerPanelId, null>>();
  const [sleepTimer, setSleepTimer] = useState<PortableSleepTimer>({mode: 'off'});
  const [seekPreviewSeconds, setSeekPreviewSeconds] = useState<number>();
  const trickplayQuery = useQuery({
    queryKey: ['media-trickplay', mediaId],
    enabled: !live,
    queryFn: ({signal}) => client.mediaTrickplay(mediaId, {signal}),
  });
  const castActive =
    !watchWithFriendsGroupId &&
    !television &&
    (castState.connected || castState.recovering);
  desiredPlaybackTargetRef.current = castActive ? 'google-cast' : 'apple';
  const watchAuthority = watchWithFriendsPlaybackAuthority({
    group: watchGroup,
    groupRequested: Boolean(watchWithFriendsGroupId),
    status: watchGroupStatus,
  });
  const leaveGroupAndBack = useCallback(() => {
    const group = watchGroupRef.current;
    if (group) {
      setControlBusy(true);
      void client
        .leaveWatchWithFriendsGroup(group.id)
        .catch(() => undefined)
        .finally(() => {
          setControlBusy(false);
          back();
        });
      return;
    }
    back();
  }, [back, client]);

  const handlePlayerBack = useCallback(() => {
    if (panel) {
      const invoker = panelInvokerRef.current;
      setPanel(null);
      if (invoker) setRestoreUtilityFocusId(invoker);
      return;
    }
    if (watchWithFriendsGroupId) {
      leaveGroupAndBack();
      return;
    }
    playerSession.handle({type: 'back'});
    back();
  }, [back, leaveGroupAndBack, panel, playerSession, setPanel, watchWithFriendsGroupId]);

  useEffect(() => {
    if (!television) return undefined;
    return tvBackOverrideRegistry.register(handlePlayerBack);
  }, [handlePlayerBack, television]);

  useEffect(() => {
    if (!watchWithFriendsGroupId) return;
    const abort = new AbortController();
    let reconnectAttempt = 0;
    const makeUnavailable = (cause: unknown, ended = false) => {
      if (abort.signal.aborted) return;
      const group = watchGroupRef.current;
      playerRef.current?.pause();
      watchGroupRef.current = undefined;
      watchSyncStateRef.current = undefined;
      setWatchGroup(undefined);
      setWatchGroupStatus('unavailable');
      setWatchGroupError(
        productErrorBody(
          cause,
          ended
            ? 'watch-with-friends.session-ended'
            : 'watch-with-friends.unavailable',
        ),
      );
      if (group) {
        void client.leaveWatchWithFriendsGroup(group.id).catch(() => undefined);
      }
    };
    const applyGroup = (group: WatchWithFriendsGroup) => {
      if (abort.signal.aborted) return;
      watchGroupRef.current = group;
      setWatchGroup(group);
      if (group.state === 'stopped') {
        makeUnavailable(new Error('watch_with_friends_ended'), true);
        return;
      }
      setWatchGroupStatus('connected');
      setWatchGroupError(undefined);
      const result = reduceWatchWithFriendsSnapshot(
        watchSyncStateRef.current,
        group,
        {
          buffering:
            nativeStateRef.current === 'buffering' ||
            nativeStateRef.current === 'loading',
          mediaId: playbackRef.current?.media.id ?? mediaId,
          paused: nativeStateRef.current !== 'playing',
          positionSeconds: progressRef.current.positionSeconds,
        },
      );
      if (
        result.action.type !== 'ignore' ||
        result.action.reason !== 'buffering'
      ) {
        watchSyncStateRef.current = result.state;
      }
      const authoritativeRate = group.playbackRate || 1;
      setPlaybackRate(authoritativeRate);
      if (result.action.type !== 'rate') {
        playerRef.current?.setPlaybackRate(authoritativeRate);
      }
      switch (result.action.type) {
        case 'load':
          if (result.action.mediaId !== playbackRef.current?.media.id) {
            openWatchWithFriendsPlayer(
              result.action.mediaId,
              watchWithFriendsGroupId,
            );
          }
          break;
        case 'seek':
          playerRef.current?.seekTo(result.action.positionSeconds);
          if (result.action.paused) playerRef.current?.pause();
          else playerRef.current?.play();
          break;
        case 'rate':
          playerRef.current?.setPlaybackRate(result.action.playbackRate);
          if (watchRateResetRef.current) clearTimeout(watchRateResetRef.current);
          watchRateResetRef.current = setTimeout(
            () => playerRef.current?.setPlaybackRate(group.playbackRate || 1),
            result.action.durationMs,
          );
          break;
        case 'play':
          playerRef.current?.play();
          break;
        case 'pause':
          playerRef.current?.pause();
          break;
      }
    };
    watchApplyGroupRef.current = applyGroup;
    const connect = async () => {
      try {
        applyGroup(await client.watchWithFriendsGroup(watchWithFriendsGroupId));
      } catch (cause) {
        makeUnavailable(cause);
        return;
      }
      while (!abort.signal.aborted) {
        try {
          await client.streamWatchWithFriendsGroupEvents(
            watchWithFriendsGroupId,
            abort.signal,
            applyGroup,
          );
          if (!abort.signal.aborted) {
            throw new Error('watch_with_friends_stream_closed');
          }
        } catch {
          if (abort.signal.aborted) return;
          setWatchGroupStatus('reconnecting');
          playerRef.current?.pause();
          const delay = [1_000, 2_000, 5_000, 10_000][
            Math.min(reconnectAttempt, 3)
          ] ?? 10_000;
          reconnectAttempt += 1;
          await playbackDelay(delay, abort.signal).catch(() => undefined);
          if (abort.signal.aborted) return;
          try {
            applyGroup(
              await client.watchWithFriendsGroup(watchWithFriendsGroupId),
            );
          } catch (refreshCause) {
            makeUnavailable(refreshCause);
            return;
          }
        }
      }
    };
    void connect();
    const heartbeat = setInterval(() => {
      const group = watchGroupRef.current;
      if (!group || abort.signal.aborted) return;
      void client
        .updateWatchWithFriendsMemberState(group.id, {
          positionSeconds: progressRef.current.positionSeconds,
          state:
            nativeStateRef.current === 'buffering' ||
            nativeStateRef.current === 'loading'
              ? 'buffering'
              : nativeStateRef.current === 'playing'
                ? 'playing'
                : 'paused',
        })
        .then(applyGroup)
        .catch(() => {
          if (abort.signal.aborted) return;
          playerRef.current?.pause();
          setWatchGroupStatus('reconnecting');
          setWatchConnectionRevision(value => value + 1);
        });
    }, 10_000);
    return () => {
      abort.abort();
      clearInterval(heartbeat);
      if (watchRateResetRef.current) clearTimeout(watchRateResetRef.current);
      watchGroupRef.current = undefined;
      watchApplyGroupRef.current = undefined;
      watchSyncStateRef.current = undefined;
    };
  }, [
    client,
    mediaId,
    openWatchWithFriendsPlayer,
    watchConnectionRevision,
    watchWithFriendsGroupId,
  ]);

  useEffect(() => {
    playerRef.current?.setSleepTimerDeadline(
      sleepTimer.mode === 'deadline' ? sleepTimer.deadlineAt : undefined,
    );
    if (sleepTimer.mode !== 'deadline') return;
    const timer = setInterval(() => {
      if (sleepTimerShouldStop(sleepTimer, {type: 'tick', now: Date.now()})) {
        playerRef.current?.pause();
        setSleepTimer({mode: 'off'});
      }
    }, 1_000);
    return () => clearInterval(timer);
  }, [sleepTimer]);

  const trackPlaybackOperation = useCallback(
    <T,>(operation: Promise<T>): Promise<T> => {
      const tracked = operation.finally(() =>
        playbackOperationsRef.current.delete(tracked),
      );
      playbackOperationsRef.current.add(tracked);
      return tracked;
    },
    [],
  );

  const shutdownPlayback = useCallback(async (): Promise<void> => {
    playbackStartupAbortRef.current?.abort();
    if (shutdownPromiseRef.current) return shutdownPromiseRef.current;
    shutdownRequestedRef.current = true;
    playbackOperationEpochRef.current.advance();
    playerRef.current?.pause();
    setPanel(null);
    const shutdown = (async () => {
      const failures: unknown[] = [];
      while (playbackOperationsRef.current.size > 0) {
        const operationResults = await Promise.allSettled([
          ...playbackOperationsRef.current,
        ]);
        failures.push(
          ...operationResults.flatMap(result =>
            result.status === 'rejected' ? [result.reason] : [],
          ),
        );
      }
      const current = playbackRef.current;
      playbackRef.current = undefined;
      const latest = progressRef.current;
      const critical: Promise<unknown>[] = [];
      if (current && !castReceiverOwnedRef.current) {
        critical.push((async () => {
          const pending = progressMailboxPromiseRef.current;
          if (pending) await pending.catch(() => undefined);
          let committed = false;
          let finalFailure: unknown;
          for (let attempt = 0; attempt < 2; attempt += 1) {
            try {
              const acknowledgement = await client.touchPlayback(
                current.sessionId,
                {
                  durationSeconds: latest.durationSeconds || undefined,
                  progressSeconds: latest.positionSeconds,
                  state: 'paused',
                },
              );
              if (acknowledgement.accepted || acknowledgement.duplicate) {
                committed = true;
                break;
              }
              if (!acknowledgement.stale) break;
            } catch (cause) {
              finalFailure = cause;
              break;
            }
          }
          if (!committed) {
            await client.stopPlayback(current.sessionId).catch(() => undefined);
            throw finalFailure ?? new Error(
              'Portico could not durably record the final playback position.',
            );
          }
          await client.stopPlayback(current.sessionId);
        })());
      }
      if (castConnectedRef.current && !castReceiverOwnedRef.current)
        critical.push(googleCastController.stop());
      const results = await Promise.allSettled(critical);
      failures.push(
        ...results.flatMap(result =>
          result.status === 'rejected' ? [result.reason] : [],
        ),
      );
      if (failures.length)
        throw new AggregateError(
          failures,
          'Portico could not stop the active playback session.',
        );
    })();
    shutdownPromiseRef.current = shutdown;
    return shutdown;
  }, [client, setPanel]);

  useEffect(
    () => viewerRuntime.register('playback', () => shutdownPlayback()),
    [shutdownPlayback, viewerRuntime],
  );

  useTVEventHandler(event => {
    if (television) revealPlayerChrome();
    if (
      !television ||
      event.eventType !== 'playPause' ||
      playbackFailure ||
      !playbackRef.current
    )
      return;
    playerSession.handle({type: 'remote-toggle'});
  });

  useEffect(() => {
    const subscription = AppState.addEventListener('change', state => {
      if (state === 'active' || !playbackRef.current) return;
      const mode = playerContentMode(
        playbackRef.current.media,
        playbackRef.current.isLive === true,
      );
      if (mode === 'video' || mode === 'live') {
        playerSession.handle({type: 'app-background'});
      }
    });
    return () => subscription.remove();
  }, [playerSession]);

  useEffect(() => {
    if (!playback || television) return;
    const mode = playerContentMode(playback.media, playback.isLive === true);
    if ((mode === 'music' || mode === 'audiobook') && initialAudioCollapseSessionRef.current !== playback.sessionId) {
      initialAudioCollapseSessionRef.current = playback.sessionId;
      collapsePlayer();
    }
  }, [collapsePlayer, playback, television]);

  useEffect(() => {
    if (!preferencesReadyForLaunch) return;
    let cancelled = false;
    const previousShutdown = shutdownPromiseRef.current;
    shutdownRequestedRef.current = Boolean(previousShutdown);
    setPanel(null);
    setStartError(undefined);
    setPlaybackFailure(undefined);
    setPlayback(undefined);
    nativeRecoveryAttemptRef.current = 0;
    castLoadedSourceRef.current = undefined;
    castExpectedSourceRef.current = undefined;
    castHasLoadedRef.current = false;
    castWasPlayingRef.current = false;
    castCompletionHandledRef.current = false;
    playbackTargetRef.current = 'apple';
    targetSwitchInFlightRef.current = undefined;
    blockedPlaybackTargetRef.current = undefined;
    playbackOperationEpochRef.current.advance();
    setPlaybackTarget('apple');
    if (!watchAuthority.shouldStartPlayback) {
      playerRef.current?.pause();
      if (castConnectedRef.current) {
        void googleCastController.stop().catch(() => undefined);
      }
      return () => {
        cancelled = true;
        void shutdownPlayback().catch(() => undefined);
      };
    }
    const startupAbortController = new AbortController();
    let startupTimedOut = false;
    const startupTimeout = setTimeout(() => {
      startupTimedOut = true;
      startupAbortController.abort();
    }, PLAYBACK_START_TIMEOUT_MS);
    playbackStartupAbortRef.current = startupAbortController;
    const startup = trackPlaybackOperation(
      (async () => {
        try {
          if (previousShutdown) await previousShutdown;
          if (cancelled) return;
          shutdownPromiseRef.current = undefined;
          shutdownRequestedRef.current = false;
          const networkContext = await currentPlaybackNetworkContext();
          playbackNetworkContextRef.current = networkContext;
          if (
            !television &&
            !(await currentNetworkAllowsStreaming(
              launchPreferences.allowCellularStreaming,
            ))
          ) {
            throw new Error(
              'Cellular streaming is disabled in Settings. Connect to Wi-Fi or allow cellular streaming to play this title.',
            );
          }
          const requestedStart = takeRequestedPlaybackStart(mediaId);
          const requestedStartSeconds = requestedStart?.startSeconds;
          let value = await startRoutedPlayback(
            client,
            mediaId,
            libraryChannel ? 'library-channel' : live ? 'live' : dvr ? 'dvr' : 'media',
            requestedStartSeconds,
            requestedStart?.versionId,
            {signal: startupAbortController.signal},
            television ? 'tv' : 'mobile',
            {intent: playbackPreferenceIntent()},
          );
          value = validatePlaybackResponse(value, {
            serverOrigins: playbackServerOrigins(getServerSession()?.apiBaseUrl),
          });
          if (cancelled || shutdownRequestedRef.current) {
            await client.stopPlayback(value.sessionId).catch(() => undefined);
            return;
          }
          value.sourceUrl = client.resourceUrl(value.sourceUrl);
          playbackRef.current = value;
          progressRef.current = {
            durationSeconds:
              value.timeline.durationSeconds ??
              value.media.durationSeconds ??
              0,
            isPlaying: true,
            positionSeconds: value.resumePositionSeconds ?? 0,
          };
          setProgress(progressRef.current);
          setPlayback(value);
        } catch (cause) {
          if (shutdownRequestedRef.current) throw cause;
          if (!cancelled && !startupAbortController.signal.aborted)
            setStartError(
              productErrorBody(cause, 'playback.start-failed'),
            );
          else if (!cancelled && startupTimedOut)
            setStartError(productBody('problem.timeout'));
        } finally {
          clearTimeout(startupTimeout);
          if (playbackStartupAbortRef.current === startupAbortController)
            playbackStartupAbortRef.current = undefined;
        }
      })(),
    );
    void startup.catch(() => undefined);
    return () => {
      cancelled = true;
      void shutdownPlayback().catch(() => undefined);
    };
  }, [
    client,
    dvr,
    launchPreferences,
    libraryChannel,
    live,
    mediaId,
    playbackPreferenceIntent,
    preferencesReadyForLaunch,
    setPanel,
    shutdownPlayback,
    startRevision,
    intentRevision,
    television,
    trackPlaybackOperation,
    watchAuthority.shouldStartPlayback,
  ]);

  const reportProgress = useCallback(
    (
      next: ApplePlaybackProgress,
      _force = false,
      _stateOverride?: 'playing' | 'paused' | 'buffering',
    ) => {
      progressRef.current = next;
      setProgress(next);
      if (castReceiverOwnedRef.current) return;
      // AVPlayer's continuation mailbox is the sole periodic progress and
      // media-grant extension authority on Apple. A second JS sequence
      // allocator races it and can make terminal events stale. JS keeps only
      // presentation state here; shutdown/completion perform bounded final
      // writes through Client Core below.
    },
    [],
  );

  const changeNativeState = useCallback(
    (state: ApplePlaybackState) => {
      nativeStateRef.current = state;
      setNativeState(state);
      if (state !== 'loading' && state !== 'buffering' && watchGroupRef.current) {
        watchApplyGroupRef.current?.(watchGroupRef.current);
      }
      if (state === 'playing') {
        nativeRecoveryAttemptRef.current = 0;
        setRouteReconnecting(false);
        setPlaybackFailure(undefined);
      }
      if (
        routeRecoveryInFlightRef.current &&
        (state === 'buffering' || state === 'loading')
      ) {
        setRouteReconnecting(true);
      }
      const current = progressRef.current;
      reportProgress(
        {...current, isPlaying: state === 'playing'},
        state === 'paused' || state === 'buffering',
        state === 'buffering'
          ? 'buffering'
          : state === 'playing'
            ? 'playing'
            : 'paused',
      );
    },
    [reportProgress],
  );

  const markMeaningfulInteraction = useCallback(() => {
    automationStateRef.current = reducePlaybackAutomation(
      automationStateRef.current,
      {type: 'meaningful-interaction', now: Date.now()},
      {
        passoutProtection: launchPreferences.passoutProtection,
        passoutAfterEpisodes: launchPreferences.passoutAfterEpisodes,
      },
    ).state;
  }, [
    launchPreferences.passoutAfterEpisodes,
    launchPreferences.passoutProtection,
  ]);

  const acceptPlaybackValue = useCallback(
    (value: PlaybackResponse) => {
      value = validatePlaybackResponse(value, {
        serverOrigins: playbackServerOrigins(getServerSession()?.apiBaseUrl),
      });
      if (shutdownRequestedRef.current) {
        void client.stopPlayback(value.sessionId).catch(() => undefined);
        return;
      }
      value.sourceUrl = client.resourceUrl(value.sourceUrl);
      playbackOperationEpochRef.current.advance();
      playbackRef.current = value;
      const nextProgress = {
        durationSeconds:
          value.timeline.durationSeconds ?? value.media.durationSeconds ?? 0,
        isPlaying: true,
        positionSeconds: value.resumePositionSeconds ?? 0,
      };
      progressRef.current = nextProgress;
      setProgress(nextProgress);
      setPlayback(value);
      setNativeState('loading');
      setEnded(false);
      setPostPlay({phase: 'inactive'});
      preparedNextRef.current = undefined;
      automationStateRef.current = reducePlaybackAutomation(
        automationStateRef.current,
        {type: 'session-changed', sessionId: value.sessionId, now: Date.now()},
        {
          passoutProtection: launchPreferences.passoutProtection,
          passoutAfterEpisodes: launchPreferences.passoutAfterEpisodes,
        },
      ).state;
    },
    [
      client,
      launchPreferences.passoutAfterEpisodes,
      launchPreferences.passoutProtection,
    ],
  );

  useEffect(() => {
    const abort = new AbortController();
    const routeRecoveryEpoch = routeRecoveryEpochRef.current;
    const unsubscribe = subscribeServerRouteChanges(change => {
      const current = playbackRef.current;
      if (
        !current ||
        !routeReconnecting ||
        nativeStateRef.current === 'playing' ||
        shutdownRequestedRef.current ||
        (change.serverId && change.serverId !== activeSession.serverId)
      ) return;
      const recoveryEpoch = routeRecoveryEpoch.advance();
      const previousSessionId = current.sessionId;
      routeRecoveryInFlightRef.current = true;
      const recovery = trackPlaybackOperation((async () => {
        let lastFailure: unknown;
        for (const delay of [0, 1_000, 2_500]) {
          if (delay) {
            await playbackDelay(delay, abort.signal).catch(() => undefined);
          }
          if (
            abort.signal.aborted ||
            shutdownRequestedRef.current ||
            !routeRecoveryEpoch.accepts(recoveryEpoch)
          ) return;
          const positionSeconds = Math.max(
            0,
            progressRef.current.positionSeconds,
          );
          try {
            const value = await startRoutedPlayback(
              client,
              launchDescriptorRef.current.sourceId,
              launchDescriptorRef.current.kind,
              positionSeconds,
              current.selectedVersionId,
              undefined,
              television ? 'tv' : 'mobile',
              {
                audioStreamId: current.selectedAudioStreamId,
                burnInSubtitleId:
                  current.selectedSubtitleMode === 'burn_in'
                    ? current.selectedSubtitleStreamId
                    : undefined,
                intent: {
                  networkClass: current.policy.networkClass === 'remote' ? 'unknown' : current.policy.networkClass,
                  transportClass: current.policy.transportClass,
                  qualityProfile: current.policy.qualityProfile,
                  directPlayPolicy: current.policy.directPlayPolicy,
                  directStreamPolicy: current.policy.directStreamPolicy,
                  transcodePolicy: current.policy.transcodePolicy,
                  maxVideoBitrateMbps: current.policy.maxVideoBitrateMbps,
                  maxAudioBitrateKbps: current.policy.maxAudioBitrateKbps,
                  maxVideoHeight: current.policy.maxVideoHeight,
                  allowHdr: current.policy.allowHdr,
                },
                queueMediaIds: current.queue.map(item => item.id),
                repeatMode: current.repeatMode,
                sourceContext: current.sourceContext,
              },
            );
            validatePlaybackResponse(value, {
              serverOrigins: playbackServerOrigins(getServerSession()?.apiBaseUrl),
            });
            if (
              abort.signal.aborted ||
              shutdownRequestedRef.current ||
              !routeRecoveryEpoch.accepts(recoveryEpoch)
            ) {
              await client.stopPlayback(value.sessionId).catch(() => undefined);
              return;
            }
            value.resumePositionSeconds = positionSeconds;
            value.sourceUrl = client.resourceUrl(value.sourceUrl);
            playbackOperationEpochRef.current.advance();
            playbackRef.current = value;
            const nextProgress = {
              durationSeconds:
                value.timeline.durationSeconds ??
                value.media.durationSeconds ??
                progressRef.current.durationSeconds,
              isPlaying: progressRef.current.isPlaying,
              positionSeconds,
            };
            progressRef.current = nextProgress;
            setProgress(nextProgress);
            setPlayback(value);
            setPlaybackFailure(undefined);
            setRouteReconnecting(false);
            nativeRecoveryAttemptRef.current = 0;
            if (previousSessionId !== value.sessionId) {
              await client
                .stopPlayback(previousSessionId)
                .catch(() => undefined);
            }
            return;
          } catch (cause) {
            lastFailure = cause;
          }
        }
        if (
          !abort.signal.aborted &&
          !shutdownRequestedRef.current &&
          routeRecoveryEpoch.accepts(recoveryEpoch)
        ) {
          playbackFailureKindRef.current = 'native';
          setPlaybackFailure(
            productErrorBody(lastFailure, 'playback.route-failed'),
          );
        }
      })().finally(() => {
        if (routeRecoveryEpoch.accepts(recoveryEpoch)) {
          routeRecoveryInFlightRef.current = false;
        }
      }));
      void recovery.catch(() => undefined);
    });
    return () => {
      abort.abort();
      routeRecoveryEpoch.advance();
      routeRecoveryInFlightRef.current = false;
      unsubscribe();
    };
  }, [
    activeSession.serverId,
    client,
    dvr,
    libraryChannel,
    live,
    routeReconnecting,
    television,
    trackPlaybackOperation,
  ]);

  const commitPlaybackCompletion = useCallback(
    async (current: PlaybackResponse): Promise<boolean> => {
      if (completionCommittedSessionRef.current === current.sessionId)
        return true;
      const pending = progressMailboxPromiseRef.current;
      if (pending) {
        try {
          await pending;
        } catch {
          // Client Core retains an uncertain event with its original sequence;
          // the terminal write below drives that mailbox forward safely.
        }
      }
      const latest = progressRef.current;
      for (let attempt = 0; attempt < 2; attempt += 1) {
        try {
          const acknowledgement = await client.touchPlayback(
            current.sessionId,
            {
              completed: true,
              durationSeconds: latest.durationSeconds || undefined,
              progressSeconds:
                latest.durationSeconds || latest.positionSeconds,
              state: 'paused',
            },
          );
          if (acknowledgement.accepted || acknowledgement.duplicate) {
            completionCommittedSessionRef.current = current.sessionId;
            return true;
          }
          // A stale event was not applied. Client Core has now reconciled its
          // next sequence with highestEventSequence, so retry the terminal
          // write once rather than falsely declaring completion durable.
          if (!acknowledgement.stale) return false;
        } catch {
          return false;
        }
      }
      return false;
    },
    [client],
  );

  const handoffPreparedNext = useCallback(
    async (prepared: PlaybackPreparedResponse) => {
      const current = playbackRef.current;
      if (!current || controlBusy || shutdownRequestedRef.current) return;
      setControlBusy(true);
      try {
        const clientProfile = playbackClientProfileForTarget(
          playbackTargetRef.current,
          platform,
        );
        const value = await client.handoffPlayback(current.sessionId, {
          clientProfile,
          preparedSessionId: prepared.preparedSessionId,
          expectedPlaybackRevision: current.playbackRevision,
          expectedQueueRevision: current.queueRevision,
          intent: playbackPreferenceIntent(),
          queueMediaIds: current.queue.map(item => item.id),
          requestId: playbackRequestId('handoff'),
          sourceContext: current.sourceContext,
        });
        if (
          !canCommitPreparedHandoff(
            current.sessionId,
            prepared.preparedSessionId,
            value.sessionId,
            prepared.playbackRevision,
            value.playbackRevision,
          )
        ) {
          await client.stopPlayback(value.sessionId).catch(() => undefined);
          throw new Error('Playback handoff was not accepted by the prepared session.');
        }
        acceptPlaybackValue(value);
        if (preparedCompletionSessionRef.current === current.sessionId) {
          preparedCompletionSessionRef.current = undefined;
          await commitPlaybackCompletion(current);
        }
      } catch (cause) {
        preparedNextRef.current = undefined;
        preparedCompletionSessionRef.current = undefined;
        await commitPlaybackCompletion(current);
        setPostPlay({
          phase: 'failed',
          nextTitle: prepared.playback.media.title,
          message: productErrorBody(cause, 'playback.up-next-failed'),
        });
        setEnded(true);
      } finally {
        setControlBusy(false);
      }
    },
    [
      acceptPlaybackValue,
      client,
      commitPlaybackCompletion,
      controlBusy,
      playbackPreferenceIntent,
      platform,
    ],
  );

  const preparePostPlay = useCallback(
    async (current: PlaybackResponse, commitCompletion = false) => {
      const next = current.queue[0];
      if (!next) {
        setPostPlay({phase: 'inactive'});
        setEnded(true);
        return;
      }
      setEnded(true);
      setPostPlay({phase: 'preparing', nextTitle: next.title});
      try {
        const clientProfile = playbackClientProfileForTarget(
          playbackTargetRef.current,
          platform,
        );
        const prepared = await client.prepareNextPlayback(current.sessionId, {
          clientProfile,
          intent: playbackPreferenceIntent(),
          queueMediaIds: current.queue.map(item => item.id),
          sourceContext: current.sourceContext,
        });
        if (
          shutdownRequestedRef.current ||
          playbackRef.current?.sessionId !== current.sessionId
        )
          return;
        preparedNextRef.current = prepared;
        preparedCompletionSessionRef.current = commitCompletion
          ? current.sessionId
          : undefined;
        setPostPlay({phase: 'countdown', prepared});
      } catch (cause) {
        if (playbackRef.current?.sessionId !== current.sessionId) return;
        preparedNextRef.current = undefined;
        preparedCompletionSessionRef.current = undefined;
        if (commitCompletion) await commitPlaybackCompletion(current);
        setPostPlay({
          phase: 'failed',
          nextTitle: next.title,
          message: productErrorBody(cause, 'playback.up-next-failed'),
        });
      }
    },
    [client, commitPlaybackCompletion, playbackPreferenceIntent, platform],
  );

  useEffect(() => {
    if (postPlay.phase !== 'countdown') return;
    const countdownSeconds = launchPreferences.autoplayNext
      ? launchPreferences.upNextCountdownSeconds
      : 0;
    const initial = reduceUpNextCountdown(countdownStateRef.current, {
      type: 'prepared',
      now: Date.now(),
      countdownSeconds,
      preparationExpiresAt: postPlay.prepared.expiresAt,
    });
    countdownStateRef.current = initial.state;
    if (countdownSeconds <= 0) {
      setPostPlayRemaining(0);
      return;
    }
    let handedOff = false;
    const tick = () => {
      const now = Date.now();
      setPostPlayRemaining(
        Math.max(
          0,
          Math.ceil(
            ((countdownStateRef.current.deadlineAt ?? now) - now) / 1_000,
          ),
        ),
      );
      const transition = reduceUpNextCountdown(countdownStateRef.current, {
        type: 'tick',
        now,
      });
      countdownStateRef.current = transition.state;
      if (transition.effect === 'handoff' && !handedOff) {
        handedOff = true;
        void handoffPreparedNext(postPlay.prepared);
      }
    };
    tick();
    const interval = setInterval(tick, 250);
    return () => clearInterval(interval);
  }, [
    handoffPreparedNext,
    launchPreferences.autoplayNext,
    launchPreferences.upNextCountdownSeconds,
    postPlay,
  ]);

  const finishPlayback = useCallback(async () => {
    const sleepAfterItem = sleepTimerShouldStop(sleepTimer, {
      type: 'item-ended',
    });
    if (sleepAfterItem) {
      setSleepTimer({mode: 'off'});
    }
    const current = playbackRef.current;
    const group = watchGroupRef.current;
    if (group) {
      if (current) await commitPlaybackCompletion(current);
      setEnded(true);
      if (group.permissions.canControl) {
        void client
          .updateWatchWithFriendsState(group.id, {
            action: 'next',
            expectedRevision: group.revision,
            idempotencyKey: watchWithFriendsIdempotencyKey('next'),
          })
          .then(next => {
            watchGroupRef.current = next;
            setWatchGroup(next);
          })
          .catch(cause =>
            setWatchGroupError(
              productErrorBody(cause, 'watch-with-friends.advance-failed'),
            ),
          );
      }
      return;
    }
    if (sleepAfterItem) {
      if (current) await commitPlaybackCompletion(current);
      setEnded(true);
      return;
    }
    if (current && !live && current.queue.length > 0) {
      if (launchPreferences.autoplayNext) {
        const automation = reducePlaybackAutomation(
          automationStateRef.current,
          {type: 'automatic-advance-requested', now: Date.now()},
          {
            passoutProtection: launchPreferences.passoutProtection,
            passoutAfterEpisodes: launchPreferences.passoutAfterEpisodes,
          },
        );
        automationStateRef.current = automation.state;
        if (automation.effect === 'confirm-still-watching') {
          setEnded(true);
          setPostPlay({
            phase: 'passout',
            nextTitle: current.queue[0]!.title,
          });
          return;
        }
      }
      // Keep the current playback session alive while the server prepares its
      // next rendition. Completion is committed only after preparation, so a
      // prepare/complete race cannot invalidate the source session first.
      void preparePostPlay(current, true);
      return;
    }
    if (current) await commitPlaybackCompletion(current);
    setPostPlay({phase: 'inactive'});
    setEnded(true);
  }, [
    client,
    commitPlaybackCompletion,
    launchPreferences.autoplayNext,
    launchPreferences.passoutAfterEpisodes,
    launchPreferences.passoutProtection,
    live,
    preparePostPlay,
    sleepTimer,
  ]);

  const applyGoogleCastState = useCallback(
    (next: GoogleCastState) => {
      if (
        next.castSessionId &&
        castSessionIdRef.current !== next.castSessionId
      ) {
        castSessionIdRef.current = next.castSessionId;
        castReceiverReadyRef.current = undefined;
        castReceiverReadyNonceRef.current = undefined;
        castReceiverSessionRef.current = undefined;
        castReceiverOwnedRef.current = false;
      }
      if (
        next.receiverReady?.receiverPublicKey &&
        next.receiverReady.receiverChallenge &&
        next.receiverReady.castSessionId === next.castSessionId &&
        (next.receiverReady.receiverId || next.receiverId)
      ) {
        const ready = {
          castSessionId: next.receiverReady.castSessionId,
          receiverId: next.receiverReady.receiverId ?? next.receiverId!,
          receiverPublicKey: next.receiverReady.receiverPublicKey,
          receiverChallenge: next.receiverReady.receiverChallenge,
          nonce: next.receiverReady.nonce,
        };
        const previous = castReceiverReadyRef.current;
        castReceiverReadyRef.current = ready;
        castReceiverReadyNonceRef.current = next.receiverReady.nonce;
        if (
          next.receiverReady.receiverSessionId &&
          Number.isInteger(next.receiverReady.generation) &&
          Number(next.receiverReady.generation) > 0
        ) {
          castReceiverSessionRef.current = {
            castSessionId: next.receiverReady.castSessionId,
            receiverSessionId: next.receiverReady.receiverSessionId,
            generation: Number(next.receiverReady.generation),
          };
        }
        if (
          !previous ||
          previous.castSessionId !== ready.castSessionId ||
          previous.receiverId !== ready.receiverId ||
          previous.receiverPublicKey !== ready.receiverPublicKey ||
          previous.receiverChallenge !== ready.receiverChallenge ||
          previous.nonce !== ready.nonce
        ) {
          // Readiness arrives independently of ordinary Cast state. Wake the
          // target handoff effect instead of waiting for an unrelated render.
          setTargetSwitchRevision(value => value + 1);
        }
      }
      if (
        next.receiverSessionReady?.receiverSessionId &&
        next.receiverSessionReady.castSessionId === next.castSessionId
      ) {
        castReceiverSessionRef.current = {
          castSessionId: next.receiverSessionReady.castSessionId,
          receiverSessionId: next.receiverSessionReady.receiverSessionId,
          generation: next.receiverSessionReady.generation,
        };
        castHasLoadedRef.current = true;
      }
      const wasConnected = castConnectedRef.current;
      const hadLoadedMedia = castHasLoadedRef.current;
      castConnectedRef.current = next.connected || next.recovering;
      setCastState(next);
      if (next.recovering) {
        setNativeState('buffering');
        return;
      }
      if (!next.connected) {
        blockedPlaybackTargetRef.current = undefined;
        castLoadedSourceRef.current = undefined;
        castExpectedSourceRef.current = undefined;
        castHasLoadedRef.current = false;
        castWasPlayingRef.current = false;
        castCompletionHandledRef.current = false;
        castReceiverReadyRef.current = undefined;
        castReceiverReadyNonceRef.current = undefined;
        castReceiverSessionRef.current = undefined;
        castReceiverOwnedRef.current = false;
        if (wasConnected && hadLoadedMedia) setNativeState('loading');
        return;
      }
      const expectedSource = castExpectedSourceRef.current;
      if (
        !castReceiverOwnedRef.current &&
        (!castHasLoadedRef.current ||
          !expectedSource ||
          next.contentURL !== expectedSource)
      )
        return;
      const state: ApplePlaybackState =
        next.playerState === 'playing'
          ? 'playing'
          : next.playerState === 'buffering' || next.playerState === 'loading'
            ? next.playerState
            : 'paused';
      const nextProgress = {
        durationSeconds:
          next.durationSeconds || progressRef.current.durationSeconds,
        isPlaying: next.playerState === 'playing',
        positionSeconds: Math.max(0, next.positionSeconds),
      };
      setNativeState(state);
      reportProgress(
        nextProgress,
        state !== 'playing',
        state === 'buffering' || state === 'loading' ? 'buffering' : state,
      );
      if (next.playerState === 'playing') castWasPlayingRef.current = true;
      const reachedEnd =
        next.idleReason === 'finished' ||
        (nextProgress.durationSeconds > 0 &&
          nextProgress.positionSeconds >=
            Math.max(
              nextProgress.durationSeconds - 5,
              nextProgress.durationSeconds * 0.98,
            ));
      if (
        next.playerState === 'idle' &&
        castWasPlayingRef.current &&
        reachedEnd &&
        !castCompletionHandledRef.current
      ) {
        castCompletionHandledRef.current = true;
        // Once the receiver redeems the bootstrap it is the sole progress,
        // completion, passout, and Up Next authority. The sender must not
        // commit the same completion or advance the queue a second time.
        if (!castReceiverOwnedRef.current) finishPlayback();
      }
      if (next.playerState === 'idle' && next.idleReason === 'error') {
        playbackFailureKindRef.current = 'cast-load';
        setPlaybackFailure(
          'The Cast device could not continue playing this stream.',
        );
      }
    },
    [finishPlayback, reportProgress],
  );

  useEffect(() => {
    if (television) return undefined;
    return subscribeToGoogleCastState(applyGoogleCastState);
  }, [applyGoogleCastState, television]);

  useEffect(() => {
    if (
      television ||
      !castState.configured ||
      !castState.connected ||
      castReceiverReadyRef.current
    )
      return undefined;
    let cancelled = false;
    const request = () => {
      if (cancelled || castReceiverReadyRef.current) return;
      const nonce =
        castReceiverReadyNonceRef.current ??
        `ready-${Date.now()}-${Math.random().toString(36).slice(2)}`;
      // Retry the same request identity. Rotating the nonce on every attempt
      // can make a delayed but authentic reply perpetually stale.
      castReceiverReadyNonceRef.current = nonce;
      void googleCastController.requestReceiverReady(nonce).catch(() => undefined);
    };
    request();
    const timer = setInterval(request, 2_000);
    return () => {
      cancelled = true;
      clearInterval(timer);
    };
  }, [castState.configured, castState.connected, television]);

  useEffect(() => {
    if (!castActive) return undefined;
    const timer = setInterval(() => {
      void getGoogleCastState()
        .then(applyGoogleCastState)
        .catch(() => undefined);
    }, 1_000);
    return () => clearInterval(timer);
  }, [applyGoogleCastState, castActive]);

  useEffect(() => {
    const desiredTarget: NativePlaybackTarget = castActive
      ? 'google-cast'
      : 'apple';
    const current = playbackRef.current;
    if (
      !current ||
      playbackTargetRef.current === desiredTarget ||
      blockedPlaybackTargetRef.current === desiredTarget ||
      targetSwitchInFlightRef.current
    )
      return;
    targetSwitchInFlightRef.current = desiredTarget;
    setControlBusy(true);
    setNativeState('loading');
    const positionSeconds = Math.max(0, progressRef.current.positionSeconds);
    const sourceSessionId = current.sessionId;
    const operationEpoch = playbackOperationEpochRef.current.capture();
    const operationIsCurrent = () =>
      playbackRef.current?.sessionId === sourceSessionId &&
      playbackOperationEpochRef.current.accepts(operationEpoch) &&
      !shutdownRequestedRef.current;
    void trackPlaybackOperation(
      (async () => {
        try {
          if (desiredTarget === 'google-cast') {
            const existing = castReceiverSessionRef.current;
            if (
              existing?.receiverSessionId &&
              existing.castSessionId === castSessionIdRef.current
            ) {
              try {
                const state = await client.reconnectCast({
                  receiverSessionId: existing.receiverSessionId,
                  generation: existing.generation,
                });
                if (
                  state.status === 'active' &&
                  state.generation === existing.generation
                ) {
                  castReceiverOwnedRef.current = true;
                  playerRef.current?.pause();
                  playbackTargetRef.current = 'google-cast';
                  setPlaybackTarget('google-cast');
                  setNativeState('playing');
                  return;
                }
              } catch {
                castReceiverSessionRef.current = undefined;
              }
            }
            const ready = castReceiverReadyRef.current;
            if (!ready?.receiverId) return;
            const bootstrap = await createCastBootstrap(
              client,
              current,
              ready,
              platform,
              {
                intent: playbackPreferenceIntent(current.selectedSubtitleMode),
                positionSeconds,
                sourceId: launchDescriptorRef.current.sourceId,
                sourceKind: launchDescriptorRef.current.kind,
              },
            );
            if (!operationIsCurrent()) return;
            const next = await googleCastController.load({
              autoplay: true,
              contentType: googleCastContentType(current),
              durationSeconds:
                current.timeline.durationSeconds ??
                current.media.durationSeconds,
              isLive: current.isLive === true,
              sourceURL: PORTICO_CAST_BOOTSTRAP_PLACEHOLDER,
              customData: {
                ...bootstrap,
                receiverChallenge: ready.receiverChallenge,
              },
              startPositionSeconds: positionSeconds,
              subtitle:
                [current.media.parentTitle, current.media.grandparentTitle]
                  .filter(Boolean)
                  .join(' · ') || undefined,
              title: current.media.title,
            });
            if (!operationIsCurrent()) return;
            castReceiverOwnedRef.current = true;
            castHasLoadedRef.current = true;
            castExpectedSourceRef.current = undefined;
            playerRef.current?.pause();
            playbackTargetRef.current = 'google-cast';
            setPlaybackTarget('google-cast');
            setNativeState('loading');
            setPlaybackFailure(undefined);
            applyGoogleCastState(next);
            return;
          }

          if (castReceiverOwnedRef.current) {
            await googleCastController.stop().catch(() => undefined);
            castReceiverOwnedRef.current = false;
            castReceiverSessionRef.current = undefined;
          }
          const route = {
            kind: launchDescriptorRef.current.kind,
            positionSeconds,
            sourceId: launchDescriptorRef.current.sourceId,
          };
          const sourceSession = current;
          const value = await handoffPlaybackTarget(
            client,
            sourceSession,
            'apple',
            platform,
            route,
          );
          if (!operationIsCurrent()) {
            if (value.sessionId !== sourceSessionId)
              await client.stopPlayback(value.sessionId).catch(() => undefined);
            return;
          }
          value.sourceUrl = client.resourceUrl(value.sourceUrl);
          if (live && sourceSession.sessionId !== value.sessionId)
            await client
              .stopPlayback(sourceSession.sessionId)
              .catch(() => undefined);
          if (!playbackRef.current) {
            await client.stopPlayback(value.sessionId).catch(() => undefined);
            return;
          }
          playbackOperationEpochRef.current.advance();
          playbackTargetRef.current = 'apple';
          setPlaybackTarget('apple');
          playbackRef.current = value;
          const nextProgress = {
            durationSeconds:
              value.timeline.durationSeconds ??
              value.media.durationSeconds ??
              progressRef.current.durationSeconds,
            isPlaying: true,
            positionSeconds,
          };
          progressRef.current = nextProgress;
          setProgress(nextProgress);
          setPlayback(value);
          setPlaybackFailure(undefined);
        } catch (cause) {
          if (!operationIsCurrent()) return;
          blockedPlaybackTargetRef.current = desiredTarget;
          playbackFailureKindRef.current = 'target';
          setPlaybackFailure(
            productErrorBody(cause, 'playback.start-failed'),
          );
        } finally {
          targetSwitchInFlightRef.current = undefined;
          setControlBusy(false);
          if (
            playbackTargetRef.current !== desiredPlaybackTargetRef.current &&
            blockedPlaybackTargetRef.current !==
              desiredPlaybackTargetRef.current
          ) {
            setTargetSwitchRevision(value => value + 1);
          }
        }
      })(),
    ).catch(() => undefined);
  }, [
    applyGoogleCastState,
    castActive,
    client,
    dvr,
    launchPreferences,
    live,
    mediaId,
    platform,
    playback?.sessionId,
    playbackPreferenceIntent,
    targetSwitchRevision,
    trackPlaybackOperation,
  ]);

  const renewGrant = useCallback(
    async (terminalOnFailure = false) => {
      const current = playbackRef.current;
      if (castReceiverOwnedRef.current) return false;
      if (!current || renewingGrantRef.current) return false;
      const operationEpoch = playbackOperationEpochRef.current.capture();
      renewingGrantRef.current = true;
      if (terminalOnFailure) setNativeState('buffering');
      try {
        const mediaGrant = await client.renewPlaybackMediaGrant(
          current.sessionId,
        );
        if (
          playbackRef.current?.sessionId !== current.sessionId ||
          !playbackOperationEpochRef.current.accepts(operationEpoch)
        )
          return false;
        const value = {
          ...current,
          mediaGrant,
          resumePositionSeconds: progressRef.current.positionSeconds,
          sourceUrl: sourceWithMediaGrant(current.sourceUrl, mediaGrant.token),
        };
        playbackRef.current = value;
        setPlayback(value);
        setPlaybackFailure(undefined);
        setRouteReconnecting(false);
        return true;
      } catch (cause) {
        if (
          terminalOnFailure &&
          playbackRef.current?.sessionId === current.sessionId &&
          playbackOperationEpochRef.current.accepts(operationEpoch)
        ) {
          playbackFailureKindRef.current = 'grant';
          setPlaybackFailure(
            productErrorBody(cause, 'playback.route-failed'),
          );
          setRouteReconnecting(false);
        }
        return false;
      } finally {
        renewingGrantRef.current = false;
      }
    },
    [client],
  );

  const renewGrantWithRetry = useCallback(async () => {
    const sessionId = playbackRef.current?.sessionId;
    if (!sessionId) return;
    for (const delay of [0, 2_000, 5_000]) {
      if (delay > 0)
        await new Promise<void>(resolve => setTimeout(resolve, delay));
      if (playbackRef.current?.sessionId !== sessionId) return;
      if (await renewGrant()) return;
    }
    if (playbackRef.current?.sessionId === sessionId) {
      playbackFailureKindRef.current = 'grant';
      setPlaybackFailure(
        productBody('playback.failed'),
      );
      setRouteReconnecting(false);
    }
  }, [renewGrant]);

  const selectedServerApiBaseUrl = getServerSession()?.apiBaseUrl;
  const selectedServerOrigins = useMemo(
    () => playbackServerOrigins(selectedServerApiBaseUrl),
    [selectedServerApiBaseUrl],
  );
  const applePlaybackDescriptor = useMemo(() => {
    if (!playback || selectedServerOrigins.length === 0) return undefined;
    const canonical = playback as PlaybackResponse & {
      continuationCredential: ApplePlaybackDescriptor['continuationCredential'];
      playbackRevision: number;
    };
    const continuationURL = `${canonical.continuationCredential.origin}/api/playback-sessions/${encodeURIComponent(playback.sessionId)}/continuation`;
    const routePolicy = {
      // Insecure Local Auth is based on the actual selected origins, never a
      // mutable route label. Public HTTP remains forbidden.
      allowInsecureLan:
        selectedServerOrigins
          .filter(origin => origin.startsWith('http://'))
          .every(origin => {
            try {
              return isTrustedInsecureHost(
                (new URL(origin) as unknown as {hostname: string}).hostname,
              );
            } catch {
              return false;
            }
          }) && selectedServerOrigins.some(origin => origin.startsWith('http://')),
    };
    const descriptor: ApplePlaybackDescriptor & Record<string, unknown> = {
      url: playback.sourceUrl,
      mediaGrant: playback.mediaGrant.token,
      sessionId: playback.sessionId,
      continuationURL,
      continuationCredential: canonical.continuationCredential,
      nextEventSequence: playback.nextEventSequence,
      playbackRevision: canonical.playbackRevision,
      resumePositionSeconds: Math.max(
        progressRef.current.positionSeconds,
        playback.resumePositionSeconds ?? 0,
      ),
      playbackGeneration: playback.generation,
      serverOrigins: selectedServerOrigins,
      routePolicy,
      revision: `${playback.sessionId}:${canonical.playbackRevision}:${playback.generation}:${playback.mediaGrant.expiresAt}`,
    };
    return descriptor;
  }, [playback, selectedServerOrigins]);

  if (watchWithFriendsGroupId && watchGroupStatus === 'unavailable') {
    return (
      <PlaybackFailureSurface
        message={
          watchGroupError ?? productBody('watch-with-friends.unavailable')
        }
        onBack={leaveGroupAndBack}
        onRetry={() => {
          setWatchGroupError(undefined);
          setWatchGroupStatus('reconnecting');
          setStartRevision(value => value + 1);
          setWatchConnectionRevision(value => value + 1);
        }}
        platform={platform}
        title={productTitle('watch-with-friends.unavailable')}
      />
    );
  }
  if (!playback && !startError) {
    return (
      <View style={styles.detailLoading}>
        <ActivityIndicator color={color.screenBlueStrong} size="large" />
        <Text
          style={
            television ? styles.bufferingTextTv : styles.bufferingTextMobile
          }
        >
          {productTitle(
            watchWithFriendsGroupId
              ? 'watch-with-friends.reconnecting'
              : 'playback.preparing',
          )}
        </Text>
        <View style={styles.detailLoadingActions}>
          <ControlButton
            icon="navigation.back"
            label={productText('action.back-to-details')}
            onPress={leaveGroupAndBack}
            platform={platform}
          />
        </View>
      </View>
    );
  }
  if (startError) {
    return (
      <PlaybackFailureSurface
        message={startError}
        onBack={leaveGroupAndBack}
        onRetry={() => setStartRevision(value => value + 1)}
        platform={platform}
        title={productTitle('playback.start-failed')}
      />
    );
  }
  if (!playback) return null;

  const item = detailViewModel(playback.media, client, platform).media;
  // The server response is authoritative. A DVR/live screen can contain a
  // completed recording or a timeshift window, so the original route flag is
  // not a valid native seek/playback capability signal.
  const effectiveLive = playback.isLive === true || castState.isLive;
  const contentMode = playerContentMode(playback.media, effectiveLive);
  const audioOnly = contentMode === 'music' || contentMode === 'audiobook';
  const timelineCapabilities = playback.timeline as unknown as {
    canPause?: unknown;
    canSeek?: unknown;
  };
  const watchControlAllowed = watchAuthority.controlsEnabled;
  const groupUpcomingQueue = watchGroup
    ? watchGroupUpcomingItems(
        watchGroup.queue,
        watchGroup.mediaId,
        watchGroup.repeatMode,
      )
    : [];
  const canSeek =
    watchControlAllowed &&
    (typeof timelineCapabilities.canSeek === 'boolean'
      ? timelineCapabilities.canSeek
      : !effectiveLive) &&
    (!castActive || castState.canSeek);
  const canTogglePlayback =
    watchControlAllowed &&
    (typeof timelineCapabilities.canPause === 'boolean'
      ? timelineCapabilities.canPause
      : true) &&
    (!castActive || nativeState !== 'playing' || castState.canPause);
  const duration =
    progress.durationSeconds ||
    playback.timeline.durationSeconds ||
    playback.media.durationSeconds ||
    0;
  const trickplaySet = trickplayQuery.data?.items.find(set => !set.stale);
  const trickplayTileIndex =
    trickplaySet && seekPreviewSeconds !== undefined
      ? Math.min(
          trickplaySet.tileCount - 1,
          Math.max(
            0,
            Math.floor(seekPreviewSeconds / trickplaySet.intervalSeconds),
          ),
        )
      : undefined;
  const progressPercent =
    duration > 0
      ? Math.min(100, Math.max(0, (progress.positionSeconds / duration) * 100))
      : 0;
  const runCastCommand = (command: Promise<GoogleCastState>) => {
    void trackPlaybackOperation(
      command
        .then(next => {
          if (!shutdownRequestedRef.current) applyGoogleCastState(next);
          return next;
        })
        .catch(cause => {
          if (!shutdownRequestedRef.current) {
            playbackFailureKindRef.current = 'cast-load';
            setPlaybackFailure(
              productErrorBody(cause, 'playback.failed'),
            );
          }
          throw cause;
        }),
    ).catch(() => undefined);
  };
  const publishWatchGroupState = async (
    action: 'play' | 'pause' | 'seek' | 'next',
    positionSeconds?: number,
    requestedPlaybackRate?: number,
  ): Promise<boolean> => {
    const group = watchGroupRef.current;
    if (!group) return true;
    if (!group.permissions.canControl) return false;
    setControlBusy(true);
    try {
      const next = await client.updateWatchWithFriendsState(group.id, {
        action,
        expectedRevision: group.revision,
        idempotencyKey: watchWithFriendsIdempotencyKey(action),
        playbackRate: requestedPlaybackRate,
        positionSeconds,
      });
      watchGroupRef.current = next;
      setWatchGroup(next);
      return true;
    } catch (cause) {
      setWatchGroupError(
        productErrorBody(cause, 'watch-with-friends.command-failed'),
      );
      return false;
    } finally {
      setControlBusy(false);
    }
  };
  const playWatchGroupQueueItem = (queueIndex: number) =>
    trackPlaybackOperation(
      (async () => {
        let group = watchGroupRef.current;
        if (!group || controlBusy || !group.permissions.canControl) return;
        const upcoming = watchGroupUpcomingItems(
          group.queue,
          group.mediaId,
          group.repeatMode,
        );
        const selected = upcoming[queueIndex];
        if (!selected) return;
        setControlBusy(true);
        try {
          if (queueIndex > 0) {
            if (!group.permissions.canManageQueue) return;
            group = await client.reorderWatchWithFriendsQueue(group.id, {
              expectedRevision: group.revision,
              idempotencyKey: watchWithFriendsIdempotencyKey('queue-select'),
              mediaIds: promoteWatchGroupItemAfterCurrent(
                group.queue,
                group.mediaId,
                selected.mediaId,
              ),
            });
            watchGroupRef.current = group;
            setWatchGroup(group);
          }
          const next = await client.updateWatchWithFriendsState(group.id, {
            action: 'next',
            expectedRevision: group.revision,
            idempotencyKey: watchWithFriendsIdempotencyKey('next'),
          });
          watchGroupRef.current = next;
          setWatchGroup(next);
          setPanel(null);
        } catch (cause) {
          setWatchGroupError(
            productErrorBody(cause, 'watch-with-friends.command-failed'),
          );
        } finally {
          setControlBusy(false);
        }
      })(),
    );
  const playCurrent = () => {
    markMeaningfulInteraction();
    if (watchGroupRef.current) {
      void publishWatchGroupState('play', progress.positionSeconds);
      return;
    }
    if (castActive) runCastCommand(googleCastController.play());
    else playerRef.current?.play();
  };
  const pauseCurrent = () => {
    markMeaningfulInteraction();
    if (watchGroupRef.current) {
      void publishWatchGroupState('pause', progress.positionSeconds);
      return;
    }
    if (castActive) runCastCommand(googleCastController.pause());
    else playerRef.current?.pause();
  };
  const seekTo = (seconds: number) => {
    if (!canSeek) return;
    markMeaningfulInteraction();
    const target = boundedPlayerPosition(seconds, duration);
    if (watchGroupRef.current) {
      void publishWatchGroupState('seek', target);
      return;
    }
    if (castActive) runCastCommand(googleCastController.seek(target));
    else playerRef.current?.seekTo(target);
  };
  const togglePlayback = () =>
    nativeState === 'playing' ? pauseCurrent() : playCurrent();
  const seekBy = (delta: number) => seekTo(progress.positionSeconds + delta);
  const seekFromTimeline = (locationX: number) => {
    const width = progressWidthRef.current;
    if (!canSeek) return;
    const target = playerTimelinePressTarget(locationX, width, duration);
    if (target !== undefined) seekTo(target);
  };
  const acceptReplacement = acceptPlaybackValue;
  const restartSelection = (selection: {
    audioStreamId?: string;
    qualityId?: string;
    subtitleMode?: 'off' | 'text' | 'burn_in';
    subtitleStreamId?: string;
  }) =>
    trackPlaybackOperation(
      (async () => {
        if (controlBusy || effectiveLive || dvr) return;
        setControlBusy(true);
        const current = playbackRef.current;
        if (!current) {
          setControlBusy(false);
          return;
        }
        try {
          const renegotiated = await client.renegotiatePlayback(current.sessionId, {
            ...selection,
            expectedRevision: current.playbackRevision,
            requestId: playbackRequestId('renegotiate'),
            intent: playbackPreferenceIntent(selection.subtitleMode),
            versionId: current.selectedVersionId,
          });
          const value = {
            ...renegotiated,
            // Renegotiation replaces the source inside the same logical
            // session. Preserve the player head observed when the response
            // arrives instead of jumping back to the last server heartbeat.
            resumePositionSeconds: progressRef.current.positionSeconds,
          };
          if (shutdownRequestedRef.current) {
            await client.stopPlayback(value.sessionId).catch(() => undefined);
            return;
          }
          acceptReplacement(value);
        } catch (cause) {
          playbackFailureKindRef.current = 'native';
          setPlaybackFailure(
            productErrorBody(cause, 'playback.start-failed'),
          );
        } finally {
          setControlBusy(false);
        }
      })(),
    );
  const selectQuality = (qualityId: string) => {
    if (!playerQualitySelectionAllowed(playback, qualityId, {busy: controlBusy, isLive: effectiveLive})) return;
    void restartSelection({qualityId});
  };
  const selectSubtitle = (subtitleId: string) => {
    const selection = playerSubtitleSelection(playback, subtitleId, {busy: controlBusy, dvr, isLive: effectiveLive});
    if (selection) void restartSelection(selection);
  };
  const playNext = (queueIndex = 0) =>
    trackPlaybackOperation(
      (async () => {
        let current = playbackRef.current;
        if (
          controlBusy ||
          effectiveLive ||
          !current ||
          queueIndex < 0 ||
          queueIndex >= current.queue.length
        )
          return;
        markMeaningfulInteraction();
        setControlBusy(true);
        try {
          if (queueIndex > 0) {
            const response = await client.updatePlaybackSessionQueue(
              current.sessionId,
              {
                expectedRevision: current.queueRevision,
                mediaIds: promoteQueueItem(current.queue, queueIndex),
                repeatMode: current.repeatMode,
              },
            );
            current = {
              ...current,
              queue: response.items,
              queueRevision: response.revision,
              repeatMode: response.repeatMode,
            };
            preparedNextRef.current = undefined;
            playbackRef.current = current;
            setPlayback(current);
          }
          const cached = preparedNextRef.current;
          const clientProfile = playbackClientProfileForTarget(
            playbackTargetRef.current,
            platform,
          );
          const prepared =
            cached && Date.parse(cached.expiresAt) > Date.now() + 2_000
              ? cached
              : await client.prepareNextPlayback(current.sessionId, {
                  clientProfile,
                  intent: playbackPreferenceIntent(),
                  queueMediaIds: current.queue.map(item => item.id),
                  sourceContext: current.sourceContext,
                });
          const value = await client.handoffPlayback(current.sessionId, {
            clientProfile,
            preparedSessionId: prepared.preparedSessionId,
            expectedPlaybackRevision: current.playbackRevision,
            expectedQueueRevision: current.queueRevision,
            intent: playbackPreferenceIntent(),
            queueMediaIds: current.queue.map(item => item.id),
            requestId: playbackRequestId('handoff'),
            sourceContext: current.sourceContext,
          });
          if (
            !canCommitPreparedHandoff(
              current.sessionId,
              prepared.preparedSessionId,
              value.sessionId,
              prepared.playbackRevision,
              value.playbackRevision,
            )
          ) {
            await client.stopPlayback(value.sessionId).catch(() => undefined);
            throw new Error(
              'Playback handoff was not accepted by the prepared session.',
            );
          }
          if (shutdownRequestedRef.current) {
            await client.stopPlayback(value.sessionId).catch(() => undefined);
            return;
          }
          if (value.media.id !== current.media.id) {
            playbackHistoryRef.current.push({mediaId: current.media.id, title: current.media.title});
            launchDescriptorRef.current = {kind: 'media', sourceId: value.media.id};
          }
          acceptReplacement(value);
          setPanel(null);
        } catch (cause) {
          playbackFailureKindRef.current =
            playbackTargetRef.current === 'google-cast'
              ? 'cast-load'
              : 'native';
          setPlaybackFailure(
            productErrorBody(cause, 'playback.up-next-failed'),
          );
        } finally {
          setControlBusy(false);
        }
      })(),
    );

  const playPrevious = () =>
    trackPlaybackOperation(
      (async () => {
        const current = playbackRef.current;
        const previous = playbackHistoryRef.current.peek();
        if (controlBusy || effectiveLive || watchGroupRef.current || !current || !previous) return;
        markMeaningfulInteraction();
        setControlBusy(true);
        try {
          const value = await startRoutedPlayback(
            client,
            previous.mediaId,
            'media',
            0,
            undefined,
            undefined,
            television ? 'tv' : 'mobile',
            {
              intent: playbackPreferenceIntent(),
              queueMediaIds: queueAfterReturningToPrevious(current.media.id, current.queue.map(item => item.id)),
              repeatMode: current.repeatMode,
              sourceContext: current.sourceContext,
            },
          );
          if (shutdownRequestedRef.current) {
            await client.stopPlayback(value.sessionId).catch(() => undefined);
            return;
          }
          playbackHistoryRef.current.commitPrevious(previous.mediaId);
          launchDescriptorRef.current = {kind: 'media', sourceId: previous.mediaId};
          acceptReplacement(value);
          await client.stopPlayback(current.sessionId).catch(() => undefined);
          setPanel(null);
        } catch (cause) {
          setPlaybackFailure(productErrorBody(cause, 'playback.start-failed'));
        } finally {
          setControlBusy(false);
        }
      })(),
    );

  const applySessionQueue = (
    response: Awaited<ReturnType<PorticoClient['playbackSessionQueue']>>,
  ) => {
    const current = playbackRef.current;
    if (!current || current.sessionId !== response.sessionId) return;
    const next = {
      ...current,
      queue: response.items,
      queueRevision: response.revision,
      repeatMode: response.repeatMode,
    };
    preparedNextRef.current = undefined;
    playbackRef.current = next;
    setPlayback(next);
  };

  const shuffleQueue = () =>
    trackPlaybackOperation(
      (async () => {
        const current = playbackRef.current;
        if (controlBusy || !current || current.queue.length < 2) return;
        setControlBusy(true);
        try {
          applySessionQueue(
            await client.updatePlaybackSessionQueue(current.sessionId, {
              expectedRevision: current.queueRevision,
              mediaIds: shuffledQueueMediaIds(current.queue),
              repeatMode: current.repeatMode,
            }),
          );
        } catch (cause) {
          setPlaybackFailure(
            productErrorMessageId(cause, 'catalog.action-failed', {
              actionName: 'shuffle the playback queue',
            }),
          );
        } finally {
          setControlBusy(false);
        }
      })(),
    );

  const cycleRepeatMode = () =>
    trackPlaybackOperation(
      (async () => {
        const current = playbackRef.current;
        if (controlBusy || !current) return;
        const repeatMode =
          current.repeatMode === 'off'
            ? 'all'
            : current.repeatMode === 'all'
              ? 'one'
              : 'off';
        setControlBusy(true);
        try {
          applySessionQueue(
            await client.mutatePlaybackSessionQueue(current.sessionId, {
              action: 'set_repeat',
              expectedRevision: current.queueRevision,
              repeatMode,
            }),
          );
        } catch (cause) {
          setPlaybackFailure(
            productErrorMessageId(cause, 'catalog.action-failed', {
              actionName: 'change repeat mode',
            }),
          );
        } finally {
          setControlBusy(false);
        }
      })(),
    );

  const cancelPostPlay = () => {
    countdownStateRef.current = reduceUpNextCountdown(
      countdownStateRef.current,
      {type: 'cancel'},
    ).state;
    const nextTitle =
      postPlay.phase === 'countdown'
        ? postPlay.prepared.playback.media.title
        : 'nextTitle' in postPlay
          ? postPlay.nextTitle
          : playback.queue[0]?.title ?? '';
    setPostPlay({phase: 'cancelled', nextTitle});
    setEnded(true);
  };

  const replayCurrent = () => {
    markMeaningfulInteraction();
    countdownStateRef.current = {phase: 'inactive'};
    preparedNextRef.current = undefined;
    setPostPlay({phase: 'inactive'});
    setEnded(false);
    seekTo(0);
    playCurrent();
  };

  const confirmStillWatching = () => {
    markMeaningfulInteraction();
    const current = playbackRef.current;
    if (current) void commitPlaybackCompletion(current);
    preparedNextRef.current = undefined;
    preparedCompletionSessionRef.current = undefined;
    if (current) void preparePostPlay(current);
  };

  return (
    <View onTouchStart={revealPlayerChrome} style={styles.player} testID={`portico-four-player-${platform}`}>
      <TVTimelineRemoteHandler
        enabled={television && canSeek}
        focused={() => progressFocusedRef.current}
        intervalSeconds={preferences.seekIntervalSeconds}
        onSeekBy={seekBy}
      />
      <PersistentPlaybackBridge
        active={!ended && !playbackFailure}
        artwork={item.poster}
        canNext={watchControlAllowed && (watchGroup ? groupUpcomingQueue.length : playback.queue.length) > 0}
        canPrevious={!watchGroup && playbackHistoryRef.current.canPrevious}
        canSeek={canSeek}
        isPlaying={progress.isPlaying}
        mediaFamily={audioOnly ? 'audio' : 'video'}
        mediaId={playback.media.id}
        onNext={() => watchGroup ? void publishWatchGroupState('next') : void playNext()}
        onPause={pauseCurrent}
        onPlay={playCurrent}
        onPrevious={() => void playPrevious()}
        onSeekBy={seekBy}
        onStop={shutdownPlayback}
        platform={television ? 'tv' : 'mobile'}
        presentation={audioOnly && !television && !mobileAudioExpanded ? 'collapsed' : 'fullscreen'}
        subtitle={playback.media.grandparentTitle ?? playback.media.parentTitle}
        title={playback.media.title}
      />
      {!castActive && playbackTarget === 'apple' ? (
        <ApplePlayer
          allowsCellularAccess={launchPreferences.allowCellularStreaming}
          authorization={`PorticoMedia ${playback.mediaGrant.token}`}
          playbackDescriptor={applePlaybackDescriptor}
          autoplay={watchGroup ? watchGroup.state === 'playing' : true}
          contentMode={playerContentMode(playback.media, effectiveLive)}
          isLive={effectiveLive}
          metadataSubtitle={
            playback.media.grandparentTitle ?? playback.media.parentTitle ?? ''
          }
          metadataTitle={playback.media.title}
          onCapabilitiesChange={setPlayerCapabilities}
          onEnd={finishPlayback}
          onError={failure => {
            const category =
              failure.category ??
              (failure.kind === 'audio-session' ? 'configuration' : 'decoder');
            const message = failure.message?.trim()
              ? productBody('playback.failed') + '\n' + failure.message.trim()
              : productBody('playback.failed');
            if (category === 'grant') {
              playbackFailureKindRef.current = 'grant';
              void renewGrant(true);
              return;
            }
            if (category !== 'route') {
              playbackFailureKindRef.current = 'native';
              setPlaybackFailure(message);
              setRouteReconnecting(false);
              return;
            }
            const routeRecoveryEpoch = routeRecoveryEpochRef.current.capture();
            const routeRefresh = requestServerRouteRefresh({reason: 'route-failure'});
            // AVPlayer fetches the media URL outside Core's JS transport. A
            // native source failure therefore explicitly disposes the route.
            // Keep the current position and recover silently while buffered
            // media can continue; only surface a terminal failure after route
            // refresh and grant renewal options have both been exhausted.
            setRouteReconnecting(true);
            void routeRefresh
              .then(async () => {
                // A successful route check can legitimately retain the same
                // public URL, in which case no route-change event is emitted.
                // The native source still failed, so renew its media grant and
                // rebase the exact URL separately unless a changed-route
                // replacement is already taking over.
                if (
                  routeRecoveryInFlightRef.current ||
                  !routeRecoveryEpochRef.current.accepts(routeRecoveryEpoch)
                )
                  return;
                if (
                  shouldAttemptNativePlaybackRecovery(
                    nativeRecoveryAttemptRef.current,
                  )
                ) {
                  nativeRecoveryAttemptRef.current += 1;
                  await renewGrantWithRetry();
                  return;
                }
                playbackFailureKindRef.current = 'native';
                setPlaybackFailure(productBody('playback.failed'));
                setRouteReconnecting(false);
              })
              .catch(async () => {
                if (
                  !routeRecoveryEpochRef.current.accepts(routeRecoveryEpoch) ||
                  shutdownRequestedRef.current
                )
                  return;
                if (
                  shouldAttemptNativePlaybackRecovery(
                    nativeRecoveryAttemptRef.current,
                  )
                ) {
                  nativeRecoveryAttemptRef.current += 1;
                  await renewGrantWithRetry();
                  return;
                }
                playbackFailureKindRef.current = 'native';
                setPlaybackFailure(productBody('playback.failed'));
                setRouteReconnecting(false);
              });
          }}
          onInterruption={event => {
            if (event.phase === 'ended' && event.shouldResume && !event.recovered) {
              playbackFailureKindRef.current = 'native';
              setPlaybackFailure(
                productBody('playback.interruption-resume-failed'),
              );
            }
          }}
          onPictureInPictureChange={event => {
            if (event.state === 'starting' || event.state === 'active') setPanel(null);
            if (event.state === 'restore-requested' && event.requestId) {
              const requestId = event.requestId;
              requestAnimationFrame(() => playerRef.current?.completePictureInPictureRestore(
                requestId,
                AppState.currentState === 'active',
              ));
            }
            if (event.state === 'restore-required') {
              playbackFailureKindRef.current = 'native';
              setPlaybackFailure(productBody('playback.failed'));
            }
          }}
          onRemoteCommand={command => {
            if (watchAuthority.remoteControlPolicy !== 'host') return;
            const action =
              command.action === 'toggle'
                ? progressRef.current.isPlaying
                  ? 'pause'
                  : 'play'
                : command.action;
            void publishWatchGroupState(
              action,
              command.positionSeconds ?? progressRef.current.positionSeconds,
            );
          }}
          onProgress={reportProgress}
          onStateChange={changeNativeState}
          ref={playerRef}
          sourceURL={sourceWithMediaGrant(playback.sourceUrl, playback.mediaGrant.token)}
          startPositionSeconds={
            progress.positionSeconds || playback.resumePositionSeconds || 0
          }
          style={StyleSheet.absoluteFill}
          watchWithFriendsControlPolicy={
            watchAuthority.remoteControlPolicy
          }
        />
      ) : (
        <View
          accessibilityLabel={productText('playback.casting-to', {
            device:
              castState.deviceName ||
              productText('playback.cast-device-default'),
          })}
          style={StyleSheet.absoluteFill}
        />
      )}
      {chromeVisible ? <View pointerEvents="none" style={styles.playerScrim} /> : null}
      {routeReconnecting && !playbackFailure ? (
        <View pointerEvents="auto" style={styles.playerReconnectStatus}>
          <ActivityIndicator color={color.screenBlueStrong} size="small" />
          <View style={styles.playerReconnectCopy}>
            <Text style={styles.playerReconnectTitle}>
              {productTitle('playback.reconnecting')}
            </Text>
            <Text style={styles.playerReconnectBody}>
              {productBody('playback.reconnecting')}
            </Text>
          </View>
          <ControlButton
            compact
            icon="action.cancel"
            label={productText('action.cancel')}
            onPress={leaveGroupAndBack}
            platform={platform}
          />
        </View>
      ) : null}
      {!television && !audioOnly ? (
        <MobileVideoUtilityHeader onCollapse={() => {
          setPanel(null);
          collapsePlayer();
        }} />
      ) : null}
      {chromeVisible && (television || !audioOnly) ? <View
        style={[
          styles.playerIdentity,
          television ? styles.playerIdentityTv : {top: insets.top + 78},
        ]}
      >
        <Text
          style={television ? styles.playerTitleTv : styles.playerTitleMobile}
        >
          {item.title}
        </Text>
        <Text
          style={television ? styles.playerMetaTv : styles.playerMetaMobile}
        >
          {[
            item.parentTitle
              ? `${item.parentTitle}  ·  ${item.subtitle ?? ''}  ·  ${item.duration ?? ''}`
              : (item.subtitle ??
                [item.year, item.duration].filter(Boolean).join('  ·  ')),
            castActive
              ? productText('playback.casting-to', {
                  device:
                    castState.deviceName ||
                    productText('playback.cast-device-default'),
                })
              : undefined,
          ]
            .filter(Boolean)
            .join('\n')}
        </Text>
      </View> : null}
      {watchWithFriendsGroupId ? (
        <View
          style={[
            styles.watchGroupBanner,
            television && styles.watchGroupBannerTv,
          ]}>
          <PorticoIcon color={color.screenBlueStrong} id="account.watch-together" size={television ? 24 : 18} />
          <View style={styles.watchGroupCopy}>
            <Text
              style={television ? styles.watchGroupTitleTv : styles.watchGroupTitleMobile}>
              {watchGroup?.name ?? productText('watch-with-friends.title')}
            </Text>
            <Text
              style={television ? styles.watchGroupMetaTv : styles.watchGroupMetaMobile}>
              {watchGroupError ?? (watchGroupStatus === 'reconnecting'
                ? productTitle('watch-with-friends.reconnecting')
                : watchGroupStatus === 'unavailable'
                  ? productTitle('watch-with-friends.unavailable')
                  : `${productText('watch-with-friends.connected-count', {
                      count: watchGroup?.members.length ?? 0,
                    })} · ${
                      watchGroup?.permissions.isHost
                        ? productText('watch-with-friends.role-host')
                        : watchGroup?.permissions.canControl
                          ? productText('watch-with-friends.role-shared')
                          : productText('watch-with-friends.role-participant')
                    }`)}
            </Text>
          </View>
          <ControlButton
            compact
            disabled={controlBusy}
            label={productText('action.leave-group')}
            onPress={leaveGroupAndBack}
            platform={platform}
          />
        </View>
      ) : null}
      {nativeState === 'buffering' || nativeState === 'loading' ? (
        <View pointerEvents="none" style={styles.buffering}>
          <ActivityIndicator color={color.silver} size="large" />
          <Text
            style={
              television ? styles.bufferingTextTv : styles.bufferingTextMobile
            }
          >
            {productTitle('playback.buffering')}
          </Text>
        </View>
      ) : (
        <View style={styles.playerSpacer} />
      )}
      {ended ? (
        <View style={[styles.playerEnded, television && styles.playerEndedTv]}>
          <Text
            style={
              television
                ? styles.playerEndedTitleTv
                : styles.playerEndedTitleMobile
            }
          >
            {postPlay.phase === 'passout'
              ? productTitle('playback.still-watching')
              : postPlay.phase === 'preparing'
                ? productTitle('playback.preparing')
                : postPlay.phase === 'countdown'
                  ? productTitle('playback.up-next')
                  : postPlay.phase === 'failed'
                    ? productTitle('playback.up-next-failed')
                    : postPlay.phase === 'cancelled'
                      ? productTitle('playback.autoplay-cancelled')
                      : watchGroup && !watchGroup.permissions.canControl
                        ? productText('watch-with-friends.waiting-host')
                        : productTitle('playback.complete')}
          </Text>
          {postPlay.phase !== 'inactive' ? (
            <>
              <Text
                style={
                  television
                    ? styles.playerEndedMessageTv
                    : styles.playerEndedMessageMobile
                }
              >
                {postPlay.phase === 'countdown'
                  ? `${postPlay.prepared.playback.media.title}\n${
                      launchPreferences.autoplayNext &&
                      launchPreferences.upNextCountdownSeconds > 0
                        ? productBody(
                            postPlayRemaining === 1
                              ? 'playback.up-next-countdown-one'
                              : 'playback.up-next-countdown-many',
                            {seconds: postPlayRemaining},
                          )
                        : productBody('playback.up-next-ready')
                    }`
                  : `${'nextTitle' in postPlay ? postPlay.nextTitle : ''}${
                      postPlay.phase === 'failed'
                        ? `\n${postPlay.message}`
                        : postPlay.phase === 'passout'
                          ? `\n${productBody('playback.still-watching')}`
                          : ''
                    }`}
              </Text>
              <View style={styles.postPlayActions}>
                {postPlay.phase === 'passout' ? (
                  <>
                    <ControlButton
                      icon="playback.play"
                      label={productText('action.still-watching')}
                      onPress={confirmStillWatching}
                      platform={platform}
                      primary
                    />
                    <ControlButton
                      label={productText('action.stop-autoplay')}
                      onPress={cancelPostPlay}
                      platform={platform}
                    />
                  </>
                ) : postPlay.phase === 'preparing' ? (
                  <ControlButton
                    label={productText('action.cancel')}
                    onPress={cancelPostPlay}
                    platform={platform}
                  />
                ) : (
                  <>
                    <ControlButton
                      icon="playback.next"
                      label={productText(
                        postPlay.phase === 'countdown'
                          ? 'action.play-now'
                          : postPlay.phase === 'failed'
                            ? 'action.retry'
                            : 'action.play-next',
                      )}
                      onPress={() => {
                        if (postPlay.phase === 'failed') {
                          const current = playbackRef.current;
                          if (current) void preparePostPlay(current);
                        } else {
                          void playNext();
                        }
                      }}
                      platform={platform}
                      primary
                    />
                    <ControlButton
                      icon="playback.replay"
                      label={productText('action.replay')}
                      onPress={replayCurrent}
                      platform={platform}
                    />
                    {postPlay.phase === 'countdown' ? (
                      <ControlButton
                        label={productText('action.cancel')}
                        onPress={cancelPostPlay}
                        platform={platform}
                      />
                    ) : null}
                  </>
                )}
              </View>
            </>
          ) : !watchGroup || watchGroup.permissions.canControl ? (
            <ControlButton
              icon="playback.replay"
              label={productText('action.replay')}
              onPress={() => {
                if (watchGroup) {
                  setEnded(false);
                  void publishWatchGroupState('seek', 0).then(ok => {
                    if (!ok) return;
                    void publishWatchGroupState('play', 0).then(played => {
                      void played;
                    });
                  });
                } else {
                  replayCurrent();
                }
              }}
              platform={platform}
              primary
            />
          ) : null}
        </View>
      ) : null}
      {!ended && !playbackFailure ? (
        <PlaybackSegmentAutomation
          canControl={canSeek}
          isLive={effectiveLive}
          onSeek={seekTo}
          platform={platform}
          positionSeconds={progress.positionSeconds}
          preferences={{credits: launchPreferences.creditsSkip, intro: launchPreferences.introSkip}}
          segments={playback.media.segments}
          sessionId={playback.sessionId}
        />
      ) : null}
      {chromeVisible && audioOnly && !television ? <MobileAudioPresenter
        artwork={item.poster}
        canNext={watchControlAllowed && (watchGroup ? groupUpcomingQueue.length : playback.queue.length) > 0}
        canPrevious={!watchGroup && playbackHistoryRef.current.canPrevious}
        canSeek={canSeek}
        expanded={mobileAudioExpanded}
        isPlaying={nativeState === 'playing'}
        onExpand={() => setMobileAudioExpanded(value => !value)}
        onNext={() => watchGroup ? void publishWatchGroupState('next') : void playNext()}
        onPlayPause={togglePlayback}
        onPrevious={() => void playPrevious()}
        onSeekBack={() => seekBy(-preferences.seekIntervalSeconds)}
        onSeekForward={() => seekBy(preferences.seekIntervalSeconds)}
        subtitle={playback.media.grandparentTitle ?? playback.media.parentTitle}
        title={playback.media.title}
      /> : null}
      {chromeVisible && (television || !audioOnly) ? <View style={[styles.playerBottom, television ? styles.playerBottomTv : playerBottomSafeArea]}>
        <View style={styles.playerTimes}>
          <Text
            style={television ? styles.playerTimeTv : styles.playerTimeMobile}
          >
            {formatPlayerTime(progress.positionSeconds)}
          </Text>
          <Text
            style={television ? styles.playerTimeTv : styles.playerTimeMobile}
          >
            {effectiveLive
              ? productText('playback.live').toUpperCase()
              : formatPlayerTime(duration)}
          </Text>
        </View>
        {trickplaySet && trickplayTileIndex !== undefined ? (
          <View style={styles.trickplayPreview} pointerEvents="none">
            <Image
              resizeMode="cover"
              source={{
                headers: {
                  Authorization: `PorticoMedia ${playback.mediaGrant.token}`,
                },
                uri: client.mediaTrickplayTileUrl(
                  playback.media.id,
                  trickplaySet.id,
                  trickplayTileIndex,
                ),
              }}
              style={styles.trickplayImage}
            />
            <Text style={styles.trickplayTime}>
              {formatPlayerTime(seekPreviewSeconds ?? 0)}
            </Text>
          </View>
        ) : null}
        <TVLogicalFocusContainerBoundary container={tvPlayerFocusContainers[0]!}>
        <Focusable
          accessibilityActions={
            !canSeek
              ? undefined
              : [
                  {
                    name: 'increment',
                    label: productText('action.forward-seconds', {
                      seconds: preferences.seekIntervalSeconds,
                    }),
                  },
                  {
                    name: 'decrement',
                    label: productText('action.rewind-seconds', {
                      seconds: preferences.seekIntervalSeconds,
                    }),
                  },
                ]
          }
          accessibilityLabel={productText('playback.position')}
          accessibilityRole="adjustable"
          accessibilityValue={{
            max: Math.max(1, Math.round(duration)),
            min: 0,
            now: Math.round(progress.positionSeconds),
            text: effectiveLive
              ? productText('playback.live')
              : productText('playback.position-of', {
                  duration: formatPlayerTime(duration),
                  position: formatPlayerTime(progress.positionSeconds),
                }),
          }}
          accessible
          focusable={canSeek}
          platform={platform}
          onAccessibilityAction={event =>
            event.nativeEvent.actionName === 'increment'
              ? seekBy(preferences.seekIntervalSeconds)
              : event.nativeEvent.actionName === 'decrement'
                ? seekBy(-preferences.seekIntervalSeconds)
                : undefined
          }
          onLayout={event => {
            progressWidthRef.current = event.nativeEvent.layout.width;
          }}
          onBlur={() => { progressFocusedRef.current = false; }}
          onFocus={() => { progressFocusedRef.current = true; }}
          onPress={
            !canSeek
              ? undefined
              : television
                ? () => seekBy(preferences.seekIntervalSeconds)
                : event => seekFromTimeline(event.nativeEvent.locationX)
          }
          onPressIn={event => {
            const width = progressWidthRef.current;
            if (trickplaySet && width > 0 && duration > 0) {
              setSeekPreviewSeconds(
                Math.max(
                  0,
                  Math.min(duration, (event.nativeEvent.locationX / width) * duration),
                ),
              );
            }
          }}
          onPressOut={() => setSeekPreviewSeconds(undefined)}
          style={[
            styles.playerProgressTouch,
            television && styles.playerProgressTouchTv,
          ]}
          testID={TV_PLAYER_FOCUS.timeline}
          tvFocusBoundaryDirections={television ? ['down'] : undefined}
          tvFocusId={television ? TV_PLAYER_FOCUS_ENTRY.timeline : undefined}
          tvFocusOrder={0}
        >
          <View
            style={[
              styles.playerProgress,
              television && styles.playerProgressTv,
            ]}
          >
            <View
              style={[
                styles.playerProgressValue,
                {width: `${progressPercent}%`},
              ]}
            />
          </View>
        </Focusable>
        </TVLogicalFocusContainerBoundary>
        <FiveControlTransport
          canNext={watchControlAllowed && (watchGroup ? groupUpcomingQueue.length : playback.queue.length) > 0}
          canPlayPause={canTogglePlayback}
          canPrevious={!watchGroup && playbackHistoryRef.current.canPrevious}
          canSeek={canSeek}
          isPlaying={nativeState === 'playing'}
          onNext={() => watchGroup ? void publishWatchGroupState('next') : void playNext()}
          onPlayPause={togglePlayback}
          onPrevious={() => void playPrevious()}
          onSeekBack={() => seekBy(-preferences.seekIntervalSeconds)}
          onSeekForward={() => seekBy(preferences.seekIntervalSeconds)}
          platform={platform}
          focusContainer={television ? tvPlayerFocusContainers[1] : undefined}
        />
      </View> : null}
      {television && restoreUtilityFocusId ? <TVPlayerFocusRestorer
        focusId={`player:utility:${restoreUtilityFocusId}`}
        onRestored={() => setRestoreUtilityFocusId(undefined)}
      /> : null}
      {chromeVisible ? <PlayerUtilityDock
        allowChapterSeeking={canSeek}
        allowPlaybackRate={!effectiveLive && watchControlAllowed}
        allowStreamSelection={!castActive && !effectiveLive && !dvr}
        hasLyrics={Boolean(playback.media.lyrics?.some(lyric => lyric.text))}
        focusContainer={television ? tvPlayerFocusContainers[2] : undefined}
        onPictureInPicture={() => playerRef.current?.startPictureInPicture()}
        onRepeat={() => void cycleRepeatMode()}
        onShuffle={() => void shuffleQueue()}
        onPanelToggle={id => {
          if (panel === id) {
            setPanel(null);
            setRestoreUtilityFocusId(id);
            return;
          }
          panelInvokerRef.current = id;
          setRestoreUtilityFocusId(undefined);
          setPanel(id);
        }}
        panel={panel}
        playback={playback}
        queueCount={
          watchGroup ? groupUpcomingQueue.length : playback.queue.length
        }
        platform={platform}
        repeatMode={playback.repeatMode}
        showPictureInPicture={Boolean(
          !television &&
            playerCapabilities?.pictureInPictureEligible &&
            playerCapabilities.pictureInPicturePossible,
        )}
        showSleepTimer={
          !watchGroup &&
          (television || playerContentMode(playback.media, effectiveLive) === 'audiobook')
        }
        showMusicQueueControls={
          !watchGroup &&
          playerContentMode(playback.media, effectiveLive) === 'music'
        }
      /> : null}
      {panel ? (
        <PlayerUtilityPanel
          allowChapterSeeking={canSeek}
          allowPlaybackRate={!effectiveLive && watchControlAllowed}
          allowStreamSelection={!castActive && !effectiveLive && !dvr}
          busy={controlBusy}
          focusContainer={television ? tvPlayerFocusContainers[3] : undefined}
          lyrics={playerLyricsRows(
            playback.media.lyrics?.find(lyric => lyric.text)?.text,
            progress.positionSeconds,
          )}
          onChapter={seekTo}
          onQueueItem={index =>
            watchGroup
              ? void playWatchGroupQueueItem(index)
              : void playNext(index)
          }
          onQuality={selectQuality}
          onSelectAudio={audioStreamId =>
            void restartSelection({audioStreamId})
          }
          onSelectSubtitle={selectSubtitle}
          onPlaybackRate={rate => {
            const apply = () => {
              setPlaybackRate(rate);
              playerRef.current?.setPlaybackRate(rate);
            };
            if (watchGroup) {
              void publishWatchGroupState(
                nativeState === 'playing' ? 'play' : 'pause',
                progress.positionSeconds,
                rate,
              );
            } else {
              apply();
            }
          }}
          onVolume={volume => {
            setPlayerVolume(volume);
            playerRef.current?.setVolume(volume);
          }}
          onSleepTimer={mode => setSleepTimer(portableSleepTimer(mode))}
          panel={panel}
          playback={playback}
          queueItems={
            watchGroup
              ? groupUpcomingQueue.map(item => ({
                  id: item.mediaId,
                  title: item.mediaTitle,
                }))
              : playback.queue.map(item => ({id: item.id, title: item.title}))
          }
          queueSelectionAllowed={index =>
            watchControlAllowed &&
            (!watchGroup ||
              index === 0 ||
              watchGroup.permissions.canManageQueue)
          }
          playbackRate={playbackRate}
          platform={platform}
          sleepTimer={sleepTimer}
          volume={playerVolume}
        />
      ) : null}
      {playbackFailure ? (
        <PlaybackFailureSurface
          activePlayback
          message={playbackFailure}
          onBack={leaveGroupAndBack}
          onRetry={() => {
            nativeRecoveryAttemptRef.current = 0;
            setPlaybackFailure(undefined);
            const desiredTarget: NativePlaybackTarget = castActive
              ? 'google-cast'
              : 'apple';
            if (
              playbackFailureKindRef.current === 'target' ||
              playbackTargetRef.current !== desiredTarget
            ) {
              blockedPlaybackTargetRef.current = undefined;
              setTargetSwitchRevision(value => value + 1);
            } else if (playbackFailureKindRef.current === 'cast-load') {
              castLoadedSourceRef.current = undefined;
              castExpectedSourceRef.current = undefined;
              castHasLoadedRef.current = false;
              castReceiverOwnedRef.current = false;
              playbackTargetRef.current = 'apple';
              setPlaybackTarget('apple');
              setTargetSwitchRevision(value => value + 1);
            } else {
              void renewGrant(true);
            }
          }}
          platform={platform}
        />
      ) : null}
    </View>
  );
}

function PlaybackSegmentAutomation({
  canControl,
  isLive,
  onSeek,
  platform,
  positionSeconds,
  preferences,
  segments,
  sessionId,
}: {
  canControl: boolean;
  isLive: boolean;
  onSeek(positionSeconds: number): void;
  platform: PrototypePlatform;
  positionSeconds: number;
  preferences: {credits: 'ask' | 'automatic' | 'off'; intro: 'ask' | 'automatic' | 'off'};
  segments?: MediaSegment[];
  sessionId: string;
}) {
  const television = platform === 'tv';
  const [dismissed, setDismissed] = useState<string[]>([]);
  useEffect(() => setDismissed([]), [sessionId]);
  const decision = playbackSegmentAutomationDecision(
    segments,
    positionSeconds,
    dismissed,
    preferences,
    isLive,
  );
  useEffect(() => {
    if (!canControl || decision.type !== 'seek') return;
    setDismissed(current => current.includes(decision.segment.id) ? current : [...current, decision.segment.id]);
    onSeek(decision.positionSeconds);
  }, [canControl, decision, onSeek]);
  if (!canControl || decision.type !== 'prompt') return null;
  const segment = segmentLabel(decision.segment.type).toLowerCase();
  const dismiss = () => setDismissed(current => current.includes(decision.segment.id) ? current : [...current, decision.segment.id]);
  return (
    <View style={[styles.segmentPrompt, television && styles.segmentPromptTv]}>
      <ControlButton
        compact
        icon="playback.next"
        label={productText('action.skip-segment', {segment})}
        onPress={() => {
          dismiss();
          onSeek(decision.segment.endSeconds);
        }}
        platform={platform}
        primary
      />
      <IconButton
        icon="action.dismiss"
        label={productText('action.dismiss-skip-prompt', {segment})}
        onPress={dismiss}
        platform={platform}
      />
    </View>
  );
}

function PlaybackFailureSurface({
  activePlayback = false,
  message,
  onBack,
  onRetry,
  platform,
  title = productTitle('playback.failed'),
}: {
  activePlayback?: boolean;
  message: string;
  onBack(): void;
  onRetry(): void;
  platform: PrototypePlatform;
  title?: string;
}) {
  const television = platform === 'tv';
  return (
    <View
      style={[
        styles.playerFailure,
        activePlayback && styles.playerFailureOverlay,
      ]}
    >
      {activePlayback ? (
        <View pointerEvents="none" style={styles.playerUnavailableScrim} />
      ) : null}
      <View
        style={[
          styles.playerUnavailable,
          television && styles.playerUnavailableTv,
        ]}
      >
        <Text
          style={
            television
              ? styles.playerUnavailableTitleTv
              : styles.playerUnavailableTitleMobile
          }
        >
          {title}
        </Text>
        <Text
          style={
            television
              ? styles.playerUnavailableBodyTv
              : styles.playerUnavailableBodyMobile
          }
        >
          {message}
        </Text>
        <View
          style={[styles.failureActions, television && styles.failureActionsTv]}
        >
          <ControlButton
            icon="action.retry"
            label={productText('action.retry')}
            onPress={onRetry}
            platform={platform}
            primary
            requestInitialTVFocus
          />
          <ControlButton
            icon="navigation.back"
            label={productText('action.back-to-details')}
            onPress={onBack}
            platform={platform}
          />
        </View>
      </View>
    </View>
  );
}

function playbackDelay(milliseconds: number, signal: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal.aborted) {
      reject(abortSignalReason(signal));
      return;
    }
    const timer = setTimeout(resolve, milliseconds);
    signal.addEventListener(
      'abort',
      () => {
        clearTimeout(timer);
        reject(abortSignalReason(signal));
      },
      {once: true},
    );
  });
}

function abortSignalReason(signal: AbortSignal): unknown {
  return (signal as AbortSignal & {reason?: unknown}).reason ?? new Error('The playback operation was cancelled.');
}

function watchWithFriendsIdempotencyKey(action: string): string {
  return `rn-${action}-${Date.now().toString(36)}-${Math.random()
    .toString(36)
    .slice(2, 10)}`;
}

function playerLyricsRows(
  lyrics: string | undefined,
  positionSeconds: number,
): ReadonlyArray<{active: boolean; text: string}> | undefined {
  if (!lyrics?.trim()) return undefined;
  const timed = lyrics
    .split(/\r?\n/)
    .flatMap(line => {
      const match = line.match(/^\[(\d+):(\d+(?:\.\d+)?)\](.*)$/);
      if (!match) return [];
      return [
        {
          at: Number(match[1] ?? 0) * 60 + Number(match[2] ?? 0),
          text: (match[3] ?? '').trim(),
        },
      ];
    })
    .filter(line => line.text);
  if (!timed.length) {
    return lyrics.split(/\r?\n/).map(text => text.trim()).filter(Boolean).map(text => ({active: false, text}));
  }
  let active = 0;
  for (let index = 0; index < timed.length; index += 1) {
    if (timed[index]!.at <= positionSeconds) active = index;
    else break;
  }
  return timed
    .slice(Math.max(0, active - 2), Math.min(timed.length, active + 4))
    .map((line, index) => {
      const absoluteIndex = Math.max(0, active - 2) + index;
      return {active: absoluteIndex === active, text: line.text};
    });
}
