import type {AndroidNativeFacts} from '../../../../../packages/client-core/src/client-profile';
import type {AudioDecodeCapability} from '../../../../../packages/client-core/src/playback-v1/audio-render';

/**
 * What PorticoAudioRender (the Apple engine for the §18.1 version-2 plan) decodes on the device, for
 * the capability document's `audioDecode` (spec §3). Only the (container, codec) pairs and limits
 * the §18.8 fixtures proved on iOS and tvOS Core Audio (exact frames, lag 0, the albums joined to
 * 0 frames); anything else the server converts to FLAC. Ogg Opus is left out: Core Audio has no
 * Ogg parser, so the server converts it. Channels stop at 2: past that the server downmixes.
 * AAC in ADTS is what the server converts to under a listening bitrate limit (B-10.11): Opus is
 * not available here, so AAC is. ADTS states no priming; the plan's trim (`aac-priming`) does.
 */
export const appleAudioDecode: readonly AudioDecodeCapability[] = Object.freeze([
  {codec: 'flac', containers: ['flac'], maxSampleRate: 96000, maxChannels: 2, maxBitDepth: 24, via: 'ExtAudioFile'},
  {codec: 'alac', containers: ['mp4'], maxSampleRate: 96000, maxChannels: 2, maxBitDepth: 24, via: 'ExtAudioFile'},
  {codec: 'aac', containers: ['mp4', 'adts'], maxSampleRate: 48000, maxChannels: 2, maxBitDepth: 16, via: 'ExtAudioFile'},
  {codec: 'mp3', containers: ['mp3'], maxSampleRate: 48000, maxChannels: 2, maxBitDepth: 16, via: 'ExtAudioFile'},
  {codec: 'pcm', containers: ['wav'], maxSampleRate: 96000, maxChannels: 2, maxBitDepth: 24, via: 'ExtAudioFile'},
].map(c => Object.freeze(c)));

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
