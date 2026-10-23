import {DetailService, type DetailApi, type DetailScope, type PersonalIntent} from '../../../../../packages/client-core/src/detail';
import {ShowWorkspaceService} from '../../../../../packages/client-core/src/show-workspace';
import type {ContentEntry} from '../../../../../packages/client-core/src/library-content';
import type {NativeShellPlaybackAdapter} from '../../shell/playback';
import {sameAuthority, type ShellAuthority} from '../../shell/model';
import {NativeTitleMemory, type NativeTitleAnchor, type NativeTitleTab} from './title-memory';
import {NativeTitlePages} from './title-pages';

export type NativeTitleControllerOptions = Readonly<{
  entry: ContentEntry;
  api: DetailApi;
  scope: DetailScope;
  authority: ShellAuthority;
  current: () => ShellAuthority;
  subscribeCurrent: (listener: () => void) => () => void;
  requestId: () => Promise<string>;
  playback: Pick<NativeShellPlaybackAdapter, 'start'>;
}>;

/** Real lazy title/show services, retained independently of full-window/docked presentation. */
export class NativeTitleController {
  readonly detail: DetailService;
  readonly workspace: ShowWorkspaceService;
  readonly memory: NativeTitleMemory;
  readonly entry: ContentEntry;
  private readonly pages = new NativeTitlePages();
  private ingested: unknown;
  private readonly options: NativeTitleControllerOptions;
  private listeners = new Set<() => void>();
  private off: (() => void)[] = [];
  private retired = false;
  private snapshot: ReturnType<NativeTitleController['read']>;
  private opened = false;

  constructor(options: NativeTitleControllerOptions) {
    this.options = options; this.entry = options.entry;
    this.detail = new DetailService({api: options.api, scope: options.scope, requestId: options.requestId});
    this.workspace = new ShowWorkspaceService({api: options.api, scope: options.scope});
    this.memory = new NativeTitleMemory(['show', 'season', 'episode'].includes(this.entry.kind));
    this.snapshot = this.read();
    this.off = [this.detail.subscribe(this.changed), this.workspace.subscribe(this.changed), options.subscribeCurrent(() => {if (!this.current()) this.dispose();})];
  }
  private current(): boolean {return !this.retired && sameAuthority(this.options.authority, this.options.current());}
  private read() {
    const workspace = this.retired ? undefined : this.workspace.getSnapshot(), data = workspace?.data;
    if (workspace?.phase === 'ready' && data && data !== this.ingested) {
      this.ingested = data;
      this.pages.ingest({key: JSON.stringify([data.show.id, data.selected.seasonId, data.selected.group, workspace.route?.playState ?? 'all']),
        fence: JSON.stringify([data.scope.serverId, data.scope.libraryId, data.scope.viewerFence, data.revision.catalog, data.revision.viewer]),
        episodeCursor: workspace.pagination.cursor, seasonCursor: workspace.seasonPagination.cursor, episodes: data.episodes.sections[0]?.entries ?? [], seasons: data.seasons});
    }
    return Object.freeze({entry: this.entry, detail: this.retired ? undefined : this.detail.getSnapshot(), workspace, ...this.pages.getSnapshot(), place: this.memory.getSnapshot(), retired: this.retired});
  }
  getSnapshot = () => this.snapshot;
  subscribe = (listener: () => void): (() => void) => {this.listeners.add(listener); return () => {this.listeners.delete(listener);};};
  private changed = (): void => {
    if (!this.current()) {this.dispose(); return;}
    this.snapshot = this.read(); for (const listener of [...this.listeners]) listener();
  };
  open = async (): Promise<void> => {
    if (!this.current() || this.opened || !this.entry.libraryId) return;
    this.opened = true;
    const {kind, libraryId, id} = this.entry;
    const jobs: Promise<void>[] = [];
    if (kind === 'show' || kind === 'season' || kind === 'episode') {
      jobs.push(this.workspace.select({libraryId, ...(kind === 'show' ? {showId: id} : kind === 'season' ? {seasonId: id} : {episodeId: id})}).then(() => {
        if (!this.current()) return;
        const selected = this.workspace.getSnapshot().data?.selected;
        if (selected) this.memory.select({seasonId: selected.seasonId, group: selected.group ?? null});
        this.changed();
      }));
    }
    if (kind === 'movie' || kind === 'episode' || kind === 'extra') jobs.push(this.detail.select({libraryId, itemId: id}));
    await Promise.all(jobs);
  };
  tab = (tab: NativeTitleTab): void => {if (this.current()) {this.memory.select({tab}); this.changed();}};
  remember = (anchor: NativeTitleAnchor): void => {if (this.current()) {this.memory.remember(anchor); this.snapshot = this.read();}};
  season = async (id: string): Promise<void> => {
    const data = this.workspace.getSnapshot().data;
    if (!this.current() || !data || !this.snapshot.seasons.some(season => season.id === id)) return;
    await this.workspace.select({libraryId: data.scope.libraryId, showId: data.show.id, selectedSeasonId: id, playState: this.memory.getSnapshot().hideWatched ? 'unplayed' : 'all'});
    if (!this.current() || this.workspace.getSnapshot().data?.selected.seasonId !== id) return;
    this.memory.select({seasonId: id}); this.changed();
  };
  group = async (id: string): Promise<void> => {
    const data = this.workspace.getSnapshot().data;
    if (!this.current() || !data?.groups.some(group => group.id === id)) return;
    await this.workspace.select({libraryId: data.scope.libraryId, showId: data.show.id, group: id, playState: this.memory.getSnapshot().hideWatched ? 'unplayed' : 'all'});
    if (!this.current() || this.workspace.getSnapshot().data?.selected.group !== id) return;
    this.memory.select({group: id}); this.changed();
  };
  hideWatched = async (value: boolean): Promise<void> => {
    const data = this.workspace.getSnapshot().data;
    if (!this.current() || !data) return;
    await this.workspace.select({libraryId: data.scope.libraryId, showId: data.show.id,
      ...(data.selected.seasonId ? {selectedSeasonId: data.selected.seasonId} : data.selected.group ? {group: data.selected.group} : {}), playState: value ? 'unplayed' : 'all'});
    if (!this.current() || this.workspace.getSnapshot().phase !== 'ready' || this.workspace.getSnapshot().route?.playState !== (value ? 'unplayed' : 'all')) return;
    this.memory.select({hideWatched: value}); this.changed();
  };
  moreEpisodes = async (): Promise<void> => {if (this.current() && this.workspace.getSnapshot().phase === 'ready') await this.workspace.nextEpisodes();};
  moreSeasons = async (): Promise<void> => {if (this.current() && this.workspace.getSnapshot().phase === 'ready') await this.workspace.nextSeasons();};
  play = async (entry = this.entry, fromStart = false): Promise<void> => {
    if (!this.current()) return;
    const data = this.detail.getSnapshot().data;
    const primary = data?.actions.find(action => action.enabled && action.playback && (fromStart ? ['start_over', 'play_from_start'].includes(action.id) : ['resume', 'play'].includes(action.id)));
    const target = entry.id === data?.item.id ? primary?.playback : entry.playback;
    if (fromStart && (!primary?.playback || entry.id !== data?.item.id)) return;
    // Shows play only the actual server-projected continuation. No guessed first episode.
    const actual = fromStart ? primary?.playback : target ?? (entry.id === this.entry.id ? this.workspace.getSnapshot().data?.nextUp?.playback ?? entry.playback : entry.playback);
    if (!actual || fromStart && entry.id !== data?.item.id) return;
    await this.options.playback.start({entry, target: actual});
  };
  personal = async (intent: PersonalIntent): Promise<void> => {if (this.current()) await this.detail.mutate(intent);};
  dispose = (): void => {
    if (this.retired) return;
    this.retired = true;
    for (const off of this.off) off(); this.off = [];
    this.detail.dispose(); this.workspace.dispose(); this.pages.dispose(); this.snapshot = this.read();
    for (const listener of [...this.listeners]) listener(); this.listeners.clear();
  };
}
