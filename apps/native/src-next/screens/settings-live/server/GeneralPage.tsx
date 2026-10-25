import React, {useEffect, useState} from 'react';
import {ScrollView, Text, View} from 'react-native';
import {parseUpdateReport, type UpdateReport} from '../../../../../../packages/client-core/src/administration';
import {pauseBackgroundWork, type MaintenanceDocument, type MaintenanceSettings} from '../../../../../../packages/client-core/src/server-admin/server-forms';
import {restartServer} from '../../../../../../packages/client-core/src/backups';
import type {RuntimeSettings} from '../../../../../../packages/client-core/src/console';
import type {MessageId} from '../../../../../../packages/i18n/src';
import {defaultI18n} from '../../../../../../packages/i18n/src';
import {presentError} from '../../../../../../packages/client-core/src/presentation/errors';
import {when} from '../../../../../../packages/client-core/src/server-admin/console-words';
import {Button} from '../../../kit/controls/Button';
import {TextField} from '../../../kit/controls/TextField';
import {BottomSheet} from '../../../kit/overlays/BottomSheet';
import {ServerHeader} from '../../../kit/shell/ServerIdentity';
import {StateView} from '../../../kit/states';
import {shellType} from '../../../kit/shell/visual';
import {useTheme} from '../../../kit/theme';
import type {NativeSettingsLivePorts} from '../ports';
import type {NativeShellRuntime} from '../../../shell/runtime';
import {useFormState, useStorageForms} from './storage/forms';

type Translate = typeof defaultI18n.t;
type ViewerRole = 'owner' | 'administrator' | 'member';
const IDS = ['runtime', 'maintenance'] as const;

/** Settings › Server › General on the phone (slots server-general group 1–2 and the drawn background/restart rows). */
export function NativeServerGeneral({ports, runtime}: {ports: NativeSettingsLivePorts; runtime: NativeShellRuntime}) {
  const theme = useTheme(), t = runtime.text.t as Translate, context = ports.context, authority = context.authority();
  const api = {request: <T,>(path: string, method?: string, body?: unknown, signal?: AbortSignal) => context.api.request<T>(path, method, body, signal)};
  const {forms, set, state} = useStorageForms(ports, IDS);
  const runtimeState = useFormState<RuntimeSettings, unknown>(forms.runtime);
  const maintenanceState = useFormState<MaintenanceSettings, MaintenanceDocument>(forms.maintenance);
  const [updates, setUpdates] = useState<UpdateReport>(), [updateError, setUpdateError] = useState<unknown>(), [checking, setChecking] = useState(false);
  const [busy, setBusy] = useState(false), [problem, setProblem] = useState<string>(), [restarting, setRestarting] = useState(false);
  const viewerRole: ViewerRole = context.account.account.role === 'owner' ? 'owner' : context.account.canManage ? 'administrator' : 'member';
  const loadUpdates = () => {setChecking(true); void api.request<unknown>('/v1/admin/updates').then(raw => setUpdates(parseUpdateReport(raw)), setUpdateError).finally(() => setChecking(false));};
  useEffect(() => {loadUpdates();}, [context]);
  const now = Date.now(), pausedUntil = maintenanceState.status?.pausedUntilUnixMillis ?? 0, paused = pausedUntil > now;
  const pause = () => {
    setBusy(true); setProblem(undefined);
    void pauseBackgroundWork({api}, !paused, ports.requestId()).then(() => forms.maintenance.load(), error => setProblem(presentError(error, 'server-console').body)).finally(() => setBusy(false));
  };
  const restart = () => {
    setBusy(true); setProblem(undefined);
    void restartServer(api).then(() => setRestarting(false), error => {setBusy(false); setProblem(presentError(error, 'server-console').body);});
  };
  if (runtimeState.loadError !== undefined && !runtimeState.draft) return <StateView {...runtime.error(runtimeState.loadError, () => {void forms.runtime.load();})}/>;
  const draft = runtimeState.draft;
  return <View style={{flex: 1}}>
    <ScrollView contentContainerStyle={{paddingHorizontal: 20, paddingBottom: 40}}>
      <ServerHeader serverName={context.serverName} viewerRole={viewerRole} audience={viewerRole === 'administrator' ? 'administrators' : 'owner'} variant="phone" style={{marginBottom: 12}}/>
      <Text accessibilityRole="header" style={[shellType(28, 800, 33, -.03), {color: theme.colors.text}]}>{t('settings.server.general')}</Text>
      {draft ? <View style={{marginTop: 16}}>
        <Text style={[shellType(17, 800), {color: theme.colors.text}]}>{t('web.general.serverName')}</Text>
        <Text style={[shellType(12.5, 400, 17), {color: theme.colors.textTertiary, marginTop: 2}]}>{t('web.general.serverNameHelp')}</Text>
        <TextField testID="server-general-name" value={draft.name} onChangeText={value => forms.runtime.set(current => ({...current, name: value}))} maxLength={100} containerStyle={{marginTop: 10}}/>
      </View> : null}
      <Text style={[shellType(17, 800), {color: theme.colors.text, marginTop: 22}]}>{t('settings.server.updates')}</Text>
      {updateError !== undefined && !updates ? <StateView title={presentError(updateError, 'server-console').title} body={presentError(updateError, 'server-console').body} tone="error" primaryAction={{id: 'retry', label: t('action.tryAgain'), onPress: loadUpdates}}/> : null}
      {updates ? <View style={{marginTop: 8, borderRadius: 14, overflow: 'hidden', backgroundColor: theme.colors.raised}}>
        <View style={{paddingHorizontal: 14, paddingVertical: 11}}>
          <View style={{flexDirection: 'row', justifyContent: 'space-between', gap: 10}}>
            <Text style={[shellType(15, 600), {color: theme.colors.text}]}>{t('web.general.serverProduct')}</Text>
            <Text style={[shellType(14, 600), {color: updates.updateAvailable ? theme.colors.amber : theme.colors.textSecondary}]}>{updates.updateAvailable && updates.latest ? updates.latest.version : updates.current.version}</Text>
          </View>
          <Text style={[shellType(12.5, 400, 17), {color: theme.colors.textTertiary, marginTop: 2}]}>{updates.message}{' · '}{when(Date.parse(updates.checkedAt))}</Text>
        </View>
      </View> : null}
      <View style={{flexDirection: 'row', marginTop: 10}}><Button size="compact" variant="glass" icon="i-refresh" loading={checking} onPress={loadUpdates}>{t('server.updates.check')}</Button></View>
      {maintenanceState.draft ? <>
        <Text style={[shellType(17, 800), {color: theme.colors.text, marginTop: 22}]}>{t('metadata.settings.backgroundSpeed' as MessageId)}</Text>
        <Text style={[shellType(12.5, 400, 17), {color: theme.colors.textTertiary, marginTop: 2}]}>{t('settings.server.backgroundSpeedHelp')}</Text>
        <View style={{flexDirection: 'row', gap: 8, marginTop: 10}}>
          {(['gentle', 'normal', 'fast'] as const).map(choice => <Button key={choice} size="compact" variant={maintenanceState.draft?.backgroundSpeed === choice ? 'primary' : 'glass'}
            onPress={() => forms.maintenance.set(current => ({...current, backgroundSpeed: choice}))}>{t(`metadata.settings.${choice}` as MessageId)}</Button>)}
        </View>
        <View style={{flexDirection: 'row', marginTop: 12}}>
          <Button size="compact" variant="glass" loading={busy} onPress={pause}>{t(paused ? 'settings.server.resumeBackground' : 'settings.server.pauseBackground')}</Button>
        </View>
      </> : null}
      <Text style={[shellType(17, 800), {color: theme.colors.text, marginTop: 22}]}>{t('web.maintenance.serverRestart')}</Text>
      <Text style={[shellType(12.5, 400, 17), {color: theme.colors.textTertiary, marginTop: 2}]}>{t('server.restart.body')}</Text>
      <View style={{flexDirection: 'row', marginTop: 10}}><Button size="compact" variant="glass" textStyle={{color: theme.colors.record}} disabled={busy} onPress={() => setRestarting(true)}>{t('web.maintenance.serverRestart')}</Button></View>
      {problem ? <Text accessibilityRole="alert" style={[shellType(13, 600), {color: theme.colors.record, marginTop: 10}]}>{problem}</Text> : null}
      {state.dirty ? <View style={{flexDirection: 'row', gap: 8, marginTop: 16}}>
        <Button variant="glass" disabled={state.saving} onPress={() => set.discard()}>{t('action.discard')}</Button>
        <Button loading={state.saving} disabled={Boolean(state.problem)} onPress={() => {void set.save();}}>{t('action.save')}</Button>
      </View> : null}
      {state.problem ? <Text accessibilityRole="alert" style={[shellType(13, 600), {color: theme.colors.record, marginTop: 8}]}>{t(state.problem as MessageId)}</Text> : null}
    </ScrollView>
    <BottomSheet open={restarting} onOpenChange={open => {if (!open && !busy) setRestarting(false);}} testID="server-general-restart"
      title={t('web.maintenance.serverRestart')} description={t('server.restart.body')}
      footer={<View style={{flexDirection: 'row', gap: 8}}><Button variant="glass" disabled={busy} onPress={() => setRestarting(false)}>{t('action.cancel')}</Button>
        <Button variant="glass" textStyle={{color: theme.colors.record}} loading={busy} onPress={restart}>{t('web.maintenance.serverRestart')}</Button></View>}><View/></BottomSheet>
  </View>;
}
