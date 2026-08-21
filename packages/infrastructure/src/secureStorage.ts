import 'react-native-get-random-values';
import * as Keychain from 'react-native-keychain';
import {NativeModules, Platform, Settings} from 'react-native';
import {createSerializedTrustedServerConnectionAdapter} from '@porticomediaserver/client-core';
import type {
  CredentialAdapter,
  HostedDeviceAuthorizationSession,
  HostedTVSetupSession,
  LocalServerSession,
  PendingCredentialRotation,
  TrustedServerConnectionAdapter,
  TrustedServerConnectionRecord,
  TrustedServerRemovalTombstone,
} from '@porticomediaserver/client-core';
import type {HostedAccountSession} from './types';

const HOSTED_SERVICE = 'tv.getportico.account-session.v1';
const HOSTED_REFRESH_ROTATION_SERVICE =
  'tv.getportico.account-refresh-rotation.v1';
const SERVER_SERVICE = 'tv.getportico.server-session.v1';
const SERVER_REFRESH_ROTATION_SERVICE =
  'tv.getportico.server-refresh-rotation.v1';
const TRUSTED_SERVERS_SERVICE = 'tv.getportico.trusted-server-connections.v1';
const DEVICE_AUTHORIZATION_SERVICE = 'tv.getportico.device-authorization.v1';
const NEARBY_TV_SETUP_SERVICE = 'tv.getportico.nearby-tv-setup.v1';
const CREDENTIAL_CLEANUP_LEDGER_SERVICE =
  'tv.getportico.credential-cleanup-ledger.v1';
const CREDENTIAL_CLEANUP_RESTART_QUARANTINE =
  'tv.getportico.credential-cleanup-quarantine.v1';
const CREDENTIAL_CLEANUP_RESTART_GENERATION =
  'tv.getportico.credential-cleanup-quarantine-generation.v1';
const CREDENTIAL_CLEANUP_COMPLETION_SERVICE =
  'tv.getportico.credential-cleanup-completion.v1';
const USERNAME = 'portico';

const CREDENTIAL_SERVICES = [
  SERVER_SERVICE,
  SERVER_REFRESH_ROTATION_SERVICE,
  HOSTED_SERVICE,
  HOSTED_REFRESH_ROTATION_SERVICE,
  DEVICE_AUTHORIZATION_SERVICE,
  NEARBY_TV_SETUP_SERVICE,
  TRUSTED_SERVERS_SERVICE,
] as const;

/**
 * Authentication provenance is persisted beside the server credential so a
 * Portico Account session can never be mistaken for an independent Local Auth
 * login when the Hosted account credential is absent or revoked.
 */
export type StoredServerSession = LocalServerSession & {
  authenticationMode?: 'portico-account' | 'local';
  hostedAccountId?: string;
};

async function readJSON<T>(service: string): Promise<T | undefined> {
  const credential = await Keychain.getGenericPassword({service});
  if (!credential) return undefined;
  try {
    return JSON.parse(credential.password) as T;
  } catch {
    await Keychain.resetGenericPassword({service});
    return undefined;
  }
}

async function writeJSON(service: string, value: unknown): Promise<void> {
  const serialized = JSON.stringify(value);
  const result = await Keychain.setGenericPassword(USERNAME, serialized, {
    // Account and server sessions must survive background relaunch and route
    // recovery while the screen is locked. This remains hardware-backed,
    // device-only storage and is unavailable until the first unlock after a
    // reboot, but it does not strand a valid rolling session merely because
    // iOS launched Portico before the user unlocked the screen again.
    accessible: Keychain.ACCESSIBLE.AFTER_FIRST_UNLOCK_THIS_DEVICE_ONLY,
    service,
  });
  if (result === false) {
    throw new Error(`Keychain refused to save ${service}.`);
  }

  const persisted = await Keychain.getGenericPassword({service});
  if (
    !persisted ||
    persisted.username !== USERNAME ||
    persisted.password !== serialized
  ) {
    throw new Error(`Portico could not verify secure storage for ${service}.`);
  }
}

async function readStrictJSON(service: string): Promise<unknown> {
  const credential = await Keychain.getGenericPassword({service});
  if (!credential) return undefined;
  try {
    return JSON.parse(credential.password) as unknown;
  } catch (cause) {
    const failure = new Error(
      `Portico could not read secure cleanup state for ${service}.`,
    ) as Error & {cause?: unknown};
    failure.cause = cause;
    throw failure;
  }
}

export const serverCredentialAdapter: CredentialAdapter = {
  load: () => readJSON<StoredServerSession>(SERVER_SERVICE),
  save: session => writeJSON(SERVER_SERVICE, session),
  clear: () =>
    deleteCredentialFamily(SERVER_SERVICE, SERVER_REFRESH_ROTATION_SERVICE),
  loadPendingRotation: () =>
    readJSON<PendingCredentialRotation>(SERVER_REFRESH_ROTATION_SERVICE),
  savePendingRotation: pending =>
    writeJSON(SERVER_REFRESH_ROTATION_SERVICE, pending),
  clearPendingRotation: () =>
    deleteCredentialService(SERVER_REFRESH_ROTATION_SERVICE),
};

export function hostedServerSession(
  session: LocalServerSession,
  accountId: string,
): StoredServerSession {
  return {
    ...session,
    authenticationMode: 'portico-account',
    hostedAccountId: accountId,
  };
}

export function localServerSession(
  session: LocalServerSession,
): StoredServerSession {
  return {...session, authenticationMode: 'local', hostedAccountId: undefined};
}

/**
 * Only explicit Local Auth sessions may be restored without a Portico Account.
 * Nearby TV setup now persists a durable Hosted account family and exchanges
 * its one-time bootstrap for server-local credentials; it is not a standalone
 * server login. Legacy manual-address sessions are the sole untagged form that
 * can be identified safely as Local Auth.
 */
export function canRestoreWithoutHostedAccount(
  session: LocalServerSession,
): boolean {
  const stored = session as StoredServerSession;
  return (
    stored.authenticationMode === 'local' ||
    (!stored.authenticationMode && session.routeType === 'manual')
  );
}

export function isHostedAccountServerSession(
  session: LocalServerSession,
  accountId?: string,
): boolean {
  const stored = session as StoredServerSession;
  if (stored.authenticationMode === 'portico-account') {
    return (
      !accountId ||
      !stored.hostedAccountId ||
      stored.hostedAccountId === accountId
    );
  }
  // Before provenance was added, Hosted direct/LAN sessions and Local Auth LAN
  // sessions were indistinguishable. During an authoritative Hosted account
  // revocation, fail closed for those ambiguous legacy singleton credentials.
  return !stored.authenticationMode && session.routeType !== 'manual';
}

type TrustedServerConnectionCollection = Record<
  string,
  Record<string, TrustedServerConnectionRecord>
>;
type TrustedServerRemovalCollection = Record<
  string,
  Record<string, TrustedServerRemovalTombstone>
>;
type TrustedServerConnectionEnvelope = {
  schemaVersion: 2;
  records: TrustedServerConnectionCollection;
  tombstones: TrustedServerRemovalCollection;
};
let trustedServerMutation: Promise<void> = Promise.resolve();

function emptyTrustedServerConnections(): TrustedServerConnectionEnvelope {
  return {schemaVersion: 2, records: {}, tombstones: {}};
}

async function loadTrustedServerConnections(): Promise<TrustedServerConnectionEnvelope> {
  await trustedServerMutation;
  const value = await readJSON<TrustedServerConnectionEnvelope>(
    TRUSTED_SERVERS_SERVICE,
  );
  if (value?.schemaVersion !== 2 || !value.records || !value.tombstones)
    return emptyTrustedServerConnections();
  return value;
}

async function mutateTrustedServerConnections(
  mutation: (collection: TrustedServerConnectionEnvelope) => void | boolean,
): Promise<boolean> {
  let changed = false;
  const next = trustedServerMutation.then(async () => {
    const collection = await readJSON<TrustedServerConnectionEnvelope>(
      TRUSTED_SERVERS_SERVICE,
    );
    const envelope =
      collection?.schemaVersion === 2 &&
      collection.records &&
      collection.tombstones
        ? collection
        : emptyTrustedServerConnections();
    const result = mutation(envelope);
    changed = result !== false;
    if (changed) await writeJSON(TRUSTED_SERVERS_SERVICE, envelope);
  });
  trustedServerMutation = next.catch(() => undefined);
  await next;
  return changed;
}

const keychainTrustedServerConnectionAdapter: TrustedServerConnectionAdapter = {
  list: async accountId =>
    Object.values(
      (await loadTrustedServerConnections()).records[accountId] ?? {},
    ),
  load: async (accountId, serverId) =>
    (await loadTrustedServerConnections()).records[accountId]?.[serverId],
  save: record =>
    mutateTrustedServerConnections(collection => {
      collection.records[record.accountId] = {
        ...collection.records[record.accountId],
        [record.serverId]: record,
      };
    }).then(() => undefined),
  remove: (accountId, serverId) =>
    mutateTrustedServerConnections(collection => {
      if (!collection.records[accountId]?.[serverId]) return false;
      delete collection.records[accountId][serverId];
      if (Object.keys(collection.records[accountId]).length === 0)
        delete collection.records[accountId];
      return true;
    }).then(() => undefined),
  clearAccount: accountId =>
    mutateTrustedServerConnections(collection => {
      if (!collection.records[accountId] && !collection.tombstones[accountId])
        return false;
      delete collection.records[accountId];
      delete collection.tombstones[accountId];
      return true;
    }).then(() => undefined),
  compareAndSwap: (expectedVersion, record) =>
    mutateTrustedServerConnections(collection => {
      const current = collection.records[record.accountId]?.[record.serverId];
      if ((current?.mutationVersion ?? 0) !== expectedVersion) return false;
      const tombstone =
        collection.tombstones[record.accountId]?.[record.serverId];
      if (
        tombstone &&
        tombstone.mutationVersion >= (record.mutationVersion ?? 0)
      )
        return false;
      collection.records[record.accountId] = {
        ...collection.records[record.accountId],
        [record.serverId]: record,
      };
      return true;
    }),
  removeWithTombstone: tombstone =>
    mutateTrustedServerConnections(collection => {
      const existing =
        collection.tombstones[tombstone.accountId]?.[tombstone.serverId];
      if (existing && existing.mutationVersion > tombstone.mutationVersion)
        return false;
      if (collection.records[tombstone.accountId]?.[tombstone.serverId]) {
        delete collection.records[tombstone.accountId][tombstone.serverId];
        if (Object.keys(collection.records[tombstone.accountId]).length === 0)
          delete collection.records[tombstone.accountId];
      }
      collection.tombstones[tombstone.accountId] = {
        ...collection.tombstones[tombstone.accountId],
        [tombstone.serverId]: tombstone,
      };
      return true;
    }).then(() => undefined),
  loadRemovalTombstone: async (accountId, serverId) =>
    (await loadTrustedServerConnections()).tombstones[accountId]?.[serverId],
};

export const trustedServerConnectionAdapter =
  createSerializedTrustedServerConnectionAdapter(
    keychainTrustedServerConnectionAdapter,
  );

export const hostedCredentialStore = {
  load: () => readJSON<HostedAccountSession>(HOSTED_SERVICE),
  save: (session: HostedAccountSession) => writeJSON(HOSTED_SERVICE, session),
  clear: () =>
    deleteCredentialFamily(HOSTED_SERVICE, HOSTED_REFRESH_ROTATION_SERVICE),
};

/**
 * A refresh rotation is a two-record transaction: Hosted Services consumes the
 * previous refresh token before Keychain can durably publish its successor.
 * This journal is written before the network request, allowing a restarted
 * client to replay the exact old-token/rotation-key pair and recover the exact
 * same successor rather than falsely reporting token reuse.
 */
export interface HostedRefreshRotationJournal {
  authority: 'hosted';
  createdAt: string;
  oldRefreshToken: string;
  rotationKey: string;
  version: 'v1';
}

export const hostedRefreshRotationStore = {
  load: () =>
    readJSON<HostedRefreshRotationJournal>(HOSTED_REFRESH_ROTATION_SERVICE),
  save: (journal: HostedRefreshRotationJournal) =>
    writeJSON(HOSTED_REFRESH_ROTATION_SERVICE, journal),
  clear: () => deleteCredentialService(HOSTED_REFRESH_ROTATION_SERVICE),
};

export interface StoredDeviceAuthorizationSession {
  installationId: string;
  /** Set durably before redemption so a lost response can recover the same Hosted credential family. */
  redemptionStarted?: boolean;
  redemptionStartedAt?: string;
  session: HostedDeviceAuthorizationSession;
  terminalCode?: 'access_denied' | 'expired_token';
}

export const deviceAuthorizationSessionStore = {
  load: () =>
    readJSON<StoredDeviceAuthorizationSession>(DEVICE_AUTHORIZATION_SERVICE),
  save: (session: StoredDeviceAuthorizationSession) =>
    writeJSON(DEVICE_AUTHORIZATION_SERVICE, session),
  clear: () => deleteCredentialService(DEVICE_AUTHORIZATION_SERVICE),
};

/**
 * The short-lived Nearby TV Setup poll secret and X25519 private key are kept
 * in Keychain so an app suspension does not silently replace the code that is
 * already visible and advertised. They are removed as soon as the encrypted
 * grant is redeemed or the user explicitly requests a replacement.
 */
export interface StoredNearbyTVSetupSession {
  identityPrivateKey: number[];
  /** Optional diagnostics metadata; never authentication authority. */
  installationId?: string;
  session: HostedTVSetupSession & {pollSecret: string};
  redemptionStarted?: boolean;
}

export const nearbyTVSetupSessionStore = {
  load: () => readJSON<StoredNearbyTVSetupSession>(NEARBY_TV_SETUP_SERVICE),
  save: (session: StoredNearbyTVSetupSession) =>
    writeJSON(NEARBY_TV_SETUP_SERVICE, session),
  clear: () => deleteCredentialService(NEARBY_TV_SETUP_SERVICE),
};

export interface CredentialCleanupScope {
  authority: 'hosted' | 'local' | 'unknown';
  accountId?: string;
  serverId?: string;
}

export interface PendingCredentialCleanup extends CredentialCleanupScope {
  id: string;
  createdAt: string;
}

export class CredentialCleanupUncertainError extends Error {
  readonly code = 'credential_cleanup_uncertain';

  constructor(message: string) {
    super(message);
    this.name = 'CredentialCleanupUncertainError';
  }
}

interface CredentialCleanupLedgerDocument {
  schemaVersion: 1;
  entries: Record<string, PendingCredentialCleanup>;
}

let credentialCleanupMutation: Promise<void> = Promise.resolve();
let credentialCleanupSequence = 0;
let restartQuarantineSequence = 0;
let cleanupUnknownQuarantine = false;

function createRestartQuarantineGeneration(): string {
  const crypto = (
    globalThis as typeof globalThis & {
      crypto: {
        randomUUID?(): string;
        getRandomValues<T extends ArrayBufferView | null>(array: T): T;
      };
    }
  ).crypto;
  if (typeof crypto.randomUUID === 'function') return crypto.randomUUID();
  const bytes = new Uint8Array(16);
  crypto.getRandomValues(bytes);
  return [...bytes].map(byte => byte.toString(16).padStart(2, '0')).join('');
}

export interface RestartQuarantineStorage {
  read(key: string): unknown;
  write(values: Record<string, unknown>): void;
}

interface RestartQuarantineState {
  status: 'available';
  quarantined: boolean;
  generation?: string;
  completedGeneration?: string;
}

interface RestartQuarantineStore {
  read(): Promise<RestartQuarantineState>;
  isActive(): Promise<boolean>;
  generation(): Promise<string | undefined>;
  publish(generation: string): Promise<void>;
  markCompleted(generation: string): Promise<void>;
  clear(generation?: string): Promise<void>;
}

/**
 * Apple builds ship this through Settings/NSUserDefaults. Keeping the storage
 * contract separate from the cleanup algorithm lets an Android host provide
 * its own SharedPreferences-backed implementation without coupling secrets to
 * a non-Keychain store.
 */
export function createRestartQuarantineStore(
  storage: RestartQuarantineStorage,
): RestartQuarantineStore {
  const read = (): RestartQuarantineState => {
    const activeValue = storage.read(CREDENTIAL_CLEANUP_RESTART_QUARANTINE);
    const generationValue = storage.read(CREDENTIAL_CLEANUP_RESTART_GENERATION);
    const generation =
      typeof generationValue === 'string' && generationValue.length > 0
        ? generationValue
        : undefined;
    return {
      status: 'available',
      quarantined:
        activeValue !== undefined &&
        activeValue !== null &&
        activeValue !== false,
      ...(generation ? {generation} : {}),
    };
  };

  return {
    async read(): Promise<RestartQuarantineState> {
      return read();
    },
    async isActive(): Promise<boolean> {
      return (await read()).quarantined;
    },
    async generation(): Promise<string | undefined> {
      return (await read()).generation;
    },
    async publish(generation: string): Promise<void> {
      storage.write({
        [CREDENTIAL_CLEANUP_RESTART_QUARANTINE]: true,
        [CREDENTIAL_CLEANUP_RESTART_GENERATION]: generation,
      });
      const state = read();
      if (!state.quarantined || state.generation !== generation) {
        throw new Error(
          'Portico could not verify the restart cleanup quarantine.',
        );
      }
    },
    async markCompleted(generation: string): Promise<void> {
      const state = read();
      if (
        !state.quarantined ||
        (state.generation !== undefined && state.generation !== generation)
      ) {
        throw new Error(
          'Portico could not verify the restart cleanup quarantine.',
        );
      }
    },
    async clear(generation?: string): Promise<void> {
      const before = read();
      if (
        generation !== undefined &&
        before.generation !== undefined &&
        before.generation !== generation
      ) {
        throw new Error(
          'Portico could not verify release of the restart cleanup quarantine.',
        );
      }
      storage.write({[CREDENTIAL_CLEANUP_RESTART_QUARANTINE]: false});
      if ((await read()).quarantined) {
        throw new Error(
          'Portico could not verify release of the restart cleanup quarantine.',
        );
      }
    },
  };
}

const appleRestartQuarantine = createRestartQuarantineStore({
  read: key => Settings.get(key),
  write: values => Settings.set(values),
});

interface AndroidCleanupQuarantineModule {
  getState(): Promise<unknown>;
  begin(generation: string): Promise<unknown>;
  markCompleted(generation: string): Promise<unknown>;
  release(generation: string): Promise<unknown>;
}

const isAndroid = Platform.OS === 'android';

function androidCleanupStorageError(message: string, cause?: unknown): Error {
  const error = new Error(message) as Error & {cause?: unknown};
  error.cause = cause;
  return error;
}

function getAndroidCleanupQuarantineModule(): AndroidCleanupQuarantineModule {
  const module = NativeModules?.PorticoCleanupQuarantine as
    | Partial<AndroidCleanupQuarantineModule>
    | undefined;
  if (
    !module ||
    typeof module.getState !== 'function' ||
    typeof module.begin !== 'function' ||
    typeof module.markCompleted !== 'function' ||
    typeof module.release !== 'function'
  ) {
    throw androidCleanupStorageError(
      'Android device-protected cleanup storage is unavailable.',
    );
  }
  return module as AndroidCleanupQuarantineModule;
}

function parseAndroidCleanupState(value: unknown): RestartQuarantineState {
  if (
    !value ||
    typeof value !== 'object' ||
    (value as {status?: unknown}).status !== 'available' ||
    typeof (value as {quarantined?: unknown}).quarantined !== 'boolean'
  ) {
    throw androidCleanupStorageError(
      'Android device-protected cleanup storage is corrupt.',
    );
  }
  const state = value as {
    status: 'available';
    quarantined: boolean;
    generation?: unknown;
    completedGeneration?: unknown;
  };
  for (const generation of [state.generation, state.completedGeneration]) {
    if (
      generation !== undefined &&
      (typeof generation !== 'string' || generation.length === 0)
    ) {
      throw androidCleanupStorageError(
        'Android device-protected cleanup storage is corrupt.',
      );
    }
  }
  if (state.quarantined && typeof state.generation !== 'string') {
    throw androidCleanupStorageError(
      'Android device-protected cleanup storage is corrupt.',
    );
  }
  if (!state.quarantined && state.generation !== undefined) {
    throw androidCleanupStorageError(
      'Android device-protected cleanup storage is corrupt.',
    );
  }
  return {
    status: 'available',
    quarantined: state.quarantined,
    ...(typeof state.generation === 'string'
      ? {generation: state.generation}
      : {}),
    ...(typeof state.completedGeneration === 'string'
      ? {completedGeneration: state.completedGeneration}
      : {}),
  };
}

async function callAndroidCleanupStorage(
  operation: () => Promise<unknown>,
): Promise<RestartQuarantineState> {
  try {
    return parseAndroidCleanupState(await operation());
  } catch (cause) {
    if (
      cause instanceof Error &&
      (cause.message.includes('device-protected cleanup storage') ||
        cause.message.includes('Android cleanup generation'))
    ) {
      throw cause;
    }
    throw androidCleanupStorageError(
      'Android device-protected cleanup storage is unavailable.',
      cause,
    );
  }
}

function createAndroidRestartQuarantineStore(): RestartQuarantineStore {
  const read = (): Promise<RestartQuarantineState> => {
    const module = getAndroidCleanupQuarantineModule();
    return callAndroidCleanupStorage(() => module.getState());
  };
  const verify = async (
    operation: () => Promise<unknown>,
    expected: (state: RestartQuarantineState) => boolean,
  ): Promise<void> => {
    const state = await callAndroidCleanupStorage(operation);
    if (!expected(state)) {
      throw androidCleanupStorageError(
        'Android device-protected cleanup storage failed verification.',
      );
    }
  };

  return {
    read,
    isActive: async () => (await read()).quarantined,
    generation: async () => (await read()).generation,
    publish: async generation => {
      const module = getAndroidCleanupQuarantineModule();
      await verify(
        () => module.begin(generation),
        state => state.quarantined && state.generation === generation,
      );
    },
    markCompleted: async generation => {
      const module = getAndroidCleanupQuarantineModule();
      await verify(
        () => module.markCompleted(generation),
        state =>
          state.quarantined &&
          state.generation === generation &&
          state.completedGeneration === generation,
      );
    },
    clear: async generation => {
      if (!generation) {
        throw androidCleanupStorageError(
          'Android device-protected cleanup storage is corrupt.',
        );
      }
      const module = getAndroidCleanupQuarantineModule();
      await verify(
        () => module.release(generation),
        state =>
          !state.quarantined &&
          state.generation === undefined &&
          state.completedGeneration === generation,
      );
    },
  };
}

const restartQuarantine = isAndroid
  ? createAndroidRestartQuarantineStore()
  : appleRestartQuarantine;

interface CredentialCleanupCompletionDocument {
  schemaVersion: 1;
  completedAt: string;
  generation: string;
  completedLegacyBarrier?: boolean;
}

function parseCredentialCleanupCompletion(
  value: unknown,
): CredentialCleanupCompletionDocument | undefined {
  if (value === undefined) return undefined;
  if (
    !value ||
    typeof value !== 'object' ||
    (value as {schemaVersion?: unknown}).schemaVersion !== 1 ||
    typeof (value as {completedAt?: unknown}).completedAt !== 'string' ||
    typeof (value as {generation?: unknown}).generation !== 'string' ||
    !(value as {generation: string}).generation ||
    ((value as {completedLegacyBarrier?: unknown}).completedLegacyBarrier !==
      undefined &&
      typeof (value as {completedLegacyBarrier?: unknown})
        .completedLegacyBarrier !== 'boolean')
  ) {
    throw new Error('Portico secure cleanup completion state is invalid.');
  }
  return value as CredentialCleanupCompletionDocument;
}

async function loadCredentialCleanupCompletion(): Promise<
  CredentialCleanupCompletionDocument | undefined
> {
  return parseCredentialCleanupCompletion(
    await readStrictJSON(CREDENTIAL_CLEANUP_COMPLETION_SERVICE),
  );
}

async function recordCredentialCleanupCompletion(
  generation: string,
  completedLegacyBarrier = false,
): Promise<void> {
  await writeJSON(CREDENTIAL_CLEANUP_COMPLETION_SERVICE, {
    schemaVersion: 1,
    completedAt: new Date().toISOString(),
    generation,
    ...(completedLegacyBarrier ? {completedLegacyBarrier: true} : {}),
  } satisfies CredentialCleanupCompletionDocument);
}

async function isDurablyCompletedRestartQuarantine(): Promise<boolean> {
  const state = await restartQuarantine.read();
  if (isAndroid) {
    return Boolean(
      state.quarantined &&
      state.generation &&
      state.completedGeneration === state.generation,
    );
  }
  const generation = state.generation;
  const completion = await loadCredentialCleanupCompletion();
  return generation
    ? completion?.generation === generation
    : completion?.completedLegacyBarrier === true;
}

function emptyCredentialCleanupLedger(): CredentialCleanupLedgerDocument {
  return {schemaVersion: 1, entries: {}};
}

function parseCredentialCleanupLedger(
  value: unknown,
): CredentialCleanupLedgerDocument {
  if (value === undefined) return emptyCredentialCleanupLedger();
  if (
    !value ||
    typeof value !== 'object' ||
    (value as {schemaVersion?: unknown}).schemaVersion !== 1 ||
    !(value as {entries?: unknown}).entries ||
    typeof (value as {entries?: unknown}).entries !== 'object' ||
    Array.isArray((value as {entries?: unknown}).entries)
  ) {
    throw new Error('Portico secure cleanup state is invalid.');
  }
  const entries: Record<string, PendingCredentialCleanup> = {};
  for (const [key, candidate] of Object.entries(
    (value as CredentialCleanupLedgerDocument).entries,
  )) {
    if (
      !candidate ||
      typeof candidate !== 'object' ||
      candidate.id !== key ||
      !['hosted', 'local', 'unknown'].includes(candidate.authority) ||
      typeof candidate.createdAt !== 'string' ||
      (candidate.accountId !== undefined &&
        typeof candidate.accountId !== 'string') ||
      (candidate.serverId !== undefined &&
        typeof candidate.serverId !== 'string')
    ) {
      throw new Error('Portico secure cleanup state is invalid.');
    }
    entries[key] = candidate;
  }
  return {schemaVersion: 1, entries};
}

async function loadCredentialCleanupLedger(): Promise<CredentialCleanupLedgerDocument> {
  await credentialCleanupMutation;
  return parseCredentialCleanupLedger(
    await readStrictJSON(CREDENTIAL_CLEANUP_LEDGER_SERVICE),
  );
}

async function mutateCredentialCleanupLedger(
  mutation: (ledger: CredentialCleanupLedgerDocument) => void,
): Promise<void> {
  const next = credentialCleanupMutation.then(async () => {
    const ledger = parseCredentialCleanupLedger(
      await readStrictJSON(CREDENTIAL_CLEANUP_LEDGER_SERVICE),
    );
    mutation(ledger);
    await writeJSON(CREDENTIAL_CLEANUP_LEDGER_SERVICE, ledger);
  });
  credentialCleanupMutation = next.catch(() => undefined);
  await next;
}

function createCredentialCleanupId(scope: CredentialCleanupScope): string {
  credentialCleanupSequence += 1;
  const subject = [scope.authority, scope.accountId, scope.serverId]
    .filter(Boolean)
    .join(':')
    .replace(/[^a-zA-Z0-9_.:-]/g, '_');
  return `${Date.now().toString(36)}-${credentialCleanupSequence.toString(36)}-${subject || 'session'}`;
}

async function addPendingCredentialCleanup(
  scope: CredentialCleanupScope,
): Promise<PendingCredentialCleanup> {
  let entry!: PendingCredentialCleanup;
  await mutateCredentialCleanupLedger(ledger => {
    let id = createCredentialCleanupId(scope);
    while (ledger.entries[id]) id = createCredentialCleanupId(scope);
    entry = {
      ...scope,
      id,
      createdAt: new Date().toISOString(),
    };
    ledger.entries[entry.id] = entry;
  });
  const published = await loadCredentialCleanupLedger();
  if (!published.entries[entry.id]) {
    throw new Error('Portico could not verify the secure cleanup barrier.');
  }
  return entry;
}

async function removePendingCredentialCleanups(
  ids: readonly string[],
): Promise<void> {
  if (!ids.length) return;
  await mutateCredentialCleanupLedger(ledger => {
    for (const id of ids) delete ledger.entries[id];
  });
}

async function deleteCredentialService(service: string): Promise<void> {
  let resetResult: boolean | undefined;
  let resetFailure: unknown;
  try {
    resetResult = await Keychain.resetGenericPassword({service});
  } catch (cause) {
    resetFailure = cause;
  }

  let retained: Awaited<ReturnType<typeof Keychain.getGenericPassword>>;
  try {
    retained = await Keychain.getGenericPassword({service});
  } catch (cause) {
    throw new AggregateError(
      [resetFailure, cause].filter(value => value !== undefined),
      `Portico could not verify secure deletion for ${service}.`,
    );
  }
  if (!retained) return;

  throw new AggregateError(
    [
      ...(resetFailure === undefined ? [] : [resetFailure]),
      new Error(
        resetResult === false
          ? `Keychain refused to delete ${service}.`
          : `Keychain retained ${service} after deletion.`,
      ),
    ],
    `Portico could not delete ${service}.`,
  );
}

async function deleteCredentialFamily(
  credentialService: string,
  pendingRotationService: string,
): Promise<void> {
  // Deleting one inactive credential family is an atomic, verified Keychain
  // operation. A global restart quarantine belongs only to full sign-out and
  // account replacement, where an in-flight producer could otherwise publish
  // a credential after teardown. Applying it to routine server-family swaps
  // caused a force-closed app to erase the independent Portico Account on its
  // next launch. Scope validation already prevents a retained old server
  // credential from being activated under another account/profile.
  const results = await Promise.allSettled([
    deleteCredentialService(credentialService),
    deleteCredentialService(pendingRotationService),
  ]);
  const failures = results.flatMap(result =>
    result.status === 'rejected' ? [result.reason] : [],
  );
  if (failures.length) {
    throw new AggregateError(
      failures,
      `Portico could not finish restart-safe credential cleanup for ${credentialService} and its pending rotation.`,
    );
  }
}

async function deleteEveryCredentialService(): Promise<void> {
  const results = await Promise.allSettled(
    CREDENTIAL_SERVICES.map(service => deleteCredentialService(service)),
  );
  const failures = results.flatMap(result =>
    result.status === 'rejected' ? [result.reason] : [],
  );
  if (failures.length) {
    throw new AggregateError(
      failures,
      'Portico could not verify deletion of every saved credential.',
    );
  }
}

/**
 * Deletes every credential copy while deliberately leaving cleanup barriers
 * untouched. Sign-out uses this after an abort-ignoring predecessor exceeds
 * its deadline: a late write remains quarantined on the next launch.
 */
export async function deleteAllCredentialsRetainingCleanupBarrier(): Promise<void> {
  await deleteEveryCredentialService();
}

export const credentialCleanupLedger = {
  list: async (): Promise<PendingCredentialCleanup[]> =>
    Object.values((await loadCredentialCleanupLedger()).entries),
  isQuarantined: async (): Promise<boolean> =>
    cleanupUnknownQuarantine || (await restartQuarantine.isActive()),
};

async function publishRestartQuarantine(): Promise<void> {
  let generation = createRestartQuarantineGeneration();
  if (isAndroid) {
    const state = await restartQuarantine.read();
    if (state.quarantined) {
      if (!state.generation) {
        throw androidCleanupStorageError(
          'Android device-protected cleanup storage is corrupt.',
        );
      }
      // The Android native store owns one global generation. Concurrent live
      // cleanup owners share it while the Keychain ledger remains additive.
      generation = state.generation;
    }
  }
  await restartQuarantine.publish(generation);
}

async function verifyActiveRestartQuarantine(): Promise<void> {
  const state = await restartQuarantine.read();
  if (!state.quarantined) {
    throw new CredentialCleanupUncertainError(
      'Portico could not verify the active restart cleanup quarantine.',
    );
  }
}

export async function beginCredentialCleanup(
  scope: CredentialCleanupScope = {authority: 'unknown'},
): Promise<PendingCredentialCleanup> {
  restartQuarantineSequence += 1;
  const [settingsBarrier, keychainBarrier] = await Promise.allSettled([
    Promise.resolve().then(() => publishRestartQuarantine()),
    addPendingCredentialCleanup(scope),
  ]);
  const failures = [settingsBarrier, keychainBarrier].flatMap(result =>
    result.status === 'rejected' ? [result.reason] : [],
  );
  if (failures.length) {
    cleanupUnknownQuarantine = true;
    throw new AggregateError(
      failures,
      'Portico could not publish every restart-safe cleanup barrier.',
    );
  }
  if (keychainBarrier.status !== 'fulfilled') {
    throw keychainBarrier.reason;
  }
  return keychainBarrier.value;
}

export async function finishCredentialCleanup(
  marker: PendingCredentialCleanup,
): Promise<void> {
  const cleanupEpoch = restartQuarantineSequence;
  await verifyActiveRestartQuarantine();
  await deleteEveryCredentialService();
  // A live cleanup operation owns only its own barrier. An older marker may
  // belong to another account whose teardown is still running (or already
  // failed), so retiring it here could let that operation republish stale
  // credentials after Settings has been released. Only fresh-launch recovery,
  // where no predecessor from the prior process can still write, may retire
  // every historical marker together.
  await removePendingCredentialCleanups([marker.id]);
  await releaseRestartQuarantineAfterVerifiedCleanup(
    cleanupEpoch,
    false,
    false,
  );
  const unresolved = Object.keys((await loadCredentialCleanupLedger()).entries);
  if (
    unresolved.length > 0 ||
    cleanupUnknownQuarantine ||
    (await restartQuarantine.isActive())
  ) {
    throw new CredentialCleanupUncertainError(
      'Portico deleted saved credentials but another cleanup barrier remains unresolved.',
    );
  }
}

/**
 * A cleanup marker is committed before any credential is deleted. It is kept
 * outside the credential services being erased so a fresh provider can fail
 * closed and retry after a partial Keychain failure. Entries are additive:
 * another account or server sign-out cannot overwrite an older failed cleanup.
 */
export async function clearAllCredentials(
  scope: CredentialCleanupScope = {authority: 'unknown'},
): Promise<void> {
  let marker: PendingCredentialCleanup | undefined;
  let markerFailure: unknown;
  try {
    marker = await beginCredentialCleanup(scope);
  } catch (cause) {
    markerFailure = cause;
  }

  // A credential delete without a durably published restart barrier is unsafe:
  // a stale process can still republish the credential family after this
  // process exits. Leave credentials intact and surface the uncertainty so a
  // later launch can retry once the barrier provider is available.
  if (markerFailure) {
    throw new AggregateError(
      [markerFailure],
      'Portico could not finish secure credential cleanup.',
    );
  }

  let cleanupFailure: unknown;
  try {
    if (!marker) {
      throw new CredentialCleanupUncertainError(
        'Portico could not establish a restart-safe credential cleanup marker.',
      );
    }
    await finishCredentialCleanup(marker);
  } catch (cause) {
    cleanupFailure = cause;
  }
  if (markerFailure || cleanupFailure) {
    throw new AggregateError(
      [markerFailure, cleanupFailure].filter(value => value !== undefined),
      'Portico could not finish secure credential cleanup.',
    );
  }
}

/**
 * Returns `true` when a prior cleanup barrier was encountered. Callers must
 * remain signed out for this launch even when the retry succeeds; credentials
 * that existed before the barrier are never restored in the same boot.
 */
export async function retryPendingCredentialCleanup(): Promise<boolean> {
  const cleanupEpoch = restartQuarantineSequence;
  const restartState = await restartQuarantine.read();
  const pending = await credentialCleanupLedger.list();
  // Settings/NSUserDefaults updates are bridged asynchronously by React
  // Native. A process can therefore be killed after a verified cleanup has
  // completed but before the `false` release reaches disk. The Keychain
  // completion record is written and read back before that release. When its
  // generation matches the still-visible Settings generation, the barrier is
  // conclusively stale and must not erase credentials created after sign-out.
  if (
    pending.length === 0 &&
    !cleanupUnknownQuarantine &&
    restartState.quarantined &&
    (await isDurablyCompletedRestartQuarantine())
  ) {
    if (isAndroid && !restartState.generation) {
      throw androidCleanupStorageError(
        'Android device-protected cleanup storage is corrupt.',
      );
    }
    await restartQuarantine.clear(restartState.generation);
    return false;
  }
  const encounteredBarrier =
    pending.length > 0 || cleanupUnknownQuarantine || restartState.quarantined;
  if (!encounteredBarrier) return false;
  if (isAndroid && !restartState.quarantined) {
    throw new CredentialCleanupUncertainError(
      'Portico could not verify the Android restart cleanup quarantine.',
    );
  }
  const recoveringLegacyBarrier =
    !isAndroid && restartState.quarantined && !restartState.generation;
  if (recoveringLegacyBarrier) {
    // Upgrade the pre-generation v1 boolean before deleting anything. The
    // completion record also remembers that this was a legacy migration, so
    // recovery remains idempotent even if neither this generated ID nor the
    // later `false` Settings write reaches disk before process death.
    await restartQuarantine.publish(createRestartQuarantineGeneration());
  }
  await deleteEveryCredentialService();
  await removePendingCredentialCleanups(pending.map(entry => entry.id));
  await releaseRestartQuarantineAfterVerifiedCleanup(
    cleanupEpoch,
    true,
    recoveringLegacyBarrier,
  );
  return true;
}

async function releaseRestartQuarantineAfterVerifiedCleanup(
  cleanupEpoch: number,
  recoveringUnknownBarrier: boolean,
  recoveringLegacyBarrier: boolean,
): Promise<void> {
  if (recoveringUnknownBarrier && cleanupEpoch === restartQuarantineSequence) {
    cleanupUnknownQuarantine = false;
  }
  const reconciliationEpoch = restartQuarantineSequence;
  const remaining = Object.keys((await loadCredentialCleanupLedger()).entries);
  if (
    reconciliationEpoch !== restartQuarantineSequence ||
    remaining.length > 0
  ) {
    return;
  }
  if (cleanupUnknownQuarantine) return;
  const restartState = await restartQuarantine.read();
  if (restartState.quarantined && restartState.generation) {
    // This durable tombstone is the authority for a completed generation.
    if (isAndroid) {
      await restartQuarantine.markCompleted(restartState.generation);
    } else {
      await recordCredentialCleanupCompletion(
        restartState.generation,
        recoveringLegacyBarrier,
      );
    }
    if (reconciliationEpoch !== restartQuarantineSequence) return;
    await restartQuarantine.clear(restartState.generation);
  }
}
