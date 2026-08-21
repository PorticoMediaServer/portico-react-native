import type {WatchWithFriendsGroup} from '@porticomediaserver/client-core';
import {watchWithFriendsPlaybackAuthority} from './watchWithFriendsPlaybackAuthority';

const group = (canControl: boolean) =>
  ({permissions: {canControl}}) as WatchWithFriendsGroup;

describe('Watch With Friends playback authority', () => {
  it('keeps ordinary playback independent outside a group', () => {
    expect(
      watchWithFriendsPlaybackAuthority({
        groupRequested: false,
        status: 'unavailable',
      }),
    ).toEqual({
      controlsEnabled: true,
      groupConnected: false,
      remoteControlPolicy: 'independent',
      shouldStartPlayback: true,
    });
  });

  it.each(['reconnecting', 'unavailable'] as const)(
    'fails closed while group authority is %s',
    status => {
      expect(
        watchWithFriendsPlaybackAuthority({
          group: group(true),
          groupRequested: true,
          status,
        }),
      ).toEqual({
        controlsEnabled: false,
        groupConnected: false,
        remoteControlPolicy: 'participant',
        shouldStartPlayback: false,
      });
    },
  );

  it('allows a host to publish controls without granting participants local control', () => {
    expect(
      watchWithFriendsPlaybackAuthority({
        group: group(true),
        groupRequested: true,
        status: 'connected',
      }),
    ).toMatchObject({controlsEnabled: true, remoteControlPolicy: 'host'});
    expect(
      watchWithFriendsPlaybackAuthority({
        group: group(false),
        groupRequested: true,
        status: 'connected',
      }),
    ).toMatchObject({
      controlsEnabled: false,
      remoteControlPolicy: 'participant',
    });
  });
});
