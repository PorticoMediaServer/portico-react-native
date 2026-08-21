import React, {
  useEffect,
  useMemo,
  useState,
} from 'react';
import {
  ActivityIndicator,
  Image,
  ImageBackground,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import {useInfiniteQuery, useMutation, useQuery, useQueryClient} from '@tanstack/react-query';
import {
  productErrorMessageId,
  serverImageSource,
  usePorticoAuth,
  useViewerRuntime,
} from '@portico-react-native/infrastructure';
import {
  productMessage,
  type MediaItem as ServerMediaItem,
  type PorticoClient,
  type ProductMessageId,
  type ProductMessageVariables,
} from '@portico/client-core';
import {PorticoIcon} from '@portico-react-native/icons';
import type {PrototypePlatform} from '../../ui-compat/contract';
import {
  detailViewModel,
  initialTVSeasonId,
  mediaCardViewModel,
  personMediaViewModels,
  shouldContinueToDeepLinkedEpisode,
  type DetailPersonViewModel,
  type MediaViewModel,
} from '../../data';
import {color, font, mobileType, radius, tvType} from '../tokens';
import {
  AmbientArtworkGlow,
  ArtworkScrim,
  ControlButton,
  EmptyState,
  Focusable,
  HeroPlayButton,
  IconButton,
  InlineNotice,
  SectionHeading,
} from '../primitives';
import {HeaderUtilities, MediaRow} from '../sharedComponents';
import {playerRouteForMedia, usePorticoNavigationActions} from '../navigation';
import {DownloadAction} from '../downloads';
import {DetailMoreAction} from '../detailActions';
import {useEngagement} from '../engagement';
import {WatchWithFriendsSheet} from '../watchWithFriends';
import {TvSafeContent} from '../shells';
import {
  productText,
  safeProductCopy,
} from '../productCopy';
import {requestPlaybackStart} from '../playerRuntimeModel';

function productCopy(id: ProductMessageId, variables?: ProductMessageVariables): string {
  const presentation = productMessage(id, variables);
  return safeProductCopy(presentation.text ?? presentation.title ?? presentation.body, id);
}


export function DetailScreen({
  episodeId,
  mediaId,
  platform,
  seasonId,
}: {
  episodeId?: string;
  mediaId: string;
  platform: PrototypePlatform;
  seasonId?: string;
}) {
  const engagement = useEngagement();
  const television = platform === 'tv';
  const client = usePorticoAuth().session!.client;
  const viewerRuntime = useViewerRuntime();
  const {back, openMediaDetail, openPlayableMedia, openPlayer, openWatchWithFriendsPlayer} =
    usePorticoNavigationActions();
  const queryClient = useQueryClient();
  const [versionsOpen, setVersionsOpen] = useState(false);
  const [selectedPerson, setSelectedPerson] = useState<DetailPersonViewModel>();
  const [mutationError, setMutationError] = useState<string>();
  const [watchWithFriendsOpen, setWatchWithFriendsOpen] = useState(false);
  const query = useQuery({
    queryKey: ['media', mediaId],
    queryFn: ({signal}) =>
      client.media(mediaId, {includeRecommendations: true}, {signal}),
  });
  const personQuery = useQuery({
    queryKey: ['person', selectedPerson?.id],
    enabled: Boolean(selectedPerson),
    queryFn: ({signal}) =>
      client.person(selectedPerson!.id, {limit: 50}, {signal}),
  });
  const mutation = useMutation({
    mutationFn: (operation: () => Promise<unknown>) => operation(),
    onMutate: () => setMutationError(undefined),
    onSuccess: async () => {
      await Promise.all([
        queryClient.invalidateQueries({queryKey: ['media', mediaId]}),
        queryClient.invalidateQueries({queryKey: ['home']}),
        queryClient.invalidateQueries({queryKey: ['watchlist']}),
        queryClient.invalidateQueries({queryKey: ['favorites']}),
      ]);
    },
    onError: cause =>
      setMutationError(
        productErrorMessageId(cause, 'catalog.action-failed', {actionName: 'save that change'}),
      ),
  });

  if (query.isLoading) {
    return (
      <View style={styles.detailLoading}>
        <ActivityIndicator color={color.screenBlueStrong} size="large" />
      </View>
    );
  }
  if (!query.data) {
    return (
      <EmptyState
        actionLabel="Try again"
        message={productErrorMessageId(
          query.error,
          'media.load-failed',
          {featureName: 'This item'},
        )}
        onAction={() => void query.refetch()}
        platform={platform}
        title="Media couldn’t load"
      />
    );
  }

  const detail = detailViewModel(query.data, client, platform);
  const item = detail.media;
  const series = item.kind === 'show';
  const capabilities = new Set(detail.actions);
  const regularPlayback = capabilities.has('play');
  const dvrPlayback =
    item.kind === 'recording' && capabilities.has('dvr.play');
  const livePlayback =
    (item.kind === 'live-channel' || item.kind === 'live-program') &&
    capabilities.has('live.play');
  const playbackAvailable = regularPlayback || dvrPlayback || livePlayback;
  const run = (operation: (signal: AbortSignal) => Promise<unknown>) => {
    if (!mutation.isPending) {
      mutation.mutate(() => viewerRuntime.runRequest(operation));
    }
  };

  return (
    <ScrollView
      contentContainerStyle={styles.page}
      showsVerticalScrollIndicator={false}
      testID={`portico-four-detail-${platform}`}
    >
      <View style={[styles.hero, television ? styles.heroTv : styles.heroMobile]}>
        <AmbientArtworkGlow platform={platform} />
        <ImageBackground
          resizeMode="cover"
          source={serverImageSource(item.backdrop)}
          style={styles.heroArtwork}
        >
          <ArtworkScrim platform={platform} strong />
        {!television ? (
          <HeaderUtilities
            artworkHeader
            leftContent={
              <IconButton
                icon="navigation.back"
                label={productText('action.back')}
                onPress={back}
                platform={platform}
              />
            }
            platform={platform}
            showProfile={false}
          />
        ) : null}
        <TvSafeContent
          enabled={television}
          style={[
            styles.heroCopy,
            television ? styles.heroCopyTv : styles.heroCopyMobile,
          ]}
        >
          {item.parentTitle ? (
            <Text style={television ? styles.parentTv : styles.parentMobile}>
              {item.parentTitle}
            </Text>
          ) : null}
          <Text
            numberOfLines={2}
            style={[
              television ? styles.detailTitleTv : styles.detailTitleMobile,
              styles.title,
            ]}
          >
            {item.title}
          </Text>
          <Text style={television ? styles.metaTv : styles.metaMobile}>
            {[
              item.subtitle,
              item.year,
              item.contentRating,
              item.duration,
              item.genre,
            ]
              .filter(Boolean)
              .join('  ·  ')}
          </Text>
          <Text
            numberOfLines={television ? 2 : 3}
            style={television ? styles.summaryTv : styles.summaryMobile}
          >
            {item.summary}
          </Text>
          {typeof item.progress === 'number' ? (
            <View
              style={[
                styles.resumeProgress,
                television && styles.resumeProgressTv,
              ]}
            >
              <View
                style={[
                  styles.resumeProgressValue,
                  {width: `${item.progress}%`},
                ]}
              />
            </View>
          ) : null}
          <View style={[styles.actions, television && styles.actionsTv]}>
            {playbackAvailable ? (
              <HeroPlayButton
                label={
                  typeof item.progress === 'number' && item.progress > 0
                    ? 'Resume'
                    : livePlayback
                      ? 'Watch Live'
                      : 'Play'
                }
                onPress={() => {
                  const route = playerRouteForMedia(item);
                  if (!route.live && !route.dvr)
                    requestPlaybackStart(route.mediaId);
                  openPlayableMedia(item);
                }}
                platform={platform}
              />
            ) : null}
            {regularPlayback && capabilities.has('play.from-beginning') ? (
              <IconButton
                icon="playback.replay"
                label={productText('action.play-from-beginning')}
                onPress={() => {
                  requestPlaybackStart(item.playbackMediaId, 0);
                  openPlayer(item.playbackMediaId);
                }}
                platform={platform}
              />
            ) : null}
            {detail.actions.includes('download') ? (
              <DownloadAction
                client={client}
                media={item.raw}
                platform={platform}
              />
            ) : null}
            {hasAction(detail.actions, 'watchlist') ? (
              <IconButton
                icon={item.state.watchlisted ? 'action.confirm' : 'action.watchlist'}
                label={
                  item.state.watchlisted ? 'Remove from Saved' : 'Add to Saved'
                }
                onPress={() =>
                  run(signal =>
                    client.setWatchlist(item.id, !item.state.watchlisted, {
                      signal,
                    }),
                  )
                }
                platform={platform}
                selected={item.state.watchlisted}
              />
            ) : null}
            {television && hasAction(detail.actions, 'favorite') ? (
              <IconButton
                icon="action.favorite"
                label={item.state.favorite ? 'Remove favorite' : 'Favorite'}
                onPress={() =>
                  run(signal =>
                    client.setFavorite(item.id, !item.state.favorite, {signal}),
                  )
                }
                platform={platform}
                selected={item.state.favorite}
              />
            ) : null}
            {television && detail.actions.includes('watched.set') ? (
              <IconButton
                icon="action.confirm"
                label={item.state.watched ? 'Mark unwatched' : 'Mark watched'}
                onPress={() =>
                  run(signal =>
                    client.setWatched(item.id, !item.state.watched, {signal}),
                  )
                }
                platform={platform}
                selected={item.state.watched}
              />
            ) : null}
            {television && regularPlayback && capabilities.has('watch-with-friends.start') ? (
              <IconButton
                icon="account.watch-together"
                label={productText('watch-with-friends.title')}
                onPress={() => setWatchWithFriendsOpen(true)}
                platform={platform}
              />
            ) : null}
            {television && (capabilities.has('feedback.report-problem') || capabilities.has('feedback.request-higher-quality')) ? (
              <IconButton
                icon="communication.report"
                label={productText('action.report-problem')}
                onPress={() => engagement.openFeedback({mediaId: item.id, mediaTitle: item.title, initialKind: 'media'})}
                platform={platform}
              />
            ) : null}
            <DetailMoreAction
              client={client}
              item={item}
              onPlayVersion={versionId => {
                requestPlaybackStart(item.playbackMediaId, {versionId});
                openPlayer(item.playbackMediaId);
              }}
              platform={platform}
              secondaryActions={television ? [] : [
                ...(hasAction(detail.actions, 'favorite') ? [{description: 'Save or remove this title from your favorites.', icon: 'action.favorite' as const, id: 'favorite', label: item.state.favorite ? 'Remove favorite' : 'Favorite', onPress: () => run(signal => client.setFavorite(item.id, !item.state.favorite, {signal}))}] : []),
                ...(detail.actions.includes('watched.set') ? [{description: 'Update your watched history for this title.', icon: 'action.confirm' as const, id: 'watched', label: item.state.watched ? 'Mark unwatched' : 'Mark watched', onPress: () => run(signal => client.setWatched(item.id, !item.state.watched, {signal}))}] : []),
                ...(regularPlayback && capabilities.has('watch-with-friends.start') ? [{description: 'Invite friends to watch this title together.', icon: 'account.watch-together' as const, id: 'watch-with-friends', label: productText('watch-with-friends.title'), onPress: () => setWatchWithFriendsOpen(true)}] : []),
                ...(capabilities.has('feedback.report-problem') || capabilities.has('feedback.request-higher-quality') ? [{description: 'Tell the server owner about a problem with this title.', icon: 'communication.report' as const, id: 'feedback', label: productText('action.report-problem'), onPress: () => engagement.openFeedback({mediaId: item.id, mediaTitle: item.title, initialKind: 'media'})}] : []),
              ]}
            />
          </View>
        </TvSafeContent>
        </ImageBackground>
      </View>

      <TvSafeContent enabled={television} style={[styles.detailBody, television && styles.detailBodyTv]}>
        {mutationError ? (
          <InlineNotice
            kind="error"
            message={mutationError}
            platform={platform}
          />
        ) : null}
        {series ? (
          <TVDetailHierarchy
            client={client}
            deepLinkedEpisodeId={episodeId}
            initialSeasonId={seasonId}
            onPlay={openPlayer}
            platform={platform}
            show={item.raw}
          />
        ) : null}
        {detail.people.length ? (
          <CastCrew
            people={detail.people}
            onSelect={setSelectedPerson}
            platform={platform}
            selected={selectedPerson?.id}
          />
        ) : null}
        {selectedPerson ? (
          <PersonResults
            error={personQuery.error}
            loading={personQuery.isLoading}
            name={selectedPerson.name}
            items={
              personQuery.data
                ? personMediaViewModels(personQuery.data.credits, client)
                : []
            }
            onOpen={openMediaDetail}
            onRetry={() => void personQuery.refetch()}
            platform={platform}
          />
        ) : null}
        {detail.extras.map(section => (
          <MediaRow
            flush
            items={section.items}
            key={section.id}
            onOpen={candidate => openMediaDetail(candidate)}
            platform={platform}
            shape="poster"
            title={section.title}
          />
        ))}
        {detail.recommendations.map(section => (
          <MediaRow
            flush
            items={section.items}
            key={section.id}
            onOpen={candidate => openMediaDetail(candidate)}
            platform={platform}
            shape="poster"
            title={section.title}
          />
        ))}
        <VersionsInformation
          facts={detail.facts}
          onToggle={() => setVersionsOpen(open => !open)}
          open={versionsOpen}
          platform={platform}
        />
      </TvSafeContent>
      <WatchWithFriendsSheet
        client={client}
        mediaId={item.playbackMediaId}
        mediaTitle={item.title}
        onClose={() => setWatchWithFriendsOpen(false)}
        onOpenGroup={group => {
          setWatchWithFriendsOpen(false);
          openWatchWithFriendsPlayer(group.mediaId, group.id);
        }}
        platform={platform}
        visible={watchWithFriendsOpen}
      />
    </ScrollView>
  );
}

/** Live-TV results have channel identities, not generic media identities. */
export function LiveChannelDetailScreen({mediaId, platform}: {mediaId: string; platform: PrototypePlatform}) {
  const television = platform === 'tv';
  const client = usePorticoAuth().session!.client;
  const {back, openPlayer} = usePorticoNavigationActions();
  const channelQuery = useQuery({
    queryKey: ['live-channel', mediaId],
    queryFn: ({signal}) => client.liveTvChannel(mediaId, {signal}),
  });
  const channel = channelQuery.data;
  const guideQuery = useQuery({
    enabled: Boolean(channel),
    queryKey: ['live-channel-guide', channel?.sourceId],
    queryFn: ({signal}) => client.liveTvGuide(channel!.sourceId, {hours: 3, limit: 250}, {signal}),
  });
  if (channelQuery.isLoading) {
    return <View style={styles.detailLoading}><AmbientArtworkGlow platform={platform} /><ActivityIndicator color={color.screenBlueStrong} size="large" /></View>;
  }
  if (!channel) {
    return <EmptyState actionLabel={productText('action.retry')} message={productErrorMessageId(channelQuery.error, 'media.load-failed', {featureName: 'This channel'})} onAction={() => void channelQuery.refetch()} platform={platform} title="Channel couldn’t load" />;
  }
  const serverNow = guideQuery.data ? Date.parse(guideQuery.data.serverTime) : Date.now();
  const current = guideQuery.data?.programs.find(program => program.channelId === channel.id && Date.parse(program.startAt) <= serverNow && Date.parse(program.endAt) > serverNow);
  const playable = channel.actions.includes('live.play');
  return (
    <ScrollView contentContainerStyle={styles.page} showsVerticalScrollIndicator={false} testID={`portico-four-live-detail-${platform}`}>
      <View style={[styles.hero, television ? styles.heroTv : styles.heroMobile]}>
        <AmbientArtworkGlow platform={platform} />
        <View style={styles.heroArtwork}>
          {!television ? <HeaderUtilities artworkHeader leftContent={<IconButton icon="navigation.back" label={productText('action.back')} onPress={back} platform={platform} />} platform={platform} showProfile={false} /> : null}
          <TvSafeContent enabled={television} style={[styles.heroCopy, television ? styles.heroCopyTv : styles.heroCopyMobile]}>
            <Text style={television ? styles.parentTv : styles.parentMobile}>Live TV · {channel.number ?? channel.groupTitle ?? 'Channel'}</Text>
            <Text numberOfLines={2} style={[television ? styles.detailTitleTv : styles.detailTitleMobile, styles.title]}>{channel.name}</Text>
            <Text style={television ? styles.metaTv : styles.metaMobile}>
              {guideQuery.isLoading ? 'Loading guide…' : current ? current.title : 'No guide data available'}
            </Text>
            {current?.subtitle ? <Text numberOfLines={2} style={television ? styles.summaryTv : styles.summaryMobile}>{current.subtitle}</Text> : <Text style={television ? styles.summaryTv : styles.summaryMobile}>Tune this channel to watch the current broadcast.</Text>}
            {playable ? <View style={[styles.actions, television && styles.actionsTv]}><HeroPlayButton label="Watch Live" onPress={() => openPlayer(channel.id, true)} platform={platform} /></View> : null}
          </TvSafeContent>
        </View>
      </View>
      <TvSafeContent enabled={television} style={[styles.detailBody, television && styles.detailBodyTv]}>
        {guideQuery.error ? <InlineNotice kind="warning" message="Guide data is unavailable for this channel. You can still try watching live." platform={platform} /> : null}
        {!guideQuery.isLoading && !current ? <InlineNotice kind="info" message="No current programme is listed for this channel." platform={platform} /> : null}
      </TvSafeContent>
    </ScrollView>
  );
}

function hasAction(
  actions: string[],
  family: 'watchlist' | 'favorite',
): boolean {
  return (
    actions.includes(`${family}.add`) || actions.includes(`${family}.remove`)
  );
}

function CastCrew({
  onSelect,
  people,
  platform,
  selected,
}: {
  onSelect(person: DetailPersonViewModel): void;
  people: DetailPersonViewModel[];
  platform: PrototypePlatform;
  selected?: string;
}) {
  const television = platform === 'tv';
  return (
    <View style={styles.liveSection}>
      <SectionHeading platform={platform} title={productText('media.people-cast-crew')} />
      <ScrollView
        contentContainerStyle={[styles.people, television && styles.peopleTv]}
        horizontal
        showsHorizontalScrollIndicator={false}
      >
        {people.map((person, index) => (
          <Focusable
            accessibilityLabel={`${person.name}, ${person.character || person.role}`}
            accessibilityRole="button"
            key={`${person.id}:${index}`}
            onPress={() => onSelect(person)}
            platform={platform}
            style={[
              styles.person,
              television && styles.personTv,
              selected === person.id && styles.personSelected,
            ]}
            focusedStyle={styles.personFocused}
            pressedStyle={styles.personPressed}
          >
            {person.imageUrl ? (
              <Image
                source={serverImageSource(person.imageUrl)}
                style={[styles.headshot, television && styles.headshotTv]}
              />
            ) : (
              <View
                style={[
                  styles.headshot,
                  styles.headshotFallback,
                  television && styles.headshotTv,
                ]}
              >
                <Text
                  style={television ? styles.initialsTv : styles.initialsMobile}
                >
                  {initials(person.name)}
                </Text>
              </View>
            )}
            <Text
              numberOfLines={1}
              style={television ? styles.personNameTv : styles.personNameMobile}
            >
              {person.name}
            </Text>
            <Text
              numberOfLines={1}
              style={television ? styles.personRoleTv : styles.personRoleMobile}
            >
              {person.character || person.role}
            </Text>
          </Focusable>
        ))}
      </ScrollView>
    </View>
  );
}

function PersonResults({
  error,
  items,
  loading,
  name,
  onOpen,
  onRetry,
  platform,
}: {
  error: Error | null;
  items: MediaViewModel[];
  loading: boolean;
  name: string;
  onOpen(item: MediaViewModel): void;
  onRetry(): void;
  platform: PrototypePlatform;
}) {
  if (loading)
    return (
      <View style={styles.personLoading}>
        <ActivityIndicator color={color.screenBlueStrong} />
        <Text
          style={
            platform === 'tv'
              ? styles.personLoadingTv
              : styles.personLoadingMobile
          }
        >
          Finding titles with {name}…
        </Text>
      </View>
    );
  if (error)
    return (
      <InlineNotice
        actionLabel="Try again"
        kind="error"
        message={`Titles for ${name} could not be loaded.`}
        onAction={onRetry}
        platform={platform}
      />
    );
  if (!items.length)
    return (
      <InlineNotice
        kind="warning"
        message={`No other accessible titles were found for ${name}.`}
        platform={platform}
      />
    );
  return (
    <MediaRow
      flush
      items={items}
      onOpen={item => {
        const selected = items.find(candidate => candidate.id === item.id);
        if (selected) onOpen(selected);
      }}
      platform={platform}
      shape="poster"
      title={`Featuring ${name}`}
    />
  );
}

function TVDetailHierarchy({
  client,
  deepLinkedEpisodeId,
  initialSeasonId,
  onPlay,
  platform,
  show,
}: {
  client: PorticoClient;
  deepLinkedEpisodeId?: string;
  initialSeasonId?: string;
  onPlay(id: string): void;
  platform: PrototypePlatform;
  show: ServerMediaItem;
}) {
  const seasons = useMemo(
    () => (show.children ?? []).filter(child => child.type === 'season'),
    [show.children],
  );
  const requestedSeasonId = initialTVSeasonId(show, initialSeasonId);
  const [selectedSeasonId, setSelectedSeasonId] = useState(requestedSeasonId);
  useEffect(() => {
    setSelectedSeasonId(requestedSeasonId);
  }, [requestedSeasonId, show.id]);
  const selectedSeason = seasons.find(season => season.id === selectedSeasonId);
  const episodesQuery = useInfiniteQuery({
    enabled: Boolean(selectedSeason),
    queryKey: ['media-children', show.id, selectedSeason?.id],
    initialPageParam: undefined as string | undefined,
    queryFn: ({pageParam, signal}) =>
      client.mediaChildren(
        selectedSeason!.id,
        {cursor: pageParam, limit: 100},
        {signal},
      ),
    getNextPageParam: (lastPage, pages) =>
      lastPage.pageInfo.hasMore &&
      lastPage.pageInfo.nextCursor &&
      !pages
        .slice(0, -1)
        .some(page => page.pageInfo.nextCursor === lastPage.pageInfo.nextCursor)
        ? lastPage.pageInfo.nextCursor
        : undefined,
  });
  const episodes = useMemo(
    () =>
      (episodesQuery.data?.pages ?? [])
        .flatMap(page => page.items)
        .filter(
          (episode, index, all) =>
            all.findIndex(candidate => candidate.id === episode.id) === index,
        )
        .map(episode => mediaCardViewModel(episode, client)),
    [client, episodesQuery.data?.pages],
  );
  const shouldSeekDeepLink = shouldContinueToDeepLinkedEpisode(
    deepLinkedEpisodeId,
    episodes.map(episode => episode.id),
    Boolean(episodesQuery.hasNextPage),
    episodesQuery.isFetchNextPageError,
  );
  const fetchNextEpisodePage = episodesQuery.fetchNextPage;
  const isFetchingNextEpisodePage = episodesQuery.isFetchingNextPage;
  useEffect(() => {
    if (shouldSeekDeepLink && !isFetchingNextEpisodePage) {
      void fetchNextEpisodePage();
    }
  }, [fetchNextEpisodePage, isFetchingNextEpisodePage, shouldSeekDeepLink]);

  if (!seasons.length) {
    return (
      <InlineNotice
        kind="warning"
        message={productCopy('media.empty-show')}
        platform={platform}
      />
    );
  }

  return (
    <View style={styles.liveSection}>
      <SeasonSelector
        onSelect={setSelectedSeasonId}
        platform={platform}
        seasons={seasons}
        selectedSeasonId={selectedSeasonId}
      />
      {episodesQuery.isLoading ? (
        <View style={styles.episodeLoading}>
          <ActivityIndicator color={color.screenBlueStrong} />
          <Text style={platform === 'tv' ? styles.personLoadingTv : styles.personLoadingMobile}>
            {productCopy('state.loading')}
          </Text>
        </View>
      ) : episodesQuery.error && !episodes.length ? (
        <InlineNotice
          actionLabel={productCopy('action.retry')}
          kind="error"
          message={productCopy('media.children-unavailable-title', {section: productCopy('media.episodes-title')})}
          onAction={() => void episodesQuery.refetch()}
          platform={platform}
        />
      ) : !episodes.length ? (
        <InlineNotice
          kind="warning"
          message={productCopy('media.empty-season')}
          platform={platform}
        />
      ) : (
        <>
          <MediaRow
            flush
            items={episodes}
            onOpen={episode => onPlay(episode.id)}
            platform={platform}
            selectedId={deepLinkedEpisodeId}
            shape="landscape"
            showHeading={false}
            title={productCopy('media.episodes-title')}
          />
          {episodesQuery.isFetchNextPageError ? (
            <InlineNotice
              actionLabel={productCopy('action.retry')}
              kind="error"
              message={productCopy('problem.request-failed')}
              onAction={() => void episodesQuery.fetchNextPage()}
              platform={platform}
            />
          ) : episodesQuery.hasNextPage ? (
            <View style={styles.episodeContinuation}>
              <ControlButton
                compact
                icon="navigation.expand"
                label={episodesQuery.isFetchingNextPage ? productCopy('state.loading-more') : productCopy('action.load-more')}
                onPress={() => void episodesQuery.fetchNextPage()}
                platform={platform}
              />
            </View>
          ) : deepLinkedEpisodeId &&
            !episodes.some(episode => episode.id === deepLinkedEpisodeId) ? (
            <InlineNotice
              kind="warning"
              message={productCopy('media.children-empty')}
              platform={platform}
            />
          ) : null}
        </>
      )}
    </View>
  );
}

function SeasonSelector({
  onSelect,
  platform,
  seasons,
  selectedSeasonId,
}: {
  onSelect(id: string): void;
  platform: PrototypePlatform;
  seasons: ServerMediaItem[];
  selectedSeasonId?: string;
}) {
  const television = platform === 'tv';
  const [open, setOpen] = useState(false);
  const selected = seasons.find(season => season.id === selectedSeasonId) ?? seasons[0];
  return (
    <View style={styles.seasonSelector}>
      <SectionHeading platform={platform} title={productCopy('media.episodes-title')} />
      <Focusable
        accessibilityLabel={`${productCopy('media.season-selector-label')}. ${selected?.title ?? productCopy('media.seasons-title')}`}
        accessibilityRole="button"
        accessibilityState={{expanded: open}}
        onPress={() => setOpen(value => !value)}
        platform={platform}
        style={[styles.seasonTrigger, television && styles.seasonTriggerTv]}
        focusedStyle={styles.seasonControlFocused}
        pressedStyle={styles.seasonControlPressed}
      >
        <Text style={television ? styles.seasonLabelTv : styles.seasonLabelMobile}>
          {selected?.title ?? productCopy('media.seasons-title')}
        </Text>
        <PorticoIcon color={color.softSilver} id="navigation.expand" size={television ? 28 : 21} />
      </Focusable>
      {open ? (
        <View style={[styles.seasonOptions, television && styles.seasonOptionsTv]}>
          {seasons.map(season => {
            const selectedOption = season.id === selected?.id;
            return (
              <Focusable
                accessibilityRole="menuitem"
                accessibilityState={{selected: selectedOption}}
                key={season.id}
                onPress={() => {
                  onSelect(season.id);
                  if (!television) setOpen(false);
                }}
                platform={platform}
                style={[styles.seasonOption, selectedOption && styles.seasonOptionSelected]}
                focusedStyle={styles.seasonControlFocused}
                pressedStyle={styles.seasonControlPressed}
              >
                <Text style={television ? styles.seasonOptionTv : styles.seasonOptionMobile}>
                  {season.title}
                </Text>
                {selectedOption ? <PorticoIcon color={color.screenBlueStrong} id="status.selected" size={television ? 26 : 19} /> : null}
              </Focusable>
            );
          })}
        </View>
      ) : null}
    </View>
  );
}

function VersionsInformation({
  facts,
  onToggle,
  open,
  platform,
}: {
  facts: Array<{label: string; value: string}>;
  onToggle(): void;
  open: boolean;
  platform: PrototypePlatform;
}) {
  const television = platform === 'tv';
  return (
    <View style={styles.versions}>
      <Focusable
        accessibilityLabel={`${open ? 'Collapse' : 'Expand'} versions and media information`}
        accessibilityRole="button"
        onPress={onToggle}
        platform={platform}
        style={styles.versionsTrigger}
        focusedStyle={styles.versionsFocused}
        pressedStyle={styles.versionsPressed}
      >
        <Text
          style={[
            television ? tvType.section : mobileType.section,
            styles.bodyHeading,
          ]}
        >
          Versions & media information
        </Text>
        {open ? (
          <PorticoIcon color={color.softSilver} id="navigation.collapse" size={television ? 28 : 21} />
        ) : (
          <PorticoIcon color={color.softSilver} id="navigation.expand" size={television ? 28 : 21} />
        )}
      </Focusable>
      {open ? (
        facts.length ? (
          <View style={[styles.factGrid, television && styles.factGridTv]}>
            {facts.map(fact => (
              <View key={`${fact.label}-${fact.value}`} style={styles.fact}>
                <Text
                  style={
                    television ? styles.factLabelTv : styles.factLabelMobile
                  }
                >
                  {fact.label}
                </Text>
                <Text
                  style={
                    television ? styles.factValueTv : styles.factValueMobile
                  }
                >
                  {fact.value}
                </Text>
              </View>
            ))}
          </View>
        ) : (
          <Text style={television ? styles.noFactsTv : styles.noFactsMobile}>
            No technical media information is available for this item.
          </Text>
        )
      ) : null}
    </View>
  );
}

function initials(name: string): string {
  return name
    .split(/\s+/)
    .slice(0, 2)
    .map(word => word[0])
    .join('')
    .toUpperCase();
}

const styles = StyleSheet.create({
  page: {backgroundColor: color.projector, paddingBottom: 60},
  detailLoading: {
    alignItems: 'center',
    backgroundColor: color.projector,
    flex: 1,
    justifyContent: 'center',
  },
  detailLoadingActions: {marginTop: 24},
  hero: {backgroundColor: color.recess, overflow: 'hidden', width: '100%'},
  heroArtwork: {flex: 1, width: '100%'},
  heroMobile: {height: 540},
  heroTv: {height: 570},
  topActions: {alignItems: 'center', flexDirection: 'row', gap: 8},
  heroCopy: {marginTop: 'auto'},
  heroCopyMobile: {paddingBottom: 42, paddingHorizontal: 20},
  heroCopyTv: {maxWidth: 1002, paddingBottom: 66, paddingRight: 72},
  parentMobile: {
    color: color.screenBlueStrong,
    fontFamily: font.demi,
    fontSize: 14,
    lineHeight: 19,
    marginBottom: 5,
  },
  parentTv: {
    color: color.screenBlueStrong,
    fontFamily: font.demi,
    fontSize: 21,
    lineHeight: 28,
    marginBottom: 8,
  },
  title: {color: color.silver},
  detailTitleMobile: {
    fontFamily: font.bold,
    fontSize: 40,
    letterSpacing: -1.1,
    lineHeight: 44,
  },
  detailTitleTv: {
    fontFamily: font.bold,
    fontSize: 52,
    letterSpacing: -1.5,
    lineHeight: 58,
  },
  metaMobile: {
    color: color.softSilver,
    fontFamily: font.demi,
    fontSize: 14,
    lineHeight: 20,
    marginTop: 8,
  },
  metaTv: {
    color: color.softSilver,
    fontFamily: font.demi,
    fontSize: 22,
    lineHeight: 29,
    marginTop: 11,
  },
  summaryMobile: {
    color: color.softSilver,
    fontFamily: font.regular,
    fontSize: 15,
    lineHeight: 21,
    marginTop: 10,
  },
  summaryTv: {
    color: color.softSilver,
    fontFamily: font.regular,
    fontSize: 23,
    lineHeight: 32,
    marginTop: 13,
    maxWidth: 900,
  },
  resumeProgress: {
    backgroundColor: 'rgba(244,247,250,0.24)',
    height: 4,
    marginTop: 14,
    maxWidth: 520,
  },
  resumeProgressTv: {height: 6, marginTop: 18, maxWidth: 700},
  resumeProgressValue: {
    backgroundColor: color.screenBlueStrong,
    height: '100%',
  },
  actions: {alignItems: 'center', flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginTop: 18},
  actionsTv: {gap: 12, marginTop: 24},
  detailBody: {gap: 26, paddingHorizontal: 16, paddingTop: 22},
  detailBodyTv: {gap: 36, paddingLeft: 0, paddingRight: 72, paddingTop: 30},
  liveSection: {gap: 12},
  seasonSelector: {alignItems: 'flex-start', gap: 8},
  seasonTrigger: {
    alignItems: 'center',
    backgroundColor: color.recess,
    borderColor: color.line,
    borderRadius: 8,
    borderWidth: 2,
    flexDirection: 'row',
    gap: 12,
    justifyContent: 'space-between',
    minHeight: 44,
    paddingHorizontal: 14,
    width: 220,
  },
  seasonTriggerTv: {minHeight: 58, paddingHorizontal: 18, width: 320},
  seasonControlFocused: {backgroundColor: color.raisedSlate, borderColor: color.focus},
  seasonControlPressed: {backgroundColor: color.brightSlate},
  seasonLabelMobile: {color: color.silver, fontFamily: font.demi, fontSize: 15},
  seasonLabelTv: {color: color.silver, fontFamily: font.demi, fontSize: 22},
  seasonOptions: {
    backgroundColor: color.recess,
    borderColor: color.line,
    borderRadius: 10,
    borderWidth: 1,
    padding: 4,
    width: 220,
  },
  seasonOptionsTv: {padding: 6, width: 320},
  seasonOption: {
    alignItems: 'center',
    borderColor: color.transparent,
    borderRadius: 8,
    borderWidth: 2,
    flexDirection: 'row',
    justifyContent: 'space-between',
    minHeight: 42,
    paddingHorizontal: 10,
  },
  seasonOptionSelected: {backgroundColor: color.slate},
  seasonOptionMobile: {color: color.softSilver, fontFamily: font.medium, fontSize: 15},
  seasonOptionTv: {color: color.softSilver, fontFamily: font.medium, fontSize: 21},
  episodeLoading: {alignItems: 'center', flexDirection: 'row', gap: 10, minHeight: 90},
  episodeContinuation: {alignItems: 'flex-start', marginTop: -22},
  people: {gap: 14, paddingBottom: 6},
  peopleTv: {gap: 22, paddingBottom: 10},
  person: {
    alignItems: 'center',
    borderColor: color.transparent,
    borderRadius: 10,
    borderWidth: 2,
    padding: 5,
    width: 112,
  },
  personTv: {borderRadius: 14, padding: 7, width: 170},
  personSelected: {
    backgroundColor: color.recess,
    borderColor: color.screenBlueDeep,
  },
  personFocused: {backgroundColor: color.raisedSlate, borderColor: color.focus},
  personPressed: {backgroundColor: color.brightSlate},
  headshot: {
    backgroundColor: color.recess,
    borderRadius: 46,
    height: 92,
    width: 92,
  },
  headshotTv: {borderRadius: 72, height: 144, width: 144},
  headshotFallback: {
    alignItems: 'center',
    borderColor: color.line,
    borderWidth: 1,
    justifyContent: 'center',
  },
  initialsMobile: {
    color: color.softSilver,
    fontFamily: font.demi,
    fontSize: 23,
  },
  initialsTv: {color: color.softSilver, fontFamily: font.demi, fontSize: 34},
  personNameMobile: {
    color: color.silver,
    fontFamily: font.demi,
    fontSize: 13,
    lineHeight: 18,
    marginTop: 7,
    maxWidth: '100%',
  },
  personNameTv: {
    color: color.silver,
    fontFamily: font.demi,
    fontSize: 19,
    lineHeight: 25,
    marginTop: 10,
    maxWidth: '100%',
  },
  personRoleMobile: {
    color: color.dimSilver,
    fontFamily: font.regular,
    fontSize: 11,
    lineHeight: 15,
    maxWidth: '100%',
  },
  personRoleTv: {
    color: color.dimSilver,
    fontFamily: font.regular,
    fontSize: 16,
    lineHeight: 22,
    maxWidth: '100%',
  },
  personLoading: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: 10,
    minHeight: 52,
  },
  personLoadingMobile: {
    color: color.softSilver,
    fontFamily: font.regular,
    fontSize: 14,
  },
  personLoadingTv: {
    color: color.softSilver,
    fontFamily: font.regular,
    fontSize: 20,
  },
  movieBody: {gap: 12},
  movieBodyTv: {gap: 16},
  bodyHeading: {color: color.silver},
  secondaryHeading: {marginTop: 20},
  factGrid: {gap: 7, paddingHorizontal: 12, paddingVertical: 8},
  factGridTv: {
    gap: 10,
    maxWidth: 980,
    paddingHorizontal: 18,
    paddingVertical: 12,
  },
  fact: {alignItems: 'flex-start', flexDirection: 'row', paddingVertical: 2},
  factLabelMobile: {
    color: color.dimSilver,
    fontFamily: font.medium,
    fontSize: 12,
    lineHeight: 20,
    width: 92,
  },
  factLabelTv: {
    color: color.dimSilver,
    fontFamily: font.medium,
    fontSize: 17,
    lineHeight: 28,
    width: 150,
  },
  factValueMobile: {
    color: color.silver,
    flex: 1,
    fontFamily: font.regular,
    fontSize: 15,
    lineHeight: 20,
  },
  factValueTv: {
    color: color.silver,
    flex: 1,
    fontFamily: font.regular,
    fontSize: 21,
    lineHeight: 28,
  },
  versions: {
    borderTopColor: color.lineSoft,
    borderTopWidth: 1,
    marginTop: 10,
    paddingTop: 4,
  },
  versionsTrigger: {
    alignItems: 'center',
    borderColor: color.transparent,
    borderRadius: 8,
    borderWidth: 2,
    flexDirection: 'row',
    justifyContent: 'space-between',
    minHeight: 56,
    paddingHorizontal: 12,
  },
  versionsFocused: {
    backgroundColor: color.raisedSlate,
    borderColor: color.focus,
  },
  versionsPressed: {backgroundColor: color.recess},
  noFactsMobile: {
    color: color.dimSilver,
    fontFamily: font.regular,
    fontSize: 14,
    lineHeight: 20,
    padding: 14,
  },
  noFactsTv: {
    color: color.dimSilver,
    fontFamily: font.regular,
    fontSize: 20,
    lineHeight: 28,
    padding: 20,
  },
  aboutMobile: {
    color: color.softSilver,
    fontFamily: font.regular,
    fontSize: 16,
    lineHeight: 24,
  },
  aboutTv: {
    color: color.softSilver,
    fontFamily: font.regular,
    fontSize: 23,
    lineHeight: 34,
    maxWidth: 1200,
  },
  seriesBody: {gap: 12},
  episodes: {gap: 8, paddingBottom: 8, paddingTop: 14},
  episodesTv: {gap: 18, paddingBottom: 12, paddingTop: 20},
  episodeWrapper: {paddingBottom: 4},
  player: {flex: 1},
  playerUnavailableScrim: {
    backgroundColor: 'rgba(0,0,0,0.68)',
    ...StyleSheet.absoluteFillObject,
  },
  playerUnavailable: {
    alignItems: 'flex-start',
    alignSelf: 'center',
    backgroundColor: 'rgba(7,11,16,0.88)',
    borderColor: color.line,
    borderRadius: 12,
    borderWidth: 1,
    gap: 14,
    marginTop: 'auto',
    marginBottom: 'auto',
    maxWidth: 420,
    padding: 24,
    width: '86%',
  },
  playerUnavailableTv: {borderRadius: 16, gap: 20, maxWidth: 700, padding: 38},
  playerUnavailableTitleMobile: {
    color: color.silver,
    fontFamily: font.bold,
    fontSize: 24,
    letterSpacing: -0.5,
    lineHeight: 29,
  },
  playerUnavailableTitleTv: {
    color: color.silver,
    fontFamily: font.bold,
    fontSize: 38,
    letterSpacing: -0.8,
    lineHeight: 46,
  },
  playerUnavailableBodyMobile: {
    color: color.softSilver,
    fontFamily: font.regular,
    fontSize: 15,
    lineHeight: 22,
  },
  playerUnavailableBodyTv: {
    color: color.softSilver,
    fontFamily: font.regular,
    fontSize: 22,
    lineHeight: 32,
  },
  playerScrim: {
    backgroundColor: 'rgba(0,0,0,0.34)',
    bottom: 0,
    left: 0,
    position: 'absolute',
    right: 0,
    top: 0,
  },
  playerReconnectStatus: {
    alignItems: 'center',
    alignSelf: 'center',
    backgroundColor: 'rgba(7,11,16,0.88)',
    borderColor: color.lineStrong,
    borderRadius: radius.surface,
    borderWidth: 1,
    flexDirection: 'row',
    gap: 12,
    maxWidth: '92%',
    paddingHorizontal: 18,
    paddingVertical: 14,
    position: 'absolute',
    top: '46%',
    zIndex: 6,
  },
  playerReconnectCopy: {flexShrink: 1},
  playerReconnectTitle: {
    color: color.silver,
    fontFamily: font.bold,
    fontSize: 16,
    lineHeight: 20,
  },
  playerReconnectBody: {
    color: color.softSilver,
    fontFamily: font.regular,
    fontSize: 13,
    lineHeight: 18,
    maxWidth: 360,
  },
  playerTop: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: 8,
    paddingHorizontal: 16,
    paddingTop: 12,
    zIndex: 4,
  },
  playerTopTv: {paddingHorizontal: 72, paddingTop: 48},
  playerIdentity: {left: 20, maxWidth: '72%', position: 'absolute', zIndex: 3},
  watchGroupBanner: {
    alignItems: 'center',
    backgroundColor: 'rgba(7,11,16,0.82)',
    borderColor: color.lineStrong,
    borderRadius: radius.surface,
    borderWidth: 1,
    flexDirection: 'row',
    gap: 10,
    left: 20,
    maxWidth: '78%',
    padding: 10,
    position: 'absolute',
    top: 164,
    zIndex: 4,
  },
  watchGroupBannerTv: {left: 70, maxWidth: 760, padding: 14, top: 178},
  watchGroupCopy: {flex: 1},
  watchGroupTitleMobile: {...mobileType.card, color: color.silver},
  watchGroupTitleTv: {...tvType.card, color: color.silver},
  watchGroupMetaMobile: {...mobileType.caption, color: color.softSilver},
  watchGroupMetaTv: {...tvType.caption, color: color.softSilver},
  playerIdentityTv: {left: 72, maxWidth: 850, top: 58},
  buffering: {alignItems: 'center', flex: 1, justifyContent: 'center'},
  bufferingTextMobile: {
    color: color.silver,
    fontFamily: font.demi,
    fontSize: 17,
  },
  bufferingTextTv: {color: color.silver, fontFamily: font.demi, fontSize: 26},
  playerSpacer: {flex: 1},
  segmentPrompt: {alignItems: 'center', alignSelf: 'flex-end', backgroundColor: color.scrimStrong, borderColor: color.lineStrong, borderRadius: radius.surface, borderWidth: 1, flexDirection: 'row', gap: 6, marginBottom: 10, marginHorizontal: 20, padding: 8},
  segmentPromptTv: {gap: 10, marginBottom: 16, marginHorizontal: 72, padding: 12},
  playerBottom: {
    backgroundColor: 'rgba(7,11,16,0.52)',
    marginTop: 'auto',
    paddingBottom: 24,
    paddingHorizontal: 20,
    paddingTop: 16,
  },
  playerBottomTv: {paddingBottom: 36, paddingHorizontal: 72, paddingTop: 20},
  playerTitleMobile: {
    color: color.silver,
    fontFamily: font.demi,
    fontSize: 18,
    lineHeight: 23,
  },
  playerTitleTv: {
    color: color.silver,
    fontFamily: font.demi,
    fontSize: 28,
    lineHeight: 35,
  },
  playerMetaMobile: {
    color: color.dimSilver,
    fontFamily: font.regular,
    fontSize: 13,
    lineHeight: 18,
    marginTop: 2,
  },
  playerMetaTv: {
    color: color.dimSilver,
    fontFamily: font.regular,
    fontSize: 19,
    lineHeight: 26,
    marginTop: 3,
  },
  playerTimes: {flexDirection: 'row', justifyContent: 'space-between'},
  trickplayPreview: {
    alignItems: 'center',
    alignSelf: 'center',
    backgroundColor: color.slate,
    borderColor: color.lineStrong,
    borderRadius: radius.surface,
    borderWidth: 1,
    bottom: 118,
    overflow: 'hidden',
    position: 'absolute',
    width: 180,
  },
  trickplayImage: {aspectRatio: 16 / 9, width: '100%'},
  trickplayTime: {
    ...mobileType.caption,
    color: color.silver,
    paddingHorizontal: 8,
    paddingVertical: 5,
  },
  playerProgressTouch: {paddingBottom: 8, paddingTop: 8},
  playerProgressTouchTv: {paddingBottom: 10, paddingTop: 10},
  playerProgress: {backgroundColor: 'rgba(244,247,250,0.28)', height: 5},
  playerProgressTv: {height: 6},
  playerProgressValue: {
    backgroundColor: color.screenBlueStrong,
    height: '100%',
  },
  playerEnded: {
    alignItems: 'center',
    alignSelf: 'center',
    backgroundColor: 'rgba(7,11,16,0.88)',
    borderColor: color.line,
    borderRadius: 12,
    borderWidth: 1,
    gap: 18,
    padding: 24,
    position: 'absolute',
    top: '38%',
    zIndex: 6,
  },
  playerEndedTv: {borderRadius: 16, gap: 24, padding: 36},
  playerEndedTitleMobile: {
    color: color.silver,
    fontFamily: font.bold,
    fontSize: 24,
  },
  playerEndedTitleTv: {
    color: color.silver,
    fontFamily: font.bold,
    fontSize: 38,
  },
  playerEndedMessageMobile: {
    color: color.softSilver,
    fontFamily: font.medium,
    fontSize: 15,
    lineHeight: 21,
    maxWidth: 300,
    textAlign: 'center',
  },
  playerEndedMessageTv: {
    color: color.softSilver,
    fontFamily: font.medium,
    fontSize: 23,
    lineHeight: 31,
    maxWidth: 720,
    textAlign: 'center',
  },
  postPlayActions: {
    alignItems: 'center',
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 12,
    justifyContent: 'center',
  },
  playerTimeMobile: {
    color: color.softSilver,
    fontFamily: font.medium,
    fontSize: 12,
  },
  playerTimeTv: {
    color: color.softSilver,
    fontFamily: font.medium,
    fontSize: 18,
  },
  playerFailure: {
    backgroundColor: color.projector,
    flex: 1,
    justifyContent: 'center',
  },
  playerFailureOverlay: {...StyleSheet.absoluteFillObject, zIndex: 8},
  failureActions: {flexDirection: 'row', gap: 8},
  failureActionsTv: {gap: 12},
});
