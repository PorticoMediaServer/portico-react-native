import {sameFence, type PlaybackFence} from '../../../../packages/player-core/src';
import {sameAuthority, type ShellAuthority} from './model';
import type {NativeShellBounds} from './playback';

/** Read-side shape agreed with the watch outlet owner; canonical types await MAIN. */
export type ExpandedSlotLayout = Readonly<{
  authority: ShellAuthority;
  fence: PlaybackFence;
  layoutRevision: number;
  window: Readonly<{width: number; height: number}>;
  /** Measured player pane (layout.surface), including letterbox space; fitted image content is not another slot. */
  frameInWindow: NativeShellBounds;
}>;
export type ExpandedSlotReader = Readonly<{
  getSnapshot: () => ExpandedSlotLayout | undefined;
  subscribe: (listener: () => void) => () => void;
}>;

export function watchSlotIsCurrent(slot: ExpandedSlotLayout | undefined, authority: ShellAuthority, fence: PlaybackFence | undefined, window: Readonly<{width: number; height: number}>): slot is ExpandedSlotLayout {
  if (!slot || !fence || !sameAuthority(slot.authority, authority) || !sameFence(slot.fence, fence)
    || !Number.isSafeInteger(slot.layoutRevision) || slot.layoutRevision < 0
    || !Number.isFinite(window.width) || !Number.isFinite(window.height) || window.width <= 0 || window.height <= 0
    || slot.window.width !== window.width || slot.window.height !== window.height) return false;
  const {x, y, width, height} = slot.frameInWindow, right = x + width, bottom = y + height;
  return [x, y, width, height, right, bottom].every(Number.isFinite) && width > 0 && height > 0
    && x < window.width && y < window.height && right > 0 && bottom > 0;
}

/** Convert coordinates only; clipping the measured picture would resize its content. */
export function watchSlotInHost(slot: ExpandedSlotLayout, origin: Readonly<{x: number; y: number}>): NativeShellBounds | undefined {
  const frame = slot.frameInWindow, x = frame.x - origin.x, y = frame.y - origin.y;
  return [origin.x, origin.y, x, y].every(Number.isFinite) ? {...frame, x, y} : undefined;
}
