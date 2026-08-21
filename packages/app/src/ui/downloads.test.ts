import {
  automaticNextDownloadRetryDecision,
  formatBytes,
  nextOfflinePlaybackAttempt,
} from './downloads';

test('formats download storage without false precision', () => {
  expect(formatBytes(0)).toBe('Size unavailable');
  expect(formatBytes(1024)).toBe('1.0 KB');
  expect(formatBytes(15 * 1024 * 1024)).toBe('15 MB');
});

test('orders offline playback attempts monotonically even within one clock tick', () => {
  const first = nextOfflinePlaybackAttempt(100);
  const second = nextOfflinePlaybackAttempt(100);
  expect(second).toBeGreaterThan(first);
});

test('retries automatic next-episode downloads after transient failures but remains bounded', () => {
  const first = automaticNextDownloadRetryDecision(0);
  expect(first).toEqual({failures: 1, retry: true});
  expect(automaticNextDownloadRetryDecision(first.failures)).toEqual({
    failures: 2,
    retry: true,
  });
  expect(automaticNextDownloadRetryDecision(3)).toEqual({
    failures: 4,
    retry: false,
  });
  expect(automaticNextDownloadRetryDecision(40)).toEqual({
    failures: 4,
    retry: false,
  });
});
