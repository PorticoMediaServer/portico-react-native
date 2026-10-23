import {defaultI18n} from '../../../../packages/i18n/src';
import type {DirectSnapshot} from '../../../../packages/client-core/src/profile-management';
import type {NativeShellSnapshot} from './runtime';
import type {NativeShellRoute} from './routes';

/** All actions address the verified current account. No name, profile or role is fabricated. */
export function nativeAccountMenu(account: DirectSnapshot, open: (route: NativeShellRoute) => void, tv = false): NativeShellSnapshot['account'] {
  const t = defaultI18n.t;
  const viewerRole = !account.capabilities?.managePeople ? 'member' : account.account.role === 'admin' ? 'administrator' : account.account.role;
  return Object.freeze({accountLine: account.account.username, viewerRole,
    actions: Object.freeze([
      ...(!tv || account.profiles.length > 1 ? [{id: 'profiles', label: t('settings.switchProfile'), icon: 'i-switch' as const, onPress: () => open({kind: 'profiles'})}] : []),
      {id: 'servers', label: t('settings.switchServer'), icon: 'i-server' as const, onPress: () => open({kind: 'servers'})},
      {id: 'notifications', label: t('notifications.title'), icon: 'i-bell' as const, onPress: () => open({kind: 'notifications'})},
      {id: 'together', label: t('entry.group.together'), icon: 'i-people' as const, onPress: () => open({kind: 'together'})},
      ...(!tv ? [{id: 'settings', label: t('settings.title'), icon: 'i-settings' as const, onPress: () => open({kind: 'shell', destination: {kind: 'settings'}})}] : []),
    ]),
    ...(viewerRole === 'owner' || viewerRole === 'administrator' ? {serverAction: {id: 'server', label: t(tv ? 'next.shell.serverSettings' : 'settings.server.dashboard'), icon: 'i-server' as const, onPress: () => open({kind: 'server-dashboard'})}} : {}),
  });
}
