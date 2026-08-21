import {
  TVFocusMemory,
  TVRouteFocusRegistry,
  tvFocusRouteScope,
} from './index';

describe('tvFocusRouteScope', () => {
  it('fences identical routes by viewer, server and authorization generation', () => {
    const route = {name: 'Detail', semanticId: 'media-1'};
    const original = tvFocusRouteScope({
      accountId: 'account',
      authorizationGeneration: 4,
      profileId: 'adult',
      serverId: 'home',
    }, route);
    expect(tvFocusRouteScope({
      accountId: 'account',
      authorizationGeneration: 4,
      profileId: 'child',
      serverId: 'home',
    }, route)).not.toBe(original);
    expect(tvFocusRouteScope({
      accountId: 'account',
      authorizationGeneration: 5,
      profileId: 'adult',
      serverId: 'home',
    }, route)).not.toBe(original);
  });

  it('does not require navigator instance keys or private route data', () => {
    expect(tvFocusRouteScope({profileId: 'viewer'}, {name: 'Home'}))
      .toBe('tv-focus-v1:-:viewer:-:-:-:Home:-');
  });
});

describe('TVFocusMemory', () => {
  it('is bounded and uses access-order eviction', () => {
    const memory = new TVFocusMemory(2);
    memory.remember('home', 'home-card');
    memory.remember('library', 'library-card');
    expect(memory.recall('home')).toBe('home-card');
    memory.remember('detail', 'play');
    expect(memory.recall('library')).toBeUndefined();
    expect(memory.recall('home')).toBe('home-card');
    expect(memory.recall('detail')).toBe('play');
  });
});

describe('TVRouteFocusRegistry', () => {
  const target = () => ({requestTVFocus: jest.fn()});

  it('restores only the exact remembered semantic target', () => {
    const memory = new TVFocusMemory();
    memory.remember('home-scope', 'second-card');
    const registry = new TVRouteFocusRegistry('home-scope', memory);
    const first = target();
    const second = target();
    registry.mount('first-card', first);
    registry.mount('second-card', second);
    expect(registry.activate()).toEqual({activation: 1, target: second});
  });

  it('allows a late remount to satisfy an armed route restoration', () => {
    const memory = new TVFocusMemory();
    memory.remember('library-scope', 'remembered-row');
    const registry = new TVRouteFocusRegistry('library-scope', memory);
    expect(registry.activate()).toBeUndefined();
    const remembered = target();
    expect(registry.mount('remembered-row', remembered))
      .toEqual({activation: 1, target: remembered});
  });

  it('does not restore after blur or let unrelated mounts steal focus', () => {
    const memory = new TVFocusMemory();
    memory.remember('saved-scope', 'saved-card');
    const registry = new TVRouteFocusRegistry('saved-scope', memory);
    registry.activate();
    expect(registry.mount('another-card', target())).toBeUndefined();
    registry.deactivate();
    expect(registry.mount('saved-card', target())).toBeUndefined();
  });

  it('refuses stale scheduled restoration after route deactivation', () => {
    const memory = new TVFocusMemory();
    memory.remember('detail-scope', 'action');
    const registry = new TVRouteFocusRegistry('detail-scope', memory);
    const action = target();
    registry.mount('action', action);
    const request = registry.activate()!;
    expect(registry.canRestore(request.activation, request.target)).toBe(true);
    registry.deactivate();
    expect(registry.canRestore(request.activation, request.target)).toBe(false);
  });
});
