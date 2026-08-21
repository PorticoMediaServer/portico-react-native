import {
  APPLE_PLAYBACK_QUALITY_OPTIONS,
  playbackQualityLabel,
  wifiPlaybackQualityUpdate,
} from './playbackQualitySettings';

describe('playback quality settings', () => {
  test('offers Original Quality and emits a canonical editable Wi-Fi preference update', () => {
    expect(APPLE_PLAYBACK_QUALITY_OPTIONS).toContain('original');
    expect(playbackQualityLabel('original')).toBe('Original Quality');
    expect(wifiPlaybackQualityUpdate('standard')).toEqual({
      wifiQualityMode: 'standard',
    });
  });
});
