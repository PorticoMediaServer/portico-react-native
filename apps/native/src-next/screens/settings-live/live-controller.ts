import {saveChannelPreference, type ChannelApi} from '../../../../../packages/client-core/src/channel-guide';
import {fetchGuideSourceSummaries, type GuideSourceSummary} from '../../../../../packages/client-core/src/guide/directory';
import {legacyChannel, legacyChannelRow, legacyGuideSource, type LegacyGuideOptions} from '../../../../../packages/client-core/src/guide/legacy-source';
import type {GuideChannelRow} from '../../../../../packages/client-core/src/guide/types';
import {GuideWindowStore, type GuideViewport} from '../../../../../packages/client-core/src/guide/store';
import {NativeScreenLifetime, NativeScreenStore} from './lifetime';

export type NativeLiveSnapshot = Readonly<{sources: readonly GuideSourceSummary[]; loading: boolean; error?: unknown; options: LegacyGuideOptions; revision: number; mutating: boolean; mutationError?: unknown}>;
export class NativeLiveController extends NativeScreenStore<NativeLiveSnapshot> {
  private store: GuideWindowStore;
  private viewport?: GuideViewport;
  private disposed = false;
  private refreshSources?: Promise<void>;
  private operationKeys = new Map<string, Promise<string>>();
  readonly api: ChannelApi;
  readonly lifetime: NativeScreenLifetime;
  constructor(lifetime: NativeScreenLifetime, api: ChannelApi, timezone: string) {
    const options: LegacyGuideOptions = {kind: 'all', sourceId: '', timezone, sort: 'number'};
    super({sources: [], loading: true, options, revision: 0, mutating: false});
    this.lifetime = lifetime;
    this.api = {request: <T>(path: string, method?: string, body?: unknown, signal?: AbortSignal) => lifetime.request(next => api.request<T>(path, method, body, next), signal)};
    this.store = this.makeStore(options);
  }
  private makeStore(options: LegacyGuideOptions) {
    return new GuideWindowStore({source: legacyGuideSource(this.api, this.lifetime.authority.serverId, options), maxInFlight: 2, maxChannelPages: 4, maxTiles: 16});
  }
  get guide(): GuideWindowStore {return this.store;}
  setViewport(viewport: GuideViewport): void {if (this.disposed || !this.lifetime.current()) return; this.viewport = viewport; this.store.setViewport(viewport);}
  select(change: Partial<Pick<LegacyGuideOptions, 'kind' | 'sourceId' | 'group' | 'favorites' | 'sort'>>): void {
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
  clearMutationError(): void {if (!this.disposed && this.lifetime.current()) this.publish({...this.getSnapshot(), mutationError: undefined});}
  /** The native crypto port supplies the existing 48hex protocol key. An unknown outcome
   * retains its exact key and expected revision; never rebase or optimistically toggle it. */
  async channelPreference(channel: GuideChannelRow, values: Readonly<{favorite: boolean; hidden: boolean}>, requestId: () => Promise<string>): Promise<GuideChannelRow | undefined> {
    this.lifetime.assert();
    if (this.disposed || this.getSnapshot().mutating) return undefined;
    const raw = legacyChannel(channel);
    if (!raw) throw new Error('native_channel_record_missing');
    const key = JSON.stringify([raw.provenance, raw.sourceId, raw.id, raw.generation, raw.preferenceRevision, values]);
    this.publish({...this.getSnapshot(), mutating: true, mutationError: undefined});
    try {
      let operation = this.operationKeys.get(key);
      if (!operation) {
        // Only unresolved intents occupy slots; a failed generator never occupies one.
        if (this.operationKeys.size >= 16) throw new Error('native_channel_receipt_limit');
        operation = requestId(); this.operationKeys.set(key, operation);
        const pending = operation;
        operation.catch(() => {if (this.operationKeys.get(key) === pending) this.operationKeys.delete(key);});
      }
      const revision = await saveChannelPreference(this.api, this.lifetime.authority.serverId, raw, await operation, values, this.lifetime.signal);
      this.lifetime.assert();
      if (this.disposed) return undefined;
      this.operationKeys.delete(key);
      const committed = legacyChannelRow({...raw, ...values, preferenceRevision: revision});
      this.store.reset(); void this.loadSources();
      return committed;
    } catch (mutationError) {if (!this.disposed && this.lifetime.current()) this.publish({...this.getSnapshot(), mutationError}); return undefined;}
    finally {if (!this.disposed && this.lifetime.current()) this.publish({...this.getSnapshot(), mutating: false});}
  }
  dispose(): void {if (this.disposed) return; this.disposed = true; this.store.dispose(); this.operationKeys.clear(); this.clearListeners();}
}
