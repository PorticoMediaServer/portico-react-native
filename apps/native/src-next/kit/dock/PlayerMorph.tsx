import React, {useCallback, useEffect, useMemo, useRef, useState} from 'react';
import {Platform, View} from 'react-native';
import {Gesture} from 'react-native-gesture-handler';
import Animated, {cancelAnimation, runOnJS, useAnimatedReaction, useAnimatedStyle, useSharedValue, withSpring, withTiming} from 'react-native-reanimated';
import {type PlaybackFence} from '../../../../../packages/player-core/src/index';
import {Icon} from '../Icon';
import {useTheme} from '../theme';
import {useMotion} from '../useMotion';
import {currentMorphFence} from './morph-fence';
import {releaseDock, validRect} from './model';
import {alpha, dockStyles} from './visual';
import type {DockRect, PlayerMorphController} from './types';

export type PlayerMorphOptions = {
  docked: boolean;
  travel: number;
  onRelease: (docked: boolean) => void;
};

/** One continuous value is retargeted, including during a reversal. It is never reset to an endpoint. */
export function usePlayerMorph({docked, travel, onRelease}: PlayerMorphOptions): PlayerMorphController {
  const motion = useMotion();
  const progress = useSharedValue(docked ? 1 : 0), velocity = useSharedValue(0), dragging = useSharedValue(false), releaseVelocity = useSharedValue(0);
  const origin = useSharedValue(0), span = useSharedValue(travel), lastTime = useSharedValue(0);
  const callback = useRef(onRelease);
  callback.current = onRelease;
  const released = useCallback((target: boolean) => callback.current(target), []);
  useEffect(() => {span.value = Math.max(1, travel);}, [travel, span]);
  const spring = useMemo(() => motion.spring('player'), [motion]);
  const request = useCallback((target: boolean, speed?: number) => {
    const inherited = speed ?? velocity.value;
    releaseVelocity.value = inherited;
    // Reanimated inherits the running spring's instantaneous velocity on retarget.
    progress.value = spring ? withSpring(target ? 1 : 0, {...spring, velocity: inherited}) : withTiming(target ? 1 : 0, motion.timing());
  }, [progress, velocity, releaseVelocity, spring, motion]);
  useEffect(() => {request(docked);}, [docked, request]);
  useAnimatedReaction(() => progress.value, (value, previous) => {
    const now = performance.now(), elapsed = now - lastTime.value;
    if (!dragging.value && previous !== null && elapsed > 0 && elapsed < 100) velocity.value = (value - previous) * 1000 / elapsed;
    lastTime.value = now;
  });
  const gesture = useMemo(() => Gesture.Pan().activeOffsetY([-10, 10]).failOffsetX([-12, 12])
    .onBegin(() => {cancelAnimation(progress); origin.value = progress.value; dragging.value = true;})
    .onUpdate(event => {
      const value = origin.value + event.translationY / span.value;
      progress.value = value < 0 ? value * .18 : value > 1 ? 1 + (value - 1) * .18 : value;
      velocity.value = event.velocityY / span.value;
    })
    .onEnd(event => {
      const target = releaseDock(progress.value, event.velocityY);
      dragging.value = false;
      releaseVelocity.value = velocity.value;
      progress.value = spring ? withSpring(target, {...spring, velocity: velocity.value}) : withTiming(target, {duration: 160});
      runOnJS(released)(target === 1);
    })
    .onFinalize((_event, success) => {
      if (!success && dragging.value) {
        dragging.value = false;
        progress.value = spring ? withSpring(docked ? 1 : 0, {...spring, velocity: velocity.value}) : withTiming(docked ? 1 : 0, {duration: 160});
      }
    }), [progress, origin, dragging, span, velocity, releaseVelocity, spring, released, docked]);
  return useMemo(() => ({progress, velocity, dragging, releaseVelocity, request, gesture}), [progress, velocity, dragging, releaseVelocity, request, gesture]);
}

export type PlayerMorphProps = {
  controller: PlayerMorphController;
  fence?: PlaybackFence;
  docked: boolean;
  fullFrame: DockRect;
  dockFrame: DockRect;
  /** The SAME child/native surface stays under this parent across every layout state. */
  children: React.ReactNode | ((context: PlayerSurfaceContext) => React.ReactNode);
  /** Real native last-frame capture, fenced to this source. Never a fabricated backdrop/video clone. */
  androidSnapshot?: Readonly<{fence: PlaybackFence; image: React.ReactNode}>;
  onPresentationChange?: (state: Readonly<{fence: PlaybackFence; docked: boolean; moving: boolean; hideSubtitles: boolean}>) => void;
  testID?: string;
};
export type PlayerSurfaceContext = Readonly<{active: boolean; bounds: DockRect; docked: boolean; moving: boolean; subtitlesVisible: boolean}>;

/** Only transforms/opacity move. Native SurfaceView bounds change once on settlement. */
export function PlayerMorph({controller, fence, docked, fullFrame, dockFrame, children, androidSnapshot, onPresentationChange, testID}: PlayerMorphProps) {
  const theme = useTheme(), motion = useMotion();
  const {progress, dragging, velocity} = controller;
  const [frame, setFrame] = useState(docked && validRect(dockFrame) ? dockFrame : fullFrame);
  const [movingFor, setMovingFor] = useState<PlaybackFence | undefined>(undefined);
  const moving = currentMorphFence(movingFor, fence);
  const full = useSharedValue(fullFrame), dock = useSharedValue(dockFrame), base = useSharedValue(frame);
  const target = useSharedValue(docked ? 1 : 0), surfaceFade = useSharedValue(fence ? 1 : 0);
  const active = useSharedValue(fence !== undefined);
  const currentFence = useRef(fence), previousFence = useRef<PlaybackFence | undefined>(undefined);
  currentFence.current = fence;
  useEffect(() => {if (validRect(fullFrame)) full.value = fullFrame; if (validRect(dockFrame)) dock.value = dockFrame;}, [fullFrame, dockFrame, full, dock]);
  useEffect(() => {target.value = docked ? 1 : 0;}, [docked, target]);
  useEffect(() => {
    if (fence === undefined && previousFence.current === undefined || currentMorphFence(previousFence.current, fence)) return;
    previousFence.current = fence;
    active.value = fence !== undefined;
    cancelAnimation(surfaceFade);
    setMovingFor(undefined);
    surfaceFade.value = fence ? 1 : 0;
    // A new source starts at its own actual layout; an idle gap retains no previous fence.
    const nextFrame = docked && validRect(dockFrame) ? dockFrame : fullFrame;
    if (validRect(nextFrame)) {setFrame(nextFrame); base.value = nextFrame;}
  }, [fence, docked, dockFrame, fullFrame, active, surfaceFade, base]);
  const settle = useCallback((value: number) => {
    if (!currentMorphFence(currentFence.current, fence)) return;
    const finalFrame = value === 1 ? dockFrame : fullFrame;
    if (!validRect(finalFrame)) return;
    setFrame(finalFrame);
    base.value = finalFrame;
    setMovingFor(undefined);
    surfaceFade.value = 0;
    surfaceFade.value = withTiming(1, motion.timing());
  }, [fence, fullFrame, dockFrame, base, surfaceFade, motion]);
  const updateMoving = useCallback((value: boolean) => {if (currentMorphFence(currentFence.current, fence)) setMovingFor(value ? fence : undefined);}, [fence]);
  useEffect(() => {if (motion.reduce && !dragging.value) settle(docked ? 1 : 0);}, [docked, motion.reduce, dragging, settle]);
  useAnimatedReaction(() => ({active: active.value, p: progress.value, v: velocity.value, drag: dragging.value, goal: target.value}), (now, previous) => {
    if (!now.active) return;
    const settled = !now.drag && Math.abs(now.p - now.goal) < .002 && Math.abs(now.v) < .02;
    const wasSettled = previous && !previous.drag && Math.abs(previous.p - previous.goal) < .002 && Math.abs(previous.v) < .02;
    if (settled && !wasSettled) runOnJS(settle)(now.goal);
    else if (!settled && wasSettled) runOnJS(updateMoving)(true);
  }, [settle, updateMoving]);
  useEffect(() => {if (fence && currentMorphFence(currentFence.current, fence)) onPresentationChange?.({fence, docked, moving, hideSubtitles: docked || moving});}, [fence, docked, moving, onPresentationChange]);
  const interpolateFrame = () => {
    'worklet';
    const p = progress.value;
    return {x: full.value.x + (dock.value.x - full.value.x) * p, y: full.value.y + (dock.value.y - full.value.y) * p,
      width: full.value.width + (dock.value.width - full.value.width) * p, height: full.value.height + (dock.value.height - full.value.height) * p};
  };
  const surfaceStyle = useAnimatedStyle(() => {
    const rect = interpolateFrame();
    const transform = (motion.transforms || dragging.value) && Platform.OS !== 'android';
    return {opacity: surfaceFade.value, transform: transform ? [{translateX: rect.x - base.value.x + (rect.width - base.value.width) / 2}, {translateY: rect.y - base.value.y + (rect.height - base.value.height) / 2}, {scaleX: rect.width / base.value.width}, {scaleY: rect.height / base.value.height}] : []};
  });
  const previewStyle = useAnimatedStyle(() => {
    const rect = interpolateFrame();
    return {transform: motion.transforms || dragging.value ? [{translateX: rect.x - full.value.x + (rect.width - full.value.width) / 2}, {translateY: rect.y - full.value.y + (rect.height - full.value.height) / 2}, {scaleX: rect.width / full.value.width}, {scaleY: rect.height / full.value.height}] : []};
  });
  const snapshot = Platform.OS === 'android' && androidSnapshot && currentMorphFence(androidSnapshot.fence, fence) ? androidSnapshot.image : null;
  return <View testID={testID} pointerEvents="none" accessibilityElementsHidden={!fence} importantForAccessibility={fence ? 'auto' : 'no-hide-descendants'} style={[dockStyles.fill, {zIndex: theme.layers.player + 1, opacity: fence ? 1 : 0}]}>
    <Animated.View style={[{position: 'absolute', left: frame.x, top: frame.y, width: frame.width, height: frame.height, overflow: 'hidden', borderRadius: docked && !moving ? 7 : 0, backgroundColor: theme.colors.shadow}, surfaceStyle, moving && snapshot ? {opacity: 0} : undefined]}>
      {typeof children === 'function' ? children({active: fence !== undefined, bounds: {x: 0, y: 0, width: frame.width, height: frame.height}, docked, moving, subtitlesVisible: fence !== undefined && !docked && !moving}) : children}
      {fence && docked && !moving && <View style={[dockStyles.expand, {backgroundColor: alpha(theme.colors.dim, .62)}]}><Icon name="i-full" size={11}/></View>}
    </Animated.View>
    {moving && snapshot ? <Animated.View style={[{position: 'absolute', left: fullFrame.x, top: fullFrame.y, width: fullFrame.width, height: fullFrame.height, overflow: 'hidden'}, previewStyle]}>{snapshot}</Animated.View> : null}
  </View>;
}
