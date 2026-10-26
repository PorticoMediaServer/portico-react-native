import {routePath} from '../../../../../packages/contracts/src/routes';
import {parseStartPreparation, type PreparingSessionView, type StartContext, type StartOptions, type StartTarget} from '../../../../../packages/client-core/src/playback-v1/sessions';
import type {V1Request, V1Response} from '../../../../../packages/client-core/src/playback-v1/http';

const valid = (read: () => boolean) => {try {return read() === true;} catch {return false;}};
const retired = () => Object.assign(new Error('Original playback start retired'), {name: 'AbortError'});
const freeze = <T,>(value: T): T => {
  if (value && typeof value === 'object') {for (const child of Object.values(value)) freeze(child); Object.freeze(value);}
  return value;
};
export type NativePreparingOwner = Readonly<{
  current(): boolean;
  stop(session: PreparingSessionView, signal: AbortSignal, uninstalled: () => boolean, claim: () => boolean): Promise<void>;
}>;
type Flight = {
  registration: object;
  seen: Set<string>; denied: boolean; stopping: boolean; cleaning: boolean; done: boolean;
  key: string; body?: string; current(): boolean; release(): void;
  prepared?: PreparingSessionView; cleanup?: () => Promise<void>; abort?: AbortController;
  capture(session: PreparingSessionView): (() => Promise<void>) | undefined;
};
export type OriginalNativeStart = Readonly<{body: StartTarget & StartOptions; key: string; context: StartContext; finish(): void}>;
export type NativeStartRegistration = Readonly<{
  remember(id: string): boolean; forget(id: string): void; dispose(): void;
  begin(target: StartTarget, options: StartOptions, key: string, signal: AbortSignal | undefined, current: () => boolean): OriginalNativeStart;
  observe(request: V1Request): void;
  retired(request: V1Request, response: V1Response): void;
}>;

/** Original-start receipts are independent of queue-selection receipts. This
 * owner is shared by the actual native paths borrowing one selected-server API.
 * Every installation seen during a flight permanently denies its cleanup, even
 * if the same id is later forgotten. No latest route/stack is adopted. */
export class NativePreparingStarts {
  private readonly registrations = new Set<{ids: Set<string>; installed(id: string): boolean}>();
  private readonly flights = new Set<Flight>();
  private readonly requests = new Map<string, Flight>();
  private readonly dispatched = new WeakMap<V1Request, Flight>();

  attach(captureOwner: () => NativePreparingOwner | undefined, installed: (id: string) => boolean): NativeStartRegistration {
    const registration = {ids: new Set<string>(), installed}; this.registrations.add(registration);
    let live = true;
    return Object.freeze<NativeStartRegistration>({
      remember: (id: string) => {
        if ([...this.flights].some(flight => flight.stopping && flight.prepared?.id === id)) return false;
        for (const flight of this.flights) {
          if (flight.seen.size >= 256) flight.denied = true; else flight.seen.add(id);
          if (flight.prepared?.id === id) {flight.denied = true; flight.abort?.abort();}
        }
        if (live) registration.ids.add(id);
        return true;
      },
      forget: (id: string) => {registration.ids.delete(id);},
      dispose: () => {live = false; registration.ids.clear(); this.registrations.delete(registration);},
      begin: (target: StartTarget, options: StartOptions, key: string, signal: AbortSignal | undefined, current: () => boolean) => {
        if (!live || typeof key !== 'string' || !key || this.requests.has(key)) throw retired();
        // Reserve before any caller/target/options getter can reenter this path.
        const flight: Flight = {registration, key, seen: new Set(), denied: false, stopping: false, cleaning: false, done: false,
          current: () => live && !flight.done && !signal?.aborted && valid(current),
          release: () => {this.flights.delete(flight); if (this.requests.get(key) === flight) this.requests.delete(key);},
          capture: () => undefined};
        this.flights.add(flight); this.requests.set(key, flight);
        const finish = () => {flight.done = true; if (!flight.cleaning) flight.release();};
        try {
          if (!flight.current()) throw retired();
          const owner = captureOwner();
          const body: StartTarget & StartOptions = freeze(JSON.parse(JSON.stringify({...target, ...options})));
          flight.body = JSON.stringify(body);
          for (const registered of this.registrations) for (const id of registered.ids) {
            if (flight.seen.size >= 256) flight.denied = true; else flight.seen.add(id);
          }
          if (!flight.current()) throw retired();
          flight.capture = offered => {
            // No generic/latest-principal cleanup fallback. Older/unbound hosts
            // may complete ordinary 201s, but cannot continue a real-resource202
            // without this original owner proof (its finite server lease remains).
            if (!owner) throw retired();
            if (flight.prepared) return flight.prepared.id === offered.id && flight.prepared.presentation.generation === offered.presentation.generation ? flight.cleanup : undefined;
            if (flight.done || !valid(owner.current) || 'transferId' in body || offered.role !== 'local' || offered.state === 'ended'
              || !Number.isSafeInteger(offered.presentation.generation) || offered.presentation.generation < 1
              || ('queue' in body ? offered.queue?.queueId !== body.queue.queueId || offered.queue?.entryId !== body.queue.entryId
                : 'itemId' in body ? offered.itemId !== body.itemId : true)
              || body.versionId !== undefined && offered.versionId !== body.versionId
              || body.discTitle !== undefined && (offered.discTitle?.id !== body.discTitle.id || offered.discTitle.revision !== body.discTitle.revision)) return undefined;
            flight.prepared = offered;
            let spent = false;
            const owned = () => !flight.denied && this.flights.has(flight) && flight.prepared === offered && !flight.seen.has(offered.id);
            const uninstalled = () => owned() && valid(owner.current)
              && [...this.registrations].every(value => valid(() => !value.installed(offered.id)))
              && valid(owner.current) && owned();
            return flight.cleanup = async () => {
              if (spent) return; spent = true;
              if (!uninstalled()) return;
              flight.cleaning = true;
              const abort = flight.abort = new AbortController();
              try {
                if (!uninstalled()) return;
                await owner.stop(offered, abort.signal, uninstalled, () => {
                  if (flight.stopping || !uninstalled()) return false;
                  flight.stopping = true; return true;
                });
              } finally {flight.cleaning = false; flight.abort = undefined; flight.release();}
            };
          };
          return Object.freeze({body, key, context: Object.freeze({signal, isCurrent: flight.current, capturePreparing: flight.capture}), finish});
        } catch (error) {finish(); throw error;}
      },
      observe: request => {
        if (request.method !== 'POST' || request.path !== routePath('start_playback_session')) return;
        const key = Object.entries(request.headers ?? {}).find(([name]) => name.toLowerCase() === 'idempotency-key')?.[1];
        const flight = key ? this.requests.get(key) : undefined;
        if (!flight || flight.registration !== registration || !flight.current()) return;
        try {
          if (JSON.stringify(request.body) === flight.body && flight.current() && !flight.done && this.flights.has(flight)) this.dispatched.set(request, flight);
        } catch { /* No original-wire proof. */ }
      },
      retired: (request, response) => {
        const flight = this.dispatched.get(request);
        if (!flight || flight.done || response.status !== 202) return;
        try {
          // Scope HTTP still rejects the caller. Only the strict actual real202
          // variant can hand its original receipt a resource; retry-only cannot.
          const offered = parseStartPreparation(response.body).session;
          if (offered) void flight.capture(offered)?.().catch(() => {});
        } catch { /* Malformed/changed/uncustodied replies never authorize DELETE. */ }
      },
    });
  }
}
