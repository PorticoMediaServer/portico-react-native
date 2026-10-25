import React, {useEffect, useLayoutEffect, useMemo, useState, useSyncExternalStore} from 'react';
import {Text, View} from 'react-native';
import {SettingsBackupSource, type SettingsRestoreSelection} from '../../../../../../../packages/client-core/src/server-admin/backup-source';
import {isAuthenticationFailure} from '../../../../../../../packages/client-core/src/backups';
import {backupProgressFraction, type BackupSummary, type RestoreSource} from '../../../../../../../packages/client-core/src/administration';
import {when} from '../../../../../../../packages/client-core/src/server-admin/console-words';
import {defaultI18n} from '../../../../../../../packages/i18n/src';
import {Button, TextField} from '../../../../kit/controls';
import {BottomSheet} from '../../../../kit/overlays';
import {shellType} from '../../../../kit/shell/visual';
import {useTheme} from '../../../../kit/theme';
import type {NativeShellBootstrapContext} from '../../../../shell/bootstrap';
import type {NativeSettingsLivePorts} from '../../ports';
import type {NativeShellRuntime} from '../../../../shell/runtime';
import {NativeScreenLifetime, screenScopeEnded} from '../../lifetime';
import {nativeStorageOwner} from './space-source';

type Translate = typeof defaultI18n.t;
function createBackups(context: NativeShellBootstrapContext, operationId: () => string, reportError: NativeShellRuntime['reportError']) {
  const lifetime = new NativeScreenLifetime(context), listeners = new Set<() => void>();
  const current = () => lifetime.current() && nativeStorageOwner(context);
  const api = {request: <T,>(path: string, method?: string, body?: unknown, caller?: AbortSignal): Promise<T> => current()
    ? lifetime.request(signal => context.api.request<T>(path, method, body, signal), caller) : Promise.reject(screenScopeEnded())};
  const source = new SettingsBackupSource(api, context.authority().serverId, current, () => {for (const listener of listeners) listener();}, operationId);
  return {context, source, current, backupSubmitted: false, removeUncertain: false,
    subscribe: (listener: () => void) => {listeners.add(listener);return () => {listeners.delete(listener);};},
    failure: (error: unknown) => {if (isAuthenticationFailure(error)) {source.dispose();lifetime.dispose();reportError(error);}},
    dispose: () => {source.dispose();lifetime.dispose();listeners.clear();}};
}
type Group = ReturnType<typeof createBackups>;
type Dialog = {abort: AbortController; source: RestoreSource; listed?: BackupSummary; selection?: SettingsRestoreSelection; submitted?: boolean};

/** The page owns the original operation and candidate across all restore steps. */
export function BackupsTab({ports, runtime, t}: {ports: NativeSettingsLivePorts; runtime: NativeShellRuntime; t: Translate}) {
  const [group, setGroup] = useState<Group>(), context = ports.context, operationId = ports.requestId, reportError = runtime.reportError;
  useLayoutEffect(() => {const next = createBackups(context, operationId, reportError);setGroup(next);return next.dispose;}, [context, operationId, reportError]);
  return group?.context === context ? <Backups group={group} t={t}/> : null;
}
function Backups({group, t}: {group: Group; t: Translate}) {
  const theme = useTheme(), {source} = group;
  const state = useSyncExternalStore(group.subscribe, source.getSnapshot, source.getSnapshot);
  const [dialog, setDialog] = useState<Dialog>(), [remove, setRemove] = useState<Dialog>(), [path, setPath] = useState(''), [typed, setTyped] = useState(''), [passphrase, setPassphrase] = useState(''), [problem, setProblem] = useState(false), [uncertain, setUncertain] = useState(false);
  const [, redraw] = useState(0);
  const view = useMemo(() => ({source, active: true, dialog: undefined as Dialog | undefined, remove: undefined as Dialog | undefined, flight: undefined as object | undefined}), [source]);
  useLayoutEffect(() => {view.active = true;return () => {view.active = false;view.dialog?.abort.abort();view.remove?.abort.abort();view.dialog = undefined;view.remove = undefined;view.flight = undefined;};}, [view]);
  const current = () => view.active && view.source === source && group.current();
  const load = () => {if (!current()) return;void source.load().then(() => {if (current()) {group.removeUncertain = false;setProblem(false);redraw(value => value + 1);}}, error => {group.failure(error);if (current()) setProblem(true);});};
  useEffect(() => {void source.load().catch(error => {group.failure(error);if (view.active && group.current()) setProblem(true);});}, [source, group, view]);
  const listed = (value: Dialog) => !value.listed || !!source.getSnapshot().document?.backups.includes(value.listed);
  const held = dialog && view.dialog === dialog && !dialog.abort.signal.aborted && current() && listed(dialog) ? dialog : undefined;
  const heldRemove = remove && view.remove === remove && !remove.abort.signal.aborted && current() && listed(remove) ? remove : undefined;
  const close = () => {const captured = view.dialog;view.dialog = undefined;captured?.abort.abort();if (captured?.selection) source.cancelRestoreSelection(captured.selection);setDialog(undefined);setPassphrase('');};
  const closeRemove = () => {view.remove?.abort.abort();view.remove = undefined;setRemove(undefined);setTyped('');};
  const open = (backup?: BackupSummary) => {
    if (!current() || view.flight || state.busy || backup && !source.getSnapshot().document?.backups.includes(backup)) return;
    close();const next: Dialog = {abort: new AbortController(), source: backup ? {backupId: backup.id} : {path: ''}, ...(backup ? {listed: backup} : {})};view.dialog = next;setDialog(next);setPath('');setProblem(false);
  };
  const confirm = async () => {
    const captured = held;if (!captured || view.flight || !current() || view.dialog !== captured || !listed(captured)) return;
    const flight = {};view.flight = flight;setProblem(false);
    const active = () => current() && view.flight === flight && view.dialog === captured && !captured.abort.signal.aborted && listed(captured);
    try {
      if (!captured.selection) {
        const selected = captured.listed ? captured.source : {path: path.trim()};if ('path' in selected && !selected.path) return;
        const selection = await source.prepareRestore(selected, captured.abort.signal);
        if (!active()) {source.cancelRestoreSelection(selection);return;}
        captured.selection = selection;redraw(value => value + 1);
        // Keep the same parent-owned dialog and signal for encrypted input.
        if (selection.encrypted) return;
      }
      if (!active() || !captured.selection?.isCurrent()) return;
      const secret = captured.selection.encrypted ? passphrase : undefined;setPassphrase('');
      if (captured.selection.encrypted && !secret) return;
      const result = await source.restore(captured.selection, secret, captured.abort.signal);
      if (active() && result) close();
    } catch (error) {group.failure(error);if (active()) setProblem(true);} finally {if (view.flight === flight) view.flight = undefined;}
  };
  const start = async () => {
    if (!current() || view.flight || group.backupSubmitted || source.getSnapshot().busy || !state.document || state.document.running || state.document.restore) return;
    const flight = {};view.flight = flight;group.backupSubmitted = true;setProblem(false);
    try {if (await source.backupNow()) group.backupSubmitted = false;} catch (error) {group.failure(error);if (current()) {setProblem(true);setUncertain(true);}} finally {if (view.flight === flight) view.flight = undefined;}
  };
  const erase = async () => {
    const captured = heldRemove;if (!captured?.listed || captured.submitted || group.removeUncertain || typed.trim() !== 'delete' || !current() || view.remove !== captured || view.flight || !listed(captured)) return;
    const flight = {};view.flight = flight;captured.submitted = true;group.removeUncertain = true;setProblem(false);
    try {const done = await source.remove(captured.listed.id, captured.abort.signal);if (done && current() && view.remove === captured) {group.removeUncertain = false;closeRemove();}} catch (error) {group.failure(error);if (current() && view.remove === captured) setProblem(true);} finally {if (view.flight === flight) view.flight = undefined;}
  };
  const running = state.document?.running, fraction = running ? backupProgressFraction(running) : undefined;
  return <View style={{marginTop:22,gap:12}} testID="server-storage-backups">
    <Text style={[shellType(17,800),{color:theme.colors.text}]}>{t('web.maintenance.backups')}</Text>
    <Text style={[shellType(13,400,18),{color:theme.colors.textSecondary}]}>{t('web.maintenance.backupsLedePlain')}</Text>
    {problem && <Text accessibilityRole="alert" style={{color:theme.colors.record}}>{t(uncertain ? 'error.unconfirmedChange' : 'error.unavailable')}</Text>}
    {running && <Text style={{color:theme.colors.textSecondary}}>{t('web.maintenance.backingUp')}{fraction === undefined ? '' : ` ${Math.round(fraction * 100)}%`}</Text>}
    {state.restorePhase && <Text style={{color:theme.colors.textSecondary}}>{t(state.restorePhase === 'restarting' ? 'web.maintenance.restartingTitle' : 'web.maintenance.restoreTitle')}</Text>}
    <View style={{flexDirection:'row',gap:8}}><Button size="compact" disabled={state.busy || group.backupSubmitted || !state.document || !!running || !!state.document.restore} onPress={() => {void start();}}>{t('web.maintenance.backUpNow')}</Button><Button size="compact" variant="glass" disabled={state.busy} onPress={load}>{t('action.tryAgain')}</Button></View>
    {state.document?.backups.length === 0 && <Text style={{color:theme.colors.textSecondary}}>{t('web.maintenance.noBackups')}</Text>}
    {state.document?.backups.map(backup => <View key={backup.id} style={{padding:12,gap:8,borderRadius:12,backgroundColor:theme.colors.raised}}><Text style={[shellType(15,700),{color:theme.colors.text}]}>{when(Date.parse(backup.createdAt))}</Text><Text style={{color:theme.colors.textSecondary}}>{defaultI18n.bytes(backup.bytes)}</Text><View style={{flexDirection:'row',gap:8}}><Button size="compact" variant="glass" disabled={state.busy} onPress={() => open(backup)}>{t('web.maintenance.restoreBackup')}</Button><Button size="compact" variant="glass" disabled={state.busy || group.removeUncertain} onPress={() => {if (!current() || view.flight || group.removeUncertain || !source.getSnapshot().document?.backups.includes(backup)) return;closeRemove();const next: Dialog = {abort:new AbortController(),source:{backupId:backup.id},listed:backup};view.remove = next;setRemove(next);setProblem(false);}}>{t('action.delete')}</Button></View></View>)}
    <Button variant="glass" size="compact" disabled={state.busy} onPress={() => open()}>{t('web.maintenance.restoreFromFile')}</Button>
    <BottomSheet open={!!held} onOpenChange={value => {if (!value) close();}} title={t('web.maintenance.restoreTitle')} description={t('web.maintenance.restoreBody')} footer={<View style={{flexDirection:'row',gap:8}}><Button variant="glass" onPress={close}>{t('action.cancel')}</Button><Button disabled={state.busy || !!held?.selection?.encrypted && !passphrase || !held?.listed && !held?.selection && !path.trim()} loading={state.busy} onPress={() => {void confirm();}}>{t('web.maintenance.restoreConfirm')}</Button></View>}>
      <View style={{gap:12}}>{held?.listed && <Text style={{color:theme.colors.text}}>{when(Date.parse(held.listed.createdAt))}</Text>}{held && !held.listed && !held.selection && <TextField label={t('web.maintenance.chooseBackupLede')} value={path} editable={!state.busy} onChangeText={value => {if (current() && view.dialog === held && !view.flight) setPath(value);}} autoCapitalize="none" autoCorrect={false}/>} {held?.selection?.encrypted && <TextField label={t('next.settings.backup.passphrase')} value={passphrase} secureTextEntry editable={!state.busy} onChangeText={value => {if (current() && view.dialog === held && !view.flight) setPassphrase(value);}} autoCapitalize="none" autoCorrect={false}/>}</View>
    </BottomSheet>
    <BottomSheet open={!!heldRemove} onOpenChange={value => {if (!value) closeRemove();}} title={t('web.maintenance.deleteBackupTitle')} description={t('web.maintenance.deleteBackupBody',{id:'delete'})} footer={<View style={{flexDirection:'row',gap:8}}><Button variant="glass" onPress={closeRemove}>{t('action.cancel')}</Button><Button disabled={state.busy || !!heldRemove?.submitted || group.removeUncertain || typed.trim() !== 'delete'} loading={state.busy} onPress={() => {void erase();}}>{t('web.maintenance.deleteBackupConfirm')}</Button></View>}><TextField label={t('confirm.typeToConfirm',{token:'delete'})} value={typed} onChangeText={value => {if (current() && view.remove === heldRemove && !view.flight) setTyped(value);}} autoCapitalize="none" autoCorrect={false}/></BottomSheet>
  </View>;
}
