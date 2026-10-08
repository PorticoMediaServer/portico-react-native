import {useCallback, useEffect, useMemo, useRef, useState} from 'react';
import {NativeModules} from 'react-native';
import {DetailService, type DetailSnapshot, type DetailTarget, type PersonalIntent} from '../../../../packages/client-core/src/detail';
import {fetchItemRecommendations, fetchShowRecommendations, type ItemRecommendations, type ShowRecommendations} from '../../../../packages/client-core/src/recommendations';
import {ShowWorkspaceService, type ShowWorkspaceRoute, type ShowWorkspaceSnapshot} from '../../../../packages/client-core/src/show-workspace';
import {viewerScope} from './content';
import {compatContentApi} from '../../../../packages/client-core/src/presentation/index';
import {useSession} from './session';

export const requestId = () => Promise.resolve(NativeModules.PorticoRuntime.newRequestId() as Promise<string> | string).then(v => String(v).toLowerCase());

/** One media item's detail projection plus personal-state mutations. */
export function useDetail(target: DetailTarget | null) {
  const {api, session} = useSession();
  const scope = useMemo(() => viewerScope(session, api), [session, api]);
  const service = useMemo(() => new DetailService({api, scope, requestId}), [api, scope]);
  const [snapshot, setSnapshot] = useState<DetailSnapshot>(service.getSnapshot());
  useEffect(() => {
    setSnapshot(service.getSnapshot());
    const unsubscribe = service.subscribe(() => setSnapshot(service.getSnapshot()));
    return () => {
      unsubscribe();
      service.dispose();
    };
  }, [service]);
  const key = target ? target.libraryId + '/' + target.itemId : '';
  const last = useRef<{key: string; service: unknown}>({key: '', service: null});
  useEffect(() => {
    if (!target || (last.current.key === key && last.current.service === service)) return;
    last.current = {key, service};
    void service.select(target).catch(() => {});
  }, [service, key, target]);
  const mutate = useCallback((intent: PersonalIntent) => void service.mutate(intent).catch(() => {}), [service]);
  const retry = useCallback(() => void service.retryRead().catch(() => {}), [service]);
  const refresh = useCallback(() => void service.refresh().catch(() => {}), [service]);
  const retryMutation = useCallback(() => void service.retryMutation().catch(() => {}), [service]);
  const dismissMutation = useCallback(() => service.dismissMutation(), [service]);
  return {snapshot, mutate, retry, refresh, retryMutation, dismissMutation};
}

/** A show workspace: show identity, seasons, and the selected season's episodes. */
export function useShowWorkspace(route: ShowWorkspaceRoute | null) {
  const {api, session} = useSession();
  const scope = useMemo(() => viewerScope(session, api), [session, api]);
  const service = useMemo(() => new ShowWorkspaceService({api: compatContentApi(api), scope}), [api, scope]);
  const [snapshot, setSnapshot] = useState<ShowWorkspaceSnapshot>(service.getSnapshot());
  useEffect(() => {
    setSnapshot(service.getSnapshot());
    const unsubscribe = service.subscribe(() => setSnapshot(service.getSnapshot()));
    return () => {
      unsubscribe();
      service.dispose();
    };
  }, [service]);
  const key = route ? JSON.stringify(route) : '';
  const last = useRef<{key: string; service: unknown}>({key: '', service: null});
  useEffect(() => {
    if (!route || (last.current.key === key && last.current.service === service)) return;
    last.current = {key, service};
    void service.select(route).catch(() => {});
  }, [service, key, route]);
  const selectSeason = useCallback((id: string) => void service.selectSeason(id).catch(() => {}), [service]);
  const selectGroup = useCallback((group: string) => void service.selectGroup(group).catch(() => {}), [service]);
  const next = useCallback(() => void service.nextEpisodes().catch(() => {}), [service]);
  const retry = useCallback(() => void service.retry().catch(() => {}), [service]);
  return {snapshot, selectSeason, selectGroup, next, retry};
}

/** Movie and show recommendation reads keep empty, loading and failed results distinct. */
/** `limit` on the recommendations route is entries per row, not rows. */
const MORE_LIKE_THIS_ENTRIES = 12;

type RecommendationState<T> = {phase: 'loading' | 'ready' | 'error' | 'empty'; data: T | null; error?: unknown; retry: () => void};

function useRecommendationRead<T>(key: string | undefined, read: (signal: AbortSignal) => Promise<T>): RecommendationState<T> {
  const [attempt, setAttempt] = useState(0);
  const [state, setState] = useState<{key?: string; phase: RecommendationState<T>['phase']; data: T | null; error?: unknown}>({phase: 'empty', data: null});
  useEffect(() => {
    if (!key) { setState({phase: 'empty', data: null}); return; }
    const controller = new AbortController();
    setState({key, phase: 'loading', data: null});
    read(controller.signal).then(data => {
      if (!controller.signal.aborted) setState({key, phase: (data as {rows?: readonly unknown[]}).rows?.length ? 'ready' : 'empty', data});
    }, error => {
      if (!controller.signal.aborted) setState({key, phase: 'error', data: null, error});
    });
    return () => controller.abort();
  }, [key, read, attempt]);
  return {...(state.key === key ? state : {phase: key ? 'loading' as const : 'empty' as const, data: null}), retry: () => setAttempt(n => n + 1)};
}

/** P4/P7: a show's rows, including a retryable failure. */
export function useShowRecommendations(showId: string | undefined): RecommendationState<ShowRecommendations> {
  const {api} = useSession();
  const read = useCallback((signal: AbortSignal) => fetchShowRecommendations(api, showId!, MORE_LIKE_THIS_ENTRIES, signal), [api, showId]);
  return useRecommendationRead(showId, read);
}

export function useItemRecommendations(target: {libraryId: string; itemId: string; kind?: string} | null): RecommendationState<ItemRecommendations> {
  const {api} = useSession();
  const itemId = target?.kind === 'movie' ? target.itemId : undefined;
  const libraryId = target?.kind === 'movie' ? target.libraryId : undefined;
  const read = useCallback((signal: AbortSignal) => fetchItemRecommendations(api, itemId!, MORE_LIKE_THIS_ENTRIES, signal), [api, itemId]);
  return useRecommendationRead(itemId && libraryId ? `${libraryId}/${itemId}` : undefined, read);
}
