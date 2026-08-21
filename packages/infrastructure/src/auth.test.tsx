import React from 'react';
import ReactTestRenderer from 'react-test-renderer';
import {
  ApiError,
  CredentialCleanupUncertainError,
  TrustedServerCredentialPublicationError,
  defaultAccountServerInstallationPreferences,
  defaultProfileDeviceClassPreferences,
  defaultProfileServerPreferences,
  type AuthMeResponse,
  type HostedServer,
  type NativeSessionCredentials,
  type PorticoProfile,
  type ProfileAccountAuthenticationResponse,
  type ProfileSelectionGrant,
  type ViewerScope,
} from '@portico/client-core';
import {
  __authRecoveryTestHooks,
  HOSTED_SERVER_DIRECTORY_PAGE_SIZE,
  loadAllHostedServers,
  PorticoAuthProvider,
  usePorticoAuth,
} from './auth';
import {
  PorticoViewerRuntimeProvider,
  ViewerRuntimeCoordinator,
} from './viewerRuntime';

jest.mock('./clientEnvironment', () => ({
  announceCurrentServerRouteChange: jest.fn(),
  beginServerSessionEnvironment: jest.fn(() => ({
    generation: 1,
    drain: jest.fn().mockResolvedValue(undefined),
    activate: jest.fn(),
    fence: jest.fn(),
    rollback: jest.fn(),
    failClosed: jest.fn(),
  })),
  connectAccountServer: jest.fn(),
  createServerClient: jest.fn(),
  getServerSession: jest.fn(),
  hostedClient: {
    createNativeSession: jest.fn(),
    createProfileSelectionEnvelope: jest.fn(),
    profiles: jest.fn(),
    refreshNativeSession: jest.fn(),
    register: jest.fn(),
    requestPasswordReset: jest.fn(),
    revokeNativeSession: jest.fn(),
    servers: jest.fn(),
  },
  NativeNetworkRouteRefreshCoordinator: jest.fn().mockImplementation(() => ({
    dispose: jest.fn(),
    update: jest.fn(),
  })),
  requestServerRouteRefresh: jest.fn().mockResolvedValue(false),
  refreshAccountServerRoute: jest.fn(),
  subscribeServerRouteRefreshRequests: jest.fn(() => jest.fn()),
  subscribeServerSessionChanges: jest.fn(() => jest.fn()),
  setHostedAccessToken: jest.fn(),
  setServerSession: jest.fn(),
  serverSessionEnvironmentMatches: jest.fn(() => true),
  fenceServerSessionEnvironment: jest.fn().mockResolvedValue(undefined),
}));

jest.mock('./secureStorage', () => ({
  CredentialCleanupUncertainError: class CredentialCleanupUncertainError extends Error {},
  beginCredentialCleanup: jest.fn(),
  canRestoreWithoutHostedAccount: jest.fn(
    session => session.authenticationMode === 'local',
  ),
  clearAllCredentials: jest.fn(),
  deleteAllCredentialsRetainingCleanupBarrier: jest.fn(),
  finishCredentialCleanup: jest.fn(),
  hostedServerSession: jest.fn((session, accountId) => ({
    ...session,
    authenticationMode: 'portico-account',
    hostedAccountId: accountId,
  })),
  isHostedAccountServerSession: jest.fn(
    session => session.authenticationMode === 'portico-account',
  ),
  localServerSession: jest.fn(session => ({
    ...session,
    authenticationMode: 'local',
  })),
  retryPendingCredentialCleanup: jest.fn(),
  hostedCredentialStore: {load: jest.fn(), save: jest.fn(), clear: jest.fn()},
  hostedRefreshRotationStore: {
    load: jest.fn(),
    save: jest.fn(),
    clear: jest.fn(),
  },
  serverCredentialAdapter: {load: jest.fn(), save: jest.fn(), clear: jest.fn()},
  trustedServerConnectionAdapter: {
    list: jest.fn(),
    load: jest.fn(),
    save: jest.fn(),
    remove: jest.fn(),
    clearAccount: jest.fn(),
  },
}));

jest.mock('./installation', () => ({
  clientMetadataId: jest.fn(async () => 'installation-1'),
  installationId: jest.fn(async () => 'installation-1'),
  optionalInstallationId: jest.fn(async () => 'installation-1'),
  profileSelectionStore: {
    get: jest.fn(),
    recordVerifiedSelection: jest.fn(),
    set: jest.fn(),
  },
  selectedServerStore: {
    get: jest.fn(async () => undefined),
    set: jest.fn(),
    clear: jest.fn(),
  },
}));

const mockEnvironment = jest.requireMock('./clientEnvironment') as {
  beginServerSessionEnvironment: jest.Mock;
  connectAccountServer: jest.Mock;
  createServerClient: jest.Mock;
  getServerSession: jest.Mock;
  setHostedAccessToken: jest.Mock;
  setServerSession: jest.Mock;
  serverSessionEnvironmentMatches: jest.Mock;
  fenceServerSessionEnvironment: jest.Mock;
  hostedClient: {
    createNativeSession: jest.Mock;
    createProfileSelectionEnvelope: jest.Mock;
    profiles: jest.Mock;
    refreshNativeSession: jest.Mock;
    register: jest.Mock;
    requestPasswordReset: jest.Mock;
    revokeNativeSession: jest.Mock;
    servers: jest.Mock;
  };
  requestServerRouteRefresh: jest.Mock;
  refreshAccountServerRoute: jest.Mock;
  subscribeServerRouteRefreshRequests: jest.Mock;
  subscribeServerSessionChanges: jest.Mock;
};
const mockInstallation = jest.requireMock('./installation') as {
  optionalInstallationId: jest.Mock;
  profileSelectionStore: {
    get: jest.Mock;
    recordVerifiedSelection: jest.Mock;
    set: jest.Mock;
  };
  selectedServerStore: {get: jest.Mock; set: jest.Mock; clear: jest.Mock};
};
const mockStorage = jest.requireMock('./secureStorage') as {
  beginCredentialCleanup: jest.Mock;
  clearAllCredentials: jest.Mock;
  deleteAllCredentialsRetainingCleanupBarrier: jest.Mock;
  finishCredentialCleanup: jest.Mock;
  hostedCredentialStore: {load: jest.Mock; save: jest.Mock; clear: jest.Mock};
  hostedRefreshRotationStore: {
    load: jest.Mock;
    save: jest.Mock;
    clear: jest.Mock;
  };
  serverCredentialAdapter: {load: jest.Mock; save: jest.Mock; clear: jest.Mock};
  retryPendingCredentialCleanup: jest.Mock;
  trustedServerConnectionAdapter: {
    list: jest.Mock;
    load: jest.Mock;
    save: jest.Mock;
    remove: jest.Mock;
    clearAccount: jest.Mock;
  };
};

type AuthValue = ReturnType<typeof usePorticoAuth>;
let auth: AuthValue;
let viewerRuntime: ViewerRuntimeCoordinator;
let durableServerCredential: Record<string, unknown> | undefined;
let durableHostedCredential: typeof accountSession | undefined;
let durableHostedRefreshRotation:
  | {
      authority: 'hosted';
      createdAt: string;
      oldRefreshToken: string;
      rotationKey: string;
      version: 'v1';
    }
  | undefined;
let durableSelectedServerId: string | undefined;

function Probe() {
  auth = usePorticoAuth();
  return null;
}

const accountSession = {
  tokenType: 'Bearer',
  accessToken: 'hosted-access',
  refreshToken: 'hosted-refresh',
  accessExpiresAt: '2999-01-01T00:00:00.000Z',
  refreshExpiresAt: '2999-02-01T00:00:00.000Z',
  device: {
    id: 'device-1',
    lastSeenAt: '2026-07-13T12:00:00.000Z',
    name: 'Portico Apple TV',
    platform: 'tvOS',
    userId: 'user-1',
  },
  user: {
    createdAt: '2026-01-01T00:00:00.000Z',
    id: 'user-1',
    email: 'viewer@example.com',
    username: 'viewer',
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

const server = {
  id: 'server-1',
  name: 'Home',
  availabilityState: 'online',
  connectionDocumentUrl: 'https://hosted.test/server',
} as unknown as HostedServer;
const serverUser = {
  authOrigin: 'local' as const,
  displayName: 'Viewer',
  email: 'viewer@example.com',
  hasLocalPassword: true,
  id: 'server-user-1',
  libraryIds: [],
  permissions: {},
  preferences: {
    audioLanguage: 'en',
    dateFormat: 'medium' as const,
    hourCycle: 'auto' as const,
    locale: 'en-CA',
    musicPlayback: {
      autoplayDefault: true,
      crossfadeSeconds: 0,
      gapless: true,
      normalizationMode: 'off' as const,
      repeatDefault: 'none' as const,
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
  role: 'user' as const,
  username: 'viewer',
};
const serverDevice = {
  app: 'Portico',
  autoName: 'Portico iPhone',
  createdAt: '2026-01-01T00:00:00.000Z',
  id: 'local-device-1',
  installationId: 'installation-1',
  lastSeenAt: '2026-07-13T12:00:00.000Z',
  name: 'Portico iPhone',
  options: {},
  platform: 'iOS',
  sessionCount: 1,
  trusted: true,
  user: 'viewer',
  userId: 'server-user-1',
};
const hostedViewerIdentity: AuthMeResponse = {
  authenticated: true,
  setupRequired: false,
  authority: 'hosted' as const,
  accountId: 'user-1',
  serverId: 'server-1',
  profileId: 'profile-1',
  authorizationRevision: 'authorization-1',
  user: {...serverUser, authOrigin: 'portico', authProvider: 'portico'},
};
const connectedPreferenceClient = {
  viewerPreferenceBundle: jest.fn(),
  recordViewerProfileActivation: jest.fn(),
};
const profile: PorticoProfile = {
  hasPIN: false,
  id: 'profile-1',
  isAccountAdmin: true,
  isPrimary: true,
  name: 'Viewer',
  pinRevision: 0,
  policy: {
    allowDownloads: true,
    allowDvr: true,
    allowFeedback: true,
    allowLiveTV: true,
    allowUnrated: true,
    allowWatchWithFriends: true,
    blockedLabels: [],
    maximumAgeRating: null,
    version: 'v1',
  },
  sortOrder: 0,
};
const localProfile: PorticoProfile = {...profile, id: 'local-profile-1'};
const secondLocalProfile: PorticoProfile = {
  ...profile,
  id: 'local-profile-2',
  isAccountAdmin: false,
  isPrimary: false,
  name: 'Guest',
  sortOrder: 1,
};
const localAuthentication: ProfileAccountAuthenticationResponse = {
  accountAuthenticationToken: 'local-account-proof',
  expiresAt: '2999-01-01T00:00:00.000Z',
  directory: {
    accountId: 'local-account-1',
    authority: 'local' as const,
    profiles: [localProfile],
    profilesAllowed: true,
    serverId: 'local-server-1',
  },
};
const localGrant: ProfileSelectionGrant = {
  accountId: 'local-account-1',
  authority: 'local' as const,
  expiresAt: '2999-01-01T00:00:00.000Z',
  installationId: 'legacy-installation-metadata',
  pinRevision: 0,
  profileId: 'local-profile-1',
  serverId: 'local-server-1',
  token: 'local-selection-grant',
};
const localCredentials: NativeSessionCredentials = {
  accessExpiresAt: '2999-01-01T00:00:00.000Z',
  accessToken: 'local-access',
  accountId: 'local-account-1',
  authority: 'local' as const,
  authorizationRevision: 'local-authorization-1',
  device: serverDevice,
  profileId: 'local-profile-1',
  refreshExpiresAt: '2999-02-01T00:00:00.000Z',
  refreshToken: 'local-refresh',
  serverFriendlyName: 'Local Home',
  serverId: 'local-server-1',
  tokenType: 'Bearer' as const,
  user: serverUser,
};
const localViewerIdentity: AuthMeResponse = {
  authenticated: true,
  setupRequired: false,
  authority: 'local' as const,
  accountId: 'local-account-1',
  serverId: 'local-server-1',
  profileId: 'local-profile-1',
  authorizationRevision: 'local-authorization-1',
  user: serverUser,
};
const selectionEnvelope = {
  accountId: 'user-1',
  accountRevision: 1,
  assertionId: 'assertion-1',
  audience: 'portico-media-server',
  deviceId: 'device-1',
  expiresAt: '2999-01-01T00:00:00.000Z',
  installationId: 'installation-1',
  issuedAt: '2026-01-01T00:00:00.000Z',
  pinRevision: 0,
  profileId: 'profile-1',
  profiles: [],
  serverId: 'server-1',
  signature: 'signature',
  signatureAlgorithm: 'ed25519',
  signatureKeyId: 'key-1',
  version: 'v1',
};

function serverPage(items: HostedServer[]) {
  return {
    items,
    pageInfo: {hasMore: false, nextCursor: null},
  };
}

const nearbyTVGrant = {
  accountAccessExpiresAt: accountSession.accessExpiresAt,
  accountAccessToken: 'ptc_acc_nearby-account-access',
  accountRefreshExpiresAt: accountSession.refreshExpiresAt,
  accountRefreshToken: 'ptc_rft_nearby-account-refresh',
  authProvider: 'portico-account' as const,
  email: accountSession.user.email,
  grantExpiresAt: '2999-01-01T00:00:00.000Z',
  issuedAt: '2026-07-13T00:00:00.000Z',
  role: 'viewer',
  serverId: 'server-1',
  serverUrl: 'https://server-1.direct.getportico.tv:32500',
  setupCode: 'ABCD-2345',
  setupSessionId: 'setup-1',
  userId: accountSession.user.id,
  username: accountSession.user.email,
};

function connectResult(identity: AuthMeResponse = hostedViewerIdentity) {
  return {
    durability: 'durable' as const,
    serverSession: {accessToken: 'server-access'},
    identity,
    localClient: {
      ...connectedPreferenceClient,
      viewerPreferenceBundle: async (input: {
        deviceClass: 'mobile' | 'television';
        installationId: string;
      }) => {
        const response = await connectedPreferenceClient.viewerPreferenceBundle(input);
        return {
          ...response,
          identity: {
            ...response.identity,
            authority: identity.authority,
            accountId: identity.accountId,
            serverId: identity.serverId,
            profileId: identity.profileId,
          },
        };
      },
    },
    persistencePolicy: 'saved-session' as const,
  };
}

function connectImplementation(
  identity: AuthMeResponse = hostedViewerIdentity,
) {
  return async (...args: unknown[]) => {
    const stageCandidate = args[5] as (candidate: {
      identity: AuthMeResponse;
      record: {accountId: string; serverId: string; session: object};
      scope: ViewerScope;
      session: object;
      source: 'hosted';
    }) => Promise<{
      publish(): Promise<void> | void;
      rollback(): Promise<void> | void;
    }>;
    const result = connectResult(identity);
    const staged = await stageCandidate({
      identity,
      record: {
        accountId: identity.accountId!,
        serverId: identity.serverId!,
        session: result.serverSession,
      },
      scope: {
        accountId: identity.accountId!,
        authority: identity.authority!,
        authorizationRevision: identity.authorizationRevision!,
        profileId: identity.profileId!,
        serverId: identity.serverId!,
      },
      session: result.serverSession,
      source: 'hosted',
    });
    await staged.publish();
    return result;
  };
}

function refreshRouteImplementation(
  identity: AuthMeResponse = hostedViewerIdentity,
) {
  return async (...args: unknown[]) => {
    const stageCandidate = args[4] as (candidate: {
      identity: AuthMeResponse;
      record: {accountId: string; serverId: string; session: object};
      scope: ViewerScope;
      session: object;
      source: 'cached';
    }) => Promise<{publish(): Promise<void> | void}>;
    const result = connectResult(identity);
    const staged = await stageCandidate({
      identity,
      record: {
        accountId: identity.accountId!,
        serverId: identity.serverId!,
        session: result.serverSession,
      },
      scope: {
        accountId: identity.accountId!,
        authority: identity.authority!,
        authorizationRevision: identity.authorizationRevision!,
        profileId: identity.profileId!,
        serverId: identity.serverId!,
      },
      session: result.serverSession,
      source: 'cached',
    });
    await staged.publish();
    return result;
  };
}

function connectSelectedServerImplementation() {
  return async (...args: unknown[]) => {
    const selected = args[0] as HostedServer;
    const envelope = args[4] as typeof selectionEnvelope;
    const stageCandidate = args[5] as (candidate: {
      identity: AuthMeResponse;
      record: {accountId: string; serverId: string; session: object};
      scope: ViewerScope;
      session: object;
      source: 'hosted';
    }) => Promise<{
      publish(): Promise<void> | void;
      rollback(): Promise<void> | void;
    }>;
    const identity: AuthMeResponse = {
      ...hostedViewerIdentity,
      profileId: envelope.profileId,
      serverId: selected.id,
    };
    const result = connectResult(identity);
    const scope: ViewerScope = {
      accountId: 'user-1',
      authority: 'hosted',
      authorizationRevision: 'authorization-1',
      profileId: envelope.profileId,
      serverId: selected.id,
    };
    const staged = await stageCandidate({
      identity,
      record: {
        accountId: 'user-1',
        serverId: selected.id,
        session: result.serverSession,
      },
      scope,
      session: result.serverSession,
      source: 'hosted',
    });
    await staged.publish();
    return result;
  };
}

function deferred<T = void>() {
  let resolve!: (value: T | PromiseLike<T>) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return {promise, reject, resolve};
}

function configureLocalAuth(
  options: {
    authentication?: ProfileAccountAuthenticationResponse;
    credentials?: NativeSessionCredentials;
    grant?: ProfileSelectionGrant;
    identity?: AuthMeResponse;
    revokeFailure?: unknown;
    selectFailure?: unknown;
  } = {},
) {
  const authentication = options.authentication ?? localAuthentication;
  const grant = options.grant ?? localGrant;
  const credentials = options.credentials ?? localCredentials;
  const identity = options.identity ?? localViewerIdentity;
  let selectedProfileId = grant.profileId;
  const authenticateLocalProfileAccount = jest
    .fn()
    .mockResolvedValue(authentication);
  const selectLocalProfile = options.selectFailure
    ? jest.fn().mockRejectedValue(options.selectFailure)
    : jest.fn().mockImplementation((body: {profileId: string}) => {
        selectedProfileId = body.profileId;
        return Promise.resolve({...grant, profileId: body.profileId});
      });
  const selectActiveLocalProfile = options.selectFailure
    ? jest.fn().mockRejectedValue(options.selectFailure)
    : jest.fn().mockImplementation((body: {profileId: string}) => {
        selectedProfileId = body.profileId;
        return Promise.resolve({...grant, profileId: body.profileId});
      });
  const createNativeProfileSession = jest.fn().mockImplementation(() =>
    Promise.resolve({
      ...credentials,
      profileId: selectedProfileId,
    }),
  );
  const me = jest
    .fn()
    .mockImplementation(() =>
      Promise.resolve(
        options.identity
          ? identity
          : {...identity, profileId: selectedProfileId},
      ),
    );
  const revokeNativeSession = options.revokeFailure
    ? jest.fn().mockRejectedValue(options.revokeFailure)
    : jest.fn().mockImplementation(async () => {
        return {ok: true};
      });
  const checkServerCompatibility = jest.fn().mockResolvedValue(undefined);
  const checkCompatibility = jest.fn().mockResolvedValue(undefined);
  mockEnvironment.createServerClient.mockImplementation(
    (
      _platform: string,
      _instanceId: string,
      store?: {
        get(): Record<string, unknown> | undefined;
        set?(value: Record<string, unknown>): void;
        clear?(): void;
      },
    ) => {
      if (!store)
        return {
          accountProfiles: jest.fn().mockResolvedValue({
            ...authentication.directory,
            canManage: true,
          }),
          kind: 'active-local-client',
          selectActiveLocalProfile,
        };
      return {
        authenticateLocalProfileAccount,
        checkServerCompatibility,
        checkCompatibility: async () => {
          if (!store.get()?.accessToken) {
            throw new Error(
              'authenticated Product Contract requested before session mint',
            );
          }
          return checkCompatibility();
        },
        createNativeProfileSession: async (body: {selectionGrant: string}) => {
          const created = await createNativeProfileSession(body);
          store.set?.({
            ...store.get(),
            accessToken: created.accessToken,
            expiresAt: created.accessExpiresAt,
            refreshExpiresAt: created.refreshExpiresAt,
            refreshToken: created.refreshToken,
          });
          return created;
        },
        me,
        remoteAccessHealth: jest.fn().mockResolvedValue({
          serverId: 'local-server-1',
          serverPublicKeyFingerprint: 'local-fingerprint',
        }),
        revokeNativeSession,
        selectLocalProfile,
      };
    },
  );
  return {
    authenticateLocalProfileAccount,
    checkCompatibility,
    checkServerCompatibility,
    createNativeProfileSession,
    me,
    revokeNativeSession,
    selectActiveLocalProfile,
    selectLocalProfile,
  };
}

beforeEach(() => {
  jest.clearAllMocks();
  (globalThis as typeof globalThis & {__PORTICO_BUILD_CONTRACT__?: unknown}).__PORTICO_BUILD_CONTRACT__ = {
    version: 1,
    apiVersion: 'v1',
    environment: 'test',
    distribution: 'simulator',
    hostedApiBaseUrl: 'https://hosted.test',
    appVersion: '0.1.0-test',
    buildNumber: '42',
    commit: 'test-commit',
  };
  mockInstallation.optionalInstallationId.mockResolvedValue('installation-1');
  mockEnvironment.createServerClient.mockReset();
  // The production factory always returns a complete client.  Keeping the
  // default test double complete prevents successful authentication from
  // failing only because the activation-preference seam is absent in a mock.
  mockEnvironment.createServerClient.mockReturnValue({
    kind: 'active-client',
    ...connectedPreferenceClient,
  });
  viewerRuntime = new ViewerRuntimeCoordinator();
  durableServerCredential = undefined;
  durableHostedCredential = undefined;
  durableHostedRefreshRotation = undefined;
  durableSelectedServerId = undefined;
  mockStorage.hostedCredentialStore.load.mockImplementation(
    async () => durableHostedCredential,
  );
  mockEnvironment.getServerSession.mockReturnValue(undefined);
  mockStorage.beginCredentialCleanup.mockResolvedValue({
    authority: 'unknown',
    createdAt: '2026-07-16T00:00:00.000Z',
    id: 'cleanup-1',
  });
  mockStorage.finishCredentialCleanup.mockResolvedValue(undefined);
  mockStorage.deleteAllCredentialsRetainingCleanupBarrier.mockResolvedValue(
    undefined,
  );
  mockStorage.retryPendingCredentialCleanup.mockResolvedValue(false);
  mockStorage.serverCredentialAdapter.load.mockImplementation(
    async () => durableServerCredential,
  );
  mockStorage.serverCredentialAdapter.save.mockImplementation(
    async (session: Record<string, unknown>) => {
      durableServerCredential = session;
    },
  );
  mockStorage.serverCredentialAdapter.clear.mockImplementation(async () => {
    durableServerCredential = undefined;
  });
  mockStorage.trustedServerConnectionAdapter.list.mockResolvedValue([]);
  mockStorage.hostedCredentialStore.save.mockImplementation(
    async (session: typeof accountSession) => {
      durableHostedCredential = session;
    },
  );
  mockStorage.hostedCredentialStore.clear.mockImplementation(async () => {
    durableHostedCredential = undefined;
  });
  mockStorage.hostedRefreshRotationStore.load.mockImplementation(
    async () => durableHostedRefreshRotation,
  );
  mockStorage.hostedRefreshRotationStore.save.mockImplementation(
    async journal => {
      durableHostedRefreshRotation = journal;
    },
  );
  mockStorage.hostedRefreshRotationStore.clear.mockImplementation(async () => {
    durableHostedRefreshRotation = undefined;
  });
  mockEnvironment.hostedClient.createNativeSession.mockResolvedValue(
    accountSession,
  );
  mockEnvironment.hostedClient.createProfileSelectionEnvelope.mockImplementation(
    (profileId: string, options: {serverId: string}) =>
      Promise.resolve({
        ...selectionEnvelope,
        profileId,
        serverId: options.serverId,
      }),
  );
  mockEnvironment.hostedClient.profiles.mockResolvedValue({
    accountId: 'user-1',
    profiles: [profile],
    revision: 1,
    total: 1,
  });
  mockEnvironment.hostedClient.register.mockResolvedValue({
    user: accountSession.user,
  });
  mockEnvironment.hostedClient.requestPasswordReset.mockResolvedValue({
    ok: true,
  });
  mockEnvironment.hostedClient.revokeNativeSession.mockResolvedValue({
    ok: true,
  });
  mockEnvironment.hostedClient.servers.mockResolvedValue(serverPage([server]));
  mockInstallation.profileSelectionStore.get.mockResolvedValue({
    profileSelection: 'last-used',
    rememberAccount: true,
  });
  mockInstallation.profileSelectionStore.recordVerifiedSelection.mockResolvedValue(
    undefined,
  );
  mockInstallation.selectedServerStore.get.mockImplementation(
    async () => durableSelectedServerId,
  );
  mockInstallation.selectedServerStore.set.mockImplementation(
    async (serverId: string) => {
      durableSelectedServerId = serverId;
    },
  );
  mockInstallation.selectedServerStore.clear.mockImplementation(async () => {
    durableSelectedServerId = undefined;
  });
  mockInstallation.profileSelectionStore.set.mockResolvedValue(undefined);
  let preferenceDeviceClass: 'mobile' | 'television' = 'mobile';
  connectedPreferenceClient.viewerPreferenceBundle.mockImplementation(
    ({
      deviceClass,
      installationId: requestedInstallationId,
    }: {
      deviceClass: 'mobile' | 'television';
      installationId: string;
    }) => {
      preferenceDeviceClass = deviceClass;
      const device = defaultProfileDeviceClassPreferences(deviceClass);
      return Promise.resolve({
        version: 'v1',
        identity: {
          authority: 'hosted',
          accountId: hostedViewerIdentity.accountId,
          serverId: hostedViewerIdentity.serverId,
          profileId: hostedViewerIdentity.profileId,
          deviceClass,
          installationId: requestedInstallationId,
        },
        profileServer: {
          version: 'v1',
          revision: 0,
          values: defaultProfileServerPreferences,
        },
        profileDeviceClass: {version: 'v1', revision: 0, values: device},
        effectiveProfileDeviceClass: {
          version: 'v1',
          revision: 0,
          values: device,
        },
        accountServerInstallation: {
          version: 'v1',
          revision: 0,
          values: defaultAccountServerInstallationPreferences(deviceClass),
        },
        clampedFields: [],
        policy: {
          cellularQualityAllowed: true,
          downloadsAllowed: true,
          feedbackAllowed: true,
        },
      });
    },
  );
  connectedPreferenceClient.recordViewerProfileActivation.mockImplementation(
    () =>
      Promise.resolve({
        version: 'v1',
        revision: 1,
        values: {
          ...defaultAccountServerInstallationPreferences(
            preferenceDeviceClass,
          ),
          lastProfileId: hostedViewerIdentity.profileId,
        },
      }),
  );
  mockEnvironment.connectAccountServer.mockRejectedValue(
    new Error('Home server is offline.'),
  );
  mockEnvironment.refreshAccountServerRoute.mockRejectedValue(
    new Error('No alternate route is currently reachable.'),
  );
});

async function renderProvider(
  platform: 'mobile' | 'tv' = 'mobile',
  onAuthoritativeViewerActivation?: Parameters<
    typeof PorticoAuthProvider
  >[0]['onAuthoritativeViewerActivation'],
) {
  let renderer!: ReactTestRenderer.ReactTestRenderer;
  await ReactTestRenderer.act(async () => {
    renderer = ReactTestRenderer.create(
      <PorticoViewerRuntimeProvider coordinator={viewerRuntime}>
        <PorticoAuthProvider
          platform={platform}
          onAuthoritativeViewerActivation={onAuthoritativeViewerActivation}
        >
          <Probe />
        </PorticoAuthProvider>
      </PorticoViewerRuntimeProvider>,
    );
    for (let attempt = 0; attempt < 10; attempt += 1) {
      await Promise.resolve();
    }
  });
  return renderer;
}

test('keeps a successful Portico Account sign-in authenticated when its server is offline', async () => {
  await renderProvider();

  await ReactTestRenderer.act(async () => {
    await auth.signInWithPortico('viewer@example.com', 'correct password');
  });

  expect(mockStorage.hostedCredentialStore.save).toHaveBeenCalledWith(
    accountSession,
  );
  expect(auth.account).toEqual(accountSession.user);
  expect(auth.session).toBeUndefined();
  expect(auth.status).toBe('server-unavailable');
  expect(auth.error).toBeUndefined();
  expect(auth.serverError).toBe(
    "Portico couldn't reach Home. Your Portico Account remains signed in.",
  );
  expect(auth.selectedServer).toBeUndefined();
  expect(auth.availableServers).toEqual([server]);
  expect(auth.serverConnectionStates['server-1']).toBe('unreachable');
  expect(
    mockEnvironment.hostedClient.createProfileSelectionEnvelope,
  ).toHaveBeenCalledWith(
    'profile-1',
    {serverId: 'server-1'},
    expect.objectContaining({signal: expect.any(Object)}),
  );
});

test('sign-in supplies stable client metadata when optional Keychain metadata is unavailable', async () => {
  mockInstallation.optionalInstallationId.mockResolvedValueOnce(undefined);
  await renderProvider();

  await ReactTestRenderer.act(async () => {
    await auth.signInWithPortico('viewer@example.com', 'correct password');
  });

  expect(auth.account).toEqual(accountSession.user);
  expect(
    mockEnvironment.hostedClient.createNativeSession.mock.calls[0][0],
  ).toEqual(expect.objectContaining({installationId: 'installation-1'}));
});

test('notifies integration only after the authoritative viewer is active', async () => {
  mockEnvironment.connectAccountServer.mockImplementation(
    connectImplementation(),
  );
  const activations: Array<{
    runtimeServerId?: string;
    viewerServerId: string;
  }> = [];
  await renderProvider('mobile', activation => {
    activations.push({
      runtimeServerId: viewerRuntime.getSnapshot().scope?.serverId,
      viewerServerId: activation.viewerScope.serverId,
    });
  });

  await ReactTestRenderer.act(async () => {
    await auth.signInWithPortico('viewer@example.com', 'correct password');
  });

  expect(activations).toEqual([
    {runtimeServerId: 'server-1', viewerServerId: 'server-1'},
  ]);
  expect(auth.session?.serverId).toBe('server-1');
});

test('restores a valid Hosted account without demoting it when its server is offline', async () => {
  mockStorage.hostedCredentialStore.load.mockResolvedValue(accountSession);

  await renderProvider();

  expect(auth.account).toEqual(accountSession.user);
  expect(auth.session).toBeUndefined();
  expect(auth.status).toBe('server-unavailable');
  expect(auth.error).toBeUndefined();
  expect(auth.serverError).toBe(
    "Portico couldn't reach Home. Your Portico Account remains signed in.",
  );
  expect(mockEnvironment.connectAccountServer).toHaveBeenCalledWith(
    expect.objectContaining({id: 'server-1'}),
    'user-1',
    'mobile',
    'installation-1',
    expect.objectContaining({profileId: 'profile-1'}),
    expect.any(Function),
    expect.any(Object),
    {forceFreshRoute: undefined, routePreference: 'public-first'},
  );
});

test('preserves local account identity for offline media when token refresh cannot reach Hosted Services', async () => {
  const expiredSession = {
    ...accountSession,
    accessExpiresAt: '2020-01-01T00:00:00.000Z',
  };
  mockStorage.hostedCredentialStore.load.mockResolvedValue(expiredSession);
  mockEnvironment.hostedClient.refreshNativeSession.mockRejectedValue(
    new TypeError('Network request failed'),
  );
  mockEnvironment.hostedClient.servers.mockRejectedValue(
    new TypeError('Network request failed'),
  );

  await renderProvider();

  expect(auth.account).toEqual(accountSession.user);
  expect(auth.session).toBeUndefined();
  expect(auth.status).toBe('server-unavailable');
  expect(mockStorage.hostedCredentialStore.clear).not.toHaveBeenCalled();
});

test('refresh does not require installation metadata when Keychain cannot provide it', async () => {
  const expiredSession = {
    ...accountSession,
    accessExpiresAt: '2020-01-01T00:00:00.000Z',
  };
  mockStorage.hostedCredentialStore.load.mockResolvedValueOnce(expiredSession);
  mockInstallation.optionalInstallationId.mockResolvedValueOnce(undefined);
  mockEnvironment.hostedClient.refreshNativeSession.mockResolvedValueOnce(
    accountSession,
  );

  await renderProvider();

  expect(mockEnvironment.hostedClient.refreshNativeSession).toHaveBeenCalledWith(
    expect.objectContaining({
      refreshToken: expiredSession.refreshToken,
      rotationKey: expect.stringMatching(/^[a-f0-9]{64}$/),
    }),
  );
  expect(mockStorage.hostedCredentialStore.save).toHaveBeenCalledWith(
    accountSession,
  );
});

test('clears a Hosted session only when refresh is authoritatively rejected', async () => {
  const expiredSession = {
    ...accountSession,
    accessExpiresAt: '2020-01-01T00:00:00.000Z',
  };
  mockStorage.hostedCredentialStore.load.mockResolvedValue(expiredSession);
  mockEnvironment.hostedClient.refreshNativeSession.mockRejectedValue(
    new ApiError(401, 'invalid_refresh_token', 'Session expired.'),
  );

  await renderProvider();

  expect(auth.account).toBeUndefined();
  expect(auth.status).toBe('signed-out');
  expect(mockStorage.hostedCredentialStore.clear).toHaveBeenCalledTimes(1);
  expect(
    mockStorage.trustedServerConnectionAdapter.clearAccount,
  ).toHaveBeenCalledWith('user-1');
});

test('does not erase a Hosted account for an ambiguous refresh 401', async () => {
  const expiredSession = {
    ...accountSession,
    accessExpiresAt: '2020-01-01T00:00:00.000Z',
  };
  mockStorage.hostedCredentialStore.load.mockResolvedValue(expiredSession);
  mockEnvironment.hostedClient.refreshNativeSession.mockRejectedValue(
    new ApiError(
      401,
      'authentication_failed',
      'Authentication could not be completed.',
    ),
  );
  mockEnvironment.hostedClient.servers.mockRejectedValue(
    new TypeError('Network request failed'),
  );

  await renderProvider();

  expect(auth.account).toEqual(accountSession.user);
  expect(auth.status).toBe('server-unavailable');
  expect(mockStorage.hostedCredentialStore.clear).not.toHaveBeenCalled();
  expect(
    mockStorage.trustedServerConnectionAdapter.clearAccount,
  ).not.toHaveBeenCalled();
});

test('never restores a Hosted-issued singleton server credential as Local Auth', async () => {
  mockStorage.serverCredentialAdapter.load.mockResolvedValue({
    apiBaseUrl: 'https://direct.example.test',
    accessToken: 'server-access',
    authenticationMode: 'portico-account',
    hostedAccountId: 'user-1',
    routeType: 'direct',
    serverId: 'server-1',
  });

  await renderProvider();

  expect(auth.status).toBe('signed-out');
  expect(mockEnvironment.createServerClient).not.toHaveBeenCalled();
});

test('durably publishes credentials rotated during stored-session verification and reuses them after restart', async () => {
  durableServerCredential = {
    accessToken: 'expired-access',
    accountId: 'local-account-1',
    apiBaseUrl: 'https://local.test',
    authenticationMode: 'local',
    authority: 'local',
    authorizationRevision: 'local-authorization-1',
    expiresAt: '2000-01-01T00:00:00.000Z',
    refreshToken: 'original-refresh',
    profileId: 'local-profile-1',
    routeType: 'manual',
    serverId: 'local-server-1',
  };
  mockEnvironment.createServerClient.mockImplementation(
    (
      _platform: string,
      _instanceId: string,
      store?: {
        get(): Record<string, unknown> | undefined;
        set?(value: Record<string, unknown>): void;
      },
    ) => {
      if (!store) return {kind: 'active-local-client'};
      return {
        checkServerCompatibility: jest.fn().mockImplementation(async () => {
          if (store.get()?.accessToken === 'expired-access') {
            store.set?.({
              ...store.get(),
              accessToken: 'rotated-access',
              expiresAt: '2999-01-01T00:00:00.000Z',
              refreshToken: 'rotated-refresh',
            });
          }
        }),
        checkCompatibility: jest.fn().mockResolvedValue(undefined),
        me: jest.fn().mockResolvedValue(localViewerIdentity),
      };
    },
  );
  let renderer = await renderProvider();

  expect(auth.status).toBe('authenticated');
  expect(auth.session?.viewerScope).toEqual(
    expect.objectContaining({
      authority: 'local',
      profileId: 'local-profile-1',
      serverId: 'local-server-1',
    }),
  );
  expect(durableServerCredential).toEqual(
    expect.objectContaining({
      accessToken: 'rotated-access',
      refreshToken: 'rotated-refresh',
    }),
  );
  expect(mockEnvironment.setServerSession).toHaveBeenCalledWith(
    expect.objectContaining({
      accessToken: 'rotated-access',
      refreshToken: 'rotated-refresh',
    }),
  );

  await ReactTestRenderer.act(async () => renderer.unmount());
  viewerRuntime = new ViewerRuntimeCoordinator();
  mockEnvironment.setServerSession.mockClear();
  renderer = await renderProvider();

  expect(auth.status).toBe('authenticated');
  expect(auth.session?.viewerScope.serverId).toBe('local-server-1');
  expect(mockEnvironment.setServerSession).toHaveBeenCalledWith(
    expect.objectContaining({
      accessToken: 'rotated-access',
      refreshToken: 'rotated-refresh',
    }),
  );
  await ReactTestRenderer.act(async () => renderer.unmount());
});

test.each([
  ['authority', {authority: 'hosted' as const}],
  ['account', {accountId: 'other-account'}],
  ['server', {serverId: 'other-server'}],
  ['profile', {profileId: 'other-profile'}],
])(
  'rejects a stored-session final /me %s mismatch before durable or runtime publication',
  async (_label, mismatch) => {
    durableServerCredential = {
      ...localCredentials,
      apiBaseUrl: 'https://local.test',
      authenticationMode: 'local',
      routeType: 'manual',
    };
    mockEnvironment.createServerClient.mockImplementation(
      (
        _platform: string,
        _instanceId: string,
        store?: {get(): Record<string, unknown> | undefined},
      ) =>
        store
          ? {
              checkServerCompatibility: jest.fn().mockResolvedValue(undefined),
              checkCompatibility: jest.fn().mockResolvedValue(undefined),
              me: jest
                .fn()
                .mockResolvedValue({...localViewerIdentity, ...mismatch}),
            }
          : {kind: 'active-local-client'},
    );

    await renderProvider();

    expect(auth.session).toBeUndefined();
    expect(viewerRuntime.getSnapshot().scope).toBeUndefined();
    expect(mockEnvironment.setServerSession).not.toHaveBeenCalledWith(
      expect.objectContaining({accessToken: 'local-access'}),
    );
  },
);

test('models an authenticated account with no shared servers as awaiting server selection', async () => {
  mockEnvironment.hostedClient.servers.mockResolvedValue(serverPage([]));
  await renderProvider();

  await ReactTestRenderer.act(async () => {
    await auth.signInWithPortico('viewer@example.com', 'correct password');
  });

  expect(auth.account).toEqual(accountSession.user);
  expect(auth.status).toBe('selecting-server');
  expect(auth.availableServers).toEqual([]);
  expect(auth.session).toBeUndefined();
});

test('follows every Hosted server directory cursor without imposing a total-page cap', async () => {
  const serverB = {...server, id: 'server-2', name: 'Second Server'};
  const fetchPage = jest.fn()
    .mockResolvedValueOnce({
      items: [server],
      pageInfo: {hasMore: true, nextCursor: 'opaque-cursor-2'},
    })
    .mockResolvedValueOnce({
      items: [serverB],
      pageInfo: {hasMore: false, nextCursor: null},
    });

  await expect(loadAllHostedServers(fetchPage)).resolves.toEqual([server, serverB]);
  expect(fetchPage).toHaveBeenNthCalledWith(1, {limit: HOSTED_SERVER_DIRECTORY_PAGE_SIZE});
  expect(fetchPage).toHaveBeenNthCalledWith(2, {
    limit: HOSTED_SERVER_DIRECTORY_PAGE_SIZE,
    cursor: 'opaque-cursor-2',
  });
});

test('a last-server preference failure does not roll back a verified Hosted account replacement', async () => {
  mockEnvironment.connectAccountServer.mockImplementation(
    connectImplementation(),
  );
  await renderProvider();
  await ReactTestRenderer.act(async () => {
    await auth.signInWithPortico('viewer@example.com', 'correct password');
  });
  const accountB = {
    ...accountSession,
    accessToken: 'hosted-b-access',
    refreshToken: 'hosted-b-refresh',
    user: {
      ...accountSession.user,
      id: 'user-b',
      email: 'viewer-b@example.com',
    },
  };
  mockEnvironment.hostedClient.createNativeSession.mockResolvedValueOnce(
    accountB,
  );
  mockInstallation.selectedServerStore.get.mockRejectedValueOnce(
    new Error('last-server preference unavailable'),
  );

  await ReactTestRenderer.act(async () => {
    await auth.signInWithPortico('viewer-b@example.com', 'correct password');
  });

  expect(auth.account).toEqual(accountB.user);
  expect(durableHostedCredential).toEqual(accountB);
  expect(mockEnvironment.setHostedAccessToken).toHaveBeenLastCalledWith(
    'hosted-b-access',
  );
});

test('a delayed B selector clear settles before a newer C server selection publishes', async () => {
  mockEnvironment.connectAccountServer.mockImplementation(
    connectSelectedServerImplementation(),
  );
  await renderProvider();
  await ReactTestRenderer.act(async () => {
    await auth.signInWithPortico('viewer@example.com', 'correct password');
  });
  const accountB = {
    ...accountSession,
    accessToken: 'hosted-b-access',
    refreshToken: 'hosted-b-refresh',
    user: {...accountSession.user, id: 'user-b'},
  };
  const delayedClear = deferred<void>();
  mockEnvironment.hostedClient.createNativeSession.mockResolvedValueOnce(
    accountB,
  );
  mockInstallation.selectedServerStore.clear.mockImplementationOnce(
    async () => {
      await delayedClear.promise;
      durableSelectedServerId = undefined;
    },
  );
  const serverC = {...server, id: 'server-c', name: 'Server C'};

  let switchToB!: Promise<unknown>;
  let switchToC!: Promise<unknown>;
  await ReactTestRenderer.act(async () => {
    switchToB = auth
      .signInWithPortico('viewer-b@example.com', 'correct password')
      .catch(cause => cause);
    for (let attempt = 0; attempt < 20; attempt += 1) {
      await Promise.resolve();
    }
    switchToC = auth.chooseServer(serverC);
    delayedClear.resolve();
    await Promise.all([switchToB, switchToC]);
  });

  expect(auth.account?.id).toBe('user-1');
  expect(auth.session?.serverId).toBe('server-c');
  expect(auth.selectedServer?.id).toBe('server-c');
  expect(durableSelectedServerId).toBe('server-c');
});

test('a verified Hosted account replacement clears an active Local Auth family before publishing B', async () => {
  configureLocalAuth();
  await renderProvider();
  await ReactTestRenderer.act(async () => {
    await auth.signInWithLocalAuth('https://local.test', 'viewer', 'password');
  });
  expect(auth.session?.mode).toBe('local');
  expect(durableServerCredential).toEqual(
    expect.objectContaining({authenticationMode: 'local'}),
  );

  const accountB = {
    ...accountSession,
    accessToken: 'hosted-b-access',
    refreshToken: 'hosted-b-refresh',
    user: {
      ...accountSession.user,
      id: 'user-b',
      email: 'viewer-b@example.com',
    },
  };
  mockEnvironment.hostedClient.createNativeSession.mockResolvedValueOnce(
    accountB,
  );
  mockEnvironment.hostedClient.profiles.mockResolvedValueOnce({
    accountId: 'user-b',
    profiles: [{...profile, accountId: 'user-b'}],
    revision: 1,
    total: 1,
  });
  mockEnvironment.hostedClient.servers.mockResolvedValueOnce(serverPage([]));

  await ReactTestRenderer.act(async () => {
    await auth.signInWithPortico('viewer-b@example.com', 'correct password');
  });

  expect(auth.account?.id).toBe('user-b');
  expect(auth.session).toBeUndefined();
  expect(auth.selectedServer).toBeUndefined();
  expect(auth.status).toBe('selecting-server');
  expect(durableHostedCredential).toEqual(accountB);
  expect(durableServerCredential).toBeUndefined();
  expect(viewerRuntime.getSnapshot().scope).toBeUndefined();
});

test('activates only a durably stored device-authorized account before entering the zero-server state', async () => {
  mockEnvironment.hostedClient.servers.mockResolvedValue(serverPage([]));
  await renderProvider();
  mockStorage.hostedCredentialStore.load.mockResolvedValue(accountSession);

  await ReactTestRenderer.act(async () => {
    await auth.completeDeviceAuthorization(accountSession);
  });

  expect(mockStorage.hostedCredentialStore.load).toHaveBeenCalled();
  expect(mockEnvironment.setHostedAccessToken).toHaveBeenCalledWith(
    'hosted-access',
  );
  expect(
    mockStorage.hostedCredentialStore.load.mock.invocationCallOrder.at(-1),
  ).toBeLessThan(
    mockEnvironment.setHostedAccessToken.mock.invocationCallOrder[0],
  );
  expect(auth.account).toEqual(accountSession.user);
  expect(auth.status).toBe('selecting-server');
  expect(auth.session).toBeUndefined();
  expect(mockEnvironment.connectAccountServer).not.toHaveBeenCalled();
});

test('keeps device-authorized account identity when every server is offline', async () => {
  await renderProvider();
  mockStorage.hostedCredentialStore.load.mockResolvedValue(accountSession);

  await ReactTestRenderer.act(async () => {
    await auth.completeDeviceAuthorization(accountSession);
  });

  expect(mockStorage.hostedCredentialStore.load).toHaveBeenCalled();
  expect(auth.account).toEqual(accountSession.user);
  expect(auth.status).toBe('server-unavailable');
  expect(auth.session).toBeUndefined();
  expect(auth.serverError).toBe(
    "Portico couldn't reach Home. Your Portico Account remains signed in.",
  );
  expect(auth.selectedServer).toBeUndefined();
});

test('Nearby TV account redemption waits for explicit profile selection before server credentials', async () => {
  const secondProfile = {
    ...profile,
    id: 'profile-2',
    isAccountAdmin: false,
    isPrimary: false,
    name: 'Guest',
    sortOrder: 1,
  };
  mockEnvironment.hostedClient.profiles.mockResolvedValue({
    accountId: 'user-1',
    profiles: [profile, secondProfile],
    revision: 2,
    total: 2,
  });
  await renderProvider('tv');
  mockStorage.hostedCredentialStore.load.mockResolvedValue({
    ...accountSession,
    accessToken: nearbyTVGrant.accountAccessToken,
    refreshToken: nearbyTVGrant.accountRefreshToken,
  });

  await ReactTestRenderer.act(async () => {
    await auth.completeNearbyTVSetup(nearbyTVGrant);
  });

  expect(auth.account).toEqual(accountSession.user);
  expect(auth.status).toBe('selecting-profile');
  expect(auth.availableProfiles).toHaveLength(2);
  expect(mockEnvironment.connectAccountServer).not.toHaveBeenCalled();
  expect(
    mockEnvironment.hostedClient.createProfileSelectionEnvelope,
  ).not.toHaveBeenCalled();
});

test('does not automatically open a remembered locked Hosted profile without exact trust', async () => {
  mockEnvironment.hostedClient.profiles.mockResolvedValue({
    accountId: 'user-1',
    profiles: [{...profile, hasPIN: true, pinRevision: 2}],
    revision: 2,
    total: 1,
  });
  mockInstallation.profileSelectionStore.get.mockResolvedValue({
    profileSelection: 'last-used',
    rememberAccount: true,
    lastProfileId: profile.id,
  });
  await renderProvider('mobile');

  await ReactTestRenderer.act(async () => {
    await auth.signInWithPortico('viewer@example.com', 'correct password');
  });

  expect(auth.status).toBe('selecting-profile');
  expect(mockEnvironment.connectAccountServer).not.toHaveBeenCalled();
});

test('does not mount device-authorized identity before its full credentials are durable', async () => {
  await renderProvider();

  await expect(
    ReactTestRenderer.act(async () => {
      await auth.completeDeviceAuthorization(accountSession);
    }),
  ).rejects.toThrow('was not committed to secure storage');

  expect(mockEnvironment.setHostedAccessToken).not.toHaveBeenCalled();
  expect(auth.account).toBeUndefined();
  expect(auth.status).toBe('signed-out');
});

test('retries Hosted discovery and reconnects the previously selected server', async () => {
  await renderProvider();
  await ReactTestRenderer.act(async () => {
    await auth.signInWithPortico('viewer@example.com', 'correct password');
  });
  expect(auth.status).toBe('server-unavailable');

  mockEnvironment.connectAccountServer.mockImplementation(
    connectImplementation(),
  );
  mockEnvironment.hostedClient.servers.mockResolvedValue(serverPage([server]));
  await ReactTestRenderer.act(async () => {
    await auth.retryServerDiscovery();
  });

  expect(mockEnvironment.hostedClient.servers).toHaveBeenCalledTimes(2);
  expect(mockEnvironment.connectAccountServer).toHaveBeenLastCalledWith(
    expect.objectContaining({id: 'server-1'}),
    'user-1',
    'mobile',
    'installation-1',
    expect.objectContaining({profileId: 'profile-1'}),
    expect.any(Function),
    expect.any(Object),
    {forceFreshRoute: undefined, routePreference: 'public-first'},
  );
  expect(auth.status).toBe('authenticated');
  expect(auth.account).toEqual(accountSession.user);
  expect(auth.session?.serverId).toBe('server-1');
  expect(auth.serverError).toBeUndefined();
  expect(auth.serverConnectionStates['server-1']).toBe('reachable');
});

test('network route replacement probes trusted routes before discovery without remounting the active viewer', async () => {
  mockEnvironment.connectAccountServer.mockImplementation(
    connectImplementation(),
  );
  await renderProvider();
  await ReactTestRenderer.act(async () => {
    await auth.signInWithPortico('viewer@example.com', 'correct password');
  });
  const activeSession = auth.session;
  const listener = mockEnvironment.subscribeServerRouteRefreshRequests.mock
    .calls.at(-1)?.[0] as (
      request: {reason: 'network-transition'},
    ) => Promise<boolean>;
  expect(listener).toBeInstanceOf(Function);

  mockEnvironment.connectAccountServer.mockClear();
  mockEnvironment.hostedClient.createProfileSelectionEnvelope.mockClear();
  mockEnvironment.refreshAccountServerRoute.mockImplementation(
    refreshRouteImplementation(),
  );
  await ReactTestRenderer.act(async () => {
    await expect(listener({reason: 'network-transition'})).resolves.toBe(true);
  });

  expect(mockEnvironment.refreshAccountServerRoute).toHaveBeenCalledWith(
    expect.objectContaining({id: 'server-1'}),
    'user-1',
    'mobile',
    'installation-1',
    expect.any(Function),
    expect.any(Object),
  );
  expect(mockEnvironment.connectAccountServer).not.toHaveBeenCalled();
  expect(
    mockEnvironment.hostedClient.createProfileSelectionEnvelope,
  ).not.toHaveBeenCalled();
  expect(auth.session).toBe(activeSession);
  expect(auth.status).toBe('authenticated');
  expect(auth.issue).toBeUndefined();
});

test('failed background route replacement retains the still-valid viewer silently', async () => {
  mockEnvironment.connectAccountServer.mockImplementation(
    connectImplementation(),
  );
  await renderProvider();
  await ReactTestRenderer.act(async () => {
    await auth.signInWithPortico('viewer@example.com', 'correct password');
  });
  const activeSession = auth.session;
  const listener = mockEnvironment.subscribeServerRouteRefreshRequests.mock
    .calls.at(-1)?.[0] as (
      request: {reason: 'route-failure'},
    ) => Promise<boolean>;
  mockEnvironment.refreshAccountServerRoute.mockRejectedValueOnce(
    new TypeError('new route is not reachable yet'),
  );

  await ReactTestRenderer.act(async () => {
    await expect(listener({reason: 'route-failure'})).resolves.toBe(false);
  });

  expect(auth.session).toBe(activeSession);
  expect(auth.status).toBe('authenticated');
  expect(auth.issue).toBeUndefined();
});

test('PIN-protected viewer survives Wi-Fi to cellular route failover without profile reselection', async () => {
  mockEnvironment.hostedClient.profiles.mockResolvedValue({
    accountId: 'user-1',
    profiles: [{...profile, hasPIN: true, pinRevision: 4}],
    revision: 1,
    total: 1,
  });
  mockInstallation.profileSelectionStore.get.mockResolvedValue({
    profileSelection: 'ask',
    rememberAccount: true,
  });
  mockEnvironment.connectAccountServer.mockImplementation(
    connectImplementation(),
  );
  await renderProvider();
  await ReactTestRenderer.act(async () => {
    await auth.signInWithPortico('viewer@example.com', 'correct password');
  });
  expect(auth.status).toBe('selecting-profile');
  await ReactTestRenderer.act(async () => {
    await auth.chooseProfile(profile.id, '4826');
  });
  expect(auth.status).toBe('authenticated');
  const activeSession = auth.session;
  const profilePromptState = auth.profileAwaitingPINId;
  const listener = mockEnvironment.subscribeServerRouteRefreshRequests.mock
    .calls.at(-1)?.[0] as (
      request: {reason: 'network-transition'},
    ) => Promise<boolean>;
  mockEnvironment.hostedClient.createProfileSelectionEnvelope.mockClear();
  mockEnvironment.connectAccountServer.mockClear();
  mockEnvironment.refreshAccountServerRoute.mockImplementation(
    refreshRouteImplementation(),
  );

  await ReactTestRenderer.act(async () => {
    await expect(listener({reason: 'network-transition'})).resolves.toBe(true);
  });

  expect(auth.session).toBe(activeSession);
  expect(auth.status).toBe('authenticated');
  expect(mockEnvironment.refreshAccountServerRoute).toHaveBeenCalledTimes(1);
  expect(mockEnvironment.connectAccountServer).not.toHaveBeenCalled();
  expect(
    mockEnvironment.hostedClient.createProfileSelectionEnvelope,
  ).not.toHaveBeenCalled();
  expect(auth.profileAwaitingPINId).toBe(profilePromptState);
});

test('publishes a Hosted viewer only after authoritative activation is recorded', async () => {
  const order: string[] = [];
  mockEnvironment.connectAccountServer.mockImplementation(async (...args) => {
    const activateCandidate = args[5] as (candidate: {
      identity: typeof hostedViewerIdentity;
      record: {accountId: string; serverId: string; session: object};
      scope: ViewerScope;
      session: object;
      source: 'hosted';
    }) => Promise<{
      publish(): Promise<void> | void;
      rollback(): Promise<void> | void;
    }>;
    const result = connectResult();
    const staged = await activateCandidate({
      identity: hostedViewerIdentity,
      record: {
        accountId: hostedViewerIdentity.accountId!,
        serverId: hostedViewerIdentity.serverId!,
        session: result.serverSession,
      },
      scope: {
        accountId: hostedViewerIdentity.accountId!,
        authority: hostedViewerIdentity.authority!,
        authorizationRevision: hostedViewerIdentity.authorizationRevision!,
        profileId: hostedViewerIdentity.profileId!,
        serverId: hostedViewerIdentity.serverId!,
      },
      session: result.serverSession,
      source: 'hosted',
    });
    await staged.publish();
    order.push('viewer-activated');
    return result;
  });
  connectedPreferenceClient.recordViewerProfileActivation.mockImplementation(
    async () => {
      order.push('activation-recorded');
      return {
        version: 'v1',
        revision: 1,
        values: {
          ...defaultAccountServerInstallationPreferences('mobile'),
          lastProfileId: hostedViewerIdentity.profileId,
        },
      };
    },
  );
  mockInstallation.profileSelectionStore.set.mockImplementation(async () => {
    order.push('launch-cache-committed');
  });
  await renderProvider();

  await ReactTestRenderer.act(async () => {
    await auth.signInWithPortico('viewer@example.com', 'correct password');
  });

  expect(order).toEqual([
    'viewer-activated',
    'activation-recorded',
    'launch-cache-committed',
  ]);
  expect(auth.status).toBe('authenticated');
  expect(auth.session?.viewerScope.profileId).toBe('profile-1');
});

test('keeps the verified viewer live when profile activation preference bookkeeping fails', async () => {
  mockEnvironment.connectAccountServer.mockImplementation(
    connectImplementation(),
  );
  connectedPreferenceClient.recordViewerProfileActivation.mockRejectedValue(
    new ApiError(
      409,
      'preference_conflict',
      'Activation revision is stale.',
    ),
  );
  await renderProvider();

  await ReactTestRenderer.act(async () => {
    await auth.signInWithPortico('viewer@example.com', 'correct password');
  });

  expect(connectedPreferenceClient.recordViewerProfileActivation).toHaveBeenCalled();
  expect(auth.session?.viewerScope.profileId).toBe('profile-1');
  expect(auth.status).toBe('authenticated');
  expect(auth.warning).toBe('preferences.request-failed');
});

test('sign-out invalidates a slow activation record without stale cache or status publication', async () => {
  const activation = deferred<{
    version: 'v1';
    revision: number;
    values: ReturnType<typeof defaultAccountServerInstallationPreferences>;
  }>();
  mockEnvironment.connectAccountServer.mockImplementation(
    connectImplementation(),
  );
  connectedPreferenceClient.recordViewerProfileActivation.mockReturnValue(
    activation.promise,
  );
  await renderProvider();

  let signIn!: Promise<void>;
  await ReactTestRenderer.act(async () => {
    signIn = auth.signInWithPortico(
      'viewer@example.com',
      'correct password',
    );
    for (let attempt = 0; attempt < 20; attempt += 1) {
      if (
        connectedPreferenceClient.recordViewerProfileActivation.mock.calls
          .length
      )
        break;
      await Promise.resolve();
    }
  });
  expect(connectedPreferenceClient.recordViewerProfileActivation).toHaveBeenCalled();

  await ReactTestRenderer.act(async () => {
    await auth.signOut();
    activation.resolve({
      version: 'v1',
      revision: 1,
      values: {
        ...defaultAccountServerInstallationPreferences('mobile'),
        lastProfileId: hostedViewerIdentity.profileId,
      },
    });
    await expect(signIn).rejects.toMatchObject({name: 'AbortError'});
  });

  expect(mockInstallation.profileSelectionStore.set).not.toHaveBeenCalled();
  expect(auth.session).toBeUndefined();
  expect(auth.status).toBe('signed-out');
});

test('restores only after the final server identity initializes the viewer runtime', async () => {
  mockStorage.hostedCredentialStore.load.mockResolvedValue(accountSession);
  mockStorage.trustedServerConnectionAdapter.list.mockResolvedValue([
    {
      accountId: 'user-1',
      serverId: 'server-1',
      serverName: 'Home',
      serverPublicKeyFingerprint: 'fingerprint',
      currentRoute: {url: 'https://home.test', type: 'direct'},
      session: {
        accessToken: 'server-access',
        authenticationMode: 'portico-account',
        hostedAccountId: 'user-1',
        serverId: 'server-1',
      },
    },
  ]);
  mockEnvironment.connectAccountServer.mockImplementation(
    connectImplementation(),
  );

  await renderProvider();

  expect(auth.status).toBe('authenticated');
  expect(auth.session?.viewerScope).toEqual(
    expect.objectContaining({
      accountId: 'user-1',
      authorizationRevision: 'authorization-1',
      profileId: 'profile-1',
      serverId: 'server-1',
    }),
  );
  expect(viewerRuntime.getSnapshot().scope).toEqual(auth.session?.viewerScope);
  expect(viewerRuntime.getSnapshot().acceptingWrites).toBe(true);
});

test('fences AppSession while old viewer teardown completes before replacement publication', async () => {
  mockEnvironment.connectAccountServer.mockImplementation(
    connectImplementation(),
  );
  await renderProvider();
  await ReactTestRenderer.act(async () => {
    await auth.signInWithPortico('viewer@example.com', 'correct password');
  });
  expect(auth.session?.serverId).toBe('server-1');

  const teardown = deferred();
  viewerRuntime.register('playback', () => teardown.promise);
  const secondServer = {
    ...server,
    id: 'server-2',
    name: 'Cottage',
  };
  mockEnvironment.connectAccountServer.mockImplementationOnce(
    connectImplementation({
      ...hostedViewerIdentity,
      serverId: 'server-2',
    }),
  );

  let switching!: Promise<void>;
  await ReactTestRenderer.act(async () => {
    switching = auth.chooseServer(secondServer);
    for (
      let attempt = 0;
      attempt < 10 && !viewerRuntime.getSnapshot().transitioning;
      attempt += 1
    ) {
      await Promise.resolve();
    }
  });
  expect(auth.session).toBeUndefined();
  expect(viewerRuntime.getSnapshot().transitioning).toBe(true);

  teardown.resolve();
  await ReactTestRenderer.act(async () => {
    await switching;
  });
  expect(auth.session?.serverId).toBe('server-2');
  expect(viewerRuntime.getSnapshot().scope?.serverId).toBe('server-2');
});

test('publishes B runtime, credential environment, and AppSession in one callback', async () => {
  const calls: string[] = [];
  const clientA = {
    home: jest.fn(async () => { calls.push('A'); return {}; }),
  };
  const clientB = {
    home: jest.fn(async () => { calls.push('B'); return {}; }),
  };
  mockEnvironment.createServerClient
    .mockReturnValueOnce(clientA)
    .mockReturnValueOnce(clientB);
  const connectA = connectImplementation();
  mockEnvironment.connectAccountServer.mockImplementationOnce(
    async (...args: unknown[]) => ({
      ...(await connectA(...args)),
    }),
  );
  await renderProvider();
  await ReactTestRenderer.act(async () => {
    await auth.signInWithPortico('viewer@example.com', 'correct password');
  });
  const mountedAClient = auth.session!.client;
  await mountedAClient.home();

  const serverB = {...server, id: 'server-b', name: 'Server B'};
  const runtimeBPublished = deferred<void>();
  const releaseCoreResult = deferred<void>();
  mockEnvironment.connectAccountServer.mockImplementationOnce(
    async (...args: unknown[]) => {
      const envelope = args[4] as typeof selectionEnvelope;
      const stageCandidate = args[5] as (candidate: {
        identity: AuthMeResponse;
        record: {accountId: string; serverId: string; session: object};
        scope: ViewerScope;
        session: object;
        source: 'hosted';
      }) => Promise<{
        publish(): Promise<void> | void;
        rollback(): Promise<void> | void;
      }>;
      const identity = {
        ...hostedViewerIdentity,
        profileId: envelope.profileId,
        serverId: serverB.id,
      };
      const result = connectResult(identity);
      const scope = {
        accountId: identity.accountId!,
        authority: identity.authority!,
        authorizationRevision: identity.authorizationRevision!,
        profileId: identity.profileId!,
        serverId: identity.serverId!,
      } as ViewerScope;
      const staged = await stageCandidate({
        identity,
        record: {accountId: identity.accountId!, serverId: identity.serverId!, session: result.serverSession},
        scope,
        session: result.serverSession,
        source: 'hosted',
      });
      await staged.publish();
      runtimeBPublished.resolve();
      await releaseCoreResult.promise;
      return result;
    },
  );

  let switching!: Promise<void>;
  await ReactTestRenderer.act(async () => {
    switching = auth.chooseServer(serverB);
    await runtimeBPublished.promise;
  });

  // Core has not returned yet, but its single authoritative callback has
  // already published runtime, credential environment, and the B AppSession.
  expect(viewerRuntime.getSnapshot().scope?.serverId).toBe('server-b');
  expect(auth.session?.serverId).toBe('server-b');
  expect(() => mountedAClient.home()).toThrow(
    'fenced while the active viewing profile changes',
  );
  expect(clientA.home).toHaveBeenCalledTimes(1);
  await auth.session!.client.home();
  expect(clientB.home).toHaveBeenCalledTimes(1);

  await ReactTestRenderer.act(async () => {
    releaseCoreResult.resolve();
    await switching;
  });
  expect(auth.session?.serverId).toBe('server-b');
  expect(calls).toEqual(['A', 'B']);
});

test('never publishes candidate B when teardown of active scope A rejects', async () => {
  mockEnvironment.connectAccountServer.mockImplementation(
    connectImplementation(),
  );
  await renderProvider();
  await ReactTestRenderer.act(async () => {
    await auth.signInWithPortico('viewer@example.com', 'correct password');
  });
  expect(auth.session?.serverId).toBe('server-1');

  viewerRuntime.register('playback', () => {
    throw new Error('active playback could not be stopped');
  });
  const secondServer: HostedServer = {
    ...server,
    id: 'server-2',
    name: 'Cottage',
  };
  mockEnvironment.connectAccountServer.mockImplementationOnce(
    connectImplementation({...hostedViewerIdentity, serverId: 'server-2'}),
  );

  let caught: unknown;
  await ReactTestRenderer.act(async () => {
    try {
      await auth.chooseServer(secondServer);
    } catch (cause) {
      caught = cause;
    }
  });

  expect(caught).toMatchObject({
    name: 'ViewerRuntimeTeardownError',
    message: 'Portico could not safely clear the previous viewing profile',
  });
  expect(auth.session).toBeUndefined();
  expect(viewerRuntime.getSnapshot().scope).toBeUndefined();
  expect(viewerRuntime.getSnapshot().acceptingWrites).toBe(false);
  expect(viewerRuntime.getSnapshot().transitionFailure).toBeUndefined();
  expect(auth.warning).toBeUndefined();
});

test('a transient cleanup failure that is subsequently verified does not leave a warning or authentication latch', async () => {
  mockEnvironment.connectAccountServer.mockRejectedValue(
    new TrustedServerCredentialPublicationError(
      new Error('candidate publication failed'),
      [new Error('candidate compensation failed')],
      true,
    ),
  );
  mockStorage.finishCredentialCleanup.mockRejectedValueOnce(
    new Error('cleanup marker retained'),
  );
  const renderer = await renderProvider();

  let publicationFailure: unknown;
  await ReactTestRenderer.act(async () => {
    try {
      await auth.signInWithPortico('viewer@example.com', 'correct password');
    } catch (cause) {
      publicationFailure = cause;
    }
  });
  expect(publicationFailure).toBeInstanceOf(
    TrustedServerCredentialPublicationError,
  );
  await ReactTestRenderer.act(async () => {
    for (let attempt = 0; attempt < 20; attempt += 1) {
      await Promise.resolve();
    }
  });

  expect(auth.session).toBeUndefined();
  expect(auth.account).toBeUndefined();
  expect(auth.status).toBe('signed-out');
  expect(viewerRuntime.getSnapshot().scope).toBeUndefined();
  expect(auth.warning).toBeUndefined();

  mockEnvironment.connectAccountServer.mockImplementation(
    connectImplementation(),
  );
  mockEnvironment.hostedClient.createNativeSession.mockClear();
  await ReactTestRenderer.act(async () => {
    await auth.signInWithPortico('viewer@example.com', 'correct password');
  });
  expect(
    mockEnvironment.hostedClient.createNativeSession,
  ).toHaveBeenCalledTimes(1);

  await ReactTestRenderer.act(async () => renderer.unmount());
  viewerRuntime = new ViewerRuntimeCoordinator();
  mockStorage.retryPendingCredentialCleanup.mockResolvedValue(true);
  durableHostedCredential = accountSession;
  await renderProvider();
  expect(auth.status).toBe('signed-out');
  expect(auth.account).toBeUndefined();
  expect(auth.warning).toBeUndefined();
});

test('untrusted cleanup state retries transparently before the next authentication', async () => {
  const cleanupFailure = new Error('Keychain cleanup ledger is unreadable');
  mockStorage.retryPendingCredentialCleanup.mockRejectedValue(cleanupFailure);
  await renderProvider();

  expect(auth.status).toBe('signed-out');
  expect(auth.session).toBeUndefined();
  expect(auth.warning).toBe('auth.sign-out-storage-warning');
  expect(viewerRuntime.getSnapshot().acceptingWrites).toBe(false);

  mockEnvironment.hostedClient.createNativeSession.mockClear();
  let blocked: unknown;
  await ReactTestRenderer.act(async () => {
    try {
      await auth.signInWithPortico('viewer@example.com', 'correct password');
    } catch (cause) {
      blocked = cause;
    }
  });

  expect(blocked).toBe(cleanupFailure);
  expect(
    mockEnvironment.hostedClient.createNativeSession,
  ).not.toHaveBeenCalled();

  mockStorage.retryPendingCredentialCleanup.mockResolvedValue(true);
  mockEnvironment.connectAccountServer.mockImplementation(
    connectImplementation(),
  );
  await ReactTestRenderer.act(async () => {
    await auth.signInWithPortico('viewer@example.com', 'correct password');
  });
  expect(auth.status).toBe('authenticated');
});

test('a hung cleanup reconciliation fails restore closed at the security deadline', async () => {
  const cleanup = deferred<boolean>();
  mockStorage.retryPendingCredentialCleanup.mockReturnValue(cleanup.promise);
  jest.useFakeTimers();
  try {
    await renderProvider();
    expect(auth.status).toBe('booting');

    await ReactTestRenderer.act(async () => {
      jest.advanceTimersByTime(5_000);
      for (let attempt = 0; attempt < 10; attempt += 1) {
        await Promise.resolve();
      }
    });

    expect(auth.status).toBe('signed-out');
    expect(auth.warning).toBe('auth.sign-out-storage-warning');
    expect(viewerRuntime.getSnapshot().acceptingWrites).toBe(false);
    mockEnvironment.hostedClient.createNativeSession.mockClear();

    let blocked: unknown;
    let signIn!: Promise<void>;
    ReactTestRenderer.act(() => {
      signIn = auth
        .signInWithPortico('viewer@example.com', 'correct password')
        .catch(cause => {
          blocked = cause;
        });
    });
    await ReactTestRenderer.act(async () => {
      for (let attempt = 0; attempt < 10; attempt += 1) {
        await Promise.resolve();
      }
      jest.advanceTimersByTime(5_000);
      for (let attempt = 0; attempt < 10; attempt += 1) {
        await Promise.resolve();
      }
      await signIn;
    });
    expect(blocked).toMatchObject({
      name: 'CredentialCleanupRestoreDeadlineError',
    });
    expect(
      mockEnvironment.hostedClient.createNativeSession,
    ).not.toHaveBeenCalled();

    cleanup.resolve(false);
    await Promise.resolve();
  } finally {
    jest.useRealTimers();
  }
});

test('keeps a verified active session when remembered-server persistence fails', async () => {
  mockInstallation.selectedServerStore.set.mockRejectedValue(
    new Error('preference storage unavailable'),
  );
  mockEnvironment.connectAccountServer.mockImplementation(
    connectImplementation(),
  );
  await renderProvider();

  await ReactTestRenderer.act(async () => {
    await auth.signInWithPortico('viewer@example.com', 'correct password');
  });

  expect(auth.status).toBe('authenticated');
  expect(auth.session?.viewerScope).toEqual(
    expect.objectContaining({serverId: 'server-1', profileId: 'profile-1'}),
  );
  expect(viewerRuntime.getSnapshot().scope).toEqual(auth.session?.viewerScope);
});

test('keeps a verified active session when remembered-profile persistence fails', async () => {
  mockInstallation.profileSelectionStore.recordVerifiedSelection.mockRejectedValue(
    new Error('preference storage unavailable'),
  );
  mockEnvironment.connectAccountServer.mockImplementation(
    connectImplementation(),
  );
  await renderProvider();

  await ReactTestRenderer.act(async () => {
    await auth.signInWithPortico('viewer@example.com', 'correct password');
  });

  expect(auth.status).toBe('authenticated');
  expect(auth.session?.viewerScope).toEqual(
    expect.objectContaining({serverId: 'server-1', profileId: 'profile-1'}),
  );
  expect(viewerRuntime.getSnapshot().scope).toEqual(auth.session?.viewerScope);
});

test('rotates the viewer runtime when authorization revision changes on the same profile', async () => {
  mockEnvironment.connectAccountServer.mockImplementation(
    connectImplementation(),
  );
  await renderProvider();
  await ReactTestRenderer.act(async () => {
    await auth.signInWithPortico('viewer@example.com', 'correct password');
  });
  const previousClient = viewerRuntime.getSnapshot().queryClient;
  const reasons: string[] = [];
  viewerRuntime.register('requests', (_scope, reason) => {
    reasons.push(reason);
  });
  mockEnvironment.connectAccountServer.mockImplementationOnce(
    connectImplementation({
      ...hostedViewerIdentity,
      authorizationRevision: 'authorization-2',
    }),
  );

  await ReactTestRenderer.act(async () => {
    await auth.retryServerDiscovery();
  });

  expect(reasons).toContain('authorization-changed');
  expect(viewerRuntime.getSnapshot().scope?.authorizationRevision).toBe(
    'authorization-2',
  );
  expect(viewerRuntime.getSnapshot().queryClient).not.toBe(previousClient);
});

test('a hung older server producer is aborted and the latest server choice wins', async () => {
  mockEnvironment.connectAccountServer.mockImplementation(
    connectSelectedServerImplementation(),
  );
  await renderProvider();
  await ReactTestRenderer.act(async () => {
    await auth.signInWithPortico('viewer@example.com', 'correct password');
  });
  expect(auth.session?.serverId).toBe('server-1');

  const serverB = {...server, id: 'server-b', name: 'Server B'};
  const serverC = {...server, id: 'server-c', name: 'Server C'};
  mockEnvironment.hostedClient.createProfileSelectionEnvelope
    .mockImplementationOnce(() => new Promise(() => undefined))
    .mockImplementation(
      (
        profileId: string,
        options: {installationId: string; serverId: string},
      ) =>
        Promise.resolve({
          ...selectionEnvelope,
          installationId: options.installationId,
          profileId,
          serverId: options.serverId,
        }),
    );

  let older!: Promise<unknown>;
  await ReactTestRenderer.act(async () => {
    older = auth.chooseServer(serverB).catch(cause => cause);
    for (let attempt = 0; attempt < 6; attempt += 1) await Promise.resolve();
  });
  await ReactTestRenderer.act(async () => {
    await auth.chooseServer(serverC);
    await older;
  });

  expect(auth.session?.serverId).toBe('server-c');
  expect(auth.selectedServer?.id).toBe('server-c');
  expect(viewerRuntime.getSnapshot().scope?.serverId).toBe('server-c');
  expect(mockInstallation.selectedServerStore.set).toHaveBeenLastCalledWith(
    'server-c',
  );
});

test('a hung pre-stage Core connection is abandoned only while isolated and the latest server wins', async () => {
  mockEnvironment.connectAccountServer.mockImplementation(
    connectSelectedServerImplementation(),
  );
  await renderProvider();
  await ReactTestRenderer.act(async () => {
    await auth.signInWithPortico('viewer@example.com', 'correct password');
  });

  const serverB = {...server, id: 'server-b', name: 'Server B'};
  const serverC = {...server, id: 'server-c', name: 'Server C'};
  mockEnvironment.connectAccountServer
    .mockImplementationOnce(() => new Promise(() => undefined))
    .mockImplementation(connectSelectedServerImplementation());

  let older!: Promise<unknown>;
  await ReactTestRenderer.act(async () => {
    older = auth.chooseServer(serverB).catch(cause => cause);
    for (let attempt = 0; attempt < 10; attempt += 1) {
      await Promise.resolve();
    }
  });
  await ReactTestRenderer.act(async () => {
    await auth.chooseServer(serverC);
    await older;
  });

  expect(auth.session?.serverId).toBe('server-c');
  expect(auth.selectedServer?.id).toBe('server-c');
  expect(viewerRuntime.getSnapshot().scope?.serverId).toBe('server-c');
});

test('a profile-selection preference read failure falls back without discarding viewer A', async () => {
  mockEnvironment.connectAccountServer.mockImplementation(
    connectSelectedServerImplementation(),
  );
  await renderProvider();
  await ReactTestRenderer.act(async () => {
    await auth.signInWithPortico('viewer@example.com', 'correct password');
  });
  const serverB = {...server, id: 'server-b', name: 'Server B'};
  const serverC = {...server, id: 'server-c', name: 'Server C'};
  mockEnvironment.hostedClient.createProfileSelectionEnvelope.mockImplementationOnce(
    () => new Promise(() => undefined),
  );

  let older!: Promise<unknown>;
  await ReactTestRenderer.act(async () => {
    older = auth.chooseServer(serverB).catch(cause => cause);
    for (let attempt = 0; attempt < 10; attempt += 1) {
      await Promise.resolve();
    }
  });
  mockInstallation.profileSelectionStore.get.mockRejectedValueOnce(
    new Error('preferences unavailable'),
  );
  await ReactTestRenderer.act(async () => {
    await auth.chooseServer(serverC);
    await older;
  });

  expect(auth.session?.serverId).toBe('server-c');
  expect(auth.selectedServer).toEqual(serverC);
  expect(viewerRuntime.getSnapshot().scope?.serverId).toBe('server-c');
  expect(mockEnvironment.getServerSession()).not.toEqual(
    expect.objectContaining({serverId: 'server-b'}),
  );
});

test('a hung older profile producer is aborted and the latest profile choice wins', async () => {
  const secondProfile = {
    ...profile,
    id: 'profile-2',
    isAccountAdmin: false,
    isPrimary: false,
    name: 'Guest',
    sortOrder: 1,
  };
  mockEnvironment.hostedClient.profiles.mockResolvedValue({
    accountId: 'user-1',
    profiles: [profile, secondProfile],
    revision: 2,
    total: 2,
  });
  mockEnvironment.connectAccountServer.mockImplementation(
    connectSelectedServerImplementation(),
  );
  await renderProvider('tv');
  await ReactTestRenderer.act(async () => {
    await auth.signInWithPortico('viewer@example.com', 'correct password');
  });
  await ReactTestRenderer.act(async () => {
    await auth.chooseProfile(profile.id);
  });
  await ReactTestRenderer.act(async () => {
    await auth.beginProfileSelection();
  });
  expect(auth.status).toBe('selecting-profile');

  mockEnvironment.hostedClient.createProfileSelectionEnvelope
    .mockImplementationOnce(() => new Promise(() => undefined))
    .mockImplementation(
      (
        profileId: string,
        options: {installationId: string; serverId: string},
      ) =>
        Promise.resolve({
          ...selectionEnvelope,
          installationId: options.installationId,
          profileId,
          serverId: options.serverId,
        }),
    );
  let older!: Promise<unknown>;
  await ReactTestRenderer.act(async () => {
    older = auth.chooseProfile(profile.id).catch(cause => cause);
    for (let attempt = 0; attempt < 6; attempt += 1) await Promise.resolve();
  });
  await ReactTestRenderer.act(async () => {
    await auth.chooseProfile(secondProfile.id);
    await older;
  });

  expect(auth.session?.viewerScope.profileId).toBe(secondProfile.id);
  expect(viewerRuntime.getSnapshot().scope?.profileId).toBe(secondProfile.id);
  expect(
    mockInstallation.profileSelectionStore.recordVerifiedSelection,
  ).toHaveBeenLastCalledWith(
    {
      accountId: 'user-1',
      authority: 'hosted',
      installationId: 'installation-1',
      profileId: secondProfile.id,
      serverId: 'server-1',
    },
    'tv',
  );
});

test('re-entering the current Hosted profile through the full selector stays authenticated', async () => {
  mockEnvironment.hostedClient.profiles.mockResolvedValue({
    accountId: 'user-1',
    profiles: [profile],
    revision: 1,
    total: 1,
  });
  mockEnvironment.connectAccountServer.mockImplementation(
    connectSelectedServerImplementation(),
  );
  const renderer = await renderProvider();
  await ReactTestRenderer.act(async () => {
    await auth.signInWithPortico('viewer@example.com', 'correct password');
  });
  await ReactTestRenderer.act(async () => {
    await auth.chooseProfile(profile.id);
  });
  await ReactTestRenderer.act(async () => {
    await auth.beginProfileSelection();
  });
  expect(auth.status).toBe('selecting-profile');

  await ReactTestRenderer.act(async () => {
    await auth.chooseProfile(profile.id);
  });

  expect(auth.status).toBe('authenticated');
  expect(auth.session?.viewerScope.profileId).toBe(profile.id);
  expect(viewerRuntime.getSnapshot().scope?.profileId).toBe(profile.id);
  await ReactTestRenderer.act(async () => renderer.unmount());
});

test('keeps Local Auth server-coupled when the server cannot authenticate', async () => {
  mockEnvironment.createServerClient.mockReturnValue({
    checkServerCompatibility: jest
      .fn()
      .mockRejectedValue(new Error('Local server is offline.')),
  });
  await renderProvider();

  let caught: unknown;
  await ReactTestRenderer.act(async () => {
    try {
      await auth.signInWithLocalAuth(
        'https://local.test',
        'viewer',
        'password',
      );
    } catch (cause) {
      caught = cause;
    }
  });

  expect(caught).toEqual(new Error('Local server is offline.'));
  expect(auth.account).toBeUndefined();
  expect(auth.session).toBeUndefined();
  expect(auth.status).toBe('signed-out');
  expect(auth.error).toBe(
    "Portico couldn't establish a secure connection. Check your network and try again.",
  );
});

test('checks the authenticated Product Contract only after Local Auth mints a profile session', async () => {
  const controls = configureLocalAuth();
  await renderProvider();

  await ReactTestRenderer.act(async () => {
    await auth.signInWithLocalAuth('https://local.test', 'viewer', 'password');
  });

  expect(controls.checkServerCompatibility).toHaveBeenCalledTimes(1);
  expect(controls.authenticateLocalProfileAccount).toHaveBeenCalledTimes(1);
  expect(controls.createNativeProfileSession).toHaveBeenCalledTimes(1);
  expect(controls.checkCompatibility).toHaveBeenCalledTimes(1);
  expect(
    controls.authenticateLocalProfileAccount.mock.invocationCallOrder[0],
  ).toBeLessThan(
    controls.createNativeProfileSession.mock.invocationCallOrder[0]!,
  );
  expect(
    controls.createNativeProfileSession.mock.invocationCallOrder[0],
  ).toBeLessThan(controls.checkCompatibility.mock.invocationCallOrder[0]!);
  expect(auth.status).toBe('authenticated');
});

test('rejects plaintext Local Auth before sending credentials to a non-loopback server', async () => {
  await renderProvider();

  let caught: unknown;
  await ReactTestRenderer.act(async () => {
    try {
      await auth.signInWithLocalAuth(
        'http://192.168.1.20:32500',
        'viewer',
        'password',
      );
    } catch (cause) {
      caught = cause;
    }
  });

  expect(caught).toBeDefined();
  expect(mockEnvironment.createServerClient).not.toHaveBeenCalled();
  expect(auth.session).toBeUndefined();
  expect(auth.status).toBe('signed-out');
});

test.each([
  'https://demo.getportico.tv/untrusted-base',
  'https://demo.getportico.tv/?redirect=elsewhere',
  'https://demo.getportico.tv/#credentials',
  'https://viewer:secret@demo.getportico.tv',
])('rejects a non-origin Local Auth server address before sending credentials: %s', async serverURL => {
  await renderProvider();

  await expect(
    ReactTestRenderer.act(async () => {
      await auth.signInWithLocalAuth(serverURL, 'viewer', 'password');
    }),
  ).rejects.toBeDefined();

  expect(mockEnvironment.createServerClient).not.toHaveBeenCalled();
  expect(auth.session).toBeUndefined();
});

test('keeps Local Auth provisional through four-digit PIN selection and publishes only after verified persistence', async () => {
  const lockedProfile = {...localProfile, hasPIN: true, pinRevision: 2};
  const controls = configureLocalAuth({
    authentication: {
      ...localAuthentication,
      directory: {...localAuthentication.directory, profiles: [lockedProfile]},
    },
    credentials: {...localCredentials, profileId: lockedProfile.id},
    grant: {...localGrant, pinRevision: 2, profileId: lockedProfile.id},
    identity: {...localViewerIdentity, profileId: lockedProfile.id},
  });
  await renderProvider();

  await ReactTestRenderer.act(async () => {
    await auth.signInWithLocalAuth('https://local.test', 'viewer', 'password');
  });

  expect(auth.status).toBe('selecting-profile');
  expect(auth.profileAwaitingPINId).toBe(lockedProfile.id);
  expect(mockEnvironment.setServerSession).not.toHaveBeenCalledWith(
    expect.objectContaining({accessToken: 'local-access'}),
  );

  await ReactTestRenderer.act(async () => {
    await auth.chooseProfile(lockedProfile.id, '1234');
  });

  expect(controls.selectLocalProfile).toHaveBeenCalledWith({
    accountAuthenticationToken: 'local-account-proof',
    pin: '1234',
    profileId: lockedProfile.id,
  });
  expect(controls.createNativeProfileSession).toHaveBeenCalledWith(
    expect.objectContaining({selectionGrant: 'local-selection-grant'}),
  );
  expect(mockStorage.serverCredentialAdapter.save).toHaveBeenCalledWith(
    expect.objectContaining({
      accessToken: 'local-access',
      authenticationMode: 'local',
      refreshToken: 'local-refresh',
    }),
  );
  expect(auth.status).toBe('authenticated');
  expect(auth.session?.viewerScope).toEqual(
    expect.objectContaining({
      authority: 'local',
      profileId: lockedProfile.id,
      serverId: 'local-server-1',
    }),
  );
});

test('uses canonical incorrect-PIN copy without publishing Local Auth globals', async () => {
  const lockedProfile = {...localProfile, hasPIN: true, pinRevision: 1};
  configureLocalAuth({
    authentication: {
      ...localAuthentication,
      directory: {...localAuthentication.directory, profiles: [lockedProfile]},
    },
    grant: {...localGrant, pinRevision: 1, profileId: lockedProfile.id},
    selectFailure: new ApiError(
      401,
      'local_profile_pin_invalid',
      'Incorrect PIN.',
    ),
  });
  await renderProvider();
  await ReactTestRenderer.act(async () => {
    await auth.signInWithLocalAuth('https://local.test', 'viewer', 'password');
  });

  let caught: unknown;
  await ReactTestRenderer.act(async () => {
    try {
      await auth.chooseProfile(lockedProfile.id, '9999');
    } catch (cause) {
      caught = cause;
    }
  });

  expect(caught).toMatchObject({code: 'local_profile_pin_invalid'});
  expect(auth.status).toBe('selecting-profile');
  expect(auth.serverError).toBe('Try the four-digit PIN again.');
  expect(auth.session).toBeUndefined();
  expect(mockStorage.serverCredentialAdapter.save).not.toHaveBeenCalled();
});

test('rejects an expired Local Auth selection grant before session minting', async () => {
  const controls = configureLocalAuth({
    grant: {...localGrant, expiresAt: '2000-01-01T00:00:00.000Z'},
  });
  await renderProvider();

  await expect(
    ReactTestRenderer.act(async () => {
      await auth.signInWithLocalAuth(
        'https://local.test',
        'viewer',
        'password',
      );
    }),
  ).rejects.toThrow('profile selection did not match');

  expect(controls.createNativeProfileSession).not.toHaveBeenCalled();
  expect(mockStorage.serverCredentialAdapter.save).not.toHaveBeenCalled();
  expect(viewerRuntime.getSnapshot().scope).toBeUndefined();
});

test.each([
  ['authority', {authority: 'hosted' as const}],
  ['account', {accountId: 'other-account'}],
  ['server', {serverId: 'other-server'}],
  ['profile', {profileId: 'other-profile'}],
])(
  'rejects Local Auth final %s identity mismatch without publication',
  async (_label, mismatch) => {
    const credentials = {
      ...localCredentials,
      ...mismatch,
    } as NativeSessionCredentials;
    const identity = {...localViewerIdentity, ...mismatch} as AuthMeResponse;
    configureLocalAuth({credentials, identity});
    await renderProvider();

    await expect(
      ReactTestRenderer.act(async () => {
        await auth.signInWithLocalAuth(
          'https://local.test',
          'viewer',
          'password',
        );
      }),
    ).rejects.toThrow();

    expect(mockStorage.serverCredentialAdapter.save).not.toHaveBeenCalled();
    expect(auth.session).toBeUndefined();
    expect(viewerRuntime.getSnapshot().scope).toBeUndefined();
  },
);

test('preserves viewer A when provisional Local Auth verification and candidate cleanup both fail', async () => {
  mockEnvironment.connectAccountServer.mockImplementation(
    connectImplementation(),
  );
  await renderProvider();
  await ReactTestRenderer.act(async () => {
    await auth.signInWithPortico('viewer@example.com', 'correct password');
  });
  const previousSession = auth.session;
  const previousScope = viewerRuntime.getSnapshot().scope;
  const controls = configureLocalAuth({
    identity: {...localViewerIdentity, profileId: 'wrong-profile'},
    revokeFailure: new Error('candidate revocation unavailable'),
  });

  let caught: unknown;
  await ReactTestRenderer.act(async () => {
    try {
      await auth.signInWithLocalAuth(
        'https://local.test',
        'viewer',
        'password',
      );
    } catch (cause) {
      caught = cause;
    }
  });

  expect(caught).toMatchObject({
    message: 'native credentials and authenticated viewer scope do not match',
  });
  expect(controls.revokeNativeSession).toHaveBeenCalledWith('local-refresh');
  expect(mockStorage.serverCredentialAdapter.save).not.toHaveBeenCalled();
  expect(auth.status).toBe('authenticated');
  expect(auth.session).toEqual(previousSession);
  expect(viewerRuntime.getSnapshot()).toEqual(
    expect.objectContaining({
      acceptingWrites: true,
      scope: previousScope,
      transitionFailure: undefined,
    }),
  );
});

test('a hung unpublished Local Auth revocation cannot block the newer profile choice', async () => {
  const directory = {
    ...localAuthentication.directory,
    profiles: [localProfile, secondLocalProfile],
  };
  mockInstallation.profileSelectionStore.get.mockResolvedValue({
    profileSelection: 'ask',
    rememberAccount: true,
  });
  const controls = configureLocalAuth({
    authentication: {...localAuthentication, directory},
  });
  await renderProvider('tv');
  await ReactTestRenderer.act(async () => {
    await auth.signInWithLocalAuth('https://local.test', 'viewer', 'password');
  });
  expect(auth.status).toBe('selecting-profile');

  controls.me.mockResolvedValueOnce({
    ...localViewerIdentity,
    profileId: 'wrong-profile',
  });
  controls.revokeNativeSession.mockReturnValue(
    new Promise<never>(() => undefined),
  );

  jest.useFakeTimers();
  try {
    let firstFailure: unknown;
    await ReactTestRenderer.act(async () => {
      try {
        await auth.chooseProfile(localProfile.id);
      } catch (cause) {
        firstFailure = cause;
      }
    });
    expect(firstFailure).toBeInstanceOf(Error);
    expect(controls.revokeNativeSession).toHaveBeenCalledWith('local-refresh');

    await ReactTestRenderer.act(async () => {
      await auth.chooseProfile(secondLocalProfile.id);
    });
    expect(auth.status).toBe('authenticated');
    expect(auth.session?.viewerScope.profileId).toBe(secondLocalProfile.id);
    expect(viewerRuntime.getSnapshot().scope?.profileId).toBe(
      secondLocalProfile.id,
    );

    await ReactTestRenderer.act(async () => {
      jest.advanceTimersByTime(5_000);
      await Promise.resolve();
    });
  } finally {
    jest.useRealTimers();
  }
});

test('a late Local Auth mint is revoked and cleared after a newer profile wins', async () => {
  const directory = {
    ...localAuthentication.directory,
    profiles: [localProfile, secondLocalProfile],
  };
  mockInstallation.profileSelectionStore.get.mockResolvedValue({
    profileSelection: 'ask',
    rememberAccount: true,
  });
  const controls = configureLocalAuth({
    authentication: {...localAuthentication, directory},
  });
  await renderProvider('tv');
  await ReactTestRenderer.act(async () => {
    await auth.signInWithLocalAuth('https://local.test', 'viewer', 'password');
  });
  const lateMint = deferred<NativeSessionCredentials>();
  controls.createNativeProfileSession
    .mockImplementationOnce(() => lateMint.promise)
    .mockResolvedValue({
      ...localCredentials,
      profileId: secondLocalProfile.id,
    });

  let older!: Promise<unknown>;
  await ReactTestRenderer.act(async () => {
    older = auth.chooseProfile(localProfile.id).catch(cause => cause);
    for (let attempt = 0; attempt < 10; attempt += 1) {
      await Promise.resolve();
    }
  });
  await ReactTestRenderer.act(async () => {
    await auth.chooseProfile(secondLocalProfile.id);
    await older;
  });
  expect(auth.session?.viewerScope.profileId).toBe(secondLocalProfile.id);

  await ReactTestRenderer.act(async () => {
    lateMint.resolve({
      ...localCredentials,
      accessToken: 'orphan-access',
      profileId: localProfile.id,
      refreshToken: 'orphan-refresh',
    });
    for (let attempt = 0; attempt < 20; attempt += 1) {
      await Promise.resolve();
    }
  });

  expect(controls.revokeNativeSession).toHaveBeenCalledWith('orphan-refresh');
  expect(auth.session?.viewerScope.profileId).toBe(secondLocalProfile.id);
  expect(viewerRuntime.getSnapshot().scope?.profileId).toBe(
    secondLocalProfile.id,
  );
});

test('mobile opens the last-used Local profile while TV asks explicitly', async () => {
  const directory = {
    ...localAuthentication.directory,
    profiles: [localProfile, secondLocalProfile],
  };
  mockInstallation.profileSelectionStore.get.mockResolvedValue({
    profileSelection: 'last-used',
    rememberAccount: true,
    lastProfileId: secondLocalProfile.id,
  });
  const mobileControls = configureLocalAuth({
    authentication: {...localAuthentication, directory},
  });
  let renderer = await renderProvider('mobile');
  await ReactTestRenderer.act(async () => {
    await auth.signInWithLocalAuth('https://local.test', 'viewer', 'password');
  });
  expect(mobileControls.selectLocalProfile).toHaveBeenCalledWith(
    expect.objectContaining({profileId: secondLocalProfile.id}),
  );
  expect(mockInstallation.profileSelectionStore.get).toHaveBeenCalledWith(
    {
      authority: 'local',
      accountId: localAuthentication.directory.accountId,
      serverId: localAuthentication.directory.serverId,
      installationId: 'installation-1',
    },
    'mobile',
  );
  expect(auth.session?.viewerScope.profileId).toBe(secondLocalProfile.id);
  await ReactTestRenderer.act(async () => renderer.unmount());

  jest.clearAllMocks();
  viewerRuntime = new ViewerRuntimeCoordinator();
  durableServerCredential = undefined;
  mockStorage.retryPendingCredentialCleanup.mockResolvedValue(false);
  mockStorage.hostedCredentialStore.load.mockResolvedValue(undefined);
  mockStorage.serverCredentialAdapter.load.mockImplementation(
    async () => durableServerCredential,
  );
  mockStorage.serverCredentialAdapter.save.mockImplementation(
    async (session: Record<string, unknown>) => {
      durableServerCredential = session;
    },
  );
  mockInstallation.profileSelectionStore.get.mockResolvedValue({
    profileSelection: 'ask',
    rememberAccount: true,
    lastProfileId: secondLocalProfile.id,
  });
  const tvControls = configureLocalAuth({
    authentication: {...localAuthentication, directory},
  });
  renderer = await renderProvider('tv');
  await ReactTestRenderer.act(async () => {
    await auth.signInWithLocalAuth('https://local.test', 'viewer', 'password');
  });
  expect(auth.status).toBe('selecting-profile');
  expect(tvControls.selectLocalProfile).not.toHaveBeenCalled();
  expect(mockInstallation.profileSelectionStore.get).toHaveBeenCalledWith(
    {
      authority: 'local',
      accountId: localAuthentication.directory.accountId,
      serverId: localAuthentication.directory.serverId,
      installationId: 'installation-1',
    },
    'tv',
  );
  await ReactTestRenderer.act(async () => renderer.unmount());
});

test('safely switches a later Local Auth profile through the active account session without clearing A first', async () => {
  const directory = {
    ...localAuthentication.directory,
    profiles: [localProfile, secondLocalProfile],
  };
  mockInstallation.profileSelectionStore.get.mockResolvedValue({
    profileSelection: 'last-used',
    rememberAccount: true,
    lastProfileId: localProfile.id,
  });
  const controls = configureLocalAuth({
    authentication: {...localAuthentication, directory},
  });
  await renderProvider();
  await ReactTestRenderer.act(async () => {
    await auth.signInWithLocalAuth('https://local.test', 'viewer', 'password');
  });
  expect(auth.session?.viewerScope.profileId).toBe(localProfile.id);

  await ReactTestRenderer.act(async () => {
    await auth.beginProfileSelection();
  });
  expect(auth.status).toBe('selecting-profile');

  const delayedSave = deferred();
  mockStorage.serverCredentialAdapter.save.mockImplementationOnce(
    async (session: Record<string, unknown>) => {
      await delayedSave.promise;
      durableServerCredential = session;
    },
  );
  let switching!: Promise<void>;
  await ReactTestRenderer.act(async () => {
    switching = auth.chooseProfile(secondLocalProfile.id);
    for (let attempt = 0; attempt < 8; attempt += 1) await Promise.resolve();
  });
  expect(viewerRuntime.getSnapshot().scope?.profileId).toBe(localProfile.id);
  expect(viewerRuntime.getSnapshot().acceptingWrites).toBe(false);

  delayedSave.resolve();
  await ReactTestRenderer.act(async () => switching);
  expect(controls.selectActiveLocalProfile).toHaveBeenLastCalledWith(
    expect.objectContaining({
      profileId: secondLocalProfile.id,
      purpose: 'native',
    }),
  );
  expect(auth.session?.viewerScope.profileId).toBe(secondLocalProfile.id);
});

test('uses the active Local Auth account session even after the password bootstrap expires', async () => {
  configureLocalAuth();
  await renderProvider();
  await ReactTestRenderer.act(async () => {
    await auth.signInWithLocalAuth('https://local.test', 'viewer', 'password');
  });
  const activeSession = auth.session;
  const now = jest
    .spyOn(Date, 'now')
    .mockReturnValue(Date.parse('3000-01-01T00:00:00.000Z'));

  await ReactTestRenderer.act(async () => {
    await auth.beginProfileSelection();
  });
  expect(auth.requiresLocalProfileReauthentication).toBe(false);
  expect(auth.session).toBe(activeSession);
  expect(auth.status).toBe('selecting-profile');
  expect(auth.issue).toBeUndefined();
  now.mockRestore();
});

test('reports an MFA challenge without losing it behind a generic sign-in error', async () => {
  mockEnvironment.hostedClient.createNativeSession.mockRejectedValueOnce(
    new ApiError(401, 'mfa_required', 'Enter the MFA code for this account.'),
  );
  await renderProvider();

  let caught: unknown;
  await ReactTestRenderer.act(async () => {
    try {
      await auth.signInWithPortico('viewer@example.com', 'correct password');
    } catch (cause) {
      caught = cause;
    }
  });

  expect(caught).toBeInstanceOf(ApiError);
  expect(auth.status).toBe('signed-out');
  expect(auth.error).toBeUndefined();
});

test('maps an account reauthentication failure without replacing an active viewer or leaking it into profile state', async () => {
  mockEnvironment.connectAccountServer.mockImplementation(
    connectImplementation(),
  );
  await renderProvider();
  await ReactTestRenderer.act(async () => {
    await auth.signInWithPortico('viewer@example.com', 'correct password');
  });
  const activeSession = auth.session;
  mockEnvironment.hostedClient.createNativeSession.mockRejectedValueOnce(
    new ApiError(401, 'session_expired', 'Sign in again.'),
  );

  await ReactTestRenderer.act(async () => {
    await auth
      .signInWithPortico('other@example.com', 'expired password')
      .catch(() => undefined);
  });

  expect(auth.session).toBe(activeSession);
  expect(auth.status).toBe('authenticated');
  expect(auth.error).toBeUndefined();
  expect(auth.issue).toEqual(
    expect.objectContaining({
      blocking: false,
      phase: 'account',
      presentation: expect.objectContaining({id: 'auth.session-expired'}),
    }),
  );
});

test('submits only the selected MFA credential to Hosted Services', async () => {
  await renderProvider();

  await ReactTestRenderer.act(async () => {
    await auth.signInWithPortico('viewer@example.com', 'correct password', {
      kind: 'totp',
      code: ' 123456 ',
    });
  });

  expect(mockEnvironment.hostedClient.createNativeSession).toHaveBeenCalledWith(
    expect.objectContaining({
      login: 'viewer@example.com',
      mfaCode: '123456',
    }),
    {signal: expect.any(AbortSignal)},
  );
  expect(
    mockEnvironment.hostedClient.createNativeSession.mock.calls[0][0],
  ).not.toHaveProperty('recoveryCode');
});

test('registers an account and immediately creates its secure native session', async () => {
  await renderProvider();

  await ReactTestRenderer.act(async () => {
    await auth.registerPorticoAccount(
      ' viewer@example.com ',
      ' Viewer ',
      'correct password',
    );
  });

  expect(mockEnvironment.hostedClient.register).toHaveBeenCalledWith(
    {
      email: 'viewer@example.com',
      username: 'Viewer',
      password: 'correct password',
    },
    {signal: expect.any(AbortSignal)},
  );
  expect(mockStorage.hostedCredentialStore.save).toHaveBeenCalledWith(
    accountSession,
  );
  expect(auth.account).toEqual(accountSession.user);
});

test('reports account creation as partial success when automatic sign-in fails', async () => {
  mockEnvironment.hostedClient.createNativeSession.mockRejectedValueOnce(
    new Error('Native session temporarily unavailable.'),
  );
  await renderProvider();

  let caught: unknown;
  await ReactTestRenderer.act(async () => {
    try {
      await auth.registerPorticoAccount(
        ' viewer@example.com ',
        ' Viewer ',
        'correct password',
      );
    } catch (cause) {
      caught = cause;
    }
  });

  expect(caught).toEqual(
    expect.objectContaining({
      code: 'account_created_sign_in_required',
      email: 'viewer@example.com',
    }),
  );
  expect(auth.status).toBe('signed-out');
  expect(auth.account).toBeUndefined();
  expect(auth.error).toBeUndefined();
});

test('requests an enumeration-safe password reset without changing authentication state', async () => {
  await renderProvider();

  await ReactTestRenderer.act(async () => {
    await auth.requestPasswordReset(' viewer@example.com ');
  });

  expect(
    mockEnvironment.hostedClient.requestPasswordReset,
  ).toHaveBeenCalledWith({email: 'viewer@example.com'});
  expect(auth.status).toBe('signed-out');
  expect(auth.error).toBeUndefined();
});

test('best-effort attempts both remote refresh-family revocations without trapping offline sign-out', async () => {
  mockEnvironment.connectAccountServer.mockImplementation(
    connectImplementation(),
  );
  await renderProvider();
  await ReactTestRenderer.act(async () => {
    await auth.signInWithPortico('viewer@example.com', 'correct password');
  });
  mockStorage.hostedCredentialStore.load.mockResolvedValue(accountSession);
  mockEnvironment.getServerSession.mockReturnValue({
    accessToken: 'server-access',
    apiBaseUrl: 'https://home.test',
    authenticationMode: 'portico-account',
    hostedAccountId: 'user-1',
    refreshToken: 'server-refresh',
    routeType: 'direct',
    serverId: 'server-1',
  });
  mockStorage.trustedServerConnectionAdapter.list.mockResolvedValue([
    {
      accountId: 'user-1',
      serverId: 'server-1',
      session: {
        accessToken: 'duplicate-access',
        apiBaseUrl: 'https://home.test',
        refreshToken: 'server-refresh',
        serverId: 'server-1',
      },
    },
    {
      accountId: 'user-1',
      serverId: 'server-2',
      session: {
        accessToken: 'cottage-access',
        apiBaseUrl: 'https://cottage.test',
        refreshToken: 'cottage-refresh',
        serverId: 'server-2',
      },
    },
  ]);
  const revokeServerSession = jest
    .fn()
    .mockRejectedValue(new TypeError('Portico Server is offline.'));
  mockEnvironment.createServerClient.mockReturnValue({
    revokeNativeSession: revokeServerSession,
  });
  mockEnvironment.hostedClient.revokeNativeSession.mockRejectedValueOnce(
    new TypeError('Hosted Services is offline.'),
  );

  await ReactTestRenderer.act(async () => {
    await auth.signOut();
  });

  expect(mockEnvironment.hostedClient.revokeNativeSession).toHaveBeenCalledWith(
    'hosted-refresh',
  );
  expect(revokeServerSession).toHaveBeenCalledWith('server-refresh');
  expect(revokeServerSession).toHaveBeenCalledWith('cottage-refresh');
  expect(revokeServerSession).toHaveBeenCalledTimes(2);
  expect(mockStorage.trustedServerConnectionAdapter.list).toHaveBeenCalledWith(
    'user-1',
  );
  expect(mockEnvironment.createServerClient).toHaveBeenCalledWith(
    'mobile',
    'installation-1',
    expect.objectContaining({
      clear: expect.any(Function),
      get: expect.any(Function),
    }),
    null,
  );
  expect(
    mockStorage.beginCredentialCleanup.mock.invocationCallOrder[0],
  ).toBeLessThan(revokeServerSession.mock.invocationCallOrder[0]);
  expect(
    mockStorage.beginCredentialCleanup.mock.invocationCallOrder[0],
  ).toBeLessThan(
    mockStorage.finishCredentialCleanup.mock.invocationCallOrder[0],
  );
  expect(auth.status).toBe('signed-out');
  expect(auth.account).toBeUndefined();
  expect(auth.session).toBeUndefined();
  expect(auth.warning).toBeUndefined();
});

test('hung remote revocations cannot delay durable sign-out cleanup', async () => {
  mockEnvironment.connectAccountServer.mockImplementation(
    connectImplementation(),
  );
  await renderProvider();
  await ReactTestRenderer.act(async () => {
    await auth.signInWithPortico('viewer@example.com', 'correct password');
  });
  mockStorage.hostedCredentialStore.load.mockResolvedValue(accountSession);
  mockEnvironment.getServerSession.mockReturnValue({
    accessToken: 'server-access',
    apiBaseUrl: 'https://home.test',
    authenticationMode: 'portico-account',
    hostedAccountId: 'user-1',
    refreshToken: 'server-refresh',
    routeType: 'direct',
    serverId: 'server-1',
  });
  const hungRevocation = new Promise<never>(() => undefined);
  const revokeServerSession = jest.fn(() => hungRevocation);
  mockEnvironment.createServerClient.mockReturnValue({
    revokeNativeSession: revokeServerSession,
  });
  mockEnvironment.hostedClient.revokeNativeSession.mockReturnValue(
    hungRevocation,
  );
  let durableCleanupFinished = false;
  mockStorage.finishCredentialCleanup.mockImplementationOnce(async () => {
    durableCleanupFinished = true;
  });

  jest.useFakeTimers();
  try {
    let signOutSettled = false;
    let signingOut!: Promise<void>;
    await ReactTestRenderer.act(async () => {
      signingOut = auth.signOut().then(() => {
        signOutSettled = true;
      });
      for (let attempt = 0; attempt < 20; attempt += 1) {
        await Promise.resolve();
      }
    });

    expect(
      mockEnvironment.hostedClient.revokeNativeSession,
    ).toHaveBeenCalledWith('hosted-refresh');
    expect(revokeServerSession).toHaveBeenCalledWith('server-refresh');
    expect(durableCleanupFinished).toBe(true);
    expect(mockInstallation.selectedServerStore.clear).toHaveBeenCalled();
    expect(signOutSettled).toBe(false);
    expect(auth.status).toBe('signed-out');
    expect(auth.session).toBeUndefined();
    expect(viewerRuntime.getSnapshot().scope).toBeUndefined();

    await ReactTestRenderer.act(async () => {
      jest.advanceTimersByTime(5_000);
      await signingOut;
    });
    expect(signOutSettled).toBe(true);
    expect(auth.warning).toBeUndefined();
  } finally {
    jest.useRealTimers();
  }
});

test('a hung Hosted credential read cannot delay local sign-out cleanup', async () => {
  mockEnvironment.connectAccountServer.mockImplementation(
    connectImplementation(),
  );
  await renderProvider();
  await ReactTestRenderer.act(async () => {
    await auth.signInWithPortico('viewer@example.com', 'correct password');
  });
  mockStorage.hostedCredentialStore.load.mockReturnValue(
    new Promise<never>(() => undefined),
  );
  let durableCleanupFinished = false;
  mockStorage.finishCredentialCleanup.mockImplementationOnce(async () => {
    durableCleanupFinished = true;
  });

  jest.useFakeTimers();
  try {
    let signOutSettled = false;
    let signingOut!: Promise<void>;
    await ReactTestRenderer.act(async () => {
      signingOut = auth.signOut().then(() => {
        signOutSettled = true;
      });
      for (let attempt = 0; attempt < 20; attempt += 1) {
        await Promise.resolve();
      }
    });

    expect(durableCleanupFinished).toBe(true);
    expect(mockInstallation.selectedServerStore.clear).toHaveBeenCalled();
    expect(
      mockEnvironment.hostedClient.revokeNativeSession,
    ).not.toHaveBeenCalled();
    expect(signOutSettled).toBe(false);
    expect(auth.status).toBe('signed-out');
    expect(viewerRuntime.getSnapshot().scope).toBeUndefined();

    await ReactTestRenderer.act(async () => {
      jest.advanceTimersByTime(5_000);
      await signingOut;
    });
    expect(signOutSettled).toBe(true);
    expect(auth.warning).toBeUndefined();
  } finally {
    jest.useRealTimers();
  }
});

test('a hung cleanup-barrier publication retries cleanup before the next sign-in', async () => {
  mockEnvironment.connectAccountServer.mockImplementation(
    connectImplementation(),
  );
  await renderProvider();
  await ReactTestRenderer.act(async () => {
    await auth.signInWithPortico('viewer@example.com', 'correct password');
  });
  mockStorage.beginCredentialCleanup.mockReturnValueOnce(
    new Promise(() => undefined),
  );

  jest.useFakeTimers();
  try {
    let signingOut!: Promise<void>;
    await ReactTestRenderer.act(async () => {
      signingOut = auth.signOut();
      for (let attempt = 0; attempt < 20; attempt += 1) {
        await Promise.resolve();
      }
    });

    expect(auth.status).toBe('signed-out');
    expect(auth.session).toBeUndefined();
    expect(mockStorage.finishCredentialCleanup).not.toHaveBeenCalled();

    await ReactTestRenderer.act(async () => {
      jest.advanceTimersByTime(5_000);
      await signingOut;
    });
  } finally {
    jest.useRealTimers();
  }

  expect(
    mockStorage.deleteAllCredentialsRetainingCleanupBarrier,
  ).toHaveBeenCalled();
  expect(auth.warning).toBe('auth.sign-out-storage-warning');
  expect(viewerRuntime.getSnapshot().scope).toBeUndefined();

  mockEnvironment.hostedClient.createNativeSession.mockClear();
  mockStorage.retryPendingCredentialCleanup.mockResolvedValue(true);
  await ReactTestRenderer.act(async () => {
    await auth.signInWithPortico('viewer@example.com', 'correct password');
  });
  expect(
    mockEnvironment.hostedClient.createNativeSession,
  ).toHaveBeenCalledTimes(1);
  expect(auth.warning).toBeUndefined();
});

test('a hung predecessor and runtime teardown retain the restart barrier after deleting credentials', async () => {
  mockEnvironment.connectAccountServer.mockImplementation(
    connectImplementation(),
  );
  const renderer = await renderProvider();
  await ReactTestRenderer.act(async () => {
    await auth.signInWithPortico('viewer@example.com', 'correct password');
  });
  const neverSettles = new Promise<never>(() => undefined);
  mockEnvironment.connectAccountServer.mockImplementationOnce(
    () => neverSettles,
  );
  viewerRuntime.register('playback', () => neverSettles);
  const secondServer: HostedServer = {
    ...server,
    id: 'server-2',
    name: 'Cottage',
  };
  await ReactTestRenderer.act(async () => {
    auth.chooseServer(secondServer).catch(() => undefined);
    for (let attempt = 0; attempt < 10; attempt += 1) {
      await Promise.resolve();
    }
  });
  mockStorage.hostedCredentialStore.load.mockResolvedValue(accountSession);

  jest.useFakeTimers();
  try {
    let signingOut!: Promise<void>;
    await ReactTestRenderer.act(async () => {
      signingOut = auth.signOut();
      for (let attempt = 0; attempt < 20; attempt += 1) {
        await Promise.resolve();
      }
    });

    expect(auth.status).toBe('signed-out');
    expect(auth.session).toBeUndefined();
    expect(viewerRuntime.getSnapshot()).toEqual(
      expect.objectContaining({
        acceptingWrites: false,
        transitioning: true,
      }),
    );
    expect(mockStorage.finishCredentialCleanup).not.toHaveBeenCalled();
    expect(
      mockStorage.deleteAllCredentialsRetainingCleanupBarrier,
    ).not.toHaveBeenCalled();

    await ReactTestRenderer.act(async () => {
      jest.advanceTimersByTime(5_000);
      await signingOut;
    });
  } finally {
    jest.useRealTimers();
  }

  expect(
    mockStorage.deleteAllCredentialsRetainingCleanupBarrier,
  ).toHaveBeenCalledTimes(1);
  expect(mockInstallation.selectedServerStore.clear).toHaveBeenCalled();
  expect(mockStorage.finishCredentialCleanup).not.toHaveBeenCalled();
  expect(auth.status).toBe('signed-out');
  expect(auth.warning).toBe('auth.sign-out-storage-warning');
  expect(viewerRuntime.getSnapshot()).toEqual(
    expect.objectContaining({
      acceptingWrites: false,
      scope: undefined,
      transitionFailure: expect.objectContaining({
        name: 'SignOutTeardownDeadlineError',
      }),
    }),
  );

  mockEnvironment.hostedClient.createNativeSession.mockClear();
  mockStorage.retryPendingCredentialCleanup.mockResolvedValue(true);
  await ReactTestRenderer.act(async () => {
    await auth.signInWithPortico('viewer@example.com', 'correct password');
  });
  expect(
    mockEnvironment.hostedClient.createNativeSession,
  ).toHaveBeenCalledTimes(1);
  expect(auth.warning).toBeUndefined();

  await ReactTestRenderer.act(async () => renderer.unmount());
  viewerRuntime = new ViewerRuntimeCoordinator();
  mockStorage.retryPendingCredentialCleanup.mockResolvedValue(true);
  mockStorage.hostedCredentialStore.load.mockResolvedValue(accountSession);
  mockEnvironment.connectAccountServer.mockClear();
  await renderProvider();

  expect(auth.status).toBe('signed-out');
  expect(auth.account).toBeUndefined();
  expect(auth.session).toBeUndefined();
  expect(auth.warning).toBeUndefined();
  expect(mockEnvironment.connectAccountServer).not.toHaveBeenCalled();
  expect(viewerRuntime.getSnapshot().scope).toBeUndefined();
});

test('clears the authenticated UI and retries secure cleanup without exposing storage recovery', async () => {
  mockEnvironment.connectAccountServer.mockImplementation(
    connectImplementation(),
  );
  await renderProvider();
  await ReactTestRenderer.act(async () => {
    await auth.signInWithPortico('viewer@example.com', 'correct password');
  });
  mockStorage.hostedCredentialStore.load.mockResolvedValue(accountSession);
  mockStorage.finishCredentialCleanup.mockRejectedValueOnce(
    new Error('Keychain unavailable'),
  );

  await ReactTestRenderer.act(async () => {
    await auth.signOut();
  });

  expect(auth.status).toBe('signed-out');
  expect(auth.session).toBeUndefined();
  expect(auth.account).toBeUndefined();
  expect(auth.warning).toBe('auth.sign-out-storage-warning');

  mockEnvironment.hostedClient.createNativeSession.mockClear();
  mockStorage.retryPendingCredentialCleanup.mockResolvedValue(true);
  await ReactTestRenderer.act(async () => {
    await auth.signInWithPortico('viewer@example.com', 'correct password');
  });
  expect(
    mockEnvironment.hostedClient.createNativeSession,
  ).toHaveBeenCalledTimes(1);
  expect(auth.warning).toBeUndefined();
  expect(auth.status).toBe('authenticated');
});

test('a fresh provider refuses stale Keychain credentials after failed sign-out deletion', async () => {
  mockEnvironment.connectAccountServer.mockImplementation(
    connectSelectedServerImplementation(),
  );
  const renderer = await renderProvider();
  await ReactTestRenderer.act(async () => {
    await auth.signInWithPortico('viewer@example.com', 'correct password');
  });
  mockStorage.hostedCredentialStore.load.mockResolvedValue(accountSession);
  mockStorage.finishCredentialCleanup.mockRejectedValueOnce(
    new Error('Keychain retained a credential'),
  );
  await ReactTestRenderer.act(async () => {
    await auth.signOut();
  });
  expect(auth.warning).toBe('auth.sign-out-storage-warning');
  await ReactTestRenderer.act(async () => renderer.unmount());

  viewerRuntime = new ViewerRuntimeCoordinator();
  mockStorage.retryPendingCredentialCleanup.mockResolvedValue(true);
  mockEnvironment.connectAccountServer.mockClear();
  mockEnvironment.setServerSession.mockClear();
  await renderProvider();

  expect(auth.status).toBe('signed-out');
  expect(auth.account).toBeUndefined();
  expect(auth.session).toBeUndefined();
  expect(auth.warning).toBeUndefined();
  expect(mockEnvironment.connectAccountServer).not.toHaveBeenCalled();
  expect(mockEnvironment.setServerSession).not.toHaveBeenCalledWith(
    expect.objectContaining({accessToken: expect.any(String)}),
  );
  expect(viewerRuntime.getSnapshot().scope).toBeUndefined();
});

test('waits for viewer teardown before clearing credentials during sign-out', async () => {
  mockEnvironment.connectAccountServer.mockImplementation(
    connectImplementation(),
  );
  await renderProvider();
  await ReactTestRenderer.act(async () => {
    await auth.signInWithPortico('viewer@example.com', 'correct password');
  });
  mockStorage.hostedCredentialStore.load.mockResolvedValue(accountSession);
  mockStorage.finishCredentialCleanup.mockClear();
  const teardown = deferred();
  viewerRuntime.register('playback', () => teardown.promise);

  let signingOut!: Promise<void>;
  await ReactTestRenderer.act(async () => {
    signingOut = auth.signOut();
    await Promise.resolve();
  });
  expect(viewerRuntime.getSnapshot().acceptingWrites).toBe(false);
  expect(mockStorage.finishCredentialCleanup).not.toHaveBeenCalled();

  teardown.resolve();
  await ReactTestRenderer.act(async () => {
    await signingOut;
  });
  expect(mockStorage.finishCredentialCleanup).toHaveBeenCalledTimes(1);
  expect(auth.status).toBe('signed-out');
  expect(viewerRuntime.getSnapshot().scope).toBeUndefined();
});

test('still clears credentials and UI when viewer teardown fails closed', async () => {
  mockEnvironment.connectAccountServer.mockImplementation(
    connectImplementation(),
  );
  await renderProvider();
  await ReactTestRenderer.act(async () => {
    await auth.signInWithPortico('viewer@example.com', 'correct password');
  });
  mockStorage.hostedCredentialStore.load.mockResolvedValue(accountSession);
  mockStorage.finishCredentialCleanup.mockClear();
  viewerRuntime.register('playback', () => {
    throw new Error('player did not stop');
  });

  await ReactTestRenderer.act(async () => {
    await auth.signOut();
  });

  expect(mockStorage.finishCredentialCleanup).toHaveBeenCalledTimes(1);
  expect(auth.status).toBe('signed-out');
  expect(auth.session).toBeUndefined();
  expect(viewerRuntime.getSnapshot().acceptingWrites).toBe(false);
  expect(viewerRuntime.getSnapshot().transitionFailure).toBeInstanceOf(Error);
  expect(viewerRuntime.getSnapshot().scope).toBeUndefined();
});

test('clears a terminally rejected Hosted refresh credential during restore', async () => {
  mockStorage.hostedCredentialStore.load.mockResolvedValue({
    ...accountSession,
    accessExpiresAt: '2000-01-01T00:00:00.000Z',
  });
  mockEnvironment.hostedClient.refreshNativeSession.mockRejectedValue(
    new ApiError(401, 'invalid_refresh_token', 'Session expired.'),
  );

  await renderProvider();

  expect(mockStorage.hostedCredentialStore.clear).toHaveBeenCalledTimes(1);
  expect(auth.status).toBe('signed-out');
  expect(auth.error).toBe(
    'Your session has expired. Sign in again to continue.',
  );
});

test('keeps the newly rotated Hosted family in memory when secure persistence retries fail', async () => {
  const expired = {
    ...accountSession,
    accessExpiresAt: '2000-01-01T00:00:00.000Z',
  };
  const rotated = {
    ...accountSession,
    accessToken: 'rotated-hosted-access',
    refreshToken: 'rotated-hosted-refresh',
  };
  durableHostedCredential = expired;
  mockEnvironment.hostedClient.refreshNativeSession.mockResolvedValue(rotated);
  mockStorage.hostedCredentialStore.save.mockRejectedValue(
    new Error('Keychain temporarily unavailable'),
  );
  mockEnvironment.connectAccountServer.mockImplementation(
    connectImplementation(),
  );

  await renderProvider();

  expect(mockStorage.hostedCredentialStore.save).toHaveBeenCalledTimes(3);
  expect(mockEnvironment.setHostedAccessToken).toHaveBeenCalledWith(
    'rotated-hosted-access',
  );
  expect(mockEnvironment.setHostedAccessToken).not.toHaveBeenCalledWith(
    accountSession.accessToken,
  );
  expect(auth.account?.id).toBe(accountSession.user.id);
  expect(auth.status).toBe('authenticated');
  expect(durableHostedRefreshRotation).toEqual(
    expect.objectContaining({oldRefreshToken: expired.refreshToken}),
  );
});

test('replays the exact refresh rotation after a crash before successor persistence', async () => {
  const expired = {
    ...accountSession,
    accessExpiresAt: '2000-01-01T00:00:00.000Z',
  };
  durableHostedCredential = expired;
  durableHostedRefreshRotation = {
    authority: 'hosted',
    createdAt: '2026-07-18T00:00:00.000Z',
    oldRefreshToken: expired.refreshToken,
    rotationKey: 'a'.repeat(64),
    version: 'v1',
  };
  mockEnvironment.hostedClient.refreshNativeSession.mockResolvedValue({
    ...accountSession,
    accessToken: 'recovered-access',
    refreshToken: 'recovered-refresh',
  });
  mockEnvironment.connectAccountServer.mockImplementation(
    connectImplementation(),
  );

  await renderProvider();

  expect(mockEnvironment.hostedClient.refreshNativeSession).toHaveBeenCalledWith(
    {
      refreshToken: expired.refreshToken,
      rotationKey: 'a'.repeat(64),
      installationId: 'installation-1',
    },
  );
  expect(durableHostedCredential?.refreshToken).toBe('recovered-refresh');
  expect(durableHostedRefreshRotation).toBeUndefined();
});

test('never clears the recovery key when memory has the successor but Keychain still has the consumed token', async () => {
  const expired = {
    ...accountSession,
    accessExpiresAt: '2000-01-01T00:00:00.000Z',
  };
  const successor = {
    ...accountSession,
    accessToken: 'crash-safe-access',
    refreshToken: 'crash-safe-refresh',
  };
  durableHostedCredential = expired;
  mockEnvironment.hostedClient.refreshNativeSession.mockResolvedValue(
    successor,
  );
  mockStorage.hostedCredentialStore.save.mockRejectedValue(
    new Error('Keychain temporarily unavailable'),
  );
  const controller = new AbortController();
  const operation = {
    controller,
    generation: 1,
    previous: Promise.resolve(),
    signal: controller.signal,
  };
  const state = {controller, generation: 1};

  const first = await __authRecoveryTestHooks.currentHostedSession(
    expired,
    operation,
    state,
  );
  const firstRotationKey = durableHostedRefreshRotation?.rotationKey;
  expect(first).toEqual(successor);
  expect(firstRotationKey).toMatch(/^[a-f0-9]{64}$/);

  const second = await __authRecoveryTestHooks.currentHostedSession(
    successor,
    operation,
    state,
  );
  expect(second).toEqual(successor);
  expect(durableHostedRefreshRotation?.rotationKey).toBe(firstRotationKey);
  expect(mockEnvironment.hostedClient.refreshNativeSession).toHaveBeenNthCalledWith(
    2,
    expect.objectContaining({
      refreshToken: expired.refreshToken,
      rotationKey: firstRotationKey,
    }),
  );

  // Simulate process death: only the durable old family and its journal
  // survive. Exact replay recovers and commits the same successor.
  mockStorage.hostedCredentialStore.save.mockImplementation(
    async session => {
      durableHostedCredential = session;
    },
  );
  const recovered = await __authRecoveryTestHooks.currentHostedSession(
    expired,
    operation,
    state,
  );
  expect(recovered).toEqual(successor);
  expect(durableHostedCredential).toEqual(successor);
  expect(durableHostedRefreshRotation).toBeUndefined();
  expect(mockEnvironment.hostedClient.refreshNativeSession).toHaveBeenNthCalledWith(
    3,
    expect.objectContaining({
      refreshToken: expired.refreshToken,
      rotationKey: firstRotationKey,
    }),
  );
});

test('clears a stale refresh journal after the successor is already durable', async () => {
  durableHostedCredential = accountSession;
  durableHostedRefreshRotation = {
    authority: 'hosted',
    createdAt: '2026-07-18T00:00:00.000Z',
    oldRefreshToken: 'consumed-refresh',
    rotationKey: 'b'.repeat(64),
    version: 'v1',
  };
  mockEnvironment.connectAccountServer.mockImplementation(
    connectImplementation(),
  );

  await renderProvider();

  expect(mockEnvironment.hostedClient.refreshNativeSession).not.toHaveBeenCalled();
  expect(durableHostedRefreshRotation).toBeUndefined();
});

test('an expired access token and transient refresh outage does not run directory calls or false-expire the account', async () => {
  durableHostedCredential = {
    ...accountSession,
    accessExpiresAt: '2000-01-01T00:00:00.000Z',
  };
  mockEnvironment.hostedClient.refreshNativeSession.mockRejectedValue(
    new TypeError('Hosted Services temporarily unreachable'),
  );

  await renderProvider();

  expect(auth.account?.id).toBe(accountSession.user.id);
  expect(auth.status).toBe('server-unavailable');
  expect(auth.issue).toEqual(
    expect.objectContaining({phase: 'cloud-directory'}),
  );
  expect(mockEnvironment.hostedClient.servers).not.toHaveBeenCalled();
  expect(mockEnvironment.hostedClient.profiles).not.toHaveBeenCalled();
  expect(auth.error ?? '').not.toContain('expired');
});

test('ordinary aggregate route failures never become account-erasing security failures', () => {
  const routeFailure = new AggregateError(
    [new TypeError('public route unavailable'), new TypeError('LAN route unavailable')],
    'No server route was reachable',
  );
  expect(
    __authRecoveryTestHooks.isSecurityCriticalAuthFailure(routeFailure),
  ).toBe(false);
});

test('an aggregate containing explicit credential cleanup uncertainty remains fail-closed', () => {
  const cleanupFailure = new CredentialCleanupUncertainError(
    'Local secure cleanup could not be verified.',
    new Error('Credential publication failed.'),
    [new Error('Rollback failed.')],
  );
  expect(
    __authRecoveryTestHooks.isSecurityCriticalAuthFailure(
      new AggregateError([new TypeError('network failed'), cleanupFailure]),
    ),
  ).toBe(true);
});

test('a remote API cannot impersonate local credential cleanup uncertainty', () => {
  const remoteFailure = new ApiError(
    500,
    'credential_cleanup_uncertain',
    'Remote response must not control device credential cleanup.',
  );
  expect(
    __authRecoveryTestHooks.isSecurityCriticalAuthFailure(remoteFailure),
  ).toBe(false);
});
