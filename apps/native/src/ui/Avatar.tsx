import React, {useEffect, useState} from 'react';
import {Image, View, type ImageSourcePropType} from 'react-native';
import {profileArtColors} from '../../../../packages/design/src/index';
import {Text, useTheme} from './index';

type Art = keyof typeof profileArtColors;
const isArt = (value: unknown): value is Art => typeof value === 'string' && value in profileArtColors;

/**
 * One avatar primitive (CON-12): the picture, or the initial on the
 * profile's art color. Sizes 24/32/40/64.
 */
export function Avatar({source, name, art, size = 32}: {source?: ImageSourcePropType; name: string; art?: string; size?: 24 | 32 | 40 | 64}) {
  const {colors} = useTheme();
  const [failed, setFailed] = useState(false);
  useEffect(() => setFailed(false), [source]);
  return (
    <View style={{width: size, height: size, borderRadius: size / 2, overflow: 'hidden', backgroundColor: isArt(art) ? profileArtColors[art] : colors.raisedHigh, alignItems: 'center', justifyContent: 'center'}}>
      <Text variant="captionStrong">{name.slice(0, 1).toUpperCase()}</Text>
      {source && !failed ? <Image source={source} onError={() => setFailed(true)} accessibilityIgnoresInvertColors style={{position: 'absolute', top: 0, left: 0, width: size, height: size}} resizeMode="cover" /> : null}
    </View>
  );
}
