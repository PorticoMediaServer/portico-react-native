import React, {useEffect, useLayoutEffect, useMemo, useState, useSyncExternalStore} from 'react';
import {Text, View} from 'react-native';
import {SettingsMissingSource} from '../../../../../../../packages/client-core/src/server-admin/missing-source';
import type {RuntimeSettings} from '../../../../../../../packages/client-core/src/console';
import type {MissingTitlesPage} from '../../../../../../../packages/client-core/src/title-identity';
import {when} from '../../../../../../../packages/client-core/src/server-admin/console-words';
import {defaultI18n, type MessageId} from '../../../../../../../packages/i18n/src';
import {Button, TextField} from '../../../../kit/controls';
import {BottomSheet} from '../../../../kit/overlays';
import {shellType} from '../../../../kit/shell/visual';
import {useTheme} from '../../../../kit/theme';
import type {NativeSettingsLivePorts} from '../../ports';
import type {NativeShellRuntime} from '../../../../shell/runtime';
import type {NativeShellBootstrapContext} from '../../../../shell/bootstrap';
import {NativeScreenLifetime, screenScopeEnded} from '../../lifetime';
import {nativeStorageOwner} from './space-source';
import {useStorageForms, useStorageSet, useFormState, type StorageForms} from './forms';
const IDS = ['runtime'] as const;
const RULES = ['immediately', 'after_days', 'never'] as const;
type Translate = typeof defaultI18n.t;
function createMissing(context: NativeShellBootstrapContext, reportError: NativeShellRuntime['reportError']) {
  const lifetime = new NativeScreenLifetime(context), current = () => lifetime.current() && nativeStorageOwner(context);
  const api = {request: <T,>(path: string, method?: string, body?: unknown, caller?: AbortSignal): Promise<T> => current()
    ? lifetime.request(signal => context.api.request<T>(path, method, body, signal), caller) : Promise.reject(screenScopeEnded())};
  const source = new SettingsMissingSource(api, current, error => {const owned = current();source.dispose();lifetime.dispose();if (owned) reportError(error);});
  return {context, source, current, dispose: () => {source.dispose();lifetime.dispose();}};
}
type Group = ReturnType<typeof createMissing>;
type Confirmation = Readonly<{page: MissingTitlesPage}>;
/** Libraries owns the current missing list; removal captures its actual observed page. */
export function MissingTitlesTab({ports, runtime, t}: {ports: NativeSettingsLivePorts; runtime: NativeShellRuntime; t: Translate}) {
  const context = ports.context, reportError = runtime.reportError, [group, setGroup] = useState<Group>();
  const forms = useStorageForms(ports, IDS, reportError);
  useLayoutEffect(() => {const next = createMissing(context, reportError);setGroup(next);return next.dispose;}, [context, reportError]);
  return forms && group?.context === context ? <Missing key={forms.mount} group={group} forms={forms} t={t}/> : null;
}
function Missing({group, forms, t}: {group: Group; forms: StorageForms; t: Translate}) {
  const {source} = group, theme = useTheme(), state = useSyncExternalStore(source.subscribe, source.getSnapshot, source.getSnapshot), setState = useStorageSet(forms), settings = useFormState<RuntimeSettings, unknown>(forms.forms.runtime), form = forms.forms.runtime;
  useEffect(() => {void source.load();}, [source]);
  const [confirmation, setConfirmation] = useState<Confirmation>(), [typed, setTyped] = useState(''), [days, setDays] = useState(''), [history, setHistory] = useState<readonly string[]>(['']);
  const view = useMemo(() => ({source, active:true, confirmation:undefined as Confirmation | undefined, saving:false}), [source]);
  useLayoutEffect(() => {view.active = true;return () => {view.active = false;view.confirmation = undefined;};}, [view]);
  const current = () => view.active && view.source === source && group.current();
  const page = state.page, held = confirmation && view.confirmation === confirmation && page === confirmation.page && state.phase === 'ready' && current() ? confirmation : undefined;
  const draft = settings.draft, rule = draft?.['library.missingTitles'];
  useEffect(() => {setDays(draft ? String(draft['library.missingTitlesDays']) : '');}, [draft]);
  const close = () => {if (!held || !current() || view.confirmation !== held) return;view.confirmation = undefined;setConfirmation(undefined);setTyped('');};
  const remove = async () => {
    const captured = held;if (!captured || !current() || view.confirmation !== captured || typed !== String(captured.page.total)) return;
    await source.remove(captured.page, typed, () => current() && view.confirmation === captured && source.getSnapshot().page === captured.page);
    if (current() && view.confirmation === captured) {view.confirmation = undefined;setConfirmation(undefined);setTyped('');}
  };
  const save = async () => {if (!current() || view.saving || state.busy || setState.saving) return;view.saving = true;try {if (await forms.set.save()) {if (current()) await source.refresh();}} finally {view.saving = false;}};
  const busy = state.busy || setState.saving;
  return <View style={{marginTop:22,gap:12}} testID="server-storage-missing">
    <Text style={[shellType(17,800),{color:theme.colors.text}]}>{t('settings.server.missingTitles')}</Text><Text style={[shellType(13,400,18),{color:theme.colors.textSecondary}]}>{t('settings.server.missingTitlesLede')}</Text>
    {draft && <><Text style={[shellType(14,600),{color:theme.colors.text}]}>{t('settings.server.missingTitlesRule')}</Text>{RULES.map(value => <Button key={value} variant={rule === value ? 'primary' : 'glass'} size="compact" disabled={busy} onPress={() => {if (current() && !view.saving) form.set((old: RuntimeSettings) => ({...old,'library.missingTitles':value}));}}>{t(`settings.server.missingTitlesRule.${value}` as MessageId)}</Button>)}{rule === 'after_days' && <TextField label={t('settings.server.missingTitlesDays')} value={days} keyboardType="number-pad" editable={!busy} onChangeText={value => {if (!current() || view.saving) return;setDays(value);if (/^[0-9]+$/.test(value) && Number(value) >= 1 && Number(value) <= 3650) form.set((old: RuntimeSettings) => ({...old,'library.missingTitlesDays':Number(value)}));}}/>}{setState.dirty && <View style={{flexDirection:'row',gap:8}}><Button size="compact" variant="glass" disabled={busy} onPress={() => {if (current() && !view.saving) forms.set.discard();}}>{t('action.discard')}</Button><Button size="compact" loading={setState.saving} disabled={busy || !!setState.problem || rule === 'after_days' && (!/^[0-9]+$/.test(days) || Number(days) < 1 || Number(days) > 3650)} onPress={() => {void save();}}>{t('action.save')}</Button></View>}</>}
    {(setState.saveError !== undefined || state.error || settings.loadError !== undefined) && <Text accessibilityRole="alert" style={{color:theme.colors.record}}>{t('error.unavailable')}</Text>}
    <Button size="compact" variant="glass" disabled={busy} onPress={() => {if (current()) {void source.refresh();void form.load();}}}>{t('action.tryAgain')}</Button>
    {page && <><Text style={{color:theme.colors.textSecondary}}>{t(page.total ? 'web.missingTitles.count' : 'web.missingTitles.none', {count:page.total})}</Text>{page.items.map(row => <View key={row.id} style={{padding:12,gap:4,borderRadius:12,backgroundColor:theme.colors.raised}}><Text style={[shellType(15,600),{color:theme.colors.text}]}>{row.title}</Text><Text style={{color:theme.colors.textSecondary}}>{t('web.missingTitles.since',{when:when(Date.parse(row.missingSince))})}</Text></View>)}</>}
    <View style={{flexDirection:'row',gap:8}}>{history.length > 1 && <Button size="compact" disabled={busy} onPress={() => {if (!current() || source.getSnapshot().page !== page) return;const next = history.slice(0,-1);setHistory(next);void source.load(next[next.length-1]);}}>{t('action.back')}</Button>}{page?.nextCursor && <Button size="compact" disabled={busy} onPress={() => {if (!current() || source.getSnapshot().page !== page || !page.nextCursor) return;setHistory([...history,page.nextCursor]);void source.load(page.nextCursor);}}>{t('action.showMore')}</Button>}</View>
    {!!page?.total && <Button size="compact" variant="glass" disabled={busy || state.phase !== 'ready' || !page.observedAt} onPress={() => {if (!current() || source.getSnapshot().page !== page || source.getSnapshot().busy) return;const next = {page};view.confirmation = next;setConfirmation(next);setTyped('');}}>{t('web.missingTitles.removeNow')}</Button>}
    <BottomSheet open={!!held} onOpenChange={value => {if (!value) close();}} title={t('web.missingTitles.removeTitle')} description={t('web.missingTitles.removeBody',{count:held?.page.total ?? 0})} footer={<View style={{flexDirection:'row',gap:8}}><Button variant="glass" onPress={close}>{t('action.cancel')}</Button><Button disabled={state.busy || !held || typed !== String(held.page.total)} loading={state.busy} onPress={() => {void remove();}}>{t('web.missingTitles.removeNow')}</Button></View>}><TextField label={t('confirm.typeToConfirm',{token:held?.page.total ?? 0})} value={typed} keyboardType="number-pad" editable={!state.busy} onChangeText={value => {if (current() && view.confirmation === held) setTyped(value);}}/></BottomSheet>
  </View>;
}
