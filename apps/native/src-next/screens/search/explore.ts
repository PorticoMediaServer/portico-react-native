import {readSearchGenres} from '../../../../../packages/client-core/src/search-genres';
import type {LibraryContentApi} from '../../../../../packages/client-core/src/library-content';
import {nativeSearchGenreTiles} from './genre-tiles';
import type {NativeSearchExplorePort, NativeSearchExploreSnapshot, NativeSearchGenre} from './types';

export type NativeSearchGenresSnapshot = NativeSearchExploreSnapshot & Readonly<{revision?: string; nextCursor?: string}>;
const initial: NativeSearchGenresSnapshot = Object.freeze({phase: 'idle', genres: [],
  initialHeading: 'next.search.browseByGenre', emptyHeading: 'next.search.browseInstead'});

/** Only transport and pagination live here. Ordering, counts and representative
 * artwork are the canonical server read, including genres without tile art. */
export class NativeSearchExplore implements NativeSearchExplorePort {
  private readonly options: Readonly<{api: LibraryContentApi; current: () => boolean;
    surface: 'phone' | 'tv'; openGenre: (genre: NativeSearchGenre) => void}>;
  private state: NativeSearchGenresSnapshot = initial;
  private readonly listeners = new Set<() => void>();
  private readonly cursors = new Set<string>();
  private controller?: AbortController;
  private pending?: Promise<void>;
  private disposed = false;
  constructor(options: NativeSearchExplore['options']) {this.options = options;}
  private current(): boolean {if (!this.disposed && !this.options.current()) this.dispose(); return !this.disposed;}
  getSnapshot = (): NativeSearchGenresSnapshot => {this.current(); return this.state;};
  subscribe = (listener: () => void): (() => void) => {if (!this.current()) return () => {};
    this.listeners.add(listener); return () => {this.listeners.delete(listener);};};
  private publish(patch: Partial<NativeSearchGenresSnapshot>): void {
    if (!this.current()) return;
    this.state = Object.freeze({...this.state, ...patch}); for (const listener of [...this.listeners]) listener();
  }
  private completeTiles(): boolean {
    if (this.options.surface === 'tv') return nativeSearchGenreTiles(this.state.genres, 'tv').length === 4;
    return nativeSearchGenreTiles(this.state.genres, 'phone').length === 6 && nativeSearchGenreTiles(this.state.genres, 'phone-empty').length === 4;
  }
  private async page(cursor: string | undefined, signal: AbortSignal): Promise<void> {
    const key = cursor ?? '';
    if (this.cursors.has(key)) throw Object.assign(new Error('invalid_response'), {code: 'invalid_response'});
    this.cursors.add(key);
    const result = await readSearchGenres(this.options.api, {limit: 50, ...(cursor ? {cursor} : {})}, signal);
    if (!this.current() || signal.aborted) return;
    const previous = cursor ? this.state.genres : [], seen = new Set(previous.map(genre => genre.id));
    if (cursor && result.revision !== this.state.revision || result.nextCursor && result.nextCursor === cursor
      || result.genres.some(genre => seen.has(genre.value))) throw Object.assign(new Error('invalid_response'), {code: 'invalid_response'});
    const genres = result.genres.map(genre => Object.freeze({id: genre.value, name: genre.label, count: genre.count,
      ...(genre.backdrop ? {backdropPath: genre.backdrop.path} : {}), coverPaths: Object.freeze(genre.covers.map(art => art.path))}));
    this.publish({revision: result.revision, genres: Object.freeze([...previous, ...genres]), nextCursor: result.nextCursor});
  }
  private read(restart: boolean): Promise<void> {
    if (!this.current()) return Promise.resolve();
    if (this.pending) return this.pending;
    const controller = new AbortController(); this.controller = controller;
    const task = Promise.resolve().then(async () => {
      if (!this.current()) return;
      if (restart) this.cursors.clear();
      this.publish(restart ? {...initial, phase: 'loading', revision: undefined, nextCursor: undefined, error: undefined} : {phase: 'loading', error: undefined});
      await this.page(restart ? undefined : this.state.nextCursor, controller.signal);
      // The next qualifying tile may be on a later canonical page. Stop as
      // soon as both authored phone prefixes (or the TV prefix) are available.
      while (this.current() && !controller.signal.aborted && this.state.nextCursor && !this.completeTiles()) await this.page(this.state.nextCursor, controller.signal);
      if (!controller.signal.aborted) this.publish({phase: 'ready'});
    }).catch(error => {if (!controller.signal.aborted) this.publish({phase: 'error', error});})
      .finally(() => {if (this.pending === task) this.pending = undefined;});
    this.pending = task; return task;
  }
  load = (): Promise<void> => this.state.phase === 'ready' && this.current() ? Promise.resolve() : this.read(true);
  /** All genres retains art-less rows and uses the actual continuation. */
  next = (): Promise<void> => this.state.nextCursor && this.current() ? this.read(false) : Promise.resolve();
  openGenre = (genre: NativeSearchGenre): void => {if (this.current() && this.state.genres.includes(genre)) this.options.openGenre(genre);};
  dispose = (): void => {if (this.disposed) return; this.disposed = true; this.controller?.abort(); this.state = initial; this.cursors.clear(); this.listeners.clear();};
}
