import React, {useEffect, useState} from 'react';
import {View} from 'react-native';
import {parseRatingSystems, type RatingSystem} from '../../../../../packages/client-core/src/identity-restrictions';
import {deleteMember, parseAccessDevicePage, parseAccessMember, parseInvitation, parseLimitsDocument, previewMemberDeletion, type AccessDevice, type AccessMember, type AccessTier, type Invitation, type MemberDeletionPreview, type MemberLimits} from '../../../../../packages/client-core/src/server-administration';
import {passwordStrength} from '../../../../../packages/client-core/src/password-strength';
import {accessListPath, clockText, memberOffLine, tierLabels, type DirectMember} from '../../../../../packages/client-core/src/server-admin/panel-logic';
import {VIEWING_HOURS_MAX, dayChoiceOf, daysOfChoice, newViewingHours, trustApplies, type DayChoice} from '../../../../../packages/client-core/src/server-admin/people-words';
import {createOperationIds} from '../../../../../packages/client-core/src/server-admin/server-forms';
import {useSession} from '../../app/session';
import {useI18n} from '../../app/i18n';
import {useLibrariesContext} from '../../app/libraries-context';
import {findInPages, nextCursorOf, operationId, problem, saveRebased, sendFresh, useAction, usePagedList, useRead} from '../../app/server-console';
import {ConfirmSheet, Field, ListRow, Menu, Notice, RowGroup, Sheet, ToggleRow, useTheme} from '../../ui';
import {InviteSheet} from '../InviteSheet';
import {PickRow, TypedRow} from '../settings/ServerForms';
import {ratingChoices, typedClock} from './owner-rules';

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
  const i18n = useI18n();
  const t = i18n.t;
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
  // The account, and its role record, as the server has them now: read again before a change is sent again.
  const readMember = async (id: string) => (await api.request<{items: DirectMember[]}>('/v1/direct/members')).items.find(m => m.id === id);
  const readAccess = (id: string) => findInPages(async cursor => { const raw = await api.request(accessListPath('members', cursor)); return {items: rows(raw, parseAccessMember), nextCursor: nextCursorOf(raw)}; }, a => a.accountId === id);
  return (
    <>
      {read.error ? <Notice tone="error" message={read.error} action={t('action.tryAgain')} onAction={read.reload} /> : null}
      <RowGroup title={t('web.people.accountsTitle')} footer={t('web.people.accountsLede')}>
        {members.map(m => {
          const limits = access.items?.find(a => a.accountId === m.id)?.limits;
          const facts = [m.hostedAccountId ? t('server.people.porticoAccount') : '', m.role === 'owner' || !m.allowedLibraries.length ? t('server.people.allLibraries') : m.allowedLibraries.map(libName).join(', '), limits?.maxStreams ? t('server.people.streams', {count: limits.maxStreams}) : '', limits?.maxContentRating ? t('server.people.upTo', {rating: limits.maxContentRating}) : ''];
          // An account that is off says since when, and whether the owner turned it off or the person left.
          const off = memberOffLine(m, t, iso => i18n.date(iso));
          return <ListRow key={m.id} icon="account" title={m.username} subtitle={[facts.filter(Boolean).join(' · '), off].filter(Boolean).join('\n')} subtitleLines={off ? 3 : undefined} meta={m.disabled ? t('web.people.disabledBadge') : tierLabels[m.role]} accessory="navigation" onPress={() => setOpen(m.id)} />;
        })}
        {access.more ? <ListRow tone="action" title={t('server.showMore')} onPress={access.loadMore} /> : null}
        <ListRow tone="action" icon="plus" title={t('web.people.addAccount')} onPress={() => setAdding(true)} />
      </RowGroup>
      <AccountSheet member={selected} access={access.items?.find(a => a.accountId === selected?.id)} libraries={libraries.items} onClose={() => setOpen(undefined)} onChanged={changed} readMember={readMember} readAccess={readAccess} />
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

/** The rating systems this server publishes (the one scale accounts and profiles share); empty until read, and when the read fails. */
function useRatingSystems(wanted: boolean): readonly RatingSystem[] {
  const {api} = useSession();
  const [systems, setSystems] = useState<readonly RatingSystem[]>([]);
  useEffect(() => {
    if (!wanted) return;
    let live = true;
    api.request<{items?: unknown}>('/v1/rating-systems').then(raw => { if (live) setSystems(parseRatingSystems(raw?.items)); }, () => {});
    return () => { live = false; };
  }, [api, wanted]);
  return systems;
}

/** One account: who it is, what it may do, when it may watch, and the devices signed in with it. */
function AccountSheet({member, access, libraries, onClose, onChanged, readMember, readAccess}: {member?: DirectMember; access?: AccessMember; libraries: readonly {id: string; name: string}[]; onClose: () => void; onChanged: () => void; readMember: (id: string) => Promise<DirectMember | undefined>; readAccess: (id: string) => Promise<AccessMember | undefined>}) {
  const {api} = useSession();
  const t = useI18n().t;
  const {space} = useTheme();
  const action = useAction();
  const [opIds] = useState(() => createOperationIds(operationId));
  const owner = member?.role === 'owner';
  const id = member?.id;
  const readLimits = async (account: string) => parseLimitsDocument(await api.request(`/v1/admin/access/members/${encodeURIComponent(account)}/limits`), account);
  const doc = useRead(async () => (id && !owner ? readLimits(id) : undefined), [api, id, owner]);
  const [limits, setLimits] = useState<MemberLimits>();
  // What the draft is compared with, and the revision it is saved against: a newer document is taken under the owner's own edits, never over them.
  const [base, setBase] = useState<{limits: MemberLimits; revision: number}>();
  const [role, setRole] = useState<AccessTier>('member');
  const [all, setAll] = useState(true);
  const [chosen, setChosen] = useState<string[]>([]);
  const [disabled, setDisabled] = useState(false);
  const [password, setPassword] = useState('');
  const [deleting, setDeleting] = useState(false);
  useEffect(() => { setLimits(doc.data?.limits); setBase(doc.data ? {limits: doc.data.limits, revision: doc.data.revision} : undefined); }, [doc.data]);
  useEffect(() => {
    if (!member) return;
    setRole(access?.role ?? member.role); setAll(!member.allowedLibraries.length); setChosen(member.allowedLibraries); setDisabled(member.disabled); setPassword(''); setDeleting(false); action.clear();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [member?.id, member?.revision, access?.revision]);
  const memberDirty = !!member && (disabled !== member.disabled || !!password || JSON.stringify(all ? [] : chosen) !== JSON.stringify(member.allowedLibraries));
  const limitsDirty = !!base && !!limits && JSON.stringify(limits) !== JSON.stringify(base.limits);
  const roleDirty = !!access && role !== access.role;
  const weak = !!password && !passwordStrength(password).acceptable;
  // Each part is saved against what the server has now: when the account moved underneath (a limit
  // set elsewhere, a scan, the owner's other device), it is read again and sent again without a
  // word, unless what was changed here was changed there too.
  const save = () => void action.run(async () => {
    if (!member) return;
    if (roleDirty && access) await sendFresh(access,
      a => api.request(`/v1/admin/access/members/${encodeURIComponent(member.id)}/role`, 'PUT', {expectedRevision: a.revision, operationId: opIds.forPayload(JSON.stringify({id: member.id, revision: a.revision, role})), role}),
      () => readAccess(member.id), now => (now.role === role ? 'done' : now.role !== 'owner'));
    opIds.release();
    if (limitsDirty && base && limits) await saveRebased({
      base: base.limits, revision: base.revision, draft: limits,
      put: (revision, value) => api.request(`/v1/admin/access/members/${encodeURIComponent(member.id)}/limits`, 'PUT', {expectedRevision: revision, operationId: opIds.forPayload(JSON.stringify({id: member.id, revision, limits: value})), limits: value}),
      reread: async () => { const fresh = await readLimits(member.id); return {revision: fresh.revision, value: fresh.limits}; },
      onRebased: (fresh, merged, revision) => { setBase({limits: fresh, revision}); setLimits(merged); },
    });
    opIds.release();
    if (memberDirty) await sendFresh(member,
      m => api.request(`/v1/direct/members/${encodeURIComponent(member.id)}`, 'PATCH', {username: member.username, password, name: member.username, allowedLibraries: all ? [] : chosen, disabled, expectedRevision: m.revision}),
      () => readMember(member.id), (now, was) => now.disabled === was.disabled && JSON.stringify([...now.allowedLibraries].sort()) === JSON.stringify([...was.allowedLibraries].sort()));
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
          {limits && !owner ? <LimitsRows limits={limits} onChange={setLimits} /> : null}
          {limits && !owner ? <ViewingHours limits={limits} onChange={setLimits} /> : null}
          <AccountDevices accountId={member.id} />
          {/* The last thing in the sheet, and never offered for the owner: the confirmation reads what goes before it asks. */}
          {!owner ? <RowGroup footer={t('server.people.deleteHelp')}><ListRow tone="destructive" icon="trash" title={t('server.people.delete')} onPress={() => setDeleting(true)} /></RowGroup> : null}
          <DeleteMemberSheet member={deleting ? member : undefined} onClose={() => setDeleting(false)} onDeleted={() => { setDeleting(false); onChanged(); onClose(); }} />
        </View>
      ) : null}
    </Sheet>
  );
}

/** A person's limits as rows: streams, quality away from home, and what they may see. Zero or empty means no limit. */
function LimitsRows({limits, onChange}: {limits: MemberLimits; onChange: (next: MemberLimits) => void}) {
  const t = useI18n().t;
  // The same scale a profile's limits use: a rating system, then a rating in it.
  const systems = useRatingSystems(true);
  const choices = ratingChoices(limits, systems);
  return (
    <RowGroup title={t('web.access.limits')} footer={t('web.access.zeroNoLimit')}>
      <TypedRow numeric title={t('web.access.maxStreams')} value={String(limits.maxStreams)} shown={limits.maxStreams ? String(limits.maxStreams) : t('limits.noLimit')} onDone={text => onChange({...limits, maxStreams: Math.min(1000, Math.max(0, Number(text) || 0))})} />
      <TypedRow numeric title={t('web.access.remoteQuality')} help={t('web.access.remoteQualityHelp')} value={String(Math.round(limits.remoteBitrateKbps / 1000))} shown={limits.remoteBitrateKbps ? `${Math.round(limits.remoteBitrateKbps / 1000)} ${t('settings.unit.mbps')}` : t('limits.noLimit')} onDone={text => onChange({...limits, remoteBitrateKbps: Math.min(200, Math.max(0, Number(text) || 0)) * 1000})} />
      {systems.length ? <PickRow title={t('limits.ratingSystem')} value={limits.ratingSystem} options={[...(limits.ratingSystem ? [] : [{id: '', label: t('server.people.ratingSystemChoose')}]), ...systems.map(s => ({id: s.id, label: t('web.limits.systemOption', {name: s.name, region: s.region})}))]} onChange={ratingSystem => { if (ratingSystem !== limits.ratingSystem) onChange({...limits, ratingSystem, maxContentRating: ''}); }} /> : null}
      {choices.open || limits.maxContentRating
        ? <PickRow title={t('web.access.highestRating')} value={limits.maxContentRating} options={[{id: '', label: t('limits.noLimit')}, ...choices.ratings.map(r => ({id: r.code, label: r.minimumAge === undefined ? r.label : t('web.limits.ratingOption', {label: r.label, age: r.minimumAge})}))]} onChange={maxContentRating => onChange({...limits, maxContentRating})} />
        : <ListRow title={t('web.access.highestRating')} subtitle={t('server.people.ratingSystemFirst')} />}
      <ToggleRow title={t('limits.allowUnrated')} value={limits.allowUnrated} onChange={allowUnrated => onChange({...limits, allowUnrated})} />
      <TypedRow title={t('web.limits.hiddenLabels')} help={t('web.access.hiddenLabelsHelp')} value={limits.tagPolicy.deniedLabels.join(', ')} onDone={text => onChange({...limits, tagPolicy: {deniedLabels: text.split(',').map(x => x.trim()).filter(Boolean)}})} />
    </RowGroup>
  );
}

/**
 * An account's viewing hours: when this person can sign in and watch. Each set of hours is a
 * group: which days, from when, until when (an end at or before the start runs into the next
 * day). With none, any time. Saved with the rest of the account by the sheet's Save.
 */
function ViewingHours({limits, onChange}: {limits: MemberLimits; onChange: (next: MemberLimits) => void}) {
  const i18n = useI18n();
  const t = i18n.t;
  const windows = limits.schedule.windows;
  const set = (next: MemberLimits['schedule']['windows']) => onChange({...limits, schedule: {...limits.schedule, windows: next}});
  const change = (index: number, patch: Partial<MemberLimits['schedule']['windows'][number]>) => set(windows.map((w, i) => (i === index ? {...w, ...patch} : w)));
  // 4 January 1970 was a Sunday: day 0 of the server's week.
  const dayName = (day: number) => i18n.formatDate(new Date(Date.UTC(1970, 0, 4 + day, 12)), {weekday: 'long', timeZone: 'UTC'});
  const clock = (minute: number) => i18n.formatDate(new Date(Date.UTC(1970, 0, 4, Math.floor(minute / 60), minute % 60)), {hour: 'numeric', minute: '2-digit', timeZone: 'UTC'});
  const dayOptions = (current: readonly number[]) => [
    ...(['all', 'weekdays', 'weekends'] as const).map(id => ({id, label: t(`server.people.days.${id}`)})),
    ...[1, 2, 3, 4, 5, 6, 0].map(day => ({id: String(day), label: dayName(day)})),
    ...(dayChoiceOf(current) === 'several' ? [{id: 'several', label: `${t('server.people.days.several')}: ${i18n.list([1, 2, 3, 4, 5, 6, 0].filter(d => current.includes(d)).map(dayName))}`}] : []),
  ];
  const zone = limits.schedule.timezone ? t('server.people.hoursZone', {zone: limits.schedule.timezone}) : t('server.people.hoursServerZone');
  return (
    <>
      {windows.map((w, i) => (
        <RowGroup key={i} title={i === 0 ? t('server.people.hours') : undefined}>
          <PickRow title={t('server.people.hoursDays')} value={dayChoiceOf(w.days)} options={dayOptions(w.days)} onChange={choice => change(i, {days: daysOfChoice(choice as DayChoice, w.days)})} />
          <TypedRow title={t('server.people.hoursFrom')} value={clockText(w.startMinute)} shown={clock(w.startMinute)} placeholder="08:00" onDone={text => { const minute = typedClock(text); if (minute !== undefined) change(i, {startMinute: minute}); }} />
          <TypedRow title={t('server.people.hoursUntil')} value={clockText(w.endMinute)} shown={w.endMinute <= w.startMinute ? `${clock(w.endMinute)} · ${t('server.people.hoursNextDay')}` : clock(w.endMinute)} placeholder="20:00" onDone={text => { const minute = typedClock(text); if (minute !== undefined) change(i, {endMinute: minute}); }} />
          <ListRow tone="destructive" title={t('server.people.hoursRemove')} onPress={() => set(windows.filter((_, n) => n !== i))} />
        </RowGroup>
      ))}
      <RowGroup title={windows.length ? undefined : t('server.people.hours')} footer={windows.length ? `${t('server.people.hoursLede')} ${zone}` : t('server.people.hoursLede')}>
        {!windows.length ? <ListRow title={t('server.people.hoursNone')} /> : null}
        {windows.length < VIEWING_HOURS_MAX ? <ListRow tone="action" icon="plus" title={t('server.people.hoursAdd')} onPress={() => set([...windows, newViewingHours()])} /> : null}
      </RowGroup>
    </>
  );
}

/**
 * Delete a person: the server's own preview is the confirmation. It says what goes (the account,
 * its profiles and what they saved, its sign-ins) and what stays (the libraries, recordings, and
 * the plays in the owner's history, without the name). If the account changed while the sheet
 * was open the server refuses, and the preview is read again before asking again.
 */
function DeleteMemberSheet({member, onClose, onDeleted}: {member?: DirectMember; onClose: () => void; onDeleted: () => void}) {
  const {api} = useSession();
  const t = useI18n().t;
  const [preview, setPreview] = useState<MemberDeletionPreview>();
  const [error, setError] = useState('');
  const id = member?.id;
  const read = () => { if (!id) return; setError(''); previewMemberDeletion(api, id).then(setPreview, e => setError(problem(e))); };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => { setPreview(undefined); read(); }, [api, id]);
  const changed = (e: unknown) => (e as {code?: string} | null)?.code === 'revision_mismatch';
  return (
    <ConfirmSheet open={!!member} onDismiss={onClose} title={t('server.people.deleteTitle', {name: member?.username ?? ''})} confirmLabel={t('server.people.deleteConfirm')} ready={!!preview}
      consequence={preview ? [t('server.people.deleteBody', {name: preview.username || member?.username || '', profiles: preview.profiles, devices: preview.devices}), preview.playsKept ? t('server.people.deleteHistoryKept', {count: preview.playsKept}) : '', preview.porticoAccount ? t('server.people.deletePorticoAccount') : ''].filter(Boolean).join('\n\n') : undefined}
      describeError={e => (changed(e) ? t('server.people.deleteChanged') : problem(e, 'action'))}
      onConfirm={async () => {
        if (!preview) return;
        try { await deleteMember(api, preview); } catch (e) { if (changed(e)) { setPreview(undefined); read(); } throw e; }
        onDeleted();
      }}>
      {error ? <Notice tone="error" message={error} action={t('action.tryAgain')} onAction={read} /> : null}
    </ConfirmSheet>
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
  const page = async (cursor: string) => { const raw = await api.request(accessListPath('devices', cursor) + '&account=' + encodeURIComponent(accountId)); return {items: [...parseAccessDevicePage(raw).items], nextCursor: nextCursorOf(raw)}; };
  const read = usePagedList(page, [api, accountId]);
  const action = useAction();
  const [opIds] = useState(() => createOperationIds(operationId));
  const [menu, setMenu] = useState<AccessDevice>();
  // A device that signed in again since the list was read has moved on: it is read again and the choice is sent again, unless it already is what was chosen.
  const trust = (d: AccessDevice, next: 'approved' | 'blocked') => void action.run(async () => {
    await sendFresh(d, x => api.request(`/v1/admin/access/devices/${encodeURIComponent(x.id)}/trust`, 'PUT', {expectedRevision: x.revision, operationId: opIds.forPayload(JSON.stringify({id: x.id, revision: x.revision, trust: next})), trust: next}), () => findInPages(page, x => x.id === d.id), now => trustApplies(now, next));
    opIds.release(); read.reload();
  });
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
  const page = async (cursor: string) => { const raw = await api.request(accessListPath('invitations', cursor)); return {items: rows(raw, parseInvitation), nextCursor: nextCursorOf(raw)}; };
  const read = usePagedList(page, [api]);
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
        onConfirm={async () => {
          const invitation = revoking;
          if (!invitation) return;
          // Used or already revoked in the meantime: there is nothing left to revoke.
          await sendFresh(invitation, i => api.request(`/v1/admin/access/invitations/${encodeURIComponent(i.id)}/revoke`, 'POST', {expectedRevision: i.revision, operationId: opIds.forPayload(JSON.stringify({id: i.id, revision: i.revision}))}), () => findInPages(page, i => i.id === invitation.id), now => (now.state === 'pending' ? true : 'done'));
          opIds.release(); setRevoking(undefined); read.reload();
        }} />
    </>
  );
}
