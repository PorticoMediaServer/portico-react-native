import React, {useEffect, useState} from 'react';
import {StyleSheet, View, type ImageSourcePropType, type StyleProp, type ViewStyle} from 'react-native';
import Svg, {Defs, LinearGradient, RadialGradient, Rect, Stop} from 'react-native-svg';
import Animated, {Easing, useAnimatedStyle, useSharedValue, withTiming} from 'react-native-reanimated';
import {sourceKey} from './Artwork';
import {alpha, useTheme} from './theme';
import {heroSpec} from '../../../../packages/design/src/index';

/**
 * Portico's signature "screen light in a theatre frame": a navy canvas with a
 * blue projection glow falling from the top-left. Sits under everything and
 * never scrolls. Pages without artwork still look lit.
 */
/** Memoised: a full-screen gradient that must not re-reconcile on every shell render. */
export const Atmosphere = React.memo(function Atmosphere({style, intensity = 1}: {style?: StyleProp<ViewStyle>; intensity?: number}) {
  const {colors} = useTheme();
  const [size, setSize] = useState({width: 0, height: 0});
  return (
    <View pointerEvents="none" onLayout={e => setSize({width: e.nativeEvent.layout.width, height: e.nativeEvent.layout.height})} style={[StyleSheet.absoluteFill, {backgroundColor: colors.ink}, style]}>
      {size.width > 0 ? <Svg width={size.width} height={size.height} viewBox={`0 0 ${size.width} ${size.height}`}>
        <Defs>
          <RadialGradient id="glow" cx="16%" cy="0%" rx="78%" ry="70%" fx="16%" fy="0%" gradientUnits="objectBoundingBox">
            <Stop offset="0" stopColor={colors.glowStrong} stopOpacity={1 * intensity} />
            <Stop offset="0.4" stopColor={colors.glow} stopOpacity={0.7 * intensity} />
            <Stop offset="1" stopColor={colors.ink} stopOpacity={0} />
          </RadialGradient>
          <RadialGradient id="glow2" cx="100%" cy="100%" rx="55%" ry="45%" gradientUnits="objectBoundingBox">
            <Stop offset="0" stopColor={colors.glow} stopOpacity={0.28 * intensity} />
            <Stop offset="1" stopColor={colors.ink} stopOpacity={0} />
          </RadialGradient>
        </Defs>
        <Rect x={0} y={0} width={size.width} height={size.height} fill="url(#glow)" />
        <Rect x={0} y={0} width={size.width} height={size.height} fill="url(#glow2)" />
      </Svg> : null}
    </View>
  );
});

type Layer = {key: number; source: ImageSourcePropType};

/**
 * Artwork backdrop with a consistent scrim so white text stays readable on any
 * poster. Crossfades when the source changes and fades to the atmosphere when
 * cleared. `align` controls where the artwork remains most visible.
 *
 * It never ends on an edge (Justin, 18 Oct 2026, every platform): the scrim reaches the ink at the
 * foot of the art, and below it a fade (`tail`) takes the ink away into the page's own light, so
 * art, shade and page meet without a line. `height` is the art's; the fade hangs below it. A cover
 * standing in for wide art (`blur`) is softened and takes the same scrim and fade; `tint` is the
 * colour behind the art, which fades with it.
 */
export function Backdrop({source, height, align = 'right', opacity = 1, blur, tint, style}: {source?: ImageSourcePropType; height?: number; /** `top`: a phone title hero (identity below); `overlay`: a phone Home hero (identity over the art). */ align?: 'right' | 'center' | 'top' | 'overlay'; opacity?: number; /** A cover in place of wide art: blurred by this radius. */ blur?: number; tint?: string; style?: StyleProp<ViewStyle>}) {
  const {colors, motion} = useTheme();
  const tail = useBackdropFade();
  const bottom = align === 'top' ? heroSpec.scrim.phoneBottom : align === 'overlay' ? heroSpec.scrim.phoneOverlay : heroSpec.scrim.bottom;
  const foot = bottom[bottom.length - 1]!.alpha;
  const [layers, setLayers] = useState<Layer[]>([]);
  const uri = sourceKey(source);
  useEffect(() => {
    if (!source || !uri) {
      setLayers([]);
      return;
    }
    setLayers(prev => (prev.length && sourceKey(prev[prev.length - 1].source) === uri ? prev : [...prev.slice(-1), {key: Date.now(), source}]));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [uri]);
  return (
    <View pointerEvents="none" style={[{position: 'absolute', left: 0, right: 0, top: 0, height: height === undefined ? '100%' : height + tail}, style]}>
      <View style={{position: 'absolute', left: 0, right: 0, top: 0, bottom: tail, overflow: 'hidden', backgroundColor: tint}}>
      {layers.map((layer, index) => (
        <FadeLayer key={layer.key} source={layer.source} opacity={opacity} blur={blur} last={index === layers.length - 1} duration={motion.reduce ? 0 : motion.slow} onFaded={() => setLayers(prev => prev.filter(l => l.key !== layer.key))} />
      ))}
      {/* Sized by percentage, never by a measured size: a measured one is fractional, and Android drew
          the shade a pixel or more short of the artwork it covers (a bright line along the bottom and
          down the right edge). */}
      <Svg width="100%" height="100%" style={StyleSheet.absoluteFill}>
        {/* Spec — Title Pages §1 / heroSpec.scrim: wide layouts get a bottom and a left gradient,
            phones a bottom one only (the identity sits below the image). */}
        <Defs>
          <LinearGradient id="bottom" x1="0" y1="0" x2="0" y2="1">
            {bottom.map(stop => <Stop key={stop.at} offset={String(stop.at)} stopColor={colors.ink} stopOpacity={stop.alpha} />)}
          </LinearGradient>
          <LinearGradient id="side" x1="0" y1="0" x2="1" y2="0">
            {heroSpec.scrim.left.map(stop => <Stop key={stop.at} offset={String(stop.at)} stopColor={colors.ink} stopOpacity={stop.alpha} />)}
          </LinearGradient>
        </Defs>
        {align === 'top' || align === 'overlay' ? null : <Rect x={0} y={0} width="100%" height="100%" fill="url(#side)" />}
        <Rect x={0} y={0} width="100%" height="100%" fill="url(#bottom)" />
      </Svg>
      </View>
      <BackdropFade from={foot} />
    </View>
  );
}

/** How far below a hero's art its shade takes to fade into the page (`BackdropFade`). */
export function useBackdropFade(): number {
  return useTheme().space.xxxl * 2;
}

/**
 * Below a hero's art (at the foot of its box, `useBackdropFade` tall): the scrim's ink, at `from`,
 * fading away into the page. The art stops above it, so nothing of it shows again where the shade
 * lifts; it starts a pixel inside the art so Android's fractional layout leaves no gap.
 */
export function BackdropFade({from = 1}: {from?: number}) {
  const {colors} = useTheme();
  const tail = useBackdropFade();
  return (
    <Svg width="100%" height={tail + 1} style={{position: 'absolute', left: 0, right: 0, bottom: 0}}>
      <Defs>
        <LinearGradient id="tail" x1="0" y1="0" x2="0" y2="1">
          <Stop offset="0" stopColor={colors.ink} stopOpacity={from} />
          <Stop offset="0.45" stopColor={colors.ink} stopOpacity={from * 0.55} />
          <Stop offset="1" stopColor={colors.ink} stopOpacity={0} />
        </LinearGradient>
      </Defs>
      <Rect x={0} y={0} width="100%" height="100%" fill="url(#tail)" />
    </Svg>
  );
}

function FadeLayer({source, opacity, blur, last, duration, onFaded}: {source: ImageSourcePropType; opacity: number; blur?: number; last: boolean; duration: number; onFaded: () => void}) {
  const value = useSharedValue(0);
  const [loaded, setLoaded] = useState(false);
  useEffect(() => {
    if (loaded && last) value.value = withTiming(opacity, {duration, easing: Easing.out(Easing.quad)});
  }, [loaded, last, opacity, duration, value]);
  useEffect(() => {
    if (!last) {
      value.value = withTiming(0, {duration});
      const timer = setTimeout(onFaded, duration + 40);
      return () => clearTimeout(timer);
    }
  }, [last, duration, onFaded, value]);
  const animated = useAnimatedStyle(() => ({opacity: value.value}));
  // APL-SYS-11: a backdrop that failed (a busy server answers 503) is asked for again with backoff.
  const [attempt, setAttempt] = useState(0);
  const [failed, setFailed] = useState(false);
  useEffect(() => {
    if (!failed || attempt >= 4) return;
    const timer = setTimeout(() => { setFailed(false); setAttempt(a => a + 1); }, [1000, 3000, 8000, 20000][attempt]);
    return () => clearTimeout(timer);
  }, [failed, attempt]);
  if (failed) return null;
  const retried = attempt && typeof source === 'object' && !Array.isArray(source) && (source as {uri?: string}).uri
    ? {...(source as object), uri: `${(source as {uri: string}).uri}${(source as {uri: string}).uri.includes('?') ? '&' : '?'}r=${attempt}`}
    : source;
  // A blurred cover overhangs its box, so its softened edges fall outside it.
  const box = blur ? {position: 'absolute' as const, left: -blur, right: -blur, top: -blur, bottom: -blur} : StyleSheet.absoluteFill;
  return <Animated.Image key={attempt} source={retried as ImageSourcePropType} resizeMode="cover" blurRadius={blur} onLoad={() => setLoaded(true)} onError={() => setFailed(true)} style={[box, animated]} />;
}

/** Quiet slate container with a subtle edge; the only "card chrome" in the app. */
export function Surface({children, style, tone = 'raised', padded = true}: {children?: React.ReactNode; style?: StyleProp<ViewStyle>; tone?: 'raised' | 'soft' | 'material'; padded?: boolean}) {
  const {colors, metrics, space} = useTheme();
  const background = tone === 'raised' ? colors.raised : tone === 'soft' ? colors.raisedSoft : colors.material;
  return (
    <View style={[{backgroundColor: background, borderRadius: metrics.radius.panel, borderWidth: 1, borderColor: alpha(colors.lineSoft, 0.9)}, padded ? {padding: space.lg} : null, style]}>
      {children}
    </View>
  );
}

/** Fine hairline for separating rows and sections. */
export function Divider({style, inset = 0}: {style?: StyleProp<ViewStyle>; inset?: number}) {
  const {colors} = useTheme();
  return <View style={[{height: StyleSheet.hairlineWidth, backgroundColor: colors.line, marginLeft: inset}, style]} />;
}

/** Fixed spacer. */
export function Spacer({size}: {size: number}) {
  return <View style={{width: size, height: size}} />;
}
