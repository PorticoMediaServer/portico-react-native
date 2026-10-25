import React, {useEffect, useLayoutEffect, useRef, useState} from 'react';
import {AppState, BackHandler, Linking, NativeModules, Platform, TVEventControl, Text, View} from 'react-native';
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
import {Button, Focusable, TextField} from '../../kit/controls';
import {Icon} from '../../kit/Icon';
import {ProfilePicker} from '../../kit/artwork';
import {useTheme} from '../../kit/theme';
import {nativeAccounts} from '../../platform/accounts';
import {NativeServerSignIn} from '../../platform/server-sign-in';
import {HostedSignInUnavailable} from '../../platform/hosted-sign-in-unavailable';
import {NativePorticoSignIn} from '../../platform/portico-sign-in';
import {nativeNetworkFetch, browseNearby} from '../../platform/server-connections';
import {createNativePorticoTVSignIn} from '../../platform/tv-sign-in';
import {hostedUrl} from '../../platform/account-authority';
import {TVCredentialForm, TVCodePresenter, TVVerificationForm, TVRequiredSetupHandoff, TVFrontDoor, TVProfilePINForm, TVForgotPINHandoff} from '../../tv/auth';
import {TVIdentityCodeForm} from '../../tv/auth/TVIdentityCodeForm';
import type {NativeProfileRecovery} from '../../platform/profile-recovery';
import {PhoneFrontDoor} from './PhoneFrontDoor';
import {PhoneAccountMoveNotice} from './PhoneAccountMoveNotice';
import {PhoneMovePassword} from './PhoneMovePassword';
import {PhoneMoveCode} from './PhoneMoveCode';
import {DirectoryAccessRefused} from './DirectoryAccessRefused';
import {directoryAccessRefused, directoryClockSkew, directoryIdentityUnconfirmed} from './directory-refusal';
import {PhonePINEntry} from './PhonePINEntry';
import {PhoneProfileRecovery} from './PhoneProfileRecovery';
import {directoryFailure, directoryOfflineBody, directoryRows, nextRetryDelay} from './directory-chooser';

export type NativeAccountEntryStage = 'welcome' | 'address' | 'identity-code' | 'local' | 'factor' | 'uses-portico' | 'portico' | 'forgot' | 'forgot-sent' | 'register' | 'verify' | 'provider' | 'contact' | 'servers' | 'account-sign-out' | 'profiles' | 'profile-pin' | 'profile-forgot-pin' | 'tv' | 'tv-credentials' | 'tv-required-setup' | 'member-move';
type MemberMove = Awaited<ReturnType<NativeServerSignIn['createMemberMove']>>;
type MemberMoveSnapshot = ReturnType<MemberMove['getSnapshot']>;
type PINRecovery = {controller: NativeProfileRecovery; profile: ManagedProfile; operation: NativeServerSignIn; retired: boolean};
type RequiredSetup = Readonly<{kind: 'required-setup'; requirement: 'password' | 'two-step'; serverName: string; serverOrigin: string}>;
type Result = {kind: 'profiles'; profiles: readonly ManagedProfile[]} | {kind: 'challenge'; expiresAt: string} | {kind: 'complete'} | RequiredSetup;
const t = defaultI18n.t;

/** Current normal entry, drawn in connect39 onward. The separately labelled historical
 * setup entry is not imported. Every button below dispatches an actual native/core command. */
export function AccountEntry({onBack, onComplete, onStageChange, initialStage = 'welcome', initialAddress = ''}: {onBack?: () => void; onComplete: () => void; onStageChange?: (stage: NativeAccountEntryStage) => void; initialStage?: 'welcome' | 'address'; initialAddress?: string}) {
  const theme = useTheme(), [stage, setStage] = useState<NativeAccountEntryStage>(initialStage), [busy, setBusy] = useState(false), [error, setError] = useState<unknown>();
  const [address, setAddress] = useState(initialAddress), [username, setUsername] = useState(''), [password, setPassword] = useState(''), [code, setCode] = useState('');
  const [name, setName] = useState(''), [email, setEmail] = useState(''), [masked, setMasked] = useState('');
  const [server, setServer] = useState<ServerSignIn>(), [profiles, setProfiles] = useState<readonly ManagedProfile[]>([]), [profile, setProfile] = useState<ManagedProfile>();
  const [identityCode, setIdentityCode] = useState(''), [identityWrong, setIdentityWrong] = useState(false), [identityAddress, setIdentityAddress] = useState('');
  const identityOrigin = useRef<string | undefined>(undefined);
  const [servers, setServers] = useState<HostedServer[]>([]), [target, setTarget] = useState<HostedServer>(), [retryIn, setRetryIn] = useState(20), [appActive, setAppActive] = useState(AppState.currentState === 'active'), [options, setOptions] = useState<IdentityOptions>(), [transaction, setTransaction] = useState<IdentityTransaction>();
  const [tvState, setTVState] = useState<SetupCodeSnapshot<unknown>>({phase: 'idle'});
  const [tvKind, setTVKind] = useState<'local' | 'portico'>('portico'), [recovery, setRecovery] = useState(false), [recoveryCode, setRecoveryCode] = useState('');
  const [requiredSetup, setRequiredSetup] = useState<RequiredSetup>();
  const [directoryList, setDirectoryList] = useState<'idle' | 'loading' | 'failed'>('idle');
  const [memberMove, setMemberMove] = useState<MemberMove>(), [moveSnapshot, setMoveSnapshot] = useState<MemberMoveSnapshot>();
  const memberMoveRef = useRef<MemberMove | undefined>(undefined), memberOperation = useRef<NativeServerSignIn | undefined>(undefined), memberFactorOperation = useRef<NativeServerSignIn | undefined>(undefined);
  const stopMemberMove = () => {memberMoveRef.current?.dispose(); memberMoveRef.current = undefined; memberOperation.current = undefined; setMemberMove(undefined); setMoveSnapshot(undefined);};
  useEffect(() => {if (!memberMove) return; const publish = () => setMoveSnapshot(memberMove.getSnapshot()); publish(); return memberMove.subscribe(publish);}, [memberMove]);
  const [pinRecovery, setPinRecovery] = useState<PINRecovery>();
  const [nearby, setNearby] = useState<readonly {origin: string; server: ServerSignIn}[]>([]);
  const lifetime = useRef(true), directoryAttempt = useRef(0), retryDelay = useRef(20), operation = useRef<NativeServerSignIn | undefined>(undefined), account = useRef<NativePorticoSignIn | undefined>(undefined);
  const pinRecoveryRef = useRef<PINRecovery | undefined>(undefined), profileRef = useRef(profile);
  profileRef.current = profile;
  const retireRecovery = (expected = pinRecoveryRef.current) => {
    if (!expected || pinRecoveryRef.current !== expected || expected.retired) return false;
    expected.retired = true; pinRecoveryRef.current = undefined; expected.controller.dispose(); setPinRecovery(undefined); return true;
  };
  const targetRef = useRef(target), activeRef = useRef(appActive), retryEpoch = useRef(0), remainingRetry = useRef(20);
  const retryTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const directoryConnectRef = useRef<(value: HostedServer, automatic?: boolean) => void>(() => {});
  const stopRetry = () => {++retryEpoch.current; if (retryTimer.current !== undefined) clearTimeout(retryTimer.current); retryTimer.current = undefined;};
  const busyRef = useRef(busy), stageRef = useRef(stage), onBackRef = useRef(onBack), backRef = useRef<() => void>(() => {});
  busyRef.current = busy; stageRef.current = stage; onBackRef.current = onBack;
  const tv = useRef<SetupCodeService<LocalSession> | SetupCodeService<HostedSession> | undefined>(undefined), tvOff = useRef<(() => void) | undefined>(undefined);
  const contact = useRef<string | undefined>(undefined), factorKind = useRef<'portico' | 'local'>('local');
  const accountScope = useRef<{accountId: string; familyId: string} | undefined>(undefined);
  const acting = useRef(false), adoptingTV = useRef(false);
  // Publish only the public stage before layout observers can collect this commit.
  // Credentials, server/profile data and commands never leave through this port.
  useLayoutEffect(() => {onStageChange?.(stage);}, [onStageChange, stage]);
  useEffect(() => {lifetime.current = true; return () => {lifetime.current = false; memberMoveRef.current?.dispose(); retireRecovery(); stopRetry(); operation.current?.dispose(); account.current?.dispose(); tvOff.current?.(); tv.current?.pause();};}, []);
  useEffect(() => {const subscription = AppState.addEventListener('change', state => {activeRef.current = state === 'active'; if (!activeRef.current) stopRetry(); setAppActive(activeRef.current);}); return () => subscription.remove();}, []);
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
      else {if (stage === 'profile-pin' || (Platform.isTV && stage === 'factor' && !recovery)) setCode(''); setError(failure);}
    }} finally {acting.current = false; if (lifetime.current) setBusy(adoptingTV.current);}
  };
  const reset = () => {setDirectoryList('idle'); memberFactorOperation.current = undefined; stopMemberMove(); retireRecovery(); stopRetry(); targetRef.current = undefined; stageRef.current = initialStage; ++directoryAttempt.current; acting.current = false; operation.current?.dispose(); operation.current = undefined; account.current?.dispose(); account.current = undefined;
    tvOff.current?.(); tvOff.current = undefined; if (tv.current) void tv.current.cancel().catch(setError); tv.current = undefined;
    setPassword(''); setCode(''); setIdentityCode(''); setIdentityWrong(false); setIdentityAddress(''); identityOrigin.current = undefined; setTarget(undefined); setError(undefined); retryDelay.current = 20; setRetryIn(20); setStage(initialStage);};
  const cancelDirectory = () => {setDirectoryList('idle'); retireRecovery(); stopRetry(); targetRef.current = undefined; ++directoryAttempt.current; operation.current?.dispose(); operation.current = undefined; acting.current = false; setBusy(false); setTarget(undefined); setError(undefined);};
  const back = () => {
    if (stage === 'member-move') {stopMemberMove(); setStage(server?.signIn === 'local' ? 'local' : 'uses-portico'); return;}
    if (pinRecoveryRef.current) {retireRecovery(); setCode(''); return;}
    if (stage === 'servers' && target) {cancelDirectory(); return;}
    if (stage === 'profile-forgot-pin') {setCode(''); setError(undefined); setStage('profile-pin'); return;}
    // Account help returns to the Portico Account form that opened it, not the front door.
    if (stage === 'forgot' || stage === 'forgot-sent') {setPassword(''); setError(undefined); setStage('portico'); return;}
    if (theme.isTV && stage === 'profile-pin') {setCode(''); setProfile(undefined); setError(undefined); setStage('profiles'); return;}
    if (Platform.isTV && (stage === 'tv-credentials' || stage === 'factor' || stage === 'tv-required-setup')) {void run(returnToTVCode); return;}
    if (stage === initialStage) onBack?.(); else reset();
  };
  backRef.current = back;
  useEffect(() => {const listener = BackHandler.addEventListener('hardwareBackPress', () => {
    if (busyRef.current || adoptingTV.current) return true;
    if (stageRef.current === 'welcome' && !onBackRef.current) return false;
    backRef.current(); return true;
  }); return () => listener.remove();}, []);
  useEffect(() => {
    if (!Platform.isTV) return;
    if (stage !== 'welcome' || onBack) TVEventControl.enableTVMenuKey();
    else TVEventControl.disableTVMenuKey();
    return () => TVEventControl.disableTVMenuKey();
  }, [stage, onBack]);
  const consume = (result: Result) => {
    if (!lifetime.current) return;
    if (result.kind === 'required-setup') {
      if (!Platform.isTV) throw Object.assign(new Error('native_required_account_setup'), {code: 'access_refused'});
      setPassword(''); setCode(''); setRecoveryCode(''); setRecovery(false); setProfiles([]); setProfile(undefined);
      setTransaction(undefined); setOptions(undefined); setName(''); setEmail(''); setMasked('');
      setIdentityCode(''); setIdentityWrong(false); setIdentityAddress(''); identityOrigin.current = undefined;
      accountScope.current = undefined; contact.current = undefined;
      setRequiredSetup(result); setStage('tv-required-setup');
    }
    else if (result.kind === 'profiles') {setServer(operation.current!.serverDescriptor()); setProfiles(result.profiles); setStage('profiles');}
    else if (result.kind === 'challenge') {factorKind.current = 'local'; setCode(''); setRecovery(false); setStage('factor');}
    else onComplete();
  };
  useEffect(() => {
    if (stage !== 'member-move' || !memberMove || moveSnapshot?.phase !== 'adopted'
      || moveSnapshot.result?.kind !== 'challenge' || memberOperation.current !== operation.current) return;
    const result = memberMove.takeAcceptedResult();
    if (result?.kind === 'challenge') {memberFactorOperation.current = operation.current; consume(result);}
  }, [stage, memberMove, moveSnapshot]);
  const directory = async () => {
    const move = memberMoveRef.current;
    if (move && memberOperation.current === operation.current && move.getSnapshot().phase === 'portico') {
      await move.redeemPortico();
      if (lifetime.current && memberMoveRef.current === move && memberOperation.current === operation.current) setStage('member-move');
      return;
    }
    const attempt = ++directoryAttempt.current;
    const credentials = nativeAccounts.accountCredentials(), session = await credentials.accessSession();
    const current = () => {
      const live = credentials.getSnapshot().session;
      return lifetime.current && attempt === directoryAttempt.current && live?.account.id === session.account.id && live.familyId === session.familyId;
    };
    if (!current()) return;
    accountScope.current = {accountId: session.account.id, familyId: session.familyId};
    stopRetry(); targetRef.current = undefined; setTarget(undefined); setError(undefined); setPassword('');
    setServers([]); setDirectoryList('loading'); setStage('servers');
    try {
      const out = await new HttpHostedApi(hostedUrl, session.accessToken, nativeNetworkFetch).servers();
      if (!current()) return;
      if (!out || !Array.isArray(out.items) || out.items.some(value => !value || typeof value.id !== 'string' || !value.id ||
        typeof value.name !== 'string' || !value.name || typeof value.baseUrl !== 'string' || typeof value.publicKey !== 'string' ||
        !Number.isSafeInteger(value.policyRevision) || value.policyRevision < 0) || new Set(out.items.map(value => value.id)).size !== out.items.length)
        throw Object.assign(new Error('native_directory_invalid'), {code: 'invalid_response'});
      setServers(out.items); setDirectoryList('idle');
    } catch (failure) {
      if (!current()) return;
      const presentation = presentError(failure, 'portico-account');
      if (presentation.silent) {setDirectoryList('idle'); return;}
      if (['offline', 'unreachable', 'timeout', 'busy', 'unavailable', 'invalid-response', 'rate-limited'].includes(presentation.category)) {
        setDirectoryList('failed'); return;
      }
      setDirectoryList('idle'); throw failure;
    }
  };
  const connectDirectory = (value: HostedServer, automatic = false) => {
    if (busyRef.current || acting.current || adoptingTV.current || !lifetime.current) return;
    if (automatic && (stageRef.current !== 'servers' || targetRef.current !== value || !activeRef.current)) return;
    stopRetry(); targetRef.current = value;
    if (!automatic) {retryDelay.current = 20; setRetryIn(20);}
    remainingRetry.current = retryDelay.current;
    const attempt = ++directoryAttempt.current;
    setTarget(value); setError(undefined); acting.current = true; setBusy(true);
    void (async () => {
      let next: NativeServerSignIn | undefined;
      try {
        retireRecovery(); operation.current?.dispose(); next = operation.current = new NativeServerSignIn();
        const result = await next.connectPortico(value);
        if (!lifetime.current || attempt !== directoryAttempt.current) return;
        if (result.kind !== 'complete') setServer(next.serverDescriptor()); consume(result);
      } catch (failure) {
        if (lifetime.current && attempt === directoryAttempt.current) {
          if (failure instanceof HostedSignInUnavailable) {retryDelay.current = Math.max(retryDelay.current, failure.retryAfterSeconds); remainingRetry.current = retryDelay.current; setRetryIn(remainingRetry.current);}
          setError(failure);
        }
      } finally {
        if (!lifetime.current) acting.current = false;
        else if (attempt === directoryAttempt.current) {acting.current = false; setBusy(false);}
      }
    })();
  };
  directoryConnectRef.current = connectDirectory;
  const chooseAnother = () => cancelDirectory();
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
  const beginMemberMove = async () => {
    const source = operation.current;
    if (!source || !server || server.move !== 'to_portico' || Platform.isTV) return;
    stopMemberMove();
    const move = await source.createMemberMove('password');
    if (!lifetime.current || operation.current !== source) {move.dispose(); return;}
    memberMoveRef.current = move; memberOperation.current = source;
    setMemberMove(move); setMoveSnapshot(move.getSnapshot()); setStage('member-move');
  };
  const beginMemberCode = async () => {
    const source = operation.current;
    if (!source || !server || server.signIn !== 'local' || server.move !== 'to_local' || Platform.isTV) return;
    stopMemberMove();
    const move = await source.createMemberMove('code');
    if (!lifetime.current || operation.current !== source) {move.dispose(); return;}
    memberMoveRef.current = move; memberOperation.current = source;
    setMemberMove(move); setMoveSnapshot(move.getSnapshot()); setStage('member-move');
  };
  const createMoveAccount = async () => {
    const credentials = nativeAccounts.accountCredentials(); await credentials.synchronize();
    if (!lifetime.current || !memberMoveRef.current) return;
    const existing = credentials.getSnapshot().session;
    if (existing) {accountScope.current = {accountId: existing.account.id, familyId: existing.familyId}; setStage('account-sign-out'); return;}
    account.current?.dispose(); const next = account.current = new NativePorticoSignIn();
    const available = await next.prepare();
    if (lifetime.current && account.current === next && memberMoveRef.current) {setOptions(available); setStage('register');}
  };
  const differentMoveAccount = async () => {
    const credentials = nativeAccounts.accountCredentials(); await credentials.synchronize();
    if (!lifetime.current || !memberMoveRef.current) return;
    const signedIn = credentials.getSnapshot().session;
    if (signedIn) {accountScope.current = {accountId: signedIn.account.id, familyId: signedIn.familyId}; setStage('account-sign-out');}
    else {memberMoveRef.current.cancel(); setStage('member-move');}
  };
  const requestReset = async () => {
    await account.current!.forgot(username, email);
    if (lifetime.current) {setPassword(''); setCode(''); setStage('forgot-sent');}
  };
  const inspect = async (origin = address) => {
    retireRecovery(); operation.current?.dispose(); const next = operation.current = new NativeServerSignIn(nativeAccounts, {requiredSetupHandoff: Platform.isTV});
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
  const failure = error ? presentError(error, stage === 'profile-pin' ? 'profiles' : 'sign-in') : undefined;
  const status = failure && !failure.silent ? <Text accessibilityRole="alert" style={[theme.type.caption, {color: theme.colors.danger, marginBottom: 16}]}>{failure.body}</Text> : null;
  const directoryView = stage === 'servers' ? directoryFailure(target, error) : 'other';
  const hostedWaiting = stage === 'servers' && !!target && error instanceof HostedSignInUnavailable;
  useEffect(() => {
    if (stage !== 'servers' || !target || (directoryView !== 'waiting' && !hostedWaiting) || busy || !appActive) return;
    const attempt = directoryAttempt.current, epoch = ++retryEpoch.current, capturedTarget = target;
    const current = () => lifetime.current && retryEpoch.current === epoch && directoryAttempt.current === attempt
      && stageRef.current === 'servers' && targetRef.current === capturedTarget && activeRef.current
      && !busyRef.current && !acting.current && !adoptingTV.current;
    const tick = () => {
      if (!current()) return;
      const seconds = remainingRetry.current;
      setRetryIn(seconds);
      if (seconds <= 0) {retryDelay.current = nextRetryDelay(retryDelay.current); directoryConnectRef.current(capturedTarget, true); return;}
      retryTimer.current = setTimeout(() => {if (!current()) return; remainingRetry.current -= 1; tick();}, 1000);
    };
    tick();
    const stopOwnedRetry = () => {if (retryEpoch.current === epoch) stopRetry();};
    return stopOwnedRetry;
  }, [stage, target, directoryView, hostedWaiting, busy, appActive]);
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
  if (stage === 'welcome' && theme.isTV) return <TVFrontDoor busy={busy} error={status}
    onPortico={() => {void run(portico);}} onLocal={() => {if (!busy) setStage('address');}}/>;
  if (stage === 'welcome' && theme.platform === 'phone') return <PhoneFrontDoor busy={busy} error={status}
    onPortico={() => {void run(portico);}} onLocal={() => {if (!busy) setStage('address');}}/>;
  if (stage === 'welcome') return <StateLayout testID="accounts-welcome" title={t('web.signin.welcomeHome')} beforeActions={status}
    primaryAction={action('portico', t('accounts.signIn.portico'), portico)} secondaryAction={{id: 'local', label: t('accounts.signIn.local'), onPress: () => {setStage('address');}}}
    detailsAction={backAction}/>;
  if (stage === 'address') return layout(t('accounts.signIn.local'), undefined, fields(field(t('accounts.signIn.address'), address, setAddress)), action('inspect', t('action.continue'), () => inspect(), !address.trim()), nearby.length > 0 &&
    <View style={{alignSelf: 'stretch', gap: 10, marginTop: 18}}><Text style={[theme.type.caption, {color: theme.colors.textSecondary}]}>{t('playOn.onThisNetwork')}</Text>
      {nearby.map(value => <View key={value.origin} style={{gap: 4}}><Button variant="glass" disabled={busy} onPress={() => {setAddress(value.origin); void run(() => inspect(value.origin));}}>{value.server.name}</Button>
        <Text style={[theme.type.caption, {color: theme.colors.textSecondary}]}>{new URL(value.origin).host}</Text></View>)}</View>);
  if (stage === 'uses-portico') return layout(t('accounts.signIn.usesPortico', {server: server!.name}), t('accounts.signIn.porticoNotice'), undefined, action('portico', t('accounts.signIn.continuePortico'), portico),
    !Platform.isTV && server?.move === 'to_portico' && <Button variant="text" disabled={busy} onPress={() => {void run(beginMemberMove);}}>{t('accounts.move.oldPasswordAction')}</Button>);
  if (stage === 'member-move' && memberMove && moveSnapshot && memberOperation.current === operation.current) {
    if (moveSnapshot.phase === 'code' || moveSnapshot.phase === 'local') return <PhoneMoveCode controller={memberMove} onBack={back}/>;
    if (moveSnapshot.phase === 'password') return <PhoneMovePassword controller={memberMove} serverName={server!.name} onBack={back}/>;
    if (moveSnapshot.phase === 'portico') return <PhoneAccountMoveNotice busy={busy || moveSnapshot.busy} state={{kind: 'to-portico', serverName: server!.name,
      onContinue: () => {void run(portico);}, onCreateAccount: () => {void run(createMoveAccount);}}}/>;
    if (moveSnapshot.phase === 'collision' && moveSnapshot.collision) return <PhoneAccountMoveNotice busy={busy || moveSnapshot.busy}
      state={{kind: 'collision', details: moveSnapshot.collision, onDifferentAccount: () => {void run(differentMoveAccount);}, onBack: back}}/>;
    if (moveSnapshot.phase === 'adopted' && moveSnapshot.result && moveSnapshot.result.kind !== 'challenge') return <PhoneAccountMoveNotice state={{kind: 'linked', onChooseProfile: () => {
      const result = memberMove.takeAcceptedResult(); if (!result || memberOperation.current !== operation.current) return; stopMemberMove(); consume(result);
    }}}/>;
  }
  if (stage === 'identity-code' && Platform.isTV) return <TVIdentityCodeForm server={identityAddress} code={identityCode} wrong={identityWrong} busy={busy}
    onChange={value => {setIdentityCode(value); setIdentityWrong(false);}} onSubmit={value => {void run(() => confirmCode(value));}}/>;
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
    <View style={{alignSelf: 'stretch', gap: 8}}>
      <Button variant="text" disabled={busy} onPress={() => {void run(() => startTV('local'));}}>{t('auth.useCodeFromAnotherDevice')}</Button>
      {!Platform.isTV && server?.move === 'to_local' && <Button variant="text" disabled={busy} onPress={() => {void run(beginMemberCode);}}>{t('accounts.move.haveCode')}</Button>}
    </View>);
  if (stage === 'factor') return layout(t('auth.enterVerificationCode'), undefined, fields(field(t('auth.verificationCode'), code, setCode)), action('factor', t('action.continue'), async () => {
    if (factorKind.current === 'portico') {await account.current!.factor(code); await directory();} else if (memberFactorOperation.current && memberFactorOperation.current === operation.current) {
      const result = await memberFactorOperation.current.completeMemberMoveFactor(code); memberFactorOperation.current = undefined; stopMemberMove(); consume(result);
    } else consume(await operation.current!.completeSecondFactor(code));
    setCode('');
  }, !code));
  if (stage === 'portico') return layout(t('accounts.signIn.portico'), t('auth.accountLead'), options?.password ? fields(field(t('auth.usernameOrEmail'), username, setUsername, false, 'username'), field(t('auth.password'), password, setPassword, true, 'password')) : undefined,
    options?.password ? action('account-password', t('auth.signIn'), async () => {await account.current!.password(username, password); await directory();}, !username || !password) : undefined,
    <View style={{alignSelf: 'stretch', gap: 10, marginTop: 10}}>{options?.providers.filter(value => value.enabled && (NativeModules.PorticoAccountAuth.canOpenBrowser || value.id === 'apple' && value.native && value.nativeClientIds.includes(NativeModules.PorticoAccountAuth.bundleId) && NativeModules.PorticoAccountAuth.canSignInApple)).map(value => <Button key={value.id} variant="glass" disabled={busy} onPress={() => {void run(async () => {
      const tx = await account.current!.provider(value.id); setTransaction(tx);
      if (tx.status === 'verified' && !tx.needsUsername && !tx.mfaRequired) {await account.current!.finishProvider(); await directory();} else setStage('provider');
    });}}>{t(value.id === 'google' ? 'auth.signInWithGoogle' : 'auth.signInWithApple')}</Button>)}
    {options?.registration && <Button variant="text" disabled={busy} onPress={() => {setPassword(''); setStage('register');}}>{t('auth.createAccount')}</Button>}
    {options?.recovery !== false && <Button variant="text" disabled={busy} onPress={() => {setPassword(''); setStage('forgot');}}>{t('auth.forgotPassword')}</Button>}
    <Button variant="text" disabled={busy} onPress={() => {setPassword(''); setStage('address');}}>{t('accounts.signIn.local')}</Button>
    <Text style={[theme.type.caption, {color: theme.colors.textSecondary, textAlign: 'center', marginTop: 6}]}>{t('auth.agreeToTerms')}{' '}
      <Text accessibilityRole="link" suppressHighlighting onPress={() => {void Linking.openURL('https://getportico.tv/terms').catch(() => {});}}
        style={{color: theme.colors.accent, textDecorationLine: 'underline'}}>{t('auth.terms')}</Text>{t('list.and', {first: '', second: ''})}
      <Text accessibilityRole="link" suppressHighlighting onPress={() => {void Linking.openURL('https://getportico.tv/privacy').catch(() => {});}}
        style={{color: theme.colors.accent, textDecorationLine: 'underline'}}>{t('auth.privacyPolicy')}</Text>.</Text></View>);
  if (stage === 'forgot') return layout(t('auth.forgotPasswordTitle'), t('auth.resetLinkLede'),
    fields(field(t('auth.username'), username, setUsername), field(t('auth.email'), email, setEmail)),
    action('request-reset', t('auth.resetLinkAction'), requestReset, !username.trim() || !/^\S+@\S+\.\S+$/.test(email.trim())),
    <Text style={[theme.type.caption, {color: theme.colors.textSecondary, marginTop: 4}]}>{t('auth.privacySameAnswer')}</Text>);
  if (stage === 'forgot-sent') return layout(t('auth.checkEmail'), t('auth.resetLinkSent'),
    <Text style={[theme.type.caption, {color: theme.colors.textSecondary, marginBottom: 16}]}>{t('auth.privacySameAnswer')}</Text>,
    action('back-to-sign-in', t('auth.backToSignIn'), async () => {if (lifetime.current) setStage('portico');}),
    <Text style={[theme.type.caption, {color: theme.colors.textSecondary, marginTop: 10}]}>{t('auth.noPasswordForSocial')}</Text>);
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
  if (stage === 'servers' && directoryList === 'loading') return <StateLayout testID="accounts-server-list-loading" title={t('web.chooser.loading')}/>;
  if (stage === 'servers' && directoryList === 'failed') return <StateLayout testID="accounts-server-list-failed" icon="i-warn" tone="error"
    title={t('web.chooser.loadFailed')} body={t('web.chooser.loadFailedBody')}
    primaryAction={{id: 'retry-server-list', label: t('web.chooser.tryAgain'), icon: 'i-retry', loading: busy, disabled: busy, onPress: () => {void run(directory);}}}/>;
  if (stage === 'servers' && target && directoryIdentityUnconfirmed(error)) return <StateLayout testID="accounts-server-unconfirmed" icon="i-question"
    title={t('web.chooser.unconfirmedTitle', {server: target.name})} body={t('web.chooser.unconfirmedBody')}
    primaryAction={{id: 'retry-identity', label: t('web.chooser.tryAgain'), icon: 'i-retry', loading: busy, disabled: busy, onPress: () => connectDirectory(target, true)}}
    secondaryAction={{id: 'choose-another', label: t('web.chooser.otherServer'), disabled: busy, onPress: chooseAnother}}/>;
  if (stage === 'servers' && target && directoryClockSkew(error)) return <StateLayout testID="accounts-server-clock" icon="i-clock"
    title={t('web.chooser.clockTitle', {server: target.name})} body={t('web.chooser.clockBody')}
    primaryAction={{id: 'retry-clock', label: t('web.chooser.tryAgain'), icon: 'i-retry', loading: busy, disabled: busy, onPress: () => connectDirectory(target, true)}}
    secondaryAction={{id: 'choose-another', label: t('web.chooser.otherServer'), disabled: busy, onPress: chooseAnother}}/>;
  if (stage === 'servers' && target && directoryAccessRefused(error)) return <DirectoryAccessRefused serverName={target.name} busy={busy}
    onOther={chooseAnother} onRefresh={() => {cancelDirectory(); void run(directory);}}/>;
  if (stage === 'servers' && target && directoryView === 'opening') return <StateLayout testID="accounts-server-opening" title={t('web.chooser.connecting', {server: target.name})}
    primaryAction={{id: 'choose-another', label: t('web.chooser.otherServer'), onPress: chooseAnother}}/>;
  if (stage === 'servers' && target && directoryView === 'unreachable') {
    const body = directoryOfflineBody(target);
    return <StateLayout testID="accounts-server-unreachable" title={t('web.chooser.unreachableTitle', {server: target.name})} body={t(body.key, body.values)}
      primaryAction={{id: 'try-again', label: t('web.chooser.tryAgain'), loading: busy, onPress: () => connectDirectory(target, true)}}
      secondaryAction={{id: 'choose-another', label: t('web.chooser.otherServer'), onPress: chooseAnother}}/>;
  }
  if (hostedWaiting && target) return <StateLayout testID="accounts-hosted-waiting" icon="i-cloud-off" title={t('web.chooser.accountWaitingTitle')}
    body={t('web.chooser.accountWaitingBody', {server: target.name})} retry={{progress: retryIn <= 0 ? 1 : 1 - retryIn / Math.max(retryDelay.current, 1), label: t('web.chooser.checkingAgain', {seconds: retryIn})}}
    primaryAction={{id: 'check-hosted-now', label: t('web.chooser.checkNow'), loading: busy, disabled: busy, onPress: () => connectDirectory(target, true)}}
    secondaryAction={{id: 'choose-another', label: t('web.chooser.otherServer'), onPress: chooseAnother}}/>;
  if (stage === 'servers' && target && directoryView === 'waiting') return <StateLayout testID="accounts-server-waiting" title={t('web.chooser.waitingTitle', {server: target.name})}
    body={t('web.chooser.waitingBody')} retry={{progress: retryIn <= 0 ? 1 : 1 - retryIn / Math.max(retryDelay.current, 1), label: t('web.chooser.checkingAgain', {seconds: retryIn})}}
    primaryAction={{id: 'check-now', label: t('web.chooser.checkNow'), loading: busy, onPress: () => connectDirectory(target, true)}}
    secondaryAction={{id: 'choose-another', label: t('web.chooser.otherServer'), onPress: chooseAnother}}/>;
  if (stage === 'servers') return layout(t('portico.landing.pickTitle'), servers.length ? t('accounts.session.portico') : t('web.hostedAccount.noServersBody'),
    <View style={{alignSelf: 'stretch', gap: 12, marginBottom: 18}}>{directoryRows(server && server.signIn === 'portico' ? servers.filter(value => value.id === server.id) : servers).map(row => {
      const value = servers.find(item => item.id === row.id)!;
      return <Focusable key={row.id} focusTreatment="none" disabled={busy} accessibilityLabel={`${row.name}${row.subtitle ? `, ${t(row.subtitle.key, row.subtitle.values)}` : ''}`}
        onPress={() => connectDirectory(value)}
        style={({focused}) => ({flexDirection: 'row', alignItems: 'center', gap: 14, paddingHorizontal: 16, paddingVertical: 14, borderRadius: 14, borderWidth: 1.5,
          borderColor: focused ? theme.colors.accentStrong : theme.colors.line, backgroundColor: focused ? `${theme.colors.text}14` : `${theme.colors.text}0A`,
          opacity: row.offline ? .55 : 1})}>
        <Icon name="i-server" size={22} color={theme.colors.textSecondary}/>
        <View style={{flex: 1, gap: 2}}>
          <Text style={[theme.type.bodyStrong, {color: theme.colors.text}]}>{row.name}</Text>
          {row.subtitle && <Text style={[theme.type.caption, {color: theme.colors.textSecondary}]}>{t(row.subtitle.key, row.subtitle.values)}</Text>}
        </View>
        <Icon name="i-right" size={20} color={theme.colors.textTertiary}/>
      </Focusable>;
    })}</View>, undefined,
    <Button variant="text" disabled={busy} onPress={() => setStage('account-sign-out')}>{t('accounts.signOut.portico')}</Button>);
  if (stage === 'account-sign-out') return layout(t('accounts.signOut.portico'), undefined, undefined,
    action('account-sign-out', t('action.signOut'), async () => {await nativeAccounts.signOutPorticoAccount(accountScope.current!); reset();}));
  if (pinRecovery) {
    const captured = pinRecovery;
    const current = () => lifetime.current && !captured.retired && pinRecoveryRef.current === captured
      && operation.current === captured.operation && profileRef.current === captured.profile && stageRef.current === 'profile-pin';
    return <PhoneProfileRecovery controller={captured.controller} profileName={captured.profile.name} username={username}
      onOpen={value => {
        if (!current() || captured.controller.getSnapshot().phase !== 'done' || !/^\d{4}$/.test(value) || busyRef.current || acting.current) return;
        retireRecovery(captured); setCode(value);
        void run(async () => {await captured.operation.chooseProfile(captured.profile.id, value); if (lifetime.current && operation.current === captured.operation) onComplete();});
      }}
      onClose={() => {if (!current()) return; retireRecovery(captured); setCode(''); setError(undefined);}}/>;
  }
  if (stage === 'profiles') return layout(t('accounts.profiles.onServer', {server: server!.name}), t('accounts.session.' + server!.signIn as 'accounts.session.portico' | 'accounts.session.local'),
    <ProfilePicker profiles={profiles.map(value => ({id: value.id, name: value.name, initial: [...value.name][0] ?? '', color: value.art, primary: value.primary, pinRequired: value.pinRequired, disabled: busy}))} preferredProfileId={theme.isTV ? profiles[0]?.id : undefined} showTitle={false}
      onSelect={id => {const value = profiles.find(item => item.id === id)!; if (value.pinRequired) {setProfile(value); setCode(''); setStage('profile-pin');} else void run(() => choose(id));}}/>);
  if (theme.isTV && stage === 'profile-forgot-pin') return <TVForgotPINHandoff profileName={profile!.name}
    url={new URL('/settings/profile', operation.current!.serverOrigin()).href} body="next.auth.tv.forgotPINBody" onBack={back}/>;
  if (theme.isTV && stage === 'profile-pin') return <TVProfilePINForm
    profile={{id: profile!.id, name: profile!.name, initial: [...profile!.name][0] ?? '', color: profile!.art, primary: profile!.primary, pinRequired: true}}
    code={code} onCodeChange={setCode} busy={busy} error={status} onBack={back}
    onSubmit={value => {void run(() => choose(profile!.id, value));}}
    onForgotPIN={() => {if (!busy) {setCode(''); setError(undefined); setStage('profile-forgot-pin');}}}/>;
  if (stage === 'profile-pin') return layout(t('profile.pinTitle', {name: profile!.name}), undefined,
    <View style={{alignSelf: 'stretch'}}><PhonePINEntry value={code} onChange={setCode} onComplete={value => {void run(() => choose(profile!.id, value));}} busy={busy} error={!!error}/>
      <View style={{alignItems: 'center', marginTop: 8}}><Button variant="text" disabled={busy} onPress={() => {if (busy || !profile || !operation.current) return; try {setError(undefined); retireRecovery(); const next: PINRecovery = {profile, operation: operation.current, controller: operation.current.profileRecovery(profile.id), retired: false}; pinRecoveryRef.current = next; setPinRecovery(next);} catch (failure) {setError(failure);}}}>{t('pin.forgot')}</Button></View></View>,
    action('profile-pin', t('action.continue'), () => choose(profile!.id, code), !/^\d{4}$/.test(code)));
  const consentBody = tvKind === 'local' && server
    ? tvState.verificationUri ? t('accounts.consent.local', {server: server.name, address: tvState.verificationUri}) : undefined
    : t('accounts.consent.portico');
  if (Platform.isTV) return <TVCodePresenter {...(tvKind === 'local' ? {mode: 'local' as const, serverName: server!.name} : {mode: 'portico' as const})} body={consentBody}
    verificationUri={tvState.verificationUri} verificationUriComplete={tvState.verificationUriComplete} userCode={tvState.userCode}
    status={<>{status}<Text style={[theme.type.caption, {color: theme.colors.textTertiary}]}>{t(tvState.phase === 'denied' ? 'activation.declined' : tvState.phase === 'error' ? 'activation.failed' : 'activation.codeRefreshes')}</Text></>}
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
