/** A bounded viewport over one original cursor query. Cursors are opaque and
 * enter this class only as the producer's offered next cursor or a bookmark. */
export type DashboardCursorPage<T, M> = Readonly<{items: readonly T[]; nextCursor?: string; metadata: M}>;
export type DashboardCursorChunk<T> = Readonly<{cursor: string; items: readonly T[]}>;
export type DashboardCursorSnapshot<T, M> = Readonly<{
  scope: object; generation: number; chunks: readonly DashboardCursorChunk<T>[]; items: readonly T[];
  bookmarks: readonly string[]; nextCursor: string; metadata?: M;
  pending: boolean; error?: unknown; refreshRequired: boolean;
}>;
type Flight<T, M> = {generation: number; expected: DashboardCursorSnapshot<T, M>; cursor: string; abort: AbortController; promise: Promise<void>; reset: boolean};

export class DashboardCursorWindow<T, M> {
  private generation = 0;
  private disposed = false;
  private flight?: Flight<T, M>;
  private focused?: string;
  private focusGeneration?: number;
  private held?: {flight: Flight<T, M>; page: DashboardCursorPage<T, M>; previous: boolean; reset: boolean};
  private seen = new Set<string>();
  private value: DashboardCursorSnapshot<T, M> = {scope: {}, generation: 0, chunks: [], items: [], bookmarks: [''], nextCursor: '', pending: false, refreshRequired: false};
  constructor(private readonly read: (cursor: string, signal: AbortSignal) => Promise<DashboardCursorPage<T, M>>,
    private readonly key: (item: T) => string, private readonly current: () => boolean,
    private readonly changed: (value: DashboardCursorSnapshot<T, M>) => void) {}
  snapshot = (): DashboardCursorSnapshot<T, M> => this.value;
  /** Adopt an already-read producer page as the first page of a fresh query. */
  seed(cursor: string, page: DashboardCursorPage<T, M>): void {
    if (this.disposed || !this.current() || this.flight || this.value.chunks.length) return;
    if (cursor) this.seen.add(cursor);
    this.publish({...this.value, chunks: [{cursor, items: page.items}], items: page.items, bookmarks: cursor ? ['', cursor] : [''], nextCursor: page.nextCursor ?? '', metadata: page.metadata, pending: false, refreshRequired: !!cursor && page.nextCursor === cursor});
  }
  private publish(value: DashboardCursorSnapshot<T, M>): void {this.value = Object.freeze(value); this.changed(this.value);}
  private alive(flight: Flight<T, M>): boolean {return !this.disposed && this.current() && this.flight === flight && flight.generation === this.generation && !flight.abort.signal.aborted;}
  /** Called by the actual focus binding, not by a guessed row index. */
  focus(id?: string, generation = this.generation): void {this.focused = id; this.focusGeneration = id === undefined ? undefined : generation; if (this.held && this.alive(this.held.flight)) this.accept(this.held.flight, this.held.page, this.held.previous, this.held.reset);}
  blur(id: string, generation: number): void {if (this.focused === id && this.focusGeneration === generation) this.focus(undefined);}
  refresh(): Promise<void> {
    if (this.disposed || !this.current()) return Promise.resolve();
    if (this.flight?.reset && this.alive(this.flight)) return this.flight.promise;
    this.flight?.abort.abort(); this.flight = undefined; this.held = undefined; this.seen.clear(); this.generation++;
    const old = this.value;
    this.publish({...old, generation: this.generation, bookmarks: [''], nextCursor: '', pending: false, error: undefined, refreshRequired: false});
    return this.request(this.value, '', false, true);
  }
  next(expected: DashboardCursorSnapshot<T, M>): Promise<void> {
    if (this.flight && this.flight.expected === expected) return this.flight.promise;
    if (expected !== this.value || !expected.nextCursor || expected.refreshRequired) return Promise.resolve();
    return this.request(expected, expected.nextCursor, false, false);
  }
  previous(expected: DashboardCursorSnapshot<T, M>): Promise<void> {
    if (this.flight && this.flight.expected === expected) return this.flight.promise;
    if (expected !== this.value || expected.refreshRequired || !expected.chunks.length) return Promise.resolve();
    const first = expected.chunks[0].cursor, index = expected.bookmarks.indexOf(first);
    const cursor = index > 0 ? expected.bookmarks[index - 1] : '';
    if (cursor === first) return Promise.resolve();
    return this.request(expected, cursor, true, false);
  }
  retry(expected: DashboardCursorSnapshot<T, M>): Promise<void> {
    if (expected !== this.value || expected.error === undefined || expected.refreshRequired) return Promise.resolve();
    const cursor = this.retryCursor, previous = this.retryPrevious;
    return this.request(expected, cursor, previous, this.retryReset);
  }
  private retryReset = false;
  private retryCursor = '';
  private retryPrevious = false;
  private request(expected: DashboardCursorSnapshot<T, M>, cursor: string, previous: boolean, reset: boolean): Promise<void> {
    if (this.disposed || !this.current() || expected !== this.value || this.flight) return Promise.resolve();
    const abort = new AbortController();
    const flight: Flight<T, M> = {generation: this.generation, expected, cursor, abort, promise: Promise.resolve(), reset};
    this.flight = flight; this.retryCursor = cursor; this.retryPrevious = previous; this.retryReset = reset;
    this.publish({...expected, pending: true, error: undefined});
    flight.promise = (async () => {
      try {
        const page = await this.read(cursor, abort.signal);
        if (!this.alive(flight)) return;
        const expectedSuccessor = previous ? this.value.chunks[0]?.cursor : undefined;
        if (previous && expectedSuccessor && page.nextCursor !== expectedSuccessor || !previous && page.nextCursor && (page.nextCursor === cursor || this.seen.has(page.nextCursor))) {
          this.flight = undefined; this.publish({...this.value, pending: false, refreshRequired: true}); return;
        }
        this.accept(flight, page, previous, reset);
      } catch (error) {
        if (this.alive(flight)) {this.flight = undefined; if (error instanceof Error && error.message === 'dashboard_refresh_required') this.publish({...this.value, pending: false, refreshRequired: true}); else this.publish({...this.value, pending: false, error: error ?? new Error('dashboard_page_failed')});}
      }
    })();
    return flight.promise;
  }
  private accept(flight: Flight<T, M>, page: DashboardCursorPage<T, M>, previous: boolean, reset: boolean): void {
    if (!this.alive(flight)) return;
    const old = this.value, candidate = {cursor: flight.cursor, items: page.items};
    if (reset && this.focused && old.items.some(row => this.key(row) === this.focused) && !page.items.some(row => this.key(row) === this.focused)) {this.held = {flight, page, previous, reset}; return;}
    const chunks = reset ? [candidate] : previous ? [candidate, ...old.chunks.filter(chunk => chunk.cursor !== flight.cursor)] : [...old.chunks.filter(chunk => chunk.cursor !== flight.cursor), candidate];
    const evicted = chunks.length > 3 ? previous ? chunks[chunks.length - 1] : chunks[0] : undefined;
    if (evicted && this.focused && evicted.items.some(row => this.key(row) === this.focused)) {this.held = {flight, page, previous, reset}; return;}
    if (evicted) previous ? chunks.pop() : chunks.shift();
    let bookmarks = [...old.bookmarks];
    if (!previous && flight.cursor && !bookmarks.includes(flight.cursor)) bookmarks.push(flight.cursor);
    if (bookmarks.length > 64) bookmarks = ['', ...bookmarks.slice(-63)];
    if (previous) this.seen = new Set(chunks.map(chunk => chunk.cursor).filter(Boolean));
    else if (flight.cursor) {this.seen.add(flight.cursor); if (this.seen.size > 63) this.seen.delete(this.seen.values().next().value!);}
    const ids = new Set<string>(), items: T[] = [];
    for (const chunk of chunks) for (const row of chunk.items) if (!ids.has(this.key(row))) {ids.add(this.key(row)); items.push(row);}
    this.held = undefined; this.flight = undefined;
    this.publish({...old, chunks, items, bookmarks, nextCursor: previous ? evicted?.cursor ?? old.nextCursor : page.nextCursor ?? '', metadata: page.metadata, pending: false, error: undefined});
  }
  dispose(): void {if (this.disposed) return; this.disposed = true; this.generation++; this.flight?.abort.abort(); this.flight = undefined; this.held = undefined;}
}
