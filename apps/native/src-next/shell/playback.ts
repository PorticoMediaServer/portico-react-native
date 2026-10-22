import type {ComponentType} from 'react';
import type {PlaybackSnapshot} from '../../../../packages/client-core/src/index';
import type {ContentEntry} from '../../../../packages/client-core/src/library-content';
import type {PlaybackSubject} from '../../../../packages/client-core/src/presentation/kit-model';
import type {DockState, DockTransition, PlaybackDock, PlaybackFence} from '../../../../packages/player-core/src';
import type {ShellAuthority} from './model';

export type NativeShellPlaybackStart = Readonly<{
  /** The real display record and the server-selected target stay separate for show continuations. */
  entry: ContentEntry;
  target: NonNullable<ContentEntry['playback']>;
  origin?: Readonly<{kind: 'home-row'; rowId: string}>;
}>;
export type NativeShellBounds = Readonly<{x: number; y: number; width: number; height: number}>;
export type NativeShellPlaybackSnapshot = Readonly<{
  authority: ShellAuthority;
  dock: DockState;
  playback: PlaybackSnapshot;
  fence?: PlaybackFence;
  subject?: PlaybackSubject;
  entry?: ContentEntry;
  capabilities: Readonly<{play: boolean; pause: boolean; stop: boolean; seek: boolean; previous: boolean; next: boolean; cast: boolean}>;
}>;
export type NativeShellSurfaceProps = Readonly<{
  /** Window coordinates measured from the actual art slot; undefined until mounted/measured. */
  dockBounds?: NativeShellBounds;
  expandedBounds: NativeShellBounds;
  docked: boolean;
  subtitlesVisible: boolean;
}>;

/** Shell contract for the genuine platform runtime. No engine/session state is synthesized here.
 * Mount Surface exactly once above destinations. The dock positions that same surface; it never
 * receives a second video view or clones/reparents a mounted native player. */
export interface NativeShellPlaybackAdapter {
  dock: PlaybackDock;
  subscribe: (listener: () => void) => () => void;
  getSnapshot: () => NativeShellPlaybackSnapshot;
  start: (input: NativeShellPlaybackStart) => Promise<void>;
  onTransition: (transition: DockTransition) => Promise<void>;
  restoreBookmark: (expectedBookmarkFence: PlaybackFence, playExplicitly: boolean) => Promise<PlaybackFence | undefined>;
  Surface: ComponentType<NativeShellSurfaceProps>;
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
