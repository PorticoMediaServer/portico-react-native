import {NativeModules, Platform} from 'react-native';
import {type PlaybackClientProfile} from '@portico/client-core';
import type {ApplePlayerCapabilities} from './index';

export const ANDROID_PLAYBACK_CAPABILITY_CONTRACT_VERSION = 'playback-capability-v2' as const;

export type AndroidRuntimeFamily = 'android' | 'android_tv' | 'fire_tv';
export type AndroidFormFactor = 'mobile' | 'television';
export type AndroidNativePlatform = 'Android' | 'Android TV' | 'Fire TV';
export type AndroidRuntimeStatus = 'available' | 'unavailable' | 'error';

export interface AndroidRuntimeError {
  code: string;
  message: string;
}

export interface AndroidRuntimeIdentity {
  runtime: AndroidRuntimeFamily;
  formFactor: AndroidFormFactor;
  nativePlatform: AndroidNativePlatform;
  deviceName: string;
  packageName: string;
  applicationId: string;
  appVersion: string;
  buildNumber: string;
  androidApiLevel: number;
  model: string;
  manufacturer: string;
  identitySource: 'android-native-runtime';
}

export interface AndroidClientDescriptor {
  version: 1;
  app: 'Portico';
  os: AndroidRuntimeFamily;
  runtime: AndroidRuntimeFamily;
  formFactor: AndroidFormFactor;
  nativePlatform: AndroidNativePlatform;
  deviceName: string;
  packageName: string;
  applicationId: string;
  appVersion: string;
  buildNumber: string;
  identitySource: 'android-native-runtime';
  capabilities: {
    playback: {
      version: typeof ANDROID_PLAYBACK_CAPABILITY_CONTRACT_VERSION;
      family: 'media3' | 'fire-tv';
      source: 'native-runtime-required';
      status: 'available' | 'unavailable' | 'error';
    };
  };
}

export interface AndroidRuntimeCapabilities {
  status: AndroidRuntimeStatus;
  profile?: PlaybackClientProfile;
  error?: AndroidRuntimeError;
}

export interface AndroidRuntimeState {
  status: AndroidRuntimeStatus;
  identity?: AndroidRuntimeIdentity;
  descriptor?: AndroidClientDescriptor;
  capabilities: AndroidRuntimeCapabilities;
  error?: AndroidRuntimeError;
}

export interface AndroidPlaybackCapabilities extends ApplePlayerCapabilities {
  runtimeFamily: AndroidRuntimeFamily;
  runtime: AndroidRuntimeFamily;
  capabilityStatus: AndroidRuntimeStatus;
  availability: 'available' | 'unavailable' | 'error';
  clientProfile?: PlaybackClientProfile;
  error?: AndroidRuntimeError;
}

export class AndroidPlaybackUnavailableError extends Error {
  readonly code: string;

  constructor(message = 'Android playback capabilities are unavailable.') {
    super(message);
    this.name = 'AndroidPlaybackUnavailableError';
    this.code = 'PORTICO_ANDROID_PLAYBACK_UNAVAILABLE';
  }
}

type NativeRuntimeModule = {
  getRuntimeState?: () => Promise<unknown>;
  getConstants?: () => {androidRuntimeState?: unknown};
  androidRuntimeState?: unknown;
};

type NativeCleanupModule = {
  getState: () => Promise<unknown>;
  begin: (generation: string) => Promise<unknown>;
  markCompleted: (generation: string) => Promise<unknown>;
  release: (generation: string) => Promise<unknown>;
};

const nativeRuntime = NativeModules.PorticoRuntime as NativeRuntimeModule | undefined;
const nativePlayer = NativeModules.PorticoPlayerView as NativeRuntimeModule | undefined;
const nativeCleanup = NativeModules.PorticoCleanupQuarantine as NativeCleanupModule | undefined;

export function getAndroidRuntimeState(): AndroidRuntimeState {
  if (Platform.OS !== 'android') {
    return unavailableState(
      'PORTICO_ANDROID_RUNTIME_UNAVAILABLE',
      'Android runtime identity is unavailable on this platform.',
    );
  }
  const candidate = readRuntimeCandidate();
  if (candidate === undefined) {
    return unavailableState(
      'PORTICO_ANDROID_RUNTIME_UNAVAILABLE',
      'The Android native runtime descriptor is not published.',
    );
  }
  try {
    return parseAndroidRuntimeState(candidate);
  } catch (cause) {
    return errorState(
      'PORTICO_ANDROID_RUNTIME_INVALID',
      cause instanceof Error ? cause.message : 'The Android native runtime descriptor is invalid.',
    );
  }
}

export async function probeAndroidRuntimeState(): Promise<AndroidRuntimeState> {
  if (Platform.OS !== 'android') return getAndroidRuntimeState();
  const probe = nativeRuntime?.getRuntimeState ?? nativePlayer?.getRuntimeState;
  if (!probe) return getAndroidRuntimeState();
  try {
    return parseAndroidRuntimeState(await probe());
  } catch (cause) {
    return errorState(
      'PORTICO_ANDROID_RUNTIME_PROBE_FAILED',
      cause instanceof Error ? cause.message : 'The Android native runtime probe failed.',
    );
  }
}

export function parseAndroidRuntimeState(value: unknown): AndroidRuntimeState {
  if (!isRecord(value)) throw new AndroidPlaybackUnavailableError('The Android runtime state is malformed.');
  const status = value.status;
  if (status === 'unavailable' || status === 'error') {
    const error = parseError(value.error);
    return {
      status,
      capabilities: parseUnavailableCapabilities(value.capabilities, status),
      ...(error ? {error} : {}),
    };
  }
  if (status !== 'available') {
    throw new AndroidPlaybackUnavailableError('The Android runtime state has an invalid status.');
  }

  const identity = parseIdentity(value.identity);
  const descriptor = parseDescriptor(value.descriptor, identity);
  const capabilities = parseCapabilities(value.capabilities, identity);
  return {
    status,
    identity,
    descriptor,
    capabilities,
    ...(parseError(value.error) ? {error: parseError(value.error)} : {}),
  };
}

export function androidClientDescriptor(
  state: AndroidRuntimeState = getAndroidRuntimeState(),
): AndroidClientDescriptor {
  if (state.status !== 'available' || !state.descriptor) {
    throw new AndroidPlaybackUnavailableError(
      state.error?.message ?? 'Android client identity is unavailable.',
    );
  }
  return state.descriptor;
}

export function androidPlaybackClientProfile(
  state: AndroidRuntimeState = getAndroidRuntimeState(),
): PlaybackClientProfile {
  if (state.status !== 'available' || state.capabilities.status !== 'available' || !state.capabilities.profile) {
    throw new AndroidPlaybackUnavailableError(
      state.capabilities.error?.message ??
        state.error?.message ??
        'Android playback capabilities are unavailable.',
    );
  }
  return state.capabilities.profile;
}

export async function probeAndroidPlaybackClientProfile(): Promise<PlaybackClientProfile> {
  return androidPlaybackClientProfile(await probeAndroidRuntimeState());
}

export function androidPlaybackCapabilitiesFor(
  state: AndroidRuntimeState = getAndroidRuntimeState(),
): AndroidPlaybackCapabilities {
  const profile = state.status === 'available' && state.capabilities.status === 'available'
    ? state.capabilities.profile
    : undefined;
  const identity = state.identity;
  const runtime = identity?.runtime ?? descriptorRuntime(state.descriptor) ?? 'android';
  return {
    backgroundAudio: false,
    mediaFamily: 'video',
    nowPlaying: false,
    pictureInPictureEligible: false,
    remoteCommands: false,
    pictureInPictureActive: false,
    pictureInPicturePossible: false,
    pictureInPictureSupported: false,
    runtimeFamily: runtime,
    runtime,
    capabilityStatus: state.capabilities.status,
    availability: state.capabilities.status,
    ...(profile ? {clientProfile: profile} : {}),
    ...(state.capabilities.error ? {error: state.capabilities.error} : {}),
  };
}

function readRuntimeCandidate(): unknown {
  try {
    const constants = nativeRuntime?.getConstants?.();
    if (constants?.androidRuntimeState !== undefined) return constants.androidRuntimeState;
    if (nativeRuntime?.androidRuntimeState !== undefined) return nativeRuntime.androidRuntimeState;
    const playerConstants = nativePlayer?.getConstants?.();
    if (playerConstants?.androidRuntimeState !== undefined) return playerConstants.androidRuntimeState;
    return nativePlayer?.androidRuntimeState;
  } catch {
    return undefined;
  }
}

function parseIdentity(value: unknown): AndroidRuntimeIdentity {
  if (!isRecord(value)) throw new AndroidPlaybackUnavailableError('The Android runtime identity is missing.');
  const runtime = requiredRuntime(value.runtime);
  const formFactor = requiredFormFactor(value.formFactor);
  const nativePlatform = requiredNativePlatform(value.nativePlatform);
  if ((runtime === 'android' && formFactor !== 'mobile') || (runtime !== 'android' && formFactor !== 'television')) {
    throw new AndroidPlaybackUnavailableError('The Android runtime identity has an inconsistent form factor.');
  }
  return {
    runtime,
    formFactor,
    nativePlatform,
    deviceName: requiredString(value.deviceName, 'deviceName'),
    packageName: requiredString(value.packageName, 'packageName'),
    applicationId: requiredString(value.applicationId, 'applicationId'),
    appVersion: requiredString(value.appVersion, 'appVersion'),
    buildNumber: requiredString(value.buildNumber, 'buildNumber'),
    androidApiLevel: requiredPositiveInteger(value.androidApiLevel, 'androidApiLevel'),
    model: requiredString(value.model, 'model'),
    manufacturer: requiredString(value.manufacturer, 'manufacturer'),
    identitySource: value.identitySource === 'android-native-runtime'
      ? 'android-native-runtime'
      : invalidField('identitySource'),
  };
}

function parseDescriptor(value: unknown, identity: AndroidRuntimeIdentity): AndroidClientDescriptor {
  if (!isRecord(value) || value.version !== 1 || value.app !== 'Portico') {
    throw new AndroidPlaybackUnavailableError('The Android client descriptor is missing or unsupported.');
  }
  const os = requiredRuntime(value.os);
  const runtime = requiredRuntime(value.runtime);
  if (os !== identity.runtime || runtime !== identity.runtime) {
    throw new AndroidPlaybackUnavailableError('The Android client descriptor does not match runtime identity.');
  }
  if (value.identitySource !== 'android-native-runtime') {
    throw new AndroidPlaybackUnavailableError('The Android client descriptor has no native identity source.');
  }
  const capabilities = value.capabilities;
  if (!isRecord(capabilities) || !isRecord(capabilities.playback)) {
    throw new AndroidPlaybackUnavailableError('The Android client descriptor has no capability state.');
  }
  const playback = capabilities.playback;
  if (
    playback.version !== ANDROID_PLAYBACK_CAPABILITY_CONTRACT_VERSION ||
    playback.source !== 'native-runtime-required' ||
    (playback.family !== 'media3' && playback.family !== 'fire-tv') ||
    !isCapabilityStatus(playback.status)
  ) {
    throw new AndroidPlaybackUnavailableError('The Android client descriptor capability state is invalid.');
  }
  return {
    version: 1,
    app: 'Portico',
    os,
    runtime,
    formFactor: identity.formFactor,
    nativePlatform: identity.nativePlatform,
    deviceName: requiredString(value.deviceName, 'descriptor.deviceName'),
    packageName: requiredString(value.packageName, 'descriptor.packageName'),
    applicationId: requiredString(value.applicationId, 'descriptor.applicationId'),
    appVersion: requiredString(value.appVersion, 'descriptor.appVersion'),
    buildNumber: requiredString(value.buildNumber, 'descriptor.buildNumber'),
    identitySource: 'android-native-runtime',
    capabilities: {
      playback: {
        version: ANDROID_PLAYBACK_CAPABILITY_CONTRACT_VERSION,
        family: playback.family,
        source: 'native-runtime-required',
        status: playback.status,
      },
    },
  };
}

function parseCapabilities(value: unknown, identity: AndroidRuntimeIdentity): AndroidRuntimeCapabilities {
  if (!isRecord(value) || !isCapabilityStatus(value.status)) {
    throw new AndroidPlaybackUnavailableError('The Android runtime capability state is missing.');
  }
  const error = parseError(value.error);
  if (value.status !== 'available') {
    return {
      status: value.status,
      ...(error ? {error} : {}),
    };
  }
  if (!isPlaybackProfile(value.profile, identity)) {
    throw new AndroidPlaybackUnavailableError('The Android native playback profile is invalid.');
  }
  return {status: 'available', profile: value.profile};
}

function parseUnavailableCapabilities(value: unknown, status: AndroidRuntimeStatus): AndroidRuntimeCapabilities {
  if (!isRecord(value) || !isCapabilityStatus(value.status)) {
    return {
      status,
      error: {
        code: 'PORTICO_ANDROID_CAPABILITIES_UNAVAILABLE',
        message: 'Android capability state is unavailable.',
      },
    };
  }
  const error = parseError(value.error);
  return {
    status: value.status,
    ...(error ? {error} : {}),
  };
}

function isPlaybackProfile(value: unknown, identity: AndroidRuntimeIdentity): value is PlaybackClientProfile {
  if (!isRecord(value)) return false;
  const profile = value as Partial<PlaybackClientProfile>;
  const evidence = profile.capabilityEvidence;
  return (
    profile.capabilitySchemaVersion === ANDROID_PLAYBACK_CAPABILITY_CONTRACT_VERSION &&
    profile.clientFamily === (identity.runtime === 'fire_tv' ? 'fire-tv' : 'media3') &&
    profile.platform === identity.nativePlatform &&
    requiredNonEmptyArray(profile.supportedContainers) &&
    requiredNonEmptyArray(profile.supportedVideoCodecs) &&
    requiredNonEmptyArray(profile.supportedAudioCodecs) &&
    Array.isArray(profile.supportedVideoProfiles) &&
    Array.isArray(profile.supportedPixelFormats) &&
    Array.isArray(profile.supportedHdrFormats) &&
    Array.isArray(profile.supportedDolbyVisionProfiles) &&
    typeof profile.device === 'string' &&
    typeof profile.clientVersion === 'string' &&
    profile.supportsHls === true &&
    profile.supportsMse === false &&
    profile.supportsMpegTs === true &&
    profile.prefersServerProxy === true &&
    profile.requiresServerProxy === true &&
    typeof profile.maxWidth === 'number' &&
    typeof profile.maxHeight === 'number' &&
    typeof profile.maxAudioChannels === 'number' &&
    typeof profile.maxVideoBitDepth === 'number' &&
    typeof profile.supportsHevc === 'boolean' &&
    typeof profile.supportsHdr === 'boolean' &&
    typeof profile.supportsAc3 === 'boolean' &&
    typeof profile.supportsEac3 === 'boolean' &&
    Array.isArray(evidence) &&
    evidence.some(item =>
      isRecord(item) &&
      item.source === 'native_runtime' &&
      item.producer === 'portico-android-media3' &&
      typeof item.reviewedAt === 'string' &&
      Array.isArray(item.tuples),
    )
  );
}

function requiredRuntime(value: unknown): AndroidRuntimeFamily {
  if (value === 'android' || value === 'android_tv' || value === 'fire_tv') return value;
  return invalidField('runtime');
}

function requiredFormFactor(value: unknown): AndroidFormFactor {
  if (value === 'mobile' || value === 'television') return value;
  return invalidField('formFactor');
}

function requiredNativePlatform(value: unknown): AndroidNativePlatform {
  if (value === 'Android' || value === 'Android TV' || value === 'Fire TV') return value;
  return invalidField('nativePlatform');
}

function requiredString(value: unknown, field: string): string {
  if (typeof value !== 'string' || !value.trim() || value.length > 256 || /[\u0000\r\n]/.test(value)) {
    return invalidField(field);
  }
  return value.trim();
}

function requiredPositiveInteger(value: unknown, field: string): number {
  if (typeof value !== 'number' || !Number.isInteger(value) || value <= 0 || value > 1000) {
    return invalidField(field);
  }
  return value;
}

function requiredNonEmptyArray(value: unknown): value is string[] {
  return Array.isArray(value) && value.length > 0 && value.every(item => typeof item === 'string' && Boolean(item.trim()));
}

function parseError(value: unknown): AndroidRuntimeError | undefined {
  if (!isRecord(value) || typeof value.code !== 'string' || typeof value.message !== 'string') return undefined;
  if (!value.code.trim() || !value.message.trim() || value.code.length > 128 || value.message.length > 256) return undefined;
  return {code: value.code, message: value.message};
}

function isCapabilityStatus(value: unknown): value is AndroidRuntimeStatus {
  return value === 'available' || value === 'unavailable' || value === 'error';
}

function descriptorRuntime(value: AndroidClientDescriptor | undefined): AndroidRuntimeFamily | undefined {
  return value?.runtime;
}

function unavailableState(code: string, message: string): AndroidRuntimeState {
  const error = {code, message};
  return {status: 'unavailable', capabilities: {status: 'unavailable', error}, error};
}

function errorState(code: string, message: string): AndroidRuntimeState {
  const error = {code, message};
  return {status: 'error', capabilities: {status: 'error', error}, error};
}

function invalidField(field: string): never {
  throw new AndroidPlaybackUnavailableError('The Android runtime field ' + field + ' is invalid.');
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

export interface AndroidCleanupQuarantineState {
  status: AndroidRuntimeStatus;
  quarantined: boolean;
  generation?: string;
  completedGeneration?: string;
  error?: AndroidRuntimeError;
}

export class AndroidCleanupQuarantineError extends Error {
  readonly code: string;

  constructor(code: string, message: string) {
    super(message);
    this.name = 'AndroidCleanupQuarantineError';
    this.code = code;
  }
}

export async function getAndroidCleanupQuarantineState(): Promise<AndroidCleanupQuarantineState> {
  if (Platform.OS !== 'android' || !nativeCleanup) return unavailableCleanupState();
  try {
    return parseAndroidCleanupState(await nativeCleanup.getState());
  } catch (cause) {
    return cleanupFailureState(cause);
  }
}

export async function beginAndroidCleanupQuarantine(generation: string): Promise<AndroidCleanupQuarantineState> {
  return mutateAndroidCleanup('begin', generation);
}

export async function completeAndroidCleanupQuarantine(generation: string): Promise<AndroidCleanupQuarantineState> {
  return mutateAndroidCleanup('markCompleted', generation);
}

export async function releaseAndroidCleanupQuarantine(generation: string): Promise<AndroidCleanupQuarantineState> {
  return mutateAndroidCleanup('release', generation);
}

export function parseAndroidCleanupState(value: unknown): AndroidCleanupQuarantineState {
  if (!isRecord(value) || !isCapabilityStatus(value.status) || typeof value.quarantined !== 'boolean') {
    throw new AndroidCleanupQuarantineError(
      'PORTICO_ANDROID_CLEANUP_STORAGE_CORRUPT',
      'Android cleanup storage is corrupt.',
    );
  }
  if (value.status !== 'available') {
    const error = parseError(value.error);
    return {
      status: value.status,
      quarantined: true,
      ...(error ? {error} : {}),
    };
  }
  const generation = optionalGeneration(value.generation);
  const completedGeneration = optionalGeneration(value.completedGeneration);
  return {
    status: 'available',
    quarantined: value.quarantined,
    ...(generation ? {generation} : {}),
    ...(completedGeneration ? {completedGeneration} : {}),
  };
}

async function mutateAndroidCleanup(
  operation: 'begin' | 'markCompleted' | 'release',
  generation: string,
): Promise<AndroidCleanupQuarantineState> {
  const safeGeneration = optionalGeneration(generation);
  if (!safeGeneration) {
    throw new AndroidCleanupQuarantineError(
      'PORTICO_ANDROID_CLEANUP_STORAGE_CORRUPT',
      'Android cleanup generation is invalid.',
    );
  }
  if (Platform.OS !== 'android' || !nativeCleanup) {
    throw new AndroidCleanupQuarantineError(
      'PORTICO_ANDROID_CLEANUP_STORAGE_UNAVAILABLE',
      'Android cleanup storage is unavailable.',
    );
  }
  try {
    return parseAndroidCleanupState(await nativeCleanup[operation](safeGeneration));
  } catch (cause) {
    const failure = cleanupFailureState(cause);
    throw new AndroidCleanupQuarantineError(
      failure.error?.code ?? 'PORTICO_ANDROID_CLEANUP_STORAGE_UNAVAILABLE',
      failure.error?.message ?? 'Android cleanup storage is unavailable.',
    );
  }
}

function cleanupFailureState(cause: unknown): AndroidCleanupQuarantineState {
  const code = isRecord(cause) && typeof cause.code === 'string' && cause.code.includes('CORRUPT')
    ? 'PORTICO_ANDROID_CLEANUP_STORAGE_CORRUPT'
    : 'PORTICO_ANDROID_CLEANUP_STORAGE_UNAVAILABLE';
  return {
    status: code.endsWith('CORRUPT') ? 'error' : 'unavailable',
    quarantined: true,
    error: {
      code,
      message: code.endsWith('CORRUPT')
        ? 'Android cleanup storage is corrupt.'
        : 'Android cleanup storage is unavailable.',
    },
  };
}

function unavailableCleanupState(): AndroidCleanupQuarantineState {
  return {
    status: 'unavailable',
    quarantined: true,
    error: {
      code: 'PORTICO_ANDROID_CLEANUP_STORAGE_UNAVAILABLE',
      message: 'Android cleanup storage is unavailable.',
    },
  };
}

function optionalGeneration(value: unknown): string | undefined {
  if (typeof value !== 'string' || !value.trim() || value.length > 128 || /[\u0000\r\n]/.test(value)) return undefined;
  return value.trim();
}
