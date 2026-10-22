import {useCallback, useEffect, useRef, useState} from 'react';
import {sameFence} from '../../../../../packages/player-core/src/index';
import {runOnJS, useAnimatedStyle, useSharedValue, withDelay, withTiming} from 'react-native-reanimated';
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
    const version = ++epoch.current;
    const old = previous.current;
    if (!wanted) {
      opacity.value = withTiming(0, motion.timing('quick', 'in'), finished => {if (finished) runOnJS(finishExit)(version);});
    } else if (old && sameFence(old.playback.fence, wanted.playback.fence) && old.mode === wanted.mode) {
      setShown(wanted);
    } else {
      const returningPaused = !wanted.remote && !wanted.playback.playing && (wanted.mode === 'music' || wanted.mode === 'audiobook');
      setShown(wanted);
      opacity.value = 0;
      opacity.value = withDelay(returningPaused && motion.transforms ? tv ? 300 : 200 : 0, withTiming(1, motion.timing('standard')));
    }
    return () => {epoch.current++;};
  }, [wanted, tv, motion, opacity, finishExit]);
  const style = useAnimatedStyle(() => ({opacity: opacity.value, transform: tv ? [{translateX: motion.transforms ? 12 * (1 - opacity.value) : 0}] : [{translateY: motion.transforms ? 12 * (1 - opacity.value) : 0}]}));
  return {shown, style};
}
