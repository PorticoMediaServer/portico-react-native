import React, {useEffect, useMemo, useState} from 'react';
import {View} from 'react-native';
import {useNavigation, type RouteProp} from '@react-navigation/native';
import type {NativeStackNavigationProp} from '@react-navigation/native-stack';
import type {DetailProjection} from '../../../../packages/client-core/src/detail';
import type {ContentEntry} from '../../../../packages/client-core/src/library-content';
import {dedupeNames, detailActions, networkName, originalTitleLine, refreshMetadataPath, relatedRowsForPage} from '../../../../packages/client-core/src/presentation/index';
import {formatDuration, useArtwork} from '../app/content';
import {useDetail, useItemRecommendations} from '../app/detail';
import {titleRecommendationRows} from '../../../../packages/client-core/src/recommendations';
import {homeRowHeading} from '../../../../packages/client-core/src/home';
import {say} from '../app/errors';
import {useI18n, type I18n} from '../app/i18n';
import {repairTargetFor, useMetadataEditor} from '../app/metadata-editor';
import {useDownloads} from '../app/downloads';
import {useInvoker, useRefreshOnPlayback} from '../app/playback-events';
import {usePlayerActions} from '../app/player-actions';
import type {ContentStackParams} from '../app/routes';
import {useSession} from '../app/session';
import {useGroupActions} from '../app/together';
import {useCurrentActivity} from '../bridge/NativeActivity';
import {Button, Card, Menu, Notice, Page, PersonCard, Shelf, Skeleton, StateView, showToast, useEntryFocus, useTheme, type IconName, type MenuItem} from '../ui';
import {SectionView} from './Home';
import {withoutNotInterested} from '../app/not-interested';
import {useTurnedDown} from '../app/not-interested-hook';
import {factsLine, isActing, keyCrew, namesIn} from './title/facts';
import {StatusBarScrim, TitleHero, type HeroAction} from './title/TitleHero';
import {RateSheet} from './title/TitleSheets';
import {TitleDetails} from './title/TitleDetails';
import {useMergeTwo, useTitleTools} from './server/TitleTools';
import {PlaybackChoices} from './title/PlaybackChoices';
import {CollectionSheet, PlaylistSheet} from '../player/EntryMenu';
import {RowGuide} from './title/RowGuide';
import {usePullToRefresh} from '../app/refresh';

/**
 * A single title (movie, song, audiobook file) on the shared hero (Spec — Title Pages §1): facts
 * and scores, tagline, synopsis, credit lines, pick before play, then one action row —
 * Play/Resume · Watchlist · Favorite · Watched · ⋯. Below it: the first twelve of the cast (See all
 * opens the rest), key crew, related rows (three titles or more each), extras, Details and Files. An episode is not a page of its
 * own: it opens the show page with the episode's panel (§3).
 */
export function DetailScreen({route}: {route: RouteProp<ContentStackParams, 'Detail'>}) {
  const {libraryId, itemId} = route.params;
  const target = useMemo(() => ({libraryId, itemId}), [libraryId, itemId]);
  const {snapshot, mutate, retry, refresh, retryMutation, dismissMutation} = useDetail(target);
  // TV-PLAYER-03 / APL-HOME-03: focus returns to Play after the player, and Resume/Play is current.
  const invoker = useInvoker();
  useRefreshOnPlayback(refresh, change => change.reason !== 'progress' && change.itemId === target.itemId);
  const navigation = useNavigation<NativeStackNavigationProp<ContentStackParams>>();
  const editor = useMetadataEditor();
  const {session: viewerSession, api} = useSession();
  const {space, isTV, metrics} = useTheme();
  const i18n = useI18n();
  const artwork = useArtwork();
  const player = usePlayerActions();
  const downloads = useDownloads();
  // A Watch Together room this viewer may add to: the page offers it, as the title's card does.
  const together = useGroupActions();
  const [menu, setMenu] = useState(false);
  const [sheet, setSheet] = useState<'rate' | 'playlist' | 'collection' | null>(null);
  const data = snapshot.data;
  const item = data?.item;
  // Movies read their rows from the recommendations endpoint (below).
  const recommendations = useItemRecommendations(item ? {libraryId: item.libraryId, itemId: item.id, kind: item.kind} : null);
  // P5: every title recommendation offers Not interested; a card turned down leaves at once.
  const turnedDown = useTurnedDown();
  // P4/P7: every row the recommendations endpoint returns for this title, in its order (More
  // like X, Starring, From its creator, Viewers also watched, then director, genre, person and
  // collections), each named by its titleText. detail.related stands in only until the endpoint
  // answers (and where it doesn't: a failure, or a title it isn't read for).
  const titleRows = titleRecommendationRows(recommendations.data).map(row => withoutNotInterested(row, turnedDown, true));
  const itemEntry = useMemo(() => (item ? entryOf(item) : null), [item]);
  // OS-03 (iOS): the title on screen is offered to Handoff, Spotlight and Siri.
  useCurrentActivity(item ? {itemId: item.id, title: item.title, subtitle: item.episode ? `${item.episode.showTitle} · ${item.title}` : item.year ? String(item.year) : undefined, webUrl: viewerSession?.viewer.authority === 'hosted' ? `https://web.getportico.tv/media/${encodeURIComponent(item.id)}` : undefined} : null);
  // Spec §3: an episode opens on its show page, with the episode's panel over it.
  useEffect(() => {
    if (item?.episode) navigation.replace('Show', {libraryId, showId: item.episode.showId, episodeId: item.id});
  }, [item, libraryId, navigation]);
  const actions = data?.actions.filter(a => a.enabled) ?? [];
  const play = actions.find(a => a.playback && a.id !== 'start_over');
  const restart = actions.find(a => a.id === 'start_over');
  const personal = data?.personal;
  const resume = (item?.progressSeconds ?? 0) > 0 && (play?.playback?.startSeconds ?? 0) > 0;
  const claim = useEntryFocus(!!play?.playback);
  // As on the show page: when playback info arrives after the hero, tvOS has already focused the
  // synopsis "More", and a late hasTVPreferredFocus doesn't move it, so the claim asks directly.
  const playable = !!play?.playback;
  useEffect(() => {
    if (isTV && claim && playable) invoker.ref.current?.focus();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isTV, claim, playable]);
  const pull = usePullToRefresh(refresh, {busy: snapshot.phase === 'loading'});

  // CON-25: one shared model decides the hero actions. Primary Play/Resume with the
  // remaining time, quick Watchlist + Favorite toggles, everything else in More
  // grouped like the title ⋯ menu. Media information keeps its label.
  const canQueue = player.canQueue?.() ?? false;
  const detail = useMemo(() => (data ? detailActions(data, {
    owner: viewerSession?.viewer.role === 'owner',
    // The shared rule still asks for a direct sign-in before it offers Edit. The server lets an
    // owner edit however they signed in, so an owner is always answered yes here.
    local: viewerSession?.viewer.role === 'owner',
    platform: isTV ? 'tv' : 'phone',
    group: together.inRoom && together.canQueue,
    // A play queue to add to, by the rule the title's card menu uses.
    queue: canQueue,
  }) : undefined), [data, viewerSession, isTV, together.inRoom, together.canQueue, canQueue]);
  const menuItems: MenuItem[] = [];
  if (item && detail) {
    for (const group of detail.more) {
      for (const action of group.actions) {
        // Follow-up: Download on iPhone/iPad (never TV; the model already drops
        // it there) via the same path the title ⋯ menu uses. Rate shows its
        // state, as before (Rated N stars vs Rate…).
        if (action.id === 'download') {
          if (isTV) continue;
          menuItems.push({id: 'download', label: i18n.t(action.label), icon: action.icon});
        }
        else if ((action.id as string) === 'rate') menuItems.push({id: 'rate', label: personal?.rating != null ? i18n.t('title.rated', {stars: i18n.t('title.stars', {count: personal.rating / 2})}) : i18n.t('entry.rate'), icon: personal?.rating != null ? 'starFilled' : 'star'});
        else if (action.id === 'addToPlaylist') menuItems.push({id: 'playlist', label: i18n.t(action.label), icon: action.icon, section: ''});
        else if (action.id === 'addToCollection') menuItems.push({id: 'collection', label: i18n.t(action.label), icon: action.icon});
        else if (action.id === 'playFromStart') menuItems.push({id: 'start_over', label: i18n.t('title.playFromStart'), icon: 'restart'});
        else if (action.id === 'editMetadata') menuItems.push({id: 'edit', label: i18n.t(action.label), icon: action.icon});
        // Refresh is offered only for the kinds of title this server can look up again.
        else if (action.id === 'refreshMetadata') { if (refreshMetadataPath(item.kind, item.id)) menuItems.push({id: action.id, label: i18n.t(action.label), icon: action.icon}); }
        else menuItems.push({id: action.id, label: i18n.t(action.label), icon: action.icon});
      }
    }
  }
  function onMenu(id: string) {
    if (!item) return;
    switch (id) {
      case 'start_over':
        if (restart?.playback) { invoker.remember(); player.play(restart.playback.itemId, 0, entryOf(item)); }
        break;
      case 'playNext':
      case 'addToQueue': {
        const next = id === 'playNext', itemId = play?.playback?.itemId ?? item.id;
        void player.enqueue?.(itemId, next).then(() => showToast({message: i18n.t(next ? 'entry.playingNext' : 'entry.addedToQueue'), icon: 'queue'}), e => showToast({message: say(e, 'playlist', 'action'), icon: 'warning'}));
        break;
      }
      case 'refreshMetadata':
        void api.request(refreshMetadataPath(item.kind, item.id) ?? '', 'POST', {}).then(() => showToast({message: i18n.t('entry.refreshQueued'), icon: 'check'}), () => showToast({message: i18n.t('entry.refreshFailed'), icon: 'warning'}));
        break;
      case 'watchWithGroup':
        void together.service?.watch(item.id).then(ok => { if (ok) navigation.push('Together', {}); });
        break;
      case 'addToGroupQueue':
        if (item) void together.service?.queueAdd([item.id]).then(ok => showToast(ok ? {message: i18n.t('entry.addedToGroupQueue'), icon: 'check'} : {message: i18n.t('entry.groupQueueFailed'), icon: 'warning'}));
        break;
      case 'rate':
        setSheet('rate');
        break;
      case 'download':
        // Same path as the title ⋯ menu (player/EntryMenu.tsx): the single
        // title to this device, with its name and artwork remembered.
        if (!isTV && play?.playback) {
          downloads.ask({target: {mediaId: play.playback.itemId}, title: item.title, display: {title: item.title, subtitle: item.year ? String(item.year) : undefined, artworkUrl: item.posterUrl, libraryId: item.libraryId, kind: item.kind}});
        }
        break;
      case 'playlist':
      case 'collection':
        setSheet(id);
        break;
      case 'edit': {
        const repair = repairTargetFor(entryOf(item));
        if (repair) editor?.open({targets: [repair], titles: [item.title], onSaved: () => void retry()});
        break;
      }
    }
  }
  // The owner's tools for this title's files (split a version off, delete one, merge with another title); nothing for a member or on television.
  const tools = useTitleTools(item && !item.song ? {id: item.id, title: item.title, kind: item.kind, libraryId: item.libraryId, year: item.year} : undefined, data?.files, () => void retry());
  // Owners: two of a title's extras that are one can be merged here (an extra has no page of its own to start from).
  const mergeExtras = useMergeTwo(useMemo(() => (data?.extras ?? []).flatMap(x => x.items), [data?.extras]), () => void retry());
  // Every hook stays above the error return below (a loading→error change must not call fewer hooks).
  const credits = data?.metadata.credits ?? [];
  const cast = credits.filter(c => isActing(c.department));
  const crew = credits.filter(c => !isActing(c.department));
  // M32 (web parity): the crew shelf shows the people who shaped the title,
  // in credit order, not every department. "All crew" opens the full list.
  const keyCrewList = useMemo(() => keyCrew(crew), [crew]);
  const [allCrew, setAllCrew] = useState(false);
  const [allCast, setAllCast] = useState(false);
  useEffect(() => { setAllCrew(false); setAllCast(false); }, [itemId]);
  if (snapshot.phase === 'error' && !data) {
    return (
      <View style={{flex: 1}}>
        <Page>
          {!isTV ? <Button variant="ghost" size="sm" icon="back" label={i18n.t('action.back')} onPress={() => navigation.goBack()} style={{marginLeft: space.page - space.sm, marginTop: space.lg}} /> : null}
          <StateView icon="warning" title={i18n.t('error.title.load', {subject: 'detail'})} message={say(snapshot.error, 'detail', 'load')} action={i18n.t('action.tryAgain')} onAction={retry} />
        </Page>
      </View>
    );
  }
  // Providers repeat a genre under different ids; one name once.
  const genres = data ? dedupeNames(data.metadata.genres.map(g => g.name)) : [];
  const scores = (data?.metadata.ratings ?? []).slice(0, 3).map(r => ({provider: providerLabel(i18n, r.provider), value: ratingLabel(r.value, r.max)}));
  const duration = item?.duration ? formatDuration(item.duration) : undefined;
  const facts = !item ? [] : item.song
    ? [item.song.albumTitle, item.year, duration]
    : item.bookFile
      ? [item.bookFile.bookTitle, duration]
      : [item.year, duration];
  // Genres are links: each opens this title's library filtered to it.
  const genreLinks = item && !item.song && !item.bookFile && genres.length ? {names: genres, onPress: (name: string) => navigation.push('Library', {libraryId: item.libraryId || libraryId, tab: 'browse' as const, genre: name})} : undefined;
  const eyebrow = item ? (item.song ? factsLine([item.song.albumArtist]) : i18n.t('title.kind', {kind: item.kind})) : undefined;
  const remaining = item && resume && item.duration ? formatDuration(Math.max(0, item.duration - (item.progressSeconds ?? 0))) : '';
  const secondary: HeroAction[] = [];
  if (item && detail && !item.song) {
    // The same row on every title (Justin, 2 Oct 2026): Watchlist · Favorite · Watched · ⋯.
    for (const q of detail.quick) {
      if (q.id === 'watchlist') secondary.push({icon: q.icon as IconName, label: i18n.t(q.label), short: i18n.t('title.watchlist'), selected: q.selected, onPress: () => mutate({action: 'watchlist', value: !personal?.watchlisted})});
      else if (q.id === 'favorite') secondary.push({icon: q.icon as IconName, label: i18n.t(q.label), iconOnly: true, selected: q.selected, onPress: () => mutate({action: 'favorite', value: !personal?.favorite})});
      else secondary.push({icon: q.icon as IconName, label: i18n.t(q.label), iconOnly: true, selected: q.selected, onPress: () => mutate({action: 'watched', value: !personal?.watched})});
    }
  }
  // Who made it and who is in it, under the synopsis (one entry per person).
  const directors = dedupeNames(namesIn(crew, ['directing']), 3);
  const writers = dedupeNames(namesIn(crew, ['writing']), 3);
  const starring = dedupeNames(cast.map(c => c.name), 4);
  const creditLines = item?.song || item?.bookFile ? [] : [directors.length ? i18n.t('title.directedBy', {names: i18n.list(directors)}) : '', writers.length ? i18n.t('title.writtenBy', {names: i18n.list(writers)}) : '', starring.length ? i18n.t('title.starring', {names: i18n.list(starring)}) : ''].filter(Boolean);
  const shownCast = allCast ? cast : cast.slice(0, CAST_ON_PAGE);
  const f = data?.facts;
  const detailRows: (readonly [string, string])[] = item ? ([
    f?.releaseDate ? [i18n.t('title.releaseDate'), formatDay(f.releaseDate)] : null,
    f?.studio ? [i18n.t('title.studio'), f.studio] : null,
    networkName(f?.network) ? [i18n.t('title.network'), networkName(f?.network)!] : null,
    f?.country ? [i18n.t('title.country'), f.country] : null,
    f?.edition ? [i18n.t('title.edition'), f.edition] : null,
    genres.length && !genreLinks ? [i18n.t('title.genres'), genres.join(', ')] : null,
    item.addedAt ? [i18n.t('title.added'), formatDay(item.addedAt)] : null,
  ] as ((readonly [string, string]) | null)[]).filter((r): r is readonly [string, string] => !!r) : [];
  const titleRowsShown = relatedRowsForPage(titleRows);
  const personWidth = isTV ? 150 : 84;
  return (
    <View style={{flex: 1}}>
      <Page contentStyle={{paddingTop: 0}} refreshControl={pull}>
        <TitleHero
          ref={invoker.ref}
          loading={!item}
          backdrop={item?.backdropUrl ? artwork(item.backdropUrl) : undefined}
          art={item ? {source: artwork(item.posterUrl), shape: item.song || item.bookFile ? 'square' : 'poster', icon: item.song ? 'music' : item.bookFile ? 'book' : undefined} : undefined}
          eyebrow={eyebrow}
          title={item?.title}
          originalTitle={originalTitleLine(item?.title, f?.originalTitle)}
          facts={facts}
          genres={genreLinks}
          rating={f?.contentRating}
          scores={item?.song || item?.bookFile ? undefined : scores}
          tagline={f?.tagline}
          synopsis={item?.overview}
          credits={creditLines}
          choices={item && play?.playback && !item.song ? <PlaybackChoices libraryId={libraryId} itemId={play.playback.itemId} /> : undefined}
          primary={play?.playback && item ? {
            label: resume ? (remaining ? i18n.t('title.resumeRemaining', {remaining}) : i18n.t('entry.resume')) : i18n.t('entry.play'),
            progress: resume && item.duration ? (item.progressSeconds ?? 0) / item.duration : undefined,
            preferFocus: isTV && claim,
            onPress: () => { invoker.remember(); player.play(play.playback!.itemId, play.playback!.startSeconds, entryOf(item)); },
          } : undefined}
          secondary={secondary}
          onMore={menuItems.length ? () => setMenu(true) : undefined}
        />
        {snapshot.mutationError ? <Notice tone="error" message={say(snapshot.mutationError, 'detail', 'save')} action={i18n.t('title.retry')} onAction={retryMutation} style={{marginHorizontal: space.page, marginBottom: space.md}} /> : null}
        {snapshot.pending.some(p => p.phase === 'conflict') ? <Notice tone="warning" message={i18n.t('title.changedElsewhere')} action={i18n.t('title.ok')} onAction={dismissMutation} style={{marginHorizontal: space.page, marginBottom: space.md}} /> : null}
        {/* A title whose files are gone from disk stays in the library, marked missing; a file that is only out of reach right now says that instead. */}
        {item && data?.missingSince ? <Notice tone="warning" title={i18n.t('title.missing')} message={i18n.t('title.missingSince', {when: i18n.date(data.missingSince, 'long')})} style={{marginHorizontal: space.page, marginBottom: space.xl}} />
          : item && !item.available ? <Notice tone="warning" message={i18n.t('title.fileUnavailable')} style={{marginHorizontal: space.page, marginBottom: space.xl}} /> : null}
        {shownCast.length ? <RowGuide><Shelf title={i18n.t('title.cast')} data={shownCast} itemWidth={personWidth} keyExtractor={c => c.id} onSeeAll={!allCast && cast.length > CAST_ON_PAGE ? () => setAllCast(true) : undefined} seeAllLabel={i18n.t('title.seeAll')} renderItem={({item: c}) => <PersonCard name={c.name} subtitle={c.role} width={personWidth} source={artwork(c.portraitUrl)} onPress={c.personId ? () => navigation.push('Person', {personId: c.personId!, name: c.name}) : undefined} />} /></RowGuide> : null}
        {keyCrewList.length ? <RowGuide><Shelf title={i18n.t('title.crew')} data={allCrew ? crew : keyCrewList} itemWidth={personWidth} keyExtractor={c => c.id} onSeeAll={!allCrew && crew.length > keyCrewList.length ? () => setAllCrew(true) : undefined} seeAllLabel={i18n.t('title.allCrew')} renderItem={({item: c}) => <PersonCard name={c.name} subtitle={c.role || c.department} width={personWidth} source={artwork(c.portraitUrl)} onPress={c.personId ? () => navigation.push('Person', {personId: c.personId!, name: c.name}) : undefined} />} /></RowGuide> : null}
        {/* Spec §0.3: people → related → extras. P4: the endpoint's rows for movies, as returned. */}
        {recommendations.phase === 'loading' ? <View style={{paddingHorizontal: space.page, marginBottom: space.lg}}><Skeleton width={metrics.posterWidth} height={metrics.posterWidth * 1.5} /></View> : null}
        {recommendations.phase === 'error' ? <Notice tone="error" message={say(recommendations.error, 'detail', 'load')} action={i18n.t('action.tryAgain')} onAction={recommendations.retry} style={{marginHorizontal: space.page, marginBottom: space.lg}} /> : null}
        {recommendations.data ? titleRowsShown.map((row, index) => (
          <RowGuide key={row.id}><SectionView row={3 + index} origin="recommendation" section={{id: row.id, type: 'rail', heading: homeRowHeading(row), entries: row.entries, totalCount: row.entries.length, nextCursor: ''}} /></RowGuide>
        )) : relatedRowsForPage((data?.related?.rows ?? []).map(raw => withoutNotInterested(raw, turnedDown, true))).map((row, index) => (
          <RowGuide key={row.id}><SectionView row={3 + index} origin="recommendation" section={{id: row.id, type: 'rail', heading: {key: row.id, fallback: row.heading}, entries: row.entries, totalCount: row.entries.length, nextCursor: ''}} /></RowGuide>
        ))}
        {data?.extras?.map(extra => (
          <RowGuide key={extra.type}><Shelf title={extra.label} data={extra.items} itemWidth={metrics.landscapeWidth} keyExtractor={e => e.id} renderItem={({item: e}) => <Card title={e.title} subtitle={e.duration ? formatDuration(e.duration) : undefined} source={artwork(e.backdropUrl ?? e.posterUrl)} shape="landscape" width={metrics.landscapeWidth} onPress={e.playback ? () => player.play(e.playback!.itemId, 0, e) : undefined} />} /></RowGuide>
        ))}
        {item && !item.song ? <TitleDetails rows={detailRows} files={data?.files} genres={genreLinks} fileAction={tools.fileAction} tools={<>{tools.mergeRow}{mergeExtras.row}</>} /> : null}
        {tools.sheets}
        {mergeExtras.sheet}
      </Page>
      <StatusBarScrim onBack={() => navigation.goBack()} title={item?.title} />
      <Menu open={menu} onClose={() => setMenu(false)} title={item?.title} subtitle={factsLine(facts)} items={menuItems} onSelect={onMenu} />
      {item ? <RateSheet open={sheet === 'rate'} title={item.title} value={personal?.rating != null ? personal.rating / 2 : personal?.rating} onRate={stars => mutate({action: 'rating', value: stars == null ? null : Math.round(stars * 2)})} onClose={() => setSheet(null)} /> : null}
      {item ? <PlaylistSheet entry={sheet === 'playlist' ? itemEntry : null} onClose={() => setSheet(null)} /> : null}
      {item ? <CollectionSheet entry={sheet === 'collection' ? itemEntry : null} onClose={() => setSheet(null)} /> : null}
    </View>
  );
}

/** Cast on the page before See all. */
const CAST_ON_PAGE = 12;

/** A rating's source as its badge names it: provider names are names; Portico's own aggregates are words from the catalogue. */
function providerLabel(i18n: I18n, provider: string): string {
  const names: Record<string, string> = {tmdb: 'TMDB', imdb: 'IMDb', tvdb: 'TVDB', anilist: 'AniList', mal: 'MyAnimeList', rottentomatoes: 'Rotten Tomatoes', metacritic: 'Metacritic'};
  switch (provider.toLowerCase()) {
    case 'effective': return i18n.t('title.rating.overall');
    case 'community': return i18n.t('title.rating.community');
    case 'audience': return i18n.t('title.rating.audience');
    case 'critic': case 'critics': return i18n.t('title.rating.critics');
    default: return names[provider.toLowerCase()] ?? provider.charAt(0).toUpperCase() + provider.slice(1);
  }
}

/** "September 15, 2021" without a timezone shift for a calendar date. */
function formatDay(iso: string): string {
  const d = /^\d{4}-\d{2}-\d{2}/.test(iso) ? new Date(iso.slice(0, 10) + 'T00:00:00') : new Date(iso);
  return Number.isNaN(d.getTime()) ? iso : d.toLocaleDateString(undefined, {year: 'numeric', month: 'long', day: 'numeric'});
}

function ratingLabel(value: number, max: number): string {
  if (max === 100) return `${Math.round(value)}%`;
  const rounded = Math.round(value * 10) / 10;
  return `${Number.isInteger(rounded) ? rounded.toFixed(1) : rounded}/${max}`;
}

function entryOf(item: DetailProjection['item']): ContentEntry {
  return {id: item.id, libraryId: item.libraryId, kind: (item.kind as ContentEntry['kind']) ?? 'movie', title: item.title, posterUrl: item.posterUrl, backdropUrl: item.backdropUrl, duration: item.duration, progressSeconds: item.progressSeconds, playback: {itemId: item.id, startSeconds: item.progressSeconds}};
}
