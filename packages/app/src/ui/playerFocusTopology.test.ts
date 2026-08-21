import {TVFocusCoordinator, TVLogicalFocusRegistry} from '@portico-react-native/tv-focus';
import {createTVPlayerFocusContainers, TV_PLAYER_FOCUS, TV_PLAYER_FOCUS_ENTRY} from './playerFocusTopology';

test('player focus containers expose explicit timeline, transport, utility, and panel edges', () => {
  const closed = createTVPlayerFocusContainers(false);
  expect(closed.map(container => container.id)).toEqual([
    TV_PLAYER_FOCUS.timeline,
    TV_PLAYER_FOCUS.transport,
    TV_PLAYER_FOCUS.utilities,
    TV_PLAYER_FOCUS.panel,
  ]);
  expect(closed[0]?.neighbours).toEqual({down: TV_PLAYER_FOCUS.transport});
  expect(closed[1]?.neighbours).toEqual({down: TV_PLAYER_FOCUS.utilities, up: TV_PLAYER_FOCUS.timeline});
  expect(closed[2]?.neighbours).toEqual({up: TV_PLAYER_FOCUS.transport});
  expect(closed[3]?.lifecycle).toBe('hidden');
  expect(closed.slice(0, 3).map(container => container.entryFocusId)).toEqual([
    TV_PLAYER_FOCUS_ENTRY.timeline,
    TV_PLAYER_FOCUS_ENTRY.transport,
    TV_PLAYER_FOCUS_ENTRY.utilities,
  ]);

  const open = createTVPlayerFocusContainers(true);
  expect(open[2]?.neighbours).toEqual({down: TV_PLAYER_FOCUS.panel, up: TV_PLAYER_FOCUS.transport});
  expect(open[3]?.neighbours).toEqual({up: TV_PLAYER_FOCUS.utilities});
  expect(open[3]?.lifecycle).toBe('active');
});

test('live player boundaries move deterministically and restore the exact utility invoker', async () => {
  const registry = new TVLogicalFocusRegistry<{requestTVFocus(): void}>();
  createTVPlayerFocusContainers(true).forEach(container => registry.registerContainer(container));
  const nodes = [
    {boundaryDirections: ['down'] as const, containerId: TV_PLAYER_FOCUS.timeline, id: TV_PLAYER_FOCUS_ENTRY.timeline, order: 0},
    {boundaryDirections: ['down', 'up'] as const, containerId: TV_PLAYER_FOCUS.transport, id: TV_PLAYER_FOCUS_ENTRY.transport, order: 2},
    {boundaryDirections: ['down', 'up'] as const, containerId: TV_PLAYER_FOCUS.utilities, id: TV_PLAYER_FOCUS_ENTRY.utilities, order: 0},
    {boundaryDirections: ['up'] as const, containerId: TV_PLAYER_FOCUS.panel, id: 'player-panel:volume:occurrence:0:volume-0', order: 0},
  ];
  const focused: string[] = [];
  for (const node of nodes) {
    registry.registerNode(node);
    registry.mount(node.id, {requestTVFocus: () => focused.push(node.id)});
  }
  expect(registry.move(TV_PLAYER_FOCUS_ENTRY.timeline, 'down')).toBe(TV_PLAYER_FOCUS_ENTRY.transport);
  expect(registry.move(TV_PLAYER_FOCUS_ENTRY.transport, 'down')).toBe(TV_PLAYER_FOCUS_ENTRY.utilities);
  expect(registry.move(TV_PLAYER_FOCUS_ENTRY.utilities, 'down')).toBe('player-panel:volume:occurrence:0:volume-0');
  expect(registry.move('player-panel:volume:occurrence:0:volume-0', 'up')).toBe(TV_PLAYER_FOCUS_ENTRY.utilities);

  const coordinator = new TVFocusCoordinator(registry, {
    requestFocus(target) { target.requestTVFocus(); return true; },
  });
  await expect(coordinator.focus('player:utility:volume')).resolves.toEqual({focusId: 'player:utility:volume', status: 'focused'});
  expect(focused).toEqual(['player:utility:volume']);
});
