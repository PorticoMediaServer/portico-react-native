import React, {useEffect, useState} from 'react';
import {Linking, Platform, View} from 'react-native';
import {routePath, type RouteResponse} from '../../../../../packages/contracts/src/routes';
import {SettingsRow} from '../../kit/shell';
import {StateView} from '../../kit/states';
import type {NativeSettingsPanelDeps} from './settings-panels';
import type {NativeShellRuntime} from '../../shell/runtime';
import {DeviceReportRow} from './DeviceReportRow';

/** Installation facts already supplied by bootstrap; no guessed version or device name. */
export function DeviceAboutPanel({context, lifetime, t, runtime, openRoute}: NativeSettingsPanelDeps & {runtime: NativeShellRuntime}) {
  const [serverVersion, setServerVersion] = useState<string>(), [versionError, setVersionError] = useState<unknown>(), [retry, setRetry] = useState(0);
  useEffect(() => {
    const caller = new AbortController();
    setServerVersion(undefined); setVersionError(undefined);
    void lifetime.request(signal => context.api.request<RouteResponse<'get_system'>>(routePath('get_system'), 'GET', undefined, signal), caller.signal).then(system => {
      if (caller.signal.aborted || !lifetime.current()) return;
      if (system.id !== lifetime.authority.serverId || typeof system.version !== 'string' || !system.version.trim()) throw new Error('native_settings_server_version_invalid');
      setServerVersion(system.version);
    }).catch(error => {if (!caller.signal.aborted && lifetime.current()) setVersionError(error);});
    return () => caller.abort();
  }, [context, lifetime, retry]);
  const helpAddress = 'getportico.tv/help';
  const help = () => {
    lifetime.assert();
    void Linking.openURL(`https://${helpAddress}`).catch(error => {if (lifetime.current()) runtime.reportError(error);});
  };
  return <View testID="settings-panel-about">
    <SettingsRow first label={t('about.appVersion')} value={context.appVersion}/>
    <SettingsRow label={t('about.server')} value={context.serverName}/>
    {serverVersion !== undefined && <SettingsRow testID="settings-server-version" label={t('about.serverVersion')} value={serverVersion}/>}
    {versionError !== undefined && <StateView {...runtime.error(versionError, () => setRetry(value => value + 1))}/>}
    <SettingsRow testID="settings-open-licenses" label={t('licenses.title')} value={t('next.settingsSpec.account.device.groups.5.rows.3.control.label')} onPress={() => {lifetime.assert(); openRoute({kind: 'licenses'});}}/>
    {!Platform.isTV && <SettingsRow testID="settings-device-help" label={t('next.settingsSpec.account.device.groups.5.rows.4.label')} value={helpAddress} onPress={help}/>}
    <DeviceReportRow context={context} lifetime={lifetime} t={t} runtime={runtime} openRoute={openRoute}/>
  </View>;
}
