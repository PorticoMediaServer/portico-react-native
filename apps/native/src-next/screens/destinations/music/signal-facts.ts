import {Platform} from 'react-native';
import type {NativePlaybackRuntimeSnapshot} from '../../../platform/playback/types';
import type {DeviceEqualizer} from '../../../platform/playback/equalizer';
import type {MusicFormatFacts, MusicOutputFacts, MusicServerSignal, MusicSignalInput} from '../../../../../../packages/client-core/src/music-signal';

const LOSSLESS = new Set(['flac', 'alac', 'wavpack', 'ape', 'tta', 'mlp', 'truehd', 'pcm']);

type AudioFacts = Readonly<{codec?: string; profile?: string; variant?: string; objectAudio?: string; channels?: number; layout?: string; sampleRate?: number; bitDepth?: number; delivery?: string}>;

function format(facts: AudioFacts | undefined): MusicFormatFacts | undefined {
  if (!facts?.codec) return undefined;
  const codec = facts.codec.toLowerCase();
  return Object.freeze({
    codec, lossless: LOSSLESS.has(codec) || codec.startsWith('pcm_') || codec.startsWith('dsd'),
    ...(facts.bitDepth ? {bitDepth: facts.bitDepth} : {}), ...(facts.sampleRate ? {sampleRate: facts.sampleRate} : {}),
    ...(facts.channels ? {channels: facts.channels} : {}), ...(facts.layout ? {layout: facts.layout} : {}),
    ...(facts.objectAudio === 'atmos' ? {atmos: true} : {}),
    ...(codec.startsWith('dsd_') ? {dsdMultiple: codec.endsWith('64') ? 64 : codec.endsWith('128') ? 128 : codec.endsWith('256') ? 256 : undefined} : {}),
  });
}

/** music-plus (MC-8): the line and sheet describe the committed plan and the engine's own
 * current-song facts. Nothing here infers an applied effect from a setting: the EQ's applied
 * fact is the listening snapshot's, and an unreported rate is never a matched one. */
export function nativeMusicSignal(snapshot: NativePlaybackRuntimeSnapshot, equalizer: DeviceEqualizer | undefined): MusicSignalInput | undefined {
  const info = snapshot.session?.playbackInfo, listening = snapshot.playback.nativeListening;
  const source = format(info?.source.audio as AudioFacts | undefined);
  if (!source) return undefined;
  const delivered = format(info?.delivered.audio as AudioFacts | undefined);
  const atmosLost = info?.losses?.some(loss => loss.feature === 'atmos') === true;
  const dsdConverted = info?.route === 'converted' && !!info.source.audio?.codec?.toLowerCase().startsWith('dsd_');
  const server: MusicServerSignal | undefined = info ? Object.freeze({
    route: info.route,
    ...(delivered ? {delivered} : {}),
    ...(dsdConverted ? {dsdConverted: true} : {}),
    ...(atmosLost ? {atmosLost: true} : {}),
  }) : undefined;
  const delivery = (info?.delivered.audio as AudioFacts | undefined)?.delivery;
  // The output route is an engine observation, never a setting: an unreported rate is left out.
  const observed = snapshot.session?.observedPlayback?.audio;
  const platform: MusicOutputFacts['platform'] = Platform.OS === 'ios' ? 'apple' : Platform.OS === 'android' ? 'android' : 'other';
  const sampleRate = observed?.sampleRate && Number.isFinite(observed.sampleRate) ? observed.sampleRate : undefined;
  const output: MusicOutputFacts = Object.freeze({
    platform, device: Platform.isTV ? 'tv' : 'phone',
    ...(delivery === 'passthrough' || observed?.handling === 'passthrough' ? {passthrough: true} : {}),
    ...(sampleRate ? {sampleRate} : {}),
    ...(observed?.bitDepth ? {bitDepth: observed.bitDepth} : {}),
    ...(observed?.layout ? {decodedLayout: observed.layout} : {}),
    // Apple never claims bit-perfect; it says the rate is matched, and only when the engine
    // reported an output rate equal to the file's own.
    ...(platform === 'apple' && sampleRate && source.sampleRate === sampleRate ? {sampleRateMatched: true} : {}),
  });
  return Object.freeze({
    source, ...(server ? {server} : {}), output,
    eqOn: equalizer?.on === true, eqApplied: listening?.eqApplied === true,
    normalization: 'off', levelingApplied: listening?.levelingApplied === true,
  });
}
