// The Vega counterpart of `apps/native/src-next/kit/artwork/Picture.tsx`: Vega keeps React Native's
// Image, so expo-image is never bundled here.
import React from 'react';
import {Image, type ImageProps} from 'react-native';

export type PictureProps = ImageProps & {resizeMultiplier?: number};

const NativeImage = Image as React.ComponentType<PictureProps>;

export function Picture(props: PictureProps) {
  return <NativeImage {...props}/>;
}
