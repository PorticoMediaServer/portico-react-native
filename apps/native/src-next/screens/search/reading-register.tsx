import React, {useEffect, useSyncExternalStore} from 'react';
import {Platform, View} from 'react-native';
import type {NativeShellBootstrapContext} from '../../shell/bootstrap';
import type {NativeShellRuntime} from '../../shell/runtime';
import type {NativeShellRoute} from '../../shell/routes';
import type {NativeRouteRenderer} from '../../shell/route-registry';
import {nativeDestinationLifetime} from '../destinations/lifetime';
import {createNativeReadingSearch, type NativeReadingSearchPort} from './reading-search';
import {ReadingSearchScreen} from './ReadingSearchScreen';

type SearchRoute = Extract<NativeShellRoute, {kind: 'search-reading'}>;
type Entry = Readonly<{route: SearchRoute; key: number; port: NativeReadingSearchPort}>;

/** Root54 native surface. One controller per retained route, fenced by its own
 * authority lifetime and the route still being current or retained; a popped route
 * disposes it in the same pass. `render` owns nothing so the page can stay mounted
 * under a reader it opened, exactly as the read route stays under Settings. */
export function createNativeReadingSearchModule(context: NativeShellBootstrapContext): NativeRouteRenderer {
  if (Platform.isTV) throw new Error('native_reading_search_unavailable');
  const lifetime = nativeDestinationLifetime(context), entries = new Map<SearchRoute, Entry>();
  let disposed = false, sequence = 0;
  const current = () => !disposed && lifetime.current();
  const reconcile = () => {
    const routes = current() ? [...context.navigation.retainedRoutes(), context.navigation.getSnapshot().route] : [];
    const keep = new Set(routes);
    for (const [route, entry] of entries) if (!keep.has(route)) {entries.delete(route); entry.port.dispose();}
    for (const route of routes) {
      if (route.kind !== 'search-reading' || entries.has(route)) continue;
      entries.set(route, {route, key: ++sequence, port: createNativeReadingSearch(context, route)});
    }
  };
  const stops = [context.navigation.subscribe(reconcile), context.subscribeAuthority(reconcile)];
  const back = (route: SearchRoute) => {
    if (current() && context.navigation.getSnapshot().route === route) context.navigation.back(context.authority());
  };
  return {
    render: () => {reconcile(); return null;},
    renderRetained: runtime => {
      reconcile();
      return <>{[...entries.values()].map(entry => <ReadingSearchHost key={entry.key} entry={entry} runtime={runtime}
        navigation={context.navigation} onBack={() => back(entry.route)}/>)}</>;
    },
    dispose: () => {
      if (disposed) return;
      disposed = true; stops.forEach(stop => stop());
      for (const entry of entries.values()) entry.port.dispose();
      entries.clear();
    },
  };
}

function ReadingSearchHost({entry, runtime, navigation, onBack}: Readonly<{
  entry: Entry; runtime: NativeShellRuntime; navigation: NativeShellBootstrapContext['navigation']; onBack: () => void;
}>) {
  const visible = useSyncExternalStore(navigation.subscribe, () => navigation.getSnapshot().route === entry.route);
  useEffect(() => {entry.port.attachReporter(runtime.reportError);}, [entry, runtime]);
  // A committed visible opening is the only authority the page acts under: it runs the
  // carried words the first time, and re-witnesses the new navigation commit on Back.
  useEffect(() => {if (visible) entry.port.admit();}, [entry, visible]);
  return <View pointerEvents={visible ? 'auto' : 'none'} accessibilityElementsHidden={!visible} importantForAccessibility={visible ? 'auto' : 'no-hide-descendants'}
    style={{position: 'absolute', inset: 0, display: visible ? 'flex' : 'none'}}>
    <ReadingSearchScreen port={entry.port} runtime={runtime} query={entry.route.query} onBack={onBack}/>
  </View>;
}
