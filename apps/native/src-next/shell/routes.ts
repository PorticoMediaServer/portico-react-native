import type {ContentEntry} from '../../../../packages/client-core/src/library-content';
import type {HomeChannel, HomeSeeAll} from '../../../../packages/client-core/src/home';
import {sameAuthority, type ShellAuthority, type ShellDestination} from './model';

/** Descriptors are requests to the registered phase owner, never synthesized screen content. */
export type NativeShellRoute = Readonly<
  | {kind: 'shell'; destination: ShellDestination}
  | {kind: 'title'; entry: ContentEntry}
  | {kind: 'read'; itemId: string; sourceId: string}
  | {kind: 'settings-page'; scope: 'account'; page: 'reading'}
  | {kind: 'channel'; sourceId: string; channelId: string}
  | {kind: 'home-see-all'; destination: HomeSeeAll}
  | {kind: 'home-customize'}
  | {kind: 'profiles'; profileId?: string}
  | {kind: 'servers'}
  | {kind: 'notifications'}
  | {kind: 'together'}
  | {kind: 'account'}
  | {kind: 'downloads'}
  | {kind: 'saved-destination'; destination: Readonly<{kind: 'playlist' | 'collection'; id: string}>}
  | {kind: 'server-dashboard'}
  | {kind: 'library-save-view' | 'library-mark-all' | 'library-edit-pins' | 'library-settings'; libraryId: string}
>;

export const titleRoute = (entry: ContentEntry): NativeShellRoute => Object.freeze({kind: 'title', entry});
export const channelRoute = (item: HomeChannel): NativeShellRoute => Object.freeze({kind: 'channel', sourceId: item.source.id, channelId: item.channel.id});

export type NativeRouteSnapshot = Readonly<{authority: ShellAuthority; route: NativeShellRoute; destination: ShellDestination; revision: number}>;
export type NativeDestinationIntent = 'enter' | 'restore' | 'top';
export type NativeDestinationActivation = Readonly<{visible: boolean; intent: NativeDestinationIntent; revision: number}>;
export type NativeDestinationActivationPort = Readonly<{subscribe: (listener: () => void) => () => void; getSnapshot: () => NativeDestinationActivation}>;
export type NativeRouteAdmission = (route: NativeShellRoute, origin: ShellDestination) => boolean;
const sameDestination = (a: ShellDestination, b: ShellDestination): boolean => a.kind === b.kind &&
  (a.kind !== 'library' || b.kind === 'library' && a.libraryId === b.libraryId);

/** Read real navigation intent without taking ownership of screen focus or scroll memory. */
export function nativeDestinationActivation(navigation: NativeShellNavigation, destination: ShellDestination): NativeDestinationActivationPort {
  const target = Object.freeze({...destination});
  let previous: NativeRouteSnapshot | undefined, previousCurrent: boolean | undefined, value: NativeDestinationActivation;
  return Object.freeze({subscribe: navigation.subscribe, getSnapshot: (): NativeDestinationActivation => {
    const state = navigation.getSnapshot(), current = navigation.isCurrent();
    if (state !== previous || current !== previousCurrent) {
      previous = state; previousCurrent = current;
      value = Object.freeze({visible: current && state.route.kind === 'shell' && sameDestination(state.route.destination, target),
        intent: navigation.getIntent(), revision: state.revision});
    }
    return value;
  }});
}

/** Highlight the title's actual authorized library while retaining its mounted origin for Back. */
export function nativeRailDestination(snapshot: NativeRouteSnapshot, libraries: readonly Readonly<{id: string}>[]): ShellDestination {
  const libraryId = snapshot.route.kind === 'title' ? snapshot.route.entry.libraryId : undefined;
  return libraryId && libraries.some(library => library.id === libraryId) ? {kind: 'library', libraryId} : snapshot.destination;
}

/** One authority lifetime and one history. Async callers must retain the authority they read. */
export class NativeShellNavigation {
  private snapshot: NativeRouteSnapshot;
  private history: Readonly<{route: NativeShellRoute; destination: ShellDestination}>[] = [];
  private retained: readonly NativeShellRoute[] = Object.freeze([]);
  private listeners = new Set<() => void>();
  private alive = true;
  private intent: NativeDestinationIntent = 'enter';
  readonly currentAuthority: () => ShellAuthority;
  private readonly admission?: NativeRouteAdmission;
  constructor(authority: ShellAuthority, currentAuthority: () => ShellAuthority, admission?: NativeRouteAdmission) {
    this.currentAuthority = currentAuthority;
    this.admission = admission;
    const destination: ShellDestination = {kind: 'home'};
    const route: NativeShellRoute = {kind: 'shell', destination};
    this.snapshot = Object.freeze({authority, route, destination, revision: 0});
  }
  getSnapshot = (): NativeRouteSnapshot => this.snapshot;
  /** Exact route descriptors still in this authority's Back stack. */
  retainedRoutes = (): readonly NativeShellRoute[] => this.isCurrent() ? this.retained : [];
  getIntent = (): NativeDestinationIntent => this.intent;
  isCurrent = (): boolean => this.current(this.snapshot.authority);
  allows = (route: NativeShellRoute, origin: ShellDestination = route.kind === 'shell' ? route.destination : this.snapshot.destination): boolean =>
    this.isCurrent() && (this.admission?.(route, origin) ?? true);
  subscribe = (listener: () => void): (() => void) => {this.listeners.add(listener); return () => {this.listeners.delete(listener);};};
  private current(authority: ShellAuthority): boolean {
    return this.alive && sameAuthority(authority, this.snapshot.authority) && sameAuthority(authority, this.currentAuthority());
  }
  open(route: NativeShellRoute, expectedAuthority: ShellAuthority): boolean {
    if (!this.current(expectedAuthority) || !this.allows(route)) return false;
    this.history.push({route: this.snapshot.route, destination: this.snapshot.destination});
    this.publish(route, 'enter');
    return true;
  }
  back(expectedAuthority: ShellAuthority): boolean {
    if (!this.current(expectedAuthority)) return false;
    const entry = this.history.at(-1);
    if (!entry || !this.allows(entry.route, entry.destination)) return false;
    this.history.pop();
    this.publish(entry.route, 'restore', entry.destination);
    return true;
  }
  top(destination: ShellDestination, expectedAuthority: ShellAuthority): boolean {
    if (!this.current(expectedAuthority) || this.snapshot.route.kind !== 'shell' || !sameDestination(destination, this.snapshot.route.destination) || !this.allows(this.snapshot.route)) return false;
    this.publish(this.snapshot.route, 'top'); return true;
  }
  private publish(route: NativeShellRoute, intent: NativeDestinationIntent, restoredDestination?: ShellDestination): void {
    this.intent = intent;
    this.retained = Object.freeze(this.history.map(entry => entry.route));
    this.snapshot = Object.freeze({...this.snapshot, route, destination: restoredDestination ?? (route.kind === 'shell' ? route.destination : this.snapshot.destination), revision: this.snapshot.revision + 1});
    for (const listener of [...this.listeners]) listener();
  }
  dispose(): void {
    if (!this.alive) return;
    this.alive = false; this.history = []; this.retained = Object.freeze([]);
    for (const listener of [...this.listeners]) listener();
    this.listeners.clear();
  }
}
