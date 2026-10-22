import {easings, motion, motionRules, reducedMotion, springs} from '@portico/design';

export type MotionDuration = keyof typeof motion;
export type MotionCurve = keyof typeof easings;
export type MotionSpring = keyof typeof springs;

/** Reduced motion fades settled states; a live drag continues to follow its finger. */
export function motionPolicy(reduce: boolean) {
  return {
    reduce,
    transforms: !reduce,
    fingerTracking: reducedMotion.fingerTracking,
    rules: motionRules,
    duration: (name: MotionDuration) => reduce ? reducedMotion.durationMs : motion[name],
    curve: (name: MotionCurve) => reduce ? reducedMotion.easing : easings[name],
    spring: (name: MotionSpring, velocity = 0) => reduce ? undefined : {...springs[name], velocity},
  };
}
