import {HttpLocalApi, type LocalSession} from '../../../../packages/client-core/src/index.ts';
import {type AppSessionStore, knownServerRoutes} from '../../../../packages/client-core/src/app-sessions.ts';
import {parseClaimStatus, type ClaimExpected} from '../../../../packages/client-core/src/claim-onboarding.ts';
import {installationIdentity} from '../../../../packages/client-core/src/installation.ts';
import {prepareSetupClaimHandoff, type SetupClaimHandoff} from '../../../../packages/client-core/src/setup-claim-client.ts';
import {verifySetupClaimStart} from '../../../../packages/client-core/src/setup-claim-start.ts';
import {resumeServerSetup, type SetupDraft} from '../../../../packages/client-core/src/setup-onboarding.ts';
import {parseDirectSignIn, type DirectSignIn} from '../../../../packages/client-core/src/profile-management.ts';
import {assertFirstContactIdentity, routeBase64, routeBytes, routeOrigin, sameServerPin, type ServerPin, type RouteCrypto} from '../../../../packages/client-core/src/route-identity.ts';
import {connectPairedServer, connectPairedPorticoServer, type ConnectionEnvironment} from '../../../../packages/client-core/src/server-connections.ts';
import {NativeSetupEnded} from './setup-outcome';
import {NativeSetupApproval} from './setup-approval';
import {CodedError} from '../../../../packages/client-core/src/server-messages.ts';
import {routePath} from '../../../../packages/contracts/src/routes.ts';

type Pending = Readonly<{
  version: 1; kind: 'setup'; attemptId: string; origin: string; hostedOrigin: string; pin: ServerPin;
  expectedRevision: number; setupRequestId: string; setupToken: string; setupRevision: string;
  installationId: string; state: string; verifier: string; codeChallenge: string; createdAt: number; expiresAt: string;
  expected?: ClaimExpected; handoff?: SetupClaimHandoff; approvalURL?: string; retired?: true; retiredDraft?: SetupDraft;
}>;
type Journal = Readonly<{assertAvailable: () => void; read: () => Promise<Pending | undefined>;
  change: (update: (old: Pending | undefined) => Pending | undefined, beforeCommit?: () => void) => Promise<void>}>;
type Ports = Readonly<{
  journal: Journal; draft: (serverId: string) => NativeSetupDraftStore;
  selectionLease: typeof withNativeSelectionLease; sessions: Pick<AppSessionStore, 'read'>;
  environment: (serverId: string) => ConnectionEnvironment; installationId: () => string; pageOrigin: () => string;
  crypto: RouteCrypto; fetcher: typeof fetch;
  now?: () => number; prepare?: typeof prepareSetupClaimHandoff;
  connect?: typeof connectPairedServer; connectPortico?: typeof connectPairedPorticoServer;
}>;
type Completion = Readonly<{api: HttpLocalApi; result: Extract<DirectSignIn, {kind: 'signed-in'}>;
  hosted: {origin: string; accountId: string; key: import('../../../../packages/client-core/src/route-identity').RouteKey};
  accept: () => void; release: () => Promise<void>;
  draft: {requestId: string; setupToken: string};
  admission: import('../../../../packages/client-core/src/app-sessions').NewServerConnection}>;
const invalid = () => new CodedError('invalid_return', 'This setup continuation is no longer available.');
const cancelled = () => new CodedError('cancelled', 'The pending setup or server selection changed.');
const same = (a: Pending | undefined, b: Pending) => !!a && JSON.stringify(a) === JSON.stringify(b);
const object = (value: unknown): value is Record<string, unknown> => !!value && typeof value === 'object' && !Array.isArray(value);

/** Native setup resumes from the original server's installed status, never a callback URL.
 * Initial setup has no Local owner or authorization family. Its only authority
 * is the original protected setup request/token and Server-supplied revision. */
export class NativeSetupClaim {
  private ended?: Pending;
  private endedDraft?: SetupDraft;
  private epoch = 0;
  private controller?: AbortController;
  private attemptId?: string;
  private busy = false;
  constructor(private readonly ports: Ports) {}
  private now() {return (this.ports.now ?? Date.now)();}
  private operation() {
    if (this.busy) throw new CodedError('move_request_in_progress', 'Wait for this setup request to finish.');
    this.busy = true;
    this.controller?.abort(); const epoch = ++this.epoch, controller = this.controller = new AbortController();
    return {signal: controller.signal, current: () => epoch === this.epoch && !controller.signal.aborted};
  }
  private async current(record: Pending, operation: ReturnType<NativeSetupClaim['operation']>, journal = true) {
    this.ports.journal.assertAvailable();
    if (journal && !same(await this.ports.journal.read(), record)) throw cancelled();
    const draft = await this.ports.draft(record.pin.serverId).read(), selection = await this.ports.sessions.read();
    if (!operation.current() || record.version !== 1 || record.kind !== 'setup' || record.origin !== this.ports.pageOrigin() ||
      record.installationId !== this.ports.installationId() || selection.revision !== record.expectedRevision ||
      (!draft ? !record.retired : draft.version !== 1 || draft.authMode !== 'hosted' || draft.serverId !== record.pin.serverId || draft.requestId !== record.setupRequestId || draft.setupToken !== record.setupToken) ||
      !Number.isSafeInteger(record.createdAt) || record.createdAt < 0 || record.createdAt > this.now() + 60_000 || !Number.isFinite(Date.parse(record.expiresAt)) ||
      Date.parse(record.expiresAt) <= this.now() || Date.parse(record.expiresAt) > record.createdAt + 300_000) throw cancelled();
    return draft;
  }
  /** Explicit cancellation retires only this native attempt, never an installed claim. */
  async cancel() {
    ++this.epoch; this.controller?.abort();
    const id = this.attemptId; this.attemptId = undefined;
    if (id) await this.ports.journal.change(old => old?.attemptId === id ? undefined : old);
  }
  dispose() {++this.epoch; this.controller?.abort();}
  async resumePrepared(): Promise<{url?: string} | undefined> {
    const operation = this.operation();
    try {
      const record = await this.ports.journal.read();
      if (!record) return undefined;
      if (!record.handoff || !record.expected) throw invalid();
      await this.current(record, operation);
      const binding = record.handoff.binding;
      if (binding.origin !== record.origin || binding.hostedOrigin !== record.hostedOrigin || !sameServerPin(binding.pin, record.pin)
        || binding.state !== record.state || binding.installationId !== record.installationId || binding.codeChallenge !== record.codeChallenge
        || binding.operationId !== record.expected.operationId || binding.localGeneration !== record.expected.localGeneration
        || binding.setupRequestId !== record.setupRequestId || binding.setupRevision !== record.setupRevision
        || JSON.stringify(record.handoff.expected) !== JSON.stringify(record.expected)) throw invalid();
      const proof = await verifySetupClaimStart(record.handoff.claim, record.handoff.start, binding, this.now(), this.ports.crypto);
      await this.current(record, operation);
      if (record.handoff.expiresAt !== proof.start.expiresAt || Date.parse(record.expiresAt) > Date.parse(proof.start.expiresAt)) throw invalid();
      if (record.retired) {this.ended = record; this.endedDraft = record.retiredDraft; throw new NativeSetupEnded('cancelled');}
      if (record.approvalURL) {
        const url = new URL(record.approvalURL), fragment = new URLSearchParams(url.hash.slice(1));
        if (url.origin !== record.hostedOrigin || url.pathname !== '/claim' || url.search || url.username || url.password
          || [...fragment.keys()].sort().join(',') !== 'code,operation,server' || fragment.get('operation') !== record.expected.operationId
          || fragment.get('server') !== proof.claim.name || !fragment.get('code')?.startsWith('claim_')) throw invalid();
        routeBytes(fragment.get('code')!.slice(6), 32);
      }
      this.attemptId = record.attemptId; return {url: record.approvalURL};
    } finally {this.busy = false;}
  }
  async prepare(api: HttpLocalApi, hostedOrigin: string): Promise<string | undefined> {
    this.ports.journal.assertAvailable();
    const existing = await this.resumePrepared();
    if (existing) return existing.url;
    const origin = this.ports.pageOrigin(), route = api.getRouteConnection();
    if (api.baseUrl !== origin || routeOrigin(origin) !== origin || !route || route.getSnapshot().phase !== 'ready' ||
      routeOrigin(hostedOrigin) !== hostedOrigin || !hostedOrigin.startsWith('https://')) throw invalid();
    const operation = this.operation();
    try {
      const draft = await this.ports.draft(route.pin.serverId).read(), selection = await this.ports.sessions.read();
      if (!operation.current() || !draft || draft.version !== 1 || draft.serverId !== route.pin.serverId || draft.authMode !== 'hosted' || !draft.setupToken) throw invalid();
      assertFirstContactIdentity(origin, route.pin, {knownRoutes: knownServerRoutes(selection)});
      const captured = new HttpLocalApi(origin, draft.setupToken, this.ports.fetcher); captured.useRoutes(route);
      const resumed = await resumeServerSetup(captured, this.ports.draft(route.pin.serverId), operation.signal);
      if (!('claimRequired' in resumed) || resumed.requestId !== draft.requestId) throw invalid();
      let pending = await this.ports.journal.read();
      if (!pending) {
        const verifier = routeBase64(this.ports.crypto.random(32)), createdAt = this.now();
        const codeChallenge = routeBase64(await this.ports.crypto.sha256(new TextEncoder().encode(verifier)));
        pending = {version: 1, kind: 'setup', attemptId: routeBase64(this.ports.crypto.random(32)), origin, hostedOrigin, pin: {...route.pin},
          expectedRevision: selection.revision, setupRequestId: draft.requestId, setupToken: draft.setupToken, setupRevision: resumed.revision,
          installationId: this.ports.installationId(), state: routeBase64(this.ports.crypto.random(32)), verifier, codeChallenge,
          createdAt, expiresAt: new Date(createdAt + 300_000).toISOString()};
        const fresh = pending;
        await this.ports.journal.change(old => {if (!operation.current() || old) throw cancelled(); return fresh;});
      }
      if (pending.origin !== origin || pending.hostedOrigin !== hostedOrigin || !sameServerPin(pending.pin, route.pin) || pending.setupRequestId !== resumed.requestId || pending.setupRevision !== resumed.revision) throw invalid();
      this.attemptId = pending.attemptId;
      await this.current(pending, operation);
      if (!pending.expected) {
        let status = parseClaimStatus(await captured.request(routePath('get_networking_claim'), 'GET', undefined, operation.signal), pending.pin);
        await this.current(pending, operation);
        if (status.actions.includes('prepare')) {
          status = parseClaimStatus(await captured.request(routePath('post_networking_claim_prepare'), 'POST', {purpose: 'setup', expected: status.identity}, operation.signal), pending.pin);
          await this.current(pending, operation);
        }
        if (status.state !== 'prepared' || !status.operation || status.approvalRequest?.purpose !== 'setup' || status.approvalRequest.currentOwnerAccountId !== '' ||
          status.approvalRequest.previousOwnerRole !== '' || status.approvalRequest.returnRegistrationId !== '') throw invalid();
        const old = pending, updated = {...pending, expected: {...status.operation}};
        await this.ports.journal.change(current => {if (!operation.current() || !same(current, old)) throw cancelled(); return updated;});
        pending = updated;
      }
      const binding = {pin: pending.pin, origin, hostedOrigin, operationId: pending.expected!.operationId, localGeneration: pending.expected!.localGeneration,
        setupRequestId: pending.setupRequestId, setupRevision: pending.setupRevision, state: pending.state, codeChallenge: pending.codeChallenge, installationId: pending.installationId};
      const url = await (this.ports.prepare ?? prepareSetupClaimHandoff)(captured, pending.expected!, binding, {
        assertPendingCurrent: async () => {await this.current(pending!, operation);},
        bindPending: async handoff => {
          await this.current(pending!, operation);
          const old = pending!, updated = {...old, handoff, expiresAt: new Date(Math.min(Date.parse(old.expiresAt), Date.parse(handoff.expiresAt))).toISOString()};
          await this.ports.journal.change(current => {if (!operation.current() || !same(current, old)) throw cancelled(); return updated;});
          pending = updated;
        },
      }, {signal: operation.signal, now: () => this.now(), crypto: this.ports.crypto});
      await this.current(pending, operation);
      const beforeURL = pending, withURL = {...pending, approvalURL: url};
      await this.ports.journal.change(old => {if (!operation.current() || !same(old, beforeURL)) throw cancelled(); return withURL;});
      await this.current(withURL, operation);
      return url;
    } finally {this.busy = false;}
  }
  async accountApproval(url: string, opening: {signal: AbortSignal; current: () => boolean; canApprove: () => boolean}) {
    const resumed = await this.resumePrepared();
    if (!resumed?.url || resumed.url !== url) throw invalid();
    const operation = this.operation();
    try {
      const record = await this.ports.journal.read();
      if (!record?.handoff || !record.expected) throw invalid();
      await this.current(record, operation);
      const proof = await verifySetupClaimStart(record.handoff.claim, record.handoff.start, record.handoff.binding, this.now(), this.ports.crypto);
      await this.current(record, operation);
      const parsed = new URL(url), fragment = new URLSearchParams(parsed.hash.slice(1));
      if (parsed.origin !== record.hostedOrigin || parsed.pathname !== '/claim' || parsed.search || parsed.username || parsed.password
        || [...fragment.keys()].sort().join(',') !== 'code,operation,server' || fragment.get('operation') !== record.expected.operationId
        || fragment.get('server') !== proof.claim.name) throw invalid();
      const code = fragment.get('code') ?? '';
      if (!code.startsWith('claim_')) throw invalid(); routeBytes(code.slice(6), 32);
      const originalDraft = await this.current(record, operation);
      const approval = new NativeSetupApproval({code, serverId: record.pin.serverId, name: proof.claim.name, origin: record.origin,
        transactionId: record.handoff.transactionId, expiresAt: record.handoff.expiresAt},
        async () => {await this.current(record, operation);}, operation.signal, opening, () => {if (!operation.current() || !opening.current()) throw cancelled(); this.ended = record; this.endedDraft = originalDraft ? Object.freeze({...originalDraft}) : undefined;});
      try {const display = await approval.review(); return {approval, display};}
      catch (error) {approval.dispose(); throw error;}
    } finally {this.busy = false;}
  }
  /** Explicit user restart retires only this terminal local journal/draft.
   * A tombstone prevents a crash between keys from reviving the old handoff. */
  async abandonEnded() {
    const operation = this.operation(), record = this.ended, capturedDraft = this.endedDraft;
    try {
      if (!record || !capturedDraft) throw invalid();
      let ownedRecord = record;
      const assert = () => {
        if (!operation.current() || record.installationId !== this.ports.installationId() || this.ended !== ownedRecord) throw cancelled();
      };
      await this.ports.selectionLease(record.expectedRevision, assert, async (check, beforeCommit) => {
        const stored = await this.ports.journal.read(); await check();
        if (!same(stored, record)) throw cancelled();
        const retired: Pending = {...record, retired: true, retiredDraft: {...capturedDraft}};
        await this.ports.journal.change(old => {beforeCommit(); if (!same(old, record)) throw cancelled(); return retired;}, beforeCommit);
        ownedRecord = retired; this.ended = retired; await check();
        await this.ports.draft(record.pin.serverId).change(old => {
          beforeCommit();
          if (old === undefined ? !record.retired : JSON.stringify(old) !== JSON.stringify(capturedDraft)) throw cancelled();
          return undefined;
        }, beforeCommit);
        await check();
        await this.ports.journal.change(old => {beforeCommit(); if (!same(old, retired)) throw cancelled(); return undefined;}, beforeCommit);
        await check(); this.ended = undefined;
        this.endedDraft = undefined; this.attemptId = undefined;
      });
    } finally {this.busy = false;}
  }
  private async retire(api: HttpLocalApi, session: LocalSession, initial: ReadonlySet<string>) {
    if (initial.has(session.sessionFamilyId) || session.installationId !== this.ports.installationId()) return;
    const temporary = new HttpLocalApi(api.baseUrl, session.accessToken, this.ports.fetcher), routes = api.getRouteConnection();
    if (routes) temporary.useRoutes(routes);
    const retained = await this.ports.sessions.read();
    if (retained.servers.some(value => value.connection.session.sessionFamilyId === session.sessionFamilyId)) return;
    if (!routes || session.viewer.serverId !== routes.pin.serverId || session.serverIdentity?.publicKey !== routes.pin.publicKey || session.serverIdentity.fingerprint !== routes.pin.fingerprint) return;
    await temporary.logout().catch(() => {});
  }
  /** A wake only reads the original installed continuation. Consume the exact
   * journal once, immediately before exchange; a lost exchange is terminal. */
  async finishInstalled(): Promise<Completion | undefined> {
    this.ports.journal.assertAvailable(); const operation = this.operation();
    let connected: Awaited<ReturnType<typeof connectPairedServer>> | undefined, bound: Awaited<ReturnType<typeof connectPairedPorticoServer>> | undefined;
    let grant: DirectSignIn | undefined, adopted = false;
    const initial = new Set<string>();
    try {
      for (const value of (await this.ports.sessions.read()).servers) initial.add(value.connection.session.sessionFamilyId);
      const record = await this.ports.journal.read();
      if (record?.version !== 1 || record.kind !== 'setup' || !record.handoff || !record.expected) throw invalid();
      const handoff = record.handoff;
      if (record.origin !== this.ports.pageOrigin()) throw invalid();
      let consumed = false;
      const current = () => this.current(record, operation, !consumed);
      await current();
      const expected = handoff.binding;
      if (expected.origin !== record.origin || expected.hostedOrigin !== record.hostedOrigin || !sameServerPin(expected.pin, record.pin) || expected.state !== record.state ||
        expected.installationId !== record.installationId || expected.codeChallenge !== record.codeChallenge || expected.operationId !== record.expected.operationId ||
        expected.setupRequestId !== record.setupRequestId || expected.setupRevision !== record.setupRevision || expected.localGeneration !== record.expected.localGeneration ||
        JSON.stringify(handoff.expected) !== JSON.stringify(record.expected) || Date.parse(record.expiresAt) > Date.parse(handoff.expiresAt)) throw invalid();
      const proof = await verifySetupClaimStart(handoff.claim, handoff.start, expected, this.now(), this.ports.crypto);
      const digest = routeBase64(await this.ports.crypto.sha256(new TextEncoder().encode(record.verifier)));
      routeBytes(record.verifier, 32);
      if (digest !== proof.start.codeChallenge || handoff.expiresAt !== proof.start.expiresAt) throw invalid();
      if (record.retired) {this.ended = record; this.endedDraft = record.retiredDraft; throw new NativeSetupEnded('cancelled');}
      await current();
      const environment = this.ports.environment(record.pin.serverId);
      connected = await (this.ports.connect ?? connectPairedServer)(record.origin, record.pin, environment, operation.signal);
      await current(); connected.api.setAccessToken(record.setupToken);
      const raw = await connected.api.request<unknown>(routePath('get_networking_claim'), 'GET', undefined, operation.signal);
      await current();
      const status = parseClaimStatus(raw, record.pin), setup = object(raw) ? raw.setupContinuation : undefined;
      if (status.state === 'cancelled' && status.identity.localGeneration === record.expected.localGeneration
        && status.operation?.operationId === record.expected.operationId && status.operation.localGeneration === record.expected.localGeneration
        && BigInt(status.operation.revision) >= BigInt(record.expected.revision) && object(setup) && setup.phase === 'cancelled'
        && setup.transactionId === handoff.transactionId && typeof setup.expiresAt === 'string' && Date.parse(setup.expiresAt) === Date.parse(handoff.expiresAt)
        && Object.keys(setup).sort().join(',') === 'expiresAt,phase,transactionId') {this.ended = record; const draft = await current(); this.endedDraft = draft ? Object.freeze({...draft}) : undefined; throw new NativeSetupEnded('cancelled');}
      if (status.state !== 'installed') return undefined;
      if (status.identity.localGeneration !== record.expected.localGeneration || status.operation?.operationId !== record.expected.operationId
        || status.operation.localGeneration !== record.expected.localGeneration || BigInt(status.operation.revision) < BigInt(record.expected.revision)
        || !object(setup) || setup.transactionId !== handoff.transactionId || typeof setup.expiresAt !== 'string'
        || Date.parse(setup.expiresAt) !== Date.parse(handoff.expiresAt)) throw invalid();
      // The installed claim can still be provisioning its real TLS/route/return
      // registration. That exact pending shape grants nothing and retains PKCE.
      if (setup.phase === 'prepared' && Object.keys(setup).sort().join(',') === 'expiresAt,phase,transactionId') return undefined;
      if (setup.phase !== 'installed' || Object.keys(setup).sort().join(',') !== 'expiresAt,phase,returnRegistration,transactionId'
        || !object(setup.returnRegistration) || Object.keys(setup.returnRegistration).sort().join(',') !== 'id,origin'
        || typeof setup.returnRegistration.id !== 'string' || !/^ret_[A-Za-z0-9_-]{43}$/.test(setup.returnRegistration.id)
        || typeof setup.returnRegistration.origin !== 'string' || !setup.returnRegistration.origin.startsWith('https://')
        || routeOrigin(setup.returnRegistration.origin) !== setup.returnRegistration.origin) throw invalid();
      await this.ports.journal.change(old => {if (!operation.current() || !same(old, record)) throw cancelled(); return undefined;});
      consumed = true; this.attemptId = undefined;
      grant = parseDirectSignIn(await connected.api.request(routePath('post_auth_portico_return_exchange'), 'POST', {transactionId: handoff.transactionId, state: record.state,
        verifier: record.verifier, registrationId: setup.returnRegistration.id, installationId: record.installationId, serverChallenge: proof.start.serverChallenge, purpose: 'setup'}, operation.signal));
      await current();
      if (grant.kind !== 'signed-in' || grant.session.viewer.role !== 'owner' || grant.session.installationId !== record.installationId
        || grant.session.viewer.serverId !== record.pin.serverId || grant.session.serverIdentity?.publicKey !== record.pin.publicKey
        || grant.session.serverIdentity.fingerprint !== record.pin.fingerprint || Date.parse(grant.session.expiresAt) <= this.now() || grant.snapshot.serverId !== record.pin.serverId || grant.snapshot.account.role !== 'owner' || grant.snapshot.account.disabled ||
        !grant.snapshot.account.hostedAccountId || grant.session.viewer.profileId !== grant.snapshot.account.primaryProfileId || grant.resetFileOwnerSession || grant.passwordChangeRequired || grant.snapshot.twoStepSetupRequired) throw invalid();
      const accountId = grant.snapshot.account.hostedAccountId;
      bound = await (this.ports.connectPortico ?? connectPairedPorticoServer)(record.origin, record.pin,
        {origin: record.hostedOrigin, accountId, request: async () => {throw invalid();}}, environment, operation.signal);
      await current(); bound.api.setAccessToken(grant.session.accessToken);
      const returnedFamily = grant.session.sessionFamilyId;
      const retained = await this.ports.sessions.read(); await current();
      if (initial.has(returnedFamily) || retained.servers.some(value => value.connection.session.sessionFamilyId === returnedFamily)) throw invalid();
      const original = bound.api, session = grant.session, connection = bound.connection;
      let custody = true;
      const release = async () => {if (!custody) return; custody = false; try {await this.retire(original, session, initial);} finally {connection.dispose();}};
      adopted = true; return {api: bound.api, result: grant, hosted: bound.hosted,
        accept: () => {custody = false;}, release,
        draft: {requestId: record.setupRequestId, setupToken: record.setupToken},
        admission: {signIn: 'portico', hostedAccount: {origin: record.hostedOrigin, accountId}, expectedRevision: record.expectedRevision}};
    } finally {
      this.busy = false;
      try {
        if (!adopted && grant?.kind === 'signed-in') {
          if (connected) await this.retire(connected.api, grant.session, initial);
        }
      } finally {connected?.connection.dispose(); if (!adopted) bound?.connection.dispose();}
    }
  }
}

import {NativeQueueStore} from './queue-storage';
import {nativeAppSessions, withNativeSelectionLease} from './app-session-storage';
import {nativeSetupDraft, type NativeSetupDraftStore} from './setup-draft';
import {nativeNetworkFetch, nativeRouteCrypto, nativeServerEnvironment} from './server-connections';

export function createNativeSetupClaim(origin: string, serverId: string) {
  const storage = new NativeQueueStore(), key = 'native.setup-claim.v1:' + serverId;
  return new NativeSetupClaim({
    journal: {assertAvailable: () => {},
      read: () => storage.change(key, raw => ({record: raw, value: raw == null ? undefined : raw as Pending})),
      change: async (update, beforeCommit) => {await storage.change(key, raw => ({record: update(raw == null ? undefined : raw as Pending) ?? null, value: undefined}), undefined, beforeCommit);}},
    selectionLease: withNativeSelectionLease, draft: nativeSetupDraft, sessions: nativeAppSessions, environment: nativeServerEnvironment,
    crypto: nativeRouteCrypto, fetcher: nativeNetworkFetch, pageOrigin: () => origin,
    installationId: () => {const value = installationIdentity(); if (!value) throw invalid(); return value.installationId;},
  });
}
