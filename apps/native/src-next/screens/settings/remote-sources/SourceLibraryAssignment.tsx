import React, {useEffect, useMemo, useRef, useState, useSyncExternalStore} from 'react';
import {Text, View} from 'react-native';
import type {LibraryManagementService, ManagedLibrary} from '../../../../../../packages/client-core/src/library-management';
import {sourceReadPresetName, type RemoteFolder, type RemoteSource, type SourceReadSettings} from '../../../../../../packages/client-core/src/remote-sources';
import {defaultI18n} from '../../../../../../packages/i18n/src';
import {Button} from '../../../kit/controls/Button';
import {Select} from '../../../kit/controls/Select';
import {TextField} from '../../../kit/controls/TextField';
import {useTheme} from '../../../kit/theme';
import type {NativeRemoteSourcesController} from './controller';
import {Page, Problem, remoteSourceError, sourceReadPresetLabel, useAttempt} from './RemoteSourceForms';
export type ChosenSourceFolder = Pick<RemoteFolder, 'name' | 'path' | 'relative'>;
type Props = {controller: NativeRemoteSourcesController; source: RemoteSource; folders: readonly ChosenSourceFolder[];
  t: typeof defaultI18n.t; isCurrent: () => boolean; onCancel: () => void;
  onChooseFolders: () => void; onOpen: () => void; onAddAnother: () => void};

export function SourceLibraryAssignment(props: Props) {
  const current = useAttempt(props.isCurrent), [service, setService] = useState<LibraryManagementService>(), [error, setError] = useState<string>();
  useEffect(() => {
    if (!current()) return;
    try {
      const owned = props.controller.libraryAssignment(current); setService(owned); void owned.loadLibraries();
      return () => owned.dispose();
    } catch (problem) {if (current()) setError(remoteSourceError(props.t, problem));}
    // One service for this mounted assignment attempt.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [props.controller]);
  return service ? <Assignment {...props} service={service} isCurrent={current}/>
    : <Page title={props.t('next.remoteSources.attachTo')} t={props.t} busy={false} onCancel={props.onCancel} footer={null}><Problem message={error}/></Page>;
}

function Assignment({controller, source, folders, service, t, isCurrent, onCancel, onChooseFolders, onOpen, onAddAnother}: Props & {service: LibraryManagementService}) {
  const theme = useTheme(), snapshot = useSyncExternalStore(service.subscribe, service.getSnapshot), current = useAttempt(isCurrent);
  const flight = useRef(false), revision = useRef(0), renderedRevision = revision.current;
  const [mode, setMode] = useState<'new' | 'existing'>('new'), [name, setName] = useState(source.name), [kind, setKind] = useState<ManagedLibrary['kind']>('movie');
  const [target, setTarget] = useState(''), [busy, setBusy] = useState(false), [error, setError] = useState<string>(), [done, setDone] = useState<string>();
  const [profile, setProfile] = useState<SourceReadSettings>();
  const draft = useMemo(() => Object.freeze({mode, name, kind, target, source, folders}), [mode, name, kind, target, source, folders]);
  const latestDraft = useRef(draft); latestDraft.current = draft;
  const owns = () => current() && revision.current === renderedRevision && latestDraft.current === draft;
  const kinds: readonly ManagedLibrary['kind'][] = ['movie', 'tv', 'anime', 'music', 'audiobook', 'book', 'comic'];
  const selected = snapshot.directory.data?.items.find(value => value.id === target);
  const [ambiguous, setAmbiguous] = useState(false);
  const valid = folders.length > 0 && folders.length <= 64 && (mode === 'new' ? !!name.trim() && new TextEncoder().encode(name.trim()).length <= 100 : !!selected);
  const edit = (action: () => void) => {if (flight.current || !current()) return; revision.current++; setError(undefined); action();};
  // A summary read is supplementary: its failure omits the summary and never turns an
  // accepted create or attach into a failed one, nor repeats the accepted write.
  const readSummary = async () => {
    try {const next = await controller.readProfile(source, current); if (current()) setProfile(next);}
    catch {if (current()) setProfile(undefined);}
  };
  const save = async () => {
    if (flight.current || !owns() || !valid || ambiguous || done) return;
    flight.current = true; setBusy(true); setError(undefined); setProfile(undefined);
    try {
      if (mode === 'new') {
        await controller.validateAssignmentFolders(source, folders, owns);
        if (!owns()) return;
        const operation = controller.libraryAssignment(owns);
        try {
          const input = {name: draft.name, kind: draft.kind, folders: draft.folders.map(value => value.path),
            expectedRemoteSource: {sourceId: draft.source.id, generation: draft.source.generation}};
          await operation.createLibrary(input);
          if (!owns()) return;
          const result = operation.getSnapshot().mutation;
          if (result.phase === 'ambiguous') setAmbiguous(true);
          if (result.phase !== 'complete') throw Object.assign(new Error('library_assignment_failed'), {code: result.error?.code});
          setDone(draft.name.trim());
        } finally {operation.dispose();}
        void readSummary();
      } else if (selected) {
        for (const folder of folders) {if (!owns()) return; await controller.attachFolder(source, selected.id, folder, owns);}
        if (owns()) {setDone(selected.name); void readSummary();}
      }
    } catch (problem) {if (owns()) setError(remoteSourceError(t, problem));}
    finally {flight.current = false; if (current()) setBusy(false);}
  };
  const preset = profile ? sourceReadPresetName(profile.values) : undefined;
  return <Page title={t('next.remoteSources.attachTo')} t={t} busy={busy} onCancel={onCancel}
    footer={done ? <View style={{flexDirection: 'row', gap: 12}}>
      <Button style={{flex: 1}} onPress={onOpen}>{t('next.remoteSources.openSource', {name: source.name})}</Button>
      <Button variant="glass" style={{flex: 1}} onPress={onAddAnother}>{t('next.remoteSources.addAnother')}</Button>
    </View> : <Button disabled={busy || !valid || ambiguous} onPress={() => {void save();}}>{t('next.remoteSources.save')}</Button>}>
    {done ? <>
      <Text style={[theme.type.bodyStrong, {color: theme.colors.text}]}>{t('next.remoteSources.summaryLibrary', {library: done})}</Text>
      <Text style={[theme.type.body, {color: theme.colors.textSecondary}]}>{t(folders.length === 1 ? 'next.remoteSources.summaryLibraryOne' : 'next.remoteSources.summaryLibraryMany', {count: folders.length, source: source.name})}</Text>
      {profile && <Text style={[theme.type.body, {color: theme.colors.textSecondary}]}>{t('next.remoteSources.summaryLimits', {connections: profile.values.connections, requests: profile.values.requestsPerSecond})}</Text>}
      {preset && <Text style={[theme.type.body, {color: theme.colors.textSecondary}]}>{t('next.remoteSources.summaryTreatment', {preset: sourceReadPresetLabel(t, preset)})}</Text>}
    </> : <>
      {folders.map(folder => <Text key={folder.relative} style={[theme.type.body, {color: theme.colors.textSecondary}]}>{folder.path}</Text>)}
      <Button variant="glass" disabled={busy} onPress={() => {if (!flight.current && current()) onChooseFolders();}}>{t('next.remoteSources.chooseFolders')}</Button>
      <Select label={t('next.remoteSources.attachTo')} value={mode} disabled={busy} options={[
        {value: 'new', label: t('next.remoteSources.newLibrary')}, {value: 'existing', label: t('next.remoteSources.existingLibrary')},
      ]} onValueChange={value => {if (value === 'new' || value === 'existing') edit(() => setMode(value));}}/>
      {mode === 'new' ? <>
        <TextField label={t('next.remoteSources.libraryName')} value={name} editable={!busy} onChangeText={value => edit(() => setName(value))}/>
        <Select label={t('next.remoteSources.libraryKind')} value={kind} disabled={busy}
          options={kinds.map((value, index) => ({value, label: t(`next.settingsSpec.server.libraries.panels.newLibrary.tabs.0.groups.0.rows.1.control.options.${index}.label` as never)}))}
          onValueChange={value => {if (kinds.includes(value as ManagedLibrary['kind'])) edit(() => setKind(value as ManagedLibrary['kind']));}}/>
      </> : <>
        <Select label={t('next.remoteSources.existingLibrary')} value={target} disabled={busy || snapshot.directory.phase !== 'ready'}
          options={(snapshot.directory.data?.items ?? []).map(value => ({value: value.id, label: value.name}))}
          onValueChange={value => edit(() => setTarget(value))}/>
        <Button variant="text" disabled={busy || snapshot.directory.phase === 'loading'} onPress={() => {if (flight.current || !current()) return; edit(() => setTarget('')); void service.loadLibraries();}}>{t('next.remoteSources.refresh')}</Button>
        {snapshot.directory.data?.nextCursor && <Button variant="text" disabled={busy} onPress={() => {if (flight.current || !current()) return; edit(() => setTarget('')); void service.nextLibraries();}}>{t('next.settings.loadMore')}</Button>}
        {snapshot.directory.canPrevious && <Button variant="text" disabled={busy} onPress={() => {if (flight.current || !current()) return; edit(() => setTarget('')); void service.previousLibraries();}}>{t('next.remoteSources.back')}</Button>}
      </>}
      {snapshot.directory.error && <Problem message={remoteSourceError(t, snapshot.directory.error)}/>}
      <Problem message={error}/>
    </>}
  </Page>;
}
