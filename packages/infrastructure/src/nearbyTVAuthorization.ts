import {ApiError, type HostedTVSetupSession} from '@portico/client-core';
import {
  advertiseNearbyTVSetup,
  PORTICO_SETUP_PROTOCOL_VERSION,
  PORTICO_SETUP_SERVICE_TYPE,
} from './nearbyDevices';
import {hostedCredentialStore} from './secureStorage';
import type {StoredNearbyTVSetupSession} from './secureStorage';
import {
  createTVSetupIdentity,
  decryptTVSetupGrant,
  type TVSetupGrantPayload,
  type TVSetupIdentity,
} from './tvSetupCrypto';
import {formatTVSetupCode} from './tvSetupCode';
import type {HostedAccountSession} from './types';

const MINIMUM_POLL_INTERVAL_MS = 2_000;
const MAXIMUM_POLL_BACKOFF_MS = 30_000;
const MINIMUM_REQUEST_RETRY_MS = 2_000;
const MAXIMUM_REQUEST_RETRY_MS = 30_000;

export interface NearbyTVAuthorizationClient {
  createTVSetupSession(body: {
    appVersion: string;
    authModeHint: string;
    deviceName: string;
    devicePublicKey: string;
    installationId?: string;
    platform: string;
  }): Promise<HostedTVSetupSession>;
  tvSetupSession(
    setupSessionId: string,
    pollSecret: string,
  ): Promise<HostedTVSetupSession>;
  redeemTVSetupSession(
    setupSessionId: string,
    pollSecret: string,
  ): Promise<{ok: boolean}>;
}

export interface NearbyTVAuthorizationStorage {
  load(): Promise<StoredNearbyTVSetupSession | undefined>;
  save(session: StoredNearbyTVSetupSession): Promise<void>;
  clear(): Promise<void>;
}

export interface NearbyTVSetupDisplay {
  code: string;
  expiresAt: string;
}

interface AuthorizeNearbyTVOptions {
  advertise?: typeof advertiseNearbyTVSetup;
  appVersion: string;
  client: NearbyTVAuthorizationClient;
  deviceName: string;
  installationId?: string;
  onDisplay(display: NearbyTVSetupDisplay): void;
  persistCredentials?: (payload: TVSetupGrantPayload) => Promise<void>;
  platform: string;
  replaceSession?: boolean;
  signal?: AbortSignal;
  storage: NearbyTVAuthorizationStorage;
  wait?: (delayMs: number, signal?: AbortSignal) => Promise<void>;
}

/**
 * Runs the generic Nearby TV Setup exchange. Bonjour only advertises public,
 * short-lived session metadata; Hosted Services validates the signed-in phone
 * and encrypts server credentials to this TV's ephemeral X25519 key.
 */
export async function authorizeNearbyTV(
  options: AuthorizeNearbyTVOptions,
): Promise<TVSetupGrantPayload> {
  const advertise = options.advertise ?? advertiseNearbyTVSetup;
  const wait = options.wait ?? waitForNearbyTVSetup;
  let stored = await loadOrCreateSession(options, wait);
  const identity = restoreIdentity(stored);
  const session = validateSession(stored.session, identity, Date.now());
  options.onDisplay({code: session.code, expiresAt: session.expiresAt});
  const stopAdvertising = advertise({
    appVersion: session.appVersion ?? options.appVersion,
    code: session.code,
    deviceName: session.deviceName,
    devicePublicKey: session.devicePublicKey,
    expiresAt: session.expiresAt,
    platform: session.platform,
    protocolVersion: PORTICO_SETUP_PROTOCOL_VERSION,
    setupSessionId: session.setupSessionId,
  });

  try {
    const granted = await pollForGrant(
      options.client,
      session,
      wait,
      options.signal,
    );
    throwIfAborted(options.signal);
    const payload = validateGrantPayload(
      decryptTVSetupGrant(
        identity,
        session.setupSessionId,
        granted.encryptedGrant!,
      ),
      session,
    );
    stored = {...stored, redemptionStarted: true};
    await options.storage.save(stored);
    await (options.persistCredentials ?? persistNearbyTVCredentials)(payload);
    throwIfAborted(options.signal);
    const redeemed = await retryTransientRequest(
      () =>
        options.client.redeemTVSetupSession(
          session.setupSessionId,
          session.pollSecret,
        ),
      wait,
      options.signal,
    );
    if (!redeemed?.ok)
      throw new Error('Hosted Services did not confirm TV setup redemption.');
    await options.storage.clear();
    return payload;
  } finally {
    stopAdvertising();
  }
}

export function hostedAccountSessionFromTVSetupGrant(
  payload: TVSetupGrantPayload,
): HostedAccountSession {
  const accessExpiresAt = Date.parse(payload.accountAccessExpiresAt);
  const refreshExpiresAt = Date.parse(payload.accountRefreshExpiresAt);
  if (
    !payload.userId.trim() ||
    !payload.username.trim() ||
    !payload.email.trim() ||
    !payload.accountAccessToken.trim() ||
    !payload.accountRefreshToken.trim() ||
    !payload.accountAccessToken.startsWith('ptc_acc_') ||
    !payload.accountRefreshToken.startsWith('ptc_rft_') ||
    !Number.isFinite(accessExpiresAt) ||
    !Number.isFinite(refreshExpiresAt) ||
    accessExpiresAt <= Date.now() ||
    refreshExpiresAt <= accessExpiresAt
  ) {
    throw new Error(
      'The Nearby TV setup grant did not contain complete Portico Account credentials.',
    );
  }
  return {
    accessToken: payload.accountAccessToken,
    accessExpiresAt: new Date(accessExpiresAt).toISOString(),
    refreshToken: payload.accountRefreshToken,
    refreshExpiresAt: new Date(refreshExpiresAt).toISOString(),
    tokenType: 'Bearer',
    user: {
      id: payload.userId,
      username: payload.username,
      email: payload.email,
    },
  };
}

/**
 * Commits only the durable Hosted account family. The encrypted grant does not
 * carry a server credential: profile selection must happen on this TV before
 * Hosted Services can issue an installation- and server-bound envelope.
 */
export async function persistNearbyTVCredentials(
  payload: TVSetupGrantPayload,
): Promise<void> {
  const accountSession = hostedAccountSessionFromTVSetupGrant(payload);
  selectedServerFromTVSetupGrant(payload);
  await hostedCredentialStore.save(accountSession);
}

export function selectedServerFromTVSetupGrant(payload: TVSetupGrantPayload): {
  serverId: string;
  serverUrl: string;
} {
  if (!payload.serverId.trim()) {
    throw new Error(
      'The Nearby TV setup grant did not identify a selected server.',
    );
  }
  return {
    serverId: payload.serverId,
    serverUrl: normalizedHostedServerURL(payload.serverUrl),
  };
}

async function loadOrCreateSession(
  options: AuthorizeNearbyTVOptions,
  wait: (delayMs: number, signal?: AbortSignal) => Promise<void>,
): Promise<StoredNearbyTVSetupSession> {
  const existing = await options.storage.load();
  if (
    !options.replaceSession &&
    existing &&
    reusableSession(existing)
  )
    return existing;
  if (existing) await options.storage.clear();
  throwIfAborted(options.signal);
  const identity = createTVSetupIdentity();
  const created = await retryTransientRequest(
    () =>
      options.client.createTVSetupSession({
        appVersion: options.appVersion,
        authModeHint: 'portico-account',
        deviceName: options.deviceName,
        devicePublicKey: identity.publicKey,
        ...(options.installationId
          ? {installationId: options.installationId}
          : {}),
        platform: options.platform,
      }),
    wait,
    options.signal,
  );
  if (!created.pollSecret)
    throw new Error(
      'Hosted Services did not return a TV setup polling secret.',
    );
  const stored: StoredNearbyTVSetupSession = {
    identityPrivateKey: Array.from(identity.privateKey),
    ...(options.installationId
      ? {installationId: options.installationId}
      : {}),
    session: {...created, pollSecret: created.pollSecret},
  };
  validateSession(stored.session, identity, Date.now());
  await options.storage.save(stored);
  return stored;
}

function reusableSession(
  stored: StoredNearbyTVSetupSession,
): boolean {
  if (
    stored.redemptionStarted ||
    !Array.isArray(stored.identityPrivateKey) ||
    stored.identityPrivateKey.length !== 32
  )
    return false;
  try {
    validateSession(stored.session, restoreIdentity(stored), Date.now());
    return true;
  } catch {
    return false;
  }
}

function restoreIdentity(stored: StoredNearbyTVSetupSession): TVSetupIdentity {
  const privateKey = Uint8Array.from(stored.identityPrivateKey);
  if (
    privateKey.length !== 32 ||
    privateKey.some(
      value => !Number.isInteger(value) || value < 0 || value > 255,
    )
  ) {
    throw new Error('The saved TV setup identity is invalid.');
  }
  return {privateKey, publicKey: stored.session.devicePublicKey};
}

function validateSession(
  session: HostedTVSetupSession & {pollSecret: string},
  identity: TVSetupIdentity,
  now: number,
): HostedTVSetupSession & {pollSecret: string} {
  const code = formatTVSetupCode(session.code);
  const expiry = Date.parse(session.expiresAt);
  const service = session.service
    .toLowerCase()
    .replace(/\.local\.?$/, '')
    .replace(/\.$/, '');
  if (
    !session.setupSessionId.trim() ||
    !session.pollSecret.trim() ||
    !code ||
    code !== session.code ||
    session.protocolVersion !== PORTICO_SETUP_PROTOCOL_VERSION ||
    service !== PORTICO_SETUP_SERVICE_TYPE ||
    session.devicePublicKey !== identity.publicKey ||
    session.status !== 'pending' ||
    !Number.isFinite(expiry) ||
    expiry <= now
  ) {
    throw new Error(
      'Hosted Services returned an invalid Nearby TV setup session.',
    );
  }
  return session;
}

async function pollForGrant(
  client: NearbyTVAuthorizationClient,
  initial: HostedTVSetupSession & {pollSecret: string},
  wait: (delayMs: number, signal?: AbortSignal) => Promise<void>,
  signal?: AbortSignal,
): Promise<HostedTVSetupSession & {pollSecret: string}> {
  let delayMs = normalizedPollInterval(initial.pollIntervalSeconds);
  let failures = 0;
  while (true) {
    const remaining = Date.parse(initial.expiresAt) - Date.now();
    if (remaining <= 0) throw new Error('This TV setup code has expired.');
    await wait(Math.min(delayMs, remaining), signal);
    throwIfAborted(signal);
    try {
      const polled = await client.tvSetupSession(
        initial.setupSessionId,
        initial.pollSecret,
      );
      assertSameSession(initial, polled);
      if (polled.status === 'grant_ready' && polled.encryptedGrant) {
        return {...polled, pollSecret: initial.pollSecret};
      }
      if (polled.status !== 'pending')
        throw new Error('This TV setup session is no longer available.');
      failures = 0;
      delayMs = normalizedPollInterval(polled.pollIntervalSeconds);
    } catch (cause) {
      if (!isTransientFailure(cause)) throw cause;
      failures += 1;
      const retryAfter =
        cause instanceof ApiError ? (cause.retryAfterMs ?? 0) : 0;
      delayMs = Math.max(
        normalizedPollInterval(initial.pollIntervalSeconds),
        retryAfter,
        Math.min(
          MAXIMUM_POLL_BACKOFF_MS,
          MINIMUM_POLL_INTERVAL_MS * Math.pow(2, Math.min(failures, 4)),
        ),
      );
    }
  }
}

function assertSameSession(
  initial: HostedTVSetupSession,
  polled: HostedTVSetupSession,
): void {
  if (
    polled.setupSessionId !== initial.setupSessionId ||
    polled.devicePublicKey !== initial.devicePublicKey ||
    formatTVSetupCode(polled.code) !== initial.code ||
    polled.protocolVersion !== initial.protocolVersion
  ) {
    throw new Error(
      'Hosted Services returned a mismatched Nearby TV setup session.',
    );
  }
}

function validateGrantPayload(
  payload: TVSetupGrantPayload,
  session: HostedTVSetupSession,
): TVSetupGrantPayload {
  if (
    payload.setupSessionId !== session.setupSessionId ||
    payload.setupCode !== session.code ||
    payload.authProvider !== 'portico-account' ||
    Date.parse(payload.grantExpiresAt) <= Date.now()
  ) {
    throw new Error('The Nearby TV setup grant did not match this TV.');
  }
  hostedAccountSessionFromTVSetupGrant(payload);
  selectedServerFromTVSetupGrant(payload);
  return payload;
}

function normalizedHostedServerURL(value: string): string {
  const trimmed = value.trim().replace(/\/+$/, '');
  // Hosted grants carry a server API origin, never a navigable URL. Restrict
  // the accepted shape so credentials cannot be redirected to userinfo,
  // paths, queries, fragments, or a downgraded scheme.
  const origin =
    /^https:\/\/(\[[0-9a-f:.]+\]|[a-z0-9](?:[a-z0-9.-]*[a-z0-9])?)(?::([0-9]{1,5}))?$/i.exec(
      trimmed,
    );
  const port = origin?.[2] ? Number(origin[2]) : undefined;
  if (!origin || (port !== undefined && (port < 1 || port > 65_535))) {
    throw new Error(
      'The Nearby TV setup grant did not contain a secure server address.',
    );
  }
  return trimmed;
}

function normalizedPollInterval(value: number): number {
  return Math.max(
    MINIMUM_POLL_INTERVAL_MS,
    Number.isFinite(value)
      ? Math.ceil(value * 1_000)
      : MINIMUM_POLL_INTERVAL_MS,
  );
}

function isTransientFailure(value: unknown): boolean {
  if (value instanceof ApiError)
    return value.status === 408 || value.status === 429 || value.status >= 500;
  return (
    value instanceof TypeError ||
    (value instanceof Error &&
      (value.name === 'TimeoutError' || value.name === 'AbortError'))
  );
}

async function retryTransientRequest<T>(
  request: () => Promise<T>,
  wait: (delayMs: number, signal?: AbortSignal) => Promise<void>,
  signal?: AbortSignal,
): Promise<T> {
  let failures = 0;
  while (true) {
    throwIfAborted(signal);
    try {
      return await request();
    } catch (cause) {
      throwIfAborted(signal);
      if (!isTransientFailure(cause)) throw cause;
      failures += 1;
      const retryAfter =
        cause instanceof ApiError ? (cause.retryAfterMs ?? 0) : 0;
      const exponential = Math.min(
        MAXIMUM_REQUEST_RETRY_MS,
        MINIMUM_REQUEST_RETRY_MS * Math.pow(2, Math.min(failures - 1, 4)),
      );
      await wait(
        Math.max(MINIMUM_REQUEST_RETRY_MS, retryAfter, exponential),
        signal,
      );
    }
  }
}

function throwIfAborted(signal?: AbortSignal): void {
  if (!signal?.aborted) return;
  const error = new Error('Nearby TV setup was cancelled.');
  error.name = 'AbortError';
  throw error;
}

function waitForNearbyTVSetup(
  delayMs: number,
  signal?: AbortSignal,
): Promise<void> {
  return new Promise((resolve, reject) => {
    const onAbort = () => {
      clearTimeout(timer);
      const error = new Error('Nearby TV setup was cancelled.');
      error.name = 'AbortError';
      reject(error);
    };
    const timer = setTimeout(() => {
      signal?.removeEventListener('abort', onAbort);
      resolve();
    }, delayMs);
    if (signal?.aborted) onAbort();
    else signal?.addEventListener('abort', onAbort, {once: true});
  });
}
