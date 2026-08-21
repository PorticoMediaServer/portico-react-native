import {
  porticoDownloads,
  type PorticoDownload,
} from '@portico-react-native/infrastructure';
import {
  availableDownloadOptions,
  completedDownloadForMedia,
  downloadIdentifier,
  enqueueMediaDownload,
  offlinePlaybackStart,
  resumeStagedNativeDownloads,
  retryableDownload,
} from './downloads';

function download(overrides: Partial<PorticoDownload> = {}): PorticoDownload {
  return {
    accountId: 'account-one',
    authority: 'hosted',
    authorizationRevision: 'revision-one',
    clientIdentifier: 'media-one',
    id: 'media-one',
    mediaId: 'one',
    preparationId: 'preparation-one',
    profile: 'source',
    profileId: 'profile-one',
    serverId: 'server-one',
    title: 'One',
    state: 'completed',
    bytesWritten: 100,
    bytesExpected: 100,
    progress: 1,
    localURL: 'file:///one.mp4',
    createdAt: '2026-07-01T00:00:00.000Z',
    updatedAt: '2026-07-01T00:00:00.000Z',
    ...overrides,
  };
}

test('keeps server-preparable optimized download choices first-class', () => {
  expect(
    availableDownloadOptions([
      {
        id: 'source',
        kind: 'source',
        label: 'Original',
        available: true,
        profile: 'source',
      },
      {
        id: 'future',
        kind: 'optimized',
        label: 'Mobile',
        available: false,
        profile: 'mobile',
      },
      {
        id: 'job',
        kind: 'optimized',
        label: 'Create mobile',
        available: false,
        profile: 'mobile',
        requiresOptimizedVersion: true,
      },
    ]),
  ).toEqual([
    {
      id: 'source',
      kind: 'source',
      label: 'Original',
      available: true,
      profile: 'source',
    },
    {
      id: 'job',
      kind: 'optimized',
      label: 'Create mobile',
      available: false,
      profile: 'mobile',
      requiresOptimizedVersion: true,
    },
  ]);
});

test('foreground recovery resumes a durable preparation through grant and transfer admission', async () => {
  const preparing = download({state: 'preparing'});
  const stagePreparation = jest
    .spyOn(porticoDownloads, 'stagePreparation')
    .mockResolvedValue(preparing);
  const enqueue = jest
    .spyOn(porticoDownloads, 'enqueue')
    .mockResolvedValue(download({state: 'queued'}));
  const client = {
    downloadPreparation: jest.fn().mockResolvedValue({
      id: 'preparation-one',
      mediaId: 'one',
      mediaTitle: 'One',
      qualityProfile: 'source',
      state: 'ready',
      progress: 100,
      sizeBytes: 2048,
      sizeKind: 'exact',
    }),
    createDownloadPreparationGrant: jest.fn().mockResolvedValue({
      downloadUrl: '/api/media/one/download?profile=source',
      grantToken: 'recovery-grant',
      expiresAt: new Date(Date.now() + 60_000).toISOString(),
      profile: 'source',
    }),
    resourceUrl: (value: string) => `https://server.test${value}`,
  };
  await resumeStagedNativeDownloads(
    client as never,
    {
      scope: {
        accountId: 'account-one',
        authority: 'hosted',
        authorizationRevision: 'revision-one',
        profileId: 'profile-one',
        serverId: 'server-one',
      },
    },
    [preparing],
  );
  expect(client.downloadPreparation).toHaveBeenCalledWith(
    'preparation-one',
    expect.any(Object),
  );
  expect(enqueue).toHaveBeenCalledWith(
    expect.objectContaining({
      authorization: 'PorticoDownload recovery-grant',
      expectedBytes: 2048,
      preparationId: 'preparation-one',
    }),
    expect.any(Object),
  );
  stagePreparation.mockRestore();
  enqueue.mockRestore();
});

test('download identifiers are stable and contain no media path data', () => {
  const first = downloadIdentifier('movie/fargo/../../private', 'source');
  expect(first).toMatch(/^media-[a-f0-9]{8}$/);
  expect(downloadIdentifier('movie/fargo/../../private', 'source')).toBe(first);
  expect(downloadIdentifier('movie/fargo/../../private', 'mobile')).not.toBe(
    first,
  );
});

test('only terminal transfer failures are retried with a new download grant', () => {
  expect(retryableDownload(download({state: 'failed'}))).toBe(true);
  expect(retryableDownload(download({state: 'expired'}))).toBe(true);
  expect(retryableDownload(download({state: 'unavailable'}))).toBe(true);
  expect(retryableDownload(download({state: 'paused'}))).toBe(false);
  expect(retryableDownload(download({state: 'completed'}))).toBe(false);
});

test('offline playback chooses the newest valid local copy for exactly the requested media', () => {
  const older = download({id: 'older', updatedAt: '2026-07-01T00:00:00.000Z'});
  const newer = download({
    id: 'newer',
    profile: 'mobile',
    updatedAt: '2026-07-02T00:00:00.000Z',
  });
  const missing = download({
    id: 'missing',
    localURL: undefined,
    updatedAt: '2026-07-03T00:00:00.000Z',
  });
  const other = download({
    id: 'other',
    mediaId: 'two',
    updatedAt: '2026-07-04T00:00:00.000Z',
  });
  expect(
    completedDownloadForMedia([older, newer, missing, other], 'one'),
  ).toEqual(newer);
});

test('offline playback resumes incomplete media but restarts completed or invalid progress', () => {
  expect(
    offlinePlaybackStart(download({progressSeconds: 91, durationSeconds: 600})),
  ).toBe(91);
  expect(
    offlinePlaybackStart(
      download({progressSeconds: 600, durationSeconds: 600}),
    ),
  ).toBe(0);
  expect(
    offlinePlaybackStart(
      download({
        progressSeconds: 91,
        durationSeconds: 600,
        playbackCompleted: true,
      }),
    ),
  ).toBe(0);
  expect(offlinePlaybackStart(download({progressSeconds: Number.NaN}))).toBe(0);
});

test('a preparation created for profile A cannot enqueue a profile B-owned native record after a switch', async () => {
  let resolvePreparation!: (value: Record<string, unknown>) => void;
  const preparation = new Promise<Record<string, unknown>>(resolve => {
    resolvePreparation = resolve;
  });
  const list = jest.spyOn(porticoDownloads, 'list').mockResolvedValue([]);
  const enqueue = jest
    .spyOn(porticoDownloads, 'enqueue')
    .mockRejectedValue(new Error('must not enqueue'));
  let current = true;
  const operation = enqueueMediaDownload(
    {
      createDownloadPreparation: jest.fn().mockReturnValue(preparation),
      resourceUrl: (value: string) => `https://server.test${value}`,
    } as never,
    {id: 'one', title: 'One'} as never,
    {
      available: true,
      id: 'source',
      kind: 'source',
      label: 'Original',
      profile: 'source',
    },
    {
      isCurrent: () => current,
      scope: {
        accountId: 'account-one',
        authority: 'hosted',
        authorizationRevision: 'revision-a',
        profileId: 'profile-a',
        serverId: 'server-one',
      },
    },
  );
  current = false;
  resolvePreparation({
    id: 'preparation-one',
    mediaId: 'one',
    mediaTitle: 'One',
    qualityProfile: 'source',
    state: 'ready',
    progress: 100,
    sizeBytes: 100,
    sizeKind: 'exact',
  });
  await expect(operation).rejects.toThrow('active Portico profile changed');
  expect(enqueue).not.toHaveBeenCalled();
  list.mockRestore();
  enqueue.mockRestore();
});

test('ready server preparation enqueues a clean URL with scoped authorization', async () => {
  const list = jest.spyOn(porticoDownloads, 'list').mockResolvedValue([]);
  const stagePreparation = jest
    .spyOn(porticoDownloads, 'stagePreparation')
    .mockResolvedValue(download({state: 'preparing'}));
  const enqueue = jest.spyOn(porticoDownloads, 'enqueue').mockResolvedValue(
    download({state: 'queued'}),
  );
  const client = {
    createDownloadPreparation: jest.fn().mockResolvedValue({
      id: 'preparation-one',
      mediaId: 'one',
      mediaTitle: 'One',
      qualityProfile: 'mobile',
      state: 'ready',
      progress: 100,
      sizeBytes: 720,
      sizeKind: 'exact',
    }),
    createDownloadPreparationGrant: jest.fn().mockResolvedValue({
      downloadUrl: '/api/media/one/download?profile=mobile',
      grantToken: 'scoped-secret',
      expiresAt: new Date(Date.now() + 60_000).toISOString(),
      profile: 'mobile',
    }),
    resourceUrl: (value: string) => `https://server.test${value}`,
  };
  await enqueueMediaDownload(
    client as never,
    {id: 'one', title: 'One'} as never,
    {id: 'optimized-mobile', kind: 'optimized', label: 'Mobile', available: false, requiresOptimizedVersion: true, profile: 'mobile'},
    {
      scope: {
        accountId: 'account-one', authority: 'hosted', authorizationRevision: 'revision-a', profileId: 'profile-a', serverId: 'server-one',
      },
    },
  );
  expect(enqueue).toHaveBeenCalledWith(
    expect.objectContaining({
      authorization: 'PorticoDownload scoped-secret',
      downloadURL: 'https://server.test/api/media/one/download?profile=mobile',
      expectedBytes: 720,
      preparationId: 'preparation-one',
      storageLimitBytes: 20 * 1024 * 1024 * 1024,
    }),
    expect.any(Object),
  );
  list.mockRestore();
  stagePreparation.mockRestore();
  enqueue.mockRestore();
});

test('queued preparation returns its durable native row without polling or requesting a grant', async () => {
  const staged = download({state: 'preparing', preparationProgress: 8});
  const list = jest.spyOn(porticoDownloads, 'list').mockResolvedValue([]);
  const stagePreparation = jest
    .spyOn(porticoDownloads, 'stagePreparation')
    .mockResolvedValue(staged);
  const enqueue = jest.spyOn(porticoDownloads, 'enqueue');
  const client = {
    createDownloadPreparation: jest.fn().mockResolvedValue({
      id: 'preparation-one',
      mediaId: 'one',
      mediaTitle: 'One',
      qualityProfile: 'mobile',
      state: 'running',
      progress: 8,
    }),
    createDownloadPreparationGrant: jest.fn(),
  };
  await expect(
    enqueueMediaDownload(
      client as never,
      {id: 'one', title: 'One'} as never,
      {
        available: false,
        id: 'optimized-mobile',
        kind: 'optimized',
        label: 'Mobile',
        profile: 'mobile',
        requiresOptimizedVersion: true,
      },
      {
        scope: {
          accountId: 'account-one',
          authority: 'hosted',
          authorizationRevision: 'revision-a',
          profileId: 'profile-a',
          serverId: 'server-one',
        },
      },
    ),
  ).resolves.toBe(staged);
  expect(client.createDownloadPreparationGrant).not.toHaveBeenCalled();
  expect(enqueue).not.toHaveBeenCalled();
  list.mockRestore();
  stagePreparation.mockRestore();
  enqueue.mockRestore();
});
