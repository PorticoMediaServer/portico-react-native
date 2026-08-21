import type {MediaViewModel} from './contracts';

export interface DetailRouteSelection {
  name: 'detail';
  mediaId: string;
  seasonId?: string;
  episodeId?: string;
  mediaKind?: 'live-channel' | 'live-program';
}

/** Resolve hierarchy-aware detail routes from canonical server identities. */
export function detailRouteForMedia(
  item: Pick<MediaViewModel, 'id' | 'kind' | 'parentId' | 'grandparentId'>,
): DetailRouteSelection {
  if (item.kind === 'episode' && item.grandparentId) {
    return {name: 'detail', mediaId: item.grandparentId, seasonId: item.parentId, episodeId: item.id};
  }
  if (item.kind === 'season' && item.parentId) {
    return {name: 'detail', mediaId: item.parentId, seasonId: item.id};
  }
  return item.kind === 'live-channel' || item.kind === 'live-program'
    ? {name: 'detail', mediaId: item.kind === 'live-program' ? (item.parentId ?? item.id) : item.id, mediaKind: 'live-channel'}
    : {name: 'detail', mediaId: item.id};
}
