// @fabric-react
import test from 'node:test';
import assert from 'node:assert/strict';
import * as React from 'react';
import * as core from '../../../packages/client-core/src';
import * as security from '../../../packages/client-core/src/hosted-security';
import * as signIn from '../../../packages/client-core/src/sign-in';
import * as routes from '../../../packages/contracts/src/hosted/routes';
import {CredentialSessionService, HttpCredentialApi, type CredentialRecord} from '../../../packages/client-core/src/credentials';
import {CodedError} from '../../../packages/client-core/src/server-messages';
import {presentError} from '../../../packages/client-core/src/presentation/errors';
import * as passwordPolicy from '../../../packages/client-core/src/password-strength';
import {defaultI18n} from '../../../packages/i18n/src';
import * as accountWork from '../src-next/platform/account-work';
import * as continuationQueue from '../src-next/platform/continuation-queue';
import * as abortSignals from '../src-next/platform/abort-signals';
import * as setupOutcome from '../src-next/platform/setup-outcome';
import * as hostedUnavailable from '../src-next/platform/hosted-sign-in-unavailable';
import * as directoryChooser from '../src-next/screens/accounts/directory-chooser';
import {createTheme} from '../src-next/kit/theme';
import {act, createFabricHookHost} from './helpers/fabric-hooks.mjs';
import {screenModule} from './helpers/screen-harness.mjs';

type Provider = 'google' | 'apple';
type Options = {nativeApple?: boolean; mfa?: boolean; completionMFA?: boolean; holdFactor?: boolean; callback?: (id: string) => string; transaction?: Record<string, unknown>; session?: Record<string, unknown>};
const nodes = (node: any): any[] => Array.isArray(node) ? node.flatMap(nodes) : node?.props ? [node, ...nodes(node.props.children)] : [];
const code = 'c'.repeat(43), binding = 'b'.repeat(43);
const unsupported = (name: string) => () => {throw new Error('Unexpected fixture port: ' + name);};
// Unused platform/screen ports fail if called, rather than simulating account work.
const ports = (values: Record<string, unknown>) => new Proxy(values, {get: (target, name: string) => name in target ? target[name]
  : new Proxy({}, {get: (_, member: string) => unsupported(name + '.' + member)})});

/** Source/provider fixture: no real provider login or native OS browser is used.
 * Real AccountEntry -> NativePorticoSignIn -> native HTTP adapter -> shared parsers
 * -> NativeAccounts -> canonical CredentialSessionService. Only native storage,
 * provider/browser UI and HTTP response bytes are controlled at their boundaries. */
async function fixture(context: import('node:test').TestContext, provider: Provider, options: Options = {}) {
  const origin = 'https://accounts-' + provider + (options.nativeApple ? '-native' : '-browser') + '.example.test';
  const id = provider + '-original', stages: string[] = [];
  const expiresAt = new Date(Date.now() + 600000).toISOString();
  const session = {account: {id: 'existing-account', username: 'existing', displayName: 'Existing Account'},
    accessToken: 'fixture-access', refreshToken: 'fixture-refresh', familyId: 'issued-family', expiresAt,
    refreshExpiresAt: new Date(Date.now() + 90 * 86400000).toISOString()};
  const transaction = {transactionId: id, provider, mode: 'login', status: 'verified', expiresAt,
    contactVerified: true, needsUsername: false, mfaRequired: options.mfa === true, ...options.transaction};
  const offered = {password: true, registration: true, recovery: true, verifiedContactRequired: true, accountSecurity: true,
    nativeCompletion: 'code', providers: [{id: provider, enabled: true, native: provider === 'apple', nativeClientIds: ['fixture.bundle']}]};
  const requests: {path: string; method: string; body: any; headers: Headers}[] = [];
  let releaseFactor!: () => void;
  const factorRelease = new Promise<void>(resolve => {releaseFactor = resolve;});
  const bridgeCalls: {browser: string[]; apple: unknown[]} = {browser: [], apple: []};
  const fetcher: typeof fetch = async (input, init) => {
    const url = new URL(String(input)); assert.equal(url.origin, origin);
    const path = url.pathname, method = init?.method ?? 'GET', headers = new Headers(init?.headers);
    const body = init?.body ? JSON.parse(String(init.body)) : undefined;
    requests.push({path, method, body, headers});
    const reply = (value: unknown, status = 200) => new Response(JSON.stringify(value), {status, headers: {'Content-Type': 'application/json'}});
    if (path.startsWith('/v1/identity/')) assert.equal(headers.get('X-Portico-Continuation'), binding);
    if (path === '/v1/identity/options') return reply(offered);
    if (path === '/v1/identity/' + provider + '/start') {
      assert.equal(body.mode, 'login'); assert.equal(body.sessionMode, 'native');
      assert.equal(body.nativeApple, options.nativeApple === true);
      assert.equal(body.completion, options.nativeApple ? undefined : 'code');
      return reply({transactionId: id, mode: 'login', expiresAt, ...(options.nativeApple ? {nativeNonce: 'fixture-nonce'}
        : {authorizationUrl: 'https://' + (provider === 'google' ? 'accounts.google.com' : 'appleid.apple.com') + '/authorize'})});
    }
    if (path === '/v1/identity/transactions/' + id + '/native-apple') {
      assert.equal(method, 'POST'); assert.deepEqual(body, {idToken: 'fixture-apple-assertion', displayName: 'Apple Name'});
      return reply(transaction);
    }
    if (path === '/v1/identity/transactions/' + id) {
      assert.equal(method, 'GET');
      if (headers.get('X-Portico-Completion') !== code) return reply({error: {code: 'completion_required'}}, 403);
      return reply(transaction);
    }
    if (path === '/v1/identity/transactions/' + id + '/complete') {
      assert.equal(method, 'POST');
      assert.equal(body.completionCode, options.nativeApple ? undefined : code);
      if (options.completionMFA) return reply({mfaRequired: true, challengeId: 'original-challenge', challengeToken: 'fixture-challenge', expiresAt});
      if (options.mfa && body.factor !== '123456') return reply({error: {code: 'factor_invalid'}}, 401);
      return reply({...session, ...options.session});
    }
    if (path === '/v1/identity/mfa/complete') {
      assert.deepEqual(body, {challengeId: 'original-challenge', challengeToken: 'fixture-challenge', factor: '123456'});
      if (options.holdFactor) await factorRelease;
      return reply(session);
    }
    if (path === routes.routePath('session_revoke')) {
      assert.deepEqual(body, {refreshToken: session.refreshToken}); return reply({});
    }
    if (path === routes.routePath('servers_list')) {
      assert.equal(headers.get('Authorization'), 'Bearer ' + session.accessToken);
      return reply({items: []});
    }
    throw new Error('Unexpected HTTP: ' + method + ' ' + path);
  };
  let record: CredentialRecord | undefined, savedContinuation: string | null = null;
  const credentials = new CredentialSessionService(new HttpCredentialApi(origin, fetcher), {
    load: async () => record ? structuredClone(record) : undefined,
    save: async value => {record = structuredClone(value);},
  }, async () => 'fixture-request');
  await credentials.synchronize();
  const bridge = {canOpenBrowser: true, canSignInApple: options.nativeApple === true, bundleId: 'fixture.bundle',
    loadContinuation: async () => savedContinuation, newBinding: async () => binding,
    saveContinuation: async (_origin: string, value: string) => {savedContinuation = value;}, newRequestId: async () => 'fixture-request', cancel() {},
    openBrowser: async (url: string, expected: string) => {
      assert.equal(expected, id); bridgeCalls.browser.push(url);
      return options.callback?.(id) ?? origin + '/app/account-return#tx=' + id + '&code=' + code;
    },
    signInApple: async (nonce: unknown) => {assert.equal(nonce, 'fixture-nonce'); bridgeCalls.apple.push(nonce); return {idToken: 'fixture-apple-assertion', displayName: 'Apple Name'};},
  };
  const client = await screenModule(new URL('../src-next/platform/account-client.ts', import.meta.url), {
    react: {default: {}}, '../../../../packages/client-core/src': core, '../../../../packages/client-core/src/hosted-security': security,
    './server-connections': {nativeNetworkFetch: fetcher},
  });
  const accountModule = await screenModule(new URL('../src-next/platform/accounts.ts', import.meta.url), ports({
    react: {default: {}}, 'react-native': {NativeModules: {}}, '../../../../packages/client-core/src': core,
    '../../../../packages/client-core/src/sign-in': signIn, './server-connections': {nativeNetworkFetch: fetcher},
    './credentials': {createCredentials: () => credentials}, './account-client': client, './account-authority': {hostedUrl: origin},
  }));
  const accounts = accountModule.nativeAccounts;
  const auth = await screenModule(new URL('../src-next/platform/portico-sign-in.ts', import.meta.url), {
    react: {default: {}}, 'react-native': {NativeModules: {PorticoAccountAuth: bridge}},
    '../../../../packages/client-core/src/hosted-security': security, '../../../../packages/client-core/src/server-messages': {CodedError},
    '../../../../packages/client-core/src': core, '../../../../packages/contracts/src/hosted/routes': routes,
    './accounts': {nativeAccounts: accounts}, './abort-signals': abortSignals,
    './account-authority': {hostedUrl: origin}, './continuation-queue': continuationQueue,
  });
  const rn = {AppState: {currentState: 'active', addEventListener: () => ({remove() {}})}, BackHandler: {addEventListener: () => ({remove() {}})},
    Platform: {isTV: false, OS: 'ios'}, NativeModules: {PorticoAccountAuth: bridge}, Linking: {openURL: unsupported('Linking')}, View: 'View', Text: 'Text'};
  const {AccountEntry} = await screenModule(new URL('../src-next/screens/accounts/AccountEntry.tsx', import.meta.url), ports({
    react: {...React, default: React}, 'react-native': rn, 'react-native-qrcode-svg': {default: 'QR'},
    '../../../../../packages/client-core/src': core, '../../../../../packages/client-core/src/hosted-security': security,
    '../../../../../packages/client-core/src/presentation/errors': {presentError}, '../../../../../packages/client-core/src/password-strength': passwordPolicy,
    '../../../../../packages/i18n/src': {defaultI18n}, '../../kit/theme': {useTheme: () => createTheme({isTV: false, width: 390})},
    '../../kit/states': {StateLayout: 'Layout'}, '../../kit/controls': {Button: 'Button', TextField: 'Field'},
    '../../platform/tv-menu': {useTVMenuCapture() {}}, '../../platform/account-work': accountWork,
    '../../platform/setup-outcome': setupOutcome, '../../platform/hosted-sign-in-unavailable': hostedUnavailable,
    '../../platform/accounts': {nativeAccounts: accounts}, '../../platform/portico-sign-in': auth,
    '../../platform/account-authority': {hostedUrl: origin}, '../../platform/server-connections': {nativeNetworkFetch: fetcher},
    './PhoneFrontDoor': {PhoneFrontDoor: 'PhoneFrontDoor'}, './PhoneAccountSignIn': {PhoneAccountSignIn: 'PhoneAccountSignIn'},
    './PhoneAccountForm': {PhoneAccountForm: 'Layout'}, './PhoneNoServers': {PhoneNoServers: 'PhoneNoServers'},
    './directory-chooser': directoryChooser,
  }));
  let tree: any;
  const host = createFabricHookHost(() => {tree = AccountEntry({onComplete: unsupported('server completion'), onStageChange: (stage: string) => stages.push(stage)});});
  context.after(async () => {await host.unmount(); accounts.dispose();});
  await act(() => host.mount());
  assert.equal(tree.type, 'PhoneFrontDoor'); await act(() => tree.props.onPortico());
  assert.equal(tree.type, 'PhoneAccountSignIn');
  return {tree: () => tree, stages, requests, bridgeCalls, credentials, session, transaction, releaseFactor,
    record: () => record, continuation: () => JSON.parse(savedContinuation!),
    start: async () => {await act(() => tree.props.onProvider(provider));},
    factor: async (value: string) => {
      const field = nodes(tree.props.beforeActions).find(node => node.type === 'Field'); assert.ok(field);
      await act(() => field.props.onChangeText(value)); await act(() => tree.props.primaryAction.onPress());
    },
  };
}

for (const [provider, nativeApple] of [['google', false], ['apple', false], ['apple', true]] as const) {
  test(`${provider} ${nativeApple ? 'native assertion' : 'browser callback'} existing account automatically adopts the parsed canonical session`, async context => {
    const f = await fixture(context, provider, {nativeApple}); await f.start();
    assert.deepEqual(f.stages, ['welcome', 'portico', 'servers']);
    assert.equal(f.tree().type, 'PhoneNoServers');
    assert.equal(f.credentials.getSnapshot().phase, 'ready');
    assert.deepEqual(f.credentials.getSnapshot().session?.account, f.session.account);
    assert.equal(f.credentials.getSnapshot().session?.familyId, f.session.familyId);
    assert.equal(Object.hasOwn(f.credentials.getSnapshot().session!, 'refreshToken'), false);
    assert.deepEqual(f.record()?.active?.session, f.session);
    assert.equal(f.record()?.active?.authority, f.session.refreshToken);
    assert.equal(f.bridgeCalls.browser.length, nativeApple ? 0 : 1);
    assert.equal(f.bridgeCalls.apple.length, nativeApple ? 1 : 0);
    const completion = f.requests.filter(request => request.path.endsWith('/complete'));
    assert.deepEqual(completion.map(request => request.body), [nativeApple ? {} : {completionCode: code}]);
    const saved = f.continuation(); assert.equal(saved.transactionId, undefined); assert.equal(saved.completionCode, undefined); assert.equal(saved.mfa, undefined);
    assert.equal(JSON.stringify(saved).includes(f.session.accessToken), false);
  });
}

for (const [provider, nativeApple] of [['google', false], ['apple', false], ['apple', true]] as const) {
  test(`${provider} ${nativeApple ? 'native' : 'browser'} existing account requiring MFA cannot auto-complete or adopt before the factor succeeds`, async context => {
    const f = await fixture(context, provider, {mfa: true, nativeApple}); await f.start();
    assert.equal(f.stages.at(-1), 'provider');
    assert.equal(f.record()?.active, undefined); assert.equal(f.credentials.getSnapshot().session, undefined);
    assert.equal(f.requests.some(request => request.path.endsWith('/complete')), false);
    await f.factor('000000'); assert.equal(f.record()?.active, undefined); assert.equal(f.stages.at(-1), 'provider');
    await f.factor('123456'); assert.equal(f.stages.at(-1), 'servers');
    assert.deepEqual(f.record()?.active?.session, f.session);
    assert.deepEqual(f.requests.filter(request => request.path.endsWith('/complete')).map(request => request.body),
      ['000000', '123456'].map(factor => ({...(nativeApple ? {} : {completionCode: code}), factor})));
  });
}

for (const provider of ['google', 'apple'] as const) {
  test(`${provider} custom-scheme callback carries its original completion proof into the canonical session`, async context => {
    const f = await fixture(context, provider, {callback: id => 'portico://account-return?transactionId=' + id + '&code=' + code});
    await f.start(); assert.equal(f.stages.at(-1), 'servers'); assert.deepEqual(f.record()?.active?.session, f.session);
    assert.deepEqual(f.requests.filter(request => request.path.endsWith('/complete')).map(request => request.body), [{completionCode: code}]);
  });
}

test('a completion-time MFA challenge still prevents existing-account adoption until its bound challenge succeeds', async context => {
  const f = await fixture(context, 'google', {completionMFA: true}); await f.start();
  assert.equal(f.record()?.active, undefined); assert.equal(f.credentials.getSnapshot().session, undefined);
  assert.deepEqual(f.continuation().mfa.challengeId, 'original-challenge');
  await act(() => nodes(f.tree().props.beforeActions).find(node => node.type === 'Field').props.onChangeText('123456'));
  const retainedSubmit = f.tree().props.primaryAction.onPress;
  await act(() => retainedSubmit());
  assert.equal(f.stages.at(-1), 'servers'); assert.deepEqual(f.record()?.active?.session, f.session);
  assert.equal(f.continuation().mfa, undefined);
  await act(() => retainedSubmit());
  assert.equal(f.requests.filter(request => request.path === '/v1/identity/mfa/complete').length, 1);
  assert.deepEqual(f.record()?.active?.session, f.session);
});

test('editing the factor draft during a held completion refuses adoption and revokes the late exact family', async context => {
  const f = await fixture(context, 'google', {completionMFA: true, holdFactor: true}); await f.start();
  await f.factor('123456');
  assert.equal(f.requests.filter(request => request.path === '/v1/identity/mfa/complete').length, 1);
  assert.equal(f.record()?.active, undefined);
  await act(() => nodes(f.tree().props.beforeActions).find(node => node.type === 'Field').props.onChangeText('654321'));
  await act(() => f.releaseFactor());
  assert.equal(f.record()?.active, undefined); assert.equal(f.credentials.getSnapshot().session, undefined);
  assert.equal(f.stages.at(-1), 'factor'); assert.equal(f.continuation().mfa.challengeId, 'original-challenge');
  assert.deepEqual(f.requests.filter(request => request.path === routes.routePath('session_revoke')).map(request => request.body),
    [{refreshToken: f.session.refreshToken}]);
});

for (const [name, callback] of [
  ['wrong transaction', () => 'portico://account-return?transactionId=other&code=' + code],
  ['wrong app-link origin', (id: string) => 'https://other.example.test/app/account-return#tx=' + id + '&code=' + code],
  ['malformed proof', (id: string) => 'portico://account-return?transactionId=' + id + '&code=invalid'],
  ['missing proof', (id: string) => 'portico://account-return?transactionId=' + id],
] as const) {
  test(`Google callback with ${name} cannot complete or enter the canonical session`, async context => {
    const f = await fixture(context, 'google', {callback}); await f.start();
    assert.equal(f.record()?.active, undefined); assert.equal(f.credentials.getSnapshot().session, undefined);
    assert.equal(f.stages.at(-1), 'portico');
    assert.equal(f.requests.some(request => request.path.endsWith('/complete')), false);
    if (name === 'missing proof') assert.equal(f.requests.at(-1)?.headers.get('X-Portico-Completion'), null);
    else assert.equal(f.requests.some(request => request.path.includes('/transactions/')), false);
  });
}

test('a parsed transaction for another attempt cannot complete the current native sign-in', async context => {
  const f = await fixture(context, 'google', {transaction: {transactionId: 'other'}}); await f.start();
  assert.equal(f.record()?.active, undefined); assert.equal(f.stages.at(-1), 'portico');
  assert.equal(f.requests.some(request => request.path.endsWith('/complete')), false);
});

test('a native completion without its refresh credential is rejected by the shared parser before session adoption', async context => {
  const f = await fixture(context, 'google', {session: {refreshToken: undefined}}); await f.start();
  assert.equal(f.record()?.active, undefined); assert.equal(f.credentials.getSnapshot().session, undefined);
  assert.equal(f.stages.at(-1), 'portico');
  assert.equal(f.requests.filter(request => request.path.endsWith('/complete')).length, 1);
});
