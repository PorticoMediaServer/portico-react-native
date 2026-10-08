import React, {useEffect, useRef, useState} from 'react';
import {View} from 'react-native';
import type {HostedServer} from '../../../../../packages/client-core/src/index';
import {presenceLabel, sortServersByPresence} from '../../../../../packages/client-core/src/index';
import {chooserFailureView} from './chooser-presence';
import {friendlyHost} from '../../app/content';
import {useSession, type PorticoOutcome} from '../../app/session';
import {Button, ListRow, Notice, StateView, Surface, useTheme} from '../../ui';
import {AuthFrame} from './AuthFrame';
import {DirectProfiles} from './DirectProfiles';
import {useI18n} from '../../app/i18n';

/**
 * A Portico Account's servers (Spec — Hosted at Scale). Choosing one signs in to it with the
 * account (a Hosted identity assertion the server checks itself), then the server's own profile
 * chooser, the same one as a direct sign-in. Used after signing in to the account and from
 * Settings › Switch server.
 */
export function HostedChooser({onBack, onSignOut, onDirect, initialServerId, title = 'Choose a server'}: {onBack?: () => void; /** Open this server straight away (a named server chosen in Settings). */ initialServerId?: string; onSignOut?: () => void; onDirect?: (address?: string) => void; title?: string}) {
  const session = useSession();
  const i18n = useI18n();
  const {space, isTV} = useTheme();
  const [target, setTarget] = useState<HostedServer>();
  const [outcome, setOutcome] = useState<PorticoOutcome>();
  const [opened, setOpened] = useState(false);
  const current = session.session?.viewer.serverId;
  const servers = session.servers;
  // X-13: online servers first, then the rest by last seen (unknown last).
  const ordered = sortServersByPresence(servers);
  // X-13: an offline server is dimmed with when it was last seen; unknown presence renders normally.
  const presenceSubtitle = (server: HostedServer): string | undefined => {
    if (server.id === current) return i18n.t('web.chooser.current');
    const label = presenceLabel(server.presence);
    if (label.kind === 'lastSeen') return i18n.t('web.chooser.lastSeen', {date: i18n.date(label.lastSeenAt, 'dayMonth')});
    if (label.kind === 'neverSeen') return i18n.t('web.chooser.neverSeen');
    return undefined;
  };
  const offlineBody = (server: HostedServer): string => {
    const label = presenceLabel(server.presence);
    return label.kind === 'lastSeen' ? i18n.t('web.chooser.unreachableBody', {date: i18n.date(label.lastSeenAt, 'dayMonth')}) : i18n.t('web.chooser.unreachableBodyNever');
  };
  const connect = (server: HostedServer) => {
    setTarget(server);
    setOutcome(undefined);
    setOpened(true);
    void session.portico.connect(server).then(setOutcome, () => setOutcome('failed'));
  };
  // The server chosen in Settings, or the only one: opened without asking again (once).
  const auto = useRef(false);
  useEffect(() => {
    if (auto.current || session.directoryStatus !== 'ready' || session.busy) return;
    const chosen = initialServerId && initialServerId !== current ? servers.find(s => s.id === initialServerId) : !current && servers.length === 1 ? servers[0] : undefined;
    if (!chosen) return;
    auto.current = true;
    connect(chosen);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [session.directoryStatus, servers, initialServerId, current]);
  // The server answered with its profiles: its own chooser, here.
  if (opened && session.direct.pending) return <DirectProfiles onCancel={() => { session.direct.cancelPending(); setOpened(false); setTarget(undefined); }} />;
  const connecting = !!target && session.busy && !outcome;
  const account = session.hosted?.account;
  if (target && outcome === 'unreachable') {
    // X-13: a stale offline server names the problem and offers direct sign-in, never the
    // keep-trying promise (that copy is only for a server seen within the hour). No removal
    // here: the Hosted endpoint to remove a server doesn't exist yet.
    if (chooserFailureView(target.presence, true) === 'offline-dialog') {
      return (
        <AuthFrame title={i18n.t('web.chooser.unreachableTitle', {server: target.name})} lead={offlineBody(target)} centered={isTV} onBack={() => { setTarget(undefined); setOutcome(undefined); }}>
          <View style={{gap: space.sm, alignItems: isTV ? 'center' : 'stretch'}}>
            <Button variant="primary" size="lg" label={i18n.t('web.chooser.tryAgain')} hasTVPreferredFocus fullWidth={!isTV} loading={session.busy} onPress={() => connect(target)} />
            {onDirect ? <Button variant="secondary" label={i18n.t('web.chooser.signInDirectly')} fullWidth={!isTV} onPress={() => { session.direct.setOrigin(target.baseUrl); onDirect(target.baseUrl); }} /> : null}
            <Button variant="ghost" label={i18n.t('web.chooser.otherServer')} fullWidth={!isTV} onPress={() => { setTarget(undefined); setOutcome(undefined); }} />
          </View>
        </AuthFrame>
      );
    }
    return (
      <AuthFrame title={i18n.t('web.chooser.waitingTitle', {server: target.name})} lead={i18n.t('web.chooser.waitingBody')} centered={isTV} onBack={() => { setTarget(undefined); setOutcome(undefined); }}>
        <View style={{gap: space.sm, alignItems: isTV ? 'center' : 'stretch'}}>
          <Button variant="primary" size="lg" label={i18n.t('web.chooser.checkNow')} hasTVPreferredFocus fullWidth={!isTV} loading={session.busy} onPress={() => connect(target)} />
          {onDirect ? <Button variant="secondary" label={i18n.t('auth.signInDirectly')} fullWidth={!isTV} onPress={() => onDirect(target.baseUrl)} /> : null}
          <Button variant="ghost" label={i18n.t('web.chooser.otherServer')} fullWidth={!isTV} onPress={() => { setTarget(undefined); setOutcome(undefined); }} />
        </View>
      </AuthFrame>
    );
  }
  return (
    <AuthFrame title={title} lead={account ? `Signed in as ${account.displayName || account.username}` : i18n.t('web.chooser.lede')} onBack={onBack} error={session.error} onDismissError={session.clearError}>
      {connecting ? (
        <StateView loading title={i18n.t('web.chooser.connecting', {server: target!.name})} />
      ) : session.directoryStatus === 'loading' && !servers.length ? (
        <StateView loading title={i18n.t('auth.findingServers')} />
      ) : session.directoryStatus === 'error' && !servers.length ? (
        <Notice tone="warning" message={session.directoryError || i18n.t('auth.hostedUnreachable')} action={i18n.t('web.chooser.tryAgain')} onAction={session.refreshServers} />
      ) : !servers.length ? (
        <StateView icon="server" title={i18n.t('web.chooser.noneTitle')} message={i18n.t('web.chooser.noneBody')} action={onDirect ? i18n.t('auth.signInDirectly') : i18n.t('action.refresh')} onAction={onDirect ? () => onDirect() : session.refreshServers} />
      ) : (
        <Surface padded={false}>
          {ordered.map((server, index) => (
            <ListRow key={server.id} icon="server" title={server.name} subtitle={presenceSubtitle(server) ?? friendlyHost(server.baseUrl)} trailingIcon="forward" hasTVPreferredFocus={index === 0} disabled={session.busy} style={server.presence?.online === false && server.id !== current ? {opacity: 0.55} : undefined} onPress={() => (server.id === current && onBack ? onBack() : connect(server))} />
          ))}
        </Surface>
      )}
      {/* A server shared with this account since the last check (an invitation accepted elsewhere) appears
          at once; automatic checks are hours apart. */}
      {!connecting && session.directoryStatus !== 'loading' ? <Button variant="ghost" icon="refresh" label={i18n.t('web.servers.refresh')} onPress={session.portico.refreshServers} /> : null}
      {onSignOut ? <Button variant="ghost" icon="signOut" label={i18n.t('auth.signOutOfAccount')} onPress={onSignOut} /> : null}
    </AuthFrame>
  );
}
