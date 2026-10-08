import React, {useEffect, useMemo, useSyncExternalStore} from 'react';
import {Linking} from 'react-native';
import {PlaybackSettingsService, type PlaybackSettingsSnapshot} from '../../../../../packages/client-core/src/playback-settings';
import {checkRemoteAccess, remoteAccessHelp, type RemoteAccess, type RemoteConfiguration} from '../../../../../packages/client-core/src/remote-access';
import {certificateDate, certificateSummary, retryCertificate, type CertificateApi, type CertificateConfig, type CertificateStatus} from '../../../../../packages/client-core/src/certificates';
import type {ConnectivityStatus} from '../../../../../packages/client-core/src/server-administration';
import type {ConnectivityDraft} from '../../../../../packages/client-core/src/server-admin/server-forms';
import {parseUpdateReport} from '../../../../../packages/client-core/src/administration';
import {ClaimOnboarding} from '../../../../../packages/client-core/src/claim-onboarding';
import {viewerScope} from '../../../../../packages/client-core/src/presentation/index';
import {sentence} from '../../../../../packages/client-core/src/server-admin/console-words';
import {addressKind, certificateBadge, connectivityWarning, deliveryStatusRows, listedAddresses, mappingProblem, remoteStatusLine} from '../../../../../packages/client-core/src/server-admin/status-words';
import type {HttpLocalApi} from '../../../../../packages/client-core/src/index';
import {useSession} from '../../app/session';
import {useI18n} from '../../app/i18n';
import {useAction, useRead, useService} from '../../app/server-console';
import {ListRow, Notice, RowGroup, isTV} from '../../ui';
import {WebHandoff} from '../SettingsPages';
import {useServerForm} from '../settings/ServerForms';

const dateTime = (iso: string) => (iso ? new Date(iso).toLocaleString(undefined, {dateStyle: 'medium', timeStyle: 'short'}) : '—');

/** Playback › Right now: what the server reports about delivery, above the settings. */
export function TranscodeStatusPanel() {
  const {api, session} = useSession();
  const t = useI18n().t;
  const {viewerId, serverId} = viewerScope(session, api);
  const {service, snapshot} = useService<PlaybackSettingsService, PlaybackSettingsSnapshot>(() => new PlaybackSettingsService({api: {requestBounded: (path, _max, signal) => api.request(path, 'GET', undefined, signal)}, scope: {viewerId, serverId}}), [api, viewerId, serverId]);
  useEffect(() => { void service.refresh(); }, [service]);
  const d = snapshot.observation?.diagnostics;
  return (
    <>
      {snapshot.error ? <Notice tone="error" message={snapshot.error} action={t('action.tryAgain')} onAction={() => void service.refresh()} /> : null}
      {d ? <RowGroup title={t('settings.server.transcodeStatus')}>{deliveryStatusRows(t, d).map(([label, value]) => <ListRow key={label} title={label} meta={value} />)}</RowGroup> : null}
    </>
  );
}

/** Remote access › status: one sentence that answers "can people reach this server from outside?", before any setting. */
export function RemoteStatusPanel() {
  const {api} = useSession();
  const t = useI18n().t;
  const remote = useServerForm<RemoteConfiguration, RemoteAccess>('remote');
  const certificate = useServerForm<CertificateConfig, CertificateStatus>('certificate');
  const connectivity = useServerForm<ConnectivityDraft, ConnectivityStatus>('connectivity');
  const action = useAction();
  const st = remote.state.status;
  const line = remoteStatusLine(t, {unavailable: remote.state.unavailable, remote: st, certificate: certificate.state.status, connectivity: connectivity.state.status});
  return (
    <>
      {line.text ? (
        <RowGroup>
          <ListRow readable icon={line.tone === 'healthy' ? 'check' : line.tone === 'warning' ? 'warning' : 'globe'} title={line.text} subtitleLines={3} />
          {/* Asking the server to test the route again is this page's one check. */}
          {st ? <ListRow tone="action" title={action.busy ? t('settings.server.remote.checking') : t('server.remote.checkAgain')} disabled={action.busy} onPress={() => void action.run(async () => { await checkRemoteAccess(api as HttpLocalApi); await remote.form.load(); })} /> : null}
        </RowGroup>
      ) : null}
      {st?.errorCode ? <Notice tone="warning" message={remoteAccessHelp(st.errorCode)} /> : null}
      {connectivity.state.status?.warnings.map(w => <Notice key={w} tone="warning" message={connectivityWarning(t, w)} />)}
      {action.error ? <Notice tone="error" message={action.error} /> : null}
    </>
  );
}

/** The certificate's state and details, above its two settings. */
export function CertificateStatusRows() {
  const {api} = useSession();
  const t = useI18n().t;
  const {form, state} = useServerForm<CertificateConfig, CertificateStatus>('certificate');
  const action = useAction();
  const st = state.status;
  if (!st) return null;
  const certApi: CertificateApi = {requestCertificate: (act, body, signal) => (act === 'status' ? api.request('/v1/networking/certificate', 'GET', undefined, signal) : api.request(`/v1/networking/certificate/${act}`, 'POST', body, signal))};
  const badge = certificateBadge(t, st);
  const retry = () => void action.run(async () => { const controller = new AbortController(); const timer = setTimeout(() => controller.abort(), 15000); try { await retryCertificate(certApi, controller.signal); } finally { clearTimeout(timer); } await form.load(); });
  return (
    <>
      <ListRow title={t('web.general.status')} subtitle={certificateSummary(st)} meta={badge.label} />
      {st.dnsName ? <ListRow title={t('server.cert.name')} subtitle={st.dnsName} /> : null}
      {st.issuer ? <ListRow title={t('server.cert.issuer')} meta={st.issuer} /> : null}
      {st.notAfter ? <ListRow title={t('server.cert.expires')} meta={certificateDate(st.notAfter)} /> : null}
      {st.notAfter ? <ListRow title={t('server.cert.renews')} meta={certificateDate(st.renewAt)} /> : null}
      {st.errorCode ? <ListRow tone="action" title={t('action.tryAgain')} subtitle={[t('web.network.certificateProblem'), st.nextAttemptAt ? t('server.cert.nextAttempt', {when: certificateDate(st.nextAttemptAt)}) : '', action.error].filter(Boolean).join(' · ')} disabled={action.busy} onPress={retry} /> : null}
    </>
  );
}

/** Home network › what the server answers on, and what the router mapped for it. */
export function AddressesRows() {
  const t = useI18n().t;
  const remote = useServerForm<RemoteConfiguration, RemoteAccess>('remote').state.status;
  const status = useServerForm<ConnectivityDraft, ConnectivityStatus>('connectivity').state.status;
  if (!status?.addresses.length && !remote) return null;
  return (
    <>
      {listedAddresses(status?.addresses ?? []).map((a, i) => <ListRow key={`${i}:${a.address}`} title={a.address} meta={addressKind(t, a.class)} />)}
      {status?.omittedAddresses ? <ListRow title={t('web.network.moreAddresses', {count: status.omittedAddresses})} /> : null}
      {remote?.mappings.map(m => <ListRow key={m.protocol} title={`${t('web.network.mappings')} · ${m.protocol.toUpperCase()}`} subtitle={[sentence(m.state), t('server.address.port', {port: m.externalPort}), m.errorCode ? mappingProblem(t, m.errorCode) : ''].filter(Boolean).join(' · ')} />)}
    </>
  );
}

/** Remote access › Portico Account: whether this server is connected to its owner's account. Connecting is approved in a browser. */
export function AccountConnectionPanel() {
  const session = useSession();
  const t = useI18n().t;
  const pin = session.api.getRouteConnection()?.pin;
  const claim = useMemo(() => (pin ? new ClaimOnboarding(session.api, pin) : undefined), [session.api, pin]);
  const empty = useMemo(() => ({subscribe: () => () => {}, getSnapshot: () => null}), []);
  const state = useSyncExternalStore(claim?.subscribe ?? empty.subscribe, claim?.getSnapshot ?? empty.getSnapshot);
  useEffect(() => { void claim?.start(); return () => claim?.dispose(); }, [claim]);
  const status = state?.status;
  const connected = !!status && (status.state === 'installed' || status.state === 'claimed' || status.state === 'connected');
  const pending = !!status && !connected && (status.approvalRequired || !!status.operation);
  const serverUrl = (session.serverUrl ?? session.api.baseUrl).replace(/\/$/, '');
  return (
    <>
      <RowGroup title={t('web.general.accountConnection')} footer={t('web.general.accountConnectionHelp')}>
        <ListRow readable title={t('web.general.status')} meta={status ? (connected ? t('web.general.connectedBadge') : pending ? t('web.general.approvalPending') : t('web.general.notConnectedBadge')) : state?.error ? t('web.general.notConnectedBadge') : t('web.general.checking')}
          subtitle={status ? (connected ? t('web.general.signedIn') : pending ? t('web.general.approvalWaiting') : t('web.general.notConnected')) : undefined} />
        {status && (status.actions.includes('continue') || pending) ? <ListRow tone="action" title={t('web.general.checkStatus')} disabled={state?.busy} onPress={() => void claim?.refresh(true)} /> : null}
        {status?.actions.includes('cancel') ? <ListRow tone="destructive" title={t('web.general.cancelRequest')} disabled={state?.busy} onPress={() => void claim?.cancel()} /> : null}
      </RowGroup>
      {status && state?.error ? <Notice tone="error" message={t('server.claim.checkFailed')} action={t('action.tryAgain')} onAction={() => void claim?.refresh(true)} /> : null}
      {/* The approval itself happens on the Portico Account's page, in a browser. */}
      {(status || state?.error) && !connected && !pending ? <WebHandoff url={`${serverUrl}/settings/server-remote`} title={t('web.general.connectAction')} subtitle={t('web.general.connectHelp')} /> : null}
    </>
  );
}

/** General › Identity: what this server is, beside its name. */
export function IdentityRows() {
  const session = useSession();
  const t = useI18n().t;
  return (
    <>
      <ListRow title={t('web.general.serverProduct')} meta={session.system?.version ?? '—'} />
      <ListRow title={t('web.general.serverId')} subtitle={session.system?.id ?? '—'} />
    </>
  );
}

/** General › Version and updates: what is running and what is new. Portico never installs an update by itself. */
export function UpdatesPanel() {
  const {api} = useSession();
  const t = useI18n().t;
  const read = useRead(() => api.request<unknown>('/v1/admin/updates').then(parseUpdateReport), [api]);
  const report = read.data;
  const url = report?.latest?.url;
  return (
    <>
      {read.error ? <Notice tone={report ? 'warning' : 'error'} message={read.error} action={t('action.tryAgain')} onAction={read.reload} /> : null}
      {report ? (
        <RowGroup title={t('web.general.updates')} footer={t('web.maintenance.updatesLede')}>
          <ListRow readable title={t('web.maintenance.thisServer')} meta={report.current.version || t('web.maintenance.devBuild')} subtitle={report.current.builtAt ? t('web.maintenance.builtAt', {when: dateTime(report.current.builtAt), channel: report.channel}) : t('web.maintenance.channelOnly', {channel: report.channel})} />
          <ListRow title={report.status === 'update-available' ? t('web.maintenance.updateAvailable') : report.status === 'current' ? t('web.maintenance.upToDate') : t('web.maintenance.updateCheck')} subtitle={report.message || report.latest?.notes || undefined}
            meta={report.status === 'update-available' ? report.latest?.version ?? t('web.maintenance.newVersion') : report.status === 'current' ? t('web.maintenance.currentVersion') : report.status === 'no-feed' ? t('web.maintenance.noFeed') : t('web.maintenance.updateUnavailable')} />
          {url && !isTV ? <ListRow tone="action" title={t('web.maintenance.releaseNotes')} trailingIcon="external" onPress={() => { Linking.openURL(url).catch(() => {}); }} /> : null}
        </RowGroup>
      ) : null}
    </>
  );
}
