describe('Apple playback capability authority', () => {
  afterEach(() => {
    jest.resetModules();
  });

  test('fails closed when the native bridge has not published capability facts', () => {
    const capabilities = loadCapabilities(undefined);

    expect(() => capabilities.applePlaybackClientProfile('mobile')).toThrow(
      capabilities.ApplePlaybackCapabilitiesUnavailableError,
    );
  });

  test('canonicalizes native facts without inventing an Apple fallback', () => {
    const capabilities = loadCapabilities({
      device: 'Portico iPhone',
      platform: 'iOS',
      clientVersion: '18.6',
      observedAt: '2026-08-17T12:00:00.000Z',
      supportsHls: true,
      supportsMse: false,
      supportsMpegTs: true,
      supportedContainers: ['hls', 'mp4'],
      supportedVideoCodecs: ['h264'],
      supportedAudioCodecs: ['aac', 'mp3'],
      maxAudioChannels: 2,
      maxWidth: 1170,
      maxHeight: 2532,
      maxFrameRate: 60,
      maxVideoBitDepth: 8,
      supportsHevc: false,
      supportsHdr: false,
      supportsAc3: false,
      supportsEac3: false,
      supportedVideoProfiles: ['h264:high'],
      supportedPixelFormats: ['yuv420p'],
      supportedHdrFormats: [],
      supportedDolbyVisionProfiles: [],
      prefersServerProxy: true,
      requiresServerProxy: true,
    });

    const profile = capabilities.applePlaybackClientProfile('mobile');
    expect(profile).toMatchObject({
      capabilitySchemaVersion: 'playback-capability-v2',
      clientFamily: 'avkit',
      device: 'Portico iPhone',
      platform: 'ios',
      clientVersion: '18.6',
      supportsHevc: false,
      supportsHdr: false,
      maxWidth: 1170,
      maxHeight: 2532,
    });
    expect(profile.capabilityEvidence).toEqual([
      expect.objectContaining({
        source: 'native_runtime',
        producer: 'portico-apple-native',
        producerVersion: '18.6',
      }),
    ]);
  });

  test('rejects native facts from the wrong Apple form factor', () => {
    const capabilities = loadCapabilities({
      device: 'Portico Apple TV',
      platform: 'tvOS',
      clientVersion: '18.6',
      observedAt: '2026-08-17T12:00:00.000Z',
      supportedVideoCodecs: ['h264'],
      supportedAudioCodecs: ['aac'],
      supportedHdrFormats: [],
      supportedDolbyVisionProfiles: [],
      maxWidth: 1920,
      maxHeight: 1080,
      maxFrameRate: 60,
      maxAudioChannels: 2,
      supportsHevc: false,
      supportsAc3: false,
      supportsEac3: false,
    });

    expect(() => capabilities.applePlaybackClientProfile('mobile')).toThrow(
      'does not match the requested OS/form factor',
    );
  });
});

function loadCapabilities(nativeProfile: unknown) {
  jest.resetModules();
  jest.doMock('react-native', () => ({
    Platform: {OS: 'ios', isTV: false},
    UIManager: {
      getViewManagerConfig: () => nativeProfile === undefined
        ? undefined
        : {Constants: {applePlaybackProfile: nativeProfile}},
    },
  }));
  return require('./applePlaybackCapabilities') as typeof import('./applePlaybackCapabilities');
}
