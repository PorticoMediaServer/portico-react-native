import type {ClientAudioCodec, ClientTransport, ClientVideoCodec, DynamicRange, ProfileEvidence} from '../../../../packages/client-core/src/client-profile';

/**
 * What the mpv engine can play on this device: the second profile of the capability document,
 * beside the platform player's (`engines.mpv`, next to `engines.native`). The codec, transport and
 * evidence shapes are the ones the app's capability probe already uses (`client-profile.ts`).
 *
 * mpv brings its own demuxers and decoders (FFmpeg), so what it can *open* is the same on every
 * device. What differs by device is what it can decode *in time*:
 *
 * - Codecs the chip decodes in hardware (VideoToolbox: H.264, HEVC, and on newer chips VP9 and
 *   AV1) play at the chip's limits.
 * - Everything else is decoded in software, within limits set by the device's class. The class is
 *   taken from memory and processor count, which every platform can report the same way.
 *
 * The picture is drawn by mpv's own renderer, which tone-maps HDR and Dolby Vision (profiles 5, 7
 * and 8) to whatever the screen shows, so no HDR title needs the server's tone mapping for this
 * engine. Sound is decoded on the device to PCM in as many channels as the output takes; nothing
 * is passed through as a bitstream, and object audio (Atmos, DTS:X) plays as its channel bed.
 */
export type MpvDeviceFacts = Readonly<{
  available?: boolean;
  memoryBytes?: number;
  processorCount?: number;
  hardwareDecode?: Readonly<{h264?: boolean; hevc?: boolean; vp9?: boolean; av1?: boolean}>;
  /** The screen can show HDR drawn by this engine (an iPhone or iPad with an HDR panel). */
  hdrOutput?: boolean;
  screen?: Readonly<{width: number; height: number; maxFrameRate?: number}>;
  audio?: Readonly<{maxOutputChannels?: number}>;
}>;

export type SubtitleRenderingKind = 'text' | 'ass' | 'pgs' | 'vobsub' | 'dvb';

/** One engine of the capability document (the server's `EngineCapabilities`). */
export type EngineCapabilities = Readonly<{
  name: string;
  version?: string;
  evidence: ProfileEvidence;
  video: readonly ClientVideoCodec[];
  audio: readonly ClientAudioCodec[];
  audioPassthrough: readonly Readonly<{codec: string; maxChannels?: number; objectAudio?: readonly string[]; evidence?: ProfileEvidence}>[];
  transports: readonly ClientTransport[];
  subtitleRendering: readonly SubtitleRenderingKind[];
  toneMapsHdr: boolean;
  embeddedAudioSwitching: boolean;
}>;

/** How much software decoding the device can keep up with. */
export type MpvDeviceClass = 'light' | 'standard' | 'strong';

const GiB = 1024 ** 3;

/**
 * - light: 2.5 GB of memory or less, or two processor cores (Apple TV HD, phones and tablets of
 *   that age). Software decoding of the heavy codecs is left to the server.
 * - standard: up to 5 GB (Apple TV 4K, most phones). Heavy codecs in software up to 1080p.
 * - strong: more than 5 GB and six or more cores (recent Pro phones, iPad Pro and Air).
 *   Heavy codecs in software up to 4K at film frame rates.
 * Unknown (the module did not answer): light, with no heavy software decoding claimed.
 */
export function mpvDeviceClass(facts: MpvDeviceFacts | null): MpvDeviceClass {
  const memory = facts?.memoryBytes, cores = facts?.processorCount;
  if (!memory || !Number.isFinite(memory) || memory <= 0) return 'light';
  if (memory <= 2.5 * GiB || (!!cores && cores <= 2)) return 'light';
  if (memory > 5 * GiB && (!cores || cores >= 6)) return 'strong';
  return 'standard';
}

type Limit = Readonly<{maxWidth: number; maxHeight: number; maxFrameRate: number}>;
const uhd60: Limit = {maxWidth: 4096, maxHeight: 2304, maxFrameRate: 60};
const hd60: Limit = {maxWidth: 1920, maxHeight: 1080, maxFrameRate: 60};
const hd30: Limit = {maxWidth: 1920, maxHeight: 1080, maxFrameRate: 30};
const uhd30: Limit = {maxWidth: 4096, maxHeight: 2304, maxFrameRate: 30};

/** Software limits for the codecs that cost the most to decode (HEVC, VP9, AV1, 10-bit H.264). */
const heavySoftware: Record<MpvDeviceClass, Limit | null> = {light: null, standard: hd30, strong: uhd30};
/** Software limits for the older, cheap codecs (MPEG-2, MPEG-4 part 2, VC-1, VP8). */
const lightSoftware: Record<MpvDeviceClass, Limit> = {light: hd30, standard: hd60, strong: hd60};

const hdrRanges: readonly DynamicRange[] = ['sdr', 'hdr10', 'hdr10plus', 'hlg'];

const audio: readonly ClientAudioCodec[] = ([
  ['aac', 8], ['mp3', 2], ['mp2', 2], ['ac3', 6], ['eac3', 8], ['dts', 8], ['truehd', 8], ['mlp', 8],
  ['flac', 8], ['alac', 8], ['opus', 8], ['vorbis', 8], ['pcm', 8], ['wmav2', 2], ['wmapro', 8],
] as const).map(([codec, maxChannels]) => Object.freeze({codec, maxChannels, evidence: 'declared' as const}));

const fileContainers = ['mkv', 'webm', 'mp4', 'm4v', 'mov', 'avi', 'ts', 'm2ts', 'mts', 'mpg', 'mpeg', 'vob', 'wmv', 'asf', 'flv', 'ogv', 'ogm', '3gp', 'divx'];

/**
 * The mpv engine's capabilities on this device. `facts` is what `PorticoMpvPlaybackModule.facts()`
 * reports; null (it could not be asked) gives a conservative 1080p H.264 baseline. A decoder
 * availability probe does not establish its maximum dimensions or software decoding throughput.
 */
export function mpvEngineCapabilities(facts: MpvDeviceFacts | null): EngineCapabilities {
  const tier = mpvDeviceClass(facts);
  const hardware = {h264: facts?.hardwareDecode?.h264 !== false, hevc: facts?.hardwareDecode?.hevc === true, vp9: facts?.hardwareDecode?.vp9 === true, av1: facts?.hardwareDecode?.av1 === true};
  const probed: ProfileEvidence = facts ? 'mixed' : 'declared';
  const heavy = heavySoftware[tier], light = lightSoftware[tier];
  const video: ClientVideoCodec[] = [];
  // H.264: 8-bit in hardware. 10-bit (Hi10P) has no hardware decoder anywhere, so it is offered
  // only where software keeps up. The document has one limit per codec, so both depths must
  // fit that limit. Availability alone cannot give an A8-based Apple TV HD a 4K decoder.
  const h264Hardware = tier === 'light' ? hd60 : uhd60;
  const h264Limit = heavy ?? (hardware.h264 ? h264Hardware : hd30);
  video.push({codec: 'h264', bitDepths: heavy ? [8, 10] : [8], ...h264Limit, dynamicRanges: ['sdr'], evidence: probed});
  if (hardware.hevc || heavy) video.push({codec: 'hevc', bitDepths: [8, 10], ...(hardware.hevc ? uhd60 : heavy!), dynamicRanges: [...hdrRanges, 'dolby_vision'], dolbyVisionProfiles: [5, 7, 8], evidence: probed});
  if (hardware.vp9 || heavy) video.push({codec: 'vp9', bitDepths: [8, 10], ...(hardware.vp9 ? uhd60 : heavy!), dynamicRanges: [...hdrRanges], evidence: probed});
  if (hardware.av1 || heavy) video.push({codec: 'av1', bitDepths: [8, 10], ...(hardware.av1 ? uhd60 : heavy!), dynamicRanges: [...hdrRanges], evidence: probed});
  for (const codec of ['mpeg2video', 'vc1']) video.push({codec, bitDepths: [8], ...light, dynamicRanges: ['sdr'], interlaced: true, evidence: 'declared'});
  for (const codec of ['mpeg4', 'msmpeg4v3', 'wmv3', 'vp8', 'mpeg1video']) video.push({codec, bitDepths: [8], ...light, dynamicRanges: ['sdr'], evidence: 'declared'});
  const videoNames = video.map(v => v.codec), audioNames = audio.map(a => a.codec);
  const only = (names: string[]) => names.filter(n => videoNames.includes(n));
  const transports: ClientTransport[] = [
    {transport: 'direct', containers: fileContainers, video: videoNames, audio: audioNames},
    {transport: 'hls_ts', containers: ['mpegts'], video: only(['h264', 'hevc', 'mpeg2video']), audio: ['aac', 'mp3', 'mp2', 'ac3', 'eac3']},
    {transport: 'hls_fmp4', containers: ['fmp4'], video: only(['h264', 'hevc', 'vp9', 'av1']), audio: ['aac', 'mp3', 'ac3', 'eac3', 'flac', 'alac', 'opus']},
  ];
  return Object.freeze({
    name: 'mpv',
    evidence: facts ? 'mixed' : 'declared',
    video: Object.freeze(video.map(v => Object.freeze(v))),
    audio,
    // Nothing is handed to a receiver undecoded: the system has no way for this engine to do it.
    audioPassthrough: Object.freeze([]),
    transports: Object.freeze(transports.map(t => Object.freeze(t))),
    subtitleRendering: Object.freeze(['text', 'ass', 'pgs', 'vobsub', 'dvb'] as const),
    toneMapsHdr: true,
    embeddedAudioSwitching: true,
  });
}

/**
 * What the screen shows from this engine. An iPhone or iPad with an HDR panel shows HDR10 and HLG
 * (Dolby Vision is drawn as HDR10). An Apple TV shows this engine's picture in standard range:
 * the system gives HDR output to its own video layers only, so HDR titles are tone-mapped on the
 * device there. The server should know: an HDR title on an HDR television loses its HDR in mpv.
 */
export function mpvDisplayRanges(facts: MpvDeviceFacts | null): readonly DynamicRange[] {
  return facts?.hdrOutput === true ? ['sdr', 'hdr10', 'hlg'] : ['sdr'];
}
