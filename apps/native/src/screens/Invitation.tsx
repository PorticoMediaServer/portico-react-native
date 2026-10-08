import React, {useEffect, useState} from 'react';
import {Linking, View} from 'react-native';
import {useNavigation} from '@react-navigation/native';
import {connectPairedServer, inspectDirectServer} from '../../../../packages/client-core/src/server-connections';
import {signInMessage} from '../app/errors';
import {useI18n} from '../app/i18n';
import {useSession} from '../app/session';
import {heldJoinLink, releaseJoinLink, type JoinLink} from '../app/join-link';
import {nativeConnectionEnvironment} from '../bridge/server-connections';
import {Button, StateView, showToast, useTheme} from '../ui';
import {AuthFrame} from './auth/AuthFrame';
import {DirectProfiles} from './auth/DirectProfiles';

/** Accept outcome → what to tell the person (`POST /v1/access/invitations/accept`). */
function joinError(e: unknown, t: ReturnType<typeof useI18n>['t']): string {
  switch ((e as {status?: number} | null)?.status) {
    case 404: case 410: return t('web.directJoin.error.expired');
    case 429: return t('web.directJoin.error.tooMany');
    case 400: return t('web.directJoin.error.expired');
    default: return signInMessage(e);
  }
}

/**
 * A server's invitation (Spec — Hosted at Scale): `…/join#code=…&server=…`. With a Portico
 * Account the server checks the code and the account, makes the membership and signs this device
 * in, so the server is added at once. Without one, the invitation opens in the browser on the
 * server's own join page (a username and password there). An old Portico Account invitation says
 * to ask for a new one: servers own membership now.
 */
export function JoinServer({link, onDone}: {link?: JoinLink; onDone: () => void}) {
  const session = useSession();
  const i18n = useI18n();
  const {space, isTV} = useTheme();
  const [serverName, setServerName] = useState<string>();
  const [error, setError] = useState('');
  const [joined, setJoined] = useState(false);
  useEffect(() => {
    if (!link) return;
    let live = true;
    void (async () => {
      const identity = await inspectDirectServer(link.server, nativeConnectionEnvironment, new AbortController().signal);
      const {api, connection} = await connectPairedServer(link.server, identity, nativeConnectionEnvironment, new AbortController().signal);
      try { return (await api.system()).name; } finally { connection.dispose(); }
    })().then(name => { if (live) setServerName(name); }, () => {});
    return () => { live = false; };
  }, [link]);
  // The server answered with its profiles (more than one, or a PIN): its own chooser, here.
  if (joined && session.direct.pending) return <DirectProfiles onCancel={() => { session.direct.cancelPending(); onDone(); }} />;
  if (!link) {
    return (
      <AuthFrame title={i18n.t('web.join.title')} lead={i18n.t('web.join.unavailable')} onBack={onDone}>
        <Button variant="primary" label={i18n.t('action.close')} hasTVPreferredFocus onPress={onDone} />
      </AuthFrame>
    );
  }
  const account = session.hosted?.account;
  const join = async () => {
    setError('');
    try {
      if (await session.portico.acceptInvitation(link.server, link.code)) {
        releaseJoinLink();
        setJoined(true);
        showToast({message: i18n.t('invitation.joined', {server: serverName ?? i18n.t('invitation.thisServer')}), icon: 'check'});
        if (!session.direct.pending) onDone();
      }
    } catch (e) {
      setError(joinError(e, i18n.t));
    }
  };
  // No Portico Account on this device: the server's own join page, in the browser.
  const inBrowser = () => {
    void Linking.openURL(`${link.server}/join#code=${encodeURIComponent(link.code)}`).catch(() => {});
    releaseJoinLink();
    onDone();
  };
  return (
    <AuthFrame title={i18n.t('web.directJoin.title')} lead={!serverName ? i18n.t('invitation.checking') : account ? i18n.t('invitation.joinWithAccount', {server: serverName}) : i18n.t('web.directJoin.body', {server: serverName})} onBack={() => { releaseJoinLink(); onDone(); }} error={error} onDismissError={() => setError('')} centered={isTV}>
      <View style={{gap: space.sm, alignItems: isTV ? 'center' : 'stretch'}}>
        {account ? (
          <Button variant="primary" size="lg" label={i18n.t('web.directJoin.withAccount', {account: account.displayName || account.username})} loading={session.busy} hasTVPreferredFocus fullWidth={!isTV} onPress={() => void join()} />
        ) : (
          <StateView icon="account" title={i18n.t('invitation.signInTitle')} message={i18n.t('invitation.signInBody')} />
        )}
        {!isTV ? <Button variant="ghost" label={i18n.t('web.directJoin.withPassword')} fullWidth onPress={inBrowser} /> : null}
      </View>
    </AuthFrame>
  );
}

/** The signed-in route (Settings stack): the held link, then back where the person was. */
export function InvitationScreen() {
  const navigation = useNavigation();
  const [link] = useState(() => heldJoinLink());
  return <JoinServer link={link} onDone={() => navigation.goBack()} />;
}
