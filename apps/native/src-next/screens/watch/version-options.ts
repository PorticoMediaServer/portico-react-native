import type {AudioStream, PlaybackOptions, VideoStream} from '../../../../../packages/client-core/src/playback-v1/types';
import {formatVideoBytes, videoAudioFormatName, videoPictureName, videoTrackWords} from '../../../../../packages/client-core/src/video-track-labels';
import type {I18n} from '../../../../../packages/i18n/src';

export type NativeVersionNames = Readonly<{
  picture: (video: VideoStream) => string;
  audio: (audio: AudioStream) => string;
  size: (bytes: number | undefined) => string | undefined;
}>;
export function nativeVersionNames(t: I18n['t'], locale: string): NativeVersionNames {
  const words = videoTrackWords(t, locale);
  return {picture: video => videoPictureName(video, words), audio: audio => videoAudioFormatName(audio, words), size: bytes => formatVideoBytes(bytes, locale)};
}

/** Native-only §21/§23 row composition. Options order is also File info's
 * authoritative group order. No ordinal, container, bitrate or selection tags.
 * Menu eligibility (>=2) is separate from failure exclusion (possibly one). */
export function nativeVersionChoices(options: PlaybackOptions, itemId: string, names: NativeVersionNames, failedVersionId?: string) {
  if (options.itemId !== itemId || new Set(options.versions.map(version => version.id)).size !== options.versions.length) return [];
  return options.versions.filter(version => version.id !== failedVersionId).map(version => {
    const picture = version.video[0] ? names.picture(version.video[0]) : '';
    const edition = version.edition?.trim() ? version.edition : undefined;
    // Options preserves the file's stream-index order. A viewer's preferred
    // language/track and globalPreferred never describe another file's default.
    const audio = version.audio.find(track => track.default) ?? version.audio[0];
    return Object.freeze({id: version.id, heading: edition ?? picture,
      detail: [edition ? picture : undefined, audio ? names.audio(audio) : undefined, names.size(version.sizeBytes)].filter(Boolean).join(', ')});
  });
}
