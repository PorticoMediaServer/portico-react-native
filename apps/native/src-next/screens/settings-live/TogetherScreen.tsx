import React, {forwardRef, useEffect, useMemo, useRef, useState, useSyncExternalStore} from 'react';
import {ScrollView, Share, Text, View, type TextInput} from 'react-native';
import {defaultI18n} from '../../../../../packages/i18n/src';
import type {MediaItem} from '../../../../../packages/client-core/src';
import {parseMediaItem} from '../../../../../packages/client-core/src/media-item';
import {encodedRoutePath} from '../../../../../packages/contracts/src/routes';
import {groupTargetPositionUs, type GroupHostAuthority} from '../../../../../packages/client-core/src/social-playback';
import {Button, Focusable, Segmented, TextField} from '../../kit/controls';
import {FocusRegion} from '../../kit/focus';
import {Dialog, Banner, Menu} from '../../kit/overlays';
import {AmbientArt, Artwork, ProfileFace} from '../../kit/artwork';
import {Icon} from '../../kit/Icon';
import {StateView} from '../../kit/states';
import {alpha, shellType} from '../../kit/shell/visual';
import {useTheme} from '../../kit/theme';
import type {NativeShellRuntime} from '../../shell/runtime';
import {tvFocusIds} from '../../shell/tv-focus';
import {NativeTVKeyboard} from '../destinations';
import {Screen, ScreenText, useScreenEntry} from './Screen';
import type {NativeSettingsLivePorts} from './ports';
import type {NativeTogetherController} from './together-controller';
import {nativeTogetherLobbyFaces} from './together-presentation';
import {NativeTogetherTVRoom} from './TogetherTVRoom';
import type {NativeTogetherMedia} from './together-media';

export function NativeTogetherScreen({controller, media, ports, runtime}: {controller: NativeTogetherController; media: NativeTogetherMedia; ports: Pick<NativeSettingsLivePorts, 'context'>; runtime: NativeShellRuntime}) {
  const theme = useTheme(), t = runtime.text.t;
  const state = useSyncExternalStore(controller.subscribe, controller.getSnapshot);
  const ids = useMemo(() => tvFocusIds(controller.lifetime.authority), [controller]);
  const region = ids.surface('together');
  const group = state.group;
  const [sheet, setSheet] = useState<'start' | 'join'>(), [name, setName] = useState(''), [code, setCode] = useState('');
  const [typing, setTyping] = useState<'name' | 'code' | 'who'>(), [typingRevision, setTypingRevision] = useState(0), [typingIntent, setTypingIntent] = useState<'enter' | 'restore'>('enter');
  const firstField = useRef<TextInput>(null);
  const firstTVField = useRef<View>(null);
  const profile = ports.context.account.profiles.find(value => value.id === controller.lifetime.authority.profileId);
  const faces = nativeTogetherLobbyFaces(state.directory[0], runtime.getSnapshot().profile);
  const [who, setWho] = useState(profile?.name ?? ''), [authority, setAuthority] = useState<GroupHostAuthority>('host-only');
  const startRef = useRef<View>(null), joinRef = useRef<View>(null);
  const run = (work: () => Promise<unknown>) => {void work().catch(error => {if (controller.lifetime.current()) runtime.reportError(error);});};
  useEffect(() => {void controller.refresh().catch(error => {if (controller.lifetime.current()) runtime.reportError(error);});}, [controller, runtime]);
  const room = group && !['idle', 'left', 'joining'].includes(state.phase);
  if (room && state.phase === 'ended') return <TogetherEndedScreen controller={controller} reason={group.endedReason} text={runtime.text}/>;
  if (room) return theme.isTV ? <NativeTogetherTVRoom controller={controller} media={media} state={state} group={group} ports={ports} runtime={runtime}/> : <TogetherRoom controller={controller} ports={ports} runtime={runtime}/>;
  const busy = state.busy || state.phase === 'joining';
  const fieldsRegion = ids.surface('together.form'), keyboard = ids.surface('together.keyboard');
  const type = (field: 'name' | 'code' | 'who') => {if (theme.isTV) {setTypingIntent(typing === field ? 'restore' : 'enter'); setTyping(field); setTypingRevision(value => value + 1);}};
  return <Screen title={t('entry.group.together')}>
    <ScrollView contentContainerStyle={{paddingHorizontal: theme.isTV ? 0 : 20, paddingBottom: 64}}>
      {state.error && <Banner message={state.error} tone="warning"/>}
      <TogetherLobbyRegion controller={controller} region={region} rail={ids.rail}>
        <View style={{width: theme.isTV ? 1180 : '100%', backgroundColor: theme.colors.raised, borderRadius: theme.isTV ? 28 : 18, paddingHorizontal: theme.isTV ? 56 : 24, paddingTop: theme.isTV ? 48 : 24, paddingBottom: theme.isTV ? 52 : 24, gap: theme.isTV ? 0 : 18, overflow: 'hidden'}}>
          <TogetherLobbyArt itemId={state.directory[0]?.timeline.itemId} controller={controller} ports={ports} runtime={runtime}/>
          <View pointerEvents="none" style={{position: 'absolute', inset: 0, borderRadius: theme.isTV ? 28 : 18, borderWidth: 1.5, borderColor: alpha(theme.colors.text, .08)}}/>
          <View testID="together-lobby-faces" style={{flexDirection: 'row', height: theme.isTV ? 56 : 32}}>{faces.map((face, index) => <View key={face.id} accessibilityLabel={face.private ? t('together.privateViewer') : undefined} style={{marginLeft: index ? theme.isTV ? -14 : -8 : 0, borderRadius: theme.isTV ? 28 : 16}}>
            <View pointerEvents="none" style={{position: 'absolute', inset: -3, borderRadius: theme.isTV ? 31 : 19, borderWidth: 3, borderColor: theme.colors.raised}}/>{face.private ? <View style={{width: theme.isTV ? 56 : 32, height: theme.isTV ? 56 : 32, borderRadius: theme.isTV ? 28 : 16, alignItems: 'center', justifyContent: 'center', backgroundColor: theme.colors.raisedHigh}}><Icon name="i-user" size={theme.isTV ? 28 : 18} color={theme.colors.textSecondary}/></View> : <ProfileFace initial={face.initial} color={face.color} source={face.source} size={theme.isTV ? 56 : 32} scaleOnFocus={false}/>}
          </View>)}</View>
          <Text style={[shellType(theme.isTV ? 62 : 30, 800, theme.isTV ? 64.48 : 'normal', theme.isTV ? -.04 : -.035), {color: theme.colors.text, maxWidth: theme.isTV ? 920 : undefined, marginTop: theme.isTV ? 26 : 0, marginBottom: theme.isTV ? 14 : 0}]}>{t('web.together.tagline')}</Text>
          <Text style={[shellType(theme.isTV ? 26 : 15, 400, theme.isTV ? 39 : 23), {color: theme.colors.textSecondary, maxWidth: theme.isTV ? 820 : undefined, marginBottom: theme.isTV ? 38 : 0}]}>{t('web.together.taglineBody')}</Text>
          <View style={{flexDirection: 'row', flexWrap: 'wrap', gap: theme.isTV ? 18 : 10, marginTop: theme.isTV ? 0 : 8}}>
            <Button ref={startRef} focusId="start" testID="together-start" icon="i-people" onPress={() => {if (!name.trim()) setName(t('web.together.defaultName', {name: runtime.getSnapshot().profile.name})); setTyping(undefined); setSheet('start');}}>{t('web.together.startTitle')}</Button>
            <Button ref={joinRef} focusId="join" testID="together-join" variant="glass" icon="i-kbd" onPress={() => {setTyping(undefined); if (theme.isTV) type('code'); setSheet('join');}}>{t('web.together.joinWithCode')}</Button>
          </View>
        </View>
        {state.directory.length > 0 && <View style={{width: theme.isTV ? 1180 : '100%', marginTop: theme.isTV ? 38 : 28, gap: theme.isTV ? 16 : 12}}>
          <Text style={[shellType(theme.isTV ? 20 : 15, 700), {color: theme.colors.textTertiary}]}>{t('web.together.yourGroups')}</Text>
          {state.directory.map(value => <Focusable key={value.id} focusId={`group:${value.id}`} testID={`together-group-${value.id}`} accessibilityRole="button" accessibilityLabel={value.name} onPress={() => run(() => controller.open(value.id))} focusKind="row" style={{minHeight: theme.isTV ? 104 : undefined, paddingHorizontal: theme.isTV ? 28 : 16, paddingVertical: theme.isTV ? 0 : 16, borderRadius: theme.isTV ? 18 : 16, backgroundColor: theme.colors.raised, borderWidth: 1, borderColor: alpha(theme.colors.line, .7), flexDirection: 'row', alignItems: 'center', gap: theme.isTV ? 22 : 20}}>
            <View style={{width: theme.isTV ? 56 : 32, height: theme.isTV ? 56 : 32, borderRadius: theme.isTV ? 14 : 8, backgroundColor: alpha(theme.colors.text, .08), alignItems: 'center', justifyContent: 'center'}}><Icon name="i-people" size={theme.isTV ? 32 : 24} color={theme.colors.textSecondary}/></View><View style={{flex: 1, gap: theme.isTV ? 3 : 8}}><Text style={[shellType(theme.isTV ? 28 : 15, 700), {color: theme.colors.text}]}>{value.name}</Text><SpacedStatus size={theme.isTV ? 22 : undefined} tertiary text={t('web.together.groupLine', {count: value.members.filter(member => member.state === 'joined').length, state: t(value.timeline.state === 'playing' ? 'web.together.state.playing' : value.timeline.state === 'paused' ? 'web.downloads.state.paused' : 'web.together.state.lobby')})}/></View>{value.permissions.isHost && <Text style={[shellType(theme.isTV ? 22 : 15, 600), {color: theme.colors.textSecondary}]}>{t('web.together.youHost')}</Text>}<Icon name="i-right" size={theme.isTV ? 28 : 24} color={theme.colors.textSecondary}/>
          </Focusable>)}
        </View>}
      </TogetherLobbyRegion>
      {state.directoryError && <Banner message={state.directoryError} tone="warning"/>}
    </ScrollView>
    <Dialog testID="together-form" open={sheet !== undefined} onOpenChange={open => {if (!open) {setSheet(undefined); setTyping(undefined);}}} headerContext={<ScreenText secondary>{t('entry.group.together')}</ScreenText>} title={t(sheet === 'join' ? 'web.together.joinWithCode' : 'web.together.startTitle')} description={t(sheet === 'join' ? 'web.together.joinHelp' : 'web.together.startHelp')} placement={theme.isTV ? 'side' : undefined} width={theme.isTV ? sheet === 'join' || typing ? 1240 : 760 : undefined} initialFocusRef={theme.isTV ? typing ? undefined : firstTVField : firstField} returnFocusRef={sheet === 'join' ? joinRef : startRef} footer={<Button testID="together-submit" onFocus={() => {if (sheet === 'start') setTyping(undefined);}} loading={busy} disabled={busy || (sheet === 'join' ? code.replace(/[\s-]/g, '').length !== 8 : !name.trim())} onPress={() => run(async () => {const ok = sheet === 'join' ? await controller.join(code, who) : await controller.create(name, who, authority); if (ok && controller.lifetime.current()) {setSheet(undefined); setTyping(undefined);}})}>{t(sheet === 'join' ? 'web.together.join' : 'web.together.start')}</Button>}>
      {state.error && <Banner message={state.error} tone="warning"/>}
      <View style={{flexDirection: theme.isTV && typing ? 'row' : 'column', gap: theme.isTV && typing ? 48 : 24}}>
        <FocusRegion id={fieldsRegion} entry={sheet === 'join' ? 'code' : 'name'} edges={typing ? {right: keyboard} : undefined} style={{gap: 24, flex: 1}}>
        {theme.isTV ? <>
          <TogetherTVField ref={firstTVField} focusId={sheet === 'join' ? 'code' : 'name'} testID={sheet === 'join' ? 'together-code' : 'together-name'} label={t(sheet === 'join' ? 'web.together.hostCode' : 'profile.name')} value={sheet === 'join' ? code : name} onPress={() => type(sheet === 'join' ? 'code' : 'name')}/>
          <TogetherTVField focusId="who" testID="together-display-name" label={t('web.together.yourName')} description={t('web.together.shownToOthers')} value={who} onPress={() => type('who')}/>
        </> : <>
          {sheet === 'join' ? <TextField ref={firstField} focusId="code" testID="together-code" label={t('web.together.hostCode')} value={code} onChangeText={value => setCode(value.toUpperCase())} autoCapitalize="characters" maxLength={12}/>
            : <TextField ref={firstField} focusId="name" testID="together-name" label={t('profile.name')} value={name} onChangeText={setName} maxLength={80}/>}
          <TextField focusId="who" testID="together-display-name" label={t('web.together.yourName')} description={t('web.together.shownToOthers')} value={who} onChangeText={setWho} maxLength={64}/>
        </>}
        {sheet === 'start' && <View style={{gap: theme.isTV ? 8 : 12}}><Text style={[shellType(theme.isTV ? 20 : 15, 700), {color: theme.colors.textTertiary}]}>{t('web.together.whoControls')}</Text><Segmented testID="together-authority" accessibilityLabel={t('web.together.whoControls')} value={authority} onValueChange={value => setAuthority(value as GroupHostAuthority)} items={(['host-only', 'anyone'] as const).map(value => ({value, label: t(value === 'host-only' ? 'web.together.onlyMe' : 'web.together.everyone')}))} itemProps={item => ({testID: `together-authority-${item.value}`, onFocus: () => setTyping(undefined)})}/></View>}
        </FocusRegion>{theme.isTV && typing && <NativeTVKeyboard id={keyboard} value={typing === 'code' ? code : typing === 'name' ? name : who} onChangeText={value => {if (typing === 'code') setCode(value.toUpperCase().slice(0, 12)); else if (typing === 'name') setName(value.slice(0, 80)); else setWho(value.slice(0, 64));}} activation={{visible: sheet !== undefined, intent: typingIntent, revision: typingRevision}} leftRegionId={fieldsRegion} width={500} testID="together-keyboard"/>}
      </View>
    </Dialog>
  </Screen>;
}

/** This region remounts on return from a room/ended screen. Its entry request must
 * follow that real native host's layout rather than reuse the old lobby's request. */
function TogetherLobbyRegion({controller, region, rail, children}: {controller: NativeTogetherController; region: string; rail: string; children: React.ReactNode}) {
  const theme = useTheme();
  const enter = useScreenEntry(theme.isTV ? {regionId: region, childId: 'start'} : undefined, controller.lifetime.current);
  return <FocusRegion id={region} entry="start" orientation="free" edges={{left: rail}} onLayout={enter}>{children}</FocusRegion>;
}

function TogetherEndedScreen({controller, reason, text}: {controller: NativeTogetherController; reason: string; text: NativeShellRuntime['text']}) {
  const theme = useTheme(), t = text.t;
  const ids = useMemo(() => tvFocusIds(controller.lifetime.authority), [controller]), region = ids.surface('together.ended');
  const [height, setHeight] = useState(0);
  const enter = useScreenEntry(theme.isTV ? {regionId: region, childId: 'together-ended-lobby'} : undefined, controller.lifetime.current);
  const body = t(reason === 'host-ended' ? 'web.together.ended.host' : reason === 'host-unavailable' ? 'web.together.ended.away' : reason === 'empty' ? 'web.together.ended.empty' : 'web.together.ended.other');
  return <Screen style={theme.isTV ? {paddingLeft: 0, paddingRight: 0, paddingTop: 0, alignItems: 'center', justifyContent: 'center'} : undefined}>
    <FocusRegion id={region} entry="together-ended-lobby" edges={{left: ids.rail}} onLayout={event => {setHeight(event.nativeEvent.layout.height); enter();}} style={theme.isTV ? {width: 900, alignItems: 'center', transform: [{translateY: height * -.02}]} : undefined}>
      {theme.isTV ? <>
        <View testID="together-ended" style={{width: 112, height: 112, borderRadius: 56, alignItems: 'center', justifyContent: 'center', backgroundColor: alpha(theme.colors.text, .08), marginBottom: 30}}><Icon name="i-people" size={54} color={theme.colors.textSecondary}/></View>
        <Text accessibilityRole="header" style={[shellType(54, 800, 58.32, -.035), {color: theme.colors.text, textAlign: 'center', marginBottom: 14}]}>{t('web.together.endedTitle')}</Text>
        <Text style={[shellType(26, 400, 39), {color: theme.colors.textSecondary, textAlign: 'center', marginBottom: 40}]}>{body}</Text>
        <Button focusId="together-ended-lobby" testID="together-ended-lobby" onPress={() => controller.dismiss()}>{t('web.together.backToLobby')}</Button>
      </> : <StateView testID="together-ended" variant="centered" icon="i-people" title={t('web.together.endedTitle')} body={body} primaryAction={{id: 'lobby', testID: 'together-ended-lobby', label: t('web.together.backToLobby'), onPress: () => controller.dismiss()}}/>}
    </FocusRegion>
  </Screen>;
}

/** tv-more13: focus reads the value; OK opens the actual shared keyboard. */
const TogetherTVField = forwardRef<View, {focusId: string; testID: string; label: string; description?: string; value: string; onPress: () => void}>(function TogetherTVField({focusId, testID, label, description, value, onPress}, ref) {
  const theme = useTheme();
  return <View style={{gap: 8}}>
    <Text style={[shellType(20, 700), {color: theme.colors.textTertiary}]}>{label}</Text>
    <Focusable ref={ref} focusId={focusId} testID={testID} accessibilityRole="button" accessibilityLabel={label} accessibilityValue={{text: value}} onPress={onPress} focusKind="row"
      style={{height: 72, paddingHorizontal: 22, justifyContent: 'center', borderRadius: 14, borderWidth: 1.5, borderColor: theme.colors.lineStrong, backgroundColor: alpha(theme.colors.text, .08)}}>
      <Text numberOfLines={1} style={[shellType(32, 600), {color: theme.colors.text}]}>{value}</Text>
    </Focusable>
    {description && <Text style={[shellType(20, 400), {color: theme.colors.textTertiary, marginTop: 4}]}>{description}</Text>}
  </View>;
});

/** One authorized current title, never a demo backdrop or a catalogue scan. */
function TogetherLobbyArt({itemId, controller, ports, runtime}: {itemId?: string; controller: NativeTogetherController; ports: Pick<NativeSettingsLivePorts, 'context'>; runtime: NativeShellRuntime}) {
  const [item, setItem] = useState<MediaItem>();
  useEffect(() => {
    setItem(undefined);
    if (!itemId) return;
    const abort = new AbortController();
    void controller.lifetime.request(signal => ports.context.api.request(encodedRoutePath('get_items_id', {id: encodeURIComponent(itemId)}), 'GET', undefined, signal).then(parseMediaItem), abort.signal)
      .then(value => {if (!abort.signal.aborted && controller.lifetime.current() && value.id === itemId && value.available) setItem(value);}, () => {});
    return () => abort.abort();
  }, [itemId, controller, ports]);
  const source = item && item.id === itemId ? runtime.ambient(item.backdropUrl) : undefined;
  return source ? <AmbientArt testID="together-lobby-art" source={source} treatment="wash"/> : null;
}

function TogetherRoom({controller, ports, runtime}: {controller: NativeTogetherController; ports: Pick<NativeSettingsLivePorts, 'context'>; runtime: NativeShellRuntime}) {
  const theme = useTheme(), t = runtime.text.t;
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
  const members = group.members.filter(value => value.state === 'joined'), profile = runtime.getSnapshot().profile;
  const hostDeadline = group.timeline.state === 'playing' ? group.host.pauseAt : group.host.endAt;
  const hostCountdown = hostDeadline ? defaultI18n.clock(Math.max(0, Math.ceil((Date.parse(hostDeadline) - clock) / 1000))) : undefined;
  return <Screen title={group.name}>
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
              <Text style={[shellType(theme.isTV ? 22 : 13, 700), {color: group.host.presence !== 'connected' ? theme.colors.amber : theme.colors.accentStrong, marginBottom: 6}]}>{t(group.host.presence !== 'connected' ? 'web.together.state.hostReconnecting' : playing ? 'web.together.state.playing' : 'web.downloads.state.paused')}</Text><Text style={[shellType(theme.isTV ? 40 : 25, 800), {color: theme.colors.text, marginVertical: 12}]}>{title}</Text>
              {now?.duration ? (() => {const seconds = Number(groupTargetPositionUs(group.timeline, Date.parse(group.timeline.anchorAt), clock) / 1000000n);return <>
                <ScreenText secondary>{t('web.together.positionOf', {position: defaultI18n.clock(seconds), duration: defaultI18n.clock(now.duration)})}</ScreenText>
                <View style={{height: 4, borderRadius: 2, backgroundColor: alpha(theme.colors.text, .16), marginTop: 10, overflow: 'hidden'}}><View style={{height: 4, width: `${Math.max(0, Math.min(1, seconds / now.duration)) * 100}%`, backgroundColor: theme.colors.accentStrong}}/></View>
              </>;})() : null}
              <SpacedStatus text={group.readiness.aggregate === 'ready' ? t('web.together.allReady') : t('web.together.waiting', {ready: group.readiness.ready, total: group.readiness.memberCount, count: group.readiness.buffering + group.readiness.lagging + group.readiness.stale})}/>
            </View>
            <View style={{flexDirection: 'row', gap: 18}}>{canControl && group.timeline.currentEntryId && <Button focusId="transport" testID="together-transport" icon={playing ? 'i-pause' : 'i-play'} disabled={state.busy} onPress={() => run(() => controller.transport(playing ? 'pause' : 'play'))}>{t(playing ? 'web.together.pauseAll' : group.readiness.ready < group.readiness.memberCount ? 'web.together.playAnyway' : 'web.together.playAll')}</Button>}
              {playback.fence && playback.playback.itemId === group.timeline.itemId && <Button testID="together-open-player" variant="glass" icon="i-tv" onPress={() => {controller.lifetime.assert(); const current = ports.context.playback.getSnapshot(); if (current.fence && current.playback.itemId === group.timeline.itemId) ports.context.playback.open(current.fence);}}>{t('web.together.openPlayer')}</Button>}
            </View>
            {!canControl && <ScreenText secondary>{t('web.together.pill.hostControls')}</ScreenText>}
            <ScreenText secondary>{t('player.queue')}</ScreenText>
            {!state.queue?.entries.length && <ScreenText secondary>{t(group.permissions.canManageQueue ? 'web.together.emptyQueueHost' : 'web.together.emptyQueue')}</ScreenText>}
            {(state.queue?.entries ?? []).map(value => <Focusable key={value.entryId} ref={node => {if (node) queueRefs.current.set(value.entryId, node); else queueRefs.current.delete(value.entryId);}} testID={`together-queue-${value.entryId}`} accessibilityRole={group.permissions.canManageQueue || canControl ? 'button' : 'text'} accessibilityLabel={value.unavailable || !value.itemId || items[value.itemId] === null ? t('web.together.notAvailable') : items[value.itemId]?.title ?? t('web.together.loadingTitle')} onPress={group.permissions.canManageQueue || canControl ? () => {menuReturn.current = queueRefs.current.get(value.entryId) ?? null; setQueueMenu(value.entryId);} : undefined} focusKind="row" style={{backgroundColor: theme.colors.raised, borderRadius: 12, padding: 18}}><ScreenText>{value.unavailable || !value.itemId || items[value.itemId] === null ? t('web.together.notAvailable') : items[value.itemId]?.title ?? t('web.together.loadingTitle')}</ScreenText></Focusable>)}
            <View style={{flexDirection: 'row', gap: 18, marginTop: 36}}><Button ref={leaveRef} focusId="leave" testID="together-leave" variant="glass" onPress={() => group.permissions.isHost && members.length > 1 ? setConfirm('leave') : run(() => controller.leave())}>{t('web.together.leave')}</Button>{group.permissions.isHost && <Button ref={endRef} testID="together-end" variant="glass" onPress={() => setConfirm('end')}>{t('web.together.endAll')}</Button>}</View>
          </View>
          <View style={{width: theme.isTV ? 680 : theme.width >= 700 ? 340 : '100%', gap: 18}}><ScreenText secondary>{t('web.together.people', {count: members.length})}</ScreenText>
            <View style={{backgroundColor: theme.colors.raised, borderRadius: 20, overflow: 'hidden'}}>{members.map(member => <Focusable key={member.id} ref={node => {if (node) memberRefs.current.set(member.id, node); else memberRefs.current.delete(member.id);}} testID={`together-member-${member.id}`} accessibilityRole={group.permissions.isHost && member.role !== 'host' && member.presence === 'connected' && member.readiness === 'ready' ? 'button' : 'text'} accessibilityLabel={member.private ? t('together.privateViewer') : member.displayName} onPress={group.permissions.isHost && member.role !== 'host' && member.presence === 'connected' && member.readiness === 'ready' ? () => {menuReturn.current = memberRefs.current.get(member.id) ?? null; setMemberMenu(member.id);} : undefined} focusKind="row" style={{flexDirection: 'row', padding: 20, gap: 16, alignItems: 'center'}}>{member.private ? <View style={{width: 32, height: 32, borderRadius: 16, alignItems: 'center', justifyContent: 'center', backgroundColor: theme.colors.raisedHigh}}><Icon name="i-user" size={18} color={theme.colors.textSecondary}/></View> : <ProfileFace size={32} initial={[...member.displayName.trim()][0] ?? ''} color={member.id === group.viewerMemberId ? profile.color : undefined} source={member.id === group.viewerMemberId ? profile.source : undefined} scaleOnFocus={false}/>}<View style={{flex: 1}}><ScreenText>{member.private ? t('together.privateViewer') : member.id === group.viewerMemberId ? t('web.together.you', {name: member.displayName}) : member.displayName}</ScreenText>{member.role === 'host' && <ScreenText secondary>{t('web.together.pill.host')}</ScreenText>}</View><ScreenText secondary>{t(member.presence !== 'connected' ? 'web.together.away' : member.readiness === 'ready' ? 'web.together.inStep' : member.readiness === 'buffering' ? 'web.together.loading' : 'web.together.catchingUp')}</ScreenText></Focusable>)}</View>
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
    <Dialog open={confirm !== undefined} onOpenChange={open => {if (!open) setConfirm(undefined);}} title={t(confirm === 'end' ? 'confirm.endGroup.title' : 'confirm.leaveAsHost.title')} description={t(confirm === 'end' ? 'confirm.endGroup.body' : 'confirm.leaveAsHost.body')} initialFocusRef={cancel} returnFocusRef={confirm === 'end' ? endRef : leaveRef} testID="together-confirm" footer={<View style={{flexDirection: 'row', justifyContent: 'flex-end', gap: theme.isTV ? 18 : 16}}><Button ref={cancel} variant="glass" onPress={() => setConfirm(undefined)}>{t('action.cancel')}</Button><Button variant="text" style={{backgroundColor: alpha(theme.colors.record, .14)}} textStyle={{color: theme.colors.record}} disabled={state.busy} onPress={() => run(async () => {const ended = confirm === 'end' ? await controller.end() : (await controller.leave(), true); if (ended && controller.lifetime.current()) setConfirm(undefined);})}>{t(confirm === 'end' ? 'confirm.endGroup.action' : 'confirm.leaveAsHost.action')}</Button></View>}><View/></Dialog>
  </Screen>;
}

/** The approved frames separate these catalogue facts with space, never a middle dot. */
function SpacedStatus({text, size, tertiary = false}: {text: string; size?: number; tertiary?: boolean}) {
  const theme = useTheme();
  return <View style={{flexDirection: 'row', flexWrap: 'wrap', columnGap: 16}}>{text.split(' · ').map((part, index) => <Text key={index} style={[shellType(size ?? (theme.isTV ? 24 : 15), 400), {color: tertiary ? theme.colors.textTertiary : theme.colors.textSecondary}]}>{part}</Text>)}</View>;
}
