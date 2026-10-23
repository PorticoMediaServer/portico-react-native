import type {GroupSessionService, GroupSessionSnapshot} from '../../../../../packages/client-core/src/group-session';
import type {GroupHostAuthority} from '../../../../../packages/client-core/src/social-playback';
import {NativeScreenLifetime, NativeScreenStore, screenScopeEnded} from './lifetime';

export type NativeTogetherService = Pick<GroupSessionService, 'getSnapshot' | 'subscribe' | 'refreshDirectory' | 'open' | 'create' | 'join' | 'dismiss' | 'serverNow' | 'refreshQueue' | 'transport' | 'invite' | 'makeHost' | 'queueRemove' | 'leave' | 'end'>;

/** A borrowed service is already bound to the same authenticated player/follower lifetime. */
export class NativeTogetherController extends NativeScreenStore<GroupSessionSnapshot> {
  private off: () => void;
  private disposed = false;
  readonly lifetime: NativeScreenLifetime;
  private service: NativeTogetherService;
  constructor(lifetime: NativeScreenLifetime, service: NativeTogetherService) {
    super(service.getSnapshot());
    this.lifetime = lifetime; this.service = service;
    this.off = service.subscribe(() => {if (!this.disposed && lifetime.current()) this.publish(service.getSnapshot());});
  }
  private async action<T>(work: () => Promise<T>): Promise<T> {this.lifetime.assert(); if (this.disposed) throw screenScopeEnded(); const value = await work(); this.lifetime.assert(); if (this.disposed) throw screenScopeEnded(); return value;}
  refresh = () => this.action(() => this.service.refreshDirectory());
  open = (id: string) => this.action(() => this.service.open(id));
  create = (name: string, displayName: string, hostAuthority: GroupHostAuthority) => this.action(() => this.service.create({name, displayName, hostAuthority}));
  join = (code: string, displayName: string) => this.action(() => this.service.join(code, displayName));
  serverNow = () => this.service.serverNow();
  refreshQueue = () => this.action(() => this.service.refreshQueue());
  transport = (...args: Parameters<GroupSessionService['transport']>) => this.action(() => this.service.transport(...args));
  invite = () => this.action(() => this.service.invite());
  makeHost = (memberId: string) => this.action(() => this.service.makeHost(memberId));
  queueRemove = (entryId: string) => this.action(() => this.service.queueRemove(entryId));
  leave = () => this.action(() => this.service.leave());
  end = () => this.action(() => this.service.end());
  dismiss(): void {this.lifetime.assert(); if (this.disposed) throw screenScopeEnded(); this.service.dismiss();}
  dispose(): void {if (this.disposed) return; this.disposed = true; this.off(); this.clearListeners();}
}
