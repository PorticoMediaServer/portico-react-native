import {ReadingError, type LocalSession, type ReadingClient, type ReadingContinueItem, type ReadingItem} from '../../../../../packages/client-core/src';
import type {NativeShellBootstrapContext} from '../../shell/bootstrap';
import {sameAuthority, type ShellAuthority} from '../../shell/model';
import {openNativeRead} from './eligibility';

export type NativeReadingDiscoveryState = Readonly<{
  phase: 'idle' | 'loading' | 'ready' | 'error';
  /** Continue reading, in the server's order, with its real progress. */
  continueItems: readonly ReadingContinueItem[];
  /** The server's `recent` Discover row, in its order. */
  recent: readonly ReadingItem[];
  error?: unknown;
}>;

const refused = () => Object.assign(new Error('native_reading_discovery_refused'), {name: 'AbortError', code: 'cancelled'});
const cancelled = (reason: unknown): boolean => reason instanceof ReadingError && reason.code === 'cancelled';

/** The two Discover rows that have real producers: Continue reading
 * (`GET /v1/reading/continue`) and Recently added (`GET /v1/reading/discover`'s
 * `recent` row). Short reads, classifications, series and periodicals stay
 * omitted until their producers exist; no word-count or length estimate is
 * invented here. `libraryId` is passed through, so no other library's titles
 * can appear. */
export class NativeReadingDiscovery {
  private readonly context: NativeShellBootstrapContext;
  private readonly libraryId: string;
  private readonly authority: ShellAuthority;
  private readonly captured?: Readonly<{sessionFamilyId: string; viewer: LocalSession['viewer']}>;
  private readonly life = new AbortController();
  private client?: ReadingClient;
  private state: NativeReadingDiscoveryState = Object.freeze({phase: 'idle', continueItems: [], recent: []});
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
    this.publish({phase: 'loading', continueItems: [], recent: []});
    const signal = this.life.signal;
    try {
      const [continuePage, discover] = await Promise.allSettled([
        this.reading().continue({libraryId: this.libraryId, limit: 20}, signal),
        this.reading().discover({libraryId: this.libraryId, limit: 20}, signal),
      ]);
      if (!this.current()) return;
      const failures = [continuePage, discover].filter((result): result is PromiseRejectedResult => result.status === 'rejected' && !cancelled(result.reason));
      if (failures.length === 2) throw failures[0]!.reason;
      const continueItems = continuePage.status === 'fulfilled' ? continuePage.value.items : [];
      const recent = discover.status === 'fulfilled' ? discover.value.rows.find(row => row.key === 'recent')?.items ?? [] : [];
      this.publish({phase: 'ready', continueItems, recent});
    } catch (error) {
      if (this.current() && !cancelled(error)) this.publish({phase: 'error', continueItems: [], recent: [], error});
    }
  };
  retry = async (): Promise<void> => {
    if (!this.current()) return;
    this.opened = false;
    this.state = Object.freeze({phase: 'idle', continueItems: [], recent: []});
    await this.load();
  };
  /** Only an item this Discover page shows, with available inventory, opens. */
  open = async (item: ReadingItem): Promise<boolean> => {
    if (!this.current() || item.inventoryAvailable !== true) return false;
    const resident = this.state.continueItems.some(row => row.item.id === item.id) || this.state.recent.some(row => row.id === item.id);
    if (!resident) return false;
    try {return await openNativeRead(this.context, {itemId: item.id, sourceId: item.sourceId}, this.life.signal);}
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
