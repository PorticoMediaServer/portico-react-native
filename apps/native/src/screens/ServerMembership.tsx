import React, {useEffect, useState} from 'react';
import type {DirectSnapshot} from '../../../../packages/client-core/src/profile-management';
import {membershipActions, transferTargets, type TransferTarget} from '../app/portico-membership';
import {useI18n} from '../app/i18n';
import {useSession} from '../app/session';
import {say} from '../app/errors';
import {ConfirmSheet, ListRow, RowGroup, Sheet, StateView, showToast} from '../ui';

/**
 * A Portico Account's own membership of this server (Spec — Hosted at Scale): a member can leave
 * it; the owner, who can't leave, can hand it to an active member. Shown on the account page.
 */
export function ServerMembershipSection({snapshot, onChanged}: {snapshot: DirectSnapshot; onChanged: () => void}) {
  const session = useSession();
  const i18n = useI18n();
  const actions = membershipActions(snapshot.account);
  const server = session.system?.name ?? i18n.t('invitation.thisServer');
  const [sheet, setSheet] = useState<'leave' | 'choose' | TransferTarget>();
  if (!actions.leave && !actions.transfer) return null;
  return (
    <>
      <RowGroup title={i18n.t('membership.title')} footer={actions.transfer ? i18n.t('membership.ownerHelp') : undefined}>
        {actions.leave ? <ListRow icon="signOut" tone="destructive" title={i18n.t('membership.leave', {server})} onPress={() => setSheet('leave')} /> : null}
        {actions.transfer ? <ListRow icon="people" title={i18n.t('membership.transfer')} accessory="navigation" onPress={() => setSheet('choose')} /> : null}
      </RowGroup>
      <ConfirmSheet
        open={sheet === 'leave'}
        onDismiss={() => setSheet(undefined)}
        title={i18n.t('membership.leaveConfirm', {server})}
        consequence={i18n.t('membership.leaveBody', {server})}
        confirmLabel={i18n.t('membership.leaveAction')}
        describeError={e => say(e, 'account', 'action')}
        onConfirm={async () => {
          await session.portico.leave();
          showToast({message: i18n.t('membership.left', {server}), icon: 'check'});
        }}
      />
      <TransferChooser open={sheet === 'choose'} selfId={snapshot.account.id} onClose={() => setSheet(undefined)} onChoose={target => setSheet(target)} />
      <ConfirmSheet
        open={typeof sheet === 'object'}
        onDismiss={() => setSheet(undefined)}
        title={i18n.t('membership.transferConfirm', {name: typeof sheet === 'object' ? sheet.username : '', server})}
        consequence={i18n.t('membership.transferBody', {name: typeof sheet === 'object' ? sheet.username : ''})}
        confirmLabel={i18n.t('membership.transferAction')}
        describeError={e => say(e, 'account', 'action')}
        onConfirm={async () => {
          if (typeof sheet !== 'object') return;
          await session.portico.transferOwnership(sheet.id, snapshot.account.revision);
          showToast({message: i18n.t('membership.transferred', {name: sheet.username}), icon: 'check'});
          onChanged();
        }}
      />
    </>
  );
}

/** The active members ownership can go to, read when the sheet opens. */
function TransferChooser({open, selfId, onClose, onChoose}: {open: boolean; selfId: string; onClose: () => void; onChoose: (target: TransferTarget) => void}) {
  const session = useSession();
  const i18n = useI18n();
  const [targets, setTargets] = useState<readonly TransferTarget[]>();
  const [error, setError] = useState('');
  useEffect(() => {
    if (!open || !session.api) return;
    let live = true;
    setTargets(undefined);
    setError('');
    session.api.request<unknown>('/v1/direct/members').then(raw => { if (live) setTargets(transferTargets(raw, selfId)); }, e => { if (live) setError(say(e, 'account', 'load')); });
    return () => { live = false; };
  }, [open, session.api, selfId]);
  return (
    <Sheet open={open} onClose={onClose} title={i18n.t('membership.transferTitle')} subtitle={i18n.t('membership.transferPick')}>
      {error ? <StateView icon="warning" title={error} />
        : !targets ? <StateView loading title={i18n.t('membership.loadingMembers')} />
        : !targets.length ? <StateView icon="people" title={i18n.t('membership.noMembers')} message={i18n.t('membership.noMembersBody')} />
        : targets.map(t => <ListRow key={t.id} icon="account" title={t.username} accessory="navigation" onPress={() => onChoose(t)} />)}
    </Sheet>
  );
}
