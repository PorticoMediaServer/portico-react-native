import {DetailService} from '../../../../../packages/client-core/src/detail';
import {SavedService} from '../../../../../packages/client-core/src/saved';
import {PersonalSavedService} from '../../../../../packages/client-core/src/personal-saved';
import {appendPlaylistSelection} from '../../../../../packages/client-core/src/playlist-selection';
import {validateContentEntry, type ContentEntry} from '../../../../../packages/client-core/src/library-content';
import type {CatalogueSelectionOptions} from '../../../../../packages/client-core/src/catalogue-selection';

const unavailable = () => Object.assign(new Error('catalogue-selection-unavailable'), {code: 'catalogue-selection-unavailable'});

/** Bounded direct Saved writes for an explicit captured Search selection.
 * Every service validates its own response fence. Search continuity is checked
 * around I/O, never compared with a Saved or Detail response fence. */
export class NativeLoadedDestinations {
  private readonly options: CatalogueSelectionOptions;
  private readonly api: CatalogueSelectionOptions['api'];
  private readonly requestId: CatalogueSelectionOptions['requestId'];
  private readonly entries: readonly ContentEntry[];
  private readonly playlists: SavedService;
  private readonly playlist: SavedService;
  private readonly collections: PersonalSavedService;
  private readonly collection: PersonalSavedService;
  private readonly listeners = new Set<() => void>();
  private readonly stops: (() => void)[];
  private disposed = false;
  private running = false;
  private revision = 0;
  private chosen?: Readonly<{kind: 'playlist' | 'collection'; id: string}>;
  private completed = 0;
  private attemptedCollection = false;

  constructor(options: CatalogueSelectionOptions, input: readonly ContentEntry[]) {
    this.options = options;
    this.entries = Object.freeze(input.map(validateContentEntry));
    if (!this.entries.length || this.entries.length > 100 || this.entries.some(entry => !entry.libraryId
      || !['movie', 'episode', 'song', 'audiobook_file'].includes(entry.kind))
      || new Set(this.entries.map(entry => entry.id)).size !== this.entries.length) throw unavailable();
    if (options.signal.aborted || !options.isCurrent()) throw Object.assign(new Error('cancelled'), {name: 'AbortError', code: 'cancelled'});
    const api = {request: async <T>(path: string, method?: string, body?: unknown, signal?: AbortSignal): Promise<T> => {
      this.assertCurrent();
      const result = await options.api.request<T>(path, method, body, signal);
      this.assertCurrent(); return result;
    }};
    const requestId = async () => {this.assertCurrent(); const id = await options.requestId(); this.assertCurrent(); return id;};
    this.api = api; this.requestId = requestId;
    this.playlists = new SavedService({api, scope: options.scope, requestId});
    this.playlist = new SavedService({api, scope: options.scope, requestId});
    this.collections = new PersonalSavedService(api, options.scope, requestId);
    this.collection = new PersonalSavedService(api, options.scope, requestId);
    this.stops = [this.playlists.subscribe(this.changed), this.playlist.subscribe(this.changed),
      this.collections.subscribe(this.changed), this.collection.subscribe(this.changed)];
    options.signal.addEventListener('abort', this.dispose, {once: true});
  }
  private assertCurrent() {
    if (this.disposed || this.options.signal.aborted || !this.options.isCurrent()) {
      if (!this.disposed) this.dispose();
      throw Object.assign(new Error('cancelled'), {name: 'AbortError', code: 'cancelled'});
    }
  }
  private changed = () => {this.revision++; for (const listener of [...this.listeners]) listener();};
  subscribe = (listener: () => void) => {this.listeners.add(listener); return () => {this.listeners.delete(listener);};};
  getSnapshot = () => this.revision;
  snapshot = () => ({busy: this.running, chosen: this.chosen, completed: this.completed,
    playlists: this.playlists.getSnapshot(), playlist: this.playlist.getSnapshot(),
    collections: this.collections.getSnapshot(), collection: this.collection.getSnapshot()});
  private async eligibility(kind: 'playlist' | 'collection') {
    // Read only these exact leaves, in bounded order; no parent expansion.
    for (const entry of this.entries) {
      this.assertCurrent();
      const detail = new DetailService({api: this.api, scope: this.options.scope, requestId: this.requestId});
      const stop = () => detail.dispose();
      this.options.signal.addEventListener('abort', stop, {once: true});
      try {
        await detail.select({libraryId: entry.libraryId!, itemId: entry.id}); this.assertCurrent();
        const state = detail.getSnapshot(), data = state.data;
        if (state.phase !== 'ready' || !data || data.item.id !== entry.id || data.item.kind !== entry.kind
          || data.item.libraryId !== entry.libraryId || !data.actions.some(action => action.enabled
            && action.id === (kind === 'playlist' ? 'add_to_playlist' : 'add_to_collection'))) throw unavailable();
      } finally {this.options.signal.removeEventListener('abort', stop); detail.dispose();}
    }
  }
  private async run(work: () => Promise<void>) {
    this.assertCurrent(); if (this.running) throw unavailable();
    this.running = true; this.changed();
    try {await work(); this.assertCurrent();}
    finally {this.running = false; this.changed();}
  }
  load = (kind: 'playlist' | 'collection') => this.run(async () => {
    if (this.chosen) throw unavailable();
    await this.eligibility(kind);
    if (kind === 'playlist') await this.playlists.select({view: 'playlists'});
    else await this.collections.select({view: 'collections'});
  });
  next = (kind: 'playlist' | 'collection') => this.run(async () => {
    if (this.chosen) throw unavailable();
    if (kind === 'playlist') {
      const next = this.playlists.getSnapshot().pagination.next[0];
      if (next) await this.playlists.next(next.sectionId);
    } else await this.collections.next();
  });
  previous = (kind: 'playlist' | 'collection') => this.run(async () => {
    if (this.chosen) throw unavailable();
    if (kind === 'playlist') await this.playlists.previous(); else await this.collections.previous();
  });
  choose = (kind: 'playlist' | 'collection', id: string) => this.run(async () => {
    if (this.chosen) throw unavailable();
    await this.eligibility(kind);
    if (kind === 'playlist') {
      await this.playlist.select({view: 'playlist', playlistId: id}); this.assertCurrent();
      const state = this.playlist.getSnapshot();
      if (state.phase !== 'ready' || state.playlist?.id !== id || !state.playlist.actions.includes('add')) throw unavailable();
    } else {
      await this.collection.select({view: 'resource', resourceId: id}); this.assertCurrent();
      const state = this.collection.getSnapshot();
      if (state.loading || state.error || state.resource?.id !== id || state.resource.kind !== 'collection'
        || !state.resource.actions.includes('entries')) throw unavailable();
    }
    this.chosen = {kind, id}; await this.append();
  });
  private async append() {
    this.assertCurrent();
    if (this.chosen?.kind === 'playlist') {
      this.completed = await appendPlaylistSelection(this.playlist, this.entries.map(entry => entry.id), this.completed,
        count => {this.completed = count; this.changed();}, () => !this.disposed && !this.options.signal.aborted && this.options.isCurrent());
    } else if (this.chosen?.kind === 'collection') {
      const state = this.collection.getSnapshot();
      if (state.resource?.id !== this.chosen.id || state.resource.kind !== 'collection' || !state.resource.actions.includes('entries')) throw unavailable();
      if (this.attemptedCollection) {
        if (!state.retryPending) throw unavailable();
        await this.collection.retry();
      } else {
        this.attemptedCollection = true;
        await this.collection.mutate({action: 'entries', addItemIds: this.entries.map(entry => entry.id), removeEntryIds: []});
      }
      this.assertCurrent();
      const after = this.collection.getSnapshot();
      if (after.pending || after.retryPending || after.mutationError || !after.result?.entries) throw after.mutationError ?? unavailable();
    } else throw unavailable();
  }
  retry = () => this.run(async () => {
    if (!this.chosen) throw unavailable();
    await this.eligibility(this.chosen.kind); await this.append();
  });
  dispose = () => {
    if (this.disposed) return;
    this.disposed = true; this.options.signal.removeEventListener('abort', this.dispose);
    this.stops.forEach(stop => stop());
    this.playlists.dispose(); this.playlist.dispose(); this.collections.dispose(); this.collection.dispose(); this.listeners.clear();
  };
}
