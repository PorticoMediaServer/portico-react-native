import React, {useEffect, useRef, useState} from 'react';
import {Animated, Easing, type StyleProp, type ViewStyle} from 'react-native';
import {useMotion} from '../useMotion';
import {cachedAfterLoadingCycle, contentFadeDuration, contentFadeEasing, nextLoadingPhase, type LoadingPhase} from './loading-boundary-model';

export type LoadingBoundaryProps = Readonly<{
  /** The real content is ready to render. */
  ready: boolean;
  /** The exact shape of the content that is loading. Shapes own their own arrival. */
  skeleton: React.ReactNode;
  children?: React.ReactNode;
  /** Content that was already cached when the boundary mounted: no quiet window, no fade. */
  immediate?: boolean;
  quietMs?: number;
  contentFadeMs?: number;
  style?: StyleProp<ViewStyle>;
  testID?: string;
}>;

/** A caller that still holds only a bare skeleton gets the drawn loading order:
 * stay quiet for 300 ms, then show the exact shape (its own arrival fade), and
 * fade real content over 180 ms — 160 ms linear under the shared reduced-motion
 * policy, otherwise the design system's out curve. Every fresh loading cycle
 * starts its own quiet window, and a cached mount only skips the very first
 * fade. Presentation only: callers keep their own read, error and admission state. */
export function LoadingBoundary({ready, skeleton, children, immediate = false, quietMs = 300, contentFadeMs = 180, style, testID}: LoadingBoundaryProps) {
  const motion = useMotion();
  const cached = useRef(immediate && ready);
  const phaseRef = useRef<LoadingPhase>(nextLoadingPhase('quiet', {type: 'mounted', ready, cached: cached.current}));
  const [phase, setPhase] = useState<LoadingPhase>(phaseRef.current);
  const opacity = useRef(new Animated.Value(cached.current ? 1 : 0)).current;
  const animation = useRef<Animated.CompositeAnimation | undefined>(undefined);
  const stop = () => {animation.current?.stop(); animation.current = undefined;};
  useEffect(() => stop, []);
  useEffect(() => {
    if (!ready) {
      stop();
      cached.current = cachedAfterLoadingCycle(cached.current, false);
      if (phaseRef.current !== 'quiet') {phaseRef.current = 'quiet'; setPhase('quiet');}
      const timer = setTimeout(() => {
        const next = nextLoadingPhase(phaseRef.current, {type: 'quietElapsed'});
        phaseRef.current = next; setPhase(next);
      }, quietMs);
      return () => clearTimeout(timer);
    }
    const alreadyContent = phaseRef.current === 'content';
    const next = nextLoadingPhase(phaseRef.current, {type: 'readyChanged', ready});
    if (!alreadyContent) {phaseRef.current = next; setPhase(next);}
    stop();
    if (cached.current) {opacity.setValue(1); return;}
    if (!alreadyContent) opacity.setValue(0);
    const easing = motion.reduce ? Easing.linear : Easing.bezier(...contentFadeEasing.out);
    const fade = Animated.timing(opacity, {toValue: 1, duration: contentFadeDuration(motion.reduce, contentFadeMs, motion.duration('standard')), easing, useNativeDriver: true});
    animation.current = fade;
    fade.start(() => {animation.current = undefined;});
  }, [ready, quietMs, contentFadeMs, motion, opacity]);
  if (phase === 'quiet') return null;
  return <Animated.View testID={testID} style={[style, phase === 'content' ? {opacity} : null]}>{phase === 'content' ? children : skeleton}</Animated.View>;
}
