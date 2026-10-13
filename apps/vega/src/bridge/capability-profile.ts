import {capabilityDocumentProblem, vegaDeclaredProfile, withViewerSettings, type CapabilityDocument, type CapabilityOverrides} from '../../../../packages/client-core/src/client-profile';
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
 * The device's capability document: client-core's declared table for Vega, with what the device
 * says of itself, the transports this app can really take from `origin`, and the viewer's
 * overrides. There is one player engine here (the platform's media element), so the Player
 * setting is always Automatic.
 *
 * The media element opens an address itself only over HTTPS (it refuses `http:` as insecure, and
 * a server on the home network is usually plain HTTP). Everything else goes through media source
 * extensions, where the app fetches the bytes and hands them over (`hls.ts`): that takes HLS in
 * fragmented MP4 or MPEG-TS, so from an HTTP server both HLS transports are asked for and files
 * are not played from their address. (The server converts into `hls_ts`, music included, and
 * remuxes into `hls_fmp4`: without the first nothing that needs converting would play.)
 *
 * The app draws the server's plain cue document and nothing else, and does not switch between
 * the audio tracks inside an original file.
 */
export function vegaCapabilityDocument(facts: VegaFacts | null, origin: string | null = null, overrides: CapabilityOverrides = {}): CapabilityDocument {
  const declared = vegaDeclaredProfile({osVersion: facts?.osVersion, model: facts?.model});
  if (facts?.appVersion) declared.client.appVersion = facts.appVersion;
  const secure = typeof origin === 'string' && origin.toLowerCase().startsWith('https:');
  const native = declared.engines.native;
  const document: CapabilityDocument = {
    ...declared,
    engines: {native: {...native, transports: (native.transports ?? []).filter(transport => transport.transport !== 'direct' || secure), subtitleRendering: ['text'], embeddedAudioSwitching: false}},
  };
  const stamped = withViewerSettings(document, {engine: 'automatic', overrides});
  return capabilityDocumentProblem(stamped) ? withViewerSettings(declared, {engine: 'automatic', overrides}) : stamped;
}
