import {useCallback, useSyncExternalStore} from 'react';
import {playerSessionChoices} from '../../../../packages/client-core/src/player-session-choices';

/** A choice made in the player, for this playback only (`playbackRun`): the next episode keeps
 * it, a new playback starts from `settings` again. Nothing is stored on the device or the profile. */
export function usePlaybackChoice<T>(name: string, run: number, settings: T): readonly [T, (next: T) => void] {
  useSyncExternalStore(playerSessionChoices.subscribe, playerSessionChoices.getVersion);
  const value = playerSessionChoices.get(name, run, settings);
  const set = useCallback((next: T) => playerSessionChoices.set(name, run, next), [name, run]);
  return [value, set] as const;
}
