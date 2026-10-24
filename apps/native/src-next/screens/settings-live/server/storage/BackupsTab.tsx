import React, {useEffect, useState} from 'react';
import {Text, View} from 'react-native';
import type {BackupSummary, BackupsDocument, BackupKind} from '../../../../../../../packages/client-core/src/administration';
import {backupProgressFraction} from '../../../../../../../packages/client-core/src/administration';
import {deleteBackup, getBackups, restoreBackup, restartServer, startBackup, waitForBackupCompletion, waitForServerAnswer} from '../../../../../../../packages/client-core/src/backups';
import {presentError} from '../../../../../../../packages/client-core/src/presentation/errors';
import {when} from '../../../../../../../packages/client-core/src/server-admin/console-words';
import type {MessageId} from '../../../../../../../packages/i18n/src';
import {defaultI18n} from '../../../../../../../packages/i18n/src';
import {Button} from '../../../kit/controls/Button';
import {TextField} from '../../../kit/controls/TextField';
import {BottomSheet} from '../../../kit/overlays/BottomSheet';
import {Menu, type MenuEntry} from '../../../kit/overlays';
import {StateView} from '../../../kit/states';
import {shellType} from '../../../kit/shell/visual';
import {useTheme} from '../../../kit/theme';
import type {NativeSettingsLivePorts} from '../../ports';
import type {NativeShellRuntime} from '../../../shell/runtime';

type Translate = typeof defaultI18n.t;
const kindWord = (kind: BackupKind): MessageId => kind === 'scheduled' ? 'web.maintenance.backupKindScheduled' : kind === 'manual' ? 'web.maintenance.backupKindManual' : 'web.maintenance.backupKindPreRestore';

/** Settings › Server › Storage & backups › Backups (owner-server.html frame 35b). */
export function BackupsTab({ports, runtime, t}: {ports: NativeSettingsLivePorts; runtime: NativeShellRuntime; t: Translate}) {
  const theme = useTheme(), context = ports.context, authority = context.authority();
  const api = {request: <T,>(path: string, method?: string, body?: unknown, signal?: AbortSignal) => context.api.request<T>(path, method, body, signal)};
  const [doc, setDoc] = useState<BackupsDocument>(), [error, setError] = useState<unknown>(), [busy, setBusy] = useState(false), [problem, setProblem] = useState<string>();
  const [menu, setMenu] = useState<BackupSummary>(), [restore, setRestore] = useState<BackupSummary | 'path'>(), [deleteTarget, setDeleteTarget] = useState<BackupSummary>(), [typed, setTyped] = useState(''), [path, setPath] = useState('');
  const refresh = () => {void getBackups(api, authority.serverId).then(setDoc, setError);};
  useEffect(() => {refresh(); return () => {};}, [context]);
  const run = (work: () => Promise<unknown>) => {
    setBusy(true); setProblem(undefined);
    void work().then(() => {setBusy(false); refresh();}, (failure: unknown) => {setBusy(false); setProblem(presentError(failure, 'server-console').body);});
  };
  const backUpNow = () => run(async () => {
    const jobId = await startBackup(api, authority.serverId, ports.requestId());
    setDoc(await waitForBackupCompletion(() => getBackups(api, authority.serverId), {expectedJobId: jobId, onProgress: setDoc}));
  });
  const doRestore = (source: {backupId: string} | {path: string}) => run(async () => {
    await restoreBackup(api, authority.serverId, ports.requestId(), source);
    await restartServer(api);
    setDoc(await waitForServerAnswer(() => getBackups(api, authority.serverId)));
    setRestore(undefined);
  });
  const doDelete = () => {
    const target = deleteTarget;
    if (!target) return;
    run(async () => {await deleteBackup(api, authority.serverId, target.id); setDeleteTarget(undefined); setMenu(undefined);});
  };
  const running = doc?.running, fraction = running ? backupProgressFraction(running) : undefined;
  const items = doc?.backups ?? [];
  const restoreTarget = restore === 'path' ? undefined : restore;
  const confirmRestore = () => {if (restore === 'path') doRestore({path: path.trim()}); else if (restoreTarget) doRestore({backupId: restoreTarget.id});};
  const entries = (backup: BackupSummary): readonly MenuEntry[] => [
    {id: 'restore', label: t('web.maintenance.restoreBackup'), icon: 'i-restart', onSelect: () => {setRestore(backup); setMenu(undefined);}},
    {id: 'delete', label: t('action.delete'), icon: 'i-trash', destructive: true, onSelect: () => {setTyped(''); setDeleteTarget(backup); setMenu(undefined);}},
  ];
  if (error !== undefined && !doc) return <StateView {...runtime.error(error, refresh)}/>;
  return <View style={{marginTop: 14}} testID="server-storage-backups">
    <Text style={[shellType(17, 800), {color: theme.colors.text}]}>{t('web.maintenance.backups')}</Text>
    <Text style={[shellType(13, 400, 18), {color: theme.colors.textSecondary, marginTop: 4}]}>{t('web.maintenance.backupsLedePlain')}</Text>
    {problem ? <Text accessibilityRole="alert" style={[shellType(13, 600), {color: theme.colors.record, marginTop: 8}]}>{problem}</Text> : null}
    {running ? <View style={{marginTop: 12, padding: 14, borderRadius: 14, backgroundColor: theme.colors.raised}}>
      <Text style={[shellType(14, 700), {color: theme.colors.text}]}>{t('web.maintenance.backingUp')}{fraction === undefined ? '' : ` ${Math.round(fraction * 100)}%`}</Text>
      <Text style={[shellType(12.5, 500), {color: theme.colors.textTertiary, marginTop: 2}]}>{running.phase}</Text>
      <View style={{height: 6, borderRadius: 3, marginTop: 8, backgroundColor: theme.colors.line}}>
        <View style={{height: 6, borderRadius: 3, width: `${Math.round((fraction ?? 0) * 100)}%`, backgroundColor: theme.colors.accentStrong}}/>
      </View>
    </View> : null}
    <View style={{flexDirection: 'row', marginTop: 12}}>
      <Button size="compact" icon="i-refresh" loading={busy} disabled={Boolean(running)} onPress={backUpNow}>{t('web.maintenance.backUpNow')}</Button>
    </View>
    <View style={{marginTop: 12, borderRadius: 14, overflow: 'hidden', backgroundColor: theme.colors.raised}}>
      {!busy && !items.length ? <Text style={[shellType(13, 500), {color: theme.colors.textTertiary, padding: 14}]}>{t('web.maintenance.noBackups')}</Text> : null}
      {items.map((backup, index) => <Button key={backup.id} variant="text" size="compact" onPress={() => setMenu(backup)}
        style={{alignItems: 'flex-start', minHeight: 0, paddingHorizontal: 14, paddingVertical: 11, borderTopWidth: index ? 1 : 0, borderTopColor: theme.colors.lineSoft}}>
        <View style={{flex: 1, minWidth: 0}}>
          <Text numberOfLines={1} style={[shellType(15, 700), {color: theme.colors.text}]}>{when(Date.parse(backup.createdAt))}</Text>
          <Text numberOfLines={2} style={[shellType(12.5, 500, 17), {color: theme.colors.textTertiary, marginTop: 2}]}>{t('web.maintenance.backupDetails', {kind: t(kindWord(backup.kind)), size: defaultI18n.bytes(backup.bytes), schema: backup.schemaVersion, version: backup.serverVersion})}</Text>
          <Text numberOfLines={1} style={[shellType(11.5, 400), {color: theme.colors.textTertiary, marginTop: 2}]}>{backup.path}</Text>
        </View>
      </Button>)}
    </View>
    <View style={{flexDirection: 'row', marginTop: 12}}>
      <Button size="compact" variant="glass" icon="i-folder" onPress={() => {setPath(''); setRestore('path');}}>{t('web.maintenance.restoreFromFile')}</Button>
    </View>
    <Text style={[shellType(12, 400, 17), {color: theme.colors.textTertiary, marginTop: 10}]}>{t('web.maintenance.backupsOpenFiles')}</Text>
    <Menu open={Boolean(menu)} onOpenChange={open => {if (!open) setMenu(undefined);}} presentation="sheet" testID="server-backup-menu" title={menu ? when(Date.parse(menu.createdAt)) : undefined} items={menu ? entries(menu) : []}/>
    <BottomSheet open={Boolean(restore)} onOpenChange={open => {if (!open && !busy) setRestore(undefined);}} testID="server-backup-restore" keyboardAvoiding
      title={restore === 'path' ? t('web.maintenance.restoreFileTitle') : t('web.maintenance.restoreTitle')}
      description={t('web.maintenance.restoreBody')}
      footer={<View style={{flexDirection: 'row', gap: 8}}><Button variant="glass" disabled={busy} onPress={() => setRestore(undefined)}>{t('action.cancel')}</Button>
        <Button loading={busy} disabled={restore === 'path' && !path.trim()} onPress={confirmRestore}>{t('web.maintenance.restoreConfirm')}</Button></View>}>
      {restore === 'path' ? <TextField label={t('web.maintenance.chooseBackupLede')} value={path} onChangeText={setPath} autoCapitalize="none" autoCorrect={false}/> : <Text style={[shellType(14, 600), {color: theme.colors.text}]}>{restoreTarget ? when(Date.parse(restoreTarget.createdAt)) : ''}</Text>}
    </BottomSheet>
    <BottomSheet open={Boolean(deleteTarget)} onOpenChange={open => {if (!open && !busy) setDeleteTarget(undefined);}} testID="server-backup-delete" keyboardAvoiding
      title={t('web.maintenance.deleteBackupTitle')} description={t('web.maintenance.deleteBackupBody', {id: 'delete'})}
      footer={<View style={{flexDirection: 'row', gap: 8}}><Button variant="glass" disabled={busy} onPress={() => setDeleteTarget(undefined)}>{t('action.cancel')}</Button>
        <Button variant="glass" textStyle={{color: theme.colors.record}} loading={busy} disabled={typed.trim() !== 'delete'} onPress={doDelete}>{t('web.maintenance.deleteBackupConfirm')}</Button></View>}>
      <TextField label={t('confirm.typeToConfirm', {token: 'delete'})} value={typed} onChangeText={setTyped} autoCapitalize="none" autoCorrect={false}/>
    </BottomSheet>
  </View>;
}
