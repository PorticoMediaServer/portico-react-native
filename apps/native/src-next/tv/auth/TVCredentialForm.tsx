import React, {useRef, useState} from 'react';
import {Text, TextInput, View} from 'react-native';
import {defaultI18n, type MessageId} from '../../../../../packages/i18n/src';
import {Button} from '../../kit/controls';
import {FocusProvider, FocusRegion, useFocusRegistry, useFocusTarget} from '../../kit/focus';
import {nativeType, useTheme} from '../../kit/theme';
import {useDestinationEntryFocus} from '../../screens/destinations/useEntryFocus';
import {TVAuthLayout} from './TVAuthLayout';

export type TVCredentialFormProps = Readonly<{
  username: string; password: string;
  onUsernameChange: (value: string) => void; onPasswordChange: (value: string) => void;
  busy: boolean; error?: React.ReactNode; onSubmit: () => void; onBack: () => void;
}> & Readonly<
  {kind: 'portico'; serverName?: string; usernamePlaceholder: MessageId} |
  {kind: 'local'; serverName: string; usernamePlaceholder?: never}
>;

function CredentialField({id, label, value, onChangeText, password, placeholder, busy, onSubmitEditing}: {
  id: string; label: string; value: string; onChangeText: (value: string) => void; password?: boolean;
  placeholder?: string; busy: boolean; onSubmitEditing: () => void;
}) {
  const theme = useTheme(), [focused, setFocused] = useState(false);
  const binding = useFocusTarget<TextInput>({focusId: id, disabled: busy});
  return <View style={{gap: 8}}>
    <Text style={[nativeType({size: 22, weight: 700, tracking: 0, lineHeight: 'normal'}, theme.textScale), {color: theme.colors.textTertiary}]}>{label}</Text>
    <TextInput {...binding} accessibilityLabel={label} value={value} onChangeText={onChangeText} editable={!busy}
      secureTextEntry={password === true} textContentType={password ? 'password' : 'username'}
      autoComplete={password ? 'current-password' : 'username'} importantForAutofill="yes"
      autoCapitalize="none" autoCorrect={false} placeholder={placeholder} placeholderTextColor={theme.colors.textTertiary}
      cursorColor={theme.colors.accentStrong} selectionColor={theme.colors.accentStrong} underlineColorAndroid="transparent"
      returnKeyType={password ? 'done' : 'next'} submitBehavior="blurAndSubmit" onSubmitEditing={onSubmitEditing}
      onFocus={() => {binding.onFocus(); setFocused(true);}} onBlur={() => {binding.onBlur(); setFocused(false);}}
      style={[nativeType({size: 32, weight: 600, tracking: 0, lineHeight: 'normal'}, theme.textScale), {width: 860, height: 84,
        paddingHorizontal: 28, paddingVertical: 0, borderRadius: 16, color: theme.colors.text, backgroundColor: `${theme.colors.ink}9E`,
        borderWidth: 1.5, borderColor: focused ? theme.colors.accentStrong : theme.colors.lineStrong}]}/>
  </View>;
}

/** Presentation only. The account owner keeps credentials, transactions, error strings and Back target. */
export function TVCredentialForm(props: TVCredentialFormProps) {
  return <FocusProvider><CredentialForm {...props}/></FocusProvider>;
}
function CredentialForm(props: TVCredentialFormProps) {
  const {kind, username, password, busy} = props, registry = useFocusRegistry(), id = `tv.auth.${kind}.credentials`;
  const initial = useRef(!username ? 'username' : !password ? 'password' : 'submit');
  useDestinationEntryFocus({visible: !busy, intent: 'enter', revision: 0}, {regionId: id, childId: initial.current});
  const t = defaultI18n.t, submit = () => {if (!busy && username && password) props.onSubmit();};
  return <TVAuthLayout testID={`tv-${kind}-credentials`} portico={kind === 'portico'}
    heading={props.kind === 'portico' ? t('auth.welcomeHome') : props.serverName}
    eyebrow={kind === 'local' ? t('accounts.signIn.to') : undefined}
    body={t(kind === 'portico' ? 'auth.accountLead' : 'auth.direct.lead')}>
    <FocusRegion id={id} entry={initial.current} order={['username', 'password', 'submit', 'back']} enabled={!busy}>
      {props.error && <View accessibilityRole="alert" style={{marginBottom: 16}}>{props.error}</View>}
      <View style={{width: 860, gap: 22}}>
        <CredentialField id="username" label={t(kind === 'portico' ? 'auth.usernameOrEmail' : 'auth.username')} value={username}
          onChangeText={props.onUsernameChange} placeholder={props.kind === 'portico' ? t(props.usernamePlaceholder) : undefined} busy={busy}
          onSubmitEditing={() => {registry.focus({regionId: id, childId: 'password'});}}/>
        <CredentialField id="password" label={t('auth.password')} value={password} onChangeText={props.onPasswordChange} password busy={busy}
          onSubmitEditing={() => {registry.focus({regionId: id, childId: 'submit'});}}/>
      </View>
      <View style={{flexDirection: 'row', gap: 20, marginTop: 32}}>
        <Button focusId="submit" disabled={busy || !username || !password} loading={busy ? true : undefined} onPress={submit}
          style={{height: 72, paddingHorizontal: 38, borderRadius: 14}}>{t(kind === 'portico' ? 'action.continue' : 'auth.signIn')}</Button>
        <Button focusId="back" variant="glass" disabled={busy} onPress={props.onBack} style={{height: 72, paddingHorizontal: 38, borderRadius: 14}}>{t('action.back')}</Button>
      </View>
    </FocusRegion>
  </TVAuthLayout>;
}
