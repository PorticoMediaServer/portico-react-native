import React, {useCallback, useEffect, useRef, useState, useSyncExternalStore} from 'react';
import {Text, View} from 'react-native';
import {defaultI18n} from '../../../../../packages/i18n/src';
import type {GroupSessionSnapshot} from '../../../../../packages/client-core/src/group-session';
import {Button, Focusable} from '../kit/controls';
import {SidePanel} from '../kit/overlays';
import {useTheme} from '../kit/theme';
import {browseType} from '../kit/browse/presentation';
import {groupPort, subscribeGroupPort} from './group-port';

/** tv-more18: the player's top-row group pill. It draws only what the live owner reports —
 * the group's own name, its joined members and the service's permissions — and its people
 * sheet sends host actions through that owner's existing command. No membership copy. */
export function NativeTVGroupPill() {
  const theme = useTheme(), t = defaultI18n.t;
  // The registration slot changes when an owner appears, retires or is replaced…
  const owner = useSyncExternalStore(subscribeGroupPort, groupPort, () => undefined);
  // …and the registered owner's own stream carries every membership, permission and state
  // change, so this surface retires or redraws with the session rather than on a later render.
  const subscribeOwner = useCallback((listener: () => void) => owner ? owner.subscribe(listener) : () => {}, [owner]);
  const readOwner = useCallback((): GroupSessionSnapshot | undefined => owner && owner.current() ? owner.getSnapshot() : undefined, [owner]);
  const snapshot = useSyncExternalStore(subscribeOwner, readOwner, () => undefined);
  const [open, setOpen] = useState(false), pill = useRef<View>(null);
  const group = snapshot?.phase === 'live' ? snapshot.group : undefined;
  // Everything a rendered sheet is allowed to act on: its owner, the exact group it drew and
  // the viewer it drew. A replacement owner or another group can never inherit this sheet.
  const rendered = group && owner ? Object.freeze({owner, groupId: group.id, viewer: group.viewerMemberId}) : undefined;
  const live = !!rendered;
  useEffect(() => {if (!live) setOpen(false);}, [live]);
  useEffect(() => () => setOpen(false), []);
  if (!group || !owner || !rendered) return null;
  const joined = group.members.filter(member => member.state === 'joined');
  const permissions = group.permissions, canClaim = !permissions.isHost && permissions.canClaimHost === true;
  /** Whole eligibility is re-read from this owner's current group at dispatch and completion. */
  const eligible = (state: GroupSessionSnapshot | undefined, memberId: string): boolean => {
    const live = state?.phase === 'live' ? state.group : undefined;
    if (!live || live.id !== rendered.groupId) return false;
    const member = live.members.find(value => value.id === memberId);
    if (!member || member.state !== 'joined') return false;
    return memberId === live.viewerMemberId
      ? !live.permissions.isHost && live.permissions.canClaimHost === true
      : live.permissions.isHost && member.role !== 'host' && memberId !== live.viewerMemberId;
  };
  const makeHost = (memberId: string) => {
    const port = rendered.owner;
    const stillOurs = () => groupPort() === port && port.current() && eligible(port.getSnapshot(), memberId);
    if (!stillOurs()) {setOpen(false); return;}
    void port.makeHost(memberId).then(() => {
      // A completion after the owner/group/permission moved on closes this exact sheet.
      if (groupPort() !== port || !port.current() || !eligible(port.getSnapshot(), memberId)) setOpen(false);
    }, () => {});
  };
  return <>
    <Focusable ref={pill} testID="player-group-pill" focusId="player-group-pill" accessibilityRole="button"
      accessibilityLabel={group.name} onPress={() => setOpen(true)} focusRadius={10}
      style={{marginLeft: 'auto', flexDirection: 'row', alignItems: 'center', gap: 12, paddingHorizontal: 16, paddingVertical: 8,
        borderRadius: 14, backgroundColor: 'rgba(237,245,250,.12)'}}>
      <Text style={[browseType(theme, 18, 700), {color: theme.colors.text}]}>{group.name}</Text>
      <Text style={[browseType(theme, 16, 600), {color: theme.colors.textSecondary}]}>{t('web.together.here', {count: joined.length})}</Text>
    </Focusable>
    <SidePanel open={open} onOpenChange={next => {if (!next) setOpen(false);}} title={group.name}
      testID="player-group-sheet" width={620} topInset={0} returnFocusRef={pill}
      style={{paddingTop: 46, paddingLeft: 56, paddingRight: 96}}>
      <View style={{gap: 18}}>
        {joined.map(member => <View key={member.id} style={{flexDirection: 'row', alignItems: 'center', gap: 14}}>
          <Text style={[browseType(theme, 22, 700), {color: theme.colors.text, flex: 1}]}>{member.displayName}</Text>
          {member.role === 'host' ? <Text style={[browseType(theme, 18, 700), {color: theme.colors.accentStrong}]}>{t('web.together.youHost')}</Text>
            : member.presence !== 'connected' ? <Text style={[browseType(theme, 18, 600), {color: theme.colors.textTertiary}]}>{t('web.together.away')}</Text> : null}
          {permissions.isHost && member.role !== 'host' && <Button variant="glass" size="small" focusId={`group-host-${member.id}`}
            onPress={() => makeHost(member.id)}>{t('web.together.makeHost')}</Button>}
        </View>)}
        {canClaim && <Button variant="primary" focusId="group-claim-host" hasTVPreferredFocus onPress={() => makeHost(group.viewerMemberId)}>
          {t('web.together.becomeHost')}</Button>}
      </View>
    </SidePanel>
  </>;
}
