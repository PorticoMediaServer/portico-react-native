import React, {useMemo, useState} from 'react';
import {View} from 'react-native';
import {useNavigation, type RouteProp} from '@react-navigation/native';
import type {NativeStackNavigationProp} from '@react-navigation/native-stack';
import type {ContentEntry, ContentRoute, ContentSection} from '../../../../packages/client-core/src/library-content';
import {formatDuration, iconFor, lengthFor, shapeFor, useArtwork, useContent} from '../app/content';
import {usePlayingItemId} from '../app/player-actions';
import {say} from '../app/errors';
import {useQuietRefresh} from '../app/quiet-refresh';
import {useI18n, type I18n} from '../app/i18n';
import {useOpenEntry} from '../app/open';
import {useInvoker} from '../app/playback-events';
import {groupSequence, sequenceContainer} from '../app/container-play';
import {usePlayerActions} from '../app/player-actions';
import {announceMark, containerKindFor, useContainerState} from '../app/container-state';
import {useSession} from '../app/session';
import {activeYearsLabel, artistReleaseGroups} from '../../../../packages/client-core/src/presentation/index';
import {TitleDetails} from './title/TitleDetails';
import {useMergeTwo} from './server/TitleTools';
import type {ContentStackParams} from '../app/routes';
import {Chip, ChipBar, ListRow, Notice, Page, StateView, showToast, useEntryFocus, useTheme, type IconName} from '../ui';
import {SectionView} from './Home';
import {StatusBarScrim, TitleHero, type HeroAction} from './title/TitleHero';
import {mosaicPaths} from './title/layout';
import {TrackWindowList, residentFrom, type TrackRowOptions} from './title/TrackWindow';
import {useSectionWindow} from '../app/section-window';
import {Text} from '../ui';
import {RowGuide} from './title/RowGuide';
import {usePullToRefresh} from '../app/refresh';
import {useLibrariesContext} from '../app/libraries-context';
import {useGroupBrowse, useGroupPages, useGroupWindow} from '../app/group-browse';
import {collectionScope, containerScope, discScope, namedGroupScope, type GroupScope} from '../app/group-scope';
import {GroupBar, GroupResults} from './GroupBrowse';
import {ManualOrderRows} from './ManualOrder';
import {moveRequest} from '../../../../packages/client-core/src/presentation/manual-order';
import {moveCollectionTitle} from '../../../../packages/client-core/src/library-collection-order';

type Section = ContentSection;

/**
 * An entity page on the shared hero (Spec — Title Pages §1), filled per type:
 * - **Album / disc:** square art; the artist above the title as a link; "type · year · N songs ·
 *   length"; Play · Shuffle · Favorite · ⋯; the tracks as a numbered list that plays from the
 *   track pressed (APL-AUDIO-03/04); other discs as chips. Music has no "watched".
 * - **Artist:** a circular hero; counts, country and active years; Play · Shuffle · Favorite · ⋯;
 *   its songs as a list that plays from the song pressed; its releases as square cards.
 * - **Audiobook:** "Author · Series · N chapters · length · Finished / Not started"; Resume
 *   {chapter} from the server's book resume point, else Play; Favorite · Finished · ⋯; the
 *   chapters (or, without chapters, the book's parts).
 * - **Author, book series, collection, category:** the hero and the server's sections.
 */
export function EntityScreen({route}: {route: RouteProp<ContentStackParams, 'Entity'>}) {
  const {libraryId, view, entityId, title} = route.params;
  const content = useMemo<ContentRoute>(() => ({libraryId, view, entityId}), [libraryId, view, entityId]);
  const {snapshot, retry, refresh, next} = useContent(content);
  // The server says the list changed under the screen: it is read again quietly, and only a list still refused says so.
  const changedStuck = useQuietRefresh(snapshot.phase === 'refresh-required', refresh);
  const navigation = useNavigation<NativeStackNavigationProp<ContentStackParams>>();
  const {space, isTV} = useTheme();
  const i18n = useI18n();
  const artwork = useArtwork();
  const playing = usePlayingItemId();
  const player = usePlayerActions();
  const open = useOpenEntry();
  const invoker = useInvoker();
  const {api, session: viewerSession} = useSession();
  const projection = snapshot.projection;
  const entity = projection?.entity;
  const listening = projection?.listening;
  const music = projection?.scope.libraryKind === 'music';
  const kind = entity?.kind ?? viewKind(view);
  const shape = shapeFor(kind, 'hero', music ? 'music' : undefined);
  const sections = snapshot.sections;
  const byId = (id: string) => sections.find(s => s.id === id);
  const songs = byId('songs');
  const chapters = byId('chapters');
  const files = byId('files');
  const discs = byId('discs');
  const releases = byId('releases');
  // M32 (web parity): Popular tracks rides the artist's first page only
  // (top 5 by the viewer's plays); absent with no history or older servers.
  const popularTracks = byId('popularTracks');
  const context = byId('context');
  const isBook = kind === 'book';
  const isArtist = kind === 'artist';
  const isMusicList = kind === 'album' || kind === 'disc' || isArtist;
  // M24: artist releases split client-side by role, behind presence (older
  // servers send no roles and keep the single Releases section).
  const releaseEntries = useMemo(() => releases?.entries ?? [], [releases]);
  // An artist's releases by type (Albums, Singles & EPs, Compilations, Appears on), from client-core.
  const releaseGroups = useMemo(() => artistReleaseGroups(releaseEntries), [releaseEntries]);
  // Sections this page draws itself; everything else is the server's own layout.
  // Popular tracks leaves `rest` only when present (older servers and artists
  // without history keep the songs list as before).
  const handled = new Set(isBook ? ['chapters', 'files', 'context'] : isMusicList ? ['songs', 'discs', ...(isArtist && popularTracks ? ['popularTracks'] : [])] : []);
  const rest = sections.filter(s => !handled.has(s.id));
  // PERF-S03: the page's one list section (songs, chapters or parts) is windowed, any length.
  const trackSection = isMusicList ? songs : isBook ? (chapters?.entries.length ? chapters : files) : undefined;
  const trackList = useSectionWindow(trackSection && snapshot.route ? snapshot.route : null, trackSection);

  // ── Sort and filter ───────────────────────────────────────────────────────
  // The group this page shows, as the library's own browse knows it: an album's or an artist's
  // songs, an author's books, a collection's titles, a book series. Each keeps its own order
  // until the viewer chooses a sort or a filter, and under a filter too where the server keeps it.
  // (A book's chapters are not a list the server sorts: they have no controls.)
  const {items: libraries} = useLibrariesContext();
  const groupLibrary = entity?.libraryId || libraryId;
  const libraryKind = projection?.scope.libraryKind ?? libraries.find(l => l.id === groupLibrary)?.kind;
  const groupId = entity?.id, groupTitle = entity?.title;
  const scope = useMemo<GroupScope | undefined>(() => {
    if (!groupId) return undefined;
    switch (kind) {
      case 'album': case 'artist': return containerScope(groupLibrary, 'songs', groupId);
      case 'disc': return discScope(groupLibrary, groupId);
      case 'book': return containerScope(groupLibrary, 'parts', groupId);
      case 'author': return containerScope(groupLibrary, 'books', groupId);
      case 'collection': return collectionScope(groupLibrary, libraryKind, groupId);
      case 'book_series': return groupTitle ? namedGroupScope(groupLibrary, 'books', {field: 'series', operator: 'in', value: [groupTitle]}) : undefined;
      default: return undefined;
    }
  }, [kind, groupLibrary, libraryKind, groupId, groupTitle]);
  const group = useGroupBrowse(scope);
  // An album's or an artist's songs are already a windowed list: the sorted list takes its place.
  // The other groups are sections of a page: their sorted titles are a grid in that page.
  const sortsTracks = kind === 'album' || kind === 'artist' || kind === 'disc';
  const sorted = useGroupWindow(group, sortsTracks);
  const sortedPages = useGroupPages(group, !sortsTracks);
  const sortedList = sortsTracks && group.engaged ? sorted.list : null;

  // ── Playback ──────────────────────────────────────────────────────────────
  // On Playback v1 an album, artist, disc, collection or book plays as one server request from
  // the pressed entry; the entries are what a failed v1 request plays.
  const playFrom = (list: readonly ContentEntry[], index: number) => {
    const playable = list.slice(index).filter(e => e.playback);
    if (!playable.length) return;
    invoker.remember();
    player.playSequence(playable, 0, 0, sequenceContainer(kind, entity?.id));
  };
  const playChapter = (entry: ContentEntry, startSeconds?: number) => {
    if (!entry.playback) return;
    invoker.remember();
    player.play(entry.playback.itemId, startSeconds ?? entry.playback.startSeconds ?? 0, entry);
  };
  // M32: Popular tracks play from the track pressed, like the web list.
  // PERF-S06: the top-5 list plays its own five as an item list, never the artist container.
  const playPopular = (index: number) => {
    if (!popularTracks) return;
    const playable = popularTracks.entries.slice(index).filter(e => e.playback);
    if (!playable.length) return;
    invoker.remember();
    player.playSequence(playable, 0, 0);
  };
  const everything = useMemo(() => sections.flatMap(s => s.entries).filter(e => e.playback && e.kind !== 'chapter'), [sections]);
  // Sorted or filtered, the hero's Play and Shuffle play that list (the server's query, however long).
  const sortedFirst = group.engaged && !isBook ? (sortsTracks ? sortedList?.itemAt(0) : sortedPages.snapshot.entries.find(e => e.playback)) : undefined;
  const playSorted = (first: ContentEntry, shuffle: boolean) => { if (!first.playback) return; invoker.remember(); player.playSequence([first], 0, 0, groupSequence(group, {shuffle})); };
  const queue = songs?.entries ?? files?.entries ?? everything;
  const resumeChapter = isBook && listening?.resume && !listening.resumeUnavailable ? chapterAt(chapters?.entries ?? [], listening.resume.itemId, listening.resume.positionSeconds) : undefined;
  const claim = useEntryFocus(!!entity);
  const pull = usePullToRefresh(refresh, {busy: snapshot.phase === 'loading'});
  // M26 item 5: a collection without custom art shows a 2×2 mosaic of the
  // first 4 item posters or covers in the hero (undefined = custom art wins).
  const heroMosaic = entity && (kind === 'collection' || kind === 'category') ? mosaicPaths(entity, sections.flatMap(s => s.entries)) : undefined;
  let primary: Parameters<typeof TitleHero>[0]['primary'];
  if (isBook && listening?.resume && !listening.resumeUnavailable) {
    const resume = listening.resume;
    const label = resumeChapter ? i18n.t('title.resumeChapter', {chapter: resumeChapter.title}) : i18n.t('entry.resume');
    primary = {label, preferFocus: isTV && claim, onPress: () => { invoker.remember(); player.play(resume.itemId, resume.positionSeconds, resumeChapter ?? entity); }};
  } else if (isBook && chapters?.entries.some(e => e.playback)) {
    const first = chapters.entries.find(e => e.playback)!;
    primary = {label: i18n.t('entry.play'), preferFocus: isTV && claim, onPress: () => playChapter(first)};
  } else if (sortedFirst) {
    primary = {label: i18n.t('entry.play'), preferFocus: isTV && claim, onPress: () => playSorted(sortedFirst, false)};
  } else if (queue.some(e => e.playback)) {
    primary = {label: i18n.t('entry.play'), preferFocus: isTV && claim, onPress: () => playFrom(queue, 0)};
  }
  // PERF-S06: the album, artist or disc plays as one server request in the server's shuffle;
  // the loaded entries are only the fallback when the container can't be named.
  // An album, book or artist keeps its own personal state on the container route: Favorite for all
  // three, and the watched default for a book ("Finished"). Other kinds have none; the hook idles.
  const containerKind = entity ? containerKindFor(entity.kind) : undefined;
  const container = useContainerState(api, containerKind, containerKind && entity ? entity.id : undefined);
  const favorite = !!container.state?.favorite;
  const listed = !!container.state?.watchlisted;
  const finished = !!container.state?.watched;
  const failed = (e: unknown) => showToast({message: say(e, 'library', 'save'), icon: 'warning'});
  // One row on every title (Justin, 2 Oct 2026): Play · Shuffle (music) · My List (books) · Favorite · Finished (books) · ⋯.
  // The owner arranges a library collection's own order here, on a phone or tablet, while it is
  // shown in that order: a move sends the title and the one it now follows.
  const [reordering, setReordering] = useState(false);
  const role = viewerSession?.viewer.role;
  // A collection page carries no entity projection: the collection is the route's own id.
  const canReorder = !isTV && kind === 'collection' && (role === 'owner' || role === 'admin') && group.engaged && !group.choice.sort && !group.choice.predicates.length && sortedPages.snapshot.entries.length > 1;
  const arranging = reordering && canReorder;
  const orderedTitles = useMemo(() => sortedPages.snapshot.entries.map(m => ({id: m.id, media: m})), [sortedPages.snapshot.entries]);
  const moveTitle = async (from: number, to: number) => {
    const request = moveRequest(orderedTitles.map(e => e.id), from, to);
    if (!request) return;
    await moveCollectionTitle(<T,>(path: string, method: 'GET' | 'PUT', body?: unknown) => api.request<T>(path, method, body), entityId, request.entryId, request.afterEntryId);
    await sortedPages.pages?.refresh().catch(() => {});
  };
  const secondary: HeroAction[] = [
    ...(canReorder ? [{icon: (arranging ? 'check' : 'list') as IconName, label: i18n.t(arranging ? 'order.done' : 'order.reorder'), onPress: () => setReordering(on => !on)}] : []),
    ...(sortedFirst ? [{icon: 'shuffle' as IconName, label: i18n.t('title.shuffle'), onPress: () => playSorted(sortedFirst, true)}] : !isBook && queue.filter(e => e.playback).length > 1 ? [{icon: 'shuffle' as IconName, label: i18n.t('title.shuffle'), onPress: () => { invoker.remember(); player.playSequence(queue.filter(e => e.playback), 0, 0, sequenceContainer(kind, entity?.id, {shuffle: true})); }}] : []),
    ...(container.carries('watchlisted') && container.state ? [{icon: (listed ? 'bookmarkFilled' : 'bookmark') as IconName, label: i18n.t(listed ? 'entry.removeFromWatchlist' : 'entry.addToWatchlist'), short: i18n.t('title.watchlist'), selected: listed, onPress: () => { void container.setFlag('watchlisted', !listed).catch(failed); }}] : []),
    ...(container.carries('favorite') && container.state ? [{icon: (favorite ? 'heartFilled' : 'heart') as IconName, label: i18n.t(favorite ? 'entry.removeFromFavorites' : 'entry.addToFavorites'), iconOnly: true, selected: favorite, onPress: () => { void container.setFlag('favorite', !favorite).catch(failed); }}] : []),
    ...(isBook && container.state ? [{icon: (finished ? 'watched' : 'check') as IconName, label: i18n.t(finished ? 'title.markNotFinished' : 'title.markFinished'), iconOnly: true, selected: finished, onPress: () => {
      const reread = () => { container.refresh(); refresh(); };
      // A book marked finished (or not) can be put back as it was: which parts were heard, and where each had got to.
      void container.setWatched(!finished).then(marked => { if (entity) announceMark(api, 'book', entity.id, marked, i18n.t(finished ? 'title.notFinished' : 'title.finished'), reread); reread(); }, failed);
    }}] : []),
  ];
  const more = (entry: ContentEntry) => open(entry, 'more', libraryId);
  // The page's own ⋯: what a card of this album, artist or book offers, minus what the row already has.
  const entityMore = entity && containerKind ? {...entity, libraryId: entity.libraryId || libraryId, navigation: entity.navigation ?? {view, entityId}} as ContentEntry : undefined;
  const bookState = isBook && container.state?.watchedCount !== undefined && container.state.unwatchedCount !== undefined
    ? (container.state.watchedCount + container.state.unwatchedCount <= 1
      ? (container.state.watchedCount ? i18n.t('title.finished') : listening?.resume ? undefined : i18n.t('title.notStarted'))
      : i18n.t('title.finishedCount', {finished: container.state.watchedCount, remaining: container.state.unwatchedCount}))
    : undefined;
  const isAlbum = kind === 'album' || kind === 'disc';
  const albumArtist = isAlbum ? entity?.artist : undefined;
  // Details: the facts that don't belong in the hero line.
  const years = isArtist ? activeYearsLabel(entity?.activeBeginYear, entity?.activeEndYear, y => i18n.t('title.activeSince', {year: y})) : undefined;
  const detailRows: (readonly [string, string])[] = entity ? ([
    entity.albumType ? [i18n.t('title.albumType'), entity.albumType] : null,
    entity.label ? [i18n.t('title.label'), entity.label] : null,
    !isArtist && entity.year ? [i18n.t('title.year'), String(entity.year)] : null,
    entity.country ? [i18n.t('title.country'), entity.country] : null,
    years ? [i18n.t('title.activeYears'), years] : null,
    entity.overviewSource ? [i18n.t('title.synopsis'), i18n.t('title.fromSource', {source: entity.overviewSource})] : null,
  ] as ((readonly [string, string]) | null)[]).filter((r): r is readonly [string, string] => !!r) : [];

  const rowOptions = useMemo<TrackRowOptions | null>(() => {
    if (!trackList || !trackSection) return null;
    if (sortedList) {
      // The sorted songs play on in the order shown: the whole list, from the server's query, starting at the song pressed.
      return {
        art: kind === 'artist',
        ordinal: kind === 'artist' ? undefined : e => e.trackNumber,
        subtitle: kind === 'artist' ? e => e.album?.name : e => { const artist = songArtist(e); return artist && artist !== entity?.subtitle ? artist : undefined; },
        onPlay: index => { const pressed = sortedList.itemAt(index); if (pressed?.playback) { invoker.remember(); player.playSequence([pressed], 0, 0, groupSequence(group)); } },
        onMore: more,
      };
    }
    if (trackSection === songs) {
      return {
        art: kind === 'artist',
        ordinal: kind === 'artist' ? undefined : (e, i) => e.trackNumber ?? i + 1,
        // A guest artist on an album track is worth a line; the album artist and "Track 3" aren't.
        subtitle: kind === 'artist' ? undefined : e => { const artist = songArtist(e); return artist && artist !== entity?.subtitle ? artist : undefined; },
        onPlay: index => playFrom(residentFrom(trackList, index), 0),
        onMore: more,
      };
    }
    if (trackSection === chapters) {
      return {ordinal: (_, i) => i + 1, highlightId: resumeChapter?.id, onPlay: index => { const slot = trackList.slotAt(index); if (slot.kind === 'item') playChapter(slot.item); }};
    }
    return {ordinal: (_, i) => i + 1, highlightId: listening?.resume?.itemId, onPlay: index => playFrom(residentFrom(trackList, index), 0), onMore: more};
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [trackList, trackSection, kind, entity?.subtitle, resumeChapter?.id, listening?.resume?.itemId, sortedList, group]);
  // M26: the list heading only when the list has something to show (no empty sections).
  const heading = trackSection && trackSection.totalCount > 0 && (kind === 'artist' || isBook) ? (
    <Text variant="heading" lines={1} style={{paddingHorizontal: space.page, marginBottom: space.sm}}>{trackSection.heading.fallback}</Text>
  ) : null;
  const top = (
    <>
        <TitleHero
          ref={invoker.ref}
          loading={!entity && (snapshot.phase === 'loading' || snapshot.phase === 'idle')}
          backdrop={entity?.backdropUrl ? artwork(entity.backdropUrl) : undefined}
          art={{source: entity ? artwork(entity.posterUrl ?? entity.backdropUrl) : undefined, shape: shape === 'landscape' ? 'poster' : shape, icon: entity?.posterUrl || entity?.backdropUrl ? undefined : shape === 'circle' ? 'person' : iconFor(kind), mosaic: heroMosaic?.length ? heroMosaic.map(p => artwork(p)) : undefined}}
          eyebrow={albumArtist?.name ?? i18n.t('title.kind', {kind})}
          onEyebrow={albumArtist?.id ? () => navigation.push('Entity', {libraryId, view: 'artist', entityId: albumArtist.id!, title: albumArtist.name}) : undefined}
          title={entity?.title ?? projection?.heading.fallback ?? title}
          facts={entity ? [...entityFacts(i18n, entity, {songs, releases, chapters, files, context, rest}), bookState] : []}
          synopsis={entity?.overview}
          primary={primary}
          secondary={secondary}
          onMore={entityMore ? () => player.more(entityMore, 'page') : undefined}
        />
        {snapshot.phase === 'error' && !sections.length ? (
          <StateView icon="warning" title={i18n.t('error.title.load', {subject: 'library'})} message={say(snapshot.error, 'library', 'load')} action={i18n.t('action.tryAgain')} onAction={retry} />
        ) : changedStuck ? (
          <Notice tone="warning" message={say(snapshot.error ?? 'stale', 'library', 'load')} action={i18n.t('action.refresh')} onAction={refresh} style={{marginHorizontal: space.page, marginBottom: space.lg}} />
        ) : null}

        {/* Album: the other discs of a multi-disc album (APL-AUDIO-04: one disc says nothing). */}
        {discs && discs.entries.length > 1 ? (
          <ChipBar label={i18n.t('title.discs')} style={{paddingHorizontal: space.page, marginBottom: space.lg}}>
            {discs.entries.map(d => <Chip key={d.id} label={d.title} onPress={() => open(d, 'open', libraryId)} />)}
          </ChipBar>
        ) : null}
        {isBook && context?.entries.length ? (
          <ChipBar label={context.heading.fallback} style={{paddingHorizontal: space.page, marginBottom: space.lg}}>
            {context.entries.map(c => <Chip key={c.id} icon={c.kind === 'author' ? 'person' : 'book'} label={c.title} onPress={() => open(c, 'open', libraryId)} />)}
          </ChipBar>
        ) : null}
        {/* The five most played first, then every song, then the releases by type (the same order as the web). */}
        {isArtist && popularTracks && popularTracks.entries.length ? (
          <View style={{paddingHorizontal: space.page, marginBottom: space.xl}}>
            <Text variant="heading" lines={1} style={{marginBottom: space.sm}}>{popularTracks.heading.fallback}</Text>
            {popularTracks.entries.map((entry, index) => (
              <ListRow
                key={entry.id}
                title={entry.title}
                meta={lengthFor(entry)}
                selected={playing === entry.id}
                source={artwork(entry.posterUrl ?? entry.backdropUrl)}
                shape="square"
                icon={entry.posterUrl || entry.backdropUrl ? undefined : iconFor(entry.kind)}
                disabled={!entry.playback && !entry.navigation}
                onPress={() => playPopular(index)}
                onLongPress={() => more(entry)}
              />
            ))}
          </View>
        ) : null}
      {heading}
      <GroupBar group={group} />
    </>
  );
  const noMatch = <StateView icon="filter" title={i18n.t('library.noMatch')} message={i18n.t('library.noMatchBody')} action={i18n.t('library.clearFilters')} onAction={group.reset} />;
  // Owners: two of an album's songs, or a book's files, that are one can be merged here (they have no page of their own to start from).
  const mergeTwo = useMergeTwo((isBook ? files : songs)?.entries ?? [], refresh);
  const bottom = (
    <>
        {sortedList && sorted.snapshot.status === 'ready' && sorted.snapshot.total === 0 ? noMatch : null}
        {arranging ? <ManualOrderRows entries={orderedTitles} whole={!sortedPages.snapshot.hasMore} onMove={moveTitle} /> : !sortsTracks && group.engaged ? <GroupResults group={group} results={sortedPages} libraryId={groupLibrary} row={1} /> : rest.map((section, index) => {
          if (section.id === 'releases' && isArtist && releases) {
            return (
              <React.Fragment key="releases-split">
                {releaseGroups.map((group, at) => {
                  const last = at === releaseGroups.length - 1;
                  return <RowGuide key={group.id}><SectionView row={1 + index + at} section={{...section, id: group.id, heading: {key: group.label, fallback: i18n.t(group.label)}, entries: group.entries, totalCount: group.entries.length, nextCursor: last ? section.nextCursor : ''}} libraryId={libraryId} onMore={last && section.nextCursor ? () => next(section.id) : undefined} /></RowGuide>;
                })}
              </React.Fragment>
            );
          }
          return <RowGuide key={section.id}><SectionView row={1 + index} section={section} libraryId={libraryId} onMore={section.nextCursor ? () => next(section.id) : undefined} /></RowGuide>;
        })}
        <TitleDetails rows={detailRows} tools={mergeTwo.row} />
        {mergeTwo.sheet}
        {snapshot.phase === 'ready' && !sections.length && !group.engaged ? <StateView icon={iconFor(kind)} title={i18n.t('title.nothingHere')} /> : null}
    </>
  );

  return (
    <View style={{flex: 1}}>
      {trackList && rowOptions && trackSection ? (
        <TrackWindowList list={sortedList ?? trackList} total={sortedList ? sorted.snapshot.total ?? 0 : trackSection.totalCount} row={rowOptions} header={top} footer={bottom} refreshControl={pull} />
      ) : (
        <Page contentStyle={{paddingTop: 0}} refreshControl={pull}>
          {top}
          {bottom}
        </Page>
      )}
      <StatusBarScrim onBack={() => navigation.goBack()} title={entity?.title ?? projection?.heading.fallback ?? title} />
    </View>
  );
}

/** The performer from a song's server subtitle ("Disc 1 · Track 3 · Adele" → "Adele"). */
function songArtist(entry: ContentEntry): string | undefined {
  const parts = entry.subtitle?.split(' · ').filter(p => !/^(Disc|Track) \d+$/.test(p));
  return parts?.length ? parts[parts.length - 1] : undefined;
}

/** The chapter a resume point falls in: the last chapter of that part starting at or before it. */
function chapterAt(chapters: readonly ContentEntry[], itemId: string, position: number): ContentEntry | undefined {
  let hit: ContentEntry | undefined;
  for (const c of chapters) if (c.playback?.itemId === itemId && (c.playback.startSeconds ?? 0) <= position + 1) hit = c;
  return hit;
}

function viewKind(view: string): ContentEntry['kind'] {
  return (['album', 'artist', 'book', 'author', 'book_series', 'collection', 'category', 'disc'] as const).find(k => k === view) ?? 'collection';
}

/** Spec §1 facts per type. Counts come from the server's section totals, never from a page. M24: album year from the entity, behind presence. */
function entityFacts(i18n: I18n, entity: ContentEntry, s: {songs?: Section; releases?: Section; chapters?: Section; files?: Section; context?: Section; rest: readonly Section[]}): (string | undefined)[] {
  const length = entity.duration ? formatDuration(entity.duration) : undefined;
  switch (entity.kind) {
    case 'album':
    case 'disc': {
      const count = s.songs?.totalCount || entity.count;
      // The artist is the link above the title when the entity names one; the release type leads the line.
      return [entity.artist?.name ? entity.albumType ?? i18n.t('title.kind', {kind: 'album'}) : entity.subtitle, entity.year ? String(entity.year) : undefined, count ? i18n.t('title.songCount', {count}) : undefined, length];
    }
    case 'artist':
      return [s.releases?.totalCount ? i18n.t('title.albumCount', {count: s.releases.totalCount}) : undefined, s.songs?.totalCount ? i18n.t('title.songCount', {count: s.songs.totalCount}) : undefined, entity.country, activeYearsLabel(entity.activeBeginYear, entity.activeEndYear, y => i18n.t('title.activeSince', {year: y}))];
    case 'book': {
      const author = s.context?.entries.find(e => e.kind === 'author')?.title;
      const series = s.context?.entries.find(e => e.kind === 'book_series')?.title;
      return [author ?? entity.subtitle, series, s.chapters?.totalCount ? i18n.t('title.chapterCount', {count: s.chapters.totalCount}) : undefined, length];
    }
    default: {
      const count = entity.count ?? (s.rest.length === 1 ? s.rest[0]!.totalCount : undefined);
      return [entity.subtitle, count ? i18n.t('count.items', {count}) : undefined, length];
    }
  }
}
