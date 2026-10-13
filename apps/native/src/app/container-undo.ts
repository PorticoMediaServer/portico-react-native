import {undoContainerState, type ContainerKind, type ContainerState, type ContainerStateApi} from '../../../../packages/client-core/src/container-state';

/**
 * Undo for a watched mark on a show, a season, an album or a book.
 *
 * The server answers a mark with a receipt: a token that puts back exactly what the mark replaced
 * (which episodes were watched, where each one had got to), once, within its window (thirty
 * seconds). Undo is that receipt and nothing else: it is never imitated by marking the title the
 * other way, which would lose the mix that was there before. The server refuses a receipt whose
 * time has passed, one already used, and one for a title that has really changed since.
 *
 * No React and no native code: tested under Node.
 */
export type ContainerUndoReceipt = Readonly<{kind: ContainerKind; id: string; revision: number; token: string; until: number}>;

/** The receipt a mark's answer carries, while it can still be used. */
export function containerUndoReceipt(kind: ContainerKind, id: string, marked: ContainerState, now: number = Date.now()): ContainerUndoReceipt | undefined {
  if (!marked.undoToken || !marked.undoUntil) return undefined;
  const until = Date.parse(marked.undoUntil);
  if (!Number.isFinite(until) || until <= now) return undefined;
  return Object.freeze({kind, id, revision: marked.revision, token: marked.undoToken, until});
}

export const UNDO_EXPIRED = 'operation_expired';

/** Puts back what the mark replaced. Rejects with the server's error; a receipt past its time is refused here, with the server's own code. */
export async function undoContainerMark(api: ContainerStateApi, receipt: ContainerUndoReceipt, now: number = Date.now()): Promise<ContainerState> {
  if (receipt.until <= now) throw Object.assign(new Error('The time to undo this change has passed.'), {code: UNDO_EXPIRED});
  return undoContainerState(api, receipt.kind, receipt.id, {expectedRevision: receipt.revision, undoToken: receipt.token});
}

export type MarkToast = Readonly<{message: string; icon?: 'check' | 'warning'; action?: Readonly<{label: string; onPress: () => void}>}>;

/**
 * Says a mark was made and offers Undo while its receipt is good. `onUndone` runs once the server
 * has put the earlier state back, so the screen can read it again; a refused Undo says why and
 * changes nothing.
 */
export function announceContainerMark(o: {
  api: ContainerStateApi;
  kind: ContainerKind;
  id: string;
  marked: ContainerState;
  message: string;
  undoLabel: string;
  /** The sentence for a refused Undo (`expired`: its time has passed). */
  describeFailure: (error: unknown, expired: boolean) => string;
  toast: (toast: MarkToast) => void;
  onUndone?: (restored: ContainerState) => void;
  now?: () => number;
}): void {
  const now = o.now ?? Date.now;
  const receipt = containerUndoReceipt(o.kind, o.id, o.marked, now());
  let used = false;
  const undo = () => {
    // One receipt, one use: a second press while the first is on its way does nothing.
    if (!receipt || used) return;
    used = true;
    undoContainerMark(o.api, receipt, now()).then(
      restored => o.onUndone?.(restored),
      error => o.toast({message: o.describeFailure(error, (error as {code?: unknown} | null)?.code === UNDO_EXPIRED), icon: 'warning'}),
    );
  };
  o.toast({message: o.message, icon: 'check', ...(receipt ? {action: {label: o.undoLabel, onPress: undo}} : {})});
}
