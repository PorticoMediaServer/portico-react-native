import React, {useEffect, useRef} from 'react';
import Animated, {Easing, useAnimatedStyle, useSharedValue, withTiming} from 'react-native-reanimated';
import {Arrivals} from './arrivals';
import {useTheme} from './theme';

/**
 * A card that has just arrived in a list fades in (see `arrivals.ts` for which cards those are).
 *
 * Whether it fades is decided once, when the card is first drawn, and never changes after: a
 * card that does not fade is drawn exactly as before, with nothing around it. The fade is only
 * opacity (no movement, no size change), so the list's layout, snapping and measured row heights
 * are untouched, and it is skipped altogether under Reduce Motion.
 *
 * Television: a view that is fully transparent cannot take focus, so there the fade starts from a
 * faint card rather than from nothing. A card can be focused from its first frame, and focus is
 * never moved by this.
 */
export function Arriving({on, children}: {on: boolean; children: React.ReactElement | null}) {
  const {motion} = useTheme();
  const fades = useRef(on && !motion.reduce).current;
  return fades ? <FadeIn>{children}</FadeIn> : children;
}

function FadeIn({children}: {children: React.ReactNode}) {
  const {motion, isTV} = useTheme();
  const opacity = useSharedValue(isTV ? 0.35 : 0);
  useEffect(() => { opacity.value = withTiming(1, {duration: motion.standard, easing: Easing.out(Easing.cubic)}); }, [opacity, motion.standard]);
  const style = useAnimatedStyle(() => ({opacity: opacity.value}));
  return <Animated.View style={style}>{children}</Animated.View>;
}

/** One tracker for a list, told the list's keys on every draw; answers which cards are arriving. */
export function useArrivals<T>(data: readonly T[], keyOf: (item: T, index: number) => string): (key: string) => boolean {
  const tracker = useRef<Arrivals | null>(null);
  if (!tracker.current) tracker.current = new Arrivals();
  const seen = useRef<readonly T[] | null>(null);
  // Only a changed list is looked at again; the same array is the same cards.
  if (seen.current !== data) { seen.current = data; tracker.current.update(data.map(keyOf), Date.now()); }
  return useRef((key: string) => tracker.current!.arriving(key, Date.now())).current;
}
