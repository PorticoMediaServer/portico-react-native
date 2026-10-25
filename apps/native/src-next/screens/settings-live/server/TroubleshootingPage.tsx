import {NativePlaybackProblems} from './troubleshooting/PlaybackProblems';
import {NativeMessages} from './troubleshooting/Messages';
import {useSettingsRequestScope} from '../use-settings-request-scope';
import React, {useCallback, useEffect, useMemo, useState} from 'react';
import {ScrollView, Text, View} from 'react-native';
import {ConsoleClient, type FeedbackReport, type FeedbackStatus} from '../../../../../../packages/client-core/src/console';
import {feedbackCategoryName, feedbackStatusName} from '../../../../../../packages/client-core/src/server-admin/console-catalogue';
import {sentence, when} from '../../../../../../packages/client-core/src/server-admin/console-words';
import {presentError} from '../../../../../../packages/client-core/src/presentation/errors';
import {deleteClientReport, listClientReports, readClientReport, type ClientReport} from '../../../../../../packages/client-core/src/client-reports';
import {readCatalogueFailures, type CatalogueFailures} from '../../../../../../packages/client-core/src/catalogue-failures';
import {CAPABILITY_BEHIND_PRESENCE, CAPABILITY_ROWS, capabilityReasonId, parseCapabilities, type ServerCapability} from '../../../../../../packages/client-core/src/server-admin/capabilities';
import {resetSkippedParts, skippedParts, skippedVersion, subscribeSkipped} from '../../../../../../packages/client-core/src/tolerant';
import type {SupportExport} from '../../../../../../packages/client-core/src/console';
import type {ShellAuthority} from '../../../shell/model';
import {defaultI18n} from '../../../../../../packages/i18n/src';
import type {MessageId} from '../../../../../../packages/i18n/src';
import {Button} from '../../../kit/controls/Button';
import {TextField} from '../../../kit/controls/TextField';
import {Tabs} from '../../../kit/controls/Tabs';
import {BottomSheet} from '../../../kit/overlays/BottomSheet';
import {Menu, type MenuEntry} from '../../../kit/overlays';
import {ServerHeader} from '../../../kit/shell/ServerIdentity';
import {StateView} from '../../../kit/states';
import {shellType} from '../../../kit/shell/visual';
import {useTheme} from '../../../kit/theme';
import type {NativeSettingsLivePorts} from '../ports';
import type {NativeShellRuntime} from '../../../shell/runtime';

type ViewerRole = 'owner' | 'administrator' | 'member';
type Translate = typeof defaultI18n.t;
const STATUSES: readonly FeedbackStatus[] = ['open', 'in-progress', 'resolved', 'closed'];


function useRead<T>(read: () => Promise<T>, deps: readonly unknown[]) {
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
}

/** Settings › Server › Troubleshooting on the phone (owner-server.html frame 33). */
export function NativeServerTroubleshooting({ports, runtime, compactHeader = false}: {ports: NativeSettingsLivePorts; runtime: NativeShellRuntime; compactHeader?: boolean}) {
  const theme = useTheme(), t = runtime.text.t as Translate, context = ports.context;
  const {api, authority} = useSettingsRequestScope(context);
  const consoleClient = useMemo(() => new ConsoleClient(api, {serverId: authority.serverId, viewerId: authority.profileId}), [api, authority]);
  useEffect(() => () => consoleClient.dispose(), [consoleClient]);
  const viewerRole: ViewerRole = context.account.account.role === 'owner' ? 'owner' : context.account.canManage ? 'administrator' : 'member';
  const [tab, setTab] = useState('messages');
  const reports = useRead(() => consoleClient.reports(true), [consoleClient]);
  const openReports = reports.data?.items.filter(report => report.status === 'open' || report.status === 'in-progress').length ?? 0;
  return <View style={{flex: 1}}>
    <ScrollView contentContainerStyle={{paddingHorizontal: 20, paddingBottom: 40}}>
      <ServerHeader serverName={context.serverName} viewerRole={viewerRole} audience={viewerRole === 'administrator' ? 'administrators' : 'owner'} variant="phone" style={{marginBottom: 12}}/>
      {!compactHeader && <Text accessibilityRole="header" style={[shellType(28, 800, 33, -.03), {color: theme.colors.text}]}>{t('settings.server.troubleshooting')}</Text>}
      <Tabs testID="server-troubleshooting-tabs" style={{marginTop: 12, marginHorizontal: -20}} value={tab} onValueChange={setTab} accessibilityLabel={t('settings.server.troubleshooting')}
        items={[{value: 'messages', label: t('web.logs.messages')}, {value: 'feedback', label: openReports ? `${t('server.feedbackTab')} ${openReports}` : t('server.feedbackTab')}, {value: 'reports', label: t('server.reportsTab')}, {value: 'support', label: t('server.support')}]}/>
      {tab === 'messages' && <><NativeMessages ports={ports} runtime={runtime}/><NativePlaybackProblems ports={ports} runtime={runtime}/></>}
      {tab === 'feedback' && <FeedbackTab consoleClient={consoleClient} reports={reports.data?.items ?? []} loading={reports.loading} error={reports.error} runtime={runtime} t={t} reload={reports.reload}/>}
      {tab === 'reports' && <ReportsTab api={api} authority={authority} runtime={runtime} t={t}/>}
      {tab === 'support' && <SupportTab api={api} consoleClient={consoleClient} t={t}/>}
    </ScrollView>
  </View>;
}


function FeedbackTab({consoleClient, reports, loading, error, runtime, t, reload}: {consoleClient: ConsoleClient; reports: readonly FeedbackReport[]; loading: boolean; error?: unknown; runtime: NativeShellRuntime; t: Translate; reload: () => void}) {
  const theme = useTheme();
  const [selected, setSelected] = useState<FeedbackReport>();
  if (error !== undefined && !reports.length) return <StateView {...runtime.error(error, reload)}/>;
  return <View style={{marginTop: 14}} testID="server-troubleshooting-feedback">
    {!loading && !reports.length ? <View style={{paddingVertical: 20}}><Text style={[shellType(15, 700), {color: theme.colors.text}]}>{t('web.feedback.inboxEmpty')}</Text>
      <Text style={[shellType(13, 400, 18), {color: theme.colors.textSecondary, marginTop: 4}]}>{t('web.feedback.inboxEmptyBody')}</Text></View> : null}
    <View style={{borderRadius: 14, overflow: 'hidden', backgroundColor: theme.colors.raised}}>
      {reports.map((report, index) => <Button key={report.id} variant="text" size="compact" onPress={() => setSelected(report)}
        style={{alignItems: 'flex-start', paddingHorizontal: 14, paddingVertical: 10, minHeight: 0, borderTopWidth: index ? 1 : 0, borderTopColor: theme.colors.lineSoft}}>
        <View style={{flex: 1, minWidth: 0}}>
          <Text numberOfLines={1} style={[shellType(15, 700), {color: theme.colors.text}]}>{report.message.split('\n')[0]}</Text>
          <Text numberOfLines={2} style={[shellType(12.5, 500, 17), {color: theme.colors.textTertiary, marginTop: 2}]}>
            {t('web.feedback.rowSubtitle', {category: feedbackCategoryName(t, defaultI18n.has, report.category), when: when(report.createdAt), about: report.itemId ? 'yes' : 'no'})}
          </Text>
        </View>
        <Text style={[shellType(12, 700), {color: theme.colors.accentStrong}]}>{feedbackStatusName(t, defaultI18n.has, report.status)}</Text>
      </Button>)}
    </View>
    <TriageSheet report={selected} consoleClient={consoleClient} t={t} onClose={() => setSelected(undefined)} onChanged={() => {setSelected(undefined); reload();}}/>
  </View>;
}

function TriageSheet({report, consoleClient, t, onClose, onChanged}: {report?: FeedbackReport; consoleClient: ConsoleClient; t: Translate; onClose: () => void; onChanged: () => void}) {
  const theme = useTheme();
  const [status, setStatus] = useState<FeedbackStatus>('in-progress'), [reply, setReply] = useState(''), [picking, setPicking] = useState(false), [busy, setBusy] = useState(false), [failure, setFailure] = useState<unknown>();
  useEffect(() => {if (report) {setStatus(report.status === 'open' ? 'in-progress' : report.status); setReply(''); setFailure(undefined);}}, [report]);
  const update = () => {
    if (!report) return;
    setBusy(true); setFailure(undefined);
    void consoleClient.triage(report.id, report.revision, status, reply).then(() => onChanged(), error => setFailure(error)).finally(() => setBusy(false));
  };
  const problem = failure === undefined ? undefined : presentError(failure, 'feedback').body;
  return <BottomSheet open={Boolean(report)} onOpenChange={open => {if (!open && !busy) onClose();}} testID="server-feedback-report" keyboardAvoiding
    title={report ? feedbackCategoryName(t, defaultI18n.has, report.category) : undefined}
    description={report ? t('web.feedback.reportedMeta', {when: when(report.createdAt), status: feedbackStatusName(t, defaultI18n.has, report.status)}) : undefined}
    footer={<View style={{flexDirection: 'row', gap: 8}}><Button variant="glass" disabled={busy} onPress={onClose}>{t('action.cancel')}</Button><Button loading={busy} disabled={!report} onPress={update}>{t('web.feedback.updateReport')}</Button></View>}>
    <View style={{gap: 12}}>
      <Text style={[shellType(14, 400, 20), {color: theme.colors.text}]}>{report?.message}</Text>
      {report?.diagnostic ? <Text style={[shellType(12.5, 400, 17), {color: theme.colors.textTertiary}]}>{t('server.feedback.sentFrom', {platform: sentence(report.diagnostic.platform), state: report.diagnostic.state, online: report.diagnostic.online ? 'yes' : 'no'})}</Text> : null}
      <Button variant="glass" size="compact" onPress={() => setPicking(true)}>{feedbackStatusName(t, defaultI18n.has, status)}</Button>
      <TextField label={t('web.feedback.replyLabel')} description={t('web.feedback.replyHelp')} value={reply} onChangeText={setReply} maxLength={2000} multiline/>
      {problem ? <Text accessibilityRole="alert" style={[shellType(13, 600), {color: theme.colors.record}]}>{problem}</Text> : null}
      <Menu open={picking} onOpenChange={setPicking} presentation="sheet" title={t('web.feedback.status')} items={STATUSES.map((value): MenuEntry => ({id: value, label: feedbackStatusName(t, defaultI18n.has, value), selected: value === status, onSelect: () => {setStatus(value); setPicking(false);}}))}/>
    </View>
  </BottomSheet>;
}

function ReportsTab({api, authority, runtime, t}: {api: {request<T>(path: string, method?: string, body?: unknown, signal?: AbortSignal): Promise<T>}; authority: ShellAuthority; runtime: NativeShellRuntime; t: Translate}) {
  const theme = useTheme();
  const [reports, setReports] = useState<readonly ClientReport[]>([]), [failures, setFailures] = useState<CatalogueFailures>();
  const [selected, setSelected] = useState<ClientReport>(), [body, setBody] = useState(''), [deleteTarget, setDeleteTarget] = useState<ClientReport>();
  const [loading, setLoading] = useState(true), [problem, setProblem] = useState<string>();
  useEffect(() => {
    let live = true;
    setLoading(true);
    void Promise.allSettled([
      listClientReports(api, authority.serverId).then(page => {if (live) setReports(page.items);}),
      readCatalogueFailures(api).then(value => {if (live) setFailures(value);}),
    ]).finally(() => {if (live) setLoading(false);});
    return () => {live = false;};
  }, [api, authority.serverId]);
  const open = (report: ClientReport) => {
    setSelected(report); setBody(''); setProblem(undefined);
    void readClientReport(api, authority.serverId, report.id).then(value => setBody(value.body ?? ''), error => setProblem(presentError(error, 'server-console').body));
  };
  const remove = () => {
    const target = deleteTarget;
    if (!target) return;
    void deleteClientReport(api, target.id).then(() => {setReports(items => items.filter(item => item.id !== target.id)); setDeleteTarget(undefined); setSelected(undefined);}, error => setProblem(presentError(error, 'server-console').body));
  };
  return <View style={{marginTop: 14}} testID="server-troubleshooting-reports">
    <Text style={[shellType(17, 800), {color: theme.colors.text}]}>{t('web.diagnostics.clientReports')}</Text>
    <Text style={[shellType(13, 400, 18), {color: theme.colors.textSecondary, marginTop: 4}]}>{t('server.reports.lede')}</Text>
    {problem ? <Text accessibilityRole="alert" style={[shellType(13, 600), {color: theme.colors.record, marginTop: 8}]}>{problem}</Text> : null}
    <View style={{marginTop: 10, borderRadius: 14, overflow: 'hidden', backgroundColor: theme.colors.raised}}>
      {!loading && !reports.length ? <Text style={[shellType(13, 500), {color: theme.colors.textTertiary, padding: 14}]}>{t('server.reports.none')}</Text> : null}
      {reports.map((report, index) => <Button key={report.id} variant="text" size="compact" onPress={() => open(report)}
        style={{alignItems: 'flex-start', paddingHorizontal: 14, paddingVertical: 10, minHeight: 0, borderTopWidth: index ? 1 : 0, borderTopColor: theme.colors.lineSoft}}>
        <View style={{flex: 1, minWidth: 0}}>
          <Text numberOfLines={1} style={[shellType(15, 700), {color: theme.colors.text}]}>{`${report.platform || t('server.reports.unknownSender')} · ${report.deviceClass}`}</Text>
          <Text numberOfLines={1} style={[shellType(12.5, 500), {color: theme.colors.textTertiary, marginTop: 2}]}>{`${report.appVersion} · ${when(Date.parse(report.receivedAt))} · ${defaultI18n.bytes(report.bytes)}`}</Text>
        </View>
      </Button>)}
    </View>
    <Text style={[shellType(17, 800), {color: theme.colors.text, marginTop: 22}]}>{t('server.setAside.title')}</Text>
    <Text style={[shellType(13, 400, 18), {color: theme.colors.textSecondary, marginTop: 4}]}>{t('server.setAside.lede')}</Text>
    <View style={{marginTop: 10, borderRadius: 14, overflow: 'hidden', backgroundColor: theme.colors.raised}}>
      {(failures?.failures ?? []).map((row, index) => <View key={`${row.domain}-${row.entityId ?? index}`} style={{paddingHorizontal: 14, paddingVertical: 10, borderTopWidth: index ? 1 : 0, borderTopColor: theme.colors.lineSoft}}>
        <Text numberOfLines={1} style={[shellType(15, 700), {color: theme.colors.text}]}>{row.title || t('server.setAside.untitled')}</Text>
        <Text numberOfLines={4} style={[shellType(12.5, 400, 17), {color: theme.colors.textTertiary, marginTop: 2}]}>{`${t('server.setAside.tried', {count: row.attempts, when: when(row.failedAt)})}\n${row.reason}`}</Text>
      </View>)}
    </View>
    <BottomSheet open={Boolean(selected)} onOpenChange={open => {if (!open) {setSelected(undefined); setDeleteTarget(undefined); setProblem(undefined);}}} testID="server-client-report"
      title={selected ? `${selected.platform || t('server.reports.unknownSender')} · ${selected.deviceClass}` : undefined}
      description={selected ? `${selected.appVersion} · ${when(Date.parse(selected.receivedAt))}` : undefined}
      footer={<View style={{flexDirection: 'row', gap: 8}}><Button variant="glass" onPress={() => setSelected(undefined)}>{t('action.close')}</Button><Button variant="glass" textStyle={{color: theme.colors.record}} onPress={() => setDeleteTarget(selected)}>{t('action.delete')}</Button></View>}>
      <ScrollView style={{maxHeight: 320}}><Text style={[shellType(12, 400, 17), {color: theme.colors.textSecondary}]}>{body || t('server.reports.empty')}</Text></ScrollView>
    </BottomSheet>
    <BottomSheet open={Boolean(deleteTarget)} onOpenChange={open => {if (!open) setDeleteTarget(undefined);}} testID="server-client-report-delete"
      title={t('server.reports.deleteTitle')} description={t('server.reports.deleteBody')}
      footer={<View style={{flexDirection: 'row', gap: 8}}><Button variant="glass" onPress={() => setDeleteTarget(undefined)}>{t('action.cancel')}</Button><Button variant="glass" textStyle={{color: theme.colors.record}} onPress={remove}>{t('action.delete')}</Button></View>}><View/></BottomSheet>
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
