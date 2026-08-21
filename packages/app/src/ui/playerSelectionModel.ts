import type {PlaybackResponse} from '@porticomediaserver/client-core';

export function playerQualitySelectionAllowed(playback: PlaybackResponse, qualityId: string, input: {busy: boolean; isLive: boolean}): boolean {
  return !input.busy && !input.isLive && playback.streamFormat === 'hls' && playback.qualities.some(quality => quality.available !== false && quality.id === qualityId);
}

export type PlayerSubtitleSelection =
  | {subtitleMode: 'off'}
  | {subtitleMode: 'burn_in' | 'text'; subtitleStreamId: string};

export function playerSubtitleSelection(playback: PlaybackResponse, subtitleId: string, input: {busy: boolean; dvr: boolean; isLive: boolean}): PlayerSubtitleSelection | undefined {
  if (input.busy || input.isLive || input.dvr) return undefined;
  if (subtitleId === 'sub_none') return {subtitleMode: 'off'};
  const stream = playback.subtitleStreams.find(candidate => candidate.id === subtitleId);
  if (!stream) return undefined;
  return {subtitleMode: stream.sourceUrl ? 'text' : 'burn_in', subtitleStreamId: subtitleId};
}
