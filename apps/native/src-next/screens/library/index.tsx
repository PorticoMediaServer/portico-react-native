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
import {hiddenReadingLibraryOnTV} from '../read/platform';

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
  const retireSelected = () => {selected?.actions.dispose?.(); selected?.destination.dispose(); selected = undefined;};
  const current = () => !disposed && lifetime.current();
  const directory = new NativeLibraryDirectory({api: context.api, current});
  return {
    render(route, runtime) {
      if (!current() || route.kind !== 'shell' || route.destination.kind !== 'library') return null;
      const id = route.destination.libraryId, library = context.libraries().find(value => value.id === id);
      if (!library || Platform.isTV && hiddenReadingLibraryOnTV(library.kind)) {retireSelected(); return null;}
      if (selected?.id !== id || selected.kind !== library.kind || selected.name !== library.name) {
        retireSelected();
        const destination = new NativeLibraryDestination({api: context.api, scope: lifetime.scope, library,
          current: () => current() && context.libraries().some(value => value.id === id && value.kind === library.kind)});
        selected = {id, kind: library.kind, name: library.name, destination, actions: typeof ports.actions === 'function' ? ports.actions(destination) : ports.actions, selection: ports.selection?.(destination)};
      }
      return <LibraryScreen key={id} destination={selected.destination} runtime={runtime} directory={directory} libraries={context.libraries()}
        activation={ports.activation(id)} labels={ports.labels} actions={selected.actions} selection={selected.selection} owner={context.session()?.viewer.role === 'owner'}/>;
    },
    dispose() {if (disposed) return; disposed = true; retireSelected(); directory.dispose();},
  };
}

export type {NativeLibraryActions, NativeLibrarySelectionPort} from './LibraryScreen';
export type {NativeLibraryViewDraft} from './model';
export {createNativeLibraryPlaySelection} from './play-selection';
