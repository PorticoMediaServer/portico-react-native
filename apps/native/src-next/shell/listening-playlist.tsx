import React from 'react';
import {sameFence, type PlaybackFence} from '../../../../packages/player-core/src';
import {createMusicPlaylistPicker} from '../screens/destinations/music/MusicPlaylistPicker';
import type {NativeShellBootstrapContext} from './bootstrap';
import type {NativePlaybackReadLifetime} from '../platform/playback/types';
import type {NativeShellRuntime} from './runtime';

/** The existing authority-local picker, borrowed by the current listening song.
 * A retained button never substitutes whatever happens to be playing now. */
type Open = Readonly<{fence: PlaybackFence; revision: number; controller: AbortController;
  lifetime?: NativePlaybackReadLifetime; release?: () => void}>;
type Scope = Readonly<{fence: PlaybackFence; lifetime: NativePlaybackReadLifetime; itemId: string}>;

/** A playlist opener bound to the listening opening that offered it. The original lifetime
 * proves the route/page and the item id proves the target; a press can never substitute the
 * song or navigation revision that happens to be current now. */
export type NativeListeningPlaylistBinding = Readonly<{canOpen: () => boolean; open: () => void}>;

export function createNativeListeningPlaylist(context: NativeShellBootstrapContext) {
  const picker = createMusicPlaylistPicker(context);
  let disposed = false;
  let opening: Open | undefined;
  const song = (fence: PlaybackFence) => {
    if (disposed || !context.current() || fence.kind !== 'queue') return;
    const state = context.playback.getSnapshot(), view = state.queue?.view;
    if (!sameFence(state.fence, fence) || !state.dock.local?.expanded || state.dock.local.kind !== 'music'
      || state.playback.session?.id !== fence.sessionId || view?.queue.currentEntryId !== fence.entryId) return;
    const item = view.items.find(value => value.entryId === fence.entryId);
    return item?.kind === 'song' && item.itemId === fence.itemId ? item : undefined;
  };
  const scopedItem = (scope: Scope) => {
    if (disposed || !context.current() || scope.lifetime.signal.aborted || !scope.lifetime.isCurrent()) return;
    const item = song(scope.fence);
    return item && item.itemId === scope.itemId ? item : undefined;
  };
  const retire = () => {
    const previous = opening;
    opening = undefined;
    previous?.release?.();
    previous?.controller.abort();
  };
  const check = () => {
    if (opening && (!song(opening.fence) || context.navigation.getSnapshot().revision !== opening.revision
      || (opening.lifetime && (!opening.lifetime.isCurrent() || opening.lifetime.signal.aborted)))) retire();
  };
  const openScoped = (scope: Scope) => {
    const item = scopedItem(scope);
    if (!item) return;
    retire();
    const controller = new AbortController(), stop = () => controller.abort();
    scope.lifetime.signal.addEventListener('abort', stop, {once: true});
    const at: Open = Object.freeze({fence: scope.fence, revision: context.navigation.getSnapshot().revision, controller,
      lifetime: scope.lifetime, release: () => scope.lifetime.signal.removeEventListener('abort', stop)});
    opening = at;
    picker.open(item.itemId, {signal: controller.signal, isCurrent: () => opening === at && !controller.signal.aborted
      && scope.lifetime.isCurrent() && !scope.lifetime.signal.aborted
      && context.navigation.getSnapshot().revision === at.revision && scopedItem(scope) === item});
  };
  const off = [context.playback.subscribe(check), context.subscribeAuthority(check), context.navigation.subscribe(check)];
  return Object.freeze({
    canOpen: (fence: PlaybackFence) => !!song(fence),
    open: (fence: PlaybackFence) => {
      const item = song(fence);
      if (!item) return;
      retire();
      const at: Open = Object.freeze({fence, revision: context.navigation.getSnapshot().revision, controller: new AbortController()});
      opening = at;
      picker.open(item.itemId, {signal: at.controller.signal, isCurrent: () => opening === at && !at.controller.signal.aborted
        && !!song(at.fence) && context.navigation.getSnapshot().revision === at.revision});
    },
    bind: (fence: PlaybackFence, lifetime: NativePlaybackReadLifetime, itemId: string): NativeListeningPlaylistBinding => {
      const scope: Scope = Object.freeze({fence, lifetime, itemId});
      return Object.freeze({canOpen: () => !!scopedItem(scope), open: () => openScoped(scope)});
    },
    render: (runtime: NativeShellRuntime) => !disposed && context.current() ? picker.render(runtime) : null,
    dispose: () => {if (disposed) return; disposed = true; retire(); off.forEach(stop => stop()); picker.dispose();},
  });
}

export type NativeListeningPlaylist = ReturnType<typeof createNativeListeningPlaylist>;
