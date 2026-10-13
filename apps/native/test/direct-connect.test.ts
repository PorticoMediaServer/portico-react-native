/**
 * Direct connect race (TV-AUTH-01): the first Continue after typing a server
 * address must not pin a stale identity or hand back a stale connection.
 *
 * `connectDirectServer` is the whole inspect → pair → system sequence with the
 * session generation as its fence (the same fence `settleDirect` uses). These
 * tests drive it against a scripted server through the real `probeRoute` and
 * `RouteConnection`, holding responses back so an attempt can be superseded
 * mid-flight the way a keystroke, a repeated Continue, or Back + reconnect
 * supersedes it on the device.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import {connectDirectServer, serverAddress} from '../src/app/direct-connect.ts';
import {ShownError} from '../src/app/errors.ts';
import {RouteError, routeBase64, type RouteCrypto} from '../../../packages/client-core/src/route-identity.ts';
import {RouteConnection} from '../../../packages/client-core/src/route-connection.ts';
import type {ConnectionEnvironment} from '../../../packages/client-core/src/server-connections.ts';

const ORIGIN = 'http://127.0.0.1:19631';

/** Deterministic stand-in for the native crypto: both sides of the probe agree. */
const sha256Sync = (data: Uint8Array): Uint8Array => {
  const out = new Uint8Array(32);
  let h = 0x811c9dc5;
  for (let i = 0; i < data.length; i++) {
    h ^= data[i]!;
    h = Math.imul(h, 0x01000193) >>> 0;
    out[i % 32] = (out[i % 32]! + (h & 0xff)) & 0xff;
  }
  out[0] = (out[0]! + data.length) & 0xff;
  return out;
};
const fakeCrypto: RouteCrypto = {
  random: n => new Uint8Array(n),
  sha256: async data => sha256Sync(data),
  verify: async () => true,
};

const b64url = (bytes: Uint8Array): string =>
  Buffer.from(bytes).toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
const b64urlJSON = (value: unknown): string => b64url(Buffer.from(JSON.stringify(value), 'utf8'));

const PUBKEY = Uint8Array.from({length: 32}, (_, i) => i + 1);
const PUBKEY_B64 = b64url(PUBKEY);
const CONTEXT = Buffer.concat([Buffer.from('portico.server.identity.v1\0', 'utf8'), Buffer.from(PUBKEY)]);
const SERVER_ID = 'srv_' + b64url(sha256Sync(CONTEXT));
const FINGERPRINT = b64url(sha256Sync(PUBKEY));

type Call = {url: string; method: string; body?: string};

function proofDocument(baseUrl: string, nonce: string) {
  const now = Date.now();
  return {
    kind: 'portico.route-proof', version: '1', baseUrl, nonce,
    serverId: SERVER_ID, publicKey: PUBKEY_B64, fingerprint: FINGERPRINT,
    issuedAt: new Date(now).toISOString(), expiresAt: new Date(now + 15000).toISOString(),
  };
}

const jsonHeaders = (type: string | null = 'application/json') => ({get: (name: string) => name.toLowerCase() === 'content-type' ? type : null});

/** The scripted transport only implements what the probe and system paths read. */
const asResponse = (value: {ok: boolean; status: number; headers: {get: (name: string) => string | null}; text: () => Promise<string>; json: () => Promise<unknown>}): Response =>
  value as unknown as Response;

/** Scripted transport: probe and system answers can be held back to force the race. */
function scripted(options: {
  holdProbe?: boolean;
  holdSystem?: boolean;
  probe?: (baseUrl: string, nonce: string) => unknown;
  system?: () => {status: number; body: unknown};
} = {}) {
  const calls: Call[] = [];
  const releases: Array<() => void> = [];
  const fetcher = (async (input: unknown, init: {method?: string; body?: string} = {}) => {
    const url = String(input);
    const method = init.method ?? 'GET';
    calls.push({url, method, body: typeof init.body === 'string' ? init.body : undefined});
    if (url.endsWith('/v1/networking/identity-proof')) {
      const asked = JSON.parse(String(init.body)) as {baseUrl: string; nonce: string};
      const answer = async () => {
        const doc = options.probe ? options.probe(asked.baseUrl, asked.nonce) : proofDocument(asked.baseUrl, asked.nonce);
        const payload = b64urlJSON(doc);
        const envelope = {payload, signature: b64url(new Uint8Array(64))};
        return asResponse({ok: true, status: 200, headers: jsonHeaders(), text: async () => JSON.stringify(envelope), json: async () => envelope});
      };
      if (options.holdProbe) return new Promise(resolve => releases.push(() => resolve(answer())));
      return answer();
    }
    if (url.endsWith('/v1/system')) {
      const answer = async () => {
        const next = options.system ? options.system() : {status: 200, body: {name: 'scripted', setupRequired: false}};
        const body = next.body;
        return asResponse({ok: next.status >= 200 && next.status < 300, status: next.status, headers: jsonHeaders(), text: async () => JSON.stringify(body), json: async () => body});
      };
      if (options.holdSystem) return new Promise(resolve => releases.push(() => resolve(answer())));
      return answer();
    }
    throw new Error('unexpected request ' + method + ' ' + url);
  }) as typeof fetch;
  const env: ConnectionEnvironment = {
    storage: {read: async () => undefined, change: async () => {}},
    fetcher,
    crypto: fakeCrypto,
  };
  return {calls, releases, env};
}

/** Counts RouteConnection disposals without changing disposal itself. */
async function countDisposals(work: (disposed: () => number) => Promise<void>): Promise<number> {
  let count = 0;
  const proto = RouteConnection.prototype as unknown as {dispose: () => void};
  const original = proto.dispose;
  proto.dispose = function (this: unknown) { count++; return original.call(this); };
  try {
    await work(() => count);
    return count;
  } finally {
    proto.dispose = original;
  }
}

test('a typed address is normalized once: inspect, pair probe and system agree', async () => {
  const {calls, env} = scripted();
  const {api, pin} = await connectDirectServer({origin: '  127.0.0.1:19631/ ', env, signal: new AbortController().signal, isCurrent: () => true});
  assert.equal(api.baseUrl, ORIGIN);
  assert.equal(pin.serverId, SERVER_ID);
  assert.equal(serverAddress('  127.0.0.1:19631/ '), ORIGIN);
  assert.ok(calls.length >= 3, `expected inspect + pair probe + system (saw ${calls.length})`);
  for (const call of calls) assert.ok(call.url.startsWith(ORIGIN + '/'), `disagreement: ${call.method} ${call.url}`);
});

test('an unreachable server keeps its reachability message', async () => {
  const {env} = scripted({probe: () => { throw new TypeError('Network request failed'); }});
  await assert.rejects(
    connectDirectServer({origin: ORIGIN, env, signal: new AbortController().signal, isCurrent: () => true}),
    (e: unknown) => e instanceof ShownError && e.message === 'Portico couldn’t reach that server. Check the address and try again.',
  );
});

test('RACE: an inspect that resolves after the address moved on publishes nothing and pairs nothing', async () => {
  const {calls, releases, env} = scripted({holdProbe: true});
  let current = 1;
  let published: unknown;
  let failure: unknown;
  const attempt = connectDirectServer({origin: ORIGIN, env, signal: new AbortController().signal, isCurrent: () => current === 1})
    .then(r => { published = r.pin; }, e => { failure = e; });
  // A keystroke (or a second Continue) supersedes generation 1 while its probe is in flight.
  current = 2;
  releases.splice(0).forEach(run => run());
  await attempt;
  assert.match(String((failure as Error)?.message ?? failure), /The server changed while you were signing in/);
  assert.equal(published, undefined, 'a superseded attempt must not yield a pin to publish');
  assert.ok(calls.every(c => c.url.endsWith('/v1/networking/identity-proof')), 'a superseded inspect must not reach pairing or system');
});

/** Waits until the scripted transport has seen a request the test is about to answer. */
async function waitFor(calls: Call[], suffix: string): Promise<void> {
  for (let i = 0; i < 200 && !calls.some(c => c.url.endsWith(suffix)); i++) await new Promise<void>(done => setTimeout(done, 5));
  assert.ok(calls.some(c => c.url.endsWith(suffix)), `timed out waiting for ${suffix}`);
}

test('RACE: a system answer that arrives after supersede is discarded and its connection disposed', async () => {
  const {calls, releases, env} = scripted({holdSystem: true});
  let current = 1;
  const disposes = await countDisposals(async () => {
    let failure: unknown;
    const attempt = connectDirectServer({origin: ORIGIN, env, signal: new AbortController().signal, isCurrent: () => current === 1})
      .then(() => {}, e => { failure = e; });
    // Let inspect + pair resolve, then supersede before the system answer lands.
    await waitFor(calls, '/v1/system');
    current = 2;
    releases.splice(0).forEach(run => run());
    await attempt;
    assert.match(String((failure as Error)?.message ?? failure), /The server changed while you were signing in/);
  });
  assert.equal(disposes, 1, 'the superseded connection must be disposed, not handed back');
});

test('a failed system check disposes its connection instead of leaking it', async () => {
  const {env} = scripted({system: () => ({status: 500, body: {error: {code: 'internal_error'}}})});
  const disposes = await countDisposals(async () => {
    await assert.rejects(connectDirectServer({origin: ORIGIN, env, signal: new AbortController().signal, isCurrent: () => true}));
  });
  assert.equal(disposes, 1);
});

test('a server that needs setup disposes its connection and says so', async () => {
  const {env} = scripted({system: () => ({status: 200, body: {setupRequired: true}})});
  const disposes = await countDisposals(async () => {
    await assert.rejects(
      connectDirectServer({origin: ORIGIN, env, signal: new AbortController().signal, isCurrent: () => true}),
      /hasn’t finished setup/,
    );
  });
  assert.equal(disposes, 1);
});

test('a non-reachability refusal from the probe is not rewritten', async () => {
  const {env} = scripted({probe: () => { throw new RouteError('identity_mismatch', 'another server'); }});
  await assert.rejects(
    connectDirectServer({origin: ORIGIN, env, signal: new AbortController().signal, isCurrent: () => true}),
    (e: unknown) => e instanceof RouteError && e.code === 'identity_mismatch',
  );
});

test('a bare address gets the scheme and port it most likely needs', () => {
  // Reached directly: plain HTTP on Portico's own port, unless a port was typed.
  assert.equal(serverAddress('192.168.1.20'), 'http://192.168.1.20:32500');
  assert.equal(serverAddress('192.168.1.20:8080'), 'http://192.168.1.20:8080');
  assert.equal(serverAddress('nas'), 'http://nas:32500');
  assert.equal(serverAddress('nas.local'), 'http://nas.local:32500');
  assert.equal(serverAddress('media.lan/'), 'http://media.lan:32500');
  assert.equal(serverAddress('box.home.arpa:9000'), 'http://box.home.arpa:9000');
  assert.equal(serverAddress('localhost'), 'http://localhost:32500');
  assert.equal(serverAddress('[fd00::1]'), 'http://[fd00::1]:32500');
  assert.equal(serverAddress('[fd00::1]:8443'), 'http://[fd00::1]:8443');
  // A number has no certificate, wherever it is.
  assert.equal(serverAddress('203.0.113.9'), 'http://203.0.113.9:32500');
  assert.equal(serverAddress('[2001:db8::1]'), 'http://[2001:db8::1]:32500');
  // A published name: HTTPS, as typed.
  assert.equal(serverAddress('portico.example.com'), 'https://portico.example.com');
  assert.equal(serverAddress('portico.example.com:8443'), 'https://portico.example.com:8443');
  assert.equal(serverAddress('box.tail1234.ts.net'), 'https://box.tail1234.ts.net');
});

test('an address typed with its scheme is used as typed', () => {
  assert.equal(serverAddress('http://192.168.1.20'), 'http://192.168.1.20');
  assert.equal(serverAddress('https://192.168.1.20:8443/'), 'https://192.168.1.20:8443');
  assert.equal(serverAddress('HTTP://nas.local'), 'HTTP://nas.local');
  assert.equal(serverAddress('http://portico.example.com'), 'http://portico.example.com');
});
