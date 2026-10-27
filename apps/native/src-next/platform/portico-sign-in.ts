import {NativeModules} from 'react-native';
import {MFARequiredError, parseAccountReturn, parseNativeAccountContinuation,
  type HostedAccountClient, type IdentityProvider, type IdentityTransaction, type MFAChallenge, type NativeAccountContinuation, type Registration} from '../../../../packages/client-core/src/hosted-security';
import {CodedError} from '../../../../packages/client-core/src/server-messages';
import {ApiError, type HostedSession} from '../../../../packages/client-core/src';
import {routePath as hostedPath, routeBody as hostedBody} from '../../../../packages/contracts/src/hosted/routes';
import {nativeAccounts} from './accounts';
import {linkNativeAbortSignals} from './abort-signals';
import {hostedUrl} from './account-authority';

/** An opaque, frozen witness for the private factor challenge this port holds. It
 * carries no challenge token and cannot be forged: only this exact cached object is
 * accepted, and only while it is bound to the exact challenge the port still holds.
 * Callers hand the reference back; they cannot build an interchangeable one. */
declare const nativeFactorWitness: unique symbol;
export type NativeFactorWitness = Readonly<{readonly [nativeFactorWitness]: true}>;

/** Root 43: the one typed early outcome the signup form may put on the username
 * field. Only a confirmed public-handle collision carries this closed code; a
 * generic conflict, a transport failure or an email/provider answer never does. */
export const porticoUsernameUnavailable = (error: unknown): boolean =>
  error instanceof ApiError && error.status === 409 && error.code === 'username_unavailable';

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
  private registrationCollision?: Readonly<{original: Registration; verified: Registration}>;
  /** The original provider attempt's own binding identity: its mode at start (native
   * Apple versus a browser return) and the completion code that attempt was bound
   * with. Never inferred later from a provider name or capability. */
  private providerAttempt?: Readonly<{transactionId: string; nativeApple: boolean; completionCode?: string; continuationBinding: string}>;
  /** Set the moment a confirmed username refusal needs a rotated proof; kept if the
   * refresh fails so the next completion must refresh this same original first. */
  private providerRefresh?: IdentityTransaction;
  /** The one issued factor witness and the exact private challenge it was bound to. */
  private factorWitness?: Readonly<{witness: NativeFactorWitness; challenge: MFAChallenge}>;
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
  private async authenticate(work: (signal: AbortSignal) => Promise<HostedSession>, callerCurrent?: () => boolean) {
    this.check(); if (this.authenticating) throw Object.assign(new Error('native_account_attempt_active'), {name: 'AbortError'});
    this.authenticating = true;
    // Every admission carries this source's own lifetime, whether or not the caller
    // supplied a predicate, and a supplied predicate is combined with it rather than
    // replacing it: a retired source can never adopt a known result.
    const admitted = () => {
      if (this.abort.signal.aborted || !this.isCurrent()) return false;
      if (!callerCurrent) return true;
      try {return callerCurrent() === true;} catch {return false;}
    };
    try {
      const result = await nativeAccounts.authenticatePorticoAccount(async signal => {this.check(); return work(signal);}, admitted);
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
  /** Issue, or reuse, the witness for the private challenge this port holds. The
   * returned object is frozen and opaque; the token and challenge never leave here. */
  factorChallengeIdentity(): NativeFactorWitness | undefined {
    const challenge = this.continuation?.mfa;
    if (!challenge) {this.factorWitness = undefined; return undefined;}
    if (this.factorWitness?.challenge !== challenge) {
      this.factorWitness = Object.freeze({witness: Object.freeze({}) as NativeFactorWitness, challenge});
    }
    return this.factorWitness.witness;
  }
  factor(code: string, caller?: Readonly<{signal: AbortSignal; isCurrent: () => boolean}>, witness?: NativeFactorWitness) {
    const challenge = this.continuation?.mfa;
    if (!challenge) throw new Error('native_factor_missing');
    // The old one-argument behaviour exists only when neither a caller nor a witness is
    // supplied; a caller without a witness is a forged new-path attempt and is refused.
    if (!witness && !caller) return this.authenticate(signal => this.api().mfa(challenge, code, signal));
    const issued = this.factorWitness;
    if (!witness || !caller || !issued || witness !== issued.witness || issued.challenge !== challenge
      || !(Date.parse(challenge.expiresAt) > Date.now())) throw new CodedError('cancelled', 'native_factor_changed');
    const callerLive = () => !this.abort.signal.aborted && this.isCurrent() && caller.isCurrent() && !caller.signal.aborted
      && this.continuation?.mfa === challenge;
    return this.authenticate(async signal => {
      if (!callerLive()) throw new CodedError('cancelled', 'native_factor_changed');
      const linked = linkNativeAbortSignals([this.abort.signal, caller.signal, signal]);
      try {return await this.api().mfa(challenge, code, linked.signal);} finally {linked.dispose();}
    }, callerLive);
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
    const binding = this.continuation?.binding;
    if (!binding) throw new Error('native_continuation_missing');
    this.providerAttempt = Object.freeze({transactionId: start.transactionId, nativeApple, continuationBinding: binding});
    this.providerRefresh = undefined;
    await this.checkpoint({transactionId: start.transactionId, completionCode: undefined});
    this.check();
    if (nativeApple) {
      const assertion = await this.bridge.signInApple(start.nativeNonce); this.check();
      this.transaction = await this.api().nativeApple(start.transactionId, assertion.idToken, assertion.displayName ?? '', this.abort.signal);
    } else {
      if (this.bridge.canOpenBrowser !== true || !start.authorizationUrl) throw new Error('native_provider_unavailable');
      const returned = parseAccountReturn(await this.bridge.openBrowser(start.authorizationUrl, start.transactionId), start.transactionId, hostedUrl); this.check();
      this.providerAttempt = Object.freeze({transactionId: start.transactionId, nativeApple: false, completionCode: returned.completionCode, continuationBinding: binding});
      await this.checkpoint({completionCode: returned.completionCode});
      this.transaction = await this.api().transaction(start.transactionId, this.abort.signal, returned.completionCode) ?? undefined;
    }
    this.check(); if (!this.transaction) throw new Error('native_provider_incomplete');
    return this.transaction;
  }
  /** Only a confirmed failed public-username insert rotates the onboarding proof.
   * Read that SAME transaction through the continuation's own completion binding —
   * never the browser's latest — and adopt it only when it is provably the same
   * sign-in with a fresh, unexpired proof; otherwise retire it and refuse. */
  private async refreshProvider(original: IdentityTransaction, signal: AbortSignal, caller?: Readonly<{signal: AbortSignal; isCurrent: () => boolean}>) {
    const attempt = this.providerAttempt;
    if (!attempt || attempt.transactionId !== original.transactionId) throw new CodedError('account_changed', 'native_provider_changed');
    // A browser attempt is bound by its completion code; the original native-Apple
    // attempt has none (NativeCompletion=false) and is still bound by id + session.
    if (!attempt.nativeApple && !attempt.completionCode) throw new CodedError('account_changed', 'native_provider_binding_missing');
    const callerLive = () => !caller || (caller.isCurrent() && !caller.signal.aborted);
    const current = () => !this.abort.signal.aborted && !signal.aborted && callerLive() && this.isCurrent() && this.transaction === original
      && this.providerAttempt === attempt && this.continuation?.binding === attempt.continuationBinding
      && this.continuation?.completionCode === attempt.completionCode;
    if (!current()) throw new CodedError('cancelled', 'native_provider_changed');
    // The rotation GET is cancelled with the same lifetimes it is guarded by.
    const linked = linkNativeAbortSignals([this.abort.signal, signal, caller?.signal]);
    try {
      const fresh = await this.api().transaction(original.transactionId, linked.signal, attempt.completionCode);
      if (!current()) throw new CodedError('cancelled', 'native_provider_changed');
      if (!fresh || fresh.transactionId !== original.transactionId || fresh.provider !== original.provider || fresh.mode !== 'login'
        || !fresh.needsUsername || !fresh.contactVerified || !['onboarding', 'verified'].includes(fresh.status)
        || fresh.verifiedEmail !== original.verifiedEmail || fresh.expiresAt !== original.expiresAt || !(Date.parse(fresh.expiresAt) > Date.now())
        || !fresh.onboardingToken || fresh.onboardingToken === original.onboardingToken) {
        this.transaction = undefined;
        throw new CodedError('account_changed', 'native_provider_changed');
      }
      this.transaction = fresh; this.providerRefresh = undefined;
    } finally {linked.dispose();}
  }
  async finishProvider(username?: string, displayName?: string, factor?: string,
    caller?: Readonly<{signal: AbortSignal; isCurrent: () => boolean}>) {
    // The caller's own lifetime is linked into every step, so a form that has left
    // can neither complete nor start a proof refresh from its internal catch.
    const callerLive = () => !caller || (caller.isCurrent() && !caller.signal.aborted);
    // A marker left by a failed rotation is honoured before any new completion, so
    // the now-invalid token is never replayed and no extra completion is sent.
    const pending = this.providerRefresh;
    if (pending) await this.refreshProvider(pending, this.abort.signal, caller);
    const transaction = this.transaction, attempt = this.providerAttempt;
    if (!transaction) throw new Error('native_provider_incomplete');
    try {
      // The instance's own lifetime and the form's are linked into the wire request.
      // The known complete session is handed to the owned coordinator together with
      // this form's predicate: it refuses adoption for a retired caller and still
      // queues exact fresh-family compensation, so the result is never hidden.
      // The original transaction and provider attempt stay in the coordinator's own
      // admission predicate, so removing the callback post-throw moved those guards
      // here instead of dropping them.
      const admitted = () => this.transaction === transaction && this.providerAttempt === attempt && callerLive();
      const accepted = await this.authenticate(async signal => {
        const linked = linkNativeAbortSignals([this.abort.signal, caller?.signal, signal]);
        try {
          if (!callerLive()) throw new CodedError('cancelled', 'native_provider_changed');
          return await this.api().complete(transaction.transactionId, {username, displayName, factor, onboardingToken: transaction.onboardingToken}, linked.signal);
        } finally {linked.dispose();}
      }, admitted);
      this.providerRefresh = undefined;
      return accepted;
    } catch (error) {
      // Only the explicit confirmed username refusal may rotate the proof; a generic
      // conflict, a transport failure or an uncertain completion keeps its replay.
      if (error instanceof ApiError && error.status === 409 && error.code === 'username_unavailable'
        && !this.abort.signal.aborted && this.transaction === transaction) {
        // The marker stays if this caller has gone or the rotation fails; the next
        // completion refreshes this same original first and never replays the token.
        this.providerRefresh = transaction;
        if (callerLive()) await this.refreshProvider(transaction, this.abort.signal, caller);
      }
      throw error;
    }
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
    this.registrationCollision = undefined;
    this.registration = await this.api().register({username, displayName, password, contactAddress, requestId: await this.bridge.newRequestId()}, this.abort.signal);
    this.check(); return this.registration;
  }
  async verifyRegistration(code: string, original: Registration, caller: Readonly<{isCurrent: () => boolean}>, replacement?: Readonly<{username: string; displayName: string}>) {
    const registration = original;
    if (!registration || this.registration !== registration) throw new Error('native_registration_missing');
    const binding = this.continuation?.binding;
    const current = () => !this.abort.signal.aborted && this.isCurrent() && this.registration === registration
      && this.continuation?.binding === binding && caller.isCurrent();
    if (!binding || !current() || (replacement && (!registration.contactVerified || !(Date.parse(registration.expiresAt) > Date.now()))))
      throw new CodedError('cancelled', 'native_registration_changed');
    try {
      return await this.authenticate(signal => this.api().verifyRegistration(registration.registrationId,
        {code: code.trim(), ...(replacement ? {username: replacement.username.trim().toLowerCase(), displayName: replacement.displayName.trim()} : {})}, signal), current);
    } catch (error) {
      if (porticoUsernameUnavailable(error) && current()) {
        const fresh = await this.api().registration(registration.registrationId, this.abort.signal);
        if (!current()) throw new CodedError('cancelled', 'native_registration_changed');
        if (!fresh || fresh.registrationId !== registration.registrationId || fresh.revision !== registration.revision || fresh.expiresAt !== registration.expiresAt
          || fresh.maskedAddress !== registration.maskedAddress || fresh.status === 'completed' || !fresh.contactVerified || !(Date.parse(fresh.expiresAt) > Date.now()))
          throw new CodedError('account_changed', 'native_registration_changed');
        this.registration = fresh; this.registrationCollision = {original: registration, verified: fresh};
      }
      throw error;
    }
  }
  registrationAfterCollision(original: Registration) {
    const collision = this.registrationCollision;
    return collision?.original === original && collision.verified === this.registration ? collision.verified : undefined;
  }
  dispose() {if (this.abort.signal.aborted) return; this.abort.abort(); this.bridge?.cancel(); this.off(); this.providerAttempt = undefined; this.providerRefresh = undefined; this.registrationCollision = undefined; this.factorWitness = undefined; if (this.authenticating) nativeAccounts.cancel();}
}
