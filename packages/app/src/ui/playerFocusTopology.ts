import type {TVLogicalFocusContainer} from '@portico-react-native/tv-focus';

export const TV_PLAYER_FOCUS = {
  panel: 'player:panel',
  timeline: 'player:timeline',
  transport: 'player:transport',
  utilities: 'player:utilities',
} as const;

export const TV_PLAYER_FOCUS_ENTRY = {
  timeline: 'player:timeline:position',
  transport: 'player:transport:play-pause',
  utilities: 'player:utility:volume',
} as const;

/** Cross-container movement is semantic and deterministic, never inferred from screen geometry. */
export function createTVPlayerFocusContainers(panelOpen: boolean): TVLogicalFocusContainer[] {
  return [
    {entryFocusId: TV_PLAYER_FOCUS_ENTRY.timeline, id: TV_PLAYER_FOCUS.timeline, neighbours: {down: TV_PLAYER_FOCUS.transport}},
    {entryFocusId: TV_PLAYER_FOCUS_ENTRY.transport, id: TV_PLAYER_FOCUS.transport, neighbours: {down: TV_PLAYER_FOCUS.utilities, up: TV_PLAYER_FOCUS.timeline}},
    {entryFocusId: TV_PLAYER_FOCUS_ENTRY.utilities, id: TV_PLAYER_FOCUS.utilities, neighbours: panelOpen ? {down: TV_PLAYER_FOCUS.panel, up: TV_PLAYER_FOCUS.transport} : {up: TV_PLAYER_FOCUS.transport}},
    {id: TV_PLAYER_FOCUS.panel, lifecycle: panelOpen ? 'active' : 'hidden', neighbours: {up: TV_PLAYER_FOCUS.utilities}},
  ];
}
