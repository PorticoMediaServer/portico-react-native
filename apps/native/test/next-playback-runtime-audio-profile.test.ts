/** Spec §3 and §18.1: what the app's own audio engine decodes, as the capability document says
 * it, and the server's audio plan mode from it. */
import test from 'node:test';
import assert from 'node:assert/strict';
import {androidAudioDecodeFor, appleAudioDecode} from '../src-next/platform/playback/audio-decode.ts';
import {deviceCapabilityDocument} from '../src-next/platform/playback/capability-document.ts';
import {capabilityDocumentProblem} from '../../../packages/client-core/src/client-profile.ts';
import {CapabilityPublisher} from '../../../packages/client-core/src/playback-v1/options.ts';
import {SessionsClient} from '../../../packages/client-core/src/playback-v1/sessions.ts';
import {FakePlaybackServer, fakeHttp, type FakeAudioSource} from '../../../packages/client-core/src/playback-v1/testing/fake-server.ts';
import type {V1Http} from '../../../packages/client-core/src/playback-v1/http.ts';

const phone = {television: false, pad: false, osVersion: '26.4'};
const document = (device: Parameters<typeof deviceCapabilityDocument>[0]['device'] = phone) => deviceCapabilityDocument({setting: 'automatic', native: null, mpv: null, mpvAvailable: false, appVersion: '1.0', device});

test('the document says what kind of device this is, what its player plays and what the audio engine decodes', () => {
  const d = document();
  assert.equal(capabilityDocumentProblem(d), null);
  assert.equal(d.client.form, 'phone');
  assert.equal(d.client.appVersion, '1.0');
  assert.deepEqual(d.audioDecode, appleAudioDecode.map(a => ({...a})));
  const native = d.engines.native;
  assert.ok(native.transports!.some(t => t.transport === 'direct' && t.containers!.includes('mp4')));
  assert.ok(native.transports!.some(t => t.transport === 'hls_fmp4') && native.transports!.some(t => t.transport === 'hls_ts'));
  assert.ok(native.video!.some(v => v.codec === 'hevc'));
  assert.ok(native.audio!.some(a => a.codec === 'eac3' && a.objectAudio?.includes('atmos')));
  assert.equal(document({...phone, television: true}).client.form, 'tv');
  assert.equal(document({...phone, pad: true}).client.form, 'tablet');
  assert.equal(document({television: true, pad: false, family: 'firetv'}).client.family, 'firetv');
});

test('audioDecode declares only the fixture-proven pairs; Ogg Opus is left to the server on Apple', () => {
  const pairs = appleAudioDecode.flatMap(d => d.containers.map(c => `${c}/${d.codec}`)).sort();
  assert.deepEqual(pairs, ['adts/aac', 'flac/flac', 'mp3/mp3', 'mp4/aac', 'mp4/alac', 'wav/pcm']);
  assert.ok(appleAudioDecode.every(d => d.maxChannels === 2));
  assert.deepEqual(androidAudioDecodeFor({audioDecoders: [{codec: 'flac'}, {codec: 'opus'}]}).map(d => d.codec).sort(), ['flac', 'opus', 'pcm'], 'Android: only what the device has a decoder for (PCM needs none)');
});

const source = (container: string, codec: string, sampleRate = 44100): FakeAudioSource => ({bytes: new Uint8Array(1024), container, codec, sampleRate, channels: 2, durationFrames: 441000, trim: {startFrames: 0, endFrames: 0, source: 'none'}});
const sources: Record<string, FakeAudioSource> = {
  'song-mp3': source('mp3', 'mp3'),
  'song-opus': source('ogg', 'opus', 48000),
  'song-flac-192': source('flac', 'flac', 192000),
};

let starts = 0;
async function planFor(server: FakePlaybackServer, itemId: string) {
  const sessions = new SessionsClient(fakeHttp(server) as unknown as V1Http);
  const s = await sessions.start({itemId}, {state: 'playing'}, `key-${itemId}-${++starts}-0000000000`);
  return s.presentation.audio;
}

test('with the document published, a declared pair plays direct and the rest is converted to FLAC; without it, unavailable', async () => {
  const server = new FakePlaybackServer({modeFromCapabilities: true, audioSource: id => sources[id]});
  assert.equal((await planFor(server, 'song-mp3'))?.mode, 'unavailable', 'no profile: nothing declared');
  const publisher = new CapabilityPublisher(fakeHttp(server) as unknown as V1Http);
  assert.equal(await publisher.publish(document()), true);
  assert.equal(await publisher.publish(document()), false, 'an unchanged document is not sent again');
  const mp3 = await planFor(server, 'song-mp3');
  assert.equal(mp3?.mode, 'direct');
  const opus = await planFor(server, 'song-opus');
  assert.equal(opus?.mode, 'converted');
  assert.equal(opus?.container, 'flac');
  assert.match(opus?.reason ?? '', /FLAC/);
  assert.equal((await planFor(server, 'song-flac-192'))?.mode, 'converted', 'past the declared sample rate');
});
