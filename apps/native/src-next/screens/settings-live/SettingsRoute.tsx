import React from 'react';
import {AdminSessionsClient} from '../../../../../packages/client-core/src/playback-v1/admin-sessions';
import {localV1Http} from '../../../../../packages/client-core/src/playback-v1/local-http';
import {ConsoleClient} from '../../../../../packages/client-core/src/console';
import type {NativeShellBootstrapContext} from '../../shell/bootstrap';
import type {NativeRouteRenderer} from '../../shell/route-registry';
import {NativeScreenLifetime} from './lifetime';
import {createBoundNativeSettingsController} from './settings-controller';
import {nativeDevicePreferences} from './device-preference-consumer';
import {NativeDashboardController, type NativeDashboardAdmission} from './dashboard-controller';
import {NativeEqualizerSettingsScreen} from './EqualizerSettingsScreen';
import {NativeSettingsScreen} from './SettingsScreen';
import {NativeDashboardScreen} from './DashboardScreen';
import {createNativeSettingsPorts, nativeSettingsRequestId} from './settings-ports';

/**
 * The one composition Accounts hands the shell: the Settings destination and the read-only
 * owner Dashboard route. It registers nothing itself; the shell's settings-register module owns
 * the single registration and the TV/phone entry imports.
 */
function createComposition(context: NativeShellBootstrapContext) {
  const lifetime = new NativeScreenLifetime(context);
  const devicePreferences = nativeDevicePreferences(context);
  const settings = createBoundNativeSettingsController(lifetime, context);
  const ports = createNativeSettingsPorts(context, lifetime, route => context.navigation.open(route, context.authority()));
  const unsubscribe = context.subscribePreferences(() => {if (lifetime.current()) settings.accept(context.preferences());});
  const api = {request: <T,>(path: string, method?: string, body?: unknown, signal?: AbortSignal) => lifetime.request(next => context.api.request<T>(path, method, body, next), signal)};
  const raw = localV1Http(context.api);
  const sessions = new AdminSessionsClient({send: request => lifetime.request(signal => raw.send({...request, signal}), request.signal)}, nativeSettingsRequestId);
  const admission = (): NativeDashboardAdmission => {
    if (!lifetime.current()) return 'denied';
    const account = context.account;
    if (!account.canManage || account.account.primaryProfileId !== lifetime.authority.profileId || account.account.disabled) return 'denied';
    return account.account.role === 'owner' ? 'owner' : account.account.role === 'admin' ? 'administrator' : 'denied';
  };
  const dashboard = new NativeDashboardController(lifetime, admission, {sessions, console: new ConsoleClient(api, {serverId: lifetime.authority.serverId, viewerId: lifetime.authority.profileId})});
  let disposed = false;
  const dispose = () => {if (disposed) return; disposed = true; unsubscribe(); dashboard.dispose(); lifetime.dispose();};
  return {
    settings: {
      render: (route, runtime) => {
        lifetime.assert();
        if (route.kind !== 'shell' || route.destination.kind !== 'settings') throw new Error('native_settings_route_mismatch');
        return <NativeSettingsScreen ports={ports} controller={settings} runtime={runtime} devicePreferences={devicePreferences}/>;
      },
      dispose,
    } satisfies NativeRouteRenderer,
    dashboard: {
      render: (route, runtime) => {
        lifetime.assert();
        if (route.kind !== 'server-dashboard') throw new Error('native_server_dashboard_route_mismatch');
        return <NativeDashboardScreen ports={ports} controller={dashboard} runtime={runtime}
          deniedFallback={<NativeSettingsScreen ports={ports} controller={settings} runtime={runtime} devicePreferences={devicePreferences}/>}/>;
      },
      dispose,
    } satisfies NativeRouteRenderer,
  } as const;
}

export function createNativeSettingsRenderer(context: NativeShellBootstrapContext): NativeRouteRenderer {
  return createComposition(context).settings;
}

export function createNativeServerDashboardRenderer(context: NativeShellBootstrapContext): NativeRouteRenderer {
  return createComposition(context).dashboard;
}

/** Additive device editor route; playback and Settings share the native singleton. */
export function createNativeEqualizerSettingsRenderer(context: NativeShellBootstrapContext): NativeRouteRenderer {
  const lifetime = new NativeScreenLifetime(context);
  return {
    render: (route, runtime) => {
      lifetime.assert();
      if (route.kind !== 'settings-equalizer') throw new Error('native_equalizer_settings_route_mismatch');
      return <NativeEqualizerSettingsScreen runtime={runtime} onBack={() => context.navigation.back(context.authority())}/>;
    },
    dispose: () => lifetime.dispose(),
  };
}
