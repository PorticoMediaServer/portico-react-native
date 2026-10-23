import {ConsoleClient, type Alert, type Job, type Measurement} from '../../../../../packages/client-core/src/console';
import {AdminSessionsClient} from '../../../../../packages/client-core/src/playback-v1/admin-sessions';
import type {AdminSession} from '../../../../../packages/client-core/src/playback-v1/types';
import type {NativeScreenLifetime} from './lifetime';
import {NativeScreenStore} from './lifetime';

export type NativeDashboardAdmission = 'owner' | 'administrator' | 'denied';
export type NativeDashboardSnapshot = Readonly<{
  admission: NativeDashboardAdmission;
  loading: boolean;
  sessions: readonly AdminSession[];
  nextCursor?: string;
  totals?: Awaited<ReturnType<AdminSessionsClient['list']>>['totals'];
  health?: Measurement;
  storage?: Measurement;
  alerts: readonly Alert[];
  jobs: readonly Job[];
  error?: unknown;
}>;
export type NativeDashboardReaders = Readonly<{
  sessions: Pick<AdminSessionsClient, 'list'>;
  console: Pick<ConsoleClient, 'measurement' | 'alerts' | 'jobs' | 'dispose'>;
}>;

/** Re-evaluate main-profile and live membership authority before every read and publication. */
export class NativeDashboardController extends NativeScreenStore<NativeDashboardSnapshot> {
  private disposed = false;
  private inFlight?: Promise<void>;
  readonly lifetime: NativeScreenLifetime;
  private admission: () => NativeDashboardAdmission;
  private readers: NativeDashboardReaders;
  constructor(lifetime: NativeScreenLifetime, admission: () => NativeDashboardAdmission, readers: NativeDashboardReaders) {
    super({admission: admission(), loading: false, sessions: [], alerts: [], jobs: []});
    this.lifetime = lifetime; this.admission = admission; this.readers = readers;
  }
  refresh(): Promise<void> {
    this.lifetime.assert();
    const admission = this.admission();
    if (this.disposed || admission === 'denied') {
      this.publish({admission: 'denied', loading: false, sessions: [], alerts: [], jobs: []});
      return Promise.resolve();
    }
    // Never retain owner-only facts under an administrator heading, even while a prior
    // owner request or the administrator's new sessions read is still pending.
    if (this.getSnapshot().admission !== admission) this.publish({admission, loading: false, sessions: [], alerts: [], jobs: []});
    if (this.inFlight) return this.inFlight;
    this.publish({...this.getSnapshot(), admission, loading: true, error: undefined});
    return this.inFlight = (async () => {
      try {
        // Administrator sessions never trigger owner-only console reads, even in the background.
        const [page, owner] = await Promise.all([
          this.readers.sessions.list(undefined, 10, this.lifetime.signal),
          admission === 'owner' ? Promise.all([this.readers.console.measurement('health'), this.readers.console.measurement('storage'), this.readers.console.alerts(), this.readers.console.jobs()]) : undefined,
        ]);
        if (this.disposed || !this.lifetime.current()) return;
        if (this.admission() !== admission) {
          this.publish({admission: this.admission(), loading: false, sessions: [], alerts: [], jobs: []});
          return;
        }
        this.publish({admission, loading: false, sessions: page.items, nextCursor: page.nextCursor, totals: page.totals,
          ...(owner ? {health: owner[0], storage: owner[1], alerts: owner[2], jobs: owner[3].items} : {alerts: [], jobs: []})});
      } catch (error) {
        if (!this.disposed && this.lifetime.current()) {
          if (this.admission() !== admission) this.publish({admission: this.admission(), loading: false, sessions: [], alerts: [], jobs: []});
          else this.publish({...this.getSnapshot(), loading: false, error});
        }
      }
    })().finally(() => {this.inFlight = undefined;});
  }
  dispose(): void {if (this.disposed) return; this.disposed = true; this.readers.console.dispose(); this.clearListeners();}
}
