/** What a download brought with it, as the offline player uses it: subtitle files on the device,
 * chapters and skip markers, and the file's own description for the choice of player. */
import test from 'node:test';
import assert from 'node:assert/strict';
import {offlineChapters, offlineContainer, offlineMarkers, offlineSubtitleCommand, offlineSubtitleTracks} from '../src/player/offline-extras.ts';
import {captionStyle, defaultCaptionStyle} from '../src/player/caption-style.ts';
import {chooseEngine, localRuleFacts} from '../src/player/engine-choice.ts';

const dir = 'file:///data/user/0/tv.getportico.portico/no_backup/Downloads/dl1/extras/';
const extras: any = {
  backdropUrl: '',
  subtitles: [
    {id: 's1', language: 'en', title: 'English', default: true, forced: false, format: 'vtt', url: dir + 'sub-s1-3.vtt'},
    {id: 's2', language: 'ja', title: 'Signs', default: false, forced: true, format: 'ass', url: dir + 'sub-s2-1.ass'},
    {id: 's3', language: 'fr', title: 'Elsewhere', default: false, forced: false, format: 'vtt', url: 'https://example.test/sub.vtt'},
  ],
  bundle: {
    media: {container: 'matroska,webm', videoCodec: 'hevc', audioCodec: 'dts', width: 1920, height: 1080},
    chapters: [{index: 1, title: 'Two', startSeconds: 300, endSeconds: 600}, {index: 0, title: 'One', startSeconds: 0, endSeconds: 300}],
    markers: [{kind: 'intro', startSeconds: 30, endSeconds: 90, automatic: true}, {kind: 'credits', startSeconds: 5000, endSeconds: 5200, automatic: false}, {kind: 'intro', startSeconds: 90, endSeconds: 30, automatic: true}, {kind: 'smell', startSeconds: 1, endSeconds: 2}],
  },
};
const binding = {intentId: 4, sessionId: 'local:dl1:1', generation: 1};

test('a download offers the subtitle files stored with it that some player here can draw', () => {
  assert.deepEqual(offlineSubtitleTracks(extras, ['text']).map(t => t.id), ['s1'], 'the platform player: text only, and only files on this device');
  const both = offlineSubtitleTracks(extras, ['text', 'ass', 'pgs']);
  assert.deepEqual(both.map(t => [t.id, t.kind]), [['s1', 'text'], ['s2', 'ass']]);
  assert.deepEqual(offlineSubtitleTracks(undefined, ['text']), []);
});

test('a chosen text track is a WebVTT file the engine reads; a styled one goes to the engine that draws it', () => {
  const [text, styled] = offlineSubtitleTracks(extras, ['text', 'ass']);
  assert.deepEqual(offlineSubtitleCommand(undefined, binding, 2, ['text'], defaultCaptionStyle), {binding, mode: 'off', revision: 2});
  const native = offlineSubtitleCommand(text, binding, 3, ['text'], defaultCaptionStyle);
  assert.equal(native.mode, 'track');
  assert.equal(native.documentUrl, dir + 'sub-s1-3.vtt');
  assert.deepEqual(native.render, {kind: 'text', url: dir + 'sub-s1-3.vtt'});
  assert.deepEqual(native.style, {scale: 1, background: 'translucent'});
  const mpv = offlineSubtitleCommand(styled, binding, 4, ['text', 'ass'], captionStyle('large', 'opaque'));
  assert.equal(mpv.documentUrl, undefined);
  assert.deepEqual(mpv.render, {kind: 'ass', url: dir + 'sub-s2-1.ass'});
  assert.deepEqual(mpv.style, {scale: 1.3, background: 'opaque'});
  assert.equal(offlineSubtitleCommand(styled, binding, 5, ['text'], defaultCaptionStyle).mode, 'off', 'an engine that cannot draw it shows nothing rather than something wrong');
});

test('every stored kind is offered to a player that draws it: DVB, a VobSub index, a styled track with its fonts', () => {
  const rich: any = {backdropUrl: '', subtitles: [
    {id: 'd1', language: 'de', title: 'DVB', default: false, forced: false, format: 'dvb', url: dir + 'sub-d1-1.dvb'},
    {id: 'v1', language: 'en', title: 'DVD', default: false, forced: false, format: 'vobsub', url: dir + 'sub-v1-2.idx'},
    {id: 'a1', language: 'ja', title: 'Styled', default: true, forced: false, format: 'ass', url: dir + 'sub-a1-1.ass', fonts: [{name: 'sub-a1-1.font0', url: dir + 'sub-a1-1.font0'}, {name: 'elsewhere', url: 'https://example.test/font.ttf'}]},
  ]};
  const drawn = ['text', 'ass', 'pgs', 'vobsub', 'dvb'];
  assert.deepEqual(offlineSubtitleTracks(rich, ['text']), [], 'the platform player draws none of these');
  const [dvb, vobsub, styled] = offlineSubtitleTracks(rich, drawn);
  assert.deepEqual([dvb!.kind, vobsub!.kind, styled!.kind], ['dvb', 'vobsub', 'ass']);
  assert.deepEqual(offlineSubtitleCommand(dvb, binding, 2, drawn, defaultCaptionStyle).render, {kind: 'dvb', url: dir + 'sub-d1-1.dvb'});
  // The index is what the player opens; the pictures are the file beside it with the same name ending .sub.
  assert.deepEqual(offlineSubtitleCommand(vobsub, binding, 3, drawn, defaultCaptionStyle).render, {kind: 'vobsub', url: dir + 'sub-v1-2.idx'});
  // Fonts travel with the styled file, and only as files on this device.
  assert.deepEqual(offlineSubtitleCommand(styled, binding, 4, drawn, defaultCaptionStyle).render, {kind: 'ass', url: dir + 'sub-a1-1.ass', fonts: [{name: 'sub-a1-1.font0', url: dir + 'sub-a1-1.font0'}]});
  assert.equal(offlineSubtitleCommand(styled, binding, 5, drawn, defaultCaptionStyle).documentUrl, undefined);
});

test('chapters and skip markers come from the download itself', () => {
  assert.deepEqual(offlineChapters(extras), [{startSeconds: 0, title: 'One'}, {startSeconds: 300, title: 'Two'}]);
  const markers = offlineMarkers(extras, 'movie-1')!;
  assert.deepEqual(markers.markers.map(m => [m.kind, m.startSeconds, m.endSeconds, m.automaticSafe]), [['intro', 30, 90, true], ['credits', 5000, 5200, false]]);
  assert.equal(offlineMarkers({subtitles: [], backdropUrl: ''} as never, 'movie-1'), null);
});

test('a download the platform player cannot open plays in mpv, by what the download says of its own file', () => {
  assert.equal(offlineContainer(extras), 'matroska,webm');
  // The file was saved under a name that says nothing ("media"): the download's own description decides.
  const facts = localRuleFacts({address: 'file:///downloads/dl1/media', local: true, platform: 'apple', container: offlineContainer(extras)});
  assert.equal(facts.nativeNeeds, 'video-conversion');
  assert.equal(chooseEngine({setting: 'automatic', mpvAvailable: true, ...facts}), 'mpv');
  assert.equal(chooseEngine({setting: 'automatic', mpvAvailable: false, ...facts}), 'native');
  assert.equal(localRuleFacts({address: 'file:///downloads/dl1/media', local: true, platform: 'android', container: 'matroska,webm'}).nativeNeeds, 'nothing', 'Media3 opens Matroska');
  assert.equal(localRuleFacts({address: 'file:///downloads/dl1/media', local: true, platform: 'apple', container: 'mov,mp4,m4a,3gp,3g2,mj2'}).nativeNeeds, 'nothing');
});

test('the caption style is the profile\'s size and background', () => {
  assert.equal(captionStyle('medium', 'translucent'), defaultCaptionStyle);
  assert.deepEqual(captionStyle('extra-large', 'none'), {scale: 1.6, background: 'none'});
  assert.deepEqual(captionStyle(undefined, 'something else'), defaultCaptionStyle);
});
