const mockKeychainState = new Map<
  string,
  {password: string; service: string; storage: string; username: string}
>();
let mockRejectedWriteService: string | undefined;

jest.mock('react-native-get-random-values', () => ({}));

jest.mock('react-native-keychain', () => {
  const api = {
    ACCESSIBLE: {
      AFTER_FIRST_UNLOCK_THIS_DEVICE_ONLY:
        'after-first-unlock-this-device-only',
    },
    getGenericPassword: jest.fn(
      async ({service}: {service: string}) =>
        mockKeychainState.get(service) ?? false,
    ),
    resetGenericPassword: jest.fn(async ({service}: {service: string}) =>
      mockKeychainState.delete(service),
    ),
    setGenericPassword: jest.fn(
      async (
        username: string,
        password: string,
        {service}: {service: string},
      ) => {
        if (service === mockRejectedWriteService) return false;
        mockKeychainState.set(service, {
          password,
          service,
          storage: 'keychain',
          username,
        });
        return true;
      },
    ),
  };
  return {__esModule: true, ...api, default: api};
});

import {
  clientMetadataId,
  installationId,
  optionalInstallationId,
  profileSelectionStore,
} from './installation';

const INSTALLATION_SERVICE = 'tv.getportico.installation-id.v1';
const PROFILE_SELECTION_SERVICE = 'tv.getportico.profile-selection.v1';

beforeEach(() => {
  jest.clearAllMocks();
  mockKeychainState.clear();
  mockRejectedWriteService = undefined;
});

test('installation identity rejects an uncommitted Keychain write and remains retryable', async () => {
  mockRejectedWriteService = INSTALLATION_SERVICE;
  await expect(installationId()).rejects.toThrow(
    'Keychain refused to save the installation identity.',
  );
  expect(mockKeychainState.has(INSTALLATION_SERVICE)).toBe(false);

  mockRejectedWriteService = undefined;
  const persisted = await installationId();
  expect(persisted).toEqual(expect.any(String));
  expect(mockKeychainState.get(INSTALLATION_SERVICE)?.password).toBe(persisted);
});

test('installation identity rejects a malformed saved identity', async () => {
  mockKeychainState.set(INSTALLATION_SERVICE, {
    password: '',
    service: INSTALLATION_SERVICE,
    storage: 'keychain',
    username: 'unexpected-owner',
  });

  await expect(installationId()).rejects.toThrow(
    'Portico could not verify the saved installation identity.',
  );
});

test('optional installation metadata never blocks authentication when Keychain is unavailable', async () => {
  mockRejectedWriteService = INSTALLATION_SERVICE;

  await expect(optionalInstallationId()).resolves.toBeUndefined();
});

test('client metadata falls back to a stable process-local opaque ID', async () => {
  mockRejectedWriteService = INSTALLATION_SERVICE;

  const first = await clientMetadataId();
  const second = await clientMetadataId();

  expect(first).toMatch(/^[0-9a-f-]{36}$/);
  expect(second).toBe(first);
});

test('profile preferences are isolated by authority, account, server, and installation', async () => {
  const hosted = {
    authority: 'hosted' as const,
    accountId: 'account-1',
    serverId: 'server-1',
    installationId: 'installation-1',
    profileId: 'hosted-profile',
  };
  const local = {
    ...hosted,
    authority: 'local' as const,
    profileId: 'local-profile',
  };
  const otherInstallation = {
    ...hosted,
    installationId: 'installation-2',
    profileId: 'other-installation-profile',
  };

  await profileSelectionStore.recordVerifiedSelection(hosted, 'mobile');
  await profileSelectionStore.recordVerifiedSelection(local, 'mobile');
  await profileSelectionStore.recordVerifiedSelection(
    otherInstallation,
    'mobile',
  );

  await expect(profileSelectionStore.get(hosted, 'mobile')).resolves.toEqual(
    expect.objectContaining({
      lastProfileId: 'hosted-profile',
      profileSelection: 'ask',
    }),
  );
  await expect(profileSelectionStore.get(local, 'mobile')).resolves.toEqual(
    expect.objectContaining({
      lastProfileId: 'local-profile',
      profileSelection: 'ask',
    }),
  );
  await expect(
    profileSelectionStore.get(otherInstallation, 'mobile'),
  ).resolves.toEqual(
    expect.objectContaining({lastProfileId: 'other-installation-profile'}),
  );
});

test('unseen mobile and TV exact scopes ask until that exact namespace records a choice', async () => {
  const scope = {
    authority: 'hosted' as const,
    accountId: 'account-1',
    serverId: 'server-1',
    installationId: 'installation-1',
  };

  await expect(profileSelectionStore.get(scope, 'mobile')).resolves.toEqual({
    rememberAccount: true,
    profileSelection: 'ask',
  });
  await expect(profileSelectionStore.get(scope, 'tv')).resolves.toEqual({
    rememberAccount: true,
    profileSelection: 'ask',
  });
});

test('an unscoped legacy profile cannot participate in preselection', async () => {
  const legacyKey = `account-1\u0000server-1`;
  mockKeychainState.set(PROFILE_SELECTION_SERVICE, {
    password: JSON.stringify({
      [legacyKey]: {
        rememberAccount: false,
        profileSelection: 'last-used',
        lastProfileId: 'locked-legacy-profile',
      },
    }),
    service: PROFILE_SELECTION_SERVICE,
    storage: 'keychain',
    username: 'portico',
  });
  const scope = {
    authority: 'hosted' as const,
    accountId: 'account-1',
    serverId: 'server-1',
    installationId: 'installation-1',
  };

  await expect(profileSelectionStore.get(scope, 'mobile')).resolves.toEqual({
    rememberAccount: true,
    profileSelection: 'ask',
  });

  await profileSelectionStore.recordVerifiedSelection(
    {...scope, profileId: 'verified-profile'},
    'mobile',
  );
  await expect(profileSelectionStore.get(scope, 'mobile')).resolves.toEqual({
    rememberAccount: true,
    profileSelection: 'ask',
    lastProfileId: 'verified-profile',
  });
});

test('legacy automatic-selection trust never migrates after a matching profile is verified', async () => {
  const legacyKey = `account-1\u0000server-1`;
  mockKeychainState.set(PROFILE_SELECTION_SERVICE, {
    password: JSON.stringify({
      [legacyKey]: {
        rememberAccount: false,
        profileSelection: 'last-used',
        lastProfileId: 'verified-profile',
      },
    }),
    service: PROFILE_SELECTION_SERVICE,
    storage: 'keychain',
    username: 'portico',
  });
  const scope = {
    authority: 'local' as const,
    accountId: 'account-1',
    serverId: 'server-1',
    installationId: 'installation-1',
    profileId: 'verified-profile',
  };

  await profileSelectionStore.recordVerifiedSelection(scope, 'mobile');
  await expect(profileSelectionStore.get(scope, 'mobile')).resolves.toEqual({
    rememberAccount: true,
    profileSelection: 'ask',
    lastProfileId: 'verified-profile',
  });
});

test('same account, server, profile, and installation IDs cannot carry automatic trust across authorities', async () => {
  const legacyKey = `shared-account\u0000shared-server`;
  mockKeychainState.set(PROFILE_SELECTION_SERVICE, {
    password: JSON.stringify({
      [legacyKey]: {
        rememberAccount: true,
        profileSelection: 'last-used',
        lastProfileId: 'shared-profile',
      },
    }),
    service: PROFILE_SELECTION_SERVICE,
    storage: 'keychain',
    username: 'portico',
  });
  const common = {
    accountId: 'shared-account',
    serverId: 'shared-server',
    installationId: 'shared-installation',
    profileId: 'shared-profile',
  };

  await profileSelectionStore.recordVerifiedSelection(
    {...common, authority: 'local'},
    'mobile',
  );
  await expect(
    profileSelectionStore.get({...common, authority: 'hosted'}, 'mobile'),
  ).resolves.toEqual({
    rememberAccount: true,
    profileSelection: 'ask',
  });

  await profileSelectionStore.recordVerifiedSelection(
    {...common, authority: 'hosted'},
    'mobile',
  );
  await expect(
    profileSelectionStore.get({...common, authority: 'local'}, 'mobile'),
  ).resolves.toEqual({
    rememberAccount: true,
    profileSelection: 'ask',
    lastProfileId: 'shared-profile',
  });
  await expect(
    profileSelectionStore.get({...common, authority: 'hosted'}, 'mobile'),
  ).resolves.toEqual({
    rememberAccount: true,
    profileSelection: 'ask',
    lastProfileId: 'shared-profile',
  });
});

test('a rejected profile preference write does not poison later verified selections', async () => {
  const scope = {
    authority: 'hosted' as const,
    accountId: 'account-1',
    serverId: 'server-1',
    installationId: 'installation-1',
  };
  mockRejectedWriteService = PROFILE_SELECTION_SERVICE;
  await expect(
    profileSelectionStore.recordVerifiedSelection(
      {...scope, profileId: 'profile-a'},
      'tv',
    ),
  ).rejects.toThrow('Keychain refused to save the profile preference.');

  mockRejectedWriteService = undefined;
  await profileSelectionStore.recordVerifiedSelection(
    {...scope, profileId: 'profile-b'},
    'tv',
  );
  await expect(profileSelectionStore.get(scope, 'tv')).resolves.toEqual({
    rememberAccount: true,
    profileSelection: 'ask',
    lastProfileId: 'profile-b',
  });
});

test('serialized verified selections are monotonic latest-write-wins', async () => {
  const scope = {
    authority: 'local' as const,
    accountId: 'account-1',
    serverId: 'server-1',
    installationId: 'installation-1',
  };
  const first = profileSelectionStore.recordVerifiedSelection(
    {...scope, profileId: 'profile-a'},
    'mobile',
  );
  const second = profileSelectionStore.recordVerifiedSelection(
    {...scope, profileId: 'profile-b'},
    'mobile',
  );

  await Promise.all([first, second]);
  await expect(profileSelectionStore.get(scope, 'mobile')).resolves.toEqual(
    expect.objectContaining({lastProfileId: 'profile-b'}),
  );
});
