import React, {useCallback, useEffect, useState} from 'react';
import {ScrollView, Text, View} from 'react-native';
import {loadResourceUsage} from '../../../../../../packages/client-core/src/server-admin/server-forms';
import {defaultI18n} from '../../../../../../packages/i18n/src';
import {Tabs} from '../../../kit/controls/Tabs';
import {ServerHeader} from '../../../kit/shell/ServerIdentity';
import {shellType} from '../../../kit/shell/visual';
import {useTheme} from '../../../kit/theme';
import type {NativeSettingsLivePorts} from '../ports';
import type {NativeShellRuntime} from '../../../shell/runtime';
import {LimitsTab} from './storage/LimitsTab';
import {BackupsTab} from './storage/BackupsTab';
import {MissingTitlesTab} from './storage/MissingTitlesTab';
import {NativeStorageSpaceUsage} from './storage/SpaceUsage';
import {NativeEmptyCache} from './storage/EmptyCache';
import {useSettingsRequestScope} from '../use-settings-request-scope';

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
export function NativeServerStorage({ports, runtime, compactHeader = false}: {ports: NativeSettingsLivePorts; runtime: NativeShellRuntime; compactHeader?: boolean}) {
  const theme = useTheme(), t = runtime.text.t as Translate, context = ports.context;
  const viewerRole: ViewerRole = context.account.account.role === 'owner' ? 'owner' : context.account.canManage ? 'administrator' : 'member';
  const [tab, setTab] = useState('space');
  return <View style={{flex: 1}}>
    <ScrollView contentContainerStyle={{paddingHorizontal: 20, paddingBottom: 40}}>
      <ServerHeader serverName={context.serverName} viewerRole={viewerRole} audience={viewerRole === 'administrator' ? 'administrators' : 'owner'} variant="phone" style={{marginBottom: 12}}/>
      {!compactHeader && <Text accessibilityRole="header" style={[shellType(28, 800, 33, -.03), {color: theme.colors.text}]}>{t('settings.server.storage')}</Text>}
      <Tabs testID="server-storage-tabs" style={{marginTop: 12, marginHorizontal: -20}} value={tab} onValueChange={setTab} accessibilityLabel={t('settings.server.storage')}
        items={[{value: 'space', label: t('server.space')}, {value: 'limits', label: t('server.limitsAndRetention')}, {value: 'backups', label: t('settings.server.backups')}, {value: 'missing', label: t('settings.server.missingTitles')}]}/>
      {tab === 'space' && <SpaceTab ports={ports} runtime={runtime} t={t}/>}
      <NativeEmptyCache context={context} runtime={runtime} visible={tab === 'space'}/>
      {tab === 'limits' && <LimitsTab ports={ports} runtime={runtime} t={t}/>}
      {tab === 'backups' && <BackupsTab ports={ports} runtime={runtime} t={t}/>}
      {tab === 'missing' && <MissingTitlesTab ports={ports} runtime={runtime} t={t}/>}
    </ScrollView>
  </View>;
}

function SpaceTab({ports, runtime, t}: {ports: NativeSettingsLivePorts; runtime: NativeShellRuntime; t: Translate}) {
  const theme = useTheme(), context = ports.context;
  const {api}=useSettingsRequestScope(context);
  const usage=useRead(()=>loadResourceUsage(api),[api]);
  const used = (part: {trackedBytes: number; limitBytes: number; measured: boolean}) => part.measured ? t('server.usage.ofLimit', {used: defaultI18n.bytes(part.trackedBytes), limit: defaultI18n.bytes(part.limitBytes)}) : t('server.usage.notMeasuredYet');
  return <View style={{marginTop:14}} testID="server-storage-space">
    <NativeStorageSpaceUsage context={context} runtime={runtime}/>
    {usage.data ? <>
      <Text style={[shellType(17, 800), {color: theme.colors.text, marginTop: 22}]}>{t('server.usage.title')}</Text>
      <View style={{marginTop: 10, borderRadius: 14, overflow: 'hidden', backgroundColor: theme.colors.raised}}>
        <UsageRow label={t('server.usage.streams')} value={usage.data.streamLimit ? t('server.usage.countOf', {used: usage.data.streams, limit: usage.data.streamLimit}) : String(usage.data.streams)}/>
        {usage.data.connections ? <UsageRow label={t('server.usage.connections')} value={t('server.usage.countOf', {used: usage.data.connections.ordinary, limit: usage.data.connections.ordinaryLimit})} description={t('server.usage.connectionsHelp', {reserve: usage.data.connections.consoleReserve})}/> : null}
        <UsageRow label={t('server.usage.analysis')} value={used(usage.data.analysis)}/>
        <UsageRow label={t('server.usage.artwork')} value={used(usage.data.localArtwork)}/>
      </View>
    </> : null}
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
