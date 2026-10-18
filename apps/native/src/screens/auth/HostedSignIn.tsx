import React, {useEffect, useRef, useState} from 'react';
import {View} from 'react-native';
import {type HostedSession, type IdentityOptions, type IdentityProvider, type IdentityTransaction} from '../../../../../packages/client-core/src/index';
import {MFARequiredError, AccountAttemptIds} from '../../../../../packages/client-core/src/hosted-security';
import {accountBridge, accountReturnOf, nativeAccount, type NativeAccountOwner} from '../../bridge/native-account';
import {useSession} from '../../app/session';
import {useOffline} from '../../app/downloads';
import {Linking} from 'react-native';
import {accountReturns} from '../../shell/link-intents';
import {Button, Divider, Field, ProviderButton, Surface, Text, useTheme, type FieldHandle} from '../../ui';
import {AuthFrame} from './AuthFrame';
import {signInMessage} from '../../app/errors';
import {useI18n} from '../../app/i18n';

/**
 * Handheld Portico Account sign-in: password, or Google / Apple through the
 * system browser session. Multi-factor and first-time username steps are
 * handled inline. Everything runs through the account continuation owner so
 * an interrupted attempt can resume after the app returns.
 */
export function HostedSignIn({onBack, onSignedIn, onUseCode, onDirect, onCreate, onForgot, onDownloads, onSavedServer}: {onBack?: () => void; onSignedIn: () => void; onUseCode?: () => void; /** Present when this is the app's first screen. */ onDirect?: () => void; onCreate?: () => void; onForgot?: () => void; /** APP-03: opens what is already on this device, for a launch with no server. */ onDownloads?: () => void; /** APL-AUTH-01: the saved server is unreachable; Continue returns to its retrying screen. */ onSavedServer?: () => void}) {
  const session = useSession();
  const {space, isTV} = useTheme();
  const i18n = useI18n();
  const landing = !!onDirect;
  // A saved connection that has just failed to verify is not offered again: the message above
  // already says to sign in, and a Continue button that cannot work only gets in the way.
  // APL-AUTH-01: the saved card stays whenever there is a saved sign-in; an unreachable server is
  // reported inside the card, not as a sign-in error above the form.
  const saved = landing ? session.recovery : undefined;
  const unreachable = !!saved && session.resumeFailure === 'offline';
  // APP-03: offered whenever this device holds a finished download for the saved
  // viewer — including after a failed resume, which is exactly when the saved
  // card above is hidden and the person would otherwise be stuck at sign-in.
  const kept = useOffline().entries.some(e => e.state === 'ready');
  const owner = useRef<NativeAccountOwner | undefined>(undefined);
  const ids = useRef(new AccountAttemptIds(() => accountBridge().newRequestId()));
  const [options, setOptions] = useState<IdentityOptions>();
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [code, setCode] = useState('');
  const [name, setName] = useState('');
  const [mfa, setMFA] = useState<{challengeId: string; challengeToken: string; expiresAt: string; mfaRequired: true}>();
  const [tx, setTx] = useState<IdentityTransaction | null>(null);
  // IOS-AUTH-01: with a saved server, Continue is the one thing most people need; the account
  // sign-in options wait behind one button so the Welcome page fits a phone without scrolling.
  const [moreOptions, setMoreOptions] = useState(false);
  const collapsed = !!saved && !moreOptions && !isTV;
  const [busy, setBusy] = useState(false);
  // TV-AUTH-03: Next on the username keyboard opens the password keyboard straight away.
  const passwordField = useRef<FieldHandle>(null);
  const [error, setError] = useState('');
  useEffect(() => {
    let active = true;
    nativeAccount(session.hostedUrl)
      .then(async current => {
        if (!active) return;
        owner.current = current;
        setOptions(await current.api.options());
        if (current.continuation.mfa) setMFA(current.continuation.mfa);
        // SEC-01: the provider return's completion code (kept with the transaction) lets this app see
        // the onboarding details after a restart too.
        if (current.continuation.transactionId) setTx(await current.api.transaction(current.continuation.transactionId, undefined, current.continuation.completionCode).catch(() => null));
      })
      .catch(e => active && setError(signInMessage(e, 'load', 'portico-account')));
    return () => {
      active = false;
    };
  }, [session.hostedUrl]);

  // SEC-01: a provider sign-in's return that reaches the app as a link (a universal link to the
  // account-return page, translated natively): only the transaction this device started, with its
  // completion code. Inside the sign-in browser the return comes back through openBrowser instead.
  useEffect(() => {
    const received = (url: string | null) => {
      if (!url || !url.startsWith('portico://account-return')) return;
      void run(async (current, mine) => {
        const expected = current.continuation.transactionId;
        const back = expected ? accountReturnOf(url, expected, session.hostedUrl) : undefined;
        if (!back) return;
        if (back.completionCode) await current.update(current.continuation.binding, {transactionId: back.transactionId, completionCode: back.completionCode});
        await settle(current, await current.api.transaction(back.transactionId, undefined, back.completionCode), mine);
      });
    };
    // Handed over by the app's one link reader, which also holds a return that arrived before
    // this screen was showing (the launch link among them).
    return accountReturns.subscribe(received);
  }, [session.hostedUrl]); // eslint-disable-line react-hooks/exhaustive-deps

  /** A provider sign-in's transaction: finished at once for an existing account, else onboarding. */
  async function settle(current: NativeAccountOwner, transaction: IdentityTransaction | null, mine: number) {
    if (transaction && !transaction.needsUsername && transaction.status !== 'failed') {
      await accept(s => current.api.complete(transaction.transactionId, {}, s), mine);
      return;
    }
    setTx(transaction);
    setName(transaction?.suggestedName ?? '');
  }

  async function accept(work: (signal: AbortSignal) => Promise<HostedSession>, mine: number) {
    const credentials = session.credentials;
    const current = owner.current;
    if (!credentials || !current) throw new Error('Account services are unavailable.');
    const binding = current.continuation.binding;
    // Abandoned before it got here: it starts nothing (a newer sign-in may already have finished, NS-05).
    if (mine !== runs.current) return;
    const signed = await credentials.authenticate(signal => work(signal));
    // The details were changed (or the person left) while this was under way: the old ones don't sign
    // in. Only the session this run made is ended, never one a newer sign-in made.
    if (mine !== runs.current) { void credentials.logoutIfCurrent({accountId: signed.account.id, familyId: signed.familyId}).catch(() => {}); return; }
    await current.update(binding, {});
    setPassword('');
    setCode('');
    ids.current.clear();
    onSignedIn();
  }

  // Changing any detail abandons the sign-in under way: Continue is ready again at once, and the
  // old attempt's answer is ignored (a new one supersedes it in the credential store).
  const runs = useRef(0);
  const edited = () => {
    if (!busy) return;
    runs.current++;
    setBusy(false);
  };
  // Leaving for another screen abandons the run the same way (NS-04).
  const away = <A extends unknown[]>(go?: (...args: A) => void) => (go ? (...args: A) => { runs.current++; setBusy(false); go(...args); } : undefined);
  async function run(operation: (current: NativeAccountOwner, mine: number) => Promise<void>) {
    if (busy) return;
    const mine = ++runs.current;
    setBusy(true);
    setError('');
    try {
      const current = owner.current ?? (await nativeAccount(session.hostedUrl));
      owner.current = current;
      await operation(current, mine);
    } catch (e) {
      if (mine !== runs.current) return;
      if (e instanceof MFARequiredError) {
        const current = owner.current!;
        await current.update(current.continuation.binding, {...(current.continuation.transactionId ? {transactionId: current.continuation.transactionId} : {}), ...(current.continuation.completionCode ? {completionCode: current.continuation.completionCode} : {}), mfa: e.challenge}).catch(() => {});
        setMFA(e.challenge);
        setCode('');
      } else setError(signInMessage(e, 'action', 'portico-account'));
    } finally {
      if (mine === runs.current) setBusy(false);
    }
  }

  function submit() {
    void run(async (current, mine) => {
      if (mfa) {
        await accept(s => current.api.mfa(mfa, code.trim(), s), mine);
        return;
      }
      if (tx) {
        await accept(s => current.api.complete(tx.transactionId, tx.needsUsername ? {username, displayName: name, onboardingToken: tx.onboardingToken} : {}, s), mine);
        return;
      }
      const id = await ids.current.for('login', {username, password});
      await accept(s => current.api.login(username.trim(), password, id, s), mine);
    });
  }

  function provider(id: IdentityProvider) {
    void run(async (current, mine) => {
      const bridge = accountBridge();
      const nativeApple = id === 'apple' && options?.providers.some(p => p.id === 'apple' && p.native && p.nativeClientIds.includes(bridge.bundleId)) && bridge.canSignInApple;
      if (!nativeApple && !bridge.canOpenBrowser) throw new Error('This provider needs a browser. Sign in with a password instead.');
      // SEC-01: ask for the return's completion code when the service gives one (an older service
      // would refuse the field).
      const completion = !nativeApple && options?.nativeCompletion === 'code' ? 'code' as const : undefined;
      const started = await current.api.start(id, {mode: 'login', requestId: await ids.current.for('provider', {id, nativeApple: !!nativeApple}), nativeApple: !!nativeApple, ...(completion ? {completion} : {})});
      if (mine !== runs.current) return;
      await current.update(current.continuation.binding, {transactionId: started.transactionId});
      let transaction: IdentityTransaction | null;
      if (nativeApple) {
        const assertion = await bridge.signInApple(started.nativeNonce!);
        transaction = await current.api.nativeApple(started.transactionId, assertion.idToken, assertion.displayName);
      } else {
        // The native browser answers with the whole return (an older build: the transaction id).
        const returned = await bridge.openBrowser(started.authorizationUrl!, started.transactionId);
        const back = returned === started.transactionId ? {transactionId: returned} : accountReturnOf(returned, started.transactionId, session.hostedUrl);
        if (!back) throw new Error('A different sign-in attempt returned.');
        if (back.completionCode) await current.update(current.continuation.binding, {transactionId: back.transactionId, completionCode: back.completionCode});
        transaction = await current.api.transaction(back.transactionId, undefined, back.completionCode);
      }
      await settle(current, transaction, mine);
    });
  }

  function reset() {
    void run(async current => {
      await accountBridge().cancel().catch(() => {});
      await current.api.request('/v1/identity/cancel', 'POST', {}).catch(() => {});
      await current.reset();
      setTx(null);
      setMFA(undefined);
      setCode('');
      setPassword('');
      ids.current.clear();
    });
  }

  // TV-AUTH-02: Apple TV has no browser, so only a provider that signs in natively is offered there.
  const bridgeNow = accountBridge();
  const providers = options?.providers.filter(p => p.enabled && (!isTV || (p.id === 'apple' && p.native && p.nativeClientIds.includes(bridgeNow.bundleId) && bridgeNow.canSignInApple))) ?? [];
  const hiddenProviders = isTV && (options?.providers.filter(p => p.enabled).length ?? 0) > providers.length;
  return (
    <AuthFrame title={mfa ? i18n.t('auth.enterVerificationCode') : tx?.needsUsername ? i18n.t('auth.chooseUsername') : landing ? (saved ? i18n.t('auth.welcomeBack') : i18n.t('auth.welcomeHome')) : i18n.t('auth.signInWithAccountTitle')} lead={landing && !mfa && !tx?.needsUsername && !saved ? i18n.t('auth.accountLead') : undefined} compact={landing} onBack={mfa || tx?.needsUsername ? undefined : away(onBack)} error={error || (landing && !unreachable ? session.error : '')} onDismissError={() => { setError(''); session.clearError(); }}>
      {mfa ? (
        <>
          <Field label={i18n.t('auth.verificationCode')} placeholder="123456" value={code} onChangeText={v => { edited(); setCode(v); }} keyboardType="number-pad" textContentType="oneTimeCode" autoFocus onSubmitEditing={submit} />
          <Button variant="primary" label={i18n.t('action.continue')} fullWidth loading={busy} onPress={submit} />
          <Button variant="ghost" label={i18n.t('action.startOver')} onPress={reset} />
        </>
      ) : tx?.needsUsername ? (
        <>
          <Field label={i18n.t('auth.username')} value={username} onChangeText={v => { edited(); setUsername(v); }} autoFocus />
          <Field label={i18n.t('auth.displayName')} value={name} onChangeText={v => { edited(); setName(v); }} autoCapitalize="words" onSubmitEditing={submit} />
          <Button variant="primary" label={i18n.t('action.finish')} fullWidth loading={busy} onPress={submit} />
          <Button variant="ghost" label={i18n.t('action.startOver')} onPress={reset} />
        </>
      ) : (
        <>
          {saved ? (
            <Surface>
              <View style={{flexDirection: 'row', alignItems: 'center', gap: space.sm}}>
                <View style={{flex: 1, minWidth: 0}}>
                  <Text variant="bodyStrong" lines={1}>{saved.serverUrl.replace(/^https?:\/\//, '')}</Text>
                  {unreachable ? <Text variant="caption" tone="tertiary">{i18n.t('auth.savedUnreachable')}</Text> : null}
                  <Button variant="link" size="sm" label={i18n.t('auth.useDifferentAccount')} onPress={session.forgetSaved} style={{alignSelf: 'flex-start', marginLeft: -space.sm}} />
                </View>
                <Button variant="primary" label={i18n.t('action.continue')} loading={session.busy} onPress={() => (onSavedServer ? away(onSavedServer)?.() : void session.resumeSaved())} />
              </View>
            </Surface>
          ) : null}
          {kept && onDownloads ? (
            <Surface>
              <View style={{flexDirection: 'row', alignItems: 'center', gap: space.sm}}>
                <View style={{flex: 1, minWidth: 0}}>
                  <Text variant="bodyStrong" lines={1}>{i18n.t('auth.offlineDownloadsTitle')}</Text>
                  <Text variant="caption" tone="tertiary">{i18n.t('auth.offlineDownloadsBody')}</Text>
                </View>
                <Button variant="secondary" icon="download" label={i18n.t('feature.downloads')} onPress={away(onDownloads)} />
              </View>
            </Surface>
          ) : null}
          {collapsed ? <Button variant="secondary" label={i18n.t('auth.signInWithAccount')} fullWidth onPress={() => setMoreOptions(true)} /> : null}
          {providers.length && !collapsed ? (
            <View style={{gap: space.sm}}>
              {providers.map(p => <ProviderButton key={p.id} provider={p.id} onPress={() => provider(p.id)} disabled={busy} />)}
            </View>
          ) : null}
          {options?.password !== false && !collapsed ? (
            <>
              {providers.length ? (
                <View style={{flexDirection: 'row', alignItems: 'center', gap: space.md}}>
                  <Divider style={{flex: 1}} />
                  <Text variant="caption" tone="tertiary">{i18n.t('auth.orWithEmail')}</Text>
                  <Divider style={{flex: 1}} />
                </View>
              ) : null}
              <Field next={passwordField} hasTVPreferredFocus={isTV} label={i18n.t('auth.usernameOrEmail')} placeholder="name@example.com" value={username} onChangeText={v => { edited(); setUsername(v); }} textContentType="username" autoComplete="username" keyboardType="email-address" />
              <Field ref={passwordField} label={i18n.t('auth.password')} value={password} onChangeText={v => { edited(); setPassword(v); }} secure textContentType="password" autoComplete="password" returnKeyType="done" onSubmitEditing={submit} />
              <Button variant="primary" size="lg" label={i18n.t('action.continue')} fullWidth loading={busy} disabled={!username || !password} onPress={submit} />
            </>
          ) : null}
          {landing ? (
            <View style={{alignItems: 'center'}}>
              <View style={{flexDirection: 'row', justifyContent: 'center', alignItems: 'center', flexWrap: 'wrap'}}>
                {onForgot && options?.recovery !== false && !collapsed ? <Button variant="link" size="sm" label={i18n.t('auth.forgotPassword')} onPress={away(onForgot)} /> : null}
                {onForgot && onCreate && options?.recovery !== false && options?.registration !== false && !collapsed ? <Text variant="caption" tone="tertiary">·</Text> : null}
                {onCreate && options?.registration !== false ? <Button variant="link" size="sm" label={i18n.t('auth.createAccount')} onPress={away(onCreate)} /> : null}
              </View>
              <Button variant="link" size="sm" label={i18n.t('auth.signInDirectly')} onPress={away(onDirect)} />
            </View>
          ) : null}
          {hiddenProviders ? <Text variant="caption" tone="tertiary" align="center">{i18n.t('auth.tvGoogleHint')}</Text> : null}
          {onUseCode || (isTV && onBack) ? <View style={{alignItems: 'center'}}><Button variant="link" label={i18n.t('auth.useCodeFromAnotherDevice')} onPress={away(onUseCode ?? onBack)} /></View> : null}
          {landing || isTV ? <Legal /> : null}
        </>
      )}
    </AuthFrame>
  );
}

/** The agreement line under a sign-in form, with both documents a tap away. */
export function Legal() {
  const {isTV, colors} = useTheme();
  const i18n = useI18n();
  const open = (path: string) => void Linking.openURL('https://getportico.tv/' + path).catch(() => {});
  // TV-AUTH-02: on television the documents are printed, not focusable links.
  if (isTV) return <Text variant="caption" tone="tertiary" align="center">{`${i18n.t('auth.agreeToTerms')} ${i18n.t('auth.terms')} and ${i18n.t('auth.privacyPolicy')}.\n${i18n.t('auth.terms')}: getportico.tv/terms  •  ${i18n.t('auth.privacyPolicy')}: getportico.tv/privacy`}</Text>;
  // IOS-AUTH-01: one sentence that wraps as a sentence, with the two documents as inline links.
  const link = {color: colors.accent, textDecorationLine: 'underline' as const};
  return (
    <Text variant="caption" tone="tertiary" align="center">
      {`${i18n.t('auth.agreeToTerms')} `}
      <Text accessibilityRole="link" suppressHighlighting onPress={() => open('terms')} style={link}>{i18n.t('auth.terms')}</Text>
      {' and '}
      <Text accessibilityRole="link" suppressHighlighting onPress={() => open('privacy')} style={link}>{i18n.t('auth.privacyPolicy')}</Text>
      .
    </Text>
  );
}
