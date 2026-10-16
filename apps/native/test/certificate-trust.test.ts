/**
 * The owner's own certificate: pinned without a question the first time an address is seen and
 * whenever the same server identity proves itself over a new certificate; a question when the
 * identity changed or could not be proved. Drives the real `probeRoute` over a scripted proof.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import {acceptPendingCertificate, certificateOrigin, onCertificateQuestion, parseSavedCertificates, pendingCertificate, resetCertificateQuestions, savedCertificateOrigin, settleCertificate, type CertificatePlatform, type PendingCertificate, type PinnedCertificate} from '../src/bridge/certificate-trust.ts';
import {RouteError, type RouteCrypto} from '../../../packages/client-core/src/route-identity.ts';

const ORIGIN = 'https://media.example:32500';
const CERT = 'A'.repeat(43), OTHER_CERT = 'B'.repeat(43);
const b64url = (bytes: Uint8Array) => Buffer.from(bytes).toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
const sha = (data: Uint8Array) => { const out = new Uint8Array(32); let h = 0x811c9dc5; for (let i = 0; i < data.length; i++) { h ^= data[i]!; h = Math.imul(h, 0x01000193) >>> 0; out[i % 32] = (out[i % 32]! + (h & 0xff)) & 0xff; } out[0] = (out[0]! + data.length) & 0xff; return out; };
const crypto: RouteCrypto = {random: n => new Uint8Array(n), sha256: async d => sha(d), verify: async () => true};
function identity(seed: number) {
  const key = Uint8Array.from({length: 32}, (_, i) => i + seed);
  const serverId = 'srv_' + b64url(sha(new Uint8Array([...Buffer.from('portico.server.identity.v1\0'), ...key])));
  return {key: b64url(key), serverId, fingerprint: b64url(sha(key))};
}
const SERVER = identity(1), IMPOSTOR = identity(7);

function platform(options: {refused?: string; pinned?: PinnedCertificate; server?: ReturnType<typeof identity> | 'broken'}) {
  const pins: Array<{origin: string; pin: PinnedCertificate}> = [];
  const proofs: string[] = [];
  const p: CertificatePlatform = {
    refused: async () => options.refused,
    pinned: async () => options.pinned,
    pin: async (origin, pin) => { pins.push({origin, pin}); },
    proofFetcher: (origin, fingerprint) => (async (input: unknown, init: {body?: string} = {}) => {
      proofs.push(fingerprint);
      assert.equal(String(input), origin + '/v1/networking/identity-proof');
      const asked = JSON.parse(String(init.body)) as {baseUrl: string; nonce: string};
      const who = options.server ?? SERVER;
      const now = Date.now();
      const doc = who === 'broken' ? {kind: 'something-else'} : {kind: 'portico.route-proof', version: '1', baseUrl: asked.baseUrl, nonce: asked.nonce, serverId: who.serverId, publicKey: who.key, fingerprint: who.fingerprint, issuedAt: new Date(now).toISOString(), expiresAt: new Date(now + 15000).toISOString()};
      const body = JSON.stringify({payload: b64url(Buffer.from(JSON.stringify(doc))), signature: b64url(new Uint8Array(64))});
      return {ok: true, status: 200, headers: {get: (n: string) => n.toLowerCase() === 'content-type' ? 'application/json' : null}, text: async () => body} as unknown as Response;
    }) as typeof fetch,
  };
  return {p, pins, proofs};
}

test('the first certificate at an address is pinned once the server proves itself over it', async () => {
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
