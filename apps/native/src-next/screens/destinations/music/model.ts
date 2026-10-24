import type {ContentEntry} from '../../../../../../packages/client-core/src/library-content';
import {validateContentEntry} from '../../../../../../packages/client-core/src/library-content';
import {
  BrowseQueryBuilder, browseCapabilitiesPath, browsePath, parseBrowseCapabilities, parseBrowseResult, type BrowseCapabilities,
} from '../../../../../../packages/client-core/src/browse';
import {getContainerState, setContainerFlag, type ContainerState} from '../../../../../../packages/client-core/src/container-state';
import {encodedRoutePath} from '../../../../../../packages/contracts/src/routes';
import {unreadableServerResponse} from '../../../../../../packages/client-core/src/server-messages';
import type {NativeShellBootstrapContext} from '../../../shell/bootstrap';
import type {NativeShellPlaybackAdapter} from '../../../shell/playback';
import {nativeDestinationLifetime} from '../lifetime';

export type MusicAlbumRole = 'album' | 'ep' | 'single' | 'compilation' | 'appearance';
export type MusicAlbumRow = Readonly<{id: string; libraryId: string; title: string; artist?: Readonly<{id: string; name: string}>; year?: number; posterUrl?: string; role?: MusicAlbumRole}>;
export type MusicPageEntry = Readonly<{kind: 'album' | 'artist'; entry: ContentEntry}>;
export type NativeTVMusicSnapshot = Readonly<{
  phase: 'idle' | 'loading' | 'ready' | 'error';
  entry?: ContentEntry;
  songs: readonly ContentEntry[];
  songTotal?: number;
  songDurationSeconds?: number;
  albums: readonly MusicAlbumRow[];
  similar: readonly ContentEntry[];
  favorite: boolean;
  error?: unknown;
}>;

type Options = Readonly<{api: NativeShellBootstrapContext['api']; entry: ContentEntry; lifetime: ReturnType<typeof nativeDestinationLifetime>; playback?: NativeShellPlaybackAdapter}>;
const id = (value: unknown): value is string => typeof value === 'string' && value.length > 0 && value.length <= 256 && !/[\r\n]/.test(value);
const obj = (value: unknown): value is Record<string, unknown> => !!value && typeof value === 'object' && !Array.isArray(value);
const list = (value: unknown, max: number): unknown[] => {
  if (!Array.isArray(value) || value.length > max) throw new Error(unreadableServerResponse);
  return value;
};
const text = (value: unknown, max = 4096): value is string => typeof value === 'string' && value.length <= max && !/[\x00-\x1f\x7f]/.test(value);
const entryList = (value: unknown, max: number): readonly ContentEntry[] => Object.freeze(list(value, max).flatMap(row => {
  try { return [validateContentEntry(row)]; } catch { return []; }
}).filter(entry => entry.kind === 'album' || entry.kind === 'artist' || entry.kind === 'song'));
const album = (value: unknown): MusicAlbumRow | undefined => {
  if (!obj(value) || !id(value.id) || !id(value.libraryId) || !text(value.title, 2048)) return undefined;
  const artist = id(value.albumArtistId) && text(value.albumArtist, 2048) ? {id: value.albumArtistId, name: value.albumArtist} : undefined;
  const role = ['album', 'ep', 'single', 'compilation', 'appearance'].includes(value.role as string) ? value.role as MusicAlbumRole : undefined;
  return Object.freeze({id: value.id, libraryId: value.libraryId, title: value.title,
    ...(artist ? {artist} : {}), ...(typeof value.year === 'number' && Number.isSafeInteger(value.year) && value.year > 0 ? {year: value.year} : {}),
    ...(role ? {role} : {}), ...(text(value.posterUrl) && value.posterUrl.startsWith('/') ? {posterUrl: value.posterUrl} : {})});
};
const request = async <T>(api: NativeShellBootstrapContext['api'], path: string, method: 'GET' | 'POST', body: unknown, signal: AbortSignal): Promise<T> => {
  const value = await api.request<T>(path, method, body, signal);
  return value;
};

/** One authority-local album or artist page. The server owns every list, count and order. */
export class NativeTVMusicController {
  private options: Options;
  private state: NativeTVMusicSnapshot = Object.freeze({phase: 'idle', songs: [], albums: [], similar: [], favorite: false});
  private listeners = new Set<() => void>();
  private controller?: AbortController;
  private playController?: AbortController;
  private disposed = false;
  private generation = 0;
  private pending?: Promise<void>;
  constructor(options: Options) {
    this.options = options;
    this.state = Object.freeze({...this.state, entry: options.entry});
  }
  getSnapshot = (): NativeTVMusicSnapshot => this.state;
  contains = (entry: ContentEntry): boolean => {
    if (!this.current()) return false;
    const state = this.state;
    return [state.entry, ...state.songs, ...state.similar].some(value => value?.id === entry.id && value.kind === entry.kind)
      || state.albums.some(value => value.id === entry.id);
  };
  subscribe = (listener: () => void): (() => void) => {
    if (this.disposed) return () => {};
    this.listeners.add(listener);
    return () => { this.listeners.delete(listener); };
  };
  private current(): boolean { return !this.disposed && this.options.lifetime.current(); }
  private publish(patch: Partial<NativeTVMusicSnapshot>): void {
    if (!this.current()) return;
    this.state = Object.freeze({...this.state, ...patch});
    for (const listener of [...this.listeners]) listener();
  }
  load = (): Promise<void> => {
    if (!this.current()) return Promise.resolve();
    if (this.pending) return this.pending;
    const controller = new AbortController();
    this.controller?.abort();
    this.controller = controller;
    const generation = ++this.generation;
    this.publish({phase: 'loading', error: undefined});
    const task = (this.options.entry.kind === 'album' ? this.loadAlbum(controller.signal) : this.loadArtist(controller.signal))
      .catch(error => { if (this.current() && generation === this.generation && !controller.signal.aborted) this.publish({phase: 'error', error}); })
      .finally(() => { if (this.pending === task) this.pending = undefined; });
    this.pending = task;
    return task;
  };
  private async capabilities(pivot: string, signal: AbortSignal): Promise<BrowseCapabilities> {
    const libraryId = this.options.entry.libraryId;
    if (!libraryId) throw new Error('music_library_required');
    return parseBrowseCapabilities(await request(this.options.api, browseCapabilitiesPath(libraryId, pivot), 'GET', undefined, signal));
  }
  private async browse(capabilities: BrowseCapabilities, build: (builder: BrowseQueryBuilder) => BrowseQueryBuilder, signal: AbortSignal) {
    const libraryId = this.options.entry.libraryId;
    if (!libraryId) throw new Error('music_library_required');
    const body = build(new BrowseQueryBuilder(capabilities)).build();
    return parseBrowseResult(await request(this.options.api, browsePath(libraryId), 'POST', body, signal));
  }
  /** A group's full membership when the server's page cap is below what the page
   * wants: bounded cursor pages, de-duplicated by id, honest about completion. */
  private async browseAll(capabilities: BrowseCapabilities, build: (builder: BrowseQueryBuilder) => BrowseQueryBuilder, signal: AbortSignal, maxPages = 20) {
    const libraryId = this.options.entry.libraryId;
    if (!libraryId) throw new Error('music_library_required');
    const builder = build(new BrowseQueryBuilder(capabilities)), seen = new Map<string, ContentEntry>();
    const retired = () => Object.assign(new Error('native_music_retired'), {name: 'AbortError'});
    let total = 0;
    for (let pageNumber = 0; pageNumber < maxPages; pageNumber++) {
      // A retired destination or aborted caller must not send, or adopt, another page.
      if (!this.current() || signal.aborted) throw retired();
      const page = parseBrowseResult(await request(this.options.api, browsePath(libraryId), 'POST', builder.build(), signal));
      if (!this.current() || signal.aborted) throw retired();
      total = page.pageInfo.total;
      for (const entry of page.entries) if (!seen.has(entry.id)) seen.set(entry.id, entry);
      if (!page.pageInfo.hasMore || !page.pageInfo.nextCursor) return {entries: Object.freeze([...seen.values()]), total, complete: true};
      builder.cursor(page.pageInfo.nextCursor);
    }
    return {entries: Object.freeze([...seen.values()]), total, complete: false};
  }
  private async favoriteState(signal: AbortSignal): Promise<boolean> {
    try {
      const state = await getContainerState(this.options.api, this.options.entry.kind as 'album' | 'artist', this.options.entry.id, signal);
      return state.favorite;
    } catch { return false; }
  }
  private async similar(signal: AbortSignal): Promise<readonly ContentEntry[]> {
    const raw = await request<{data?: {entries?: unknown}}>(this.options.api,
      encodedRoutePath('get_items_id_similar', {id: encodeURIComponent(this.options.entry.id)}) + '?limit=12', 'GET', undefined, signal);
    return entryList(raw?.data?.entries, 24);
  }
  private async loadAlbum(signal: AbortSignal): Promise<void> {
    const [capabilities, favorite, similar] = await Promise.all([this.capabilities('songs', signal), this.favoriteState(signal), this.similar(signal)]);
    if (!this.current() || signal.aborted) return;
    const page = await this.browseAll(capabilities, builder => builder.where('memberOf', 'equals', this.options.entry.id).sort('groupOrder', 'asc')
      .limit(Math.min(200, capabilities.queryLimits.maximumLimit)), signal);
    if (!this.current() || signal.aborted) return;
    if (page.entries.some(entry => entry.kind !== 'song')) throw new Error(unreadableServerResponse);
    const complete = page.complete && page.entries.length === page.total;
    const duration = complete ? page.entries.reduce((sum, entry) => sum + (entry.duration ?? 0), 0) : undefined;
    this.publish({phase: 'ready', songs: page.entries, songTotal: page.total, ...(duration ? {songDurationSeconds: duration} : {}),
      similar: similar.filter(entry => entry.kind === 'album' && entry.id !== this.options.entry.id), favorite});
  }
  private async loadArtist(signal: AbortSignal): Promise<void> {
    const [capabilities, favorite, similar, albums] = await Promise.all([
      this.capabilities('songs', signal), this.favoriteState(signal), this.similar(signal), this.artistAlbums(signal),
    ]);
    if (!this.current() || signal.aborted) return;
    const page = await this.browse(capabilities, builder => builder.where('artist', 'equals', this.options.entry.title).sort('playCount', 'desc').limit(Math.min(5, capabilities.queryLimits.maximumLimit)), signal);
    if (!this.current() || signal.aborted) return;
    if (page.entries.some(entry => entry.kind !== 'song')) throw new Error(unreadableServerResponse);
    this.publish({phase: 'ready', songs: page.entries, songTotal: page.pageInfo.total, albums,
      similar: similar.filter(entry => entry.kind === 'artist' && entry.id !== this.options.entry.id), favorite});
  }
  private async artistAlbums(signal: AbortSignal): Promise<readonly MusicAlbumRow[]> {
    const rows: MusicAlbumRow[] = [];
    let cursor = '';
    for (let page = 0; page < 3; page++) {
      const raw = await request<{albums?: unknown; nextCursor?: unknown}>(this.options.api,
        encodedRoutePath('get_artists_id_albums', {id: encodeURIComponent(this.options.entry.id)}) + '?limit=100' + (cursor ? `&cursor=${encodeURIComponent(cursor)}` : ''), 'GET', undefined, signal);
      const values = list(raw?.albums, 100).flatMap(row => { const value = album(row); return value ? [value] : []; });
      rows.push(...values);
      cursor = text(raw?.nextCursor, 4096) ? String(raw!.nextCursor) : '';
      if (!cursor || !values.length) break;
    }
    return Object.freeze(rows);
  }
  play = (anchorItemId?: string, shuffle = false): Promise<void> => {
    if (!this.current()) return Promise.resolve();
    const port = this.options.playback?.cataloguePlayback?.();
    if (!port) return Promise.reject(Object.assign(new Error('music_playback_unavailable'), {code: 'music_playback_unavailable'}));
    this.playController?.abort();
    const controller = new AbortController();
    this.playController = controller;
    const isCurrent = () => !controller.signal.aborted && this.current();
    return port.playSegments([{
      source: {container: {kind: this.options.entry.kind, id: this.options.entry.id}},
      ...(shuffle ? {order: {mode: 'shuffle' as const}} : {}),
      ...(anchorItemId ? {anchor: {itemId: anchorItemId}} : {}),
    }], {signal: controller.signal, isCurrent}).then(() => undefined);
  };
  toggleFavorite = async (): Promise<void> => {
    if (!this.current()) return;
    const controller = new AbortController();
    const state: ContainerState = await setContainerFlag(this.options.api, this.options.entry.kind as 'album' | 'artist', this.options.entry.id, 'favorite', !this.state.favorite, controller.signal);
    if (this.current()) this.publish({favorite: state.favorite});
  };
  dispose = (): void => {
    if (this.disposed) return;
    this.disposed = true;
    this.generation++;
    this.controller?.abort();
    this.playController?.abort();
    this.pending = undefined;
    this.listeners.clear();
  };
}
