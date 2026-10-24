import {BrowseSelectionModel, browseSelectionKey, playCatalogueSelection, readCatalogueSelectionItem, type BrowseSelectionContext, type SelectionItem, type SelectionOperation} from '../../../../../packages/client-core/src/selection-model';
import type {ContentEntry} from '../../../../../packages/client-core/src/library-content';
import type {NativeShellBootstrapContext} from '../../shell/bootstrap';
import {nativeDestinationActivation} from '../../shell/routes';
import {nativeDestinationLifetime} from '../destinations/lifetime';
import {nativeScreenServices} from '../native-screen-services';
import type {NativeLibraryDestination} from './model';

const cancelled = () => Object.assign(new Error('native_library_selection_retired'), {name: 'AbortError', code: 'cancelled'});
const unavailable = () => Object.assign(new Error('native_library_selection_unavailable'), {code: 'unavailable'});

/** One captured applied Browse query, not a Home context. Recreate after a
 * query/token change. Only leaf Play is installed: other grants/executors and
 * whole-query expansion are deliberately absent from this binding. */
export function createNativeLibraryPlaySelection(context: NativeShellBootstrapContext, source: NativeLibraryDestination) {
  const lifetime = nativeDestinationLifetime(context), opening = source.getSnapshot(), viewer = context.session()!.viewer;
  if (opening.phase !== 'ready' || !opening.revision || !opening.collection || !opening.sort) throw unavailable();
  const definition = source.captureSavedView({predicates: opening.predicates, sort: opening.sort});
  const captured: BrowseSelectionContext = Object.freeze({
    scope: Object.freeze({serverId: viewer.serverId, authority: viewer.authority, accountId: viewer.accountId, profileId: viewer.profileId,
      viewId: JSON.stringify(['native-library', definition.libraryId, definition.pivot, definition.query, definition.sort])}),
    revision: Object.freeze({pageRevision: opening.revision}),
  });
  const model = new BrowseSelectionModel(captured), player = context.playback.runtime.cataloguePlayback();
  const common = nativeScreenServices(context), activation = nativeDestinationActivation(context.navigation, {kind: 'library', libraryId: opening.library.id});
  const collection = opening.collection, cleanups: (() => void)[] = [];
  const windows = new Map<string, () => void>();
  const operations = new Map<AbortController, SelectionOperation<BrowseSelectionContext>>();
  let disposed = false, reading: AbortController | undefined;
  const current = () => {
    const next = source.getSnapshot();
    return !disposed && lifetime.current() && next.phase === 'ready' && next.collection === collection
      && next.queryRevision === opening.queryRevision && next.revision === opening.revision && next.tab === opening.tab;
  };
  const abortPending = () => {reading?.abort(); reading = undefined; for (const controller of operations.keys()) controller.abort();};
  const dispose = () => {
    if (disposed) return;
    disposed = true; abortPending(); cleanups.splice(0).forEach(stop => stop());
    for (const stop of [...windows.values()]) stop();
    windows.clear(); model.dispose();
  };
  cleanups.push(source.subscribe(() => {if (!current()) dispose();}), context.subscribeAuthority(() => {if (!current()) dispose();}),
    context.navigation.subscribe(abortPending), model.subscribe(() => {
      for (const [controller, operation] of operations) if (!model.isOperationCurrent(operation)) controller.abort();
    }));

  return Object.freeze({model,
    /** A real contiguous loaded range, at its actual absolute positions.
     * At most four Detail reads and one window preparation are in flight. */
    prepareWindow: async (id: string, start: number, input: readonly ContentEntry[]) => {
      if (!current() || !activation.getSnapshot().visible) throw cancelled();
      if (!Number.isSafeInteger(start) || start < 0 || !input.length || input.length > 60) throw unavailable();
      const entries = Object.freeze([...input]);
      const member = () => entries.every((entry, offset) => collection.itemAt(start + offset) === entry && source.contains(entry));
      if (!member()) throw cancelled();
      windows.get(id)?.();
      if (!windows.has(id) && windows.size >= 32) throw unavailable();
      reading?.abort(); const controller = new AbortController(); reading = controller;
      const ticket = model.captureContext(), revision = context.navigation.getSnapshot().revision;
      const live = () => !controller.signal.aborted && current() && activation.getSnapshot().visible
        && context.navigation.getSnapshot().revision === revision && model.isContextCurrent(ticket) && member();
      const check = () => {if (!live()) controller.abort();};
      const stops = [...new Set(entries.map((_, offset) => collection.pageOf(start + offset)))].map(page => collection.subscribePage(page, check));
      let registered = false, unregister: (() => void) | undefined;
      const cleanup = () => {
        controller.abort(); unregister?.(); stops.splice(0).forEach(stop => stop());
        if (windows.get(id) === cleanup) windows.delete(id);
      };
      try {
        const items: SelectionItem[] = new Array(entries.length); let cursor = 0;
        await Promise.all(Array.from({length: Math.min(4, entries.length)}, async () => {
          while (cursor < entries.length) {
            const index = cursor++;
            items[index] = await readCatalogueSelectionItem({api: context.api, scope: lifetime.scope, requestId: common.requestId,
              signal: controller.signal, isCurrent: live}, entries[index], {play: true});
          }
        }));
        if (!live()) throw cancelled();
        const result = model.registerWindow(ticket, {id, sectionId: 'library-browse', sectionOrder: 0, start, items});
        if (!result.ok) throw cancelled();
        unregister = result.unregister; registered = true;
        // Once registered, native page eviction unregisters its window while
        // the shared model preserves explicit picks at this same source token.
        stops.splice(0).forEach(stop => stop());
        stops.push(...[...new Set(entries.map((_, offset) => collection.pageOf(start + offset)))].map(page => collection.subscribePage(page, () => {
          if (!current() || !member()) cleanup();
        })));
        windows.set(id, cleanup);
        const keys = new Map(entries.map((entry, index) => [entry, browseSelectionKey(captured.scope, items[index])]));
        return Object.freeze({
          toggle: (entry: ContentEntry, range = false) => {
            const key = keys.get(entry);
            if (!current() || !activation.getSnapshot().visible || !member() || !key || windows.get(id) !== cleanup) throw cancelled();
            return model.toggle(id, key, range);
          },
          dispose: cleanup,
        });
      } catch (error) {cleanup(); throw error;}
      finally {if (reading === controller) reading = undefined; if (!registered) cleanup();}
    },
    play: async () => {
      if (!current() || !activation.getSnapshot().visible) throw cancelled();
      const operation = model.captureOperation();
      if (!operation || operation.target.mode !== 'explicit') throw unavailable();
      const controller = new AbortController(), revision = context.navigation.getSnapshot().revision;
      const isCurrent = () => !controller.signal.aborted && current() && activation.getSnapshot().visible
        && context.navigation.getSnapshot().revision === revision && model.isOperationCurrent(operation);
      operations.set(controller, operation);
      try {return await playCatalogueSelection(player, operation.target.displayItems.map(value => value.item), {signal: controller.signal, isCurrent});}
      finally {operations.delete(controller);}
    },
    dispose,
  });
}
