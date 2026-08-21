export {};
declare const __dirname: string;
declare function require(id: string): {readFileSync(path: string, encoding: string): string; resolve(...paths: string[]): string};
const {readFileSync} = require('node:fs');
const {resolve} = require('node:path');

const nativeSource = readFileSync(
  resolve(
    __dirname,
    '../../../apps/apple-mobile/ios/PorticoIOS/PorticoPlayerViewManager.m',
  ),
  'utf8',
);
const tvInfoPlist = readFileSync(
  resolve(__dirname, '../../../apps/apple-tv/ios/PorticoTVOS/Info.plist'),
  'utf8',
);

describe('Apple remote command Watch With Friends authority', () => {
  it('disables participant commands without mutating AVPlayer', () => {
    expect(nativeSource).toContain(
      '[target.watchWithFriendsControlPolicy isEqualToString:@"participant"]',
    );
    expect(nativeSource).toContain('MPRemoteCommandHandlerStatusCommandFailed');
  });

  it('routes host commands to JavaScript and leaves AVPlayer mutation to server events', () => {
    expect(nativeSource).toContain(
      'target.onRemotePlaybackCommand(@{@"action": @"play"})',
    );
    expect(nativeSource).toContain(
      'target.onRemotePlaybackCommand(@{@"action": @"pause"})',
    );
    expect(nativeSource).toContain(
      'target.onRemotePlaybackCommand(@{@"action": @"seek"',
    );
    expect(nativeSource).toContain(
      'target.onRemotePlaybackCommand(@{@"action": @"toggle"})',
    );
  });

  it('clears the global command target when the player lifecycle deactivates', () => {
    expect(nativeSource).toContain('PorticoActivePlayerView = nil;');
    expect(nativeSource).toContain(
      'commands.playCommand.enabled = controllable;',
    );
  });

  it('keeps tvOS on the same Now Playing and remote-command authority', () => {
    expect(nativeSource).toContain('@"backgroundAudio": @(self.backgroundAudioEligible)');
    expect(nativeSource).toContain('@"remoteCommands": @(activeIntegration)');
    expect(nativeSource).toContain('[self installRemoteCommandsIfNeeded];');
    expect(nativeSource).toContain('return self.musicEligible || self.audiobookEligible;');
    expect(tvInfoPlist).toContain('<key>UIBackgroundModes</key>');
    expect(tvInfoPlist).toContain('<string>audio</string>');
  });

  it('keeps player volume on the same native AVPlayer authority', () => {
    expect(nativeSource).toContain('_player.volume = fmax(0.0, fmin(1.0, volume));');
    expect(nativeSource).toContain('RCT_EXPORT_METHOD(setVolume:');
  });
});
