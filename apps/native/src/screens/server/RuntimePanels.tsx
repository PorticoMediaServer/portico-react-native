import React, {useEffect, useMemo, useRef, useState} from 'react';
import {Share, View} from 'react-native';
import {useNavigation} from '@react-navigation/native';
import type {NativeStackNavigationProp} from '@react-navigation/native-stack';
import {getBackups, isAuthenticationFailure, restartServer, waitForServerAnswer} from '../../../../../packages/client-core/src/backups';
import {readCatalogueFailures} from '../../../../../packages/client-core/src/catalogue-failures';
import {deleteClientReport, listClientReports, readClientReport, type ClientReport} from '../../../../../packages/client-core/src/client-reports';
import type {RuntimeSettings} from '../../../../../packages/client-core/src/console';
import {DownloadsService} from '../../../../../packages/client-core/src/downloads-service';
import {dependsOn} from '../../../../../packages/client-core/src/freshness-hub';
import {QUIET_READ_EVERY_MS} from '../../../../../packages/client-core/src/server-admin/quiet-read';
import {loadResourceUsage, pauseBackgroundWork, type MaintenanceDocument, type MaintenanceSettings, type RuntimeStatus} from '../../../../../packages/client-core/src/server-admin/server-forms';
import {storageStatusService, type UpgradeCopy} from '../../../../../packages/client-core/src/storage-status';
import type {MessageId} from '../../../../../packages/i18n/src/index';
import {clearPlaybackFailureMemory, groupPlaybackFailures, readPlaybackFailureMemory, type PlaybackFailure, type PlaybackFailureGroup} from '../../../../../packages/client-core/src/playback-failure-memory';
import type {ContentStackParams} from '../../app/routes';
import {routeForLinkedTitle} from '../../app/open';
import {useSession} from '../../app/session';
import {useI18n} from '../../app/i18n';
import {operationId, problem, untilDone, useAction, usePagedList, useRead, useServerId} from '../../app/server-console';
import {ConfirmSheet, ListRow, Menu, Notice, RowGroup, Sheet, Text, rowPaddingX, useSpecPlatform, useTheme} from '../../ui';
import {useServerForm} from '../settings/ServerForms';

const CLIENT_REPORT_MOVES = [dependsOn.list('clientReports')];
const DOWNLOAD_MOVES = [dependsOn.list('downloads')];

/** Schedule › pause background work for an hour, or resume it. The pause ends by itself; work already running finishes its step. A row of its section. */
export function BackgroundPauseRow() {
  const i18n = useI18n();
  const t = i18n.t;
  const {api} = useSession();
  const {form, state} = useServerForm<MaintenanceSettings, MaintenanceDocument>('maintenance');
  const action = useAction();
  if (!state.status) return null;
  const until = state.status.pausedUntilUnixMillis ?? 0;
  const paused = until > Date.now();
  return <ListRow tone="action" title={t(paused ? 'settings.server.resumeBackground' : 'settings.server.pauseBackground')} subtitleLines={4} disabled={action.busy}
    subtitle={action.error || (paused ? t('settings.server.backgroundPausedUntil', {time: i18n.time(until)}) : t('web.maintenance.pauseHeavyWorkHelp'))}
    onPress={() => void action.run(async () => { await pauseBackgroundWork({api}, !paused, operationId()); await form.load(); })} />;
}

/**
 * Playback › whether the owner's own FFmpeg build passed the server's checks and is the one in
 * use. A build that was accepted but is not in use yet says so: naming a path is not the same as
 * running it. Nothing when none is named. A row of its section.
 */
export function FFmpegStatusRow() {
  const i18n = useI18n();
  const t = i18n.t;
  const checked = useServerForm<RuntimeSettings, RuntimeStatus>('runtime').state.status?.ffmpegValidation;
  if (!checked?.path) return null;
  const refused = checked.state === 'refused';
  const reason = refused ? t(checked.reasonCode && i18n.has(checked.reasonCode) ? (checked.reasonCode as MessageId) : 'server.ffmpeg.refused') : '';
  const text = refused ? t('server.ffmpeg.refusedLine', {reason}) : checked.state === 'accepted' ? t(checked.inUse ? 'server.ffmpeg.inUse' : 'server.ffmpeg.afterRestart') : t('server.ffmpeg.unchecked');
  return <ListRow icon={refused ? 'warning' : checked.state === 'accepted' && checked.inUse ? 'check' : 'info'} title={t('server.ffmpeg.status')} subtitleLines={6}
    subtitle={[text, refused && checked.missingFeatures.length ? t('server.ffmpeg.missing', {features: i18n.list(checked.missingFeatures.slice(0, 8))}) : ''].filter(Boolean).join('\n')} />;
}

/** Storage & backups › what is in use right now, beside the limits the rows above set. */
export function ResourceUsagePanel() {
  const i18n = useI18n();
  const t = i18n.t;
  const {api} = useSession();
  const read = useRead(() => loadResourceUsage(api), [api], {every: QUIET_READ_EVERY_MS});
  const u = read.data;
  const used = (part: {trackedBytes: number; limitBytes: number; measured: boolean}) => (part.measured ? t('server.usage.ofLimit', {used: i18n.bytes(part.trackedBytes), limit: i18n.bytes(part.limitBytes)}) : t('server.usage.notMeasuredYet'));
  return (
    <>
      {read.error && !u ? <Notice tone="error" message={read.error} action={t('action.tryAgain')} onAction={read.reload} /> : null}
      {u ? (
        <RowGroup title={t('server.usage.title')} footer={t('server.usage.lede')}>
          <ListRow title={t('server.usage.streams')} meta={u.streamLimit ? t('server.usage.countOf', {used: u.streams, limit: u.streamLimit}) : i18n.number(u.streams)} />
          {u.connections ? <ListRow title={t('server.usage.connections')} subtitle={t('server.usage.connectionsHelp', {reserve: u.connections.consoleReserve})} meta={t('server.usage.countOf', {used: u.connections.ordinary, limit: u.connections.ordinaryLimit})} /> : null}
          <ListRow title={t('server.usage.analysis')} meta={used(u.analysis)} />
          <ListRow title={t('server.usage.artwork')} meta={used(u.localArtwork)} />
        </RowGroup>
      ) : null}
    </>
  );
}

/**
 * Storage & backups › where the server keeps things, how much space the database can give back,
 * and the copies it made before an upgrade. The folders are chosen when the server starts, so
 * they are shown, not set, here.
 */
export function StorageStatusPanel() {
  const i18n = useI18n();
  const t = i18n.t;
  const {api} = useSession();
  const service = useMemo(() => storageStatusService(<T,>(path: string, method?: string, body?: unknown) => api.request<T>(path, method, body)), [api]);
  // Space the database gives back, and a copy made by an upgrade, appear by themselves.
  const read = useRead(() => service.read(), [service], {every: QUIET_READ_EVERY_MS});
  const [removing, setRemoving] = useState<UpgradeCopy>();
  const s = read.data;
  return (
    <>
      {read.error && !s ? <Notice tone="error" message={read.error} action={t('action.tryAgain')} onAction={read.reload} /> : null}
      {s ? (
        <RowGroup title={t('server.places.title')} footer={t('server.places.lede')}>
          <ListRow icon="storage" title={t('server.places.database')} subtitle={s.databasePath} subtitleLines={4} />
          <ListRow icon="folder" title={t('server.places.cache')} subtitle={s.cacheDirectory} subtitleLines={4} />
          <ListRow icon="folder" title={t('server.places.backups')} subtitle={s.backupDirectory} subtitleLines={4} />
          <ListRow title={t('server.places.reclaim')} meta={i18n.bytes(s.reclaimableBytes)} subtitle={s.lastReclaimedAt ? t('server.places.reclaimedLast', {when: i18n.dateTime(s.lastReclaimedAt), size: i18n.bytes(s.lastReclaimedBytes)}) : t('server.places.reclaimHelp')} />
          {s.upgradeCopies.map(copy => <ListRow key={copy.id} icon="archive" title={t('server.places.upgradeCopy', {when: i18n.dateTime(copy.createdAt)})} subtitle={`${i18n.bytes(copy.bytes)} · ${copy.path}`} subtitleLines={4} accessory="menu" onPress={() => setRemoving(copy)} />)}
          {!s.upgradeCopies.length ? <ListRow title={t('server.places.upgradeCopies')} subtitle={t('server.places.upgradeCopiesNone')} /> : null}
        </RowGroup>
      ) : null}
      <ConfirmSheet open={!!removing} onDismiss={() => setRemoving(undefined)} title={t('server.places.deleteCopyTitle')} consequence={[removing?.path, t('server.places.deleteCopyBody')].filter(Boolean).join('\n\n')} confirmLabel={t('action.delete')} describeError={e => problem(e, 'action')}
        onConfirm={async () => { const copy = removing; if (!copy) return; await service.removeUpgradeCopy(copy); setRemoving(undefined); read.reload(); }} />
    </>
  );
}

/** Storage & backups › what downloads take on the server, person by person, with a way to remove one person's. */
export function DownloadUsagePanel() {
  const i18n = useI18n();
  const t = i18n.t;
  const {api} = useSession();
  // Only the owner's two calls are used; nothing here watches this device's own downloads.
  const service = useMemo(() => new DownloadsService(api, operationId), [api]);
  // What people have downloaded grows and shrinks as their devices come and go; the feed says when. A
  // server without downloads has nothing to show. Everyone the owner asked to see is read again:
  // the first page and each "Show more" after it.
  const [pages, setPages] = useState(1);
  const read = useRead(async () => {
    const first = await service.serverUsage().catch(e => ((e as {status?: number} | null)?.status === 404 ? null : Promise.reject(e)));
    if (!first) return first;
    const profiles = [...first.profiles];
    let cursor = first.profilesNextCursor ?? '';
    for (let page = 1; page < pages && cursor; page++) {
      const next = await service.serverUsage(cursor);
      profiles.push(...next.profiles);
      cursor = next.profilesNextCursor ?? '';
    }
    return {...first, profiles, profilesNextCursor: cursor};
  }, [service, pages], {on: DOWNLOAD_MOVES});
  const [revoking, setRevoking] = useState<{key: string; name: string}>();
  const [removed, setRemoved] = useState(false);
  const usage = read.data;
  if (usage === null) return null;
  const name = (p: {accountName?: string; profileName?: string}) => (p.accountName && p.profileName && p.accountName !== p.profileName ? `${p.accountName} · ${p.profileName}` : p.profileName || p.accountName || t('server.people.removedPerson'));
  return (
    <>
      {read.error && !usage ? <Notice tone="error" message={read.error} action={t('action.tryAgain')} onAction={read.reload} /> : null}
      {removed ? <Notice tone="success" message={t('server.downloadUsage.removed')} /> : null}
      {usage ? (
        <RowGroup title={t('server.downloadUsage.title')} footer={t('server.downloadUsage.lede')}>
          <ListRow title={t('server.downloadUsage.total')} subtitle={usage.remainingBytes !== null ? t('server.downloadUsage.remaining', {size: i18n.bytes(usage.remainingBytes)}) : undefined} meta={t('server.downloadUsage.totalLine', {size: i18n.bytes(usage.distinctArtifactBytes), count: usage.serverCount})} />
          {usage.profiles.map(p => {
            const who = name(p), key = p.profileKey;
            return <ListRow key={key ?? p.profileId} icon="profile" title={who} meta={t('server.downloadUsage.totalLine', {size: i18n.bytes(p.storedBytes ?? p.bytes), count: p.count})} {...(key && p.count ? {accessory: 'menu' as const, onPress: () => { setRemoved(false); setRevoking({key, name: who}); }} : {})} />;
          })}
          {!usage.profiles.length ? <ListRow title={t('server.downloadUsage.none')} /> : null}
          {usage.profilesNextCursor ? <ListRow tone="action" title={t('server.showMore')} disabled={read.loading} onPress={() => setPages(n => n + 1)} /> : null}
        </RowGroup>
      ) : null}
      <ConfirmSheet open={!!revoking} onDismiss={() => setRevoking(undefined)} title={t('server.downloadUsage.removeTitle', {name: revoking?.name ?? ''})} consequence={t('server.downloadUsage.removeBody')} confirmLabel={t('server.downloadUsage.remove')} describeError={e => problem(e, 'action')}
        onConfirm={async () => {
          const target = revoking;
          if (!target) return;
          // The server works in passes; keep going until nothing is left for this person.
          const finished = await untilDone(() => service.revokeProfile(target.key));
          setRevoking(undefined); setRemoved(finished); read.reload();
        }} />
    </>
  );
}

/**
 * General › Restart: an owner action, asked first. The page waits for the server to answer again
 * and says so; an ended sign-in goes to the sign-in screen through the session as usual.
 */
export function RestartPanel() {
  const t = useI18n().t;
  const {api} = useSession();
  const serverId = useServerId();
  const [asking, setAsking] = useState(false);
  const [phase, setPhase] = useState<'idle' | 'restarting' | 'back'>('idle');
  const [error, setError] = useState('');
  const stop = useRef<AbortController | null>(null);
  useEffect(() => () => stop.current?.abort(), []);
  const restart = () => {
    const controller = stop.current = new AbortController();
    setError(''); setPhase('restarting');
    restartServer(api, controller.signal)
      // The server may already be going down when it answers; either way, wait for it to come back.
      .catch(e => { if ((e as {status?: number} | null)?.status) throw e; })
      .then(() => waitForServerAnswer(() => getBackups(api, serverId, controller.signal), {signal: controller.signal}))
      .then(() => { if (!controller.signal.aborted) setPhase('back'); }, e => { if (controller.signal.aborted || isAuthenticationFailure(e)) return; setPhase('idle'); setError(problem(e, 'action') || t('server.restart.failed')); });
  };
  return (
    <>
      {error ? <Notice tone="error" message={error} /> : null}
      {phase === 'back' ? <Notice tone="success" message={t('server.restart.back')} /> : null}
      <RowGroup title={t('web.maintenance.serverRestart')}>
        <ListRow tone="action" icon="restart" title={t('web.maintenance.serverRestart')} subtitle={phase === 'restarting' ? t('server.restart.waiting') : t('web.maintenance.serverRestartHelp')} disabled={phase === 'restarting'} onPress={() => setAsking(true)} />
      </RowGroup>
      <ConfirmSheet open={asking} onDismiss={() => setAsking(false)} tone="default" title={t('server.restart.title')} consequence={t('server.restart.body')} confirmLabel={t('web.maintenance.serverRestart')} onConfirm={restart} />
    </>
  );
}

// A rebuild that finishes, or fails again, moves this list.
const SET_ASIDE_MOVES = [dependsOn.content()];

/**
 * Troubleshooting › Titles set aside: titles a catalogue rebuild could not finish, so that
 * everything else could. Each says why, in the server's own words, and how often it has been
 * tried; the server tries again by itself. Nothing is shown while there are none.
 */
export function SetAsideTitlesPanel() {
  const i18n = useI18n();
  const t = i18n.t;
  const {api} = useSession();
  const read = useRead(() => readCatalogueFailures(api), [api], {on: SET_ASIDE_MOVES});
  const list = read.data;
  if (!list?.failures.length) return null;
  return (
    <RowGroup title={t('server.setAside.title')} footer={list.more ? `${t('server.setAside.lede')}\n\n${t('server.setAside.more')}` : t('server.setAside.lede')}>
      {list.failures.map((f, n) => <ListRow key={`${f.domain}:${f.entityId ?? n}`} icon="warning" title={f.title || t('server.setAside.untitled')} subtitle={`${t('server.setAside.tried', {count: f.attempts, when: i18n.dateTime(f.failedAt)})}\n${f.reason}`} subtitleLines={6} />)}
      <ListRow tone="action" icon="refresh" title={t('server.setAside.check')} disabled={read.loading} onPress={read.reload} />
    </RowGroup>
  );
}

/** "iPhone · phone · 1.4.2": what sent a report, in the words the report carries. */
const reportSender = (report: Pick<ClientReport, 'platform' | 'deviceClass' | 'appVersion'>): string => [report.platform, report.deviceClass, report.appVersion].filter(Boolean).join(' · ');

/**
 * Troubleshooting › Client reports: the logs an app sent after something went wrong, newest
 * first. Each can be read here, shared on from this device, or deleted. Nothing is sent anywhere
 * else by itself.
 */
export function ClientReportsPanel() {
  const i18n = useI18n();
  const t = i18n.t;
  const {api} = useSession();
  const serverId = useServerId();
  const pad = rowPaddingX(useSpecPlatform());
  const {space} = useTheme();
  const read = usePagedList(async cursor => { const page = await listClientReports(api, serverId, cursor); return {items: [...page.items], nextCursor: page.nextCursor ?? ''}; }, [api, serverId], {on: CLIENT_REPORT_MOVES});
  const [menu, setMenu] = useState<ClientReport>();
  const [open, setOpen] = useState<{report: ClientReport; body?: string; error?: string}>();
  const [removing, setRemoving] = useState<ClientReport>();
  const sender = (report: ClientReport) => reportSender(report) || t('server.reports.unknownSender');
  const show = (report: ClientReport) => {
    setOpen({report});
    readClientReport(api, serverId, report.id).then(full => setOpen(o => (o?.report.id === report.id ? {report: full, body: full.body ?? ''} : o)), e => setOpen(o => (o?.report.id === report.id ? {report, error: problem(e)} : o)));
  };
  return (
    <>
      {read.error ? <Notice tone={read.items ? 'warning' : 'error'} message={read.error} action={t('action.tryAgain')} onAction={read.reload} /> : null}
      <RowGroup title={t('web.diagnostics.clientReports')} footer={t('server.reports.lede')}>
        {read.items?.map(report => <ListRow key={report.id} icon="logs" title={sender(report)} subtitle={`${i18n.dateTime(report.receivedAt)} · ${i18n.bytes(report.bytes)}`} accessory="menu" onPress={() => setMenu(report)} />)}
        {read.items && !read.items.length ? <ListRow title={t('server.reports.none')} /> : null}
        {read.more ? <ListRow tone="action" title={t('server.showMore')} disabled={read.loading} onPress={read.loadMore} /> : null}
      </RowGroup>
      <Menu open={!!menu} onClose={() => setMenu(undefined)} title={menu ? sender(menu) : undefined} subtitle={menu ? i18n.dateTime(menu.receivedAt) : undefined}
        items={[{id: 'read', label: t('server.reports.read'), icon: 'logs'}, {id: 'delete', label: t('web.diagnostics.clientReportDelete'), icon: 'trash', destructive: true}]}
        onSelect={id => { const report = menu; if (!report) return; if (id === 'read') show(report); else setRemoving(report); }} />
      <Sheet open={!!open} onClose={() => setOpen(undefined)} kind="form" cancelLabel={t('action.done')} title={t('server.reports.title')} subtitle={open ? `${sender(open.report)} · ${i18n.dateTime(open.report.receivedAt)}` : undefined}
        leading={open?.body ? {label: t('server.reports.share'), onPress: () => { void Share.share({message: open.body ?? ''}).catch(() => {}); }} : undefined}>
        <View style={{paddingHorizontal: pad, gap: space.md}}>
          {open?.error ? <Notice tone="error" message={open.error} action={t('action.tryAgain')} onAction={() => show(open.report)} /> : null}
          {open?.body !== undefined ? <Text variant="caption" tone="secondary" selectable>{open.body || t('server.reports.empty')}</Text> : null}
        </View>
      </Sheet>
      <ConfirmSheet open={!!removing} onDismiss={() => setRemoving(undefined)} title={t('server.reports.deleteTitle')} consequence={t('server.reports.deleteBody')} confirmLabel={t('action.delete')} describeError={e => problem(e, 'action')}
        onConfirm={async () => { const report = removing; if (!report) return; await deleteClientReport(api, report.id); setRemoving(undefined); read.reload(); }} />
    </>
  );
}

const PROBLEM_MOVES = [dependsOn.list('playbackProblems')];

/**
 * Streaming › Playback problems Portico remembers: ways of playing a file that failed on a
 * device and are being avoided until the time shown. Each file is one row under the title it
 * belongs to, with what failed underneath; its menu opens the title or forgets the file's
 * problems, which lets the first way be tried again. Nothing is shown while there are none.
 */
export function PlaybackProblemsPanel() {
  const i18n = useI18n();
  const t = i18n.t;
  const {api} = useSession();
  const navigation = useNavigation<NativeStackNavigationProp<ContentStackParams>>();
  // A failure a device reports, and one that expires, show and go by themselves.
  const read = useRead(() => readPlaybackFailureMemory(api), [api], {on: PROBLEM_MOVES});
  const action = useAction();
  const [forgotten, setForgotten] = useState(false);
  const [menu, setMenu] = useState<PlaybackFailureGroup>();
  const groups = useMemo(() => groupPlaybackFailures(read.data?.items ?? []), [read.data]);
  if (!groups.length && !forgotten) return null;
  const line = (f: PlaybackFailure) => t('server.routes.line', {route: t(`server.routes.route.${f.route}`), engine: t(`server.routes.engine.${f.engine}`)});
  const forget = (group: PlaybackFailureGroup) => void action.run(async () => { await clearPlaybackFailureMemory(api, group.sourceId); read.reload(); }).then(ok => setForgotten(ok));
  return (
    <>
      {action.error ? <Notice tone="error" message={action.error} /> : null}
      {forgotten && !action.error ? <Notice tone="success" message={t('server.routes.forgotten')} /> : null}
      <RowGroup title={t('server.routes.title')} footer={read.data?.more ? `${t('server.routes.lede')}\n\n${t('server.routes.more')}` : t('server.routes.lede')}>
        {groups.map(group => {
          const first = group.failures[0]!;
          const detail = first.detail || first.code;
          return <ListRow key={group.sourceId} icon="warning" title={group.item?.title || t('server.routes.unknownTitle')} accessory="menu" subtitleLines={8}
            subtitle={[...group.failures.map(line), t('server.routes.when', {when: i18n.dateTime(group.reportedAtMs), until: i18n.dateTime(group.expiresAtMs)}), detail].filter(Boolean).join('\n')}
            onPress={() => { action.clear(); setForgotten(false); setMenu(group); }} />;
        })}
      </RowGroup>
      <Menu open={!!menu} onClose={() => setMenu(undefined)} title={menu?.item?.title || t('server.routes.unknownTitle')}
        items={[...(menu?.item ? [{id: 'open', label: t('server.routes.openTitle'), icon: 'info' as const}] : []), {id: 'forget', label: t('server.routes.forget'), icon: 'refresh' as const}]}
        onSelect={id => {
          const group = menu; setMenu(undefined); if (!group) return;
          if (id === 'forget') forget(group);
          else if (id === 'open' && group.item) void routeForLinkedTitle(api, group.item.id).then(route => { if (route) (navigation.push as (name: string, params?: object) => void)(route.name, route.params); });
        }} />
    </>
  );
}
