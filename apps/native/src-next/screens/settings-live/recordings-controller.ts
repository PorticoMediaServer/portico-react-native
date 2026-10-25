import {DVRClient, type DeletePreview, type DVRPage, type DVRSummary, type DVRView, type Occurrence, type Recording, type RecordingDetail, type RecordingDraft, type RecordingGroups, type RecordingOptions, type RecordingRule, type RecordingStorage, type RuleConfig, type RulePreview, type StoragePolicy} from '../../../../../packages/client-core/src/dvr';
import type {ChannelApi} from '../../../../../packages/client-core/src/channel-guide';
import type {DVRCommandLifetime} from '../../../../../packages/client-core/src/dvr';
import {NativeScreenLifetime, NativeScreenStore, screenScopeEnded} from './lifetime';

export type NativeRecordingQuery = Readonly<{view: DVRView; cursor?: string; sort?: 'recent' | 'title' | 'oldest'; group?: string}>;
export type NativeRecordingsSnapshot = Readonly<{
  query: NativeRecordingQuery; page?: DVRPage; groups?: RecordingGroups; storage?: RecordingStorage; summary?: DVRSummary;
  loading: boolean; busy: boolean; error?: unknown; accessDenied: boolean;
}>;
export type NativeRecordingService = Pick<DVRClient, 'list' | 'groups' | 'summary' | 'storage' | 'detail' | 'deletePreview' | 'preview' | 'newRuleID' | 'schedule' | 'update' | 'cancel' | 'keep' | 'delete' | 'saveRule' | 'deleteRule' | 'saveStorage' | 'onAccessChanged' | 'dispose'>;

/** One genuine DVR client per viewer lifetime. Never activate/reset its unknown-outcome receipts
 * on a view change. Cursor pages stay pages; no fabricated random offsets or whole-DVR scan. */
export class NativeRecordingsController extends NativeScreenStore<NativeRecordingsSnapshot> {
  readonly lifetime: NativeScreenLifetime;
  private service: NativeRecordingService;
  private disposed = false;
  private epoch = 0;
  private pending?: Readonly<{query: NativeRecordingQuery; epoch: number}>;
  private worker?: Promise<void>;
  private facts?: Promise<void>;
  constructor(lifetime: NativeScreenLifetime, service: NativeRecordingService) {
    super({query: {view: 'upcoming'}, loading: false, busy: false, accessDenied: false});
    this.lifetime = lifetime; this.service = service;
    service.onAccessChanged(() => {
      this.pending = undefined; this.epoch++;
      if (this.current()) this.publish({query: this.getSnapshot().query, loading: false, busy: false, accessDenied: true, error: {status: 403}});
    });
  }
  private current = () => !this.disposed && this.lifetime.current();
  private assert() {this.lifetime.assert(); if (this.disposed) throw screenScopeEnded();}
  load(query: NativeRecordingQuery = this.getSnapshot().query): Promise<void> {
    this.assert();
    if (this.getSnapshot().accessDenied) return Promise.resolve();
    const epoch = ++this.epoch, previous = this.getSnapshot();
    const same = JSON.stringify(previous.query) === JSON.stringify(query);
    this.publish({...previous, query: Object.freeze({...query}), page: same ? previous.page : undefined, groups: same ? previous.groups : undefined, loading: true, error: undefined});
    this.pending = {query, epoch};
    // Moving focus quickly across the five chips replaces pending work, instead of queuing
    // private reads for every intermediate selection. At most one page read is in flight.
    if (!this.worker) this.worker = this.drain().finally(() => {this.worker = undefined;});
    return this.worker;
  }
  private async drain(): Promise<void> {
    while (this.pending && this.current()) {
      const {query, epoch} = this.pending; this.pending = undefined;
      try {
        const result = query.view === 'storage' ? {storage: await this.service.storage()}
          : query.view === 'recorded' && !query.group ? {groups: await this.service.groups(query.sort ?? 'recent', query.cursor)}
          : {page: await this.service.list(query.view, query.cursor, query.sort ?? 'recent', query.group)};
        if (this.current() && epoch === this.epoch && !this.getSnapshot().accessDenied) this.publish({...this.getSnapshot(), ...result, loading: false, error: undefined});
      } catch (error) {if (this.current() && epoch === this.epoch && !this.getSnapshot().accessDenied) this.publish({...this.getSnapshot(), loading: false, error});}
    }
  }
  loadFacts(): Promise<void> {
    this.assert();
    if (this.getSnapshot().accessDenied) return Promise.resolve();
    if (this.facts) return this.facts;
    // Header counts and storage come from authoritative aggregate reads, never the loaded page.
    return this.facts = (async () => {
      const summary = await this.service.summary();
      if (!this.current() || this.getSnapshot().accessDenied) return;
      this.publish({...this.getSnapshot(), summary});
      const storage = await this.service.storage();
      if (this.current() && !this.getSnapshot().accessDenied) this.publish({...this.getSnapshot(), storage});
    })().catch(error => {if (this.current() && !this.getSnapshot().accessDenied) this.publish({...this.getSnapshot(), error});}).finally(() => {this.facts = undefined;});
  }
  private async read<T>(work: () => Promise<T>): Promise<T> {this.assert(); const result = await work(); this.assert(); if (this.getSnapshot().accessDenied) throw screenScopeEnded(); return result;}
  detail = (id: string, after?: string): Promise<RecordingDetail> => this.read(() => this.service.detail(id, after));
  deletePreview = (recording: Recording): Promise<DeletePreview> => this.read(() => this.service.deletePreview(recording));
  private requireCommand(lifetime?: DVRCommandLifetime): void {
    if (lifetime && (!this.current() || lifetime.signal.aborted || !lifetime.isCurrent())) throw screenScopeEnded();
  }
  async act<T>(work: (service: NativeRecordingService) => Promise<T>, lifetime?: DVRCommandLifetime): Promise<Readonly<{value: T}> | undefined> {
    const original = lifetime ? Object.freeze({signal: lifetime.signal, isCurrent: lifetime.isCurrent}) : undefined;
    this.requireCommand(original);
    this.assert();
    if (this.getSnapshot().busy || this.getSnapshot().accessDenied) return undefined;
    this.publish({...this.getSnapshot(), busy: true, error: undefined});
    try {
      this.requireCommand(original);
      const value = await this.read(() => work(this.service));
      this.requireCommand(original);
      // A receipt is the success boundary. Refreshing another current view never changes
      // the mutation's expectedRevision or creates a replacement retry request id.
      // A Watch command returns its real receipt to that opening. Do not start
      // an unscoped refresh that could adopt into a replacement route; the DVR
      // screen keeps its ordinary authoritative reads when entered.
      if (!original) {void this.load(); void this.loadFacts();}
      this.requireCommand(original);
      return {value};
    } catch (error) {
      this.requireCommand(original);
      if (this.current() && !this.getSnapshot().accessDenied) this.publish({...this.getSnapshot(), error});
      this.requireCommand(original);
      if (original) throw error;
      return undefined;
    }
    finally {if (this.current()) this.publish({...this.getSnapshot(), busy: false});this.requireCommand(original);}
  }
  schedule = (draft: RecordingDraft, options: RecordingOptions, lifetime?: DVRCommandLifetime) => {
    const original = lifetime ? Object.freeze({signal: lifetime.signal, isCurrent: lifetime.isCurrent}) : undefined;
    this.requireCommand(original);
    const capturedDraft = original ? Object.freeze({channel: Object.freeze({...draft.channel}), programme: Object.freeze({...draft.programme}), series: draft.series}) : draft;
    const capturedOptions = original ? Object.freeze({...options}) : options;
    return this.act(service => service.schedule(capturedDraft, capturedOptions, original), original);
  };
  cancel = (recording: Recording) => this.act(service => service.cancel(recording));
  keep = (recording: Recording) => this.act(service => service.keep(recording));
  remove = (recording: Recording, preview: DeletePreview) => this.act(service => service.delete(recording, preview));
  storage = (): Promise<RecordingStorage> => this.read(() => this.service.storage());
  saveStorage = (policy: StoragePolicy) => this.act(service => service.saveStorage(policy));
  resolve = (detail: RecordingDetail) => this.act(service => service.update(detail.recording, {...detail.recording.options, priority: Math.min(1000, Math.max(detail.recording.options.priority, ...detail.overlaps.map(value => value.priority)) + 1)}));
  saveRule = (rule: RecordingRule, config: RuleConfig) => this.act(service => service.saveRule(rule.id, rule.revision, config));
  /** A new rule is a client-named canonical id with expected revision zero; the receipt is the success boundary. */
  newRuleID = async (lifetime: DVRCommandLifetime): Promise<string> => {
    const original = Object.freeze({signal: lifetime.signal, isCurrent: lifetime.isCurrent});this.requireCommand(original);
    try {const id = await this.service.newRuleID(original);this.requireCommand(original);return id;}
    catch (error) {this.requireCommand(original);throw error;}
  };
  createRule = (config: RuleConfig, anchor: Occurrence, lifetime?: DVRCommandLifetime, preparedId?: Promise<string>) => {
    const original = lifetime ? Object.freeze({signal: lifetime.signal, isCurrent: lifetime.isCurrent}) : undefined;this.requireCommand(original);
    const captured = original ? Object.freeze({...config, allowedChannels: [...config.allowedChannels], blockedChannels: [...config.blockedChannels],
      keywords: [...config.keywords], blockedKeywords: [...config.blockedKeywords], options: Object.freeze({...config.options})}) : config;
    const capturedAnchor = original ? Object.freeze({...anchor}) : anchor;
    return this.act(async service => {
      const id = await (preparedId ?? service.newRuleID(original));this.requireCommand(original);
      return service.saveRule(id, 0, captured, capturedAnchor, original);
    }, original);
  };
  previewRule = async (config: RuleConfig, lifetime?: DVRCommandLifetime): Promise<RulePreview> => {
    const original = lifetime ? Object.freeze({signal: lifetime.signal, isCurrent: lifetime.isCurrent}) : undefined;this.requireCommand(original);
    try {const preview = await this.read(() => this.service.preview(config, original));this.requireCommand(original);return preview;}
    catch (error) {this.requireCommand(original);throw error;}
  };
  deleteRule = (rule: RecordingRule, future: 'keep' | 'cancel') => this.act(service => service.deleteRule(rule, future));
  dispose(): void {if (this.disposed) return; this.disposed = true; this.epoch++; this.pending = undefined; this.service.dispose(); this.publish({query: this.getSnapshot().query, loading: false, busy: false, accessDenied: true}); this.clearListeners();}
}

export function createNativeRecordingsController(lifetime: NativeScreenLifetime, api: ChannelApi, requestId: () => Promise<string>): NativeRecordingsController {
  return new NativeRecordingsController(lifetime, new DVRClient(api, lifetime.authority.serverId, requestId));
}
