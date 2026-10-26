import React, {useEffect, useRef, useState} from 'react';
import {Animated, Easing, type StyleProp, type ViewStyle} from 'react-native';
import {useMotion} from '../useMotion';
import {contentFadeDuration, contentFadeEasing} from './loading-boundary-model';

export type LoadingPaintProps = Readonly<{
  /** Real content is ready: only its paint changes, never its ancestry. */
  ready: boolean;
  /** The exact static shape to paint over the content while it is loading. */
  skeleton: React.ReactNode;
  children?: React.ReactNode;
  /** Content that was already ready when this mounted: no quiet window, no fade. */
  immediate?: boolean;
  quietMs?: number;
  contentFadeMs?: number;
  style?: StyleProp<ViewStyle>;
  testID?: string;
}>;

/** A non-gating paint presenter for callers whose real child owns admission and
 * lifetime (the reader host's WebView). Children are always rendered in the same
 * native ancestry; ready only controls opacity. A quiet 300 ms window then paints
 * the supplied static shape over them, never taking layout, focus or input, and
 * the content fades over 180 ms — 160 ms linear under reduced motion. */
export function LoadingPaint({ready, skeleton, children, immediate = false, quietMs = 300, contentFadeMs = 180, style, testID}: LoadingPaintProps) {
  const motion = useMotion();
  const cached = useRef(immediate && ready).current;
  const [quietDone, setQuietDone] = useState(cached);
  const opacity = useRef(new Animated.Value(ready ? (cached ? 1 : 0) : 0)).current;
  const animation = useRef<Animated.CompositeAnimation | undefined>(undefined);
  const entered = useRef(cached);
  const stop = () => {animation.current?.stop(); animation.current = undefined;};
  useEffect(() => stop, []);
  // Quiet window only: a policy change never restarts it.
  useEffect(() => {
    if (ready) {setQuietDone(true); return;}
    setQuietDone(cached);
    const timer = setTimeout(() => setQuietDone(true), quietMs);
    return () => clearTimeout(timer);
  }, [ready, quietMs, cached]);
  // Paint only: retargets from the current opacity, never gates the child.
  useEffect(() => {
    if (!ready) {stop(); opacity.setValue(0); entered.current = false; return;}
    stop();
    if (cached || entered.current) {opacity.setValue(1); entered.current = true; return;}
    opacity.setValue(0);
    entered.current = true;
    const easing = motion.reduce ? Easing.linear : Easing.bezier(...contentFadeEasing.out);
    const fade = Animated.timing(opacity, {toValue: 1, duration: contentFadeDuration(motion.reduce, contentFadeMs, motion.duration('standard')), easing, useNativeDriver: true});
    animation.current = fade;
    fade.start(() => {if (animation.current === fade) animation.current = undefined;});
  }, [ready, motion, contentFadeMs, opacity, cached]);
  return <Animated.View testID={testID} style={[style, {flex: 1}]}>
    <Animated.View style={{flex: 1, opacity}}>{children}</Animated.View>
    {!ready && quietDone && <Animated.View pointerEvents="none" accessible={false} accessibilityElementsHidden importantForAccessibility="no-hide-descendants"
      style={{position: 'absolute', inset: 0}}>{skeleton}</Animated.View>}
  </Animated.View>;
}
