import React, {useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore} from 'react';
import {FlatList, View, VirtualizedList, type NativeScrollEvent, type NativeSyntheticEvent, type RefreshControlProps} from 'react-native';
import {BLOCK_MS, HOUR_MS, SLOT_MS, floorTo, normalizePrograms, nowNext, type GuideChannelRow, type GuideDataSource, type GuideProgram} from '../../../../../packages/client-core/src/guide/index';
import {ALL, sourceName} from '../../app/channels';
import {Button, Focusable, ProgressBar, Sheet, Skeleton, StateView, Text, alpha, useEntryFocus, useTheme} from '../../ui';
import {ChannelLogo, ChannelName, channelA11y, channelDimmed, channelReason} from './parts';
import {episodeLine, useNow, type GuideFormat} from './format';
import {createNowStore, type NowStore} from './now-store';
import type {GuideActions} from './GuideGrid';

const OVERSCAN = 3;

/**
 * The List view (Spec §6, §7): one windowed row per channel with now / next and progress.
 * Phones open the channel's timeline from a row; TV and iPad open the program sheet.
 * The store's viewport follows the scroll, so only the rows near the screen are fetched.
 */
export function ChannelList({actions, onTimeline, refreshControl, header}: {actions: GuideActions; onTimeline?: (c: GuideChannelRow) => void; refreshControl?: React.ReactElement<RefreshControlProps>; header?: React.ReactElement}) {
  const {store} = actions;
  const {isTV} = useTheme();
  const snapshot = useSyncExternalStore(store.subscribe, store.getSnapshot);
  const total = snapshot.total ?? 0;
  // PERF-07: same store as the grid. This list never subscribes: only each on-air row's
  // `ListLiveMeta` below reads `now`, so a 30 s tick never re-renders rows.
  const nowStore = useMemo(() => createNowStore(30_000), []);
  useEffect(() => () => nowStore.dispose(), [nowStore]);
  const rowHeight = isTV ? 184 : 112;
  const [range, setRange] = useState({first: 0, last: 12});
  // Window from a non-reactive read: it moves on scroll/viewport renders, not on tick.
  // (The 30-minute slot boundary may lag a tick; the per-row progress below never does.)
  const anchor = nowStore.get();
  const start = floorTo(anchor, SLOT_MS) - HOUR_MS, end = start + 4 * HOUR_MS;
  useEffect(() => { store.setViewport({firstRow: Math.max(0, range.first - OVERSCAN), lastRow: Math.max(0, range.last + OVERSCAN), start, end}); }, [store, range.first, range.last, start, end]);
  const onScroll = useCallback((e: NativeSyntheticEvent<NativeScrollEvent>) => {
    const {contentOffset, layoutMeasurement} = e.nativeEvent;
    const first = Math.max(0, Math.floor(contentOffset.y / rowHeight));
    const last = Math.ceil((contentOffset.y + layoutMeasurement.height) / rowHeight);
    setRange(r => (r.first === first && r.last === last ? r : {first, last}));
  }, [rowHeight]);
  const claim = useEntryFocus(isTV && total > 0);
  return (
    <VirtualizedList<number>
      data={total}
      getItemCount={n => n as number}
      getItem={(_, i) => i}
      keyExtractor={i => String(i)}
      getItemLayout={(_, i) => ({length: rowHeight, offset: rowHeight * i, index: i})}
      initialNumToRender={isTV ? 7 : 10}
      windowSize={5}
      onScroll={onScroll}
      scrollEventThrottle={64}
      refreshControl={refreshControl}
      ListHeaderComponent={header}
      renderItem={({item: row}) => <ListRowView row={row} actions={actions} nowStore={nowStore} start={start} end={end} height={rowHeight} preferFocus={claim && row === 0} onTimeline={onTimeline} />}
    />
  );
}

const ListRowView = React.memo(function ListRowView({row, actions, nowStore, start, end, height, preferFocus, onTimeline}: {row: number; actions: GuideActions; nowStore: NowStore; start: number; end: number; height: number; preferFocus: boolean; onTimeline?: (c: GuideChannelRow) => void}) {
  const {store, format} = actions;
  const {colors, space, isTV, metrics} = useTheme();
  const t = format.t;
  useSyncExternalStore(useCallback(fn => store.subscribePage(store.pageOf(row), fn), [store, row]), () => store.getSnapshot().version);
  const channel = store.channelAt(row);
  const logo = isTV ? 88 : 48;
  const pad = {paddingHorizontal: space.page, paddingVertical: space.sm};
  // Every hook before the placeholder return: a row renders first as a placeholder, then with
  // its channel, and the hook order must not change between those renders. The layout reads below
  // are store reads, not hooks, so they run before the return too.
  const laid = channel && channel.guide !== 'none' ? store.programsFor(row, start, end) : {programs: [] as GuideProgram[], complete: true};
  const current = channel ? nowNext(laid.programs, nowStore.get()).now : undefined;
  const open = useCallback(() => { if (channel) { if (onTimeline && !isTV) onTimeline(channel); else actions.onOpen({channel, program: current}); } }, [onTimeline, isTV, channel, actions, current]);
  const openMenu = useCallback(() => { if (channel) actions.onChannelMenu(channel); }, [actions, channel]);
  const watch = useCallback(() => { if (channel) actions.onWatch(channel); }, [actions, channel]);
  if (!channel) {
    return <View style={[{height, flexDirection: 'row', alignItems: 'center', gap: space.md}, pad]}><Skeleton width={logo} height={logo} /><View style={{flex: 1, gap: space.xs}}><Skeleton height={isTV ? 22 : 14} width="50%" /><Skeleton height={isTV ? 18 : 12} width="70%" /></View></View>;
  }
  const {programs, complete} = laid;
  // Layout from a non-reactive read; the live progress + "left" line below subscribes on its own.
  const nn = nowNext(programs, nowStore.get());
  const next = nn.next;
  const reason = channelReason(channel, actions.quiet);
  const showSource = actions.entry === ALL;
  const label = [channelA11y(channel, actions.quiet), current ? `${current.title}, ${format.range(current.start, current.end)}` : complete ? t('guide.noGuide') : '', next ? t('guide.next', {title: next.title, time: format.clock(next.start)}) : ''].filter(Boolean).join('. ');
  const body = (
    <View style={{flex: 1, flexDirection: 'row', alignItems: 'center', gap: space.md, minWidth: 0}}>
      <ChannelLogo channel={channel} size={logo} />
      <View style={{flex: 1, minWidth: 0, gap: isTV ? 6 : 3}}>
        <ChannelName channel={channel} variant={isTV ? 'subheading' : 'bodyStrong'} prefix={channel.number || undefined} />
        {showSource ? <Text variant="caption" tone="tertiary" lines={1}>{sourceName(actions.sources, channel.sourceId)}</Text> : null}
        {current ? (
          <>
            <Text variant={isTV ? 'body' : 'caption'} tone="secondary" lines={1}>{[current.title, episodeLine(current), format.range(current.start, current.end)].filter(Boolean).join(' · ')}</Text>
            <ListLiveMeta nowStore={nowStore} format={format} program={current} progress={nn.progress} />
          </>
        ) : <Text variant={isTV ? 'body' : 'caption'} tone="tertiary" lines={1}>{complete ? t('guide.noGuide') : ' '}</Text>}
        {next ? <Text variant="caption" tone="tertiary" lines={1}>{t('guide.next', {title: next.title, time: format.clock(next.start)})}</Text> : null}
        {/* The reason is in the row's hint and the sheet; the row shows it only when it has nothing else to say. */}
        {reason && !current && !next ? <Text variant="caption" tone="tertiary" lines={1}>{reason}</Text> : null}
      </View>
    </View>
  );
  return (
    <View style={[{height, flexDirection: 'row', alignItems: 'center', gap: space.sm, borderBottomWidth: 1, borderBottomColor: colors.lineSoft, opacity: channelDimmed(channel, actions.quiet) ? 0.6 : 1}, pad]}>
      <Focusable accessibilityRole="button" accessibilityLabel={label} accessibilityHint={reason || undefined} radius={metrics.radius.control} scale={isTV ? 1.02 : 1} hasTVPreferredFocus={preferFocus} style={{flex: 1, minWidth: 0, alignSelf: 'stretch', justifyContent: 'center', paddingHorizontal: isTV ? space.sm : 0}} onPress={open} onLongPress={openMenu}>
        {body}
      </Focusable>
      {/* §6: a Watch button on the row starts the channel directly. */}
      {channel.tuneAvailable ? <Button variant="ghost" round icon="play" accessibilityLabel={t('channels.watchChannel', {channel: channel.name})} onPress={watch} /> : null}
      {!isTV ? <Button variant="ghost" round icon="moreVertical" accessibilityLabel={t('channels.moreFor', {channel: channel.name})} onPress={openMenu} /> : null}
    </View>
  );
});

/** PERF-07: the one `now` reader in a list row: progress + "left" for the on-air program. */
const ListLiveMeta = React.memo(function ListLiveMeta({nowStore, format, program, progress}: {nowStore: NowStore; format: GuideFormat; program: GuideProgram; progress: number}) {
  const {space, isTV} = useTheme();
  const now = useSyncExternalStore(nowStore.subscribe, nowStore.getSnapshot);
  void progress;
  const value = Math.max(0, Math.min(1, (now - program.start) / Math.max(1, program.end - program.start)));
  return (
    <View style={{flexDirection: 'row', alignItems: 'center', gap: space.sm}}>
      <ProgressBar value={value} height={isTV ? 6 : 3} style={{flex: 1, maxWidth: isTV ? 360 : 160}} />
      <Text variant="caption" tone="tertiary">{format.timeLeft(program.end - now)}</Text>
    </View>
  );
});

type TimelineItem = {kind: 'day'; day: number} | {kind: 'program'; program: GuideProgram};

/**
 * A channel's timeline on phones (§6): its programs from an hour ago onward, grouped by day, opened
 * scrolled to the one on now. Windowed by time: blocks are read as the list nears its end.
 */
export function ChannelTimeline({channel, source, format, range, onClose, onOpen, onWatch}: {channel: GuideChannelRow | null; source: GuideDataSource; format: GuideFormat; range: {start: number; end: number}; onClose: () => void; onOpen: (p: GuideProgram) => void; onWatch: (c: GuideChannelRow) => void}) {
  const {colors, space} = useTheme();
  const t = format.t;
  const now = useNow();
  const [programs, setPrograms] = useState<GuideProgram[]>([]);
  const [until, setUntil] = useState(0);
  const [loading, setLoading] = useState(false);
  const [failed, setFailed] = useState(false);
  const from = floorTo(Date.now() - HOUR_MS, BLOCK_MS);
  const controller = useRef<AbortController | null>(null);
  const load = useCallback((start: number, blocks: number) => {
    if (!channel) return;
    const end = Math.min(range.end, start + blocks * BLOCK_MS);
    if (end <= start) return;
    controller.current?.abort();
    const c = new AbortController();
    controller.current = c;
    setLoading(true);
    setFailed(false);
    // One block at a time (each is a walk of today's guide pages), showing what has arrived; a
    // failure keeps the blocks already read and offers Try again for the rest.
    void (async () => {
      let b = start;
      try {
        for (; b < end; b += BLOCK_MS) {
          const list = (await source.programs([channel.id], b, b + BLOCK_MS, c.signal))[channel.id] ?? [];
          if (c.signal.aborted) return;
          setPrograms(prev => normalizePrograms([...prev, ...list]).filter(p => p.end > Date.now() - HOUR_MS));
          setUntil(b + BLOCK_MS);
        }
        setLoading(false);
      } catch {
        if (!c.signal.aborted) { setUntil(b); setLoading(false); setFailed(true); }
      }
    })();
  }, [channel, source, range.end]);
  useEffect(() => { setPrograms([]); setUntil(0); if (channel) load(from, 8); return () => controller.current?.abort(); }, [channel?.id]); // eslint-disable-line react-hooks/exhaustive-deps
  const items = useMemo<TimelineItem[]>(() => {
    const out: TimelineItem[] = [];
    let day = '';
    for (const p of programs) {
      const key = format.dayKey(p.start);
      if (key !== day) { day = key; out.push({kind: 'day', day: p.start}); }
      out.push({kind: 'program', program: p});
    }
    return out;
  }, [programs, format]);
  const header = 44, rowH = 76;
  const offsets = useMemo(() => { const o: number[] = []; let y = 0; for (const it of items) { o.push(y); y += it.kind === 'day' ? header : rowH; } return o; }, [items]);
  const list = useRef<FlatList<TimelineItem>>(null);
  const scrolled = useRef('');
  useEffect(() => {
    if (!channel || scrolled.current === channel.id || !items.length) return;
    const index = items.findIndex(it => it.kind === 'program' && it.program.end > Date.now());
    if (index < 0) return;
    scrolled.current = channel.id;
    requestAnimationFrame(() => list.current?.scrollToIndex({index: Math.max(0, index - 1), animated: false}));
  }, [items, channel]);
  // Kept mounted while it closes, so the sheet animates out before another overlay opens.
  const shown = useRef(channel);
  if (channel) shown.current = channel;
  const ch = shown.current;
  if (!ch) return null;
  return (
    <Sheet open={!!channel} onClose={onClose} title={ch.name} subtitle={ch.number || undefined} detent="full" scroll={false} primary={ch.tuneAvailable ? {label: t('channels.watch'), onPress: () => { onClose(); onWatch(ch); }} : undefined} cancelLabel={null}>
      {programs.length === 0 && loading ? (
        <View style={{gap: space.sm, padding: space.md}}>{[0, 1, 2, 3].map(i => <Skeleton key={i} height={rowH - space.sm} />)}</View>
      ) : programs.length === 0 ? (
        <StateView icon="calendar" title={failed ? t('guide.tileFailed') : t('guide.noGuide')} action={failed ? t('action.tryAgain') : undefined} onAction={failed ? () => load(from, 8) : undefined} />
      ) : (
        <FlatList
          ref={list}
          data={items}
          keyExtractor={it => (it.kind === 'day' ? `d${it.day}` : it.program.id)}
          getItemLayout={(_, i) => ({length: items[i]?.kind === 'day' ? header : rowH, offset: offsets[i] ?? 0, index: i})}
          onScrollToIndexFailed={() => {}}
          onEndReachedThreshold={0.5}
          onEndReached={() => { if (!loading && until < range.end) load(until, 4); }}
          ListFooterComponent={loading ? <View style={{padding: space.md}}><Skeleton height={rowH - space.sm} /></View> : failed ? <Button variant="ghost" label={t('action.tryAgain')} onPress={() => load(until || from, 4)} /> : null}
          renderItem={({item}) => {
            if (item.kind === 'day') {
              return <View style={{height: header, justifyContent: 'flex-end', paddingHorizontal: space.md, paddingBottom: space.xs, backgroundColor: colors.overlaySurface}}><Text variant="label" tone="tertiary">{format.dayLabel(item.day, now)}</Text></View>;
            }
            const p = item.program;
            const onNow = p.start <= now && p.end > now;
            const past = p.end <= now;
            return (
              <Focusable accessibilityRole="button" accessibilityLabel={[format.range(p.start, p.end), p.title, onNow ? t('guide.onNowLeft', {count: format.minutes(p.end - now)}) : ''].filter(Boolean).join(', ')} style={{height: rowH, flexDirection: 'row', alignItems: 'center', gap: space.md, paddingHorizontal: space.md, backgroundColor: onNow ? alpha(colors.accent, 0.12) : undefined, borderBottomWidth: 1, borderBottomColor: colors.lineSoft}} onPress={() => onOpen(p)}>
                <Text variant="captionStrong" tone={past ? 'tertiary' : 'secondary'} style={{width: 72}}>{format.clock(p.start)}</Text>
                <View style={{flex: 1, minWidth: 0, gap: 2}}>
                  <Text variant="bodyStrong" tone={past ? 'tertiary' : undefined} lines={1}>{p.title}</Text>
                  {episodeLine(p) ? <Text variant="caption" tone="tertiary" lines={1}>{episodeLine(p)}</Text> : null}
                  {onNow ? <View style={{flexDirection: 'row', alignItems: 'center', gap: space.sm}}><ProgressBar value={(now - p.start) / (p.end - p.start)} height={3} style={{flex: 1, maxWidth: 140}} /><Text variant="caption" tone="tertiary">{format.timeLeft(p.end - now)}</Text></View> : null}
                </View>
                {p.recording ? <View style={{width: 8, height: 8, borderRadius: 4, backgroundColor: colors.record}} /> : null}
              </Focusable>
            );
          }}
        />
      )}
    </Sheet>
  );
}
