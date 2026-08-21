import {
  connectResilientHostedServer,
  createTrustedServerCredentialAdapter,
  createHostedServicesClient,
  createPorticoClient,
  refreshTrustedServerRoute,
  type LocalServerSession,
  type PreparedTrustedServerConnection,
  type StagedTrustedServerCandidate,
  TrustedServerDurabilityUncertainError,
  type CredentialAdapter,
  type SessionStore,
  type ViewerScope,
  trustedHostedDocumentKeysFromKeySet,
  type HostedServer,
  type HostedProfileSelectionEnvelope,
  type HostedRoutePreference,
} from '@porticomediaserver/client-core';
import {ed25519} from '@noble/curves/ed25519.js';
import {toByteArray} from 'base64-js';
import {
  hostedServerSession,
  serverCredentialAdapter,
  trustedServerConnectionAdapter,
  type StoredServerSession,
} from './secureStorage';
import {
  getPorticoBuildContract,
  getPorticoRuntimeDescriptor,
  porticoClientDescriptor,
  PorticoRuntimeDescriptorError,
  type PorticoPlatform,
} from './types';
import {discoverNearbyPorticoServers, logNativeDiagnostic} from './nearbyDevices';
import {applePlaybackClientProfile} from './applePlaybackCapabilities';

export type NativeNetworkLocality = 'local-network' | 'wide-area' | 'offline' | 'unknown';

let hostedAccessToken: string | undefined;
let serverSession: StoredServerSession | undefined;
let serverActivationMutation: Promise<void> = Promise.resolve();
let viewerCredentialMutation: Promise<void> = Promise.resolve();
let serverRouteRevision = 0;
let serverSessionRevision = 0;
let routeFailureRefreshInFlight: Promise<boolean> | undefined;
const serverRouteChangeListeners = new Set<(
  change: ServerRouteChange,
) => void>();
const serverRouteRefreshListeners = new Set<(
  request: ServerRouteRefreshRequest,
) => boolean | Promise<boolean>>();
const serverSessionChangeListeners = new Set<(
  change: ServerSessionChange,
) => void>();
let viewerEnvironment = {
  accepting: false,
  generation: 0,
  scope: undefined as ViewerScope | undefined,
};

export interface StagedServerSessionEnvironment {
  readonly generation: number;
  /** Waits for every A credential mutation admitted before the fence. */
  drain(): Promise<void>;
  /** Opens B only after its verified credential and runtime are published. */
  activate(scope: ViewerScope): void;
  /** Reinstalls the synchronous fence before credential/runtime compensation. */
  fence(): void;
  /** Restores A only after B is fenced and A credentials/runtime are restored. */
  rollback(): void;
  /** Permanently invalidates both A and B clients. */
  failClosed(): void;
}

export type ServerRouteRefreshReason =
  | 'network-transition'
  | 'route-failure';

export interface ServerRouteRefreshRequest {
  readonly reason: ServerRouteRefreshReason;
  readonly failedURL?: string;
}

export interface ServerRouteChange {
  readonly previousURL?: string;
  readonly nextURL: string;
  readonly serverId?: string;
  readonly revision: number;
}

/**
 * Publishes authoritative credential-family replacement independently from
 * route changes. Access-token refresh commonly retains the same URL while its
 * profile authorization revision changes, so route observation alone is not
 * an identity boundary.
 */
export interface ServerSessionChange {
  readonly previous?: StoredServerSession;
  readonly current?: StoredServerSession;
  readonly revision: number;
}

export interface NativeNetworkRouteState {
  readonly type: string;
  readonly isConnected: boolean | null;
  readonly isInternetReachable: boolean | null;
  readonly details?: Readonly<Record<string, unknown>> | null;
}

/**
 * Coalesces the noisy NetInfo stream into actual route-disposal events.
 * Going offline only arms recovery; Portico waits for a reachable network so
 * it does not tear down a still-buffered player merely because radio state
 * flapped for a moment.
 */
export class NativeNetworkRouteRefreshCoordinator {
  private identity?: string;
  private offlineObserved = false;
  private timer?: ReturnType<typeof setTimeout>;

  constructor(
    private readonly refresh: () => void | Promise<void>,
    private readonly debounceMilliseconds = 750,
    private readonly schedule: typeof setTimeout = setTimeout,
    private readonly cancel: typeof clearTimeout = clearTimeout,
  ) {}

  update(state: NativeNetworkRouteState): void {
    const nextIdentity = nativeNetworkRouteIdentity(state);
    if (this.identity === undefined) {
      this.identity = nextIdentity;
      this.offlineObserved = !networkStateIsReachable(state);
      return;
    }
    if (!networkStateIsReachable(state)) {
      this.offlineObserved = true;
      return;
    }
    const changed = nextIdentity !== this.identity;
    if (!changed && !this.offlineObserved) return;
    this.identity = nextIdentity;
    this.offlineObserved = false;
    if (this.timer) this.cancel(this.timer);
    this.timer = this.schedule(() => {
      this.timer = undefined;
      void this.refresh();
    }, this.debounceMilliseconds);
  }

  dispose(): void {
    if (this.timer) this.cancel(this.timer);
    this.timer = undefined;
  }
}

export function nativeNetworkRouteIdentity(
  state: NativeNetworkRouteState,
): string {
  const details = state.details ?? {};
  const identityDetails = [
    details.ipAddress,
    details.subnet,
    details.ssid,
    details.bssid,
    details.cellularGeneration,
  ].map(value => (typeof value === 'string' ? value : ''));
  return [state.type, ...identityDetails].join('|');
}

/** Physical transport locality; deliberately independent from the selected server URL. */
export function nativeNetworkLocality(state: NativeNetworkRouteState): NativeNetworkLocality {
  if (state.isConnected === false || state.isInternetReachable === false) return 'offline';
  const type = state.type.toLowerCase();
  if (type === 'wifi' || type === 'ethernet') return 'local-network';
  if (type === 'cellular') return 'wide-area';
  return state.isConnected === true ? 'unknown' : 'offline';
}

export function subscribeServerRouteChanges(
  listener: (change: ServerRouteChange) => void,
): () => void {
  serverRouteChangeListeners.add(listener);
  return () => serverRouteChangeListeners.delete(listener);
}

export function subscribeServerSessionChanges(
  listener: (change: ServerSessionChange) => void,
): () => void {
  serverSessionChangeListeners.add(listener);
  return () => serverSessionChangeListeners.delete(listener);
}

/** Announces a route only after its credential/durability transaction commits. */
export function announceCurrentServerRouteChange(
  previousURL?: string,
  force = false,
): void {
  const nextURL = serverSession?.apiBaseUrl;
  if (!nextURL || (!force && nextURL === previousURL)) return;
  const change: ServerRouteChange = {
    previousURL,
    nextURL,
    serverId: serverSession?.serverId,
    revision: ++serverRouteRevision,
  };
  for (const listener of [...serverRouteChangeListeners]) {
    notifyListener(listener, change, 'route-change');
  }
}

export function subscribeServerRouteRefreshRequests(
  listener: (
    request: ServerRouteRefreshRequest,
  ) => boolean | Promise<boolean>,
): () => void {
  serverRouteRefreshListeners.add(listener);
  return () => serverRouteRefreshListeners.delete(listener);
}

export async function requestServerRouteRefresh(
  request: ServerRouteRefreshRequest,
): Promise<boolean> {
  const results = await Promise.allSettled(
    [...serverRouteRefreshListeners].map(listener =>
      Promise.resolve().then(() => listener(request)),
    ),
  );
  return results.some(
    result => result.status === 'fulfilled' && result.value === true,
  );
}

const sessionStore: SessionStore = {
  get: () => serverSession,
  set: session => {
    publishServerSession(session);
  },
  clear: () => {
    publishServerSession(undefined);
  },
};

/**
 * Runtime identity/capability validation is intentionally before Hosted
 * client construction. Android cannot import this module with an absent or
 * Apple/malformed runtime descriptor and silently inherit the old iOS path.
 */
export const hostedClient = (() => {
  const buildContract = getPorticoBuildContract();
  getPorticoRuntimeDescriptor();
  return createHostedServicesClient({
    accessToken: () => hostedAccessToken ?? '',
    hostedApiBaseUrl: () => buildContract.hostedApiBaseUrl,
  });
})();

export function setHostedAccessToken(value: string | undefined): void {
  hostedAccessToken = value;
}

export function setServerSession(value: StoredServerSession | undefined): void {
  publishServerSession(value);
}

export function getServerSession(): StoredServerSession | undefined {
  return serverSession;
}

export function beginServerSessionEnvironment(): StagedServerSessionEnvironment {
  const previous = viewerEnvironment;
  const generation = previous.generation + 1;
  viewerEnvironment = {accepting: false, generation, scope: undefined};
  const owns = () => viewerEnvironment.generation === generation;
  return {
    generation,
    drain: () => viewerCredentialMutation.catch(() => undefined),
    activate: scope => {
      if (!owns()) throw environmentFenceError();
      assertCredentialMatchesScope(serverSession, scope);
      viewerEnvironment = {accepting: true, generation, scope};
    },
    fence: () => {
      if (!owns()) return;
      viewerEnvironment = {accepting: false, generation, scope: undefined};
    },
    rollback: () => {
      if (!owns()) return;
      viewerEnvironment = previous;
    },
    failClosed: () => {
      if (!owns()) return;
      viewerEnvironment = {
        accepting: false,
        generation: generation + 1,
        scope: undefined,
      };
    },
  };
}

export function fenceServerSessionEnvironment(): Promise<void> {
  const staged = beginServerSessionEnvironment();
  staged.failClosed();
  return staged.drain();
}

export function serverSessionEnvironmentMatches(scope: ViewerScope): boolean {
  return viewerEnvironment.accepting
    && viewerEnvironment.scope !== undefined
    && sameScope(viewerEnvironment.scope, scope);
}

/** Captures the current publication generation for one client lifecycle. */
export function createServerCredentialMutationGate(): {
  run(operation: () => Promise<void>): Promise<void>;
} {
  const generation = viewerEnvironment.generation;
  return {
    run: operation => runViewerCredentialMutation(generation, operation),
  };
}

export function createServerClient(
  platform: PorticoPlatform,
  clientInstanceId: string,
  store: SessionStore = sessionStore,
  credentialAdapter: CredentialAdapter | null = serverCredentialAdapter,
) {
  const environmentBound = store === sessionStore;
  const descriptor = porticoClientDescriptor(platform);
  const playbackClientProfile = (() => {
    const profile = descriptor.capabilities.playback.profile;
    if (profile) return () => profile;
    if (descriptor.runtime !== 'ios' && descriptor.runtime !== 'tvos') {
      throw new PorticoRuntimeDescriptorError(
        'An Android server client cannot fall back to Apple playback capabilities.',
      );
    }
    return () => applePlaybackClientProfile(platform);
  })();
  const generation = viewerEnvironment.generation;
  const credentialMutationGate = createServerCredentialMutationGate();
  const assertEnvironment = () => {
    if (!environmentBound) return;
    if (!viewerEnvironment.accepting
      || viewerEnvironment.generation !== generation) throw environmentFenceError();
  };
  const effectiveStore: SessionStore = environmentBound ? {
    get: () => {
      assertEnvironment();
      return sessionStore.get();
    },
    set: session => {
      assertEnvironment();
      // Refresh can advance policy for the same immutable viewer. The session
      // publication listener synchronously fences this generation and starts
      // authoritative /me reconciliation; cross-viewer credentials remain
      // forbidden here.
      if (viewerEnvironment.scope) {
        assertCredentialMatchesScope(session, viewerEnvironment.scope, false);
      }
      sessionStore.set?.(session);
    },
    clear: () => {
      assertEnvironment();
      sessionStore.clear?.();
    },
  } : store;
  const effectiveCredentialAdapter = environmentBound && credentialAdapter ? {
    load: async () => {
      assertEnvironment();
      const loaded = await credentialAdapter.load?.();
      assertEnvironment();
      return loaded;
    },
    save: (session: LocalServerSession) => credentialMutationGate.run(
      () => credentialAdapter.save(session),
    ),
    clear: () => credentialMutationGate.run(
      () => credentialAdapter.clear?.() ?? Promise.resolve(),
    ),
  } : credentialAdapter;
  return createPorticoClient({
    apiBaseUrl: () => effectiveStore.get()?.apiBaseUrl ?? '',
    hostedApiBaseUrl: () => getPorticoBuildContract().hostedApiBaseUrl,
    sessionStore: effectiveStore,
    credentialAdapter: effectiveCredentialAdapter ?? undefined,
    ...(environmentBound
      ? {transport: {fetch: routeAwareFetch}}
      : {}),
    playbackClientInstanceId: () => clientInstanceId,
    playbackClientProfile,
  });
}

function runViewerCredentialMutation(
  generation: number,
  operation: () => Promise<void>,
): Promise<void> {
  if (
    !viewerEnvironment.accepting ||
    viewerEnvironment.generation !== generation
  ) {
    return Promise.reject(environmentFenceError());
  }
  const mutation = viewerCredentialMutation.catch(() => undefined).then(async () => {
    await operation();
  });
  viewerCredentialMutation = mutation.catch(() => undefined);
  return mutation;
}

function environmentFenceError(): Error {
  const error = new Error(
    'This Portico credential environment is fenced while the active viewing profile changes.',
  );
  error.name = 'ViewerCredentialEnvironmentFencedError';
  return error;
}

function sameScope(left: ViewerScope, right: ViewerScope): boolean {
  return left.authority === right.authority
    && left.accountId === right.accountId
    && left.serverId === right.serverId
    && left.profileId === right.profileId
    && left.authorizationRevision === right.authorizationRevision;
}

function assertCredentialMatchesScope(
  value: LocalServerSession | undefined,
  scope: ViewerScope,
  requireAuthorizationRevision = true,
): void {
  const session = value as (LocalServerSession & {
    authority?: string;
    accountId?: string;
    hostedAccountId?: string;
    profileId?: string;
    authorizationRevision?: string;
    authenticationMode?: string;
  }) | undefined;
  const authority = session?.authority
    ?? (session?.authenticationMode === 'portico-account' ? 'hosted' : 'local');
  const accountId = session?.accountId ?? session?.hostedAccountId;
  if (!session
    || authority !== scope.authority
    || accountId !== scope.accountId
    || session.serverId !== scope.serverId
    || session.profileId !== scope.profileId
    || (requireAuthorizationRevision
      && session.authorizationRevision !== scope.authorizationRevision)) {
    logNativeDiagnostic('credential-scope-mismatch', {
      sessionPresent: Boolean(session),
      authorityMatches: authority === scope.authority,
      accountMatches: accountId === scope.accountId,
      serverMatches: session?.serverId === scope.serverId,
      profileMatches: session?.profileId === scope.profileId,
      authorizationRevisionPresent:
        typeof session?.authorizationRevision === 'string',
      authorizationRevisionMatches:
        session?.authorizationRevision === scope.authorizationRevision,
      revisionRequired: requireAuthorizationRevision,
    });
    throw new Error(
      'The active server credential family does not match its authoritative viewing scope.',
    );
  }
}

export async function connectAccountServer(
  server: HostedServer,
  accountId: string,
  platform: PorticoPlatform,
  clientInstanceId: string,
  selectionEnvelope: HostedProfileSelectionEnvelope,
  stageCandidate: (
    candidate: PreparedTrustedServerConnection,
  ) => Promise<StagedTrustedServerCandidate>,
  signal?: AbortSignal,
  policy: {
    forceFreshRoute?: boolean;
    routePreference?: HostedRoutePreference;
  } = {},
) {
  const descriptor = porticoClientDescriptor(platform);
  const runtime = nativeHostedRuntime();
  const accountSessionStore: Required<Pick<SessionStore, 'set' | 'clear'>> &
    Pick<SessionStore, 'get'> = {
    get: () => serverSession,
    set: session => {
      publishServerSession(hostedServerSession(session, accountId), false);
    },
    clear: () => {
      serverSession = undefined;
    },
  };
  const durableConnectionAdapter = {
    ...trustedServerConnectionAdapter,
    persistencePolicy: 'saved-session' as const,
    save: async (record: PreparedTrustedServerConnection['record']) => {
      const persistedSession = hostedServerSession(record.session, accountId);
      const persistedRecord = {...record, session: persistedSession};
      const mutation = serverActivationMutation.then(async () => {
        const [previousRecord, previousSingleton] = await Promise.all([
          trustedServerConnectionAdapter.load(accountId, server.id),
          serverCredentialAdapter.load?.(),
        ]);
        try {
          await trustedServerConnectionAdapter.save(persistedRecord);
          await serverCredentialAdapter.save(persistedSession);
        } catch (cause) {
          const rollback = await Promise.allSettled([
            previousRecord
              ? trustedServerConnectionAdapter.save(previousRecord)
              : trustedServerConnectionAdapter.remove(accountId, server.id),
            previousSingleton
              ? serverCredentialAdapter.save(previousSingleton)
              : serverCredentialAdapter.clear(),
          ]);
          const rollbackFailures = rollback.flatMap(result =>
            result.status === 'rejected' ? [result.reason] : [],
          );
          if (rollbackFailures.length) {
            throw new TrustedServerDurabilityUncertainError(
              cause,
              rollbackFailures,
            );
          }
          throw cause;
        }
      });
      serverActivationMutation = mutation.catch(() => undefined);
      await mutation;
    },
  };
  const connected = await connectResilientHostedServer(server, {
    accountId,
    connectionAdapter: durableConnectionAdapter,
    hostedClient,
    sessionStore: accountSessionStore,
    createLocalClient: store =>
      createServerClient(platform, clientInstanceId, store, null),
    runtime,
    loadTrustedHostedDocumentKeys: async () =>
      trustedHostedDocumentKeysFromKeySet(
        await hostedClient.documentSigningKeys(),
        runtime,
      ),
    clientIdentity: {
      installationId: clientInstanceId,
      deviceName: descriptor.deviceName,
      app: descriptor.app,
      platform: descriptor.nativePlatform,
    },
    selectionEnvelope,
    routePreference: policy.routePreference ?? 'public-first',
    localRouteCandidates: (candidateServer, document) =>
      verifiedNearbyRoutes(candidateServer, document, signal),
    forceFreshRouteDiscovery: policy.forceFreshRoute,
    signal,
    stageCandidate,
  });
  const persistedSession = hostedServerSession(connected.session, accountId);
  const recordCredentialAdapter = createTrustedServerCredentialAdapter(
    accountId,
    server.id,
    trustedServerConnectionAdapter,
  );
  const durableCredentialAdapter: CredentialAdapter = {
    load: () => recordCredentialAdapter.load(),
    save: async (session: LocalServerSession) => {
      const persisted = hostedServerSession(session, accountId);
      await recordCredentialAdapter.save(persisted);
      await serverCredentialAdapter.save(persisted);
    },
    clear: async () => {
      const results = await Promise.allSettled([
        recordCredentialAdapter.clear(),
        serverCredentialAdapter.clear(),
      ]);
      const failures = results.flatMap(result =>
        result.status === 'rejected' ? [result.reason] : [],
      );
      if (failures.length) {
        throw new AggregateError(
          failures,
          'Portico could not clear every server credential copy.',
        );
      }
    },
    loadPendingRotation: () =>
      serverCredentialAdapter.loadPendingRotation!(),
    savePendingRotation: pending =>
      serverCredentialAdapter.savePendingRotation!(pending),
    clearPendingRotation: () =>
      serverCredentialAdapter.clearPendingRotation!(),
  };
  const localClient = createServerClient(
    platform,
    clientInstanceId,
    sessionStore,
    durableCredentialAdapter,
  );
  return {
    durability: connected.durability,
    durabilityError: connected.durabilityError,
    identity: connected.identity,
    localClient,
    persistencePolicy: connected.persistencePolicy,
    serverSession: persistedSession,
  };
}

/**
 * Re-resolves and atomically publishes a route for the already-authorized
 * Hosted viewer. This deliberately does not create a profile-selection
 * envelope or mint another server credential family.
 */
export async function refreshAccountServerRoute(
  server: HostedServer,
  accountId: string,
  platform: PorticoPlatform,
  clientInstanceId: string,
  stageCandidate: (
    candidate: PreparedTrustedServerConnection,
  ) => Promise<StagedTrustedServerCandidate>,
  signal?: AbortSignal,
) {
  const record = await trustedServerConnectionAdapter.load(accountId, server.id);
  if (!record) {
    throw new Error('The trusted server connection is not available for route recovery.');
  }
  const runtime = nativeHostedRuntime();
  const accountSessionStore: Required<Pick<SessionStore, 'set' | 'clear'>> &
    Pick<SessionStore, 'get'> = {
    get: () => serverSession,
    set: session => {
      publishServerSession(hostedServerSession(session, accountId), false);
    },
    clear: () => {
      serverSession = undefined;
    },
  };
  const durableConnectionAdapter = {
    ...trustedServerConnectionAdapter,
    persistencePolicy: 'saved-session' as const,
    save: async (nextRecord: PreparedTrustedServerConnection['record']) => {
      const persistedSession = hostedServerSession(nextRecord.session, accountId);
      const persistedRecord = {...nextRecord, session: persistedSession};
      const mutation = serverActivationMutation.then(async () => {
        const [previousRecord, previousSingleton] = await Promise.all([
          trustedServerConnectionAdapter.load(accountId, server.id),
          serverCredentialAdapter.load?.(),
        ]);
        try {
          await trustedServerConnectionAdapter.save(persistedRecord);
          await serverCredentialAdapter.save(persistedSession);
        } catch (cause) {
          const rollback = await Promise.allSettled([
            previousRecord
              ? trustedServerConnectionAdapter.save(previousRecord)
              : trustedServerConnectionAdapter.remove(accountId, server.id),
            previousSingleton
              ? serverCredentialAdapter.save(previousSingleton)
              : serverCredentialAdapter.clear(),
          ]);
          const rollbackFailures = rollback.flatMap(result =>
            result.status === 'rejected' ? [result.reason] : [],
          );
          if (rollbackFailures.length) {
            throw new TrustedServerDurabilityUncertainError(
              cause,
              rollbackFailures,
            );
          }
          throw cause;
        }
      });
      serverActivationMutation = mutation.catch(() => undefined);
      await mutation;
    },
  };
  const connected = await refreshTrustedServerRoute(record, server, {
    accountId,
    connectionAdapter: durableConnectionAdapter,
    hostedClient,
    sessionStore: accountSessionStore,
    createLocalClient: store =>
      createServerClient(platform, clientInstanceId, store, null),
    runtime,
    loadTrustedHostedDocumentKeys: async () =>
      trustedHostedDocumentKeysFromKeySet(
        await hostedClient.documentSigningKeys(),
        runtime,
      ),
    routePreference: 'public-first',
    localRouteCandidates: (candidateServer, document) =>
      verifiedNearbyRoutes(candidateServer, document, signal),
    signal,
    stageCandidate,
  });
  return {
    durability: connected.durability,
    durabilityError: connected.durabilityError,
    identity: connected.identity,
    localClient: createServerClient(platform, clientInstanceId),
    persistencePolicy: connected.persistencePolicy,
    serverSession: hostedServerSession(connected.session, accountId),
  };
}

async function verifiedNearbyRoutes(
  candidateServer: HostedServer,
  document: {serverPublicKeyFingerprint: string},
  signal?: AbortSignal,
) {
  const records = await discoverNearbyPorticoServers(1_800, signal);
  const matching = records.filter(record =>
    !record.stale &&
    !record.identityConflict &&
    record.serverId === candidateServer.id &&
    record.serverPublicKeyFingerprint ===
      document.serverPublicKeyFingerprint,
  );
  const routes = matching.flatMap(record =>
    record.routes.map(route => ({...route, quality: 'discovered'})),
  );
  // Deliberately excludes hostnames, addresses, fingerprints, and account
  // data. This diagnostic remains safe in a production device log and tells
  // support whether failure occurred before or after Bonjour identity match.
  const diagnostic = {
    discoveredRecords: records.length,
    identityMatches: matching.length,
    routeCandidates: routes.length,
    serverIdMatched: records.some(record => record.serverId === candidateServer.id),
  };
  logNativeDiagnostic('route-discovery', diagnostic);
  return routes;
}

function publishServerSession(
  value: StoredServerSession | undefined,
  announce = true,
): void {
  const previous = serverSession;
  const previousURL = serverSession?.apiBaseUrl;
  serverSession = value;
  if (!announce) return;
  if (previous !== value) {
    const change: ServerSessionChange = {
      previous,
      current: value,
      revision: ++serverSessionRevision,
    };
    for (const listener of [...serverSessionChangeListeners]) {
      notifyListener(listener, change, 'session-change');
    }
  }
  announceCurrentServerRouteChange(previousURL);
}

function notifyListener<T>(
  listener: (value: T) => void,
  value: T,
  source: string,
): void {
  try {
    listener(value);
  } catch {
    // A subscriber is an extension boundary. One broken surface must not
    // prevent the remaining subscribers from observing the authoritative state.
    logNativeDiagnostic('listener-failure', {source});
  }
}

export async function routeAwareFetch(
  input: string | URL,
  init?: RequestInit,
): Promise<Response> {
  const requestURL = String(input);
  const method = (init?.method || 'GET').toUpperCase();
  const originalRoute = serverSession?.apiBaseUrl;
  try {
    const response = await globalThis.fetch(requestURL, init);
    if (
      !init?.signal?.aborted &&
      shouldRefreshServerRouteForResponse(method, response.status)
    ) {
      const refreshed = await refreshFailedServerRoute(requestURL);
      if (refreshed && !init?.signal?.aborted) {
        return globalThis.fetch(rebaseServerRequestURL(
          requestURL,
          originalRoute,
          serverSession?.apiBaseUrl,
        ), init);
      }
    }
    return response;
  } catch (cause) {
    if (!init?.signal?.aborted && isReplaySafeRouteMethod(method)) {
      const refreshed = await refreshFailedServerRoute(requestURL);
      if (refreshed && !init?.signal?.aborted) {
        return globalThis.fetch(rebaseServerRequestURL(
          requestURL,
          originalRoute,
          serverSession?.apiBaseUrl,
        ), init);
      }
    }
    throw cause;
  }
}

async function refreshFailedServerRoute(failedURL: string): Promise<boolean> {
  if (routeFailureRefreshInFlight) return routeFailureRefreshInFlight;
  const refresh = requestServerRouteRefresh({
    reason: 'route-failure',
    failedURL,
  }).finally(() => {
    if (routeFailureRefreshInFlight === refresh) {
      routeFailureRefreshInFlight = undefined;
    }
  });
  routeFailureRefreshInFlight = refresh;
  return refresh;
}

function rebaseServerRequestURL(
  requestURL: string,
  previousRoute?: string,
  nextRoute?: string,
): string {
  const previous = previousRoute?.replace(/\/+$/, '');
  const next = nextRoute?.replace(/\/+$/, '');
  if (!previous || !next || previous === next) return requestURL;
  if (requestURL !== previous && !requestURL.startsWith(`${previous}/`)) {
    return requestURL;
  }
  return `${next}${requestURL.slice(previous.length)}`;
}

function isReplaySafeRouteMethod(method: string): boolean {
  return method === 'GET' || method === 'HEAD';
}

export function shouldRefreshServerRouteForResponse(
  method: string | undefined,
  status: number,
): boolean {
  const normalizedMethod = (method || 'GET').toUpperCase();
  return (
    isReplaySafeRouteMethod(normalizedMethod) &&
    [421, 502, 503, 504, 521, 522, 523, 524].includes(status)
  );
}

function networkStateIsReachable(state: NativeNetworkRouteState): boolean {
  return state.isConnected !== false && state.isInternetReachable !== false;
}

function nativeHostedRuntime() {
  return {
    fetch: globalThis.fetch,
    decodeBase64: (value: string) => toByteArray(value),
    encodeText: (value: string) =>
      Uint8Array.from(unescape(encodeURIComponent(value)), character =>
        character.charCodeAt(0),
      ),
    verifyEd25519: ({
      publicKey,
      signature,
      message,
    }: {
      publicKey: Uint8Array;
      signature: Uint8Array;
      message: Uint8Array;
    }) => ed25519.verify(signature, message, publicKey),
  };
}
