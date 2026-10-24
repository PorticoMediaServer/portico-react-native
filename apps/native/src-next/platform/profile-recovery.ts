import {HttpLocalApi, type LocalSession} from '../../../../packages/client-core/src';
import {directSignIn, completeDirectSignInChallenge, type DirectSignIn, type DirectSnapshot} from '../../../../packages/client-core/src/profile-management';
import {IdentityClient} from '../../../../packages/client-core/src/identity-client';
import {porticoSignIn, type HostedRequestApi} from '../../../../packages/client-core/src/portico-servers';
import type {SignInKind} from '../../../../packages/client-core/src/app-sessions';
import {routePath} from '../../../../packages/contracts/src/routes';
import {nativeNetworkFetch} from './server-connections';

type Grant = Extract<DirectSignIn, {kind: 'signed-in'}>;
export type NativeRecoveryPhase = 'password' | 'portico' | 'challenge' | 'pin' | 'done';
export type NativeRecoveryState = Readonly<{phase: NativeRecoveryPhase; busy?: boolean; error?: unknown}>;

export type NativeRecoveryPorts = Readonly<{
  api: HttpLocalApi;
  snapshot: DirectSnapshot;
  profileId: string;
  kind: SignInKind;
  /** Exact selected pin, family and viewer, checked after every await. */
  authorityCurrent: () => boolean;
  temporary: (session: LocalSession) => HttpLocalApi;
  /** Hosted current request supplier; absent for a local server. */
  portico?: () => Promise<Readonly<{hosted: HostedRequestApi; origin: string; accountCurrent: () => boolean}>>;
  signIn?: typeof porticoSignIn;
}>;

/** One temporary account-proof family resets one profile PIN. It never enters the
 * app-session store, never replaces the selected viewer and never accepts a child
 * viewer credential. Only the reset proof's own family is retired. */
export class NativeProfileRecovery {
  private state: NativeRecoveryState;
  private readonly listeners = new Set<() => void>();
  private epoch = 0;
  private controller?: AbortController;
  private grant?: Grant;
  private challenge?: Extract<DirectSignIn, {kind: 'challenge'}>;
  private disposed = false;
  constructor(private readonly ports: NativeRecoveryPorts) {
    if (!ports.snapshot.profiles.some(profile => profile.id === ports.profileId)) throw new Error('This profile is no longer available.');
    this.state = Object.freeze({phase: ports.snapshot.canManage ? 'pin' : ports.kind === 'local' ? 'password' : 'portico'});
  }
  getSnapshot = () => this.state;
  subscribe = (listener: () => void) => {this.listeners.add(listener); return () => {this.listeners.delete(listener);};};
  private publish(value: NativeRecoveryState) {if (this.disposed) return; this.state = Object.freeze(value); for (const listener of this.listeners) listener();}
  private operation() {
    this.controller?.abort(); const epoch = ++this.epoch, controller = this.controller = new AbortController();
    return {signal: controller.signal, current: () => !this.disposed && this.epoch === epoch && !controller.signal.aborted && this.ports.authorityCurrent()};
  }
  private async retire(grant: Grant) {
    const api = this.ports.temporary(grant.session);
    try {await api.request(routePath('delete_sessions_current'), 'DELETE');} catch { /* the temporary family still expires by itself */ }
  }
  private async accept(result: DirectSignIn, current: () => boolean) {
    if (result.kind === 'challenge') {if (current()) {this.challenge = result; this.publish({phase: 'challenge'});} return;}
    const valid = current() && result.accountScoped && result.session.viewer.role === 'account'
      && result.session.viewer.authority === this.ports.snapshot.authority
      && result.session.viewer.serverId === this.ports.snapshot.serverId
      && result.session.viewer.accountId === this.ports.snapshot.account.id
      && result.snapshot.serverId === this.ports.snapshot.serverId
      && result.snapshot.account.id === this.ports.snapshot.account.id
      && result.snapshot.profiles.some(profile => profile.id === this.ports.profileId)
      && result.snapshot.capabilities.manageAccount
      && !result.passwordChangeRequired && !result.resetFileOwnerSession;
    if (!valid) {await this.retire(result); throw new Error('Sign in to the account that owns this profile.');}
    this.grant = result; this.publish({phase: 'pin'});
  }
  async password(password: string) {
    if (this.disposed || !this.ports.authorityCurrent() || this.state.phase !== 'password' || !password || this.state.busy) return;
    const operation = this.operation(); this.publish({...this.state, busy: true, error: undefined});
    try {await this.accept(await directSignIn(this.ports.api, this.ports.snapshot.account.username, password, operation.signal), operation.current);}
    catch (error) {if (operation.current()) this.publish({...this.state, busy: false, error});}
  }
  async portico() {
    if (this.disposed || !this.ports.authorityCurrent() || this.state.phase !== 'portico' || this.state.busy) return;
    const operation = this.operation(); this.publish({...this.state, busy: true, error: undefined});
    try {
      if (!this.ports.portico) throw new Error('Portico Account sign-in is unavailable.');
      const source = await this.ports.portico();
      if (!operation.current()) return;
      const result = await (this.ports.signIn ?? porticoSignIn)(source.hosted, source.origin, this.ports.api, this.ports.snapshot.serverId,
        {signal: operation.signal});
      await this.accept(result, () => operation.current() && source.accountCurrent());
    } catch (error) {if (operation.current()) this.publish({...this.state, busy: false, error});}
  }
  async code(code: string) {
    const challenge = this.challenge;
    if (this.disposed || !this.ports.authorityCurrent() || this.state.phase !== 'challenge' || !challenge || this.state.busy) return;
    const operation = this.operation(); this.publish({...this.state, busy: true, error: undefined});
    try {await this.accept(await completeDirectSignInChallenge(this.ports.api, challenge.token, code, operation.signal), operation.current);}
    catch (error) {if (operation.current()) this.publish({...this.state, busy: false, error});}
  }
  async reset(pin: string) {
    if (this.disposed || !this.ports.authorityCurrent() || this.state.phase !== 'pin' || !/^\d{4}$/.test(pin) || this.state.busy) return;
    const operation = this.operation(), grant = this.grant;
    this.publish({...this.state, busy: true, error: undefined}); let completed = false;
    try {
      if (!operation.current()) return;
      const api = grant ? this.ports.temporary(grant.session) : this.ports.api;
      await new IdentityClient({request: (path, method, body) => api.request(path, method, body, operation.signal)}).resetPIN(this.ports.profileId, pin);
      completed = true;
      if (operation.current()) this.publish({...this.state, phase: 'done'});
    } catch (error) {if (operation.current()) this.publish({...this.state, busy: false, error});}
    finally {if (grant && (completed || !operation.current())) {this.grant = undefined; await this.retire(grant);}}
  }
  dispose() {
    if (this.disposed) return;
    this.disposed = true; ++this.epoch; this.controller?.abort(); this.challenge = undefined;
    const grant = this.grant; this.grant = undefined; if (grant) void this.retire(grant);
    this.listeners.clear();
  }
}

/** A fresh server-scoped API for the proof family; the caller's selected connection
 * and its pin are reused, never replaced. */
export function temporaryRecoveryApi(api: HttpLocalApi, session: LocalSession): HttpLocalApi {
  const temporary = new HttpLocalApi(api.baseUrl, session.accessToken, nativeNetworkFetch);
  const route = api.getRouteConnection();
  if (route) temporary.useRoutes(route);
  return temporary;
}
