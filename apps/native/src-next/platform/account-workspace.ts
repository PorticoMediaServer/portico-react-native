import {HttpLocalApi} from '../../../../packages/client-core/src';
import {AccountSessionReviewService, type AccountSessionRow, type AccountSessionScope, type AccountSessionReviewSnapshot} from '../../../../packages/client-core/src/account-sessions';
import {AccountNotificationsClient, type AccountNotification} from '../../../../packages/client-core/src/account-notifications';
import {parseSecurityState, type SecurityState} from '../../../../packages/client-core/src/hosted-security';
import {presentError} from '../../../../packages/client-core/src/presentation/errors';
import {routePath} from '../../../../packages/contracts/src/hosted/routes';
import {hostedUrl} from './account-authority';
import {nativeNetworkFetch} from './server-connections';
import type {NativeAccounts} from './accounts';
import {accountExpectation, nativeAccountRead} from './account-work';

type NotificationView = {epoch: number; cursors: (string | undefined)[]; index: number; next?: string};
export type AccountWorkspacePage = 'menu' | 'security' | 'devices' | 'notifications';
export type AccountWorkspaceSnapshot = Readonly<{page: AccountWorkspacePage; phase: 'idle' | 'loading' | 'ready' | 'failed' | 'ended';
  failure?: string; notificationsNext?: boolean; notificationsPrevious?: boolean; sessionsNext?: boolean; sessionsPrevious?: boolean; security?: SecurityState; sessions?: readonly AccountSessionRow[]; notifications?: readonly AccountNotification[]}>;
const changed = () => Object.assign(new Error('native_account_changed'), {code: 'account_changed'});

/** Read-only account workspace. No server authority or credentials enter its snapshot. */
export class NativeAccountWorkspace {
  private readonly credentials: ReturnType<NativeAccounts['accountCredentials']>;
  private readonly isCurrent: () => boolean;
  private readonly requests = new Set<AbortController>();
  private readonly scope: AccountSessionScope;
  private readonly controller = new AbortController();
  private readonly listeners = new Set<() => void>();
  private readonly off: () => void;
  private notificationView?: NotificationView;
  private sessionReview?: {epoch: number; service: AccountSessionReviewService};
  private epoch = 0;
  private state: AccountWorkspaceSnapshot = {page: 'menu', phase: 'idle'};
  constructor(owner: NativeAccounts, scope: AccountSessionScope, isCurrent: () => boolean) {
    this.isCurrent = isCurrent;
    this.scope = Object.freeze({...scope}); this.credentials = owner.accountCredentials(); this.assert();
    this.off = this.credentials.subscribe(() => {if (!this.current()) this.end();});
  }
  getSnapshot = () => this.state;
  subscribe = (listener: () => void) => {this.listeners.add(listener); return () => {this.listeners.delete(listener);};};
  current = () => {const live = this.credentials.getSnapshot().session;
    return !this.controller.signal.aborted && this.isCurrent() && live?.account.id === this.scope.accountId && live.familyId === this.scope.familyId;};
  private assert() {if (!this.current()) throw changed();}
  private publish(state: AccountWorkspaceSnapshot) {this.state = Object.freeze(state); this.listeners.forEach(listener => listener());}
  private end() {if (this.controller.signal.aborted) return; ++this.epoch; this.retireReads(); this.controller.abort(); this.publish({page: 'menu', phase: 'ended'});}
  dispose() {this.listeners.clear(); this.end(); this.off();}
  private retireReads() {this.notificationView = undefined; this.sessionReview?.service.dispose(); this.sessionReview = undefined; this.requests.forEach(request => request.abort()); this.requests.clear();}
  menu() {this.assert(); ++this.epoch; this.retireReads(); this.publish({page: 'menu', phase: 'idle'});}
  private assertEpoch(epoch: number) {this.assert(); if (epoch !== this.epoch) throw changed();}
  private requestFor = (epoch: number) => async <T,>(path: string, method = 'GET', body?: unknown, signal?: AbortSignal): Promise<T> => {
    this.assertEpoch(epoch); if (method !== 'GET' || body !== undefined) throw changed();
    const request = new AbortController(), abort = () => request.abort(); this.requests.add(request);
    this.controller.signal.addEventListener('abort', abort, {once: true}); signal?.addEventListener('abort', abort, {once: true});
    if (signal?.aborted) abort(); const timer = setTimeout(abort, 15000);
    try {
      const original = this.credentials.getSnapshot().session;
      if (!original) throw changed();
      const result = await nativeAccountRead(this.credentials, session =>
        new HttpLocalApi(hostedUrl, session.accessToken, nativeNetworkFetch).request<T>(path, 'GET', undefined, request.signal),
        {expected: accountExpectation(original), signal: request.signal, isCurrent: () => this.current() && epoch === this.epoch});
      this.assertEpoch(epoch);
      if (epoch !== this.epoch || request.signal.aborted) throw changed(); return result;
    } finally {this.requests.delete(request); clearTimeout(timer); this.controller.signal.removeEventListener('abort', abort); signal?.removeEventListener('abort', abort);}
  };
  async open(page: Exclude<AccountWorkspacePage, 'menu'>) {
    this.assert(); const epoch = ++this.epoch; this.retireReads(); this.publish({page, phase: 'loading'});
    try {
      this.assertEpoch(epoch); const request = this.requestFor(epoch);
      let content: Pick<AccountWorkspaceSnapshot, 'security' | 'sessions' | 'notifications'>;
      if (page === 'security') content = {security: parseSecurityState(await request(routePath('account_security_get')), this.scope)};
      else if (page === 'notifications') {
        const view: NotificationView = {epoch, cursors: [undefined], index: 0}; this.notificationView = view;
        await this.readNotifications(view, 0, undefined); return;
      }
      else {
        const service = new AccountSessionReviewService({api: {request}, scope: this.scope});
        const review = {epoch, service}; this.sessionReview = review;
        this.assertEpoch(epoch); await service.refresh(); this.assertEpoch(epoch);
        if (this.sessionReview !== review) throw changed();
        this.publish(this.sessionState(service.getSnapshot())); return;
      }
      this.assert(); if (epoch === this.epoch) this.publish({page, phase: 'ready', ...content});
    } catch (error) {if (this.current() && epoch === this.epoch) this.publish({page, phase: 'failed', failure: presentError(error, 'portico-account').body}); else if (!this.current()) this.end();}
  }
  private sessionState(value: AccountSessionReviewSnapshot): AccountWorkspaceSnapshot {
    return value.phase === 'ready' ? {page: 'devices', phase: 'ready', sessions: value.items,
      sessionsNext: !!value.nextCursor, sessionsPrevious: value.hasPrevious}
      : {page: 'devices', phase: 'failed', failure: value.error?.message ?? presentError(new Error('native_account_read_failed'), 'portico-account').body};
  }
  async pageSessions(direction: 'next' | 'previous') {
    this.assert(); const review = this.sessionReview;
    if (!review || this.state.page !== 'devices' || this.state.phase !== 'ready') return;
    const before = review.service.getSnapshot(), epoch = review.epoch;
    if (direction === 'next' ? !before.nextCursor : !before.hasPrevious) return;
    this.assertEpoch(epoch); this.publish({page: 'devices', phase: 'loading'});
    try {
      this.assertEpoch(epoch);
      if (direction === 'next') await review.service.next(); else await review.service.previous();
      this.assertEpoch(epoch); if (this.sessionReview !== review) throw changed();
      this.publish(this.sessionState(review.service.getSnapshot()));
    } catch (error) {if (this.current() && epoch === this.epoch) this.publish({page: 'devices', phase: 'failed', failure: presentError(error, 'portico-account').body}); else if (!this.current()) this.end();}
  }

  private async readNotifications(view: NotificationView, index: number, cursor: string | undefined) {
    this.assertEpoch(view.epoch); if (this.notificationView !== view) throw changed();
    const value = await new AccountNotificationsClient(this.requestFor(view.epoch)).page(cursor, this.controller.signal);
    this.assertEpoch(view.epoch); if (this.notificationView !== view) throw changed();
    view.index = index; view.cursors = view.cursors.slice(0, index + 1); view.cursors[index] = cursor; view.next = value.nextCursor;
    this.publish({page: 'notifications', phase: 'ready', notifications: value.items,
      notificationsPrevious: index > 0, notificationsNext: !!value.nextCursor});
  }
  async pageNotifications(direction: 'next' | 'previous') {
    this.assert(); const view = this.notificationView;
    if (!view || this.state.page !== 'notifications' || this.state.phase !== 'ready') return;
    if (direction === 'next' ? !view.next : view.index === 0) return;
    const epoch = view.epoch, index = view.index + (direction === 'next' ? 1 : -1);
    const cursor = direction === 'next' ? view.next : view.cursors[index];
    this.assertEpoch(epoch); this.publish({page: 'notifications', phase: 'loading'});
    try {this.assertEpoch(epoch); await this.readNotifications(view, index, cursor);}
    catch (error) {if (this.current() && epoch === this.epoch) this.publish({page: 'notifications', phase: 'failed', failure: presentError(error, 'portico-account').body}); else if (!this.current()) this.end();}
  }

}
