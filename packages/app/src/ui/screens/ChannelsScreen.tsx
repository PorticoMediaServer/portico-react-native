import React, {useEffect, useMemo, useState} from 'react';
import {
  Alert,
  Image,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import {PorticoIcon} from '@portico-react-native/icons';
import {useMutation, useQuery, useQueryClient} from '@tanstack/react-query';
import {
  productErrorMessageId,
  serverImageSource,
  usePorticoAuth,
  useViewerRuntime,
} from '@portico-react-native/infrastructure';
import {ApiError} from '@porticomediaserver/client-core';
import type {
  DVRRecording,
  DVRConsumerStatus,
  LiveTVChannel,
  LiveTVProgram,
  LiveTVSourceSummary,
  LibraryChannelSummary,
  PorticoClient,
} from '@porticomediaserver/client-core';
type LibraryChannelGuideEntry = Awaited<
  ReturnType<PorticoClient['libraryChannelsGuide']>
>['programs'][number];

export function uniqueLiveTVItems<T extends {id: string}>(
  pages: readonly (readonly T[])[],
): T[] {
  const items = new Map<string, T>();
  for (const page of pages) for (const item of page) items.set(item.id, item);
  return [...items.values()];
}

export function resilientGuideChannels(
  guideChannels: readonly LiveTVChannel[],
  directoryChannels: readonly LiveTVChannel[],
  guideAvailable: boolean,
  filter: 'all' | 'favorites' | 'sports' | 'news' | 'movies',
): LiveTVChannel[] {
  if (
    guideAvailable &&
    (filter === 'sports' || filter === 'news' || filter === 'movies')
  )
    return [...guideChannels];
  return directoryChannels.length ? [...directoryChannels] : [...guideChannels];
}

export type DvrCapabilityState = 'unknown' | 'supported' | 'unsupported';

export function dvrCapabilityState(input: {
  hasSource: boolean;
  isSuccess: boolean;
}): DvrCapabilityState {
  if (!input.hasSource) return 'unsupported';
  return input.isSuccess ? 'supported' : 'unknown';
}

export function liveTvTabsForCapability(
  capability: DvrCapabilityState,
  requestedTab?: string,
): string[] {
  if (capability === 'unsupported')
    return [guideTab, channelsTab, libraryChannelsTab];
  if (capability === 'supported' || requestedTab === dvrTab)
    return [guideTab, channelsTab, dvrTab, libraryChannelsTab];
  return [guideTab, channelsTab, libraryChannelsTab];
}

export type GuidePageCursor = Readonly<{
  directory: string | null | undefined;
  guide: string | null | undefined;
}>;

export function nextGuidePageCursor(input: {
  directoryHasMore: boolean;
  directoryNext?: string;
  guideHasMore: boolean;
  guideNext?: string;
}): GuidePageCursor | undefined {
  const directory =
    input.directoryHasMore && input.directoryNext ? input.directoryNext : null;
  const guide = input.guideHasMore && input.guideNext ? input.guideNext : null;
  return directory === null && guide === null ? undefined : {directory, guide};
}

export const GUIDE_QUERY_WINDOW_HOURS = 6;
export const GUIDE_RENDER_CHANNEL_LIMIT = 24;

export function guideQueryWindow(
  dayOffset: number,
  now: number,
  hours = GUIDE_QUERY_WINDOW_HOURS,
): {from: number; hours: number} {
  const start = dayStart(dayOffset, now).getTime();
  const end = start + 24 * 60 * 60 * 1_000;
  const duration = hours * 60 * 60 * 1_000;
  const from =
    dayOffset === 0
      ? Math.max(start, Math.min(end - duration, now - 60 * 60 * 1_000))
      : start;
  return {from, hours};
}

export function boundedGuideChannelWindow<T>(
  items: readonly T[],
  start: number,
  limit = GUIDE_RENDER_CHANNEL_LIMIT,
): {items: T[]; start: number; hasPrevious: boolean; hasNext: boolean} {
  const boundedStart = Math.max(
    0,
    Math.min(Math.max(0, items.length - limit), start),
  );
  return {
    items: items.slice(boundedStart, boundedStart + limit),
    start: boundedStart,
    hasPrevious: boundedStart > 0,
    hasNext: boundedStart + limit < items.length,
  };
}

const failedChannelLogoUris = new Set<string>();
const maximumRememberedChannelLogoFailures = 256;

function rememberChannelLogoFailure(uri: string | undefined) {
  if (!uri || failedChannelLogoUris.has(uri)) return;
  if (failedChannelLogoUris.size >= maximumRememberedChannelLogoFailures) {
    const oldest = failedChannelLogoUris.values().next().value;
    if (oldest) failedChannelLogoUris.delete(oldest);
  }
  failedChannelLogoUris.add(uri);
}
import type {PrototypePlatform} from '../../ui-compat/contract';
import {
  channelColor,
  channelMark,
  completedRecordings,
  currentProgram,
  formatBytes,
  programsByChannel,
} from '../../data';
import {color, font, mobileType, tvType} from '../tokens';
import {
  ArtworkScrim,
  ControlButton,
  EmptyState,
  Focusable,
  ProductEmptyState,
  UnderlineTabs,
} from '../primitives';
import {HeaderUtilities} from '../sharedComponents';
import {usePrototypeUi} from '../uiState';
import {usePorticoNavigationActions} from '../navigation';
import {
  MobileChromePivot,
  MobileChromeScaffold,
  mobileChromeScope,
  useMobileChromeScroll,
} from '../shells';
import {productText} from '../productCopy';

const guideTab = productText('live-tv.tab.guide');
const channelsTab = productText('live-tv.tab.channels');
const dvrTab = productText('live-tv.tab.dvr');
const libraryChannelsTab = productText('live-tv.tab.library-channels');

export function ChannelsScreen({platform}: {platform: PrototypePlatform}) {
  const television = platform === 'tv';
  const auth = usePorticoAuth();
  const client = auth.session!.client;
  const {liveTab, setLiveTab} = usePrototypeUi();
  const {openSearch, replacePrimarySubTab, route} =
    usePorticoNavigationActions();
  const sources = useQuery({
    queryKey: ['live-tv-sources'],
    queryFn: ({signal}) => client.liveTv({signal}),
  });
  const enabledSources =
    sources.data?.items.filter(candidate => candidate.enabled) ?? [];
  const [selectedSourceId, setSelectedSourceId] = useState('');
  const source =
    enabledSources.find(candidate => candidate.id === selectedSourceId) ??
    enabledSources[0];
  const {onScroll, scrollY} = useMobileChromeScroll(
    mobileChromeScope(
      'channels',
      auth.session?.serverId,
      auth.session?.viewerScope.profileId,
      {pivot: liveTab, source: source?.id},
    ),
  );
  useEffect(() => {
    if (source && source.id !== selectedSourceId)
      setSelectedSourceId(source.id);
  }, [selectedSourceId, source]);
  const dvrCapability = useQuery({
    queryKey: ['dvr-status', source?.id],
    enabled: Boolean(source),
    retry: false,
    queryFn: ({signal}) => {
      if (!source) throw new Error('Live TV source is required.');
      return client.dvrStatus(source.id, {signal});
    },
  });
  const dvrState = dvrCapabilityState({
    hasSource: Boolean(source),
    isSuccess: dvrCapability.isSuccess,
  });
  const requestedTab = route.name === 'channels' ? route.tab : undefined;
  const liveTabs = React.useMemo(
    () =>
      source
        ? liveTvTabsForCapability(dvrState, requestedTab ?? liveTab)
        : [libraryChannelsTab],
    [dvrState, liveTab, requestedTab, source],
  );
  const [selectedProgramId, setSelectedProgramId] = useState('');
  useEffect(() => {
    if (route.name !== 'channels' || sources.isLoading) return;
    const target =
      route.tab && liveTabs.includes(route.tab)
        ? route.tab
        : liveTabs.includes(liveTab)
          ? liveTab
          : liveTabs[0];
    if (!target) return;
    if (liveTab !== target) setLiveTab(target);
    if (route.tab !== target) replacePrimarySubTab('channels', target);
  }, [
    liveTab,
    liveTabs,
    replacePrimarySubTab,
    route,
    setLiveTab,
    sources.isLoading,
  ]);
  const changeLiveTab = React.useCallback(
    (value: string) => {
      setLiveTab(value);
      replacePrimarySubTab('channels', value);
    },
    [replacePrimarySubTab, setLiveTab],
  );
  if (sources.isLoading) {
    const loading = (
      <ProductEmptyState id="live-tv.loading" platform={platform} />
    );
    return television ? (
      loading
    ) : (
      <MobileChromeScaffold
        header={
          <HeaderUtilities
            flush
            onSearch={openSearch}
            platform="mobile"
            title="Channels"
          />
        }
        scrollY={scrollY}
        testID="portico-mobile-channels-chrome"
      >
        <ScrollView
          contentContainerStyle={styles.page}
          onScroll={onScroll}
          scrollEventThrottle={16}
        >
          {loading}
        </ScrollView>
      </MobileChromeScaffold>
    );
  }
  if (sources.error && !sources.data) {
    const unavailable =
      sources.error instanceof ApiError &&
      (sources.error.status === 403 || sources.error.status === 404);
    const error = (
      <ProductEmptyState
        id={unavailable ? 'live-tv.empty' : 'live-tv.load-failed'}
        onAction={unavailable ? undefined : () => void sources.refetch()}
        platform={platform}
        variables={unavailable ? undefined : {featureName: 'Live TV sources'}}
      />
    );
    return television ? (
      error
    ) : (
      <MobileChromeScaffold
        header={
          <HeaderUtilities
            flush
            onSearch={openSearch}
            platform="mobile"
            title="Channels"
          />
        }
        scrollY={scrollY}
        testID="portico-mobile-channels-chrome"
      >
        <ScrollView
          contentContainerStyle={styles.page}
          onScroll={onScroll}
          scrollEventThrottle={16}
        >
          {error}
        </ScrollView>
      </MobileChromeScaffold>
    );
  }
  const content = (
    <>
      {television ? (
        <HeaderUtilities flush platform={platform} title="Channels" />
      ) : null}
      {television && enabledSources.length > 1 ? (
        <ScrollView
          contentContainerStyle={styles.sourceRow}
          horizontal
          showsHorizontalScrollIndicator={false}
        >
          {enabledSources.map(candidate => (
            <ControlButton
              compact
              key={candidate.id}
              label={candidate.name}
              onPress={() => {
                setSelectedSourceId(candidate.id);
                setSelectedProgramId('');
              }}
              platform={platform}
              selected={candidate.id === source?.id}
            />
          ))}
        </ScrollView>
      ) : null}
      {television ? (
        <UnderlineTabs
          active={liveTab}
          onChange={changeLiveTab}
          platform={platform}
          tabs={liveTabs}
        />
      ) : null}
      {liveTab === libraryChannelsTab ? (
        <LibraryChannelsSurface client={client} platform={platform} />
      ) : liveTab === guideTab && source ? (
        <GuideSurface
          client={client}
          onSelect={setSelectedProgramId}
          platform={platform}
          source={source}
          selectedProgramId={selectedProgramId}
        />
      ) : liveTab === channelsTab && source ? (
        <ChannelSurface
          client={client}
          onOpenGuide={programId => {
            setSelectedProgramId(programId);
            changeLiveTab(guideTab);
          }}
          platform={platform}
          source={source}
        />
      ) : dvrState === 'supported' && source ? (
        <DvrSurface client={client} platform={platform} source={source} />
      ) : liveTab === dvrTab && dvrState === 'unknown' ? (
        <ProductEmptyState
          id="live-tv.load-failed"
          onAction={() => void dvrCapability.refetch()}
          platform={platform}
          variables={{featureName: 'DVR availability'}}
        />
      ) : (
        <ProductEmptyState id="live-tv.restricted" platform={platform} />
      )}
    </>
  );
  const mobileSourceRow =
    enabledSources.length > 1 ? (
      <ScrollView
        contentContainerStyle={styles.sourceRow}
        horizontal
        showsHorizontalScrollIndicator={false}
      >
        {enabledSources.map(candidate => (
          <ControlButton
            compact
            key={candidate.id}
            label={candidate.name}
            onPress={() => {
              setSelectedSourceId(candidate.id);
              setSelectedProgramId('');
            }}
            platform={platform}
            selected={candidate.id === source?.id}
          />
        ))}
      </ScrollView>
    ) : null;
  const mobile = (
    <MobileChromeScaffold
      controlRows={mobileSourceRow ? 1 : 0}
      controls={mobileSourceRow}
      header={
        <HeaderUtilities
          flush
          onSearch={openSearch}
          platform="mobile"
          title="Channels"
        />
      }
      pivot={
        <MobileChromePivot
          active={liveTab}
          onChange={changeLiveTab}
          tabs={liveTabs}
        />
      }
      scrollY={scrollY}
      testID="portico-mobile-channels-chrome"
    >
      <ScrollView
        contentContainerStyle={styles.page}
        onScroll={onScroll}
        scrollEventThrottle={16}
        showsVerticalScrollIndicator={false}
        testID="portico-four-channels-mobile"
      >
        {content}
      </ScrollView>
    </MobileChromeScaffold>
  );
  return television ? (
    <ScrollView
      contentContainerStyle={[styles.page, styles.pageTv]}
      showsVerticalScrollIndicator={false}
      testID="portico-four-channels-tv"
    >
      {content}
    </ScrollView>
  ) : (
    mobile
  );
}

function GuideSurface({
  client,
  onSelect,
  platform,
  source,
  selectedProgramId,
}: {
  client: PorticoClient;
  onSelect(id: string): void;
  platform: PrototypePlatform;
  source: LiveTVSourceSummary;
  selectedProgramId: string;
}) {
  const television = platform === 'tv';
  const {openPlayer} = usePorticoNavigationActions();
  const queryClient = useQueryClient();
  const viewerRuntime = useViewerRuntime();
  const [dayOffset, setDayOffset] = useState(0);
  const [group, setGroup] = useState<string>();
  const [guideFilter, setGuideFilter] = useState<
    'all' | 'favorites' | 'sports' | 'news' | 'movies'
  >('all');
  const [guideQuery, setGuideQuery] = useState('');
  const [guideSearchOpen, setGuideSearchOpen] = useState(false);
  const [stableGuideQuery, setStableGuideQuery] = useState('');
  const [channelWindowStart, setChannelWindowStart] = useState(0);
  const [guideAnchorNow, setGuideAnchorNow] = useState(() => Date.now());
  useEffect(() => {
    const timer = setTimeout(() => setStableGuideQuery(guideQuery.trim()), 300);
    return () => clearTimeout(timer);
  }, [guideQuery]);
  const queryWindow = useMemo(
    () => guideQueryWindow(dayOffset, guideAnchorNow),
    [dayOffset, guideAnchorNow],
  );
  const guideFrom = useMemo(
    () => new Date(queryWindow.from).toISOString(),
    [queryWindow.from],
  );
  const pageScope = `${source.id}\u0000${guideFrom}\u0000${group ?? ''}\u0000${guideFilter}\u0000${stableGuideQuery}`;
  const [pagination, setPagination] = useState<{
    cursors: GuidePageCursor[];
    scope: string;
  }>({cursors: [{directory: undefined, guide: undefined}], scope: pageScope});
  const pageCursors =
    pagination.scope === pageScope
      ? pagination.cursors
      : [{directory: undefined, guide: undefined}];
  const pageCursor = pageCursors[pageCursors.length - 1]!;
  useEffect(() => {
    if (pagination.scope === pageScope) return;
    setPagination({
      cursors: [{directory: undefined, guide: undefined}],
      scope: pageScope,
    });
    setChannelWindowStart(0);
  }, [pageScope, pagination.scope]);
  const guide = useQuery({
    queryKey: [
      'live-tv-guide',
      source.id,
      guideFrom,
      group,
      guideFilter,
      stableGuideQuery,
      pageCursor.guide,
    ],
    enabled: pageCursor.guide !== null,
    gcTime: 0,
    queryFn: ({signal}) =>
      client.liveTvGuide(
        source.id,
        {
          from: guideFrom,
          hours: queryWindow.hours,
          limit: 250,
          cursor: pageCursor.guide ?? undefined,
          group,
          filter: guideFilter,
          query: stableGuideQuery || undefined,
        },
        {signal},
      ),
  });
  const directory = useQuery({
    queryKey: [
      'live-tv-channels',
      source.id,
      group,
      guideFilter === 'favorites',
      stableGuideQuery,
      pageCursor.directory,
    ],
    enabled: pageCursor.directory !== null,
    gcTime: 0,
    queryFn: ({signal}) =>
      client.liveTvChannels(
        source.id,
        {
          limit: 250,
          cursor: pageCursor.directory ?? undefined,
          group,
          favoritesOnly: guideFilter === 'favorites',
          query: stableGuideQuery || undefined,
        },
        {signal},
      ),
  });
  const guideChannels = useMemo(
    () => guide.data?.channels ?? [],
    [guide.data?.channels],
  );
  const directoryChannels = useMemo(
    () => directory.data?.items ?? [],
    [directory.data?.items],
  );
  const visibleChannels = useMemo(
    () =>
      resilientGuideChannels(
        guideChannels,
        directoryChannels,
        Boolean(guide.data),
        guideFilter,
      ),
    [directoryChannels, guideChannels, guide.data, guideFilter],
  );
  const channelWindow = useMemo(
    () => boundedGuideChannelWindow(visibleChannels, channelWindowStart),
    [channelWindowStart, visibleChannels],
  );
  const guidePrograms = useMemo(
    () => guide.data?.programs ?? [],
    [guide.data?.programs],
  );
  const grouped = useMemo(
    () => programsByChannel(guidePrograms),
    [guidePrograms],
  );
  const selectedProgram =
    guidePrograms.find(program => program.id === selectedProgramId) ??
    (guide.data && Number.isFinite(Date.parse(guide.data.serverTime))
      ? currentProgram(guidePrograms, Date.parse(guide.data.serverTime))
      : undefined);
  const selectedChannel = visibleChannels.find(
    channel => channel.id === selectedProgram?.channelId,
  );
  const parsedServerTime = guide.data ? Date.parse(guide.data.serverTime) : NaN;
  const serverNow = Number.isFinite(parsedServerTime)
    ? parsedServerTime
    : Number.NaN;
  const nextPageCursor = nextGuidePageCursor({
    directoryHasMore: Boolean(directory.data?.pageInfo.hasMore),
    directoryNext: directory.data?.pageInfo.nextCursor ?? undefined,
    guideHasMore: Boolean(guide.data?.pageInfo.hasMore),
    guideNext: guide.data?.pageInfo.nextCursor ?? undefined,
  });
  const hasPreviousPage = pageCursors.length > 1;
  const showGuidePagination =
    hasPreviousPage ||
    channelWindow.hasPrevious ||
    channelWindow.hasNext ||
    Boolean(nextPageCursor);
  const previousChannels = () => {
    if (channelWindow.hasPrevious) {
      setChannelWindowStart(value =>
        Math.max(0, value - GUIDE_RENDER_CHANNEL_LIMIT),
      );
      return;
    }
    if (!hasPreviousPage) return;
    setPagination(current => ({
      cursors: current.cursors.slice(0, -1),
      scope: pageScope,
    }));
    setChannelWindowStart(250 - GUIDE_RENDER_CHANNEL_LIMIT);
  };
  const nextChannels = () => {
    if (channelWindow.hasNext) {
      setChannelWindowStart(value => value + GUIDE_RENDER_CHANNEL_LIMIT);
      return;
    }
    if (!nextPageCursor) return;
    setPagination(current => ({
      cursors: [
        ...(current.scope === pageScope ? current.cursors : pageCursors),
        nextPageCursor,
      ],
      scope: pageScope,
    }));
    setChannelWindowStart(0);
  };
  const selectedIsLive = Boolean(
    selectedProgram &&
    Date.parse(selectedProgram.startAt) <= serverNow &&
    Date.parse(selectedProgram.endAt) > serverNow,
  );
  const channelGroups = guide.data?.channelGroups ?? [];
  const showGroupFilters = channelGroups.length > 1 || Boolean(group);
  const [recordNotice, setRecordNotice] = useState('');
  useEffect(() => {
    if (!selectedProgramId && selectedProgram) onSelect(selectedProgram.id);
  }, [onSelect, selectedProgram, selectedProgramId]);
  const record = useMutation({
    mutationFn: (program: LiveTVProgram) =>
      viewerRuntime.runRequest(signal =>
        client.createDvrRecording(
          {
            sourceId: source.id,
            channelId: program.channelId,
            programId: program.id,
            title: program.title,
            startsAt: program.startAt,
            endsAt: program.endAt,
          },
          {signal},
        ),
      ),
    onMutate: () => setRecordNotice(''),
    onSuccess: async () => {
      setRecordNotice(productText('dvr.recording-scheduled'));
      await queryClient.invalidateQueries({queryKey: ['dvr-recordings']});
    },
  });
  const recordSeries = useMutation({
    mutationFn: (program: LiveTVProgram) =>
      viewerRuntime.runRequest(() =>
        client.createDvrRule({
          sourceId: source.id,
          channelId: program.channelId,
          programId: program.id,
          title: program.title,
          matchType: 'series',
        }),
      ),
    onMutate: () => setRecordNotice(''),
    onSuccess: async () => {
      setRecordNotice(productText('dvr.series-recording-scheduled'));
      await queryClient.invalidateQueries({queryKey: ['dvr-rules']});
    },
  });
  const guideSettledWithoutData =
    pageCursor.guide === null || Boolean(guide.error);
  const directorySettledWithoutData =
    pageCursor.directory === null || Boolean(directory.error);
  if (
    !guide.data &&
    !directory.data &&
    guideSettledWithoutData &&
    directorySettledWithoutData
  )
    return (
      <ProductEmptyState
        id="live-tv.guide-unavailable"
        onAction={() => {
          if (pageCursor.guide !== null) void guide.refetch();
          if (pageCursor.directory !== null) void directory.refetch();
        }}
        platform={platform}
      />
    );
  if (!guide.data && !directory.data)
    return <ProductEmptyState id="live-tv.loading" platform={platform} />;
  return (
    <View>
      <View
        style={[styles.guideControls, television && styles.guideControlsTv]}
      >
        <ScrollView
          contentContainerStyle={styles.controlStrip}
          horizontal
          showsHorizontalScrollIndicator={false}
        >
          {television ? (
            <ControlButton
              compact
              label="Jump to now"
              onPress={() => {
                setGuideAnchorNow(Date.now());
                setDayOffset(0);
                setChannelWindowStart(0);
                onSelect('');
              }}
              platform={platform}
            />
          ) : null}
          {(television ? [0, 1, 2] : [0, 1, 2, 3, 4, 5, 6]).map(offset => (
            <ControlButton
              compact={television}
              dense={!television}
              icon={television ? 'view.calendar' : undefined}
              key={offset}
              label={dayLabel(offset)}
              onPress={() => {
                setGuideAnchorNow(Date.now());
                setDayOffset(offset);
                setChannelWindowStart(0);
                onSelect('');
              }}
              platform={platform}
              selected={dayOffset === offset}
            />
          ))}
        </ScrollView>
        <ScrollView
          contentContainerStyle={styles.controlStrip}
          horizontal
          showsHorizontalScrollIndicator={false}
        >
          {(['all', 'favorites', 'sports', 'news', 'movies'] as const).map(
            value => (
              <ControlButton
                compact={television}
                dense={!television}
                key={value}
                label={humanizeChannelFilter(value)}
                onPress={() => setGuideFilter(value)}
                platform={platform}
                selected={guideFilter === value}
              />
            ),
          )}
          {showGroupFilters ? (
            <ControlButton
              compact={television}
              dense={!television}
              label="All groups"
              onPress={() => setGroup(undefined)}
              platform={platform}
              selected={!group}
            />
          ) : null}
          {showGroupFilters
            ? channelGroups.map(value => (
                <ControlButton
                  compact={television}
                  dense={!television}
                  key={value}
                  label={`Group: ${value}`}
                  onPress={() => setGroup(value)}
                  platform={platform}
                  selected={group === value}
                />
              ))
            : null}
          {!television ? (
            <ControlButton
              dense
              icon="navigation.search"
              label={guideQuery ? 'Search active' : 'Search'}
              onPress={() => setGuideSearchOpen(value => !value)}
              platform={platform}
              selected={guideSearchOpen || Boolean(guideQuery)}
            />
          ) : null}
        </ScrollView>
        {!television && guideSearchOpen ? (
          <View style={styles.guideSearch}>
            <PorticoIcon color={color.dimSilver} id="navigation.search" size={18} />
            <TextInput
              accessibilityLabel="Search guide"
              autoFocus
              onChangeText={setGuideQuery}
              placeholder="Search channels and programmes"
              placeholderTextColor={color.mutedSilver}
              returnKeyType="search"
              style={styles.guideSearchInput}
              value={guideQuery}
            />
          </View>
        ) : null}
      </View>
      {guide.error && visibleChannels.length ? (
        <Text
          accessibilityRole="text"
          style={television ? styles.guideNoticeTv : styles.guideNoticeMobile}
        >
          Schedule data is temporarily unavailable. Channels remain ready to
          watch.
        </Text>
      ) : null}
      {guide.error && pageCursor.guide !== null ? (
        <View style={styles.paginationRetry}>
          <ControlButton
            compact
            label={productText('action.retry')}
            onPress={() => void guide.refetch()}
            platform={platform}
          />
        </View>
      ) : null}
      {directory.error && pageCursor.directory !== null ? (
        <View style={styles.paginationRetry}>
          <ControlButton
            compact
            label={productText('action.retry')}
            onPress={() => void directory.refetch()}
            platform={platform}
          />
        </View>
      ) : null}
      {selectedProgram ? (
        <View style={[styles.guideHero, television && styles.guideHeroTv]}>
          <ArtworkScrim platform={platform} strong />
          <View
            style={[styles.guideHeroCopy, television && styles.guideHeroCopyTv]}
          >
            <View style={styles.liveLabel}>
              <PorticoIcon color={color.record} id="status.live" size={television ? 12 : 8} state="selected" />
              <Text
                style={
                  television
                    ? styles.liveLabelTextTv
                    : styles.liveLabelTextMobile
                }
              >
                {selectedIsLive
                  ? 'LIVE NOW'
                  : timeRange(selectedProgram.startAt, selectedProgram.endAt)}
              </Text>
            </View>
            <Text
              numberOfLines={1}
              style={[
                television ? tvType.title : mobileType.title,
                styles.guideHeroTitle,
              ]}
            >
              {selectedProgram.title}
            </Text>
            <Text
              style={
                television ? styles.guideHeroMetaTv : styles.guideHeroMetaMobile
              }
            >
              {selectedProgram.subtitle ?? 'Live programming'} ·{' '}
              {selectedChannel?.name ?? 'Channel'}
            </Text>
            <View style={styles.guideHeroActions}>
              {selectedChannel?.actions.some(
                action => action === 'live.play' || action === 'play',
              ) ? (
                <ControlButton
                  icon="playback.play"
                  label={selectedIsLive ? 'Watch Live' : 'Watch Channel'}
                  onPress={() => openPlayer(selectedChannel.id, true)}
                  platform={platform}
                  primary
                />
              ) : null}
              {selectedProgram.actions.includes('dvr.record') ? (
                <ControlButton
                  icon="playback.record"
                  label={record.isPending ? 'Scheduling…' : 'Record'}
                  onPress={() => {
                    if (!record.isPending) record.mutate(selectedProgram);
                  }}
                  platform={platform}
                />
              ) : null}
              {selectedProgram.actions.includes('dvr.record-series') ? (
                <ControlButton
                  icon="playback.record"
                  label={
                    recordSeries.isPending ? 'Saving series…' : 'Record Series'
                  }
                  onPress={() => {
                    if (!recordSeries.isPending)
                      recordSeries.mutate(selectedProgram);
                  }}
                  platform={platform}
                />
              ) : null}
            </View>
            {record.error || recordSeries.error ? (
              <Text
                style={
                  television ? styles.recordErrorTv : styles.recordErrorMobile
                }
              >
                {productErrorMessageId(
                  record.error ?? recordSeries.error,
                  'live-tv.action-failed',
                  {actionName: 'schedule this recording'},
                )}
              </Text>
            ) : null}
            {recordNotice ? (
              <Text
                accessibilityRole="text"
                style={
                  television
                    ? styles.recordSuccessTv
                    : styles.recordSuccessMobile
                }
              >
                {recordNotice}
              </Text>
            ) : null}
          </View>
        </View>
      ) : null}

      <SynchronizedGuideTimeline
        channels={channelWindow.items}
        durationHours={queryWindow.hours}
        from={Date.parse(guideFrom)}
        grouped={grouped}
        now={serverNow}
        onSelect={onSelect}
        onWatchChannel={channelId => openPlayer(channelId, true)}
        platform={platform}
        selectedProgramId={selectedProgramId}
      />
      {showGuidePagination ? (
        <View style={styles.guideWindowControls}>
          <ControlButton
            compact
            disabled={!channelWindow.hasPrevious && !hasPreviousPage}
            label="Previous channels"
            onPress={previousChannels}
            platform={platform}
          />
          <Text
            style={television ? styles.guideNoticeTv : styles.guideNoticeMobile}
          >
            Page {pageCursors.length} · channels {channelWindow.start + 1}–
            {channelWindow.start + channelWindow.items.length}
          </Text>
          <ControlButton
            compact
            disabled={!channelWindow.hasNext && !nextPageCursor}
            label="Next channels"
            onPress={nextChannels}
            platform={platform}
          />
        </View>
      ) : null}
    </View>
  );
}

function SynchronizedGuideTimeline({
  channels,
  durationHours,
  from,
  grouped,
  now,
  onSelect,
  onWatchChannel,
  platform,
  selectedProgramId,
}: {
  channels: LiveTVChannel[];
  durationHours: number;
  from: number;
  grouped: Map<string, LiveTVProgram[]>;
  now: number;
  onSelect(id: string): void;
  onWatchChannel(channelId: string): void;
  platform: PrototypePlatform;
  selectedProgramId: string;
}) {
  const television = platform === 'tv';
  const hourWidth = television ? 240 : 150;
  const timelineWidth = durationHours * hourWidth;
  const until = from + durationHours * 60 * 60 * 1000;
  const ticks = Array.from({length: durationHours / 2 + 1}, (_, index) => ({
    at: from + index * 2 * 60 * 60 * 1000,
    left: index * 2 * hourWidth,
  }));
  const nowLeft = ((now - from) / (60 * 60 * 1000)) * hourWidth;
  return (
    <View style={[styles.guide, television && styles.guideTv]}>
      <View
        style={
          television ? styles.identityColumnTv : styles.identityColumnMobile
        }
      >
        <View style={[styles.axisCorner, television && styles.axisCornerTv]}>
          <Text
            style={television ? styles.guideTimeTv : styles.guideTimeMobile}
          >
            Channels
          </Text>
        </View>
        {channels.map(channel => (
          <View
            key={channel.id}
            style={[
              styles.channelIdentity,
              television && styles.channelIdentityTv,
            ]}
          >
            <ChannelLogo channel={channel} platform={platform} size="guide" />
            <View style={styles.channelCopy}>
              <Text
                numberOfLines={2}
                style={
                  television ? styles.channelNameTv : styles.channelNameMobile
                }
              >
                {channel.name}
              </Text>
              <Text
                style={
                  television
                    ? styles.channelNumberTv
                    : styles.channelNumberMobile
                }
              >
                {channel.number}
              </Text>
            </View>
          </View>
        ))}
      </View>
      <ScrollView horizontal showsHorizontalScrollIndicator={false}>
        <View style={{width: timelineWidth}}>
          <View
            style={[styles.timelineAxis, television && styles.timelineAxisTv]}
          >
            {ticks.map(tick => (
              <View key={tick.at} style={[styles.timeTick, {left: tick.left}]}>
                <Text
                  style={
                    television ? styles.guideTimeTv : styles.guideTimeMobile
                  }
                >
                  {new Date(tick.at).toLocaleTimeString([], {
                    hour: 'numeric',
                    minute: '2-digit',
                  })}
                </Text>
              </View>
            ))}
          </View>
          {channels.map(channel => (
            <View
              key={channel.id}
              style={[styles.timelineRow, television && styles.timelineRowTv]}
            >
              {(grouped.get(channel.id) ?? []).length === 0 ? (
                channel.actions.some(
                  action => action === 'live.play' || action === 'play',
                ) ? (
                  <Focusable
                    accessibilityLabel={`${channel.name}. No schedule data. Watch live.`}
                    accessibilityRole="button"
                    onPress={() => onWatchChannel(channel.id)}
                    platform={platform}
                    style={[styles.programEmpty, {width: timelineWidth}]}
                    focusedStyle={styles.programFocused}
                    pressedStyle={styles.programPressed}
                  >
                    <Text
                      style={
                        television
                          ? styles.programMetaTv
                          : styles.programMetaMobile
                      }
                    >
                      No schedule data · Watch live
                    </Text>
                  </Focusable>
                ) : (
                  <View style={[styles.programEmpty, {width: timelineWidth}]}>
                    <Text
                      style={
                        television
                          ? styles.programMetaTv
                          : styles.programMetaMobile
                      }
                    >
                      No schedule data
                    </Text>
                  </View>
                )
              ) : null}
              {(grouped.get(channel.id) ?? []).map(program => {
                const startsAt = Date.parse(program.startAt);
                const endsAt = Date.parse(program.endAt);
                if (endsAt <= from || startsAt >= until) return null;
                const visibleStart = Math.max(from, startsAt);
                const visibleEnd = Math.min(until, endsAt);
                const left =
                  ((visibleStart - from) / (60 * 60 * 1000)) * hourWidth;
                const width = Math.max(
                  television ? 64 : 44,
                  ((visibleEnd - visibleStart) / (60 * 60 * 1000)) * hourWidth -
                    2,
                );
                const selected = program.id === selectedProgramId;
                const live = startsAt <= now && endsAt > now;
                return (
                  <Focusable
                    accessibilityLabel={`${program.title}. ${program.subtitle ?? ''}. ${timeRange(program.startAt, program.endAt)}`}
                    accessibilityRole="button"
                    key={program.id}
                    onFocus={() => onSelect(program.id)}
                    onPress={() => onSelect(program.id)}
                    platform={platform}
                    style={[
                      styles.program,
                      television ? styles.programTv : styles.programMobile,
                      {left, width},
                      live && styles.programNow,
                      selected && styles.programSelected,
                    ]}
                    focusedStyle={styles.programFocused}
                    pressedStyle={styles.programPressed}
                  >
                    <Text
                      numberOfLines={1}
                      style={
                        television
                          ? styles.programTitleTv
                          : styles.programTitleMobile
                      }
                    >
                      {program.title}
                    </Text>
                    <Text
                      numberOfLines={1}
                      style={
                        television
                          ? styles.programMetaTv
                          : styles.programMetaMobile
                      }
                    >
                      {program.subtitle ??
                        (live
                          ? 'Live now'
                          : timeRange(program.startAt, program.endAt))}
                    </Text>
                  </Focusable>
                );
              })}
            </View>
          ))}
          {nowLeft >= 0 && nowLeft <= timelineWidth ? (
            <View
              pointerEvents="none"
              style={[
                styles.nowMarker,
                television && styles.nowMarkerTv,
                {left: nowLeft},
              ]}
            >
              <View style={styles.nowMarkerHead} />
            </View>
          ) : null}
        </View>
      </ScrollView>
    </View>
  );
}

function ChannelSurface({
  client,
  onOpenGuide,
  platform,
  source,
}: {
  client: PorticoClient;
  onOpenGuide(programId: string): void;
  platform: PrototypePlatform;
  source: LiveTVSourceSummary;
}) {
  const television = platform === 'tv';
  const channels = useQuery({
    queryKey: ['live-tv-channels', source.id],
    queryFn: ({signal}) =>
      client.liveTvChannels(source.id, {limit: 250}, {signal}),
  });
  const guide = useQuery({
    queryKey: ['live-tv-guide', source.id],
    queryFn: ({signal}) =>
      client.liveTvGuide(source.id, {hours: 3, limit: 250}, {signal}),
  });
  const grouped = useMemo(
    () => programsByChannel(guide.data?.programs ?? []),
    [guide.data?.programs],
  );
  if (channels.isLoading)
    return (
      <Text
        style={[
          television ? tvType.section : mobileType.section,
          styles.loading,
        ]}
      >
        Loading channels…
      </Text>
    );
  if (channels.error && !channels.data)
    return (
      <EmptyState
        actionLabel={productText('action.retry')}
        message="Channel data could not be loaded."
        onAction={() => {
          void channels.refetch();
          void guide.refetch();
        }}
        platform={platform}
        title="Channels couldn’t load"
      />
    );
  if (!channels.data?.items.length)
    return (
      <EmptyState
        actionLabel="Refresh channels"
        message="This source is enabled but has not provided any visible channels."
        onAction={() => void channels.refetch()}
        platform={platform}
        title="No channels available"
      />
    );
  return (
    <View style={[styles.channelGrid, television && styles.channelGridTv]}>
      {((channels.data?.items ?? []) as LiveTVChannel[]).map(channel => {
        const parsedServerTime = guide.data
          ? Date.parse(guide.data.serverTime)
          : Number.NaN;
        const now = Number.isFinite(parsedServerTime)
          ? currentProgram(grouped.get(channel.id) ?? [], parsedServerTime)
          : undefined;
        return (
          <Focusable
            accessibilityLabel={`${channel.name}. ${now?.title ?? 'No current programme'}`}
            accessibilityRole="button"
            key={channel.id}
            onPress={() => onOpenGuide(now?.id ?? '')}
            platform={platform}
            style={[styles.channelCard, television && styles.channelCardTv]}
            focusedStyle={styles.channelCardFocused}
            pressedStyle={styles.channelCardPressed}
          >
            <ChannelLogo channel={channel} platform={platform} size="card" />
            <View style={styles.channelCardCopy}>
              <Text
                style={
                  television
                    ? styles.channelCardTitleTv
                    : styles.channelCardTitleMobile
                }
              >
                {channel.name}
              </Text>
              <Text
                numberOfLines={1}
                style={
                  television
                    ? styles.channelCardNowTv
                    : styles.channelCardNowMobile
                }
              >
                {now?.title ?? 'No guide data'}
              </Text>
            </View>
          </Focusable>
        );
      })}
    </View>
  );
}

function DvrSurface({
  client,
  platform,
  source,
}: {
  client: PorticoClient;
  platform: PrototypePlatform;
  source: LiveTVSourceSummary;
}) {
  const television = platform === 'tv';
  const {openDvrPlayer} = usePorticoNavigationActions();
  const recordings = useQuery({
    queryKey: ['dvr-recordings', source.id],
    queryFn: ({signal}) =>
      client.dvrRecordings({limit: 200, count: 'exact'}, {signal}),
  });
  const status = useQuery({
    queryKey: ['dvr-status', source.id],
    queryFn: ({signal}) => client.dvrStatus(source.id, {signal}),
  });
  const rules = useQuery({
    queryKey: ['dvr-rules', source.id],
    queryFn: ({signal}) =>
      client.dvrRules({limit: 100, count: 'exact'}, {signal}),
  });
  const queryClient = useQueryClient();
  const [ruleNotice, setRuleNotice] = useState('');
  const ruleMutation = useMutation({
    mutationFn: async ({
      action,
      rule,
    }: {
      action: 'toggle' | 'delete';
      rule: NonNullable<typeof rules.data>['items'][number];
    }) => {
      if (action === 'delete') return client.deleteDvrRule(rule.id);
      return client.updateDvrRule(rule.id, {
        sourceId: rule.sourceId,
        title: rule.title,
        enabled: !rule.enabled,
      });
    },
    onMutate: () => setRuleNotice(''),
    onSuccess: async (_, variables) => {
      setRuleNotice(
        productText(
          variables.action === 'delete'
            ? 'dvr.rule-deleted'
            : 'dvr.rule-updated',
        ),
      );
      await queryClient.invalidateQueries({queryKey: ['dvr-rules']});
    },
  });
  if (recordings.isLoading)
    return <ProductEmptyState id="dvr.loading" platform={platform} />;
  if (!recordings.data)
    return (
      <ProductEmptyState
        id="dvr.unavailable"
        onAction={() => void recordings.refetch()}
        platform={platform}
      />
    );
  const completed = completedRecordings(recordings.data.items);
  return (
    <View style={[styles.dvr, television && styles.dvrTv]}>
      <View style={[styles.dvrSummary, television && styles.dvrSummaryTv]}>
        <PorticoIcon color={color.screenBlue} id="media.video" size={television ? 38 : 24} strokeWidth={1.8} />
        <View style={styles.dvrSummaryCopy}>
          <Text
            style={
              television
                ? styles.dvrSummaryTitleTv
                : styles.dvrSummaryTitleMobile
            }
          >
            DVR
          </Text>
          <Text
            style={
              television ? styles.dvrSummaryMetaTv : styles.dvrSummaryMetaMobile
            }
          >
            {status.isLoading
              ? 'Checking DVR…'
              : status.data
                ? dvrStatus(status.data)
                : 'DVR status is temporarily unavailable'}
          </Text>
        </View>
      </View>
      {status.error ? (
        <Text
          style={
            television ? styles.statusWarningTv : styles.statusWarningMobile
          }
        >
          Recordings remain available, but Portico could not confirm current DVR
          availability.
        </Text>
      ) : null}
      {status.data?.conflicts.length ? (
        <View style={styles.consumerSection}>
          <Text
            style={
              television ? styles.sectionTitleTv : styles.sectionTitleMobile
            }
          >
            Conflicts
          </Text>
          {status.data.conflicts.map(conflict => (
            <View key={conflict.id} style={styles.conflictRow}>
              <PorticoIcon color={color.record} id="status.warning" size={television ? 28 : 20} />
              <View style={styles.dvrSummaryCopy}>
                <Text
                  style={
                    television
                      ? styles.recordingTitleTv
                      : styles.recordingTitleMobile
                  }
                >
                  {conflict.reason}
                </Text>
                <Text
                  style={
                    television
                      ? styles.recordingMetaTv
                      : styles.recordingMetaMobile
                  }
                >
                  {conflict.demand} recordings need {conflict.capacity}{' '}
                  available {conflict.capacity === 1 ? 'slot' : 'slots'}
                </Text>
              </View>
            </View>
          ))}
        </View>
      ) : null}
      {rules.data?.items.length ? (
        <View style={styles.consumerSection}>
          <Text
            style={
              television ? styles.sectionTitleTv : styles.sectionTitleMobile
            }
          >
            Recording rules
          </Text>
          {rules.data.items.map(rule => (
            <View key={rule.id} style={styles.ruleRow}>
              <View style={styles.dvrSummaryCopy}>
                <Text
                  style={
                    television
                      ? styles.recordingTitleTv
                      : styles.recordingTitleMobile
                  }
                >
                  {rule.title}
                </Text>
                <Text
                  style={
                    television
                      ? styles.recordingMetaTv
                      : styles.recordingMetaMobile
                  }
                >
                  {rule.matchType === 'series' ? 'Series' : 'Programme'} ·{' '}
                  {rule.enabled ? 'Enabled' : 'Paused'}
                </Text>
              </View>
              <View style={styles.ruleActions}>
                {rule.actions.some(
                  action => action === 'dvr.enable' || action === 'dvr.disable',
                ) || status.data?.capabilities.canEditOwnRules ? (
                  <ControlButton
                    compact
                    busy={ruleMutation.isPending}
                    label={
                      rule.enabled ? productText('action.pause') : 'Enable'
                    }
                    onPress={() =>
                      ruleMutation.mutate({action: 'toggle', rule})
                    }
                    platform={platform}
                    selected={!rule.enabled}
                  />
                ) : null}
                {rule.actions.includes('dvr.delete') ||
                status.data?.capabilities.canDeleteOwnRules ? (
                  <ControlButton
                    compact
                    busy={ruleMutation.isPending}
                    icon="action.delete"
                    label="Delete"
                    onPress={() =>
                      Alert.alert(
                        'Delete recording rule?',
                        `Portico will stop scheduling ${rule.title}. Existing recordings are kept.`,
                        [
                          {text: productText('action.cancel'), style: 'cancel'},
                          {
                            text: 'Delete',
                            style: 'destructive',
                            onPress: () =>
                              ruleMutation.mutate({action: 'delete', rule}),
                          },
                        ],
                      )
                    }
                    platform={platform}
                  />
                ) : null}
              </View>
            </View>
          ))}
          {ruleMutation.error ? (
            <Text
              accessibilityRole="alert"
              style={
                television ? styles.statusWarningTv : styles.statusWarningMobile
              }
            >
              {productErrorMessageId(
                ruleMutation.error,
                'live-tv.action-failed',
                {actionName: 'update that recording rule'},
              )}
            </Text>
          ) : null}
          {ruleNotice ? (
            <Text
              style={
                television ? styles.recordSuccessTv : styles.recordSuccessMobile
              }
            >
              {ruleNotice}
            </Text>
          ) : null}
        </View>
      ) : null}
      {completed.length ? (
        <View style={styles.recordingList}>
          {completed.map(recording => (
            <RecordingRow
              key={recording.id}
              onPlay={() => openDvrPlayer(recording.id)}
              platform={platform}
              recording={recording}
              sourceName={source.name}
            />
          ))}
        </View>
      ) : (
        <ProductEmptyState id="dvr.empty" platform={platform} />
      )}
    </View>
  );
}

function LibraryChannelsSurface({
  client,
  platform,
}: {
  client: PorticoClient;
  platform: PrototypePlatform;
}) {
  const television = platform === 'tv';
  const {openLibraryChannel} = usePorticoNavigationActions();
  const [dayOffset, setDayOffset] = useState(0);
  const from = useMemo(() => dayStart(dayOffset), [dayOffset]);
  const to = useMemo(
    () => new Date(from.getTime() + 24 * 60 * 60 * 1000),
    [from],
  );
  const guide = useQuery({
    queryKey: ['library-channels-guide', from.toISOString()],
    queryFn: ({signal}) =>
      client.libraryChannelsGuide(
        {from: from.toISOString(), to: to.toISOString(), limit: 250},
        {signal},
      ),
  });
  if (guide.isLoading)
    return (
      <ProductEmptyState id="library-channel.loading" platform={platform} />
    );
  if (guide.error && !guide.data)
    return (
      <ProductEmptyState
        id="library-channel.load-failed"
        onAction={() => void guide.refetch()}
        platform={platform}
      />
    );
  if (!guide.data?.channels.length)
    return <ProductEmptyState id="library-channel.empty" platform={platform} />;
  const grouped = libraryProgramsByChannel(guide.data.programs);
  const serverNow = Date.parse(guide.data.serverTime);
  return (
    <View style={styles.libraryChannels}>
      <ScrollView
        contentContainerStyle={styles.controlStrip}
        horizontal
        showsHorizontalScrollIndicator={false}
      >
        {(television ? [0, 1, 2] : [0, 1, 2, 3, 4, 5, 6]).map(offset => (
          <ControlButton
            compact
            icon="view.calendar"
            key={offset}
            label={dayLabel(offset)}
            onPress={() => setDayOffset(offset)}
            platform={platform}
            selected={dayOffset === offset}
          />
        ))}
      </ScrollView>
      <Text
        style={television ? styles.sectionTitleTv : styles.sectionTitleMobile}
      >
        {libraryChannelsTab} guide
      </Text>
      {guide.data.channels.map(channel => (
        <LibraryChannelRow
          channel={channel}
          key={channel.id}
          now={serverNow}
          onWatch={() => openLibraryChannel(channel.id)}
          platform={platform}
          programs={grouped.get(channel.id) ?? []}
        />
      ))}
    </View>
  );
}

function LibraryChannelRow({
  channel,
  now,
  onWatch,
  platform,
  programs,
}: {
  channel: LibraryChannelSummary;
  now: number;
  onWatch(): void;
  platform: PrototypePlatform;
  programs: LibraryChannelGuideEntry[];
}) {
  const television = platform === 'tv';
  const current = programs.find(
    program =>
      Date.parse(program.startsAt) <= now && Date.parse(program.endsAt) > now,
  );
  return (
    <View
      style={[
        styles.libraryChannelRow,
        television && styles.libraryChannelRowTv,
      ]}
    >
      <View style={styles.libraryChannelHeading}>
        <View
          style={[
            styles.libraryChannelMark,
            {backgroundColor: channelColor(channel.id)},
          ]}
        >
          {channel.logoUrl ? (
            <Image
              resizeMode="contain"
              source={serverImageSource(channel.logoUrl)}
              style={styles.libraryChannelLogoImage}
            />
          ) : (
            <Text
              style={
                television
                  ? styles.channelLogoTextTv
                  : styles.channelLogoTextMobile
              }
            >
              {channel.name.slice(0, 2).toUpperCase()}
            </Text>
          )}
        </View>
        <View style={styles.dvrSummaryCopy}>
          <Text
            style={
              television
                ? styles.channelCardTitleTv
                : styles.channelCardTitleMobile
            }
          >
            {channel.name}
          </Text>
          <Text
            numberOfLines={1}
            style={
              television ? styles.channelCardNowTv : styles.channelCardNowMobile
            }
          >
            {current?.title ?? channel.description}
          </Text>
        </View>
        {channel.actions.includes('play') ? (
          <ControlButton
            compact
            icon="playback.play"
            label="Watch"
            onPress={onWatch}
            platform={platform}
            primary
          />
        ) : null}
      </View>
      <ScrollView
        contentContainerStyle={styles.programs}
        horizontal
        showsHorizontalScrollIndicator={false}
      >
        {programs.map(program => (
          <View
            key={program.id}
            style={[
              styles.libraryProgram,
              television && styles.programTv,
              Date.parse(program.startsAt) <= now &&
                Date.parse(program.endsAt) > now &&
                styles.programNow,
            ]}
          >
            <Text
              numberOfLines={1}
              style={
                television ? styles.programTitleTv : styles.programTitleMobile
              }
            >
              {program.title ??
                (program.kind === 'slate'
                  ? 'Channel break'
                  : productText('media.unavailable'))}
            </Text>
            <Text
              style={
                television ? styles.programMetaTv : styles.programMetaMobile
              }
            >
              {timeRange(program.startsAt, program.endsAt)}
            </Text>
          </View>
        ))}
      </ScrollView>
    </View>
  );
}

function libraryProgramsByChannel(
  programs: LibraryChannelGuideEntry[],
): Map<string, LibraryChannelGuideEntry[]> {
  const grouped = new Map<string, LibraryChannelGuideEntry[]>();
  for (const program of programs)
    grouped.set(program.channelId, [
      ...(grouped.get(program.channelId) ?? []),
      program,
    ]);
  return grouped;
}

function dayStart(offset: number, anchor = Date.now()): Date {
  const value = new Date(anchor);
  value.setHours(0, 0, 0, 0);
  value.setDate(value.getDate() + offset);
  return value;
}

function dayLabel(offset: number): string {
  if (offset === 0) return 'Today';
  if (offset === 1) return 'Tomorrow';
  return dayStart(offset).toLocaleDateString(undefined, {weekday: 'short'});
}

function humanizeChannelFilter(value: string): string {
  return value.charAt(0).toUpperCase() + value.slice(1);
}

function timeRange(startsAt: string, endsAt: string): string {
  const format = (value: string) =>
    new Date(value).toLocaleTimeString([], {
      hour: 'numeric',
      minute: '2-digit',
    });
  return `${format(startsAt)} – ${format(endsAt)}`;
}

function RecordingRow({
  onPlay,
  platform,
  recording,
  sourceName,
}: {
  onPlay(): void;
  platform: PrototypePlatform;
  recording: DVRRecording;
  sourceName: string;
}) {
  const television = platform === 'tv';
  const [open, setOpen] = useState(false);
  const playable = recording.actions.includes('dvr.play');
  const durationMinutes = Math.max(
    1,
    Math.round(
      (Date.parse(recording.endsAt) - Date.parse(recording.startsAt)) / 60_000,
    ),
  );
  return (
    <View style={styles.recordingContainer}>
      <Focusable
        accessibilityLabel={`${recording.title}. Recorded ${new Date(recording.startsAt).toLocaleDateString()}. ${open ? 'Hide' : 'Show'} recording details.`}
        accessibilityRole="button"
        onPress={() => setOpen(value => !value)}
        platform={platform}
        style={[styles.recordingRow, television && styles.recordingRowTv]}
        focusedStyle={styles.recordingRowFocused}
        pressedStyle={styles.recordingRowPressed}
      >
        <View style={styles.recordingCopy}>
          <Text
            style={
              television ? styles.recordingTitleTv : styles.recordingTitleMobile
            }
          >
            {recording.title}
          </Text>
          <Text
            style={
              television ? styles.recordingMetaTv : styles.recordingMetaMobile
            }
          >
            {new Date(recording.startsAt).toLocaleDateString()} ·{' '}
            {formatBytes(recording.sizeBytes)}
          </Text>
        </View>
        <Text
          style={
            television ? styles.recordingStatusTv : styles.recordingStatusMobile
          }
        >
          Details
        </Text>
        <PorticoIcon color={color.softSilver} id={open ? 'navigation.collapse' : 'navigation.expand'} size={television ? 28 : 20} />
      </Focusable>
      {open ? (
        <View
          style={[
            styles.recordingDetails,
            television && styles.recordingDetailsTv,
          ]}
        >
          <RecordingFact
            label={productText('library.column-duration')}
            platform={platform}
            value={`${durationMinutes} min`}
          />
          <RecordingFact
            label="Source"
            platform={platform}
            value={sourceName}
          />
          {playable ? (
            <View style={styles.recordingPlay}>
              <ControlButton
                compact
                icon="playback.play"
                label={productText('action.play-recording')}
                onPress={onPlay}
                platform={platform}
                primary
              />
            </View>
          ) : (
            <RecordingFact
              label={productText('settings.section.playback')}
              platform={platform}
              value={productText('media.unavailable')}
            />
          )}
        </View>
      ) : null}
    </View>
  );
}

function RecordingFact({
  label,
  platform,
  value,
}: {
  label: string;
  platform: PrototypePlatform;
  value: string;
}) {
  const television = platform === 'tv';
  return (
    <View style={styles.recordingFact}>
      <Text
        style={
          television
            ? styles.recordingFactLabelTv
            : styles.recordingFactLabelMobile
        }
      >
        {label}
      </Text>
      <Text
        numberOfLines={1}
        style={
          television
            ? styles.recordingFactValueTv
            : styles.recordingFactValueMobile
        }
      >
        {value}
      </Text>
    </View>
  );
}

function ChannelLogo({
  channel,
  platform,
  size,
}: {
  channel: LiveTVChannel;
  platform: PrototypePlatform;
  size: 'guide' | 'card';
}) {
  const television = platform === 'tv';
  const [imageFailed, setImageFailed] = useState(false);
  const logoStyle =
    size === 'guide'
      ? [styles.channelLogo, television && styles.channelLogoTv]
      : [styles.channelCardLogo, television && styles.channelCardLogoTv];
  const candidate = serverImageSource(channel.logoUrl);
  const sourceUri = candidate?.uri;
  useEffect(
    () =>
      setImageFailed(
        Boolean(sourceUri && failedChannelLogoUris.has(sourceUri)),
      ),
    [sourceUri],
  );
  const imageSource =
    imageFailed || (sourceUri ? failedChannelLogoUris.has(sourceUri) : false)
      ? undefined
      : candidate;
  return (
    <View style={[logoStyle, {backgroundColor: channelColor(channel.id)}]}>
      {imageSource ? (
        <Image
          accessibilityIgnoresInvertColors
          onError={() => {
            rememberChannelLogoFailure(sourceUri);
            setImageFailed(true);
          }}
          resizeMode="contain"
          source={imageSource}
          style={styles.channelLogoImage}
        />
      ) : (
        <Text
          style={
            size === 'guide'
              ? television
                ? styles.channelLogoTextTv
                : styles.channelLogoTextMobile
              : television
                ? styles.channelCardLogoTextTv
                : styles.channelCardLogoTextMobile
          }
        >
          {channelMark(channel)}
        </Text>
      )}
    </View>
  );
}

function dvrStatus(status: DVRConsumerStatus): string {
  if (status.conflicts.length > 0)
    return `${status.conflicts.length} scheduling ${status.conflicts.length === 1 ? 'conflict' : 'conflicts'}`;
  const state =
    status.capabilities.canScheduleRecordings ||
    status.capabilities.actions.includes('dvr.rule.create')
      ? 'DVR ready'
      : 'Recordings available';
  const storage = status.storage;
  if (!storage || (storage.usedBytes <= 0 && storage.availableBytes <= 0))
    return state;
  return `${state} · ${formatBytes(storage.usedBytes)} used · ${formatBytes(storage.availableBytes)} available`;
}

const styles = StyleSheet.create({
  page: {
    backgroundColor: color.projector,
    minHeight: '100%',
    paddingHorizontal: 16,
    paddingTop: 8,
  },
  pageTv: {paddingLeft: 0, paddingRight: 72, paddingTop: 10},
  loading: {color: color.silver, padding: 24},
  sourceRow: {gap: 8, paddingBottom: 12},
  guideControls: {gap: 6, paddingTop: 10},
  guideControlsTv: {gap: 12, paddingTop: 20},
  controlStrip: {gap: 6, paddingRight: 12},
  guideSearch: {
    alignItems: 'center',
    backgroundColor: color.recess,
    borderColor: color.line,
    borderRadius: 7,
    borderWidth: 1,
    flexDirection: 'row',
    gap: 8,
    minHeight: 42,
    paddingHorizontal: 11,
  },
  guideSearchInput: {
    color: color.silver,
    flex: 1,
    fontFamily: font.regular,
    fontSize: 14,
    paddingVertical: 0,
  },
  guideNoticeMobile: {
    color: color.dimSilver,
    fontFamily: font.regular,
    fontSize: 12,
    lineHeight: 17,
    marginTop: 10,
  },
  guideNoticeTv: {
    color: color.dimSilver,
    fontFamily: font.regular,
    fontSize: 17,
    lineHeight: 23,
    marginTop: 14,
  },
  paginationRetry: {alignSelf: 'flex-start', marginTop: 10},
  guideWindowControls: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: 10,
    justifyContent: 'center',
    marginTop: 12,
  },
  guideHero: {height: 240, marginTop: 16, overflow: 'hidden'},
  guideHeroTv: {height: 330, marginTop: 22},
  guideHeroCopy: {marginTop: 'auto', maxWidth: 630, padding: 20},
  guideHeroCopyTv: {maxWidth: 820, padding: 32},
  liveLabel: {alignItems: 'center', flexDirection: 'row', gap: 7},
  liveLabelTextMobile: {
    color: color.softSilver,
    fontFamily: font.demi,
    fontSize: 11,
    letterSpacing: 0.7,
  },
  liveLabelTextTv: {
    color: color.softSilver,
    fontFamily: font.demi,
    fontSize: 16,
    letterSpacing: 1,
  },
  guideHeroTitle: {color: color.silver, marginTop: 5},
  guideHeroMetaMobile: {
    color: color.softSilver,
    fontFamily: font.medium,
    fontSize: 13,
    lineHeight: 18,
    marginTop: 2,
  },
  guideHeroMetaTv: {
    color: color.softSilver,
    fontFamily: font.medium,
    fontSize: 20,
    lineHeight: 27,
    marginTop: 4,
  },
  guideHeroActions: {flexDirection: 'row', gap: 8, marginTop: 14},
  recordErrorMobile: {
    color: color.record,
    fontFamily: font.medium,
    fontSize: 12,
    marginTop: 8,
  },
  recordErrorTv: {
    color: color.record,
    fontFamily: font.medium,
    fontSize: 18,
    marginTop: 10,
  },
  recordSuccessMobile: {
    color: color.healthy,
    fontFamily: font.medium,
    fontSize: 12,
    marginTop: 8,
  },
  recordSuccessTv: {
    color: color.healthy,
    fontFamily: font.medium,
    fontSize: 18,
    marginTop: 10,
  },
  guideTimeMobile: {
    color: color.dimSilver,
    fontFamily: font.medium,
    fontSize: 12,
  },
  guideTimeTv: {color: color.dimSilver, fontFamily: font.medium, fontSize: 18},
  guide: {flexDirection: 'row', marginBottom: 100, marginTop: 16},
  guideTv: {marginBottom: 80, marginTop: 22},
  identityColumnMobile: {width: 112},
  identityColumnTv: {width: 222},
  axisCorner: {
    alignItems: 'center',
    backgroundColor: color.recess,
    borderBottomColor: color.line,
    borderBottomWidth: 1,
    flexDirection: 'row',
    height: 44,
    paddingHorizontal: 8,
  },
  axisCornerTv: {height: 62, paddingHorizontal: 12},
  timelineAxis: {
    borderBottomColor: color.line,
    borderBottomWidth: 1,
    height: 44,
    position: 'relative',
  },
  timelineAxisTv: {height: 62},
  timeTick: {bottom: 9, position: 'absolute', width: 110},
  timelineRow: {
    borderBottomColor: color.lineSoft,
    borderBottomWidth: 1,
    height: 76,
    position: 'relative',
  },
  timelineRowTv: {height: 112},
  nowMarker: {
    backgroundColor: color.tunerAmber,
    bottom: 0,
    position: 'absolute',
    top: 0,
    width: 2,
    zIndex: 4,
  },
  nowMarkerTv: {width: 3},
  nowMarkerHead: {
    backgroundColor: color.tunerAmber,
    borderRadius: 5,
    height: 10,
    left: -4,
    position: 'absolute',
    top: 0,
    width: 10,
  },
  guideRow: {
    alignItems: 'stretch',
    borderBottomColor: color.lineSoft,
    borderBottomWidth: 1,
    flexDirection: 'row',
    minHeight: 76,
  },
  guideRowTv: {minHeight: 112},
  channelIdentity: {
    alignItems: 'center',
    backgroundColor: color.recess,
    borderBottomColor: color.lineSoft,
    borderBottomWidth: 1,
    flexDirection: 'row',
    gap: 8,
    height: 76,
    paddingHorizontal: 6,
    width: 112,
  },
  channelIdentityTv: {gap: 12, height: 112, paddingHorizontal: 10, width: 222},
  channelLogo: {
    alignItems: 'center',
    height: 42,
    justifyContent: 'center',
    width: 42,
  },
  channelLogoTv: {height: 62, width: 62},
  channelLogoImage: {height: '82%', width: '82%'},
  channelLogoTextMobile: {
    color: color.silver,
    fontFamily: font.bold,
    fontSize: 12,
  },
  channelLogoTextTv: {color: color.silver, fontFamily: font.bold, fontSize: 17},
  channelCopy: {flex: 1},
  channelNameMobile: {
    color: color.silver,
    fontFamily: font.demi,
    fontSize: 11,
    lineHeight: 14,
  },
  channelNameTv: {
    color: color.silver,
    fontFamily: font.demi,
    fontSize: 17,
    lineHeight: 22,
  },
  channelNumberMobile: {
    color: color.dimSilver,
    fontFamily: font.medium,
    fontSize: 10,
    marginTop: 2,
  },
  channelNumberTv: {
    color: color.dimSilver,
    fontFamily: font.medium,
    fontSize: 15,
    marginTop: 3,
  },
  programs: {alignItems: 'stretch'},
  program: {
    borderColor: color.transparent,
    borderWidth: 3,
    bottom: 0,
    justifyContent: 'center',
    position: 'absolute',
    top: 0,
  },
  programMobile: {paddingHorizontal: 12},
  programTv: {paddingHorizontal: 18},
  programNow: {backgroundColor: color.slate},
  programSelected: {backgroundColor: color.raisedSlate},
  programFocused: {borderColor: color.focus},
  programPressed: {backgroundColor: color.brightSlate},
  programEmpty: {
    alignItems: 'flex-start',
    height: '100%',
    justifyContent: 'center',
    left: 0,
    paddingHorizontal: 16,
    position: 'absolute',
    top: 0,
  },
  programTitleMobile: {
    color: color.silver,
    fontFamily: font.demi,
    fontSize: 13,
    lineHeight: 17,
  },
  programTitleTv: {
    color: color.silver,
    fontFamily: font.demi,
    fontSize: 20,
    lineHeight: 26,
  },
  programMetaMobile: {
    color: color.dimSilver,
    fontFamily: font.regular,
    fontSize: 11,
    lineHeight: 15,
    marginTop: 2,
  },
  programMetaTv: {
    color: color.dimSilver,
    fontFamily: font.regular,
    fontSize: 17,
    lineHeight: 23,
    marginTop: 3,
  },
  channelGrid: {gap: 8, marginTop: 18, paddingBottom: 100},
  channelGridTv: {
    columnGap: 14,
    flexDirection: 'row',
    flexWrap: 'wrap',
    marginTop: 26,
    rowGap: 14,
  },
  channelCard: {
    alignItems: 'center',
    backgroundColor: color.recess,
    borderColor: color.lineSoft,
    borderRadius: 8,
    borderWidth: 3,
    flexDirection: 'row',
    gap: 12,
    minHeight: 82,
    padding: 10,
  },
  channelCardTv: {gap: 18, minHeight: 118, padding: 14, width: '48.8%'},
  channelCardFocused: {
    backgroundColor: color.raisedSlate,
    borderColor: color.focus,
  },
  channelCardPressed: {backgroundColor: color.brightSlate},
  channelCardLogo: {
    alignItems: 'center',
    height: 56,
    justifyContent: 'center',
    width: 56,
  },
  channelCardLogoTv: {height: 82, width: 82},
  channelCardLogoTextMobile: {
    color: color.silver,
    fontFamily: font.bold,
    fontSize: 15,
  },
  channelCardLogoTextTv: {
    color: color.silver,
    fontFamily: font.bold,
    fontSize: 22,
  },
  channelCardCopy: {flex: 1},
  channelCardTitleMobile: {
    color: color.silver,
    fontFamily: font.demi,
    fontSize: 16,
    lineHeight: 21,
  },
  channelCardTitleTv: {
    color: color.silver,
    fontFamily: font.demi,
    fontSize: 24,
    lineHeight: 30,
  },
  channelCardNowMobile: {
    color: color.dimSilver,
    fontFamily: font.regular,
    fontSize: 12,
    lineHeight: 17,
    marginTop: 3,
  },
  channelCardNowTv: {
    color: color.dimSilver,
    fontFamily: font.regular,
    fontSize: 18,
    lineHeight: 24,
    marginTop: 4,
  },
  dvr: {marginTop: 18},
  dvrTv: {marginTop: 26},
  dvrSummary: {
    alignItems: 'center',
    backgroundColor: color.recess,
    borderColor: color.lineSoft,
    borderWidth: 1,
    flexDirection: 'row',
    gap: 12,
    marginBottom: 20,
    padding: 16,
  },
  dvrSummaryTv: {gap: 18, marginBottom: 28, padding: 22},
  dvrSummaryCopy: {flex: 1},
  consumerSection: {gap: 8, marginBottom: 22},
  sectionTitleMobile: {
    color: color.silver,
    fontFamily: font.demi,
    fontSize: 19,
    marginBottom: 4,
  },
  sectionTitleTv: {
    color: color.silver,
    fontFamily: font.demi,
    fontSize: 28,
    marginBottom: 7,
  },
  conflictRow: {
    alignItems: 'center',
    backgroundColor: color.recess,
    flexDirection: 'row',
    gap: 12,
    padding: 14,
  },
  ruleRow: {
    alignItems: 'center',
    backgroundColor: color.recess,
    flexDirection: 'row',
    gap: 12,
    minHeight: 72,
    padding: 12,
  },
  ruleActions: {flexDirection: 'row', gap: 7},
  libraryChannels: {gap: 14, paddingBottom: 100, paddingTop: 18},
  libraryChannelRow: {backgroundColor: color.recess, gap: 8, padding: 10},
  libraryChannelRowTv: {gap: 12, padding: 16},
  libraryChannelHeading: {alignItems: 'center', flexDirection: 'row', gap: 12},
  libraryChannelMark: {
    alignItems: 'center',
    height: 48,
    justifyContent: 'center',
    width: 48,
  },
  libraryChannelLogoImage: {height: '86%', width: '86%'},
  libraryProgram: {
    borderColor: color.transparent,
    borderWidth: 3,
    justifyContent: 'center',
    minHeight: 68,
    minWidth: 185,
    paddingHorizontal: 12,
  },
  dvrSummaryTitleMobile: {
    color: color.silver,
    fontFamily: font.demi,
    fontSize: 16,
  },
  dvrSummaryTitleTv: {color: color.silver, fontFamily: font.demi, fontSize: 24},
  dvrSummaryMetaMobile: {
    color: color.dimSilver,
    fontFamily: font.regular,
    fontSize: 12,
    marginTop: 3,
  },
  dvrSummaryMetaTv: {
    color: color.dimSilver,
    fontFamily: font.regular,
    fontSize: 18,
    marginTop: 4,
  },
  recordingList: {gap: 8},
  recordingContainer: {backgroundColor: color.recess},
  recordingRow: {
    alignItems: 'center',
    backgroundColor: color.recess,
    borderColor: color.transparent,
    borderWidth: 3,
    flexDirection: 'row',
    gap: 8,
    minHeight: 76,
    padding: 11,
  },
  recordingRowTv: {minHeight: 108, padding: 20},
  recordingRowFocused: {
    backgroundColor: color.raisedSlate,
    borderColor: color.focus,
  },
  recordingRowPressed: {backgroundColor: color.brightSlate},
  recordingCopy: {flex: 1},
  recordingTitleMobile: {
    color: color.silver,
    fontFamily: font.demi,
    fontSize: 16,
  },
  recordingTitleTv: {color: color.silver, fontFamily: font.demi, fontSize: 24},
  recordingMetaMobile: {
    color: color.dimSilver,
    fontFamily: font.regular,
    fontSize: 12,
    marginTop: 3,
  },
  recordingMetaTv: {
    color: color.dimSilver,
    fontFamily: font.regular,
    fontSize: 18,
    marginTop: 4,
  },
  recordingStatusMobile: {
    color: color.screenBlue,
    fontFamily: font.medium,
    fontSize: 12,
  },
  recordingStatusTv: {
    color: color.screenBlue,
    fontFamily: font.medium,
    fontSize: 18,
  },
  recordingDetails: {
    borderTopColor: color.lineSoft,
    borderTopWidth: 1,
    gap: 8,
    padding: 14,
  },
  recordingDetailsTv: {flexDirection: 'row', gap: 30, padding: 20},
  recordingPlay: {alignSelf: 'flex-start', justifyContent: 'center'},
  recordingFact: {flex: 1},
  recordingFactLabelMobile: {
    color: color.dimSilver,
    fontFamily: font.medium,
    fontSize: 11,
  },
  recordingFactLabelTv: {
    color: color.dimSilver,
    fontFamily: font.medium,
    fontSize: 16,
  },
  recordingFactValueMobile: {
    color: color.softSilver,
    fontFamily: font.medium,
    fontSize: 13,
    marginTop: 2,
  },
  recordingFactValueTv: {
    color: color.softSilver,
    fontFamily: font.medium,
    fontSize: 19,
    marginTop: 3,
  },
  statusWarningMobile: {
    color: color.tunerAmber,
    fontFamily: font.medium,
    fontSize: 12,
    lineHeight: 17,
    marginBottom: 14,
  },
  statusWarningTv: {
    color: color.tunerAmber,
    fontFamily: font.medium,
    fontSize: 18,
    lineHeight: 25,
    marginBottom: 20,
  },
  floatingNotice: {marginBottom: 90, marginTop: 16},
});
