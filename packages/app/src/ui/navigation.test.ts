import React from 'react';
import TestRenderer, {act} from 'react-test-renderer';
import {
  PorticoNavigationActionProvider,
  playerRouteForMedia,
  shouldRetainPlayerOnBack,
  type PorticoRoute,
  usePorticoNavigationActions,
} from './navigation';

describe('persistent mobile playback navigation', () => {
  const player: PorticoRoute = {name: 'player', mediaId: 'media-1'};

  it('retains the active player only when leaving an iOS phone player', () => {
    expect(shouldRetainPlayerOnBack(player, {os: 'ios', isTV: false})).toBe(true);
    expect(shouldRetainPlayerOnBack(player, {os: 'ios', isTV: true})).toBe(false);
    expect(shouldRetainPlayerOnBack(player, {os: 'android', isTV: false})).toBe(true);
  });

  it('does not create a mini-player for non-player routes', () => {
    expect(shouldRetainPlayerOnBack({name: 'detail', mediaId: 'media-1'}, {os: 'ios', isTV: false})).toBe(false);
  });

  it('keeps the same playback descriptor outside the native stack across minimize and restore', () => {
    let navigation: ReturnType<typeof usePorticoNavigationActions> | undefined;
    const commands = {
      back: jest.fn(),
      open: jest.fn(),
      replace: jest.fn(),
      restorePlayer: jest.fn(),
      selectPrimary: jest.fn(),
    };
    function Probe() {
      navigation = usePorticoNavigationActions();
      return null;
    }

    let renderer: TestRenderer.ReactTestRenderer;
    act(() => {
      renderer = TestRenderer.create(React.createElement(
        PorticoNavigationActionProvider,
        {commands, route: player},
        React.createElement(Probe),
      ));
    });
    act(() => navigation?.back());
    expect(commands.back).toHaveBeenCalledTimes(1);
    // Native-stack transition completion—not Back initiation—changes the
    // persistent player's presentation. This prevents cancelled gestures from
    // creating a mini-player.
    act(() => navigation?.minimizePlayer(player));
    expect(navigation?.minimizedPlayer).toEqual(player);
    expect(navigation?.persistentPlayer).toEqual(player);

    act(() => {
      renderer!.update(React.createElement(
        PorticoNavigationActionProvider,
        {commands, route: {name: 'home'}},
        React.createElement(Probe),
      ));
    });
    expect(navigation?.persistentPlayer).toEqual(player);
    act(() => navigation?.restoreMinimizedPlayer());
    expect(commands.restorePlayer).toHaveBeenCalledWith(player);
    expect(navigation?.persistentPlayer).toEqual(player);

    act(() => renderer!.unmount());
  });

  it('atomically replaces a minimized descriptor when new playback starts', () => {
    let navigation: ReturnType<typeof usePorticoNavigationActions> | undefined;
    const commands = {
      back: jest.fn(),
      open: jest.fn(),
      replace: jest.fn(),
      restorePlayer: jest.fn(),
      selectPrimary: jest.fn(),
    };
    function Probe() {
      navigation = usePorticoNavigationActions();
      return null;
    }

    let renderer: TestRenderer.ReactTestRenderer;
    act(() => {
      renderer = TestRenderer.create(React.createElement(
        PorticoNavigationActionProvider,
        {commands, route: player},
        React.createElement(Probe),
      ));
    });
    act(() => navigation?.minimizePlayer(player));
    expect(navigation?.minimizedPlayer).toEqual(player);

    act(() => navigation?.openPlayer('new-media', true));
    expect(commands.open).toHaveBeenCalledWith({name: 'player', mediaId: 'new-media', live: true});
    expect(navigation?.minimizedPlayer).toBeUndefined();
    expect(navigation?.persistentPlayer).toEqual({name: 'player', mediaId: 'new-media', live: true});

    act(() => renderer!.unmount());
  });

  it('starts audio directly in the mini-player without covering the current screen', () => {
    let navigation: ReturnType<typeof usePorticoNavigationActions> | undefined;
    const commands = {back: jest.fn(), open: jest.fn(), replace: jest.fn(), restorePlayer: jest.fn(), selectPrimary: jest.fn()};
    function Probe() { navigation = usePorticoNavigationActions(); return null; }
    let renderer: TestRenderer.ReactTestRenderer;
    act(() => { renderer = TestRenderer.create(React.createElement(PorticoNavigationActionProvider, {commands, route: {name: 'home'}}, React.createElement(Probe))); });
    act(() => navigation?.openPlayableMedia({id: 'track-1', kind: 'track', playbackMediaId: 'track-1'}));
    expect(commands.open).not.toHaveBeenCalled();
    expect(navigation?.persistentPlayer).toEqual({name: 'player', mediaId: 'track-1'});
    expect(navigation?.minimizedPlayer).toEqual({name: 'player', mediaId: 'track-1'});
    act(() => renderer!.unmount());
  });

  it('collapses immediately and suppresses transition-driven resurrection after close', () => {
    let navigation: ReturnType<typeof usePorticoNavigationActions> | undefined;
    const commands = {back: jest.fn(), open: jest.fn(), replace: jest.fn(), restorePlayer: jest.fn(), selectPrimary: jest.fn()};
    function Probe() { navigation = usePorticoNavigationActions(); return null; }
    let renderer: TestRenderer.ReactTestRenderer;
    act(() => { renderer = TestRenderer.create(React.createElement(PorticoNavigationActionProvider, {commands, route: player}, React.createElement(Probe))); });
    act(() => navigation?.collapsePlayer());
    expect(navigation?.minimizedPlayer).toEqual(player);
    expect(commands.back).toHaveBeenCalledTimes(1);
    act(() => navigation?.closePlayer());
    expect(navigation?.persistentPlayer).toBeUndefined();
    expect(navigation?.minimizedPlayer).toBeUndefined();
    act(() => navigation?.minimizePlayer(player));
    expect(navigation?.persistentPlayer).toBeUndefined();
    expect(navigation?.minimizedPlayer).toBeUndefined();
    act(() => renderer!.unmount());
  });

  it('revisions a repeated same-source intent without changing source identity', () => {
    let navigation: ReturnType<typeof usePorticoNavigationActions> | undefined;
    const commands = {back: jest.fn(), open: jest.fn(), replace: jest.fn(), restorePlayer: jest.fn(), selectPrimary: jest.fn()};
    function Probe() { navigation = usePorticoNavigationActions(); return null; }
    let renderer: TestRenderer.ReactTestRenderer;
    act(() => { renderer = TestRenderer.create(React.createElement(PorticoNavigationActionProvider, {commands, route: player}, React.createElement(Probe))); });
    act(() => navigation?.openPlayer('media-1'));
    expect(commands.replace).toHaveBeenCalledWith({name: 'player', mediaId: 'media-1', playbackIntentRevision: 1});
    expect(navigation?.persistentPlayer).toEqual({name: 'player', mediaId: 'media-1', playbackIntentRevision: 1});
    act(() => renderer!.unmount());
  });

  it('retains playback as a mini-player when navigation leaves Player without Back', () => {
    let navigation: ReturnType<typeof usePorticoNavigationActions> | undefined;
    const commands = {
      back: jest.fn(),
      open: jest.fn(),
      replace: jest.fn(),
      restorePlayer: jest.fn(),
      selectPrimary: jest.fn(),
    };
    function Probe() {
      navigation = usePorticoNavigationActions();
      return null;
    }
    let renderer: TestRenderer.ReactTestRenderer;
    act(() => {
      renderer = TestRenderer.create(React.createElement(
        PorticoNavigationActionProvider,
        {commands, route: player},
        React.createElement(Probe),
      ));
    });
    act(() => navigation?.selectPrimary('library'));
    expect(commands.selectPrimary).toHaveBeenCalledWith('library');
    expect(navigation?.persistentPlayer).toEqual(player);
    expect(navigation?.minimizedPlayer).toEqual(player);
    act(() => renderer!.unmount());
  });

  it('keeps television playback stable while Player is presented and releases it only after exit', () => {
    let navigation: ReturnType<typeof usePorticoNavigationActions> | undefined;
    const commands = {back: jest.fn(), open: jest.fn(), replace: jest.fn(), restorePlayer: jest.fn(), selectPrimary: jest.fn()};
    function Probe() { navigation = usePorticoNavigationActions(); return null; }
    let renderer: TestRenderer.ReactTestRenderer;
    act(() => {
      renderer = TestRenderer.create(React.createElement(
        PorticoNavigationActionProvider,
        {commands, playerPersistence: 'route-bound', route: {name: 'home'}},
        React.createElement(Probe),
      ));
    });
    act(() => navigation?.openPlayer('tv-media'));
    expect(navigation?.persistentPlayer).toEqual({name: 'player', mediaId: 'tv-media'});
    act(() => {
      renderer!.update(React.createElement(
        PorticoNavigationActionProvider,
        {commands, playerPersistence: 'route-bound', route: {name: 'player', mediaId: 'tv-media'}},
        React.createElement(Probe),
      ));
    });
    expect(navigation?.persistentPlayer).toEqual({name: 'player', mediaId: 'tv-media'});
    act(() => {
      renderer!.update(React.createElement(
        PorticoNavigationActionProvider,
        {commands, playerPersistence: 'route-bound', route: {name: 'home'}},
        React.createElement(Probe),
      ));
    });
    expect(navigation?.persistentPlayer).toBeUndefined();
    expect(navigation?.minimizedPlayer).toBeUndefined();
    act(() => renderer!.unmount());
  });

  it('replaces repeated semantic secondary destinations instead of pushing duplicates', () => {
    let navigation: ReturnType<typeof usePorticoNavigationActions> | undefined;
    const commands = {back: jest.fn(), open: jest.fn(), replace: jest.fn(), restorePlayer: jest.fn(), selectPrimary: jest.fn()};
    function Probe() { navigation = usePorticoNavigationActions(); return null; }
    const detail: PorticoRoute = {name: 'detail', mediaId: 'show-1', seasonId: 'season-1'};
    let renderer: TestRenderer.ReactTestRenderer;
    act(() => { renderer = TestRenderer.create(React.createElement(PorticoNavigationActionProvider, {commands, route: detail}, React.createElement(Probe))); });
    act(() => navigation?.openDetail('show-1', {seasonId: 'season-2'}));
    expect(commands.replace).toHaveBeenCalledWith({name: 'detail', mediaId: 'show-1', seasonId: 'season-2'});
    expect(commands.open).not.toHaveBeenCalled();
    act(() => navigation?.openPerson('person-2'));
    expect(commands.open).toHaveBeenCalledWith({name: 'person', personId: 'person-2'});
    act(() => renderer!.unmount());
  });
});

describe('server-identity-aware playback navigation', () => {
  const playable = (overrides: Partial<Parameters<typeof playerRouteForMedia>[0]>) => ({
    id: 'media-1',
    kind: 'movie' as const,
    playbackMediaId: 'playback-1',
    ...overrides,
  });

  it('keeps generic media on the VOD playback route', () => {
    expect(playerRouteForMedia(playable({}))).toEqual({
      name: 'player',
      mediaId: 'playback-1',
    });
  });

  it('routes recordings through the DVR contract using the recording id', () => {
    expect(playerRouteForMedia(playable({id: 'recording-7', kind: 'recording'}))).toEqual({
      name: 'player',
      mediaId: 'recording-7',
      dvr: true,
    });
  });

  it('routes live programmes through their server playback target', () => {
    expect(playerRouteForMedia(playable({
      id: 'programme-4',
      kind: 'live-program',
      parentId: 'channel-parent',
      playbackMediaId: 'channel-target',
    }))).toEqual({
      name: 'player',
      mediaId: 'channel-target',
      live: true,
    });
  });
});
