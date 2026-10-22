import React, {forwardRef} from 'react';
import {StyleSheet, Text, View, type StyleProp, type TextStyle} from 'react-native';
import {chipSpec} from '@portico/design';
import {Icon, type IconName} from '../Icon';
import {fontFamilies, useTheme} from '../theme';
import {Focusable, type FocusableProps} from './Focusable';
import {chipGeometry, colorAlpha, minimumHitSlop, type ChipVariant} from './control-model';

export type ChipProps = Omit<FocusableProps, 'children'> & {
  children?: React.ReactNode;
  variant?: ChipVariant;
  selected?: boolean;
  count?: React.ReactNode;
  dim?: boolean;
  retry?: boolean;
  prefix?: React.ReactNode;
  icon?: IconName;
  trailingIcon?: IconName;
  textStyle?: StyleProp<TextStyle>;
};

export const Chip = forwardRef<View, ChipProps>(function Chip({
  children, variant = 'default', selected = false, count, dim = false, retry = false, prefix,
  icon, trailingIcon, disabled, accessibilityState, style, textStyle, hitSlop, ...props
}, ref) {
  const theme = useTheme();
  const geometry = chipGeometry(variant, theme.platform);
  const isFacet = variant === 'facet' || variant === 'pill' || variant === 'quick';
  const applied = variant === 'applied';
  const slop = minimumHitSlop(geometry.height, theme.isTV);
  const border = selected ? colorAlpha(theme.isTV ? theme.colors.accentStrong : theme.colors.accent, theme.isTV ? .7 : 1) : isFacet ? theme.colors.lineStrong : 'transparent';
  const color = dim ? theme.colors.textTertiary : selected || !isFacet ? theme.colors.text : theme.colors.textSecondary;
  return <Focusable {...props} ref={ref} disabled={disabled} focusKind="chip" focusRadius={geometry.radius}
    accessibilityRole={props.accessibilityRole ?? 'button'} accessibilityState={{...accessibilityState, selected}}
    hitSlop={hitSlop ?? {top: slop, bottom: slop, left: slop, right: slop}}
    style={state => [styles.chip, {height: geometry.height, borderRadius: geometry.radius, paddingHorizontal: geometry.paddingX,
      gap: geometry.gap, borderWidth: theme.isTV ? 1.5 : 1, borderColor: border,
      opacity: disabled ? .45 : dim ? .6 : 1,
      backgroundColor: selected ? colorAlpha(theme.colors.accent, theme.isTV ? .24 : .28) : isFacet ? 'transparent' : theme.isTV && !applied ? colorAlpha(theme.colors.text, .08) : theme.colors.raisedHigh},
      typeof style === 'function' ? style(state) : style]}>
    {icon ? <Icon name={icon} size={chipSpec.icon[theme.platform]} color={selected ? theme.colors.accentStrong : color} /> : null}
    {prefix !== undefined ? <Text numberOfLines={1} style={[theme.type.chip, {color: theme.colors.textTertiary, fontFamily: fontFamilies[600], fontSize: geometry.fontSize * theme.textScale}]}>{prefix}</Text> : null}
    <Text numberOfLines={1} ellipsizeMode="tail" style={[theme.type.chip, styles.label, {color, fontSize: geometry.fontSize * theme.textScale}, textStyle]}>{children}</Text>
    {count !== undefined ? <Text numberOfLines={1} style={[theme.type.captionStrong, {color: selected ? theme.colors.textSecondary : theme.colors.textTertiary}]}>{count}</Text> : null}
    {retry ? <Icon name="i-retry" size={theme.isTV ? 24 : 16} color={theme.colors.accentStrong} /> : null}
    {trailingIcon ? <Icon name={trailingIcon} size={chipSpec.icon[theme.platform]} color={theme.colors.textTertiary} /> : null}
  </Focusable>;
});

const styles = StyleSheet.create({chip: {flexDirection: 'row', alignItems: 'center', alignSelf: 'flex-start', flexShrink: 1}, label: {flexShrink: 1}});
