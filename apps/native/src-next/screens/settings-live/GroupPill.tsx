import React, {useEffect, useRef, useState, useSyncExternalStore} from 'react';
import {Text, View} from 'react-native';
import {defaultI18n} from '../../../../../packages/i18n/src';
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
  const snapshot = useSyncExternalStore(subscribeGroupPort, () => groupPort()?.getSnapshot(), () => undefined);
  const [open, setOpen] = useState(false), pill = useRef<View>(null);
  const group = snapshot?.phase === 'live' ? snapshot.group : undefined;
  useEffect(() => {if (!group) setOpen(false);}, [group]);
  if (!group) return null;
  const joined = group.members.filter(member => member.state === 'joined');
  const permissions = group.permissions, canClaim = !permissions.isHost && permissions.canClaimHost === true;
  const makeHost = (memberId: string) => {const port = groupPort(); if (port) void port.makeHost(memberId).catch(() => {});};
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
