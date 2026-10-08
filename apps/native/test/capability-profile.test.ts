/** Spec §3 and §18.1: the Apple v1 capability profile, and the server's audio plan mode from it. */
import test from 'node:test';
import assert from 'node:assert/strict';
import {appleAudioDecode, appleCapabilityProfile} from '../src/bridge/audio-decode.ts';
import {networkClassOf} from '../../../packages/client-core/src/playback-v1/capability-profile.ts';
import {CapabilityPublisher} from '../../../packages/client-core/src/playback-v1/options.ts';
import {SessionsClient} from '../../../packages/client-core/src/playback-v1/sessions.ts';
import {FakePlaybackServer, fakeHttp, type FakeAudioSource} from '../../../packages/client-core/src/playback-v1/testing/fake-server.ts';
import type {V1Http} from '../../../packages/client-core/src/playback-v1/http.ts';

const phone = {television: false, pad: false, osVersion: '26.4', appVersion: '1.0'};

test('the profile carries the form, the network class, what AVPlayer plays and what the engine decodes', () => {
  const p = appleCapabilityProfile(phone, null, 'http://192.168.1.20:32500');
  assert.equal(p.form, 'phone');
  assert.deepEqual(p.network, {class: 'local'});
  assert.deepEqual(p.audioDecode, appleAudioDecode);
  assert.ok(p.containers.some(c => c.container === 'mp4' && c.direct));
  assert.ok(p.containers.some(c => c.container === 'flac'));
  assert.deepEqual(p.streaming.hls, {fmp4: true, ts: true});
  assert.ok(p.video.some(v => v.codec === 'hevc'));
  assert.ok(p.audio.some(a => a.codec === 'eac3' && a.atmos === true));
  assert.equal(p.features.gapless, true);
  assert.equal(appleCapabilityProfile({...phone, television: true}, null, 'https://portico.example.com').form, 'tv');
  assert.equal(appleCapabilityProfile({...phone, pad: true}, null, null).form, 'tablet');
});

test('audioDecode declares only the fixture-proven pairs; Ogg Opus is left to the server', () => {
  const pairs = appleAudioDecode.flatMap(d => d.containers.map(c => `${c}/${d.codec}`)).sort();
  assert.deepEqual(pairs, ['flac/flac', 'mp3/mp3', 'mp4/aac', 'mp4/alac', 'wav/pcm']);
  assert.ok(appleAudioDecode.every(d => d.maxChannels === 2));
});

test('the network class: private addresses and .local names are local', () => {
  for (const o of ['http://10.0.0.4:32500', 'http://172.20.1.1', 'http://portico.local:32500', 'http://127.0.0.1:8080', 'http://[fd12::1]:80']) assert.equal(networkClassOf(o).class, 'local', o);
  for (const o of ['https://portico.example.com', 'http://8.8.8.8', 'https://fdroid.example.com', 'https://fc.example.org', 'http://10.0.0.300', null]) assert.equal(networkClassOf(o).class, 'remote', String(o));
  assert.equal(networkClassOf('http://[fe80::1]:32400').class, 'local');
  assert.equal(networkClassOf('http://10.0.0.4', true).class, 'cellular');
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

test('with the profile published, a declared pair plays direct and the rest is converted to FLAC; without it, unavailable', async () => {
  const server = new FakePlaybackServer({modeFromCapabilities: true, audioSource: id => sources[id]});
  assert.equal((await planFor(server, 'song-mp3'))?.mode, 'unavailable', 'no profile: nothing declared');
  const publisher = new CapabilityPublisher(fakeHttp(server) as unknown as V1Http);
  assert.equal(await publisher.publish(appleCapabilityProfile(phone, null, 'http://10.0.0.4')), true);
  assert.equal(await publisher.publish(appleCapabilityProfile(phone, null, 'http://10.0.0.4')), false, 'an unchanged profile is not sent again');
  const mp3 = await planFor(server, 'song-mp3');
  assert.equal(mp3?.mode, 'direct');
  const opus = await planFor(server, 'song-opus');
  assert.equal(opus?.mode, 'converted');
  assert.equal(opus?.container, 'flac');
  assert.match(opus?.reason ?? '', /FLAC/);
  assert.equal((await planFor(server, 'song-flac-192'))?.mode, 'converted', 'past the declared sample rate');
});
