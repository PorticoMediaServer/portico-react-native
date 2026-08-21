import type {PorticoClient} from '@portico/client-core';
import type {PorticoDownload} from '@portico-react-native/infrastructure';
import {
  synchronizePendingDownloadProgress,
  type DownloadProgressStore,
} from './downloadProgressSync';

const baseDownload: PorticoDownload = {
  accountId: 'account-one',
  authority: 'hosted',
  authorizationRevision: 'revision-one',
  clientIdentifier: 'download-one',
  id: 'download-one',
  mediaId: 'media-one',
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
  durationSeconds: 600,
  progressSeconds: 91.8,
  playbackProgressPending: true,
};
const viewerScope = {
  accountId: baseDownload.accountId,
  authority: baseDownload.authority,
  authorizationRevision: baseDownload.authorizationRevision,
  profileId: baseDownload.profileId,
  serverId: baseDownload.serverId,
} as const;

function harness(
  acknowledgement: {accepted: boolean; stale: boolean} = {
    accepted: true,
    stale: false,
  },
) {
  const startPlayback = jest
    .fn()
    .mockResolvedValue({sessionId: 'sync-session'});
  const touchPlayback = jest.fn().mockResolvedValue(acknowledgement);
  const stopPlayback = jest.fn().mockResolvedValue({ok: true});
  const markPlaybackProgressSynced = jest
    .fn()
    .mockResolvedValue({...baseDownload, playbackProgressPending: false});
  return {
    client: {
      startPlayback,
      touchPlayback,
      stopPlayback,
    } as unknown as PorticoClient,
    markPlaybackProgressSynced,
    startPlayback,
    stopPlayback,
    store: {markPlaybackProgressSynced} as DownloadProgressStore,
    touchPlayback,
  };
}

test('acknowledged offline progress closes its temporary session and clears the native pending marker', async () => {
  const test = harness();
  await synchronizePendingDownloadProgress({
    client: test.client,
    downloads: [baseDownload],
    inFlight: new Set(),
    store: test.store,
    viewerScope,
  });
  expect(test.startPlayback).toHaveBeenCalledWith('media-one', {
    startSeconds: 91,
  });
  expect(test.touchPlayback).toHaveBeenCalledWith(
    'sync-session',
    expect.objectContaining({progressSeconds: 91.8, state: 'paused'}),
  );
  expect(test.stopPlayback).toHaveBeenCalledWith('sync-session');
  expect(test.markPlaybackProgressSynced).toHaveBeenCalledWith(
    'download-one',
    expect.objectContaining({scope: viewerScope}),
  );
});

test('completed offline progress relies on the completion event to close the server session', async () => {
  const test = harness();
  await synchronizePendingDownloadProgress({
    client: test.client,
    downloads: [{...baseDownload, playbackCompleted: true}],
    inFlight: new Set(),
    store: test.store,
    viewerScope,
  });
  expect(test.stopPlayback).not.toHaveBeenCalled();
  expect(test.markPlaybackProgressSynced).toHaveBeenCalledWith(
    'download-one',
    expect.objectContaining({scope: viewerScope}),
  );
});

test('rejected progress remains pending and the temporary session is still cleaned up', async () => {
  const test = harness({accepted: false, stale: true});
  await synchronizePendingDownloadProgress({
    client: test.client,
    downloads: [baseDownload],
    inFlight: new Set(),
    store: test.store,
    viewerScope,
  });
  expect(test.stopPlayback).toHaveBeenCalledWith('sync-session');
  expect(test.markPlaybackProgressSynced).not.toHaveBeenCalled();
});

test('non-pending and already in-flight downloads are not synchronized twice', async () => {
  const test = harness();
  await synchronizePendingDownloadProgress({
    client: test.client,
    downloads: [
      {...baseDownload, playbackProgressPending: false},
      baseDownload,
    ],
    inFlight: new Set(['download-one']),
    store: test.store,
    viewerScope,
  });
  expect(test.startPlayback).not.toHaveBeenCalled();
});

test('progress owned by another profile is never sent to the active profile server session', async () => {
  const test = harness();
  await synchronizePendingDownloadProgress({
    client: test.client,
    downloads: [{...baseDownload, profileId: 'profile-two'}],
    inFlight: new Set(),
    store: test.store,
    viewerScope,
  });
  expect(test.startPlayback).not.toHaveBeenCalled();
});

test('a profile change after starting a temporary sync session stops it before progress is written', async () => {
  const test = harness();
  let cancelled = false;
  test.startPlayback.mockImplementationOnce(async () => {
    cancelled = true;
    return {sessionId: 'sync-session'};
  });
  await synchronizePendingDownloadProgress({
    cancelled: () => cancelled,
    client: test.client,
    downloads: [baseDownload],
    inFlight: new Set(),
    store: test.store,
    viewerScope,
  });
  expect(test.touchPlayback).not.toHaveBeenCalled();
  expect(test.stopPlayback).toHaveBeenCalledWith('sync-session');
  expect(test.markPlaybackProgressSynced).not.toHaveBeenCalled();
});
