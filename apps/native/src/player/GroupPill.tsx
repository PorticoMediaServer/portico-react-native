import React, {memo, useState} from 'react';
import {View} from 'react-native';
import type {Group, GroupMember} from '../../../../packages/client-core/src/social-playback';
import {useTogether} from '../app/together';
import {useI18n} from '../app/i18n';
import {Button, ListRow, Sheet, Text, useTheme} from '../ui';

type Status = {tone: 'ok' | 'wait' | 'warn'; label: string};
const joined = (group: Group): GroupMember[] => group.members.filter(m => m.state === 'joined');

function describe(group: Group, reconnecting: boolean, t: ReturnType<typeof useI18n>['t']): Status {
  if (reconnecting) return {tone: 'warn', label: t('web.together.pill.reconnecting')};
  if (group.host.presence !== 'connected' && !group.permissions.isHost) return {tone: 'warn', label: t('web.together.pill.hostAway')};
  const waiting = joined(group).find(m => m.id !== group.viewerMemberId && m.readiness === 'buffering');
  if (waiting) return {tone: 'wait', label: t('web.together.pill.waitingFor', {name: waiting.displayName})};
  return {tone: 'ok', label: t('web.together.pill.inStep')};
}

/**
 * FEAT-09: in a Watch Together room the player's top bar shows the group: its name, how many are
 * watching and whether everyone is in step (or who is being waited for, or that the host is
 * reconnecting). It subscribes on its own, so group changes re-render only the pill. Choosing it
 * lists who is here, and says when only the host controls playback. The core layout is unchanged:
 * the pill takes its place in the top bar's trailing buttons.
 */
export const GroupPill = memo(function GroupPill() {
  const {state} = useTogether();
  const i18n = useI18n();
  const {space} = useTheme();
  const [open, setOpen] = useState(false);
  const group = state.group;
  if (!group || (state.phase !== 'live' && state.phase !== 'reconnecting')) return null;
  const members = joined(group);
  const status = describe(group, state.phase === 'reconnecting', i18n.t);
  const role = (m: GroupMember) => (m.role === 'host' ? i18n.t('web.together.pill.host') : m.readiness === 'buffering' ? i18n.t('web.together.pill.catchingUp') : m.presence !== 'connected' ? i18n.t('web.together.pill.away') : undefined);
  return (
    <>
      <Button
        variant={status.tone === 'ok' ? 'ghost' : 'outline'}
        size="sm"
        icon="people"
        label={`${members.length} · ${status.label}`}
        accessibilityLabel={i18n.t('web.together.pill.label', {name: group.name, count: members.length, status: status.label})}
        onPress={() => setOpen(true)}
      />
      <Sheet open={open} onClose={() => setOpen(false)} title={group.name} subtitle={i18n.t('web.together.pill.people', {count: members.length})} placement="side">
        <View style={{gap: space.xs}}>
          {members.map(m => (
            <ListRow key={m.id} icon="profile" title={m.id === group.viewerMemberId ? `${m.displayName} ${i18n.t('web.together.pill.you')}` : m.displayName} meta={role(m)} />
          ))}
          {!group.permissions.canControl ? <Text variant="caption" tone="tertiary" style={{marginTop: space.sm}}>{i18n.t('web.together.pill.hostControls')}</Text> : null}
        </View>
      </Sheet>
    </>
  );
});
