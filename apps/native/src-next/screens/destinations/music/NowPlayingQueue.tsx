import React, {useCallback, useLayoutEffect, useRef, useState} from 'react';
import {ScrollView, Text, View} from 'react-native';
import type {QueuePlaybackView} from '../../../../../../packages/client-core/src/queue-controller';
import type {QueueEntry} from '../../../../../../packages/player-core/src';
import type {V1QueueEditIntent} from '../../../../../../packages/client-core/src/playback-v1/v1-queue-player';
import {defaultI18n} from '../../../../../../packages/i18n/src';
import {durationText} from '../../../../../../packages/client-core/src/presentation/kit-model/text';
import {Artwork} from '../../../kit/artwork';
import {Focusable} from '../../../kit/controls';
import {FocusRegion, type FocusEdges} from '../../../kit/focus';
import {Menu, type MenuEntry} from '../../../kit/overlays';
import {useTheme} from '../../../kit/theme';
import {browseType} from '../../../kit/browse/presentation';

const t = defaultI18n.t;

/** The listening owner's own queue, drawn: the entries the engine will play after
 * the one playing. Order, availability and durations are read from
 * `QueuePlaybackView`; this pane never reorders, invents entries or keeps a queue of
 * its own. A row plays only through the queue's real command. */
export type NowPlayingQueueProps = Readonly<{
  view: QueuePlaybackView;
  /** tablet-play9: this pane is the right column, 366 pt; narrow windows stack it.
   * The host passes its own artwork resolver so the TV rows can show the covers. */
  onPlay?: (queueId: string, entryId: string, revision: string) => void;
  artwork?: (path: string | undefined) => React.ComponentProps<typeof Artwork>['source'];
  /** tv#7: the host owns this pane's place in the player's focus composition. It names the one
   * region the rows live in and gives that region the parent edges (Right from the transport,
   * progress line and signal line arrives here). The region's entry is this queue's remembered
   * row, or the first row it actually renders, so entering the region lands there; nothing here
   * asks for focus on mount, so the player's own Pause keeps it. */
  regionId?: string;
  edges?: FocusEdges;
  /** The guarded queue edit, only for loaded noncurrent available rows; absent means no actions. */
  /** Requires the canonical loaded-entry facts; without them no row advertises an edit. */
  queueEdit?: Readonly<{enabled: boolean; lease?: object; fenceKey: string;
    entry?: (entryId: string) => Readonly<{position: number; available: boolean}> | undefined;
    apply: (intent: V1QueueEditIntent, queueId: string, expectedRevision: string) => void}>;
  testID?: string;
}>;

type Row = Readonly<{entryId: string; title: string; detail?: string; posterUrl?: string; seconds?: number; current: boolean}>;
/** Everything one open sheet may act on; never read from a later render. */
type RowOpening = Readonly<{row: Row; previous?: Row; next?: Row; queueId: string; revision: string; fenceKey: string; lease?: object;
  apply: (intent: V1QueueEditIntent, queueId: string, expectedRevision: string) => void}>;

const visibleEntries = (view: QueuePlaybackView): readonly Extract<QueueEntry, {hidden: false}>[] =>
  view.queue.entries.filter((entry): entry is Extract<QueueEntry, {hidden: false}> => !entry.hidden && !entry.removed);

export function nowPlayingQueueRows(view: QueuePlaybackView): readonly Row[] {
  const entries = visibleEntries(view);
  const at = entries.findIndex(entry => entry.id === view.queue.currentEntryId);
  // Up next is what the engine will actually play after this entry, in queue
  // order; entries already played are not repeated by wrapping the list.
  const ordered = at >= 0 ? entries.slice(at) : entries;
  return ordered.flatMap(entry => {
    const item = view.items.find(value => value.entryId === entry.id);
    if (!item) return [];
    const detail = [item.artist, item.album && item.album !== item.title ? item.album : undefined]
      .filter((value): value is string => !!value).join(' · ');
    const seconds = item.durationMs !== undefined && item.durationMs > 0 ? item.durationMs / 1000 : undefined;
    return [{entryId: entry.id, title: item.title, ...(detail ? {detail} : {}), ...(item.posterUrl ? {posterUrl: item.posterUrl} : {}), ...(seconds ? {seconds} : {}), current: entry.id === view.queue.currentEntryId}];
  });
}

/** tv#7: the queue is the panel beside the cover, and the viewer returns to the row they left.
 * One entry per queue, bounded, so a long session cannot grow it without limit. */
const rememberedRow = new Map<string, string>();

export function NowPlayingQueue({view, onPlay, artwork, regionId, edges, queueEdit, testID = 'now-playing-queue'}: NowPlayingQueueProps) {
  const theme = useTheme(), tv = theme.isTV, rows = nowPlayingQueueRows(view), [rowMenu, setRowMenu] = useState<RowOpening>(), rowMenuRef = useRef<RowOpening | undefined>(undefined);
  const current = rows.filter(row => row.current), upcoming = rows.filter(row => !row.current);
  const count = view.total ?? rows.length;
  const seconds = view.durationKnown === false || view.totalDurationMs === undefined ? undefined : view.totalDurationMs / 1000;
  const summary = [t('title.songCount', {count}), durationText(seconds, t)].filter((value): value is string => !!value).join(' · ');
  const canPlay = typeof onPlay === 'function', editable = !!queueEdit?.enabled && !!queueEdit.entry;
  // The live ref is the opening's authority: a retained callback may only act while it is still
  // that exact opening, so Cancel or a successor on the same view/fence/lease cannot be used.
  const retire = useCallback((opening: RowOpening) => {
    if (rowMenuRef.current === opening) rowMenuRef.current = undefined;
    setRowMenu(current => current === opening ? undefined : current);
  }, []);
  // Layout retirement for a changed view, fence or lease; the ref and the sheet leave together.
  useLayoutEffect(() => {
    const opening = rowMenuRef.current;
    if (!opening) return;
    if (!queueEdit?.enabled || queueEdit.fenceKey !== opening.fenceKey || (queueEdit.lease ?? undefined) !== opening.lease
      || view.queue.id !== opening.queueId || view.queue.revision !== opening.revision) retire(opening);
  }, [queueEdit?.enabled, queueEdit?.fenceKey, queueEdit?.lease, view.queue.id, view.queue.revision, retire]);
  useLayoutEffect(() => () => {rowMenuRef.current = undefined;}, []);
  const openMenu = (value: Row) => {
    if (!editable || !queueEdit?.entry || value.current || !upcoming.some(entry => entry.entryId === value.entryId)) return;
    // Only the canonical loaded-entry facts admit a row and prove its neighbour: a visible slot
    // or adjacent array index is not positive admission and can cross a hidden/removed gap.
    const facts = queueEdit.entry(value.entryId);
    if (!facts?.available) return;
    const at = upcoming.findIndex(entry => entry.entryId === value.entryId);
    const neighbour = (offset: -1 | 1) => {
      const row = at >= 0 ? upcoming[at + offset] : undefined, other = row && queueEdit.entry?.(row.entryId);
      return row && other?.available && Math.abs(other.position - facts.position) === 1 ? row : undefined;
    };
    const previous = neighbour(-1), next = neighbour(1);
    const opening: RowOpening = {row: value, ...(previous ? {previous} : {}), ...(next ? {next} : {}), queueId: view.queue.id, revision: view.queue.revision,
      fenceKey: queueEdit.fenceKey, ...(queueEdit.lease ? {lease: queueEdit.lease} : {}), apply: queueEdit.apply};
    rowMenuRef.current = opening;
    setRowMenu(opening);
  };
  // Disabled is presentation; each press also proves its captured neighbour is still the one
  // adjacent loaded position before it asks for anything.
  const menuItems = (opening: RowOpening): readonly MenuEntry[] => {
    const canUp = !!opening.previous, canDown = !!opening.next;
    return [
      {id: 'move-up', label: t('web.profile.moveUp'), disabled: !canUp, onSelect: () => {
        if (rowMenuRef.current !== opening) return;
        const previous = opening.previous;
        if (!previous) return;
        opening.apply({action: 'reorder', entryIds: [opening.row.entryId, previous.entryId]}, opening.queueId, opening.revision);
      }},
      {id: 'move-down', label: t('web.profile.moveDown'), disabled: !canDown, onSelect: () => {
        if (rowMenuRef.current !== opening) return;
        const next = opening.next;
        if (!next) return;
        opening.apply({action: 'reorder', entryIds: [next.entryId, opening.row.entryId]}, opening.queueId, opening.revision);
      }},
      {id: 'remove', label: t('web.together.removeFromQueue'), destructive: true,
        onSelect: () => {if (rowMenuRef.current !== opening) return; opening.apply({action: 'remove', entryId: opening.row.entryId}, opening.queueId, opening.revision);}},
    ];
  };
  const remember = (entryId: string) => {
    const queueId = view.queue.id;
    if (!rememberedRow.has(queueId) && rememberedRow.size >= 8) rememberedRow.delete(rememberedRow.keys().next().value!);
    rememberedRow.set(queueId, entryId);
  };
  const row = (value: Row) => {
    const source = artwork?.(value.posterUrl);
    const body = <>
      {source ? <Artwork source={source} width={44} height={44} style={{borderRadius: 8, overflow: 'hidden', flexShrink: 0}}/> : null}
      <View style={{flex: 1, minWidth: 0, gap: 3}}>
        <Text numberOfLines={1} style={[browseType(theme, value.current ? 16 : 15, 700, -0.01), {color: theme.colors.text}]}>{value.title}</Text>
        {value.detail ? <Text numberOfLines={1} style={[browseType(theme, 13, 400), {color: theme.colors.textSecondary}]}>{value.detail}</Text> : null}
      </View>
      {value.seconds ? <Text style={[browseType(theme, 13, 400), {color: theme.colors.textTertiary, fontVariant: ['tabular-nums']}]}>{durationText(value.seconds, t)}</Text> : null}
    </>;
    const main = !canPlay || value.current ? <View key={`${value.entryId}:main`} testID={`${testID}-row-${value.entryId}`} accessibilityRole="text" accessibilityLabel={[value.title, value.detail].filter(Boolean).join(', ')}
      style={{flex: 1, minHeight: 52, paddingLeft: 14, paddingVertical: 10, flexDirection: 'row', alignItems: 'center', gap: 12}}>{body}</View>
      : <Focusable key={`${value.entryId}:main`} testID={`${testID}-row-${value.entryId}`} focusId={`${testID}-${value.entryId}`} focusKind="row" focusRadius={10}
        accessibilityRole="button" accessibilityLabel={t('player.queuePlay', {title: value.title})}
        onPress={() => onPlay!(view.queue.id, value.entryId, view.queue.revision)}
        style={({focused}) => ({flex: 1, minHeight: 52, paddingLeft: 14, paddingVertical: 10, flexDirection: 'row', alignItems: 'center', gap: 12, borderRadius: 10,
          backgroundColor: focused ? 'rgba(237,245,250,.16)' : 'transparent'})}>{body}</Focusable>;
    if (!editable || value.current || !queueEdit?.entry?.(value.entryId)?.available) return main;
    return <View key={value.entryId} style={{flexDirection: 'row', alignItems: 'center'}}>{main}
      <Focusable testID={`${testID}-row-menu-${value.entryId}`} focusKind="button" accessibilityRole="button" accessibilityLabel={t('server.row.actions', {name: value.title})}
        onPress={() => openMenu(value)} style={{width: 44, height: 44, alignItems: 'center', justifyContent: 'center'}}>
        <Text style={[browseType(theme, 18, 800), {color: theme.colors.textSecondary}]}>⋯</Text>
      </Focusable>
    </View>;
  };
  /** tv#7's row: 88 high, the album cover 72 squared and rounded 10, the title at 22, the artist
   * at 19 and the duration at 19; only the entries the engine will really play next. */
  const tvRow = (value: Row) => {
    const source = artwork?.(value.posterUrl);
    const body = <>
      {source ? <Artwork source={source} width={72} height={72} style={{borderRadius: 10, overflow: 'hidden', flexShrink: 0}}/> : null}
      <View style={{flex: 1, minWidth: 0}}>
        <Text numberOfLines={1} style={[browseType(theme, 22, 700), {color: theme.colors.text}]}>{value.title}</Text>
        {value.detail ? <Text numberOfLines={1} style={[browseType(theme, 19, 400), {color: theme.colors.textTertiary, marginTop: 2}]}>{value.detail}</Text> : null}
      </View>
      {value.seconds ? <Text style={[browseType(theme, 19, 400), {color: theme.colors.textTertiary, fontVariant: ['tabular-nums']}]}>{durationText(value.seconds, t)}</Text> : null}
    </>;
    const props = {testID: `${testID}-row-${value.entryId}`, focusId: `${testID}-${value.entryId}`, focusKind: 'row' as const, focusRadius: 10,
      accessibilityRole: 'button' as const, accessibilityLabel: t('player.queuePlay', {title: value.title})};
    if (!canPlay) return <View key={value.entryId} testID={props.testID} accessibilityRole="text" style={{height: 88, flexDirection: 'row', alignItems: 'center', gap: 18}}>{body}</View>;
    return <Focusable key={value.entryId} {...props}
      onFocus={() => remember(value.entryId)} onPress={() => onPlay!(view.queue.id, value.entryId, view.queue.revision)}
      style={({focused}) => ({height: 88, paddingHorizontal: 10, flexDirection: 'row', alignItems: 'center', gap: 18, borderRadius: 15,
        backgroundColor: focused ? theme.colors.raisedHigh : 'transparent'})}>{body}</Focusable>;
  };
  const heading = (text: string, extra?: string) => <View style={{flexDirection: 'row', alignItems: 'baseline', gap: 10, paddingHorizontal: 14, paddingTop: 16, paddingBottom: 6}}>
    <Text style={[browseType(theme, 13, 700, 0.06), {color: theme.colors.textSecondary, textTransform: 'uppercase'}]}>{text}</Text>
    {extra ? <Text numberOfLines={1} style={[browseType(theme, 13, 400), {flex: 1, color: theme.colors.textTertiary}]}>{extra}</Text> : null}
  </View>;
  if (tv) {
    // tv#7's sub line is what is left to play, never the whole queue: the engine's own remaining
    // count when it gives one, and a duration only when this queue is a complete window and every
    // remaining row states its length. A part that is not known is left out, not inferred.
    const complete = view.queue.entries.every(entry => !entry.hidden) && view.durationKnown !== false;
    const remaining = view.remainingCount ?? (complete ? upcoming.length : undefined);
    const upcomingSeconds = complete && upcoming.length > 0 && upcoming.every(row => row.seconds !== undefined)
      ? upcoming.reduce((total, row) => total + (row.seconds ?? 0), 0) : undefined;
    const tvSummary = [remaining === undefined ? undefined : t('title.songCount', {count: remaining}),
      upcomingSeconds === undefined ? undefined : durationText(upcomingSeconds, t)].filter((value): value is string => !!value).join(' · ');
    // A row is a focus target only when it can be played; without the queue's own command there
    // are none, so the region gets no entry and no order rather than phantom targets.
    const remembered = canPlay ? rememberedRow.get(view.queue.id) : undefined;
    const entry = remembered && upcoming.some(row => row.entryId === remembered) ? remembered : canPlay ? upcoming[0]?.entryId : undefined;
    const rows = <ScrollView contentContainerStyle={{paddingBottom: 16}} showsVerticalScrollIndicator={false}>
      {!!upcoming.length && !!tvSummary && <Text style={[browseType(theme, 20, 400), {marginBottom: 18, color: theme.colors.textTertiary}]}>{tvSummary}</Text>}
      {upcoming.map(tvRow)}
      {!upcoming.length ? <Text style={[browseType(theme, 20, 400), {color: theme.colors.textTertiary}]}>{t('player.queueEmpty')}</Text> : null}
    </ScrollView>;
    return <View testID={testID} style={{flex: 1, minHeight: 0}}>
      {regionId
        ? <FocusRegion id={regionId} entry={entry ? `${testID}-${entry}` : undefined} order={canPlay ? upcoming.map(row => `${testID}-${row.entryId}`) : []}
          orientation="vertical" edges={edges} style={{flex: 1}}>{rows}</FocusRegion>
        : rows}
    </View>;
  }
  return <View testID={testID} style={{flex: 1, minHeight: 0}}>
    <ScrollView contentContainerStyle={{paddingBottom: 16}} showsVerticalScrollIndicator={false}>
      {current.length ? heading(t('player.queueNowPlaying')) : null}
      {current.map(row)}
      {upcoming.length ? heading(t('player.queue')) : null}
      {upcoming.map(row)}
      {!current.length && !upcoming.length ? <Text style={[browseType(theme, 14, 400), {paddingHorizontal: 14, paddingVertical: 18, color: theme.colors.textTertiary}]}>{t('player.queueEmpty')}</Text> : null}
    </ScrollView>
    {rows.length ? <View style={{borderTopWidth: 1, borderTopColor: theme.colors.line, paddingHorizontal: 14, paddingVertical: 12}}>
      <Text style={[browseType(theme, 13, 600), {color: theme.colors.textTertiary}]}>{summary}</Text>
    </View> : null}
    {rowMenu && <Menu key={`${rowMenu.queueId}:${rowMenu.revision}:${rowMenu.row.entryId}`} testID={`${testID}-row-menu`} open presentation="sheet" title={rowMenu.row.title}
      onOpenChange={open => {if (!open) retire(rowMenu);}} items={menuItems(rowMenu)}/>}
  </View>;
}
