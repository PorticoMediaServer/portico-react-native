import React, {useEffect, useMemo, useRef, useState, useSyncExternalStore} from 'react';
import {FlatList, Text, View, VirtualizedList} from 'react-native';
import {defaultI18n} from '../../../../../packages/i18n/src';
import {defaultRecordingOptions} from '../../../../../packages/client-core/src/dvr';
import {dayPrimeTime, stripDays} from '../../../../../packages/client-core/src/channel-guide';
import {programmeFactParts} from '../../../../../packages/client-core/src/presentation/kit-model';
import {legacyChannel, legacyProgramme, layoutRow, nowNext, pxPerMsFor, rulerTicks, floorTo, localDayStart, SLOT_MS, type GuideChannelRow, type GuideProgram} from '../../../../../packages/client-core/src/guide';
import {Button, Chip, Focusable, Segmented, Select} from '../../kit/controls';
import {FocusRegion} from '../../kit/focus';
import {Dialog} from '../../kit/overlays';
import {Artwork} from '../../kit/artwork';
import {Icon} from '../../kit/Icon';
import {StateView} from '../../kit/states';
import {shellType} from '../../kit/shell/visual';
import {useTheme} from '../../kit/theme';
import type {NativeShellRuntime} from '../../shell/runtime';
import {tvFocusIds} from '../../shell/tv-focus';
import {Screen, ScreenText, useScreenEntry} from './Screen';
import type {NativeSettingsLivePorts} from './ports';
import type {NativeLiveController} from './live-controller';
import type {NativeRecordingsController} from './recordings-controller';
import {NativeRecordingsScreen} from './RecordingsScreen';
import {useDestinationEntryFocus} from '../destinations/useEntryFocus';
import {nativeGuideClock, nativeProgrammeCaption} from './guide-presentation';

export function NativeLiveScreen({controller, recordings, ports, runtime}: {controller: NativeLiveController; recordings: NativeRecordingsController; ports: NativeSettingsLivePorts; runtime: NativeShellRuntime}) {
  const theme = useTheme(), t = defaultI18n.t;
  const state = useSyncExternalStore(controller.subscribe, controller.getSnapshot), guide = controller.guide;
  const data = useSyncExternalStore(guide.subscribe, guide.getSnapshot);
  const ids = useMemo(() => tvFocusIds(controller.lifetime.authority), [controller]);
  const compact = !theme.isTV && theme.width < 600;
  const [now, setNow] = useState(Date.now), [start, setStart] = useState(() => floorTo(Date.now(), SLOT_MS) - (theme.isTV ? SLOT_MS : 0)), [width, setWidth] = useState(theme.isTV ? 1660 : theme.width - 40), [view, setView] = useState<'guide' | 'list'>(theme.isTV || theme.width >= 600 ? 'guide' : 'list');
  const [selected, setSelected] = useState<Readonly<{channel: GuideChannelRow; program?: GuideProgram}>>();
  const [recording, setRecording] = useState(false), [recordError, setRecordError] = useState<unknown>();
  const [recordingsOpen, setRecordingsOpen] = useState(false), [recordingsReturn, setRecordingsReturn] = useState(0);
  const opener = useRef<View | null>(null), selectedOpener = useRef<View | null>(null);
  const list = useRef<VirtualizedList<number>>(null), visible = useRef({first: 0, last: 12});
  const guideOffset = useRef(0);
  const halfHour = theme.isTV ? 240 : theme.width < 1024 ? 90 : 120;
  const channelWidth = theme.isTV ? 320 : theme.width < 600 ? 60 : 192;
  const rowHeight = theme.isTV ? 92 : 72, rowGap = theme.isTV ? 8 : compact ? 0 : 6, px = pxPerMsFor(halfHour), end = start + Math.max(halfHour, width - channelWidth) / px;
  useEffect(() => {void controller.loadSources(); const timer = setInterval(() => setNow(Date.now()), 30000); return () => clearInterval(timer);}, [controller]);
  useEffect(() => {controller.setViewport({firstRow: visible.current.first, lastRow: visible.current.last, start, end});}, [controller, guide, start, end]);
  const source = state.sources.find(value => (value.provenance === 'library-channel' ? 'library' : value.id) === state.options.sourceId);
  const groups = [...new Set((source ? [source] : state.sources).flatMap(value => value.groups))];
  const clock = useMemo(() => nativeGuideClock(runtime.text.locale ?? defaultI18n.region.formatLocale, state.options.timezone, defaultI18n.region.hour12, theme.isTV), [runtime.text.locale, state.options.timezone, theme.isTV]);
  const goNow = () => setStart(floorTo(now, SLOT_MS) - (theme.isTV ? SLOT_MS : 0));
  const nowX = (now - start) * px, inNowSpan = now >= start && now < end;
  const daysCount = Math.max(0, ...(source ? [source] : state.sources).map(value => value.guideDays));
  const days = stripDays(now, state.options.timezone, Math.max(1, daysCount));
  const today = localDayStart(now, state.options.timezone), currentDay = localDayStart(start, state.options.timezone);
  const open = (channel: GuideChannelRow, program?: GuideProgram, node?: View | null) => {selectedOpener.current = node ?? null; setRecordError(undefined); controller.clearMutationError(); setSelected({channel, program});};
  const favorite = () => {
    const channel = selected?.channel, raw = channel && legacyChannel(channel);
    if (!channel || !raw) return;
    void controller.channelPreference(channel, {favorite: !channel.favorite, hidden: raw.hidden}, ports.dvrRequestId).then(committed => {
      if (committed && controller.lifetime.current()) setSelected(current => current?.channel.id === channel.id && current.channel.sourceId === channel.sourceId ? {...current, channel: committed} : current);
    });
  };
  const watch = (channel: GuideChannelRow) => {
    const raw = legacyChannel(channel);
    if (!raw || !raw.tuneAvailable) return;
    controller.lifetime.assert();
    ports.context.navigation.open({kind: 'channel', sourceId: raw.sourceId, channelId: raw.id}, controller.lifetime.authority);
  };
  const select = (change: Parameters<NativeLiveController['select']>[0]) => {guideOffset.current = 0; visible.current = {first: 0, last: 12}; controller.select(change);};
  const sourcePicker = <Select testID="live-source" style={compact ? {width: 126, height: 34, borderWidth: 1, borderColor: theme.colors.lineStrong, borderRadius: 9, backgroundColor: 'transparent', paddingHorizontal: 12, gap: 8} : undefined} textStyle={compact ? shellType(13, 600) : undefined} accessibilityLabel={t('channels.source')} value={state.options.sourceId} options={[{value: '', label: t('channels.all')}, ...state.sources.map(value => ({value: value.provenance === 'library-channel' ? 'library' : value.id, label: value.name}))]} onValueChange={sourceId => {const selectedSource = state.sources.find(value => (value.provenance === 'library-channel' ? 'library' : value.id) === sourceId); select({sourceId, kind: !selectedSource ? 'all' : selectedSource.provenance, group: undefined}); list.current?.scrollToOffset({offset: 0, animated: false});}}/>;
  const dayPicker = <Select testID="live-day" style={compact ? {width: 214, height: 32, paddingLeft: 22, paddingRight: 0, backgroundColor: 'transparent', borderWidth: 0, gap: 4} : undefined} textStyle={compact ? shellType(13, 600) : undefined} accessibilityLabel={t('guide.day')} disabled={daysCount < 1} value={String(currentDay)} options={days.map(day => ({value: String(day), label: compact ? [day === today ? t('guide.today') : day === days[1] ? t('guide.tomorrow') : undefined, defaultI18n.formatDate(day, {weekday: 'short', month: 'short', day: 'numeric'})].filter(Boolean).join(' ') : day === today ? t('guide.today') : defaultI18n.formatDate(day, {weekday: 'long', month: 'short', day: 'numeric'})}))} onValueChange={day => Number(day) === today ? goNow() : setStart(dayPrimeTime(Number(day), state.options.timezone))}/>;
  const sortPicker = <Select testID="live-sort" style={compact ? {width: 110, height: 32, paddingHorizontal: 0, backgroundColor: 'transparent', borderWidth: 0, gap: 4} : undefined} textStyle={compact ? shellType(13, 600) : undefined} accessibilityLabel={t('channels.sort')} value={state.options.sort ?? 'number'} options={[{value: 'number', label: t('channels.sortNumber')}, {value: 'name', label: t('channels.sortName')}]} onValueChange={sort => select({sort: sort as 'number' | 'name'})}/>;
  const hasRecordings = state.sources.some(value => value.recordAvailable);
  const controls = ids.surface('live.controls');
  useDestinationEntryFocus({visible: theme.isTV && !recordingsOpen && recordingsReturn > 0, intent: 'restore', revision: recordingsReturn}, {regionId: controls, childId: 'live-recordings'});
  const empty = !state.loading && state.sources.length === 0;
  if (recordingsOpen) return <NativeRecordingsScreen controller={recordings} ports={ports} runtime={runtime} onGuide={() => {setRecordingsReturn(value => value + 1); setRecordingsOpen(false);}}/>;
  return <Screen title={!theme.isTV && !compact ? t('search.chip.liveTV') : undefined} style={theme.isTV ? {paddingTop: 56, paddingRight: 8} : undefined}>
    <View onLayout={event => setWidth(event.nativeEvent.layout.width - (theme.isTV ? 0 : compact ? 12 : 40))} style={{flex: 1, paddingLeft: theme.isTV ? 0 : compact ? 12 : 20, paddingRight: theme.isTV || compact ? 0 : 20}}>
      {compact && <View style={{flexDirection: 'row', gap: 12, alignItems: 'center', paddingLeft: 8, paddingRight: 20, marginBottom: 12, minHeight: 44}}>
        <Text accessibilityRole="header" style={[shellType(32, 800, 'normal', -.035), {color: theme.colors.text, flex: 1}]}>{t('search.chip.liveTV')}</Text>
        <Segmented testID="live-view" variant="phone" value={view} onValueChange={value => setView(value as 'list' | 'guide')} items={(['list', 'guide'] as const).map(value => ({value, label: <View style={{flexDirection: 'row', gap: 6, alignItems: 'center'}}><Icon name={value === 'list' ? 'i-list' : 'i-grid'} size={14} color={view === value ? theme.colors.text : theme.colors.textTertiary}/><Text style={[shellType(13, 600), {color: view === value ? theme.colors.text : theme.colors.textTertiary}]}>{t(value === 'list' ? 'channels.viewList' : 'channels.viewGuide')}</Text></View>}))}/>
        {hasRecordings && <Button testID="live-recordings" variant="icon" size="small" icon="i-rec" accessibilityLabel={t('recordings.title')} onPress={() => setRecordingsOpen(true)}/>}
      </View>}
      {!compact && <FocusRegion id={controls} orientation="horizontal" edges={{left: ids.rail}} style={{flexDirection: 'row', gap: theme.isTV ? 22 : 12, alignItems: 'center', marginBottom: theme.isTV ? 24 : 20, minHeight: theme.isTV ? 64 : undefined}}>
        {theme.isTV && <Text accessibilityRole="header" style={[shellType(44, 800, 'normal', -.03), {color: theme.colors.text, marginRight: 14}]}>{t('search.chip.liveTV')}</Text>}
        {sourcePicker}
        {!theme.isTV && <><Chip testID="live-view-list" selected={view === 'list'} onPress={() => setView('list')}>{t('channels.viewList')}</Chip><Chip testID="live-view-guide" selected={view === 'guide'} onPress={() => setView('guide')}>{t('channels.viewGuide')}</Chip></>}
        {dayPicker}
        <Button testID="live-now" variant="glass" size="small" onPress={goNow}>{t('guide.now')}</Button>
        {hasRecordings && <Button focusId="live-recordings" testID="live-recordings" variant="glass" size="small" icon="i-rec" onPress={() => setRecordingsOpen(true)}>{t('recordings.title')}</Button>}
        {!theme.isTV && sortPicker}
      </FocusRegion>}
      <FocusRegion id={ids.surface('live.filters')} orientation="horizontal" edges={{left: ids.rail, up: controls}} style={{marginBottom: theme.isTV ? 38 : compact ? 10 : 30}}>
        <FlatList horizontal data={groups} keyExtractor={group => group} showsHorizontalScrollIndicator={false} initialNumToRender={10} maxToRenderPerBatch={10} windowSize={3} style={{flexGrow: 0, height: theme.isTV ? 64 : 44}} contentContainerStyle={{gap: theme.isTV ? 12 : 10}}
          ListHeaderComponent={<View style={{flexDirection: 'row', gap: theme.isTV ? 12 : 10}}>{compact && sourcePicker}<Chip focusId="all" testID="live-filter-all" selected={!state.options.favorites && !state.options.group} onPress={() => select({favorites: false, group: undefined})}>{t('channels.filterAll')}</Chip><Chip focusId="favorites" testID="live-filter-favorites" selected={state.options.favorites === true} onPress={() => select({favorites: !state.options.favorites, group: undefined})}>{t('channels.favorites')}</Chip></View>}
          renderItem={({item: group}) => <Chip focusId={`group:${group}`} testID={`live-filter-${group}`} selected={state.options.group === group} onPress={() => select({group, favorites: false})}>{group}</Chip>}/>
      </FocusRegion>
      {compact && <View style={{flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12, paddingRight: 20}}>{view === 'guide' ? <View>{dayPicker}<View pointerEvents="none" style={{position: 'absolute', left: 0, top: 9}}><Icon name="i-cal" size={14} color={theme.colors.textTertiary}/></View></View> : <View style={{flexDirection: 'row', gap: 6, alignItems: 'center'}}><Text style={[shellType(13, 700), {color: theme.colors.text}]}>{t('guide.onNow')}</Text><Text style={[shellType(13), {color: theme.colors.textSecondary}]}>{clock(now)}</Text></View>}{sortPicker}</View>}
      {state.error !== undefined ? <StateView {...runtime.error(state.error, () => {void controller.loadSources();})}/> : empty ? <StateView title={t('web.live.empty.noSourcesTitle')} body={t(ports.context.account.account.role === 'owner' ? 'web.live.empty.noSourcesOwner' : 'web.live.empty.noSourcesMember')} primaryAction={{id: 'home', label: t('next.states.goHome'), onPress: () => runtime.onDestination({kind: 'home'})}}/> : <>
        <View style={{flex: 1}}>
        {view === 'guide' && <View style={{height: theme.isTV ? 50 : 30, marginLeft: channelWidth, overflow: 'hidden'}}>{rulerTicks(start, end, px, state.options.timezone).map(tick => <View key={tick.atMs} style={{position: 'absolute', left: tick.x, height: theme.isTV ? 28 : 22, borderLeftWidth: 1, borderLeftColor: theme.colors.line}}><Text style={[shellType(theme.isTV ? 20 : 11), {marginLeft: 10, color: theme.colors.textSecondary}]}>{clock(tick.atMs)}</Text></View>)}</View>}
        <VirtualizedList ref={list} key={`${state.revision}:${view}`} data={null} getItem={(_, index) => index} getItemCount={() => data.total ?? 12} keyExtractor={index => String(index)} initialNumToRender={12} maxToRenderPerBatch={12} windowSize={5} removeClippedSubviews={false} getItemLayout={(_, index) => ({index, length: rowHeight + rowGap, offset: index * (rowHeight + rowGap)})}
          onLayout={() => list.current?.scrollToOffset({offset: guideOffset.current, animated: false})} onScroll={event => {guideOffset.current = event.nativeEvent.contentOffset.y;}} scrollEventThrottle={16}
          onViewableItemsChanged={({viewableItems}) => {const indices = viewableItems.map(value => value.index).filter((value): value is number => value !== null); if (!indices.length) return; visible.current = {first: Math.min(...indices), last: Math.max(...indices)}; controller.setViewport({firstRow: visible.current.first, lastRow: visible.current.last, start, end});}}
          renderItem={({item: index}) => <LiveRow clock={clock} entryEnabled={state.revision === 0 && recordingsReturn === 0} key={`${state.revision}:${index}`} index={index} controller={controller} runtime={runtime} start={start} end={end} now={now} channelWidth={channelWidth} rowHeight={rowHeight} px={px} list={view === 'list'} onOpen={open} rail={ids.rail} watch={watch}/>}/>
        {view === 'guide' && inNowSpan && <View pointerEvents="none" style={{position: 'absolute', left: channelWidth + nowX, top: 0, bottom: theme.isTV ? 60 : 0, width: theme.isTV ? 3 : 2, backgroundColor: `${theme.colors.accentStrong}88`}}><View style={{position: 'absolute', left: -30, top: theme.isTV ? 0 : 4, width: 60, height: theme.isTV ? 30 : 22, alignItems: 'center', justifyContent: 'center', borderRadius: theme.isTV ? 6 : 4, backgroundColor: theme.colors.accentStrong}}><Text style={[shellType(theme.isTV ? 20 : 12, 800), {color: theme.colors.ink}]}>{clock(now)}</Text></View></View>}
        {compact && view === 'guide' && !inNowSpan && <Focusable testID="live-docked-now" accessibilityRole="button" accessibilityLabel={t(now < start ? 'guide.nowEarlier' : 'guide.nowLater')} onPress={goNow} style={{position: 'absolute', top: 3, ...(now < start ? {left: channelWidth + 3} : {right: 3}), height: 24, paddingHorizontal: 9, borderRadius: 12, backgroundColor: theme.colors.accentStrong, flexDirection: 'row', gap: 1, alignItems: 'center'}}>{now < start && <Icon name="i-left" size={14} color={theme.colors.ink}/>}<Text style={[shellType(12, 800), {color: theme.colors.ink}]}>{t('guide.now')}</Text>{now >= end && <Icon name="i-right" size={14} color={theme.colors.ink}/>}</Focusable>}
        </View>
        {data.channelsError && <StateView {...runtime.error(new Error('guide_channels_unavailable'), () => guide.reset())}/>}
      </>}
    </View>
    <Dialog open={selected !== undefined} onOpenChange={value => {if (!value) setSelected(undefined);}} title={selected?.program?.title ?? selected?.channel.name ?? ''} headerContext={selected && <ProgrammeHeader channel={selected.channel} programme={selected.program} now={now} runtime={runtime} busy={state.mutating} onFavorite={favorite}/>} placement={theme.isTV || theme.width >= 700 ? 'side' : undefined} width={theme.isTV ? 640 : theme.width >= 700 ? 400 : undefined} initialFocusRef={selected?.channel.tuneAvailable || selected?.channel.recordAvailable && selected.program ? opener : undefined} returnFocusRef={selectedOpener} testID="live-programme">
      {selected && <View style={{gap: 20}}>
        {selected.program && <ProgrammeDetails programme={selected.program} now={now} runtime={runtime}/>}
        {selected.channel.tuneAvailable && <Button ref={opener} testID="live-watch" icon="i-play" onPress={() => watch(selected.channel)}>{t(selected.program && selected.program.start <= now && selected.program.end > now ? 'guide.watchLive' : 'guide.watchChannel')}</Button>}
        {selected.channel.kind === 'live' && selected.channel.recordAvailable && selected.program && selected.program.end > now && <Button ref={!selected.channel.tuneAvailable ? opener : undefined} variant="glass" testID="live-record" icon="i-rec" loading={recording} disabled={recording || !!selected.program.recording} onPress={() => {
          const channel = legacyChannel(selected.channel), programme = selected.program && legacyProgramme(selected.program);
          if (!channel || !programme) return;
          setRecording(true);
          void recordings.schedule({channel, programme, series: false}, defaultRecordingOptions).then(result => {
            if (!controller.lifetime.current() || !result) {if (controller.lifetime.current()) setRecordError(recordings.getSnapshot().error); return;}
            const receipt = result.value;
            setSelected(current => current?.channel.id === selected.channel.id && current.program?.id === selected.program?.id ? {...current, program: {...current.program!, recording: {id: receipt.id, state: receipt.state}}} : current);
            guide.invalidate();
          }, error => {if (controller.lifetime.current()) setRecordError(error);}).finally(() => {if (controller.lifetime.current()) setRecording(false);});
        }}>{t(selected.program.recording ? 'guide.recordingScheduled' : 'guide.record')}</Button>}
        {recordError !== undefined && <StateView testID="live-record-error" {...runtime.error(recordError, () => setRecordError(undefined))}/>}
        {state.mutationError !== undefined && <StateView testID="live-channel-preference-error" {...runtime.error(state.mutationError, favorite)}/>}
      </View>}
    </Dialog>
  </Screen>;
}

function LiveRow({clock, entryEnabled, index, controller, runtime, start, end, now, channelWidth, rowHeight, px, list, onOpen, rail, watch}: {clock: (at: number) => string | undefined; entryEnabled: boolean; index: number; controller: NativeLiveController; runtime: NativeShellRuntime; start: number; end: number; now: number; channelWidth: number; rowHeight: number; px: number; list: boolean; onOpen: (channel: GuideChannelRow, program?: GuideProgram, node?: View | null) => void; rail: string; watch: (channel: GuideChannelRow) => void}) {
  const theme = useTheme(), t = defaultI18n.t, guide = controller.guide;
  useSyncExternalStore(listener => guide.subscribePage(guide.pageOf(index), listener), () => guide.getSnapshot().version);
  const channel = guide.channelAt(index), programs = guide.programsFor(index, start, end);
  const row = `${rail}.guide.${JSON.stringify([channel?.sourceId, channel?.id, controller.getSnapshot().revision])}`, column = `${row}.channel`, cellsRegion = `${row}.programmes`;
  const first = programs.programs.find(value => value.start <= now && value.end > now) ?? programs.programs[0];
  const compactChannel = !theme.isTV && channelWidth <= 80, rowGap = theme.isTV ? 8 : compactChannel ? 0 : 6;
  const cells = layoutRow(programs.programs, {viewStart: start, viewEnd: end, pxPerMs: px, now, gapPx: compactChannel ? 2 : 6, tiers: theme.isTV ? {full: 300, title2: 150, title: 32} : {full: 50, title2: 50, title: 24}});
  const firstId = first?.id ?? (list ? 'now' : cells[0] ? `gap:${cells[0].start}` : undefined);
  const entry = useScreenEntry(theme.isTV && entryEnabled && index === 0 && channel && firstId ? {regionId: cellsRegion, childId: firstId} : undefined, controller.lifetime.current);
  const channelRef = useRef<View>(null), programRefs = useRef(new Map<string, View>());
  if (!channel) return <View style={{height: rowHeight, marginBottom: rowGap, backgroundColor: theme.colors.raised, opacity: .4, borderRadius: 12}}/>;
  const logo = runtime.artwork(channel.logoUrl);
  const current = nowNext(programs.programs, now);
  return <View style={{height: rowHeight, marginBottom: rowGap, flexDirection: 'row', gap: theme.isTV ? 18 : compactChannel ? 2 : 8}}>
    <FocusRegion id={column} entry="channel" edges={{left: rail, right: cellsRegion}} style={{width: channelWidth - (theme.isTV ? 18 : compactChannel ? 2 : 8)}}>
      <Focusable ref={channelRef} focusId="channel" testID={`live-channel-${channel.sourceId}-${channel.id}`} accessibilityRole="button" accessibilityLabel={`${channel.number} ${channel.name}`} onPress={() => list ? onOpen(channel, current.now, channelRef.current) : theme.isTV ? watch(channel) : onOpen(channel, undefined, channelRef.current)} focusKind="row" style={{height: rowHeight, borderRadius: compactChannel ? 8 : 12, paddingHorizontal: compactChannel ? 0 : 16, flexDirection: compactChannel ? 'column' : 'row', justifyContent: compactChannel ? 'center' : undefined, alignItems: 'center', gap: compactChannel ? 4 : 16, backgroundColor: compactChannel ? 'transparent' : theme.colors.raised}}>
        <View style={{width: theme.isTV ? 56 : 36, height: theme.isTV ? 56 : 36}}>{logo && <Artwork source={logo} fit="contain"/>}{compactChannel && channel.favorite && <View style={{position: 'absolute', right: -7, top: -6, width: 18, height: 18, borderRadius: 9, backgroundColor: theme.colors.ink, alignItems: 'center', justifyContent: 'center'}}><Icon name="i-star-f" size={10} color={theme.colors.accentStrong}/></View>}</View>
        <View style={{flex: compactChannel ? undefined : 1, alignItems: compactChannel ? 'center' : undefined}}>{!compactChannel && <Text numberOfLines={2} style={[shellType(theme.isTV ? 22 : 13, 700), {color: theme.colors.text}]}>{channel.name}</Text>}<Text style={[shellType(theme.isTV ? 18 : 11), {color: theme.colors.textSecondary}]}>{channel.number}</Text></View>
      </Focusable>
    </FocusRegion>
    <FocusRegion id={cellsRegion} entry={first?.id} orientation="horizontal" edges={{left: column}} style={{flex: 1, overflow: 'hidden'}} onLayout={entry}>
      {list ? <Focusable ref={node => {if (node) programRefs.current.set('now', node);}} focusId={first?.id ?? 'now'} testID={`live-now-${channel.id}`} onPress={() => onOpen(channel, current.now, programRefs.current.get('now'))} style={{height: rowHeight, padding: 14, backgroundColor: theme.colors.raised, borderRadius: 12, gap: 8}}><ScreenText>{current.now?.title ?? t('guide.noInformation')}</ScreenText>{current.next && <Text style={[shellType(theme.isTV ? 20 : 12), {color: theme.colors.textSecondary}]}>{t('guide.next', {title: current.next.title, time: defaultI18n.time(current.next.start)})}</Text>}</Focusable>
        : cells.map(cell => <Focusable key={cell.program?.id ?? `gap:${cell.start}`} ref={node => {const id = cell.program?.id ?? `gap:${cell.start}`; if (node) programRefs.current.set(id, node); else programRefs.current.delete(id);}} focusId={cell.program?.id ?? `gap:${cell.start}`} testID={`live-programme-${channel.id}-${cell.program?.id ?? cell.start}`} accessibilityRole="button" accessibilityLabel={cell.program?.title ?? t('guide.noInformation')} onPress={() => onOpen(channel, cell.program, programRefs.current.get(cell.program?.id ?? `gap:${cell.start}`))} focusKind="row" style={{position: 'absolute', left: cell.x, top: compactChannel ? 3 : 0, width: cell.width, height: rowHeight - (compactChannel ? 6 : 0), borderRadius: compactChannel ? 8 : 12, padding: theme.isTV ? 16 : compactChannel ? 7 : 8, justifyContent: compactChannel ? 'center' : undefined, backgroundColor: cell.state === 'now' ? theme.colors.raisedHigh : theme.colors.raised, overflow: 'hidden'}}>
          {cell.clippedStart && <View style={{position: 'absolute', left: 6, top: 14}}><Icon name="i-left" size={theme.isTV ? 16 : 10} color={theme.colors.textTertiary}/></View>}
          <Text numberOfLines={2} style={[shellType(theme.isTV ? 22 : 13, 700), {color: theme.colors.text, lineHeight: theme.isTV ? undefined : 16}]}>{cell.program?.title ?? t('guide.noInformation')}</Text>
          {(cell.tier === 'full' || cell.tier === 'title2') && <View style={{flexDirection: 'row', alignItems: 'center', gap: theme.isTV ? 12 : 5, marginTop: theme.isTV ? 8 : 3}}>
            {cell.width >= (theme.isTV ? 150 : 50) && <ProgrammeFlags programme={cell.program}/>}
            {cell.program?.recording && <View style={{width: theme.isTV ? 12 : 7, height: theme.isTV ? 12 : 7, borderRadius: 6, backgroundColor: theme.colors.record}}/>}
            {nativeProgrammeCaption(cell.program, cell.state === 'now', theme.isTV, clock, runtime.text).map((caption, captionIndex) => <Text key={captionIndex} numberOfLines={1} style={[shellType(theme.isTV ? 18 : 11.5), {color: theme.colors.textTertiary, flexShrink: captionIndex ? 1 : 0, lineHeight: theme.isTV ? undefined : 14}]}>{caption}</Text>)}
          </View>}
          {cell.state === 'now' && <View style={{position: 'absolute', left: theme.isTV ? 16 : 8, bottom: theme.isTV ? 8 : 2, width: Math.max(0, Math.min(cell.width - (theme.isTV ? 32 : 16), (now - Math.max(cell.start, start)) * px)), height: 3, backgroundColor: theme.colors.accentStrong}}/>}
        </Focusable>)}
    </FocusRegion>
  </View>;
}

function ProgrammeFlags({programme}: {programme?: GuideProgram}) {
  const theme = useTheme(), t = defaultI18n.t;
  return <>{programme?.flags?.live && <View style={{flexDirection: 'row', gap: 6, alignItems: 'center', ...(!theme.isTV ? {backgroundColor: theme.colors.record, borderRadius: 4, paddingHorizontal: 5} : {})}}>{theme.isTV && <View style={{width: 8, height: 8, borderRadius: 4, backgroundColor: theme.colors.record}}/>}<Text style={[shellType(theme.isTV ? 18 : 10, 700), {color: theme.isTV ? theme.colors.record : theme.colors.text}]}>{t('guide.live')}</Text></View>}{programme?.flags?.new && <Text style={[shellType(theme.isTV ? 18 : 10, 700), {paddingHorizontal: 5, borderRadius: 4, backgroundColor: theme.colors.accentStrong, color: theme.colors.ink}]}>{t('guide.new')}</Text>}{programme?.flags?.premiere && <Text style={[shellType(theme.isTV ? 18 : 10, 700), {color: theme.isTV ? theme.colors.textSecondary : theme.colors.accentStrong, ...(!theme.isTV ? {borderWidth: 1, borderColor: theme.colors.accentStrong, borderRadius: 4, paddingHorizontal: 5} : {})}]}>{t('guide.premiere')}</Text>}</>;
}

function ProgrammeHeader({channel, programme, now, runtime, busy, onFavorite}: {channel: GuideChannelRow; programme?: GuideProgram; now: number; runtime: NativeShellRuntime; busy: boolean; onFavorite: () => void}) {
  const theme = useTheme(), t = defaultI18n.t, logo = runtime.artwork(channel.logoUrl), onNow = programme && programme.start <= now && programme.end > now;
  return <View style={{flexDirection: 'row', alignItems: 'center', gap: theme.isTV ? 16 : 10, marginBottom: theme.isTV ? 32 : 16}}>
    {logo && <View style={{width: theme.isTV ? 56 : 34, height: theme.isTV ? 56 : 34, borderRadius: theme.isTV ? 10 : 7, overflow: 'hidden'}}><Artwork source={logo} fit="contain"/></View>}
    <View style={{flex: 1, flexDirection: 'row', gap: 16, alignItems: 'center'}}><Text style={[shellType(theme.isTV ? 24 : 13, 700), {color: theme.colors.text}]}>{channel.name}</Text><Text style={[shellType(theme.isTV ? 22 : 13, 700), {color: theme.colors.textSecondary}]}>{channel.number}</Text></View>
    {(theme.isTV ? programme?.flags?.live : onNow) && <View style={{flexDirection: 'row', gap: 6, alignItems: 'center'}}><View style={{width: theme.isTV ? 8 : 7, height: theme.isTV ? 8 : 7, borderRadius: 4, backgroundColor: theme.colors.record}}/><Text style={[shellType(theme.isTV ? 22 : 12, 700), {color: theme.colors.record}]}>{t(theme.isTV ? 'guide.live' : 'guide.onNow')}</Text></View>}
    {!theme.isTV && <Focusable testID="live-channel-favorite" focusKind="button" accessibilityRole="button" accessibilityLabel={t(channel.favorite ? 'channels.removeFavorite' : 'channels.addFavorite')} accessibilityState={{selected: channel.favorite}} disabled={busy} onPress={onFavorite} style={{width: 44, height: 44, alignItems: 'center', justifyContent: 'center'}}><Icon name={channel.favorite ? 'i-star-f' : 'i-star'} size={20} color={channel.favorite ? theme.colors.accentStrong : theme.colors.textSecondary}/></Focusable>}
  </View>;
}

function ProgrammeDetails({programme, now, runtime}: {programme: GuideProgram; now: number; runtime: NativeShellRuntime}) {
  const theme = useTheme();
  const facts = programmeFactParts({startMs: programme.start, endMs: programme.end, subtitle: programme.subtitle, episode: programme.episode?.number ? {mode: 'seasonal', season: programme.episode.season, episode: programme.episode.number} : undefined, year: programme.year, categories: programme.categories?.filter(value => value.toLowerCase() !== 'live'), rating: programme.rating}, runtime.text, now);
  const tags = facts.filter(fact => fact.id === 'content-rating' || fact.id.startsWith('category-')), row = facts.filter(fact => !tags.includes(fact) && fact.id !== 'started');
  const onNow = programme.start <= now && programme.end > now, fraction = Math.max(0, Math.min(1, (now - programme.start) / (programme.end - programme.start)));
  return <View style={{gap: theme.isTV ? 22 : 16}}>
    <View style={{flexDirection: 'row', flexWrap: 'wrap', gap: theme.isTV ? 20 : 12}}>{[...row, ...(theme.isTV ? tags : [])].map(fact => <Text key={fact.id} style={[shellType(theme.isTV ? 22 : 13, fact.id === 'remaining' ? 700 : 400), {color: theme.colors.textSecondary}]}>{fact.text}</Text>)}</View>
    {onNow && <View style={{height: theme.isTV ? 5 : 4, borderRadius: 3, backgroundColor: theme.colors.line, overflow: 'hidden'}}><View style={{height: '100%', width: `${fraction * 100}%`, backgroundColor: theme.colors.accentStrong}}/></View>}
    {!theme.isTV && tags.length > 0 && <View style={{flexDirection: 'row', flexWrap: 'wrap', gap: 8}}>{tags.map(fact => <Text key={fact.id} style={[shellType(12), {color: theme.colors.textSecondary, borderRadius: 5, borderWidth: 1, borderColor: theme.colors.lineStrong, paddingVertical: 4, paddingHorizontal: 8}]}>{fact.text}</Text>)}</View>}
    {programme.description && <Text numberOfLines={theme.isTV ? undefined : theme.width < 700 ? 3 : undefined} style={[shellType(theme.isTV ? 22 : 13), {color: theme.colors.textSecondary, lineHeight: theme.isTV ? 33 : 20}]}>{programme.description}</Text>}
  </View>;
}
