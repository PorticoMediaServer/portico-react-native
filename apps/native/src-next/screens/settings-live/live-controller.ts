import type {ChannelApi} from '../../../../../packages/client-core/src/channel-guide';
import {fetchGuideSourceSummaries, type GuideSourceSummary} from '../../../../../packages/client-core/src/guide/directory';
import {legacyGuideSource, type LegacyGuideOptions} from '../../../../../packages/client-core/src/guide/legacy-source';
import {GuideWindowStore, type GuideViewport} from '../../../../../packages/client-core/src/guide/store';
import {NativeScreenLifetime, NativeScreenStore} from './lifetime';

export type NativeLiveSnapshot = Readonly<{sources: readonly GuideSourceSummary[]; loading: boolean; error?: unknown; options: LegacyGuideOptions; revision: number}>;
export class NativeLiveController extends NativeScreenStore<NativeLiveSnapshot> {
  private store: GuideWindowStore;
  private viewport?: GuideViewport;
  private disposed = false;
  private refreshSources?: Promise<void>;
  readonly api: ChannelApi;
  constructor(readonly lifetime: NativeScreenLifetime, api: ChannelApi, timezone: string) {
    const options: LegacyGuideOptions = {kind: 'all', sourceId: '', timezone, sort: 'number'};
    super({sources: [], loading: true, options, revision: 0});
    this.api = {request: <T>(path: string, method?: string, body?: unknown, signal?: AbortSignal) => lifetime.request(next => api.request<T>(path, method, body, next), signal)};
    this.store = this.makeStore(options);
  }
  private makeStore(options: LegacyGuideOptions) {
    return new GuideWindowStore({source: legacyGuideSource(this.api, this.lifetime.authority.serverId, options), maxInFlight: 2, maxChannelPages: 4, maxTiles: 16});
  }
  get guide(): GuideWindowStore {return this.store;}
  setViewport(viewport: GuideViewport): void {if (this.disposed || !this.lifetime.current()) return; this.viewport = viewport; this.store.setViewport(viewport);}
  select(change: Partial<Pick<LegacyGuideOptions, 'sourceId' | 'group' | 'favorites' | 'sort'>>): void {
    this.lifetime.assert();
    if (this.disposed) return;
    this.store.dispose();
    const state = this.getSnapshot(), options = {...state.options, ...change};
    this.store = this.makeStore(options);
    this.publish({...state, options, revision: state.revision + 1});
    if (this.viewport) this.store.setViewport({...this.viewport, firstRow: 0, lastRow: this.viewport.lastRow - this.viewport.firstRow});
  }
  loadSources(): Promise<void> {
    if (this.refreshSources) return this.refreshSources;
    this.lifetime.assert();
    return this.refreshSources = (async () => {
      try {
        const result = await fetchGuideSourceSummaries(this.api, this.lifetime.authority.serverId, this.getSnapshot().options.timezone, this.lifetime.signal);
        if (!this.disposed && this.lifetime.current()) this.publish({...this.getSnapshot(), sources: result.sources, loading: false, error: undefined});
      } catch (error) {if (!this.disposed && this.lifetime.current()) this.publish({...this.getSnapshot(), loading: false, error});}
    })().finally(() => {this.refreshSources = undefined;});
  }
  dispose(): void {if (this.disposed) return; this.disposed = true; this.store.dispose(); this.clearListeners();}
}
