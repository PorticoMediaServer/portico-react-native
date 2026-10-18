import React, {useEffect, useMemo, useRef, useState} from 'react';
import {ScrollView, View} from 'react-native';
import type {ContentEntry} from '../../../../../packages/client-core/src/library-content';
import {formatDuration, useArtwork} from '../../app/content';
import {useDetail} from '../../app/detail';
import {say} from '../../app/errors';
import {useI18n} from '../../app/i18n';
import {useSession} from '../../app/session';
import {Button, Notice, PersonCard, Skeleton, Text, spec, useSpecPlatform, useTheme, type FocusableHandle} from '../../ui';
import {episodeMeta} from './Episodes';
import {PlaybackChoices} from './PlaybackChoices';
import {usePlayerActions} from '../../app/player-actions';
import {episodeCode, isActing, namesIn} from './facts';
import {episodeContext} from './episode-open';
import {loadEpisodeCast, type EpisodeCredit} from './episode-credits';

export type EpisodePlay = {entry: ContentEntry; index?: number; startSeconds: number};

/**
 * An episode opened in place (Spec — Title Pages §3, Justin 18 Oct 2026): a small title page in
 * the show page's own flow, never a sheet, panel or layer. Under its row in the list on
 * iPhone/iPad; in the place of the focused episode's preview, beside its row, on television.
 *
 * "Breaking Bad · Season 2", the code and title where nothing above says them, aired · runtime ·
 * rating, the whole synopsis, pick before play, Play/Resume, Play from start, Mark as watched,
 * My List, Favorite, Watched and ⋯ (download, playlist) — the hero's actions, for the episode; then
 * the episode's guest stars, director and writers (beside it on wide screens). No files: they are
 * the title page's (Justin, 18 Oct 2026). Credits are the episode's own (scope `episode`); nothing
 * is merged with the show's.
 */
export function EpisodeDetails({libraryId, entry, index, showTitle, heading, columns, focusOnOpen, onPlay, onChanged, onPerson}: {
  libraryId: string;
  /** The row's entry, so the details aren't empty while the episode's detail loads. */
  entry: ContentEntry;
  /** Position in the list on screen, so Play continues through the season. */
  index?: number;
  showTitle?: string;
  /** The code and title as a heading, with aired · runtime: off under a list row, which says them just above. */
  heading: boolean;
  /** The people beside the main column (wide screens); below it otherwise. */
  columns: boolean;
  /** Television: Play (else the first button) takes focus once the details appear. */
  focusOnOpen?: boolean;
  onPlay: (play: EpisodePlay) => void;
  /** Personal state changed (watched): the list should re-read. */
  onChanged: () => void;
  onPerson: (personId: string, name: string) => void;
}) {
  const {space, isTV, colors, metrics} = useTheme();
  const platform = useSpecPlatform();
  const i18n = useI18n();
  const {api} = useSession();
  const artwork = useArtwork();
  const player = usePlayerActions();
  const [allCast, setAllCast] = useState<{key: string; credits: readonly EpisodeCredit[]} | null>(null);
  const [castLoading, setCastLoading] = useState(false);
  const [castError, setCastError] = useState<unknown>();
  const castRequest = useRef<AbortController | null>(null);
  const target = useMemo(() => ({libraryId, itemId: entry.id}), [libraryId, entry.id]);
  const {snapshot, mutate, retry, retryMutation} = useDetail(target);
  const data = snapshot.data && snapshot.data.item.id === entry.id ? snapshot.data : null;
  const castKey = data ? JSON.stringify([data.scope.serverId, data.scope.viewerFence, data.item.id]) : '';
  useEffect(() => {
    castRequest.current?.abort();
    castRequest.current = null;
    setAllCast(null);
    setCastLoading(false);
    setCastError(undefined);
    return () => { castRequest.current?.abort(); };
  }, [castKey, api]);
  const item = data?.item;
  const personal = data?.personal;
  const actions = data?.actions.filter(a => a.enabled) ?? [];
  const play = actions.find(a => a.playback && a.id !== 'start_over');
  const canMarkWatched = actions.some(a => a.id === 'watched');
  const canList = actions.some(a => a.id === 'watchlist');
  const canFavorite = actions.some(a => a.id === 'favorite');
  const listed = !!personal?.watchlisted, favorite = !!personal?.favorite;
  const progress = item ? (item.progressSeconds ?? 0) : entry.progressSeconds ?? 0;
  const watched = personal?.watched ?? entry.watched ?? false;
  const resuming = progress > 0 && !watched;
  const duration = item?.duration ?? entry.duration;
  // A watched change made here re-reads the list, so its tick and bar follow.
  const lastWatched = useRef<boolean | undefined>(undefined);
  useEffect(() => {
    if (personal === undefined) return;
    if (lastWatched.current !== undefined && lastWatched.current !== personal.watched) onChanged();
    lastWatched.current = personal.watched;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [personal?.watched]);
  // Television: the details take focus as they appear (the control that opened them may be gone).
  const first = useRef<FocusableHandle>(null);
  const playable = !!(play?.playback || entry.playback);
  useEffect(() => {
    if (focusOnOpen && isTV) first.current?.focus();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  const credits = data?.metadata.credits ?? [];
  const firstCast = credits.filter(c => isActing(c.department));
  const cast = allCast?.key === castKey ? allCast.credits : firstCast;
  const showAllCast = () => {
    if (!castKey || castLoading || allCast?.key === castKey) return;
    const controller = new AbortController();
    castRequest.current = controller;
    setCastLoading(true);
    setCastError(undefined);
    void loadEpisodeCast(api, entry.id, controller.signal).then(loaded => {
      if (!controller.signal.aborted) setAllCast({key: castKey, credits: loaded});
    }).catch(error => {
      if (!controller.signal.aborted) setCastError(error);
    }).finally(() => {
      if (!controller.signal.aborted) setCastLoading(false);
    });
  };
  const directors = namesIn(credits, ['directing', 'director', 'direction']);
  const writers = namesIn(credits, ['writing', 'writer', 'writers']);
  // The director and writers as people (B-18.30): one card each, opening their page where the server knows who they are.
  const crewDepartments = ['directing', 'director', 'direction', 'writing', 'writer', 'writers'];
  const crew = [...new Map(credits.filter(c => crewDepartments.includes(c.department.toLowerCase()) && c.personId).map(c => [c.personId!, c])).values()];

  const start = play?.playback?.startSeconds ?? entry.playback?.startSeconds ?? entry.progressSeconds ?? 0;
  const primaryLabel = resuming && duration ? i18n.t('title.resumeRemaining', {remaining: formatDuration(Math.max(0, duration - progress))}) : resuming ? i18n.t('entry.resume') : i18n.t('action.play');
  const size = isTV ? 'lg' : 'md';
  const code = episodeCode(i18n, entry);
  const context = episodeContext(i18n.t, showTitle, item?.episode?.seasonNumber ?? entry.seasonNumber);
  const facts = heading ? episodeMeta(i18n, {...entry, duration}) : undefined;
  const rating = data?.facts?.contentRating;
  const overview = item?.overview ?? entry.overview;
  const badge = spec.hero.facts.badge;
  const personWidth = isTV ? 120 : 72;
  const people = (list: readonly EpisodeCredit[], role: (c: EpisodeCredit) => string | undefined) => (
    <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{gap: space.md, paddingVertical: isTV ? space.md : 0}} style={isTV ? {marginVertical: -space.md} : undefined}>
      {list.map(c => <PersonCard key={c.id} name={c.name} subtitle={role(c)} width={personWidth} source={artwork(c.portraitUrl)} onPress={c.personId ? () => onPerson(c.personId!, c.name) : undefined} />)}
    </ScrollView>
  );

  const main = (
    <View style={{flex: columns ? 1.6 : undefined, minWidth: 0, gap: space.sm}}>
      {context ? <Text variant="captionStrong" tone="secondary" lines={1}>{context}</Text> : null}
      {heading ? (
        <Text variant={isTV ? 'title' : 'heading'} lines={2}>
          {code ? <Text variant={isTV ? 'title' : 'heading'} tone="tertiary">{code}  </Text> : null}
          {entry.title}
        </Text>
      ) : null}
      {facts || rating ? (
        <View style={{flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', gap: space.sm}}>
          {facts ? <Text variant="body" tone="secondary" lines={1}>{facts}</Text> : null}
          {rating ? (
            <View style={{height: badge.height[platform], justifyContent: 'center', borderWidth: 1, borderColor: colors[badge.border], borderRadius: metrics.radius.small, paddingHorizontal: badge.paddingX[platform]}}>
              <Text variant={badge.role}>{rating}</Text>
            </View>
          ) : null}
        </View>
      ) : null}
      {snapshot.phase === 'error' && !data ? <Notice tone="error" message={say(snapshot.error, 'detail', 'load')} action={i18n.t('action.tryAgain')} onAction={() => void retry()} /> : null}
      {overview ? <Text variant="body" tone="secondary" style={{maxWidth: 960}}>{overview}</Text> : !data && snapshot.phase === 'loading' ? <Skeleton height={14} width="90%" /> : null}
      {playable && play?.playback ? <PlaybackChoices libraryId={libraryId} itemId={play.playback.itemId} /> : null}
      <View style={{flexDirection: 'row', flexWrap: 'wrap', gap: space.sm, marginTop: space.xs}}>
        {playable ? <Button ref={first} variant="primary" icon="play" label={primaryLabel} size={size} onPress={() => onPlay({entry, index, startSeconds: resuming ? start : 0})} /> : null}
        {playable && resuming ? <Button variant="secondary" icon="restart" label={i18n.t('title.playFromStart')} size={size} onPress={() => onPlay({entry, index, startSeconds: 0})} /> : null}
        {canList ? <Button variant="secondary" icon={listed ? 'bookmarkFilled' : 'bookmark'} label={i18n.t(listed ? 'title.inWatchlist' : 'title.watchlist')} selected={listed} size={size} onPress={() => mutate({action: 'watchlist', value: !listed})} /> : null}
        {canFavorite ? <Button variant="secondary" icon={favorite ? 'heartFilled' : 'heart'} accessibilityLabel={i18n.t(favorite ? 'entry.removeFromFavorites' : 'entry.addToFavorites')} selected={favorite} size={size} onPress={() => mutate({action: 'favorite', value: !favorite})} /> : null}
        {canMarkWatched ? <Button variant="secondary" icon={watched ? 'watched' : 'check'} accessibilityLabel={i18n.t(watched ? 'title.markUnwatched' : 'title.markWatched')} selected={watched} size={size} onPress={() => mutate({action: 'watched', value: !watched})} /> : null}
        <Button ref={playable ? undefined : first} variant="secondary" icon="more" accessibilityLabel={i18n.t('title.moreActions')} size={size} onPress={() => player.more(entry)} />
      </View>
      {snapshot.mutationError ? <Notice tone="error" message={say(snapshot.mutationError, 'detail', 'save')} action={i18n.t('title.retry')} onAction={retryMutation} /> : null}
      {/* The episode stays in the library while its files are gone; it says since when, and that it comes back by itself. */}
      {data?.missingSince ? <Notice tone="warning" title={i18n.t('title.missing')} message={i18n.t('title.missingSince', {when: i18n.date(data.missingSince, 'long')})} /> : null}
    </View>
  );
  const hasSide = cast.length > 0 || directors.length > 0 || writers.length > 0 || crew.length > 0;
  const side = hasSide ? (
    <View style={{flex: columns ? 1 : undefined, minWidth: 0, gap: space.md}}>
      {cast.length ? (
        <View style={{gap: space.sm}}>
          <View style={{flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between'}}>
            <Text variant="label" tone="tertiary">{i18n.t('title.cast')}</Text>
            {allCast?.key !== castKey ? <Button variant="ghost" size="sm" label={i18n.t('action.seeAll')} loading={castLoading} onPress={showAllCast} /> : null}
          </View>
          {castError ? <Notice tone="error" message={say(castError, 'detail', 'load')} /> : null}
          {people(cast, c => c.role)}
        </View>
      ) : null}
      {directors.length || writers.length ? (
        <View style={{gap: space.xxs}}>
          {directors.length ? <Text variant="caption" tone="secondary">{i18n.t('title.directedBy', {names: i18n.list(directors)})}</Text> : null}
          {writers.length ? <Text variant="caption" tone="secondary">{i18n.t('title.writtenBy', {names: i18n.list(writers)})}</Text> : null}
        </View>
      ) : null}
      {crew.length ? people(crew, c => c.role || c.department) : null}
    </View>
  ) : null;
  return (
    <View accessibilityLabel={[code, entry.title].filter(Boolean).join(', ')} style={{flexDirection: columns && side ? 'row' : 'column', gap: columns && side ? space.xxl : space.lg, alignItems: columns && side ? 'flex-start' : 'stretch'}}>
      {main}
      {side}
    </View>
  );
}
