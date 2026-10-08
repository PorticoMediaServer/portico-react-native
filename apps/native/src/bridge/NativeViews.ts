import { requireNativeComponent, type ViewProps } from 'react-native';
export const NativePlayer = requireNativeComponent<
  ViewProps & {
    lease: string;
    /** Changes arrive as the playback module's `PorticoPictureInPicture` event ({lease, state,
     * subtitlesCarried}), not a view event: see VideoPlayer. */
    pictureInPictureRequest?: number;
  }
>('PorticoPlayer');

export const AudioRoutePicker = requireNativeComponent<ViewProps & {video?: boolean}>(
  'PorticoAudioRoutePicker',
);

/** The system volume slider (iPhone/iPad). Renders nothing on television. */
export const VolumeSlider = requireNativeComponent<ViewProps>('PorticoVolumeView');

