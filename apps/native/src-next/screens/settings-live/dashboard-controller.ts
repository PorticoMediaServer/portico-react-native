import {ConsoleClient, type Alert, type Job, type Measurement} from '../../../../../packages/client-core/src/console';
import {AdminSessionsClient} from '../../../../../packages/client-core/src/playback-v1/admin-sessions';
import type {AdminSession} from '../../../../../packages/client-core/src/playback-v1/types';
import type {NativeScreenLifetime} from './lifetime';
import {NativeScreenStore} from './lifetime';
import {DashboardCursorWindow, type DashboardCursorSnapshot} from './dashboard-cursor-window';

export type NativeDashboardAdmission = 'owner' | 'administrator' | 'denied';
export type NativeDashboardSnapshot = Readonly<{
  admission: NativeDashboardAdmission;
  loading: boolean;
  sessions: readonly AdminSession[];
  nextCursor?: string;
  sessionWindow?: DashboardCursorSnapshot<AdminSession, SessionMeta>;
  jobWindow?: DashboardCursorSnapshot<Job, undefined>;
  totals?: Awaited<ReturnType<AdminSessionsClient['list']>>['totals'];
  health?: Measurement;
  storage?: Measurement;
  alerts: readonly Alert[];
  jobs: readonly Job[];
  error?: unknown;
}>;
type SessionPage = Awaited<ReturnType<AdminSessionsClient['list']>>;
type SessionMeta = Readonly<{totals: SessionPage['totals']; scope: SessionPage['scope']; revision: string}>;
export type NativeDashboardReaders = Readonly<{
  sessions: Pick<AdminSessionsClient, 'list'>;
  console: Pick<ConsoleClient, 'measurement' | 'alerts' | 'jobs' | 'dispose'>;
}>;

/** Re-evaluate main-profile and live membership authority before every read and publication. */
export class NativeDashboardController extends NativeScreenStore<NativeDashboardSnapshot> {
  private disposed = false;
  private generation = 0;
  private role: NativeDashboardAdmission;
  private sessionFence?: string;
  private sessionRevision?: string;
  private sessions: DashboardCursorWindow<AdminSession, SessionMeta>;
  private jobs?: DashboardCursorWindow<Job, undefined>;
  readonly lifetime: NativeScreenLifetime;
  private admission: () => NativeDashboardAdmission;
  private readers: NativeDashboardReaders;
  constructor(lifetime: NativeScreenLifetime, admission: () => NativeDashboardAdmission, readers: NativeDashboardReaders) {
    super({admission: admission(), loading: false, sessions: [], alerts: [], jobs: []});
    this.lifetime = lifetime; this.admission = admission; this.readers = readers; this.role = admission();
    this.sessions = this.sessionWindow();
    if (this.role === 'owner') this.jobs = this.jobWindow();
    lifetime.signal.addEventListener('abort', this.retire, {once: true});
  }
  private valid = (role: NativeDashboardAdmission): boolean => !this.disposed && this.lifetime.current() && this.role === role && this.admission() === role && role !== 'denied';
  private sessionWindow(): DashboardCursorWindow<AdminSession, SessionMeta> {
    const role = this.role;
    return new DashboardCursorWindow(async (cursor, signal) => {
      if (!this.valid(role)) throw new Error('native_screen_scope_ended');
      const page = await this.readers.sessions.list(cursor || undefined, 10, signal);
      if (!this.valid(role) || signal.aborted) throw new Error('native_screen_scope_ended');
      if (page.scope.serverId !== this.lifetime.authority.serverId || !page.revision || this.sessionFence && this.sessionFence !== page.scope.viewerFence || this.sessionRevision && this.sessionRevision !== page.revision) throw new Error('dashboard_refresh_required');
      this.sessionFence = page.scope.viewerFence; this.sessionRevision = page.revision;
      return {items: page.items, nextCursor: page.nextCursor, metadata: {totals: page.totals, scope: page.scope, revision: page.revision}};
    }, row => row.id, () => this.valid(role), window => {
      if (this.valid(role)) this.publish({...this.getSnapshot(), sessionWindow: window, sessions: window.items, nextCursor: window.nextCursor, totals: window.metadata?.totals ?? this.getSnapshot().totals});
    });
  }
  private jobWindow(): DashboardCursorWindow<Job, undefined> {
    return new DashboardCursorWindow(async cursor => {
      if (!this.valid('owner')) throw new Error('native_screen_scope_ended');
      const page = await this.readers.console.jobs(cursor);
      if (!this.valid('owner')) throw new Error('native_screen_scope_ended');
      return {...page, metadata: undefined};
    }, row => row.id, () => this.valid('owner'), window => {
      if (this.valid('owner')) this.publish({...this.getSnapshot(), jobWindow: window, jobs: window.items});
    }, (first, second) => first.revision === second.revision);
  }
  private retire = (): void => {
    this.generation++; this.sessions.dispose(); this.jobs?.dispose(); this.jobs = undefined;
    if (!this.disposed) this.publish({admission: 'denied', loading: false, sessions: [], alerts: [], jobs: []});
  };
  private changeRole(role: NativeDashboardAdmission): void {
    if (role === this.role) return;
    this.generation++; this.sessions.dispose(); this.jobs?.dispose(); this.jobs = undefined; this.sessionFence = undefined; this.sessionRevision = undefined;
    this.role = role;
    this.publish({admission: role, loading: false, sessions: [], alerts: [], jobs: []});
    this.sessions = this.sessionWindow(); if (role === 'owner') this.jobs = this.jobWindow();
  }
  refresh(): Promise<void> {
    this.lifetime.assert();
    if (this.disposed) return Promise.resolve();
    const role = this.admission(); this.changeRole(role);
    if (role === 'denied') return Promise.resolve();
    const generation = ++this.generation;
    if (!this.sessions.refreshing()) {this.sessionFence = undefined; this.sessionRevision = undefined;}
    this.publish({...this.getSnapshot(), loading: true, error: undefined});
    const sessions = this.sessions.refresh();
    const owner = role === 'owner' ? Promise.all([this.readers.console.measurement('health'), this.readers.console.measurement('storage'), this.readers.console.alerts()]) : undefined;
    const jobs = role === 'owner' ? this.jobs?.refresh() : undefined;
    return Promise.all([sessions, jobs, owner]).then(([, , facts]) => {
      if (!this.valid(role) || generation !== this.generation) return;
      this.publish({...this.getSnapshot(), loading: false, ...(facts ? {health: facts[0], storage: facts[1], alerts: facts[2]} : {})});
    }, error => {if (this.valid(role) && generation === this.generation) this.publish({...this.getSnapshot(), loading: false, error});});
  }
  nextSessions = (expected: DashboardCursorSnapshot<AdminSession, SessionMeta>) => this.sessions.next(expected);
  previousSessions = (expected: DashboardCursorSnapshot<AdminSession, SessionMeta>) => this.sessions.previous(expected);
  retrySessions = (expected: DashboardCursorSnapshot<AdminSession, SessionMeta>) => this.sessions.retry(expected);
  nextJobs = (expected: DashboardCursorSnapshot<Job, undefined>) => this.jobs?.next(expected) ?? Promise.resolve();
  previousJobs = (expected: DashboardCursorSnapshot<Job, undefined>) => this.jobs?.previous(expected) ?? Promise.resolve();
  retryJobs = (expected: DashboardCursorSnapshot<Job, undefined>) => this.jobs?.retry(expected) ?? Promise.resolve();
  sessionFocusToken = (id: string): object | undefined => this.sessions.focusToken(id);
  jobFocusToken = (id: string): object | undefined => this.jobs?.focusToken(id);
  focusSession = (id: string, expected: DashboardCursorSnapshot<AdminSession, SessionMeta>): object | undefined => {const now = this.sessions.snapshot(); return this.valid(this.role) && now === expected && now.items.some(row => row.id === id) ? this.sessions.focus(id) : undefined;};
  blurSession = (id: string, token: object, expected: DashboardCursorSnapshot<AdminSession, SessionMeta>): void => {if (this.sessions.snapshot().scope === expected.scope) this.sessions.blur(id, token);};
  focusJob = (id: string, expected: DashboardCursorSnapshot<Job, undefined>): object | undefined => {const now = this.jobs?.snapshot(); return this.valid('owner') && now && now === expected && now.items.some(row => row.id === id) ? this.jobs?.focus(id) : undefined;};
  blurJob = (id: string, token: object, expected: DashboardCursorSnapshot<Job, undefined>): void => {const window = this.jobs; if (window && window.snapshot().scope === expected.scope) window.blur(id, token);};
  focusSessionHost = (expected: DashboardCursorSnapshot<AdminSession, SessionMeta>): void => {const now = this.sessions.snapshot(); if (now === expected && this.valid(this.role)) this.sessions.focus(undefined);};
  focusJobHost = (expected: DashboardCursorSnapshot<Job, undefined>): void => {const now = this.jobs?.snapshot(); if (now && now === expected && this.valid('owner')) this.jobs?.focus(undefined);};
  dispose(): void {if (this.disposed) return; this.retire(); this.disposed = true; this.lifetime.signal.removeEventListener('abort', this.retire); this.readers.console.dispose(); this.clearListeners();}
}
