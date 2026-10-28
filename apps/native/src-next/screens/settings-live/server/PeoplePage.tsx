import React, {useLayoutEffect, useMemo, useState, useSyncExternalStore} from 'react';
import {FlatList, Text, View} from 'react-native';
import type {SettingsPeopleQuery, SettingsPersonRow} from '../../../../../../packages/client-core/src/settings-people';
import type {ServerInvitation} from '../../../../../../packages/client-core/src/direct-account';
import type {AccessMember, MemberDeletionPreview, MemberLimits} from '../../../../../../packages/client-core/src/server-administration';
import {roleLabel} from '../../../../../../packages/client-core/src/server-admin/people-words';
import {peopleStreamLimits, readSettingsBinding, settingsBinding, settingsBindingPatch, applySettingsBindingPatch} from '../../../../../../packages/client-core/src/presentation/settings-bindings';
import {settingsSpec} from '../../../../../../packages/client-core/src/presentation/settings-spec';
import type {RuntimeSettings} from '../../../../../../packages/client-core/src/console';
import {defaultI18n} from '../../../../../../packages/i18n/src';
import {Button, Focusable, Select, Switch, Tabs, TextField} from '../../../kit/controls';
import {BottomSheet} from '../../../kit/overlays';
import {SettingsRow} from '../../../kit/shell';
import {ServerHeader} from '../../../kit/shell/ServerIdentity';
import {shellType} from '../../../kit/shell/visual';
import {StateView} from '../../../kit/states';
import {useTheme} from '../../../kit/theme';
import type {NativeSettingsLivePorts} from '../ports';
import type {NativeShellRuntime} from '../../../shell/runtime';
import {NativeAdvancedSection} from './AdvancedSection';
import {NativeSettingControl} from './SettingControl';
import {useStorageForms, useStorageSet, useFormState, type StorageForms} from './storage/forms';
import {NativePeopleSource} from './people-source';

type Props = {ports: NativeSettingsLivePorts; runtime: NativeShellRuntime; compactHeader?: boolean};
type Confirmation = Readonly<{person: AccessMember; action: 'disable' | 'enable' | 'role'; role?: 'admin' | 'member'} | {person: AccessMember; action: 'remove'; preview: MemberDeletionPreview} | {invitation: ServerInvitation; action: 'revoke'}>;
const IDS = ['runtime'] as const;

export function NativeServerPeople(props: Props) {
  const [source, setSource] = useState<NativePeopleSource>();
  const {context, requestId} = props.ports, reportError = props.runtime.reportError;
  useLayoutEffect(() => {const next = new NativePeopleSource(context, requestId, reportError); setSource(next); void next.load(); return next.dispose;}, [context, requestId, reportError]);
  return source?.context === context && source.current() ? <People key={context.authority().accountId} {...props} source={source}/> : null;
}

function People({ports, runtime, compactHeader, source}: Props & {source: NativePeopleSource}) {
  const theme = useTheme(), t = runtime.text.t, state = useSyncExternalStore(source.subscribe, source.getSnapshot, source.getSnapshot);
  const [search, setSearch] = useState(''), [cursors, setCursors] = useState<readonly string[]>(['']);
  const [confirmation, setConfirmation] = useState<Confirmation>(), [typedName, setTypedName] = useState('');
  const view = useMemo(() => ({active: true, confirmation: undefined as Confirmation | undefined}), [source]);
  useLayoutEffect(() => {view.active = true; return () => {view.active = false; view.confirmation = undefined;};}, [view]);
  const current = () => view.active && source.current();
  const choose = (patch: Partial<SettingsPeopleQuery>) => {if (!current() || state.busy) return; setCursors(['']); source.select(state.tab, {...state.query, ...patch});};
  const ask = (value: Confirmation) => {if (!current() || source.getSnapshot().busy) return; view.confirmation = value; setConfirmation(value); setTypedName('');};
  const close = () => {if (source.getSnapshot().busy || view.confirmation !== confirmation) return; view.confirmation = undefined; setConfirmation(undefined); setTypedName('');};
  const held = confirmation && view.confirmation === confirmation && current() ? confirmation : undefined;
  const confirm = async () => {
    if (!held || view.confirmation !== held || !current() || source.getSnapshot().busy) return;
    if (held.action === 'remove' && typedName !== held.preview.username) return;
    view.confirmation = undefined; setConfirmation(undefined); setTypedName('');
    if (held.action === 'remove') await source.remove(held.person, held.preview);
    else if (held.action === 'revoke') await source.revoke(held.invitation);
    else if (held.action === 'role' && held.role) await source.role(held.person, held.role);
    else if (held.action === 'enable' || held.action === 'disable') await source.enabled(held.person, held.action === 'enable');
  };
  const loading = state.loading || state.busy;
  const page = state.tab === 'people' ? state.people : state.invitations;
  const rows: readonly (SettingsPersonRow | ServerInvitation)[] = state.tab === 'people' ? state.people?.items ?? [] : state.invitations?.items ?? [];
  const header = <View style={{gap: 14, marginBottom: 12}}>
    <ServerHeader serverName={ports.context.serverName} viewerRole="owner" audience="owner" variant="phone"/>
    {!compactHeader && <Text accessibilityRole="header" style={[shellType(28, 800), {color: theme.colors.text}]}>{t('settings.server.people')}</Text>}
    <Tabs value={state.tab} onValueChange={tab => {if (current() && !loading && (tab === 'people' || tab === 'invitations')) {setCursors(['']); source.select(tab);}}} items={[{value: 'people', label: t('settings.server.people')}, {value: 'invitations', label: t('settings.server.invitations')}]}/>
    <TextField testID="people-search" accessibilityLabel={t('web.shell.search')} value={search} maxLength={160} returnKeyType="search" editable={!state.busy} onChangeText={setSearch} onSubmitEditing={() => choose({search: search.trim()})}/>
    <View style={{flexDirection: 'row', flexWrap: 'wrap', gap: 8}}>
      <Button size="compact" variant="glass" onPress={() => choose({search: search.trim()})} disabled={loading}>{t('web.shell.search')}</Button>
      {state.tab === 'people' ? <>
        <Select accessibilityLabel="Role" value={state.query.role} disabled={loading} options={[{value: 'all', label: 'All roles'}, ...(['owner', 'admin', 'member'] as const).map(role => ({value: role, label: roleLabel(t, role)}))]} onValueChange={role => {if (['all', 'owner', 'admin', 'member'].includes(role)) choose({role: role as SettingsPeopleQuery['role']});}}/>
        <Select accessibilityLabel="Status" value={state.query.status} disabled={loading} options={[{value: 'all', label: 'All statuses'}, {value: 'now', label: 'Playing now'}, {value: 'month', label: 'Active this month'}, {value: 'idle', label: 'Inactive'}, {value: 'off', label: 'Disabled'}]} onValueChange={status => {if (['all', 'now', 'month', 'idle', 'off'].includes(status)) choose({status: status as SettingsPeopleQuery['status']});}}/>
      </> : <Select accessibilityLabel="Invitation status" value={state.invitationStatus} disabled={loading} options={[{value: '', label: 'All invitations'}, {value: 'pending', label: 'Waiting'}, {value: 'accepted', label: 'Accepted'}, {value: 'expired', label: 'Expired'}, {value: 'revoked', label: 'Revoked'}]} onValueChange={status => {if (current() && ['', 'pending', 'accepted', 'expired', 'revoked'].includes(status)) {setCursors(['']); source.select('invitations', state.query, status as typeof state.invitationStatus);}}}/>} 
      <Button variant="text" size="compact" icon="i-refresh" disabled={loading} onPress={() => {if (current()) void source.load(state.cursor);}}>{t('action.refresh')}</Button>
    </View>
    {state.error !== undefined && <StateView variant="inline" {...runtime.error(state.error, () => {if (current()) void source.load(state.cursor);})}/>}
    {page && <Text style={{color: theme.colors.textTertiary}}>{defaultI18n.number(page.matchedCount)} {state.tab === 'people' ? 'people' : 'invitations'}</Text>}
    {loading && <Text style={{color: theme.colors.textTertiary}}>{t('next.settings.loading')}</Text>}
  </View>;
  return <View testID="server-people" style={{flex: 1}}>
    <FlatList data={rows} keyExtractor={row => 'accountId' in row && 'username' in row ? row.accountId : row.id} contentContainerStyle={{paddingHorizontal: 20, paddingBottom: 40}}
      ListHeaderComponent={header} ListEmptyComponent={!loading && page ? <Text style={{color: theme.colors.textSecondary}}>No results.</Text> : null}
      renderItem={({item}) => 'username' in item ? <Focusable testID={`people-person-${item.accountId}`} accessibilityRole="button" accessibilityLabel={item.username} disabled={loading} onPress={() => {if (current()) void source.open(item);}} style={{paddingVertical: 14, borderTopWidth: 1, borderTopColor: theme.colors.lineSoft, gap: 4}}>
        <View style={{flexDirection: 'row', justifyContent: 'space-between', gap: 12}}><Text style={[shellType(16, 700), {color: theme.colors.text}]}>{item.username}</Text><Text style={{color: theme.colors.textSecondary}}>{roleLabel(t, item.role)}</Text></View>
        {item.email && <Text style={{color: theme.colors.textSecondary}}>{item.email}</Text>}
        <Text style={{color: theme.colors.textTertiary}}>{item.profileNames.filter(name => item.profileNames.length > 1 || name !== item.username).join(' · ')}</Text>
        {item.notes && <Text style={{color: theme.colors.textTertiary}}>{item.notes}</Text>}
      </Focusable> : <View style={{paddingVertical: 14, borderTopWidth: 1, borderTopColor: theme.colors.lineSoft, gap: 5}}>
        <Text style={[shellType(15, 700), {color: theme.colors.text}]}>{item.notes || roleLabel(t, item.role)}</Text>
        <Text style={{color: theme.colors.textSecondary}}>{roleLabel(t, item.role)} · {item.state} · {defaultI18n.date(item.expiresAt)}</Text>
        {item.state === 'pending' && <Button size="compact" variant="danger" disabled={loading} onPress={() => ask({action: 'revoke', invitation: item})}>{t('web.access.revoke')}</Button>}
      </View>}
      ListFooterComponent={<View style={{gap: 16, marginTop: 12}}><View style={{flexDirection: 'row', gap: 8}}>
        {cursors.length > 1 && <Button variant="glass" disabled={loading} onPress={() => {if (!current() || loading) return; const next = cursors.slice(0, -1); setCursors(next); void source.load(next[next.length - 1]);}}>{t('action.back')}</Button>}
        {!!page?.nextCursor && <Button variant="glass" disabled={loading} onPress={() => {if (!current() || loading || page !== (source.getSnapshot().tab === 'people' ? source.getSnapshot().people : source.getSnapshot().invitations)) return; setCursors([...cursors, page.nextCursor]); void source.load(page.nextCursor);}}>{t('action.showMore')}</Button>}
      </View><PeopleAdvanced ports={ports} runtime={runtime}/></View>}/>
    <BottomSheet open={!!state.selected} onOpenChange={open => {if (!open && current() && source.getSnapshot().selected === state.selected) source.closePerson();}} title={state.selected?.username} dismissOnBack={!state.busy} dismissOnGesture={!state.busy} dismissOnOutsidePress={!state.busy}>
      {state.opening && <Text style={{color: theme.colors.textSecondary}}>{t('next.settings.loading')}</Text>}
      {state.person && <PersonDetails key={`${state.person.accountId}:${state.person.revision}:${state.person.limitsRevision}`} source={source} person={state.person} runtime={runtime} ask={ask}/>}
      {state.error !== undefined && <StateView variant="inline" {...runtime.error(state.error, () => {if (state.selected && current()) void source.open(state.selected);})}/>}
    </BottomSheet>
    <BottomSheet open={!!held} showClose={false} onOpenChange={open => {if (!open) close();}} title={held?.action === 'revoke' ? t('web.access.revoke') : held ? held.person.username : undefined}
      footer={<View style={{flexDirection: 'row', gap: 8}}><Button variant="glass" onPress={close}>{t('action.cancel')}</Button><Button variant={held?.action === 'role' || held?.action === 'enable' ? 'primary' : 'danger'} disabled={!held || held.action === 'remove' && typedName !== held.preview.username} onPress={() => {void confirm();}}>{t(held?.action === 'remove' ? 'action.delete' : held?.action === 'revoke' ? 'web.access.revoke' : 'action.save')}</Button></View>}>
      {held?.action === 'remove' ? <View style={{gap: 12}}><Text style={{color: theme.colors.textSecondary}}>{held.preview.profiles} profiles, {held.preview.devices} devices and {held.preview.savedResources} saved items will be removed. Media and recordings are kept.</Text><TextField label={held.preview.username} value={typedName} onChangeText={setTypedName} autoCapitalize="none" autoCorrect={false}/></View>
        : <Text style={{color: theme.colors.textSecondary}}>{held?.action === 'role' ? `Change this person’s role to ${roleLabel(t, held.role!)}?` : held?.action === 'disable' ? 'Disable this person’s access to the server?' : held?.action === 'enable' ? 'Enable this person’s access to the server?' : 'This invitation will no longer work.'}</Text>}
    </BottomSheet>
  </View>;
}

function PersonDetails({source, person, runtime, ask}: {source: NativePeopleSource; person: AccessMember; runtime: NativeShellRuntime; ask: (value: Confirmation) => void}) {
  const theme = useTheme(), t = runtime.text.t, state = useSyncExternalStore(source.subscribe, source.getSnapshot, source.getSnapshot);
  const [notes, setNotes] = useState(person.notes ?? ''), [limits, setLimits] = useState<MemberLimits>(person.limits);
  const streamLimit = peopleStreamLimits.read({limits}), streamChoices = ['default', 'unlimited', '1', '2', '3', '4', '6'];
  const managed = person.role !== 'owner' && person.accountId !== source.context.account.account.id;
  const current = () => source.current() && source.getSnapshot().person === person && !source.getSnapshot().busy;
  return <View style={{gap: 12}}>
    {person.email && <Text style={{color: theme.colors.textSecondary}}>{person.email}</Text>}
    {person.profileNames && <Text style={{color: theme.colors.textTertiary}}>{person.profileNames.join(' · ')}</Text>}
    <TextField label="Notes" value={notes} maxLength={500} editable={managed && !state.busy} onChangeText={setNotes}/>
    {managed && <>
      <Button variant="glass" disabled={state.busy || notes === (person.notes ?? '')} onPress={() => {if (current()) void source.notes(person, notes);}}>{t('action.save')}</Button>
      <Select label="Role" value={person.role} disabled={state.busy} options={(['member', 'admin'] as const).map(role => ({value: role, label: roleLabel(t, role)}))} onValueChange={role => {if (current() && role !== person.role && (role === 'admin' || role === 'member')) ask({person, action: 'role', role});}}/>
      <SettingsRow first label="Watch away from home" control={<Switch accessibilityLabel="Watch away from home" checked={limits.allowRemote} disabled={state.busy} onCheckedChange={allowRemote => {if (current()) setLimits({...limits, allowRemote});}}/>}/>
      <Select label="Streams at once" value={streamLimit} disabled={state.busy} options={[...(!streamChoices.includes(streamLimit) ? [{value: streamLimit, label: streamLimit, disabled: true}] : []), ...streamChoices.map(value => ({value, label: value === 'default' ? 'Use server limit' : value === 'unlimited' ? 'No limit' : value}))]} onValueChange={value => {if (current()) setLimits(peopleStreamLimits.patch({limits}, value));}}/>
      <Button variant="glass" disabled={state.busy || limits === person.limits} onPress={() => {if (current()) void source.limits(person, limits);}}>{t('action.save')}</Button>
      <Button variant={person.disabled ? 'glass' : 'danger'} disabled={state.busy} onPress={() => {if (current()) ask({person, action: person.disabled ? 'enable' : 'disable'});}}>{person.disabled ? 'Enable access' : 'Disable access'}</Button>
      <Button variant="danger" disabled={state.busy} onPress={() => {if (!current()) return; void source.previewDeletion(person).then(preview => {if (preview && current()) ask({person, action: 'remove', preview});});}}>{t('action.delete')}</Button>
    </>}
  </View>;
}

function PeopleAdvanced({ports, runtime}: Props) {
  const group = useStorageForms(ports, IDS, runtime.reportError);
  return group ? <BoundPeopleAdvanced key={group.mount} group={group} runtime={runtime}/> : null;
}
function BoundPeopleAdvanced({group, runtime}: {group: StorageForms; runtime: NativeShellRuntime}) {
  const t = runtime.text.t, form = group.forms.runtime, state = useFormState<RuntimeSettings, unknown>(form), save = useStorageSet(group);
  const rows = settingsSpec.find(section => section.scope === 'server' && section.id === 'people')?.advanced?.groups?.flatMap(group => group.rows) ?? [];
  return <NativeAdvancedSection testID="people-advanced" summary={save.dirty ? 'Unsaved changes' : 'Server defaults'}>
    {state.loadError !== undefined && <StateView variant="inline" {...runtime.error(state.loadError, () => {void form.load();})}/>}
    {state.draft && rows.map(row => {
      const binding = settingsBinding(row.id); if (!binding || binding.form !== 'runtime') return null;
      const value = readSettingsBinding(binding, {forms: {runtime: state.draft}}); if (!value) return null;
      // The authored option says "administrator"; this existing binding stores
      // the server's "admin" enum. Project it locally without changing the API.
      const shown = row.id === 'people.inviteRole' && value.current === 'admin' ? 'administrator' : value.current;
      return <NativeSettingControl key={row.id} row={row} value={shown} t={t} disabled={save.saving} onChange={next => {const projected = row.id === 'people.inviteRole' && next === 'administrator' ? 'admin' : next; const patch = settingsBindingPatch(binding, projected); form.set(current => applySettingsBindingPatch(current, patch));}}/>;
    })}
    {save.dirty && <View style={{flexDirection: 'row', gap: 8}}><Button variant="glass" disabled={save.saving} onPress={() => group.set.discard()}>{t('action.discard')}</Button><Button loading={save.saving} disabled={!!save.problem} onPress={() => {void group.set.save();}}>{t('action.save')}</Button></View>}
    {save.saveError !== undefined && <StateView variant="inline" {...runtime.error(save.saveError, () => {void group.set.save();})}/>}
  </NativeAdvancedSection>;
}
