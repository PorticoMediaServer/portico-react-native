import type {PlaybackOptions} from '../../../../../packages/client-core/src/playback-v1/types';
import {versionModels, type TextEnvironment} from '../../../../../packages/client-core/src/presentation/kit-model';

/** Real offered facts only. The destination UI awaits its approved frame/flow. */
export function nativeVersionChoices(options: PlaybackOptions, itemId: string, text: TextEnvironment) {
  if (options.itemId !== itemId || options.versions.length < 2 || new Set(options.versions.map(version => version.id)).size !== options.versions.length) return [];
  return versionModels(options.versions.map(version => ({id: version.id, name: version.label, edition: version.edition, container: version.container,
    height: version.video[0]?.height, videoCodec: version.video[0]?.codec, dynamicRange: version.video[0]?.hdr, bitRate: version.bitrateKbps === undefined ? undefined : version.bitrateKbps * 1000, sizeBytes: version.sizeBytes})), text);
}
