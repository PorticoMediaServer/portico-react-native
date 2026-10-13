import React, {useEffect, useMemo, useRef, useState} from 'react';
import {ScrollView, View} from 'react-native';
import type {ContentEntry} from '../../../../../packages/client-core/src/library-content';
import {formatDuration, useArtwork} from '../../app/content';
import {useDetail} from '../../app/detail';
import {say} from '../../app/errors';
import {useI18n} from '../../app/i18n';
import {useSession} from '../../app/session';
import {Artwork, Button, Notice, PersonCard, ProgressBar, Sheet, Skeleton, Text, useTheme} from '../../ui';
import {episodeMeta, episodeTitle} from './Episodes';
import {TitleDetails} from './TitleDetails';
import {useTitleTools} from '../server/TitleTools';
import {PlaybackChoices} from './PlaybackChoices';
import {usePlayerActions} from '../../app/player-actions';
import {episodeCode, isActing, namesIn, resumeFraction} from './facts';
import {episodeArt} from './layout';
import {EpisodeStillPlaceholder} from './Episodes';
import {loadEpisodeCast, type EpisodeCredit} from './episode-credits';

export type EpisodePlay = {entry: ContentEntry; index?: number; startSeconds: number};

/**
 * The episode view (Spec — Title Pages §3): a light layer over the show page, never a page with
 * its own hero. Television: a panel (select on a card already plays; this opens from long-press
 * or the card's text). iPhone/iPad: a sheet from the episode's text.
 *
 * Still, "S2 E4 · Title", air date and runtime, synopsis, pick before play, Play/Resume, Play
 * from start, Mark as watched, ⋯ (download, playlist), the episode's cast, director and writers,
 * its files, and previous/next episode. Credits are the
 * episode's own (scope `episode`); nothing is merged with the show's.
 */
export function EpisodePanel({open, libraryId, entry, index, total, neighbour, showTitle, onClose, onPlay, onNavigate, onChanged, onPerson}: {
  open: boolean;
  libraryId: string;
  entry: ContentEntry | null;
  /** Position in the season's list, when known (previous/next need it). */
  index?: number;
  total?: number;
  /** The resident episode at a position, if loaded. */
  neighbour: (index: number) => ContentEntry | undefined;
  showTitle?: string;
  onClose: () => void;
  onPlay: (play: EpisodePlay) => void;
  onNavigate: (index: number) => void;
  /** Personal state changed (watched): the list should re-read. */
  onChanged: () => void;
  onPerson: (personId: string, name: string) => void;
}) {
  const {space, isTV, window, metrics} = useTheme();
  const i18n = useI18n();
  const {api} = useSession();
  const artwork = useArtwork();
  const player = usePlayerActions();
  const [allCast, setAllCast] = useState<{key: string; credits: readonly EpisodeCredit[]} | null>(null);
  const [castLoading, setCastLoading] = useState(false);
  const [castError, setCastError] = useState<unknown>();
  const castRequest = useRef<AbortController | null>(null);
  const target = useMemo(() => (open && entry ? {libraryId, itemId: entry.id} : null), [open, libraryId, entry]);
  const {snapshot, mutate, retry, retryMutation} = useDetail(target);
  const data = snapshot.data && snapshot.data.item.id === entry?.id ? snapshot.data : null;
  const castKey = data ? JSON.stringify([data.scope.serverId, data.scope.viewerFence, data.item.id]) : '';
  useEffect(() => {
    castRequest.current?.abort();
    castRequest.current = null;
    setAllCast(null);
    setCastLoading(false);
    setCastError(undefined);
    return () => { castRequest.current?.abort(); };
  }, [castKey, open, api]);
  const item = data?.item;
  // The owner's tools for this episode's files (delete one version, merge with another episode); nothing for a member or on television.
  const tools = useTitleTools(item ? {id: item.id, title: item.title, kind: item.kind, libraryId} : undefined, data?.files, () => void retry(), {inPlace: true});
  const personal = data?.personal;
  const actions = data?.actions.filter(a => a.enabled) ?? [];
  const play = actions.find(a => a.playback && a.id !== 'start_over');
  const canMarkWatched = actions.some(a => a.id === 'watched');
  const progress = item ? (item.progressSeconds ?? 0) : entry?.progressSeconds ?? 0;
  const watched = personal?.watched ?? entry?.watched ?? false;
  const resuming = progress > 0 && !watched;
  const duration = item?.duration ?? entry?.duration;
  // A watched change made here re-reads the list, so its tick and bar follow.
  const lastWatched = useRef<boolean | undefined>(undefined);
  useEffect(() => {
    if (personal === undefined) return;
    if (lastWatched.current !== undefined && lastWatched.current !== personal.watched) onChanged();
    lastWatched.current = personal.watched;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [personal?.watched]);
  useEffect(() => { lastWatched.current = undefined; }, [entry?.id]);
  if (!entry) return null;
  const title = episodeTitle(i18n, entry);
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
  const previous = index !== undefined && index > 0 ? neighbour(index - 1) : undefined;
  const next = index !== undefined && (total === undefined || index + 1 < total) ? neighbour(index + 1) : undefined;
  // The panel is a trailing side sheet on TV and iPad (640 / 440 wide) and a half-height sheet on iPhone.
  const phone = !isTV && window.width < 700;
  // iPhone's half sheet keeps the actions above the fold: a small still beside the title.
  const stillWidth = phone ? Math.round(Math.min(window.width * 0.4, 180)) : (isTV ? 640 : 440) - space.md * 4;
  const start = play?.playback?.startSeconds ?? entry.playback?.startSeconds ?? entry.progressSeconds ?? 0;
  const primaryLabel = resuming && duration ? i18n.t('title.resumeRemaining', {remaining: formatDuration(Math.max(0, duration - progress))}) : resuming ? i18n.t('entry.resume') : i18n.t('entry.play');
  const playable = !!(play?.playback || entry.playback);
  const pad = {paddingHorizontal: space.md};
  // M26: the episode's own still, else the styled placeholder — never the show backdrop.
  const stillArt = episodeArt({stillUrl: entry.stillUrl ?? item?.stillUrl});
  const still = (
    <View style={{borderRadius: metrics.radius.card, overflow: 'hidden', alignSelf: 'flex-start'}}>
      {stillArt.kind === 'still' ? (
        <Artwork source={artwork(stillArt.path)} shape="landscape" width={stillWidth} title={entry.title} priority />
      ) : (
        <EpisodeStillPlaceholder code={episodeCode(i18n, entry)} width={stillWidth} />
      )}
    </View>
  );
  const heading = (
    <View style={{flex: 1, minWidth: 0, gap: space.xs}}>
      {showTitle ? <Text variant="label" tone="tertiary" lines={1}>{showTitle}</Text> : null}
      <Text variant={isTV ? 'title' : 'heading'} lines={2}>{title}</Text>
      {episodeMeta(i18n, {...entry, duration}) ? <Text variant="body" tone="secondary" lines={1}>{episodeMeta(i18n, {...entry, duration})}</Text> : null}
      {resuming ? <ProgressBar value={resumeFraction({progressSeconds: progress, duration, watched}) ?? 0} height={3} style={{marginTop: space.xs, maxWidth: 240}} /> : null}
    </View>
  );
  const buttons = (
      <View style={{flexDirection: 'row', flexWrap: 'wrap', gap: space.sm}}>
        {playable ? <Button variant="primary" icon="play" label={primaryLabel} size={isTV ? 'lg' : 'md'} hasTVPreferredFocus={isTV} onPress={() => { onClose(); onPlay({entry, index, startSeconds: resuming ? start : 0}); }} /> : null}
        {playable && resuming ? <Button variant="secondary" icon="restart" label={i18n.t('title.playFromStart')} size={isTV ? 'lg' : 'md'} onPress={() => { onClose(); onPlay({entry, index, startSeconds: 0}); }} /> : null}
        {canMarkWatched ? <Button variant="secondary" icon={watched ? 'watched' : 'check'} label={watched ? i18n.t('entry.markUnwatched') : i18n.t('entry.markWatched')} selected={watched} size={isTV ? 'lg' : 'md'} onPress={() => mutate({action: 'watched', value: !watched})} /> : null}
        <Button variant="secondary" icon="more" accessibilityLabel={i18n.t('title.moreActions')} size={isTV ? 'lg' : 'md'} onPress={() => { onClose(); player.more(entry); }} />
      </View>
  );
  return (
    <Sheet open={open} onClose={onClose} title={isTV ? undefined : i18n.t('title.episodeDetails')} kind="picker" placement="side" detent="half">
      <View style={{gap: space.lg, paddingBottom: space.md}}>
        <View style={[pad, {gap: space.md}]}>
          {phone ? (
            <View style={{flexDirection: 'row', gap: space.md, alignItems: 'center'}}>
              {still}
              {heading}
            </View>
          ) : (
            <>
              {still}
              {heading}
            </>
          )}
          {playable && play?.playback ? <PlaybackChoices libraryId={libraryId} itemId={play.playback.itemId} /> : null}
          {buttons}
        </View>
        {snapshot.mutationError ? <Notice tone="error" message={say(snapshot.mutationError, 'detail', 'save')} action={i18n.t('title.retry')} onAction={retryMutation} style={{marginHorizontal: space.md}} /> : null}
        {/* The episode stays in the library while its files are gone; it says since when, and that it comes back by itself. */}
        {data?.missingSince ? <Notice tone="warning" title={i18n.t('title.missing')} message={i18n.t('title.missingSince', {when: i18n.date(data.missingSince, 'long')})} style={{marginHorizontal: space.md}} /> : null}
        {item?.overview ?? entry.overview ? <Text variant="body" tone="secondary" style={[pad, {maxWidth: 960}]}>{item?.overview ?? entry.overview}</Text> : !data && snapshot.phase === 'loading' ? <View style={pad}><Skeleton height={14} width="90%" /></View> : null}
        {directors.length || writers.length ? (
          <View style={[pad, {gap: space.xxs}]}>
            {directors.length ? <Text variant="caption" tone="secondary">{i18n.t('title.directedBy', {names: i18n.list(directors)})}</Text> : null}
            {writers.length ? <Text variant="caption" tone="secondary">{i18n.t('title.writtenBy', {names: i18n.list(writers)})}</Text> : null}
          </View>
        ) : null}
        {cast.length ? (
          <View style={{gap: space.sm}}>
            <View style={[pad, {flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between'}]}>
              <Text variant="subheading">{i18n.t('title.cast')}</Text>
              {allCast?.key !== castKey ? <Button variant="ghost" size="sm" label={i18n.t('action.seeAll')} loading={castLoading} onPress={showAllCast} /> : null}
            </View>
            {castError ? <Notice tone="error" message={say(castError, 'detail', 'load')} style={pad} /> : null}
            <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{paddingHorizontal: space.md, gap: space.md, paddingVertical: isTV ? space.md : 0}} style={isTV ? {marginVertical: -space.md} : undefined}>
              {cast.map(c => (
                <PersonCard key={c.id} name={c.name} subtitle={c.role} width={isTV ? 120 : 72} source={artwork(c.portraitUrl)} onPress={c.personId ? () => { onClose(); onPerson(c.personId!, c.name); } : undefined} />
              ))}
            </ScrollView>
          </View>
        ) : null}
        {data?.files?.length ? <View style={{marginHorizontal: -space.page + space.md}}><TitleDetails rows={[]} files={data.files} fileAction={tools.fileAction} tools={tools.mergeRow} /></View> : null}
        {tools.sheets}
        {previous || next ? (
          <View style={[pad, {flexDirection: 'row', gap: space.sm, justifyContent: 'space-between'}]}>
            {previous ? <Button variant="ghost" icon="previous" label={i18n.t('title.previousEpisode')} accessibilityHint={episodeTitle(i18n, previous)} onPress={() => onNavigate(index! - 1)} /> : <View />}
            {next ? <Button variant="ghost" trailingIcon="next" label={i18n.t('title.nextEpisode')} accessibilityHint={episodeTitle(i18n, next)} onPress={() => onNavigate(index! + 1)} /> : null}
          </View>
        ) : null}
      </View>
    </Sheet>
  );
}
