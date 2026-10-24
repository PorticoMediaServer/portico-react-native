import React, {useCallback, useEffect, useRef, useSyncExternalStore, type ComponentRef} from 'react';
import {AppState, NativeEventEmitter, NativeModules, Platform, UIManager, findNodeHandle, requireNativeComponent, type HostComponent, type ViewProps} from 'react-native';
import {CapabilityPublisher} from '../../../../../packages/client-core/src/playback-v1/options';
import {localV1Http} from '../../../../../packages/client-core/src/playback-v1/local-http';
import {serviceText} from '../../../../../packages/client-core/src/presentation/service-text';
import {parseEngineFeatures} from './engine-choice';
import {deviceCapabilityDocument} from './capability-document.ios';
import type {NativeFacts} from './device-profile';
import {NativeListeningV1Adapter, type NativeListeningBridge} from './NativeListeningAdapter';
import type {NativeBinding, NativePlaybackTransport} from './NativePlaybackCoordinator';
import {NativePlaybackRuntime} from './runtime';
import {PlaybackScopeHttp} from './scope-http';
import {appleSubtitleFilePicker} from './subtitle-file-picker.ios';
import {offlineDownloads} from '../../../platform/offline-downloads';
import {createVideoSnapshotCapture} from '../video-snapshot';
import type {NativePlaybackAdapter, NativePlaybackRuntimeOptions, NativePlaybackSurfaceProps} from './types';

const names = {native: {module: 'PorticoPlaybackModule', fact: 'PorticoPlaybackFact', view: 'PorticoPlayer'}} as const;
type EngineModule = NativeListeningBridge & {
  acquire(owner: string): Promise<Readonly<{lease: string; instanceId: string}>>;
  command(value: Record<string, unknown>): Promise<unknown>;
  release(lease: string): Promise<unknown>;
  facts?: () => Promise<unknown>;
  getConstants?: () => Record<string, unknown>;
  available?: boolean;
  features?: unknown;
  purgeAudioCache?: () => Promise<unknown>;
};
type NativeSurfaceProps = ViewProps & {lease: string; pictureInPictureRequest: number; pictureInPictureBinding: NativeBinding | null};
let appleSurfaceView: HostComponent<NativeSurfaceProps> | undefined;
function viewAvailable(name: string): boolean { try { return !!UIManager.hasViewManagerConfig(name); } catch { return false; } }
function moduleConstants(module: EngineModule) { try { return module.getConstants?.() ?? module; } catch { return module; } }
function transport(module: EngineModule, event: string): NativePlaybackTransport {
  const emitter = new NativeEventEmitter(module as never);
  return {acquire: owner => module.acquire(owner), command: value => module.command(value), release: lease => module.release(lease),
    subscribe: listener => { const subscription = emitter.addListener(event, listener); return () => subscription.remove(); }};
}
export type NativePlaybackFactoryOptions = Omit<NativePlaybackRuntimeOptions, 'transport' | 'engines' | 'engineFeatures' | 'nativeListening' | 'requestId' | 'capabilitiesReady' | 'disposeCapabilities' | 'timers'> & Readonly<{appVersion: string}>;

/** Binds real platform modules. There is no alternate renderer/engine, demo session or URL. */
export function createNativeShellPlaybackAdapter(options: NativePlaybackFactoryOptions): NativePlaybackAdapter & {runtime: NativePlaybackRuntime} {
  const native = NativeModules[names.native.module] as EngineModule | undefined;
  const requestId = NativeModules.PorticoRuntime?.playbackRequestId as undefined | (() => string);
  if (!native || !requestId || !viewAvailable(names.native.view)) throw new Error(serviceText('player.nativeHandoverFailed'));
  // One host component for this adapter lifetime. Presentation changes only its bounds.
  const SurfaceView = appleSurfaceView ??= requireNativeComponent<NativeSurfaceProps>(names.native.view);
  const nativeFeatures = parseEngineFeatures(moduleConstants(native).features);
  const nativeTransport = transport(native, names.native.fact);
  const viewer = options.session()?.viewer;
  if (!viewer || !['local', 'hosted'].includes(viewer.authority)) throw new Error(serviceText('player.nativeHandoverFailed'));
  const initialAuthority = options.authority();
  const authority = [initialAuthority.serverId, initialAuthority.accountId, initialAuthority.profileId, initialAuthority.epoch, initialAuthority.viewerFence].join('\n');
  const capabilityHttp = new PlaybackScopeHttp(localV1Http(options.api), () => [options.authority().serverId, options.authority().accountId, options.authority().profileId, options.authority().epoch, options.authority().viewerFence].join('\n') === authority && options.session()?.viewer.profileId === viewer.profileId);
  const publisher = new CapabilityPublisher(capabilityHttp);
  let closed = false, publishing: Promise<void> = Promise.resolve();
  const publishCapabilities = (): Promise<void> => {
    publishing = publishing.then(async () => {
      if (closed) return;
      const settings = options.settings();
      const facts = await ((NativeModules.PorticoCapabilities?.facts?.() as Promise<NativeFacts | null> | undefined)?.catch(() => null) ?? Promise.resolve(null));
      if (closed) return;
      const document = deviceCapabilityDocument({overrides: settings.overrides, native: facts, appVersion: options.appVersion,
        device: {television: Platform.isTV, pad: !Platform.isTV && (Platform as {isPad?: boolean}).isPad === true, osVersion: String(Platform.Version)}});
      await publisher.publish(document);
    }).catch(() => {});
    return publishing;
  };
  void publishCapabilities();
  const ready = async () => { for (;;) { const pending = publishing; await pending; if (pending === publishing) return; } };
  const offSettings = options.subscribeSettings(() => { void publishCapabilities(); });
  const capabilitiesModule = NativeModules.PorticoCapabilities;
  const capabilitiesEvent = capabilitiesModule ? new NativeEventEmitter(capabilitiesModule).addListener('portico.capabilities', () => { void publishCapabilities(); }) : undefined;
  const emitter = new NativeEventEmitter(native as never);
  const listening = typeof native.adoptListeningSession === 'function' ? new NativeListeningV1Adapter({
    bridge: native, route: options.api.getRouteConnection(),
    principal: {origin: options.api.baseUrl, serverId: viewer.serverId, authority: viewer.authority as 'local' | 'hosted', accountId: viewer.accountId, profileId: viewer.profileId},
    bearer: () => options.session()?.accessToken ?? '', id: requestId,
    subscribe: sink => { const subscription = emitter.addListener('PorticoListeningSnapshot', sink); return () => subscription.remove(); },
  }) : undefined;
  // Local playback uses the existing device owner only when its native file port is installed.
  const offlineDevice = !Platform.isTV && offlineDownloads.getSnapshot().supported
    && typeof NativeModules.PorticoDownloads?.localFile === 'function' ? options.offlineDevice ?? offlineDownloads : undefined;
  let runtime: NativePlaybackRuntime;
  runtime = new NativePlaybackRuntime({...options, offlineDevice, subtitleFilePicker: appleSubtitleFilePicker, pictureInPictureControls: true, engineFeatures: () => nativeFeatures, requestId, transport: nativeTransport, nativeListening: listening, capabilitiesReady: ready,
    disposeCapabilities: () => { closed = true; offSettings(); capabilitiesEvent?.remove(); capabilityHttp.dispose(); appState?.remove(); void native.purgeAudioCache?.().catch(() => {}); },
    engines: {initial: 'native', transport: kind => kind === 'native' ? nativeTransport : undefined, choose: () => 'native'}});
  runtime.installSnapshotCapture(createVideoSnapshotCapture({isCurrent: runtime.isSnapshotSourceCurrent}));
  const appState = AppState.addEventListener('change', state => { if (state === 'active') void runtime.refreshAuthority().catch(() => {}); else void runtime.flush().catch(() => {}); });

  /** The only new component is a native-module view bridge; all player chrome belongs later. */
  function Surface({dockBounds, expandedBounds, docked, subtitlesVisible}: NativePlaybackSurfaceProps) {
    const owner = useRef<object>({});
    const surfaceRef = useCallback((node: ComponentRef<HostComponent<NativeSurfaceProps>> | null) => { runtime.setSurfaceTag(owner.current, node ? findNodeHandle(node) : null); }, []);
    const state = useSyncExternalStore(runtime.subscribe, runtime.getSnapshot);
    useEffect(() => runtime.attachSurface(owner.current), []);
    useEffect(() => { runtime.setSubtitleDisplay(subtitlesVisible && !docked); }, [subtitlesVisible, docked]);
    const target = docked ? dockBounds : expandedBounds;
    const bounds = target && [target.x, target.y, target.width, target.height].every(Number.isFinite) && target.width > 0 && target.height > 0 ? target : undefined;
    const visible = !!bounds && !!state.fence && !!state.lease;
    return <SurfaceView ref={surfaceRef} lease={state.lease} pointerEvents="none" accessible={false} importantForAccessibility="no-hide-descendants"
      pictureInPictureRequest={state.pictureInPicture?.request ?? 0} pictureInPictureBinding={state.pictureInPicture?.binding ?? null}
      style={{position: 'absolute', left: bounds?.x ?? 0, top: bounds?.y ?? 0, width: bounds?.width ?? 0, height: bounds?.height ?? 0, display: visible ? 'flex' : 'none', opacity: visible ? 1 : 0}} />;
  }
  return {
    runtime, dock: runtime.dock, getSnapshot: runtime.getSnapshot, subscribe: runtime.subscribe, start: runtime.start, startVersion: runtime.startVersion, selectionPlayback: runtime.selectionPlayback, Surface,
    cataloguePlayback: runtime.cataloguePlayback,
    ...(offlineDevice ? {startOffline: runtime.startOffline} : {}),
    change: runtime.change, chooseQuality: runtime.chooseQuality, setRate: runtime.setRate,
    subtitleControls: fence => runtime.subtitleControls(fence), readSession: runtime.readSession,
    prepareExternalPresentation: runtime.prepareExternalPresentation, requestPictureInPicture: runtime.requestPictureInPicture,
    onTransition: runtime.onTransition, toggle: runtime.toggle, replay: runtime.replay, seek: runtime.seek, skip: runtime.skip,
    previous: runtime.previous, next: runtime.next, stop: runtime.stop, restoreBookmark: runtime.restoreBookmark, open: runtime.open, dispose: runtime.dispose,
    captureVideoSnapshot: runtime.captureVideoSnapshot,
    ...(options.openDestinations ? {cast: runtime.cast} : {}),
  };
}
