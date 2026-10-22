import {useEffect, useMemo, useState} from 'react';
import {AccessibilityInfo} from 'react-native';
import {Easing, ReduceMotion, type WithTimingConfig, type WithSpringConfig} from 'react-native-reanimated';
import {motionPolicy, type MotionCurve, type MotionDuration, type MotionSpring} from '../platform/motion-policy';
import {useTheme} from './theme';
import {easings} from '@portico/design';

export function useReducedMotion(): boolean {
  const {reduceMotion} = useTheme();
  const [system, setSystem] = useState(false);
  useEffect(() => {
    let live = true;
    let changed = false;
    const subscription = AccessibilityInfo.addEventListener('reduceMotionChanged', value => {changed = true; setSystem(value);});
    void AccessibilityInfo.isReduceMotionEnabled().then(value => {if (live && !changed) setSystem(value);}, () => {});
    return () => {live = false; subscription.remove();};
  }, []);
  return reduceMotion || system;
}

const curves = Object.fromEntries(Object.entries(easings).map(([name, value]) => {
  const points = value.match(/-?\d*\.?\d+/g)?.map(Number) as [number, number, number, number] | undefined;
  return [name, points ? Easing.bezier(...points) : Easing.linear];
})) as Record<MotionCurve, ReturnType<typeof Easing.bezier>>;

/** Retarget shared values directly. Reduced movement uses timing() on opacity, never a transform spring. */
export function useMotion() {
  const reduce = useReducedMotion();
  return useMemo(() => {
    const policy = motionPolicy(reduce);
    return {
      ...policy,
      timing: (name: MotionDuration = 'standard', curve: MotionCurve = 'out'): WithTimingConfig => ({duration: policy.duration(name), easing: curves[reduce ? 'linear' : curve], reduceMotion: ReduceMotion.Never}),
      spring: (name: MotionSpring = 'settle', velocity = 0): WithSpringConfig | undefined => {
        const config = policy.spring(name, velocity);
        return config ? {...config, reduceMotion: ReduceMotion.Never} : undefined;
      },
    };
  }, [reduce]);
}
