import React from 'react';
import {requireNativeComponent, type ViewProps} from 'react-native';
import {useI18n} from '../app/i18n';

export const NativePlayer = requireNativeComponent<ViewProps & {
  lease: string;
  pictureInPictureRequest?: number;
}>('PorticoPlayer');

type RoutePickerProps = ViewProps & {video?: boolean};
const RoutePicker = requireNativeComponent<RoutePickerProps>('PorticoAudioRoutePicker');
const VolumeView = requireNativeComponent<ViewProps>('PorticoVolumeView');

/** App labels come from the viewer's catalogue; inner system controls use the OS locale. */
export function AudioRoutePicker(props: RoutePickerProps) {
  const i18n = useI18n();
  return React.createElement(RoutePicker, {...props, accessibilityLabel: props.accessibilityLabel ?? i18n.t('playOn.airplay')});
}

export function VolumeSlider(props: ViewProps) {
  const i18n = useI18n();
  return React.createElement(VolumeView, {...props, accessibilityLabel: props.accessibilityLabel ?? i18n.t('player.volume')});
}
