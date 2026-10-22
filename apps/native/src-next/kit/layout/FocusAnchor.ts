import {useCallback, useEffect, useRef, useState} from 'react';
import {useTVEventHandler} from 'react-native';
import Animated, {cancelAnimation, scrollTo, useAnimatedReaction, useAnimatedRef, useAnimatedScrollHandler, useSharedValue, withTiming} from 'react-native-reanimated';
import {useTheme} from '../theme';
import {useMotion} from '../useMotion';
import {anchoredOffset} from './model';

/** Native focus search chooses the target. This hook animates only its containing scroll. */
export function useFocusAnchor(horizontal: boolean, ownsFocus = true, alignment: 'visible' | 'start' = 'visible') {
  const {isTV} = useTheme(), motion = useMotion();
  const scrollRef = useAnimatedRef<Animated.ScrollView>();
  const offset = useSharedValue(0), target = useSharedValue(0), driving = useSharedValue(false);
  const [repeating, setRepeating] = useState(false);
  // Native repeat and focus notifications may arrive before React commits.
  // The timing decision must follow that stroke, not the previous render.
  const repeatStroke = useRef(false), destination = useRef(0);
  const last = useRef({key: '', at: 0});
  const release = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  useTVEventHandler(event => {
    if (!isTV || !ownsFocus || !(horizontal ? ['left', 'right'] : ['up', 'down']).includes(event.eventType)) return;
    if (release.current) clearTimeout(release.current);
    const now = Date.now(), repeat = event.eventKeyAction !== 1 && last.current.key === event.eventType && now - last.current.at < 180;
    last.current = event.eventKeyAction === 1 ? {key: '', at: 0} : {key: event.eventType, at: now};
    repeatStroke.current = repeat;
    setRepeating(repeat);
    release.current = event.eventKeyAction === 1 ? undefined : setTimeout(() => {
      repeatStroke.current = false; last.current = {key: '', at: 0}; setRepeating(false);
    }, 180);
  });
  useAnimatedReaction(() => ({value: target.value, active: driving.value}), next => {
    if (next.active) scrollTo(scrollRef, horizontal ? next.value : 0, horizontal ? 0 : next.value, false);
  }, [horizontal]);
  const onScroll = useAnimatedScrollHandler(event => {offset.value = horizontal ? event.contentOffset.x : event.contentOffset.y;});
  const move = useCallback((next: number, immediate = false) => {
    destination.current = next;
    driving.value = false;
    cancelAnimation(target);
    target.value = offset.value;
    driving.value = true;
    target.value = motion.transforms && !immediate ? withTiming(next, motion.timing('slow', repeatStroke.current ? 'linear' : 'inOut')) : next;
  }, [driving, motion, offset, target]);
  const anchor = useCallback((start: number, size: number, viewport: number, extent: number, leading = 0, trailing = 0) => {
    move(alignment === 'start' ? Math.max(0, Math.min(Math.max(0, extent - viewport), start - leading))
      : anchoredOffset(start, size, viewport, offset.value, extent, leading, trailing));
  }, [alignment, move, offset]);
  const stop = useCallback(() => {driving.value = false; cancelAnimation(target);}, [driving, target]);
  useEffect(() => {
    if (!ownsFocus) {
      stop(); repeatStroke.current = false; setRepeating(false); last.current = {key: '', at: 0};
      if (release.current) clearTimeout(release.current);
    }
  }, [ownsFocus, stop]);
  useEffect(() => {
    if (!motion.transforms && driving.value) {cancelAnimation(target); target.value = destination.current;}
  }, [driving, motion.transforms, target]);
  useEffect(() => () => {stop(); if (release.current) clearTimeout(release.current);}, [stop]);
  return {scrollRef, offset, onScroll, move, anchor, stop, repeating};
}

export {anchoredOffset as focusAnchorOffset} from './model';
