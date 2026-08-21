import React, {
  createContext,
  useContext,
  useEffect,
  useMemo,
  useState,
} from 'react';
import {
  defaultProfileDeviceClassPreferences,
  defaultProfileServerPreferences,
  normalizeAccountServerInstallationPreferences,
  normalizeProfileDeviceClassPreferences,
  normalizeProfileServerPreferences,
  parsePreferenceDocument,
  preferenceStorageKeys,
  type AccountServerInstallationPreferences,
  type DeepPartial,
  type DeliveryModePreference,
  type PorticoClient,
  type PreferenceDocument,
  type PreferenceScopeIdentity,
  type ProfileDeviceClassPreferences,
  type ProfileServerPreferences,
  type QualityRequestMode,
  type ServerViewerPreferenceBundle,
  type TranscodePreference,
} from '@portico/client-core';
import {usePorticoAuth} from './auth';
import {installationId, profileSelectionStore} from './installation';
import {ProductMessageError} from './productErrors';
import {
  type PreferredLanguage,
  type PreferredSubtitleLanguage,
  type SeekIntervalSeconds,
} from './preferences';
import type {PorticoPlatform} from './types';

export interface AppleViewerPreferences {
  autoplayNext: boolean;
  upNextCountdownSeconds: 0 | 5 | 10 | 15;
  passoutProtection: boolean;
  passoutAfterEpisodes: 2 | 3 | 4 | 5;
  introSkip: 'ask' | 'automatic' | 'off';
  creditsSkip: 'ask' | 'automatic' | 'off';
  seekIntervalSeconds: SeekIntervalSeconds;
  preferredAudioLanguage: PreferredLanguage;
  preferredSubtitleLanguage: PreferredSubtitleLanguage;
  allowCellularStreaming: boolean;
  localQualityMode: QualityRequestMode;
  wifiQualityMode: QualityRequestMode;
  cellularQualityMode: QualityRequestMode;
  unknownQualityMode: QualityRequestMode;
  directPlay: DeliveryModePreference;
  directStream: DeliveryModePreference;
  transcode: TranscodePreference;
  downloadDeleteWatched: boolean;
  homeRowOrder?: string[];
  hiddenHomeRowIds?: string[];
}

export type AppleViewerPreferenceUpdate = Partial<AppleViewerPreferences>;

export type ApplePreferenceScopeIdentity = Omit<
  PreferenceScopeIdentity,
  'deviceClass'
> & {deviceClass: 'mobile' | 'television'};

export interface ScopedApplePreferenceDocuments {
  identity: ApplePreferenceScopeIdentity;
  profileServer: PreferenceDocument<ProfileServerPreferences>;
  profileDeviceClass: PreferenceDocument<ProfileDeviceClassPreferences>;
  effectiveProfileDeviceClass: PreferenceDocument<ProfileDeviceClassPreferences>;
  accountServerInstallation: PreferenceDocument<AccountServerInstallationPreferences>;
  policy: ServerViewerPreferenceBundle['policy'];
  clampedFields: readonly string[];
}

export interface AppleViewerPreferenceSnapshot {
  readStatus: 'loading' | 'ready' | 'error';
  mutationStatus: 'idle' | 'saving' | 'error';
  values: AppleViewerPreferences;
  documents?: ScopedApplePreferenceDocuments;
  readError?: Error;
  mutationError?: Error;
}

type ViewerPreferenceClient = Pick<
  PorticoClient,
  'viewerPreferenceBundle' | 'patchViewerPreferenceDocument'
>;

type ProfileActivationPreferenceClient = Pick<
  PorticoClient,
  'viewerPreferenceBundle' | 'recordViewerProfileActivation'
>;

type AccountInstallationCache = Pick<typeof profileSelectionStore, 'set'>;

type Listener = () => void;

export function deviceClassForPlatform(
  platform: PorticoPlatform,
): 'mobile' | 'television' {
  return platform === 'tv' ? 'television' : 'mobile';
}

export function preferenceIdentityForViewer(
  viewer: Pick<PreferenceScopeIdentity, 'authority' | 'accountId' | 'serverId' | 'profileId'>,
  platform: PorticoPlatform,
  currentInstallationId: string,
): ApplePreferenceScopeIdentity {
  return {
    ...viewer,
    deviceClass: deviceClassForPlatform(platform),
    installationId: currentInstallationId,
  };
}

export function defaultAppleViewerPreferences(
  deviceClass: 'mobile' | 'television',
): AppleViewerPreferences {
  const profile = defaultProfileServerPreferences;
  const device = defaultProfileDeviceClassPreferences(deviceClass);
  return {
    autoplayNext: profile.playback.autoplayNext,
    upNextCountdownSeconds: profile.playback.upNextCountdownSeconds,
    passoutProtection: profile.playback.passoutProtection,
    passoutAfterEpisodes: profile.playback.passoutAfterEpisodes,
    introSkip: profile.playback.introSkip,
    creditsSkip: profile.playback.creditsSkip,
    seekIntervalSeconds: commonSeekInterval(profile.playback.skipForwardSeconds),
    preferredAudioLanguage: preferredAudioLanguage(
      profile.playback.preferredAudioLanguages,
    ),
    preferredSubtitleLanguage: profile.playback.subtitlesEnabled
      ? preferredSubtitleLanguage(profile.playback.preferredSubtitleLanguages)
      : 'off',
    allowCellularStreaming: device.playback.quality.cellular.mode !== 'off',
    localQualityMode: device.playback.quality.local.mode,
    wifiQualityMode: device.playback.quality.wifi.mode,
    cellularQualityMode: device.playback.quality.cellular.mode,
    unknownQualityMode: device.playback.quality.unknown.mode,
    directPlay: device.playback.deliveryRequest.directPlay,
    directStream: device.playback.deliveryRequest.directStream,
    transcode: device.playback.deliveryRequest.transcode,
    downloadDeleteWatched: profile.downloads.deleteWatched,
    homeRowOrder: [...profile.home.rowOrder],
    hiddenHomeRowIds: [...profile.home.hiddenRowIds],
  };
}

export function parseScopedApplePreferenceBundle(
  raw: ServerViewerPreferenceBundle,
  expected: ApplePreferenceScopeIdentity,
): ScopedApplePreferenceDocuments {
  assertPreferenceIdentity(raw.identity, expected);
  return {
    identity: {...expected},
    profileServer: parsePreferenceDocument(
      raw.profileServer,
      normalizeProfileServerPreferences,
    ),
    profileDeviceClass: parsePreferenceDocument(
      raw.profileDeviceClass,
      value => normalizeProfileDeviceClassPreferences(value, expected.deviceClass),
    ),
    effectiveProfileDeviceClass: parsePreferenceDocument(
      raw.effectiveProfileDeviceClass,
      value => normalizeProfileDeviceClassPreferences(value, expected.deviceClass),
    ),
    accountServerInstallation: parsePreferenceDocument(
      raw.accountServerInstallation,
      value =>
        normalizeAccountServerInstallationPreferences(
          value,
          expected.deviceClass,
        ),
    ),
    policy: {...raw.policy},
    clampedFields: [...raw.clampedFields],
  };
}

export function appleViewerPreferencesFromDocuments(
  documents: ScopedApplePreferenceDocuments,
): AppleViewerPreferences {
  const playback = documents.profileServer.values.playback;
  const effective = documents.effectiveProfileDeviceClass.values;
  return {
    autoplayNext: playback.autoplayNext,
    upNextCountdownSeconds: playback.upNextCountdownSeconds,
    passoutProtection: playback.passoutProtection,
    passoutAfterEpisodes: playback.passoutAfterEpisodes,
    introSkip: playback.introSkip,
    creditsSkip: playback.creditsSkip,
    seekIntervalSeconds: commonSeekInterval(playback.skipForwardSeconds),
    preferredAudioLanguage: preferredAudioLanguage(
      playback.preferredAudioLanguages,
    ),
    preferredSubtitleLanguage: playback.subtitlesEnabled
      ? preferredSubtitleLanguage(playback.preferredSubtitleLanguages)
      : 'off',
    allowCellularStreaming:
      effective.playback.quality.cellular.mode !== 'off',
    localQualityMode: effective.playback.quality.local.mode,
    wifiQualityMode: effective.playback.quality.wifi.mode,
    cellularQualityMode: effective.playback.quality.cellular.mode,
    unknownQualityMode: effective.playback.quality.unknown.mode,
    directPlay: effective.playback.deliveryRequest.directPlay,
    directStream: effective.playback.deliveryRequest.directStream,
    transcode: effective.playback.deliveryRequest.transcode,
    downloadDeleteWatched: documents.profileServer.values.downloads.deleteWatched,
    homeRowOrder: [...documents.profileServer.values.home.rowOrder],
    hiddenHomeRowIds: [...documents.profileServer.values.home.hiddenRowIds],
  };
}

export function createScopedAppleViewerPreferencesStore({
  client,
  identity,
  accountInstallationCache = profileSelectionStore,
}: {
  client: ViewerPreferenceClient;
  identity: ApplePreferenceScopeIdentity;
  accountInstallationCache?: AccountInstallationCache;
}) {
  // Validate the complete identity before it can become a cache or request key.
  preferenceStorageKeys(identity);
  const listeners = new Set<Listener>();
  let snapshot: AppleViewerPreferenceSnapshot = {
    mutationStatus: 'idle',
    readStatus: 'loading',
    values: defaultAppleViewerPreferences(identity.deviceClass),
  };
  let mutation: Promise<unknown> = Promise.resolve();

  const publish = (next: AppleViewerPreferenceSnapshot) => {
    snapshot = next;
    listeners.forEach(listener => listener());
  };

  const fetchDocuments = async (
    signal?: AbortSignal,
  ): Promise<ScopedApplePreferenceDocuments> => {
    const bundle = await client.viewerPreferenceBundle(
      {
        deviceClass: identity.deviceClass,
        installationId: identity.installationId,
      },
      signal ? {signal} : undefined,
    );
    const documents = parseScopedApplePreferenceBundle(bundle, identity);
    await accountInstallationCache.set(
      identity,
      documents.accountServerInstallation.values,
    );
    return documents;
  };

  const load = async (signal?: AbortSignal, quiet = false) => {
    const retained = snapshot;
    if (!quiet || !retained.documents) {
      publish({...snapshot, readStatus: 'loading', readError: undefined});
    }
    try {
      const documents = await fetchDocuments(signal);
      publish({
        mutationStatus: snapshot.mutationStatus,
        readStatus: 'ready',
        values: appleViewerPreferencesFromDocuments(documents),
        documents,
      });
      return snapshot;
    } catch (cause) {
      const error =
        cause instanceof Error
          ? cause
          : new ProductMessageError('preferences.request-failed');
      publish({...retained, readStatus: 'error', readError: error});
      throw error;
    }
  };

  const update = (changes: AppleViewerPreferenceUpdate) => {
    const operation = mutation.catch(() => undefined).then(async () => {
      const documents = snapshot.documents;
      if (!documents)
        throw new ProductMessageError('preferences.request-failed');
      publish({...snapshot, mutationStatus: 'saving', mutationError: undefined});
      try {
        const profileServerChanges = profileServerPatch(changes);
        if (profileServerChanges) {
          await client.patchViewerPreferenceDocument(
            'profile-server',
            {
              deviceClass: identity.deviceClass,
              installationId: identity.installationId,
            },
            {
              version: 'v1',
              expectedRevision: documents.profileServer.revision,
              changes: profileServerChanges,
            },
          );
        }
        const profileDeviceChanges = profileDeviceClassPatch(changes);
        if (profileDeviceChanges) {
          await client.patchViewerPreferenceDocument(
            'profile-device-class',
            {
              deviceClass: identity.deviceClass,
              installationId: identity.installationId,
            },
            {
              version: 'v1',
              expectedRevision: documents.profileDeviceClass.revision,
              changes: profileDeviceChanges,
            },
          );
        }
        const refreshed = await fetchDocuments();
        publish({
          mutationStatus: 'idle',
          readStatus: 'ready',
          values: appleViewerPreferencesFromDocuments(refreshed),
          documents: refreshed,
        });
        return snapshot.values;
      } catch (cause) {
        const error =
          cause instanceof Error
            ? cause
            : new ProductMessageError('preferences.request-failed');
        publish({...snapshot, mutationStatus: 'error', mutationError: error});
        throw error;
      }
    });
    mutation = operation;
    return operation;
  };

  const updateAutomaticProfileSelection = (enabled: boolean) => {
    const operation = mutation.catch(() => undefined).then(async () => {
      const documents = snapshot.documents;
      if (!documents)
        throw new ProductMessageError('preferences.request-failed');
      publish({...snapshot, mutationStatus: 'saving', mutationError: undefined});
      try {
        await client.patchViewerPreferenceDocument(
          'account-server-installation',
          {
            deviceClass: identity.deviceClass,
            installationId: identity.installationId,
          },
          {
            version: 'v1',
            expectedRevision: documents.accountServerInstallation.revision,
            changes: {profileSelection: enabled ? 'last-used' : 'ask'},
          },
        );
        const refreshed = await fetchDocuments();
        publish({
          mutationStatus: 'idle',
          readStatus: 'ready',
          values: appleViewerPreferencesFromDocuments(refreshed),
          documents: refreshed,
        });
      } catch (cause) {
        const error = cause instanceof Error
          ? cause
          : new ProductMessageError('preferences.request-failed');
        publish({...snapshot, mutationStatus: 'error', mutationError: error});
        throw error;
      }
    });
    mutation = operation;
    return operation;
  };

  return {
    identity: {...identity},
    getSnapshot: () => snapshot,
    subscribe(listener: Listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    load,
    update,
    updateAutomaticProfileSelection,
  };
}

export async function synchronizeActiveProfileLaunchPreference(
  client: ProfileActivationPreferenceClient,
  identity: ApplePreferenceScopeIdentity,
  accountInstallationCache: AccountInstallationCache = profileSelectionStore,
  fence: {
    signal?: AbortSignal;
    isCurrent?: () => boolean;
  } = {},
): Promise<AccountServerInstallationPreferences> {
  const assertCurrent = () => {
    if (fence.signal?.aborted || fence.isCurrent?.() === false) {
      throw new ProductMessageError('auth.profile-selection-failed');
    }
  };
  assertCurrent();
  const requestSignal = fence.signal ? {signal: fence.signal} : undefined;
  const raw = await client.viewerPreferenceBundle(
    {
      deviceClass: identity.deviceClass,
      installationId: identity.installationId,
    },
    requestSignal,
  );
  assertCurrent();
  const documents = parseScopedApplePreferenceBundle(raw, identity);
  let document = documents.accountServerInstallation;
  if (document.values.lastProfileId !== identity.profileId) {
    const activated = await client.recordViewerProfileActivation(
      {
        version: 'v1',
        expectedRevision: document.revision,
      },
      requestSignal,
    );
    assertCurrent();
    document = parsePreferenceDocument(activated, value =>
      normalizeAccountServerInstallationPreferences(
        value,
        identity.deviceClass,
      ),
    );
  }
  assertCurrent();
  await accountInstallationCache.set(identity, document.values);
  assertCurrent();
  return document.values;
}

type ScopedAppleViewerPreferencesStore = ReturnType<
  typeof createScopedAppleViewerPreferencesStore
>;

interface AppleViewerPreferencesContextValue extends AppleViewerPreferenceSnapshot {
  update(changes: AppleViewerPreferenceUpdate): Promise<AppleViewerPreferences>;
  updateAutomaticProfileSelection(enabled: boolean): Promise<void>;
  reload(): Promise<void>;
}

const AppleViewerPreferencesContext =
  createContext<AppleViewerPreferencesContextValue | undefined>(undefined);

export function PorticoViewerPreferencesProvider({
  children,
  platform,
}: {
  children: React.ReactNode;
  platform: PorticoPlatform;
}) {
  const auth = usePorticoAuth();
  const session = auth.session;
  const sessionKey = session
    ? preferenceStorageKeys({
        ...session.viewerScope,
        deviceClass: deviceClassForPlatform(platform),
        installationId: 'pending-installation',
      }).profileDeviceClass
    : '';
  const [binding, setBinding] = useState<{
    sessionKey: string;
    store: ScopedAppleViewerPreferencesStore;
    snapshot: AppleViewerPreferenceSnapshot;
  }>();

  useEffect(() => {
    if (!session) {
      setBinding(undefined);
      return;
    }
    let active = true;
    const controller = new AbortController();
    let unsubscribe: (() => void) | undefined;
    void installationId()
      .then(currentInstallationId => {
        if (!active) return;
        const identity = preferenceIdentityForViewer(
          session.viewerScope,
          platform,
          currentInstallationId,
        );
        const store = createScopedAppleViewerPreferencesStore({
          client: session.client,
          identity,
        });
        const publish = () => {
          if (active)
            setBinding({
              sessionKey,
              store,
              snapshot: store.getSnapshot(),
            });
        };
        unsubscribe = store.subscribe(publish);
        publish();
        return store.load(controller.signal);
      })
      .catch(() => undefined);
    return () => {
      active = false;
      controller.abort();
      unsubscribe?.();
    };
  }, [platform, session, sessionKey]);

  const value = useMemo<AppleViewerPreferencesContextValue>(
    () => {
      const visible =
        binding?.sessionKey === sessionKey
          ? binding.snapshot
          : {
              mutationStatus: 'idle' as const,
              readStatus: 'loading' as const,
              values: defaultAppleViewerPreferences(
                deviceClassForPlatform(platform),
              ),
            };
      return {
        ...visible,
        update: changes => {
          if (!binding || binding.sessionKey !== sessionKey)
            return Promise.reject(
              new ProductMessageError('preferences.request-failed'),
            );
          return binding.store.update(changes);
        },
        updateAutomaticProfileSelection: enabled => {
          if (!binding || binding.sessionKey !== sessionKey)
            return Promise.reject(
              new ProductMessageError('preferences.request-failed'),
            );
          return binding.store.updateAutomaticProfileSelection(enabled);
        },
        reload: async () => {
          if (!binding || binding.sessionKey !== sessionKey) return;
          await binding.store.load(undefined, true);
        },
      };
    },
    [binding, platform, sessionKey],
  );
  return (
    <AppleViewerPreferencesContext.Provider value={value}>
      {children}
    </AppleViewerPreferencesContext.Provider>
  );
}

export function usePorticoViewerPreferences(): AppleViewerPreferencesContextValue {
  const value = useContext(AppleViewerPreferencesContext);
  if (!value)
    throw new Error(
      'Viewer preferences must be used inside PorticoViewerPreferencesProvider.',
    );
  return value;
}

export function useOptionalPorticoViewerPreferences(): AppleViewerPreferencesContextValue | undefined {
  return useContext(AppleViewerPreferencesContext) ?? undefined;
}

function assertPreferenceIdentity(
  actual: ServerViewerPreferenceBundle['identity'],
  expected: ApplePreferenceScopeIdentity,
): void {
  for (const key of [
    'authority',
    'accountId',
    'serverId',
    'profileId',
    'deviceClass',
    'installationId',
  ] as const) {
    if (actual[key] !== expected[key])
      throw new Error(
        `Portico returned preferences for a different ${key}.`,
      );
  }
}

function profileServerPatch(
  changes: AppleViewerPreferenceUpdate,
): DeepPartial<ProfileServerPreferences> | undefined {
  const playback: DeepPartial<ProfileServerPreferences['playback']> = {};
  const home: DeepPartial<ProfileServerPreferences['home']> = {};
  const downloads: DeepPartial<ProfileServerPreferences['downloads']> = {};
  if (changes.autoplayNext !== undefined)
    playback.autoplayNext = changes.autoplayNext;
  if (changes.upNextCountdownSeconds !== undefined)
    playback.upNextCountdownSeconds = changes.upNextCountdownSeconds;
  if (changes.passoutProtection !== undefined)
    playback.passoutProtection = changes.passoutProtection;
  if (changes.passoutAfterEpisodes !== undefined)
    playback.passoutAfterEpisodes = changes.passoutAfterEpisodes;
  if (changes.introSkip !== undefined)
    playback.introSkip = changes.introSkip;
  if (changes.creditsSkip !== undefined)
    playback.creditsSkip = changes.creditsSkip;
  if (changes.seekIntervalSeconds !== undefined) {
    playback.skipBackSeconds = changes.seekIntervalSeconds;
    playback.skipForwardSeconds = changes.seekIntervalSeconds;
  }
  if (changes.preferredAudioLanguage !== undefined) {
    playback.preferredAudioLanguages =
      changes.preferredAudioLanguage === 'original'
        ? []
        : [changes.preferredAudioLanguage];
  }
  if (changes.preferredSubtitleLanguage !== undefined) {
    playback.subtitlesEnabled = changes.preferredSubtitleLanguage !== 'off';
    playback.preferredSubtitleLanguages =
      changes.preferredSubtitleLanguage === 'off'
        ? []
        : [changes.preferredSubtitleLanguage];
  }
  if (changes.homeRowOrder !== undefined)
    home.rowOrder = [...changes.homeRowOrder];
  if (changes.hiddenHomeRowIds !== undefined)
    home.hiddenRowIds = [...changes.hiddenHomeRowIds];
  if (changes.downloadDeleteWatched !== undefined)
    downloads.deleteWatched = changes.downloadDeleteWatched;
  if (!Object.keys(playback).length && !Object.keys(home).length && !Object.keys(downloads).length) return undefined;
  return {
    ...(Object.keys(playback).length ? {playback} : {}),
    ...(Object.keys(home).length ? {home} : {}),
    ...(Object.keys(downloads).length ? {downloads} : {}),
  };
}

function profileDeviceClassPatch(
  changes: AppleViewerPreferenceUpdate,
): DeepPartial<ProfileDeviceClassPreferences> | undefined {
  const quality: DeepPartial<ProfileDeviceClassPreferences['playback']['quality']> = {};
  const deliveryRequest: DeepPartial<ProfileDeviceClassPreferences['playback']['deliveryRequest']> = {};
  if (changes.localQualityMode !== undefined)
    quality.local = {mode: changes.localQualityMode};
  if (changes.wifiQualityMode !== undefined)
    quality.wifi = {mode: changes.wifiQualityMode};
  if (changes.cellularQualityMode !== undefined)
    quality.cellular = {mode: changes.cellularQualityMode};
  else if (changes.allowCellularStreaming !== undefined)
    quality.cellular = changes.allowCellularStreaming
      ? {mode: 'original'}
      : {mode: 'off'};
  if (changes.unknownQualityMode !== undefined)
    quality.unknown = {mode: changes.unknownQualityMode};
  if (changes.directPlay !== undefined)
    deliveryRequest.directPlay = changes.directPlay;
  if (changes.directStream !== undefined)
    deliveryRequest.directStream = changes.directStream;
  if (changes.transcode !== undefined)
    deliveryRequest.transcode = changes.transcode;
  if (!Object.keys(quality).length && !Object.keys(deliveryRequest).length)
    return undefined;
  return {
    playback: {
      ...(Object.keys(quality).length ? {quality} : {}),
      ...(Object.keys(deliveryRequest).length ? {deliveryRequest} : {}),
    },
  };
}

function commonSeekInterval(value: number): SeekIntervalSeconds {
  return value === 15 || value === 30 ? value : 10;
}

function preferredAudioLanguage(values: string[]): PreferredLanguage {
  const first = values[0]?.trim().toLowerCase();
  if (first === 'system') return 'system';
  return isAudioLanguageCode(first) ? first : 'original';
}

function preferredSubtitleLanguage(
  values: string[],
): PreferredSubtitleLanguage {
  const first = values[0]?.trim().toLowerCase();
  return isAudioLanguageCode(first) ? first : 'off';
}

function isAudioLanguageCode(value: string | undefined): value is Exclude<PreferredLanguage, 'original' | 'system'> {
  return Boolean(value && ['en', 'fr', 'es', 'de', 'it', 'pt', 'ja', 'ko', 'zh', 'nl', 'sv', 'no', 'da', 'pl', 'tr', 'ru'].includes(value));
}
