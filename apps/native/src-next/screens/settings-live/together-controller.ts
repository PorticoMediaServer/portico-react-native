import type {GroupSessionService, GroupSessionSnapshot} from '../../../../../packages/client-core/src/group-session';
import type {GroupHostAuthority} from '../../../../../packages/client-core/src/social-playback';
import {NativeScreenLifetime, NativeScreenStore} from './lifetime';

/** A borrowed service is already bound to the same authenticated player/follower lifetime. */
export class NativeTogetherController extends NativeScreenStore<GroupSessionSnapshot> {
  private off: () => void;
  private disposed = false;
  constructor(readonly lifetime: NativeScreenLifetime, readonly service: GroupSessionService) {
    super(service.getSnapshot());
    this.off = service.subscribe(() => {if (!this.disposed && lifetime.current()) this.publish(service.getSnapshot());});
  }
  private async action<T>(work: () => Promise<T>): Promise<T> {this.lifetime.assert(); const value = await work(); this.lifetime.assert(); return value;}
  refresh = () => this.action(() => this.service.refreshDirectory());
  open = (id: string) => this.action(() => this.service.open(id));
  create = (name: string, displayName: string, hostAuthority: GroupHostAuthority) => this.action(() => this.service.create({name, displayName, hostAuthority}));
  join = (code: string, displayName: string) => this.action(() => this.service.join(code, displayName));
  dismiss(): void {this.lifetime.assert(); this.service.dismiss();}
  dispose(): void {if (this.disposed) return; this.disposed = true; this.off(); this.clearListeners();}
}
