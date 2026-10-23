import {HttpLocalApi, type HostedServer, type LocalSession} from '../../../../packages/client-core/src';
import {ServerSignInProbe, type ServerSignIn} from '../../../../packages/client-core/src/sign-in';
import {directSignIn, completeDirectSignInChallenge, selectDirectProfile, parseDirectSnapshot, type DirectSignIn, type DirectSnapshot} from '../../../../packages/client-core/src/profile-management';
import {connectHostedServer, connectPairedServer, inspectDirectServer} from '../../../../packages/client-core/src/server-connections';
import type {NewServerConnection, AppServerSession} from '../../../../packages/client-core/src/app-sessions';
import {porticoSignIn} from '../../../../packages/client-core/src/portico-servers';
import {routePath} from '../../../../packages/contracts/src/routes';
import {createNativeLocalTVSignIn} from './tv-sign-in';
import type {ServerPin} from '../../../../packages/client-core/src/route-identity';
import {installationIdentity} from '../../../../packages/client-core/src/installation';
import {nativeAccounts, type NativeAccounts} from './accounts';
import {hostedUrl} from './account-authority';
import {nativeNetworkFetch, nativeServerEnvironment, nativeHostedSource, nativeRouteCrypto} from './server-connections';

const cancelled = () => Object.assign(new Error('native_sign_in_cancelled'), {name: 'AbortError'});
const mismatch = () => Object.assign(new Error('native_sign_in_authority_changed'), {code: 'identity_mismatch'});

/** Current product sign-in commands. UI frames are separate; no retired screen is imported.
 * Every path uses the canonical probe, real verified routes, account/profile API and secure store. */
export class NativeServerSignIn {
  readonly probe = new ServerSignInProbe(nativeNetworkFetch);
  private readonly controller = new AbortController();
  private readonly installation = installationIdentity();
  private api?: HttpLocalApi;
  private server?: ServerSignIn;
  private admission?: NewServerConnection;
  private hosted?: AppServerSession['connection']['hosted'];
  private snapshot?: DirectSnapshot;
  private account?: LocalSession;
  private challenge?: string;
  private busy = false;
  private running?: Promise<unknown>;
  private readonly unfence: () => void;
  private readonly owner: NativeAccounts;
  private complete = false;
  private publishing = false;
  private disposeRequested = false;
  private readonly issued = new Map<string, LocalSession>();
  constructor(owner: NativeAccounts = nativeAccounts) {this.owner = owner; this.unfence = owner.onCancel(() => this.cancel());}
  private current = () => !this.controller.signal.aborted && installationIdentity() === this.installation;
  private assertCurrent = () => {if (!this.current()) throw cancelled(); if (!this.installation) throw mismatch();};
  private async run<T>(work: () => Promise<T>): Promise<T> {
    this.assertCurrent(); if (this.busy || this.complete) throw cancelled(); this.busy = true;
    const pending = this.running = work();
    try {return await pending;} finally {this.busy = false; if (this.running === pending) this.running = undefined; if (this.disposeRequested) this.cancel();}
  }
  /** The returned kind drives the credential destination. Local pairing is explicit afterward. */
  inspect(address: string) {
    return this.run(async () => {
      const server = await this.probe.inspect(address); this.assertCurrent();
      if (!server || server.setupRequired) throw mismatch();
      this.server = server; return server;
    });
  }
  inspectLocalIdentity(): Promise<ServerPin> {
    return this.run(async () => {
      const server = this.server, origin = this.probe.getSnapshot().origin;
      if (!server || !origin || server.signIn !== 'local') throw Object.assign(new Error('sign_in_kind_portico'), {code: 'sign_in_kind_portico'});
      const pin = await inspectDirectServer(origin, nativeServerEnvironment(server.id), this.controller.signal); this.assertCurrent();
      if (pin.serverId !== server.id) throw mismatch(); return pin;
    });
  }
  confirmLocal(pin: ServerPin) {
    return this.run(async () => {
      const server = this.server, origin = this.probe.getSnapshot().origin;
      if (!server || !origin || server.signIn !== 'local' || pin.serverId !== server.id || this.api) throw mismatch();
      this.admission = await this.owner.admission('local'); this.assertCurrent();
      const connected = await connectPairedServer(origin, pin, nativeServerEnvironment(server.id), this.controller.signal);
      this.api = connected.api; this.assertCurrent();
    });
  }
  /** Explicit Portico path: identity and directory transport are opened only here. */
  connectPortico(server: HostedServer) {
    return this.run(async () => {
      if (this.api) throw mismatch();
      const credentials = this.owner.accountCredentials();
      await credentials.synchronize(); this.assertCurrent();
      const account = await credentials.accessSession(); this.assertCurrent();
      this.admission = await this.owner.admission('portico', {origin: hostedUrl, accountId: account.account.id});
      const connected = await connectHostedServer(server, nativeHostedSource(hostedUrl, credentials, account.account.id), nativeServerEnvironment(server.id), this.controller.signal);
      this.api = connected.api; this.hosted = connected.hosted; this.assertCurrent();
      const system = await this.probe.inspect(connected.api.baseUrl); this.assertCurrent();
      if (!system || system.id !== server.id || system.signIn !== 'portico' || system.setupRequired) throw mismatch();
      this.server = system;
      return this.consume(await porticoSignIn(new HttpLocalApi(hostedUrl, account.accessToken, nativeNetworkFetch), hostedUrl,
        connected.api, server.id, {signal: this.controller.signal, crypto: nativeRouteCrypto}));
    });
  }
  localTVSignIn() {
    this.assertCurrent(); if (!this.server || !this.api || !this.admission) throw mismatch();
    return createNativeLocalTVSignIn(this.server, this.api);
  }
  acceptLocalTVSession(session: LocalSession) {
    return this.run(async () => {
      if (!this.api || !this.server || this.server.signIn !== 'local' || !this.admission) throw mismatch();
      this.issued.set(session.sessionFamilyId, session); this.api.setAccessToken(session.accessToken);
      try {
        const snapshot = parseDirectSnapshot(await this.api.request(routePath('get_direct_account'), 'GET', undefined, this.controller.signal),
          {authority: 'local', serverId: this.server.id, accountId: session.viewer.accountId});
        return await this.consume({kind: 'signed-in', snapshot, session, accountScoped: session.viewer.role === 'account', passwordChangeRequired: false});
      } catch (error) {await this.retire(session); throw error;}
    });
  }
  signInLocal(username: string, password: string) {
    return this.run(async () => {
      if (this.server?.signIn !== 'local' || !this.api || this.account || !this.admission) throw mismatch();
      return this.consume(await directSignIn(this.api, username, password, this.controller.signal));
    });
  }
  completeSecondFactor(code: string) {
    return this.run(async () => {
      if (!this.api || !this.challenge || this.server?.signIn !== 'local') throw mismatch();
      return this.consume(await completeDirectSignInChallenge(this.api, this.challenge, code, this.controller.signal));
    });
  }
  private async consume(result: DirectSignIn) {
    if (result.kind !== 'signed-in') {
      this.assertCurrent();
      if (result.kind === 'challenge') {this.challenge = result.token; return {kind: 'challenge' as const, expiresAt: result.expiresAt};}
      // Retired device-approval answers never grant a session or create a waiting gate.
      throw mismatch();
    }
    const session = result.session; this.issued.set(session.sessionFamilyId, session);
    try {
      this.assertCurrent();
      if (!this.api || !this.server || result.snapshot.serverId !== this.server.id || session.installationId !== this.installation?.installationId) throw mismatch();
      this.api.setAccessToken(session.accessToken); this.snapshot = result.snapshot; this.challenge = undefined;
      if (result.passwordChangeRequired) throw Object.assign(new Error('password_change_required'), {code: 'password_change_required'});
      if (result.accountScoped) {this.account = session; return {kind: 'profiles' as const, profiles: result.snapshot.profiles};}
      await this.persist(session); return {kind: 'complete' as const};
    } catch (error) {await this.retire(session); throw error;}
  }
  chooseProfile(profileId: string, pin?: string) {
    return this.run(async () => {
      if (!this.api || !this.snapshot || !this.account || !this.snapshot.profiles.some(profile => profile.id === profileId)) throw mismatch();
      const result = await selectDirectProfile(this.api, {authority: 'local', accountId: this.snapshot.account.id, serverId: this.snapshot.serverId},
        profileId, {pin, installationId: this.installation?.installationId}, this.controller.signal);
      this.issued.set(result.session.sessionFamilyId, result.session);
      try {await this.persist(result.session);} catch (error) {await this.retire(result.session); throw error;}
    });
  }
  private async persist(session: LocalSession) {
    this.assertCurrent();
    if (!this.api || !this.admission || session.viewer.authority !== 'local' || session.viewer.role === 'account' || session.installationId !== this.installation?.installationId) throw mismatch();
    this.api.setAccessToken(session.accessToken);
    this.publishing = true;
    try {
    const previous = await this.owner.remember(this.api, session, this.admission, this.hosted, this.current);
    this.issued.delete(session.sessionFamilyId); this.complete = true;
    const temporary = this.account; this.account = undefined;
    const cleanup = await Promise.allSettled([this.owner.retireReplacedServerSession(previous), temporary ? this.retire(temporary) : Promise.resolve()]);
    if (cleanup.some(value => value.status === 'rejected')) throw Object.assign(new Error('native_session_revocation_pending'), {code: 'session_revocation_pending'});
    } finally {this.publishing = false;}
  }
  private async retire(session: LocalSession) {
    if (!this.issued.delete(session.sessionFamilyId) || !this.api) return;
    const retired = new HttpLocalApi(this.api.baseUrl, session.accessToken, nativeNetworkFetch);
    const routes = this.api.getRouteConnection(); if (routes) retired.useRoutes(routes);
    await retired.logout();
  }
  dispose() {
    // A shell fence can unmount the initiating view during the atomic publication.
    // The headless command owns that completion; explicit account cancellation still
    // calls cancel immediately and is compensated by the canonical store.
    if (this.publishing) {this.disposeRequested = true; return;}
    this.cancel();
  }
  private cancel() {
    if (this.controller.signal.aborted) return;
    this.controller.abort(); this.probe.dispose(); this.unfence();
    const routes = this.api?.getRouteConnection();
    void Promise.resolve(this.running).catch(() => {}).then(() => Promise.allSettled([...this.issued.values()].map(session => this.retire(session)))).finally(() => routes?.dispose());
    this.account = undefined; this.snapshot = undefined; this.challenge = undefined;
  }
}
