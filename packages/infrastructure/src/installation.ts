import 'react-native-get-random-values';
import * as Keychain from 'react-native-keychain';
import {
  defaultAccountServerInstallationPreferences,
  normalizeAccountServerInstallationPreferences,
  type AccountServerInstallationPreferences,
  type PreferenceScopeIdentity,
} from '@porticomediaserver/client-core';
import type {PorticoPlatform} from './types';

const INSTALLATION_ID_SERVICE = 'tv.getportico.installation-id.v1';
const LAST_SERVER_ID_SERVICE = 'tv.getportico.last-server-id.v1';
const PROFILE_SELECTION_SERVICE = 'tv.getportico.profile-selection.v1';
const USERNAME = 'portico';
let installationMutation: Promise<void> = Promise.resolve();
let selectedServerMutation: Promise<void> = Promise.resolve();
let ephemeralClientMetadataId: string | undefined;

export async function installationId(): Promise<string> {
  let resolved = '';
  const next = installationMutation.then(async () => {
    const existing = await Keychain.getGenericPassword({
      service: INSTALLATION_ID_SERVICE,
    });
    if (existing) {
      if (existing.username !== USERNAME || !existing.password.trim()) {
        throw new Error(
          'Portico could not verify the saved installation identity.',
        );
      }
      resolved = existing.password;
      return;
    }
    const generated = createUUID();
    const result = await Keychain.setGenericPassword(USERNAME, generated, {
      accessible: Keychain.ACCESSIBLE.AFTER_FIRST_UNLOCK_THIS_DEVICE_ONLY,
      service: INSTALLATION_ID_SERVICE,
    });
    if (result === false) {
      throw new Error('Keychain refused to save the installation identity.');
    }
    const persisted = await Keychain.getGenericPassword({
      service: INSTALLATION_ID_SERVICE,
    });
    if (
      !persisted ||
      persisted.username !== USERNAME ||
      persisted.password !== generated
    ) {
      throw new Error('Portico could not verify the installation identity.');
    }
    resolved = generated;
  });
  installationMutation = next.catch(() => undefined);
  await next;
  return resolved;
}

/**
 * Returns the durable, opaque identifier when Keychain is available.
 *
 * This value is device metadata, not a credential or proof of possession. An
 * unavailable Keychain must therefore never prevent Portico Account sign-in
 * or refresh. Callers which use the identifier only to describe the client to
 * Hosted Services should use this best-effort form; local preference and
 * pairing stores may continue to require the durable form above.
 */
export async function optionalInstallationId(): Promise<string | undefined> {
  try {
    return await installationId();
  } catch {
    return undefined;
  }
}

/**
 * Supplies an opaque client-instance label for APIs which accept device
 * metadata. The fallback lives only for this process and deliberately conveys
 * no durable authorization or profile trust when Keychain is unavailable.
 */
export async function clientMetadataId(): Promise<string> {
  const durable = await optionalInstallationId();
  if (durable) return durable;
  ephemeralClientMetadataId ??= createUUID();
  return ephemeralClientMetadataId;
}

export const selectedServerStore = {
  get: async () => {
    await selectedServerMutation;
    const value = await Keychain.getGenericPassword({
      service: LAST_SERVER_ID_SERVICE,
    });
    return value ? value.password : null;
  },
  set: async (serverId: string) => {
    const next = selectedServerMutation.then(async () => {
      const result = await Keychain.setGenericPassword(USERNAME, serverId, {
        accessible: Keychain.ACCESSIBLE.AFTER_FIRST_UNLOCK_THIS_DEVICE_ONLY,
        service: LAST_SERVER_ID_SERVICE,
      });
      if (result === false) {
        throw new Error('Keychain refused to save the selected server.');
      }
      const persisted = await Keychain.getGenericPassword({
        service: LAST_SERVER_ID_SERVICE,
      });
      if (!persisted || persisted.password !== serverId) {
        throw new Error('Portico could not verify the selected server.');
      }
    });
    selectedServerMutation = next.catch(() => undefined);
    await next;
  },
  clear: async () => {
    const next = selectedServerMutation.then(async () => {
      let resetFailure: unknown;
      try {
        await Keychain.resetGenericPassword({service: LAST_SERVER_ID_SERVICE});
      } catch (cause) {
        resetFailure = cause;
      }
      const retained = await Keychain.getGenericPassword({
        service: LAST_SERVER_ID_SERVICE,
      });
      if (retained) {
        throw new AggregateError(
          [
            resetFailure,
            new Error('Keychain retained the selected server.'),
          ].filter(value => value !== undefined),
          'Portico could not clear the selected server.',
        );
      }
    });
    selectedServerMutation = next.catch(() => undefined);
    await next;
  },
};

type ProfileSelectionCollection = Record<
  string,
  AccountServerInstallationPreferences
>;

export interface ProfileSelectionScope {
  authority: 'hosted' | 'local';
  accountId: string;
  serverId: string;
  installationId: string;
}

export interface VerifiedProfileSelectionScope extends ProfileSelectionScope {
  profileId: string;
}

export interface ProfileSelectionStorage {
  read(): Promise<unknown>;
  write(collection: ProfileSelectionCollection): Promise<void>;
}

function profileSelectionKey(scope: ProfileSelectionScope): string {
  const authority = scope.authority;
  const accountId = scope.accountId.trim();
  const serverId = scope.serverId.trim();
  const scopedInstallationId = scope.installationId.trim();
  if (
    !['hosted', 'local'].includes(authority) ||
    !accountId ||
    !serverId ||
    !scopedInstallationId
  ) {
    throw new TypeError(
      'Profile preferences require an authority, account, server, and installation identity.',
    );
  }
  return `v2:${JSON.stringify([
    authority,
    accountId,
    serverId,
    scopedInstallationId,
  ])}`;
}

function profileDeviceClass(
  platform: PorticoPlatform,
): 'mobile' | 'television' {
  return platform === 'tv' ? 'television' : 'mobile';
}

export function createProfileSelectionStore(storage: ProfileSelectionStorage) {
  let mutation: Promise<void> = Promise.resolve();

  const read = async (): Promise<ProfileSelectionCollection> => {
    const raw = await storage.read();
    return raw && typeof raw === 'object' && !Array.isArray(raw)
      ? {...(raw as ProfileSelectionCollection)}
      : {};
  };

  return {
    get: async (
      scope: ProfileSelectionScope,
      platform: PorticoPlatform,
    ): Promise<AccountServerInstallationPreferences> => {
      await mutation;
      const deviceClass = profileDeviceClass(platform);
      const collection = await read();
      const stored = collection[profileSelectionKey(scope)];
      return stored
        ? normalizeAccountServerInstallationPreferences(stored, deviceClass)
        : {
            ...defaultAccountServerInstallationPreferences(deviceClass),
            // An absent exact-scope record is not authorization to auto-open a
            // profile. Convenience defaults apply only after a verified choice
            // has been stored in this exact authority/account/server/install.
            profileSelection: 'ask' as const,
          };
    },

    recordVerifiedSelection: async (
      scope: VerifiedProfileSelectionScope,
      platform: PorticoPlatform,
    ): Promise<void> => {
      const deviceClass = profileDeviceClass(platform);
      const profileId = scope.profileId.trim();
      if (!profileId) {
        throw new TypeError(
          'Verified profile preferences require a profile identity.',
        );
      }
      const key = profileSelectionKey(scope);
      const next = mutation.then(async () => {
        const collection = await read();
        const exact = collection[key];
        // Legacy account/server entries are intentionally inert. Only an
        // existing exact-scope record may retain an explicit auto-open toggle.
        const basis = exact
          ? normalizeAccountServerInstallationPreferences(exact, deviceClass)
          : {
              ...defaultAccountServerInstallationPreferences(deviceClass),
              profileSelection: 'ask' as const,
            };
        collection[key] = {...basis, lastProfileId: profileId};
        await storage.write(collection);
      });
      mutation = next.catch(() => undefined);
      await next;
    },

    set: async (
      identity: PreferenceScopeIdentity,
      preferences: AccountServerInstallationPreferences,
    ): Promise<void> => {
      const normalized = normalizeAccountServerInstallationPreferences(
        preferences,
        identity.deviceClass,
      );
      const key = profileSelectionKey(identity);
      const next = mutation.then(async () => {
        const collection = await read();
        collection[key] = normalized;
        await storage.write(collection);
      });
      mutation = next.catch(() => undefined);
      await next;
    },
  };
}

export const profileSelectionStore = createProfileSelectionStore({
  read: async () => {
    const stored = await Keychain.getGenericPassword({
      service: PROFILE_SELECTION_SERVICE,
    });
    if (!stored) return {};
    try {
      return JSON.parse(stored.password) as unknown;
    } catch {
      await Keychain.resetGenericPassword({
        service: PROFILE_SELECTION_SERVICE,
      });
      return {};
    }
  },
  write: async collection => {
    const serialized = JSON.stringify(collection);
    const result = await Keychain.setGenericPassword(USERNAME, serialized, {
      accessible: Keychain.ACCESSIBLE.AFTER_FIRST_UNLOCK_THIS_DEVICE_ONLY,
      service: PROFILE_SELECTION_SERVICE,
    });
    if (result === false) {
      throw new Error('Keychain refused to save the profile preference.');
    }
    const persisted = await Keychain.getGenericPassword({
      service: PROFILE_SELECTION_SERVICE,
    });
    if (
      !persisted ||
      persisted.username !== USERNAME ||
      persisted.password !== serialized
    ) {
      throw new Error('Portico could not verify the profile preference.');
    }
  },
});

function createUUID(): string {
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
  bytes[6] = (bytes[6] & 0x0f) | 0x40;
  bytes[8] = (bytes[8] & 0x3f) | 0x80;
  const value = [...bytes]
    .map(byte => byte.toString(16).padStart(2, '0'))
    .join('');
  return `${value.slice(0, 8)}-${value.slice(8, 12)}-${value.slice(12, 16)}-${value.slice(16, 20)}-${value.slice(20)}`;
}
