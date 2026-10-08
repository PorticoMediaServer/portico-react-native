import {useCallback, useEffect, useRef, useState} from 'react';
import {fetchHome, fetchHomeLayout, fetchHomeRow, appendHomeRowPage, resetHomeLayout, saveHomeLayout, type HomeDocument, type HomeLayout, type HomeLayoutView, type HomeRow} from '../../../../packages/client-core/src/home';
import {present} from './errors';
import {useSession} from './session';
import {useRefreshOnPlayback} from './playback-events';

/**
 * Home on the rows API: one document with every row the server composed for
 * this viewer (order and hidden set applied server-side), per-row paging by
 * cursor, and a layout the viewer can reorder or hide with a revision fence.
 */
export type HomeState = {
  phase: 'loading' | 'ready' | 'error';
  document?: HomeDocument;
  /** The last failure, for `present(error, 'home')`. Never render its message. */
  error?: unknown;
  /** Portico is retrying on its own (APL-HOME-01): show no Try again button. */
  retrying?: boolean;
  /** A refused row cursor is refreshing the whole document. */
  staleRefresh?: boolean;
  paging: ReadonlySet<string>;
};

/** APL-HOME-01: transient failures retry quickly first, then keep trying every 15 s. */
const QUICK_RETRY_MS = [1000, 3000, 8000];
const SLOW_RETRY_MS = 15000;
const transient = new Set(['offline', 'unreachable', 'timeout', 'busy']);

/**
 * PERF-19 / APL-SHELL-08: the last Home each viewer saw, so returning to Home paints at once
 * from memory while the document revalidates in the background.
 */
const lastHome = new Map<string, HomeDocument>();
const MAX_CACHED = 4;
function remember(key: string, document: HomeDocument) {
  lastHome.delete(key);
  lastHome.set(key, document);
  while (lastHome.size > MAX_CACHED) lastHome.delete(lastHome.keys().next().value!);
}

export function useHome() {
  const {api, session} = useSession();
  const cacheKey = `${session?.viewer.serverId ?? api.baseUrl}|${session?.viewer.accountId ?? ''}|${session?.viewer.profileId ?? ''}`;
  const [state, setState] = useState<HomeState>(() => {
    const cached = lastHome.get(cacheKey);
    return cached ? {phase: 'loading', document: cached, paging: new Set()} : {phase: 'loading', paging: new Set()};
  });
  const generation = useRef(0);
  const retryTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const load = useCallback(async (attempt = 0, stale = false) => {
    clearTimeout(retryTimer.current);
    const mine = ++generation.current;
    if (attempt === 0) setState(prev => ({...prev, phase: 'loading', error: undefined, retrying: false, staleRefresh: stale, paging: new Set()}));
    try {
      const document = await fetchHome(api);
      if (mine !== generation.current) return;
      remember(cacheKey, document);
      setState({phase: 'ready', document, paging: new Set()});
    } catch (e) {
      if (mine !== generation.current) return;
      const error = e;
      const p = present(error, 'home');
      if (p.silent) return;
      const retryable = transient.has(p.category);
      const quick = attempt < QUICK_RETRY_MS.length;
      if (retryable) retryTimer.current = setTimeout(() => void load(attempt + 1), quick ? QUICK_RETRY_MS[attempt] : SLOW_RETRY_MS);
      // During the quick retries keep the skeleton (or the cached rows) exactly as they are.
      if (retryable && quick) return;
      setState(prev => ({...prev, phase: 'error', error, retrying: retryable}));
    }
  }, [api, cacheKey]);
  useEffect(() => {
    void load();
    // Invalidate any request still in flight: `generation` is a counter, not a DOM node.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    return () => { clearTimeout(retryTimer.current); generation.current++; };
    // Keyed on the sign-in and profile, not the access token: the token rotates every few minutes
    // and Home must not reload each time it does.
  }, [load, session?.sessionFamilyId, session?.viewer.profileId]);
  const refresh = useCallback(() => load(0), [load]);
  // APL-HOME-03: Continue Watching and the hero follow what was just watched. The refresh keeps
  // the rows on screen (it never goes back to the skeleton).
  useRefreshOnPlayback(() => void load(0), change => change.reason !== 'progress');
  const more = useCallback(async (rowId: string) => {
    const document = state.document;
    const row = document?.rows.find(r => r.id === rowId);
    if (!row?.nextCursor || state.paging.has(rowId)) return;
    const mine = generation.current;
    setState(prev => ({...prev, paging: new Set(prev.paging).add(rowId)}));
    try {
      const page = await fetchHomeRow(api, rowId, {cursor: row.nextCursor});
      setState(prev => {
        // A replaced Home document bumps the generation (and its load resets paging). Within one
        // generation other rows' pages change the document object, so only this row's cursor is
        // compared: two shelves paging at once must both land.
        if (mine !== generation.current || !prev.document) return prev;
        const paging = new Set(prev.paging); paging.delete(rowId);
        if (prev.document.rows.find(r => r.id === rowId)?.nextCursor !== row.nextCursor) return {...prev, paging};
        const rows = prev.document.rows.map(r => (r.id === rowId ? appendHomeRowPage(r, page) : r));
        return {...prev, document: {...prev.document, rows}, paging};
      });
    } catch (e) {
      if (mine !== generation.current) return;
      setState(prev => { const paging = new Set(prev.paging); paging.delete(rowId); return {...prev, paging}; });
      if ((e as {code?: string})?.code === 'stale_continuation') void load(0, true);
    }
  }, [api, state.document, state.paging, load]);
  const saveLayout = useCallback(async (rowOrder: readonly string[], hiddenRowIds: readonly string[], expectedRevision?: number): Promise<HomeLayout> => {
    const current = state.document?.layout;
    const revision = expectedRevision ?? current?.revision;
    if (revision === undefined) throw new Error('Home is not loaded.');
    const layout = await saveHomeLayout(api, {expectedRevision: revision, rowOrder, hiddenRowIds, idempotencyKey: `${Date.now()}-${Math.random().toString(36).slice(2)}`});
    await load(0);
    return layout;
  }, [api, state.document, load]);
  const resetLayout = useCallback(async () => { await resetHomeLayout(api, `${Date.now()}-${Math.random().toString(36).slice(2)}`); await load(0); }, [api, load]);
  const loadLayout = useCallback(async (signal?: AbortSignal): Promise<HomeLayoutView> => fetchHomeLayout(api, signal), [api]);
  return {state, refresh, more, saveLayout, resetLayout, loadLayout};
}

export type {HomeRow};
