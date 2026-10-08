import React, {forwardRef} from 'react';
import {View, type StyleProp, type ViewStyle} from 'react-native';
import {Ring} from './Feedback';
import {Focusable, type FocusableHandle, type FocusableProps} from './Focusable';
import {Icon, type IconName} from './Icon';
import {Text} from './Text';
import {alpha, hitSlopFor, spec, useInitialFocus, useSpecPlatform, useTheme} from './theme';

export type ButtonVariant = 'primary' | 'destructive' | 'secondary' | 'ghost' | 'outline' | 'danger' | 'link';
export type ButtonSize = 'sm' | 'md' | 'lg';

export type ButtonProps = Omit<FocusableProps, 'children' | 'style'> & {
  label?: string;
  icon?: IconName;
  /** APL-PLAYER-01: a number drawn inside the icon (skip seconds), with the icon's own digits removed. */
  iconNumber?: number;
  trailingIcon?: IconName;
  variant?: ButtonVariant;
  size?: ButtonSize;
  /** Player transport (TV-PLAYER-02): round and icon-only at the transport sizes; `primary` is Play/Pause. Overrides `size` and `round`. */
  transport?: 'control' | 'primary';
  /** Persistent selected state (segmented choices, toggles). */
  selected?: boolean;
  loading?: boolean;
  /** Circular icon-only control: transport controls and avatars only (buttonSpec). */
  round?: boolean;
  fullWidth?: boolean;
  style?: StyleProp<ViewStyle>;
};

/** Legacy variants keep working: `outline` is a secondary, `danger` the tinted destructive. */
const specVariant = (v: ButtonVariant): keyof typeof spec.button.variants => (v === 'outline' ? 'secondary' : v === 'danger' ? 'destructive' : v);

/**
 * Buttons per `buttonSpec` (packages/design/COMPONENTS.md § Buttons): three sizes, five variants,
 * rest / hover-or-focus / pressed / selected / disabled fills from the spec, one radius. A 32 pt
 * `sm` button reaches 44 pt on touch through its hit area (APL-SYS-01); on TV every size is at
 * least 64 px. Loading keeps the label and swaps the leading icon for a spinner (CON-14).
 */
export const Button = forwardRef<FocusableHandle, ButtonProps>(function Button({label, icon, iconNumber, trailingIcon, variant = 'secondary', size = 'md', selected = false, loading = false, round = false, transport, fullWidth = false, disabled, style, accessibilityLabel, hitSlop, ...rest}, ref) {
  const {colors, isTV} = useTheme();
  const platform = useSpecPlatform();
  const b = spec.button;
  const t = transport ? spec.transport[transport] : undefined;
  const height = t ? t.size[platform] : b.height[size][platform];
  const radius = round || t ? height / 2 : b.radius[platform];
  const iconOnly = !label || !!t;
  const iconSize = t ? t.icon[platform] : b.icon[size][platform];
  const padX = iconOnly ? 0 : b.paddingX[size][platform];
  const fills = b.variants[specVariant(variant)];
  const color = (token: string, a?: number) => (token === 'transparent' ? 'transparent' : a === undefined ? colors[token as keyof typeof colors] : alpha(colors[token as keyof typeof colors], a));
  return (
    <Focusable
      ref={ref}
      radius={radius}
      disabled={disabled}
      busy={loading}
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel ?? label}
      accessibilityState={{selected, disabled: !!disabled, busy: loading}}
      scale={isTV ? spec.focus.scale.button.tv : 1}
      hitSlop={hitSlop ?? hitSlopFor(height, b.minHit[platform])}
      style={[fullWidth ? {alignSelf: 'stretch'} : {alignSelf: 'flex-start'}, style]}
      {...rest}>
      {({focused, hovered, pressed}) => {
        const state = selected ? 'selected' : pressed ? 'pressed' : focused || hovered ? 'hover' : 'rest';
        const fill = fills[state];
        const foreground = color(fill.foreground);
        return (
          <View
            style={{
              height,
              minWidth: iconOnly ? height : undefined,
              paddingHorizontal: padX,
              borderRadius: radius,
              backgroundColor: color(fill.background, fill.backgroundAlpha),
              borderWidth: 1,
              borderColor: fill.border ? color(fill.border, fill.borderAlpha) : 'transparent',
              flexDirection: 'row',
              alignItems: 'center',
              justifyContent: 'center',
              gap: b.gap[platform],
            }}>
            {loading ? <Ring size={iconSize} thickness={spec.feedback.spinner.stroke[platform]} color={foreground} /> : icon && iconNumber !== undefined ? (
              <View style={{width: iconSize, height: iconSize, alignItems: 'center', justifyContent: 'center'}}>
                <Icon name={icon} size={iconSize} color={foreground} bare />
                <Text variant="captionStrong" style={{position: 'absolute', color: foreground, fontSize: Math.round(iconSize * 0.34), lineHeight: Math.round(iconSize * 0.4), letterSpacing: 0, top: iconSize * 0.3}} allowFontScaling={false}>
                  {iconNumber}
                </Text>
              </View>
            ) : icon ? <Icon name={icon} size={iconSize} color={foreground} /> : null}
            {label && !t ? (
              <Text variant={b.label[size]} style={{color: foreground, textDecorationLine: variant === 'link' && pressed ? 'underline' : 'none'}} lines={1}>
                {label}
              </Text>
            ) : null}
            {trailingIcon ? <Icon name={trailingIcon} size={iconSize} color={foreground} /> : null}
          </View>
        );
      }}
    </Focusable>
  );
});

/** The button a screen opens on. It claims focus once, when it first appears, and never again:
 * a permanent claim pulls focus back to itself whenever a sheet closes or the data refreshes. */
export function EntryButton(props: ButtonProps) {
  const claim = useInitialFocus();
  return <Button {...props} hasTVPreferredFocus={claim} />;
}
