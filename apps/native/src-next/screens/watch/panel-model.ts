import {sameFence} from '../../../../../packages/player-core/src';
import type {AudioStream, PlaybackOptions, SubtitleStream} from '../../../../../packages/client-core/src/playback-v1/types';
import {qualityOptionSelected, type QualityOption} from '../../../../../packages/client-core/src/playback-v1/quality';
import type {NativePlaybackRuntimeSnapshot} from '../../platform/playback/types';
import {nativeWatchTracks} from './track-identity';

export type NativeWatchChoiceName = Readonly<{primary: string; secondary?: string; unavailable?: boolean}>;
export type NativeWatchChoiceRow<T> = NativeWatchChoiceName & Readonly<{id: string; selected: boolean; value: T}>;
/** Canonical localized technical names and actual availability/route facts.
 * No selected identity, default choice, policy ceiling or synthetic data enters
 * through these naming ports. Native owns the rendered rows. */
export type NativeWatchPanelNames = Readonly<{
  audio: (track: AudioStream, source: NativePlaybackRuntimeSnapshot) => NativeWatchChoiceName;
  subtitle: (track: SubtitleStream, source: NativePlaybackRuntimeSnapshot) => NativeWatchChoiceName;
  quality: (choice: QualityOption, source: NativePlaybackRuntimeSnapshot) => NativeWatchChoiceName;
  audioFooter: (source: NativePlaybackRuntimeSnapshot) => readonly string[];
  qualityFooter: (source: NativePlaybackRuntimeSnapshot) => readonly string[];
}>;
export function nativeWatchPanelRows(source: NativePlaybackRuntimeSnapshot, options: PlaybackOptions, names: NativeWatchPanelNames) {
  const fence = source.fence, selected = nativeWatchTracks(source), session = source.session;
  const empty = {audio: [], subtitles: [], qualities: []} as const;
  if (!selected.version || !fence || fence.kind !== 'queue' || !session || !sameFence(source.dock.local?.fence, fence)
    || options.itemId !== fence.itemId || new Set(options.versions.map(row => row.id)).size !== options.versions.length) return empty;
  const version = options.versions.find(row => row.id === session.versionId);
  if (!version) return empty;
  const unique = <T extends {id: string}>(rows: readonly T[]) => new Set(rows.map(row => row.id)).size === rows.length;
  const audio: readonly NativeWatchChoiceRow<AudioStream>[] = unique(version.audio) ? version.audio.map(track => ({...names.audio(track, source), id: track.id,
    selected: session.presentation.audioTrackId === track.id, value: track})) : [];
  const subtitles: readonly NativeWatchChoiceRow<SubtitleStream>[] = unique(version.subtitles) ? version.subtitles.map(track => ({...names.subtitle(track, source), id: track.id,
    selected: session.presentation.subtitle?.trackId === track.id, value: track})) : [];
  const qualityIds = options.qualities.map(row => row.mode === 'fixed' ? row.id : row.mode);
  const qualities: readonly NativeWatchChoiceRow<QualityOption>[] = new Set(qualityIds).size === qualityIds.length ? options.qualities.map(choice => ({...names.quality(choice, source),
    id: choice.mode === 'fixed' ? choice.id! : choice.mode, selected: qualityOptionSelected(choice, session.presentation.quality), value: choice})) : [];
  return {audio, subtitles, qualities};
}
