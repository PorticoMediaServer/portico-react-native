import {useCallback, useEffect, useMemo} from 'react';
import {type HomeDocument, type HomeLayout, type HomeLayoutView, type HomeRow} from '../../../../packages/client-core/src/home';
import {HomeService, type HomeSnapshot} from '../../../../packages/client-core/src/home-service';
import {dependsOn, titlesWithPersonalState} from '../../../../packages/client-core/src/freshness-hub';
import {serviceDocument} from '../../../../packages/client-core/src/freshness-pool';
import {present} from './errors';
import {useSession} from './session';
import {usePooled, useRecovering} from './freshness';
import {useRefreshOnPlayback} from './playback-events';

/**
 * Home on the rows API: one document with every row the server composed for
 * this viewer (order and hidden set applied server-side), per-row paging by
 * cursor, and a layout the viewer can reorder or hide with a revision fence.
 *
 * The document is client-core's `HomeService`, kept for the signed-in viewer: coming back to
 * Home shows it at once, and it is read again in the background only when a library, the list of
 * libraries, or this profile's watched state or positions moved, and only while Home is in
 * front. What changed is merged into the rows on screen: a row that did not change is the same
 * object, so its cards keep their focus and the shelf keeps its scroll position.
 */
export type HomeState = {
  phase: 'loading' | 'ready' | 'error';
  document?: HomeDocument;
  /** The last failure, for `present(error, 'home')`. Never render its message. */
  error?: unknown;
  /** Portico is retrying on its own (APL-HOME-01): show no Try again button. */
  retrying?: boolean;
  /** Kept for the screen's layout; a refused row cursor is now handled in place and never sets it. */
  staleRefresh?: boolean;
  paging: ReadonlySet<string>;
};

const transient = new Set(['offline', 'unreachable', 'timeout', 'busy', 'rate-limited']);
/** Everything Home is built from: every library's titles and order, the list of libraries, and this profile's state. */
// Trending and Popular move with the server, not this profile: their own hint.
const homeDependencies = Object.freeze([dependsOn.libraries, dependsOn.list('recommendations'), ...titlesWithPersonalState()]);
const operationKey = () => `${Date.now()}-${Math.random().toString(36).slice(2)}`;

export function useHome() {
  const {api} = useSession();
  const {service, snapshot, document, memo} = usePooled<HomeService, HomeSnapshot>('home', () => serviceDocument(new HomeService(api), homeDependencies));
  useEffect(() => {
    if (memo.selected) return;
    memo.selected = true;
    document.markCurrent();
    void service.load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [service]);
  /** The pull to refresh: one read, shared with any already running; the rows stay on screen. */
  const refresh = useCallback(() => { document.markCurrent(); return service.load(); }, [service, document]);
  // APL-HOME-03: Continue Watching and the hero follow what was just watched on this device. The
  // rows are brought up to date in place when Home is next in front (the player covers it now).
  useRefreshOnPlayback(() => document.invalidate(), change => change.reason !== 'progress');
  const more = useCallback((rowId: string) => service.more(rowId), [service]);
  const saveLayout = useCallback((rowOrder: readonly string[], hiddenRowIds: readonly string[], expectedRevision?: number): Promise<HomeLayout> => service.saveLayout(rowOrder, hiddenRowIds, operationKey, expectedRevision), [service]);
  const resetLayout = useCallback(() => service.resetLayout(operationKey), [service]);
  const loadLayout = useCallback((signal?: AbortSignal): Promise<HomeLayoutView> => service.loadLayout(signal), [service]);
  // A first load that failed is tried again by itself: for its first moments Home goes on showing
  // that it is loading, and after that the error says Portico is still trying.
  const recovering = useRecovering(document);
  const docState = document.getState();
  const state = useMemo<HomeState>(() => {
    const quiet = recovering && snapshot.phase === 'error' && !snapshot.document;
    const retrying = snapshot.phase === 'error' && (docState.stale || docState.revalidating) && transient.has(present(snapshot.error, 'home').category);
    return {phase: snapshot.phase === 'idle' || quiet ? 'loading' : snapshot.phase, document: snapshot.document, error: quiet ? undefined : snapshot.error, retrying, paging: snapshot.paging};
  }, [snapshot, recovering, docState]);
  return {state, refresh, more, saveLayout, resetLayout, loadLayout};
}

export type {HomeRow};
