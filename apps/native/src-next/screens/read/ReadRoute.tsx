import React from 'react';
import {Platform} from 'react-native';
import type {NativeShellBootstrapContext} from '../../shell/bootstrap';
import type {NativeRouteRenderer} from '../../shell/route-registry';
import type {NativeShellRoute} from '../../shell/routes';
import type {ReadNativeHost} from './ReadNativeHost';
import {nativeReadHost} from './host-component';

type ReadTarget = Extract<NativeShellRoute, {kind: 'read'}>;
const targetKey = (target: ReadTarget) => JSON.stringify([target.itemId, target.sourceId, target.downloadId, target.contentsTarget?.sourceRevision, target.contentsTarget?.index]);
type Preferences = React.ComponentProps<typeof ReadNativeHost>['preferences'];
export function createNativeReadRenderer(context: NativeShellBootstrapContext, preferences: Preferences, openSettings: () => void): NativeRouteRenderer {
  if (Platform.isTV) throw new Error('native_read_unavailable');
  const Host = nativeReadHost();
  let alive = true, target: ReadTarget | undefined;
  const reconcile = () => {
    if (!alive || !context.current()) {target = undefined; return;}
    const route = context.navigation.getSnapshot().route;
    if (route.kind === 'read') {
      if (!target || targetKey(target) !== targetKey(route)) target = route;
    } else if (route.kind !== 'settings-page' || !context.navigation.retainedRoutes().some(value => value === target)) target = undefined;
  };
  return {
    render(route) {if (route.kind !== 'read') throw new Error('native_read_route_mismatch'); reconcile(); return null;},
    renderRetained() {
      reconcile(); if (!target) return null;
      const active = context.navigation.getSnapshot().route.kind === 'read';
      return <Host key={targetKey(target)} context={context} target={target} active={active} preferences={preferences}
        onBack={() => {if (context.current()) context.navigation.back(context.authority());}} onOpenSettings={openSettings}/>;
    },
    dispose() {alive = false; target = undefined;},
  };
}
