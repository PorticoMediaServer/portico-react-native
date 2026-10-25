import React, {useEffect, useMemo, useState, useSyncExternalStore} from 'react';
import {ScrollView, Text, View} from 'react-native';
import {routePath} from '../../../../../../packages/contracts/src/routes';
import {parseSettingsConfiguration, type SettingsConfiguration} from '../../../../../../packages/client-core/src/settings-configuration';
import {nativeRouteCrypto} from '../../../platform/server-connections';
import {ConsoleClient} from '../../../../../../packages/client-core/src/console';
import {FormSet} from '../../../../../../packages/client-core/src/server-admin/draft-form';
import {createServerForm, withFormValue} from '../../../../../../packages/client-core/src/server-admin/server-forms';
import {readSettingsBinding, settingsBinding, settingsBindingPatch, type SettingsBindingSources} from '../../../../../../packages/client-core/src/presentation/settings-bindings';
import {settingsSpec, type SettingsRow as SpecRow} from '../../../../../../packages/client-core/src/presentation/settings-spec';
import {Button, Select, TextField} from '../../../kit/controls';
import {ServerHeader} from '../../../kit/shell/ServerIdentity';
import {StateView} from '../../../kit/states';
import {useTheme} from '../../../kit/theme';
import {NativeScreenLifetime} from '../lifetime';
import type {NativeSettingsLivePorts} from '../ports';
import type {NativeShellRuntime} from '../../../shell/runtime';

/** Phone Streaming borrows checked revisioned runtime/connectivity documents, never delivery policy state. */
export function NativeServerStreaming({ports, runtime}: {ports: NativeSettingsLivePorts; runtime: NativeShellRuntime}) {
  const theme = useTheme(), t = runtime.text.t, context = ports.context;
  const owned = useMemo(() => {
    const lifetime = new NativeScreenLifetime(context);
    const api = {request: <T,>(path: string, method?: string, body?: unknown, signal?: AbortSignal) => lifetime.request(next => context.api.request<T>(path, method, body, next), signal)};
    const console = new ConsoleClient(api, {serverId: lifetime.authority.serverId, viewerId: lifetime.authority.profileId});
    const deps = {api, console, serverId: lifetime.authority.serverId, operationId: () => [...nativeRouteCrypto.random(24)].map(byte => byte.toString(16).padStart(2, '0')).join('')};
    const forms = {runtime: createServerForm('runtime', deps), connectivity: createServerForm('connectivity', deps)};
    const set = new FormSet(); set.add('runtime', forms.runtime); set.add('connectivity', forms.connectivity);
    return {lifetime, api, console, forms, set};
  }, [context]);
  const [configuration, setConfiguration] = useState<SettingsConfiguration>(), [configurationError, setConfigurationError] = useState<unknown>();
  useEffect(() => {const read = new AbortController(); void owned.api.request(routePath('get_settings_configuration'), 'GET', undefined, read.signal).then(parseSettingsConfiguration).then(value => {if (!read.signal.aborted) setConfiguration(value);}, error => {if (!read.signal.aborted) setConfigurationError(error);}); return () => read.abort();}, [owned]);
  useEffect(() => {for (const form of Object.values(owned.forms)) void form.load(); return () => {for (const form of Object.values(owned.forms)) form.dispose(); owned.console.dispose(); owned.set.discard(); owned.lifetime.dispose();};}, [owned]);
  const runtimeState = useSyncExternalStore(owned.forms.runtime.subscribe, owned.forms.runtime.getSnapshot);
  const connectivityState = useSyncExternalStore(owned.forms.connectivity.subscribe, owned.forms.connectivity.getSnapshot);
  const state = useSyncExternalStore(owned.set.subscribe, owned.set.getSnapshot);
  const [invalid, setInvalid] = useState<ReadonlySet<string>>(new Set());
  const sources: SettingsBindingSources = {forms: {runtime: runtimeState.draft, connectivity: connectivityState.draft}};
  const section = settingsSpec.find(value => value.scope === 'server' && value.id === 'streaming');
  const change = (row: SpecRow, value: unknown) => {
    owned.lifetime.assert(); const binding = settingsBinding(row.id); if (!binding || !['runtime', 'connectivity'].includes(binding.form)) return;
    const patch = settingsBindingPatch(binding, value, sources), form = owned.forms[patch.form as keyof typeof owned.forms];
    if (!form) return;
    form.set((draft: Record<string, unknown>) => Object.entries(patch.values).reduce((next, [key, field]) => withFormValue(next, key, field), draft));
  };
  const renderRow = (row: SpecRow) => {
    const binding = settingsBinding(row.id); if (!binding || !['runtime', 'connectivity'].includes(binding.form)) return null;
    const policy = configuration?.fields.find(field => field.id === (row.id === 'streaming.awayQuality' ? 'streaming.awayExact' : row.id));
    if (!configuration || !policy || policy.configOnly) return null;
    const fact = readSettingsBinding(binding, sources, row.id); if (!fact) return null;
    if (row.control.type === 'select' && row.control.options) return <Select key={row.id} testID={row.id} rowLabel={t(row.label)} description={row.help ? t(row.help) : undefined} value={String(fact.current)} disabled={state.saving}
      options={row.control.options.map(option => ({value: String(option.value), label: t(option.label), description: option.hint ? t(option.hint) : undefined}))} onValueChange={value => change(row, value)}/>;
    if (row.control.type === 'number') return <StreamingNumber key={row.id} row={row} value={fact.current} disabled={state.saving} runtime={runtime} onChange={value => change(row, value)} onValidity={valid => setInvalid(before => {const next = new Set(before); if (valid) next.delete(row.id); else next.add(row.id); return next;})}/>;
    return null;
  };
  return <View style={{flex: 1}}><ScrollView contentContainerStyle={{paddingHorizontal: 20, paddingBottom: 40, gap: 18}}>
    <ServerHeader serverName={context.serverName} viewerRole="owner" audience="owner" variant="phone"/>
    <Text accessibilityRole="header" style={[theme.type.title, {color: theme.colors.text}]}>{section ? t(section.title) : t('settings.server.playback')}</Text>
    {configurationError !== undefined && <StateView variant="inline" {...runtime.error(configurationError, () => {void owned.api.request(routePath('get_settings_configuration')).then(parseSettingsConfiguration).then(value => {setConfiguration(value); setConfigurationError(undefined);}, setConfigurationError);})}/>}
    {[runtimeState, connectivityState].map((form, index) => form.loadError !== undefined ? <StateView key={index} variant="inline" {...runtime.error(form.loadError, () => {void Object.values(owned.forms)[index]!.load();})}/> : null)}
    {state.saveError !== undefined && <StateView variant="inline" {...runtime.error(state.saveError, () => {void owned.set.save();})}/>}
    {state.problem && <Text accessibilityRole="alert" style={[theme.type.caption, {color: theme.colors.record}]}>{t(state.problem as Parameters<typeof t>[0])}</Text>}
    {section?.groups?.slice(0, 4).map((group, index) => {const rows = group.rows.map(renderRow).filter(Boolean); return rows.length ? <View key={index} style={{gap: 10}}>{group.title && <Text style={[theme.type.rowHeading, {color: theme.colors.textSecondary}]}>{t(group.title)}</Text>}<View style={{backgroundColor: theme.colors.raised, borderRadius: 14, padding: 14, gap: 16}}>{rows}</View></View> : null;})}
  </ScrollView><View style={{flexDirection: 'row', justifyContent: 'flex-end', padding: 16, gap: 12}}><Button variant="glass" disabled={!state.dirty || state.saving} onPress={() => {owned.set.discard(); setInvalid(new Set());}}>{t('action.discard')}</Button><Button disabled={!state.dirty || state.saving || invalid.size > 0 || !!state.problem} loading={state.saving} onPress={() => {void owned.set.save();}}>{t('action.save')}</Button></View></View>;
}

function StreamingNumber({row, value, disabled, runtime, onChange, onValidity}: {row: SpecRow; value: unknown; disabled: boolean; runtime: NativeShellRuntime; onChange: (value: number | null) => void; onValidity: (valid: boolean) => void}) {
  const [text, setText] = useState(value === null ? '' : String(value));
  useEffect(() => setText(value === null ? '' : String(value)), [value]);
  return <TextField testID={row.id} label={runtime.text.t(row.label)} description={row.help ? runtime.text.t(row.help) : undefined} value={text} editable={!disabled} keyboardType="numeric" placeholder={row.control.placeholder ? runtime.text.t(row.control.placeholder) : undefined} onChangeText={typed => {
    setText(typed); const number = Number(typed), valid = typed.trim() === '' ? !!row.control.optional : /^\d+$/.test(typed) && Number.isSafeInteger(number) && number >= (row.control.min ?? 0) && number <= (row.control.max ?? Number.MAX_SAFE_INTEGER);
    onValidity(valid); if (valid) onChange(typed.trim() === '' ? null : number);
  }}/>;
}
