import React, {
  createContext,
  useEffect,
  useContext,
  useRef,
  useSyncExternalStore,
} from 'react';
import {AppState, type AppStateStatus} from 'react-native';
import {
  normalizeViewerScope,
  PORTICO_QUERY_RETAIN_TIME_MS,
  PORTICO_QUERY_STALE_TIME_MS,
  sameViewerScope,
  shouldRetryPorticoQuery,
  transitionViewerRuntime,
  ViewerSyncCoordinator,
  viewerCacheKey,
  viewerQueryKey,
  viewerQueryPrefix,
  type ProfileTransitionReason,
  type ViewerRuntimeAdapter,
  type ViewerScope,
} from '@portico/client-core';
import {
  dehydrate,
  hashKey,
  hydrate,
  QueryClient,
  QueryClientProvider,
  focusManager,
  onlineManager,
  type DehydratedState,
  type QueryKey,
} from '@tanstack/react-query';
import {
  drainDownloadOperations,
  porticoDownloads,
  setActiveDownloadViewerScope,
} from './downloads';
import {rotatePrivateArtworkCacheKey} from './serverResource';

const RUNTIME_CONTRACT_REVISION = 'portico-react-native-runtime-v1';

export type ViewerRuntimePhase =
  | 'requests'
  | 'playback'
  | 'realtime'
  | 'optimistic'
  | 'artwork'
  | 'overlays'
  | 'focus'
  | 'local-state';

export type ViewerRuntimeHook = (
  scope: ViewerScope,
  reason: ProfileTransitionReason,
) => void | Promise<void>;

export interface ViewerWriteToken {
  readonly generation: number;
  readonly scopeKey: string;
}

export interface ViewerRequestLease {
  readonly signal: AbortSignal;
  readonly writeToken: ViewerWriteToken;
  release(): void;
}

export interface ViewerRuntimeSnapshot {
  readonly acceptingWrites: boolean;
  readonly foreground: boolean;
  readonly generation: number;
  readonly online: boolean;
  readonly queryClient: QueryClient;
  readonly scope?: ViewerScope;
  readonly scopeKey?: string;
  readonly transitioning: boolean;
  readonly transitionFailure?: Error;
}

export type ViewerRuntimeRollbackMode = 'restore-previous' | 'fail-closed';

export interface StagedViewerRuntime {
  /** Reinstalls the synchronous write fence before credential compensation. */
  fence(): void;
  publish(): void | Promise<void>;
  rollback(mode?: ViewerRuntimeRollbackMode): void | Promise<void>;
}

export {viewerQueryKey, viewerQueryPrefix};

export function viewerScopeKey(scope: ViewerScope): string {
  const normalized = normalizeViewerScope(scope);
  return viewerCacheKey({
    ...normalized,
    contractRevision: RUNTIME_CONTRACT_REVISION,
    resource: 'viewer-runtime',
  });
}

const viewerArtworkResetters = new Set<() => void>();

export function registerViewerArtworkResetter(reset: () => void): () => void {
  viewerArtworkResetters.add(reset);
  return () => viewerArtworkResetters.delete(reset);
}

function resetViewerArtworkState(): void {
  for (const reset of [...viewerArtworkResetters]) reset();
}

export function createViewerQueryClient(scope?: ViewerScope): QueryClient {
  const prefix = scope ? viewerScopeKey(scope) : 'portico:unscoped';
  return new QueryClient({
    defaultOptions: {
      mutations: {gcTime: 5 * 60_000, retry: false},
      queries: {
        gcTime: PORTICO_QUERY_RETAIN_TIME_MS,
        queryKeyHashFn: (queryKey: QueryKey) =>
          `${prefix}:${hashKey(queryKey)}`,
        retry: shouldRetryPorticoQuery,
        staleTime: PORTICO_QUERY_STALE_TIME_MS,
      },
    },
  });
}

export class ViewerRuntimeCoordinator {
  private activeStage?: number;
  private acceptingWrites = false;
  private generation = 0;
  private foreground = AppState.currentState === 'active';
  private hooks = new Map<ViewerRuntimePhase, Set<ViewerRuntimeHook>>();
  private listeners = new Set<() => void>();
  private queryClient = createViewerQueryClient();
  private online = true;
  private requestControllers = new Set<AbortController>();
  private scope?: ViewerScope;
  private snapshot: ViewerRuntimeSnapshot = this.buildSnapshot();
  private stageSequence = 0;
  private transitioning = false;
  private transitionFailure?: Error;
  private viewerSyncCoordinator?: ViewerSyncCoordinator;

  getSnapshot = (): ViewerRuntimeSnapshot => this.snapshot;

  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  };

  setLifecycleState(state: {foreground?: boolean; online?: boolean}): void {
    const foreground = state.foreground ?? this.foreground;
    const online = state.online ?? this.online;
    if (foreground === this.foreground && online === this.online) return;
    this.foreground = foreground;
    this.online = online;
    this.viewerSyncCoordinator?.setRuntimeState({foreground, online});
    this.publish();
  }

  viewerSync(): ViewerSyncCoordinator | undefined {
    return this.viewerSyncCoordinator;
  }

  setPlaybackContinuityActive(active: boolean): void {
    this.viewerSyncCoordinator?.setPlaybackContinuityActive(active);
  }

  private closeViewerSync(): void {
    this.viewerSyncCoordinator?.close();
    this.viewerSyncCoordinator = undefined;
  }

  private activateViewerSync(): void {
    if (!this.scope || this.transitioning || !this.acceptingWrites) return;
    this.closeViewerSync();
    const generation = this.generation;
    this.viewerSyncCoordinator = new ViewerSyncCoordinator({
      generationFence: {
        generation,
        currentGeneration: () => this.generation,
      },
      onLifecycleEvent: event => this.forceClosed(event.cause),
    });
    this.viewerSyncCoordinator.setRuntimeState({
      foreground: this.foreground,
      online: this.online,
    });
  }

  /** Called once, after a final server identity has been verified. */
  initialize(scope: ViewerScope): void {
    const normalized = normalizeViewerScope(scope);
    if (this.scope) {
      if (!sameViewerScope(this.scope, normalized)) {
        throw new Error(
          'Use transition() before replacing an active Portico viewer scope.',
        );
      }
      return;
    }
    if (this.transitioning)
      throw new Error(
        'Portico is still clearing the previous viewing profile.',
      );
    resetViewerArtworkState();
    rotatePrivateArtworkCacheKey();
    this.scope = normalized;
    this.queryClient = createViewerQueryClient(normalized);
    this.acceptingWrites = true;
    this.activateViewerSync();
    setActiveDownloadViewerScope(normalized);
    void porticoDownloads.cleanupStaleAuthorizations().catch(() => undefined);
    this.transitionFailure = undefined;
    this.publish();
  }

  register(phase: ViewerRuntimePhase, hook: ViewerRuntimeHook): () => void {
    const hooks = this.hooks.get(phase) ?? new Set<ViewerRuntimeHook>();
    hooks.add(hook);
    this.hooks.set(phase, hooks);
    return () => hooks.delete(hook);
  }

  captureWrite(scope = this.scope): ViewerWriteToken {
    if (
      !scope ||
      !this.acceptingWrites ||
      this.transitioning ||
      !this.scope ||
      !sameViewerScope(scope, this.scope)
    ) {
      throw new Error(
        'Portico is not accepting writes for this viewing profile.',
      );
    }
    return {generation: this.generation, scopeKey: viewerScopeKey(this.scope)};
  }

  isWriteCurrent(token: ViewerWriteToken): boolean {
    return Boolean(
      this.scope &&
      this.acceptingWrites &&
      !this.transitioning &&
      token.generation === this.generation &&
      token.scopeKey === viewerScopeKey(this.scope),
    );
  }

  commitWrite(token: ViewerWriteToken, commit: () => void): boolean {
    if (!this.isWriteCurrent(token)) return false;
    commit();
    return true;
  }

  /**
   * Mutations and non-React-Query requests must use a lease so transition can
   * abort the transport and independently reject a late completion.
   */
  createRequestLease(scope = this.scope): ViewerRequestLease {
    const writeToken = this.captureWrite(scope);
    const controller = new AbortController();
    this.requestControllers.add(controller);
    let released = false;
    return {
      signal: controller.signal,
      writeToken,
      release: () => {
        if (released) return;
        released = true;
        this.requestControllers.delete(controller);
      },
    };
  }

  /**
   * Runs one viewer-owned request with both transport cancellation and a
   * generation fence. The result is never returned to UI owned by a viewer
   * that has since been replaced.
   */
  async runRequest<T>(
    operation: (signal: AbortSignal) => Promise<T>,
    scope = this.scope,
  ): Promise<T> {
    const lease = this.createRequestLease(scope);
    try {
      const result = await operation(lease.signal);
      if (!this.isWriteCurrent(lease.writeToken)) {
        throw new Error(
          'The active Portico profile changed before the request completed.',
        );
      }
      return result;
    } finally {
      lease.release();
    }
  }

  async transition(
    to: ViewerScope | undefined,
    reason: ProfileTransitionReason = 'profile-switch',
    beforeActivate?: (scope: ViewerScope) => void | Promise<void>,
  ): Promise<void> {
    const stage = await this.stage(to, reason);
    try {
      if (to) await beforeActivate?.(normalizeViewerScope(to));
      await stage.publish();
    } catch (cause) {
      await stage.rollback('restore-previous');
      throw cause;
    }
  }

  /**
   * Synchronously fences the old viewer, drains every producer, and returns a
   * transaction handle without exposing the candidate. Core publishes active
   * credentials and resolves durable storage before calling `publish`.
   */
  async stage(
    to: ViewerScope | undefined,
    reason: ProfileTransitionReason = 'profile-switch',
  ): Promise<StagedViewerRuntime> {
    if (this.transitioning)
      throw new Error('A Portico viewer transition is already in progress.');
    const previous = this.scope;
    const previousQueryState = previous
      ? dehydrate(this.queryClient, {
          shouldDehydrateMutation: () => false,
          shouldDehydrateQuery: query => query.state.status === 'success',
        })
      : undefined;
    const next = to ? normalizeViewerScope(to) : undefined;
    const stageId = ++this.stageSequence;
    this.activeStage = stageId;
    this.transitioning = true;
    this.transitionFailure = undefined;

    const beginFence = () => {
      this.closeViewerSync();
      resetViewerArtworkState();
      rotatePrivateArtworkCacheKey();
      this.generation += 1;
      this.acceptingWrites = false;
      setActiveDownloadViewerScope(undefined);
      this.publish();
    };

    if (!previous) {
      beginFence();
      return this.createStage(stageId, previous, next, previousQueryState);
    }

    this.publish();
    const adapter: ViewerRuntimeAdapter = {
      beginTransition: () => {
        // This fence is synchronous. Async work from the old profile cannot
        // commit while playback and realtime producers are being drained.
        beginFence();
      },
      cancelRequests: async (scope, transitionReason) => {
        for (const controller of this.requestControllers) controller.abort();
        this.requestControllers.clear();
        await this.queryClient.cancelQueries();
        await drainDownloadOperations(scope);
        await this.runHooks('requests', scope, transitionReason);
      },
      stopPlayback: (scope, transitionReason) =>
        this.runHooks('playback', scope, transitionReason),
      closeRealtime: (scope, transitionReason) =>
        this.runHooks('realtime', scope, transitionReason),
      clearOptimisticMutations: async scope => {
        this.queryClient.getMutationCache().clear();
        await this.runHooks('optimistic', scope, reason);
      },
      clearQueryCaches: async () => {
        this.queryClient.getQueryCache().clear();
      },
      clearArtworkState: scope => this.runHooks('artwork', scope, reason),
      closeOverlays: scope => this.runHooks('overlays', scope, reason),
      clearFocusRestoration: scope => this.runHooks('focus', scope, reason),
      clearProfileLocalState: scope =>
        this.runHooks('local-state', scope, reason),
    };

    try {
      // A fresh credential family for the same scope still needs a fence. Core
      // intentionally elides identical profile switches, so use the revision
      // transition reason to force teardown in that one case.
      const teardownReason =
        next && sameViewerScope(previous, next) && reason === 'profile-switch'
          ? 'authorization-changed'
          : reason;
      await transitionViewerRuntime(adapter, previous, next, teardownReason);
    } catch (cause) {
      this.forceClosed(cause);
      throw cause;
    }
    return this.createStage(stageId, previous, next, previousQueryState);
  }

  /**
   * Security teardown may fail, but the runtime must never retain an
   * authenticated viewer. This method performs a synchronous generation fence
   * and drops all publication state before best-effort asynchronous cleanup.
   */
  forceClosed(cause?: unknown): void {
    this.activeStage = undefined;
    this.closeViewerSync();
    resetViewerArtworkState();
    rotatePrivateArtworkCacheKey();
    this.generation += 1;
    this.acceptingWrites = false;
    this.transitioning = false;
    for (const controller of this.requestControllers) controller.abort();
    this.requestControllers.clear();
    void this.queryClient.cancelQueries().catch(() => undefined);
    this.queryClient.getMutationCache().clear();
    this.queryClient.getQueryCache().clear();
    this.scope = undefined;
    this.queryClient = createViewerQueryClient();
    setActiveDownloadViewerScope(undefined);
    this.transitionFailure =
      cause === undefined
        ? undefined
        : cause instanceof Error
          ? cause
          : new Error(String(cause));
    this.publish();
  }

  private createStage(
    stageId: number,
    previous: ViewerScope | undefined,
    next: ViewerScope | undefined,
    previousQueryState?: DehydratedState,
  ): StagedViewerRuntime {
    let published = false;
    let rolledBack = false;
    const ownsStage = () => this.activeStage === stageId;
    let rollbackFenced = false;
    const fencePublishedCandidate = () => {
      if (!published || rollbackFenced || !ownsStage()) return;
      rollbackFenced = true;
      this.closeViewerSync();
      resetViewerArtworkState();
      rotatePrivateArtworkCacheKey();
      this.generation += 1;
      this.acceptingWrites = false;
      this.transitioning = true;
      setActiveDownloadViewerScope(undefined);
      for (const controller of this.requestControllers) controller.abort();
      this.requestControllers.clear();
      void this.queryClient.cancelQueries().catch(() => undefined);
      this.queryClient.getMutationCache().clear();
      this.publish();
    };
    const activate = (
      scope: ViewerScope | undefined,
      queryState?: DehydratedState,
      failure?: unknown,
    ) => {
      this.scope = scope ? normalizeViewerScope(scope) : undefined;
      this.queryClient = createViewerQueryClient(this.scope);
      if (this.scope && queryState) hydrate(this.queryClient, queryState);
      this.acceptingWrites = Boolean(this.scope);
      this.transitioning = false;
      setActiveDownloadViewerScope(this.scope);
      if (this.scope) {
        void porticoDownloads
          .cleanupStaleAuthorizations()
          .catch(() => undefined);
      }
      this.activateViewerSync();
      this.transitionFailure =
        failure === undefined
          ? undefined
          : failure instanceof Error
            ? failure
            : new Error(String(failure));
      this.publish();
    };
    return {
      fence: fencePublishedCandidate,
      publish: () => {
        if (published || rolledBack || !ownsStage()) {
          const stale = new Error(
            'The viewer candidate was replaced before publication.',
          );
          stale.name = 'AbortError';
          throw stale;
        }
        published = true;
        activate(next);
      },
      rollback: async mode => {
        if (rolledBack || !ownsStage()) return;
        fencePublishedCandidate();
        rolledBack = true;
        if (mode === 'fail-closed') {
          this.forceClosed(
            new Error('Portico could not safely restore the previous viewer.'),
          );
          return;
        }
        try {
          if (published) {
            await this.queryClient.cancelQueries();
            this.queryClient.getMutationCache().clear();
            this.queryClient.getQueryCache().clear();
            if (next) await drainDownloadOperations(next);
          }
          this.activeStage = undefined;
          activate(previous, previousQueryState);
        } catch (cause) {
          this.forceClosed(cause);
          throw cause;
        }
      },
    };
  }

  private async runHooks(
    phase: ViewerRuntimePhase,
    scope: ViewerScope,
    reason: ProfileTransitionReason,
  ): Promise<void> {
    const hooks = [...(this.hooks.get(phase) ?? [])];
    const results = await Promise.allSettled(
      hooks.map(hook => hook(scope, reason)),
    );
    const failures = results.flatMap(result =>
      result.status === 'rejected' ? [result.reason] : [],
    );
    if (failures.length)
      throw new AggregateError(
        failures,
        `Portico viewer ${phase} teardown failed.`,
      );
  }

  private buildSnapshot(): ViewerRuntimeSnapshot {
    return {
      acceptingWrites: this.acceptingWrites,
      foreground: this.foreground,
      generation: this.generation,
      online: this.online,
      queryClient: this.queryClient,
      scope: this.scope,
      scopeKey: this.scope ? viewerScopeKey(this.scope) : undefined,
      transitioning: this.transitioning,
      transitionFailure: this.transitionFailure,
    };
  }

  private publish(): void {
    this.snapshot = this.buildSnapshot();
    this.listeners.forEach(listener => listener());
  }
}

const ViewerRuntimeContext = createContext<
  ViewerRuntimeCoordinator | undefined
>(undefined);

export function PorticoViewerRuntimeProvider({
  children,
  coordinator,
}: {
  children: React.ReactNode;
  coordinator?: ViewerRuntimeCoordinator;
}) {
  const runtimeRef = useRef<ViewerRuntimeCoordinator | null>(null);
  if (!runtimeRef.current)
    runtimeRef.current = coordinator ?? new ViewerRuntimeCoordinator();
  const runtime = runtimeRef.current;
  const snapshot = useSyncExternalStore(
    runtime.subscribe,
    runtime.getSnapshot,
    runtime.getSnapshot,
  );
  return (
    <ViewerRuntimeContext.Provider value={runtime}>
      <QueryClientProvider client={snapshot.queryClient}>
        <ViewerLifecycleBridge runtime={runtime} />
        {children}
      </QueryClientProvider>
    </ViewerRuntimeContext.Provider>
  );
}

function ViewerLifecycleBridge({runtime}: {runtime: ViewerRuntimeCoordinator}) {
  useEffect(() => {
    let cancelled = false;
    let removeNetInfoListener: (() => void) | undefined;
    const publishAppState = (state: AppStateStatus) => {
      const foreground = state === 'active';
      focusManager.setFocused(foreground);
      runtime.setLifecycleState({foreground});
    };
    publishAppState(AppState.currentState);
    const appState = AppState.addEventListener('change', publishAppState);
    void import('@react-native-community/netinfo')
      .then(({default: NetInfo}) => {
        if (cancelled) return;
        removeNetInfoListener = NetInfo.addEventListener(state => {
          const online =
            state.isConnected !== false &&
            state.isInternetReachable !== false;
          onlineManager.setOnline(online);
          runtime.setLifecycleState({online});
        });
      })
      .catch(() => {
        // Native reachability is an optimization. Transport failures remain
        // authoritative and the coordinator's bounded retry policy still
        // applies when the optional native bridge is unavailable.
      });
    return () => {
      cancelled = true;
      appState.remove();
      removeNetInfoListener?.();
      focusManager.setFocused(undefined);
      onlineManager.setOnline(true);
    };
  }, [runtime]);
  return null;
}

export function useViewerRuntime(): ViewerRuntimeCoordinator {
  const runtime = useContext(ViewerRuntimeContext);
  if (!runtime)
    throw new Error(
      'useViewerRuntime must be used inside PorticoViewerRuntimeProvider.',
    );
  return runtime;
}

export function useViewerRuntimeSnapshot(): ViewerRuntimeSnapshot {
  const runtime = useViewerRuntime();
  return useSyncExternalStore(
    runtime.subscribe,
    runtime.getSnapshot,
    runtime.getSnapshot,
  );
}
