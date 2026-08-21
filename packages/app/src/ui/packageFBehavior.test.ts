import type {PorticoClient} from '@porticomediaserver/client-core';
import type {PorticoDownload} from '@portico-react-native/infrastructure';
import {Platform, UIManager} from 'react-native';
import {synchronizePendingDownloadProgress} from '../data/downloadProgressSync';
import {
  handoffPlaybackTarget,
  playbackClientProfileForTarget,
  playbackIntentForApplePreferences,
  startRoutedPlayback,
} from '../data/playback';
import {boundedGuideChannelWindow, GUIDE_RENDER_CHANNEL_LIMIT} from './screens/ChannelsScreen';
import {
  publishPorticoNavigationLifecycle,
  subscribePorticoNavigationLifecycle,
} from './navigationLifecycle';

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

const previousPlatformOs = Object.getOwnPropertyDescriptor(Platform, 'OS');
const previousPlatformIsTv = Object.getOwnPropertyDescriptor(Platform, 'isTV');
const previousViewManagerConfig = Object.getOwnPropertyDescriptor(UIManager, 'getViewManagerConfig');

beforeAll(() => {
  Object.defineProperty(Platform, 'OS', {configurable: true, value: 'ios'});
  Object.defineProperty(Platform, 'isTV', {configurable: true, writable: true, value: false});
  Object.defineProperty(UIManager, 'getViewManagerConfig', {
    configurable: true,
    writable: true,
    value: () => ({
      Constants: {
        applePlaybackProfile: appleNativePlaybackFacts(Platform.isTV === true),
      },
    }),
  });
});

afterAll(() => {
  if (previousPlatformOs) Object.defineProperty(Platform, 'OS', previousPlatformOs);
  else Reflect.deleteProperty(Platform, 'OS');
  if (previousPlatformIsTv) Object.defineProperty(Platform, 'isTV', previousPlatformIsTv);
  else Reflect.deleteProperty(Platform, 'isTV');
  if (previousViewManagerConfig) Object.defineProperty(UIManager, 'getViewManagerConfig', previousViewManagerConfig);
  else Reflect.deleteProperty(UIManager, 'getViewManagerConfig');
});

const playback = {
  sessionId: 'session-1',
  nextEventSequence: 1,
  playbackRevision: 4,
  generation: 2,
  continuationCredential: {token: 'continuation', expiresAt: '2099-01-01T00:00:00Z', origin: 'https://portico.test', generation: 2},
  mediaGrant: {token: 'grant', expiresAt: '2099-01-01T00:00:00Z'},
  media: {id: 'movie-1', type: 'movie'},
  sourceUrl: '/api/media/movie-1/stream',
  directPlay: true,
  resources: [{id: 'resource-1', sourceUrl: '/api/media/movie-1/stream', streamFormat: 'mp4'}],
  decision: {},
  policy: {},
  qualities: [],
  audioStreams: [],
  subtitleStreams: [],
  chapters: [],
  queue: [],
  repeatMode: 'off',
  queueRevision: 1,
  timeline: {type: 'vod'},
};

describe('Package F Apple app-wire behavior', () => {
  test('sends canonical measured Apple evidence, portable intent, and source context on the app start wire', async () => {
    const profile = playbackClientProfileForTarget('apple', 'mobile');
    expect(profile).toEqual(expect.objectContaining({
      capabilitySchemaVersion: expect.any(String),
      platform: 'ios',
    }));
    expect(profile).not.toEqual(expect.objectContaining({platform: 'Google Cast'}));

    const intent = playbackIntentForApplePreferences({
      directPlay: 'prefer',
      directStream: 'allow',
      transcode: 'allow',
      preferredAudioLanguage: 'fr',
      preferredSubtitleLanguage: 'en',
      wifiQualityMode: 'high',
    } as never, {networkClass: 'wifi', transportClass: 'wifi'});
    const client = {startPlayback: jest.fn().mockResolvedValue(playback)};
    await startRoutedPlayback(client as never, 'movie-1', 'media', 17, undefined, undefined, 'mobile', {
      intent,
      sourceContext: {type: 'library', id: 'library-1', title: 'Movies'},
    });
    expect(client.startPlayback).toHaveBeenCalledWith('movie-1', expect.objectContaining({
      clientProfile: profile,
      intent: expect.objectContaining({networkClass: 'wifi', preferredAudioLanguages: ['fr'], qualityProfile: 'high'}),
      sourceContext: expect.objectContaining({id: 'library-1', title: 'Movies'}),
      startSeconds: 17,
    }));
  });

  test('uses the canonical Apple profile on media, live, DVR, and library-channel wires', async () => {
    const profile = playbackClientProfileForTarget('apple', 'mobile');
    const client = {
      startPlayback: jest.fn().mockResolvedValue(playback),
      startLiveTvPlayback: jest.fn().mockResolvedValue(playback),
      playDvrRecording: jest.fn().mockResolvedValue(playback),
      tuneLibraryChannel: jest.fn().mockResolvedValue({playback}),
    };
    await startRoutedPlayback(client as never, 'media-1', 'media');
    await startRoutedPlayback(client as never, 'channel-1', 'live');
    await startRoutedPlayback(client as never, 'recording-1', 'dvr');
    await startRoutedPlayback(client as never, 'library-channel-1', 'library-channel');
    expect(client.startPlayback).toHaveBeenCalledWith('media-1', expect.objectContaining({clientProfile: profile}));
    expect(client.startLiveTvPlayback).toHaveBeenCalledWith('channel-1', expect.objectContaining({clientProfile: profile}));
    expect(client.playDvrRecording).toHaveBeenCalledWith('recording-1', expect.objectContaining({clientProfile: profile}));
    expect(client.tuneLibraryChannel).toHaveBeenCalledWith('library-channel-1', expect.objectContaining({clientProfile: profile}));
  });

  test('persists completed offline progress only after the server accepts the terminal event', async () => {
    const order: string[] = [];
    const download = {
      accountId: 'account-1', authority: 'hosted', authorizationRevision: 'auth-1', clientIdentifier: 'download-1',
      id: 'download-1', mediaId: 'movie-1', preparationId: 'preparation-1', profile: 'source', profileId: 'profile-1',
      serverId: 'server-1', title: 'Movie', state: 'completed', bytesWritten: 10, bytesExpected: 10, progress: 1,
      localURL: 'file:///movie.mp4', createdAt: '2026-01-01T00:00:00Z', updatedAt: '2026-01-01T00:00:00Z',
      durationSeconds: 100, progressSeconds: 100, playbackProgressPending: true, playbackCompleted: true,
    } as PorticoDownload;
    const client = {
      startPlayback: jest.fn(async () => ({sessionId: 'sync-session'})),
      touchPlayback: jest.fn(async () => { order.push('server-accepted'); return {accepted: true, stale: false}; }),
      stopPlayback: jest.fn(async () => { order.push('stop'); }),
    } as unknown as PorticoClient;
    const store = {markPlaybackProgressSynced: jest.fn(async () => { order.push('native-marker-cleared'); return download; })};
    await synchronizePendingDownloadProgress({
      client, downloads: [download], inFlight: new Set(), store,
      viewerScope: {accountId: 'account-1', authority: 'hosted', authorizationRevision: 'auth-1', profileId: 'profile-1', serverId: 'server-1'},
    });
    expect(order).toEqual(['server-accepted', 'native-marker-cleared']);
  });

  test('hands Cast a receiver profile and retains server-authoritative state', async () => {
    const castPlayback = {...playback, sessionId: 'cast-session', playbackRevision: 5};
    const client = {handoffPlayback: jest.fn().mockResolvedValue(castPlayback)};
    await expect(handoffPlaybackTarget(client as never, playback as never, 'google-cast', 'mobile', {
      kind: 'media', positionSeconds: 21, sourceId: 'movie-1',
    })).resolves.toBe(castPlayback);
    expect(client.handoffPlayback).toHaveBeenCalledWith('session-1', expect.objectContaining({
      clientProfile: expect.objectContaining({platform: 'Google Cast'}),
      progressSeconds: 21,
    }));
  });

  test('keeps navigation observation isolated and large guide rendering bounded', () => {
    const observed: string[] = [];
    const unsubscribeBroken = subscribePorticoNavigationLifecycle(() => { throw new Error('telemetry failed'); });
    const unsubscribe = subscribePorticoNavigationLifecycle(event => observed.push(`${event.event}:${event.route.name}`));
    expect(() => publishPorticoNavigationLifecycle({event: 'focus', platform: 'handheld', route: {name: 'home'}})).not.toThrow();
    unsubscribe();
    unsubscribeBroken();
    expect(observed).toEqual(['focus:home']);

    const channels = Array.from({length: 50_000}, (_, id) => ({id}));
    const window = boundedGuideChannelWindow(channels, 49_999);
    expect(window.items).toHaveLength(GUIDE_RENDER_CHANNEL_LIMIT);
    expect(window.items.at(-1)).toEqual({id: 49_999});
    expect(window.hasNext).toBe(false);
  });
});
