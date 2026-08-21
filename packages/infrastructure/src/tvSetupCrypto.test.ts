import {x25519} from '@noble/curves/ed25519.js';
import {gcm} from '@noble/ciphers/aes.js';
import {hkdf} from '@noble/hashes/hkdf.js';
import {sha256} from '@noble/hashes/sha2.js';
import {fromByteArray} from 'base64-js';
import {decryptTVSetupGrant, type TVSetupGrantPayload} from './tvSetupCrypto';

test('decrypts the Hosted X25519 TV setup grant contract', () => {
  const tvPrivateKey = Uint8Array.from({length: 32}, (_, index) => index + 1);
  const serverPrivateKey = Uint8Array.from(
    {length: 32},
    (_, index) => 101 + index,
  );
  const setupSessionId = 'tvsu_contract_1';
  const sharedSecret = x25519.getSharedSecret(
    serverPrivateKey,
    x25519.getPublicKey(tvPrivateKey),
  );
  const salt = sha256(textBytes(`portico-tv-setup-v1\0${setupSessionId}`));
  const key = hkdf(
    sha256,
    sharedSecret,
    salt,
    textBytes('Portico Nearby TV Setup Grant v1'),
    32,
  );
  const nonce = Uint8Array.from({length: 12}, (_, index) => index + 20);
  const payload: TVSetupGrantPayload = {
    setupSessionId,
    setupCode: 'ABCD-2345',
    accountAccessToken: 'ptc_acc_account-access-token',
    accountAccessExpiresAt: '2099-01-01T00:00:00Z',
    accountRefreshToken: 'ptc_rft_account-refresh-token',
    accountRefreshExpiresAt: '2099-02-01T00:00:00Z',
    serverId: 'server-1',
    serverUrl: 'https://server-1.direct.getportico.tv:32500',
    userId: 'user-1',
    username: 'viewer',
    email: 'viewer@example.test',
    role: 'viewer',
    authProvider: 'portico-account',
    issuedAt: '2026-07-12T00:00:00Z',
    grantExpiresAt: '2099-01-01T00:00:00Z',
  };
  const ciphertext = gcm(key, nonce, textBytes(setupSessionId)).encrypt(
    textBytes(JSON.stringify(payload)),
  );

  expect(
    decryptTVSetupGrant(
      {
        privateKey: tvPrivateKey,
        publicKey: base64URL(x25519.getPublicKey(tvPrivateKey)),
      },
      setupSessionId,
      {
        version: 1,
        algorithm: 'X25519-HKDF-SHA256-AESGCM',
        serverPublicKey: base64URL(x25519.getPublicKey(serverPrivateKey)),
        nonce: base64URL(nonce),
        ciphertext: base64URL(ciphertext),
      },
    ),
  ).toEqual(payload);
});

test('rejects a decrypted grant with a legacy numeric setup code', () => {
  const tvPrivateKey = Uint8Array.from({length: 32}, (_, index) => index + 1);
  const serverPrivateKey = Uint8Array.from(
    {length: 32},
    (_, index) => 101 + index,
  );
  const setupSessionId = 'tvsu_contract_legacy';
  const sharedSecret = x25519.getSharedSecret(
    serverPrivateKey,
    x25519.getPublicKey(tvPrivateKey),
  );
  const salt = sha256(textBytes(`portico-tv-setup-v1\0${setupSessionId}`));
  const key = hkdf(
    sha256,
    sharedSecret,
    salt,
    textBytes('Portico Nearby TV Setup Grant v1'),
    32,
  );
  const nonce = Uint8Array.from({length: 12}, (_, index) => index + 20);
  const payload = {
    setupSessionId,
    setupCode: '123456',
    grantExpiresAt: '2099-01-01T00:00:00Z',
  };
  const ciphertext = gcm(key, nonce, textBytes(setupSessionId)).encrypt(
    textBytes(JSON.stringify(payload)),
  );

  expect(() =>
    decryptTVSetupGrant(
      {
        privateKey: tvPrivateKey,
        publicKey: base64URL(x25519.getPublicKey(tvPrivateKey)),
      },
      setupSessionId,
      {
        version: 1,
        algorithm: 'X25519-HKDF-SHA256-AESGCM',
        serverPublicKey: base64URL(x25519.getPublicKey(serverPrivateKey)),
        nonce: base64URL(nonce),
        ciphertext: base64URL(ciphertext),
      },
    ),
  ).toThrow('invalid setup code');
});

function base64URL(value: Uint8Array): string {
  return fromByteArray(value)
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/g, '');
}

function textBytes(value: string): Uint8Array {
  return Uint8Array.from(unescape(encodeURIComponent(value)), character =>
    character.charCodeAt(0),
  );
}
