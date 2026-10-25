import React, {useEffect, useMemo, useRef, useState} from 'react';
import {Text} from 'react-native';
import {s3SourceDraft, type S3SourceFields, type RemoteSource, type RcloneProgram, type RcloneTestResult} from '../../../../../../packages/client-core/src/remote-sources';
import {defaultI18n} from '../../../../../../packages/i18n/src';
import {Button} from '../../../kit/controls/Button';
import {TextField} from '../../../kit/controls/TextField';
import {useTheme} from '../../../kit/theme';
import type {NativeRemoteSourcesController} from './controller';
import {Page, Problem, receiptCheckRequired, remoteSourceError, useAttempt} from './RemoteSourceForms';

/** A pasted configuration remains a local write-only draft. Never replay it. */
export function ImportedSourceEditor({controller, source, t, isCurrent, onCancel, onSaved, form = 'imported'}: {
  controller: NativeRemoteSourcesController; source?: RemoteSource; form?: 'imported' | 's3'; t: typeof defaultI18n.t;
  isCurrent: () => boolean; onCancel: () => void; onSaved: (source: RemoteSource) => void;
}) {
  const theme = useTheme(), current = useAttempt(isCurrent), flight = useRef(false), revision = useRef(0), testedDraft = useRef<Readonly<{name: string; remote: string; config: string}> | undefined>(undefined);
  const [name, setName] = useState(source?.name ?? ''), [remote, setRemote] = useState(''), [config, setConfig] = useState('');
  const [s3, setS3] = useState<S3SourceFields>({endpoint: '', region: '', accessKey: '', secretKey: '', bucket: '', folder: ''});
  const built = useMemo(() => form === 's3' ? s3SourceDraft(s3) : undefined, [form, s3]);
  const [busy, setBusy] = useState(false), [error, setError] = useState<string>(), [tested, setTested] = useState<RcloneTestResult>();
  const [program, setProgram] = useState<RcloneProgram>(), [providers, setProviders] = useState<readonly string[]>([]);
  const draft = useMemo(() => Object.freeze({name, remote: form === 's3' ? built?.remote ?? '' : remote, config: form === 's3' ? built?.config ?? '' : config}), [name, remote, config, built, form]);
  const latestDraft = useRef(draft); latestDraft.current = draft;
  const saveTicket = useRef<object | undefined>(undefined);
  const renderedRevision = revision.current;
  const ownsDraft = () => current() && revision.current === renderedRevision && latestDraft.current === draft;
  const invalidate = () => {revision.current++; testedDraft.current = undefined; setTested(undefined); setError(undefined);};
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
  const valid = !!name.trim() && name.length <= 100 && !!draft.remote.trim() && draft.remote.length <= 512 && !!draft.config.trim() && draft.config.length <= 65536;
  const test = async () => {
    if (flight.current || !ownsDraft() || !valid || !program?.available || recovery) return;
    flight.current = true; const guard = ownsDraft;
    setBusy(true); setError(undefined); setTested(undefined); testedDraft.current = undefined;
    try {const result = await controller.testImported({remote: draft.remote, config: draft.config}, guard); if (guard()) {setTested(result); testedDraft.current = draft;}}
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
    if (flight.current || !ownsDraft() || !valid || !tested || testedDraft.current !== draft || recovery) return;
    flight.current = true;
    const ticket = Object.freeze({draft, revision: renderedRevision}); saveTicket.current = ticket;
    const guard = () => current() && saveTicket.current === ticket && revision.current === ticket.revision;
    setConfig(''); setS3(value => ({...value, accessKey: '', secretKey: ''})); setTested(undefined); testedDraft.current = undefined; setBusy(true); setError(undefined);
    try {await controller.configureImported(source, ticket.draft, guard); if (guard()) finish();}
    catch (problem) {if (guard()) setError(remoteSourceError(t, problem));}
    finally {if (saveTicket.current === ticket) saveTicket.current = undefined; flight.current = false; if (current()) setBusy(false);}
  };
  const recover = async () => {
    if (flight.current || !current()) return;
    flight.current = true; setBusy(true); setError(undefined);
    try {await controller.recover(); if (current()) finish();}
    catch (problem) {if (current()) setError(remoteSourceError(t, problem));}
    finally {flight.current = false; if (current()) setBusy(false);}
  };
  const editable = !busy && !recovery && !snapshot.busy;
  return <Page title={source?.name ?? t(form === 's3' ? 'next.remoteSources.connectS3' : 'next.remoteSources.kindRclone')} t={t} busy={busy} onCancel={onCancel}
    footer={recovery ? <Button disabled={busy} onPress={() => {void recover();}}>{t('next.remoteSources.checkResult')}</Button>
      : <Button disabled={!editable || !valid || !tested} onPress={() => {void save();}}>{t('next.remoteSources.saveAndContinue')}</Button>}>
    <Text style={[theme.type.body, {color: theme.colors.textSecondary}]}>{program?.available && program.version
      ? t('next.remoteSources.bundledVersion', {version: program.version}) : t('next.remoteSources.bundledProgram')}</Text>
    {program && !program.available && <Problem message={t('next.remoteSources.bundledUnavailable')}/>}
    {!!providers.length && <Text style={[theme.type.caption, {color: theme.colors.textSecondary}]}>{t('next.remoteSources.providers', {providers: defaultI18n.list(providers)})}</Text>}
    {(!program || !program.available) && <Button disabled={busy} variant="text" onPress={() => {void facts();}}>{t('next.remoteSources.refresh')}</Button>}
    <TextField label={t('next.remoteSources.name')} value={name} editable={editable} autoCorrect={false}
      onChangeText={value => {if (flight.current || !current()) return; invalidate(); setName(value);}}/>
    {form === 's3' ? <>
      <Text style={[theme.type.caption, {color: theme.colors.textSecondary}]}>{t('next.remoteSources.s3Checks')}</Text>
      {(['endpoint', 'region', 'accessKey', 'secretKey', 'bucket', 'folder'] as const).map(key => <TextField key={key}
        label={t(({endpoint: 'next.remoteSources.s3Endpoint', region: 'next.remoteSources.s3Region', accessKey: 'next.remoteSources.s3AccessKey',
          secretKey: 'next.remoteSources.s3SecretKey', bucket: 'next.remoteSources.s3Bucket', folder: 'next.remoteSources.s3Folder'} as const)[key])}
        value={s3[key]} editable={editable} autoCapitalize="none" autoCorrect={false} secureTextEntry={key === 'secretKey'} textContentType="none"
        onChangeText={value => {if (flight.current || !current()) return; invalidate(); setS3(previous => ({...previous, [key]: value,
          ...((key === 'endpoint' || key === 'accessKey') ? {secretKey: ''} : {})}));}}/>)}
    </> : <>
    <TextField label={t('next.remoteSources.remoteName')} description={t('next.remoteSources.remoteNameHelp')} value={remote} editable={editable} autoCapitalize="none" autoCorrect={false}
      onChangeText={value => {if (flight.current || !current()) return; invalidate(); setConfig(''); setRemote(value);}}/>
    <TextField label={t('next.remoteSources.configuration')} description={t(source ? 'next.remoteSources.replaceConfiguration' : 'next.remoteSources.configurationHelp')}
      value={config} editable={editable} multiline autoCapitalize="none" autoCorrect={false} textContentType="none"
      onChangeText={value => {if (flight.current || !current()) return; invalidate(); setConfig(value);}}/>
    </>}
    <Button variant="glass" disabled={!editable || !valid || !program?.available} onPress={() => {void test();}}>{t('next.remoteSources.test')}</Button>
    {tested && <Text style={[theme.type.body, {color: theme.colors.textSecondary}]}>{tested.version ? t('next.remoteSources.testedRclone', {version: tested.version}) : t('next.remoteSources.testedRcloneUnknown')}</Text>}
    <Problem message={error}/>
  </Page>;
}
