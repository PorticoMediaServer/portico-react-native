import {RemoteSourceService, type RemoteState} from '../../../../../../packages/client-core/src/remote-sources';
import {NativeScreenLifetime, NativeScreenStore, screenScopeEnded} from '../../settings-live/lifetime';
import type {NativeSettingsLivePorts} from '../../settings-live/ports';

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
          const result = await ports.context.api.request<T>(path, method, body, current);
          if (!admitted()) throw screenScopeEnded();
          return result;
        }, signal);
      },
    }, {serverId: lifetime.authority.serverId, viewerId: lifetime.authority.profileId}, async () => {
      if (!admitted()) throw screenScopeEnded();
      return `${Date.now()}-${ports.requestId()}`;
    });
    super({allowed: admitted(), sources: {...service.getSnapshot(), loading: admitted()}});
    this.ports = ports;
    this.lifetime = lifetime;
    this.service = service;
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
