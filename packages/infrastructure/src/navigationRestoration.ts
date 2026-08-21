import {
  createPorticoNavigationRestoration,
  porticoNavigationRestorationFence,
  restorePorticoNavigation,
  type PorticoDestinationCapabilities,
  type PorticoNavigationRestoration,
  type PorticoNavigationRestorationFence,
  type PorticoPrimaryDestination,
  type ProfileTransitionReason,
  type ViewerScope,
} from '@porticomediaserver/client-core';
import {Settings} from 'react-native';

const NAVIGATION_RESTORATION_KEY = 'portico.navigation.restoration.v1';

export interface NavigationRestorationStorage {
  read(): Promise<unknown | undefined>;
  write(value: PorticoNavigationRestoration): Promise<void>;
  clear(): Promise<void>;
}

type NativeSettings = Pick<typeof Settings, 'get' | 'set'>;

/**
 * Stores only non-sensitive presentation state in Apple UserDefaults through
 * React Native Settings. Authentication and playback resources never enter
 * this store. A future Android shell should supply an equivalent preferences
 * adapter (for example DataStore), not AsyncStorage or credential storage.
 */
export function createSettingsNavigationRestorationStorage(
  settings?: NativeSettings,
  key = NAVIGATION_RESTORATION_KEY,
): NavigationRestorationStorage {
  // React Native exposes Settings through a lazy native-module getter. Do not
  // dereference it while this infrastructure package is imported: doing so
  // makes unrelated consumers and pure unit tests require a booted Apple
  // runtime. Explicit test/platform adapters remain fully injectable.
  const nativeSettings = (): NativeSettings => settings ?? Settings;
  return {
    async read() {
      const raw = nativeSettings().get(key);
      if (typeof raw !== 'string' || !raw) return undefined;
      try {
        return JSON.parse(raw) as unknown;
      } catch {
        nativeSettings().set({[key]: null});
        return undefined;
      }
    },
    async write(value) {
      // The strict Client Core constructor guarantees a bounded primary-only
      // document. UserDefaults receives one small JSON property-list value.
      nativeSettings().set({[key]: JSON.stringify(value)});
    },
    async clear() {
      // RCTSettingsManager maps null to removeObjectForKey on Apple platforms.
      nativeSettings().set({[key]: null});
    },
  };
}

function fenceIdentity(fence: PorticoNavigationRestorationFence): string {
  const normalized = porticoNavigationRestorationFence(fence);
  return JSON.stringify([
    normalized.authority,
    normalized.accountId,
    normalized.serverId,
    normalized.profileId,
    normalized.authorizationRevision,
    normalized.productContractRevision,
    normalized.routeContractRevision,
    normalized.platform,
    normalized.capabilityRevision,
  ]);
}

export class BoundedNavigationRestorationStore {
  private activeFence?: PorticoNavigationRestorationFence;
  private operation: Promise<void> = Promise.resolve();

  constructor(private readonly storage: NavigationRestorationStorage) {}

  /**
   * Activates one verified viewer scope and returns only its safe primary hint.
   * A malformed or stale record is removed silently rather than becoming a
   * loading/error surface.
   */
  async activateScope(
    fenceInput: PorticoNavigationRestorationFence,
    options: {
      capabilities?: PorticoDestinationCapabilities;
      maxAgeMs?: number;
      now?: Date;
    } = {},
  ): Promise<PorticoPrimaryDestination | undefined> {
    const fence = porticoNavigationRestorationFence(fenceInput);
    if (
      this.activeFence &&
      fenceIdentity(this.activeFence) !== fenceIdentity(fence)
    ) {
      await this.clear();
    }
    this.activeFence = fence;
    const raw = await this.storage.read();
    if (raw === undefined) return undefined;
    const restored = restorePorticoNavigation(raw, fence, options);
    if (!restored) await this.clearStoredValue(false);
    return restored;
  }

  /** Saves only a normalized primary destination for the active verified scope. */
  async save(
    destination: PorticoPrimaryDestination,
    now = new Date(),
  ): Promise<void> {
    if (!this.activeFence)
      throw new Error(
        'Navigation restoration cannot be saved before a verified viewer scope is active.',
      );
    const value = createPorticoNavigationRestoration(
      this.activeFence,
      destination,
      now,
    );
    await this.enqueue(() => this.storage.write(value));
  }

  /**
   * Synchronously drops authority to save, then clears the old scope's hint.
   * Call this at the viewer transition fence before publishing another scope.
   */
  async clear(): Promise<void> {
    this.activeFence = undefined;
    await this.clearStoredValue(false);
  }

  /** Clears the prior viewer, then installs the next verified fence without restoring it. */
  async resetForScopeChange(
    next?: PorticoNavigationRestorationFence,
  ): Promise<void> {
    this.activeFence = undefined;
    await this.clearStoredValue(false);
    this.activeFence = next
      ? porticoNavigationRestorationFence(next)
      : undefined;
  }

  currentFence(): PorticoNavigationRestorationFence | undefined {
    return this.activeFence;
  }

  private async clearStoredValue(dropAuthority: boolean): Promise<void> {
    if (dropAuthority) this.activeFence = undefined;
    await this.enqueue(() => this.storage.clear());
  }

  private async enqueue(operation: () => Promise<void>): Promise<void> {
    const result = this.operation.then(operation, operation);
    this.operation = result.catch(() => undefined);
    await result;
  }
}

export const porticoNavigationRestoration =
  new BoundedNavigationRestorationStore(
    createSettingsNavigationRestorationStorage(),
  );

type ViewerRuntimeFocusFence = {
  register(
    phase: 'focus',
    hook: (
      scope: ViewerScope,
      reason: ProfileTransitionReason,
    ) => void | Promise<void>,
  ): () => void;
};

/**
 * Installs restoration cleanup inside the viewer transition transaction. This
 * runs before a replacement viewer is published, so an old account/profile
 * can never leave a primary-navigation hint for the next one to consume.
 */
export function registerNavigationRestorationViewerFence(
  runtime: ViewerRuntimeFocusFence,
  store: BoundedNavigationRestorationStore = porticoNavigationRestoration,
): () => void {
  return runtime.register('focus', () => store.clear());
}
