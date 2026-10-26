import React from 'react';
import {Image, Linking, ScrollView, Text, View} from 'react-native';
import {useSafeAreaInsets} from 'react-native-safe-area-context';
import {defaultI18n} from '../../../../../packages/i18n/src';
import type {IdentityOptions} from '../../../../../packages/client-core/src/hosted-security';
import {ColourBackdrop} from '../../kit/artwork';
import {Button, TextField} from '../../kit/controls';
import {nativeType, useTheme} from '../../kit/theme';

type Provider = IdentityOptions['providers'][number];

/** auth.html frame 4. The direct phone/tablet/fold Portico Account surface. */
export function PhoneAccountSignIn({busy, error, providers, passwordEnabled, registration, recovery, username, password,
  onUsernameChange, onPasswordChange, onContinue, onProvider, onForgot, onCreate, onLocal}: {
  busy: boolean; error?: React.ReactNode; providers: readonly Provider[]; passwordEnabled: boolean;
  registration: boolean; recovery: boolean; username: string; password: string;
  onUsernameChange: (value: string) => void; onPasswordChange: (value: string) => void;
  onContinue: () => void; onProvider: (id: Provider['id']) => void; onForgot: () => void; onCreate: () => void; onLocal: () => void;
}) {
  const theme = useTheme(), insets = useSafeAreaInsets(), t = defaultI18n.t;
  const ordered = [...providers].sort((a, b) => a.id === 'apple' ? -1 : b.id === 'apple' ? 1 : 0);
  const label = (value: string) => <Text style={{fontSize: 13 * theme.textScale, fontWeight: '600', color: theme.colors.textSecondary}}>{value}</Text>;
  return <View testID="accounts-welcome" style={{flex: 1, backgroundColor: theme.colors.ink}}>
    <ColourBackdrop shape="top"/>
    <ScrollView keyboardShouldPersistTaps="handled" keyboardDismissMode="on-drag"
      contentContainerStyle={{flexGrow: 1, paddingHorizontal: 22, paddingTop: Math.max(70, insets.top), paddingBottom: Math.max(42, insets.bottom)}}>
      <View style={{width: '100%', maxWidth: 520, alignSelf: 'center', flexGrow: 1}}>
        <Image source={require('../../../assets/wordmark.png')} accessibilityLabel={t('accounts.brand')} resizeMode="contain"
          style={{width: 17 * 512 / 117, height: 17, alignSelf: 'flex-start'}}/>
        <Text accessibilityRole="header" style={[nativeType({size: 34, lineHeight: 35.36, weight: 800, tracking: -.04}, theme.textScale),
          {color: theme.colors.text, marginTop: 46, marginBottom: 8, includeFontPadding: false}]}>{t('web.signin.welcomeHome')}</Text>
        <Text style={[nativeType({size: 14.5, lineHeight: 21.75, weight: 400}, theme.textScale), {color: theme.colors.textSecondary, marginBottom: 20}]}>{t('auth.accountLead')}</Text>
        {error}
        {!!ordered.length && <View style={{gap: 10, marginBottom: 0}}>
          {ordered.map(value => <Button key={value.id} variant="text" icon={value.id === 'google' ? 'i-google' : 'i-apple'} iconSize={19} iconColor={value.id === 'google' ? undefined : '#fff'} testID={`accounts-auth-${value.id}`} disabled={busy}
            style={{height: 48, borderRadius: 11, borderWidth: 1, borderColor: value.id === 'google' ? '#5f6368' : 'rgba(237,245,250,.22)',
              backgroundColor: value.id === 'google' ? '#131314' : '#000'}}
            textStyle={{fontSize: 16 * theme.textScale, fontWeight: '700', color: value.id === 'google' ? '#e3e3e3' : '#fff'}}
            onPress={() => {if (!busy) onProvider(value.id);}}>{t(value.id === 'google' ? 'auth.signInWithGoogle' : 'auth.signInWithApple')}</Button>)}
        </View>}
        {passwordEnabled && <>
          <View style={{flexDirection: 'row', alignItems: 'center', gap: 14, marginTop: 4, marginBottom: 14}}>
            <View style={{flex: 1, height: 1, backgroundColor: theme.colors.line}}/>
            <Text style={[nativeType({size: 13, lineHeight: 19.5, weight: 600}, theme.textScale), {color: theme.colors.textTertiary}]}>{t('auth.orWithEmail')}</Text>
            <View style={{flex: 1, height: 1, backgroundColor: theme.colors.line}}/>
          </View>
          <View style={{gap: 12}}>
            <TextField testID="accounts-auth-username" accessibilityLabel={t('auth.usernameOrEmail')} label={label(t('auth.usernameOrEmail'))} value={username} onChangeText={onUsernameChange} editable={!busy}
              textContentType="username" autoComplete="username" autoCapitalize="none" autoCorrect={false}
              fieldStyle={{height: 48, borderRadius: 11, paddingHorizontal: 14}}/>
            <TextField testID="accounts-auth-password" accessibilityLabel={t('auth.password')} label={label(t('auth.password'))} value={password} onChangeText={onPasswordChange} editable={!busy}
              secureTextEntry textContentType="password" autoComplete="current-password" autoCapitalize="none" autoCorrect={false}
              fieldStyle={{height: 48, borderRadius: 11, paddingHorizontal: 14}}/>
          </View>
          <Button testID="accounts-auth-continue" variant="primary" disabled={busy || !username || !password} style={{height: 48, borderRadius: 11, marginTop: 12}}
            textStyle={{fontSize: 16 * theme.textScale, fontWeight: '700'}} onPress={() => {if (!busy && username && password) onContinue();}}>{t('action.continue')}</Button>
          <View style={{flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 20, marginTop: 14}}>
            {recovery && <Button testID="accounts-auth-forgot" variant="text" size="compact" disabled={busy} textStyle={{fontSize: 14 * theme.textScale, fontWeight: '700'}} onPress={onForgot}>{t('auth.forgotPassword')}</Button>}
            {registration && <Button testID="accounts-auth-create" variant="text" size="compact" disabled={busy} textStyle={{fontSize: 14 * theme.textScale, fontWeight: '700'}} onPress={onCreate}>{t('auth.createAccount')}</Button>}
          </View>
        </>}
        <Button testID="accounts-auth-local" variant="text" size="compact" disabled={busy} style={{marginTop: 10}} textStyle={{fontSize: 14 * theme.textScale, fontWeight: '700', color: theme.colors.textSecondary}}
          onPress={onLocal}>{t('auth.signInDirectly')}</Button>
        <Text style={[nativeType({size: 12, lineHeight: 18, weight: 400}, theme.textScale), {color: theme.colors.textTertiary, textAlign: 'center', marginTop: 'auto', paddingTop: 24}]}>
          {t('auth.agreeToTerms')}{' '}
          <Text accessibilityRole="link" suppressHighlighting onPress={() => {void Linking.openURL('https://getportico.tv/terms').catch(() => {});}}
            style={{color: theme.colors.accentStrong}}>{t('auth.terms')}</Text>{t('list.and', {first: '', second: ''})}
          <Text accessibilityRole="link" suppressHighlighting onPress={() => {void Linking.openURL('https://getportico.tv/privacy').catch(() => {});}}
            style={{color: theme.colors.accentStrong}}>{t('auth.privacyPolicy')}</Text>.
        </Text>
      </View>
    </ScrollView>
  </View>;
}
