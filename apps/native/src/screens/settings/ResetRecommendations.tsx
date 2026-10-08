import React, {useRef, useState} from 'react';
import {resetRecommendations} from '../../../../../packages/client-core/src/recommendation-feedback';
import {continueScope} from '../../app/continue-watching';
import {requestId} from '../../app/detail';
import {useI18n} from '../../app/i18n';
import {forgetNotInterested} from '../../app/not-interested';
import {useSession} from '../../app/session';
import {ConfirmSheet, ListRow, showToast} from '../../ui';

/**
 * Settings › Privacy: "Reset recommendations" (Recommendations P5), behind a confirmation that
 * says what stays. The server forgets the profile's learned taste and every Not interested mark;
 * the titles this device was still hiding may be offered again. One operation ID per
 * confirmation, so a retry after a lost answer can't reset twice.
 */
export function ResetRecommendationsRow() {
  const i18n = useI18n();
  const {api, session} = useSession();
  const [open, setOpen] = useState(false);
  const operation = useRef<string | undefined>(undefined);
  const ask = async () => { operation.current = await requestId(); setOpen(true); };
  const confirm = async () => {
    const viewer = session?.viewer;
    await resetRecommendations(api, {serverId: viewer?.serverId ?? api.baseUrl, operationId: operation.current ?? await requestId()});
    forgetNotInterested(continueScope(viewer?.serverId ?? api.baseUrl, viewer?.accountId, viewer?.profileId));
    showToast({message: i18n.t('settings.resetRecommendations.done'), icon: 'check'});
  };
  return (
    <>
      <ListRow title={i18n.t('settings.resetRecommendations')} subtitle={i18n.t('settings.resetRecommendations.help')} onPress={() => void ask()} />
      <ConfirmSheet open={open} onDismiss={() => setOpen(false)} title={i18n.t('settings.resetRecommendations.confirmTitle')} consequence={i18n.t('settings.resetRecommendations.confirmBody')} confirmLabel={i18n.t('settings.resetRecommendations.confirm')} onConfirm={confirm} describeError={() => i18n.t('settings.resetRecommendations.failed')} />
    </>
  );
}
