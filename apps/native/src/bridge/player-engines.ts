import type {ComponentType} from 'react';
import {NativeEventEmitter, NativeModules, UIManager, requireNativeComponent, type ViewProps} from 'react-native';
import type {NativePlaybackTransport} from './NativePlaybackCoordinator';
import {NativePlayer} from './NativeViews';
import {nativeEngineFeatures, parseEngineFeatures, type EngineFeatures, type EngineKind} from '../player/engine-choice';

/**
 * The player engines this build carries, and how JavaScript reaches each one.
 *
 * Both engines implement one contract (`Native/ENGINE-CONTRACT.md`): the same methods, the same
 * commands and the same facts, under their own module, event and view names so that the app can
 * hold either. The names are the same on every platform:
 *
 * | Engine | Module | Fact event | Picture in Picture event | View |
 * | --- | --- | --- | --- | --- |
 * | native | `PorticoPlaybackModule` | `PorticoPlaybackFact` | `PorticoPictureInPicture` | `PorticoPlayer` |
 * | mpv | `PorticoMpvPlaybackModule` | `PorticoMpvPlaybackFact` | `PorticoMpvPictureInPicture` | `PorticoMpvPlayer` |
 *
 * A platform or build without mpv simply has no `PorticoMpvPlaybackModule` (or one that says
 * `available: false`); the setting is then not offered and everything plays in the native engine.
 */
const moduleNames: Record<EngineKind, string> = {native: 'PorticoPlaybackModule', mpv: 'PorticoMpvPlaybackModule'};
const factEvents: Record<EngineKind, string> = {native: 'PorticoPlaybackFact', mpv: 'PorticoMpvPlaybackFact'};
const pictureEvents: Record<EngineKind, string> = {native: 'PorticoPictureInPicture', mpv: 'PorticoMpvPictureInPicture'};
const viewNames: Record<EngineKind, string> = {native: 'PorticoPlayer', mpv: 'PorticoMpvPlayer'};

type EngineModule = {
  acquire(owner: string): Promise<Readonly<{lease: string; instanceId: string}>>;
  command(value: Record<string, unknown>): Promise<unknown>;
  release(lease: string): Promise<unknown>;
  facts?(): Promise<unknown>;
  getConstants?(): Record<string, unknown> | undefined;
} & Record<string, unknown>;

function moduleOf(kind: EngineKind): EngineModule | undefined {
  return (NativeModules as Record<string, EngineModule | undefined>)[moduleNames[kind]];
}

/** A module's constants: read through `getConstants` where the runtime has it, else from the module itself. */
function constantsOf(module: EngineModule | undefined): Record<string, unknown> {
  if (!module) return {};
  try {
    const constants = module.getConstants?.();
    if (constants && typeof constants === 'object') return constants;
  } catch { /* an older runtime: the constants are on the module */ }
  return module;
}

function hasView(name: string): boolean {
  try {
    return !!(UIManager as {hasViewManagerConfig?: (view: string) => boolean}).hasViewManagerConfig?.(name);
  } catch {
    return false;
  }
}

/** This build has the mpv engine: its module says so and its view is registered. */
export const mpvAvailable: boolean = (() => {
  const module = moduleOf('mpv');
  return !!module && constantsOf(module).available === true && hasView(viewNames.mpv);
})();

export function engineAvailable(kind: EngineKind): boolean {
  return kind === 'native' ? !!moduleOf('native') : mpvAvailable;
}

const features: Partial<Record<EngineKind, EngineFeatures>> = {};
/** What the engine does and does not do, from its module. */
export function engineFeatures(kind: EngineKind): EngineFeatures {
  return (features[kind] ??= parseEngineFeatures(constantsOf(moduleOf(kind)).features, nativeEngineFeatures));
}

const transports: Partial<Record<EngineKind, NativePlaybackTransport>> = {};
/** The engine's lease, command and fact channel, or undefined when this build has no such engine. */
export function engineTransport(kind: EngineKind): NativePlaybackTransport | undefined {
  const known = transports[kind];
  if (known) return known;
  const module = moduleOf(kind);
  if (!module || !engineAvailable(kind)) return undefined;
  const emitter = new NativeEventEmitter(module as never);
  const made: NativePlaybackTransport = {
    acquire: owner => module.acquire(owner),
    command: value => module.command(value),
    release: lease => module.release(lease),
    subscribe: listener => {
      const subscription = emitter.addListener(factEvents[kind], listener);
      return () => subscription.remove();
    },
  };
  transports[kind] = made;
  return made;
}

/** Picture in Picture answers from the engine's view ({lease, state, subtitlesCarried}). */
export function subscribePictureInPicture(kind: EngineKind, listener: (change: {lease?: string; state: string; subtitlesCarried?: boolean}) => void): () => void {
  const module = moduleOf(kind);
  if (!module) return () => {};
  const subscription = new NativeEventEmitter(module as never).addListener(pictureEvents[kind], listener);
  return () => subscription.remove();
}

/** What the mpv engine's module reports about this device, for its capability profile; null when it cannot be asked. */
export async function mpvDeviceFacts(): Promise<unknown | null> {
  try {
    return mpvAvailable ? ((await moduleOf('mpv')?.facts?.()) ?? null) : null;
  } catch {
    return null;
  }
}

export type EnginePlayerProps = ViewProps & {
  lease: string;
  /** Changes arrive as the engine's Picture in Picture event, not a view event. */
  pictureInPictureRequest?: number;
};

// A view name may be registered once: the native engine's view is the one `NativeViews` already made.
const NativeEnginePlayer = NativePlayer as ComponentType<EnginePlayerProps>;
const MpvEnginePlayer = mpvAvailable ? requireNativeComponent<EnginePlayerProps>(viewNames.mpv) : NativeEnginePlayer;

/** The view that shows an engine's picture for a lease. */
export function enginePlayerView(kind: EngineKind): ComponentType<EnginePlayerProps> {
  return (kind === 'mpv' ? MpvEnginePlayer : NativeEnginePlayer) as ComponentType<EnginePlayerProps>;
}
