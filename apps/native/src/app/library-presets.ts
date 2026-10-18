import {useEffect, useMemo, useRef, useSyncExternalStore} from 'react';
import {PersonalSavedService, UNCONFIRMED, savedChange, type PersonalResource, type SavedDefinition} from '../../../../packages/client-core/src/personal-saved';
import type {SavedApi, SavedScope} from '../../../../packages/client-core/src/saved';

/**
 * A library's presets: the saved views this profile keeps for the library (and its pivot), read
 * from the server's scoped list, so they follow the profile to every device. One service per
 * viewer, library and pivot: another profile, server or library reads its own, and a late answer
 * for the one before never shows. Listing reads no view's content, a page at a time. A change with
 * no answer is unconfirmed (`unconfirmed`): it is offered again as it was sent, never replaced by
 * another, until it is confirmed or set aside (`discard`).
 */
export function useLibraryPresets({api, scope, requestId, libraryId, pivot, enabled}: {api: SavedApi; scope: SavedScope; requestId: () => Promise<string>; libraryId: string; pivot: string | undefined; enabled: boolean}) {
  // One service per viewer, library and pivot (never per render): the effect below selects it and disposes of it.
  const ids = useRef(requestId);
  ids.current = requestId;
  const service = useMemo(() => (enabled && pivot && libraryId ? new PersonalSavedService(api, scope, () => ids.current()) : null), [api, scope, enabled, pivot, libraryId]);
  useEffect(() => {
    if (!service || !pivot) return;
    void service.select({view: 'views', libraryId, pivot});
    return () => service.dispose();
  }, [service, libraryId, pivot]);
  const snapshot = useSyncExternalStore(service?.subscribe ?? noSubscribe, () => service?.getSnapshot() ?? null);
  const unconfirmed = snapshot && service ? service.unconfirmed() : undefined;
  return {
    service, snapshot, unconfirmed,
    /** Saves the current filters and sort as a new view: a refusal (a taken name, a conflict) is thrown, never taken for success. */
    save: (name: string, definition: SavedDefinition) => (service ? savedChange(service, {action: 'create', kind: 'view', name, definition}) : Promise.reject(new Error(''))),
    rename: (row: PersonalResource, name: string) => (service ? savedChange(service, {action: 'update', name}, row) : Promise.resolve()),
    remove: (row: PersonalResource) => (service ? savedChange(service, {action: 'delete'}, row) : Promise.resolve()),
    /** Reads the list again quietly, the pages shown included (the picker opened, another device saved one); never over a change on its way. */
    refresh: (context?: Parameters<PersonalSavedService['revalidate']>[0]) => service?.revalidate(context).catch(() => undefined) ?? Promise.resolve(),
    /** Sets an unconfirmed change aside (it may still have been made; the list is read again). */
    discard: () => { if (!service) return; service.dismiss(); void service.refresh(); },
  };
}
const noSubscribe = () => () => {};
export type LibraryPresets = ReturnType<typeof useLibraryPresets>;
export const isUnconfirmed = (e: unknown) => (e as {code?: string} | null)?.code === UNCONFIRMED;
