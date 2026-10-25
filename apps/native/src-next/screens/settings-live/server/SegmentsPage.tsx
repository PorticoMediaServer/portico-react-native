import React from 'react';
import {ScrollView, View} from 'react-native';
import type {RuntimeSettings} from '../../../../../../packages/client-core/src/console';
import {defaultI18n, type MessageId} from '../../../../../../packages/i18n/src';
import {Button} from '../../../kit/controls/Button';
import {Select} from '../../../kit/controls/Select';
import {StateView} from '../../../kit/states';
import type {NativeShellRuntime} from '../../../shell/runtime';
import type {NativeSettingsLivePorts} from '../ports';
import {useFormState, useStorageForms} from './storage/forms';

const IDS = ['runtime'] as const;

/** Server settings rows use revisioned forms, never the account preference renderer. */
export function NativeServerSegments({ports, runtime}: {ports: NativeSettingsLivePorts; runtime: NativeShellRuntime}) {
  const t = runtime.text.t as typeof defaultI18n.t;
  const {forms, set, state} = useStorageForms(ports, IDS);
  const settings = useFormState<RuntimeSettings, unknown>(forms.runtime);
  if (settings.loadError !== undefined && !settings.draft) return <StateView {...runtime.error(settings.loadError, () => {void forms.runtime.load();})}/>;
  return <View style={{flex: 1}}>
    <ScrollView contentContainerStyle={{paddingHorizontal: 20, paddingBottom: 16}}>
      {settings.draft && <Select testID="server-segments-mode" label={t('settings.server.segmentMode')} description={t('settings.server.segmentModeHelp')}
        value={settings.draft['library.segmentDetection']} disabled={state.saving}
        options={(['standard', 'thorough', 'off'] as const).map(value => ({value, label: t(`settings.server.segmentMode.${value}` as MessageId)}))}
        onValueChange={value => {if (value === 'standard' || value === 'thorough' || value === 'off') forms.runtime.set(current => ({...current, 'library.segmentDetection': value}));}}/>}
      {state.dirty && <View style={{flexDirection: 'row', gap: 8, marginTop: 12}}>
        <Button variant="glass" disabled={state.saving} onPress={() => set.discard()}>{t('action.discard')}</Button>
        <Button loading={state.saving} disabled={Boolean(state.problem)} onPress={() => {void set.save();}}>{t('action.save')}</Button>
      </View>}
      {state.problem && <StateView title={t(state.problem as MessageId)} tone="error"/>}
      {settings.saveError !== undefined && <StateView {...runtime.error(settings.saveError, () => {void set.save();})}/>}
    </ScrollView>
    <View style={{flex: 1}}>{ports.renderSettingsPanel('server.segments', runtime)}</View>
  </View>;
}
