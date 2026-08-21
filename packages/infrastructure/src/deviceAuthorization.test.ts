import {
  ApiError,
  type HostedDeviceAuthorizationSession,
} from '@portico/client-core';
import {
  authorizeDeviceAccount,
  type DeviceAuthorizationClient,
  type DeviceAuthorizationDisplay,
  type DeviceAuthorizationStorage,
} from './deviceAuthorization';
import type {StoredDeviceAuthorizationSession} from './secureStorage';
import type {HostedAccountSession} from './types';

const baseTime = Date.parse('2026-07-13T12:00:00.000Z');

const session: HostedDeviceAuthorizationSession = {
  authorizationSessionId: 'authorization-1',
  deviceCode: 'device-code-secret',
  userCode: 'ABCD-2345',
  verificationUri: 'https://api.getportico.tv/device',
  expiresIn: 600,
  interval: 5,
  status: 'pending',
  expiresAt: '2026-07-13T12:10:00.000Z',
};

const accountCredentials: HostedAccountSession & {
  device: NonNullable<HostedAccountSession['device']>;
} = {
  tokenType: 'Bearer',
  accessToken: 'ptc_acc_access',
  accessExpiresAt: '2026-07-13T12:15:00.000Z',
  refreshToken: 'ptc_rft_refresh',
  refreshExpiresAt: '2026-08-12T12:00:00.000Z',
  device: {
    id: 'device-1',
    lastSeenAt: '2026-07-13T12:00:00.000Z',
    name: 'Portico Apple TV',
    platform: 'tvOS',
    userId: 'user-1',
  },
  user: {
    createdAt: '2026-01-01T00:00:00.000Z',
    username: 'viewer',
    email: 'viewer@example.com',
    id: 'user-1',
    preferences: {
      audioLanguage: 'en',
      dateFormat: 'system',
      hourCycle: 'system',
      locale: 'en-CA',
      musicPlayback: {
        autoplayDefault: true,
        crossfadeSeconds: 0,
        gapless: true,
        normalizationMode: 'off',
        repeatDefault: 'off',
        shuffleDefault: false,
      },
      playbackProgress: {
        playedThresholdPercent: 90,
        startedThresholdPercent: 5,
      },
      privacy: {
        includeInWatchWithFriends: true,
        pauseWatchHistory: false,
        showActivityToMembers: true,
      },
      sidebarOrder: [],
      subtitleLanguage: 'en',
      timeZone: 'America/Halifax',
    },
  },
};

function createStorage(initial?: StoredDeviceAuthorizationSession) {
  let value = initial;
  const storage: DeviceAuthorizationStorage = {
    load: jest.fn(async () => value),
    save: jest.fn(async next => {
      value = next;
    }),
    clear: jest.fn(async () => {
      value = undefined;
    }),
  };
  return {storage, value: () => value};
}

function clientWithPoll(poll: jest.Mock): DeviceAuthorizationClient {
  return {
    createDeviceAuthorizationSession: jest.fn(async () => session),
    pollDeviceAuthorizationSession: poll,
    redeemDeviceAuthorizationSession: jest.fn(async () => ({
      status: 'redeemed' as const,
      accountCredentials,
    })),
  } as unknown as DeviceAuthorizationClient;
}

test('displays only the canonical user code and redeems once', async () => {
  let now = baseTime;
  const waits: number[] = [];
  const {storage} = createStorage();
  const client = clientWithPoll(
    jest.fn(async () => ({
      authorizationSessionId: session.authorizationSessionId,
      expiresAt: session.expiresAt,
      expiresIn: 595,
      interval: 5,
      status: 'approved',
    })),
  );
  let display: DeviceAuthorizationDisplay | undefined;

  const result = await authorizeDeviceAccount({
    appVersion: '0.1.0',
    client,
    deviceName: 'Portico Apple TV',
    installationId: 'installation-1',
    now: () => now,
    onDisplay: value => {
      display = value;
    },
    platform: 'tvOS',
    persistAccountCredentials: async () => undefined,
    storage,
    wait: async delayMs => {
      waits.push(delayMs);
      now += delayMs;
    },
  });

  expect(display).toEqual({
    userCode: 'ABCD-2345',
    verificationUri: 'https://api.getportico.tv/device',
  });
  expect(display).not.toHaveProperty('deviceCode');
  expect(display).not.toHaveProperty('authorizationSessionId');
  expect(display).not.toHaveProperty('expiresAt');
  expect(client.createDeviceAuthorizationSession).toHaveBeenCalledWith({
    appVersion: '0.1.0',
    deviceName: 'Portico Apple TV',
    installationId: 'installation-1',
    platform: 'tvOS',
  });
  expect(client.pollDeviceAuthorizationSession).toHaveBeenCalledWith(
    'authorization-1',
    'device-code-secret',
  );
  expect(client.redeemDeviceAuthorizationSession).toHaveBeenCalledTimes(1);
  expect(waits).toEqual([5_000]);
  expect(result).toEqual(accountCredentials);
});

test('rejects verification addresses that could expose URL credentials, query data, or fragments', async () => {
  for (const verificationUri of [
    'https://user:password@api.getportico.tv/device',
    'https://api.getportico.tv/device?user_code=ABCD-2345',
    'https://api.getportico.tv/device#ABCD-2345',
  ]) {
    const {storage} = createStorage();
    const client = clientWithPoll(jest.fn());
    (
      client.createDeviceAuthorizationSession as jest.Mock
    ).mockResolvedValueOnce({...session, verificationUri});

    await expect(
      authorizeDeviceAccount({
        client,
        deviceName: 'Portico Apple TV',
        installationId: 'installation-1',
        now: () => baseTime,
        onDisplay: () => undefined,
        platform: 'tvOS',
        persistAccountCredentials: async () => undefined,
        storage,
        wait: async () => undefined,
      }),
    ).rejects.toThrow('invalid device authorization address');
    expect(client.pollDeviceAuthorizationSession).not.toHaveBeenCalled();
  }
});

test('persists slow_down and waits the increased interval before polling again', async () => {
  let now = baseTime;
  const waits: number[] = [];
  const {storage} = createStorage();
  const poll = jest
    .fn()
    .mockRejectedValueOnce(
      new ApiError(429, 'slow_down', 'Polling too quickly.', {interval: 10}),
    )
    .mockResolvedValueOnce({
      authorizationSessionId: session.authorizationSessionId,
      expiresAt: session.expiresAt,
      expiresIn: 585,
      interval: 10,
      status: 'approved',
    });
  const client = clientWithPoll(poll);

  await authorizeDeviceAccount({
    client,
    deviceName: 'Portico Apple TV',
    installationId: 'installation-1',
    now: () => now,
    onDisplay: () => undefined,
    platform: 'tvOS',
    persistAccountCredentials: async () => undefined,
    storage,
    wait: async delayMs => {
      waits.push(delayMs);
      now += delayMs;
    },
  });

  expect(waits).toEqual([5_000, 10_000]);
  expect(storage.save).toHaveBeenCalledWith(
    expect.objectContaining({
      session: expect.objectContaining({interval: 10}),
    }),
  );
  expect(poll).toHaveBeenCalledTimes(2);
  expect(client.redeemDeviceAuthorizationSession).toHaveBeenCalledTimes(1);
});

test('backs off timeout and Retry-After polling failures without creating or redeeming twice', async () => {
  let now = baseTime;
  const waits: number[] = [];
  const {storage} = createStorage();
  const timeout = new Error('The request timed out.');
  timeout.name = 'TimeoutError';
  const poll = jest
    .fn()
    .mockRejectedValueOnce(timeout)
    .mockRejectedValueOnce(
      new ApiError(503, 'service_unavailable', 'Try again later.', undefined, {
        retryAfterMs: 45_000,
      }),
    )
    .mockResolvedValueOnce({
      authorizationSessionId: session.authorizationSessionId,
      expiresAt: session.expiresAt,
      expiresIn: 585,
      interval: 5,
      status: 'approved',
    });
  const client = clientWithPoll(poll);

  await authorizeDeviceAccount({
    client,
    deviceName: 'Portico Apple TV',
    installationId: 'installation-1',
    now: () => now,
    onDisplay: () => undefined,
    platform: 'tvOS',
    persistAccountCredentials: async () => undefined,
    storage,
    wait: async delayMs => {
      waits.push(delayMs);
      now += delayMs;
    },
  });

  expect(waits).toEqual([5_000, 10_000, 45_000]);
  expect(client.createDeviceAuthorizationSession).toHaveBeenCalledTimes(1);
  expect(client.redeemDeviceAuthorizationSession).toHaveBeenCalledTimes(1);
});

test('does not create a replacement or redeem after a terminal denial', async () => {
  let now = baseTime;
  const {storage, value} = createStorage();
  const client = clientWithPoll(
    jest.fn(async () => {
      throw new ApiError(403, 'access_denied', 'Request denied.');
    }),
  );
  const options = {
    client,
    deviceName: 'Portico Apple TV',
    installationId: 'installation-1',
    now: () => now,
    onDisplay: () => undefined,
    platform: 'tvOS',
    persistAccountCredentials: async () => undefined,
    storage,
    wait: async (delayMs: number) => {
      now += delayMs;
    },
  };

  await expect(authorizeDeviceAccount(options)).rejects.toMatchObject({
    code: 'access_denied',
  });
  expect(value()?.terminalCode).toBe('access_denied');
  await expect(authorizeDeviceAccount(options)).rejects.toMatchObject({
    code: 'access_denied',
  });
  expect(client.createDeviceAuthorizationSession).toHaveBeenCalledTimes(1);
  expect(client.pollDeviceAuthorizationSession).toHaveBeenCalledTimes(1);
  expect(client.redeemDeviceAuthorizationSession).not.toHaveBeenCalled();
});

test('replays bounded redemption recovery after persistence cleanup is interrupted', async () => {
  let now = baseTime;
  let persisted: HostedAccountSession | undefined;
  const {storage} = createStorage();
  (storage.clear as jest.Mock).mockRejectedValueOnce(
    new Error('Process interrupted after persistence.'),
  );
  const client = clientWithPoll(
    jest.fn(async () => ({
      authorizationSessionId: session.authorizationSessionId,
      expiresAt: session.expiresAt,
      expiresIn: 595,
      interval: 5,
      status: 'approved',
    })),
  );
  const options = {
    client,
    deviceName: 'Portico Apple TV',
    installationId: 'installation-1',
    now: () => now,
    onDisplay: () => undefined,
    platform: 'tvOS',
    persistAccountCredentials: async (credentials: HostedAccountSession) => {
      persisted = credentials;
    },
    storage,
    wait: async (delayMs: number) => {
      now += delayMs;
    },
  };

  await expect(authorizeDeviceAccount(options)).rejects.toThrow(
    'Process interrupted after persistence.',
  );
  expect(persisted).toEqual(accountCredentials);
  expect(client.redeemDeviceAuthorizationSession).toHaveBeenCalledTimes(1);

  await expect(authorizeDeviceAccount(options)).resolves.toEqual(
    accountCredentials,
  );
  expect(client.pollDeviceAuthorizationSession).toHaveBeenCalledTimes(1);
  expect(client.redeemDeviceAuthorizationSession).toHaveBeenCalledTimes(2);
});

test('recovers the same committed credentials when the redeem response is lost before persistence', async () => {
  let now = baseTime;
  let persisted: HostedAccountSession | undefined;
  const {storage, value} = createStorage();
  const client = clientWithPoll(
    jest.fn(async () => ({
      authorizationSessionId: session.authorizationSessionId,
      expiresAt: session.expiresAt,
      expiresIn: 595,
      interval: 5,
      status: 'approved',
    })),
  );
  (client.redeemDeviceAuthorizationSession as jest.Mock)
    .mockRejectedValueOnce(
      new TypeError('Connection closed after Hosted committed redemption.'),
    )
    .mockResolvedValueOnce({status: 'redeemed', accountCredentials});
  const options = {
    client,
    deviceName: 'Portico Apple TV',
    installationId: 'installation-1',
    now: () => now,
    onDisplay: () => undefined,
    platform: 'tvOS',
    persistAccountCredentials: async (credentials: HostedAccountSession) => {
      persisted = credentials;
    },
    storage,
    wait: async (delayMs: number) => {
      now += delayMs;
    },
  };

  await expect(authorizeDeviceAccount(options)).rejects.toThrow(
    'Connection closed',
  );
  expect(value()).toMatchObject({
    redemptionStarted: true,
    redemptionStartedAt: '2026-07-13T12:00:05.000Z',
  });
  expect(persisted).toBeUndefined();
  await expect(authorizeDeviceAccount(options)).resolves.toEqual(
    accountCredentials,
  );
  expect(client.pollDeviceAuthorizationSession).toHaveBeenCalledTimes(1);
  expect(client.redeemDeviceAuthorizationSession).toHaveBeenCalledTimes(2);
  expect(persisted).toEqual(accountCredentials);
});

test('requires explicit fresh authorization after the five-minute receipt recovery window', async () => {
  const {storage} = createStorage({
    installationId: 'installation-1',
    redemptionStarted: true,
    redemptionStartedAt: '2026-07-13T12:00:00.000Z',
    session,
  });
  const client = clientWithPoll(jest.fn());
  await expect(
    authorizeDeviceAccount({
      client,
      deviceName: 'Portico Apple TV',
      installationId: 'installation-1',
      now: () => baseTime + 5 * 60_000,
      onDisplay: () => undefined,
      platform: 'tvOS',
      persistAccountCredentials: async () => undefined,
      storage,
      wait: async () => undefined,
    }),
  ).rejects.toMatchObject({code: 'authorization_restart_required'});
  expect(client.pollDeviceAuthorizationSession).not.toHaveBeenCalled();
  expect(client.redeemDeviceAuthorizationSession).not.toHaveBeenCalled();
});
