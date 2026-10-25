import React, {useLayoutEffect, useState, useSyncExternalStore} from 'react';
import {NativeEventEmitter, NativeModules, Platform, UIManager, requireNativeComponent, type HostComponent, type ViewProps} from 'react-native';
import {serviceText} from '../../../../../packages/client-core/src/presentation/service-text';
import {PlaybackService} from '../../../../../packages/client-core/src';
import type {LocalPlaybackFence} from '../../../../../packages/player-core/src';
import type {OfflineEntry} from '../../../platform/offline-downloads';
import type {RememberedDownloadsViewer} from '../../shell/remembered-downloads-viewer';
import {chooseEngine, type EngineKind} from './engine-choice';
import {NativePlaybackCoordinator, type NativePlaybackTransport} from './NativePlaybackCoordinator';
import {NativeOfflinePlayback, type NativeOfflinePlaybackDevice, type NativeOfflineSource} from './offline-playback';
import type {NativePlaybackSettings} from './types';

type EngineModule = Readonly<{
  acquire: NativePlaybackTransport['acquire']; command: NativePlaybackTransport['command']; release: NativePlaybackTransport['release'];
  getConstants?: () => Readonly<{available?: boolean}>; available?: boolean;
}>;
type SurfaceProps = ViewProps & {lease: string; surfaceActive?: boolean};
const names = {native: {module: 'PorticoPlaybackModule', event: 'PorticoPlaybackFact', view: 'PorticoPlayer'},
  mpv: {module: 'PorticoMpvPlaybackModule', event: 'PorticoMpvPlaybackFact', view: 'PorticoMpvPlayer'}} as const;
const views: Partial<Record<EngineKind, HostComponent<SurfaceProps>>> = {};
const cancelled = () => Object.assign(new Error('receipt_playback_closed'), {name: 'AbortError', code: 'cancelled'});

/** Receipt-owned local playback, with no server session, Home authority, queue,
 * events client, capability publisher or online promotion. The supplied device
 * remains shell-owned: this borrower never adopts, connects or disposes it. */
export function createNativeReceiptOnlyPlayback(options: Readonly<{
  identity: RememberedDownloadsViewer; device: NativeOfflinePlaybackDevice;
  isCurrent: () => boolean; settings: () => NativePlaybackSettings; subscribeSettings: (listener: () => void) => () => void;
}>) {
  let closed = false, epoch = 0, surface: object | undefined, pending: AbortController | undefined;
  let source: NativeOfflineSource | undefined;
  const current = () => {try {return !closed && options.isCurrent() && options.identity.current();} catch {return false;}};
  if (!current()) throw cancelled();
  const id = NativeModules.PorticoRuntime?.playbackRequestId as (() => string) | undefined;
  const transports: Partial<Record<EngineKind, NativePlaybackTransport>> = {};
  for (const kind of ['native', 'mpv'] as const) {
    const name = names[kind], module = NativeModules[name.module] as EngineModule | undefined;
    if (!module || !UIManager.hasViewManagerConfig(name.view) || kind === 'mpv' && (module.getConstants?.() ?? module).available !== true) continue;
    const emitter = new NativeEventEmitter(module as never);
    transports[kind] = {acquire: owner => module.acquire(owner), command: value => module.command(value), release: lease => module.release(lease),
      subscribe: listener => {const subscription = emitter.addListener(name.event, listener); return () => subscription.remove();}};
  }
  if (!id || !transports.native) throw new Error('receipt_playback_unavailable');
  const admission = new NativeOfflinePlayback(options.identity, options.device);
  const playback = new PlaybackService(admission.localOnlyApi(), id, {deferRecovery: true});
  const listeners = new Set<() => void>();
  const publish = () => listeners.forEach(listener => listener());
  const coordinator = new NativePlaybackCoordinator(playback, transports.native, id,
    state => current() && state.session ? admission.mediaUrl(state.session) ?? '' : '',
    fact => {
      if (!current() || !source?.current()) {dispose(); return;}
      const state = playback.getSnapshot();
      if (fact.type === 'ready') playback.ready(state.intentId);
      else if (fact.type === 'systemPaused') playback.pause();
      else if (fact.type === 'stalled') playback.recovering(state.intentId, true);
      else if (fact.type === 'seekApplied') playback.seekApplied(state.intentId, fact.seekRevision, fact.position, fact.paused ? 'paused' : 'playing');
      else if (fact.type === 'seekFailed') playback.seekFailed(state.intentId, fact.seekRevision, serviceText('queuePlayer.startFailed'));
      else if (fact.type === 'progress' || fact.type === 'ended') {playback.recovering(state.intentId, false); playback.fact(state.intentId, fact.position, fact.type === 'ended' ? 'ended' : fact.paused ? 'paused' : 'playing');}
      else if (fact.type === 'error') playback.fail(state.intentId, serviceText('downloads.offline.notPlayableHere'));
    }, {initial: 'native', transport: kind => transports[kind as EngineKind],
      choose: () => chooseEngine({setting: options.settings().engine, mpvAvailable: !!transports.mpv,
        nativeOnly: source?.metadata.kind === 'song' || source?.metadata.kind === 'audiobook_file'})});
  let offIdentity = () => {}, offDevice = () => {}, offSettings = () => {}, offPlayback = () => {}, offCoordinator = () => {};
  const retirePlay = () => {++epoch; pending?.abort(); pending = undefined; playback.leave(false); source = undefined; coordinator.stop(); publish();};
  const check = () => {if (!current() || source && !source.current()) dispose();};
  const configure = () => {
    if (!current()) {dispose(); return;}
    const settings = options.settings(), state = playback.getSnapshot();
    const rate = source?.metadata.kind === 'audiobook_file' ? settings.audiobookRate : source?.metadata.kind === 'song' ? 1 : settings.videoRate;
    if (!Number.isFinite(rate) || rate <= 0) {dispose(); return;}
    coordinator.setOptions(rate, null, state.session ? {binding: {intentId: state.intentId, sessionId: state.session.id, generation: state.session.generation}, mode: 'off'} : null);
    coordinator.setDisplayMatching(settings.matchFrameRate); coordinator.setDynamicRangeMatching(settings.matchDynamicRange); coordinator.reconsiderEngine();
  };
  function dispose() {
    if (closed) return; closed = true; retirePlay(); admission.dispose();
    offIdentity(); offDevice(); offSettings(); offPlayback(); offCoordinator(); listeners.clear();
  }
  try {
    offIdentity = options.identity.subscribe(check); offDevice = options.device.subscribe(check);
    offSettings = options.subscribeSettings(configure); offPlayback = playback.subscribe(() => {configure(); publish();}); offCoordinator = coordinator.subscribe(publish);
    check(); if (!current()) throw cancelled();
  } catch (error) {dispose(); throw error;}
  const fence = (): LocalPlaybackFence | undefined => {
    const state = playback.getSnapshot(); return current() && source?.current() && state.session ? admission.fence(state.session, state.playbackRun) : undefined;
  };
  /** One committed surface owns the renderer. Replay gets a fresh mount ticket,
   * retires the old play, and never resumes it automatically. */
  function Surface() {
    const [ticket, setTicket] = useState<object>();
    const lease = useSyncExternalStore(coordinator.subscribe, coordinator.getSnapshot, coordinator.getSnapshot);
    const engine = coordinator.getEngine() as EngineKind;
    useLayoutEffect(() => {
      if (!current() || surface) return;
      const ticket = {}; surface = ticket; setTicket(ticket); coordinator.start();
      return () => {if (surface === ticket) {surface = undefined; retirePlay();}};
    }, []);
    const View = views[engine] ??= requireNativeComponent<SurfaceProps>(names[engine].view);
    const ownsSurface = !!ticket && surface === ticket && current();
    return <View lease={ownsSurface ? lease : ''} pointerEvents="none" accessible={false} {...(Platform.OS === 'android' ? {surfaceActive: ownsSurface && !!lease} : {})} style={{flex: 1}} />;
  }
  const control = (expected: LocalPlaybackFence, action: () => void) => {const actual = fence();
    if (current() && surface && source?.current() && actual && JSON.stringify(actual) === JSON.stringify(expected)) action();};
  return Object.freeze({Surface, getSnapshot: playback.getSnapshot,
    pause: (expected: LocalPlaybackFence) => control(expected, () => playback.pause()), resume: (expected: LocalPlaybackFence) => control(expected, () => playback.resume()), seek: (expected: LocalPlaybackFence, seconds: number) => control(expected, () => playback.seek(seconds)),
    current, fence, subscribe: (listener: () => void) => {if (closed) return () => {}; listeners.add(listener); return () => {listeners.delete(listener);};},
    open: async (entry: OfflineEntry, lifetime: Readonly<{signal: AbortSignal; isCurrent: () => boolean}>) => {
      if (!current() || !surface || lifetime.signal.aborted || !lifetime.isCurrent()) throw cancelled();
      const opening = surface; retirePlay(); coordinator.start();
      const operation = epoch, controller = new AbortController(); pending = controller;
      const abort = () => controller.abort(); lifetime.signal.addEventListener('abort', abort, {once: true});
      const active = () => current() && surface === opening && epoch === operation && !controller.signal.aborted && !lifetime.signal.aborted && lifetime.isCurrent();
      try {
        const admitted = await admission.prepare(entry, active);
        if (!active() || !admitted.current()) throw cancelled();
        if (!['movie', 'episode', 'song', 'audiobook_file'].includes(admitted.metadata.kind ?? '')) throw new Error(serviceText('downloads.offline.notPlayableHere'));
        source = admitted; configure();
        await playback.playLocal(admitted.itemId, admitted.session, undefined, {signal: controller.signal, isCurrent: active});
        if (!active() || !admitted.current() || !fence()) throw cancelled();
      } catch (error) {if (epoch === operation) retirePlay(); throw error;}
      finally {lifetime.signal.removeEventListener('abort', abort); if (pending === controller) pending = undefined;}
    }, close: (expected: LocalPlaybackFence) => control(expected, retirePlay), dispose,
  });
}
