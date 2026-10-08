// The shared `ui/Feedback.tsx`, with the loading ring drawn in a way Vega can turn.
import React, {useEffect, useRef} from 'react';
import {Animated, Easing, View, type StyleProp, type ViewStyle} from 'react-native';
import Svg, {Path} from 'react-native-svg';
import {uiI18n} from '../../../../../native/src/ui/i18n';
import {alpha, spec, useSpecPlatform, useTheme} from '../../../../../native/src/ui/theme';
import {animations} from '../../../shims/motion';

export * from '../../../../../native/src/ui/Feedback';

/**
 * The shared ring is one view: rounded, its border the track color with the top side in the
 * accent, turned once a second. On Vega OS 1.2 (SDK 0.24) a view with rounded corners and
 * border sides of different colors stops the app from responding as soon as it, or a view around
 * it, rotates. (Either property alone turns without trouble.)
 *
 * So here the track is a still ring and the arc is a quarter circle drawn as a path, in a view of
 * its own that turns over it. Same size, stroke, colors, arc and speed.
 */
export function Ring({size, thickness, color, style, label}: {size?: number; thickness?: number; color?: string; style?: StyleProp<ViewStyle>; label?: string}) {
  const {colors, motion} = useTheme();
  const platform = useSpecPlatform();
  const sp = spec.feedback.spinner;
  size ??= sp.size.screen[platform];
  thickness ??= sp.stroke[platform];
  const still = motion.reduce || !animations;
  const turn = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    if (still) return;
    const loop = Animated.loop(Animated.timing(turn, {toValue: 1, duration: 1000, easing: Easing.linear, useNativeDriver: true}));
    loop.start();
    return () => loop.stop();
  }, [turn, still]);
  const spin = {transform: [{rotate: turn.interpolate({inputRange: [0, 1], outputRange: ['0deg', '360deg']})}]};
  // The top quarter of the circle, along the middle of the stroke.
  const center = size / 2, radius = (size - thickness) / 2, reach = radius * Math.SQRT1_2;
  const arc = `M ${center - reach} ${center - reach} A ${radius} ${radius} 0 0 1 ${center + reach} ${center - reach}`;
  return (
    <View accessibilityRole="progressbar" accessibilityLabel={label ?? uiI18n().t('status.loading')} style={[{width: size, height: size}, style]}>
      <View style={{position: 'absolute', left: 0, top: 0, width: size, height: size, borderRadius: size / 2, borderWidth: thickness, borderColor: alpha(color ?? colors[sp.track], sp.trackAlpha)}} />
      <Animated.View style={[{position: 'absolute', left: 0, top: 0, width: size, height: size}, spin]}>
        <Svg width={size} height={size} viewBox={`0 0 ${size} ${size}`}>
          <Path d={arc} stroke={color ?? colors[sp.arc]} strokeWidth={thickness} fill="none" />
        </Svg>
      </Animated.View>
    </View>
  );
}
