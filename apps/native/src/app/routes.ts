import type {ContentView} from '../../../../packages/client-core/src/library-content';
import type {LibraryTabId} from '../../../../packages/client-core/src/presentation/index';

/**
 * Route table for the content stack. The rail switches the root route; the
 * stack pushes entity/detail routes on top of it. Names are stable strings so
 * deep links and focus restoration can address them.
 */
export type ContentStackParams = {
  Home: undefined;
  /** A Home row's See all (Recommended, Trending now, a Picks for you row). */
  HomeRow: {rowId: string; title?: string};
  /** `genre`: open the grid filtered to this genre (a genre pressed on a title page). */
  Library: {libraryId: string; tab?: LibraryTabId; category?: string; genre?: string};
  Entity: {libraryId: string; view: ContentView; entityId: string; title?: string};
  Detail: {libraryId: string; itemId: string};
  /** `episodeId`: the episode the page is opened for (from a row elsewhere, or a link): its season shows, it is brought into view and marked a moment; nothing is opened. */
  Show: {libraryId: string; showId?: string; seasonId?: string; episodeId?: string; title?: string};
  Search: undefined;
  Person: {personId: string; name?: string};
  Saved: {view?: 'watchlist' | 'favorites' | 'playlists' | 'history'};
  Playlist: {playlistId: string; title?: string};
  SavedResource: {resourceId: string; title?: string};
  /** `entry`: a source or view to open (All channels, one source, Recordings). */
  Channels: {entry?: string} | undefined;
  /** `linkTV`: open "Link a TV" (portico://device). */
  Settings: {linkTV?: boolean} | undefined;
  /** One page of Settings by its address (`settingsPageId`): `playback`, `quality`, `server-dashboard`. */
  SettingsPage: {address: string};
  Account: undefined;
  Servers: undefined;
  About: undefined;
  /** Settings › About › Open-source licenses, and one component's licence (`id` from the generated list). */
  Licences: undefined;
  Licence: {id: string};
  Notifications: undefined;
  Downloads: undefined;
  /** `code`: a Watch Together invite code to join (portico://together/join/<c>). */
  Together: {code?: string} | undefined;
  Gallery: undefined;
  /** An invitation from portico://invite (its secret is held in memory by the screen module). */
  Invitation: undefined;
  Recordings: undefined;
};

export type RailDestination = 'Home' | 'Search' | 'Saved' | 'Channels' | 'Settings' | {library: string};
