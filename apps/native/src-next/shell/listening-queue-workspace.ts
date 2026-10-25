import {sameFence, type PlaybackFence} from '../../../../packages/player-core/src';
import type {QueueIntent} from '../../../../packages/client-core/src/queues';
import type {NativePlaybackAdapter, NativePlaybackReadLifetime} from '../platform/playback/types';
import type {NativeShellBootstrapContext} from './bootstrap';

/** The only row edits the loaded window may ask for: one drawn entry removed, or the drawn
 * contiguous block reordered. Repeat/shuffle belong to the queue-policy port; nothing here
 * can act on an entry that is not loaded, and there is no bulk/select-all action. */
export type NativeQueueRowEdit = Readonly<{action: 'remove'; entryId: string} | {action: 'reorder'; entryIds: readonly string[]}>;

type Workspace = NonNullable<NativePlaybackAdapter['queueWorkspace']>;

/** The real queue command, fenced to the expanded screen, its page and the drawn revision. */
export function createNativeListeningQueueWorkspace(context: NativeShellBootstrapContext) {
  let disposed = false;
  const pending = new Set<{abort: AbortController; current: () => boolean}>();
  const expanded = (fence: PlaybackFence) => {
    const state = context.playback.getSnapshot();
    return !disposed && context.current() && state.dock.local?.expanded === true && sameFence(state.fence, fence);
  };
  const check = () => {for (const operation of pending) if (!operation.current()) operation.abort.abort();};
  const off = [context.navigation.subscribe(check), context.subscribeAuthority(check), context.playback.subscribe(check)];
  const loaded = (queueId: string, expectedRevision: string) => {
    const view = context.playback.getSnapshot().queue?.view;
    return view && view.queue.id === queueId && view.queue.revision === expectedRevision ? view : undefined;
  };
  const intentFor = (view: NonNullable<ReturnType<typeof loaded>>, edit: NativeQueueRowEdit): QueueIntent | undefined => {
    const entries = view.queue.entries.filter(entry => !entry.hidden && !entry.removed).map(entry => entry.id);
    if (edit.action === 'remove') return entries.includes(edit.entryId) ? {action: 'remove', entryId: edit.entryId} : undefined;
    return edit.entryIds.length >= 2 && new Set(edit.entryIds).size === edit.entryIds.length && edit.entryIds.every(id => entries.includes(id))
      ? {action: 'reorder', entryIds: edit.entryIds} : undefined;
  };
  return Object.freeze({
    canEdit: (fence: PlaybackFence) => !!context.playback.queueWorkspace && expanded(fence),
    apply: async (fence: PlaybackFence, request: Readonly<{queueId: string; expectedRevision: string; edit: NativeQueueRowEdit}>, caller: NativePlaybackReadLifetime): Promise<void> => {
      const workspace: Workspace | undefined = context.playback.queueWorkspace;
      if (!workspace || !expanded(fence) || caller.signal.aborted || !caller.isCurrent()) return;
      const view = loaded(request.queueId, request.expectedRevision), intent = view && intentFor(view, request.edit);
      const queue = workspace.getSnapshot().queue;
      if (!intent || !queue || queue.id !== request.queueId || queue.revision !== request.expectedRevision) return;
      const revision = context.navigation.getSnapshot().revision, abort = new AbortController();
      const current = () => !abort.signal.aborted && !caller.signal.aborted && caller.isCurrent() && expanded(fence)
        && context.navigation.getSnapshot().revision === revision;
      const operation = {abort, current}, cancel = () => abort.abort();
      pending.add(operation); caller.signal.addEventListener('abort', cancel, {once: true});
      try {if (current()) await workspace.mutate(intent);}
      finally {caller.signal.removeEventListener('abort', cancel); pending.delete(operation); abort.abort();}
    },
    dispose: () => {if (disposed) return; disposed = true; for (const operation of pending) operation.abort.abort(); pending.clear(); off.forEach(stop => stop());},
  });
}

export type NativeListeningQueueWorkspace = ReturnType<typeof createNativeListeningQueueWorkspace>;
