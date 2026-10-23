import React from 'react';
import type {View} from 'react-native';
import {Menu, type MenuEntry} from '../kit/overlays';
import type {NativeShellSnapshot} from './runtime';
import {tvFocusIds} from './tv-focus';

/** Uses the genuine account actions; the TV sheet has one continuous native list. */
export function TVProfileMenu({snapshot, open, onOpenChange, returnFocusRef}: {
  snapshot: NativeShellSnapshot; open: boolean; onOpenChange: (open: boolean) => void; returnFocusRef: React.RefObject<View | null>;
}) {
  const account = snapshot.account;
  const items: MenuEntry[] = account.actions.map(action => ({id: action.id, label: action.label, icon: action.icon,
    destructive: action.destructive, onSelect: action.onPress}));
  if (account.serverAction && account.viewerRole !== 'member') {
    const action = account.serverAction;
    items.push({id: action.id, label: action.label, icon: action.icon, tone: 'owner', onSelect: action.onPress});
  }
  return <Menu testID={tvFocusIds(snapshot.authority).profileMenu} open={open} onOpenChange={onOpenChange}
    title={snapshot.profile.name} presentation="sideSheet" items={items} returnFocusRef={returnFocusRef}/>;
}
