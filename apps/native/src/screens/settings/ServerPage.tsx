import React, {useMemo, useState} from 'react';
import {View} from 'react-native';
import {settingsRowId, type SettingsCustomId, type SettingsPage as StructurePage, type SettingsRow as StructureRow, type SettingsSection} from '../../../../../packages/client-core/src/presentation/index';
import {useI18n} from '../../app/i18n';
import {RefreshScope, RefreshScopeContext} from '../../app/server-console';
import {ListRow, RowGroup, Segmented, isTV, useTheme} from '../../ui';
import {AlertsPanel, HealthPanel, JobsPanel, NowPlayingPanel, StateFolderPanel, StatisticsPanel} from '../server/Dashboard';
import {TelevisionDashboard} from '../server/TelevisionDashboard';
import {LibrariesPanel} from '../server/LibrariesPanel';
import {LibraryChannelsPanel, LiveSourcesPanel, RecordingRulesPanel, RecordingStoragePanel, TunersPanel} from '../server/LivePanels';
import {APIKeysPanel, AssistantsPanel, MemberTokensPanel, WebhooksPanel} from '../server/Integrations';
import {MetadataSettingsPanel} from '../server/MetadataPanels';
import {AccountsPanel, InvitationsPanel} from '../server/PeoplePanels';
import {BackgroundPauseRow, ClientReportsPanel, DownloadUsagePanel, FFmpegStatusRow, PlaybackProblemsPanel, ResourceUsagePanel, RestartPanel, SetAsideTitlesPanel, StorageStatusPanel} from '../server/RuntimePanels';
import {ScheduledJobsPanel, WindowsPanel} from '../server/SchedulePanels';
import {AccountConnectionPanel, AddressesRows, CertificateStatusRows, ConnectionRows, IdentityRows, OwnCertificateStatusRows, RemoteStatusPanel, TranscodeStatusPanel, UpdatesPanel} from '../server/Status';
import {PlayHistoryPanel} from '../server/PlayHistory';
import {BackupsPanel, DiskUsagePanel, MissingTitlesPanel, RemoteSourcesPanel, RetentionRows} from '../server/StoragePanels';
import {CapabilitiesPanel, DetailWindowRow, FeedbackPanel, MessageLogPanel, RecordsPanel, SupportExportPanel} from '../server/Troubleshooting';
import {FormLoadNotice, SaveBar, ServerFormsProvider, ServerSettingRowView, useFormsAbsent, useReloadForms} from './ServerForms';

/** Panels that are rows inside their section's group; every other panel brings its own groups. */
const ROW_PANELS: ReadonlySet<SettingsCustomId> = new Set(['server.certificateStatus', 'server.addresses', 'server.connection', 'server.ownCertificateStatus', 'server.retention', 'server.detailWindow', 'server.identity', 'server.backgroundPause', 'server.ffmpegStatus']);

/** The Server pages' `custom` rows (settings-structure.ts), drawn natively on phones and tablets. The state-folder warning is part of the alerts. */
function ServerPanel({id}: {id: SettingsCustomId}) {
  switch (id) {
    case 'server.nowPlaying': return <NowPlayingPanel />;
    case 'server.alerts': return <AlertsPanel />;
    case 'server.health': return <HealthPanel />;
    case 'server.activity': return <JobsPanel />;
    case 'server.statistics': return <StatisticsPanel />;
    case 'server.libraries': return <LibrariesPanel />;
    case 'server.liveSources': return <LiveSourcesPanel />;
    case 'server.tuners': return <TunersPanel />;
    case 'server.recordingRules': return <RecordingRulesPanel />;
    case 'server.recordingStorage': return <RecordingStoragePanel />;
    case 'server.channels': return <LibraryChannelsPanel />;
    case 'server.accounts': return <AccountsPanel />;
    case 'server.invitations': return <InvitationsPanel />;
    case 'server.apiKeys': return <APIKeysPanel />;
    case 'server.memberTokens': return <MemberTokensPanel />;
    case 'server.webhooks': return <WebhooksPanel />;
    case 'server.assistants': return <AssistantsPanel />;
    case 'server.transcodeStatus': return <TranscodeStatusPanel />;
    case 'server.remoteStatus': return <RemoteStatusPanel />;
    case 'server.accountConnection': return <AccountConnectionPanel />;
    case 'server.certificateStatus': return <CertificateStatusRows />;
    case 'server.addresses': return <AddressesRows />;
    case 'server.connection': return <ConnectionRows />;
    case 'server.ownCertificateStatus': return <OwnCertificateStatusRows />;
    case 'server.diskUsage': return <DiskUsagePanel />;
    case 'server.retention': return <RetentionRows />;
    case 'server.remoteSources': return <RemoteSourcesPanel />;
    case 'server.backups': return <BackupsPanel />;
    case 'server.playHistory': return <PlayHistoryPanel />;
    case 'server.missingTitles': return <MissingTitlesPanel />;
    case 'server.windows': return <WindowsPanel />;
    case 'server.jobs': return <ScheduledJobsPanel />;
    case 'server.detailWindow': return <DetailWindowRow />;
    case 'server.logs': return <MessageLogPanel />;
    case 'server.records': return <RecordsPanel />;
    case 'server.capabilities': return <CapabilitiesPanel />;
    case 'server.supportExport': return <SupportExportPanel />;
    case 'server.feedback': return <FeedbackPanel />;
    case 'server.identity': return <IdentityRows />;
    case 'server.updates': return <UpdatesPanel />;
    case 'server.metadataSettings': return <MetadataSettingsPanel />;
    case 'server.resourceUsage': return <ResourceUsagePanel />;
    case 'server.storageStatus': return <StorageStatusPanel />;
    case 'server.downloadUsage': return <DownloadUsagePanel />;
    case 'server.backgroundPause': return <BackgroundPauseRow />;
    case 'server.ffmpegStatus': return <FFmpegStatusRow />;
    case 'server.restart': return <RestartPanel />;
    case 'server.setAsideTitles': return <SetAsideTitlesPanel />;
    case 'server.clientReports': return <ClientReportsPanel />;
    case 'server.playbackProblems': return <PlaybackProblemsPanel />;
    case 'server.stateFolder': return <StateFolderPanel />;
    default: return null;
  }
}

/**
 * The frame of one Server page: its forms (one Save for the page) and its refresh scope (one
 * refresh for the page). `refresh` is handed to the screen's pull-to-refresh; `bar` is the Save
 * bar, placed by the screen under its scroller.
 */
export function ServerPageScope({children}: {children: (frame: {refresh: () => void; bar: React.ReactNode}) => React.ReactNode}) {
  const scope = useMemo(() => new RefreshScope(), []);
  return (
    <ServerFormsProvider>
      <RefreshScopeContext.Provider value={scope}>
        <Framed scope={scope}>{children}</Framed>
      </RefreshScopeContext.Provider>
    </ServerFormsProvider>
  );
}

function Framed({scope, children}: {scope: RefreshScope; children: (frame: {refresh: () => void; bar: React.ReactNode}) => React.ReactNode}) {
  const reloadForms = useReloadForms();
  return <>{children({refresh: () => { scope.refresh(); reloadForms(); }, bar: <SaveBar />})}</>;
}

/**
 * One page of the Server heading: status and lists are panels, plain settings are rows bound to
 * the page's forms. Television draws none of that: its one Server page is the read-only
 * Dashboard, and no owner panel or setting is drawn there whatever the structure lists.
 */
export function ServerPageBody({page, entry}: {page: StructurePage; /** TV: the first row takes focus when the page opens. */ entry?: boolean}) {
  const {space} = useTheme();
  if (isTV) return page.id === 'dashboard' ? <View style={{gap: space.xl}}><TelevisionDashboard entry={entry} /></View> : null;
  return <ServerPagePanels page={page} />;
}

function ServerPagePanels({page}: {page: StructurePage}) {
  const t = useI18n().t;
  const {space} = useTheme();
  const [tab, setTab] = useState(page.tabs?.[0]?.id);
  const sections = page.sections.filter(section => !page.tabs || section.tab === tab);
  return (
    <View style={{gap: space.xl}}>
      {page.tabs ? <Segmented accessibilityLabel={t(page.title)} items={page.tabs.map(x => ({id: x.id, label: t(x.title)}))} selected={tab!} onSelect={setTab} /> : null}
      {sections.map(section => <ServerSection key={section.id} section={section} />)}
    </View>
  );
}

function ServerSection({section}: {section: SettingsSection}) {
  const t = useI18n().t;
  const [open, setOpen] = useState(!section.advanced);
  const groups = section.rows.filter(row => row.kind === 'custom' && !ROW_PANELS.has(row.id));
  const rows = section.rows.filter(row => !(row.kind === 'custom' && !ROW_PANELS.has(row.id)));
  const forms = [...new Set(rows.flatMap(row => (row.kind === 'server-setting' ? [row.form] : [])))];
  // A group of settings whose documents this server does not have is left out, heading and all.
  const absent = useFormsAbsent(forms) && rows.every(row => row.kind === 'server-setting');
  const draw = (row: StructureRow) => row.kind === 'custom' ? <ServerPanel key={row.id} id={row.id} /> : row.kind === 'server-setting' ? <ServerSettingRowView key={settingsRowId(row)} row={row} /> : null;
  // A panel keeps its authored place: one written after the section's rows (the list under a rule) is drawn below them.
  const firstRow = section.rows.findIndex(row => rows.includes(row));
  const after = firstRow < 0 ? [] : groups.filter(row => section.rows.indexOf(row) > firstRow);
  return (
    <>
      {groups.filter(row => !after.includes(row)).map(draw)}
      {forms.map(id => <FormLoadNotice key={id} id={id} />)}
      {rows.length && !absent ? (
        <RowGroup title={!section.advanced && section.title ? t(section.title) : undefined} footer={section.description ? t(section.description) : undefined}>
          {section.advanced ? <ListRow title={t(section.title ?? 'settings.section.advanced')} trailingIcon={open ? 'chevronUp' : 'chevronDown'} accessibilityState={{expanded: open}} onPress={() => setOpen(o => !o)} /> : null}
          {open ? rows.map(draw) : null}
        </RowGroup>
      ) : null}
      {after.map(draw)}
    </>
  );
}
