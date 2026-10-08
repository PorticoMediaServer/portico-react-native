import React, {useRef, useState} from 'react';
import {View} from 'react-native';
import {AccountAttemptIds} from '../../../../../packages/client-core/src/hosted-security';
import {accountBridge, nativeAccount} from '../../bridge/native-account';
import {useSession} from '../../app/session';
import {Button, Field, Notice, Text, useTheme} from '../../ui';
import {AuthFrame} from './AuthFrame';
import {say as presentedMessage} from '../../app/errors';
import {useI18n} from '../../app/i18n';

// APL-SYS-04: errors are presented by code; the old per-call fallback text is no longer shown.
const say = (e: unknown, _fallback?: string) => presentedMessage(e, 'sign-in', 'action');

/**
 * Making a Portico Account, and getting back into one. A new account is confirmed in the app
 * with the code that was emailed. A forgotten password is replaced on the web (Link Contract
 * MAIL-04: one link, `/reset#token=`, nothing to paste): the app asks for the email and says so.
 */
export function AccountHelp({mode, onBack, onSignedIn}: {mode: 'create' | 'forgot'; onBack: () => void; onSignedIn: () => void}) {
  const i18n = useI18n();
  const session = useSession();
  const {space} = useTheme();
  const ids = useRef(new AccountAttemptIds(() => accountBridge().newRequestId()));
  const [username, setUsername] = useState('');
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [code, setCode] = useState('');
  const [registration, setRegistration] = useState<{registrationId: string; maskedAddress: string}>();
  const [requested, setRequested] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const run = async (work: () => Promise<void>) => {
    if (busy) return;
    setBusy(true); setError('');
    try { await work(); } catch (e) { setError(say(e, 'That didn’t work. Check what you entered and try again.')); } finally { setBusy(false); }
  };
  const create = () => run(async () => {
    const owner = await nativeAccount(session.hostedUrl);
    const requestId = await ids.current.for('register', {username, email});
    setRegistration(await owner.api.register({username: username.trim().toLowerCase(), displayName: name.trim() || username.trim(), password, contactAddress: email.trim(), requestId}));
  });
  const verify = () => run(async () => {
    const owner = await nativeAccount(session.hostedUrl);
    if (!session.credentials || !registration) throw new Error('Account services are unavailable.');
    const binding = owner.continuation.binding;
    await session.credentials.authenticate(signal => owner.api.verifyRegistration(registration.registrationId, {code: code.trim()}, signal));
    await owner.update(binding, {});
    onSignedIn();
  });
  const resend = () => run(async () => {
    const owner = await nativeAccount(session.hostedUrl);
    if (registration) setRegistration(await owner.api.resendRegistration(registration.registrationId, await ids.current.for('resend', {at: Date.now()})));
  });
  const request = () => run(async () => {
    const owner = await nativeAccount(session.hostedUrl);
    await owner.api.request('/v1/account/recovery/request', 'POST', {username: username.trim().toLowerCase(), contactAddress: email.trim(), requestId: await ids.current.for('recover', {username, email})});
    // Portico's own words, never the server's message text (the answer is the same either way).
    setRequested(true);
  });
  const passwordOk = password.length >= 8 && password.length <= 72;

  if (mode === 'create') {
    return registration ? (
      <AuthFrame title={i18n.t('auth.checkEmail')} lead={i18n.t('auth.codeSentTo', {address: registration.maskedAddress})} onBack={() => setRegistration(undefined)} error={error} onDismissError={() => setError('')}>
        <Field label={i18n.t('auth.code')} value={code} onChangeText={setCode} keyboardType="number-pad" textContentType="oneTimeCode" autoFocus onSubmitEditing={() => void verify()} />
        <Button variant="primary" size="lg" label={i18n.t('auth.createAccount')} fullWidth loading={busy} disabled={code.trim().length < 4} onPress={() => void verify()} />
        <View style={{alignItems: 'center'}}><Button variant="link" label={i18n.t('auth.sendCodeAgain')} onPress={() => void resend()} /></View>
      </AuthFrame>
    ) : (
      <AuthFrame title={i18n.t('auth.createYourAccount')} lead={i18n.t('auth.oneAccount')} onBack={onBack} error={error} onDismissError={() => setError('')}>
        <Field label={i18n.t('auth.email')} placeholder="you@example.com" value={email} onChangeText={setEmail} keyboardType="email-address" textContentType="emailAddress" autoComplete="email" /> {/* lint-strings-allow: email format example, not copy */}
        <Field label={i18n.t('auth.username')} hint={i18n.t('auth.usernameHelp')} value={username} onChangeText={setUsername} textContentType="username" />
        <Field label={i18n.t('auth.yourName')} value={name} onChangeText={setName} autoCapitalize="words" textContentType="name" />
        <Field label={i18n.t('auth.password')} hint={i18n.t('auth.passwordRule')} value={password} onChangeText={setPassword} secure textContentType="newPassword" autoComplete="password-new" />
        <Button variant="primary" size="lg" label={i18n.t('action.continue')} fullWidth loading={busy} disabled={!/^\S+@\S+\.\S+$/.test(email.trim()) || username.trim().length < 3 || !passwordOk} onPress={() => void create()} />
      </AuthFrame>
    );
  }
  return requested ? (
    // MAIL-04: the email carries one link; the new password is chosen on that page, on any device.
    <AuthFrame title={i18n.t('auth.checkEmail')} lead={i18n.t('auth.resetLinkSent')} onBack={() => setRequested(false)}>
      <Button variant="primary" size="lg" label={i18n.t('auth.backToSignIn')} fullWidth onPress={onBack} />
      <Text variant="caption" tone="tertiary" style={{marginTop: space.xs}}>{i18n.t('auth.privacySameAnswer')}</Text>
      <Notice tone="info" message={i18n.t('auth.noPasswordForSocial')} />
    </AuthFrame>
  ) : (
    <AuthFrame title={i18n.t('auth.forgotPasswordTitle')} lead={i18n.t('auth.resetLinkLede')} onBack={onBack} error={error} onDismissError={() => setError('')}>
      <Field label={i18n.t('auth.username')} value={username} onChangeText={setUsername} textContentType="username" autoComplete="username" />
      <Field label={i18n.t('auth.email')} placeholder="you@example.com" value={email} onChangeText={setEmail} keyboardType="email-address" textContentType="emailAddress" autoComplete="email" />
      <Button variant="primary" size="lg" label={i18n.t('auth.resetLinkAction')} fullWidth loading={busy} disabled={username.trim().length < 3 || !/^\S+@\S+\.\S+$/.test(email.trim())} onPress={() => void request()} />
      <Text variant="caption" tone="tertiary" style={{marginTop: space.xs}}>{i18n.t('auth.privacySameAnswer')}</Text>
    </AuthFrame>
  );
}
