import {androidProfile, appleProfile, type AndroidNativeFacts, type AppleNativeFacts, type ClientProfile, type DynamicRange} from '../../../../packages/client-core/src/client-profile';
import type {AudioDecodeCapability} from '../../../../packages/client-core/src/playback-v1/audio-render';
import {androidAudioDecodeFor, appleAudioDecode} from './audio-decode';
import type {NativeFacts} from './device-profile';
import {mpvDisplayRanges, mpvEngineCapabilities, type EngineCapabilities, type MpvDeviceFacts} from './mpv-profile';
import type {EngineSetting} from '../player/engine-choice';

/**
 * The device's capability document, version 2 (`PUT /v1/me/devices/current/capabilities`): the
 * one description of what this device can play. It carries one profile per player engine
 * (`engines.native`, and `engines.mpv` where the build has mpv), the viewer's Player setting
 * (`engineSetting`), the screen and the audio output. The server plans every title from it and
 * names the engine in the plan.
 *
 * The shape is the server's (`server/internal/playback/capability_document.go`). The shared
 * package's own type for it is not in this repository's copy yet, so the document type lives here
 * until it is; the builder's inputs are the probes the app already has.
 */
export type CapabilityDocument = Readonly<{
  version: 2;
  client: Readonly<{family: string; form: 'tv' | 'phone' | 'tablet'; platform?: string; os?: string; osVersion?: string; model?: string; app?: string; appVersion?: string}>;
  engineSetting: EngineSetting;
  overrides: Readonly<{forceStereo: boolean; disablePassthrough: boolean; disableHdr: boolean}>;
  display: Readonly<{width: number; height: number; dynamicRanges: readonly DynamicRange[]; maxFrameRate: number}>;
  audioOutput: Readonly<{route: string; maxChannels: number; spatial: boolean}>;
  maxBitrateBps: number;
  engines: Readonly<{native: EngineCapabilities; mpv?: EngineCapabilities}>;
  audioDecode: readonly AudioDecodeCapability[];
}>;

/**
 * The platform player's profile, from the client profile the app already builds for it (the
 * declared table for the platform, narrowed by what the device reports).
 *
 * - `subtitleRendering` is `text` only: on every platform the app draws the server's plain cue
 *   document itself, whatever the system's player could draw on its own.
 * - `embeddedAudioSwitching` is false: the app switches audio between the named tracks of an HLS
 *   stream, not between the tracks inside an original file.
 * - AVPlayer plays HEVC from an original file only under the `hvc1` (Dolby Vision: `dvh1`) sample
 *   entry; a file tagged `hev1` plays sound over a black picture, so the tags are stated.
 * - AVPlayer with a hardware HEVC decoder tone-maps HDR for a standard-range screen by itself.
 */
export function nativeEngineCapabilities(client: ClientProfile, apple: boolean, facts: AppleNativeFacts | null): EngineCapabilities {
  const decoded = (client.audio ?? []).filter(a => a.passthrough !== true);
  const passed = (client.audio ?? []).filter(a => a.passthrough === true);
  return Object.freeze({
    name: client.client.engine ?? (apple ? 'avplayer' : 'exoplayer'),
    evidence: client.evidence,
    video: Object.freeze((client.video ?? []).map(v => Object.freeze(apple && v.codec === 'hevc' ? {...v, codecTags: ['hvc1', 'dvh1']} : {...v}))),
    audio: Object.freeze(decoded.map(({passthrough: _passthrough, ...a}) => Object.freeze(a))),
    audioPassthrough: Object.freeze(passed.map(a => Object.freeze({codec: a.codec, ...(a.maxChannels ? {maxChannels: a.maxChannels} : {}), ...(a.objectAudio ? {objectAudio: a.objectAudio} : {}), ...(a.evidence ? {evidence: a.evidence} : {})}))),
    transports: Object.freeze((client.transports ?? []).map(t => Object.freeze({...t}))),
    subtitleRendering: Object.freeze(['text'] as const),
    toneMapsHdr: apple && facts?.hardwareDecode?.hevc === true,
    embeddedAudioSwitching: false,
  });
}

export type CapabilityDocumentInput = Readonly<{
  setting: EngineSetting;
  /** `PorticoCapabilities.facts()`, or null when it could not be asked. */
  native: NativeFacts | null;
  /** `PorticoMpvPlaybackModule.facts()`; null when this build has no mpv (no `engines.mpv`). */
  mpv: MpvDeviceFacts | null;
  mpvAvailable: boolean;
  appVersion: string;
  /** What kind of device this is. `family` is set on Android (and absent on Apple). */
  device: Readonly<{television: boolean; pad: boolean; family?: 'android' | 'androidtv' | 'firetv'; osVersion?: string}>;
}>;

const whole = (value: number | undefined, fallback = 0): number => (typeof value === 'number' && Number.isFinite(value) && value > 0 ? Math.round(value) : fallback);

export function deviceCapabilityDocument(input: CapabilityDocumentInput): CapabilityDocument {
  const device = input.device;
  const osVersion = input.native?.osVersion ?? device.osVersion;
  const apple = !device.family;
  const client = apple
    ? appleProfile({television: device.television, osVersion, model: input.native?.model, appVersion: input.appVersion}, input.native as AppleNativeFacts | null)
    : androidProfile({family: device.family, television: device.television, osVersion, model: input.native?.model}, input.native as AndroidNativeFacts | null);
  const native = nativeEngineCapabilities(client, apple, apple ? (input.native as AppleNativeFacts | null) : null);
  const mpv = input.mpvAvailable ? mpvEngineCapabilities(input.mpv) : undefined;
  // The screen is one screen: what it shows is said once, for the platform player. Where mpv
  // shows less (an Apple TV shows mpv's picture in standard range) its own tone mapping covers
  // the difference, and `mpvDisplayRanges` is what a planner that weighs it would read.
  const display = client.display ?? {};
  const output = client.audioOutput ?? {};
  return Object.freeze({
    version: 2,
    client: Object.freeze({
      family: client.client.family, form: device.television ? 'tv' : device.pad ? 'tablet' : 'phone',
      ...(client.client.platform ? {platform: client.client.platform} : {}), ...(client.client.os ? {os: client.client.os} : {}),
      ...(client.client.osVersion ? {osVersion: client.client.osVersion} : {}), ...(client.client.model ? {model: client.client.model} : {}),
      ...(client.client.app ? {app: client.client.app} : {}), ...(input.appVersion ? {appVersion: input.appVersion} : {}),
    }),
    engineSetting: mpv ? input.setting : 'native',
    overrides: Object.freeze({forceStereo: false, disablePassthrough: false, disableHdr: false}),
    display: Object.freeze({width: whole(display.width), height: whole(display.height), dynamicRanges: Object.freeze([...(display.dynamicRanges ?? ['sdr'])]), maxFrameRate: whole(display.maxFrameRate)}),
    audioOutput: Object.freeze({route: output.route ?? '', maxChannels: whole(output.maxChannels, 2), spatial: output.spatial === true}),
    maxBitrateBps: 0,
    engines: Object.freeze({native, ...(mpv ? {mpv} : {})}),
    audioDecode: apple ? appleAudioDecode : androidAudioDecodeFor(input.native as AndroidNativeFacts | null),
  });
}

/** What the screen shows from the mpv engine, for diagnostics and for a planner that weighs it. */
export {mpvDisplayRanges};
