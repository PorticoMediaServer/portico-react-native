import React, {useCallback, useEffect, useMemo, useState} from 'react';
import {ScrollView, Text, View} from 'react-native';
import {ConsoleClient, type FeedbackReport, type FeedbackStatus} from '../../../../../../packages/client-core/src/console';
import {logCategories, logLevels, parseLogPage, type LogCategory, type LogLevel, type LogRecord} from '../../../../../../packages/client-core/src/server-administration';
import {feedbackCategoryName, feedbackStatusName} from '../../../../../../packages/client-core/src/server-admin/console-catalogue';
import {sentence, when} from '../../../../../../packages/client-core/src/server-admin/console-words';
import {presentError} from '../../../../../../packages/client-core/src/presentation/errors';
import {defaultI18n} from '../../../../../../packages/i18n/src';
import type {MessageId} from '../../../../../../packages/i18n/src';
import {Button} from '../../../kit/controls/Button';
import {TextField} from '../../../kit/controls/TextField';
import {Tabs} from '../../../kit/controls/Tabs';
import {BottomSheet} from '../../../kit/overlays/BottomSheet';
import {Menu, type MenuEntry} from '../../../kit/overlays/Menu';
import {ServerHeader} from '../../../kit/shell/ServerIdentity';
import {StateView} from '../../../kit/states';
import {alpha, shellType} from '../../../kit/shell/visual';
import {useTheme} from '../../../kit/theme';
import type {NativeSettingsLivePorts} from '../ports';
import type {NativeShellRuntime} from '../../../shell/runtime';

type ViewerRole = 'owner' | 'administrator' | 'member';
type Translate = typeof defaultI18n.t;
const LOG_LIMIT = 200;
const STATUSES: readonly FeedbackStatus[] = ['open', 'in-progress', 'resolved', 'closed'];

const logTime = (at: string) => new Date(at).toLocaleString(undefined, {month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit', second: '2-digit'});
const levelWord = (level: LogLevel) => `${level[0]!.toUpperCase()}${level.slice(1)}`;

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
export function NativeServerTroubleshooting({ports, runtime}: {ports: NativeSettingsLivePorts; runtime: NativeShellRuntime}) {
  const theme = useTheme(), t = runtime.text.t as Translate, context = ports.context, authority = context.authority();
  const api = useMemo(() => ({request: <T,>(path: string, method?: string, body?: unknown, signal?: AbortSignal) => context.api.request<T>(path, method, body, signal)}), [context]);
  const consoleClient = useMemo(() => new ConsoleClient(api, {serverId: authority.serverId, viewerId: authority.profileId}), [api, authority]);
  useEffect(() => () => consoleClient.dispose(), [consoleClient]);
  const viewerRole: ViewerRole = context.account.account.role === 'owner' ? 'owner' : context.account.canManage ? 'administrator' : 'member';
  const [tab, setTab] = useState('messages');
  const reports = useRead(() => consoleClient.reports(true), [consoleClient]);
  const openReports = reports.data?.items.filter(report => report.status === 'open' || report.status === 'in-progress').length ?? 0;
  return <View style={{flex: 1}}>
    <ScrollView contentContainerStyle={{paddingHorizontal: 20, paddingBottom: 40}}>
      <ServerHeader serverName={context.serverName} viewerRole={viewerRole} audience={viewerRole === 'administrator' ? 'administrators' : 'owner'} variant="phone" style={{marginBottom: 12}}/>
      <Text accessibilityRole="header" style={[shellType(28, 800, 33, -.03), {color: theme.colors.text}]}>{t('settings.server.troubleshooting')}</Text>
      <Tabs testID="server-troubleshooting-tabs" style={{marginTop: 12, marginHorizontal: -20}} value={tab} onValueChange={setTab} accessibilityLabel={t('settings.server.troubleshooting')}
        items={[{value: 'messages', label: t('web.logs.messages')}, {value: 'feedback', label: openReports ? `${t('settings.server.feedback')} ${openReports}` : t('settings.server.feedback')}]}/>
      {tab === 'messages' && <MessagesTab api={api} runtime={runtime} t={t}/>}
      {tab === 'feedback' && <FeedbackTab consoleClient={consoleClient} reports={reports.data?.items ?? []} loading={reports.loading} error={reports.error} runtime={runtime} t={t} reload={reports.reload}/>}
    </ScrollView>
  </View>;
}

function MessagesTab({api, runtime, t}: {api: {request<T>(path: string, method?: string, body?: unknown, signal?: AbortSignal): Promise<T>}; runtime: NativeShellRuntime; t: Translate}) {
  const theme = useTheme();
  const [level, setLevel] = useState<LogLevel | ''>(''), [category, setCategory] = useState<LogCategory | ''>('');
  const [picking, setPicking] = useState<'level' | 'category'>();
  const read = useRead(() => {
    const query = new URLSearchParams({limit: String(LOG_LIMIT)});
    if (level) query.set('level', level);
    if (category) query.set('category', category);
    return api.request<unknown>(`/v1/admin/logs?${query.toString()}`).then(parseLogPage);
  }, [level, category]);
  const items: readonly LogRecord[] = read.data?.items ?? [];
  const levelText = level ? t('web.logs.levelAndAbove', {level: levelWord(level)}) : t('web.logs.allLevels');
  const categoryText = category ? t(`server.logCategory.${category}` as MessageId) : t('web.logs.everything');
  const levelItems: readonly MenuEntry[] = [
    {id: 'all', label: t('web.logs.allLevels'), selected: level === '', onSelect: () => {setLevel(''); setPicking(undefined);}},
    ...logLevels.map((value): MenuEntry => ({id: value, label: t('web.logs.levelAndAbove', {level: levelWord(value)}), selected: level === value, onSelect: () => {setLevel(value); setPicking(undefined);}})),
  ];
  const categoryItems: readonly MenuEntry[] = [
    {id: 'all', label: t('web.logs.everything'), selected: category === '', onSelect: () => {setCategory(''); setPicking(undefined);}},
    ...logCategories.map((value): MenuEntry => ({id: value, label: t(`server.logCategory.${value}` as MessageId), selected: category === value, onSelect: () => {setCategory(value); setPicking(undefined);}})),
  ];
  return <View style={{marginTop: 14}} testID="server-troubleshooting-messages">
    <Text style={[shellType(17, 800), {color: theme.colors.text}]}>{t('web.logs.messages')}</Text>
    <Text style={[shellType(13, 400, 18), {color: theme.colors.textSecondary, marginTop: 4}]}>{t('web.logs.messagesLede')}</Text>
    <View style={{flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginTop: 12}}>
      <Button size="compact" variant="glass" icon="i-updown" onPress={() => setPicking('level')}>{levelText}</Button>
      <Button size="compact" variant="glass" icon="i-updown" onPress={() => setPicking('category')}>{categoryText}</Button>
      <Button size="compact" variant="glass" icon="i-refresh" loading={read.loading} onPress={read.reload}>{t('web.selection.refresh')}</Button>
    </View>
    {read.error !== undefined && !read.data ? <StateView {...runtime.error(read.error, read.reload)}/> : null}
    <View style={{marginTop: 12, borderRadius: 12, overflow: 'hidden', backgroundColor: alpha(theme.colors.ink, .55), borderWidth: 1, borderColor: theme.colors.lineSoft}}>
      {read.loading && !items.length ? <Text style={[shellType(13, 500), {color: theme.colors.textTertiary, padding: 14}]}>{t('web.logs.loadingMessages')}</Text> : null}
      {!read.loading && !items.length ? <Text style={[shellType(13, 500), {color: theme.colors.textTertiary, padding: 14}]}>{t('web.logs.noMessages')}</Text> : null}
      {items.map((row, index) => <View key={row.sequence} style={{paddingHorizontal: 12, paddingVertical: 9, borderTopWidth: index ? 1 : 0, borderTopColor: theme.colors.lineSoft}}>
        <View style={{flexDirection: 'row', flexWrap: 'wrap', columnGap: 8, rowGap: 2}}>
          <Text style={[shellType(11.5, 600), {color: theme.colors.textTertiary}]}>{logTime(row.at)}</Text>
          <Text style={[shellType(11.5, 800), {color: row.level === 'error' ? theme.colors.record : row.level === 'warn' ? theme.colors.amber : theme.colors.accentStrong}]}>{levelWord(row.level)}</Text>
          <Text style={[shellType(11.5, 600), {color: theme.colors.textTertiary}]}>{t(`server.logCategory.${row.category}` as MessageId)}</Text>
        </View>
        <Text style={[shellType(13, 400, 18), {color: theme.colors.text, marginTop: 2}]}>{row.message}</Text>
      </View>)}
    </View>
    <Menu open={Boolean(picking)} onOpenChange={open => {if (!open) setPicking(undefined);}} presentation="sheet" testID="server-messages-filter" items={picking === 'category' ? categoryItems : levelItems}/>
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
