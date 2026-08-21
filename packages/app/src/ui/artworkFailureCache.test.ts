import {
  ARTWORK_FAILURE_TTL_MS,
  MAX_REMEMBERED_ARTWORK_FAILURES,
  clearMediaArtworkFailureCache,
  mediaArtworkFailureCacheVersion,
  mediaArtworkFailureExpiresAt,
  rememberMediaArtworkFailure,
  subscribeMediaArtworkFailureCache,
} from './artworkFailureCache';
import type {ViewerScope} from '@portico/client-core';
import {ViewerRuntimeCoordinator} from '@portico-react-native/infrastructure';

const viewerScope: ViewerScope = {
  accountId: 'account-one',
  authority: 'hosted',
  authorizationRevision: 'authorization-a',
  profileId: 'profile-a',
  serverId: 'server-one',
};

beforeEach(() => {
  jest.useFakeTimers();
  clearMediaArtworkFailureCache();
});

afterEach(() => {
  clearMediaArtworkFailureCache();
  jest.useRealTimers();
});

test('owns one expiry timer per viewer-scoped source and notifies on expiry', () => {
  const listener = jest.fn();
  const unsubscribe = subscribeMediaArtworkFailureCache(listener);
  const source = 'https://server/api/artwork/item?__portico_viewer=viewer-a';
  const expiresAt = rememberMediaArtworkFailure(source);

  expect(mediaArtworkFailureExpiresAt(source)).toBe(expiresAt);
  expect(jest.getTimerCount()).toBe(1);
  expect(listener).toHaveBeenCalledTimes(1);

  jest.advanceTimersByTime(ARTWORK_FAILURE_TTL_MS);
  expect(mediaArtworkFailureExpiresAt(source)).toBe(0);
  expect(listener).toHaveBeenCalledTimes(2);
  unsubscribe();
});

test('replacing one source cancels its prior timer and preserves the newer expiry', () => {
  const source = 'https://server/api/artwork/item?__portico_viewer=viewer-a';
  rememberMediaArtworkFailure(source);
  jest.advanceTimersByTime(10_000);
  const renewed = rememberMediaArtworkFailure(source);

  expect(jest.getTimerCount()).toBe(1);
  jest.advanceTimersByTime(20_000);
  expect(mediaArtworkFailureExpiresAt(source)).toBe(renewed);
  jest.advanceTimersByTime(10_000);
  expect(mediaArtworkFailureExpiresAt(source)).toBe(0);
});

test('viewer rekeying isolates failures even when the server path is identical', () => {
  const viewerA = 'https://server/api/artwork/item?__portico_viewer=viewer-a';
  const viewerB = 'https://server/api/artwork/item?__portico_viewer=viewer-b';
  rememberMediaArtworkFailure(viewerA);

  expect(mediaArtworkFailureExpiresAt(viewerA)).toBeGreaterThan(Date.now());
  expect(mediaArtworkFailureExpiresAt(viewerB)).toBe(0);
});

test('viewer transition evicts the previous viewer failure namespace immediately', async () => {
  const runtime = new ViewerRuntimeCoordinator();
  try {
    runtime.initialize(viewerScope);
    const source = 'https://server/api/artwork/item?__portico_viewer=viewer-a';
    rememberMediaArtworkFailure(source);

    await runtime.transition({...viewerScope, profileId: 'profile-b'});

    expect(mediaArtworkFailureExpiresAt(source)).toBe(0);
  } finally {
    runtime.forceClosed();
  }
});

test('evicts the oldest source and cancels its timer at the bounded cache limit', () => {
  const sources = Array.from(
    {length: MAX_REMEMBERED_ARTWORK_FAILURES + 1},
    (_, index) => `https://server/api/artwork/${index}?__portico_viewer=viewer-a`,
  );
  sources.forEach(source => rememberMediaArtworkFailure(source));

  expect(mediaArtworkFailureExpiresAt(sources[0])).toBe(0);
  expect(mediaArtworkFailureExpiresAt(sources.at(-1))).toBeGreaterThan(Date.now());
  expect(jest.getTimerCount()).toBe(MAX_REMEMBERED_ARTWORK_FAILURES);
});

test('clearing the cache cancels all owned timers and publishes one invalidation', () => {
  rememberMediaArtworkFailure('https://server/api/artwork/item?__portico_viewer=viewer-a');
  const before = mediaArtworkFailureCacheVersion();

  clearMediaArtworkFailureCache();

  expect(jest.getTimerCount()).toBe(0);
  expect(mediaArtworkFailureCacheVersion()).toBe(before + 1);
});
