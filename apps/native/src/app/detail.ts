import {useCallback, useEffect, useMemo, useRef, useState} from 'react';
import {NativeModules} from 'react-native';
import {DetailService, type DetailSnapshot, type DetailTarget, type PersonalIntent} from '../../../../packages/client-core/src/detail';
import {fetchItemRecommendations, fetchShowRecommendations, type ItemRecommendations, type ShowRecommendations} from '../../../../packages/client-core/src/recommendations';
import {ShowWorkspaceService, type ShowWorkspaceRoute, type ShowWorkspaceSnapshot} from '../../../../packages/client-core/src/show-workspace';
import {viewerScope} from './content';
import {compatContentApi} from '../../../../packages/client-core/src/presentation/index';
import {useSession} from './session';
import {usePooledService} from './freshness';
import {titleWithPersonalState, titlesWithPersonalState} from '../../../../packages/client-core/src/freshness-hub';

export const requestId = () => Promise.resolve(NativeModules.PorticoRuntime.newRequestId() as Promise<string> | string).then(v => String(v).toLowerCase());

/** One media item's detail projection plus personal-state mutations. */
export function useDetail(target: DetailTarget | null) {
  const {api, session} = useSession();
  const scope = useMemo(() => viewerScope(session, api), [session, api]);
  const key = target ? target.libraryId + '/' + target.itemId : '';
  // The title's page is kept for the signed-in viewer: opened again it shows at once, and it is
  // read again in place only when its library or this profile's state moved.
  const {service, snapshot, document, memo} = usePooledService<DetailService, DetailSnapshot>(
    'detail:' + key,
    () => new DetailService({api, scope, requestId}),
    // This title's own state (or anything under it), not every title of its library.
    target ? titleWithPersonalState(target.libraryId, [target.itemId]) : [],
  );
  useEffect(() => {
    if (!target || memo.selected) return;
    memo.selected = true;
    document.markCurrent();
    void service.select(target).catch(() => {});
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [service, key]);
  const mutate = useCallback((intent: PersonalIntent) => void service.mutate(intent).catch(() => {}), [service]);
  const retry = useCallback(() => void service.retryRead().catch(() => {}), [service]);
  const refresh = useCallback(() => { document.markCurrent(); void service.refresh().catch(() => {}); }, [service, document]);
  const retryMutation = useCallback(() => void service.retryMutation().catch(() => {}), [service]);
  const dismissMutation = useCallback(() => service.dismissMutation(), [service]);
  return {snapshot, mutate, retry, refresh, retryMutation, dismissMutation};
}

/** A show workspace: show identity, seasons, and the selected season's episodes. */
export function useShowWorkspace(route: ShowWorkspaceRoute | null) {
  const {api, session} = useSession();
  const scope = useMemo(() => viewerScope(session, api), [session, api]);
  const key = route ? JSON.stringify(route) : '';
  // Kept per address (show, season, episode): opened again it returns to the season the person left.
  const {service, snapshot, document, memo} = usePooledService<ShowWorkspaceService, ShowWorkspaceSnapshot>(
    'show:' + key,
    () => new ShowWorkspaceService({api: compatContentApi(api), scope}),
    route ? (route.showId ? titleWithPersonalState(route.libraryId, [route.showId]) : titlesWithPersonalState(route.libraryId)) : [],
  );
  useEffect(() => {
    if (!route || memo.selected) return;
    memo.selected = true;
    document.markCurrent();
    void service.select(route).catch(() => {});
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [service, key]);
  const selectSeason = useCallback((id: string) => { document.markCurrent(); void service.selectSeason(id).catch(() => {}); }, [service, document]);
  const selectGroup = useCallback((group: string) => { document.markCurrent(); void service.selectGroup(group).catch(() => {}); }, [service, document]);
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
