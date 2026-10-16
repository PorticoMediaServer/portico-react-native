import React, {useRef, useState, useEffect} from 'react';
import {rememberedUsername} from '../../bridge/direct-memory';
import type {HttpLocalApi} from '../../../../../packages/client-core/src/index';
import {passwordStrength} from '../../../../../packages/client-core/src/password-strength';
import {signInMessage} from '../../app/errors';
import {useI18n} from '../../app/i18n';
import {useSession} from '../../app/session';
import {Button, Field, useTheme, type FieldHandle} from '../../ui';
import {AuthFrame} from './AuthFrame';
import {PlainHttpNote} from './PlainHttpNote';
import {CertificateQuestion} from './CertificateQuestion';
import {QuickConnect} from './QuickConnect';
import {directStepAfter, firstDirectStep, type DirectStep} from './sign-in-steps';

/**
 * Direct sign-in to one server: its address and the account that lives on it. The server's
 * identity is pinned on first contact and checked silently ever after; a fingerprint is not
 * something to ask a person to compare.
 *
 * TV-AUTH-01: on television only the address is typed; the TV then shows a Quick Connect code to
 * approve from a phone. A password stays one press away.
 */
export function DirectSignIn({onBack, backRef}: {onBack: () => void; /** QA (TV): Menu walks back one sub-step at a time, through the same cleanup as Back. */ backRef?: React.MutableRefObject<(() => void) | null>}) {
  const session = useSession();
  const {isTV} = useTheme();
  const i18n = useI18n();
  const {direct} = session;
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  // TV-AUTH-03: one keyboard session: address → username → password → sign in.
  const userField = useRef<FieldHandle>(null);
  const passwordField = useRef<FieldHandle>(null);
  const [step, setStep] = useState<DirectStep>(firstDirectStep(isTV));
  // Every move goes through the step model: a handheld never reaches the address or code steps.
  const go = (event: 'connected' | 'usePassword' | 'back') => { const next = directStepAfter(step, event, isTV); if (next === 'exit') onBack(); else setStep(next); return next; };
  const [connected, setConnected] = useState<HttpLocalApi>();
  const [connecting, setConnecting] = useState(false);
  const [connectError, setConnectError] = useState('');
  // Opened with the address already filled in (a sign-in that ended): on TV, Continue takes focus.
  const [prefilled] = useState(() => !!direct.origin.trim());
  // The address once the person has finished typing it (the field was left, or it came filled in):
  // only then is the server asked whether this is plain HTTP from outside its home networks.
  const [settled, setSettled] = useState(() => direct.origin.trim());
  // The username the server accepted last time for this address (a sign-in that ended reopens
  // with it); the password is always typed.
  useEffect(() => {
    let live = true;
    void rememberedUsername(direct.origin).then(name => {
      if (!live || !name) return;
      setUsername(prev => prev || name);
      if (!isTV) setTimeout(() => passwordField.current?.focus(), 350);
    }, () => {});
    return () => { live = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  // QA: a connection made for Quick Connect is released when it is abandoned (Back, "Use a
  // password", a new address or reconnecting); one that signed in is the session's and is kept.
  const release = (api?: HttpLocalApi) => { try { api?.getRouteConnection()?.dispose(); } catch { /* already gone */ } };
  const leaveCode = (event: 'usePassword' | 'back') => { release(connected); setConnected(undefined); go(event); };
  const back = () => {
    if (direct.step) { session.clearError(); direct.cancelStep(); }
    else if (step === 'code') leaveCode('back');
    else go('back');
  };
  useEffect(() => {
    if (!backRef) return;
    backRef.current = back;
    return () => { backRef.current = null; };
  });
  const ready = !!direct.origin.trim() && !!username && !!password;
  const submit = () => { if (ready) void direct.signIn(username, password); };
  const connect = async () => {
    if (!direct.origin.trim() || connecting) return;
    setConnecting(true);
    setConnectError('');
    try {
      const next = await direct.connect();
      release(connected);
      setConnected(next);
      go('connected');
    } catch (e) {
      if (__DEV__) console.warn('[direct] connect failed', (e as {code?: unknown})?.code, (e as {status?: unknown})?.status, String(e), (e as Error)?.stack); // lint-raw-errors-allow: __DEV__-only diagnostics
      setConnectError(signInMessage(e));
    } finally {
      setConnecting(false);
    }
  };
  if (direct.step) return <DirectStepScreen />;
  if (step === 'code' && connected) return <QuickConnect api={connected} onPassword={() => leaveCode('usePassword')} onBack={() => leaveCode('back')} />;
  // TV-AUTH-03: placeholders are examples, never a repeat of the label.
  const address = <Field label={i18n.t('auth.serverAddress')} placeholder="192.168.1.20:32500" value={direct.origin} onChangeText={v => { if (direct.pin) direct.resetPin(); direct.setOrigin(v); setSettled(''); release(connected); setConnected(undefined); }} onBlur={() => setSettled(direct.origin.trim())} keyboardType="url" textContentType="URL" returnKeyType={step === 'address' ? 'go' : undefined} next={step === 'address' ? undefined : userField} autoFocus={!(isTV && prefilled)} onSubmitEditing={step === 'address' ? () => void connect() : undefined} />;
  if (step === 'address') {
    return (
      <AuthFrame title={i18n.t('auth.signInToServer')} lead={i18n.t('auth.direct.leadTV')} onBack={onBack} error={connectError || session.error} onDismissError={() => { setConnectError(''); session.clearError(); }}>
        {address}
        <CertificateQuestion origin={direct.origin} shown={!!(connectError || session.error)} connectionFailed={!!connectError} onTrusted={() => { setConnectError(''); session.clearError(); void connect(); }} />
        {/* A sign-in that ended reopens with the address filled in: Continue is the one press. */}
        <Button variant="primary" size="lg" label={i18n.t('action.continue')} fullWidth loading={connecting} disabled={!direct.origin.trim()} hasTVPreferredFocus={prefilled} onPress={() => void connect()} />
        <Button variant="ghost" label={i18n.t('quickConnect.usePassword')} fullWidth onPress={() => go('usePassword')} />
      </AuthFrame>
    );
  }
  return (
    <AuthFrame title={i18n.t('auth.signInToServer')} lead={i18n.t('auth.direct.lead')} onBack={() => go('back')} error={session.error} onDismissError={session.clearError}>
      {address}
      <Field ref={userField} next={passwordField} label={i18n.t('auth.username')} placeholder="name@example.com" value={username} onChangeText={setUsername} textContentType="username" autoComplete="username" />
      <Field ref={passwordField} label={i18n.t('auth.password')} value={password} onChangeText={setPassword} secure textContentType="password" autoComplete="password" returnKeyType="done" onSubmitEditing={submit} />
      <CertificateQuestion origin={direct.origin} shown={!!session.error} onTrusted={() => { session.clearError(); submit(); }} />
      <Button variant="primary" size="lg" label={i18n.t('auth.signIn')} fullWidth loading={session.busy} disabled={!ready} onPress={submit} />
      <PlainHttpNote address={settled} />
    </AuthFrame>
  );
}

/**
 * C45: the step a direct sign-in can stop at. A two-step code (authenticator or recovery code), a
 * new password the server requires (the password just typed is the current one; then Portico
 * signs in again with the new one), or waiting for the owner to approve this device.
 */
export function DirectStepScreen() {
  const session = useSession();
  const i18n = useI18n();
  const {direct} = session;
  const [value, setValue] = useState('');
  const back = () => { session.clearError(); direct.cancelStep(); };
  if (direct.step === 'device-pending') {
    return (
      <AuthFrame title={i18n.t('device.approval.titleThisDevice')} lead={i18n.t('device.approval.body')} onBack={back} error={session.error} onDismissError={session.clearError}>
        <Button variant="primary" size="lg" label={i18n.t('device.approval.checkAgain')} fullWidth loading={session.busy} hasTVPreferredFocus onPress={() => void direct.retrySignIn()} />
      </AuthFrame>
    );
  }
  if (direct.step === 'password-change') {
    const ok = passwordStrength(value).acceptable;
    return (
      <AuthFrame title={i18n.t('web.direct.newPasswordTitle')} lead={i18n.t('web.direct.newPasswordLede')} onBack={back} error={session.error} onDismissError={session.clearError}>
        <Field label={i18n.t('auth.newPassword')} hint={i18n.t('account.passwordRule')} secure textContentType="newPassword" autoComplete="password-new" autoFocus value={value} onChangeText={setValue} returnKeyType="done" onSubmitEditing={() => { if (ok) void direct.changeRequiredPassword(value); }} />
        <Button variant="primary" size="lg" label={i18n.t('action.continue')} fullWidth loading={session.busy} disabled={!ok} onPress={() => void direct.changeRequiredPassword(value)} />
      </AuthFrame>
    );
  }
  const ready = value.trim().length >= 6;
  return (
    <AuthFrame title={i18n.t('web.direct.codeTitle')} lead={i18n.t('web.direct.codeLede')} onBack={back} error={session.error} onDismissError={session.clearError}>
      <Field label={i18n.t('security.authenticatorCode')} textContentType="oneTimeCode" autoCapitalize="none" autoCorrect={false} maxLength={40} autoFocus value={value} onChangeText={setValue} returnKeyType="done" onSubmitEditing={() => { if (ready) void direct.completeChallenge(value); }} />
      <Button variant="primary" size="lg" label={i18n.t('action.continue')} fullWidth loading={session.busy} disabled={!ready} onPress={() => void direct.completeChallenge(value)} />
    </AuthFrame>
  );
}
