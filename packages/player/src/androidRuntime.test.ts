export {};
declare function require(id: string): unknown;

type NativeModuleMap = Record<string, unknown>;

function loadRuntime(platformOS: string, nativeModules: NativeModuleMap = {}) {
  jest.resetModules();
  jest.doMock('react-native', () => ({
    NativeModules: nativeModules,
    Platform: {OS: platformOS, isTV: platformOS === 'android'},
  }));
  return require('./androidRuntime') as typeof import('./androidRuntime');
}

function validState(runtime: 'android' | 'android_tv' | 'fire_tv' = 'android') {
  const television = runtime !== 'android';
  const nativePlatform = runtime === 'fire_tv' ? 'Fire TV' : television ? 'Android TV' : 'Android';
  const family = runtime === 'fire_tv' ? 'fire-tv' : 'media3';
  const profile = {
    capabilitySchemaVersion: 'playback-capability-v2',
    clientFamily: family,
    clientVersion: '1.0.0',
    device: 'Portico Android',
    platform: nativePlatform,
    supportsHls: true,
    supportsMse: false,
    supportsMpegTs: true,
    supportedContainers: ['hls', 'mpegts', 'mp4'],
    supportedVideoCodecs: ['h264'],
    supportedAudioCodecs: ['aac'],
    supportedVideoProfiles: ['h264:baseline'],
    supportedPixelFormats: ['yuv420p'],
    supportedHdrFormats: [],
    supportedDolbyVisionProfiles: [],
    maxWidth: 1920,
    maxHeight: 1080,
    maxFrameRate: 30,
    maxAudioChannels: 2,
    maxVideoBitDepth: 8,
    supportsHevc: false,
    supportsHdr: false,
    supportsAc3: false,
    supportsEac3: false,
    prefersServerProxy: true,
    requiresServerProxy: true,
    capabilityEvidence: [{
      id: 'android-media3-runtime',
      source: 'native_runtime',
      producer: 'portico-android-media3',
      reviewedAt: new Date().toISOString(),
      tuples: [{}],
    }],
  };
  return {
    status: 'available',
    identity: {
      runtime,
      formFactor: television ? 'television' : 'mobile',
      nativePlatform,
      deviceName: 'Portico Android',
      packageName: 'tv.getportico.android',
      applicationId: 'tv.getportico.android',
      appVersion: '1.0.0',
      buildNumber: '1',
      androidApiLevel: 35,
      model: 'Test device',
      manufacturer: 'Test',
      identitySource: 'android-native-runtime',
    },
    descriptor: {
      version: 1,
      app: 'Portico',
      os: runtime,
      runtime,
      formFactor: television ? 'television' : 'mobile',
      nativePlatform,
      deviceName: 'Portico Android',
      packageName: 'tv.getportico.android',
      applicationId: 'tv.getportico.android',
      appVersion: '1.0.0',
      buildNumber: '1',
      identitySource: 'android-native-runtime',
      capabilities: {
        playback: {
          version: 'playback-capability-v2',
          family,
          source: 'native-runtime-required',
          status: 'available',
        },
      },
    },
    capabilities: {status: 'available', profile},
  };
}

describe('Android runtime contract', () => {
  it('fails closed without an Android native descriptor and never returns an Apple identity', () => {
    const runtime = loadRuntime('android');
    const state = runtime.getAndroidRuntimeState();
    expect(state.status).toBe('unavailable');
    expect(() => runtime.androidClientDescriptor(state)).toThrow(runtime.AndroidPlaybackUnavailableError);
    expect(JSON.stringify(state)).not.toMatch(/ios|tvos|iOS|tvOS/);
  });

  it('rejects malformed native state instead of filling model-derived defaults', () => {
    const runtime = loadRuntime('android', {
      PorticoRuntime: {androidRuntimeState: {status: 'available', identity: {runtime: 'android'}}},
    });
    const state = runtime.getAndroidRuntimeState();
    expect(state.status).toBe('error');
    expect(state.capabilities.status).toBe('error');
    expect(() => runtime.androidPlaybackClientProfile(state)).toThrow(runtime.AndroidPlaybackUnavailableError);
  });

  it('parses Android TV and Fire TV runtime descriptors independently of shared Apple types', () => {
    const runtime = loadRuntime('android', {
      PorticoRuntime: {androidRuntimeState: validState('android_tv')},
    });
    const state = runtime.getAndroidRuntimeState();
    expect(state.status).toBe('available');
    expect(runtime.androidClientDescriptor(state).os).toBe('android_tv');
    expect(runtime.androidPlaybackClientProfile(state).clientFamily).toBe('media3');
    expect(runtime.androidPlaybackCapabilitiesFor(state).pictureInPictureEligible).toBe(false);
    expect(JSON.stringify(runtime.androidClientDescriptor(state))).not.toMatch(/ios|tvos|iOS|tvOS/);
  });

  it('matches Dalton shared runtime authority through PorticoRuntime constants', () => {
    loadRuntime('android', {
      PorticoRuntime: {
        getConstants: () => ({androidRuntimeState: validState('android_tv')}),
      },
    });
    const sharedTypes = require('../../infrastructure/src/types') as typeof import('../../infrastructure/src/types');
    const descriptor = sharedTypes.getPorticoRuntimeDescriptor('tv');
    expect(descriptor).toMatchObject({
      runtime: 'android_tv',
      formFactor: 'television',
      nativePlatform: 'Android TV',
      applicationId: 'tv.getportico.android',
      capabilities: {playback: {family: 'media3'}},
    });
  });
});

describe('Android device-protected cleanup contract', () => {
  it('reports unavailable and quarantined when the native store is absent', async () => {
    const runtime = loadRuntime('android');
    await expect(runtime.getAndroidCleanupQuarantineState()).resolves.toMatchObject({
      status: 'unavailable',
      quarantined: true,
    });
    await expect(runtime.beginAndroidCleanupQuarantine('generation-1')).rejects.toMatchObject({
      code: 'PORTICO_ANDROID_CLEANUP_STORAGE_UNAVAILABLE',
    });
  });

  it('fails closed for corrupt native state and rejects mutations', async () => {
    const runtime = loadRuntime('android', {
      PorticoCleanupQuarantine: {
        getState: jest.fn().mockResolvedValue({status: 'available', quarantined: 'yes'}),
        begin: jest.fn(),
        markCompleted: jest.fn(),
        release: jest.fn(),
      },
    });
    await expect(runtime.getAndroidCleanupQuarantineState()).resolves.toMatchObject({
      status: 'error',
      quarantined: true,
    });
    await expect(runtime.completeAndroidCleanupQuarantine('generation-1')).rejects.toMatchObject({
      code: 'PORTICO_ANDROID_CLEANUP_STORAGE_CORRUPT',
    });
  });
});
