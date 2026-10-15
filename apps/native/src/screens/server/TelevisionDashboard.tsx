import React, {useEffect, useMemo, useSyncExternalStore} from 'react';
import {AdminSessionsClient, NowPlayingStore} from '../../../../../packages/client-core/src/playback-v1/admin-sessions';
import {localV1Http} from '../../../../../packages/client-core/src/playback-v1/local-http';
import type {Alert, Measurement} from '../../../../../packages/client-core/src/console';
import {parseStorageReport} from '../../../../../packages/client-core/src/administration';
import {formatBytes} from '../../../../../packages/client-core/src/presentation/content';
import {duration, when} from '../../../../../packages/client-core/src/server-admin/console-words';
import {alertName, jobName, jobStateName} from '../../../../../packages/client-core/src/server-admin/console-catalogue';
import {healthFacts} from '../../../../../packages/client-core/src/server-admin/dashboard';
import {driveNowPlaying, sessionFacts} from '../../../../../packages/client-core/src/server-admin/now-playing';
import {useDeviceEvents} from '../../app/device-events';
import {useI18n} from '../../app/i18n';
import {TASK_EVENTS, appEnvironment, useAdmin, useConsole, useRead} from '../../app/server-console';
import {useSession} from '../../app/session';
import {ListRow, Notice, RowGroup} from '../../ui';
import {recentProblems, workInProgress} from './owner-rules';

/**
 * The owner's Dashboard on television (Justin, 14 Oct 2026): one screen that only shows. The
 * server and how it is doing, who is playing what on which device and whether it is being
 * converted, background work under way, storage at a glance, and what went wrong lately.
 *
 * Nothing here changes anything: no row has an action, and the owner's panels (stopping
 * playback, acknowledging an alert, pausing a task, every settings page) stay on phones, tablets
 * and the web. Rows are readable stops so the remote can move through the page.
 *
 * It keeps itself current the way every open screen does: each part is read again when the feed
 * says it moved and at a calm pace otherwise, what is shown stays while it is read, a failed
 * quiet read says nothing, and rows keep their identity so focus stays where it is.
 */
export function TelevisionDashboard({entry}: {/** The first row takes focus when the page opens. */ entry?: boolean}) {
  const {session} = useSession();
  // An administrator's Dashboard is who is watching what: the rest of it is the owner's to read.
  return session?.viewer.role === 'owner' ? <OwnerTelevisionDashboard entry={entry} /> : <TelevisionWatchingNow entry={entry} />;
}

function TelevisionWatchingNow({entry}: {entry?: boolean}) {
  const {api} = useSession();
  const t = useI18n().t;
  const events = useDeviceEvents();
  const store = useMemo(() => new NowPlayingStore(new AdminSessionsClient(localV1Http(api))), [api]);
  const playing = useSyncExternalStore(store.subscribe, store.getSnapshot);
  useEffect(() => driveNowPlaying(() => void store.refresh(), events ?? undefined, appEnvironment), [store, events]);
  const sessions = playing.sessions;
  return (
    <RowGroup title={sessions.length ? `${t('web.nowPlaying.title')} · ${sessions.length}` : t('web.nowPlaying.title')}>
      {sessions.map((x, n) => <ListRow key={x.id} readable hasTVPreferredFocus={entry && n === 0} icon="play" title={x.title || t('web.nowPlaying.untitled')} subtitle={sessionFacts(x, t)} subtitleLines={2} />)}
      {!sessions.length ? <ListRow readable hasTVPreferredFocus={entry} icon="play" title={playing.updatedAt !== undefined ? t('web.nowPlaying.empty') : t('web.nowPlaying.title')} /> : null}
    </RowGroup>
  );
}

function OwnerTelevisionDashboard({entry}: {entry?: boolean}) {
  const {api, system} = useSession();
  const client = useConsole();
  const admin = useAdmin();
  const i18n = useI18n();
  const t = i18n.t;
  const events = useDeviceEvents();
  const store = useMemo(() => new NowPlayingStore(new AdminSessionsClient(localV1Http(api))), [api]);
  const playing = useSyncExternalStore(store.subscribe, store.getSnapshot);
  useEffect(() => driveNowPlaying(() => void store.refresh(), events ?? undefined, appEnvironment), [store, events]);
  const health = useRead<Measurement>(() => client.measurement('health'), [client], {every: 30000});
  const storage = useRead<Measurement>(() => client.measurement('storage'), [client], {every: 60000});
  const disk = useRead(() => admin.get('/v1/admin/storage-usage', parseStorageReport), [admin], {every: 300000});
  const jobs = useRead(() => client.jobs(''), [client], {every: 20000, on: TASK_EVENTS});
  const alerts = useRead<Alert[]>(() => client.alerts(), [client], {every: 60000});

  const facts = healthFacts(health.data, storage.data);
  const upFor = facts.uptimeSeconds !== undefined ? t('settings.server.health.upFor', {duration: duration(facts.uptimeSeconds)}) : undefined;
  const work = workInProgress(jobs.data?.items ?? []);
  const problems = recentProblems(alerts.data ?? [], jobs.data?.items ?? [], Date.now());
  const sessions = playing.sessions;
  const watching = playing.updatedAt !== undefined;
  // Nothing could be read at all: one sentence, with nothing to press. The page keeps trying by itself.
  const unreachable = !health.data && !jobs.data && !alerts.data && !watching ? health.error || jobs.error || alerts.error : undefined;
  return (
    <>
      {unreachable ? <Notice tone="error" message={unreachable} /> : null}
      <RowGroup title={t('settings.server.health')}>
        <ListRow readable hasTVPreferredFocus={entry} icon="server" title={system?.name ?? t('servers.fallbackName')} subtitle={[system?.version ? t('servers.version', {version: system.version}) : undefined, upFor].filter(Boolean).join(' · ') || undefined} />
        {health.data ? <ListRow readable icon={facts.degraded ? 'warning' : 'check'} title={t(facts.degraded ? 'settings.server.health.attention' : 'settings.server.health.running')} /> : null}
      </RowGroup>
      <RowGroup title={sessions.length ? `${t('web.nowPlaying.title')} · ${sessions.length}` : t('web.nowPlaying.title')}>
        {sessions.map(x => <ListRow key={x.id} readable icon="play" title={x.title || t('web.nowPlaying.untitled')} subtitle={sessionFacts(x, t)} subtitleLines={2} />)}
        {watching && !sessions.length ? <ListRow readable icon="play" title={t('web.nowPlaying.empty')} /> : null}
      </RowGroup>
      <RowGroup title={t('web.activity.tasks')}>
        {work.map(job => <ListRow key={job.id} readable icon="jobs" title={jobName(t, i18n.has, job.kind)} meta={jobStateName(t, i18n.has, job.state)} subtitle={[job.resource, job.processed != null ? i18n.number(job.processed) : undefined, when(job.createdAt)].filter(Boolean).join(' · ')} />)}
        {jobs.data && !work.length ? <ListRow readable icon="check" title={t('web.activity.noTasks')} /> : null}
      </RowGroup>
      <RowGroup title={t('settings.server.diskUsage')}>
        {facts.freeBytes !== undefined ? <ListRow readable icon="storage" title={t('server.live.freeOnVolume')} meta={formatBytes(facts.freeBytes)} /> : null}
        {disk.data ? <ListRow readable icon="folder" title={t('web.maintenance.totalLabel')} meta={formatBytes(disk.data.totalBytes)} /> : null}
        {facts.databaseBytes !== undefined ? <ListRow readable icon="storage" title={t('server.places.database')} meta={formatBytes(facts.databaseBytes)} /> : null}
      </RowGroup>
      <RowGroup title={t('settings.server.alerts')}>
        {problems.map(problem => problem.kind === 'alert'
          ? <ListRow key={problem.id} readable icon={problem.alert.severity === 'critical' ? 'error' : 'warning'} title={alertName(t, i18n.has, problem.alert.code)} subtitle={[problem.alert.occurrences > 1 ? t('server.alert.seen', {count: problem.alert.occurrences, when: when(problem.alert.lastAt)}) : t('server.alert.firstSeen', {when: when(problem.alert.firstAt)}), problem.alert.status === 'acknowledged' ? t('server.alert.acknowledged') : ''].filter(Boolean).join(' · ')} />
          : <ListRow key={problem.id} readable icon="warning" title={jobName(t, i18n.has, problem.job.kind)} meta={jobStateName(t, i18n.has, problem.job.state)} subtitle={[problem.job.resource, when(problem.job.updatedAt)].filter(Boolean).join(' · ')} />)}
        {alerts.data && !problems.length ? <ListRow readable icon="check" title={t('web.overview.noAlerts')} /> : null}
      </RowGroup>
    </>
  );
}
