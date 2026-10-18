import React, {forwardRef, useCallback, useEffect, useImperativeHandle, useRef, useState} from 'react';
import {Keyboard, TVFocusGuideView, TextInput, View, type StyleProp, type TextInputProps, type ViewStyle} from 'react-native';
import {Button} from './Button';
import {Focusable, type FocusableHandle} from './Focusable';
import {Text} from './Text';
import {Icon} from './Icon';
import {inputFocusOnDemand, spec, useSpecPlatform, useTheme} from './theme';
import {uiI18n} from './i18n';

/** Television: how long a field waits for its input to say it took focus before asking again. */
const REASK_MS = 500;

export type FieldProps = Omit<TextInputProps, 'style'> & {
  label?: string;
  hint?: string;
  error?: string;
  secure?: boolean;
  /** A control that belongs to the value, rendered inside the field row (a lock, a reveal). */
  trailing?: React.ReactNode;
  style?: StyleProp<ViewStyle>;
  /**
   * TV-AUTH-03: the field that follows. Return says "Next" and moves straight into it, so on
   * television username → password is one keyboard session instead of a trip back to the form.
   */
  next?: React.RefObject<FieldHandle | null>;
};

/** Opens the field for typing (on television, straight into the system keyboard). */
export type FieldHandle = {focus(): void};

/** Text input with label, hint, error and a reveal toggle for secrets.
 *
 * On television a text field is a button: the remote focuses it like any other control, and
 * pressing it brings up the system keyboard. The real input sits outside the focus engine, so
 * there is exactly one thing to land on and it always shows a focus ring. */
export const Field = forwardRef<FieldHandle, FieldProps>(function Field({label, hint, error, secure, trailing, style, editable = true, next, ...rest}, ref) {
  const {colors, space, metrics, type, isTV} = useTheme();
  const platform = useSpecPlatform();
  const f = spec.field;
  const [focused, setFocused] = useState(false);
  const [revealed, setRevealed] = useState(false);
  const input = useRef<TextInput>(null);
  // Television, where the input's container refuses focus until asked (`inputFocusOnDemand`):
  // `editing` lets focus in, the input takes it, and when the keyboard is done focus goes back
  // to the field's button, unless another field took the keyboard (Next).
  const [editing, setEditing] = useState(false);
  const button = useRef<FocusableHandle>(null);
  const onDemand = isTV && inputFocusOnDemand;
  // Whether the input really holds focus: its own events say so. React Native records a focus
  // request as granted before the native view answers, so a refused one has to be cleared
  // before it can be asked again.
  const taken = useRef(false);
  const ask = useCallback(() => {
    const field = input.current;
    if (!field) return;
    if (field.isFocused() && !taken.current) field.blur();
    field.focus();
  }, []);
  const open = useCallback(() => {
    if (!onDemand) { input.current?.focus(); return; }
    setEditing(true);
    // The container's change has to reach the native view before the input can take focus:
    // ask on the next frame, and once more if that was too early. The input's own focus event can
    // arrive well after it took focus on a busy television, so the second ask waits, and never
    // clears a request the keyboard already answered: that blur would hand focus away and leave
    // the keyboard typing into nothing.
    requestAnimationFrame(ask);
    setTimeout(() => { if (!taken.current && !Keyboard.isVisible()) ask(); }, REASK_MS);
  }, [onDemand, ask]);
  const close = useCallback(() => {
    if (!onDemand) return;
    setEditing(false);
    // Back hides the keyboard and the input gives focus up, but Android hands focus straight back to
    // that same (hidden) input: the field would be left half open, and the next Select would open the
    // keyboard on an input that then loses focus, typing into nothing. So focus returns to the
    // field's button unless another field has taken the keyboard (Next).
    requestAnimationFrame(() => { if (!TextInput.State.currentlyFocusedInput() || input.current?.isFocused()) button.current?.focus(); });
  }, [onDemand]);
  useEffect(() => {
    if (!editing) return;
    // The keyboard was dismissed without Return (Back): the input gives focus up.
    const hidden = Keyboard.addListener('keyboardDidHide', () => input.current?.blur());
    return () => hidden.remove();
  }, [editing]);
  useImperativeHandle(ref, () => ({focus: open}), [open]);
  // PC-VISUAL §11.3: a placeholder gives an example, never the field's identity again.
  const duplicate = !!label && !!rest.placeholder && rest.placeholder.trim().toLowerCase() === label.trim().toLowerCase();
  const placeholder = duplicate ? undefined : rest.placeholder;
  const chain: Partial<TextInputProps> = next ? {
    returnKeyType: rest.returnKeyType ?? 'next',
    submitBehavior: 'submit',
    onSubmitEditing: e => { rest.onSubmitEditing?.(e); next.current?.focus(); },
  } : {};
  // fieldSpec (X-11): raised fill, a ≥ 3:1 control border at rest, accent while editing, danger when invalid; no glow.
  const box = {
    minHeight: f.height[platform],
    borderRadius: f.radius[platform],
    backgroundColor: focused ? colors[f.fill.focus] : colors[f.fill.rest],
    borderWidth: f.borderWidth[platform],
    borderColor: error ? colors[f.border.invalid] : focused ? colors[f.border.focus] : colors[f.border.rest],
    opacity: editable ? 1 : spec.button.disabledOpacity,
  };
  const value = typeof rest.value === 'string' ? rest.value : '';
  return (
    <View style={[{gap: f.label.gap[platform]}, style]}>
      {/* The input itself carries the label as its accessible name, so VoiceOver reads it once, on the field. */}
      {label ? <Text variant={f.label.role} tone="secondary" accessibilityElementsHidden importantForAccessibility="no-hide-descendants">{label}</Text> : null}
      {isTV ? (
        <View style={{flexDirection: 'row', alignItems: 'center', gap: space.xs}}>
          <Focusable accessibilityRole="button" accessibilityLabel={label ?? rest.placeholder ?? uiI18n().t('field.text')} radius={metrics.radius.control} scale={1.01} disabled={!editable} hasTVPreferredFocus={rest.autoFocus} onPress={open} style={{flex: 1}} ref={button}>
            {() => (
              <View style={[box, {justifyContent: 'center', paddingHorizontal: f.paddingX[platform], paddingVertical: space.sm}]}>
                <Text variant="body" lines={1} style={{color: value ? colors.text : colors.placeholder}}>{value ? (secure ? '•'.repeat(Math.min(value.length, 24)) : value) : placeholder ?? ''}</Text>
              </View>
            )}
          </Focusable>
          {trailing}
          <TVFocusGuideView focusable={onDemand && editing} style={{position: 'absolute', width: 1, height: 1, opacity: 0}}>
            <TextInput ref={input} {...rest} {...chain} onFocus={e => { taken.current = true; rest.onFocus?.(e); }} onBlur={e => { taken.current = false; close(); rest.onBlur?.(e); }} placeholder={label ?? placeholder} autoFocus={false} editable={editable} secureTextEntry={secure} autoCapitalize={rest.autoCapitalize ?? 'none'} autoCorrect={rest.autoCorrect ?? false} style={{width: 1, height: 1}} />
          </TVFocusGuideView>
        </View>
      ) : (
        <View style={{flexDirection: 'row', alignItems: 'center', gap: space.xs}}>
          <View style={{flex: 1, justifyContent: 'center'}}>
            <TextInput
              ref={input}
              {...rest}
              {...chain}
              placeholder={placeholder}
              accessibilityLabel={rest.accessibilityLabel ?? label ?? rest.placeholder}
              accessibilityHint={rest.accessibilityHint ?? hint}
              editable={editable}
              secureTextEntry={secure && !revealed}
              autoCapitalize={rest.autoCapitalize ?? 'none'}
              autoCorrect={rest.autoCorrect ?? false}
              placeholderTextColor={colors.placeholder}
              onFocus={e => { setFocused(true); rest.onFocus?.(e); }}
              onBlur={e => { setFocused(false); rest.onBlur?.(e); }}
              // The reveal control sits inside the field, so a password field is exactly as wide as the one above it.
              style={[type[f.text], box, {color: colors.text, paddingHorizontal: f.paddingX[platform], paddingVertical: space.xs, paddingRight: secure ? metrics.control + space.xs : f.paddingX[platform]}]}
            />
            {secure ? <View style={{position: 'absolute', right: 2}}><Button variant="ghost" round size="sm" icon={revealed ? 'eyeOff' : 'eye'} accessibilityLabel={uiI18n().t(revealed ? 'field.hidePassword' : 'field.showPassword')} onPress={() => setRevealed(v => !v)} /></View> : null}
          </View>
          {trailing}
        </View>
      )}
      {error ? (
        <View style={{flexDirection: 'row', gap: space.xs, alignItems: 'flex-start'}} accessibilityRole="alert">
          <Icon name="error" size={metrics.iconSmall} color={colors.danger} />
          <Text variant={f.error.role} tone="danger" style={{flex: 1}}>{error}</Text>
        </View>
      ) : hint ? (
        <Text variant={f.help.role} tone="tertiary">{hint}</Text>
      ) : null}
    </View>
  );
});
