import React from 'react';
import {Image, Text, View, useWindowDimensions} from 'react-native';
import {defaultI18n} from '../../../../../packages/i18n/src';
import {ColourBackdrop} from '../../kit/artwork';
import {nativeType, useTheme} from '../../kit/theme';
import {shellLayout} from '../../shell/model';

/** Auth8/9's column and colour-only backdrop; composition is authorized by ruling28. */
export function TVAuthLayout({heading, eyebrow, body, children, portico, aside, testID}: {
  heading: string; eyebrow?: string; body: React.ReactNode; children: React.ReactNode;
  portico: boolean; aside?: React.ReactNode; testID: string;
}) {
  const theme = useTheme(), window = useWindowDimensions(), canvas = shellLayout(window.width, window.height, true);
  return <View testID={testID} style={{flex: 1, backgroundColor: theme.colors.ink}}>
    <View style={{position: 'absolute', left: canvas.left, top: canvas.top, width: canvas.width, height: canvas.height,
      transformOrigin: 'top left', transform: [{scale: canvas.scale}]}}>
      <ColourBackdrop shape="side" fill/>
      <View style={{position: 'absolute', left: 120, top: 0, bottom: 0, width: 900, justifyContent: 'center'}}>
        <Image source={require('../../../assets/wordmark.png')} accessibilityLabel={defaultI18n.t('accounts.brand')}
          resizeMode="contain" style={{position: 'absolute', left: 0, top: 72, width: 174, height: 40}}/>
        {eyebrow && <Text style={[nativeType({size: 22, weight: 700, tracking: .1, lineHeight: 'normal'}, theme.textScale), {color: theme.colors.textTertiary, marginBottom: 14}]}>{eyebrow}</Text>}
        <Text accessibilityRole="header" style={[nativeType({size: 72, weight: 800, tracking: -.045, lineHeight: 1}, theme.textScale), {color: theme.colors.text, marginBottom: 22}]}>{heading}</Text>
        <Text style={[nativeType({size: 26, weight: 400, tracking: 0, lineHeight: 1.45}, theme.textScale), {color: theme.colors.textSecondary, maxWidth: 760, marginBottom: 48}]}>{body}</Text>
        {children}
        {portico && <View style={{position: 'absolute', left: 0, bottom: 64}}>
          <Text style={[nativeType({size: 20, weight: 400, tracking: 0, lineHeight: 1.5}, theme.textScale), {color: theme.colors.textTertiary}]}>{defaultI18n.t('activation.termsNote').split('\n')[0]}</Text>
          <View style={{flexDirection: 'row', gap: 28}}>{(['accounts.legal.termsAddress', 'accounts.legal.privacyAddress'] as const).map(key => <Text key={key}
            style={[nativeType({size: 20, weight: 400, tracking: 0, lineHeight: 1.5}, theme.textScale), {color: theme.colors.textTertiary}]}>{defaultI18n.t(key)}</Text>)}</View>
        </View>}
      </View>
      {aside}
    </View>
  </View>;
}
