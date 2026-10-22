import React, {useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type ReactNode} from 'react';
import {AppState, Pressable, Text, View, type StyleProp, type ViewStyle} from 'react-native';
import Animated, {cancelAnimation, runOnJS, useAnimatedStyle, useSharedValue, withDelay, withTiming, type SharedValue, type WithTimingConfig} from 'react-native-reanimated';
import {heroSpec} from '@portico/design';
import type {FactPart} from '../../../../../packages/client-core/src/presentation/kit-model';
import {useTheme} from '../theme';
import {useMotion} from '../useMotion';
import {Lockup} from './Lockup';
import {createArtworkReadiness, createRotationClock} from './model';
import type {ArtworkRenderContext, HeroCandidate, LayoutVariant, ThumbnailRenderContext} from './types';

export type HeroProps<T extends HeroCandidate> = {
  candidates: readonly T[];
  activeIndex?: number;
  onIndexChange?: (index: number) => void;
  active?: boolean;
  visible?: boolean;
  reducedMotion?: boolean;
  /** TV spotlight rotates only while one of its actual controls has focus. */
  heroFocused?: boolean;
  variant?: LayoutVariant;
  renderArtwork: (entry: T, context: ArtworkRenderContext) => ReactNode;
  renderActions: (entry: T) => ReactNode;
  renderMetadata?: (entry: T) => ReactNode;
  renderReason?: (entry: T) => ReactNode;
  renderAfterCopy?: (entry: T) => ReactNode;
  renderThumbnail?: (entry: T, context: ThumbnailRenderContext) => ReactNode;
  onArtworkError?: (error: unknown, entry: T) => void;
  showOverview?: boolean;
  height?: number;
  copyTop?: number;
  style?: StyleProp<ViewStyle>;
  testID?: string;
};

export function HeroMetadata({facts, centered = false}: {facts: readonly FactPart[]; centered?: boolean}) {
  const theme = useTheme();
  return <View style={{flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', justifyContent: centered ? 'center' : 'flex-start', columnGap: heroSpec.facts.gap[theme.platform], rowGap: heroSpec.facts.rowGap[theme.platform]}}>
    {facts.map(fact => <Text key={fact.id} style={[theme.type.meta, {color: fact.id === 'year' || fact.role === 'identity' ? theme.colors.text : theme.colors.textSecondary, fontFamily: fact.id === 'year' || fact.role === 'identity' ? theme.type.bodyStrong.fontFamily : theme.type.meta.fontFamily}]}>{fact.text}</Text>)}
  </View>;
}

type LayerProps<T extends HeroCandidate> = {
  entry: T; shown: boolean; pending: boolean; fade: 'hero' | 'slow'; reducedMotion?: boolean; visible?: boolean;
  ready: () => void; failed: (error?: unknown) => void; departed: () => void;
  renderArtwork: HeroProps<T>['renderArtwork'];
};

function HeroLayer<T extends HeroCandidate>({entry, shown, pending, fade, ready, failed, departed, visible = true, renderArtwork, reducedMotion}: LayerProps<T>) {
  const motion = useMotion(), opacity = useSharedValue(0), drift = useSharedValue(heroSpec.rotation.driftScaleFrom);
  const reduced = motion.reduce || !!reducedMotion;
  useEffect(() => {
    opacity.value = withTiming(shown ? 1 : 0, {...motion.timing(fade), ...(reduced ? {duration: heroSpec.rotation.reducedMs} : {})}, finished => {
      if (finished && !shown && !pending) runOnJS(departed)();
    });
    return () => cancelAnimation(opacity);
  }, [departed, fade, motion, opacity, pending, reduced, shown]);
  useEffect(() => {
    drift.value = reduced || fade !== 'hero' ? 1 : shown ? withTiming(1, {...motion.timing('hero'), duration: heroSpec.rotation.driftMs}) : heroSpec.rotation.driftScaleFrom;
    return () => cancelAnimation(drift);
  }, [drift, fade, motion, reduced, shown]);
  const layerStyle = useAnimatedStyle(() => ({opacity: opacity.value}));
  const foregroundStyle = useAnimatedStyle(() => ({transform: [{scale: drift.value}]}));
  return <Animated.View pointerEvents="none" accessible={false} accessibilityElementsHidden importantForAccessibility="no-hide-descendants" style={[{position: 'absolute', inset: 0}, layerStyle]}>
    {renderArtwork(entry, {onReady: ready, onError: failed, visible, active: shown, foregroundStyle})}
  </Animated.View>;
}

type CopyProps<T extends HeroCandidate> = Omit<HeroProps<T>, 'candidates' | 'activeIndex' | 'onIndexChange'> & {entry: T; fade: 'hero' | 'slow'};

function CopyPart({identity, step, stagger, translate, timing, children}: {identity: string; step: number; stagger: number; translate: number; timing: WithTimingConfig; children: ReactNode}) {
  const words = useSharedValue(0);
  useLayoutEffect(() => {
    words.value = 0;
    words.value = withDelay(step * stagger, withTiming(1, timing));
    return () => cancelAnimation(words);
  }, [identity, stagger, step, timing, words]);
  const style = useAnimatedStyle(() => ({opacity: words.value, transform: [{translateY: (1 - words.value) * translate}]}));
  return <Animated.View pointerEvents="box-none" style={style}>{children}</Animated.View>;
}

/** One actual copy/control tree keeps native TV focus while the artwork layers crossfade. */
function HeroCopy<T extends HeroCandidate>({entry, fade, variant, renderActions, renderMetadata, renderReason, renderAfterCopy, showOverview = true, copyTop, reducedMotion}: CopyProps<T>) {
  const theme = useTheme(), motion = useMotion();
  const reduced = motion.reduce || !!reducedMotion;
  const phone = variant === 'phone-app' || variant === 'phone-web' || (!variant && !theme.isTV), tv = variant === 'tv' || (!variant && theme.isTV);
  const timing = useMemo(() => ({...motion.timing('standard'), duration: reduced ? heroSpec.rotation.reducedMs : fade === 'hero' ? heroSpec.rotation.copyMs : theme.motion.standard}), [fade, motion, reduced, theme.motion.standard]);
  const partProps = {identity: entry.id, stagger: reduced || fade !== 'hero' ? 0 : heroSpec.rotation.copyStaggerMs, translate: reduced || tv || phone ? 0 : heroSpec.rotation.copyTranslate, timing};
  let step = 0;
  return <View style={{position: 'absolute', left: tv ? theme.layout.gutter.tv : phone ? theme.layout.gutter.phone : theme.layout.gutter.desktop,
    right: phone ? theme.layout.gutter.phone : undefined, width: phone ? undefined : tv ? heroSpec.copy.width.tv : heroSpec.copy.width.web,
    top: copyTop ?? (tv ? 220 : undefined), bottom: copyTop !== undefined || tv ? undefined : phone ? heroSpec.copy.homeBottom.phone : heroSpec.copy.homeBottom.web}}>
    {(renderReason || entry.reason) ? <CopyPart {...partProps} step={step++}>{renderReason ? renderReason(entry) : <Text style={[theme.type.eyebrow, {textAlign: phone ? 'center' : 'left', color: theme.colors.accentStrong, marginBottom: phone ? 8 : tv ? 16 : 14}]}>{entry.reason}</Text>}</CopyPart> : null}
    <CopyPart {...partProps} step={step++}><Lockup title={entry.title} long={entry.long} variant={variant} lines={phone ? 2 : undefined} style={{textAlign: phone ? 'center' : 'left', marginBottom: phone ? 10 : tv ? 22 : 20}} /></CopyPart>
    {(renderMetadata || entry.facts?.length) ? <CopyPart {...partProps} step={step++}><View style={{marginBottom: phone ? 18 : tv ? 18 : 16}}>{renderMetadata ? renderMetadata(entry) : <HeroMetadata facts={entry.facts ?? []} centered={phone} />}</View></CopyPart> : null}
    {showOverview && !phone && entry.overview ? <CopyPart {...partProps} step={step++}><Text numberOfLines={tv ? 2 : 3} style={[theme.type.synopsis, {color: theme.colors.textSecondary, maxWidth: tv ? 800 : 540, marginBottom: tv ? 30 : 28}]}>{entry.overview}</Text></CopyPart> : null}
    <CopyPart {...partProps} step={step++}><View style={{flexDirection: 'row', alignItems: 'center', justifyContent: phone ? 'center' : 'flex-start', gap: heroSpec.actions.gap[theme.platform]}}>{renderActions(entry)}</View></CopyPart>
    {renderAfterCopy && <CopyPart {...partProps} step={step}>{renderAfterCopy(entry)}</CopyPart>}
  </View>;
}

type StagedEntry<T> = Readonly<{entry: T; generation: number}>;

type StagedLayerProps<T extends HeroCandidate> = Omit<LayerProps<T>, 'entry' | 'ready' | 'failed' | 'departed'> & {
  layer: StagedEntry<T>; ready: (generation: number) => void; failed: (generation: number, error?: unknown) => void; departed: (generation: number) => void;
};
function StagedHeroLayer<T extends HeroCandidate>({layer, ready, failed, departed, ...props}: StagedLayerProps<T>) {
  const generation = layer.generation;
  const decoded = useCallback(() => ready(generation), [generation, ready]);
  const decodeFailed = useCallback((error?: unknown) => failed(generation, error), [failed, generation]);
  const faded = useCallback(() => departed(generation), [departed, generation]);
  return <HeroLayer {...props} entry={layer.entry} ready={decoded} failed={decodeFailed} departed={faded} />;
}

/** The shown foreground and one actual incoming foreground are the only mounted layers. */
export function HeroSurface<T extends HeroCandidate>({entry, fade = 'hero', ...props}: Omit<HeroProps<T>, 'candidates' | 'activeIndex' | 'onIndexChange'> & {entry: T | undefined; fade?: 'hero' | 'slow'}) {
  const [layers, setLayers] = useState<readonly StagedEntry<T>[]>([]), [shown, setShown] = useState<number>();
  const layersRef = useRef(layers), shownRef = useRef(shown), target = useRef<number | undefined>(undefined), generation = useRef(0);
  const onErrorRef = useRef(props.onArtworkError);
  onErrorRef.current = props.onArtworkError;
  shownRef.current = shown; layersRef.current = layers;
  const [gate] = useState(() => createArtworkReadiness<number>(setShown, (failedGeneration, error) => {
    const failedLayer = layersRef.current.find(layer => layer.generation === failedGeneration);
    if (failedGeneration !== shownRef.current) setLayers(current => current.filter(layer => layer.generation !== failedGeneration));
    if (failedLayer) onErrorRef.current?.(error, failedLayer.entry);
  }));
  useEffect(() => {
    if (!entry) {target.current = undefined; setLayers([]); setShown(undefined); gate.clear(); return;}
    const currentTarget = layersRef.current.find(layer => layer.generation === target.current);
    if (currentTarget?.entry.id === entry.id) {
      if (currentTarget.entry !== entry) setLayers(current => current.map(layer => layer.generation === currentTarget.generation ? {...layer, entry} : layer));
      return;
    }
    const currentShown = layersRef.current.find(layer => layer.generation === shownRef.current);
    if (currentShown?.entry.id === entry.id) {
      target.current = currentShown.generation; gate.stage(currentShown.generation);
      setLayers([{...currentShown, entry}]); return;
    }
    // A fading-out former target is remounted as a fresh incoming foreground.
    // Its old decode callback cannot reveal this new generation.
    const incoming = {entry, generation: ++generation.current};
    target.current = incoming.generation; gate.stage(incoming.generation);
    setLayers(currentShown ? [currentShown, incoming] : [incoming]);
  }, [entry, gate]);
  useEffect(() => () => {target.current = undefined; gate.clear();}, [gate]);
  const ready = useCallback((layerGeneration: number) => {if (target.current === layerGeneration) gate.ready(layerGeneration);}, [gate]);
  const failed = useCallback((layerGeneration: number, error: unknown) => {if (target.current === layerGeneration) gate.error(layerGeneration, error);}, [gate]);
  const departed = useCallback((layerGeneration: number) => {
    if (target.current === layerGeneration || shownRef.current === layerGeneration) return;
    setLayers(current => current.filter(layer => layer.generation !== layerGeneration));
  }, []);
  const shownLayer = layers.find(layer => layer.generation === shown);
  return <>{layers.map(layer => <StagedHeroLayer key={`${layer.entry.id}:${layer.generation}`} layer={layer} renderArtwork={props.renderArtwork} visible={props.visible} reducedMotion={props.reducedMotion}
    shown={shown === layer.generation} pending={target.current === layer.generation && shown !== layer.generation} ready={ready} failed={failed} departed={departed} fade={fade} />)}
    {shownLayer && <HeroCopy {...props} entry={shownLayer.entry} fade={fade} />}
  </>;
}

function HeroThumbnail<T extends HeroCandidate>({entry, index, active, visible, progress, render, onPress}: {
  entry: T; index: number; active: boolean; visible: boolean; progress: SharedValue<number>;
  render: NonNullable<HeroProps<T>['renderThumbnail']>; onPress: () => void;
}) {
  const theme = useTheme(), [hovered, setHovered] = useState(false), [focused, setFocused] = useState(false);
  const fill = useAnimatedStyle(() => ({transform: [{translateX: (progress.value - 1) * heroSpec.thumbnail.width / 2}, {scaleX: progress.value}]}));
  return <Pressable accessibilityRole="button" accessibilityLabel={entry.title} accessibilityState={{selected: active}} onPress={onPress}
    onHoverIn={() => setHovered(true)} onHoverOut={() => setHovered(false)} onFocus={() => setFocused(true)} onBlur={() => setFocused(false)}
    style={{width: heroSpec.thumbnail.width, opacity: active ? 1 : hovered ? heroSpec.thumbnail.hoverOpacity : heroSpec.thumbnail.opacity}}>
    <View style={{width: heroSpec.thumbnail.width, height: heroSpec.thumbnail.height, borderRadius: heroSpec.thumbnail.radius, overflow: 'hidden'}}>{render(entry, {index, active, visible})}</View>
    {focused && <View pointerEvents="none" style={{position: 'absolute', left: -6, right: -6, top: -6, height: heroSpec.thumbnail.height + 12, borderRadius: heroSpec.thumbnail.radius + 6, borderWidth: theme.spec.focus.ringWidth.phone, borderColor: theme.colors.focus}} />}
    <View style={{marginTop: heroSpec.thumbnail.progressGap, height: heroSpec.thumbnail.progressHeight, borderRadius: 3, overflow: 'hidden', backgroundColor: `${theme.colors.text}2E`}}>
      {active && <Animated.View style={[{height: heroSpec.thumbnail.progressHeight, backgroundColor: theme.colors.text}, fill]} />}
    </View>
    <Text numberOfLines={1} style={[theme.type.thumbnailLabel, {marginTop: heroSpec.thumbnail.labelGap, color: theme.colors.textSecondary}]}>{entry.title}</Text>
  </Pressable>;
}

export function Hero<T extends HeroCandidate>({candidates, activeIndex, onIndexChange, active = true, visible = true, reducedMotion = false, heroFocused = false, variant, height, style, testID, ...props}: HeroProps<T>) {
  const theme = useTheme(), motion = useMotion(), [localIndex, setLocalIndex] = useState(0), [appVisible, setAppVisible] = useState(AppState.currentState === 'active'), [hovered, setHovered] = useState(false), [controlFocused, setControlFocused] = useState(false);
  const index = Math.max(0, Math.min(candidates.length - 1, activeIndex ?? localIndex));
  const tv = variant === 'tv' || (!variant && theme.isTV), phone = variant === 'phone-app' || variant === 'phone-web' || (!variant && !theme.isTV);
  const clock = useRef(createRotationClock(heroSpec.rotation.intervalMs)), progress = useSharedValue(0);
  const change = useCallback((next: number) => {clock.current.reset(); progress.value = 0; if (activeIndex === undefined) setLocalIndex(next); onIndexChange?.(next);}, [activeIndex, onIndexChange, progress]);
  useEffect(() => {const subscription = AppState.addEventListener('change', next => setAppVisible(next === 'active')); return () => subscription.remove();}, []);
  const canRotate = candidates.length > 1 && active && visible && appVisible && !motion.reduce && !reducedMotion && !hovered && (tv ? heroFocused : !controlFocused);
  useEffect(() => {clock.current.reset(); progress.value = 0;}, [index, candidates[index]?.id, progress]);
  useEffect(() => {
    if (!canRotate) return;
    const remaining = clock.current.resume(Date.now());
    progress.value = withTiming(1, {...motion.timing('hero', 'linear'), duration: remaining});
    const timer = setTimeout(() => change((index + 1) % candidates.length), remaining);
    return () => {clearTimeout(timer); clock.current.pause(Date.now()); cancelAnimation(progress);};
  }, [canRotate, candidates.length, change, index, motion, progress]);
  const dots = candidates.length > 1 ? <View style={{marginTop: tv ? 34 : heroSpec.phoneDots.marginTop, flexDirection: 'row', justifyContent: phone ? 'center' : 'flex-start', gap: tv ? 10 : heroSpec.phoneDots.gap}}>
    {candidates.map((candidate, i) => tv ? <View key={candidate.id} style={{width: i === index ? 34 : 10, height: 10, borderRadius: 5, backgroundColor: i === index ? theme.colors.text : `${theme.colors.text}47`}} /> : <Pressable key={candidate.id} accessibilityRole="button" accessibilityLabel={candidate.title} accessibilityState={{selected: i === index}} onPress={() => change(i)} hitSlop={8}>
      <View style={{width: i === index ? heroSpec.phoneDots.activeWidth : heroSpec.phoneDots.size, height: heroSpec.phoneDots.size, borderRadius: 3, backgroundColor: i === index ? theme.colors.text : `${theme.colors.text}4D`}} />
    </Pressable>)}
  </View> : null;
  return <View testID={testID} onPointerEnter={() => setHovered(true)} onPointerLeave={() => setHovered(false)}
    onFocus={() => setControlFocused(true)} onBlur={() => setControlFocused(false)}
    style={[{height: height ?? (variant === 'phone-web' ? heroSpec.mobileWeb.homeHeight : variant === 'desktop' ? heroSpec.homeHeight.web : heroSpec.homeHeight[theme.platform]), position: 'relative'}, style]}>
    <HeroSurface {...props} entry={candidates[index]} variant={variant} active={active} visible={visible && appVisible} reducedMotion={reducedMotion} heroFocused={heroFocused}
      renderAfterCopy={entry => <>{props.renderAfterCopy?.(entry)}{variant !== 'desktop' && dots}</>} />
    {variant === 'desktop' && props.renderThumbnail && <View style={{position: 'absolute', right: theme.layout.gutter.desktop, bottom: heroSpec.thumbnail.bottom, flexDirection: 'row', gap: heroSpec.thumbnail.gap}}>
      {candidates.map((candidate, i) => <HeroThumbnail key={candidate.id} entry={candidate} index={i} active={index === i} visible={visible && appVisible} progress={progress} render={props.renderThumbnail!} onPress={() => change(i)} />)}
    </View>}
  </View>;
}
