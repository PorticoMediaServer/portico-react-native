import React, {forwardRef} from 'react';
import {ActivityIndicator, StyleSheet, Text, View, type TextStyle, type StyleProp} from 'react-native';
import {buttonSpec} from '@portico/design';
import {BlurView, glassRecipe} from '../../platform/native-blur';
import {Icon, type IconName} from '../Icon';
import {useTheme} from '../theme';
import {Focusable, type FocusableProps} from './Focusable';
import {buttonGeometry, colorAlpha, minimumHitSlop, progressFraction, type ButtonSize, type ButtonVariant} from './control-model';

export type ButtonProps = Omit<FocusableProps, 'children'> & {
  variant?: ButtonVariant;
  size?: ButtonSize;
  children?: React.ReactNode;
  icon?: IconName;
  iconOnly?: boolean;
  /** Providing a loading state reserves its icon slot, keeping both label and width stable. */
  loading?: boolean;
  textStyle?: StyleProp<TextStyle>;
};

export type ResumeButtonProps = ButtonProps & {progress: number; remaining?: React.ReactNode};
type ButtonContentProps = ButtonProps & {progress?: number; remaining?: React.ReactNode};

const ButtonContent = forwardRef<View, ButtonContentProps>(function ButtonContent({
  variant = 'primary', size = 'hero', children, icon, iconOnly = variant === 'icon', loading,
  disabled, style, textStyle, accessibilityState, hitSlop, progress, remaining, ...props
}, ref) {
  const theme = useTheme();
  const geometry = buttonGeometry(size, theme.platform);
  const recipe = glassRecipe();
  const white = variant === 'primary';
  const glass = variant === 'glass' || variant === 'icon';
  const foreground = white ? theme.colors.ink : variant === 'text' ? theme.colors.accentStrong : theme.colors.text;
  const slop = minimumHitSlop(geometry.height, theme.isTV);
  const fraction = progress === undefined ? undefined : progressFraction(progress);
  const inline = theme.isTV && fraction !== undefined;
  const blocked = disabled || loading;

  return <Focusable {...props} ref={ref} disabled={blocked} focusRadius={iconOnly ? geometry.height / 2 : geometry.radius}
    accessibilityRole={props.accessibilityRole ?? 'button'} accessibilityState={{...accessibilityState, busy: loading}}
    hitSlop={hitSlop ?? {top: slop, bottom: slop, left: slop, right: slop}}
    style={state => [styles.button, {height: geometry.height, paddingHorizontal: iconOnly ? 0 : geometry.paddingX,
      width: iconOnly ? geometry.height : undefined, borderRadius: iconOnly ? geometry.height / 2 : geometry.radius,
      opacity: disabled ? buttonSpec.disabledOpacity : 1}, typeof style === 'function' ? style(state) : style]}>
    {state => <>
      <View pointerEvents="none" style={[StyleSheet.absoluteFill, {borderRadius: iconOnly ? geometry.height / 2 : geometry.radius, overflow: 'hidden'}]}>
        {glass && recipe.nativeBlur ? <BlurView style={StyleSheet.absoluteFill} blurType="dark" blurAmount={recipe.blurAmount} reducedTransparencyFallbackColor={theme.colors.raisedHigh} /> : null}
        <View style={[StyleSheet.absoluteFill, {backgroundColor: white ? state.hovered && !blocked ? theme.colors.white : theme.colors.text : glass ? colorAlpha(theme.colors.text, state.focused && theme.isTV ? buttonSpec.glass.focusedTvAlpha : state.hovered && !blocked ? buttonSpec.glass.hoverAlpha : buttonSpec.glass.alpha) : 'transparent'}]} />
      </View>
      <View pointerEvents="none" style={[styles.content, {gap: geometry.gap}]}>
        {icon || loading !== undefined ? <View style={{width: geometry.icon, height: geometry.icon, alignItems: 'center', justifyContent: 'center'}}>
          {loading ? <ActivityIndicator size={geometry.icon} color={foreground} /> : icon ? <Icon name={icon} size={geometry.icon} color={foreground} /> : null}
        </View> : null}
        {!iconOnly ? <Text numberOfLines={1} ellipsizeMode="tail" style={[theme.type.button, styles.label, {fontSize: geometry.fontSize * theme.textScale, color: foreground}, textStyle]}>{children}</Text> : null}
        {inline && !iconOnly ? <View style={[styles.inlineTrack, {backgroundColor: colorAlpha(white ? theme.colors.ink : theme.colors.text, .16)}]}><View style={[styles.fill, {width: `${fraction! * 100}%`, backgroundColor: white ? theme.colors.accent : theme.colors.accentStrong}]} /></View> : null}
        {remaining !== undefined && !iconOnly ? <>
          <Text numberOfLines={1} style={[theme.type.button, {fontSize: (theme.isTV ? 22 : geometry.fontSize) * theme.textScale, color: white ? colorAlpha(theme.colors.ink, .66) : theme.colors.textTertiary}, textStyle]}>{remaining}</Text>
        </> : null}
      </View>
      {fraction !== undefined && !inline ? <View pointerEvents="none" style={[styles.edgeTrack, {borderBottomLeftRadius: geometry.radius, borderBottomRightRadius: geometry.radius, backgroundColor: colorAlpha(white ? theme.colors.ink : theme.colors.text, .14)}]}><View style={[styles.fill, {width: `${fraction * 100}%`, backgroundColor: white ? theme.colors.accent : theme.colors.accentStrong}]} /></View> : null}
    </>}
  </Focusable>;
});

export const Button = forwardRef<View, ButtonProps>(function Button(props, ref) {return <ButtonContent {...props} ref={ref} />;});
export const ResumeButton = forwardRef<View, ResumeButtonProps>(function ResumeButton({icon = 'i-play', ...props}, ref) {return <ButtonContent {...props} icon={icon} ref={ref} />;});

const styles = StyleSheet.create({
  button: {alignItems: 'center', justifyContent: 'center', alignSelf: 'flex-start', flexShrink: 1},
  content: {flexDirection: 'row', alignItems: 'center', maxWidth: '100%'}, label: {flexShrink: 1},
  inlineTrack: {width: 96, height: 6, borderRadius: 6, overflow: 'hidden', marginLeft: 8},
  edgeTrack: {position: 'absolute', bottom: 0, left: 0, right: 0, height: 4, overflow: 'hidden'},
  fill: {height: '100%', borderRadius: 6},
});
