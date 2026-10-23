import type {Library} from '../../../../../packages/client-core/src';
import {BrowseQueryBuilder, browseCapabilitiesPath, browsePath, parseBrowseCapabilities, parseBrowseResult, type BrowseCapabilities, type BrowseNode, type BrowseSortSelection} from '../../../../../packages/client-core/src/browse';
import {createWindowedCollection, type FetchPage, type WindowedCollection} from '../../../../../packages/client-core/src/collections/windowed';
import {LibraryContentService, type ContentEntry, type ContentScope, type LibraryContentApi, type LibraryContentSnapshot} from '../../../../../packages/client-core/src/library-content';
import {libraryTabs, type LibraryTab, type LibraryTabId} from '../../../../../packages/client-core/src/presentation/library-tabs';

export const nativeLibraryEntryKey = (entry: ContentEntry): string => JSON.stringify([entry.kind, entry.libraryId, entry.id]);
const cancelled = () => Object.assign(new Error('native_library_retired'), {name: 'AbortError'});

export type NativeLibraryMemory = Readonly<{
  firstVisibleId?: string;
  firstVisibleIndex: number;
  offset: number;
}>;
export type NativeLibrarySnapshot = Readonly<{
  library: Library;
  tab: LibraryTab;
  phase: 'idle' | 'loading' | 'ready' | 'error';
  capabilities?: BrowseCapabilities;
  predicates: readonly BrowseNode[];
  sort?: BrowseSortSelection;
  collection?: WindowedCollection<ContentEntry>;
  discover: LibraryContentSnapshot;
  memory: NativeLibraryMemory;
  error?: unknown;
}>;

/** One authorized library in one actual session. This holds sparse native pages,
 * never an array sized by the library's count or a client-filtered catalogue. */
export class NativeLibraryDestination {
  private readonly options: Readonly<{api: LibraryContentApi; scope: ContentScope; library: Library; current: () => boolean}>;
  private readonly discover: LibraryContentService;
  private readonly unsubscribe: () => void;
  private state: NativeLibrarySnapshot;
  private readonly listeners = new Set<() => void>();
  private controller?: AbortController;
  private operation = 0;
  private disposed = false;

  constructor(options: NativeLibraryDestination['options']) {
    this.options = options;
    this.discover = new LibraryContentService({api: {request: this.request}, scope: options.scope});
    const tab = libraryTabs(options.library.kind).find(value => value.id === 'browse') ?? libraryTabs(options.library.kind)[0]!;
    this.state = Object.freeze({library: options.library, tab, phase: 'idle', predicates: [], discover: this.discover.getSnapshot(), memory: {firstVisibleIndex: 0, offset: 0}});
    this.unsubscribe = this.discover.subscribe(() => this.publish({discover: this.discover.getSnapshot()}));
  }
  private current(): boolean {if (!this.disposed && !this.options.current()) this.dispose(); return !this.disposed;}
  private request = async <T>(path: string, method?: string, body?: unknown, signal?: AbortSignal): Promise<T> => {
    if (!this.current() || signal?.aborted) throw cancelled();
    const result = await this.options.api.request<T>(path, method, body, signal);
    if (!this.current() || signal?.aborted) throw cancelled();
    return result;
  };
  getSnapshot = (): NativeLibrarySnapshot => {this.current(); return this.state;};
  subscribe = (listener: () => void): (() => void) => {this.listeners.add(listener); return () => {this.listeners.delete(listener);};};
  private publish(patch: Partial<NativeLibrarySnapshot>): void {
    if (!this.current()) return;
    this.state = Object.freeze({...this.state, ...patch});
    for (const listener of [...this.listeners]) listener();
  }
  load = async (tabId: LibraryTabId = this.state.tab.id): Promise<void> => {
    if (!this.current()) return;
    const tab = libraryTabs(this.options.library.kind).find(value => value.id === tabId);
    if (!tab) throw new Error('native_library_tab_not_offered');
    if (tab.id === this.state.tab.id && this.state.phase === 'ready') return;
    this.controller?.abort(); this.discover.cancel(); this.state.collection?.dispose();
    const controller = new AbortController(), revision = ++this.operation; this.controller = controller;
    this.publish({tab, phase: 'loading', capabilities: undefined, collection: undefined, predicates: [], sort: undefined, error: undefined,
      memory: {firstVisibleIndex: 0, offset: 0}});
    try {
      if (tab.shows === 'rows') {
        await this.discover.select({libraryId: this.options.library.id, view: 'discover'});
        if (!this.current() || revision !== this.operation || controller.signal.aborted) return;
        const snapshot = this.discover.getSnapshot();
        this.publish({phase: snapshot.error ? 'error' : 'ready', error: snapshot.error ?? undefined});
        return;
      }
      if (!tab.pivot) throw new Error('native_library_tab_producer_required');
      const capabilities = parseBrowseCapabilities(await this.request(browseCapabilitiesPath(this.options.library.id, tab.pivot), 'GET', undefined, controller.signal));
      if (revision !== this.operation || controller.signal.aborted) return;
      if (capabilities.library.id !== this.options.library.id || capabilities.library.kind !== this.options.library.kind) throw new Error('native_library_scope_mismatch');
      const pivot = capabilities.pivots.find(value => value.id === tab.pivot && value.browsable);
      if (!pivot) throw new Error('native_library_pivot_unavailable');
      const sort = tab.defaultSort && capabilities.sorts.some(value => value.id === tab.defaultSort!.field && pivot.sorts?.includes(value.id) && value.directions.includes(tab.defaultSort!.direction))
        ? tab.defaultSort : pivot.defaultSort[0];
      if (!sort) throw new Error('native_library_sort_required');
      const predicates = (tab.fixedFilter ?? []).map(value => ({...value})) as readonly BrowseNode[];
      // The canonical builder validates every predicate, direction and request bound.
      this.build(capabilities, tab, predicates, sort, 0, 1);
      const collection = createWindowedCollection({fetchPage: this.pages(capabilities, tab, predicates, sort),
        pageSize: Math.min(60, capabilities.queryLimits.maximumLimit), maxResidentPages: 4, prefetchPages: 1, maxConcurrent: 1, keyOf: nativeLibraryEntryKey});
      this.publish({phase: 'ready', capabilities, predicates, sort, collection});
      collection.ensureRange(0, 0);
    } catch (error) {if (this.current() && revision === this.operation && !controller.signal.aborted) this.publish({phase: 'error', error});}
  };
  private build(capabilities: BrowseCapabilities, tab: LibraryTab, predicates: readonly BrowseNode[], sort: BrowseSortSelection, start: number, count: number, revision?: string) {
    const builder = new BrowseQueryBuilder(capabilities, tab.pivot);
    for (const node of predicates) builder.add(node);
    return builder.sort(sort.field, sort.direction, sort.seed).limit(count).range({start, ...(revision ? {revision} : {})}).build();
  }
  private pages(capabilities: BrowseCapabilities, tab: LibraryTab, predicates: readonly BrowseNode[], sort: BrowseSortSelection): FetchPage<ContentEntry> {
    let revision: string | undefined;
    return async (start, count, signal) => {
      const read = async () => parseBrowseResult(await this.request(browsePath(this.options.library.id), 'POST', this.build(capabilities, tab, predicates, sort, start, count, revision), signal));
      let result;
      try {result = await read();}
      catch (error) {
        if ((error as {code?: unknown})?.code !== 'stale_continuation' || !revision || signal.aborted) throw error;
        revision = undefined; result = await read();
      }
      if (result.pivot !== tab.pivot || result.pageInfo.start !== start || result.entries.length > count) throw new Error('native_library_page_mismatch');
      revision ??= result.pageInfo.revision || undefined;
      return {items: result.entries, total: result.pageInfo.total, totalIsLowerBound: result.pageInfo.totalIsLowerBound,
        positionIndex: Object.fromEntries(result.positionIndex.map(value => [value.key, value.index]))};
    };
  }
  setQuery = (predicates: readonly BrowseNode[], sort = this.state.sort): void => {
    if (!this.current() || !this.state.capabilities || !this.state.collection || !sort) return;
    const {capabilities, tab, collection} = this.state;
    this.build(capabilities, tab, predicates, sort, 0, 1);
    collection.invalidate(this.pages(capabilities, tab, predicates, sort));
    this.publish({predicates: Object.freeze([...predicates]), sort, memory: {firstVisibleIndex: 0, offset: 0}});
  };
  setQuick = (id: string, enabled: boolean): void => {
    const preset = this.state.capabilities?.quickFilters.find(value => value.id === id);
    if (!preset) throw new Error('native_library_quick_not_offered');
    const same = (node: BrowseNode) => JSON.stringify(node) === JSON.stringify(preset.query);
    this.setQuery([...this.state.predicates.filter(node => !same(node)), ...(enabled ? [preset.query] : [])]);
  };
  remember = (firstVisibleIndex: number, offset: number): void => {
    if (!this.current() || !Number.isSafeInteger(firstVisibleIndex) || firstVisibleIndex < 0 || !Number.isFinite(offset) || offset < 0) return;
    const first = this.state.collection?.itemAt(firstVisibleIndex);
    const firstVisibleId = first && nativeLibraryEntryKey(first), before = this.state.memory;
    if (before.firstVisibleIndex === firstVisibleIndex && before.offset === offset && before.firstVisibleId === firstVisibleId) return;
    this.publish({memory: {firstVisibleIndex, offset, ...(firstVisibleId ? {firstVisibleId} : {})}});
  };
  retry = (): void => {if (this.state.phase === 'error') void this.load(); else this.state.collection?.retry();};
  dispose = (): void => {
    if (this.disposed) return;
    this.disposed = true; this.operation++; this.controller?.abort(); this.unsubscribe();
    this.discover.cancel(); this.discover.dispose(); this.state.collection?.dispose();
    this.state = Object.freeze({...this.state, phase: 'idle', capabilities: undefined, collection: undefined, predicates: [], sort: undefined,
      discover: this.discover.getSnapshot(), memory: {firstVisibleIndex: 0, offset: 0}, error: undefined});
    this.listeners.clear();
  };
}
