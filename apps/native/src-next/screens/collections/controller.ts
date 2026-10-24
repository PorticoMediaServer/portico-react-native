import {LibraryContentService, type ContentEntry, type ContentScope} from '../../../../../packages/client-core/src/library-content';

export type NativeCollectionSort = Readonly<{id: string; labelKey: string; directions: readonly ('asc' | 'desc')[]}>;

export type NativeCollectionState = Readonly<{
  phase: 'idle' | 'loading' | 'ready' | 'error' | 'refresh-required';
  /** The server's own heading for the collection, else the route's real title. */
  title: string;
  entries: readonly ContentEntry[];
  totalCount: number;
  sorts: readonly NativeCollectionSort[];
  sort?: string;
  error?: Readonly<{code: string; message: string; retryable: boolean}>;
}>;

/** The catalogue collection view, read from the real library content projection
 * (`view=collection&entityId=…`). No saved user collection is substituted. */
export class NativeCollectionController {
  private readonly service: LibraryContentService;
  private readonly fallbackTitle: string;
  private readonly libraryId: string;
  private readonly collectionId: string;
  private readonly current: () => boolean;
  private listeners = new Set<() => void>();
  private opened = false;
  private disposed = false;
  private cached: NativeCollectionState;

  constructor(options: Readonly<{api: ConstructorParameters<typeof LibraryContentService>[0]['api']; scope: ContentScope;
    libraryId: string; collectionId: string; title: string; current: () => boolean}>) {
    this.service = new LibraryContentService({api: options.api, scope: options.scope});
    this.fallbackTitle = options.title;
    this.libraryId = options.libraryId;
    this.collectionId = options.collectionId;
    this.current = options.current;
    this.cached = this.read();
    this.service.subscribe(this.changed);
  }
  private read(): NativeCollectionState {
    const state = this.service.getSnapshot();
    const section = state.appended[0] ?? state.sections[0];
    return Object.freeze({
      phase: state.phase,
      title: state.projection?.heading.fallback?.trim() || this.fallbackTitle,
      entries: section?.entries ?? [],
      totalCount: section?.totalCount ?? 0,
      sorts: (state.projection?.sorts ?? []).map(sort => ({id: sort.id, labelKey: sort.labelKey, directions: sort.directions})),
      ...(state.projection?.query.sort ? {sort: state.projection.query.sort} : {}),
      ...(state.error ? {error: state.error} : {}),
    });
  }
  private changed = () => {
    if (this.disposed || !this.current()) return;
    this.cached = this.read();
    for (const listener of [...this.listeners]) listener();
  };
  getSnapshot = () => this.cached;
  subscribe = (listener: () => void): (() => void) => {
    if (this.disposed) return () => {};
    this.listeners.add(listener); return () => {this.listeners.delete(listener);};
  };
  open = async (): Promise<void> => {
    if (this.disposed || !this.current() || this.opened) return;
    this.opened = true;
    await this.service.select({libraryId: this.libraryId, view: 'collection', entityId: this.collectionId});
  };
  more = async (): Promise<void> => {
    if (!this.disposed && this.current()) await this.service.next('items');
  };
  sort = async (sort: string, direction: 'asc' | 'desc'): Promise<void> => {
    if (!this.disposed && this.current()) await this.service.select({libraryId: this.libraryId, view: 'collection', entityId: this.collectionId, sort, direction});
  };
  retry = async (): Promise<void> => {
    if (!this.disposed && this.current()) await this.service.retry();
  };
  dispose = (): void => {
    if (this.disposed) return;
    this.disposed = true;
    this.listeners.clear();
    this.service.dispose();
  };
}
