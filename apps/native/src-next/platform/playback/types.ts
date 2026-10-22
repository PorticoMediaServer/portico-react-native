import type {ComponentType} from 'react';
import type {HttpLocalApi, LocalSession, PlaybackSnapshot} from '../../../../../packages/client-core/src/index';
import type {ContentEntry} from '../../../../../packages/client-core/src/library-content';
import type {EventsClient} from '../../../../../packages/client-core/src/playback-v1/events';
import type {PlaybackOptions, Session} from '../../../../../packages/client-core/src/playback-v1/types';
import type {QueuePlayerState} from '../../../../../packages/client-core/src/queue-controller';
import type {PlaybackSubject} from '../../../../../packages/client-core/src/presentation/kit-model';
import type {SubtitleSnapshot} from '../../../../../packages/client-core/src/subtitles';
import type {CapabilityOverrides} from '../../../../../packages/client-core/src/client-profile';
import type {DockState, DockTransition, PlaybackDock, PlaybackFence} from '../../../../../packages/player-core/src';
import type {SkipMode} from '../../../../../packages/player-core/src';
import type {EngineFeatures, EngineKind, EngineSetting} from './engine-choice';
import type {EngineSelection, NativePlaybackTransport} from './NativePlaybackCoordinator';
import type {NativeListeningV1Control} from '../../../../../packages/client-core/src/playback/native-listening';
import type {Timers} from '../../../../../packages/client-core/src/playback-v1/sessions';
import type {HomeSelectionPlaybackPort} from '../../../../../packages/client-core/src/home-selection/types';
import type {SelectionContext} from '../../../../../packages/client-core/src/selection-model/index';

export type PlaybackAuthority = Readonly<{serverId: string; accountId: string; profileId: string; epoch: string; viewerFence: string}>;
export type NativePlaybackStart = Readonly<{entry: ContentEntry; target: NonNullable<ContentEntry['playback']>; origin?: Readonly<{kind: 'home-row'; rowId: string}>}>;
export type NativePlaybackBounds = Readonly<{x: number; y: number; width: number; height: number}>;
export type NativePlaybackSurfaceProps = Readonly<{dockBounds?: NativePlaybackBounds; expandedBounds: NativePlaybackBounds; docked: boolean; subtitlesVisible: boolean}>;
export type NativePlaybackVideoSnapshot = Readonly<{fence: PlaybackFence; image: Readonly<{uri: string; width: number; height: number}>; release: () => Promise<void>}>;
export type NativePlaybackSettings = Readonly<{
  engine: EngineSetting; overrides?: CapabilityOverrides;
  videoRate: number; audiobookRate: number;
  skips: Readonly<Record<'intro' | 'recap' | 'credits', SkipMode>>;
  subtitleSize: 'small' | 'medium' | 'large' | 'extra-large';
  subtitleBackground: 'none' | 'translucent' | 'opaque';
}>;
export type NativePlaybackCapabilities = Readonly<{play: boolean; pause: boolean; stop: boolean; seek: boolean; previous: boolean; next: boolean; cast: boolean; quality: boolean; version: boolean; audioTrack: boolean; subtitleTrack: boolean; subtitlesCanHide: boolean}>;
export type NativePlaybackRuntimeSnapshot = Readonly<{
  authority: PlaybackAuthority; sequence: number; dock: DockState; playback: PlaybackSnapshot;
  fence?: PlaybackFence; subject?: PlaybackSubject; entry?: ContentEntry;
  queue: QueuePlayerState; session?: Session; options?: PlaybackOptions; subtitles?: SubtitleSnapshot;
  seekWindow?: Readonly<{startSeconds: number; endSeconds: number}>;
  capabilities: NativePlaybackCapabilities; engine: EngineKind; lease: string;
  effectiveRate: number; supportedRates: readonly number[];
  retired: boolean;
}>;

/** One authority lifetime. Supply the shell's existing feed; the runtime never opens another. */
export type NativePlaybackRuntimeOptions = Readonly<{
  api: HttpLocalApi;
  authority: () => PlaybackAuthority;
  session: () => LocalSession | undefined;
  subscribeAuthority: (listener: () => void) => () => void;
  events: Pick<EventsClient, 'on' | 'onResync'>;
  settings: () => NativePlaybackSettings;
  subscribeSettings: (listener: () => void) => () => void;
  requestId: () => string;
  transport: NativePlaybackTransport;
  engines: EngineSelection;
  engineFeatures: (engine: EngineKind) => EngineFeatures;
  nativeListening?: NativeListeningV1Control;
  capabilitiesReady: () => Promise<void>;
  disposeCapabilities: () => void;
  timers?: Timers;
  /** Optional actual destination binding. Its absence removes Cast from capabilities and API. */
  openDestinations?: (fence: PlaybackFence) => Promise<void>;
}>;

export interface NativePlaybackAdapter {
  dock: PlaybackDock;
  subscribe: (listener: () => void) => () => void;
  getSnapshot: () => NativePlaybackRuntimeSnapshot;
  start: (input: NativePlaybackStart) => Promise<void>;
  selectionPlayback: (isCurrent: (context: SelectionContext) => boolean) => HomeSelectionPlaybackPort;
  onTransition: (transition: DockTransition) => Promise<void>;
  Surface: ComponentType<NativePlaybackSurfaceProps>;
  captureVideoSnapshot: (fence: PlaybackFence, options?: {signal?: AbortSignal}) => Promise<NativePlaybackVideoSnapshot>;
  toggle: (fence: PlaybackFence) => Promise<void>;
  replay: (fence: PlaybackFence) => Promise<void>;
  seek: (fence: PlaybackFence, seconds: number) => Promise<void>;
  skip: (fence: PlaybackFence, seconds: number) => Promise<void>;
  previous: (fence: PlaybackFence) => Promise<void>;
  next: (fence: PlaybackFence) => Promise<void>;
  cast?: (fence: PlaybackFence) => Promise<void>;
  stop: (fence: PlaybackFence) => Promise<void>;
  restoreBookmark: (expectedBookmarkFence: PlaybackFence, playExplicitly: boolean) => Promise<PlaybackFence | undefined>;
  open: (fence: PlaybackFence) => void;
  dispose: () => void;
}
