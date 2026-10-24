import {SavedService, type PlaylistCard, type SavedScope} from '../../../../../../packages/client-core/src/saved';

export type MusicPlaylistSnapshot = Readonly<{
  phase: 'idle' | 'loading' | 'ready' | 'error';
  playlists: readonly PlaylistCard[];
  busy: boolean;
  error?: unknown;
}>;

type Options = Readonly<{api: {request<T>(path: string, method?: string, body?: unknown, signal?: AbortSignal): Promise<T>}; scope: SavedScope; current: () => boolean; requestId: () => Promise<string>}>;

/** The profile's real playlists and one canonical add. The read uses the same
 * Saved producer the Saved screen uses; the write is SavedService's own CAS
 * mutation, so there is no second playlist store or hand-built receipt. */
export class MusicPlaylistPort {
  private options: Options;
  private list?: SavedService;
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
      await service.mutate({action: 'add', itemId});
      if (this.current()) this.publish({busy: false});
    } catch (error) {
      if (this.current()) this.publish({busy: false, error});
      throw error;
    } finally {service.dispose();}
  };
  dispose = (): void => {
    if (this.disposed) return;
    this.disposed = true; this.generation++;
    this.list?.dispose(); this.list = undefined;
    this.listeners.clear();
    this.state = Object.freeze({phase: 'idle', playlists: [], busy: false});
  };
}
