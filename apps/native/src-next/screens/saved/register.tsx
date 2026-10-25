import React, {useMemo, useSyncExternalStore} from 'react';
import {Platform, View, useWindowDimensions} from 'react-native';
import type {MessageId} from '../../../../../packages/i18n/src';
import type {Library} from '../../../../../packages/client-core/src/index';
import type {NativeShellBootstrapContext} from '../../shell/bootstrap';
import {shellLayout} from '../../shell/model';
import type {NativeShellRuntime} from '../../shell/runtime';
import type {NativeShellRoute} from '../../shell/routes';
import {nativeShellRoutes, type NativeRouteRenderer} from '../../shell/route-registry';
import {useTheme} from '../../kit/theme';
import {nativeDestinationLifetime} from '../destinations/lifetime';
import {SavedScreen} from './SavedScreen';
import {SavedDirectoryScreen, type NativeSavedDirectoryRoute} from './SavedDirectoryScreen';
import {SavedListScreen, type NativeSavedListRoute} from './SavedListScreen';
import {SavedResourceScreen} from './SavedResourceScreen';
import {createNativeSavedState} from './state';
import {nativeSavedRouteTarget, openNativeSavedView, type NativeSavedRouteTarget} from './navigation';
import type {NativeSavedDownloadsCopy} from './SavedDownloadCard';
import {nativeScreenServices} from '../native-screen-services';
import {createNativeSavedSelection} from './selection';
import {createNativeDownloadsView} from '../downloads/view';

const savedDownloadsCopy: NativeSavedDownloadsCopy = Object.freeze({downloading: 'next.saved.phone.downloading'});
const onThisPhone: MessageId = 'next.saved.phone.onThisPhone';

type RouteView = NonNullable<ReturnType<ReturnType<typeof createNativeSavedState>['view']>>;
type Entry = Readonly<{route: NativeSavedRouteTarget; key: number; view: RouteView}>;

/** The one Saved registration. TV's destination chrome is registered by the
 * TV-more owner; the pushed routes are this screen family's and register here
 * for every platform. */
export function createNativeSavedModule(context: NativeShellBootstrapContext): NativeRouteRenderer {
  const lifetime = nativeDestinationLifetime(context), state = createNativeSavedState(context), services = nativeScreenServices(context);
  let downloads: ReturnType<typeof createNativeDownloadsView> | undefined;
  const inlineDownloads = () => downloads ??= createNativeDownloadsView(context);
  const views = new Map<NativeSavedRouteTarget, Entry>();
  let selection: ReturnType<typeof createNativeSavedSelection> | undefined;
  const savedSelection = () => selection ??= createNativeSavedSelection(context, state.source, state.activation);
  let disposed = false, sequence = 0;
  const current = () => !disposed && lifetime.current();
  const retained = () => current() ? [...context.navigation.retainedRoutes(), context.navigation.getSnapshot().route] : [];
  const isSavedTarget = (route: NativeShellRoute): route is NativeSavedRouteTarget => route.kind === 'saved-view' || route.kind === 'saved-destination';
  const reconcile = () => {
    if (!current()) return;
    const keep = new Set(retained().filter(isSavedTarget));
    for (const [route, entry] of views) if (!keep.has(entry.route)) {views.delete(route); entry.view.dispose();}
    for (const route of keep) {
      if (views.has(route)) continue;
      const view = state.view(route);
      if (!view) continue;
      views.set(route, {route, key: ++sequence, view});
      void view.load().catch(error => {if (current()) services.reportError(error);});
    }
  };
  const changed = () => {
    if (!current()) return;
    void state.source.load().catch(error => {if (current()) services.reportError(error);});
    for (const entry of views.values()) void entry.view.source.refresh().catch((error: unknown) => {if (current()) services.reportError(error);});
  };
  const back = () => {if (current()) context.navigation.back(context.authority());};
  const open = (route: Parameters<typeof openNativeSavedView>[1]) => {if (current()) openNativeSavedView(context, route);};
  return {
    render: (route, runtime) => {
      if (!current()) return null;
      if (route.kind !== 'shell' || route.destination.kind !== 'saved') return null;
      if (Platform.isTV) return null;
      return <SavedScreen destination={state.source} runtime={runtime} device={state.offline} actions={state.actions} selection={savedSelection()}
        downloadsCopy={savedDownloadsCopy} onThisPhone={onThisPhone} activation={state.activation}
        downloads={Platform.isTV ? undefined : value => inlineDownloads().render(value, true)}/>;
    },
    renderRetained: runtime => {
      if (!current()) return null;
      reconcile();
      const hosts = <>{[...views.values()].map(entry => <SavedRouteHost key={entry.key} entry={entry} runtime={runtime} libraries={context.libraries()}
        open={open} back={back} changed={changed}/>)}</>;
      return <SavedRoutesCanvas>{hosts}</SavedRoutesCanvas>;
    },
    dispose: () => {
      if (disposed) return;
      disposed = true;
      selection?.dispose(); selection = undefined;
      for (const entry of views.values()) entry.view.dispose();
      views.clear(); state.dispose(); downloads?.dispose();
    },
  };
}

function SavedRoutesCanvas({children}: {children: React.ReactNode}) {
  const theme = useTheme(), window = useWindowDimensions(), layout = shellLayout(window.width, window.height, theme.isTV);
  return <View pointerEvents="box-none" style={{position: 'absolute', inset: 0}}>
    {theme.isTV ? <View pointerEvents="box-none" style={{position: 'absolute', left: layout.left, top: layout.top, width: layout.width, height: layout.height,
      transformOrigin: 'top left', transform: [{scale: layout.scale}]}}>{children}</View> : children}
  </View>;
}

function SavedRouteHost({entry, runtime, libraries, open, back, changed}: {
  entry: Entry; runtime: NativeShellRuntime; libraries: readonly Library[];
  open: (route: Parameters<typeof openNativeSavedView>[1]) => void; back: () => void; changed: () => void;
}) {
  const active = useSyncExternalStore(entry.view.activation.subscribe, entry.view.activation.getSnapshot);
  const route = useMemo(() => nativeSavedRouteTarget(entry.route), [entry.route]);
  const common = {destination: entry.view.source, activation: entry.view.activation, runtime};
  const body = route.view === 'playlists' || route.view === 'collections' || route.view === 'views'
    ? <SavedDirectoryScreen {...common} route={route as NativeSavedDirectoryRoute} actions={entry.view.actions} libraries={libraries} back={back} open={open} changed={changed}
        summaries={'summaries' in entry.view ? entry.view.summaries : undefined}/>
    : route.view === 'watchlist' || route.view === 'favorites' || route.view === 'history'
      ? <SavedListScreen {...common} route={route as NativeSavedListRoute} actions={entry.view.actions} back={back} changed={changed}/>
      : <SavedResourceScreen {...common} route={route} actions={entry.view.actions} libraries={libraries} back={back} changed={changed}/>;
  return <View pointerEvents={active.visible ? 'auto' : 'none'} accessibilityElementsHidden={!active.visible} importantForAccessibility={active.visible ? 'auto' : 'no-hide-descendants'}
    style={{position: 'absolute', inset: 0, backgroundColor: 'transparent'}}>{body}</View>;
}

// The phone hub is the only destination this family registers; the TV landing
// belongs to the TV-more owner, so a single platform registration avoids two
// factories for one shell kind.
if (!Platform.isTV) nativeShellRoutes.registerDestination('saved', createNativeSavedModule);
nativeShellRoutes.registerRoute('saved-view', createNativeSavedModule);
nativeShellRoutes.registerRoute('saved-destination', createNativeSavedModule);
