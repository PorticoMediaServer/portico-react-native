import React, {useCallback, useEffect, useState} from 'react';
import {ScrollView, Text, View} from 'react-native';
import {parseStorageReport, type StorageReport, type StorageUsage} from '../../../../../../packages/client-core/src/administration';
import {loadResourceUsage, type ResourceUsage} from '../../../../../../packages/client-core/src/server-admin/server-forms';
import {presentError} from '../../../../../../packages/client-core/src/presentation/errors';
import {defaultI18n} from '../../../../../../packages/i18n/src';
import {Button} from '../../../kit/controls/Button';
import {TextField} from '../../../kit/controls/TextField';
import {Tabs} from '../../../kit/controls/Tabs';
import {BottomSheet} from '../../../kit/overlays/BottomSheet';
import {ServerHeader} from '../../../kit/shell/ServerIdentity';
import {StateView} from '../../../kit/states';
import {shellType} from '../../../kit/shell/visual';
import {useTheme} from '../../../kit/theme';
import type {NativeSettingsLivePorts} from '../ports';
import type {NativeShellRuntime} from '../../../shell/runtime';
import {LimitsTab} from './storage/LimitsTab';
import {BackupsTab} from './storage/BackupsTab';
import {MissingTitlesTab} from './storage/MissingTitlesTab';

type ViewerRole = 'owner' | 'administrator' | 'member';
type Translate = typeof defaultI18n.t;

const useRead = <T,>(read: () => Promise<T>, deps: readonly unknown[]) => {
  const [state, setState] = useState<{data?: T; error?: unknown; loading: boolean}>({loading: true});
  const [revision, setRevision] = useState(0);
  useEffect(() => {
    let live = true;
    setState(current => ({...current, loading: true}));
    void read().then(data => {if (live) setState({data, loading: false});}, error => {if (live) setState(current => ({data: current.data, error, loading: false}));});
    return () => {live = false;};
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [...deps, revision]);
  return {...state, reload: useCallback(() => setRevision(value => value + 1), [])};
};

/** Settings › Server › Storage & backups on the phone (owner-server.html frames 35–37). */
export function NativeServerStorage({ports, runtime}: {ports: NativeSettingsLivePorts; runtime: NativeShellRuntime}) {
  const theme = useTheme(), t = runtime.text.t as Translate, context = ports.context;
  const viewerRole: ViewerRole = context.account.account.role === 'owner' ? 'owner' : context.account.canManage ? 'administrator' : 'member';
  const [tab, setTab] = useState('space');
  return <View style={{flex: 1}}>
    <ScrollView contentContainerStyle={{paddingHorizontal: 20, paddingBottom: 40}}>
      <ServerHeader serverName={context.serverName} viewerRole={viewerRole} audience={viewerRole === 'administrator' ? 'administrators' : 'owner'} variant="phone" style={{marginBottom: 12}}/>
      <Text accessibilityRole="header" style={[shellType(28, 800, 33, -.03), {color: theme.colors.text}]}>{t('settings.server.storage')}</Text>
      <Tabs testID="server-storage-tabs" style={{marginTop: 12, marginHorizontal: -20}} value={tab} onValueChange={setTab} accessibilityLabel={t('settings.server.storage')}
        items={[{value: 'space', label: t('server.space')}, {value: 'limits', label: t('server.limitsAndRetention')}, {value: 'backups', label: t('settings.server.backups')}, {value: 'missing', label: t('settings.server.missingTitles')}]}/>
      {tab === 'space' && <SpaceTab ports={ports} runtime={runtime} t={t}/>}
      {tab === 'limits' && <LimitsTab ports={ports} runtime={runtime} t={t}/>}
      {tab === 'backups' && <BackupsTab ports={ports} runtime={runtime} t={t}/>}
      {tab === 'missing' && <MissingTitlesTab ports={ports} runtime={runtime} t={t}/>}
    </ScrollView>
  </View>;
}

function SpaceTab({ports, runtime, t}: {ports: NativeSettingsLivePorts; runtime: NativeShellRuntime; t: Translate}) {
  const theme = useTheme(), context = ports.context;
  const api = {request: <T,>(path: string, method?: string, body?: unknown, signal?: AbortSignal) => context.api.request<T>(path, method, body, signal)};
  const report = useRead(() => api.request<unknown>('/v1/admin/storage-usage').then(parseStorageReport), [context]);
  const usage = useRead(() => loadResourceUsage(api), [context]);
  const [chosen, setChosen] = useState<StorageUsage>(), [days, setDays] = useState('30'), [typed, setTyped] = useState(''), [busy, setBusy] = useState(false), [failure, setFailure] = useState<unknown>();
  const close = () => {if (busy) return; setChosen(undefined); setTyped(''); setFailure(undefined);};
  const cleanUp = () => {
    if (!chosen) return;
    setBusy(true); setFailure(undefined);
    const body = {olderThanDays: Math.max(0, Number(days) || 0), confirmation: chosen.id, operationId: ports.requestId()};
    void api.request(`/v1/admin/storage-usage/${encodeURIComponent(chosen.id)}/cleanup`, 'POST', body)
      .then(() => {setBusy(false); setChosen(undefined); setTyped(''); report.reload();}, error => {setBusy(false); setFailure(error);});
  };
  const used = (part: {trackedBytes: number; limitBytes: number; measured: boolean}) => part.measured ? t('server.usage.ofLimit', {used: defaultI18n.bytes(part.trackedBytes), limit: defaultI18n.bytes(part.limitBytes)}) : t('server.usage.notMeasuredYet');
  const problem = failure === undefined ? undefined : presentError(failure, 'server-console').body;
  const doc: StorageReport | undefined = report.data;
  return <View style={{marginTop: 14}} testID="server-storage-space">
    {report.error !== undefined && !doc ? <StateView {...runtime.error(report.error, report.reload)}/> : null}
    {doc ? <>
      <Text style={[shellType(17, 800), {color: theme.colors.text}]}>{t('settings.server.diskUsage')}</Text>
      <Text style={[shellType(13, 400, 18), {color: theme.colors.textSecondary, marginTop: 4}]}>{t('web.maintenance.storageLede')}</Text>
      <View style={{marginTop: 10, borderRadius: 14, overflow: 'hidden', backgroundColor: theme.colors.raised}}>
        <View style={{flexDirection: 'row', justifyContent: 'space-between', paddingHorizontal: 14, paddingVertical: 12}}>
          <Text style={[shellType(15, 700), {color: theme.colors.text}]}>{t('web.maintenance.totalLabel')}</Text>
          <Text style={[shellType(15, 700), {color: theme.colors.text}]}>{defaultI18n.bytes(doc.totalBytes)}</Text>
        </View>
        {doc.categories.filter(category => category.present).map(category => <View key={category.id} style={{paddingHorizontal: 14, paddingVertical: 11, borderTopWidth: 1, borderTopColor: theme.colors.lineSoft}}>
          <View style={{flexDirection: 'row', justifyContent: 'space-between', gap: 10}}>
            <Text style={[shellType(15, 600), {color: theme.colors.text, flex: 1}]}>{category.name}</Text>
            <Text style={[shellType(14, 600), {color: theme.colors.textSecondary}]}>{defaultI18n.bytes(category.bytes)}</Text>
          </View>
          <Text style={[shellType(12.5, 400, 17), {color: theme.colors.textTertiary, marginTop: 2}]}>{category.description}</Text>
          {category.cleanable && category.bytes > 0 ? <View style={{flexDirection: 'row', marginTop: 8}}><Button size="compact" variant="glass" icon="i-trash" onPress={() => {setChosen(category); setDays('30'); setTyped(''); setFailure(undefined);}}>{t('server.cleanUp')}</Button></View> : null}
        </View>)}
      </View>
    </> : null}
    {usage.data ? <>
      <Text style={[shellType(17, 800), {color: theme.colors.text, marginTop: 22}]}>{t('server.usage.title')}</Text>
      <View style={{marginTop: 10, borderRadius: 14, overflow: 'hidden', backgroundColor: theme.colors.raised}}>
        <UsageRow label={t('server.usage.streams')} value={usage.data.streamLimit ? t('server.usage.countOf', {used: usage.data.streams, limit: usage.data.streamLimit}) : String(usage.data.streams)}/>
        {usage.data.connections ? <UsageRow label={t('server.usage.connections')} value={t('server.usage.countOf', {used: usage.data.connections.ordinary, limit: usage.data.connections.ordinaryLimit})} description={t('server.usage.connectionsHelp', {reserve: usage.data.connections.consoleReserve})}/> : null}
        <UsageRow label={t('server.usage.analysis')} value={used(usage.data.analysis)}/>
        <UsageRow label={t('server.usage.artwork')} value={used(usage.data.localArtwork)}/>
      </View>
    </> : null}
    <BottomSheet open={Boolean(chosen)} onOpenChange={open => {if (!open) close();}} testID="server-storage-cleanup" keyboardAvoiding
      title={chosen ? t('web.maintenance.cleanUpTitle', {name: chosen.name}) : undefined}
      description={chosen ? t('web.maintenance.cleanUpBody', {canRecreate: chosen.regenerable ? 'yes' : 'no', id: chosen.name}) : undefined}
      footer={<View style={{flexDirection: 'row', gap: 8}}><Button variant="glass" disabled={busy} onPress={close}>{t('action.cancel')}</Button><Button variant="glass" textStyle={{color: theme.colors.record}} loading={busy} disabled={typed.trim() !== (chosen?.name ?? '')} onPress={cleanUp}>{t('server.cleanUp')}</Button></View>}>
      <View style={{gap: 12}}>
        <TextField label={t('web.maintenance.olderThan')} keyboardType="number-pad" value={days} onChangeText={setDays}/>
        <TextField label={chosen ? t('confirm.typeToConfirm', {token: chosen.name}) : ''} value={typed} onChangeText={setTyped} autoCapitalize="none" autoCorrect={false}/>
        {problem ? <Text accessibilityRole="alert" style={[shellType(13, 600), {color: theme.colors.record}]}>{problem}</Text> : null}
      </View>
    </BottomSheet>
  </View>;
}

function UsageRow({label, value, description}: {label: string; value: string; description?: string}) {
  const theme = useTheme();
  return <View style={{paddingHorizontal: 14, paddingVertical: 11, borderTopWidth: 1, borderTopColor: theme.colors.lineSoft}}>
    <View style={{flexDirection: 'row', justifyContent: 'space-between', gap: 10}}>
      <Text style={[shellType(15, 600), {color: theme.colors.text, flex: 1}]}>{label}</Text>
      <Text style={[shellType(14, 600), {color: theme.colors.textSecondary}]}>{value}</Text>
    </View>
    {description ? <Text style={[shellType(12, 400, 16), {color: theme.colors.textTertiary, marginTop: 2}]}>{description}</Text> : null}
  </View>;
}
