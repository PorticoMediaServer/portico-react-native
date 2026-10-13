import React, {useContext, useEffect, useRef} from 'react';
import {Animated, Easing, View, type StyleProp, type ViewStyle} from 'react-native';
import {Button} from './Button';
import {Icon, type IconName} from './Icon';
import {ScreenSpeechContext} from './NavBar';
import {Ring as TurningRing} from './Ring';
import {Text} from './Text';
import {alpha, spec, useSpecPlatform, useTheme} from './theme';

export type NoticeTone = 'info' | 'success' | 'warning' | 'error' | 'danger';

/** The ring Portico waits with (`Ring.tsx`), from where it has always been imported. */
export const Ring = TurningRing;

/** Inline notice for errors, warnings and confirmations. One shape everywhere. */
export function Notice({tone = 'info', title, message, action, onAction, style}: {tone?: NoticeTone; title?: string; message: string; action?: string; onAction?: () => void; style?: StyleProp<ViewStyle>}) {
  const {colors} = useTheme();
  const platform = useSpecPlatform();
  const n = spec.feedback.notice;
  // feedbackSpec.notice: one glyph per tone; an error is never drawn with the warning triangle.
  // CON-18: tone names match web (`info | success | warning | error`); `danger` is a deprecated
  // alias for `error` kept so other lanes' call sites keep compiling while they migrate.
  const t = n.tones[tone === 'danger' ? 'error' : tone];
  const color = colors[t.color as keyof typeof colors];
  return (
    <View accessibilityRole={tone === 'danger' || tone === 'error' ? 'alert' : undefined} style={[{flexDirection: 'row', gap: n.gap[platform], alignItems: 'center', padding: n.padding[platform], borderRadius: n.radius[platform], backgroundColor: alpha(color, t.tintAlpha), borderWidth: 1, borderColor: alpha(color, t.borderAlpha)}, style]}>
      <Icon name={t.icon as IconName} size={n.icon[platform]} color={color} />
      <View style={{flex: 1, minWidth: 0}}>
        {title ? <Text variant={n.title}>{title}</Text> : null}
        <Text variant={n.text} tone="secondary">{message}</Text>
      </View>
      {action && onAction ? <Button size={n.action.size} variant={n.action.variant} label={action} onPress={onAction} /> : null}
    </View>
  );
}

/** Pulsing placeholder block while shape is unknown. Never shown over valid content. */
export function Skeleton({width, height, radius, style}: {width?: number | string; height: number; radius?: number; style?: StyleProp<ViewStyle>}) {
  const {colors, metrics, motion} = useTheme();
  // Native-driver pulse, and it settles after a few beats: a placeholder that is still up after
  // that is waiting on something slow, and an endless pulse only burns power while it waits.
  const pulse = useRef(new Animated.Value(0.5)).current;
  useEffect(() => {
    if (motion.reduce) return;
    const beat = Animated.sequence([
      Animated.timing(pulse, {toValue: 1, duration: 900, easing: Easing.inOut(Easing.quad), useNativeDriver: true}),
      Animated.timing(pulse, {toValue: 0.5, duration: 900, easing: Easing.inOut(Easing.quad), useNativeDriver: true}),
    ]);
    const loop = Animated.loop(beat, {iterations: 4});
    loop.start();
    return () => loop.stop();
  }, [pulse, motion.reduce]);
  const animated = {opacity: pulse};
  return <Animated.View style={[{width: (width ?? '100%') as number, height, borderRadius: radius ?? metrics.radius.card, backgroundColor: alpha(colors.raisedHigh, 0.8)}, animated, style]} />;
}

/** Centred empty / error / loading state with an icon, copy and one action. */
/**
 * Centred empty / error / loading state (feedbackSpec.stateView): a glyph in a circle, a title,
 * body text and at most two actions: the primary for recovery ("Try again", "Refresh"), and a
 * ghost for the alternative. While Portico retries on its own, show no button.
 */
export function StateView({icon = 'info', title, message, action, onAction, secondaryAction, onSecondaryAction, loading, style}: {icon?: IconName; title: string; message?: string; action?: string; onAction?: () => void; secondaryAction?: string; onSecondaryAction?: () => void; loading?: boolean; style?: StyleProp<ViewStyle>}) {
  const {colors, space} = useTheme();
  const platform = useSpecPlatform();
  const v = spec.feedback.stateView;
  const circle = v.iconCircle[platform];
  // A screen reader hears a state that replaces the content (an error, nothing here yet) once,
  // when it appears. Loading is not announced: it would only be noise before the real answer.
  const speak = useContext(ScreenSpeechContext);
  const spoken = loading ? '' : message ? `${title}. ${message}` : title;
  useEffect(() => { if (spoken) speak(spoken); }, [speak, spoken]);
  return (
    <View style={[{alignItems: 'center', justifyContent: 'center', padding: space.xxl, gap: v.gap[platform]}, style]}>
      {loading ? <Ring label={title} /> : <View style={{width: circle, height: circle, borderRadius: circle / 2, backgroundColor: colors.raisedHigh, alignItems: 'center', justifyContent: 'center'}}><Icon name={icon} size={v.icon[platform]} color={colors.textSecondary} /></View>}
      <Text variant={v.title} align="center" style={{maxWidth: v.maxWidth[platform]}}>{title}</Text>
      {message ? <Text variant={v.body} tone="secondary" align="center" style={{maxWidth: v.maxWidth[platform]}}>{message}</Text> : null}
      {(action && onAction) || (secondaryAction && onSecondaryAction) ? (
        <View style={{flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'center', gap: spec.button.gap[platform], marginTop: space.xs}}>
          {action && onAction ? <Button variant={v.action.variant} size={v.action.size} label={action} onPress={onAction} /> : null}
          {secondaryAction && onSecondaryAction ? <Button variant={v.secondaryAction.variant} size={v.action.size} label={secondaryAction} onPress={onSecondaryAction} /> : null}
        </View>
      ) : null}
    </View>
  );
}

/** Small count / status chip. */
export function Badge({label, tone = 'neutral'}: {label: string; tone?: 'neutral' | 'accent' | 'record' | 'amber'}) {
  const {colors, space, metrics} = useTheme();
  const color = tone === 'accent' ? colors.accent : tone === 'record' ? colors.record : tone === 'amber' ? colors.amber : colors.textSecondary;
  return (
    <View style={{paddingHorizontal: space.sm, paddingVertical: 2, borderRadius: metrics.radius.small, backgroundColor: alpha(color, 0.16), alignSelf: 'flex-start'}}>
      <Text variant="micro" style={{color}}>{label}</Text>
    </View>
  );
}

/** Horizontal progress bar (timelines, downloads). */
export function ProgressBar({value, height, style}: {value: number; height?: number; style?: StyleProp<ViewStyle>}) {
  const {colors} = useTheme();
  const h = height ?? 4;
  return (
    <View style={[{height: h, borderRadius: h / 2, backgroundColor: colors.trackRest, overflow: 'hidden'}, style]}>
      <View style={{width: `${Math.max(0, Math.min(1, value)) * 100}%`, height: '100%', backgroundColor: colors.accent}} />
    </View>
  );
}
