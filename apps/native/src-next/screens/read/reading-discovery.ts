import {ReadingError, type LocalSession, type ReadingClient, type ReadingContinueItem, type ReadingDiscover, type ReadingItem} from '../../../../../packages/client-core/src';
import type {NativeShellBootstrapContext} from '../../shell/bootstrap';
import {sameAuthority, type ShellAuthority} from '../../shell/model';
import {openNativeReadBook, openNativeReadSeries} from './eligibility';

export type NativeReadingSeriesSummary = NonNullable<ReadingDiscover['rows'][number]['series']>[number];

export type NativeReadingDiscoveryState = Readonly<{
  phase: 'idle' | 'loading' | 'ready' | 'error';
  /** Continue reading, in the server's order, with its real progress. */
  continueItems: readonly ReadingContinueItem[];
  /** The server's `recent` Discover row, in its order. */
  recent: readonly ReadingItem[];
  /** The server's opt-in `series` row: eligible membership counts and preview. */
  series: readonly NativeReadingSeriesSummary[];
  error?: unknown;
}>;

const refused = () => Object.assign(new Error('native_reading_discovery_refused'), {name: 'AbortError', code: 'cancelled'});
const cancelled = (reason: unknown): boolean => reason instanceof ReadingError && reason.code === 'cancelled';

/** The Discover rows that have real producers: Continue reading
 * (`GET /v1/reading/continue`), Recently added and the opt-in series row
 * (`GET /v1/reading/discover`, requested with seriesLimit). Short reads,
 * classifications and periodicals stay omitted until their producers are
 * consumed; no word-count, per-volume or length estimate is invented here.
 * `libraryId` is passed through, so no other library's titles can appear. */
export class NativeReadingDiscovery {
  private readonly context: NativeShellBootstrapContext;
  private readonly libraryId: string;
  private readonly authority: ShellAuthority;
  private readonly captured?: Readonly<{sessionFamilyId: string; viewer: LocalSession['viewer']}>;
  private readonly life = new AbortController();
  private client?: ReadingClient;
  private state: NativeReadingDiscoveryState = Object.freeze({phase: 'idle', continueItems: [], recent: [], series: []});
  private listeners = new Set<() => void>();
  private disposed = false;
  private opened = false;

  constructor(context: NativeShellBootstrapContext, libraryId: string) {
    this.context = context; this.libraryId = libraryId; this.authority = context.authority();
    const selected = context.session();
    this.captured = selected && Object.freeze({sessionFamilyId: selected.sessionFamilyId, viewer: Object.freeze({...selected.viewer})});
  }
  private current = (): boolean => {
    const captured = this.captured, selected = this.context.session();
    return !this.disposed && !this.life.signal.aborted && this.context.current() && !!captured && !!selected
      && selected.sessionFamilyId === captured.sessionFamilyId && sameAuthority(this.authority, this.context.authority());
  };
  private reading(): ReadingClient {
    if (!this.current()) throw refused();
    return this.client ??= this.context.api.reading({viewer: this.captured!.viewer, isCurrent: this.current});
  }
  private publish(next: NativeReadingDiscoveryState): void {
    if (this.disposed || !this.current()) return;
    this.state = Object.freeze(next);
    for (const listener of [...this.listeners]) listener();
  }
  getSnapshot = () => this.state;
  subscribe = (listener: () => void): (() => void) => {
    if (this.disposed) return () => {};
    this.listeners.add(listener); return () => {this.listeners.delete(listener);};
  };
  load = async (): Promise<void> => {
    if (!this.current() || this.opened) return;
    this.opened = true;
    this.publish({phase: 'loading', continueItems: [], recent: [], series: []});
    const signal = this.life.signal;
    try {
      const [continuePage, discover] = await Promise.allSettled([
        this.reading().continue({libraryId: this.libraryId, limit: 20}, signal),
        this.reading().discover({libraryId: this.libraryId, limit: 20, seriesLimit: 12}, signal),
      ]);
      if (!this.current()) return;
      const failures = [continuePage, discover].filter((result): result is PromiseRejectedResult => result.status === 'rejected' && !cancelled(result.reason));
      const continueItems = continuePage.status === 'fulfilled' ? continuePage.value.items : [];
      const recent = discover.status === 'fulfilled' ? discover.value.rows.find(row => row.key === 'recent')?.items ?? [] : [];
      const series = discover.status === 'fulfilled' ? discover.value.rows.find(row => row.key === 'series')?.series ?? [] : [];
      this.publish({phase: failures.length ? 'error' : 'ready', continueItems, recent, series,
        ...(failures.length ? {error: failures[0]!.reason} : {})});
    } catch (error) {
      if (this.current() && !cancelled(error)) this.publish({phase: 'error', continueItems: [], recent: [], series: [], error});
    }
  };
  retry = async (): Promise<void> => {
    if (!this.current()) return;
    this.opened = false;
    this.state = Object.freeze({phase: 'idle', continueItems: [], recent: [], series: []});
    await this.load();
  };
  /** Only an item this Discover page shows, with available inventory, opens. */
  open = async (item: ReadingItem): Promise<boolean> => {
    if (!this.current() || item.inventoryAvailable !== true) return false;
    const resident = this.state.continueItems.some(row => row.item.id === item.id) || this.state.recent.some(row => row.id === item.id);
    if (!resident) return false;
    try {return await openNativeReadBook(this.context, {libraryId: this.libraryId, item}, this.life.signal);}
    catch (error) {
      const cancelledOpen = error instanceof ReadingError && error.code === 'cancelled' && error.status === undefined;
      if (this.life.signal.aborted || !this.current() || cancelledOpen) return false;
      throw error;
    }
  };
  /** Only a series this Discover page shows opens, through the signed series route. */
  openSeries = async (summary: NativeReadingSeriesSummary): Promise<boolean> => {
    if (!this.current() || !this.state.series.some(row => row.id === summary.id)) return false;
    try {return await openNativeReadSeries(this.context, {libraryId: this.libraryId, seriesId: summary.id}, this.life.signal);}
    catch (error) {
      const cancelledOpen = error instanceof ReadingError && error.code === 'cancelled' && error.status === undefined;
      if (this.life.signal.aborted || !this.current() || cancelledOpen) return false;
      throw error;
    }
  };
  dispose = (): void => {
    if (this.disposed) return;
    this.disposed = true; this.life.abort(); this.client?.dispose(); this.client = undefined;
  };
}
