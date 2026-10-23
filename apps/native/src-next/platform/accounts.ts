import {NativeModules} from 'react-native';
import {HttpLocalApi, type HostedSession, type LocalSession} from '../../../../packages/client-core/src';
import {ServerSignInProbe, signInLabelKey} from '../../../../packages/client-core/src/sign-in';
import type {AppServerSession, NewServerConnection, PorticoAccountScope} from '../../../../packages/client-core/src/app-sessions';
import {restoreNativeSession, rememberNativeSession, type ConnectionEnvironment} from '../../../../packages/client-core/src/server-connections';
import {nativeAppSessions} from './app-session-storage';
import {nativeNetworkFetch, nativeServerEnvironment} from './server-connections';
import {createCredentials} from './credentials';
import {createNativeAccountClient} from './account-client';
import {TVConsentApprover, type TVConsentAuthority} from '../../../../packages/client-core/src/tv-consent';
import {forgetSessionRoute, sessionRoute} from '../../../../packages/client-core/src/route-connection';
import {forgetStoredNativeServer, type NativeServerBinding} from './forget-server';
import {hostedUrl} from './account-authority';
import {routePath as hostedPath} from '../../../../packages/contracts/src/hosted/routes';
import {decodeMeGetResponse} from '../../../../packages/contracts/src/hosted/decoders';
import {readNativeServerDisplays, rememberNativeServerDisplay} from './server-display';

/** Headless native account/session owner. No Hosted credential is opened for local-only use.
 * Views receive server ids, verified names and localization keys, never bearer/refresh tokens. */
export class NativeAccounts {
  readonly probe = new ServerSignInProbe(nativeNetworkFetch);
  private credentials?: ReturnType<typeof createCredentials>;
  private generation = 0;
  private accountAttempt?: ReturnType<typeof createCredentials>;
  private disposed = false;
  private readonly fences = new Set<() => void>();
  private readonly cancellations = new Set<() => void>();
  private readonly settled = new Set<() => void>();
  private assertCurrent = (generation = this.generation) => {
    if (this.disposed || generation !== this.generation) throw Object.assign(new Error('native_accounts_cancelled'), {name: 'AbortError'});
  };
  /** Every active private runtime fences synchronously before a selection or sign-out starts. */
  onFence(listener: () => void) {this.fences.add(listener); return () => {this.fences.delete(listener);};}
  onCancel(listener: () => void) {this.cancellations.add(listener); return () => {this.cancellations.delete(listener);};}
  onSettled(listener: () => void) {this.settled.add(listener); return () => {this.settled.delete(listener);};}
  private fence(notify = true) {++this.generation; this.probe.cancel(); if (this.accountAttempt) void this.accountAttempt.logout().catch(() => {}); for (const listener of [...this.cancellations]) listener(); if (notify) for (const listener of [...this.fences]) listener();}
  private finishFence() {for (const listener of [...this.settled]) listener();}
  async snapshot() {
    const generation = this.generation; this.assertCurrent(generation);
    const state = await nativeAppSessions.read(); this.assertCurrent(generation);
    const names = await readNativeServerDisplays(state.servers); this.assertCurrent(generation);
    return Object.freeze({selectedServerId: state.selectedServerId, servers: Object.freeze(state.servers.map(value => Object.freeze({
      id: value.connection.pin.serverId, name: names.find(name => name.serverId === value.connection.pin.serverId)!.name, signIn: value.signIn,
      familyId: value.connection.session.sessionFamilyId, fingerprint: value.connection.pin.fingerprint,
      labelKey: signInLabelKey(value.signIn),
    })))});
  }
  /** Capture before credentials begin; canonical admission refuses every stale completion. */
  async admission(signIn: NewServerConnection['signIn'], hostedAccount?: PorticoAccountScope): Promise<NewServerConnection> {
    const generation = this.generation; this.assertCurrent(generation);
    const state = await nativeAppSessions.read(); this.assertCurrent(generation);
    return {signIn, ...(hostedAccount ? {hostedAccount} : {}), expectedRevision: state.revision};
  }
  async remember(api: HttpLocalApi, session: LocalSession, admission: NewServerConnection, hosted?: AppServerSession['connection']['hosted'], current: () => boolean = () => true) {
    const generation = this.generation; this.assertCurrent(generation);
    if (!current()) throw Object.assign(new Error('native_sign_in_cancelled'), {name: 'AbortError'});
    const env = nativeServerEnvironment(session.viewer.serverId, admission);
    const me = await api.me(); this.assertCurrent(generation);
    if (!current()) throw Object.assign(new Error('native_sign_in_cancelled'), {name: 'AbortError'});
    if ((['serverId', 'accountId', 'profileId', 'authority', 'role'] as const).some(key => me.viewer[key] !== session.viewer[key]))
      throw Object.assign(new Error('native_viewer_mismatch'), {code: 'identity_mismatch'});
    await rememberNativeServerDisplay(api, {serverId: session.viewer.serverId, signIn: admission.signIn,
      isCurrent: () => !this.disposed && generation === this.generation && current()});
    this.assertCurrent(generation);
    const previous = (await nativeAppSessions.read()).servers.find(value => value.connection.pin.serverId === session.viewer.serverId);
    this.assertCurrent(generation);
    for (const listener of [...this.fences]) listener();
    try {
      await rememberNativeSession(api, session, env, hosted, () => !this.disposed && generation === this.generation && current()); this.assertCurrent(generation);
      return previous && previous.connection.session.sessionFamilyId !== session.sessionFamilyId ? previous : undefined;
    }
    finally {this.finishFence();}
  }
  /** Called after the candidate has taken durable ownership, so a cleanup failure can never
   * send the caller down its unpublished-candidate rollback path. */
  retireReplacedServerSession(previous: AppServerSession | undefined) {return previous ? this.revoke([previous]) : Promise.resolve();}
  async switchServer(serverId: string) {
    this.assertCurrent(); const state = await nativeAppSessions.read(); this.assertCurrent();
    if (!state.servers.some(value => value.connection.pin.serverId === serverId)) throw Object.assign(new Error('native_server_unavailable'), {code: 'cancelled'});
    if (state.selectedServerId === serverId) return;
    this.fence(); try {await nativeAppSessions.select(serverId); this.assertCurrent();} finally {this.finishFence();}
  }
  /** Selective removal is durable before remote revocation; transient network failure cannot
   * restore it. Remote cleanup uses the captured exact server/family, never the new selection. */
  async signOutServer(serverId: string, familyId: string) {
    this.assertCurrent(); const selected = await nativeAppSessions.selected(); this.assertCurrent();
    const active = selected?.connection.pin.serverId === serverId && selected.connection.session.sessionFamilyId === familyId;
    this.fence(active);
    try {const removed = await nativeAppSessions.signOutServer(serverId, familyId); await this.revoke(removed);}
    finally {if (active) this.finishFence();}
  }
  /** Forget a changed server without contacting whatever now answers there. */
  async forgetServer(binding: NativeServerBinding) {
    this.assertCurrent();
    const selected = await nativeAppSessions.selected(); this.assertCurrent();
    const active = selected?.connection.pin.serverId === binding.serverId && selected.connection.session.sessionFamilyId === binding.familyId;
    this.fence(active); const generation = this.generation;
    try {
      await forgetStoredNativeServer(binding, {
        sessions: nativeAppSessions,
        current: () => !this.disposed && generation === this.generation,
        forgetCertificates: async (serverId, origins) => {
          if (typeof NativeModules.PorticoNetwork?.forgetServerCertificates !== 'function')
            throw Object.assign(new Error('native_certificate_storage_unavailable'), {code: 'certificate_storage'});
          await NativeModules.PorticoNetwork.forgetServerCertificates(serverId, origins);
        },
        retireRoutes: records => {
          const retired = new Set<ReturnType<typeof sessionRoute>>();
          for (const value of records) {
            retired.add(sessionRoute(value.connection.session.accessToken));
            forgetSessionRoute(value.connection.session.accessToken);
          }
          for (const route of retired) route?.dispose();
        },
      });
    } finally {if (active) this.finishFence();}
  }
  async signOutPorticoAccount(expected: {accountId: string; familyId: string}) {
    this.assertCurrent(); const selected = await nativeAppSessions.selected(); this.assertCurrent();
    const active = selected?.signIn === 'portico'; this.fence(active);
    try {
    const credentials = this.accountCredentials();
    await credentials.synchronize();
    const account = credentials.getSnapshot().session;
    if (!account || account.account.id !== expected.accountId || account.familyId !== expected.familyId)
      throw Object.assign(new Error('native_account_changed'), {code: 'account_changed'});
    const removed = await nativeAppSessions.signOutPorticoAccount({origin: hostedUrl, accountId: expected.accountId});
    // CredentialSessionService persists its own revocation journal for offline retry.
    await credentials.logoutIfCurrent(expected); await this.revoke(removed);
    }
    finally {if (active) this.finishFence();}
  }
  /** Explicit user-selected Portico action only. Constructing this owner does no account IO. */
  accountCredentials() {this.assertCurrent(); return this.credentials ??= createCredentials(hostedUrl);}
  accountClient(binding: string) {this.assertCurrent(); return createNativeAccountClient(hostedUrl, binding);}
  async authenticatePorticoAccount(callback: (signal: AbortSignal) => Promise<HostedSession>) {
    const credentials = this.accountCredentials();
    if (this.accountAttempt) throw Object.assign(new Error('native_account_attempt_active'), {code: 'account_changed'});
    this.accountAttempt = credentials;
    try {return await credentials.authenticateIfSignedOut(callback);}
    finally {if (this.accountAttempt === credentials) this.accountAttempt = undefined;}
  }
  signInPorticoAccount(binding: string, username: string, password: string) {
    const client = this.accountClient(binding), generation = this.generation;
    return this.authenticatePorticoAccount(async signal => {
      this.assertCurrent(generation);
      const id: unknown = await NativeModules.PorticoRuntime.newRequestId(); this.assertCurrent(generation);
      if (typeof id !== 'string' || !/^[A-Za-z0-9_-]{1,128}$/.test(id)) throw Object.assign(new Error('native_account_request_invalid'), {code: 'invalid_request'});
      return client.login(username, password, id, signal);
    });
  }
  adoptPorticoTVSession(session: HostedSession) {
    return this.authenticatePorticoAccount(async signal => {
      const me = decodeMeGetResponse(await new HttpLocalApi(hostedUrl, session.accessToken, nativeNetworkFetch).request(hostedPath('me_get'), 'GET', undefined, signal));
      if (me.account.id !== session.account.id) throw Object.assign(new Error('native_account_identity_mismatch'), {code: 'identity_mismatch'});
      return session;
    });
  }
  async localTVConsent(api: HttpLocalApi, session: () => LocalSession | undefined) {
    const current = session(), generation = this.generation; this.assertCurrent(generation);
    const selected = await nativeAppSessions.selected(); this.assertCurrent(generation);
    if (!current || !selected || selected.signIn !== 'local' || selected.connection.session.sessionFamilyId !== current.sessionFamilyId ||
        selected.connection.pin.serverId !== current.viewer.serverId || selected.connection.session.viewer.accountId !== current.viewer.accountId ||
        api.getRouteConnection()?.pin.serverId !== current.viewer.serverId || api.baseUrl !== selected.connection.logicalOrigin)
      throw Object.assign(new Error('native_consent_authority_changed'), {code: 'consent_retired'});
    const authority = (value: LocalSession): TVConsentAuthority => ({kind: 'local', origin: api.baseUrl,
      accountId: value.viewer.accountId, sessionFamilyId: value.sessionFamilyId, serverId: value.viewer.serverId});
    return new TVConsentApprover(api, authority(current), () => {
      const value = session(); return !this.disposed && generation === this.generation && value ? authority(value) : undefined;
    });
  }
  async porticoTVConsent() {
    const generation = this.generation, credentials = this.accountCredentials();
    await credentials.synchronize(); this.assertCurrent(generation);
    const account = await credentials.accessSession(); this.assertCurrent(generation);
    const authority = (value: typeof account): TVConsentAuthority => ({kind: 'portico', origin: hostedUrl,
      accountId: value.account.id, sessionFamilyId: value.familyId});
    return new TVConsentApprover(new HttpLocalApi(hostedUrl, account.accessToken, nativeNetworkFetch), authority(account), () => {
      const value = credentials.getSnapshot().session;
      return !this.disposed && generation === this.generation && value ? authority(value) : undefined;
    });
  }
  private async revoke(removed: readonly AppServerSession[]) {
    const results = await Promise.allSettled(removed.map(async value => {
      const record = value.connection;
      let captured: AppServerSession['connection'] | undefined = record;
      const env: ConnectionEnvironment = {...nativeServerEnvironment(record.pin.serverId), storage: {
        read: async () => captured, change: async update => {captured = update(captured);},
      }};
      // Signed route verification and /me happen on this server only. A Portico logout does
      // not need an account directory request to end the server-local session.
      let restored: Awaited<ReturnType<typeof restoreNativeSession>>;
      try {restored = await restoreNativeSession(env, undefined, record.session); if (restored) await restored.api.logout();}
      finally {restored?.api.getRouteConnection()?.dispose(); forgetSessionRoute(record.session.accessToken); if (captured) forgetSessionRoute(captured.session.accessToken);}
    }));
    const failed = results.filter(value => value.status === 'rejected');
    if (failed.length) throw Object.assign(new Error('native_session_revocation_pending'), {code: 'session_revocation_pending'});
  }
  cancel() {if (!this.disposed) {try {this.fence();} finally {this.finishFence();}}}
  dispose() {if (this.disposed) return; this.fence(); this.disposed = true; this.probe.dispose(); this.fences.clear(); this.cancellations.clear(); this.settled.clear();}
}

/** One product owner; disposal belongs to temporary owners, never to a React render cycle. */
export const nativeAccounts = new NativeAccounts();
