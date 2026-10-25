import {NativeModules} from 'react-native';
import {MFARequiredError, parseAccountReturn, parseNativeAccountContinuation,
  type HostedAccountClient, type IdentityProvider, type IdentityTransaction, type NativeAccountContinuation, type Registration} from '../../../../packages/client-core/src/hosted-security';
import type {HostedSession} from '../../../../packages/client-core/src';
import {routePath as hostedPath, routeBody as hostedBody} from '../../../../packages/contracts/src/hosted/routes';
import {nativeAccounts} from './accounts';
import {hostedUrl} from './account-authority';

/** Explicit Portico sign-in only. Native continuation storage contains a binding and
 * one-time completion, never a password, provider assertion or session credential. */
export class NativePorticoSignIn {
  private readonly isCurrent: () => boolean;
  constructor(isCurrent: () => boolean = () => true) {this.isCurrent = isCurrent;}
  private readonly abort = new AbortController();
  private readonly bridge = NativeModules.PorticoAccountAuth;
  private client?: HostedAccountClient;
  private continuation?: NativeAccountContinuation;
  private transaction?: IdentityTransaction;
  private registration?: Registration;
  private authenticating = false;
  private nativeApple = false;
  private readonly off = nativeAccounts.onCancel(() => this.dispose());
  private check() {if (this.abort.signal.aborted || !this.isCurrent()) throw Object.assign(new Error('native_portico_cancelled'), {name: 'AbortError'});}
  private async checkpoint(update: Partial<NativeAccountContinuation>) {
    this.check(); if (!this.continuation) throw new Error('native_continuation_missing');
    this.continuation = {...this.continuation, ...update};
    await this.bridge.saveContinuation(hostedUrl, JSON.stringify(this.continuation)); this.check();
  }
  async prepare() {
    this.check();
    const raw: unknown = await this.bridge.loadContinuation(hostedUrl); this.check();
    let saved: NativeAccountContinuation | undefined;
    if (typeof raw === 'string') {try {saved = parseNativeAccountContinuation(raw);} catch { /* Invalid noncredential continuation is replaced. */ }}
    const binding: unknown = saved?.binding ?? await this.bridge.newBinding(); this.check();
    if (typeof binding !== 'string' || !/^[A-Za-z0-9_-]{43}$/.test(binding)) throw new Error('native_continuation_invalid');
    this.continuation = saved ?? {version: 1, binding, expiresAt: new Date(Date.now() + 15 * 60000).toISOString()};
    this.client = nativeAccounts.accountClient(binding, () => !this.abort.signal.aborted && this.isCurrent(), () => this.authenticating);
    await this.checkpoint({});
    const options = await this.client.options(this.abort.signal); this.check();
    this.nativeApple = this.bridge.canSignInApple === true && options.providers.some(value => value.id === 'apple' && value.enabled && value.native && value.nativeClientIds.includes(this.bridge.bundleId));
    return options;
  }
  private api() {this.check(); if (!this.client) throw new Error('native_continuation_missing'); return this.client;}
  private async authenticate(work: (signal: AbortSignal) => Promise<HostedSession>) {
    this.check(); if (this.authenticating) throw Object.assign(new Error('native_account_attempt_active'), {name: 'AbortError'});
    this.authenticating = true;
    try {
      const result = await nativeAccounts.authenticatePorticoAccount(async signal => {this.check(); return work(signal);});
      await this.checkpoint({mfa: undefined, transactionId: undefined, completionCode: undefined}); return result;
    } catch (error) {
      if (error instanceof MFARequiredError) await this.checkpoint({mfa: error.challenge});
      throw error;
    } finally {this.authenticating = false;}
  }
  async password(username: string, password: string) {
    const id = await this.bridge.newRequestId(); this.check();
    return this.authenticate(signal => this.api().login(username, password, id, signal));
  }
  factor(code: string) {
    const challenge = this.continuation?.mfa;
    if (!challenge) throw new Error('native_factor_missing');
    return this.authenticate(signal => this.api().mfa(challenge, code, signal));
  }
  /** Account help sends one reset link; the new password is chosen on that page,
   * on any device. The service answers the same way whether or not it matched. */
  async forgot(username: string, contactAddress: string) {
    return this.api().request(hostedPath('account_recovery_request'), 'POST',
      hostedBody('account_recovery_request', {username: username.trim().toLowerCase(), contactAddress: contactAddress.trim(),
        requestId: await this.bridge.newRequestId()}), this.abort.signal);
  }
  async provider(provider: IdentityProvider) {
    const nativeApple = provider === 'apple' && this.nativeApple;
    const start = await this.api().start(provider, {mode: 'login', requestId: await this.bridge.newRequestId(), nativeApple,
      ...(!nativeApple ? {completion: 'code' as const} : {})}, this.abort.signal); this.check();
    await this.checkpoint({transactionId: start.transactionId, completionCode: undefined});
    this.check();
    if (nativeApple) {
      const assertion = await this.bridge.signInApple(start.nativeNonce); this.check();
      this.transaction = await this.api().nativeApple(start.transactionId, assertion.idToken, assertion.displayName ?? '', this.abort.signal);
    } else {
      if (this.bridge.canOpenBrowser !== true || !start.authorizationUrl) throw new Error('native_provider_unavailable');
      const returned = parseAccountReturn(await this.bridge.openBrowser(start.authorizationUrl, start.transactionId), start.transactionId, hostedUrl); this.check();
      await this.checkpoint({completionCode: returned.completionCode});
      this.transaction = await this.api().transaction(start.transactionId, this.abort.signal, returned.completionCode) ?? undefined;
    }
    this.check(); if (!this.transaction) throw new Error('native_provider_incomplete');
    return this.transaction;
  }
  finishProvider(username?: string, displayName?: string, factor?: string) {
    const transaction = this.transaction; if (!transaction) throw new Error('native_provider_incomplete');
    return this.authenticate(signal => this.api().complete(transaction.transactionId,
      {username, displayName, factor, onboardingToken: transaction.onboardingToken}, signal));
  }
  async sendContact(address: string) {
    if (!this.transaction) throw new Error('native_provider_incomplete');
    return this.api().sendContact(this.transaction.transactionId, address, await this.bridge.newRequestId(), this.abort.signal);
  }
  async verifyContact(challengeId: string, code: string) {
    if (!this.transaction) throw new Error('native_provider_incomplete');
    this.transaction = await this.api().verifyContact(this.transaction.transactionId, challengeId, code, this.abort.signal); this.check();
  }
  async register(username: string, displayName: string, password: string, contactAddress: string) {
    this.registration = await this.api().register({username, displayName, password, contactAddress, requestId: await this.bridge.newRequestId()}, this.abort.signal);
    this.check(); return this.registration;
  }
  verifyRegistration(code: string) {
    if (!this.registration) throw new Error('native_registration_missing');
    return this.authenticate(signal => this.api().verifyRegistration(this.registration!.registrationId, {code}, signal));
  }
  dispose() {if (this.abort.signal.aborted) return; this.abort.abort(); this.bridge?.cancel(); this.off(); if (this.authenticating) nativeAccounts.cancel();}
}
