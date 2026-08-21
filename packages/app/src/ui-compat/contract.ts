export type PrototypePlatform = 'mobile' | 'tv';

export type GlobalDestination =
  | 'home'
  | 'libraries'
  | 'live-tv'
  | 'search'
  | 'saved';

export type SupportingRoute =
  | 'profile'
  | 'settings'
  | 'server-switcher'
  | 'scenario-lab';

export type PrototypeRoute =
  | {name: GlobalDestination}
  | {name: 'library'; libraryId: string; tab?: string}
  | {name: 'detail'; mediaId: string; seasonId?: string; episodeId?: string}
  | {name: 'saved-resource'; resourceId: string}
  | {name: 'live-channel'; channelId: string}
  | {name: 'player'; mediaId: string; live?: boolean}
  | {name: 'now-playing'}
  | {name: 'watch-together'; roomId?: string}
  | {name: 'sign-in'}
  | {name: 'server-discovery'}
  | {name: 'tv-pairing'}
  | {name: SupportingRoute};

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

export interface MediaItem {
  id: string;
  kind: MediaKind;
  title: string;
  subtitle?: string;
  summary?: string;
  year?: number;
  contentRating?: string;
  duration?: string;
  genre?: string;
  poster: string;
  backdrop: string;
  shape?: MediaShape;
  progress?: number;
  parentId?: string;
  grandparentId?: string;
  parentTitle?: string;
  childIds?: string[];
  actions: MediaAction[];
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
  | 'queue.add'
  | 'shuffle'
  | 'instant-mix'
  | 'dvr.record'
  | 'dvr.cancel';

export interface HomeRow {
  id: string;
  title: string;
  explanation?: string;
  shape: MediaShape;
  itemIds: string[];
  critical?: boolean;
}

export type LibraryKind =
  | 'movies'
  | 'tv'
  | 'anime'
  | 'music'
  | 'audiobooks'
  | 'recorded-tv';

export interface LibraryDefinition {
  id: string;
  kind: LibraryKind;
  name: string;
  description: string;
  tabs: readonly string[];
  itemIds: string[];
}

export interface SavedResource {
  id: string;
  kind: 'playlist' | 'collection' | 'view';
  title: string;
  summary: string;
  itemIds: string[];
  visibility: 'private' | 'shared' | 'server';
}

export interface LiveChannel {
  id: string;
  number: string;
  name: string;
  callSign: string;
  color: string;
  logoText: string;
}

export interface GuideProgram {
  id: string;
  channelId: string;
  title: string;
  subtitle?: string;
  startsAt: string;
  endsAt: string;
  live?: boolean;
  recording?: boolean;
}

export type ScenarioId =
  | 'healthy'
  | 'first-load'
  | 'empty-server'
  | 'filtered-empty'
  | 'stale-offline'
  | 'partial-row-failure'
  | 'artwork-failure'
  | 'permission-denied'
  | 'session-expired'
  | 'server-unreachable'
  | 'media-unavailable'
  | 'no-live-source'
  | 'tuner-busy'
  | 'guide-unavailable'
  | 'recording-conflict'
  | 'playback-buffering'
  | 'playback-fatal';

export interface ScenarioDefinition {
  id: ScenarioId;
  label: string;
  description: string;
  area: 'global' | 'home' | 'library' | 'live-tv' | 'player';
}

export interface ConceptAppProps {
  platform: PrototypePlatform;
  initialScenario?: ScenarioId;
}

export const GLOBAL_DESTINATIONS: ReadonlyArray<{
  id: GlobalDestination;
  label: string;
}> = [
  {id: 'home', label: 'Home'},
  {id: 'libraries', label: 'Libraries'},
  {id: 'live-tv', label: 'Live TV'},
  {id: 'search', label: 'Search'},
  {id: 'saved', label: 'Saved'},
];

export const SAVED_TABS = [
  'Watchlist',
  'Favorites',
  'Playlists',
  'Collections',
  'Saved views',
] as const;

export const LIVE_TV_TABS = ['Guide', 'Channels', 'DVR'] as const;
