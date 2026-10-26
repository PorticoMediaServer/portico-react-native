import React, {createContext, useCallback, useContext, useEffect, useLayoutEffect, useMemo, useRef, useState, useSyncExternalStore, type RefObject} from 'react';
import {View, type StyleProp, type ViewStyle} from 'react-native';
import Animated, {cancelAnimation, useAnimatedReaction, useAnimatedStyle, useSharedValue, withDelay, withTiming, type SharedValue} from 'react-native-reanimated';
import {sameFence, type PlaybackFence} from '../../../../../packages/player-core/src';
import type {ArtworkSource} from '../artwork';
import {useMotion} from '../useMotion';
import {useTheme} from '../theme';
import type {OverlayPaintPermit} from '../overlays/SurfacePaintHost';
import {useOverlayPaintMode} from '../overlays/OverlayPaintContext';
import {ListeningCoverPaint} from './ListeningCoverPaint';
import {validRect} from './model';
import type {DockRect, PlayerMorphController} from './types';

type Publication = Readonly<{fence: PlaybackFence; source?: ArtworkSource; controller: PlayerMorphController; scope: object | undefined; opening: object; current: () => boolean; subscribe?: (listener: () => void) => () => void}>;
type Slot = 'full' | 'mini';
type Frame = Readonly<{fence: PlaybackFence; scope: object | undefined; opening: object; revision: number; bounds: DockRect}>;
type ContextValue = Readonly<{canvas: RefObject<View | null>; revision: number; binding?: Publication; full?: Frame; mini?: Frame; decoded: boolean; active: boolean; pageAlpha: SharedValue<number>; pageHeight: SharedValue<number>; reportPageHeight: (height: number) => void; groups: readonly SharedValue<number>[]; pageOwner?: Readonly<{fence: PlaybackFence}>; holdPage: (owner: Readonly<{fence: PlaybackFence}>) => () => void;
  publish: (value: Publication) => () => void; report: (kind: Slot, value: Frame) => void}>;
const Context = createContext<ContextValue | undefined>(undefined);
const noSubscribe = () => () => {};
const notCurrent = () => false;
const sameSource = (a: ArtworkSource, b: ArtworkSource) => a.cacheKey === b.cacheKey && a.uri === b.uri
  && Object.keys(a.headers ?? {}).length === Object.keys(b.headers ?? {}).length
  && Object.keys(a.headers ?? {}).every(key => a.headers?.[key] === b.headers?.[key]);
const belongs = (frame: Frame | undefined, value: Publication | undefined, kind: Slot, revision: number): frame is Frame => !!frame && !!value
  && frame.revision === revision && frame.scope === value.scope && sameFence(frame.fence, value.fence) && (kind === 'mini' || frame.opening === value.opening);

/** Authority-scoped UI geometry and one passive cover image. No player, command,
 * read lifetime or output is owned here. A missing actual slot draws no morph. */
export function ListeningCoverProvider({children}: {children: React.ReactNode}) {
  const theme = useTheme(), motion = useMotion(), canvas = useRef<View>(null);
  const pageHeight = useSharedValue(0), pageAlpha = useSharedValue(0), first = useSharedValue(0), second = useSharedValue(0), third = useSharedValue(0);
  const reportPageHeight = useCallback((height: number) => {pageHeight.value = Number.isFinite(height) && height > 0 ? height : 0;}, [pageHeight]);
  const groups = useMemo(() => [first, second, third] as const, [first, second, third]);
  const [revision, setRevision] = useState(0);
  const [binding, setBinding] = useState<Publication>();
  const [pageOwner, setPageOwner] = useState<Readonly<{fence: PlaybackFence}>>();
  const holdPage = useCallback((owner: Readonly<{fence: PlaybackFence}>) => {
    setPageOwner(owner);
    return () => setPageOwner(current => current === owner ? undefined : current);
  }, []);
  const [full, setFull] = useState<Frame>(), [mini, setMini] = useState<Frame>();
  const [decodedSource, setDecodedSource] = useState<{source: ArtworkSource; width: number; height: number}>();
  const publish = useCallback((value: Publication) => {
    setBinding(value);
    return () => setBinding(now => now === value ? undefined : now);
  }, []);
  const report = useCallback((kind: Slot, frame: Frame) => {
    const set = kind === 'full' ? setFull : setMini;
    set(previous => previous && previous.revision === frame.revision && previous.scope === frame.scope && previous.opening === frame.opening && sameFence(previous.fence, frame.fence)
      && Object.keys(frame.bounds).every(key => frame.bounds[key as keyof DockRect] === previous.bounds[key as keyof DockRect]) ? previous : frame);
  }, []);
  const active = useSyncExternalStore(binding?.subscribe ?? noSubscribe, binding?.current ?? notCurrent);
  const phase = useRef<{fence: PlaybackFence; scope: object | undefined; ticket: number} | undefined>(undefined);
  const counter = useRef(0);
  if (binding && (!phase.current || !sameFence(phase.current.fence, binding.fence) || phase.current.scope !== binding.scope)) {
    phase.current = {fence: binding.fence, scope: binding.scope, ticket: ++counter.current};
  }
  const ticket = phase.current?.ticket ?? 0, progress = binding?.controller.progress, dragging = binding?.controller.dragging;
  const goal = binding?.controller.presentationGoal, standard = motion.timing('standard'), quick = motion.timing('quick', 'in');
  const reduced = motion.reduce;
  useAnimatedReaction(() => ({valid: active && !!progress, ticket, p: progress?.value ?? 1, drag: dragging?.value ?? false,
    goal: goal?.value ?? (progress?.value === 1 ? 1 : 0), reduced}), (now, previous) => {
    if (!now.valid) {
      cancelAnimation(pageAlpha); pageAlpha.value = 0;
      for (const value of [first, second, third]) {cancelAnimation(value); value.value = 0;}
      return;
    }
    const fresh = !previous?.valid || previous.ticket !== now.ticket;
    if (fresh) for (const value of [first, second, third]) {cancelAnimation(value); value.value = 0;}
    const entering = now.goal === 0 || now.drag && now.p < .9999;
    const wasEntering = previous && (previous.goal === 0 || previous.drag && previous.p < .9999);
    if (entering && (fresh || !wasEntering)) {
      first.value = withDelay(now.reduced ? 0 : 260, withTiming(1, standard));
      second.value = withDelay(now.reduced ? 0 : 320, withTiming(1, standard));
      third.value = withDelay(now.reduced ? 0 : 380, withTiming(1, standard));
    } else if (!entering && (fresh || wasEntering)) {
      first.value = withTiming(0, quick); second.value = withTiming(0, quick); third.value = withTiming(0, quick);
    } else if (previous?.reduced !== now.reduced) {
      first.value = withTiming(entering ? 1 : 0, entering ? standard : quick);
      second.value = withTiming(entering ? 1 : 0, entering ? standard : quick);
      third.value = withTiming(entering ? 1 : 0, entering ? standard : quick);
    }
    if (now.reduced && !now.drag) {
      if (fresh || previous?.goal !== now.goal || previous.drag || previous.reduced !== now.reduced) pageAlpha.value = withTiming(now.goal === 0 ? 1 : 0, standard);
    } else {
      cancelAnimation(pageAlpha); pageAlpha.value = Math.max(0, Math.min(1, (1 - now.p) * 2.5));
    }
  }, [active, ticket, progress, dragging, goal, reduced, standard, quick, pageAlpha, first, second, third]);
  useEffect(() => () => {cancelAnimation(pageAlpha); cancelAnimation(first); cancelAnimation(second); cancelAnimation(third);}, [pageAlpha, first, second, third]);
  const fullFrame = belongs(full, binding, 'full', revision) ? full.bounds : undefined, miniFrame = belongs(mini, binding, 'mini', revision) ? mini.bounds : undefined;
  const decodeFrame = fullFrame ?? miniFrame;
  const request = useMemo(() => ({binding, width: decodeFrame?.width, height: decodeFrame?.height}), [binding, decodeFrame?.width, decodeFrame?.height]);
  const latestRequest = useRef(request); latestRequest.current = request;
  const decoded = !!binding?.source && !!decodedSource && !!decodeFrame && sameSource(binding.source, decodedSource.source)
    && decodedSource.width === decodeFrame.width && decodedSource.height === decodeFrame.height;
  const value = useMemo(() => ({canvas, revision, binding, full, mini, decoded, active, pageAlpha, pageHeight, reportPageHeight, groups, pageOwner, holdPage, publish, report}), [revision, binding, full, mini, decoded, active, pageAlpha, pageHeight, reportPageHeight, groups, pageOwner, holdPage, publish, report]);
  return <Context.Provider value={value}>{children}{!theme.isTV && <View ref={canvas} collapsable={false} pointerEvents="none" accessible={false}
    accessibilityElementsHidden importantForAccessibility="no-hide-descendants" onLayout={() => setRevision(value => value + 1)}
    style={{position: 'absolute', inset: 0, zIndex: theme.layers.player + 1}}>
    {active && binding?.source && miniFrame && decodeFrame && <CoverLayer binding={binding as Publication & {source: ArtworkSource}} full={fullFrame} mini={miniFrame} decoded={decoded}
      onReady={source => {if (latestRequest.current === request && binding.current() && binding.source && sameSource(source, binding.source)) setDecodedSource({source, width: decodeFrame.width, height: decodeFrame.height});}}/>}
  </View>}</Context.Provider>;
}

function CoverLayer({binding, full, mini, decoded, onReady}: {binding: Publication & {source: ArtworkSource}; full?: DockRect; mini: DockRect; decoded: boolean; onReady: (source: ArtworkSource) => void}) {
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
  const context = useContext(Context);
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
        report?.(kind, {fence: source.fence, scope: source.scope, opening: source.opening, revision: revision ?? 0, bounds: {x: x - hx, y: y - hy, width, height}});
      });
    });
  }, [binding, own, node, report, kind, canvas, revision]);
  useLayoutEffect(() => {measure();}, [measure]);
  const style = useListeningCoverPaint(fence, kind);
  return {measure, style};
}


/** Static props make this safe to capture as audited passive dock paint. The
 * animation handles are created inside the component, never frozen as data. */
export function ListeningCoverLocalPaint({fence, children, style}: {fence?: PlaybackFence; children: React.ReactNode; style?: StyleProp<ViewStyle>}) {
  const paint = useListeningCoverPaint(fence, 'mini');
  return <Animated.View style={[style, paint]}>{children}</Animated.View>;
}
function useListeningCoverPaint(fence: PlaybackFence | undefined, kind: Slot) {
  const context = useContext(Context), motion = useMotion(), paint = useOverlayPaintMode();
  const binding = context?.binding;
  const usable = paint.interactive && !!fence && !!binding && sameFence(fence, binding.fence) && context.active && context.decoded
    && belongs(context.full, binding, 'full', context.revision) && belongs(context.mini, binding, 'mini', context.revision);
  const matching = !!fence && !!binding && sameFence(fence, binding.fence) && context.active;
  const progress = binding?.controller.progress, dragging = binding?.controller.dragging, page = context?.pageAlpha, height = context?.pageHeight;
  return useAnimatedStyle(() => {
    const p = Math.max(0, Math.min(1, progress?.value ?? 0));
    const travelling = dragging?.value || motion.transforms && p > .0001 && p < .9999;
    if (usable && travelling) return {opacity: 0};
    if (kind === 'full' && matching) return {opacity: page?.value ?? 1,
      transform: [{translateY: motion.transforms || dragging?.value ? (height?.value ?? 0) * p : 0}]};
    return {opacity: 1};
  }, [usable, matching, kind, progress, dragging, page, height, motion.transforms]);
}


/** The page paint follows the same admitted player's UI progress. The measured
 * cover slot itself stays untransformed; only its painted image/background move. */
export function useListeningPageStyle(fence: PlaybackFence | undefined, height: number, fallbackVisible = false) {
  const context = useContext(Context), motion = useMotion();
  const binding = context?.binding;
  const hasBinding = !!binding;
  const current = !!fence && !!binding && sameFence(fence, binding.fence) && context.active;
  const progress = binding?.controller.progress, dragging = binding?.controller.dragging, pageAlpha = context?.pageAlpha, measuredHeight = context?.pageHeight;
  return useAnimatedStyle(() => {
    if (!hasBinding) return {opacity: fallbackVisible ? 1 : 0};
    if (!current || !progress) return {opacity: 0};
    const open = Math.max(0, Math.min(1, 1 - progress.value));
    return {opacity: pageAlpha?.value ?? Math.min(1, open * 2.5), transform: [{translateY: motion.transforms || dragging?.value ? (measuredHeight?.value ?? height) * (1 - open) : 0}]};
  }, [hasBinding, current, progress, dragging, pageAlpha, measuredHeight, height, fallbackVisible, motion.transforms]);
}


/** Three opacity groups share the original UI opening clock, so replacing the
 * mini preview by the admitted full body does not restart its delays. */
export function ListeningGroup({fence, index, height, children, style: layout}: {fence: PlaybackFence; index: 0 | 1 | 2; height: number; children: React.ReactNode; style?: StyleProp<ViewStyle>}) {
  const context = useContext(Context), motion = useMotion();
  const matching = !context?.binding || context.active && sameFence(context.binding.fence, fence);
  const alpha = context?.groups[index], page = context?.pageAlpha, measuredHeight = context?.pageHeight;
  const progress = context?.binding?.controller.progress, dragging = context?.binding?.controller.dragging;
  const style = useAnimatedStyle(() => {
    const p = Math.max(0, Math.min(1, progress?.value ?? 0));
    return {opacity: matching ? (alpha?.value ?? 1) * (page?.value ?? 1) : 0,
      transform: [{translateY: motion.transforms || dragging?.value ? (measuredHeight?.value ?? height) * p : 0}]};
  }, [matching, alpha, page, measuredHeight, progress, dragging, height, motion.transforms]);
  return <Animated.View style={[{width: '100%', alignItems: 'center'}, layout, style]}>{children}</Animated.View>;
}


export function useListeningPaintPermit(fence: PlaybackFence): OverlayPaintPermit | undefined {
  const binding = useContext(Context)?.binding;
  return useMemo(() => binding && sameFence(binding.fence, fence) ? {current: binding.current, subscribe: binding.subscribe ?? noSubscribe} : undefined, [binding, fence]);
}
export function useListeningPageOwner(fence: PlaybackFence) {
  const hold = useContext(Context)?.holdPage;
  const owner = useMemo(() => ({fence}), [fence]);
  useLayoutEffect(() => {if (hold) return hold(owner);}, [hold, owner]);
}
export function useListeningPagePresent(fence: PlaybackFence): boolean {
  const owner = useContext(Context)?.pageOwner;
  return !!owner && sameFence(owner.fence, fence);
}

export function useListeningPageHeight(): (height: number) => void {
  return useContext(Context)?.reportPageHeight ?? (() => {});
}


export function useListeningMiniPaint(fence: PlaybackFence | undefined) {
  const context = useContext(Context), binding = context?.binding;
  return {active: !!fence && !!binding && sameFence(fence, binding.fence) && context.active,
    progress: binding?.controller.progress, dragging: binding?.controller.dragging, page: context?.pageAlpha};
}
