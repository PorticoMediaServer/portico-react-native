import React from 'react';
import {NativeScreenLifetime} from './lifetime';
import {NativeLiveController} from './live-controller';
import {nativeGuideMemory} from './guide-memory';
import {nativeScreenServices} from '../native-screen-services';
import {nativeRouteCrypto} from '../../platform/server-connections';
import {NativeLiveOwnerController} from './live-owner-controller';
import {NativeTogetherController} from './together-controller';
import {NativeTogetherMedia} from './together-media';
import {createNativeRecordingsController} from './recordings-controller';
import {NativeLiveScreen} from './LiveScreen';
import {NativeTogetherScreen} from './TogetherScreen';
import {nativeTogetherPages} from './together-page';
import {createNativeServerDashboardRenderer, createNativeSettingsRenderer} from './SettingsRoute';
import {nativeSettingsRequestId} from './settings-ports';
import type {NativeSettingsLivePorts, NativeSettingsLiveRenderers} from './ports';
import {publishNativeLiveWatchPort} from './watch-port';

export type {NativeSettingsLivePorts, NativeSettingsLiveRenderers} from './ports';
export {NativeScreenLifetime} from './lifetime';
export {NativeSettingsController} from './settings-controller';
export {NativeLiveController} from './live-controller';
export {NativeTogetherController, type NativeTogetherService} from './together-controller';
export {NativeDashboardController} from './dashboard-controller';
export {NativeRecordingsController, type NativeRecordingsSnapshot, type NativeRecordingQuery, type NativeRecordingService} from './recordings-controller';

/** No global registration. The shell mount owns the one dispatcher; the Settings and
 * Dashboard renderers carry their own genuine ports and panels. */
export function createNativeSettingsLiveRenderers(ports: NativeSettingsLivePorts): NativeSettingsLiveRenderers {
  const {context} = ports;
  const lifetime = new NativeScreenLifetime(context);
  const api = {request: <T,>(path: string, method?: string, body?: unknown, signal?: AbortSignal) => lifetime.request(next => context.api.request<T>(path, method, body, next), signal)};
  const live = new NativeLiveController(lifetime, api, Intl.DateTimeFormat().resolvedOptions().timeZone, {port: nativeGuideMemory(context.session()?.viewer, lifetime), reportError: error => nativeScreenServices(context).reportError(error)});
  const recordings = createNativeRecordingsController(lifetime, api, ports.dvrRequestId);
  const owner = new NativeLiveOwnerController(lifetime, api, () => [...nativeRouteCrypto.random(24)].map(byte => byte.toString(16).padStart(2, '0')).join(''));
  const releaseWatch = publishNativeLiveWatchPort(context, lifetime, {recordings, live, owner, requestId: ports.dvrRequestId});
  const together = new NativeTogetherController(lifetime, ports.together);
  const togetherMedia = new NativeTogetherMedia(lifetime, api);
  const togetherPages=nativeTogetherPages(context,lifetime);
  const settings = createNativeSettingsRenderer(context);
  const serverDashboard = createNativeServerDashboardRenderer(context);
  let disposed = false, releaseAuthority = () => {};
  const dispose = () => {if (disposed) return; disposed = true; releaseWatch(); releaseAuthority(); settings.dispose?.(); serverDashboard.dispose?.(); owner.dispose(); live.dispose(); recordings.dispose(); togetherPages.dispose();together.dispose(); togetherMedia.dispose(); lifetime.dispose();};
  releaseAuthority = context.subscribeAuthority(() => {if (!lifetime.current()) dispose();});
  return {
    settings,
    live: {render: (route, runtime) => {lifetime.assert(); if (route.kind !== 'shell' || route.destination.kind !== 'live') throw new Error('native_live_route_mismatch'); return <NativeLiveScreen ports={{...ports, requestId: ports.requestId ?? nativeSettingsRequestId}} controller={live} recordings={recordings} owner={owner} runtime={runtime}/>;}},
    together: {render: (route, runtime) => {lifetime.assert(); if (route.kind !== 'together') throw new Error('native_together_route_mismatch'); const page=togetherPages.capture(route);if(!page)return null;return <NativeTogetherScreen key={page.key} page={page} ports={ports} controller={together} media={togetherMedia} runtime={runtime} onBack={page.back}/>;}},
    serverDashboard,
    dispose,
  };
}
