import {
  formatPlayerTime,
  googleCastPlaybackSupported,
  isScopedGoogleCastSource,
  sourceWithMediaGrant,
} from './index';

describe('formatPlayerTime', () => {
  it('formats media positions without losing hour precision', () => {
    expect(formatPlayerTime(0)).toBe('0:00');
    expect(formatPlayerTime(377)).toBe('6:17');
    expect(formatPlayerTime(3661)).toBe('1:01:01');
  });

  it('fails closed for invalid positions', () => {
    expect(formatPlayerTime(Number.NaN)).toBe('0:00');
    expect(formatPlayerTime(-5)).toBe('0:00');
  });
});

describe('sourceWithMediaGrant', () => {
  it('strips every credential query and never manufactures a replacement', () => {
    expect(sourceWithMediaGrant('https://server.test/api/media/1/hls/master.m3u8?media_grant=old&access_token=never', 'next'))
      .toBe('https://server.test/api/media/1/hls/master.m3u8');
  });
});

describe('isScopedGoogleCastSource', () => {
  it('requires clean HTTPS URLs while the receiver owns authorization', () => {
    expect(googleCastPlaybackSupported).toBe(false);
    expect(isScopedGoogleCastSource('https://server.test/api/media/1/hls/master.m3u8?media_grant=short-lived')).toBe(false);
    expect(isScopedGoogleCastSource('http://server.test/api/media/1/hls/master.m3u8?media_grant=short-lived')).toBe(false);
    expect(isScopedGoogleCastSource('https://server.test/api/media/1/hls/master.m3u8')).toBe(true);
    expect(isScopedGoogleCastSource('https://server.test/api/media/1/hls/master.m3u8?media_grant=short-lived&access_token=account')).toBe(false);
    expect(isScopedGoogleCastSource('https://server.test/api/media/1/hls/master.m3u8?media_grant=short-lived&access%5Ftoken=account')).toBe(false);
  });
});
