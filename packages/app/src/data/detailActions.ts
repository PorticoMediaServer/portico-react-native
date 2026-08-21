import type {
  CollectionSummary,
  PlaylistSummary,
  PorticoClient,
} from '@porticomediaserver/client-core';

export type DetailSavedTargetKind = 'playlist' | 'collection';
export type DetailSavedTarget = PlaylistSummary | CollectionSummary;
export type DetailQueuePosition = 'play_next' | 'append';

export interface DetailMenuCapabilities {
  collection: boolean;
  playlist: boolean;
  queue: boolean;
  rating: boolean;
  reaction: boolean;
}

export interface ActiveQueueAvailability {
  available: boolean;
  currentMediaId?: string;
  sessionId?: string;
}

export function detailMenuCapabilities(
  actions: readonly string[],
): DetailMenuCapabilities {
  const published = new Set(actions);
  return {
    collection: published.has('collection.add'),
    playlist: published.has('playlist.add'),
    queue: published.has('queue.add'),
    rating: published.has('rating.set'),
    reaction: published.has('reaction.set'),
  };
}

export async function editableDetailTargets(
  client: Pick<PorticoClient, 'collections' | 'playlists'>,
  kind: DetailSavedTargetKind,
  signal?: AbortSignal,
): Promise<DetailSavedTarget[]> {
  const page =
    kind === 'playlist'
      ? await (signal
          ? client.playlists({limit: 100}, {signal})
          : client.playlists({limit: 100}))
      : await (signal
          ? client.collections({limit: 100}, {signal})
          : client.collections({limit: 100}));
  return page.items.filter(target => target.canEdit);
}

export async function addMediaToDetailTarget(
  client: Pick<
    PorticoClient,
    'mutateCollectionMemberships' | 'mutatePlaylistItems'
  >,
  kind: DetailSavedTargetKind,
  target: DetailSavedTarget,
  mediaId: string,
  signal?: AbortSignal,
): Promise<void> {
  if (!target.canEdit) {
    throw new Error(`This ${kind} is read-only.`);
  }
  if (kind === 'playlist') {
    const body = {
      addMediaIds: [mediaId],
      expectedUpdatedAt: target.updatedAt,
    };
    await (signal
      ? client.mutatePlaylistItems(target.id, body, {signal})
      : client.mutatePlaylistItems(target.id, body));
    return;
  }
  const body = {
    addMediaIds: [mediaId],
    expectedUpdatedAt: target.updatedAt,
  };
  await (signal
    ? client.mutateCollectionMemberships(target.id, body, {signal})
    : client.mutateCollectionMemberships(target.id, body));
}

export async function createDetailTarget(
  client: Pick<PorticoClient, 'createCollection' | 'createPlaylist'>,
  kind: DetailSavedTargetKind,
  title: string,
  mediaId: string,
  signal?: AbortSignal,
): Promise<DetailSavedTarget> {
  const normalizedTitle = title.trim();
  if (!normalizedTitle) {
    throw new Error(`Enter a ${kind} name.`);
  }
  const body = {
    mediaIds: [mediaId],
    title: normalizedTitle,
    visibility: 'private' as const,
  };
  return kind === 'playlist'
    ? signal
      ? client.createPlaylist(body, {signal})
      : client.createPlaylist(body)
    : signal
      ? client.createCollection(body, {signal})
      : client.createCollection(body);
}

export async function activeQueueAvailability(
  client: Pick<PorticoClient, 'playbackSessionQueue' | 'restoreActivePlayback'>,
  _signal?: AbortSignal,
): Promise<ActiveQueueAvailability> {
  const restored = await client.restoreActivePlayback();
  if (!restored.active || !restored.playback) return {available: false};
  const queue = await client.playbackSessionQueue(restored.playback.sessionId);
  return {
    available: queue.canMutate,
    currentMediaId: queue.current.id,
    sessionId: restored.playback.sessionId,
  };
}

export async function addMediaToActiveQueue(
  client: Pick<
    PorticoClient,
    | 'mutatePlaybackSessionQueue'
    | 'playbackSessionQueue'
    | 'restoreActivePlayback'
  >,
  mediaId: string,
  position: DetailQueuePosition,
  signal?: AbortSignal,
): Promise<void> {
  const restored = await client.restoreActivePlayback();
  if (!restored.active || !restored.playback) {
    throw new Error(
      'Start playback on this device before adding another title to its queue.',
    );
  }
  const queue = await client.playbackSessionQueue(restored.playback.sessionId);
  if (!queue.canMutate) {
    throw new Error('The active playback queue cannot be changed.');
  }
  if (queue.current.id === mediaId) {
    throw new Error('This title is already playing.');
  }
  const body = {
    action: position,
    expectedRevision: queue.revision,
    mediaId,
  };
  await (signal
    ? client.mutatePlaybackSessionQueue(restored.playback.sessionId, body, {
        signal,
      })
    : client.mutatePlaybackSessionQueue(restored.playback.sessionId, body));
}
