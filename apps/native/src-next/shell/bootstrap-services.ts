import {HomeService, type HomeSnapshot} from '../../../../packages/client-core/src/home-service';
import {InboxService} from '../../../../packages/client-core/src/inbox';
import {parseNotificationSummary} from '../../../../packages/client-core/src/notifications';
import {PreferencesReader} from '../../../../packages/client-core/src/preferences-reader';
import type {DeviceClass, PreferenceSnapshot} from '../../../../packages/client-core/src/preferences';
import {fetchGuideSourceSummaries} from '../../../../packages/client-core/src/guide/directory';
import {parseDirectSnapshot} from '../../../../packages/client-core/src/profile-management';
import {routePath} from '../../../../packages/contracts/src/routes';
import type {HttpLocalApi, LocalSession} from '../../../../packages/client-core/src';

type Domain = 'preferences' | 'inbox' | 'guide' | 'home';
type Facts = Readonly<{preferences: PreferenceSnapshot; unread: number; hasLiveTV: boolean}>;
type Options = {
  viewer: LocalSession['viewer']; deviceClass: Extract<DeviceClass, 'mobile' | 'television'>;
  signal: AbortSignal; current: () => boolean; onAuthorityEnded: () => void;
};
const object = (value: unknown): value is Record<string, unknown> => value !== null && typeof value === 'object' && !Array.isArray(value);
const cancelled = () => Object.assign(new Error('native_shell_cancelled'), {name: 'AbortError'});
const invalid = () => Object.assign(new Error('invalid_shell_response'), {code: 'invalid_response'});
const changed = () => Object.assign(new Error('viewer_scope_changed'), {code: 'access_refused'});
const closedHome: HomeSnapshot = Object.freeze({phase: 'idle', paging: Object.freeze(new Set<string>())});
export const nativeShellPermissionDenied = (error: unknown): boolean => object(error) &&
  ([401, 403].includes(Number(error.status)) || (typeof error.code === 'string' && ['unauthorized', 'forbidden', 'access_refused', 'identity_mismatch'].includes(error.code)));

/** AccountShell currently consumes DirectSnapshot. Never relabel a hosted principal as local. */
export function nativeShellDirectViewer(viewer: LocalSession['viewer']): void {
  if (viewer.authority !== 'local') throw Object.assign(new Error('native_shell_hosted_account_binding_unavailable'), {code: 'native_shell_hosted_account_binding_unavailable'});
  if (!['owner', 'admin', 'member'].includes(viewer.role)) throw changed();
}

/** Genuine core readers, owned by one restored native authority. Their opaque fences belong
 * to separate response domains; none is derived from, or compared with, another domain. */
export class NativeShellBootstrapServices {
  readonly home: HomeService;
  private readonly preferences: PreferencesReader;
  private readonly inbox: InboxService;
  private readonly controllers = new Set<AbortController>();
  private readonly fences = new Map<Domain, string>();
  private disposed = false;
  private guideDenied = false;
  private inboxLoaded = false;
  private inboxFailure?: unknown;
  private snapshot?: Facts;
  private reading?: Promise<Facts>;
  private readingController?: AbortController;
  private retirement?: Error;
  private readonly api: Pick<HttpLocalApi, 'request'>;
  private readonly options: Options;
  constructor(api: Pick<HttpLocalApi, 'request'>, options: Options) {
    this.api = api; this.options = options;
    nativeShellDirectViewer(options.viewer);
    this.preferences = new PreferencesReader({request: <T>(path: string, method?: string, body?: unknown, signal?: AbortSignal) => this.call<T>('preferences', path, method, body, signal)},
      {serverId: options.viewer.serverId, viewerId: JSON.stringify([options.viewer.authority, options.viewer.accountId, options.viewer.profileId])});
    this.inbox = new InboxService({request: async <T>(path: string, method?: string, body?: unknown, signal?: AbortSignal): Promise<T> => {
      const batch = this.readingController;
      const noteCancelled = () => {if (batch === this.readingController && !batch?.signal.aborted) this.inboxFailure = cancelled();};
      signal?.addEventListener('abort', noteCancelled, {once: true});
      try {
        const raw = await this.call<T>('inbox', path, method, body, signal);
        // refreshUnread intentionally swallows malformed summaries as well as transport
        // failures. Validate with its genuine parser before that forgiving boundary.
        if (path.split('?')[0] === routePath('get_notifications_unread_count')) {
          if (!object(raw)) throw invalid();
          parseNotificationSummary(raw.data);
        }
        return raw;
      }
      catch (error) {if (batch === this.readingController && !batch?.signal.aborted) this.inboxFailure = error; throw error;}
      finally {signal?.removeEventListener('abort', noteCancelled);}
    }});
    this.home = new HomeService({request: <T>(path: string, method?: string, body?: unknown, signal?: AbortSignal) => this.call<T>('home', path, method, body, signal)},
      options.deviceClass === 'television' ? {initialLimit: 20} : {});
    // Core disposal aborts owned reads but retains its last snapshot. A retained runtime
    // must never expose that body after this authority has been retired.
    const readHome = this.home.getSnapshot;
    this.home.getSnapshot = () => this.isCurrent() ? readHome() : closedHome;
    options.signal.addEventListener('abort', this.dispose, {once: true});
    if (options.signal.aborted) this.dispose();
  }
  private isCurrent(): boolean {
    if (!this.disposed && (!this.options.current() || this.options.signal.aborted)) this.dispose();
    return !this.disposed;
  }
  private assertCurrent(): void {if (!this.isCurrent()) throw cancelled();}
  private retire(): never {
    const error = this.retirement ??= changed();
    if (!this.disposed) {this.dispose(); this.options.onAuthorityEnded();}
    throw error;
  }
  private checkFence(domain: Domain, raw: unknown): void {
    if (!object(raw)) throw invalid();
    const scope = domain === 'preferences' || domain === 'inbox' ? raw.scope : raw;
    // Layout mutation receipts have no viewer fence. Their canonical parser still validates them.
    if (domain === 'home' && !('viewerFence' in raw)) return;
    if (!object(scope) || typeof scope.viewerFence !== 'string' || domain !== 'home' && typeof scope.serverId !== 'string') throw invalid();
    // Home row pages carry the Home fence without repeating the server ID.
    if ((domain !== 'home' || 'serverId' in scope) && scope.serverId !== this.options.viewer.serverId) this.retire();
    const fence = scope.viewerFence;
    if (domain === 'preferences' || domain === 'inbox') {
      if (!/^[a-f0-9]{64}$/.test(fence)) throw invalid();
    } else if (!fence || fence.length > 256 || /[\x00-\x1f\x7f]/.test(fence)) throw invalid();
    if (this.fences.has(domain) && this.fences.get(domain) !== fence || domain === 'guide' && this.guideDenied) this.retire();
    this.fences.set(domain, fence);
  }
  private async call<T>(domain: Domain | undefined, path: string, method = 'GET', body?: unknown, signal?: AbortSignal): Promise<T> {
    this.assertCurrent();
    const controller = new AbortController(), abort = () => controller.abort();
    const batch = domain === 'preferences' || domain === 'inbox' || domain === 'guide' ? this.readingController?.signal : undefined;
    this.controllers.add(controller);
    signal?.addEventListener('abort', abort, {once: true});
    batch?.addEventListener('abort', abort, {once: true});
    if (signal?.aborted || batch?.aborted) abort();
    try {
      const raw = await this.api.request<T>(path, method, body, controller.signal);
      this.assertCurrent();
      if (controller.signal.aborted) throw cancelled();
      if (domain) this.checkFence(domain, raw);
      return raw;
    } catch (error) {
      if (this.retirement && error === this.retirement) throw error;
      if (!this.isCurrent() || controller.signal.aborted) throw cancelled();
      // A profile with no guide entitlement can still open Home. Once a guide scope
      // was accepted, losing that permission is an authority change, not an empty list.
      const initialGuideDenial = domain === 'guide' && object(error) && error.status === 403 && !this.fences.has('guide');
      if (this.isCurrent() && nativeShellPermissionDenied(error) && !initialGuideDenial) this.retire();
      throw error;
    } finally {signal?.removeEventListener('abort', abort); batch?.removeEventListener('abort', abort); this.controllers.delete(controller);}
  }
  /** Other bootstrap reads share the same abort/current-authority boundary. */
  request = <T>(path: string, method = 'GET', body?: unknown, signal?: AbortSignal): Promise<T> => this.call<T>(undefined, path, method, body, signal);
  readAccount = async (signal?: AbortSignal) => {
    const viewer = this.options.viewer;
    const raw = await this.request(routePath('get_direct_account'), 'GET', undefined, signal);
    if (object(raw) && (typeof raw.serverId === 'string' && raw.serverId !== viewer.serverId
      || typeof raw.authority === 'string' && raw.authority !== viewer.authority
      || object(raw.account) && typeof raw.account.id === 'string' && raw.account.id !== viewer.accountId)) this.retire();
    const account = parseDirectSnapshot(raw, {authority: 'local', serverId: viewer.serverId, accountId: viewer.accountId}, true);
    this.assertCurrent();
    if (account.account.disabled || account.account.role !== viewer.role) this.retire();
    return account;
  };
  private async readInbox(): Promise<number> {
    const batch = this.readingController;
    const currentRead = () => {this.assertCurrent(); if (batch !== this.readingController || batch?.signal.aborted) throw cancelled();};
    this.inboxFailure = undefined;
    // A profile inbox advertises only that audience. The actual owner's account-admin
    // inbox advertises both; let that server answer drive the core badge's audience set.
    if (!this.inboxLoaded) {
      await this.inbox.load(this.options.viewer.role === 'owner' ? 'account-admin' : 'profile'); currentRead();
      if (this.inboxFailure) throw this.inboxFailure;
      if (this.inbox.getSnapshot().phase !== 'ready') throw invalid();
      this.inboxLoaded = true;
    }
    await this.inbox.refreshUnread(); currentRead();
    // InboxService intentionally preserves the badge on failure. Bootstrap must still
    // report that failed read and must never mistake a swallowed denial for success.
    if (this.inboxFailure) throw this.inboxFailure;
    return this.inbox.getSnapshot().unread;
  }
  private async readGuide() {
    try {return await fetchGuideSourceSummaries({request: <T>(path: string, method?: string, body?: unknown, signal?: AbortSignal) => this.call<T>('guide', path, method, body, signal)},
      this.options.viewer.serverId, Intl.DateTimeFormat().resolvedOptions().timeZone, this.options.signal);}
    catch (error) {
      this.assertCurrent();
      if (object(error) && error.status === 403 && !this.fences.has('guide')) {this.guideDenied = true; return undefined;}
      throw error;
    }
  }
  read = (signal?: AbortSignal): Promise<Facts> => {
    if (this.reading) return this.reading;
    const controller = new AbortController(), abort = () => controller.abort();
    this.readingController = controller;
    signal?.addEventListener('abort', abort, {once: true});
    if (signal?.aborted) abort();
    const pending = (async () => {
      this.assertCurrent();
      const [preferences, unread, guide] = await Promise.all([this.preferences.preferences(this.options.deviceClass), this.readInbox(), this.readGuide()]);
      this.assertCurrent();
      if (controller.signal.aborted) throw cancelled();
      if (preferences.deviceClass !== this.options.deviceClass) throw invalid();
      return this.snapshot = Object.freeze({preferences, unread, hasLiveTV: !!guide?.sources.length});
    })().finally(() => {
      controller.abort(); signal?.removeEventListener('abort', abort);
      if (this.reading === pending) {this.reading = undefined; this.readingController = undefined;}
    });
    this.reading = pending; return pending;
  };
  getSnapshot = (): Facts | undefined => this.isCurrent() ? this.snapshot : undefined;
  dispose = (): void => {
    if (this.disposed) return;
    this.disposed = true; this.options.signal.removeEventListener('abort', this.dispose);
    this.readingController?.abort();
    for (const controller of this.controllers) controller.abort();
    this.controllers.clear(); this.preferences.dispose(); this.inbox.dispose(); this.home.dispose();
    this.snapshot = undefined; this.inboxFailure = undefined; this.fences.clear();
  };
}
