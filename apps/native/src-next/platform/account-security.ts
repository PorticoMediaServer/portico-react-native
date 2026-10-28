import {NativeModules} from 'react-native';
import {ApiError, HttpLocalApi} from '../../../../packages/client-core/src';
import {AccountNotificationsClient, type AccountExportJob} from '../../../../packages/client-core/src/account-notifications';
import {securityPurposeNeedsProof, type AccountScope, type DeletionPreview, type HostedAccountClient, type SecurityIntent, type SecurityResult, type SecurityState} from '../../../../packages/client-core/src/hosted-security';
import {presentError} from '../../../../packages/client-core/src/presentation/errors';
import type {NativeAccounts} from './accounts';
import {accountExpectation, nativeAccountRead, nativeAccountWork} from './account-work';
import {hostedUrl} from './account-authority';
import {nativeNetworkFetch} from './server-connections';

export type NativeAccountSecurityKind = 'password' | 'email' | 'mfa-on' | 'mfa-off' | 'codes' | 'export' | 'delete';
export type NativeAccountSecurityInput = Readonly<{password?: string; factor?: string; newPassword?: string; email?: string; code?: string; confirmation?: string}>;
export type NativeAccountSecuritySnapshot = Readonly<{
  kind?: NativeAccountSecurityKind; step: 'form' | 'email' | 'mfa' | 'codes' | 'deletion' | 'export' | 'done'; busy: boolean;
  failure?: string; locked?: boolean; result?: SecurityResult; preview?: DeletionPreview; exportJob?: AccountExportJob;
}>;
type Opening = {kind: NativeAccountSecurityKind; controller: AbortController; operationId?: string; client?: HostedAccountClient;
  input?: NativeAccountSecurityInput; intent?: SecurityIntent; busy: boolean; result?: SecurityResult; preview?: DeletionPreview};
const changed = () => Object.assign(new Error('native_account_security_retired'), {code: 'account_changed'});
const closed: NativeAccountSecuritySnapshot = Object.freeze({step: 'form', busy: false});

/** One account/family/page opening. Proofs, password drafts and one-time results stay
 * memory-only; the existing command wrapper never replays a mutation after renewal. */
export class NativeAccountSecurity {
  private readonly owner: NativeAccounts;
  readonly security: SecurityState;
  private readonly isCurrent: () => boolean;
  private readonly credentials: ReturnType<NativeAccounts['accountCredentials']>;
  private readonly listeners = new Set<() => void>();
  private readonly scope: AccountScope;
  private opening?: Opening;
  private disposed = false;
  private state: NativeAccountSecuritySnapshot = closed;
  constructor(owner: NativeAccounts, scope: AccountScope, security: SecurityState, isCurrent: () => boolean) {
    this.owner = owner; this.security = security; this.isCurrent = isCurrent;
    this.scope = Object.freeze({...scope}); this.credentials = owner.accountCredentials();
  }
  getSnapshot = () => {if (!this.current()) this.clear(); return this.state;};
  subscribe = (listener: () => void) => {this.listeners.add(listener); return () => {this.listeners.delete(listener);};};
  current = () => {const session = this.credentials.getSnapshot().session; return !this.disposed && this.isCurrent()
    && session?.account.id === this.scope.accountId && session.familyId === this.scope.familyId;};
  private owns(opening: Opening) {return this.current() && this.opening === opening && !opening.controller.signal.aborted;}
  private assert(opening: Opening) {if (!this.owns(opening)) throw changed();}
  private publish(value: NativeAccountSecuritySnapshot) {if (!this.current()) return; this.state = Object.freeze(value); this.listeners.forEach(listener => listener());}
  private clear() {
    const opening = this.opening; this.opening = undefined;
    if (opening) {opening.controller.abort(); opening.input = undefined; opening.intent = undefined; opening.result = undefined; opening.preview = undefined;}
    this.state = closed;
  }
  close() {const notify = this.current(); this.clear(); if (notify) this.listeners.forEach(listener => listener());}
  dispose() {this.clear(); this.disposed = true; this.listeners.clear();}
  open(kind: NativeAccountSecurityKind) {
    if (!this.current()) throw changed(); this.close();
    this.opening = {kind, controller: new AbortController(), busy: false};
    this.publish({kind, step: 'form', busy: false});
  }
  private async prepare(opening: Opening) {
    this.assert(opening);
    if (opening.client && opening.operationId) return;
    const bridge = NativeModules.PorticoAccountAuth;
    if (!opening.client) {
      const binding: unknown = await bridge.newBinding(); this.assert(opening);
      if (typeof binding !== 'string' || !/^[A-Za-z0-9_-]{43}$/.test(binding)) throw new Error('native_account_operation_invalid');
      opening.client = this.owner.accountClient(binding, () => this.owns(opening));
    }
    if (!opening.operationId) {
      const operationId: unknown = await bridge.newRequestId(); this.assert(opening);
      if (typeof operationId !== 'string' || operationId.length < 16 || operationId.length > 128) throw new Error('native_account_operation_invalid');
      opening.operationId = operationId;
    }
  }
  private work<T>(opening: Opening, callback: (token: string, client: HostedAccountClient) => Promise<T>, read = false): Promise<T> {
    this.assert(opening); const session = this.credentials.getSnapshot().session;
    if (!session || !opening.client) throw changed();
    const run = read ? nativeAccountRead : nativeAccountWork;
    return run(this.credentials, value => callback(value.accessToken, opening.client!),
      {expected: accountExpectation(session), signal: opening.controller.signal, isCurrent: () => this.owns(opening)});
  }
  private async run(work: (opening: Opening) => Promise<void>) {
    const opening = this.opening;
    if (!opening || !this.owns(opening) || opening.busy) return;
    opening.busy = true; this.publish({...this.state, busy: true, failure: undefined});
    try {await this.prepare(opening); this.assert(opening); await work(opening);}
    catch (error) {if (this.owns(opening)) {
      const refused = error instanceof ApiError && error.status >= 400 && error.status < 500 && error.status !== 408;
      if (refused) {opening.input = undefined; opening.intent = undefined; opening.operationId = undefined;}
      this.publish({...this.state, ...(refused ? {locked: false} : {}), failure: presentError(error, 'portico-account').body});
    }}
    finally {opening.busy = false; if (this.owns(opening)) this.publish({...this.state, busy: false});}
  }
  async submit(input: NativeAccountSecurityInput = {}) {
    if (this.state.step === 'codes' || this.state.step === 'done' || this.state.step === 'export') return;
    return this.run(async opening => {
      const signal = opening.controller.signal, kind = opening.kind;
      if (kind === 'delete') {
        if (!opening.preview) {
          const preview = await this.work(opening, (token, client) => client.deletionPreview(opening.operationId!, token, signal));
          this.assert(opening); opening.preview = preview; this.publish({kind, step: 'deletion', busy: true, preview}); return;
        }
        const expected = this.security.contactAddress || this.credentials.getSnapshot().session?.account.username;
        if (!opening.preview.canDelete || Date.parse(opening.preview.expiresAt) <= Date.now() || !expected || input.confirmation?.trim() !== expected) throw new Error('native_account_deletion_confirmation_required');
        const receipt = await this.work(opening, (token, client) => client.acceptDeletion(opening.preview!, input.confirmation!, token, signal));
        this.assert(opening); if (!receipt.accountDeleted) throw new Error('native_account_deletion_unconfirmed');
        await this.owner.signOutPorticoAccount(this.scope); return;
      }
      if (kind === 'export') {
        const job = await this.work(opening, token => new AccountNotificationsClient((path, method, body, requestSignal) =>
          new HttpLocalApi(hostedUrl, token, nativeNetworkFetch).request(path, method, body, requestSignal)).requestExport(opening.operationId!, signal));
        this.assert(opening); this.publish({kind, step: 'export', busy: true, exportJob: job}); return;
      }
      if (this.state.step === 'email' || this.state.step === 'mfa') {
        const challenge = opening.result?.challengeId, phase = this.state.step;
        if (!challenge) throw changed();
        const result = await this.work(opening, (token, client) => client.confirm(phase, challenge, input.code ?? '', opening.operationId!, this.scope, token, signal));
        this.assert(opening); await this.accept(opening, result); return;
      }
      // Provider-only credential changes stay unavailable until the original Security
      // reauthentication continuation is admitted; an empty password is never proof.
      if (!this.security.hasPassword) throw new Error('native_account_provider_proof_unavailable');
      opening.input ??= Object.freeze({...input});
      const chosen = opening.input;
      opening.intent ??= {purpose: kind === 'password' ? 'password_set_or_change' : kind === 'email' ? 'email_change'
        : kind === 'mfa-on' ? 'mfa_enroll' : kind === 'mfa-off' ? 'mfa_disable' : 'recovery_codes',
        target: kind === 'email' ? chosen.email?.trim() ?? '' : '', operationId: opening.operationId!};
      this.publish({...this.state, locked: true});
      const result = await this.work(opening, async (token, client) => {
        const intent = opening.intent!;
        const proof = securityPurposeNeedsProof(intent.purpose)
          ? await client.passwordProof(intent, chosen.password ?? '', chosen.factor ?? '', this.scope, token, signal) : undefined;
        this.assert(opening);
        return client.action(intent, proof?.proof, chosen.newPassword ?? '', this.scope, token, signal);
      });
      this.assert(opening); await this.accept(opening, result);
    });
  }
  private async accept(opening: Opening, result: SecurityResult) {
    this.assert(opening); opening.result = result;
    if (result.signOut) {await this.owner.signOutPorticoAccount(this.scope); return;}
    const step = result.recoveryCodes ? 'codes' : result.challengeId && opening.kind === 'email' ? 'email'
      : result.challengeId && opening.kind === 'mfa-on' ? 'mfa' : 'done';
    opening.input = undefined; if (step === 'email' || step === 'mfa') opening.operationId = undefined;
    this.publish({kind: opening.kind, step, busy: true, result});
  }
}
