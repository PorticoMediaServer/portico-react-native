import React from 'react';
import {Text as RNText, type TextProps as RNTextProps, type TextStyle} from 'react-native';
import {useTheme} from './theme';

export type TextRole = 'display' | 'title' | 'heading' | 'subheading' | 'body' | 'bodyStrong' | 'caption' | 'captionStrong' | 'micro' | 'label';
export type TextTone = 'primary' | 'secondary' | 'tertiary' | 'accent' | 'danger' | 'inverse' | 'amber' | 'healthy';

export type TextProps = RNTextProps & {
  variant?: TextRole;
  tone?: TextTone;
  align?: TextStyle['textAlign'];
  /** Clamp to N lines with a tail ellipsis. */
  lines?: number;
};

/**
 * The only text primitive. Roles map to the platform type scale so a screen
 * never chooses a font size; tones map to semantic colours.
 */
export function Text({variant = 'body', tone = 'primary', align, lines, style, ...rest}: TextProps) {
  const {type, colors, isTV} = useTheme();
  const color =
    tone === 'primary' ? colors.text
    : tone === 'secondary' ? colors.textSecondary
    : tone === 'tertiary' ? colors.textTertiary
    : tone === 'accent' ? colors.accent
    : tone === 'danger' ? colors.danger
    : tone === 'amber' ? colors.amber
    : tone === 'healthy' ? colors.healthy
    : colors.accentInk;
  return (
    <RNText
      allowFontScaling={!isTV}
      // APL-SYS-03: no app-wide cap on Dynamic Type. Only one-line micro chrome (badges, tab
      // labels), which has an accessible alternative, stops at 2×.
      maxFontSizeMultiplier={variant === 'micro' ? 2 : undefined}
      numberOfLines={lines}
      ellipsizeMode="tail"
      {...rest}
      style={[type[variant], {color}, align ? {textAlign: align} : null, style]}
    />
  );
}
