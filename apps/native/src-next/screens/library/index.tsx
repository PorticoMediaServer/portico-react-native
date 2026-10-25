import React from 'react';
import {Platform} from 'react-native';
import type {BrowseLabels} from '../../kit/browse';
import type {NativeShellBootstrapContext} from '../../shell/bootstrap';
import type {NativeRouteRenderer} from '../../shell/route-registry';
import type {NativeDestinationActivationPort} from '../destinations/focus';
import {nativeDestinationLifetime} from '../destinations/lifetime';
import {LibraryScreen, type NativeLibraryActions, type NativeLibrarySelectionPort} from './LibraryScreen';
import {NativeLibraryDestination} from './model';
import {NativeLibraryDirectory} from './directory';
import {hiddenReadingLibraryOnTV, isReadingLibraryKind} from '../read/platform';
import {NativeReadingLibraryScreen} from '../read/ReadingLibrary';
import {createNativeLibraryPlaySelection} from './play-selection';
import {createNativeTVLibraryNamingStore, nativeTVLibraryActions, nativeTVNamingPanelId, NativeTVLibrarySurface} from './tv-library';
import type {NativeTVLibraryNamingStore} from './tv-library';

export type NativeLibraryRendererPorts = Readonly<{
  activation: (libraryId: string) => NativeDestinationActivationPort;
  labels: BrowseLabels;
  actions: NativeLibraryActions | ((destination: NativeLibraryDestination) => NativeLibraryActions);
  /** Only a genuine nonHome execution port enables selection. */
  selection?: (destination: NativeLibraryDestination) => NativeLibrarySelectionPort;
}>;

/** Accounts composes this descriptor into its ONE shell dispatcher. A removed
 * ID returns no screen here; the shell's authorized overview handles it. */
export function createNativeLibraryRenderer(context: NativeShellBootstrapContext, ports: NativeLibraryRendererPorts): NativeRouteRenderer & {dispose: () => void} {
  const lifetime = nativeDestinationLifetime(context);
  let disposed = false, selected: Readonly<{id: string; kind: string; name: string; destination: NativeLibraryDestination; actions: NativeLibraryActions; selection?: NativeLibrarySelectionPort}> | undefined;
  // TV owns exactly one extra surface for a Library route: the F-LIB-52 Save
  // view name keyboard. Other platforms keep their own sheet unchanged.
  let tvNaming: NativeTVLibraryNamingStore | undefined;
  const tvNamingStore = (): NativeTVLibraryNamingStore => tvNaming ??= createNativeTVLibraryNamingStore(context);
  const retireSelected = () => {selected?.actions.dispose?.(); selected?.destination.dispose(); selected = undefined;};
  const current = () => !disposed && lifetime.current();
  const directory = new NativeLibraryDirectory({api: context.api, current});
  return {
    render(route, runtime) {
      if (!current() || route.kind !== 'shell' || route.destination.kind !== 'library') return null;
      const id = route.destination.libraryId, library = context.libraries().find(value => value.id === id);
      if (!library || Platform.isTV && hiddenReadingLibraryOnTV(library.kind)) {retireSelected(); return null;}
      // Book and comic libraries have no browse pivot: their authored producer is
      // the bounded Reading list (`GET /v1/reading/items`), not generic content.
      if (isReadingLibraryKind(library.kind)) {
        if (selected) retireSelected();
        return <NativeReadingLibraryScreen key={id} context={context} runtime={runtime} libraryId={id} title={library.name} labels={ports.labels}
          onBack={() => runtime.onDestination({kind: 'libraries'})}/>;
      }
      if (selected?.id !== id || selected.kind !== library.kind || selected.name !== library.name) {
        retireSelected();
        const destination = new NativeLibraryDestination({api: context.api, scope: lifetime.scope, library,
          current: () => current() && context.libraries().some(value => value.id === id && value.kind === library.kind)});
        const actions = typeof ports.actions === 'function' ? ports.actions(destination) : ports.actions;
        selected = {id, kind: library.kind, name: library.name, destination,
          actions: Platform.isTV ? nativeTVLibraryActions(actions, tvNamingStore(), destination) : actions,
          selection: ports.selection?.(destination)};
      }
      const page = <LibraryScreen key={id} destination={selected.destination} runtime={runtime} directory={directory} libraries={context.libraries()}
        activation={ports.activation(id)} labels={ports.labels} actions={selected.actions} selection={selected.selection} owner={context.session()?.viewer.role === 'owner'}/>;
      return tvNaming ? <NativeTVLibrarySurface key={id} library={page} naming={tvNaming} panelId={nativeTVNamingPanelId(context.authority(), id)}/> : page;
    },
    dispose() {if (disposed) return; disposed = true; retireSelected(); tvNaming?.dispose(); tvNaming = undefined; directory.dispose();},
  };
}

export type {NativeLibraryActions, NativeLibrarySelectionPort} from './LibraryScreen';
export type {NativeLibraryViewDraft} from './model';
export {createNativeLibraryPlaySelection};
