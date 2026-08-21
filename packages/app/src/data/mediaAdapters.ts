import type {HomeResponse, HomeRow, MediaCard, MediaItem, PorticoClient} from '@porticomediaserver/client-core';
import type {
  HomeRowViewModel,
  HomeViewModel,
  MediaAction,
  MediaCollectionViewModel,
  MediaDetailViewModel,
  MediaKind,
  MediaShape,
  MediaViewModel,
  ServerMediaAction,
} from './contracts';

type ImageClient = Pick<PorticoClient, 'imageResourceUrl'>;
type MediaContext = 'default' | 'continue-watching';

const mediaKinds = new Set<MediaKind>([
  'movie', 'show', 'season', 'episode', 'person', 'collection', 'artist',
  'album', 'track', 'author', 'book', 'chapter', 'recording',
  'live-channel', 'live-program',
]);

const supportedActions = new Set<MediaAction>([
  'play', 'download', 'watchlist.add', 'watchlist.remove', 'favorite.add',
  'favorite.remove', 'watched.set', 'reaction.set', 'rating.set',
  'collection.add', 'playlist.add', 'queue.add',
]);

export function mediaViewModel(
  item: MediaItem,
  client: ImageClient,
  context: MediaContext = 'default',
): MediaDetailViewModel {
  const continueEpisode = context === 'continue-watching' && item.type === 'episode';
  const progressSeconds = Math.max(0, item.state.progressSeconds ?? 0);
  const progress = progressPercent(progressSeconds, item.durationSeconds, item.state.watched);
  const serverActions = [...item.actions];
  const actions = mapActions(serverActions, progress !== undefined);

  return {
    id: item.id,
    kind: normalizeMediaKind(item.type),
    title: continueEpisode ? item.grandparentTitle ?? item.parentTitle ?? item.title : item.title,
    subtitle: continueEpisode ? item.title : mediaSubtitle(item),
    summary: item.summary,
    year: item.year,
    contentRating: item.contentRating,
    duration: formatDuration(item.durationSeconds),
    durationSeconds: item.durationSeconds,
    genre: item.genres[0],
    poster: imageUrl(item.images.poster, client, {width: 780}),
    // A graphical hero is part of the approved Apple design. Some legitimate
    // records have no dedicated backdrop, so fall back through other artwork
    // supplied for the same media item instead of rendering a black panel.
    backdrop: imageUrl(item.displayImages?.backdrop || item.images.backdrop || item.images.thumb || item.images.poster, client, {width: 1920}),
    shape: mediaShape(item.type),
    progress,
    parentId: item.parentId,
    grandparentId: item.grandparentId,
    parentTitle: item.parentTitle,
    childIds: item.children?.map(child => child.id),
    actions,
    serverActions,
    state: {
      favorite: item.state.favorite,
      progressSeconds,
      reaction: item.state.reaction,
      watched: item.state.watched,
      watchlisted: item.state.watchlisted,
    },
    playbackMediaId: item.playbackTarget?.id ?? item.id,
    raw: item,
  };
}

/** Adapts the canonical paginated card projection without inventing a detail DTO. */
export function mediaCardViewModel(item: MediaCard, client: ImageClient): MediaViewModel {
  const progressSeconds = Math.max(0, item.userState.progressSeconds ?? 0);
  const progress = progressPercent(progressSeconds, item.durationSeconds, item.userState.watched);
  const fields = item.fields ?? {};
  const parentId = typeof fields.parentId === 'string' ? fields.parentId : undefined;
  const grandparentId = typeof fields.grandparentId === 'string' ? fields.grandparentId : undefined;
  return {
    id: item.id,
    kind: normalizeMediaKind(item.entityKind),
    title: item.title,
    subtitle: item.subtitle,
    summary: item.summary,
    year: item.year,
    duration: formatDuration(item.durationSeconds),
    durationSeconds: item.durationSeconds,
    poster: imageUrl(item.artwork.poster || item.artwork.thumb || item.artwork.backdrop, client, {width: 780}),
    backdrop: imageUrl(item.artwork.backdrop || item.artwork.thumb || item.artwork.poster, client, {width: 1920}),
    shape: mediaShape(item.entityKind),
    progress,
    parentId,
    grandparentId,
    actions: mapActions([...item.actions], progress !== undefined),
    serverActions: [...item.actions],
    state: {
      favorite: item.userState.favorite,
      progressSeconds,
      watched: item.userState.watched,
      watchlisted: item.userState.watchlisted,
    },
    playbackMediaId: item.id,
  };
}

export function homeViewModel(
  response: HomeResponse,
  client: ImageClient,
  preferences: {rowOrder?: readonly string[]; hiddenRowIds?: readonly string[]} = {},
): HomeViewModel {
  const hidden = new Set(preferences.hiddenRowIds ?? []);
  const order = new Map((preferences.rowOrder ?? []).map((id, index) => [id, index]));
  const serverOrder = new Map(response.rows.map((row, index) => [row.id, index]));
  const visibleRows = response.rows
    .filter(row => (row.required || !hidden.has(row.id)) && (row.defaultVisible || order.has(row.id)))
    .sort((left, right) => {
      const leftIndex = order.get(left.id);
      const rightIndex = order.get(right.id);
      if (leftIndex !== undefined || rightIndex !== undefined)
        return (leftIndex ?? Number.MAX_SAFE_INTEGER) - (rightIndex ?? Number.MAX_SAFE_INTEGER);
      return (serverOrder.get(left.id) ?? 0) - (serverOrder.get(right.id) ?? 0);
    })
    .map(row => homeRowViewModel(row, client));
  const continueWatchingRow = visibleRows.find(
    row => isContinueWatchingRow(row) && row.items.length > 0,
  );

  return {
    pivots: [...response.pivots],
    rows: visibleRows,
    continueWatchingRow,
    initialHero: continueWatchingRow?.items[0],
  };
}

export function homeRowViewModel(row: HomeRow, client: ImageClient): HomeRowViewModel {
  const context: MediaContext = isContinueRow(row) ? 'continue-watching' : 'default';
  return {
    id: row.id,
    title: row.title,
    explanation: row.explanation,
    // The approved Home treatment deliberately uses poster cards in every row.
    shape: 'poster',
    items: (row.items ?? []).map(item => mediaViewModel(item, client, context)),
    critical: row.critical ?? false,
    defaultVisible: row.defaultVisible,
    hideable: row.hideable,
    reorderable: row.reorderable,
    required: row.required,
    hasMore: Boolean(row.hasMore && row.nextCursor),
    nextCursor: row.nextCursor,
    endpoint: row.endpoint,
    kind: row.kind,
    libraryId: row.libraryId,
    policyState: row.policyState,
  };
}

export function mediaCollectionViewModel(
  id: string,
  title: string,
  items: MediaItem[],
  client: ImageClient,
  options: {explanation?: string; hasMore?: boolean; nextCursor?: string; shape?: MediaShape} = {},
): MediaCollectionViewModel {
  return {
    id,
    title,
    explanation: options.explanation,
    items: items.map(item => mediaViewModel(item, client)),
    shape: options.shape ?? 'poster',
    hasMore: options.hasMore ?? false,
    nextCursor: options.nextCursor,
  };
}

function isContinueWatchingRow(row: HomeRowViewModel): boolean {
  return row.id === 'continue' || row.kind === 'continue' || row.policyState === 'continue';
}

function isContinueRow(row: HomeRow): boolean {
  return row.id === 'continue' || row.type === 'continue' || row.kind === 'continue';
}

function normalizeMediaKind(type: string): MediaKind {
  const normalized = type.toLowerCase().replaceAll('_', '-');
  if (mediaKinds.has(normalized as MediaKind)) return normalized as MediaKind;
  if (normalized === 'tv' || normalized === 'tv-show' || normalized === 'series') return 'show';
  if (normalized === 'audiobook') return 'book';
  if (normalized === 'live-channel') return 'live-channel';
  if (normalized === 'live-program') return 'live-program';
  return 'collection';
}

function mediaShape(type: string): MediaShape | undefined {
  const normalized = normalizeMediaKind(type);
  if (normalized === 'artist' || normalized === 'album' || normalized === 'track' || normalized === 'book' || normalized === 'author') return 'square';
  if (normalized === 'episode' || normalized === 'recording' || normalized === 'live-channel' || normalized === 'live-program') return 'landscape';
  return undefined;
}

function mediaSubtitle(item: MediaItem): string | undefined {
  if (item.type === 'episode') {
    const episode = episodeLabel(item);
    return episode ?? item.grandparentTitle ?? item.parentTitle;
  }
  return item.tagline ?? item.grandparentTitle ?? item.parentTitle;
}

function episodeLabel(item: MediaItem): string | undefined {
  const season = item.seasonNumber ?? item.indexNumber;
  const episode = item.episodeNumber;
  if (season !== undefined && episode !== undefined) return `S${season} E${episode}`;
  if (episode !== undefined) return `E${episode}`;
  return undefined;
}

function progressPercent(progressSeconds: number, durationSeconds: number | undefined, watched: boolean): number | undefined {
  if (watched || progressSeconds <= 0 || !durationSeconds || durationSeconds <= 0) return undefined;
  return Math.min(100, Math.max(0, (progressSeconds / durationSeconds) * 100));
}

function mapActions(actions: ServerMediaAction[], resumable: boolean): MediaAction[] {
  const mapped: MediaAction[] = [];
  for (const action of actions) {
    if (action === 'play' && resumable) {
      mapped.push('resume');
    } else if (supportedActions.has(action as MediaAction)) {
      mapped.push(action as MediaAction);
    }
  }
  return mapped;
}

function imageUrl(path: string | undefined, client: ImageClient, size: {width: number}): string {
  return path ? client.imageResourceUrl(path, size) : '';
}

export function formatDuration(seconds: number | undefined): string | undefined {
  if (!seconds || seconds <= 0) return undefined;
  const totalMinutes = Math.round(seconds / 60);
  const hours = Math.floor(totalMinutes / 60);
  const minutes = totalMinutes % 60;
  if (hours === 0) return `${minutes}m`;
  if (minutes === 0) return `${hours}h`;
  return `${hours}h ${minutes}m`;
}
