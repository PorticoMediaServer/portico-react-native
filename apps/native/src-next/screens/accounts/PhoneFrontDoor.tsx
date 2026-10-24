import React from 'react';
import {Image, ScrollView, Text, View} from 'react-native';
import {useSafeAreaInsets} from 'react-native-safe-area-context';
import {defaultI18n} from '../../../../../packages/i18n/src';
import {ColourBackdrop} from '../../kit/artwork';
import {Button} from '../../kit/controls';
import {nativeType, useTheme} from '../../kit/theme';

/** Connect 39a. The account owner supplies the two genuine entry commands. */
export function PhoneFrontDoor({busy, error, onPortico, onLocal}: {
  busy: boolean; error?: React.ReactNode; onPortico: () => void; onLocal: () => void;
}) {
  const theme = useTheme(), insets = useSafeAreaInsets(), t = defaultI18n.t;
  return <View testID="accounts-welcome" style={{flex: 1, backgroundColor: theme.colors.ink}}>
    <ColourBackdrop shape="top"/>
    <ScrollView style={{flex: 1}} contentContainerStyle={{flexGrow: 1, paddingHorizontal: 22, paddingTop: Math.max(70, insets.top)}}>
      <Image source={require('../../../assets/wordmark.png')} accessibilityLabel={t('accounts.brand')} resizeMode="contain"
        style={{width: 17 * 512 / 117, height: 17, alignSelf: 'flex-start'}}/>
      <View style={{marginTop: 'auto', paddingTop: 32, paddingBottom: Math.max(66, insets.bottom + 32), gap: 10}}>
        <Text accessibilityRole="header" style={[nativeType({size: 42, lineHeight: 43.68, weight: 800, tracking: -.04}, theme.textScale),
          {includeFontPadding: false, color: theme.colors.text, marginBottom: 22}]}>{t('web.signin.welcomeHome')}</Text>
        {error}
        <Button testID="accounts-welcome-portico" disabled={busy} loading={busy || undefined} onPress={onPortico}
          style={{alignSelf: 'stretch', height: 48, borderRadius: 11, paddingHorizontal: 20}} textStyle={{fontSize: 16 * theme.textScale}}>{t('accounts.signIn.portico')}</Button>
        <Button testID="accounts-welcome-local" variant="glass" disabled={busy} onPress={onLocal}
          style={{alignSelf: 'stretch', height: 48, borderRadius: 11, paddingHorizontal: 20}} textStyle={{fontSize: 16 * theme.textScale}}>{t('accounts.signIn.local')}</Button>
      </View>
    </ScrollView>
  </View>;
}
