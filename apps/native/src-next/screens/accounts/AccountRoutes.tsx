import React, {useEffect, useRef, useState} from 'react';
import {BackHandler, Dimensions, Platform, Text, View} from 'react-native';
import {defaultI18n} from '../../../../../packages/i18n/src';
import {presentError} from '../../../../../packages/client-core/src/presentation/errors';
import type {ManagedProfile} from '../../../../../packages/client-core/src/profile-management';
import {HttpHostedApi} from '../../../../../packages/client-core/src';
import type {SetupPreview} from '../../../../../packages/client-core/src/setup-code';
import type {TVConsentApprover} from '../../../../../packages/client-core/src/tv-consent';
import type {AppServerSession} from '../../../../../packages/client-core/src/app-sessions';
import {routeOrigin} from '../../../../../packages/client-core/src/route-identity';
import {nativeAccounts} from '../../platform/accounts';
import {nativeAppSessions, subscribeNativeAppSessions} from '../../platform/app-session-storage';
import {nativeProfileSelection} from '../../platform/profile-selection';
import {NativeProfileRecovery, temporaryRecoveryApi} from '../../platform/profile-recovery';
import {hostedUrl} from '../../platform/account-authority';
import {nativeNetworkFetch} from '../../platform/server-connections';
import type {NativeShellBootstrapContext} from '../../shell/bootstrap';
import type {NativeShellRoute} from '../../shell/routes';
import {nativeShellRoutes, type NativeRouteFactory} from '../../shell/route-registry';
import {StateLayout} from '../../kit/states';
import {ProfilePicker} from '../../kit/artwork';
import {Button, Focusable, TextField} from '../../kit/controls';
import {BottomSheet} from '../../kit/overlays';
import {Icon} from '../../kit/Icon';
import {offlineDownloads, offlineOwnerKey} from '../../../platform/offline-downloads';
import {useTheme} from '../../kit/theme';
import {AccountEntry} from './AccountEntry';
import {PhonePINEntry} from './PhonePINEntry';
import {PhoneProfileRecovery} from './PhoneProfileRecovery';
import {PhoneServerChooser} from './PhoneServerChooser';
import {TVTrustedCertificates} from './TVTrustedCertificates';
import {TVServerChooser} from './TVServerChooser';
import {removeCapturedServerDownloads} from './sign-out-downloads';
import {TVProfilePINForm, TVForgotPINHandoff} from '../../tv/auth';

const t = defaultI18n.t;
type Panel = 'servers' | 'add' | 'sign-out-server' | 'sign-out-account' | 'consent-kind' | 'consent-code' | 'consent-review' | 'consent-done';

/** Genuine account destinations for the current authority. Shell media routes and Home
 * remain with their existing owners. Runtime disposal retires every private view below. */
export function AccountRoute({route, context}: {route: NativeShellRoute; context: NativeShellBootstrapContext}) {
  const back = () => {context.navigation.back(context.authority());};
  return route.kind === 'profiles' ? <ProfileRoute context={context} onBack={back}/> : <ServersRoute context={context} onBack={back}/>;
}

function ProfileRoute({context, onBack}: {context: NativeShellBootstrapContext; onBack: () => void}) {
  const theme = useTheme(), [profile, setProfile] = useState<ManagedProfile>(), [pin, setPin] = useState(''), [busy, setBusy] = useState(false), [error, setError] = useState<unknown>();
  const [forgotPIN, setForgotPIN] = useState(false), [recovery, setRecovery] = useState<{controller: NativeProfileRecovery; id: string; name: string}>();
  const selection = useRef<ReturnType<typeof nativeProfileSelection> | undefined>(undefined), alive = useRef(true), starting = useRef(false);
  useEffect(() => {alive.current = true; const session = context.session();
    if (session) selection.current = nativeProfileSelection(session.viewer.serverId, session.sessionFamilyId);
    return () => {alive.current = false; selection.current?.dispose();};
  }, [context]);
  const choose = async (id: string, code?: string) => {if (busy || !context.current()) return; setBusy(true); setError(undefined);
    try {await selection.current!.select(id, code);} catch (failure) {if (alive.current) {setPin(''); setError(failure);}} finally {if (alive.current) setBusy(false);}
  };
  const current = context.session();
  useEffect(() => () => {recovery?.controller.dispose();}, [recovery]);
  const startRecovery = async () => {
    const session = context.session(), target = profile;
    if (busy || starting.current || !session || !target || !context.current()) return;
    starting.current = true;
    try {
      const selected = await nativeAppSessions.selected();
      if (!selected || !context.current()) return;
      if (selected.connection.pin.serverId !== session.viewer.serverId
        || selected.connection.session.sessionFamilyId !== session.sessionFamilyId) return;
      if (!context.account.profiles.some(value => value.id === target.id)) return;
      const serverPin = selected.connection.pin;
      const authorityCurrent = () => {
        const now = context.session(), live = context.api.getRouteConnection()?.pin;
        return context.current() && !!now
          && now.sessionFamilyId === session.sessionFamilyId
          && now.viewer.serverId === session.viewer.serverId
          && now.viewer.accountId === session.viewer.accountId
          && now.viewer.profileId === session.viewer.profileId
          && now.viewer.authority === session.viewer.authority
          && !!live && live.serverId === serverPin.serverId && live.publicKey === serverPin.publicKey && live.fingerprint === serverPin.fingerprint;
      };
      setRecovery({id: target.id, name: target.name, controller: new NativeProfileRecovery({api: context.api, snapshot: context.account, profileId: target.id, selectedFamilyId: session.sessionFamilyId, kind: selected.signIn, authorityCurrent,
        temporary: grant => temporaryRecoveryApi(context.api, grant),
        portico: async () => {
          const credentials = nativeAccounts.accountCredentials(); await credentials.synchronize();
          const account = await credentials.accessSession();
          if (!account) throw new Error('Sign in to your Portico Account first.');
          return {hosted: new HttpHostedApi(hostedUrl, account.accessToken, nativeNetworkFetch), origin: hostedUrl,
            accountCurrent: () => {const live = credentials.getSnapshot().session; return !!live && live.account.id === account.account.id && live.familyId === account.familyId;}};
        }})});
    } catch (failure) {if (alive.current) setError(failure);}
    finally {starting.current = false;}
  };
  const back = () => {if (recovery) {recovery.controller.dispose(); setRecovery(undefined); setPin('');} else if (forgotPIN) {setForgotPIN(false); setPin(''); setError(undefined);} else if (profile) {setProfile(undefined); setPin('');} else onBack();};
  const backRef = useRef(back), busyRef = useRef(busy);
  backRef.current = back; busyRef.current = busy;
  useEffect(() => {const subscription = BackHandler.addEventListener('hardwareBackPress', () => {if (!busyRef.current) backRef.current(); return true;}); return () => subscription.remove();}, []);
  if (recovery) return <PhoneProfileRecovery controller={recovery.controller} profileName={recovery.name} username={context.account.account.username}
    onOpen={value => {const id = recovery.id; recovery.controller.dispose(); setRecovery(undefined); setPin(value); void choose(id, value);}}
    onClose={() => {recovery.controller.dispose(); setRecovery(undefined); setPin('');}}/>;
  if (theme.isTV && profile && forgotPIN) return <TVForgotPINHandoff profileName={profile.name}
    url={new URL('/settings/profile', routeOrigin(context.api.baseUrl)).href} body="next.auth.tv.forgotPINBody" onBack={back}/>;
  if (theme.isTV && profile) return <TVProfilePINForm
    profile={{id: profile.id, name: profile.name, initial: [...profile.name][0] ?? '', color: profile.art, primary: profile.primary, pinRequired: true}}
    code={pin} onCodeChange={setPin} busy={busy} error={error ? <Text accessibilityRole="alert" style={[theme.type.caption, {color: theme.colors.danger}]}>{presentError(error, 'profiles').body}</Text> : undefined}
    onSubmit={value => {void choose(profile.id, value);}} onBack={back}
    onForgotPIN={() => {if (!busy) {setPin(''); setError(undefined); setForgotPIN(true);}}}/>;
  return <StateLayout testID="accounts-profile-switch" title={profile ? t('profile.pinTitle', {name: profile.name}) : t('accounts.profiles.onServer', {server: context.serverName})}
    beforeActions={<View style={{alignSelf: 'stretch', marginBottom: 20}}>{profile ? <><PhonePINEntry value={pin} onChange={setPin} onComplete={value => {void choose(profile.id, value);}} busy={busy} error={!!error}/>
      <View style={{alignItems: 'center', marginTop: 8}}><Button variant="text" disabled={busy} onPress={() => {void startRecovery();}}>{t('pin.forgot')}</Button></View></> :
      <ProfilePicker profiles={context.account.profiles.map(value => ({id: value.id, name: value.name, initial: [...value.name][0] ?? '', color: value.art, primary: value.primary, pinRequired: value.pinRequired, disabled: busy}))}
        selectedId={current?.viewer.profileId} showTitle={false} onSelect={id => {const value = context.account.profiles.find(item => item.id === id)!;
          if (id === current?.viewer.profileId) onBack(); else if (value.pinRequired) {setProfile(value); setPin('');} else void choose(id);}}/>}
      {!!error && <Text accessibilityRole="alert" style={[theme.type.caption, {color: theme.colors.danger}]}>{presentError(error, 'profiles').body}</Text>}</View>}
    secondaryAction={{id: 'back', label: t('action.back'), disabled: busy, onPress: back}}/>;
}

/** Also usable when no selected server can restore: retained servers remain reachable. */
export function ServersRoute({context, onBack, onComplete, onSetupComplete}: {context?: NativeShellBootstrapContext; onBack?: () => void; onComplete?: () => void; onSetupComplete?: (serverId: string) => void}) {
  const theme = useTheme(), [panel, setPanel] = useState<Panel>('servers'), [servers, setServers] = useState<Awaited<ReturnType<typeof nativeAccounts.snapshot>>>(), [busy, setBusy] = useState(false), [error, setError] = useState<unknown>();
  const [captured, setCaptured] = useState<{session: AppServerSession; name: string}>(), [accountScope, setAccountScope] = useState<{accountId: string; familyId: string}>(), [code, setCode] = useState('');
  const [preview, setPreview] = useState<Readonly<SetupPreview>>(), [consentKind, setConsentKind] = useState<'local' | 'portico'>(), [done, setDone] = useState('');
  const [removeDownloads, setRemoveDownloads] = useState(false);
  const approver = useRef<TVConsentApprover | undefined>(undefined), alive = useRef(true);
  useEffect(() => {alive.current = true; let read = 0;
    const update = () => {const owned = ++read; void nativeAccounts.snapshot().then(value => {if (alive.current && owned === read) setServers(value);}, failure => {if (alive.current) setError(failure);});};
    update(); const off = subscribeNativeAppSessions(update);
    return () => {alive.current = false; off(); approver.current?.dispose();};
  }, []);
  const run = async (work: () => Promise<void>) => {if (busy || context && !context.current()) return; setBusy(true); setError(undefined);
    try {await work();} catch (failure) {if (alive.current) setError(failure);} finally {if (alive.current) setBusy(false);}
  };
  const close = () => {approver.current?.dispose(); approver.current = undefined; setPreview(undefined); setCode(''); setError(undefined); setPanel('servers');};
  const cancel = () => {if (panel === 'servers') onBack?.(); else close();};
  useEffect(() => {if (panel === 'add') return; const subscription = BackHandler.addEventListener('hardwareBackPress', () => {
    if (busy) return true;
    if (panel === 'servers' && !onBack) return false;
    cancel(); return true;
  }); return () => subscription.remove();});
  const action = (id: string, label: string, work: () => Promise<void>, disabled = false) => ({id, label, disabled: busy || disabled, loading: busy, onPress: () => {void run(work);}});
  const errorView = error ? <Text accessibilityRole="alert" style={[theme.type.caption, {color: theme.colors.danger, marginBottom: 12}]}>{presentError(error, 'account').body}</Text> : null;
  const layout = (title: string, body?: string, before?: React.ReactNode, primary?: ReturnType<typeof action>, more?: React.ReactNode) => <StateLayout testID="accounts-servers" title={title} body={body}
    beforeActions={<>{before}{errorView}</>} primaryAction={primary} secondaryAction={panel !== 'servers' || onBack ? {id: 'back', label: t('action.back'), disabled: busy, onPress: cancel} : undefined}>{more}</StateLayout>;
  if (panel === 'add') return <AccountEntry onSetupComplete={onSetupComplete} initialStage="address" onBack={close} onComplete={() => {close(); onComplete?.();}}/>;
  if (panel === 'sign-out-account') return layout(t('accounts.signOut.portico'), undefined, undefined,
    action('sign-out-account', t('action.signOut'), async () => {await nativeAccounts.signOutPorticoAccount(accountScope!); close(); onComplete?.();}));
  if (panel === 'consent-kind') return layout(t('settings.linkTV'), t('linkTV.enterCode'), <View style={{gap: 12, alignSelf: 'stretch', marginBottom: 20}}>
    {context && servers?.servers.find(value => value.id === servers.selectedServerId)?.signIn === 'local' && <Button variant="glass" disabled={busy} onPress={() => {void run(async () => {
      approver.current = await nativeAccounts.localTVConsent(context.api, context.session); setConsentKind('local'); setPanel('consent-code');
    });}}>{t('accounts.session.local')}</Button>}
    <Button variant="glass" disabled={busy} onPress={() => {void run(async () => {approver.current = await nativeAccounts.porticoTVConsent(); setConsentKind('portico'); setPanel('consent-code');});}}>{t('account.portico')}</Button>
  </View>);
  if (panel === 'consent-code') return layout(t('settings.linkTV'), t(consentKind === 'portico' ? 'accounts.consent.portico' : 'accounts.consent.local'),
    <TextField label={t('linkTV.enterCode')} value={code} onChangeText={setCode} autoCapitalize="characters" autoCorrect={false} editable={!busy} containerStyle={{marginBottom: 20}}/>,
    action('review-tv', t('web.device.review'), async () => {setPreview(await approver.current!.review(code)); setPanel('consent-review');}, !code));
  if (panel === 'consent-review') return layout(t('linkTV.askConfirm'), t('web.device.approveWarn'),
    <View style={{marginBottom: 20}}>{[preview!.deviceName, preview!.platform, preview!.appVersion, preview!.userCode, t(consentKind === 'portico' ? 'accounts.session.portico' : 'accounts.session.local')].map((value, index) => <Text key={index} style={[theme.type.body, {color: theme.colors.text}]}>{value}</Text>)}</View>,
    action('consent-approve', t('web.device.signItIn'), async () => {await approver.current!.decide(preview!, 'approve'); setDone(t('linkTV.approved', {device: preview!.deviceName})); setPanel('consent-done');}),
    <Button variant="text" disabled={busy} onPress={() => {void run(async () => {await approver.current!.decide(preview!, 'deny'); setDone(t('linkTV.declined')); setPanel('consent-done');});}}>{t('web.device.notMine')}</Button>);
  if (panel === 'consent-done') return layout(done, undefined, undefined, action('done', t('action.done'), async () => close()));
  const deviceNoun = Platform.isTV ? Platform.OS === 'ios' ? 'device.noun.appleTV' : String((Platform.constants as {Manufacturer?: string}).Manufacturer ?? '').toLowerCase() === 'amazon' ? 'device.noun.fireTV' : 'device.noun.androidTV'
    : Platform.OS === 'ios' ? (Platform as {isPad?: boolean}).isPad ? 'device.noun.iPad' : 'device.noun.iPhone' : Math.min(Dimensions.get('screen').width, Dimensions.get('screen').height) >= 600 ? 'device.noun.tablet' : 'device.noun.phone';
  const selectedServer = !!captured && servers?.selectedServerId === captured.session.connection.pin.serverId;
  const signOutSheet = captured ? <BottomSheet open={panel === 'sign-out-server'} onOpenChange={open => {if (!open) {setRemoveDownloads(false); close();}}} testID="accounts-sign-out-sheet"
    title={t('settings.signOutConfirm.title', {server: captured.name, device: t(deviceNoun)})}
    footer={<View style={{gap: 10}}>
      <Focusable accessibilityRole="button" accessibilityLabel={t('action.signOut')} disabled={busy}
        onPress={() => {void run(async () => {
          if (removeDownloads && selectedServer) await removeCapturedServerDownloads(captured, {
            selected: () => nativeAppSessions.selected(),
            entries: () => offlineDownloads.getSnapshot().entries,
            remove: async entry => {
              const owner = offlineOwnerKey(captured.session.connection.session.viewer);
              const live = offlineDownloads.getSnapshot().entries.find(value => value.id === entry.id
                && (value.receipt ? offlineOwnerKey(value.receipt.claims.viewer) : value.owner) === owner);
              if (live) await offlineDownloads.remove(live);
            },
          });
          await nativeAccounts.signOutServer(captured.session.connection.pin.serverId, captured.session.connection.session.sessionFamilyId);
          setRemoveDownloads(false); close(); onComplete?.();
        });}} focusRadius={12} focusTreatment="none"
        style={{height: 54, borderRadius: 12, backgroundColor: `${theme.colors.danger}24`, alignItems: 'center', justifyContent: 'center'}}>
        <Text style={[theme.type.button, {color: theme.colors.danger}]}>{t('action.signOut')}</Text>
      </Focusable>
      <Button variant="text" disabled={busy} onPress={() => {setRemoveDownloads(false); close();}} textStyle={{color: theme.colors.textSecondary}}>{t('action.cancel')}</Button>
    </View>}>
    <Text style={[theme.type.body, {color: theme.colors.textSecondary, marginBottom: 14}]}>{t('settings.signOutConfirm.bodyDownloads')}</Text>
    {selectedServer && <Focusable accessibilityRole="checkbox" accessibilityState={{checked: removeDownloads}} accessibilityLabel={t('settings.signOutConfirm.removeDownloads')}
      onPress={() => setRemoveDownloads(value => !value)} focusRadius={6} focusTreatment="none" style={{flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 8}}>
      <View style={{width: 24, height: 24, borderRadius: 6, borderWidth: 1.5, alignItems: 'center', justifyContent: 'center',
        borderColor: removeDownloads ? theme.colors.accentStrong : theme.colors.lineStrong, backgroundColor: removeDownloads ? theme.colors.accentStrong : 'transparent'}}>
        {removeDownloads && <Icon name="i-check" size={16} color={theme.colors.ink}/>}
      </View>
      <Text style={[theme.type.body, {color: theme.colors.text, flex: 1}]}>{t('settings.signOutConfirm.removeDownloads')}</Text>
    </Focusable>}
  </BottomSheet> : null;
  if (!Platform.isTV) return <><PhoneServerChooser snapshot={servers} busy={busy} error={errorView} onBack={onBack ? cancel : undefined}
    onSelect={value => {void run(async () => {await nativeAccounts.switchServer(value.id); onComplete?.();});}}
    onSignOut={value => {void run(async () => {
      const state = await nativeAppSessions.read(), found = state.servers.find(item => item.connection.pin.serverId === value.id);
      if (!found || found.connection.session.sessionFamilyId !== value.familyId || found.connection.pin.fingerprint !== value.fingerprint)
        throw Object.assign(new Error('native_server_changed'), {code: 'cancelled'});
      setCaptured({session: found, name: value.name}); setPanel('sign-out-server');
    });}}
    onRefresh={() => {void run(async () => {const value = await nativeAccounts.snapshot(); if (alive.current) setServers(value);});}}
    onAdd={() => {void run(async () => setPanel('add'));}}
    footer={<View style={{alignSelf: 'stretch', gap: 8, marginTop: 10}}>
      <Button variant="text" disabled={busy} onPress={() => setPanel('consent-kind')}>{t('settings.linkTV')}</Button>
      {servers?.servers.some(value => value.signIn === 'portico') && <Button variant="text" disabled={busy} onPress={() => {void run(async () => {
        const credentials = nativeAccounts.accountCredentials(); await credentials.synchronize(); const session = credentials.getSnapshot().session;
        if (!session) throw Object.assign(new Error('native_account_signed_out'), {code: 'account_changed'});
        setAccountScope({accountId: session.account.id, familyId: session.familyId}); setPanel('sign-out-account');
      });}}>{t('accounts.signOut.portico')}</Button>}
    </View>}/>{signOutSheet}</>;
  return <><TVServerChooser snapshot={servers} busy={busy} error={errorView} onBack={onBack ? cancel : undefined}
    owner={!!context && context.current() && context.account.serverId === servers?.selectedServerId && context.account.account.role === 'owner'}
    onSelect={value => {void run(async () => {await nativeAccounts.switchServer(value.id); onComplete?.();});}}
    onSignOut={value => {void run(async () => {
      const state = await nativeAppSessions.read(), found = state.servers.find(item => item.connection.pin.serverId === value.id);
      if (!found || found.connection.session.sessionFamilyId !== value.familyId || found.connection.pin.fingerprint !== value.fingerprint)
        throw Object.assign(new Error('native_server_changed'), {code: 'cancelled'});
      setCaptured({session: found, name: value.name}); setPanel('sign-out-server');
    });}}
    onRefresh={() => {void run(async () => {const value = await nativeAccounts.snapshot(); if (alive.current) setServers(value);});}}
    onAdd={() => {void run(async () => setPanel('add'));}}
    certificates={<TVTrustedCertificates context={context}/>}
    footer={<View style={{alignSelf: 'stretch', gap: 8, marginTop: 10}}>
    <Button variant="text" disabled={busy} onPress={() => setPanel('consent-kind')}>{t('settings.linkTV')}</Button>
    {servers?.servers.some(value => value.signIn === 'portico') && <Button variant="text" disabled={busy} onPress={() => {void run(async () => {
      const credentials = nativeAccounts.accountCredentials(); await credentials.synchronize(); const session = credentials.getSnapshot().session;
      if (!session) throw Object.assign(new Error('native_account_signed_out'), {code: 'account_changed'});
      setAccountScope({accountId: session.account.id, familyId: session.familyId}); setPanel('sign-out-account');
    });}}>{t('accounts.signOut.portico')}</Button>}
  </View>}/>{signOutSheet}</>;
}

const createAccountRoute: NativeRouteFactory = context => ({render: route => {
  if (route.kind !== 'profiles' && route.kind !== 'servers') throw new Error('native_account_route_mismatch');
  return <AccountRoute route={route} context={context}/>;
}});
nativeShellRoutes.registerRoute('profiles', createAccountRoute);
nativeShellRoutes.registerRoute('servers', createAccountRoute);
