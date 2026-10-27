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
  | {kind: 'book'; entry: ContentEntry}
  | {kind: 'audiobook'; entry: ContentEntry}
  | {kind: 'person'; personId: string}
  | {kind: 'read'; itemId: string; sourceId: string; downloadId?: string; /** Root54: the exact source revision a search hit named, proven again before the guest mounts. */ expectedSourceRevision?: string; contentsTarget?: ReadingHostContentsTarget}
  | {kind: 'read-book'; libraryId: string; item: ReadingItem}
  | {kind: 'read-series'; libraryId: string; seriesId: string}
  | {kind: 'read-periodical'; libraryId: string; groupId: string; publicationType: 'magazine' | 'newspaper'}
  /** Root54: the reader's own authored Search all books, carrying its literal
   * current words. This is an explicit indexed book-text mode, never inferred
   * from an ordinary Search query, and it is pushed above the reader that sent it. */
  | {kind: 'search-reading'; query: string}
  | {kind: 'settings-page'; scope: 'account'; page: 'reading'}
  | {kind: 'channel'; sourceId: string; channelId: string; guide?: import('../platform/playback/types').NativeChannelGuideOrigin;
      tune?: Readonly<{fence: import('../../../../packages/player-core/src').ChannelPlaybackFence; sourceGeneration: string}>}
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
export const nativeEntryRoute = (entry: ContentEntry): NativeShellRoute => {
  if (entry.kind === 'playlist') return Object.freeze({kind: 'saved-destination', destination: {kind: 'playlist', id: entry.id}} as const);
  const browse = entry.navigation?.browse;
  if (entry.kind === 'category' && entry.libraryId && entry.navigation?.view === 'releases' && browse?.pivot === 'albums') {
    return Object.freeze({kind: 'shell', destination: {kind: 'library', libraryId: entry.libraryId, tab: 'releases',
      definition: Object.freeze({libraryId: entry.libraryId, pivot: browse.pivot, query: browse.query ?? null, sort: browse.sort, presentation: 'grid'})}} as const);
  }
  return entry.kind === 'album' || entry.kind === 'artist' ? Object.freeze({kind: 'music', entry})
    : entry.kind === 'book' ? Object.freeze({kind: 'book', entry})
      : entry.kind === 'author' || entry.kind === 'book_series' ? Object.freeze({kind: 'audiobook', entry}) : titleRoute(entry, continueOffer(entry));
};
export const channelRoute = (item: HomeChannel): NativeShellRoute => Object.freeze({kind: 'channel', sourceId: item.source.id, channelId: item.channel.id});

export type NativeRouteSnapshot = Readonly<{authority: ShellAuthority; route: NativeShellRoute; destination: ShellDestination; revision: number}>;
/** One actual opening in this authority's history, including root/current. The
 * occurrence is presentation identity, never a route admission or command. */
export type NativeRoutePresentation = Readonly<{occurrence: string; route: NativeShellRoute; destination: ShellDestination}>;
/** Resource lifetime for one already-admitted occurrence. It is not command
 * authority: commands still capture their own original snapshot/revision. */
export type NativePresentationBinding = Readonly<{
  original: NativeRoutePresentation;
  retainedCurrent: () => boolean;
  activeCurrent: () => boolean;
  subscribe: (listener: () => void) => () => void;
  dispose: () => void;
}>;
export type NativeDestinationIntent = 'enter' | 'restore' | 'top';
export type NativeDestinationActivation = Readonly<{visible: boolean; intent: NativeDestinationIntent; revision: number}>;
export type NativeDestinationActivationPort = Readonly<{subscribe: (listener: () => void) => () => void; getSnapshot: () => NativeDestinationActivation}>;
export type NativeRouteAdmission = (route: NativeShellRoute, origin: ShellDestination) => boolean;
const sameDestination = (a: ShellDestination, b: ShellDestination): boolean => a.kind === b.kind &&
  (a.kind !== 'library' || b.kind === 'library' && a.libraryId === b.libraryId);
const noPresentations: readonly NativeRoutePresentation[] = Object.freeze([]);
let navigationSequence = 0;
const navigationIdentity = () => {
  if (navigationSequence >= Number.MAX_SAFE_INTEGER) throw new Error('Navigation identity exhausted');
  return `navigation-${++navigationSequence}`;
};

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
    : route.kind === 'read-book' || route.kind === 'read-series' || route.kind === 'read-periodical' ? route.libraryId : undefined;
  return libraryId && libraries.some(library => library.id === libraryId) ? {kind: 'library', libraryId} : snapshot.destination;
}

/** One authority lifetime and one history. Async callers must retain the authority they read. */
export class NativeShellNavigation {
  private snapshot: NativeRouteSnapshot;
  private history: NativeRoutePresentation[] = [];
  private retained: readonly NativeShellRoute[] = Object.freeze([]);
  private presentations: readonly NativeRoutePresentation[];
  private readonly identity = navigationIdentity();
  private openingSequence = 0;
  private occurrence = this.nextOccurrence();
  private nativePopClaim?: object;
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
    this.snapshot = Object.freeze({authority: Object.freeze({...authority}), route, destination, revision: 0});
    this.presentations = Object.freeze([Object.freeze({occurrence: this.occurrence, route, destination})]);
  }
  getSnapshot = (): NativeRouteSnapshot => this.snapshot;
  /** Exact route descriptors still in this authority's Back stack. */
  retainedRoutes = (): readonly NativeShellRoute[] => this.isCurrent() ? this.retained : [];
  /** Stable readonly projection of real admitted history. No extra root,
   * by-item dedupe, renderer or tab-local history is manufactured here. */
  presentationStack = (): readonly NativeRoutePresentation[] => {
    try {return this.isCurrent() ? this.presentations : noPresentations;} catch {return noPresentations;}
  };
  /** Bind only an exact owner-issued record that is still admitted. A later
   * occurrence, equal descriptor or restored authority cannot revive the lease.
   * The supplied authority subscription is the original bootstrap's live port. */
  bindPresentation = (original: NativeRoutePresentation, authority: Readonly<{
    current: () => boolean; subscribe: (listener: () => void) => () => void;
  }>): NativePresentationBinding | undefined => {
    const expectedAuthority=this.snapshot.authority;
    const owns=()=>this.isCurrent()&&sameAuthority(expectedAuthority,this.snapshot.authority)&&authority.current();
    try {if(!this.presentations.includes(original)||!owns()||!this.allows(original.route,original.destination)
      ||!owns()||!this.presentations.includes(original))return undefined;}catch{return undefined;}
    let retired=false,checking=false,previousActive=this.presentations.at(-1)?.occurrence===original.occurrence;
    const registration={},listeners=new Set<()=>void>();let ownedRegistration:object|undefined=registration;
    let offNavigation=()=>{},offAuthority=()=>{};
    const registered=()=>!retired&&ownedRegistration===registration;
    const emit=()=>{for(const listener of [...listeners]){try{listener();}catch{/* A sink never grants resource ownership. */}}};
    const retire=()=>{
      if(!registered())return;
      retired=true;ownedRegistration=undefined;
      offNavigation();offAuthority();
      const sinks=[...listeners];listeners.clear();
      for(const listener of sinks){try{listener();}catch{/* Finish once-only original-lease retirement. */}}
    };
    const retainedCurrent=()=>{
      if(!registered()||checking)return false;
      checking=true;
      try {
        const retained=()=>registered()&&this.presentations.some(value=>value.occurrence===original.occurrence&&value.route===original.route);
        // Each external predicate may reenter, dispose this binding or replace
        // authority/history. Recheck the original registration after each one.
        if(!this.isCurrent()||!registered()||!sameAuthority(expectedAuthority,this.snapshot.authority)
          ||!authority.current()||!registered()||!retained()
          ||!this.allows(original.route,original.destination)||!registered()
          ||!this.isCurrent()||!registered()||!authority.current()||!registered()||!retained()){
          retire();return false;
        }
        return registered();
      }catch{retire();return false;}
      finally{checking=false;}
    };
    const activeCurrent=()=>retainedCurrent()&&registered()&&this.presentations.at(-1)?.occurrence===original.occurrence
      &&this.presentations.at(-1)?.route===original.route;
    const notify=()=>{
      const active=activeCurrent();if(!registered())return;
      if(active!==previousActive){previousActive=active;emit();}
    };
    offNavigation=this.subscribe(notify);offAuthority=authority.subscribe(notify);
    if(!retainedCurrent()){offNavigation();offAuthority();return undefined;}
    return Object.freeze({original,retainedCurrent,activeCurrent,
      subscribe:(listener:()=>void)=>{if(!registered())return()=>{};listeners.add(listener);return()=>{listeners.delete(listener);};},
      dispose:retire,
    });
  };

  getIntent = (): NativeDestinationIntent => this.intent;
  isCurrent = (): boolean => this.current(this.snapshot.authority);
  allows = (route: NativeShellRoute, origin: ShellDestination = route.kind === 'shell' ? route.destination : this.snapshot.destination): boolean =>
    this.isCurrent() && (this.admission?.(route, origin) ?? true);
  subscribe = (listener: () => void): (() => void) => {this.listeners.add(listener); return () => {this.listeners.delete(listener);};};
  private current(authority: ShellAuthority): boolean {
    return this.alive && sameAuthority(authority, this.snapshot.authority) && sameAuthority(authority, this.currentAuthority());
  }
  open(route: NativeShellRoute, expectedAuthority: ShellAuthority): boolean {
    const expected = this.snapshot, previous = this.presentations.at(-1);
    const owns = () => this.alive && this.snapshot === expected && this.presentations.at(-1) === previous;
    if (!previous || !owns() || !this.current(expectedAuthority) || !owns() || !this.allows(route)
      || !owns() || !this.current(expectedAuthority) || !owns()) return false;
    const occurrence = this.nextOccurrence();
    this.history.push(previous);
    this.publish(route, 'enter', undefined, occurrence);
    return true;
  }
  back(expectedAuthority: ShellAuthority): boolean {
    if (!sameAuthority(expectedAuthority, this.snapshot.authority)) return false;
    return this.commitNativePop(this.snapshot, this.occurrence);
  }
  /** The native presenter captures both values when Back/gesture begins.
   * Cancellation calls nothing. Rejecting this compare-pop never uses latest. */
  commitNativePop = (expected: NativeRouteSnapshot, expectedOccurrence: string): boolean => {
    if (this.nativePopClaim || this.snapshot !== expected || this.occurrence !== expectedOccurrence) return false;
    const revision = expected.revision, entry = this.history.at(-1), claim = {};
    if (!entry) return false;
    this.nativePopClaim = claim;
    let committed = false;
    const owns = () => this.nativePopClaim === claim && this.alive && this.snapshot === expected
      && this.snapshot.revision === revision && this.occurrence === expectedOccurrence && this.history.at(-1) === entry;
    try {
      if (!owns() || !this.current(expected.authority) || !owns()) return false;
      if (this.admission && this.admission(entry.route, entry.destination) !== true) return false;
      // Admission/current-authority callbacks can reenter, navigate or retire.
      // Only this original snapshot/history pair may be popped afterwards.
      if (!owns() || !this.current(expected.authority) || !owns()) return false;
      this.history.pop();
      committed = true;
      this.publish(entry.route, 'restore', entry.destination, entry.occurrence);
      return true;
    } catch {return committed;}
    finally {if (this.nativePopClaim === claim) this.nativePopClaim = undefined;}
  }
  /** A zap replaces only the exact channel opening that advertised it. */
  replaceChannel(expected: NativeRouteSnapshot, route: Extract<NativeShellRoute, {kind: 'channel'}>, expectedAuthority: ShellAuthority): boolean {
    if (!this.current(expectedAuthority) || this.snapshot !== expected || expected.route.kind !== 'channel' || !this.allows(route)
      || !this.current(expectedAuthority) || !this.alive || this.snapshot !== expected) return false;
    this.publish(route, 'enter'); return true;
  }
  top(destination: ShellDestination, expectedAuthority: ShellAuthority): boolean {
    const expected = this.snapshot;
    if (!this.current(expectedAuthority) || this.snapshot !== expected || expected.route.kind !== 'shell' || !sameDestination(destination, expected.route.destination) || !this.allows(expected.route)
      || !this.current(expectedAuthority) || !this.alive || this.snapshot !== expected) return false;
    this.publish(expected.route, 'top'); return true;
  }
  private nextOccurrence(): string {
    if (this.openingSequence >= Number.MAX_SAFE_INTEGER) throw new Error('Navigation occurrence exhausted');
    return `${this.identity}:${++this.openingSequence}`;
  }
  private publish(route: NativeShellRoute, intent: NativeDestinationIntent, restoredDestination?: ShellDestination, occurrence = this.occurrence): void {
    this.intent = intent;
    this.occurrence = occurrence;
    this.retained = Object.freeze(this.history.map(entry => entry.route));
    this.snapshot = Object.freeze({...this.snapshot, route, destination: restoredDestination ?? (route.kind === 'shell' ? route.destination : this.snapshot.destination), revision: this.snapshot.revision + 1});
    this.presentations = Object.freeze([...this.history, Object.freeze({occurrence, route, destination: this.snapshot.destination})]);
    for (const listener of [...this.listeners]) listener();
  }
  dispose(): void {
    if (!this.alive) return;
    this.alive = false; this.history = []; this.retained = Object.freeze([]); this.presentations = noPresentations;
    for (const listener of [...this.listeners]) listener();
    this.listeners.clear();
  }
}
