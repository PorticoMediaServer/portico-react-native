import {
  ApiError,
  type HostedDeviceAuthorizationRedeemResponse,
  type HostedDeviceAuthorizationSession,
  type HostedDeviceAuthorizationSessionRequest,
  type HostedDeviceAuthorizationStatus,
} from '@porticomediaserver/client-core';
import {formatTVSetupCode} from './tvSetupCode';
import type {HostedAccountSession} from './types';
import type {StoredDeviceAuthorizationSession} from './secureStorage';

export const DEVICE_AUTHORIZATION_MINIMUM_INTERVAL_MS = 5_000;
export const DEVICE_AUTHORIZATION_MAXIMUM_BACKOFF_MS = 60_000;
export const DEVICE_AUTHORIZATION_REDEMPTION_RECOVERY_MS = 5 * 60_000;

export interface DeviceAuthorizationDisplay {
	userCode: string;
	verificationUri: string;
}

export interface DeviceAuthorizationClient {
  createDeviceAuthorizationSession(body: HostedDeviceAuthorizationSessionRequest): Promise<HostedDeviceAuthorizationSession>;
  pollDeviceAuthorizationSession(authorizationSessionId: string, deviceCode: string): Promise<HostedDeviceAuthorizationStatus>;
  redeemDeviceAuthorizationSession(authorizationSessionId: string, deviceCode: string): Promise<HostedDeviceAuthorizationRedeemResponse>;
}

export interface DeviceAuthorizationStorage {
  load(): Promise<StoredDeviceAuthorizationSession | undefined>;
  save(session: StoredDeviceAuthorizationSession): Promise<void>;
  clear(): Promise<void>;
}

interface AuthorizeDeviceOptions {
  appVersion?: string;
  client: DeviceAuthorizationClient;
  deviceName: string;
  installationId: string;
  onDisplay(session: DeviceAuthorizationDisplay): void;
  platform: string;
  /** Must durably store the complete account credential family before resolving. */
  persistAccountCredentials(accountCredentials: HostedAccountSession): Promise<void>;
  replaceTerminalSession?: boolean;
  signal?: AbortSignal;
  storage: DeviceAuthorizationStorage;
  now?: () => number;
  wait?: (delayMs: number, signal?: AbortSignal) => Promise<void>;
}

export async function authorizeDeviceAccount(options: AuthorizeDeviceOptions): Promise<HostedAccountSession> {
  const now = options.now ?? Date.now;
  const wait = options.wait ?? waitForDeviceAuthorization;
  let stored = await loadOrCreateSession(options, now);
  throwIfAborted(options.signal);
	options.onDisplay(publicDisplay(stored.session));

	try {
		if (!stored.redemptionStarted) {
			await pollUntilApproved({
				client: options.client,
				now,
				onIntervalChanged: async interval => {
					if (stored.session.interval === interval) return;
					stored = {...stored, session: {...stored.session, interval}};
					await options.storage.save(stored);
				},
				session: stored.session,
				signal: options.signal,
				wait,
			});
			throwIfAborted(options.signal);
			stored = {...stored, redemptionStarted: true, redemptionStartedAt: new Date(now()).toISOString()};
			await options.storage.save(stored);
			throwIfAborted(options.signal);
		}
		const redeemed = await options.client.redeemDeviceAuthorizationSession(
			stored.session.authorizationSessionId,
			stored.session.deviceCode,
    );
    const accountCredentials = validAccountCredentials(redeemed, now());
    await options.persistAccountCredentials(accountCredentials);
    await options.storage.clear();
    return accountCredentials;
  } catch (cause) {
    if (cause instanceof ApiError && (cause.code === 'access_denied' || cause.code === 'expired_token')) {
      await options.storage.save({...stored, terminalCode: cause.code});
    }
    throw cause;
  }
}

async function loadOrCreateSession(
  options: AuthorizeDeviceOptions,
  now: () => number,
): Promise<StoredDeviceAuthorizationSession> {
	const existing = await options.storage.load();
	if (existing?.installationId === options.installationId) {
		if (existing.redemptionStarted && !options.replaceTerminalSession) {
			if (redemptionRecoveryIsOpen(existing, now())) return existing;
			throw redemptionRestartError();
		}
		const expired = Date.parse(existing.session.expiresAt) <= now();
		const terminalCode = existing.terminalCode ?? (expired ? 'expired_token' : undefined);
		if (terminalCode && !options.replaceTerminalSession) throw terminalError(terminalCode);
    if (!terminalCode && !existing.redemptionStarted) {
      assertValidSession(existing.session, now());
      return existing;
    }
  }

  if (existing) await options.storage.clear();
  throwIfAborted(options.signal);
  const session = await options.client.createDeviceAuthorizationSession({
    appVersion: options.appVersion,
    deviceName: options.deviceName,
    installationId: options.installationId,
    platform: options.platform,
  });
  throwIfAborted(options.signal);
  assertValidSession(session, now());
  const stored = {installationId: options.installationId, session};
  await options.storage.save(stored);
  return stored;
}

function redemptionRecoveryIsOpen(stored: StoredDeviceAuthorizationSession, now: number): boolean {
	const startedAt = Date.parse(stored.redemptionStartedAt ?? '');
	return Number.isFinite(startedAt) && now < startedAt + DEVICE_AUTHORIZATION_REDEMPTION_RECOVERY_MS;
}

async function pollUntilApproved({
  client,
  now,
  onIntervalChanged,
  session,
  signal,
  wait,
}: {
  client: DeviceAuthorizationClient;
  now: () => number;
  onIntervalChanged: (intervalSeconds: number) => Promise<void>;
  session: HostedDeviceAuthorizationSession;
  signal?: AbortSignal;
  wait: (delayMs: number, signal?: AbortSignal) => Promise<void>;
}): Promise<HostedDeviceAuthorizationStatus> {
  const expiresAt = Date.parse(session.expiresAt);
  let intervalMs = normalizedIntervalMs(session.interval);
  let nextDelayMs = intervalMs;
  let transientFailures = 0;

  while (true) {
    throwIfAborted(signal);
    const remainingMs = expiresAt - now();
    if (remainingMs <= 0) throw terminalError('expired_token');
    await wait(Math.min(nextDelayMs, remainingMs), signal);
    throwIfAborted(signal);
    if (expiresAt <= now()) throw terminalError('expired_token');

    try {
      const status = await client.pollDeviceAuthorizationSession(session.authorizationSessionId, session.deviceCode);
      if (status.status !== 'approved' || status.authorizationSessionId !== session.authorizationSessionId) {
        throw new Error('Hosted Services returned an invalid device authorization status.');
      }
      transientFailures = 0;
      intervalMs = Math.max(intervalMs, normalizedIntervalMs(status.interval));
      return status;
    } catch (cause) {
      if (cause instanceof ApiError && cause.code === 'authorization_pending') {
        const nextIntervalMs = Math.max(intervalMs, intervalFromDetails(cause));
        if (nextIntervalMs !== intervalMs) await onIntervalChanged(nextIntervalMs / 1_000);
        intervalMs = nextIntervalMs;
        transientFailures = 0;
        nextDelayMs = intervalMs;
        continue;
      }
      if (cause instanceof ApiError && cause.code === 'slow_down') {
        const nextIntervalMs = Math.max(intervalMs + 5_000, intervalFromDetails(cause));
        await onIntervalChanged(nextIntervalMs / 1_000);
        intervalMs = nextIntervalMs;
        transientFailures = 0;
        nextDelayMs = intervalMs;
        continue;
      }
      if (isTerminalDeviceAuthorizationError(cause)) throw cause;
      if (!isTransientPollFailure(cause)) throw cause;

      transientFailures += 1;
      const exponentialMs = Math.min(
        DEVICE_AUTHORIZATION_MAXIMUM_BACKOFF_MS,
        intervalMs * Math.pow(2, Math.min(transientFailures, 4)),
      );
      const retryAfterMs = cause instanceof ApiError ? cause.retryAfterMs ?? 0 : 0;
      nextDelayMs = Math.max(intervalMs, exponentialMs, retryAfterMs);
    }
  }
}

function publicDisplay(session: HostedDeviceAuthorizationSession): DeviceAuthorizationDisplay {
  const userCode = formatTVSetupCode(session.userCode);
  if (!userCode || userCode !== session.userCode) throw new Error('Hosted Services returned an invalid device authorization code.');
	return {
		userCode,
		verificationUri: normalizedVerificationUri(session.verificationUri),
  };
}

function normalizedVerificationUri(value: string): string {
  const match = /^https:\/\/([a-z0-9.-]+(?::[0-9]{1,5})?)\/device\/?$/i.exec(value);
  if (!match) throw new Error('Hosted Services returned an invalid device authorization address.');
  return `https://${match[1]!}/device`;
}

function assertValidSession(session: HostedDeviceAuthorizationSession, now: number): void {
  if (!session.authorizationSessionId || !session.deviceCode || !/^https:\/\/[^\s/]+/i.test(session.verificationUri)) {
    throw new Error('Hosted Services returned an incomplete device authorization session.');
  }
  if (session.status !== 'pending' || !Number.isFinite(Date.parse(session.expiresAt)) || Date.parse(session.expiresAt) <= now) {
    throw new Error('Hosted Services returned an expired device authorization session.');
  }
  publicDisplay(session);
}

function validAccountCredentials(redeemed: HostedDeviceAuthorizationRedeemResponse, now: number): HostedAccountSession {
  const credentials = redeemed.accountCredentials;
  const accessExpiresAt = Date.parse(credentials?.accessExpiresAt ?? '');
  const refreshExpiresAt = Date.parse(credentials?.refreshExpiresAt ?? '');
  if (
    redeemed.status !== 'redeemed'
    || !credentials
    || credentials.tokenType?.toLowerCase() !== 'bearer'
    || typeof credentials.accessToken !== 'string'
    || typeof credentials.refreshToken !== 'string'
    || !credentials.accessToken.startsWith('ptc_acc_')
		|| !credentials.refreshToken.startsWith('ptc_rft_')
    || !credentials.user?.id
    || !credentials.device?.id
    || credentials.device.userId !== credentials.user.id
    || !Number.isFinite(accessExpiresAt)
    || !Number.isFinite(refreshExpiresAt)
    || accessExpiresAt <= now
    || refreshExpiresAt <= accessExpiresAt
  ) {
    throw new Error('Hosted Services did not return a complete Portico Account session.');
  }
  return credentials;
}

function normalizedIntervalMs(value: number): number {
  if (!Number.isFinite(value)) return DEVICE_AUTHORIZATION_MINIMUM_INTERVAL_MS;
  return Math.max(DEVICE_AUTHORIZATION_MINIMUM_INTERVAL_MS, Math.ceil(value * 1_000));
}

function intervalFromDetails(error: ApiError): number {
  const value = error.details?.interval;
  return typeof value === 'number' ? normalizedIntervalMs(value) : DEVICE_AUTHORIZATION_MINIMUM_INTERVAL_MS;
}

function isTransientPollFailure(value: unknown): boolean {
  if (!(value instanceof ApiError)) {
    return value instanceof TypeError
      || (value instanceof Error && (value.name === 'AbortError' || value.name === 'TimeoutError'));
  }
  return value.status === 408 || value.status === 429 || value.status === 503 || value.status >= 500;
}

export function isTerminalDeviceAuthorizationError(value: unknown): value is ApiError & {code: 'access_denied' | 'authorization_restart_required' | 'expired_token'} {
  return value instanceof ApiError && (
    value.code === 'access_denied'
    || value.code === 'authorization_restart_required'
    || value.code === 'expired_token'
  );
}

function redemptionRestartError(): ApiError {
  return new ApiError(
    409,
    'authorization_restart_required',
    'This device authorization attempt was interrupted. Request a new code to continue safely.',
  );
}

function terminalError(code: 'access_denied' | 'expired_token'): ApiError {
  return new ApiError(
    code === 'access_denied' ? 403 : 400,
    code,
    code === 'access_denied'
      ? 'This device authorization request was denied.'
      : 'This device authorization code has expired.',
  );
}

function throwIfAborted(signal?: AbortSignal): void {
  if (!signal?.aborted) return;
  const error = new Error('Device authorization was cancelled.');
  error.name = 'AbortError';
  throw error;
}

function waitForDeviceAuthorization(delayMs: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) {
      const error = new Error('Device authorization was cancelled.');
      error.name = 'AbortError';
      reject(error);
      return;
    }
    const timer = setTimeout(() => {
      signal?.removeEventListener('abort', onAbort);
      resolve();
    }, delayMs);
    const onAbort = () => {
      clearTimeout(timer);
      signal?.removeEventListener('abort', onAbort);
      const error = new Error('Device authorization was cancelled.');
      error.name = 'AbortError';
      reject(error);
    };
    signal?.addEventListener('abort', onAbort, {once: true});
  });
}
