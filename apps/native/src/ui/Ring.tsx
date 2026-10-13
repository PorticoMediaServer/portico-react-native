import React, {useEffect, useRef} from 'react';
import {Animated, Easing, type StyleProp, type ViewStyle} from 'react-native';
import {uiI18n} from './i18n';
import {alpha, spec, useSpecPlatform, useTheme} from './theme';

/** The thin ring Portico waits with on every platform: track in the line colour,
 * one accent arc, a steady one-second turn. Reduced motion holds the arc still. */
export function Ring({size, thickness, color, style, label}: {/** Default: the screen-level spinner (44 pt, TV 64). */ size?: number; thickness?: number; color?: string; style?: StyleProp<ViewStyle>; /** "Loading {thing}" (CON-18); never a bare "Loading" when the thing is known. */ label?: string}) {
  const {colors, motion} = useTheme();
  const platform = useSpecPlatform();
  const sp = spec.feedback.spinner;
  size ??= sp.size.screen[platform];
  thickness ??= sp.stroke[platform];
  // Justin (idle CPU): an endless spinner runs on the native driver, so it costs no JavaScript and
  // no layout per frame. (A Reanimated loop here cost ~10% CPU per spinner on the simulator.)
  const turn = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    if (motion.reduce) return;
    const loop = Animated.loop(Animated.timing(turn, {toValue: 1, duration: 1000, easing: Easing.linear, useNativeDriver: true}));
    loop.start();
    return () => loop.stop();
  }, [turn, motion.reduce]);
  const spin = {transform: [{rotate: turn.interpolate({inputRange: [0, 1], outputRange: ['0deg', '360deg']})}]};
  return (
    <Animated.View accessibilityRole="progressbar" accessibilityLabel={label ?? uiI18n().t('status.loading')} style={[{width: size, height: size, borderRadius: size / 2, borderWidth: thickness, borderColor: alpha(color ?? colors[sp.track], sp.trackAlpha), borderTopColor: color ?? colors[sp.arc]}, spin, style]} />
  );
}
