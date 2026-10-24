import React, {useSyncExternalStore} from 'react';
import {defaultI18n, type MessageId} from '../../../../../packages/i18n/src';
import type {SavedDefinition} from '../../../../../packages/client-core/src/personal-saved';
import type {BrowseCapabilities} from '../../../../../packages/client-core/src/browse';
import {browseNameId} from '../../../../../packages/client-core/src/presentation/browse-toolbar';
import type {NativeShellBootstrapContext} from '../../shell/bootstrap';
import type {NativeShellRuntime} from '../../shell/runtime';
import {nativeDestinationActivation} from '../../shell/routes';
import {nativeShellRoutes, type NativeRouteRenderer, type NativeShellRouteRegistry} from '../../shell/route-registry';
import {nativeScreenServices} from '../../screens/native-screen-services';
import {createNativeEntryActions} from '../../screens/destinations/entry-actions';
import {nativeDestinationLifetime} from '../../screens/destinations/lifetime';
import {createNativeLibraryRenderer} from '../../screens/library';
import {nativeLibraryCanSave, type NativeLibraryDestination, type NativeLibraryViewDraft} from '../../screens/library/model';
import {NativeLibrarySaveView} from '../../screens/library/save-view';

export type NativeTVLibraryNaming = Readonly<{controller: NativeLibrarySaveView; definition: SavedDefinition; suggestedName: string}>;
export type NativeTVLibraryBindings = Readonly<{
  /** Canonical conditions-only suggestion from the shared summary producer.
   * Undefined means an empty field under §38, never a locally derived name. */
  suggestName: (definition: SavedDefinition, capabilities: BrowseCapabilities) => string | undefined;
  /** The TV name keyboard owns its frame and Back/Save-view focus return. */
  renderNaming: (input: NativeTVLibraryNaming, runtime: NativeShellRuntime, onBack: () => void) => React.ReactNode;
}>;
type NamingStore = Readonly<{
  subscribe: (listener: () => void) => () => void;
  getSnapshot: () => NativeTVLibraryNaming | undefined;
}>;
function NamingOutlet({store, bindings, runtime, onBack}: {store: NamingStore; bindings: NativeTVLibraryBindings; runtime: NativeShellRuntime; onBack: () => void}) {
  const input = useSyncExternalStore(store.subscribe, store.getSnapshot);
  return input ? bindings.renderNaming(input, runtime, onBack) : null;
}
const label = (value: {id: string; labelKey?: string}) => {
  const key = browseNameId(value.id, value.labelKey, defaultI18n.has);
  if (!key) throw Object.assign(new Error('native_browse_copy_unavailable'), {code: 'invalid_response'});
  return defaultI18n.t(key as MessageId);
};

/** TV-only counterpart of the actual handheld Library module. Entry installs
 * this only after both canonical summary and the real TV keyboard are bound. */
export function createNativeTVLibraryModule(context: NativeShellBootstrapContext, bindings: NativeTVLibraryBindings): NativeRouteRenderer {
  const lifetime = nativeDestinationLifetime(context), common = nativeScreenServices(context), listeners = new Set<() => void>();
  let disposed = false, naming: NativeTVLibraryNaming | undefined;
  const emit = () => {for (const listener of [...listeners]) listener();};
  const closeNaming = () => {naming?.controller.dispose(); naming = undefined; emit();};
  const back = () => {
    const current = naming;
    current?.controller.close();
    if (current && !current.controller.getSnapshot().open && naming === current) closeNaming();
  };
  const store: NamingStore = {subscribe: listener => {listeners.add(listener); return () => {listeners.delete(listener);};}, getSnapshot: () => naming};
  const renderer = createNativeLibraryRenderer(context, {
    activation: libraryId => nativeDestinationActivation(context.navigation, {kind: 'library', libraryId}), labels: {field: label, sort: label, quick: label},
    actions: destination => {
      const activation = nativeDestinationActivation(context.navigation, {kind: 'library', libraryId: destination.getSnapshot().library.id});
      const actions = createNativeEntryActions(context, {
        current: () => !disposed && activation.getSnapshot().visible,
        contains: entry => {
          const source = destination.getSnapshot();
          return source.collection?.residentItems().includes(entry) === true || source.discover.appended.some(section => section.entries.includes(entry));
        },
        subscribe: listener => {
          let collection = destination.getSnapshot().collection, offCollection = collection?.subscribe(listener);
          const off = destination.subscribe(() => {
            const next = destination.getSnapshot().collection;
            if (next !== collection) {offCollection?.(); collection = next; offCollection = next?.subscribe(listener);}
            listener();
          });
          return () => {off(); offCollection?.();};
        },
      });
      return {...actions, saveView: (actual: NativeLibraryDestination, draft: NativeLibraryViewDraft) => {
        if (disposed || !lifetime.current() || !activation.getSnapshot().visible || actual !== destination || !nativeLibraryCanSave(actual.getSnapshot(), draft)) return;
        try {
          const definition = actual.captureSavedView(draft), capabilities = actual.getSnapshot().capabilities, revision = context.navigation.getSnapshot().revision;
          if (!capabilities) throw Object.assign(new Error('native_saved_view_capabilities_unavailable'), {code: 'invalid_response'});
          const suggestion = bindings.suggestName(definition, capabilities);
          const suggestedName = suggestion !== undefined && suggestion.length <= 200 ? suggestion : '';
          closeNaming();
          const controller = new NativeLibrarySaveView({api: context.api, scope: lifetime.scope, definition, requestId: common.requestId,
            current: () => !disposed && lifetime.current() && activation.getSnapshot().visible && context.navigation.getSnapshot().revision === revision,
            saved: () => closeNaming()});
          controller.setName(suggestedName);
          naming = Object.freeze({controller, definition, suggestedName}); emit();
        } catch (error) {if (!disposed && lifetime.current()) common.reportError(error, 'library');}
      }};
    },
  });
  const offRoute = context.navigation.subscribe(() => {if (naming && !naming.controller.getSnapshot().open) closeNaming();});
  return {render: renderer.render, renderOverlays: runtime => !disposed && lifetime.current() ? <NamingOutlet store={store} bindings={bindings} runtime={runtime} onBack={back}/> : null,
    dispose: () => {if (disposed) return; disposed = true; offRoute(); closeNaming(); renderer.dispose?.(); listeners.clear();}};
}

/** Registration has no default policy, empty-name fallback or phone sheet. */
export function registerNativeTVLibrary(bindings: NativeTVLibraryBindings, registry: NativeShellRouteRegistry = nativeShellRoutes) {
  return registry.registerDestination('library', context => createNativeTVLibraryModule(context, bindings));
}
