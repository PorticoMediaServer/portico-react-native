import React from 'react';
import {View, type StyleProp, type ViewStyle} from 'react-native';
import {uiI18n} from './i18n';
import {Focusable} from './Focusable';
import {Icon, type IconName} from './Icon';
import {Text} from './Text';
import {alpha, hitSlopFor, spec, useSpecPlatform, useTheme} from './theme';

/**
 * A chip (chipSpec): a quick filter, or a removable filter token. 32 pt tall with a 44 pt hit
 * area on touch, 64 px on TV; pill-shaped. Selected is an accent tint with an accent border and
 * a primary-text label. A removable chip ends with a close glyph and is named "Remove {label}".
 */
export function Chip({label, icon, selected = false, removable = false, onPress, disabled, style, accessibilityLabel}: {label: string; icon?: IconName; selected?: boolean; removable?: boolean; onPress?: () => void; disabled?: boolean; style?: StyleProp<ViewStyle>; accessibilityLabel?: string}) {
  const {colors, isTV} = useTheme();
  const platform = useSpecPlatform();
  const c = spec.chip;
  const height = c.height[platform];
  const iconSize = c.icon[platform];
  const token = (name: string, a?: number) => (a === undefined ? colors[name as keyof typeof colors] : alpha(colors[name as keyof typeof colors], a));
  return (
    <Focusable
      radius={height / 2}
      disabled={disabled}
      scale={isTV ? spec.focus.scale.chip.tv : 1}
      hitSlop={hitSlopFor(height, c.minHit[platform])}
      accessibilityRole="button"
      accessibilityState={{selected, disabled: !!disabled}}
      accessibilityLabel={accessibilityLabel ?? (removable ? uiI18n().t('action.remove', {label}) : label)}
      onPress={onPress}
      style={[{alignSelf: 'flex-start'}, style]}>
      {({focused, hovered}) => {
        const fill = selected ? c.selected : focused || hovered ? c.hover : c.rest;
        const foreground = token(fill.foreground);
        return (
          <View style={{height, paddingHorizontal: c.paddingX[platform], borderRadius: height / 2, flexDirection: 'row', alignItems: 'center', gap: c.gap[platform], backgroundColor: token(fill.background, fill.backgroundAlpha), borderWidth: 1, borderColor: fill.border ? token(fill.border, fill.borderAlpha) : 'transparent'}}>
            {icon ? <Icon name={icon} size={iconSize} color={foreground} /> : null}
            <Text variant={c.label} style={{color: foreground}} lines={1}>{label}</Text>
            {removable ? <Icon name="close" size={Math.round(iconSize * 0.875)} color={foreground} /> : null}
          </View>
        );
      }}
    </Focusable>
  );
}

/** A row of chips and chip-height buttons, 8 apart (12 on TV). Filter bars never use a primary. */
export function ChipBar({children, style, label}: {children: React.ReactNode; style?: StyleProp<ViewStyle>; label?: string}) {
  const platform = useSpecPlatform();
  return (
    <View accessibilityLabel={label ?? uiI18n().t('filter.title')} style={[{flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', gap: spec.chip.barGap[platform]}, style]}>
      {children}
    </View>
  );
}
