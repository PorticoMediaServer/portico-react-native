import React, {useEffect, useRef, useState} from 'react';
import {View} from 'react-native';
import {backupProgressFraction, isRestoreRefusalCode, parseStorageReport, type BackupKind, type BackupSummary, type RestoreRefusalCode, type StorageUsage} from '../../../../../packages/client-core/src/administration';
import {emptyMissingTitles, listMissingTitles} from '../../../../../packages/client-core/src/title-identity';
import {deleteBackup, getBackups, isAuthenticationFailure, restoreBackup, startBackup, waitForBackupCompletion, waitForServerAnswer} from '../../../../../packages/client-core/src/backups';
import {StorageManagementService, type StorageManagementSnapshot, type StorageMount} from '../../../../../packages/client-core/src/storage-management';
import {RemoteSourceService, type RemoteSource} from '../../../../../packages/client-core/src/remote-sources';
import type {LogSettings} from '../../../../../packages/client-core/src/server-administration';
import {viewerScope} from '../../../../../packages/client-core/src/presentation/index';
import {formatBytes} from '../../../../../packages/client-core/src/presentation/content';
import {sentence} from '../../../../../packages/client-core/src/server-admin/console-words';
import {davCommandSucceeded, davConfiguration, mountCommandSucceeded, retentionRows, stableStorageOperationId, type WebDavDraft} from '../../../../../packages/client-core/src/server-admin/panel-logic';
import {createOperationIds, type LogsDraft, type MaintenanceDocument, type MaintenanceSettings} from '../../../../../packages/client-core/src/server-admin/server-forms';
import type {MessageId} from '../../../../../packages/i18n/src/index';
import {useSession} from '../../app/session';
import {useI18n} from '../../app/i18n';
import {operationId, problem, useAction, useAdmin, usePagedList, useRead, useServerId, useService} from '../../app/server-console';
import {ConfirmSheet, Field, ListRow, Menu, Notice, ProgressBar, RowGroup, Sheet, ToggleRow, rowPaddingX, useSpecPlatform, useTheme, type MenuItem} from '../../ui';
import {TypedRow, useServerForm} from '../settings/ServerForms';
import {dependsOn} from '../../../../../packages/client-core/src/freshness-hub';

// A title goes missing or comes back with the library's content.
const MISSING_MOVES = [dependsOn.content()];
// A backup is made, restored and pruned as a task: its progress is on the feed.
const BACKUP_MOVES = [dependsOn.event('operation.updated')];

const dateTime = (iso: string) => (iso ? new Date(iso).toLocaleString(undefined, {dateStyle: 'medium', timeStyle: 'short'}) : '—');

/** Storage & backups › Disk usage: what the server's own files take, with clean-up. Anything that destroys data asks for a typed confirmation. */
export function DiskUsagePanel() {
  const admin = useAdmin();
  const t = useI18n().t;
  const read = useRead(() => admin.get('/v1/admin/storage-usage', parseStorageReport), [admin]);
  const [opIds] = useState(() => createOperationIds(operationId));
  const [chosen, setChosen] = useState<StorageUsage>();
  const [days, setDays] = useState('30');
  const report = read.data;
  const cleanUp = async () => {
    if (!chosen) return;
    const payload = {olderThanDays: Math.max(0, Number(days) || 0), confirmation: chosen.id};
    await admin.send(`/v1/admin/storage-usage/${encodeURIComponent(chosen.id)}/cleanup`, {...payload, operationId: opIds.forPayload(JSON.stringify({id: chosen.id, ...payload}))});
    opIds.release(); setChosen(undefined); read.reload();
  };
  return (
    <>
      {read.error ? <Notice tone={report ? 'warning' : 'error'} message={read.error} action={t('action.tryAgain')} onAction={read.reload} /> : null}
      {report ? (
        <RowGroup title={t('settings.server.diskUsage')} footer={t('web.maintenance.storageLede')}>
          <ListRow title={t('web.maintenance.totalLabel')} meta={formatBytes(report.totalBytes)} subtitle={report.truncated ? t('web.maintenance.truncatedHelp') : undefined} />
          {report.categories.filter(c => c.present).map(c => {
            const cleanable = c.cleanable && c.bytes > 0;
            return <ListRow key={c.id} title={c.name} subtitle={c.regenerable ? t('web.maintenance.regenerableHelp', {description: c.description}) : c.description} meta={formatBytes(c.bytes)} {...(cleanable ? {accessory: 'navigation' as const, onPress: () => { setChosen(c); setDays('30'); }} : {})} />;
          })}
        </RowGroup>
      ) : null}
      <ConfirmSheet open={!!chosen} onDismiss={() => setChosen(undefined)} title={t('web.maintenance.cleanUpTitle', {name: chosen?.name ?? ''})} consequence={t('web.maintenance.cleanUpBody', {canRecreate: chosen?.regenerable ? 'yes' : 'no', id: chosen?.id ?? ''})} confirmLabel={t('server.cleanUp')} confirmToken={chosen?.id} onConfirm={cleanUp} describeError={e => problem(e, 'action')}>
        <Field label={t('web.maintenance.olderThan')} keyboardType="number-pad" value={days} onChangeText={setDays} />
      </ConfirmSheet>
    </>
  );
}

/** Storage & backups › What Portico keeps: the rows whose keys the server names at run time. They save with the page. */
export function RetentionRows() {
  const t = useI18n().t;
  const maintenance = useServerForm<MaintenanceSettings, MaintenanceDocument>('maintenance');
  const logs = useServerForm<LogsDraft, LogSettings>('logs');
  const days = (n: number) => `${n} ${t('settings.unit.days')}`;
  const draft = maintenance.state.draft, doc = maintenance.state.status;
  return (
    <>
      {draft && doc ? retentionRows(Object.keys(draft.retention), key => doc.storageCategories.find(c => c.retentionKey === key)?.name, t).map(({key, label}) => {
        const max = doc.retentionMaxima[key] ?? 3650;
        return <TypedRow key={key} numeric title={label} value={String(draft.retention[key])} shown={days(draft.retention[key] ?? 0)}
          onDone={text => maintenance.form.set(d => ({...d, retention: {...d.retention, [key]: Math.min(max, Math.max(0, Number(text) || 0))}}))} />;
      }) : null}
      {logs.state.draft?.retention.map(r => (
        <TypedRow key={r.category} numeric title={t('settings.server.retention.logs', {category: t(`server.logCategory.${r.category}` as MessageId)})} value={String(r.days)} shown={days(r.days)}
          onDone={text => logs.form.set(d => ({retention: d.retention.map(x => (x.category === r.category ? {...x, days: Math.min(365, Math.max(1, Number(text) || 1))} : x))}))} />
      ))}
    </>
  );
}

const RESTORE_REFUSALS: Record<RestoreRefusalCode, MessageId> = {
  restore_source_invalid: 'web.maintenance.restoreSourceInvalid', restore_schema_newer: 'web.maintenance.restoreSchemaNewer', restore_pre_release: 'web.maintenance.restorePreRelease',
  restore_integrity_failed: 'web.maintenance.restoreIntegrityFailed', restore_not_portico: 'web.maintenance.restoreNotPortico', insufficient_disk: 'web.maintenance.restoreNoSpace', restore_lock_unavailable: 'web.maintenance.restoreLockUnavailable',
};
const backupKind = (kind: BackupKind): MessageId => (kind === 'scheduled' ? 'web.maintenance.backupKindScheduled' : kind === 'manual' ? 'web.maintenance.backupKindManual' : 'web.maintenance.backupKindPreRestore');

type RestoreTarget = {kind: 'backup'; backup: BackupSummary} | {kind: 'path'; path: string};

/** Storage & backups › Backups: plain database files, made on a schedule or now, restored after a plain confirmation. */
export function BackupsPanel() {
  const {api} = useSession();
  const serverId = useServerId();
  const t = useI18n().t;
  const {space} = useTheme();
  const platform = useSpecPlatform();
  const read = useRead(() => getBackups(api, serverId), [api, serverId], {on: BACKUP_MOVES});
  const [opIds] = useState(() => createOperationIds(operationId));
  const doc = read.data;
  const [message, setMessage] = useState<{tone: 'error' | 'success'; text: string}>();
  const [starting, setStarting] = useState(false);
  const [progress, setProgress] = useState<{phase: string; fraction: number | undefined}>();
  const [menu, setMenu] = useState<BackupSummary>();
  const [deleting, setDeleting] = useState<BackupSummary>();
  const [confirming, setConfirming] = useState<RestoreTarget>();
  const [restarting, setRestarting] = useState(false);
  const waiters = useRef<AbortController[]>([]);
  useEffect(() => () => { for (const c of waiters.current) c.abort(); waiters.current = []; }, []);
  const track = (c: AbortController) => { waiters.current.push(c); return c; };
  const refusal = (e: unknown, start: boolean): string => {
    const code = (e as {code?: string})?.code;
    if (typeof code === 'string' && isRestoreRefusalCode(code)) return t(code === 'insufficient_disk' && start ? 'web.maintenance.backupNoSpace' : RESTORE_REFUSALS[code]);
    return problem(e, 'action');
  };
  // While a backup runs, its phase and progress are read every two seconds until it ends.
  const watching = useRef(false);
  const running = doc?.running;
  useEffect(() => {
    if (!running || watching.current) return;
    watching.current = true;
    const ctl = track(new AbortController());
    setProgress({phase: running.phase, fraction: backupProgressFraction(running)});
    void waitForBackupCompletion(() => getBackups(api, serverId, ctl.signal), {signal: ctl.signal, onProgress: next => { if (next.running) setProgress({phase: next.running.phase, fraction: backupProgressFraction(next.running)}); }}).then(
      () => { watching.current = false; if (ctl.signal.aborted) return; setProgress(undefined); setMessage({tone: 'success', text: t('web.maintenance.backupComplete')}); read.reload(); },
      e => { watching.current = false; if (ctl.signal.aborted || isAuthenticationFailure(e)) return; setProgress(undefined); setMessage({tone: 'error', text: refusal(e, true)}); },
    );
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [api, serverId, running ? running.jobId : '']);
  const begin = () => {
    if (starting || doc?.running) return;
    setStarting(true); setMessage(undefined);
    startBackup(api, serverId, opIds.forPayload('start-backup')).then(() => { opIds.release(); read.reload(); }, e => { opIds.release(); if (!isAuthenticationFailure(e)) setMessage({tone: 'error', text: refusal(e, true)}); }).finally(() => setStarting(false));
  };
  const restore = async () => {
    const target = confirming;
    if (!target) return;
    const source = target.kind === 'backup' ? {backupId: target.backup.id} : {path: target.path};
    try { await restoreBackup(api, serverId, opIds.forPayload(JSON.stringify(source)), source); } finally { opIds.release(); }
    setConfirming(undefined); setRestarting(true);
    const ctl = track(new AbortController());
    void waitForServerAnswer(() => getBackups(api, serverId, ctl.signal), {signal: ctl.signal}).then(
      () => { if (!ctl.signal.aborted) { setRestarting(false); read.reload(); } },
      e => { if (ctl.signal.aborted) return; setRestarting(false); if (!isAuthenticationFailure(e)) setMessage({tone: 'error', text: refusal(e, false)}); },
    );
  };
  const busy = starting || !!progress || restarting;
  const last = doc?.lastRestore;
  return (
    <>
      {read.error ? <Notice tone={doc ? 'warning' : 'error'} message={read.error} action={t('action.tryAgain')} onAction={read.reload} /> : null}
      {message ? <Notice tone={message.tone} message={message.text} /> : null}
      {last ? <Notice tone={last.outcome === 'rolled_back' ? 'warning' : 'success'} message={last.outcome === 'rolled_back' ? [t('web.maintenance.restoreRolledBack'), last.reason].filter(Boolean).join(': ') : t('web.maintenance.restored')} /> : null}
      {restarting ? <Notice tone="info" title={t('web.maintenance.restartingTitle')} message={t('web.maintenance.restartingBody')} /> : null}
      <RowGroup title={t('web.maintenance.backups')} footer={t('web.maintenance.backupsLedePlain')}>
        {(starting || progress) ? <View style={{paddingHorizontal: rowPaddingX(platform), paddingVertical: space.md, gap: space.xs}}><ProgressBar value={progress?.fraction ?? 0} /></View> : null}
        {doc?.backups.map(b => <ListRow key={b.id} icon="storage" title={dateTime(b.createdAt)} subtitle={t('web.maintenance.backupDetails', {kind: t(backupKind(b.kind)), size: formatBytes(b.bytes), schema: b.schemaVersion, version: b.serverVersion || '—'})} accessory="menu" disabled={busy} onPress={() => setMenu(b)} />)}
        {doc && !doc.backups.length ? <ListRow title={t('web.maintenance.noBackups')} /> : null}
        <ListRow tone="action" icon="plus" title={starting || progress ? progress?.phase || t('web.maintenance.backingUp') : t('web.maintenance.backUpNow')} disabled={busy || !doc} onPress={begin} />
        <TypedRow title={t('web.maintenance.restoreFromFile')} help={t('web.maintenance.chooseBackupLede')} value="" placeholder="/path/to/portico.db" mono onDone={text => { const path = text.trim(); if (path) { setMessage(undefined); setConfirming({kind: 'path', path}); } }} />
      </RowGroup>
      <Menu open={!!menu} onClose={() => setMenu(undefined)} title={menu ? dateTime(menu.createdAt) : undefined} subtitle={menu?.path}
        items={[{id: 'restore', label: t('web.maintenance.restoreBackup'), icon: 'refresh'}, {id: 'delete', label: t('action.delete'), icon: 'trash', destructive: true}]}
        onSelect={id => { const b = menu; if (!b) return; setMessage(undefined); if (id === 'restore') setConfirming({kind: 'backup', backup: b}); else setDeleting(b); }} />
      <ConfirmSheet open={!!confirming} onDismiss={() => setConfirming(undefined)} tone="default" title={t(confirming?.kind === 'path' ? 'web.maintenance.restoreFileTitle' : 'web.maintenance.restoreTitle')} consequence={[confirming?.kind === 'backup' ? dateTime(confirming.backup.createdAt) : confirming?.path, t('web.maintenance.restoreBody')].filter(Boolean).join('\n\n')} confirmLabel={t('web.maintenance.restoreConfirm')} onConfirm={restore} describeError={e => refusal(e, false)} />
      <ConfirmSheet open={!!deleting} onDismiss={() => setDeleting(undefined)} title={t('web.maintenance.deleteBackupTitle')} consequence={t('web.maintenance.deleteBackupBody', {id: deleting?.id ?? ''})} confirmLabel={t('web.maintenance.deleteBackupConfirm')} confirmToken={deleting?.id}
        onConfirm={async () => { if (!deleting) return; await deleteBackup(api, serverId, deleting.id); setDeleting(undefined); read.reload(); }} describeError={e => problem(e, 'action')} />
    </>
  );
}

/**
 * Storage & backups › Missing titles: titles whose files are no longer on disk. They stay in the
 * library until the owner's rule (the rows above this list) removes them; "Remove them now" does
 * it at once. Nothing on disk is touched and watch history is kept.
 */
export function MissingTitlesPanel() {
  const {api} = useSession();
  const i18n = useI18n();
  const t = i18n.t;
  // Every page says how many titles are missing in all; that number is what the owner types to remove them.
  const [total, setTotal] = useState(0);
  const read = usePagedList(async cursor => { const page = await listMissingTitles(api, {cursor: cursor || undefined, limit: 100}); setTotal(page.total); return {items: [...page.items], nextCursor: page.nextCursor ?? ''}; }, [api], {on: MISSING_MOVES});
  const [asking, setAsking] = useState(false);
  const [removed, setRemoved] = useState<number>();
  const when = (iso: string) => (iso ? i18n.dateTime(iso) : '—');
  const empty = async () => {
    const out = await emptyMissingTitles(api);
    setRemoved(out.titles); setAsking(false);
    read.reload();
  };
  return (
    <>
      {read.error ? <Notice tone={read.items ? 'warning' : 'error'} message={read.error} action={t('action.tryAgain')} onAction={read.reload} /> : null}
      {removed !== undefined ? <Notice tone="success" message={t('web.missingTitles.removed', {count: removed})} /> : null}
      {read.items ? (
        <RowGroup title={total ? t('web.missingTitles.count', {count: total}) : undefined}>
          {read.items.map(entry => (
            <ListRow key={entry.id} readable icon="film" title={entry.parentTitle ? `${entry.parentTitle} · ${entry.title}` : entry.title} subtitleLines={2}
              subtitle={entry.removedAt ? t('web.missingTitles.sinceRemoved', {when: when(entry.missingSince), removes: when(entry.removedAt)}) : t('web.missingTitles.since', {when: when(entry.missingSince)})} />
          ))}
          {!read.items.length ? <ListRow readable title={t('web.missingTitles.none')} /> : null}
          {read.more ? <ListRow tone="action" title={t('server.showMore')} disabled={read.loading} onPress={read.loadMore} /> : null}
          {total ? <ListRow tone="destructive" title={t('web.missingTitles.removeNow')} onPress={() => { setRemoved(undefined); setAsking(true); }} /> : null}
        </RowGroup>
      ) : null}
      <ConfirmSheet open={asking} onDismiss={() => setAsking(false)} title={t('web.missingTitles.removeTitle')} consequence={t('web.missingTitles.removeBody', {count: total})} confirmLabel={t('web.missingTitles.removeConfirm')} confirmToken={String(total)} onConfirm={empty} describeError={e => problem(e, 'action')} />
    </>
  );
}

/** Storage & backups › Remote sources: WebDAV shares and rclone remotes attached to the server. */
export function RemoteSourcesPanel() {
  const {api, session} = useSession();
  const i18n = useI18n();
  const t = i18n.t;
  const {viewerId, serverId} = viewerScope(session, api);
  const [mountIds] = useState(stableStorageOperationId);
  const [davIds] = useState(stableStorageOperationId);
  const mounts = useService<StorageManagementService, StorageManagementSnapshot>(() => new StorageManagementService({api, scope: {viewerId, serverId}, operationId: mountIds.next}), [api, viewerId, serverId]);
  const dav = useService<RemoteSourceService, ReturnType<RemoteSourceService['getSnapshot']>>(() => new RemoteSourceService(api, {viewerId, serverId}, davIds.next), [api, viewerId, serverId]);
  useEffect(() => { void mounts.service.load().catch(() => {}); void dav.service.load().catch(() => {}); }, [mounts.service, dav.service]);
  const action = useAction();
  const [adding, setAdding] = useState(false);
  const [form, setForm] = useState<{kind: 'webdav'; source: RemoteSource | null} | {kind: 'rclone'}>();
  const [menu, setMenu] = useState<{kind: 'mount'; mount: StorageMount} | {kind: 'webdav'; source: RemoteSource}>();
  const [remove, setRemove] = useState<typeof menu>();
  const runMount = (work: () => Promise<unknown>) => action.run(async () => {
    try { await work(); } finally { const phase = mounts.service.getSnapshot().mutation.phase; if (phase !== 'ambiguous' && phase !== 'pending' && phase !== 'preparing' && phase !== 'recovering') mountIds.release(); }
    const mutation = mounts.service.getSnapshot().mutation;
    if (!mountCommandSucceeded(mutation)) throw Object.assign(new Error('request_failed'), {code: mutation.error?.code ?? 'request_failed'});
  });
  const runDav = (work: () => Promise<unknown>) => action.run(async () => {
    try { await work(); } finally { if (!dav.service.getSnapshot().ambiguous) davIds.release(); }
    if (!davCommandSucceeded(dav.service.getSnapshot())) throw Object.assign(new Error('request_failed'), {code: 'request_failed'});
  });
  const m = mounts.snapshot, d = dav.snapshot;
  const list = m.data?.mounts ?? [];
  const davs = d.sources.filter(x => x.kind === 'webdav');
  const mountItems = (x: StorageMount): MenuItem[] => [
    ...(x.actions.includes('start') ? [{id: 'start', label: t('web.storage.mount'), icon: 'play'} as MenuItem] : []),
    ...(x.actions.includes('stop') ? [{id: 'stop', label: t('web.storage.unmount'), icon: 'stop'} as MenuItem] : []),
    ...(x.actions.includes('restart') ? [{id: 'restart', label: t('web.storage.restart'), icon: 'refresh'} as MenuItem] : []),
    ...(x.actions.includes('delete') ? [{id: 'delete', label: t('action.removeShort'), icon: 'trash', destructive: true} as MenuItem] : []),
  ];
  return (
    <>
      {m.error ? <Notice tone="error" message={problem(m.error)} action={t('action.tryAgain')} onAction={() => void mounts.service.load()} /> : null}
      {d.error ? <Notice tone="error" message={d.error} action={t('action.tryAgain')} onAction={() => void dav.service.load()} /> : null}
      {m.mutation.phase === 'ambiguous' ? <Notice tone="warning" message={t('web.storage.mountAmbiguous')} action={t('web.storage.checkResult')} onAction={() => void mounts.service.recover().catch(() => {})} /> : null}
      {d.ambiguous ? <Notice tone="warning" message={t('web.storage.davAmbiguous')} action={t('web.storage.checkResult')} onAction={() => void dav.service.recover().catch(() => {})} /> : null}
      {action.error ? <Notice tone="error" message={action.error} /> : null}
      <RowGroup title={t('settings.server.remoteSources')} footer={t('web.storage.libraryFolders')}>
        {davs.map(x => <ListRow key={x.id} icon="globe" title={x.name} meta={sentence(x.errorCode || x.state)} subtitle={[x.origin, x.rootPath, x.insecureLocal ? t('server.storage.unencrypted') : undefined, x.credentialPresent ? t('server.storage.passwordSaved') : undefined].filter(Boolean).join(' · ')} accessory="menu" onPress={() => setMenu({kind: 'webdav', source: x})} />)}
        {list.map(x => <ListRow key={x.id} icon="storage" title={x.name} meta={sentence(x.observedState)} subtitle={[x.mountPath, x.cacheBytes ? formatBytes(x.cacheBytes) : undefined, x.error, x.removalPending ? t('server.storage.removalPending') : undefined].filter(Boolean).join(' · ')} {...(mountItems(x).length ? {accessory: 'menu' as const, onPress: () => setMenu({kind: 'mount', mount: x})} : {})} />)}
        {m.data && !list.length && !davs.length && !d.loading ? <ListRow title={t('web.storage.empty')} subtitle={t('web.storage.emptyHelp')} /> : null}
        <ListRow tone="action" icon="plus" title={t('web.storage.addSource')} onPress={() => setAdding(true)} />
      </RowGroup>
      <Menu open={adding} onClose={() => setAdding(false)} title={t('web.storage.addSource')} items={[{id: 'webdav', label: t('web.storage.webdavShare'), detail: t('web.storage.webdavMeta'), icon: 'globe'}, {id: 'rclone', label: t('web.storage.rcloneRemote'), detail: t('web.storage.rcloneMeta'), icon: 'storage'}]} onSelect={id => { action.clear(); setForm(id === 'webdav' ? {kind: 'webdav', source: null} : {kind: 'rclone'}); }} />
      <Menu open={!!menu} onClose={() => setMenu(undefined)} title={menu?.kind === 'mount' ? menu.mount.name : menu?.source.name}
        items={menu?.kind === 'mount' ? mountItems(menu.mount) : [{id: 'edit', label: t('web.storage.editConnection'), icon: 'edit'}, {id: 'delete', label: t('action.removeShort'), icon: 'trash', destructive: true}]}
        onSelect={id => { const x = menu; if (!x) return; action.clear(); if (id === 'delete') setRemove(x); else if (x.kind === 'webdav') setForm({kind: 'webdav', source: x.source}); else void runMount(() => mounts.service.act(x.mount.id, id as 'start' | 'stop' | 'restart', x.mount.controlRevision)); }} />
      <WebDavSheet open={form?.kind === 'webdav'} source={form?.kind === 'webdav' ? form.source : null} busy={d.busy || action.busy} error={action.error} onClose={() => setForm(undefined)} onSave={draft => { const source = form?.kind === 'webdav' ? form.source : null; void runDav(() => dav.service.configure(source?.id ?? null, davConfiguration(source, draft))).then(ok => { if (ok) setForm(undefined); }); }} />
      <RcloneSheet open={form?.kind === 'rclone'} busy={action.busy} error={action.error} onClose={() => setForm(undefined)} onSave={input => void runMount(() => mounts.service.create(input)).then(ok => { if (ok) setForm(undefined); })} />
      <ConfirmSheet open={!!remove} onDismiss={() => setRemove(undefined)} title={t('web.storage.removeMountTitle', {name: remove?.kind === 'mount' ? remove.mount.name : remove?.source.name ?? ''})} consequence={remove?.kind === 'mount' ? t('web.storage.removeMountBody') : t('web.storage.removeSourceBody')} confirmLabel={t('action.removeShort')}
        onConfirm={async () => { const x = remove; if (!x) return; const ok = await (x.kind === 'mount' ? runMount(() => mounts.service.remove(x.mount.id, x.mount.controlRevision)) : runDav(() => dav.service.remove(x.source))); if (ok) setRemove(undefined); }} />
    </>
  );
}

function WebDavSheet({open, source, busy, error, onClose, onSave}: {open: boolean; source: RemoteSource | null; busy: boolean; error?: string; onClose: () => void; onSave: (draft: WebDavDraft) => void}) {
  const t = useI18n().t;
  const {space} = useTheme();
  const [draft, setDraft] = useState<WebDavDraft>({name: '', root: '', username: '', password: '', insecureLocal: false});
  // The address starts empty on edit too: empty keeps the current connection, typing replaces it.
  useEffect(() => { if (open) setDraft({name: source?.name ?? '', root: '', username: '', password: '', insecureLocal: source?.insecureLocal ?? false}); }, [open, source]);
  return (
    <Sheet open={open} onClose={onClose} kind="form" title={source ? t('web.storage.editDav') : t('web.storage.addDav')} subtitle={t('web.storage.davPasswordKept')} primary={{label: source ? t('action.save') : t('web.storage.addShare'), loading: busy, disabled: !draft.name.trim() || (!source && !draft.root.trim()), onPress: () => onSave(draft)}}>
      <View style={{gap: space.md}}>
        {error ? <Notice tone="error" message={error} /> : null}
        <Field label={t('profile.name')} value={draft.name} onChangeText={name => setDraft({...draft, name})} maxLength={100} />
        <Field label={t('web.claim.address')} value={draft.root} onChangeText={root => setDraft({...draft, root})} placeholder="https://cloud.example.com/dav/Media" autoCapitalize="none" autoCorrect={false} keyboardType="url" hint={source && !draft.root.trim() && source.origin ? t('web.storage.webdavKeepConnection', {origin: source.origin}) : undefined} />
        <Field label={t('web.direct.username')} value={draft.username} onChangeText={username => setDraft({...draft, username})} autoCapitalize="none" autoCorrect={false} />
        <Field label={t('web.account.password')} secure value={draft.password} onChangeText={password => setDraft({...draft, password})} hint={source?.credentialPresent ? t('web.storage.keepSavedPassword') : undefined} />
        <RowGroup><ToggleRow title={t('web.storage.insecureLocal')} subtitle={t('web.storage.insecureLocalHelp')} value={draft.insecureLocal} onChange={insecureLocal => setDraft({...draft, insecureLocal})} /></RowGroup>
      </View>
    </Sheet>
  );
}

function RcloneSheet({open, busy, error, onClose, onSave}: {open: boolean; busy: boolean; error?: string; onClose: () => void; onSave: (input: {name: string; executable: string; remote: string; config: string}) => void}) {
  const t = useI18n().t;
  const {space} = useTheme();
  const [draft, setDraft] = useState({name: '', executable: '/usr/bin/rclone', remote: '', config: ''});
  useEffect(() => { if (open) setDraft(d => ({...d, name: '', remote: '', config: ''})); }, [open]);
  return (
    <Sheet open={open} onClose={onClose} kind="form" title={t('web.storage.addRclone')} subtitle={t('web.storage.rcloneLede')} primary={{label: t('web.storage.addRemote'), loading: busy, disabled: !draft.name.trim() || !draft.remote.trim() || !draft.config.trim(), onPress: () => onSave(draft)}}>
      <View style={{gap: space.md}}>
        {error ? <Notice tone="error" message={error} /> : null}
        <Field label={t('profile.name')} value={draft.name} onChangeText={name => setDraft({...draft, name})} maxLength={100} />
        <Field label={t('web.storage.rcloneBinary')} value={draft.executable} onChangeText={executable => setDraft({...draft, executable})} autoCapitalize="none" autoCorrect={false} />
        <Field label={t('web.storage.rcloneRemoteName')} value={draft.remote} onChangeText={remote => setDraft({...draft, remote})} placeholder="drive:Media" autoCapitalize="none" autoCorrect={false} hint={t('web.storage.rcloneRemoteHelp')} />
        <Field label={t('web.storage.rcloneConfig')} value={draft.config} onChangeText={config => setDraft({...draft, config})} placeholder={t('web.storage.rcloneConfigExample')} multiline autoCapitalize="none" autoCorrect={false} hint={t('web.storage.rcloneConfigHelp')} />
      </View>
    </Sheet>
  );
}

