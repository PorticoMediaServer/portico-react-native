import React, {useEffect, useRef, useState} from 'react';
import {Animated, type StyleProp, type ViewStyle} from 'react-native';

export type LoadingBoundaryProps = Readonly<{
  /** The real content is ready to render. */
  ready: boolean;
  /** The exact shape of the content that is loading; static, never a shimmer. */
  skeleton: React.ReactNode;
  children?: React.ReactNode;
  /** Cached content draws at once, with no quiet window and no skeleton. */
  immediate?: boolean;
  quietMs?: number;
  skeletonFadeMs?: number;
  contentFadeMs?: number;
  style?: StyleProp<ViewStyle>;
  testID?: string;
}>;

/** A caller that still holds only a bare skeleton gets the drawn loading order:
 * stay quiet for 300 ms, then fade the exact shape in over 120 ms; real content
 * fades over 180 ms. Cached content never waits and never shows a skeleton.
 * Presentation only: callers keep their own read, error and admission state. */
export function LoadingBoundary({ready, skeleton, children, immediate = false, quietMs = 300, skeletonFadeMs = 120, contentFadeMs = 180, style, testID}: LoadingBoundaryProps) {
  const [quietDone, setQuietDone] = useState(immediate);
  const opacity = useRef(new Animated.Value(ready ? 1 : 0)).current;
  useEffect(() => {
    if (ready || immediate) return;
    const timer = setTimeout(() => setQuietDone(true), quietMs);
    return () => clearTimeout(timer);
  }, [ready, immediate, quietMs]);
  const mode = ready ? 'content' : immediate ? 'skeleton' : quietDone ? 'skeleton' : 'quiet';
  useEffect(() => {
    if (mode === 'quiet') { opacity.setValue(0); return; }
    const animation = Animated.timing(opacity, {toValue: 1, duration: mode === 'content' ? contentFadeMs : skeletonFadeMs, useNativeDriver: true});
    animation.start();
    return () => animation.stop();
  }, [mode, opacity, contentFadeMs, skeletonFadeMs]);
  if (mode === 'quiet') return null;
  return <Animated.View testID={testID} style={[style, {opacity}]}>{mode === 'content' ? children : skeleton}</Animated.View>;
}
