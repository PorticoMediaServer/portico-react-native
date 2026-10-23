import React from 'react';
import {ConsoleClient} from '../../../../../packages/client-core/src/console';
import {AdminSessionsClient} from '../../../../../packages/client-core/src/playback-v1/admin-sessions';
import {localV1Http} from '../../../../../packages/client-core/src/playback-v1/local-http';
import {NativeScreenLifetime} from './lifetime';
import {createNativeSettingsController} from './settings-controller';
import {NativeLiveController} from './live-controller';
import {NativeDashboardController, type NativeDashboardAdmission} from './dashboard-controller';
import {NativeTogetherController} from './together-controller';
import {NativeTogetherMedia} from './together-media';
import {createNativeRecordingsController} from './recordings-controller';
import {NativeSettingsScreen} from './SettingsScreen';
import {NativeLiveScreen} from './LiveScreen';
import {NativeTogetherScreen} from './TogetherScreen';
import {NativeDashboardScreen} from './DashboardScreen';
import type {NativeSettingsLivePorts, NativeSettingsLiveRenderers} from './ports';

export type {NativeSettingsLivePorts, NativeSettingsLiveRenderers} from './ports';
export {NativeScreenLifetime} from './lifetime';
export {NativeSettingsController} from './settings-controller';
export {NativeLiveController} from './live-controller';
export {NativeTogetherController, type NativeTogetherService} from './together-controller';
export {NativeDashboardController} from './dashboard-controller';
export {NativeRecordingsController, type NativeRecordingsSnapshot, type NativeRecordingQuery, type NativeRecordingService} from './recordings-controller';

/** No global registration. Accounts composes the one shell dispatcher with Destinations. */
export function createNativeSettingsLiveRenderers(ports: NativeSettingsLivePorts): NativeSettingsLiveRenderers {
  const {context} = ports;
  const lifetime = new NativeScreenLifetime(context);
  const api = {request: <T,>(path: string, method?: string, body?: unknown, signal?: AbortSignal) => lifetime.request(next => context.api.request<T>(path, method, body, next), signal)};
  const raw = localV1Http(context.api);
  const sessions = new AdminSessionsClient({send: request => lifetime.request(signal => raw.send({...request, signal}), request.signal)}, ports.requestId);
  const settings = createNativeSettingsController(lifetime, api, context.preferences());
  const live = new NativeLiveController(lifetime, api, Intl.DateTimeFormat().resolvedOptions().timeZone);
  const recordings = createNativeRecordingsController(lifetime, api, ports.dvrRequestId);
  const together = new NativeTogetherController(lifetime, ports.together);
  const togetherMedia = new NativeTogetherMedia(lifetime, api);
  const admission = (): NativeDashboardAdmission => {
    if (!lifetime.current()) return 'denied';
    const account = context.account;
    if (!account.canManage || account.account.primaryProfileId !== lifetime.authority.profileId || account.account.disabled) return 'denied';
    return account.account.role === 'owner' ? 'owner' : account.account.role === 'admin' ? 'administrator' : 'denied';
  };
  const dashboard = new NativeDashboardController(lifetime, admission, {sessions, console: new ConsoleClient(api, {serverId: lifetime.authority.serverId, viewerId: lifetime.authority.profileId})});
  const unsubscribe = context.subscribePreferences(() => {if (lifetime.current()) settings.accept(context.preferences());});
  let disposed = false, releaseAuthority = () => {};
  const dispose = () => {if (disposed) return; disposed = true; releaseAuthority(); unsubscribe(); settings.dispose(); live.dispose(); recordings.dispose(); together.dispose(); togetherMedia.dispose(); dashboard.dispose(); lifetime.dispose();};
  releaseAuthority = context.subscribeAuthority(() => {if (!lifetime.current()) dispose();});
  return {
    settings: {render: (route, runtime) => {lifetime.assert(); if (route.kind !== 'shell' || route.destination.kind !== 'settings') throw new Error('native_settings_route_mismatch'); return <NativeSettingsScreen ports={ports} controller={settings} runtime={runtime}/>;}},
    live: {render: (route, runtime) => {lifetime.assert(); if (route.kind !== 'shell' || route.destination.kind !== 'live') throw new Error('native_live_route_mismatch'); return <NativeLiveScreen ports={ports} controller={live} recordings={recordings} runtime={runtime}/>;}},
    together: {render: (route, runtime) => {lifetime.assert(); if (route.kind !== 'together') throw new Error('native_together_route_mismatch'); return <NativeTogetherScreen ports={ports} controller={together} media={togetherMedia} runtime={runtime}/>;}},
    serverDashboard: {render: (route, runtime) => {lifetime.assert(); if (route.kind !== 'server-dashboard') throw new Error('native_dashboard_route_mismatch'); return <NativeDashboardScreen ports={ports} controller={dashboard} runtime={runtime} deniedFallback={<NativeSettingsScreen ports={ports} controller={settings} runtime={runtime}/>}/>;}},
    dispose,
  };
}
