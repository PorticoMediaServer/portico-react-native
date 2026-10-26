import React from 'react';
import {Platform} from 'react-native';
import type {NativeShellBootstrapContext} from '../../shell/bootstrap';
import type {NativeRouteRenderer} from '../../shell/route-registry';
import type {NativeShellRoute} from '../../shell/routes';
import type {ReadNativeHost} from './ReadNativeHost';
import {nativeReadHost} from './host-component';

type ReadTarget = Extract<NativeShellRoute, {kind: 'read'}>;
type Preferences = React.ComponentProps<typeof ReadNativeHost>['preferences'];
/** One host per retained read route. A reader opened from search results is a
 * second route, never a replacement for the one the person was already reading;
 * each keeps its own guest and session until its own route is retired. */
export function createNativeReadRenderer(context: NativeShellBootstrapContext, preferences: Preferences, openSettings: () => void): NativeRouteRenderer {
  if (Platform.isTV) throw new Error('native_read_unavailable');
  const Host = nativeReadHost();
  let alive = true, sequence = 0;
  const hosts = new Map<ReadTarget, number>();
  const reconcile = () => {
    if (!alive || !context.current()) {hosts.clear(); return;}
    const retained = new Set<NativeShellRoute>([...context.navigation.retainedRoutes(), context.navigation.getSnapshot().route]);
    for (const route of [...hosts.keys()]) if (!retained.has(route)) hosts.delete(route);
    for (const route of retained) if (route.kind === 'read' && !hosts.has(route)) hosts.set(route, ++sequence);
  };
  return {
    render(route) {if (route.kind !== 'read') throw new Error('native_read_route_mismatch'); reconcile(); return null;},
    renderRetained() {
      reconcile();
      const current = context.navigation.getSnapshot().route;
      return <>{[...hosts].map(([route, key]) => <Host key={key} context={context} target={route} active={current === route} preferences={preferences}
        onBack={() => {if (context.current()) context.navigation.back(context.authority());}} onOpenSettings={openSettings}/>)}</>;
    },
    dispose() {alive = false; hosts.clear();},
  };
}
