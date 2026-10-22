import {useCallback, useEffect, useRef, useState} from 'react';
import {useTVEventHandler} from 'react-native';
import Animated, {cancelAnimation, scrollTo, useAnimatedReaction, useAnimatedRef, useAnimatedScrollHandler, useSharedValue, withTiming} from 'react-native-reanimated';
import {useTheme} from '../theme';
import {useMotion} from '../useMotion';
import {anchoredOffset} from './model';

/** Native focus search chooses the target. This hook animates only its containing scroll. */
export function useFocusAnchor(horizontal: boolean, ownsFocus = true) {
  const {isTV} = useTheme(), motion = useMotion();
  const scrollRef = useAnimatedRef<Animated.ScrollView>();
  const offset = useSharedValue(0), target = useSharedValue(0), driving = useSharedValue(false);
  const [repeating, setRepeating] = useState(false);
  const last = useRef({key: '', at: 0});
  const release = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  useTVEventHandler(event => {
    if (!isTV || !ownsFocus || !['left', 'right', 'up', 'down'].includes(event.eventType)) return;
    const now = Date.now(), repeat = event.eventKeyAction !== 1 && last.current.key === event.eventType && now - last.current.at < 180;
    last.current = {key: event.eventType, at: now};
    setRepeating(repeat);
    if (release.current) clearTimeout(release.current);
    release.current = setTimeout(() => setRepeating(false), 180);
  });
  useEffect(() => {if (!ownsFocus) {setRepeating(false); last.current = {key: '', at: 0};}}, [ownsFocus]);
  useEffect(() => () => {if (release.current) clearTimeout(release.current);}, []);
  useAnimatedReaction(() => ({value: target.value, active: driving.value}), next => {
    if (next.active) scrollTo(scrollRef, horizontal ? next.value : 0, horizontal ? 0 : next.value, false);
  }, [horizontal]);
  const onScroll = useAnimatedScrollHandler(event => {offset.value = horizontal ? event.contentOffset.x : event.contentOffset.y;});
  const move = useCallback((next: number, immediate = false) => {
    driving.value = false;
    cancelAnimation(target);
    target.value = offset.value;
    driving.value = true;
    target.value = motion.transforms && !immediate ? withTiming(next, motion.timing('slow', repeating ? 'linear' : 'inOut')) : next;
  }, [driving, motion, offset, repeating, target]);
  const anchor = useCallback((start: number, size: number, viewport: number, extent: number, leading = 0, trailing = 0) => {
    move(anchoredOffset(start, size, viewport, offset.value, extent, leading, trailing));
  }, [move, offset]);
  const stop = useCallback(() => {driving.value = false; cancelAnimation(target);}, [driving, target]);
  return {scrollRef, offset, onScroll, move, anchor, stop, repeating};
}

export {anchoredOffset as focusAnchorOffset} from './model';
