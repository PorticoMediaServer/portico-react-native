import type React from 'react';
import type {StyleProp, View, ViewStyle} from 'react-native';
import type {SharedValue} from 'react-native-reanimated';
import type {PanGesture} from 'react-native-gesture-handler';
import type {DockPlayback, DockState, PlaybackDock, PlaybackFence, RemoteDock} from '../../../../../packages/player-core/src/index';
import type {FactPart, PlaybackIdentityModel} from '../../../../../packages/client-core/src/presentation/kit-model/index';
import type {ArtworkSource, AmbientArtSource, ArtworkPalette} from '../artwork';

export type DockRect = Readonly<{x: number; y: number; width: number; height: number}>;
/** A settled ancestor transform, valid only for its current presence lifetime. */
export type DockSlotAdmission = Readonly<{isCurrent: () => boolean}>;
export type DockAction = 'expand' | 'collapse' | 'close' | 'stop' | 'play' | 'pause' | 'replay' | 'seek' | 'previous' | 'next' | 'cast' | 'open-remote' | 'continue-here' | 'dismiss-remote' | 'restore-audio' | 'restore-video';
export type DockCommand = Readonly<{
  type: DockAction;
  fence: PlaybackFence;
  remote?: Readonly<{id: string; sequence: string}>;
  positionSeconds?: number;
}>;
/** Capabilities are the adapter's current allowed controls, including queue/chapter boundaries. */
export type DockCapabilities = Readonly<{
  play: boolean; pause: boolean; stop: boolean; seek: boolean;
  previous: boolean; next: boolean; cast: boolean;
}>;
export type DockPresentation = Readonly<{
  fence: PlaybackFence;
  identity: PlaybackIdentityModel;
  album?: readonly FactPart[];
  artwork?: ArtworkSource;
  ambient?: AmbientArtSource;
  palette?: ArtworkPalette;
  durationSeconds?: number;
  /** Actual seekable window; a live dock uses the rewind window, not a fabricated programme range. */
  seekWindow?: Readonly<{start: number; end: number}>;
  finished?: boolean;
  previousLabel?: string;
  nextLabel?: string;
  skipBackSeconds: number;
  capabilities: DockCapabilities;
  device?: string;
}>;
export type DockOccupant = Readonly<{
  mode: 'video' | 'music' | 'audiobook' | 'cast' | 'play-on';
  playback: DockPlayback;
  remote?: RemoteDock;
  presentation: DockPresentation;
}>;
export type DockRenderProps = {
  occupant: DockOccupant;
  onAction: (command: DockCommand) => void;
  visible?: boolean;
  style?: StyleProp<ViewStyle>;
  testID?: string;
};
export type PlayerMorphController = {
  progress: SharedValue<number>;
  velocity: SharedValue<number>;
  dragging: SharedValue<boolean>;
  releaseVelocity: SharedValue<number>;
  request: (docked: boolean, velocity?: number) => void;
  /** Shared ancestor motion for video chrome AND its retained native picture. */
  dockMotionHosted: boolean;
  dockX: SharedValue<number>;
  dockFade: SharedValue<number>;
  /** Each physical detector owns a distinct RNGH instance. */
  gesture: PanGesture;
  dockGesture: PanGesture;
};
export type DockHostProps = {
  testID?: string;
  dock: PlaybackDock;
  snapshot: DockState;
  presentation: Readonly<{local?: DockPresentation; remote?: DockPresentation}>;
  onAction: (command: DockCommand) => void;
  bottomInset?: number;
  visible?: boolean;
  tvExpanded?: boolean;
  onTVExpandedChange?: (expanded: boolean) => void;
  returnFocusRef?: React.RefObject<View | null>;
  onVideoSlot?: (rect: DockRect) => void;
  morph?: PlayerMorphController;
  notice?: DockNoticeModel;
  onNoticeDismiss?: () => void;
  style?: StyleProp<ViewStyle>;
};
export type DockNoticeModel = Readonly<{
  id: string;
  kind: 'paused-audio' | 'stopped-video';
  fence: PlaybackFence;
  identity: PlaybackIdentityModel;
  positionSeconds: number;
}>;
