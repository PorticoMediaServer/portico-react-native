import React, {useState} from 'react';
import {View} from 'react-native';
import type {Schedule} from '../../../../../packages/client-core/src/console';
import {when} from '../../../../../packages/client-core/src/server-admin/console-words';
import {jobName} from '../../../../../packages/client-core/src/server-admin/console-catalogue';
import {TASK_LABELS, clockMinutes, clockText} from '../../../../../packages/client-core/src/server-admin/panel-logic';
import {scheduledJobs, type MaintenanceDocument, type MaintenanceSettings, type MaintenanceWindow} from '../../../../../packages/client-core/src/server-admin/server-forms';
import {useI18n} from '../../app/i18n';
import {useAction, useConsole, useRead} from '../../app/server-console';
import {Field, ListRow, Notice, RowGroup, Sheet, ToggleRow, useTheme} from '../../ui';
import {FormLoadNotice, PickRow, TypedRow, useServerForm} from '../settings/ServerForms';

function useTaskLabel() {
  const i18n = useI18n();
  return (task: string) => (TASK_LABELS[task] ? i18n.t(TASK_LABELS[task]!) : jobName(i18n.t, i18n.has, task));
}

/** Schedule › Maintenance windows: when the server does its heavier background work and what runs in each. Saved with the page. */
export function WindowsPanel() {
  const t = useI18n().t;
  const task = useTaskLabel();
  const {form, state} = useServerForm<MaintenanceSettings, MaintenanceDocument>('maintenance');
  const draft = state.draft, doc = state.status;
  const change = (index: number, next: Partial<MaintenanceWindow>) => form.set(d => ({...d, windows: d.windows.map((w, i) => (i === index ? {...w, ...next} : w))}));
  return (
    <>
      <FormLoadNotice id="maintenance" />
      {draft && doc ? draft.windows.map((w, i) => (
        <RowGroup key={w.id} title={i === 0 ? t('settings.server.windows') : undefined} footer={i === draft.windows.length - 1 ? t('settings.server.windowsLede') : undefined}>
          <TypedRow title={t('web.maintenance.windowName')} value={w.name} maxLength={80} onDone={name => change(i, {name})} />
          <ToggleRow title={t('web.dvr.on')} value={w.enabled} onChange={enabled => change(i, {enabled})} />
          <PickRow title={t('web.maintenance.days')} value={w.cadence} options={doc.cadences.map(c => ({id: c.id, label: c.name}))} onChange={id => { const c = doc.cadences.find(x => x.id === id); change(i, {cadence: id, days: c ? [...c.days] : w.days}); }} />
          <TypedRow title={t('web.maintenance.startsAt')} value={clockText(w.startMinute)} placeholder="02:00" onDone={text => change(i, {startMinute: clockMinutes(text)})} />
          <TypedRow numeric title={t('web.maintenance.hours')} value={String(Math.round(w.durationMinutes / 60))} onDone={text => change(i, {durationMinutes: Math.min(24, Math.max(1, Number(text) || 1)) * 60})} />
          {doc.tasks.map(id => <ToggleRow key={id} title={task(id)} value={w.tasks.includes(id)} onChange={v => change(i, {tasks: v ? [...w.tasks, id] : w.tasks.filter(x => x !== id)})} />)}
          {draft.windows.length > 1 ? <ListRow tone="destructive" title={t('web.maintenance.removeWindow')} onPress={() => form.set(d => ({...d, windows: d.windows.filter((_, n) => n !== i)}))} /> : null}
        </RowGroup>
      )) : null}
    </>
  );
}

/** Schedule › Scheduled jobs: every job the server runs on a schedule, the windows it runs in, when it last ran and when the next window opens. */
export function ScheduledJobsPanel() {
  const t = useI18n().t;
  const task = useTaskLabel();
  const client = useConsole();
  const {state} = useServerForm<MaintenanceSettings, MaintenanceDocument>('maintenance');
  const jobs = useRead(() => client.jobs(''), [client], {every: 60000});
  const schedules = useRead<Schedule[]>(() => client.schedules(), [client]);
  const doc = state.status, settings = state.draft;
  const last = (kind: string) => jobs.data?.items.find(j => j.kind === kind || j.kind === kind.replace(/-/g, '_'));
  const rows = doc && settings ? scheduledJobs(doc, settings, new Date()) : [];
  if (!rows.length && !schedules.data?.length) return null;
  return (
    <RowGroup title={t('settings.server.jobs')}>
      {rows.map(job => {
        const ran = last(job.task);
        return <ListRow key={job.task} title={task(job.task)} subtitleLines={3}
          subtitle={[job.windows.length ? t('settings.server.jobs.in', {windows: job.windows.join(', ')}) : t('settings.server.jobs.never'), ran ? t('settings.server.jobs.last', {when: when(ran.createdAt)}) : '', job.nextAt ? t('settings.server.jobs.next', {when: when(job.nextAt.getTime())}) : ''].filter(Boolean).join(' · ')} />;
      })}
      {schedules.data?.map(x => <ScheduleRow key={x.id} schedule={x} onSaved={schedules.reload} />)}
    </RowGroup>
  );
}

/** An extra schedule: edited in a sheet, since it is a separate record with its own revision. */
function ScheduleRow({schedule, onSaved}: {schedule: Schedule; onSaved: () => void}) {
  const client = useConsole();
  const {t, has} = useI18n();
  const {space} = useTheme();
  const action = useAction();
  const [draft, setDraft] = useState<Schedule>();
  const [start, setStart] = useState('');
  const [length, setLength] = useState('');
  const open = () => { action.clear(); setDraft(schedule); setStart(clockText(schedule.startMinute)); setLength(String(schedule.windowMinutes)); };
  const next = draft ? {...draft, startMinute: clockMinutes(start), windowMinutes: Math.min(1440, Math.max(15, Number(length) || 15))} : undefined;
  return (
    <>
      <ListRow title={jobName(t, has, schedule.kind)} subtitle={[schedule.resource, schedule.enabled ? t('server.schedule.daily', {time: clockText(schedule.startMinute)}) : t('server.schedule.off'), schedule.lastSlot ? t('settings.server.jobs.last', {when: schedule.lastSlot}) : ''].filter(Boolean).join(' · ')} accessory="navigation" onPress={open} />
      <Sheet open={!!draft} onClose={() => setDraft(undefined)} kind="form" title={jobName(t, has, schedule.kind)} subtitle={schedule.timezone}
        primary={{label: t('action.save'), loading: action.busy, disabled: !next || JSON.stringify(next) === JSON.stringify(schedule), onPress: () => { if (next) void action.run(() => client.saveSchedule(next, schedule.revision)).then(ok => { if (ok) { setDraft(undefined); onSaved(); } }); }}}>
        {draft ? (
          <View style={{gap: space.md}}>
            {action.error ? <Notice tone="error" message={action.error} /> : null}
            <RowGroup><ToggleRow title={t('web.schedules.enabled')} subtitle={t('web.schedules.enabledHelp')} value={draft.enabled} onChange={enabled => setDraft({...draft, enabled})} /></RowGroup>
            <Field label={t('web.schedules.windowStarts')} hint={t('web.schedules.windowStartsHelp')} value={start} onChangeText={setStart} placeholder="02:00" keyboardType="numbers-and-punctuation" />
            <Field label={t('web.schedules.windowLength')} hint={t('web.schedules.windowLengthHelp')} value={length} onChangeText={setLength} keyboardType="number-pad" />
            <RowGroup><ToggleRow title={t('web.schedules.catchUpRow')} subtitle={t('web.schedules.catchUpHelp')} value={draft.catchUp} onChange={catchUp => setDraft({...draft, catchUp})} /></RowGroup>
          </View>
        ) : null}
      </Sheet>
    </>
  );
}
