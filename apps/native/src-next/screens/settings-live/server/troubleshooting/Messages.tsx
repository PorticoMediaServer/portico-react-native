import React, {useEffect, useLayoutEffect, useState, useSyncExternalStore} from 'react';
import {AppState, Text, View} from 'react-native';
import {SettingsMessagesSource} from '../../../../../../../packages/client-core/src/server-admin/messages-source';
import {LOG_DETAIL_MINUTES, logLevels, logCategories, type LogDetailMinutes, type LogSettings} from '../../../../../../../packages/client-core/src/server-administration';
import type {LogsDraft} from '../../../../../../../packages/client-core/src/server-admin/server-forms';
import {defaultI18n, type MessageId} from '../../../../../../../packages/i18n/src';
import type {NativeShellBootstrapContext} from '../../../../shell/bootstrap';
import type {NativeShellRuntime} from '../../../../shell/runtime';
import type {NativeSettingsLivePorts} from '../../ports';
import {NativeScreenLifetime, screenScopeEnded} from '../../lifetime';
import {nativeStorageOwner} from '../storage/space-source';
import {useStorageForms, useStorageSet, useFormState, type StorageForms} from '../storage/forms';
import {Button, Select} from '../../../../kit/controls';
import {shellType} from '../../../../kit/shell/visual';
import {useTheme} from '../../../../kit/theme';
const IDS = ['logs'] as const;

function createMessages(context: NativeShellBootstrapContext, operationId: () => string, reportError: NativeShellRuntime['reportError']) {
  const lifetime = new NativeScreenLifetime(context), listeners = new Set<() => void>();
  const current = () => lifetime.current() && nativeStorageOwner(context);
  const api = {request: <T,>(path: string, method?: string, body?: unknown, caller?: AbortSignal): Promise<T> => current()
    ? lifetime.request(signal => context.api.request<T>(path, method, body, signal), caller) : Promise.reject(screenScopeEnded())};
  let failed = false, desired = false, foreground = AppState.currentState === 'active', token: object | undefined, timer: ReturnType<typeof setTimeout> | undefined;
  const notify = () => {for (const listener of listeners) listener();};
  const handleFailure = (error: unknown) => {
    if (source.getSnapshot().phase === 'idle') {const owned = current();dispose();if (owned) reportError(error);}
    else {failed = true;notify();}
  };
  const source = new SettingsMessagesSource(api, undefined, current, handleFailure, operationId);
  const stop = () => {token = undefined;clearTimeout(timer);timer = undefined;};
  const active = (captured: object) => current() && desired && foreground && token === captured;
  const poll = async (captured: object) => {
    if (!active(captured)) return;
    const state = source.getSnapshot();
    if (state.phase !== 'loading' && !state.changing) {if (!active(captured)) return;await source.load();}
    if (!active(captured)) return;
    if (source.getSnapshot().phase === 'error') {desired = false;stop();source.setLive(false);return;}
    timer = setTimeout(() => {if (active(captured)) void poll(captured);}, 3000);
  };
  const start = (immediate: boolean) => {stop();if (!current() || !desired || !foreground) return;const captured = {};token = captured;source.setLive(true);if (immediate) void poll(captured);else timer = setTimeout(() => {if (active(captured)) void poll(captured);},3000);};
  const setLive = (live: boolean) => {if (!current()) return;desired = live;stop();source.setLive(live && foreground);if (live) start(true);};
  const subscription = AppState.addEventListener('change', value => {foreground = value === 'active';stop();if (!current()) return;if (!foreground) source.pause();else if (desired) start(true);});
  const dispose = () => {desired = false;stop();subscription.remove();source.dispose();lifetime.dispose();listeners.clear();};
  let selection: object | undefined;
  return {context, source, current, dispose, setLive, failure: handleFailure,
    getFailure: () => failed, subscribeFailure: (listener: () => void) => {listeners.add(listener);return () => {listeners.delete(listener);};}, clearFailure: () => {failed = false;notify();},
    select: async (level: Parameters<SettingsMessagesSource['select']>[0], category: Parameters<SettingsMessagesSource['select']>[1]) => {if (!current()) return;const captured = {};selection = captured;stop();await source.select(level,category);if (selection === captured && current() && desired) start(false);},
  };
}
type Group = ReturnType<typeof createMessages>;
export function NativeMessages({ports, runtime}: {ports: NativeSettingsLivePorts; runtime: NativeShellRuntime}) {
  const context = ports.context, operationId = ports.requestId, reportError = runtime.reportError, [group, setGroup] = useState<Group>();
  const forms = useStorageForms(ports, IDS, reportError);
  useLayoutEffect(() => {const next = createMessages(context,operationId,reportError);setGroup(next);return next.dispose;},[context,operationId,reportError]);
  return forms && group?.context === context ? <Messages key={forms.mount} group={group} forms={forms} runtime={runtime}/> : null;
}
function Messages({group, forms, runtime}: {group: Group; forms: StorageForms; runtime: NativeShellRuntime}) {
  const {source} = group, state = useSyncExternalStore(source.subscribe,source.getSnapshot,source.getSnapshot), failure = useSyncExternalStore(group.subscribeFailure,group.getFailure,group.getFailure), theme = useTheme(), t = runtime.text.t as typeof defaultI18n.t;
  const form = forms.forms.logs, logs = useFormState<LogsDraft, LogSettings>(form), saved = logs.status, draft = logs.draft, saveState = useStorageSet(forms);
  const [now,setNow] = useState(Date.now);
  useEffect(() => {void source.load();const timer = setInterval(() => {if (group.current()) setNow(Date.now());},30000);return () => clearInterval(timer);},[source,group]);
  const until = state.settings?.debugWindowUntil, recording = !!until && Date.parse(until) > now;
  const detail = () => {if (!group.current() || source.getSnapshot().changing) return;group.clearFailure();const minutes = saved?.logDetailMinutes;void source.detail(!recording, minutes !== undefined && LOG_DETAIL_MINUTES.includes(minutes) ? minutes : undefined).catch(error => {if (group.current()) group.failure(error);});};
  return <View style={{marginTop:14,gap:12}} testID="server-troubleshooting-messages">
    <Text style={[shellType(17,800),{color:theme.colors.text}]}>{t('web.logs.messages')}</Text><Text style={[shellType(13,400,18),{color:theme.colors.textSecondary}]}>{t('web.logs.messagesLede')}</Text>
    <View style={{padding:14,gap:8,borderRadius:14,backgroundColor:theme.colors.raised}}><Text style={[shellType(15,700),{color:theme.colors.text}]}>{t('settings.server.detailWindow.forMinutes',{minutes:saved?.logDetailMinutes ?? 30})}</Text><Text style={{color:theme.colors.textSecondary}}>{recording && until ? t('settings.server.detailWindow.until',{time:defaultI18n.time(Date.parse(until))}) : t('settings.server.detailWindow.help')}</Text><Button size="compact" loading={state.changing} disabled={state.changing} onPress={detail}>{t(recording ? 'settings.server.detailWindow.stop' : 'settings.server.detailWindow.start')}</Button></View>
    <View style={{flexDirection:'row',gap:8}}><Button size="compact" variant="glass" onPress={() => {if (group.current()) group.setLive(!source.getSnapshot().live);}}>{t(state.live ? 'next.cards.pause' : 'next.cards.live')}</Button><Button size="compact" variant="glass" disabled={state.phase === 'loading'} onPress={() => {if (group.current()) {group.clearFailure();void source.load();}}}>{t('web.selection.refresh')}</Button></View>
    <Select label={t('web.logs.level')} value={state.level} options={[{value:'',label:t('web.logs.allLevels')},...logLevels.map(value=>({value,label:value.toUpperCase()}))]} onValueChange={value => {if (group.current() && (value === '' || logLevels.includes(value as typeof logLevels[number]))) void group.select(value as typeof state.level,source.getSnapshot().category);}}/>
    <Select label={t('feedback.category')} value={state.category} options={[{value:'',label:t('web.logs.everything')},...logCategories.map(value=>({value,label:t(`server.logCategory.${value}` as MessageId)}))]} onValueChange={value=>{if(group.current() && (value === '' || logCategories.includes(value as typeof logCategories[number]))) void group.select(source.getSnapshot().level,value as typeof state.category);}}/>
    {failure && <Text accessibilityRole="alert" style={{color:theme.colors.record}}>{t('error.unavailable')}</Text>}
    {state.phase === 'loading' && !state.lines.length && <Text style={{color:theme.colors.textSecondary}}>{t('web.logs.loadingMessages')}</Text>}{state.phase === 'ready' && !state.lines.length && <Text style={{color:theme.colors.textSecondary}}>{t('web.logs.noMessages')}</Text>}
    {state.lines.map(row => <View key={row.sequence} style={{padding:12,gap:4,borderRadius:12,backgroundColor:theme.colors.raised}}><Text style={[shellType(11.5,600),{color:theme.colors.textTertiary}]}>{defaultI18n.time(Date.parse(row.at))} · {row.level.toUpperCase()} · {t(`server.logCategory.${row.category}` as MessageId)}</Text><Text style={[shellType(13,400,18),{color:theme.colors.text}]}>{row.message}</Text></View>)}
    {draft && <><Select label={t('next.settingsSpec.server.troubleshooting.advanced.groups.0.rows.0.label')} value={draft.logLevel} options={logLevels.map((value,index)=>({value,label:t(`next.settingsSpec.server.troubleshooting.advanced.groups.0.rows.0.control.options.${index}.label` as MessageId)}))} disabled={saveState.saving} onValueChange={value=>{if(group.current() && logLevels.includes(value as typeof logLevels[number]))form.set((old:LogsDraft)=>({...old,logLevel:value as LogsDraft['logLevel']}));}}/>{saved?.logDetailMinutes !== undefined && <Select label={t('next.settingsSpec.server.troubleshooting.advanced.groups.0.rows.1.label')} value={String(draft.logDetailMinutes ?? 30)} options={LOG_DETAIL_MINUTES.map(value=>({value:String(value),label:t('web.dvr.minutes',{count:value})}))} disabled={saveState.saving} onValueChange={value=>{const minutes=Number(value);if(group.current() && LOG_DETAIL_MINUTES.includes(minutes as LogDetailMinutes))form.set((old:LogsDraft)=>({...old,logDetailMinutes:minutes as LogDetailMinutes}));}}/>}{saveState.dirty && <View style={{flexDirection:'row',gap:8}}><Button size="compact" variant="glass" disabled={saveState.saving} onPress={()=>{if(group.current())forms.set.discard();}}>{t('action.discard')}</Button><Button size="compact" disabled={saveState.saving || !!saveState.problem} onPress={()=>{if(group.current())void forms.set.save();}}>{t('action.save')}</Button></View>}</>}
  </View>;
}
