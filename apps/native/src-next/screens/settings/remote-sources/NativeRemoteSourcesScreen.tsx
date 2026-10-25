import React, {useCallback, useEffect, useRef, useState, useSyncExternalStore} from 'react';
import {ScrollView, Text, View} from 'react-native';
import {defaultI18n} from '../../../../../../packages/i18n/src';
import {sourceStateText} from '../../../../../../packages/client-core/src/server-admin/storage-words';
import type {RemoteSource} from '../../../../../../packages/client-core/src/remote-sources';
import {presentError} from '../../../../../../packages/client-core/src/presentation/errors';
import type {NativeSettingsLivePorts} from '../../settings-live/ports';
import type {NativeShellRuntime} from '../../../shell/runtime';
import {Button} from '../../../kit/controls/Button';
import {ServerHeader} from '../../../kit/shell/ServerIdentity';
import {StateView} from '../../../kit/states';
import {shellType} from '../../../kit/shell/visual';
import {useTheme} from '../../../kit/theme';
import {NativeRemoteSourcesController} from './controller';
import {ConnectionEditor, DisconnectEditor, ReadingEditor, Page, receiptCheckRequired, remoteSourceError} from './RemoteSourceForms';

import {SourceLibraryAssignment, type ChosenSourceFolder} from './SourceLibraryAssignment';
import {SourceAdvancedEditor} from './SourceAdvancedEditor';
import {SourceFolderBrowser} from './SourceFolderBrowser';
import {SourceStatusPanel} from './SourceStatusPanel';
import {AccountConfigEditor} from './AccountConfigEditor';
import {ImportedSourceEditor} from './ImportedSourceEditor';

type Props = {ports: NativeSettingsLivePorts; runtime: NativeShellRuntime; onBackHandlerChange?: (handler: (() => boolean) | undefined) => void};
type Mode = {kind: 'assignment'; source: RemoteSource; folders: readonly ChosenSourceFolder[]} | {kind: 'choose' | 'accountConfig'} | {kind: 'connection' | 'imported'; source?: RemoteSource} | {kind: 'detail' | 'reading' | 'disconnect' | 'folders' | 'advanced'; source: RemoteSource};

/** Canonical WebDAV and imported source management. Settings owns the entry. */
export function NativeRemoteSourcesScreen({ports, runtime, onBackHandlerChange}: Props) {
  const next = useRef(0), currentPorts = useRef(ports);
  currentPorts.current = ports;
  const [owned, setOwned] = useState<{controller: NativeRemoteSourcesController; ports: NativeSettingsLivePorts; key: number}>();
  useEffect(() => {
    const controller = new NativeRemoteSourcesController(ports, () => currentPorts.current === ports);
    setOwned({controller, ports, key: ++next.current});
    void controller.load();
    return () => controller.dispose();
  }, [ports]);
  return owned && owned.ports === ports ? <Viewport key={owned.key} controller={owned.controller} ports={owned.ports} runtime={runtime} onBackHandlerChange={onBackHandlerChange}/>
    : <StateView title={runtime.text.t('next.remoteSources.loading')}/>;
}

function Viewport({controller, ports, runtime, onBackHandlerChange}: Props & {controller: NativeRemoteSourcesController}) {
  const theme = useTheme(), t = runtime.text.t as typeof defaultI18n.t;
  const snapshot = useSyncExternalStore(controller.subscribe, controller.getSnapshot);
  const [mode, setMode] = useState<Mode>(), [error, setError] = useState<string>();
  const attempt = useRef(0);
  const close = useCallback(() => {attempt.current++; setMode(undefined); setError(undefined);}, []);
  const open = (next: Mode) => {attempt.current++; setMode(next); setError(undefined);};
  const subpage = snapshot.allowed && !!mode;
  useEffect(() => {
    onBackHandlerChange?.(subpage ? () => {close(); return true;} : undefined);
    return () => onBackHandlerChange?.(undefined);
  }, [subpage, close, onBackHandlerChange]);
  const captured = attempt.current;
  const isCurrent = () => controller.getSnapshot().allowed && attempt.current === captured;
  if (!snapshot.allowed) {
    const problem = presentError({code: 'forbidden'}, 'server-console');
    return <StateView title={problem.title} body={problem.body} tone="error"/>;
  }
  if (mode?.kind === 'choose') return <Page title={t('next.remoteSources.whatToConnect')} t={t} busy={false} onCancel={close} footer={null}>
    <Button variant="glass" onPress={() => open({kind: 'connection'})}>{t('next.remoteSources.connectWebdav')}</Button>
    <Button variant="glass" onPress={() => open({kind: 'imported'})}>{t('next.remoteSources.connectRclone')}</Button>
    <Button variant="glass" onPress={() => open({kind: 'accountConfig'})}>{t('next.remoteSources.connectFromConfig')}</Button>
  </Page>;
  if (mode?.kind === 'accountConfig') return <AccountConfigEditor controller={controller} t={t} isCurrent={isCurrent} onCancel={close} onSaved={source => open({kind: 'reading', source})}/>;
  if (mode?.kind === 'imported') return <ImportedSourceEditor key={mode.source?.id ?? 'new-imported'} controller={controller} source={mode.source} t={t} isCurrent={isCurrent}
    onCancel={close} onSaved={source => open({kind: 'reading', source})}/>;
  if (mode?.kind === 'connection') return <ConnectionEditor key={mode.source?.id ?? 'new'} controller={controller} source={mode.source} t={t} isCurrent={isCurrent} onCancel={close}
    onSaved={source => open({kind: 'reading', source})}/>;
  if (mode?.kind === 'assignment') return <SourceLibraryAssignment controller={controller} source={mode.source} folders={mode.folders} t={t} isCurrent={isCurrent} onCancel={close}/>;
  if (mode?.kind === 'advanced') return <SourceAdvancedEditor key={`${mode.source.id}:${mode.source.generation}`} controller={controller} source={mode.source} t={t} isCurrent={isCurrent} onCancel={close}/>;
  if (mode?.kind === 'folders') return <SourceFolderBrowser key={`${mode.source.id}:${mode.source.generation}`} controller={controller} source={mode.source} t={t} isCurrent={isCurrent} onCancel={close} onChoose={folders => open({kind: 'assignment', source: mode.source, folders})}/>;
  if (mode?.kind === 'reading') return <ReadingEditor key={mode.source.id} controller={controller} source={mode.source} t={t} isCurrent={isCurrent} onCancel={close} onSaved={close}/>;
  if (mode?.kind === 'disconnect') return <DisconnectEditor key={mode.source.id} controller={controller} source={mode.source} t={t} isCurrent={isCurrent} onCancel={close} onSaved={close}/>;
  const state = snapshot.sources, needsReceipt = receiptCheckRequired(state), blocked = state.busy || needsReceipt;
  const recover = async () => {
    setError(undefined);
    try {await controller.recover();}
    catch (problem) {if (controller.getSnapshot().allowed) setError(remoteSourceError(t, problem));}
  };
  const detail = mode?.kind === 'detail' ? mode.source : undefined;
  const selected = detail ? state.sources.find(source => source.id === detail.id) ?? detail : undefined;
  return <ScrollView testID="native-remote-sources" contentContainerStyle={{padding: 20, paddingBottom: 40, gap: 16}}>
    <ServerHeader serverName={ports.serverName()} viewerRole="owner" audience="owner" variant="phone"/>
    <Text accessibilityRole="header" style={[shellType(28, 800, 33, -.03), {color: theme.colors.text}]}>{selected?.name ?? t('settings.server.remoteSources')}</Text>
    {needsReceipt && <Button disabled={state.busy} onPress={() => {void recover();}}>{t('next.remoteSources.checkResult')}</Button>}
    {(state.error || error) && <StateView title={error ?? remoteSourceError(t, {code: state.errorCode})} tone="error"/>}
    {selected ? <>
      <SourceStatusPanel key={`${selected.id}:${selected.generation}`} controller={controller} source={selected} isCurrent={isCurrent} t={t}/>
      <Text style={[theme.type.body, {color: theme.colors.textSecondary}]}>{sourceStateText(t, id => defaultI18n.has(id), selected)}</Text>
      {!!selected.origin && <Text style={[theme.type.body, {color: theme.colors.textSecondary}]}>{selected.origin}</Text>}
      <Button variant="text" onPress={close}>{t('next.remoteSources.back')}</Button>
      <Button variant="glass" disabled={blocked} onPress={() => open({kind: 'advanced', source: selected})}>{t('next.remoteSources.advanced')}</Button>
      <Button variant="glass" disabled={blocked} onPress={() => open({kind: 'folders', source: selected})}>{t('next.remoteSources.foldersSection')}</Button>
      <Button variant="glass" disabled={blocked} onPress={() => open({kind: 'reading', source: selected})}>{t('next.remoteSources.reading')}</Button>
      {(selected.kind === 'webdav' || selected.kind === 'rclone') && <>
        <Button variant="glass" disabled={blocked} onPress={() => open({kind: selected.kind === 'rclone' ? 'imported' : 'connection', source: selected})}>{t('next.remoteSources.connection')}</Button>
        <Button variant="text" disabled={blocked} onPress={() => open({kind: 'disconnect', source: selected})}>{t('next.remoteSources.disconnect')}</Button>
      </>}
    </> : <>
      <Button disabled={blocked} onPress={() => open({kind: 'choose'})}>{t('next.remoteSources.add')}</Button>
      <Button variant="text" disabled={blocked || state.loading} onPress={() => {void controller.load();}}>{t('next.remoteSources.refresh')}</Button>
      {state.loading && <Text style={[theme.type.body, {color: theme.colors.textSecondary}]}>{t('next.remoteSources.loading')}</Text>}
      {!state.loading && !state.error && !state.sources.length && <StateView title={t('next.remoteSources.empty')} body={t('next.remoteSources.emptyHelp')}/>}
      {state.sources.map(source => <View key={source.id} testID={`remote-source-${source.id}`} style={{paddingVertical: 16, borderBottomWidth: 1, borderBottomColor: theme.colors.line, gap: 6}}>
        <Text style={[theme.type.bodyStrong, {color: theme.colors.text}]}>{source.name}</Text>
        <Text style={[theme.type.caption, {color: theme.colors.textSecondary}]}>{sourceStateText(t, id => defaultI18n.has(id), source)}</Text>
        {!!source.origin && <Text style={[theme.type.caption, {color: theme.colors.textSecondary}]}>{source.origin}</Text>}
        <Button variant="text" disabled={blocked} onPress={() => open({kind: 'detail', source})}>{t('next.remoteSources.manage')}</Button>
      </View>)}
    </>}
  </ScrollView>;
}
