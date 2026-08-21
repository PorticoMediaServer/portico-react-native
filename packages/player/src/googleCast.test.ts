import {isScopedGoogleCastSource} from './index';

describe('Google Cast media boundary', () => {
  it('accepts clean HTTPS URLs and rejects URL credentials', () => {
    expect(isScopedGoogleCastSource('https://portico.example/api/playback/stream.m3u8?media_grant=grant')).toBe(false);
    expect(isScopedGoogleCastSource('http://portico.local/stream?media_grant=grant')).toBe(false);
    expect(isScopedGoogleCastSource('https://portico.example/stream')).toBe(true);
  });

  it('rejects account access tokens even when a legacy media grant is present', () => {
    expect(isScopedGoogleCastSource('https://portico.example/stream?media_grant=grant&access_token=account')).toBe(false);
  });
});
