import React, {useCallback, useEffect, useLayoutEffect, useRef, useState, useSyncExternalStore} from 'react';
import {ScrollView, Text, View} from 'react-native';
import {defaultI18n} from '../../../../../../packages/i18n/src';
import {sourceStateText} from '../../../../../../packages/client-core/src/server-admin/storage-words';
import type {RemoteSource, RemoteState} from '../../../../../../packages/client-core/src/remote-sources';
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
type FoldersMode = {kind: 'folders'; source: RemoteSource; chosen: readonly ChosenSourceFolder[]; from: 'detail' | 'assignment'};
type Mode = {kind: 'assignment'; source: RemoteSource; folders: readonly ChosenSourceFolder[]} | FoldersMode | {kind: 'choose' | 'accountConfig'} | {kind: 'connection' | 'imported' | 's3' | 'drive' | 'cloud' | 'driveOAuth'; source?: RemoteSource} | {kind: 'detail' | 'reading' | 'disconnect' | 'advanced'; source: RemoteSource};
/** One drawn subpage and its owner. A callback may only move the exact opening it was drawn for. */
type Opening = Readonly<{id: number; mode: Mode; owner: {live: boolean}; mounted: {live: boolean}}>;

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
  const [opening, setOpening] = useState<Opening>(), [error, setError] = useState<string>();
  const attempt = useRef(0), openingRef = useRef<Opening | undefined>(undefined), mounted = useRef<{live: boolean}>({live: false});
  const rootRevision = useRef(0);
  const mode = opening?.mode;
  const show = (next: Mode) => {
    const previous = openingRef.current;
    if (previous) previous.owner.live = false;
    const created: Opening = {id: ++attempt.current, mode: next, owner: {live: true}, mounted: mounted.current};
    rootRevision.current++;
    openingRef.current = created; setOpening(created); setError(undefined);
  };
  // A root Add/Manage press must still belong to the root render that offered it: the same
  // mount, the same list snapshot, no later subpage, and (Manage) the same source generation.
  const showRoot = (next: Mode, root: RemoteState, mount: {live: boolean}, revision: number, source?: RemoteSource) => {
    if (mounted.current !== mount || !mount.live || rootRevision.current !== revision) return;
    if (openingRef.current !== undefined || !controller.getSnapshot().allowed) return;
    if (controller.getSnapshot().sources !== root) return;
    if (source && !root.sources.some(row => row.id === source.id && row.generation === source.generation)) return;
    show(next);
  };
  const closeFrom = (from: Opening) => {
    if (!from.owner.live || !from.mounted.live || openingRef.current !== from) return;
    from.owner.live = false; openingRef.current = undefined; attempt.current++; rootRevision.current++;
    setOpening(undefined); setError(undefined);
  };
  const navigate = (from: Opening, next: Mode) => {
    if (!from.owner.live || !from.mounted.live || openingRef.current !== from) return;
    const fromSource = 'source' in from.mode ? from.mode.source : undefined;
    const nextSource = 'source' in next ? next.source : undefined;
    if (fromSource && nextSource && (fromSource.id !== nextSource.id || fromSource.generation !== nextSource.generation)) return;
    // If the live list knows this source at another generation, a retained opening is stale.
    if (fromSource) {
      const rows = controller.getSnapshot().sources.sources;
      if (rows.some(row => row.id === fromSource.id) && !rows.some(row => row.id === fromSource.id && row.generation === fromSource.generation)) return;
    }
    show(next);
  };
  // An accepted create or edit may advance the source generation; its own form guard
  // already proved the opening, so only the exact id is required here.
  const saved = (from: Opening, source: RemoteSource) => {
    if (!from.owner.live || !from.mounted.live || openingRef.current !== from) return;
    const fromSource = 'source' in from.mode ? from.mode.source : undefined;
    if (fromSource && fromSource.id !== source.id) return;
    show({kind: 'reading', source});
  };
  const back = () => {
    const current = openingRef.current;
    if (!current || !current.owner.live || !current.mounted.live) return;
    if (current.mode.kind === 'folders') {
      if (current.mode.from === 'assignment') navigate(current, {kind: 'assignment', source: current.mode.source, folders: current.mode.chosen});
      else navigate(current, {kind: 'detail', source: current.mode.source});
    } else if (current.mode.kind === 'assignment') {
      navigate(current, {kind: 'detail', source: current.mode.source});
    } else closeFrom(current);
  };
  useLayoutEffect(() => {
    const token = {live: true};
    mounted.current = token;
    return () => {
      token.live = false;
      const current = openingRef.current;
      if (current && current.mounted === token) {
        current.owner.live = false;
        openingRef.current = undefined;
      }
    };
  }, []);
  const subpage = snapshot.allowed && !!opening;
  useEffect(() => {
    onBackHandlerChange?.(subpage ? () => {if (!openingRef.current) return false; back(); return true;} : undefined);
    return () => onBackHandlerChange?.(undefined);
  }, [subpage, onBackHandlerChange]);
  const captured = attempt.current;
  const isCurrent = useCallback(() => controller.getSnapshot().allowed && attempt.current === captured, [controller, captured]);
  if (!snapshot.allowed) {
    const problem = presentError({code: 'forbidden'}, 'server-console');
    return <StateView title={problem.title} body={problem.body} tone="error"/>;
  }
  if (mode?.kind === 'choose') return <Page title={t('next.remoteSources.whatToConnect')} t={t} busy={false} onCancel={() => closeFrom(opening!)} footer={null}>
    <Button variant="glass" onPress={() => navigate(opening!, {kind: 'connection'})}>{t('next.remoteSources.connectWebdav')}</Button>
    <Button variant="glass" onPress={() => navigate(opening!, {kind: 'cloud'})}>{t('next.remoteSources.connectCloud')}</Button>
    <Button variant="glass" onPress={() => navigate(opening!, {kind: 'driveOAuth'})}>{t('next.remoteSources.driveOAuth')}</Button>
    <Button variant="glass" onPress={() => navigate(opening!, {kind: 'drive'})}>{t('next.remoteSources.connectDrive')}</Button>
    <Button variant="glass" onPress={() => navigate(opening!, {kind: 's3'})}>{t('next.remoteSources.connectS3')}</Button>
    <Button variant="glass" onPress={() => navigate(opening!, {kind: 'imported'})}>{t('next.remoteSources.connectRclone')}</Button>
    <Button variant="glass" onPress={() => navigate(opening!, {kind: 'accountConfig'})}>{t('next.remoteSources.connectFromConfig')}</Button>
  </Page>;
  if (mode?.kind === 'accountConfig') return <AccountConfigEditor controller={controller} t={t} isCurrent={isCurrent} onCancel={() => closeFrom(opening!)}
    onSaved={source => saved(opening!, source)}/>;
  if (mode?.kind === 'imported' || mode?.kind === 's3' || mode?.kind === 'drive' || mode?.kind === 'driveOAuth' || mode?.kind === 'cloud') return <ImportedSourceEditor form={mode.kind} key={mode.source?.id ?? mode.kind} controller={controller} source={mode.source} t={t} isCurrent={isCurrent}
    onCancel={() => closeFrom(opening!)} onSaved={source => saved(opening!, source)}/>;
  if (mode?.kind === 'connection') return <ConnectionEditor key={mode.source?.id ?? 'new'} controller={controller} source={mode.source} t={t} isCurrent={isCurrent} onCancel={() => closeFrom(opening!)}
    onSaved={source => saved(opening!, source)}/>;
  if (mode?.kind === 'assignment') return <SourceLibraryAssignment controller={controller} source={mode.source} folders={mode.folders} t={t} isCurrent={isCurrent}
    onCancel={() => navigate(opening!, {kind: 'detail', source: mode.source})}
    onChooseFolders={() => navigate(opening!, {kind: 'folders', source: mode.source, chosen: mode.folders, from: 'assignment'})}
    onOpen={() => navigate(opening!, {kind: 'detail', source: mode.source})}
    onAddAnother={() => navigate(opening!, {kind: 'choose'})}/>;
  if (mode?.kind === 'advanced') return <SourceAdvancedEditor key={`${mode.source.id}:${mode.source.generation}`} controller={controller} source={mode.source} t={t} isCurrent={isCurrent} onCancel={() => closeFrom(opening!)}/>;
  if (mode?.kind === 'folders') return <SourceFolderBrowser key={`${mode.source.id}:${mode.source.generation}`} controller={controller} source={mode.source} t={t} isCurrent={isCurrent}
    initial={mode.chosen}
    onCancel={() => mode.from === 'assignment'
      ? navigate(opening!, {kind: 'assignment', source: mode.source, folders: mode.chosen})
      : navigate(opening!, {kind: 'detail', source: mode.source})}
    onChoose={folders => navigate(opening!, {kind: 'assignment', source: mode.source, folders})}/>;
  if (mode?.kind === 'reading') return <ReadingEditor key={mode.source.id} controller={controller} source={mode.source} t={t} isCurrent={isCurrent} onCancel={() => closeFrom(opening!)} onSaved={() => closeFrom(opening!)}/>;
  if (mode?.kind === 'disconnect') return <DisconnectEditor key={mode.source.id} controller={controller} source={mode.source} t={t} isCurrent={isCurrent} onCancel={() => closeFrom(opening!)} onSaved={() => closeFrom(opening!)}/>;
  const state = snapshot.sources, rootMount = mounted.current, rootRevisionAtRender = rootRevision.current;
  const needsReceipt = receiptCheckRequired(state), blocked = state.busy || needsReceipt;
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
      <Button variant="text" onPress={() => closeFrom(opening!)}>{t('next.remoteSources.back')}</Button>
      <Button variant="glass" disabled={blocked} onPress={() => navigate(opening!, {kind: 'advanced', source: selected})}>{t('next.remoteSources.advanced')}</Button>
      <Button variant="glass" disabled={blocked} onPress={() => navigate(opening!, {kind: 'folders', source: selected, chosen: [], from: 'detail'})}>{t('next.remoteSources.foldersSection')}</Button>
      <Button variant="glass" disabled={blocked} onPress={() => navigate(opening!, {kind: 'reading', source: selected})}>{t('next.remoteSources.reading')}</Button>
      {(selected.kind === 'webdav' || selected.kind === 'rclone') && <>
        <Button variant="glass" disabled={blocked} onPress={() => navigate(opening!, {kind: selected.kind === 'rclone' ? 'imported' : 'connection', source: selected})}>{t('next.remoteSources.connection')}</Button>
        <Button variant="text" disabled={blocked} onPress={() => navigate(opening!, {kind: 'disconnect', source: selected})}>{t('next.remoteSources.disconnect')}</Button>
      </>}
    </> : <>
      <Button disabled={blocked} onPress={() => showRoot({kind: 'choose'}, state, rootMount, rootRevisionAtRender)}>{t('next.remoteSources.add')}</Button>
      <Button variant="text" disabled={blocked || state.loading} onPress={() => {void controller.load();}}>{t('next.remoteSources.refresh')}</Button>
      {state.loading && <Text style={[theme.type.body, {color: theme.colors.textSecondary}]}>{t('next.remoteSources.loading')}</Text>}
      {!state.loading && !state.error && !state.sources.length && <StateView title={t('next.remoteSources.empty')} body={t('next.remoteSources.emptyHelp')}/>}
      {state.sources.map(source => <View key={source.id} testID={`remote-source-${source.id}`} style={{paddingVertical: 16, borderBottomWidth: 1, borderBottomColor: theme.colors.line, gap: 6}}>
        <Text style={[theme.type.bodyStrong, {color: theme.colors.text}]}>{source.name}</Text>
        <Text style={[theme.type.caption, {color: theme.colors.textSecondary}]}>{sourceStateText(t, id => defaultI18n.has(id), source)}</Text>
        {!!source.origin && <Text style={[theme.type.caption, {color: theme.colors.textSecondary}]}>{source.origin}</Text>}
        <Button variant="text" disabled={blocked} onPress={() => showRoot({kind: 'detail', source}, state, rootMount, rootRevisionAtRender, source)}>{t('next.remoteSources.manage')}</Button>
      </View>)}
    </>}
  </ScrollView>;
}
