import React, {useState} from 'react';
import {Text, View} from 'react-native';
import type {RuntimeSettings} from '../../../../../../../packages/client-core/src/console';
import type {LogSettings} from '../../../../../../../packages/client-core/src/server-administration';
import type {LogsDraft, MaintenanceDocument, MaintenanceSettings} from '../../../../../../../packages/client-core/src/server-admin/server-forms';
import {presentError} from '../../../../../../../packages/client-core/src/presentation/errors';
import type {MessageId} from '../../../../../../../packages/i18n/src';
import {defaultI18n} from '../../../../../../../packages/i18n/src';
import {Button} from '../../../../kit/controls/Button';
import {TextField} from '../../../../kit/controls/TextField';
import {BottomSheet} from '../../../../kit/overlays/BottomSheet';
import {StateView} from '../../../../kit/states';
import {alpha, shellType} from '../../../../kit/shell/visual';
import {useTheme} from '../../../../kit/theme';
import type {NativeSettingsLivePorts} from '../../ports';
import type {NativeShellRuntime} from '../../../../shell/runtime';
import {useFormState, useStorageForms} from './forms';

type Translate = typeof defaultI18n.t;
const IDS = ['runtime', 'maintenance', 'logs'] as const;

/** Settings › Server › Storage & backups › Limits and retention (owner-server.html frame 36a). */
export function LimitsTab({ports, runtime, t}: {ports: NativeSettingsLivePorts; runtime: NativeShellRuntime; t: Translate}) {
  const theme = useTheme();
  const {forms, set, state} = useStorageForms(ports, IDS);
  const runtimeState = useFormState<RuntimeSettings, unknown>(forms.runtime);
  const maintenanceState = useFormState<MaintenanceSettings, MaintenanceDocument>(forms.maintenance);
  const logsState = useFormState<LogsDraft, LogSettings>(forms.logs);
  const [editing, setEditing] = useState<Readonly<{label: string; value: string; help?: string; done: (value: string) => void}>>();
  const [value, setValue] = useState('');
  const open = (label: string, current: number, done: (next: number) => void, help?: string) => {
    setEditing({label, value: String(current), ...(help ? {help} : {}), done: text => done(Math.max(0, Number(text.replace(/[^0-9]/g, '')) || 0))});
    setValue(String(current));
  };
  const save = () => {void set.save();};
  const discard = () => set.discard();
  const problem = state.problem ? t(state.problem as MessageId) : state.saveError !== undefined ? presentError(state.saveError, 'server-console').body : undefined;
  const runtimeDraft = runtimeState.draft, maintenanceDraft = maintenanceState.draft, logsDraft = logsState.draft;
  const categories = maintenanceState.status?.storageCategories ?? [];
  const maxima = maintenanceState.status?.retentionMaxima ?? {};
  if (runtimeState.loadError !== undefined && !runtimeDraft) return <StateView {...runtime.error(runtimeState.loadError, () => {void forms.runtime.load();})}/>;
  return <View style={{marginTop: 14}} testID="server-storage-limits">
    <Text style={[shellType(17, 800), {color: theme.colors.text}]}>{t('server.limitsAndRetention')}</Text>
    {runtimeDraft ? <View style={{marginTop: 10}}>
      <Section title={t('server.limitsAndRetention')}/>
      <Group>
        <NumberRow label={t('settings.server.analysisStorage')} value={runtimeDraft.analysisStorageGiB} onPress={() => open(t('settings.server.analysisStorage'), runtimeDraft.analysisStorageGiB, next => forms.runtime.set(draft => ({...draft, analysisStorageGiB: Math.max(1, Math.min(16384, next))})))}/>
        <NumberRow label={t('settings.server.analysisStageStorage')} value={runtimeDraft.analysisStageStorageMiB} onPress={() => open(t('settings.server.analysisStageStorage'), runtimeDraft.analysisStageStorageMiB, next => forms.runtime.set(draft => ({...draft, analysisStageStorageMiB: Math.max(1, Math.min(4096, next))})))}/>
        <NumberRow label={t('settings.server.subtitleTracks')} value={runtimeDraft.subtitleTrackLimit} onPress={() => open(t('settings.server.subtitleTracks'), runtimeDraft.subtitleTrackLimit, next => forms.runtime.set(draft => ({...draft, subtitleTrackLimit: Math.max(32, Math.min(4096, next))})))}/>
        <NumberRow label={t('settings.server.subtitleFileSize')} value={runtimeDraft.subtitleFileLimitMiB} onPress={() => open(t('settings.server.subtitleFileSize'), runtimeDraft.subtitleFileLimitMiB, next => forms.runtime.set(draft => ({...draft, subtitleFileLimitMiB: Math.max(32, Math.min(512, next))})))}/>
      </Group>
      <Section title={t('settings.server.retention')}/>
      <Group>
        <NumberRow label={t('web.logs.includeServer')} value={runtimeDraft.diagnosticDays} suffix={t('settings.unit.days')} onPress={() => open(t('web.logs.includeServer'), runtimeDraft.diagnosticDays, next => forms.runtime.set(draft => ({...draft, diagnosticDays: Math.max(1, Math.min(30, next))})))}/>
        <NumberRow label={t('web.logs.retentionNotifications')} value={runtimeDraft.notificationDays} suffix={t('settings.unit.days')} onPress={() => open(t('web.logs.retentionNotifications'), runtimeDraft.notificationDays, next => forms.runtime.set(draft => ({...draft, notificationDays: Math.max(1, Math.min(180, next))})))}/>
        <NumberRow label={t('settings.server.playHistoryKeep')} value={runtimeDraft.playHistoryDays} suffix={t('settings.unit.days')} onPress={() => open(t('settings.server.playHistoryKeep'), runtimeDraft.playHistoryDays, next => forms.runtime.set(draft => ({...draft, playHistoryDays: Math.max(1, Math.min(36500, next))})))}/>
        <NumberRow label={t('web.logs.retentionTasks')} value={runtimeDraft.jobDays} suffix={t('settings.unit.days')} onPress={() => open(t('web.logs.retentionTasks'), runtimeDraft.jobDays, next => forms.runtime.set(draft => ({...draft, jobDays: Math.max(1, Math.min(30, next))})))}/>
        {maintenanceDraft ? <NumberRow label={t('web.maintenance.backupsToKeep')} value={maintenanceDraft.backupKeepCount} onPress={() => open(t('web.maintenance.backupsToKeep'), maintenanceDraft.backupKeepCount, next => forms.maintenance.set(draft => ({...draft, backupKeepCount: Math.max(1, Math.min(365, next))})))}/> : null}
      </Group>
      {maintenanceDraft && categories.length ? <>
        <Section title={t('server.filesKept')}/>
        <Group>
          {categories.map(category => {
            const current = maintenanceDraft.retention[category.retentionKey] ?? 0;
            return <NumberRow key={category.id} label={category.name} value={current} suffix={t('settings.unit.days')} onPress={() => open(category.name, current, next => forms.maintenance.set(draft => ({...draft, retention: {...draft.retention, [category.retentionKey]: Math.min(maxima[category.retentionKey] ?? 3650, next)}})))}/>;
          })}
        </Group>
      </> : null}
      {logsDraft ? <>
        <Section title={t('server.logsByKind')}/>
        <Group>
          {logsDraft.retention.map(entry => <NumberRow key={entry.category} label={t('settings.server.retention.logs', {category: t(`server.logCategory.${entry.category}` as MessageId)})} value={entry.days} suffix={t('settings.unit.days')}
            onPress={() => open(t('settings.server.retention.logs', {category: t(`server.logCategory.${entry.category}` as MessageId)}), entry.days, next => forms.logs.set(draft => ({...draft, retention: draft.retention.map((row: {category: string; days: number}) => row.category === entry.category ? {...row, days: Math.max(1, Math.min(90, next))} : row)})))}/>)}
        </Group>
      </> : null}
    </View> : null}
    {problem ? <Text accessibilityRole="alert" style={[shellType(13, 600), {color: theme.colors.record, marginTop: 10}]}>{problem}</Text> : null}
    {state.dirty ? <View style={{flexDirection: 'row', gap: 8, marginTop: 16}}>
      <Button variant="glass" disabled={state.saving} onPress={discard}>{t('action.discard')}</Button>
      <Button loading={state.saving} disabled={Boolean(state.problem)} onPress={save}>{t('action.save')}</Button>
    </View> : null}
    <BottomSheet open={Boolean(editing)} onOpenChange={next => {if (!next) setEditing(undefined);}} testID="server-storage-number" keyboardAvoiding
      title={editing?.label} description={editing?.help}
      footer={<View style={{flexDirection: 'row', gap: 8}}><Button variant="glass" onPress={() => setEditing(undefined)}>{t('action.cancel')}</Button>
        <Button onPress={() => {editing?.done(value); setEditing(undefined);}}>{t('action.save')}</Button></View>}>
      <TextField label={editing?.label ?? ''} value={value} onChangeText={setValue} keyboardType="number-pad" autoFocus/>
    </BottomSheet>
  </View>;
}

function Section({title}: {title: string}) {
  const theme = useTheme();
  return <Text style={[shellType(15, 800), {color: theme.colors.textSecondary, marginTop: 18, marginBottom: 8}]}>{title}</Text>;
}

function Group({children}: {children: React.ReactNode}) {
  const theme = useTheme();
  return <View style={{borderRadius: 14, overflow: 'hidden', backgroundColor: theme.colors.raised}}>{children}</View>;
}

function NumberRow({label, value, suffix, onPress}: {label: string; value: number; suffix?: string; onPress: () => void}) {
  const theme = useTheme();
  return <Button variant="text" size="compact" onPress={onPress} style={{minHeight: 0, paddingHorizontal: 14, paddingVertical: 12, alignItems: 'center'}}>
    <Text style={[shellType(15, 600), {color: theme.colors.text, flex: 1}]}>{label}</Text>
    <Text style={[shellType(14.5, 600), {color: theme.colors.textSecondary}]}>{suffix ? `${defaultI18n.number(value)} ${suffix}` : defaultI18n.number(value)}</Text>
    <View style={{width: 8}}/>
  </Button>;
}
