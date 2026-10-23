import React, {useEffect, useRef, useState} from 'react';
import {BackHandler, NativeModules, Platform, Text, View} from 'react-native';
import QRCode from 'react-native-qrcode-svg';
import {HttpHostedApi, type HostedServer, type HostedSession, type LocalSession} from '../../../../../packages/client-core/src';
import {ServerSignInProbe, type ServerSignIn} from '../../../../../packages/client-core/src/sign-in';
import {routeOrigin} from '../../../../../packages/client-core/src/route-identity';
import type {ManagedProfile} from '../../../../../packages/client-core/src/profile-management';
import {MFARequiredError, type IdentityOptions, type IdentityTransaction} from '../../../../../packages/client-core/src/hosted-security';
import type {SetupCodeService, SetupCodeSnapshot} from '../../../../../packages/client-core/src/setup-code';
import {presentError} from '../../../../../packages/client-core/src/presentation/errors';
import {defaultI18n} from '../../../../../packages/i18n/src';
import {StateLayout} from '../../kit/states';
import {Button, TextField} from '../../kit/controls';
import {ProfilePicker} from '../../kit/artwork';
import {useTheme} from '../../kit/theme';
import {nativeAccounts} from '../../platform/accounts';
import {NativeServerSignIn} from '../../platform/server-sign-in';
import {NativePorticoSignIn} from '../../platform/portico-sign-in';
import {nativeNetworkFetch, browseNearby} from '../../platform/server-connections';
import {createNativePorticoTVSignIn} from '../../platform/tv-sign-in';
import {hostedUrl} from '../../platform/account-authority';
import {TVCredentialForm, TVCodePresenter, TVVerificationForm, TVRequiredSetupHandoff} from '../../tv/auth';

type Stage = 'welcome' | 'address' | 'identity-code' | 'local' | 'factor' | 'uses-portico' | 'portico' | 'register' | 'verify' | 'provider' | 'contact' | 'servers' | 'account-sign-out' | 'profiles' | 'profile-pin' | 'tv' | 'tv-credentials' | 'tv-required-setup';
type RequiredSetup = Readonly<{kind: 'required-setup'; requirement: 'password' | 'two-step'; serverName: string; serverOrigin: string}>;
type Result = {kind: 'profiles'; profiles: readonly ManagedProfile[]} | {kind: 'challenge'; expiresAt: string} | {kind: 'complete'} | RequiredSetup;
const t = defaultI18n.t;

/** Current normal entry, drawn in connect39 onward. The separately labelled historical
 * setup entry is not imported. Every button below dispatches an actual native/core command. */
export function AccountEntry({onBack, onComplete, initialStage = 'welcome', initialAddress = ''}: {onBack?: () => void; onComplete: () => void; initialStage?: 'welcome' | 'address'; initialAddress?: string}) {
  const theme = useTheme(), [stage, setStage] = useState<Stage>(initialStage), [busy, setBusy] = useState(false), [error, setError] = useState<unknown>();
  const [address, setAddress] = useState(initialAddress), [username, setUsername] = useState(''), [password, setPassword] = useState(''), [code, setCode] = useState('');
  const [name, setName] = useState(''), [email, setEmail] = useState(''), [masked, setMasked] = useState('');
  const [server, setServer] = useState<ServerSignIn>(), [profiles, setProfiles] = useState<readonly ManagedProfile[]>([]), [profile, setProfile] = useState<ManagedProfile>();
  const [identityCode, setIdentityCode] = useState(''), [identityWrong, setIdentityWrong] = useState(false), [identityAddress, setIdentityAddress] = useState('');
  const identityOrigin = useRef<string | undefined>(undefined);
  const [servers, setServers] = useState<HostedServer[]>([]), [options, setOptions] = useState<IdentityOptions>(), [transaction, setTransaction] = useState<IdentityTransaction>();
  const [tvState, setTVState] = useState<SetupCodeSnapshot<unknown>>({phase: 'idle'});
  const [tvKind, setTVKind] = useState<'local' | 'portico'>('portico'), [recovery, setRecovery] = useState(false), [recoveryCode, setRecoveryCode] = useState('');
  const [requiredSetup, setRequiredSetup] = useState<RequiredSetup>();
  const [nearby, setNearby] = useState<readonly {origin: string; server: ServerSignIn}[]>([]);
  const lifetime = useRef(true), operation = useRef<NativeServerSignIn | undefined>(undefined), account = useRef<NativePorticoSignIn | undefined>(undefined);
  const tv = useRef<SetupCodeService<LocalSession> | SetupCodeService<HostedSession> | undefined>(undefined), tvOff = useRef<(() => void) | undefined>(undefined);
  const contact = useRef<string | undefined>(undefined), factorKind = useRef<'portico' | 'local'>('local');
  const accountScope = useRef<{accountId: string; familyId: string} | undefined>(undefined);
  const acting = useRef(false), adoptingTV = useRef(false);
  useEffect(() => {lifetime.current = true; return () => {lifetime.current = false; operation.current?.dispose(); account.current?.dispose(); tvOff.current?.(); tv.current?.pause();};}, []);
  useEffect(() => {
    if (stage !== 'address') return;
    const abort = new AbortController(), probes = new Set<ServerSignInProbe>();
    setNearby([]);
    void browseNearby('servers', abort.signal).then(async values => {
      const found = values.flatMap(value => {try {
        if (!value || typeof value !== 'object' || !('baseUrl' in value) || typeof value.baseUrl !== 'string') return [];
        if (!('serverId' in value) || typeof value.serverId !== 'string') return [];
        return [{origin: routeOrigin(value.baseUrl), serverId: value.serverId}];
      } catch {return [];}});
      // Discovery supplies addresses, not display names. Ask each server's public system
      // endpoint; never substitute a hostname or make a Portico Services request.
      const unique = found.filter((value, index) => found.findIndex(item => item.serverId === value.serverId) === index);
      for (let index = 0; index < unique.length && !abort.signal.aborted; index += 4) {
        const rows = await Promise.all(unique.slice(index, index + 4).map(async value => {
          if (abort.signal.aborted) return;
          const probe = new ServerSignInProbe(nativeNetworkFetch, 3000); probes.add(probe);
          try {const descriptor = await probe.inspect(value.origin);
            return descriptor?.id === value.serverId ? {origin: value.origin, server: descriptor} : undefined;
          } finally {probe.dispose(); probes.delete(probe);}
        }));
        if (!abort.signal.aborted) setNearby(current => [...current, ...rows.flatMap(value => value ? [value] : [])]);
      }
    }).catch(failure => {if (!abort.signal.aborted) setError(failure);});
    return () => {abort.abort(); for (const probe of probes) probe.dispose();};
  }, [stage]);
  const run = async (work: () => Promise<void>) => {
    if (busy || acting.current || adoptingTV.current || !lifetime.current) return; acting.current = true; setBusy(true); setError(undefined);
    try {await work();} catch (failure) {if (lifetime.current) {
      if (failure instanceof MFARequiredError) {factorKind.current = 'portico'; setCode(''); setRecovery(false); setStage('factor');}
      else {if (Platform.isTV && stage === 'factor' && !recovery) setCode(''); setError(failure);}
    }} finally {acting.current = false; if (lifetime.current) setBusy(adoptingTV.current);}
  };
  const reset = () => {operation.current?.dispose(); operation.current = undefined; account.current?.dispose(); account.current = undefined;
    tvOff.current?.(); tvOff.current = undefined; if (tv.current) void tv.current.cancel().catch(setError); tv.current = undefined;
    setPassword(''); setCode(''); setIdentityCode(''); setIdentityWrong(false); setIdentityAddress(''); identityOrigin.current = undefined; setError(undefined); setStage(initialStage);};
  const back = () => {
    if (Platform.isTV && (stage === 'tv-credentials' || stage === 'factor' || stage === 'tv-required-setup')) {void run(returnToTVCode); return;}
    if (stage === initialStage) onBack?.(); else reset();
  };
  useEffect(() => {const listener = BackHandler.addEventListener('hardwareBackPress', () => {if (busy || adoptingTV.current) return true; if (stage === 'welcome' && !onBack) return false; back(); return true;}); return () => listener.remove();});
  const consume = (result: Result) => {
    if (!lifetime.current) return;
    if (result.kind === 'required-setup') {
      if (!Platform.isTV) throw Object.assign(new Error('native_required_account_setup'), {code: 'access_refused'});
      setPassword(''); setCode(''); setRecoveryCode(''); setRecovery(false); setProfiles([]); setProfile(undefined);
      setRequiredSetup(result); setStage('tv-required-setup');
    }
    else if (result.kind === 'profiles') {setServer(operation.current!.serverDescriptor()); setProfiles(result.profiles); setStage('profiles');}
    else if (result.kind === 'challenge') {factorKind.current = 'local'; setCode(''); setRecovery(false); setStage('factor');}
    else onComplete();
  };
  const directory = async () => {
    const credentials = nativeAccounts.accountCredentials(), session = await credentials.accessSession();
    accountScope.current = {accountId: session.account.id, familyId: session.familyId};
    const out = await new HttpHostedApi(hostedUrl, session.accessToken, nativeNetworkFetch).servers();
    if (!out || !Array.isArray(out.items) || out.items.some(value => !value || typeof value.id !== 'string' || !value.id ||
      typeof value.name !== 'string' || !value.name || typeof value.baseUrl !== 'string' || typeof value.publicKey !== 'string' ||
      !Number.isSafeInteger(value.policyRevision) || value.policyRevision < 0) || new Set(out.items.map(value => value.id)).size !== out.items.length)
      throw Object.assign(new Error('native_directory_invalid'), {code: 'invalid_response'});
    if (lifetime.current) {setPassword(''); setServers(out.items); setStage('servers');}
  };
  const startTV = async (kind: 'local' | 'portico') => {
    setTVKind(kind); setTVState({phase: 'idle'});
    const service = kind === 'local' ? operation.current!.localTVSignIn() : createNativePorticoTVSignIn();
    tv.current = service; let adopting = false;
    tvOff.current = service.subscribe(() => {
      if (!lifetime.current) return;
      const value = service.getSnapshot(), {grant: _grant, ...presentation} = value; setTVState(presentation);
      if (value.phase === 'approved' && value.grant && !adopting) {
        adopting = true; adoptingTV.current = true; setBusy(true);
        void (async () => {
          if (!service.isCurrent(value.grant as never)) return;
          if (kind === 'portico') {const grant = value.grant as HostedSession; await nativeAccounts.adoptPorticoTVSession(grant); await (service as SetupCodeService<HostedSession>).complete(grant); await directory();}
          else {const grant = value.grant as LocalSession; const result = await operation.current!.acceptLocalTVSession(grant); await (service as SetupCodeService<LocalSession>).complete(grant); consume(result);}
        })().catch(failure => {if (lifetime.current) setError(failure);}).finally(() => {adoptingTV.current = false; if (lifetime.current) setBusy(acting.current);});
      }
    });
    setStage('tv'); await service.start();
  };
  const portico = async () => {
    const credentials = nativeAccounts.accountCredentials(); await credentials.synchronize();
    if (credentials.getSnapshot().session) return directory();
    if (Platform.isTV) return startTV('portico');
    account.current?.dispose(); const next = account.current = new NativePorticoSignIn();
    const available = await next.prepare(); if (lifetime.current) {setOptions(available); setStage('portico');}
  };
  const inspect = async (origin = address) => {
    operation.current?.dispose(); const next = operation.current = new NativeServerSignIn(nativeAccounts, {requiredSetupHandoff: Platform.isTV});
    const value = await next.inspect(origin); if (!lifetime.current) return;
    if (next.needsIdentityCode()) {
      routeOrigin(origin); identityOrigin.current = origin;
      setIdentityAddress(origin);
      setServer(undefined); setIdentityCode(''); setIdentityWrong(false); setStage('identity-code'); return;
    }
    if (!value) throw Object.assign(new Error('native_sign_in_authority_changed'), {code: 'identity_mismatch'});
    setServer(value);
    if (value.signIn === 'portico') {setStage('uses-portico'); return;}
    await next.confirmLocal(await next.inspectLocalIdentity());
    if (lifetime.current) {setServer(next.serverDescriptor()); if (Platform.isTV) await startTV('local'); else setStage('local');}
  };
  const confirmCode = async (value = identityCode) => {
    const matched = await operation.current!.confirmIdentityCode(value);
    if (!lifetime.current) return;
    if (!matched) {setIdentityWrong(true); return;}
    const capturedOrigin = identityOrigin.current; if (!capturedOrigin) return;
    setIdentityCode(''); setIdentityWrong(false); await inspect(capturedOrigin);
  };
  const choose = async (id: string, enteredPin?: string) => {await operation.current!.chooseProfile(id, enteredPin); onComplete();};
  const cancelTV = async () => {
    const service = tv.current;
    tvOff.current?.(); tvOff.current = undefined;
    if (service) await service.cancel();
    if (tv.current === service) tv.current = undefined;
  };
  const typeTVCredentials = async () => {
    await cancelTV(); if (!lifetime.current) return;
    if (tvKind === 'portico') {
      account.current?.dispose(); const next = account.current = new NativePorticoSignIn();
      const available = await next.prepare(); if (!lifetime.current) return; setOptions(available);
    }
    setPassword(''); setCode(''); setRecoveryCode(''); setRecovery(false); setStage('tv-credentials');
  };
  const returnToTVCode = async () => {
    account.current?.dispose(); account.current = undefined;
    setPassword(''); setCode(''); setRecoveryCode(''); setRecovery(false); setRequiredSetup(undefined);
    if (tvKind === 'local') await inspect(address); else await startTV('portico');
  };
  const submitTVFactor = async (value: string) => {
    if (factorKind.current === 'portico') {await account.current!.factor(value); await directory();}
    else consume(await operation.current!.completeSecondFactor(value));
  };
  const field = (label: string, value: string, change: (next: string) => void, secure = false, credential?: 'username' | 'password') => <TextField key={label} label={label} value={value} onChangeText={change} secureTextEntry={secure}
    textContentType={credential} autoComplete={credential === 'password' ? 'current-password' : credential} autoCapitalize="none" autoCorrect={false} editable={!busy}/>;
  const fields = (...children: React.ReactNode[]) => <View style={{alignSelf: 'stretch', width: theme.isTV ? 720 : undefined, gap: 14, marginBottom: 20}}>{children}</View>;
  const action = (id: string, label: string, work: () => Promise<void>, disabled = false) => ({id, label, disabled: busy || disabled, loading: busy, onPress: () => {void run(work);}});
  const backAction = stage !== 'welcome' || onBack ? {id: 'back', label: t('action.back'), disabled: busy, onPress: back} : undefined;
  const failure = error ? presentError(error, 'sign-in') : undefined;
  const status = failure ? <Text accessibilityRole="alert" style={[theme.type.caption, {color: theme.colors.danger, marginBottom: 16}]}>{failure.body}</Text> : null;
  const layout = (title: string, body?: string, before?: React.ReactNode, primary?: ReturnType<typeof action>, more?: React.ReactNode) => <StateLayout testID="accounts-entry" title={title} body={body} beforeActions={<>{before}{status}</>} primaryAction={primary} secondaryAction={backAction}>{more}</StateLayout>;
  if (Platform.isTV && stage === 'tv-required-setup' && requiredSetup) return <TVRequiredSetupHandoff serverName={requiredSetup.serverName}
    requirement={requiredSetup.requirement} url={new URL('/settings/profile', requiredSetup.serverOrigin).href} busy={busy}
    copy={{body: requiredSetup.requirement === 'password' ? 'next.auth.tv.requiredPasswordBody' : 'next.auth.tv.requiredTwoStepBody', reference: 'next.auth.tv.handoffHint'}}
    onSignInAgain={() => {if (!busy) {setRequiredSetup(undefined); setError(undefined); setStage('tv-credentials');}}} onBack={back}/>;
  if (Platform.isTV && stage === 'tv-credentials') return <TVCredentialForm {...(tvKind === 'local'
    ? {kind: 'local' as const, serverName: server!.name}
    : {kind: 'portico' as const, usernamePlaceholder: 'auth.usernameOrEmailPlaceholder' as const})}
    username={username} password={password} onUsernameChange={setUsername} onPasswordChange={setPassword}
    busy={busy} error={status} onBack={back} onSubmit={() => {void run(async () => {
      if (tvKind === 'portico') {await account.current!.password(username, password); setPassword(''); await directory();}
      else {const result = await operation.current!.signInLocal(username, password); setPassword(''); consume(result);}
    });}}/>;
  if (Platform.isTV && stage === 'factor') return <TVVerificationForm kind={factorKind.current} code={code} onCodeChange={setCode}
    recovery={recovery} recoveryCode={recoveryCode} onRecoveryCodeChange={setRecoveryCode} onRecoveryChange={value => {setRecovery(value); setCode(''); setRecoveryCode(''); setError(undefined);}}
    busy={busy} error={status} onSubmit={value => {void run(() => submitTVFactor(value));}} onBack={back}/>;
  if (stage === 'welcome') return <StateLayout testID="accounts-welcome" title={t('web.signin.welcomeHome')} beforeActions={status}
    primaryAction={action('portico', t('accounts.signIn.portico'), portico)} secondaryAction={{id: 'local', label: t('accounts.signIn.local'), onPress: () => {setStage('address');}}}
    detailsAction={backAction}/>;
  if (stage === 'address') return layout(t('accounts.signIn.local'), undefined, fields(field(t('accounts.signIn.address'), address, setAddress)), action('inspect', t('action.continue'), () => inspect(), !address.trim()), nearby.length > 0 &&
    <View style={{alignSelf: 'stretch', gap: 10, marginTop: 18}}><Text style={[theme.type.caption, {color: theme.colors.textSecondary}]}>{t('playOn.onThisNetwork')}</Text>
      {nearby.map(value => <View key={value.origin} style={{gap: 4}}><Button variant="glass" disabled={busy} onPress={() => {setAddress(value.origin); void run(() => inspect(value.origin));}}>{value.server.name}</Button>
        <Text style={[theme.type.caption, {color: theme.colors.textSecondary}]}>{new URL(value.origin).host}</Text></View>)}</View>);
  if (stage === 'uses-portico') return layout(t('accounts.signIn.usesPortico', {server: server!.name}), t('accounts.signIn.porticoNotice'), undefined, action('portico', t('accounts.signIn.continuePortico'), portico));
  if (stage === 'identity-code') return <StateLayout testID="accounts-identity-code" title={t('connection.identity.checkTitle', {server: identityAddress})} body={t('connection.identity.checkBody')}
    kicker={Platform.isTV ? undefined : <View><Text style={[theme.type.bodyStrong, {color: theme.colors.text}]}>{identityAddress}</Text></View>}
    beforeActions={<>{fields(<TextField label={t('connection.identity.codeLabel')} value={identityCode} autoCapitalize="characters" autoCorrect={false} editable={!busy}
      error={identityWrong ? t('connection.identity.codeWrong') : undefined} onChangeText={value => {
        const raw = value.toUpperCase().replace(/[\s-]/g, '').slice(0, 12), shown = raw.match(/.{1,4}/g)?.join('-') ?? '';
        setIdentityCode(shown); setIdentityWrong(false); if (Platform.isTV && raw.length === 12) void run(() => confirmCode(shown));
      }}/>) }{status}</>}
    primaryAction={Platform.isTV ? undefined : action('check-code', t('action.continue'), () => confirmCode(), identityCode.replace(/-/g, '').length !== 12)}
    secondaryAction={backAction} help={t('connection.identity.checkHome')}/>;
  if (stage === 'local') return layout(server!.name, t('accounts.signIn.localBody'), fields(field(t('auth.username'), username, setUsername, false, 'username'), field(t('auth.password'), password, setPassword, true, 'password')),
    action('local-sign-in', t('auth.signIn'), async () => {consume(await operation.current!.signInLocal(username, password)); setPassword('');}, !username || !password),
    <Button variant="text" disabled={busy} onPress={() => {void run(() => startTV('local'));}}>{t('auth.useCodeFromAnotherDevice')}</Button>);
  if (stage === 'factor') return layout(t('auth.enterVerificationCode'), undefined, fields(field(t('auth.verificationCode'), code, setCode)), action('factor', t('action.continue'), async () => {
    if (factorKind.current === 'portico') {await account.current!.factor(code); await directory();} else consume(await operation.current!.completeSecondFactor(code));
    setCode('');
  }, !code));
  if (stage === 'portico') return layout(t('accounts.signIn.portico'), t('auth.accountLead'), options?.password ? fields(field(t('auth.usernameOrEmail'), username, setUsername, false, 'username'), field(t('auth.password'), password, setPassword, true, 'password')) : undefined,
    options?.password ? action('account-password', t('auth.signIn'), async () => {await account.current!.password(username, password); await directory();}, !username || !password) : undefined,
    <View style={{alignSelf: 'stretch', gap: 10, marginTop: 10}}>{options?.providers.filter(value => value.enabled && (NativeModules.PorticoAccountAuth.canOpenBrowser || value.id === 'apple' && value.native && value.nativeClientIds.includes(NativeModules.PorticoAccountAuth.bundleId) && NativeModules.PorticoAccountAuth.canSignInApple)).map(value => <Button key={value.id} variant="glass" disabled={busy} onPress={() => {void run(async () => {
      const tx = await account.current!.provider(value.id); setTransaction(tx);
      if (tx.status === 'verified' && !tx.needsUsername && !tx.mfaRequired) {await account.current!.finishProvider(); await directory();} else setStage('provider');
    });}}>{t(value.id === 'google' ? 'auth.signInWithGoogle' : 'auth.signInWithApple')}</Button>)}
    {options?.registration && <Button variant="text" disabled={busy} onPress={() => {setPassword(''); setStage('register');}}>{t('auth.createAccount')}</Button>}</View>);
  if (stage === 'register') return layout(t('auth.createYourAccount'), undefined, fields(field(t('auth.username'), username, setUsername), field(t('auth.yourName'), name, setName), field(t('auth.email'), email, setEmail), field(t('auth.password'), password, setPassword, true)),
    action('register', t('auth.createAccount'), async () => {const value = await account.current!.register(username, name, password, email); setPassword(''); setMasked(value.maskedAddress); setStage('verify');}, !username || !name || !password || !email));
  if (stage === 'verify') return layout(t('auth.checkEmail'), t('auth.codeSentTo', {address: masked}), fields(field(t('auth.verificationCode'), code, setCode)), action('verify', t('action.continue'), async () => {await account.current!.verifyRegistration(code); await directory();}, !code));
  if (stage === 'provider') return layout(t('accounts.signIn.portico'), undefined, fields(
    transaction?.needsUsername && field(t('auth.username'), username, setUsername), transaction?.needsUsername && field(t('auth.yourName'), name, setName),
    transaction?.mfaRequired && field(t('auth.verificationCode'), code, setCode), !transaction?.contactVerified && field(t('auth.email'), email, setEmail)),
    action('provider-complete', t('action.continue'), async () => {
      if (!transaction?.contactVerified) {const challenge = await account.current!.sendContact(email); contact.current = challenge.challengeId; setMasked(challenge.maskedAddress); setCode(''); setStage('contact');}
      else {await account.current!.finishProvider(username || undefined, name || undefined, code || undefined); await directory();}
    }));
  if (stage === 'contact') return layout(t('auth.checkEmail'), t('auth.codeSentTo', {address: masked}), fields(field(t('auth.verificationCode'), code, setCode)), action('contact', t('action.continue'), async () => {
    await account.current!.verifyContact(contact.current!, code); setTransaction(value => value && {...value, contactVerified: true}); setCode(''); setStage('provider');
  }, !code));
  if (stage === 'servers') return layout(t('portico.landing.pickTitle'), servers.length ? t('accounts.session.portico') : t('web.hostedAccount.noServersBody'),
    <View style={{alignSelf: 'stretch', gap: 12, marginBottom: 18}}>{servers.filter(value => !server || server.signIn !== 'portico' || server.id === value.id).map(value => <Button key={value.id} variant="glass" disabled={busy} onPress={() => {void run(async () => {
      operation.current?.dispose(); const next = operation.current = new NativeServerSignIn(); const result = await next.connectPortico(value);
      if (!lifetime.current) return; if (result.kind !== 'complete') setServer(next.serverDescriptor()); consume(result);
    });}}>{value.name}</Button>)}</View>, undefined,
    <Button variant="text" disabled={busy} onPress={() => setStage('account-sign-out')}>{t('accounts.signOut.portico')}</Button>);
  if (stage === 'account-sign-out') return layout(t('accounts.signOut.portico'), undefined, undefined,
    action('account-sign-out', t('action.signOut'), async () => {await nativeAccounts.signOutPorticoAccount(accountScope.current!); reset();}));
  if (stage === 'profiles') return layout(t('accounts.profiles.onServer', {server: server!.name}), t('accounts.session.' + server!.signIn as 'accounts.session.portico' | 'accounts.session.local'),
    <ProfilePicker profiles={profiles.map(value => ({id: value.id, name: value.name, initial: [...value.name][0] ?? '', color: value.art, primary: value.primary, pinRequired: value.pinRequired, disabled: busy}))} showTitle={false}
      onSelect={id => {const value = profiles.find(item => item.id === id)!; if (value.pinRequired) {setProfile(value); setCode(''); setStage('profile-pin');} else void run(() => choose(id));}}/>);
  if (stage === 'profile-pin') return layout(t('profile.pinTitle', {name: profile!.name}), undefined, fields(field(t('pin.fourDigit'), code, setCode, true)), action('profile-pin', t('action.continue'), () => choose(profile!.id, code), !/^\d{4}$/.test(code)));
  const consentBody = tvKind === 'local' && server
    ? tvState.verificationUri ? t('accounts.consent.local', {server: server.name, address: tvState.verificationUri}) : undefined
    : t('accounts.consent.portico');
  if (Platform.isTV) return <TVCodePresenter {...(tvKind === 'local' ? {mode: 'local' as const, serverName: server!.name} : {mode: 'portico' as const})} body={consentBody}
    verificationUri={tvState.verificationUri} verificationUriComplete={tvState.verificationUriComplete} userCode={tvState.userCode}
    status={<>{status}{t(tvState.phase === 'denied' ? 'activation.declined' : tvState.phase === 'error' ? 'activation.failed' : 'activation.codeRefreshes')}</>}
    busy={busy} onTypeCredentials={() => {void run(typeTVCredentials);}} onBack={back}/>;
  return layout(t('activation.title'), consentBody,
    <View style={{gap: 16, marginBottom: 20}}>{tvState.verificationUriComplete && <QRCode value={tvState.verificationUriComplete} size={theme.isTV ? 240 : 180}/>}
      <Text selectable style={[theme.type.title, {color: theme.colors.text}]}>{tvState.userCode ?? t('activation.preparingCode')}</Text>
      {tvState.verificationUri && <Text selectable style={[theme.type.body, {color: theme.colors.textSecondary}]}>{tvState.verificationUri}</Text>}
      <Text style={[theme.type.caption, {color: theme.colors.textTertiary}]}>{t(tvState.phase === 'denied' ? 'activation.declined' : tvState.phase === 'error' ? 'activation.failed' : 'activation.codeRefreshes')}</Text></View>,
    tvState.phase === 'error' || tvState.phase === 'denied' || error ? action('new-code', t('activation.getNewCode'), async () => {
      tvOff.current?.(); tvOff.current = undefined; await tv.current!.cancel(); await startTV(server?.signIn === 'local' ? 'local' : 'portico');
    }) : undefined);
}
