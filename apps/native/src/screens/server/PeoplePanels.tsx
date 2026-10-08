import React, {useEffect, useMemo, useState} from 'react';
import {Share, View} from 'react-native';
import {contentRatings, keyScopes, parseAccessAPIKey, parseAccessDevicePage, parseAccessMember, parseInvitation, parseLimitsDocument, type AccessAPIKey, type AccessDevice, type AccessMember, type AccessTier, type Invitation, type KeyScope, type MemberLimits} from '../../../../../packages/client-core/src/server-administration';
import {passwordStrength} from '../../../../../packages/client-core/src/password-strength';
import {accessListPath, scopeHelp, scopeLabels, tierLabels, type DirectMember} from '../../../../../packages/client-core/src/server-admin/panel-logic';
import {createOperationIds} from '../../../../../packages/client-core/src/server-admin/server-forms';
import {useSession} from '../../app/session';
import {useI18n} from '../../app/i18n';
import {useLibrariesContext} from '../../app/libraries-context';
import {nextCursorOf, operationId, problem, useAction, usePagedList, useRead} from '../../app/server-console';
import {ConfirmSheet, Field, ListRow, Menu, Notice, RowGroup, Sheet, ToggleRow, useTheme} from '../../ui';
import {InviteSheet} from '../InviteSheet';
import {PickRow, TypedRow} from '../settings/ServerForms';

/** The platform words that mean a television, whichever client announced the device. */
const televisionPlatforms = new Set(['tvos', 'androidtv', 'firetv', 'vega', 'roku', 'webos', 'tizen']);

const since = (iso?: string) => (iso ? new Date(iso).toLocaleDateString(undefined, {month: 'short', day: 'numeric', year: 'numeric'}) : '—');
const rows = <T,>(raw: unknown, each: (x: unknown) => T): T[] => {
  const list = (raw as {items?: unknown})?.items;
  if (!Array.isArray(list)) throw Object.assign(new Error('invalid_response'), {code: 'invalid_response'});
  return list.map(each);
};

/** People › Accounts: everyone who can use this server. An account opens to its role, libraries, sign-in, limits and devices. */
export function AccountsPanel() {
  const {api} = useSession();
  const t = useI18n().t;
  const libraries = useLibrariesContext();
  const read = useRead<{items: DirectMember[]}>(() => api.request('/v1/direct/members'), [api]);
  // Roles and limits come from the access list, joined by account.
  const access = usePagedList(async cursor => { const raw = await api.request(accessListPath('members', cursor)); return {items: rows(raw, parseAccessMember), nextCursor: nextCursorOf(raw)}; }, [api]);
  const [adding, setAdding] = useState(false);
  const [open, setOpen] = useState<string>();
  const members = read.data?.items ?? [];
  const libName = (id: string) => libraries.items.find(l => l.id === id)?.name ?? t('server.people.libraryGone');
  const selected = members.find(m => m.id === open);
  const changed = () => { read.reload(); access.reload(); };
  return (
    <>
      {read.error ? <Notice tone="error" message={read.error} action={t('action.tryAgain')} onAction={read.reload} /> : null}
      <RowGroup title={t('web.people.accountsTitle')} footer={t('web.people.accountsLede')}>
        {members.map(m => {
          const limits = access.items?.find(a => a.accountId === m.id)?.limits;
          const facts = [m.hostedAccountId ? t('server.people.porticoAccount') : '', m.role === 'owner' || !m.allowedLibraries.length ? t('server.people.allLibraries') : m.allowedLibraries.map(libName).join(', '), limits?.maxStreams ? t('server.people.streams', {count: limits.maxStreams}) : '', limits?.maxContentRating ? t('server.people.upTo', {rating: limits.maxContentRating}) : ''];
          return <ListRow key={m.id} icon="account" title={m.username} subtitle={facts.filter(Boolean).join(' · ')} meta={m.disabled ? t('web.people.disabledBadge') : tierLabels[m.role]} accessory="navigation" onPress={() => setOpen(m.id)} />;
        })}
        {access.more ? <ListRow tone="action" title={t('server.showMore')} onPress={access.loadMore} /> : null}
        <ListRow tone="action" icon="plus" title={t('web.people.addAccount')} onPress={() => setAdding(true)} />
      </RowGroup>
      <AccountSheet member={selected} access={access.items?.find(a => a.accountId === selected?.id)} libraries={libraries.items} onClose={() => setOpen(undefined)} onChanged={changed} />
      <AddAccountSheet open={adding} libraries={libraries.items} onClose={() => setAdding(false)} onAdded={() => { setAdding(false); changed(); }} />
    </>
  );
}

function LibraryChoice({all, chosen, libraries, onChange}: {all: boolean; chosen: string[]; libraries: readonly {id: string; name: string}[]; onChange: (all: boolean, chosen: string[]) => void}) {
  const t = useI18n().t;
  return (
    <RowGroup title={t('web.people.visibleLibraries')}>
      <ToggleRow title={t('web.people.allLibrariesLater')} value={all} onChange={v => onChange(v, v ? [] : chosen)} />
      {!all ? libraries.map(l => <ToggleRow key={l.id} title={l.name} value={chosen.includes(l.id)} onChange={v => onChange(false, v ? [...chosen, l.id] : chosen.filter(x => x !== l.id))} />) : null}
    </RowGroup>
  );
}

/** One account: who it is, what it may do, and the devices signed in with it. */
function AccountSheet({member, access, libraries, onClose, onChanged}: {member?: DirectMember; access?: AccessMember; libraries: readonly {id: string; name: string}[]; onClose: () => void; onChanged: () => void}) {
  const {api} = useSession();
  const t = useI18n().t;
  const {space} = useTheme();
  const action = useAction();
  const [opIds] = useState(() => createOperationIds(operationId));
  const owner = member?.role === 'owner';
  const id = member?.id;
  const doc = useRead(async () => (id && !owner ? parseLimitsDocument(await api.request(`/v1/admin/access/members/${encodeURIComponent(id)}/limits`), id) : undefined), [api, id, owner]);
  const [limits, setLimits] = useState<MemberLimits>();
  const [role, setRole] = useState<AccessTier>('member');
  const [all, setAll] = useState(true);
  const [chosen, setChosen] = useState<string[]>([]);
  const [disabled, setDisabled] = useState(false);
  const [password, setPassword] = useState('');
  useEffect(() => { setLimits(doc.data?.limits); }, [doc.data]);
  useEffect(() => {
    if (!member) return;
    setRole(access?.role ?? member.role); setAll(!member.allowedLibraries.length); setChosen(member.allowedLibraries); setDisabled(member.disabled); setPassword(''); action.clear();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [member?.id, member?.revision, access?.revision]);
  const memberDirty = !!member && (disabled !== member.disabled || !!password || JSON.stringify(all ? [] : chosen) !== JSON.stringify(member.allowedLibraries));
  const limitsDirty = !!doc.data && !!limits && JSON.stringify(limits) !== JSON.stringify(doc.data.limits);
  const roleDirty = !!access && role !== access.role;
  const weak = !!password && !passwordStrength(password).acceptable;
  const save = () => void action.run(async () => {
    if (!member) return;
    if (roleDirty && access) await api.request(`/v1/admin/access/members/${encodeURIComponent(member.id)}/role`, 'PUT', {expectedRevision: access.revision, operationId: opIds.forPayload(JSON.stringify({id: member.id, revision: access.revision, role})), role});
    opIds.release();
    if (limitsDirty && doc.data && limits) await api.request(`/v1/admin/access/members/${encodeURIComponent(member.id)}/limits`, 'PUT', {expectedRevision: doc.data.revision, operationId: opIds.forPayload(JSON.stringify({id: member.id, revision: doc.data.revision, limits})), limits});
    opIds.release();
    if (memberDirty) await api.request(`/v1/direct/members/${encodeURIComponent(member.id)}`, 'PATCH', {username: member.username, password, name: member.username, allowedLibraries: all ? [] : chosen, disabled, expectedRevision: member.revision});
  }).then(ok => { if (ok) { onChanged(); onClose(); } });
  return (
    <Sheet open={!!member} onClose={onClose} kind="form" title={member?.username} subtitle={member ? (member.hostedAccountId ? t('server.people.porticoAccount') : t('server.people.serverAccount')) : undefined}
      primary={owner ? undefined : {label: t('action.save'), loading: action.busy, disabled: !(memberDirty || limitsDirty || roleDirty) || weak || (!all && !chosen.length), onPress: save}} cancelLabel={owner ? t('action.done') : undefined}>
      {member ? (
        <View style={{gap: space.lg}}>
          {action.error ? <Notice tone="error" message={action.error} /> : null}
          {doc.error ? <Notice tone="error" message={doc.error} action={t('action.tryAgain')} onAction={doc.reload} /> : null}
          <RowGroup>
            {owner || !access ? <ListRow title={t('web.access.roleLabel')} meta={tierLabels[member.role]} /> : <PickRow title={t('web.access.roleLabel')} value={role} options={[{id: 'member', label: t('web.access.roleMember')}, {id: 'admin', label: t('web.access.roleAdmin')}]} onChange={v => setRole(v as AccessTier)} />}
            {!owner ? <ToggleRow title={t('web.people.disableAccount')} subtitle={t('web.people.disableAccountHelp')} value={disabled} onChange={setDisabled} /> : null}
          </RowGroup>
          {!owner ? <LibraryChoice all={all} chosen={chosen} libraries={libraries} onChange={(a, c) => { setAll(a); setChosen(c); }} /> : null}
          {!owner && !member.hostedAccountId ? <Field label={t('auth.newPassword')} hint={t('web.people.keepPasswordHelp')} secure value={password} onChangeText={setPassword} error={weak ? t('server.people.passwordWeak') : undefined} /> : null}
          {!owner && member.hostedAccountId ? <Notice tone="info" message={t('web.people.hostedNote')} /> : null}
          {limits && !owner ? (
            <RowGroup title={t('web.access.limits')} footer={limits.schedule.windows.length ? t('server.people.scheduleKept', {count: limits.schedule.windows.length, zone: limits.schedule.timezone || t('server.people.serverTime')}) : t('web.access.zeroNoLimit')}>
              <TypedRow numeric title={t('web.access.maxStreams')} value={String(limits.maxStreams)} shown={limits.maxStreams ? String(limits.maxStreams) : t('limits.noLimit')} onDone={text => setLimits({...limits, maxStreams: Math.min(1000, Math.max(0, Number(text) || 0))})} />
              <TypedRow numeric title={t('web.access.remoteQuality')} help={t('web.access.remoteQualityHelp')} value={String(Math.round(limits.remoteBitrateKbps / 1000))} shown={limits.remoteBitrateKbps ? `${Math.round(limits.remoteBitrateKbps / 1000)} ${t('settings.unit.mbps')}` : t('limits.noLimit')} onDone={text => setLimits({...limits, remoteBitrateKbps: Math.min(200, Math.max(0, Number(text) || 0)) * 1000})} />
              <PickRow title={t('web.access.highestRating')} value={limits.maxContentRating} options={[{id: '', label: t('limits.noLimit')}, ...contentRatings.map(r => ({id: r, label: r}))]} onChange={maxContentRating => setLimits({...limits, maxContentRating})} />
              <ToggleRow title={t('limits.allowUnrated')} value={limits.allowUnrated} onChange={allowUnrated => setLimits({...limits, allowUnrated})} />
              <TypedRow title={t('web.limits.hiddenLabels')} help={t('web.access.hiddenLabelsHelp')} value={limits.tagPolicy.deniedLabels.join(', ')} onDone={text => setLimits({...limits, tagPolicy: {deniedLabels: text.split(',').map(x => x.trim()).filter(Boolean)}})} />
            </RowGroup>
          ) : null}
          <AccountDevices accountId={member.id} />
        </View>
      ) : null}
    </Sheet>
  );
}

function AddAccountSheet({open, libraries, onClose, onAdded}: {open: boolean; libraries: readonly {id: string; name: string}[]; onClose: () => void; onAdded: () => void}) {
  const {api} = useSession();
  const t = useI18n().t;
  const {space} = useTheme();
  const action = useAction();
  const [username, setUsername] = useState('');
  const [name, setName] = useState('');
  const [password, setPassword] = useState('');
  const [all, setAll] = useState(true);
  const [chosen, setChosen] = useState<string[]>([]);
  useEffect(() => { if (open) { setUsername(''); setName(''); setPassword(''); setAll(true); setChosen([]); action.clear(); }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);
  const strong = passwordStrength(password).acceptable;
  return (
    <Sheet open={open} onClose={onClose} kind="form" title={t('web.people.addAccountTitle')}
      primary={{label: t('web.people.addAccount'), loading: action.busy, disabled: username.trim().length < 3 || !name.trim() || !strong || (!all && !chosen.length), onPress: () => void action.run(() => api.request('/v1/direct/members', 'POST', {username: username.trim(), password, name: name.trim(), allowedLibraries: all ? [] : chosen, disabled: false})).then(ok => { if (ok) onAdded(); })}}>
      <View style={{gap: space.md}}>
        {action.error ? <Notice tone="error" message={action.error} /> : null}
        <Field label={t('web.direct.username')} value={username} onChangeText={setUsername} autoCapitalize="none" autoCorrect={false} maxLength={64} />
        <Field label={t('web.people.profileName')} hint={t('web.people.profileNameHelp')} value={name} onChangeText={setName} maxLength={120} />
        <Field label={t('auth.password')} secure value={password} onChangeText={setPassword} error={password && !strong ? t('server.people.passwordWeak') : undefined} />
        <LibraryChoice all={all} chosen={chosen} libraries={libraries} onChange={(a, c) => { setAll(a); setChosen(c); }} />
      </View>
    </Sheet>
  );
}

/** An account's devices, in the one place they are managed: approve, block, and see when each was last here. */
function AccountDevices({accountId}: {accountId: string}) {
  const {api} = useSession();
  const t = useI18n().t;
  const read = usePagedList(async cursor => { const raw = await api.request(accessListPath('devices', cursor) + '&account=' + encodeURIComponent(accountId)); return {items: [...parseAccessDevicePage(raw).items], nextCursor: nextCursorOf(raw)}; }, [api, accountId]);
  const action = useAction();
  const [opIds] = useState(() => createOperationIds(operationId));
  const [menu, setMenu] = useState<AccessDevice>();
  const trust = (d: AccessDevice, next: 'approved' | 'blocked') => void action.run(async () => { await api.request(`/v1/admin/access/devices/${encodeURIComponent(d.id)}/trust`, 'PUT', {expectedRevision: d.revision, operationId: opIds.forPayload(JSON.stringify({id: d.id, revision: d.revision, trust: next})), trust: next}); opIds.release(); read.reload(); });
  const waiting = read.items?.filter(d => d.trust === 'pending').length ?? 0;
  return (
    <>
      {read.error ? <Notice tone="error" message={read.error} action={t('action.tryAgain')} onAction={read.reload} /> : null}
      {action.error ? <Notice tone="error" message={action.error} /> : null}
      <RowGroup title={t('devices.title')} footer={waiting ? t('web.access.devicesWaiting', {count: waiting}) : t('web.access.devicesLede')}>
        {read.items?.map(d => <ListRow key={d.id} icon={televisionPlatforms.has(d.platform) ? 'tvDevice' : d.platform === 'web' ? 'globe' : 'account'} title={d.name} subtitle={t('web.access.deviceMeta', {platform: d.platform, when: since(d.lastSeenAt)})} meta={d.trust === 'approved' ? t('web.access.trustApproved') : d.trust === 'blocked' ? t('web.access.trustBlocked') : t('web.access.trustWaiting')} accessory="menu" onPress={() => setMenu(d)} />)}
        {read.items && !read.items.length ? <ListRow title={t('web.devices.none')} /> : null}
        {read.more ? <ListRow tone="action" title={t('server.showMore')} onPress={read.loadMore} /> : null}
      </RowGroup>
      <Menu open={!!menu} onClose={() => setMenu(undefined)} title={menu?.name}
        items={[...(menu && menu.trust !== 'approved' ? [{id: 'approved', label: t('web.devices.approve'), icon: 'check' as const}] : []), ...(menu && menu.trust !== 'blocked' ? [{id: 'blocked', label: t('web.access.block'), icon: 'close' as const, destructive: true}] : [])]}
        onSelect={id => { if (menu) trust(menu, id as 'approved' | 'blocked'); }} />
    </>
  );
}

/** People › Invitations: who has been invited and has not joined yet. */
export function InvitationsPanel() {
  const {api} = useSession();
  const t = useI18n().t;
  const read = usePagedList(async cursor => { const raw = await api.request(accessListPath('invitations', cursor)); return {items: rows(raw, parseInvitation), nextCursor: nextCursorOf(raw)}; }, [api]);
  const [opIds] = useState(() => createOperationIds(operationId));
  const [inviting, setInviting] = useState(false);
  const [revoking, setRevoking] = useState<Invitation>();
  const pending = read.items?.filter(i => i.state === 'pending') ?? [];
  return (
    <>
      {read.error ? <Notice tone={read.items ? 'warning' : 'error'} message={read.error} action={t('action.tryAgain')} onAction={read.reload} /> : null}
      <RowGroup title={t('web.access.invitations')} footer={t('web.access.invitationsLede')}>
        {pending.map(i => <ListRow key={i.id} icon="mail" title={i.email || t('web.access.invitationUnlabelled')} subtitle={t('web.access.inviteMeta', {role: tierLabels[i.role], date: new Date(i.expiresAt).toLocaleDateString()})} accessory="menu" onPress={() => setRevoking(i)} />)}
        {read.items && !pending.length ? <ListRow title={t('web.access.noInvitations')} /> : null}
        {read.more ? <ListRow tone="action" title={t('server.showMore')} onPress={read.loadMore} /> : null}
        <ListRow tone="action" icon="plus" title={t('web.access.inviteSomeone')} onPress={() => setInviting(true)} />
      </RowGroup>
      <InviteSheet open={inviting} onClose={() => { setInviting(false); read.reload(); }} />
      <ConfirmSheet open={!!revoking} onDismiss={() => setRevoking(undefined)} title={t('server.people.revokeInvitation', {name: revoking?.email || t('web.access.invitationUnlabelled')})} confirmLabel={t('web.access.revoke')} describeError={e => problem(e, 'action')}
        onConfirm={async () => { const i = revoking; if (!i) return; await api.request(`/v1/admin/access/invitations/${encodeURIComponent(i.id)}/revoke`, 'POST', {expectedRevision: i.revision, operationId: opIds.forPayload(JSON.stringify({id: i.id, revision: i.revision}))}); opIds.release(); setRevoking(undefined); read.reload(); }} />
    </>
  );
}

/** People › API keys: access for scripts and integrations. A key is shown once, when it is made. */
export function APIKeysPanel() {
  const {api} = useSession();
  const t = useI18n().t;
  const {space} = useTheme();
  const read = usePagedList(async cursor => { const raw = await api.request(accessListPath('apiKeys', cursor)); return {items: rows(raw, parseAccessAPIKey), nextCursor: nextCursorOf(raw)}; }, [api]);
  const action = useAction();
  const [opIds] = useState(() => createOperationIds(operationId));
  const [open, setOpen] = useState(false);
  const [name, setName] = useState('');
  const [scope, setScope] = useState<KeyScope>('read-only');
  const [issued, setIssued] = useState<AccessAPIKey>();
  const [revoking, setRevoking] = useState<AccessAPIKey>();
  const active = useMemo(() => read.items?.filter(k => !k.revoked) ?? [], [read.items]);
  const create = () => void action.run(async () => { const payload = {name: name.trim(), scope}; setIssued(parseAccessAPIKey(await api.request('/v1/admin/access/api-keys', 'POST', {operationId: opIds.forPayload(JSON.stringify(payload)), ...payload}))); opIds.release(); read.reload(); });
  return (
    <>
      {read.error ? <Notice tone={read.items ? 'warning' : 'error'} message={read.error} action={t('action.tryAgain')} onAction={read.reload} /> : null}
      <RowGroup title={t('web.access.apiKeys')} footer={t('server.access.keyLede')}>
        {active.map(k => <ListRow key={k.id} icon="lock" title={k.name} subtitle={t('web.access.keyMeta', {access: scopeLabels[k.scope], hint: k.hint, when: since(k.lastUsedAt)})} accessory="menu" onPress={() => setRevoking(k)} />)}
        {read.items && !active.length ? <ListRow title={t('web.access.noApiKeys')} /> : null}
        {read.more ? <ListRow tone="action" title={t('server.showMore')} onPress={read.loadMore} /> : null}
        <ListRow tone="action" icon="plus" title={t('web.access.createKey')} onPress={() => { setIssued(undefined); setName(''); action.clear(); setOpen(true); }} />
      </RowGroup>
      <Sheet open={open} onClose={() => setOpen(false)} kind={issued ? 'acknowledge' : 'form'} title={issued ? t('web.access.copyKeyTitle') : t('web.access.createKeyTitle')}
        primary={issued ? {label: t('web.access.copiedIt'), onPress: () => setOpen(false)} : {label: t('web.saved.create'), loading: action.busy, disabled: !name.trim(), onPress: create}}>
        <View style={{gap: space.md}}>
          {issued ? (
            <>
              <Notice tone="warning" message={t('web.access.keyShownOnce')} />
              <RowGroup>
                <ListRow title={t('web.access.apiKey')} subtitle={issued.secret ?? ''} subtitleLines={4} />
                <ListRow tone="action" icon="upload" title={t('server.people.shareKey')} onPress={() => { void Share.share({message: issued.secret ?? ''}).catch(() => {}); }} />
              </RowGroup>
            </>
          ) : (
            <>
              {action.error ? <Notice tone="error" message={action.error} /> : null}
              <Field label={t('profile.name')} hint={t('web.access.keyNameHelp')} value={name} onChangeText={setName} maxLength={80} />
              <RowGroup footer={scopeHelp[scope]}><PickRow title={t('web.access.scopeLabel')} value={scope} options={keyScopes.map(s => ({id: s, label: scopeLabels[s]}))} onChange={v => setScope(v as KeyScope)} /></RowGroup>
            </>
          )}
        </View>
      </Sheet>
      <ConfirmSheet open={!!revoking} onDismiss={() => setRevoking(undefined)} title={t('web.access.revokeTitle', {name: revoking?.name ?? ''})} consequence={t('web.access.revokeBody')} confirmLabel={t('web.access.revoke')} describeError={e => problem(e, 'action')}
        onConfirm={async () => { const k = revoking; if (!k) return; await api.request(`/v1/admin/access/api-keys/${encodeURIComponent(k.id)}/revoke`, 'POST', {expectedRevision: k.revision, operationId: opIds.forPayload(JSON.stringify({id: k.id, revision: k.revision}))}); opIds.release(); setRevoking(undefined); read.reload(); }} />
    </>
  );
}
