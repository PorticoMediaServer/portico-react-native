import React, {useCallback, useEffect, useRef, useState} from 'react';
import {AppState, Linking, View} from 'react-native';
import {HttpLocalApi, type LocalSession} from '../../../../../packages/client-core/src/index';
import {initializeServer, resumeServerSetup, startAppSetup} from '../../../../../packages/client-core/src/setup-onboarding';
import {passwordStrength} from '../../../../../packages/client-core/src/password-strength';
import {ClaimOnboarding} from '../../../../../packages/client-core/src/claim-onboarding';
import {ClaimError, awaitWebClaim, beginWebClaim, claimErrorMessage, safeApprovalUrl} from '../../../../../packages/client-core/src/claim-web';
import {nativeSetupDraft} from '../../bridge/setup-codes';
import {nativeNetworkFetch} from '../../bridge/server-connections';
import {signInMessage} from '../../app/errors';
import {useI18n} from '../../app/i18n';
import {useSession, type DirectSetup} from '../../app/session';
import {Button, Field, Ring, Segmented, Text, ToggleRow, useTheme, type FieldHandle} from '../../ui';
import {AuthFrame} from './AuthFrame';

type Mode = 'hosted' | 'local';
type Connecting = {issued: LocalSession; url?: string; error?: unknown; waiting?: boolean};

/** A signal that ends after `ms` (Hermes has no `AbortSignal.timeout`). */
function timeout(ms: number): AbortSignal {
  const controller = new AbortController();
  setTimeout(() => controller.abort(), ms);
  return controller.signal;
}

/**
 * First run from a phone or tablet (the web's ONB-01): the app found a server nobody has set up,
 * at the address the person typed, and sets it up here, as the server's own page does. Name the
 * server, choose how people sign in, create the owner.
 *
 * With a Portico Account (the recommended choice where the server can reach the service), setup
 * carries straight on into connecting the server to the account, after which it asks for its
 * certificate at once, so a secure connection is on from the start (Justin, 15 Oct). Signed in to
 * a Portico Account in this app, that happens here with the app's own account sign-in, the way
 * Server settings › Remote access does it. Otherwise the account's approval page opens in the
 * browser; the server waits for the decision itself, so the app only has to look again when the
 * person comes back. "Do this later" signs in and leaves the connection to Server settings.
 *
 * The setup secret comes from the app route (`startAppSetup`); the draft (never the password) is
 * kept in protected storage, so setup interrupted by a closed app resumes instead of starting over.
 */
export function ServerSetup({target}: {target: DirectSetup}) {
  const session = useSession();
  const i18n = useI18n();
  const t = i18n.t;
  const {space} = useTheme();
  const pin = target.api.getRouteConnection()?.pin;
  // Signed in to a Portico Account in this app: it approves the server here.
  const account = session.credentials && session.hosted ? session.hosted : undefined;
  const accountName = account ? account.account.displayName || account.account.username : '';
  const [name, setName] = useState(() => (target.name && target.name !== 'Portico' ? target.name : suggestedName(target.api.baseUrl)));
  const [mode, setMode] = useState<Mode>(target.hostedConfigured ? 'hosted' : 'local');
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [saved, setSaved] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [resuming, setResuming] = useState(true);
  const [connecting, setConnecting] = useState<Connecting>();
  const claimRun = useRef<AbortController | null>(null);
  const passwordField = useRef<FieldHandle>(null);
  const confirmField = useRef<FieldHandle>(null);
  useEffect(() => () => claimRun.current?.abort(), []);

  // A setup interrupted by a closed app resumes where it stopped: the owner it created signs in.
  useEffect(() => {
    if (!pin) { setResuming(false); return; }
    let live = true;
    const store = nativeSetupDraft(pin.serverId);
    void (async () => {
      try {
        if (!(await store.read()) || !live) return;
        const issued = await resumeServerSetup(target.api, store, timeout(20000));
        if (live) await session.direct.finishSetup(issued);
      } catch {
        /* Nothing to resume, or the server no longer knows the draft: start fresh. */
      } finally {
        if (live) setResuming(false);
      }
    })();
    return () => { live = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pin?.serverId]);

  const finish = useCallback(async (issued: LocalSession) => {
    claimRun.current?.abort();
    setBusy(true);
    try {
      await session.direct.finishSetup(issued);
    } catch (e) {
      setConnecting(current => (current ? {...current, error: e, waiting: false} : current));
      setError(signInMessage(e));
    } finally {
      setBusy(false);
    }
  }, [session.direct]);

  /** The Portico Account step, once the owner exists: the server is connected to the account that approves it. */
  const connectAccount = useCallback(async (issued: LocalSession) => {
    claimRun.current?.abort();
    const controller = new AbortController();
    claimRun.current = controller;
    setConnecting({issued, waiting: true});
    const api = target.api;
    try {
      if (!pin) throw new ClaimError('claim_unavailable');
      api.setAccessToken(issued.accessToken);
      if (account && session.credentials) {
        // Approved with this app's own account sign-in; the account's first profile owns the server,
        // as the account page proposes by default.
        const live = await session.credentials.accessSession();
        const hosted = new HttpLocalApi(session.hostedUrl, live.accessToken, nativeNetworkFetch);
        const claim = new ClaimOnboarding(api, pin);
        try {
          await claim.connect({accountId: live.account.id, profileId: live.profiles[0]?.id ?? '', approve: (input, signal) => hosted.request('/v1/server-claims/approve', 'POST', input, signal)});
          const outcome = claim.getSnapshot();
          if (outcome.error || !outcome.status) throw new ClaimError('claim_unavailable');
        } finally {
          claim.dispose();
        }
      } else {
        const {status, expected} = await beginWebClaim(api, pin, controller.signal);
        const url = safeApprovalUrl(status.approvalUrl, session.hostedUrl);
        if (!url) throw new ClaimError('claim_unavailable');
        if (controller.signal.aborted) return;
        setConnecting({issued, url, waiting: true});
        Linking.openURL(url).catch(() => {});
        await awaitApproval(api, pin, expected, controller.signal);
      }
      if (controller.signal.aborted) return;
      await finish(issued);
    } catch (e) {
      if (controller.signal.aborted) return;
      setConnecting(current => ({...(current ?? {issued}), error: e, waiting: false}));
    } finally {
      if (claimRun.current === controller) claimRun.current = null;
    }
  }, [target.api, pin, account, session.credentials, session.hostedUrl, finish]);

  const mismatch = !!confirm && confirm !== password;
  const strong = passwordStrength(password).acceptable;
  const hosted = mode === 'hosted' && target.hostedConfigured;
  const valid = name.trim().length > 0 && username.trim().length >= 3 && strong && confirm === password && (!hosted || saved);
  const submit = async () => {
    if (!valid || busy || !pin) return;
    setBusy(true);
    setError('');
    try {
      const {setupToken} = await startAppSetup(target.api, timeout(20000));
      const issued = await initializeServer(target.api, nativeSetupDraft(pin.serverId), {setupToken, name: name.trim(), username: username.trim(), password, authMode: hosted ? 'hosted' : 'local', recoverySaved: hosted ? saved : true, interactive: true}, timeout(30000));
      setPassword('');
      setConfirm('');
      setBusy(false);
      if (hosted) void connectAccount(issued);
      else await finish(issued);
    } catch (e) {
      setError(signInMessage(e));
      setBusy(false);
    }
  };

  if (resuming) {
    return <AuthFrame title={t('web.setup.welcome')}><View style={{alignItems: 'center', paddingVertical: space.xl}}><Ring size={28} thickness={2} /></View></AuthFrame>;
  }
  if (connecting) {
    const known = connecting.error ? claimErrorMessage(connecting.error) : undefined;
    const failure = !connecting.error ? '' : known ? t(known) : signInMessage(connecting.error);
    return (
      <AuthFrame title={t('web.setup.connectTitle', {server: name.trim()})} lead={account ? undefined : t('setup.app.connectLede')} error={failure || undefined}>
        {failure ? (
          <Button variant="primary" size="lg" label={t('web.setup.connectRetry')} fullWidth hasTVPreferredFocus onPress={() => void connectAccount(connecting.issued)} />
        ) : (
          <View style={{flexDirection: 'row', alignItems: 'center', gap: space.md}}>
            <Ring size={24} thickness={2} />
            {account ? <Text variant="body" tone="secondary" style={{flex: 1}}>{t('setup.app.connecting', {server: name.trim(), account: accountName})}</Text> : null}
          </View>
        )}
        {connecting.url && !failure ? <Button variant="secondary" label={t('web.setup.connectOpen')} fullWidth onPress={() => { Linking.openURL(connecting.url!).catch(() => {}); }} /> : null}
        <Button variant="ghost" label={t('web.setup.connectLater')} fullWidth loading={busy} onPress={() => void finish(connecting.issued)} />
        <Text variant="caption" tone="tertiary">{t('web.setup.connectLaterHelp')}</Text>
      </AuthFrame>
    );
  }
  return (
    <AuthFrame title={t('web.setup.welcome')} lead={t('web.setup.welcomeLede')} onBack={session.direct.cancelSetup} error={error || undefined} onDismissError={() => setError('')}>
      <Field label={t('web.general.serverName')} hint={t('web.setup.serverNameHelp')} value={name} onChangeText={setName} maxLength={80} autoCapitalize="words" />
      {target.hostedConfigured ? (
        <View style={{gap: space.sm}}>
          <Text variant="bodyStrong">{t('web.setup.howSignIn')}</Text>
          <Segmented accessibilityLabel={t('web.setup.howSignIn')} items={[{id: 'hosted', label: t('web.direct.useAccount')}, {id: 'local', label: t('web.setup.localAccounts')}]} selected={mode} onSelect={id => setMode(id as Mode)} />
          <Text variant="caption" tone="secondary">{hosted ? `${t('web.setup.recommended')} · ${t('web.setup.hostedBodySecure')}` : t('web.setup.localBody')}</Text>
        </View>
      ) : null}
      <View style={{gap: space.xs}}>
        <Text variant="bodyStrong">{hosted ? t('web.setup.recoveryTitleHosted') : t('web.setup.recoveryTitleLocal')}</Text>
        <Text variant="caption" tone="secondary">{hosted ? t('web.setup.recoveryBodyHosted') : t('web.setup.recoveryBodyLocal')}</Text>
      </View>
      <Field label={t('web.direct.username')} value={username} onChangeText={setUsername} textContentType="username" autoComplete="username" autoCapitalize="none" autoCorrect={false} maxLength={64} next={passwordField} />
      <Field ref={passwordField} label={t('web.account.password')} hint={t('account.passwordRule')} value={password} onChangeText={setPassword} secure textContentType="newPassword" autoComplete="password-new" next={confirmField} />
      <Field ref={confirmField} label={t('web.directJoin.confirm')} value={confirm} onChangeText={setConfirm} secure textContentType="newPassword" autoComplete="password-new" error={mismatch ? t('web.setup.mismatch') : undefined} returnKeyType="done" onSubmitEditing={() => void submit()} />
      {hosted ? <ToggleRow title={t('web.setup.savedPassword')} value={saved} onChange={setSaved} /> : null}
      <Button variant="primary" size="lg" label={hosted ? t('web.setup.createRecoveryOwner') : t('web.setup.createOwner')} fullWidth loading={busy} disabled={!valid} onPress={() => void submit()} />
      {hosted ? <Text variant="caption" tone="tertiary">{account ? t('setup.app.nextWithAccount', {account: accountName}) : t('web.setup.nextConnectSecure')}</Text> : null}
    </AuthFrame>
  );
}

/**
 * Waits for the account's decision. The app is usually in the background while the person
 * approves in the browser, and the system may end the open request there; the server keeps
 * waiting by itself, so a request that ended for any reason but the decision is made again once
 * the app is in front (a few times at most).
 */
async function awaitApproval(api: HttpLocalApi, pin: NonNullable<ReturnType<HttpLocalApi['getRouteConnection']>>['pin'], expected: Parameters<typeof awaitWebClaim>[2], signal: AbortSignal): Promise<void> {
  for (let attempt = 0; ; attempt++) {
    try {
      await awaitWebClaim(api, pin, expected, signal);
      return;
    } catch (e) {
      if (signal.aborted || e instanceof ClaimError || attempt >= 4) throw e;
      await inFront(signal);
    }
  }
}

/** Resolves once the app is in front (at once when it already is). */
function inFront(signal: AbortSignal): Promise<void> {
  if (AppState.currentState === 'active') return new Promise(resolve => setTimeout(resolve, 1000));
  return new Promise(resolve => {
    const sub = AppState.addEventListener('change', state => { if (state === 'active' || signal.aborted) { sub.remove(); resolve(); } });
    signal.addEventListener('abort', () => { sub.remove(); resolve(); }, {once: true});
  });
}

/** A server still called "Portico" is indistinguishable from every other one: suggest its host name (never an address). */
function suggestedName(baseUrl: string): string {
  let host = '';
  try { host = new URL(baseUrl).hostname; } catch { /* no suggestion */ }
  if (!host || /^(localhost|\d{1,3}(\.\d{1,3}){3}|\[.*\])$/.test(host) || host.includes(':')) return '';
  return host.replace(/\.(local|lan|home)$/i, '').replace(/[-_]+/g, ' ');
}
