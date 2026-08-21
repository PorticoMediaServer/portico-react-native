import type {WatchWithFriendsGroup} from '@portico/client-core';
import type {AppleWatchWithFriendsControlPolicy} from '@portico-react-native/player';

export type WatchWithFriendsConnectionStatus =
  | 'connected'
  | 'reconnecting'
  | 'unavailable';

export interface WatchWithFriendsPlaybackAuthority {
  controlsEnabled: boolean;
  groupConnected: boolean;
  remoteControlPolicy: AppleWatchWithFriendsControlPolicy;
  shouldStartPlayback: boolean;
}

export function watchWithFriendsPlaybackAuthority(input: {
  group?: WatchWithFriendsGroup;
  groupRequested: boolean;
  status: WatchWithFriendsConnectionStatus;
}): WatchWithFriendsPlaybackAuthority {
  if (!input.groupRequested) {
    return {
      controlsEnabled: true,
      groupConnected: false,
      remoteControlPolicy: 'independent',
      shouldStartPlayback: true,
    };
  }
  const connected = input.status === 'connected' && Boolean(input.group);
  const host = connected && Boolean(input.group?.permissions.canControl);
  return {
    controlsEnabled: host,
    groupConnected: connected,
    remoteControlPolicy: host ? 'host' : 'participant',
    shouldStartPlayback: connected,
  };
}
