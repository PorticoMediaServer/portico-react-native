import type {ComponentType} from 'react';
import type {HomeSelectionPlaybackPort} from '../../../../packages/client-core/src/home-selection/types';
import type {SelectionContext} from '../../../../packages/client-core/src/selection-model/index';
import type {PlaybackSnapshot} from '../../../../packages/client-core/src/index';
import type {ContentEntry} from '../../../../packages/client-core/src/library-content';
import type {PlaybackSubject} from '../../../../packages/client-core/src/presentation/kit-model';
import {sameFence, type DockState, type DockTransition, type PlaybackDock, type PlaybackFence} from '../../../../packages/player-core/src';
import {sameAuthority, type ShellAuthority} from './model';

export type NativeShellPlaybackStart = Readonly<{
  /** The real display record and the server-selected target stay separate for show continuations. */
  entry: ContentEntry;
  target: NonNullable<ContentEntry['playback']>;
  origin?: Readonly<{kind: 'home-row'; rowId: string}>;
}>;
export type NativeShellBounds = Readonly<{x: number; y: number; width: number; height: number}>;
export type NativeShellVideoSnapshot = Readonly<{
  fence: PlaybackFence;
  image: Readonly<{uri: string; width: number; height: number}>;
  release: () => Promise<void>;
}>;
export type NativeShellPlaybackSnapshot = Readonly<{
  authority: ShellAuthority;
  dock: DockState;
  playback: PlaybackSnapshot;
  fence?: PlaybackFence;
  subject?: PlaybackSubject;
  entry?: ContentEntry;
  seekWindow?: Readonly<{startSeconds: number; endSeconds: number}>;
  capabilities: Readonly<{play: boolean; pause: boolean; stop: boolean; seek: boolean; previous: boolean; next: boolean; cast: boolean}>;
}>;

/** TV video has no collapsed state. Audio folds away; phones retain their video dock. */
export function nativeShellBackTransition(dock: PlaybackDock, snapshot: Pick<NativeShellPlaybackSnapshot, 'authority' | 'fence' | 'dock'>, authority: ShellAuthority, isTV: boolean): DockTransition | undefined {
  if (!sameAuthority(snapshot.authority, authority) || !snapshot.fence || !snapshot.dock.local?.expanded || !sameFence(snapshot.dock.local.fence, snapshot.fence)) return undefined;
  const video = snapshot.dock.local.kind === 'video' || snapshot.dock.local.kind === 'live';
  return isTV && video ? dock.close(snapshot.fence) : dock.collapse(snapshot.fence);
}
export type NativeShellSurfaceProps = Readonly<{
  /** Window coordinates measured from the actual art slot; undefined until mounted/measured. */
  dockBounds?: NativeShellBounds;
  expandedBounds: NativeShellBounds;
  docked: boolean;
  subtitlesVisible: boolean;
  /** Producer composition only; false only while a current-fence real snapshot covers it. */
  surfaceActive: boolean;
}>;

/** Shell contract for the genuine platform runtime. No engine/session state is synthesized here.
 * Mount Surface exactly once above destinations. The dock positions that same surface; it never
 * receives a second video view or clones/reparents a mounted native player. */
export interface NativeShellPlaybackAdapter {
  dock: PlaybackDock;
  subscribe: (listener: () => void) => () => void;
  getSnapshot: () => NativeShellPlaybackSnapshot;
  start: (input: NativeShellPlaybackStart) => Promise<void>;
  selectionPlayback: (isCurrent: (context: SelectionContext) => boolean) => HomeSelectionPlaybackPort;
  onTransition: (transition: DockTransition) => Promise<void>;
  restoreBookmark: (expectedBookmarkFence: PlaybackFence, playExplicitly: boolean) => Promise<PlaybackFence | undefined>;
  Surface: ComponentType<NativeShellSurfaceProps>;
  captureVideoSnapshot: (fence: PlaybackFence, options?: {signal?: AbortSignal}) => Promise<NativeShellVideoSnapshot>;
  toggle: (fence: PlaybackFence) => Promise<void>;
  replay: (fence: PlaybackFence) => Promise<void>;
  seek: (fence: PlaybackFence, seconds: number) => Promise<void>;
  skip: (fence: PlaybackFence, seconds: number) => Promise<void>;
  previous: (fence: PlaybackFence) => Promise<void>;
  next: (fence: PlaybackFence) => Promise<void>;
  cast?: (fence: PlaybackFence) => Promise<void>;
  stop: (fence: PlaybackFence) => Promise<void>;
  open: (fence: PlaybackFence) => void;
}
