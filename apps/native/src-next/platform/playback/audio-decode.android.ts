import type {AndroidNativeFacts} from '../../../../../packages/client-core/src/client-profile';
import type {AudioDecodeCapability} from '../../../../../packages/client-core/src/playback-v1/audio-render';
export const appleAudioDecode: readonly AudioDecodeCapability[] = [];
type OutputFacts = AndroidNativeFacts & {audio?: {maxOutputChannels?: number; sampleRates?: number[]; maxSampleRate?: number; maxBitDepth?: number; route?: string}};
/** Decoder limits are intersected with real route limits; an unknown rate is left unknown. */
export function androidAudioDecodeFor(facts: AndroidNativeFacts | null): readonly AudioDecodeCapability[] {
  const output=(facts as OutputFacts | null)?.audio;
  const decoders=facts?.audioDecoders ?? [];
  const known=new Map(decoders.map(d=>[d.codec,d.maxChannels]));
  const pairs: readonly [string,readonly string[],number][] = [
    ['flac',['flac','mkv'],24],['alac',['mp4','mkv'],24],['aac',['mp4','adts'],24],['mp3',['mp3'],24],
    ['opus',['ogg','mkv'],24],['vorbis',['ogg','mkv'],24],['truehd',['mkv'],24],['dts',['mkv'],24],['eac3',['mp4','mkv'],24],['ac3',['mp4','mkv'],16],['pcm',['wav'],32],
  ];
  return pairs.filter(([codec])=>codec==='pcm'||known.has(codec)).map(([codec,containers,depth])=>({codec,containers:[...containers],
    maxChannels:Math.min(output?.maxOutputChannels??2,known.get(codec)??32),maxBitDepth:Math.min(depth,output?.maxBitDepth??depth),
    ...(output?.sampleRates?.length?{sampleRates:output.sampleRates.filter(r=>Number.isSafeInteger(r)&&r>=8000&&r<=768000).slice(0,32)}:{}),
    maxSampleRate:output?.maxSampleRate??48000,via:'Media3/FFmpeg'}));
}
export const androidAudioDecode: readonly AudioDecodeCapability[] = [];
