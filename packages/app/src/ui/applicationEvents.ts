import {useEffect} from 'react';
import {useQueryClient, type QueryClient, type QueryKey} from '@tanstack/react-query';
import type {AppEvent, PorticoClient} from '@portico/client-core';
import {
  useViewerRuntime,
  useViewerRuntimeSnapshot,
  useOptionalPorticoViewerPreferences,
} from '@portico-react-native/infrastructure';
import {clearMediaArtworkFailureCache} from './artworkFailureCache';

const allApplicationQueryPrefixes: readonly QueryKey[] = [
  ['home'],
  ['library-page'],
  ['media'],
  ['media-children'],
  ['media-trickplay'],
  ['person'],
  ['search'],
  ['watchlist'],
  ['favorites'],
  ['saved-resources'],
  ['saved-resource-items'],
  ['active-detail-queue'],
  ['playback-history'],
  ['live-tv-sources'],
  ['live-tv-channels'],
  ['live-tv-guide'],
  ['dvr-status'],
  ['dvr-rules'],
  ['dvr-recordings'],
  ['library-channels-guide'],
];

const semanticMediaPrefix = 'resource:media:';

export function applicationEventSemanticTags(
  event: Pick<AppEvent, 'tags' | 'resource' | 'resourceId'>,
): string[] {
  const tags = [...event.tags];
  if (event.resource === 'media' && event.resourceId) {
    tags.push(`${semanticMediaPrefix}${encodeURIComponent(event.resourceId)}`);
  }
  return tags;
}

export function applicationEventQueryPrefixesFromSemanticTags(
  tags: ReadonlySet<string>,
): QueryKey[] {
  if (tags.has('runtime:reconcile')) return [...allApplicationQueryPrefixes];
  const eventTags = [...tags].filter(tag => !tag.startsWith(semanticMediaPrefix));
  const mediaIds = [...tags]
    .filter(tag => tag.startsWith(semanticMediaPrefix))
    .map(tag => decodeURIComponent(tag.slice(semanticMediaPrefix.length)));
  const events = mediaIds.length
    ? mediaIds.map(resourceId => ({tags: eventTags, resource: 'media', resourceId} as const))
    : [{tags: eventTags}];
  const keys = new Map<string, QueryKey>();
  for (const event of events) {
    for (const key of applicationEventQueryPrefixes(event)) {
      keys.set(JSON.stringify(key), key);
    }
  }
  return [...keys.values()];
}

/**
 * Converts server-owned data tags into the smallest useful React Query
 * prefixes. Invalidation marks retained data stale; it never removes cached
 * rows, remounts screens, or changes navigation/focus state.
 */
export function applicationEventQueryPrefixes(
  event: Pick<AppEvent, 'tags' | 'resource' | 'resourceId'>,
): QueryKey[] {
  const keys = new Map<string, QueryKey>();
  const add = (key: QueryKey) => keys.set(JSON.stringify(key), key);
  const mediaKey =
    event.resource === 'media' && event.resourceId
      ? ['media', event.resourceId]
      : ['media'];

  for (const tag of event.tags) {
    switch (tag) {
      case 'home':
        add(['home']);
        break;
      case 'libraries':
        add(['home']);
        add(['library-page']);
        break;
      case 'library-items':
        add(['library-page']);
        break;
      case 'media':
      case 'metadata':
        add(mediaKey);
        add(['media-children']);
        add(['library-page']);
        add(['person']);
        add(['search']);
        break;
      case 'media-state':
        add(mediaKey);
        add(['home']);
        add(['library-page']);
        add(['watchlist']);
        add(['favorites']);
        add(['saved-resource-items']);
        add(['active-detail-queue']);
        break;
      case 'playback-progress':
        add(mediaKey);
        add(['home']);
        break;
      case 'playlists':
      case 'collections':
      case 'saved':
        add(['saved-resources']);
        add(['saved-resource-items']);
        break;
      case 'search':
        add(['search']);
        break;
      case 'live-tv':
        add(['live-tv-sources']);
        add(['live-tv-channels']);
        add(['live-tv-guide']);
        break;
      case 'dvr':
        add(['dvr-status']);
        add(['dvr-rules']);
        add(['dvr-recordings']);
        break;
      case 'library-channels':
        add(['library-channels-guide']);
        add(['live-tv-sources']);
        break;
      case 'dashboard:history':
        add(['playback-history']);
        break;
    }
  }
  return [...keys.values()];
}

export function invalidateApplicationEvent(
  queryClient: QueryClient,
  event: Pick<AppEvent, 'tags' | 'resource' | 'resourceId'>,
): void {
  for (const queryKey of applicationEventQueryPrefixes(event)) {
    void queryClient.invalidateQueries({queryKey, refetchType: 'active'});
  }
}

export function invalidateAllApplicationQueries(queryClient: QueryClient): void {
  for (const queryKey of allApplicationQueryPrefixes) {
    void queryClient.invalidateQueries({queryKey, refetchType: 'active'});
  }
}

/** One transport-neutral Client Core subscription per mounted viewer shell. */
export function useApplicationEventInvalidations(
  client: PorticoClient | undefined,
): void {
  const queryClient = useQueryClient();
  const runtime = useViewerRuntime();
  const snapshot = useViewerRuntimeSnapshot();
  const reloadPreferences = useOptionalPorticoViewerPreferences()?.reload;

  useEffect(() => {
    if (!client || !snapshot.scope || !snapshot.acceptingWrites) return;
    const sync = runtime.viewerSync();
    if (!sync) return;
    const generation = snapshot.generation;
    const cache = sync.registerResource({
      key: 'react-native-query-cache',
      tags: ['*'],
      priority: 'interactive',
      refresh: batch => {
        for (const queryKey of applicationEventQueryPrefixesFromSemanticTags(batch.tags)) {
          void queryClient.invalidateQueries({queryKey, refetchType: 'active'});
        }
      },
    });
    const preferences = reloadPreferences
      ? sync.registerResource({
          key: 'react-native-viewer-preferences',
          tags: ['display-preferences', 'settings'],
          priority: 'background',
          refresh: () => reloadPreferences(),
        })
      : undefined;
    const subscription = sync.leaseSubscription({
      key: 'application',
      // This multiplexed stream carries authorization and playback-state
      // invalidations as well as ordinary content changes, so continuity is
      // interactive even though individual low-value refreshes may defer.
      priority: 'interactive',
      start: signal => client.subscribeAppEvents({
        // React Native fetch does not expose a portable streaming body. Client
        // Core's long-poll runtime provides the same ordering/reset contract,
        // refreshes 15-minute access credentials, and reconnects with jittered
        // exponential backoff without involving product UI.
        transport: 'long-poll',
        signal,
        publicationFence: {
          generation,
          currentGeneration: () => runtime.getSnapshot().generation,
        },
        onEvent: event => {
          if (event.tags.some(tag => tag === '*' || tag === 'media' || tag === 'metadata' || tag === 'library-items' || tag === 'artwork')) {
            clearMediaArtworkFailureCache();
          }
          const immediate = event.tags.some(tag => tag === 'authorization' || tag === 'profiles' || tag === 'account');
          sync.invalidate(applicationEventSemanticTags(event), immediate ? 'immediate' : 'coalesced');
        },
        onResetRequired: context => {
          if (context.isCurrent()) sync.invalidate(['runtime:reconcile'], 'immediate', true);
        },
      }),
    });
    return () => {
      subscription.release();
      preferences?.release();
      cache.release();
    };
  }, [
    client,
    queryClient,
    reloadPreferences,
    runtime,
    snapshot.acceptingWrites,
    snapshot.generation,
    snapshot.scope,
  ]);
}
