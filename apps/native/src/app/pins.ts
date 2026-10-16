import {useCallback, useEffect, useMemo, useRef, useState} from 'react';
import {dependsOn} from '../../../../packages/client-core/src/freshness-hub';
import {movedPin, readLibraryNavigation, readPinOrder, saveLibraryNavigation, savePinOrder, setResourcePin, withLibraryPinned, withPinRetry, type PinnedResource, type PinsApi} from '../../../../packages/client-core/src/library-pins';
import type {Library} from '../../../../packages/client-core/src/index';
import {useFreshness} from './freshness';
import {requestId} from './detail';

/**
 * Pins in navigation: the libraries a viewer pinned lead the rail and the library list in their
 * order, and pinned collections, saved views and playlists get a place of their own (the rail on
 * a television or a wide tablet, the top of Saved on a phone). The arrangement is the server's;
 * this reads it, sends a whole new arrangement with the revision it saw, and reads it again. A
 * change from another device met on the way is re-read and applied once more, silently.
 */
const listeners = new Set<() => void>();
/** Said by any screen that pins or unpins something, so every place pins are shown follows at once. */
export function announcePinsChanged(): void {
  for (const listener of [...listeners]) listener();
}

/** Hears every pin change made on this device; returns the way to stop. */
export function onPinsChanged(listener: () => void): () => void {
  listeners.add(listener);
  return () => { listeners.delete(listener); };
}

export type PinnedResourcesState = {order: readonly PinnedResource[]; revision: number; ready: boolean; reload: () => void};

/** The viewer's pinned collections, saved views and playlists, kept current while shown. */
export function usePinnedResources(api: PinsApi, serverId: string, sessionKey: string | undefined): PinnedResourcesState {
  const [state, setState] = useState<{order: readonly PinnedResource[]; revision: number; ready: boolean; key?: string}>({order: [], revision: 0, ready: false});
  const [tick, setTick] = useState(0);
  const reload = useCallback(() => setTick(n => n + 1), []);
  useEffect(() => {
    if (!sessionKey || !serverId) { setState({order: [], revision: 0, ready: false}); return; }
    const controller = new AbortController();
    readPinOrder(api, serverId, controller.signal)
      .then(read => setState({order: read.order, revision: read.revision, ready: true, key: sessionKey}))
      // A failed read keeps what is shown; navigation never empties for a moment's trouble.
      .catch(() => setState(current => (current.key === sessionKey ? current : {order: [], revision: 0, ready: true, key: sessionKey})));
    return () => controller.abort();
  }, [api, serverId, sessionKey, tick]);
  useEffect(() => {
    listeners.add(reload);
    return () => { listeners.delete(reload); };
  }, [reload]);
  // A pin made on another device arrives with this profile's other personal changes.
  const {hub} = useFreshness();
  useEffect(() => hub.watch([dependsOn.personal()], reload), [hub, reload]);
  return useMemo(() => ({order: state.order, revision: state.revision, ready: state.ready, reload}), [state, reload]);
}

/** The changes the pin editor and the pages make. Each resolves once the server has it. */
export function usePinActions(api: PinsApi, serverId: string) {
  const latest = useRef({api, serverId});
  latest.current = {api, serverId};
  return useMemo(() => ({
    /** Pins or unpins one library; a newly pinned one goes last among the pinned. */
    pinLibrary: async (libraryId: string, pin: boolean) => {
      const {api} = latest.current;
      await withPinRetry(() => readLibraryNavigation(api), navigation => saveLibraryNavigation(api, navigation.revision, withLibraryPinned(navigation.pinnedLibraryIds, libraryId, pin)));
      announcePinsChanged();
    },
    /** Moves a pinned library up or down among the pinned. */
    moveLibrary: async (libraryId: string, by: number) => {
      const {api} = latest.current;
      await withPinRetry(() => readLibraryNavigation(api), navigation => saveLibraryNavigation(api, navigation.revision, movedPin(navigation.pinnedLibraryIds, navigation.pinnedLibraryIds.indexOf(libraryId), by)));
      announcePinsChanged();
    },
    /** Moves a pinned collection, saved view or playlist up or down. */
    moveResource: async (entry: PinnedResource, by: number) => {
      const {api, serverId} = latest.current;
      await withPinRetry(() => readPinOrder(api, serverId), read => {
        const at = read.order.findIndex(other => other.kind === entry.kind && other.id === entry.id);
        return savePinOrder(api, serverId, read.revision, movedPin(read.order, at, by));
      });
      announcePinsChanged();
    },
    /** Unpins a collection, saved view or playlist from wherever its pin is shown. */
    unpinResource: async (entry: PinnedResource) => {
      const {api, serverId} = latest.current;
      await withPinRetry(() => readPinOrder(api, serverId).then(read => read.order.find(other => other.kind === entry.kind && other.id === entry.id) ?? entry), async fresh => setResourcePin(api, fresh.kind, fresh.id, false, fresh.pinRevision, await requestId()), entry);
      announcePinsChanged();
    },
  }), []);
}

/** The icon a pinned collection, saved view or playlist is drawn with. */
export const pinnedResourceIcon = (kind: PinnedResource['kind']): 'queue' | 'filter' | 'collection' => (kind === 'playlist' ? 'queue' : kind === 'view' ? 'filter' : 'collection');

/** The pinned libraries of a listing (the server lists them first, in the viewer's order). */
export function pinnedLibraryIds(libraries: readonly Library[]): readonly string[] {
  return libraries.filter(library => library.pinned === true).map(library => library.id);
}
