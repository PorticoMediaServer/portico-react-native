import type {ViewerScope} from '@portico/client-core';
import {
  activeDownloadViewerScope,
  setActiveDownloadViewerScope,
} from './downloads';
import {
  ViewerRuntimeCoordinator,
  viewerQueryKey,
  viewerQueryPrefix,
} from './viewerRuntime';
import {privateArtworkCacheKey} from './serverResource';

const profileA: ViewerScope = {
  accountId: 'account-one',
  authority: 'hosted',
  authorizationRevision: 'authorization-a',
  profileId: 'profile-a',
  serverId: 'server-one',
};
const profileB: ViewerScope = {
  ...profileA,
  authorizationRevision: 'authorization-b',
  profileId: 'profile-b',
};

const testRuntimes = new Set<ViewerRuntimeCoordinator>();

function createTestRuntime(): ViewerRuntimeCoordinator {
  const runtime = new ViewerRuntimeCoordinator();
  testRuntimes.add(runtime);
  return runtime;
}

afterEach(() => {
  for (const runtime of testRuntimes) runtime.forceClosed();
  testRuntimes.clear();
  setActiveDownloadViewerScope(undefined);
});

test('query keys begin with the complete viewer scope and include a canonical resource key', () => {
  expect(viewerQueryPrefix(profileA)).toEqual([
    'portico',
    'v1',
    'hosted',
    'account-one',
    'server-one',
    'profile-a',
    'authorization-a',
  ]);
  const key = viewerQueryKey(profileA, 'home', {row: 'continue-watching'});
  expect(key.slice(0, 8)).toEqual([
    'portico',
    'v1',
    'hosted',
    'account-one',
    'server-one',
    'profile-a',
    'authorization-a',
    'home',
  ]);
  expect(typeof key[8]).toBe('string');
});

test('private artwork cache keys rotate at the viewer fence without exposing identity fields', async () => {
  const before = privateArtworkCacheKey(profileA);
  const runtime = createTestRuntime();
  runtime.initialize(profileA);
  const initialized = privateArtworkCacheKey(profileA);
  await runtime.transition(profileB);
  const switched = privateArtworkCacheKey(profileB);

  expect(initialized).not.toBe(before);
  expect(switched).not.toBe(initialized);
  expect(switched).not.toContain(profileB.accountId);
  expect(switched).not.toContain(profileB.profileId);
});

test('owns one viewer sync coordinator per generation and closes it at the synchronous transition fence', async () => {
  const runtime = createTestRuntime();
  runtime.initialize(profileA);
  runtime.setLifecycleState({foreground: true, online: true});
  const firstSync = runtime.viewerSync();
  expect(firstSync).toBeDefined();
  let streamSignal: AbortSignal | undefined;
  firstSync!.leaseSubscription({
    key: 'application',
    start: signal => {
      streamSignal = signal as AbortSignal;
      return new Promise<void>(resolve => signal.addEventListener('abort', resolve, {once: true}));
    },
  });
  await Promise.resolve();
  const transition = runtime.transition(profileB);
  expect(streamSignal?.aborted).toBe(true);
  expect(firstSync?.isCurrent).toBe(false);
  await transition;
  expect(runtime.viewerSync()).toBeDefined();
  expect(runtime.viewerSync()).not.toBe(firstSync);
  expect(runtime.viewerSync()?.isCurrent).toBe(true);
  runtime.forceClosed();
});

test('runtime resume performs one coordinator-owned active-resource reconciliation', async () => {
  const runtime = createTestRuntime();
  runtime.initialize(profileA);
  const refresh = jest.fn();
  runtime.viewerSync()!.registerResource({key: 'query-cache', tags: ['*'], refresh});
  runtime.setLifecycleState({foreground: false, online: true});
  runtime.setLifecycleState({foreground: true, online: true});
  runtime.setLifecycleState({foreground: true, online: true});
  await Promise.resolve();
  expect(refresh).toHaveBeenCalledTimes(1);
  expect([...refresh.mock.calls[0][0].tags]).toContain('runtime:reconcile');
  runtime.forceClosed();
});

test('terminal sync authorization fails the active viewer closed without a reconnect loop', async () => {
  const runtime = createTestRuntime();
  runtime.initialize(profileA);
  runtime.setLifecycleState({foreground: true, online: true});
  const start = jest.fn(async () => {
    throw Object.assign(new Error('expired'), {status: 401});
  });
  runtime.viewerSync()!.leaseSubscription({key: 'application', start});
  await Promise.resolve();
  await Promise.resolve();
  expect(start).toHaveBeenCalledTimes(1);
  expect(runtime.getSnapshot().scope).toBeUndefined();
  expect(runtime.getSnapshot().acceptingWrites).toBe(false);
  expect(runtime.getSnapshot().transitionFailure).toBeInstanceOf(Error);
});

test('a profile transition fences delayed old-profile query and mutation commits synchronously', async () => {
  const runtime = createTestRuntime();
  runtime.initialize(profileA);
  const oldClient = runtime.getSnapshot().queryClient;
  oldClient.setQueryData(['home'], {title: 'Profile A'});
  oldClient
    .getMutationCache()
    .build(oldClient, {gcTime: Infinity, mutationFn: async () => 'old mutation'});
  const token = runtime.captureWrite();
  const request = runtime.createRequestLease();
  let visible = 'Profile A';
  let releasePlayback!: () => void;
  const playbackClosed = new Promise<void>(resolve => {
    releasePlayback = resolve;
  });
  runtime.register('playback', () => playbackClosed);

  const transition = runtime.transition(profileB);
  expect(runtime.getSnapshot().transitioning).toBe(true);
  expect(runtime.isWriteCurrent(token)).toBe(false);
  expect(
    runtime.commitWrite(token, () => {
      visible = 'leaked';
    }),
  ).toBe(false);
  expect(visible).toBe('Profile A');
  await Promise.resolve();
  expect(request.signal.aborted).toBe(true);
  expect(
    runtime.commitWrite(request.writeToken, () => {
      visible = 'late mutation';
    }),
  ).toBe(false);

  releasePlayback();
  await transition;
  expect(runtime.getSnapshot().scope).toEqual(profileB);
  expect(runtime.getSnapshot().queryClient).not.toBe(oldClient);
  expect(oldClient.getQueryCache().getAll()).toHaveLength(0);
  expect(oldClient.getMutationCache().getAll()).toHaveLength(0);
  expect(activeDownloadViewerScope()).toEqual(profileB);
  oldClient.clear();
  runtime.forceClosed();
});

test('playback, realtime, artwork, overlay, focus, and local state hooks are awaited before activation', async () => {
  const runtime = createTestRuntime();
  runtime.initialize(profileA);
  const phases: string[] = [];
  for (const phase of [
    'playback',
    'realtime',
    'artwork',
    'overlays',
    'focus',
    'local-state',
  ] as const) {
    runtime.register(phase, async () => {
      phases.push(phase);
    });
  }
  await runtime.transition(profileB);
  expect(phases).toEqual(
    expect.arrayContaining([
      'playback',
      'realtime',
      'artwork',
      'overlays',
      'focus',
      'local-state',
    ]),
  );
  expect(runtime.getSnapshot().acceptingWrites).toBe(true);
});

test('a teardown failure refuses activation and clears the runtime fail closed', async () => {
  const runtime = createTestRuntime();
  runtime.initialize(profileA);
  runtime.register('realtime', async () => {
    throw new Error('SSE would not close');
  });

  await expect(runtime.transition(profileB)).rejects.toThrow('safely clear');
  expect(runtime.getSnapshot().scope).toBeUndefined();
  expect(runtime.getSnapshot().acceptingWrites).toBe(false);
  expect(runtime.getSnapshot().transitionFailure).toBeInstanceOf(Error);
  expect(activeDownloadViewerScope()).toBeUndefined();
  expect(() => runtime.captureWrite()).toThrow('not accepting writes');
});

test('sign-out clears the scoped query client and never reactivates the old profile', async () => {
  const runtime = createTestRuntime();
  runtime.initialize(profileA);
  const oldClient = runtime.getSnapshot().queryClient;
  oldClient.setQueryData(['saved'], ['private']);
  await runtime.transition(undefined, 'sign-out');
  expect(runtime.getSnapshot().scope).toBeUndefined();
  expect(runtime.getSnapshot().acceptingWrites).toBe(false);
  expect(runtime.getSnapshot().queryClient).not.toBe(oldClient);
  expect(oldClient.getQueryCache().getAll()).toHaveLength(0);
});

test('runRequest aborts transport and rejects a late old-viewer result', async () => {
  const runtime = createTestRuntime();
  runtime.initialize(profileA);
  let resolveRequest!: (value: string) => void;
  let requestSignal!: AbortSignal;
  const operation = runtime.runRequest(signal => {
    requestSignal = signal;
    return new Promise<string>(resolve => {
      resolveRequest = resolve;
    });
  });

  await runtime.transition(profileB);
  expect(requestSignal.aborted).toBe(true);
  resolveRequest('private old-profile result');

  await expect(operation).rejects.toThrow('active Portico profile changed');
});

test('refuses replacement activation when its staged credential commit fails', async () => {
  const runtime = createTestRuntime();
  runtime.initialize(profileA);

  await expect(
    runtime.transition(profileB, 'profile-switch', async () => {
      throw new Error('Keychain write failed');
    }),
  ).rejects.toThrow('Keychain write failed');

  expect(runtime.getSnapshot().scope).toEqual(profileA);
  expect(runtime.getSnapshot().acceptingWrites).toBe(true);
  expect(runtime.getSnapshot().transitionFailure).toBeUndefined();
  expect(activeDownloadViewerScope()).toEqual(profileA);
});

test('stages a candidate behind a generation fence until explicit publication', async () => {
  const runtime = createTestRuntime();
  runtime.initialize(profileA);
  const token = runtime.captureWrite();

  const staged = await runtime.stage(profileB);

  expect(runtime.getSnapshot().scope).toEqual(profileA);
  expect(runtime.getSnapshot().transitioning).toBe(true);
  expect(runtime.getSnapshot().acceptingWrites).toBe(false);
  expect(runtime.isWriteCurrent(token)).toBe(false);

  await staged.publish();
  expect(runtime.getSnapshot().scope).toEqual(profileB);
  expect(runtime.getSnapshot().acceptingWrites).toBe(true);
});

test('restores the prior scoped runtime and query snapshot when rollback follows publication', async () => {
  const runtime = createTestRuntime();
  runtime.initialize(profileA);
  runtime.getSnapshot().queryClient.setQueryData(['home'], {
    title: 'Profile A',
  });
  const staged = await runtime.stage(profileB);

  await staged.publish();
  const candidateWrite = runtime.captureWrite();
  expect(runtime.getSnapshot().scope).toEqual(profileB);

  const rollback = staged.rollback('restore-previous');

  expect(runtime.getSnapshot().transitioning).toBe(true);
  expect(runtime.getSnapshot().acceptingWrites).toBe(false);
  expect(() => runtime.captureWrite()).toThrow(
    'Portico is not accepting writes for this viewing profile.',
  );

  await rollback;
  await staged.rollback('restore-previous');

  expect(runtime.getSnapshot().scope).toEqual(profileA);
  expect(runtime.getSnapshot().acceptingWrites).toBe(true);
  expect(runtime.getSnapshot().transitionFailure).toBeUndefined();
  expect(runtime.getSnapshot().queryClient.getQueryData(['home'])).toEqual({
    title: 'Profile A',
  });
  expect(runtime.isWriteCurrent(candidateWrite)).toBe(false);
  expect(activeDownloadViewerScope()).toEqual(profileA);
});

test('rejects stale staged publication after a force-closed security fence', async () => {
  const runtime = createTestRuntime();
  runtime.initialize(profileA);
  const staged = await runtime.stage(profileB);

  runtime.forceClosed(new Error('credential rollback became uncertain'));

  await expect(
    Promise.resolve().then(() => staged.publish()),
  ).rejects.toMatchObject({
    name: 'AbortError',
  });
  expect(runtime.getSnapshot().scope).toBeUndefined();
  expect(runtime.getSnapshot().acceptingWrites).toBe(false);
});
