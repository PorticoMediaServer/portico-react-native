import {
  acknowledgeHeartbeat,
  canCommitPreparedHandoff,
  classifyApplePlaybackError,
  descriptorTransition,
  heartbeatDue,
  rangeForCurrentOffset,
  rewriteApprovedHLSPlaylist,
  sliceFromCurrentOffset,
  utf8ByteLength,
  validateApplePlaybackDescriptor,
} from './applePlaybackContinuity';

const descriptor = (overrides: Record<string, unknown> = {}) => ({
  url: 'https://server.example/api/playback-sessions/s1/stream.m3u8',
  mediaGrant: 'ptc_mg_a',
  sessionId: 's1',
  continuationURL: 'https://server.example/api/playback-sessions/s1/continuation',
  continuationCredential: {
    token: 'ptc_pb_a',
    expiresAt: new Date(Date.now() + 300_000).toISOString(),
    origin: 'https://server.example',
    generation: 3,
  },
  nextEventSequence: 4,
  playbackRevision: 7,
  resumePositionSeconds: 42,
  playbackGeneration: 3,
  serverOrigins: ['https://server.example'],
  routePolicy: {allowInsecureLan: false},
  revision: 's1:3:grant-a',
  ...overrides,
});

test('accepts complete descriptor revisions atomically and keeps healthy items on grant rotation', () => {
  const current = validateApplePlaybackDescriptor(descriptor());
  expect(descriptorTransition(current, descriptor({mediaGrant: 'ptc_mg_b', revision: 's1:3:grant-b'}))).toBe('update-grant');
  expect(descriptorTransition(current, descriptor({url: 'https://server.example/api/playback-sessions/s2/stream.m3u8', revision: 's2:4:grant-c'}), true)).toBe('replace-item');
});

test('rejects a continuation endpoint that is not the exact session-scoped origin', () => {
  expect(() => validateApplePlaybackDescriptor(descriptor({
    continuationURL: 'https://server.example/api/playback-sessions/other/continuation',
  }))).toThrow('exact scoped session endpoint');
  expect(() => validateApplePlaybackDescriptor(descriptor({
    url: 'http://203.0.113.10/api/playback-sessions/s1/stream.m3u8',
    continuationURL: 'http://203.0.113.10/api/playback-sessions/s1/continuation',
    continuationCredential: {...descriptor().continuationCredential, origin: 'http://203.0.113.10'},
    serverOrigins: ['http://203.0.113.10'],
    routePolicy: {allowInsecureLan: true},
  }))).toThrow('outside the selected server origins');
});

test('starts every range and fallback slice at currentOffset', () => {
  expect(rangeForCurrentOffset(12, 4, 16, false)).toBe('bytes=12-19');
  expect(rangeForCurrentOffset(12, 4, 16, true)).toBe('bytes=12-');
  expect(Array.from(sliceFromCurrentOffset(new Uint8Array([0, 1, 2, 3, 4]), 2, false, 2))).toEqual([2, 3]);
});

test('rewrites approved HLS children before publishing length and never rewrites another origin', () => {
  const result = rewriteApprovedHLSPlaylist(
    '#EXT-X-KEY:METHOD=AES-128,URI="https://server.example/api/key"\nhttps://evil.example/segment.ts\n',
    ['https://server.example'],
    {allowInsecureLan: false},
  );
  expect(result.body).toContain('portico-resource://server.example/api/key');
  expect(result.body).toContain('https://evil.example/segment.ts');
  expect(result.contentLength).toBe(utf8ByteLength(result.body));
  expect(result.byteRangeSupported).toBe(false);
});

test('classifies nested authorization failures and orders heartbeat/handoff acknowledgements', () => {
  expect(classifyApplePlaybackError({domain: 'AVFoundation', cause: {domain: 'NSURLErrorDomain', code: -1012}})).toBe('grant');
  expect(classifyApplePlaybackError({domain: 'AVFoundation', cause: {status: 403}})).toBe('grant');
  expect(heartbeatDue({sessionId: 's1', grantExpiresAt: 100_000, nextSequence: 4, lastAcknowledgedSequence: 2}, 45_000)).toBe(true);
  expect(acknowledgeHeartbeat({sessionId: 's1', grantExpiresAt: 100_000, nextSequence: 4, lastAcknowledgedSequence: 2}, 7).nextSequence).toBe(8);
  expect(canCommitPreparedHandoff('old', 'prepared', 'prepared', 7, 7)).toBe(true);
  expect(canCommitPreparedHandoff('old', 'prepared', 'prepared', 7, 8)).toBe(false);
  expect(canCommitPreparedHandoff('old', 'prepared', undefined)).toBe(false);
});
