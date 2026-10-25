import React, {useRef, useState} from 'react';
import {Text, View} from 'react-native';
import {Button} from '../../kit/controls';
import {Dialog} from '../../kit/overlays';
import {SettingsRow} from '../../kit/shell';
import {StateView} from '../../kit/states';
import type {NativeSettingsPanelDeps} from './settings-panels';
import type {NativeShellRuntime} from '../../shell/runtime';
import {sendNativeDeviceReport} from './device-client-report';
import {useTheme} from '../../kit/theme';
import {shellType} from '../../kit/shell/visual';

export function DeviceReportRow(props: NativeSettingsPanelDeps & {runtime: NativeShellRuntime}) {
  const {context, lifetime, t, runtime} = props;
  const theme = useTheme();
  const [sent, setSent] = useState(false);
  const [open, setOpen] = useState(false), [busy, setBusy] = useState(false), [error, setError] = useState<unknown>();
  const pending = useRef(false), cancel = useRef<View>(null);
  const send = () => {
    lifetime.assert();
    if (pending.current) return;
    pending.current = true; setBusy(true); setError(undefined); setSent(false);
    void sendNativeDeviceReport(props).then(() => {
      if (!lifetime.current()) return;
      setOpen(false); setSent(true);
    }, failure => {if (lifetime.current()) setError(failure);}).finally(() => {
      pending.current = false; if (lifetime.current()) setBusy(false);
    });
  };
  return <>
    <SettingsRow testID="settings-send-app-log" label={t('next.settingsSpec.account.device.groups.5.rows.5.label')}
      description={t('next.settingsSpec.account.device.groups.5.rows.5.help')} onPress={() => {lifetime.assert(); setError(undefined); setOpen(true);}}/>
    {sent && <Text testID="settings-send-app-log-receipt" accessibilityLiveRegion="polite" style={[shellType(14, 400), {color: theme.colors.textSecondary, padding: 14}]}>{t('about.report.sent', {server: context.serverName})}</Text>}
    <Dialog testID="settings-send-app-log-confirm" open={open} initialFocusRef={cancel} onOpenChange={next => {if (!pending.current) setOpen(next);}}
      title={t('about.report.confirmTitle', {server: context.serverName})} description={t('about.report.confirmBody')}
      footer={<View style={{flexDirection: 'row', gap: 16}}><Button ref={cancel} testID="settings-send-app-log-cancel" variant="glass" disabled={busy} onPress={() => setOpen(false)}>{t('action.cancel')}</Button>
        <Button testID="settings-send-app-log-submit" variant="glass" loading={busy} onPress={send}>{t('about.report.send')}</Button></View>}>
      {error !== undefined ? <StateView {...runtime.error(error, send)}/> : <View/>}
    </Dialog>
  </>;
}
