import {
  TVFocusCoordinator,
  TVLogicalFocusRegistry,
  TVSemanticFocusMemory,
  androidTVFocusAdapter,
  tvOSFocusAdapter,
  type TVNativeFocusAdapter,
} from './logicalFocus';

describe('TVLogicalFocusRegistry', () => {
  it('resolves explicit graph edges before stable container order', () => {
    const registry = new TVLogicalFocusRegistry<object>();
    registry.registerContainer({
      defaultFocusId: 'two',
      id: 'grid',
      movement: 'graph',
    });
    registry.registerNode({
      containerId: 'grid',
      id: 'one',
      neighbours: {right: 'three'},
      order: 1,
    });
    registry.registerNode({containerId: 'grid', id: 'two', order: 2});
    registry.registerNode({containerId: 'grid', id: 'three', order: 3});
    expect(registry.first('grid')).toBe('two');
    expect(registry.move('one', 'right')).toBe('three');
    expect(registry.move('three', 'left')).toBe('two');
  });

  it('validates duplicate ids and parent existence', () => {
    const registry = new TVLogicalFocusRegistry<object>();
    expect(() =>
      registry.registerContainer({id: 'child', parentId: 'missing'}),
    ).toThrow(/Unknown parent/);
    registry.registerContainer({id: 'root'});
    expect(() => registry.registerContainer({id: 'root'})).toThrow(/Duplicate/);
    registry.registerNode({containerId: 'root', id: 'item'});
    expect(() =>
      registry.registerNode({containerId: 'root', id: 'item'}),
    ).toThrow(/Duplicate/);
  });

  it('preserves native local movement and resolves deterministic container boundaries', () => {
    const registry = new TVLogicalFocusRegistry<object>();
    registry.registerContainer({id: 'root'});
    registry.registerContainer({
      id: 'hero',
      neighbours: {down: 'episodes'},
      parentId: 'root',
    });
    registry.registerContainer({
      defaultFocusId: 'episode-2',
      entryFocusId: 'episode-1',
      id: 'episodes',
      parentId: 'root',
    });
    registry.registerNode({containerId: 'hero', id: 'play'});
    registry.registerNode({containerId: 'episodes', id: 'episode-2', order: 2});
    registry.registerNode({containerId: 'episodes', id: 'episode-1', order: 1});
    expect(registry.move('episode-1', 'right')).toBeUndefined();
    expect(registry.boundary('play', 'down')).toBe('episode-1');
  });

  it('skips empty containers at a semantic boundary', () => {
    const registry = new TVLogicalFocusRegistry<object>();
    registry.registerContainer({id: 'episodes', neighbours: {down: 'cast'}});
    registry.registerContainer({id: 'cast', neighbours: {down: 'extras'}});
    registry.registerContainer({id: 'extras', neighbours: {down: 'facts'}});
    registry.registerContainer({id: 'facts'});
    registry.registerNode({containerId: 'episodes', id: 'episode'});
    registry.registerNode({containerId: 'facts', id: 'technical-facts'});
    expect(registry.boundary('episode', 'down')).toBe('technical-facts');
  });

  it('fences lifecycle availability and viewer/route epochs', () => {
    const registry = new TVLogicalFocusRegistry<object>(2, 7);
    registry.registerContainer({id: 'row'});
    registry.registerNode({
      containerId: 'row',
      id: 'current',
      routeEpoch: 7,
      viewerEpoch: 2,
    });
    registry.registerNode({
      containerId: 'row',
      id: 'stale',
      routeEpoch: 6,
      viewerEpoch: 2,
    });
    expect(registry.available('current')).toBe(true);
    expect(registry.available('stale')).toBe(false);
    registry.setNodeLifecycle('current', 'hidden');
    expect(registry.first('row')).toBeUndefined();
    registry.setNodeLifecycle('current', 'active');
    registry.setEpochs(3, 1);
    expect(registry.available('current')).toBe(false);
  });

  it('retains logical nodes while virtualized native targets unmount', () => {
    const registry = new TVLogicalFocusRegistry<object>();
    registry.registerContainer({id: 'row'});
    registry.registerNode({containerId: 'row', id: 'card'});
    const target = {};
    const unmount = registry.mount('card', target);
    expect(registry.target('card')).toBe(target);
    unmount();
    expect(registry.node('card')).toBeDefined();
    expect(registry.target('card')).toBeUndefined();
  });
});

describe('TVFocusCoordinator', () => {
  it('reveals a virtualized node before requesting native focus', async () => {
    const calls: string[] = [];
    const target = {};
    const registry = new TVLogicalFocusRegistry<object>();
    registry.registerContainer({
      id: 'rail',
      virtualizer: {
        reveal: focusId => {
          calls.push(`reveal:${focusId}`);
          registry.mount(focusId, target);
        },
      },
    });
    registry.registerNode({containerId: 'rail', id: 'settings'});
    const adapter: TVNativeFocusAdapter<object> = {
      requestFocus: value => {
        calls.push(value === target ? 'focus:settings' : 'focus:wrong');
        return true;
      },
    };
    const coordinator = new TVFocusCoordinator(registry, adapter);
    await expect(coordinator.focus('settings')).resolves.toEqual({
      focusId: 'settings',
      status: 'focused',
    });
    expect(calls).toEqual(['reveal:settings', 'focus:settings']);
  });

  it('cancels stale activation transactions', async () => {
    let release!: () => void;
    const registry = new TVLogicalFocusRegistry<object>();
    registry.registerContainer({
      id: 'grid',
      virtualizer: {
        reveal: () =>
          new Promise<void>(resolve => {
            release = resolve;
          }),
      },
    });
    registry.registerNode({containerId: 'grid', id: 'old'});
    registry.registerNode({containerId: 'grid', id: 'new'});
    registry.mount('new', {});
    const coordinator = new TVFocusCoordinator(registry, {
      requestFocus: () => true,
    });
    const old = coordinator.focus('old');
    await coordinator.focus('new');
    release();
    await expect(old).resolves.toEqual({focusId: 'old', status: 'cancelled'});
  });

  it('allows an asynchronously mounted virtual target to complete the same transaction', async () => {
    const target = {};
    const registry = new TVLogicalFocusRegistry<object>();
    registry.registerContainer({
      id: 'grid',
      virtualizer: {reveal: () => undefined},
    });
    registry.registerNode({containerId: 'grid', id: 'late'});
    const requestFocus = jest.fn(() => true);
    const coordinator = new TVFocusCoordinator(registry, {requestFocus}, 100);
    const transaction = coordinator.focus('late');
    registry.mount('late', target);
    coordinator.mounted('late');
    await expect(transaction).resolves.toEqual({
      focusId: 'late',
      status: 'focused',
    });
    expect(requestFocus).toHaveBeenCalledWith(target);
  });
});

test('semantic focus memory rejects route and viewer epoch drift', () => {
  const memory = new TVSemanticFocusMemory();
  memory.remember('detail:movie', 'episode:4', 2, 9);
  expect(memory.recall('detail:movie', 2, 9)).toBe('episode:4');
  expect(memory.recall('detail:movie', 3, 9)).toBeUndefined();
  expect(memory.recall('detail:movie', 2, 10)).toBeUndefined();
});

describe.each([
  ['tvOS', tvOSFocusAdapter, {requestTVFocus: jest.fn()}],
  ['Android TV', androidTVFocusAdapter, {requestFocus: jest.fn()}],
] as const)('%s adapter parity fixture', (_platform, adapter, target) => {
  it('requests focus once and reports success', async () => {
    expect(await adapter.requestFocus(target)).toBe(true);
    const request =
      'requestTVFocus' in target ? target.requestTVFocus : target.requestFocus;
    expect(request).toHaveBeenCalledTimes(1);
  });
});
