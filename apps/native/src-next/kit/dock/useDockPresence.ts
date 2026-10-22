import {useCallback, useEffect, useRef, useState} from 'react';
import {sameFence} from '../../../../../packages/player-core/src/index';
import {cancelAnimation, runOnJS, useAnimatedStyle, useSharedValue, withDelay, withTiming} from 'react-native-reanimated';
import {useMotion} from '../useMotion';
import type {DockOccupant} from './types';

/** Retain only outgoing chrome while it leaves; its controls cannot dispatch to a new source. */
export function useDockPresence(wanted: DockOccupant | null, tv: boolean) {
  const motion = useMotion();
  const [shown, setShown] = useState(wanted);
  const previous = useRef(shown), epoch = useRef(0);
  previous.current = shown;
  const opacity = useSharedValue(wanted ? 1 : 0);
  const finishExit = useCallback((version: number) => {if (epoch.current === version) setShown(null);}, []);
  useEffect(() => {
    // Retire this run through the live counter, without invalidating a newer run.
    const ownedEpoch = epoch, animation = opacity;
    const version = ++ownedEpoch.current;
    const old = previous.current;
    if (!wanted) {
      animation.value = withTiming(0, motion.timing('quick', 'in'), finished => {if (finished) runOnJS(finishExit)(version);});
    } else if (old && sameFence(old.playback.fence, wanted.playback.fence) && old.mode === wanted.mode) {
      setShown(wanted);
      animation.value = withTiming(1, motion.timing('standard'));
    } else {
      const returningPaused = !wanted.remote && !wanted.playback.playing && (wanted.mode === 'music' || wanted.mode === 'audiobook');
      setShown(wanted);
      animation.value = 0;
      animation.value = withDelay(returningPaused && motion.transforms ? tv ? 300 : 200 : 0, withTiming(1, motion.timing('standard')));
    }
    return () => {
      if (ownedEpoch.current !== version) return;
      ownedEpoch.current++;
      cancelAnimation(animation);
    };
  }, [wanted, tv, motion, opacity, finishExit]);
  const style = useAnimatedStyle(() => ({opacity: opacity.value, transform: tv ? [{translateX: motion.transforms ? 12 * (1 - opacity.value) : 0}] : [{translateY: motion.transforms ? 12 * (1 - opacity.value) : 0}]}));
  return {shown, style};
}
