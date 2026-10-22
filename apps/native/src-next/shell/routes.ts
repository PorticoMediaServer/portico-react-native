import type {ContentEntry} from '../../../../packages/client-core/src/library-content';
import type {HomeChannel, HomeSeeAll} from '../../../../packages/client-core/src/home';
import {sameAuthority, type ShellAuthority, type ShellDestination} from './model';

/** Descriptors are requests to the registered phase owner, never synthesized screen content. */
export type NativeShellRoute = Readonly<
  | {kind: 'shell'; destination: ShellDestination}
  | {kind: 'title'; entry: ContentEntry}
  | {kind: 'channel'; sourceId: string; channelId: string}
  | {kind: 'home-see-all'; destination: HomeSeeAll}
  | {kind: 'home-customize'}
  | {kind: 'profiles'; profileId?: string}
  | {kind: 'servers'}
  | {kind: 'notifications'}
  | {kind: 'together'}
  | {kind: 'account'}
  | {kind: 'saved-destination'; destination: Readonly<{kind: 'playlist' | 'collection'; id: string}>}
  | {kind: 'server-dashboard'}
  | {kind: 'library-save-view' | 'library-mark-all' | 'library-edit-pins' | 'library-settings'; libraryId: string}
>;

export const titleRoute = (entry: ContentEntry): NativeShellRoute => Object.freeze({kind: 'title', entry});
export const channelRoute = (item: HomeChannel): NativeShellRoute => Object.freeze({kind: 'channel', sourceId: item.source.id, channelId: item.channel.id});

export type NativeRouteSnapshot = Readonly<{authority: ShellAuthority; route: NativeShellRoute; destination: ShellDestination; revision: number}>;

/** One authority lifetime and one history. Async callers must retain the authority they read. */
export class NativeShellNavigation {
  private snapshot: NativeRouteSnapshot;
  private history: NativeShellRoute[] = [];
  private listeners = new Set<() => void>();
  private alive = true;
  readonly currentAuthority: () => ShellAuthority;
  constructor(authority: ShellAuthority, currentAuthority: () => ShellAuthority) {
    this.currentAuthority = currentAuthority;
    const destination: ShellDestination = {kind: 'home'};
    const route: NativeShellRoute = {kind: 'shell', destination};
    this.snapshot = Object.freeze({authority, route, destination, revision: 0});
  }
  getSnapshot = (): NativeRouteSnapshot => this.snapshot;
  subscribe = (listener: () => void): (() => void) => {this.listeners.add(listener); return () => {this.listeners.delete(listener);};};
  private current(authority: ShellAuthority): boolean {
    return this.alive && sameAuthority(authority, this.snapshot.authority) && sameAuthority(authority, this.currentAuthority());
  }
  open(route: NativeShellRoute, expectedAuthority: ShellAuthority): boolean {
    if (!this.current(expectedAuthority)) return false;
    this.history.push(this.snapshot.route);
    this.publish(route);
    return true;
  }
  back(expectedAuthority: ShellAuthority): boolean {
    if (!this.current(expectedAuthority)) return false;
    const route = this.history.pop();
    if (!route) return false;
    this.publish(route);
    return true;
  }
  private publish(route: NativeShellRoute): void {
    this.snapshot = Object.freeze({...this.snapshot, route, destination: route.kind === 'shell' ? route.destination : this.snapshot.destination, revision: this.snapshot.revision + 1});
    for (const listener of [...this.listeners]) listener();
  }
  dispose(): void {this.alive = false; this.history = []; this.listeners.clear();}
}
