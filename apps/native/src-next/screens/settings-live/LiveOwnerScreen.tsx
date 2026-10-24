import React, {useEffect, useMemo, useRef, useState, useSyncExternalStore} from 'react';
import {ScrollView, Text, View} from 'react-native';
import {defaultI18n} from '../../../../../packages/i18n/src';
import {importSkipped, liveSourceState} from '../../../../../packages/client-core/src/server-admin/live-words';
import type {LiveDefaults, LiveSource} from './live-owner-model';
import {Button, Focusable, Switch, Tabs, TextField} from '../../kit/controls';
import {Dialog, Menu} from '../../kit/overlays';
import {ServerHeader} from '../../kit/shell';
import {StateView} from '../../kit/states';
import {shellType} from '../../kit/shell/visual';
import {useTheme} from '../../kit/theme';
import type {NativeShellRuntime} from '../../shell/runtime';
import type {NativeSettingsLivePorts} from './ports';
import type {NativeLiveOwnerController} from './live-owner-controller';
import type {NativeRecordingsController} from './recordings-controller';
import {AddSourceSheet, DiscoverSheet} from './LiveOwnerSheets';
import {ChannelMapSheet, SourceSettingsSheet} from './LiveOwnerSettingsSheets';
import {NativeRecordingOwner} from './LiveOwnerRecording';
import {NativeLibraryChannelsPanel} from './server/LibraryChannelsPanel';


/** Settings › Server › Live TV & Channels: the owner's real sources and recordings.
 * Every read and write is the server's; a row never shows a change it did not accept. */
export function NativeLiveOwnerScreen({controller, recordings, ports, runtime, onClose}: {controller: NativeLiveOwnerController; recordings: NativeRecordingsController; ports: Pick<NativeSettingsLivePorts, 'context' | 'requestId'>; runtime: NativeShellRuntime; onClose: () => void}) {
  const theme = useTheme(), t = runtime.text.t;
  const state = useSyncExternalStore(controller.subscribe, controller.getSnapshot);
  const [tab, setTab] = useState('sources');
  const [addMenu, setAddMenu] = useState(false), [adding, setAdding] = useState(false), [discovering, setDiscovering] = useState(false), [tuner, setTuner] = useState<string>();
  const addButton = useRef<View | null>(null);
  const [menu, setMenu] = useState<LiveSource>(), [configure, setConfigure] = useState<LiveSource>(), [mapping, setMapping] = useState<LiveSource>(), [remove, setRemove] = useState<LiveSource>();
  const [removing, setRemoving] = useState(false);
  const menuOpener = useRef<View | null>(null), rowOpeners = useRef(new Map<string, View>());
  const role = ports.context.account.account.role === 'owner' ? 'owner' as const : ports.context.account.account.role === 'admin' ? 'administrator' as const : 'member' as const;
  useEffect(() => {void controller.ensure();}, [controller]);
  const sources = state.list?.sources ?? [];
  const refresh = (id: string) => state.list?.refresh.find(value => value.sourceId === id);
  const removeSource = async () => {
    if (!remove || removing) return;
    setRemoving(true);
    await controller.removeSource(remove.id);
    setRemoving(false);
    if (controller.lifetime.current()) setRemove(undefined);
  };
  const menuItems = menu ? [
    {id: 'settings', icon: 'i-sliders' as const, label: t('web.liveTv.sourceSettings'), onSelect: () => setConfigure(menu)},
    {id: 'channels', icon: 'i-list' as const, label: t('web.liveTv.channelsAndNumbers'), onSelect: () => setMapping(menu)},
    ...(menu.state !== 'disabled' ? [{id: 'refresh', icon: 'i-refresh' as const, label: t('web.liveTv.refreshGuideNow'), onSelect: () => {void controller.refreshSource(menu.id);}}] : []),
    {id: 'toggle', icon: menu.state === 'disabled' ? 'i-play' as const : 'i-pause' as const, label: t(menu.state === 'disabled' ? 'web.liveTv.enableSource' : 'web.liveTv.pauseSource'), onSelect: () => {void controller.setEnabled(menu.id, menu.state === 'disabled');}},
    {id: 'separator', separator: true as const},
    {id: 'remove', icon: 'i-trash' as const, label: t('web.liveTv.removeSource'), destructive: true, onSelect: () => setRemove(menu)},
  ] : [];
  return <View style={{flex: 1, backgroundColor: theme.colors.ink}}>
    <ScrollView contentContainerStyle={{paddingBottom: 100}} keyboardShouldPersistTaps="handled">
      <View style={{paddingHorizontal: 20, paddingTop: 8, gap: 10}}>
        <Button testID="live-owner-back" variant="text" size="small" icon="i-left" onPress={onClose}>{t('next.shell.settings')}</Button>
        <Text accessibilityRole="header" style={[shellType(32, 800, 36.8, -.035), {color: theme.colors.text}]}>{t('settings.server.live')}</Text>
        <ServerHeader variant="phone" serverName={ports.context.serverName} viewerRole={role} audience="owner" testID="live-owner-server"/>
      </View>
      <Tabs testID="live-owner-tabs" value={tab} onValueChange={setTab} items={[{value: 'sources', label: t('settings.server.liveSources')}, {value: 'recording', label: t('settings.server.recording')}, {value: 'channels', label: t('settings.server.libraryChannels')}]}/>
      {tab === 'sources'
        ? <View style={{paddingHorizontal: 20, paddingTop: 18, gap: 22}}>
          <Text style={[shellType(14), {color: theme.colors.textSecondary, lineHeight: 21}]}>{t('web.liveTv.sourcesLede')}</Text>
          <Button ref={addButton} testID="live-owner-add" icon="i-plus" onPress={() => setAddMenu(true)}>{t('web.liveTv.addSource')}</Button>
          <View style={{gap: 10}}>
            <View style={{flexDirection: 'row', alignItems: 'baseline'}}>
              <Text style={[shellType(13, 700), {color: theme.colors.textTertiary, flex: 1}]}>{t('web.liveTv.sources')}</Text>
              {state.checkedAt !== undefined && <Text style={[shellType(12.5), {color: theme.colors.textTertiary}]}>{t('web.servers.checked', {when: defaultI18n.relativeTime(state.checkedAt)})}</Text>}
            </View>
            {state.loading && !state.list && <StateView title={t('web.librarySettings.loading')}/>}
            {state.error !== undefined && <StateView testID="live-owner-error" {...runtime.error(state.error, () => {void controller.load();})}/>}
            {state.list && !sources.length && <View testID="live-owner-empty" style={{backgroundColor: theme.colors.raised, borderRadius: 16, padding: 24, alignItems: 'center', gap: 10}}>
              <Text style={[shellType(17, 700), {color: theme.colors.text}]}>{t('web.live.empty.noSourcesTitle')}</Text>
              <Text style={[shellType(13.5), {color: theme.colors.textSecondary, textAlign: 'center', lineHeight: 20}]}>{t('web.liveTv.noSourcesHelp')}</Text>
              <Button testID="live-owner-empty-add" icon="i-plus" onPress={() => setAdding(true)}>{t('web.liveTv.addSource')}</Button>
            </View>}
            {state.notice && <Text style={[shellType(13), {color: theme.colors.healthy}]}>{state.notice}</Text>}
            {sources.map(source => {
              const status = liveSourceState(source, refresh(source.id)), skipped = importSkipped(t, id => defaultI18n.has(id), source.diagnostics);
              return <View key={source.id} style={{backgroundColor: theme.colors.raised, borderRadius: 14, padding: 14, gap: 8}}>
                <View style={{flexDirection: 'row', alignItems: 'flex-start', gap: 12}}>
                  <Focusable testID={`live-owner-source-${source.id}`} focusKind="row" accessibilityRole="button" accessibilityLabel={source.name} onPress={() => setConfigure(source)} style={{flex: 1, gap: 4}}>
                    <Text style={[shellType(16, 700), {color: theme.colors.text}]} numberOfLines={2}>{source.name}</Text>
                    <Text style={[shellType(12.5), {color: theme.colors.textSecondary}]}>{[t('server.live.channelCount', {count: source.channels}), t('server.live.programCount', {count: source.programmes})].join(' · ')}</Text>
                    {source.tunerCount > 0 && <Text style={[shellType(12.5), {color: theme.colors.textSecondary}]}>{t(source.tunerCountMode === 'discovered' ? 'web.liveTv.tunersDetected' : 'server.live.tunerCount', {count: source.tunerCount})}</Text>}
                    {source.publishedAt && <Text style={[shellType(12.5), {color: theme.colors.textTertiary}]}>{t('server.live.guideUpdated', {when: defaultI18n.dateTime(source.publishedAt)})}</Text>}
                    <View style={{flexDirection: 'row', alignItems: 'center', gap: 6, marginTop: 2}}>
                      <View style={{width: 7, height: 7, borderRadius: 4, backgroundColor: theme.colors[status.tone === 'healthy' ? 'healthy' : status.tone === 'warning' ? 'amber' : status.tone === 'danger' ? 'record' : 'textTertiary']}}/>
                      <Text style={[shellType(12.5, 700), {color: theme.colors[status.tone === 'healthy' ? 'healthy' : status.tone === 'warning' ? 'amber' : status.tone === 'danger' ? 'record' : 'textTertiary']}]}>{t(status.id)}</Text>
                    </View>
                  </Focusable>
                  <Focusable ref={node => {if (node) rowOpeners.current.set(source.id, node); else rowOpeners.current.delete(source.id);}} focusKind="button" accessibilityRole="button" accessibilityLabel={t('server.row.actions', {name: source.name})} onPress={() => {menuOpener.current = rowOpeners.current.get(source.id) ?? null; setMenu(source);}} style={{width: 40, height: 40, alignItems: 'center', justifyContent: 'center'}}>
                    <Text style={[shellType(18, 800), {color: theme.colors.textSecondary}]}>⋯</Text>
                  </Focusable>
                </View>
                {skipped && <Text testID={`live-owner-skipped-${source.id}`} style={[shellType(12.5), {color: theme.colors.amber, lineHeight: 18}]}>{[skipped.summary, ...skipped.reasons].join(' ')}</Text>}
              </View>;
            })}
          </View>
          <LiveDefaultsSection controller={controller} runtime={runtime}/>
        </View>
        : tab === 'channels' ? <NativeLibraryChannelsPanel ports={ports} runtime={runtime}/>
        : <NativeRecordingOwner controller={controller} recordings={recordings} runtime={runtime} sources={sources}/>}
    </ScrollView>
    <Menu open={menu !== undefined} onOpenChange={value => {if (!value) setMenu(undefined);}} title={menu?.name} anchorRef={menuOpener} presentation="sheet" items={menuItems} testID="live-owner-menu"/>
    <Menu open={addMenu} onOpenChange={setAddMenu} title={t('web.liveTv.addSource')} anchorRef={addButton} presentation="sheet" testID="live-owner-add-menu" items={[
      {id: 'remote', icon: 'i-live', label: t('web.liveTv.remoteSource'), description: t('web.liveTv.remoteSourceMeta'), onSelect: () => {setTuner(undefined); setAdding(true);}},
      {id: 'discover', icon: 'i-search', label: t('web.liveTv.discover'), description: t('web.liveTv.discoverMeta'), onSelect: () => setDiscovering(true)},
    ]}/>
    <AddSourceSheet controller={controller} runtime={runtime} open={adding} tuner={tuner} onOpenChange={setAdding} onSaved={() => {setAdding(false); void controller.load(true);}}/>
    <DiscoverSheet controller={controller} runtime={runtime} open={discovering} onOpenChange={setDiscovering} onUse={address => {setTuner(address); setAdding(true);}}/>
    <SourceSettingsSheet controller={controller} runtime={runtime} source={configure} sources={sources} open={configure !== undefined} onOpenChange={value => {if (!value) setConfigure(undefined);}} onSaved={() => void controller.load(true)}/>
    <ChannelMapSheet controller={controller} runtime={runtime} source={mapping} open={mapping !== undefined} onOpenChange={value => {if (!value) setMapping(undefined);}}/>
    <Dialog open={remove !== undefined} onOpenChange={value => {if (!value && !removing) setRemove(undefined);}} title={t('web.liveTv.removeTitle', {name: remove?.name ?? ''})} description={t('web.liveTv.removeBody')} testID="live-owner-remove"
      footer={<View style={{flexDirection: 'row', gap: 10}}><Button variant="glass" textStyle={{color: theme.colors.record}} style={{backgroundColor: `${theme.colors.record}29`}} loading={removing} onPress={() => void removeSource()}>{t('web.liveTv.removeSource')}</Button><Button variant="glass" disabled={removing} onPress={() => setRemove(undefined)}>{t('action.cancel')}</Button></View>}>
      <View/>
    </Dialog>
  </View>;
}

/** Server-wide defaults and limits, saved as one document with its real revision. */
function LiveDefaultsSection({controller, runtime}: {controller: NativeLiveOwnerController; runtime: NativeShellRuntime}) {
  const theme = useTheme(), t = runtime.text.t;
  const [document, setDocument] = useState<Readonly<{revision: number; settings: LiveDefaults}>>(), [draft, setDraft] = useState<LiveDefaults>(), [error, setError] = useState<unknown>(), [busy, setBusy] = useState(false), [saved, setSaved] = useState(false);
  useEffect(() => {
    let active = true;
    void controller.liveDefaults().then(value => {if (active) {setDocument(value); setDraft(value.settings);}}, value => {if (active) setError(value);});
    return () => {active = false;};
  }, [controller]);
  const dirty = !!document && !!draft && JSON.stringify(draft) !== JSON.stringify(document.settings);
  const patch = (value: Partial<LiveDefaults>) => {setSaved(false); setDraft(current => current ? {...current, ...value} : current);};
  const save = async () => {
    if (!document || !draft) return;
    setBusy(true); setError(undefined);
    try {const next = await controller.saveLiveDefaults(document.revision, draft); setDocument(next); setDraft(next.settings); setSaved(true);}
    catch (failure) {setError(failure);}
    finally {setBusy(false);}
  };
  return <View style={{gap: 14, paddingHorizontal: 20}}>
    <Text style={[shellType(13, 700), {color: theme.colors.textTertiary}]}>{t('web.dvrSettings.liveDefaults')}</Text>
    <Text style={[shellType(13), {color: theme.colors.textSecondary}]}>{t('web.dvrSettings.liveDefaultsLede')}</Text>
    {error !== undefined && <StateView testID="live-owner-defaults-error" {...runtime.error(error, () => setError(undefined))}/>}
    {!document && error === undefined && <Text style={[shellType(13), {color: theme.colors.textTertiary}]}>{t('web.librarySettings.loading')}</Text>}
    {draft && document && <View style={{gap: 12, backgroundColor: theme.colors.raised, borderRadius: 14, padding: 14}}>
      <TextField testID="live-owner-defaults-buffer" label={t('web.dvrSettings.buffer')} description={t('web.dvrSettings.bufferHelp')} keyboardType="number-pad" value={String(draft.streamBufferMs / 1000)} onChangeText={value => patch({streamBufferMs: Math.max(0, Math.round(Number(value) || 0)) * 1000})}/>
      <TextField testID="live-owner-defaults-retry" label={t('web.dvrSettings.retryWindow')} description={t('web.dvrSettings.retryWindowHelp')} keyboardType="number-pad" value={String(draft.retryWindowMs / 1000)} onChangeText={value => patch({retryWindowMs: Math.max(0, Math.round(Number(value) || 0)) * 1000})}/>
      <TextField testID="live-owner-defaults-days" label={t('web.dvrSettings.guideDays')} description={t('web.dvrSettings.guideDaysHelp')} keyboardType="number-pad" value={String(draft.guideDays)} onChangeText={value => patch({guideDays: Math.max(1, Math.round(Number(value) || 1))})}/>
      <TextField testID="live-owner-defaults-agent" label={t('web.dvrSettings.userAgent')} description={t('web.dvrSettings.userAgentHelp')} value={draft.userAgent} autoCapitalize="none" autoCorrect={false} onChangeText={userAgent => patch({userAgent})}/>
      <View style={{flexDirection: 'row', alignItems: 'center', gap: 12}}><Text style={[shellType(15, 600), {color: theme.colors.text, flex: 1}]}>{t('web.dvrSettings.logoImport')}</Text><Switch testID="live-owner-defaults-logos" accessibilityLabel={t('web.dvrSettings.logoImport')} checked={draft.logoImport} onCheckedChange={logoImport => patch({logoImport})}/></View>
      <View style={{flexDirection: 'row', alignItems: 'center', gap: 12}}><View style={{flex: 1}}><Text style={[shellType(15, 600), {color: theme.colors.text}]}>{t('web.dvrSettings.discovery')}</Text><Text style={[shellType(12.5), {color: theme.colors.textTertiary}]}>{t('web.dvrSettings.discoveryHelp')}</Text></View><Switch testID="live-owner-defaults-discovery" accessibilityLabel={t('web.dvrSettings.discovery')} checked={draft.discoveryEnabled} onCheckedChange={discoveryEnabled => patch({discoveryEnabled})}/></View>
    </View>}
    {draft && document && <>
      <Text style={[shellType(13, 700), {color: theme.colors.textTertiary}]}>{t('server.live.limits')}</Text>
      <Text style={[shellType(13), {color: theme.colors.textSecondary}]}>{t('server.live.limitsLede')}</Text>
      <View style={{gap: 12, backgroundColor: theme.colors.raised, borderRadius: 14, padding: 14}}>
        <TextField testID="live-owner-defaults-channels" label={t('server.live.limitChannels')} keyboardType="number-pad" value={String(draft.importLimits.channels)} onChangeText={value => patch({importLimits: {...draft.importLimits, channels: Math.max(1, Math.round(Number(value) || 1))}})}/>
        <TextField testID="live-owner-defaults-programmes" label={t('server.live.limitProgrammes')} keyboardType="number-pad" value={String(draft.importLimits.programmes)} onChangeText={value => patch({importLimits: {...draft.importLimits, programmes: Math.max(1, Math.round(Number(value) || 1))}})}/>
        <TextField testID="live-owner-defaults-size" label={`${t('server.live.limitSize')} (${t('settings.unit.mb')})`} keyboardType="number-pad" value={String(Math.round(draft.importLimits.bytes / 1048576))} onChangeText={value => patch({importLimits: {...draft.importLimits, bytes: Math.max(1, Math.round(Number(value) || 1)) * 1048576}})}/>
      </View>
      <View style={{flexDirection: 'row', gap: 10, alignItems: 'center'}}>
        <Button testID="live-owner-defaults-save" loading={busy} disabled={!dirty} onPress={() => void save()}>{t('action.save')}</Button>
        {saved && <Text style={[shellType(13), {color: theme.colors.healthy}]}>{t('server.live.saved')}</Text>}
      </View>
    </>}
  </View>;
}
