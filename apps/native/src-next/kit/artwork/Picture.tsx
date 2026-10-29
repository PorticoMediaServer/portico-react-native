import React, {useSyncExternalStore} from 'react';
import {Image, type ImageProps, type ImageResizeMode} from 'react-native';
import {pictureEngine, subscribePictureEngine} from '../../platform/picture-engine';

/** The one element artwork draws a picture with. Callers use React Native's Image props; on the
 * expo-image engine they are translated here (fit, no fade, load size, errors), so the artwork
 * pipeline's sizing, queueing and arrival stay the same on both. */
export type PictureProps = ImageProps & {resizeMultiplier?: number};

// RN 0.83's ImageProps.js and Android native Image both support resizeMultiplier; its bundled
// Image.d.ts omits it. This aliases the same Image host.
const NativeImage = Image as React.ComponentType<PictureProps>;
const fits: Record<ImageResizeMode, 'cover' | 'contain' | 'fill' | 'none'> = {cover: 'cover', contain: 'contain', stretch: 'fill', center: 'none', repeat: 'cover', none: 'none'};

type ExpoImageEvent = {source: {width: number; height: number; url: string}};
type ExpoImageModule = {Image: React.ComponentType<Record<string, unknown>>};
let expoImage: ExpoImageModule | undefined;
// Loaded on first use: televisions and Vega never load the package.
const loadExpoImage = () => expoImage ??= require('expo-image') as ExpoImageModule;

export function Picture(props: PictureProps) {
  const engine = useSyncExternalStore(subscribePictureEngine, pictureEngine, pictureEngine);
  if (engine === 'react-native') return <NativeImage {...props}/>;
  const {source, resizeMode, blurRadius, onLoad, onError, accessible, accessibilityLabel, style, testID} = props;
  const ExpoImage = loadExpoImage().Image;
  const single = Array.isArray(source) ? source[0] : source;
  return <ExpoImage testID={testID} style={style} accessible={accessible} accessibilityLabel={accessibilityLabel}
    source={typeof single === 'object' && single ? {uri: single.uri, headers: single.headers, width: single.width, height: single.height} : single}
    contentFit={fits[resizeMode ?? 'cover']} transition={0} blurRadius={blurRadius} cachePolicy="memory-disk" allowDownscaling
    onLoad={onLoad ? (event: ExpoImageEvent) => onLoad({nativeEvent: {source: {width: event.source.width, height: event.source.height, uri: event.source.url}}} as never) : undefined}
    onError={onError ? () => onError({nativeEvent: {error: 'load_failed'}} as never) : undefined}/>;
}
