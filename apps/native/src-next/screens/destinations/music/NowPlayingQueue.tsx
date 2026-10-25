import React from 'react';
import {ScrollView, Text, View} from 'react-native';
import type {QueuePlaybackView} from '../../../../../../packages/client-core/src/queue-controller';
import type {QueueEntry} from '../../../../../../packages/player-core/src';
import {defaultI18n} from '../../../../../../packages/i18n/src';
import {durationText} from '../../../../../../packages/client-core/src/presentation/kit-model/text';
import {Focusable} from '../../../kit/controls';
import {useTheme} from '../../../kit/theme';
import {browseType} from '../../../kit/browse/presentation';

const t = defaultI18n.t;

/** The listening owner's own queue, drawn: the entry that is playing and the
 * entries the engine will play after it. Order, availability and durations are
 * read from `QueuePlaybackView`; this pane never reorders, invents entries or
 * keeps a queue of its own. A row plays only through the queue's real command. */
export type NowPlayingQueueProps = Readonly<{
  view: QueuePlaybackView;
  /** tablet-play9: this pane is the right column, 366 pt; narrow windows stack it. */
  onPlay?: (queueId: string, entryId: string, revision: string) => void;
  testID?: string;
}>;

type Row = Readonly<{entryId: string; title: string; detail?: string; seconds?: number; current: boolean}>;

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
    return [{entryId: entry.id, title: item.title, ...(detail ? {detail} : {}), ...(seconds ? {seconds} : {}), current: entry.id === view.queue.currentEntryId}];
  });
}

export function NowPlayingQueue({view, onPlay, testID = 'now-playing-queue'}: NowPlayingQueueProps) {
  const theme = useTheme(), rows = nowPlayingQueueRows(view);
  const current = rows.filter(row => row.current), upcoming = rows.filter(row => !row.current);
  const count = view.total ?? rows.length;
  const seconds = view.durationKnown === false || view.totalDurationMs === undefined ? undefined : view.totalDurationMs / 1000;
  const summary = [t('title.songCount', {count}), durationText(seconds, t)].filter((value): value is string => !!value).join(' · ');
  const canPlay = typeof onPlay === 'function';
  const row = (value: Row) => {
    const body = <>
      <View style={{flex: 1, minWidth: 0, gap: 3}}>
        <Text numberOfLines={1} style={[browseType(theme, value.current ? 16 : 15, 700, -0.01), {color: theme.colors.text}]}>{value.title}</Text>
        {value.detail ? <Text numberOfLines={1} style={[browseType(theme, 13, 400), {color: theme.colors.textSecondary}]}>{value.detail}</Text> : null}
      </View>
      {value.seconds ? <Text style={[browseType(theme, 13, 400), {color: theme.colors.textTertiary, fontVariant: ['tabular-nums']}]}>{durationText(value.seconds, t)}</Text> : null}
    </>;
    if (!canPlay || value.current) return <View key={value.entryId} testID={`${testID}-row-${value.entryId}`} accessibilityRole="text" accessibilityLabel={[value.title, value.detail].filter(Boolean).join(', ')}
      style={{minHeight: 52, paddingHorizontal: 14, paddingVertical: 10, flexDirection: 'row', alignItems: 'center', gap: 12}}>{body}</View>;
    return <Focusable key={value.entryId} testID={`${testID}-row-${value.entryId}`} focusId={`${testID}-${value.entryId}`} focusKind="row" focusRadius={10}
      accessibilityRole="button" accessibilityLabel={t('player.queuePlay', {title: value.title})}
      onPress={() => onPlay!(view.queue.id, value.entryId, view.queue.revision)}
      style={({focused}) => ({minHeight: 52, paddingHorizontal: 14, paddingVertical: 10, flexDirection: 'row', alignItems: 'center', gap: 12, borderRadius: 10,
        backgroundColor: focused ? 'rgba(237,245,250,.16)' : 'transparent'})}>{body}</Focusable>;
  };
  const heading = (text: string, extra?: string) => <View style={{flexDirection: 'row', alignItems: 'baseline', gap: 10, paddingHorizontal: 14, paddingTop: 16, paddingBottom: 6}}>
    <Text style={[browseType(theme, 13, 700, 0.06), {color: theme.colors.textSecondary, textTransform: 'uppercase'}]}>{text}</Text>
    {extra ? <Text numberOfLines={1} style={[browseType(theme, 13, 400), {flex: 1, color: theme.colors.textTertiary}]}>{extra}</Text> : null}
  </View>;
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
  </View>;
}
