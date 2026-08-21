const mockKeychainState = new Map<
  string,
  {password: string; service: string; storage: string; username: string}
>();
const mockSettingsState = new Map<string, unknown>();
const mockResetGates = new Map<string, Promise<boolean>>();
let mockPlatformOS: 'ios' | 'android' = 'ios';
let mockAndroidCleanupAvailable = true;
let mockAndroidCleanupState: Record<string, unknown> = {
  status: 'available',
  quarantined: false,
};
let mockLedgerWriteInvisible = false;
let mockRetainedService: string | undefined;
let mockUnreadableService: string | undefined;
let mockRejectedWriteService: string | undefined;
let mockSettingsWriteFailure: unknown;

jest.mock('react-native', () => ({
  get Platform() {
    return {OS: mockPlatformOS};
  },
  NativeModules: {
    get PorticoCleanupQuarantine() {
      if (!mockAndroidCleanupAvailable) return undefined;
      return mockAndroidCleanupModule;
    },
  },
  Settings: {
    get: jest.fn((key: string) => mockSettingsState.get(key)),
    set: jest.fn((values: Record<string, unknown>) => {
      if (mockSettingsWriteFailure) throw mockSettingsWriteFailure;
      for (const [key, value] of Object.entries(values)) {
        mockSettingsState.set(key, value);
      }
    }),
  },
}));

const mockAndroidCleanupModule = {
  getState: jest.fn(async () => ({...mockAndroidCleanupState})),
  begin: jest.fn(async (generation: string) => {
    if (
      mockAndroidCleanupState.quarantined === true &&
      mockAndroidCleanupState.generation !== generation
    ) {
      throw new Error('Android cleanup generation is already quarantined.');
    }
    mockAndroidCleanupState = {
      status: 'available',
      quarantined: true,
      generation,
      ...(typeof mockAndroidCleanupState.completedGeneration === 'string'
        ? {completedGeneration: mockAndroidCleanupState.completedGeneration}
        : {}),
    };
    return {...mockAndroidCleanupState};
  }),
  markCompleted: jest.fn(async (generation: string) => {
    if (
      mockAndroidCleanupState.quarantined !== true ||
      mockAndroidCleanupState.generation !== generation
    ) {
      throw new Error('Android cleanup generation is not active.');
    }
    mockAndroidCleanupState = {
      ...mockAndroidCleanupState,
      completedGeneration: generation,
    };
    return {...mockAndroidCleanupState};
  }),
  release: jest.fn(async (generation: string) => {
    if (
      mockAndroidCleanupState.quarantined !== true ||
      mockAndroidCleanupState.generation !== generation ||
      mockAndroidCleanupState.completedGeneration !== generation
    ) {
      throw new Error('Android cleanup generation has not completed.');
    }
    mockAndroidCleanupState = {
      status: 'available',
      quarantined: false,
      completedGeneration: generation,
    };
    return {...mockAndroidCleanupState};
  }),
};

jest.mock('react-native-keychain', () => {
  const api = {
    ACCESSIBLE: {
      AFTER_FIRST_UNLOCK_THIS_DEVICE_ONLY:
        'after-first-unlock-this-device-only',
      WHEN_UNLOCKED_THIS_DEVICE_ONLY: 'when-unlocked-this-device-only',
    },
    getGenericPassword: jest.fn(async ({service}: {service: string}) => {
      if (service === mockUnreadableService) {
        throw new Error(`Keychain read failed for ${service}`);
      }
      return mockKeychainState.get(service) ?? false;
    }),
    resetGenericPassword: jest.fn(async ({service}: {service: string}) => {
      const gate = mockResetGates.get(service);
      if (gate) {
        const permitted = await gate;
        if (!permitted) return false;
        return mockKeychainState.delete(service);
      }
      if (service === mockRetainedService) return false;
      return mockKeychainState.delete(service);
    }),
    setGenericPassword: jest.fn(
      async (
        username: string,
        password: string,
        {service}: {service: string},
      ) => {
        if (service === mockRejectedWriteService) return false;
        if (
          !(
            mockLedgerWriteInvisible &&
            service === 'tv.getportico.credential-cleanup-ledger.v1'
          )
        ) {
          mockKeychainState.set(service, {
            password,
            service,
            storage: 'keychain',
            username,
          });
        }
        return true;
      },
    ),
  };
  return {__esModule: true, ...api, default: api};
});

import {
  beginCredentialCleanup,
  clearAllCredentials,
  credentialCleanupLedger,
  deleteAllCredentialsRetainingCleanupBarrier,
  finishCredentialCleanup,
  hostedCredentialStore,
  hostedRefreshRotationStore,
  retryPendingCredentialCleanup,
  serverCredentialAdapter,
  trustedServerConnectionAdapter,
} from './secureStorage';
import {NativeModules, Settings} from 'react-native';
import * as Keychain from 'react-native-keychain';

function loadFreshSecureStorage(): typeof import('./secureStorage') {
  jest.resetModules();
  return jest.requireActual('./secureStorage');
}

const mockGetGenericPassword =
  Keychain.getGenericPassword as jest.MockedFunction<
    typeof Keychain.getGenericPassword
  >;
const mockResetGenericPassword =
  Keychain.resetGenericPassword as jest.MockedFunction<
    typeof Keychain.resetGenericPassword
  >;

const SERVER_SERVICE = 'tv.getportico.server-session.v1';
const CREDENTIAL_SERVICES = [
  SERVER_SERVICE,
  'tv.getportico.server-refresh-rotation.v1',
  'tv.getportico.account-session.v1',
  'tv.getportico.account-refresh-rotation.v1',
  'tv.getportico.device-authorization.v1',
  'tv.getportico.nearby-tv-setup.v1',
  'tv.getportico.trusted-server-connections.v1',
] as const;

beforeEach(() => {
  jest.clearAllMocks();
  mockKeychainState.clear();
  mockSettingsState.clear();
  mockResetGates.clear();
  mockPlatformOS = 'ios';
  mockAndroidCleanupAvailable = true;
  mockAndroidCleanupState = {status: 'available', quarantined: false};
  mockLedgerWriteInvisible = false;
  mockRetainedService = undefined;
  mockUnreadableService = undefined;
  mockRejectedWriteService = undefined;
  mockSettingsWriteFailure = undefined;
});

afterEach(async () => {
  // Some tests deliberately poison the module-local unknown-cleanup latch.
  // Reconcile the statically imported instance so a later case cannot inherit
  // that process quarantine after jest.resetModules() created a fresh copy.
  mockResetGates.clear();
  mockPlatformOS = 'ios';
  mockAndroidCleanupAvailable = true;
  mockAndroidCleanupState = {status: 'available', quarantined: false};
  mockLedgerWriteInvisible = false;
  mockRetainedService = undefined;
  mockUnreadableService = undefined;
  mockRejectedWriteService = undefined;
  mockSettingsWriteFailure = undefined;
  try {
    await retryPendingCredentialCleanup();
  } catch {
    // The test that owns an intentionally corrupt ledger has already asserted
    // the failure. Shared mock state is cleared by the next beforeEach.
  }
  jest.restoreAllMocks();
});

function seedCredentialServices() {
  for (const service of CREDENTIAL_SERVICES) {
    mockKeychainState.set(service, {
      password: JSON.stringify({accessToken: `${service}-token`}),
      service,
      storage: 'keychain',
      username: 'portico',
    });
  }
}

test('attempts every Keychain deletion and retains additive cleanup barriers when one credential survives', async () => {
  seedCredentialServices();
  mockRetainedService = SERVER_SERVICE;

  await expect(
    clearAllCredentials({
      authority: 'hosted',
      accountId: 'account-a',
      serverId: 'server-a',
    }),
  ).rejects.toThrow('finish secure credential cleanup');
  await expect(
    clearAllCredentials({
      authority: 'hosted',
      accountId: 'account-b',
      serverId: 'server-b',
    }),
  ).rejects.toThrow('finish secure credential cleanup');

  for (const service of CREDENTIAL_SERVICES) {
    expect(mockResetGenericPassword).toHaveBeenCalledWith({service});
  }
  expect(mockKeychainState.has(SERVER_SERVICE)).toBe(true);
  expect(await credentialCleanupLedger.list()).toEqual(
    expect.arrayContaining([
      expect.objectContaining({accountId: 'account-a', serverId: 'server-a'}),
      expect.objectContaining({accountId: 'account-b', serverId: 'server-b'}),
    ]),
  );
});

test('a restarted cleanup sequence cannot overwrite an existing marker ID', async () => {
  const now = 1_750_000_000_000;
  const existingId = `${now.toString(36)}-1-local:server-a`;
  mockKeychainState.set('tv.getportico.credential-cleanup-ledger.v1', {
    password: JSON.stringify({
      schemaVersion: 1,
      entries: {
        [existingId]: {
          authority: 'local',
          serverId: 'server-a',
          id: existingId,
          createdAt: '2026-01-01T00:00:00.000Z',
        },
      },
    }),
    service: 'tv.getportico.credential-cleanup-ledger.v1',
    storage: 'keychain',
    username: 'portico',
  });
  const nowSpy = jest.spyOn(Date, 'now').mockReturnValue(now);
  const freshStorage = loadFreshSecureStorage();

  const created = await freshStorage.beginCredentialCleanup({
    authority: 'local',
    serverId: 'server-a',
  });

  expect(created.id).not.toBe(existingId);
  await expect(freshStorage.credentialCleanupLedger.list()).resolves.toEqual(
    expect.arrayContaining([
      expect.objectContaining({id: existingId}),
      expect.objectContaining({id: created.id}),
    ]),
  );
  nowSpy.mockRestore();
});

test('Android cleanup uses the native durable quarantine for begin, completion, and release', async () => {
  mockPlatformOS = 'android';
  const androidStorage = loadFreshSecureStorage();

  const marker = await androidStorage.beginCredentialCleanup({
    authority: 'hosted',
    accountId: 'android-account',
  });
  const generation = mockAndroidCleanupState.generation;

  expect(typeof generation).toBe('string');
  expect(mockAndroidCleanupModule.begin).toHaveBeenCalledWith(generation);
  expect(Settings.get).not.toHaveBeenCalled();
  expect(Settings.set).not.toHaveBeenCalled();
  await expect(
    androidStorage.credentialCleanupLedger.isQuarantined(),
  ).resolves.toBe(true);

  await androidStorage.finishCredentialCleanup(marker);

  expect(mockAndroidCleanupModule.markCompleted).toHaveBeenCalledWith(
    generation,
  );
  expect(mockAndroidCleanupModule.release).toHaveBeenCalledWith(generation);
  expect(mockAndroidCleanupState).toEqual({
    status: 'available',
    quarantined: false,
    completedGeneration: generation,
  });
  await expect(
    androidStorage.credentialCleanupLedger.isQuarantined(),
  ).resolves.toBe(false);
  expect(
    (NativeModules as {PorticoCleanupQuarantine: unknown})
      .PorticoCleanupQuarantine,
  ).toBe(mockAndroidCleanupModule);
});

test('Android completed quarantine survives a process restart until native release is verified', async () => {
  mockPlatformOS = 'android';
  const androidStorage = loadFreshSecureStorage();
  const marker = await androidStorage.beginCredentialCleanup({
    authority: 'local',
    serverId: 'android-server',
  });
  const generation = mockAndroidCleanupState.generation as string;
  const releaseImplementation =
    mockAndroidCleanupModule.release.getMockImplementation();
  mockAndroidCleanupModule.release.mockRejectedValueOnce(
    new Error('native release interrupted'),
  );

  await expect(androidStorage.finishCredentialCleanup(marker)).rejects.toThrow(
    'Android device-protected cleanup storage is unavailable',
  );
  expect(mockAndroidCleanupState).toEqual({
    status: 'available',
    quarantined: true,
    generation,
    completedGeneration: generation,
  });

  if (!releaseImplementation) throw new Error('missing native release mock');
  mockAndroidCleanupModule.release.mockImplementation(releaseImplementation);
  const restartedStorage = loadFreshSecureStorage();
  await expect(restartedStorage.retryPendingCredentialCleanup()).resolves.toBe(
    false,
  );
  expect(mockAndroidCleanupModule.release).toHaveBeenCalledWith(generation);
  expect(mockAndroidCleanupState.quarantined).toBe(false);
});

test('Android corrupt native cleanup state fails closed without consulting Settings', async () => {
  mockPlatformOS = 'android';
  mockAndroidCleanupState = {
    status: 'available',
    quarantined: true,
  };
  const androidStorage = loadFreshSecureStorage();

  await expect(androidStorage.retryPendingCredentialCleanup()).rejects.toThrow(
    'Android device-protected cleanup storage is corrupt',
  );
  expect(Settings.get).not.toHaveBeenCalled();
  expect(Settings.set).not.toHaveBeenCalled();
});

test('Android missing native cleanup storage fails closed and never falls back to Settings', async () => {
  mockPlatformOS = 'android';
  mockAndroidCleanupAvailable = false;
  const androidStorage = loadFreshSecureStorage();
  mockKeychainState.set(SERVER_SERVICE, {
    password: JSON.stringify({accessToken: 'must-remain-until-barrier'}),
    service: SERVER_SERVICE,
    storage: 'keychain',
    username: 'portico',
  });

  await expect(
    androidStorage.beginCredentialCleanup({authority: 'unknown'}),
  ).rejects.toThrow(
    'Portico could not publish every restart-safe cleanup barrier',
  );
  await expect(androidStorage.retryPendingCredentialCleanup()).rejects.toThrow(
    'Android device-protected cleanup storage is unavailable',
  );
  await expect(androidStorage.clearAllCredentials({authority: 'unknown'})).rejects.toThrow(
    'Portico could not finish secure credential cleanup',
  );
  expect(mockKeychainState.has(SERVER_SERVICE)).toBe(true);
  expect(mockResetGenericPassword).not.toHaveBeenCalled();
  expect(Settings.get).not.toHaveBeenCalled();
  expect(Settings.set).not.toHaveBeenCalled();
});

test('an individual credential adapter rejects reset=false without quarantining an independent account', async () => {
  mockKeychainState.set(SERVER_SERVICE, {
    password: JSON.stringify({accessToken: 'stale-access'}),
    service: SERVER_SERVICE,
    storage: 'keychain',
    username: 'portico',
  });
  mockRetainedService = SERVER_SERVICE;

  await expect(serverCredentialAdapter.clear()).rejects.toThrow(
    `could not finish restart-safe credential cleanup for ${SERVER_SERVICE}`,
  );
  expect(await credentialCleanupLedger.list()).toEqual([]);
  expect(await serverCredentialAdapter.load?.()).toEqual({
    accessToken: 'stale-access',
  });
});

test('a successful single-service clear never publishes a global Settings quarantine', async () => {
  await serverCredentialAdapter.save({
    accessToken: 'old-access',
    apiBaseUrl: 'https://server.test',
    refreshToken: 'old-refresh',
    serverId: 'server-a',
  });

  await serverCredentialAdapter.clear();
  expect(
    mockSettingsState.get('tv.getportico.credential-cleanup-quarantine.v1'),
  ).toBeUndefined();

  const freshStorage = loadFreshSecureStorage();
  await expect(freshStorage.retryPendingCredentialCleanup()).resolves.toBe(
    false,
  );
});

test('successful Hosted sign-in replacement survives a force-close after clearing the old server family', async () => {
  const account = {
    accessExpiresAt: '2999-01-01T00:00:00.000Z',
    accessToken: 'hosted-access',
    refreshExpiresAt: '2999-02-01T00:00:00.000Z',
    refreshToken: 'hosted-refresh',
    tokenType: 'Bearer',
    user: {
      id: 'account-a',
      username: 'viewer',
      email: 'viewer@example.test',
    },
  };
  await serverCredentialAdapter.save({
    accessToken: 'old-server-access',
    apiBaseUrl: 'https://old-server.test',
    refreshToken: 'old-server-refresh',
    serverId: 'old-server',
  });

  // This is the durable ordering used by completeHostedAccount: publish the
  // independently valid Portico Account first, then retire the previous
  // server-local family. A process death after both operations must not turn
  // that routine replacement into a global cleanup on the next launch.
  await hostedCredentialStore.save(account);
  await serverCredentialAdapter.clear();

  const freshStorage = loadFreshSecureStorage();
  await expect(freshStorage.retryPendingCredentialCleanup()).resolves.toBe(
    false,
  );
  await expect(freshStorage.hostedCredentialStore.load()).resolves.toEqual(
    account,
  );
  await expect(
    freshStorage.serverCredentialAdapter.load?.(),
  ).resolves.toBeUndefined();
});

test('a durable completion tombstone preserves a later sign-in when the Settings release misses process death', async () => {
  const marker = await beginCredentialCleanup({
    authority: 'hosted',
    accountId: 'signed-out-account',
  });
  await finishCredentialCleanup(marker);

  const generation = mockSettingsState.get(
    'tv.getportico.credential-cleanup-quarantine-generation.v1',
  );
  expect(typeof generation).toBe('string');

  const nextAccount = {
    accessExpiresAt: '2999-01-01T00:00:00.000Z',
    accessToken: 'next-access',
    refreshExpiresAt: '2999-02-01T00:00:00.000Z',
    refreshToken: 'next-refresh',
    tokenType: 'Bearer',
    user: {id: 'next-account'},
  } as never;
  await hostedCredentialStore.save(nextAccount);

  // Model the native Settings bridge persisting the publication but losing
  // its asynchronous `false` release when the process is force-closed.
  mockSettingsState.set('tv.getportico.credential-cleanup-quarantine.v1', true);
  const freshStorage = loadFreshSecureStorage();

  await expect(freshStorage.retryPendingCredentialCleanup()).resolves.toBe(
    false,
  );
  await expect(freshStorage.hostedCredentialStore.load()).resolves.toEqual(
    nextAccount,
  );
  expect(
    mockSettingsState.get('tv.getportico.credential-cleanup-quarantine.v1'),
  ).toBe(false);
});

test('a different restart generation is never excused by an older completion tombstone', async () => {
  const marker = await beginCredentialCleanup({
    authority: 'hosted',
    accountId: 'old-account',
  });
  await finishCredentialCleanup(marker);
  await hostedCredentialStore.save({
    accessToken: 'must-be-quarantined',
  } as never);

  mockSettingsState.set('tv.getportico.credential-cleanup-quarantine.v1', true);
  mockSettingsState.set(
    'tv.getportico.credential-cleanup-quarantine-generation.v1',
    'new-unfinished-generation',
  );
  const freshStorage = loadFreshSecureStorage();

  await expect(freshStorage.retryPendingCredentialCleanup()).resolves.toBe(
    true,
  );
  await expect(
    freshStorage.hostedCredentialStore.load(),
  ).resolves.toBeUndefined();
});

test('a legacy generation-less Settings quarantine continues to fail closed', async () => {
  await hostedCredentialStore.save({
    accessToken: 'legacy-quarantined-access',
  } as never);
  mockSettingsState.set('tv.getportico.credential-cleanup-quarantine.v1', true);
  const freshStorage = loadFreshSecureStorage();

  await expect(freshStorage.retryPendingCredentialCleanup()).resolves.toBe(
    true,
  );
  await expect(
    freshStorage.hostedCredentialStore.load(),
  ).resolves.toBeUndefined();

  const nextAccount = {accessToken: 'post-migration-access'} as never;
  await freshStorage.hostedCredentialStore.save(nextAccount);
  // Model both writes made through the asynchronous Settings bridge being
  // lost: native storage still exposes only the original v1 boolean.
  mockSettingsState.set('tv.getportico.credential-cleanup-quarantine.v1', true);
  mockSettingsState.delete(
    'tv.getportico.credential-cleanup-quarantine-generation.v1',
  );
  const secondLaunch = loadFreshSecureStorage();

  await expect(secondLaunch.retryPendingCredentialCleanup()).resolves.toBe(
    false,
  );
  await expect(secondLaunch.hostedCredentialStore.load()).resolves.toEqual(
    nextAccount,
  );
});

test('overlapping account cleanup cannot report success until every owner settles', async () => {
  const first = await beginCredentialCleanup({
    authority: 'hosted',
    accountId: 'account-a',
  });
  const second = await beginCredentialCleanup({
    authority: 'hosted',
    accountId: 'account-b',
  });

  await serverCredentialAdapter.clear();
  expect(
    mockSettingsState.get('tv.getportico.credential-cleanup-quarantine.v1'),
  ).toBe(true);

  await expect(finishCredentialCleanup(first)).rejects.toThrow(
    'another cleanup barrier remains unresolved',
  );
  expect(
    mockSettingsState.get('tv.getportico.credential-cleanup-quarantine.v1'),
  ).toBe(true);
  await expect(credentialCleanupLedger.list()).resolves.toEqual([second]);

  await finishCredentialCleanup(second);
  expect(
    mockSettingsState.get('tv.getportico.credential-cleanup-quarantine.v1'),
  ).toBe(false);
});

test.each([
  ['second before first', true],
  ['first before second', false],
])(
  'concurrent scoped clears stay independent when %s completes',
  async (_label, secondFirst) => {
    const hostedService = 'tv.getportico.account-session.v1';
    mockKeychainState.set(SERVER_SERVICE, {
      password: JSON.stringify({accessToken: 'server-access'}),
      service: SERVER_SERVICE,
      storage: 'keychain',
      username: 'portico',
    });
    mockKeychainState.set(hostedService, {
      password: JSON.stringify({accessToken: 'hosted-access'}),
      service: hostedService,
      storage: 'keychain',
      username: 'portico',
    });
    const firstGate = deferredBoolean();
    const secondGate = deferredBoolean();
    mockResetGates.set(SERVER_SERVICE, firstGate.promise);
    mockResetGates.set(hostedService, secondGate.promise);

    const first = serverCredentialAdapter.clear();
    const second = hostedCredentialStore.clear();
    for (let attempt = 0; attempt < 20; attempt += 1) {
      await Promise.resolve();
    }

    const earlier = secondFirst ? secondGate : firstGate;
    const later = secondFirst ? firstGate : secondGate;
    const earlierCleanup = secondFirst ? second : first;
    earlier.resolve(true);
    await earlierCleanup;
    expect(
      mockSettingsState.get('tv.getportico.credential-cleanup-quarantine.v1'),
    ).toBeUndefined();

    later.resolve(true);
    await Promise.all([first, second]);
    expect(
      mockSettingsState.get('tv.getportico.credential-cleanup-quarantine.v1'),
    ).toBeUndefined();
  },
);

test('a failed overlapping clear retains Settings after another service cleanup succeeds', async () => {
  await beginCredentialCleanup({
    authority: 'hosted',
    accountId: 'account-a',
  });
  mockKeychainState.set(SERVER_SERVICE, {
    password: JSON.stringify({accessToken: 'retained'}),
    service: SERVER_SERVICE,
    storage: 'keychain',
    username: 'portico',
  });
  mockRetainedService = SERVER_SERVICE;

  await expect(serverCredentialAdapter.clear()).rejects.toThrow(
    'restart-safe credential cleanup',
  );
  expect(
    mockSettingsState.get('tv.getportico.credential-cleanup-quarantine.v1'),
  ).toBe(true);
});

test('publishes the Keychain marker even when Settings quarantine publication fails', async () => {
  mockSettingsWriteFailure = new Error('Settings unavailable');

  await expect(
    beginCredentialCleanup({authority: 'local', serverId: 'server-a'}),
  ).rejects.toThrow('publish every restart-safe cleanup barrier');
  expect(await credentialCleanupLedger.list()).toEqual([
    expect.objectContaining({authority: 'local', serverId: 'server-a'}),
  ]);

  mockSettingsWriteFailure = undefined;
  const freshStorage = loadFreshSecureStorage();
  await expect(freshStorage.retryPendingCredentialCleanup()).resolves.toBe(
    true,
  );
});

test('a later live cleanup cannot release an unknown one-sided barrier', async () => {
  mockLedgerWriteInvisible = true;
  await expect(
    beginCredentialCleanup({authority: 'local', serverId: 'server-a'}),
  ).rejects.toThrow('publish every restart-safe cleanup barrier');
  expect(
    mockSettingsState.get('tv.getportico.credential-cleanup-quarantine.v1'),
  ).toBe(true);

  mockLedgerWriteInvisible = false;
  const second = await beginCredentialCleanup({
    authority: 'hosted',
    accountId: 'account-b',
  });
  await expect(finishCredentialCleanup(second)).rejects.toThrow(
    'another cleanup barrier remains unresolved',
  );

  expect(await credentialCleanupLedger.list()).toEqual([]);
  await expect(credentialCleanupLedger.isQuarantined()).resolves.toBe(true);
  expect(
    mockSettingsState.get('tv.getportico.credential-cleanup-quarantine.v1'),
  ).toBe(true);

  const freshStorage = loadFreshSecureStorage();
  await expect(freshStorage.retryPendingCredentialCleanup()).resolves.toBe(
    true,
  );
  await expect(
    freshStorage.credentialCleanupLedger.isQuarantined(),
  ).resolves.toBe(false);
});

test('fails closed when Keychain readback cannot verify a reset', async () => {
  mockKeychainState.set(SERVER_SERVICE, {
    password: JSON.stringify({accessToken: 'unverifiable-access'}),
    service: SERVER_SERVICE,
    storage: 'keychain',
    username: 'portico',
  });
  mockRetainedService = SERVER_SERVICE;
  mockUnreadableService = SERVER_SERVICE;

  await expect(serverCredentialAdapter.clear()).rejects.toThrow(
    `could not finish restart-safe credential cleanup for ${SERVER_SERVICE}`,
  );
  expect(mockResetGenericPassword).toHaveBeenCalledWith({
    service: SERVER_SERVICE,
  });
  expect(mockGetGenericPassword).toHaveBeenCalledWith({
    service: SERVER_SERVICE,
  });
});

test('rejects a false Keychain write for Hosted credentials without publishing a durable session', async () => {
  mockRejectedWriteService = 'tv.getportico.account-session.v1';

  await expect(
    hostedCredentialStore.save({
      accessExpiresAt: '2999-01-01T00:00:00.000Z',
      accessToken: 'hosted-access',
      refreshExpiresAt: '2999-02-01T00:00:00.000Z',
      refreshToken: 'hosted-refresh',
      tokenType: 'Bearer',
      user: {id: 'account-a'},
    } as never),
  ).rejects.toThrow('Keychain refused to save');
  await expect(hostedCredentialStore.load()).resolves.toBeUndefined();
});

test('durably journals and clears an in-flight Hosted refresh rotation', async () => {
  const journal = {
    authority: 'hosted' as const,
    createdAt: '2026-07-18T00:00:00.000Z',
    oldRefreshToken: 'old-refresh',
    rotationKey: 'a'.repeat(64),
    version: 'v1' as const,
  };

  await hostedRefreshRotationStore.save(journal);
  await expect(hostedRefreshRotationStore.load()).resolves.toEqual(journal);
  await hostedRefreshRotationStore.clear();
  await expect(hostedRefreshRotationStore.load()).resolves.toBeUndefined();
});

test('server credential persistence exposes a durable pending rotation journal', async () => {
  const pending = {
    version: 'v1' as const,
    oldRefreshToken: 'server-old-refresh',
    rotationKey: 'c'.repeat(64),
    createdAt: '2026-07-18T00:00:00.000Z',
  };

  await serverCredentialAdapter.savePendingRotation?.(pending);
  await expect(
    serverCredentialAdapter.loadPendingRotation?.(),
  ).resolves.toEqual(pending);
  await serverCredentialAdapter.clearPendingRotation?.();
  await expect(
    serverCredentialAdapter.loadPendingRotation?.(),
  ).resolves.toBeUndefined();
});

test('rejects a false Keychain write for a trusted server record', async () => {
  mockRejectedWriteService = 'tv.getportico.trusted-server-connections.v1';

  await expect(
    trustedServerConnectionAdapter.save({
      accountId: 'account-a',
      serverId: 'server-a',
      session: {
        accessToken: 'server-access',
        apiBaseUrl: 'https://server.test',
        refreshToken: 'server-refresh',
      },
    } as never),
  ).rejects.toThrow('Keychain refused to save');
  await expect(
    trustedServerConnectionAdapter.list('account-a'),
  ).resolves.toEqual([]);
});

test('trusted server persistence enforces CAS revisions and durable removal tombstones', async () => {
  const first = {
    schemaVersion: 2,
    accountId: 'account-a',
    serverId: 'server-a',
    profileId: 'profile-a',
    serverName: 'Home',
    serverPublicKeyFingerprint: 'sha256:server-a',
    currentRoute: {
      url: 'https://server.test',
      type: 'public',
      verifiedAt: '2026-08-06T00:00:00.000Z',
    },
    session: {
      accessToken: 'server-access-1',
      apiBaseUrl: 'https://server.test',
      refreshToken: 'server-refresh-1',
    },
    lastSuccessfulConnectionAt: '2026-08-06T00:00:00.000Z',
  } as const;

  await trustedServerConnectionAdapter.save(first);
  const saved = await trustedServerConnectionAdapter.load(
    'account-a',
    'server-a',
  );
  expect(saved?.mutationVersion).toBe(1);

  const second = {
    ...saved!,
    mutationVersion: 2,
    session: {...saved!.session, accessToken: 'server-access-2'},
  };
  await expect(
    trustedServerConnectionAdapter.compareAndSwap(1, second),
  ).resolves.toBe(true);
  await expect(
    trustedServerConnectionAdapter.compareAndSwap(1, {
      ...second,
      mutationVersion: 3,
    }),
  ).resolves.toBe(false);

  await trustedServerConnectionAdapter.removeWithTombstone({
    schemaVersion: 1,
    accountId: 'account-a',
    serverId: 'server-a',
    mutationVersion: 3,
    removedAt: '2026-08-06T00:01:00.000Z',
  });
  await expect(
    trustedServerConnectionAdapter.load('account-a', 'server-a'),
  ).resolves.toBeUndefined();
  await expect(
    trustedServerConnectionAdapter.compareAndSwap(0, second),
  ).rejects.toThrow('Trusted server publication was blocked');
  await expect(
    trustedServerConnectionAdapter.compareAndSwap(0, {
      ...second,
      mutationVersion: 4,
    }),
  ).resolves.toBe(true);
  await expect(
    trustedServerConnectionAdapter.load('account-a', 'server-a'),
  ).resolves.toMatchObject({mutationVersion: 4});
});

test('rejects a false Keychain write during server credential rotation and retains the prior family', async () => {
  await serverCredentialAdapter.save({
    accessToken: 'old-access',
    apiBaseUrl: 'https://server.test',
    refreshToken: 'old-refresh',
    serverId: 'server-a',
  });
  mockRejectedWriteService = SERVER_SERVICE;

  await expect(
    serverCredentialAdapter.save({
      accessToken: 'new-access',
      apiBaseUrl: 'https://server.test',
      refreshToken: 'new-refresh',
      serverId: 'server-a',
    }),
  ).rejects.toThrow('Keychain refused to save');
  await expect(serverCredentialAdapter.load?.()).resolves.toEqual({
    accessToken: 'old-access',
    apiBaseUrl: 'https://server.test',
    refreshToken: 'old-refresh',
    serverId: 'server-a',
  });
});

test('deadline cleanup attempts every credential deletion without removing its restart barrier', async () => {
  const marker = await beginCredentialCleanup({
    authority: 'hosted',
    accountId: 'account-a',
    serverId: 'server-a',
  });
  seedCredentialServices();

  await deleteAllCredentialsRetainingCleanupBarrier();

  for (const service of CREDENTIAL_SERVICES) {
    expect(mockResetGenericPassword).toHaveBeenCalledWith({service});
    expect(mockKeychainState.has(service)).toBe(false);
  }
  expect(await credentialCleanupLedger.list()).toEqual([marker]);
});

test('a live cleanup preserves an older failed barrier until fresh recovery', async () => {
  seedCredentialServices();
  mockRetainedService = SERVER_SERVICE;
  await expect(
    clearAllCredentials({
      authority: 'hosted',
      accountId: 'account-a',
      serverId: 'server-a',
    }),
  ).rejects.toThrow('finish secure credential cleanup');
  expect(await credentialCleanupLedger.list()).toHaveLength(1);

  mockRetainedService = undefined;
  await expect(
    clearAllCredentials({
      authority: 'hosted',
      accountId: 'account-b',
      serverId: 'server-b',
    }),
  ).rejects.toThrow('finish secure credential cleanup');
  expect(await credentialCleanupLedger.list()).toEqual([
    expect.objectContaining({accountId: 'account-a', serverId: 'server-a'}),
  ]);
  await expect(credentialCleanupLedger.isQuarantined()).resolves.toBe(true);

  expect(await retryPendingCredentialCleanup()).toBe(true);
  expect(await credentialCleanupLedger.list()).toEqual([]);
  await expect(credentialCleanupLedger.isQuarantined()).resolves.toBe(false);

  await serverCredentialAdapter.save({
    accessToken: 'new-access',
    apiBaseUrl: 'https://new.test',
    refreshToken: 'new-refresh',
    serverId: 'server-new',
  });
  expect(await retryPendingCredentialCleanup()).toBe(false);
  expect(await serverCredentialAdapter.load?.()).toEqual({
    accessToken: 'new-access',
    apiBaseUrl: 'https://new.test',
    refreshToken: 'new-refresh',
    serverId: 'server-new',
  });
});

test('marker publication failure preserves credentials until a later quarantined retry', async () => {
  seedCredentialServices();
  mockLedgerWriteInvisible = true;
  mockRetainedService = SERVER_SERVICE;

  await expect(
    clearAllCredentials({authority: 'local', serverId: 'local-server'}),
  ).rejects.toThrow('finish secure credential cleanup');

  await expect(credentialCleanupLedger.isQuarantined()).resolves.toBe(true);
  expect(
    mockSettingsState.get('tv.getportico.credential-cleanup-quarantine.v1'),
  ).toBe(true);
  expect(mockResetGenericPassword).not.toHaveBeenCalled();
  await expect(retryPendingCredentialCleanup()).rejects.toThrow(
    'verify deletion of every saved credential',
  );
  for (const service of CREDENTIAL_SERVICES) {
    expect(mockResetGenericPassword).toHaveBeenCalledWith({service});
  }
});

test('an independent Settings quarantine survives a fresh module when the Keychain marker and deletion both fail', async () => {
  seedCredentialServices();
  mockLedgerWriteInvisible = true;
  mockRetainedService = SERVER_SERVICE;

  await expect(
    clearAllCredentials({authority: 'local', serverId: 'local-server'}),
  ).rejects.toThrow('finish secure credential cleanup');
  expect(
    mockSettingsState.get('tv.getportico.credential-cleanup-quarantine.v1'),
  ).toBe(true);

  const freshStorage = loadFreshSecureStorage();
  await expect(
    freshStorage.credentialCleanupLedger.isQuarantined(),
  ).resolves.toBe(true);
  await expect(freshStorage.retryPendingCredentialCleanup()).rejects.toThrow(
    'verify deletion of every saved credential',
  );
  await expect(freshStorage.serverCredentialAdapter.load?.()).resolves.toEqual(
    expect.objectContaining({accessToken: expect.any(String)}),
  );

  mockRetainedService = undefined;
  await expect(freshStorage.retryPendingCredentialCleanup()).resolves.toBe(
    true,
  );
  await expect(
    freshStorage.credentialCleanupLedger.isQuarantined(),
  ).resolves.toBe(false);
});

function deferredBoolean() {
  let resolve!: (value: boolean) => void;
  const promise = new Promise<boolean>(resolvePromise => {
    resolve = resolvePromise;
  });
  return {promise, resolve};
}
