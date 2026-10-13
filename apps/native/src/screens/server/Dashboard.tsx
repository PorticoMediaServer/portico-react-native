import React, {useEffect, useMemo, useState, useSyncExternalStore} from 'react';
import {View} from 'react-native';
import Svg, {Path} from 'react-native-svg';
import {useNavigation} from '@react-navigation/native';
import type {NativeStackNavigationProp} from '@react-navigation/native-stack';
import {AdminSessionsClient, NowPlayingStore} from '../../../../../packages/client-core/src/playback-v1/admin-sessions';
import {localV1Http} from '../../../../../packages/client-core/src/playback-v1/local-http';
import type {AdminSession} from '../../../../../packages/client-core/src/playback-v1/types';
import type {Alert, Job, Measurement} from '../../../../../packages/client-core/src/console';
import {VIEWING_PERIODS, fetchPlaySummary, viewingFigures, viewingPeriodLabel, type ViewingPeriod} from '../../../../../packages/client-core/src/play-history';
import type {TelemetryPoint, TelemetryWindow} from '../../../../../packages/client-core/src/telemetry';
import {isStatePermissionsAlert} from '../../../../../packages/client-core/src/administration';
import {fixStatePermissions} from '../../../../../packages/client-core/src/backups';
import {formatBytes} from '../../../../../packages/client-core/src/presentation/content';
import {alertLabel, duration, jobLabel, jobStateLabel, sentence, when} from '../../../../../packages/client-core/src/server-admin/console-words';
import {healthFacts, loadValue, measuredLoadTiles} from '../../../../../packages/client-core/src/server-admin/dashboard';
import {STOP_MESSAGE_MAX, driveNowPlaying, sessionFacts, sessionViewer, stopMessage} from '../../../../../packages/client-core/src/server-admin/now-playing';
import type {ContentStackParams} from '../../app/routes';
import {useSession} from '../../app/session';
import {routeForLinkedTitle} from '../../app/open';
import {useI18n} from '../../app/i18n';
import {useDeviceEvents} from '../../app/device-events';
import {appEnvironment, operationId, problem, TASK_EVENTS, useAction, useConsole, useRead, useServerId} from '../../app/server-console';
import {Field, ListRow, Menu, Notice, RowGroup, Segmented, Sheet, Text, isTV, rowPaddingX, useSpecPlatform, useTheme, type MenuItem} from '../../ui';

/** Dashboard › Watching now: who is playing what, with Stop playback and an optional message. */
export function NowPlayingPanel({entry}: {entry?: boolean}) {
  const {api} = useSession();
  const i18n = useI18n();
  const t = i18n.t;
  const navigation = useNavigation<NativeStackNavigationProp<ContentStackParams>>();
  const events = useDeviceEvents();
  const store = useMemo(() => new NowPlayingStore(new AdminSessionsClient(localV1Http(api))), [api]);
  const snap = useSyncExternalStore(store.subscribe, store.getSnapshot);
  useEffect(() => driveNowPlaying(() => void store.refresh(), events ?? undefined, appEnvironment), [store, events]);
  const action = useAction();
  const [menu, setMenu] = useState<AdminSession>();
  const [stop, setStop] = useState<AdminSession>();
  const [message, setMessage] = useState('');
  const loaded = snap.updatedAt !== undefined;
  const items = snap.sessions;
  return (
    <>
      {snap.error && !loaded ? <Notice tone="error" message={problem(snap.error)} action={t('action.tryAgain')} onAction={() => void store.refresh()} /> : null}
      <RowGroup title={items.length ? `${t('web.nowPlaying.title')} · ${items.length}` : t('web.nowPlaying.title')}>
        {loaded && !items.length ? <ListRow readable hasTVPreferredFocus={isTV && entry} icon="play" title={t('web.nowPlaying.empty')} /> : null}
        {items.map((x, i) => <ListRow key={x.id} hasTVPreferredFocus={isTV && entry && i === 0} title={x.title || t('web.nowPlaying.untitled')} subtitle={sessionFacts(x, t)} accessory="menu" onPress={() => setMenu(x)} />)}
      </RowGroup>
      <Menu open={!!menu} onClose={() => setMenu(undefined)} title={menu?.title || t('web.nowPlaying.untitled')}
        items={[...(menu?.itemId ? [{id: 'open', label: t('web.nowPlaying.open'), icon: 'info'} as MenuItem] : []), {id: 'stop', label: t('web.nowPlaying.stop'), icon: 'stop', destructive: true} as MenuItem]}
        onSelect={id => { const x = menu; if (!x) return; if (id === 'open' && x.itemId) void routeForLinkedTitle(api, x.itemId).then(route => { if (route) (navigation.push as (name: string, params?: object) => void)(route.name, route.params); }); if (id === 'stop') { setMessage(''); action.clear(); setStop(x); } }} />
      <Sheet open={!!stop} onClose={() => setStop(undefined)} kind="form" title={t('web.nowPlaying.stopTitle', {title: stop?.title || t('web.nowPlaying.untitled')})} subtitle={stop ? t('web.nowPlaying.stopBody', {viewer: sessionViewer(stop, t)}) : undefined}
        primary={{label: t('web.nowPlaying.stopConfirm'), tone: 'destructive', loading: action.busy, onPress: () => { if (stop) void action.run(() => store.terminate(stop.id, stopMessage(message))).then(ok => { if (ok) setStop(undefined); }); }}}>
        <Field label={t('web.nowPlaying.messageLabel')} hint={t('web.nowPlaying.messageHelp')} placeholder={t('web.nowPlaying.messagePlaceholder')} value={message} onChangeText={setMessage} maxLength={STOP_MESSAGE_MAX} multiline error={action.error || undefined} />
      </Sheet>
    </>
  );
}

/** The state-folder warning and its owner-only fix; present only while the server reports it. */
export function StatePermissionsNotice({alert, onChanged}: {alert: Alert; onChanged?: () => void}) {
  const {api} = useSession();
  const serverId = useServerId();
  const client = useConsole();
  const t = useI18n().t;
  const action = useAction();
  const [fixed, setFixed] = useState(false);
  if (!isStatePermissionsAlert(alert)) return null;
  // One id for the fix: a retry of the same repair replays its receipt.
  const fix = () => void action.run(() => fixStatePermissions(api, serverId, operationId())).then(ok => { if (ok) { setFixed(true); void client.acknowledge(alert).catch(() => {}); onChanged?.(); } });
  return <Notice tone={fixed ? 'success' : 'warning'} title={t('web.maintenance.permissionsTitle')} message={action.error || (fixed ? t('web.maintenance.permissionsFixed') : t('web.maintenance.permissionsBody'))} action={fixed ? undefined : t('web.maintenance.fixPermissions')} onAction={fixed ? undefined : fix} />;
}

/** Dashboard › Needs attention: what the server is warning about, each with Acknowledge. */
export function AlertsPanel() {
  const client = useConsole();
  const t = useI18n().t;
  const {space} = useTheme();
  const read = useRead<Alert[]>(() => client.alerts(), [client], {every: 60000});
  const action = useAction();
  const open = (read.data ?? []).filter(a => a.status !== 'resolved');
  if (read.error && !read.data) return <Notice tone="error" message={read.error} action={t('action.tryAgain')} onAction={read.reload} />;
  if (!read.data) return null;
  if (!open.length) return <Notice tone="success" message={t('web.overview.noAlerts')} />;
  return (
    <View style={{gap: space.sm}}>
      {open.map(a => isStatePermissionsAlert(a) ? <StatePermissionsNotice key={a.id} alert={a} onChanged={read.reload} /> : (
        <Notice key={a.id} tone={a.severity === 'critical' ? 'error' : 'warning'} title={alertLabel(a)}
          message={[a.occurrences > 1 ? t('server.alert.seen', {count: a.occurrences, when: when(a.lastAt)}) : t('server.alert.firstSeen', {when: when(a.firstAt)}), a.status === 'acknowledged' ? t('server.alert.acknowledged') : ''].filter(Boolean).join(' · ')}
          action={a.status === 'open' ? t('web.overview.acknowledge') : undefined} onAction={a.status === 'open' ? () => void action.run(() => client.acknowledge(a)).then(ok => { if (ok) read.reload(); }) : undefined} />
      ))}
      {action.error ? <Notice tone="error" message={action.error} /> : null}
    </View>
  );
}

/** A small line of recent history: no chart library for six short lines. */
function Spark({points, max, width, height}: {points: readonly TelemetryPoint[]; max: number; width: number; height: number}) {
  const {colors} = useTheme();
  if (points.length < 2) return <View style={{width, height}} />;
  const t0 = points[0].t, span = Math.max(1, points[points.length - 1].t - t0), top = Math.max(max, 1e-9);
  const path = points.map((p, i) => `${i ? 'L' : 'M'}${(((p.t - t0) / span) * width).toFixed(1)},${(height - 1 - Math.min(1, p.v / top) * (height - 2)).toFixed(1)}`).join(' ');
  return <Svg width={width} height={height}><Path d={path} fill="none" stroke={colors.accent} strokeWidth={isTV ? 3 : 1.5} /></Svg>;
}

/** Dashboard › Health: one sentence on how the server is doing, the facts behind it, and its load with recent history. */
export function HealthPanel() {
  const client = useConsole();
  const t = useI18n().t;
  const {space, colors} = useTheme();
  const platform = useSpecPlatform();
  const [window, setWindow] = useState<TelemetryWindow>('1h');
  const health = useRead<Measurement>(() => client.measurement('health'), [client], {every: 30000});
  const storage = useRead<Measurement>(() => client.measurement('storage'), [client], {every: 60000});
  const load = useRead(() => client.telemetry(window), [client, window], {every: window === '10m' ? 15000 : 60000});
  const facts = healthFacts(health.data, storage.data);
  const line = [
    facts.uptimeSeconds !== undefined ? t('settings.server.health.upFor', {duration: duration(facts.uptimeSeconds)}) : '',
    facts.freeBytes !== undefined ? t('settings.server.health.free', {bytes: formatBytes(facts.freeBytes)}) : '',
    facts.databaseBytes !== undefined ? t('settings.server.health.database', {bytes: formatBytes(facts.databaseBytes)}) : '',
  ].filter(Boolean).join(' · ');
  const data = load.data;
  const spark = isTV ? {width: 220, height: 44} : {width: 96, height: 26};
  return (
    <>
      {health.error && !health.data ? <Notice tone="error" message={health.error} action={t('action.tryAgain')} onAction={health.reload} /> : null}
      <RowGroup title={t('settings.server.health')}>
        {health.data ? <ListRow readable icon={facts.degraded ? 'warning' : 'check'} title={t(facts.degraded ? 'settings.server.health.attention' : 'settings.server.health.running')} subtitle={line || undefined} /> : null}
        {data ? <View style={{paddingHorizontal: rowPaddingX(platform), paddingVertical: space.sm}}><Segmented accessibilityLabel={t('web.telemetry.period')} selected={window} onSelect={id => setWindow(id as TelemetryWindow)} items={[{id: '10m', label: t('web.telemetry.window10m')}, {id: '1h', label: t('web.telemetry.window1h')}, {id: '24h', label: t('web.telemetry.window24h')}]} /></View> : null}
        {/* A figure this server cannot measure is left out; when none can be, that is said once. */}
        {data ? measuredLoadTiles(data.status).map(tile => {
          const series = data.series[tile.metric] ?? [];
          const peak = tile.unit === 'percent' ? 100 : Math.max(...series.map(p => p.v), 1);
          return <ListRow key={tile.metric} readable title={t(tile.label)} meta={loadValue(tile, data.status[tile.metric])} trailing={<View style={{marginLeft: space.sm}}><Spark points={series} max={peak} {...spark} /></View>} />;
        }) : null}
        {data && !measuredLoadTiles(data.status).length ? <ListRow title={t('server.health.loadNotMeasured')} /> : null}
      </RowGroup>
      {load.error && !data ? <Text variant="caption" style={{color: colors.danger}}>{load.error}</Text> : null}
    </>
  );
}

/** Dashboard › Tasks: background work (scans, analysis and the rest) and what can be done about each. */
export function JobsPanel() {
  const client = useConsole();
  const t = useI18n().t;
  const read = useRead(() => client.jobs(''), [client], {every: 20000, on: TASK_EVENTS});
  const action = useAction();
  const [menu, setMenu] = useState<Job>();
  const items = read.data?.items ?? [];
  const labels: Record<Job['actions'][number], string> = {pause: t('action.pause'), resume: t('entry.resume'), retry: t('action.tryAgain'), cancel: t('action.cancel')};
  return (
    <>
      {read.error && !read.data ? <Notice tone="error" message={read.error} action={t('action.tryAgain')} onAction={read.reload} /> : null}
      <RowGroup title={t('web.activity.tasks')} footer={read.data?.nextCursor ? t('server.tasks.latestOnly') : undefined}>
        {read.data && !items.length ? <ListRow readable icon="check" title={t('web.activity.noTasks')} subtitle={t('web.activity.noTasksBody')} /> : null}
        {items.map(job => (
          <ListRow key={job.id} title={jobLabel(job.kind)} meta={jobStateLabel[job.state]}
            subtitle={[job.resource, job.processed != null ? job.processed.toLocaleString() : undefined, when(job.createdAt), job.errorCode ? t('web.console.jobFailed') : undefined].filter(Boolean).join(' · ')}
            {...(job.actions.length ? {accessory: 'menu' as const, onPress: () => setMenu(job)} : {readable: true})} />
        ))}
      </RowGroup>
      {action.error ? <Notice tone="error" message={action.error} /> : null}
      <Menu open={!!menu} onClose={() => setMenu(undefined)} title={menu ? jobLabel(menu.kind) : undefined} subtitle={menu ? sentence(menu.phase || menu.state) : undefined}
        items={(menu?.actions ?? []).map<MenuItem>(a => ({id: a, label: labels[a], destructive: a === 'cancel'}))}
        onSelect={id => { const job = menu; if (job) void action.run(() => client.jobCommand(job, id as Job['actions'][number])).then(ok => { if (ok) read.reload(); }); }} />
    </>
  );
}

/** Dashboard › Viewing: what was watched, by whom, and how much of it the server had to convert. */
export function StatisticsPanel() {
  const client = useConsole();
  const t = useI18n().t;
  const {space} = useTheme();
  const platform = useSpecPlatform();
  const [period, setPeriod] = useState<ViewingPeriod>('24h');
  // Totals of the play history for the period: the same plays the Play history page lists.
  const {api} = useSession();
  const read = useRead(() => fetchPlaySummary(api, period), [api, period]);
  const figures = read.data ? viewingFigures(read.data) : undefined;
  return (
    <>
      {read.error && !read.data ? <Notice tone="error" message={read.error} action={t('action.tryAgain')} onAction={read.reload} /> : null}
      <RowGroup title={t('web.telemetry.viewing')} footer={read.data && !read.data.plays ? t('web.telemetry.noViewing') : undefined}>
        <View style={{paddingHorizontal: rowPaddingX(platform), paddingVertical: space.sm}}><Segmented accessibilityLabel={t('web.telemetry.period')} selected={period} onSelect={id => setPeriod(id as ViewingPeriod)} items={VIEWING_PERIODS.map(id => ({id, label: t(viewingPeriodLabel(id))}))} /></View>
        {figures ? <ListRow title={t('server.viewing.plays')} meta={figures.plays} /> : null}
        {figures ? <ListRow title={t('server.viewing.people')} meta={figures.people} /> : null}
        {figures ? <ListRow title={t('server.viewing.hours')} meta={figures.hours} /> : null}
        {figures ? <ListRow title={t('server.viewing.converted')} meta={figures.converted} /> : null}
      </RowGroup>
      {read.data?.mostPlayed.length ? <RowGroup title={t('server.viewing.mostPlayed')}>{read.data.mostPlayed.map(row => <ListRow key={row.name} title={row.name} meta={String(row.plays)} />)}</RowGroup> : null}
      {read.data?.mostActive.length ? <RowGroup title={t('server.viewing.mostActive')}>{read.data.mostActive.map(row => <ListRow key={row.name} title={row.name} meta={String(row.plays)} />)}</RowGroup> : null}
    </>
  );
}
