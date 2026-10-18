/** Drives the real signed proof and certificate decision, including live-relay refusal. */
import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash, generateKeyPairSync, sign, verify} from 'node:crypto';
import {acceptPendingCertificate, certificateOrigin, onCertificateQuestion, parseSavedCertificates, pendingCertificate, resetCertificateQuestions, savedCertificateOrigin, settleCertificate, type CertificatePlatform, type PendingCertificate, type PinnedCertificate} from '../src/bridge/certificate-trust.ts';
import {RouteError, type RouteCrypto} from '../../../packages/client-core/src/route-identity.ts';

const ORIGIN = 'https://media.example:32500';
const CERT = Buffer.alloc(32, 1).toString('base64url'), OTHER_CERT = Buffer.alloc(32, 2).toString('base64url');
const b64url = (bytes: Uint8Array) => Buffer.from(bytes).toString('base64url');
const crypto: RouteCrypto = {
  random: n => new Uint8Array(n),
  sha256: async data => new Uint8Array(createHash('sha256').update(data).digest()),
  verify: async (key, signature, payload) => verify(null, payload, {key: Buffer.concat([Buffer.from('302a300506032b6570032100', 'hex'), key]), format: 'der', type: 'spki'}, signature),
};
function identity() {
  const keys = generateKeyPairSync('ed25519');
  const key = keys.publicKey.export({format: 'der', type: 'spki'}).subarray(-32);
  const serverId = 'srv_' + createHash('sha256').update('portico.server.identity.v1\0').update(key).digest('base64url');
  return {key: b64url(key), serverId, fingerprint: createHash('sha256').update(key).digest('base64url'), privateKey: keys.privateKey};
}
const SERVER = identity(), IMPOSTOR = identity();

function platform(options: {refused?: string; pinned?: PinnedCertificate; server?: ReturnType<typeof identity> | 'broken'; version?: '1' | '2'; binding?: readonly string[] | null}) {
  const pins: Array<{origin: string; pin: PinnedCertificate}> = [];
  const proofs: string[] = [];
  const p: CertificatePlatform = {
    refused: async () => options.refused,
    pinned: async () => options.pinned,
    pin: async (origin, pin) => { pins.push({origin, pin}); },
    proofFetcher: (origin, fingerprint) => (async (input: unknown, init: RequestInit = {}) => {
      proofs.push(fingerprint);
      assert.equal(new Headers(init.headers).get('Accept'), 'application/json; portico-route-proof=2');
      assert.equal(String(input), origin + '/v1/networking/identity-proof');
      const asked = JSON.parse(String(init.body)) as {baseUrl: string; nonce: string};
      const who = options.server ?? SERVER;
      const now = Date.now();
      const doc = who === 'broken' ? {kind: 'something-else'} : {kind: 'portico.route-proof', version: options.version ?? '2', ...(options.binding === null ? {} : {tlsCertificateFingerprints: options.binding ?? [CERT, OTHER_CERT]}), baseUrl: asked.baseUrl, nonce: asked.nonce, serverId: who.serverId, publicKey: who.key, fingerprint: who.fingerprint, issuedAt: new Date(now).toISOString(), expiresAt: new Date(now + 15000).toISOString()};
      const raw = Buffer.from(JSON.stringify(doc));
      const body = JSON.stringify({payload: b64url(raw), signature: b64url(sign(null, raw, (who === 'broken' ? SERVER : who).privateKey))});
      return {ok: true, status: 200, headers: {get: (n: string) => n.toLowerCase() === 'content-type' ? 'application/json' : null}, text: async () => body} as unknown as Response;
    }) as typeof fetch,
  };
  return {p, pins, proofs};
}

test('a listed certificate is pinned once the server signs its binding', async () => {
  resetCertificateQuestions();
  const {p, pins, proofs} = platform({refused: CERT});
  await settleCertificate(ORIGIN, p, crypto);
  assert.deepEqual(proofs, [CERT]);
  assert.deepEqual(pins, [{origin: ORIGIN, pin: {fingerprint: CERT, serverId: SERVER.serverId}}]);
});

test('a new certificate for the same server identity is pinned without a question', async () => {
  resetCertificateQuestions();
  const {p, pins} = platform({refused: OTHER_CERT, pinned: {fingerprint: CERT, serverId: SERVER.serverId}});
  await settleCertificate(ORIGIN, p, crypto);
  assert.equal(pins[0]?.pin.fingerprint, OTHER_CERT);
  assert.equal(pendingCertificate(ORIGIN), undefined);
});

test('a different server identity at a pinned address is a question, and trusting it pins it', async () => {
  resetCertificateQuestions();
  const {p, pins} = platform({refused: OTHER_CERT, pinned: {fingerprint: CERT, serverId: SERVER.serverId}, server: IMPOSTOR});
  await assert.rejects(settleCertificate(ORIGIN, p, crypto), (e: unknown) => e instanceof RouteError && e.code === 'certificate_changed');
  assert.equal(pins.length, 0);
  assert.equal(pendingCertificate(ORIGIN + '/')?.reason, 'changed');
  assert.equal(await acceptPendingCertificate(ORIGIN, p), true);
  assert.deepEqual(pins, [{origin: ORIGIN, pin: {fingerprint: OTHER_CERT, serverId: IMPOSTOR.serverId}}]);
  assert.equal(pendingCertificate(ORIGIN), undefined);
});

test('a server that cannot prove an identity is a question, never a silent pin', async () => {
  resetCertificateQuestions();
  const {p, pins} = platform({refused: CERT, server: 'broken'});
  await assert.rejects(settleCertificate(ORIGIN, p, crypto), (e: unknown) => e instanceof RouteError && e.code === 'certificate_unverified');
  assert.equal(pins.length, 0);
  assert.equal(pendingCertificate(ORIGIN)?.serverId, '');
});

test('nothing refused means nothing to settle', async () => {
  resetCertificateQuestions();
  const {p, pins} = platform({});
  await assert.rejects(settleCertificate(ORIGIN, p, crypto), (e: unknown) => e instanceof RouteError && e.code === 'certificate_untrusted');
  assert.equal(pins.length, 0);
});

test('concurrent failures at one address share one proof', async () => {
  resetCertificateQuestions();
  const {p, proofs} = platform({refused: CERT});
  await Promise.all([settleCertificate(ORIGIN, p, crypto), settleCertificate(ORIGIN, p, crypto), settleCertificate(ORIGIN, p, crypto)]);
  assert.equal(proofs.length, 1);
});

test('a question asked mid-session reaches whoever listens, and saved certificates read back as addresses', async () => {
  resetCertificateQuestions();
  const heard: PendingCertificate[] = [];
  const stop = onCertificateQuestion(q => heard.push(q));
  const {p} = platform({refused: OTHER_CERT, pinned: {fingerprint: CERT, serverId: SERVER.serverId}, server: IMPOSTOR});
  await assert.rejects(settleCertificate(ORIGIN, p, crypto));
  stop();
  assert.equal(heard.length, 1);
  assert.equal(heard[0]!.reason, 'changed');
  assert.equal(heard[0]!.fingerprint, OTHER_CERT);
  const saved = parseSavedCertificates([{address: 'media.example:32500', fingerprint: CERT, serverId: SERVER.serverId}, {address: 'bad', fingerprint: CERT}, {address: 'fd00::1:443', fingerprint: CERT, serverId: ''}]);
  assert.deepEqual(saved.map(c => c.address), ['media.example:32500', 'fd00::1:443']);
  assert.equal(savedCertificateOrigin(saved[0]!.address), ORIGIN);
  assert.equal(savedCertificateOrigin(saved[1]!.address), 'https://[fd00::1]');
});

test('only https request URLs have a certificate origin', () => {
  assert.equal(certificateOrigin('https://Media.Example:32500/v1/system'), 'https://media.example:32500');
  assert.equal(certificateOrigin('http://192.168.1.20:32500/v1/system'), undefined);
  assert.equal(certificateOrigin('not a url'), undefined);
});

for (const previous of [false, true]) {
  for (const mode of ['old server', 'unbound proxy', 'relayed proof'] as const) {
    test(`${mode}, previous pin ${previous}: ask without pinning a valid server proof`, async () => {
      resetCertificateQuestions();
      const {p, pins} = platform({refused: OTHER_CERT, ...(previous ? {pinned: {fingerprint: CERT, serverId: SERVER.serverId}} : {}),
        version: mode === 'old server' ? '1' : '2', binding: mode === 'relayed proof' ? [CERT] : null});
      await assert.rejects(settleCertificate(ORIGIN, p, crypto), (e: unknown) => e instanceof RouteError && e.code === (previous ? 'certificate_changed' : 'certificate_unverified'));
      assert.equal(pins.length, 0);
      assert.deepEqual(pendingCertificate(ORIGIN), {origin: ORIGIN, fingerprint: OTHER_CERT, serverId: SERVER.serverId, reason: previous ? 'changed' : 'unverified'});
      assert.equal(await acceptPendingCertificate(ORIGIN, p), true);
      assert.equal(pins[0]?.pin.fingerprint, OTHER_CERT);
    });
  }
}

test('a previous pin with no server identity cannot authorize a silent replacement', async () => {
  resetCertificateQuestions();
  const {p, pins} = platform({refused: OTHER_CERT, pinned: {fingerprint: CERT, serverId: ''}});
  await assert.rejects(settleCertificate(ORIGIN, p, crypto), (e: unknown) => e instanceof RouteError && e.code === 'certificate_changed');
  assert.equal(pins.length, 0);
});
