import test from 'node:test';
import assert from 'node:assert/strict';
import {NativeOfflineTracks} from '../src-next/platform/playback/offline-tracks.ts';
import type {StoredSubtitle} from '../platform/offline-subtitle-files.ts';

const binding = {intentId: 1, sessionId: 'local:copy:1', generation: 1};
const directory = 'file:///Downloads/copy/';
const subtitle = (patch: Partial<StoredSubtitle> = {}): StoredSubtitle => ({id: 'captions', revision: 4, language: 'en', title: 'English',
  default: true, forced: false, format: 'vtt', url: directory + 'extras/sub-captions-4.vtt', ...patch});
function tracks(subtitles: readonly StoredSubtitle[] = [subtitle()]) {
  return new NativeOfflineTracks({entryId: 'copy', itemId: 'movie', playId: 'play', fileUrl: directory + 'media', durationSeconds: 100, startSeconds: 0,
    extras: {subtitles, backdropUrl: ''}}, binding);
}

test('saved VTT selection and timing use the local file and remain one playback choice', () => {
  const local = tracks(); local.configure('native', 'one', ['text']);
  assert.equal(local.getSnapshot().subtitles.length, 1); assert.equal(local.getSnapshot().subtitleTrackId, null);
  local.choose({subtitleTrackId: 'captions', subtitleOffsetMs: 1500});
  const command = local.subtitleCommand({size: 'medium'}, true);
  assert.equal(command.documentUrl, subtitle().url); assert.equal(command.offsetUs, '1500000'); assert.equal(command.resourceRevision, 4);
  assert.deepEqual(command.binding, binding); assert.equal(command.origin, 'sidecar');
  assert.equal(local.subtitleCommand({}, false).mode, 'off');
  assert.equal(local.subtitleCommand({}, true).documentUrl, subtitle().url);
  local.choose({subtitleTrackId: null}); assert.equal(local.subtitleCommand({}, true).mode, 'off'); assert.equal(local.getSnapshot().subtitleOffsetMs, 0);
  assert.equal(tracks().getSnapshot().subtitleTrackId, null, 'nothing is remembered per title');
});

test('a saved rich original retains its plain reading for native and its fonts for mpv', () => {
  const local = tracks([subtitle({format: 'ass', url: directory + 'extras/sub.ass', textUrl: directory + 'extras/sub.vtt',
    fonts: [{name: 'font0', url: directory + 'extras/font0'}, {name: 'foreign', url: 'https://invalid.test/font'}]})]);
  local.configure('native', 'one', ['text']); local.choose({subtitleTrackId: 'captions'});
  assert.equal(local.subtitleCommand({}, true).documentUrl, directory + 'extras/sub.vtt');
  assert.equal(local.requiredRendering(), 'ass');
  local.configure('mpv', 'two', ['text', 'ass']);
  assert.deepEqual(local.subtitleCommand({}, true).render, {kind: 'ass', url: directory + 'extras/sub.ass', fonts: [{name: 'font0', url: directory + 'extras/font0'}]});
  assert.equal(local.subtitleCommand({}, true).documentUrl, directory + 'extras/sub.vtt', 'the saved plain reading remains available if the rich renderer refuses');
});

test('an engine without local timing support keeps the saved correction and refuses an ignored offset', () => {
  const local = tracks(); local.configure('native', 'apple', ['text'], ['text'], false);
  local.choose({subtitleTrackId: 'captions'});
  assert.equal(local.getSnapshot().subtitleTimingSupported, false);
  assert.equal(local.subtitleCommand({}, true).offsetUs, '0');
  assert.throws(() => local.choose({subtitleOffsetMs: 500}));
  local.choose({subtitleOffsetMs: 0});
  assert.equal(local.getSnapshot().subtitleOffsetMs, 0);
});

test('a failed local subtitle is reported without failing media and clears on success or Off', () => {
  const local = tracks(); local.configure('native', 'one', ['text']);
  assert.equal(local.accept({type: 'subtitleStatus', error: 'not loaded'}), undefined);
  local.choose({subtitleTrackId: 'captions'});
  assert.equal(local.accept({type: 'subtitleStatus', error: 'not loaded'}), 'changed');
  assert.equal(local.getSnapshot().subtitleError, true);
  assert.equal(local.getSnapshot().subtitleTrackId, 'captions');
  local.accept({type: 'subtitleStatus', error: ''}); assert.equal(local.getSnapshot().subtitleError, undefined);
  local.accept({type: 'subtitleStatus', error: 'not loaded'});
  local.choose({subtitleTrackId: null}); assert.equal(local.getSnapshot().subtitleError, undefined);
});

test('image captions require a real available renderer and wait for its engine before applying', () => {
  const local = tracks([subtitle({format: 'vobsub', url: directory + 'extras/sub.idx'})]);
  local.configure('native', 'one', ['text']); assert.equal(local.getSnapshot().subtitles[0]!.unavailable, true);
  assert.throws(() => local.choose({subtitleTrackId: 'captions'}));
  local.configure('native', 'one', ['text'], ['text', 'vobsub']); local.choose({subtitleTrackId: 'captions'});
  assert.equal(local.requiredRendering(), 'vobsub'); assert.equal(local.subtitleCommand({}, true).mode, 'off');
  local.configure('mpv', 'two', ['text', 'vobsub']);
  assert.deepEqual(local.subtitleCommand({}, true).render, {kind: 'vobsub', url: directory + 'extras/sub.idx', companionUrl: directory + 'extras/sub.sub'});
});

test('files outside the admitted download and ambiguous identities are never offered', () => {
  const local = tracks([subtitle(), subtitle(), subtitle({id: 'remote', url: 'https://invalid.test/sub.vtt'}),
    subtitle({id: 'other-copy', url: 'file:///Downloads/other/sub.vtt'}), subtitle({id: 'query', url: directory + 'extras/sub.vtt?request=1'}),
    subtitle({id: 'encoded-escape', url: directory + 'extras/%2f..%2f..%2fother/sub.vtt'}),
    subtitle({id: 'valid', textUrl: 'https://invalid.test/fallback.vtt'})]);
  local.configure('native', 'one', ['text']); assert.deepEqual(local.getSnapshot().subtitles.map(track => track.id), ['valid']);
  for (const choice of [{subtitleTrackId: 'remote'}, {subtitleTrackId: 'captions'}, {quality: {mode: 'original'}}, {subtitleOffsetMs: Infinity}, {subtitleOffsetMs: 600_001}])
    assert.throws(() => local.choose(choice as any));
});

test('offline mpv audio uses actual engine indices and native applied readback', () => {
  const local = tracks(); local.configure('mpv', 'one', ['text']);
  local.accept({type: 'mediaInfo', audioTracks: [{streamIndex: 1, codec: 'aac', selected: true}, {streamIndex: 7, codec: 'ac3', title: 'Commentary'}]});
  assert.equal(local.getSnapshot().audioTrackId, 'a1');
  local.choose({audioTrackId: 'a7'}); const command = local.audioCommand()!;
  assert.equal(command.streamIndex, 7); assert.equal(local.getSnapshot().audioTrackId, 'a1', 'a request is not applied output');
  assert.equal(local.accept({type: 'audioTrackApplied', audioTrackRevision: command.revision, streamIndex: 1}), undefined);
  assert.equal(local.accept({type: 'audioTrackApplied', audioTrackRevision: command.revision, streamIndex: 7}), 'changed');
  assert.equal(local.getSnapshot().audioTrackId, 'a7'); assert.equal(local.localAudioCommand(), null);
  local.configure('mpv', 'replacement', ['text']);
  const restored = local.audioCommand()!;
  assert.equal(restored.streamIndex, 7); assert.ok(restored.revision > command.revision); assert.deepEqual(local.getSnapshot().audio, []);
  assert.equal(local.getSnapshot().audioTrackId, undefined, 'a retained request is not replacement-engine readback');
  assert.equal(local.accept({type: 'audioTrackApplied', audioTrackRevision: command.revision, streamIndex: 7}), undefined);
  assert.equal(local.accept({type: 'audioTrackApplied', audioTrackRevision: restored.revision, streamIndex: 7}), 'changed');
  local.configure('native', 'different-engine', ['text']); assert.equal(local.audioCommand(), null, 'no cross-engine index mapping is guessed');
});

test('offline Media3 selection names its exact catalogue and an opaque actual track', () => {
  const local = tracks(); local.configure('native', 'one', ['text']);
  const fact = {type: 'mediaInfo', audioTrackCatalogRevision: 3, audioTracks: [{id: 'track-10', codec: 'aac', selected: true}, {id: 'track-11', codec: 'aac'}]};
  local.accept(fact); local.choose({audioTrackId: 'track-11'}); const command = local.localAudioCommand()!;
  assert.equal(command.catalogRevision, 3); assert.equal(command.trackId, 'track-11'); assert.equal(local.audioCommand(), null);
  const applied = {type: 'localAudioTrackApplied', audioTrackRevision: command.revision, catalogRevision: 3, trackId: 'track-11'};
  assert.equal(local.accept({...applied, catalogRevision: 2}), undefined); assert.equal(local.getSnapshot().audioTrackId, 'track-10');
  assert.equal(local.accept(applied), 'changed'); assert.equal(local.getSnapshot().audioTrackId, 'track-11');
  local.accept({...fact, audioTrackCatalogRevision: 4}); assert.equal(local.localAudioCommand(), null);
  assert.equal(local.accept(applied), undefined, 'old inventory cannot settle a new catalogue');
});

test('audio failures are surfaced and invalid or duplicate native tracks cannot select by ordinal', () => {
  const local = tracks(); local.configure('mpv', 'one', ['text']);
  local.accept({type: 'mediaInfo', audioTracks: [{streamIndex: 1}, {streamIndex: 7}]}); local.choose({audioTrackId: 'a7'});
  const pending = local.audioCommand()!;
  assert.equal(local.accept({type: 'audioTrackFailed', audioTrackRevision: pending.revision, streamIndex: 7}), 'failed'); assert.equal(local.audioCommand(), null);
  assert.throws(() => local.choose({audioTrackId: 'a0'}));
  const before = local.getSnapshot(); local.accept({type: 'mediaInfo', audioTracks: [{streamIndex: 3}, {streamIndex: 3}]}); assert.equal(local.getSnapshot(), before);
  local.configure('native', 'new', ['text']);
  const native = local.getSnapshot();
  for (const id of ['track\u0000-id', 'x'.repeat(513)]) {
    local.accept({type: 'mediaInfo', audioTrackCatalogRevision: 1, audioTracks: [{id}]});
    assert.equal(local.getSnapshot(), native, 'an opaque native identity must never be changed by display-text sanitization');
  }
});
