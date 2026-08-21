import {NativeModules, Platform, UIManager} from 'react-native';
import {createCastBootstrap, googleCastContentType, handoffPlaybackTarget, isTrustedInsecureHost, playbackClientProfileForTarget, playbackIntentForApplePreferences, preferredPlaybackSelection, shouldAttemptNativePlaybackRecovery, startRoutedPlayback, validatePlaybackResponse} from './playback';

function appleNativePlaybackFacts(television: boolean) {
  return {
    device: television ? 'Portico Apple TV' : 'Portico iPhone',
    platform: television ? 'tvOS' : 'iOS',
    clientVersion: '18.6',
    observedAt: '2026-08-17T12:00:00.000Z',
    supportsHls: true,
    supportsMse: false,
    supportsMpegTs: true,
    supportedContainers: ['hls', 'mp4'],
    supportedVideoCodecs: ['h264'],
    supportedAudioCodecs: ['aac', 'mp3'],
    maxAudioChannels: 2,
    maxWidth: television ? 3840 : 1170,
    maxHeight: television ? 2160 : 2532,
    maxFrameRate: 60,
    maxVideoBitDepth: television ? 10 : 8,
    supportsHevc: false,
    supportsHdr: television,
    supportsAc3: television,
    supportsEac3: television,
    supportedVideoProfiles: ['h264:high'],
    supportedPixelFormats: ['yuv420p'],
    supportedHdrFormats: television ? ['hdr10'] : [],
    supportedDolbyVisionProfiles: [],
    prefersServerProxy: true,
    requiresServerProxy: true,
  };
}

Object.defineProperty(Platform, 'isTV', {
  configurable: true,
  writable: true,
  value: false,
});
Object.defineProperty(UIManager, 'getViewManagerConfig', {
  configurable: true,
  writable: true,
  value: () => ({
    Constants: {
      applePlaybackProfile: appleNativePlaybackFacts(Platform.isTV === true),
    },
  }),
});

const runtimeAuthorityGlobal = globalThis as typeof globalThis & {
  __PORTICO_RUNTIME_DESCRIPTOR__?: unknown;
};

function nativePlaybackProfile(runtime: 'android' | 'android_tv' | 'fire_tv') {
  const isFireTv = runtime === 'fire_tv';
  return {
    capabilitySchemaVersion: 'playback-capability-v2',
    clientFamily: isFireTv ? 'fire-tv' : 'media3',
    clientVersion: 'native-runtime-test',
    device: 'Portico Android Runtime',
    platform: isFireTv ? 'Fire TV' : runtime === 'android_tv' ? 'Android TV' : 'Android',
    supportsHls: true,
    supportsMse: false,
    supportsMpegTs: true,
    supportedContainers: ['hls', 'mp4', 'mpegts'],
    supportedVideoCodecs: ['h264', 'hevc'],
    supportedAudioCodecs: ['aac', 'eac3'],
    supportedVideoProfiles: ['h264:high', 'hevc:main'],
    supportedPixelFormats: ['yuv420p'],
    supportedHdrFormats: ['hdr10'],
    supportedDolbyVisionProfiles: [],
    maxWidth: 3840,
    maxHeight: 2160,
    maxAudioChannels: 6,
    maxVideoBitDepth: 10,
    supportsHevc: true,
    supportsHdr: true,
    supportsAc3: true,
    supportsEac3: true,
    prefersServerProxy: false,
    requiresServerProxy: false,
    capabilityEvidence: [{
      id: 'android-media3-runtime-test',
      source: 'native_runtime',
      producer: 'portico-android-media3-test',
      reviewedAt: '2026-08-17T00:00:00.000Z',
      tuples: [{codec: 'hevc'}],
    }],
  };
}

function nativeRuntimeDescriptor(
  runtime: 'android' | 'android_tv' | 'fire_tv',
  profile?: unknown,
) {
  const isTelevision = runtime !== 'android';
  return {
    version: 1,
    app: 'Portico',
    runtime,
    formFactor: isTelevision ? 'television' : 'mobile',
    nativePlatform: runtime === 'fire_tv' ? 'Fire TV' : isTelevision ? 'Android TV' : 'Android',
    deviceName: 'Portico Android Runtime',
    applicationId: 'tv.getportico.android',
    capabilities: {
      playback: {
        version: 'playback-capability-v2',
        family: runtime === 'fire_tv' ? 'fire-tv' : 'media3',
        source: 'native-runtime-required',
        ...(profile === undefined ? {} : {profile}),
      },
    },
  };
}

function withAndroidRuntimeDescriptor<T>(
  descriptor: unknown,
  callback: () => T,
): T {
  const previousDescriptor = runtimeAuthorityGlobal.__PORTICO_RUNTIME_DESCRIPTOR__;
  const hadDescriptor = Object.prototype.hasOwnProperty.call(
    runtimeAuthorityGlobal,
    '__PORTICO_RUNTIME_DESCRIPTOR__',
  );
  const previousOs = Platform.OS;
  const previousIsTv = Platform.isTV;
  const runtimeNativeModules = NativeModules as typeof NativeModules & {
    PorticoRuntime?: unknown;
  };
  const previousRuntimeModule = runtimeNativeModules.PorticoRuntime;
  runtimeAuthorityGlobal.__PORTICO_RUNTIME_DESCRIPTOR__ = descriptor;
  Object.defineProperty(Platform, 'OS', {configurable: true, value: 'android'});
  Object.defineProperty(Platform, 'isTV', {configurable: true, value: descriptor && (descriptor as {formFactor?: string}).formFactor === 'television'});
  delete runtimeNativeModules.PorticoRuntime;
  try {
    return callback();
  } finally {
    if (hadDescriptor) runtimeAuthorityGlobal.__PORTICO_RUNTIME_DESCRIPTOR__ = previousDescriptor;
    else delete runtimeAuthorityGlobal.__PORTICO_RUNTIME_DESCRIPTOR__;
    Object.defineProperty(Platform, 'OS', {configurable: true, value: previousOs});
    Object.defineProperty(Platform, 'isTV', {configurable: true, value: previousIsTv});
    if (previousRuntimeModule === undefined) delete runtimeNativeModules.PorticoRuntime;
    else runtimeNativeModules.PorticoRuntime = previousRuntimeModule;
  }
}

function withAppleRuntime<T>(
  platform: 'mobile' | 'tv',
  callback: () => T,
): T {
  const previousOs = Platform.OS;
  const previousIsTv = Platform.isTV;
  Object.defineProperty(Platform, 'OS', {configurable: true, value: 'ios'});
  Object.defineProperty(Platform, 'isTV', {
    configurable: true,
    writable: true,
    value: platform === 'tv',
  });
  try {
    return callback();
  } finally {
    Object.defineProperty(Platform, 'OS', {configurable: true, value: previousOs});
    Object.defineProperty(Platform, 'isTV', {
      configurable: true,
      writable: true,
      value: previousIsTv,
    });
  }
}

const playback = {
  sessionId: 'session',
  nextEventSequence: 1,
  playbackRevision: 2,
  continuationCredential: {token: 'ptc_pc_test', expiresAt: '2099-01-01T00:00:00.000Z', origin: 'https://portico.test', generation: 0},
  mediaGrant: {token: 'ptc_mg_test', expiresAt: '2099-01-01T00:00:00.000Z'},
  media: {id: 'media-1', type: 'movie'},
  sourceUrl: '/api/media/media-1/stream',
  resources: [{id: 'resource-1', sourceUrl: '/api/media/media-1/stream', streamFormat: 'mp4'}],
  directPlay: true,
  isLive: false,
  decision: {},
  policy: {},
  qualities: [],
  audioStreams: [],
  subtitleStreams: [],
  chapters: [],
  queue: [],
  repeatMode: 'off',
  queueRevision: 0,
  timeline: {type: 'vod'},
  generation: 0,
};

describe('startRoutedPlayback', () => {
  const playback = {
    sessionId: 'session',
    nextEventSequence: 1,
    playbackRevision: 2,
    continuationCredential: {token: 'ptc_pc_test', expiresAt: '2099-01-01T00:00:00.000Z', origin: 'https://portico.test', generation: 0},
    mediaGrant: {token: 'ptc_mg_test', expiresAt: '2099-01-01T00:00:00.000Z'},
    media: {id: 'media-1', type: 'movie'},
    sourceUrl: '/api/media/media-1/stream',
    resources: [{id: 'resource-1', sourceUrl: '/api/media/media-1/stream', streamFormat: 'mp4'}],
    directPlay: true,
    isLive: false,
    decision: {},
    policy: {},
    qualities: [],
    audioStreams: [],
    subtitleStreams: [],
    chapters: [],
    queue: [],
    repeatMode: 'off',
    queueRevision: 0,
    timeline: {type: 'vod'},
    generation: 0,
  };

  test('uses the DVR playback contract for completed recordings', async () => {
    const client = {
      playDvrRecording: jest.fn().mockResolvedValue(playback),
      startLiveTvPlayback: jest.fn(),
      startPlayback: jest.fn(),
    };

    await expect(startRoutedPlayback(client as never, 'recording-7', 'dvr', 42)).resolves.toBe(playback);
    expect(client.playDvrRecording).toHaveBeenCalledWith('recording-7', expect.objectContaining({
      startSeconds: 42,
      clientProfile: expect.objectContaining({platform: 'ios'}),
    }));
    expect(client.startPlayback).not.toHaveBeenCalled();
  });

  test('keeps live channels and ordinary media on their own contracts', async () => {
    const client = {
      playDvrRecording: jest.fn(),
      startLiveTvPlayback: jest.fn().mockResolvedValue(playback),
      startPlayback: jest.fn().mockResolvedValue(playback),
    };

    await startRoutedPlayback(client as never, 'channel-3', 'live');
    await startRoutedPlayback(client as never, 'movie-4', 'media', 9);
    await startRoutedPlayback(client as never, 'movie-5', 'media', undefined, 'version-4k');

    expect(client.startLiveTvPlayback).toHaveBeenCalledWith('channel-3', expect.objectContaining({clientProfile: expect.objectContaining({platform: 'ios'})}));
    expect(client.startPlayback).toHaveBeenCalledWith('movie-4', expect.objectContaining({startSeconds: 9}));
    expect(client.startPlayback).toHaveBeenCalledWith('movie-5', expect.objectContaining({versionId: 'version-4k'}));
    expect(client.playDvrRecording).not.toHaveBeenCalled();
  });

  test('tunes a Library Channel through the linear channel contract', async () => {
    const client = {tuneLibraryChannel: jest.fn().mockResolvedValue({playback})};
    await expect(startRoutedPlayback(client as never, 'library-channel-2', 'library-channel')).resolves.toBe(playback);
    expect(client.tuneLibraryChannel).toHaveBeenCalledWith('library-channel-2', expect.objectContaining({clientProfile: expect.objectContaining({platform: 'ios'})}));
  });

  test('forwards cancellation to every routed playback contract', async () => {
    const controller = new AbortController();
    const client = {
      playDvrRecording: jest.fn().mockResolvedValue(playback),
      startLiveTvPlayback: jest.fn().mockResolvedValue(playback),
      startPlayback: jest.fn().mockResolvedValue(playback),
      tuneLibraryChannel: jest.fn().mockResolvedValue({playback}),
    };

    await startRoutedPlayback(client as never, 'channel-1', 'live', undefined, undefined, {signal: controller.signal});
    await startRoutedPlayback(client as never, 'recording-1', 'dvr', undefined, undefined, {signal: controller.signal});
    await startRoutedPlayback(client as never, 'library-1', 'library-channel', undefined, undefined, {signal: controller.signal});
    await startRoutedPlayback(client as never, 'movie-1', 'media', undefined, undefined, {signal: controller.signal});

    expect(client.startLiveTvPlayback).toHaveBeenCalledWith('channel-1', expect.objectContaining({clientProfile: expect.objectContaining({platform: 'ios'})}), {signal: controller.signal});
    expect(client.playDvrRecording).toHaveBeenCalledWith('recording-1', expect.objectContaining({clientProfile: expect.objectContaining({platform: 'ios'})}), {signal: controller.signal});
    expect(client.tuneLibraryChannel).toHaveBeenCalledWith('library-1', expect.objectContaining({clientProfile: expect.objectContaining({platform: 'ios'})}), {signal: controller.signal});
    expect(client.startPlayback).toHaveBeenCalledWith('movie-1', expect.any(Object), {signal: controller.signal});
  });

  test('normalizes a nullable library-channel signal without changing P06 request policy or signal identity', async () => {
    const controller = new AbortController();
    const init = {
      signal: controller.signal,
      timeoutMs: 12_000,
      deadlineAt: 1_900_000_000_000,
      retryBudget: 0,
      operationClass: 'interactive mutation' as const,
    };
    const client = {
      tuneLibraryChannel: jest.fn().mockResolvedValue({playback}),
    };

    await startRoutedPlayback(client as never, 'library-2', 'library-channel', undefined, undefined, init);

    const requestInit = client.tuneLibraryChannel.mock.calls[0][2];
    expect(requestInit.signal).toBe(controller.signal);
    expect(requestInit).toMatchObject({
      timeoutMs: 12_000,
      deadlineAt: 1_900_000_000_000,
      retryBudget: 0,
      operationClass: 'interactive mutation',
    });
  });

  test('converts an explicitly null library-channel signal to the Fetch-compatible undefined value', async () => {
    const client = {
      tuneLibraryChannel: jest.fn().mockResolvedValue({playback}),
    };

    await startRoutedPlayback(client as never, 'library-3', 'library-channel', undefined, undefined, {signal: null});

    expect(client.tuneLibraryChannel.mock.calls[0][2]).toEqual({signal: undefined});
  });
});

describe('shouldAttemptNativePlaybackRecovery', () => {
  test('permits exactly one transparent recovery for a native source', () => {
    expect(shouldAttemptNativePlaybackRecovery(0)).toBe(true);
    expect(shouldAttemptNativePlaybackRecovery(1)).toBe(false);
    expect(shouldAttemptNativePlaybackRecovery(2)).toBe(false);
    expect(shouldAttemptNativePlaybackRecovery(-1)).toBe(false);
  });
});

describe('validatePlaybackResponse', () => {
  const valid = {
    sessionId: 'session',
    nextEventSequence: 1,
    mediaGrant: {token: 'ptc_mg_test', expiresAt: '2099-01-01T00:00:00.000Z'},
    media: {id: 'media-1', type: 'movie'},
    sourceUrl: '/api/media/media-1/stream',
    resources: [{id: 'resource-1', sourceUrl: '/api/media/media-1/stream', streamFormat: 'mp4'}],
    directPlay: true,
    decision: {},
    policy: {},
    isLive: false,
    timeline: {type: 'vod'},
    audioStreams: [{id: 'audio-1'}],
    subtitleStreams: [{id: 'sub-1'}],
    chapters: [],
    qualities: [{id: 'original'}],
    selectedAudioStreamId: 'audio-1',
    selectedSubtitleStreamId: 'sub-1',
    selectedQualityId: 'original',
    queue: [],
    repeatMode: 'off',
    queueRevision: 0,
    generation: 0,
    playbackRevision: 2,
    continuationCredential: {
      token: 'ptc_pc_test',
      expiresAt: '2099-01-01T00:00:00.000Z',
      origin: 'https://portico.test',
      generation: 0,
    },
  };

  test('accepts a complete clean response and rejects credential-bearing resources', () => {
    expect(validatePlaybackResponse(valid as never)).toBe(valid);
    expect(() =>
      validatePlaybackResponse({
        ...valid,
        sourceUrl: '/api/media/media-1/stream?media_grant=leak',
        resources: [{...valid.resources[0], sourceUrl: '/api/media/media-1/stream?media_grant=leak'}],
      } as never),
    ).toThrow('unsafe media URL');
  });

  test('rejects selected streams that are not in the response collections', () => {
    expect(() =>
      validatePlaybackResponse({...valid, selectedAudioStreamId: 'missing'} as never),
    ).toThrow('audio stream');
  });

  test('requires the continuation origin to remain selected and rejects public insecure origins', () => {
    expect(validatePlaybackResponse(valid as never, {serverOrigins: ['https://portico.test']})).toBe(valid);
    expect(() => validatePlaybackResponse({
      ...valid,
      continuationCredential: {...valid.continuationCredential, origin: 'https://other.test'},
    } as never, {serverOrigins: ['https://portico.test']})).toThrow('continuation');
    expect(isTrustedInsecureHost('192.168.1.10')).toBe(true);
    expect(isTrustedInsecureHost('203.0.113.10')).toBe(false);
  });
});

describe('playbackIntentForApplePreferences', () => {
  test('carries portable audio and subtitle intent on every start', () => {
    const intent = playbackIntentForApplePreferences({
      directPlay: 'prefer',
      directStream: 'prefer',
      preferredAudioLanguage: 'fr',
      preferredSubtitleLanguage: 'es',
      transcode: 'automatic',
      wifiQualityMode: 'high',
    } as never);
    expect(intent.preferredAudioLanguages).toEqual(['fr']);
    expect(intent.preferredSubtitleLanguages).toEqual(['es']);
    expect(intent.preferredSubtitleMode).toBe('text');
  });

  test.each([
    ['local', 'original'],
    ['wifi', 'high'],
    ['cellular', 'data_saver'],
    ['unknown', 'standard'],
  ] as const)('uses the %s quality preference for the actual network class', (networkClass, qualityProfile) => {
    const intent = playbackIntentForApplePreferences({
      localQualityMode: 'original',
      wifiQualityMode: 'high',
      cellularQualityMode: 'data-saver',
      unknownQualityMode: 'standard',
    } as never, {networkClass});
    expect(intent.networkClass).toBe(networkClass);
    expect(intent.qualityProfile).toBe(qualityProfile);
  });

  test('falls back explicitly to Original when a legacy projection lacks the selected bucket', () => {
    const intent = playbackIntentForApplePreferences({} as never, {networkClass: 'unknown'});
    expect(intent.qualityProfile).toBe('original');
  });
});

describe('googleCastContentType', () => {
  const playback = (overrides: Record<string, unknown>) => ({
    decision: {container: 'mp4'},
    media: {type: 'movie'},
    sourceUrl: 'https://server.test/api/media/movie/stream',
    streamFormat: 'mp4',
    ...overrides,
  });

  test('uses adaptive-stream MIME types published by the server', () => {
    expect(googleCastContentType(playback({streamFormat: 'hls'}) as never)).toBe('application/x-mpegURL');
    expect(googleCastContentType(playback({streamFormat: 'dash'}) as never)).toBe('application/dash+xml');
  });

  test('distinguishes audio-only direct streams from video', () => {
    expect(googleCastContentType(playback({decision: {container: 'mp4'}, media: {type: 'track'}}) as never)).toBe('audio/mp4');
    expect(googleCastContentType(playback({decision: {container: 'mp3'}, media: {type: 'track'}}) as never)).toBe('audio/mpeg');
    expect(googleCastContentType(playback({decision: {container: 'webm'}, media: {type: 'movie'}}) as never)).toBe('video/webm');
    expect(googleCastContentType(playback({decision: {container: 'mpegts'}, media: {type: 'movie'}}) as never)).toBe('video/mp2t');
  });
});

describe('playbackClientProfileForTarget', () => {
  test('does not advertise Apple-only playback capabilities to Google Cast', () => {
    const profile = playbackClientProfileForTarget('google-cast', 'mobile');
    expect(profile).toMatchObject({
      platform: 'Google Cast',
      supportsHevc: false,
      supportsHdr: false,
      supportsHls: true,
      maxWidth: 1920,
      maxHeight: 1080,
    });
    expect(profile.supportedContainers).not.toContain('mov');
    expect(profile.supportedVideoCodecs).toEqual(['h264']);
  });

  test('preserves the Apple shell identity for local playback', () => {
    withAppleRuntime('tv', () => {
      expect(playbackClientProfileForTarget('apple', 'tv')).toMatchObject({device: 'Portico Apple TV', platform: 'tvos'});
    });
  });

  test.each([
    ['android', 'mobile'],
    ['android_tv', 'tv'],
    ['fire_tv', 'tv'],
  ] as const)('forwards the validated %s native playback profile without Apple fallback', (runtime, platform) => {
    const profile = nativePlaybackProfile(runtime);
    withAndroidRuntimeDescriptor(nativeRuntimeDescriptor(runtime, profile), () => {
      expect(playbackClientProfileForTarget('apple', platform)).toBe(profile);
    });
  });

  test('fails closed when Android runtime capabilities are absent instead of using Apple capabilities', () => {
    withAndroidRuntimeDescriptor(nativeRuntimeDescriptor('android'), () => {
      expect(() => playbackClientProfileForTarget('apple', 'mobile')).toThrow(
        'missing validated native playback capability facts',
      );
    });
  });
});

describe('createCastBootstrap', () => {
  test('binds the receiver while preserving the live player head and source route', async () => {
    const create = jest.fn().mockResolvedValue({version: 'v1'});
    const intent = {qualityProfile: 'high', preferredSubtitleMode: 'text'};
    await createCastBootstrap(
      {createCastBootstrap: create} as never,
      {
        ...playback,
        media: {id: 'episode-media', type: 'episode'},
        resumePositionSeconds: 12,
        selectedAudioStreamId: 'audio-fr',
        selectedSubtitleMode: 'text',
        selectedSubtitleStreamId: 'subtitle-fr',
        selectedVersionId: 'version-4k',
        queue: [{id: 'episode-next'}],
        repeatMode: 'all',
        sourceContext: {id: 'show-1', type: 'show'},
      } as never,
      {
        receiverId: 'cast-app-id',
        receiverPublicKey: 'receiver-public-key',
        receiverChallenge: 'receiver-challenge',
      },
      'mobile',
      {
        intent: intent as never,
        positionSeconds: 47.9,
        sourceId: 'recording-opaque-id',
        sourceKind: 'dvr',
      },
    );
    expect(create).toHaveBeenCalledWith(expect.objectContaining({
      audioStreamId: 'audio-fr',
      burnInSubtitleId: undefined,
      clientInstanceId: '',
      clientProfile: expect.objectContaining({platform: 'Google Cast'}),
      intent,
      mediaId: 'episode-media',
      queueMediaIds: ['episode-next'],
      receiverChallenge: 'receiver-challenge',
      receiverId: 'cast-app-id',
      receiverOrigin: 'https://cast.getportico.tv',
      receiverPublicKey: 'receiver-public-key',
      repeatMode: 'all',
      sourceContext: {id: 'show-1', type: 'show'},
      sourceId: 'recording-opaque-id',
      sourceKind: 'dvr',
      sourcePlaybackSessionId: 'session',
      startSeconds: 47,
      subtitleStreamId: 'subtitle-fr',
      versionId: 'version-4k',
    }));
  });
});

describe('handoffPlaybackTarget', () => {
  const current = {
    media: {id: 'movie-1'},
    queue: [{id: 'movie-2'}, {id: 'movie-3'}],
    sessionId: 'apple-session',
    sourceContext: {id: 'library-1', type: 'library'},
  };

  test('renegotiates on-demand playback for the destination decoder at the current position', async () => {
    const replacement = {...playback, sessionId: 'cast-session'};
    const client = {
      handoffPlayback: jest.fn().mockResolvedValue(replacement),
      openLiveTvStream: jest.fn(),
      startLiveTvPlayback: jest.fn(),
    };
    await expect(handoffPlaybackTarget(client as never, current as never, 'google-cast', 'mobile', {
      kind: 'media',
      positionSeconds: 42.9,
      sourceId: 'route-id-is-not-used-for-media',
    })).resolves.toBe(replacement);
    expect(client.handoffPlayback).toHaveBeenCalledWith('apple-session', expect.objectContaining({
      mediaId: 'movie-1',
      progressSeconds: 42,
      queueMediaIds: ['movie-2', 'movie-3'],
      sourceContext: {id: 'library-1', type: 'library'},
      clientProfile: expect.objectContaining({platform: 'Google Cast', supportsHevc: false}),
    }));
  });

  test('uses the dedicated live contract for Cast and for returning to Apple playback', async () => {
    const client = {
      handoffPlayback: jest.fn(),
      openLiveTvStream: jest.fn().mockResolvedValue({...playback, sessionId: 'cast-live', isLive: true, timeline: {type: 'live'}}),
      startLiveTvPlayback: jest.fn().mockResolvedValue({...playback, sessionId: 'apple-live', isLive: true, timeline: {type: 'live'}}),
    };
    await handoffPlaybackTarget(client as never, current as never, 'google-cast', 'mobile', {kind: 'live', positionSeconds: 0, sourceId: 'channel-1'});
    await handoffPlaybackTarget(client as never, current as never, 'apple', 'mobile', {kind: 'live', positionSeconds: 0, sourceId: 'channel-1'});
    expect(client.openLiveTvStream).toHaveBeenCalledWith('channel-1', {clientProfile: expect.objectContaining({platform: 'Google Cast'})});
    expect(client.startLiveTvPlayback).toHaveBeenCalledWith('channel-1', {clientProfile: expect.objectContaining({platform: 'ios'})});
    expect(client.handoffPlayback).not.toHaveBeenCalled();
  });
});

describe('preferredPlaybackSelection', () => {
  const preferences = {
    version: 1 as const,
    autoplayNext: true,
    upNextCountdownSeconds: 10 as const,
    passoutProtection: true,
    passoutAfterEpisodes: 3 as const,
    introSkip: 'ask' as const,
    creditsSkip: 'automatic' as const,
    seekIntervalSeconds: 10 as const,
    preferredAudioLanguage: 'fr' as const,
    preferredSubtitleLanguage: 'en' as const,
    allowCellularStreaming: true,
    localQualityMode: 'original' as const,
    wifiQualityMode: 'automatic' as const,
    cellularQualityMode: 'data-saver' as const,
    unknownQualityMode: 'original' as const,
    directPlay: 'prefer' as const,
    directStream: 'allow' as const,
    transcode: 'allow' as const,
    downloadDeleteWatched: false,
    downloadsWifiOnly: true,
  };

  test('selects only matching published streams and distinguishes managed subtitles', () => {
    const playback = {
      selectedAudioStreamId: 'audio-en',
      audioStreams: [{id: 'audio-en', language: 'eng'}, {id: 'audio-fr', language: 'fra'}],
      subtitleStreams: [{id: 'sub-en', language: 'en-US', sourceUrl: '/subtitle.vtt'}],
    };
    expect(preferredPlaybackSelection(playback as never, preferences)).toEqual({
      audioStreamId: 'audio-fr',
      subtitleStreamId: 'sub-en',
      subtitleRequiresBurnIn: false,
    });
  });

  test('does not fabricate missing streams or reselect the active audio stream', () => {
    const playback = {
      selectedAudioStreamId: 'audio-fr',
      audioStreams: [{id: 'audio-fr', language: 'French'}],
      subtitleStreams: [],
    };
    expect(preferredPlaybackSelection(playback as never, preferences)).toEqual({
      audioStreamId: undefined,
      subtitleStreamId: undefined,
      subtitleRequiresBurnIn: false,
    });
  });
});
