import type {PlayerContentMode} from '@portico/client-core';

export interface ApplePlaybackPlatform {
  isTV: boolean;
  os: string;
}

export interface ApplePlaybackPolicy {
  backgroundAudio: boolean;
  mediaFamily: 'audiobook' | 'music' | 'unknown' | 'video';
  nowPlaying: boolean;
  pictureInPictureEligible: boolean;
  remoteCommands: boolean;
}

export function applePlaybackPolicyFor(platform: ApplePlaybackPlatform, contentMode?: PlayerContentMode): ApplePlaybackPolicy {
  const mediaFamily = contentMode === 'music'
    ? 'music'
    : contentMode === 'audiobook'
      ? 'audiobook'
      : contentMode === 'video' || contentMode === 'live'
        ? 'video'
        : 'unknown';
  const appleRuntime = platform.os === 'ios';
  const mobileIOS = appleRuntime && !platform.isTV;
  return {
    backgroundAudio: appleRuntime && (mediaFamily === 'music' || mediaFamily === 'audiobook'),
    mediaFamily,
    nowPlaying: appleRuntime,
    pictureInPictureEligible: mobileIOS && mediaFamily === 'video',
    remoteCommands: appleRuntime,
  };
}
