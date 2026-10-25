import type {ReadingHostContentsTarget} from '../../../../packages/client-core/src/reading-host';
import type {ContentEntry} from '../../../../packages/client-core/src/library-content';
import type {HomeChannel, HomeSeeAll} from '../../../../packages/client-core/src/home';
import type {SavedRoute} from '../../../../packages/client-core/src/saved';
import type {ReadingItem} from '../../../../packages/client-core/src/reading';
import {sameAuthority, type ShellAuthority, type ShellDestination} from './model';

/** Descriptors are requests to the registered phase owner, never synthesized screen content. */
export type NativeContinueWatchingOffer = Readonly<{itemId: string; revision: number}>;
export type NativeShellRoute = Readonly<
  | {kind: 'shell'; destination: ShellDestination}
  | {kind: 'title'; entry: ContentEntry; continueWatching?: NativeContinueWatchingOffer}
  | {kind: 'music'; entry: ContentEntry}
  | {kind: 'music-discover'}
  | {kind: 'book'; entry: ContentEntry}
  | {kind: 'audiobook'; entry: ContentEntry}
  | {kind: 'person'; personId: string}
  | {kind: 'read'; itemId: string; sourceId: string; downloadId?: string; contentsTarget?: ReadingHostContentsTarget}
  | {kind: 'read-book'; libraryId: string; item: ReadingItem}
  | {kind: 'read-series'; libraryId: string; seriesId: string}
  | {kind: 'settings-page'; scope: 'account'; page: 'reading'}
  | {kind: 'channel'; sourceId: string; channelId: string}
  | {kind: 'home-see-all'; destination: HomeSeeAll}
  | {kind: 'home-customize'}
  | {kind: 'profiles'; profileId?: string}
  | {kind: 'servers'}
  | {kind: 'notifications'}
  | {kind: 'licenses'}
  | {kind: 'together'}
  | {kind: 'account'}
  | {kind: 'downloads'}
  | {kind: 'edit-pins'}
  | {kind: 'search-genre'; value: string; label: string}
  | {kind: 'search-genres'}
  | {kind: 'saved-view'; view: SavedRoute}
  | {kind: 'saved-destination'; destination: Readonly<{kind: 'playlist' | 'collection'; id: string}>}
  | {kind: 'settings-equalizer'}
  | {kind: 'recordings'}
  | {kind: 'server-feedback'}
  | {kind: 'server-dashboard'}
  | {kind: 'server-settings'; page?: 'libraries' | 'remote' | 'people' | 'troubleshooting'}
  | {kind: 'server-segments'}
  | {kind: 'collection'; libraryId: string; collectionId: string; title: string}
  | {kind: 'library-edit-pins' | 'library-settings'; libraryId: string}
>;

export const titleRoute = (entry: ContentEntry, continueWatching?: NativeContinueWatchingOffer): NativeShellRoute =>
  Object.freeze({kind: 'title', entry, ...(continueWatching ? {continueWatching} : {})});
/** The Home entry's own offer and personal revision, captured with the route; never a new read. */
type ContinueSource = ContentEntry & {homeActions?: {removeFromContinue?: boolean; state?: {personalRevision?: number}}};
const continueOffer = (entry: ContentEntry): NativeContinueWatchingOffer | undefined => {
  const actions = (entry as ContinueSource).homeActions, revision = actions?.state?.personalRevision;
  return actions?.removeFromContinue === true && typeof revision === 'number' && Number.isSafeInteger(revision) && revision >= 0
    ? Object.freeze({itemId: entry.id, revision}) : undefined;
};
/** Albums and artists open on their own drawn page on every platform; every other
 * entry keeps the existing title route exactly. */
export const nativeEntryRoute = (entry: ContentEntry): NativeShellRoute =>
  entry.kind === 'album' || entry.kind === 'artist' ? Object.freeze({kind: 'music', entry})
    : entry.kind === 'book' ? Object.freeze({kind: 'book', entry})
      : entry.kind === 'author' || entry.kind === 'book_series' ? Object.freeze({kind: 'audiobook', entry}) : titleRoute(entry, continueOffer(entry));
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
  const route = snapshot.route;
  const libraryId = route.kind === 'title' || route.kind === 'music' || route.kind === 'book' || route.kind === 'audiobook' ? route.entry.libraryId
    : route.kind === 'read-book' || route.kind === 'read-series' ? route.libraryId : undefined;
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
