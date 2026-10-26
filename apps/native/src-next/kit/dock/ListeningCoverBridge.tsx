import React, {createContext, useCallback, useContext, useLayoutEffect, useMemo, useRef, useState, type RefObject} from 'react';
import {View} from 'react-native';
import Animated, {useAnimatedStyle} from 'react-native-reanimated';
import {sameFence, type PlaybackFence} from '../../../../../packages/player-core/src';
import type {ArtworkSource} from '../artwork';
import {useMotion} from '../useMotion';
import {useTheme} from '../theme';
import {ListeningCoverPaint} from './ListeningCoverPaint';
import {validRect} from './model';
import type {DockRect, PlayerMorphController} from './types';

type Publication = Readonly<{fence: PlaybackFence; source: ArtworkSource; controller: PlayerMorphController; scope: object | undefined; opening: object; current: () => boolean}>;
type Slot = 'full' | 'mini';
type Frame = Readonly<{fence: PlaybackFence; scope: object | undefined; opening: object; bounds: DockRect}>;
type ContextValue = Readonly<{canvas: RefObject<View | null>; revision: number; binding?: Publication; full?: Frame; mini?: Frame; decoded: boolean;
  publish: (value: Publication) => () => void; report: (kind: Slot, value: Frame) => void}>;
const Context = createContext<ContextValue | undefined>(undefined);
const sameSource = (a: ArtworkSource, b: ArtworkSource) => a.cacheKey === b.cacheKey && a.uri === b.uri
  && Object.keys(a.headers ?? {}).length === Object.keys(b.headers ?? {}).length
  && Object.keys(a.headers ?? {}).every(key => a.headers?.[key] === b.headers?.[key]);
const belongs = (frame: Frame | undefined, value: Publication | undefined, kind: Slot): frame is Frame => !!frame && !!value
  && frame.scope === value.scope && sameFence(frame.fence, value.fence) && (kind === 'mini' || frame.opening === value.opening);

/** Authority-scoped UI geometry and one passive cover image. No player, command,
 * read lifetime or output is owned here. A missing actual slot draws no morph. */
export function ListeningCoverProvider({children}: {children: React.ReactNode}) {
  const theme = useTheme(), canvas = useRef<View>(null);
  const [revision, setRevision] = useState(0);
  const [binding, setBinding] = useState<Publication>();
  const [full, setFull] = useState<Frame>(), [mini, setMini] = useState<Frame>();
  const [decodedSource, setDecodedSource] = useState<{source: ArtworkSource; width: number; height: number}>();
  const publish = useCallback((value: Publication) => {
    setBinding(value);
    return () => setBinding(now => now === value ? undefined : now);
  }, []);
  const report = useCallback((kind: Slot, frame: Frame) => {
    const set = kind === 'full' ? setFull : setMini;
    set(previous => previous && previous.scope === frame.scope && previous.opening === frame.opening && sameFence(previous.fence, frame.fence)
      && Object.keys(frame.bounds).every(key => frame.bounds[key as keyof DockRect] === previous.bounds[key as keyof DockRect]) ? previous : frame);
  }, []);
  const active = binding?.current() === true;
  const fullFrame = belongs(full, binding, 'full') ? full.bounds : undefined, miniFrame = belongs(mini, binding, 'mini') ? mini.bounds : undefined;
  const decodeFrame = fullFrame ?? miniFrame;
  const request = useMemo(() => ({binding, width: decodeFrame?.width, height: decodeFrame?.height}), [binding, decodeFrame?.width, decodeFrame?.height]);
  const latestRequest = useRef(request); latestRequest.current = request;
  const decoded = !!binding && !!decodedSource && !!decodeFrame && sameSource(binding.source, decodedSource.source)
    && decodedSource.width === decodeFrame.width && decodedSource.height === decodeFrame.height;
  const value = useMemo(() => ({canvas, revision, binding, full, mini, decoded, publish, report}), [revision, binding, full, mini, decoded, publish, report]);
  return <Context.Provider value={value}>{children}{!theme.isTV && <View ref={canvas} collapsable={false} pointerEvents="none" accessible={false}
    accessibilityElementsHidden importantForAccessibility="no-hide-descendants" onLayout={() => setRevision(value => value + 1)}
    style={{position: 'absolute', inset: 0, zIndex: theme.layers.player + 1}}>
    {active && binding && miniFrame && decodeFrame && <CoverLayer binding={binding} full={fullFrame} mini={miniFrame} decoded={decoded}
      onReady={source => {if (latestRequest.current === request && binding.current() && sameSource(source, binding.source)) setDecodedSource({source, width: decodeFrame.width, height: decodeFrame.height});}}/>}
  </View>}</Context.Provider>;
}

function CoverLayer({binding, full, mini, decoded, onReady}: {binding: Publication; full?: DockRect; mini: DockRect; decoded: boolean; onReady: (source: ArtworkSource) => void}) {
  const motion = useMotion(), {progress, dragging} = binding.controller;
  const moving = useAnimatedStyle(() => {
    const p = progress.value;
    const travelling = dragging.value || motion.transforms && p > .0001 && p < .9999;
    return {opacity: decoded && full && travelling ? 1 : 0};
  }, [decoded, full, motion.transforms, progress, dragging]);
  // Before the full slot exists, decode the same source at the actual mini frame.
  // This is never promoted to a guessed full target or shown as a moving cover.
  return <Animated.View pointerEvents="none" accessible={false} accessibilityElementsHidden importantForAccessibility="no-hide-descendants"
    style={[{position: 'absolute', inset: 0}, moving]}>
    <ListeningCoverPaint source={binding.source} full={full ?? mini} mini={mini} progress={progress} onReady={onReady}/>
  </Animated.View>;
}

export function useListeningCoverPublication(value: Publication | undefined) {
  const publish = useContext(Context)?.publish;
  useLayoutEffect(() => {if (publish && value) return publish(value);}, [publish, value]);
}

/** Measure the original native slot into the persistent host's coordinate space.
 * Retain only that measured geometry after a business publisher unmounts. Late
 * callbacks cannot publish through a replaced node, scope, fence or publication. */
export function useListeningCoverSlot(fence: PlaybackFence | undefined, kind: Slot, node: RefObject<View | null>, enabled = true) {
  const context = useContext(Context), motion = useMotion();
  const binding = context?.binding;
  const matching = !!fence && !!binding && sameFence(fence, binding.fence);
  const own = matching && enabled;
  const live = useRef(false), generation = useRef(0), latest = useRef({binding, own}); latest.current = {binding, own};
  useLayoutEffect(() => {const mounted = live, epoch = generation; mounted.current = true; return () => {mounted.current = false; epoch.current++;};}, []);
  const report = context?.report, canvas = context?.canvas, revision = context?.revision;
  const measure = useCallback(() => {
    void revision;
    const source = binding, element = node.current, host = canvas?.current, version = ++generation.current;
    if (!own || !source || !element || !host || !source.current()) return;
    const current = () => live.current && generation.current === version && node.current === element && canvas?.current === host
      && latest.current.binding === source && latest.current.own && source.current();
    element.measureInWindow((x, y, width, height) => {
      if (!current() || !validRect({x, y, width, height})) return;
      host.measureInWindow((hx, hy, hostWidth, hostHeight) => {
        if (!current() || !validRect({x: hx, y: hy, width: hostWidth, height: hostHeight})) return;
        report?.(kind, {fence: source.fence, scope: source.scope, opening: source.opening, bounds: {x: x - hx, y: y - hy, width, height}});
      });
    });
  }, [binding, own, node, report, kind, canvas, revision]);
  useLayoutEffect(() => {measure();}, [measure]);
  const usable = matching && binding?.current() === true && context?.decoded && belongs(context.full, binding, 'full') && belongs(context.mini, binding, 'mini');
  const progress = binding?.controller.progress, dragging = binding?.controller.dragging;
  const style = useAnimatedStyle(() => {
    if (!usable || !progress || !dragging) return {opacity: 1};
    const p = progress.value;
    return {opacity: dragging.value || motion.transforms && p > .0001 && p < .9999 ? 0 : 1};
  }, [usable, progress, dragging, motion.transforms]);
  return {measure, style};
}
