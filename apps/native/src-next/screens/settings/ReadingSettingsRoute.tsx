import React from 'react';
import {Platform} from 'react-native';
import type {NativeShellBootstrapContext} from '../../shell/bootstrap';
import {nativeShellRoutes, type NativeRouteRenderer} from '../../shell/route-registry';
import {NativeReadingSettingsScreen} from './ReadingSettingsScreen';
import {nativeReadingPreferencesAvailable, nativeReadingSettingsPreferences} from './reading-preferences';

export {nativeReadingSettingsPreferences} from './reading-preferences';
export type {NativeReadingSettingsPreferences} from './reading-preferences';

/** A real Settings child route; Back restores the retained publication's exact history. */
export function openNativeReadingSettings(context: NativeShellBootstrapContext): boolean {
  if (Platform.isTV || !context.current() || !nativeReadingPreferencesAvailable(context.preferences())) return false;
  return context.navigation.open({kind: 'settings-page', scope: 'account', page: 'reading'}, context.authority());
}

export function createNativeReadingSettingsRenderer(context: NativeShellBootstrapContext): NativeRouteRenderer {
  const source = nativeReadingSettingsPreferences(context);
  return {render: (route, runtime) => {
    if (Platform.isTV || route.kind !== 'settings-page' || route.scope !== 'account' || route.page !== 'reading') throw new Error('native_reading_settings_route_mismatch');
    const captured = context.navigation.getSnapshot();
    const current = () => source.current() && context.navigation.getSnapshot() === captured;
    return <NativeReadingSettingsScreen source={source} runtime={runtime} current={current}
      onBack={() => {if (current()) context.navigation.back(context.authority());}}/>;
  }};
}

nativeShellRoutes.registerRoute('settings-page', createNativeReadingSettingsRenderer);
