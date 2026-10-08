import {useEffect, useRef} from 'react';
import {NativeEventEmitter, NativeModules, Platform} from 'react-native';

/**
 * The Siri Remote's touch surface as an absolute position (tvOS), for scrubbing the way the
 * system player does: rest a finger and slide to move through the film, click to jump
 * (FEAT-12 / OS-05). Also reports quick swipes, which the player can use for
 * "swipe down → subtitles and audio" and "swipe up → close".
 *
 * Only active while `enabled` (for example: the timeline is focused, or the player is paused),
 * so it never competes with focus navigation elsewhere in the app.
 *
 * `touch`: `x` and `y` run from -1 (left/bottom) to 1 (right/top); `phase` is 'began' when a
 * finger lands, 'changed' while it moves (about 30 per second), 'ended' when it lifts.
 * `swipe`: a fast flick in one direction.
 */
export type SiriRemoteTouch = {phase: 'began' | 'changed' | 'ended'; x: number; y: number};
export type SiriRemoteSwipe = {direction: 'up' | 'down' | 'left' | 'right'};

const native = Platform.isTV ? (NativeModules.PorticoSiriRemote as undefined | {setEnabled(enabled: boolean): void}) : undefined;
const emitter = native ? new NativeEventEmitter(NativeModules.PorticoSiriRemote) : null;

export function useSiriRemoteTouch(enabled: boolean, onTouch: (touch: SiriRemoteTouch) => void, onSwipe?: (swipe: SiriRemoteSwipe) => void): void {
  const touch = useRef(onTouch), swipe = useRef(onSwipe);
  touch.current = onTouch; swipe.current = onSwipe;
  useEffect(() => {
    if (!native || !emitter || !enabled) return;
    const a = emitter.addListener('PorticoSiriRemoteTouch', (e: SiriRemoteTouch) => touch.current(e));
    const b = emitter.addListener('PorticoSiriRemoteSwipe', (e: SiriRemoteSwipe) => swipe.current?.(e));
    native.setEnabled(true);
    return () => { native.setEnabled(false); a.remove(); b.remove(); };
  }, [enabled]);
}

/**
 * Maps a touch session to a scrub target: the finger's travel across the surface covers
 * `span` of the duration (default a tenth), starting from where playback was when it landed.
 */
export function scrubTarget(startSeconds: number, startX: number, x: number, durationSeconds: number, span = 0.1): number {
  // A full left-to-right slide (x from -1 to 1) moves `span` of the duration.
  const target = startSeconds + ((x - startX) / 2) * durationSeconds * span;
  return Math.max(0, Math.min(durationSeconds, target));
}
