import React, {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
} from 'react';
import {
  ApiError,
  CredentialCleanupUncertainError,
  type CursorListResponse,
  assertViewerIdentity,
  assertViewerScopeMatchesCredentials,
  createMemorySessionStore,
  defaultAccountServerInstallationPreferences,
  decideProfileSelection,
  parseProfileSelectionGrant,
  sameViewerScope,
  viewerScopeFromAuthMe,
  ViewerRuntimeTeardownError,
  TrustedServerCredentialPublicationError,
  TrustedServerDurabilityUncertainError,
  type HostedAccountProfile,
  type HostedProfileSelectionEnvelope,
  type HostedServer,
  type LocalServerSession,
  type NativeSessionCredentials,
  type PorticoClient,
  type PorticoProfile,
  type ProductMessageId,
  type ProductMessagePresentation,
  type ProfileAccountAuthenticationResponse,
  type ProfileDirectory,
  type ProfileTransitionReason,
  type SessionStore,
  type ViewerScope,
} from '@portico/client-core';
import {
  beginServerSessionEnvironment,
  announceCurrentServerRouteChange,
  connectAccountServer,
  createServerClient,
  fenceServerSessionEnvironment,
  getServerSession,
  hostedClient,
  NativeNetworkRouteRefreshCoordinator,
  requestServerRouteRefresh,
  refreshAccountServerRoute,
  setHostedAccessToken,
  setServerSession,
  serverSessionEnvironmentMatches,
  subscribeServerRouteRefreshRequests,
  subscribeServerSessionChanges,
  type ServerSessionChange,
  type ServerRouteRefreshRequest,
} from './clientEnvironment';
import {
  canRestoreWithoutHostedAccount,
  beginCredentialCleanup,
  deleteAllCredentialsRetainingCleanupBarrier,
  finishCredentialCleanup,
  hostedCredentialStore,
  hostedRefreshRotationStore,
  isHostedAccountServerSession,
  localServerSession,
  retryPendingCredentialCleanup,
  serverCredentialAdapter,
  trustedServerConnectionAdapter,
  type StoredServerSession,
  type HostedRefreshRotationJournal,
} from './secureStorage';
import {
  clientMetadataId,
  optionalInstallationId,
  profileSelectionStore,
  selectedServerStore,
} from './installation';
import {hostedAccountSessionFromTVSetupGrant} from './nearbyTVAuthorization';
import {logNativeDiagnostic} from './nearbyDevices';
import {recordPorticoErrorDiagnostic} from './supportDiagnostics';
import {
  ProductMessageError,
  productErrorPresentation,
  productErrorMessageId,
} from './productErrors';
import {synchronizeActiveProfileLaunchPreference} from './viewerPreferences';
import type {TVSetupGrantPayload} from './tvSetupCrypto';
import type {
  AuthenticationMode,
  HostedAccountSession,
  PorticoPlatform,
} from './types';
import {
  assertPorticoCursorPageInfo,
  assertPorticoProfileSelectionEnvelope,
  porticoClientDescriptor,
} from './types';
import {useViewerRuntime, type ViewerRuntimeCoordinator} from './viewerRuntime';
import {
  activateViewerClient,
  fenceViewerClient,
  guardViewerClient,
} from './viewerSessionPublication';
import {activateHostedPushNotifications} from './pushNotifications';
import {clearRuntimeNotice, publishRuntimeNotice} from './runtimeNotices';

export type AuthStatus =
  | 'booting'
  | 'signed-out'
  | 'connecting'
  | 'selecting-profile'
  | 'selecting-server'
  | 'server-unavailable'
  | 'authenticated';

export type ServerConnectionState =
  | 'unknown'
  | 'connecting'
  | 'reachable'
  | 'unreachable';

export type HostedAccount = HostedAccountSession['user'];

export type PorticoSecondFactor =
  {kind: 'totp'; code: string} | {kind: 'recovery'; code: string};

export type AuthIssuePhase =
  | 'account'
  | 'cloud-directory'
  | 'profile-selection'
  | 'server-connection'
  | 'local-auth';

/**
 * A reviewed, phase-accurate authentication problem. Keeping the complete
 * Product Language presentation prevents clients from combining an unrelated
 * title with another subsystem's body, as the old `serverError` string did.
 */
export interface AuthIssue {
  blocking: boolean;
  phase: AuthIssuePhase;
  presentation: ProductMessagePresentation;
  serverId?: string;
  serverName?: string;
}

export class AccountCreatedSignInRequiredError extends Error {
  readonly code = 'account_created_sign_in_required';
  readonly email: string;

  constructor(email: string) {
    super('Your Portico Account was created. Sign in to continue.');
    this.name = 'AccountCreatedSignInRequiredError';
    this.email = email;
  }
}

export function isAccountCreatedSignInRequired(
  value: unknown,
): value is AccountCreatedSignInRequiredError {
  return (
    value instanceof AccountCreatedSignInRequiredError ||
    (Boolean(value) &&
      typeof value === 'object' &&
      (value as {code?: unknown}).code === 'account_created_sign_in_required')
  );
}

export interface AppSession {
  mode: AuthenticationMode;
  client: PorticoClient;
  serverId: string;
  serverName: string;
  displayName: string;
  viewerScope: ViewerScope;
}

export interface AuthoritativeViewerActivation {
  client: PorticoClient;
  mode: AuthenticationMode;
  platform: PorticoPlatform;
  viewerScope: ViewerScope;
}

interface AuthContextValue {
  status: AuthStatus;
  /** Present as soon as Hosted Services has authenticated a Portico Account. */
  account?: HostedAccount;
  accountDeviceId?: string;
  session?: AppSession;
  /** The server the account most recently attempted to open. */
  selectedServer?: HostedServer;
  error?: string;
  /** A server discovery/connection failure. Never invalidates `account`. */
  serverError?: string;
  /** Structured account/profile/server issue used by recovery and banners. */
  issue?: AuthIssue;
  canAccessOfflineDownloads: boolean;
  warning?: ProductMessageId;
  /** Preselects the only/last-used locked profile without weakening PIN entry. */
  profileAwaitingPINId?: string;
  /** Requests fresh This Server account proof without discarding active A. */
  requiresLocalProfileReauthentication: boolean;
  signInWithPortico(
    login: string,
    password: string,
    secondFactor?: PorticoSecondFactor,
  ): Promise<void>;
  registerPorticoAccount(
    email: string,
    username: string,
    password: string,
  ): Promise<void>;
  requestPasswordReset(email: string): Promise<void>;
  signInWithLocalAuth(
    serverURL: string,
    login: string,
    password: string,
    discoveredIdentity?: {
      serverId?: string;
      serverPublicKeyFingerprint: string;
    },
  ): Promise<void>;
  completeDeviceAuthorization(
    accountCredentials: HostedAccountSession,
  ): Promise<void>;
  completeNearbyTVSetup(grant: TVSetupGrantPayload): Promise<void>;
  chooseServer(server: HostedServer): Promise<void>;
  /** Re-fetches Hosted server access and retries the most recently selected server. */
  retryServerDiscovery(): Promise<void>;
  /** Retries a previously unresolved restart-safe credential cleanup. */
  retrySecureStorageRecovery(): Promise<void>;
  availableServers: HostedServer[];
  /** Verified client connection state; Hosted heartbeat metadata is not used. */
  serverConnectionStates: Readonly<Record<string, ServerConnectionState>>;
  availableProfiles: PorticoProfile[];
  beginProfileSelection(): Promise<void>;
  cancelLocalProfileReauthentication(): void;
  chooseProfile(profileId: string, pin?: string): Promise<void>;
  signOut(): Promise<void>;
  refreshPorticoAccount(): Promise<void>;
  clearError(): void;
}

const AuthContext = createContext<AuthContextValue | undefined>(undefined);

interface AuthOperation {
  controller: AbortController;
  generation: number;
  previous: Promise<void>;
  signal: AbortSignal;
}

/** Per-request page size only; every opaque continuation is followed. */
export const HOSTED_SERVER_DIRECTORY_PAGE_SIZE = 100 as const;

export async function loadAllHostedServers(
  fetchPage: (
    params: {limit: typeof HOSTED_SERVER_DIRECTORY_PAGE_SIZE; cursor?: string},
  ) => Promise<CursorListResponse<HostedServer>>,
): Promise<HostedServer[]> {
  const servers: HostedServer[] = [];
  const seenCursors = new Set<string>();
  let cursor: string | undefined;

  while (true) {
    const page = await fetchPage({
      limit: HOSTED_SERVER_DIRECTORY_PAGE_SIZE,
      ...(cursor ? {cursor} : {}),
    });
    if (!Array.isArray(page.items)) {
      throw new Error('The Hosted server directory returned an invalid item list.');
    }
    const pageInfo = assertPorticoCursorPageInfo(page.pageInfo);
    servers.push(...page.items);
    if (!pageInfo.hasMore) return servers;
    const nextCursor = pageInfo.nextCursor;
    if (!nextCursor || seenCursors.has(nextCursor)) {
      throw new Error('The Hosted server directory returned a repeated cursor.');
    }
    seenCursors.add(nextCursor);
    cursor = nextCursor;
  }
}

interface PendingLocalAuthentication {
  authentication: ProfileAccountAuthenticationResponse;
  client: PorticoClient;
  directory: ProfileDirectory;
  discoveredServerId?: string;
  instanceId: string;
  provisionalStore: SessionStore;
  serverName: string;
}

class AuthOperationAbortedError extends Error {
  constructor() {
    super('The server or profile selection was replaced by a newer choice.');
    this.name = 'AbortError';
  }
}

const AUTH_SECURITY_DEADLINE_MS = 5_000;

export function PorticoAuthProvider({
  children,
  platform,
  onAuthoritativeViewerActivation,
}: {
  children: React.ReactNode;
  platform: PorticoPlatform;
  /**
   * Runs only after final /me, credential/runtime publication, and the
   * synchronous AppSession fence all agree. Preference/trust integration may
   * record this fact but cannot use it as authentication authority.
   */
  onAuthoritativeViewerActivation?: (
    activation: AuthoritativeViewerActivation,
  ) => void | Promise<void>;
}) {
  const viewerRuntime = useViewerRuntime();
  const viewerRuntimeSnapshot = useSyncExternalStore(
    viewerRuntime.subscribe,
    viewerRuntime.getSnapshot,
    viewerRuntime.getSnapshot,
  );
  const [status, setStatus] = useState<AuthStatus>('booting');
  const [account, setAccount] = useState<HostedAccount>();
  const [session, setSession] = useState<AppSession>();
  const [selectedServer, setSelectedServer] = useState<HostedServer>();
  const [error, setError] = useState<string>();
  const [serverError, setServerError] = useState<string>();
  const [issue, setIssue] = useState<AuthIssue>();
  const [warning, setWarning] = useState<ProductMessageId>();
  const [availableServers, setAvailableServers] = useState<HostedServer[]>([]);
  const [serverConnectionStates, setServerConnectionStates] = useState<
    Record<string, ServerConnectionState>
  >({});
  const [availableProfiles, setAvailableProfiles] = useState<PorticoProfile[]>(
    [],
  );
  const [profileAwaitingPINId, setProfileAwaitingPINId] = useState<string>();
  const [
    requiresLocalProfileReauthentication,
    setRequiresLocalProfileReauthentication,
  ] = useState(false);
  const restoreStarted = useRef(false);
  const sessionRef = useRef<AppSession | undefined>(undefined);
  const accountRef = useRef<HostedAccount | undefined>(undefined);
  const hostedSessionRef = useRef<HostedAccountSession | undefined>(undefined);
  const selectedServerRef = useRef<HostedServer | undefined>(undefined);
  const issueRef = useRef<AuthIssue | undefined>(undefined);
  const pendingLocalAuthentication = useRef<
    PendingLocalAuthentication | undefined
  >(undefined);
  const pendingHostedServer = useRef<
    | {accountId: string; candidate: HostedServer; previous?: HostedServer}
    | undefined
  >(undefined);
  const replacementPreviousServer = useRef<HostedServer | undefined>(undefined);
  const routeRefreshInFlight = useRef<Promise<boolean> | undefined>(undefined);
  const operationState = useRef<{
    blockingFailure?: unknown;
    controller?: AbortController;
    generation: number;
    tail: Promise<void>;
  }>({generation: 0, tail: Promise.resolve()});

  accountRef.current = account;
  selectedServerRef.current = selectedServer;
  issueRef.current = issue;

  const clearIssue = useCallback(() => {
    issueRef.current = undefined;
    setIssue(undefined);
    setServerError(undefined);
  }, []);

  const publishIssue = useCallback(
    (
      cause: unknown,
      fallbackId: ProductMessageId,
      phase: AuthIssuePhase,
      variables: Readonly<Record<string, string | number | undefined>> = {},
      options: {blocking?: boolean; server?: HostedServer} = {},
    ) => {
      const presentation = productErrorPresentation(
        cause,
        fallbackId,
        variables,
      );
      const next: AuthIssue = {
        blocking: options.blocking ?? !sessionRef.current,
        phase,
        presentation,
        ...(options.server
          ? {serverId: options.server.id, serverName: options.server.name}
          : {}),
      };
      issueRef.current = next;
      setIssue(next);
      setServerError(
        presentation.body ?? presentation.text ?? presentation.title ?? '',
      );
      return next;
    },
    [],
  );

  useEffect(() => {
    if (platform !== 'mobile' || !account?.id) return undefined;
    return activateHostedPushNotifications();
  }, [account?.id, platform]);

  const publishSession = useCallback((next?: AppSession) => {
    const previous = sessionRef.current;
    if (!next) {
      fenceViewerClient(previous?.client);
      sessionRef.current = undefined;
      setSession(undefined);
      return;
    }
    const snapshot = viewerRuntime.getSnapshot();
    if (!snapshot.scope
      || !snapshot.acceptingWrites
      || snapshot.transitioning
      || !sameViewerScope(snapshot.scope, next.viewerScope)) {
      throw new Error(
        'Portico cannot publish an AppSession outside its authoritative viewer runtime.',
      );
    }
    if (!serverSessionEnvironmentMatches(next.viewerScope)) {
      throw new Error(
        'Portico cannot publish an AppSession outside its authoritative credential environment.',
      );
    }
    // The ref is the synchronous UI/session fence. Only after it names B may
    // B's guarded client open; A's client was fenced before credential change.
    sessionRef.current = next;
    try {
      activateViewerClient(next.client, next.viewerScope);
    } catch (cause) {
      sessionRef.current = previous;
      throw cause;
    }
    setSession(next);
  }, [viewerRuntime]);

  const guardClient = useCallback((client: PorticoClient, scope: ViewerScope) =>
    guardViewerClient(client, scope, viewerRuntime.getSnapshot), [viewerRuntime]);

  const notifyAuthoritativeViewerActivation = useCallback(
    (next: AppSession) => {
      const snapshot = viewerRuntime.getSnapshot();
      if (sessionRef.current !== next
        || !snapshot.scope
        || !snapshot.acceptingWrites
        || snapshot.transitioning
        || !sameViewerScope(snapshot.scope, next.viewerScope)) return;
      void Promise.resolve(onAuthoritativeViewerActivation?.({
        client: next.client,
        mode: next.mode,
        platform,
        viewerScope: next.viewerScope,
      })).catch(() => undefined);
    },
    [onAuthoritativeViewerActivation, platform, viewerRuntime],
  );

  // React may retain A's rendered tree for a frame while a transaction is in
  // flight. Never expose that stale AppSession through context: runtime and
  // AppSession become observable only when both name the same live scope.
  const observableSession = session
    && viewerRuntimeSnapshot.acceptingWrites
    && !viewerRuntimeSnapshot.transitioning
    && viewerRuntimeSnapshot.scope
    && sameViewerScope(session.viewerScope, viewerRuntimeSnapshot.scope)
    ? session
    : undefined;

  const beginOperation = useCallback((): AuthOperation => {
    operationState.current.controller?.abort();
    const controller = new AbortController();
    const generation = operationState.current.generation + 1;
    const operation: AuthOperation = {
      controller,
      generation,
      previous: operationState.current.tail,
      signal: controller.signal,
    };
    operationState.current.controller = controller;
    operationState.current.generation = generation;
    return operation;
  }, []);

  const runLatest = useCallback(
    <T,>(operation: AuthOperation, task: () => Promise<T>): Promise<T> => {
      let rejectedByExistingSecurityLatch = false;
      const running = operation.previous
        .catch(() => undefined)
        .then(async () => {
          assertAuthOperation(operation, operationState.current);
          if (operationState.current.blockingFailure) {
            const cleanupOutcome = await settleBeforeDeadline(
              retryPendingCredentialCleanup(),
            );
            assertAuthOperation(operation, operationState.current);
            if (cleanupOutcome.timedOut) {
              rejectedByExistingSecurityLatch = true;
              throw operationState.current.blockingFailure;
            }
            if (cleanupOutcome.status === 'rejected') {
              operationState.current.blockingFailure = cleanupOutcome.reason;
              rejectedByExistingSecurityLatch = true;
              throw cleanupOutcome.reason;
            }
            operationState.current.blockingFailure = undefined;
            viewerRuntime.forceClosed();
            setWarning(undefined);
          }
          return task();
        });
      const settled = running.catch(async cause => {
          if (
            !rejectedByExistingSecurityLatch &&
            isSecurityCriticalAuthFailure(cause)
          ) {
            logAuthDiagnostic('security-quarantine', cause);
            operationState.current.blockingFailure = cause;
            viewerRuntime.forceClosed(cause);
            const cleanupScope = {
              authority:
                sessionRef.current?.viewerScope.authority ??
                (accountRef.current
                  ? ('hosted' as const)
                  : ('unknown' as const)),
              accountId:
                sessionRef.current?.viewerScope.accountId ??
                accountRef.current?.id,
              serverId: sessionRef.current?.viewerScope.serverId,
            };
            hostedSessionRef.current = undefined;
            pendingLocalAuthentication.current = undefined;
            pendingHostedServer.current = undefined;
            replacementPreviousServer.current = undefined;
            setHostedAccessToken(undefined);
            setServerSession(undefined);
            publishSession(undefined);
            accountRef.current = undefined;
            setAccount(undefined);
            selectedServerRef.current = undefined;
            setSelectedServer(undefined);
            setAvailableServers([]);
            setServerConnectionStates({});
            setAvailableProfiles([]);
            setProfileAwaitingPINId(undefined);
            setRequiresLocalProfileReauthentication(false);
            setError(undefined);
            issueRef.current = undefined;
            setIssue(undefined);
            setServerError(undefined);
            setStatus('signed-out');
            setWarning('auth.sign-out-storage-warning');
            try {
              await quarantineAllCredentials(cleanupScope);
              // The viewer transaction failed closed, but every durable
              // credential and cleanup barrier is now verified absent. Do not
              // turn a recovered incident into a permanent authentication lock.
              operationState.current.blockingFailure = undefined;
              viewerRuntime.forceClosed();
              setWarning(undefined);
            } catch (cleanupCause) {
              operationState.current.blockingFailure = new AggregateError(
                [cause, cleanupCause],
                'Portico cannot authenticate until secure credential cleanup succeeds.',
              );
            }
          }
          // Do not reject the user-facing operation until any required durable
          // quarantine has settled. Returning `running` here previously let a
          // caller (and the UI) continue while the rejection handler was still
          // publishing a restart cleanup barrier in the background. A force
          // close in that window made the next launch erase a subsequently
          // valid account as though sign-out were incomplete.
          throw cause;
        });
      operationState.current.tail = settled.then(
        () => undefined,
        () => undefined,
      );
      return settled;
    },
    [publishSession, viewerRuntime],
  );

  const connectStoredServer = useCallback(
    async (stored: LocalServerSession, operation: AuthOperation) => {
      const previousSession = sessionRef.current;
      setStatus('connecting');
      clearIssue();
      try {
        const instanceId = await awaitAuthProducer(
          clientMetadataId(),
          operation.signal,
        );
        assertAuthOperation(operation, operationState.current);
        const provisionalStore = createMemorySessionStore(stored);
        const verificationClient = createServerClient(
          platform,
          instanceId,
          provisionalStore,
          null,
        );
        await awaitAuthProducer(
          verificationClient.checkServerCompatibility({
            signal: operation.signal,
          }),
          operation.signal,
        );
        const identity = await awaitAuthProducer(
          verificationClient.me({signal: operation.signal}),
          operation.signal,
        );
        if (!identity.authenticated || !identity.user)
          throw new Error('Your server session has expired.');
        await awaitAuthProducer(
          verificationClient.checkCompatibility({signal: operation.signal}),
          operation.signal,
        );
        const verified = provisionalStore.get?.() as
          StoredServerSession | undefined;
        if (
          !verified?.accessToken ||
          !verified.refreshToken ||
          !verified.apiBaseUrl
        ) {
          throw new Error(
            'The verified server session did not retain a complete credential family.',
          );
        }
        if (!isScopeBoundStoredSession(verified)) {
          throw new Error(
            'The saved server session is not bound to an authority, account, server, profile, and authorization revision.',
          );
        }
        const viewerScope = assertViewerScopeMatchesCredentials(
          identity,
          verified,
        );
        assertStoredSessionViewerScope(verified, viewerScope);
        assertAuthOperation(operation, operationState.current);
        const previousDurable = await awaitAuthProducer(
          Promise.resolve(serverCredentialAdapter.load?.()),
          operation.signal,
        );
        assertAuthOperation(operation, operationState.current);
        // Fence A's AppSession client before viewerRuntime can drain work and
        // before any B credential enters the global environment.
        const environmentStage = beginServerSessionEnvironment();
        publishSession(undefined);
        let staged: Awaited<ReturnType<ViewerRuntimeCoordinator['stage']>>;
        try {
          staged = await viewerRuntime.stage(
            viewerScope,
            viewerTransitionReason(
              viewerRuntime.getSnapshot().scope,
              viewerScope,
            ),
          );
          await environmentStage.drain();
        } catch (cause) {
          environmentStage.failClosed();
          throw cause;
        }
        const previousGlobal = getServerSession();
        const previousHostedAccessToken = hostedSessionRef.current?.accessToken;
        try {
          await serverCredentialAdapter.save(verified);
          const persisted = await serverCredentialAdapter.load?.();
          if (!sameCredentialFamily(persisted, verified)) {
            throw new Error(
              'The verified server credential rotation was not committed to secure storage.',
            );
          }
          assertAuthOperation(operation, operationState.current);
          if (!isHostedAccountServerSession(verified))
            setHostedAccessToken(undefined);
          setServerSession(verified);
          await staged.publish();
          environmentStage.activate(viewerScope);
          assertAuthOperation(operation, operationState.current);
          const client = guardClient(
            createServerClient(platform, instanceId),
            viewerScope,
          );
          const nextSession: AppSession = {
            mode:
              verified.authenticationMode === 'portico-account' ||
              verified.routeType === 'hosted-nearby-setup'
                ? 'portico-account'
                : 'local',
            client,
            serverId: viewerScope.serverId,
            serverName: verified.serverName ?? 'Portico Server',
            displayName: identity.user.displayName,
            viewerScope,
          };
          publishSession(nextSession);
          notifyAuthoritativeViewerActivation(nextSession);
          clearIssue();
          setStatus('authenticated');
        } catch (cause) {
          // A candidate can be aborted immediately after publication. Fence it
          // synchronously, then restore credentials before making A runnable.
          staged.fence();
          environmentStage.fence();
          const credentialRollbackFailures: unknown[] = [];
          try {
            if (previousDurable) {
              await serverCredentialAdapter.save(previousDurable);
              const restored = await serverCredentialAdapter.load?.();
              if (!sameCredentialFamily(restored, previousDurable)) {
                throw new Error(
                  'Portico could not verify restoration of the previous server credential family.',
                );
              }
            } else {
              await serverCredentialAdapter.clear();
            }
          } catch (rollbackCause) {
            credentialRollbackFailures.push(rollbackCause);
          }
          try {
            setServerSession(previousGlobal);
            setHostedAccessToken(previousHostedAccessToken);
          } catch (rollbackCause) {
            credentialRollbackFailures.push(rollbackCause);
          }
          if (credentialRollbackFailures.length) {
            const safeClear = await Promise.allSettled([
              serverCredentialAdapter.clear(),
            ]);
            setServerSession(undefined);
            setHostedAccessToken(undefined);
            await Promise.resolve(staged.rollback('fail-closed')).catch(
              () => undefined,
            );
            environmentStage.failClosed();
            viewerRuntime.forceClosed(cause);
            throw new AggregateError(
              [
                cause,
                ...credentialRollbackFailures,
                ...safeClear.flatMap(result =>
                  result.status === 'rejected' ? [result.reason] : [],
                ),
              ],
              'Portico could not restore or safely clear the previous verified server session.',
            );
          }
          try {
            await staged.rollback('restore-previous');
            environmentStage.rollback();
          } catch (rollbackCause) {
            const safeClear = await Promise.allSettled([
              serverCredentialAdapter.clear(),
            ]);
            setServerSession(undefined);
            setHostedAccessToken(undefined);
            viewerRuntime.forceClosed(rollbackCause);
            environmentStage.failClosed();
            throw new AggregateError(
              [
                cause,
                rollbackCause,
                ...safeClear.flatMap(result =>
                  result.status === 'rejected' ? [result.reason] : [],
                ),
              ],
              'Portico could not restore the previous viewer after credential compensation.',
            );
          }
          throw cause;
        }
      } catch (cause) {
        if (isAuthOperationAborted(cause)) throw cause;
        if (isSecurityCriticalAuthFailure(cause)) {
          viewerRuntime.forceClosed(cause);
          setHostedAccessToken(undefined);
          setServerSession(undefined);
          publishSession(undefined);
          setStatus(accountRef.current ? 'server-unavailable' : 'signed-out');
          throw cause;
        }
        const runtimeScope = viewerRuntime.getSnapshot().scope;
        const previousStillActive = Boolean(
          previousSession &&
          runtimeScope &&
          viewerRuntime.getSnapshot().acceptingWrites &&
          sameViewerScope(previousSession.viewerScope, runtimeScope) &&
          serverSessionEnvironmentMatches(previousSession.viewerScope),
        );
        publishSession(previousStillActive ? previousSession : undefined);
        if (previousStillActive && replacementPreviousServer.current) {
          selectedServerRef.current = replacementPreviousServer.current;
          setSelectedServer(replacementPreviousServer.current);
        }
        publishIssue(
          cause,
          'problem.server-unavailable',
          'server-connection',
          {serverName: stored.serverName ?? 'this server'},
          {blocking: !previousStillActive},
        );
        setStatus(previousStillActive ? 'authenticated' : 'server-unavailable');
      }
    },
    [
      guardClient,
      clearIssue,
      notifyAuthoritativeViewerActivation,
      platform,
      publishSession,
      publishIssue,
      viewerRuntime,
    ],
  );

  const connectServer = useCallback(
    async (
      server: HostedServer,
      accountId: string,
      instanceId: string,
      selectionEnvelope: HostedProfileSelectionEnvelope | undefined,
      operation: AuthOperation,
      connectionPolicy: {
        backgroundRouteRefresh?: boolean;
        forceFreshRoute?: boolean;
      } = {},
    ) => {
      const previousSession = sessionRef.current;
      const previousServer = selectedServerRef.current;
      if (!previousSession) setStatus('connecting');
      if (!connectionPolicy.backgroundRouteRefresh) clearIssue();
      if (!connectionPolicy.backgroundRouteRefresh) {
        setServerConnectionStates(current => ({
          ...current,
          [server.id]: 'connecting',
        }));
      }
      let environmentStage:
        | ReturnType<typeof beginServerSessionEnvironment>
        | undefined;
      try {
        let publishedScope: ViewerScope | undefined;
        let publishedSession: AppSession | undefined;
        let candidateTransactionStarted = false;
        const stageCandidate = async (candidate: Parameters<
          Parameters<typeof connectAccountServer>[5]
        >[0]) => {
            candidateTransactionStarted = true;
            assertAuthOperation(operation, operationState.current);
            if (!candidate.identity.authenticated || !candidate.identity.user) {
              throw new Error(
                'The server did not create a usable viewer session.',
              );
            }
            const candidateScope = viewerScopeFromAuthMe(candidate.identity);
            const expectedProfileId =
              selectionEnvelope?.profileId ?? previousSession?.viewerScope.profileId;
            if (!expectedProfileId) {
              throw new Error('Route recovery requires an active viewing profile.');
            }
            assertViewerIdentity(candidateScope, {
              authority: 'hosted',
              accountId,
              serverId: server.id,
              profileId: expectedProfileId,
            });
            if (!sameViewerScope(candidate.scope, candidateScope)) {
              throw new Error(
                'The candidate runtime scope did not match the final server identity.',
              );
            }
            const sameViewerRouteReplacement = Boolean(
              connectionPolicy.backgroundRouteRefresh &&
              previousSession &&
              sameViewerScope(previousSession.viewerScope, candidateScope) &&
              serverSessionEnvironmentMatches(candidateScope) &&
              viewerRuntime.getSnapshot().acceptingWrites,
            );
            if (sameViewerRouteReplacement) {
              const previousRouteURL = getServerSession()?.apiBaseUrl;
              publishedSession = previousSession;
              publishedScope = candidateScope;
              return {
                publish: () => {
                  notifyAuthoritativeViewerActivation(previousSession!);
                  announceCurrentServerRouteChange(previousRouteURL);
                },
                fenceRollback: (mode?: 'restore-previous' | 'fail-closed') => {
                  if (mode === 'fail-closed') {
                    void fenceServerSessionEnvironment();
                    publishSession(undefined);
                  }
                },
                rollback: (mode?: 'restore-previous' | 'fail-closed') => {
                  publishSession(mode === 'fail-closed' ? undefined : previousSession);
                },
              };
            }
            environmentStage = beginServerSessionEnvironment();
            publishSession(undefined);
            let staged: Awaited<ReturnType<ViewerRuntimeCoordinator['stage']>>;
            try {
              staged = await viewerRuntime.stage(
                candidateScope,
                viewerTransitionReason(
                  viewerRuntime.getSnapshot().scope,
                  candidateScope,
                ),
              );
              await environmentStage.drain();
            } catch (cause) {
              environmentStage.failClosed();
              throw cause;
            }
            try {
              assertAuthOperation(operation, operationState.current);
            } catch (cause) {
              staged.fence();
              environmentStage.fence();
              try {
                await staged.rollback('restore-previous');
                environmentStage.rollback();
              } catch (rollbackCause) {
                environmentStage.failClosed();
                viewerRuntime.forceClosed(rollbackCause);
              }
              throw cause;
            }
            return {
              publish: async () => {
                assertAuthOperation(operation, operationState.current);
                await staged.publish();
                environmentStage!.activate(candidateScope);
                const nextSession: AppSession = {
                  mode: 'portico-account',
                  client: guardClient(
                    createServerClient(platform, instanceId),
                    candidateScope,
                  ),
                  serverId: candidateScope.serverId,
                  serverName: server.name,
                  displayName: candidate.identity.user!.displayName,
                  viewerScope: candidateScope,
                };
                publishSession(nextSession);
                notifyAuthoritativeViewerActivation(nextSession);
                publishedSession = nextSession;
                publishedScope = candidateScope;
              },
              fenceRollback: () => {
                if (publishedSession) publishSession(undefined);
                environmentStage!.fence();
                staged.fence();
              },
              rollback: async (mode?: 'restore-previous' | 'fail-closed') => {
                environmentStage!.fence();
                await staged.rollback(mode);
                if (mode === 'fail-closed') {
                  environmentStage!.failClosed();
                  publishSession(undefined);
                } else {
                  environmentStage!.rollback();
                  publishSession(previousSession);
                  if (previousSession) {
                    notifyAuthoritativeViewerActivation(previousSession);
                  }
                }
              },
            };
          };
        const coreConnection = connectionPolicy.backgroundRouteRefresh
          ? refreshAccountServerRoute(
              server,
              accountId,
              platform,
              instanceId,
              stageCandidate,
              operation.signal,
            )
          : connectAccountServer(
          server,
          accountId,
          platform,
          instanceId,
          selectionEnvelope!,
          stageCandidate,
          operation.signal,
          {
            forceFreshRoute: connectionPolicy.forceFreshRoute,
            routePreference: 'public-first',
          },
        );
        const connected = await awaitIsolatedAuthProducer(
          coreConnection,
          operation.signal,
          () => candidateTransactionStarted,
        );
        if (!connected.serverSession || !connected.identity.user)
          throw new Error('The server did not create a usable viewer session.');
        const viewerScope = viewerScopeFromAuthMe(connected.identity);
        if (!publishedScope || !sameViewerScope(publishedScope, viewerScope)) {
          throw new Error(
            'The server connection was not activated for its verified viewing scope.',
          );
        }
        assertAuthOperation(operation, operationState.current);
        if (!publishedSession
          || sessionRef.current !== publishedSession
          || !sameViewerScope(publishedSession.viewerScope, viewerScope)) {
          throw new Error(
            'The authoritative server transaction did not publish its AppSession.',
          );
        }
        selectedServerRef.current = server;
        setSelectedServer(server);
        setServerConnectionStates(current => ({
          ...current,
          [server.id]: 'reachable',
        }));
        if (
          pendingHostedServer.current?.candidate.id === server.id &&
          pendingHostedServer.current.accountId === accountId
        ) {
          pendingHostedServer.current = undefined;
        }
        replacementPreviousServer.current = undefined;
        const preferenceIdentity = {
          authority: viewerScope.authority,
          accountId: viewerScope.accountId,
          serverId: viewerScope.serverId,
          profileId: viewerScope.profileId,
          deviceClass:
            platform === 'tv'
              ? ('television' as const)
              : ('mobile' as const),
          installationId: instanceId,
        };
        let preferenceBookkeepingFailed = false;
        if (!connectionPolicy.backgroundRouteRefresh) {
          try {
            await awaitAuthProducer(
              synchronizeActiveProfileLaunchPreference(
                connected.localClient,
                preferenceIdentity,
                profileSelectionStore,
                {
                  signal: operation.signal,
                  isCurrent: () =>
                    operation.generation === operationState.current.generation &&
                    operation.controller === operationState.current.controller &&
                    !operation.signal.aborted,
                },
              ),
              operation.signal,
            );
          } catch (preferenceFailure) {
            if (isAuthOperationAborted(preferenceFailure)) throw preferenceFailure;
            logAuthDiagnostic('launch-preference', preferenceFailure);
            // Launch preference recording is convenience state, not authentication
            // authority. Keep the verified viewer live and let Settings retry it.
            preferenceBookkeepingFailed = true;
          }
        }
        assertAuthOperation(operation, operationState.current);
        if (!connectionPolicy.backgroundRouteRefresh) clearIssue();
        setStatus('authenticated');
        if (!connectionPolicy.backgroundRouteRefresh) {
          const routineNotice = connected.durability === 'memory-only'
            ? 'connection.not-saved'
            : preferenceBookkeepingFailed
              ? 'preferences.request-failed'
              : undefined;
          setWarning(routineNotice);
          if (routineNotice) {
            publishRuntimeNotice('authenticated-session-health', routineNotice);
          } else {
            clearRuntimeNotice('authenticated-session-health');
          }
          void Promise.resolve()
            .then(() => {
              assertAuthOperation(operation, operationState.current);
              return selectedServerStore.set(server.id);
            })
            .catch(() => undefined);
        }
        return viewerScope;
      } catch (cause) {
        if (isAuthOperationAborted(cause)) throw cause;
        logAuthDiagnostic('server-connection', cause);
        assertAuthOperation(operation, operationState.current);
        const runtimeSnapshot = viewerRuntime.getSnapshot();
        const previousStillActive = Boolean(
          previousSession &&
          runtimeSnapshot.scope &&
          !runtimeSnapshot.transitionFailure &&
          runtimeSnapshot.acceptingWrites &&
          sameViewerScope(previousSession.viewerScope, runtimeSnapshot.scope) &&
          serverSessionEnvironmentMatches(previousSession.viewerScope),
        );
        if (previousStillActive) environmentStage?.rollback();
        else environmentStage?.failClosed();
        publishSession(previousStillActive ? previousSession : undefined);
        if (
          pendingHostedServer.current?.candidate.id === server.id &&
          pendingHostedServer.current.accountId === accountId
        ) {
          pendingHostedServer.current = undefined;
          selectedServerRef.current = previousServer;
          setSelectedServer(previousServer);
        }
        if (!connectionPolicy.backgroundRouteRefresh || !previousStillActive) {
          publishIssue(
            cause,
            'problem.server-unavailable',
            'server-connection',
            {serverName: server.name},
            {blocking: !previousStillActive, server},
          );
        }
        setStatus(previousStillActive ? 'authenticated' : 'server-unavailable');
        setServerConnectionStates(current => ({
          ...current,
          [server.id]: previousStillActive ? 'reachable' : 'unreachable',
        }));
        throw cause;
      }
    },
    [
      guardClient,
      clearIssue,
      notifyAuthoritativeViewerActivation,
      platform,
      publishSession,
      publishIssue,
      viewerRuntime,
    ],
  );

  const openHostedProfile = useCallback(
    async (
      server: HostedServer,
      accountId: string,
      profileId: string,
      operation: AuthOperation,
      pin?: string,
      connectionPolicy: {
        backgroundRouteRefresh?: boolean;
        forceFreshRoute?: boolean;
      } = {},
    ) => {
      const instanceId = await awaitAuthProducer(
        clientMetadataId(),
        operation.signal,
      );
      assertAuthOperation(operation, operationState.current);
      const selectionEnvelope = await awaitAuthProducer(
        hostedClient.createProfileSelectionEnvelope(
          profileId,
          {
            serverId: server.id,
            ...(pin?.trim() ? {pin: pin.trim()} : {}),
          },
          {signal: operation.signal},
        ),
        operation.signal,
      );
      assertAuthOperation(operation, operationState.current);
      assertPorticoProfileSelectionEnvelope(selectionEnvelope, {
        accountId,
        serverId: server.id,
        profileId,
      });
      if (
        selectionEnvelope.accountId !== accountId ||
        selectionEnvelope.profileId !== profileId ||
        selectionEnvelope.serverId !== server.id
      ) {
        throw new Error(
          'Hosted Services returned a profile selection for a different account, server, or profile.',
        );
      }
      const viewerScope = await connectServer(
        server,
        accountId,
        instanceId,
        selectionEnvelope,
        operation,
        connectionPolicy,
      );
      assertAuthOperation(operation, operationState.current);
      void Promise.resolve()
        .then(() => {
          assertAuthOperation(operation, operationState.current);
          return profileSelectionStore.recordVerifiedSelection(
            {
              authority: viewerScope.authority,
              accountId: viewerScope.accountId,
              serverId: viewerScope.serverId,
              installationId: instanceId,
              profileId: viewerScope.profileId,
            },
            platform,
          );
        })
        .catch(() => undefined);
    },
    [connectServer, platform],
  );

  const prepareHostedProfileSelection = useCallback(
    async (
      server: HostedServer,
      accountId: string,
      profiles: HostedAccountProfile[],
      operation: AuthOperation,
    ) => {
      assertAuthOperation(operation, operationState.current);
      const directory: ProfileDirectory = {
        authority: 'hosted',
        accountId,
        serverId: server.id,
        profilesAllowed: true,
        profiles,
      };
      const scopedInstallationId = await awaitAuthProducer(
        clientMetadataId(),
        operation.signal,
      );
      assertAuthOperation(operation, operationState.current);
      const preferences = await awaitAuthProducer(
        profileSelectionStore
          .get(
            {
              authority: 'hosted',
              accountId,
              serverId: server.id,
              installationId: scopedInstallationId,
            },
            platform,
          )
          .catch(() => ({
            ...defaultAccountServerInstallationPreferences(
              platform === 'tv' ? 'television' : 'mobile',
            ),
            // Storage failure cannot authorize an automatic profile choice.
            profileSelection: 'ask' as const,
          })),
        operation.signal,
      );
      assertAuthOperation(operation, operationState.current);
      const decision = decideProfileSelection(directory, preferences);
      pendingHostedServer.current = {
        accountId,
        candidate: server,
        previous: selectedServerRef.current,
      };
      setAvailableProfiles(
        [...directory.profiles].sort(
          (left, right) => left.sortOrder - right.sortOrder,
        ),
      );
      setProfileAwaitingPINId(undefined);
      if (decision.kind === 'unavailable') {
        pendingHostedServer.current = undefined;
        publishIssue(
          new ProductMessageError('auth.profile-not-available'),
          'auth.profile-not-available',
          'profile-selection',
          {},
          {blocking: !sessionRef.current, server},
        );
        setStatus(sessionRef.current ? 'authenticated' : 'server-unavailable');
        return;
      }
      if (decision.kind === 'open') {
        await openHostedProfile(
          server,
          accountId,
          decision.profile.id,
          operation,
        );
        return;
      }
      if (decision.kind === 'pin') {
        setProfileAwaitingPINId(decision.profile.id);
      }
      setStatus('selecting-profile');
    },
    [openHostedProfile, platform, publishIssue],
  );

  const loadHostedServers = useCallback(
    async (
      operation: AuthOperation,
      preferredServerId?: string,
      accountId = accountRef.current?.id,
      requirePreferredServer = false,
    ) => {
      let serverDirectoryLoaded = false;
      let attemptedServerName = 'this server';
      try {
        if (!accountId) {
          throw new Error(
            'Sign in to a Portico Account before opening a server.',
          );
        }
        const [servers, profileDirectory] = await Promise.all([
          loadAllHostedServers(params =>
            awaitAuthProducer(
              hostedClient.servers(params, {signal: operation.signal}),
              operation.signal,
            ),
          ),
          awaitAuthProducer(
            hostedClient.profiles({signal: operation.signal}),
            operation.signal,
          ),
        ]);
        assertAuthOperation(operation, operationState.current);
        serverDirectoryLoaded = true;
        if (profileDirectory.accountId !== accountId) {
          throw new Error(
            'Hosted Services returned profiles for a different Portico Account.',
          );
        }
        setAvailableServers(servers);
        setServerConnectionStates(current => Object.fromEntries(
          servers.map(server => [
            server.id,
            current[server.id] ?? 'unknown',
          ]),
        ));
        setAvailableProfiles(profileDirectory.profiles);
        if (servers.length === 0) {
          pendingHostedServer.current = undefined;
          if (!sessionRef.current) {
            setSelectedServer(undefined);
            selectedServerRef.current = undefined;
          }
          setStatus(sessionRef.current ? 'authenticated' : 'selecting-server');
          return;
        }
        const requested = preferredServerId
          ? servers.find(server => server.id === preferredServerId)
          : undefined;
        if (requirePreferredServer && preferredServerId && !requested) {
          throw new Error(
            'The server selected during TV setup is no longer shared with this Portico Account.',
          );
        }
        const preferred = requested ?? servers[0];
        attemptedServerName = preferred.name;
        await prepareHostedProfileSelection(
          preferred,
          accountId,
          profileDirectory.profiles,
          operation,
        );
      } catch (cause) {
        if (isAuthOperationAborted(cause)) throw cause;
        logAuthDiagnostic(
          serverDirectoryLoaded ? 'profile-selection' : 'cloud-directory',
          cause,
        );
        assertAuthOperation(operation, operationState.current);
        if (isSecurityCriticalAuthFailure(cause)) {
          const failedServerId = selectedServerRef.current?.id;
          operationState.current.blockingFailure = cause;
          viewerRuntime.forceClosed(cause);
          setHostedAccessToken(undefined);
          setServerSession(undefined);
          publishSession(undefined);
          accountRef.current = undefined;
          hostedSessionRef.current = undefined;
          setAccount(undefined);
          pendingHostedServer.current = undefined;
          selectedServerRef.current = undefined;
          setSelectedServer(undefined);
          setWarning('auth.sign-out-storage-warning');
          setStatus('signed-out');
          const cleanup = await Promise.allSettled([
            quarantineAllCredentials({
              authority: 'hosted',
              accountId,
              serverId: failedServerId,
            }),
          ]);
          const cleanupFailure = cleanup.find(
            result => result.status === 'rejected',
          );
          if (cleanupFailure?.status === 'rejected') {
            operationState.current.blockingFailure = cleanupFailure.reason;
          } else {
            operationState.current.blockingFailure = undefined;
            viewerRuntime.forceClosed();
            setWarning(undefined);
          }
          throw cause;
        }
        if (issueRef.current?.phase !== 'server-connection') {
          publishIssue(
            cause,
            serverDirectoryLoaded
              ? 'auth.profile-selection-failed'
              : 'problem.cloud-unavailable',
            serverDirectoryLoaded ? 'profile-selection' : 'cloud-directory',
            {serverName: attemptedServerName ?? 'this server'},
            {blocking: !sessionRef.current},
          );
        }
        setStatus(currentStatus =>
          currentStatus === 'authenticated'
            ? currentStatus
            : 'server-unavailable',
        );
      }
    },
    [
      prepareHostedProfileSelection,
      publishIssue,
      publishSession,
      viewerRuntime,
    ],
  );

  const openLocalProfile = useCallback(
    async (
      pending: PendingLocalAuthentication,
      profile: PorticoProfile,
      operation: AuthOperation,
      pin?: string,
      activeSelectionClient?: PorticoClient,
    ) => {
      if (profile.hasPIN && !/^\d{4}$/.test(pin ?? '')) {
        throw new ProductMessageError('auth.profile-pin-required', {
          profileName: profile.name,
        });
      }
      if (
        !activeSelectionClient &&
        Date.parse(pending.authentication.expiresAt) <= Date.now()
      ) {
        throw new ProductMessageError('auth.session-expired');
      }

      const candidateStore = createMemorySessionStore(
        pending.provisionalStore.get?.(),
      );
      const candidateClient = createServerClient(
        platform,
        pending.instanceId,
        candidateStore,
        null,
      );
      let created: NativeSessionCredentials | undefined;
      let stage:
        Awaited<ReturnType<ViewerRuntimeCoordinator['stage']>> | undefined;
      let published = false;
      try {
        assertAuthOperation(operation, operationState.current);
        const grant = await awaitAuthProducer(
          activeSelectionClient
            ? activeSelectionClient.selectActiveLocalProfile({
                profileId: profile.id,
                ...(pin ? {pin} : {}),
                purpose: 'native',
              })
            : candidateClient.selectLocalProfile({
                accountAuthenticationToken:
                  pending.authentication.accountAuthenticationToken,
                profileId: profile.id,
                ...(pin ? {pin} : {}),
              }),
          operation.signal,
        );
        assertAuthOperation(operation, operationState.current);
        const trustedGrant = parseProfileSelectionGrant(grant);
        if (
          trustedGrant.authority !== 'local' ||
          trustedGrant.accountId !== pending.directory.accountId ||
          trustedGrant.serverId !== pending.directory.serverId ||
          trustedGrant.profileId !== profile.id ||
          trustedGrant.pinRevision !== profile.pinRevision ||
          Date.parse(trustedGrant.expiresAt) <= Date.now()
        ) {
          throw new Error(
            'The profile selection did not match this account, server, profile, or PIN revision.',
          );
        }

        const descriptor = porticoClientDescriptor(platform);
        const mintProducer = candidateClient.createNativeProfileSession({
          app: descriptor.app,
          deviceName: descriptor.deviceName,
          installationId: pending.instanceId,
          platform: descriptor.nativePlatform,
          selectionGrant: trustedGrant.token,
        });
        try {
          created = await awaitAuthProducer(mintProducer, operation.signal);
        } catch (cause) {
          const clearLateCandidate = () => {
            try {
              candidateStore.clear?.();
            } catch {
              // This store was never published; the runtime fence is already
              // independent from best-effort orphan-family cleanup.
            }
          };
          void settleBoundedRemoteRevocation(async () => {
            const orphaned = await mintProducer;
            if (orphaned.refreshToken) {
              await candidateClient.revokeNativeSession(orphaned.refreshToken);
            }
          }).then(clearLateCandidate, clearLateCandidate);
          throw cause;
        }
        assertAuthOperation(operation, operationState.current);
        const identity = await awaitAuthProducer(
          candidateClient.me({signal: operation.signal}),
          operation.signal,
        );
        if (!identity.authenticated || !identity.user) {
          throw new Error(
            'The server accepted the session but did not return a viewer profile.',
          );
        }
        // /api/product-contract is an authenticated projection. Compare it
        // with the public System envelope only after the selected profile has
        // minted a bearer session into candidateStore. Checking it during the
        // anonymous account-authentication phase makes every valid Local Auth
        // attempt fail with the endpoint's intentional 401 response.
        await awaitAuthProducer(
          candidateClient.checkCompatibility({signal: operation.signal}),
          operation.signal,
        );
        assertAuthOperation(operation, operationState.current);
        const viewerScope = assertViewerScopeMatchesCredentials(
          identity,
          created,
        );
        assertViewerIdentity(viewerScope, {
          authority: 'local',
          accountId: pending.directory.accountId,
          serverId: pending.directory.serverId,
          profileId: profile.id,
        });
        if (
          pending.discoveredServerId &&
          viewerScope.serverId !== pending.discoveredServerId
        ) {
          throw new Error(
            'The authenticated server ID did not match its Bonjour advertisement.',
          );
        }

        const candidate = candidateStore.get?.();
        if (
          !candidate?.accessToken ||
          !candidate.refreshToken ||
          candidate.accessToken !== created.accessToken ||
          candidate.refreshToken !== created.refreshToken
        ) {
          throw new Error(
            'Local Auth did not return a complete, bound server credential.',
          );
        }
        const persisted = localServerSession({
          ...candidate,
          serverId: viewerScope.serverId,
          serverName:
            created.serverFriendlyName ??
            candidate.serverName ??
            pending.serverName,
        });
        const [previousDurable, previousHostedDurable, previousGlobal] =
          await awaitAuthProducer(
            Promise.all([
              serverCredentialAdapter.load?.(),
              hostedCredentialStore.load(),
              Promise.resolve(getServerSession()),
            ]),
            operation.signal,
          );
        const previousHostedRuntime = hostedSessionRef.current;
        const previousAppSession = sessionRef.current;
        const previousAccount = accountRef.current;
        const previousSelectedServer = selectedServerRef.current;
        const previousPendingLocal = pendingLocalAuthentication.current;
        const previousReplacementServer = replacementPreviousServer.current;
        let uiPublished = false;
        assertAuthOperation(operation, operationState.current);
        const environmentStage = beginServerSessionEnvironment();
        publishSession(undefined);
        try {
          stage = await viewerRuntime.stage(
            viewerScope,
            viewerTransitionReason(
              viewerRuntime.getSnapshot().scope,
              viewerScope,
            ),
          );
          await environmentStage.drain();
        } catch (cause) {
          environmentStage.failClosed();
          throw cause;
        }

        try {
          await serverCredentialAdapter.save(persisted);
          const verified = await serverCredentialAdapter.load?.();
          if (!sameCredentialFamily(verified, persisted)) {
            throw new Error(
              'Local Auth credentials were not committed to secure storage.',
            );
          }
          await hostedCredentialStore.clear();
          assertAuthOperation(operation, operationState.current);
          setHostedAccessToken(undefined);
          setServerSession(persisted);
          await stage.publish();
          environmentStage.activate(viewerScope);
          assertAuthOperation(operation, operationState.current);

          const restartableStore = createMemorySessionStore(persisted);
          pendingLocalAuthentication.current = activeSelectionClient
            ? undefined
            : {
                ...pending,
                client: createServerClient(
                  platform,
                  pending.instanceId,
                  restartableStore,
                  null,
                ),
                provisionalStore: restartableStore,
              };
          setRequiresLocalProfileReauthentication(false);
          hostedSessionRef.current = undefined;
          accountRef.current = undefined;
          setAccount(undefined);
          setProfileAwaitingPINId(undefined);
          selectedServerRef.current = undefined;
          replacementPreviousServer.current = undefined;
          setSelectedServer(undefined);
          const nextSession: AppSession = {
            mode: 'local',
            client: guardClient(
              createServerClient(platform, pending.instanceId),
              viewerScope,
            ),
            serverId: viewerScope.serverId,
            serverName: persisted.serverName ?? pending.serverName,
            displayName: identity.user.displayName,
            viewerScope,
          };
          publishSession(nextSession);
          notifyAuthoritativeViewerActivation(nextSession);
          setStatus('authenticated');
          uiPublished = true;
          assertAuthOperation(operation, operationState.current);
          published = true;
        } catch (cause) {
          stage.fence();
          environmentStage.fence();
          const failures: unknown[] = [];
          try {
            if (previousDurable) {
              await serverCredentialAdapter.save(previousDurable);
              const restored = await serverCredentialAdapter.load?.();
              if (!sameCredentialFamily(restored, previousDurable)) {
                throw new Error(
                  'Portico could not verify restoration of the previous server credential family.',
                );
              }
            } else {
              await serverCredentialAdapter.clear();
            }
          } catch (rollbackCause) {
            failures.push(rollbackCause);
          }
          try {
            if (previousHostedDurable) {
              await hostedCredentialStore.save(previousHostedDurable);
              const restored = await hostedCredentialStore.load();
              if (
                !sameHostedCredentialFamily(restored, previousHostedDurable)
              ) {
                throw new Error(
                  'Portico could not verify restoration of the previous account credential family.',
                );
              }
            } else {
              await hostedCredentialStore.clear();
            }
          } catch (rollbackCause) {
            failures.push(rollbackCause);
          }
          try {
            setHostedAccessToken(previousHostedRuntime?.accessToken);
            setServerSession(previousGlobal);
          } catch (rollbackCause) {
            failures.push(rollbackCause);
          }
          if (failures.length) {
            const safeClear = await Promise.allSettled([
              quarantineAllCredentials({authority: 'unknown'}),
            ]);
            setHostedAccessToken(undefined);
            setServerSession(undefined);
            await Promise.resolve(stage.rollback('fail-closed')).catch(
              () => undefined,
            );
            environmentStage.failClosed();
            viewerRuntime.forceClosed(cause);
            publishSession(undefined);
            accountRef.current = undefined;
            hostedSessionRef.current = undefined;
            setAccount(undefined);
            selectedServerRef.current = undefined;
            pendingLocalAuthentication.current = undefined;
            setSelectedServer(undefined);
            throw new AggregateError(
              [
                cause,
                ...failures,
                ...safeClear.flatMap(result =>
                  result.status === 'rejected' ? [result.reason] : [],
                ),
              ],
              'Portico could not restore or safely clear the previous server session.',
            );
          }
          try {
            await stage.rollback('restore-previous');
            environmentStage.rollback();
          } catch (rollbackCause) {
            const safeClear = await Promise.allSettled([
              quarantineAllCredentials({authority: 'unknown'}),
            ]);
            setHostedAccessToken(undefined);
            setServerSession(undefined);
            viewerRuntime.forceClosed(rollbackCause);
            environmentStage.failClosed();
            publishSession(undefined);
            accountRef.current = undefined;
            hostedSessionRef.current = undefined;
            setAccount(undefined);
            selectedServerRef.current = undefined;
            pendingLocalAuthentication.current = undefined;
            setSelectedServer(undefined);
            throw new AggregateError(
              [
                cause,
                rollbackCause,
                ...safeClear.flatMap(result =>
                  result.status === 'rejected' ? [result.reason] : [],
                ),
              ],
              'Portico could not restore the previous viewer after Local Auth compensation.',
            );
          }
          if (uiPublished) {
            hostedSessionRef.current = previousHostedRuntime;
            accountRef.current = previousAccount;
            setAccount(previousAccount);
            publishSession(previousAppSession);
            pendingLocalAuthentication.current = previousPendingLocal;
            replacementPreviousServer.current = previousReplacementServer;
            selectedServerRef.current = previousSelectedServer;
            setSelectedServer(previousSelectedServer);
            setStatus(
              previousAppSession ? 'authenticated' : 'selecting-profile',
            );
          }
          throw cause;
        }

        void Promise.resolve()
          .then(() => {
            assertAuthOperation(operation, operationState.current);
            return profileSelectionStore.recordVerifiedSelection(
              {
                authority: viewerScope.authority,
                accountId: viewerScope.accountId,
                serverId: viewerScope.serverId,
                installationId: pending.instanceId,
                profileId: viewerScope.profileId,
              },
              platform,
            );
          })
          .catch(() => undefined);
      } catch (cause) {
        if (!published) {
          const clearCandidate = () => {
            try {
              candidateStore.clear?.();
            } catch {
              // The store is isolated and unpublished. Clearing is best-effort
              // after its bounded remote credential-family revocation.
            }
          };
          const refreshToken = created?.refreshToken;
          if (refreshToken) {
            void settleBoundedRemoteRevocation(() =>
              candidateClient.revokeNativeSession(refreshToken),
            ).then(clearCandidate, clearCandidate);
          } else {
            clearCandidate();
          }
        }
        throw cause;
      }
    },
    [
      guardClient,
      notifyAuthoritativeViewerActivation,
      platform,
      publishSession,
      viewerRuntime,
    ],
  );

  const chooseProfile = useCallback(
    async (profileId: string, pin?: string) => {
      const operation = beginOperation();
      return runLatest(operation, async () => {
        const previousSession = sessionRef.current;
        let attemptedHostedServer:
          | {
              accountId: string;
              candidate: HostedServer;
              previous?: HostedServer;
            }
          | undefined;
        const profile = availableProfiles.find(item => item.id === profileId);
        if (!profile) {
          throw new ProductMessageError('auth.profile-not-available');
        }
        if (profile.hasPIN && !/^\d{4}$/.test(pin ?? '')) {
          throw new ProductMessageError('auth.profile-pin-required', {
            profileName: profile.name,
          });
        }
        if (!previousSession) setStatus('connecting');
        clearIssue();
        try {
          const local = pendingLocalAuthentication.current;
          if (local) {
            if (
              !local.directory.profiles.some(item => item.id === profile.id)
            ) {
              throw new Error(
                'That profile does not belong to the pending Local Auth session.',
              );
            }
            await openLocalProfile(local, profile, operation, pin);
            return;
          }
          if (previousSession?.mode === 'local') {
            const [persisted, instanceId, directory] = await awaitAuthProducer(
              Promise.all([
                serverCredentialAdapter.load?.(),
                clientMetadataId(),
                previousSession.client.accountProfiles({
                  signal: operation.signal,
                }),
              ]),
              operation.signal,
            );
            assertAuthOperation(operation, operationState.current);
            if (
              !persisted?.accessToken ||
              !persisted.refreshToken ||
              directory.authority !== 'local' ||
              directory.accountId !== previousSession.viewerScope.accountId ||
              directory.serverId !== previousSession.viewerScope.serverId ||
              !directory.profiles.some(item => item.id === profile.id)
            ) {
              throw new Error(
                'The active Local Auth session did not return a matching profile directory.',
              );
            }
            const provisionalStore = createMemorySessionStore(persisted);
            await openLocalProfile(
              {
                authentication: {
                  accountAuthenticationToken: '',
                  directory,
                  expiresAt: new Date(Date.now() + 60_000).toISOString(),
                },
                client: previousSession.client,
                directory,
                discoveredServerId: previousSession.serverId,
                instanceId,
                provisionalStore,
                serverName: previousSession.serverName,
              },
              profile,
              operation,
              pin,
              previousSession.client,
            );
            return;
          }
          const currentAccount = accountRef.current;
          attemptedHostedServer = pendingHostedServer.current;
          if (
            attemptedHostedServer &&
            attemptedHostedServer.accountId !== currentAccount?.id
          ) {
            throw new Error(
              'The pending server selection belongs to a different Portico Account.',
            );
          }
          const currentServer =
            attemptedHostedServer?.candidate ?? selectedServerRef.current;
          if (!currentAccount || !currentServer) {
            throw new Error(
              'Choose a Portico Server before opening a profile.',
            );
          }
          await openHostedProfile(
            currentServer,
            currentAccount.id,
            profile.id,
            operation,
            pin,
          );
        } catch (cause) {
          if (isAuthOperationAborted(cause)) throw cause;
          assertAuthOperation(operation, operationState.current);
          const runtime = viewerRuntime.getSnapshot();
          const previousStillActive = Boolean(
            previousSession &&
            runtime.scope &&
            runtime.acceptingWrites &&
            sameViewerScope(previousSession.viewerScope, runtime.scope) &&
            serverSessionEnvironmentMatches(previousSession.viewerScope),
          );
          publishSession(previousStillActive ? previousSession : undefined);
          if (previousStillActive && replacementPreviousServer.current) {
            selectedServerRef.current = replacementPreviousServer.current;
            setSelectedServer(replacementPreviousServer.current);
          }
          if (
            attemptedHostedServer &&
            pendingHostedServer.current === attemptedHostedServer
          ) {
            pendingHostedServer.current = undefined;
            selectedServerRef.current = attemptedHostedServer.previous;
            setSelectedServer(attemptedHostedServer.previous);
          }
          publishIssue(
            cause,
            'auth.profile-selection-failed',
            'profile-selection',
            {},
            {
              blocking: !previousStillActive,
              server:
                attemptedHostedServer?.candidate ?? selectedServerRef.current,
            },
          );
          setStatus(
            previousStillActive ? 'authenticated' : 'selecting-profile',
          );
          throw cause;
        }
      });
    },
    [
      availableProfiles,
      beginOperation,
      clearIssue,
      openHostedProfile,
      openLocalProfile,
      publishIssue,
      publishSession,
      runLatest,
      viewerRuntime,
    ],
  );

  const chooseServer = useCallback(
    async (server: HostedServer) => {
      const operation = beginOperation();
      return runLatest(operation, async () => {
        const currentAccount = accountRef.current;
        if (!currentAccount) {
          throw new Error(
            'Sign in to a Portico Account before opening a server.',
          );
        }
        const previousPending = pendingHostedServer.current;
        try {
          if (!availableProfiles.length) {
            await loadHostedServers(operation, server.id, currentAccount.id);
            return;
          }
          await prepareHostedProfileSelection(
            server,
            currentAccount.id,
            availableProfiles,
            operation,
          );
        } catch (cause) {
          if (
            previousPending &&
            pendingHostedServer.current === previousPending
          ) {
            pendingHostedServer.current = undefined;
            selectedServerRef.current = previousPending.previous;
            setSelectedServer(previousPending.previous);
          }
          throw cause;
        }
      });
    },
    [
      availableProfiles,
      beginOperation,
      loadHostedServers,
      prepareHostedProfileSelection,
      runLatest,
    ],
  );

  const restore = useCallback(() => {
    const operation = beginOperation();
    return runLatest(operation, async () => {
      try {
        logNativeDiagnostic('restore-start', {started: true});
        const cleanupOutcome = await settleBeforeDeadline(
          retryPendingCredentialCleanup(),
        );
        if (cleanupOutcome.timedOut) {
          const timeout = new Error(
            'Portico could not verify saved credential cleanup before the restore deadline.',
          );
          timeout.name = 'CredentialCleanupRestoreDeadlineError';
          throw timeout;
        }
        if (cleanupOutcome.status === 'rejected') {
          throw cleanupOutcome.reason;
        }
        const encounteredCleanupBarrier = cleanupOutcome.value;
        logNativeDiagnostic('restore-cleanup', {
          encounteredCleanupBarrier,
        });
        assertAuthOperation(operation, operationState.current);
        if (encounteredCleanupBarrier) {
          viewerRuntime.forceClosed();
          setHostedAccessToken(undefined);
          setServerSession(undefined);
          publishSession(undefined);
          accountRef.current = undefined;
          setAccount(undefined);
          // A stale barrier means an earlier launch ended mid-cleanup. The
          // retry above has now deleted every credential and retired that
          // barrier, so this is a normal signed-out startup, not a warning.
          operationState.current.blockingFailure = undefined;
          setWarning(undefined);
          setStatus('signed-out');
          return;
        }
      } catch (cause) {
        if (isAuthOperationAborted(cause)) throw cause;
        // Missing, malformed, or unreadable cleanup state is not evidence that
        // old credentials are safe to restore.
        const cleanupFailure =
          cause ??
          new Error('Portico could not verify saved credential cleanup.');
        operationState.current.blockingFailure = cleanupFailure;
        viewerRuntime.forceClosed(cleanupFailure);
        setHostedAccessToken(undefined);
        setServerSession(undefined);
        publishSession(undefined);
        accountRef.current = undefined;
        setAccount(undefined);
        setWarning('auth.sign-out-storage-warning');
        setStatus('signed-out');
        return;
      }

      try {
        const [hostedSession, localSession] = await awaitAuthProducer(
          Promise.all([
            hostedCredentialStore.load(),
            serverCredentialAdapter.load?.(),
          ]),
          operation.signal,
        );
        logNativeDiagnostic('restore-credentials', {
          hostedSessionPresent: Boolean(hostedSession),
          localSessionPresent: Boolean(localSession),
        });
        assertAuthOperation(operation, operationState.current);
        if (hostedSession) {
          // Durable account identity remains useful for offline downloads and
          // recovery even while an expired access token cannot be refreshed.
          accountRef.current = hostedSession.user;
          setAccount(hostedSession.user);
          let current: HostedAccountSession;
          try {
            current = await currentHostedSession(
              hostedSession,
              operation,
              operationState.current,
            );
          } catch (cause) {
            if (isTerminalHostedRefreshFailure(cause)) {
              hostedSessionRef.current = undefined;
              accountRef.current = undefined;
              setAccount(undefined);
              throw new ProductMessageError('auth.session-expired');
            }
            if (!(cause instanceof HostedRefreshDeferredError)) throw cause;
            setHostedAccessToken(undefined);
            hostedSessionRef.current = hostedSession;
            publishIssue(
              cause,
              'problem.cloud-unavailable',
              'cloud-directory',
              {},
              {blocking: !sessionRef.current},
            );
            setStatus(sessionRef.current ? 'authenticated' : 'server-unavailable');
            return;
          }
          assertAuthOperation(operation, operationState.current);
          setHostedAccessToken(current.accessToken);
          hostedSessionRef.current = current;
          accountRef.current = current.user;
          setAccount(current.user);
          setError(undefined);
          const lastServerId = await awaitAuthProducer(
            selectedServerStore.get().catch(() => undefined),
            operation.signal,
          );
          assertAuthOperation(operation, operationState.current);
          // Pre-profile Hosted sessions cannot be safely attributed to a profile.
          // They are deliberately not migrated into the profile-scoped trust vault.
          // The user can reconnect and receive a fully bound record instead.
          await loadHostedServers(
            operation,
            lastServerId ?? undefined,
            current.user.id,
          );
          return;
        }
        if (
          localSession?.apiBaseUrl &&
          localSession.accessToken &&
          canRestoreWithoutHostedAccount(localSession)
        ) {
          await connectStoredServer(localSession, operation);
          return;
        }
        setStatus('signed-out');
      } catch (cause) {
        if (isAuthOperationAborted(cause)) return;
        logAuthDiagnostic('restore', cause);
        if (isSecurityCriticalAuthFailure(cause)) {
          viewerRuntime.forceClosed(cause);
          setHostedAccessToken(undefined);
          setServerSession(undefined);
          publishSession(undefined);
          setStatus('signed-out');
          throw cause;
        }
        setError(productErrorMessageId(cause, 'problem.request-failed'));
        setStatus('signed-out');
      }
    });
  }, [
    beginOperation,
    connectStoredServer,
    loadHostedServers,
    publishIssue,
    publishSession,
    runLatest,
    viewerRuntime,
  ]);

  useEffect(() => {
    if (restoreStarted.current) return;
    restoreStarted.current = true;
    void restore().catch(() => undefined);
  }, [restore]);

  const completeHostedAccount = useCallback(
    async (
      operation: AuthOperation,
      hostedSession: HostedAccountSession,
      persist = true,
      preferredServerId?: string,
      requirePreferredServer = false,
    ) => {
      const previousHostedRuntime = hostedSessionRef.current;
      const loadedHostedCredential = await awaitAuthProducer(
        hostedCredentialStore.load(),
        operation.signal,
      );
      const previousHostedDurable = persist
        ? loadedHostedCredential
        : previousHostedRuntime;
      assertAuthOperation(operation, operationState.current);
      const previousServerDurable = await awaitAuthProducer(
        Promise.resolve(serverCredentialAdapter.load?.()),
        operation.signal,
      );
      assertAuthOperation(operation, operationState.current);
      const previousSelectedServerId = await awaitAuthProducer(
        selectedServerStore.get().catch(() => undefined),
        operation.signal,
      );
      assertAuthOperation(operation, operationState.current);
      const previousServerGlobal = getServerSession();
      const previousSession = sessionRef.current;
      const previousAccount = accountRef.current;
      const previousSelectedServer = selectedServerRef.current;
      const previousPendingLocal = pendingLocalAuthentication.current;
      const previousPendingHosted = pendingHostedServer.current;
      const previousReplacementServer = replacementPreviousServer.current;
      const previousIssue = issueRef.current;
      const environmentStage = beginServerSessionEnvironment();
      publishSession(undefined);
      let staged: Awaited<ReturnType<ViewerRuntimeCoordinator['stage']>>;
      try {
        staged = await viewerRuntime.stage(undefined, 'server-switch');
        await environmentStage.drain();
      } catch (cause) {
        environmentStage.failClosed();
        throw cause;
      }

      try {
        if (persist) await hostedCredentialStore.save(hostedSession);
        const persistedHosted = await hostedCredentialStore.load();
        if (!sameHostedCredentialFamily(persistedHosted, hostedSession)) {
          throw new Error(
            'The Portico Account credential family was not committed to secure storage.',
          );
        }

        // A server credential belongs to A until B has independently selected
        // and verified a server/profile. Remove it durably before publishing B.
        await serverCredentialAdapter.clear();
        // The last-used server is convenience state, not authentication
        // authority. Leave it in place until a verified server selection
        // overwrites it; an asynchronous clear could otherwise race that write.
        assertAuthOperation(operation, operationState.current);
        setHostedAccessToken(hostedSession.accessToken);
        setServerSession(undefined);
        await staged.publish();
        assertAuthOperation(operation, operationState.current);

        // Final account/UI publication belongs to the same generation as the
        // credential and runtime commit. A synchronously-started C can still
        // invalidate B here, in which case the catch path compensates all of B.
        hostedSessionRef.current = hostedSession;
        setRequiresLocalProfileReauthentication(false);
        accountRef.current = hostedSession.user;
        setAccount(hostedSession.user);
        publishSession(undefined);
        pendingLocalAuthentication.current = undefined;
        pendingHostedServer.current = undefined;
        replacementPreviousServer.current = undefined;
        selectedServerRef.current = undefined;
        setSelectedServer(undefined);
        setAvailableServers([]);
        setServerConnectionStates({});
        setAvailableProfiles([]);
        setError(undefined);
        clearIssue();
        setStatus('selecting-server');
        assertAuthOperation(operation, operationState.current);
      } catch (cause) {
        staged.fence();
        environmentStage.fence();
        const credentialRollbackFailures: unknown[] = [];
        try {
          if (previousHostedDurable) {
            await hostedCredentialStore.save(previousHostedDurable);
            const restored = await hostedCredentialStore.load();
            if (!sameHostedCredentialFamily(restored, previousHostedDurable)) {
              throw new Error(
                'Portico could not verify restoration of the previous account credential family.',
              );
            }
          } else {
            await hostedCredentialStore.clear();
          }
        } catch (rollbackCause) {
          credentialRollbackFailures.push(rollbackCause);
        }
        try {
          if (previousServerDurable) {
            await serverCredentialAdapter.save(previousServerDurable);
            const restored = await serverCredentialAdapter.load?.();
            if (!sameCredentialFamily(restored, previousServerDurable)) {
              throw new Error(
                'Portico could not verify restoration of the previous server credential family.',
              );
            }
          } else {
            await serverCredentialAdapter.clear();
          }
        } catch (rollbackCause) {
          credentialRollbackFailures.push(rollbackCause);
        }
        try {
          setHostedAccessToken(previousHostedRuntime?.accessToken);
          setServerSession(previousServerGlobal);
        } catch (rollbackCause) {
          credentialRollbackFailures.push(rollbackCause);
        }
        // Restore non-authoritative last-used-server state only when it had a
        // value. No mutation occurred for an absent value.
        if (previousSelectedServerId) {
          void selectedServerStore
            .set(previousSelectedServerId)
            .catch(() => undefined);
        }

        if (credentialRollbackFailures.length) {
          const safeClear = await Promise.allSettled([
            quarantineAllCredentials({authority: 'unknown'}),
          ]);
          setHostedAccessToken(undefined);
          setServerSession(undefined);
          await Promise.resolve(staged.rollback('fail-closed')).catch(
            () => undefined,
          );
          environmentStage.failClosed();
          viewerRuntime.forceClosed(cause);
          publishSession(undefined);
          accountRef.current = undefined;
          hostedSessionRef.current = undefined;
          setAccount(undefined);
          selectedServerRef.current = undefined;
          pendingHostedServer.current = undefined;
          pendingLocalAuthentication.current = undefined;
          setSelectedServer(undefined);
          setWarning('auth.sign-out-storage-warning');
          throw new AggregateError(
            [
              cause,
              ...credentialRollbackFailures,
              ...safeClear.flatMap(result =>
                result.status === 'rejected' ? [result.reason] : [],
              ),
            ],
            'Portico could not restore or safely clear the previous account transaction.',
          );
        }

        try {
          await staged.rollback('restore-previous');
          environmentStage.rollback();
        } catch (rollbackCause) {
          const safeClear = await Promise.allSettled([
            quarantineAllCredentials({authority: 'unknown'}),
          ]);
          setHostedAccessToken(undefined);
          setServerSession(undefined);
          viewerRuntime.forceClosed(rollbackCause);
          environmentStage.failClosed();
          publishSession(undefined);
          accountRef.current = undefined;
          hostedSessionRef.current = undefined;
          setAccount(undefined);
          setWarning('auth.sign-out-storage-warning');
          throw new AggregateError(
            [
              cause,
              rollbackCause,
              ...safeClear.flatMap(result =>
                result.status === 'rejected' ? [result.reason] : [],
              ),
            ],
            'Portico could not restore the previous viewer after account compensation.',
          );
        }
        hostedSessionRef.current = previousHostedRuntime;
        accountRef.current = previousAccount;
        setAccount(previousAccount);
        publishSession(previousSession);
        pendingLocalAuthentication.current = previousPendingLocal;
        pendingHostedServer.current = previousPendingHosted;
        replacementPreviousServer.current = previousReplacementServer;
        selectedServerRef.current = previousSelectedServer;
        setSelectedServer(previousSelectedServer);
        setAvailableServers(availableServers);
        setServerConnectionStates(serverConnectionStates);
        setAvailableProfiles(availableProfiles);
        setProfileAwaitingPINId(profileAwaitingPINId);
        setRequiresLocalProfileReauthentication(
          requiresLocalProfileReauthentication,
        );
        setError(error);
        issueRef.current = previousIssue;
        setIssue(previousIssue);
        setServerError(
          previousIssue?.presentation.body ??
            previousIssue?.presentation.text ??
            previousIssue?.presentation.title ??
            serverError,
        );
        setStatus(status);
        throw cause;
      }

      await loadHostedServers(
        operation,
        preferredServerId,
        hostedSession.user.id,
        requirePreferredServer,
      );
    },
    [
      availableProfiles,
      availableServers,
      serverConnectionStates,
      clearIssue,
      error,
      loadHostedServers,
      profileAwaitingPINId,
      publishSession,
      requiresLocalProfileReauthentication,
      serverError,
      status,
      viewerRuntime,
    ],
  );

  const signInWithPortico = useCallback(
    async (
      login: string,
      password: string,
      secondFactor?: PorticoSecondFactor,
    ) => {
      const operation = beginOperation();
      return runLatest(operation, async () => {
        setError(undefined);
        clearIssue();
        if (!sessionRef.current) setStatus('connecting');
        try {
          const descriptor = porticoClientDescriptor(platform);
          const instanceId = await awaitAuthProducer(
            clientMetadataId(),
            operation.signal,
          );
          assertAuthOperation(operation, operationState.current);
          const response = await awaitAuthProducer(
            hostedClient.createNativeSession(
              {
                login: login.trim(),
                password,
                installationId: instanceId,
                ...(secondFactor?.kind === 'totp'
                  ? {mfaCode: secondFactor.code.trim()}
                  : {}),
                ...(secondFactor?.kind === 'recovery'
                  ? {recoveryCode: secondFactor.code.trim()}
                  : {}),
                deviceName: descriptor.deviceName,
                devicePlatform: descriptor.nativePlatform,
              },
              {signal: operation.signal},
            ),
            operation.signal,
          );
          assertAuthOperation(operation, operationState.current);
          const hostedSession: HostedAccountSession = response;
          await completeHostedAccount(operation, hostedSession);
        } catch (cause) {
          if (isAuthOperationAborted(cause)) throw cause;
          if (sessionRef.current) {
            setError(undefined);
            publishIssue(
              cause,
              'auth.invalid-credentials',
              'account',
              {},
              {blocking: false},
            );
          } else {
            setError(
              isMFARequired(cause)
                ? undefined
                : productErrorMessageId(cause, 'auth.invalid-credentials'),
            );
          }
          setStatus(
            sessionRef.current
              ? 'authenticated'
              : accountRef.current
                ? 'server-unavailable'
                : 'signed-out',
          );
          throw cause;
        }
      });
    },
    [
      beginOperation,
      clearIssue,
      completeHostedAccount,
      platform,
      publishIssue,
      runLatest,
    ],
  );

  const completeDeviceAuthorization = useCallback(
    async (accountCredentials: HostedAccountSession) => {
      const operation = beginOperation();
      return runLatest(operation, async () => {
        setError(undefined);
        try {
          const persisted = await awaitAuthProducer(
            hostedCredentialStore.load(),
            operation.signal,
          );
          assertAuthOperation(operation, operationState.current);
          if (
            !persisted ||
            !persisted.device ||
            !accountCredentials.device ||
            persisted.accessToken !== accountCredentials.accessToken ||
            persisted.refreshToken !== accountCredentials.refreshToken ||
            persisted.user.id !== accountCredentials.user.id ||
            persisted.device.id !== accountCredentials.device.id
          ) {
            throw new Error(
              'The redeemed Portico Account session was not committed to secure storage.',
            );
          }
          await completeHostedAccount(operation, persisted, false);
        } catch (cause) {
          if (isAuthOperationAborted(cause)) throw cause;
          setError(productErrorMessageId(cause, 'problem.request-failed'));
          setStatus(
            sessionRef.current
              ? 'authenticated'
              : accountRef.current
                ? 'server-unavailable'
                : 'signed-out',
          );
          throw cause;
        }
      });
    },
    [beginOperation, completeHostedAccount, runLatest],
  );

  const completeNearbyTVSetup = useCallback(
    async (grant: TVSetupGrantPayload) => {
      const operation = beginOperation();
      return runLatest(operation, async () => {
        setError(undefined);
        const expectedAccount = hostedAccountSessionFromTVSetupGrant(grant);
        const persistedAccount = await awaitAuthProducer(
          hostedCredentialStore.load(),
          operation.signal,
        );
        assertAuthOperation(operation, operationState.current);
        if (
          !persistedAccount ||
          persistedAccount.user.id !== expectedAccount.user.id ||
          persistedAccount.accessToken !== expectedAccount.accessToken ||
          persistedAccount.refreshToken !== expectedAccount.refreshToken
        ) {
          throw new Error(
            'The redeemed Nearby TV Portico Account was not committed to secure storage.',
          );
        }
        await completeHostedAccount(
          operation,
          persistedAccount,
          false,
          grant.serverId,
          true,
        );
      });
    },
    [beginOperation, completeHostedAccount, runLatest],
  );

  const registerPorticoAccount = useCallback(
    async (email: string, username: string, password: string) => {
      const operation = beginOperation();
      return runLatest(operation, async () => {
        const normalizedEmail = email.trim();
        let accountCreated = false;
        setError(undefined);
        clearIssue();
        if (!sessionRef.current) setStatus('connecting');
        try {
          const descriptor = porticoClientDescriptor(platform);
          await awaitAuthProducer(
            hostedClient.register(
              {
                email: normalizedEmail,
                username: username.trim(),
                password,
              },
              {signal: operation.signal},
            ),
            operation.signal,
          );
          accountCreated = true;
          assertAuthOperation(operation, operationState.current);
          const instanceId = await awaitAuthProducer(
            clientMetadataId(),
            operation.signal,
          );
          assertAuthOperation(operation, operationState.current);
          const hostedSession: HostedAccountSession = await awaitAuthProducer(
            hostedClient.createNativeSession(
              {
                login: normalizedEmail,
                password,
                installationId: instanceId,
                deviceName: descriptor.deviceName,
                devicePlatform: descriptor.nativePlatform,
              },
              {signal: operation.signal},
            ),
            operation.signal,
          );
          assertAuthOperation(operation, operationState.current);
          await completeHostedAccount(operation, hostedSession);
        } catch (cause) {
          if (isAuthOperationAborted(cause)) throw cause;
          if (accountCreated && !accountRef.current) {
            setError(undefined);
            setStatus('signed-out');
            throw new AccountCreatedSignInRequiredError(normalizedEmail);
          }
          setError(productErrorMessageId(cause, 'problem.request-failed'));
          setStatus(
            sessionRef.current
              ? 'authenticated'
              : accountRef.current
                ? 'server-unavailable'
                : 'signed-out',
          );
          throw cause;
        }
      });
    },
    [beginOperation, clearIssue, completeHostedAccount, platform, runLatest],
  );

  const requestPasswordReset = useCallback(async (email: string) => {
    setError(undefined);
    try {
      await hostedClient.requestPasswordReset({email: email.trim()});
    } catch (cause) {
      setError(productErrorMessageId(cause, 'problem.request-failed'));
      throw cause;
    }
  }, []);

  const signInWithLocalAuth = useCallback(
    async (
      serverURL: string,
      login: string,
      password: string,
      discoveredIdentity?: {
        serverId?: string;
        serverPublicKeyFingerprint: string;
      },
    ) => {
      const operation = beginOperation();
      return runLatest(operation, async () => {
        const previousSession = sessionRef.current;
        setError(undefined);
        clearIssue();
        if (!previousSession) setStatus('connecting');
        try {
          const descriptor = porticoClientDescriptor(platform);
          const apiBaseUrl = normalizeServerURL(serverURL);
          const provisionalSession = localServerSession({
            apiBaseUrl,
            routeType: discoveredIdentity ? 'lan' : 'manual',
            serverId: discoveredIdentity?.serverId,
            serverPublicKeyFingerprint:
              discoveredIdentity?.serverPublicKeyFingerprint,
          });
          const provisionalStore = createMemorySessionStore(provisionalSession);
          const instanceId = await awaitAuthProducer(
            clientMetadataId(),
            operation.signal,
          );
          assertAuthOperation(operation, operationState.current);
          const client = createServerClient(
            platform,
            instanceId,
            provisionalStore,
            null,
          );
          await awaitAuthProducer(
            client.checkServerCompatibility({signal: operation.signal}),
            operation.signal,
          );
          if (discoveredIdentity) {
            const health = await awaitAuthProducer(
              client.remoteAccessHealth(),
              operation.signal,
            );
            assertAuthOperation(operation, operationState.current);
            if (
              !health.serverPublicKeyFingerprint ||
              health.serverPublicKeyFingerprint !==
                discoveredIdentity.serverPublicKeyFingerprint
            ) {
              throw new Error(
                'The nearby server identity did not match its Bonjour advertisement. No credentials were sent.',
              );
            }
            if (
              discoveredIdentity.serverId &&
              health.serverId !== discoveredIdentity.serverId
            ) {
              throw new Error(
                'The nearby server ID did not match its Bonjour advertisement. No credentials were sent.',
              );
            }
          }
          const authentication = await awaitAuthProducer(
            client.authenticateLocalProfileAccount({
              app: descriptor.app,
              deviceName: descriptor.deviceName,
              installationId: instanceId,
              login: login.trim(),
              password,
              platform: descriptor.nativePlatform,
              purpose: 'native',
            }),
            operation.signal,
          );
          assertAuthOperation(operation, operationState.current);
          if (Date.parse(authentication.expiresAt) <= Date.now()) {
            throw new ProductMessageError('auth.session-expired');
          }
          if (
            authentication.directory.authority !== 'local' ||
            (discoveredIdentity?.serverId &&
              authentication.directory.serverId !== discoveredIdentity.serverId)
          ) {
            throw new Error(
              'Local Auth returned an expired or mismatched profile directory.',
            );
          }
          const pending: PendingLocalAuthentication = {
            authentication,
            client,
            directory: authentication.directory,
            discoveredServerId: discoveredIdentity?.serverId,
            instanceId,
            provisionalStore,
            serverName: 'Portico Server',
          };
          const deviceClass = platform === 'tv' ? 'television' : 'mobile';
          const preferences = await awaitAuthProducer(
            profileSelectionStore
              .get(
                {
                  authority: pending.directory.authority,
                  accountId: pending.directory.accountId,
                  serverId: pending.directory.serverId,
                  installationId: pending.instanceId,
                },
                platform,
              )
              .catch(() => ({
                ...defaultAccountServerInstallationPreferences(deviceClass),
                profileSelection: 'ask' as const,
              })),
            operation.signal,
          );
          assertAuthOperation(operation, operationState.current);
          const decision = decideProfileSelection(
            pending.directory,
            requiresLocalProfileReauthentication
              ? {...preferences, profileSelection: 'ask'}
              : preferences,
          );
          if (decision.kind === 'unavailable') {
            throw new ProductMessageError('auth.profile-not-available');
          }
          pendingLocalAuthentication.current = pending;
          setRequiresLocalProfileReauthentication(false);
          replacementPreviousServer.current = selectedServerRef.current;
          setAvailableProfiles(
            [...pending.directory.profiles].sort(
              (left, right) => left.sortOrder - right.sortOrder,
            ),
          );
          selectedServerRef.current = undefined;
          setSelectedServer(undefined);
          setProfileAwaitingPINId(undefined);
          if (decision.kind === 'open') {
            await openLocalProfile(pending, decision.profile, operation);
            return;
          }
          if (decision.kind === 'pin') {
            setProfileAwaitingPINId(decision.profile.id);
          }
          setStatus('selecting-profile');
        } catch (cause) {
          if (isAuthOperationAborted(cause)) throw cause;
          assertAuthOperation(operation, operationState.current);
          pendingLocalAuthentication.current = undefined;
          const runtime = viewerRuntime.getSnapshot();
          const previousStillActive = Boolean(
            previousSession &&
            runtime.scope &&
            runtime.acceptingWrites &&
            sameViewerScope(previousSession.viewerScope, runtime.scope) &&
            serverSessionEnvironmentMatches(previousSession.viewerScope),
          );
          publishSession(previousStillActive ? previousSession : undefined);
          if (previousStillActive && replacementPreviousServer.current) {
            selectedServerRef.current = replacementPreviousServer.current;
            setSelectedServer(replacementPreviousServer.current);
          }
          if (previousStillActive) {
            setError(undefined);
            publishIssue(
              cause,
              'problem.connection-failed',
              'local-auth',
              {},
              {blocking: false},
            );
          } else {
            setError(productErrorMessageId(cause, 'problem.connection-failed'));
          }
          setStatus(previousStillActive ? 'authenticated' : 'signed-out');
          throw cause;
        }
      });
    },
    [
      beginOperation,
      clearIssue,
      openLocalProfile,
      platform,
      publishIssue,
      publishSession,
      runLatest,
      viewerRuntime,
      requiresLocalProfileReauthentication,
    ],
  );

  const signOut = useCallback(async () => {
    const operation = beginOperation();
    const activeSession = sessionRef.current;
    const activeAccount = accountRef.current;
    const activeServerCredential = getServerSession();
    const cleanupScope = {
      authority:
        activeSession?.viewerScope.authority ??
        (activeAccount ? ('hosted' as const) : ('unknown' as const)),
      accountId: activeSession?.viewerScope.accountId ?? activeAccount?.id,
      serverId: activeSession?.viewerScope.serverId,
    };

    // Starting transition installs the synchronous generation fence before the
    // first await. Clear React/global publication immediately so teardown or
    // Keychain failures can never leave an authenticated surface mounted.
    const credentialEnvironmentDrain = fenceServerSessionEnvironment();
    const teardown = viewerRuntime.transition(undefined, 'sign-out');
    void teardown.catch(() => undefined);
    pendingLocalAuthentication.current = undefined;
    pendingHostedServer.current = undefined;
    replacementPreviousServer.current = undefined;
    hostedSessionRef.current = undefined;
    setHostedAccessToken(undefined);
    setServerSession(undefined);
    publishSession(undefined);
    accountRef.current = undefined;
    setAccount(undefined);
    selectedServerRef.current = undefined;
    setSelectedServer(undefined);
    setAvailableServers([]);
    setServerConnectionStates({});
    setAvailableProfiles([]);
    setProfileAwaitingPINId(undefined);
    setRequiresLocalProfileReauthentication(false);
    clearIssue();
    setStatus('signed-out');

    const signingOut = (async () => {
      const markerSettlement = settleBeforeDeadline(
        beginCredentialCleanup(cleanupScope),
      );
      const predecessorSettlement = settleBeforeDeadline(
        Promise.allSettled([
          operation.previous,
          teardown,
          credentialEnvironmentDrain,
        ]),
      );
      // Keep the server-native family in an isolated memory store. Global UI
      // and credentials are already unpublished, and durable deletion may run
      // independently without removing the token needed for best-effort remote
      // revocation.
      const remoteRevocations = Promise.allSettled([
        settleBoundedRemoteRevocation(async () => {
          const hostedSession = await hostedCredentialStore.load();
          if (hostedSession?.refreshToken) {
            await hostedClient.revokeNativeSession(hostedSession.refreshToken);
          }
        }),
        settleBoundedRemoteRevocation(() =>
          revokeCapturedServerSessions(
            platform,
            activeServerCredential,
            cleanupScope.authority === 'hosted'
              ? cleanupScope.accountId
              : undefined,
          ),
        ),
      ]);
      const markerOutcome = await markerSettlement;
      const marker =
        !markerOutcome.timedOut && markerOutcome.status === 'fulfilled'
          ? markerOutcome.value
          : undefined;
      const failures: unknown[] = [];
      if (markerOutcome.timedOut) {
        const markerDeadline = new Error(
          'Portico could not confirm the secure cleanup barrier before the sign-out deadline.',
        );
        markerDeadline.name = 'CredentialCleanupBarrierDeadlineError';
        failures.push(markerDeadline);
      } else if (markerOutcome.status === 'rejected') {
        failures.push(markerOutcome.reason);
      }

      // If the barrier itself cannot be trusted, delete immediately as well as
      // after the aborted predecessor settles. A process kill cannot leave the
      // old family behind while an unpublishable candidate is still unwinding.
      const emergencyCleanup = marker
        ? Promise.resolve([])
        : Promise.allSettled([deleteAllCredentialsRetainingCleanupBarrier()]);
      const [emergency, predecessorOutcome] = await Promise.all([
        emergencyCleanup,
        predecessorSettlement,
      ]);
      failures.push(
        ...emergency.flatMap(result =>
          result.status === 'rejected' ? [result.reason] : [],
        ),
      );
      let credentialCleanup: Promise<void>;
      if (
        predecessorOutcome.timedOut ||
        predecessorOutcome.status === 'rejected'
      ) {
        const settlementFailure = predecessorOutcome.timedOut
          ? new Error(
              'Portico could not confirm that the previous authentication and viewer runtime stopped before the sign-out deadline.',
            )
          : predecessorOutcome.reason;
        if (settlementFailure instanceof Error && predecessorOutcome.timedOut) {
          settlementFailure.name = 'SignOutTeardownDeadlineError';
        }
        failures.push(settlementFailure);
        viewerRuntime.forceClosed(settlementFailure);
        credentialCleanup = deleteAllCredentialsRetainingCleanupBarrier();
      } else {
        const predecessorAndTeardown = predecessorOutcome.value;
        const teardownFailures = predecessorAndTeardown
          .slice(1)
          .flatMap(result =>
            result.status === 'rejected' ? [result.reason] : [],
          );
        failures.push(...teardownFailures);
        const teardownFailure = teardownFailures[0];
        viewerRuntime.forceClosed(teardownFailure);
        credentialCleanup = marker
          ? finishCredentialCleanup(marker)
          : deleteAllCredentialsRetainingCleanupBarrier();
      }

      // Local cleanup begins without waiting for either remote producer. The
      // bounded remote races are awaited only so sign-out has deterministic
      // completion; their failures never influence the durable cleanup latch.
      const cleanupPromise = Promise.allSettled([
        credentialCleanup,
        selectedServerStore.clear(),
      ]);
      const [cleanup] = await Promise.all([cleanupPromise, remoteRevocations]);
      failures.push(
        ...cleanup.flatMap(result =>
          result.status === 'rejected' ? [result.reason] : [],
        ),
      );
      setHostedAccessToken(undefined);
      setServerSession(undefined);
      operationState.current.blockingFailure = failures.length
        ? new AggregateError(
            failures,
            'Portico cannot authenticate until secure credential cleanup succeeds.',
          )
        : undefined;
      setWarning(failures.length ? 'auth.sign-out-storage-warning' : undefined);
    })();
    operationState.current.tail = signingOut.then(
      () => undefined,
      () => undefined,
    );
    return signingOut;
  }, [beginOperation, clearIssue, platform, publishSession, viewerRuntime]);

  const refreshPorticoAccount = useCallback(async () => {
    const response = await hostedClient.me();
    const user = response.user;
    if (!response.authenticated || !user) {
      throw new ProductMessageError('auth.session-expired');
    }
    const current = hostedSessionRef.current;
    if (current) {
      const next: HostedAccountSession = {...current, user: {...current.user, ...user}};
      await hostedCredentialStore.save(next);
      hostedSessionRef.current = next;
    }
    accountRef.current = user;
    setAccount(user);
  }, []);

  const beginProfileSelection = useCallback(async () => {
    const operation = beginOperation();
    return runLatest(operation, async () => {
      const active = sessionRef.current;
      if (active?.mode === 'local') {
        // The active profile-scoped session is now the account proof. Never
        // keep using the short-lived password bootstrap after sign-in.
        pendingLocalAuthentication.current = undefined;
        const directory = await awaitAuthProducer(
          active.client.accountProfiles({signal: operation.signal}),
          operation.signal,
        );
        assertAuthOperation(operation, operationState.current);
        if (
          directory.authority !== 'local' ||
          directory.accountId !== active.viewerScope.accountId ||
          directory.serverId !== active.viewerScope.serverId
        ) {
          throw new Error(
            'The active Local Auth session returned a mismatched profile directory.',
          );
        }
        setAvailableProfiles(
          [...directory.profiles].sort(
            (left, right) => left.sortOrder - right.sortOrder,
          ),
        );
      } else {
        pendingLocalAuthentication.current = undefined;
      }
      clearIssue();
      setProfileAwaitingPINId(undefined);
      setStatus('selecting-profile');
    });
  }, [beginOperation, clearIssue, runLatest]);

  const cancelLocalProfileReauthentication = useCallback(() => {
    setRequiresLocalProfileReauthentication(false);
    clearIssue();
    if (sessionRef.current) setStatus('authenticated');
  }, [clearIssue]);

  const retryServerDiscovery = useCallback(async () => {
    const operation = beginOperation();
    return runLatest(operation, async () => {
      const currentAccount = accountRef.current;
      const currentServer = selectedServerRef.current;
      if (currentAccount) {
        if (!sessionRef.current) setStatus('connecting');
        clearIssue();
        if (currentServer && availableProfiles.length) {
          await prepareHostedProfileSelection(
            currentServer,
            currentAccount.id,
            availableProfiles,
            operation,
          );
          return;
        }
        const lastServerId =
          currentServer?.id ??
          (await awaitAuthProducer(
            selectedServerStore.get().catch(() => undefined),
            operation.signal,
          )) ??
          undefined;
        assertAuthOperation(operation, operationState.current);
        await loadHostedServers(operation, lastServerId, currentAccount.id);
        return;
      }
      const stored = await awaitAuthProducer(
        Promise.resolve(serverCredentialAdapter.load?.()),
        operation.signal,
      );
      assertAuthOperation(operation, operationState.current);
      if (
        !stored?.apiBaseUrl ||
        !stored.accessToken ||
        !canRestoreWithoutHostedAccount(stored)
      ) {
        throw new Error('Sign in before looking for servers.');
      }
      await connectStoredServer(stored, operation);
    });
  }, [
    availableProfiles,
    beginOperation,
    clearIssue,
    connectStoredServer,
    loadHostedServers,
    prepareHostedProfileSelection,
    runLatest,
  ]);

  const reconcilePublishedServerSession = useCallback(
    (change: ServerSessionChange): void => {
      const active = sessionRef.current;
      const snapshot = viewerRuntime.getSnapshot();
      // Normal sign-out and profile/server replacement already own an awaited
      // transaction. Their credential publications must not start a competing
      // background reconciliation.
      if (!active || snapshot.transitioning) return;
      const current = change.current;
      if (!current) {
        const failure = new ProductMessageError('auth.session-expired');
        publishSession(undefined);
        viewerRuntime.forceClosed(failure);
        publishIssue(
          failure,
          'auth.session-expired',
          'server-connection',
          {serverName: active.serverName},
          {blocking: false},
        );
        setStatus(accountRef.current ? 'server-unavailable' : 'signed-out');
        return;
      }
      const nextScope = viewerScopeFromStoredServerSession(current);
      if (!nextScope) {
        const failure = new Error(
          'Portico received an unbound replacement server credential.',
        );
        publishSession(undefined);
        viewerRuntime.forceClosed(failure);
        publishIssue(
          failure,
          'auth.session-expired',
          'server-connection',
          {serverName: active.serverName},
          {blocking: false},
        );
        setStatus(accountRef.current ? 'server-unavailable' : 'signed-out');
        return;
      }
      if (!sameImmutableViewerIdentity(active.viewerScope, nextScope)) {
        // Candidate profile/server publication is only legal inside the
        // explicit staged transaction, where AppSession is already fenced.
        const failure = new Error(
          'Portico rejected a replacement credential for a different viewer.',
        );
        publishSession(undefined);
        viewerRuntime.forceClosed(failure);
        publishIssue(
          failure,
          'auth.session-expired',
          'server-connection',
          {serverName: active.serverName},
          {blocking: false},
        );
        setStatus(accountRef.current ? 'server-unavailable' : 'signed-out');
        return;
      }
      if (sameViewerScope(active.viewerScope, nextScope)) return;

      // Client Core can rotate the credential family during an ordinary API
      // request. Re-verify /me and publish the new authorization generation;
      // never leave React and the viewer runtime pinned to the old revision.
      void fenceServerSessionEnvironment();
      publishSession(undefined);
      const operation = beginOperation();
      void runLatest(operation, () => connectStoredServer(current, operation))
        .catch(cause => {
          if (!isAuthOperationAborted(cause)) {
            publishIssue(
              cause,
              'problem.server-unavailable',
              'server-connection',
              {serverName: active.serverName},
              {blocking: false},
            );
          }
        });
    },
    [
      beginOperation,
      connectStoredServer,
      publishIssue,
      publishSession,
      runLatest,
      viewerRuntime,
    ],
  );

  useEffect(
    () => subscribeServerSessionChanges(reconcilePublishedServerSession),
    [reconcilePublishedServerSession],
  );

  const refreshActiveHostedRoute = useCallback(
    (_request: ServerRouteRefreshRequest): Promise<boolean> => {
      if (routeRefreshInFlight.current) return routeRefreshInFlight.current;
      const active = sessionRef.current;
      const currentAccount = accountRef.current;
      const currentServer = selectedServerRef.current;
      if (
        !active ||
        active.mode !== 'portico-account' ||
        active.viewerScope.authority !== 'hosted' ||
        !currentAccount ||
        !currentServer ||
        status !== 'authenticated' ||
        currentAccount.id !== active.viewerScope.accountId ||
        currentServer.id !== active.viewerScope.serverId
      ) {
        return Promise.resolve(false);
      }
      const operation = beginOperation();
      const refresh = runLatest(operation, async () => {
        const instanceId = await clientMetadataId();
        await connectServer(
          currentServer,
          currentAccount.id,
          instanceId,
          undefined,
          operation,
          {backgroundRouteRefresh: true},
        );
        return true;
      })
        .catch(cause => {
          if (isAuthOperationAborted(cause)) return false;
          // A route-only replacement never demotes a still-valid viewer. The
          // normal request/player retry can ask again if the old route proves
          // unreachable after this bounded attempt.
          return false;
        })
        .finally(() => {
          if (routeRefreshInFlight.current === refresh) {
            routeRefreshInFlight.current = undefined;
          }
        });
      routeRefreshInFlight.current = refresh;
      return refresh;
    },
    [beginOperation, connectServer, runLatest, status],
  );

  useEffect(
    () => subscribeServerRouteRefreshRequests(refreshActiveHostedRoute),
    [refreshActiveHostedRoute],
  );

  useEffect(() => {
    let unsubscribe: (() => void) | undefined;
    let disposed = false;
    const coordinator = new NativeNetworkRouteRefreshCoordinator(() => {
      void requestServerRouteRefresh({reason: 'network-transition'});
    });
    void import('@react-native-community/netinfo')
      .then(({default: NetInfo}) => {
        if (disposed) return;
        unsubscribe = NetInfo.addEventListener(state => coordinator.update({
          type: state.type,
          isConnected: state.isConnected,
          isInternetReachable: state.isInternetReachable,
          details: state.details as Readonly<Record<string, unknown>> | null,
        }));
      })
      .catch(() => undefined);
    return () => {
      disposed = true;
      unsubscribe?.();
      coordinator.dispose();
    };
  }, []);

  const retrySecureStorageRecovery = useCallback(async () => {
    const cleanupOutcome = await settleBeforeDeadline(
      retryPendingCredentialCleanup(),
    );
    if (cleanupOutcome.timedOut) {
      const timeout = new Error(
        'Portico could not verify saved credential cleanup before the recovery deadline.',
      );
      timeout.name = 'CredentialCleanupRecoveryDeadlineError';
      operationState.current.blockingFailure = timeout;
      setWarning('auth.sign-out-storage-warning');
      throw timeout;
    }
    if (cleanupOutcome.status === 'rejected') {
      operationState.current.blockingFailure = cleanupOutcome.reason;
      setWarning('auth.sign-out-storage-warning');
      throw cleanupOutcome.reason;
    }

    operationState.current.blockingFailure = undefined;
    viewerRuntime.forceClosed();
    setHostedAccessToken(undefined);
    setServerSession(undefined);
    publishSession(undefined);
    setError(undefined);
    clearIssue();
    setWarning(undefined);
    setStatus('signed-out');
  }, [clearIssue, publishSession, viewerRuntime]);

  const value = useMemo<AuthContextValue>(
    () => ({
      status,
      account,
      accountDeviceId: hostedSessionRef.current?.device?.id,
      session: observableSession,
      selectedServer,
      error,
      serverError,
      issue,
      canAccessOfflineDownloads: Boolean(
        viewerRuntimeSnapshot.scope &&
          viewerRuntimeSnapshot.acceptingWrites &&
          !viewerRuntimeSnapshot.transitioning,
      ),
      warning,
      profileAwaitingPINId,
      requiresLocalProfileReauthentication,
      signInWithPortico,
      registerPorticoAccount,
      requestPasswordReset,
      signInWithLocalAuth,
      completeDeviceAuthorization,
      completeNearbyTVSetup,
      beginProfileSelection,
      cancelLocalProfileReauthentication,
      chooseProfile,
      chooseServer,
      retryServerDiscovery,
      retrySecureStorageRecovery,
      availableProfiles,
      availableServers,
      serverConnectionStates,
      signOut,
      refreshPorticoAccount,
      clearError: () => {
        setError(undefined);
        clearIssue();
        setWarning(undefined);
      },
    }),
    [
      account,
      availableProfiles,
      availableServers,
      beginProfileSelection,
      cancelLocalProfileReauthentication,
      chooseProfile,
      chooseServer,
      completeDeviceAuthorization,
      completeNearbyTVSetup,
      error,
      issue,
      registerPorticoAccount,
      requestPasswordReset,
      refreshPorticoAccount,
      retryServerDiscovery,
      retrySecureStorageRecovery,
      selectedServer,
      serverError,
      serverConnectionStates,
      observableSession,
      signInWithLocalAuth,
      signInWithPortico,
      signOut,
      status,
      clearIssue,
      warning,
      profileAwaitingPINId,
      requiresLocalProfileReauthentication,
      viewerRuntimeSnapshot.acceptingWrites,
      viewerRuntimeSnapshot.scope,
      viewerRuntimeSnapshot.transitioning,
    ],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function usePorticoAuth(): AuthContextValue {
  const context = useContext(AuthContext);
  if (!context)
    throw new Error('usePorticoAuth must be used inside PorticoAuthProvider.');
  return context;
}

function viewerTransitionReason(
  current: ViewerScope | undefined,
  scope: ViewerScope,
): ProfileTransitionReason {
  if (!current) return 'profile-switch';
  let reason: ProfileTransitionReason = 'profile-switch';
  if (
    current.authority !== scope.authority ||
    current.accountId !== scope.accountId ||
    current.serverId !== scope.serverId
  )
    reason = 'server-switch';
  else if (
    current.authority === scope.authority &&
    current.accountId === scope.accountId &&
    current.profileId === scope.profileId &&
    current.authorizationRevision !== scope.authorizationRevision
  )
    reason = 'authorization-changed';
  return reason;
}

function assertAuthOperation(
  operation: AuthOperation,
  state: {controller?: AbortController; generation: number},
): void {
  if (
    operation.signal.aborted ||
    operation.generation !== state.generation ||
    state.controller !== operation.controller
  ) {
    throw new AuthOperationAbortedError();
  }
}

function isAuthOperationAborted(value: unknown): boolean {
  return (
    value instanceof AuthOperationAbortedError ||
    (value instanceof Error && value.name === 'AbortError')
  );
}

function isSecurityCriticalAuthFailure(value: unknown): boolean {
  if (value instanceof CredentialCleanupUncertainError) return true;
  if (value instanceof TrustedServerDurabilityUncertainError) return true;
  if (value instanceof ViewerRuntimeTeardownError) return true;
  if (value instanceof TrustedServerCredentialPublicationError) {
    return value.failClosed || value.rollbackFailures.length > 0;
  }
  if (value instanceof AggregateError) {
    // Route probing and other ordinary fan-out work can legitimately report
    // an AggregateError. It is security-critical only when at least one
    // contained failure is itself an explicit durability/cleanup/teardown
    // failure; a group of network errors must never erase a valid account.
    return value.errors.some(
      error => error !== value && isSecurityCriticalAuthFailure(error),
    );
  }
  if (!value || typeof value !== 'object') return false;
  const candidate = value as {cause?: unknown};
  // Never trust a remote or structurally similar `name`/`code` as proof of a
  // local secure-storage failure. Only locally constructed class instances
  // above are allowed to trigger account-wide credential quarantine.
  return (
    candidate.cause !== value && isSecurityCriticalAuthFailure(candidate.cause)
  );
}

function sameCredentialFamily(
  actual: LocalServerSession | undefined,
  expected: LocalServerSession,
): boolean {
  return Boolean(
    actual?.accessToken &&
    actual.refreshToken &&
    actual.accessToken === expected.accessToken &&
    actual.refreshToken === expected.refreshToken &&
    actual.apiBaseUrl === expected.apiBaseUrl &&
    actual.serverId === expected.serverId,
  );
}

function sameHostedCredentialFamily(
  actual: HostedAccountSession | undefined,
  expected: HostedAccountSession,
): boolean {
  return Boolean(
    actual?.accessToken &&
    actual.refreshToken &&
    actual.accessToken === expected.accessToken &&
    actual.refreshToken === expected.refreshToken &&
    actual.user.id === expected.user.id &&
    actual.device?.id === expected.device?.id,
  );
}

function awaitAuthProducer<T>(
  producer: Promise<T>,
  signal: AbortSignal,
  timeoutMilliseconds = 15_000,
): Promise<T> {
  if (signal.aborted) return Promise.reject(new AuthOperationAbortedError());
  return new Promise<T>((resolve, reject) => {
    let settled = false;
    const finish = (callback: () => void) => {
      if (settled) return;
      settled = true;
      clearTimeout(timeout);
      signal.removeEventListener('abort', abort);
      callback();
    };
    const abort = () => finish(() => reject(new AuthOperationAbortedError()));
    const timeout = setTimeout(
      () =>
        finish(() =>
          reject(new Error('The authentication request timed out.')),
        ),
      timeoutMilliseconds,
    );
    signal.addEventListener('abort', abort, {once: true});
    producer.then(
      value => finish(() => resolve(value)),
      cause => finish(() => reject(cause)),
    );
  });
}

/**
 * A Core connection may ignore AbortSignal before it reaches RN's staged
 * runtime callback. That phase is still isolated, so a newer choice may stop
 * waiting. Once the callback starts, credential publication or compensation
 * must reach a proven settlement before the operation tail can advance.
 */
function awaitIsolatedAuthProducer<T>(
  producer: Promise<T>,
  signal: AbortSignal,
  transactionStarted: () => boolean,
): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    let settled = false;
    const finish = (callback: () => void) => {
      if (settled) return;
      settled = true;
      signal.removeEventListener('abort', abort);
      callback();
    };
    const abort = () => {
      if (transactionStarted()) return;
      finish(() => reject(new AuthOperationAbortedError()));
    };
    signal.addEventListener('abort', abort);
    producer.then(
      value => finish(() => resolve(value)),
      cause => finish(() => reject(cause)),
    );
    if (signal.aborted) abort();
  });
}

function assertStoredSessionViewerScope(
  session: StoredServerSession,
  scope: ViewerScope,
): void {
  if (session.serverId && session.serverId !== scope.serverId) {
    throw new Error(
      'The saved server session returned a different server identity.',
    );
  }
  if (session.authenticationMode === 'portico-account') {
    if (scope.authority !== 'hosted') {
      throw new Error(
        'The saved Portico Account session returned a local viewing scope.',
      );
    }
    if (
      session.hostedAccountId &&
      session.hostedAccountId !== scope.accountId
    ) {
      throw new Error(
        'The saved Portico Account session returned a different account identity.',
      );
    }
    return;
  }
  if (scope.authority !== 'local') {
    throw new Error(
      'The saved Local Auth session returned a hosted viewing scope.',
    );
  }
}

function isScopeBoundStoredSession(
  session: StoredServerSession,
): session is StoredServerSession & NativeSessionCredentials {
  const candidate = session as StoredServerSession &
    Partial<NativeSessionCredentials>;
  return Boolean(
    (candidate.authority === 'hosted' || candidate.authority === 'local') &&
    candidate.accountId?.trim() &&
    candidate.serverId?.trim() &&
    candidate.profileId?.trim() &&
    candidate.authorizationRevision?.trim(),
  );
}

function viewerScopeFromStoredServerSession(
  session: StoredServerSession,
): ViewerScope | undefined {
  if (!isScopeBoundStoredSession(session)) return undefined;
  return {
    authority: session.authority,
    accountId: session.accountId,
    serverId: session.serverId,
    profileId: session.profileId,
    authorizationRevision: session.authorizationRevision,
  };
}

function sameImmutableViewerIdentity(
  left: ViewerScope,
  right: ViewerScope,
): boolean {
  return left.authority === right.authority
    && left.accountId === right.accountId
    && left.serverId === right.serverId
    && left.profileId === right.profileId;
}

async function revokeCapturedServerSession(
  platform: PorticoPlatform,
  session: StoredServerSession,
): Promise<void> {
  const refreshToken = session.refreshToken;
  if (!refreshToken) return;
  const isolatedStore = createMemorySessionStore(session);
  try {
    const instanceId = await clientMetadataId();
    await createServerClient(
      platform,
      instanceId,
      isolatedStore,
      null,
    ).revokeNativeSession(refreshToken);
  } finally {
    isolatedStore.clear?.();
  }
}

async function revokeCapturedServerSessions(
  platform: PorticoPlatform,
  active: StoredServerSession | undefined,
  accountId: string | undefined,
): Promise<void> {
  const trusted = accountId
    ? await trustedServerConnectionAdapter.list(accountId).catch(() => [])
    : [];
  const sessions = [active, ...trusted.map(record => record.session)].filter(
    (session): session is StoredServerSession => Boolean(session),
  );
  const unique = new Map<string, StoredServerSession>();
  for (const session of sessions) {
    if (session.refreshToken && !unique.has(session.refreshToken)) {
      unique.set(session.refreshToken, session);
    }
  }
  await Promise.allSettled(
    [...unique.values()].map(session =>
      revokeCapturedServerSession(platform, session),
    ),
  );
}

function settleBoundedRemoteRevocation(
  producer: () => Promise<unknown>,
): Promise<void> {
  return new Promise(resolve => {
    let settled = false;
    const finish = () => {
      if (settled) return;
      settled = true;
      clearTimeout(deadline);
      resolve();
    };
    const deadline = setTimeout(finish, AUTH_SECURITY_DEADLINE_MS);
    Promise.resolve().then(producer).then(finish, finish);
  });
}

type DeadlineOutcome<T> =
  | {timedOut: true}
  | {timedOut: false; status: 'fulfilled'; value: T}
  | {timedOut: false; status: 'rejected'; reason: unknown};

function settleBeforeDeadline<T>(
  operation: Promise<T>,
): Promise<DeadlineOutcome<T>> {
  return new Promise(resolve => {
    let settled = false;
    const finish = (outcome: DeadlineOutcome<T>) => {
      if (settled) return;
      settled = true;
      clearTimeout(deadline);
      resolve(outcome);
    };
    const deadline = setTimeout(
      () => finish({timedOut: true}),
      AUTH_SECURITY_DEADLINE_MS,
    );
    operation.then(
      value => finish({timedOut: false, status: 'fulfilled', value}),
      reason => finish({timedOut: false, status: 'rejected', reason}),
    );
  });
}

async function quarantineAllCredentials(
  scope: Parameters<typeof beginCredentialCleanup>[0],
): Promise<void> {
  logNativeDiagnostic('quarantine-start', {
    authority: scope?.authority ?? 'unknown',
    accountScoped: Boolean(scope?.accountId),
    serverScoped: Boolean(scope?.serverId),
  });
  const markerOutcome = await settleBeforeDeadline(
    beginCredentialCleanup(scope),
  );
  if (!markerOutcome.timedOut && markerOutcome.status === 'fulfilled') {
    await finishCredentialCleanup(markerOutcome.value);
    logNativeDiagnostic('quarantine-finished', {completed: true});
    return;
  }

  const barrierFailure = markerOutcome.timedOut
    ? new Error(
        'Portico could not confirm the secure cleanup barrier before the security deadline.',
      )
    : markerOutcome.reason;
  await deleteAllCredentialsRetainingCleanupBarrier();
  throw barrierFailure;
}

async function currentHostedSession(
  session: HostedAccountSession,
  operation: AuthOperation,
  state: {controller?: AbortController; generation: number},
): Promise<HostedAccountSession> {
  let pendingRotation = await hostedRefreshRotationStore.load();
  const durableSession = await hostedCredentialStore.load();
  let rotationSession = session;
  let forcePendingRecovery = false;
  if (
    pendingRotation &&
    pendingRotation.oldRefreshToken !== session.refreshToken
  ) {
    if (
      durableSession?.refreshToken === pendingRotation.oldRefreshToken ||
      !durableSession
    ) {
      // Hosted Services accepted the old token but Keychain did not publish
      // the successor. The in-memory family may already be the successor; the
      // journal must still replay its exact old-token/key pair so that a crash
      // cannot strand the durable old token as apparent reuse.
      rotationSession = {
        ...(durableSession ?? session),
        refreshToken: pendingRotation.oldRefreshToken,
      };
      forcePendingRecovery = true;
    } else {
      // The successor was committed before a crash interrupted journal
      // cleanup. Only the durable family can prove this journal is stale.
      await hostedRefreshRotationStore.clear();
      pendingRotation = undefined;
    }
  }
  if (
    !forcePendingRecovery &&
    Date.parse(session.accessExpiresAt) - Date.now() > 60_000
  )
    return session;
  if (!pendingRotation) {
    pendingRotation = {
      authority: 'hosted',
      createdAt: new Date().toISOString(),
      oldRefreshToken: rotationSession.refreshToken,
      rotationKey: createHostedRefreshRotationKey(),
      version: 'v1',
    };
    await hostedRefreshRotationStore.save(pendingRotation);
    const persistedRotation = await hostedRefreshRotationStore.load();
    if (!sameHostedRefreshRotation(persistedRotation, pendingRotation)) {
      throw new Error(
        'Portico could not verify the refresh recovery journal in secure storage.',
      );
    }
  }
  let refreshed: HostedAccountSession;
  try {
    const instanceId = await awaitAuthProducer(
      optionalInstallationId(),
      operation.signal,
    );
    assertAuthOperation(operation, state);
    refreshed = await awaitAuthProducer(
      hostedClient.refreshNativeSession({
        refreshToken: rotationSession.refreshToken,
        rotationKey: pendingRotation.rotationKey,
        ...(instanceId ? {installationId: instanceId} : {}),
      }),
      operation.signal,
    );
    assertAuthOperation(operation, state);
  } catch (cause) {
    if (isAuthOperationAborted(cause)) throw cause;
    if (isTerminalHostedRefreshFailure(cause)) {
      await clearTerminalHostedAccountState(session);
      throw cause;
    }
    // A transport outage cannot prove that the durable device session was
    // revoked. Keep its local account identity so protected offline media is
    // still reachable; every online request continues to require a successful
    // token refresh or server session before it can access remote data.
    if (Date.parse(session.accessExpiresAt) <= Date.now()) {
      throw new HostedRefreshDeferredError(cause);
    }
    return session;
  }
  // Refresh tokens rotate. Once Hosted Services accepts the old token it must
  // never be restored to memory merely because Keychain briefly failed. Retry
  // the atomic credential-family write, then retain the newly issued family in
  // memory even if persistence remains unavailable; this launch can continue
  // safely and will never submit the consumed token again.
  for (let attempt = 0; attempt < 3; attempt += 1) {
    try {
      await hostedCredentialStore.save(refreshed);
      const persisted = await hostedCredentialStore.load();
      if (!sameHostedCredentialFamily(persisted, refreshed)) {
        throw new Error(
          'The refreshed Portico Account credential family was not committed to secure storage.',
        );
      }
      assertAuthOperation(operation, state);
      await hostedRefreshRotationStore.clear();
      return refreshed;
    } catch (cause) {
      if (isAuthOperationAborted(cause)) throw cause;
      // Retry immediately. The storage adapter performs the serialized,
      // atomic Keychain operation; delaying here only widens the crash window
      // after Hosted Services has consumed the previous refresh token.
    }
  }
  assertAuthOperation(operation, state);
  return refreshed;
}

/** Internal test seam for crash-window credential recovery. */
export const __authRecoveryTestHooks = {
  currentHostedSession,
  isSecurityCriticalAuthFailure,
};

function logAuthDiagnostic(stage: string, cause: unknown): void {
  // The support boundary records only an error class/code and a bounded phase;
  // raw messages can contain account, route, profile, or credential material.
  const diagnostic = recordPorticoErrorDiagnostic('auth-failure', cause, {phase: stage});
  logNativeDiagnostic('auth-failure', diagnostic);
}

class HostedRefreshDeferredError extends Error {
  constructor(cause: unknown) {
    super(
      'Portico could not refresh this account while Hosted Services was unavailable.',
    );
    (this as Error & {cause?: unknown}).cause = cause;
    this.name = 'HostedRefreshDeferredError';
  }
}

function isTerminalHostedRefreshFailure(value: unknown): boolean {
  return (
    value instanceof ApiError &&
    ['invalid_refresh_token', 'refresh_token_reuse'].includes(value.code)
  );
}

async function clearTerminalHostedAccountState(
  session: HostedAccountSession,
): Promise<void> {
  const singleton = await serverCredentialAdapter
    .load?.()
    .catch(() => undefined);
  const active = getServerSession();
  if (active && isHostedAccountServerSession(active, session.user.id)) {
    setServerSession(undefined);
  }
  setHostedAccessToken(undefined);
  const cleanup = await Promise.allSettled([
    hostedCredentialStore.clear(),
    hostedRefreshRotationStore.clear(),
    trustedServerConnectionAdapter.clearAccount(session.user.id),
    selectedServerStore.clear(),
    singleton && isHostedAccountServerSession(singleton, session.user.id)
      ? serverCredentialAdapter.clear()
      : Promise.resolve(),
  ]);
  const failures = cleanup.flatMap(result =>
    result.status === 'rejected' ? [result.reason] : [],
  );
  if (failures.length) {
    throw new AggregateError(
      failures,
      'Portico could not clear every rejected Hosted credential copy.',
    );
  }
}

function sameHostedRefreshRotation(
  left: HostedRefreshRotationJournal | undefined,
  right: HostedRefreshRotationJournal,
): boolean {
  return Boolean(
    left?.version === right.version &&
      left.authority === right.authority &&
      left.oldRefreshToken === right.oldRefreshToken &&
      left.rotationKey === right.rotationKey &&
      left.createdAt === right.createdAt,
  );
}

function createHostedRefreshRotationKey(): string {
  const bytes = new Uint8Array(32);
  const crypto = (
    globalThis as typeof globalThis & {
      crypto: {
        getRandomValues<T extends ArrayBufferView | null>(array: T): T;
      };
    }
  ).crypto;
  crypto.getRandomValues(bytes);
  return [...bytes]
    .map(byte => byte.toString(16).padStart(2, '0'))
    .join('');
}

function normalizeServerURL(value: string): string {
  const trimmed = value.trim().replace(/\/+$/, '');
  if (!trimmed) throw new ProductMessageError('problem.invalid-request');
  const withScheme = /^https?:\/\//i.test(trimmed)
    ? trimmed
    : `https://${trimmed}`;
  let parsed: URL & {
    hash: string;
    hostname: string;
    origin: string;
    password: string;
    pathname: string;
    protocol: string;
    search: string;
    username: string;
  };
  try {
    parsed = new URL(withScheme) as typeof parsed;
  } catch {
    throw new ProductMessageError('problem.invalid-request');
  }
  if (
    (parsed.protocol !== 'https:' && parsed.protocol !== 'http:') ||
    parsed.username ||
    parsed.password ||
    parsed.search ||
    parsed.hash ||
    (parsed.pathname !== '' && parsed.pathname !== '/')
  ) {
    throw new ProductMessageError('problem.invalid-request');
  }
  const hostname = parsed.hostname.toLowerCase();
  const loopback = ['localhost', '127.0.0.1', '::1', '[::1]'].includes(
    hostname,
  );
  if (parsed.protocol !== 'https:' && !loopback) {
    throw new ProductMessageError('problem.invalid-request');
  }
  return parsed.origin;
}

export function isMFARequired(value: unknown): boolean {
  return value instanceof ApiError && value.code === 'mfa_required';
}
