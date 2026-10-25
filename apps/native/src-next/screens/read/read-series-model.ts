import type {LocalSession, ReadingClient, ReadingContinueItem, ReadingItem} from '../../../../../packages/client-core/src';
import type {NativeShellBootstrapContext} from '../../shell/bootstrap';
import {sameAuthority, type ShellAuthority} from '../../shell/model';
import {openNativeReadBook} from './eligibility';

export type NativeReadSeriesState = Readonly<{
  phase: 'idle' | 'loading' | 'ready' | 'error';
  items: readonly ReadingItem[];
  nextCursor?: string;
  continued?: ReadingContinueItem;
  error?: unknown;
}>;

const refused = () => Object.assign(new Error('native_read_series_refused'), {name: 'AbortError', code: 'cancelled'});

/** Signed reading.series membership and order, plus the canonical continue row
 * for this series when it exists. No read count, page count or synthetic number. */
export class NativeReadSeries {
  private readonly context: NativeShellBootstrapContext;
  private readonly libraryId: string;
  private readonly seriesId: string;
  private readonly authority: ShellAuthority;
  private readonly captured?: Readonly<{sessionFamilyId: string; viewer: LocalSession['viewer']}>;
  private readonly life = new AbortController();
  private client?: ReadingClient;
  private state: NativeReadSeriesState = Object.freeze({phase: 'idle', items: []});
  private readonly listeners = new Set<() => void>();
  private disposed = false;

  constructor(context: NativeShellBootstrapContext, libraryId: string, seriesId: string) {
    this.context = context; this.libraryId = libraryId; this.seriesId = seriesId; this.authority = context.authority();
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
  private publish(next: NativeReadSeriesState): void {
    if (this.disposed || !this.current()) return;
    this.state = Object.freeze(next);
    for (const listener of [...this.listeners]) listener();
  }
  subscribe = (listener: () => void): (() => void) => {
    if (this.disposed) return () => {};
    this.listeners.add(listener);
    return () => {this.listeners.delete(listener);};
  };
  getSnapshot = (): NativeReadSeriesState => this.state;
  load = async (): Promise<void> => {
    if (!this.current() || this.state.phase === 'loading' || this.state.phase === 'ready') return;
    this.publish({...this.state, phase: 'loading', items: []});
    try {
      const client = this.reading();
      const page = await client.series(this.libraryId, this.seriesId, {limit: 60}, this.life.signal);
      if (!this.current()) return;
      let continued: ReadingContinueItem | undefined;
      try {
        const rows = await client.continue({libraryId: this.libraryId, limit: 60}, this.life.signal);
        continued = rows.items.find(row => row.item.series?.id === this.seriesId && row.item.inventoryAvailable && !row.progress.stale && row.progress.location.progression > 0);
      } catch { /* The series still lists without a continue row. */ }
      this.publish({phase: 'ready', items: page.items, ...(page.nextCursor ? {nextCursor: page.nextCursor} : {}), ...(continued ? {continued} : {})});
    } catch (error) {
      if (!this.current()) return;
      this.publish({phase: 'error', items: [], error});
    }
  };
  more = async (): Promise<void> => {
    const cursor = this.state.nextCursor;
    if (!cursor || !this.current() || this.state.phase === 'loading') return;
    this.publish({...this.state, phase: 'loading'});
    try {
      const page = await this.reading().series(this.libraryId, this.seriesId, {cursor, limit: 60}, this.life.signal);
      if (!this.current()) return;
      this.publish({...this.state, phase: 'ready', items: [...this.state.items, ...page.items], ...(page.nextCursor ? {nextCursor: page.nextCursor} : {nextCursor: undefined})});
    } catch (error) {
      if (!this.current()) return;
      this.publish({...this.state, phase: 'error', error});
    }
  };
  retry = (): Promise<void> => {this.publish({phase: 'idle', items: []}); return this.load();};
  open = (item: ReadingItem): Promise<boolean> => this.current() ? openNativeReadBook(this.context, {libraryId: this.libraryId, item}, this.life.signal) : Promise.resolve(false);
  openNext = (): Promise<boolean> => {
    const item = this.state.continued?.item ?? this.state.items.find(candidate => candidate.inventoryAvailable);
    return item ? this.open(item) : Promise.resolve(false);
  };
  dispose = (): void => {
    if (this.disposed) return;
    this.disposed = true; this.life.abort(); this.client?.dispose(); this.client = undefined;
  };
}
