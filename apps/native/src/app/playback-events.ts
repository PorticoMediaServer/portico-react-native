import {useEffect, useRef} from 'react';
import {useTVEventHandler} from 'react-native';
import {focusReturn, isFocusIntent} from '../ui/focus-return';
import {keyReports} from '../ui/key-reports';

/**
 * APL-HOME-03 / TV-PLAYER-03: what the player tells the rest of the app.
 *
 * - `changed`: viewing progress moved (the player closed, a title finished, or every minute while
 *   playing). Home, Detail and Saved refresh so Continue Watching and "Resume" are current.
 * - The control that started playback is captured by name, and focus goes back to it when the
 *   player closes (NAV-10.8), instead of to the rail: see `focusReturn`.
 */
export type PlaybackChange = {itemId?: string; positionSeconds: number; completed: boolean; reason: 'closed' | 'ended' | 'progress'};
const listeners = new Set<(change: PlaybackChange) => void>();

export function emitPlaybackChange(change: PlaybackChange) {
  for (const l of [...listeners]) l(change);
}

/** Calls `refresh` (debounced 1 s) whenever viewing progress changes. */
export function useRefreshOnPlayback(refresh: () => void, filter?: (change: PlaybackChange) => boolean) {
  const latest = useRef(refresh);
  latest.current = refresh;
  const accept = useRef(filter);
  accept.current = filter;
  useEffect(() => {
    let timer: ReturnType<typeof setTimeout> | undefined;
    const listener = (change: PlaybackChange) => {
      if (accept.current && !accept.current(change)) return;
      clearTimeout(timer);
      timer = setTimeout(() => latest.current(), 1000);
    };
    listeners.add(listener);
    return () => { clearTimeout(timer); listeners.delete(listener); };
  }, []);
}

/**
 * Focus coming back after playback (TV-PLAYER-03, NAV-10.8) is `focusReturn` (ui/focus-return.ts):
 * the player captures the named control it was started from as it starts, and gives focus back to
 * it, confirmed, once it has closed. Nothing here holds a control.
 */
export {focusReturn};

/**
 * The player's side of focus coming back (PlayerHost): the origin belongs to `viewer` only (a new
 * server, account or profile forgets it), and focus goes back to it once the player no longer
 * `covering` the screens: closed, ended, or audio sent on to the now-playing pill. Television only.
 *
 * A key pressed on the remote while focus is still on its way back ends the return (the person
 * has moved on), and the host going away forgets the origin and any return it started.
 */
export function usePlayerFocusReturn(covering: boolean, viewer: string, tv: boolean) {
  useEffect(() => {
    focusReturn.setOwner(viewer);
  }, [viewer]);
  // Unmounted: nothing it captured or started outlives it (another host starts from nothing).
  useEffect(() => () => focusReturn.setOwner(''), []);
  const was = useRef(false);
  useEffect(() => {
    if (!tv) return;
    if (was.current && !covering) focusReturn.restore();
    was.current = covering;
  }, [covering, tv]);
  useTVEventHandler(event => { if (tv && isFocusIntent(event, keyReports())) focusReturn.intent(); });
}
