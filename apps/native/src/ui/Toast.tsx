import React, {useEffect, useState, useSyncExternalStore} from 'react';
import {View} from 'react-native';
import {useSafeAreaInsets} from 'react-native-safe-area-context';
import Animated, {Easing, useAnimatedStyle, useSharedValue, withTiming} from 'react-native-reanimated';
import {Button} from './Button';
import {Icon, type IconName} from './Icon';
import {Text} from './Text';
import {alpha, spec, useSpecPlatform, useTheme} from './theme';

export type ToastInput = {message: string; icon?: IconName; action?: {label: string; onPress: () => void}};
type ToastEntry = ToastInput & {id: number};

/**
 * Toasts (feedbackSpec.toast): the result of an action and the undo for a tier-0 change (CON-06).
 * A result never opens a second overlay; it shows here. One at a time, newest wins.
 */
let current: ToastEntry | undefined;
let nextId = 0;
const listeners = new Set<() => void>();
const emit = () => { for (const l of [...listeners]) l(); };

export function showToast(input: ToastInput): void {
  current = {...input, id: ++nextId};
  emit();
}
export function dismissToast(): void {
  if (!current) return;
  current = undefined;
  emit();
}
const subscribe = (l: () => void) => { listeners.add(l); return () => { listeners.delete(l); }; };
const snapshot = () => current;

/**
 * Mount once, above the navigation and below modals (the shell). `bottomOffset` lifts it over the
 * iPhone tab bar and mini player; television places it at the top trailing corner.
 */
export function ToastHost({bottomOffset = 0}: {bottomOffset?: number}) {
  const toast = useSyncExternalStore(subscribe, snapshot);
  const {colors, isTV, motion, space} = useTheme();
  const platform = useSpecPlatform();
  const insets = useSafeAreaInsets();
  const t = spec.feedback.toast;
  const [shown, setShown] = useState<ToastEntry>();
  const progress = useSharedValue(0);
  useEffect(() => {
    if (toast) setShown(toast);
    progress.value = withTiming(toast ? 1 : 0, {duration: motion.reduce ? 0 : toast ? spec.overlay.motion.enterMs : spec.overlay.motion.exitMs, easing: Easing.out(Easing.cubic)});
    if (!toast) return;
    const timer = setTimeout(() => { if (current?.id === toast.id) dismissToast(); }, toast.action ? t.durationWithActionMs : t.durationMs);
    return () => clearTimeout(timer);
  }, [toast, progress, motion.reduce, t.durationMs, t.durationWithActionMs]);
  const animated = useAnimatedStyle(() => ({opacity: progress.value, transform: [{translateY: (1 - progress.value) * (isTV ? -12 : 12)}]}));
  if (!shown) return null;
  const maxWidth = t.maxWidth[platform] || undefined;
  return (
    <View pointerEvents="box-none" style={{position: 'absolute', left: 0, right: 0, ...(isTV ? {top: Math.max(insets.top, 60)} : {bottom: insets.bottom + bottomOffset + space.md}), alignItems: isTV ? 'flex-end' : 'center', paddingHorizontal: isTV ? 80 : space.page}}>
      <Animated.View
        accessibilityLiveRegion="polite"
        accessibilityRole="alert"
        style={[{maxWidth, alignSelf: isTV ? 'flex-end' : 'stretch', flexDirection: 'row', alignItems: 'center', gap: space.md, paddingHorizontal: t.paddingX[platform], paddingVertical: t.paddingY[platform], borderRadius: t.radius[platform], backgroundColor: colors.overlaySurface, borderWidth: 1, borderColor: alpha(colors.lineStrong, spec.overlay.border.alpha)}, animated]}>
        {shown.icon ? <Icon name={shown.icon} color={colors.textSecondary} /> : null}
        <Text variant="body" style={{flexShrink: 1}}>{shown.message}</Text>
        {shown.action ? <Button variant="link" size="sm" label={shown.action.label} focusable={isTV} onPress={() => { shown.action!.onPress(); dismissToast(); }} /> : null}
      </Animated.View>
    </View>
  );
}
