import React, {forwardRef, useCallback, useImperativeHandle, useRef} from 'react';
import {
  findNodeHandle,
  NativeEventEmitter,
  NativeModules,
  Platform,
  requireNativeComponent,
  type NativeSyntheticEvent,
  type StyleProp,
  type ViewStyle,
} from 'react-native';
import {applePlaybackPolicyFor, type ApplePlaybackPolicy} from './applePlaybackPolicy';
import type {PlayerContentMode} from '@porticomediaserver/client-core';
import {createCancellablePublisher} from './cancellablePublisher';
import type {ApplePlaybackDescriptor} from './applePlaybackContinuity';
export {applePlaybackPolicyFor} from './applePlaybackPolicy';
export type {ApplePlaybackPlatform, ApplePlaybackPolicy} from './applePlaybackPolicy';
export {
  acknowledgeHeartbeat,
  canCommitPreparedHandoff,
  classifyApplePlaybackError,
  descriptorTransition,
  heartbeatDue,
  isAllowedPlaybackURL,
  rangeForCurrentOffset,
  rewriteApprovedHLSPlaylist,
  sliceFromCurrentOffset,
  validateApplePlaybackDescriptor,
} from './applePlaybackContinuity';
export type {
  AppleHeartbeatState,
  ApplePlaybackContinuationCredential,
  ApplePlaybackDescriptor,
  ApplePlaybackErrorLike,
  ApplePlaybackRoutePolicy,
} from './applePlaybackContinuity';
export {
  ANDROID_PLAYBACK_CAPABILITY_CONTRACT_VERSION,
  AndroidCleanupQuarantineError,
  AndroidPlaybackUnavailableError,
  androidClientDescriptor,
  androidPlaybackCapabilitiesFor,
  androidPlaybackClientProfile,
  beginAndroidCleanupQuarantine,
  completeAndroidCleanupQuarantine,
  getAndroidCleanupQuarantineState,
  getAndroidRuntimeState,
  parseAndroidCleanupState,
  parseAndroidRuntimeState,
  probeAndroidPlaybackClientProfile,
  probeAndroidRuntimeState,
  releaseAndroidCleanupQuarantine,
} from './androidRuntime';
export {
  createPlayerSessionController,
  playerLifecycleDecision,
  PlayerSessionController,
} from './sessionController';
export type {
  PlayerLifecycleDecision,
  PlayerLifecycleEvent,
  PlayerMediaFamily,
  PlayerPlatform,
  PlayerPresentation,
  PlayerSessionCommands,
  PlayerSessionSnapshot,
} from './sessionController';
export type {
  AndroidCleanupQuarantineState,
  AndroidClientDescriptor,
  AndroidFormFactor,
  AndroidNativePlatform,
  AndroidPlaybackCapabilities,
  AndroidRuntimeCapabilities,
  AndroidRuntimeError,
  AndroidRuntimeFamily,
  AndroidRuntimeIdentity,
  AndroidRuntimeState,
  AndroidRuntimeStatus,
} from './androidRuntime';

export type ApplePlaybackState = 'loading' | 'buffering' | 'playing' | 'paused';

export type AndroidPlaybackSourceKind = 'direct' | 'hls' | 'local' | 'unavailable';
export type AndroidPlaybackTimelineType = 'vod' | 'live' | 'dvr';

export interface AndroidPlaybackSeekableWindow {
  seekable: boolean;
  seekableStartSeconds: number;
  seekableEndSeconds: number;
}

export interface AndroidPlaybackTrack {
  id: string;
  type: 'audio' | 'text';
  language: string;
  label: string;
  sampleMimeType: string;
  codecs: string;
  roleFlags: number;
  selectionFlags: number;
  supported: boolean;
  selected: boolean;
  bitrate?: number;
  channelCount?: number;
}

export interface AndroidPlaybackTracksEvent extends AndroidPlaybackSeekableWindow {
  generation: number;
  sourceKind: AndroidPlaybackSourceKind;
  timelineType: AndroidPlaybackTimelineType;
  isLive: boolean;
  isDvr: boolean;
  tracks: AndroidPlaybackTrack[];
  audioTracks: AndroidPlaybackTrack[];
  textTracks: AndroidPlaybackTrack[];
  selectedAudioTrackId?: string | null;
  selectedTextTrackId?: string | null;
}

export interface AndroidPlaybackStateEvent extends AndroidPlaybackSeekableWindow {
  state: ApplePlaybackState | 'error' | 'unavailable';
  generation: number;
  sourceKind: AndroidPlaybackSourceKind;
  timelineType: AndroidPlaybackTimelineType;
  isLive: boolean;
  isDvr: boolean;
  liveOffsetSeconds: number;
}

export interface ApplePlaybackProgress {
  positionSeconds: number;
  durationSeconds: number;
  bufferedPositionSeconds?: number;
  isPlaying: boolean;
  generation?: number;
  sourceKind?: AndroidPlaybackSourceKind;
  timelineType?: AndroidPlaybackTimelineType;
  isLive?: boolean;
  isDvr?: boolean;
  liveOffsetSeconds?: number;
  seekable?: boolean;
  seekableStartSeconds?: number;
  seekableEndSeconds?: number;
}

export interface ApplePlayerHandle {
  play(): void;
  pause(): void;
  seekTo(seconds: number): void;
  setPlaybackRate(rate: number): void;
  setVolume(volume: number): void;
  setSleepTimerDeadline(deadlineAt?: number): void;
  startPictureInPicture(): void;
  stopPictureInPicture(): void;
  completePictureInPictureRestore(requestId: string, restored: boolean): void;
  selectAudioTrack(trackId: string): void;
  selectTextTrack(trackId?: string): void;
}

export interface ApplePlayerCapabilities extends ApplePlaybackPolicy {
  pictureInPictureActive: boolean;
  pictureInPicturePossible: boolean;
  pictureInPictureSupported: boolean;
}

export interface ApplePictureInPictureEvent {
  state: 'active' | 'failed' | 'inactive' | 'restore-requested' | 'restore-required' | 'starting' | 'stopping';
  requestId?: string;
}

export interface ApplePlaybackInterruptionEvent {
  phase: 'began' | 'ended';
  recovered: boolean;
  shouldResume: boolean;
}

export interface ApplePlaybackFailure {
  code?: number;
  domain?: string;
  category?: 'route' | 'grant' | 'decoder' | 'configuration' | 'server-product';
  kind:
    | 'audio-session'
    | 'playback'
    | 'configuration'
    | 'grant-renewal'
    | 'source-renewal'
    | 'stale-generation'
    | 'local-unavailable'
    | 'track-selection';
  message: string;
  availability?: 'available' | 'unavailable' | 'error';
  nativeState?: 'loading' | 'buffering' | 'playing' | 'paused' | 'error' | 'unavailable';
  generation?: number;
  httpStatus?: number;
  renewalRequired?: boolean;
  renewalKind?: 'grant' | 'source';
}

export type AppleWatchWithFriendsControlPolicy =
  | 'independent'
  | 'host'
  | 'participant';

export interface AppleRemotePlaybackCommand {
  action: 'pause' | 'play' | 'seek' | 'toggle';
  positionSeconds?: number;
}

interface NativePlayerProps {
  sourceURL: string;
  authorization?: string;
  playbackDescriptor?: ApplePlaybackDescriptor;
  autoplay: boolean;
  allowsCellularAccess: boolean;
  allowsPictureInPicture: boolean;
  isLive: boolean;
  contentMode: PlayerContentMode | '';
  metadataSubtitle: string;
  metadataTitle: string;
  watchWithFriendsControlPolicy: AppleWatchWithFriendsControlPolicy;
  seekIntervalSeconds: number;
  startPositionSeconds: number;
  playbackGeneration: number;
  style?: StyleProp<ViewStyle>;
  onPlaybackState?(event: NativeSyntheticEvent<AndroidPlaybackStateEvent>): void;
  onPlaybackProgress?(event: NativeSyntheticEvent<ApplePlaybackProgress>): void;
  onPlaybackError?(event: NativeSyntheticEvent<ApplePlaybackFailure>): void;
  onPlaybackEnd?(event: NativeSyntheticEvent<Record<string, never>>): void;
  onPlaybackCapabilities?(event: NativeSyntheticEvent<ApplePlayerCapabilities>): void;
  onPlaybackTracks?(event: NativeSyntheticEvent<AndroidPlaybackTracksEvent>): void;
  onPictureInPictureChange?(event: NativeSyntheticEvent<ApplePictureInPictureEvent>): void;
  onPlaybackInterruption?(event: NativeSyntheticEvent<ApplePlaybackInterruptionEvent>): void;
  onRemotePlaybackCommand?(event: NativeSyntheticEvent<AppleRemotePlaybackCommand>): void;
}

const NativeApplePlayer = requireNativeComponent<NativePlayerProps>('PorticoPlayerView');
const NativeAirPlayRoutePicker = requireNativeComponent<{style?: StyleProp<ViewStyle>}>(
  'PorticoAirPlayRoutePicker',
);
const NativeGoogleCastButton = requireNativeComponent<{style?: StyleProp<ViewStyle>}>('PorticoGoogleCastButton');
const nativeCommands = NativeModules.PorticoPlayerView as {
  play(tag: number): void;
  pause(tag: number): void;
  seekTo(tag: number, seconds: number): void;
  setPlaybackRate(tag: number, rate: number): void;
  setVolume(tag: number, volume: number): void;
  setSleepTimerDeadline(tag: number, deadlineMilliseconds: number): void;
  startPictureInPicture(tag: number): void;
  stopPictureInPicture(tag: number): void;
  completePictureInPictureRestore(tag: number, requestId: string, restored: boolean): void;
  playAtGeneration?(tag: number, generation: number): void;
  pauseAtGeneration?(tag: number, generation: number): void;
  seekToAtGeneration?(tag: number, seconds: number, generation: number): void;
  setPlaybackRateAtGeneration?(tag: number, rate: number, generation: number): void;
  setVolumeAtGeneration?(tag: number, volume: number, generation: number): void;
  setSleepTimerDeadlineAtGeneration?(tag: number, deadlineMilliseconds: number, generation: number): void;
  startPictureInPictureAtGeneration?(tag: number, generation: number): void;
  stopPictureInPictureAtGeneration?(tag: number, generation: number): void;
  completePictureInPictureRestoreAtGeneration?(
    tag: number,
    requestId: string,
    restored: boolean,
    generation: number,
  ): void;
  selectAudioTrack?(tag: number, trackId: string, generation: number): void;
  selectTextTrack?(tag: number, trackId: string, generation: number): void;
} | undefined;

export type GoogleCastPlayerState = 'idle' | 'loading' | 'buffering' | 'playing' | 'paused';

export interface GoogleCastState {
  configured: boolean;
  castSessionId?: string;
  receiverId?: string;
  connected: boolean;
  recovering: boolean;
  deviceName: string;
  playerState: GoogleCastPlayerState;
  positionSeconds: number;
  durationSeconds: number;
  isLive: boolean;
  canPause: boolean;
  canSeek: boolean;
  contentURL: string;
  idleReason: 'none' | 'finished' | 'cancelled' | 'interrupted' | 'error';
  receiverReady?: {
    version: 'v1';
    castSessionId?: string;
    receiverId?: string;
    receiverPublicKey: string;
    receiverChallenge: string;
    nonce?: string;
    /** Present when a still-active receiver-owned playback survives sender reconnection. */
    receiverSessionId?: string;
    generation?: number;
  };
  receiverSessionReady?: {version: 'v1'; castSessionId?: string; receiverSessionId: string; generation: number};
}

export interface GoogleCastLoadRequest {
  sourceURL: string;
  /** Encrypted receiver-bound bootstrap envelope and non-secret binding IDs. */
  customData: Record<string, unknown>;
  title: string;
  subtitle?: string;
  posterURL?: string;
  contentType?: string;
  durationSeconds?: number;
  startPositionSeconds?: number;
  isLive?: boolean;
  contentMode?: PlayerContentMode;
  metadataSubtitle?: string;
  metadataTitle?: string;
  seekIntervalSeconds?: number;
  autoplay?: boolean;
}

type NativeGoogleCastModule = {
  configured?: boolean;
  receiverId?: string;
  state(): Promise<GoogleCastState>;
  requestReceiverReady(nonce: string): Promise<GoogleCastState>;
  load(request: GoogleCastLoadRequest): Promise<GoogleCastState>;
  play(): Promise<GoogleCastState>;
  pause(): Promise<GoogleCastState>;
  seek(positionSeconds: number): Promise<GoogleCastState>;
  stop(): Promise<GoogleCastState>;
  addListener(eventName: string): void;
  removeListeners(count: number): void;
};

const nativeGoogleCast = NativeModules.PorticoGoogleCast as NativeGoogleCastModule | undefined;
const disconnectedGoogleCastState: GoogleCastState = {
  configured: false,
  castSessionId: '',
  receiverId: '',
  canPause: false,
  canSeek: false,
  connected: false,
  contentURL: '',
  recovering: false,
  deviceName: '',
  playerState: 'idle',
  positionSeconds: 0,
  durationSeconds: 0,
  isLive: false,
  idleReason: 'none',
};

export interface ApplePlayerProps {
  sourceURL: string;
  /** Ephemeral playback-scoped header; never place it in sourceURL. */
  authorization?: string;
  /** Complete immutable native setup input. Native activation waits for a new revision. */
  playbackDescriptor?: ApplePlaybackDescriptor;
  autoplay?: boolean;
  allowsCellularAccess?: boolean;
  contentMode?: PlayerContentMode;
  isLive?: boolean;
  metadataSubtitle?: string;
  metadataTitle?: string;
  seekIntervalSeconds?: number;
  startPositionSeconds?: number;
  /** Server generation used to discard a stale async resume seek. */
  playbackGeneration?: number;
  style?: StyleProp<ViewStyle>;
  onStateChange?(state: ApplePlaybackState): void;
  onStateEvent?(event: AndroidPlaybackStateEvent): void;
  onProgress?(progress: ApplePlaybackProgress): void;
  onError?(failure: ApplePlaybackFailure): void;
  onEnd?(): void;
  onCapabilitiesChange?(capabilities: ApplePlayerCapabilities): void;
  onTracksChange?(event: AndroidPlaybackTracksEvent): void;
  onPictureInPictureChange?(event: ApplePictureInPictureEvent): void;
  onInterruption?(event: ApplePlaybackInterruptionEvent): void;
  onRemoteCommand?(command: AppleRemotePlaybackCommand): void;
  watchWithFriendsControlPolicy?: AppleWatchWithFriendsControlPolicy;
}

/**
 * Apple's system-owned AirPlay route picker. Portico never enumerates or
 * impersonates AirPlay destinations; iOS owns discovery, selection, and route state.
 */
export function AirPlayRoutePicker({style}: {style?: StyleProp<ViewStyle>}) {
  if (Platform.OS !== 'ios' || Platform.isTV) return null;
  return <NativeAirPlayRoutePicker style={style} />;
}

/** Google's official Cast SDK button. The SDK owns permission, discovery, session selection, and reconnect UI. */
export function GoogleCastButton({style}: {style?: StyleProp<ViewStyle>}) {
  if (!googleCastPlaybackSupported || Platform.OS !== 'ios' || Platform.isTV) return null;
  return <NativeGoogleCastButton style={style} />;
}

/** Runtime capability: only a native Custom Receiver configuration may advertise Cast. */
export const googleCastPlaybackSupported = nativeGoogleCast?.configured === true;

export async function getGoogleCastState(): Promise<GoogleCastState> {
  if (!googleCastPlaybackSupported || !nativeGoogleCast || Platform.OS !== 'ios' || Platform.isTV) return disconnectedGoogleCastState;
  return nativeGoogleCast.state();
}

export function subscribeToGoogleCastState(listener: (state: GoogleCastState) => void): () => void {
  if (!googleCastPlaybackSupported || !nativeGoogleCast || Platform.OS !== 'ios' || Platform.isTV) {
    listener(disconnectedGoogleCastState);
    return () => undefined;
  }
  const emitter = new NativeEventEmitter(nativeGoogleCast);
  const publisher = createCancellablePublisher(listener);
  let latest = disconnectedGoogleCastState;
  const publish = (value: GoogleCastState) => {
    if (value.castSessionId && latest.castSessionId && value.castSessionId !== latest.castSessionId) {
      latest = {...disconnectedGoogleCastState, configured: value.configured, receiverId: value.receiverId, castSessionId: value.castSessionId};
    }
    latest = {...latest, ...value};
    publisher.publish(latest);
  };
  const subscription = emitter.addListener('PorticoGoogleCastStateChanged', publish);
  void nativeGoogleCast.state().then(publish).catch(() => publish(disconnectedGoogleCastState));
  return () => {
    publisher.cancel();
    subscription.remove();
  };
}

export const googleCastController = {
  requestReceiverReady: (nonce: string) => castModule().requestReceiverReady(nonce),
  async load(request: GoogleCastLoadRequest): Promise<GoogleCastState> {
    if (!isScopedGoogleCastSource(request.sourceURL)) {
      throw new Error('Google Cast requires a clean HTTPS stream URL and receiver-bound bootstrap envelope.');
    }
    if (!request.customData?.bootstrapEnvelope) throw new Error('Google Cast requires a receiver-bound bootstrap envelope.');
    return castModule().load({...request, autoplay: request.autoplay ?? true});
  },
  play: () => castModule().play(),
  pause: () => castModule().pause(),
  seek: (positionSeconds: number) => castModule().seek(Math.max(0, positionSeconds)),
  stop: () => castModule().stop(),
};

/** Prevents account credentials or an unscoped server URL from crossing the Cast boundary. */
export function isScopedGoogleCastSource(sourceURL: string): boolean {
  try {
    const parsed = new URL(sourceURL) as unknown as {
      protocol: string;
      username?: string;
      password?: string;
      hash?: string;
      search?: string;
    };
    if (parsed.protocol !== 'https:' || parsed.username || parsed.password || parsed.hash) return false;
    if (/[?&](?:media_grant|access_token|token|authorization)=/i.test(parsed.search ?? '')) return false;
    return true;
  } catch {
    return false;
  }
}

function castModule(): NativeGoogleCastModule {
  if (!googleCastPlaybackSupported || !nativeGoogleCast || Platform.OS !== 'ios' || Platform.isTV) {
    throw new Error('Google Cast is not available on this platform.');
  }
  return nativeGoogleCast;
}

/**
 * App-owned Apple playback surface. The source URL must be a server-issued,
 * playback-session-scoped media URL; account credentials are never passed to AVPlayer.
 */
export const ApplePlayer = forwardRef<ApplePlayerHandle, ApplePlayerProps>(function ApplePlayerComponent({
  allowsCellularAccess = true,
  autoplay = true,
  authorization,
  playbackDescriptor,
  isLive = false,
  contentMode,
  metadataSubtitle = '',
  metadataTitle = '',
  onEnd,
  onCapabilitiesChange,
  onInterruption,
  onRemoteCommand,
  onPictureInPictureChange,
  onError,
  onProgress,
  onStateEvent,
  onStateChange,
  onTracksChange,
  sourceURL,
  startPositionSeconds = 0,
  playbackGeneration = 0,
  seekIntervalSeconds = 15,
  style,
  watchWithFriendsControlPolicy = 'independent',
}, forwardedRef) {
  const nativeRef = useRef<React.ElementRef<typeof NativeApplePlayer>>(null);
  const policy = applePlaybackPolicyFor({isTV: Platform.isTV, os: Platform.OS}, contentMode);
  const command = useCallback((name: 'play' | 'pause', seconds?: number) => {
    const tag = findNodeHandle(nativeRef.current);
    if (!tag || !nativeCommands || (Platform.OS !== 'ios' && Platform.OS !== 'android')) return;
    if (Platform.OS === 'android') {
      if (name === 'play') nativeCommands.playAtGeneration?.(tag, playbackGeneration);
      else if (seconds === undefined) nativeCommands.pauseAtGeneration?.(tag, playbackGeneration);
      return;
    }
    if (name === 'play') nativeCommands.play(tag);
    else if (seconds === undefined) nativeCommands.pause(tag);
  }, [playbackGeneration]);
  useImperativeHandle(forwardedRef, () => ({
    play: () => command('play'),
    pause: () => command('pause'),
    seekTo: seconds => {
      const tag = findNodeHandle(nativeRef.current);
      if (tag && nativeCommands) {
        if (Platform.OS === 'android') {
          nativeCommands.seekToAtGeneration?.(tag, Math.max(0, seconds), playbackGeneration);
        } else {
          nativeCommands.seekTo(tag, Math.max(0, seconds));
        }
      }
    },
    setPlaybackRate: rate => {
      const tag = findNodeHandle(nativeRef.current);
      if (tag && nativeCommands) {
        if (Platform.OS === 'android') {
          nativeCommands.setPlaybackRateAtGeneration?.(tag, Math.max(0.5, Math.min(2, rate)), playbackGeneration);
        } else {
          nativeCommands.setPlaybackRate(tag, Math.max(0.5, Math.min(2, rate)));
        }
      }
    },
    setVolume: volume => {
      const tag = findNodeHandle(nativeRef.current);
      const normalized = Math.max(0, Math.min(1, volume));
      if (tag && nativeCommands) {
        if (Platform.OS === 'android') nativeCommands.setVolumeAtGeneration?.(tag, normalized, playbackGeneration);
        else nativeCommands.setVolume(tag, normalized);
      }
    },
    setSleepTimerDeadline: deadlineAt => {
      const tag = findNodeHandle(nativeRef.current);
      if (tag && nativeCommands) {
        if (Platform.OS === 'android') {
          nativeCommands.setSleepTimerDeadlineAtGeneration?.(tag, deadlineAt ?? 0, playbackGeneration);
        } else {
          nativeCommands.setSleepTimerDeadline(tag, deadlineAt ?? 0);
        }
      }
    },
    startPictureInPicture: () => {
      const tag = findNodeHandle(nativeRef.current);
      if (tag && nativeCommands && policy.pictureInPictureEligible) {
        if (Platform.OS === 'android') {
          nativeCommands.startPictureInPictureAtGeneration?.(tag, playbackGeneration);
        } else {
          nativeCommands.startPictureInPicture(tag);
        }
      }
    },
    stopPictureInPicture: () => {
      const tag = findNodeHandle(nativeRef.current);
      if (tag && nativeCommands && policy.pictureInPictureEligible) {
        if (Platform.OS === 'android') {
          nativeCommands.stopPictureInPictureAtGeneration?.(tag, playbackGeneration);
        } else {
          nativeCommands.stopPictureInPicture(tag);
        }
      }
    },
    completePictureInPictureRestore: (requestId, restored) => {
      const tag = findNodeHandle(nativeRef.current);
      if (tag && nativeCommands && policy.pictureInPictureEligible && requestId) {
        if (Platform.OS === 'android') {
          nativeCommands.completePictureInPictureRestoreAtGeneration?.(
            tag,
            requestId,
            restored,
            playbackGeneration,
          );
        } else {
          nativeCommands.completePictureInPictureRestore(tag, requestId, restored);
        }
      }
    },
    selectAudioTrack: trackId => {
      const tag = findNodeHandle(nativeRef.current);
      if (tag && nativeCommands && Platform.OS === 'android' && trackId.trim()) {
        nativeCommands.selectAudioTrack?.(tag, trackId, playbackGeneration);
      }
    },
    selectTextTrack: trackId => {
      const tag = findNodeHandle(nativeRef.current);
      if (tag && nativeCommands && Platform.OS === 'android') {
        nativeCommands.selectTextTrack?.(tag, trackId?.trim() ?? '', playbackGeneration);
      }
    },
  }), [command, playbackGeneration, policy.pictureInPictureEligible]);

  return (
    <NativeApplePlayer
      allowsCellularAccess={allowsCellularAccess}
      allowsPictureInPicture={policy.pictureInPictureEligible}
      authorization={authorization}
      autoplay={autoplay}
      isLive={isLive}
      contentMode={contentMode ?? ''}
      metadataSubtitle={metadataSubtitle}
      metadataTitle={metadataTitle}
      onPictureInPictureChange={event => onPictureInPictureChange?.(event.nativeEvent)}
      onPlaybackCapabilities={event => onCapabilitiesChange?.(event.nativeEvent)}
      onPlaybackEnd={() => onEnd?.()}
      onPlaybackError={event => onError?.(event.nativeEvent)}
      onPlaybackProgress={event => onProgress?.(event.nativeEvent)}
      onPlaybackState={event => {
        onStateEvent?.(event.nativeEvent);
        const state = event.nativeEvent.state;
        if (state === 'loading' || state === 'buffering' || state === 'playing' || state === 'paused') {
          onStateChange?.(state);
        }
      }}
      onPlaybackTracks={event => onTracksChange?.(event.nativeEvent)}
      onPlaybackInterruption={event => onInterruption?.(event.nativeEvent)}
      onRemotePlaybackCommand={event => onRemoteCommand?.(event.nativeEvent)}
      ref={nativeRef}
      sourceURL={sourceURL}
      seekIntervalSeconds={seekIntervalSeconds}
      startPositionSeconds={startPositionSeconds}
      playbackGeneration={playbackGeneration}
      playbackDescriptor={playbackDescriptor}
      style={style}
      watchWithFriendsControlPolicy={watchWithFriendsControlPolicy}
    />
  );
});

export function formatPlayerTime(seconds: number): string {
  if (!Number.isFinite(seconds) || seconds < 0) return '0:00';
  const whole = Math.floor(seconds);
  const hours = Math.floor(whole / 3600);
  const minutes = Math.floor((whole % 3600) / 60);
  const remainder = whole % 60;
  return hours > 0
    ? `${hours}:${String(minutes).padStart(2, '0')}:${String(remainder).padStart(2, '0')}`
    : `${minutes}:${String(remainder).padStart(2, '0')}`;
}

export function sourceWithMediaGrant(sourceURL: string, token: string): string {
  void token;
  const [beforeHash, hash = ''] = sourceURL.split('#', 2);
  const [base, query = ''] = beforeHash.split('?', 2);
  const blocked = new Set(['media_grant', 'download_grant', 'access_token']);
  const parameters = query.split('&').filter(Boolean).filter(entry => {
    try { return !blocked.has(decodeURIComponent(entry.split('=', 1)[0] ?? '')); }
    catch { return false; }
  });
  return `${base}${parameters.length ? `?${parameters.join('&')}` : ''}${hash ? `#${hash}` : ''}`;
}

export function sourceWithQueryParameter(sourceURL: string, name: string, value: string, remove: string[] = []): string {
  const [beforeHash, hash = ''] = sourceURL.split('#', 2);
  const [base, query = ''] = beforeHash.split('?', 2);
  const blocked = new Set([name, ...remove]);
  const parameters = query.split('&').filter(Boolean).filter(entry => !blocked.has(decodeURIComponent(entry.split('=', 1)[0] ?? '')));
  parameters.push(`${encodeURIComponent(name)}=${encodeURIComponent(value)}`);
  return `${base}?${parameters.join('&')}${hash ? `#${hash}` : ''}`;
}
