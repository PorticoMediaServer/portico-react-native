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

/** Phone long press enters selection; a TV hold opens the caller's actual menu. */
export function holdCard(actions: CardActions, isTV: boolean): void {
  if (isTV) actions.onMore?.();
  else if (actions.selection) actions.selection.onEnter();
  else actions.onMore?.();
}

export function cardProgress(value: number | undefined): number | undefined {
  return value === undefined || !Number.isFinite(value) ? undefined : Math.max(0, Math.min(1, value));
}
