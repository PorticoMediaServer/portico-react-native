import test from 'node:test';
import assert from 'node:assert/strict';
import {sdkRequestAllowed, submit} from '../src/bridge/transport.ts';

const base = 'https://server.example';
test('passwords, refresh bodies, bearer headers and URL credentials cannot reach the SDK', async () => {
  let constructed = 0;
  (globalThis as {XMLHttpRequest?: unknown}).XMLHttpRequest = class { constructor() { constructed++; } };
  for (const input of [
    {url: base + '/v1/auth/login', method: 'POST', headers: {}, body: '{"password":"secret"}'},
    {url: base + '/v1/auth/refresh', method: 'POST', headers: {}, body: '{"refreshToken":"secret"}'},
    {url: base + '/v1/me', method: 'GET', headers: {aUtHoRiZaTiOn: 'Bearer secret'}, body: null},
    {url: base + '/v1/media/secret-capability/file', method: 'GET', headers: {}, body: null},
    {url: base + '/v1/me?accessToken=secret', method: 'GET', headers: {}, body: null},
    {url: 'https://u:secret@server.example/v1/me', method: 'GET', headers: {}, body: null},
    {url: base + '/v1/me', method: 'GET', headers: {'X-Profile-Proof': 'secret'}, body: null},
  ]) {
    await assert.rejects(submit({...input, identifier: 'r', domain: 'queue_transport', busy: 'busy', limit: 1024}), (e: unknown) => (e as {code?: string}).code === 'transport_unavailable');
  }
  assert.equal(constructed, 0);
});

test('the public proof exception carries only its canonical origin and a nonce', () => {
  const url = base + '/v1/networking/identity-proof';
  const proof = {baseUrl: base, nonce: 'N'.repeat(43)};
  assert.equal(sdkRequestAllowed(url, 'POST', {'Content-Type': 'application/json'}, JSON.stringify(proof)), true);
  for (const body of [{...proof, password: 'secret'}, {...proof, baseUrl: 'https://other.example'}, {...proof, nonce: 'bad'}, null]) {
    assert.equal(sdkRequestAllowed(url, 'POST', {}, JSON.stringify(body)), false);
  }
  assert.equal(sdkRequestAllowed(base + '/v1/system', 'GET', {Accept: 'application/json'}, null), true);
});
