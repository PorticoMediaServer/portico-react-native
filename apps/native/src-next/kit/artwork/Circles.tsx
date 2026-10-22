import React from 'react';
import {StyleSheet, Text, View} from 'react-native';
import Svg, {Defs, RadialGradient, Rect, Stop} from 'react-native-svg';
import {fontFamilies, useTheme} from '../theme';
import {Artwork} from './Artwork';
import {PaletteWash} from './Surfaces';
import {boundedCovers} from './model';
import type {CircleArtProps, PersonCircleProps} from './types';

function CircleBase({size}: {size: number}) {
  const {colors} = useTheme();
  return <Svg accessible={false} pointerEvents="none" width={size} height={size} style={StyleSheet.absoluteFillObject}>
    <Defs><RadialGradient id="circle-base" cx="30%" cy="25%" r="90%"><Stop offset="0" stopColor={colors.raisedBright}/><Stop offset="1" stopColor={colors.raised}/></RadialGradient></Defs>
    <Rect width="100%" height="100%" fill="url(#circle-base)"/>
  </Svg>;
}

/** Bounded own-album samples, supplied by the caller's actual content entry. */
export function CircleArt({covers, initials, alt, size = 100, visible = true, style}: CircleArtProps) {
  const {colors} = useTheme();
  const samples = boundedCovers(covers, 4);
  return <View accessible={Boolean(alt)} accessibilityRole={alt ? 'image' : undefined} accessibilityLabel={alt} style={[{width: size, height: size, borderRadius: size / 2, overflow: 'hidden', backgroundColor: colors.raised}, style]}>
    <CircleBase size={size}/>
    {samples.length === 1 ? <Artwork source={samples[0]} visible={visible} zoom={1.22}/> : samples.map((source, index) => {
      const half = (size - 2) / 2;
      const split = samples.length === 2;
      return <Artwork key={`${source.cacheKey}-${index}`} source={source} visible={visible} width={half} height={split ? size : half}
        style={{position: 'absolute', left: index % 2 ? half + 2 : 0, top: index > 1 ? half + 2 : 0}}
        zoom={split ? 1.5 : 1} position={split ? {x: index ? 0.6 : 0.3, y: 0.5} : undefined}/>;
    })}
    {!samples.length && initials ? <Text accessible={false} allowFontScaling={false} style={{position: 'absolute', width: size, top: 0, bottom: 0, textAlign: 'center', textAlignVertical: 'center', fontFamily: fontFamilies[800], fontSize: size * 0.3125, lineHeight: size, color: colors.textSecondary, letterSpacing: -size * 0.015}}>{initials}</Text> : null}
    <View pointerEvents="none" style={[StyleSheet.absoluteFillObject, {borderRadius: size / 2, borderWidth: 1, borderColor: colors.text, opacity: 0.12}]}/>
  </View>;
}

export function ArtistCircle(props: CircleArtProps) {return <CircleArt {...props}/>;}

/** Real portraits when supplied; authors otherwise keep initials over only their own covers. */
export function PersonCircle({source, covers = [], ambientCovers = [], palette, initials, alt, size = 96, visible = true, style}: PersonCircleProps) {
  const {colors, isTV} = useTheme();
  const samples = boundedCovers(isTV ? ambientCovers : covers, 4);
  return <View accessible={Boolean(alt)} accessibilityRole={alt ? 'image' : undefined} accessibilityLabel={alt} style={[{width: size, height: size, borderRadius: size / 2, overflow: 'hidden', backgroundColor: colors.raised}, style]}>
    <CircleBase size={size}/>
    {palette ? <PaletteWash palette={palette}/> : null}
    {samples.length ? <View style={[StyleSheet.absoluteFillObject, {left: -size * 0.25, right: -size * 0.25, top: -size * 0.25, bottom: -size * 0.25, flexDirection: 'row'}]}>
      {samples.map((cover, i) => <View key={`${cover.cacheKey}-${i}`} style={{flex: 1}}><Artwork source={cover} visible={visible} sized={isTV} blurRadius={isTV ? undefined : 20} filter={isTV ? undefined : [{saturate: 1.5}, {brightness: 0.56}]} imageStyle={isTV ? {opacity: 0.56} : undefined}/></View>)}
    </View> : null}
    {samples.length ? <View pointerEvents="none" style={[StyleSheet.absoluteFillObject, {backgroundColor: colors.ink, opacity: 0.34}]}/> : null}
    <View style={[StyleSheet.absoluteFillObject, {alignItems: 'center', justifyContent: 'center'}]}><Text accessible={false} allowFontScaling={false} style={{fontFamily: fontFamilies[800], fontSize: size * (samples.length ? 50 / 172 : 30 / 96), letterSpacing: -size * 0.0145, color: samples.length ? colors.text : colors.textSecondary}}>{initials}</Text></View>
    {source ? <Artwork source={source} visible={visible} fallback={null}/> : null}
    <View pointerEvents="none" style={[StyleSheet.absoluteFillObject, {borderRadius: size / 2, borderWidth: 1, borderColor: colors.text, opacity: 0.12}]}/>
  </View>;
}
