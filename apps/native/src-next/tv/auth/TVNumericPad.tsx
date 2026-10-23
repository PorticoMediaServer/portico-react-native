import React from 'react';
import {Text, View} from 'react-native';
import {defaultI18n} from '../../../../../packages/i18n/src';
import {Button, Focusable} from '../../kit/controls';
import {FocusRegion} from '../../kit/focus';
import {Icon} from '../../kit/Icon';
import {nativeType, useTheme} from '../../kit/theme';

const rows = [['1', '2', '3'], ['4', '5', '6'], ['7', '8', '9'], ['delete', '0']];

/** Auth17's one native-focus pad, shared by profile PIN and ruling28 MFA. */
export function TVNumericPad({id, busy, onDigit, onDelete, help, onHelp, helpTextSize = 26}: {
  id: string; busy: boolean; onDigit: (value: string) => void; onDelete: () => void;
  help: React.ReactNode; onHelp: () => void; helpTextSize?: number;
}) {
  const theme = useTheme();
  return <View style={{position: 'absolute', right: 260, top: 0, bottom: 0, width: 484, justifyContent: 'center'}}>
    <FocusRegion id={`${id}.pad`} entry="1" enabled={!busy}>
      {rows.map((row, index) => <FocusRegion key={index} id={`${id}.pad.${index}`} entry={row[0]} order={row} orientation="horizontal" enabled={!busy}
        edges={{up: index > 0 ? `${id}.pad.${index - 1}` : undefined, down: index < 3 ? `${id}.pad.${index + 1}` : `${id}.help`}}
        style={{flexDirection: 'row', gap: 20, marginBottom: index < 3 ? 20 : 0}}>
        {row.map(value => <Focusable key={value} focusId={value} testID={`${id}-pad-${value}`} disabled={busy} focusRadius={20}
          accessibilityLabel={value === 'delete' ? defaultI18n.t('action.delete') : value}
          onPress={() => {if (!busy) {if (value === 'delete') onDelete(); else onDigit(value);}}}
          style={{width: 148, height: 118, alignItems: 'center', justifyContent: 'center', borderRadius: 20, backgroundColor: `${theme.colors.text}12`}}>
          {value === 'delete' ? <Icon name="i-backspace" size={46} color={theme.colors.textSecondary}/>
            : <Text style={[nativeType({size: 48, weight: 700, tracking: 0, lineHeight: 'normal'}, theme.textScale), {color: theme.colors.textSecondary}]}>{value}</Text>}
        </Focusable>)}
      </FocusRegion>)}
    </FocusRegion>
    <FocusRegion id={`${id}.help`} entry="help" enabled={!busy} edges={{up: `${id}.pad.3`}} style={{marginTop: 38}}>
      <Button focusId="help" variant="glass" disabled={busy} onPress={() => {if (!busy) onHelp();}}
        style={{height: 72, paddingHorizontal: 18, borderRadius: 14}} textStyle={{fontSize: helpTextSize * theme.textScale}}>{help}</Button>
    </FocusRegion>
  </View>;
}

export function TVCodeBoxes({code, length, masked = false, busy, error}: {code: string; length: 4 | 6; masked?: boolean; busy: boolean; error: boolean}) {
  const theme = useTheme();
  return <View accessibilityLabel={defaultI18n.t(masked ? 'pin.fourDigit' : 'auth.verificationCode')}
    accessibilityValue={{min: 0, max: length, now: code.length}} style={{flexDirection: 'row', gap: 18}}>
    {Array.from({length}, (_, index) => <View key={index} accessible={false} style={{width: 104, height: 116, borderRadius: 18,
      alignItems: 'center', justifyContent: 'center', backgroundColor: `${theme.colors.ink}9E`, borderWidth: 2,
      borderColor: error ? theme.colors.danger : index === code.length ? theme.colors.accentStrong : theme.colors.lineStrong}}>
      {code[index] ? masked ? <View style={{width: 24, height: 24, borderRadius: 12, backgroundColor: theme.colors.text}}/>
        : <Text style={[nativeType({size: 28, weight: 800, tracking: 0, lineHeight: 'normal'}, theme.textScale), {color: theme.colors.text}]}>{code[index]}</Text>
        : index === code.length && !busy ? <View style={{width: 3, height: 52, borderRadius: 1, backgroundColor: theme.colors.accentStrong}}/> : null}
    </View>)}
  </View>;
}
