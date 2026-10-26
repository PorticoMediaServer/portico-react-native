import React, {forwardRef, useId, useState} from 'react';
import {Platform, StyleSheet, Text, TextInput, View, type TextInputProps, type StyleProp, type ViewStyle} from 'react-native';
import {fieldSpec} from '@portico/design';
import {Icon, type IconName} from '../Icon';
import {fontFamilies, useTheme} from '../theme';
import {colorAlpha} from './control-model';
import {useFocusTarget} from '../focus';
import {useOverlayPaintMode} from '../overlays/OverlayPaintContext';

export type TextFieldProps = TextInputProps & {
  focusId?: string;
  label?: React.ReactNode;
  description?: React.ReactNode;
  error?: React.ReactNode;
  leadingIcon?: IconName;
  iconSize?: number;
  variant?: 'field' | 'search';
  containerStyle?: StyleProp<ViewStyle>;
  fieldStyle?: StyleProp<ViewStyle>;
  /** Authored select.html phone field. Default and TV controls retain their recipe. */
  appearance?: 'default' | 'selection';
};

export const TextField = forwardRef<TextInput, TextFieldProps>(function TextField({
  label, description, error, leadingIcon, iconSize, variant = 'field', containerStyle, fieldStyle, appearance = 'default',
  editable = true, focusable, style, onFocus, onBlur, accessibilityLabel, accessibilityState,
  placeholderTextColor, cursorColor, selectionColor, nativeID, multiline, focusId, testID, ...props
}, ref) {
  const theme = useTheme(), paint = useOverlayPaintMode();
  const eligible = paint.interactive && editable && focusable !== false;
  const {waiting, ...binding} = useFocusTarget<TextInput>({focusId, testID, disabled: !eligible, ref});
  const [focused, setFocused] = useState(false);
  const id = useId();
  const search = variant === 'search';
  const selection = appearance === 'selection' && !theme.isTV && !search;
  const height = search ? fieldSpec.search.height[theme.platform] : fieldSpec.height[theme.platform];
  const suppliedField = StyleSheet.flatten(fieldStyle);
  const suppliedHeight = suppliedField?.height;
  const inputHeight = typeof suppliedHeight === 'number' ? suppliedHeight : height;
  const radius = typeof suppliedField?.borderRadius === 'number' ? suppliedField.borderRadius : search ? fieldSpec.search.radius[theme.platform] : fieldSpec.radius[theme.platform];
  const color = error ? theme.colors.danger : focused ? theme.colors.accent : theme.colors.lineControl;
  const selectionBorder = focused || error ? 2 : suppliedField?.borderWidth ?? 1;
  const labelID = `${id}-label`;
  return <View style={[styles.container, selection ? {gap: 7} : undefined, containerStyle]}>
    {label !== undefined ? <Text nativeID={labelID} style={[theme.type.captionStrong, {color: theme.colors.textSecondary}, selection ? {fontSize: 12.5 * theme.textScale, color: theme.colors.textTertiary} : undefined]}>{label}</Text> : null}
    <View style={[styles.field, {minHeight: inputHeight, height: multiline ? undefined : inputHeight, borderRadius: radius,
      paddingHorizontal: search ? fieldSpec.search.paddingX[theme.platform] : fieldSpec.paddingX[theme.platform],
      gap: search ? fieldSpec.search.gap[theme.platform] : 10,
      backgroundColor: search || focused ? theme.colors.raisedHigh : theme.colors.raised,
      borderWidth: search && !error ? 0 : fieldSpec.borderWidth[theme.platform], borderColor: color,
      opacity: editable ? 1 : .45}, fieldStyle, selection ? {backgroundColor: suppliedField?.backgroundColor ?? theme.colors.ink, borderWidth: selectionBorder,
        borderColor: error ? theme.colors.danger : focused ? theme.colors.focus : suppliedField?.borderColor ?? theme.colors.line} : undefined]}>
      {leadingIcon ? <Icon name={leadingIcon} size={iconSize ?? (theme.isTV ? 30 : 20)} color={theme.colors.textTertiary} /> : null}
      <TextInput {...binding} {...props} testID={binding.testID} ref={binding.ref} nativeID={nativeID ?? id} editable={editable && paint.interactive} focusable={eligible}
        onChangeText={paint.interactive ? props.onChangeText : undefined} onSubmitEditing={paint.interactive ? props.onSubmitEditing : undefined} onKeyPress={paint.interactive ? props.onKeyPress : undefined} onEndEditing={paint.interactive ? props.onEndEditing : undefined} multiline={multiline}
        accessibilityLabel={accessibilityLabel ?? (typeof label === 'string' ? label : undefined)}
        accessibilityLabelledBy={label === undefined ? props.accessibilityLabelledBy : labelID}
        accessibilityState={{...accessibilityState, disabled: !editable, busy: waiting || accessibilityState?.busy}}
        placeholderTextColor={placeholderTextColor ?? theme.colors.placeholder}
        cursorColor={cursorColor ?? (selection && Platform.OS === 'android' ? theme.colors.accentStrong : undefined)}
        selectionColor={selectionColor ?? (selection && Platform.OS === 'ios' ? theme.colors.accentStrong : undefined)}
        underlineColorAndroid="transparent"
        onFocus={event => {if (!paint.interactive) return; binding.onFocus(); setFocused(true); onFocus?.(event);}}
        onBlur={event => {if (!paint.interactive) return; binding.onBlur(); setFocused(false); onBlur?.(event);}}
        style={[theme.type.body, styles.input, {fontFamily: selection ? fontFamilies[600] : search ? fontFamilies[500] : fontFamilies[400],
          fontSize: search && !theme.isTV ? 15.5 * theme.textScale : theme.type.body.fontSize,
          color: theme.colors.text, minHeight: inputHeight - 2 * (selection ? selectionBorder : fieldSpec.borderWidth[theme.platform])}, style]} />
      {focused && !selection ? <View pointerEvents="none" style={[styles.ring, {borderColor: search ? colorAlpha(theme.colors.accent, fieldSpec.search.focusAlpha) : theme.colors.focus,
        borderWidth: theme.isTV ? 4 : 3, borderRadius: radius + 4}]} /> : null}
    </View>
    {error !== undefined ? <Text accessibilityRole="alert" accessibilityLiveRegion="polite" style={[theme.type.caption, {color: theme.colors.danger}]}>{error}</Text>
      : description !== undefined ? <Text style={[theme.type.caption, {color: theme.colors.textTertiary}]}>{description}</Text> : null}
  </View>;
});

const styles = StyleSheet.create({container: {gap: 8, alignSelf: 'stretch'}, field: {flexDirection: 'row', alignItems: 'center'}, input: {flex: 1, minWidth: 0, padding: 0}, ring: {position: 'absolute', inset: -4}});
