import React, {useState} from 'react';
import {Share, View} from 'react-native';
import {say} from '../app/errors';
import {useI18n} from '../app/i18n';
import {useSession} from '../app/session';
import {inviteLink} from '../app/invite-link';
import {operationId} from '../app/server-console';
import {parseInvitation, type AccessTier} from '../../../../packages/client-core/src/server-administration';
import {roleLabel} from '../../../../packages/client-core/src/server-admin/people-words';
import {Button, Field, Notice, Segmented, Sheet, Text, useTheme} from '../ui';

/**
 * Invite someone to this server (Spec — Hosted at Scale): the server makes a one-time code and the
 * link carries it with the server's address. They join with their Portico Account, or with a
 * username and password on the server's own join page. Portico sends no email; the owner shares.
 * The address only labels the invitation; naming a Portico Account username means only that
 * account can use it. The owner may invite an administrator; an administrator invites members.
 */
export function InviteSheet({open, onClose}: {open: boolean; onClose: () => void}) {
  const session = useSession();
  const i18n = useI18n();
  const {space} = useTheme();
  const [email, setEmail] = useState('');
  const [porticoUsername, setPorticoUsername] = useState('');
  const [role, setRole] = useState<AccessTier>('member');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [issued, setIssued] = useState<{code: string; link: string; porticoUsername?: string}>();
  // One operation for one invitation: a retry after a failure that did reach the server reuses it.
  const [operation, setOperation] = useState<{payload: string; id: string}>();
  const owner = session.session?.viewer.role === 'owner';
  const badEmail = !!email.trim() && !/^\S+@\S+\.\S+$/.test(email.trim());
  const close = () => { setIssued(undefined); setEmail(''); setPorticoUsername(''); setRole('member'); setError(''); setOperation(undefined); onClose(); };
  const create = async () => {
    setBusy(true);
    setError('');
    try {
      const payload = {email: email.trim(), role: owner ? role : 'member', allowedLibraries: [], expiresInHours: 168, ...(porticoUsername.trim() ? {porticoUsername: porticoUsername.trim()} : {})};
      const key = JSON.stringify(payload);
      const id = operation?.payload === key ? operation.id : operationId();
      setOperation({payload: key, id});
      const out = parseInvitation(await session.api.request<unknown>('/v1/admin/access/invitations', 'POST', {operationId: id, ...payload}));
      const code = out.code ?? '';
      if (!code) throw new Error('The invitation came back without a code.');
      setOperation(undefined);
      setIssued({code, link: inviteLink(session.hostedUrl, session.api.baseUrl, code), ...(out.porticoUsername ? {porticoUsername: out.porticoUsername} : {})});
    } catch (e) {
      setError(say(e, 'server-console', 'save'));
    } finally {
      setBusy(false);
    }
  };
  const share = () => { if (issued) void Share.share({message: i18n.t('invite.shareMessage', {server: session.system?.name ?? i18n.t('invitation.thisServer'), link: issued.link, code: issued.code})}).catch(() => {}); };
  return (
    <Sheet open={open} onClose={close} kind="form" title={issued ? i18n.t('invite.readyTitle') : i18n.t('invite.title')} subtitle={issued ? i18n.t('invite.readyBody') : i18n.t('invite.body')}
      primary={issued ? {label: i18n.t('invite.share'), onPress: share} : {label: i18n.t('invite.create'), loading: busy, disabled: busy || badEmail, onPress: () => void create()}}>
      <View style={{gap: space.md}}>
        {error ? <Notice tone="danger" message={error} /> : null}
        {issued ? (
          <>
            <Field label={i18n.t('invite.link')} value={issued.link} editable={false} selectTextOnFocus />
            <Field label={i18n.t('web.directJoin.code')} value={issued.code} editable={false} selectTextOnFocus />
            {issued.porticoUsername ? <Text variant="caption" tone="tertiary">{i18n.t('server.people.inviteOnlyFor', {username: issued.porticoUsername})}</Text> : null}
            <Text variant="caption" tone="tertiary">{i18n.t('invite.expires')}</Text>
            <Button variant="ghost" label={i18n.t('action.done')} onPress={close} />
          </>
        ) : (
          <>
            <Field label={i18n.t('web.hostedSecurity.email')} hint={i18n.t('web.access.emailHelp')} value={email} onChangeText={setEmail} keyboardType="email-address" autoCapitalize="none" autoCorrect={false} error={badEmail ? i18n.t('invite.emailInvalid') : undefined} />
            <Field label={i18n.t('server.people.inviteRecipient')} hint={i18n.t('server.people.inviteRecipientHelp')} value={porticoUsername} onChangeText={setPorticoUsername} maxLength={64} autoCapitalize="none" autoCorrect={false} />
            {owner ? <Segmented accessibilityLabel={i18n.t('web.access.roleLabel')} selected={role} onSelect={id => setRole(id as AccessTier)} items={(['member', 'admin'] as const).map(id => ({id, label: roleLabel(i18n.t, id)}))} /> : null}
          </>
        )}
      </View>
    </Sheet>
  );
}
