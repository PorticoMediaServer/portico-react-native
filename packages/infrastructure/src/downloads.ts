import {NativeEventEmitter, NativeModules, Platform} from 'react-native';
import {
  normalizeViewerScope,
  sameViewerScope,
  viewerCacheKey,
  type ViewerScope,
} from '@porticomediaserver/client-core';

export type DownloadState =
  | 'queued'
  | 'preparing'
  | 'downloading'
  | 'paused'
  | 'completed'
  | 'failed'
  | 'expired'
  | 'unavailable'
  | 'deleted';

/** A durable download is owned by exactly one verified viewer scope. */
export interface PorticoDownload extends ViewerScope {
  id: string;
  /** Stable caller identifier before the native scope namespace is applied. */
  clientIdentifier: string;
  mediaId: string;
  /** Server download/transcode quality profile, not the viewing profile. */
  profile: string;
  /** Durable server preparation identity, retained across app restarts. */
  preparationId: string;
  preparationProgress?: number;
  title: string;
  subtitle?: string;
  state: DownloadState;
  bytesWritten: number;
  bytesExpected: number;
  progress: number;
  localURL?: string;
  error?: string;
  createdAt: string;
  updatedAt: string;
  progressSeconds?: number;
  durationSeconds?: number;
  playbackProgressPending?: boolean;
  playbackCompleted?: boolean;
}

export interface StageDownloadPreparationRequest {
  id: string;
  mediaId: string;
  profile: string;
  preparationId: string;
  title: string;
  subtitle?: string;
  state: 'preparing' | 'paused' | 'failed' | 'unavailable';
  preparationProgress: number;
  expectedBytes?: number;
}

export interface EnqueueDownloadRequest {
  id: string;
  mediaId: string;
  profile: string;
  preparationId: string;
  title: string;
  subtitle?: string;
  /** Ephemeral scoped credential forwarded only to the OS transfer request. */
  authorization: string;
  downloadURL: string;
  /** Required bounded reservation; unknown-size transfers fail closed. */
  expectedBytes: number;
  /** Per-installation cap applied atomically by the native queue owner. */
  storageLimitBytes: number;
  wifiOnly?: boolean;
}

export interface ScopedDownloadOperation {
  /** The verified viewer that started the operation. Never re-read mid-flight. */
  scope: ViewerScope;
  /** Optional runtime generation fence for work that crosses a profile transition. */
  isCurrent?(): boolean;
}

type NativeViewerScope = Pick<
  ViewerScope,
  'authority' | 'accountId' | 'serverId' | 'profileId' | 'authorizationRevision'
>;
type NativeEnqueueDownloadRequest = EnqueueDownloadRequest &
  NativeViewerScope & {clientIdentifier: string};

export interface NativeDownloadModule {
  list(scope: NativeViewerScope): Promise<unknown[]>;
  stagePreparation(
    request: StageDownloadPreparationRequest &
      NativeViewerScope & {clientIdentifier: string},
  ): Promise<unknown>;
  enqueue(request: NativeEnqueueDownloadRequest): Promise<unknown>;
  pause(id: string, scope: NativeViewerScope): Promise<unknown>;
  resume(id: string, scope: NativeViewerScope): Promise<unknown>;
  remove(id: string, scope: NativeViewerScope): Promise<unknown | undefined>;
  storageUsage(
    scope: NativeViewerScope,
  ): Promise<{bytes: number; count: number}>;
  updatePlaybackProgress(
    id: string,
    positionSeconds: number,
    durationSeconds: number,
    completed: boolean,
    ordering: {attempt: number; revision: number},
    scope: NativeViewerScope,
  ): Promise<unknown>;
  markPlaybackProgressSynced(
    id: string,
    scope: NativeViewerScope,
  ): Promise<unknown>;
  cleanupStaleAuthorizations(
    scope: NativeViewerScope,
  ): Promise<{bytesRemoved: number; recordsRemoved: number}>;
}

export interface DownloadEventSubscription {
  remove(): void;
}

export type DownloadEventSubscriber = (
  listener: () => void,
) => DownloadEventSubscription;

let activeViewerScope: ViewerScope | undefined;
const pendingOperations = new Map<string, Set<Promise<unknown>>>();

function downloadOperationScopeKey(scope: ViewerScope): string {
  return viewerCacheKey({
    ...normalizeViewerScope(scope),
    contractRevision: 'portico-react-native-download-v1',
    resource: 'download-operation',
  });
}

function nativeScopeInput(scope: ViewerScope): NativeViewerScope {
  const normalized = normalizeViewerScope(scope);
  return {
    accountId: normalized.accountId,
    authority: normalized.authority,
    authorizationRevision: normalized.authorizationRevision,
    profileId: normalized.profileId,
    serverId: normalized.serverId,
  };
}

function trackDownloadOperation<T>(
  scope: ViewerScope,
  operation: Promise<T>,
): Promise<T> {
  const key = downloadOperationScopeKey(scope);
  const operations = pendingOperations.get(key) ?? new Set<Promise<unknown>>();
  const tracked = operation.finally(() => {
    operations.delete(tracked);
    if (operations.size === 0) pendingOperations.delete(key);
  });
  operations.add(tracked);
  pendingOperations.set(key, operations);
  return tracked;
}

/** Waits for native operations already bound to this viewer; no next viewer data is exposed. */
export async function drainDownloadOperations(
  scope: ViewerScope,
): Promise<void> {
  const operations = [
    ...(pendingOperations.get(downloadOperationScopeKey(scope)) ?? []),
  ];
  await Promise.allSettled(operations);
}

export function setActiveDownloadViewerScope(
  scope: ViewerScope | undefined,
): void {
  activeViewerScope = scope ? normalizeViewerScope(scope) : undefined;
}

export function activeDownloadViewerScope(): ViewerScope | undefined {
  return activeViewerScope ? {...activeViewerScope} : undefined;
}

export function scopedNativeDownloadIdentifier(
  scope: ViewerScope,
  clientIdentifier: string,
): string {
  const normalized = normalizeViewerScope(scope);
  const canonical = viewerCacheKey({
    ...normalized,
    contractRevision: 'portico-react-native-download-v1',
    resource: 'offline-download',
    parameters: {clientIdentifier},
  });
  return `download-${stableHash(canonical, 0x811c9dc5)}${stableHash(canonical, 0x9e3779b9)}`;
}

export function downloadBelongsToScope(
  value: unknown,
  scope: ViewerScope,
): value is PorticoDownload {
  if (!value || typeof value !== 'object') return false;
  const candidate = value as Partial<PorticoDownload> & {quarantined?: unknown};
  if (candidate.quarantined === true) return false;
  try {
    return (
      typeof candidate.id === 'string' &&
      typeof candidate.clientIdentifier === 'string' &&
      sameViewerScope(candidate as ViewerScope, scope)
    );
  } catch {
    // Legacy rows without explicit ownership are quarantined, never adopted.
    return false;
  }
}

export function createScopedPorticoDownloadStore(
  nativeModule: NativeDownloadModule | undefined,
  subscribeToNativeEvents?: DownloadEventSubscriber,
) {
  const requireNative = (): NativeDownloadModule => {
    if (!nativeModule)
      throw new Error(
        'Offline downloads are available only in the Portico iOS app.',
      );
    return nativeModule;
  };
  const requireScope = (): ViewerScope => {
    if (!activeViewerScope)
      throw new Error(
        'Choose and unlock a Portico profile before opening downloads.',
      );
    return activeViewerScope;
  };
  const operationScope = (operation?: ScopedDownloadOperation): ViewerScope =>
    normalizeViewerScope(operation?.scope ?? requireScope());
  const assertCurrent = (
    scope: ViewerScope,
    operation?: ScopedDownloadOperation,
  ): void => {
    if (operation?.isCurrent && !operation.isCurrent()) {
      throw new Error(
        'The active Portico profile changed before the download operation completed.',
      );
    }
    if (!activeViewerScope || !sameViewerScope(activeViewerScope, scope)) {
      throw new Error(
        'The active Portico profile changed before the download operation completed.',
      );
    }
  };
  const run = async <T>(
    scope: ViewerScope,
    operation: () => Promise<T>,
  ): Promise<T> => trackDownloadOperation(scope, operation());
  const ownedRecord = (value: unknown, scope: ViewerScope): PorticoDownload => {
    if (!downloadBelongsToScope(value, scope))
      throw new Error(
        'The download does not belong to the active Portico profile.',
      );
    return value;
  };
  const listForScope = async (
    scope: ViewerScope,
  ): Promise<PorticoDownload[]> => {
    const values = await trackDownloadOperation(
      scope,
      requireNative().list(nativeScopeInput(scope)),
    );
    return values.filter(value => downloadBelongsToScope(value, scope));
  };

  return {
    activateScope: setActiveDownloadViewerScope,
    list: async (
      operation?: ScopedDownloadOperation,
    ): Promise<PorticoDownload[]> => {
      const scope = operationScope(operation);
      assertCurrent(scope, operation);
      const values = await listForScope(scope);
      assertCurrent(scope, operation);
      return values;
    },
    stagePreparation: async (
      request: StageDownloadPreparationRequest,
      operation?: ScopedDownloadOperation,
    ): Promise<PorticoDownload> => {
      const scope = operationScope(operation);
      assertCurrent(scope, operation);
      const result = await run(scope, () =>
        requireNative().stagePreparation({
          ...request,
          ...nativeScopeInput(scope),
          clientIdentifier: request.id,
          id: scopedNativeDownloadIdentifier(scope, request.id),
        }),
      );
      assertCurrent(scope, operation);
      return ownedRecord(result, scope);
    },
    enqueue: async (
      request: EnqueueDownloadRequest,
      operation?: ScopedDownloadOperation,
    ): Promise<PorticoDownload> => {
      const scope = operationScope(operation);
      assertCurrent(scope, operation);
      const result = await run(scope, () =>
        requireNative().enqueue({
          ...request,
          ...nativeScopeInput(scope),
          clientIdentifier: request.id,
          id: scopedNativeDownloadIdentifier(scope, request.id),
        }),
      );
      assertCurrent(scope, operation);
      return ownedRecord(result, scope);
    },
    pause: async (
      id: string,
      operation?: ScopedDownloadOperation,
    ): Promise<PorticoDownload> => {
      const scope = operationScope(operation);
      assertCurrent(scope, operation);
      const result = await run(scope, () =>
        requireNative().pause(id, nativeScopeInput(scope)),
      );
      assertCurrent(scope, operation);
      return ownedRecord(result, scope);
    },
    resume: async (
      id: string,
      operation?: ScopedDownloadOperation,
    ): Promise<PorticoDownload> => {
      const scope = operationScope(operation);
      assertCurrent(scope, operation);
      const result = await run(scope, () =>
        requireNative().resume(id, nativeScopeInput(scope)),
      );
      assertCurrent(scope, operation);
      return ownedRecord(result, scope);
    },
    remove: async (
      id: string,
      operation?: ScopedDownloadOperation,
    ): Promise<PorticoDownload | undefined> => {
      const scope = operationScope(operation);
      assertCurrent(scope, operation);
      const result = await run(scope, () =>
        requireNative().remove(id, nativeScopeInput(scope)),
      );
      assertCurrent(scope, operation);
      return result === undefined || result === null
        ? undefined
        : ownedRecord(result, scope);
    },
    storageUsage: async (
      operation?: ScopedDownloadOperation,
    ): Promise<{bytes: number; count: number}> => {
      const scope = operationScope(operation);
      assertCurrent(scope, operation);
      const result = await run(scope, () =>
        requireNative().storageUsage(nativeScopeInput(scope)),
      );
      assertCurrent(scope, operation);
      return result;
    },
    updatePlaybackProgress: async (
      id: string,
      positionSeconds: number,
      durationSeconds: number,
      completed: boolean,
      operation?: ScopedDownloadOperation,
      ordering?: {attempt: number; revision: number},
    ): Promise<PorticoDownload> => {
      const scope = operationScope(operation);
      assertCurrent(scope, operation);
      const result = await run(scope, () =>
        requireNative().updatePlaybackProgress(
          id,
          positionSeconds,
          durationSeconds,
          completed,
          ordering ?? {attempt: 0, revision: 0},
          nativeScopeInput(scope),
        ),
      );
      assertCurrent(scope, operation);
      return ownedRecord(result, scope);
    },
    markPlaybackProgressSynced: async (
      id: string,
      operation?: ScopedDownloadOperation,
    ): Promise<PorticoDownload> => {
      const scope = operationScope(operation);
      assertCurrent(scope, operation);
      const result = await run(scope, () =>
        requireNative().markPlaybackProgressSynced(id, nativeScopeInput(scope)),
      );
      assertCurrent(scope, operation);
      return ownedRecord(result, scope);
    },
    cleanupStaleAuthorizations: async (
      operation?: ScopedDownloadOperation,
    ): Promise<{bytesRemoved: number; recordsRemoved: number}> => {
      const scope = operationScope(operation);
      assertCurrent(scope, operation);
      const result = await run(scope, () =>
        requireNative().cleanupStaleAuthorizations(nativeScopeInput(scope)),
      );
      assertCurrent(scope, operation);
      return result;
    },
    subscribe(listener: (downloads: PorticoDownload[]) => void): () => void {
      if (!nativeModule || !subscribeToNativeEvents) return () => undefined;
      let cancelled = false;
      let eventGeneration = 0;
      let running = false;
      let runningScopeKey: string | undefined;
      let pending = false;
      const refresh = () => {
        const scope = activeViewerScope;
        if (!scope) return;
        const scopeKey = viewerCacheKey({
          ...scope,
          contractRevision: 'portico-react-native-download-v1',
          resource: 'download-subscription',
        });
        if (running) {
          pending = true;
          if (runningScopeKey === scopeKey) return;
          // A profile transition must not wait behind a native read owned by
          // the previous profile. Invalidate that publication and begin the
          // new scoped read immediately; the old operation still drains under
          // its captured scope.
          running = false;
          runningScopeKey = undefined;
          pending = false;
        }
        running = true;
        runningScopeKey = scopeKey;
        const generation = ++eventGeneration;
        void listForScope(scope)
          .then(downloads => {
            if (
              cancelled ||
              generation !== eventGeneration ||
              !activeViewerScope
            )
              return;
            const currentKey = viewerCacheKey({
              ...activeViewerScope,
              contractRevision: 'portico-react-native-download-v1',
              resource: 'download-subscription',
            });
            if (currentKey === scopeKey) listener(downloads);
          })
          .catch(() => undefined)
          .finally(() => {
            if (generation !== eventGeneration) return;
            running = false;
            runningScopeKey = undefined;
            if (pending && !cancelled) {
              pending = false;
              refresh();
            }
          });
      };
      const subscription = subscribeToNativeEvents(refresh);
      refresh();
      return () => {
        cancelled = true;
        eventGeneration += 1;
        subscription.remove();
      };
    },
  };
}

const nativeModule = NativeModules.PorticoDownloadManager as
  | NativeDownloadModule
  | undefined;
export const downloadsSupported =
  Platform.OS === 'ios' && !Platform.isTV && Boolean(nativeModule);

const subscribeToNativeEvents: DownloadEventSubscriber | undefined =
  downloadsSupported && nativeModule
    ? listener => {
        const emitter = new NativeEventEmitter(
          NativeModules.PorticoDownloadManager,
        );
        return emitter.addListener('PorticoDownloadsChanged', listener);
      }
    : undefined;

export const porticoDownloads = createScopedPorticoDownloadStore(
  downloadsSupported ? nativeModule : undefined,
  subscribeToNativeEvents,
);

function stableHash(value: string, seed: number): string {
  let hash = seed >>> 0;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193);
  }
  return (hash >>> 0).toString(16).padStart(8, '0');
}
