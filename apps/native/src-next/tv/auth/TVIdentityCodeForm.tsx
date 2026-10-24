import React from 'react';
import {Text, View} from 'react-native';
import {defaultI18n} from '../../../../../packages/i18n/src';
import {Focusable} from '../../kit/controls/Focusable';
import {FocusRegion} from '../../kit/focus';
import {nativeType, useTheme} from '../../kit/theme';
import {useDestinationEntryFocus} from '../../screens/destinations/useEntryFocus';
import {TVAuthLayout} from './TVAuthLayout';

/** Frame 2a's alphabet, exactly as drawn: A–Z, the dash, then 0–9. A symbol outside
 * this set can never match the server's code, so no other key is offered. */
export const identityCodeCharacters = [...'ABCDEFGHIJKLMNOPQRSTUVWXYZ-1234567890'];
export const identityCodeRows = Array.from({length: Math.ceil(identityCodeCharacters.length / 9)}, (_, row) => identityCodeCharacters.slice(row * 9, row * 9 + 9));

/** Spaces and dashes are ignored; capitals are forced; only the first 12 symbols count. */
export function appendIdentityCode(code: string, key: string): string {
  if (key === 'clear') return '';
  if (key === 'delete') return code.slice(0, -1);
  if (key === 'space') return code;
  if (code.length >= 12) return code;
  return (code + key.toUpperCase()).slice(0, 12);
}

/** Dashes are redrawn after the fourth and eighth symbols, as the field shows them. */
export function formatIdentityCode(code: string): string {
  const raw = code.replace(/[^A-Z0-9]/g, '');
  return raw.match(/.{1,4}/g)?.join('-') ?? '';
}

export type TVIdentityCodeFormProps = Readonly<{
  server: string;
  code: string;
  wrong: boolean;
  busy: boolean;
  onChange: (code: string) => void;
  onSubmit: (code: string) => void;
}>;

/** Settings › server identity on television: frame 2a's one asking screen. */
export function TVIdentityCodeForm({server, code, wrong, busy, onChange, onSubmit}: TVIdentityCodeFormProps) {
  const theme = useTheme(), t = defaultI18n.t, id = 'tv.identity-code';
  useDestinationEntryFocus({visible: !busy, intent: 'enter', revision: 0}, {regionId: `${id}.keyboard.1`, childId: 'V'});
  const type = (size: number, weight: 400 | 600 | 700 | 800 = 400) => nativeType({size, weight, tracking: 0, lineHeight: 'normal'}, theme.textScale);
  const press = (key: string) => {
    if (busy) return;
    const next = appendIdentityCode(code, key);
    onChange(next);
    if (next.length === 12) onSubmit(next);
  };
  const key = (value: string, span = 1) => {
    const label = value === 'space' ? t('next.states.key.Space') : value === 'clear' ? t('filter.clear') : value;
    return <Focusable key={value} focusId={value} testID={`${id}-key-${value}`} disabled={busy} accessibilityLabel={label}
      onPress={() => press(value)} focusRadius={14}
      style={{width: (860 - 80) / 9 * span + 10 * (span - 1), height: 72, alignItems: 'center', justifyContent: 'center',
        borderRadius: 14, backgroundColor: `${theme.colors.text}0D`}}>
      <Text style={[type(span > 1 ? 22 : 28, 700), {color: /^\d$/.test(value) ? theme.colors.textTertiary : theme.colors.textSecondary}]}>{label}</Text>
    </Focusable>;
  };
  return <TVAuthLayout testID="tv-identity-code" portico={false} heading={t('connection.identity.checkTitle', {server})} body={t('connection.identity.checkBody')}>
    <Text style={[type(22, 700), {color: theme.colors.textTertiary, marginBottom: 8}]}>{t('connection.identity.codeLabel')}</Text>
    <View style={{width: 860, height: 84, borderRadius: 16, paddingHorizontal: 28, flexDirection: 'row', alignItems: 'center',
      backgroundColor: `${theme.colors.ink}9E`, borderWidth: 1.5, borderColor: wrong ? theme.colors.danger : theme.colors.accentStrong}}>
      <Text numberOfLines={1} style={[type(32, 600), {color: theme.colors.text, flexShrink: 1}]}>{formatIdentityCode(code)}</Text>
      {!busy && <View style={{width: 3, height: 40, borderRadius: 2, marginLeft: 3, backgroundColor: theme.colors.accentStrong}}/>}
    </View>
    {wrong ? <Text accessibilityRole="alert" style={[type(22, 600), {color: theme.colors.danger, marginTop: 10}]}>{t('connection.identity.codeWrong')}</Text> : null}
    <FocusRegion id={`${id}.keyboard`} enabled={!busy} style={{gap: 10, width: 860, marginTop: 24}}>
      {identityCodeRows.map((row, index) => {
        const last = index === identityCodeRows.length - 1, order = last ? [...row, 'space', 'clear'] : row;
        return <FocusRegion key={index} id={`${id}.keyboard.${index}`} entry={row[0]} order={order} orientation="horizontal" enabled={!busy}
          edges={{up: index > 0 ? `${id}.keyboard.${index - 1}` : undefined, down: last ? `${id}.footer` : `${id}.keyboard.${index + 1}`}}
          style={{flexDirection: 'row', gap: 10}}>{row.map(value => key(value))}{last && <>{key('space', 2)}{key('clear', 2)}</>}</FocusRegion>;
      })}
    </FocusRegion>
    <FocusRegion id={`${id}.footer`} entry="home" enabled={!busy} edges={{up: `${id}.keyboard.${identityCodeRows.length - 1}`}} style={{marginTop: 26}}>
      <Text style={[type(22, 400), {color: theme.colors.textTertiary}]}>{t('connection.identity.checkHome')}</Text>
    </FocusRegion>
  </TVAuthLayout>;
}

/** Kept for the tests: the exact next focus the frame names when the keyboard appears. */
export const identityCodeEntry = Object.freeze({region: 'tv.identity-code.keyboard.1', child: 'V'});
