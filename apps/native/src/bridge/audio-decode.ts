import {androidProfile, appleProfile, type AndroidNativeFacts, type AppleNativeFacts} from '../../../../packages/client-core/src/client-profile';
import type {AudioDecodeCapability} from '../../../../packages/client-core/src/playback-v1/audio-render';
import {capabilityProfileFromClient, networkClassOf} from '../../../../packages/client-core/src/playback-v1/capability-profile';
import type {CapabilityProfile} from '../../../../packages/client-core/src/playback-v1/options';

/**
 * What PorticoAudioRender (the Apple engine for the §18.1 version-2 plan) decodes on the device, for
 * the capability profile's `audioDecode` (spec §3). Only the (container, codec) pairs and limits
 * the §18.8 fixtures proved on iOS and tvOS Core Audio (exact frames, lag 0, the albums joined to
 * 0 frames); anything else the server converts to FLAC. Ogg Opus is left out: Core Audio has no
 * Ogg parser, so the server converts it. Channels stop at 2: past that the server downmixes.
 */
export const appleAudioDecode: readonly AudioDecodeCapability[] = Object.freeze([
  {codec: 'flac', containers: ['flac'], maxSampleRate: 96000, maxChannels: 2, maxBitDepth: 24, via: 'ExtAudioFile'},
  {codec: 'alac', containers: ['mp4'], maxSampleRate: 96000, maxChannels: 2, maxBitDepth: 24, via: 'ExtAudioFile'},
  {codec: 'aac', containers: ['mp4'], maxSampleRate: 48000, maxChannels: 2, maxBitDepth: 16, via: 'ExtAudioFile'},
  {codec: 'mp3', containers: ['mp3'], maxSampleRate: 48000, maxChannels: 2, maxBitDepth: 16, via: 'ExtAudioFile'},
  {codec: 'pcm', containers: ['wav'], maxSampleRate: 96000, maxChannels: 2, maxBitDepth: 24, via: 'ExtAudioFile'},
].map(c => Object.freeze(c)));

export type AppleDevice = Readonly<{television: boolean; pad: boolean; osVersion?: string; model?: string; appVersion?: string}>;

/** This device's v1 capability profile (spec §3): what `appleProfile` knows (the declared AVPlayer
 * table, narrowed by the native facts), the form, the network class, and `audioDecode`. */
export function appleCapabilityProfile(device: AppleDevice, facts: AppleNativeFacts | null, origin: string | null): CapabilityProfile {
  const client = appleProfile({television: device.television, osVersion: facts?.osVersion ?? device.osVersion, model: facts?.model ?? device.model, appVersion: device.appVersion}, facts);
  return capabilityProfileFromClient(client, {
    form: device.television ? 'tv' : device.pad ? 'tablet' : 'phone',
    network: networkClassOf(origin),
    audioDecode: appleAudioDecode,
    features: {trickplay: true, chapters: true, gapless: true, crossfade: true, pip: !device.television},
  });
}

/**
 * What the Android listening owner (ExoPlayer) decodes for the §18.1 plan, as (container, codec)
 * pairs `PorticoAudioPlan.kt` accepts. ALAC is absent: Android has no decoder for it, so the server
 * converts it to FLAC. Ogg Opus is present (Android has both the parser and the decoder), which
 * lets the server answer a bitrate limit with Opus. Channels stop at 2: past that the server
 * downmixes.
 */
export const androidAudioDecode: readonly AudioDecodeCapability[] = Object.freeze([
  {codec: 'flac', containers: ['flac'], maxSampleRate: 96000, maxChannels: 2, maxBitDepth: 24, via: 'Media3'},
  {codec: 'aac', containers: ['mp4'], maxSampleRate: 48000, maxChannels: 2, maxBitDepth: 16, via: 'Media3'},
  {codec: 'mp3', containers: ['mp3'], maxSampleRate: 48000, maxChannels: 2, maxBitDepth: 16, via: 'Media3'},
  {codec: 'opus', containers: ['ogg'], maxSampleRate: 48000, maxChannels: 2, maxBitDepth: 16, via: 'Media3'},
  {codec: 'vorbis', containers: ['ogg'], maxSampleRate: 48000, maxChannels: 2, maxBitDepth: 16, via: 'Media3'},
  {codec: 'pcm', containers: ['wav'], maxSampleRate: 96000, maxChannels: 2, maxBitDepth: 24, via: 'Media3'},
].map(c => Object.freeze(c)));

/** The table narrowed to the decoders this device reports (`MediaCodecList`); PCM needs none. */
export function androidAudioDecodeFor(facts: AndroidNativeFacts | null): readonly AudioDecodeCapability[] {
  const decoders = facts?.audioDecoders;
  if (!decoders) return androidAudioDecode;
  const known = new Set(decoders.map(d => d.codec));
  return androidAudioDecode.filter(c => c.codec === 'pcm' || known.has(c.codec));
}

export type AndroidDevice = AppleDevice & Readonly<{family: 'android' | 'androidtv' | 'firetv'}>;

/** This device's v1 capability profile on Android: `androidProfile` (the declared Media3 table,
 * replaced by what `MediaCodecList`, the display and the audio output report), the form, the
 * network class, and `audioDecode`. */
export function androidCapabilityProfile(device: AndroidDevice, facts: AndroidNativeFacts | null, origin: string | null): CapabilityProfile {
  const client = androidProfile({family: device.family, television: device.television, osVersion: facts?.osVersion ?? device.osVersion, model: facts?.model ?? device.model}, facts);
  return capabilityProfileFromClient(client, {
    form: device.television ? 'tv' : device.pad ? 'tablet' : 'phone',
    network: networkClassOf(origin),
    audioDecode: androidAudioDecodeFor(facts),
    features: {trickplay: true, chapters: true, gapless: true, crossfade: true, pip: !device.television},
  });
}
