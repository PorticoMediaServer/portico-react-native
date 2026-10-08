import {vegaDeclaredProfile, type ClientProfile} from '../../../../packages/client-core/src/client-profile';
import type {AudioDecodeCapability} from '../../../../packages/client-core/src/playback-v1/audio-render';
import {capabilityProfileFromClient, networkClassOf} from '../../../../packages/client-core/src/playback-v1/capability-profile';
import type {CapabilityProfile} from '../../../../packages/client-core/src/playback-v1/options';

/** What `PorticoCapabilities.facts()` answers on Vega. */
export type VegaFacts = Readonly<{model?: string; osVersion?: string; deviceName?: string; appVersion?: string}>;

/**
 * What the app's own audio engine decodes (spec §3 `audioDecode`, §18.1). Music and audiobooks
 * play through the media element here, not through an engine of the app's that decodes samples,
 * so nothing is declared: the server plans listening as ordinary playback.
 */
export const vegaAudioDecode: readonly AudioDecodeCapability[] = Object.freeze([]);

/**
 * The device's client profile: client-core's declared table for Vega, with what the device says
 * of itself, and the transports this app can really take from `origin`.
 *
 * The media element opens an address itself only over HTTPS (it refuses `http:` as insecure, and
 * a server on the home network is usually plain HTTP). Everything else goes through media source
 * extensions, where the app fetches the bytes and hands them over (`hls.ts`): that takes HLS in
 * fragmented MP4 or MPEG-TS, so from an HTTP server both HLS transports are asked for and files
 * are not played from their address. (The server converts into `hls_ts`, music included, and
 * remuxes into `hls_fmp4`: without the first nothing that needs converting would play.)
 */
export function vegaClientProfile(facts: VegaFacts | null, origin: string | null = null): ClientProfile {
  const profile = vegaDeclaredProfile({osVersion: facts?.osVersion, model: facts?.model});
  if (facts?.appVersion) profile.client.appVersion = facts.appVersion;
  const secure = typeof origin === 'string' && origin.toLowerCase().startsWith('https:');
  profile.transports = (profile.transports ?? []).filter(transport => transport.transport !== 'direct' || secure);
  return profile;
}

/** This device's v1 capability profile (spec §3). */
export function vegaCapabilityProfile(facts: VegaFacts | null, origin: string | null): CapabilityProfile {
  return capabilityProfileFromClient(vegaClientProfile(facts, origin), {
    form: 'tv',
    network: networkClassOf(origin),
    audioDecode: vegaAudioDecode,
    features: {trickplay: true, chapters: true, gapless: false, crossfade: false, pip: false},
  });
}
