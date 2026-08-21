import {
  defaultAccountServerInstallationPreferences,
  defaultProfileDeviceClassPreferences,
  defaultProfileServerPreferences,
  type PreferenceScopeIdentity,
  type ServerViewerPreferenceBundle,
} from '@porticomediaserver/client-core';
import {
  createScopedAppleViewerPreferencesStore,
  parseScopedApplePreferenceBundle,
  synchronizeActiveProfileLaunchPreference,
  type ApplePreferenceScopeIdentity,
} from './viewerPreferences';

const identity = (
  changes: Partial<PreferenceScopeIdentity> = {},
): ApplePreferenceScopeIdentity => ({
  authority: 'hosted',
  accountId: 'account-a',
  serverId: 'server-a',
  profileId: 'profile-a',
  deviceClass: 'mobile',
  installationId: 'install-a',
  ...changes,
} as ApplePreferenceScopeIdentity);

const bundle = (
  scope = identity(),
  revisions = {profile: 0, device: 0, installation: 0},
): ServerViewerPreferenceBundle => {
  const device = defaultProfileDeviceClassPreferences(scope.deviceClass);
  return {
    identity: scope,
    profileServer: {
      version: 'v1',
      revision: revisions.profile,
      values: defaultProfileServerPreferences as ServerViewerPreferenceBundle['profileServer']['values'],
    },
    profileDeviceClass: {
      version: 'v1',
      revision: revisions.device,
      values: device as ServerViewerPreferenceBundle['profileDeviceClass']['values'],
    },
    effectiveProfileDeviceClass: {
      version: 'v1',
      revision: revisions.device,
      values: device as ServerViewerPreferenceBundle['effectiveProfileDeviceClass']['values'],
    },
    accountServerInstallation: {
      version: 'v1',
      revision: revisions.installation,
      values: defaultAccountServerInstallationPreferences(scope.deviceClass),
    },
    clampedFields: [],
    policy: {
      cellularQualityAllowed: true,
      downloadsAllowed: true,
      feedbackAllowed: true,
    },
  };
};

function deferred<T>() {
  let resolve!: (value: T | PromiseLike<T>) => void;
  const promise = new Promise<T>(resolvePromise => {
    resolve = resolvePromise;
  });
  return {promise, resolve};
}

describe('scoped Apple viewer preferences', () => {
  test('keeps read freshness separate from mutation state and errors', async () => {
    const store = createScopedAppleViewerPreferencesStore({
      client: {
        viewerPreferenceBundle: jest.fn().mockResolvedValue(bundle()),
        patchViewerPreferenceDocument: jest.fn().mockRejectedValue(new Error('save failed')),
      },
      identity: identity(),
      accountInstallationCache: {set: jest.fn()},
    });
    expect(store.getSnapshot()).toMatchObject({readStatus: 'loading', mutationStatus: 'idle'});
    await store.load();
    expect(store.getSnapshot()).toMatchObject({readStatus: 'ready', mutationStatus: 'idle'});
    await expect(store.update({autoplayNext: false})).rejects.toThrow('save failed');
    expect(store.getSnapshot()).toMatchObject({readStatus: 'ready', mutationStatus: 'error', mutationError: expect.any(Error)});
  });
  test('rejects authority, account, profile, server, device-class, and installation scope drift', () => {
    const expected = identity();
    for (const wrong of [
      identity({authority: 'local'}),
      identity({accountId: 'account-b'}),
      identity({profileId: 'profile-b'}),
      identity({serverId: 'server-b'}),
      identity({deviceClass: 'television'}),
      identity({installationId: 'install-b'}),
    ]) {
      expect(() => parseScopedApplePreferenceBundle(bundle(wrong), expected)).toThrow(
        /different/,
      );
    }
  });

  test('requests the exact mobile or TV scope and keeps their cache keys isolated', async () => {
    for (const scope of [identity(), identity({deviceClass: 'television'})]) {
      const viewerPreferenceBundle = jest.fn().mockResolvedValue(bundle(scope));
      const cache = {set: jest.fn().mockResolvedValue(undefined)};
      const store = createScopedAppleViewerPreferencesStore({
        client: {
          viewerPreferenceBundle,
          patchViewerPreferenceDocument: jest.fn(),
        },
        identity: scope,
        accountInstallationCache: cache,
      });
      await store.load();
      expect(viewerPreferenceBundle).toHaveBeenCalledWith({
        deviceClass: scope.deviceClass,
        installationId: scope.installationId,
      }, undefined);
      expect(cache.set).toHaveBeenCalledWith(
        scope,
        expect.objectContaining({
          profileSelection:
            scope.deviceClass === 'television' ? 'ask' : 'last-used',
        }),
      );
    }
  });

  test('saves Home order and visibility in the profile-server document', async () => {
    const initial = bundle(identity(), {profile: 4, device: 1, installation: 1});
    const refreshed: ServerViewerPreferenceBundle = {
      ...initial,
      profileServer: {
        ...initial.profileServer,
        revision: 5,
        values: {...initial.profileServer.values, home: {rowOrder: ['continue', 'recent'], hiddenRowIds: ['suggested']}},
      },
    };
    const patchViewerPreferenceDocument = jest.fn().mockResolvedValue({});
    const store = createScopedAppleViewerPreferencesStore({
      client: {viewerPreferenceBundle: jest.fn().mockResolvedValueOnce(initial).mockResolvedValue(refreshed), patchViewerPreferenceDocument},
      identity: identity(),
      accountInstallationCache: {set: jest.fn()},
    });
    await store.load();
    await store.update({homeRowOrder: ['continue', 'recent'], hiddenHomeRowIds: ['suggested']});
    expect(patchViewerPreferenceDocument).toHaveBeenCalledWith(
      'profile-server',
      expect.any(Object),
      expect.objectContaining({expectedRevision: 4, changes: {home: {rowOrder: ['continue', 'recent'], hiddenRowIds: ['suggested']}}}),
    );
  });

  test('projects and persists intro and credits skip policy in the profile-server document', async () => {
    const initial = bundle(identity(), {profile: 8, device: 1, installation: 1});
    const refreshed: ServerViewerPreferenceBundle = {
      ...initial,
      profileServer: {
        ...initial.profileServer,
        revision: 9,
        values: {
          ...initial.profileServer.values,
          playback: {
            ...initial.profileServer.values.playback,
            introSkip: 'automatic',
            creditsSkip: 'off',
          },
        },
      },
    };
    const patchViewerPreferenceDocument = jest.fn().mockResolvedValue({});
    const store = createScopedAppleViewerPreferencesStore({
      client: {
        viewerPreferenceBundle: jest
          .fn()
          .mockResolvedValueOnce(initial)
          .mockResolvedValue(refreshed),
        patchViewerPreferenceDocument,
      },
      identity: identity(),
      accountInstallationCache: {set: jest.fn()},
    });

    await store.load();
    await store.update({introSkip: 'automatic', creditsSkip: 'off'});

    expect(patchViewerPreferenceDocument).toHaveBeenCalledWith(
      'profile-server',
      expect.any(Object),
      expect.objectContaining({
        expectedRevision: 8,
        changes: {
          playback: {introSkip: 'automatic', creditsSkip: 'off'},
        },
      }),
    );
    expect(store.getSnapshot().values).toEqual(
      expect.objectContaining({introSkip: 'automatic', creditsSkip: 'off'}),
    );
  });

  test('projects effective playback delivery and per-network quality while retaining policy metadata', async () => {
    const raw = bundle(identity(), {profile: 1, device: 3, installation: 1});
    raw.profileDeviceClass.values.playback = {
      ...raw.profileDeviceClass.values.playback,
      quality: {
        ...raw.profileDeviceClass.values.playback.quality,
        local: {mode: 'original'},
        wifi: {mode: 'high'},
        cellular: {mode: 'standard'},
      },
      deliveryRequest: {
        directPlay: 'prefer',
        directStream: 'allow',
        transcode: 'allow',
      },
    };
    raw.effectiveProfileDeviceClass = {
      ...raw.effectiveProfileDeviceClass,
      values: {
        ...raw.effectiveProfileDeviceClass.values,
        playback: {
          ...raw.effectiveProfileDeviceClass.values.playback,
          quality: {
            ...raw.effectiveProfileDeviceClass.values.playback.quality,
            local: {mode: 'original'},
            wifi: {mode: 'standard'},
            cellular: {mode: 'off'},
          },
          deliveryRequest: {
            directPlay: 'allow',
            directStream: 'prefer',
            transcode: 'allow',
          },
        },
      },
    };
    raw.policy = {...raw.policy, cellularQualityAllowed: false};
    raw.clampedFields = [
      'profileDeviceClass.playback.quality.cellular',
      'profileDeviceClass.playback.quality.wifi',
    ];

    const documents = parseScopedApplePreferenceBundle(raw, identity());
    const store = createScopedAppleViewerPreferencesStore({
      client: {
        viewerPreferenceBundle: jest.fn().mockResolvedValue(raw),
        patchViewerPreferenceDocument: jest.fn(),
      },
      identity: identity(),
      accountInstallationCache: {set: jest.fn()},
    });
    await store.load();

    expect(documents.policy.cellularQualityAllowed).toBe(false);
    expect(documents.clampedFields).toEqual(raw.clampedFields);
    expect(store.getSnapshot().values).toEqual(expect.objectContaining({
      localQualityMode: 'original',
      wifiQualityMode: 'standard',
      cellularQualityMode: 'off',
      allowCellularStreaming: false,
      directPlay: 'allow',
      directStream: 'prefer',
      transcode: 'allow',
    }));
  });

  test('persists quality and delivery requests in the profile-device-class document', async () => {
    const initial = bundle(identity(), {profile: 1, device: 6, installation: 1});
    const refreshed = bundle(identity(), {profile: 1, device: 7, installation: 1});
    refreshed.profileDeviceClass.values.playback = {
      ...refreshed.profileDeviceClass.values.playback,
      quality: {
        ...refreshed.profileDeviceClass.values.playback.quality,
        local: {mode: 'automatic'},
        wifi: {mode: 'high'},
        cellular: {mode: 'off'},
        unknown: {mode: 'standard'},
      },
      deliveryRequest: {
        directPlay: 'never',
        directStream: 'never',
        transcode: 'require',
      },
    };
    refreshed.effectiveProfileDeviceClass = refreshed.profileDeviceClass;
    const patchViewerPreferenceDocument = jest.fn().mockResolvedValue({});
    const store = createScopedAppleViewerPreferencesStore({
      client: {
        viewerPreferenceBundle: jest.fn().mockResolvedValueOnce(initial).mockResolvedValue(refreshed),
        patchViewerPreferenceDocument,
      },
      identity: identity(),
      accountInstallationCache: {set: jest.fn()},
    });
    await store.load();
    await store.update({
      localQualityMode: 'automatic',
      wifiQualityMode: 'high',
      cellularQualityMode: 'off',
      unknownQualityMode: 'standard',
      directPlay: 'never',
      directStream: 'never',
      transcode: 'require',
    });

    expect(patchViewerPreferenceDocument).toHaveBeenCalledWith(
      'profile-device-class',
      expect.any(Object),
      expect.objectContaining({
        expectedRevision: 6,
        changes: {
          playback: {
            quality: {
              local: {mode: 'automatic'},
              wifi: {mode: 'high'},
              cellular: {mode: 'off'},
              unknown: {mode: 'standard'},
            },
            deliveryRequest: {
              directPlay: 'never',
              directStream: 'never',
              transcode: 'require',
            },
          },
        },
      }),
    );
    expect(store.getSnapshot().values).toEqual(expect.objectContaining({
      localQualityMode: 'automatic',
      wifiQualityMode: 'high',
      cellularQualityMode: 'off',
      unknownQualityMode: 'standard',
      directPlay: 'never',
      directStream: 'never',
      transcode: 'require',
    }));
  });

  test('records authoritative activation before caching and never patches lastProfileId', async () => {
    const scope = identity();
    const order: string[] = [];
    const cache = {set: jest.fn().mockResolvedValue(undefined)};
    cache.set.mockImplementation(async () => {
      order.push('cache');
    });
    const patchViewerPreferenceDocument = jest.fn();
    const client = {
      viewerPreferenceBundle: jest.fn().mockResolvedValue(bundle(scope)),
      patchViewerPreferenceDocument,
      recordViewerProfileActivation: jest.fn().mockImplementation(async () => {
        order.push('activation');
        return {
          version: 'v1',
          revision: 1,
          values: {
            ...defaultAccountServerInstallationPreferences('mobile'),
            lastProfileId: scope.profileId,
          },
        };
      }),
    };
    await synchronizeActiveProfileLaunchPreference(client, scope, cache);
    expect(order).toEqual(['activation', 'cache']);
    expect(patchViewerPreferenceDocument).not.toHaveBeenCalled();
    expect(client.recordViewerProfileActivation).toHaveBeenCalledWith(
      {version: 'v1', expectedRevision: 0},
      undefined,
    );
    expect(cache.set).toHaveBeenLastCalledWith(
      scope,
      expect.objectContaining({lastProfileId: scope.profileId}),
    );
  });

  test('does not cache or hide an authoritative activation failure', async () => {
    const scope = identity();
    const cache = {set: jest.fn()};
    const client = {
      viewerPreferenceBundle: jest.fn().mockResolvedValue(bundle(scope)),
      patchViewerPreferenceDocument: jest.fn(),
      recordViewerProfileActivation: jest
        .fn()
        .mockRejectedValue(new Error('activation contract rejected')),
    };
    await expect(
      synchronizeActiveProfileLaunchPreference(client, scope, cache),
    ).rejects.toThrow('activation contract rejected');
    expect(cache.set).not.toHaveBeenCalled();
  });

  test('generation fencing prevents a stale activation request or cache commit', async () => {
    const scope = identity();
    const bundleResult = deferred<ServerViewerPreferenceBundle>();
    let current = true;
    const cache = {set: jest.fn()};
    const client = {
      viewerPreferenceBundle: jest.fn().mockReturnValue(bundleResult.promise),
      patchViewerPreferenceDocument: jest.fn(),
      recordViewerProfileActivation: jest.fn(),
    };
    const operation = synchronizeActiveProfileLaunchPreference(
      client,
      scope,
      cache,
      {isCurrent: () => current},
    );
    current = false;
    bundleResult.resolve(bundle(scope));
    await expect(operation).rejects.toThrow();
    expect(client.recordViewerProfileActivation).not.toHaveBeenCalled();
    expect(cache.set).not.toHaveBeenCalled();

    current = true;
    const activationResult = deferred<{
      version: 'v1';
      revision: number;
      values: ReturnType<typeof defaultAccountServerInstallationPreferences>;
    }>();
    client.viewerPreferenceBundle.mockResolvedValue(bundle(scope));
    client.recordViewerProfileActivation.mockReturnValue(
      activationResult.promise,
    );
    const afterActivation = synchronizeActiveProfileLaunchPreference(
      client,
      scope,
      cache,
      {isCurrent: () => current},
    );
    await Promise.resolve();
    current = false;
    activationResult.resolve({
      version: 'v1',
      revision: 1,
      values: {
        ...defaultAccountServerInstallationPreferences('mobile'),
        lastProfileId: scope.profileId,
      },
    });
    await expect(afterActivation).rejects.toThrow();
    expect(cache.set).not.toHaveBeenCalled();
  });
});
