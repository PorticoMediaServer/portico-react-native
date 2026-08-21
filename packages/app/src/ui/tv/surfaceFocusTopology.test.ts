import {
  TVFocusCoordinator,
  TVLogicalFocusRegistry,
} from '@portico-react-native/tv-focus';
import {
  tvBrowseSurfaceFocusContainer,
  tvBrowseSurfaceFocusContainers,
  type TVBrowseFocusSurface,
} from './surfaceFocusTopology';

describe.each([
  'home',
  'search',
  'library',
  'channels',
  'saved',
  'profile-selection',
] as const)('%s topology', (surface: TVBrowseFocusSurface) => {
  test('has stable surface-specific identity and restores semantic nodes across reorder/removal', () => {
    const container = tvBrowseSurfaceFocusContainer(surface);
    expect(tvBrowseSurfaceFocusContainer(surface)).toBe(container);
    expect(tvBrowseSurfaceFocusContainers(surface)).toBe(
      tvBrowseSurfaceFocusContainers(surface),
    );
    expect(container.id).toBe(`${surface}:content`);

    const registry = new TVLogicalFocusRegistry<object>();
    registry.registerContainer(container);
    registry.registerNode({
      containerId: container.id,
      id: `${surface}:a`,
      order: 2,
    });
    registry.registerNode({
      containerId: container.id,
      id: `${surface}:b`,
      order: 1,
    });
    const first = {};
    const remembered = {};
    const unmountFirst = registry.mount(`${surface}:a`, first);
    registry.mount(`${surface}:b`, remembered);
    expect(registry.target(`${surface}:b`)).toBe(remembered);
    unmountFirst();
    expect(registry.nearestMounted(`${surface}:a`)).toEqual({
      focusId: `${surface}:b`,
      target: remembered,
    });
  });

  test('reveals a sparse semantic target before coordinated native focus', async () => {
    const calls: string[] = [];
    const target = {};
    const container = tvBrowseSurfaceFocusContainer(surface);
    const registry = new TVLogicalFocusRegistry<object>();
    registry.registerContainer({
      ...container,
      virtualizer: {
        reveal: focusId => {
          calls.push(`reveal:${focusId}`);
          registry.mount(focusId, target);
        },
      },
    });
    const focusId = `${surface}:virtual:item-42`;
    registry.registerNode({containerId: container.id, id: focusId});
    const coordinator = new TVFocusCoordinator(registry, {
      requestFocus: value => {
        calls.push(value === target ? `focus:${focusId}` : 'focus:wrong');
        return true;
      },
    });
    await expect(coordinator.focus(focusId)).resolves.toEqual({
      focusId,
      status: 'focused',
    });
    expect(calls).toEqual([`reveal:${focusId}`, `focus:${focusId}`]);
  });
});
