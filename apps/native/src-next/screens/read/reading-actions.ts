import type {RefObject} from 'react';
import type {View} from 'react-native';
import type {LocalSession, ReadingClient, ReadingListMembership, ReadingReadMark} from '../../../../../packages/client-core/src';
import type {NativeShellBootstrapContext} from '../../shell/bootstrap';
import {sameAuthority, type ShellAuthority} from '../../shell/model';
import type {NativeReadOrigin} from './eligibility';
import {nativeRouteCrypto} from '../../platform/server-connections';

export type NativeReadingActionOffer = Readonly<{
  item: Readonly<{id: string; libraryId?: string; title: string}>;
  lifetime: Readonly<{signal: AbortSignal; isCurrent: () => boolean}>;
  open: () => void;
  download?: () => void;
  anchorRef?: RefObject<View | null>;
}>;
export type NativeReadingActionState = Readonly<{
  menu?: NativeReadingActionOffer;
  listed?: ReadingListMembership;
  mark?: ReadingReadMark;
  loading?: boolean;
  busy?: boolean;
  selecting: boolean;
  selected: readonly NativeReadingActionOffer[];
}>;
const operationId = (): string => Array.from(nativeRouteCrypto.random(16), byte => byte.toString(16).padStart(2, '0')).join('');
const unavailable = () => Object.assign(new Error('reading_action_unavailable'), {code: 'unavailable'});

/** Item menus and explicit reading selection use the Reading producer's own
 * personal commands. Every offered row retains its exact route/query lifetime;
 * AV playback, watched flags and inferred ContentEntry grants are never used. */
export class NativeReadingActions {
  private state: NativeReadingActionState = Object.freeze({selecting: false, selected: []});
  private readonly listeners = new Set<() => void>();
  private readonly context: NativeShellBootstrapContext;
  private readonly report: (error: unknown) => void;
  private life?: AbortController;
  private readonly clients = new Set<ReadingClient>();
  private session?: Readonly<{sessionFamilyId: string; viewer: LocalSession['viewer']}>;
  private authority?: ShellAuthority;
  private origin?: NativeReadOrigin;
  private route?: NativeReadOrigin['route'];
  private stops: readonly (() => void)[] = [];
  private ticket?: object;
  private listedOffers = new WeakMap<ReadingListMembership, NativeReadingActionOffer>();
  private disposed = false;
  constructor(context: NativeShellBootstrapContext, report: (error: unknown) => void) {this.context = context; this.report = report;}
  arm = (): boolean => {
    if (this.disposed) return false;
    this.release();
    const context = this.context, session = context.session();
    if (!session || !context.current()) return false;
    this.session = {sessionFamilyId: session.sessionFamilyId, viewer: Object.freeze({...session.viewer})};
    this.authority = Object.freeze({...context.authority()});
    const origin = context.navigation.getSnapshot();
    this.route = origin.route;
    this.origin = {route: origin.route, revision: origin.revision};
    this.life = new AbortController();
    this.stops = [context.navigation.subscribe(this.reconcile), context.subscribeAuthority(this.reconcile)];
    return true;
  };
  release = (): void => {
    this.life?.abort(); this.life = undefined; this.ticket = undefined;
    for (const client of this.clients) client.dispose(); this.clients.clear();
    for (const stop of this.stops) stop(); this.stops = [];
    this.session = undefined; this.authority = undefined; this.origin = undefined; this.route = undefined;
    this.listedOffers = new WeakMap(); this.publish({selecting: false, selected: []});
  };
  private authorized = (): boolean => {
    const session = this.context.session(), original = this.session;
    return !this.disposed && !!original && !!session && !!this.authority && this.context.current()
      && session.sessionFamilyId === original.sessionFamilyId && session.viewer.role === original.viewer.role
      && sameAuthority(this.authority, this.context.authority());
  };
  private current = (): boolean => {
    const origin = this.context.navigation.getSnapshot();
    return this.authorized() && !!this.life && !this.life.signal.aborted && !!this.origin
      && origin.route === this.origin.route && origin.revision === this.origin.revision;
  };
  private offered = (offer: NativeReadingActionOffer): boolean => this.current() && !offer.lifetime.signal.aborted && offer.lifetime.isCurrent();
  private reading(offer: NativeReadingActionOffer, valid: () => boolean = () => true): ReadingClient {
    const session = this.session, life = this.life;
    if (!session || !life || !this.offered(offer) || !valid()) throw unavailable();
    // The producer checks this exact row/query lifetime before dispatch and
    // after IO. Route retirement also disposes every active per-offer client.
    const client = this.context.api.reading({viewer: session.viewer, signal: offer.lifetime.signal,
      isCurrent: () => this.life === life && !life.signal.aborted && this.offered(offer) && valid()});
    this.clients.add(client); return client;
  }
  private close(client: ReadingClient): void {this.clients.delete(client); client.dispose();}
  private publish(value: NativeReadingActionState): void {
    if (this.disposed) return;
    this.state = Object.freeze(value);
    for (const listener of [...this.listeners]) listener();
  }
  subscribe = (listener: () => void): (() => void) => {this.listeners.add(listener); return () => {this.listeners.delete(listener);};};
  getSnapshot = (): NativeReadingActionState => this.state;
  reconcile = (): void => {
    if (this.disposed) return;
    if (!this.authorized()) {this.dispose(); return;}
    const navigation = this.context.navigation.getSnapshot();
    if (this.origin && (navigation.route !== this.origin.route || navigation.revision !== this.origin.revision)) {
      // Navigation retires the opening and its IO, not the retained page owner.
      this.origin = undefined;
      this.life?.abort(); this.life = new AbortController(); this.ticket = undefined;
      for (const client of this.clients) client.dispose(); this.clients.clear();
      this.listedOffers = new WeakMap(); this.publish({selecting: false, selected: []});
    }
    if (!this.origin && navigation.route === this.route) this.origin = {route: navigation.route, revision: navigation.revision};
    if (!this.current()) return;
    const selected = this.state.selected.filter(this.offered), menu = this.state.menu;
    if (selected.length !== this.state.selected.length || menu && !this.offered(menu)) {
      this.publish({...this.state, selected, ...(menu && !this.offered(menu) ? {menu: undefined, listed: undefined, mark: undefined, loading: false} : {})});
    }
  };
  show = (offer: NativeReadingActionOffer): void => {
    if (this.ticket || !this.offered(offer)) return;
    this.publish({...this.state, menu: offer, listed: undefined, mark: undefined, loading: true});
    void this.loadMenu(offer).catch(error => {if (this.state.menu === offer && this.offered(offer)) {this.publish({...this.state, loading: false}); this.report(error);}});
  };
  inspect = async (offer: NativeReadingActionOffer): Promise<ReadingListMembership | undefined> => {
    if (!this.offered(offer)) return undefined;
    const life = this.life, client = this.reading(offer);
    try {
      if (!client.canUseMyList(offer.item.id)) return undefined;
      const listed = await client.getMyList(offer.item.id);
      if (this.life !== life || !this.offered(offer)) return undefined;
      this.listedOffers.set(listed, offer); return listed;
    } finally {this.close(client);}
  };
  toggleListed = async (offer: NativeReadingActionOffer, listed: ReadingListMembership): Promise<ReadingListMembership | undefined> => {
    if (this.ticket) return undefined;
    const ticket = {}; this.ticket = ticket;
    const current = () => this.ticket === ticket && this.listedOffers.get(listed) === offer && this.offered(offer);
    try {
      if (!current()) return undefined;
      const expectedRevision = listed.revision, value = !listed.listed, operation = operationId();
      if (!current()) return undefined;
      const client = this.reading(offer, current);
      try {
        if (!current()) return undefined;
        const next = await client.setMyList(offer.item.id, {operationId: operation, expectedRevision, listed: value});
        if (!current()) return undefined;
        this.listedOffers.delete(listed); this.listedOffers.set(next, offer); return next;
      } finally {this.close(client);}
    } finally {if (this.ticket === ticket) this.ticket = undefined;}
  };
  private loadMenu = async (offer: NativeReadingActionOffer): Promise<void> => {
    const life = this.life, client = this.reading(offer, () => this.state.menu === offer), id = offer.item.id;
    try {
      const [listed, mark] = await Promise.all([
        client.canUseMyList(id) ? client.getMyList(id) : Promise.resolve(undefined),
        client.canMarkRead(id) ? client.readMark(id) : Promise.resolve(undefined),
      ]);
      if (this.life === life && this.state.menu === offer && this.offered(offer)) this.publish({...this.state, listed, mark, loading: false});
    } finally {this.close(client);}
  };
  dismiss = (offer = this.state.menu): void => {
    if (this.state.menu === offer && !this.ticket) this.publish({...this.state, menu: undefined, listed: undefined, mark: undefined, loading: false});
  };
  open = (offer: NativeReadingActionOffer): void => {if (!this.ticket && this.state.menu === offer && this.offered(offer)) {this.dismiss(offer); if (this.offered(offer)) offer.open();}};
  download = (offer: NativeReadingActionOffer): void => {if (!this.ticket && this.state.menu === offer && this.offered(offer)) {this.dismiss(offer); if (this.offered(offer)) offer.download?.();}};
  start = (): void => {if (!this.ticket && this.current()) this.publish({...this.state, selecting: true});};
  cancel = (): void => {if (!this.ticket && this.current()) this.publish({...this.state, selecting: false, selected: []});};
  toggle = (offer: NativeReadingActionOffer): void => {
    if (this.ticket || !this.offered(offer)) return;
    const selected = this.state.selected.filter(this.offered), found = selected.some(value => value.item.id === offer.item.id && value.item.libraryId === offer.item.libraryId);
    this.publish({...this.state, selecting: true, selected: found ? selected.filter(value => value.item.id !== offer.item.id || value.item.libraryId !== offer.item.libraryId) : [...selected, offer],
      menu: undefined, listed: undefined, mark: undefined, loading: false});
  };
  selected = (item: NativeReadingActionOffer['item']): boolean => this.state.selected.some(value => value.item.id === item.id && value.item.libraryId === item.libraryId && this.offered(value));
  /** CAS writes use the actual object drawn in the menu, never a refreshed
   * membership substituted beneath a retained press. */
  personal = async (rendered: NativeReadingActionState, field: 'listed' | 'mark'): Promise<void> => {
    if (this.ticket) return;
    const ticket = {}; this.ticket = ticket;
    const offer = rendered.menu, membership = rendered.listed, mark = rendered.mark;
    const current = () => this.ticket === ticket && !!offer && this.state.menu === offer && this.offered(offer)
      && (field === 'listed' ? this.state.listed === membership && !!membership : this.state.mark === mark && !!mark);
    try {
      if (this.state !== rendered || !current()) return;
      this.publish({...this.state, busy: true});
      const id = offer!.item.id;
      const expectedRevision = field === 'listed' ? membership!.revision : mark!.revision;
      const value = field === 'listed' ? !membership!.listed : !mark!.read;
      const operation = operationId();
      if (!current()) return;
      const client = this.reading(offer!, current);
      try {
        if (!current()) return;
        if (field === 'listed') {
          const next = await client.setMyList(id, {operationId: operation, expectedRevision, listed: value});
          if (current()) this.publish({...this.state, listed: next});
        } else {
          const next = await client.setReadMark(id, {operationId: operation, expectedRevision, read: value});
          if (current()) this.publish({...this.state, mark: next});
        }
      } finally {this.close(client);}
    } finally {if (this.ticket === ticket) {this.ticket = undefined; if (this.current()) this.publish({...this.state, busy: false});}}
  };
  /** Small explicit batches keep each item's own revision. A failed write stops
   * the batch and leaves that item and the remaining items selected for review. */
  apply = async (rendered: NativeReadingActionState, action: 'list' | 'unlist' | 'read' | 'unread'): Promise<void> => {
    if (this.ticket || this.state !== rendered || !rendered.selecting || !rendered.selected.length) return;
    const ticket = {}; this.ticket = ticket;
    try {
      if (!this.current() || !rendered.selected.every(this.offered)) return;
      this.publish({...this.state, busy: true});
      for (const offer of rendered.selected) {
        const current = () => this.ticket === ticket && this.offered(offer) && this.state.selecting;
        if (!current()) return;
        const id = offer.item.id, list = action === 'list' || action === 'unlist', client = this.reading(offer, current);
        try {
          if (list ? !client.canUseMyList(id) : !client.canMarkRead(id)) throw unavailable();
          if (list) {
            const membership = await client.getMyList(id);
            if (!current()) return;
            const expectedRevision = membership.revision, operation = operationId();
            if (!current()) return;
            await client.setMyList(id, {operationId: operation, expectedRevision, listed: action === 'list'});
          } else {
            const mark = await client.readMark(id);
            if (!current()) return;
            const expectedRevision = mark.revision, operation = operationId();
            if (!current()) return;
            await client.setReadMark(id, {operationId: operation, expectedRevision, read: action === 'read'});
          }
          if (!current()) return;
          this.publish({...this.state, selected: this.state.selected.filter(value => value !== offer)});
        } finally {this.close(client);}
      }
    } finally {if (this.ticket === ticket) {this.ticket = undefined; if (this.current()) this.publish({...this.state, busy: false});}}
  };
  dispose = (): void => {
    if (this.disposed) return;
    this.release(); this.disposed = true; this.listeners.clear();
  };
}
