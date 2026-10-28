import React, {useLayoutEffect, useRef, useState, useSyncExternalStore} from 'react';
import {ScrollView, Text, View, useWindowDimensions} from 'react-native';
import QRCode from 'react-native-qrcode-svg';
import {IdentityClient, type TwoFactorEnrolment} from '../../../../../packages/client-core/src/identity-client';
import type {Device} from '../../../../../packages/client-core/src/identity-devices';
import type {TwoFactorState} from '../../../../../packages/client-core/src/identity-restrictions';
import {passwordStrength} from '../../../../../packages/client-core/src/password-strength';
import {defaultI18n} from '../../../../../packages/i18n/src';
import {nativeAccounts} from '../../platform/accounts';
import {copyText} from '../../platform/clipboard';
import {Button, TextField} from '../../kit/controls';
import {BottomSheet, Dialog} from '../../kit/overlays';
import {SettingsRow} from '../../kit/shell';
import {StateView} from '../../kit/states';
import {shellType} from '../../kit/shell/visual';
import {useTheme} from '../../kit/theme';
import type {NativeShellRuntime} from '../../shell/runtime';
import type {NativeSettingsPanelDeps} from './settings-panels';
import {createNativeAccountSecurityScope, nativeAccountSecurityAllowed, type NativeAccountSecurityKind, type NativeAccountSecurityScope} from './native-account-security';

type Opening = Readonly<{scope: NativeAccountSecurityScope; client: IdentityClient}>;
type Mode = 'main' | 'disable' | 'confirm-disable' | 'replace' | 'confirm-remove' | 'confirm-all';

/** Local account credentials and this server's devices. Hosted credential changes retain their account-owned flow. */
export function NativeAccountSecurityPanel({kind, context, lifetime, t, runtime}: NativeSettingsPanelDeps & {kind: NativeAccountSecurityKind; runtime: NativeShellRuntime}) {
  const theme = useTheme(), dimensions = useWindowDimensions(), navigation = useSyncExternalStore(context.navigation.subscribe, context.navigation.getSnapshot);
  const [opening, setOpening] = useState<Opening>(), openingRef = useRef<Opening | undefined>(undefined);
  const mounted = useRef(false), busyRef = useRef(false), copyRef = useRef(false), shownCodes = useRef<readonly string[] | undefined>(undefined);
  const stageRef = useRef<readonly unknown[]>([]);
  const [busy, setBusy] = useState(false), [error, setError] = useState<unknown>(), [notice, setNotice] = useState('');
  const [factor, setFactor] = useState<TwoFactorState>(), [enrolment, setEnrolment] = useState<TwoFactorEnrolment>(), [codes, setCodes] = useState<readonly string[]>();
  const [password, setPassword] = useState(''), [nextPassword, setNextPassword] = useState(''), [confirmation, setConfirmation] = useState(''), [code, setCode] = useState('');
  const [devices, setDevices] = useState<readonly Device[]>(), [device, setDevice] = useState<Device>(), [deviceName, setDeviceName] = useState('');
  const [mode, setMode] = useState<Mode>('main'), [copied, setCopied] = useState(false);
  const clear = () => {
    shownCodes.current = undefined;
    setError(undefined); setFactor(undefined); setEnrolment(undefined); setCodes(undefined); setPassword(''); setNextPassword(''); setConfirmation(''); setCode('');
    setDevices(undefined); setDevice(undefined); setDeviceName(''); setMode('main'); setCopied(false); setBusy(false);
  };
  const close = () => {openingRef.current?.scope.dispose(); openingRef.current = undefined; busyRef.current = false; copyRef.current = false; setOpening(undefined); clear();};
  useLayoutEffect(() => {
    mounted.current = true; clear(); setNotice(''); setOpening(undefined);
    return () => {mounted.current = false; openingRef.current?.scope.dispose(); openingRef.current = undefined; busyRef.current = false; copyRef.current = false; shownCodes.current = undefined;};
  }, [context, lifetime, kind, navigation.revision, navigation.route]); // Clear plaintext on a different Settings opening.
  const current = (held: Opening | undefined): held is Opening => !!held && mounted.current && openingRef.current === held && !runtime.retirementSignal?.aborted && held.scope.current();
  const run = async <T,>(held: Opening | undefined, work: (client: IdentityClient, scope: NativeAccountSecurityScope) => Promise<T>, accepted: (value: T) => void) => {
    if (!current(held) || busyRef.current) return;
    busyRef.current = true; setBusy(true); setError(undefined);
    try {const value = await work(held.client, held.scope); if (current(held)) accepted(value);}
    catch (failure) {if (current(held)) setError(failure);}
    finally {if (current(held)) {busyRef.current = false; setBusy(false);}}
  };
  const load = (held: Opening) => {
    if (kind === 'devices') void run(held, (client, source) => client.devices(source.installationId ?? '', source.signal), setDevices);
    else void run(held, (client, source) => client.twoFactor(source.signal), setFactor);
  };
  const open = () => {
    if (openingRef.current || !mounted.current || !lifetime.current() || !context.current() || !nativeAccountSecurityAllowed(context, kind)) return;
    const now = context.navigation.getSnapshot();
    if (now.revision !== navigation.revision || now.route !== navigation.route || now.route.kind !== 'shell' || now.route.destination.kind !== 'settings') return;
    close(); setNotice('');
    let scope: NativeAccountSecurityScope;
    try {scope = createNativeAccountSecurityScope(context, lifetime, kind);} catch (failure) {if ((failure as {name?: string})?.name === 'AbortError') return; throw failure;}
    const held = {scope, client: new IdentityClient(scope)};
    openingRef.current = held; setOpening(held); load(held);
  };
  const held = opening;
  const stage = [mode, factor, enrolment, codes, device, password, nextPassword, confirmation, code, deviceName] as const;
  stageRef.current = stage;
  const stageCurrent = () => current(held) && stage.every((value, index) => stageRef.current[index] === value);
  const perform = <T,>(work: (client: IdentityClient, scope: NativeAccountSecurityScope) => Promise<T>, accepted: (value: T) => void) => {if (stageCurrent()) return run(held, work, accepted);};
  const revealCodes = (value: readonly string[]) => {shownCodes.current = value; setCodes(value);};
  const edit = (setter: (value: string) => void) => (value: string) => {if (stageCurrent() && !busyRef.current) setter(value);};
  const go = (next: Mode) => {if (stageCurrent() && !busyRef.current) {setMode(next); setPassword(''); setCode(''); setError(undefined);}};
  const saved = (message: string) => {close(); setNotice(message);};
  const signOutHere = async (scope: NativeAccountSecurityScope) => {
    if (!scope.current()) return;
    await nativeAccounts.signOutServer(scope.serverId, scope.familyId);
  };
  const refreshDevices = async (client: IdentityClient, scope: NativeAccountSecurityScope) => client.devices(scope.installationId ?? '', scope.signal);
  const copyCodes = async () => {
    if (!stageCurrent() || !codes?.length || copyRef.current) return;
    copyRef.current = true;
    try {await copyText(codes.join('\n')); if (current(held)) {setCopied(true); setError(undefined);}}
    catch (failure) {if (current(held)) setError(failure);}
    finally {if (openingRef.current === held) copyRef.current = false;}
  };
  if (!lifetime.current() || !context.current() || !nativeAccountSecurityAllowed(context, kind) || theme.isTV && kind !== 'devices') return null;
  const label = t(kind === 'password' ? 'settings.row.password' : kind === 'twoStep' ? 'settings.row.twoStep' : 'settings.section.devices');
  const strength = passwordStrength(nextPassword), matching = !confirmation || confirmation === nextPassword;
  const bodyText = (value: string) => <Text style={[shellType(14, 400, 20), {color: theme.colors.textSecondary}]}>{value}</Text>;
  const passwordField = <TextField testID="account-security-current-password" label={kind === 'password' ? 'Current password' : t('auth.password')} value={password} onChangeText={edit(setPassword)} secureTextEntry autoCapitalize="none" autoCorrect={false} autoComplete="current-password" textContentType="password" editable={!busy}/>;
  const codeField = <TextField testID="account-security-code" label={t('auth.verificationCode')} description={enrolment ? undefined : 'Or one of your recovery codes.'} value={code} onChangeText={edit(setCode)} autoCapitalize="none" autoCorrect={false} autoComplete="one-time-code" textContentType="oneTimeCode" editable={!busy}/>;
  let title = label, description: string | undefined, body: React.ReactNode = null, actions: React.ReactNode = null;
  if (codes) {
    title = 'Save your recovery codes'; description = 'Each code works once if you lose your authenticator. They aren’t shown again.';
    body = <Text testID="account-security-recovery-codes" selectable style={[shellType(17, 700, 28), {color: theme.colors.text, fontVariant: ['tabular-nums']}]}>{codes.join('\n')}</Text>;
    actions = <><Button testID="account-security-copy-codes" variant="glass" onPress={() => void copyCodes()}>{t('web.twoStep.copy')}</Button><Button testID="account-security-codes-saved" onPress={() => {if (current(held)) close();}}>I’ve saved them</Button></>;
  } else if (kind === 'password' && factor) {
    title = 'Change password';
    body = <>{passwordField}
      <TextField testID="account-security-new-password" label="New password" value={nextPassword} onChangeText={edit(setNextPassword)} secureTextEntry autoCapitalize="none" autoCorrect={false} autoComplete="new-password" textContentType="newPassword" editable={!busy}/>
      {nextPassword && <View accessibilityLabel={strength.label} style={{gap: 5}}><View style={{height: 4, flexDirection: 'row', gap: 3}}>{[1, 2, 3, 4].map(level => <View key={level} style={{flex: 1, borderRadius: 2, backgroundColor: level <= strength.level ? theme.colors.accentStrong : theme.colors.line}}/>)}</View>{bodyText([strength.label, strength.hint].filter(Boolean).join(' · '))}</View>}
      <TextField testID="account-security-confirm-password" label={t('accounts.signIn.confirmPassword')} value={confirmation} onChangeText={edit(setConfirmation)} secureTextEntry autoCapitalize="none" autoCorrect={false} autoComplete="new-password" textContentType="newPassword" editable={!busy} error={!matching ? 'The new passwords don’t match.' : undefined}/>
      {factor.enabled && codeField}</>;
    actions = <Button testID="account-security-save-password" loading={busy} disabled={busy || !password || !strength.acceptable || !confirmation || !matching || factor.enabled && !code.trim()} onPress={() => {
      if (!password || !strength.acceptable || confirmation !== nextPassword || factor.enabled && !code.trim()) return;
      void perform(client => client.changePassword(password, nextPassword, factor.enabled ? code.trim() : undefined), () => saved('Password changed. Other devices stay signed in unless you sign them out.'));
    }}>{t('action.save')}</Button>;
  } else if (kind === 'twoStep' && factor) {
    if (mode === 'confirm-disable') {
      title = 'Turn off two-step verification?'; description = 'Anyone with the password will be able to sign in. Existing recovery codes stop working.';
      actions = <Button testID="account-security-confirm-disable" variant="danger" loading={busy} disabled={busy} onPress={() => void perform(client => client.disableTwoFactor(password, code.trim()), () => saved('Two-step verification turned off.'))}>Turn off</Button>;
    } else if (mode === 'disable' || mode === 'replace') {
      title = mode === 'disable' ? 'Turn off two-step verification' : 'Replace recovery codes';
      description = mode === 'replace' ? 'Your existing recovery codes will stop working. Save the new codes when they appear.' : 'Confirm this account’s password.';
      body = <>{passwordField}{codeField}</>;
      actions = <Button testID="account-security-factor-submit" loading={busy} disabled={busy || !password || !code.trim()} onPress={() => {
        if (!stageCurrent() || busyRef.current || !password || !code.trim()) return;
        if (mode === 'disable') {setMode('confirm-disable'); return;}
        void perform((client, scope) => client.replaceRecoveryCodes(password, code.trim(), scope.signal), value => {revealCodes(value); setPassword(''); setCode(''); setMode('main');});
      }}>{mode === 'disable' ? t('action.continue') : 'Replace codes'}</Button>;
    } else if (enrolment) {
      title = 'Scan with your authenticator app'; description = 'Then enter the 6-digit code it shows.';
      body = <><View style={{alignSelf: 'center', padding: 12, borderRadius: 14, backgroundColor: theme.colors.white}}><QRCode value={enrolment.uri} size={180}/></View>{bodyText('Can’t scan? Enter this key:')}
        <Text selectable style={[shellType(16, 700, 24), {color: theme.colors.text}]}>{enrolment.secret.match(/.{1,4}/g)?.join(' ')}</Text>{codeField}</>;
      actions = <Button testID="account-security-verify" loading={busy} disabled={busy || !/^\d{6}$/.test(code.replace(/\s/g, ''))} onPress={() => {
        const verificationCode = code.replace(/\s/g, ''); if (!/^\d{6}$/.test(verificationCode)) return;
        void perform(async client => {const value = await client.verifyTwoFactor(password, verificationCode); if (!value.enabled) throw new Error('invalid_two_factor_state'); return value;}, value => {
          setFactor(value); revealCodes(enrolment.recoveryCodes); setEnrolment(undefined); setPassword(''); setCode('');
        });
      }}>Verify</Button>;
    } else if (!factor.enabled) {
      title = t('web.twoStep.turnOnTitle'); description = 'First, confirm this account’s password.'; body = passwordField;
      actions = <Button testID="account-security-enrol" loading={busy} disabled={busy || !password} onPress={() => {if (password) void perform(client => client.enrolTwoFactor(password), value => {setEnrolment(value); setCode('');});}}>{t('action.continue')}</Button>;
    } else {
      body = <>{bodyText(t('web.hostedSecurity.on'))}{bodyText(t('web.hostedSecurity.codesLeft', {count: factor.recoveryCodesRemaining}))}</>;
      actions = <><Button testID="account-security-disable" variant="glass" onPress={() => go('disable')}>Turn off</Button><Button testID="account-security-replace-codes" variant="glass" onPress={() => go('replace')}>Replace recovery codes</Button></>;
    }
  } else if (kind === 'devices' && devices) {
    if (mode === 'confirm-all') {
      title = 'Sign out everywhere?'; description = 'Every device, including this one, is signed out of this server. Downloads already on a device stay until it next connects.';
      actions = <Button testID="account-security-confirm-all" variant="danger" loading={busy} disabled={busy} onPress={() => void perform(async (client, scope) => {await client.signOutEverywhere(); await signOutHere(scope);}, () => close())}>Sign out everywhere</Button>;
    } else if (device) {
      title = mode === 'confirm-remove' ? `Remove ${device.name}?` : device.name;
      description = mode === 'confirm-remove' ? 'It will need to sign in again.' : `First seen ${defaultI18n.date(device.firstSeen)}`;
      if (mode === 'confirm-remove') actions = <Button testID="account-security-confirm-remove" variant="danger" loading={busy} disabled={busy} onPress={() => {
        if (device.current) return;
        void perform(async (client, scope) => {await client.removeDevice(device.id); return refreshDevices(client, scope);}, value => {setDevices(value); setDevice(undefined); setMode('main');});
      }}>Remove device</Button>;
      else {
        body = <TextField testID="account-security-device-name" label={t('profile.name')} value={deviceName} onChangeText={edit(setDeviceName)} maxLength={120} editable={!busy}/>;
        actions = <><Button testID="account-security-sign-out-device" variant="glass" disabled={busy} onPress={() => void perform(async (client, scope) => {
          await client.signOutDevice(device.id); if (device.current) {await signOutHere(scope); return undefined;} return refreshDevices(client, scope);
        }, value => {if (value) {setDevices(value); setDevice(undefined);} else close();})}>{device.current ? 'Sign out this device' : 'Sign this device out'}</Button>
          {!device.current && <Button testID="account-security-remove-device" variant="danger" disabled={busy} onPress={() => go('confirm-remove')}>Remove device</Button>}
          <Button testID="account-security-save-device" loading={busy} disabled={busy || !deviceName.trim() || deviceName.trim() === device.name} onPress={() => {
            if (!deviceName.trim() || deviceName.trim() === device.name) return;
            void perform(async (client, scope) => {await client.editDevice(device.id, {name: deviceName.trim()}); return refreshDevices(client, scope);}, value => {setDevices(value); setDevice(undefined);});
          }}>Save name</Button></>;
      }
    } else {
      description = 'Everywhere this account is signed in to this server.';
      body = <View>{devices.length ? devices.map((row, index) => <SettingsRow key={row.id} first={index === 0} testID={`account-security-device-${row.id}`} label={row.name}
        value={row.current ? 'This device' : undefined} description={[row.platform, row.app, defaultI18n.date(row.lastSeen), row.sessions ? row.sessions === 1 ? '1 session' : `${row.sessions} sessions` : 'Signed out'].filter(Boolean).join(' · ')}
        onPress={() => {if (stageCurrent() && !busyRef.current) {setDevice(row); setDeviceName(row.name); setMode('main'); setError(undefined);}}}/>) : bodyText('No signed-in devices.')}</View>;
      actions = <Button testID="account-security-sign-out-all" variant="glass" disabled={busy} onPress={() => go('confirm-all')}>Sign out everywhere…</Button>;
    }
  }
  const cancel = () => {
    if (!stageCurrent() || shownCodes.current) return;
    if (mode === 'confirm-disable') {setMode('disable'); return;}
    if (mode === 'confirm-remove') {setMode('main'); return;}
    if (device) {setDevice(undefined); setMode('main'); return;}
    if (mode !== 'main') {go('main'); return;}
    close();
  };
  const surface = {
    testID: `account-security-${kind}`, open: !!opening && current(opening), title, description,
    onOpenChange: (value: boolean) => {if (!value && !shownCodes.current && current(held)) close();},
    dismissOnBack: !codes, dismissOnOutsidePress: !codes, dismissOnGesture: !codes, showClose: !codes,
    footer: <View style={{flexDirection: 'row', flexWrap: 'wrap', gap: 8}}>{!codes && <Button variant="glass" disabled={busy} onPress={cancel}>{t(device ? 'action.back' : 'action.cancel')}</Button>}{actions}</View>,
  };
  const content = <View style={{gap: 12}}>
    {error !== undefined && <StateView testID="account-security-error" {...runtime.error(error, () => {if (current(held)) setError(undefined);})}/>}
    {busy && !factor && !devices && bodyText(t('status.loading'))}
    {!busy && error !== undefined && !factor && !devices && <Button onPress={() => {if (current(held)) load(held);}}>{t('action.tryAgain')}</Button>}
    {body}{copied && bodyText(t('api.credential.copied'))}
  </View>;
  return <>
    <SettingsRow first testID={`settings-panel-${kind}`} label={label} onPress={open}/>
    {notice && <Text accessibilityLiveRegion="polite" style={[shellType(13, 400, 19), {color: theme.colors.textSecondary, padding: 14}]}>{notice}</Text>}
    {theme.platform === 'phone' ? <BottomSheet {...surface} fitContent keyboardAvoiding>{content}</BottomSheet>
      : <Dialog {...surface}><ScrollView keyboardShouldPersistTaps="handled" style={{maxHeight: Math.max(180, dimensions.height * .55)}}>{content}</ScrollView></Dialog>}
  </>;
}
