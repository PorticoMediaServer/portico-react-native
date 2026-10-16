import React, {useCallback, useEffect, useMemo, useRef, useState} from 'react';
import {NativeModules, View} from 'react-native';
import {IdentityClient, type PINRecoveryMethods, type ProfileAvatar} from '../../../../packages/client-core/src/index';
import {ManagedProfilesClient, PROFILE_ART, parseDirectSnapshot, type DirectSnapshot, type ManagedProfile} from '../../../../packages/client-core/src/profile-management';
import {profileActions} from '../../../../packages/client-core/src/presentation/index';
import {useSession} from '../app/session';
import {useI18n} from '../app/i18n';
import {ShownError, say} from '../app/errors';
import {ConfirmSheet, Field, ListRow, Menu, Notice, PinEntry, RowGroup, Sheet, StateView, Text, rowPaddingX, showToast, useSpecPlatform, useTheme, type MenuItem} from '../ui';
import {Avatar} from '../ui';

const picker = NativeModules.PorticoImagePicker as undefined | {pick(): Promise<null | {base64: string; contentType: string; bytes: number}>};
function bytesOf(base64: string): Uint8Array {
  const text = globalThis.atob(base64), out = new Uint8Array(text.length);
  for (let i = 0; i < text.length; i++) out[i] = text.charCodeAt(i);
  return out;
}

/**
 * The direct (server) account behind this session: username, profiles and whether this profile
 * may manage them (only the main profile, or an account session, can). Shared by the Settings hub
 * and the Account page (D-ID-4: a direct sign-in still manages profiles, sessions and MFA).
 */
export function useDirectAccount() {
  const session = useSession();
  const local = session.session?.viewer.authority === 'local';
  const [snapshot, setSnapshot] = useState<DirectSnapshot>();
  const [error, setError] = useState('');
  const [revision, setRevision] = useState(0);
  useEffect(() => {
    if (!local || !session.api) return;
    let active = true;
    session.api.request<unknown>('/v1/direct').then(raw => {
      if (!active) return;
      try { setSnapshot(parseDirectSnapshot(raw)); setError(''); } catch (e) { setError(say(e, 'account', 'load')); }
    }, e => { if (active) setError(say(e, 'account', 'load')); });
    return () => { active = false; };
  }, [local, session.api, revision]);
  const client = useMemo(
    () => (snapshot && session.api ? new ManagedProfilesClient(session.api, {authority: 'local', accountId: snapshot.account.id, serverId: snapshot.serverId}) : undefined),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [snapshot?.account.id, snapshot?.serverId, session.api],
  );
  const reload = useCallback(() => setRevision(r => r + 1), []);
  return {local, snapshot, error, client, reload};
}

type Sheet =
  | {kind: 'add'}
  | {kind: 'rename'; profile: ManagedProfile}
  | {kind: 'pin'; profile: ManagedProfile}
  | {kind: 'removePin'; profile: ManagedProfile}
  | {kind: 'forgotPin'; profile: ManagedProfile}
  | {kind: 'delete'; profile: ManagedProfile; playlists?: number; revision: number};

/**
 * Profiles on a direct server account (APL-SET-01): add, rename, set or change or remove a PIN,
 * a picture, limits, and delete. Managing needs the main profile; the server enforces it too.
 */
export function LocalProfilesSection({account, onLimits}: {account: ReturnType<typeof useDirectAccount>; onLimits: (profile: {id: string; name: string}) => void}) {
  const {api, session} = useSession();
  const i18n = useI18n();
  const {snapshot, client, reload} = account;
  const token = useRef('');
  token.current = session?.accessToken ?? '';
  const identity = useMemo(() => new IdentityClient(api!, async (path, body, contentType) => {
    const response = await fetch(api!.baseUrl + path, {method: 'POST', headers: {Authorization: 'Bearer ' + token.current, 'Content-Type': contentType}, body: body as never});
    const value = await response.json().catch(() => null);
    if (response.status === 415) throw new ShownError(i18n.t('profile.pictureRejected'));
    if (!response.ok) throw Object.assign(new Error('avatar upload failed'), {status: response.status, code: value?.error?.code});
    return value;
  }), [api, i18n]);
  const [avatars, setAvatars] = useState<readonly ProfileAvatar[]>([]);
  const [chosen, setChosen] = useState<ManagedProfile>();
  const [sheet, setSheet] = useState<Sheet>();
  const [problem, setProblem] = useState('');
  const [busy, setBusy] = useState('');
  const loadAvatars = useCallback(() => identity.avatars().then(setAvatars, () => {}), [identity]);
  useEffect(() => { void loadAvatars(); }, [loadAvatars]);
  if (!snapshot) return null;
  const profiles = snapshot.profiles;
  const current = session?.viewer.profileId;
  const work = async (profile: ManagedProfile, run: () => Promise<unknown>): Promise<boolean> => {
    setBusy(profile.id); setProblem('');
    try { await run(); await loadAvatars(); return true; } catch (e) { setProblem(say(e, 'profiles', 'save')); return false; } finally { setBusy(''); }
  };
  const choosePicture = async (profile: ManagedProfile) => {
    const picked = await picker?.pick().catch(() => null);
    if (picked) await work(profile, () => identity.uploadAvatar(profile.id, bytesOf(picked.base64), picked.contentType));
  };
  const has = (id: string) => avatars.some(a => a.profileId === id);
  // CON-12: one shared model decides the profile menu order.
  const items: MenuItem[] = chosen ? (() => {
    const model = profileActions(
      {hasPicture: has(chosen.id), pinRequired: chosen.pinRequired, primary: chosen.primary},
      {canManage: snapshot.canManage, isCurrent: chosen.id === current},
    );
    const out: MenuItem[] = [];
    for (const action of model) {
      if (action.id === 'forgetDevices' && !client) continue;
      if (action.id === 'picture' && !picker) continue;
      if (action.id === 'delete' && chosen.id === current) continue;
      if (action.id === 'changePin') out.push({id: 'pin', label: i18n.t(chosen.pinRequired ? 'profile.changePin' : 'profile.setPin'), icon: 'lock'});
      else if (action.id === 'limits') out.push({id: 'limits', label: i18n.t(action.label), icon: action.icon, detail: i18n.t('profile.limitsHelp')});
      else out.push({id: action.id, label: i18n.t(action.label), icon: action.icon, ...(action.destructive ? {destructive: true} : {})});
    }
    if (chosen.pinRequired) out.push({id: 'removePin', label: i18n.t('profile.removePin'), icon: 'lock'});
    return out;
  })() : [];
  const select = (id: string) => {
    const p = chosen; if (!p) return;
    if (id === 'picture') void choosePicture(p);
    else if (id === 'removePicture') void work(p, () => identity.removeAvatar(p.id));
    else if (id === 'rename') setSheet({kind: 'rename', profile: p});
    else if (id === 'pin') setSheet({kind: 'pin', profile: p});
    else if (id === 'removePin') setSheet({kind: 'removePin', profile: p});
    // A forgotten PIN is replaced by the signed-in account, as on the web.
    else if (id === 'forgotPin') setSheet({kind: 'forgotPin', profile: p});
    else if (id === 'limits') onLimits(p);
    // The devices that remember this profile ask for its PIN again; nothing else changes.
    else if (id === 'forgetDevices' && client) void work(p, () => client.forgetTrust(p.id)).then(ok => { if (ok) showToast({message: i18n.t('profile.devicesForgotten', {name: p.name}), icon: 'check'}); });
    else if (id === 'delete' && client) {
      void client.previewDelete(p).then(preview => setSheet({kind: 'delete', profile: p, playlists: preview.playlists, revision: preview.revision}), e => setProblem(say(e, 'profiles', 'load')));
    }
  };
  const done = (message?: string) => { setSheet(undefined); reload(); if (message) showToast({message, icon: 'check'}); };
  return (
    <View>
      {problem ? <Notice tone="error" message={problem} style={{marginBottom: 8}} /> : null}
      <RowGroup title={i18n.t('profiles.title')} footer={profiles.length >= 8 ? i18n.t('profile.limitReached') : undefined}>
        {profiles.map(p => {
          const avatar = avatars.find(a => a.profileId === p.id);
          const subtitle = [p.primary ? i18n.t('profile.main') : '', p.pinRequired ? i18n.t('profile.protected') : ''].filter(Boolean).join(' · ') || undefined;
          return (
            <ListRow
              key={p.id}
              leadingView={<Avatar name={p.name} art={p.art} size={40} source={avatar ? {uri: api!.baseUrl + avatar.url + (avatar.url.includes('?') ? '&' : '?') + 'size=160', headers: {Authorization: 'Bearer ' + token.current}} : undefined} />}
              title={p.name} subtitle={subtitle} meta={p.id === current ? i18n.t('profile.current') : undefined}
              accessory="menu" accessibilityState={{busy: busy === p.id}} onPress={() => setChosen(p)} />
          );
        })}
        {profiles.length < 8 ? <ListRow icon="plus" tone="action" title={i18n.t('profile.add')} onPress={() => setSheet({kind: 'add'})} /> : null}
      </RowGroup>
      <Menu open={!!chosen} onClose={() => setChosen(undefined)} title={chosen?.name} items={items} onSelect={select} />
      {client && sheet?.kind === 'add' ? <NameSheet title={i18n.t('profile.addTitle')} confirm={i18n.t('profile.add')} initial="" onClose={() => setSheet(undefined)}
        onSave={async name => { await client.create(name, PROFILE_ART[profiles.length % PROFILE_ART.length]); done(i18n.t('profile.added', {name})); }} /> : null}
      {client && sheet?.kind === 'rename' ? <NameSheet title={i18n.t('profile.renameTitle', {name: sheet.profile.name})} confirm={i18n.t('action.save')} initial={sheet.profile.name} onClose={() => setSheet(undefined)}
        onSave={async name => { await client.edit(sheet.profile, {name}); done(); }} /> : null}
      {client && sheet?.kind === 'pin' ? <SetPinSheet profile={sheet.profile} onClose={() => setSheet(undefined)} onSave={async pin => { await client.edit(sheet.profile, {pin}); done(i18n.t('profile.pinSaved', {name: sheet.profile.name})); }} /> : null}
      {sheet?.kind === 'forgotPin' ? <PINRecoverySheet profile={sheet.profile} identity={identity} onClose={() => done()} /> : null}
      {client && sheet?.kind === 'removePin' ? (
        <ConfirmSheet open onDismiss={() => setSheet(undefined)} title={i18n.t('profile.removePinConfirm.title', {name: sheet.profile.name})} consequence={i18n.t('profile.removePinConfirm.body', {name: sheet.profile.name})} confirmLabel={i18n.t('profile.removePin')}
          describeError={e => say(e, 'profiles', 'save')} onConfirm={async () => { await client.edit(sheet.profile, {pin: ''}); done(i18n.t('profile.pinRemoved', {name: sheet.profile.name})); }} />
      ) : null}
      {client && sheet?.kind === 'delete' ? (
        <ConfirmSheet open onDismiss={() => setSheet(undefined)} title={i18n.t('profile.deleteConfirm.title', {name: sheet.profile.name})}
          consequence={[i18n.t('profile.deleteConfirm.body'), sheet.playlists ? i18n.t('profile.deleteConfirm.playlists', {count: sheet.playlists}) : ''].filter(Boolean).join(' ')}
          confirmLabel={i18n.t('profile.deleteConfirm.action')} describeError={e => say(e, 'profiles', 'save')}
          onConfirm={async () => { await client.delete({profileId: sheet.profile.id, revision: sheet.revision, primary: false}); done(i18n.t('profile.deleted', {name: sheet.profile.name})); }} />
      ) : null}
    </View>
  );
}

/** Add or rename: one field, one primary. */
function NameSheet({title, confirm, initial, onSave, onClose}: {title: string; confirm: string; initial: string; onSave: (name: string) => Promise<void>; onClose: () => void}) {
  const i18n = useI18n();
  const platform = useSpecPlatform();
  const [name, setName] = useState(initial);
  const [busy, setBusy] = useState(false);
  const [failure, setFailure] = useState('');
  const valid = name.trim().length > 0 && name.trim().length <= 120 && name.trim() !== initial;
  const save = async () => {
    setBusy(true); setFailure('');
    try { await onSave(name.trim()); } catch (e) { setFailure(say(e, 'profiles', 'save')); } finally { setBusy(false); }
  };
  return (
    <Sheet open onClose={onClose} title={title} kind="form" primary={{label: confirm, loading: busy, disabled: !valid, onPress: () => void save()}}>
      <View style={{gap: 12, paddingHorizontal: rowPaddingX(platform)}}>
        <Field label={i18n.t('profile.name')} value={name} onChangeText={setName} autoFocus autoCapitalize="words" maxLength={120} error={failure || undefined} returnKeyType="done" onSubmitEditing={() => { if (valid) void save(); }} />
      </View>
    </Sheet>
  );
}

/** Set or change a PIN: choose four digits, then repeat them. Submits on the last digit. */
function SetPinSheet({profile, onSave, onClose}: {profile: ManagedProfile; onSave: (pin: string) => Promise<void>; onClose: () => void}) {
  const i18n = useI18n();
  const [first, setFirst] = useState('');
  const [value, setValue] = useState('');
  const [error, setError] = useState('');
  const [errorKey, setErrorKey] = useState(0);
  const [busy, setBusy] = useState(false);
  const complete = async (pin: string) => {
    if (!first) { setFirst(pin); setValue(''); setError(''); return; }
    if (pin !== first) { setFirst(''); setError(i18n.t('profile.pinMismatch')); setErrorKey(k => k + 1); return; }
    setBusy(true);
    try { await onSave(pin); } catch (e) { setFirst(''); setError(say(e, 'profiles', 'save')); setErrorKey(k => k + 1); } finally { setBusy(false); }
  };
  return (
    <Sheet open onClose={onClose} title={i18n.t('profile.pinTitle', {name: profile.name})} kind="form">
      <PinEntry key={first ? 'repeat' : 'choose'} label={i18n.t(first ? 'profile.pinRepeat' : 'profile.pinChoose')} value={value} onChange={setValue} onComplete={pin => void complete(pin)} error={error || undefined} errorKey={errorKey} disabled={busy} />
    </Sheet>
  );
}

/**
 * A forgotten PIN (exported for the profile picker's "Forgot PIN?", APL-AUTH-09). C45: the signed-in
 * account session resets it; there is no password or code prompt (those are asked only in the
 * email, password and two-step forms).
 */
export function PINRecoverySheet({profile, identity, onClose}: {profile: {id: string; name: string}; identity: IdentityClient; onClose: () => void}) {
  const i18n = useI18n();
  const platform = useSpecPlatform();
  const {space} = useTheme();
  const [methods, setMethods] = useState<PINRecoveryMethods>();
  const [pin, setPin] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [done, setDone] = useState(false);
  useEffect(() => { identity.pinRecovery().then(setMethods, e => setError(say(e, 'profiles', 'load'))); }, [identity]);
  const possible = !!methods;
  const ready = /^\d{4}$/.test(pin);
  const reset = async () => {
    setBusy(true); setError('');
    try {
      await identity.resetPIN(profile.id, pin);
      setDone(true);
    } catch (e) { setError(say(e, 'profiles', 'save')); } finally { setBusy(false); }
  };
  if (done) {
    return (
      <Sheet open onClose={onClose} kind="acknowledge" title={i18n.t('profile.pinChanged')} primary={{label: i18n.t('action.done'), onPress: onClose}}>
        <Text variant="body" tone="secondary" style={{paddingHorizontal: rowPaddingX(platform)}}>{i18n.t('profile.pinSavedBody', {name: profile.name})}</Text>
      </Sheet>
    );
  }
  return (
    <Sheet open onClose={onClose} title={i18n.t('profile.pinRecoveryTitle', {name: profile.name})} kind="form"
      primary={possible ? {label: i18n.t('profile.pinRecoveryAction'), loading: busy, disabled: !ready, onPress: () => void reset()} : undefined}
      cancelLabel={possible ? undefined : i18n.t('action.close')}>
      <View style={{gap: space.md, paddingHorizontal: rowPaddingX(platform)}}>
        {error ? <Notice tone="error" message={error} /> : null}
        {!methods && !error ? <StateView loading title={i18n.t('status.loading')} /> : null}
        {methods && !possible ? <Notice tone="info" message={i18n.t('profile.pinRecoveryUnavailable')} /> : null}
        {possible ? (
          <>
            <PinEntry label={i18n.t('profile.pinChoose')} value={pin} onChange={setPin} autoFocus={false} />
          </>
        ) : null}
      </View>
    </Sheet>
  );
}
