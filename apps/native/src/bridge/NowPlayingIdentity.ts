import {activeI18n} from '../app/errors';

export type NowPlayingIdentity = {
  itemId?: string; title: string; posterUrl?: string; kind?: string; libraryId?: string;
  artist?: string; album?: string;
};
type Item = { song?: {artist:string;albumTitle:string}; id: string; title: string; posterUrl?: string; kind?: string; libraryId?: string };
/** Caller supplies the exact service/viewer/item fence; partial browse entries cannot erase known song facts. */
export function resolveNowPlayingIdentity(previous: NowPlayingIdentity, sameOwnerAndItem: boolean,
  item?: Item, song?: { artist: string; albumTitle: string }): NowPlayingIdentity {
  song ??= item?.song;
  const retained = sameOwnerAndItem ? previous : undefined;
  if (!item) return retained ?? { title: activeI18n().t('player.queueNowPlaying') };
  return {
    itemId: item.id, title: item.title,
    posterUrl: item.posterUrl ?? retained?.posterUrl,
    kind: item.kind ?? retained?.kind,
    libraryId: item.libraryId ?? retained?.libraryId,
    artist: song?.artist ?? retained?.artist,
    album: song?.albumTitle ?? retained?.album,
  };
}
