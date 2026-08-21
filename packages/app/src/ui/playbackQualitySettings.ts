import type {
  AppleViewerPreferences,
  AppleViewerPreferenceUpdate,
} from '@portico-react-native/infrastructure';

export const APPLE_PLAYBACK_QUALITY_OPTIONS = [
  'original',
  'automatic',
  'high',
  'standard',
  'data-saver',
] as const;

export function playbackQualityLabel(
  value: AppleViewerPreferences['wifiQualityMode'],
): string {
  if (value === 'original') return 'Original Quality';
  if (value === 'data-saver') return 'Data Saver';
  if (value === 'off') return 'Off';
  return value.charAt(0).toUpperCase() + value.slice(1);
}

export function wifiPlaybackQualityUpdate(
  value: (typeof APPLE_PLAYBACK_QUALITY_OPTIONS)[number],
): AppleViewerPreferenceUpdate {
  return {wifiQualityMode: value};
}
