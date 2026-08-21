import {playerQualitySelectionAllowed, playerSubtitleSelection} from './playerSelectionModel';

const playback = {
  qualities: [{available: true, id: '1080p'}, {available: false, id: '4k'}],
  streamFormat: 'hls',
  subtitleStreams: [{id: 'text', sourceUrl: '/subtitle.vtt'}, {id: 'burn'}],
} as never;

test('quality selection is fenced by availability, transport, lifecycle, and busy state', () => {
  expect(playerQualitySelectionAllowed(playback, '1080p', {busy: false, isLive: false})).toBe(true);
  expect(playerQualitySelectionAllowed(playback, '4k', {busy: false, isLive: false})).toBe(false);
  expect(playerQualitySelectionAllowed(playback, '1080p', {busy: true, isLive: false})).toBe(false);
});

test('subtitle selection resolves off, sidecar, and burn-in modes behind lifecycle fences', () => {
  expect(playerSubtitleSelection(playback, 'sub_none', {busy: false, dvr: false, isLive: false})).toEqual({subtitleMode: 'off'});
  expect(playerSubtitleSelection(playback, 'text', {busy: false, dvr: false, isLive: false})).toEqual({subtitleMode: 'text', subtitleStreamId: 'text'});
  expect(playerSubtitleSelection(playback, 'burn', {busy: false, dvr: false, isLive: false})).toEqual({subtitleMode: 'burn_in', subtitleStreamId: 'burn'});
  expect(playerSubtitleSelection(playback, 'text', {busy: false, dvr: true, isLive: false})).toBeUndefined();
});
