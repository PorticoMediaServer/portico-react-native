import React from 'react';
import {Text, type TextStyle, type StyleProp} from 'react-native';
import {BottomSheet} from '../overlays/BottomSheet';
import {fontFamilies, useTheme} from '../theme';
import type {SurfaceProps} from '../overlays/types';

export function SelectionText({children, size, weight = 500, secondary = false, numberOfLines, style}: {children: React.ReactNode; size?: number; weight?: 400 | 500 | 600 | 700 | 800; secondary?: boolean; numberOfLines?: number; style?: StyleProp<TextStyle>}) {
  const theme = useTheme();
  return <Text numberOfLines={numberOfLines} ellipsizeMode="tail" style={[{fontFamily: fontFamilies[weight], fontSize: size === undefined ? theme.isTV ? theme.type.body.fontSize : 14 * theme.textScale : size * theme.textScale, color: secondary ? theme.colors.textTertiary : theme.colors.text}, style]}>{children}</Text>;
}
export function SelectionSurface({fullHeight = false, scrollable = true, headerContext, headerAction, ...props}: SurfaceProps & {fullHeight?: boolean; scrollable?: boolean; headerContext?: React.ReactNode; headerAction?: React.ReactNode}) {
  const {isTV} = useTheme();
  return <BottomSheet {...props} width={isTV ? 680 : undefined} footer={props.footer ?? <></>} headerAction={headerAction ?? <></>} scrollable={scrollable} headerContext={headerContext} titleType={{size: isTV ? 46 : fullHeight ? 24 : 20, weight: 800, tracking: fullHeight ? -.03 : -.02, lineHeight: 'normal'}} descriptionTextStyle={{fontSize: isTV ? 22 : fullHeight ? 13 : 13.5, lineHeight: isTV ? 33 : fullHeight ? 18.85 : 19.575}} detents={fullHeight ? [800] : undefined} fitContent={!fullHeight} />;
}
