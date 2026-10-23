export type CardSelection = Readonly<{
  active: boolean;
  selected: boolean;
  onToggle: () => void;
  onEnter: () => void;
}>;

/** Callbacks retain the caller's navigation and server-selected playback identities. */
export type CardActions = Readonly<{
  onMore?: () => void;
  selection?: CardSelection;
}> & (
  | Readonly<{primaryAction?: 'navigate'; onNavigate: () => void; onPlay?: () => void}>
  | Readonly<{primaryAction: 'play'; onPlay: () => void; onNavigate?: () => void}>
);

export function activateCard(actions: CardActions): void {
  if (actions.selection?.active) actions.selection.onToggle();
  else if (actions.primaryAction === 'play') actions.onPlay();
  else actions.onNavigate();
}

/** Q6: an active touch selection toggles; every other hold opens the caller's menu. */
export function holdCard(actions: CardActions, isTV: boolean): void {
  if (!isTV && actions.selection?.active) actions.selection.onToggle();
  else actions.onMore?.();
}

export function cardProgress(value: number | undefined): number | undefined {
  return value === undefined || !Number.isFinite(value) ? undefined : Math.max(0, Math.min(1, value));
}
