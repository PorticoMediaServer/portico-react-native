import React, {useCallback, useEffect, useRef, useState} from 'react';
import {View} from 'react-native';
import type {HostedServer} from '../../../../../packages/client-core/src/index';
import {presenceLabel, sortServersByPresence} from '../../../../../packages/client-core/src/index';
import {chooserFailureView} from './chooser-presence';
import {landingChoice} from '../../app/portico-landing';
import type {PorticoFailure} from '../../app/portico-failure';
import {useI18n} from '../../app/i18n';
import {useSession} from '../../app/session';
import {Button, ListRow, StateView, Surface, Text, useTheme} from '../../ui';
import {ShellFrame} from '../../shell/ShellFrame';
import {DirectStepScreen} from './DirectSignIn';

type Landing =
  | {kind: 'deciding'}
  | {kind: 'opening'; server: HostedServer}
  | {kind: 'pick'}
  | {kind: 'none'}
  | {kind: 'failed'; server: HostedServer; failure: PorticoFailure};

/**
 * Where a Portico Account lands after signing in (Justin): the shell at once, never a separate
 * "Choose a server" screen. One server opens by itself; with several, the one used last on this
 * device opens; only otherwise is a picker shown, centered in the shell with Refresh Servers. A
 * failure says exactly what failed, in the shell, with the action that fits.
 */
export function PorticoLanding({onSignOut, onDirect}: {onSignOut: () => void; onDirect: () => void}) {
  const session = useSession();
  const i18n = useI18n();
  const {space, isTV} = useTheme();
  const servers = session.servers;
  const status = session.directoryStatus;
  const [landing, setLanding] = useState<Landing>({kind: 'deciding'});
  const decided = useRef(false);
  const {open: openServer, lastServer} = session.portico;
  const open = useCallback((server: HostedServer) => {
    session.clearError();
    setLanding({kind: 'opening', server});
    void openServer(server).then(failure => { if (failure) setLanding({kind: 'failed', server, failure}); }, () => setLanding({kind: 'failed', server, failure: {kind: 'other', server: server.name}}));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [openServer]);
  // Decide once the list is known; again if a list that was empty gains a server (Refresh Servers).
  useEffect(() => {
    if (status === 'loading' && !servers.length) return;
    if (decided.current && !(landing.kind === 'none' && servers.length)) return;
    decided.current = true;
    let live = true;
    void lastServer().then(last => {
      if (!live) return;
      const choice = landingChoice(servers, last);
      if (choice.kind === 'open') open(choice.server);
      else setLanding({kind: choice.kind});
    });
    return () => { live = false; };
  }, [status, servers, landing.kind, lastServer, open]);
  const account = session.hosted?.account;
  const profileName = account?.displayName || account?.username;
  const others = (server?: HostedServer) => servers.some(s => s.id !== server?.id);
  // X-13: online servers first, then the rest by last seen (unknown last). An offline server is
  // dimmed with when it was last seen; unknown presence renders normally.
  const ordered = sortServersByPresence(servers);
  const presenceSubtitle = (server: HostedServer): string | undefined => {
    const label = presenceLabel(server.presence);
    if (label.kind === 'lastSeen') return i18n.t('web.chooser.lastSeen', {date: i18n.date(label.lastSeenAt, 'dayMonth')});
    if (label.kind === 'neverSeen') return i18n.t('web.chooser.neverSeen');
    return server.presence ? i18n.t(server.presence.online ? 'web.servers.online' : 'web.servers.offline') : undefined;
  };
  const offlineBody = (server: HostedServer): string => {
    const label = presenceLabel(server.presence);
    return label.kind === 'lastSeen' ? i18n.t('web.chooser.unreachableBody', {date: i18n.date(label.lastSeenAt, 'dayMonth')}) : i18n.t('web.chooser.unreachableBodyNever');
  };
  const signOut = <View style={{alignItems: 'center'}}><Button variant="ghost" icon="signOut" label={i18n.t('auth.signOutOfAccount')} onPress={onSignOut} /></View>;

  // A two-step code for this server: its own step screen (typing a code is the whole task).
  if (session.direct.step && session.direct.step !== 'device-pending') return <DirectStepScreen />;
  let content: React.ReactNode;
  if (session.direct.step === 'device-pending') {
    content = (
      <>
        <StateView icon="lock" title={i18n.t('device.approval.titleThisDevice')} message={i18n.t('device.approval.body')} action={i18n.t('device.approval.checkAgain')} onAction={() => void session.direct.retrySignIn()} secondaryAction={others() ? i18n.t('portico.landing.chooseAnother') : undefined} onSecondaryAction={() => { session.direct.cancelStep(); setLanding({kind: 'pick'}); }} />
        {session.error ? <Text variant="caption" tone="danger" align="center">{session.error}</Text> : null}
        {signOut}
      </>
    );
  } else if (landing.kind === 'deciding' || (landing.kind === 'opening')) {
    content = <StateView loading title={landing.kind === 'opening' ? i18n.t('portico.landing.opening', {server: landing.server.name}) : i18n.t('portico.landing.finding')} />;
  } else if (landing.kind === 'failed') {
    const {server} = landing;
    // A migrated sign-in is re-admitted silently; if one reaches here it is simply a failed sign-in.
    const failure = landing.failure.kind === 'migrated' ? {...landing.failure, kind: 'other' as const} : landing.failure;
    // X-13: a stale offline server names the problem and offers direct sign-in with its address
    // prefilled, never the keep-trying promise (that copy is only for a server seen within the
    // hour). No removal here: the Hosted endpoint to remove a server doesn't exist yet.
    if (failure.kind === 'unreachable' && chooserFailureView(server.presence, true) === 'offline-dialog') {
      content = (
        <>
          <StateView icon="warning" title={i18n.t('web.chooser.unreachableTitle', {server: server.name})} message={offlineBody(server)} />
          <View style={{gap: space.sm, alignItems: 'center'}}>
            <Button variant="primary" size="lg" label={i18n.t('web.chooser.tryAgain')} hasTVPreferredFocus={isTV} onPress={() => open(server)} />
            <Button variant="secondary" label={i18n.t('web.chooser.signInDirectly')} onPress={() => { session.direct.setOrigin(server.baseUrl); onDirect(); }} />
            {others(server) ? <Button variant="ghost" label={i18n.t('portico.landing.chooseAnother')} onPress={() => setLanding({kind: 'pick'})} /> : null}
          </View>
          {signOut}
        </>
      );
    } else {
    const title = i18n.t(`portico.failure.${failure.kind}.title` as never, {server: failure.server});
    const body = failure.kind === 'other' ? (failure.code ? i18n.t('portico.failure.other.body', {code: failure.code}) : i18n.t('portico.failure.other.bodyUnknown')) : i18n.t(`portico.failure.${failure.kind}.body` as never);
    // No access: the server is gone from this account; trying it again can't help.
    const retry = failure.kind !== 'noAccess' && failure.kind !== 'deviceDenied';
    content = (
      <>
        <StateView icon={failure.kind === 'unreachable' ? 'network' : failure.kind === 'clockSkew' ? 'clock' : failure.kind === 'noAccess' || failure.kind === 'identity' || failure.kind === 'deviceDenied' || failure.kind === 'devicePending' ? 'lock' : 'warning'} title={title} message={body}
          action={retry ? i18n.t('action.tryAgain') : others(server) ? i18n.t('portico.landing.chooseAnother') : undefined}
          onAction={() => (retry ? open(server) : setLanding({kind: 'pick'}))}
          secondaryAction={retry && others(server) ? i18n.t('portico.landing.chooseAnother') : undefined}
          onSecondaryAction={() => setLanding({kind: 'pick'})} />
        {__DEV__ && failure.detail ? <Text variant="caption" tone="tertiary" align="center">{failure.detail}</Text> : null}
        {signOut}
      </>
    );
    }
  } else if (landing.kind === 'none') {
    content = status === 'error' ? (
      <>
        <StateView icon="warning" title={i18n.t('portico.landing.listFailed')} message={session.directoryError || i18n.t('auth.hostedUnreachable')} action={i18n.t('action.tryAgain')} onAction={session.refreshServers} />
        {signOut}
      </>
    ) : (
      <>
        <StateView icon="server" title={i18n.t('web.chooser.noneTitle')} message={i18n.t('web.chooser.noneBody')} action={i18n.t('web.servers.refresh')} onAction={session.portico.refreshServers} secondaryAction={i18n.t('auth.signInDirectly')} onSecondaryAction={onDirect} />
        {signOut}
      </>
    );
  } else {
    content = (
      <View style={{gap: space.md}}>
        <Text variant="title" align="center">{i18n.t('portico.landing.pickTitle')}</Text>
        <Text variant="body" tone="secondary" align="center">{i18n.t('portico.landing.pickBody')}</Text>
        <Surface padded={false}>
          {ordered.map((server, index) => (
            <ListRow key={server.id} icon="server" title={server.name} subtitle={presenceSubtitle(server)} trailingIcon="forward" hasTVPreferredFocus={isTV && index === 0} style={server.presence?.online === false ? {opacity: 0.55} : undefined} onPress={() => open(server)} />
          ))}
        </Surface>
        <View style={{alignItems: 'center'}}>
          <Button variant="ghost" icon="refresh" label={i18n.t('web.servers.refresh')} onPress={session.portico.refreshServers} />
          {signOut}
        </View>
      </View>
    );
  }
  return <ShellFrame profileName={profileName}>{content}</ShellFrame>;
}
