import test from 'node:test';
import assert from 'node:assert/strict';
import {NativeModules} from './react-native-stub.mjs';
import {NativePorticoSignIn} from '../src-next/platform/portico-sign-in.ts';
import {nativeAccounts} from '../src-next/platform/accounts.ts';
import {MFARequiredError} from '../../../packages/client-core/src/hosted-security.ts';
import {routePath} from '../../../packages/contracts/src/hosted/routes.ts';

test('native Portico sign-in binds MFA and provider completion without persisting passwords or provider assertions', async () => {
  const records = new Map<string, string>(), sent: {url: string; body: any; headers: Headers}[] = [];
  let browser = 0, nativeApple = 0, cancel = 0;
  NativeModules.PorticoRuntime.loadCredentials = async () => records.get('credential') ?? null;
  NativeModules.PorticoRuntime.saveCredentials = async (_: string, value: string) => {records.set('credential', value);};
  (NativeModules as Record<string, unknown>).PorticoAccountAuth = {
    bundleId: 'tv.getportico.test', canOpenBrowser: true, canSignInApple: true,
    loadContinuation: async () => records.get('continuation') ?? null,
    saveContinuation: async (_: string, value: string) => {records.set('continuation', value);},
    newBinding: async () => 'b'.repeat(43), newRequestId: async () => '00000000-0000-4000-8000-000000000001',
    openBrowser: async () => {browser++; return 'portico://account-return?transactionId=transaction&code=' + 'c'.repeat(43);},
    signInApple: async () => {nativeApple++; throw new Error('Native Apple is not configured by this authority.');},
    cancel: () => {cancel++;},
  };
  const session = {account: {id: 'portico_account', username: 'synthetic', displayName: 'Synthetic'}, accessToken: 'synthetic_access', refreshToken: 'synthetic_refresh',
    familyId: 'portico_family', expiresAt: new Date(Date.now() + 3600000).toISOString(), refreshExpiresAt: new Date(Date.now() + 86400000).toISOString()};
  NativeModules.PorticoRuntime.networkRequest = async (_: string, url: string, _method: string, headers: Record<string, string>, raw: string | null) => {
    const path = new URL(url).pathname, body = raw ? JSON.parse(raw) : undefined; sent.push({url, body, headers: new Headers(headers)});
    let out: unknown;
    if (path === routePath('identity_options_get')) out = {password: true, registration: true, recovery: true, accountSecurity: true, verifiedContactRequired: true, nativeCompletion: 'code',
      providers: [{id: 'apple', enabled: true, native: false, nativeClientIds: []}]};
    else if (path === routePath('session_create')) {
      assert.equal(body.password, 'synthetic_password');
      out = {mfaRequired: true, challengeId: 'challenge', challengeToken: 'synthetic_factor_token', expiresAt: new Date(Date.now() + 600000).toISOString()};
    } else if (path === routePath('identity_mfa_complete')) {assert.equal(body.factor, '123456'); out = session;}
    else if (path === routePath('identity_start', {provider: 'apple'})) out = {transactionId: 'transaction', expiresAt: new Date(Date.now() + 600000).toISOString(), mode: 'login', authorizationUrl: 'https://appleid.apple.com/auth/authorize'};
    else if (path === routePath('identity_transaction_get', {id: 'transaction'})) {
      assert.equal(new Headers(headers).get('X-Portico-Completion'), 'c'.repeat(43));
      out = {transactionId: 'transaction', provider: 'apple', mode: 'login', status: 'verified', expiresAt: new Date(Date.now() + 600000).toISOString(), contactVerified: true, needsUsername: false, mfaRequired: false};
    } else if (path === routePath('identity_transaction_complete', {id: 'transaction'})) out = {...session, familyId: 'provider_family'};
    else if (path === routePath('session_revoke')) return {status: 204, headers: {}, body: ''};
    else throw new Error('Unexpected synthetic account path: ' + path);
    return {status: 200, headers: {}, body: JSON.stringify(out)};
  };
  const password = new NativePorticoSignIn();
  try {
    await password.prepare(); await assert.rejects(password.password('synthetic', 'synthetic_password'), MFARequiredError);
    assert.equal(JSON.parse(records.get('continuation')!).mfa.challengeId, 'challenge');
    assert.equal(nativeAccounts.accountCredentials().getSnapshot().session, undefined);
    await password.factor('123456');
    assert.equal(nativeAccounts.accountCredentials().getSnapshot().session?.familyId, 'portico_family');
    assert.equal(JSON.parse(records.get('continuation')!).mfa, undefined);
    assert.doesNotMatch(records.get('continuation')!, /synthetic_password|synthetic_access|synthetic_refresh/);
    await nativeAccounts.accountCredentials().logout();
  } finally {password.dispose();}
  const provider = new NativePorticoSignIn();
  try {
    await provider.prepare(); const tx = await provider.provider('apple'); assert.equal(tx.status, 'verified');
    assert.equal(browser, 1); assert.equal(nativeApple, 0, 'authority native client configuration controls the Apple path');
    await provider.finishProvider();
    assert.equal(nativeAccounts.accountCredentials().getSnapshot().session?.familyId, 'provider_family');
    assert.equal(JSON.parse(records.get('continuation')!).completionCode, undefined);
    assert.ok(sent.every(value => value.url.startsWith('https://web.getportico.tv/')));
    assert.ok(sent.filter(value => value.url.includes('/identity/') || value.url.endsWith('/v1/sessions')).every(value => value.headers.get('X-Portico-Continuation') === 'b'.repeat(43)));
    await nativeAccounts.accountCredentials().logout();
  } finally {provider.dispose();}
  assert.equal(cancel, 2);
});
