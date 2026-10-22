import React, {forwardRef, useEffect} from 'react';
import {StyleSheet, Text, View} from 'react-native';
import Animated, {useAnimatedStyle, useSharedValue, withTiming} from 'react-native-reanimated';
import {toggleSpec} from '@portico/design';
import {useTheme} from '../theme';
import {useMotion} from '../useMotion';
import {Focusable, type FocusableProps} from './Focusable';
import {minimumHitSlop} from './control-model';
import {useControlValue} from './useControlValue';

export type SwitchProps = Omit<FocusableProps, 'children'> & {
  checked?: boolean;
  defaultChecked?: boolean;
  onCheckedChange?: (checked: boolean) => void;
  variant?: 'compact' | 'phone' | 'episode';
  children?: React.ReactNode;
  description?: React.ReactNode;
};

export const Switch = forwardRef<View, SwitchProps>(function Switch({
  checked, defaultChecked = false, onCheckedChange, variant = 'phone', children, description,
  disabled, style, onPress, accessibilityState, hitSlop, ...props
}, ref) {
  const theme = useTheme();
  const motion = useMotion();
  const [value, setValue] = useControlValue(checked, defaultChecked, onCheckedChange);
  const geometry = theme.isTV ? {width: 64, height: 36, thumb: 28, inset: 4, onLeft: 32}
    : variant === 'episode' ? {width: 40, height: 24, thumb: 18, inset: 3, onLeft: 19}
      : variant === 'compact' ? {width: 38, height: 22, thumb: 16, inset: 3, onLeft: 19}
        : {width: 48, height: 29, thumb: 23, inset: 3, onLeft: 22};
  const position = useSharedValue(value ? 1 : 0);
  useEffect(() => {position.value = withTiming(value ? 1 : 0, motion.timing('quick'));}, [value, motion, position]);
  const onLayer = useAnimatedStyle(() => ({opacity: position.value}));
  const offLayer = useAnimatedStyle(() => ({opacity: 1 - position.value}));
  const thumb = useAnimatedStyle(() => ({transform: [{translateX: position.value * (geometry.onLeft - geometry.inset)}]}));
  const slop = minimumHitSlop(geometry.height, theme.isTV);
  const labelled = children !== undefined;
  return <Focusable {...props} ref={ref} disabled={disabled} accessibilityRole="switch" accessibilityState={{...accessibilityState, checked: value}}
    focusKind={labelled ? 'row' : 'button'} focusRadius={labelled ? 10 : geometry.height / 2}
    hitSlop={hitSlop ?? {top: slop, bottom: slop, left: slop, right: slop}}
    onPress={event => {if (!disabled) {setValue(!value); onPress?.(event);}}}
    style={state => [styles.row, labelled ? styles.labelled : undefined, {opacity: disabled ? toggleSpec.disabledOpacity : 1}, typeof style === 'function' ? style(state) : style]}>
    {labelled ? <View style={styles.copy}><Text style={[theme.type.bodyStrong, {color: theme.colors.text}]}>{children}</Text>{description !== undefined ? <Text style={[theme.type.caption, {color: theme.colors.textTertiary}]}>{description}</Text> : null}</View> : null}
    <View pointerEvents="none" accessible={false} importantForAccessibility="no-hide-descendants" style={{width: geometry.width, height: geometry.height}}>
      <View style={[StyleSheet.absoluteFill, {borderRadius: geometry.height / 2, backgroundColor: theme.colors.raisedBright}]} />
      <Animated.View style={[StyleSheet.absoluteFill, {borderRadius: geometry.height / 2, backgroundColor: theme.colors.accent}, onLayer]} />
      {motion.transforms ? <Animated.View style={[styles.thumb, {width: geometry.thumb, height: geometry.thumb, borderRadius: geometry.thumb / 2, top: geometry.inset, left: geometry.inset, backgroundColor: value ? theme.colors.white : theme.colors.textTertiary}, thumb]} /> : <>
        <Animated.View style={[styles.thumb, {width: geometry.thumb, height: geometry.thumb, borderRadius: geometry.thumb / 2, top: geometry.inset, left: geometry.inset, backgroundColor: theme.colors.textTertiary}, offLayer]} />
        <Animated.View style={[styles.thumb, {width: geometry.thumb, height: geometry.thumb, borderRadius: geometry.thumb / 2, top: geometry.inset, left: geometry.onLeft, backgroundColor: theme.colors.white}, onLayer]} />
      </>}
    </View>
  </Focusable>;
});

const styles = StyleSheet.create({row: {flexDirection: 'row', alignItems: 'center', gap: 16, alignSelf: 'flex-start'}, labelled: {alignSelf: 'stretch', minHeight: 44, paddingVertical: 8}, copy: {flex: 1, gap: 4}, thumb: {position: 'absolute'}});
