/** Moved to `src-next/platform/device-platform`, which now owns the one derivation (and its
 * singleton constants) for both apps' shared code; this path keeps the old public surface. */
export type {DevicePlatform} from '../../src-next/platform/device-platform';
export {
  isTablet, devicePlatform, installationPlatform, androidFamily, deviceModelName, deviceNoun,
  playOnPlatform, hasAirPlay, hasPictureInPicture, declaresOutputs,
} from '../../src-next/platform/device-platform';
