import React, {useEffect, useRef} from 'react';
import {Pressable, TextInput, View, useTVEventHandler, type StyleProp, type ViewStyle} from 'react-native';
import Animated, {useAnimatedStyle, useSharedValue, withSequence, withTiming} from 'react-native-reanimated';
import {uiI18n} from './i18n';
import {Button} from './Button';
import {Focusable} from './Focusable';
import {Icon} from './Icon';
import {Text} from './Text';
import {spec, useInitialFocus, useSpecPlatform, useTheme} from './theme';

export type PinEntryProps = {
  value: string;
  onChange: (value: string) => void;
  /** Called once the last digit is entered: no Continue button (APL-AUTH-09). */
  onComplete?: (pin: string) => void;
  length?: number;
  /** A wrong PIN: the boxes shake and clear, and this line says why. */
  error?: string;
  /** Increment to shake again for a repeated error with the same text. */
  errorKey?: number;
  onForgot?: () => void;
  forgotLabel?: string;
  label?: string;
  autoFocus?: boolean;
  disabled?: boolean;
  style?: StyleProp<ViewStyle>;
};

/**
 * PIN entry (APL-AUTH-09): four boxes showing dots, filled from a number pad and submitted on the
 * last digit. Touch: the system number pad through a hidden field (`oneTimeCode`, so a PIN from a
 * password manager fills it). Television: an on-screen 3 × 4 keypad of large keys; Play/Pause
 * deletes a digit. The system keyboard is never opened on TV.
 */
export function PinEntry({value, onChange, onComplete, length = 4, error, errorKey, onForgot, forgotLabel, label, autoFocus = true, disabled, style}: PinEntryProps) {
  const {colors, isTV, motion, metrics} = useTheme();
  const platform = useSpecPlatform();
  const input = useRef<TextInput>(null);
  const box = isTV ? 88 : 56;
  const gap = spec.button.gap[platform];
  const shake = useSharedValue(0);
  const shakeStyle = useAnimatedStyle(() => ({transform: [{translateX: shake.value}]}));
  const latest = useRef(value);
  latest.current = value;
  // A field that autofocuses inside a Modal that is still presenting never gets the keyboard; ask
  // once the sheet is up.
  useEffect(() => {
    if (isTV || !autoFocus || disabled) return;
    const timer = setTimeout(() => input.current?.focus(), 350);
    return () => clearTimeout(timer);
  }, [autoFocus, disabled, isTV]);
  useEffect(() => {
    if (!error) return;
    onChange('');
    if (!motion.reduce) shake.value = withSequence(withTiming(-10, {duration: 50}), withTiming(10, {duration: 50}), withTiming(-6, {duration: 50}), withTiming(6, {duration: 50}), withTiming(0, {duration: 50}));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [error, errorKey]);
  const set = (next: string) => {
    const digits = next.replace(/\D/g, '').slice(0, length);
    if (digits === latest.current) return;
    onChange(digits);
    if (digits.length === length) onComplete?.(digits);
  };
  useTVEventHandler(event => {
    if (!isTV || disabled || event?.eventType !== 'playPause') return;
    set(latest.current.slice(0, -1));
  });
  const progress = uiI18n().t('pin.progress', {count: value.length, length});
  const boxes = (
    <Animated.View style={[{flexDirection: 'row', gap, justifyContent: 'center'}, shakeStyle]} accessible accessibilityLabel={label ?? uiI18n().t('pin.entry')} accessibilityValue={{text: progress}}>
      {Array.from({length}, (_, i) => {
        const filled = i < value.length;
        const current = i === value.length && !disabled;
        return (
          <View key={i} style={{width: box, height: box, borderRadius: metrics.radius.control, backgroundColor: colors.raised, borderWidth: isTV ? 2 : 1, borderColor: error ? colors.danger : current ? colors.accent : colors.lineControl, alignItems: 'center', justifyContent: 'center'}}>
            {filled ? <View style={{width: box * 0.22, height: box * 0.22, borderRadius: box * 0.11, backgroundColor: colors.text}} /> : null}
          </View>
        );
      })}
    </Animated.View>
  );
  return (
    <View style={[{alignItems: 'center', gap: spec.feedback.stateView.gap[platform]}, style]}>
      {label ? <Text variant="captionStrong" tone="secondary">{label}</Text> : null}
      {isTV ? boxes : (
        <Pressable onPress={() => input.current?.focus()} accessibilityRole="none">
          {boxes}
          <TextInput
            ref={input}
            value={value}
            onChangeText={set}
            editable={!disabled}
            keyboardType="number-pad"
            textContentType="oneTimeCode"
            autoComplete="one-time-code"
            maxLength={length}
            secureTextEntry={false}
            caretHidden
            accessibilityElementsHidden
            importantForAccessibility="no"
            style={{position: 'absolute', opacity: 0, width: 1, height: 1}}
          />
        </Pressable>
      )}
      {error ? <Text variant="caption" tone="danger" accessibilityRole="alert" align="center">{error}</Text> : null}
      {isTV ? <Keypad onDigit={d => set(latest.current + d)} onDelete={() => set(latest.current.slice(0, -1))} disabled={disabled} autoFocus={autoFocus} /> : null}
      {onForgot ? <Button variant="link" size="sm" label={forgotLabel ?? uiI18n().t('pin.forgot')} onPress={onForgot} /> : null}
    </View>
  );
}

/** Television keypad: 1–9, delete, 0. Keys are 88 px, above the 64 px ten-foot minimum. */
function Keypad({onDigit, onDelete, disabled, autoFocus}: {onDigit: (digit: string) => void; onDelete: () => void; disabled?: boolean; autoFocus?: boolean}) {
  const {colors, metrics} = useTheme();
  const claim = useInitialFocus();
  const rows = [['1', '2', '3'], ['4', '5', '6'], ['7', '8', '9'], ['delete', '0', '']];
  const key = 88;
  return (
    <View style={{gap: 12}}>
      {rows.map((row, r) => (
        <View key={r} style={{flexDirection: 'row', gap: 12}}>
          {row.map((k, c) => k === '' ? <View key={c} style={{width: key, height: key}} /> : (
            <Focusable
              key={c}
              // While the PIN is checked the keys stay focusable (focus must not jump on TV) but ignore presses.
              busy={disabled}
              radius={metrics.radius.control}
              scale={spec.focus.scale.button.tv}
              hasTVPreferredFocus={autoFocus && claim && k === '1'}
              accessibilityRole="button"
              accessibilityLabel={k === 'delete' ? uiI18n().t('pin.deleteDigit') : k}
              onPress={() => (k === 'delete' ? onDelete() : onDigit(k))}>
              {({focused}) => (
                <View style={{width: key, height: key, borderRadius: metrics.radius.control, alignItems: 'center', justifyContent: 'center', backgroundColor: focused ? colors.raisedBright : colors.raisedHigh}}>
                  {k === 'delete' ? <Icon name="back" color={colors.text} /> : <Text variant="heading">{k}</Text>}
                </View>
              )}
            </Focusable>
          ))}
        </View>
      ))}
    </View>
  );
}
