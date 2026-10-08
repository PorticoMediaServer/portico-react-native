import React, {useEffect, useState} from 'react';
import {AppState, View} from 'react-native';
import {useSafeAreaInsets} from 'react-native-safe-area-context';
import {parseDirectSnapshot} from '../../../../packages/client-core/src/profile-management';
import {asksForCustody} from '../app/portico-membership';
import {useI18n} from '../app/i18n';
import {useSession} from '../app/session';
import {say} from '../app/errors';
import {Notice, showToast, useTheme} from '../ui';

/**
 * INT M6: ownership of this server moved to this viewer's Portico Account, but Portico doesn't
 * hold the server's registration for it yet (`custodyPending`). The shell asks, above the content;
 * it is the owner's consent, so nothing happens without the tap. The API has no decline: the
 * prompt stays until it is accepted (the registration stays where it was until then).
 */
export function CustodyPrompt() {
  const session = useSession();
  const i18n = useI18n();
  const {space, isTV} = useTheme();
  const insets = useSafeAreaInsets();
  const viewer = session.session?.viewer;
  const [pending, setPending] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [check, setCheck] = useState(0);
  const owner = viewer?.authority === 'local' && viewer.role === 'owner';
  // The account snapshot says whether custody is pending; read for an owner, and again on return.
  useEffect(() => {
    if (!owner || !session.api) return;
    let live = true;
    session.api.request<unknown>('/v1/direct').then(raw => { if (live) setPending(parseDirectSnapshot(raw).custodyPending === true); }, () => {});
    return () => { live = false; };
  }, [owner, session.api, check]);
  useEffect(() => {
    const sub = AppState.addEventListener('change', s => { if (s === 'active') setCheck(n => n + 1); });
    return () => sub.remove();
  }, []);
  if (!asksForCustody({role: viewer?.role, authority: viewer?.authority, custodyPending: pending, porticoSignedIn: !!session.hosted})) return null;
  const server = session.system?.name ?? i18n.t('invitation.thisServer');
  const accept = () => {
    setBusy(true);
    setError('');
    session.portico.acceptCustody().then(
      () => { setPending(false); showToast({message: i18n.t('custody.done', {server}), icon: 'check'}); },
      e => setError(say(e, 'account', 'action')),
    ).finally(() => setBusy(false));
  };
  return (
    <View style={{...(isTV ? {alignSelf: 'flex-start', maxWidth: 1080} : null), marginHorizontal: space.page, marginTop: (isTV ? 0 : insets.top) + space.sm, marginBottom: space.xs}}>
      <Notice tone={error ? 'danger' : 'info'} title={i18n.t('custody.title')} message={error || i18n.t('custody.body', {server})} action={busy ? undefined : i18n.t('custody.accept')} onAction={accept} />
    </View>
  );
}
