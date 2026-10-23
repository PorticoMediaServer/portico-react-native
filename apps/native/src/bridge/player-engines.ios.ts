import type {ComponentType} from 'react';
import {NativeEventEmitter, NativeModules, type ViewProps} from 'react-native';
import type {NativePlaybackTransport} from './NativePlaybackCoordinator';
import {NativePlayer} from './NativeViews';
import {nativeEngineFeatures, parseEngineFeatures, type EngineFeatures, type EngineKind} from '../player/engine-choice';

/** Apple video has one engine, AVPlayer. A stored Android mpv preference never changes it. */
const factEvents: Record<EngineKind, string> = {native: 'PorticoPlaybackFact', mpv: ''};
const pictureEvents: Record<EngineKind, string> = {native: 'PorticoPictureInPicture', mpv: ''};
type EngineModule = {
  acquire(owner: string): Promise<Readonly<{lease: string; instanceId: string}>>;
  command(value: Record<string, unknown>): Promise<unknown>;
  release(lease: string): Promise<unknown>;
  facts?(): Promise<unknown>;
  getConstants?(): Record<string, unknown> | undefined;
} & Record<string, unknown>;

function moduleOf(kind: EngineKind): EngineModule | undefined {
  return kind === 'native' ? NativeModules.PorticoPlaybackModule as EngineModule | undefined : undefined;
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

export const mpvAvailable = false;

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
export async function mpvDeviceFacts(): Promise<null> { return null; }

export type EnginePlayerProps = ViewProps & {
  lease: string;
  /** Changes arrive as the engine's Picture in Picture event, not a view event. */
  pictureInPictureRequest?: number;
};

// A view name may be registered once: the native engine's view is the one `NativeViews` already made.
const NativeEnginePlayer = NativePlayer as ComponentType<EnginePlayerProps>;


/** The view that shows an engine's picture for a lease. */
export function enginePlayerView(kind: EngineKind): ComponentType<EnginePlayerProps> {
  if (kind !== 'native') throw new Error('Apple playback requires AVPlayer.');
  return NativeEnginePlayer;
}
