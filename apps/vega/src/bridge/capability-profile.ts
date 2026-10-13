import {capabilityDocumentProblem, vegaDeclaredProfile, withViewerSettings, type CapabilityDocument, type CapabilityOverrides, type EngineCapabilities} from '../../../../packages/client-core/src/client-profile';
import type {AudioDecodeCapability} from '../../../../packages/client-core/src/playback-v1/audio-render';

/** What `PorticoCapabilities.facts()` answers on Vega. */
export type VegaFacts = Readonly<{model?: string; osVersion?: string; deviceName?: string; appVersion?: string}>;

/**
 * What the app's own audio engine decodes (spec §3 `audioDecode`, §18.1). Music and audiobooks
 * play through the media element here, not through an engine of the app's that decodes samples,
 * so nothing is declared: the server plans listening as ordinary playback.
 */
export const vegaAudioDecode: readonly AudioDecodeCapability[] = Object.freeze([]);

/**
 * The device's capability document: the one description of what this device plays, which the
 * server plans every title from. It has one player engine, the platform's media element
 * (`engines.native`); there is no mpv here, so there is no second profile and the Player setting
 * is always Automatic.
 *
 * Where it comes from:
 *
 * - client-core's declared table for Vega (`vegaDeclaredProfile`) is the floor: what this
 *   platform's player is known to take.
 * - `probed` is what this very device answered when asked (`capability-probe.ts`): which codecs
 *   its decoders take, at what size, in which containers. When it is in hand it replaces the
 *   table's codecs and transports; when the device could not be asked, the table stands.
 *
 * And what is true of this app's player whatever the device answers, stated on top:
 *
 * - **Subtitles: plain text only.** The app draws the server's cue document and nothing else, so
 *   the server burns styled (ASS) and image (PGS, VobSub, DVB) subtitles into the picture for this
 *   device.
 * - **It does not switch between the audio tracks inside an original file.** The app switches
 *   between the named tracks of a stream, and asks the server for the title again for anything else.
 * - **Standard dynamic range.** The SDK does not say what the television shows, and HDR sent to a
 *   screen that does not show it is grey and flat: no HDR is claimed, the server tone-maps, and
 *   the "Turn off HDR" setting is not offered (`probedSettings`).
 * - **Two channels of sound** unless a receiver is reported, which this SDK never does: the
 *   server mixes surround down. Dolby audio is listed for handing on to a receiver and used only
 *   once a route is reported, so it is never used today (and is never listed as decoded here,
 *   whatever the device answers: a "yes" does not tell decoding from handing on).
 * - **Files from their address only over HTTPS.** The media element refuses an `http:` address as
 *   insecure (and a server on the home network is usually plain HTTP). Everything else goes
 *   through media source extensions, where the app fetches the bytes and hands them over
 *   (`hls.ts`): that takes HLS in fragmented MP4 or MPEG-TS, so from an HTTP server both HLS
 *   transports are asked for and files are not played from their address. (The server converts
 *   into `hls_ts`, music included, and repackages into `hls_fmp4`.)
 */
export function vegaCapabilityDocument(facts: VegaFacts | null, origin: string | null = null, overrides: CapabilityOverrides = {}, probed: CapabilityDocument | null = null): CapabilityDocument {
  const declared = vegaDeclaredProfile({osVersion: facts?.osVersion, model: facts?.model});
  if (facts?.appVersion) declared.client.appVersion = facts.appVersion;
  const secure = typeof origin === 'string' && origin.toLowerCase().startsWith('https:');
  const table = declared.engines.native, asked = probed?.engines.native;
  // Dolby audio stays what the table says it is: sound handed on to a receiver, not sound this
  // device is known to decode. The device's "yes" to it does not say which, and a television
  // that cannot decode it would be given silence.
  const handedOn = new Set((table.audioPassthrough ?? []).map(codec => codec.codec));
  const base: EngineCapabilities = asked
    ? {name: table.name, evidence: 'probed', video: sdrOnly(asked.video), audio: asked.audio?.filter(codec => !handedOn.has(codec.codec)), audioPassthrough: table.audioPassthrough, transports: asked.transports}
    : table;
  const native: EngineCapabilities = {
    ...base,
    transports: (base.transports ?? []).filter(transport => transport.transport !== 'direct' || secure),
    subtitleRendering: ['text'],
    toneMapsHdr: false,
    embeddedAudioSwitching: false,
  };
  const settings = {engine: 'automatic' as const, overrides};
  const stamped = withViewerSettings({...declared, engines: {native}}, settings);
  if (!capabilityDocumentProblem(stamped)) return stamped;
  // A document the server would refuse is never sent. What the device answered is the newest
  // part, so it is the part left out; the table alone is always a valid document.
  const tabled = withViewerSettings({...declared, engines: {native: {...table, transports: (table.transports ?? []).filter(transport => transport.transport !== 'direct' || secure), subtitleRendering: ['text'], toneMapsHdr: false, embeddedAudioSwitching: false}}}, settings);
  return capabilityDocumentProblem(tabled) ? withViewerSettings(declared, settings) : tabled;
}

/** Whatever a decoder says of itself, no HDR is claimed here (see above). */
function sdrOnly(video: EngineCapabilities['video']): EngineCapabilities['video'] {
  return video?.map(({dolbyVisionProfiles: _profiles, ...codec}) => ({...codec, dynamicRanges: ['sdr' as const]}));
}

const receiverRoutes: readonly string[] = ['hdmi', 'arc', 'earc', 'optical', 'spdif'];

/**
 * What Settings needs to know of the document, so that it offers only switches that do
 * something on this device: whether sound is being handed to a receiver undecoded ("Don't pass
 * sound through"), and whether the device shows or decodes HDR at all ("Turn off HDR").
 */
export function probedSettings(document: CapabilityDocument): Readonly<{audioPassthrough: boolean; hdr: boolean}> {
  const hdr = (ranges: readonly string[] | undefined) => !!ranges?.some(range => range !== 'sdr');
  const native = document.engines.native;
  return {
    audioPassthrough: !!native.audioPassthrough?.length && receiverRoutes.includes(document.audioOutput?.route ?? ''),
    hdr: hdr(document.display?.dynamicRanges) || !!native.video?.some(codec => hdr(codec.dynamicRanges)),
  };
}
