import {ReadingError, type LocalSession, type ReadingClient, type ReadingItem, type ReadingManifest, type ReadingProgress} from '../../../../../packages/client-core/src';
import type {NativeShellBootstrapContext} from '../../shell/bootstrap';
import type {NativeShellRoute} from '../../shell/routes';
import {sameAuthority, type ShellAuthority} from '../../shell/model';
import {nativeReadOrigin, openNativeRead, openNativeReadSeries, type NativeReadOrigin} from './eligibility';

export type NativeReadBookState = Readonly<{
  phase: 'idle' | 'loading' | 'ready' | 'error';
  manifest?: ReadingManifest;
  progress?: ReadingProgress;
  error?: unknown;
}>;
type BookRoute = Extract<NativeShellRoute, {kind: 'read-book'}>;
type SeriesLink = Readonly<{id: string; name: string; number?: number}>;

const refused = () => Object.assign(new Error('native_read_book_refused'), {name: 'AbortError', code: 'cancelled'});
const cancelled = (error: unknown): boolean => error instanceof ReadingError && error.code === 'cancelled' && error.status === undefined;

/** The real book page's own projection: the selected version's manifest, saved
 * position and declared contents from one preview session that is closed before
 * the page becomes ready. The page opens no reader host; its Read action reuses
 * the one openNativeRead door with the manifest it actually rendered. */
export class NativeReadBook {
  private readonly context: NativeShellBootstrapContext;
  readonly item: ReadingItem;
  private readonly libraryId: string;
  private readonly route: BookRoute;
  private origin?: NativeReadOrigin;
  private captured?: Readonly<{sessionFamilyId: string; viewer: LocalSession['viewer']}>;
  private authority?: ShellAuthority;
  private life?: AbortController;
  private client?: ReadingClient;
  private state: NativeReadBookState = Object.freeze({phase: 'idle'});
  private readonly listeners = new Set<() => void>();
  private flight = 0;
  private opening = false;
  private disposed = false;

  constructor(context: NativeShellBootstrapContext, route: BookRoute) {
    this.context = context; this.libraryId = route.libraryId; this.item = route.item; this.route = route;
  }
  /** Run from the page's layout effect: the origin is the snapshot this exact
   * route was rendered under, never a later one read from a press. */
  arm = (): boolean => {
    if (this.disposed) return false;
    const selected = this.context.session(), origin = nativeReadOrigin(this.context, this.route);
    if (!selected || !origin) return false;
    this.retire();
    this.origin = origin;
    this.authority = this.context.authority();
    this.captured = Object.freeze({sessionFamilyId: selected.sessionFamilyId, viewer: Object.freeze({...selected.viewer})});
    this.state = Object.freeze({phase: 'idle'});
    this.emit();
    return true;
  };
  /** Unmount makes the cached page inert: no requests, no client, no session. */
  release = (): void => {
    this.retire();
    this.origin = undefined; this.captured = undefined; this.authority = undefined;
  };
  private retire(): void {
    this.flight++;
    this.life?.abort();
    this.client?.dispose();
    this.client = undefined; this.life = undefined;
    this.opening = false;
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
  private publish(next: NativeReadBookState): void {
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
  getSnapshot = (): NativeReadBookState => this.state;
  /** One private flight per load. A retry supersedes it, and only that flight's
   * exact manifest and progress may publish after its preview session closed. */
  load = async (): Promise<void> => {
    if (!this.current()) return;
    const flight = ++this.flight;
    this.publish({phase: 'loading'});
    try {
      const client = this.reading(), signal = this.life!.signal;
      const versions = await client.versions(this.item.id, signal);
      if (flight !== this.flight || !this.current()) return;
      if (!versions.versions.some(version => version.sourceId === this.item.sourceId && version.inventoryAvailable)) throw new ReadingError('source_unavailable');
      const session = await client.open({itemId: this.item.id, sourceId: this.item.sourceId}, signal);
      let progress: ReadingProgress | undefined;
      try {progress = await session.progress(signal);} finally {await session.close().catch(() => {});}
      if (flight !== this.flight || !this.current() || !progress) return;
      const manifest = session.manifest;
      if (manifest.itemId !== this.item.id || manifest.sourceId !== this.item.sourceId) throw new ReadingError('invalid_document');
      this.publish({phase: 'ready', manifest, progress});
    } catch (error) {
      if (flight !== this.flight || !this.current() || cancelled(error)) return;
      this.publish({phase: 'error', error});
    }
  };
  retry = (): Promise<void> => this.load();
  /** Only a saved position for this exact source revision of the rendered
   * manifest is a resume; the page passes the manifest it drew. */
  savedProgression = (manifest: ReadingManifest): number | undefined => {
    const state = this.state;
    if (state.phase !== 'ready' || state.manifest !== manifest) return undefined;
    const saved = state.progress?.progress;
    if (!saved || saved.stale || saved.sourceId !== this.item.sourceId || saved.sourceRevision !== manifest.revision) return undefined;
    const progression = saved.location.progression;
    return progression > 0 && progression < 1 ? progression : undefined;
  };
  /** The series relation the page draws: the item's own attribution, otherwise
   * the manifest's declared series in this library. Never a name hash. */
  series = (): SeriesLink | undefined => {
    const declared = this.item.series;
    if (declared && /^[A-Za-z0-9_-]{43}$/.test(declared.id)) return declared;
    const manifest = this.state.manifest?.metadata.series;
    return manifest && manifest.libraryId === this.libraryId && /^[A-Za-z0-9_-]{43}$/.test(manifest.id) && manifest.name ? manifest : undefined;
  };
  /** Read the exact manifest the page rendered, at the exact declared contents
   * entry (or its start). A stale retry or another snapshot cannot be read. */
  read = async (manifest: ReadingManifest, index?: number): Promise<boolean> => {
    const origin = this.origin, life = this.life;
    if (this.opening || !origin || !life || !this.current() || this.state.phase !== 'ready' || this.state.manifest !== manifest) return false;
    if (manifest.itemId !== this.item.id || manifest.sourceId !== this.item.sourceId) return false;
    const contents = manifest.contents;
    if (index !== undefined && (!contents || manifest.format !== 'epub' || !Number.isInteger(index) || index < 0 || index >= Math.min(contents.length, 512))) return false;
    const contentsTarget = index === undefined || !contents ? undefined : Object.freeze({sourceId: manifest.sourceId, sourceRevision: manifest.revision, index});
    this.opening = true;
    try {
      return await openNativeRead(this.context, {itemId: this.item.id, sourceId: this.item.sourceId, ...(contentsTarget ? {contentsTarget} : {})}, life.signal, origin);
    } finally {this.opening = false;}
  };
  openSeries = async (): Promise<boolean> => {
    const series = this.series(), origin = this.origin, life = this.life;
    if (!series || !origin || !life || !this.current()) return false;
    return openNativeReadSeries(this.context, {libraryId: this.libraryId, seriesId: series.id}, origin, life.signal);
  };
  dispose = (): void => {
    if (this.disposed) return;
    this.disposed = true;
    this.release();
    this.listeners.clear();
  };
}
