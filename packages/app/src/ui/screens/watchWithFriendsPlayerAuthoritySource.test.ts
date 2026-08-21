export {};
declare const __dirname: string;
declare function require(id: string): {readFileSync(path: string, encoding: string): string; resolve(...paths: string[]): string};
const {readFileSync} = require('node:fs');
const {resolve} = require('node:path');

const playerSource = readFileSync(
  resolve(__dirname, '../player/PlayerScreen.tsx'),
  'utf8',
);

describe('Watch With Friends player authority wiring', () => {
  it('fails closed before starting or retaining local playback', () => {
    expect(playerSource).toContain('if (!watchAuthority.shouldStartPlayback)');
    expect(playerSource).toContain("setWatchGroupStatus('reconnecting')");
    expect(playerSource).toContain("setWatchGroupStatus('unavailable')");
    expect(playerSource).toContain('playerRef.current?.pause();');
    expect(playerSource).toContain('void shutdownPlayback().catch');
  });

  it('publishes group transport and next commands instead of invoking local controls', () => {
    expect(playerSource).toContain("publishWatchGroupState('play'");
    expect(playerSource).toContain("publishWatchGroupState('pause'");
    expect(playerSource).toContain("publishWatchGroupState('seek'");
    expect(playerSource).toContain("publishWatchGroupState('next'");
    expect(playerSource).toContain('queueSelectionAllowed={index =>');
    expect(playerSource).toContain('watchGroup.permissions.canManageQueue');
    expect(playerSource).toContain('playWatchGroupQueueItem(index)');
  });

  it('passes the group policy through to native Apple remote commands', () => {
    expect(playerSource).toContain(
      'watchWithFriendsControlPolicy={\n            watchAuthority.remoteControlPolicy',
    );
    expect(playerSource).toContain("if (watchAuthority.remoteControlPolicy !== 'host') return;");
  });
});
