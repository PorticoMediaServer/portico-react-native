import React, {useEffect, useRef} from 'react';
import {Animated, StyleSheet, View} from 'react-native';
import Reanimated from 'react-native-reanimated';
import Svg, {Defs, LinearGradient, RadialGradient, Rect, Stop} from 'react-native-svg';
import {useTheme} from '../theme';
import {useReducedMotion} from '../useMotion';
import {Artwork} from './Artwork';
import {artworkArrivalDuration} from './model';
import type {AmbientArtProps, ArtworkPalette, ColourBackdropProps} from './types';

type Glow = Readonly<{x: number; y: number; rx: number; ry: number; colour: string; stops: readonly (readonly [number, number])[]}>;

function GlowLayer({glows, background}: {glows: readonly Glow[]; background?: string}) {
  return <Svg pointerEvents="none" accessible={false} width="100%" height="100%" viewBox="0 0 1000 1000" preserveAspectRatio="none" style={StyleSheet.absoluteFillObject}>
    <Defs>{glows.map((g, i) => <RadialGradient key={i} id={`glow-${i}`} gradientUnits="userSpaceOnUse" cx={g.x * 1000} cy={g.y * 1000} rx={g.rx * 1000} ry={g.ry * 1000}>
      {g.stops.map(([offset, alpha]) => <Stop key={offset} offset={offset} stopColor={g.colour} stopOpacity={alpha}/>)}</RadialGradient>)}</Defs>
    {background ? <Rect width="1000" height="1000" fill={background}/> : null}
    {[...glows].map((_, i) => glows.length - i - 1).map(i => <Rect key={i} width="1000" height="1000" fill={`url(#glow-${i})`}/>)}
  </Svg>;
}

/** Colours only: safe before authentication and on restriction/owner state surfaces. */
export function ColourBackdrop({shape = 'side', fill = false, width, height, style, testID}: ColourBackdropProps) {
  const {colors} = useTheme();
  const blue = colors.accentDeep, green = colors.generatedGreen;
  const glows: readonly Glow[] = shape === 'side' ? [
    {x: 0.86, y: 0.04, rx: 0.44, ry: 0.66, colour: blue, stops: [[0, 0.46], [0.46, 0.15], [0.74, 0]]},
    {x: 0.64, y: 1.04, rx: 0.42, ry: 0.58, colour: green, stops: [[0, 0.6], [0.5, 0.18], [0.76, 0]]},
    {x: 0.04, y: 0, rx: 0.38, ry: 0.5, colour: colors.ambient, stops: [[0, 0.75], [0.72, 0]]},
  ] : shape === 'round' ? [
    {x: 0.1, y: -0.02, rx: 0.44, ry: 0.62, colour: blue, stops: [[0, 0.36], [0.5, 0.11], [0.76, 0]]},
    {x: 0.92, y: 1.02, rx: 0.44, ry: 0.62, colour: green, stops: [[0, 0.55], [0.5, 0.16], [0.76, 0]]},
    {x: 0.94, y: 0.04, rx: 0.32, ry: 0.44, colour: colors.accent, stops: [[0, 0.12], [0.72, 0]]},
  ] : [
    {x: 0.96, y: -0.06, rx: 0.9, ry: 0.54, colour: blue, stops: [[0, 0.5], [0.48, 0.15], [0.76, 0]]},
    {x: -0.08, y: 0.3, rx: 0.84, ry: 0.44, colour: green, stops: [[0, 0.5], [0.52, 0.13], [0.78, 0]]},
    {x: 0.3, y: 0, rx: 0.7, ry: 0.4, colour: colors.ambient, stops: [[0, 0.8], [0.72, 0]]},
  ];
  return <View pointerEvents="none" accessible={false} testID={testID} style={[StyleSheet.absoluteFillObject, {backgroundColor: colors.ink}, width !== undefined ? {width} : undefined,
    height !== undefined ? {height, bottom: undefined} : shape === 'top' && !fill ? {height: 560, bottom: undefined} : undefined, style]}>
    <GlowLayer glows={glows}/>
  </View>;
}

export function PaletteWash({palette, generated = false}: {palette: ArtworkPalette; generated?: boolean}) {
  const {colors} = useTheme();
  return <GlowLayer background={generated ? colors.raisedSoft : undefined} glows={[
    {x: generated ? 0.85 : 0.22, y: generated ? 0.1 : 0.12, rx: 0.7, ry: 1.2, colour: palette.first, stops: [[0, generated ? 1 : 0.62], [0.6, 0]]},
    {x: 0.6, y: 1.1, rx: 0.6, ry: 0.9, colour: palette.second, stops: [[0, generated ? 1 : 0.52], [0.65, 0]]},
  ]}/>;
}

function ArtScrims({phone, side, bottomAt, top = false, phoneOverlay = false}: {phone: boolean; side: boolean; bottomAt: number; top?: boolean; phoneOverlay?: boolean}) {
  const {colors, spec} = useTheme();
  return <Svg accessible={false} pointerEvents="none" width="100%" height="100%" style={StyleSheet.absoluteFillObject}>
    <Defs>
      <LinearGradient id="art-bottom" x1="0" y1="100%" x2="0" y2="0"><Stop offset="0" stopColor={colors.ink}/><Stop offset={bottomAt} stopColor={colors.ink} stopOpacity={0}/></LinearGradient>
      <LinearGradient id="art-side"><Stop offset="0" stopColor={colors.ink}/><Stop offset={phone ? 0.48 : 0.38} stopColor={colors.ink} stopOpacity={0}/></LinearGradient>
      <LinearGradient id="art-top" x1="0" y1="0" x2="0" y2="100%"><Stop offset="0" stopColor={colors.ink} stopOpacity={0.4}/><Stop offset="0.35" stopColor={colors.ink} stopOpacity={0}/></LinearGradient>
      <LinearGradient id="phone-overlay" x1="0" y1="0" x2="0" y2="100%">{spec.hero.scrim.phoneOverlay.map(stop => <Stop key={stop.at} offset={stop.at} stopColor={colors.ink} stopOpacity={stop.alpha}/>)}</LinearGradient>
    </Defs>
    <Rect width="100%" height="100%" fill="url(#art-bottom)"/>
    {side ? <Rect width="100%" height="100%" fill="url(#art-side)"/> : null}
    {top ? <Rect width="100%" height="100%" fill="url(#art-top)"/> : null}
    {phoneOverlay ? <Rect width="100%" height="100%" fill="url(#phone-overlay)"/> : null}
  </Svg>;
}

/** Continuous ambient wash and independently sharp foreground, with Q43's cheap TV representation. */
export function AmbientArt({source, sources, foreground, palette, treatment = 'hero', width, height, visible = true, priority = false, arrivalDurationMs, position, style, foregroundFrameStyle, foregroundStyle, onReady, onError, onStatusChange, testID}: AmbientArtProps) {
  const theme = useTheme();
  const reduce = useReducedMotion();
  const fallbackOpacity = useRef(new Animated.Value(1)).current;
  const phone = treatment === 'phone' || (!theme.isTV && (treatment === 'hero' || treatment === 'title'));
  const wash = treatment === 'wash' || treatment === 'library';
  const cover = treatment === 'cover' || treatment === 'artist';
  const list = (sources ?? (source ? [source] : [])).slice(0, 3);
  const sourceIdentity = JSON.stringify(list.map(item => item.cacheKey));
  useEffect(() => {fallbackOpacity.stopAnimation(); fallbackOpacity.setValue(1);}, [sourceIdentity, fallbackOpacity]);
  useEffect(() => () => fallbackOpacity.stopAnimation(), [fallbackOpacity]);
  const alpha = wash ? 0.42 : cover ? 0.62 : theme.spec.hero.ambient.alpha[theme.platform];
  const defaultPalette = {first: theme.colors.accentDeep, second: theme.colors.generatedGreen};
  // ambient-v1 is already blurred by the server. Android TV never runs a live blur filter.
  const allowLiveBlur = !theme.isTV;
  return <View pointerEvents="none" accessible={false} testID={testID} style={[StyleSheet.absoluteFillObject, {overflow: 'hidden', width, height}, style]}>
    <Animated.View style={[StyleSheet.absoluteFillObject, {backgroundColor: theme.colors.ink, opacity: fallbackOpacity}]}>
      <PaletteWash palette={palette ?? defaultPalette}/>
    </Animated.View>
    {list.map((ambient, index) => <View key={ambient.cacheKey} style={[StyleSheet.absoluteFillObject, {
      left: wash && list.length > 1 ? `${(index * 0.68 - 0.25) * 100}%` : '-12%',
      top: wash ? '-30%' : cover ? '-50%' : '-12%', right: undefined, bottom: undefined,
      width: wash && list.length > 1 ? '70%' : cover ? '130%' : '124%', height: cover ? '160%' : '124%',
      opacity: index === 1 && wash ? 0.34 : alpha,
    }]}>
      <Artwork source={ambient} visible={visible} sized priority={priority} arrivalDurationMs={arrivalDurationMs} onReady={decoded => {
        if (index === 0) {
          fallbackOpacity.stopAnimation();
          Animated.timing(fallbackOpacity, {toValue: 0, duration: artworkArrivalDuration(arrivalDurationMs, theme.motion.standard, reduce, false), useNativeDriver: true}).start();
          if (!foreground) onReady?.(decoded);
        }
      }} onError={!foreground && index === 0 ? onError : undefined}
        onStatusChange={status => {
          if (index === 0 && status === 'error') {fallbackOpacity.stopAnimation(); fallbackOpacity.setValue(1);}
          if (!foreground && index === 0) onStatusChange?.(status);
        }}
        blurRadius={allowLiveBlur ? wash ? 12 : 8 : undefined}/>
    </View>)}
    {foreground ? <View style={[{position: 'absolute', top: 0, right: 0, height: '100%', width: phone ? '100%' : `${theme.spec.hero.backdrop.widthFraction.tv * 100}%`}, foregroundFrameStyle]}>
      <Reanimated.View style={[StyleSheet.absoluteFillObject, foregroundStyle]}>
        <Artwork source={foreground} visible={visible} priority={priority} arrivalDurationMs={arrivalDurationMs} position={position ?? {x: phone ? 0.38 : 0.5, y: 0.3}}
          onReady={onReady} onError={onError} onStatusChange={onStatusChange}/>
      </Reanimated.View>
      <ArtScrims phone={phone} side={!phone} bottomAt={phone ? theme.spec.hero.mask.phoneBottomOpaqueAt : theme.spec.hero.mask.bottomOpaqueAt} phoneOverlay={phone}/>
    </View> : null}
    <ArtScrims phone={phone} side={false} bottomAt={wash ? 1 : cover ? 0.7 : 0.42}/>
  </View>;
}
