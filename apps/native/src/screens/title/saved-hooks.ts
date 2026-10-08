import {useCallback, useEffect, useMemo, useRef, useState} from 'react';
import {PersonalSavedService, type PersonalSavedSnapshot} from '../../../../../packages/client-core/src/personal-saved';
import {SavedService, type SavedIntent, type SavedRoute, type SavedSnapshot} from '../../../../../packages/client-core/src/saved';
import {viewerScope} from '../../app/content';
import {requestId} from '../../app/detail';
import {useSession} from '../../app/session';

/** One playlist (SavedService `{view: 'playlist'}`) bound to React. */
export function usePlaylist(playlistId: string) {
  const {api, session} = useSession();
  const scope = useMemo(() => viewerScope(session, api), [session, api]);
  const service = useMemo(() => new SavedService({api, scope, requestId}), [api, scope]);
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
