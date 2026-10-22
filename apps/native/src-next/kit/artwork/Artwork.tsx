import React, {useEffect, useLayoutEffect, useRef, useState} from 'react';
import {Animated, Image, PixelRatio, StyleSheet, View, type LayoutChangeEvent} from 'react-native';
import Svg, {Defs, LinearGradient, Rect, Stop} from 'react-native-svg';
import {sizedUri, useArtworkPlacement, useArtworkSlot} from '../../platform/ArtworkPipeline';
import {useTheme} from '../theme';
import {useReducedMotion} from '../useMotion';
import {artworkArrivalDuration, artworkAttemptSource, artworkFrame} from './model';
import type {ArtworkProps, ArtworkSource} from './types';

type ScheduledProps = ArtworkProps & {source: ArtworkSource; boxWidth: number; boxHeight: number};

function ScheduledImage({source, boxWidth, boxHeight, alt, fit = 'cover', resizeMode, position, zoom = 1, saturation = 1, brightness = 1, blurRadius, filter, priority = false, arrivalDurationMs, sized = false, imageStyle, imageOverlay, onReady, onLoad, onError, onStatusChange}: ScheduledProps) {
  const placement = useArtworkPlacement();
  const slot = useArtworkSlot(source.cacheKey, placement, priority);
  const reduced = useReducedMotion();
  const theme = useTheme();
  const [decoded, setDecoded] = useState(false);
  const [intrinsic, setIntrinsic] = useState<{width: number; height: number} | null>(null);
  const displayedAttempt = useRef(slot.attempt);
  if (!decoded) displayedAttempt.current = slot.attempt;
  const requestAttempt = displayedAttempt.current;
  const opacity = useRef(new Animated.Value(slot.cached ? 1 : 0)).current;
  const callbacks = useRef({source, onReady, onLoad, onError, onStatusChange});
  const live = useRef(true);
  const reportedFailure = useRef(false);
  callbacks.current = {source, onReady, onLoad, onError, onStatusChange};
  const status = slot.gaveUp ? 'error' : decoded && !slot.recovering ? 'ready' : slot.active ? 'loading' : 'queued';
  useEffect(() => {
    callbacks.current.onStatusChange?.(status);
    if (status === 'error' && !reportedFailure.current) {reportedFailure.current = true; callbacks.current.onError?.(callbacks.current.source);}
  }, [status]);
  useEffect(() => {
    if (!slot.active || slot.recovering && status !== 'ready') {
      setDecoded(false);
      opacity.stopAnimation();
      opacity.setValue(0);
    }
  }, [slot.active, slot.recovering, status, opacity]);
  useEffect(() => () => opacity.stopAnimation(), [opacity]);
  useLayoutEffect(() => {live.current = true; return () => {live.current = false;};}, []);

  const uri = sized ? source.uri : sizedUri(source.uri, boxWidth, boxWidth / boxHeight, PixelRatio.get());
  const attemptIdentity = JSON.stringify([uri, requestAttempt]);
  const currentAttempt = useRef(attemptIdentity);
  currentAttempt.current = attemptIdentity;
  const mode = resizeMode ?? fit;
  const crop = mode === 'cover' || mode === 'contain';
  const frame = intrinsic && crop ? artworkFrame(boxWidth, boxHeight, intrinsic.width, intrinsic.height, mode, position, zoom) : {width: boxWidth, height: boxHeight};
  const loaded = (event: Parameters<NonNullable<React.ComponentProps<typeof Image>['onLoad']>>[0]) => {
    if (!live.current || currentAttempt.current !== attemptIdentity) return;
    const natural = event.nativeEvent.source;
    if (natural?.width > 0 && natural.height > 0) setIntrinsic({width: natural.width, height: natural.height});
    slot.loaded();
    reportedFailure.current = false;
    setDecoded(true);
    callbacks.current.onReady?.(source);
    callbacks.current.onLoad?.(source);
    opacity.stopAnimation();
    Animated.timing(opacity, {toValue: 1, duration: artworkArrivalDuration(arrivalDurationMs, theme.motion.standard, reduced, slot.cached), useNativeDriver: true}).start();
  };
  return slot.active ? <Animated.View pointerEvents="none" style={[StyleSheet.absoluteFillObject, {opacity, filter: filter ?? (saturation !== 1 || brightness !== 1 ? [{saturate: saturation}, {brightness}] : undefined)}]}>
    <Image key={requestAttempt} source={artworkAttemptSource(source, uri, requestAttempt)}
      accessible={Boolean(alt)} accessibilityLabel={alt} fadeDuration={0} blurRadius={blurRadius}
      resizeMode={intrinsic && crop ? 'stretch' : mode}
      style={[{position: 'absolute'}, frame, !intrinsic && zoom !== 1 ? {transform: [{scale: zoom}]} : undefined, imageStyle]}
      onLoad={loaded} onError={() => {
        if (!live.current || currentAttempt.current !== attemptIdentity) return;
        setDecoded(false); opacity.stopAnimation(); opacity.setValue(0);
        slot.failed();
        if (!reportedFailure.current) {reportedFailure.current = true; callbacks.current.onError?.(source);}
      }}/>
    {imageOverlay}
  </Animated.View> : null;
}

/** The platform queue controls Image mounts, retries and offscreen cancellation. No I/O lives here. */
export function Artwork({source, width, height, style, fallback, visible = true, testID, ...props}: ArtworkProps) {
  const [box, setBox] = useState({width: width ?? 0, height: height ?? 0});
  const onLayout = (event: LayoutChangeEvent) => {
    const next = event.nativeEvent.layout;
    setBox(previous => previous.width === next.width && previous.height === next.height ? previous : {width: next.width, height: next.height});
  };
  const w = width ?? box.width, h = height ?? box.height;
  return <View testID={testID} onLayout={onLayout} style={[styles.box, width === undefined && height === undefined ? StyleSheet.absoluteFillObject : undefined, {width, height}, style]}>
    {fallback}
    {visible && source && w > 0 && h > 0 ? <ScheduledImage key={JSON.stringify([source.cacheKey, source.uri])} {...props} source={source} boxWidth={w} boxHeight={h}/> : null}
  </View>;
}

export type MediaArtKind = 'poster' | 'wide' | 'square' | 'still' | 'book' | 'periodical' | 'newspaper';
export type MediaArtProps = ArtworkProps & {kind: MediaArtKind; backdropFallback?: boolean};

/** Geometry/treatment only. Progress, selection, playback and navigation belong to the card. */
export function MediaArt({kind, backdropFallback = false, style, width, height, position, zoom, saturation, brightness, ...props}: MediaArtProps) {
  const theme = useTheme();
  const aspectRatio = kind === 'poster' || kind === 'book' ? 2 / 3 : kind === 'wide' || kind === 'still' ? 16 / 9 : kind === 'square' ? 1 : 3 / 4;
  const fallback = kind === 'still' && backdropFallback;
  return <View style={[{width, height, aspectRatio: height === undefined ? aspectRatio : undefined, overflow: 'hidden', borderRadius: theme.radii.artwork, backgroundColor: theme.colors.raised}, style]}>
    <Artwork {...props} style={StyleSheet.absoluteFillObject} position={position ?? (kind === 'newspaper' ? {x: 0.5, y: 0} : undefined)}
      zoom={zoom ?? (fallback ? theme.spec.episode.fallback.cropScale : 1)}
      saturation={saturation ?? (fallback ? theme.spec.episode.fallback.saturation : 1)}
      brightness={brightness ?? (fallback ? theme.spec.episode.fallback.brightness : 1)}
      imageOverlay={kind === 'book' ? <BookSpine/> : props.imageOverlay}/>
  </View>;
}

export function BookSpine() {
  const {colors} = useTheme();
  return <Svg pointerEvents="none" accessible={false} style={StyleSheet.absoluteFillObject} width="100%" height="100%">
    <Defs><LinearGradient id="spine"><Stop offset="0" stopColor={colors.ink} stopOpacity={0.34}/><Stop offset="0.016" stopColor={colors.text} stopOpacity={0.16}/><Stop offset="0.036" stopColor={colors.ink} stopOpacity={0.1}/><Stop offset="0.08" stopColor={colors.ink} stopOpacity={0}/></LinearGradient></Defs>
    <Rect width="100%" height="100%" fill="url(#spine)"/>
  </Svg>;
}

const styles = StyleSheet.create({box: {overflow: 'hidden'}});
