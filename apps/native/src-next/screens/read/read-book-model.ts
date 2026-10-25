import {ReadingError, type LocalSession, type ReadingClient, type ReadingItem, type ReadingManifest, type ReadingProgress} from '../../../../../packages/client-core/src';
import type {NativeShellBootstrapContext} from '../../shell/bootstrap';
import {sameAuthority, type ShellAuthority} from '../../shell/model';
import {openNativeRead, openNativeReadSeries} from './eligibility';

export type NativeReadVersion = Awaited<ReturnType<ReadingClient['versions']>>['versions'][number];

export type NativeReadBookState = Readonly<{
  phase: 'idle' | 'loading' | 'ready' | 'error';
  /** The item's real versions; one available version opens at a time. */
  versions: readonly NativeReadVersion[];
  /** The selected version the manifest and progress below belong to. */
  sourceId?: string;
  manifest?: ReadingManifest;
  progress?: ReadingProgress;
  error?: unknown;
}>;

const refused = () => Object.assign(new Error('native_read_book_refused'), {name: 'AbortError', code: 'cancelled'});

/** The real book page's own projection: the selected version's manifest and
 * saved reading position from one session, never a guessed page or progress.
 * The page opens no reader host; its Read action reuses openNativeRead. */
export class NativeReadBook {
  private readonly context: NativeShellBootstrapContext;
  readonly item: ReadingItem;
  private readonly libraryId: string;
  private readonly authority: ShellAuthority;
  private readonly captured?: Readonly<{sessionFamilyId: string; viewer: LocalSession['viewer']}>;
  private readonly life = new AbortController();
  private client?: ReadingClient;
  private state: NativeReadBookState = Object.freeze({phase: 'idle', versions: []});
  private chosen?: string;
  private readonly listeners = new Set<() => void>();
  private disposed = false;

  constructor(context: NativeShellBootstrapContext, libraryId: string, item: ReadingItem) {
    this.context = context; this.libraryId = libraryId; this.item = item; this.authority = context.authority();
    const selected = context.session();
    this.captured = selected && Object.freeze({sessionFamilyId: selected.sessionFamilyId, viewer: Object.freeze({...selected.viewer})});
  }
  private current = (): boolean => {
    const captured = this.captured, selected = this.context.session();
    return !this.disposed && !this.life.signal.aborted && this.context.current() && !!captured && !!selected
      && selected.sessionFamilyId === captured.sessionFamilyId && sameAuthority(this.authority, this.context.authority());
  };
  private reading(): ReadingClient {
    const captured = this.captured;
    if (!captured || !this.current()) throw refused();
    return this.client ??= this.context.api.reading({viewer: captured.viewer, isCurrent: this.current});
  }
  private publish(next: NativeReadBookState): void {
    if (this.disposed || !this.current()) return;
    this.state = Object.freeze(next);
    for (const listener of [...this.listeners]) listener();
  }
  subscribe = (listener: () => void): (() => void) => {
    if (this.disposed) return () => {};
    this.listeners.add(listener);
    return () => {this.listeners.delete(listener);};
  };
  getSnapshot = (): NativeReadBookState => this.state;
  load = async (): Promise<void> => {
    if (!this.current() || this.state.phase === 'loading' || this.state.phase === 'ready') return;
    this.publish({phase: 'loading', versions: this.state.versions, ...(this.state.sourceId ? {sourceId: this.state.sourceId} : {})});
    try {
      const client = this.reading();
      const versions = await client.versions(this.item.id, this.life.signal);
      // The item's own source opens when it has inventory; otherwise the first
      // real available version does, never an inferred format preference.
      const selected = versions.versions.find(version => version.sourceId === (this.chosen ?? this.item.sourceId) && version.inventoryAvailable)
        ?? versions.versions.find(version => version.inventoryAvailable);
      if (!selected) throw new ReadingError('source_unavailable');
      const session = await client.open({itemId: this.item.id, sourceId: selected.sourceId}, this.life.signal);
      try {
        const progress = await session.progress(this.life.signal);
        if (!this.current()) return;
        this.publish({phase: 'ready', versions: versions.versions, sourceId: selected.sourceId, manifest: session.manifest, progress});
      } finally {
        // The page keeps the projection, not a second open session: the reader
        // opens the one host session when Read is pressed.
        await session.close().catch(() => {});
      }
    } catch (error) {
      if (!this.current()) return;
      this.publish({phase: 'error', versions: this.state.versions, error});
    }
  };
  /** Selecting another real, available version reloads the page's own projection. */
  selectVersion = (sourceId: string): Promise<void> => {
    if (!this.current() || this.state.phase === 'loading' || sourceId === this.state.sourceId) return Promise.resolve();
    const version = this.state.versions.find(candidate => candidate.sourceId === sourceId);
    if (!version?.inventoryAvailable) return Promise.resolve();
    this.chosen = sourceId;
    this.publish({phase: 'idle', versions: this.state.versions, sourceId});
    return this.load();
  };
  retry = (): Promise<void> => {this.publish({phase: 'idle', versions: this.state.versions}); return this.load();};
  /** Only a saved position for this exact source revision is a resume. */
  savedProgression = (): number | undefined => {
    const saved = this.state.progress?.progress;
    if (!saved || saved.stale || saved.sourceId !== this.state.manifest?.sourceId || saved.sourceRevision !== this.state.manifest?.revision) return undefined;
    const progression = saved.location.progression;
    return progression > 0 && progression < 1 ? progression : undefined;
  };
  read = async (index?: number): Promise<boolean> => {
    const manifest = this.state.manifest;
    if (!manifest || !this.current()) return false;
    const contentsTarget = index === undefined || manifest.format !== 'epub' ? undefined : {sourceId: manifest.sourceId, sourceRevision: manifest.revision, index};
    return openNativeRead(this.context, {itemId: this.item.id, sourceId: manifest.sourceId, ...(contentsTarget ? {contentsTarget} : {})}, this.life.signal);
  };
  openSeries = (): Promise<boolean> => {
    const series = this.item.series;
    return series && this.current() ? openNativeReadSeries(this.context, {libraryId: this.libraryId, seriesId: series.id}, this.life.signal) : Promise.resolve(false);
  };
  dispose = (): void => {
    if (this.disposed) return;
    this.disposed = true; this.life.abort(); this.client?.dispose(); this.client = undefined;
  };
}
