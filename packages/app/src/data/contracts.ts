import type {MediaItem as ClientMediaItem} from '@portico/client-core';

export type ServerMediaAction = ClientMediaItem['actions'][number];

/** Presentation contract retained by the promoted Prototype 4 components. */
export type MediaKind =
  | 'movie'
  | 'show'
  | 'season'
  | 'episode'
  | 'person'
  | 'collection'
  | 'artist'
  | 'album'
  | 'track'
  | 'author'
  | 'book'
  | 'chapter'
  | 'recording'
  | 'live-channel'
  | 'live-program';

export type MediaShape = 'poster' | 'landscape' | 'square';

/** Stable production render contract consumed by the promoted Prototype 4 cards. */
export interface MediaCardRenderItem {
  id: string;
  kind: MediaKind;
  title: string;
  subtitle?: string;
  summary?: string;
  year?: number;
  duration?: string;
  genre?: string;
  poster: string;
  backdrop: string;
  shape?: MediaShape;
  progress?: number;
  parentId?: string;
  grandparentId?: string;
}

export type MediaAction =
  | 'play'
  | 'resume'
  | 'download'
  | 'watchlist.add'
  | 'watchlist.remove'
  | 'favorite.add'
  | 'favorite.remove'
  | 'watched.set'
  | 'reaction.set'
  | 'rating.set'
  | 'collection.add'
  | 'playlist.add'
  | 'queue.add';

export interface MediaStateViewModel {
  favorite: boolean;
  progressSeconds: number;
  reaction?: '' | 'like' | 'dislike';
  watched: boolean;
  watchlisted: boolean;
}

/**
 * Deliberately matches Prototype 4's MediaItem surface while retaining the
 * complete server object for later detail/player behavior.
 */
export interface MediaViewModel extends MediaCardRenderItem {
  contentRating?: string;
  durationSeconds?: number;
  parentTitle?: string;
  childIds?: string[];
  actions: MediaAction[];
  serverActions: ServerMediaAction[];
  state: MediaStateViewModel;
  playbackMediaId: string;
}

/** Full detail resources retain the authoritative wire object for mutations. */
export interface MediaDetailViewModel extends MediaViewModel {
  raw: ClientMediaItem;
}

export interface HomeRowViewModel {
  id: string;
  title: string;
  explanation?: string;
  shape: MediaShape;
  items: MediaViewModel[];
  critical: boolean;
  defaultVisible: boolean;
  hideable: boolean;
  reorderable: boolean;
  required: boolean;
  hasMore: boolean;
  nextCursor?: string;
  endpoint?: string;
  kind?: string;
  libraryId?: string;
  policyState?: string;
}

export interface HomeViewModel {
  pivots: string[];
  rows: HomeRowViewModel[];
  continueWatchingRow?: HomeRowViewModel;
  /** iOS uses this item; tvOS changes hero selection within the same row. */
  initialHero?: MediaViewModel;
}

/** Common collection shape for Library, Saved, Search, and recommendation rows. */
export interface MediaCollectionViewModel {
  id: string;
  title: string;
  explanation?: string;
  items: MediaViewModel[];
  shape: MediaShape;
  hasMore: boolean;
  nextCursor?: string;
}

/** Minimal channel contract that keeps platform UI independent from API DTOs. */
export interface ChannelViewModel {
  id: string;
  name: string;
  number?: string;
  callSign?: string;
  logo?: string;
  favorite: boolean;
  raw: unknown;
}
