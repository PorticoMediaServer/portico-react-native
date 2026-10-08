import React, {useEffect, useMemo, useState} from 'react';
import {Share, View} from 'react-native';
import {useNavigation, useRoute, type RouteProp} from '@react-navigation/native';
import type {ContentStackParams} from '../app/routes';
import {groupTargetPositionUs, type Group, type GroupHostAuthority, type GroupMember, type GroupQueueEntry, type MediaItem} from '../../../../packages/client-core/src/index';
import {useSession} from '../app/session';
import {useTogether} from '../app/together';
import {Badge, Button, ConfirmSheet, Divider, Field, ListRow, Menu, Notice, Page, PageHeader, Section, Segmented, Sheet, StateView, Surface, Text, useTheme, type MenuItem} from '../ui';
import {useI18n, type MessageId} from '../app/i18n';

const authorities: readonly {id: GroupHostAuthority; label: MessageId}[] = [{id: 'host-only', label: 'web.together.onlyMe'}, {id: 'anyone', label: 'web.together.everyone'}] as const;
const stateLabel: Partial<Record<Group['state'], string>> = {lobby: 'Waiting to start', preparing: 'Getting ready', ready: 'Ready', playing: 'Playing', paused: 'Paused', 'host-reconnecting-playing': 'Host reconnecting', 'host-reconnecting-paused': 'Host reconnecting', degraded: 'Playing', ending: 'Ending', ended: 'Ended', failed: 'Ended'};
const endedReason: Record<string, string> = {'host-ended': 'The host ended the group.', 'host-unavailable': 'The host was away too long, so the group ended.', empty: 'Everyone left.'};
const clock = (seconds: number) => { const s = Math.max(0, Math.floor(seconds)); const h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60); return `${h ? h + ':' + String(m).padStart(2, '0') : m}:${String(s % 60).padStart(2, '0')}`; };

/** Titles for the ids a group carries. A group never sends titles, because what each member
 * may see differs; every member names entries from their own library. */
function useTitles(ids: readonly string[]) {
  const {api} = useSession();
  const [items, setItems] = useState<Record<string, MediaItem | null>>({});
  const key = [...new Set(ids)].sort().join(',');
  useEffect(() => {
    let live = true;
    for (const id of key ? key.split(',') : []) {
      if (id in items || !api) continue;
      api.item(id).then(item => { if (live) setItems(prev => ({...prev, [id]: item})); }, () => { if (live) setItems(prev => ({...prev, [id]: null})); });
    }
    return () => { live = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [api, key]);
  return items;
}

export function TogetherScreen() {
  const navigation = useNavigation();
  const i18n = useI18n();
  const route = useRoute<RouteProp<ContentStackParams, 'Together'>>();
  const {service, state} = useTogether();
  const {space} = useTheme();
  useEffect(() => { void service?.refreshDirectory(); }, [service]);
  if (!service) return null;
  const inRoom = !!state.group && state.phase !== 'idle' && state.phase !== 'left' && state.phase !== 'joining';
  return (
    <Page>
      <PageHeader title={i18n.t('entry.group.together')} eyebrow={inRoom ? state.group!.name : i18n.t('web.together.eyebrowFallback')} onBack={() => navigation.goBack()} />
      {state.error ? <View style={{paddingHorizontal: space.page, paddingBottom: space.md}}><Notice tone="warning" message={state.error} action={state.refused && state.group?.permissions.isHost ? i18n.t('web.together.goAhead') : undefined} onAction={state.refused ? () => void service.transport(state.refused!.command, {...state.refused!.input, allowUnavailable: true}) : undefined} /></View> : null}
      {inRoom ? <Room /> : <Lobby initialCode={route.params?.code} />}
    </Page>
  );
}

function Lobby({initialCode}: {initialCode?: string}) {
  const i18n = useI18n();
  const {service, state} = useTogether();
  const session = useSession();
  const {space} = useTheme();
  const profileId = session.session?.viewer.profileId;
  const [directName, setDirectName] = useState('');
  // APL-TOGETHER-01: a direct sign-in's profile name comes from the server.
  useEffect(() => {
    if (session.hosted || !session.api || session.session?.viewer.authority !== 'local') return;
    let live = true;
    // The account snapshot (`GET /v1/direct`) carries the profiles; there is no GET on /profiles.
    session.api.request<{profiles?: {id: string; name: string}[]}>('/v1/direct').then(r => { const n = r?.profiles?.find(p => p.id === profileId)?.name; if (live && n) setDirectName(n); }, () => {});
    return () => { live = false; };
  }, [session.hosted, session.api, session.session?.viewer.authority, profileId]);
  const mine = session.hosted?.profiles.find(p => p.id === profileId)?.name ?? directName;
  const [name, setName] = useState('');
  const [who, setWho] = useState(mine);
  const [authority, setAuthority] = useState<GroupHostAuthority>('host-only');
  // A link from an invite fills the code in; joining is still the viewer's choice.
  const [code, setCode] = useState(initialCode?.toUpperCase() ?? '');
  const [sheet, setSheet] = useState<'join' | 'start' | undefined>(initialCode ? 'join' : undefined);
  useEffect(() => { if (initialCode) { setCode(initialCode.toUpperCase()); setSheet('join'); } }, [initialCode]);
  useEffect(() => { if (mine && !who) setWho(mine); }, [mine, who]);
  if (!service) return null;
  const busy = state.phase === 'joining' || state.busy;
  const join = () => { if (code.replace(/[\s-]/g, '').length >= 4) void service.join(code, who); };
  return (
    <>
      {/* APL-TOGETHER-01: one clear invitation to start or join, each in its own focused sheet. */}
      <Section>
        <Surface>
          <View style={{gap: space.md}}>
            <Text variant="heading">{i18n.t('web.together.tagline')}</Text>
            <Text variant="body" tone="secondary">{i18n.t('web.together.taglineBody')}</Text>
            <View style={{flexDirection: 'row', flexWrap: 'wrap', gap: space.sm}}>
              <Button variant="primary" size="lg" icon="people" label={i18n.t('web.together.startTitle')} hasTVPreferredFocus={!initialCode} onPress={() => setSheet('start')} />
              <Button variant="secondary" size="lg" icon="keypad" label={i18n.t('web.together.joinWithCode')} hasTVPreferredFocus={!!initialCode} onPress={() => setSheet('join')} />
            </View>
          </View>
        </Surface>
      </Section>
      <Sheet open={sheet === 'join'} onClose={() => setSheet(undefined)} title={i18n.t('web.together.joinWithCode')} primary={{label: i18n.t('web.together.join'), loading: busy, disabled: busy || code.replace(/[\s-]/g, '').length < 4, onPress: join}}>
        <View style={{gap: space.md, paddingHorizontal: space.sm}}>
          <Field label={i18n.t('web.together.hostCode')} value={code} autoCapitalize="characters" autoCorrect={false} maxLength={12} placeholder={i18n.t('web.together.codeExample')} onChangeText={t => setCode(t.toUpperCase())} returnKeyType="join" autoFocus={!initialCode} onSubmitEditing={join} />
          <Field label={i18n.t('web.together.yourName')} value={who} maxLength={64} placeholder="Alex" onChangeText={setWho} /> {/* lint-strings-allow: an example name, not copy */}
        </View>
      </Sheet>
      <Sheet open={sheet === 'start'} onClose={() => setSheet(undefined)} title={i18n.t('web.together.startTitle')} primary={{label: i18n.t('web.together.start'), loading: busy, disabled: busy, onPress: () => void service.create({name: name.trim() || 'Watch Together', displayName: who, hostAuthority: authority})}}>
        <View style={{gap: space.md, paddingHorizontal: space.sm}}>
          <Field label={i18n.t('profile.name')} value={name} maxLength={80} placeholder="Movie night" onChangeText={setName} /> {/* lint-strings-allow: an example name, not copy */}
          <Field label={i18n.t('web.together.yourName')} value={who} maxLength={64} placeholder="Alex" onChangeText={setWho} /> {/* lint-strings-allow: an example name, not copy */}
          <View style={{gap: space.xs}}>
            <Text variant="label" tone="tertiary">{i18n.t('web.together.whoControls')}</Text>
            <Segmented items={authorities.map(a => ({id: a.id, label: i18n.t(a.label)}))} selected={authority} onSelect={id => setAuthority(id as GroupHostAuthority)} />
          </View>
        </View>
      </Sheet>
      {state.directory.length ? (
        <Section title={i18n.t('web.together.yourGroups')}>
          <Surface padded={false}>
            {state.directory.map((g, i) => (
              <View key={g.id}>
                {i ? <Divider inset={space.md} /> : null}
                <ListRow icon="people" title={g.name} subtitle={i18n.t('web.together.groupLine', {count: g.members.filter(m => m.state === 'joined').length, state: stateLabel[g.state] ?? g.state})} meta={g.permissions.isHost ? i18n.t('web.together.youHost') : undefined} trailingIcon="forward" onPress={() => void service.open(g.id)} />
              </View>
            ))}
          </Surface>
        </Section>
      ) : null}
      {state.directoryError && !state.directory.length ? <Section><Notice tone="info" message={state.directoryError} /></Section> : null}
    </>
  );
}

function readinessLine(group: Group): string {
  const r = group.readiness;
  if (r.aggregate === 'ready') return r.memberCount > 1 ? 'Everyone is ready.' : 'Ready.';
  const waiting = r.buffering + r.lagging + r.stale;
  return `${r.ready} of ${r.memberCount} ready · waiting for ${waiting === 1 ? 'one person' : waiting + ' people'}`;
}
const memberStatus = (m: GroupMember) => (m.presence !== 'connected' ? 'Away' : m.readiness === 'ready' ? 'In step' : m.readiness === 'buffering' ? 'Buffering' : 'Catching up');

function Room() {
  const i18n = useI18n();
  const {service, state} = useTogether();
  const {space} = useTheme();
  const group = state.group!;
  const [member, setMember] = useState<GroupMember>();
  const [entry, setEntry] = useState<GroupQueueEntry>();
  const [confirm, setConfirm] = useState<'end' | 'leave'>();
  useEffect(() => { void service?.refreshQueue(); }, [service, group.queueRevision]);
  const queue = state.queue;
  const ids = useMemo(() => [group.timeline.itemId, ...(queue?.entries.map(e => e.itemId ?? '') ?? [])].filter(Boolean), [group.timeline.itemId, queue]);
  const titles = useTitles(ids);
  if (!service) return null;
  if (state.phase === 'ended') return <StateView icon="people" title={i18n.t('web.together.endedTitle')} message={endedReason[group.endedReason] ?? i18n.t('web.together.ended.other')} action={i18n.t('web.together.backToLobby')} onAction={() => service.dismiss()} />;
  const can = group.permissions;
  const playing = group.timeline.state === 'playing';
  const now = group.timeline.itemId ? titles[group.timeline.itemId] : undefined;
  // PERF-S10: only the clock and the host countdown change every second; they tick on their own
  // (`Ticking`) instead of re-rendering the whole room.
  const position = () => (group.timeline.itemId ? Number(groupTargetPositionUs(group.timeline, Date.parse(group.timeline.anchorAt), service.serverNow()) / 1000000n) : 0);
  const away = group.host.presence !== 'connected';
  const deadline = () => (group.host.pauseAt && Date.parse(group.host.pauseAt) > service.serverNow() ? {label: 'pauses', at: group.host.pauseAt} : group.host.endAt ? {label: 'ends', at: group.host.endAt} : undefined);
  const members = group.members.filter(m => m.state === 'joined');
  const me = members.find(m => m.id === group.viewerMemberId);
  const blocked = queue?.eligibility?.members.filter(m => m.blockedEntryIds.length) ?? [];
  const invite = state.invite && Date.parse(state.invite.expiresAt) > Date.now() ? state.invite : undefined;
  const entryItems: MenuItem[] = entry ? [
    ...(entry.entryId !== group.timeline.currentEntryId && !entry.unavailable ? [{id: 'load', label: i18n.t('web.together.watchThis'), icon: 'play' as const}] : []),
    {id: 'remove', label: i18n.t('player.queueRemove'), icon: 'trash' as const, destructive: true},
  ] : [];
  return (
    <>
      <View style={{paddingHorizontal: space.page, gap: space.md}}>
        {state.phase === 'reconnecting' ? <Notice tone="info" message={i18n.t('web.together.reconnectingApple')} /> : null}
        {away ? <Ticking>{() => { const d = deadline(); const when = d ? clock((Date.parse(d.at) - service.serverNow()) / 1000) : ''; return <Notice tone="warning" message={d ? `${i18n.t('web.together.hostDropped')} ${i18n.t(d.label === 'pauses' ? 'web.together.pausesIn' : 'web.together.endsIn', {time: when})}` : i18n.t('web.together.hostDropped')} action={me && !can.isHost ? i18n.t('web.together.becomeHost') : undefined} onAction={me && !can.isHost ? () => void service.makeHost(me.id) : undefined} />; }}</Ticking> : null}
        <Surface>
          <View style={{gap: space.sm}}>
            <View style={{flexDirection: 'row', alignItems: 'center', gap: space.sm}}>
              <Badge label={stateLabel[group.state] ?? group.state} tone={playing ? 'accent' : 'neutral'} />
              {group.timeline.itemId ? <Ticking>{() => <Text variant="caption" tone="tertiary">{clock(position())}{now?.duration ? ` of ${clock(now.duration)}` : ''}</Text>}</Ticking> : null}
            </View>
            <Text variant="heading" numberOfLines={2}>{group.timeline.itemId ? (now === null ? i18n.t('web.together.hiddenTitle') : now?.title ?? i18n.t('web.together.loadingTitle')) : i18n.t('web.together.nothingChosen')}</Text>
            <Text variant="caption" tone="tertiary">{group.timeline.itemId ? readinessLine(group) : can.canManageQueue ? i18n.t('web.together.pickHelpHold') : i18n.t('web.together.hostPicks')}</Text>
            {can.canControl && group.timeline.itemId ? <Button variant="primary" icon={playing ? 'pause' : 'play'} label={playing ? i18n.t('web.together.pauseAll') : group.readiness.aggregate === 'ready' ? i18n.t('web.together.playAll') : i18n.t('web.together.playAnyway')} disabled={state.busy} hasTVPreferredFocus onPress={() => void service.transport(playing ? 'pause' : 'play')} style={{marginTop: space.sm}} /> : null}
          </View>
        </Surface>
      </View>
      <Section title={members.length === 1 ? i18n.t('web.together.justYou') : i18n.t('web.together.people', {count: members.length})}>
        <Surface padded={false}>
          {members.map((m, i) => (
            <View key={m.id}>
              {i ? <Divider inset={space.md} /> : null}
              <ListRow hasTVPreferredFocus={i === 0 && !(can.canControl && group.timeline.itemId)} icon="profile" title={m.id === group.viewerMemberId ? i18n.t('web.together.you', {name: m.displayName}) : m.displayName} subtitle={m.role === 'host' ? i18n.t('web.together.hostStatus', {status: memberStatus(m)}) : memberStatus(m)} trailingIcon={can.isHost && m.role !== 'host' ? 'more' : undefined} onPress={can.isHost && m.role !== 'host' ? () => setMember(m) : undefined} />
            </View>
          ))}
        </Surface>
      </Section>
      {can.isHost ? (
        <Section title={i18n.t('web.together.invite')}>
          <Surface>
            {invite ? (
              <View style={{gap: space.sm}}>
                <Text variant="display" style={{letterSpacing: 6}}>{invite.code.slice(0, 4)} {invite.code.slice(4)}</Text>
                <Text variant="caption" tone="tertiary">{i18n.t('web.together.inviteHelpJoin', {uses: invite.maxUses, time: new Date(invite.expiresAt).toLocaleTimeString([], {hour: 'numeric', minute: '2-digit'})})}</Text>
                <View style={{flexDirection: 'row', gap: space.sm}}>
                  <Button variant="secondary" label={i18n.t('web.together.shareCode')} onPress={() => void Share.share({message: i18n.t('web.together.shareMessage', {code: invite.code})}).catch(() => {})} />
                  <Button variant="ghost" label={i18n.t('web.together.newCode')} disabled={state.busy} onPress={() => void service.invite()} />
                </View>
              </View>
            ) : (
              <View style={{gap: space.sm}}>
                <Text variant="caption" tone="tertiary">{i18n.t('web.together.codeHelp')}</Text>
                <Button variant="secondary" label={i18n.t('web.together.getCode')} loading={state.busy} onPress={() => void service.invite()} />
              </View>
            )}
          </Surface>
        </Section>
      ) : null}
      <Section title={i18n.t('player.queue')}>
        <View style={{gap: space.md}}>
          {blocked.length ? <Notice tone="warning" message={i18n.t('web.together.blockedSome', {names: blocked.map(b => b.displayName).join(', ')})} /> : null}
          {queue?.entries.length ? (
            <Surface padded={false}>
              {queue.entries.map((e, i) => {
                const item = e.itemId ? titles[e.itemId] : null;
                return (
                  <View key={e.entryId}>
                    {i ? <Divider inset={space.md} /> : null}
                    <ListRow ordinal={e.position + 1} title={e.unavailable || item === null ? i18n.t('web.together.notAvailable') : item?.title ?? i18n.t('web.together.loadingTitle')} subtitle={e.entryId === group.timeline.currentEntryId ? i18n.t('web.live.onNow') : e.unavailable ? i18n.t('web.together.hiddenEntry') : undefined} selected={e.entryId === group.timeline.currentEntryId} trailingIcon={can.canManageQueue ? 'more' : undefined} onPress={can.canManageQueue ? () => setEntry(e) : undefined} style={{opacity: e.unavailable ? 0.6 : 1}} />
                  </View>
                );
              })}
            </Surface>
          ) : <Text variant="caption" tone="tertiary">{i18n.t('web.together.emptyQueue')}{can.canManageQueue ? ` ${i18n.t('web.together.emptyQueueHold')}` : ''}</Text>}
        </View>
      </Section>
      <Section>
        <View style={{flexDirection: 'row', flexWrap: 'wrap', gap: space.sm}}>
          <Button variant="ghost" label={i18n.t('web.together.leave')} onPress={() => (can.isHost && members.length > 1 ? setConfirm('leave') : void service.leave())} />
          {can.isHost ? <Button variant="ghost" label={i18n.t('web.together.endAll')} onPress={() => setConfirm('end')} /> : null}
        </View>
      </Section>
      <Menu open={!!member} onClose={() => setMember(undefined)} title={member?.displayName} items={[{id: 'host', label: i18n.t('web.together.makeHost'), icon: 'profile'}]} onSelect={() => { if (member) void service.makeHost(member.id); }} />
      <Menu open={!!entry} onClose={() => setEntry(undefined)} title={entry?.itemId ? titles[entry.itemId]?.title : undefined} items={entryItems} onSelect={id => { if (!entry) return; if (id === 'load') void service.transport('load', {entryId: entry.entryId}); else void service.queueRemove(entry.entryId); }} />
      {/* CON-06: a tier-1 confirmation with a red verb. */}
      <ConfirmSheet open={!!confirm} onDismiss={() => setConfirm(undefined)} title={confirm === 'end' ? i18n.t('confirm.endGroup.title') : i18n.t('confirm.leaveAsHost.title')} consequence={confirm === 'end' ? i18n.t('confirm.endGroup.body') : i18n.t('confirm.leaveAsHost.body')} confirmLabel={confirm === 'end' ? i18n.t('confirm.endGroup.action') : i18n.t('confirm.leaveAsHost.action')} onConfirm={async () => { await (confirm === 'end' ? service.end() : service.leave()); }} />
    </>
  );
}

/** Re-renders only what it wraps, once a second (a clock, a countdown). */
function Ticking({children}: {children: () => React.ReactNode}) {
  const [, tick] = useState(0);
  useEffect(() => { const id = setInterval(() => tick(n => n + 1), 1000); return () => clearInterval(id); }, []);
  return <>{children()}</>;
}
