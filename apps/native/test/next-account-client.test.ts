import test from 'node:test';
import assert from 'node:assert/strict';
import {NativeModules} from './react-native-stub.mjs';
import {createNativeAccountClient} from '../src-next/platform/account-client.ts';

const origin = 'https://web.getportico.tv', binding = 'b'.repeat(43);
type Wire = {url: string; method: string; headers: Record<string, string>; body: string | null};

test('next account client is lazy and carries credentials only through native transport', async t => {
  const original = globalThis.fetch;
  globalThis.fetch = async () => {throw new Error('Account credentials reached raw fetch');};
  t.after(() => {globalThis.fetch = original;});
  const sent: Wire[] = [];
  NativeModules.PorticoRuntime.networkRequest = async (_id: string, url: string, method: string, headers: Record<string, string>, body: string | null) => {
    sent.push({url, method, headers, body});
    return {status: 200, headers: {}, body: '{"result":true}'};
  };
  const client = createNativeAccountClient(origin, binding);
  assert.equal(sent.length, 0);
  assert.deepEqual(await client.request('/v1/sessions', 'POST', {password: 'synthetic password'}), {result: true});
  await client.request('/v1/identity/transactions/transaction', 'GET', undefined, undefined, 'synthetic_access', 'c'.repeat(43));
  assert.equal(sent[0].url, origin + '/v1/sessions');
  assert.equal(sent[0].headers['x-portico-continuation'], binding);
  assert.equal(sent[0].headers['content-type'], 'application/json');
  assert.equal(sent[0].body, '{"password":"synthetic password"}');
  assert.equal(sent[1].headers.authorization, 'Bearer synthetic_access');
  assert.equal(sent[1].headers['x-portico-completion'], 'c'.repeat(43));
  assert.equal(sent[1].body, null);
});

test('next account client preserves redirect refusal and exact service errors', async () => {
  const client = createNativeAccountClient(origin, binding);
  let requests = 0;
  NativeModules.PorticoRuntime.networkRequest = async () => {
    requests++;
    throw Object.assign(new Error('Queue control redirects are not allowed.'), {code: 'queue_transport'});
  };
  await assert.rejects(client.login('person', 'synthetic_password', 'request'), (error: {code?: string}) => error.code === 'queue_transport');
  assert.equal(requests, 1);
  NativeModules.PorticoRuntime.networkRequest = async () => ({status: 401, headers: {}, body: '{"error":{"code":"invalid_credentials","retryable":false}}'});
  await assert.rejects(client.login('person', 'synthetic_password', 'request'), (error: {status?: number; code?: string; retryable?: boolean}) => error.status === 401 && error.code === 'invalid_credentials' && error.retryable === false);
});

test('next account client cancels native requests and fences late successful replies', async () => {
  const client = createNativeAccountClient(origin, binding), cancelled: string[] = [];
  let finish!: (value: unknown) => void;
  NativeModules.PorticoRuntime.playbackRequestId = () => 'held-account';
  NativeModules.PorticoRuntime.cancelQueueRequest = (id: string) => cancelled.push(id);
  NativeModules.PorticoRuntime.networkRequest = () => new Promise(resolve => {finish = resolve;});
  const controller = new AbortController();
  const pending = client.request('/v1/sessions', 'POST', {}, controller.signal);
  controller.abort(); finish({status: 200, headers: {}, body: '{}'});
  await assert.rejects(pending);
  assert.deepEqual(cancelled, ['held-account']);
  let sent = false;
  NativeModules.PorticoRuntime.networkRequest = async () => {sent = true; return {};};
  await assert.rejects(client.request('/v1/sessions', 'POST', {}, controller.signal));
  assert.equal(sent, false);
});

test('next account client refuses malformed and oversized responses', async () => {
  const client = createNativeAccountClient(origin, binding);
  for (const body of ['unreadable', ' '.repeat(262145)]) {
    NativeModules.PorticoRuntime.networkRequest = async () => ({status: 200, headers: {}, body});
    await assert.rejects(client.request('/v1/identity/options'), (error: {code?: string}) => error.code === 'invalid_response');
  }
});
