import React, {useEffect, useRef, useState} from 'react';
import {Text} from 'react-native';
import type {RemoteSource, RcloneProgram, RcloneTestResult} from '../../../../../../packages/client-core/src/remote-sources';
import {defaultI18n} from '../../../../../../packages/i18n/src';
import {Button} from '../../../kit/controls/Button';
import {TextField} from '../../../kit/controls/TextField';
import {useTheme} from '../../../kit/theme';
import type {NativeRemoteSourcesController} from './controller';
import {Page, Problem, receiptCheckRequired, remoteSourceError, useAttempt} from './RemoteSourceForms';

/** A pasted configuration remains a local write-only draft. Never replay it. */
export function ImportedSourceEditor({controller, source, t, isCurrent, onCancel, onSaved}: {
  controller: NativeRemoteSourcesController; source?: RemoteSource; t: typeof defaultI18n.t;
  isCurrent: () => boolean; onCancel: () => void; onSaved: (source: RemoteSource) => void;
}) {
  const theme = useTheme(), current = useAttempt(isCurrent), flight = useRef(false), revision = useRef(0), testedRevision = useRef(-1);
  const [name, setName] = useState(source?.name ?? ''), [remote, setRemote] = useState(''), [config, setConfig] = useState('');
  const [busy, setBusy] = useState(false), [error, setError] = useState<string>(), [tested, setTested] = useState<RcloneTestResult>();
  const [program, setProgram] = useState<RcloneProgram>(), [providers, setProviders] = useState<readonly string[]>([]);
  const invalidate = () => {revision.current++; testedRevision.current = -1; setTested(undefined); setError(undefined);};
  const facts = async () => {
    if (flight.current || !current()) return;
    flight.current = true; setBusy(true); setError(undefined);
    try {const result = await controller.importedFacts(current); if (current()) {setProgram(result.program); setProviders(result.providers);}}
    catch (problem) {if (current()) setError(remoteSourceError(t, problem));}
    finally {flight.current = false; if (current()) setBusy(false);}
  };
  useEffect(() => {void facts();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  const snapshot = controller.getSnapshot().sources, recovery = receiptCheckRequired(snapshot);
  const valid = !!name.trim() && name.length <= 100 && !!remote.trim() && remote.length <= 512 && !!config.trim() && config.length <= 65536;
  const test = async () => {
    if (flight.current || !current() || !valid || !program?.available || recovery) return;
    flight.current = true; const captured = revision.current, guard = () => current() && revision.current === captured;
    setBusy(true); setError(undefined); setTested(undefined); testedRevision.current = -1;
    try {const result = await controller.testImported({remote, config}, guard); if (guard()) {setTested(result); testedRevision.current = captured;}}
    catch (problem) {if (guard()) setError(remoteSourceError(t, problem));}
    finally {flight.current = false; if (current()) setBusy(false);}
  };
  const finish = () => {
    const state = controller.getSnapshot().sources, receipt = state.rclone;
    const row = receipt && !receipt.removed ? state.sources.find(value => value.id === receipt.sourceId && value.generation === receipt.generation) : undefined;
    if (current() && row) onSaved(row);
    else if (current()) setError(remoteSourceError(t, {code: state.errorCode}));
  };
  const save = async () => {
    if (flight.current || !current() || !valid || !tested || testedRevision.current !== revision.current || recovery) return;
    flight.current = true; const draft = {name, remote, config};
    setConfig(''); setTested(undefined); testedRevision.current = -1; setBusy(true); setError(undefined);
    try {await controller.configureImported(source, draft, current); if (current()) finish();}
    catch (problem) {if (current()) setError(remoteSourceError(t, problem));}
    finally {flight.current = false; if (current()) setBusy(false);}
  };
  const recover = async () => {
    if (flight.current || !current()) return;
    flight.current = true; setBusy(true); setError(undefined);
    try {await controller.recover(); if (current()) finish();}
    catch (problem) {if (current()) setError(remoteSourceError(t, problem));}
    finally {flight.current = false; if (current()) setBusy(false);}
  };
  const editable = !busy && !recovery && !snapshot.busy;
  return <Page title={source?.name ?? t('next.remoteSources.kindRclone')} t={t} busy={busy} onCancel={onCancel}
    footer={recovery ? <Button disabled={busy} onPress={() => {void recover();}}>{t('next.remoteSources.checkResult')}</Button>
      : <Button disabled={!editable || !valid || !tested} onPress={() => {void save();}}>{t('next.remoteSources.saveAndContinue')}</Button>}>
    <Text style={[theme.type.body, {color: theme.colors.textSecondary}]}>{program?.available && program.version
      ? t('next.remoteSources.bundledVersion', {version: program.version}) : t('next.remoteSources.bundledProgram')}</Text>
    {program && !program.available && <Problem message={t('next.remoteSources.bundledUnavailable')}/>}
    {!!providers.length && <Text style={[theme.type.caption, {color: theme.colors.textSecondary}]}>{t('next.remoteSources.providers', {providers: defaultI18n.list(providers)})}</Text>}
    {(!program || !program.available) && <Button disabled={busy} variant="text" onPress={() => {void facts();}}>{t('next.remoteSources.refresh')}</Button>}
    <TextField label={t('next.remoteSources.name')} value={name} editable={editable} autoCorrect={false}
      onChangeText={value => {invalidate(); setName(value);}}/>
    <TextField label={t('next.remoteSources.remoteName')} description={t('next.remoteSources.remoteNameHelp')} value={remote} editable={editable} autoCapitalize="none" autoCorrect={false}
      onChangeText={value => {invalidate(); setConfig(''); setRemote(value);}}/>
    <TextField label={t('next.remoteSources.configuration')} description={t(source ? 'next.remoteSources.replaceConfiguration' : 'next.remoteSources.configurationHelp')}
      value={config} editable={editable} multiline autoCapitalize="none" autoCorrect={false} textContentType="none"
      onChangeText={value => {invalidate(); setConfig(value);}}/>
    <Button variant="glass" disabled={!editable || !valid || !program?.available} onPress={() => {void test();}}>{t('next.remoteSources.test')}</Button>
    {tested && <Text style={[theme.type.body, {color: theme.colors.textSecondary}]}>{tested.version ? t('next.remoteSources.testedRclone', {version: tested.version}) : t('next.remoteSources.testedRcloneUnknown')}</Text>}
    <Problem message={error}/>
  </Page>;
}
