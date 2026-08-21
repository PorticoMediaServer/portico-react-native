import React, {useEffect, useMemo, useState} from 'react';
import {
  ActivityIndicator,
  Image,
  ImageBackground,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import {useMutation, useQuery, useQueryClient} from '@tanstack/react-query';
import {
  productErrorMessageId,
  serverImageSource,
  usePorticoAuth,
  useViewerRuntime,
} from '@portico-react-native/infrastructure';
import type {TVLogicalFocusContainer} from '@portico-react-native/tv-focus';
import {
  detailViewModel,
  mediaCardViewModel,
  type DetailPersonViewModel,
} from '../../data';
import {
  AmbientArtworkGlow,
  ArtworkScrim,
  EmptyState,
  Focusable,
  HeroPlayButton,
  InlineNotice,
  SectionHeading,
  TVLogicalFocusContainerBoundary,
} from '../primitives';
import {MediaRow} from '../sharedComponents';
import {usePorticoNavigationActions} from '../navigation';
import {DetailMoreAction} from '../detailActions';
import {useEngagement} from '../engagement';
import {TvSafeContent} from '../shells';
import {color, font, tvType} from '../tokens';
import {TVSemanticIcon, TVSemanticIconButton} from './TVSemanticControls';

export type TVDetailContainerId =
  | 'hero'
  | 'episodes'
  | 'cast'
  | 'extras'
  | 'recommendations'
  | 'facts';

export function createTVDetailFocusContainers(
  availability: Partial<Record<TVDetailContainerId, boolean>>,
): TVLogicalFocusContainer[] {
  const ordered: TVDetailContainerId[] = [
    'hero',
    'episodes',
    'cast',
    'extras',
    'recommendations',
    'facts',
  ];
  const visible = ordered.filter(id => availability[id] !== false);
  return visible.map((id, index) => ({
    id: `detail:${id}`,
    movement: 'native',
    neighbours: {
      ...(id === 'hero' ? {right: 'detail:facts'} : {}),
      ...(id === 'facts' ? {left: 'detail:hero'} : {}),
      ...(index > 0 ? {up: `detail:${visible[index - 1]}`} : {}),
      ...(index + 1 < visible.length
        ? {down: `detail:${visible[index + 1]}`}
        : {}),
    },
  }));
}

const detailFocusContainers = Object.fromEntries(
  createTVDetailFocusContainers({}).map(container => [
    container.id.slice('detail:'.length),
    container,
  ]),
) as Record<TVDetailContainerId, TVLogicalFocusContainer>;

export function TVDetailPresenter({
  episodeId,
  mediaId,
  seasonId,
}: {
  episodeId?: string;
  mediaId: string;
  seasonId?: string;
}) {
  const client = usePorticoAuth().session!.client;
  const runtime = useViewerRuntime();
  const queryClient = useQueryClient();
  const navigation = usePorticoNavigationActions();
  const engagement = useEngagement();
  const [selectedSeasonId, setSelectedSeasonId] = useState(seasonId);
  const query = useQuery({
    queryKey: ['media', mediaId],
    queryFn: ({signal}) =>
      client.media(mediaId, {includeRecommendations: true}, {signal}),
  });
  const detail = query.data
    ? detailViewModel(query.data, client, 'tv')
    : undefined;
  const seasons = useMemo(
    () =>
      detail?.media.kind === 'show'
        ? (detail.media.raw.children ?? []).filter(
            child => child.type === 'season',
          )
        : [],
    [detail],
  );
  useEffect(() => {
    if (!selectedSeasonId && seasons[0]) setSelectedSeasonId(seasons[0].id);
  }, [seasons, selectedSeasonId]);
  const selectedSeason =
    seasons.find(candidate => candidate.id === selectedSeasonId) ?? seasons[0];
  const episodesQuery = useQuery({
    enabled: Boolean(selectedSeason),
    queryKey: ['media-children', mediaId, selectedSeason?.id, 'tv-presenter'],
    queryFn: ({signal}) =>
      client.mediaChildren(selectedSeason!.id, {limit: 100}, {signal}),
  });
  const episodes = useMemo(
    () =>
      (episodesQuery.data?.items ?? []).map(item =>
        mediaCardViewModel(item, client),
      ),
    [client, episodesQuery.data?.items],
  );
  const mutation = useMutation({
    mutationFn: (operation: (signal: AbortSignal) => Promise<unknown>) =>
      runtime.runRequest(operation),
    onSuccess: async () => {
      await queryClient.invalidateQueries({queryKey: ['media', mediaId]});
    },
  });
  if (query.isLoading)
    return (
      <View style={styles.loading}>
        <ActivityIndicator color={color.screenBlueStrong} size="large" />
      </View>
    );
  if (!detail)
    return (
      <EmptyState
        actionLabel="Try again"
        message={productErrorMessageId(query.error, 'media.load-failed', {
          featureName: 'This item',
        })}
        onAction={() => void query.refetch()}
        platform="tv"
        title="Media couldn’t load"
      />
    );
  const item = detail.media;
  const capabilities = new Set(detail.actions);
  const playable =
    capabilities.has('play') ||
    capabilities.has('dvr.play') ||
    capabilities.has('live.play');
  const run = (operation: (signal: AbortSignal) => Promise<unknown>) => {
    if (!mutation.isPending) mutation.mutate(operation);
  };
  return (
    <ScrollView
      contentContainerStyle={styles.page}
      showsVerticalScrollIndicator={false}
      testID="portico-tv-detail-native"
    >
      <TVLogicalFocusContainerBoundary container={detailFocusContainers.hero}>
        <View style={styles.hero}>
          <AmbientArtworkGlow platform="tv" />
          <ImageBackground
            resizeMode="cover"
            source={serverImageSource(item.backdrop)}
            style={styles.heroArtwork}
          >
            <ArtworkScrim platform="tv" strong />
            <TvSafeContent style={styles.heroCopy}>
              {item.parentTitle ? (
                <Text style={styles.parent}>{item.parentTitle}</Text>
              ) : null}
              <Text numberOfLines={2} style={styles.title}>
                {item.title}
              </Text>
              <Text style={styles.meta}>
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
              <Text numberOfLines={2} style={styles.summary}>
                {item.summary}
              </Text>
              <View style={styles.actions}>
                {playable ? (
                  <HeroPlayButton
                    label={
                      capabilities.has('live.play')
                        ? 'Watch Live'
                        : item.progress
                          ? 'Resume'
                          : 'Play'
                    }
                    onPress={() => navigation.openPlayableMedia(item)}
                    platform="tv"
                    testID="detail:hero:play"
                    tvFocusBoundaryDirections={['down']}
                  />
                ) : null}
                {hasAction(detail.actions, 'watchlist') ? (
                  <TVSemanticIconButton
                    id="action.watchlist"
                    label={
                      item.state.watchlisted
                        ? 'Remove from Saved'
                        : 'Add to Saved'
                    }
                    onPress={() =>
                      run(signal =>
                        client.setWatchlist(item.id, !item.state.watchlisted, {
                          signal,
                        }),
                      )
                    }
                    selected={item.state.watchlisted}
                    tvFocusBoundaryDirections={['down']}
                  />
                ) : null}
                {hasAction(detail.actions, 'favorite') ? (
                  <TVSemanticIconButton
                    id="action.favorite"
                    label={item.state.favorite ? 'Remove favorite' : 'Favorite'}
                    onPress={() =>
                      run(signal =>
                        client.setFavorite(item.id, !item.state.favorite, {
                          signal,
                        }),
                      )
                    }
                    selected={item.state.favorite}
                    tvFocusBoundaryDirections={['down']}
                  />
                ) : null}
                <TVSemanticIconButton
                  id="action.report"
                  label="Report a problem"
                  onPress={() =>
                    engagement.openFeedback({
                      initialKind: 'media',
                      mediaId: item.id,
                      mediaTitle: item.title,
                    })
                  }
                  tvFocusBoundaryDirections={['down']}
                />
                <DetailMoreAction
                  client={client}
                  item={item}
                  onPlayVersion={() =>
                    navigation.openPlayer(item.playbackMediaId)
                  }
                  platform="tv"
                  secondaryActions={[]}
                  tvFocusBoundaryDirections={['down']}
                  tvFocusNeighbours={{right: 'detail:facts'}}
                />
              </View>
            </TvSafeContent>
          </ImageBackground>
        </View>
      </TVLogicalFocusContainerBoundary>
      <TvSafeContent style={styles.body}>
        {mutation.error ? (
          <InlineNotice
            kind="error"
            message={productErrorMessageId(
              mutation.error,
              'catalog.action-failed',
              {actionName: 'save that change'},
            )}
            platform="tv"
          />
        ) : null}
        {seasons.length ? (
          <TVLogicalFocusContainerBoundary
            container={detailFocusContainers.episodes}
          >
            <View style={styles.section}>
              <SectionHeading platform="tv" title="Episodes" />
              <ScrollView
                contentContainerStyle={styles.seasonRow}
                horizontal
                showsHorizontalScrollIndicator={false}
              >
                {seasons.map(season => (
                  <Focusable
                    accessibilityRole="button"
                    accessibilityState={{
                      selected: season.id === selectedSeason?.id,
                    }}
                    key={season.id}
                    onPress={() => setSelectedSeasonId(season.id)}
                    platform="tv"
                    style={[
                      styles.season,
                      season.id === selectedSeason?.id && styles.seasonSelected,
                    ]}
                    focusedStyle={styles.focused}
                    tvFocusId={`detail:season:${season.id}`}
                    tvFocusBoundaryDirections={['up']}
                  >
                    <Text style={styles.seasonLabel}>{season.title}</Text>
                  </Focusable>
                ))}
              </ScrollView>
              {episodesQuery.isLoading ? (
                <ActivityIndicator color={color.screenBlueStrong} />
              ) : episodes.length ? (
                <MediaRow
                  flush
                  items={episodes}
                  onOpen={episode => navigation.openPlayer(episode.id)}
                  platform="tv"
                  selectedId={episodeId}
                  shape="landscape"
                  showHeading={false}
                  title="Episodes"
                  tvFocusBoundaryDirections={['down']}
                />
              ) : (
                <InlineNotice
                  kind="warning"
                  message="No episodes are available for this season."
                  platform="tv"
                />
              )}
            </View>
          </TVLogicalFocusContainerBoundary>
        ) : null}
        {detail.people.length ? (
          <CastRow
            people={detail.people}
            onOpen={person => navigation.openPerson(person.id)}
          />
        ) : null}
        {detail.extras.map((section, index) => (
          <TVLogicalFocusContainerBoundary
            container={detailFocusContainers.extras}
            key={section.id}
          >
            <MediaRow
              flush
              items={section.items}
              onOpen={navigation.openMediaDetail}
              platform="tv"
              shape="poster"
              title={section.title}
              tvFocusBoundaryDirections={[
                ...(index === 0 ? ['up' as const] : []),
                ...(index === detail.extras.length - 1
                  ? ['down' as const]
                  : []),
              ]}
            />
          </TVLogicalFocusContainerBoundary>
        ))}
        {detail.recommendations.map((section, index) => (
          <TVLogicalFocusContainerBoundary
            container={detailFocusContainers.recommendations}
            key={section.id}
          >
            <MediaRow
              flush
              items={section.items}
              onOpen={navigation.openMediaDetail}
              platform="tv"
              shape="poster"
              title={section.title}
              tvFocusBoundaryDirections={[
                ...(index === 0 ? ['up' as const] : []),
                ...(index === detail.recommendations.length - 1
                  ? ['down' as const]
                  : []),
              ]}
            />
          </TVLogicalFocusContainerBoundary>
        ))}
        <TVLogicalFocusContainerBoundary
          container={detailFocusContainers.facts}
        >
          <Focusable
            accessibilityLabel="Versions and media information"
            accessibilityRole="text"
            platform="tv"
            style={styles.section}
            focusedStyle={styles.factsFocused}
            tvFocusId="detail:facts"
            tvFocusBoundaryDirections={['left', 'up']}
          >
            <SectionHeading
              platform="tv"
              title="Versions & media information"
            />
            {detail.facts.length ? (
              <View style={styles.facts}>
                {detail.facts.map(fact => (
                  <View key={`${fact.label}:${fact.value}`} style={styles.fact}>
                    <Text style={styles.factLabel}>{fact.label}</Text>
                    <Text style={styles.factValue}>{fact.value}</Text>
                  </View>
                ))}
              </View>
            ) : (
              <Text style={styles.summary}>
                No technical media information is available.
              </Text>
            )}
          </Focusable>
        </TVLogicalFocusContainerBoundary>
      </TvSafeContent>
    </ScrollView>
  );
}

export function TVLiveChannelDetailPresenter({mediaId}: {mediaId: string}) {
  const client = usePorticoAuth().session!.client;
  const navigation = usePorticoNavigationActions();
  const channelQuery = useQuery({
    queryKey: ['live-channel', mediaId],
    queryFn: ({signal}) => client.liveTvChannel(mediaId, {signal}),
  });
  const channel = channelQuery.data;
  const guideQuery = useQuery({
    enabled: Boolean(channel),
    queryKey: ['live-channel-guide', channel?.sourceId],
    queryFn: ({signal}) =>
      client.liveTvGuide(channel!.sourceId, {hours: 3, limit: 250}, {signal}),
  });
  if (channelQuery.isLoading)
    return (
      <View style={styles.loading}>
        <ActivityIndicator color={color.screenBlueStrong} size="large" />
      </View>
    );
  if (!channel)
    return (
      <EmptyState
        actionLabel="Try again"
        message={productErrorMessageId(
          channelQuery.error,
          'media.load-failed',
          {featureName: 'This channel'},
        )}
        onAction={() => void channelQuery.refetch()}
        platform="tv"
        title="Channel couldn’t load"
      />
    );
  const now = guideQuery.data
    ? Date.parse(guideQuery.data.serverTime)
    : Date.now();
  const current = guideQuery.data?.programs.find(
    program =>
      program.channelId === channel.id &&
      Date.parse(program.startAt) <= now &&
      Date.parse(program.endAt) > now,
  );
  return (
    <ScrollView
      contentContainerStyle={styles.page}
      testID="portico-tv-live-detail-native"
    >
      <View style={styles.hero}>
        <AmbientArtworkGlow platform="tv" />
        <TvSafeContent style={styles.heroCopy}>
          <Text style={styles.parent}>
            Live TV · {channel.number ?? channel.groupTitle ?? 'Channel'}
          </Text>
          <Text style={styles.title}>{channel.name}</Text>
          <Text style={styles.meta}>
            {current?.title ??
              (guideQuery.isLoading
                ? 'Loading guide…'
                : 'No guide data available')}
          </Text>
          <Text style={styles.summary}>
            {current?.subtitle ??
              'Tune this channel to watch the current broadcast.'}
          </Text>
          {channel.actions.includes('live.play') ? (
            <HeroPlayButton
              label="Watch Live"
              onPress={() => navigation.openPlayer(channel.id, true)}
              platform="tv"
            />
          ) : null}
        </TvSafeContent>
      </View>
    </ScrollView>
  );
}

function CastRow({
  onOpen,
  people,
}: {
  onOpen(person: DetailPersonViewModel): void;
  people: DetailPersonViewModel[];
}) {
  return (
    <TVLogicalFocusContainerBoundary container={detailFocusContainers.cast}>
      <View style={styles.section}>
        <SectionHeading platform="tv" title="Cast & Crew" />
        <ScrollView
          contentContainerStyle={styles.cast}
          horizontal
          showsHorizontalScrollIndicator={false}
        >
          {people.map((person, index) => (
            <Focusable
              accessibilityLabel={`${person.name}, ${person.character || person.role}`}
              key={`${person.id}:${index}`}
              onPress={() => onOpen(person)}
              platform="tv"
              style={styles.person}
              focusedStyle={styles.focused}
              tvFocusId={`detail:cast:${person.id}`}
              tvFocusBoundaryDirections={['down', 'up']}
            >
              <View style={styles.headshot}>
                {person.imageUrl ? (
                  <Image
                    source={serverImageSource(person.imageUrl)}
                    style={styles.headshotImage}
                  />
                ) : (
                  <TVSemanticIcon id="account.user" size={42} />
                )}
              </View>
              <Text numberOfLines={1} style={styles.personName}>
                {person.name}
              </Text>
              <Text numberOfLines={1} style={styles.personRole}>
                {person.character || person.role}
              </Text>
            </Focusable>
          ))}
        </ScrollView>
      </View>
    </TVLogicalFocusContainerBoundary>
  );
}

function hasAction(
  actions: string[],
  family: 'favorite' | 'watchlist',
): boolean {
  return (
    actions.includes(`${family}.add`) || actions.includes(`${family}.remove`)
  );
}

const styles = StyleSheet.create({
  page: {backgroundColor: color.projector, minHeight: '100%'},
  loading: {
    alignItems: 'center',
    backgroundColor: color.projector,
    flex: 1,
    justifyContent: 'center',
  },
  hero: {height: 650, overflow: 'hidden'},
  heroArtwork: {flex: 1},
  heroCopy: {
    justifyContent: 'flex-end',
    maxWidth: 1180,
    paddingBottom: 70,
    paddingRight: 100,
  },
  parent: {
    color: color.softSilver,
    fontFamily: font.demi,
    fontSize: 22,
    marginBottom: 10,
  },
  title: {...tvType.hero, color: color.silver, maxWidth: 940},
  meta: {
    color: color.softSilver,
    fontFamily: font.medium,
    fontSize: 22,
    marginTop: 14,
  },
  summary: {
    color: color.softSilver,
    fontFamily: font.regular,
    fontSize: 22,
    lineHeight: 32,
    marginTop: 14,
  },
  actions: {alignItems: 'center', flexDirection: 'row', gap: 14, marginTop: 25},
  body: {gap: 44, paddingBottom: 100, paddingRight: 80, paddingTop: 25},
  section: {gap: 16},
  seasonRow: {gap: 10},
  season: {
    borderColor: color.lineStrong,
    borderRadius: 8,
    borderWidth: 3,
    paddingHorizontal: 20,
    paddingVertical: 13,
  },
  seasonSelected: {backgroundColor: color.raisedSlate},
  seasonLabel: {color: color.silver, fontFamily: font.demi, fontSize: 20},
  focused: {backgroundColor: color.brightSlate, borderColor: color.focus},
  cast: {gap: 16},
  person: {
    borderColor: color.transparent,
    borderRadius: 8,
    borderWidth: 3,
    padding: 10,
    width: 180,
  },
  headshot: {
    alignItems: 'center',
    backgroundColor: color.raisedSlate,
    height: 150,
    justifyContent: 'center',
    overflow: 'hidden',
    width: 154,
  },
  headshotImage: {height: '100%', width: '100%'},
  personName: {
    color: color.silver,
    fontFamily: font.demi,
    fontSize: 18,
    marginTop: 9,
  },
  personRole: {
    color: color.softSilver,
    fontFamily: font.regular,
    fontSize: 15,
    marginTop: 3,
  },
  facts: {flexDirection: 'row', flexWrap: 'wrap', gap: 12},
  factsFocused: {backgroundColor: color.raisedSlate},
  fact: {
    borderTopColor: color.line,
    borderTopWidth: 1,
    paddingTop: 12,
    width: '31%',
  },
  factLabel: {color: color.softSilver, fontFamily: font.medium, fontSize: 16},
  factValue: {
    color: color.silver,
    fontFamily: font.demi,
    fontSize: 19,
    marginTop: 5,
  },
});
