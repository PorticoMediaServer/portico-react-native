import {useEffect, useRef} from 'react';
import type {FocusableHandle} from '../ui';

/**
 * APL-HOME-03 / TV-PLAYER-03: what the player tells the rest of the app.
 *
 * - `changed`: viewing progress moved (the player closed, a title finished, or every minute while
 *   playing). Home, Detail and Saved refresh so Continue Watching and "Resume" are current.
 * - The control that started playback is remembered, and focus goes back to it when the player
 *   closes (NAV-10.8), instead of to the rail.
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

let invoker: FocusableHandle | null = null;
/** Remember the control that is starting playback (TV). */
export function rememberInvoker(handle: FocusableHandle | null) {
  invoker = handle;
}
/** Return focus to it once the player has gone (TV). */
export function restoreInvoker() {
  const target = invoker;
  if (!target) return;
  setTimeout(() => target.focus(), 250);
}

/** A ref for a play control plus `remember()` to call as it starts playback. */
export function useInvoker() {
  const ref = useRef<FocusableHandle>(null);
  return {ref, remember: () => rememberInvoker(ref.current)};
}
