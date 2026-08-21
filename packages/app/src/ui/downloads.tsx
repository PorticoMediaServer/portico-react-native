import React, {useCallback, useEffect, useRef, useState} from 'react';
import {
  ActivityIndicator,
  AppState,
  Modal,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import type {
  DownloadOption,
  MediaItem,
  PorticoClient,
} from '@porticomediaserver/client-core';
import {
  downloadsSupported,
  activeDownloadViewerScope,
  appleInstallationPreferences,
  porticoDownloads,
  usePorticoViewerPreferences,
  useViewerRuntime,
  type PorticoDownload,
} from '@portico-react-native/infrastructure';
import {
  ApplePlayer,
  formatPlayerTime,
  type ApplePlaybackProgress,
  type ApplePlaybackState,
  type ApplePlayerHandle,
} from '@portico-react-native/player';
import {useSafeAreaInsets} from 'react-native-safe-area-context';
import {PorticoIcon} from '@portico-react-native/icons';
import {
  availableDownloadOptions,
  enqueueMediaDownload,
  offlinePlaybackStart,
  resumeStagedNativeDownloads,
  stageDownloadPreparations,
  synchronizePendingDownloadProgress,
} from '../data';
import type {PrototypePlatform} from '../ui-compat/contract';
import {color, font} from './tokens';
import {ControlButton, Focusable, IconButton, InlineNotice} from './primitives';
import {usePorticoNavigationActions} from './navigation';
import {useModalAnimationType} from './useReducedMotion';
import {usePersistentPlayback} from './playbackSession';
import {
  productBody,
  productErrorBody,
  productText,
  productTitle,
} from './productCopy';

export function useDeviceDownloads(): {
  downloads: PorticoDownload[];
  error?: string;
  loading: boolean;
  refresh(): Promise<void>;
} {
  const [downloads, setDownloads] = useState<PorticoDownload[]>([]);
  const [loading, setLoading] = useState(downloadsSupported);
  const [error, setError] = useState<string>();
  const refresh = useCallback(async () => {
    if (!downloadsSupported) {
      setLoading(false);
      return;
    }
    try {
      setError(undefined);
      setDownloads(await porticoDownloads.list());
    } catch (cause) {
      setError(productErrorBody(cause, 'download.device-read-failed'));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void refresh();
    return porticoDownloads.subscribe(setDownloads);
  }, [refresh]);

  return {downloads, error, loading, refresh};
}

export const AUTOMATIC_NEXT_DOWNLOAD_MAX_ATTEMPTS = 4;

export function automaticNextDownloadRetryDecision(previousFailures: number): {
  failures: number;
  retry: boolean;
} {
  const failures = Math.min(
    AUTOMATIC_NEXT_DOWNLOAD_MAX_ATTEMPTS,
    Math.max(0, previousFailures) + 1,
  );
  return {
    failures,
    retry: failures < AUTOMATIC_NEXT_DOWNLOAD_MAX_ATTEMPTS,
  };
}

/**
 * Replays progress produced by offline AVPlayer sessions once a server session
 * is available again. The native record remains pending until the server has
 * explicitly accepted the update, so process termination and network failure
 * cannot silently discard viewing progress.
 */
export function useDeferredDownloadProgressSync(
  client: PorticoClient | undefined,
): void {
  const inFlight = useRef(new Set<string>());
  const automaticNextAttempted = useRef(new Set<string>());
  const automaticNextFailures = useRef(new Map<string, number>());
  const viewerRuntime = useViewerRuntime();
  const viewerPreferences = usePorticoViewerPreferences().values;

  useEffect(() => {
    if (!client || !downloadsSupported) return;
    let cancelled = false;
    let running: Promise<void> | undefined;
    let activeAbort: AbortController | undefined;
    let pending = false;
    let pendingDelay = 2_000;
    let retryAttempt = 0;
    let lastPreparationSignature = '';
    let retryTimer: ReturnType<typeof setTimeout> | undefined;
    const retryDelays = [2_000, 5_000, 15_000, 60_000] as const;

    const synchronize = async (signal: AbortSignal): Promise<string> => {
      const viewerScope = activeDownloadViewerScope();
      if (!viewerScope) return '';
      const records = await porticoDownloads.list();
      await resumeStagedNativeDownloads(
        client,
        {
          scope: viewerScope,
          signal,
          isCurrent: () => {
            const current = activeDownloadViewerScope();
            return (
              !cancelled &&
              Boolean(current) &&
              current!.authority === viewerScope.authority &&
              current!.accountId === viewerScope.accountId &&
              current!.serverId === viewerScope.serverId &&
              current!.profileId === viewerScope.profileId &&
              current!.authorizationRevision ===
                viewerScope.authorizationRevision
            );
          },
        },
        records,
      );
      await synchronizePendingDownloadProgress({
        cancelled: () => {
          const current = activeDownloadViewerScope();
          return (
            cancelled ||
            !current ||
            current.authority !== viewerScope.authority ||
            current.accountId !== viewerScope.accountId ||
            current.serverId !== viewerScope.serverId ||
            current.profileId !== viewerScope.profileId ||
            current.authorizationRevision !== viewerScope.authorizationRevision
          );
        },
        client,
        downloads: records,
        inFlight: inFlight.current,
        store: porticoDownloads,
        viewerScope,
      });
      const refreshedRecords = await porticoDownloads.list({
        scope: viewerScope,
        isCurrent: () => {
          const current = activeDownloadViewerScope();
          return (
            !cancelled &&
            Boolean(current) &&
            current!.authority === viewerScope.authority &&
            current!.accountId === viewerScope.accountId &&
            current!.serverId === viewerScope.serverId &&
            current!.profileId === viewerScope.profileId &&
            current!.authorizationRevision === viewerScope.authorizationRevision
          );
        },
      });
      const operation = {
        scope: viewerScope,
        signal,
        isCurrent: () => {
          const current = activeDownloadViewerScope();
          return (
            !cancelled &&
            Boolean(current) &&
            current!.authority === viewerScope.authority &&
            current!.accountId === viewerScope.accountId &&
            current!.serverId === viewerScope.serverId &&
            current!.profileId === viewerScope.profileId &&
            current!.authorizationRevision === viewerScope.authorizationRevision
          );
        },
      };
      const currentRecordIds = new Set(
        refreshedRecords.map(record => record.id),
      );
      for (const id of automaticNextFailures.current.keys()) {
        if (!currentRecordIds.has(id)) automaticNextFailures.current.delete(id);
      }
      for (const id of automaticNextAttempted.current) {
        if (!currentRecordIds.has(id))
          automaticNextAttempted.current.delete(id);
      }
      for (const record of refreshedRecords) {
        if (
          record.state !== 'completed' ||
          !record.playbackCompleted ||
          automaticNextAttempted.current.has(record.id)
        )
          continue;
        let automaticNextPending = false;
        if (appleInstallationPreferences.get().downloadsAutomaticNextEpisode) {
          try {
            const next = await client.createNextEpisodeDownloadPreparation(
              {
                nextAfterMediaId: record.mediaId,
                qualityProfile: record.profile,
              },
              {signal},
            );
            await stageDownloadPreparations([next], operation);
            automaticNextFailures.current.delete(record.id);
            automaticNextAttempted.current.add(record.id);
          } catch {
            const decision = automaticNextDownloadRetryDecision(
              automaticNextFailures.current.get(record.id) ?? 0,
            );
            automaticNextFailures.current.set(record.id, decision.failures);
            automaticNextPending = decision.retry;
            if (!decision.retry) automaticNextAttempted.current.add(record.id);
          }
        } else {
          automaticNextFailures.current.delete(record.id);
          automaticNextAttempted.current.add(record.id);
        }
        if (viewerPreferences.downloadDeleteWatched && !automaticNextPending) {
          await porticoDownloads.remove(record.id, operation);
        }
      }
      const preparationSignature = refreshedRecords
        .filter(record => record.state === 'preparing')
        .map(
          record =>
            `${record.id}:${record.preparationProgress ?? 0}:${record.updatedAt}`,
        )
        .sort()
        .join('|');
      const automaticNextRetrySignature = [...automaticNextFailures.current]
        .filter(
          ([id, failures]) =>
            currentRecordIds.has(id) &&
            failures < AUTOMATIC_NEXT_DOWNLOAD_MAX_ATTEMPTS &&
            !automaticNextAttempted.current.has(id),
        )
        .map(([id]) => `automatic-next:${id}`)
        .sort()
        .join('|');
      return [preparationSignature, automaticNextRetrySignature]
        .filter(Boolean)
        .join('|');
    };

    const schedule = (delay = 0) => {
      if (cancelled) return;
      if (running) {
        pending = true;
        return;
      }
      if (retryTimer) clearTimeout(retryTimer);
      retryTimer = setTimeout(() => {
        retryTimer = undefined;
        if (cancelled) return;
        activeAbort = new AbortController();
        running = synchronize(activeAbort.signal)
          .then(preparationSignature => {
            if (!preparationSignature) {
              retryAttempt = 0;
              lastPreparationSignature = '';
              return;
            }
            retryAttempt =
              preparationSignature === lastPreparationSignature
                ? Math.min(retryAttempt + 1, retryDelays.length - 1)
                : 0;
            lastPreparationSignature = preparationSignature;
            pending = true;
            pendingDelay = retryDelays[retryAttempt] ?? 60_000;
          })
          .catch(() => {
            const retryDelay =
              retryDelays[Math.min(retryAttempt, retryDelays.length - 1)] ??
              60_000;
            retryAttempt += 1;
            pending = true;
            pendingDelay = retryDelay;
          })
          .finally(() => {
            activeAbort = undefined;
            running = undefined;
            if (pending && !cancelled) {
              pending = false;
              const delay = pendingDelay;
              pendingDelay = retryDelays[0];
              schedule(delay);
            }
          });
      }, delay);
    };
    schedule();
    const unregisterTransition = viewerRuntime.register(
      'requests',
      async () => {
        cancelled = true;
        activeAbort?.abort();
        if (retryTimer) clearTimeout(retryTimer);
        await Promise.allSettled(running ? [running] : []);
      },
    );
    const unsubscribe = porticoDownloads.subscribe(() => schedule());
    const appStateSubscription = AppState.addEventListener('change', state => {
      if (state === 'active') schedule();
    });
    return () => {
      cancelled = true;
      activeAbort?.abort();
      unsubscribe();
      unregisterTransition();
      appStateSubscription.remove();
      if (retryTimer) clearTimeout(retryTimer);
    };
  }, [client, viewerPreferences.downloadDeleteWatched, viewerRuntime]);
}

export function DownloadAction({
  client,
  media,
  platform,
}: {
  client: PorticoClient;
  media: MediaItem;
  platform: PrototypePlatform;
}) {
  const viewerRuntime = useViewerRuntime();
  const animationType = useModalAnimationType();
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [options, setOptions] = useState<DownloadOption[]>([]);
  const [error, setError] = useState<string>();
  const [complete, setComplete] = useState(false);
  const [completeCopy, setCompleteCopy] = useState<{
    title: string;
    body: string;
  }>();
  const batch =
    media.type === 'show' ||
    media.type === 'season' ||
    media.type === 'album' ||
    media.type === 'artist';

  if (platform === 'tv' || !downloadsSupported) return null;

  const prepare = async () => {
    setOpen(true);
    setLoading(true);
    setError(undefined);
    setComplete(false);
    setCompleteCopy(undefined);
    try {
      const optionSeed = media.playbackTarget ?? media.children?.[0] ?? media;
      const response = await client.downloadOptions(optionSeed.id);
      if (!response.canDownload) {
        setError(productBody('download.not-allowed'));
        return;
      }
      const available = availableDownloadOptions(response.options);
      if (!available.length) {
        setError(productBody('download.version-unavailable'));
        return;
      }
      setOptions(available);
    } catch (cause) {
      setError(productErrorBody(cause, 'download.options-failed'));
    } finally {
      setLoading(false);
    }
  };

  const enqueue = async (option: DownloadOption) => {
    setLoading(true);
    setError(undefined);
    let lease: ReturnType<typeof viewerRuntime.createRequestLease> | undefined;
    try {
      const scope = viewerRuntime.getSnapshot().scope;
      lease = viewerRuntime.createRequestLease(scope);
      const operation = {
        isCurrent: () => viewerRuntime.isWriteCurrent(lease!.writeToken),
        scope: scope!,
        signal: lease.signal,
      };
      if (batch) {
        const response = await client.createDownloadPreparationBatch(
          {
            containerId: media.id,
            qualityProfile: option.profile || option.id,
          },
          {signal: lease.signal},
        );
        await stageDownloadPreparations(response.items, operation);
        setCompleteCopy({
          title: productTitle('download.batch-started', {
            accepted: response.items.length,
            rejected: response.rejected.length,
          }),
          body: productBody('download.batch-started', {
            accepted: response.items.length,
            rejected: response.rejected.length,
          }),
        });
      } else {
        await enqueueMediaDownload(client, media, option, operation);
        setCompleteCopy({
          title: productText('download.added-title'),
          body: productText('download.added-body'),
        });
      }
      setComplete(true);
      setOptions([]);
    } catch (cause) {
      setError(productErrorBody(cause, 'download.start-failed'));
    } finally {
      lease?.release();
      setLoading(false);
    }
  };

  return (
    <>
      <IconButton
        icon="action.download"
        label={productText('action.download')}
        onPress={() => void prepare()}
        platform={platform}
      />
      <Modal
        animationType={animationType}
        onRequestClose={() => setOpen(false)}
        presentationStyle="overFullScreen"
        transparent
        visible={open}
      >
        <View accessibilityViewIsModal style={styles.backdrop}>
          <View style={styles.sheet}>
            <View style={styles.sheetHeader}>
              <View style={styles.sheetHeading}>
                <Text style={styles.eyebrow}>
                  {productText('download.to-device', {
                    device: 'iPhone',
                  }).toUpperCase()}
                </Text>
                <Text numberOfLines={2} style={styles.title}>
                  {media.title}
                </Text>
              </View>
              <IconButton
                icon="action.close"
                label={productText('action.close-download-options')}
                onPress={() => setOpen(false)}
                platform="mobile"
              />
            </View>
            {loading ? (
              <View style={styles.loading}>
                <ActivityIndicator color={color.screenBlueStrong} />
                <Text style={styles.loadingText}>
                  {options.length
                    ? productText('download.starting')
                    : productText('download.checking-versions')}
                </Text>
              </View>
            ) : null}
            {error ? (
              <InlineNotice kind="error" message={error} platform="mobile" />
            ) : null}
            {complete ? (
              <View style={styles.complete}>
                <PorticoIcon color={color.focus} id="status.success" size={24} />
                <View style={styles.completeCopy}>
                  <Text style={styles.completeTitle}>
                    {completeCopy?.title ?? productText('download.added-title')}
                  </Text>
                  <Text style={styles.completeBody}>
                    {completeCopy?.body ?? productText('download.added-body')}
                  </Text>
                </View>
              </View>
            ) : null}
            {!loading && !complete ? (
              <View style={styles.options}>
                {options.map(option => (
                  <Focusable
                    accessibilityLabel={productText('download.action-label', {
                      label: option.label,
                      sizeSuffix: option.sizeBytes
                        ? `, ${formatBytes(option.sizeBytes)}`
                        : '',
                    })}
                    accessibilityRole="button"
                    key={option.id}
                    onPress={() => void enqueue(option)}
                    platform="mobile"
                    pressedStyle={styles.optionPressed}
                    style={styles.option}
                  >
                    <View style={styles.optionCopy}>
                      <Text style={styles.optionTitle}>{option.label}</Text>
                      <Text style={styles.optionBody}>
                        {[
                          option.description,
                          option.container?.toUpperCase(),
                          option.sizeBytes
                            ? formatBytes(option.sizeBytes)
                            : undefined,
                        ]
                          .filter(Boolean)
                          .join('  ·  ')}
                      </Text>
                    </View>
                    <PorticoIcon color={color.softSilver} id="action.download" size={22} />
                  </Focusable>
                ))}
              </View>
            ) : null}
            {complete ? (
              <ControlButton
                label={productText('action.done')}
                onPress={() => setOpen(false)}
                platform="mobile"
              />
            ) : null}
          </View>
        </View>
      </Modal>
    </>
  );
}

export function formatBytes(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes <= 0)
    return productText('download.size-unavailable');
  const units = ['B', 'KB', 'MB', 'GB', 'TB'];
  const index = Math.min(
    Math.floor(Math.log(bytes) / Math.log(1024)),
    units.length - 1,
  );
  const value = bytes / 1024 ** index;
  return (
    (value >= 10 || index === 0 ? value.toFixed(0) : value.toFixed(1)) +
    ' ' +
    units[index]
  );
}

export function OfflinePlayerScreen({
  downloadId,
  sourceURL,
  startSeconds = 0,
  subtitle,
  title,
}: {
  downloadId: string;
  sourceURL: string;
  startSeconds?: number;
  subtitle?: string;
  title: string;
}) {
  const {back} = usePorticoNavigationActions();
  return (
    <OfflinePlayerSurface
      downloadId={downloadId}
      onClose={back}
      sourceURL={sourceURL}
      startSeconds={startSeconds}
      subtitle={subtitle}
      title={title}
    />
  );
}

let offlinePlaybackAttemptSequence = 0;

export function nextOfflinePlaybackAttempt(now = Date.now()): number {
  offlinePlaybackAttemptSequence = (offlinePlaybackAttemptSequence + 1) % 1_000;
  return now * 1_000 + offlinePlaybackAttemptSequence;
}

/** Resolves all operational file data behind a stable, viewer-scoped download id. */
export function PersistentOfflinePlayerScreen({
  downloadId,
}: {
  downloadId: string;
}) {
  const {back} = usePorticoNavigationActions();
  const {downloads, error, loading} = useDeviceDownloads();
  const download = downloads.find(candidate => candidate.id === downloadId);
  if (loading) return <View style={styles.offlinePlayer} />;
  if (error || !download?.localURL || download.state !== 'completed') {
    return (
      <View style={styles.offlinePlayer}>
        <InlineNotice
          actionLabel={productText('action.close')}
          kind="error"
          message={error ?? productBody('download.offline-playback-failed')}
          onAction={back}
          platform="mobile"
        />
      </View>
    );
  }
  return (
    <OfflinePlayerScreen
      downloadId={download.id}
      sourceURL={download.localURL}
      startSeconds={offlinePlaybackStart(download)}
      subtitle={download.subtitle}
      title={download.title}
    />
  );
}

function OfflinePlayerSurface({
  downloadId,
  onClose,
  sourceURL,
  startSeconds = 0,
  subtitle,
  title,
}: {
  downloadId: string;
  onClose(): void;
  sourceURL: string;
  startSeconds?: number;
  subtitle?: string;
  title: string;
}) {
  const insets = useSafeAreaInsets();
  const playerRef = useRef<ApplePlayerHandle>(null);
  const progressRef = useRef<ApplePlaybackProgress>({
    durationSeconds: 0,
    isPlaying: false,
    positionSeconds: startSeconds,
  });
  const lastSavedRef = useRef(0);
  const terminalCompletionRef = useRef(false);
  const playbackAttemptRef = useRef(nextOfflinePlaybackAttempt());
  const playbackRevisionRef = useRef(0);
  const [progress, setProgress] = useState(progressRef.current);
  const [state, setState] = useState<ApplePlaybackState>('loading');
  const [error, setError] = useState<string>();

  const saveProgress = useCallback(
    (next: ApplePlaybackProgress, completed = false, force = false) => {
      progressRef.current = next;
      setProgress(next);
      const now = Date.now();
      if (!force && now - lastSavedRef.current < 10_000) return;
      lastSavedRef.current = now;
      void porticoDownloads
        .updatePlaybackProgress(
          downloadId,
          next.positionSeconds,
          next.durationSeconds,
          completed || terminalCompletionRef.current,
          undefined,
          {
            attempt: playbackAttemptRef.current,
            revision: ++playbackRevisionRef.current,
          },
        )
        .catch(() => undefined);
    },
    [downloadId],
  );

  useEffect(
    () => () =>
      saveProgress(progressRef.current, terminalCompletionRef.current, true),
    [saveProgress],
  );

  if (error)
    return (
      <View style={styles.offlinePlayer}>
        <InlineNotice
          actionLabel={productText('action.close')}
          kind="error"
          message={error}
          onAction={onClose}
          platform="mobile"
        />
      </View>
    );
  const duration = progress.durationSeconds;
  const percent =
    duration > 0
      ? Math.max(0, Math.min(100, (progress.positionSeconds / duration) * 100))
      : 0;
  return (
    <View style={styles.offlinePlayer}>
      <ApplePlayer
        autoplay
        contentMode="video"
        metadataSubtitle={subtitle ?? productText('download.downloaded')}
        metadataTitle={title}
        onEnd={() => {
          terminalCompletionRef.current = true;
          saveProgress(
            {
              ...progressRef.current,
              isPlaying: false,
              positionSeconds: progressRef.current.durationSeconds,
            },
            true,
            true,
          );
        }}
        onError={() =>
          setError(productBody('download.offline-playback-failed'))
        }
        onPictureInPictureChange={event => {
          if (event.state === 'restore-requested' && event.requestId) {
            const requestId = event.requestId;
            requestAnimationFrame(() =>
              playerRef.current?.completePictureInPictureRestore(
                requestId,
                AppState.currentState === 'active',
              ),
            );
          } else if (
            event.state === 'restore-required' ||
            event.state === 'failed'
          ) {
            setError(productBody('download.offline-playback-failed'));
          }
        }}
        onProgress={saveProgress}
        onStateChange={setState}
        ref={playerRef}
        sourceURL={sourceURL}
        startPositionSeconds={startSeconds}
        style={StyleSheet.absoluteFill}
      />
      <OfflinePersistentPlaybackBridge
        active={!error}
        isPlaying={progress.isPlaying}
        mediaId={downloadId}
        onPause={() => playerRef.current?.pause()}
        onPlay={() => playerRef.current?.play()}
        subtitle={subtitle}
        title={title}
      />
      <View pointerEvents="none" style={styles.offlineScrim} />
      <View style={[styles.offlineTop, {paddingTop: insets.top + 8}]}>
        <IconButton
          icon="action.close"
          label={productText('action.close-player')}
          onPress={onClose}
          platform="mobile"
        />
      </View>
      <View style={[styles.offlineIdentity, {top: insets.top + 76}]}>
        <Text style={styles.offlineTitle}>{title}</Text>
        {subtitle ? (
          <Text style={styles.offlineSubtitle}>
            {subtitle} · {productText('download.downloaded')}
          </Text>
        ) : (
          <Text style={styles.offlineSubtitle}>
            {productText('download.downloaded')}
          </Text>
        )}
      </View>
      {state === 'loading' || state === 'buffering' ? (
        <View style={styles.offlineBuffering}>
          <ActivityIndicator color={color.silver} size="large" />
          <Text style={styles.offlineBufferingText}>
            {productText('download.loading-offline')}
          </Text>
        </View>
      ) : null}
      <View
        style={[
          styles.offlineBottom,
          {paddingBottom: Math.max(insets.bottom, 18)},
        ]}
      >
        <View style={styles.offlineTimes}>
          <Text style={styles.offlineTime}>
            {formatPlayerTime(progress.positionSeconds)}
          </Text>
          <Text style={styles.offlineTime}>{formatPlayerTime(duration)}</Text>
        </View>
        <View style={styles.offlineProgress}>
          <View
            style={[
              styles.offlineProgressValue,
              {width: (percent + '%') as `${number}%`},
            ]}
          />
        </View>
        <View style={styles.offlineTransport}>
          <IconButton
            icon="playback.seek-back"
            label={productText('action.rewind-seconds', {seconds: 10})}
            onPress={() =>
              playerRef.current?.seekTo(
                Math.max(0, progress.positionSeconds - 10),
              )
            }
            platform="mobile"
          />
          <IconButton
            icon={state === 'playing' ? 'playback.pause' : 'playback.play'}
            label={productText(
              state === 'playing' ? 'action.pause' : 'action.play',
            )}
            onPress={() =>
              state === 'playing'
                ? playerRef.current?.pause()
                : playerRef.current?.play()
            }
            platform="mobile"
            selected
          />
          <IconButton
            icon="playback.seek-forward"
            label={productText('action.forward-seconds', {seconds: 10})}
            onPress={() =>
              playerRef.current?.seekTo(
                Math.min(
                  duration || Number.MAX_SAFE_INTEGER,
                  progress.positionSeconds + 10,
                ),
              )
            }
            platform="mobile"
          />
        </View>
      </View>
    </View>
  );
}

function OfflinePersistentPlaybackBridge({
  active,
  isPlaying,
  mediaId,
  onPause,
  onPlay,
  subtitle,
  title,
}: {
  active: boolean;
  isPlaying: boolean;
  mediaId: string;
  onPause(): void;
  onPlay(): void;
  subtitle?: string;
  title: string;
}) {
  const {publish, register} = usePersistentPlayback();
  const commands = useRef({pause: onPause, play: onPlay});
  commands.current = {pause: onPause, play: onPlay};
  useEffect(
    () =>
      register({
        pause: () => commands.current.pause(),
        play: () => commands.current.play(),
      }),
    [register],
  );
  useEffect(() => {
    publish(active ? {active, isPlaying, mediaId, subtitle, title} : undefined);
  }, [active, isPlaying, mediaId, publish, subtitle, title]);
  return null;
}

export function OfflineDownloadsAccess({onClose}: {onClose(): void}) {
  const {downloads, error, loading, refresh} = useDeviceDownloads();
  const [selected, setSelected] = useState<PorticoDownload>();
  if (selected?.localURL)
    return (
      <OfflinePlayerSurface
        downloadId={selected.id}
        onClose={() => setSelected(undefined)}
        sourceURL={selected.localURL}
        startSeconds={offlinePlaybackStart(selected)}
        subtitle={selected.subtitle}
        title={selected.title}
      />
    );
  const completed = downloads.filter(
    download => download.state === 'completed' && download.localURL,
  );
  return (
    <View style={styles.offlineAccess}>
      <View style={styles.offlineAccessHeader}>
        <View style={styles.sheetHeading}>
          <Text style={styles.eyebrow}>
            {productText('download.device-eyebrow').toUpperCase()}
          </Text>
          <Text style={styles.offlineAccessTitle}>
            {productText('download.device-title')}
          </Text>
        </View>
        <IconButton
          icon="action.close"
          label={productText('action.close-downloads')}
          onPress={onClose}
          platform="mobile"
        />
      </View>
      {loading ? (
        <View style={styles.loading}>
          <ActivityIndicator color={color.screenBlueStrong} />
          <Text style={styles.loadingText}>
            {productText('download.device-reading', {device: 'iPhone'})}
          </Text>
        </View>
      ) : null}
      {error ? (
        <InlineNotice
          actionLabel={productText('action.retry')}
          kind="error"
          message={error}
          onAction={() => void refresh()}
          platform="mobile"
        />
      ) : null}
      {!loading && !error ? (
        <ScrollView
          contentContainerStyle={styles.offlineAccessList}
          showsVerticalScrollIndicator={false}
        >
          {completed.length ? (
            completed.map(download => (
              <Focusable
                accessibilityLabel={productText('action.play-offline', {
                  title: download.title,
                })}
                accessibilityRole="button"
                key={download.id}
                onPress={() => setSelected(download)}
                platform="mobile"
                pressedStyle={styles.optionPressed}
                style={styles.offlineAccessRow}
              >
                <View style={styles.optionCopy}>
                  <Text style={styles.optionTitle}>{download.title}</Text>
                  <Text style={styles.optionBody}>
                    {[
                      download.subtitle,
                      formatBytes(download.bytesWritten),
                      productText('download.available-offline'),
                    ]
                      .filter(Boolean)
                      .join('  ·  ')}
                  </Text>
                </View>
                <PorticoIcon color={color.softSilver} id="playback.play" size={22} />
              </Focusable>
            ))
          ) : (
            <Text style={styles.offlineAccessEmpty}>
              {productBody('download.device-empty-offline')}
            </Text>
          )}
        </ScrollView>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  backdrop: {
    backgroundColor: 'rgba(0, 0, 0, 0.72)',
    flex: 1,
    justifyContent: 'flex-end',
  },
  sheet: {
    backgroundColor: color.recess,
    borderColor: color.lineSoft,
    borderTopLeftRadius: 26,
    borderTopRightRadius: 26,
    borderWidth: 1,
    gap: 18,
    paddingBottom: 34,
    paddingHorizontal: 22,
    paddingTop: 20,
  },
  sheetHeader: {alignItems: 'center', flexDirection: 'row', gap: 16},
  sheetHeading: {flex: 1},
  eyebrow: {
    color: color.focus,
    fontFamily: font.demi,
    fontSize: 11,
    letterSpacing: 1.2,
  },
  title: {
    color: color.silver,
    fontFamily: font.demi,
    fontSize: 24,
    lineHeight: 30,
    marginTop: 4,
  },
  loading: {alignItems: 'center', flexDirection: 'row', gap: 12, minHeight: 72},
  loadingText: {
    color: color.softSilver,
    fontFamily: font.regular,
    fontSize: 15,
  },
  options: {gap: 10},
  option: {
    alignItems: 'center',
    backgroundColor: color.projector,
    borderColor: color.lineSoft,
    borderRadius: 12,
    borderWidth: 1,
    flexDirection: 'row',
    gap: 14,
    minHeight: 78,
    padding: 14,
  },
  optionPressed: {backgroundColor: color.brightSlate},
  optionCopy: {flex: 1},
  optionTitle: {color: color.silver, fontFamily: font.demi, fontSize: 16},
  optionBody: {
    color: color.dimSilver,
    fontFamily: font.regular,
    fontSize: 13,
    lineHeight: 18,
    marginTop: 4,
  },
  complete: {
    alignItems: 'center',
    backgroundColor: color.projector,
    borderColor: color.lineSoft,
    borderRadius: 12,
    borderWidth: 1,
    flexDirection: 'row',
    gap: 14,
    padding: 16,
  },
  completeCopy: {flex: 1},
  completeTitle: {color: color.silver, fontFamily: font.demi, fontSize: 16},
  completeBody: {
    color: color.dimSilver,
    fontFamily: font.regular,
    fontSize: 13,
    lineHeight: 18,
    marginTop: 3,
  },
  offlinePlayer: {
    backgroundColor: color.projector,
    flex: 1,
    justifyContent: 'center',
    paddingHorizontal: 20,
  },
  offlineScrim: {
    backgroundColor: 'rgba(7, 11, 16, 0.28)',
    ...StyleSheet.absoluteFillObject,
  },
  offlineTop: {left: 18, position: 'absolute', top: 0},
  offlineIdentity: {left: 24, position: 'absolute', right: 24},
  offlineTitle: {
    color: color.silver,
    fontFamily: font.bold,
    fontSize: 27,
    lineHeight: 34,
  },
  offlineSubtitle: {
    color: color.softSilver,
    fontFamily: font.medium,
    fontSize: 14,
    marginTop: 5,
  },
  offlineBuffering: {alignItems: 'center', alignSelf: 'center', gap: 10},
  offlineBufferingText: {
    color: color.silver,
    fontFamily: font.medium,
    fontSize: 14,
  },
  offlineBottom: {bottom: 0, left: 24, position: 'absolute', right: 24},
  offlineTimes: {flexDirection: 'row', justifyContent: 'space-between'},
  offlineTime: {color: color.silver, fontFamily: font.demi, fontSize: 13},
  offlineProgress: {
    backgroundColor: 'rgba(255,255,255,0.22)',
    borderRadius: 2,
    height: 4,
    marginTop: 9,
    overflow: 'hidden',
  },
  offlineProgressValue: {
    backgroundColor: color.screenBlueStrong,
    height: '100%',
  },
  offlineTransport: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: 18,
    justifyContent: 'center',
    marginTop: 22,
  },
  offlineAccess: {
    backgroundColor: color.projector,
    flex: 1,
    paddingHorizontal: 20,
    paddingTop: 18,
  },
  offlineAccessHeader: {alignItems: 'center', flexDirection: 'row', gap: 16},
  offlineAccessTitle: {
    color: color.silver,
    fontFamily: font.bold,
    fontSize: 32,
    lineHeight: 38,
    marginTop: 3,
  },
  offlineAccessList: {gap: 10, paddingBottom: 40, paddingTop: 24},
  offlineAccessRow: {
    alignItems: 'center',
    backgroundColor: color.recess,
    borderColor: color.lineSoft,
    borderRadius: 12,
    borderWidth: 1,
    flexDirection: 'row',
    gap: 14,
    minHeight: 84,
    padding: 15,
  },
  offlineAccessEmpty: {
    color: color.dimSilver,
    fontFamily: font.regular,
    fontSize: 15,
    lineHeight: 22,
    paddingTop: 28,
    textAlign: 'center',
  },
});
