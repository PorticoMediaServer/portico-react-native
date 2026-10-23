import React, {useCallback, useEffect, useRef, type ReactNode} from 'react';
import {Text, View, type StyleProp, type ViewStyle} from 'react-native';
import {useTheme} from '../../kit/theme';
import {shellType} from '../../kit/shell/visual';
import {useFocusRegistry} from '../../kit/focus';
import type {FocusAddress} from '../../kit/focus/registry';
import type {NativeShellRuntime} from '../../shell/runtime';

export function Screen({children, title, style}: {children: ReactNode; title?: string; style?: StyleProp<ViewStyle>}) {
  const theme = useTheme();
  return <View style={[{flex: 1, backgroundColor: theme.colors.ink, paddingLeft: theme.isTV ? 200 : 0, paddingRight: theme.isTV ? 96 : 0, paddingTop: theme.isTV ? 60 : 0}, style]}>
    {title && <Text accessibilityRole="header" style={[shellType(theme.isTV ? 44 : 32, 800, 'normal', -.035), {color: theme.colors.text, marginBottom: theme.isTV ? 38 : 16, marginHorizontal: theme.isTV ? 0 : 20}]}>{title}</Text>}
    {children}
  </View>;
}

/** First entry is requested only after the real target's native layout exists. */
export function useScreenEntry(target: FocusAddress | undefined, current: () => boolean) {
  const registry = useFocusRegistry(), entered = useRef(false), frame = useRef<number | undefined>(undefined);
  const request = useCallback(() => {
    if (!target || entered.current || frame.current !== undefined) return;
    frame.current = requestAnimationFrame(() => {frame.current = undefined; if (current() && !entered.current) entered.current = registry.focus(target);});
  }, [current, registry, target?.regionId, target?.childId]);
  useEffect(() => () => {if (frame.current !== undefined) cancelAnimationFrame(frame.current);}, []);
  return request;
}

export function useScreenBack(runtime: NativeShellRuntime, handler: () => boolean, isTV: boolean) {
  useEffect(() => isTV ? runtime.registerTVPageBack?.(handler) : undefined, [runtime, handler, isTV]);
}

export function ScreenText({children, secondary = false}: {children: ReactNode; secondary?: boolean}) {
  const theme = useTheme();
  return <Text style={[shellType(theme.isTV ? 24 : 15, secondary ? 400 : 600, 'normal'), {color: secondary ? theme.colors.textSecondary : theme.colors.text}]}>{children}</Text>;
}
