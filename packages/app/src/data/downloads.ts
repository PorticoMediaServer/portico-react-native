import type {
  DownloadOption,
  DownloadPreparation,
  MediaItem,
  PorticoClient,
} from '@porticomediaserver/client-core';
import {NativeDownloadWorkflowError} from '@porticomediaserver/client-core';
import {
  appleInstallationPreferences,
  defaultAppleInstallationPreferences,
  porticoDownloads,
  type PorticoDownload,
  type ScopedDownloadOperation,
} from '@portico-react-native/infrastructure';

export function availableDownloadOptions(
  options: DownloadOption[],
): DownloadOption[] {
  return options.filter(
    option =>
      (option.available ||
        (option.kind === 'optimized' && option.requiresOptimizedVersion)) &&
      Boolean(option.profile || option.id),
  );
}

export function retryableDownload(download: PorticoDownload): boolean {
  return (
    download.state === 'failed' ||
    download.state === 'expired' ||
    download.state === 'unavailable'
  );
}

export function completedDownloadForMedia(
  downloads: readonly PorticoDownload[],
  mediaId: string,
): PorticoDownload | undefined {
  return downloads
    .filter(
      download =>
        download.mediaId === mediaId &&
        download.state === 'completed' &&
        Boolean(download.localURL),
    )
    .sort((left, right) => right.updatedAt.localeCompare(left.updatedAt))[0];
}

export function offlinePlaybackStart(download: PorticoDownload): number {
  if (download.playbackCompleted) return 0;
  const position = download.progressSeconds ?? 0;
  const duration = download.durationSeconds ?? 0;
  if (!Number.isFinite(position) || position < 0) return 0;
  if (duration > 0 && position >= duration) return 0;
  return position;
}

export async function enqueueMediaDownload(
  client: PorticoClient,
  media: MediaItem,
  option: DownloadOption,
  operation: ScopedDownloadOperation & {signal?: AbortSignal},
): Promise<PorticoDownload> {
  const profile = option.profile || option.id;
  const id = downloadIdentifier(media.id, profile);
  const existing = (await porticoDownloads.list(operation)).find(
    download => download.clientIdentifier === id,
  );
  if (existing && existing.state !== 'preparing' && !retryableDownload(existing))
    return existing;
  assertDownloadOperationCurrent(operation);
  let preparation =
    existing?.state === 'preparing' && existing.preparationId
      ? await client.downloadPreparation(existing.preparationId, {
          signal: operation.signal,
        })
      : await client.createDownloadPreparation(
          {mediaId: media.id, qualityProfile: profile},
          {signal: operation.signal},
        );
  assertDownloadOperationCurrent(operation);
  if (
    preparation.state === 'paused' ||
    preparation.state === 'cancelled' ||
    preparation.state === 'failed' ||
    preparation.state === 'unavailable'
  ) {
    preparation = await client.updateDownloadPreparation(
      preparation.id,
      {action: 'retry'},
      {signal: operation.signal},
    );
  }
  const staged = await stageNativePreparation(
    id,
    media.id,
    profile,
    media.title,
    media.grandparentTitle ?? media.parentTitle,
    preparation,
    operation,
  );
  assertDownloadOperationCurrent(operation);
  // Preparation is durable server-owned work. Never hold an interactive
  // request open while it queues/transcodes; the lifecycle scheduler performs
  // bounded refreshes and starts the native transfer when it becomes ready.
  if (preparation.state === 'queued' || preparation.state === 'running') {
    return staged;
  }
  if (preparation.state !== 'ready') {
    throw new NativeDownloadWorkflowError('preparation_not_ready');
  }
  const grant = await client.createDownloadPreparationGrant(preparation.id, {
    signal: operation.signal,
  });
  assertDownloadOperationCurrent(operation);
  if (
    !grant.grantToken ||
    !grant.downloadUrl ||
    grant.profile !== preparation.qualityProfile ||
    Date.parse(grant.expiresAt) <= Date.now()
  ) {
    throw new NativeDownloadWorkflowError('grant_invalid');
  }
  const expectedBytes = positiveBytes(preparation.sizeBytes);
  if (expectedBytes === undefined) {
    // Native background transfers must reserve a bounded amount before they
    // begin. The server will expose a measured or conservative prepared size
    // when it is safe to admit this job.
    throw new NativeDownloadWorkflowError(
      'preparation_not_ready',
      'download.storage-full',
    );
  }
  const downloadURL = client.resourceUrl(grant.downloadUrl);
  return porticoDownloads.enqueue(
    {
      id,
      mediaId: media.id,
      profile,
      preparationId: preparation.id,
      title: media.title,
      subtitle: media.grandparentTitle ?? media.parentTitle,
      downloadURL,
      authorization: `PorticoDownload ${grant.grantToken}`,
      expectedBytes,
      storageLimitBytes:
        downloadInstallationPreferences().downloadsStorageLimitBytes,
      wifiOnly: downloadInstallationPreferences().downloadsWifiOnly,
    },
    operation,
  );
}

/**
 * Adopts durable server-created preparations into this installation's native
 * queue. Batch and next-episode endpoints deliberately return preparation
 * records rather than pretending the transfer already belongs to a device.
 */
export async function stageDownloadPreparations(
  preparations: readonly DownloadPreparation[],
  operation: ScopedDownloadOperation & {signal?: AbortSignal},
): Promise<PorticoDownload[]> {
  const staged: PorticoDownload[] = [];
  for (const preparation of preparations) {
    assertDownloadOperationCurrent(operation);
    staged.push(
      await stageNativePreparation(
        downloadIdentifier(preparation.mediaId, preparation.qualityProfile),
        preparation.mediaId,
        preparation.qualityProfile,
        preparation.mediaTitle,
        undefined,
        preparation,
        operation,
      ),
    );
  }
  return staged;
}

async function stageNativePreparation(
  id: string,
  mediaId: string,
  profile: string,
  title: string,
  subtitle: string | undefined,
  preparation: DownloadPreparation,
  operation: ScopedDownloadOperation & {signal?: AbortSignal},
): Promise<PorticoDownload> {
  const state =
    preparation.state === 'paused' ||
    preparation.state === 'failed' ||
    preparation.state === 'cancelled'
        ? 'failed'
        : preparation.state === 'unavailable'
          ? 'unavailable'
          : 'preparing';
  return porticoDownloads.stagePreparation(
    {
      id,
      mediaId,
      profile,
      preparationId: preparation.id,
      title,
      subtitle,
      state,
      preparationProgress: Math.max(0, Math.min(100, preparation.progress)),
      expectedBytes: positiveBytes(preparation.sizeBytes),
    },
    operation,
  );
}

/**
 * Reattaches durable native preparation rows after launch/foreground. This
 * performs one bounded server refresh per row; the app lifecycle scheduler
 * invokes it again while work remains.
 */
export async function resumeStagedNativeDownloads(
  client: PorticoClient,
  operation: ScopedDownloadOperation & {signal?: AbortSignal},
  records?: readonly PorticoDownload[],
): Promise<void> {
  const downloads = records ?? (await porticoDownloads.list(operation));
  const pending = downloads.filter(
    record => record.state === 'preparing' && Boolean(record.preparationId),
  );
  let failures = 0;
  let firstFailure: unknown;
  let cursor = 0;
  const resumeNext = async (): Promise<void> => {
    const record = pending[cursor];
    cursor += 1;
    if (!record) return;
    try {
      await resumeStagedNativeDownload(client, operation, record);
    } catch (error) {
      // One stale/offline preparation must not starve the rest of the queue.
      // Cancellation and profile changes still terminate the batch promptly.
      if (
        operation.signal?.aborted ||
        (operation.isCurrent && !operation.isCurrent())
      ) {
        throw error;
      }
      failures += 1;
      firstFailure ??= error;
    }
    await resumeNext();
  };
  await Promise.all(
    Array.from({length: Math.min(2, pending.length)}, resumeNext),
  );
  if (pending.length > 0 && failures === pending.length) throw firstFailure;
}

async function resumeStagedNativeDownload(
  client: PorticoClient,
  operation: ScopedDownloadOperation & {signal?: AbortSignal},
  record: PorticoDownload,
): Promise<void> {
  if (!record.preparationId) return;
  assertDownloadOperationCurrent(operation);
  const preparation = await client.downloadPreparation(record.preparationId, {
    signal: operation.signal,
  });
  await stageNativePreparation(
    record.clientIdentifier,
    record.mediaId,
    record.profile,
    record.title,
    record.subtitle,
    preparation,
    operation,
  );
  if (preparation.state !== 'ready') return;
  const expectedBytes = positiveBytes(preparation.sizeBytes);
  if (expectedBytes === undefined) return;
  const grant = await client.createDownloadPreparationGrant(preparation.id, {
    signal: operation.signal,
  });
  if (
    !grant.grantToken ||
    !grant.downloadUrl ||
    grant.profile !== preparation.qualityProfile ||
    Date.parse(grant.expiresAt) <= Date.now()
  ) {
    throw new NativeDownloadWorkflowError('grant_invalid');
  }
  await porticoDownloads.enqueue(
    {
      id: record.clientIdentifier,
      mediaId: record.mediaId,
      profile: record.profile,
      preparationId: preparation.id,
      title: record.title,
      subtitle: record.subtitle,
      downloadURL: client.resourceUrl(grant.downloadUrl),
      authorization: `PorticoDownload ${grant.grantToken}`,
      expectedBytes,
      storageLimitBytes:
        downloadInstallationPreferences().downloadsStorageLimitBytes,
      wifiOnly: downloadInstallationPreferences().downloadsWifiOnly,
    },
    operation,
  );
}

function assertDownloadOperationCurrent(
  operation: ScopedDownloadOperation & {signal?: AbortSignal},
): void {
  if (operation.signal?.aborted) throw abortSignalReason(operation.signal);
  if (operation.isCurrent && !operation.isCurrent()) {
    throw new Error(
      'The active Portico profile changed before the download could start.',
    );
  }
}

function abortSignalReason(signal: AbortSignal): unknown {
  return (signal as AbortSignal & {reason?: unknown}).reason ?? new Error('The download operation was cancelled.');
}

function positiveBytes(value: number | undefined): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) && value > 0
    ? value
    : undefined;
}

function downloadInstallationPreferences() {
  try {
    return appleInstallationPreferences.get();
  } catch {
    // Native Settings is unavailable in pure-JS conformance environments.
    // Fail to the conservative Wi-Fi-only bounded policy, never to an
    // unbounded or cellular-enabled transfer policy.
    return defaultAppleInstallationPreferences;
  }
}

export function downloadIdentifier(mediaId: string, profile: string): string {
  return 'media-' + stableHash(mediaId + '\u0000' + profile);
}

function stableHash(value: string): string {
  let hash = 0x811c9dc5;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193);
  }
  return (hash >>> 0).toString(16).padStart(8, '0');
}
