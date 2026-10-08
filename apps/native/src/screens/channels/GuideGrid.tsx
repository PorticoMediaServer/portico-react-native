import React, {useCallback, useEffect, useImperativeHandle, useMemo, useRef, useState, useSyncExternalStore, forwardRef} from 'react';
import {ScrollView, TVFocusGuideView, View, useTVEventHandler} from 'react-native';
import {HOUR_MS, dayStarts, focusTarget, layoutRow, localDayStart, neighbor, nowX, pxPerMsFor, rulerTicks, spanAt, type ChannelSource, type GuideCell, type GuideChannelRow, type GuideProgram, type GuideWindowStore} from '../../../../../packages/client-core/src/guide/index';
import {dayPrimeTime, stripDays} from '../../../../../packages/client-core/src/channel-guide';
import {ALL, sourceName} from '../../app/channels';
import {Button, Chip, ChipBar, Focusable, Menu, Skeleton, Text, alpha, useEntryFocus, useTheme, type FocusableHandle} from '../../ui';
import {ChannelLogo, ChannelName, channelA11y, channelDimmed, channelReason} from './parts';
import {episodeLine, type GuideFormat, type GuideGeometry} from './format';
import {createNowStore, type NowStore} from './now-store';

export type Selection = {channel: GuideChannelRow; program?: GuideProgram};
/** What the guide and list views share with the screen. */
export type GuideActions = Readonly<{
  store: GuideWindowStore;
  format: GuideFormat;
  sources: readonly ChannelSource[];
  entry: string;
  onOpen: (s: Selection) => void;
  onWatch: (c: GuideChannelRow) => void;
  onChannelMenu: (c: GuideChannelRow) => void;
  /** FEAT-01: the server can't play channels at all; the screen says so once, rows don't. */
  quiet: boolean;
}>;

const OVERSCAN = 3;
const LEAD = 0.25;

/** A row's cells in the span. While blocks are loading only real programs are drawn (a hole isn't "No information" yet). */
function rowCells(store: GuideWindowStore, row: number, viewStart: number, viewEnd: number, now: number, g: GuideGeometry): GuideCell[] {
  const channel = store.channelAt(row);
  if (!channel) return [];
  const opts = {viewStart, viewEnd, pxPerMs: pxPerMsFor(g.column), now, gapPx: g.gap, tiers: g.tiers};
  if (channel.guide === 'none') return layoutRow([], opts);
  const {programs, complete} = store.programsFor(row, viewStart, viewEnd);
  const cells = layoutRow(programs, opts);
  return complete ? cells : cells.filter(c => c.kind === 'program');
}

function cellLabel(format: GuideFormat, cell: GuideCell, channel: GuideChannelRow, now: number, quiet: boolean): string {
  const t = format.t;
  const p = cell.program;
  const flags = p?.flags ?? {};
  return [
    t('guide.cellTime', {start: format.clock(cell.start), end: format.clock(cell.end)}),
    p ? p.title : t('guide.noInformation'),
    channel.name,
    flags.live ? t('guide.live') : '', flags.new ? t('guide.new') : '', flags.premiere ? t('guide.premiere') : '',
    cell.state === 'now' && p ? t('guide.onNowLeft', {count: format.minutes(cell.end - now)}) : '',
    p?.recording ? t('guide.recordingScheduled') : '',
    channelReason(channel, quiet),
  ].filter(Boolean).join(', ');
}

export type GuideGridHandle = {focusGrid: () => void};

/**
 * The guide grid (Spec §3, §4) for wide layouts: TV, iPad, landscape phone.
 *
 * O(visible) in both axes: the store holds the tiles near the viewport, and only the visible rows
 * (plus a few) and the cells intersecting the span are mounted.
 *
 * TV (§4): the grid is one focus region: a single focusable over the lanes whose focused cell is
 * drawn by the grid. Up/Down move channel by channel at the kept focus time (`focusTarget`), so a
 * long movie never pulls focus sideways; Left/Right walk the row and move time at the edges; the
 * row stays in the middle third; Up from the first row goes to the controls; Left never opens the
 * rail (Menu does). Touch: rows scroll natively, cells are tapped, and time moves by the controls.
 */
export const GuideGrid = forwardRef<GuideGridHandle, {actions: GuideActions; geometry: GuideGeometry; range: {start: number; end: number}; width: number; height: number; controlsTop?: React.RefObject<FocusableHandle | null>; paused?: boolean}>(function GuideGrid({actions, geometry: g, range, width, height, controlsTop, paused}, ref) {
  const {store, format} = actions;
  const {space, isTV, motion} = useTheme();
  const t = format.t;
  const snapshot = useSyncExternalStore(store.subscribe, store.getSnapshot);
  const total = snapshot.total ?? 0;
  // PERF-07: `now` lives in a tiny store. This grid never subscribes: only the now-line
  // (and its ruler tab) and one `LiveProgress` child per on-air block read it, so a 30 s
  // tick never re-renders rows. Layout uses a non-reactive read (`get()`) at render time.
  const nowStore = useMemo(() => createNowStore(30_000), []);
  useEffect(() => () => nowStore.dispose(), [nowStore]);
  const pxPerMs = pxPerMsFor(g.column);
  const laneWidth = Math.max(g.column, width - g.channel);
  const spanMs = laneWidth / pxPerMs;
  const clampStart = useCallback((start: number) => Math.max(range.start, Math.min(start, range.end - spanMs)), [range, spanMs]);
  const [viewStart, setViewStart] = useState(() => spanAt(Date.now(), spanMs, LEAD).start);
  const viewEnd = viewStart + spanMs;
  const controlsH = isTV ? 88 : 48;
  const bodyH = Math.max(g.row, height - g.ruler - controlsH);
  const [top, setTop] = useState(0);
  const firstRow = Math.max(0, Math.floor(top / g.row) - OVERSCAN);
  const lastRow = Math.max(firstRow, Math.min(total - 1, Math.ceil((top + bodyH) / g.row) + OVERSCAN));
  useEffect(() => { if (width > 0) store.setViewport({firstRow, lastRow: Math.max(firstRow, lastRow), start: viewStart, end: viewEnd}); }, [store, width, firstRow, lastRow, viewStart, viewEnd]);
  // The width arrives with layout: put now at 25% of the span once (§3.4).
  const placed = useRef(false);
  useEffect(() => { if (width > 0 && !placed.current) { placed.current = true; setViewStart(clampStart(spanAt(Date.now(), spanMs, LEAD).start)); } }, [width, spanMs, clampStart]);

  const jumpTo = useCallback((anchor: number, lead = LEAD) => setViewStart(clampStart(spanAt(anchor, spanMs, lead).start)), [clampStart, spanMs]);
  const shift = useCallback((ms: number) => setViewStart(v => clampStart(v + ms)), [clampStart]);

  // ── TV focus (§4) ──
  const [focus, setFocus] = useState<{row: number; time: number}>(() => ({row: 0, time: Date.now()}));
  const live = useRef({focus, viewStart, viewEnd, total, top});
  live.current = {focus, viewStart, viewEnd, total, top};
  const gridFocused = useRef(false);
  const [hasFocus, setHasFocus] = useState(false);
  const grid = useRef<FocusableHandle>(null);
  useImperativeHandle(ref, () => ({focusGrid: () => grid.current?.focus()}), []);
  const claim = useEntryFocus(isTV && total > 0);
  useEffect(() => { if (claim) grid.current?.focus(); }, [claim]);

  const follow = useCallback((row: number) => {
    // The focused row stays in the middle third; scrolls by row, never by page.
    setTop(prev => {
      const y = row * g.row;
      let next = prev;
      if (y < prev + bodyH / 3) next = y - bodyH / 3;
      else if (y + g.row > prev + (2 * bodyH) / 3) next = y + g.row - (2 * bodyH) / 3;
      const max = Math.max(0, live.current.total * g.row - bodyH);
      return Math.max(0, Math.min(max, Math.round(next / g.row) * g.row));
    });
  }, [g.row, bodyH]);

  const moveRow = useCallback((delta: number) => {
    const {focus: f, total: n} = live.current;
    const row = Math.max(0, Math.min(n - 1, f.row + delta));
    if (row === f.row) { if (delta < 0) controlsTop?.current?.focus(); return; }
    setFocus({row, time: f.time});
    follow(row);
  }, [follow, controlsTop]);

  const moveTime = useCallback((dir: -1 | 1) => {
    const {focus: f, viewStart: vs, viewEnd: ve} = live.current;
    const cells = rowCells(store, f.row, vs, ve, Date.now(), g);
    const span = ve - vs;
    if (!cells.length) { const step = dir * 2 * HOUR_MS; setViewStart(v => clampStart(v + step)); setFocus({row: f.row, time: f.time + step}); return; }
    const index = focusTarget(cells, f.time);
    const next = neighbor(cells, index, dir);
    if (next >= 0) {
      const cell = cells[next]!;
      const time = Math.max(cell.start, vs);
      // A cell starting in the last quarter is brought to 25% so it isn't focused as a sliver.
      if (dir > 0 && cell.start > vs + span * 0.75) setViewStart(clampStart(cell.start - span * LEAD));
      setFocus({row: f.row, time});
      return;
    }
    // At the edge of the span: time moves (no traps), within the published range.
    if (dir > 0) {
      const time = cells[index]!.end;
      if (time >= range.end) return;
      setViewStart(clampStart(time - span * LEAD));
      setFocus({row: f.row, time});
    } else {
      if (vs <= range.start) return;
      const time = Math.max(range.start, cells[index]!.start - 1);
      setViewStart(clampStart(time - span * (1 - LEAD)));
      setFocus({row: f.row, time});
    }
  }, [store, g, clampStart, range]);

  const focusedCell = useCallback((): {channel?: GuideChannelRow; cell?: GuideCell} => {
    const {focus: f, viewStart: vs, viewEnd: ve} = live.current;
    const channel = store.channelAt(f.row);
    const cells = rowCells(store, f.row, vs, ve, Date.now(), g);
    const i = focusTarget(cells, f.time);
    return {channel, cell: i >= 0 ? cells[i] : undefined};
  }, [store, g]);

  useTVEventHandler(event => {
    if (!isTV || !gridFocused.current || paused) return;
    const type = event.eventType;
    const act = (event as {eventKeyAction?: number}).eventKeyAction;
    const tap = act == null || act === 1;
    const hold = act == null || act === 0;
    if (type === 'up' && tap) moveRow(-1);
    else if (type === 'down' && tap) moveRow(1);
    else if (type === 'left' && tap) moveTime(-1);
    else if (type === 'right' && tap) moveTime(1);
    else if ((type === 'longLeft' || type === 'longRight') && hold) { const step = (type === 'longLeft' ? -2 : 2) * HOUR_MS; shift(step); setFocus(f => ({row: f.row, time: f.time + step})); }
    else if (type === 'playPause' && tap) { jumpTo(Date.now()); setFocus(f => ({row: f.row, time: Date.now()})); }
  });

  // ── Ruler, now line, days ──
  // PERF-07: the grid never reads `now` itself. The ruler (ticks + Now tab), the vertical
  // now-line and the Now button subscribe below; rows read a stale `get()` for layout only.
  // Guide.days (today counts as 1, at most 31) offers exactly those days when the server sends
  // it; otherwise the picker falls back to the available range (7 days).
  const guideDays = useMemo(() => {
    const scoped = actions.entry === ALL ? actions.sources : actions.sources.filter(x => x.id === actions.entry);
    const present = scoped.map(x => x.guideDays).filter((d): d is number => d !== undefined);
    return present.length ? Math.max(...present) : undefined;
  }, [actions.sources, actions.entry]);
  const days = useMemo(() => {
    if (guideDays !== undefined && guideDays >= 1) return stripDays(Date.now(), format.zone, guideDays);
    return dayStarts(range.start, range.end, format.zone);
  }, [guideDays, range.start, range.end, format.zone]);
  const currentDay = localDayStart(viewStart + spanMs * LEAD, format.zone);
  const [dayMenu, setDayMenu] = useState(false);
  const canEarlier = viewStart > range.start, canLater = viewEnd < range.end;

  const a11y = hasFocus ? (() => { const {channel, cell} = focusedCell(); return channel && cell ? cellLabel(format, cell, channel, nowStore.get(), actions.quiet) : channel ? channelA11y(channel, actions.quiet) : t('guide.label'); })() : t('guide.label');

  const rows: React.ReactNode[] = [];
  for (let row = firstRow; row <= lastRow && row < total; row++) {
    rows.push(
      <GuideRowView
        key={row}
        row={row}
        y={isTV ? row * g.row - top : row * g.row}
        actions={actions}
        geometry={g}
        viewStart={viewStart}
        viewEnd={viewEnd}
        nowStore={nowStore}
        focusTime={isTV && hasFocus && focus.row === row ? focus.time : undefined}
        touch={!isTV}
      />,
    );
  }

  const body = (
    <View style={{width: g.channel + laneWidth, height: Math.max(total, 1) * g.row}}>
      {rows}
      <GuideNowLine nowStore={nowStore} geometry={g} channelWidth={g.channel} viewStart={viewStart} viewEnd={viewEnd} pxPerMs={pxPerMs} top={isTV ? 0 : top} height={bodyH} />
    </View>
  );

  const goDay = useCallback((day: number) => {
    // The strip jumps to 6:00 PM local that day (prime time, §3.4).
    const at = dayPrimeTime(day, format.zone);
    setViewStart(clampStart(at - spanMs * LEAD));
    setFocus(f => ({row: f.row, time: at}));
  }, [clampStart, format.zone, spanMs]);

  return (
    <View style={{width, height}}>
      {/* Controls (§3.4): Now, the day menu, the day strip, and on touch the ±2 h steps. The
          strip is a focusable row above the grid, as the chips are. */}
      <View style={{height: controlsH, flexDirection: 'row', alignItems: 'center', gap: space.sm, paddingLeft: space.page}}>
        <GuideNowButton nowStore={nowStore} viewStart={viewStart} viewEnd={viewEnd} controlsTop={controlsTop} format={format} onJump={() => { jumpTo(Date.now()); setFocus(f => ({row: f.row, time: Date.now()})); }} />
        <Button variant="ghost" size="sm" icon="calendar" trailingIcon="chevronDown" label={format.dayLabel(currentDay)} accessibilityLabel={`${t('guide.day')}: ${format.dayLabel(currentDay)}`} onPress={() => setDayMenu(true)} />
        <ScrollView horizontal showsHorizontalScrollIndicator={false} style={{flex: 1, minWidth: 0}}>
          <ChipBar label={t('guide.day')}>
            {days.slice(0, 7).map(d => <Chip key={d} label={format.dayLabel(d)} selected={d === currentDay} onPress={() => goDay(d)} />)}
          </ChipBar>
        </ScrollView>
        {!isTV ? (
          <>
            <Button variant="ghost" size="sm" icon="back" label={t('guide.twoHours')} accessibilityLabel={t('guide.earlier')} disabled={!canEarlier} onPress={() => shift(-2 * HOUR_MS)} />
            <Button variant="ghost" size="sm" trailingIcon="forward" label={t('guide.twoHours')} accessibilityLabel={t('guide.later')} disabled={!canLater} onPress={() => shift(2 * HOUR_MS)} style={{marginRight: space.page}} />
          </>
        ) : null}
      </View>
      {/* Ruler (sticky): ticks every 30 minutes, the hour emphasized, a day tick names the day. */}
      <GuideRuler nowStore={nowStore} geometry={g} format={format} viewStart={viewStart} viewEnd={viewEnd} pxPerMs={pxPerMs} laneWidth={laneWidth} />
      {isTV ? (
        <TVFocusGuideView trapFocusLeft trapFocusRight trapFocusUp trapFocusDown style={{height: bodyH, overflow: 'hidden'}}>
          {body}
          {/* The one focus stop of the grid; the focused cell is drawn by its row. */}
          <Focusable
            ref={grid}
            ring={false}
            scale={1}
            accessibilityRole="button"
            accessibilityLabel={a11y}
            style={{position: 'absolute', left: 0, top: 0, width: g.channel + laneWidth, height: bodyH}}
            onFocus={() => { gridFocused.current = true; setHasFocus(true); }}
            onBlur={() => { gridFocused.current = false; setHasFocus(false); }}
            onPress={() => { const {channel, cell} = focusedCell(); if (channel) actions.onOpen({channel, program: cell?.program}); }}
            onLongPress={() => { const {channel} = focusedCell(); if (channel) actions.onChannelMenu(channel); }}>
            <View />
          </Focusable>
        </TVFocusGuideView>
      ) : (
        <ScrollView style={{height: bodyH}} scrollEventThrottle={32} onScroll={e => setTop(e.nativeEvent.contentOffset.y)} showsVerticalScrollIndicator decelerationRate={motion.reduce ? 'fast' : 'normal'}>
          {body}
        </ScrollView>
      )}
      <Menu
        open={dayMenu}
        onClose={() => setDayMenu(false)}
        title={t('guide.day')}
        items={days.map(d => ({id: String(d), label: format.dayLabel(d), selected: d === currentDay}))}
        onSelect={id => {
          const day = Number(id);
          // Today → now; another day → 6:00 PM (prime time), §3.4.
          if (day === localDayStart(Date.now(), format.zone)) { jumpTo(Date.now()); setFocus(f => ({row: f.row, time: Date.now()})); }
          else { const at = day + 18 * HOUR_MS; setViewStart(clampStart(at - spanMs * LEAD)); setFocus(f => ({row: f.row, time: at})); }
        }}
      />
    </View>
  );
});

/**
 * PERF-07: the only grid-level readers of `now`. The Now button's arrow, the ruler's Now tab
 * (with its tick hiding) and the vertical now-line each subscribe to the store; the grid and
 * its rows never do, so a 30 s tick re-renders only these children plus each on-air
 * `LiveProgress` below.
 */
const GuideNowButton = React.memo(function GuideNowButton({nowStore, viewStart, viewEnd, controlsTop, onJump, format}: {nowStore: NowStore; viewStart: number; viewEnd: number; controlsTop?: React.RefObject<FocusableHandle | null>; onJump: () => void; format: GuideFormat}) {
  // Subscribe: the arrow flips only when `now` enters or leaves the span.
  const now = useSyncExternalStore(nowStore.subscribe, nowStore.getSnapshot);
  const t = format.t;
  const off = now < viewStart || now >= viewEnd;
  return <Button ref={controlsTop as React.Ref<FocusableHandle>} variant="secondary" size="sm" icon={off ? (now < viewStart ? 'back' : 'forward') : 'clock'} label={t('guide.now')} accessibilityLabel={off ? (now < viewStart ? t('guide.nowEarlier') : t('guide.nowLater')) : t('guide.now')} onPress={onJump} />;
});

function GuideRuler({nowStore, geometry: g, format, viewStart, viewEnd, pxPerMs, laneWidth}: {nowStore: NowStore; geometry: GuideGeometry; format: GuideFormat; viewStart: number; viewEnd: number; pxPerMs: number; laneWidth: number}) {
  const {colors, space, metrics, isTV} = useTheme();
  const t = format.t;
  const now = useSyncExternalStore(nowStore.subscribe, nowStore.getSnapshot);
  const ticks = useMemo(() => rulerTicks(viewStart, viewEnd, pxPerMs, format.zone), [viewStart, viewEnd, pxPerMs, format.zone]);
  const lineX = nowX(now, viewStart, viewEnd, pxPerMs);
  return (
    <View style={{height: g.ruler, flexDirection: 'row', borderBottomWidth: 1, borderBottomColor: colors.lineSoft}}>
      <View style={{width: g.channel, justifyContent: 'center', paddingLeft: space.page}}>
        <Text variant="label" tone="tertiary">{t('guide.channelColumn')}</Text>
      </View>
      <View style={{width: laneWidth, overflow: 'hidden'}} accessibilityElementsHidden importantForAccessibility="no-hide-descendants">
        {ticks.map(tick => {
          const hidden = lineX !== undefined && tick.x > lineX - (isTV ? 110 : 72) && tick.x < lineX + (isTV ? 70 : 40);
          return (
            <View key={tick.atMs} style={{position: 'absolute', left: tick.x, top: 0, bottom: 0, justifyContent: 'center'}}>
              <View style={{position: 'absolute', left: 0, bottom: 0, width: 1, height: tick.kind === 'half' ? g.ruler * 0.25 : g.ruler * 0.4, backgroundColor: colors.lineStrong}} />
              {hidden ? null : <Text variant={tick.kind === 'half' ? 'caption' : 'captionStrong'} tone={tick.kind === 'half' ? 'tertiary' : 'secondary'} style={{marginLeft: space.xs}} lines={1}>{tick.kind === 'day' ? format.dayLabel(tick.atMs) : format.clock(tick.atMs)}</Text>}
            </View>
          );
        })}
        {lineX !== undefined ? (
          <View style={{position: 'absolute', left: Math.max(0, lineX - (isTV ? 40 : 24)), top: g.ruler * 0.2, bottom: g.ruler * 0.2, paddingHorizontal: space.xs, borderRadius: metrics.radius.small, backgroundColor: colors.accent, justifyContent: 'center'}}>
            <Text variant="captionStrong" style={{color: colors.accentInk}}>{t('guide.now')}</Text>
          </View>
        ) : null}
      </View>
    </View>
  );
}

function GuideNowLine({nowStore, geometry: g, channelWidth, viewStart, viewEnd, pxPerMs, top, height}: {nowStore: NowStore; geometry: GuideGeometry; channelWidth: number; viewStart: number; viewEnd: number; pxPerMs: number; top: number; height: number}) {
  const {colors} = useTheme();
  const now = useSyncExternalStore(nowStore.subscribe, nowStore.getSnapshot);
  const lineX = nowX(now, viewStart, viewEnd, pxPerMs);
  if (lineX === undefined) return null;
  return <View pointerEvents="none" style={{position: 'absolute', left: channelWidth + lineX - g.nowLine / 2, top, height, width: g.nowLine, backgroundColor: colors.accent}} />;
}

const GuideRowView = React.memo(function GuideRowView({row, y, actions, geometry: g, viewStart, viewEnd, nowStore, focusTime, touch}: {row: number; y: number; actions: GuideActions; geometry: GuideGeometry; viewStart: number; viewEnd: number; nowStore: NowStore; focusTime?: number; touch: boolean}) {
  const {store, format} = actions;
  const {colors, space, isTV} = useTheme();
  const t = format.t;
  useSyncExternalStore(useCallback(fn => store.subscribePage(store.pageOf(row), fn), [store, row]), () => store.getSnapshot().version);
  const channel = store.channelAt(row);
  const logo = isTV ? 64 : g.row >= 72 ? 40 : 36;
  const header = {position: 'absolute' as const, left: 0, top: 0, width: g.channel, height: g.row, flexDirection: 'row' as const, alignItems: 'center' as const, gap: space.sm, paddingLeft: space.page, paddingRight: space.sm};
  if (!channel) {
    return (
      <View style={{position: 'absolute', left: 0, top: y, height: g.row, width: '100%', borderBottomWidth: 1, borderBottomColor: colors.lineSoft}}>
        <View style={header}><Skeleton width={logo} height={logo} /><Skeleton width={g.channel * 0.4} height={isTV ? 20 : 12} /></View>
        <View style={{position: 'absolute', left: g.channel + g.gap, right: 0, top: g.gap, bottom: g.gap}}><Skeleton height={g.row - g.gap * 2} /></View>
      </View>
    );
  }
  const {complete, failed} = channel.guide === 'none' ? {complete: true, failed: false} : store.programsFor(row, viewStart, viewEnd);
  // PERF-07: layout reads `now` once per row render (no subscription), so a tick never
  // re-renders this row. The on-air progress below subscribes on its own.
  const layoutNow = nowStore.get();
  const cells = rowCells(store, row, viewStart, viewEnd, layoutNow, g);
  const focusIndex = focusTime !== undefined ? focusTarget(cells, focusTime) : -1;
  const showSource = actions.entry === ALL;
  const headerContent = (
    <>
      <ChannelLogo channel={channel} size={logo} />
      <View style={{flex: 1, minWidth: 0}}>
        <ChannelName channel={channel} variant={isTV ? 'bodyStrong' : 'captionStrong'} />
        {/* §10: an unavailable channel says why when its row has focus (TV) — the reason is also in the sheet. */}
        {focusTime !== undefined && channelReason(channel, actions.quiet) ? <Text variant="caption" tone="tertiary" lines={1}>{channelReason(channel, actions.quiet)}</Text> : <Text variant="caption" tone="tertiary" lines={1}>{[channel.number, showSource ? sourceName(actions.sources, channel.sourceId) : ''].filter(Boolean).join(' · ')}</Text>}
      </View>
    </>
  );
  return (
    <View style={{position: 'absolute', left: 0, top: y, height: g.row, width: '100%', borderBottomWidth: 1, borderBottomColor: colors.lineSoft, opacity: channelDimmed(channel, actions.quiet) ? 0.6 : 1}}>
      {/* §4: the channel column is not focusable on TV; touch opens the channel (Watch) or its menu. */}
      {touch ? (
        <Focusable accessibilityRole="button" accessibilityLabel={channelA11y(channel, actions.quiet)} style={header} onPress={() => actions.onOpen({channel})} onLongPress={() => actions.onChannelMenu(channel)}>{headerContent}</Focusable>
      ) : (
        <View style={header} accessibilityLabel={channelA11y(channel, actions.quiet)}>{headerContent}</View>
      )}
      <View style={{position: 'absolute', left: g.channel, right: 0, top: 0, bottom: 0}}>
        {!complete && !cells.length && !failed ? <View style={{position: 'absolute', left: g.gap, right: 0, top: g.gap, bottom: g.gap}}><Skeleton height={g.row - g.gap * 2} /></View> : null}
        {failed && !cells.length ? (
          <View style={{position: 'absolute', left: g.gap, right: 0, top: g.gap, bottom: g.gap, flexDirection: 'row', alignItems: 'center', gap: space.sm, paddingHorizontal: space.md, backgroundColor: alpha(colors.amber, 0.1), borderRadius: 4}}>
            <Text variant="caption" tone="secondary">{t('guide.tileFailed')}</Text>
            {touch ? <Button variant="ghost" size="sm" label={t('action.tryAgain')} onPress={() => store.retry()} /> : null}
          </View>
        ) : null}
        {cells.map((cell, i) => (
          <GuideCellView key={cell.program?.id ?? `gap:${cell.start}`} cell={cell} channel={channel} quiet={actions.quiet} geometry={g} format={format} nowStore={nowStore} focused={i === focusIndex} touch={touch} onOpen={actions.onOpen} onMenu={actions.onChannelMenu} />
        ))}
      </View>
    </View>
  );
});

const GuideCellView = React.memo(function GuideCellView({cell, channel, quiet, geometry: g, format, nowStore, focused, touch, onOpen, onMenu}: {cell: GuideCell; channel: GuideChannelRow; quiet: boolean; geometry: GuideGeometry; format: GuideFormat; nowStore: NowStore; focused: boolean; touch: boolean; onOpen: GuideActions['onOpen']; onMenu: GuideActions['onChannelMenu']}) {
  const {colors, space, metrics, isTV} = useTheme();
  const t = format.t;
  // PERF-07: stable callbacks built inside the memoised block (no inline arrows from the row,
  // so a parent render with identical cells keeps every block's props identical).
  const handleOpen = useCallback(() => onOpen({channel, program: cell.program}), [onOpen, channel, cell.program]);
  const handleMenu = useCallback(() => onMenu(channel), [onMenu, channel]);
  const label = useMemo(() => cellLabel(format, cell, channel, nowStore.get(), quiet), [format, cell, channel, nowStore, quiet]);
  const p = cell.program;
  const flags = p?.flags ?? {};
  const onNow = cell.state === 'now' && cell.kind === 'program';
  const past = cell.state === 'past';
  const gap = cell.kind === 'gap';
  const episode = episodeLine(p);
  // Programme facts are static per programme (PERF-07: safe as props). Blocks ≥ 180 px wide
  // show the episode line even below the full tier (TV full starts at 300 px).
  const wide = cell.width >= 180;
  const tone = past ? 'tertiary' : 'secondary';
  const radius = Math.min(metrics.radius.small, 8);
  const box = {position: 'absolute' as const, left: cell.x + g.gap / 2, top: g.gap, width: Math.max(1, cell.width), height: g.row - g.gap * 2};
  const titleLines = cell.tier === 'title2' && isTV ? 2 : 1;
  const content = cell.tier === 'sliver' ? null : (
    <View style={{flex: 1, justifyContent: 'center', paddingHorizontal: cell.tier === 'title' ? space.xs : space.sm, gap: isTV ? 4 : 2}}>
      <View style={{flexDirection: 'row', alignItems: 'center', gap: space.xs, minWidth: 0}}>
        {cell.clippedStart && cell.width >= 96 ? <Text variant="caption" tone="tertiary">‹</Text> : null}
        {p?.recording ? <View style={{width: isTV ? 12 : 8, height: isTV ? 12 : 8, borderRadius: 6, backgroundColor: colors.record}} /> : null}
        <Text variant={isTV ? 'bodyStrong' : 'captionStrong'} tone={past || gap ? 'tertiary' : undefined} lines={titleLines} style={{flexShrink: 1}}>{p ? p.title : t('guide.noInformation')}</Text>
        {cell.tier === 'title2' && (flags.live || flags.new || flags.premiere) ? <View style={{width: 6, height: 6, borderRadius: 3, backgroundColor: colors.accent}} /> : null}
        {cell.clippedEnd && cell.tier !== 'full' ? <Text variant="caption" tone="tertiary">›</Text> : null}
      </View>
      {cell.tier === 'full' && p ? (
        <View style={{flexDirection: 'row', alignItems: 'center', gap: space.xs, minWidth: 0}}>
          <Text variant="caption" tone={tone} lines={1} style={{flexShrink: 1}}>{[onNow ? t('guide.ends', {time: format.clock(cell.end)}) : format.range(cell.start, cell.end), episode].filter(Boolean).join(' · ')}</Text>
          {flags.live ? <Flag label={t('guide.live')} color={colors.record} /> : null}
          {flags.new ? <Flag label={t('guide.new')} color={colors.accent} /> : null}
          {flags.premiere ? <Flag label={t('guide.premiere')} color={colors.accent} /> : null}
          {cell.clippedEnd ? <Text variant="caption" tone="tertiary">›</Text> : null}
        </View>
      ) : null}
      {cell.tier !== 'full' && wide && p && episode ? (
        <View style={{flexDirection: 'row', alignItems: 'center', gap: space.xs, minWidth: 0}}>
          <Text variant="caption" tone={tone} lines={1} style={{flexShrink: 1}}>{episode}</Text>
          {flags.live ? <Flag label={t('guide.live')} color={colors.record} /> : null}
          {flags.new ? <Flag label={t('guide.new')} color={colors.accent} /> : null}
          {flags.premiere ? <Flag label={t('guide.premiere')} color={colors.accent} /> : null}
        </View>
      ) : null}
    </View>
  );
  const surface = {
    flex: 1,
    borderRadius: radius,
    overflow: 'hidden' as const,
    backgroundColor: gap ? 'transparent' : onNow ? colors.raisedHigh : colors.raised,
    ...(gap ? {borderWidth: 1, borderStyle: 'dashed' as const, borderColor: colors.lineStrong} : null),
  };
  // PERF-07: the one `now` reader inside an on-air block. Only this child re-renders on tick.
  const bar = onNow ? <LiveProgress cell={cell} geometry={g} nowStore={nowStore} /> : null;
  // TV: the ring sits inside the cell's bounds (no overlap with neighbours); a sliver gets a
  // minimum-width ring overlay that doesn't change the layout (§4).
  const ring = focused ? <View pointerEvents="none" style={{position: 'absolute', left: 0, top: 0, bottom: 0, width: Math.max(cell.width, 32), borderRadius: radius, borderWidth: metrics.focusRing || 3, borderColor: colors.focus}} /> : null;
  if (touch) {
    return (
      <Focusable accessibilityRole="button" accessibilityLabel={label} radius={radius} scale={1} style={box} onPress={handleOpen} onLongPress={handleMenu}>
        <View style={surface}>{content}{bar}</View>
      </Focusable>
    );
  }
  return (
    <View style={box} accessible={false}>
      <View style={[surface, focused ? {backgroundColor: gap ? alpha(colors.raisedHigh, 0.6) : colors.raisedBright} : null]}>{content}{bar}</View>
      {ring}
    </View>
  );
});

/** PERF-07: the progress of the one on-air block per row. The only `now` reader in rows. */
const LiveProgress = React.memo(function LiveProgress({cell, geometry: g, nowStore}: {cell: GuideCell; geometry: GuideGeometry; nowStore: NowStore}) {
  const {colors} = useTheme();
  const now = useSyncExternalStore(nowStore.subscribe, nowStore.getSnapshot);
  const progress = Math.max(0, Math.min(1, (now - cell.start) / Math.max(1, cell.end - cell.start)));
  if (progress <= 0) return null;
  return <View style={{position: 'absolute', left: 0, bottom: 0, height: g.progress, width: `${progress * 100}%`, backgroundColor: colors.accent}} />;
});

function Flag({label, color}: {label: string; color: string}) {
  const {space} = useTheme();
  return (
    <View style={{paddingHorizontal: space.xs, borderRadius: 4, backgroundColor: alpha(color, 0.22)}}>
      <Text variant="micro" style={{color}}>{label}</Text>
    </View>
  );
}
