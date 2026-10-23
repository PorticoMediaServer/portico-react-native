import React, {useEffect, useMemo, useRef, useState, useSyncExternalStore} from 'react';
import {ScrollView, Share, Text, View, type TextInput} from 'react-native';
import {defaultI18n} from '../../../../../packages/i18n/src';
import type {MediaItem} from '../../../../../packages/client-core/src';
import {parseMediaItem} from '../../../../../packages/client-core/src/media-item';
import {encodedRoutePath} from '../../../../../packages/contracts/src/routes';
import {groupTargetPositionUs, type GroupHostAuthority} from '../../../../../packages/client-core/src/social-playback';
import {Button, Focusable, TextField} from '../../kit/controls';
import {FocusRegion} from '../../kit/focus';
import {Dialog, Banner, Menu} from '../../kit/overlays';
import {Artwork} from '../../kit/artwork';
import {Icon} from '../../kit/Icon';
import {StateView} from '../../kit/states';
import {shellType} from '../../kit/shell/visual';
import {useTheme} from '../../kit/theme';
import type {NativeShellRuntime} from '../../shell/runtime';
import {tvFocusIds} from '../../shell/tv-focus';
import {NativeTVKeyboard} from '../destinations';
import {Screen, ScreenText, useScreenEntry} from './Screen';
import type {NativeSettingsLivePorts} from './ports';
import type {NativeTogetherController} from './together-controller';

export function NativeTogetherScreen({controller, ports, runtime}: {controller: NativeTogetherController; ports: NativeSettingsLivePorts; runtime: NativeShellRuntime}) {
  const theme = useTheme(), t = defaultI18n.t;
  const state = useSyncExternalStore(controller.subscribe, controller.getSnapshot);
  const ids = useMemo(() => tvFocusIds(controller.lifetime.authority), [controller]);
  const region = ids.surface('together');
  const enter = useScreenEntry(theme.isTV ? {regionId: region, childId: 'start'} : undefined, controller.lifetime.current);
  const group = state.group;
  const [sheet, setSheet] = useState<'start' | 'join'>(), [name, setName] = useState(''), [code, setCode] = useState('');
  const [typing, setTyping] = useState<'name' | 'code' | 'who'>(), [typingRevision, setTypingRevision] = useState(0);
  const firstField = useRef<TextInput>(null);
  const profile = ports.context.account.profiles.find(value => value.id === controller.lifetime.authority.profileId);
  const [who, setWho] = useState(profile?.name ?? ''), [authority, setAuthority] = useState<GroupHostAuthority>('host-only');
  const startRef = useRef<View>(null), joinRef = useRef<View>(null);
  const run = (work: () => Promise<unknown>) => {void work().catch(error => {if (controller.lifetime.current()) runtime.reportError(error);});};
  useEffect(() => {void controller.refresh().catch(error => {if (controller.lifetime.current()) runtime.reportError(error);});}, [controller, runtime]);
  const room = group && !['idle', 'left', 'joining'].includes(state.phase);
  if (room && state.phase === 'ended') return <Screen><StateView testID="together-ended" variant="centered" icon="i-people" title={t('web.together.endedTitle')} body={t(group.endedReason === 'host-ended' ? 'web.together.ended.host' : group.endedReason === 'host-unavailable' ? 'web.together.ended.away' : 'web.together.ended.other')} primaryAction={{id: 'lobby', label: t('web.together.backToLobby'), onPress: () => controller.dismiss()}}/></Screen>;
  if (room) return <TogetherRoom controller={controller} ports={ports} runtime={runtime}/>;
  const busy = state.busy || state.phase === 'joining';
  const fieldsRegion = ids.surface('together.form'), keyboard = ids.surface('together.keyboard');
  const type = (field: 'name' | 'code' | 'who') => {if (theme.isTV && typing !== field) {setTyping(field); setTypingRevision(value => value + 1);}};
  return <Screen title={t('entry.group.together')}>
    <ScrollView contentContainerStyle={{paddingHorizontal: theme.isTV ? 0 : 20, paddingBottom: 64}}>
      {state.error && <Banner message={state.error} tone="warning"/>}
      <FocusRegion id={region} entry="start" orientation="free" edges={{left: ids.rail}} onLayout={enter}>
        <View style={{width: theme.isTV ? 1180 : '100%', backgroundColor: theme.colors.raised, borderRadius: theme.isTV ? 28 : 18, padding: theme.isTV ? 56 : 24, gap: theme.isTV ? 28 : 18}}>
          <Icon name="i-people" size={theme.isTV ? 56 : 32}/>
          <Text style={[shellType(theme.isTV ? 60 : 30, 800, 'normal', -.035), {color: theme.colors.text, maxWidth: theme.isTV ? 950 : undefined}]}>{t('web.together.tagline')}</Text>
          <Text style={[shellType(theme.isTV ? 26 : 15, 400, theme.isTV ? 39 : 23), {color: theme.colors.textSecondary, maxWidth: theme.isTV ? 1060 : undefined}]}>{t('web.together.taglineBody')}</Text>
          <View style={{flexDirection: 'row', flexWrap: 'wrap', gap: theme.isTV ? 18 : 10, marginTop: 8}}>
            <Button ref={startRef} focusId="start" testID="together-start" icon="i-people" onPress={() => {setTyping(undefined); setSheet('start');}}>{t('web.together.startTitle')}</Button>
            <Button ref={joinRef} focusId="join" testID="together-join" variant="glass" icon="i-kbd" onPress={() => {setTyping(undefined); setSheet('join');}}>{t('web.together.joinWithCode')}</Button>
          </View>
        </View>
        {state.directory.length > 0 && <View style={{width: theme.isTV ? 1180 : '100%', marginTop: theme.isTV ? 40 : 28, gap: 12}}>
          <ScreenText secondary>{t('web.together.yourGroups')}</ScreenText>
          {state.directory.map(value => <Focusable key={value.id} focusId={`group:${value.id}`} testID={`together-group-${value.id}`} accessibilityRole="button" accessibilityLabel={value.name} onPress={() => run(() => controller.open(value.id))} focusKind="row" style={{padding: theme.isTV ? 24 : 16, borderRadius: 16, backgroundColor: theme.colors.raised, flexDirection: 'row', alignItems: 'center', gap: 20}}>
            <Icon name="i-people" size={theme.isTV ? 40 : 24}/><View style={{flex: 1, gap: 8}}><ScreenText>{value.name}</ScreenText><SpacedStatus text={t('web.together.groupLine', {count: value.members.filter(member => member.state === 'joined').length, state: t(value.timeline.state === 'playing' ? 'web.together.state.playing' : value.timeline.state === 'paused' ? 'web.downloads.state.paused' : 'web.together.state.lobby')})}/></View>{value.permissions.isHost && <ScreenText secondary>{t('web.together.youHost')}</ScreenText>}<Icon name="i-right" size={24}/>
          </Focusable>)}
        </View>}
      </FocusRegion>
      {state.directoryError && <Banner message={state.directoryError} tone="warning"/>}
    </ScrollView>
    <Dialog testID="together-form" open={sheet !== undefined} onOpenChange={open => {if (!open) {setSheet(undefined); setTyping(undefined);}}} headerContext={t('entry.group.together')} title={t(sheet === 'join' ? 'web.together.joinWithCode' : 'web.together.startTitle')} description={t(sheet === 'join' ? 'web.together.joinHelp' : 'web.together.startHelp')} placement={theme.isTV ? 'side' : undefined} width={theme.isTV ? sheet === 'join' || typing ? 1240 : 760 : undefined} initialFocusRef={firstField} returnFocusRef={sheet === 'join' ? joinRef : startRef} footer={<Button testID="together-submit" loading={busy} disabled={busy || (sheet === 'join' ? code.replace(/[\s-]/g, '').length !== 8 : !name.trim())} onPress={() => run(async () => {const ok = sheet === 'join' ? await controller.join(code, who) : await controller.create(name, who, authority); if (ok && controller.lifetime.current()) {setSheet(undefined); setTyping(undefined);}})}>{t(sheet === 'join' ? 'web.together.join' : 'web.together.start')}</Button>}>
      <View style={{flexDirection: theme.isTV && typing ? 'row' : 'column', gap: theme.isTV && typing ? 48 : 24}}><FocusRegion id={fieldsRegion} entry={sheet === 'join' ? 'code' : 'name'} edges={typing ? {right: keyboard} : undefined} style={{gap: 24, flex: 1}}>
        {sheet === 'join' ? <TextField ref={firstField} focusId="code" testID="together-code" label={t('web.together.hostCode')} value={code} onChangeText={value => setCode(value.toUpperCase())} onFocus={() => type('code')} showSoftInputOnFocus={!theme.isTV} autoCapitalize="characters" maxLength={12}/>
          : <TextField ref={firstField} focusId="name" testID="together-name" label={t('profile.name')} value={name} onChangeText={setName} onFocus={() => type('name')} showSoftInputOnFocus={!theme.isTV} maxLength={80}/>}
        <TextField focusId="who" testID="together-display-name" label={t('web.together.yourName')} description={t('web.together.shownToOthers')} value={who} onChangeText={setWho} onFocus={() => type('who')} showSoftInputOnFocus={!theme.isTV} maxLength={64}/>
        {sheet === 'start' && <View style={{gap: 12}}><ScreenText secondary>{t('web.together.whoControls')}</ScreenText><View style={{flexDirection: 'row', gap: 8}}>{(['host-only', 'anyone'] as const).map(value => <Button key={value} testID={`together-authority-${value}`} variant="glass" accessibilityState={{selected: authority === value}} onPress={() => setAuthority(value)}>{t(value === 'host-only' ? 'web.together.onlyMe' : 'web.together.everyone')}</Button>)}</View></View>}
      </FocusRegion>{theme.isTV && typing && <NativeTVKeyboard id={keyboard} value={typing === 'code' ? code : typing === 'name' ? name : who} onChangeText={value => {if (typing === 'code') setCode(value.toUpperCase().slice(0, 12)); else if (typing === 'name') setName(value.slice(0, 80)); else setWho(value.slice(0, 64));}} activation={{visible: sheet !== undefined, intent: 'enter', revision: typingRevision}} leftRegionId={fieldsRegion} width={500} testID="together-keyboard"/>}</View>
    </Dialog>
  </Screen>;
}

function TogetherRoom({controller, ports, runtime}: {controller: NativeTogetherController; ports: NativeSettingsLivePorts; runtime: NativeShellRuntime}) {
  const theme = useTheme(), t = defaultI18n.t;
  const state = useSyncExternalStore(controller.subscribe, controller.getSnapshot), group = state.group!;
  const playback = useSyncExternalStore(ports.context.playback.subscribe, ports.context.playback.getSnapshot);
  const [items, setItems] = useState<Readonly<Record<string, MediaItem | null>>>({}), [confirm, setConfirm] = useState<'end' | 'leave'>();
  const [memberMenu, setMemberMenu] = useState<string>(), [queueMenu, setQueueMenu] = useState<string>();
  const menuReturn = useRef<View | null>(null), memberRefs = useRef(new Map<string, View>()), queueRefs = useRef(new Map<string, View>());
  const [clock, setClock] = useState(controller.serverNow);
  const cancel = useRef<View>(null), endRef = useRef<View>(null), leaveRef = useRef<View>(null);
  const ids = useMemo(() => tvFocusIds(controller.lifetime.authority), [controller]), region = ids.surface('together.room');
  const canControl = group.permissions.canControl, playing = group.timeline.state === 'playing';
  const enter = useScreenEntry(theme.isTV ? {regionId: region, childId: canControl && group.timeline.itemId ? 'transport' : 'leave'} : undefined, controller.lifetime.current);
  const key = JSON.stringify([...new Set([group.timeline.itemId, ...(state.queue?.entries.filter(value => !value.unavailable).map(value => value.itemId) ?? [])].filter((id): id is string => !!id))]);
  useEffect(() => {
    let active = true;
    for (const id of JSON.parse(key) as string[]) void controller.lifetime.request(signal => ports.context.api.request(encodedRoutePath('get_items_id', {id: encodeURIComponent(id)}), 'GET', undefined, signal).then(parseMediaItem)).then(item => {if (active) setItems(value => ({...value, [id]: item}));}, () => {if (active && controller.lifetime.current()) setItems(value => ({...value, [id]: null}));});
    return () => {active = false;};
  }, [key, controller, ports]);
  useEffect(() => {void controller.refreshQueue().catch(error => {if (controller.lifetime.current()) runtime.reportError(error);});}, [controller, runtime, group.queueRevision]);
  useEffect(() => {const timer = setInterval(() => setClock(controller.serverNow()), 1000); return () => clearInterval(timer);}, [controller]);
  const run = (work: () => Promise<unknown>) => {controller.lifetime.assert(); void work().catch(error => {if (controller.lifetime.current()) runtime.reportError(error);});};
  const now = group.timeline.itemId ? items[group.timeline.itemId] : undefined;
  const title = !group.timeline.itemId ? t(group.timeline.currentEntryId ? 'web.together.hiddenTitle' : 'web.together.nothingChosen') : now === null ? t('web.together.hiddenTitle') : now?.title ?? t('web.together.loadingTitle');
  const art = now?.backdropUrl ? runtime.artwork(now.backdropUrl) : undefined;
  const members = group.members.filter(value => value.state === 'joined');
  const hostDeadline = group.timeline.state === 'playing' ? group.host.pauseAt : group.host.endAt;
  const hostCountdown = hostDeadline ? defaultI18n.clock(Math.max(0, Math.ceil((Date.parse(hostDeadline) - clock) / 1000))) : undefined;
  return <Screen title={t('entry.group.together')}>
    <Text style={[shellType(theme.isTV ? 60 : 32, 800), {color: theme.colors.text, marginBottom: 32, marginHorizontal: theme.isTV ? 0 : 20}]}>{group.name}</Text>
    <ScrollView contentContainerStyle={{paddingHorizontal: theme.isTV ? 0 : 20, paddingBottom: 64}}>
      {state.error && <Banner message={state.error} tone="warning"/>}
      {state.phase === 'reconnecting' && <Banner message={t('web.together.reconnecting')} tone="warning"/>}
      {group.host.presence !== 'connected' && <Banner message={[t('web.together.hostDropped'), hostCountdown ? t(group.timeline.state === 'playing' ? 'web.together.pausesIn' : 'web.together.endsIn', {time: hostCountdown}) : undefined].filter(Boolean).join(' ')} tone="warning"/>}
      {state.refused && group.permissions.isHost && canControl && <Banner message={t('web.together.refused')} tone="warning" action={{label: t('web.together.goAhead'), onPress: () => run(() => controller.transport(state.refused!.command, {...state.refused!.input, allowUnavailable: true}))}}/>}
      <FocusRegion id={region} entry={canControl && group.timeline.itemId ? 'transport' : 'leave'} edges={{left: ids.rail}} onLayout={enter}>
        <View style={{flexDirection: theme.isTV || theme.width >= 700 ? 'row' : 'column', gap: theme.isTV ? 96 : 24}}>
          <View style={{flex: 1, gap: 22}}>
            <View style={{borderRadius: 22, overflow: 'hidden', minHeight: theme.isTV ? 300 : 180, justifyContent: 'flex-end', padding: 30, backgroundColor: theme.colors.raised}}>
              {art && <View style={{position: 'absolute', inset: 0, opacity: .35}}><Artwork source={art}/></View>}
              <ScreenText secondary>{t(group.host.presence !== 'connected' ? 'web.together.state.hostReconnecting' : playing ? 'web.together.state.playing' : 'web.downloads.state.paused')}</ScreenText><Text style={[shellType(theme.isTV ? 40 : 25, 800), {color: theme.colors.text, marginVertical: 12}]}>{title}</Text>
              {now?.duration && <ScreenText secondary>{t('web.together.positionOf', {position: defaultI18n.clock(Number(groupTargetPositionUs(group.timeline, Date.parse(group.timeline.anchorAt), clock) / 1000000n)), duration: defaultI18n.clock(now.duration)})}</ScreenText>}
              <SpacedStatus text={group.readiness.aggregate === 'ready' ? t('web.together.allReady') : t('web.together.waiting', {ready: group.readiness.ready, total: group.readiness.memberCount, count: group.readiness.buffering + group.readiness.lagging + group.readiness.stale})}/>
            </View>
            <View style={{flexDirection: 'row', gap: 18}}>{canControl && group.timeline.currentEntryId && <Button focusId="transport" testID="together-transport" icon={playing ? 'i-pause' : 'i-play'} disabled={state.busy} onPress={() => run(() => controller.transport(playing ? 'pause' : 'play'))}>{t(playing ? 'web.together.pauseAll' : 'web.together.playAll')}</Button>}
              {playback.fence && playback.playback.itemId === group.timeline.itemId && <Button testID="together-open-player" variant="glass" icon="i-tv" onPress={() => {controller.lifetime.assert(); const current = ports.context.playback.getSnapshot(); if (current.fence && current.playback.itemId === group.timeline.itemId) ports.context.playback.open(current.fence);}}>{t('web.together.openPlayer')}</Button>}
            </View>
            {!canControl && <ScreenText secondary>{t('web.together.pill.hostControls')}</ScreenText>}
            <ScreenText secondary>{t('player.queue')}</ScreenText>
            {!state.queue?.entries.length && <ScreenText secondary>{t(group.permissions.canManageQueue ? 'web.together.emptyQueueHost' : 'web.together.emptyQueue')}</ScreenText>}
            {(state.queue?.entries ?? []).map(value => <Focusable key={value.entryId} ref={node => {if (node) queueRefs.current.set(value.entryId, node); else queueRefs.current.delete(value.entryId);}} testID={`together-queue-${value.entryId}`} accessibilityRole={group.permissions.canManageQueue || canControl ? 'button' : 'text'} accessibilityLabel={value.unavailable || !value.itemId || items[value.itemId] === null ? t('web.together.notAvailable') : items[value.itemId]?.title ?? t('web.together.loadingTitle')} onPress={group.permissions.canManageQueue || canControl ? () => {menuReturn.current = queueRefs.current.get(value.entryId) ?? null; setQueueMenu(value.entryId);} : undefined} focusKind="row" style={{backgroundColor: theme.colors.raised, borderRadius: 12, padding: 18}}><ScreenText>{value.unavailable || !value.itemId || items[value.itemId] === null ? t('web.together.notAvailable') : items[value.itemId]?.title ?? t('web.together.loadingTitle')}</ScreenText></Focusable>)}
            <View style={{flexDirection: 'row', gap: 18, marginTop: 36}}><Button ref={leaveRef} focusId="leave" testID="together-leave" variant="glass" onPress={() => group.permissions.isHost && members.length > 1 ? setConfirm('leave') : run(() => controller.leave())}>{t('web.together.leave')}</Button>{group.permissions.isHost && <Button ref={endRef} testID="together-end" variant="glass" onPress={() => setConfirm('end')}>{t('web.together.endAll')}</Button>}</View>
          </View>
          <View style={{width: theme.isTV ? 680 : theme.width >= 700 ? 340 : '100%', gap: 18}}><ScreenText secondary>{t('web.together.people', {count: members.length})}</ScreenText>
            <View style={{backgroundColor: theme.colors.raised, borderRadius: 20, overflow: 'hidden'}}>{members.map(member => <Focusable key={member.id} ref={node => {if (node) memberRefs.current.set(member.id, node); else memberRefs.current.delete(member.id);}} testID={`together-member-${member.id}`} accessibilityRole={group.permissions.isHost && member.role !== 'host' && member.presence === 'connected' && member.readiness === 'ready' ? 'button' : 'text'} accessibilityLabel={member.private ? t('together.privateViewer') : member.displayName} onPress={group.permissions.isHost && member.role !== 'host' && member.presence === 'connected' && member.readiness === 'ready' ? () => {menuReturn.current = memberRefs.current.get(member.id) ?? null; setMemberMenu(member.id);} : undefined} focusKind="row" style={{flexDirection: 'row', padding: 20, gap: 16, alignItems: 'center'}}><Icon name="i-user" size={32}/><View style={{flex: 1}}><ScreenText>{member.private ? t('together.privateViewer') : member.id === group.viewerMemberId ? t('web.together.you', {name: member.displayName}) : member.displayName}</ScreenText>{member.role === 'host' && <ScreenText secondary>{t('web.together.pill.host')}</ScreenText>}</View><ScreenText secondary>{t(member.presence !== 'connected' ? 'web.together.away' : member.readiness === 'ready' ? 'web.together.inStep' : member.readiness === 'buffering' ? 'web.together.loading' : 'web.together.catchingUp')}</ScreenText></Focusable>)}</View>
            {group.permissions.isHost && <><ScreenText secondary>{t('web.together.invite')}</ScreenText><View style={{backgroundColor: theme.colors.raised, padding: 30, borderRadius: 20, gap: 18}}>
              {state.invite && Date.parse(state.invite.expiresAt) > clock && state.invite.uses < state.invite.maxUses && <><Text style={[shellType(theme.isTV ? 70 : 34, 800), {color: theme.colors.text, letterSpacing: 8}]}>{state.invite.code.slice(0, 4)} {state.invite.code.slice(4)}</Text><ScreenText secondary>{t('web.together.inviteHelpJoin', {uses: state.invite.maxUses - state.invite.uses, time: defaultI18n.time(state.invite.expiresAt)})}</ScreenText></>}
              {!theme.isTV && state.invite && Date.parse(state.invite.expiresAt) > clock && state.invite.uses < state.invite.maxUses && <Button variant="glass" testID="together-share-code" onPress={() => {controller.lifetime.assert(); void Share.share({message: state.invite!.code}).catch(runtime.reportError);}}>{t('web.together.shareCode')}</Button>}
              <Button variant="glass" testID="together-new-code" disabled={state.busy} onPress={() => run(() => controller.invite())}>{t(state.invite ? 'web.together.newCode' : 'web.together.getCode')}</Button>
            </View></>}
          </View>
        </View>
      </FocusRegion>
    </ScrollView>
    <Menu testID="together-member-menu" open={memberMenu !== undefined} onOpenChange={open => {if (!open) setMemberMenu(undefined);}} title={members.find(member => member.id === memberMenu)?.private ? t('together.privateViewer') : members.find(member => member.id === memberMenu)?.displayName} presentation={theme.isTV ? 'sideSheet' : 'sheet'} returnFocusRef={menuReturn} items={memberMenu && group.permissions.isHost && members.some(member => member.id === memberMenu && member.role !== 'host' && member.presence === 'connected' && member.readiness === 'ready') ? [{id: 'host', label: t('web.together.makeHost'), disabled: state.busy, onSelect: () => run(() => controller.makeHost(memberMenu))}] : []}/>
    <Menu testID="together-queue-menu" open={queueMenu !== undefined} onOpenChange={open => {if (!open) setQueueMenu(undefined);}} title={queueMenu ? items[state.queue?.entries.find(value => value.entryId === queueMenu)?.itemId ?? '']?.title ?? t('web.together.notAvailable') : undefined} presentation={theme.isTV ? 'sideSheet' : 'sheet'} returnFocusRef={menuReturn} items={queueMenu ? [
      ...(canControl && state.queue?.entries.some(value => value.entryId === queueMenu && !value.unavailable && !!value.itemId) ? [{id: 'watch', label: t('web.together.watchThis'), disabled: state.busy, onSelect: () => run(() => controller.transport('load', {entryId: queueMenu}))}] : []),
      ...(group.permissions.canManageQueue ? [{id: 'remove', label: t('web.together.removeFromQueue'), disabled: state.busy, onSelect: () => run(() => controller.queueRemove(queueMenu))}] : []),
    ] : []}/>
    <Dialog open={confirm !== undefined} onOpenChange={open => {if (!open) setConfirm(undefined);}} title={t(confirm === 'end' ? 'confirm.endGroup.title' : 'confirm.leaveAsHost.title')} description={t(confirm === 'end' ? 'confirm.endGroup.body' : 'confirm.leaveAsHost.body')} initialFocusRef={cancel} returnFocusRef={confirm === 'end' ? endRef : leaveRef} testID="together-confirm" footer={<View style={{flexDirection: 'row', gap: 16}}><Button ref={cancel} variant="glass" onPress={() => setConfirm(undefined)}>{t('action.cancel')}</Button><Button variant="glass" textStyle={{color: theme.colors.record}} disabled={state.busy} onPress={() => run(async () => {const ended = confirm === 'end' ? await controller.end() : (await controller.leave(), true); if (ended && controller.lifetime.current()) setConfirm(undefined);})}>{t(confirm === 'end' ? 'confirm.endGroup.action' : 'confirm.leaveAsHost.action')}</Button></View>}><View/></Dialog>
  </Screen>;
}

/** The approved frames separate these catalogue facts with space, never a middle dot. */
function SpacedStatus({text}: {text: string}) {
  return <View style={{flexDirection: 'row', flexWrap: 'wrap', columnGap: 16}}>{text.split(' · ').map((part, index) => <ScreenText secondary key={index}>{part}</ScreenText>)}</View>;
}
