import {useCallback, useEffect, useMemo, useRef, useState} from 'react';
import {useFreshDocument} from '../../app/freshness';
import {titlesWithPersonalState} from '../../../../../packages/client-core/src/freshness-hub';
import {PersonalSavedService, type PersonalSavedSnapshot} from '../../../../../packages/client-core/src/personal-saved';
import {SavedService, type SavedIntent, type SavedRoute, type SavedSnapshot} from '../../../../../packages/client-core/src/saved';
import {viewerScope} from '../../app/content';
import {requestId} from '../../app/detail';
import {useSession} from '../../app/session';
import type {ContentEntry} from '../../../../../packages/client-core/src/library-content';
import {gatherView, type GatheredView} from '../../app/view-play';

const listDependencies = Object.freeze([...titlesWithPersonalState()]);

/** One playlist (SavedService `{view: 'playlist'}`) bound to React. */
export function usePlaylist(playlistId: string) {
  const {api, session} = useSession();
  const scope = useMemo(() => viewerScope(session, api), [session, api]);
  const service = useMemo(() => new SavedService({api, scope, requestId}), [api, scope]);
  // The list on screen follows this profile's saved titles and watched state, and the libraries behind them, in place.
  useFreshDocument(listDependencies, context => service.revalidate(context), () => service.getSnapshot().phase === 'ready');
  const [snapshot, setSnapshot] = useState<SavedSnapshot>(service.getSnapshot());
  useEffect(() => {
    setSnapshot(service.getSnapshot());
    const unsubscribe = service.subscribe(() => setSnapshot(service.getSnapshot()));
    return () => {
      unsubscribe();
      service.dispose();
    };
  }, [service]);
  const last = useRef<{id: string; service: unknown}>({id: '', service: null});
  useEffect(() => {
    if (last.current.id === playlistId && last.current.service === service) return;
    last.current = {id: playlistId, service};
    const route: SavedRoute = {view: 'playlist', playlistId};
    Promise.resolve().then(() => service.select(route)).catch(() => {});
  }, [service, playlistId]);
  const refresh = useCallback(() => void service.refresh().catch(() => {}), [service]);
  const retry = useCallback(() => void service.retry().catch(() => {}), [service]);
  const next = useCallback((sectionId: string) => void service.next(sectionId).catch(() => {}), [service]);
  const previous = useCallback(() => void service.previous().catch(() => {}), [service]);
  // M32: playlist management (reorder, remove) goes through the service's
  // intents, mirroring the web saved screen.
  const mutate = useCallback((intent: SavedIntent) => service.mutate(intent), [service]);
  const loadOrder = useCallback(() => service.loadOrder(), [service]);
  return {snapshot, refresh, retry, next, previous, mutate, loadOrder};
}

/** One personal collection or saved view (PersonalSavedService `{view: 'resource'}`) bound to React. */
export function useSavedResource(resourceId: string) {
  const {api, session} = useSession();
  const scope = useMemo(() => viewerScope(session, api), [session, api]);
  const service = useMemo(() => new PersonalSavedService(api, scope, requestId), [api, scope]);
  useFreshDocument(listDependencies, context => service.revalidate(context), () => !!service.getSnapshot().viewerFence);
  const [snapshot, setSnapshot] = useState<PersonalSavedSnapshot>(service.getSnapshot());
  useEffect(() => {
    setSnapshot(service.getSnapshot());
    const unsubscribe = service.subscribe(() => setSnapshot(service.getSnapshot()));
    return () => {
      unsubscribe();
      service.dispose();
    };
  }, [service]);
  const last = useRef<{id: string; service: unknown}>({id: '', service: null});
  useEffect(() => {
    if (last.current.id === resourceId && last.current.service === service) return;
    last.current = {id: resourceId, service};
    const route: SavedRoute = {view: 'resource', resourceId};
    Promise.resolve().then(() => service.select(route)).catch(() => {});
  }, [service, resourceId]);
  const refresh = useCallback(() => void service.refresh().catch(() => {}), [service]);
  const next = useCallback(() => void service.next().catch(() => {}), [service]);
  const previous = useCallback(() => void service.previous().catch(() => {}), [service]);
  return {snapshot, refresh, next, previous};
}

/**
 * Reads the rest of a saved view so Play and Shuffle cover the view rather than the pages on
 * screen (`gatherView`). The pages are read by a service of their own, so the screen's list is
 * not disturbed; leaving the screen, or asking again, cancels a read in flight.
 */
export function useGatherView(resourceId: string) {
  const {api, session} = useSession();
  const scope = useMemo(() => viewerScope(session, api), [session, api]);
  const active = useRef<AbortController | null>(null);
  useEffect(() => () => active.current?.abort(), []);
  return useCallback(async (loaded: readonly ContentEntry[], nextCursor: string): Promise<GatheredView<ContentEntry>> => {
    active.current?.abort();
    const controller = new AbortController();
    active.current = controller;
    const reader = new PersonalSavedService(api, scope, requestId);
    try {
      return await gatherView(loaded, nextCursor, async cursor => {
        await reader.select({view: 'resource', resourceId}, {cursor});
        const page = reader.getSnapshot();
        if (page.error) throw page.error;
        return {entries: page.entries.flatMap(e => (e.media ? [e.media] : [])), nextCursor: page.nextCursor};
      }, {keyOf: e => e.id, playable: e => !!e.playback, signal: controller.signal});
    } finally {
      reader.dispose();
      if (active.current === controller) active.current = null;
    }
  }, [api, scope, resourceId]);
}
