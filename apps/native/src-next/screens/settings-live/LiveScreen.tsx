import React, {useEffect, useId, useMemo, useRef, useState, useSyncExternalStore} from 'react';
import {BackHandler, FlatList, Platform, ScrollView, Text, View, VirtualizedList, useWindowDimensions} from 'react-native';
import {useSafeAreaInsets} from 'react-native-safe-area-context';
import {GestureDetector} from 'react-native-gesture-handler';
import Animated, {useAnimatedStyle, type SharedValue} from 'react-native-reanimated';
import Svg, {Defs, LinearGradient, Pattern, Rect, Stop} from 'react-native-svg';
import {defaultRecordingOptions} from '../../../../../packages/client-core/src/dvr';
import {dayPrimeTime, stripDays} from '../../../../../packages/client-core/src/channel-guide';
import {programmeFactParts} from '../../../../../packages/client-core/src/presentation/kit-model';
import {legacyChannel, legacyProgramme, legacyProgram, layoutRow, nowNext, pxPerMsFor, rulerTicks, floorTo, localDayStart, SLOT_MS, type GuideChannelRow, type GuideProgram, type GuideCell} from '../../../../../packages/client-core/src/guide';
import {GuideFeatureClient, type GuideAiring, type GuideReminder} from '../../../../../packages/client-core/src/guide/directory';
import type {RecordingDraft} from '../../../../../packages/client-core/src/dvr';
import {Button, Chip, Focusable, Segmented, Select} from '../../kit/controls';
import {FocusRegion} from '../../kit/focus';
import {Dialog, ToastHost, type ToastMessage} from '../../kit/overlays';
import {Artwork, ChannelMark} from '../../kit/artwork';
import {Icon} from '../../kit/Icon';
import {SkeletonBlock, StateView} from '../../kit/states';
import {alpha, shellType} from '../../kit/shell/visual';
import {useTheme} from '../../kit/theme';
import {usePlatformPosture} from '../../platform/platformPosture';
import type {NativeShellRuntime} from '../../shell/runtime';
import {tvFocusIds} from '../../shell/tv-focus';
import {Screen, ScreenText, useScreenEntry} from './Screen';
import type {NativeSettingsLivePorts} from './ports';
import type {NativeLiveController} from './live-controller';
import type {NativeRecordingsController} from './recordings-controller';
import {NativeRecordingsScreen} from './RecordingsScreen';
import {useDestinationEntryFocus} from '../destinations/useEntryFocus';
import {nativeGuideClock, nativeGuideDate, nativeGuideRegion, nativeGuideNext, nativeProgrammeCaption} from './guide-presentation';
import {useGuideTimePan} from './useGuideTimePan';
import {nativeGuideCellWindow, nativeGuideElapsedWidth} from './guide-pan-model';
import {NativeLivePhonePicker} from './LivePhonePicker';
import {NativeLiveOwnerScreen} from './LiveOwnerScreen';
import type {NativeLiveOwnerController} from './live-owner-controller';
import {NativeSeriesRuleSheet} from './LiveSeriesRule';
import {seriesFormDefaults, type SeriesForm} from './recording-rule-presentation';

export function NativeLiveScreen({controller, recordings, owner, ports, runtime}: {controller: NativeLiveController; recordings: NativeRecordingsController; owner: NativeLiveOwnerController; ports: Pick<NativeSettingsLivePorts, 'context' | 'dvrRequestId' | 'requestId'>; runtime: NativeShellRuntime}) {
  const theme = useTheme(), t = runtime.text.t, dimensions = useWindowDimensions(), insets = useSafeAreaInsets(), shadeId = useId().replace(/:/g, '');
  const state = useSyncExternalStore(controller.subscribe, controller.getSnapshot), guide = controller.guide;
  const data = useSyncExternalStore(guide.subscribe, guide.getSnapshot);
  const ids = useMemo(() => tvFocusIds(controller.lifetime.authority), [controller]);
  const compact = !theme.isTV && theme.width < 600;
  const landscape = !theme.isTV && theme.width >= 600 && dimensions.height < 600, phone = compact || landscape;
  const tabletMedium = !theme.isTV && theme.platform === 'tablet', phoneChrome = phone || tabletMedium;
  // The authored phone header stack covers the medium tablet too; landscape keeps its own
  // single-row header and wide layouts keep the desktop controls row.
  const stackedHeader = phoneChrome && !landscape;
  // foldable7: only a reported vertical crease for this exact window may split the page;
  // an absent posture report keeps the single-page guide and its panel.
  const posture = usePlatformPosture();
  const crease = posture.status === 'available' && posture.window?.width === dimensions.width && posture.window.height === dimensions.height
    ? posture.folds.find(value => value.orientation === 'vertical' && value.bounds.left > 0 && value.bounds.left < value.bounds.right && value.bounds.right <= dimensions.width) : undefined;
  const insetLeft = landscape ? Math.max(12, insets.left + 8) : compact ? 0 : theme.isTV ? 0 : 20;
  const insetRight = landscape ? Math.max(12, insets.right + 8) : compact || theme.isTV ? 0 : 20;
  const [now, setNow] = useState(Date.now), [start, setStart] = useState(() => floorTo(Date.now(), SLOT_MS) - (theme.isTV || phoneChrome ? SLOT_MS : 0)), [measuredWidth, setMeasuredWidth] = useState(theme.isTV ? 1660 : theme.width - 40);
  const view = state.view ?? (theme.isTV || theme.width >= 600 ? 'guide' : 'list');
  const setView = (value: 'guide' | 'list') => {if (value === 'list') goNow(); controller.chooseView(value);};
  const [selected, setSelected] = useState<Readonly<{channel: GuideChannelRow; program?: GuideProgram}>>();
  // tablet-play6/7: a chosen programme docks in the right pane on tablets as well as
  // across a real fold; with nothing selected the guide takes the whole width. The page
  // measures its own content box because the shell rail or sidebar sits outside it, so
  // window-space crease bounds are shifted by that edge before anything is laid out here.
  const content = useRef<View>(null);
  const [contentViewport, setContentViewport] = useState<Readonly<{left: number; width: number}>>();
  const measureContent = () => {
    content.current?.measureInWindow((left, _top, measured) => {
      if (!(measured > 0)) return;
      setContentViewport(current => current && Math.abs(current.left - left) < .5 && Math.abs(current.width - measured) < .5 ? current : {left, width: measured});
    });
  };
  const contentWidth = contentViewport?.width ?? 0, contentLeft = contentViewport?.left ?? 0;
  const creaseLeft = crease ? Math.max(0, crease.bounds.left - contentLeft) : undefined;
  const creaseRight = crease ? Math.max(0, crease.bounds.right - contentLeft) : undefined;
  const [recording, setRecording] = useState(false), [recordError, setRecordError] = useState<unknown>();
  const [series, setSeries] = useState<Readonly<{draft: RecordingDraft; defaults?: SeriesForm}>>(), [toast, setToast] = useState<ToastMessage | null>(null);
  const [reminders, setReminders] = useState<ReadonlyMap<string, GuideReminder>>(new Map()), [later, setLater] = useState<readonly GuideAiring[]>([]);
  const [recordingsOpen, setRecordingsOpen] = useState(false), [recordingsReturn, setRecordingsReturn] = useState(0), [ownerOpen, setOwnerOpen] = useState(false);
  const [initialOwnerAction, setInitialOwnerAction] = useState<'add' | 'discover'>();
  const opener = useRef<View | null>(null), selectedOpener = useRef<View | null>(null);
  const list = useRef<VirtualizedList<number>>(null), visible = useRef({first: 0, last: 12});
  const guideOffset = useRef(0);
  const halfHour = theme.isTV ? 240 : phoneChrome ? 90 : theme.width < 1024 ? 90 : 120;
  const channelWidth = theme.isTV ? 320 : tabletMedium ? 60 : compact ? 60 : landscape ? 180 : 192;
  // tablet-play6/7: 400 pt beside the expanded guide, 340 pt at medium width, and only when
  // the room left over still gives the guide a usable lane. A reported hinge band belongs
  // to neither side: the guide ends at its left edge and the pane starts after its right.
  const panelWidth = Math.max(0, Math.min(theme.width >= 1024 ? 400 : 340, contentWidth - channelWidth - 100));
  const paneLeft = creaseRight ?? Math.max(0, contentWidth - panelWidth), guideEnd = creaseLeft ?? paneLeft;
  const twoPane = !!selected && !theme.isTV && !phone && view === 'guide' && contentWidth > 0
    && guideEnd >= channelWidth + 100 && contentWidth - paneLeft >= 300;
  const width = Math.max(0, measuredWidth - insetLeft - (twoPane ? Math.max(0, contentWidth - guideEnd) : insetRight));
  const rowHeight = theme.isTV ? 92 : view === 'list' ? 100 : landscape ? 62 : 72, rowGap = theme.isTV ? 8 : phoneChrome ? 0 : 6, px = pxPerMsFor(halfHour), end = start + Math.max(halfHour, width - channelWidth) / px;
  useEffect(() => {void controller.loadSources(); const timer = setInterval(() => setNow(Date.now()), 30000); return () => clearInterval(timer);}, [controller]);
  const features = useMemo(() => new GuideFeatureClient(controller.api, controller.lifetime.authority.serverId), [controller]);
  useEffect(() => () => features.dispose(), [features]);
  useEffect(() => {
    if (!twoPane || Platform.OS !== 'android') return;
    const subscription = BackHandler.addEventListener('hardwareBackPress', () => {setSelected(undefined); return true;});
    return () => subscription.remove();
  }, [twoPane]);
  // A selected programme carries the guide's own later airings and this profile's reminders; both are server reads.
  useEffect(() => {
    if (!selected) {setLater([]); return;}
    let live = true;
    const raw = legacyChannel(selected.channel), at = Date.now();
    void features.reminders().then(value => {if (live) setReminders(new Map(value.items.map(item => [item.airing.programme.id, item])));}, () => {});
    if (raw) void features.airings({channelId: raw.id, sourceId: raw.sourceId, kind: raw.provenance, start: new Date(at).toISOString(), end: new Date(at + 12 * 3600e3).toISOString(), limit: 8})
      .then(page => {if (live) setLater(page.groups.flatMap(group => group.airings).filter(airing => airing.programme.id !== selected.program?.id).slice(0, 4));}, () => {});
    return () => {live = false;};
  }, [selected?.channel.id, selected?.program?.id, features]); // eslint-disable-line react-hooks/exhaustive-deps
  const remind = (airing: GuideAiring, existing: GuideReminder | undefined) => {
    const work = existing ? features.dismiss(existing).then(() => undefined) : features.remind(airing, 0);
    void work.then(value => {
      if (!controller.lifetime.current()) return;
      if (!existing && value) setReminders(current => new Map(current).set(value.airing.programme.id, value));
      if (existing) setReminders(current => {const next = new Map(current); next.delete(airing.programme.id); return next;});
    }).catch(error => {if (controller.lifetime.current()) runtime.reportError(error);});
  };
  const askSeries = async (channel: GuideChannelRow, programme: GuideProgram) => {
    const rawChannel = legacyChannel(channel), rawProgramme = legacyProgramme(programme);
    if (!rawChannel || !rawProgramme) return;
    let defaults: SeriesForm | undefined;
    try {defaults = seriesFormDefaults(await owner.dvrSettings());} catch {defaults = undefined;}
    if (!controller.lifetime.current()) return;
    setSeries({draft: {channel: rawChannel, programme: rawProgramme, series: true}, defaults});
  };
  useEffect(() => {controller.setViewport({firstRow: visible.current.first, lastRow: visible.current.last, start, end});}, [controller, guide, start, end]);
  const source = state.sources.find(value => (value.provenance === 'library-channel' ? 'library' : value.id) === state.options.sourceId);
  const selectedSources = useMemo(() => source ? [source] : state.sources, [source, state.sources]);
  const pan = useGuideTimePan({enabled: !theme.isTV && view === 'guide' && !recordingsOpen && !selected, revision: state.revision, start, end, pxPerMs: px, channelWidth, sources: selectedSources, commit: setStart, current: controller.lifetime.current});
  const panPosition = pan.position, panActive = pan.active;
  const rulerShift = useAnimatedStyle(() => ({transform: [{translateX: panActive ? start * px - panPosition.value : 0}]}), [panActive, start, px]);
  const nowShift = useAnimatedStyle(() => {
    const from = panActive ? panPosition.value / px : start;
    return {transform: [{translateX: panActive ? start * px - panPosition.value : 0}], opacity: now >= from && now < from + (end - start) ? 1 : 0};
  }, [panActive, start, end, px, now]);
  const nowPillShift = useAnimatedStyle(() => {
    const marker = (now - (panActive ? panPosition.value / px : start)) * px;
    return {left: Math.max(0, Math.min(marker - 30, width - channelWidth - 60)) - marker};
  }, [panActive, start, px, now, width, channelWidth]);
  const pastShade = useAnimatedStyle(() => ({width: Math.max(0, Math.min((now - (panActive ? panPosition.value / px : start)) * px, width - channelWidth))}), [panActive, start, px, now, width, channelWidth]);
  const earlierNow = useAnimatedStyle(() => ({display: now < (panActive ? panPosition.value / px : start) ? 'flex' : 'none'}), [panActive, start, px, now]);
  const laterNow = useAnimatedStyle(() => ({display: now >= (panActive ? panPosition.value / px + (end - start) : end) ? 'flex' : 'none'}), [panActive, start, end, px, now]);
  const overscan = panActive ? (end - start) / 2 : 0;
  const groups = [...new Set((source ? [source] : state.sources).flatMap(value => value.groups))];
  const {locale, hour12} = nativeGuideRegion(runtime.text);
  const clock = useMemo(() => nativeGuideClock(locale, state.options.timezone, hour12, theme.isTV), [locale, state.options.timezone, hour12, theme.isTV]);
  const goNow = () => setStart(floorTo(now, SLOT_MS) - (theme.isTV || phoneChrome ? SLOT_MS : 0));
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
  const chooseSource = (sourceId: string) => {
    const selectedSource = state.sources.find(value => (value.provenance === 'library-channel' ? 'library' : value.id) === sourceId);
    select({sourceId, kind: !selectedSource ? 'all' : selectedSource.provenance, group: undefined});
    list.current?.scrollToOffset({offset: 0, animated: false});
  };
  const sourceOptions = [{value: '', label: t('channels.all')}, ...state.sources.map(value => ({value: value.provenance === 'library-channel' ? 'library' : value.id, label: value.name}))];
  const sourceLabel = sourceOptions.find(option => option.value === state.options.sourceId)?.label;
  const sourcePicker = phoneChrome ? state.sources.length === 1 ? <View testID="live-source" style={{height: 34, borderWidth: 1, borderColor: theme.colors.lineStrong, borderRadius: 9, paddingHorizontal: 12, justifyContent: 'center'}}><Text style={[shellType(13.5, 700), {color: theme.colors.text}]}>{state.sources[0].name}</Text></View>
    : <NativeLivePhonePicker testID="live-source" accessibilityLabel={t('channels.source')} value={state.options.sourceId} options={sourceOptions.map(option => ({id: option.value, label: option.label}))} onChange={chooseSource} style={{height: 34, borderWidth: 1, borderColor: theme.colors.lineStrong, borderRadius: 9, paddingHorizontal: 12, gap: 8}}>{sourceLabel}</NativeLivePhonePicker>
    : <Select testID="live-source" accessibilityLabel={t('channels.source')} value={state.options.sourceId} options={sourceOptions} onValueChange={chooseSource}/>;
  const chooseDay = (day: string) => Number(day) === today ? goNow() : setStart(dayPrimeTime(Number(day), state.options.timezone));
  const shortDate = useMemo(() => nativeGuideDate(locale, state.options.timezone, {weekday: 'short', month: 'short', day: 'numeric'}), [locale, state.options.timezone]);
  const longDay = useMemo(() => nativeGuideDate(locale, state.options.timezone, {weekday: 'long'}), [locale, state.options.timezone]);
  const fullDate = useMemo(() => nativeGuideDate(locale, state.options.timezone, {weekday: 'long', month: 'short', day: 'numeric'}), [locale, state.options.timezone]);
  const dayName = (day: number) => day === today ? t('guide.today') : day === days[1] ? t('guide.tomorrow') : longDay(day);
  // The drawn menu prints the weekday only where the day's own name is not already the weekday.
  const dayTrailing = (day: number) => day === today || day === days[1] ? shortDate(day) : nativeGuideDate(locale, state.options.timezone, {month: 'short', day: 'numeric'})(day);
  const dayNoteTime = nativeGuideClock(locale, state.options.timezone, hour12, false)(dayPrimeTime(today, state.options.timezone));
  const dayNote = days.length > 1 && dayNoteTime ? t('guide.dayMenuNote', {time: dayNoteTime, day: longDay(days[days.length - 1])}) : undefined;
  const dayPicker = phoneChrome ? <NativeLivePhonePicker testID="live-day" accessibilityLabel={t('guide.day')} value={String(currentDay)} disabled={daysCount < 1} onChange={chooseDay}
    options={days.map(day => ({id: String(day), label: dayName(day), trailing: dayTrailing(day)}))} note={dayNote} style={{gap: 6}} menuWidth={252}>
      <Icon name="i-cal" size={17} color={theme.colors.textTertiary}/>
      <Text style={[shellType(13.5, 700), {color: theme.colors.text}]}>{dayName(currentDay)}</Text>
      {!landscape && <Text style={[shellType(13.5, 600), {color: theme.colors.textTertiary}]}>{shortDate(currentDay)}</Text>}
    </NativeLivePhonePicker>
    : <Select testID="live-day" accessibilityLabel={t('guide.day')} disabled={daysCount < 1} value={String(currentDay)} options={days.map(day => ({value: String(day), label: day === today ? t('guide.today') : fullDate(day)}))} onValueChange={chooseDay}/>;
  const sortOptions = [{value: 'number', label: t('channels.sortNumber')}, {value: 'name', label: t('channels.sortName')}];
  const chooseSort = (sort: string) => select({sort: sort as 'number' | 'name'});
  const sortPicker = phoneChrome ? <NativeLivePhonePicker testID="live-sort" accessibilityLabel={t('channels.sort')} value={state.options.sort ?? 'number'} options={sortOptions.map(option => ({id: option.value, label: option.label}))} onChange={chooseSort} placement="bottom-end" secondary>{sortOptions.find(option => option.value === state.options.sort)?.label}</NativeLivePhonePicker>
    : <Select testID="live-sort" accessibilityLabel={t('channels.sort')} value={state.options.sort ?? 'number'} options={sortOptions} onValueChange={chooseSort}/>;
  const hasRecordings = state.sources.some(value => value.recordAvailable);
  const controls = ids.surface('live.controls');
  const viewSwitch = <Segmented testID="live-view" variant="phone" style={{backgroundColor: theme.colors.raisedHigh, borderRadius: 10}} value={view} onValueChange={value => setView(value as 'list' | 'guide')} itemProps={item => ({accessibilityLabel: t(item.value === 'list' ? 'channels.viewList' : 'channels.viewGuide'), style: {height: 32, borderRadius: 8, paddingLeft: 9, paddingRight: 11}})} items={(['list', 'guide'] as const).map(value => ({value, label: <View style={{flexDirection: 'row', gap: 6, alignItems: 'center'}}><Icon name={value === 'list' ? 'i-list' : 'i-timeline'} size={16} color={view === value ? theme.colors.text : theme.colors.textTertiary}/><Text style={[shellType(13.5, 700), {color: view === value ? theme.colors.text : theme.colors.textTertiary}]}>{t(value === 'list' ? 'channels.viewList' : 'channels.viewGuide')}</Text></View>}))}/>;
  const filterChips = <FlatList horizontal data={groups} keyExtractor={group => group} showsHorizontalScrollIndicator={false} initialNumToRender={10} maxToRenderPerBatch={10} windowSize={3} style={{flexGrow: landscape ? 1 : 0, flex: landscape ? 1 : undefined, height: theme.isTV ? 64 : phoneChrome ? 34 : 44}} contentContainerStyle={{gap: theme.isTV ? 12 : phoneChrome ? 8 : 10, paddingHorizontal: compact ? 20 : 0}}
          ListHeaderComponent={<View style={{flexDirection: 'row', gap: theme.isTV ? 12 : phoneChrome ? 8 : 10}}>{phoneChrome && sourcePicker}<Chip style={phoneChrome ? {height: 34, borderRadius: 9, paddingHorizontal: 12} : undefined} textStyle={phoneChrome ? shellType(13.5, 700) : undefined} focusId="all" testID="live-filter-all" selected={!state.options.favorites && !state.options.group} onPress={() => select({favorites: false, group: undefined})}>{t('channels.filterAll')}</Chip><Chip style={phoneChrome ? {height: 34, borderRadius: 9, paddingHorizontal: 12} : undefined} textStyle={phoneChrome ? shellType(13.5, 700) : undefined} focusId="favorites" testID="live-filter-favorites" selected={state.options.favorites === true} onPress={() => select({favorites: !state.options.favorites, group: undefined})}>{t('channels.favorites')}</Chip></View>}
          renderItem={({item: group}) => <Chip style={phoneChrome ? {height: 34, borderRadius: 9, paddingHorizontal: 12} : undefined} textStyle={phoneChrome ? shellType(13.5, 700) : undefined} focusId={`group:${group}`} testID={`live-filter-${group}`} selected={state.options.group === group} onPress={() => select({group, favorites: false})}>{group}</Chip>}/>;
  useDestinationEntryFocus({visible: theme.isTV && !recordingsOpen && recordingsReturn > 0, intent: 'restore', revision: recordingsReturn}, {regionId: controls, childId: 'live-recordings'});
  const empty = !state.loading && state.sources.length === 0;
  const managesServer = ports.context.account.account.role === 'owner';
  if (ownerOpen) return <NativeLiveOwnerScreen controller={owner} recordings={recordings} ports={ports} runtime={runtime} initialAction={initialOwnerAction} onClose={() => {setInitialOwnerAction(undefined); setOwnerOpen(false); setRecordingsReturn(value => value + 1);}}/>;
  if (recordingsOpen) return <NativeRecordingsScreen controller={recordings} ports={ports} runtime={runtime} owner={owner} onGuide={() => {setRecordingsReturn(value => value + 1); setRecordingsOpen(false);}}/>;
  const programmeBody = selected ? <View style={{gap: 20}}>
        {selected.program && <ProgrammeDetails programme={selected.program} now={now} runtime={runtime}/>}
        {selected.channel.tuneAvailable && <Button ref={opener} testID="live-watch" icon="i-play" onPress={() => watch(selected.channel)}>{t(selected.program && selected.program.start <= now && selected.program.end > now ? 'guide.watchLive' : 'guide.watchChannel')}</Button>}
        {selected.channel.kind === 'live' && selected.channel.recordAvailable && selected.program && selected.program.end > now && <View style={{flexDirection: 'row', gap: 10}}>
          <Button style={{flex: 1}} ref={!selected.channel.tuneAvailable ? opener : undefined} variant="glass" testID="live-record" icon="i-rec" loading={recording} disabled={recording || !!selected.program.recording} onPress={() => {
            const channel = legacyChannel(selected.channel), programme = selected.program && legacyProgramme(selected.program);
            if (!channel || !programme) return;
            setRecording(true);
            void recordings.schedule({channel, programme, series: false}, defaultRecordingOptions).then(result => {
              if (!controller.lifetime.current() || !result) {if (controller.lifetime.current()) setRecordError(recordings.getSnapshot().error); return;}
              const receipt = result.value;
              setSelected(current => current?.channel.id === selected.channel.id && current.program?.id === selected.program?.id ? {...current, program: {...current.program!, recording: {id: receipt.id, state: receipt.state}}} : current);
              guide.invalidate();
            }, error => {if (controller.lifetime.current()) setRecordError(error);}).finally(() => {if (controller.lifetime.current()) setRecording(false);});
          }}>{t(selected.program.recording ? 'guide.recordingScheduled' : 'guide.record')}</Button>
          <Button style={{flex: 1}} variant="glass" testID="live-record-series" onPress={() => {if (selected.program) void askSeries(selected.channel, selected.program);}}>{t('guide.recordSeries')}</Button>
        </View>}
        {selected.channel.kind === 'live' && selected.program && selected.program.start > now && (() => {
          const channel = legacyChannel(selected.channel), programme = legacyProgramme(selected.program);
          if (!channel) return null;
          const airing = programme && {channel: {id: channel.id, sourceId: channel.sourceId, provenance: channel.provenance, generation: channel.generation, name: channel.name, number: channel.number, group: channel.group}, programme};
          const existing = reminders.get(selected.program!.id);
          return <Button variant="glass" testID="live-remind" icon={existing ? 'i-bell-f' : 'i-bell'} disabled={!airing} onPress={() => {if (airing) remind(airing, existing);}}>{t(existing ? 'guide.stopRemind' : 'guide.remind')}</Button>;
        })()}
        {later.length > 0 && <View style={{gap: 10}} testID="live-later">
          <Text style={[shellType(theme.isTV ? 22 : 13, 700), {color: theme.colors.text}]}>{t('guide.laterOn', {channel: selected.channel.name})}</Text>
          {later.map(airing => <View key={airing.programme.id} style={{flexDirection: 'row', alignItems: 'center', gap: 12, minHeight: theme.isTV ? 48 : 36}}>
            <Text style={[shellType(theme.isTV ? 20 : 12.5), {color: theme.colors.textSecondary, width: theme.isTV ? 90 : 62}]}>{clock(Date.parse(airing.programme.start))}</Text>
            <Text numberOfLines={1} style={[shellType(theme.isTV ? 22 : 14, 600), {color: theme.colors.text, flex: 1}]}>{airing.programme.title}</Text>
            <Focusable testID={`live-later-remind-${airing.programme.id}`} focusKind="button" accessibilityRole="button" accessibilityLabel={t(reminders.has(airing.programme.id) ? 'guide.stopRemind' : 'guide.remind')} onPress={() => remind(airing, reminders.get(airing.programme.id))} style={{width: 36, height: 36, alignItems: 'center', justifyContent: 'center'}}><Icon name={reminders.has(airing.programme.id) ? 'i-bell-f' : 'i-bell'} size={theme.isTV ? 24 : 18} color={reminders.has(airing.programme.id) ? theme.colors.accentStrong : theme.colors.textTertiary}/></Focusable>
            <Focusable testID={`live-later-open-${airing.programme.id}`} focusKind="button" accessibilityRole="button" accessibilityLabel={airing.programme.title} onPress={() => setSelected({channel: selected.channel, program: legacyProgram(airing.programme)})} style={{width: 36, height: 36, alignItems: 'center', justifyContent: 'center'}}><Icon name="i-info" size={theme.isTV ? 24 : 18} color={theme.colors.textTertiary}/></Focusable>
          </View>)}
          <Text style={[shellType(theme.isTV ? 18 : 12), {color: theme.colors.textTertiary}]}>{t('guide.reminderSet')}</Text>
        </View>}
        {recordError !== undefined && <StateView testID="live-record-error" {...runtime.error(recordError, () => setRecordError(undefined))}/>}
        {state.mutationError !== undefined && <StateView testID="live-channel-preference-error" {...runtime.error(state.mutationError, favorite)}/>}
  </View> : null;
  return <Screen title={!theme.isTV && !phoneChrome ? t('search.chip.liveTV') : undefined} style={theme.isTV ? {paddingTop: 56, paddingRight: 8} : phoneChrome ? {paddingTop: insets.top + (landscape ? 0 : 14)} : undefined}>
    <View ref={content} onLayout={event => {setMeasuredWidth(event.nativeEvent.layout.width); measureContent();}}
      style={{flex: 1, paddingLeft: insetLeft, paddingRight: twoPane ? Math.max(insetRight, contentWidth - guideEnd) : insetRight}}>
      {stackedHeader && <View style={{flexDirection: 'row', gap: 6, alignItems: 'center', paddingHorizontal: compact ? 20 : 0, marginBottom: 12, minHeight: 38}}>
        <Text accessibilityRole="header" style={[shellType(32, 800, 36.8, -.035), {color: theme.colors.text, flex: 1}]}>{t('search.chip.liveTV')}</Text>
        {viewSwitch}
        {hasRecordings && <Button testID="live-recordings" variant="icon" size="small" icon="i-rec" accessibilityLabel={t('recordings.title')} onPress={() => setRecordingsOpen(true)}/>}
        {managesServer && <Button testID="live-owner-open" variant="icon" size="small" icon="i-sliders" accessibilityLabel={t('settings.server.live')} onPress={() => setOwnerOpen(true)}/>}
      </View>}
      {landscape && <View style={{flexDirection: 'row', gap: 12, alignItems: 'center', height: 50, paddingTop: 6, marginBottom: 6}}><Text accessibilityRole="header" style={[shellType(24, 800, 'normal', -.035), {color: theme.colors.text}]}>{t('search.chip.liveTV')}</Text>{viewSwitch}{filterChips}{sortPicker}{hasRecordings && <Button testID="live-recordings" variant="icon" size="small" icon="i-rec" accessibilityLabel={t('recordings.title')} onPress={() => setRecordingsOpen(true)}/>}{managesServer && <Button testID="live-owner-open" variant="icon" size="small" icon="i-sliders" accessibilityLabel={t('settings.server.live')} onPress={() => setOwnerOpen(true)}/>}</View>}
      {!phoneChrome && <FocusRegion id={controls} orientation="horizontal" edges={{left: ids.rail}} style={{flexDirection: 'row', gap: theme.isTV ? 22 : 12, alignItems: 'center', marginBottom: theme.isTV ? 24 : 20, minHeight: theme.isTV ? 64 : undefined}}>
        {theme.isTV && <Text accessibilityRole="header" style={[shellType(44, 800, 'normal', -.03), {color: theme.colors.text, marginRight: 14}]}>{t('search.chip.liveTV')}</Text>}
        {sourcePicker}
        {!theme.isTV && <><Chip testID="live-view-list" selected={view === 'list'} onPress={() => setView('list')}>{t('channels.viewList')}</Chip><Chip testID="live-view-guide" selected={view === 'guide'} onPress={() => setView('guide')}>{t('channels.viewGuide')}</Chip></>}
        {dayPicker}
        <Button testID="live-now" variant="glass" size="small" onPress={goNow}>{t('guide.now')}</Button>
        {hasRecordings && <Button focusId="live-recordings" testID="live-recordings" variant="glass" size="small" icon="i-rec" onPress={() => setRecordingsOpen(true)}>{t('recordings.title')}</Button>}
        {!theme.isTV && sortPicker}
        {managesServer && <Button testID="live-owner-open" variant="glass" size="small" icon="i-sliders" onPress={() => setOwnerOpen(true)}>{t('settings.server.live')}</Button>}
      </FocusRegion>}
      {!landscape && <FocusRegion id={ids.surface('live.filters')} orientation="horizontal" edges={{left: ids.rail, up: controls}} style={{marginBottom: theme.isTV ? 38 : stackedHeader ? 8 : 30}}>
        {filterChips}
      </FocusRegion>}
      {stackedHeader && <View style={{flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8, paddingHorizontal: compact ? 20 : 0}}>{view === 'guide' ? dayPicker : <View style={{flexDirection: 'row', gap: 6, alignItems: 'center'}}><Text style={[shellType(13, 700), {color: theme.colors.text}]}>{t('guide.onNow')}</Text><Text style={[shellType(13), {color: theme.colors.textSecondary}]}>{clock(now)}</Text></View>}{sortPicker}</View>}
      {state.error !== undefined ? <StateView {...runtime.error(state.error, () => {void controller.loadSources();})}/> : empty ? <StateView testID="live-no-sources" title={t(managesServer ? 'web.live.empty.noSourcesOwnerTitle' : 'web.live.empty.noSourcesTitle')}
        body={t(managesServer ? 'next.states.setupLiveBody' : 'web.live.empty.noSourcesMember')}
        primaryAction={managesServer ? {id: 'add-source', label: t('next.states.addTVSource'), icon: 'i-plus', onPress: () => {setInitialOwnerAction('add'); setOwnerOpen(true);}}
          : {id: 'home', label: t('next.states.goHome'), onPress: () => runtime.onDestination({kind: 'home'})}}
        secondaryAction={managesServer ? {id: 'discover-tuners', label: t('next.states.findTuners'), icon: 'i-search', onPress: () => {setInitialOwnerAction('discover'); setOwnerOpen(true);}} : undefined}/> : <>
        <GestureDetector gesture={pan.gesture}><View style={{flex: 1}} accessibilityActions={panActive ? [{name: 'decrement', label: t('guide.earlier')}, {name: 'increment', label: t('guide.later')}] : undefined} onAccessibilityAction={event => {if (event.nativeEvent.actionName === 'decrement') pan.adjust(-4 * SLOT_MS); else if (event.nativeEvent.actionName === 'increment') pan.adjust(4 * SLOT_MS);}}>
        {view === 'guide' && <View style={{height: theme.isTV ? 50 : 30, flexDirection: 'row', marginLeft: landscape ? 0 : channelWidth}}>{landscape && <View style={{width: channelWidth, paddingLeft: 4}}>{dayPicker}</View>}<View style={{flex: 1, overflow: 'hidden'}}><Animated.View style={[{flex: 1}, rulerShift]}>{rulerTicks(start - overscan, end + overscan, px, state.options.timezone).map(tick => <View key={tick.atMs} style={{position: 'absolute', left: tick.x - overscan * px, height: theme.isTV ? 28 : 22, borderLeftWidth: 1, borderLeftColor: theme.colors.line}}><Text style={[shellType(theme.isTV ? 20 : 11), {marginLeft: 10, color: theme.colors.textSecondary}]}>{clock(tick.atMs)}</Text></View>)}</Animated.View></View></View>}
        <VirtualizedList ref={list} key={`${state.revision}:${view}`} data={null} getItem={(_, index) => index} getItemCount={() => data.total ?? 12} keyExtractor={index => String(index)} initialNumToRender={12} maxToRenderPerBatch={12} windowSize={5} removeClippedSubviews={false} getItemLayout={(_, index) => ({index, length: rowHeight + rowGap, offset: index * (rowHeight + rowGap)})}
          onLayout={() => list.current?.scrollToOffset({offset: guideOffset.current, animated: false})} onScroll={event => {guideOffset.current = event.nativeEvent.contentOffset.y;}} scrollEventThrottle={16}
          onViewableItemsChanged={({viewableItems}) => {const indices = viewableItems.map(value => value.index).filter((value): value is number => value !== null); if (!indices.length) return; visible.current = {first: Math.min(...indices), last: Math.max(...indices)}; controller.setViewport({firstRow: visible.current.first, lastRow: visible.current.last, start, end});}}
          renderItem={({item: index}) => <LiveRow panPosition={panPosition} panActive={panActive} laneWidth={width - channelWidth} clock={clock} entryEnabled={state.revision === 0 && recordingsReturn === 0} key={`${state.revision}:${index}`} index={index} controller={controller} runtime={runtime} start={start} end={end} now={now} channelWidth={channelWidth} rowHeight={rowHeight} px={px} list={view === 'list'} onOpen={open} rail={ids.rail} watch={watch}/>}/>
        {phone && view === 'guide' && <Animated.View pointerEvents="none" style={[{position: 'absolute', left: channelWidth, top: 30, bottom: 0}, pastShade]}><Svg width="100%" height="100%" accessible={false}><Defs><LinearGradient id={`${shadeId}-past`} x1="0" y1="0" x2="1" y2="0"><Stop offset="0" stopColor={theme.colors.ink} stopOpacity={.38}/><Stop offset="1" stopColor={theme.colors.ink} stopOpacity={.12}/></LinearGradient></Defs><Rect width="100%" height="100%" fill={`url(#${shadeId}-past)`}/></Svg></Animated.View>}
        {view === 'guide' && (inNowSpan || panActive) && <View pointerEvents="none" style={{position: 'absolute', left: channelWidth, right: 0, top: 0, bottom: theme.isTV ? 60 : 0, overflow: 'hidden'}}><Animated.View style={[{position: 'absolute', left: nowX, top: 0, bottom: 0, width: theme.isTV ? 3 : 2, backgroundColor: `${theme.colors.accentStrong}88`}, nowShift]}><Animated.View style={[{position: 'absolute', top: theme.isTV ? 0 : 4, width: 60, height: theme.isTV ? 30 : 22, alignItems: 'center', justifyContent: 'center', borderRadius: theme.isTV ? 6 : 4, backgroundColor: theme.colors.accentStrong}, nowPillShift]}><Text style={[shellType(theme.isTV ? 20 : 12, 800), {color: theme.colors.ink}]}>{clock(now)}</Text></Animated.View></Animated.View></View>}
        {phone && view === 'guide' && <>{(['earlier', 'later'] as const).map(direction => <Animated.View key={direction} style={[{position: 'absolute', top: 3, ...(direction === 'earlier' ? {left: channelWidth + 3} : {right: 3})}, direction === 'earlier' ? earlierNow : laterNow]}><Focusable testID={`live-docked-now-${direction}`} accessibilityRole="button" accessibilityLabel={t(direction === 'earlier' ? 'guide.nowEarlier' : 'guide.nowLater')} onPress={goNow} style={{height: 24, paddingHorizontal: 9, borderRadius: 12, backgroundColor: theme.colors.accentStrong, flexDirection: 'row', gap: 1, alignItems: 'center'}}>{direction === 'earlier' && <Icon name="i-left" size={14} color={theme.colors.ink}/>}<Text style={[shellType(12, 800), {color: theme.colors.ink}]}>{t('guide.now')}</Text>{direction === 'later' && <Icon name="i-right" size={14} color={theme.colors.ink}/>}</Focusable></Animated.View>)}</>}
        </View></GestureDetector>
        {data.channelsError && <StateView {...runtime.error(new Error('guide_channels_unavailable'), () => guide.reset())}/>}
      </>}
    </View>
    {twoPane && <View testID="live-programme-pane" style={{position: 'absolute', left: paneLeft, right: 0, top: 0, bottom: 0, backgroundColor: theme.colors.ink,
      borderLeftWidth: 1, borderLeftColor: theme.colors.line}}>
      <ScrollView contentContainerStyle={{padding: 20, gap: 18, paddingBottom: 48}}>
        <Text style={[shellType(24, 800, 'normal', -.03), {color: theme.colors.text}]}>{selected?.program?.title ?? selected?.channel.name ?? ''}</Text>
        {selected && <ProgrammeHeader channel={selected.channel} programme={selected.program} now={now} runtime={runtime} busy={state.mutating} onFavorite={favorite}/>}
        {programmeBody}
      </ScrollView>
    </View>}
    <Dialog open={selected !== undefined && !twoPane} onOpenChange={value => {if (!value) setSelected(undefined);}} title={selected?.program?.title ?? selected?.channel.name ?? ''} headerContext={selected && <ProgrammeHeader channel={selected.channel} programme={selected.program} now={now} runtime={runtime} busy={state.mutating} onFavorite={favorite}/>} placement={theme.isTV || landscape || theme.width >= 700 ? 'side' : undefined} width={theme.isTV ? 640 : landscape ? 376 : theme.width >= 700 ? 400 : undefined} initialFocusRef={selected?.channel.tuneAvailable || selected?.channel.recordAvailable && selected.program ? opener : undefined} returnFocusRef={selectedOpener} testID="live-programme">
      {programmeBody}
    </Dialog>
    <NativeSeriesRuleSheet controller={recordings} draft={series?.draft} defaults={series?.defaults} runtime={runtime} open={series !== undefined}
      onOpenChange={value => {if (!value) setSeries(undefined);}}
      onCreated={() => {setSelected(undefined); setSeries(undefined); guide.invalidate(); setToast({id: `series-${Date.now()}`, message: t('guide.seriesSet'), icon: 'i-rec'});}}/>
    <ToastHost toast={toast} onDismiss={() => setToast(null)} bottomOffset={phone ? 96 : 0}/>
  </Screen>;
}

function LiveRow({panPosition, panActive, laneWidth, clock, entryEnabled, index, controller, runtime, start, end, now, channelWidth, rowHeight, px, list, onOpen, rail, watch}: {panPosition: SharedValue<number>; panActive: boolean; laneWidth: number; clock: (at: number) => string | undefined; entryEnabled: boolean; index: number; controller: NativeLiveController; runtime: NativeShellRuntime; start: number; end: number; now: number; channelWidth: number; rowHeight: number; px: number; list: boolean; onOpen: (channel: GuideChannelRow, program?: GuideProgram, node?: View | null) => void; rail: string; watch: (channel: GuideChannelRow) => void}) {
  const theme = useTheme(), t = runtime.text.t, guide = controller.guide;
  useSyncExternalStore(listener => guide.subscribePage(guide.pageOf(index), listener), () => guide.getSnapshot().version);
  const overscan = panActive ? (end - start) / 2 : 0;
  const channel = guide.channelAt(index), programs = channel?.guide === 'none' ? {programs: [], complete: true, failed: false} : guide.programsFor(index, start - overscan, end + overscan);
  const shift = useAnimatedStyle(() => ({transform: [{translateX: panActive ? start * px - panPosition.value : 0}]}), [panActive, start, px]);
  const row = `${rail}.guide.${JSON.stringify([channel?.sourceId, channel?.id, controller.getSnapshot().revision])}`, column = `${row}.channel`, cellsRegion = `${row}.programmes`;
  const first = programs.programs.find(value => value.start <= now && value.end > now) ?? programs.programs[0];
  const compactChannel = !theme.isTV && channelWidth <= 80, landscapePhone = !theme.isTV && channelWidth === 180;
  const phoneGrid = compactChannel || landscapePhone, rowGap = theme.isTV ? 8 : phoneGrid ? 0 : 6;
  const cells = layoutRow(programs.programs, {viewStart: start - overscan, viewEnd: end + overscan, pxPerMs: px, now, gapPx: phoneGrid ? 2 : 6, tiers: theme.isTV ? {full: 300, title2: 150, title: 32} : {full: 50, title2: 50, title: 24}});
  const firstId = first?.id ?? (list ? 'now' : (programs.complete || programs.failed) && cells[0] ? `gap:${cells[0].start}` : undefined);
  const entry = useScreenEntry(theme.isTV && entryEnabled && index === 0 && channel && firstId ? {regionId: cellsRegion, childId: firstId} : undefined, controller.lifetime.current);
  const channelRef = useRef<View>(null), programRefs = useRef(new Map<string, View>());
  if (!channel) return <View style={{height: rowHeight, marginBottom: rowGap, backgroundColor: theme.colors.raised, opacity: .4, borderRadius: 12}}/>;
  const logo = runtime.artwork(channel.logoUrl);
  const current = nowNext(programs.programs, now), nextText = nativeGuideNext(current.next, clock, runtime.text);
  if (list && !theme.isTV) return <NativeLiveListRow channel={channel} programme={current.now} next={current.next} now={now} runtime={runtime} clock={clock} height={rowHeight} onOpen={node => onOpen(channel, current.now, node)}/>;
  return <View style={{height: rowHeight, marginBottom: rowGap, flexDirection: 'row', gap: theme.isTV ? 18 : phoneGrid ? 2 : 8}}>
    <FocusRegion id={column} entry="channel" edges={{left: rail, right: cellsRegion}} style={{width: channelWidth - (theme.isTV ? 18 : phoneGrid ? 2 : 8)}}>
      <Focusable ref={channelRef} focusId="channel" testID={`live-channel-${channel.sourceId}-${channel.id}`} accessibilityRole="button" accessibilityLabel={`${channel.number} ${channel.name}`} onPress={() => list ? onOpen(channel, current.now, channelRef.current) : theme.isTV ? watch(channel) : onOpen(channel, undefined, channelRef.current)} focusKind="row" style={{height: rowHeight, borderRadius: compactChannel ? 8 : 12, paddingHorizontal: phoneGrid ? 0 : 16, flexDirection: compactChannel ? 'column' : 'row', justifyContent: compactChannel ? 'center' : undefined, alignItems: 'center', gap: compactChannel ? 5 : landscapePhone ? 10 : 16, backgroundColor: phoneGrid ? 'transparent' : theme.colors.raised}}>
        <View style={{width: theme.isTV ? 56 : landscapePhone ? 32 : 36, height: theme.isTV ? 56 : landscapePhone ? 32 : 36}}><GuideChannelArt channel={channel} source={logo} size={theme.isTV ? 56 : landscapePhone ? 32 : 36}/>{compactChannel && channel.favorite && <View style={{position: 'absolute', right: -7, top: -6, width: 18, height: 18, borderRadius: 9, backgroundColor: theme.colors.ink, alignItems: 'center', justifyContent: 'center'}}><Icon name="i-star-f" size={10} color={theme.colors.accentStrong}/></View>}</View>
        <View style={{flex: compactChannel ? undefined : 1, alignItems: compactChannel ? 'center' : undefined}}>{!compactChannel && <View style={{flexDirection: 'row', alignItems: 'center', gap: 5}}><Text numberOfLines={2} style={[shellType(theme.isTV ? 22 : landscapePhone ? 12.5 : 13, 700), {color: theme.colors.text, flexShrink: 1}]}>{channel.name}</Text>{landscapePhone && channel.favorite && <Icon name="i-star-f" size={10} color={theme.colors.accentStrong}/>}</View>}<Text style={[shellType(theme.isTV ? 18 : 11), {color: theme.colors.textSecondary}]}>{channel.number}</Text></View>
      </Focusable>
    </FocusRegion>
    <FocusRegion id={cellsRegion} entry={first?.id} orientation="horizontal" edges={{left: column}} style={{flex: 1, overflow: 'hidden'}} onLayout={entry}>
      {list ? <Focusable ref={node => {if (node) programRefs.current.set('now', node);}} focusId={first?.id ?? 'now'} testID={`live-now-${channel.id}`} onPress={() => onOpen(channel, current.now, programRefs.current.get('now'))} style={{height: rowHeight, padding: 14, backgroundColor: theme.colors.raised, borderRadius: 12, gap: 8}}><ScreenText>{current.now?.title ?? t('guide.noInformation')}</ScreenText>{nextText && <Text style={[shellType(theme.isTV ? 20 : 12), {color: theme.colors.textSecondary}]}>{nextText}</Text>}</Focusable>
        : <Animated.View style={[{flex: 1}, shift]}>{cells.map(cell => <NativeLiveGuideCell key={cell.program?.id ?? `gap:${cell.start}`} cell={cell} gapLabel={runtime.text.t(channel.guide === 'none' ? 'guide.noGuide' : 'guide.noInformation')} loading={cell.kind === 'gap' && !programs.complete && !programs.failed} failed={cell.kind === 'gap' && programs.failed} retry={() => guide.invalidate()} left={cell.x - overscan * px + (phoneGrid ? 2 : 0)} laneWidth={laneWidth} panPosition={panPosition} panActive={panActive} start={start} now={now} px={px} rowHeight={rowHeight} compact={phoneGrid} clock={clock} runtime={runtime} testID={`live-programme-${channel.id}-${cell.program?.id ?? cell.start}`} refNode={node => {const id = cell.program?.id ?? `gap:${cell.start}`; if (node) programRefs.current.set(id, node); else programRefs.current.delete(id);}} onPress={() => onOpen(channel, cell.program, programRefs.current.get(cell.program?.id ?? `gap:${cell.start}`))}/>)}</Animated.View>}
    </FocusRegion>
  </View>;
}

function NativeLiveListRow({channel, programme, next, now, runtime, clock, height, onOpen}: {channel: GuideChannelRow; programme?: GuideProgram; next?: GuideProgram; now: number; runtime: NativeShellRuntime; clock: (at: number) => string | undefined; height: number; onOpen: (node: View | null) => void}) {
  const theme = useTheme(), node = useRef<View>(null), logo = runtime.artwork(channel.logoUrl), nextText = nativeGuideNext(next, clock, runtime.text);
  const remaining = programme && programmeFactParts({startMs: programme.start, endMs: programme.end}, runtime.text, now).find(fact => fact.id === 'remaining');
  const progress = programme && programme.end > programme.start ? Math.max(0, Math.min(1, (now - programme.start) / (programme.end - programme.start))) : undefined;
  return <Focusable ref={node} testID={`live-list-${channel.sourceId}-${channel.id}`} accessibilityRole="button" accessibilityLabel={[channel.name, programme?.title].filter(Boolean).join(' ')} onPress={() => onOpen(node.current)} focusKind="row" style={{height, paddingVertical: 12, paddingHorizontal: 20, flexDirection: 'row', gap: 14, borderBottomWidth: 1, borderBottomColor: theme.colors.line}}>
    <View style={{width: 46, alignItems: 'center', gap: 5}}>{(logo || channel.mark && channel.sourceId) && <View style={{width: 46, height: 46, borderRadius: 11, overflow: 'hidden'}}><GuideChannelArt channel={channel} source={logo} size={46}/></View>}<Text style={[shellType(11.5, 700), {color: theme.colors.textTertiary}]}>{channel.number}</Text></View>
    <View style={{flex: 1, minWidth: 0}}>
      <View style={{flexDirection: 'row', alignItems: 'center', gap: 8}}><Text numberOfLines={1} style={[shellType(12.5, 600), {color: theme.colors.textTertiary, flexShrink: 1}]}>{channel.name}</Text>{channel.favorite && <Icon name="i-star-f" size={10} color={theme.colors.accentStrong}/>}<ProgrammeFlags programme={programme} text={runtime.text}/>{remaining && <Text numberOfLines={1} style={[shellType(12.5), {color: theme.colors.textSecondary, marginLeft: 'auto'}]}>{remaining.text}</Text>}</View>
      <Text numberOfLines={1} style={[shellType(16, 700, 'normal', -.01), {color: theme.colors.text, marginTop: 3}]}>{programme?.title ?? runtime.text.t('guide.noInformation')}</Text>
      {progress !== undefined && <View style={{height: 3, borderRadius: 2, backgroundColor: theme.colors.lineStrong, marginTop: 8, overflow: 'hidden'}}><View style={{height: '100%', width: `${progress * 100}%`, backgroundColor: theme.colors.accentStrong}}/></View>}
      {nextText && <Text numberOfLines={1} style={[shellType(12.5), {color: theme.colors.textTertiary, marginTop: 7}]}>{nextText}</Text>}
    </View>
  </Focusable>;
}

function NativeLiveGuideCell({cell, gapLabel, loading, failed, retry, left, laneWidth, panPosition, panActive, start, now, px, rowHeight, compact, clock, runtime, testID, refNode, onPress}: {cell: GuideCell; gapLabel: string; loading: boolean; failed: boolean; retry: () => void; left: number; laneWidth: number; panPosition: SharedValue<number>; panActive: boolean; start: number; now: number; px: number; rowHeight: number; compact: boolean; clock: (at: number) => string | undefined; runtime: NativeShellRuntime; testID: string; refNode: (node: View | null) => void; onPress: () => void}) {
  const theme = useTheme(), fadeId = useId().replace(/:/g, ''), padding = theme.isTV ? 16 : compact ? 7 : 8;
  const gap = cell.kind === 'gap', narrow = compact && (cell.tier === 'title' || cell.tier === 'sliver');
  const background = !theme.isTV && gap ? 'transparent' : cell.state === 'now' ? theme.colors.raisedHigh : !theme.isTV && cell.state === 'past' ? alpha(theme.colors.raised, .5) : theme.colors.raised;
  const cellWidth = Math.max(0, cell.width - (compact ? 2 : 0)), clippedStart = cell.clippedStart, isTV = theme.isTV;
  const content = useAnimatedStyle(() => {
    const window = nativeGuideCellWindow(left, cellWidth, laneWidth, panActive ? start * px - panPosition.value : 0);
    return {transform: [{translateX: window.cutLeft}], width: Math.max(0, window.width - padding * 2)};
  }, [left, cellWidth, laneWidth, panActive, start, px, padding]);
  const clip = useAnimatedStyle(() => {
    const clipped = clippedStart || left + (panActive ? start * px - panPosition.value : 0) < 0;
    return {width: clipped ? isTV ? 20 : 10 : 0, opacity: clipped ? 1 : 0};
  }, [clippedStart, left, panActive, start, px, isTV]);
  if (loading) return <SkeletonBlock testID={`${testID}-loading`} width={cellWidth} height={rowHeight - (compact ? 6 : 0)} radius={compact ? 8 : 12} style={{position: 'absolute', left, top: compact ? 3 : 0}}/>;
  if (failed) return <Focusable ref={refNode} focusId={`gap:${cell.start}`} testID={`${testID}-error`} accessibilityRole="button" accessibilityLabel={runtime.text.t('guide.tileFailed')} onPress={retry} focusKind="row" style={{position: 'absolute', left, top: compact ? 3 : 0, width: cellWidth, height: rowHeight - (compact ? 6 : 0), borderRadius: compact ? 8 : 12, backgroundColor: theme.colors.raised}}><Animated.View style={[{position: 'absolute', left: padding, top: 0, bottom: 0, justifyContent: 'center'}, content]}><Text numberOfLines={2} style={[shellType(theme.isTV ? 20 : 12), {color: theme.colors.textTertiary}]}>{runtime.text.t('guide.tileFailed')}</Text></Animated.View></Focusable>;
  return <Focusable ref={refNode} focusId={cell.program?.id ?? `gap:${cell.start}`} testID={testID} accessibilityRole="button" accessibilityLabel={cell.program?.title ?? gapLabel} onPress={onPress} focusKind="row" style={{position: 'absolute', left, top: compact ? 3 : 0, width: cellWidth, height: rowHeight - (compact ? 6 : 0), borderRadius: compact ? 8 : 12, backgroundColor: background, borderWidth: !theme.isTV && gap ? 1 : 0, borderColor: theme.colors.line, overflow: 'hidden'}}>
    {!theme.isTV && gap && <View pointerEvents="none" style={{position: 'absolute', inset: 0}}><Svg width="100%" height="100%" accessible={false}><Defs><Pattern id={`${fadeId}-gap`} patternUnits="userSpaceOnUse" width={14} height={14} patternTransform="rotate(45)"><Rect width={7} height={14} fill={theme.colors.text} fillOpacity={.035}/></Pattern></Defs><Rect width="100%" height="100%" fill={`url(#${fadeId}-gap)`}/></Svg></View>}
    <Animated.View style={[{position: 'absolute', left: padding, top: 0, bottom: 0, justifyContent: 'center'}, content]}>
      <View style={{flexDirection: 'row', alignItems: 'flex-start'}}>{!theme.isTV && cell.program?.recording && <View style={{width: 7, height: 7, borderRadius: 4, marginTop: 4.5, marginRight: 5, backgroundColor: theme.colors.record}}/>}<Animated.View style={[{overflow: 'hidden'}, clip]}><Icon name="i-left" size={theme.isTV ? 16 : 10} color={theme.colors.textTertiary}/></Animated.View><Text numberOfLines={narrow ? 1 : 2} ellipsizeMode={narrow ? "tail" : "clip"} style={[shellType(theme.isTV ? 22 : gap ? 12.5 : narrow ? 12 : 13, gap && !theme.isTV ? 600 : 700), {color: !theme.isTV && (gap || cell.state === 'past') ? theme.colors.textTertiary : theme.colors.text, lineHeight: theme.isTV ? undefined : narrow ? 15 : 16, flexShrink: 1}]}>{cell.program?.title ?? gapLabel}</Text>{!theme.isTV && <View pointerEvents="none" style={{position: 'absolute', right: 0, top: 0, bottom: 0, width: 8}}><Svg width="100%" height="100%" accessible={false}><Defs><LinearGradient id={fadeId} x1="0" y1="0" x2="1" y2="0"><Stop offset="0" stopColor={background} stopOpacity="0"/><Stop offset="1" stopColor={background}/></LinearGradient></Defs><Rect width="100%" height="100%" fill={`url(#${fadeId})`}/></Svg></View>}</View>
      {(cell.tier === 'full' || cell.tier === 'title2') && <View style={{flexDirection: 'row', alignItems: 'center', gap: theme.isTV ? 12 : 5, marginTop: theme.isTV ? 8 : 3}}>
        <ProgrammeFlags programme={cell.program} grid text={runtime.text}/>
        {theme.isTV && cell.program?.recording && <View style={{width: 12, height: 12, borderRadius: 6, backgroundColor: theme.colors.record}}/>}
        {nativeProgrammeCaption(cell.program, cell.state === 'now', theme.isTV, clock, runtime.text).map((caption, captionIndex) => <Text key={captionIndex} numberOfLines={1} style={[shellType(theme.isTV ? 18 : 11.5), {color: !theme.isTV && cell.state === 'now' ? theme.colors.textSecondary : theme.colors.textTertiary, opacity: !theme.isTV && cell.state === 'past' ? .65 : 1, flexShrink: captionIndex ? 1 : 0, lineHeight: theme.isTV ? undefined : 14}]}>{caption}</Text>)}
      </View>}
    </Animated.View>
    {cell.kind === 'program' && cell.state === 'now' && <View style={{position: 'absolute', left: 0, right: 0, bottom: compact ? 0 : 8, height: 3, backgroundColor: alpha(theme.colors.text, .07)}}><View style={{height: '100%', width: nativeGuideElapsedWidth(left, cellWidth, (now - start) * px), backgroundColor: theme.colors.accentStrong}}/></View>}
  </Focusable>;
}

function ProgrammeFlags({programme, grid = false, text}: {programme?: GuideProgram; grid?: boolean; text: NativeShellRuntime['text']}) {
  const theme = useTheme(), t = text.t;
  const gridFlag = grid && !theme.isTV;
  return <>
    {programme?.flags?.live && <View style={{flexDirection: 'row', gap: 6, alignItems: 'center', ...(gridFlag ? {backgroundColor: alpha(theme.colors.record, .18), borderRadius: 4, paddingHorizontal: 5, paddingVertical: 1} : {})}}>
      {!gridFlag && <View style={{width: theme.isTV ? 8 : 7, height: theme.isTV ? 8 : 7, borderRadius: 4, backgroundColor: theme.colors.record}}/>}
      <Text style={[shellType(theme.isTV ? 18 : gridFlag ? 10.5 : 12, gridFlag ? 800 : 700), {color: gridFlag ? '#f9b1b1' : theme.colors.record, lineHeight: gridFlag ? 13 : undefined}]}>{t('guide.live')}</Text>
    </View>}
    {programme?.flags?.new && <Text style={[shellType(theme.isTV ? 18 : 10.5, theme.isTV ? 700 : 800), {paddingHorizontal: 5, paddingVertical: theme.isTV ? 0 : 1, borderRadius: 4, backgroundColor: theme.isTV ? theme.colors.accentStrong : theme.colors.accent, color: theme.colors.ink, lineHeight: theme.isTV ? undefined : 13}]}>{t('guide.new')}</Text>}
    {programme?.flags?.premiere && <Text style={[shellType(theme.isTV ? 18 : 10.5, theme.isTV ? 700 : 800), {color: theme.isTV ? theme.colors.textSecondary : theme.colors.accentStrong, ...(!theme.isTV ? {borderWidth: 1.5, borderColor: theme.colors.accentStrong, borderRadius: 4, paddingHorizontal: 5, lineHeight: 13} : {})}]}>{t('guide.premiere')}</Text>}
  </>;
}

function ProgrammeHeader({channel, programme, now, runtime, busy, onFavorite}: {channel: GuideChannelRow; programme?: GuideProgram; now: number; runtime: NativeShellRuntime; busy: boolean; onFavorite: () => void}) {
  const theme = useTheme(), t = runtime.text.t, logo = runtime.artwork(channel.logoUrl), onNow = programme && programme.start <= now && programme.end > now;
  return <View style={{flexDirection: 'row', alignItems: 'center', gap: theme.isTV ? 16 : 10, marginBottom: theme.isTV ? 32 : 16}}>
    {(logo || channel.mark && channel.sourceId) && <View style={{width: theme.isTV ? 56 : 34, height: theme.isTV ? 56 : 34, borderRadius: theme.isTV ? 10 : 7, overflow: 'hidden'}}><GuideChannelArt channel={channel} source={logo} size={theme.isTV ? 56 : 34}/></View>}
    <View style={{flex: 1, flexDirection: 'row', gap: 16, alignItems: 'center'}}><Text style={[shellType(theme.isTV ? 24 : 13, 700), {color: theme.colors.text}]}>{channel.name}</Text><Text style={[shellType(theme.isTV ? 22 : 13, 700), {color: theme.colors.textSecondary}]}>{channel.number}</Text></View>
    {(theme.isTV ? programme?.flags?.live : onNow) && <View style={{flexDirection: 'row', gap: 6, alignItems: 'center'}}><View style={{width: theme.isTV ? 8 : 7, height: theme.isTV ? 8 : 7, borderRadius: 4, backgroundColor: theme.colors.record}}/><Text style={[shellType(theme.isTV ? 22 : 12, 700), {color: theme.colors.record}]}>{t(theme.isTV ? 'guide.live' : 'guide.onNow')}</Text></View>}
    {!theme.isTV && <Focusable testID="live-channel-favorite" focusKind="button" accessibilityRole="button" accessibilityLabel={t(channel.favorite ? 'channels.removeFavorite' : 'channels.addFavorite')} accessibilityState={{selected: channel.favorite}} disabled={busy} onPress={onFavorite} style={{width: 44, height: 44, alignItems: 'center', justifyContent: 'center'}}><Icon name={channel.favorite ? 'i-star-f' : 'i-star'} size={20} color={channel.favorite ? theme.colors.accentStrong : theme.colors.textSecondary}/></Focusable>}
  </View>;
}

function GuideChannelArt({channel, source, size}: {channel: GuideChannelRow; source: ReturnType<NativeShellRuntime['artwork']>; size: number}) {
  const mark = channel.mark && channel.sourceId ? {...channel.mark, sourceId: channel.sourceId, id: channel.id} : undefined;
  return mark ? <ChannelMark mark={mark} source={source} size={size}/> : source ? <Artwork source={source} fit="contain"/> : null;
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
