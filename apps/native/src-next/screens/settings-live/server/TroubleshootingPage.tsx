import {NativeReports,useNativeReports} from './troubleshooting/Reports';
import {NativeFeedback,useNativeFeedback} from './troubleshooting/Feedback';
import {NativeMessages} from './troubleshooting/Messages';
import {useSettingsRequestScope} from '../use-settings-request-scope';
import React, {useEffect, useMemo, useState} from 'react';
import {ScrollView, Text, View} from 'react-native';
import {ConsoleClient} from '../../../../../../packages/client-core/src/console';
import {sentence, when} from '../../../../../../packages/client-core/src/server-admin/console-words';
import {presentError} from '../../../../../../packages/client-core/src/presentation/errors';
import {CAPABILITY_BEHIND_PRESENCE, CAPABILITY_ROWS, capabilityReasonId, parseCapabilities, type ServerCapability} from '../../../../../../packages/client-core/src/server-admin/capabilities';
import {resetSkippedParts, skippedParts, skippedVersion, subscribeSkipped} from '../../../../../../packages/client-core/src/tolerant';
import type {SupportExport} from '../../../../../../packages/client-core/src/console';
import {defaultI18n} from '../../../../../../packages/i18n/src';
import type {MessageId} from '../../../../../../packages/i18n/src';
import {Button} from '../../../kit/controls/Button';
import {Tabs} from '../../../kit/controls/Tabs';
import {ServerHeader} from '../../../kit/shell/ServerIdentity';
import {StateView} from '../../../kit/states';
import {shellType} from '../../../kit/shell/visual';
import {useTheme} from '../../../kit/theme';
import type {NativeSettingsLivePorts} from '../ports';
import type {NativeShellRuntime} from '../../../shell/runtime';

type ViewerRole = 'owner' | 'administrator' | 'member';
type Translate = typeof defaultI18n.t;


/** Settings › Server › Troubleshooting on the phone (owner-server.html frame 33). */
export function NativeServerTroubleshooting({ports, runtime, compactHeader = false}: {ports: NativeSettingsLivePorts; runtime: NativeShellRuntime; compactHeader?: boolean}) {
  const theme = useTheme(), t = runtime.text.t as Translate, context = ports.context;
  const {api, authority} = useSettingsRequestScope(context);
  const consoleClient = useMemo(() => new ConsoleClient(api, {serverId: authority.serverId, viewerId: authority.profileId}), [api, authority]);
  useEffect(() => () => consoleClient.dispose(), [consoleClient]);
  const viewerRole: ViewerRole = context.account.account.role === 'owner' ? 'owner' : context.account.canManage ? 'administrator' : 'member';
  const [tab, setTab] = useState('messages');
  const feedback=useNativeFeedback(ports,runtime);
  const reports=useNativeReports(ports,runtime);
  const openReports=feedback.state.reports.filter(report=>report.status==='open'||report.status==='in-progress').length;
  return <View style={{flex: 1}}>
    <ScrollView contentContainerStyle={{paddingHorizontal: 20, paddingBottom: 40}}>
      <ServerHeader serverName={context.serverName} viewerRole={viewerRole} audience={viewerRole === 'administrator' ? 'administrators' : 'owner'} variant="phone" style={{marginBottom: 12}}/>
      {!compactHeader && <Text accessibilityRole="header" style={[shellType(28, 800, 33, -.03), {color: theme.colors.text}]}>{t('settings.server.troubleshooting')}</Text>}
      <Tabs testID="server-troubleshooting-tabs" style={{marginTop: 12, marginHorizontal: -20}} value={tab} onValueChange={setTab} accessibilityLabel={t('settings.server.troubleshooting')}
        items={[{value: 'messages', label: t('web.logs.messages')}, {value: 'feedback', label: openReports ? `${t('server.feedbackTab')} ${openReports}` : t('server.feedbackTab')}, {value: 'reports', label: t('server.reportsTab')}, {value: 'support', label: t('server.support')}]}/>
      {tab === 'messages' && <NativeMessages ports={ports} runtime={runtime}/>}
      {tab === 'feedback' && feedback.group && <NativeFeedback group={feedback.group}/>}
      {tab === 'reports' && reports && <NativeReports group={reports}/>}
      {tab === 'support' && <SupportTab api={api} consoleClient={consoleClient} t={t}/>}
    </ScrollView>
  </View>;
}


function SupportTab({api, consoleClient, t}: {api: {request<T>(path: string, method?: string, body?: unknown, signal?: AbortSignal): Promise<T>}; consoleClient: ConsoleClient; t: Translate}) {
  const theme = useTheme();
  const [capabilities, setCapabilities] = useState<readonly ServerCapability[] | null>(null), [exported, setExported] = useState<SupportExport>();
  const [busy, setBusy] = useState(false), [failure, setFailure] = useState<unknown>();
  React.useSyncExternalStore(subscribeSkipped, skippedVersion);
  const parts = skippedParts();
  useEffect(() => {
    let live = true;
    void api.request<unknown>('/v1/admin/diagnostics/capabilities').then(parseCapabilities, error => ((error as {status?: number} | null)?.status === 404 ? null : Promise.reject(error)))
      .then(value => {if (live) setCapabilities(value);}, error => {if (live) setFailure(error);});
    return () => {live = false;};
  }, [api]);
  const prepare = () => {
    setBusy(true); setFailure(undefined);
    void consoleClient.createExport(Date.now() - 86_400_000, Date.now(), ['runtime', 'audit']).then(value => setExported(value), error => setFailure(error)).finally(() => setBusy(false));
  };
  return <View style={{marginTop: 14}} testID="server-troubleshooting-support">
    {failure !== undefined ? <StateView {...runtimeError(failure)}/> : null}
    <Text style={[shellType(17, 800), {color: theme.colors.text}]}>{t('web.capabilities.title')}</Text>
    <Text style={[shellType(13, 400, 18), {color: theme.colors.textSecondary, marginTop: 4}]}>{t('web.capabilities.help')}</Text>
    <View style={{marginTop: 10, borderRadius: 14, overflow: 'hidden', backgroundColor: theme.colors.raised}}>
      {capabilities ? CAPABILITY_ROWS.map((id, index) => {
        const found = capabilities.find(value => value.capability === id), label = t(`web.capabilities.${id}` as MessageId);
        if (!found && (CAPABILITY_BEHIND_PRESENCE as readonly string[]).includes(id)) return null;
        return <View key={id} style={{paddingHorizontal: 14, paddingVertical: 10, borderTopWidth: index ? 1 : 0, borderTopColor: theme.colors.lineSoft}}>
          <View style={{flexDirection: 'row', justifyContent: 'space-between', gap: 10}}>
            <Text style={[shellType(14.5, 600), {color: theme.colors.text, flex: 1}]}>{label}</Text>
            <Text style={[shellType(12.5, 700), {color: found?.available ? theme.colors.healthy : found ? theme.colors.amber : theme.colors.textTertiary}]}>{found ? t(found.available ? 'web.capabilities.available' : 'web.capabilities.unavailable') : t('web.capabilities.unknown')}</Text>
          </View>
          {found && !found.available ? <Text numberOfLines={3} style={[shellType(12.5, 400, 17), {color: theme.colors.textTertiary, marginTop: 2}]}>{[t(capabilityReasonId(found.code) as MessageId), [found.code, found.detail].filter(Boolean).join(': ')].filter(Boolean).join(' ')}</Text> : null}
        </View>;
      }) : null}
    </View>
    <Text style={[shellType(17, 800), {color: theme.colors.text, marginTop: 22}]}>{t('settings.server.skippedParts')}</Text>
    <Text style={[shellType(13, 400, 18), {color: theme.colors.textSecondary, marginTop: 4}]}>{t('settings.server.skippedPartsLede')}</Text>
    <View style={{marginTop: 10, borderRadius: 14, overflow: 'hidden', backgroundColor: theme.colors.raised}}>
      {parts.length ? [...parts].reverse().map((part, index) => <View key={`${part.document}-${part.part}`} style={{paddingHorizontal: 14, paddingVertical: 10, borderTopWidth: index ? 1 : 0, borderTopColor: theme.colors.lineSoft}}>
        <Text style={[shellType(14, 600), {color: theme.colors.text}]}>{part.document}</Text>
        <Text style={[shellType(12.5, 400, 17), {color: theme.colors.textTertiary}]}>{`${part.part} · ${t('settings.server.skippedPartsCount', {count: part.count})}`}</Text>
      </View>) : <Text style={[shellType(13, 500), {color: theme.colors.textTertiary, padding: 14}]}>{t('settings.server.skippedPartsNone')}</Text>}
      {parts.length ? <Button variant="text" size="compact" onPress={resetSkippedParts} style={{alignItems: 'flex-start', paddingHorizontal: 14, paddingVertical: 10}}>{t('action.clearAll')}</Button> : null}
    </View>
    <Text style={[shellType(17, 800), {color: theme.colors.text, marginTop: 22}]}>{t('web.logs.exportTitle')}</Text>
    <Text style={[shellType(13, 400, 18), {color: theme.colors.textSecondary, marginTop: 4}]}>{exported ? t('web.logs.readyHelp', {included: exported.manifest.included.map(sentence).join(', ') || t('web.logs.exportNothing'), excluded: exported.manifest.excluded.length ? exported.manifest.excluded.map(sentence).join(', ') : 'none', redaction: sentence(exported.manifest.redaction), expires: when(exported.expiresAt)}) : t('web.logs.exportLede')}</Text>
    <View style={{flexDirection: 'row', marginTop: 10}}><Button size="compact" loading={busy} onPress={prepare}>{t('web.logs.prepare')}</Button></View>
  </View>;
}

function runtimeError(error: unknown): {title: string; body: string} {
  const presented = presentError(error, 'server-console');
  return {title: presented.title, body: presented.body};
}
