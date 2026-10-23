import React, {useEffect, useRef, useState} from 'react';
import {ScrollView, Text, View} from 'react-native';
import {defaultI18n} from '../../../../../packages/i18n/src';
import {presentError} from '../../../../../packages/client-core/src/presentation/errors';
import type {ManagedProfile} from '../../../../../packages/client-core/src/profile-management';
import type {SetupPreview} from '../../../../../packages/client-core/src/setup-code';
import type {TVConsentApprover} from '../../../../../packages/client-core/src/tv-consent';
import type {AppServerSession} from '../../../../../packages/client-core/src/app-sessions';
import {nativeAccounts} from '../../platform/accounts';
import {nativeAppSessions, subscribeNativeAppSessions} from '../../platform/app-session-storage';
import {nativeProfileSelection} from '../../platform/profile-selection';
import type {NativeShellBootstrapContext} from '../../shell/bootstrap';
import type {NativeShellRoute} from '../../shell/routes';
import {StateLayout} from '../../kit/states';
import {ProfilePicker} from '../../kit/artwork';
import {Button, TextField} from '../../kit/controls';
import {useTheme} from '../../kit/theme';
import {AccountEntry} from './AccountEntry';

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
  const selection = useRef<ReturnType<typeof nativeProfileSelection> | undefined>(undefined), alive = useRef(true);
  useEffect(() => {alive.current = true; const session = context.session();
    if (session) selection.current = nativeProfileSelection(session.viewer.serverId, session.sessionFamilyId);
    return () => {alive.current = false; selection.current?.dispose();};
  }, [context]);
  const choose = async (id: string, code?: string) => {if (busy || !context.current()) return; setBusy(true); setError(undefined);
    try {await selection.current!.select(id, code);} catch (failure) {if (alive.current) setError(failure);} finally {if (alive.current) setBusy(false);}
  };
  const current = context.session();
  return <StateLayout testID="accounts-profile-switch" title={profile ? t('profile.pinTitle', {name: profile.name}) : t('auth.whosWatching')}
    beforeActions={<View style={{alignSelf: 'stretch', marginBottom: 20}}>{profile ? <TextField label={t('pin.fourDigit')} value={pin} onChangeText={setPin} secureTextEntry keyboardType="number-pad" editable={!busy}/> :
      <ProfilePicker profiles={context.account.profiles.map(value => ({id: value.id, name: value.name, initial: [...value.name][0] ?? '', color: value.art, primary: value.primary, pinRequired: value.pinRequired, disabled: busy}))}
        selectedId={current?.viewer.profileId} showTitle={false} onSelect={id => {const value = context.account.profiles.find(item => item.id === id)!;
          if (id === current?.viewer.profileId) onBack(); else if (value.pinRequired) {setProfile(value); setPin('');} else void choose(id);}}/>}
      {!!error && <Text accessibilityRole="alert" style={[theme.type.caption, {color: theme.colors.danger}]}>{presentError(error, 'profiles').body}</Text>}</View>}
    primaryAction={profile ? {id: 'choose-profile', label: t('action.continue'), disabled: busy || !/^\d{4}$/.test(pin), loading: busy, onPress: () => {void choose(profile.id, pin);}} : undefined}
    secondaryAction={{id: 'back', label: t('action.back'), disabled: busy, onPress: () => {if (profile) {setProfile(undefined); setPin('');} else onBack();}}}/>;
}

/** Also usable when no selected server can restore: retained servers remain reachable. */
export function ServersRoute({context, onBack, onComplete}: {context?: NativeShellBootstrapContext; onBack?: () => void; onComplete?: () => void}) {
  const theme = useTheme(), [panel, setPanel] = useState<Panel>('servers'), [servers, setServers] = useState<Awaited<ReturnType<typeof nativeAccounts.snapshot>>>(), [busy, setBusy] = useState(false), [error, setError] = useState<unknown>();
  const [captured, setCaptured] = useState<AppServerSession>(), [accountScope, setAccountScope] = useState<{accountId: string; familyId: string}>(), [code, setCode] = useState('');
  const [preview, setPreview] = useState<Readonly<SetupPreview>>(), [consentKind, setConsentKind] = useState<'local' | 'portico'>(), [done, setDone] = useState('');
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
  const action = (id: string, label: string, work: () => Promise<void>, disabled = false) => ({id, label, disabled: busy || disabled, loading: busy, onPress: () => {void run(work);}});
  const errorView = error ? <Text accessibilityRole="alert" style={[theme.type.caption, {color: theme.colors.danger, marginBottom: 12}]}>{presentError(error, 'account').body}</Text> : null;
  const layout = (title: string, body?: string, before?: React.ReactNode, primary?: ReturnType<typeof action>, more?: React.ReactNode) => <StateLayout testID="accounts-servers" title={title} body={body}
    beforeActions={<>{before}{errorView}</>} primaryAction={primary} secondaryAction={panel !== 'servers' || onBack ? {id: 'back', label: t('action.back'), disabled: busy, onPress: cancel} : undefined}>{more}</StateLayout>;
  if (panel === 'add') return <AccountEntry onBack={close} onComplete={() => {close(); onComplete?.();}}/>;
  if (panel === 'sign-out-server') return layout(t('accounts.signOut.server', {server: captured!.connection.logicalOrigin}), t('confirm.signOutThisDevice.body'), undefined,
    action('sign-out-server', t('action.signOut'), async () => {await nativeAccounts.signOutServer(captured!.connection.pin.serverId, captured!.connection.session.sessionFamilyId); close(); onComplete?.();}));
  if (panel === 'sign-out-account') return layout(t('accounts.signOut.portico'), t('accounts.signOut.porticoBody'), undefined,
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
  return layout(t('accounts.servers.title'), servers?.servers.length === 0 ? t('accounts.servers.empty') : undefined, <ScrollView style={{maxHeight: theme.isTV ? 500 : 340, alignSelf: 'stretch', marginBottom: 16}} contentContainerStyle={{gap: 14}}>
    {servers?.servers.map(value => <View key={value.id} style={{gap: 6}}>
      <Button variant={value.id === servers.selectedServerId ? 'primary' : 'glass'} disabled={busy} onPress={() => {void run(async () => {await nativeAccounts.switchServer(value.id); onComplete?.();});}}>{value.origin}</Button>
      <Text style={[theme.type.caption, {color: theme.colors.textSecondary}]}>{t(value.labelKey)}</Text>
      <Button variant="text" size="small" disabled={busy} onPress={() => {void run(async () => {
        const state = await nativeAppSessions.read(), found = state.servers.find(item => item.connection.pin.serverId === value.id);
        if (found) {setCaptured(found); setPanel('sign-out-server');}
      });}}>{t('accounts.signOut.server', {server: value.origin})}</Button>
    </View>)}
  </ScrollView>, action('add-server', t('auth.signInToServer'), async () => setPanel('add')),
  <View style={{alignSelf: 'stretch', gap: 8, marginTop: 10}}>
    <Button variant="text" disabled={busy} onPress={() => setPanel('consent-kind')}>{t('settings.linkTV')}</Button>
    {servers?.servers.some(value => value.signIn === 'portico') && <Button variant="text" disabled={busy} onPress={() => {void run(async () => {
      const credentials = nativeAccounts.accountCredentials(); await credentials.synchronize(); const session = credentials.getSnapshot().session;
      if (!session) throw Object.assign(new Error('native_account_signed_out'), {code: 'account_changed'});
      setAccountScope({accountId: session.account.id, familyId: session.familyId}); setPanel('sign-out-account');
    });}}>{t('accounts.signOut.portico')}</Button>}
  </View>);
}
