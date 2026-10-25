import {RemoteSourceService, type RemoteState, type RemoteSource, type DAVConfiguration, type DAVConnectionInput, type DAVConnectionResult, type SourceReadSettings, type SourceReadValues} from '../../../../../../packages/client-core/src/remote-sources';
import {NativeScreenLifetime, NativeScreenStore, screenScopeEnded} from '../../settings-live/lifetime';
import type {NativeSettingsLivePorts} from '../../settings-live/ports';

function terminalRefusal(error: unknown): boolean {
  if (!error || typeof error !== 'object') return false;
  const refusal = error as {status?: unknown; statusCode?: unknown; code?: unknown};
  return refusal.status === 401 || refusal.status === 403 || refusal.statusCode === 401 || refusal.statusCode === 403
    || refusal.code === 'unauthorized' || refusal.code === 'forbidden' || refusal.code === 'not_permitted';
}

export type NativeRemoteSourcesSnapshot = Readonly<{allowed: boolean; sources: RemoteState}>;

/** A screen owns its reads. It neither borrows the legacy panel nor persists credential drafts. */
export class NativeRemoteSourcesController extends NativeScreenStore<NativeRemoteSourcesSnapshot> {
  private readonly lifetime: NativeScreenLifetime;
  private readonly service: RemoteSourceService;
  private readonly ports: NativeSettingsLivePorts;
  private offService: () => void = () => {};
  private offAuthority: () => void = () => {};
  private disposed = false;

  constructor(ports: NativeSettingsLivePorts) {
    const lifetime = new NativeScreenLifetime(ports.context);
    let retire = () => lifetime.dispose();
    const admitted = () => {
      const account = ports.context.account;
      return lifetime.current() && account.canManage && !account.account.disabled
        && account.account.role === 'owner'
        && account.serverId === lifetime.authority.serverId
        && account.account.id === lifetime.authority.accountId
        && account.account.primaryProfileId === lifetime.authority.profileId;
    };
    const service = new RemoteSourceService({
      request: <T,>(path: string, method?: string, body?: unknown, signal?: AbortSignal) => {
        if (!admitted()) return Promise.reject(screenScopeEnded());
        return lifetime.request(async current => {
          try {
            const result = await ports.context.api.request<T>(path, method, body, current);
            if (!admitted()) throw screenScopeEnded();
            return result;
          } catch (error) {
            if (terminalRefusal(error)) retire();
            throw error;
          }
        }, signal);
      },
    }, {serverId: lifetime.authority.serverId, viewerId: lifetime.authority.profileId}, async () => {
      if (!admitted()) throw screenScopeEnded();
      return `${Date.now()}-${ports.requestId()}`;
    }, admitted);
    super({allowed: admitted(), sources: {...service.getSnapshot(), loading: admitted()}});
    this.ports = ports;
    this.lifetime = lifetime;
    this.service = service;
    retire = () => this.dispose();
    this.offService = service.subscribe(() => {
      if (!this.allowed()) {this.dispose(); return;}
      this.publish({allowed: true, sources: service.getSnapshot()});
    });
    this.offAuthority = ports.context.subscribeAuthority(() => {
      if (!this.allowed()) this.dispose();
    });
  }

  private allowed(): boolean {
    const account = this.ports.context.account;
    return !this.disposed && this.lifetime.current() && account.canManage && !account.account.disabled
      && account.account.role === 'owner' && account.serverId === this.lifetime.authority.serverId
      && account.account.id === this.lifetime.authority.accountId
      && account.account.primaryProfileId === this.lifetime.authority.profileId;
  }

  async load(): Promise<void> {
    if (!this.allowed()) {this.dispose(); return;}
    await this.service.load();
    if (!this.allowed()) this.dispose();
  }

  private assertAllowed(): void {
    if (!this.allowed()) {this.dispose(); throw screenScopeEnded();}
  }

  /** Credential fields stay in this call and the service request, never in a snapshot. */
  async testConnection(input: DAVConnectionInput, guard: () => boolean = () => true): Promise<DAVConnectionResult> {
    this.assertAllowed();
    try {
      if (!guard()) throw screenScopeEnded();
      const result = await this.service.testConnection(input, guard);
      if (!guard()) throw screenScopeEnded();
      this.assertAllowed();
      return result;
    } finally {if (!this.allowed()) this.dispose();}
  }

  async configure(id: string | null, input: DAVConfiguration, base?: RemoteSource, guard: () => boolean = () => true): Promise<void> {
    this.assertAllowed();
    try {if (!guard()) throw screenScopeEnded(); await this.service.configure(id, input, base, guard);}
    finally {if (!this.allowed()) this.dispose();}
  }

  async remove(source: RemoteSource, guard: () => boolean = () => true): Promise<void> {
    this.assertAllowed();
    try {if (!guard()) throw screenScopeEnded(); await this.service.remove(source, guard);}
    finally {if (!this.allowed()) this.dispose();}
  }

  async readProfile(source: RemoteSource, guard: () => boolean): Promise<SourceReadSettings> {
    this.assertAllowed();
    try {
      const result = await this.service.readProfile(source.id, String(source.generation), guard);
      this.assertAllowed();
      if (!guard()) throw screenScopeEnded();
      return result;
    } finally {if (!this.allowed()) this.dispose();}
  }

  async saveProfile(profile: SourceReadSettings, values: SourceReadValues, guard: () => boolean): Promise<SourceReadSettings> {
    this.assertAllowed();
    try {
      const result = await this.service.saveProfile(profile, values, guard);
      this.assertAllowed();
      if (!guard()) throw screenScopeEnded();
      return result;
    } finally {if (!this.allowed()) this.dispose();}
  }

  async recover(): Promise<void> {
    this.assertAllowed();
    try {await this.service.recover();}
    finally {if (!this.allowed()) this.dispose();}
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.offAuthority();
    this.offService();
    this.service.dispose();
    this.lifetime.dispose();
    this.publish({allowed: false, sources: this.service.getSnapshot()});
    this.clearListeners();
  }
}
