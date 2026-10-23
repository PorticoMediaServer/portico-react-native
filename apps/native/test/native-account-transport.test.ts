/** NS-03: Portico Account sign-in uses the native transport, which refuses redirects, never RN `fetch`. */
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {NativeModules} from './react-native-stub.mjs';
import {NativeAccountOwner, nativeAccountTransport} from '../src/bridge/native-account.ts';

const origin = 'https://web.getportico.tv', binding = 'b'.repeat(43), elsewhere = 'https://collector.test/v1/sessions';
const runtime = NativeModules.PorticoRuntime as Record<string, any>;
// Header names arrive lower-cased, as the native transport receives them (`Headers`).
type Wire = {url: string; method: string; headers: Record<string, string>; body: string | null};
type Answer = {status: number; headers?: Record<string, string>; body?: string; location?: string};

/**
 * The native transport's contract (PorticoTransport.kt `read`, PorticoPlayer.m
 * `willPerformHTTPRedirection`): a redirect is refused with `queue_transport` and nothing more is
 * sent; in particular the request is never repeated at the redirect's address.
 */
function nativeServer(answer: (wire: Wire) => Answer) {
  const sent: Wire[] = [], cancelled: string[] = [];
  let next = 0;
  runtime.playbackRequestId = () => 'request-' + ++next;
  runtime.cancelQueueRequest = (id: string) => { cancelled.push(id); };
  runtime.networkRequest = async (_id: string, url: string, method: string, headers: Record<string, string>, body: string | null) => {
    const wire = {url, method, headers, body};
    sent.push(wire);
    const reply = answer(wire);
    if (reply.status >= 300 && reply.status < 400 && reply.location) throw Object.assign(new Error('Queue control redirects are not allowed.'), {code: 'queue_transport'});
    return {status: reply.status, headers: reply.headers ?? {}, body: reply.body ?? ''};
  };
  return {sent, cancelled};
}

/** React Native's fetch is the redirect-following path this replaces: it must never be reached. */
function forbidFetch(t: {after: (fn: () => void) => void}) {
  const original = globalThis.fetch;
  const calls: string[] = [];
  globalThis.fetch = (async (input: unknown) => { calls.push(String(input)); throw new Error('RN fetch must not carry account requests.'); }) as typeof fetch;
  t.after(() => { globalThis.fetch = original; });
  return calls;
}

const owner = () => new NativeAccountOwner(origin, {version: 1, binding, expiresAt: new Date(Date.now() + 86400000).toISOString()});

test('a password sign-in redirected elsewhere is refused: the password goes once, to the account service only', async t => {
  const fetched = forbidFetch(t);
  const {sent} = nativeServer(wire => wire.url === origin + '/v1/sessions' ? {status: 307, location: elsewhere} : {status: 200, body: '{}'});
  await assert.rejects(owner().api.login('person', 'secret password', 'request-id'), (e: {code?: string}) => e.code === 'queue_transport');
  assert.deepEqual(fetched, []);
  assert.equal(sent.length, 1);
  assert.equal(sent[0]!.url, origin + '/v1/sessions');
  assert.equal(sent[0]!.method, 'POST');
  assert.match(sent[0]!.body ?? '', /secret password/);
  assert.equal(sent.some(wire => !wire.url.startsWith(origin + '/')), false, 'nothing is sent to the redirect address');
});

test('second-factor and provider completion take the same native path', async t => {
  const fetched = forbidFetch(t);
  const {sent} = nativeServer(() => ({status: 308, location: elsewhere}));
  const api = owner().api;
  await assert.rejects(api.mfa({mfaRequired: true, challengeId: 'challenge', challengeToken: 'challenge-token', expiresAt: '2030-01-01T00:00:00Z'}, '123456'), (e: {code?: string}) => e.code === 'queue_transport');
  await assert.rejects(api.transaction('transaction', undefined, 'c'.repeat(43)), (e: {code?: string}) => e.code === 'queue_transport');
  assert.deepEqual(fetched, []);
  assert.deepEqual(sent.map(wire => wire.url), [origin + '/v1/identity/mfa/complete', origin + '/v1/identity/transactions/transaction']);
  assert.equal(sent[1]!.headers['x-portico-completion'], 'c'.repeat(43));
});

test('a replaced continuation keeps the native transport', async t => {
  const fetched = forbidFetch(t);
  const {sent} = nativeServer(() => ({status: 307, location: elsewhere}));
  const fresh = 'f'.repeat(43);
  const auth = {newBinding: async () => fresh, loadContinuation: async () => null, saveContinuation: async () => {}};
  (NativeModules as Record<string, unknown>).PorticoAccountAuth = auth;
  t.after(() => { delete (NativeModules as Record<string, unknown>).PorticoAccountAuth; });
  const account = owner();
  await account.reset();
  await assert.rejects(account.api.login('person', 'secret', 'request-id'), (e: {code?: string}) => e.code === 'queue_transport');
  assert.deepEqual(fetched, []);
  assert.equal(sent[0]!.headers['x-portico-continuation'], fresh);
});

test('the native account transport keeps the shared transport\'s headers, results and errors', async t => {
  forbidFetch(t);
  const {sent} = nativeServer(wire => wire.url.endsWith('/v1/identity/options') ? {status: 200, body: '{"ok":true}'} : {status: 401, body: '{"error":{"code":"invalid_credentials","message":"No.","retryable":false}}'});
  const transport = nativeAccountTransport(origin, binding);
  assert.deepEqual(await transport('/v1/identity/options', 'GET', undefined), {ok: true});
  assert.equal(sent[0]!.body, null, 'a read carries no body');
  assert.equal(sent[0]!.headers['x-portico-continuation'], binding);
  assert.equal(sent[0]!.headers['content-type'], 'application/json');
  assert.equal(sent[0]!.headers.authorization, undefined);
  await assert.rejects(transport('/v1/account/security', 'POST', {a: 1}, undefined, 'access-token'), (e: {status?: number; code?: string; retryable?: boolean}) => e.status === 401 && e.code === 'invalid_credentials' && e.retryable === false);
  assert.equal(sent[1]!.headers.authorization, 'Bearer access-token');
  assert.equal(sent[1]!.body, '{"a":1}');
});

test('abandoning an account request cancels the native request', async t => {
  forbidFetch(t);
  const cancelled: string[] = [];
  let refuse!: (error: unknown) => void;
  runtime.playbackRequestId = () => 'held';
  runtime.cancelQueueRequest = (id: string) => { cancelled.push(id); refuse(Object.assign(new Error('Queue request cancelled.'), {code: 'cancelled'})); };
  runtime.networkRequest = () => new Promise((_, reject) => { refuse = reject; });
  const controller = new AbortController();
  const pending = nativeAccountTransport(origin, binding)('/v1/sessions', 'POST', {}, controller.signal);
  controller.abort();
  await assert.rejects(pending, (e: {code?: string}) => e.code === 'cancelled');
  assert.deepEqual(cancelled, ['held']);
});

test('native account sources never fall back to the shared fetch transport', () => {
  const source = readFileSync(new URL('../src/bridge/native-account.ts', import.meta.url), 'utf8');
  assert.doesNotMatch(source, /new HostedAccountClient\([^)]*'native',\s*undefined/);
  assert.equal(source.match(/new HostedAccountClient\(/g)?.length, source.match(/'native',nativeAccountTransport\(/g)?.length);
});

test('the native transports under account requests refuse redirects', () => {
  const android = readFileSync(new URL('../android/app/src/main/java/tv/getportico/portico/native/PorticoTransport.kt', import.meta.url), 'utf8');
  assert.match(android, /\.followRedirects\(false\)/);
  assert.match(android, /\.followSslRedirects\(false\)/);
  assert.match(android, /response\.code in intArrayOf\(301, 302, 303, 307, 308\)[^\n]*\n\s*finish\(entry, "Queue control redirects are not allowed\."/);
  const entry = readFileSync(new URL('../Native/PorticoPlayer.m', import.meta.url), 'utf8');
  assert.match(entry, /#import "PorticoQueueTransport\.h"/);
  const apple = readFileSync(new URL('../Native/PorticoQueueTransport.h', import.meta.url), 'utf8');
  assert.match(apple, /willPerformHTTPRedirection:[^\n]*\n completionHandler\(nil\);\[\[self requestFor:task\] finish:@"Queue control redirects are not allowed\."\];/);
});
