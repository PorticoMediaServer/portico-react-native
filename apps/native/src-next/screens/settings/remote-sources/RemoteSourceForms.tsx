import React, {createContext, useCallback, useContext, useEffect, useRef, useState} from 'react';
import {ScrollView, Text, View} from 'react-native';
import {defaultI18n} from '../../../../../../packages/i18n/src';
import {sourceReadPreset, sourceReadPresetName, type DAVConnectionResult, type RemoteState, type RemoteSource, type SourceReadPreset, type SourceReadSettings, type SourceReadValues} from '../../../../../../packages/client-core/src/remote-sources';
import {Button} from '../../../kit/controls/Button';
import {TextField} from '../../../kit/controls/TextField';
import {Switch} from '../../../kit/controls/Switch';
import {useTheme} from '../../../kit/theme';
import type {NativeRemoteSourcesController} from './controller';
import {SourceAnalysisConsent} from './SourceAnalysisConsent';
import {SourceReadingControls} from './SourceReadingControls';
import {ConnectionTestCard} from './ConnectionTestCard';
import {connectionTestField} from './reading-presentation';
import {LibraryGroup, LibraryRow} from '../../settings-live/owner-libraries/controls';

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
  return state.ambiguous || !!state.operationId && !state.receipt && !state.rclone
    && (!state.errorCode || state.errorCode === 'remote_source_not_listed');
}

export function useAttempt(parentCurrent: () => boolean) {
  const live = useRef(true);
  useEffect(() => {live.current = true; return () => {live.current = false;};}, []);
  return useCallback(() => live.current && parentCurrent(), [parentCurrent]);
}

export const SourceWizardContext = createContext<Readonly<{step: number; back: () => void}> | undefined>(undefined);

export function Page({title, t, busy, onCancel, children, footer, wizardStep}: {title: string; t: Translate; busy: boolean; onCancel: () => void; children: React.ReactNode; footer: React.ReactNode; wizardStep?: number}) {
  const theme = useTheme(), wizard = useContext(SourceWizardContext), step = wizardStep ?? wizard?.step;
  return <View style={{flex: 1, backgroundColor: theme.colors.ink}}>
    <View style={{padding: 20, flexDirection: 'row', alignItems: 'center', gap: 16}}>
      <Button variant="text" size="small" disabled={busy} onPress={onCancel}>{t('next.remoteSources.cancel')}</Button>
      <Text accessibilityRole="header" style={[theme.type.bodyStrong, {color: theme.colors.text, flex: 1}]}>{title}</Text>
    </View>
    {step !== undefined && <View style={{paddingHorizontal: 20, gap: 8}}><Text style={[theme.type.caption, {color: theme.colors.textSecondary}]}>{`Step ${step} of 5`}</Text>
      <View style={{flexDirection: 'row', gap: 4}}>{[1, 2, 3, 4, 5].map(value => <View key={value} style={{flex: 1, height: 3, borderRadius: 2, backgroundColor: value <= step ? theme.colors.accentStrong : theme.colors.lineSoft}}/>)}</View></View>}
    <ScrollView keyboardShouldPersistTaps="handled" contentContainerStyle={{padding: 20, gap: 16}}>{children}</ScrollView>
    <View style={{padding: 20, borderTopWidth: 1, borderTopColor: theme.colors.line, gap: 12}}>
      {wizard && step !== undefined && step > 1 && step < 5 && <Button variant="glass" disabled={busy} onPress={wizard.back}>{t('next.remoteSources.back')}</Button>}{footer}
    </View>
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
  const [tested, setTested] = useState<DAVConnectionResult>(), [error, setError] = useState<string>(), [errorField, setErrorField] = useState<'password'>(), [testing, setTesting] = useState(false);
  const changedConnection = !source || !!root || !!username || !!password;
  const input = () => ({name, root, username, password, insecureLocal});
  const edit = (setter: (value: string) => void) => (value: string) => {revision.current++; setter(value); setTested(undefined); setError(undefined); setErrorField(undefined);};
  const test = async () => {
    if (inFlight.current || !current()) return;
    inFlight.current = true;
    const captured = revision.current, guard = () => current() && revision.current === captured;
    setBusy(true); setTesting(true); setError(undefined); setErrorField(undefined); setTested(undefined);
    try {const result = await controller.testConnection(input(), guard); if (guard()) {testedRevision.current = captured; setTested(result);}}
    catch (problem) {if (guard()) {const field = connectionTestField(problem); setErrorField(field); setError(field ? 'The storage rejected the sign-in. Check the user name and password.' : remoteSourceError(t, problem));}}
    finally {inFlight.current = false; if (current()) {setBusy(false); setTesting(false);}}
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
    {tested ? <LibraryGroup><LibraryRow first label={name} help={tested.origin} trailing={<Button variant="text" size="small" disabled={busy || ambiguous} onPress={() => {revision.current++; setTested(undefined); setError(undefined); setErrorField(undefined);}}>Edit</Button>}/></LibraryGroup> : <>
    <TextField label={t('next.remoteSources.name')} value={name} onChangeText={edit(setName)} editable={!busy && !ambiguous} autoCorrect={false}/>
    {!!source?.origin && <Text style={[theme.type.caption, {color: theme.colors.textSecondary}]}>{source.origin}</Text>}
    <TextField label={t('next.remoteSources.address')} value={root} onChangeText={edit(setRoot)} editable={!busy && !ambiguous} autoCapitalize="none" autoCorrect={false} keyboardType="url"/>
    <TextField label={t('next.remoteSources.username')} value={username} onChangeText={edit(setUsername)} editable={!busy && !ambiguous} autoCapitalize="none" autoCorrect={false} autoComplete="off"/>
    <TextField label={t('next.remoteSources.password')} error={errorField === 'password' ? error : undefined} value={password} onChangeText={edit(setPassword)} editable={!busy && !ambiguous} secureTextEntry autoCapitalize="none" autoCorrect={false} autoComplete="off"/>
    <Switch checked={insecureLocal} onCheckedChange={value => {revision.current++; setInsecureLocal(value); setTested(undefined); setError(undefined); setErrorField(undefined);}} disabled={busy || ambiguous} variant="phone">{t('next.remoteSources.insecureLocal')}</Switch>
    </>}
    {!tested && <Button variant="glass" onPress={() => {void test();}} disabled={busy || ambiguous || !name.trim() || !root.trim()}>{testing ? t('next.remoteSources.testing') : error ? 'Test again' : t('next.remoteSources.test')}</Button>}
    <ConnectionTestCard testing={testing} result={tested} error={errorField ? undefined : error} t={t}/>

  </Page>;
}

const presets: readonly SourceReadPreset[] = ['list', 'once', 'everything', 'ask'];
const presetLabels = [
  'next.settingsSpec.server.remote-sources.panels.source.tabs.1.groups.0.rows.0.control.options.0.label',
  'next.settingsSpec.server.remote-sources.panels.source.tabs.1.groups.0.rows.0.control.options.1.label',
  'next.settingsSpec.server.remote-sources.panels.source.tabs.1.groups.0.rows.0.control.options.2.label',
  'next.settingsSpec.server.remote-sources.panels.source.tabs.1.groups.0.rows.0.control.options.3.label',
] as const;

/** The drawn name of one known reading preset, from the same options the editor uses. */
export function sourceReadPresetLabel(t: Translate, preset: SourceReadPreset): string {
  return t(presetLabels[presets.indexOf(preset)]);
}

export function ReadingEditor({controller, t, source, onCancel, onSaved, isCurrent}: Common & {source: RemoteSource; onSaved: (source: RemoteSource) => void}) {
  const current = useAttempt(isCurrent), inFlight = useRef(false);
  const [profile, setProfile] = useState<SourceReadSettings>(), [values, setValues] = useState<SourceReadValues>(), [baseline, setBaseline] = useState<SourceReadValues>();
  const profileOwner = useRef<SourceReadSettings | undefined>(undefined), draftRevision = useRef(0);
  const renderedRevision = draftRevision.current;
  const ownsDraft = () => current() && profileOwner.current === profile && draftRevision.current === renderedRevision;
  const [analysisConsent, setAnalysisConsent] = useState<boolean>(), [consentEdited, setConsentEdited] = useState(false);
  const [connections, setConnections] = useState(''), [requests, setRequests] = useState(''), [speed, setSpeed] = useState('');
  const [busy, setBusy] = useState(false), [error, setError] = useState<string>();
  const accept = (next: SourceReadSettings) => {
    const {allowAdvancedMediaAnalysis, ...reading} = next.values;
    profileOwner.current = next; draftRevision.current++;
    const preset = sourceReadPresetName(reading); setBaseline(next.choiceBaseline?.reading ?? (preset ? sourceReadPreset(preset) : undefined));
    setProfile(next); setValues(reading); setAnalysisConsent(allowAdvancedMediaAnalysis); setConsentEdited(false);
    setConnections(String(reading.connections)); setRequests(String(reading.requestsPerSecond)); setSpeed(String(reading.bytesPerSecond / 1000000));
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
    if (inFlight.current || !profile || !ownsDraft()) return;
    draftRevision.current++;
    // Presets change reading controls only. The independent consent draft and its
    // explicit-edit fact survive, so no preset can grant or revoke consent.
    const next = sourceReadPreset(preset); setBaseline(next); setValues(next); setConnections(String(next.connections)); setRequests(String(next.requestsPerSecond)); setSpeed(String(next.bytesPerSecond / 1000000));
  };
  const edit = (setter: (value: string) => void) => (value: string) => {
    if (inFlight.current || !current() || profileOwner.current !== profile) return;
    draftRevision.current++; setter(value);
  };
  const changeConsent = (value: boolean) => {
    if (inFlight.current || !ownsDraft() || typeof analysisConsent !== 'boolean') return;
    draftRevision.current++; setAnalysisConsent(value); setConsentEdited(true);
  };
  const parsed = values && {...values, connections: Number(connections), requestsPerSecond: Number(requests), bytesPerSecond: Math.round(Number(speed) * 1000000)};
  const valid = !!parsed && connections.trim() !== '' && requests.trim() !== '' && speed.trim() !== '' && Number.isSafeInteger(parsed.connections) && parsed.connections > 0 && parsed.connections <= 32
    && Number.isSafeInteger(parsed.requestsPerSecond) && parsed.requestsPerSecond > 0 && parsed.requestsPerSecond <= 50 && Number.isSafeInteger(Number(speed)) && Number(speed) >= 0 && Number(speed) <= 1000 && Number.isSafeInteger(parsed.bytesPerSecond);
  const save = async () => {
    if (inFlight.current || !profile || !parsed || !valid || !ownsDraft()) return;
    if (consentEdited && typeof analysisConsent !== 'boolean') return;
    // Omission preserves the source's recorded consent. Only an explicit edit
    // includes this field, beside the same original profile revision and values.
    const consent = consentEdited ? analysisConsent : undefined;
    const command = Object.freeze({...parsed, ...(typeof consent === 'boolean' ? {allowAdvancedMediaAnalysis: consent} : {})});
    inFlight.current = true;
    setBusy(true); setError(undefined);
    try {await controller.saveProfile(profile, command, ownsDraft); const receipt = controller.getSnapshot().sources.receipt; if (ownsDraft() && receipt && !receipt.removed && receipt.source.id === source.id) onSaved(receipt.source);}
    catch (problem) {if (ownsDraft()) setError(remoteSourceError(t, problem));}
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
      if (current()) onSaved(state.receipt.source);
    } catch (problem) {if (current()) setError(remoteSourceError(t, problem));}
    finally {inFlight.current = false; if (current()) setBusy(false);}
  };
  return <Page title={t('next.remoteSources.reading')} t={t} busy={busy} onCancel={onCancel}
    footer={ambiguous ? <Button onPress={() => {void recover();}} disabled={busy}>{t('next.remoteSources.checkResult')}</Button>
      : <Button onPress={() => {void save();}} disabled={busy || !profile || !valid}>{t('next.remoteSources.save')}</Button>}>
    {values && <>
      {parsed && <SourceReadingControls values={parsed} baseline={baseline} disabled={busy || ambiguous} onSelect={select} t={t}
        onLimit={(field, value) => {if (field === 'connections') edit(setConnections)(String(value)); else if (field === 'requestsPerSecond') edit(setRequests)(String(value)); else edit(setSpeed)(String(value / 1000000));}}
        onReset={() => {
          if (!baseline || inFlight.current || !ownsDraft()) return;
          draftRevision.current++; setValues(baseline); setConnections(String(baseline.connections)); setRequests(String(baseline.requestsPerSecond)); setSpeed(String(baseline.bytesPerSecond / 1000000));
        }}/>}
      <SourceAnalysisConsent value={analysisConsent} disabled={busy || ambiguous} onChange={changeConsent} t={t}/>
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
      : <Button variant="glass" style={{backgroundColor: `${theme.colors.record}24`}} textStyle={{color: theme.colors.record}} onPress={() => {void remove();}} disabled={busy || name !== source.name}>{t('next.remoteSources.disconnect')}</Button>}>
    <Text style={[theme.type.body, {color: theme.colors.text}]}>{t('next.remoteSources.disconnectBody')}</Text>
    <TextField label={t('next.remoteSources.disconnectConfirm')} value={name} onChangeText={setName} editable={!busy} autoCorrect={false} autoCapitalize="none"/>
    <Problem message={error}/>
  </Page>;
}
