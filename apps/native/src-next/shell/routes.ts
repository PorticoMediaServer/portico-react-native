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

export type NativeRouteSnapshot = Readonly<{authority: ShellAuthority; route: NativeShellRoute; destination: ShellDestination; revision: number; intent: 'enter' | 'restore' | 'top'}>;
export type NativeDestinationActivation = Readonly<{visible: boolean; intent: NativeRouteSnapshot['intent']; revision: number}>;

/** A screen observes genuine navigation intent without sharing its scroll,
 * filters or focus memory with another destination. Snapshots stay referentially stable. */
export function nativeDestinationActivation(navigation: NativeShellNavigation, destination: ShellDestination) {
  let previous: NativeRouteSnapshot | undefined, value: NativeDestinationActivation;
  return {subscribe: navigation.subscribe, getSnapshot: (): NativeDestinationActivation => {
    const state = navigation.getSnapshot();
    if (state !== previous) {
      previous = state;
      value = Object.freeze({visible: state.route.kind === 'shell' && JSON.stringify(state.route.destination) === JSON.stringify(destination), intent: state.intent, revision: state.revision});
    }
    return value;
  }};
}

/** A title highlights its actual authorized library without replacing the
 * mounted origin destination or the history used to return to it. */
export function nativeRailDestination(snapshot: NativeRouteSnapshot, libraries: readonly Readonly<{id: string}>[]): ShellDestination {
  const route = snapshot.route;
  const libraryId = route.kind === 'title' ? route.entry.libraryId : undefined;
  return libraryId && libraries.some(library => library.id === libraryId)
    ? {kind: 'library', libraryId} : snapshot.destination;
}

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
    this.snapshot = Object.freeze({authority, route, destination, revision: 0, intent: 'enter'});
  }
  getSnapshot = (): NativeRouteSnapshot => this.snapshot;
  subscribe = (listener: () => void): (() => void) => {this.listeners.add(listener); return () => {this.listeners.delete(listener);};};
  private current(authority: ShellAuthority): boolean {
    return this.alive && sameAuthority(authority, this.snapshot.authority) && sameAuthority(authority, this.currentAuthority());
  }
  open(route: NativeShellRoute, expectedAuthority: ShellAuthority): boolean {
    if (!this.current(expectedAuthority)) return false;
    this.history.push(this.snapshot.route);
    this.publish(route, 'enter');
    return true;
  }
  back(expectedAuthority: ShellAuthority): boolean {
    if (!this.current(expectedAuthority)) return false;
    const route = this.history.pop();
    if (!route) return false;
    this.publish(route, 'restore');
    return true;
  }
  top(destination: ShellDestination, expectedAuthority: ShellAuthority): boolean {
    if (!this.current(expectedAuthority) || this.snapshot.route.kind !== 'shell' || JSON.stringify(destination) !== JSON.stringify(this.snapshot.destination)) return false;
    this.publish(this.snapshot.route, 'top'); return true;
  }
  private publish(route: NativeShellRoute, intent: NativeRouteSnapshot['intent']): void {
    this.snapshot = Object.freeze({...this.snapshot, route, intent, destination: route.kind === 'shell' ? route.destination : this.snapshot.destination, revision: this.snapshot.revision + 1});
    for (const listener of [...this.listeners]) listener();
  }
  dispose(): void {this.alive = false; this.history = []; this.listeners.clear();}
}
