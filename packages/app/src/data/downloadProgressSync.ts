import type {PorticoClient, ViewerScope} from '@portico/client-core';
import {
  downloadBelongsToScope,
  type PorticoDownload,
  type ScopedDownloadOperation,
} from '@portico-react-native/infrastructure';

export interface DownloadProgressStore {
  markPlaybackProgressSynced(
    id: string,
    operation?: ScopedDownloadOperation,
  ): Promise<PorticoDownload>;
}

export async function synchronizePendingDownloadProgress({
  cancelled = () => false,
  client,
  downloads,
  inFlight,
  store,
  viewerScope,
}: {
  cancelled?(): boolean;
  client: PorticoClient;
  downloads: readonly PorticoDownload[];
  inFlight: Set<string>;
  store: DownloadProgressStore;
  viewerScope: ViewerScope;
}): Promise<void> {
  for (const download of downloads) {
    if (
      cancelled() ||
      !downloadBelongsToScope(download, viewerScope) ||
      download.state !== 'completed' ||
      !download.playbackProgressPending ||
      typeof download.progressSeconds !== 'number' ||
      inFlight.has(download.id)
    )
      continue;
    inFlight.add(download.id);
    let sessionId: string | undefined;
    try {
      const playback = await client.startPlayback(download.mediaId, {
        startSeconds: Math.floor(download.progressSeconds),
      });
      sessionId = playback.sessionId;
      if (cancelled())
        throw new Error(
          'The active Portico profile changed before progress synchronization completed.',
        );
      const acknowledgement = await client.touchPlayback(sessionId, {
        completed: Boolean(download.playbackCompleted),
        durationSeconds: download.durationSeconds || undefined,
        progressSeconds: download.progressSeconds,
        state: 'paused',
      });
      if (cancelled())
        throw new Error(
          'The active Portico profile changed before progress synchronization completed.',
        );
      if (!acknowledgement.accepted || acknowledgement.stale)
        throw new Error('The server did not accept offline playback progress.');
      // A completed progress event closes its session server-side. Otherwise
      // close the temporary synchronization session deliberately.
      if (!download.playbackCompleted)
        await client.stopPlayback(sessionId).catch(() => undefined);
      sessionId = undefined;
      await store.markPlaybackProgressSynced(download.id, {
        isCurrent: () => !cancelled(),
        scope: viewerScope,
      });
    } catch {
      if (sessionId)
        await client.stopPlayback(sessionId).catch(() => undefined);
      // The durable native pending marker is retained for a later attempt.
    } finally {
      inFlight.delete(download.id);
    }
  }
}
