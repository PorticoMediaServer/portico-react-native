import type {GroupSessionSnapshot} from '../../../../../packages/client-core/src/group-session';

/**
 * tv-more18: the one live group session the Together route owns, published read-only for the
 * player chrome's group pill and people sheet.
 *
 * This is a registration slot, not a store: it holds no copy of members, permissions, the
 * queue or any command. The snapshot is the owner´s own `GroupSessionSnapshot`, the commands
 * are the owner´s own controller actions, and the registration is retired by the owner on
 * dispose, authority change or route change. When nothing is registered, nothing is claimed.
 */
export type NativeGroupPort = Readonly<{
  getSnapshot: () => GroupSessionSnapshot;
  subscribe: (listener: () => void) => () => void;
  /** True while the owning controller still belongs to the live authority and route. */
  current: () => boolean;
  /** The owner's existing command; the port never sends a group request itself. */
  makeHost: (memberId: string) => Promise<boolean>;
}>;

let live: NativeGroupPort | undefined;
const listeners = new Set<() => void>();
const emit = () => {for (const listener of [...listeners]) listener();};

/** Publish the live owner. Returns its retirement; a later owner replaces the slot. */
export function publishGroupPort(port: NativeGroupPort): () => void {
  live = port; emit();
  return () => {if (live === port) {live = undefined; emit();}};
}

/** The current owner, or null when it is gone or its authority/route has retired. */
export function groupPort(): NativeGroupPort | undefined {
  if (live && !live.current()) live = undefined;
  return live;
}

export function subscribeGroupPort(listener: () => void): () => void {
  listeners.add(listener);
  return () => {listeners.delete(listener);};
}
