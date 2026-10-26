import {readReadingIndexedSearch, validReadingIndexedSearchQuery, type ReadingIndexedSearchHit} from '../../../../../packages/client-core/src/reading-indexed-search';
import type {NativeShellBootstrapContext} from '../../shell/bootstrap';
import type {NativeShellRoute} from '../../shell/routes';
import {nativeReadOrigin, openNativeRead} from '../read/eligibility';

type SearchRoute = Extract<NativeShellRoute, {kind: 'search-reading'}>;

/** One bounded, explicit book-text search. The words are the person's own literal
 * text: nothing here trims, folds, lowercases, expands or rewrites them before the
 * canonical validator and the official `/v1/reading/search` request see them. */
export type NativeReadingSearchState = Readonly<{
  /** The exact words the drawn page belongs to; '' until the first search starts. */
  query: string;
  phase: 'idle' | 'loading' | 'ready' | 'more' | 'error' | 'stale';
  hits: readonly ReadingIndexedSearchHit[];
  hasNext: boolean;
  error?: unknown;
  /** True while one admitted hit is opening the reader for its exact source. */
  opening: boolean;
}>;

export type NativeReadingSearchPort = Readonly<{
  subscribe: (listener: () => void) => () => void;
  getSnapshot: () => NativeReadingSearchState;
  /** Runs the route's carried words once, after the screen is actually visible. */
  seed: () => void;
  search: (text: string) => void;
  more: () => void;
  /** Opens the hit's exact item, source and revision; the caller reports a throw. */
  open: (hit: ReadingIndexedSearchHit) => Promise<void>;
  dispose: () => void;
}>;

/** The server's own page size is the only continuation bound we ask for. */
const PAGE = 20;

const EMPTY: NativeReadingSearchState = Object.freeze({query: '', phase: 'idle', hits: Object.freeze([]), hasNext: false, opening: false});

/** Root54 native surface. It owns one route-local request lifetime, the last page's
 * cursor and the index revision those results came from. It never merges pages from
 * another query or index revision, never keeps a total count, and retires both the
 * results and the continuation when the published index moves under them. */
export function createNativeReadingSearch(context: NativeShellBootstrapContext, route: SearchRoute): NativeReadingSearchPort {
  const captured = context.session();
  if (!captured) throw new Error('native_reading_search_authority_required');
  const family = captured.sessionFamilyId;
  const listeners = new Set<() => void>();
  let alive = true, state = EMPTY, sequence = 0, inflight: AbortController | undefined;
  let cursor: string | undefined, indexRevision: number | undefined;
  const live = (): boolean => {
    if (!alive || !context.current()) return false;
    const session = context.session();
    if (!session || session.sessionFamilyId !== family) return false;
    const snapshot = context.navigation.getSnapshot();
    return snapshot.route === route || context.navigation.retainedRoutes().includes(route);
  };
  const publish = (next: NativeReadingSearchState): void => {
    if (!alive) return;
    state = Object.freeze(next);
    for (const listener of [...listeners]) listener();
  };
  const cancel = (): void => {inflight?.abort(); inflight = undefined;};
  const run = (query: string, follow: string | undefined): void => {
    cancel();
    const ticket = ++sequence, request = new AbortController();
    const isCurrent = () => live() && ticket === sequence && !request.signal.aborted;
    inflight = request;
    if (follow === undefined) {
      cursor = undefined; indexRevision = undefined;
      publish({query, phase: 'loading', hits: Object.freeze([]), hasNext: false, opening: state.opening});
    } else publish({...state, query, phase: 'more', error: undefined});
    void readReadingIndexedSearch(context.api, {query, limit: PAGE, ...(follow === undefined ? {} : {cursor: follow})}, {signal: request.signal, isCurrent})
      .then(page => {
        if (!isCurrent()) return;
        if (follow === undefined) {
          cursor = page.next; indexRevision = page.indexRevision;
          publish({query, phase: 'ready', hits: page.hits, hasNext: page.next !== undefined, opening: state.opening});
          return;
        }
        // The continuation only extends the page the person is already reading. A
        // changed index retires what was drawn rather than stitching two revisions.
        if (indexRevision === undefined || page.indexRevision !== indexRevision) {
          cursor = undefined; indexRevision = page.indexRevision;
          publish({query, phase: 'stale', hits: Object.freeze([]), hasNext: false, opening: state.opening});
          return;
        }
        cursor = page.next;
        publish({query, phase: 'ready', hits: Object.freeze([...state.hits, ...page.hits]), hasNext: page.next !== undefined, opening: state.opening});
      })
      .catch(error => {
        if (!isCurrent()) return;
        // A failed continuation keeps the page the person is already reading; the
        // screen offers the same cursor again instead of throwing the page away.
        if (follow !== undefined) {publish({...state, phase: 'ready', error}); return;}
        publish({query, phase: 'error', hits: Object.freeze([]), hasNext: false, error, opening: state.opening});
      })
      .finally(() => {if (inflight === request) inflight = undefined;});
  };
  return Object.freeze({
    subscribe: (listener: () => void) => {
      if (!alive) return () => {};
      listeners.add(listener);
      return () => {listeners.delete(listener);};
    },
    getSnapshot: () => state,
    seed: () => {if (state.phase === 'idle' && live()) run(route.query, undefined);},
    search: (text: string) => {
      if (!live()) return;
      // An invalid literal is simply not sent: the existing canonical field is the
      // only place words come from, and it never invents a replacement sentence here.
      if (!validReadingIndexedSearchQuery(text)) return;
      run(text, undefined);
    },
    more: () => {
      if (!live() || state.phase !== 'ready' || !state.hasNext || cursor === undefined) return;
      run(state.query, cursor);
    },
    open: async (hit: ReadingIndexedSearchHit) => {
      if (!live() || state.opening) return;
      const origin = nativeReadOrigin(context, route);
      if (!origin) throw new Error('native_reading_search_route_replaced');
      publish({...state, opening: true});
      try {
        // Exactly what the hit named: the item, its source and that source revision.
        // No location, page, chapter or progress is claimed from a section witness.
        const opened = await openNativeRead(context, {itemId: hit.itemId, sourceId: hit.sourceId, expectedSourceRevision: hit.sourceRevision}, undefined, origin);
        // Refused rather than substituted: the hit's own revision was gone or no longer
        // admitted, so the page says so instead of opening whatever the source is now.
        // Refused, never substituted: the drawn page retires so the person can search
        // the text again rather than being shown whatever the source is now.
        if (!opened && live()) publish({...state, phase: 'stale', hits: Object.freeze([]), hasNext: false});
      } finally {if (alive) publish({...state, opening: false});}
    },
    dispose: () => {
      if (!alive) return;
      alive = false; sequence++; cancel(); listeners.clear();
    },
  });
}
