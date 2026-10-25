import React, {useCallback, useEffect, useRef, useState} from 'react';
import {ScrollView, Text, View} from 'react-native';
import {defaultI18n} from '../../../../../../packages/i18n/src';
import {sourceReadPreset, sourceReadPresetName, type DAVConnectionResult, type RemoteState, type RemoteSource, type SourceReadPreset, type SourceReadSettings, type SourceReadValues} from '../../../../../../packages/client-core/src/remote-sources';
import {Button} from '../../../kit/controls/Button';
import {TextField} from '../../../kit/controls/TextField';
import {Switch} from '../../../kit/controls/Switch';
import {Select} from '../../../kit/controls/Select';
import {useTheme} from '../../../kit/theme';
import type {NativeRemoteSourcesController} from './controller';

type Translate = typeof defaultI18n.t;
type Common = {controller: NativeRemoteSourcesController; t: Translate; onCancel: () => void; isCurrent: () => boolean};

export function remoteSourceError(t: Translate, error: unknown): string {
  const code = error && typeof error === 'object' && 'code' in error && typeof error.code === 'string' ? error.code : '';
  const keys = {unauthorized: 'next.remoteSources.error.signIn', forbidden: 'next.remoteSources.error.forbidden', not_permitted: 'next.remoteSources.error.forbidden',
    storage_command_conflict: 'next.remoteSources.error.changed', revision_mismatch: 'next.remoteSources.error.changed', remote_source_changed: 'next.remoteSources.error.changed',
    idempotency_key_reused: 'next.remoteSources.error.reused', request_in_progress: 'next.remoteSources.error.busy', refresh_failed: 'next.remoteSources.error.refreshFailed',
    remote_invalid_configuration: 'next.remoteSources.error.invalid', invalid_request: 'next.remoteSources.error.invalid'} as const;
  return t(Object.prototype.hasOwnProperty.call(keys, code) ? keys[code as keyof typeof keys] : 'next.remoteSources.error.generic');
}

export function receiptCheckRequired(state: RemoteState): boolean {
  // A confirmed command's follow-up list read can fail after the service cleared its receipt.
  // Check the original operation; never turn that refresh failure into a new mutation.
  return state.ambiguous || !!state.operationId && !state.receipt && !state.rclone && !!state.error && !state.errorCode;
}

export function useAttempt(parentCurrent: () => boolean) {
  const live = useRef(true);
  useEffect(() => {live.current = true; return () => {live.current = false;};}, []);
  return useCallback(() => live.current && parentCurrent(), [parentCurrent]);
}

export function Page({title, t, busy, onCancel, children, footer}: {title: string; t: Translate; busy: boolean; onCancel: () => void; children: React.ReactNode; footer: React.ReactNode}) {
  const theme = useTheme();
  return <View style={{flex: 1, backgroundColor: theme.colors.ink}}>
    <View style={{padding: 20, flexDirection: 'row', alignItems: 'center', gap: 16}}>
      <Button variant="text" size="small" disabled={busy} onPress={onCancel}>{t('next.remoteSources.cancel')}</Button>
      <Text accessibilityRole="header" style={[theme.type.bodyStrong, {color: theme.colors.text, flex: 1}]}>{title}</Text>
    </View>
    <ScrollView keyboardShouldPersistTaps="handled" contentContainerStyle={{padding: 20, gap: 16}}>{children}</ScrollView>
    <View style={{padding: 20, borderTopWidth: 1, borderTopColor: theme.colors.line, gap: 12}}>{footer}</View>
  </View>;
}

export function Problem({message}: {message?: string}) {
  const theme = useTheme();
  return message ? <Text accessibilityRole="alert" style={[theme.type.body, {color: theme.colors.danger}]}>{message}</Text> : null;
}

/** The connection is a local draft. It is never copied into a store, receipt or persisted setting. */
export function ConnectionEditor({controller, t, source, onCancel, onSaved, isCurrent}: Common & {source?: RemoteSource; onSaved: (source: RemoteSource) => void}) {
  const theme = useTheme(), current = useAttempt(isCurrent), inFlight = useRef(false), revision = useRef(0), testedRevision = useRef(-1);
  const [name, setName] = useState(source?.name ?? ''), [root, setRoot] = useState(''), [username, setUsername] = useState(''), [password, setPassword] = useState('');
  const [insecureLocal, setInsecureLocal] = useState(source?.insecureLocal ?? false), [busy, setBusy] = useState(false);
  const [tested, setTested] = useState<DAVConnectionResult>(), [error, setError] = useState<string>();
  const changedConnection = !source || !!root || !!username || !!password;
  const input = () => ({name, root, username, password, insecureLocal});
  const edit = (setter: (value: string) => void) => (value: string) => {revision.current++; setter(value); setTested(undefined); setError(undefined);};
  const test = async () => {
    if (inFlight.current || !current()) return;
    inFlight.current = true;
    const captured = revision.current, guard = () => current() && revision.current === captured;
    setBusy(true); setError(undefined); setTested(undefined);
    try {const result = await controller.testConnection(input(), guard); if (guard()) {testedRevision.current = captured; setTested(result);}}
    catch (problem) {if (guard()) setError(remoteSourceError(t, problem));}
    finally {inFlight.current = false; if (current()) setBusy(false);}
  };
  const finish = () => {
    const state = controller.getSnapshot().sources;
    if (state.receipt && !state.receipt.removed && current()) {onSaved(state.receipt.source); return;}
    if (current()) setError(remoteSourceError(t, {code: state.errorCode}));
  };
  const save = async () => {
    if (inFlight.current || !current() || !name.trim() || changedConnection && (!tested || testedRevision.current !== revision.current)) return;
    inFlight.current = true;
    const draft = {...input(), keepConnection: !changedConnection, keepPassword: !!source && !changedConnection, expectedGeneration: source?.generation};
    setBusy(true); setError(undefined); setPassword(''); setTested(undefined);
    try {await controller.configure(source?.id ?? null, draft, source, current); if (current()) finish();}
    catch (problem) {if (current()) setError(remoteSourceError(t, problem));}
    finally {inFlight.current = false; if (current()) setBusy(false);}
  };
  const recover = async () => {
    if (inFlight.current || !current()) return;
    inFlight.current = true;
    setBusy(true); setError(undefined);
    try {await controller.recover(); if (current()) finish();}
    catch (problem) {if (current()) setError(remoteSourceError(t, problem));}
    finally {inFlight.current = false; if (current()) setBusy(false);}
  };
  const ambiguous = receiptCheckRequired(controller.getSnapshot().sources);
  return <Page title={source?.name ?? t('next.remoteSources.add')} t={t} busy={busy} onCancel={onCancel}
    footer={ambiguous ? <Button onPress={() => {void recover();}} disabled={busy}>{t('next.remoteSources.checkResult')}</Button>
      : <Button onPress={() => {void save();}} loading={busy} disabled={busy || !name.trim() || changedConnection && !tested}>{t('next.remoteSources.saveAndContinue')}</Button>}>
    <TextField label={t('next.remoteSources.name')} value={name} onChangeText={edit(setName)} editable={!busy && !ambiguous} autoCorrect={false}/>
    {!!source?.origin && <Text style={[theme.type.caption, {color: theme.colors.textSecondary}]}>{source.origin}</Text>}
    <TextField label={t('next.remoteSources.address')} value={root} onChangeText={edit(setRoot)} editable={!busy && !ambiguous} autoCapitalize="none" autoCorrect={false} keyboardType="url"/>
    <TextField label={t('next.remoteSources.username')} value={username} onChangeText={edit(setUsername)} editable={!busy && !ambiguous} autoCapitalize="none" autoCorrect={false} autoComplete="off"/>
    <TextField label={t('next.remoteSources.password')} value={password} onChangeText={edit(setPassword)} editable={!busy && !ambiguous} secureTextEntry autoCapitalize="none" autoCorrect={false} autoComplete="off"/>
    <Switch checked={insecureLocal} onCheckedChange={value => {revision.current++; setInsecureLocal(value); setTested(undefined);}} disabled={busy || ambiguous} variant="phone">{t('next.remoteSources.insecureLocal')}</Switch>
    <Button variant="glass" onPress={() => {void test();}} disabled={busy || ambiguous || !name.trim() || !root.trim()}>{t(busy ? 'next.remoteSources.testing' : 'next.remoteSources.test')}</Button>
    {tested && <Text style={[theme.type.body, {color: theme.colors.text}]}>{t(tested.rangeSupport === 'conditional' ? 'next.remoteSources.tested' : 'next.remoteSources.testedLimited', {origin: tested.origin})}</Text>}
    <Problem message={error}/>
  </Page>;
}

const presets: readonly SourceReadPreset[] = ['list', 'once', 'everything', 'ask'];
const presetLabels = [
  'next.settingsSpec.server.remote-sources.panels.source.tabs.1.groups.0.rows.0.control.options.0.label',
  'next.settingsSpec.server.remote-sources.panels.source.tabs.1.groups.0.rows.0.control.options.1.label',
  'next.settingsSpec.server.remote-sources.panels.source.tabs.1.groups.0.rows.0.control.options.2.label',
  'next.settingsSpec.server.remote-sources.panels.source.tabs.1.groups.0.rows.0.control.options.3.label',
] as const;

export function ReadingEditor({controller, t, source, onCancel, onSaved, isCurrent}: Common & {source: RemoteSource; onSaved: () => void}) {
  const current = useAttempt(isCurrent), inFlight = useRef(false);
  const [profile, setProfile] = useState<SourceReadSettings>(), [values, setValues] = useState<SourceReadValues>();
  const [connections, setConnections] = useState(''), [requests, setRequests] = useState(''), [speed, setSpeed] = useState('');
  const [busy, setBusy] = useState(false), [error, setError] = useState<string>();
  const accept = (next: SourceReadSettings) => {
    setProfile(next); setValues(next.values); setConnections(String(next.values.connections)); setRequests(String(next.values.requestsPerSecond)); setSpeed(String(next.values.bytesPerSecond / 1000000));
  };
  const load = async () => {
    if (inFlight.current || !current()) return;
    inFlight.current = true;
    setBusy(true); setError(undefined);
    try {const next = await controller.readProfile(source, current); if (current()) accept(next);}
    catch (problem) {if (current()) setError(remoteSourceError(t, problem));}
    finally {inFlight.current = false; if (current()) setBusy(false);}
  };
  useEffect(() => {void load(); /* one explicit read for this mounted source */
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  const select = (preset: SourceReadPreset) => {
    const next = sourceReadPreset(preset); setValues(next); setConnections(String(next.connections)); setRequests(String(next.requestsPerSecond)); setSpeed(String(next.bytesPerSecond / 1000000));
  };
  const parsed = values && {...values, connections: Number(connections), requestsPerSecond: Number(requests), bytesPerSecond: Math.round(Number(speed) * 1000000)};
  const valid = !!parsed && connections.trim() !== '' && requests.trim() !== '' && speed.trim() !== '' && Number.isSafeInteger(parsed.connections) && parsed.connections > 0 && parsed.connections <= 32
    && Number.isSafeInteger(parsed.requestsPerSecond) && parsed.requestsPerSecond > 0 && parsed.requestsPerSecond <= 50 && Number.isSafeInteger(Number(speed)) && Number(speed) >= 0 && Number(speed) <= 1000 && Number.isSafeInteger(parsed.bytesPerSecond);
  const save = async () => {
    if (inFlight.current || !profile || !parsed || !valid || !current()) return;
    inFlight.current = true;
    setBusy(true); setError(undefined);
    try {await controller.saveProfile(profile, parsed, current); if (current()) onSaved();}
    catch (problem) {if (current()) setError(remoteSourceError(t, problem));}
    finally {inFlight.current = false; if (current()) setBusy(false);}
  };
  const ambiguous = receiptCheckRequired(controller.getSnapshot().sources);
  const recover = async () => {
    if (inFlight.current || !current()) return;
    inFlight.current = true; setBusy(true); setError(undefined);
    try {
      await controller.recover();
      const state = controller.getSnapshot().sources;
      if (state.ambiguous || !state.receipt) throw {code: state.errorCode};
      await controller.readProfile(state.receipt.source, current);
      if (current()) onSaved();
    } catch (problem) {if (current()) setError(remoteSourceError(t, problem));}
    finally {inFlight.current = false; if (current()) setBusy(false);}
  };
  return <Page title={t('next.remoteSources.reading')} t={t} busy={busy} onCancel={onCancel}
    footer={ambiguous ? <Button onPress={() => {void recover();}} disabled={busy}>{t('next.remoteSources.checkResult')}</Button>
      : <Button onPress={() => {void save();}} disabled={busy || !profile || !valid}>{t('next.remoteSources.save')}</Button>}>
    {values && <>
      <Select accessibilityLabel={t('next.remoteSources.readingMode')} value={parsed ? sourceReadPresetName(parsed) ?? 'custom' : 'custom'}
        options={[...presets.map((value, i) => ({value, label: t(presetLabels[i])})), {value: 'custom', label: t('next.settingsSpec.server.remote-sources.panels.source.tabs.1.groups.0.rows.0.control.options.4.label'), disabled: true}]} disabled={busy}
        onValueChange={value => {if (presets.includes(value as SourceReadPreset)) select(value as SourceReadPreset);}}/>
      <Switch variant="phone" checked={values.wholeFileReads} onCheckedChange={wholeFileReads => setValues({...values, wholeFileReads})} disabled={busy}>{t('next.settingsSpec.server.remote-sources.panels.source.tabs.3.groups.1.rows.1.label')}</Switch>
      <TextField label={t('next.remoteSources.connections')} value={connections} onChangeText={setConnections} editable={!busy} keyboardType="number-pad"/>
      <TextField label={t('next.remoteSources.requestsPerSecond')} value={requests} onChangeText={setRequests} editable={!busy} keyboardType="number-pad"/>
      <TextField label={`${t('next.remoteSources.downloadSpeed')} (${t('next.remoteSources.megabytesPerSecond')})`} value={speed} onChangeText={setSpeed} editable={!busy} keyboardType="number-pad" description={Number(speed) === 0 ? t('next.remoteSources.noLimit') : undefined}/>
    </>}
    {!profile && !busy && <Button variant="glass" onPress={() => {void load();}}>{t('next.remoteSources.retry')}</Button>}
    <Problem message={error}/>
  </Page>;
}

export function DisconnectEditor({controller, t, source, onCancel, onSaved, isCurrent}: Common & {source: RemoteSource; onSaved: () => void}) {
  const theme = useTheme(), current = useAttempt(isCurrent), inFlight = useRef(false);
  const [name, setName] = useState(''), [busy, setBusy] = useState(false), [error, setError] = useState<string>();
  const remove = async () => {
    if (inFlight.current || name !== source.name || !current()) return;
    inFlight.current = true;
    setBusy(true); setError(undefined);
    try {
      await controller.remove(source, current);
      const state = controller.getSnapshot().sources;
      if (current() && (state.alreadyDone || state.receipt?.removed || state.rclone?.sourceId === source.id && state.rclone.removed)) onSaved();
      else if (current()) setError(remoteSourceError(t, {code: state.errorCode}));
    } catch (problem) {if (current()) setError(remoteSourceError(t, problem));}
    finally {inFlight.current = false; if (current()) setBusy(false);}
  };
  const ambiguous = receiptCheckRequired(controller.getSnapshot().sources);
  const recover = async () => {
    if (inFlight.current || !current()) return;
    inFlight.current = true; setBusy(true); setError(undefined);
    try {
      await controller.recover();
      const state = controller.getSnapshot().sources;
      if (!state.ambiguous && (state.receipt?.removed || state.rclone?.sourceId === source.id && state.rclone.removed) && current()) onSaved();
      else if (current()) setError(remoteSourceError(t, {code: state.errorCode}));
    } catch (problem) {if (current()) setError(remoteSourceError(t, problem));}
    finally {inFlight.current = false; if (current()) setBusy(false);}
  };
  return <Page title={t('next.remoteSources.disconnectTitle', {name: source.name})} t={t} busy={busy} onCancel={onCancel}
    footer={ambiguous ? <Button onPress={() => {void recover();}} disabled={busy}>{t('next.remoteSources.checkResult')}</Button>
      : <Button onPress={() => {void remove();}} disabled={busy || name !== source.name}>{t('next.remoteSources.disconnect')}</Button>}>
    <Text style={[theme.type.body, {color: theme.colors.text}]}>{t('next.remoteSources.disconnectBody')}</Text>
    <TextField label={t('next.remoteSources.disconnectConfirm')} value={name} onChangeText={setName} editable={!busy} autoCorrect={false} autoCapitalize="none"/>
    <Problem message={error}/>
  </Page>;
}
