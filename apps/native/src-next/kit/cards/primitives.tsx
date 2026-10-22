import React, {useEffect, useRef, useState, type ReactNode} from 'react';
import {Pressable, StyleSheet, Text, View, type PressableProps, type StyleProp, type TextStyle, type ViewStyle} from 'react-native';
import Animated, {useAnimatedStyle, useSharedValue, withTiming} from 'react-native-reanimated';
import Svg, {Defs, LinearGradient, Rect, Stop} from 'react-native-svg';
import type {FactPart} from '../../../../../packages/client-core/src/presentation/kit-model/index';
import {defaultI18n} from '../../../../../packages/i18n/src/index';
import {registerFocusedMenu} from '../../platform/menu-key';
import {Icon, type IconName} from '../Icon';
import {nativeType, useTheme} from '../theme';
import {useMotion} from '../useMotion';
import {activateCard, cardProgress, holdCard, type CardActions} from './model';

export const alpha = (color: string, opacity: number) => `${color}${Math.round(opacity * 255).toString(16).padStart(2, '0')}`;

export type CardNativeProps = Omit<PressableProps, 'children' | 'style' | 'onPress' | 'onLongPress' | 'onFocus' | 'onBlur' | 'onPressIn' | 'onPressOut' | 'onHoverIn' | 'onHoverOut'> & {
  title: string;
  caption?: readonly FactPart[];
  detail?: readonly FactPart[];
  width?: number;
  style?: StyleProp<ViewStyle>;
  onFocus?: () => void;
  onBlur?: () => void;
  density?: 'shelf' | 'grid';
  titleTextStyle?: StyleProp<TextStyle>;
  captionTextStyle?: StyleProp<TextStyle>;
  menuVisibility?: 'hover' | 'always';
};
export type CardProps = CardNativeProps & CardActions;
type Interaction = {focused: boolean; hovered: boolean; pressed: boolean};

/** One root TV focus target. Images and secondary affordances never register Menu. */
export function CardFrame({children, overlay, title, primaryAction, onNavigate, onPlay, onMore, selection, width, style, onFocus, onBlur, disabled, accessibilityLabel, testID, ...native}: CardProps & {children: (state: Interaction) => ReactNode; overlay?: (state: Interaction) => ReactNode}) {
  const theme = useTheme(), motion = useMotion();
  const [focused, setFocused] = useState(false), [hovered, setHovered] = useState(false), [pressed, setPressed] = useState(false);
  const owner = useRef({}), menuRegistration = useRef<(() => void) | undefined>(undefined), held = useRef(false), scale = useSharedValue(1);
  const actions = {primaryAction, onNavigate, onPlay, onMore, selection} as CardActions;
  useEffect(() => {
    menuRegistration.current?.();
    menuRegistration.current = focused && !disabled && onMore && theme.isTV ? registerFocusedMenu(owner.current, onMore) : undefined;
    return () => {menuRegistration.current?.(); menuRegistration.current = undefined;};
  }, [focused, disabled, onMore, theme.isTV]);
  useEffect(() => {
    const next = !motion.transforms ? 1 : theme.isTV && focused ? theme.spec.focus.scale.card.tv : pressed ? 0.97 : 1;
    scale.value = withTiming(next, motion.timing('quick'));
  }, [focused, pressed, theme.isTV, theme.spec.focus.scale.card.tv, motion, scale]);
  const animated = useAnimatedStyle(() => ({transform: [{scale: scale.value}]}));
  const label = accessibilityLabel ?? title;
  return <Animated.View style={[{width}, style, animated]}>
    <Pressable {...nativePressableProps(native)} testID={testID} disabled={disabled} accessibilityRole="button" accessibilityLabel={label}
      accessibilityState={{...native.accessibilityState, disabled, ...(selection?.active ? {selected: selection.selected} : {})}}
      accessibilityActions={[
        ...(native.accessibilityActions ?? []),
        ...(onPlay && primaryAction !== 'play' ? [{name: 'play', label: defaultI18n.t('card.play', {title})}] : []),
        ...(onMore ? [{name: 'more', label: defaultI18n.t('card.more', {title})}] : []),
        ...(selection ? [{name: 'select', label: defaultI18n.t('card.select', {title})}] : []),
      ]}
      onAccessibilityAction={event => {
        const name = event.nativeEvent.actionName;
        if (name === 'play') onPlay?.();
        else if (name === 'more') onMore?.();
        else if (name === 'select') selection?.active ? selection.onToggle() : selection?.onEnter();
        else native.onAccessibilityAction?.(event);
      }}
      onPress={() => {if (!held.current) activateCard(actions);}}
      onLongPress={() => {held.current = true; holdCard(actions, theme.isTV);}}
      onPressIn={() => {held.current = false; setPressed(true);}}
      onPressOut={() => setPressed(false)}
      onFocus={() => {
        menuRegistration.current?.();
        menuRegistration.current = !disabled && onMore && theme.isTV ? registerFocusedMenu(owner.current, onMore) : undefined;
        setFocused(true); onFocus?.();
      }}
      onBlur={() => {menuRegistration.current?.(); menuRegistration.current = undefined; setFocused(false); onBlur?.();}}
      onHoverIn={() => setHovered(true)} onHoverOut={() => setHovered(false)}>
      {children({focused, hovered, pressed})}
    </Pressable>
    {overlay?.({focused, hovered, pressed})}
  </Animated.View>;
}

/** Geometry belongs to the art, so focusing a poster never outlines its caption. */
export function ArtFrame({children, width, height, radius, focused, selected, hovered = false, hoverScale, circle = false, style}: {
  children: ReactNode; width?: number; height: number; radius?: number; focused: boolean; selected?: boolean; hovered?: boolean; hoverScale?: number; circle?: boolean; style?: StyleProp<ViewStyle>;
}) {
  const t = useTheme(), motion = useMotion(), scale = useSharedValue(1), focusOpacity = useSharedValue(0);
  useEffect(() => {
    scale.value = withTiming(motion.transforms && hovered && !selected ? hoverScale ?? t.spec.card.hover.artScale : 1, motion.timing('hover'));
    focusOpacity.value = withTiming(focused ? 1 : 0, motion.timing('quick'));
  }, [focused, hovered, hoverScale, selected, t.spec.card.hover.artScale, motion, scale, focusOpacity]);
  const artStyle = useAnimatedStyle(() => ({transform: [{scale: scale.value}]}));
  const focusStyle = useAnimatedStyle(() => ({opacity: focusOpacity.value}));
  const r = circle ? height / 2 : radius ?? t.spec.card.radius[t.platform];
  const offset = t.spec.focus.offsetOuter[t.platform], ring = t.spec.focus.ringWidth[t.platform];
  return <Animated.View style={[{width, height, borderRadius: r, backgroundColor: t.colors.raised}, style, artStyle]}>
    <View style={[StyleSheet.absoluteFill, {overflow: 'hidden', borderRadius: r}]}>{children}</View>
    {selected && <View pointerEvents="none" style={[StyleSheet.absoluteFill, {borderRadius: r, borderWidth: 3, borderColor: t.colors.accent}]} />}
    <Animated.View pointerEvents="none" style={[{position: 'absolute', top: -offset - ring, left: -offset - ring, right: -offset - ring, bottom: -offset - ring, borderRadius: r + offset + ring, borderWidth: ring, borderColor: t.colors.focus,
      ...(t.isTV ? {shadowColor: t.colors.accentStrong, shadowOpacity: 0.6, shadowOffset: {width: 0, height: 26}, shadowRadius: 32, elevation: 8} : {})}, focusStyle]} />
  </Animated.View>;
}

export function Parts({parts = [], style, gap = 8, strong = false}: {parts?: readonly FactPart[]; style?: StyleProp<TextStyle>; gap?: number; strong?: boolean}) {
  const t = useTheme();
  if (!parts.length) return null;
  return <View style={{flexDirection: 'row', alignItems: 'baseline', gap, minWidth: 0, overflow: 'hidden'}}>{parts.map(part => <Text key={part.id} numberOfLines={1} ellipsizeMode="tail" style={[
    t.type.cardSubtitle, {color: t.colors.textTertiary, flexShrink: part.role === 'context' ? 0 : 1},
    (strong || part.role === 'identity' || part.role === 'status') && {fontFamily: t.type.captionStrong.fontFamily, color: part.role === 'status' ? t.colors.accentStrong : t.colors.textSecondary}, style,
  ]}>{part.text}</Text>)}</View>;
}

export function Caption({title, caption, detail, density, titleTextStyle, captionTextStyle, selected, centered, lines = 1}: Pick<CardProps, 'title' | 'caption' | 'detail' | 'density' | 'titleTextStyle' | 'captionTextStyle'> & {selected?: boolean; centered?: boolean; lines?: number}) {
  const t = useTheme();
  const compact = density === 'grid' && !t.isTV;
  return <View style={{marginTop: compact ? 7 : t.spec.card.titleMargin[t.platform], gap: t.spec.card.subtitleMargin[t.platform], alignItems: centered ? 'center' : undefined}}>
    <Text numberOfLines={lines} ellipsizeMode="tail" style={[t.type.cardTitle, compact && titleStyle(12.5, 600), {color: selected ? t.colors.accentStrong : t.colors.text, textAlign: centered ? 'center' : 'left'}, titleTextStyle]}>{title}</Text>
    <Parts parts={caption} style={[compact && titleStyle(11.5, 600), captionTextStyle]} /><Parts parts={detail} style={[compact && titleStyle(11.5, 600), captionTextStyle]} />
  </View>;
}

export function Progress({value, height, paused = false, style}: {value?: number; height?: number; paused?: boolean; style?: StyleProp<ViewStyle>}) {
  const t = useTheme(), p = cardProgress(value);
  if (p === undefined) return null;
  return <View pointerEvents="none" style={[{height: height ?? t.spec.card.progress.height[t.platform], overflow: 'hidden', borderRadius: 4, backgroundColor: alpha(t.colors.text, 0.22)}, style]}>
    <View style={{height: '100%', width: `${p * 100}%`, borderRadius: 4, backgroundColor: paused ? t.colors.textTertiary : t.colors.accentStrong}} />
  </View>;
}

export function Scrim({horizontal = false, start = 0.45, opacity = 0.85}: {horizontal?: boolean; start?: number; opacity?: number}) {
  const t = useTheme();
  return <Svg pointerEvents="none" style={StyleSheet.absoluteFill} width="100%" height="100%"><Defs><LinearGradient id="card-scrim" x1="0" y1="0" x2={horizontal ? '1' : '0'} y2={horizontal ? '0' : '1'}>
    <Stop offset="0" stopColor={t.colors.ink} stopOpacity={0} /><Stop offset={start} stopColor={t.colors.ink} stopOpacity={0} /><Stop offset="1" stopColor={t.colors.ink} stopOpacity={opacity} />
  </LinearGradient></Defs><Rect width="100%" height="100%" fill="url(#card-scrim)" /></Svg>;
}

export function Badge({children, kind = 'plain'}: {children?: ReactNode; kind?: 'new' | 'plain' | 'watched'}) {
  const t = useTheme();
  return <View style={{paddingHorizontal: t.spec.card.badge.paddingX[t.platform], paddingVertical: t.spec.card.badge.paddingY[t.platform], borderRadius: t.spec.card.badge.radius[t.platform], backgroundColor: kind === 'new' ? t.colors.accent : alpha(t.colors.ink, 0.72)}}>
    {kind === 'watched' ? <Icon name="i-check" size={t.isTV ? 22 : 16} color={t.colors.text} /> : <Text numberOfLines={1} style={[t.type.badge, {color: kind === 'new' ? t.colors.actionInk : t.colors.text}]}>{children}</Text>}
  </View>;
}

/** A separate phone/pointer action; TV keeps its one root focus and real hold-OK menu. */
export function CardAction({name, label, onPress, size = 40, style, color}: {name: IconName; label: string; onPress: () => void; size?: number; style?: StyleProp<ViewStyle>; color?: string}) {
  const t = useTheme();
  return <Pressable accessibilityRole="button" accessibilityLabel={label} onPress={event => {event.stopPropagation(); onPress();}} style={({pressed}) => [{width: size, height: size, minWidth: 44, minHeight: 44, borderRadius: size / 2, alignItems: 'center', justifyContent: 'center', backgroundColor: t.colors.text, opacity: pressed ? 0.8 : 1}, style]}>
    <Icon name={name} size={20} color={color ?? t.colors.ink} />
  </Pressable>;
}

/** Composite-only inputs never reach a native view (in particular authenticated image sources). */
function nativePressableProps(props: Record<string, unknown>): PressableProps {
  const names = new Set(['accessible', 'accessibilityHint', 'accessibilityValue', 'accessibilityLiveRegion', 'accessibilityElementsHidden', 'importantForAccessibility', 'accessibilityLanguage', 'accessibilityLabelledBy', 'accessibilityIgnoresInvertColors', 'accessibilityViewIsModal', 'nativeID', 'collapsable', 'hitSlop', 'pressRetentionOffset', 'delayLongPress', 'unstable_pressDelay', 'android_disableSound', 'android_ripple', 'focusable', 'hasTVPreferredFocus', 'nextFocusDown', 'nextFocusForward', 'nextFocusLeft', 'nextFocusRight', 'nextFocusUp', 'tvParallaxProperties', 'onLayout', 'onAccessibilityEscape', 'onMagicTap', 'onAccessibilityTap']);
  return Object.fromEntries(Object.entries(props).filter(([name]) => names.has(name))) as PressableProps;
}

export function titleStyle(size: number, weight: 600 | 700 | 800 = 700, tracking = 0): TextStyle {
  return nativeType({size, weight, tracking, lineHeight: 'normal'});
}
