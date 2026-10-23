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
  actions: NativeLibraryActions;
  /** Only a genuine nonHome execution port enables selection. */
  selection?: (destination: NativeLibraryDestination) => NativeLibrarySelectionPort;
}>;

/** Accounts composes this descriptor into its ONE shell dispatcher. A removed
 * ID returns no screen here; the shell's authorized overview handles it. */
export function createNativeLibraryRenderer(context: NativeShellBootstrapContext, ports: NativeLibraryRendererPorts): NativeRouteRenderer & {dispose: () => void} {
  const lifetime = nativeDestinationLifetime(context);
  let disposed = false, selected: Readonly<{id: string; destination: NativeLibraryDestination; selection?: NativeLibrarySelectionPort}> | undefined;
  const current = () => !disposed && lifetime.current();
  const directory = new NativeLibraryDirectory({api: context.api, current});
  return {
    render(route, runtime) {
      if (!current() || route.kind !== 'shell' || route.destination.kind !== 'library') return null;
      const id = route.destination.libraryId, library = context.libraries().find(value => value.id === id);
      if (!library || Platform.isTV && hiddenReadingLibraryOnTV(library.kind)) {selected?.destination.dispose(); selected = undefined; return null;}
      if (selected?.id !== id) {
        selected?.destination.dispose();
        const destination = new NativeLibraryDestination({api: context.api, scope: lifetime.scope, library,
          current: () => current() && context.libraries().some(value => value.id === id && value.kind === library.kind)});
        selected = {id, destination, selection: ports.selection?.(destination)};
      }
      return <LibraryScreen key={id} destination={selected.destination} runtime={runtime} directory={directory} libraries={context.libraries()}
        activation={ports.activation(id)} labels={ports.labels} actions={ports.actions} selection={selected.selection} owner={context.session()?.viewer.role === 'owner'}/>;
    },
    dispose() {if (disposed) return; disposed = true; selected?.destination.dispose(); selected = undefined; directory.dispose();},
  };
}

export type {NativeLibraryActions, NativeLibrarySelectionPort} from './LibraryScreen';
export type {NativeLibraryViewDraft} from './model';
