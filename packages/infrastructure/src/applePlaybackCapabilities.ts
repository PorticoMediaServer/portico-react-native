import {Platform, UIManager} from 'react-native';
import {
  applePlaybackCapabilityProfile,
  type PlaybackClientProfile,
} from '@portico/client-core';
import {
  PORTICO_PLAYBACK_CAPABILITY_CONTRACT_VERSION,
  type PorticoPlatform,
} from './types';

type NativeApplePlaybackProbe = {
  applePlaybackProfile?: unknown;
  probeCapabilities?: () => Promise<unknown>;
};

function readNativeProbe(): NativeApplePlaybackProbe | undefined {
  // PorticoPlayerView is a native view manager. Its exported constants live
  // in UIManager's view-manager configuration rather than NativeModules.
  // Reading the correct bridge surface also makes the facts available before
  // the first player view is mounted.
  const config = UIManager.getViewManagerConfig?.('PorticoPlayerView') as
    | {Constants?: {applePlaybackProfile?: unknown}; applePlaybackProfile?: unknown}
    | undefined;
  const applePlaybackProfile = config?.Constants?.applePlaybackProfile ?? config?.applePlaybackProfile;
  return applePlaybackProfile === undefined ? undefined : {applePlaybackProfile};
}

export class ApplePlaybackCapabilitiesUnavailableError extends Error {
  constructor(message = 'Apple playback capabilities were not published by the native runtime.') {
    super(message);
    this.name = 'ApplePlaybackCapabilitiesUnavailableError';
  }
}

/**
 * The native Apple bridge is the authority for this profile. A missing bridge,
 * malformed payload, or OS/form-factor mismatch is an actionable failure; the
 * client never substitutes model- or OS-derived playback capabilities.
 */
export function applePlaybackClientProfile(
  platform: PorticoPlatform | 'mobile' | 'tv',
): PlaybackClientProfile {
  const target = assertAppleRuntimeTarget(platform);
  const nativeProfile = readNativePlaybackProfile();
  return canonicalAppleProfile(nativeProfile, target);
}

export async function probeApplePlaybackClientProfile(
  platform: PorticoPlatform | 'mobile' | 'tv',
): Promise<PlaybackClientProfile> {
  const target = assertAppleRuntimeTarget(platform);
  const nativeProbe = readNativeProbe();
  if (typeof nativeProbe?.probeCapabilities === 'function') {
    let probed: unknown;
    try {
      probed = await nativeProbe.probeCapabilities();
    } catch (cause) {
      throw new ApplePlaybackCapabilitiesUnavailableError(
        `Apple playback capability probing failed: ${safeErrorName(cause)}.`,
      );
    }
    return canonicalAppleProfile(probed, target);
  }
  return applePlaybackClientProfile(platform);
}

type AppleRuntimeTarget = {
  os: 'ios' | 'tvos';
  formFactor: 'mobile' | 'television';
  nativePlatform: 'iOS' | 'tvOS';
};

function assertAppleRuntimeTarget(platform: PorticoPlatform): AppleRuntimeTarget {
  if (Platform.OS !== 'ios') {
    throw new ApplePlaybackCapabilitiesUnavailableError(
      `Apple playback capability discovery is unavailable on ${String(Platform.OS)}.`,
    );
  }
  const television = platform === 'tv';
  if (typeof Platform.isTV === 'boolean' && Platform.isTV !== television) {
    throw new ApplePlaybackCapabilitiesUnavailableError(
      'The requested Apple form factor does not match the native runtime.',
    );
  }
  return {
    os: television ? 'tvos' : 'ios',
    formFactor: television ? 'television' : 'mobile',
    nativePlatform: television ? 'tvOS' : 'iOS',
  };
}

function readNativePlaybackProfile(): unknown {
  const nativeProbe = readNativeProbe();
  if (!nativeProbe) {
    throw new ApplePlaybackCapabilitiesUnavailableError();
  }
  try {
    const profile = nativeProbe.applePlaybackProfile;
    if (profile === undefined) throw new ApplePlaybackCapabilitiesUnavailableError();
    return profile;
  } catch (cause) {
    if (cause instanceof ApplePlaybackCapabilitiesUnavailableError) throw cause;
    throw new ApplePlaybackCapabilitiesUnavailableError(
      `Apple playback capability constants could not be read: ${safeErrorName(cause)}.`,
    );
  }
}

function isPlaybackClientProfile(
  value: unknown,
  target: AppleRuntimeTarget,
): value is PlaybackClientProfile {
  if (!value || typeof value !== 'object') return false;
  const profile = value as Partial<PlaybackClientProfile>;
  const hasNativeEvidence = profile.capabilityEvidence?.some(evidence =>
    evidence.source === 'native_runtime' &&
    typeof evidence.producer === 'string' &&
    typeof evidence.reviewedAt === 'string',
  ) ?? false;
  return (
    profile.capabilitySchemaVersion === PORTICO_PLAYBACK_CAPABILITY_CONTRACT_VERSION &&
    profile.clientFamily === 'avkit' &&
    profile.platform === target.os &&
    typeof profile.clientVersion === 'string' &&
    hasNativeEvidence &&
    typeof profile.device === 'string' &&
    profile.supportsHls === true &&
    profile.supportsMse === false &&
    Array.isArray(profile.supportedContainers) &&
    Array.isArray(profile.supportedVideoCodecs) &&
    Array.isArray(profile.supportedAudioCodecs) &&
    Array.isArray(profile.supportedVideoProfiles) &&
    Array.isArray(profile.supportedPixelFormats) &&
    Array.isArray(profile.supportedHdrFormats) &&
    Array.isArray(profile.supportedDolbyVisionProfiles) &&
    typeof profile.maxAudioChannels === 'number' &&
    typeof profile.maxVideoBitDepth === 'number' &&
    typeof profile.supportsHevc === 'boolean' &&
    typeof profile.supportsHdr === 'boolean' &&
    typeof profile.supportsAc3 === 'boolean' &&
    typeof profile.supportsEac3 === 'boolean' &&
    typeof profile.prefersServerProxy === 'boolean' &&
    typeof profile.requiresServerProxy === 'boolean'
  );
}

function canonicalAppleProfile(
  value: unknown,
  target: AppleRuntimeTarget,
): PlaybackClientProfile {
  if (isPlaybackClientProfile(value, target)) return value;
  if (!isRecord(value)) throw new ApplePlaybackCapabilitiesUnavailableError();

  if (value.platform !== target.nativePlatform) {
    throw new ApplePlaybackCapabilitiesUnavailableError(
      'The native Apple capability descriptor does not match the requested OS/form factor.',
    );
  }
  const device = requiredString(value.device, 'device');
  const clientVersion = requiredString(value.clientVersion, 'clientVersion');
  const observedAt = requiredTimestamp(value.observedAt, 'observedAt');
  const supportedVideoCodecs = requiredStringArray(value.supportedVideoCodecs, 'supportedVideoCodecs');
  const supportedAudioCodecs = requiredStringArray(value.supportedAudioCodecs, 'supportedAudioCodecs');
  const supportedHdrFormats = requiredStringArray(value.supportedHdrFormats, 'supportedHdrFormats');
  const supportedDolbyVisionProfiles = requiredStringArray(
    value.supportedDolbyVisionProfiles,
    'supportedDolbyVisionProfiles',
  );
  const maxWidth = requiredPositiveNumber(value.maxWidth, 'maxWidth');
  const maxHeight = requiredPositiveNumber(value.maxHeight, 'maxHeight');
  const maxFrameRate = requiredPositiveNumber(value.maxFrameRate, 'maxFrameRate');
  const maxAudioChannels = requiredPositiveNumber(value.maxAudioChannels, 'maxAudioChannels');
  requiredBoolean(value.supportsHevc, 'supportsHevc');
  requiredBoolean(value.supportsAc3, 'supportsAc3');
  requiredBoolean(value.supportsEac3, 'supportsEac3');
  const hevcAdvertised = supportedVideoCodecs.some(codec => /^(?:hevc|h265)$/i.test(codec));
  if (value.supportsHevc !== hevcAdvertised) {
    throw new ApplePlaybackCapabilitiesUnavailableError(
      'The native Apple capability descriptor has inconsistent HEVC facts.',
    );
  }

  return applePlaybackCapabilityProfile({
    platform: target.os,
    deviceName: device,
    clientVersion,
    observedAt,
    maxWidth,
    maxHeight,
    maxFrameRate,
    maxAudioChannels,
    supportsHevc: value.supportsHevc as boolean,
    supportsHdr10: supportedHdrFormats.includes('hdr10'),
    supportsHlg: supportedHdrFormats.includes('hlg'),
    supportsDolbyVision: supportedHdrFormats.includes('dolby_vision'),
    dolbyVisionProfiles: supportedDolbyVisionProfiles,
    supportsAc3: value.supportsAc3 as boolean,
    supportsEac3: value.supportsEac3 as boolean,
    // The native bridge does not claim Atmos support; absence is not a
    // substitute profile and therefore cannot broaden the playback contract.
    supportsAtmos: value.supportsAtmos === true,
    supportedAudioCodecs,
    supportedSubtitleCodecs: ['webvtt', 'mov_text', 'tx3g'],
  }, {route: 'local'}).clientProfile;
}

function requiredString(value: unknown, field: string): string {
  if (typeof value !== 'string' || !value.trim() || value.length > 256) {
    throw new ApplePlaybackCapabilitiesUnavailableError(`Native Apple capability field ${field} is invalid.`);
  }
  return value.trim();
}

function requiredTimestamp(value: unknown, field: string): string {
  const stringValue = requiredString(value, field);
  if (!Number.isFinite(Date.parse(stringValue))) {
    throw new ApplePlaybackCapabilitiesUnavailableError(`Native Apple capability field ${field} is invalid.`);
  }
  return new Date(stringValue).toISOString();
}

function requiredStringArray(value: unknown, field: string): string[] {
  if (!Array.isArray(value)) {
    throw new ApplePlaybackCapabilitiesUnavailableError(`Native Apple capability field ${field} is invalid.`);
  }
  const values = value.filter((item): item is string => typeof item === 'string' && Boolean(item.trim()));
  if (!values.length && field !== 'supportedHdrFormats' && field !== 'supportedDolbyVisionProfiles') {
    throw new ApplePlaybackCapabilitiesUnavailableError(`Native Apple capability field ${field} is empty.`);
  }
  return values.map(item => item.trim());
}

function requiredPositiveNumber(value: unknown, field: string): number {
  if (typeof value !== 'number' || !Number.isFinite(value) || value <= 0) {
    throw new ApplePlaybackCapabilitiesUnavailableError(`Native Apple capability field ${field} is invalid.`);
  }
  return Math.trunc(value);
}

function requiredBoolean(value: unknown, field: string): void {
  if (typeof value !== 'boolean') {
    throw new ApplePlaybackCapabilitiesUnavailableError(`Native Apple capability field ${field} is invalid.`);
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function safeErrorName(value: unknown): string {
  return value instanceof Error && value.name.length <= 64 ? value.name : 'UnknownError';
}
