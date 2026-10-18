import React, {useCallback, useEffect, useMemo, useRef, useState} from 'react';
import {BackHandler, View} from 'react-native';
import {useNavigation, type RouteProp} from '@react-navigation/native';
import type {NativeStackNavigationProp} from '@react-navigation/native-stack';
import type {ContentEntry} from '../../../../packages/client-core/src/library-content';
import {SHOW_SETTING_ROWS, dedupeNames, networkName, originalTitleLine, relatedRowsForPage, seasonProgress, showCreditLines, showPeople} from '../../../../packages/client-core/src/presentation/index';
import {announceMark, useContainerState} from '../app/container-state';
import {saveShowSettings, type ShowSettings, type ShowWorkspaceRoute} from '../../../../packages/client-core/src/show-workspace';
import {useArtwork} from '../app/content';
import {useShowRecommendations, useShowWorkspace} from '../app/detail';
import {homeRowHeading} from '../../../../packages/client-core/src/home';
import {withoutNotInterested} from '../app/not-interested';
import {useTurnedDown} from '../app/not-interested-hook';
import {SectionView} from './Home';
import {RowGuide} from './title/RowGuide';
import {EPISODE_PAGE, useEpisodeWindow, type EpisodeSelection, type EpisodeSeed} from '../app/episodes';
import {say} from '../app/errors';
import {useQuietRefresh} from '../app/quiet-refresh';
import {useI18n} from '../app/i18n';
import {repairTargetFor, useMetadataEditor} from '../app/metadata-editor';
import {useInvoker, useRefreshOnPlayback} from '../app/playback-events';
import {episodeGroupSequence, groupSequence, sequenceContainer} from '../app/container-play';
import {usePlayerActions} from '../app/player-actions';
import type {ContentStackParams} from '../app/routes';
import {useSession} from '../app/session';
import {Button, ListRow, Notice, Page, PersonCard, Sheet, Shelf, Skeleton, StateView, Switch, showToast, useEntryFocus, useTheme, type IconName, type MenuItem} from '../ui';
import {EpisodeBrowser, EpisodeList, EpisodeTintContext, useEpisodeRowGeometry, type EpisodeListHandle, type EpisodeMarks, type RenderDetails} from './title/Episodes';
import {TitleDetails} from './title/TitleDetails';
import {useTitleTools} from './server/TitleTools';
import {EpisodeDetails, type EpisodePlay} from './title/EpisodeDetails';
import {LANDING_MS, landingGuess, nextUpChip, toggledEpisode} from './title/episode-open';
import {episodeCode, nextUpIn, orderSeasons, resumeFraction, seasonLabel} from './title/facts';
import {SeasonSwitcher, type SeasonChoice} from './title/SeasonSwitcher';
import {StatusBarScrim, TitleHero, type HeroAction} from './title/TitleHero';
import {usePullToRefresh} from '../app/refresh';
import {useGroupBrowse, useGroupWindow} from '../app/group-browse';
import {containerScope, episodeGroupScope} from '../app/group-scope';
import {GroupBar} from './GroupBrowse';

/** How many seasons the next-up rule may step forward before it settles (bounded work). */
const NEXT_UP_HOPS = 4;
const groupKey = (id: string) => `group:${id}`;

/**
 * The show page (Spec — Title Pages §2), identical for TV shows and anime: the shared hero with a
 * movie's action row (Play/Resume · Watchlist · Favorite · Watched · ⋯), then Episodes — the
 * season switcher with the season's progress beside it, and the windowed episodes, the next-up
 * one wearing a "Next up" (or "Continue") chip — with an episode opened in place, under its row
 * (beside it on television), never over the page. The season is state, not a page: switching it
 * never reloads the hero. Below the episodes: cast and key crew, the show's recommendation rows
 * (three titles or more each), and Details.
 *
 * Opened for an episode (a card elsewhere, a link): the page shows that episode's season, brings
 * the episode into view and marks it a moment; nothing is opened.
 *
 * Next up is the server's when it sends one, else found within the loaded episodes, stepping
 * forward at most a few seasons.
 */
export function ShowScreen({route}: {route: RouteProp<ContentStackParams, 'Show'>}) {
  const {libraryId, showId, seasonId, episodeId, title} = route.params;
  const target = useMemo<ShowWorkspaceRoute>(() => ({libraryId, ...(showId ? {showId} : {}), ...(seasonId ? {seasonId} : {}), ...(episodeId ? {episodeId} : {})}), [libraryId, showId, seasonId, episodeId]);
  const {snapshot, selectSeason, selectGroup, retry} = useShowWorkspace(target);
  // The server says the list changed under the screen: it is read again quietly, and only a list still refused says so.
  const changedStuck = useQuietRefresh(snapshot.phase === 'refresh-required', retry);
  // P4/P7: the show's own recommendation rows (More like the show, From its creator…), named by
  // titleText; their cards offer Not interested.
  const recommendations = useShowRecommendations(snapshot.data?.show.id ?? showId);
  const turnedDown = useTurnedDown();
  const navigation = useNavigation<NativeStackNavigationProp<ContentStackParams>>();
  const {space, isTV, window, metrics} = useTheme();
  const i18n = useI18n();
  const artwork = useArtwork();
  const player = usePlayerActions();
  const editor = useMetadataEditor();
  const {api, session} = useSession();
  // Editing is the owner's, however they signed in (the server authorises both alike).
  const canEdit = !isTV && session?.viewer.role === 'owner';
  const owner = session?.viewer.role === 'owner';
  const invoker = useInvoker();
  const listRef = useRef<EpisodeListHandle>(null);
  const [railJump, setRailJump] = useState<{index: number; focus?: boolean}>();
  const data = snapshot.data;
  const show = data?.show;
  // The owner's tool for a show: say that this show and another are one. Nothing for a member or on television.
  const tools = useTitleTools(show ? {id: show.id, title: show.title, kind: 'show', libraryId} : undefined, undefined, () => retry());
  // Roots stay mounted (shell/Roots.tsx), so several show pages can be alive at once: only the one
  // whose loaded episodes include what was played re-reads.
  const playedHere = useRef<(itemId?: string) => boolean>(() => true);
  useRefreshOnPlayback(retry, change => change.reason !== 'progress' && playedHere.current(change.itemId));
  const pull = usePullToRefresh(retry, {busy: snapshot.phase === 'loading'});

  // ── Season selection (state, not a page) ────────────────────────────────
  // A show whose owner hid its seasons (or asked for ranges) is one list, or the server's groups.
  const flat = !!data && (data.settings.hideSeasons || data.settings.ranges);
  const choices = useMemo<SeasonChoice[]>(() => {
    if (!data) return [];
    const ordered = orderSeasons(data.seasons);
    const regular = ordered.filter(s => s.number !== 0).map(s => ({id: s.id, label: seasonLabel(i18n, s), number: s.number}));
    const specials = ordered.filter(s => s.number === 0).map(s => ({id: s.id, label: seasonLabel(i18n, s), number: 0}));
    const groups = data.groups.map(g => ({id: groupKey(g.id), label: g.title}));
    if (flat) return groups;
    return [...regular, ...groups, ...specials];
  }, [data, flat, i18n]);
  const settledId = data ? (data.selected.group ? groupKey(data.selected.group) : data.selected.seasonId ?? undefined) : undefined;
  const [pending, setPending] = useState<string | null>(null);
  // Next-up season: only when the viewer didn't arrive at a particular season or episode.
  const [auto, setAuto] = useState(!seasonId && !episodeId);
  const hops = useRef(0);
  const reanchor = useRef<'waiting' | 'reading' | 'done'>(episodeId ? 'waiting' : 'done');
  const choose = useCallback((id: string, byViewer = true) => {
    if (byViewer) setAuto(false);
    setPending(id);
    Promise.resolve().then(() => (id.startsWith('group:') ? selectGroup(id.slice('group:'.length)) : selectSeason(id))).catch(() => {
      reanchor.current = 'done';
      setPending(null);
    });
  }, [selectGroup, selectSeason]);
  // Opened for an episode: the server reads the page starting at it; the season is read again from
  // its start so positions are stable, and the episode is found in it, brought into view and marked.
  const [open, setOpen] = useState<{entry: ContentEntry; index: number} | null>(null);
  const [landing, setLanding] = useState<{id: string; index?: number} | undefined>(episodeId ? {id: episodeId} : undefined);
  const landingEntry = useRef<ContentEntry | undefined>(undefined);
  useEffect(() => {
    if (!data || snapshot.phase !== 'ready') return;
    if (reanchor.current === 'waiting' && data.selected.episodeId) {
      landingEntry.current = data.episodes.sections[0]?.entries[0];
      reanchor.current = 'reading';
      const id = data.selected.group ? groupKey(data.selected.group) : data.selected.seasonId;
      if (id) choose(id, false);
      else reanchor.current = 'done';
      return;
    }
    if (reanchor.current === 'reading' && !data.selected.episodeId) reanchor.current = 'done';
    if (pending !== null && pending === settledId) setPending(null);
  }, [data, snapshot.phase, pending, settledId, choose]);
  useEffect(() => { if (snapshot.phase === 'error' || snapshot.phase === 'refresh-required') setPending(null); }, [snapshot.phase]);
  const selected = pending ?? settledId;

  // ── Episodes: the workspace's first page seeds a windowed collection ──────
  const section = data?.episodes.sections[0];
  const seed = useMemo<EpisodeSeed | undefined>(() => (data ? {entries: section?.entries ?? [], nextCursor: section?.nextCursor || null, total: section?.totalCount ?? section?.entries.length ?? 0} : undefined), [data, section]);
  const stable = !!data && pending === null && reanchor.current === 'done' && !data.selected.episodeId;
  const where = useMemo<EpisodeSelection | null>(() => (stable && data ? {libraryId, showId: data.show.id, seasonId: data.selected.seasonId, ...(data.selected.group ? {group: data.selected.group} : {})} : null), [stable, data, libraryId]);
  const {list: seasonList, snapshot: episodes} = useEpisodeWindow(where, stable ? seed : undefined);
  const seasonTotal = episodes.total ?? seed?.total ?? 0;
  // ── Sort and filter ───────────────────────────────────────────────────────
  // The episodes on screen (a season's, or the whole show's when it is one list) keep their own
  // order until the viewer chooses a sort (a filter keeps it: the server's group order); then the
  // list is the library's own browse of those episodes, in the same list on screen. A flat show's
  // groups (its whole list, its specials, a range of a hundred) are named to the server as such.
  const groupOf = stable && data && !data.selected.group ? data.selected.seasonId ?? (flat ? data.show.id : undefined) : undefined;
  const episodeGroup = stable && data ? data.selected.group : undefined;
  const scope = useMemo(() => (episodeGroup ? episodeGroupScope(libraryId, data?.show.id, episodeGroup) : containerScope(libraryId, 'episodes', groupOf)), [libraryId, groupOf, episodeGroup, data?.show.id]);
  const group = useGroupBrowse(scope);
  const sorted = useGroupWindow(group);
  const sortedOn = group.engaged && !!sorted.list;
  const list = sortedOn ? sorted.list : seasonList;
  const total = sortedOn ? sorted.snapshot.total ?? 0 : seasonTotal;
  // Another season, or another order: nothing stays open.
  useEffect(() => { setOpen(null); }, [list]);
  // The episode the page was opened for, found near where its number puts it (a few pages read
  // around that place, never the whole list); not found there, nothing is marked.
  useEffect(() => {
    if (!landing || landing.index !== undefined || !list || !stable || sortedOn || total <= 0) return;
    const id = landing.id;
    const guess = landingEntry.current ? landingGuess(landingEntry.current, seed?.entries[0], total) : 0;
    const from = Math.max(0, guess - EPISODE_PAGE), to = Math.min(total - 1, guess + EPISODE_PAGE);
    const look = (): number | 'waiting' | 'missing' => {
      let waiting = false;
      for (let i = from; i <= to; i++) {
        const e = list.itemAt(i);
        if (e?.id === id) return i;
        if (!e) waiting = true;
      }
      return waiting && list.getSnapshot().status !== 'error' ? 'waiting' : 'missing';
    };
    const settle = () => {
      const at = look();
      if (at === 'waiting') return false;
      setLanding(at === 'missing' ? undefined : {id, index: at});
      return true;
    };
    if (settle()) return;
    list.ensureRange(from, to);
    const stop = list.subscribe(() => { if (settle()) stop(); });
    return stop;
  }, [landing, list, stable, sortedOn, total, seed]);
  // Found: into view (and, on television, focus on it), then the mark fades and lets go.
  const landedAt = landing?.index;
  useEffect(() => {
    if (landedAt === undefined) return;
    if (isTV) setRailJump({index: landedAt, focus: true});
    else requestAnimationFrame(() => listRef.current?.reveal(landedAt));
    const done = setTimeout(() => setLanding(undefined), LANDING_MS);
    return () => clearTimeout(done);
  }, [landedAt, isTV]);

  // ── Next up ─────────────────────────────────────────────────────────────
  // M32: the server's nextUp is the primary action (Resume SxEy / Play next
  // episode / Play S1E1). Until the contract carries it, the Continue
  // Watching rule within what's loaded applies.
  const loaded = useMemo<readonly ContentEntry[]>(() => (stable ? seed?.entries ?? [] : []), [stable, seed]);
  const startedHere = useRef(new Set<string>());
  playedHere.current = itemId => !itemId || startedHere.current.has(itemId) || loaded.some(e => e.id === itemId) || open?.entry.id === itemId;
  const serverNextUp = data?.nextUp?.playback ? data.nextUp : undefined;
  const nextUp = serverNextUp ?? nextUpIn(loaded);
  useEffect(() => {
    if (!auto || !stable || !data || snapshot.phase !== 'ready') return;
    if (nextUp || seed?.nextCursor) { setAuto(false); return; }
    const order = choices.filter(c => c.number !== undefined && c.number > 0);
    const at = order.findIndex(c => c.id === settledId);
    const after = at >= 0 ? order[at + 1] : undefined;
    if (after && hops.current < NEXT_UP_HOPS) { hops.current++; choose(after.id, false); }
    else setAuto(false);
  }, [auto, stable, data, snapshot.phase, nextUp, seed, choices, settledId, choose]);
  const primaryEntry = nextUp ?? loaded.find(e => e.playback);
  const primaryResumes = !!nextUp && (nextUp.progressSeconds ?? 0) > 0;

  // ── Playback ──────────────────────────────────────────────────────────────
  /** Plays from `index`, queueing the resident episodes after it. */
  const playAt = useCallback((index: number, startSeconds: number) => {
    if (!list) return;
    const queue: ContentEntry[] = [];
    for (let i = index; i < index + EPISODE_PAGE * 2 && i < total; i++) {
      const e = list.itemAt(i);
      if (!e) break;
      if (e.playback) queue.push(e);
    }
    if (!queue.length) return;
    startedHere.current = new Set(queue.map(e => e.id));
    invoker.remember();
    // On Playback v1 the season plays as one server request from this episode; episodes the
    // viewer has sorted or filtered play on in the order shown, the whole list from the server's
    // query. An episode group that isn't a season (a range, its specials, its whole list) plays
    // whole as the server's query too, in the show's order.
    const groupPlayed = data?.selected.group ? episodeGroupSequence(libraryId, data.show.id, data.selected.group) : undefined;
    player.playSequence(queue, 0, startSeconds, sortedOn ? groupSequence(group) : groupPlayed ?? sequenceContainer('season', data?.selected.seasonId ?? undefined));
  }, [list, total, player, invoker, data?.selected.seasonId, data?.selected.group, data?.show.id, libraryId, sortedOn, group]);
  const startOf = (e: ContentEntry) => (e.watched ? 0 : e.playback?.startSeconds ?? e.progressSeconds ?? 0);
  // The still plays; the text opens the episode in place and closes it again (one open at a time).
  const toggle = useCallback((index: number) => {
    const e = list?.itemAt(index);
    if (e) setOpen(current => (toggledEpisode(current?.entry.id, e.id) ? {entry: e, index} : null));
  }, [list]);
  const handlers = useMemo(() => ({
    onPlay: (index: number) => {
      const e = list?.itemAt(index);
      if (!e) return;
      if (e.playback) playAt(index, startOf(e));
      else toggle(index);
    },
    onDetails: toggle,
    onMore: (entry: ContentEntry) => player.more(entry),
  }), [list, playAt, player, toggle]);
  const playFromDetails = useCallback(({entry, index, startSeconds}: EpisodePlay) => {
    if (index !== undefined && list?.itemAt(index)?.id === entry.id) playAt(index, startSeconds);
    else if (entry.playback) player.play(entry.playback.itemId, startSeconds, entry);
  }, [list, playAt, player]);
  // Back (Android, the television remote) closes an open episode before it leaves the page.
  useEffect(() => {
    if (!open) return;
    const sub = BackHandler.addEventListener('hardwareBackPress', () => {
      if (!navigation.isFocused()) return false;
      setOpen(null);
      return true;
    });
    return () => sub.remove();
  }, [open, navigation]);

  // ── Season actions ────────────────────────────────────────────────────────
  const [marking, setMarking] = useState(false);
  const seasonTitle = choices.find(c => c.id === selected)?.label ?? i18n.t('title.episodes');
  // The show's and the season's own state go through the container personal-state route (O(1)):
  // never one write per episode. The show carries Watchlist and Favorite like a movie.
  const selectedSeasonId = data && !data.selected.group ? data.selected.seasonId ?? undefined : undefined;
  const showState = useContainerState(api, show ? 'show' : undefined, show?.id);
  const seasonState = useContainerState(api, stable && selectedSeasonId ? 'season' : undefined, stable ? selectedSeasonId : undefined);
  const seasonWatched = seasonState.state?.watched ?? (loaded.length > 0 && !seed?.nextCursor ? loaded.every(e => e.watched) : false);
  const [showSettings, setShowSettings] = useState(false);
  const seasonActions = useMemo<MenuItem[]>(() => {
    const items: MenuItem[] = [];
    if (stable && loaded.length) {
      if (loaded.some(e => e.playback)) items.push({id: 'play', label: i18n.t(flat ? 'entry.play' : 'title.playSeason'), icon: 'play'});
      if (!marking && selectedSeasonId) items.push(seasonWatched ? {id: 'unwatched', label: i18n.t('title.markSeasonUnwatched'), icon: 'eyeOff'} : {id: 'watched', label: i18n.t('title.markSeasonWatched'), icon: 'check'});
      if (canEdit && data?.selected.seasonId) items.push({id: 'edit', label: i18n.t('entry.editMetadata'), icon: 'edit', section: ''});
    }
    // How this show is listed (seasons, numbering, order) is the owner's, for everyone.
    if (owner && data) items.push({id: 'settings', label: i18n.t('title.showSettings'), icon: 'sliders', section: ''});
    return items;
  }, [stable, loaded, seasonWatched, marking, canEdit, owner, data, selectedSeasonId, flat, i18n]);
  const markSeason = useCallback(async (watched: boolean) => {
    if (!selectedSeasonId) return;
    setMarking(true);
    try {
      const marked = await seasonState.setWatched(watched);
      const reread = () => { seasonState.refresh(); showState.refresh(); retry(); };
      // Undo puts back exactly which episodes were watched and where each had got to.
      announceMark(api, 'season', selectedSeasonId, marked, i18n.t(watched ? 'title.seasonMarkedWatched' : 'title.seasonMarkedUnwatched', {season: seasonTitle}), reread);
      reread();
    } catch (e) {
      showToast({message: say(e, 'show', 'save'), icon: 'warning'});
    } finally {
      setMarking(false);
    }
  }, [selectedSeasonId, seasonState, showState, i18n, seasonTitle, retry, api]);
  const markShow = useCallback(async (watched: boolean) => {
    if (!show) return;
    setMarking(true);
    try {
      const marked = await showState.setWatched(watched);
      const reread = () => { showState.refresh(); seasonState.refresh(); retry(); };
      announceMark(api, 'show', show.id, marked, i18n.t(watched ? 'title.seasonMarkedWatched' : 'title.seasonMarkedUnwatched', {season: show.title}), reread);
      seasonState.refresh();
      retry();
    } catch (e) {
      showToast({message: say(e, 'show', 'save'), icon: 'warning'});
    } finally {
      setMarking(false);
    }
  }, [show, showState, seasonState, retry, api, i18n]);
  const setShowFlag = (flag: 'watchlisted' | 'favorite') => { void showState.setFlag(flag, !showState.state?.[flag]).catch(e => showToast({message: say(e, 'show', 'save'), icon: 'warning'})); };
  const onSeasonAction = (id: string) => {
    if (id === 'play') {
      // "Play season" is the season from its first episode, also while the list is sorted another way.
      const first = loaded.find(e => e.playback);
      if (!sortedOn) playAt(0, 0);
      else if (first) { invoker.remember(); player.playSequence([first], 0, 0, sequenceContainer('season', data?.selected.seasonId ?? undefined, {group: !!data?.selected.group})); }
    }
    else if (id === 'settings') setShowSettings(true);
    else if (id === 'watched' || id === 'unwatched') void markSeason(id === 'watched');
    else if (id === 'edit' && data?.selected.seasonId) {
      const t = repairTargetFor({id: data.selected.seasonId, kind: 'season', libraryId});
      if (t) editor?.open({targets: [t], titles: [`${show?.title ?? ''} · ${seasonTitle}`], onSaved: retry});
    }
  };
  // ── Hero ──────────────────────────────────────────────────────────────────
  const claim = useEntryFocus(!!primaryEntry);
  // When the episodes arrive after the show, tvOS has already put focus on the
  // hero's first focusable (the synopsis "More"); a late hasTVPreferredFocus
  // doesn't move it, so the claim asks for focus directly.
  const primaryPlayable = !!primaryEntry?.playback;
  // Opened for an episode, television puts focus on that episode's row instead.
  const forEpisode = !!episodeId;
  useEffect(() => {
    if (isTV && claim && primaryPlayable && !forEpisode) invoker.ref.current?.focus();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isTV, claim, primaryPlayable]);
  const code =primaryEntry ? episodeCode(i18n, primaryEntry) : '';
  const primary = primaryEntry?.playback ? {
    label: code ? i18n.t(primaryResumes ? 'title.resumeEpisode' : 'title.playEpisode', {code}) : i18n.t(primaryResumes ? 'entry.resume' : 'entry.play'),
    progress: primaryResumes ? resumeFraction(primaryEntry) : undefined,
    preferFocus: isTV && claim && !forEpisode,
    // A server nextUp from another season isn't in this list: the show plays
    // from it (one v1 request anchored at the episode), so Up Next continues.
    onPress: () => {
      // The season's own order is what Play continues in, whatever order the list below is shown in.
      const at = sortedOn ? -1 : loaded.findIndex(e => e.id === primaryEntry.id);
      if (at >= 0) { playAt(at, primaryResumes ? startOf(primaryEntry) : 0); return; }
      if (!primaryEntry.playback || !show) return;
      invoker.remember();
      player.playSequence([primaryEntry], 0, primaryResumes ? startOf(primaryEntry) : 0, sequenceContainer('show', show.id));
    },
  } : undefined;
  const seasons = data?.seasonTotalCount ?? 0;
  // The hero's ⋯ is the menu a card of this show opens (download all, edit metadata), minus what the row already has.
  const showEntry = useMemo<ContentEntry | undefined>(() => (show ? {id: show.id, libraryId: show.libraryId, kind: 'show', title: show.title, posterUrl: show.posterUrl, backdropUrl: show.backdropUrl, navigation: {view: 'show', entityId: show.id}} : undefined), [show]);
  const people = useMemo(() => showPeople(show?.credits), [show?.credits]);
  const creditLines = useMemo(() => {
    const lines = showCreditLines(people.crew, (role, names) => i18n.t(role === 'creator' ? 'title.createdBy' : role === 'director' ? 'title.directedBy' : 'title.writtenBy', {names}));
    const starring = dedupeNames(people.cast.map(c => c.name), 4);
    return starring.length ? [...lines, i18n.t('title.starring', {names: i18n.list(starring)})] : lines;
  }, [people, i18n]);
  const watchlisted = !!showState.state?.watchlisted, favorite = !!showState.state?.favorite, showWatched = !!showState.state?.watched;
  // The same row as a movie (Justin, 2 Oct 2026): Watchlist · Favorite · Watched · ⋯.
  const secondary: HeroAction[] = show && showState.state ? [
    {icon: (watchlisted ? 'bookmarkFilled' : 'bookmark') as IconName, label: i18n.t(watchlisted ? 'entry.removeFromWatchlist' : 'entry.addToWatchlist'), short: i18n.t('title.watchlist'), selected: watchlisted, onPress: () => setShowFlag('watchlisted')},
    {icon: (favorite ? 'heartFilled' : 'heart') as IconName, label: i18n.t(favorite ? 'entry.removeFromFavorites' : 'entry.addToFavorites'), iconOnly: true, selected: favorite, onPress: () => setShowFlag('favorite')},
    {icon: (showWatched ? 'watched' : 'check') as IconName, label: i18n.t(showWatched ? 'entry.markShowUnwatched' : 'entry.markShowWatched'), iconOnly: true, selected: showWatched, onPress: () => { if (!marking) void markShow(!showWatched); }},
  ] : [];
  // Genres are links: each opens this show's library filtered to it.
  const genreLinks = show?.genres?.length ? {names: dedupeNames(show.genres), onPress: (name: string) => navigation.push('Library', {libraryId: show.libraryId, tab: 'browse' as const, genre: name})} : undefined;
  const hero = (
    <TitleHero
      ref={invoker.ref}
      loading={!show}
      backdrop={show?.backdropUrl ? artwork(show.backdropUrl) : undefined}
      art={show ? {source: artwork(show.posterUrl), shape: 'poster', icon: 'tv'} : undefined}
      logo={show?.logoUrl ? artwork(show.logoUrl) : undefined}
      eyebrow={show ? i18n.t('title.kind', {kind: show.libraryKind === 'anime' ? 'anime' : 'show'}) : undefined}
      title={show?.title ?? title}
      originalTitle={originalTitleLine(show?.title, show?.originalTitle)}
      facts={[show?.year, seasons > 0 && !flat ? i18n.t('title.seasonCount', {count: seasons}) : data && total ? i18n.t('count.episodes', {count: total}) : undefined, networkName(show?.network)]}
      genres={genreLinks}
      rating={show?.contentRating}
      synopsis={show?.overview}
      credits={creditLines}
      primary={primary}
      secondary={secondary}
      onMore={showEntry ? () => player.more(showEntry, 'page') : undefined}
    />
  );
  // "6 of 10 watched" beside the switcher, from the season's own counts (the viewer's visible episodes).
  const progress = seasonProgress(seasonState.state?.watchedCount, seasonState.state?.unwatchedCount);
  const notices = changedStuck ? (
    <Notice tone="warning" message={say(snapshot.error ?? 'stale', 'show', 'load')} action={i18n.t('action.refresh')} onAction={retry} style={{marginHorizontal: space.page, marginBottom: space.lg}} />
  ) : null;
  const switcher = data ? (
    <SeasonSwitcher choices={choices} selected={selected} onSelect={id => { if (id !== selected) { setOpen(null); choose(id); } }} seasonActions={seasonActions} onSeasonAction={onSeasonAction} episodeTotal={stable && !sortedOn ? total : undefined} onJumpToEpisode={index => (isTV ? setRailJump({index}) : listRef.current?.scrollToIndex(index))} progress={progress ? i18n.t('title.seasonProgress', progress) : undefined} />
  ) : null;
  // Next up is marked on its own row (a chip), never repeated above the list: the hero's Play already resumes it.
  const chip = nextUpChip(nextUp, nextUp);
  const tag = chip ? i18n.t(chip) : undefined;
  const marks = useMemo<EpisodeMarks>(() => ({
    ...(open ? {open: {id: open.entry.id, index: open.index}} : {}),
    ...(landing?.index !== undefined ? {landingId: landing.id} : {}),
    ...(nextUp && tag ? {nextUpId: nextUp.id, tag} : {}),
  }), [open, landing, nextUp, tag]);
  const showTitle = show?.title;
  const renderDetails = useCallback<RenderDetails>((entry, index, {columns}) => (
    <EpisodeDetails
      key={entry.id}
      libraryId={libraryId}
      entry={entry}
      index={index}
      showTitle={showTitle}
      heading={isTV}
      columns={columns}
      focusOnOpen={isTV}
      onPlay={playFromDetails}
      onChanged={retry}
      onPerson={(personId, name) => navigation.push('Person', {personId, name})}
    />
  ), [libraryId, showTitle, isTV, playFromDetails, retry, navigation]);
  const closeOpen = useCallback(() => setOpen(null), []);
  const recommendationRows = relatedRowsForPage((recommendations.data?.rows ?? []).map(row => withoutNotInterested(row, turnedDown, true)));
  const personWidth = isTV ? 150 : 84;
  const detailRows: (readonly [string, string])[] = show ? ([
    networkName(show.network) ? [i18n.t('title.network'), networkName(show.network)!] : null,
    show.studio ? [i18n.t('title.studio'), show.studio] : null,
    show.country ? [i18n.t('title.country'), show.country] : null,

  ] as ((readonly [string, string]) | null)[]).filter((r): r is readonly [string, string] => !!r) : [];
  const related = people.cast.length || people.crew.length || detailRows.length || recommendationRows.length || recommendations.phase === 'error' || recommendations.phase === 'loading' || tools.mergeRow ? (
    <View style={{marginTop: space.xl}}>
      {people.cast.length ? <RowGuide><Shelf title={i18n.t('title.cast')} data={people.cast.slice(0, 12)} itemWidth={personWidth} keyExtractor={c => c.id ?? c.name} renderItem={({item: c}) => <PersonCard name={c.name} subtitle={c.role} width={personWidth} source={artwork(c.portraitUrl)} onPress={c.id ? () => navigation.push('Person', {personId: c.id!, name: c.name}) : undefined} />} /></RowGuide> : null}
      {people.crew.length ? <RowGuide><Shelf title={i18n.t('title.crew')} data={people.crew} itemWidth={personWidth} keyExtractor={c => c.id ?? c.name} renderItem={({item: c}) => <PersonCard name={c.name} subtitle={c.role || c.department} width={personWidth} source={artwork(c.portraitUrl)} onPress={c.id ? () => navigation.push('Person', {personId: c.id!, name: c.name}) : undefined} />} /></RowGuide> : null}
      {recommendations.phase === 'loading' ? <View style={{paddingHorizontal: space.page, marginBottom: space.lg}}><Skeleton width={metrics.posterWidth} height={metrics.posterWidth * 1.5} /></View> : null}
      {recommendations.phase === 'error' ? <Notice tone="error" message={say(recommendations.error, 'show', 'load')} action={i18n.t('action.tryAgain')} onAction={recommendations.retry} style={{marginHorizontal: space.page, marginBottom: space.lg}} /> : null}
      {recommendationRows.map((row, index) => <RowGuide key={row.id}><SectionView row={3 + index} origin="recommendation" libraryId={libraryId} section={{id: row.id, type: 'rail', heading: homeRowHeading(row), entries: row.entries, totalCount: row.entries.length, nextCursor: ''}} /></RowGuide>)}
      <TitleDetails rows={detailRows} genres={genreLinks ? {...genreLinks, names: dedupeNames(show?.genres ?? [], 20)} : undefined} tools={tools.mergeRow} />
      {tools.sheets}
    </View>
  ) : null;
  const bar = <GroupBar group={group} />;
  const emptyState = sortedOn
    ? (sorted.snapshot.status === 'ready' && sorted.snapshot.total === 0 ? <StateView icon="filter" title={i18n.t('library.noMatch')} message={i18n.t('library.noMatchBody')} action={i18n.t('library.clearFilters')} onAction={group.reset} /> : null)
    : stable && seed && seed.total === 0 ? <StateView icon="tv" title={i18n.t('title.noEpisodes')} message={i18n.t('title.noEpisodesBody')} /> : null;

  if (snapshot.phase === 'error' && !data) {
    return (
      <View style={{flex: 1}}>
        <Page>
          {!isTV ? <Button variant="ghost" size="sm" icon="back" label={i18n.t('action.back')} onPress={() => navigation.goBack()} style={{marginLeft: space.page - space.sm, marginTop: space.lg}} /> : null}
          <StateView icon="warning" title={i18n.t('error.title.load', {subject: 'show'})} message={say(snapshot.error, 'show', 'load')} action={i18n.t('action.tryAgain')} onAction={retry} />
        </Page>
      </View>
    );
  }
  const settingsSheet = showSettings && data ? <ShowSettingsSheet libraryId={libraryId} showId={data.show.id} settings={data.settings} onClose={() => setShowSettings(false)} onSaved={() => { setShowSettings(false); retry(); }} /> : null;
  if (isTV) {
    return (
      <EpisodeTintContext.Provider value={show?.id}>
      <View style={{flex: 1}}>
        <Page titled contentStyle={{paddingTop: 0}}>
          {hero}
          {notices}
          {/* Focus in the episodes brings the switcher near the top, with the row below it. */}
          <View {...({scrollSnapOffset: Math.round(window.height * 0.1)} as object)} style={{marginTop: space.md}}>
            {switcher}
            {bar}
            {list && total > 0 ? (
              <EpisodeBrowser list={list} total={total} initialIndex={!sortedOn && nextUp ? Math.max(0, loaded.findIndex(e => e.id === nextUp.id)) : 0} jump={sortedOn ? undefined : railJump} marks={marks} handlers={handlers} renderDetails={renderDetails} onClose={closeOpen} />
            ) : emptyState ?? <ListSkeleton />}
          </View>
          {related}
        </Page>
        {settingsSheet}
      </View>
      </EpisodeTintContext.Provider>
    );
  }
  return (
    <EpisodeTintContext.Provider value={show?.id}>
    <View style={{flex: 1}}>
      <EpisodeList
        ref={listRef}
        list={list}
        total={total}
        marks={marks}
        handlers={handlers}
        renderDetails={renderDetails}
        refreshControl={pull}
        header={<View>{hero}{notices}{switcher}{bar}</View>}
        footer={related}
        empty={emptyState ?? (data || snapshot.phase === 'loading' ? <ListSkeleton /> : null)}
      />
      <StatusBarScrim onBack={() => navigation.goBack()} title={show?.title ?? title} />
      {settingsSheet}
    </View>
    </EpisodeTintContext.Provider>
  );
}

/** How the show is listed, for everyone: the owner's four switches, saved together. */
function ShowSettingsSheet({libraryId, showId, settings, onClose, onSaved}: {libraryId: string; showId: string; settings: ShowSettings; onClose: () => void; onSaved: () => void}) {
  const {api} = useSession();
  const i18n = useI18n();
  const [draft, setDraft] = useState(settings);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const dirty = SHOW_SETTING_ROWS.some(row => draft[row.key] !== settings[row.key]);
  const save = () => {
    setBusy(true); setError('');
    saveShowSettings(api, libraryId, showId, draft).then(onSaved, e => setError(say(e, 'show', 'save'))).finally(() => setBusy(false));
  };
  return (
    <Sheet open onClose={onClose} kind="form" title={i18n.t('title.showSettings')} subtitle={i18n.t('title.showSettings.lede')} primary={{label: i18n.t('action.save'), loading: busy, disabled: !dirty, onPress: save}}>
      {error ? <Notice tone="error" message={error} /> : null}
      {SHOW_SETTING_ROWS.map(row => (
        <ListRow key={row.key} title={i18n.t(row.label)} description={i18n.t(row.help)} trailing={<Switch value={draft[row.key]} onValueChange={v => setDraft({...draft, [row.key]: v})} accessibilityLabel={i18n.t(row.label)} />} onPress={() => setDraft({...draft, [row.key]: !draft[row.key]})} />
      ))}
    </Sheet>
  );
}

function ListSkeleton() {
  const {space, metrics} = useTheme();
  const g = useEpisodeRowGeometry();
  return (
    <View>
      {[0, 1, 2, 3].map(i => (
        <View key={i} style={{height: g.height, flexDirection: 'row', alignItems: 'center', gap: space.md, paddingHorizontal: space.page}}>
          <Skeleton width={g.still} height={g.stillHeight} radius={metrics.radius.card} />
          <View style={{flex: 1, gap: space.xs}}>
            <Skeleton height={16} width="70%" />
            <Skeleton height={12} width="40%" />
          </View>
        </View>
      ))}
    </View>
  );
}
