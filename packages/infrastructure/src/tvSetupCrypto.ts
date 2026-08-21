import 'react-native-get-random-values';
import {x25519} from '@noble/curves/ed25519.js';
import {gcm} from '@noble/ciphers/aes.js';
import {hkdf} from '@noble/hashes/hkdf.js';
import {sha256} from '@noble/hashes/sha2.js';
import {fromByteArray, toByteArray} from 'base64-js';
import {formatTVSetupCode} from './tvSetupCode';

export interface TVSetupIdentity {
  privateKey: Uint8Array;
  publicKey: string;
}

export interface TVSetupEncryptedGrant {
  version: number;
  algorithm: string;
  serverPublicKey: string;
  nonce: string;
  ciphertext: string;
}

export interface TVSetupGrantPayload {
  setupSessionId: string;
  setupCode: string;
  accountAccessToken: string;
  accountAccessExpiresAt: string;
  accountRefreshToken: string;
  accountRefreshExpiresAt: string;
  serverId: string;
  serverUrl: string;
  userId: string;
  username: string;
  email: string;
  role: string;
  authProvider: 'portico-account';
  issuedAt: string;
  grantExpiresAt: string;
}

export function createTVSetupIdentity(): TVSetupIdentity {
  const privateKey = x25519.utils.randomSecretKey();
  return {
    privateKey,
    publicKey: encodeBase64URL(x25519.getPublicKey(privateKey)),
  };
}

export function decryptTVSetupGrant(
  identity: TVSetupIdentity,
  setupSessionId: string,
  encrypted: TVSetupEncryptedGrant,
): TVSetupGrantPayload {
  if (
    encrypted.version !== 1 ||
    encrypted.algorithm !== 'X25519-HKDF-SHA256-AESGCM'
  ) {
    throw new Error(
      'This TV setup grant uses an unsupported encryption protocol.',
    );
  }
  const sharedSecret = x25519.getSharedSecret(
    identity.privateKey,
    decodeBase64URL(encrypted.serverPublicKey),
  );
  const salt = sha256(
    textBytes(`portico-tv-setup-v1\0${setupSessionId.trim()}`),
  );
  const key = hkdf(
    sha256,
    sharedSecret,
    salt,
    textBytes('Portico Nearby TV Setup Grant v1'),
    32,
  );
  const plaintext = gcm(
    key,
    decodeBase64URL(encrypted.nonce),
    textBytes(setupSessionId),
  ).decrypt(decodeBase64URL(encrypted.ciphertext));
  const payload = JSON.parse(decodeText(plaintext)) as TVSetupGrantPayload;
  if (
    payload.setupSessionId !== setupSessionId ||
    (payload.grantExpiresAt && Date.parse(payload.grantExpiresAt) <= Date.now())
  ) {
    throw new Error(
      'The TV setup grant is expired or belongs to another setup session.',
    );
  }
  const setupCode = formatTVSetupCode(payload.setupCode);
  if (!setupCode) {
    throw new Error('The TV setup grant contains an invalid setup code.');
  }
  return {...payload, setupCode};
}

function encodeBase64URL(value: Uint8Array): string {
  return fromByteArray(value)
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/g, '');
}

function decodeBase64URL(value: string): Uint8Array {
  const normalized = value
    .replace(/-/g, '+')
    .replace(/_/g, '/')
    .padEnd(Math.ceil(value.length / 4) * 4, '=');
  return toByteArray(normalized);
}

function textBytes(value: string): Uint8Array {
  return Uint8Array.from(unescape(encodeURIComponent(value)), character =>
    character.charCodeAt(0),
  );
}

function decodeText(value: Uint8Array): string {
  return decodeURIComponent(
    [...value].map(byte => `%${byte.toString(16).padStart(2, '0')}`).join(''),
  );
}
