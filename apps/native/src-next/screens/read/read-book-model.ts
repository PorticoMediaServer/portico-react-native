import type {RefObject} from 'react';
import type {View} from 'react-native';
import {ReadingError, type LocalSession, type ReadingClient, type ReadingItem, type ReadingListMembership, type ReadingManifest, type ReadingProgress, type ReadingReadMark} from '../../../../../packages/client-core/src';
import type {NativeShellBootstrapContext} from '../../shell/bootstrap';
import type {NativeShellRoute} from '../../shell/routes';
import {sameAuthority, type ShellAuthority} from '../../shell/model';
import {nativeRouteCrypto} from '../../platform/server-connections';
import {presentError} from '../../../../../packages/client-core/src/presentation/errors';
import {askNativeDownload} from '../downloads/request';
import {nativeReadOrigin, openNativeRead, openNativeReadBook, openNativeReadPeriodical, openNativeReadSeries, type NativeReadOrigin} from './eligibility';

export type NativeReadVersion = Awaited<ReturnType<ReadingClient['versions']>>['versions'][number];
export type NativeReadBookState = Readonly<{
  phase: 'idle' | 'loading' | 'ready' | 'error';
  /** Every real version the item producer returned, chosen or not. */
  versions: readonly NativeReadVersion[];
  /** The selected version the manifest, progress and contents belong to. */
  sourceId?: string;
  manifest?: ReadingManifest;
  progress?: ReadingProgress;
  /** This viewer's real My List membership, when the producer offers it. */
  listed?: ReadingListMembership;
  /** This viewer's real read mark, when the producer offers it. */
  read?: ReadingReadMark;
  error?: unknown;
}>;
type BookRoute = Extract<NativeShellRoute, {kind: 'read-book'}>;
type SeriesLink = Readonly<{id: string; name: string; number?: number}>;
/** The rest of this page's series, read from the same signed series producer the
 * series page uses. One cursor and one revision witness, never a count: a page
 * only says what it actually listed. */
export type NativeReadSeriesShelfState = Readonly<{
  phase: 'idle' | 'loading' | 'ready' | 'error';
  items: readonly ReadingItem[];
  nextCursor?: string;
  error?: unknown;
  /** A later page failed; the volumes already drawn stay. */
  moreError?: unknown;
  /** The opaque witness of the page this render drew. Handlers present it. */
  witness: NativeReadSeriesShelfWitness;
}>;
/** Opaque, immutable witness of one published shelf page: the manifest, the exact
 * series object, the items and the cursor a handler was rendered with. Callers
 * cannot rebuild it; an older one is simply no longer held. */
export type NativeReadSeriesShelfWitness = Readonly<{readonly shelf: true}>;
type SeriesShelfData = Readonly<{
  manifest: ReadingManifest;
  series: SeriesLink;
  items: readonly ReadingItem[];
  nextCursor?: string;
  /** Every id+sourceId position this shelf accepted, so a repeat is refused. */
  seen: readonly string[];
  /** Every cursor this shelf already requested, so A->B->A cannot loop. */
  cursors: readonly string[];
  /** The exact failed continuation this witness may retry, with its own cursor. */
  failed?: Readonly<{cursor: string; error: unknown}>;
  /** Set when this witness is the failed initial page of this manifest and series. */
  initialFailure?: unknown;
}>;
/** The committed page a sheet was opened from: exact route/revision, session
 * family, viewer and authority, plus that page's own lifetime signal. */
export type NativeReadOwnerEditLease = Readonly<{
  origin: NativeReadOrigin; sessionFamilyId: string; viewer: LocalSession['viewer']; authority: ShellAuthority;
  signal: AbortSignal; isCurrent: () => boolean;
  /** This page's own state publications, so a version/loading change retires the sheet. */
  subscribe: (listener: () => void) => () => void;
}>;

const EMPTY_SHELF_WITNESS: NativeReadSeriesShelfWitness = Object.freeze({shelf: true as const});
const refused = () => Object.assign(new Error('native_read_book_refused'), {name: 'AbortError', code: 'cancelled'});
const cancelled = (error: unknown): boolean => error instanceof ReadingError && error.code === 'cancelled' && error.status === undefined;
/** Only positively known transport/busy failures may keep a loaded shelf page. */
const position = (item: ReadingItem): string => `${item.id}:${item.sourceId}`;
const transientShelf = (error: unknown): boolean => {
  try {
    const category = presentError(error, 'library').category;
    return category === 'offline' || category === 'unreachable' || category === 'timeout' || category === 'busy';
  } catch {return false;}
};
const nextOperationId = (): string => Array.from(nativeRouteCrypto.random(16), byte => byte.toString(16).padStart(2, '0')).join('');

/** The real book page's own projection: the selected version's manifest, saved
 * position and declared contents from one preview session that is closed before
 * the page becomes ready. Choosing another real available version reloads the
 * same projection for that source. The page opens no reader host; its Read
 * action reuses the one openNativeRead door with the manifest it actually drew. */
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
  private state: NativeReadBookState = Object.freeze({phase: 'idle', versions: []});
  /** The version this page last selected; the item's own source until then. */
  private selected?: string;
  private readonly listeners = new Set<() => void>();
  private flight = 0;
  /** The one page command (Read or series) this mounted page may run. */
  private command?: object;
  private shelfState: NativeReadSeriesShelfState = Object.freeze({phase: 'idle', items: [], witness: EMPTY_SHELF_WITNESS});
  private shelfWitness?: NativeReadSeriesShelfWitness;
  private shelfData?: SeriesShelfData;
  private readonly shelfListeners = new Set<() => void>();
  private shelfFlight = 0;
  private shelfTicket?: object;
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
    this.state = Object.freeze({phase: 'idle', versions: []});
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
    // The drawn shelf is reset through the same retirement, so a released page
    // never keeps a ready projection whose witness has already been dropped.
    this.retireShelf();
    this.life?.abort();
    this.client?.dispose();
    this.client = undefined; this.life = undefined;
    this.command = undefined;
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
  subscribeShelf = (listener: () => void): (() => void) => {
    if (this.disposed) return () => {};
    this.shelfListeners.add(listener);
    return () => {this.shelfListeners.delete(listener);};
  };
  shelfSnapshot = (): NativeReadSeriesShelfState => this.shelfState;
  private emitShelf(): void {for (const listener of [...this.shelfListeners]) listener();}
  /** A reset or release retires this shelf permanently: its witness is dropped, so
   * every handler the old page rendered is refused from here on. */
  private retireShelf(): void {
    this.shelfFlight++;
    this.shelfTicket = undefined;
    this.shelfWitness = undefined;
    this.shelfData = undefined;
    this.shelfState = Object.freeze({phase: 'idle', items: [], witness: EMPTY_SHELF_WITNESS});
    this.emitShelf();
  }
  private publishShelf(next: Omit<NativeReadSeriesShelfState, 'witness'>, data: SeriesShelfData | undefined): void {
    if (this.disposed || !this.current()) return;
    const witness: NativeReadSeriesShelfWitness = Object.freeze({shelf: true as const});
    this.shelfWitness = witness;
    this.shelfData = data;
    this.shelfState = Object.freeze({...next, witness});
    this.emitShelf();
  }
  /** A handler may act only for the exact witness it drew, for the exact manifest
   * this page published, while this page is still the current route. */
  private shelfAuthority(witness: NativeReadSeriesShelfWitness | undefined, manifest: ReadingManifest): SeriesShelfData | undefined {
    if (!witness || witness !== this.shelfWitness || !this.shelfData) return undefined;
    if (this.shelfData.manifest !== manifest || this.state.manifest !== manifest) return undefined;
    return this.current() ? this.shelfData : undefined;
  }
  /** The series this page draws, so a caller can tell whether a shelf exists. */
  shelfSeries = (): SeriesLink | undefined => this.series();
  /** One canonical series page for the manifest and series object this render drew.
   * The current book is excluded by its exact item id only. */
  loadSeriesShelf = async (manifest: ReadingManifest, series: SeriesLink): Promise<void> => {
    if (!this.current() || this.state.phase !== 'ready' || this.state.manifest !== manifest || this.series() !== series) return;
    const flight = ++this.shelfFlight;
    this.shelfTicket = undefined;
    this.shelfWitness = undefined;
    this.shelfData = undefined;
    this.publishShelf({phase: 'loading', items: []}, undefined);
    try {
      const client = this.reading(), signal = this.life!.signal;
      const page = await client.series(this.libraryId, series.id, {limit: 30}, signal);
      if (flight !== this.shelfFlight || !this.current() || this.state.manifest !== manifest) return;
      const items = Object.freeze(page.items.filter(item => item.id !== this.item.id));
      this.publishShelf({phase: 'ready', items, ...(page.nextCursor ? {nextCursor: page.nextCursor} : {})},
        Object.freeze({manifest, series, items, seen: Object.freeze(items.map(position)), cursors: Object.freeze([]),
          ...(page.nextCursor ? {nextCursor: page.nextCursor} : {})}));
    } catch (error) {
      if (flight !== this.shelfFlight || !this.current() || cancelled(error)) return;
      // The failed page keeps its own witness and request, so only a Retry drawn
      // from this failure can ask for it again.
      this.publishShelf({phase: 'error', items: [], error}, Object.freeze({manifest, series, items: Object.freeze([]),
        seen: Object.freeze([]), cursors: Object.freeze([]), initialFailure: error}));
    }
  };
  /** Continuation for the exact published page that asked for it. Only positively
   * known transport/busy failures keep the loaded volumes and cursor; every other
   * failure retires the shelf data and cursor. A cursor already requested by this
   * witness, or a page with no new position, is refused rather than faking the end. */
  moreSeriesShelf = async (witness: NativeReadSeriesShelfWitness, manifest: ReadingManifest): Promise<void> => {
    const data = this.shelfAuthority(witness, manifest);
    if (!data || !data.nextCursor || data.failed || this.shelfTicket || this.shelfState.phase !== 'ready') return;
    await this.requestShelfPage(data, data.nextCursor);
  };
  /** Retry is bound to the failed request this witness holds: its own initial page,
   * or its own failed continuation cursor. A retained Retry from another page is
   * refused, so it can never reset a newer ready shelf. */
  retrySeriesShelf = async (witness: NativeReadSeriesShelfWitness, manifest: ReadingManifest): Promise<void> => {
    const data = this.shelfAuthority(witness, manifest);
    if (!data || this.shelfTicket) return;
    if (data.initialFailure !== undefined) {
      if (this.state.phase !== 'ready' || this.state.manifest !== manifest) return;
      await this.loadSeriesShelf(manifest, data.series);
      return;
    }
    if (!data.failed || this.shelfState.phase !== 'ready') return;
    await this.requestShelfPage(data, data.failed.cursor);
  };
  private requestShelfPage = async (data: SeriesShelfData, cursor: string): Promise<void> => {
    // One request for this exact witness; a cursor this witness already asked for is
    // never requested again, so A->B->A cannot loop.
    if (data.cursors.includes(cursor)) return;
    const manifest = data.manifest, series = data.series, flight = this.shelfFlight, ticket = {};
    const started: SeriesShelfData = Object.freeze({...data, failed: undefined, cursors: Object.freeze([...data.cursors, cursor])});
    this.shelfTicket = ticket;
    this.publishShelf({...this.shelfState, phase: 'ready', moreError: undefined}, started);
    // A refused or drifted continuation retires the drawn items and cursor, but the
    // failure keeps its own witness so an explicit Retry is a real new first page.
    const refuse = (code: string): void => {
      const error = Object.assign(new Error(code), {code});
      this.publishShelf({phase: 'error', items: [], error},
        Object.freeze({manifest, series, items: Object.freeze([]), seen: Object.freeze([]), cursors: Object.freeze([]), initialFailure: error}));
    };
    try {
      const client = this.reading(), signal = this.life!.signal;
      const page = await client.series(this.libraryId, series.id, {cursor, limit: 30}, signal);
      if (flight !== this.shelfFlight || !this.current() || this.state.manifest !== manifest) return;
      if (this.shelfData?.cursors.at(-1) !== cursor) return;
      const next = page.nextCursor;
      if (next !== undefined && started.cursors.includes(next)) {refuse('native_read_series_shelf_cursor'); return;}
      const seen = new Set(started.seen);
      const fresh = page.items.filter(item => item.id !== this.item.id && !seen.has(position(item)));
      if (!fresh.length) {refuse('native_read_series_shelf_cursor'); return;}
      const items = Object.freeze([...started.items, ...fresh]);
      this.publishShelf({phase: 'ready', items, ...(next ? {nextCursor: next} : {})},
        Object.freeze({manifest, series, items, seen: Object.freeze([...started.seen, ...fresh.map(position)]),
          cursors: started.cursors, ...(next ? {nextCursor: next} : {})}));
    } catch (error) {
      if (flight !== this.shelfFlight || !this.current() || cancelled(error)) return;
      if (transientShelf(error)) {
        // The exact failed cursor and error travel in the witness data too, so the
        // Retry drawn from this state can actually re-request that same cursor.
        this.publishShelf({...this.shelfState, phase: 'ready', moreError: error},
          Object.freeze({...started, failed: Object.freeze({cursor, error})}));
        return;
      }
      this.publishShelf({phase: 'error', items: [], error},
        Object.freeze({manifest, series, items: Object.freeze([]), seen: Object.freeze([]), cursors: Object.freeze([]), initialFailure: error}));
    } finally {if (this.shelfTicket === ticket) this.shelfTicket = undefined;}
  };
  /** Only a volume this exact shelf page listed, with available inventory, opens,
   * through the ordinary book door and this page's own captured origin. */
  openSeriesItem = async (witness: NativeReadSeriesShelfWitness, manifest: ReadingManifest, item: ReadingItem): Promise<boolean> => {
    const data = this.shelfAuthority(witness, manifest), origin = this.origin, life = this.life;
    if (!data || !origin || !life || this.command || item.inventoryAvailable !== true) return false;
    // The exact offered object this witness listed, so a substituted clone cannot
    // change the availability fact that was drawn.
    if (!data.items.includes(item)) return false;
    const ticket = {};
    this.command = ticket;
    try {return await openNativeReadBook(this.context, {libraryId: this.libraryId, item}, origin, life.signal);}
    finally {if (this.command === ticket) this.command = undefined;}
  };
  /** One private flight per load. A retry supersedes it, and only that flight's
   * exact manifest and progress may publish after its preview session closed. */
  load = async (): Promise<void> => {
    if (!this.current()) return;
    const flight = ++this.flight;
    this.publish({phase: 'loading', versions: this.state.versions, ...(this.selected ? {sourceId: this.selected} : {})});
    try {
      const client = this.reading(), signal = this.life!.signal;
      const versions = await client.versions(this.item.id, signal);
      if (flight !== this.flight || !this.current()) return;
      // The item's own source opens when it has inventory; otherwise the first
      // real available version does, never a format preference.
      const available = versions.versions.filter(version => version.inventoryAvailable);
      const selected = available.find(version => version.sourceId === (this.selected ?? this.item.sourceId)) ?? available[0];
      if (!selected) throw new ReadingError('source_unavailable');
      const session = await client.open({itemId: this.item.id, sourceId: selected.sourceId}, signal);
      let progress: ReadingProgress | undefined, closeError: unknown;
      try {progress = await session.progress(signal);}
      finally {try {await session.close();} catch (error) {closeError = error;}}
      if (flight !== this.flight || !this.current()) return;
      // A preview that could not be retired must not become a ready page.
      if (closeError) {this.publish({phase: 'error', versions: this.state.versions, error: closeError}); return;}
      if (!progress) return;
      const manifest = session.manifest;
      if (manifest.itemId !== this.item.id || manifest.sourceId !== selected.sourceId) throw new ReadingError('invalid_document');
      // This page's own My List and read mark, when the official producers
      // offer them. A failed read leaves the control hidden, never invented.
      const [listed, read] = await Promise.all([
        client.canUseMyList(this.item.id) ? client.getMyList(this.item.id, signal).catch(() => undefined) : Promise.resolve(undefined),
        client.canMarkRead(this.item.id) ? client.readMark(this.item.id, signal).catch(() => undefined) : Promise.resolve(undefined),
      ]);
      if (flight !== this.flight || !this.current()) return;
      this.selected = selected.sourceId;
      // A new manifest is a new page: the old shelf witness can never authorize again.
      this.retireShelf();
      this.publish({phase: 'ready', versions: versions.versions, sourceId: selected.sourceId, manifest, progress,
        ...(listed ? {listed} : {}), ...(read ? {read} : {})});
    } catch (error) {
      if (flight !== this.flight || !this.current() || cancelled(error)) return;
      this.publish({phase: 'error', versions: this.state.versions, error});
    }
  };
  /** Choosing another real available version reloads this page's exact
   * projection. The picker passes the manifest and version list it rendered, so
   * a retained callback cannot act under a replaced page or a newer flight. */
  selectVersion = async (manifest: ReadingManifest, versions: readonly NativeReadVersion[], sourceId: string): Promise<void> => {
    if (this.command || !this.current() || this.state.phase !== 'ready' || this.state.manifest !== manifest || this.state.versions !== versions) return;
    const version = versions.find(candidate => candidate.sourceId === sourceId);
    if (!version?.inventoryAvailable || sourceId === this.state.sourceId) return;
    this.selected = sourceId;
    await this.load();
  };
  retry = (): Promise<void> => this.load();
  /** Toggle the exact rendered My List membership. A retained menu cannot act
   * under a newer ready state or a replaced page. */
  toggleList = async (membership: ReadingListMembership): Promise<boolean> => {
    const origin = this.origin, life = this.life;
    if (this.command || !origin || !life || !this.current() || this.state.phase !== 'ready' || this.state.listed !== membership) return false;
    const ticket = {};
    this.command = ticket;
    try {
      const next = await this.reading().setMyList(this.item.id, {operationId: nextOperationId(), expectedRevision: membership.revision, listed: !membership.listed}, life.signal);
      if (this.life !== life || this.command !== ticket || !this.current() || this.state.phase !== 'ready' || this.state.listed !== membership) return false;
      this.publish({...this.state, listed: next});
      return true;
    } finally {if (this.command === ticket) this.command = undefined;}
  };
  /** Toggle the exact rendered read mark, with the same retention rule. */
  toggleRead = async (mark: ReadingReadMark): Promise<boolean> => {
    const origin = this.origin, life = this.life;
    if (this.command || !origin || !life || !this.current() || this.state.phase !== 'ready' || this.state.read !== mark) return false;
    const ticket = {};
    this.command = ticket;
    try {
      const next = await this.reading().setReadMark(this.item.id, {operationId: nextOperationId(), expectedRevision: mark.revision, read: !mark.read}, life.signal);
      if (this.life !== life || this.command !== ticket || !this.current() || this.state.phase !== 'ready' || this.state.read !== mark) return false;
      this.publish({...this.state, read: next});
      return true;
    } finally {if (this.command === ticket) this.command = undefined;}
  };
  /** Raise the real download intent only from this page's exact rendered
   * manifest and lifetime; a retained button cannot take a successor's sheet. */
  download = (manifest: ReadingManifest, anchorRef: RefObject<View | null>): boolean => {
    const origin = this.origin, life = this.life;
    if (!origin || !life || !this.current() || this.state.phase !== 'ready' || this.state.manifest !== manifest) return false;
    if (manifest.itemId !== this.item.id || manifest.sourceId !== this.state.sourceId) return false;
    askNativeDownload({
      title: manifest.metadata.title || this.item.title, itemId: this.item.id, reading: true, anchorRef,
      lifetime: Object.freeze({signal: life.signal, isCurrent: () => this.life === life && this.current()}),
    });
    return true;
  };
  /** Only a saved position for this exact source revision of the rendered
   * manifest is a resume; the page passes the manifest it drew. */
  savedProgression = (manifest: ReadingManifest): number | undefined => {
    const state = this.state;
    if (state.phase !== 'ready' || state.manifest !== manifest) return undefined;
    const saved = state.progress?.progress;
    if (!saved || saved.stale || saved.sourceId !== manifest.sourceId || saved.sourceRevision !== manifest.revision) return undefined;
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
    if (this.command || !origin || !life || !this.current() || this.state.phase !== 'ready' || this.state.manifest !== manifest) return false;
    if (manifest.itemId !== this.item.id || manifest.sourceId !== this.state.sourceId) return false;
    const contents = manifest.contents;
    if (index !== undefined && (!contents || manifest.format !== 'epub' || !Number.isInteger(index) || index < 0 || index >= Math.min(contents.length, 512))) return false;
    const contentsTarget = index === undefined || !contents ? undefined : Object.freeze({sourceId: manifest.sourceId, sourceRevision: manifest.revision, index});
    const ticket = {};
    this.command = ticket;
    try {
      return await openNativeRead(this.context, {itemId: this.item.id, sourceId: manifest.sourceId, ...(contentsTarget ? {contentsTarget} : {})}, life.signal, origin);
    } finally {if (this.command === ticket) this.command = undefined;}
  };
  /** The committed page a sheet may be opened from. Nothing later is adopted. */
  /** The committed ready page a sheet may be opened from, for this exact
   * rendered manifest. Nothing later is adopted. */
  ownerEditLease = (manifest: ReadingManifest): NativeReadOwnerEditLease | undefined => {
    const origin = this.origin, life = this.life, captured = this.captured, authority = this.authority;
    if (!origin || !life || !captured || !authority || !this.current() || this.state.phase !== 'ready' || this.state.manifest !== manifest) return undefined;
    return Object.freeze({
      origin, sessionFamilyId: captured.sessionFamilyId, viewer: captured.viewer, authority, signal: life.signal,
      isCurrent: () => this.life === life && this.current() && this.state.phase === 'ready' && this.state.manifest === manifest,
      subscribe: this.subscribe,
    });
  };
  /** Open the series the page actually drew for the manifest it actually drew.
   * The latest state is never substituted for a retained render. */
  openSeries = async (series: SeriesLink, manifest: ReadingManifest): Promise<boolean> => {
    const origin = this.origin, life = this.life;
    if (this.command || !origin || !life || !this.current() || this.state.phase !== 'ready' || this.state.manifest !== manifest) return false;
    const declared = this.item.series, fromManifest = manifest.metadata.series;
    if (series !== declared && series !== fromManifest) return false;
    if (series === fromManifest && (fromManifest.libraryId !== this.libraryId || !fromManifest.name)) return false;
    if (!/^[A-Za-z0-9_-]{43}$/.test(series.id)) return false;
    const ticket = {};
    this.command = ticket;
    try {
      const periodical = this.item.publicationType?.value;
      if (periodical === 'magazine' || periodical === 'newspaper')
        return await openNativeReadPeriodical(this.context, {libraryId: this.libraryId, groupId: series.id, publicationType: periodical}, origin, life.signal);
      return await openNativeReadSeries(this.context, {libraryId: this.libraryId, seriesId: series.id}, origin, life.signal);
    }
    finally {if (this.command === ticket) this.command = undefined;}
  };
  dispose = (): void => {
    if (this.disposed) return;
    this.disposed = true;
    this.release();
    this.listeners.clear();
    this.shelfListeners.clear();
  };
}
