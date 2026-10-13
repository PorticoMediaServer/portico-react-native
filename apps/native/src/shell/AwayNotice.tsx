import React, {useEffect, useState} from 'react';
import {View} from 'react-native';
import {useSafeAreaInsets} from 'react-native-safe-area-context';
import Animated, {Easing, useAnimatedStyle, useSharedValue, withTiming} from 'react-native-reanimated';
import {useI18n} from '../app/i18n';
import {useReachability} from '../app/freshness';
import {useSession} from '../app/session';
import {Icon, Text, alpha, spec, useTheme} from '../ui';

/**
 * The server has been out of reach for a while. The screen stays exactly as it is (what it shows
 * was read while the server answered, and reads are being tried again behind it); this one small
 * line says why nothing is changing. It appears only after a sustained failure and goes away by
 * itself with the first thing that succeeds.
 *
 * It is drawn over the shell and takes no room, no touches and no focus: nothing on screen moves
 * when it comes or goes, and on television the focused card stays focused.
 */
export function AwayNotice() {
  const i18n = useI18n();
  const away = useReachability() === 'unreachable';
  const session = useSession();
  const {colors, motion, space, isTV} = useTheme();
  const insets = useSafeAreaInsets();
  const [mounted, setMounted] = useState(away);
  const progress = useSharedValue(away ? 1 : 0);
  useEffect(() => {
    if (away) setMounted(true);
    const duration = motion.reduce ? 0 : away ? spec.overlay.motion.enterMs : spec.overlay.motion.exitMs;
    progress.value = withTiming(away ? 1 : 0, {duration, easing: Easing.out(Easing.cubic)});
    if (away) return;
    const timer = setTimeout(() => setMounted(false), duration + 50);
    return () => clearTimeout(timer);
  }, [away, progress, motion.reduce]);
  const animated = useAnimatedStyle(() => ({opacity: progress.value}));
  if (!mounted) return null;
  const server = session.system?.name || session.saved?.host || i18n.t('servers.fallbackName');
  return (
    <View pointerEvents="none" style={{position: 'absolute', left: 0, right: 0, top: Math.max(insets.top, isTV ? 36 : 0) + space.sm, alignItems: 'center', zIndex: 30}}>
      <Animated.View
        accessibilityLiveRegion="polite"
        accessibilityRole="text"
        style={[{flexDirection: 'row', alignItems: 'center', gap: space.sm, paddingHorizontal: space.md, paddingVertical: space.sm, borderRadius: 999, backgroundColor: colors.overlaySurface, borderWidth: 1, borderColor: alpha(colors.lineStrong, spec.overlay.border.alpha)}, animated]}>
        <Icon name="info" size={isTV ? 22 : 16} color={colors.textSecondary} />
        <Text variant="caption" tone="secondary">{i18n.t('web.connection.cantReach', {server})}</Text>
      </Animated.View>
    </View>
  );
}
