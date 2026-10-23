import type {AudioStream, PlaybackOptions, VideoStream} from '../../../../../packages/client-core/src/playback-v1/types';
import type {TextEnvironment} from '../../../../../packages/client-core/src/presentation/kit-model';

export type NativeVersionRowText = Readonly<{primary: string; secondary: string}>;
export type NativeVersionRow = NativeVersionRowText & Readonly<{id: string}>;
/** Native owns row composition. Inject canonical technical names and localized
 * size formatting, never a shared row helper, generic label or preferred track. */
export type NativeVersionPresentation = Readonly<{
  title: string;
  videoPictureName: (video: VideoStream, text: TextEnvironment) => string | undefined;
  videoAudioFormatName: (audio: AudioStream, text: TextEnvironment) => string | undefined;
  sizeName: (sizeBytes: number, text: TextEnvironment) => string | undefined;
}>;

/** Options owns grouped IDs and File info order. §23 describes each version's
 * file-default audio, otherwise its first actual stream, not viewer selection. */
export function nativeVersionChoices(options: PlaybackOptions, itemId: string, text: TextEnvironment, presentation: NativeVersionPresentation, excludeVersionId?: string, minimum = 2): readonly NativeVersionRow[] {
  if (options.itemId !== itemId || options.versions.length < minimum || new Set(options.versions.map(version => version.id)).size !== options.versions.length) return [];
  const rows = options.versions.filter(version => version.id !== excludeVersionId).map(version => {
    const video = version.video[0], audio = version.audio.find(track => track.default) ?? version.audio[0];
    const picture = video ? presentation.videoPictureName(video, text) : undefined;
    const audioName = audio ? presentation.videoAudioFormatName(audio, text) : undefined;
    const size = version.sizeBytes !== undefined && Number.isFinite(version.sizeBytes) && version.sizeBytes >= 0 ? presentation.sizeName(version.sizeBytes, text) : undefined;
    const edition = version.edition?.trim();
    return Object.freeze({id: version.id, primary: edition || picture || '', secondary: [edition ? picture : undefined, audioName, size].filter(Boolean).join(', ')});
  });
  return rows.every(row => !!row.primary.trim()) ? Object.freeze(rows) : [];
}
