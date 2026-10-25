import React from 'react';
import {Linking, Platform, View} from 'react-native';
import {SettingsRow} from '../../kit/shell';
import type {NativeSettingsPanelDeps} from './settings-panels';
import type {NativeShellRuntime} from '../../shell/runtime';

/** Installation facts already supplied by bootstrap; no guessed version or device name. */
export function DeviceAboutPanel({context, lifetime, t, runtime, openRoute}: NativeSettingsPanelDeps & {runtime: NativeShellRuntime}) {
  const helpAddress = 'getportico.tv/help';
  const help = () => {
    lifetime.assert();
    void Linking.openURL(`https://${helpAddress}`).catch(error => {if (lifetime.current()) runtime.reportError(error);});
  };
  return <View testID="settings-panel-about">
    <SettingsRow first label={t('about.appVersion')} value={context.appVersion}/>
    <SettingsRow label={t('about.server')} value={context.serverName}/>
    <SettingsRow testID="settings-open-licenses" label={t('licenses.title')} onPress={() => {lifetime.assert(); openRoute({kind: 'licenses'});}}/>
    {!Platform.isTV && <SettingsRow testID="settings-device-help" label={t('next.settingsSpec.account.device.groups.5.rows.4.label')} value={helpAddress} onPress={help}/>}
  </View>;
}
