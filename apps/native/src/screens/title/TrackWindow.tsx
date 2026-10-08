import React, {useCallback, useRef} from 'react';
import {View, VirtualizedList, type RefreshControlProps, type ViewToken} from 'react-native';
import {useSafeAreaInsets} from 'react-native-safe-area-context';
import type {WindowedCollection} from '../../../../../packages/client-core/src/collections/index';
import type {ContentEntry} from '../../../../../packages/client-core/src/library-content';
import {iconFor, lengthFor, useArtwork} from '../../app/content';
import {usePlayingItemId} from '../../app/player-actions';
import {Divider, ListRow, Skeleton, spec, useReportScroll, useSpecPlatform, useTheme} from '../../ui';
import {useSlot} from './Episodes';

export type TrackRowOptions = Readonly<{
  /** The number at the start of a row (track number, chapter or position); none when it returns undefined. */
  ordinal?: (entry: ContentEntry, index: number) => number | undefined;
  /** The second line; none by default (an album's tracks need only their titles). */
  subtitle?: (entry: ContentEntry) => string | undefined;
  art?: boolean;
  /** The row to mark (the chapter a book resumes in). */
  highlightId?: string;
  onPlay: (index: number) => void;
  onMore?: (entry: ContentEntry) => void;
}>;

/**
 * PERF-S03: an entity page whose list section (an album's or artist's songs, a book's chapters or
 * parts) can be any length. One virtualised list is the page: the hero and chips are its header,
 * the rows come from a windowed collection (only the pages near the viewport are read and kept),
 * and the page's other sections are its footer. Rows have one height, so any row can be reached.
 */
export function TrackWindowList({list, total, row, header, footer, refreshControl}: {list: WindowedCollection<ContentEntry> | null; total: number; row: TrackRowOptions; header: React.ReactElement; footer?: React.ReactElement | null; refreshControl?: React.ReactElement<RefreshControlProps>}) {
  const {space, isTV} = useTheme();
  const insets = useSafeAreaInsets();
  const platform = useSpecPlatform();
  const height = spec.row.minHeight.media[platform] + 1;
  const [headerHeight, setHeaderHeight] = React.useState(0);
  // Television: VirtualizedList wraps its ScrollView in a style-less focus guide, which shrink-wraps,
  // so `flex: 1` collapses the list to one point and the page draws nothing (as `PageList` and
  // `WindowedGrid` found). There the list gets the measured height of its slot instead.
  const [slot, setSlot] = React.useState(0);
  const report = useReportScroll();
  const current = useRef(list);
  current.current = list;
  const onViewable = useRef(({viewableItems}: {viewableItems: ViewToken[]}) => {
    const indices = viewableItems.map(v => v.index).filter((i): i is number => i !== null);
    if (indices.length) current.current?.ensureRange(Math.min(...indices), Math.max(...indices));
  }).current;
  React.useEffect(() => { list?.ensureRange(0, 12); }, [list]);
  const count = list ? total : 0;
  const renderItem = useCallback(({index}: {index: number}) => (list ? <TrackRow list={list} index={index} height={height} row={row} /> : null), [list, height, row]);
  const scroller = (
    <VirtualizedList<number>
      data={count}
      getItemCount={() => count}
      getItem={(_, index) => index}
      keyExtractor={index => `row:${index}`}
      getItemLayout={(_, index) => ({length: height, offset: headerHeight + height * index, index})}
      renderItem={renderItem}
      ListHeaderComponent={<View onLayout={e => setHeaderHeight(e.nativeEvent.layout.height)}>{header}</View>}
      ListFooterComponent={<View style={{paddingTop: space.xl}}>{footer}</View>}
      onViewableItemsChanged={onViewable}
      viewabilityConfig={{itemVisiblePercentThreshold: 1}}
      initialNumToRender={12}
      maxToRenderPerBatch={10}
      windowSize={7}
      updateCellsBatchingPeriod={50}
      style={isTV ? {height: slot} : {flex: 1}}
      refreshControl={refreshControl}
      contentContainerStyle={{paddingBottom: insets.bottom + space.xxxl}}
      onScroll={report}
      scrollEventThrottle={32}
      keyboardShouldPersistTaps="handled"
    />
  );
  if (!isTV) return scroller;
  return <View style={{flex: 1}} onLayout={e => setSlot(e.nativeEvent.layout.height)}>{slot ? scroller : null}</View>;
}

const TrackRow = React.memo(function TrackRow({list, index, height, row}: {list: WindowedCollection<ContentEntry>; index: number; height: number; row: TrackRowOptions}) {
  const {space} = useTheme();
  const artwork = useArtwork();
  const entry = useSlot(list, index);
  const playing = usePlayingItemId();
  if (!entry) {
    return (
      <View style={{height, justifyContent: 'center', paddingHorizontal: space.page}}>
        <Skeleton height={Math.round(height * 0.5)} />
      </View>
    );
  }
  const unavailable = entry.available === false || !entry.playback;
  return (
    <View style={{height, paddingHorizontal: space.page - space.sm, overflow: 'hidden'}}>
      {index > 0 ? <Divider inset={space.sm} /> : null}
      <ListRow
        ordinal={row.ordinal?.(entry, index)}
        title={entry.title}
        subtitle={row.subtitle?.(entry)}
        meta={lengthFor(entry)}
        source={row.art ? artwork(entry.posterUrl ?? entry.backdropUrl) : undefined}
        shape={entry.kind === 'song' || entry.kind === 'album' ? 'square' : 'poster'}
        icon={row.art && !entry.posterUrl && !entry.backdropUrl ? iconFor(entry.kind) : undefined}
        selected={entry.id === (row.highlightId ?? playing)}
        watched={entry.watched === true && entry.kind !== 'song'}
        disabled={unavailable && !entry.navigation}
        onPress={() => row.onPlay(index)}
        onLongPress={row.onMore ? () => row.onMore!(entry) : undefined}
      />
    </View>
  );
});

/** The loaded entries from `index` onward (what a play from that row queues, bounded by what's resident). */
export function residentFrom(list: WindowedCollection<ContentEntry>, index: number, limit = 200): ContentEntry[] {
  const out: ContentEntry[] = [];
  for (let i = index; out.length < limit; i++) {
    const slot = list.slotAt(i);
    if (slot.kind !== 'item') break;
    out.push(slot.item);
  }
  return out;
}
