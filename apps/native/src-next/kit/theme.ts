import React, {createContext, useContext, useMemo} from 'react';
import {Platform, useWindowDimensions, type TextStyle} from 'react-native';
import {colors, componentSpec, layers, layout, motion, platformRadii, radii, spacing, targets, typography, typeScale, type TypeRole, type TypeStyle} from '@portico/design';

export const fontFamilies = {
  400: typography.regular,
  500: typography.medium,
  600: typography.semibold,
  700: typography.bold,
  800: typography.extraBold,
} as const;

/** Native fonts supply their own normal line metrics. Tracking is specified in em. */
export function nativeType(style: TypeStyle, textScale = 1): TextStyle {
  return {
    fontFamily: fontFamilies[style.weight],
    fontSize: style.size * textScale,
    letterSpacing: style.tracking * style.size * textScale,
    ...(style.lineHeight === 'normal' ? {} : {lineHeight: style.lineHeight * textScale}),
  };
}

export type ThemeOptions = {isTV: boolean; width: number; reduceMotion?: boolean; textScale?: number};
export function createTheme({isTV, width, reduceMotion = false, textScale = 1}: ThemeOptions) {
  const platform: 'phone' | 'tablet' | 'tv' = isTV ? 'tv' : width < layout.breakpoint.phone ? 'phone' : 'tablet';
  const scale = typeScale[isTV ? 'tenFoot' : 'handheld'];
  const type = Object.fromEntries(Object.entries(scale).map(([role, value]) => [role, nativeType(value, textScale)])) as Record<TypeRole, TextStyle>;
  return {
    platform, isTV, colors, space: spacing, type, spec: componentSpec, layout, layers, targets,
    radii: isTV ? platformRadii.tv : platformRadii.phone, baseRadii: radii,
    gutter: isTV ? layout.gutter.tv : layout.gutter.phone,
    motion, reduceMotion, textScale,
  };
}
export type Theme = ReturnType<typeof createTheme>;
const ThemeContext = createContext<Theme | undefined>(undefined);

export function ThemeProvider({children, reduceMotion = false, textScale = 1}: {children: React.ReactNode; reduceMotion?: boolean; textScale?: number}) {
  const {width} = useWindowDimensions();
  const isTV = Platform.isTV === true;
  const theme = useMemo(() => createTheme({isTV, width, reduceMotion, textScale}), [isTV, width, reduceMotion, textScale]);
  return React.createElement(ThemeContext.Provider, {value: theme}, children);
}

export function useTheme(): Theme {
  const theme = useContext(ThemeContext);
  if (!theme) throw new Error('A native theme provider is required.');
  return theme;
}
