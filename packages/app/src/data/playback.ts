import {genericPlaybackClientProfile, type CastBootstrapResponse, type PlaybackClientProfile, type PlaybackIntent, type PlaybackResponse, type PlaybackSourceContext, type PorticoClient, type RequestSignal} from '@portico/client-core';
import {applePlaybackClientProfile, getPorticoRuntimeDescriptor, languageMatches, type AppleViewerPreferences, type PreferredLanguage} from '@portico-react-native/infrastructure';

export type RoutedPlaybackKind = 'media' | 'live' | 'dvr' | 'library-channel';
export type NativePlaybackTarget = 'apple' | 'google-cast';
export const PORTICO_CAST_RECEIVER_ORIGIN = 'https://cast.getportico.tv';
export const PORTICO_CAST_BOOTSTRAP_PLACEHOLDER = `${PORTICO_CAST_RECEIVER_ORIGIN}/bootstrap`;

const CAST_RECEIVER_PROFILE = genericPlaybackClientProfile({
  device: 'Google Cast receiver',
  maxAudioChannels: 2,
  maxHeight: 1080,
  maxWidth: 1920,
  platform: 'Google Cast',
  supportedAudioCodecs: ['aac', 'mp3', 'opus', 'vorbis', 'flac'],
  supportedContainers: ['hls', 'mp4', 'mpegts', 'mp3', 'webm', 'ogg', 'wav'],
  supportedVideoCodecs: ['h264'],
  supportsAc3: false,
  supportsEac3: false,
  supportsHdr: false,
  supportsHevc: false,
  supportsHls: true,
  supportsMpegTs: true,
});

export interface CastReceiverReadyBinding {
  receiverId: string;
  receiverPublicKey: string;
  receiverChallenge: string;
}

export interface CastBootstrapOptions {
  /** Current player position, not the older resume point captured at session creation. */
  positionSeconds?: number;
  /** Portable preference intent is re-resolved for the Cast decoder by the server. */
  intent?: PlaybackIntent;
  /** Immutable route identity; recording/channel ids are not always media ids. */
  sourceId?: string;
  sourceKind?: RoutedPlaybackKind;
}

export async function createCastBootstrap(
  client: PorticoClient,
  current: PlaybackResponse,
  binding: CastReceiverReadyBinding,
  platform: 'mobile' | 'tv',
  options: CastBootstrapOptions = {},
): Promise<CastBootstrapResponse> {
  return client.createCastBootstrap({
    mediaId: current.media.id,
    // Client Core replaces this required wire placeholder with the configured
    // installation identity. A playback session id is not an installation id.
    clientInstanceId: '',
    sourcePlaybackSessionId: current.sessionId,
    clientProfile: playbackClientProfileForTarget('google-cast', platform),
    intent: options.intent,
    versionId: current.selectedVersionId,
    audioStreamId: current.selectedAudioStreamId,
    burnInSubtitleId:
      current.selectedSubtitleMode === 'burn_in'
        ? current.selectedSubtitleStreamId
        : undefined,
    subtitleStreamId:
      current.selectedSubtitleMode === 'text'
        ? current.selectedSubtitleStreamId
        : undefined,
    startSeconds: Math.floor(
      Math.max(
        0,
        options.positionSeconds ?? current.resumePositionSeconds ?? 0,
      ),
    ),
    queueMediaIds: current.queue.map(item => item.id),
    repeatMode: current.repeatMode,
    sourceContext: current.sourceContext,
    sourceKind: options.sourceKind ?? castSourceKind(current),
    sourceId: options.sourceId?.trim() || current.media.id,
    receiverId: binding.receiverId,
    receiverOrigin: PORTICO_CAST_RECEIVER_ORIGIN,
    receiverPublicKey: binding.receiverPublicKey,
    receiverChallenge: binding.receiverChallenge,
    capabilities: [
      'load',
      'control',
      'stop',
      'progress',
      'renew',
      'reconnect',
      'advance',
      'segment-skip',
    ],
  });
}
export interface RoutedPlaybackOverrides {
  audioStreamId?: string;
  burnInSubtitleId?: string;
  intent?: PlaybackIntent;
  subtitleStreamId?: string;
  queueMediaIds?: string[];
  repeatMode?: PlaybackResponse['repeatMode'];
  sourceContext?: PlaybackSourceContext;
}

/** Converts the Apple preference projection into the canonical portable start intent. */
export function playbackIntentForApplePreferences(
  preferences: AppleViewerPreferences,
  options: {
    networkClass?: PlaybackIntent['networkClass'];
    subtitleMode?: 'off' | 'text' | 'burn_in';
    transportClass?: PlaybackIntent['transportClass'];
  } = {},
): PlaybackIntent {
  const networkClass = ['local', 'wifi', 'cellular', 'unknown'].includes(String(options.networkClass))
    ? options.networkClass!
    : 'unknown';
  const transportClass = ['wifi', 'cellular', 'wired', 'unknown'].includes(String(options.transportClass))
    ? options.transportClass!
    : networkClass === 'wifi' || networkClass === 'cellular'
      ? networkClass
      : networkClass === 'local' ? 'wired' : 'unknown';
  const preferredAudioLanguage = portableLanguage(preferences.preferredAudioLanguage);
  const preferredSubtitleLanguage = portableLanguage(preferences.preferredSubtitleLanguage);
  const subtitlesEnabled = (options.subtitleMode ?? (preferences.preferredSubtitleLanguage !== 'off' ? 'text' : 'off')) !== 'off';
  const qualityMode = (networkClass === 'local'
    ? preferences.localQualityMode
    : networkClass === 'wifi'
      ? preferences.wifiQualityMode
      : networkClass === 'cellular'
        ? preferences.cellularQualityMode
        : preferences.unknownQualityMode) ?? 'original';
  return {
    // Physical network quality and selected-server locality are independent;
    // never derive this from routeType or the server URL.
    networkClass,
    transportClass,
    qualityProfile:
      qualityMode === 'data-saver'
        ? 'data_saver'
        : qualityMode === 'automatic' ||
            qualityMode === 'original' ||
            qualityMode === 'high' ||
            qualityMode === 'standard'
          ? qualityMode
          : 'automatic',
    directPlayPolicy: preferences.directPlay,
    directStreamPolicy: preferences.directStream,
    transcodePolicy: preferences.transcode,
    preferredAudioLanguage,
    preferredAudioLanguages: preferredAudioLanguage ? [preferredAudioLanguage] : [],
    preferredSubtitleLanguage,
    preferredSubtitleLanguages: preferredSubtitleLanguage ? [preferredSubtitleLanguage] : [],
    preferredSubtitleMode: options.subtitleMode ?? (subtitlesEnabled ? 'text' : 'off'),
    subtitlesEnabled,
  } as PlaybackIntent;
}

/**
 * The server must negotiate for the decoder that will consume the stream.
 * Google Cast deliberately uses a conservative, broadly supported profile so
 * an Apple-only direct-play decision (for example HEVC or MOV) is never handed
 * to a receiver that may not support it.
 */
export function playbackClientProfileForTarget(
  target: NativePlaybackTarget,
  platform: 'mobile' | 'tv',
): PlaybackClientProfile {
  if (target === 'google-cast') {
    return CAST_RECEIVER_PROFILE;
  }
  const runtimeDescriptor = getPorticoRuntimeDescriptor(platform);
  const nativeProfile = runtimeDescriptor.capabilities.playback.profile;
  if (nativeProfile) return nativeProfile;
  if (runtimeDescriptor.runtime === 'ios' || runtimeDescriptor.runtime === 'tvos') {
    return applePlaybackClientProfile(platform);
  }
  throw new Error(
    `The ${runtimeDescriptor.runtime} runtime descriptor has no validated native playback profile.`,
  );
}

function castSourceKind(
  playback: PlaybackResponse,
): 'media' | 'live' | 'dvr' | 'library-channel' {
  const contextType = playback.sourceContext?.type?.trim().toLowerCase();
  if (contextType === 'library-channel') return 'library-channel';
  if (playback.media.type === 'library_channel') return 'library-channel';
  if (
    playback.media.type === 'recording' ||
    playback.media.type === 'dvr_recording'
  )
    return 'dvr';
  if (playback.isLive || playback.media.type === 'live_channel') return 'live';
  return 'media';
}

/**
 * Starts playback through the server contract that owns the selected surface.
 * A DVR recording id is not a media id, and a live channel id is not either;
 * keeping this routing explicit prevents those client surfaces from silently
 * falling back to the generic media endpoint.
 */
export function startRoutedPlayback(
  client: PorticoClient,
  id: string,
  kind: RoutedPlaybackKind,
  startSeconds?: number,
  versionId?: string,
  init?: RequestSignal,
  platform: 'mobile' | 'tv' = 'mobile',
  overrides: RoutedPlaybackOverrides = {},
): Promise<PlaybackResponse> {
  const clientProfile = playbackClientProfileForTarget('apple', platform);
  if (kind === 'live') {
    const options = {
      ...(overrides.intent ? {intent: overrides.intent} : {}),
      clientProfile,
    };
    return (init
      ? client.startLiveTvPlayback(id, options, init)
      : client.startLiveTvPlayback(id, options)
    ).then(validatePlaybackResponse);
  }
  if (kind === 'dvr') {
    const options = {
      ...(startSeconds === undefined ? {} : {startSeconds}),
      ...(overrides.intent ? {intent: overrides.intent} : {}),
      clientProfile,
    };
    return (init ? client.playDvrRecording(id, options, init) : client.playDvrRecording(id, options))
      .then(validatePlaybackResponse);
  }
  if (kind === 'library-channel') {
    // Client Core's legacy library-channel signature accepts the Fetch
    // signal shape, while routed playback accepts the richer P06 RequestSignal
    // envelope. Normalize only the nullable signal at this boundary; spread
    // the envelope so timeout/deadline/retry policy remains intact and a
    // caller-owned AbortSignal is never replaced.
    const libraryChannelInit = init
      ? {...init, signal: init.signal ?? undefined}
      : undefined;
    return (init
      ? client.tuneLibraryChannel(id, {clientProfile, intent: overrides.intent}, libraryChannelInit)
      : client.tuneLibraryChannel(id, {clientProfile, intent: overrides.intent})
    ).then(response => validatePlaybackResponse(response.playback));
  }
    const options = {
      clientProfile,
      ...(startSeconds === undefined ? {} : {startSeconds}),
      ...(versionId ? {versionId} : {}),
      ...(overrides.audioStreamId ? {audioStreamId: overrides.audioStreamId} : {}),
      ...(overrides.burnInSubtitleId ? {burnInSubtitleId: overrides.burnInSubtitleId} : {}),
      ...(overrides.subtitleStreamId ? {subtitleStreamId: overrides.subtitleStreamId} : {}),
      ...(overrides.intent ? {intent: overrides.intent} : {}),
      ...(overrides.queueMediaIds ? {queueMediaIds: overrides.queueMediaIds} : {}),
      ...(overrides.repeatMode ? {repeatMode: overrides.repeatMode} : {}),
      ...(overrides.sourceContext ? {sourceContext: overrides.sourceContext} : {}),
  };
  return (init ? client.startPlayback(id, options, init) : client.startPlayback(id, options))
    .then(validatePlaybackResponse);
}

/** Creates the replacement session used when playback moves between this Apple device and Cast. */
export function handoffPlaybackTarget(
  client: PorticoClient,
  current: PlaybackResponse,
  target: NativePlaybackTarget,
  platform: 'mobile' | 'tv',
  route: {kind: RoutedPlaybackKind; sourceId: string; positionSeconds: number},
): Promise<PlaybackResponse> {
  const clientProfile = playbackClientProfileForTarget(target, platform);
  if (route.kind === 'live') {
    const result = target === 'google-cast'
      ? client.openLiveTvStream(route.sourceId, {clientProfile})
      : client.startLiveTvPlayback(route.sourceId, {clientProfile});
    return result.then(validatePlaybackResponse);
  }
  return client.handoffPlayback(current.sessionId, {
    clientProfile,
    mediaId: current.media.id,
    progressSeconds: Math.floor(Math.max(0, route.positionSeconds)),
    queueMediaIds: current.queue.map(item => item.id),
    sourceContext: current.sourceContext,
  }).then(validatePlaybackResponse);
}

/**
 * The native adapter is the last trust boundary before an AVPlayer item is
 * activated. Reject malformed relationships here instead of allowing a
 * missing grant, mismatched resource, invalid timeline, or stale selection to
 * become an opaque native decoder failure.
 */
export interface PlaybackValidationOptions {
  /** Exact selected server origins. Relative /api resources remain scoped to this server. */
  serverOrigins?: readonly string[];
}

export function validatePlaybackResponse(
  value: unknown,
  options: PlaybackValidationOptions = {},
): PlaybackResponse {
  if (!isRecord(value)) throw playbackContractError('Playback response was not an object.');
  const playback = value as Partial<PlaybackResponse>;
  const extendedPlayback = playback as Partial<PlaybackResponse> & {
    continuationCredential?: unknown;
    playbackRevision?: unknown;
  };
  if (!nonEmpty(playback.sessionId) || !nonEmpty(playback.sourceUrl)) {
    throw playbackContractError('Playback response did not identify a session and resource.');
  }
  const nextEventSequence = typeof playback.nextEventSequence === 'number' ? playback.nextEventSequence : NaN;
  const generation = typeof playback.generation === 'number' ? playback.generation : NaN;
  const playbackRevision = typeof extendedPlayback.playbackRevision === 'number' ? extendedPlayback.playbackRevision : NaN;
  const queueRevision = typeof playback.queueRevision === 'number' ? playback.queueRevision : NaN;
  if (!Number.isInteger(nextEventSequence) || nextEventSequence < 1 ||
      !Number.isInteger(generation) || generation < 0 ||
      !Number.isInteger(playbackRevision) || playbackRevision < 0 ||
      typeof playback.directPlay !== 'boolean' ||
      !['off', 'one', 'all'].includes(playback.repeatMode as string) ||
      !Number.isInteger(queueRevision) || queueRevision < 0) {
    throw playbackContractError('Playback response omitted authoritative session sequencing.');
  }
  if (!isRecord(playback.media) || !nonEmpty(playback.media.id)) {
    throw playbackContractError('Playback response did not identify playable media.');
  }
  if (!isRecord(playback.mediaGrant) ||
      !nonEmpty(playback.mediaGrant.token) ||
      !nonEmpty(playback.mediaGrant.expiresAt) ||
      !Number.isFinite(Date.parse(playback.mediaGrant.expiresAt)) ||
      Date.parse(playback.mediaGrant.expiresAt) <= Date.now()) {
    throw playbackContractError('Playback response did not contain a valid media grant.');
  }
  if (!cleanResourceURL(playback.sourceUrl)) {
    throw playbackContractError('Playback response contained an unsafe media URL.');
  }
  const continuationCredential = extendedPlayback.continuationCredential;
  if (!isRecord(continuationCredential) ||
      !nonEmpty(continuationCredential.token) ||
      !nonEmpty(continuationCredential.origin) ||
      !nonEmpty(continuationCredential.expiresAt) ||
      !Number.isFinite(Date.parse(continuationCredential.expiresAt)) ||
      Date.parse(continuationCredential.expiresAt) <= Date.now() ||
      continuationCredential.generation !== generation ||
      (options.serverOrigins && !isOriginInOrigins(continuationCredential.origin, options.serverOrigins))) {
    throw playbackContractError('Playback response did not contain a valid scoped continuation credential.');
  }
  let continuationURL: URL;
  try {
    continuationURL = new URL(`${continuationCredential.origin}/api/playback-sessions/${encodeURIComponent(playback.sessionId)}/continuation`);
  } catch {
    throw playbackContractError('Playback response did not contain a valid continuation origin.');
  }
  if (options.serverOrigins && !isPlaybackURLInOrigins(continuationURL.toString(), options.serverOrigins)) {
    throw playbackContractError('Playback continuation is outside the selected server origins.');
  }
  if (options.serverOrigins && !isPlaybackURLInOrigins(playback.sourceUrl, options.serverOrigins)) {
    throw playbackContractError('Playback response resource is outside the selected server origins.');
  }
  if (!isRecord(playback.decision) || !isRecord(playback.policy)) {
    throw playbackContractError('Playback response did not contain delivery decision and policy.');
  }
  if (!isRecord(playback.timeline) ||
      (playback.isLive === true && playback.timeline.type !== 'live') ||
      (playback.isLive !== true && playback.timeline.type !== 'vod' && playback.media.type !== 'live_channel')) {
    throw playbackContractError('Playback response contained an inconsistent timeline.');
  }
  if (!Array.isArray(playback.audioStreams) ||
      !Array.isArray(playback.subtitleStreams) ||
      !Array.isArray(playback.qualities) ||
      !Array.isArray(playback.chapters) ||
      !Array.isArray(playback.queue)) {
    throw playbackContractError('Playback response omitted required selection collections.');
  }
  if (playback.selectedAudioStreamId &&
      !playback.audioStreams.some(stream => isRecord(stream) && stream.id === playback.selectedAudioStreamId)) {
    throw playbackContractError('Playback response selected an audio stream it did not publish.');
  }
  if (playback.selectedSubtitleStreamId &&
      !playback.subtitleStreams.some(stream => isRecord(stream) && stream.id === playback.selectedSubtitleStreamId)) {
    throw playbackContractError('Playback response selected a subtitle stream it did not publish.');
  }
  if (playback.selectedQualityId &&
      !playback.qualities.some(quality => isRecord(quality) && quality.id === playback.selectedQualityId)) {
    throw playbackContractError('Playback response selected a quality it did not publish.');
  }
  if (!Array.isArray(playback.resources) || playback.resources.length === 0) {
    throw playbackContractError('Playback response did not publish a playable resource.');
  }
  const resources = playback.resources.filter(isRecord);
  if (resources.length !== playback.resources.length ||
      resources.some(resource => !nonEmpty(resource.id) || !nonEmpty(resource.sourceUrl) ||
        !nonEmpty(resource.streamFormat) || !cleanResourceURL(resource.sourceUrl) ||
        (options.serverOrigins && !isPlaybackURLInOrigins(resource.sourceUrl, options.serverOrigins))) ||
      new Set(resources.map(resource => resource.id)).size !== resources.length) {
    throw playbackContractError('Playback response contained an invalid resource relationship.');
  }
  const activeResource = resources.find(resource => resource.sourceUrl === playback.sourceUrl);
  if (!activeResource) {
    throw playbackContractError('Playback response source did not match a published resource.');
  }
  if (playback.selectedQualityId && activeResource.qualityId &&
      activeResource.qualityId !== playback.selectedQualityId) {
    throw playbackContractError('Playback response source did not match its selected quality.');
  }
  if (playback.selectedAudioStreamId && activeResource.audioStreamId &&
      activeResource.audioStreamId !== playback.selectedAudioStreamId) {
    throw playbackContractError('Playback response source did not match its selected audio stream.');
  }
  if (playback.selectedSubtitleStreamId && activeResource.subtitleStreamId &&
      activeResource.subtitleStreamId !== playback.selectedSubtitleStreamId) {
    throw playbackContractError('Playback response source did not match its selected subtitle stream.');
  }
  if (playback.selectedSubtitleMode === 'burn_in' && !playback.selectedSubtitleStreamId) {
    throw playbackContractError('Playback response selected burn-in without a subtitle stream.');
  }
  return playback as PlaybackResponse;
}

export interface PreferredPlaybackSelection {
  audioStreamId?: string;
  subtitleStreamId?: string;
  subtitleRequiresBurnIn: boolean;
}

/**
 * Native playback failures get one transparent media-grant refresh. A second
 * failure is surfaced to the viewer instead of creating an invisible retry
 * loop that can repeatedly allocate server sessions or hammer an unavailable
 * route.
 */
export function shouldAttemptNativePlaybackRecovery(attemptsForSource: number): boolean {
  return Number.isInteger(attemptsForSource) && attemptsForSource >= 0 && attemptsForSource < 1;
}

/**
 * Cast's receiver needs the actual transport MIME type, not the media item's
 * library family. Prefer the server playback decision and use the playable
 * media type only to distinguish audio-only MP4/WebM from video containers.
 */
export function googleCastContentType(playback: PlaybackResponse): string {
  const format = playback.streamFormat?.trim().toLowerCase();
  if (format === 'hls' || format === 'm3u8') return 'application/x-mpegURL';
  if (format === 'dash' || format === 'mpd') return 'application/dash+xml';

  const container = (playback.decision.container || sourceExtension(playback.sourceUrl) || format || '').toLowerCase();
  const audioOnly = new Set(['album', 'artist', 'audio', 'audiobook', 'book', 'chapter', 'music', 'track']).has(playback.media.type.toLowerCase());
  if (container === 'mp3') return 'audio/mpeg';
  if (container === 'aac' || container === 'adts') return 'audio/aac';
  if (container === 'flac') return 'audio/flac';
  if (container === 'ogg' || container === 'oga' || container === 'opus') return 'audio/ogg';
  if (container === 'wav' || container === 'wave') return 'audio/wav';
  if (container === 'webm') return audioOnly ? 'audio/webm' : 'video/webm';
  if (container === 'mpegts' || container === 'mpeg-ts' || container === 'ts' || container === 'mp2t') return 'video/mp2t';
  if (container === 'mp4' || container === 'm4a' || container === 'm4v' || container === 'mov') {
    return audioOnly ? 'audio/mp4' : 'video/mp4';
  }
  return audioOnly ? 'audio/mpeg' : 'video/mp4';
}

function sourceExtension(sourceURL: string): string | undefined {
  const path = sourceURL.split(/[?#]/, 1)[0] ?? '';
  const match = path.match(/\.([a-z0-9]{2,5})$/i);
  return match?.[1];
}

/** Resolves device preferences only against streams the server actually published. */
export function preferredPlaybackSelection(playback: PlaybackResponse, preferences: AppleViewerPreferences): PreferredPlaybackSelection {
  const preferredAudio = resolvePreferredAudioLanguage(preferences.preferredAudioLanguage);
  const audio = preferences.preferredAudioLanguage === 'original'
    ? undefined
    : preferredAudio
      ? playback.audioStreams.find(stream => languageMatches(preferredAudio, stream.language))
      : undefined;
  const subtitle = preferences.preferredSubtitleLanguage === 'off'
    ? undefined
    : playback.subtitleStreams.find(stream => languageMatches(preferences.preferredSubtitleLanguage as Exclude<PreferredLanguage, 'original' | 'system'>, stream.language));
  return {
    audioStreamId: audio && audio.id !== playback.selectedAudioStreamId ? audio.id : undefined,
    subtitleStreamId: subtitle?.id,
    subtitleRequiresBurnIn: Boolean(subtitle && !subtitle.sourceUrl),
  };
}

function resolvePreferredAudioLanguage(preference: PreferredLanguage): Exclude<PreferredLanguage, 'original' | 'system'> | undefined {
  if (preference !== 'system') return preference === 'original' ? undefined : preference;
  const locale = Intl.DateTimeFormat().resolvedOptions().locale.toLowerCase();
  const code = locale.split(/[-_]/)[0];
  return ['en', 'fr', 'es', 'de', 'it', 'pt', 'ja', 'ko', 'zh', 'nl', 'sv', 'no', 'da', 'pl', 'tr', 'ru'].includes(code)
    ? code as Exclude<PreferredLanguage, 'original' | 'system'>
    : undefined;
}

function portableLanguage(value: PreferredLanguage | 'off'): string | undefined {
  if (value === 'off' || value === 'original') return undefined;
  if (value === 'system') return resolvePreferredAudioLanguage(value);
  return value;
}

function isRecord(value: unknown): value is Record<string, any> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function nonEmpty(value: unknown): value is string {
  return typeof value === 'string' && value.trim().length > 0;
}

function cleanResourceURL(value: unknown): value is string {
  if (!nonEmpty(value)) return false;
  try {
    const url = new URL(value, 'https://portico.invalid') as unknown as {protocol: string; searchParams: {has(name: string): boolean}};
    if (!['http:', 'https:'].includes(url.protocol) && !value.startsWith('/api/')) return false;
    return !['media_grant', 'download_grant', 'access_token'].some(name => url.searchParams.has(name));
  } catch {
    return value.startsWith('/api/') && !/[?&](media_grant|download_grant|access_token)=/i.test(value);
  }
}

function isPlaybackURLInOrigins(value: string, serverOrigins: readonly string[]): boolean {
  if (value.startsWith('/api/')) return serverOrigins.length > 0;
  try {
    const url = new URL(value) as unknown as {origin: string; protocol: string; hostname: string};
    if (url.protocol === 'http:' && !isTrustedInsecureHost(url.hostname)) return false;
    return isOriginInOrigins(url.origin, serverOrigins);
  } catch {
    return false;
  }
}

export function isTrustedInsecureHost(hostname: string): boolean {
  const host = hostname.trim().toLowerCase().replace(/^\[|\]$/g, '');
  if (host === 'localhost' || host === '::1' || host.startsWith('fe80:')) return true;
  const octets = host.split('.').map(Number);
  if (octets.length !== 4 || octets.some(octet => !Number.isInteger(octet) || octet < 0 || octet > 255)) return false;
  const [a, b] = octets;
  return a === 127 || a === 10 || (a === 172 && b >= 16 && b <= 31) ||
    (a === 192 && b === 168) || (a === 169 && b === 254);
}

function isOriginInOrigins(value: string, serverOrigins: readonly string[]): boolean {
  try {
    const origin = (new URL(value) as unknown as {origin: string}).origin.toLowerCase();
    return serverOrigins.some(candidate =>
      (new URL(candidate) as unknown as {origin: string}).origin.toLowerCase() === origin,
    );
  } catch {
    return false;
  }
}

export function playbackServerOrigins(apiBaseUrl: string | undefined): string[] {
  if (!apiBaseUrl) return [];
  try {
    const url = new URL(apiBaseUrl) as unknown as {protocol: string; origin: string};
    if (!['http:', 'https:'].includes(url.protocol)) return [];
    return [url.origin];
  } catch {
    return [];
  }
}

function playbackContractError(message: string): Error & {code: string} {
  const error = new Error(message) as Error & {code: string};
  error.name = 'PlaybackContractError';
  error.code = 'playback_response_invalid';
  return error;
}
