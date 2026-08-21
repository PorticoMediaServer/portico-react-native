import React, {useEffect, useState} from 'react';
import {
  Alert,
  ActivityIndicator,
  FlatList,
  ScrollView,
  StyleSheet,
  Text,
  View,
  type NativeScrollEvent,
  type NativeSyntheticEvent,
  type StyleProp,
  type ViewStyle,
} from 'react-native';
import {PorticoIcon} from '@portico-react-native/icons';
import type {MediaCard, PorticoClient} from '@porticomediaserver/client-core';
import {useInfiniteQuery} from '@tanstack/react-query';
import {
  downloadsSupported,
  porticoDownloads,
  productErrorMessageId,
  ProductMessageError,
  usePorticoAuth,
  useViewerRuntime,
  type PorticoDownload,
} from '@portico-react-native/infrastructure';
import type {PrototypePlatform} from '../../ui-compat/contract';
import {
  mergeUniqueById,
  normalizeSavedTab,
  savedMediaCardViewModels,
  savedMediaViewModels,
  savedResourceViewModels,
  savedTabs,
  type SavedResourceViewModel,
  type SavedTab,
  type MediaViewModel,
} from '../../data';
import {
  availableDownloadOptions,
  enqueueMediaDownload,
} from '../../data/downloads';
import {color, font} from '../tokens';
import {formatBytes, useDeviceDownloads} from '../downloads';
import {
  ControlButton,
  EmptyState,
  Focusable,
  IconButton,
  InlineNotice,
  PosterSkeletonGrid,
  UnderlineTabs,
} from '../primitives';
import {HeaderUtilities, MediaGrid} from '../sharedComponents';
import {usePrototypeUi} from '../uiState';
import {usePorticoNavigationActions} from '../navigation';
import {
  MobileChromePivot,
  MobileChromeScaffold,
  mobileChromeScope,
  useMobileChromeScroll,
} from '../shells';
import {
  productBody,
  productErrorBody,
  productText,
  productTitle,
} from '../productCopy';

export function SavedScreen({platform}: {platform: PrototypePlatform}) {
  const television = platform === 'tv';
  const {openMediaDetail, openSearch, replacePrimarySubTab, route} =
    usePorticoNavigationActions();
  const auth = usePorticoAuth();
  const client = auth.session!.client;
  const {savedTab, setSavedTab} = usePrototypeUi();
  const activeTab = normalizeSavedTab(savedTab);
  const [selectedResource, setSelectedResource] =
    useState<SavedResourceViewModel>();
  useEffect(() => {
    if (route.name !== 'saved') return;
    const target = route.tab ? normalizeSavedTab(route.tab) : activeTab;
    if (activeTab !== target) setSavedTab(target);
    if (route.tab !== target) replacePrimarySubTab('saved', target);
  }, [activeTab, replacePrimarySubTab, route, setSavedTab]);
  const changeSavedTab = React.useCallback(
    (value: string) => {
      setSelectedResource(undefined);
      setSavedTab(value);
      replacePrimarySubTab('saved', value);
    },
    [replacePrimarySubTab, setSavedTab],
  );
  const {onScroll, scrollY} = useMobileChromeScroll(
    mobileChromeScope(
      'saved',
      auth.session?.serverId,
      auth.session?.viewerScope.profileId,
      {
        tab: activeTab,
        resource: selectedResource?.id,
        view: selectedResource ? 'resource-items' : 'root',
      },
    ),
  );
  const query = useInfiniteQuery({
    queryKey: [activeTab === 'Favorites' ? 'favorites' : 'watchlist'],
    enabled: activeTab === 'Watchlist' || activeTab === 'Favorites',
    initialPageParam: undefined as string | undefined,
    queryFn: ({pageParam, signal}) =>
      activeTab === 'Favorites'
        ? client.favorites({cursor: pageParam, limit: 50}, {signal})
        : client.watchlist({cursor: pageParam, limit: 50}, {signal}),
    getNextPageParam: (lastPage, pages) =>
      lastPage.pageInfo.hasMore &&
      !pages
        .slice(0, -1)
        .some(page => page.pageInfo.nextCursor === lastPage.pageInfo.nextCursor)
        ? (lastPage.pageInfo.nextCursor ?? undefined)
        : undefined,
  });
  const rawItems = mergeUniqueById(
    ...(query.data?.pages.map(page => page.items) ?? []),
  );
  const items = rawItems.length
    ? savedMediaViewModels(
        {items: rawItems, pageInfo: {hasMore: false, nextCursor: null}},
        client,
      )
    : [];
  const mediaPagination = query.hasNextPage ? (
    <SavedPagination
      error={query.isFetchNextPageError}
      loading={query.isFetchingNextPage}
      onLoad={() => void query.fetchNextPage()}
      platform={platform}
    />
  ) : null;

  const savedBody = (virtualized: boolean) => (
    <View style={[styles.savedContent, television && styles.savedContentTv]}>
      {activeTab !== 'Watchlist' && activeTab !== 'Favorites' ? (
        <SavedResources
          client={client}
          onOpen={setSelectedResource}
          onOpenMedia={openMediaDetail}
          onReturn={() => setSelectedResource(undefined)}
          platform={platform}
          selected={selectedResource}
          tab={activeTab}
        />
      ) : query.isLoading ? (
        <PosterSkeletonGrid platform={platform} />
      ) : query.error && !query.data ? (
        <EmptyState
          actionLabel={productText('action.retry')}
          message={productErrorMessageId(query.error, 'media.load-failed', {
            featureName: activeTab,
          })}
          onAction={() => void query.refetch()}
          platform={platform}
          title={`${activeTab} couldn’t load`}
        />
      ) : items.length ? (
        virtualized ? (
          <MediaGrid
            items={items}
            listFooter={mediaPagination}
            listHeader={<View style={styles.virtualizedListHeader} />}
            onScroll={onScroll}
            onOpen={item => openMediaDetail(item)}
            platform={platform}
            testID="portico-four-saved-mobile-grid"
          />
        ) : (
          <View>
            <MediaGrid
              items={items}
              onOpen={item => openMediaDetail(item)}
              platform={platform}
            />
            {mediaPagination}
          </View>
        )
      ) : (
        <EmptyState
          message={`Media added to ${activeTab.toLowerCase()} appears here across your Portico clients.`}
          platform={platform}
          title={`No ${activeTab.toLowerCase()} yet`}
        />
      )}
    </View>
  );
  const content = (
    <>
      <HeaderUtilities
        flush
        platform={platform}
        title={productText('navigation.saved')}
      />
      <ScrollView horizontal showsHorizontalScrollIndicator={false}>
        <UnderlineTabs
          active={activeTab}
          onChange={changeSavedTab}
          platform={platform}
          tabs={[...savedTabs]}
        />
      </ScrollView>
      {savedBody(false)}
    </>
  );
  const isSavedMediaTab =
    activeTab === 'Watchlist' || activeTab === 'Favorites';
  const mobileBody = isSavedMediaTab ? (
    query.isLoading ? (
      <SavedMobileStateList
        content={<PosterSkeletonGrid platform="mobile" />}
        onScroll={onScroll}
        testID="portico-four-saved-media-mobile"
      />
    ) : query.error && !query.data ? (
      <SavedMobileStateList
        content={
          <EmptyState
            actionLabel={productText('action.retry')}
            message={productErrorMessageId(query.error, 'media.load-failed', {
              featureName: activeTab,
            })}
            onAction={() => void query.refetch()}
            platform="mobile"
            title={`${activeTab} couldn’t load`}
          />
        }
        onScroll={onScroll}
        testID="portico-four-saved-media-mobile"
      />
    ) : items.length ? (
      <MediaGrid
        contentContainerStyle={styles.page}
        items={items}
        listFooter={mediaPagination}
        listHeader={<View style={styles.virtualizedListHeader} />}
        onScroll={onScroll}
        onOpen={item => openMediaDetail(item)}
        platform="mobile"
        testID="portico-four-saved-mobile-grid"
      />
    ) : (
      <SavedMobileStateList
        content={
          <EmptyState
            message={`Media added to ${activeTab.toLowerCase()} appears here across your Portico clients.`}
            platform="mobile"
            title={`No ${activeTab.toLowerCase()} yet`}
          />
        }
        onScroll={onScroll}
        testID="portico-four-saved-media-mobile"
      />
    )
  ) : (
    <SavedResources
      client={client}
      onOpen={setSelectedResource}
      onOpenMedia={openMediaDetail}
      onReturn={() => setSelectedResource(undefined)}
      onScroll={onScroll}
      platform="mobile"
      selected={selectedResource}
      tab={activeTab as Exclude<SavedTab, 'Watchlist' | 'Favorites'>}
    />
  );
  const mobile = (
    <MobileChromeScaffold
      header={
        <HeaderUtilities
          flush
          onSearch={openSearch}
          platform="mobile"
          title={productText('navigation.saved')}
        />
      }
      pivot={
        <MobileChromePivot
          active={activeTab}
          onChange={changeSavedTab}
          tabs={[...savedTabs]}
        />
      }
      scrollY={scrollY}
      testID="portico-mobile-saved-chrome"
    >
      {mobileBody}
    </MobileChromeScaffold>
  );
  return television ? (
    <ScrollView
      contentContainerStyle={[styles.page, styles.pageTv]}
      onScroll={onScroll}
      scrollEventThrottle={16}
      showsVerticalScrollIndicator={false}
      testID="portico-four-saved-tv"
    >
      {content}
    </ScrollView>
  ) : (
    mobile
  );
}

function SavedMobileStateList({
  content,
  contentContainerStyle,
  contentOffset,
  onScroll,
  testID,
}: {
  content: React.ReactNode;
  contentContainerStyle?: StyleProp<ViewStyle>;
  contentOffset?: {x: number; y: number};
  onScroll?(event: NativeSyntheticEvent<NativeScrollEvent>): void;
  testID: string;
}) {
  return (
    <FlatList
      contentContainerStyle={[styles.page, contentContainerStyle]}
      contentOffset={contentOffset}
      data={[]}
      ListHeaderComponent={<View>{content}</View>}
      onScroll={onScroll}
      renderItem={() => null}
      scrollEventThrottle={16}
      showsVerticalScrollIndicator={false}
      testID={testID}
    />
  );
}

function SavedResources({
  client,
  contentContainerStyle,
  contentOffset,
  onOpen,
  onOpenMedia,
  onReturn,
  onScroll,
  platform,
  selected,
  tab,
}: {
  client: PorticoClient;
  contentContainerStyle?: StyleProp<ViewStyle>;
  contentOffset?: {x: number; y: number};
  onOpen(resource: SavedResourceViewModel): void;
  onOpenMedia(item: MediaViewModel): void;
  onReturn(): void;
  onScroll?(event: NativeSyntheticEvent<NativeScrollEvent>): void;
  platform: PrototypePlatform;
  selected?: SavedResourceViewModel;
  tab: Exclude<SavedTab, 'Watchlist' | 'Favorites'>;
}) {
  const television = platform === 'tv';
  const resourcesQuery = useInfiniteQuery({
    queryKey: ['saved-resources', tab],
    initialPageParam: undefined as string | undefined,
    queryFn: ({pageParam, signal}) =>
      loadSavedResources(client, tab, pageParam, signal),
    getNextPageParam: (lastPage, pages) =>
      !pages.slice(0, -1).some(page => page.nextCursor === lastPage.nextCursor)
        ? lastPage.nextCursor
        : undefined,
  });
  const itemsQuery = useInfiniteQuery({
    queryKey: ['saved-resource-items', tab, selected?.id],
    enabled: Boolean(selected),
    initialPageParam: undefined as string | undefined,
    queryFn: ({pageParam, signal}) =>
      loadSavedResourceItems(client, tab, selected!.id, pageParam, signal),
    getNextPageParam: (lastPage, pages) =>
      !pages.slice(0, -1).some(page => page.nextCursor === lastPage.nextCursor)
        ? lastPage.nextCursor
        : undefined,
  });
  const resources = mergeUniqueById(
    ...(resourcesQuery.data?.pages.map(page => page.items) ?? []),
  );
  const resourceItems = mergeUniqueById(
    ...(itemsQuery.data?.pages.map(page => page.items) ?? []),
  );
  const resourceItemViewModels = savedMediaCardViewModels(
    resourceItems,
    client,
  );
  const resourceHeading = (
    <View style={styles.resourceHeading}>
      <ControlButton
        compact
        label={`All ${tab.toLowerCase()}`}
        onPress={onReturn}
        platform={platform}
      />
      <Text
        style={
          television
            ? styles.resourceSelectionTitleTv
            : styles.resourceSelectionTitleMobile
        }
      >
        {selected?.title}
      </Text>
    </View>
  );

  if (selected && !television) {
    if (itemsQuery.isLoading)
      return (
        <SavedMobileStateList
          content={<PosterSkeletonGrid platform="mobile" />}
          contentContainerStyle={contentContainerStyle}
          contentOffset={contentOffset}
          onScroll={onScroll}
          testID="portico-four-saved-resource-items-mobile"
        />
      );
    if (itemsQuery.error && !itemsQuery.data)
      return (
        <SavedMobileStateList
          content={
            <EmptyState
              actionLabel={productText('action.retry')}
              message={productErrorMessageId(
                itemsQuery.error,
                'media.load-failed',
                {featureName: selected.title},
              )}
              onAction={() => void itemsQuery.refetch()}
              platform="mobile"
              title={`${selected.title} couldn’t load`}
            />
          }
          contentContainerStyle={contentContainerStyle}
          contentOffset={contentOffset}
          onScroll={onScroll}
          testID="portico-four-saved-resource-items-mobile"
        />
      );
    if (!resourceItems.length)
      return (
        <SavedMobileStateList
          content={
            <EmptyState
              message={`Media added to ${selected.title} appears here.`}
              platform="mobile"
              title={`${selected.title} is empty`}
            />
          }
          contentContainerStyle={contentContainerStyle}
          contentOffset={contentOffset}
          onScroll={onScroll}
          testID="portico-four-saved-resource-items-mobile"
        />
      );
    return (
      <MediaGrid
        contentContainerStyle={[styles.page, contentContainerStyle]}
        contentOffset={contentOffset}
        items={resourceItemViewModels}
        listFooter={
          itemsQuery.hasNextPage ? (
            <SavedPagination
              error={itemsQuery.isFetchNextPageError}
              loading={itemsQuery.isFetchingNextPage}
              onLoad={() => void itemsQuery.fetchNextPage()}
              platform="mobile"
            />
          ) : null
        }
        listHeader={resourceHeading}
        onScroll={onScroll}
        onOpen={item => {
          const selectedItem = resourceItemViewModels.find(
            candidate => candidate.id === item.id,
          );
          if (selectedItem) onOpenMedia(selectedItem);
        }}
        platform="mobile"
        testID="portico-four-saved-resource-items-mobile"
      />
    );
  }

  if (selected) {
    return (
      <View>
        <View style={styles.resourceHeading}>
          <ControlButton
            compact
            label={`All ${tab.toLowerCase()}`}
            onPress={onReturn}
            platform={platform}
          />
          <Text
            style={
              television
                ? styles.resourceSelectionTitleTv
                : styles.resourceSelectionTitleMobile
            }
          >
            {selected.title}
          </Text>
        </View>
        {itemsQuery.isLoading ? (
          <PosterSkeletonGrid platform={platform} />
        ) : itemsQuery.error && !itemsQuery.data ? (
          <EmptyState
            actionLabel={productText('action.retry')}
            message={productErrorMessageId(
              itemsQuery.error,
              'media.load-failed',
              {featureName: selected.title},
            )}
            onAction={() => void itemsQuery.refetch()}
            platform={platform}
            title={`${selected.title} couldn’t load`}
          />
        ) : resourceItems.length ? (
          <MediaGrid
            items={resourceItemViewModels}
            onOpen={item => {
              const selectedItem = resourceItemViewModels.find(
                candidate => candidate.id === item.id,
              );
              if (selectedItem) onOpenMedia(selectedItem);
            }}
            platform={platform}
          />
        ) : (
          <EmptyState
            message={`Media added to ${selected.title} appears here.`}
            platform={platform}
            title={`${selected.title} is empty`}
          />
        )}
      </View>
    );
  }

  if (resourcesQuery.isLoading)
    return television ? (
      <PosterSkeletonGrid platform={platform} />
    ) : (
      <SavedMobileStateList
        content={<PosterSkeletonGrid platform="mobile" />}
        contentContainerStyle={contentContainerStyle}
        contentOffset={contentOffset}
        onScroll={onScroll}
        testID="portico-four-saved-resources-mobile"
      />
    );
  if (resourcesQuery.error && !resourcesQuery.data)
    return television ? (
      <EmptyState
        actionLabel={productText('action.retry')}
        message={productErrorMessageId(
          resourcesQuery.error,
          'media.load-failed',
          {featureName: tab},
        )}
        onAction={() => void resourcesQuery.refetch()}
        platform={platform}
        title={`${tab} couldn’t load`}
      />
    ) : (
      <SavedMobileStateList
        content={
          <EmptyState
            actionLabel={productText('action.retry')}
            message={productErrorMessageId(
              resourcesQuery.error,
              'media.load-failed',
              {featureName: tab},
            )}
            onAction={() => void resourcesQuery.refetch()}
            platform="mobile"
            title={`${tab} couldn’t load`}
          />
        }
        contentContainerStyle={contentContainerStyle}
        contentOffset={contentOffset}
        onScroll={onScroll}
        testID="portico-four-saved-resources-mobile"
      />
    );
  if (!resources.length)
    return television ? (
      <EmptyState
        message={`Your ${tab.toLowerCase()} will appear here.`}
        platform={platform}
        title={`No ${tab.toLowerCase()} yet`}
      />
    ) : (
      <SavedMobileStateList
        content={
          <EmptyState
            message={`Your ${tab.toLowerCase()} will appear here.`}
            platform="mobile"
            title={`No ${tab.toLowerCase()} yet`}
          />
        }
        contentContainerStyle={contentContainerStyle}
        contentOffset={contentOffset}
        onScroll={onScroll}
        testID="portico-four-saved-resources-mobile"
      />
    );

  if (!television)
    return (
      <FlatList
        contentContainerStyle={[
          styles.savedResourceListMobile,
          contentContainerStyle,
        ]}
        contentOffset={contentOffset}
        data={resources}
        keyExtractor={resource => resource.id}
        ListFooterComponent={
          resourcesQuery.hasNextPage ? (
            <SavedPagination
              error={resourcesQuery.isFetchNextPageError}
              loading={resourcesQuery.isFetchingNextPage}
              onLoad={() => void resourcesQuery.fetchNextPage()}
              platform="mobile"
            />
          ) : null
        }
        onScroll={onScroll}
        renderItem={({item: resource}) => (
          <SavedResourceCard
            onOpen={onOpen}
            platform="mobile"
            resource={resource}
          />
        )}
        scrollEventThrottle={16}
        showsVerticalScrollIndicator={false}
        testID="portico-four-saved-resources-mobile"
      />
    );
  return (
    <View style={[styles.resourceList, styles.resourceListTv]}>
      {resources.map(resource => (
        <SavedResourceCard
          key={resource.id}
          onOpen={onOpen}
          platform={platform}
          resource={resource}
        />
      ))}
      {resourcesQuery.hasNextPage ? (
        <SavedPagination
          error={resourcesQuery.isFetchNextPageError}
          loading={resourcesQuery.isFetchingNextPage}
          onLoad={() => void resourcesQuery.fetchNextPage()}
          platform={platform}
        />
      ) : null}
    </View>
  );
}

function SavedResourceCard({
  onOpen,
  platform,
  resource,
}: {
  onOpen(resource: SavedResourceViewModel): void;
  platform: PrototypePlatform;
  resource: SavedResourceViewModel;
}) {
  const television = platform === 'tv';
  return (
    <Focusable
      accessibilityLabel={`${resource.title}. ${resource.itemCount ?? 0} items.`}
      accessibilityRole="button"
      focusedStyle={styles.resourceFocused}
      onPress={() => onOpen(resource)}
      platform={platform}
      pressedStyle={styles.resourcePressed}
      style={[styles.resource, television && styles.resourceTv]}
    >
      <View style={styles.resourceCopy}>
        <Text
          style={
            television ? styles.resourceTitleTv : styles.resourceTitleMobile
          }
        >
          {resource.title}
        </Text>
        <Text
          style={television ? styles.resourceMetaTv : styles.resourceMetaMobile}
        >
          {resource.itemCount !== undefined
            ? `${resource.itemCount} items`
            : 'Saved library view'}
          {resource.visibility ? `  ·  ${resource.visibility}` : ''}
        </Text>
        {resource.summary ? (
          <Text
            numberOfLines={2}
            style={
              television
                ? styles.resourceSummaryTv
                : styles.resourceSummaryMobile
            }
          >
            {resource.summary}
          </Text>
        ) : null}
      </View>
      <PorticoIcon color={color.dimSilver} id="navigation.disclosure" size={television ? 32 : 22} />
    </Focusable>
  );
}

async function loadSavedResources(
  client: PorticoClient,
  tab: Exclude<SavedTab, 'Watchlist' | 'Favorites'>,
  cursor: string | undefined,
  signal: AbortSignal,
) {
  const page =
    tab === 'Playlists'
      ? await client.playlists({cursor, limit: 50}, {signal})
      : tab === 'Collections'
        ? await client.collections({cursor, limit: 50}, {signal})
        : await client.savedViews({cursor, limit: 50}, {signal});
  return {
    items: savedResourceViewModels(page.items),
    nextCursor: page.pageInfo.hasMore
      ? (page.pageInfo.nextCursor ?? undefined)
      : undefined,
  };
}

async function loadSavedResourceItems(
  client: PorticoClient,
  tab: Exclude<SavedTab, 'Watchlist' | 'Favorites'>,
  id: string,
  cursor: string | undefined,
  signal: AbortSignal,
): Promise<{items: MediaCard[]; nextCursor?: string}> {
  if (tab === 'Playlists') {
    const page = await client.playlistItems(id, {cursor, limit: 50}, {signal});
    return {
      items: page.items.map(entry => entry.media),
      nextCursor: page.pageInfo.hasMore
        ? (page.pageInfo.nextCursor ?? undefined)
        : undefined,
    };
  }
  if (tab === 'Collections') {
    const page = await client.collectionItems(
      id,
      {cursor, limit: 50},
      {signal},
    );
    return {
      items: page.items,
      nextCursor: page.pageInfo.hasMore
        ? (page.pageInfo.nextCursor ?? undefined)
        : undefined,
    };
  }
  const page = await client.browseSavedView(id, {cursor, limit: 50}, {signal});
  return {
    items: page.items,
    nextCursor: page.pageInfo.hasMore
      ? (page.pageInfo.nextCursor ?? undefined)
      : undefined,
  };
}

function SavedPagination({
  error,
  loading,
  onLoad,
  platform,
}: {
  error: boolean;
  loading: boolean;
  onLoad(): void;
  platform: PrototypePlatform;
}) {
  const television = platform === 'tv';
  return (
    <View
      style={[styles.savedPagination, television && styles.savedPaginationTv]}
    >
      {error ? (
        <InlineNotice
          kind="error"
          message="The next page could not be loaded. Your current results are unchanged."
          platform={platform}
        />
      ) : null}
      <ControlButton
        compact
        disabled={loading}
        label={
          loading
            ? 'Loading…'
            : error
              ? 'Try loading more again'
              : productText('action.load-more')
        }
        onPress={onLoad}
        platform={platform}
      />
    </View>
  );
}

export function DownloadsScreen({platform}: {platform: PrototypePlatform}) {
  const television = platform === 'tv';
  const {openDownloadedPlayer, openSearch} = usePorticoNavigationActions();
  const auth = usePorticoAuth();
  const client = auth.session?.client;
  const viewerRuntime = useViewerRuntime();
  const {downloads, error, loading, refresh} = useDeviceDownloads();
  const [operationError, setOperationError] = useState<string>();
  const [busy, setBusy] = useState<string>();
  const {onScroll, scrollY} = useMobileChromeScroll(
    mobileChromeScope(
      'downloads',
      auth.session?.serverId,
      auth.session?.viewerScope.profileId,
    ),
  );

  const operate = async (id: string, operation: () => Promise<unknown>) => {
    setBusy(id);
    setOperationError(undefined);
    try {
      await operation();
      await refresh();
    } catch (cause) {
      setOperationError(productErrorBody(cause, 'download.change-failed'));
    } finally {
      setBusy(undefined);
    }
  };

  const retry = async (download: PorticoDownload) => {
    const scope = viewerRuntime.getSnapshot().scope;
    // Listing, deleting, pausing, resuming, and playing completed downloads
    // are device-local operations. Only recreating a failed download needs a
    // live server viewer, so keep the screen usable while disconnected and
    // reject this one explicit operation with normal product copy.
    if (!client || !scope) {
      throw new ProductMessageError('problem.server-unavailable');
    }
    const lease = viewerRuntime.createRequestLease(scope);
    try {
      const [media, response] = await Promise.all([
        client.media(download.mediaId, {}, {signal: lease.signal}),
        client.downloadOptions(download.mediaId),
      ]);
      if (!viewerRuntime.isWriteCurrent(lease.writeToken))
        throw new Error('viewer_scope_changed');
      const option = response.options.find(
        candidate =>
          (candidate.profile || candidate.id) === download.profile &&
          availableDownloadOptions([candidate]).length === 1,
      );
      if (!response.canDownload || !option)
        throw new Error('download_version_unavailable');
      await enqueueMediaDownload(client, media, option, {
        isCurrent: () => viewerRuntime.isWriteCurrent(lease.writeToken),
        scope,
        signal: lease.signal,
      });
    } finally {
      lease.release();
    }
  };

  const completedBytes = downloads
    .filter(download => download.state === 'completed')
    .reduce((total, download) => total + download.bytesWritten, 0);

  // Downloads are an iOS-only destination. This guard intentionally comes
  // after every hook so Fast Refresh and defensive tvOS rendering cannot
  // change hook order between renders.
  if (television) return null;

  const statusHeader = !downloadsSupported ? (
    <View style={styles.downloadsEmpty}>
      <EmptyState
        message={productBody('download.device-unavailable')}
        platform={platform}
        title={productTitle('download.device-unavailable')}
      />
    </View>
  ) : loading ? (
    <View style={styles.downloadsLoading}>
      <ActivityIndicator color={color.screenBlueStrong} />
      <Text style={styles.downloadsLoadingText}>
        {productText('download.device-reading', {device: 'iPhone'})}
      </Text>
    </View>
  ) : error ? (
    <EmptyState
      actionLabel={productText('action.retry')}
      message={error}
      onAction={() => void refresh()}
      platform={platform}
      title={productTitle('download.device-read-failed')}
    />
  ) : (
    <>
      {operationError ? (
        <InlineNotice
          kind="error"
          message={operationError}
          platform={platform}
        />
      ) : null}
      {downloads.length ? (
        <View style={styles.storageSummary}>
          <Text style={styles.storageTitle}>
            {productText('download.available-count', {
              count: downloads.filter(
                download => download.state === 'completed',
              ).length,
            })}
          </Text>
          <Text style={styles.storageMeta}>
            {productText('download.stored-on-device', {
              device: 'iPhone',
              size: formatBytes(completedBytes),
            })}
          </Text>
        </View>
      ) : null}
    </>
  );
  const emptyDownloads =
    downloadsSupported && !loading && !error && !downloads.length ? (
      <View style={styles.downloadsEmpty}>
        <EmptyState
          message={productBody('download.device-empty')}
          platform={platform}
          title={productTitle('download.device-empty')}
        />
      </View>
    ) : null;
  return (
    <MobileChromeScaffold
      header={
        <HeaderUtilities
          flush
          onSearch={openSearch}
          platform="mobile"
          title={productText('download.page-title')}
        />
      }
      scrollY={scrollY}
      testID="portico-mobile-downloads-chrome"
    >
      <FlatList
        contentContainerStyle={styles.page}
        data={downloadsSupported && !loading && !error ? downloads : []}
        keyExtractor={download => download.id}
        ListEmptyComponent={emptyDownloads}
        ListHeaderComponent={statusHeader}
        onScroll={onScroll}
        renderItem={({item: download}) => (
          <DownloadRow
            busy={busy === download.id}
            download={download}
            onDelete={() =>
              Alert.alert(
                'Delete download?',
                `${download.title} will be removed from this device.`,
                [
                  {text: productText('action.cancel'), style: 'cancel'},
                  {
                    text: 'Delete',
                    style: 'destructive',
                    onPress: () =>
                      void operate(download.id, () =>
                        porticoDownloads.remove(download.id),
                      ),
                  },
                ],
              )
            }
            onPause={() =>
              void operate(download.id, () =>
                porticoDownloads.pause(download.id),
              )
            }
            onPlay={() =>
              download.localURL &&
              openDownloadedPlayer(download.mediaId, download.id)
            }
            onResume={() =>
              void operate(download.id, () =>
                porticoDownloads.resume(download.id),
              )
            }
            onRetry={() => void operate(download.id, () => retry(download))}
          />
        )}
        scrollEventThrottle={16}
        showsVerticalScrollIndicator={false}
        testID="portico-four-downloads-mobile"
      />
    </MobileChromeScaffold>
  );
}

function DownloadRow({
  busy,
  download,
  onDelete,
  onPause,
  onPlay,
  onResume,
  onRetry,
}: {
  busy: boolean;
  download: PorticoDownload;
  onDelete(): void;
  onPause(): void;
  onPlay(): void;
  onResume(): void;
  onRetry(): void;
}) {
  const active =
    download.state === 'queued' ||
    download.state === 'preparing' ||
    download.state === 'downloading';
  const failed =
    download.state === 'failed' ||
    download.state === 'expired' ||
    download.state === 'unavailable';
  const deleted = download.state === 'deleted';
  const status = downloadStatus(download);
  return (
    <View style={styles.downloadRow}>
      <View style={styles.downloadGlyph}>
        <PorticoIcon color={download.state === 'completed' ? color.focus : color.softSilver} id="action.prepare-download" size={28} state={download.state === 'completed' ? 'selected' : 'default'} />
      </View>
      <View style={styles.downloadCopy}>
        <Text numberOfLines={1} style={styles.downloadTitle}>
          {download.title}
        </Text>
        {download.subtitle ? (
          <Text numberOfLines={1} style={styles.downloadSubtitle}>
            {download.subtitle}
          </Text>
        ) : null}
        <Text
          style={[styles.downloadStatus, failed && styles.downloadStatusError]}
        >
          {status}
        </Text>
        {failed ? (
          <Text numberOfLines={3} style={styles.downloadErrorDetail}>
            {productBody('download.failed')}
          </Text>
        ) : null}
        {active || download.state === 'paused' ? (
          <View
            accessibilityLabel={productText('download.progress-accessibility', {
              progress: Math.round(download.progress * 100),
            })}
            accessibilityRole="progressbar"
            style={styles.progressTrack}
          >
            <View
              style={[
                styles.progressValue,
                {
                  width: (Math.round(download.progress * 100) +
                    '%') as `${number}%`,
                },
              ]}
            />
          </View>
        ) : null}
      </View>
      <View style={styles.downloadActions}>
        {busy || deleted ? (
          <ActivityIndicator color={color.screenBlueStrong} />
        ) : (
          <>
            {active ? (
              <IconButton
                icon="playback.pause"
                label={productText('action.pause-download', {
                  title: download.title,
                })}
                onPress={onPause}
                platform="mobile"
              />
            ) : null}
            {download.state === 'paused' ? (
              <IconButton
                icon="playback.play"
                label={productText('action.resume-download', {
                  title: download.title,
                })}
                onPress={onResume}
                platform="mobile"
              />
            ) : null}
            {download.state === 'completed' && download.localURL ? (
              <IconButton
                icon="playback.play"
                label={productText('action.play-offline', {
                  title: download.title,
                })}
                onPress={onPlay}
                platform="mobile"
              />
            ) : null}
            {failed ? (
              <IconButton
                icon="action.retry"
                label={productText('action.retry-download', {
                  title: download.title,
                })}
                onPress={onRetry}
                platform="mobile"
              />
            ) : null}
            <IconButton
              icon="action.delete"
              label={productText('action.delete-device-download', {
                device: 'iPhone',
                title: download.title,
              })}
              onPress={onDelete}
              platform="mobile"
            />
          </>
        )}
      </View>
    </View>
  );
}

function downloadStatus(download: PorticoDownload): string {
  if (download.state === 'completed')
    return productText('download.status-complete', {
      size: formatBytes(download.bytesWritten),
    });
  if (download.state === 'downloading')
    return productText('download.status-downloading', {
      progress: Math.round(download.progress * 100),
      sizeSuffix:
        download.bytesExpected > 0
          ? ` · ${formatBytes(download.bytesExpected)}`
          : '',
    });
  if (download.state === 'queued') return productText('download.status-queued');
  if (download.state === 'preparing')
    return productText('download.status-preparing');
  if (download.state === 'paused')
    return productText('download.status-paused', {
      progress: Math.round(download.progress * 100),
    });
  if (download.state === 'expired')
    return productText('download.status-expired');
  if (download.state === 'unavailable')
    return productText('download.status-unavailable');
  if (download.state === 'deleted')
    return productText('download.status-removing');
  return productTitle('download.failed');
}

const styles = StyleSheet.create({
  page: {
    backgroundColor: color.projector,
    minHeight: '100%',
    paddingHorizontal: 16,
    paddingTop: 8,
  },
  pageTv: {paddingLeft: 0, paddingRight: 72, paddingTop: 10},
  savedContent: {marginTop: 20},
  savedContentTv: {marginTop: 28},
  virtualizedListHeader: {height: 0},
  savedResourceListMobile: {
    backgroundColor: color.projector,
    paddingBottom: 108,
    paddingHorizontal: 16,
    paddingTop: 8,
  },
  savedPagination: {alignItems: 'flex-start', gap: 10, marginTop: 20},
  savedPaginationTv: {gap: 14, marginTop: 30},
  downloadsEmpty: {marginTop: 20},
  downloadsLoading: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: 12,
    marginTop: 30,
    padding: 18,
  },
  downloadsLoadingText: {
    color: color.softSilver,
    fontFamily: font.regular,
    fontSize: 15,
  },
  downloadsContent: {gap: 16, marginTop: 18, paddingBottom: 100},
  storageSummary: {
    backgroundColor: color.recess,
    borderColor: color.lineSoft,
    borderRadius: 10,
    borderWidth: 1,
    padding: 16,
  },
  storageTitle: {color: color.silver, fontFamily: font.demi, fontSize: 16},
  storageMeta: {
    color: color.dimSilver,
    fontFamily: font.regular,
    fontSize: 13,
    marginTop: 4,
  },
  downloadList: {gap: 10},
  downloadRow: {
    alignItems: 'center',
    backgroundColor: color.recess,
    borderColor: color.lineSoft,
    borderRadius: 12,
    borderWidth: 1,
    flexDirection: 'row',
    gap: 12,
    minHeight: 112,
    padding: 13,
  },
  downloadGlyph: {
    alignItems: 'center',
    backgroundColor: color.projector,
    borderRadius: 9,
    height: 54,
    justifyContent: 'center',
    width: 54,
  },
  downloadCopy: {flex: 1, minWidth: 0},
  downloadTitle: {color: color.silver, fontFamily: font.demi, fontSize: 16},
  downloadSubtitle: {
    color: color.dimSilver,
    fontFamily: font.regular,
    fontSize: 12,
    marginTop: 2,
  },
  downloadStatus: {
    color: color.screenBlue,
    fontFamily: font.medium,
    fontSize: 12,
    marginTop: 7,
  },
  downloadStatusError: {color: color.record},
  downloadErrorDetail: {
    color: color.dimSilver,
    fontFamily: font.regular,
    fontSize: 11,
    lineHeight: 15,
    marginTop: 3,
  },
  progressTrack: {
    backgroundColor: color.lineSoft,
    borderRadius: 2,
    height: 3,
    marginTop: 7,
    overflow: 'hidden',
  },
  progressValue: {backgroundColor: color.focus, height: '100%'},
  downloadActions: {alignItems: 'center', flexDirection: 'row', gap: 4},
  resourceHeading: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: 12,
    marginBottom: 18,
  },
  resourceSelectionTitleMobile: {
    color: color.silver,
    flex: 1,
    fontFamily: font.demi,
    fontSize: 18,
  },
  resourceSelectionTitleTv: {
    color: color.silver,
    flex: 1,
    fontFamily: font.demi,
    fontSize: 27,
  },
  resourceList: {gap: 8, paddingBottom: 100},
  resourceListTv: {
    columnGap: 16,
    flexDirection: 'row',
    flexWrap: 'wrap',
    rowGap: 16,
  },
  resource: {
    alignItems: 'center',
    backgroundColor: color.recess,
    borderColor: color.lineSoft,
    borderRadius: 8,
    borderWidth: 3,
    flexDirection: 'row',
    gap: 12,
    minHeight: 94,
    padding: 14,
  },
  resourceTv: {gap: 18, minHeight: 144, padding: 20, width: '48.8%'},
  resourceFocused: {
    backgroundColor: color.raisedSlate,
    borderColor: color.focus,
  },
  resourcePressed: {backgroundColor: color.brightSlate},
  resourceCopy: {flex: 1},
  resourceTitleMobile: {
    color: color.silver,
    fontFamily: font.demi,
    fontSize: 17,
    lineHeight: 22,
  },
  resourceTitleTv: {
    color: color.silver,
    fontFamily: font.demi,
    fontSize: 25,
    lineHeight: 31,
  },
  resourceMetaMobile: {
    color: color.screenBlue,
    fontFamily: font.medium,
    fontSize: 12,
    lineHeight: 16,
    marginTop: 2,
  },
  resourceMetaTv: {
    color: color.screenBlue,
    fontFamily: font.medium,
    fontSize: 18,
    lineHeight: 24,
    marginTop: 3,
  },
  resourceSummaryMobile: {
    color: color.dimSilver,
    fontFamily: font.regular,
    fontSize: 13,
    lineHeight: 18,
    marginTop: 6,
  },
  resourceSummaryTv: {
    color: color.dimSilver,
    fontFamily: font.regular,
    fontSize: 19,
    lineHeight: 26,
    marginTop: 8,
  },
});
