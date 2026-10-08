import React, {useEffect, useRef} from 'react';
import Animated, {Easing, useAnimatedStyle, useSharedValue, withTiming} from 'react-native-reanimated';
import {useTheme} from './theme';

/**
 * Television focus treatment for artwork: a crisp pale ring hugging the image
 * plus a soft blue glow behind it. Sized to the artwork only so captions stay
 * untouched. Renders nothing on handheld.
 */
type HaloProps = {active: boolean; width: number; height: number; radius: number};

export const FocusHalo = React.memo(function FocusHalo(props: HaloProps) {
  // Handheld renders nothing, so it must not pay for the shared value,
  // animated style and effect below on every card.
  const {isTV} = useTheme();
  // PERF-S11: a card that has never been focused draws no halo, so it isn't mounted until the
  // first focus (it then fades in from 0 as before, and stays mounted to fade out).
  const focused = useRef(false);
  if (props.active) focused.current = true;
  return isTV && focused.current ? <Halo {...props} /> : null;
});

function Halo({active, width, height, radius}: HaloProps) {
  const {colors, metrics, motion} = useTheme();
  const value = useSharedValue(0);
  useEffect(() => {
    value.value = withTiming(active ? 1 : 0, {duration: motion.reduce ? 0 : motion.quick, easing: Easing.out(Easing.cubic)});
  }, [active, value, motion]);
  const style = useAnimatedStyle(() => ({opacity: value.value}));
  const ring = metrics.focusRing;
  return (
    <>
      <Animated.View pointerEvents="none" style={[{position: 'absolute', top: 0, left: 0, width, height, borderRadius: radius, backgroundColor: colors.ink, shadowColor: colors.accentHover, shadowOpacity: 0.7, shadowRadius: 28, shadowOffset: {width: 0, height: 10}}, style]} />
      <Animated.View pointerEvents="none" style={[{position: 'absolute', top: -ring - 2, left: -ring - 2, width: width + ring * 2 + 4, height: height + ring * 2 + 4, borderRadius: radius + ring + 2, borderWidth: ring, borderColor: colors.focus, zIndex: 2}, style]} />
    </>
  );
}
