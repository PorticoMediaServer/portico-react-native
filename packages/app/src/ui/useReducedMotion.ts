import {useEffect, useState} from 'react';
import {AccessibilityInfo} from 'react-native';

export type PorticoModalAnimation = 'fade' | 'none' | 'slide';

export function modalAnimationTypeFor(
  preferred: Exclude<PorticoModalAnimation, 'none'>,
  reducedMotion: boolean,
): PorticoModalAnimation {
  return reducedMotion ? 'none' : preferred;
}

let cachedReduceMotion: boolean | undefined;

export function useReducedMotion(): boolean {
  // Suppress motion until the asynchronous system preference is known. This
  // avoids animating the first frame for a viewer who has Reduce Motion on.
  const [reduced, setReduced] = useState(cachedReduceMotion ?? true);

  useEffect(() => {
    let mounted = true;
    AccessibilityInfo.isReduceMotionEnabled().then(value => {
      if (mounted) {
        cachedReduceMotion = value;
        setReduced(value);
      }
    });
    const subscription = AccessibilityInfo.addEventListener('reduceMotionChanged', value => {
      cachedReduceMotion = value;
      setReduced(value);
    });
    return () => {
      mounted = false;
      subscription.remove();
    };
  }, []);

  return reduced;
}

export function useModalAnimationType(
  preferred: Exclude<PorticoModalAnimation, 'none'> = 'fade',
): PorticoModalAnimation {
  return modalAnimationTypeFor(preferred, useReducedMotion());
}
