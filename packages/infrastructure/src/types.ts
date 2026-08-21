import {NativeModules, Platform} from 'react-native';
import type {
  AuthMeResponse,
  CursorPageInfo,
  HostedProfileSelectionEnvelope,
  HostedServer,
  LocalServerSession,
  MediaItem,
  PlaybackClientProfile,
  PorticoNativeSessionResponse,
} from '@portico/client-core';
import {
  PORTICO_API_VERSION,
  PORTICO_FOUNDATION_COMPATIBILITY,
} from '@portico/client-core';

export type PorticoPlatform = 'mobile' | 'tv';
export type AuthenticationMode = 'portico-account' | 'local';

export const PORTICO_CLIENT_DESCRIPTOR_VERSION = 1 as const;
export const PORTICO_BUILD_CONTRACT_VERSION = 1 as const;
export const PORTICO_RUNTIME_DESCRIPTOR_VERSION = 1 as const;

/**
 * This is the only Hosted authority accepted by the React Native shell. The
 * native/build pipeline must inject it as `globalThis.__PORTICO_BUILD_CONTRACT__`
 * before the first Hosted operation. There is intentionally no source-level
 * production URL fallback.
 */
export const PORTICO_BUILD_CONTRACT_GLOBAL = '__PORTICO_BUILD_CONTRACT__' as const;
/**
 * Native/build authority for the immutable runtime identity. Android must
 * publish this before the infrastructure package is imported. Installed
 * Android builds use the single PorticoRuntime native authority; the global
 * form is only a build/bootstrap consistency check and test injection path.
 */
export const PORTICO_RUNTIME_DESCRIPTOR_GLOBAL = '__PORTICO_RUNTIME_DESCRIPTOR__' as const;
export const PORTICO_RUNTIME_DESCRIPTOR_NATIVE_MODULE = 'PorticoRuntime' as const;
/**
 * The single Android native registration exposes:
 * `NativeModules.PorticoRuntime.getConstants().androidRuntimeState`.
 */
export const PORTICO_RUNTIME_DESCRIPTOR_NATIVE_STATE_KEY = 'androidRuntimeState' as const;

export type PorticoBuildEnvironment =
  | 'development'
  | 'test'
  | 'staging'
  | 'production';

export type PorticoDistribution =
  | 'development'
  | 'simulator'
  | 'testflight'
  | 'app-store'
  | 'enterprise';

export type PorticoRuntimeIdentity =
  | 'ios'
  | 'tvos'
  | 'android'
  | 'android_tv'
  | 'fire_tv';
/** Kept as a source-compatible name for existing support-bundle consumers. */
export type PorticoOperatingSystem = PorticoRuntimeIdentity;
export type PorticoFormFactor = 'mobile' | 'television';
export type PorticoNativePlatform = 'iOS' | 'tvOS' | 'Android' | 'Android TV' | 'Fire TV';
export type PorticoRuntimePlaybackFamily = 'avkit' | 'media3' | 'fire-tv';
/** The generated RN type entrypoint exposes this discriminant even when it omits the value export. */
export type PorticoPlaybackCapabilityContractVersion = NonNullable<PlaybackClientProfile['capabilitySchemaVersion']>;
export const PORTICO_PLAYBACK_CAPABILITY_CONTRACT_VERSION = 'playback-capability-v2' as PorticoPlaybackCapabilityContractVersion;

export const PORTICO_PAGINATION_CONTRACT_VERSION = `cursor-pagination-v${PORTICO_FOUNDATION_COMPATIBILITY.semanticRevisions.paginationCursor}` as const;
export const PORTICO_PROFILE_SWITCH_CONTRACT_VERSION = `viewer-profile-authority-v${PORTICO_FOUNDATION_COMPATIBILITY.semanticRevisions.viewerProfileAuthority}` as const;

export interface PorticoBuildContract {
  readonly version: typeof PORTICO_BUILD_CONTRACT_VERSION;
  readonly apiVersion: typeof PORTICO_API_VERSION;
  readonly environment: PorticoBuildEnvironment;
  readonly distribution: PorticoDistribution;
  /** HTTPS origin only; paths, credentials, query strings, and fragments are rejected. */
  readonly hostedApiBaseUrl: string;
  readonly appVersion: string;
  readonly buildNumber: string;
  readonly commit: string;
}

export interface PorticoRuntimePlaybackDescriptor {
  readonly version: typeof PORTICO_PLAYBACK_CAPABILITY_CONTRACT_VERSION;
  readonly family: PorticoRuntimePlaybackFamily;
  readonly source: 'native-runtime-required';
  /** Required for Android, Android TV, and Fire TV; Apple keeps its existing native probe API. */
  readonly profile?: PlaybackClientProfile;
}

/**
 * Immutable runtime identity/capability authority supplied by the native
 * shell or build bootstrap. Form factor is deliberately separate from the
 * runtime so Android TV and Fire TV cannot inherit tvOS identity.
 */
export interface PorticoRuntimeDescriptor {
  readonly version: typeof PORTICO_RUNTIME_DESCRIPTOR_VERSION;
  readonly app: 'Portico';
  readonly runtime: PorticoRuntimeIdentity;
  readonly formFactor: PorticoFormFactor;
  readonly nativePlatform: PorticoNativePlatform;
  readonly deviceName: string;
  /** Android package identity. Apple may omit this while retaining its old test API. */
  readonly applicationId?: string;
  readonly capabilities: {
    readonly playback: PorticoRuntimePlaybackDescriptor;
  };
}

export interface PorticoClientDescriptor {
  readonly version: typeof PORTICO_CLIENT_DESCRIPTOR_VERSION;
  readonly app: 'Portico';
  /** Runtime identity, distinct from the mobile/television form factor. */
  readonly runtime: PorticoRuntimeIdentity;
  readonly os: PorticoOperatingSystem;
  readonly formFactor: PorticoFormFactor;
  readonly nativePlatform: PorticoNativePlatform;
  readonly deviceName: string;
  readonly applicationId?: string;
  readonly environment: PorticoBuildEnvironment;
  readonly distribution: PorticoDistribution;
  readonly appVersion: string;
  readonly buildNumber: string;
  readonly commit: string;
  readonly capabilities: {
    readonly playback: {
      readonly version: typeof PORTICO_PLAYBACK_CAPABILITY_CONTRACT_VERSION;
      readonly family: PorticoRuntimePlaybackFamily;
      readonly source: 'native-runtime-required';
      readonly profile?: PlaybackClientProfile;
    };
    readonly pagination: {
      readonly version: typeof PORTICO_PAGINATION_CONTRACT_VERSION;
      readonly mode: 'cursor';
    };
    readonly profileSwitch: {
      readonly version: typeof PORTICO_PROFILE_SWITCH_CONTRACT_VERSION;
      readonly authority: 'hosted-signed-selection-envelope';
    };
  };
}

export class PorticoBuildContractError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'PorticoBuildContractError';
  }
}

export class PorticoRuntimeDescriptorError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'PorticoRuntimeDescriptorError';
  }
}

/** Reads and validates the explicit JS/build authority for this shell. */
export function getPorticoBuildContract(): PorticoBuildContract {
  const candidate = (globalThis as typeof globalThis & {
    [PORTICO_BUILD_CONTRACT_GLOBAL]?: unknown;
  })[PORTICO_BUILD_CONTRACT_GLOBAL];
  return parsePorticoBuildContract(candidate);
}

export function parsePorticoBuildContract(value: unknown): PorticoBuildContract {
  if (!isRecord(value)) {
    throw new PorticoBuildContractError(
      'The Portico build contract is missing; Hosted authority is not configured.',
    );
  }
  if (value.version !== PORTICO_BUILD_CONTRACT_VERSION) {
    throw new PorticoBuildContractError('The Portico build contract version is unsupported.');
  }
  if (value.apiVersion !== PORTICO_API_VERSION) {
    throw new PorticoBuildContractError('The Portico build contract API version is unsupported.');
  }
  if (!isBuildEnvironment(value.environment)) {
    throw new PorticoBuildContractError('The Portico build contract environment is invalid.');
  }
  if (!isDistribution(value.distribution)) {
    throw new PorticoBuildContractError('The Portico build contract distribution is invalid.');
  }
  const hostedApiBaseUrl = parseHostedApiOrigin(value.hostedApiBaseUrl);
  const appVersion = boundedBuildString(value.appVersion, 'appVersion');
  const buildNumber = boundedBuildString(value.buildNumber, 'buildNumber');
  const commit = boundedBuildString(value.commit, 'commit');
  return Object.freeze({
    version: PORTICO_BUILD_CONTRACT_VERSION,
    apiVersion: PORTICO_API_VERSION,
    environment: value.environment,
    distribution: value.distribution,
    hostedApiBaseUrl,
    appVersion,
    buildNumber,
    commit,
  });
}

/** Reads the validated native/build runtime authority for this React Native shell. */
export function getPorticoRuntimeDescriptor(
  platform?: PorticoPlatform,
): PorticoRuntimeDescriptor {
  const injected = readInjectedRuntimeDescriptor();
  if (injected !== undefined) {
    const descriptor = parsePorticoRuntimeDescriptor(injected);
    assertRuntimeDescriptorMatchesShell(descriptor, platform);
    return descriptor;
  }

  // Existing Apple tests and the Apple shell retain their public form-factor
  // API. Android is intentionally different: missing native identity or
  // capability facts are terminal and never become an Apple descriptor.
  if (Platform.OS === 'ios') {
    return appleRuntimeDescriptor(platform ?? (Platform.isTV ? 'tv' : 'mobile'));
  }
  if (Platform.OS === 'android') {
    throw new PorticoRuntimeDescriptorError(
      'The Android runtime descriptor is missing; Hosted authority is not configured.',
    );
  }
  throw new PorticoRuntimeDescriptorError(
    `The Portico runtime descriptor is unavailable on ${String(Platform.OS)}.`,
  );
}

export function parsePorticoRuntimeDescriptor(
  value: unknown,
): PorticoRuntimeDescriptor {
  if (!isRecord(value)) {
    throw new PorticoRuntimeDescriptorError(
      'The Portico runtime descriptor is missing; runtime authority is not configured.',
    );
  }
  if (value.version !== PORTICO_RUNTIME_DESCRIPTOR_VERSION) {
    throw new PorticoRuntimeDescriptorError(
      'The Portico runtime descriptor version is unsupported.',
    );
  }
  if (value.app !== 'Portico') {
    throw new PorticoRuntimeDescriptorError(
      'The Portico runtime descriptor app identity is invalid.',
    );
  }
  if (!isPorticoRuntimeIdentity(value.runtime)) {
    throw new PorticoRuntimeDescriptorError(
      'The Portico runtime descriptor runtime identity is invalid.',
    );
  }
  if (!isFormFactor(value.formFactor)) {
    throw new PorticoRuntimeDescriptorError(
      'The Portico runtime descriptor form factor is invalid.',
    );
  }
  const runtime = value.runtime;
  const formFactor = value.formFactor;
  const nativePlatform = value.nativePlatform;
  const expected = runtimeFacts(runtime);
  if (formFactor !== expected.formFactor) {
    throw new PorticoRuntimeDescriptorError(
      'The Portico runtime descriptor form factor does not match its runtime identity.',
    );
  }
  if (!isNativePlatform(nativePlatform) || nativePlatform !== expected.nativePlatform) {
    throw new PorticoRuntimeDescriptorError(
      'The Portico runtime descriptor native platform does not match its runtime identity.',
    );
  }
  const deviceName = boundedRuntimeString(value.deviceName, 'deviceName');
  const applicationId = value.applicationId === undefined
    ? undefined
    : boundedRuntimeString(value.applicationId, 'applicationId');
  if (isAndroidRuntime(runtime)) {
    if (!applicationId) {
      throw new PorticoRuntimeDescriptorError(
        'The Android runtime descriptor application identity is missing.',
      );
    }
    if (/apple|iphone|ipad|ios|tvos/i.test(deviceName)) {
      throw new PorticoRuntimeDescriptorError(
        'The Android runtime descriptor contains an Apple device identity.',
      );
    }
  }
  if (!isRecord(value.capabilities) || !isRecord(value.capabilities.playback)) {
    throw new PorticoRuntimeDescriptorError(
      'The Portico runtime descriptor playback capability facts are missing.',
    );
  }
  const playback = value.capabilities.playback;
  if (
    playback.version !== PORTICO_PLAYBACK_CAPABILITY_CONTRACT_VERSION ||
    playback.source !== 'native-runtime-required' ||
    !isRuntimePlaybackFamily(playback.family) ||
    playback.family !== expected.playbackFamily
  ) {
    throw new PorticoRuntimeDescriptorError(
      'The Portico runtime descriptor playback capability identity is mismatched.',
    );
  }
  const playbackFamily = playback.family;
  const profile = playback.profile;
  if (isAndroidRuntime(runtime)) {
    if (!isNativeRuntimePlaybackProfile(profile, runtime, deviceName)) {
      throw new PorticoRuntimeDescriptorError(
        'The Android runtime descriptor is missing validated native playback capability facts.',
      );
    }
  } else if (profile !== undefined && !isNativeRuntimePlaybackProfile(profile, runtime, deviceName)) {
    throw new PorticoRuntimeDescriptorError(
      'The Apple runtime descriptor playback capability identity is invalid.',
    );
  }
  return Object.freeze({
    version: PORTICO_RUNTIME_DESCRIPTOR_VERSION,
    app: 'Portico',
    runtime,
    formFactor,
    nativePlatform,
    deviceName,
    ...(applicationId ? {applicationId} : {}),
    capabilities: {
      playback: {
        version: PORTICO_PLAYBACK_CAPABILITY_CONTRACT_VERSION,
        family: playbackFamily,
        source: 'native-runtime-required' as const,
        ...(profile ? {profile} : {}),
      },
    },
  });
}

export function porticoClientDescriptor(
  platform: PorticoPlatform,
  buildContract = getPorticoBuildContract(),
  runtimeDescriptor = getPorticoRuntimeDescriptor(platform),
): PorticoClientDescriptor {
  const validatedRuntimeDescriptor = parsePorticoRuntimeDescriptor(runtimeDescriptor);
  assertRuntimeDescriptorMatchesShell(validatedRuntimeDescriptor, platform);
  return Object.freeze({
    version: PORTICO_CLIENT_DESCRIPTOR_VERSION,
    app: 'Portico',
    runtime: validatedRuntimeDescriptor.runtime,
    os: validatedRuntimeDescriptor.runtime,
    formFactor: validatedRuntimeDescriptor.formFactor,
    nativePlatform: validatedRuntimeDescriptor.nativePlatform,
    deviceName: validatedRuntimeDescriptor.deviceName,
    ...(validatedRuntimeDescriptor.applicationId
      ? {applicationId: validatedRuntimeDescriptor.applicationId}
      : {}),
    environment: buildContract.environment,
    distribution: buildContract.distribution,
    appVersion: buildContract.appVersion,
    buildNumber: buildContract.buildNumber,
    commit: buildContract.commit,
    capabilities: {
      playback: {
        version: PORTICO_PLAYBACK_CAPABILITY_CONTRACT_VERSION,
        family: validatedRuntimeDescriptor.capabilities.playback.family,
        source: 'native-runtime-required',
        ...(validatedRuntimeDescriptor.capabilities.playback.profile
          ? {profile: validatedRuntimeDescriptor.capabilities.playback.profile}
          : {}),
      },
      pagination: {
        version: PORTICO_PAGINATION_CONTRACT_VERSION,
        mode: 'cursor',
      },
      profileSwitch: {
        version: PORTICO_PROFILE_SWITCH_CONTRACT_VERSION,
        authority: 'hosted-signed-selection-envelope',
      },
    } as const,
  });
}

/** Enforces the generated cursor-page shape before a caller follows a continuation. */
export function assertPorticoCursorPageInfo(value: unknown): CursorPageInfo {
  if (!isRecord(value) || typeof value.hasMore !== 'boolean') {
    throw new Error('The cursor pagination contract is missing pageInfo.');
  }
  if (typeof value.nextCursor !== 'string' && value.nextCursor !== null) {
    throw new Error('The cursor pagination contract returned an invalid continuation.');
  }
  if (typeof value.nextCursor === 'string' && !value.nextCursor.trim()) {
    throw new Error('The cursor pagination contract returned an empty continuation.');
  }
  if (value.hasMore && value.nextCursor === null) {
    throw new Error('The cursor pagination contract marked a page incomplete without a continuation.');
  }
  if (!value.hasMore && value.nextCursor !== null) {
    throw new Error('The cursor pagination contract returned a continuation after the final page.');
  }
  if (
    value.total !== undefined &&
    (typeof value.total !== 'number' || !Number.isInteger(value.total) || value.total < 0)
  ) {
    throw new Error('The cursor pagination contract returned an invalid total.');
  }
  return value as CursorPageInfo;
}

/**
 * Validates the generated Hosted profile-switch envelope at the JS boundary so
 * a profile switch cannot silently consume an unversioned or mismatched proof.
 */
export function assertPorticoProfileSelectionEnvelope(
  value: unknown,
  expected: {accountId: string; serverId: string; profileId: string},
  now = Date.now(),
): asserts value is HostedProfileSelectionEnvelope {
  if (!isRecord(value)) throw new Error('The profile selection contract is malformed.');
  if (
    value.version !== 'v1' ||
    value.audience !== 'portico-media-server' ||
    value.signatureAlgorithm !== 'ed25519'
  ) {
    throw new Error('The profile selection contract version or authority is unsupported.');
  }
  if (
    value.accountId !== expected.accountId ||
    value.serverId !== expected.serverId ||
    value.profileId !== expected.profileId
  ) {
    throw new Error('The profile selection contract identity does not match the requested viewer.');
  }
  if (
    !boundedContractString(value.assertionId) ||
    !boundedContractString(value.deviceId) ||
    !boundedContractString(value.signature) ||
    !boundedContractString(value.signatureKeyId) ||
    !Array.isArray(value.profiles) ||
    typeof value.accountRevision !== 'number' ||
    !Number.isInteger(value.accountRevision) ||
    value.accountRevision < 0 ||
    typeof value.pinRevision !== 'number' ||
    !Number.isInteger(value.pinRevision) ||
    value.pinRevision < 0
  ) {
    throw new Error('The profile selection contract contains invalid proof fields.');
  }
  const issuedAt = Date.parse(String(value.issuedAt));
  const expiresAt = Date.parse(String(value.expiresAt));
  if (!Number.isFinite(issuedAt) || !Number.isFinite(expiresAt) || expiresAt <= issuedAt || expiresAt <= now) {
    throw new Error('The profile selection contract is expired or has invalid timestamps.');
  }
}

function parseHostedApiOrigin(value: unknown): string {
  if (typeof value !== 'string' || !value.trim()) {
    throw new PorticoBuildContractError('The Hosted API authority is missing.');
  }
  let url: {
    protocol: string;
    hostname: string;
    username: string;
    password: string;
    pathname: string;
    search: string;
    hash: string;
    origin: string;
  };
  try {
    const URLConstructor = globalThis.URL as unknown as {
      new (input: string): typeof url;
    };
    url = new URLConstructor(value);
  } catch {
    throw new PorticoBuildContractError('The Hosted API authority is not a valid URL origin.');
  }
  if (
    url.protocol !== 'https:' ||
    !url.hostname ||
    url.username ||
    url.password ||
    url.pathname !== '/' ||
    url.search ||
    url.hash
  ) {
    throw new PorticoBuildContractError('The Hosted API authority must be an HTTPS origin without credentials or a path.');
  }
  return url.origin;
}

function boundedBuildString(value: unknown, field: string): string {
  if (typeof value !== 'string' || !value.trim() || value.length > 128 || /\s/.test(value)) {
    throw new PorticoBuildContractError(`The Portico build contract ${field} is invalid.`);
  }
  return value;
}

function boundedContractString(value: unknown): value is string {
  return typeof value === 'string' && value.length > 0 && value.length <= 512 && value === value.trim();
}

function isBuildEnvironment(value: unknown): value is PorticoBuildEnvironment {
  return value === 'development' || value === 'test' || value === 'staging' || value === 'production';
}

function isDistribution(value: unknown): value is PorticoDistribution {
  return value === 'development' || value === 'simulator' || value === 'testflight' || value === 'app-store' || value === 'enterprise';
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function readInjectedRuntimeDescriptor(): PorticoRuntimeDescriptor | undefined {
  const globalCandidate = (globalThis as typeof globalThis & {
    [PORTICO_RUNTIME_DESCRIPTOR_GLOBAL]?: unknown;
  })[PORTICO_RUNTIME_DESCRIPTOR_GLOBAL];
  const nativeCandidate = readNativeRuntimeDescriptor();
  const candidates = [globalCandidate, nativeCandidate].filter(
    (candidate): candidate is unknown => candidate !== undefined,
  );
  if (!candidates.length) return undefined;

  const descriptors = candidates.map(parsePorticoRuntimeDescriptor);
  const authorityKey = runtimeDescriptorAuthorityKey(descriptors[0]!);
  if (descriptors.some(descriptor => runtimeDescriptorAuthorityKey(descriptor) !== authorityKey)) {
    throw new PorticoRuntimeDescriptorError(
      'The native and build-injected runtime descriptors disagree.',
    );
  }
  return descriptors[0];
}

/**
 * Reads the one registered Android authority and adapts its validated state
 * into the shared descriptor shape. An Apple-shaped state is rejected below;
 * it is never interpreted as the Apple test fallback.
 */
function readNativeRuntimeDescriptor(): unknown {
  const nativeModule = (NativeModules as unknown as Record<string, {
    getConstants?: () => unknown;
  } | undefined>)[PORTICO_RUNTIME_DESCRIPTOR_NATIVE_MODULE];
  if (!nativeModule) return undefined;

  let state: unknown;
  try {
    const constants = nativeModule.getConstants?.();
    state = isRecord(constants)
      ? constants[PORTICO_RUNTIME_DESCRIPTOR_NATIVE_STATE_KEY]
      : undefined;
  } catch {
    throw new PorticoRuntimeDescriptorError(
      'The Android PorticoRuntime state could not be read.',
    );
  }
  if (!isRecord(state) || state.status !== 'available') {
    throw new PorticoRuntimeDescriptorError(
      'The Android PorticoRuntime descriptor is unavailable.',
    );
  }
  if (!isRecord(state.descriptor) || !isRecord(state.capabilities)) {
    throw new PorticoRuntimeDescriptorError(
      'The Android PorticoRuntime state is missing its descriptor or capabilities.',
    );
  }
  const descriptor = state.descriptor;
  if (!isPorticoRuntimeIdentity(descriptor.runtime) || !isAndroidRuntime(descriptor.runtime)) {
    throw new PorticoRuntimeDescriptorError(
      'The Android PorticoRuntime descriptor must carry an Android runtime identity.',
    );
  }
  if (descriptor.os !== undefined && descriptor.os !== descriptor.runtime) {
    throw new PorticoRuntimeDescriptorError(
      'The Android PorticoRuntime descriptor OS does not match its runtime identity.',
    );
  }
  if (state.capabilities.status !== 'available' || !state.capabilities.profile) {
    throw new PorticoRuntimeDescriptorError(
      'The Android PorticoRuntime state is missing available native playback capability facts.',
    );
  }
  if (!isRecord(descriptor.capabilities) || !isRecord(descriptor.capabilities.playback)) {
    throw new PorticoRuntimeDescriptorError(
      'The Android PorticoRuntime descriptor is missing playback capability identity.',
    );
  }
  const playback = descriptor.capabilities.playback;
  if (playback.status !== 'available') {
    throw new PorticoRuntimeDescriptorError(
      'The Android PorticoRuntime descriptor playback capability is unavailable.',
    );
  }
  const identity = state.identity;
  if (identity !== undefined) {
    if (!isRecord(identity) || identity.runtime !== descriptor.runtime) {
      throw new PorticoRuntimeDescriptorError(
        'The Android PorticoRuntime identity does not match its descriptor.',
      );
    }
    for (const field of ['formFactor', 'nativePlatform', 'deviceName'] as const) {
      if (identity[field] !== descriptor[field]) {
        throw new PorticoRuntimeDescriptorError(
          'The Android PorticoRuntime identity does not match its descriptor.',
        );
      }
    }
    if (
      identity.packageName !== undefined &&
      identity.packageName !== descriptor.packageName
    ) {
      throw new PorticoRuntimeDescriptorError(
        'The Android PorticoRuntime identity does not match its descriptor.',
      );
    }
  }
  return {
    version: descriptor.version,
    app: descriptor.app,
    runtime: descriptor.runtime,
    formFactor: descriptor.formFactor,
    nativePlatform: descriptor.nativePlatform,
    deviceName: descriptor.deviceName,
    applicationId: descriptor.applicationId ?? descriptor.packageName,
    capabilities: {
      playback: {
        version: playback.version,
        family: playback.family,
        source: playback.source,
        profile: state.capabilities.profile,
      },
    },
  };
}

function assertRuntimeDescriptorMatchesShell(
  descriptor: PorticoRuntimeDescriptor,
  platform?: PorticoPlatform,
): void {
  const expectedFormFactor = platform === undefined
    ? undefined
    : platform === 'tv' ? 'television' : 'mobile';
  if (expectedFormFactor && descriptor.formFactor !== expectedFormFactor) {
    throw new PorticoRuntimeDescriptorError(
      'The requested Portico form factor does not match the runtime descriptor.',
    );
  }
  if (Platform.OS === 'android' && !isAndroidRuntime(descriptor.runtime)) {
    throw new PorticoRuntimeDescriptorError(
      'The Android shell received a non-Android runtime descriptor.',
    );
  }
  if (Platform.OS === 'ios' && !isAppleRuntime(descriptor.runtime)) {
    throw new PorticoRuntimeDescriptorError(
      'The Apple shell received a non-Apple runtime descriptor.',
    );
  }
  if (
    Platform.OS === 'android' &&
    typeof Platform.isTV === 'boolean' &&
    descriptor.formFactor !== (Platform.isTV ? 'television' : 'mobile')
  ) {
    throw new PorticoRuntimeDescriptorError(
      'The Android runtime descriptor does not match the native TV/mobile shell.',
    );
  }
  if (
    Platform.OS === 'ios' &&
    platform === undefined &&
    typeof Platform.isTV === 'boolean' &&
    descriptor.formFactor !== (Platform.isTV ? 'television' : 'mobile')
  ) {
    throw new PorticoRuntimeDescriptorError(
      'The Apple runtime descriptor does not match the native TV/mobile shell.',
    );
  }
}

function appleRuntimeDescriptor(platform: PorticoPlatform): PorticoRuntimeDescriptor {
  const television = platform === 'tv';
  return {
    version: PORTICO_RUNTIME_DESCRIPTOR_VERSION,
    app: 'Portico',
    runtime: television ? 'tvos' : 'ios',
    formFactor: television ? 'television' : 'mobile',
    nativePlatform: television ? 'tvOS' : 'iOS',
    deviceName: television ? 'Portico Apple TV' : 'Portico iPhone',
    capabilities: {
      playback: {
        version: PORTICO_PLAYBACK_CAPABILITY_CONTRACT_VERSION,
        family: 'avkit',
        source: 'native-runtime-required',
      },
    },
  };
}

function runtimeFacts(runtime: PorticoRuntimeIdentity): {
  formFactor: PorticoFormFactor;
  nativePlatform: PorticoNativePlatform;
  playbackFamily: PorticoRuntimePlaybackFamily;
  playbackPlatforms: readonly string[];
} {
  switch (runtime) {
    case 'ios':
      return {
        formFactor: 'mobile',
        nativePlatform: 'iOS',
        playbackFamily: 'avkit',
        playbackPlatforms: ['ios', 'iOS'],
      };
    case 'tvos':
      return {
        formFactor: 'television',
        nativePlatform: 'tvOS',
        playbackFamily: 'avkit',
        playbackPlatforms: ['tvos', 'tvOS'],
      };
    case 'android':
      return {
        formFactor: 'mobile',
        nativePlatform: 'Android',
        playbackFamily: 'media3',
        playbackPlatforms: ['android', 'Android'],
      };
    case 'android_tv':
      return {
        formFactor: 'television',
        nativePlatform: 'Android TV',
        playbackFamily: 'media3',
        playbackPlatforms: ['android-tv', 'android_tv', 'Android TV'],
      };
    case 'fire_tv':
      return {
        formFactor: 'television',
        nativePlatform: 'Fire TV',
        playbackFamily: 'fire-tv',
        playbackPlatforms: ['fireos', 'fire-tv', 'fire_tv', 'Fire TV'],
      };
  }
}

function runtimeDescriptorAuthorityKey(
  descriptor: PorticoRuntimeDescriptor,
): string {
  return JSON.stringify({
    runtime: descriptor.runtime,
    formFactor: descriptor.formFactor,
    nativePlatform: descriptor.nativePlatform,
    deviceName: descriptor.deviceName,
    applicationId: descriptor.applicationId,
    playback: descriptor.capabilities.playback,
  });
}

function isPorticoRuntimeIdentity(value: unknown): value is PorticoRuntimeIdentity {
  return value === 'ios' || value === 'tvos' || value === 'android' || value === 'android_tv' || value === 'fire_tv';
}

function isFormFactor(value: unknown): value is PorticoFormFactor {
  return value === 'mobile' || value === 'television';
}

function isNativePlatform(value: unknown): value is PorticoNativePlatform {
  return value === 'iOS' || value === 'tvOS' || value === 'Android' || value === 'Android TV' || value === 'Fire TV';
}

function isRuntimePlaybackFamily(value: unknown): value is PorticoRuntimePlaybackFamily {
  return value === 'avkit' || value === 'media3' || value === 'fire-tv';
}

function isAppleRuntime(value: PorticoRuntimeIdentity): value is 'ios' | 'tvos' {
  return value === 'ios' || value === 'tvos';
}

function isAndroidRuntime(
  value: PorticoRuntimeIdentity,
): value is 'android' | 'android_tv' | 'fire_tv' {
  return value === 'android' || value === 'android_tv' || value === 'fire_tv';
}

function boundedRuntimeString(value: unknown, field: string): string {
  if (typeof value !== 'string' || !value.trim() || value.length > 256 || value !== value.trim()) {
    throw new PorticoRuntimeDescriptorError(
      `The Portico runtime descriptor ${field} is invalid.`,
    );
  }
  return value;
}

function isNativeRuntimePlaybackProfile(
  value: unknown,
  runtime: PorticoRuntimeIdentity,
  descriptorDeviceName?: string,
): value is PlaybackClientProfile {
  if (!isRecord(value)) return false;
  const expected = runtimeFacts(runtime);
  const profile = value as Partial<PlaybackClientProfile>;
  const evidence = profile.capabilityEvidence;
  const hasNativeEvidence = Array.isArray(evidence) && evidence.some(item =>
    isRecord(item) &&
    item.source === 'native_runtime' &&
    typeof item.id === 'string' &&
    Boolean(item.id.trim()) &&
    typeof item.producer === 'string' &&
    Boolean(item.producer.trim()) &&
    typeof item.reviewedAt === 'string' &&
    Number.isFinite(Date.parse(item.reviewedAt)) &&
    Array.isArray(item.tuples) &&
    item.tuples.length > 0,
  );
  const requiredStringArrays = [
    profile.supportedContainers,
    profile.supportedVideoCodecs,
    profile.supportedAudioCodecs,
    profile.supportedVideoProfiles,
    profile.supportedPixelFormats,
  ];
  const optionalStringArrays = [
    profile.supportedHdrFormats,
    profile.supportedDolbyVisionProfiles,
  ];
  const requiredBooleans = [
    profile.supportsHls,
    profile.supportsMse,
    profile.supportsMpegTs,
    profile.supportsHevc,
    profile.supportsHdr,
    profile.supportsAc3,
    profile.supportsEac3,
    profile.prefersServerProxy,
    profile.requiresServerProxy,
  ];
  return (
    profile.capabilitySchemaVersion === PORTICO_PLAYBACK_CAPABILITY_CONTRACT_VERSION &&
    profile.clientFamily === expected.playbackFamily &&
    typeof profile.clientVersion === 'string' &&
    Boolean(profile.clientVersion.trim()) &&
    expected.playbackPlatforms.includes(String(profile.platform)) &&
    typeof profile.device === 'string' &&
    Boolean(profile.device.trim()) &&
    (descriptorDeviceName === undefined || profile.device === descriptorDeviceName) &&
    (!isAndroidRuntime(runtime) || !/apple|iphone|ipad|ios|tvos/i.test(`${profile.device} ${String(profile.platform)}`))
  ) && (
    hasNativeEvidence &&
    requiredStringArrays.every(entry =>
      Array.isArray(entry) &&
      entry.length > 0 &&
      entry.every(item => typeof item === 'string' && Boolean(item.trim())),
    ) &&
    optionalStringArrays.every(entry =>
      Array.isArray(entry) &&
      entry.every(item => typeof item === 'string' && Boolean(item.trim())),
    ) &&
    requiredBooleans.every(entry => typeof entry === 'boolean') &&
    typeof profile.maxWidth === 'number' && Number.isFinite(profile.maxWidth) && profile.maxWidth > 0 &&
    typeof profile.maxHeight === 'number' && Number.isFinite(profile.maxHeight) && profile.maxHeight > 0 &&
    typeof profile.maxAudioChannels === 'number' && Number.isFinite(profile.maxAudioChannels) && profile.maxAudioChannels > 0 &&
    typeof profile.maxVideoBitDepth === 'number' && Number.isFinite(profile.maxVideoBitDepth) && profile.maxVideoBitDepth > 0
  );
}

/**
 * The complete Hosted account credential family, persisted as one Keychain
 * record. Nearby TV setup intentionally returns only the account identity
 * needed by the client, rather than duplicating the Hosted device record and
 * every preference in its encrypted grant. A later Hosted refresh replaces
 * that compact snapshot with the complete API response.
 */
export interface HostedAccountSession {
  accessToken: string;
  accessExpiresAt: string;
  refreshToken: string;
  refreshExpiresAt: string;
  tokenType: string;
  user: Pick<PorticoNativeSessionResponse['user'], 'id' | 'username' | 'email'>
    & Partial<Omit<PorticoNativeSessionResponse['user'], 'id' | 'username' | 'email'>>;
  device?: PorticoNativeSessionResponse['device'];
}

export interface AuthenticatedRuntime {
  mode: AuthenticationMode;
  server: HostedServer | {id?: string; name: string};
  serverSession: LocalServerSession;
  identity: AuthMeResponse;
}

export interface MediaViewModel {
  id: string;
  type: string;
  title: string;
  subtitle?: string;
  summary?: string;
  year?: number;
  durationSeconds?: number;
  poster?: string;
  backdrop?: string;
  progress?: number;
  raw: MediaItem;
}
