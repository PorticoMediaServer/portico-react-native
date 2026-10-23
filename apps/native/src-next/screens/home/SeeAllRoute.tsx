import React, {useEffect, useLayoutEffect, useRef, useState} from 'react';
import {Platform, View, useWindowDimensions} from 'react-native';
import {useFocusRegistry, type FocusSnapshot} from '../../kit/focus';
import {HomeSeeAll} from './HomeSeeAll';
import {HomeRowFilters} from './HomeRowFilters';
import {NativeHomeRowController} from './row-controller';
import {nativeRouteCrypto} from '../../platform/server-connections';
import type {NativeShellBootstrapContext} from '../../shell/bootstrap';
import type {NativeShellRuntime} from '../../shell/runtime';
import {titleRoute, type NativeShellRoute} from '../../shell/routes';
import {nativeShellRoutes, type NativeRouteRenderer} from '../../shell/route-registry';
import {shellLayout} from '../../shell/model';
import {useTheme} from '../../kit/theme';
import {hiddenReadingLibraryOnTV} from '../read/platform';
import {nativeHomeEntryLifetime} from './entry-lifetime';

type RowRoute = Extract<NativeShellRoute, {kind: 'home-see-all'}>;
type RowLifetime = Readonly<{route: RowRoute; controller: NativeHomeRowController; abort: AbortController; key: number; labels: ReadonlyMap<string, string>}>;

export function createNativeHomeSeeAllRenderer(context: NativeShellBootstrapContext): NativeRouteRenderer & {renderRetained: (runtime: NativeShellRuntime) => React.ReactNode} {
  let disposed = false, runtime: NativeShellRuntime | undefined;
  const rows = createNativeHomeRows(context, error => {if (!disposed && context.current()) {if (!runtime) throw error; runtime.reportError(error);}});
  const unsubscribe = context.navigation.subscribe(rows.reconcile);
  rows.reconcile();
  return {
    render: (route, actual) => {
      if (route.kind !== 'home-see-all' || route.destination.type !== 'row') throw new Error('native_home_row_route_mismatch');
      runtime = actual; rows.reconcile(); return null;
    },
    renderRetained: actual => {runtime = actual; return <HomeRowsCanvas>{rows.render(actual)}</HomeRowsCanvas>;},
    dispose: () => {disposed = true; unsubscribe(); rows.dispose(); runtime = undefined;},
  };
}

function HomeRowsCanvas({children}: {children: React.ReactNode}) {
  const theme = useTheme(), window = useWindowDimensions();
  const layout = shellLayout(window.width, window.height, theme.isTV);
  return <View pointerEvents="box-none" style={{position: 'absolute', inset: 0}}>
    {theme.isTV ? <View pointerEvents="box-none" style={{position: 'absolute', left: layout.left, top: layout.top, width: layout.width, height: layout.height,
      transformOrigin: 'top left', transform: [{scale: layout.scale}]}}>{children}</View> : children}
  </View>;
}

/** Own only actual row destinations. Retaining a title never replaces the
 * requested row, its sparse collection, sort/filter state or mounted grid. */
export function createNativeHomeRows(context: NativeShellBootstrapContext, reportError: (error: unknown) => void) {
  const rows = new Map<RowRoute, RowLifetime>();
  let alive = true, sequence = 0;
  const retained = () => alive && context.current()
    ? [...context.navigation.retainedRoutes(), context.navigation.getSnapshot().route] : [];
  const current = (source: RowLifetime) => alive && context.current() && rows.get(source.route) === source && context.navigation.getSnapshot().route === source.route;
  const reconcile = () => {
    const keep = new Set(retained());
    for (const [route, source] of rows) if (!keep.has(route)) {source.abort.abort(); source.controller.dispose(); rows.delete(route);}
    for (const route of keep) {
      if (route.kind !== 'home-see-all' || route.destination.type !== 'row' || rows.has(route)) continue;
      const controller = new NativeHomeRowController({api: context.api, rowId: route.destination.rowId, viewerFence: context.authority().viewerFence,
        current: () => alive && context.current() && rows.has(route),
        kinds: context.libraries().filter(library => !Platform.isTV || !hiddenReadingLibraryOnTV(library.kind)).map(library => ({id: library.id, libraryIds: [library.id]}))});
      rows.set(route, {route, controller, abort: new AbortController(), key: ++sequence, labels: new Map(context.libraries().map(library => [library.id, library.name]))});
    }
  };
  const play = (source: RowLifetime, shuffle: boolean) => {
    if (!current(source)) return;
    const query = source.controller.wholeGroup();
    if (!query) return;
    const pending = new AbortController(), abort = () => pending.abort();
    source.abort.signal.addEventListener('abort', abort, {once: true});
    const off = context.navigation.subscribe(() => {if (!current(source)) pending.abort();});
    void context.playback.runtime.startGroup({query, shuffle, signal: pending.signal, isCurrent: () => current(source)}).catch(error => {
      if (!pending.signal.aborted && current(source)) reportError(error);
    }).finally(() => {
      source.abort.signal.removeEventListener('abort', abort); off();
    });
  };
  return {
    reconcile,
    owns: (route: NativeShellRoute) => rows.has(route as RowRoute),
    render: (runtime: NativeShellRuntime) => [...rows.values()].map(source => <RetainedHomeRow key={source.key} source={source} runtime={runtime} active={current(source)}
      onBack={() => {if (current(source)) context.navigation.back(context.authority());}}
      onPlay={shuffle => play(source, shuffle)}
      onOpen={entry => {if (current(source)) context.navigation.open(titleRoute(entry), context.authority());}}
      onPlayEntry={(entry, entryCurrent) => {
        if (!current(source) || !entryCurrent() || !entry.playback) return;
        const captured = context.navigation.getSnapshot();
        const operation = nativeHomeEntryLifetime(() => current(source) && context.navigation.getSnapshot() === captured && entryCurrent(),
          [context.navigation.subscribe, source.controller.subscribe, source.controller.collection.subscribe], source.abort.signal);
        void context.playback.start({entry, target: entry.playback, lifetime: operation.lifetime})
          .catch(error => {if (operation.lifetime.isCurrent()) reportError(error);}).finally(operation.dispose);
      }}
      kindLabel={id => source.labels.get(id)!}/>),
    dispose: () => {alive = false; for (const source of rows.values()) {source.abort.abort(); source.controller.dispose();} rows.clear();},
  };
}

nativeShellRoutes.registerRoute('home-see-all', createNativeHomeSeeAllRenderer);

function RetainedHomeRow({source, runtime, active, onBack, onPlay, onOpen, onPlayEntry, kindLabel}: {
  source: RowLifetime; runtime: NativeShellRuntime; active: boolean;
  onBack: () => void; onPlay: (shuffle: boolean) => void;
  onOpen: React.ComponentProps<typeof HomeSeeAll>['onOpen']; onPlayEntry: React.ComponentProps<typeof HomeSeeAll>['onPlayEntry']; kindLabel: (id: string) => string;
}) {
  const registry = useFocusRegistry(), opener = useRef<FocusSnapshot | undefined>(undefined), release = useRef<(() => void) | undefined>(undefined), shown = useRef(active);
  const [filters, setFilters] = useState(false);
  useEffect(() => {if (!active) return; const remember = () => {const value = registry.capture(); if (value?.regionId.startsWith('home-see-all:')) opener.current = value;};
    remember(); return registry.subscribe(remember);
  }, [active, registry]);
  useLayoutEffect(() => {
    if (shown.current && !active && opener.current && !release.current) release.current = registry.retain(opener.current);
    const restored = !shown.current && active; shown.current = active;
    if (!restored) return;
    release.current?.(); release.current = undefined;
    const frame = requestAnimationFrame(() => registry.restore(opener.current));
    return () => cancelAnimationFrame(frame);
  }, [active, registry]);
  useEffect(() => () => release.current?.(), []);
  return <View pointerEvents={active ? 'auto' : 'none'} accessibilityElementsHidden={!active} importantForAccessibility={active ? 'auto' : 'no-hide-descendants'}
    style={{position: 'absolute', inset: 0, opacity: active ? 1 : 0}}>
    <HomeSeeAll controller={source.controller} runtime={runtime} active={active && !filters} onBack={onBack} onPlay={onPlay} onOpen={onOpen} onPlayEntry={onPlayEntry}
      onFilters={() => setFilters(true)} kindLabel={kindLabel} onReshuffle={() => {if (active) try {const bytes = nativeRouteCrypto.random(4); const sort = source.controller.getSnapshot().sort;
        if (sort) source.controller.setSort({...sort, seed: new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength).getUint32(0)});} catch (error) {runtime.reportError(error);}}}/>
    {active && filters && <HomeRowFilters controller={source.controller} runtime={runtime} onClose={() => setFilters(false)}/>}
  </View>;
}
