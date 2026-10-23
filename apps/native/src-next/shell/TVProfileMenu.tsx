import React from 'react';
import {Text, View} from 'react-native';
import {defaultI18n} from '../../../../packages/i18n/src';
import {ProfileFace} from '../kit/artwork';
import {Menu, type MenuEntry} from '../kit/overlays';
import {nativeType, useTheme} from '../kit/theme';
import type {NativeShellSnapshot} from './runtime';
import {tvFocusIds} from './tv-focus';

/** The real Rail opener is measured by Menu. The caller never supplies a guessed
 * rectangle; profile/server facts and every action retain their current owner. */
export function TVProfileMenu({snapshot, open, onOpenChange, returnFocusRef}: {
  snapshot: NativeShellSnapshot; open: boolean; onOpenChange: (open: boolean) => void; returnFocusRef: React.RefObject<View | null>;
}) {
  const account = snapshot.account, theme = useTheme();
  const unread = snapshot.unreadNotificationCount;
  const items: MenuEntry[] = account.actions.map(action => ({id: action.id, label: action.label, icon: action.icon,
    trailing: action.id === 'notifications' && typeof unread === 'number' && Number.isSafeInteger(unread) && unread > 0
      ? <Text style={[nativeType({size: 20, weight: 400, tracking: 0, lineHeight: 'normal'}, theme.textScale), {color: theme.colors.textTertiary}]}>{defaultI18n.t('settings.unreadCount', {count: unread})}</Text> : action.trailing,
    destructive: action.destructive, onSelect: action.onPress}));
  if (account.serverAction && account.viewerRole !== 'member') {
    const action = account.serverAction;
    items.push({id: 'server-separator', separator: true}, {id: action.id, label: action.label, icon: action.icon, tone: 'owner',
      trailing: <Text style={[nativeType({size: 20, weight: 700, tracking: 0, lineHeight: 'normal'}, theme.textScale),
        {color: theme.colors.textSecondary, backgroundColor: '#07101899', paddingVertical: 3, paddingHorizontal: 12, borderRadius: 8}]}>{defaultI18n.t('next.shell.viewOnly')}</Text>, onSelect: action.onPress});
  }
  const context = <View style={{flexDirection: 'row', alignItems: 'center', gap: 18, paddingTop: 14, paddingHorizontal: 18, paddingBottom: 18}}>
    <ProfileFace {...snapshot.profile} size={56} scaleOnFocus={false}/>
    <View style={{flex: 1}}><Text style={[nativeType({size: 28, weight: 800, tracking: 0, lineHeight: 'normal'}, theme.textScale), {color: theme.colors.text}]}>{snapshot.profile.name}</Text>
      {snapshot.serverName && <Text style={[nativeType({size: 20, weight: 400, tracking: 0, lineHeight: 'normal'}, theme.textScale), {color: theme.colors.textTertiary, marginTop: 2}]}>{snapshot.serverName}</Text>}
    </View>
  </View>;
  return <Menu testID={tvFocusIds(snapshot.authority).profileMenu} open={open} onOpenChange={onOpenChange}
    title={snapshot.profile.name} context={context} anchorRef={returnFocusRef} placement="right-end" offset={168} alignOffset={-8} width={640}
    presentation="anchored" items={items} returnFocusRef={returnFocusRef}/>;
}
