import {
  SearchService, clearSearchHistory, readSearchHistory, searchQueryProblem,
  type SearchEntry, type SearchGroup, type SearchGroupResult, type SearchHistoryEntry, type SearchSnapshot,
} from '../../../../../packages/client-core/src/search';
import type {ContentScope, LibraryContentApi} from '../../../../../packages/client-core/src/library-content';

export const nativeSearchEntryKey = (group: SearchGroup, entry: SearchEntry): string => JSON.stringify([group, entry.kind, entry.id]);

export type NativeSearchSnapshot = Readonly<{
  text: string;
  group: SearchGroup | 'all';
  problem?: ReturnType<typeof searchQueryProblem>;
  search: SearchSnapshot;
  groups: readonly SearchGroupResult[];
  recent: readonly SearchHistoryEntry[];
  clearing: boolean;
}>;

/** One genuine SearchService and its history for one restored viewer lifetime.
 * Search owns its response fence; a Home fence is never substituted for it. */
export class NativeSearchDestination {
  readonly service: SearchService;
  private readonly options: Readonly<{
    api: LibraryContentApi; scope: ContentScope; current: () => boolean;
    rememberHistory: () => boolean; reportError: (error: unknown) => void;
  }>;
  private state: NativeSearchSnapshot;
  private readonly listeners = new Set<() => void>();
  private timer?: ReturnType<typeof setTimeout>;
  private history?: AbortController;
  private historyRevision = 0;
  private readonly unsubscribe: () => void;
  private disposed = false;
  private pageQuery = '';
  private pages = new Map<SearchGroup, SearchGroupResult>();

  constructor(options: NativeSearchDestination['options']) {
    this.options = options;
    this.service = new SearchService({api: options.api, scope: options.scope});
    this.state = Object.freeze({text: '', group: 'all', search: this.service.getSnapshot(), groups: [], recent: [], clearing: false});
    this.unsubscribe = this.service.subscribe(this.changed);
  }
  getSnapshot = (): NativeSearchSnapshot => {this.current(); return this.state;};
  subscribe = (listener: () => void): (() => void) => {this.listeners.add(listener); return () => {this.listeners.delete(listener);};};
  private current(): boolean {
    if (!this.disposed && !this.options.current()) this.dispose();
    return !this.disposed;
  }
  private publish(patch: Partial<NativeSearchSnapshot>): void {
    if (!this.current()) return;
    this.state = Object.freeze({...this.state, ...patch});
    for (const listener of [...this.listeners]) listener();
  }
  private changed = (): void => {
    if (!this.current()) return;
    const search = this.service.getSnapshot();
    const query = JSON.stringify([search.query?.q, search.query?.group]);
    if (query !== this.pageQuery || !search.data) {this.pages.clear(); this.pageQuery = query;}
    if (search.phase === 'ready') {
      if (!search.pagination.cursor) this.pages.clear();
      for (const group of search.groups) {
        const previous = search.pagination.cursor ? this.pages.get(group.id) : undefined;
        const items = new Map<string, SearchEntry>();
        for (const entry of [...(previous?.items ?? []), ...group.items]) items.set(nativeSearchEntryKey(group.id, entry), entry);
        this.pages.set(group.id, Object.freeze({...group, items: Object.freeze([...items.values()])}));
      }
    }
    this.publish({search, groups: Object.freeze([...this.pages.values()])});
  };
  private stopTimer(): void {clearTimeout(this.timer); this.timer = undefined;}
  setText(text: string): void {
    if (!this.current()) return;
    this.stopTimer(); this.service.cancel();
    const problem = searchQueryProblem(text);
    this.publish({text, group: 'all', problem});
    if (!text.trim() || problem) return;
    // notes/search.md: one260ms debounce; Enter commits immediately.
    this.timer = setTimeout(() => {this.timer = undefined; void this.select(false);}, 260);
  }
  selectGroup(group: SearchGroup | 'all'): void {
    if (!this.current()) return;
    this.stopTimer(); this.publish({group}); void this.select(false);
  }
  private async select(record: boolean): Promise<void> {
    if (!this.current() || !this.state.text.trim() || this.state.problem) return;
    try {
      await this.service.select(this.state.text, {
        ...(this.state.group === 'all' ? {} : {group: this.state.group}),
        record: record && this.options.rememberHistory(),
      });
      if (record && this.current()) await this.refreshHistory();
    } catch (error) {if (this.current()) this.options.reportError(error);}
  }
  commit = async (): Promise<void> => {this.stopTimer(); await this.select(true);};
  useRecent = (query: string): void => {this.setText(query); void this.commit();};
  next = (group: SearchGroup): Promise<void> => this.current() ? this.service.next(group) : Promise.resolve();
  retry = (): Promise<void> => this.current() ? this.service.retry() : Promise.resolve();
  refreshHistory = async (): Promise<void> => {
    if (!this.current() || this.state.clearing) return;
    this.history?.abort();
    const revision = ++this.historyRevision;
    if (!this.options.rememberHistory()) {this.publish({recent: []}); return;}
    const controller = new AbortController(); this.history = controller;
    try {
      const page = await readSearchHistory(this.options.api, this.options.scope, controller.signal);
      if (!controller.signal.aborted && this.current() && revision === this.historyRevision) this.publish({recent: this.options.rememberHistory() ? page.entries : []});
    } catch (error) {if (!controller.signal.aborted && this.current() && revision === this.historyRevision) this.options.reportError(error);}
    finally {if (this.history === controller) this.history = undefined;}
  };
  clearHistory = async (): Promise<void> => {
    if (!this.current() || this.state.clearing) return;
    this.history?.abort(); const revision = ++this.historyRevision;
    const controller = new AbortController(); this.history = controller;
    this.publish({clearing: true});
    try {
      await clearSearchHistory(this.options.api, controller.signal);
      if (!controller.signal.aborted && this.current() && revision === this.historyRevision) this.publish({recent: []});
    } catch (error) {if (!controller.signal.aborted && this.current()) this.options.reportError(error);}
    finally {if (this.history === controller) this.history = undefined; if (revision === this.historyRevision) this.publish({clearing: false});}
  };
  dispose = (): void => {
    if (this.disposed) return;
    this.disposed = true; this.stopTimer(); this.history?.abort(); this.historyRevision++;
    this.unsubscribe(); this.service.cancel(); this.service.dispose(); this.pages.clear(); this.listeners.clear();
    this.state = Object.freeze({...this.state, text: '', search: this.service.getSnapshot(), groups: [], recent: [], clearing: false});
  };
}
