import React, {useCallback, useMemo, useState} from 'react';
import {View, type LayoutChangeEvent} from 'react-native';
import {useNavigation, type RouteProp} from '@react-navigation/native';
import type {NativeStackNavigationProp} from '@react-navigation/native-stack';
import type {ContentEntry} from '../../../../../packages/client-core/src/library-content';
import type {PlaylistOccurrence, SavedEntry} from '../../../../../packages/client-core/src/saved';
import {captionFor, formatDuration, iconFor, progressFor, shapeFor, useArtwork} from '../../app/content';
import {say} from '../../app/errors';
import {useI18n} from '../../app/i18n';
import {useOpenEntry} from '../../app/open';
import {useInvoker} from '../../app/playback-events';
import {groupSequence, occurrenceSequence, savedSequence, sequenceContainer, type SequenceContainer} from '../../app/container-play';
import {usePlayerActions} from '../../app/player-actions';
import type {ContentStackParams} from '../../app/routes';
import {Card, CardRow, Divider, ListRow, Menu, Notice, PageList, Ring, Skeleton, StateView, gridColumns, showToast, useEntryFocus, useTheme, type MenuItem} from '../../ui';
import {cardRows, type CardRowModel} from '../../app/list-rows';
import {usePlaylist, useSavedResource} from './saved-hooks';
import {mosaicPaths} from './layout';
import {StatusBarScrim, TitleHero, type HeroAction} from './TitleHero';
import {useAppendedPages, useEndReached} from '../../app/paging';
import {usePullToRefresh} from '../../app/refresh';
import {useGroupBrowse, useGroupPages} from '../../app/group-browse';
import {acrossScope, savedViewScope} from '../../app/group-scope';
import {GroupBar, GroupResults} from '../GroupBrowse';

const isOccurrence = (entry: SavedEntry): entry is PlaylistOccurrence => entry.kind === 'playlist_entry';

/** Plays a list from its first entry and remembers the control for TV focus return. */
function usePlayList() {
  const player = usePlayerActions();
  const invoker = useInvoker();
  // `container`: the playlist, the collection or saved view, or the sorted or filtered list, as
  // one server request, however long (the server shuffles the whole of it for Shuffle). The
  // entries are what the player shows while it starts.
  const play = useCallback((list: readonly ContentEntry[], container: SequenceContainer | undefined) => {
    const playable = list.filter(e => e.playback);
    if (!playable.length) return;
    invoker.remember();
    player.playSequence(playable, 0, 0, container);
  }, [player, invoker]);
  return {play, invoker};
}

/**
 * A playlist on the shared hero (Spec — Title Pages §1, "Collection / Playlist"): "N items ·
 * length", Play and Shuffle, then its entries in the owner's order. Pressing an entry plays the
 * playlist from there. Hidden entries (items this profile can't see) keep their number, so the
 * order still reads correctly.
 */
export function PlaylistScreen({route}: {route: RouteProp<ContentStackParams, 'Playlist'>}) {
  const {playlistId, title} = route.params;
  const navigation = useNavigation<NativeStackNavigationProp<ContentStackParams>>();
  const {space, isTV} = useTheme();
  const i18n = useI18n();
  const artwork = useArtwork();
  const open = useOpenEntry();
  const {play, invoker} = usePlayList();
  const {snapshot, refresh, retry, next, mutate, loadOrder} = usePlaylist(playlistId);
  const playlist = snapshot.playlist;
  const sections = useMemo(() => snapshot.projection?.sections ?? [], [snapshot.projection]);
  const page = useMemo(() => sections.flatMap(s => s.entries).filter(isOccurrence), [sections]);
  // APL-SYS-08: pages append as the viewer scrolls; nothing pages backwards.
  const occurrences = useAppendedPages(playlistId, snapshot.pagination.cursor, page, occurrenceKey);
  const media = useMemo(() => occurrences.flatMap(o => (o.hidden ? [] : [o.media])), [occurrences]);
  const pageable = sections.find(s => s.nextCursor);
  const whole = !pageable && snapshot.pagination.cursor === null;
  const pull = usePullToRefresh(refresh, {busy: snapshot.phase === 'loading'});
  const onScroll = useEndReached(() => { if (pageable && snapshot.phase === 'ready') next(pageable.id); });
  // ── Sort and filter ───────────────────────────────────────────────────────
  // A playlist keeps the order its owner gave it until the viewer chooses a sort, and under a
  // filter too (the server's group order); its entries are sorted and filtered across every
  // library they come from, as one list. Reordering and removing belong to the playlist's own
  // list, so they are offered there and not in a sorted one.
  const groupScope = useMemo(() => acrossScope('list', playlistId), [playlistId]);
  const group = useGroupBrowse(groupScope);
  const sorted = useGroupPages(group);
  const count = playlist?.entryCount ?? sections[0]?.totalCount;
  // Total length only when the whole playlist is on screen; a page's sum would be wrong.
  const length = whole ? media.reduce((n, m) => n + (m.duration ?? 0), 0) : 0;
  const claim = useEntryFocus(media.some(m => m.playback));
  const cover = media.find(m => m.posterUrl);
  // M26 item 5: playlists have no custom art — the hero shows a 2×2 mosaic of
  // the first 4 item posters or covers (nothing when no item has art).
  const mosaic = mosaicPaths({}, media);
  // Sorted or filtered, Play and Shuffle play that list (the server's query, however long);
  // otherwise the playlist plays whole, in its own order.
  const listed = group.engaged ? sorted.snapshot.entries : media;
  const sequenceOf = (shuffle: boolean) => groupSequence(group, {shuffle}) ?? sequenceContainer('playlist', playlistId, {shuffle});
  const secondary: HeroAction[] = listed.filter(m => m.playback).length > 1 ? [{icon: 'shuffle', label: i18n.t('title.shuffle'), onPress: () => play(listed, sequenceOf(true))}] : [];
  // M32 (web parity): playlist management the server offers — windowed
  // reorder and remove — through the service's intents. A failure is
  // presented, never thrown at the page.
  const can = (action: string) => !!playlist?.actions.includes(action);
  const [rowMenu, setRowMenu] = useState<string | null>(null);
  const [problem, setProblem] = useState<string | null>(null);
  const change = useCallback(async (work: () => Promise<unknown>) => {
    setProblem(null);
    try { await work(); } catch (e) { setProblem(say(e, 'playlist', 'save')); }
  }, []);
  const order = snapshot.order;
  const orderReady = !!playlist && !!order && order.revision === playlist.revision && order.viewerFence === playlist.viewerFence;
  const ids = occurrences.map(o => o.id);
  // Moves send only the moved occurrence with an anchor — never the whole
  // order. The anchor is "" to prepend to the front.
  const move = (index: number, by: -1 | 1) => {
    const mover = ids[index];
    if (!mover || !playlist || !can('reorder')) return;
    const anchor = by === -1 ? (index <= 1 ? '' : ids[index - 2]!) : ids[index + 1]!;
    if (anchor === undefined) return;
    const run = () => mutate({action: 'reorder', entryIds: [mover], afterEntryId: anchor});
    if (orderReady && order!.entryIds.includes(mover) && (anchor === '' || order!.entryIds.includes(anchor))) { void change(run); return; }
    void change(() => loadOrder().then(run));
  };
  const menuFor = (occurrenceId: string): MenuItem[] => {
    const index = ids.indexOf(occurrenceId);
    const items: MenuItem[] = [];
    if (can('reorder') && index > 0) items.push({id: 'up', label: i18n.t('web.profile.moveUp')});
    if (can('reorder') && index < ids.length - 1) items.push({id: 'down', label: i18n.t('web.profile.moveDown')});
    if (can('remove')) items.push({id: 'remove', label: i18n.t('web.saved.removeFromPlaylist'), destructive: true, ...(items.length ? {section: ''} : {})});
    return items;
  };
  const onRowMenu = (occurrenceId: string, id: string) => {
    const index = ids.indexOf(occurrenceId);
    if (id === 'up') move(index, -1);
    else if (id === 'down') move(index, 1);
    else if (id === 'remove') {
      const title = menuTitle;
      void change(async () => {
        const receipt = await mutate({action: 'remove', entryId: occurrenceId});
        // The server's Undo puts this same entry back where it was, while it offers it.
        const undoToken = receipt?.undoToken;
        if (undoToken) showToast({message: i18n.t('saved.removal.fromPlaylist', {title: title ?? ''}), action: {label: i18n.t('action.undo'), onPress: () => void mutate({action: 'restore', undoToken}).catch(() => showToast({message: i18n.t('saved.removal.undoFailed', {title: title ?? ''}), icon: 'warning'}))}});
      });
    }
  };
  const menuEntry = rowMenu ? occurrences.find(o => o.id === rowMenu) : undefined;
  const menuTitle = menuEntry && !menuEntry.hidden ? menuEntry.media.title : undefined;
  const managed = can('reorder') || can('remove');
  // Where each visible title sits among the playable ones, so a press plays the playlist from there.
  const from = useMemo(() => new Map(media.map((m, i) => [m, i])), [media]);
  const loadMore = () => { if (!group.engaged && pageable && snapshot.phase === 'ready') next(pageable.id); };
  // The entries are the cells of the page's own list: only the rows near the viewport are
  // mounted, however long the playlist is and however much of it has been read.
  const renderOccurrence = ({item: occurrence, index}: {item: PlaylistOccurrence; index: number}) => {
    const ordinal = index + 1;
    if (occurrence.hidden) {
      return (
        <View style={{paddingHorizontal: space.page - space.sm}}>
          {index > 0 ? <Divider inset={space.sm} /> : null}
          <ListRow ordinal={ordinal} title={i18n.t('title.unavailableItem')} subtitle={i18n.t('title.notVisible')} icon="eyeOff" disabled />
        </View>
      );
    }
    const m = occurrence.media;
    const shape = shapeFor(m.kind);
    return (
      <View style={{paddingHorizontal: space.page - space.sm}}>
        {index > 0 ? <Divider inset={space.sm} /> : null}
        <ListRow
          ordinal={ordinal}
          title={m.title}
          subtitle={captionFor(m)}
          meta={formatDuration(m.duration) || undefined}
          source={artwork(m.posterUrl ?? m.backdropUrl)}
          shape={shape === 'square' ? 'square' : 'poster'}
          icon={m.posterUrl || m.backdropUrl ? undefined : iconFor(m.kind)}
          progress={progressFor(m)}
          watched={m.watched === true && m.kind !== 'song'}
          unavailable={m.available === false}
          onPress={() => (m.playback ? play(media.slice(from.get(m) ?? 0), occurrenceSequence(playlistId, occurrence.id)) : open(m))}
          onLongPress={() => (managed ? setRowMenu(occurrence.id) : open(m, 'more'))}
        />
      </View>
    );
  };
  return (
    <View style={{flex: 1}}>
      <PageList
        // While a sort or a filter is on, the sorted entries are listed under the header in place of the playlist's own rows.
        data={group.engaged ? noOccurrences : occurrences}
        keyExtractor={occurrenceKey}
        renderItem={renderOccurrence}
        // Rows read the playlist's permissions and the playable order.
        extraData={`${managed}:${media.length}`}
        contentStyle={{paddingTop: 0}}
        refreshControl={pull}
        onScroll={onScroll}
        scrollEventThrottle={100}
        onEndReached={loadMore}
        onEndReachedThreshold={1.5}
        ListHeaderComponent={
          <>
            <TitleHero
              ref={invoker.ref}
              loading={!playlist && snapshot.phase === 'loading'}
              art={{source: cover ? artwork(cover.posterUrl) : undefined, shape: 'square', icon: cover ? undefined : 'queue', mosaic: mosaic?.length ? mosaic.map(p => artwork(p)) : undefined}}
              eyebrow={i18n.t('title.kind', {kind: 'playlist'})}
              title={playlist?.name ?? title ?? snapshot.projection?.heading.fallback}
              facts={[count !== undefined && count > 0 ? i18n.t('count.items', {count}) : undefined, length ? formatDuration(length) : undefined]}
              synopsis={playlist?.summary || undefined}
              primary={listed.some(m => m.playback) ? {label: i18n.t('entry.play'), preferFocus: isTV && claim, onPress: () => play(listed, sequenceOf(false))} : undefined}
              secondary={secondary}
            />
            {snapshot.phase === 'error' && !sections.length ? (
              <StateView icon="error" title={i18n.t('error.title.load', {subject: 'playlist'})} message={say(snapshot.error, 'playlist', 'load')} action={i18n.t('action.tryAgain')} onAction={retry} />
            ) : snapshot.phase === 'error' ? (
              <Notice tone="error" message={say(snapshot.error, 'playlist', 'load')} action={i18n.t('title.retry')} onAction={retry} style={{marginHorizontal: space.page, marginBottom: space.lg}} />
            ) : snapshot.phase === 'refresh-required' ? (
              <Notice tone="warning" message={say(snapshot.error ?? 'stale', 'playlist', 'load')} action={i18n.t('action.refresh')} onAction={refresh} style={{marginHorizontal: space.page, marginBottom: space.lg}} />
            ) : null}
            {snapshot.phase === 'loading' && !sections.length ? <RowsSkeleton /> : null}
            {snapshot.phase === 'ready' && !occurrences.length ? <StateView icon="queue" title={i18n.t('title.playlistEmpty')} message={i18n.t(isTV ? 'title.playlistEmptyBodyTV' : 'title.playlistEmptyBody')} /> : null}
            {problem ? <Notice tone="error" message={problem} action={i18n.t('action.dismiss')} onAction={() => setProblem(null)} style={{marginHorizontal: space.page, marginBottom: space.lg}} /> : null}
            {occurrences.length ? <GroupBar group={group} /> : null}
          </>
        }
        ListFooterComponent={group.engaged ? <GroupResults group={group} results={sorted} as="list" playsList /> : <MoreSpinner busy={!!pageable && snapshot.phase === 'loading' && occurrences.length > 0} />}
      />
      <StatusBarScrim onBack={navigation.canGoBack() ? () => navigation.goBack() : undefined} title={playlist?.name ?? title ?? snapshot.projection?.heading.fallback} />
      {rowMenu && menuFor(rowMenu).length ? <Menu open onClose={() => setRowMenu(null)} title={menuTitle} items={menuFor(rowMenu)} onSelect={id => onRowMenu(rowMenu, id)} /> : null}
    </View>
  );
}

/**
 * A personal collection or saved view on the shared hero: "Collection · N items", Play and
 * Shuffle, then the titles as cards in their own shapes. Either plays whole as one server request
 * by its id, in the order it is shown; sorted or filtered, the list shown plays.
 */
export function SavedResourceScreen({route}: {route: RouteProp<ContentStackParams, 'SavedResource'>}) {
  const {resourceId, title} = route.params;
  const navigation = useNavigation<NativeStackNavigationProp<ContentStackParams>>();
  const {space, isTV, metrics, window} = useTheme();
  const i18n = useI18n();
  const artwork = useArtwork();
  const open = useOpenEntry();
  const {play, invoker} = usePlayList();
  const {snapshot, refresh, next} = useSavedResource(resourceId);
  const [width, setWidth] = useState(0);
  const onLayout = useCallback((e: LayoutChangeEvent) => setWidth(e.nativeEvent.layout.width), []);
  const gridWidth = (width || window.width - metrics.railWidth) - space.page * 2;
  const resource = snapshot.resource;
  const page = useMemo(() => snapshot.entries.map(e => e.media).filter((m): m is ContentEntry => !!m), [snapshot.entries]);
  const media = useAppendedPages(resourceId, snapshot.cursor, page, mediaKey);
  const pull = usePullToRefresh(refresh, {busy: snapshot.loading});
  const view = resource?.kind === 'view';
  const cover = media.find(m => m.posterUrl);
  // M26 item 5: collections have no custom art — the hero shows a 2×2 mosaic
  // of the first 4 item posters or covers (nothing when no item has art).
  const mosaic = mosaicPaths({}, media);
  const claim = useEntryFocus(media.some(m => m.playback));
  // ── Sort and filter ───────────────────────────────────────────────────────
  // A saved view is a stored browse of one library: it keeps the sort it was saved with until the
  // viewer chooses another or adds a filter, which narrows the view and never widens it. A personal
  // collection is sorted and filtered across every library its titles come from, as one list.
  const definition = view ? resource?.definition : undefined;
  const collection = resource?.kind === 'collection';
  const groupScope = useMemo(() => (collection ? acrossScope('savedCollection', resourceId) : savedViewScope(definition)), [collection, resourceId, definition]);
  const group = useGroupBrowse(groupScope);
  const sorted = useGroupPages(group);
  const loadMore = () => { if (!group.engaged && !snapshot.loading && !snapshot.error && snapshot.nextCursor) next(); };
  const onScroll = useEndReached(loadMore);
  const listed = group.engaged ? sorted.snapshot.entries : media;
  const start = (shuffle: boolean) => play(listed, groupSequence(group, {shuffle}) ?? savedSequence(resourceId, {shuffle}));
  const secondary: HeroAction[] = listed.filter(m => m.playback).length > 1 ? [{icon: 'shuffle', label: i18n.t('title.shuffle'), onPress: () => start(true)}] : [];
  const {columns, columnWidth} = gridColumns(gridWidth, metrics.posterWidth, space.gutter);
  // The cards are rows of the page's own list: only the rows near the viewport are mounted.
  const rows = useMemo(() => cardRows(media, columns, mediaKey), [media, columns]);
  const renderCard = useCallback((m: ContentEntry, w: number) => <Card title={m.title} subtitle={captionFor(m)} source={artwork(m.posterUrl ?? m.backdropUrl)} shape={shapeFor(m.kind) === 'square' ? 'square' : 'poster'} width={w} progress={progressFor(m)} watched={m.watched === true} unavailable={m.available === false} icon={m.posterUrl || m.backdropUrl ? undefined : iconFor(m.kind)} onPress={() => open(m)} onLongPress={() => open(m, 'more')} />, [artwork, open]);
  const renderRow = useCallback(({item: row}: {item: CardRowModel<ContentEntry>}) => <CardRow items={row.items} first={row.first} columnWidth={columnWidth} keyOf={mediaKey} renderItem={renderCard} />, [columnWidth, renderCard]);
  return (
    <View style={{flex: 1}} onLayout={onLayout}>
      <PageList
        // While a sort or a filter is on, the sorted titles are listed under the header in place of the view's own.
        data={group.engaged ? noRows : rows}
        keyExtractor={rowKey}
        renderItem={renderRow}
        contentStyle={{paddingTop: 0}}
        refreshControl={pull}
        onScroll={onScroll}
        scrollEventThrottle={100}
        onEndReached={loadMore}
        onEndReachedThreshold={1.5}
        ListHeaderComponent={
          <>
            <TitleHero
              ref={invoker.ref}
              loading={!resource && snapshot.loading}
              art={{source: cover ? artwork(cover.posterUrl) : undefined, shape: 'poster', icon: cover ? undefined : view ? 'filter' : 'collection', mosaic: mosaic?.length ? mosaic.map(p => artwork(p)) : undefined}}
              eyebrow={view ? i18n.t('title.savedView') : resource?.visibility === 'server' ? i18n.t('title.sharedCollection') : i18n.t('title.kind', {kind: 'collection'})}
              title={resource?.name ?? title}
              facts={[resource && resource.entryCount > 0 ? i18n.t('count.items', {count: resource.entryCount}) : undefined]}
              synopsis={resource?.summary || undefined}
              primary={listed.some(m => m.playback) ? {label: i18n.t('entry.play'), preferFocus: isTV && claim, onPress: () => start(false)} : undefined}
              secondary={secondary}
            />
            {snapshot.error ? <Notice tone="warning" message={say(snapshot.error, 'saved', 'load')} action={i18n.t('title.retry')} onAction={refresh} style={{marginHorizontal: space.page, marginBottom: space.lg}} /> : null}
            {snapshot.loading && !media.length ? (
              <View style={{flexDirection: 'row', flexWrap: 'wrap', gap: space.md, paddingHorizontal: space.page}}>{Array.from({length: 6}).map((_, i) => <Skeleton key={i} width={metrics.posterWidth} height={metrics.posterWidth * 1.5} />)}</View>
            ) : null}
            {!snapshot.loading && !snapshot.error && !media.length ? <StateView icon={view ? 'filter' : 'collection'} title={view ? i18n.t('title.viewEmpty') : i18n.t('title.collectionEmpty')} /> : null}
            {media.length ? <GroupBar group={group} /> : null}
          </>
        }
        ListFooterComponent={group.engaged && groupScope ? <GroupResults group={group} results={sorted} libraryId={collection ? undefined : groupScope.libraryId} /> : <MoreSpinner busy={snapshot.loading && media.length > 0} />}
      />
      <StatusBarScrim onBack={() => navigation.goBack()} title={resource?.name ?? title} />
    </View>
  );
}

const rowKey = (row: CardRowModel<ContentEntry>) => row.key;
const noRows: CardRowModel<ContentEntry>[] = [];
const noOccurrences: PlaylistOccurrence[] = [];
const occurrenceKey = (o: PlaylistOccurrence) => o.id;
const mediaKey = (m: ContentEntry) => m.id;

/** The next page on its way, under what is already listed. */
function MoreSpinner({busy}: {busy: boolean}) {
  const {space} = useTheme();
  return busy ? <View style={{alignItems: 'center', paddingVertical: space.lg}}><Ring size={24} thickness={2} /></View> : null;
}

function RowsSkeleton() {
  const {space} = useTheme();
  return <View style={{gap: space.sm, paddingHorizontal: space.page}}>{[0, 1, 2, 3].map(i => <Skeleton key={i} height={56} />)}</View>;
}
