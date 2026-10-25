import React from 'react';
import {Text, View} from 'react-native';
import {defaultI18n} from '../../../../../packages/i18n/src';
import {Focusable} from '../../kit/controls';
import {FocusRegion} from '../../kit/focus';
import {Icon} from '../../kit/Icon';
import {alpha, browseType} from '../../kit/browse/presentation';
import {useTheme} from '../../kit/theme';
import type {NativeDestinationActivation} from '../destinations/focus';
import {useDestinationEntryFocus} from '../destinations/useEntryFocus';
import {applyNativeTVKeyboardKey, nativeTVKeyboardRows} from './keyboard';

export type NativeTVKeyboardProps = Readonly<{
  /** Authority- and route-bound caller identity; Search and a retained sheet are distinct. */
  id: string;
  value: string;
  onChangeText: (value: string) => void;
  activation: NativeDestinationActivation;
  leftRegionId: string;
  rightRegionId?: string;
  width?: number;
  /** Explicit caller character inventory; Search retains its authored default. */
  rows?: readonly (readonly string[])[];
  testID?: string;
  /** The row region holding focus, so a screen can point Left/Back at its remembered key. */
  onRowFocus?: (rowId: string) => void;
}>;

/** Shared actual native keyboard for Search, Settings search and typing sheets.
 * Native focus guides choose directional traversal. No remote-key listener or
 * synthetic first child is installed; entry waits for the real key-a host. */
export function NativeTVKeyboard({id, value, onChangeText, activation, leftRegionId, rightRegionId, width = 500, rows = nativeTVKeyboardRows, testID = 'native-tv-keyboard', onRowFocus}: NativeTVKeyboardProps) {
  const theme = useTheme(), keyWidth = (width - 50) / 6;
  const first = {regionId: `${id}.row.0`, childId: rows[0]?.[0] ?? 'a'};
  useDestinationEntryFocus(activation, first);
  const choose = (key: string) => onChangeText(applyNativeTVKeyboardKey(value, key, rows));
  const keyStyle = (span = 1) => ({width: keyWidth * span + 10 * (span - 1), height: 72, borderRadius: 14,
    backgroundColor: alpha(theme.colors.text, .05), justifyContent: 'center' as const, alignItems: 'center' as const});
  const edges = {left: leftRegionId, ...(rightRegionId ? {right: rightRegionId} : {})};
  const rowFocus = (row: string) => (owns: boolean) => {if (owns) onRowFocus?.(row);};
  return <FocusRegion id={id} enabled={activation.visible} testID={testID} style={{width, gap: 10}}>
    {rows.map((row, index) => <FocusRegion key={index} id={`${id}.row.${index}`} entry={row[0]} order={row} orientation="horizontal"
      enabled={activation.visible} screenStart={first} edges={edges} onFocusChange={rowFocus(`${id}.row.${index}`)} style={{flexDirection: 'row', gap: 10}}>
      {row.map(key => <Focusable key={key} focusId={key} testID={`${testID}-key-${key}`} disabled={!activation.visible} accessibilityLabel={key}
        onPress={() => choose(key)} focusRadius={14} style={keyStyle()}>
        <Text style={[browseType(theme, 28, 700), {color: /\d/.test(key) ? theme.colors.textTertiary : theme.colors.textSecondary}]}>{key}</Text>
      </Focusable>)}
    </FocusRegion>)}
    <FocusRegion id={`${id}.row.${rows.length}`} entry="space" order={['space', 'delete', 'clear']} orientation="horizontal" enabled={activation.visible}
      screenStart={first} edges={edges} onFocusChange={rowFocus(`${id}.row.${rows.length}`)} style={{flexDirection: 'row', gap: 10}}>
      <Focusable focusId="space" testID={`${testID}-key-space`} disabled={!activation.visible} accessibilityLabel={defaultI18n.t('next.states.key.Space')} onPress={() => choose('space')} focusRadius={14} style={keyStyle(3)}>
        <Text style={[browseType(theme, 22, 700), {color: theme.colors.textSecondary}]}>{defaultI18n.t('next.states.key.Space')}</Text>
      </Focusable>
      <Focusable focusId="delete" testID={`${testID}-key-delete`} disabled={!activation.visible} accessibilityLabel={defaultI18n.t('action.delete')} onPress={() => choose('delete')} focusRadius={14} style={keyStyle()}>
        <Icon name="i-backspace" size={32} color={theme.colors.textSecondary}/>
      </Focusable>
      <Focusable focusId="clear" testID={`${testID}-key-clear`} disabled={!activation.visible} accessibilityLabel={defaultI18n.t('filter.clear')} onPress={() => choose('clear')} focusRadius={14} style={keyStyle(2)}>
        <Text style={[browseType(theme, 22, 700), {color: theme.colors.textSecondary}]}>{defaultI18n.t('filter.clear')}</Text>
      </Focusable>
    </FocusRegion>
  </FocusRegion>;
}
