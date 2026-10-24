import {LibraryManagementService, type LibraryManagementSnapshot, type ManagedLibrary} from '../../../../../../packages/client-core/src/library-management';
import {fetchEpisodeIssues, type EpisodeIssue} from '../../../../../../packages/client-core/src/library-management';
import {LibraryInventoryService, type InventoryConfig, type SourceSettings} from '../../../../../../packages/client-core/src/library-inventory';
import {readLibrarySettings, reorderLibraries, saveLibrarySettings} from '../../../../../../packages/client-core/src/server-admin/libraries';
import {readScanIssues, type ScanIssues} from '../../../../../../packages/client-core/src/scan-issues';
import {removeLibrary} from '../../../../../../packages/client-core/src/title-identity';
import {metadataAgentPath, parseMetadataAgent, saveMetadataAgent, type LibraryMetadataAgent} from '../../../../../../packages/client-core/src/server-admin/metadata-agent';
import type {LibraryAdminDocument, LibrarySettings} from '../../../../../../packages/client-core/src/administration';
import type {ContentScope, LibraryContentApi} from '../../../../../../packages/client-core/src/library-content';

export type NativeOwnerLibrariesSnapshot = Readonly<{
  directory: LibraryManagementSnapshot['directory'];
  selectedId?: string;
  selected: LibraryManagementSnapshot['selected'];
  document?: LibraryAdminDocument;
  inventory?: InventoryConfig;
  metadata?: LibraryMetadataAgent;
  detail: 'idle' | 'loading' | 'ready' | 'error';
  detailError?: unknown;
  skipped?: ScanIssues;
  skippedError?: unknown;
  skippedLoading: boolean;
  unmatched: readonly EpisodeIssue[];
  unmatchedCursor: string;
  unmatchedLoading: boolean;
  unmatchedError?: unknown;
  busy: boolean;
  saved: number;
  error?: unknown;
}>;

const blankDirectory: LibraryManagementSnapshot['directory'] = {phase: 'idle', data: null, error: null, cursor: null, canPrevious: false};
const blankSelected: LibraryManagementSnapshot['selected'] = {phase: 'idle', data: null, error: null, cursor: null, canPrevious: false};
const empty: NativeOwnerLibrariesSnapshot = {directory: blankDirectory, selected: blankSelected, detail: 'idle', skippedLoading: false,
  unmatched: Object.freeze([]), unmatchedCursor: '', unmatchedLoading: false, busy: false, saved: 0};

/** Real owner library administration for the phone page: the same services and routes the
 * web console uses, with the screen's own lifetime. No optimistic rows and no replayed commands. */
export class NativeOwnerLibrariesController {
  private management: LibraryManagementService;
  private inventory?: LibraryInventoryService;
  private api: LibraryContentApi;
  private scope: ContentScope;
  private state: NativeOwnerLibrariesSnapshot = empty;
  private listeners = new Set<() => void>();
  private disposed = false;
  private generation = 0;
  private unsubscribe?: () => void;
  private unsubscribeInventory?: () => void;
  private requestId: () => string;

  constructor(api: LibraryContentApi, scope: ContentScope, requestId: () => string) {
    this.api = api; this.scope = scope; this.requestId = requestId;
    this.management = new LibraryManagementService({api, scope});
    this.unsubscribe = this.management.subscribe(() => this.accept());
  }

  getSnapshot = (): NativeOwnerLibrariesSnapshot => this.state;
  subscribe = (listener: () => void) => {this.listeners.add(listener); return () => {this.listeners.delete(listener);};};

  private publish(patch: Partial<NativeOwnerLibrariesSnapshot>) {
    if (this.disposed) return;
    this.state = Object.freeze({...this.state, ...patch});
    for (const listener of [...this.listeners]) listener();
  }

  private accept() {
    if (this.disposed) return;
    const snapshot = this.management.getSnapshot();
    this.publish({directory: snapshot.directory, selected: snapshot.selected, ...(snapshot.selectedLibraryId ? {selectedId: snapshot.selectedLibraryId} : {})});
  }

  dispose() {
    if (this.disposed) return;
    this.disposed = true;
    this.unsubscribe?.(); this.unsubscribeInventory?.();
    this.inventory?.dispose(); this.management.dispose(); this.listeners.clear();
  }

  private command<T>(work: () => Promise<T>): Promise<T | undefined> {
    if (this.disposed) return Promise.resolve(undefined);
    this.publish({busy: true, error: undefined});
    return work().catch(error => {this.publish({error}); return undefined;}).finally(() => {this.publish({busy: false});});
  }

  async refresh(): Promise<void> {
    if (this.disposed) return;
    try {await this.management.loadLibraries();}
    catch (error) {if (!this.disposed) this.publish({error});}
    const id = this.state.selectedId;
    if (!this.disposed && id) await this.load(id);
  }

  /** Opens one library: its settings document, folders, skipped files and unmatched items. */
  async load(libraryId: string): Promise<void> {
    if (this.disposed) return;
    const generation = ++this.generation;
    this.inventory?.dispose(); this.unsubscribeInventory?.();
    const inventory = new LibraryInventoryService({api: this.api, scope: this.scope, libraryId});
    this.inventory = inventory; this.unsubscribeInventory = inventory.subscribe(() => this.acceptInventory(generation));
    this.publish({selectedId: libraryId, detail: 'loading', detailError: undefined, skipped: undefined, skippedError: undefined, unmatched: Object.freeze([]), unmatchedCursor: ''});
    try {
      await this.management.selectLibrary(libraryId);
      if (this.disposed || generation !== this.generation) return;
      const [document, , , metadata] = await Promise.all([readLibrarySettings(this.api, libraryId), inventory.refresh().catch(() => {}), this.loadUnmatched(libraryId, '', generation),
        this.api.request<unknown>(metadataAgentPath(libraryId)).then(parseMetadataAgent, () => undefined)]);
      if (this.disposed || generation !== this.generation) return;
      this.publish({document, metadata, detail: 'ready'});
      await this.loadSkipped(document, generation);
    } catch (error) {
      if (!this.disposed && generation === this.generation) this.publish({detail: 'error', detailError: error});
    }
  }

  private acceptInventory(generation: number) {
    if (this.disposed || generation !== this.generation || !this.inventory) return;
    this.publish({inventory: this.inventory.getSnapshot().config ?? undefined});
  }

  /** The last finished scan's own diagnostics, narrowed by the screen to files Portico cannot play. */
  private async loadSkipped(document: LibraryAdminDocument, generation: number): Promise<void> {
    const job = this.management.getSnapshot().selected.data?.library.lastScan;
    if (!job?.id) {this.publish({skipped: undefined}); return;}
    this.publish({skippedLoading: true, skippedError: undefined});
    try {
      const page = await readScanIssues(this.api, document.libraryId, job.id);
      if (this.disposed || generation !== this.generation) return;
      this.publish({skipped: page, skippedLoading: false});
    } catch (error) {
      if (!this.disposed && generation === this.generation) this.publish({skippedError: error, skippedLoading: false});
    }
  }

  async loadSkippedMore(): Promise<void> {
    const current = this.state.skipped, job = this.management.getSnapshot().selected.data?.library.lastScan;
    if (!current?.hasMore || !job?.id || this.state.skippedLoading) return;
    const generation = this.generation;
    this.publish({skippedLoading: true});
    try {
      const next = await readScanIssues(this.api, this.state.selectedId ?? '', job.id, current.nextSequence);
      if (this.disposed || generation !== this.generation) return;
      this.publish({skipped: Object.freeze({...next, items: Object.freeze([...current.items, ...next.items])}), skippedLoading: false});
    } catch (error) {
      if (!this.disposed && generation === this.generation) this.publish({skippedError: error, skippedLoading: false});
    }
  }

  private async loadUnmatched(libraryId: string, cursor: string, generation: number): Promise<void> {
    this.publish({unmatchedLoading: true, unmatchedError: undefined});
    try {
      const page = await fetchEpisodeIssues(this.api, libraryId, cursor);
      if (this.disposed || generation !== this.generation) return;
      this.publish({unmatched: Object.freeze([...this.state.unmatched, ...page.issues]), unmatchedCursor: page.nextCursor, unmatchedLoading: false});
    } catch (error) {
      if (!this.disposed && generation === this.generation) this.publish({unmatchedError: error, unmatchedLoading: false});
    }
  }

  async loadUnmatchedMore(): Promise<void> {
    const libraryId = this.state.selectedId, cursor = this.state.unmatchedCursor;
    if (!libraryId || !cursor || this.state.unmatchedLoading) return;
    await this.loadUnmatched(libraryId, cursor, this.generation);
  }

  scanNow(): Promise<void | undefined> {return this.command(() => this.management.scan());}

  /** A scan started from the list: select the library the server must scan first. */
  async scanLibrary(libraryId: string): Promise<void> {
    const done = await this.command(() => this.management.selectLibrary(libraryId).then(() => this.management.scan()));
    if (done !== undefined) await this.refresh();
  }

  scanAll(): Promise<void | undefined> {return this.command(() => this.management.scan('full'));}

  /** Creates the library from the real form, then opens it so its first scan is visible in place. */
  async create(input: Readonly<{name: string; kind: ManagedLibrary['kind']; folders: readonly string[]; metadataAgent?: 'online' | 'local'; metadataLanguage?: string}>): Promise<string | undefined> {
    const done = await this.command(async () => {await this.management.createLibrary(input); return this.management.getSnapshot().selectedLibraryId ?? undefined;});
    if (done) {await this.refresh(); await this.load(done);}
    return done ?? undefined;
  }

  cancelScan(): Promise<void | undefined> {
    const job = this.state.selected.data?.library.lastScan;
    return job ? this.command(() => this.management.cancelJob(job.id)) : Promise.resolve(undefined);
  }

  rename(name: string): Promise<void | undefined> {
    const library = this.state.selected.data?.library;
    return library ? this.command(() => this.management.rename(name, library.revision)) : Promise.resolve(undefined);
  }

  async remove(confirmation: string): Promise<boolean> {
    const library = this.state.selected.data?.library;
    if (!library) return false;
    const done = await this.command(() => removeLibrary(this.api, library.id, confirmation, library.revision).then(() => true));
    if (done) {this.publish({selectedId: undefined, document: undefined, detail: 'idle'}); await this.refresh();}
    return done === true;
  }

  /** One save of the library's own settings document; the whole document goes back with its revision. */
  async save(patch: Partial<LibrarySettings>): Promise<boolean> {
    const document = this.state.document;
    if (!document) return false;
    const next = Object.freeze({...document.settings, ...patch});
    const done = await this.command(() => saveLibrarySettings(this.api, document, next, this.requestId()).then(value => {this.publish({document: value, saved: this.state.saved + 1}); return true;}));
    return done === true;
  }

  /** The metadata source is its own resource with its own revision; a conflict re-reads rather than retries blind. */
  async saveAgent(agent: string): Promise<boolean> {
    const current = this.state.metadata;
    if (!current) return false;
    const request = <T,>(path: string, method?: string, body?: unknown) => this.api.request<T>(path, method, body);
    const done = await this.command(() => saveMetadataAgent(request, current, current.libraryId, agent).then(value => {this.publish({metadata: value, saved: this.state.saved + 1}); return true;}));
    if (done !== true) await this.reloadAgent();
    return done === true;
  }

  private async reloadAgent(): Promise<void> {
    const id = this.state.selectedId;
    if (!id) return;
    try {const metadata = parseMetadataAgent(await this.api.request<unknown>(metadataAgentPath(id))); this.publish({metadata});}
    catch (error) {this.publish({error});}
  }

  async saveFolder(sourceId: string | undefined, input: SourceSettings): Promise<boolean> {
    const inventory = this.inventory;
    if (!inventory) return false;
    const done = await this.command(() => inventory.saveSource(sourceId, input).then(value => value));
    return done === true;
  }

  async removeFolder(sourceId: string): Promise<boolean> {
    const revision = this.state.inventory?.revision;
    if (!revision) return false;
    const inventory = this.inventory;
    const done = await this.command(() => inventory ? inventory.removeSource(sourceId, revision) : Promise.resolve(false));
    return done === true;
  }

  /** The owner's order is one server command; dragging is not drawn on the phone, the menu moves. */
  async move(libraryId: string, by: -1 | 1): Promise<boolean> {
    const ids = this.libraries().map(library => library.id), from = ids.indexOf(libraryId), to = from + by;
    if (from < 0 || to < 0 || to >= ids.length) return false;
    const next = [...ids]; const [moved] = next.splice(from, 1); next.splice(to, 0, moved!);
    const done = await this.command(() => reorderLibraries(this.api, next).then(() => true));
    if (done) await this.refresh();
    return done === true;
  }

  async scanFolder(sourceId: string): Promise<boolean> {
    const inventory = this.inventory;
    const done = await this.command(() => inventory ? inventory.scanSource(sourceId) : Promise.resolve(false));
    return done === true;
  }

  async checkFolder(sourceId: string): Promise<boolean> {
    const inventory = this.inventory;
    const done = await this.command(() => inventory ? inventory.checkSource(sourceId) : Promise.resolve(false));
    return done === true;
  }

  /** The visible list, in the server's order: the directory page carries it already. */
  libraries(): readonly ManagedLibrary[] {return this.state.directory.data?.items ?? [];}
}
