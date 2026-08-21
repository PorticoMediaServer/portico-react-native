export {};
declare const __dirname: string;
declare function require(id: string): {readFileSync(path: string, encoding: string): string; resolve(...paths: string[]): string};
const {readFileSync} = require('node:fs');
const {resolve} = require('node:path');

const detailSource = readFileSync(resolve(__dirname, 'player/PlayerScreen.tsx'), 'utf8');
const mobileNavigationSource = readFileSync(resolve(__dirname, 'mobileNavigation.tsx'), 'utf8');
const mobileMiniPlayerSource = mobileNavigationSource.split('function MobileMiniPlayer')[1]?.split('const navigationTheme')[0] ?? '';
const presenterSource = readFileSync(resolve(__dirname, 'playerPresenters.tsx'), 'utf8');
const utilitySource = readFileSync(resolve(__dirname, 'playerUtilityPresenters.tsx'), 'utf8');
const navigationSource = readFileSync(resolve(__dirname, 'tvNavigation.tsx'), 'utf8');
const profileGuardSource = readFileSync(resolve(__dirname, 'profileSwitchPlaybackGuard.ts'), 'utf8');

describe('player presenter architecture', () => {
  it('defines exactly the five governed center transport semantics', () => {
    for (const id of ['playback.previous', 'playback.seek-back', 'playback.seek-forward', 'playback.next']) {
      expect(presenterSource).toContain(`id="${id}"`);
    }
    expect(presenterSource).toContain("props.isPlaying ? 'playback.pause' : 'playback.play'");
    expect(presenterSource).not.toContain('action.close');
    expect(presenterSource).not.toContain('fullscreen-enter');
  });

  it('keeps forbidden TV chrome out while routing Back and live utilities through the shared player', () => {
    expect(detailSource).toContain("playerSession.handle({type: 'back'})");
    expect(detailSource).toContain('chromeVisible ? <PlayerUtilityDock');
    expect(detailSource).toContain('tvFocusId={television ? TV_PLAYER_FOCUS_ENTRY.timeline : undefined}');
    expect(detailSource).toContain('focusContainer={television ? tvPlayerFocusContainers[1] : undefined}');
    expect(detailSource).toContain('focusContainer={television ? tvPlayerFocusContainers[2] : undefined}');
    expect(detailSource).toContain('focusContainer={television ? tvPlayerFocusContainers[3] : undefined}');
    expect(detailSource).toContain('useTVLogicalFocus()');
    expect(navigationSource).toContain('containers={playerFocusContainers}');
    for (const id of ['volume', 'subtitles', 'quality', 'speed', 'sleep', 'queue']) {
      expect(utilitySource).toContain(`id: '${id}' as const`);
    }
    expect(utilitySource).toContain('tvFocusId={`player:utility:${action.id}`}');
    expect(utilitySource).not.toContain('hasTVPreferredFocus');
    expect(detailSource).not.toContain('closePlayer');
  });

  it('pauses video on application background and defaults mobile audio to collapsed', () => {
    expect(detailSource).toContain("playerSession.handle({type: 'app-background'})");
    expect(detailSource).toContain("mode === 'music' || mode === 'audiobook'");
    expect(detailSource).toContain('collapsePlayer();');
    expect(detailSource).toContain('audioOnly && !television ? <MobileAudioPresenter');
  });

  it('cuts the visible collapsed mobile player into the five-control audio presenter', () => {
    expect(mobileNavigationSource).toContain('<MobileAudioPresenter');
    expect(mobileNavigationSource).toContain('onPrevious={() => session.previous()}');
    expect(mobileNavigationSource).toContain('onSeekBack={() => session.seekBy(-preferences.seekIntervalSeconds)}');
    expect(mobileNavigationSource).toContain('onPlayPause={() => snapshot.isPlaying ? session.pause() : session.play()}');
    expect(mobileNavigationSource).toContain('onSeekForward={() => session.seekBy(preferences.seekIntervalSeconds)}');
    expect(mobileNavigationSource).toContain('onNext={() => session.next()}');
    expect(mobileNavigationSource).toContain('onExpand={restoreMinimizedPlayer}');
    expect(mobileMiniPlayerSource).not.toContain('closeMinimizedPlayer');
    expect(mobileMiniPlayerSource).not.toContain('action.close-player');
  });

  it('uses true item history for previous instead of seek-to-start', () => {
    expect(detailSource).toContain('const playPrevious = () =>');
    expect(detailSource).toContain('onPrevious={() => void playPrevious()}');
    expect(detailSource).not.toContain('onPrevious={() => seekTo(0)}');
  });

  it('provides a bounded, reduced-motion-aware TV Now Playing focus container', () => {
    expect(presenterSource).toContain('export function NowPlayingFocusContainer');
    expect(presenterSource).toContain("snapshot.presentation !== 'background'");
    expect(presenterSource).toContain("overflow: 'hidden'");
    expect(presenterSource).toContain('isReduceMotionEnabled');
    expect(presenterSource).toContain('<ContainedMarqueeText text={snapshot.subtitle} variant="subtitle" />');
  });

  it('stops background audio only inside the confirmed profile-switch path', () => {
    expect(profileGuardSource.indexOf('session.confirmProfileSwitch();')).toBeGreaterThan(
      profileGuardSource.indexOf('if (!pending) return;'),
    );
    expect(profileGuardSource.indexOf('action();')).toBeGreaterThan(
      profileGuardSource.indexOf('session.confirmProfileSwitch();'),
    );
  });
});
