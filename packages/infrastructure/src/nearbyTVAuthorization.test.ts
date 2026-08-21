import {x25519} from '@noble/curves/ed25519.js';
import {gcm} from '@noble/ciphers/aes.js';
import {hkdf} from '@noble/hashes/hkdf.js';
import {sha256} from '@noble/hashes/sha2.js';
import {fromByteArray, toByteArray} from 'base64-js';
import {ApiError, type HostedTVSetupSession} from '@portico/client-core';
import {
  authorizeNearbyTV,
  selectedServerFromTVSetupGrant,
  type NearbyTVAuthorizationStorage,
} from './nearbyTVAuthorization';
import type {StoredNearbyTVSetupSession} from './secureStorage';
import type {NearbyTVSetupAdvertisement} from './nearbyDevices';
import type {TVSetupEncryptedGrant, TVSetupGrantPayload} from './tvSetupCrypto';

const future = new Date(Date.now() + 10 * 60_000).toISOString();
const later = new Date(Date.now() + 60 * 60_000).toISOString();

function memoryStorage(initial?: StoredNearbyTVSetupSession): NearbyTVAuthorizationStorage & {
  value(): StoredNearbyTVSetupSession | undefined;
} {
  let stored = initial;
  return {
    clear: jest.fn(async () => {
      stored = undefined;
    }),
    load: jest.fn(async () => stored),
    save: jest.fn(async value => {
      stored = value;
    }),
    value: () => stored,
  };
}

function encryptGrant(
  devicePublicKey: string,
  setupSessionId: string,
  payload: TVSetupGrantPayload,
): TVSetupEncryptedGrant {
  const privateKey = x25519.utils.randomSecretKey();
  const shared = x25519.getSharedSecret(
    privateKey,
    decodeBase64URL(devicePublicKey),
  );
  const salt = sha256(textBytes(`portico-tv-setup-v1\0${setupSessionId}`));
  const key = hkdf(
    sha256,
    shared,
    salt,
    textBytes('Portico Nearby TV Setup Grant v1'),
    32,
  );
  const nonce = new Uint8Array(12).fill(7);
  return {
    algorithm: 'X25519-HKDF-SHA256-AESGCM',
    ciphertext: encodeBase64URL(
      gcm(key, nonce, textBytes(setupSessionId)).encrypt(
        textBytes(JSON.stringify(payload)),
      ),
    ),
    nonce: encodeBase64URL(nonce),
    serverPublicKey: encodeBase64URL(x25519.getPublicKey(privateKey)),
    version: 1,
  };
}

test('advertises only public setup metadata and redeems the encrypted server grant', async () => {
  const storage = memoryStorage();
  let created: HostedTVSetupSession | undefined;
  let encryptedGrant: TVSetupEncryptedGrant | undefined;
  const advertise = jest.fn((_advertisement: NearbyTVSetupAdvertisement) =>
    jest.fn(),
  );
  const persist = jest.fn(async () => undefined);
  const client = {
    createTVSetupSession: jest.fn(async (body: {devicePublicKey: string}) => {
      created = {
        appVersion: '0.1.0',
        authModeHint: 'portico-account',
        code: 'ABCD-2345',
        deviceName: 'Portico Apple TV',
        devicePublicKey: body.devicePublicKey,
        expiresAt: future,
        platform: 'tvOS',
        pollIntervalSeconds: 2,
        pollSecret: 'never-advertise-this-secret',
        protocolVersion: 1 as const,
        service: '_portico-setup._tcp.local.',
        setupSessionId: 'tvsu-test',
        status: 'pending',
      };
      const payload: TVSetupGrantPayload = {
        accountAccessExpiresAt: future,
        accountAccessToken: 'ptc_acc_account-access-token',
        accountRefreshExpiresAt: later,
        accountRefreshToken: 'ptc_rft_account-refresh-token',
        authProvider: 'portico-account',
        email: 'viewer@example.test',
        grantExpiresAt: future,
        issuedAt: new Date().toISOString(),
        role: 'viewer',
        serverId: 'server-1',
        serverUrl: 'https://media.direct.getportico.tv:32500',
        setupCode: 'ABCD-2345',
        setupSessionId: 'tvsu-test',
        userId: 'user-1',
        username: 'viewer',
      };
      encryptedGrant = encryptGrant(body.devicePublicKey, 'tvsu-test', payload);
      return created;
    }),
    redeemTVSetupSession: jest
      .fn()
      .mockRejectedValueOnce(
        new ApiError(503, 'service_unavailable', 'Try again later.'),
      )
      .mockResolvedValue({ok: true}),
    tvSetupSession: jest.fn(async () => ({
      ...created!,
      encryptedGrant,
      pollSecret: undefined,
      status: 'grant_ready',
    })),
  };

  const result = await authorizeNearbyTV({
    advertise,
    appVersion: '0.1.0',
    client,
    deviceName: 'Portico Apple TV',
    installationId: 'installation-tv-setup-0001',
    onDisplay: jest.fn(),
    persistCredentials: persist,
    platform: 'tvOS',
    storage,
    wait: async () => undefined,
  });

  expect(result).toMatchObject({serverId: 'server-1', setupCode: 'ABCD-2345'});
  expect(client.createTVSetupSession).toHaveBeenCalledWith(
    expect.objectContaining({
      installationId: 'installation-tv-setup-0001',
    }),
  );
  expect(advertise).toHaveBeenCalledWith(
    expect.objectContaining({
      code: 'ABCD-2345',
      devicePublicKey: created!.devicePublicKey,
      setupSessionId: 'tvsu-test',
    }),
  );
  const advertised = advertise.mock.calls[0]?.[0];
  expect(advertised).not.toHaveProperty('pollSecret');
  expect(JSON.stringify(advertised)).not.toContain(
    'never-advertise-this-secret',
  );
  expect(client.tvSetupSession).toHaveBeenCalledWith(
    'tvsu-test',
    'never-advertise-this-secret',
  );
  expect(client.redeemTVSetupSession).toHaveBeenCalledWith(
    'tvsu-test',
    'never-advertise-this-secret',
  );
  expect(client.redeemTVSetupSession).toHaveBeenCalledTimes(2);
  expect(persist.mock.invocationCallOrder[0]).toBeLessThan(
    client.redeemTVSetupSession.mock.invocationCallOrder[0]!,
  );
  expect(storage.value()).toBeUndefined();
  expect(advertise.mock.results[0]?.value).toHaveBeenCalledTimes(1);
});

test('maps a Nearby TV grant to selected-server metadata without credentials', () => {
  expect(
    selectedServerFromTVSetupGrant({
      accountAccessExpiresAt: future,
      accountAccessToken: 'ptc_acc_account-access',
      accountRefreshExpiresAt: later,
      accountRefreshToken: 'ptc_rft_account-refresh',
      authProvider: 'portico-account',
      email: 'viewer@example.test',
      grantExpiresAt: future,
      issuedAt: new Date().toISOString(),
      role: 'viewer',
      serverId: 'server-1',
      serverUrl: 'https://server.example/',
      setupCode: 'ABCD-2345',
      setupSessionId: 'setup-1',
      userId: 'user-1',
      username: 'viewer',
    }),
  ).toEqual(
    expect.objectContaining({
      serverId: 'server-1',
      serverUrl: 'https://server.example',
    }),
  );
});

test('reuses a valid saved setup session when optional installation metadata changes', async () => {
  const previousPrivateKey = x25519.utils.randomSecretKey();
  const storage = memoryStorage({
    identityPrivateKey: Array.from(previousPrivateKey),
    installationId: 'installation-tv-setup-old',
    session: {
      appVersion: '0.1.0',
      authModeHint: 'portico-account',
      code: 'ABCD-2345',
      deviceName: 'Portico Apple TV',
      devicePublicKey: encodeBase64URL(x25519.getPublicKey(previousPrivateKey)),
      expiresAt: future,
      platform: 'tvOS',
      pollIntervalSeconds: 2,
      pollSecret: 'old-poll-secret',
      protocolVersion: 1,
      service: '_portico-setup._tcp.local.',
      setupSessionId: 'tvsu-old',
      status: 'pending',
    },
  });
  const client = {
    createTVSetupSession: jest.fn(async (body: {devicePublicKey: string}) => ({
      appVersion: '0.1.0',
      authModeHint: 'portico-account',
      code: 'WXYZ-6789',
      deviceName: 'Portico Apple TV',
      devicePublicKey: body.devicePublicKey,
      expiresAt: future,
      platform: 'tvOS',
      pollIntervalSeconds: 2,
      pollSecret: 'new-poll-secret',
      protocolVersion: 1 as const,
      service: '_portico-setup._tcp.local.',
      setupSessionId: 'tvsu-new',
      status: 'pending',
    })),
    redeemTVSetupSession: jest.fn(async () => ({ok: true})),
    tvSetupSession: jest.fn(),
  };
  const interrupted = new Error('stop after replacement');

  await expect(
    authorizeNearbyTV({
      advertise: jest.fn(() => jest.fn()),
      appVersion: '0.1.0',
      client,
      deviceName: 'Portico Apple TV',
      installationId: 'installation-tv-setup-new',
      onDisplay: jest.fn(),
      persistCredentials: jest.fn(async () => undefined),
      platform: 'tvOS',
      storage,
      wait: async () => {
        throw interrupted;
      },
    }),
  ).rejects.toBe(interrupted);

  expect(storage.clear).not.toHaveBeenCalled();
  expect(client.createTVSetupSession).not.toHaveBeenCalled();
  expect(storage.value()).toEqual(
    expect.objectContaining({
      installationId: 'installation-tv-setup-old',
      session: expect.objectContaining({setupSessionId: 'tvsu-old'}),
    }),
  );
});

test('creates a TV setup session when installation metadata is unavailable', async () => {
  const storage = memoryStorage();
  const client = {
    createTVSetupSession: jest.fn(async (body: {devicePublicKey: string}) => ({
      appVersion: '0.1.0',
      authModeHint: 'portico-account',
      code: 'WXYZ-6789',
      deviceName: 'Portico Apple TV',
      devicePublicKey: body.devicePublicKey,
      expiresAt: future,
      platform: 'tvOS',
      pollIntervalSeconds: 2,
      pollSecret: 'new-poll-secret',
      protocolVersion: 1 as const,
      service: '_portico-setup._tcp.local.',
      setupSessionId: 'tvsu-new',
      status: 'pending',
    })),
    redeemTVSetupSession: jest.fn(async () => ({ok: true})),
    tvSetupSession: jest.fn(),
  };
  const interrupted = new Error('stop after creation');

  await expect(
    authorizeNearbyTV({
      advertise: jest.fn(() => jest.fn()),
      appVersion: '0.1.0',
      client,
      deviceName: 'Portico Apple TV',
      onDisplay: jest.fn(),
      platform: 'tvOS',
      storage,
      wait: async () => {
        throw interrupted;
      },
    }),
  ).rejects.toBe(interrupted);

  expect(client.createTVSetupSession).toHaveBeenCalledWith(
    expect.not.objectContaining({installationId: expect.anything()}),
  );
  expect(storage.value()).not.toHaveProperty('installationId');
});

test('retries transient setup-session creation without requiring viewer input', async () => {
  const storage = memoryStorage();
  const interrupted = new Error('stop after the session is displayed');
  const client = {
    createTVSetupSession: jest
      .fn()
      .mockRejectedValueOnce(
        new ApiError(503, 'service_unavailable', 'Try again later.'),
      )
      .mockImplementation(async (body: {devicePublicKey: string}) => ({
        appVersion: '0.1.0',
        authModeHint: 'portico-account',
        code: 'WXYZ-6789',
        deviceName: 'Portico Apple TV',
        devicePublicKey: body.devicePublicKey,
        expiresAt: future,
        platform: 'tvOS',
        pollIntervalSeconds: 2,
        pollSecret: 'new-poll-secret',
        protocolVersion: 1 as const,
        service: '_portico-setup._tcp.local.',
        setupSessionId: 'tvsu-new',
        status: 'pending',
      })),
    redeemTVSetupSession: jest.fn(async () => ({ok: true})),
    tvSetupSession: jest.fn(),
  };
  const wait = jest
    .fn<Promise<void>, [number, AbortSignal?]>()
    .mockResolvedValueOnce(undefined)
    .mockRejectedValueOnce(interrupted);

  await expect(
    authorizeNearbyTV({
      advertise: jest.fn(() => jest.fn()),
      appVersion: '0.1.0',
      client,
      deviceName: 'Portico Apple TV',
      onDisplay: jest.fn(),
      platform: 'tvOS',
      storage,
      wait,
    }),
  ).rejects.toBe(interrupted);

  expect(client.createTVSetupSession).toHaveBeenCalledTimes(2);
  expect(wait).toHaveBeenNthCalledWith(1, 2_000, undefined);
});

test.each([
  'http://server.example',
  'https://user:password@server.example',
  'https://server.example/api',
  'https://server.example?redirect=https://other.example',
  'https://server.example#fragment',
  'https://server.example:0',
  'https://server.example:65536',
])('rejects unsafe server origins from Nearby TV grants: %s', serverUrl => {
  expect(() =>
    selectedServerFromTVSetupGrant({
      accountAccessExpiresAt: future,
      accountAccessToken: 'ptc_acc_account-access',
      accountRefreshExpiresAt: later,
      accountRefreshToken: 'ptc_rft_account-refresh',
      authProvider: 'portico-account',
      email: 'viewer@example.test',
      grantExpiresAt: future,
      issuedAt: new Date().toISOString(),
      role: 'viewer',
      serverId: 'server-1',
      serverUrl,
      setupCode: 'ABCD-2345',
      setupSessionId: 'setup-1',
      userId: 'user-1',
      username: 'viewer',
    }),
  ).toThrow('secure server address');
});

function encodeBase64URL(value: Uint8Array): string {
  return fromByteArray(value)
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/g, '');
}

function decodeBase64URL(value: string): Uint8Array {
  return toByteArray(
    value
      .replace(/-/g, '+')
      .replace(/_/g, '/')
      .padEnd(Math.ceil(value.length / 4) * 4, '='),
  );
}

function textBytes(value: string): Uint8Array {
  return Uint8Array.from(unescape(encodeURIComponent(value)), character =>
    character.charCodeAt(0),
  );
}
