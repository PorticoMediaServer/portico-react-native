import {readReadingIndexedSearch, validReadingIndexedSearchQuery, type ReadingIndexedSearchHit} from '../../../../../packages/client-core/src/reading-indexed-search';
import {presentError} from '../../../../../packages/client-core/src/presentation/errors';
import type {NativeShellBootstrapContext} from '../../shell/bootstrap';
import type {NativeShellRoute, NativeRouteSnapshot} from '../../shell/routes';
import {openNativeRead} from '../read/eligibility';

type SearchRoute = Extract<NativeShellRoute, {kind: 'search-reading'}>;

/** One bounded, explicit book-text search. The words are the person's own literal
 * text: nothing here trims, folds, lowercases, expands or rewrites them before the
 * canonical validator and the official `/v1/reading/search` request see them. */
export type NativeReadingSearchState = Readonly<{
  /** The exact words the drawn page belongs to; '' until the first search starts. */
  query: string;
  phase: 'idle' | 'loading' | 'ready' | 'more' | 'error';
  hits: readonly ReadingIndexedSearchHit[];
  hasNext: boolean;
  /** The whole page was retired; the screen offers a new search. */
  error?: unknown;
  /** A continuation failed for a positively known transient reason; the page and
   * its cursor are still real, and only an explicit Retry asks for that cursor again. */
  moreError?: unknown;
  /** True while one admitted hit is opening the reader for its exact source. */
  opening: boolean;
}>;

export type NativeReadingSearchPort = Readonly<{
  subscribe: (listener: () => void) => () => void;
  getSnapshot: () => NativeReadingSearchState;
  /** A committed visible opening of this page: captures the exact navigation
   * snapshot every later command and activation is proven against. */
  admit: () => void;
  search: (text: string) => void;
  more: () => void;
  /** Explicit retry of the retained cursor after a transient continuation failure. */
  retry: () => void;
  /** Opens the exact hit object this page drew; a hit from another page is refused. */
  open: (hit: ReadingIndexedSearchHit) => void;
  attachReporter: (report: (error: unknown) => void) => void;
  dispose: () => void;
}>;

/** The server's own page size is the only continuation bound we ask for. */
const PAGE = 20;

/** A page request only exists while its own admission, query and ticket are current. */
type Page = Readonly<{query: string; indexRevision: number; hits: readonly ReadingIndexedSearchHit[]}>;

const EMPTY: NativeReadingSearchState = Object.freeze({query: '', phase: 'idle', hits: Object.freeze([]), hasNext: false, opening: false});

const position = (hit: ReadingIndexedSearchHit): string =>
  JSON.stringify([hit.itemId, hit.sourceId, hit.sourceRevision, hit.sectionPath, hit.sectionIndex, hit.utf16Offset]);

/** Only positively known transport/busy failures may keep a drawn page and its cursor. */
const transient = (error: unknown): boolean => {
  try {
    const category = presentError(error, 'search').category;
    return category === 'offline' || category === 'unreachable' || category === 'timeout' || category === 'busy';
  } catch {return false;}
};

/** Root54 native surface. It owns one route-local request lifetime, the exact
 * committed navigation snapshot the page was admitted under, the captured index
 * revision and the cursor of the page it drew. Commands from a hidden or retained
 * page are refused: retention for Back is not authority to act. */
export function createNativeReadingSearch(context: NativeShellBootstrapContext, route: SearchRoute): NativeReadingSearchPort {
  const captured = context.session();
  if (!captured) throw new Error('native_reading_search_authority_required');
  const family = captured.sessionFamilyId;
  const listeners = new Set<() => void>();
  let alive = true, state = EMPTY, reporter: ((error: unknown) => void) | undefined;
  let witness: NativeRouteSnapshot | undefined, page: Page | undefined, cursor: string | undefined;
  let sequence = 0, inflight: AbortController | undefined, activationTicket = 0, activation: AbortController | undefined;
  const live = (): boolean => {
    if (!alive || !context.current()) return false;
    const session = context.session();
    if (!session || session.sessionFamilyId !== family) return false;
    const snapshot = context.navigation.getSnapshot();
    return snapshot.route === route || context.navigation.retainedRoutes().includes(route);
  };
  /** The only authority a command or activation has: the exact snapshot admitted
   * while this page was visibly committed, and nothing borrowed later. */
  const admitted = (): NativeRouteSnapshot | undefined => {
    if (!live() || !witness) return undefined;
    return context.navigation.getSnapshot() === witness ? witness : undefined;
  };
  const publish = (next: NativeReadingSearchState): void => {
    if (!alive) return;
    state = Object.freeze(next);
    for (const listener of [...listeners]) listener();
  };
  const cancelRequest = (): void => {inflight?.abort(); inflight = undefined; sequence++;};
  const cancelActivation = (): void => {activation?.abort(); activation = undefined; activationTicket++;};
  const retire = (error: unknown): void => {
    page = undefined; cursor = undefined;
    // A page that no longer exists cannot still be opening its own reader.
    cancelActivation();
    publish({query: state.query, phase: 'error', hits: Object.freeze([]), hasNext: false, error, opening: false});
  };
  const commit = (query: string, indexRevision: number, hits: readonly ReadingIndexedSearchHit[], next: string | undefined): void => {
    page = Object.freeze({query, indexRevision, hits});
    cursor = next;
    publish({query, phase: 'ready', hits, hasNext: next !== undefined, opening: state.opening});
  };
  const run = (query: string, follow: string | undefined): void => {
    const admittedNow = admitted();
    if (!admittedNow) return;
    if (follow !== undefined && (!page || page.query !== query || cursor !== follow)) return;
    cancelRequest();
    const ticket = sequence, request = new AbortController();
    const isCurrent = () => live() && admitted() === admittedNow && ticket === sequence && !request.signal.aborted;
    inflight = request;
    if (follow === undefined) {
      // Replacing the words retires the page and any activation opening from it.
      page = undefined; cursor = undefined;
      cancelActivation();
      publish({query, phase: 'loading', hits: Object.freeze([]), hasNext: false, opening: false});
    } else publish({...state, phase: 'more', moreError: undefined, error: undefined});
    void readReadingIndexedSearch(context.api, {query, limit: PAGE, ...(follow === undefined ? {} : {cursor: follow})}, {signal: request.signal, isCurrent})
      .then(result => {
        if (!isCurrent()) return;
        if (follow === undefined) {commit(query, result.indexRevision, result.hits, result.next); return;}
        // The continuation must extend exactly the page that is on screen: same index
        // revision, a cursor that actually moved, and at least one position we do not
        // already hold. Anything else is a refused or nonprogressing answer and retires
        // the page instead of appending duplicates or pretending the list ended.
        const drawn = page;
        if (!drawn || result.indexRevision !== drawn.indexRevision) return retire(Object.assign(new Error('reading_indexed_search_changed'), {code: 'reading_indexed_search_changed'}));
        if (result.next !== undefined && result.next === follow) return retire(Object.assign(new Error('reading_indexed_search_cursor'), {code: 'reading_indexed_search_cursor'}));
        const seen = new Set(drawn.hits.map(position));
        const fresh = result.hits.filter(hit => !seen.has(position(hit)));
        if (!fresh.length) return retire(Object.assign(new Error('reading_indexed_search_cursor'), {code: 'reading_indexed_search_cursor'}));
        commit(query, result.indexRevision, Object.freeze([...drawn.hits, ...fresh]), result.next);
      })
      .catch(error => {
        if (!isCurrent()) return;
        // A transient continuation failure keeps the real page and its cursor; retry is
        // explicit. Every other failure, including a refused cursor or a malformed page,
        // retires the results so the person starts from a real new search.
        if (follow !== undefined && transient(error)) {publish({...state, phase: 'ready', moreError: error}); return;}
        retire(error);
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
    admit: () => {
      if (!live()) return;
      const snapshot = context.navigation.getSnapshot();
      if (witness !== snapshot) {
        // A new committed opening (the first one, or Back into this page) supersedes
        // every request and activation started under the previous one.
        cancelRequest(); cancelActivation();
        witness = snapshot;
        publish({...state, phase: state.phase === 'more' ? 'ready' : state.phase, moreError: undefined, opening: false});
      }
      if (state.phase === 'idle') run(route.query, undefined);
    },
    search: (text: string) => {
      if (!admitted()) return;
      if (!validReadingIndexedSearchQuery(text)) return;
      // Replacing the words cancels an activation that was opening under the old page.
      cancelActivation();
      run(text, undefined);
    },
    more: () => {
      if (!admitted() || state.phase !== 'ready' || !state.hasNext || cursor === undefined || state.moreError) return;
      run(state.query, cursor);
    },
    retry: () => {
      if (!admitted() || state.phase !== 'ready' || !state.moreError || cursor === undefined) return;
      run(state.query, cursor);
    },
    open: (hit: ReadingIndexedSearchHit) => {
      const admittedNow = admitted();
      // The hit must be the exact object this admitted page drew, for this query and
      // index revision; a rendered row from an older page can never open anything.
      if (!admittedNow || !page || state.phase !== 'ready' || state.opening || !page.hits.includes(hit)) return;
      const ticket = ++activationTicket, controller = new AbortController();
      activation = controller;
      const stillCurrent = () => activation === controller && ticket === activationTicket && admitted() !== undefined;
      publish({...state, opening: true});
      void (async () => {
        try {
          // Exactly what the hit named, and the origin is the admitted commit, never a
          // revision borrowed at press time. No page, chapter, CFI or progress is claimed.
          const opened = await openNativeRead(context, {itemId: hit.itemId, sourceId: hit.sourceId, expectedSourceRevision: hit.sourceRevision},
            controller.signal, {route: admittedNow.route, revision: admittedNow.revision});
          if (!stillCurrent() || controller.signal.aborted) return;
          // Refused, never substituted: the page retires so the person searches again.
          if (!opened) retire(Object.assign(new Error('reading_indexed_search_source_changed'), {code: 'reading_indexed_search_source_changed'}));
        } catch (error) {
          if (!stillCurrent() || controller.signal.aborted || (error instanceof Error && error.name === 'AbortError')) return;
          reporter?.(error);
        } finally {
          if (activation === controller) activation = undefined;
          if (stillCurrent()) publish({...state, opening: false});
        }
      })();
    },
    attachReporter: (report: (error: unknown) => void) => {reporter = report;},
    dispose: () => {
      if (!alive) return;
      alive = false; cancelRequest(); cancelActivation(); listeners.clear();
      page = undefined; cursor = undefined; witness = undefined;
    },
  });
}
