import React, {useEffect, useState, useSyncExternalStore} from 'react';
import {Share, View} from 'react-native';
import {logCategories, logLevels, parseLogPage, type EvidenceRecord, type FeedbackReport, type FeedbackStatus, type LogCategory, type LogLevel, type LogSettings, type SupportExport} from '../../../../../packages/client-core/src/admin/index';
import {CAPABILITY_BEHIND_PRESENCE, CAPABILITY_ROWS, capabilityReasonId, parseCapabilities, type ServerCapability} from '../../../../../packages/client-core/src/server-admin/capabilities';
import {sentence, when} from '../../../../../packages/client-core/src/server-admin/console-words';
import {broadcastBody, broadcastProblem, utf8Length} from '../../../../../packages/client-core/src/server-admin/panel-logic';
import {feedbackCategoryName, feedbackStatusName} from '../../../../../packages/client-core/src/server-admin/console-catalogue';
import {setDetailWindow, type LogsDraft} from '../../../../../packages/client-core/src/server-admin/server-forms';
import {resetSkippedParts, skippedParts, skippedVersion, subscribeSkipped} from '../../../../../packages/client-core/src/tolerant';
import type {MessageId} from '../../../../../packages/i18n/src/index';
import {useSession} from '../../app/session';
import {useI18n} from '../../app/i18n';
import {operationId, useAction, useConsole, useRead} from '../../app/server-console';
import {Field, ListRow, Menu, Notice, RowGroup, Segmented, Sheet, Text, ToggleRow, rowPaddingX, useSpecPlatform, useTheme} from '../../ui';
import {PickRow, useServerDeps, useServerForm} from '../settings/ServerForms';

const logTime = (at: string) => new Date(at).toLocaleString(undefined, {month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit', second: '2-digit'});

/** Troubleshooting › "Record more detail for 30 minutes": the one control for extra detail. */
export function DetailWindowRow() {
  const t = useI18n().t;
  const deps = useServerDeps();
  const {form, state} = useServerForm<LogsDraft, LogSettings>('logs');
  const action = useAction();
  const until = state.status?.debugWindowUntil;
  const on = !!until && Date.parse(until) > Date.now();
  if (!state.status) return null;
  return <ToggleRow title={t('settings.server.detailWindow')} disabled={action.busy} value={on}
    subtitle={action.error || (on ? t('settings.server.detailWindow.until', {time: new Date(until!).toLocaleTimeString([], {hour: 'numeric', minute: '2-digit'})}) : t('settings.server.detailWindow.help'))}
    onChange={next => void action.run(async () => { await setDetailWindow(deps, next); await form.load(); })} />;
}

/** Troubleshooting › Messages: what the server has been saying, newest first, filtered by level and category. Pulling the page down reads them again. */
export function MessageLogPanel() {
  const {api} = useSession();
  const t = useI18n().t;
  const {colors, space} = useTheme();
  const platform = useSpecPlatform();
  const [level, setLevel] = useState<LogLevel | ''>('');
  const [category, setCategory] = useState<LogCategory | ''>('');
  const [shown, setShown] = useState(40);
  const query = `${level ? `&level=${level}` : ''}${category ? `&category=${category}` : ''}`;
  const read = useRead(async () => parseLogPage(await api.request('/v1/admin/logs?limit=200' + query)), [api, query]);
  useEffect(() => setShown(40), [query]);
  const lines = read.data?.items ?? [];
  const more = lines.length > shown;
  const tone = (l: LogLevel) => (l === 'error' ? colors.danger : l === 'warn' ? colors.text : colors.textSecondary);
  return (
    <>
      {read.error ? <Notice tone={lines.length ? 'warning' : 'error'} message={read.error} action={t('action.tryAgain')} onAction={read.reload} /> : null}
      <RowGroup title={t('web.logs.messages')} footer={t('web.logs.messagesLede')}>
        <PickRow title={t('web.logs.level')} value={level} options={[{id: '', label: t('web.logs.allLevels')}, ...logLevels.map(l => ({id: l, label: t('web.logs.levelAndAbove', {level: `${l[0]!.toUpperCase()}${l.slice(1)}`})}))]} onChange={id => setLevel(id as LogLevel | '')} />
        <PickRow title={t('feedback.category')} value={category} options={[{id: '', label: t('web.logs.everything')}, ...logCategories.map(c => ({id: c, label: t(`server.logCategory.${c}` as MessageId)}))]} onChange={id => setCategory(id as LogCategory | '')} />
        {lines.length ? (
          <View style={{paddingHorizontal: rowPaddingX(platform), paddingVertical: space.md, gap: space.sm}}>
            {lines.slice(0, shown).map(l => (
              <View key={l.sequence}>
                <Text variant="caption" tone="tertiary">{`${logTime(l.at)} · ${l.level.toUpperCase()} · ${l.category}`}</Text>
                <Text variant="caption" style={{color: tone(l.level)}}>{l.message}</Text>
              </View>
            ))}
          </View>
        ) : <ListRow title={read.loading ? t('web.logs.loadingMessages') : t('web.logs.noMessages')} />}
        {more ? <ListRow tone="action" title={t('server.showMore')} onPress={() => setShown(n => n + 40)} /> : null}
      </RowGroup>
    </>
  );
}

type Lane = 'runtime' | 'client' | 'audit';

/** Troubleshooting › Records: what the server noted, by kind. */
export function RecordsPanel() {
  const client = useConsole();
  const t = useI18n().t;
  const {space} = useTheme();
  const platform = useSpecPlatform();
  const [lane, setLane] = useState<Lane>('runtime');
  const [cursor, setCursor] = useState('');
  useEffect(() => setCursor(''), [lane]);
  const read = useRead(() => client.records(lane, cursor), [client, lane, cursor]);
  const items = read.data?.items ?? [];
  const title = (r: EvidenceRecord) => (r.code ? sentence(r.code) : r.action ? sentence(r.action) : t('web.logs.recordFallback'));
  return (
    <>
      {read.error && !read.data ? <Notice tone="error" message={read.error} action={t('action.tryAgain')} onAction={read.reload} /> : null}
      <RowGroup title={t('web.logs.records')}>
        <View style={{paddingHorizontal: rowPaddingX(platform), paddingVertical: space.sm}}><Segmented accessibilityLabel={t('web.logs.records')} selected={lane} onSelect={id => setLane(id as Lane)} items={[{id: 'runtime', label: t('web.logs.laneServer')}, {id: 'client', label: t('web.logs.laneClient')}, {id: 'audit', label: t('web.logs.laneAudit')}]} /></View>
        {read.data && !items.length ? <ListRow title={t('settings.server.records.none')} /> : null}
        {items.map(r => <ListRow key={r.sequence} title={title(r)} meta={sentence(r.severity ?? 'record')} subtitleLines={3} subtitle={[when(r.at), r.component ? sentence(r.component) : '', r.target, ...(r.fields ? Object.entries(r.fields).map(([k, v]) => `${sentence(k)} ${v}`) : [])].filter(Boolean).join(' · ')} />)}
        {cursor ? <ListRow tone="action" title={t('web.activity.latest')} onPress={() => setCursor('')} /> : null}
        {read.data?.nextCursor ? <ListRow tone="action" title={t('web.hostedAccount.older')} onPress={() => setCursor(read.data!.nextCursor)} /> : null}
      </RowGroup>
    </>
  );
}

/** Troubleshooting › Server capabilities: what this server can do right now, and why not when it can't. Absent on a server without the route. */
export function CapabilitiesPanel() {
  const {api} = useSession();
  const t = useI18n().t;
  const read = useRead<readonly ServerCapability[] | null>(() => api.request<unknown>('/v1/admin/diagnostics/capabilities').then(parseCapabilities, e => ((e as {status?: number})?.status === 404 ? null : Promise.reject(e))), [api]);
  if (read.data === null) return null;
  const items = read.data;
  const known = new Set<string>(CAPABILITY_ROWS);
  const row = (c: ServerCapability, label: string) => <ListRow key={c.capability} title={label} meta={c.available ? t('web.capabilities.available') : t('web.capabilities.unavailable')} subtitleLines={4} subtitle={c.available ? undefined : [t(capabilityReasonId(c.code) as MessageId), [c.code, c.detail].filter(Boolean).join(': ')].filter(Boolean).join('\n')} />;
  return (
    <>
      {read.error ? <Notice tone="warning" message={t('web.capabilities.loadFailed')} action={t('action.tryAgain')} onAction={read.reload} /> : null}
      {items ? (
        <RowGroup title={t('web.capabilities.title')} footer={t('web.capabilities.help')}>
          {CAPABILITY_ROWS.map(id => {
            const c = items.find(x => x.capability === id);
            const label = t(`web.capabilities.${id}` as MessageId);
            if (c) return row(c, label);
            if ((CAPABILITY_BEHIND_PRESENCE as readonly string[]).includes(id)) return null;
            return <ListRow key={id} title={label} subtitle={t('web.capabilities.notChecked')} meta={t('web.capabilities.unknown')} />;
          })}
          {items.filter(c => !known.has(c.capability)).map(c => row(c, t('web.capabilities.otherLabel', {id: c.capability})))}
        </RowGroup>
      ) : null}
    </>
  );
}

/**
 * Troubleshooting › Parts this app could not read: what this app left out of the server's answers
 * on this device, by document and part (the readers' own names, never anything the server sent).
 */
export function SkippedPartsPanel() {
  const t = useI18n().t;
  useSyncExternalStore(subscribeSkipped, skippedVersion);
  const parts = skippedParts();
  return (
    <RowGroup title={t('settings.server.skippedParts')} footer={t('settings.server.skippedPartsLede')}>
      {parts.length ? [...parts].reverse().map(part => <ListRow key={part.document + '\n' + part.part} title={part.document} subtitle={part.part} meta={t('settings.server.skippedPartsCount', {count: part.count})} />) : <ListRow title={t('settings.server.skippedPartsNone')} />}
      {parts.length ? <ListRow tone="action" title={t('action.clearAll')} onPress={resetSkippedParts} /> : null}
    </RowGroup>
  );
}

const EXPORT_PARTS: readonly {id: string; label: MessageId}[] = [{id: 'runtime', label: 'web.logs.includeServer'}, {id: 'client', label: 'web.logs.includeClient'}, {id: 'audit', label: 'web.logs.includeAudit'}, {id: 'snapshot', label: 'web.logs.includeSnapshot'}];

/** Troubleshooting › Support export: a redacted file for whoever is helping, sent with the system share sheet. */
export function SupportExportPanel() {
  const client = useConsole();
  const t = useI18n().t;
  const action = useAction();
  const [hours, setHours] = useState('24');
  const [chosen, setChosen] = useState<string[]>(['runtime', 'audit']);
  const [result, setResult] = useState<SupportExport>();
  const toggle = (c: string) => setChosen(v => (v.includes(c) ? v.filter(x => x !== c) : [...v, c]));
  const prepare = () => void action.run(async () => { const span = Number(hours) * 3600000; setResult(await client.createExport(Date.now() - span, Date.now(), chosen)); });
  return (
    <RowGroup title={t('web.logs.exportTitle')} footer={result ? t('web.logs.readyHelp', {included: result.manifest.included.map(sentence).join(', ') || t('web.logs.exportNothing'), excluded: result.manifest.excluded.length ? result.manifest.excluded.map(sentence).join(', ') : 'none', redaction: sentence(result.manifest.redaction), expires: when(result.expiresAt)}) : t('web.logs.exportLede')}>
      <PickRow title={t('web.logs.timeWindow')} value={hours} options={[{id: '1', label: t('server.export.hours', {count: 1})}, {id: '6', label: t('server.export.hours', {count: 6})}, {id: '24', label: t('server.export.days', {count: 1})}, {id: '72', label: t('server.export.days', {count: 3})}]} onChange={setHours} />
      {EXPORT_PARTS.map(p => <ToggleRow key={p.id} title={t(p.label)} value={chosen.includes(p.id)} onChange={() => toggle(p.id)} />)}
      <ListRow tone="action" title={action.busy ? t('web.logs.prepareExport') : t('web.logs.prepare')} subtitle={action.error || undefined} disabled={action.busy || !chosen.length} onPress={prepare} />
      {result ? <ListRow tone="action" icon="upload" title={t('server.export.share')} onPress={() => { void Share.share({title: 'portico-support.json', message: JSON.stringify(result, null, 2)}).catch(() => {}); }} /> : null}
    </RowGroup>
  );
}

const STATUSES: readonly FeedbackStatus[] = ['open', 'in-progress', 'resolved', 'closed'];

/** Troubleshooting › Viewer feedback: problems viewers reported from their apps, each answered in a sheet; and a message to everyone. */
export function FeedbackPanel() {
  const client = useConsole();
  const {t, has} = useI18n();
  const read = useRead(() => client.reports(true), [client]);
  const [selected, setSelected] = useState<FeedbackReport>();
  const [broadcast, setBroadcast] = useState(false);
  const items = read.data?.items ?? [];
  return (
    <>
      {read.error && !read.data ? <Notice tone="error" message={read.error} action={t('action.tryAgain')} onAction={read.reload} /> : null}
      <RowGroup title={t('settings.server.feedback')} footer={t('web.console.nav.feedbackLede')}>
        {read.data && !items.length ? <ListRow icon="mail" title={t('web.feedback.inboxEmpty')} subtitle={t('web.feedback.inboxEmptyBody')} /> : null}
        {items.map(r => <ListRow key={r.id} icon="mail" title={r.message.split('\n')[0] ?? ''} meta={feedbackStatusName(t, has, r.status)} subtitle={t('web.feedback.rowSubtitle', {category: feedbackCategoryName(t, has, r.category), when: when(r.createdAt), about: r.itemId ? 'yes' : 'no'})} accessory="navigation" onPress={() => setSelected(r)} />)}
        <ListRow tone="action" icon="mail" title={t('server.messageEveryone')} onPress={() => setBroadcast(true)} />
      </RowGroup>
      <TriageSheet report={selected} onClose={() => setSelected(undefined)} onChanged={() => { setSelected(undefined); read.reload(); }} />
      <BroadcastSheet open={broadcast} onClose={() => setBroadcast(false)} />
    </>
  );
}

function TriageSheet({report, onClose, onChanged}: {report?: FeedbackReport; onClose: () => void; onChanged: () => void}) {
  const client = useConsole();
  const {t, has} = useI18n();
  const {space} = useTheme();
  const action = useAction();
  const [status, setStatus] = useState<FeedbackStatus>('in-progress');
  const [reply, setReply] = useState('');
  const [picking, setPicking] = useState(false);
  useEffect(() => { if (report) { setStatus('in-progress'); setReply(''); action.clear(); }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [report?.id]);
  return (
    <Sheet open={!!report} onClose={onClose} kind="form" title={report ? feedbackCategoryName(t, has, report.category) : undefined} subtitle={report ? t('web.feedback.reportedMeta', {when: when(report.createdAt), status: feedbackStatusName(t, has, report.status)}) : undefined}
      primary={{label: t('web.feedback.updateReport'), loading: action.busy, onPress: () => { if (report) void action.run(() => client.triage(report.id, report.revision, status, reply)).then(ok => { if (ok) onChanged(); }); }}}>
      {report ? (
        <View style={{gap: space.md}}>
          <Text variant="body">{report.message}</Text>
          {report.diagnostic ? <Text variant="caption" tone="tertiary">{t('server.feedback.sentFrom', {platform: sentence(report.diagnostic.platform), state: report.diagnostic.state, online: report.diagnostic.online ? 'yes' : 'no'})}</Text> : null}
          <RowGroup><ListRow title={t('web.feedback.status')} meta={feedbackStatusName(t, has, status)} accessory="value" onPress={() => setPicking(true)} /></RowGroup>
          <Field label={t('web.feedback.replyLabel')} hint={t('web.feedback.replyHelp')} value={reply} onChangeText={setReply} maxLength={2000} multiline error={action.error || undefined} />
          <Menu open={picking} onClose={() => setPicking(false)} title={t('web.feedback.status')} items={STATUSES.map(v => ({id: v, label: feedbackStatusName(t, has, v), selected: v === status}))} onSelect={id => setStatus(id as FeedbackStatus)} />
        </View>
      ) : null}
    </Sheet>
  );
}

/** A message from the owner to everyone on the server. */
function BroadcastSheet({open, onClose}: {open: boolean; onClose: () => void}) {
  const {api} = useSession();
  const t = useI18n().t;
  const {space} = useTheme();
  const action = useAction();
  // One id per message, minted when the sheet opens: a retry of the same send is delivered once.
  const [operation, setOperation] = useState('');
  const [title, setTitle] = useState('');
  const [body, setBody] = useState('');
  const [adminsOnly, setAdminsOnly] = useState(false);
  const [severity, setSeverity] = useState('info');
  useEffect(() => { if (open) { setOperation(operationId()); setTitle(''); setBody(''); action.clear(); }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);
  const problem = broadcastProblem(title, body);
  const send = () => void action.run(() => api.request('/v1/admin/notifications/broadcast', 'POST', broadcastBody(operation, {audience: adminsOnly ? 'account-admin' : 'profile', severity, title, body}))).then(ok => { if (ok) onClose(); });
  return (
    <Sheet open={open} onClose={onClose} kind="form" title={t('server.messageEveryone')} subtitle={t('web.broadcast.lede')} primary={{label: t('feedback.send'), loading: action.busy, disabled: !title.trim() || !!problem, onPress: send}}>
      <View style={{gap: space.md}}>
        {action.error ? <Notice tone="error" message={action.error} /> : null}
        {problem ? <Notice tone="error" message={problem === 'title-too-long' ? t('web.broadcast.titleTooLong', {count: utf8Length(title.trim())}) : t('web.broadcast.bodyTooLong', {count: utf8Length(body.trim())})} /> : null}
        <Field label={t('web.broadcast.title')} value={title} onChangeText={setTitle} maxLength={120} placeholder={t('web.broadcast.titleExample')} />
        <Field label={t('web.broadcast.message')} value={body} onChangeText={setBody} maxLength={2000} multiline />
        <RowGroup>
          <ToggleRow title={t('web.broadcast.adminOnly')} value={adminsOnly} onChange={setAdminsOnly} />
          <PickRow title={t('web.broadcast.importance')} value={severity} options={[{id: 'info', label: t('web.broadcast.info')}, {id: 'warning', label: t('web.broadcast.notice')}, {id: 'critical', label: t('web.broadcast.urgent')}]} onChange={setSeverity} />
        </RowGroup>
      </View>
    </Sheet>
  );
}
