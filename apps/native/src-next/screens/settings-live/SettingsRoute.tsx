import React from 'react';
import {Platform} from 'react-native';
import {AdminSessionsClient} from '../../../../../packages/client-core/src/playback-v1/admin-sessions';
import {localV1Http} from '../../../../../packages/client-core/src/playback-v1/local-http';
import {ConsoleClient} from '../../../../../packages/client-core/src/console';
import type {NativeShellBootstrapContext} from '../../shell/bootstrap';
import type {NativeRouteRenderer} from '../../shell/route-registry';
import {NativeScreenLifetime} from './lifetime';
import {createBoundNativeSettingsController} from './settings-controller';
import {nativeDevicePreferences} from './device-preference-consumer';
import {NativeDashboardController, type NativeDashboardAdmission} from './dashboard-controller';
import {nativeServerAdmission} from './server/tv-server-reader';
import {NativeTVServerScreen} from './server/TVServerScreen';
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
  const admission = (): NativeDashboardAdmission => nativeServerAdmission(context.account, lifetime);
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
    serverSettings: {
      render: (route, runtime) => {
        lifetime.assert();
        if (route.kind !== 'server-settings') throw new Error('native_server_settings_route_mismatch');
        // The TV list currently implements the owner's Libraries page. Administrators
        // retain the existing real Dashboard; members and secondary profiles fall back.
        const allowed = admission();
        const fallback = <NativeSettingsScreen ports={ports} controller={settings} runtime={runtime} devicePreferences={devicePreferences}/>;
        if (allowed === 'denied') return fallback;
        if (allowed === 'administrator' || !Platform.isTV) return <NativeDashboardScreen ports={ports} controller={dashboard} runtime={runtime} deniedFallback={fallback}/>;
        return <NativeTVServerScreen key={route.page ?? 'libraries'} ports={ports} runtime={runtime} initialPage={route.page}/>;
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

export function createNativeTVServerSettingsRenderer(context: NativeShellBootstrapContext): NativeRouteRenderer {
  return createComposition(context).serverSettings;
}

/** Additive device editor route; playback and Settings share the native singleton. */
export function createNativeEqualizerSettingsRenderer(context: NativeShellBootstrapContext): NativeRouteRenderer {
  const lifetime = new NativeScreenLifetime(context);
  return {
    render: (route, runtime) => {
      lifetime.assert();
      if (route.kind !== 'settings-equalizer') throw new Error('native_equalizer_settings_route_mismatch');
      return <NativeEqualizerSettingsScreen runtime={runtime} onBack={() => {lifetime.assert(); context.navigation.back(context.authority());}}/>;
    },
    dispose: () => lifetime.dispose(),
  };
}
