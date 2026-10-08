import React, {useState} from 'react';
import {Share, View} from 'react-native';
import {say} from '../app/errors';
import {useI18n} from '../app/i18n';
import {useSession} from '../app/session';
import {inviteLink} from '../app/invite-link';
import {Button, Field, Notice, Sheet, Text, useTheme} from '../ui';

/**
 * Invite someone to this server (Spec — Hosted at Scale): the server makes a one-time code and the
 * link carries it with the server's address. They join with their Portico Account, or with a
 * username and password on the server's own join page. Portico sends no email; the owner shares.
 */
export function InviteSheet({open, onClose}: {open: boolean; onClose: () => void}) {
  const session = useSession();
  const i18n = useI18n();
  const {space} = useTheme();
  const [label, setLabel] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [issued, setIssued] = useState<{code: string; link: string}>();
  const close = () => { setIssued(undefined); setLabel(''); setError(''); onClose(); };
  const create = async () => {
    setBusy(true);
    setError('');
    try {
      const out = await session.api.request<{code?: unknown}>('/v1/admin/access/invitations', 'POST', {operationId: `inv_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 12)}`, email: label.trim(), role: 'member', allowedLibraries: [], expiresInHours: 168});
      const code = typeof out?.code === 'string' ? out.code : '';
      if (!code) throw new Error('The invitation came back without a code.');
      setIssued({code, link: inviteLink(session.hostedUrl, session.api.baseUrl, code)});
    } catch (e) {
      setError(say(e, 'server-console', 'save'));
    } finally {
      setBusy(false);
    }
  };
  const share = () => { if (issued) void Share.share({message: i18n.t('invite.shareMessage', {server: session.system?.name ?? i18n.t('invitation.thisServer'), link: issued.link, code: issued.code})}).catch(() => {}); };
  return (
    <Sheet open={open} onClose={close} kind="form" title={issued ? i18n.t('invite.readyTitle') : i18n.t('invite.title')} subtitle={issued ? i18n.t('invite.readyBody') : i18n.t('invite.body')}
      primary={issued ? {label: i18n.t('invite.share'), onPress: share} : {label: i18n.t('invite.create'), loading: busy, disabled: busy, onPress: () => void create()}}>
      <View style={{gap: space.md}}>
        {error ? <Notice tone="danger" message={error} /> : null}
        {issued ? (
          <>
            <Field label={i18n.t('invite.link')} value={issued.link} editable={false} selectTextOnFocus />
            <Field label={i18n.t('web.directJoin.code')} value={issued.code} editable={false} selectTextOnFocus />
            <Text variant="caption" tone="tertiary">{i18n.t('invite.expires')}</Text>
            <Button variant="ghost" label={i18n.t('action.done')} onPress={close} />
          </>
        ) : (
          <Field label={i18n.t('invite.label')} hint={i18n.t('invite.labelHelp')} value={label} onChangeText={setLabel} autoCapitalize="none" autoCorrect={false} />
        )}
      </View>
    </Sheet>
  );
}
