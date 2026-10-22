import React, {createContext, useContext, useMemo} from 'react';
import {Platform, useWindowDimensions, type TextStyle} from 'react-native';
import {colors, componentSpec, layers, layout, motion, platformRadii, radii, spacing, targets, typography, typeScale, type TypeRole, type TypeStyle} from '@portico/design';
import {sizeClassForWidth} from '../../../../packages/client-core/src';

export {useSizeClass, type SizeClass} from './useSizeClass';

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
  // componentSpec names its desktop column web; layoutMode names the actual shell layout.
  const sizeClass = sizeClassForWidth(width);
  const platform: 'phone' | 'tablet' | 'web' | 'tv' = isTV ? 'tv' : sizeClass === 'expanded' ? 'web' : sizeClass === 'compact' ? 'phone' : 'tablet';
  const layoutMode: 'phone' | 'desktop' | 'tv' = isTV ? 'tv' : platform === 'web' ? 'desktop' : 'phone';
  const scale = typeScale[isTV ? 'tenFoot' : layoutMode === 'desktop' ? 'desktop' : 'handheld'];
  const type = Object.fromEntries(Object.entries(scale).map(([role, value]) => [role, nativeType(value, textScale)])) as Record<TypeRole, TextStyle>;
  return {
    platform, layoutMode, sizeClass, width, isTV, colors, space: spacing, type, spec: componentSpec, layout, layers, targets,
    radii: isTV ? platformRadii.tv : platformRadii.phone, baseRadii: radii,
    gutter: isTV ? layout.gutter.tv : layoutMode === 'desktop' ? width >= layout.designWidth.desktop ? layout.gutter.desktop : layout.gutter.desktopNarrow : layout.gutter.phone,
    motion, reduceMotion, textScale,
  };
}
export type Theme = ReturnType<typeof createTheme>;
const ThemeContext = createContext<Theme | undefined>(undefined);

export function ThemeProvider({children, width: surfaceWidth, reduceMotion = false, textScale = 1}: {children: React.ReactNode; width?: number; reduceMotion?: boolean; textScale?: number}) {
  const dimensions = useWindowDimensions();
  const width = surfaceWidth ?? dimensions.width;
  const isTV = Platform.isTV === true;
  const theme = useMemo(() => createTheme({isTV, width, reduceMotion, textScale}), [isTV, width, reduceMotion, textScale]);
  return React.createElement(ThemeContext.Provider, {value: theme}, children);
}

export function useTheme(): Theme {
  const theme = useContext(ThemeContext);
  if (!theme) throw new Error('A native theme provider is required.');
  return theme;
}
