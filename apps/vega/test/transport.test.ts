import test from 'node:test';
import assert from 'node:assert/strict';
import {submit} from '../src/bridge/transport.ts';
import {onCredentialExposure, rememberCredentials, requestCredentials, verifiedCredentialOrigin} from '../src/bridge/credential-boundary.ts';
import {revokeExposedSessions} from '../src/bridge/exposure-revocation.ts';

class Request {
  static made: Request[] = [];
  readyState = 0; status = 200; responseText = ''; responseURL = ''; responseType = ''; timeout = 0; withCredentials = true;
  url = ''; method = ''; body: string | undefined; aborted = false; headers: Record<string, string> = {};
  onload?: () => void; onerror?: () => void; ontimeout?: () => void; onabort?: () => void; onreadystatechange?: () => void; onprogress?: () => void;
  constructor() { Request.made.push(this); }
  open(method: string, url: string) { this.method = method; this.url = url; }
  setRequestHeader(name: string, value: string) { this.headers[name] = value; }
  getResponseHeader(_name: string) { return null; }
  getAllResponseHeaders() { return 'Content-Type: application/json'; }
  send(body?: string) { this.body = body; }
  abort() { this.aborted = true; this.onabort?.(); }
  respond(status = 200, body = '{}', url = this.url) { this.status = status; this.responseURL = url; this.responseText = body; this.readyState = 2; this.onreadystatechange?.(); this.readyState = 4; this.onload?.(); }
}
(globalThis as {XMLHttpRequest?: unknown}).XMLHttpRequest = Request;
const last = () => Request.made.at(-1)!;
let counter = 0;
const send = (url: string, method = 'GET', headers = {}, body: string | null = null, limit = 1024) => submit({identifier: String(++counter), url, method, headers, body, limit, domain: 'queue_transport', busy: 'busy'});
const code = (e: unknown) => (e as {code?: string}).code;

test('password sign-in, refresh and authenticated control work on exact HTTP and HTTPS origins', async () => {
  for (const origin of ['http://server.test:32500', 'https://server.test']) {
    const login = send(origin + '/v1/auth/login', 'POST', {}, '{"password":"dummy"}');
    assert.equal(last().body, '{"password":"dummy"}');
    assert.equal(last().withCredentials, false);
    assert.equal(last().headers['Cache-Control'], 'no-store');
    last().respond(200, JSON.stringify({accessToken: origin + '-access', refreshToken: origin + '-refresh', sessionFamilyId: origin}));
    await login;
    const refresh = send(origin + '/v1/auth/refresh', 'POST', {}, JSON.stringify({refreshToken: origin + '-refresh'}));
    last().respond(); await refresh;
    const control = send(origin + '/v1/me', 'GET', {Authorization: 'Bearer ' + origin + '-access'});
    last().respond(); assert.equal((await control).status, 200);
  }
});

test('issuer credentials cannot be sent to another origin, scheme or port', async () => {
  rememberCredentials('https://bound.test', {accessToken: 'origin-bound', refreshToken: 'refresh-bound', sessionFamilyId: 'bound'});
  for (const origin of ['https://other.test', 'http://bound.test', 'https://bound.test:444']) {
    const count = Request.made.length;
    await assert.rejects(send(origin + '/v1/me', 'GET', {Authorization: 'Bearer origin-bound'}), e => code(e) === 'credential_origin');
    await assert.rejects(send(origin + '/v1/auth/refresh', 'POST', {}, '{"refreshToken":"refresh-bound"}'));
    assert.equal(Request.made.length, count);
  }
});

test('every visible redirect status discards the response without sending a second app request', async () => {
  for (const status of [301, 302, 303, 307, 308]) {
    const request = send(`https://visible-${status}.test/v1/auth/login`, 'POST', {}, '{"password":"dummy"}');
    const count = Request.made.length;
    last().respond(status);
    await assert.rejects(request, e => code(e) === 'request_redirect');
    assert.equal(Request.made.length, count);
    assert.equal(last().aborted, true);
  }
});

test('cross-origin success or error retires the family and cancels its other requests', async () => {
  for (const status of [200, 401, 500]) {
    const origin = `https://exposed-${status}.test`;
    rememberCredentials(origin, {accessToken: 'access-' + status, refreshToken: 'refresh-' + status, sessionFamilyId: 'family-' + status});
    let exposures = 0;
    const off = onCredentialExposure(event => { if (event.origin === origin) { exposures++; assert.equal(event.sessions.length, 1); } });
    const one = send(origin + '/v1/me', 'GET', {Authorization: 'Bearer access-' + status});
    const two = send(origin + '/v1/items', 'GET', {Authorization: 'Bearer access-' + status});
    const both = Promise.allSettled([one, two]);
    Request.made.at(-2)!.respond(status, '{"accessToken":"attacker"}', 'https://capture.test/v1/me');
    for (const result of await both) { assert.equal(result.status, 'rejected'); if (result.status === 'rejected') assert.equal(code(result.reason), 'credential_exposed'); }
    assert.equal(exposures, 1); off();
    await assert.rejects(send(origin + '/v1/me', 'GET', {Authorization: 'Bearer access-' + status}));
    await assert.rejects(send(origin + '/v1/auth/refresh', 'POST', {}, JSON.stringify({refreshToken: 'refresh-' + status})));
  }
});

test('missing final URL fails closed for a sensitive response', async () => {
  const request = send('https://missing.test/v1/auth/login', 'POST', {}, '{"password":"dummy"}');
  last().respond(200, '{}', '');
  await assert.rejects(request, e => code(e) === 'credential_exposed');
});

test('same-origin path changes fail; 304 validators remain valid and byte limits count UTF-8', async () => {
  const moved = send('https://same.test/v1/me', 'GET', {Authorization: 'Bearer same-token'});
  last().respond(200, '{}', 'https://same.test/v1/other');
  await assert.rejects(moved, e => code(e) === 'request_redirect');
  const cached = send('https://same.test/v1/me'); last().respond(304, ''); assert.equal((await cached).status, 304);
  const large = send('https://same.test/v1/me', 'GET', {}, null, 4); last().respond(200, 'ééé'); await assert.rejects(large);
});

test('revocation uses only the issuer, no cookies, five-second deadline and no redirected success', async () => {
  const revocation = revokeExposedSessions({origin: 'http://issuer.test', sessions: [{accessToken: 'revoke-token', hosted: false}]});
  assert.equal(last().url, 'http://issuer.test/v1/sessions/current'); assert.equal(last().method, 'DELETE');
  assert.equal(last().withCredentials, false); assert.equal(last().timeout, 5000);
  last().respond(204, ''); assert.equal(await revocation, true);
  const redirected = revokeExposedSessions({origin: 'https://issuer.test', sessions: [{accessToken: 'old', refreshToken: 'hosted-refresh', hosted: true}]});
  assert.equal(last().url, 'https://issuer.test/v1/sessions/revoke'); assert.equal(last().body, '{"refreshToken":"hosted-refresh"}');
  last().respond(200, '{}', 'https://capture.test/revoke'); assert.equal(await redirected, false);
});

test('a fresh signed nonce proof may admit the same server at an alternate exact origin', () => {
  for (const origin of ['https://old-route.test', 'http://new-route.test:32500']) {
    requestCredentials(origin + '/v1/networking/identity-proof', {}, JSON.stringify({baseUrl: origin, nonce: 'N'.repeat(43)}));
    verifiedCredentialOrigin({kind: 'portico.route-proof', version: '1', baseUrl: origin, nonce: 'N'.repeat(43), fingerprint: 'same-identity'});
  }
  rememberCredentials('https://old-route.test', {accessToken: 'routed-token'});
  assert.equal(requestCredentials('http://new-route.test:32500/v1/me', {Authorization: 'Bearer routed-token'}, null), true);
  assert.throws(() => requestCredentials('http://unverified-route.test/v1/me', {Authorization: 'Bearer routed-token'}, null));
});

test('an ordinary network failure does not sign the viewer out as an exposure', async () => {
  let exposed = false;
  const off = onCredentialExposure(event => { if (event.origin === 'https://offline.test') exposed = true; });
  const request = send('https://offline.test/v1/me', 'GET', {Authorization: 'Bearer offline-token'});
  last().status = 0; last().readyState = 4; last().onreadystatechange?.(); last().onerror?.();
  await assert.rejects(request, e => code(e) === 'queue_transport');
  assert.equal(exposed, false); off();
});
