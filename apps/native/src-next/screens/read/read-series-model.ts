import type {LocalSession, ReadingClient, ReadingContinueItem, ReadingItem, ReadingSeriesOverview} from '../../../../../packages/client-core/src';
import {ReadingError} from '../../../../../packages/client-core/src';
import type {NativeShellBootstrapContext} from '../../shell/bootstrap';
import type {NativeShellRoute} from '../../shell/routes';
import {sameAuthority, type ShellAuthority} from '../../shell/model';
import {nativeReadOrigin, openNativeReadBook, type NativeReadOrigin} from './eligibility';

export type NativeReadSeriesState = Readonly<{
  phase: 'idle' | 'loading' | 'ready' | 'error';
  items: readonly ReadingItem[];
  nextCursor?: string;
  /** The signed series summary when the server publishes it. */
  overview?: ReadingSeriesOverview;
  /** The one real continue row for this series, when it exists. */
  continued?: ReadingContinueItem;
  error?: unknown;
  /** A later page failed; the volumes already loaded stay on screen. */
  moreError?: unknown;
}>;
type SeriesRoute = Extract<NativeShellRoute, {kind: 'read-series'}>;

const refused = () => Object.assign(new Error('native_read_series_refused'), {name: 'AbortError', code: 'cancelled'});
const cancelled = (error: unknown): boolean => error instanceof ReadingError && error.code === 'cancelled' && error.status === undefined;

/** Signed `reading.series` membership and order, plus the canonical continue
 * row for this series when it exists. Read count, per-volume finished state,
 * dates and page counts have no producer here, so they stay absent. */
export class NativeReadSeries {
  private readonly context: NativeShellBootstrapContext;
  private readonly libraryId: string;
  private readonly seriesId: string;
  private readonly route: SeriesRoute;
  private origin?: NativeReadOrigin;
  private captured?: Readonly<{sessionFamilyId: string; viewer: LocalSession['viewer']}>;
  private authority?: ShellAuthority;
  private life?: AbortController;
  private client?: ReadingClient;
  private state: NativeReadSeriesState = Object.freeze({phase: 'idle', items: []});
  private readonly listeners = new Set<() => void>();
  private flight = 0;
  private morePending = false;
  private opening = false;
  private disposed = false;

  constructor(context: NativeShellBootstrapContext, route: SeriesRoute) {
    this.context = context; this.libraryId = route.libraryId; this.seriesId = route.seriesId; this.route = route;
  }
  /** Run from the page's layout effect with the exact rendered route. */
  arm = (): boolean => {
    if (this.disposed) return false;
    const selected = this.context.session(), origin = nativeReadOrigin(this.context, this.route);
    if (!selected || !origin) return false;
    this.retire();
    this.origin = origin;
    this.authority = this.context.authority();
    this.captured = Object.freeze({sessionFamilyId: selected.sessionFamilyId, viewer: Object.freeze({...selected.viewer})});
    this.state = Object.freeze({phase: 'idle', items: []});
    this.emit();
    return true;
  };
  release = (): void => {
    this.retire();
    this.origin = undefined; this.captured = undefined; this.authority = undefined;
  };
  private retire(): void {
    this.flight++;
    this.life?.abort();
    this.client?.dispose();
    this.client = undefined; this.life = undefined;
    this.morePending = false; this.opening = false;
  }
  private current = (): boolean => {
    const origin = this.origin, captured = this.captured, selected = this.context.session();
    if (this.disposed || !origin || !captured || !this.authority || !selected || !this.context.current()) return false;
    if (selected.sessionFamilyId !== captured.sessionFamilyId || !sameAuthority(this.authority, this.context.authority())) return false;
    const snapshot = this.context.navigation.getSnapshot();
    return snapshot.route === origin.route && snapshot.revision === origin.revision;
  };
  private reading(): ReadingClient {
    const captured = this.captured;
    if (!captured || !this.current()) throw refused();
    this.life ??= new AbortController();
    return this.client ??= this.context.api.reading({viewer: captured.viewer, isCurrent: this.current, signal: this.life.signal});
  }
  private publish(next: NativeReadSeriesState): void {
    if (this.disposed || !this.current()) return;
    this.state = Object.freeze(next);
    this.emit();
  }
  private emit(): void {for (const listener of [...this.listeners]) listener();}
  subscribe = (listener: () => void): (() => void) => {
    if (this.disposed) return () => {};
    this.listeners.add(listener);
    return () => {this.listeners.delete(listener);};
  };
  getSnapshot = (): NativeReadSeriesState => this.state;
  load = async (): Promise<void> => {
    if (!this.current()) return;
    const flight = ++this.flight;
    this.publish({phase: 'loading', items: []});
    try {
      const client = this.reading(), signal = this.life!.signal;
      const page = await client.series(this.libraryId, this.seriesId, {limit: 60}, signal);
      if (flight !== this.flight || !this.current()) return;
      let continued: ReadingContinueItem | undefined;
      try {
        const rows = await client.continue({libraryId: this.libraryId, limit: 50}, signal);
        if (flight !== this.flight || !this.current()) return;
        continued = rows.items.find(row => row.item.series?.id === this.seriesId && row.item.inventoryAvailable && !row.progress.stale && row.progress.location.progression > 0);
      } catch (error) {
        if (cancelled(error)) return;
        // The series still lists without a continue row.
      }
      if (flight !== this.flight || !this.current()) return;
      this.publish({phase: 'ready', items: page.items, ...(page.nextCursor ? {nextCursor: page.nextCursor} : {}),
        ...(page.overview ? {overview: page.overview} : {}), ...(continued ? {continued} : {})});
    } catch (error) {
      if (flight !== this.flight || !this.current() || cancelled(error)) return;
      this.publish({phase: 'error', items: [], error});
    }
  };
  /** The next page only appends for the exact flight and cursor that asked for
   * it; a retry retires the flight and its result is dropped. */
  more = async (): Promise<void> => {
    const cursor = this.state.nextCursor;
    if (!cursor || this.morePending || this.state.phase !== 'ready' || !this.current()) return;
    const flight = this.flight;
    this.morePending = true;
    this.publish({...this.state, moreError: undefined});
    try {
      const client = this.reading(), signal = this.life!.signal;
      const page = await client.series(this.libraryId, this.seriesId, {cursor, limit: 60}, signal);
      if (flight !== this.flight || !this.current() || this.state.nextCursor !== cursor) return;
      this.publish({...this.state, phase: 'ready', items: [...this.state.items, ...page.items],
        ...(page.nextCursor ? {nextCursor: page.nextCursor} : {nextCursor: undefined}),
        ...(page.overview ? {overview: page.overview} : {}), moreError: undefined});
    } catch (error) {
      if (flight !== this.flight || !this.current() || cancelled(error)) return;
      this.publish({...this.state, moreError: error});
    } finally {this.morePending = false;}
  };
  retry = (): Promise<void> => this.load();
  /** Only a volume this page actually listed, with available inventory, opens. */
  open = async (item: ReadingItem): Promise<boolean> => {
    const origin = this.origin, life = this.life;
    if (this.opening || !origin || !life || !this.current() || item.inventoryAvailable !== true
      || !this.state.items.some(candidate => candidate.id === item.id && candidate.sourceId === item.sourceId)) return false;
    this.opening = true;
    try {return await openNativeReadBook(this.context, {libraryId: this.libraryId, item}, origin, life.signal);}
    finally {this.opening = false;}
  };
  openNext = (): Promise<boolean> => {
    const item = this.state.continued?.item ?? this.state.items.find(candidate => candidate.inventoryAvailable);
    return item ? this.open(item) : Promise.resolve(false);
  };
  dispose = (): void => {
    if (this.disposed) return;
    this.disposed = true;
    this.release();
    this.listeners.clear();
  };
}
