import React, {useCallback, useEffect, useMemo, useState} from 'react';
import {View} from 'react-native';
import {passwordStrength} from '../../../../packages/client-core/src/password-strength';
import {IdentityClient, deviceAwaitingApproval, type Device, type ProfileRestrictions, type RatingSystem, type TwoFactorEnrolment, type TwoFactorState} from '../../../../packages/client-core/src/index';
import {useSession} from '../app/session';
import {useI18n} from '../app/i18n';
import {say, signInMessage, activeI18n} from '../app/errors';
import {profileInstallation} from '../bridge/profile-trust';
import {Badge, ConfirmSheet, Field, ListRow, Menu, Notice, RowGroup, Sheet, StateView, Surface, Text, ToggleRow, rowPaddingX, showToast, useSpecPlatform, useTheme, type IconName, type MenuItem} from '../ui';

function useIdentity() {
  const {api} = useSession();
  return useMemo(() => new IdentityClient(api!), [api]);
}

/**
 * C45: the password and two-step forms send the current password; a wrong one is 403
 * `current_password_incorrect` ("that password isn't right"), never "sign in again".
 */
function stepUpMessage(e: unknown): string {
  const {status, code} = (e && typeof e === 'object' ? e : {}) as {status?: unknown; code?: unknown};
  if (code === 'current_password_incorrect') return activeI18n().t('account.wrongPassword');
  return status === 401 || status === 403 ? signInMessage(e) : say(e, 'account', 'save');
}

/** Keeps what it loaded: a failed refresh leaves the last good value beside the error. */
function useLoaded<T>(load: (signal: AbortSignal) => Promise<T>, deps: React.DependencyList, context: 'account' | 'devices' | 'profiles' = 'account') {
  const [value, setValue] = useState<T>();
  const [error, setError] = useState('');
  const [revision, setRevision] = useState(0);
  useEffect(() => {
    const controller = new AbortController();
    setError('');
    load(controller.signal).then(v => { if (!controller.signal.aborted) setValue(v); }, e => { if (!controller.signal.aborted) setError(say(e, context, 'load')); });
    return () => controller.abort();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [...deps, revision]);
  return {value, setValue, error, reload: useCallback(() => setRevision(r => r + 1), [])};
}

const permissions = [
 {key: 'allowDownloads', label: 'limits.feature.downloads'}, {key: 'allowLiveTv', label: 'limits.feature.liveTv'}, {key: 'allowDvr', label: 'limits.feature.dvr'},
 {key: 'allowWatchTogether', label: 'limits.feature.watchTogether'},
] as const;

/**
 * What one profile may see and do (APL-SET-01 §3). Switches, not checkmarks; "Not set" rather
 * than a dash; descriptions wrap. C45: the signed-in managing session saves them; no password or
 * code is asked here (only the email, password and two-step forms ask).
 */
export function ProfileLimitsSheet({profile, onClose}: {profile: {id: string; name: string}; onClose: () => void}) {
  const identity = useIdentity();
  const i18n = useI18n();
  const {space} = useTheme();
  const platform = useSpecPlatform();
  const systems = useLoaded<readonly RatingSystem[]>(s => identity.ratingSystems(s), [identity], 'profiles');
  const current = useLoaded<ProfileRestrictions>(s => identity.restrictions(profile.id, s), [identity, profile.id], 'profiles');
  const [draft, setDraft] = useState<ProfileRestrictions>();
  const [picking, setPicking] = useState<'system' | 'rating'>();
  const [busy, setBusy] = useState(false);
  const [failure, setFailure] = useState('');
  useEffect(() => { if (current.value) setDraft(current.value); }, [current.value]);
  const system = systems.value?.find(s => s.id === draft?.ratingSystem);
  const dirty = !!draft && !!current.value && JSON.stringify(draft) !== JSON.stringify(current.value);
  const save = async () => {
    if (!draft || !current.value) return;
    setBusy(true); setFailure('');
    try {
      await identity.saveRestrictions(current.value, {ratingSystem: draft.ratingSystem, maximumAgeRating: draft.maximumAgeRating, allowUnrated: draft.allowUnrated, blockedLabels: [...draft.blockedLabels], allowDownloads: draft.allowDownloads, allowLiveTv: draft.allowLiveTv, allowDvr: draft.allowDvr, allowWatchTogether: draft.allowWatchTogether});
      showToast({message: i18n.t('limits.saved', {name: profile.name}), icon: 'check'});
      onClose();
    } catch (e) { setFailure(say(e, 'profiles', 'save')); } finally { setBusy(false); }
  };
  const rating = draft?.maximumAgeRating ? system?.values.find(v => v.code === draft.maximumAgeRating)?.label ?? draft.maximumAgeRating : i18n.t('limits.noLimit');
  return (
    <>
      <Sheet open={!picking} onClose={onClose} kind="form" title={i18n.t('limits.title', {name: profile.name})} subtitle={i18n.t('limits.subtitle')}
        primary={{label: i18n.t('limits.save'), loading: busy, disabled: !dirty, onPress: () => void save()}}>
        {/* The ratings list can fail on its own; its error stays visible even once the limits have loaded. */}
        {current.error || systems.error ? <Notice tone="error" message={current.error || systems.error} action={i18n.t('action.tryAgain')} onAction={() => { current.reload(); systems.reload(); }} /> : null}
        {!draft && !current.error && !systems.error ? <StateView loading title={i18n.t('limits.loading')} /> : null}
        {draft ? (
          <View style={{gap: space.lg}}>
            <RowGroup title={i18n.t('limits.content')} footer={draft.blockedLabels.length ? i18n.t('limits.hiddenLabels', {labels: i18n.list(draft.blockedLabels)}) : undefined}>
              <ListRow title={i18n.t('limits.ratingSystem')} meta={system ? `${system.name} (${system.region})` : i18n.t('limits.notSet')} accessory="value" onPress={() => setPicking('system')} />
              <ListRow title={i18n.t('limits.highestRating')} subtitle={i18n.t('limits.highestRatingHelp')} meta={rating} accessory="value" disabled={!system} onPress={system ? () => setPicking('rating') : undefined} />
              <ToggleRow title={i18n.t('limits.allowUnrated')} subtitle={i18n.t('limits.allowUnratedHelp')} value={draft.allowUnrated} onChange={v => setDraft({...draft, allowUnrated: v})} />
            </RowGroup>
            <RowGroup title={i18n.t('limits.features')}>
              {permissions.map(p => <ToggleRow key={p.key} title={i18n.t(p.label)} value={draft[p.key]} onChange={v => setDraft({...draft, [p.key]: v})} />)}
            </RowGroup>
            {failure ? <View style={{paddingHorizontal: rowPaddingX(platform)}}><Notice tone="error" message={failure} /></View> : null}
          </View>
        ) : null}
      </Sheet>
      <Menu open={picking === 'system'} onClose={() => setPicking(undefined)} title={i18n.t('limits.ratingSystem')} items={(systems.value ?? []).map(s => ({id: s.id, label: `${s.name} (${s.region})`, selected: s.id === draft?.ratingSystem}))} onSelect={id => { if (draft) setDraft({...draft, ratingSystem: id, maximumAgeRating: ''}); setPicking(undefined); }} />
      <Menu open={picking === 'rating'} onClose={() => setPicking(undefined)} title={i18n.t('limits.highestRating')} items={[{id: '', label: i18n.t('limits.noLimit'), selected: !draft?.maximumAgeRating}, ...(system?.values ?? []).map(v => ({id: v.code, label: `${v.label} (${v.minimumAge}+)`, selected: v.code === draft?.maximumAgeRating}))]} onSelect={id => { if (draft) setDraft({...draft, maximumAgeRating: id}); setPicking(undefined); }} />
    </>
  );
}

const platformLabel: Record<string, 'device.platform.web' | 'device.platform.ios' | 'device.platform.tvos' | 'device.platform.android' | 'device.platform.androidtv'> = {web: 'device.platform.web', ios: 'device.platform.ios', tvos: 'device.platform.tvos', android: 'device.platform.android', androidtv: 'device.platform.androidtv'};
/** CON-12: a device's own glyph, not a borrowed one. Tablets get tablet, TVs get tvDevice, browsers get browser. */
const platformGlyph: Record<string, IconName> = {web: 'browser', ios: 'phone', ipados: 'tablet', tvos: 'tvDevice', android: 'phone', androidtv: 'tvDevice', tizen: 'tvDevice', webos: 'tvDevice', roku: 'tvDevice'};
const deviceGlyph = (platform: string | undefined, name?: string): IconName => {
  if (platform && platformGlyph[platform]) return platformGlyph[platform]!;
  if (/ipad|tablet/i.test(name ?? '')) return 'tablet';
  return 'browser';
};

type DeviceConfirm = {kind: 'signOut' | 'remove'; device: Device};

export function DevicesSection() {
  const identity = useIdentity();
  const session = useSession();
  const i18n = useI18n();
  const [installation, setInstallation] = useState<string>();
  useEffect(() => { void profileInstallation().then(id => setInstallation(id ?? '')); }, []);
  const devices = useLoaded<readonly Device[]>(async s => (installation === undefined ? [] : identity.devices(installation, s)), [identity, installation], 'devices');
  const [chosen, setChosen] = useState<Device>();
  const [confirming, setConfirming] = useState<DeviceConfirm>();
  const [failure, setFailure] = useState('');
  const act = async (work: () => Promise<unknown>) => { setFailure(''); try { await work(); devices.reload(); } catch (e) { setFailure(say(e, 'devices', 'save')); } };
  const platform = (d: Device) => (platformLabel[d.platform] ? i18n.t(platformLabel[d.platform]!) : d.platform);
  const name = (d: Device) => d.name ?? i18n.t('device.unnamed');
  const items: MenuItem[] = chosen ? [
    ...(deviceAwaitingApproval(chosen) ? [{id: 'approve', label: i18n.t('device.approve'), icon: 'check' as const}, {id: 'deny', label: i18n.t('device.deny'), icon: 'close' as const}] : []),
    {id: 'trust', label: i18n.t(chosen.trusted ? 'device.untrust' : 'device.trust'), icon: 'shield'},
    ...(chosen.sessions ? [{id: 'signOut', label: i18n.t(chosen.current ? 'device.signOutThis' : 'device.signOutOther'), icon: 'signOut' as const, destructive: true}] : []),
    ...(!chosen.current ? [{id: 'remove', label: i18n.t('device.remove'), icon: 'trash' as const, destructive: true}] : []),
  ] : [];
  const list = devices.value;
  return (
    <View>
      {devices.error ? <Notice tone={list?.length ? 'warning' : 'error'} message={devices.error} action={i18n.t('action.tryAgain')} onAction={devices.reload} style={{marginBottom: 8}} /> : null}
      {failure ? <Notice tone="error" message={failure} style={{marginBottom: 8}} /> : null}
      {list?.length ? (
        <RowGroup title={i18n.t('devices.title')} footer={i18n.t('devices.footer')}>
          {list.map(d => (
            <ListRow key={d.id} icon={deviceGlyph(d.platform, d.name)} title={name(d)} subtitle={i18n.t('devices.lastSeen', {platform: platform(d), when: i18n.relativeTime(d.lastSeen)})}
              trailing={d.current ? <Badge label={i18n.t('device.thisDevice')} tone="accent" /> : deviceAwaitingApproval(d) ? <Badge label={i18n.t('device.waiting')} tone="amber" /> : undefined}
              meta={d.current || deviceAwaitingApproval(d) ? undefined : i18n.t(d.sessions ? 'device.signedIn' : 'device.signedOut')} accessory="menu" onPress={() => setChosen(d)} />
          ))}
        </RowGroup>
      ) : null}
      <Menu open={!!chosen} onClose={() => setChosen(undefined)} title={chosen ? name(chosen) : undefined} subtitle={chosen ? `${platform(chosen)}${chosen.ip ? ` · ${chosen.ip}` : ''}` : undefined} items={items}
        onSelect={id => {
          const d = chosen; setChosen(undefined); if (!d) return;
          if (id === 'approve' || id === 'deny') void act(() => identity.approveDevice(d.id, id === 'approve'));
          else if (id === 'trust') void act(() => identity.editDevice(d.id, {trusted: !d.trusted}));
          else if (id === 'signOut' || id === 'remove') setConfirming({kind: id, device: d});
        }} />
      {confirming ? (
        <ConfirmSheet open onDismiss={() => setConfirming(undefined)}
          title={confirming.kind === 'remove' ? i18n.t('confirm.removeDevice.title', {device: name(confirming.device)}) : confirming.device.current ? i18n.t('confirm.signOutThisDevice.title') : i18n.t('confirm.signOutDevice.title', {device: name(confirming.device)})}
          consequence={confirming.kind === 'remove' ? i18n.t('confirm.removeDevice.body') : confirming.device.current ? i18n.t('confirm.signOutThisDevice.body') : undefined}
          confirmLabel={i18n.t(confirming.kind === 'remove' ? 'action.removeShort' : 'action.signOut')} describeError={e => say(e, 'devices', 'save')}
          onConfirm={async () => {
            const d = confirming.device;
            if (confirming.kind === 'remove') { await identity.removeDevice(d.id); devices.reload(); return; }
            await identity.signOutDevice(d.id);
            if (d.current) session.signOut(); else devices.reload();
          }} />
      ) : null}
    </View>
  );
}

/** Two-step verification (the glossary's name; CON-20) for a direct account. */
export function TwoFactorSection(_: {/** For RowGroup: this row has a leading glyph. */ leading?: boolean} = {}) {
  const identity = useIdentity();
  const i18n = useI18n();
  const {space} = useTheme();
  const platform = useSpecPlatform();
  const state = useLoaded<TwoFactorState>(s => identity.twoFactor(s), [identity]);
  const [step, setStep] = useState<'idle' | 'password' | 'key' | 'codes' | 'disable'>('idle');
  const [password, setPassword] = useState('');
  const [code, setCode] = useState('');
  const [enrolment, setEnrolment] = useState<TwoFactorEnrolment>();
  const [busy, setBusy] = useState(false);
  const [failure, setFailure] = useState('');
  const reset = () => { setStep('idle'); setPassword(''); setCode(''); setEnrolment(undefined); setFailure(''); };
  const run = async (work: () => Promise<void>) => { setBusy(true); setFailure(''); try { await work(); } catch (e) { setFailure(stepUpMessage(e)); } finally { setBusy(false); } };
  const on = state.value?.enabled;
  const pad = {gap: space.md, paddingHorizontal: rowPaddingX(platform)};
  return (
    <>
      {/* Always exactly one row, so a RowGroup never shows an empty slot or a notice inside the group. */}
      {!state.value && state.error ? <ListRow icon="shield" title={i18n.t('security.twoStep.title')} subtitle={state.error} meta={i18n.t('action.tryAgain')} onPress={state.reload} /> : null}
      {!state.value && !state.error ? <ListRow icon="shield" title={i18n.t('security.twoStep.title')} meta={i18n.t('status.loading')} /> : null}
      {state.value ? (
        <ListRow icon="shield" title={i18n.t('security.twoStep.title')} subtitle={on ? i18n.t('security.twoStep.codesLeft', {count: state.value.recoveryCodesRemaining}) : i18n.t('security.twoStep.offHelp')}
          meta={i18n.t(on ? 'security.twoStep.on' : 'security.twoStep.off')} accessory="navigation" onPress={() => { reset(); setStep(on ? 'disable' : 'password'); }} />
      ) : null}
      <Sheet open={step === 'password'} onClose={reset} kind="form" title={i18n.t('security.twoStep.turnOn')} subtitle={i18n.t('security.twoStep.confirmPassword')}
        primary={{label: i18n.t('action.continue'), loading: busy, disabled: !password, onPress: () => void run(async () => { setEnrolment(await identity.enrolTwoFactor(password)); setStep('key'); })}}>
        <View style={pad}>{failure ? <Notice tone="error" message={failure} /> : null}<Field label={i18n.t('auth.password')} secure autoFocus textContentType="password" value={password} onChangeText={setPassword} /></View>
      </Sheet>
      <Sheet open={step === 'key'} onClose={reset} kind="form" title={i18n.t('security.addToAuthenticator')} subtitle={i18n.t('security.twoStep.enterKey')}
        primary={{label: i18n.t('security.twoStep.verify'), loading: busy, disabled: code.length < 6, onPress: () => void run(async () => { state.setValue(await identity.verifyTwoFactor(password, code)); setStep('codes'); })}}>
        <View style={pad}>
          {failure ? <Notice tone="error" message={failure} /> : null}
          <Surface tone="soft"><Text variant="heading" selectable style={{letterSpacing: 1}}>{enrolment?.secret.replace(/(.{4})/g, '$1 ').trim()}</Text></Surface>
          <Field label={i18n.t('auth.code')} keyboardType="number-pad" textContentType="oneTimeCode" autoFocus value={code} onChangeText={v => setCode(v.replace(/\D/g, '').slice(0, 8))} />
        </View>
      </Sheet>
      <Sheet open={step === 'codes'} onClose={reset} kind="acknowledge" title={i18n.t('confirm.recoveryCodes.title')} subtitle={i18n.t('confirm.recoveryCodes.body')} primary={{label: i18n.t('confirm.recoveryCodes.action'), onPress: reset}}>
        <View style={{paddingHorizontal: rowPaddingX(platform)}}><Surface tone="soft"><Text variant="body" selectable style={{lineHeight: 28}}>{(enrolment?.recoveryCodes ?? []).join('\n')}</Text></Surface></View>
      </Sheet>
      <Sheet open={step === 'disable'} onClose={reset} kind="form" title={i18n.t('security.twoStep.turnOff')} subtitle={i18n.t('security.twoStep.turnOffBody')}
        primary={{label: i18n.t('security.twoStep.turnOffAction'), tone: 'destructive', loading: busy, disabled: !password || code.length < 6, onPress: () => void run(async () => { await identity.disableTwoFactor(password, code); reset(); state.reload(); })}}>
        <View style={pad}>
          {failure ? <Notice tone="error" message={failure} /> : null}
          <Field label={i18n.t('account.currentPassword')} secure autoFocus textContentType="password" value={password} onChangeText={setPassword} />
          <Field label={i18n.t('profile.pinRecoveryCode')} textContentType="oneTimeCode" autoCapitalize="none" autoCorrect={false} maxLength={40} value={code} onChangeText={setCode} />
        </View>
      </Sheet>
    </>
  );
}

/** The server's direct-password rule: 8+ characters with upper- and lowercase letters and a non-letter. */
// The only rule is the server's (8+ characters, 72 bytes at most); strength is advice, never a gate.
const strongEnough = (v: string) => passwordStrength(v).acceptable;
/** The advisory line under a new password: the rule while empty, then the strength and one hint. */
const strengthHint = (v: string) => {
  if (!v) return activeI18n().t('account.passwordRule');
  const r = passwordStrength(v);
  return r.hint ? `${r.label} · ${r.hint}` : r.label;
};

/** Change the direct account's password (APL-SET-01 §2). */
export function ChangePasswordSheet({open, onClose}: {open: boolean; onClose: () => void}) {
  const identity = useIdentity();
  const i18n = useI18n();
  const {space} = useTheme();
  const platform = useSpecPlatform();
  const [current, setCurrent] = useState('');
  const [next, setNext] = useState('');
  const [again, setAgain] = useState('');
  const [code, setCode] = useState('');
  const [busy, setBusy] = useState(false);
  const [failure, setFailure] = useState('');
  // C45: with two-step verification on, the change carries a current code in the same request.
  const twoStep = useLoaded<TwoFactorState>(s => (open ? identity.twoFactor(s) : Promise.resolve({enabled: false, pendingEnrolment: false, recoveryCodesRemaining: 0} as TwoFactorState)), [identity, open]);
  const needsCode = !!twoStep.value?.enabled;
  useEffect(() => { if (open) { setCurrent(''); setNext(''); setAgain(''); setCode(''); setFailure(''); } }, [open]);
  const mismatch = again.length > 0 && again !== next;
  const weak = next.length > 0 && !strongEnough(next);
  const tooLong = weak && [...next].length >= 8;
  const save = async () => {
    setBusy(true); setFailure('');
    try {
      await identity.changePassword(current, next, needsCode ? code.trim() : undefined);
      showToast({message: i18n.t('auth.passwordChanged'), icon: 'check'});
      onClose();
    } catch (e) {
      const status = e && typeof e === 'object' ? (e as {status?: unknown}).status : undefined;
      setFailure(status === 401 || (e as {code?: unknown})?.code === 'current_password_incorrect' ? i18n.t('account.wrongPassword') : say(e, 'account', 'save'));
    } finally { setBusy(false); }
  };
  return (
    <Sheet open={open} onClose={onClose} kind="form" title={i18n.t('account.changePasswordTitle')}
      primary={{label: i18n.t('action.save'), loading: busy, disabled: !current || !strongEnough(next) || next !== again || (needsCode && code.trim().length < 6), onPress: () => void save()}}>
      <View style={{gap: space.md, paddingHorizontal: rowPaddingX(platform)}}>
        {failure ? <Notice tone="error" message={failure} /> : null}
        <Field label={i18n.t('account.currentPassword')} secure autoFocus textContentType="password" autoComplete="current-password" value={current} onChangeText={setCurrent} />
        <Field label={i18n.t('auth.newPassword')} secure textContentType="newPassword" autoComplete="new-password" value={next} onChangeText={setNext} hint={strengthHint(next)} error={weak ? i18n.t(tooLong ? 'account.passwordTooLong' : 'account.passwordWeak') : undefined} />
        <Field label={i18n.t('account.confirmPassword')} secure textContentType="newPassword" value={again} onChangeText={setAgain} error={mismatch ? i18n.t('account.passwordMismatch') : undefined} />
        {needsCode ? <Field label={i18n.t('profile.pinRecoveryCode')} textContentType="oneTimeCode" autoCapitalize="none" autoCorrect={false} maxLength={40} value={code} onChangeText={setCode} /> : null}
      </View>
    </Sheet>
  );
}

/** Tier 1 confirmation. C45: the signed-in session is the authority, so no password is asked. Signs this device out too. */
export function SignOutEverywhereSheet({open, onClose}: {open: boolean; onClose: () => void}) {
  const identity = useIdentity();
  const session = useSession();
  const i18n = useI18n();
  return (
    <ConfirmSheet open={open} onDismiss={onClose} title={i18n.t('account.signOutEverywhere.title')} consequence={i18n.t('account.signOutEverywhere.body')} confirmLabel={i18n.t('account.signOutEverywhere.action')}
      describeError={stepUpMessage} onConfirm={async () => { await identity.signOutEverywhere(); session.signOut(); }} />
  );
}
