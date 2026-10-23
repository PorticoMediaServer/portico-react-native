import {useEffect, useRef, useState} from 'react';
import type {GestureResponderEvent} from 'react-native';
import {createTouchHold, type TouchHoldPhase} from './touch-hold';

/** The native timer owns the threshold; Pressability's wider retention area cannot fire it. */
export function useTouchHold(onFire: () => void, enabled: boolean) {
  const callback = useRef(onFire), allowed = useRef(enabled); callback.current = onFire; allowed.current = enabled;
  const [phase, setPhase] = useState<TouchHoldPhase>('idle');
  const [hold] = useState(() => createTouchHold(() => {if (allowed.current) callback.current();}, setPhase, {
    schedule: (run, delay) => setTimeout(run, delay), cancel: ticket => clearTimeout(ticket as ReturnType<typeof setTimeout>),
  }));
  useEffect(() => () => hold.dispose(), [hold]);
  useEffect(() => {if (!enabled) hold.cancel();}, [enabled, hold]);
  return {phase, consumePress: hold.consumePress, cancel: hold.cancel, end: hold.end, handlers: {
    onTouchStart(event: GestureResponderEvent) {
      if (!enabled) return;
      if (event.nativeEvent.touches.length !== 1) {hold.cancel(); return;}
      hold.start({x: event.nativeEvent.pageX, y: event.nativeEvent.pageY});
    },
    onTouchMove: (event: GestureResponderEvent) => hold.move({x: event.nativeEvent.pageX, y: event.nativeEvent.pageY}),
    onTouchEnd: () => hold.end(), onTouchCancel: () => hold.cancel(),
  }};
}
