import {SavedService, fetchSavedSummary, type SavedApi, type SavedLandingSummary, type SavedScope, type SavedSnapshot} from '../../../../../packages/client-core/src/saved';
import {PersonalSavedService, type PersonalSavedSnapshot} from '../../../../../packages/client-core/src/personal-saved';
import {readPinOrder, type PinnedResource} from '../../../../../packages/client-core/src/library-pins';
import type {ContentEntry} from '../../../../../packages/client-core/src/library-content';

export type NativeSavedSnapshot = Readonly<{
  phase: 'idle' | 'loading' | 'ready' | 'error';
  myList: SavedSnapshot; favorites: SavedSnapshot; playlists: SavedSnapshot;
  collections: PersonalSavedSnapshot; views: PersonalSavedSnapshot;
  pins: readonly PinnedResource[]; error?: unknown;
  summary?: SavedLandingSummary;
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
  contains = (entry: ContentEntry): boolean => this.current() && this.state.myList.projection?.sections.some(section => section.entries.some(value => value === entry)) === true;
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
    this.publish({phase: 'loading', error: undefined, summary: undefined});
    const task = Promise.allSettled([
      this.myList.select({view: 'watchlist', shape: 'posters'}), fetchSavedSummary(this.options.api, this.options.scope, controller.signal),
      readPinOrder(this.options.api, this.options.scope.serverId, controller.signal),
    ]).then(results => {
      if (!this.current() || revision !== this.revision || controller.signal.aborted) return;
      // The drawn My List is the hub; its failure is the page's error. Missing counts or
      // pins are absent sections, never a fake zero or a Home-shaped error over Saved.
      const failure = this.myList.getSnapshot().error;
      const summary = results[1].status === 'fulfilled' ? results[1].value : undefined;
      const pins = results[2].status === 'fulfilled' ? results[2].value.order : [];
      this.publish({phase: failure ? 'error' : 'ready', summary, pins, error: failure ?? undefined});
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
