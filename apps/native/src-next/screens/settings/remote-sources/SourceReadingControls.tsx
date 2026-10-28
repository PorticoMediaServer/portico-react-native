import React, {useState} from 'react';
import {Text, View} from 'react-native';
import {sourceReadPreset, sourceReadPresetName, type SourceReadPreset, type SourceReadValues} from '../../../../../../packages/client-core/src/remote-sources';
import type {defaultI18n} from '../../../../../../packages/i18n/src';
import {Button} from '../../../kit/controls/Button';
import {Focusable} from '../../../kit/controls/Focusable';
import {TextField} from '../../../kit/controls/TextField';
import {BottomSheet} from '../../../kit/overlays/BottomSheet';
import {alpha} from '../../../kit/shell/visual';
import {useTheme} from '../../../kit/theme';
import {LibraryGroup, LibraryRow, SectionTitle} from '../../settings-live/owner-libraries/controls';
import {readingDiffers, sourceLimitValue, type SourceLimit} from './reading-presentation';

const presets: readonly SourceReadPreset[] = ['list', 'once', 'everything', 'ask'];
const fields: readonly SourceLimit[] = ['connections', 'requestsPerSecond', 'bytesPerSecond'];
const readLabel = 'next.settingsSpec.server.remote-sources.panels.source.tabs.1.groups.0.rows.0.control.options';

export function SourceReadingControls({values, baseline, disabled, onSelect, onLimit, onReset, t}: {
  values: SourceReadValues; baseline?: SourceReadValues; disabled: boolean; onSelect: (preset: SourceReadPreset) => void;
  onLimit: (field: SourceLimit, value: number) => void; onReset: () => void; t: typeof defaultI18n.t;
}) {
  const theme = useTheme(), selected = sourceReadPresetName(values);
  const [editing, setEditing] = useState<SourceLimit>(), [text, setText] = useState('');
  const label = (field: SourceLimit) => t(field === 'connections' ? 'next.remoteSources.connections' : field === 'requestsPerSecond' ? 'next.remoteSources.requestsPerSecond' : 'next.remoteSources.downloadSpeed');
  const valueText = (field: SourceLimit, value: number) => field === 'bytesPerSecond' ? value ? `${value / 1000000} ${t('next.remoteSources.megabytesPerSecond')}` : t('next.remoteSources.noLimit') : String(value);
  const number = editing ? sourceLimitValue(editing, text) : undefined;
  return <>
    {presets.map((preset, index) => {
      const definition = sourceReadPreset(preset), checked = selected === preset;
      const depth = t(definition.scanDepth === 'file_list_only' ? 'next.ownerLibraries.scanDepth.fileListOnly' : definition.scanDepth === 'complete' ? 'next.ownerLibraries.scanDepth.complete' : 'next.ownerLibraries.scanDepth.basic');
      return <Focusable key={preset} testID={`source-reading-${preset}`} accessibilityRole="radio" accessibilityLabel={t(`${readLabel}.${index}.label` as never)} accessibilityState={{checked, disabled}} disabled={disabled} onPress={() => onSelect(preset)} focusKind="card" focusRadius={14}
        style={{padding: 14, borderRadius: 14, borderWidth: 1.5, borderColor: checked ? theme.colors.accentStrong : theme.colors.lineSoft, backgroundColor: checked ? alpha(theme.colors.accent, .12) : theme.colors.raised, flexDirection: 'row', gap: 12}}>
        <View style={{width: 21, height: 21, borderRadius: 11, borderWidth: 2, borderColor: checked ? theme.colors.accentStrong : theme.colors.lineStrong, alignItems: 'center', justifyContent: 'center'}}>{checked && <View style={{width: 9, height: 9, borderRadius: 5, backgroundColor: theme.colors.text}}/>}</View>
        <View style={{flex: 1, gap: 6}}><Text style={[theme.type.bodyStrong, {color: theme.colors.text}]}>{t(`${readLabel}.${index}.label` as never)}</Text>
          {(preset === 'once' || preset === 'everything') && <Text style={[theme.type.caption, {color: theme.colors.textSecondary}]}>{t(`${readLabel}.${index}.hint` as never)}</Text>}
          <Text style={[theme.type.caption, {color: theme.colors.textSecondary}]}>{depth}</Text>
          <Text style={[theme.type.caption, {color: theme.colors.textSecondary}]}>{`${label('connections')}: ${definition.connections}`}</Text>
          <Text style={[theme.type.caption, {color: theme.colors.textSecondary}]}>{`${label('requestsPerSecond')}: ${definition.requestsPerSecond}`}</Text>
        </View>
      </Focusable>;
    })}
    {!selected && <Text style={[theme.type.caption, {color: theme.colors.accentStrong}]}>{t(`${readLabel}.4.label` as never)}</Text>}
    <SectionTitle action={baseline && readingDiffers(values, baseline) ? <Button variant="text" size="xs" disabled={disabled} onPress={onReset}>Reset all</Button> : undefined}>Connection limits</SectionTitle>
    <LibraryGroup>{fields.map((field, index) => {
      const changed = baseline !== undefined && values[field] !== baseline[field];
      return <View key={field} style={changed ? {borderWidth: 1, borderColor: theme.colors.accentStrong, borderRadius: 10} : undefined}>
        <LibraryRow first={index === 0} label={label(field)} value={valueText(field, values[field])} help={changed ? `Changed · ${valueText(field, baseline![field])}` : undefined}
          onPress={disabled ? undefined : () => {setEditing(field); setText(String(field === 'bytesPerSecond' ? values[field] / 1000000 : values[field]));}}/>
      </View>;
    })}</LibraryGroup>
    <BottomSheet open={!!editing} onOpenChange={open => {if (!open) setEditing(undefined);}} title={editing ? label(editing) : ''}
      footer={<Button disabled={disabled || number === undefined} onPress={() => {if (editing && number !== undefined) {onLimit(editing, number); setEditing(undefined);}}}>{t('next.remoteSources.save')}</Button>}>
      <View style={{gap: 12}}><TextField label={editing ? label(editing) : ''} value={text} onChangeText={setText} keyboardType="number-pad" editable={!disabled}
        description={editing === 'bytesPerSecond' ? t('next.remoteSources.megabytesPerSecond') : undefined}/>
        {editing && baseline && <><Text style={[theme.type.caption, {color: theme.colors.textSecondary}]}>{valueText(editing, baseline[editing])}</Text>
          <Button variant="text" disabled={disabled} onPress={() => setText(String(editing === 'bytesPerSecond' ? baseline[editing] / 1000000 : baseline[editing]))}>Reset</Button></>}
      </View>
    </BottomSheet>
  </>;
}
