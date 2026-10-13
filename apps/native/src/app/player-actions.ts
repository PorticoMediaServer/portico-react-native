import {createContext, useContext} from 'react';
import type {GuideChannel} from '../../../../packages/client-core/src/channel-guide';
import type {ContentEntry} from '../../../../packages/client-core/src/library-content';
import type {SequenceContainer} from './container-play';
import type {OfflineEntry} from '../bridge/offline-downloads';

/**
 * Player and action-sheet intents, provided by the shell so any screen can
 * start playback or open the actions sheet for an entry without holding a
 * reference to the player itself.
 */
export type PlayerActions = {
  play: (itemId: string, startSeconds: number, entry?: ContentEntry) => void;
  /** `container`: the show, season, collection, playlist or book these entries come from; on Playback v1 it plays as one server request. */
  playSequence: (entries: readonly ContentEntry[], index: number, startSeconds: number, container?: SequenceContainer) => void;
  /** `lineup`: how to read the guide's channels, for channel up and down in the player (FEAT-07). */
  tune: (channel: GuideChannel, lineup?: () => Promise<readonly GuideChannel[]>) => void;
  /** `origin`: where the card sits, for actions only that place offers (X-12). */
  more: (entry: ContentEntry, origin?: EntryOrigin) => void;
  /** Whether there is a play queue to add to right now (one exists once something has been played, or was restored at launch). */
  canQueue?: () => boolean;
  /** Adds a title to the play queue: straight after what is playing (`next`), or at the end. Rejects with the server's error. */
  enqueue?: (itemId: string, next: boolean) => Promise<void>;
  /** OS-07: play a download in Portico's player. Present wherever the player is mounted: the
   * signed-in shell and the launch flow's offline Downloads. */
  playLocal?: (entry: OfflineEntry) => Promise<void>;
};

/** Where a menu is opened from, when that changes what it offers: a Continue Watching card can
 * leave its row; a recommendation offers Not interested; a title's own page already has
 * Watchlist, Favorite and Watched on its action row, so its ⋯ does not repeat them (nor Details). */
export type EntryOrigin = 'continue_watching' | 'recommendation' | 'page';

export const PlayerActionsContext = createContext<PlayerActions>({play: () => {}, playSequence: (_entries, _index, _startSeconds, _container) => {}, tune: () => {}, more: () => {}});

export function usePlayerActions(): PlayerActions {
  return useContext(PlayerActionsContext);
}

/** Whether a full-screen player presentation currently covers the shell. */
export const PlayerVisibilityContext = createContext(false);
export function usePlayerVisible(): boolean {
  return useContext(PlayerVisibilityContext);
}

/** The item playing now, so a list can mark its row. */
export const PlayingItemContext = createContext<string | undefined>(undefined);
export function usePlayingItemId(): string | undefined {
  return useContext(PlayingItemContext);
}
