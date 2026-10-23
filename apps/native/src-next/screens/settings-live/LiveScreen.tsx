import React, {useEffect, useMemo, useRef, useState, useSyncExternalStore} from 'react';
import {Text, View, VirtualizedList} from 'react-native';
import {defaultI18n} from '../../../../../packages/i18n/src';
import {DVRClient, defaultRecordingOptions} from '../../../../../packages/client-core/src/dvr';
import {legacyChannel, legacyProgramme, layoutRow, nowNext, pxPerMsFor, rulerTicks, floorTo, SLOT_MS, type GuideChannelRow, type GuideProgram} from '../../../../../packages/client-core/src/guide';
import {Button, Chip, Focusable, Select} from '../../kit/controls';
import {FocusRegion} from '../../kit/focus';
import {Dialog} from '../../kit/overlays';
import {Artwork} from '../../kit/artwork';
import {StateView} from '../../kit/states';
import {shellType} from '../../kit/shell/visual';
import {useTheme} from '../../kit/theme';
import type {NativeShellRuntime} from '../../shell/runtime';
import {tvFocusIds} from '../../shell/tv-focus';
import {Screen, ScreenText, useScreenEntry} from './Screen';
import type {NativeSettingsLivePorts} from './ports';
import type {NativeLiveController} from './live-controller';

export function NativeLiveScreen({controller, ports, runtime}: {controller: NativeLiveController; ports: NativeSettingsLivePorts; runtime: NativeShellRuntime}) {
  const theme = useTheme(), t = defaultI18n.t;
  const state = useSyncExternalStore(controller.subscribe, controller.getSnapshot), guide = controller.guide;
  const data = useSyncExternalStore(guide.subscribe, guide.getSnapshot);
  const ids = useMemo(() => tvFocusIds(controller.lifetime.authority), [controller]);
  const [now, setNow] = useState(Date.now), [start, setStart] = useState(() => floorTo(Date.now(), SLOT_MS)), [width, setWidth] = useState(theme.isTV ? 1660 : theme.width - 40), [view, setView] = useState<'guide' | 'list'>(theme.isTV || theme.width >= 600 ? 'guide' : 'list');
  const [selected, setSelected] = useState<Readonly<{channel: GuideChannelRow; program?: GuideProgram}>>();
  const [recording, setRecording] = useState(false), [recordError, setRecordError] = useState<unknown>();
  const opener = useRef<View | null>(null), selectedOpener = useRef<View | null>(null);
  const list = useRef<VirtualizedList<number>>(null), visible = useRef({first: 0, last: 12});
  const halfHour = theme.isTV ? 360 : theme.width < 1024 ? 90 : 120;
  const channelWidth = theme.isTV ? 300 : theme.width < 600 ? 60 : 192;
  const rowHeight = theme.isTV ? 96 : 72, px = pxPerMsFor(halfHour), end = start + Math.max(halfHour, width - channelWidth) / px;
  const dvr = useMemo(() => new DVRClient(controller.api, controller.lifetime.authority.serverId, async () => ports.requestId()), [controller, ports]);
  useEffect(() => {void controller.loadSources(); const timer = setInterval(() => setNow(Date.now()), 30000); return () => clearInterval(timer);}, [controller]);
  useEffect(() => {controller.setViewport({firstRow: visible.current.first, lastRow: visible.current.last, start, end});}, [controller, guide, start, end]);
  const source = state.sources.find(value => value.id === state.options.sourceId);
  const groups = [...new Set((source ? [source] : state.sources).flatMap(value => value.groups))].slice(0, 6);
  const open = (channel: GuideChannelRow, program?: GuideProgram, node?: View | null) => {selectedOpener.current = node ?? null; setRecordError(undefined); setSelected({channel, program});};
  const watch = (channel: GuideChannelRow) => {
    const raw = legacyChannel(channel);
    if (!raw || !raw.tuneAvailable) return;
    controller.lifetime.assert();
    ports.context.navigation.open({kind: 'channel', sourceId: raw.sourceId, channelId: raw.id}, controller.lifetime.authority);
  };
  const empty = !state.loading && state.sources.length === 0;
  return <Screen title={t('search.chip.liveTV')}>
    <View onLayout={event => setWidth(event.nativeEvent.layout.width)} style={{flex: 1, paddingHorizontal: theme.isTV ? 0 : 20}}>
      <View style={{flexDirection: 'row', gap: 12, alignItems: 'center', marginBottom: 20}}>
        <Select testID="live-source" accessibilityLabel={t('channels.source')} value={state.options.sourceId} options={[{value: '', label: t('channels.allChannels')}, ...state.sources.map(value => ({value: value.id, label: value.name}))]} onValueChange={sourceId => {controller.select({sourceId, group: undefined}); list.current?.scrollToOffset({offset: 0, animated: false});}}/>
        <Chip selected={view === 'list'} onPress={() => setView('list')}>{t('channels.viewList')}</Chip><Chip selected={view === 'guide'} onPress={() => setView('guide')}>{t('channels.viewGuide')}</Chip>
        <Button variant="glass" size="small" onPress={() => setStart(floorTo(now, SLOT_MS))}>{t('guide.now')}</Button>
        <Select testID="live-sort" accessibilityLabel={t('channels.sort')} value={state.options.sort ?? 'number'} options={[{value: 'number', label: t('channels.sortNumber')}, {value: 'name', label: t('channels.sortName')}]} onValueChange={sort => controller.select({sort: sort as 'number' | 'name'})}/>
      </View>
      <View style={{flexDirection: 'row', gap: 10, marginBottom: 30}}><Chip selected={!state.options.favorites && !state.options.group} onPress={() => controller.select({favorites: false, group: undefined})}>{t('channels.filterAll')}</Chip><Chip selected={state.options.favorites === true} onPress={() => controller.select({favorites: !state.options.favorites, group: undefined})}>{t('channels.favorites')}</Chip>{groups.map(group => <Chip key={group} selected={state.options.group === group} onPress={() => controller.select({group, favorites: false})}>{group}</Chip>)}</View>
      {state.error !== undefined ? <StateView {...runtime.error(state.error, () => {void controller.loadSources();})}/> : empty ? <StateView title={t('web.live.empty.noSourcesTitle')} body={t(ports.context.account.account.role === 'owner' ? 'web.live.empty.noSourcesOwner' : 'web.live.empty.noSourcesMember')} primaryAction={{id: 'home', label: t('web.console.goHome'), onPress: () => runtime.onDestination({kind: 'home'})}}/> : <>
        {view === 'guide' && <View style={{height: 44, marginLeft: channelWidth, overflow: 'hidden'}}>{rulerTicks(start, end, px, state.options.timezone).map(tick => <Text key={tick.atMs} style={[shellType(theme.isTV ? 18 : 11), {position: 'absolute', left: tick.x + 6, color: theme.colors.textSecondary}]}>{defaultI18n.time(tick.atMs)}</Text>)}</View>}
        <VirtualizedList ref={list} key={`${state.revision}:${view}`} data={null} getItem={(_, index) => index} getItemCount={() => data.total ?? 12} keyExtractor={index => String(index)} initialNumToRender={12} maxToRenderPerBatch={12} windowSize={5} removeClippedSubviews={false} getItemLayout={(_, index) => ({index, length: rowHeight + 6, offset: index * (rowHeight + 6)})}
          onViewableItemsChanged={({viewableItems}) => {const indices = viewableItems.map(value => value.index).filter((value): value is number => value !== null); if (!indices.length) return; visible.current = {first: Math.min(...indices), last: Math.max(...indices)}; controller.setViewport({firstRow: visible.current.first, lastRow: visible.current.last, start, end});}}
          renderItem={({item: index}) => <LiveRow key={`${state.revision}:${index}`} index={index} controller={controller} runtime={runtime} start={start} end={end} now={now} channelWidth={channelWidth} rowHeight={rowHeight} px={px} list={view === 'list'} onOpen={open} rail={ids.rail} watch={watch}/>}/>
        {data.channelsError && <StateView {...runtime.error(new Error('guide_channels_unavailable'), () => guide.reset())}/>}
      </>}
    </View>
    <Dialog open={selected !== undefined} onOpenChange={value => {if (!value) setSelected(undefined);}} title={selected?.program?.title ?? selected?.channel.name ?? ''} headerContext={selected?.channel.name} description={selected?.program?.description} placement={theme.isTV || theme.width >= 700 ? 'side' : undefined} width={theme.isTV ? 640 : theme.width >= 700 ? 400 : undefined} returnFocusRef={selectedOpener} testID="live-programme">
      {selected && <View style={{gap: 20}}>
        {selected.program && <ScreenText secondary>{t('guide.range', {start: defaultI18n.time(selected.program.start), end: defaultI18n.time(selected.program.end)})}</ScreenText>}
        {selected.channel.tuneAvailable && (!selected.program || selected.program.start <= now && selected.program.end > now) && <Button ref={opener} testID="live-watch" icon="i-play" onPress={() => watch(selected.channel)}>{t(selected.program ? 'guide.watchLive' : 'guide.watchChannel')}</Button>}
        {selected.channel.kind === 'live' && selected.channel.recordAvailable && selected.program && selected.program.end > now && <Button variant="glass" testID="live-record" loading={recording} disabled={recording || !!selected.program.recording} onPress={() => {
          const channel = legacyChannel(selected.channel), programme = selected.program && legacyProgramme(selected.program);
          if (!channel || !programme) return;
          setRecording(true);
          void dvr.schedule({channel, programme, series: false}, defaultRecordingOptions).then(() => {if (controller.lifetime.current()) guide.invalidate();}, error => {if (controller.lifetime.current()) setRecordError(error);}).finally(() => {if (controller.lifetime.current()) setRecording(false);});
        }}>{t(selected.program.recording ? 'guide.recordingScheduled' : 'guide.record')}</Button>}
        {recordError !== undefined && <StateView {...runtime.error(recordError, () => setRecordError(undefined))}/>}
      </View>}
    </Dialog>
  </Screen>;
}

function LiveRow({index, controller, runtime, start, end, now, channelWidth, rowHeight, px, list, onOpen, rail, watch}: {index: number; controller: NativeLiveController; runtime: NativeShellRuntime; start: number; end: number; now: number; channelWidth: number; rowHeight: number; px: number; list: boolean; onOpen: (channel: GuideChannelRow, program?: GuideProgram, node?: View | null) => void; rail: string; watch: (channel: GuideChannelRow) => void}) {
  const theme = useTheme(), t = defaultI18n.t, guide = controller.guide;
  useSyncExternalStore(listener => guide.subscribePage(guide.pageOf(index), listener), () => guide.getSnapshot().version);
  const channel = guide.channelAt(index), programs = guide.programsFor(index, start, end);
  const row = `${rail}.guide.${index}`, column = `${row}.channel`, cellsRegion = `${row}.programmes`;
  const first = programs.programs.find(value => value.start <= now && value.end > now) ?? programs.programs[0];
  const entry = useScreenEntry(theme.isTV && index === 0 && first ? {regionId: cellsRegion, childId: first.id} : undefined, controller.lifetime.current);
  const channelRef = useRef<View>(null), programRefs = useRef(new Map<string, View>());
  if (!channel) return <View style={{height: rowHeight, marginBottom: 6, backgroundColor: theme.colors.raised, opacity: .4, borderRadius: 12}}/>;
  const logo = runtime.artwork(channel.logoUrl);
  const current = nowNext(programs.programs, now);
  return <View style={{height: rowHeight, marginBottom: 6, flexDirection: 'row', gap: 8}}>
    <FocusRegion id={column} entry="channel" orientation="vertical" edges={{left: rail, right: cellsRegion}} style={{width: channelWidth - 8}}>
      <Focusable ref={channelRef} focusId="channel" testID={`live-channel-${channel.sourceId}-${channel.id}`} accessibilityRole="button" accessibilityLabel={`${channel.number} ${channel.name}`} onPress={() => list ? onOpen(channel, current.now, channelRef.current) : watch(channel)} focusKind="row" style={{height: rowHeight, borderRadius: 12, paddingHorizontal: 16, flexDirection: 'row', alignItems: 'center', gap: 16, backgroundColor: theme.colors.raised}}>
        {logo && <View style={{width: theme.isTV ? 56 : 36, height: theme.isTV ? 56 : 36}}><Artwork source={logo} fit="contain"/></View>}
        <View style={{flex: 1}}>{channelWidth > 80 && <Text numberOfLines={2} style={[shellType(theme.isTV ? 22 : 13, 700), {color: theme.colors.text}]}>{channel.name}</Text>}<Text style={[shellType(theme.isTV ? 18 : 11), {color: theme.colors.textSecondary}]}>{channel.number}</Text></View>
      </Focusable>
    </FocusRegion>
    <FocusRegion id={cellsRegion} entry={first?.id} orientation="horizontal" edges={{left: column}} style={{flex: 1, overflow: 'hidden'}} onLayout={entry}>
      {list ? <Focusable ref={node => {if (node) programRefs.current.set('now', node);}} focusId={first?.id ?? 'now'} testID={`live-now-${channel.id}`} onPress={() => onOpen(channel, current.now, programRefs.current.get('now'))} style={{height: rowHeight, padding: 14, backgroundColor: theme.colors.raised, borderRadius: 12, gap: 8}}><ScreenText>{current.now?.title ?? t('guide.noInformation')}</ScreenText>{current.next && <Text style={[shellType(theme.isTV ? 20 : 12), {color: theme.colors.textSecondary}]}>{t('guide.next', {title: current.next.title, time: defaultI18n.time(current.next.start)})}</Text>}</Focusable>
        : layoutRow(programs.programs, {viewStart: start, viewEnd: end, pxPerMs: px, now, gapPx: 6, tiers: theme.isTV ? {full: 300, title2: 150, title: 32} : {full: 50, title2: 50, title: 24}}).map(cell => <Focusable key={cell.program?.id ?? `gap:${cell.start}`} ref={node => {if (node && cell.program) programRefs.current.set(cell.program.id, node);}} focusId={cell.program?.id ?? `gap:${cell.start}`} testID={`live-programme-${channel.id}-${cell.program?.id ?? cell.start}`} accessibilityRole="button" accessibilityLabel={cell.program?.title ?? t('guide.noInformation')} onPress={() => onOpen(channel, cell.program, cell.program ? programRefs.current.get(cell.program.id) : undefined)} focusKind="row" style={{position: 'absolute', left: cell.x, width: cell.width, height: rowHeight, borderRadius: 12, padding: theme.isTV ? 16 : 8, backgroundColor: cell.state === 'now' ? theme.colors.raisedHigh : theme.colors.raised, overflow: 'hidden'}}>
          <Text numberOfLines={2} style={[shellType(theme.isTV ? 22 : 12, 700), {color: theme.colors.text}]}>{cell.program?.title ?? t('guide.noInformation')}</Text>
          {cell.tier !== 'sliver' && <Text numberOfLines={1} style={[shellType(theme.isTV ? 18 : 10), {color: theme.colors.textTertiary}]}>{t('guide.range', {start: defaultI18n.time(cell.start), end: defaultI18n.time(cell.end)})}</Text>}
          {cell.state === 'now' && <View style={{position: 'absolute', left: 16, bottom: 8, width: Math.min(cell.width - 32, Math.max(0, (now - Math.max(cell.start, start)) * px)), height: 3, backgroundColor: theme.colors.accentStrong}}/>}
        </Focusable>)}
    </FocusRegion>
  </View>;
}
