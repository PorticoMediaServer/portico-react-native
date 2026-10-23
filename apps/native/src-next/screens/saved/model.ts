import {SavedService, type SavedApi, type SavedScope, type SavedSnapshot} from '../../../../../packages/client-core/src/saved';
import {PersonalSavedService, type PersonalSavedSnapshot} from '../../../../../packages/client-core/src/personal-saved';
import {readPinOrder, type PinnedResource} from '../../../../../packages/client-core/src/library-pins';

export type NativeSavedSnapshot = Readonly<{
  phase: 'idle' | 'loading' | 'ready' | 'error';
  myList: SavedSnapshot; favorites: SavedSnapshot; playlists: SavedSnapshot;
  collections: PersonalSavedSnapshot; views: PersonalSavedSnapshot;
  pins: readonly PinnedResource[]; error?: unknown;
}>;

/** The Saved hub reads bounded canonical projections. It never fetches an entire
 * library to count it, invents a count, or treats a server preparation as local bytes. */
export class NativeSavedDestination {
  private readonly myList: SavedService;
  private readonly favorites: SavedService;
  private readonly playlists: SavedService;
  private readonly collections: PersonalSavedService;
  private readonly views: PersonalSavedService;
  private readonly options: Readonly<{api: SavedApi; scope: SavedScope; requestId: () => Promise<string>; current: () => boolean}>;
  private state: NativeSavedSnapshot;
  private readonly closed: NativeSavedSnapshot;
  private readonly listeners = new Set<() => void>();
  private readonly subscriptions: (() => void)[];
  private controller?: AbortController;
  private disposed = false;
  private revision = 0;
  private pending?: Promise<void>;
  constructor(options: NativeSavedDestination['options']) {
    this.options = options;
    this.myList = new SavedService(options); this.favorites = new SavedService(options); this.playlists = new SavedService(options);
    this.collections = new PersonalSavedService(options.api, options.scope, options.requestId);
    this.views = new PersonalSavedService(options.api, options.scope, options.requestId);
    this.state = Object.freeze({phase: 'idle', myList: this.myList.getSnapshot(), favorites: this.favorites.getSnapshot(), playlists: this.playlists.getSnapshot(),
      collections: this.collections.getSnapshot(), views: this.views.getSnapshot(), pins: []});
    this.closed = this.state;
    this.subscriptions = [this.myList, this.favorites, this.playlists, this.collections, this.views].map(service => service.subscribe(() => this.publish({})));
  }
  private current(): boolean {if (!this.disposed && !this.options.current()) this.dispose(); return !this.disposed;}
  getSnapshot = (): NativeSavedSnapshot => {this.current(); return this.state;};
  subscribe = (listener: () => void): (() => void) => {this.listeners.add(listener); return () => {this.listeners.delete(listener);};};
  private publish(patch: Partial<NativeSavedSnapshot>): void {
    if (!this.current()) return;
    this.state = Object.freeze({...this.state, myList: this.myList.getSnapshot(), favorites: this.favorites.getSnapshot(), playlists: this.playlists.getSnapshot(),
      collections: this.collections.getSnapshot(), views: this.views.getSnapshot(), ...patch});
    for (const listener of [...this.listeners]) listener();
  }
  load = (): Promise<void> => {
    if (!this.current()) return Promise.resolve();
    if (this.pending) return this.pending;
    this.controller?.abort(); const controller = new AbortController(); this.controller = controller;
    const revision = ++this.revision;
    this.publish({phase: 'loading', error: undefined});
    const task = Promise.all([
      this.myList.select({view: 'watchlist'}), this.favorites.select({view: 'favorites'}), this.playlists.select({view: 'playlists'}),
      this.collections.select({view: 'collections'}), this.views.select({view: 'views'}),
      readPinOrder(this.options.api, this.options.scope.serverId, controller.signal),
    ]).then(results => {
      if (!this.current() || revision !== this.revision || controller.signal.aborted) return;
      const failure = [this.myList, this.favorites, this.playlists, this.collections, this.views].map(service => service.getSnapshot().error).find(Boolean);
      this.publish({phase: failure ? 'error' : 'ready', pins: results[5].order, error: failure});
    }).catch(error => {if (this.current() && revision === this.revision && !controller.signal.aborted) this.publish({phase: 'error', error});})
      .finally(() => {if (this.pending === task) this.pending = undefined;});
    this.pending = task; return task;
  };
  dispose = (): void => {
    if (this.disposed) return;
    this.disposed = true; this.revision++; this.controller?.abort();
    for (const unsubscribe of this.subscriptions) unsubscribe();
    for (const service of [this.myList, this.favorites, this.playlists, this.collections, this.views]) service.dispose();
    this.state = this.closed;
    this.listeners.clear();
  };
}

export function savedProjectionCount(snapshot: SavedSnapshot): number | undefined {
  return snapshot.phase === 'ready' ? snapshot.projection?.sections.reduce((sum, section) => sum + section.totalCount, 0) : undefined;
}
/** A partial directory has no total in the current contract. Its first page's length is
 * never presented as the total number of collections or saved views. */
export function savedDirectoryCount(snapshot: PersonalSavedSnapshot): number | undefined {
  return snapshot.route && !snapshot.loading && !snapshot.error && !snapshot.nextCursor ? snapshot.resources.length : undefined;
}
