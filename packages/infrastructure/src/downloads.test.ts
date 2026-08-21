import type {ViewerScope} from '@porticomediaserver/client-core';
import {
  createScopedPorticoDownloadStore,
  drainDownloadOperations,
  downloadBelongsToScope,
  scopedNativeDownloadIdentifier,
  setActiveDownloadViewerScope,
  type NativeDownloadModule,
  type PorticoDownload,
} from './downloads';

const profileA: ViewerScope = {
  accountId: 'account-one',
  authority: 'hosted',
  authorizationRevision: 'revision-a',
  profileId: 'profile-a',
  serverId: 'server-one',
};
const profileB: ViewerScope = {
  ...profileA,
  authorizationRevision: 'revision-b',
  profileId: 'profile-b',
};

function download(
  scope: ViewerScope,
  overrides: Partial<PorticoDownload> = {},
): PorticoDownload {
  return {
    ...scope,
    bytesExpected: 100,
    bytesWritten: 100,
    clientIdentifier: 'media-one-source',
    createdAt: '2026-07-16T00:00:00.000Z',
    id: scopedNativeDownloadIdentifier(scope, 'media-one-source'),
    mediaId: 'media-one',
    preparationId: 'preparation-one',
    profile: 'source',
    progress: 1,
    state: 'completed',
    title: 'One',
    updatedAt: '2026-07-16T00:00:00.000Z',
    ...overrides,
  };
}

function native(
  overrides: Partial<NativeDownloadModule> = {},
): NativeDownloadModule {
  const record = download(profileA);
  return {
    enqueue: jest.fn().mockResolvedValue(record),
    cleanupStaleAuthorizations: jest
      .fn()
      .mockResolvedValue({bytesRemoved: 0, recordsRemoved: 0}),
    list: jest.fn().mockResolvedValue([record]),
    stagePreparation: jest.fn().mockResolvedValue(record),
    markPlaybackProgressSynced: jest.fn().mockResolvedValue(record),
    pause: jest.fn().mockResolvedValue(record),
    remove: jest.fn().mockResolvedValue(record),
    resume: jest.fn().mockResolvedValue(record),
    storageUsage: jest.fn().mockResolvedValue({bytes: 100, count: 1}),
    updatePlaybackProgress: jest.fn().mockResolvedValue(record),
    ...overrides,
  };
}

afterEach(() => setActiveDownloadViewerScope(undefined));

test('list filters other-profile and legacy unowned rows even if a native bridge returns them', async () => {
  const owned = download(profileA);
  const other = download(profileB);
  const legacy = {
    id: 'legacy',
    mediaId: 'media-one',
    title: 'Legacy',
    state: 'completed',
  };
  const bridge = native({
    list: jest.fn().mockResolvedValue([owned, other, legacy]),
  });
  const store = createScopedPorticoDownloadStore(bridge);
  store.activateScope(profileA);
  await expect(store.list()).resolves.toEqual([owned]);
  expect(downloadBelongsToScope(legacy, profileA)).toBe(false);
  expect(bridge.list).toHaveBeenCalledWith(profileA);
});

test('enqueue persists complete ownership and namespaces identifiers by viewer scope', async () => {
  let input: Record<string, unknown> | undefined;
  const bridge = native({
    enqueue: jest.fn().mockImplementation(async request => {
      input = request;
      return download(profileA, {
        clientIdentifier: request.clientIdentifier,
        id: request.id,
      });
    }),
  });
  const store = createScopedPorticoDownloadStore(bridge);
  store.activateScope(profileA);
  await store.enqueue({
    authorization: 'PorticoDownload grant',
    downloadURL: 'https://server/media?profile=source',
    expectedBytes: 100,
    storageLimitBytes: 1024 * 1024 * 1024,
    id: 'logical-id',
    mediaId: 'media-one',
    preparationId: 'preparation-one',
    profile: 'source',
    title: 'One',
  });
  expect(input).toMatchObject({...profileA, clientIdentifier: 'logical-id'});
  expect(input?.id).toBe(
    scopedNativeDownloadIdentifier(profileA, 'logical-id'),
  );
  expect(scopedNativeDownloadIdentifier(profileB, 'logical-id')).not.toBe(
    input?.id,
  );
});

test('stages server preparation durably before any credential or transfer exists', async () => {
  let input: Record<string, unknown> | undefined;
  const bridge = native({
    stagePreparation: jest.fn().mockImplementation(async request => {
      input = request;
      return download(profileA, {
        clientIdentifier: request.clientIdentifier,
        id: request.id,
        preparationId: request.preparationId,
        state: 'preparing',
      });
    }),
  });
  const store = createScopedPorticoDownloadStore(bridge);
  store.activateScope(profileA);
  await store.stagePreparation({
    id: 'logical-id',
    mediaId: 'media-one',
    preparationId: 'preparation-two',
    preparationProgress: 35,
    profile: 'mobile',
    state: 'preparing',
    title: 'One',
  });
  expect(input).toMatchObject({
    ...profileA,
    clientIdentifier: 'logical-id',
    preparationId: 'preparation-two',
    preparationProgress: 35,
  });
  expect(input).not.toHaveProperty('authorization');
  expect(input).not.toHaveProperty('downloadURL');
});

test('all record operations pass the active scope and reject mismatched bridge results', async () => {
  const bridge = native({
    pause: jest.fn().mockResolvedValue(download(profileB)),
  });
  const store = createScopedPorticoDownloadStore(bridge);
  store.activateScope(profileA);
  await expect(store.pause('download-id')).rejects.toThrow('does not belong');
  expect(bridge.pause).toHaveBeenCalledWith('download-id', profileA);
});

test('offline progress forwards attempt and revision ordering to the native durability boundary', async () => {
  const updatePlaybackProgress = jest.fn().mockResolvedValue(download(profileA));
  const store = createScopedPorticoDownloadStore(native({updatePlaybackProgress}));
  store.activateScope(profileA);
  await store.updatePlaybackProgress('download-id', 90, 100, true, undefined, {attempt: 12, revision: 4});
  expect(updatePlaybackProgress).toHaveBeenCalledWith(
    'download-id', 90, 100, true, {attempt: 12, revision: 4}, profileA,
  );
});

test('downloads fail closed until a verified viewer scope is active', async () => {
  const store = createScopedPorticoDownloadStore(native());
  await expect(store.list()).rejects.toThrow('Choose and unlock');
  await expect(store.storageUsage()).rejects.toThrow('Choose and unlock');
});

test('a delayed old-profile event cannot publish after the active profile changes', async () => {
  let event: (() => void) | undefined;
  let resolveOld!: (records: unknown[]) => void;
  const oldRead = new Promise<unknown[]>(resolve => {
    resolveOld = resolve;
  });
  const list = jest
    .fn()
    .mockImplementationOnce(() => oldRead)
    .mockResolvedValueOnce([download(profileB)]);
  const store = createScopedPorticoDownloadStore(native({list}), listener => {
    event = listener;
    return {remove: jest.fn()};
  });
  const listener = jest.fn();
  store.activateScope(profileA);
  const unsubscribe = store.subscribe(listener);
  store.activateScope(profileB);
  resolveOld([download(profileA)]);
  await Promise.resolve();
  await Promise.resolve();
  expect(listener).not.toHaveBeenCalled();
  event?.();
  await drainDownloadOperations(profileB);
  expect(listener).toHaveBeenCalledWith([download(profileB)]);
  unsubscribe();
});

test('a delayed native operation remains bound to its captured viewer and cannot commit after activation changes', async () => {
  let resolvePause!: (record: PorticoDownload) => void;
  const pauseResult = new Promise<PorticoDownload>(resolve => {
    resolvePause = resolve;
  });
  const bridge = native({pause: jest.fn().mockReturnValue(pauseResult)});
  const store = createScopedPorticoDownloadStore(bridge);
  store.activateScope(profileA);
  const operation = store.pause('download-id');
  store.activateScope(profileB);
  resolvePause(download(profileA));
  await expect(operation).rejects.toThrow('active Portico profile changed');
  expect(bridge.pause).toHaveBeenCalledWith('download-id', profileA);
});

test('transition draining awaits native operations already captured for the old viewer', async () => {
  let resolvePause!: (record: PorticoDownload) => void;
  const pauseResult = new Promise<PorticoDownload>(resolve => {
    resolvePause = resolve;
  });
  const store = createScopedPorticoDownloadStore(
    native({pause: jest.fn().mockReturnValue(pauseResult)}),
  );
  store.activateScope(profileA);
  const operation = store.pause('download-id');
  let drained = false;
  const drain = drainDownloadOperations(profileA).then(() => {
    drained = true;
  });
  await Promise.resolve();
  expect(drained).toBe(false);
  resolvePause(download(profileA));
  await operation;
  await drain;
  expect(drained).toBe(true);
});

test('stale authorization cleanup is exact to authority account server and profile', async () => {
  const cleanup = jest
    .fn()
    .mockResolvedValue({bytesRemoved: 500, recordsRemoved: 2});
  const store = createScopedPorticoDownloadStore(
    native({cleanupStaleAuthorizations: cleanup}),
  );
  store.activateScope(profileB);
  await expect(store.cleanupStaleAuthorizations()).resolves.toEqual({
    bytesRemoved: 500,
    recordsRemoved: 2,
  });
  expect(cleanup).toHaveBeenCalledWith(profileB);
});
