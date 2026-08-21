import {
  PORTICO_PAGINATION_CONTRACT_VERSION,
  PORTICO_PROFILE_SWITCH_CONTRACT_VERSION,
  assertPorticoCursorPageInfo,
  assertPorticoProfileSelectionEnvelope,
  getPorticoBuildContract,
  parsePorticoBuildContract,
  parsePorticoRuntimeDescriptor,
  porticoClientDescriptor,
  type PorticoBuildContract,
  type PorticoRuntimeIdentity,
} from './types';

const buildContract: PorticoBuildContract = {
  version: 1,
  apiVersion: 'v1',
  environment: 'test',
  distribution: 'simulator',
  hostedApiBaseUrl: 'https://hosted.test',
  appVersion: '0.1.0-test',
  buildNumber: '42',
  commit: 'test-commit',
};

test('requires an explicit Hosted build authority and emits a complete Apple descriptor', () => {
  expect(parsePorticoBuildContract(buildContract)).toEqual(buildContract);

  const descriptor = porticoClientDescriptor('tv', buildContract);
  expect(descriptor).toMatchObject({
    version: 1,
    os: 'tvos',
    runtime: 'tvos',
    formFactor: 'television',
    nativePlatform: 'tvOS',
    distribution: 'simulator',
    environment: 'test',
    appVersion: '0.1.0-test',
    buildNumber: '42',
    capabilities: {
      playback: {version: 'playback-capability-v2', source: 'native-runtime-required'},
      pagination: {version: PORTICO_PAGINATION_CONTRACT_VERSION, mode: 'cursor'},
      profileSwitch: {
        version: PORTICO_PROFILE_SWITCH_CONTRACT_VERSION,
        authority: 'hosted-signed-selection-envelope',
      },
    },
  });
});

test.each([
  ['ios', 'mobile', 'iOS', 'avkit', 'Portico iPhone'],
  ['tvos', 'television', 'tvOS', 'avkit', 'Portico Apple TV'],
  ['android', 'mobile', 'Android', 'media3', 'Portico Android'],
  ['android_tv', 'television', 'Android TV', 'media3', 'Portico Android TV'],
  ['fire_tv', 'television', 'Fire TV', 'fire-tv', 'Portico Fire TV'],
] as const)('validates the explicit %s runtime identity and capability family', (
  runtime,
  formFactor,
  nativePlatform,
  family,
  deviceName,
) => {
  const descriptor = parsePorticoRuntimeDescriptor(runtimeDescriptor({
    runtime,
    formFactor,
    nativePlatform,
    family,
    deviceName,
  }));

  expect(descriptor).toMatchObject({
    runtime,
    formFactor,
    nativePlatform,
    deviceName,
    capabilities: {playback: {family}},
  });
  if (runtime === 'android' || runtime === 'android_tv' || runtime === 'fire_tv') {
    expect(descriptor.applicationId).toBeTruthy();
    expect(descriptor.capabilities.playback.profile).toMatchObject({
      capabilitySchemaVersion: 'playback-capability-v2',
      clientFamily: family,
    });
  }
});

test('fails closed when Android identity or native capability facts are missing or mismatched', () => {
  const android = runtimeDescriptor({
    runtime: 'android',
    formFactor: 'mobile',
    nativePlatform: 'Android',
    family: 'media3',
    deviceName: 'Portico Android',
  });

  expect(() => parsePorticoRuntimeDescriptor({
    ...android,
    applicationId: undefined,
  })).toThrow('application identity is missing');
  expect(() => parsePorticoRuntimeDescriptor({
    ...android,
    capabilities: {
      playback: {
        version: 'playback-capability-v2',
        family: 'media3',
        source: 'native-runtime-required',
      },
    },
  })).toThrow('native playback capability facts');
  expect(() => parsePorticoRuntimeDescriptor({
    ...android,
    nativePlatform: 'iOS',
  })).toThrow('native platform does not match');
  expect(() => parsePorticoRuntimeDescriptor({
    ...android,
    deviceName: 'Portico Apple iPhone',
  })).toThrow('Apple device identity');
  expect(() => parsePorticoRuntimeDescriptor({
    ...android,
    capabilities: {
      playback: {
        ...android.capabilities.playback,
        profile: {
          ...android.capabilities.playback.profile!,
          supportedAudioCodecs: [],
        },
      },
    },
  })).toThrow('native playback capability facts');
  expect(() => parsePorticoRuntimeDescriptor({
    ...android,
    capabilities: {
      playback: {
        ...android.capabilities.playback,
        profile: {
          ...android.capabilities.playback.profile!,
          device: 'Portico Different Android',
        },
      },
    },
  })).toThrow('native playback capability facts');
});

test('fails closed on Android when no runtime descriptor is published', () => {
  withAndroidTypes({}, types => {
    expect(() => types.getPorticoRuntimeDescriptor('mobile')).toThrow(
      'Android runtime descriptor is missing',
    );
    expect(() => types.porticoClientDescriptor('mobile', buildContract)).toThrow(
      'Android runtime descriptor is missing',
    );
  });
});

test('adapts PorticoRuntime androidRuntimeState without Apple fallback', () => {
  const state = androidRuntimeState();
  withAndroidTypes({
    PorticoRuntime: {
      getConstants: () => ({androidRuntimeState: state}),
    },
  }, types => {
    expect(types.PORTICO_RUNTIME_DESCRIPTOR_NATIVE_MODULE).toBe('PorticoRuntime');
    expect(types.PORTICO_RUNTIME_DESCRIPTOR_NATIVE_STATE_KEY).toBe('androidRuntimeState');
    const runtime = types.getPorticoRuntimeDescriptor('mobile');
    expect(runtime).toMatchObject({
      runtime: 'android',
      formFactor: 'mobile',
      nativePlatform: 'Android',
      applicationId: 'tv.getportico.android',
      capabilities: {playback: {family: 'media3'}},
    });
    const descriptor = types.porticoClientDescriptor('mobile', buildContract);
    expect(descriptor).toMatchObject({
      runtime: 'android',
      os: 'android',
      nativePlatform: 'Android',
      deviceName: 'Portico Android',
      capabilities: {playback: {family: 'media3'}},
    });
    expect(descriptor.os).not.toBe('ios');
    expect(descriptor.nativePlatform).not.toBe('iOS');
  });
});

test('rejects an Apple identity published through the Android PorticoRuntime adapter', () => {
  const state = androidRuntimeState();
  const appleState = {
    ...state,
    identity: {
      ...state.identity,
      runtime: 'ios',
      nativePlatform: 'iOS',
      deviceName: 'Portico iPhone',
    },
    descriptor: {
      ...state.descriptor,
      os: 'ios',
      runtime: 'ios',
      nativePlatform: 'iOS',
      deviceName: 'Portico iPhone',
    },
  };
  withAndroidTypes({
    PorticoRuntime: {
      getConstants: () => ({androidRuntimeState: appleState}),
    },
  }, types => {
    expect(() => types.getPorticoRuntimeDescriptor('mobile')).toThrow(
      'must carry an Android runtime identity',
    );
  });
});

test('rejects a missing, non-origin, or non-HTTPS Hosted authority', () => {
  expect(() => parsePorticoBuildContract(undefined)).toThrow('build contract is missing');
  expect(() => parsePorticoBuildContract({...buildContract, hostedApiBaseUrl: 'https://hosted.test/api'})).toThrow('HTTPS origin');
  expect(() => parsePorticoBuildContract({...buildContract, hostedApiBaseUrl: 'http://hosted.test'})).toThrow('HTTPS origin');
});

test('reads only the explicit build-contract global and fails closed when it is absent', () => {
  const globalObject = globalThis as typeof globalThis & {
    __PORTICO_BUILD_CONTRACT__?: unknown;
  };
  const previous = globalObject.__PORTICO_BUILD_CONTRACT__;
  try {
    delete globalObject.__PORTICO_BUILD_CONTRACT__;
    expect(() => getPorticoBuildContract()).toThrow('build contract is missing');
    globalObject.__PORTICO_BUILD_CONTRACT__ = buildContract;
    expect(getPorticoBuildContract()).toEqual(buildContract);
  } finally {
    if (previous === undefined) delete globalObject.__PORTICO_BUILD_CONTRACT__;
    else globalObject.__PORTICO_BUILD_CONTRACT__ = previous;
  }
});

test('requires generated cursor pagination semantics instead of accepting a silent first page', () => {
  expect(assertPorticoCursorPageInfo({hasMore: true, nextCursor: 'opaque-2'})).toMatchObject({hasMore: true});
  expect(() => assertPorticoCursorPageInfo({hasMore: true, nextCursor: null})).toThrow('without a continuation');
  expect(() => assertPorticoCursorPageInfo({hasMore: false, nextCursor: 'opaque-2'})).toThrow('after the final page');
  expect(() => assertPorticoCursorPageInfo({hasMore: false})).toThrow('invalid continuation');
});

test('consumes only the versioned, identity-bound Hosted profile selection envelope', () => {
  const envelope = {
    accountId: 'account-1',
    accountRevision: 4,
    assertionId: 'assertion-1',
    audience: 'portico-media-server',
    deviceId: 'device-1',
    expiresAt: '2999-01-01T00:00:00.000Z',
    issuedAt: '2026-01-01T00:00:00.000Z',
    pinRevision: 2,
    profileId: 'profile-1',
    profiles: [],
    serverId: 'server-1',
    signature: 'signature',
    signatureAlgorithm: 'ed25519',
    signatureKeyId: 'key-1',
    version: 'v1',
  } as const;

  expect(() => assertPorticoProfileSelectionEnvelope(
    envelope,
    {accountId: 'account-1', serverId: 'server-1', profileId: 'profile-1'},
    Date.parse('2026-08-01T00:00:00.000Z'),
  )).not.toThrow();
  expect(() => assertPorticoProfileSelectionEnvelope(
    {...envelope, version: 'v2'},
    {accountId: 'account-1', serverId: 'server-1', profileId: 'profile-1'},
    Date.parse('2026-08-01T00:00:00.000Z'),
  )).toThrow('version or authority');
});

function runtimeDescriptor(options: {
  runtime: PorticoRuntimeIdentity;
  formFactor: 'mobile' | 'television';
  nativePlatform: 'iOS' | 'tvOS' | 'Android' | 'Android TV' | 'Fire TV';
  family: 'avkit' | 'media3' | 'fire-tv';
  deviceName: string;
}) {
  const android = options.runtime === 'android' || options.runtime === 'android_tv' || options.runtime === 'fire_tv';
  const profilePlatform = options.runtime === 'android'
    ? 'android'
    : options.runtime === 'android_tv'
      ? 'android-tv'
      : options.runtime === 'fire_tv'
        ? 'fireos'
        : options.runtime;
  return {
    version: 1 as const,
    app: 'Portico' as const,
    runtime: options.runtime,
    formFactor: options.formFactor,
    nativePlatform: options.nativePlatform,
    deviceName: options.deviceName,
    ...(android ? {applicationId: `tv.getportico.${options.runtime}`} : {}),
    capabilities: {
      playback: {
        version: 'playback-capability-v2' as const,
        family: options.family,
        source: 'native-runtime-required' as const,
        ...(android && options.family !== 'avkit'
          ? {profile: playbackProfile(options.family, profilePlatform, options.deviceName)}
          : {}),
      },
    },
  };
}

function playbackProfile(
  family: 'media3' | 'fire-tv',
  platform: string,
  device: string,
) {
  return {
    capabilitySchemaVersion: 'playback-capability-v2' as const,
    clientFamily: family,
    clientVersion: '1.0.0',
    capabilityEvidence: [{
      id: `test-${platform}`,
      source: 'native_runtime' as const,
      confidence: 'high' as const,
      producer: 'portico-test-native',
      reviewedAt: '2026-08-17T12:00:00.000Z',
      tuples: [{
        mediaKind: 'audiovisual' as const,
        protocol: 'hls' as const,
        container: 'mpegts',
        video: {codec: 'h264', bitDepth: 8, maxWidth: 1920, maxHeight: 1080, maxFrameRate: 60},
        audio: {codec: 'aac', maxChannels: 2},
        subtitle: {mode: 'native' as const},
      }],
    }],
    device,
    platform,
    supportsHls: true,
    supportsMse: false,
    supportsMpegTs: true,
    supportedContainers: ['hls', 'mpegts'],
    supportedVideoCodecs: ['h264'],
    supportedAudioCodecs: ['aac'],
    supportedVideoProfiles: ['h264:high'],
    supportedPixelFormats: ['yuv420p'],
    supportedHdrFormats: [],
    supportedDolbyVisionProfiles: [],
    maxWidth: 1920,
    maxHeight: 1080,
    maxAudioChannels: 2,
    maxVideoBitDepth: 8,
    supportsHevc: false,
    supportsHdr: false,
    supportsAc3: false,
    supportsEac3: false,
    prefersServerProxy: true,
    requiresServerProxy: true,
  };
}

function androidRuntimeState() {
  const descriptor = runtimeDescriptor({
    runtime: 'android',
    formFactor: 'mobile',
    nativePlatform: 'Android',
    family: 'media3',
    deviceName: 'Portico Android',
  });
  const profile = descriptor.capabilities.playback.profile!;
  return {
    status: 'available' as const,
    identity: {
      runtime: 'android' as const,
      formFactor: 'mobile' as const,
      nativePlatform: 'Android' as const,
      deviceName: 'Portico Android',
      packageName: 'tv.getportico.android',
    },
    descriptor: {
      version: 1 as const,
      app: 'Portico' as const,
      os: 'android' as const,
      runtime: 'android' as const,
      formFactor: 'mobile' as const,
      nativePlatform: 'Android' as const,
      deviceName: 'Portico Android',
      packageName: 'tv.getportico.android',
      appVersion: '0.1.0-test',
      buildNumber: '42',
      identitySource: 'android-native-runtime' as const,
      capabilities: {
        playback: {
          version: 'playback-capability-v2' as const,
          family: 'media3' as const,
          source: 'native-runtime-required' as const,
          status: 'available' as const,
        },
      },
    },
    capabilities: {
      status: 'available' as const,
      profile,
    },
  };
}

function withAndroidTypes<T>(
  nativeModules: Record<string, unknown>,
  callback: (types: typeof import('./types')) => T,
): T {
  jest.resetModules();
  jest.doMock('react-native', () => ({
    NativeModules: nativeModules,
    Platform: {OS: 'android', isTV: false},
  }));
  try {
    const types = require('./types') as typeof import('./types');
    return callback(types);
  } finally {
    jest.dontMock('react-native');
    jest.resetModules();
  }
}
