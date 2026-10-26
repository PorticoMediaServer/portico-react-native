import React, {useEffect, useRef, useState} from 'react';
import {Animated, type StyleProp, type ViewStyle} from 'react-native';
import {useMotion} from '../useMotion';

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

export type LoadingPhase = 'quiet' | 'skeleton' | 'content';
export type LoadingEvent = Readonly<{type: 'mounted'; ready: boolean; cached: boolean}> | Readonly<{type: 'quietElapsed'}> | Readonly<{type: 'readyChanged'; ready: boolean}>;
/** The drawn order, as one transfer function: a cached ready mount goes straight to
 * content; anything else starts quiet; the quiet window reveals the shape; and only a
 * real ready change leaves a phase, so a repeat ready does not restart the window. */
export function nextLoadingPhase(previous: LoadingPhase, event: LoadingEvent): LoadingPhase {
  if (event.type === 'mounted') return event.ready && event.cached ? 'content' : 'quiet';
  if (event.type === 'quietElapsed') return previous === 'quiet' ? 'skeleton' : previous;
  return event.ready ? 'content' : 'quiet';
}
/** Reduced motion uses the shared reduced duration for the content fade. */
export function contentFadeDuration(reduce: boolean, base = 180, reduced = 160): number {
  return reduce ? reduced : base;
}

/** A caller that still holds only a bare skeleton gets the drawn loading order:
 * stay quiet for 300 ms, then show the exact shape (its own arrival fade), and
 * fade real content over 180 ms — 160 ms under the shared reduced-motion policy.
 * Every fresh loading cycle starts its own quiet window. Presentation only:
 * callers keep their own read, error and admission state. */
export function LoadingBoundary({ready, skeleton, children, immediate = false, quietMs = 300, contentFadeMs = 180, style, testID}: LoadingBoundaryProps) {
  const motion = useMotion();
  const cached = useRef(immediate && ready).current;
  const phaseRef = useRef<LoadingPhase>(nextLoadingPhase('quiet', {type: 'mounted', ready, cached}));
  const [phase, setPhase] = useState<LoadingPhase>(phaseRef.current);
  const opacity = useRef(new Animated.Value(cached ? 1 : 0)).current;
  useEffect(() => {
    if (!ready) {
      if (phaseRef.current !== 'quiet') {phaseRef.current = 'quiet'; setPhase('quiet');}
      const timer = setTimeout(() => {const next = nextLoadingPhase(phaseRef.current, {type: 'quietElapsed'}); phaseRef.current = next; setPhase(next);}, quietMs);
      return () => clearTimeout(timer);
    }
    const next = nextLoadingPhase(phaseRef.current, {type: 'readyChanged', ready});
    if (next === phaseRef.current) return;
    phaseRef.current = next;
    setPhase(next);
    if (cached) {opacity.setValue(1); return;}
    opacity.setValue(0);
    const animation = Animated.timing(opacity, {toValue: 1, duration: contentFadeDuration(motion.reduce, contentFadeMs, motion.duration('standard')), useNativeDriver: true});
    animation.start();
    return () => animation.stop();
  }, [ready, quietMs, contentFadeMs, motion, opacity, cached]);
  if (phase === 'quiet') return null;
  return <Animated.View testID={testID} style={[style, phase === 'content' ? {opacity} : null]}>{phase === 'content' ? children : skeleton}</Animated.View>;
}
