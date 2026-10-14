import type {ContentEntry} from '../../../../packages/client-core/src/library-content';
import {parseBrowseResult, type BrowseNode, type BrowseRequestBody, type BrowseSortSelection} from '../../../../packages/client-core/src/browse';

/**
 * A group's titles, sorted and filtered by the server, for a list that sits inside a page (under a
 * collection's hero, on Saved): the first page, then one more each time the viewer asks ("Show
 * more"), as the page's own grids already work. Only what has been asked for is held.
 *
 * - A new sort or filter keeps the titles on screen until the new first page has arrived, so the
 *   page is never blanked.
 * - `refresh` reads what is on screen again, quietly, and swaps it in whole; cards keep their keys.
 * - A continuation the server no longer honours (the library changed underneath) is read again
 *   from the start without a word.
 *
 * No React and no native code: tested under Node.
 */
export type BrowsePagesQuery = Readonly<{pivot: string; predicates: readonly BrowseNode[]; sort?: BrowseSortSelection}>;
export type BrowsePagesSnapshot = Readonly<{
  status: 'idle' | 'loading' | 'ready' | 'error';
  entries: readonly ContentEntry[];
  /** How many titles the query matches, once the server has said. */
  total?: number;
  /** `total` is a lower bound (a broad filter the server counts only up to 10,000): "10,000+". */
  totalIsLowerBound?: boolean;
  hasMore: boolean;
  loadingMore: boolean;
  error?: unknown;
}>;

type Api = {request<T>(path: string, method?: string, body?: unknown, signal?: AbortSignal): Promise<T>};

const idle: BrowsePagesSnapshot = Object.freeze({status: 'idle', entries: Object.freeze([]), hasMore: false, loadingMore: false});
/** The most titles read again in one quiet refresh; a longer list keeps this many and offers the rest again. */
const REFRESH_LIMIT = 240;

export class BrowsePages {
  private readonly api: Api;
  private readonly libraryId: string;
  private readonly pageSize: number;
  private snapshot: BrowsePagesSnapshot = idle;
  private query: BrowsePagesQuery | null = null;
  private key = '';
  private cursor = '';
  /** Names the query in force: an answer for an older one is dropped. */
  private epoch = 0;
  private work?: AbortController;
  private readonly listeners = new Set<() => void>();
  private disposed = false;

  constructor(api: Api, libraryId: string, pageSize = 60) {
    this.api = api;
    this.libraryId = libraryId;
    this.pageSize = pageSize;
  }

  getSnapshot = (): BrowsePagesSnapshot => this.snapshot;
  subscribe = (listener: () => void): (() => void) => { this.listeners.add(listener); return () => { this.listeners.delete(listener); }; };
  private publish(patch: Partial<BrowsePagesSnapshot>) {
    this.snapshot = Object.freeze({...this.snapshot, ...patch});
    for (const listener of [...this.listeners]) listener();
  }

  /** The sort and filters to show. The same ones again change nothing; none (`null`) clears the list. */
  select(query: BrowsePagesQuery | null): void {
    if (this.disposed) return;
    const key = query ? JSON.stringify([query.pivot, query.predicates, query.sort ?? null]) : '';
    if (key === this.key) return;
    this.key = key;
    this.query = query;
    this.work?.abort();
    this.epoch++;
    this.cursor = '';
    if (!query) { this.snapshot = idle; for (const listener of [...this.listeners]) listener(); return; }
    // What is on screen stays until the new first page is here.
    this.publish({status: 'loading', loadingMore: false, error: undefined});
    void this.first(this.pageSize);
  }

  /** The next page, after what is listed. */
  async more(): Promise<void> {
    const query = this.query, epoch = this.epoch;
    if (this.disposed || !query || !this.snapshot.hasMore || this.snapshot.loadingMore || this.snapshot.status !== 'ready' || !this.cursor) return;
    this.publish({loadingMore: true, error: undefined});
    const work = this.work = new AbortController();
    try {
      const page = await this.read(query, this.pageSize, this.cursor, work.signal);
      if (epoch !== this.epoch) return;
      const seen = new Set(this.snapshot.entries.map(entry => entry.id));
      this.cursor = page.pageInfo.nextCursor;
      this.publish({entries: Object.freeze([...this.snapshot.entries, ...page.entries.filter(entry => !seen.has(entry.id))]), total: page.pageInfo.total, totalIsLowerBound: page.pageInfo.totalIsLowerBound, hasMore: page.pageInfo.hasMore && !!page.pageInfo.nextCursor, loadingMore: false});
    } catch (error) {
      if (epoch !== this.epoch || work.signal.aborted) return;
      // The library changed under the list: read it again from its start, as long as it was.
      if ((error as {code?: unknown} | null)?.code === 'stale_continuation') { this.publish({loadingMore: false}); await this.first(this.snapshot.entries.length + this.pageSize); return; }
      this.publish({loadingMore: false, error});
    }
  }

  /** Reads what is listed again, quietly. `hold` lets the caller wait for a still moment before the swap. */
  async refresh(hold?: () => Promise<void>): Promise<void> {
    if (this.disposed || !this.query || this.snapshot.status !== 'ready' || this.snapshot.loadingMore) return;
    await this.first(Math.max(this.pageSize, this.snapshot.entries.length), hold, true);
  }

  /** Tries a failed first read again. */
  retry(): void {
    if (this.disposed || !this.query || this.snapshot.status !== 'error') return;
    this.publish({status: 'loading', error: undefined});
    void this.first(this.pageSize);
  }

  dispose(): void {
    this.disposed = true;
    this.work?.abort();
    this.listeners.clear();
  }

  /** Reads the list from its start, `count` titles long (in pages), and swaps it in whole. */
  private async first(count: number, hold?: () => Promise<void>, quiet = false): Promise<void> {
    const query = this.query, epoch = this.epoch;
    if (!query) return;
    const work = this.work = new AbortController();
    const wanted = Math.min(Math.max(count, this.pageSize), REFRESH_LIMIT);
    try {
      const entries: ContentEntry[] = [];
      const seen = new Set<string>();
      let cursor = '', total = 0, totalIsLowerBound = false, hasMore = false;
      do {
        const page = await this.read(query, this.pageSize, cursor, work.signal);
        if (epoch !== this.epoch) return;
        for (const entry of page.entries) if (!seen.has(entry.id)) { seen.add(entry.id); entries.push(entry); }
        total = page.pageInfo.total;
        totalIsLowerBound = page.pageInfo.totalIsLowerBound;
        cursor = page.pageInfo.nextCursor;
        hasMore = page.pageInfo.hasMore && !!cursor;
      } while (hasMore && entries.length < wanted);
      if (hold) await hold();
      if (epoch !== this.epoch || this.disposed) return;
      this.cursor = cursor;
      this.publish({status: 'ready', entries: Object.freeze(entries), total, totalIsLowerBound, hasMore, loadingMore: false, error: undefined});
    } catch (error) {
      if (epoch !== this.epoch || work.signal.aborted || this.disposed) return;
      // A quiet reread that fails leaves what is on screen as it is, and says nothing.
      if (quiet) return;
      this.publish({status: this.snapshot.entries.length ? 'ready' : 'error', error, loadingMore: false});
    }
  }

  private async read(query: BrowsePagesQuery, limit: number, cursor: string, signal: AbortSignal) {
    const body: BrowseRequestBody = {
      pivot: query.pivot,
      ...(query.predicates.length ? {query: query.predicates.length === 1 ? query.predicates[0]! : {all: query.predicates}} : {}),
      ...(query.sort ? {sort: [query.sort]} : {}),
      limit,
      ...(cursor ? {cursor} : {}),
    };
    return parseBrowseResult(await this.api.request<unknown>(`/v1/libraries/${encodeURIComponent(this.libraryId)}/browse`, 'POST', body, signal));
  }
}
