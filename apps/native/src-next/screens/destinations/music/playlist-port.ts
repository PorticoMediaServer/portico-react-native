import {SavedService, type PlaylistCard, type SavedScope} from '../../../../../../packages/client-core/src/saved';

export type MusicAlbumPhase = 'loading' | 'adding' | 'partial' | 'failed' | 'done';
export type MusicAlbumProgress = Readonly<{
  playlistId: string;
  playlistName?: string;
  total?: number;
  added: number;
  phase: MusicAlbumPhase;
}>;
export type MusicAlbumResult = Readonly<{phase: 'done' | 'partial' | 'failed'; added: number; error?: unknown}>;

export type MusicPlaylistSnapshot = Readonly<{
  phase: 'idle' | 'loading' | 'ready' | 'error';
  playlists: readonly PlaylistCard[];
  busy: boolean;
  error?: unknown;
  album?: MusicAlbumProgress;
}>;

type Options = Readonly<{
  api: {request<T>(path: string, method?: string, body?: unknown, signal?: AbortSignal): Promise<T>};
  scope: SavedScope;
  current: () => boolean;
  requestId: () => Promise<string>;
  /** Complete server album membership, resolved at action time. Only whole-album
   * actions pass this; a leaf picker adds one item. */
  album?: () => Promise<readonly string[]>;
}>;

type AlbumRun = {
  playlistId: string;
  playlistName: string;
  itemIds: readonly string[];
  index: number;
  added: number;
  service: SavedService;
  /** A rejected write is unresolved until the canonical retry settles it. */
  pending?: 'retry' | 'resend';
};

/** The profile's real playlists and canonical leaf adds. The read uses the same
 * Saved producer the Saved screen uses; each write is SavedService's own CAS
 * mutation, so there is no second playlist store or hand-built receipt. An
 * album is added as its real ordered song leaves, one confirmed write at a time. */
export class MusicPlaylistPort {
  private options: Options;
  private list?: SavedService;
  private albumRun?: AlbumRun;
  private state: MusicPlaylistSnapshot = Object.freeze({phase: 'idle', playlists: [], busy: false});
  private listeners = new Set<() => void>();
  private generation = 0;
  private disposed = false;
  constructor(options: Options) {this.options = options;}
  getSnapshot = (): MusicPlaylistSnapshot => this.state;
  subscribe = (listener: () => void): (() => void) => {if (this.disposed) return () => {}; this.listeners.add(listener); return () => {this.listeners.delete(listener);};};
  private current(): boolean {if (!this.disposed && !this.options.current()) this.dispose(); return !this.disposed;}
  private publish(patch: Partial<MusicPlaylistSnapshot>): void {
    if (!this.current()) return;
    this.state = Object.freeze({...this.state, ...patch});
    for (const listener of [...this.listeners]) listener();
  }
  private service(): SavedService {
    if (!this.list) {
      this.list = new SavedService({api: this.options.api, scope: this.options.scope, requestId: this.options.requestId});
      this.list.subscribe(() => {if (this.list) this.read(this.list.getSnapshot());});
    }
    return this.list;
  }
  private read(snapshot: ReturnType<SavedService['getSnapshot']>): void {
    const playlists = (snapshot.projection?.sections ?? []).flatMap(section => section.entries.filter((entry): entry is PlaylistCard => entry.kind === 'playlist'));
    this.publish({phase: snapshot.phase === 'error' ? 'error' : snapshot.phase === 'loading' ? 'loading' : 'ready',
      playlists: Object.freeze(playlists), error: snapshot.error ?? undefined});
  }
  load = async (): Promise<void> => {
    if (!this.current()) return;
    const generation = ++this.generation;
    this.publish({phase: 'loading', error: undefined});
    try {
      await this.service().select({view: 'playlists'});
      if (this.current() && generation === this.generation && this.list) this.read(this.list.getSnapshot());
    } catch (error) {
      if (this.current() && generation === this.generation) this.publish({phase: 'error', error});
    }
  };
  add = async (playlistId: string, itemId: string): Promise<void> => {
    if (!this.current() || !playlistId || !itemId) return;
    this.publish({busy: true, error: undefined});
    const service = new SavedService({api: this.options.api, scope: this.options.scope, requestId: this.options.requestId});
    try {
      await service.select({view: 'playlist', playlistId});
      if (!this.current()) return;
      const snapshot = service.getSnapshot();
      if (snapshot.phase !== 'ready' || !snapshot.playlist) throw snapshot.error ?? new Error('playlist_unavailable');
      await service.mutate({action: 'add', itemId});
      if (this.current()) this.publish({busy: false});
    } catch (error) {
      if (this.current()) this.publish({busy: false, error});
      throw error;
    } finally {service.dispose();}
  };
  /** Add every captured song leaf, in order, waiting for each real receipt. */
  addAlbum = async (playlist: Readonly<{id: string; name: string}>): Promise<MusicAlbumResult> => {
    if (!this.current() || !this.options.album || this.albumRun) return {phase: 'failed', added: 0};
    this.publish({busy: true, error: undefined, album: {playlistId: playlist.id, playlistName: playlist.name, added: 0, phase: 'loading'}});
    let ids: readonly string[];
    try {
      ids = await this.options.album();
    } catch (error) {
      return this.failAlbum(playlist.id, playlist.name, 0, error);
    }
    if (!this.current()) return {phase: 'failed', added: 0};
    if (!ids.length || ids.some(value => typeof value !== 'string' || !value) || new Set(ids).size !== ids.length) {
      return this.failAlbum(playlist.id, playlist.name, 0, Object.assign(new Error('playlist_album_membership'), {code: 'playlist_album_membership'}));
    }
    const service = new SavedService({api: this.options.api, scope: this.options.scope, requestId: this.options.requestId});
    const run: AlbumRun = {playlistId: playlist.id, playlistName: playlist.name, itemIds: Object.freeze([...ids]), index: 0, added: 0, service};
    this.albumRun = run;
    try {
      await service.select({view: 'playlist', playlistId: playlist.id});
      if (!this.current()) {service.dispose(); this.albumRun = undefined; return {phase: 'failed', added: 0};}
      const snapshot = service.getSnapshot();
      if (snapshot.phase !== 'ready' || !snapshot.playlist) throw snapshot.error ?? new Error('playlist_unavailable');
    } catch (error) {
      service.dispose();
      this.albumRun = undefined;
      return this.failAlbum(playlist.id, playlist.name, 0, error);
    }
    return this.writeAlbum(run);
  };
  /** Resume this captured album action. Confirmed leaves are never sent again. */
  resumeAlbum = async (): Promise<MusicAlbumResult> => {
    if (!this.current()) return {phase: 'failed', added: 0};
    const run = this.albumRun, album = this.state.album;
    if (!run) {
      if (!this.options.album || !album?.playlistId) return {phase: 'failed', added: 0};
      return this.addAlbum({id: album.playlistId, name: album.playlistName ?? ''});
    }
    this.publish({busy: true, error: undefined, album: {...this.progress(run), phase: 'adding'}});
    if (run.pending) {
      const itemId = run.itemIds[run.index]!;
      try {
        if (run.pending === 'retry') await run.service.retryMutation();
        else await run.service.mutate({action: 'add', itemId});
        if (!this.current()) return {phase: 'failed', added: run.added};
        run.added++; run.index++; run.pending = undefined;
      } catch (error) {
        if (!this.current()) return {phase: 'failed', added: run.added};
        return this.failAlbum(run.playlistId, run.playlistName, run.added, error);
      }
    }
    return this.writeAlbum(run);
  };
  private progress(run: AlbumRun): MusicAlbumProgress {
    return Object.freeze({playlistId: run.playlistId, playlistName: run.playlistName, total: run.itemIds.length, added: run.added,
      phase: run.added > 0 ? 'partial' : 'failed'});
  }
  private failAlbum(playlistId: string, playlistName: string, added: number, error: unknown): MusicAlbumResult {
    if (this.current()) this.publish({busy: false, error, album: Object.freeze({playlistId, playlistName, added, phase: added > 0 ? 'partial' : 'failed'})});
    return Object.freeze({phase: added > 0 ? 'partial' : 'failed', added, error});
  }
  private async writeAlbum(run: AlbumRun): Promise<MusicAlbumResult> {
    while (run.index < run.itemIds.length) {
      if (!this.current()) return {phase: 'failed', added: run.added};
      const itemId = run.itemIds[run.index]!;
      this.publish({busy: true, error: undefined, album: {...this.progress(run), phase: 'adding'}});
      let accepted = false;
      try {
        const mutation = run.service.mutate({action: 'add', itemId});
        accepted = true;
        await mutation;
        if (!this.current()) return {phase: 'failed', added: run.added};
        run.added++; run.index++; run.pending = undefined;
      } catch (error) {
        if (!this.current()) return {phase: 'failed', added: run.added};
        run.pending = accepted ? 'retry' : 'resend';
        return this.failAlbum(run.playlistId, run.playlistName, run.added, error);
      }
    }
    this.albumRun = undefined;
    run.service.dispose();
    if (this.current()) this.publish({busy: false, error: undefined, album: {playlistId: run.playlistId, playlistName: run.playlistName, total: run.itemIds.length, added: run.added, phase: 'done'}});
    return {phase: 'done', added: run.added};
  }
  dispose = (): void => {
    if (this.disposed) return;
    this.disposed = true; this.generation++;
    this.albumRun?.service.dispose(); this.albumRun = undefined;
    this.list?.dispose(); this.list = undefined;
    this.listeners.clear();
    this.state = Object.freeze({phase: 'idle', playlists: [], busy: false});
  };
}
