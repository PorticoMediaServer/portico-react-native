import React, {useEffect, useRef, useState} from 'react';
import {Animated, Image, PixelRatio, StyleSheet, View, type ImageSourcePropType, type StyleProp, type ViewStyle} from 'react-native';
import {sizedUri, useArtworkPlacement, useArtworkSlot} from './ArtworkPipeline';
import {Icon, type IconName} from './Icon';
import {Text} from './Text';
import {uiI18n} from './i18n';
import {alpha, useTheme} from './theme';

export type ArtworkShape = 'poster' | 'landscape' | 'square' | 'circle';

export const artworkRatio: Record<ArtworkShape, number> = {poster: 2 / 3, landscape: 16 / 9, square: 1, circle: 1};

/** Stable identity for an image source so effects key on the URL, not the object. */
export function sourceKey(source?: ImageSourcePropType): string {
  if (!source) return '';
  if (typeof source === 'number') return String(source);
  if (Array.isArray(source)) return source.map(s => s.uri ?? '').join('|');
  return (source as {uri?: string}).uri ?? '';
}

function withAttempt(source: ImageSourcePropType, uri: string, attempt: number): ImageSourcePropType {
  if (typeof source === 'number' || Array.isArray(source)) return source;
  return {...(source as object), uri: attempt ? `${uri}${uri.includes('?') ? '&' : '?'}r=${attempt}` : uri} as ImageSourcePropType;
}

/**
 * Image with a designed placeholder (never a blank box): the title set in Manrope on a soft slate
 * surface, or a family icon. The placeholder stays underneath until the image decodes.
 *
 * PERF-03 / APL-SYS-11: loading goes through the shared artwork scheduler (`ArtworkPipeline`).
 * Cards load in visual order (row, then column, the hero first, rows finishing left to right).
 * Each card asks for the one server variant that fits its size (`w=`). A failed or slow image is
 * retried with backoff without holding a slot. An image already decoded once appears at once,
 * with no fade (PERF-05: the fade is a core `Animated` value on the native driver, not a
 * Reanimated component per card).
 */
export const Artwork = React.memo(function Artwork({source, shape = 'poster', width, height, radius, title, icon, placeholder, style, priority = false}: {source?: ImageSourcePropType; shape?: ArtworkShape; width?: number; height?: number; radius?: number; title?: string; icon?: IconName; /** Drawn in place of the title or icon until the image is on screen (a person's initials). */ placeholder?: React.ReactNode; style?: StyleProp<ViewStyle>; priority?: boolean}) {
  const {colors, metrics, space, isTV} = useTheme();
  const w = width ?? (height ? height * artworkRatio[shape] : metrics.posterWidth);
  const h = height ?? w / artworkRatio[shape];
  const r = shape === 'circle' ? w / 2 : radius ?? metrics.radius.card;
  const raw = sourceKey(source);
  const remote = !!raw && typeof source === 'object' && !Array.isArray(source);
  const uri = remote ? sizedUri(raw, w, artworkRatio[shape], PixelRatio.get()) : raw;
  const placement = useArtworkPlacement();
  const slot = useArtworkSlot(remote ? uri : '', placement, priority);
  const known = slot.cached;
  const opacity = useRef(new Animated.Value(known ? 1 : 0)).current;
  const [ready, setReady] = useState(known);
  useEffect(() => {
    opacity.setValue(slot.cached ? 1 : 0);
    setReady(slot.cached);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [uri]);
  // An image that had loaded and can no longer be shown gets its placeholder back while it is
  // fetched again, instead of staying an empty tile.
  useEffect(() => {
    if (!slot.recovering) return;
    opacity.setValue(0);
    setReady(false);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [slot.recovering, slot.attempt]);
  // Tiny thumbnails cannot hold a readable title; they show the family icon instead.
  const small = Math.min(w, h) < 80;
  const placeholderIcon = icon ?? (small ? 'film' : undefined);
  // A source with no address is no image. (Given an empty address, Android answers with a blank
  // image and reports it loaded, which would take the placeholder away for nothing.)
  const mount = !!source && (remote ? slot.active : typeof source !== 'object' || Array.isArray(source));
  return (
    <View style={[{width: w, height: h, borderRadius: r, overflow: 'hidden', backgroundColor: colors.raised}, style]} accessibilityLabel={!source || slot.gaveUp ? (title ? uiI18n().t('a11y.artwork.unavailableFor', {title}) : uiI18n().t('a11y.artwork.unavailable')) : undefined}>
      {!ready ? (
        <View style={[StyleSheet.absoluteFill, {alignItems: 'center', justifyContent: 'center', padding: space.sm, backgroundColor: alpha(colors.raisedHigh, 0.75)}]}>
          {placeholder}
          {!placeholder && placeholderIcon && (small || !title || icon) ? <Icon name={placeholderIcon} size={Math.min(w, h) * 0.32} color={alpha(colors.textTertiary, 0.7)} /> : null}
          {!placeholder && title && !icon && !small ? (
            <Text variant={isTV ? 'subheading' : 'captionStrong'} tone="secondary" align="center" lines={shape === 'landscape' ? 2 : 4}>
              {title}
            </Text>
          ) : null}
        </View>
      ) : null}
      {mount && source ? (
        <Animated.Image
          key={slot.attempt}
          source={remote ? withAttempt(source, uri, slot.attempt) : source}
          resizeMode="cover"
          onLoad={() => {
            slot.loaded();
            setReady(true);
            if (!known) Animated.timing(opacity, {toValue: 1, duration: priority ? 120 : 200, useNativeDriver: true}).start();
            else opacity.setValue(1);
          }}
          onError={e => slot.failed(new Error(String(e.nativeEvent?.error ?? 'Image failed to load.')))}
          style={[StyleSheet.absoluteFill, {opacity}]}
        />
      ) : null}
    </View>
  );
});

/** Thin progress line drawn along the bottom edge of artwork. */
export function ProgressLine({value, style}: {value: number; style?: StyleProp<ViewStyle>}) {
  const {colors} = useTheme();
  const pct = Math.max(0, Math.min(1, value));
  if (pct <= 0) return null;
  return (
    <View style={[{position: 'absolute', left: 0, right: 0, bottom: 0, height: 4, backgroundColor: alpha(colors.black, 0.45)}, style]}>
      <View style={{width: `${pct * 100}%`, height: '100%', backgroundColor: colors.accent}} />
    </View>
  );
}

export {Image};
