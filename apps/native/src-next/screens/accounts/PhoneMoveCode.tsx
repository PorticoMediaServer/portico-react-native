import React, {useEffect, useState, useSyncExternalStore} from 'react';
import {ScrollView, Text, View} from 'react-native';
import {useSafeAreaInsets} from 'react-native-safe-area-context';
import {defaultI18n} from '../../../../../packages/i18n/src';
import {passwordStrength} from '../../../../../packages/client-core/src/password-strength';
import {presentError} from '../../../../../packages/client-core/src/presentation/errors';
import {ColourBackdrop} from '../../kit/artwork';
import {Button, TextField} from '../../kit/controls';
import {nativeType, useTheme} from '../../kit/theme';
import type {NativeMemberAccountMove} from '../../platform/member-account-move';

/** Connect44b/c. The canonical code is a 43-character secret, not the short
 * illustrative frame data. The verified operation owns preview and redemption. */
export function PhoneMoveCode<Result>({controller, onBack, onScan}: {
  controller: NativeMemberAccountMove<Result>; onBack: () => void;
  /** Supply only a real platform scanner, after its issuing-server proof. */
  onScan?: () => void;
}) {
  const state = useSyncExternalStore(controller.subscribe, controller.getSnapshot), theme = useTheme(), insets = useSafeAreaInsets(), t = defaultI18n.t;
  const [code, setCode] = useState(''), [username, setUsername] = useState(state.username ?? '');
  const [password, setPassword] = useState(''), [confirmation, setConfirmation] = useState(''), [shown, setShown] = useState(false), [invalidCode, setInvalidCode] = useState(false);
  useEffect(() => {if (state.username !== undefined) setUsername(state.username);}, [state.username]);
  useEffect(() => {setPassword(''); setConfirmation(''); setShown(false);}, [state.phase]);
  if (state.phase !== 'code' && state.phase !== 'local') return null;
  const local = state.phase === 'local', strength = passwordStrength(password);
  const strengthKey = strength.label === 'Too short' ? 'services.password.tooShort' : strength.label === 'Too long' ? 'accounts.password.tooLong'
    : strength.label === 'Weak' ? 'accounts.password.weak' : strength.label === 'Fair' ? 'accounts.password.fair'
      : strength.label === 'Good' ? 'accounts.password.good' : 'services.password.strong';
  const submit = () => {
    if (state.busy) return;
    if (local) {
      if (!username || !strength.acceptable || password !== confirmation) return;
      const supplied = password; setPassword(''); setConfirmation(''); setShown(false);
      void controller.redeemLocal(username, supplied);
    } else {
      if (!/^[A-Za-z0-9_-]{43}$/.test(code)) {setInvalidCode(true); return;}
      const supplied = code; setCode(''); setInvalidCode(false);
      void controller.previewCode(supplied);
    }
  };
  const back = () => {if (!state.busy) {setCode(''); setPassword(''); setConfirmation(''); setShown(false); controller.cancel(); onBack();}};
  const passwordField = (confirm: boolean) => <View style={{marginBottom: 12}}>
    <Text style={[theme.type.captionStrong, {color: theme.colors.textSecondary, marginBottom: 6}]}>{t(confirm ? 'accounts.signIn.confirmPassword' : 'accounts.signIn.password')}</Text>
    <View>
      <TextField accessibilityLabel={t(confirm ? 'accounts.signIn.confirmPassword' : 'accounts.signIn.password')}
        value={confirm ? confirmation : password} onChangeText={confirm ? setConfirmation : setPassword} editable={!state.busy}
        secureTextEntry={!shown} autoCapitalize="none" autoCorrect={false} autoComplete="new-password" textContentType="newPassword"
        onSubmitEditing={confirm ? submit : undefined} returnKeyType={confirm ? 'go' : 'next'}
        fieldStyle={{height: 48, borderRadius: 11, paddingRight: confirm ? 14 : 94}} style={{fontSize: 16 * theme.textScale}}/>
      {!confirm && <Button variant="text" icon={shown ? 'i-eyeoff' : 'i-eye'} iconSize={20} disabled={state.busy}
        accessibilityState={{selected: shown}} onPress={() => setShown(value => !value)}
        style={{position: 'absolute', right: 6, top: 4, height: 40, paddingHorizontal: 8}} textStyle={{fontSize: 13 * theme.textScale}}>
        {t(shown ? 'accounts.signIn.hidePassword' : 'accounts.signIn.showPassword')}
      </Button>}
    </View>
    {!confirm && password.length > 0 && <Text style={[theme.type.caption, {marginTop: 6, color: strength.acceptable ? theme.colors.textSecondary : theme.colors.danger}]}>{t(strengthKey)}</Text>}
  </View>;
  return <View testID={local ? 'accounts-move-local-sign-in' : 'accounts-move-code'} style={{flex: 1, backgroundColor: theme.colors.ink}}>
    <ColourBackdrop shape="top"/>
    <ScrollView keyboardShouldPersistTaps="handled" contentContainerStyle={{flexGrow: 1, paddingHorizontal: 22,
      paddingTop: Math.max(104, insets.top + 54), paddingBottom: Math.max(30, insets.bottom + 16)}}>
      <Text accessibilityRole="header" style={[nativeType({size: 34, lineHeight: 35.36, weight: 800, tracking: -.04}, theme.textScale),
        {color: theme.colors.text, marginBottom: 8}]}>{t(local ? 'accounts.move.chooseSignIn' : 'accounts.move.enterCode')}</Text>
      {local && <Text style={[theme.type.body, {color: theme.colors.textSecondary, marginBottom: 20}]}>{t('accounts.move.profilesKept')}</Text>}
      {state.error != null && <Text accessibilityRole="alert" style={[theme.type.caption, {color: theme.colors.danger, marginBottom: 12}]}>{presentError(state.error, 'sign-in').body}</Text>}
      {local ? <>
        <TextField label={t('accounts.signIn.username')} value={username} onChangeText={setUsername} editable={!state.busy}
          autoCapitalize="none" autoCorrect={false} autoComplete="username" textContentType="username"
          fieldStyle={{height: 48, borderRadius: 11}} style={{fontSize: 16 * theme.textScale}} containerStyle={{marginBottom: 12}}/>
        {passwordField(false)}{passwordField(true)}
        {confirmation.length > 0 && confirmation !== password && <Text style={[theme.type.caption, {color: theme.colors.danger, marginBottom: 12}]}>{t('accounts.signIn.passwordsDiffer')}</Text>}
      </> : <TextField label={t('accounts.move.code')} value={code} onChangeText={value => {setCode(value); setInvalidCode(false);}}
        editable={!state.busy} autoCapitalize="none" autoCorrect={false} onSubmitEditing={submit} returnKeyType="go"
        error={invalidCode ? t('accounts.move.codeInvalid') : undefined} fieldStyle={{height: 48, borderRadius: 11}} style={{fontSize: 16 * theme.textScale}}/>}
      <Button disabled={state.busy || (local ? !username || !strength.acceptable || password !== confirmation : !code)} loading={state.busy || undefined}
        onPress={submit} style={{height: 48, borderRadius: 11, alignSelf: 'stretch', marginTop: 20}} textStyle={{fontSize: 16 * theme.textScale}}>{t('accounts.signIn.continue')}</Button>
      {!local && onScan && <Button variant="text" disabled={state.busy} onPress={() => {setCode(''); onScan();}}>{t('accounts.move.scanQR')}</Button>}
    </ScrollView>
    <View style={{position: 'absolute', top: Math.max(50, insets.top), left: 12, height: 48, justifyContent: 'center'}}>
      <Button variant="text" icon="i-left" iconSize={22} disabled={state.busy} onPress={back}>{t('accounts.signIn.back')}</Button>
    </View>
  </View>;
}
