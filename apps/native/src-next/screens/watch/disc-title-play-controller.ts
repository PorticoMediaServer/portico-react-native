import {nativeDiscTitleSelection, type NativeDiscTitleSelection} from './disc-title-play';
import type {DiscTitles} from './disc-titles';

/** The selected title's own options read and the server's prepare of that title.
 * Both are absent from the canonical and native clients today, so this is the seam
 * the port plugs into: it takes the exact selection and reports through the state.
 * There is deliberately no start member: the native runtime is queue-required and
 * the server refuses a disc title with a queue, so no admission exists yet. */
export type NativeDiscTitlePrepare = (selection: NativeDiscTitleSelection, lifetime: Readonly<{signal: AbortSignal; isCurrent: () => boolean}>) => Promise<void>;

/** The presented sheet and the physical version it was opened for. */
export type NativeDiscTitlePlayLifetime = Readonly<{opening: () => boolean; version: () => string | undefined}>;

export type NativeDiscTitlePlayState = Readonly<{
  phase: 'chosen' | 'preparing' | 'prepared' | 'failed';
  selection: NativeDiscTitleSelection;
  error?: unknown;
}>;

/** One chosen title, alive only while its sheet, its physical version and the drawn
 * document it came from are still the ones it was chosen under. It reads and
 * prepares; it does not play. */
export class NativeDiscTitlePlayController {
  private listeners = new Set<() => void>();
  private state?: NativeDiscTitlePlayState;
  private disposed = false;
  private generation = 0;
  private pending?: AbortController;
  constructor(private target: Readonly<{itemId: string; versionId: string}>, private lifetime: NativeDiscTitlePlayLifetime, private prepare?: NativeDiscTitlePrepare) {}

  subscribe = (listener: () => void): (() => void) => {this.listeners.add(listener); return () => {this.listeners.delete(listener);};};
  getSnapshot = (): NativeDiscTitlePlayState | undefined => this.state;
  private current(): boolean {return !this.disposed && this.lifetime.opening() && this.lifetime.version() === this.target.versionId;}
  private publish(next?: NativeDiscTitlePlayState): void {
    if (this.disposed) return;
    this.state = next ? Object.freeze(next) : undefined;
    for (const listener of [...this.listeners]) listener();
  }

  /** The row the viewer picked, from the document it was drawn in. A newer read
   * means the row's facts may have moved, so the caller passes the document it
   * drew and a row that is no longer in it is refused. */
  choose(drawn: DiscTitles, titleId: string): boolean {
    if (!this.current() || drawn.versionId !== this.target.versionId) return false;
    const selection = nativeDiscTitleSelection(drawn, this.target.itemId, titleId);
    if (!selection) return false;
    this.generation++;
    this.pending?.abort();
    this.pending = undefined;
    this.publish({phase: 'chosen', selection});
    return true;
  }

  /** One prepare for the chosen selection. A newer choice, a newer read, a closed
   * sheet or a discarded controller drops its result instead of presenting it. */
  prepareSelected = async (): Promise<void> => {
    const state = this.state;
    if (!state || !this.prepare || this.disposed || state.phase === 'preparing' || !this.current()) return;
    const generation = ++this.generation, pending = new AbortController();
    this.pending?.abort();
    this.pending = pending;
    const current = () => this.current() && this.generation === generation && !pending.signal.aborted;
    this.publish({phase: 'preparing', selection: state.selection});
    try {
      await this.prepare(state.selection, {signal: pending.signal, isCurrent: current});
      if (current()) this.publish({phase: 'prepared', selection: state.selection});
    } catch (error) {
      if (current()) this.publish({phase: 'failed', selection: state.selection, error});
    }
  };

  clear = (): void => {
    this.generation++;
    this.pending?.abort();
    this.pending = undefined;
    this.publish(undefined);
  };
  dispose = (): void => {
    if (this.disposed) return;
    this.disposed = true;
    this.pending?.abort();
    this.pending = undefined;
    this.listeners.clear();
    this.state = undefined;
  };
}
