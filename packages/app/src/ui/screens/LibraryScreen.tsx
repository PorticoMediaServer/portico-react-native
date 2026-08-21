import React, {useEffect, useMemo, useState} from 'react';
import {FlatList, ScrollView, StyleSheet, Text, View} from 'react-native';
import {useInfiniteQuery} from '@tanstack/react-query';
import {
  productErrorMessageId,
  usePorticoAuth,
} from '@portico-react-native/infrastructure';
import {PorticoIcon} from '@portico-react-native/icons';
import type {PrototypePlatform} from '../../ui-compat/contract';
import {
  availableSorts,
  loadLibraryPage,
  mergeLibraryPages,
  supportsAlphabetSeek,
  useLibraryCatalog,
  type ConnectedLibraryTab,
  type LibraryFacet,
  type LibraryResource,
  type LibraryScheduleEntry,
} from '../../data/library';
import {color, font} from '../tokens';
import {
  ControlButton,
  EmptyState,
  Focusable,
  InlineNotice,
  PosterSkeletonGrid,
  ProductEmptyState,
  UnderlineTabs,
} from '../primitives';
import {HeaderUtilities, MediaGrid, MediaRow} from '../sharedComponents';
import {usePrototypeUi} from '../uiState';
import {usePorticoNavigationActions} from '../navigation';
import {
  MobileChromePivot,
  MobileChromeScaffold,
  mobileChromeScope,
  useMobileChromeScroll,
} from '../shells';
import {productBody, productTitle} from '../productCopy';

const TV_SPECIAL_LIST_PROPS = {
  initialNumToRender: 8,
  maxToRenderPerBatch: 8,
  updateCellsBatchingPeriod: 50,
  windowSize: 5,
} as const;

const TV_SPECIAL_FACET_LIST_PROPS = {
  initialNumToRender: 6,
  maxToRenderPerBatch: 6,
  updateCellsBatchingPeriod: 50,
  windowSize: 3,
} as const;

type LibrarySpecialFocusKind = 'facet' | 'resource';
type LibrarySpecialKeyKind =
  | 'discover-row'
  | 'facet'
  | 'facet-group'
  | 'resource'
  | 'schedule';

export function librarySpecialItemKey(
  kind: LibrarySpecialKeyKind,
  id: string,
): string {
  return `${kind}:${encodeURIComponent(id)}`;
}

export function librarySpecialFocusId(
  libraryId: string,
  tabId: string,
  kind: LibrarySpecialFocusKind,
  itemId: string,
  groupId?: string,
): string {
  const scope = [
    libraryId,
    tabId,
    kind,
    ...(groupId ? [groupId] : []),
    itemId,
  ].map(value => encodeURIComponent(value));
  return `library-special:${scope.join(':')}`;
}

export type LibrarySpecialFocusScope = {libraryId: string; tabId: string};

export function librarySpecialTVFocusId(
  focusScope: LibrarySpecialFocusScope | undefined,
  kind: LibrarySpecialFocusKind,
  itemId: string,
  groupId?: string,
): string | undefined {
  return focusScope
    ? librarySpecialFocusId(
        focusScope.libraryId,
        focusScope.tabId,
        kind,
        itemId,
        groupId,
      )
    : undefined;
}

export function canRequestNextLibraryPage(
  hasNextPage: boolean,
  isFetchingNextPage: boolean,
): boolean {
  return hasNextPage && !isFetchingNextPage;
}

export function LibraryScreen({platform}: {platform: PrototypePlatform}) {
  const television = platform === 'tv';
  const auth = usePorticoAuth();
  const [selectedFacet, setSelectedFacet] = useState<LibraryFacet>();
  const [selectedResource, setSelectedResource] = useState<LibraryResource>();
  const {openMediaDetail, openSearch, replaceLibraryPresentation, route} =
    usePorticoNavigationActions();
  const {
    libraryFilters,
    libraryTab,
    selectedLibraryId,
    setLibraryFilters,
    setLibraryTab,
    setOverlay,
    setSelectedLibraryId,
    setSort,
    setSortDirection,
    sort,
    sortDirection,
    viewMode,
  } = usePrototypeUi();
  const catalog = useLibraryCatalog(selectedLibraryId);
  const library =
    catalog.data?.libraries.find(
      candidate => candidate.id === selectedLibraryId,
    ) ?? catalog.data?.libraries[0];
  const tab =
    library?.tabs.find(
      candidate =>
        candidate.label === libraryTab || candidate.id === libraryTab,
    ) ?? library?.tabs[0];
  const sorts = useMemo(
    () => (library && tab ? availableSorts(library, tab) : []),
    [library, tab],
  );
  const canFilter = Boolean(
    library &&
    tab &&
    tab.browseSupported &&
    library.fields.some(
      field =>
        !field.applicableKinds?.length ||
        field.applicableKinds.some(kind => tab.entityKinds.includes(kind)),
    ),
  );
  const canSeek = Boolean(
    library && tab && supportsAlphabetSeek(library, tab, sort, sortDirection),
  );
  const {onScroll, scrollY} = useMobileChromeScroll(
    mobileChromeScope(
      'library',
      auth.session?.serverId,
      auth.session?.viewerScope.profileId,
      {
        library: selectedLibraryId,
        pivot: libraryTab,
        query: {sort, sortDirection, viewMode, filters: libraryFilters},
        selectedFacet: selectedFacet?.id,
        selectedResource: selectedResource?.id,
      },
    ),
  );
  const canChooseView = Boolean(
    tab?.supportedViews.some(value => value === 'grid' || value === 'list'),
  );
  const isDiscover = tab?.id === 'discover';
  const page = useInfiniteQuery({
    enabled: Boolean(auth.session?.client && library && tab),
    queryKey: [
      'library-page',
      auth.session?.serverId,
      library?.id,
      tab?.id,
      libraryFilters,
      sort,
      sortDirection,
      selectedFacet?.id,
      selectedResource?.id,
    ],
    initialPageParam: undefined as string | undefined,
    queryFn: ({pageParam, signal}) =>
      loadLibraryPage(
        auth.session!.client,
        library!,
        tab!,
        {
          filters: canFilter ? libraryFilters : [],
          sortLabel: sort,
          sortDirection,
          facetQuery: selectedFacet?.query,
          resourceId: selectedResource?.id,
          cursor: pageParam,
        },
        signal,
      ),
    getNextPageParam: (lastPage, pages) =>
      lastPage.hasMore &&
      !pages
        .slice(0, -1)
        .some(pageEntry => pageEntry.nextCursor === lastPage.nextCursor)
        ? lastPage.nextCursor
        : undefined,
  });
  useEffect(() => {
    if (route.name !== 'library' || !catalog.data) return;
    const requestedLibrary = route.libraryId
      ? catalog.data.libraries.find(
          candidate => candidate.id === route.libraryId,
        )
      : undefined;
    const targetLibrary = requestedLibrary ?? library;
    if (!targetLibrary) return;
    const requestedTab = route.pivot
      ? targetLibrary.tabs.find(
          candidate =>
            candidate.id === route.pivot || candidate.label === route.pivot,
        )
      : undefined;
    const targetTab = requestedTab ?? targetLibrary.tabs[0];
    if (!targetTab) return;
    if (selectedLibraryId !== targetLibrary.id)
      setSelectedLibraryId(targetLibrary.id);
    if (libraryTab !== targetTab.label) setLibraryTab(targetTab.label);
    if (
      route.libraryId !== targetLibrary.id ||
      route.pivot !== targetTab.label
    ) {
      replaceLibraryPresentation(targetLibrary.id, targetTab.label);
    }
  }, [
    catalog.data,
    library,
    libraryTab,
    replaceLibraryPresentation,
    route,
    selectedLibraryId,
    setLibraryTab,
    setSelectedLibraryId,
  ]);

  const changeLibraryTab = React.useCallback(
    (value: string) => {
      setLibraryTab(value);
      replaceLibraryPresentation(selectedLibraryId, value);
    },
    [replaceLibraryPresentation, selectedLibraryId, setLibraryTab],
  );

  useEffect(() => {
    if (library && library.id !== selectedLibraryId)
      setSelectedLibraryId(library.id);
  }, [library, selectedLibraryId, setSelectedLibraryId]);
  useEffect(() => {
    if (tab && tab.label !== libraryTab) setLibraryTab(tab.label);
  }, [libraryTab, setLibraryTab, tab]);
  useEffect(() => {
    if (sorts.length && !sorts.some(candidate => candidate.label === sort)) {
      setSort(sorts[0]!.label);
      setSortDirection(sorts[0]!.defaultDirection);
    }
  }, [setSort, setSortDirection, sort, sorts]);
  useEffect(() => {
    setSelectedFacet(undefined);
    setSelectedResource(undefined);
  }, [library?.id, tab?.id]);

  if (catalog.error && !catalog.data) {
    const error = (
      <ProductEmptyState
        id="library.load-failed"
        onAction={() => {
          catalog.refetch().catch(() => undefined);
        }}
        platform={platform}
      />
    );
    return television ? (
      error
    ) : (
      <MobileChromeScaffold
        header={
          <LibraryHeading
            libraryName="Library"
            onSearch={openSearch}
            platform="mobile"
            serverName={auth.session?.serverName ?? ''}
          />
        }
        scrollY={scrollY}
        testID="portico-mobile-library-chrome"
      >
        <ScrollView
          contentContainerStyle={styles.page}
          onScroll={onScroll}
          scrollEventThrottle={16}
          showsVerticalScrollIndicator={false}
        >
          {error}
        </ScrollView>
      </MobileChromeScaffold>
    );
  }

  if (catalog.isLoading || !library || !tab) {
    return television ? (
      <ScrollView contentContainerStyle={styles.pageTv}>
        <LibraryHeading
          libraryName="Library"
          platform={platform}
          serverName={auth.session?.serverName ?? ''}
        />
        <PosterSkeletonGrid platform={platform} />
      </ScrollView>
    ) : (
      <MobileChromeScaffold
        header={
          <LibraryHeading
            libraryName="Library"
            onSearch={openSearch}
            platform="mobile"
            serverName={auth.session?.serverName ?? ''}
          />
        }
        scrollY={scrollY}
        testID="portico-mobile-library-chrome"
      >
        <ScrollView
          contentContainerStyle={styles.page}
          onScroll={onScroll}
          scrollEventThrottle={16}
          showsVerticalScrollIndicator={false}
        >
          <PosterSkeletonGrid platform="mobile" />
        </ScrollView>
      </MobileChromeScaffold>
    );
  }

  const mergedPage = mergeLibraryPages(page.data?.pages ?? []);
  const items = mergedPage?.items ?? [];
  const total = mergedPage?.total ?? items.length;
  const resultCount = libraryResultCount(total, tab);

  const toolbar = (
    <View style={styles.toolbar}>
      <ScrollView
        contentContainerStyle={styles.toolbarScroll}
        horizontal
        showsHorizontalScrollIndicator={false}
        style={styles.toolbarViewport}
      >
        {selectedFacet || selectedResource ? (
          <ControlButton
            dense
            icon="navigation.back"
            label={selectedFacet?.title ?? selectedResource?.title ?? 'Back'}
            onPress={() => {
              setSelectedFacet(undefined);
              setSelectedResource(undefined);
            }}
            platform="mobile"
          />
        ) : null}
        {canFilter ? (
          <ControlButton
            dense
            icon="action.filter"
            label={
              libraryFilters.length
                ? `Filter ${libraryFilters.length}`
                : 'Filter'
            }
            onPress={() => setOverlay('filters')}
            platform="mobile"
            selected={libraryFilters.length > 0}
          />
        ) : null}
        {sorts.length ? (
          <ControlButton
            dense
            icon={
              sortDirection === 'asc'
                ? 'action.sort-ascending'
                : 'action.sort-descending'
            }
            label={`${sort}, ${sortDirection === 'asc' ? 'ascending' : 'descending'}`}
            onPress={() => setOverlay('sort')}
            platform="mobile"
          />
        ) : null}
        {canChooseView ? (
          <ControlButton
            dense
            icon={viewMode === 'grid' ? 'view.grid' : 'view.list'}
            label={viewMode === 'grid' ? 'Grid' : 'List'}
            onPress={() => setOverlay('view')}
            platform="mobile"
          />
        ) : null}
      </ScrollView>
      <Text numberOfLines={1} style={styles.resultCountMobile}>
        {resultCount}
      </Text>
    </View>
  );
  const mobileChromeControlRows = isDiscover ? 0 : 1;
  const mobileChromeControls = mobileChromeControlRows ? toolbar : undefined;
  const listHeader = television ? (
    <View style={styles.libraryHeader}>
      <LibraryHeading
        libraryName={library.name}
        onSearch={openSearch}
        platform={platform}
        serverName={catalog.data?.serverName ?? auth.session?.serverName ?? ''}
      />
      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        style={television ? styles.tabsViewportTv : styles.tabsViewportMobile}
      >
        <UnderlineTabs
          active={tab.label}
          onChange={changeLibraryTab}
          platform={platform}
          tabs={library.tabs.map(candidate => candidate.label)}
        />
      </ScrollView>
      {!isDiscover ? (
        <View style={[styles.toolbar, television && styles.toolbarTv]}>
          <ScrollView
            contentContainerStyle={[
              styles.toolbarScroll,
              television && styles.toolbarScrollTv,
            ]}
            horizontal
            showsHorizontalScrollIndicator={false}
          >
            {selectedFacet || selectedResource ? (
              <ControlButton
                icon="navigation.back"
                label={
                  selectedFacet?.title ?? selectedResource?.title ?? 'Back'
                }
                onPress={() => {
                  setSelectedFacet(undefined);
                  setSelectedResource(undefined);
                }}
                platform={platform}
              />
            ) : null}
            {canFilter ? (
              <ControlButton
                icon="action.filter"
                label={
                  libraryFilters.length
                    ? `Filter (${libraryFilters.length})`
                    : 'Filter'
                }
                onPress={() => setOverlay('filters')}
                platform={platform}
                selected={libraryFilters.length > 0}
              />
            ) : null}
            {sorts.length ? (
              <ControlButton
                icon={
                  sortDirection === 'asc'
                    ? 'action.sort-ascending'
                    : 'action.sort-descending'
                }
                label={`Sort: ${sort}, ${sortDirection === 'asc' ? 'ascending' : 'descending'}`}
                onPress={() => setOverlay('sort')}
                platform={platform}
              />
            ) : null}
            {canChooseView ? (
              <ControlButton
                icon={viewMode === 'grid' ? 'view.grid' : 'view.list'}
                label={viewMode === 'grid' ? 'Grid' : 'List'}
                onPress={() => setOverlay('view')}
                platform={platform}
              />
            ) : null}
          </ScrollView>
          <Text
            style={television ? styles.resultCountTv : styles.resultCountMobile}
          >
            {resultCount}
          </Text>
        </View>
      ) : null}
      {page.error && !mergedPage ? (
        <InlineNotice
          kind="error"
          message={errorMessage(page.error)}
          platform={platform}
        />
      ) : null}
    </View>
  ) : undefined;
  const mobileSurface = (content: React.ReactElement) => (
    <MobileChromeScaffold
      controlRows={mobileChromeControlRows}
      controls={mobileChromeControls}
      header={
        <LibraryHeading
          libraryName={library.name}
          onSearch={openSearch}
          platform="mobile"
          serverName={
            catalog.data?.serverName ?? auth.session?.serverName ?? ''
          }
        />
      }
      pivot={
        <MobileChromePivot
          active={tab.label}
          onChange={changeLibraryTab}
          tabs={library.tabs.map(candidate => candidate.label)}
        />
      }
      scrollY={scrollY}
      testID="portico-mobile-library-chrome"
    >
      {React.cloneElement(content as React.ReactElement<any>, {
        onScroll,
        scrollEventThrottle: 16,
        stickyHeaderIndices: undefined,
      })}
    </MobileChromeScaffold>
  );

  if (page.isLoading) {
    const content = (
      <ScrollView
        contentContainerStyle={[styles.page, television && styles.pageTv]}
      >
        {listHeader}
        <PosterSkeletonGrid platform={platform} />
      </ScrollView>
    );
    return television ? content : mobileSurface(content);
  }

  if (page.error && !mergedPage) {
    const content = (
      <ScrollView
        contentContainerStyle={[styles.page, television && styles.pageTv]}
        showsVerticalScrollIndicator={false}
        stickyHeaderIndices={television ? undefined : [0]}
      >
        {listHeader}
        <ProductEmptyState
          id="library.load-failed"
          onAction={() => {
            page.refetch().catch(() => undefined);
          }}
          platform={platform}
        />
      </ScrollView>
    );
    return television ? content : mobileSurface(content);
  }

  const loadNextPage = () => {
    if (!canRequestNextLibraryPage(page.hasNextPage, page.isFetchingNextPage))
      return;
    page.fetchNextPage().catch(() => undefined);
  };
  const pagination = page.hasNextPage ? (
    <PaginationControl
      error={
        page.isFetchNextPageError
          ? 'The next page could not be loaded. Your current results are unchanged.'
          : undefined
      }
      loading={page.isFetchingNextPage}
      onLoad={loadNextPage}
      platform={platform}
    />
  ) : null;
  const specialFocusScope = {libraryId: library.id, tabId: tab.id};

  if (mergedPage?.presentation === 'facets') {
    const content = (
      <FlatList
        {...TV_SPECIAL_LIST_PROPS}
        contentContainerStyle={[styles.page, styles.specialPage, styles.pageTv]}
        data={mergedPage.facets}
        keyExtractor={group => librarySpecialItemKey('facet-group', group.id)}
        ListEmptyComponent={
          <EmptyState
            message="This library has no category values yet."
            platform="tv"
            title={`No ${tab.label.toLowerCase()}`}
          />
        }
        ListFooterComponent={pagination}
        ListHeaderComponent={listHeader}
        renderItem={({item: group}) => (
          <FacetGroup
            focusScope={specialFocusScope}
            group={group}
            onSelect={setSelectedFacet}
            platform="tv"
          />
        )}
        showsVerticalScrollIndicator={false}
        style={styles.specialListTv}
        testID="portico-four-library-tv"
      />
    );
    const mobileContent = (
      <FlatList
        contentContainerStyle={[styles.page, styles.specialPage]}
        data={mergedPage.facets}
        keyExtractor={group => librarySpecialItemKey('facet-group', group.id)}
        renderItem={({item: group}) => (
          <FacetGroup
            group={group}
            onSelect={setSelectedFacet}
            platform="mobile"
          />
        )}
        ListEmptyComponent={
          <EmptyState
            message={`No ${tab.label.toLowerCase()} are available.`}
            platform="mobile"
            title={`No ${tab.label.toLowerCase()}`}
          />
        }
        ListFooterComponent={pagination}
        showsVerticalScrollIndicator={false}
        testID="portico-four-library-mobile"
      />
    );
    return television ? content : mobileSurface(mobileContent);
  }

  if (mergedPage?.presentation === 'resources') {
    const content = (
      <FlatList
        {...TV_SPECIAL_LIST_PROPS}
        columnWrapperStyle={styles.resourceGridTv}
        contentContainerStyle={[styles.page, styles.specialPage, styles.pageTv]}
        data={mergedPage.resources}
        keyExtractor={resource =>
          librarySpecialItemKey('resource', resource.id)
        }
        ListEmptyComponent={
          <EmptyState
            message={`No ${tab.label.toLowerCase()} are associated with this library.`}
            platform="tv"
            title={`No ${tab.label.toLowerCase()}`}
          />
        }
        ListFooterComponent={pagination}
        ListHeaderComponent={listHeader}
        numColumns={3}
        renderItem={({item: resource}) => (
          <ResourceCard
            focusScope={specialFocusScope}
            onSelect={setSelectedResource}
            platform="tv"
            resource={resource}
          />
        )}
        showsVerticalScrollIndicator={false}
        style={styles.specialListTv}
        testID="portico-four-library-tv"
      />
    );
    const mobileContent = (
      <FlatList
        contentContainerStyle={[styles.page, styles.specialPage]}
        data={mergedPage.resources}
        keyExtractor={resource =>
          librarySpecialItemKey('resource', resource.id)
        }
        renderItem={({item: resource}) => (
          <ResourceCard
            onSelect={setSelectedResource}
            platform="mobile"
            resource={resource}
          />
        )}
        ListEmptyComponent={
          <EmptyState
            message={`No ${tab.label.toLowerCase()} are associated with this library.`}
            platform="mobile"
            title={`No ${tab.label.toLowerCase()}`}
          />
        }
        ListFooterComponent={pagination}
        showsVerticalScrollIndicator={false}
        testID="portico-four-library-mobile"
      />
    );
    return television ? content : mobileSurface(mobileContent);
  }

  if (mergedPage?.presentation === 'schedule') {
    const content = (
      <FlatList
        {...TV_SPECIAL_LIST_PROPS}
        contentContainerStyle={[styles.page, styles.specialPage, styles.pageTv]}
        data={mergedPage.schedule}
        ItemSeparatorComponent={ScheduleSeparator}
        keyExtractor={entry => librarySpecialItemKey('schedule', entry.id)}
        ListEmptyComponent={
          <EmptyState
            message="There are no scheduled or in-progress recordings."
            platform="tv"
            title="Nothing scheduled"
          />
        }
        ListFooterComponent={pagination}
        ListHeaderComponent={listHeader}
        renderItem={({item: entry}) => (
          <ScheduleRow entry={entry} platform="tv" />
        )}
        showsVerticalScrollIndicator={false}
        style={styles.specialListTv}
        testID="portico-four-library-tv"
      />
    );
    const mobileContent = (
      <FlatList
        contentContainerStyle={[styles.page, styles.specialPage]}
        data={mergedPage.schedule}
        keyExtractor={entry => librarySpecialItemKey('schedule', entry.id)}
        renderItem={({item: entry}) => (
          <ScheduleRow entry={entry} platform="mobile" />
        )}
        ListEmptyComponent={
          <EmptyState
            message="There are no scheduled or in-progress recordings."
            platform="mobile"
            title="Nothing scheduled"
          />
        }
        ListFooterComponent={pagination}
        showsVerticalScrollIndicator={false}
        testID="portico-four-library-mobile"
      />
    );
    return television ? content : mobileSurface(mobileContent);
  }

  if (items.length === 0) {
    const content = (
      <ScrollView
        contentContainerStyle={[styles.page, television && styles.pageTv]}
        showsVerticalScrollIndicator={false}
        stickyHeaderIndices={television ? undefined : [0]}
        testID={`portico-four-library-${platform}`}
      >
        {listHeader}
        {libraryFilters.length ? (
          <ProductEmptyState
            id="library.filtered-empty"
            onAction={() => setLibraryFilters([])}
            platform={platform}
          />
        ) : (
          <EmptyState
            message={
              selectedFacet
                ? `No visible media matches ${selectedFacet.title}.`
                : selectedResource
                  ? `${selectedResource.title} does not contain any visible media.`
                  : 'This library does not contain any visible media yet.'
            }
            platform={platform}
            title={
              selectedFacet || selectedResource
                ? 'No media found'
                : `${library.name} is empty`
            }
          />
        )}
      </ScrollView>
    );
    return television ? content : mobileSurface(content);
  }

  if (isDiscover) {
    const discoverRows = mergedPage!.rows.filter(row => row.items.length > 0);
    const renderDiscoverRow = (row: (typeof discoverRows)[number]) => (
      <MediaRow
        flush
        items={row.items}
        key={librarySpecialItemKey('discover-row', row.id)}
        onOpen={item => openMediaDetail(item)}
        platform={platform}
        shape={row.shape}
        title={row.title}
      />
    );
    const tvContent = (
      <FlatList
        {...TV_SPECIAL_LIST_PROPS}
        contentContainerStyle={[
          styles.page,
          styles.discoverPage,
          styles.pageTv,
        ]}
        data={discoverRows}
        keyExtractor={row => librarySpecialItemKey('discover-row', row.id)}
        ListFooterComponent={pagination}
        ListHeaderComponent={listHeader}
        renderItem={({item: row}) => renderDiscoverRow(row)}
        showsVerticalScrollIndicator={false}
        style={styles.specialListTv}
        testID="portico-four-library-tv"
      />
    );
    const content = (
      <ScrollView
        contentContainerStyle={[
          styles.page,
          styles.discoverPage,
          television && styles.pageTv,
        ]}
        showsVerticalScrollIndicator={false}
        stickyHeaderIndices={television ? undefined : [0]}
        testID={`portico-four-library-${platform}`}
      >
        {listHeader}
        <View
          style={television ? styles.discoverRowsTv : styles.discoverRowsMobile}
        >
          {discoverRows.map(renderDiscoverRow)}
        </View>
      </ScrollView>
    );
    return television ? tvContent : mobileSurface(content);
  }

  const grid = (
    <MediaGrid
      contentContainerStyle={[styles.page, television && styles.pageTv]}
      items={items}
      listHeader={
        television ? listHeader : <View style={styles.virtualizedListHeader} />
      }
      listFooter={pagination}
      onOpen={item => openMediaDetail(item)}
      platform={platform}
      onScroll={television ? undefined : onScroll}
      stickyHeaderIndices={undefined}
      testID={`portico-four-library-${platform}`}
      viewMode={viewMode}
    />
  );
  return television ? (
    <View style={styles.tvGridFrame}>
      {grid}
      {canSeek ? <AlphabetIndexRail /> : null}
    </View>
  ) : (
    <MobileChromeScaffold
      controlRows={mobileChromeControlRows}
      controls={mobileChromeControls}
      header={
        <LibraryHeading
          libraryName={library.name}
          onSearch={openSearch}
          platform="mobile"
          serverName={
            catalog.data?.serverName ?? auth.session?.serverName ?? ''
          }
        />
      }
      pivot={
        <MobileChromePivot
          active={tab.label}
          onChange={changeLibraryTab}
          tabs={library.tabs.map(candidate => candidate.label)}
        />
      }
      scrollY={scrollY}
      testID="portico-mobile-library-chrome"
    >
      {grid}
    </MobileChromeScaffold>
  );
}

function AlphabetIndexRail() {
  return (
    <View
      accessible={false}
      pointerEvents="none"
      style={styles.alphabetIndexRail}
    >
      {'ABCDEFGHIJKLMNOPQRSTUVWXYZ'.split('').map(letter => (
        <Text key={letter} style={styles.alphabetIndexLetter}>
          {letter}
        </Text>
      ))}
    </View>
  );
}

function libraryResultCount(count: number, tab: ConnectedLibraryTab): string {
  const kind =
    tab.entityKinds.length === 1
      ? tab.entityKinds[0]?.toLowerCase()
      : undefined;
  const label = tab.label.toLowerCase();
  const noun =
    kind === 'movie' || label.includes('movie')
      ? 'movie'
      : kind === 'show' || label.includes('show')
        ? 'show'
        : kind === 'album' || label.includes('album')
          ? 'album'
          : kind === 'artist' || label.includes('artist')
            ? 'artist'
            : kind === 'track' ||
                label.includes('song') ||
                label.includes('track')
              ? 'song'
              : kind === 'episode' || label.includes('episode')
                ? 'episode'
                : kind === 'season' || label.includes('season')
                  ? 'season'
                  : kind === 'book' ||
                      kind === 'audiobook' ||
                      label.includes('book')
                    ? 'audiobook'
                    : kind === 'collection' || label.includes('collection')
                      ? 'collection'
                      : kind === 'playlist' || label.includes('playlist')
                        ? 'playlist'
                        : 'item';
  return `${count.toLocaleString()} ${count === 1 ? noun : `${noun}s`}`;
}

function PaginationControl({
  error,
  loading,
  onLoad,
  platform,
}: {
  error?: string;
  loading: boolean;
  onLoad(): void;
  platform: PrototypePlatform;
}) {
  const television = platform === 'tv';
  return (
    <View style={[styles.pagination, television && styles.paginationTv]}>
      {error ? (
        <InlineNotice kind="error" message={error} platform={platform} />
      ) : null}
      <ControlButton
        compact
        disabled={loading}
        label={
          loading ? 'Loading…' : error ? 'Try loading more again' : 'Load more'
        }
        onPress={onLoad}
        platform={platform}
      />
    </View>
  );
}

function ScheduleSeparator() {
  return <View style={styles.scheduleSeparatorTv} />;
}

function FacetGroup({
  focusScope,
  group,
  onSelect,
  platform,
}: {
  focusScope?: LibrarySpecialFocusScope;
  group: {id: string; title: string; items: LibraryFacet[]};
  onSelect(facet: LibraryFacet): void;
  platform: PrototypePlatform;
}) {
  const television = platform === 'tv';
  const renderFacet = (facet: LibraryFacet) => (
    <Focusable
      accessibilityLabel={`${facet.title}, ${facet.count} items`}
      accessibilityRole="button"
      focusedStyle={styles.specialCardFocused}
      key={librarySpecialItemKey('facet', facet.id)}
      onPress={() => onSelect(facet)}
      platform={platform}
      pressedStyle={styles.specialCardPressed}
      style={[styles.facetCard, television && styles.facetCardTv]}
      tvFocusId={librarySpecialTVFocusId(
        focusScope,
        'facet',
        facet.id,
        group.id,
      )}
    >
      <Text
        numberOfLines={2}
        style={television ? styles.specialTitleTv : styles.specialTitleMobile}
      >
        {facet.title}
      </Text>
      <Text
        style={television ? styles.specialMetaTv : styles.specialMetaMobile}
      >
        {facet.count} {facet.count === 1 ? 'item' : 'items'}
      </Text>
      {facet.detail ? (
        <Text
          numberOfLines={2}
          style={
            television ? styles.specialSummaryTv : styles.specialSummaryMobile
          }
        >
          {facet.detail}
        </Text>
      ) : null}
    </Focusable>
  );
  const facetList = television ? (
    <FlatList
      {...TV_SPECIAL_FACET_LIST_PROPS}
      contentContainerStyle={[styles.facetRow, styles.facetRowTv]}
      data={group.items}
      horizontal
      keyExtractor={facet => librarySpecialItemKey('facet', facet.id)}
      renderItem={({item: facet}) => renderFacet(facet)}
      showsHorizontalScrollIndicator={false}
    />
  ) : (
    <ScrollView
      contentContainerStyle={styles.facetRow}
      horizontal
      showsHorizontalScrollIndicator={false}
    >
      {group.items.map(renderFacet)}
    </ScrollView>
  );
  return (
    <View style={[styles.facetGroup, television && styles.facetGroupTv]}>
      <Text
        style={television ? styles.sectionTitleTv : styles.sectionTitleMobile}
      >
        {group.title}
      </Text>
      {facetList}
    </View>
  );
}

function ResourceCard({
  focusScope,
  onSelect,
  platform,
  resource,
}: {
  focusScope?: LibrarySpecialFocusScope;
  onSelect(resource: LibraryResource): void;
  platform: PrototypePlatform;
  resource: LibraryResource;
}) {
  const television = platform === 'tv';
  return (
    <Focusable
      accessibilityLabel={`${resource.title}, ${resource.itemCount} items`}
      accessibilityRole="button"
      focusedStyle={styles.specialCardFocused}
      onPress={() => onSelect(resource)}
      platform={platform}
      pressedStyle={styles.specialCardPressed}
      style={[styles.resourceCard, television && styles.resourceCardTv]}
      tvFocusId={librarySpecialTVFocusId(focusScope, 'resource', resource.id)}
    >
      <Text
        numberOfLines={2}
        style={television ? styles.specialTitleTv : styles.specialTitleMobile}
      >
        {resource.title}
      </Text>
      <Text
        style={television ? styles.specialMetaTv : styles.specialMetaMobile}
      >
        {resource.itemCount} {resource.itemCount === 1 ? 'item' : 'items'}
      </Text>
      {resource.summary ? (
        <Text
          numberOfLines={3}
          style={
            television ? styles.specialSummaryTv : styles.specialSummaryMobile
          }
        >
          {resource.summary}
        </Text>
      ) : null}
    </Focusable>
  );
}

function ScheduleRow({
  entry,
  platform,
}: {
  entry: LibraryScheduleEntry;
  platform: PrototypePlatform;
}) {
  const television = platform === 'tv';
  const statusTitle = productTitle(entry.statusMessageId);
  const statusDetail = productBody(entry.statusMessageId);
  return (
    <View
      accessibilityLabel={`${entry.title}. ${entry.subtitle}. ${statusDetail}`}
      style={[styles.scheduleRow, television && styles.scheduleRowTv]}
    >
      <View style={styles.scheduleCopy}>
        <Text
          numberOfLines={1}
          style={television ? styles.specialTitleTv : styles.specialTitleMobile}
        >
          {entry.title}
        </Text>
        <Text
          style={television ? styles.specialMetaTv : styles.specialMetaMobile}
        >
          {entry.subtitle}
        </Text>
        <Text
          numberOfLines={2}
          style={
            television ? styles.specialSummaryTv : styles.specialSummaryMobile
          }
        >
          {statusDetail}
        </Text>
      </View>
      <Text
        style={[
          television ? styles.scheduleStatusTv : styles.scheduleStatusMobile,
          entry.status === 'failed' && styles.scheduleFailed,
        ]}
      >
        {statusTitle}
      </Text>
    </View>
  );
}

function LibraryHeading({
  libraryName,
  onSearch,
  platform,
  serverName,
}: {
  libraryName: string;
  onSearch?(): void;
  platform: PrototypePlatform;
  serverName: string;
}) {
  const television = platform === 'tv';
  const {setOverlay} = usePrototypeUi();
  const leftContent = (
    <View style={styles.headingCopy}>
      {television ? (
        <Text
          ellipsizeMode="tail"
          numberOfLines={1}
          style={[styles.libraryTitleTv, styles.title]}
        >
          {libraryName}
        </Text>
      ) : (
        <Focusable
          accessibilityLabel={`Current library: ${libraryName}. Choose another library.`}
          accessibilityRole="button"
          onPress={() => setOverlay('library')}
          platform={platform}
          style={styles.librarySelector}
          focusedStyle={styles.librarySelectorFocused}
          pressedStyle={styles.librarySelectorPressed}
        >
          <Text
            ellipsizeMode="tail"
            numberOfLines={1}
            style={[styles.libraryTitleMobile, styles.title]}
          >
            {libraryName}
          </Text>
          <PorticoIcon
            color={color.dimSilver}
            id="navigation.expand"
            size={22}
          />
        </Focusable>
      )}
      <Text
        style={television ? styles.serverLabelTv : styles.serverLabelMobile}
      >
        {serverName}
      </Text>
    </View>
  );
  return (
    <HeaderUtilities
      flush
      leftContent={leftContent}
      onSearch={onSearch}
      platform={platform}
    />
  );
}

function errorMessage(error: unknown) {
  return productErrorMessageId(error, 'library.load-failed');
}

const styles = StyleSheet.create({
  page: {
    backgroundColor: color.projector,
    minHeight: '100%',
    paddingHorizontal: 16,
    paddingTop: 8,
  },
  discoverPage: {paddingBottom: 48},
  discoverRowsMobile: {paddingTop: 12},
  discoverRowsTv: {paddingTop: 18},
  specialPage: {paddingBottom: 108},
  pageTv: {paddingLeft: 0, paddingRight: 72, paddingTop: 10},
  specialListTv: {backgroundColor: color.projector, flex: 1},
  headingCopy: {flex: 1},
  librarySelector: {
    alignItems: 'center',
    alignSelf: 'flex-start',
    borderColor: color.transparent,
    borderRadius: 8,
    borderWidth: 2,
    flexDirection: 'row',
    gap: 5,
    marginLeft: -8,
    maxWidth: 248,
    paddingHorizontal: 6,
    paddingVertical: 1,
  },
  librarySelectorFocused: {
    backgroundColor: color.raisedSlate,
    borderColor: color.focus,
  },
  librarySelectorPressed: {backgroundColor: color.brightSlate},
  title: {color: color.silver},
  libraryTitleMobile: {
    fontFamily: font.bold,
    fontSize: 22,
    letterSpacing: -0.45,
    lineHeight: 26,
    maxWidth: 202,
  },
  libraryTitleTv: {
    fontFamily: font.bold,
    fontSize: 36,
    letterSpacing: -0.8,
    lineHeight: 41,
    maxWidth: 720,
  },
  serverLabelMobile: {
    color: color.dimSilver,
    fontFamily: font.medium,
    fontSize: 12,
    lineHeight: 14,
    marginTop: -3,
  },
  serverLabelTv: {
    color: color.dimSilver,
    fontFamily: font.medium,
    fontSize: 18,
    lineHeight: 21,
    marginTop: -2,
  },
  libraryHeader: {backgroundColor: color.projector, zIndex: 2},
  tabsViewportMobile: {flexGrow: 0, height: 49},
  virtualizedListHeader: {height: 0},
  tabsViewportTv: {flexGrow: 0, height: 68},
  toolbar: {
    alignItems: 'center',
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginBottom: 10,
    marginTop: 8,
  },
  toolbarTv: {marginBottom: 26, marginTop: 22},
  toolbarViewport: {flex: 1},
  toolbarScroll: {gap: 6, paddingRight: 8},
  toolbarScrollTv: {gap: 12, paddingRight: 18},
  resultCountMobile: {
    color: color.dimSilver,
    flexShrink: 0,
    fontFamily: font.medium,
    fontSize: 12,
    lineHeight: 16,
    marginLeft: 6,
  },
  resultCountTv: {
    color: color.dimSilver,
    fontFamily: font.medium,
    fontSize: 18,
    lineHeight: 24,
  },
  tvGridFrame: {flex: 1, position: 'relative'},
  alphabetIndexRail: {
    alignItems: 'center',
    backgroundColor: color.scrim,
    borderColor: color.lineSoft,
    borderRadius: 8,
    borderWidth: 1,
    gap: 1,
    paddingHorizontal: 7,
    paddingVertical: 8,
    position: 'absolute',
    right: 18,
    top: 286,
  },
  alphabetIndexLetter: {
    color: color.dimSilver,
    fontFamily: font.demi,
    fontSize: 11,
    lineHeight: 14,
    opacity: 0.62,
  },
  sectionTitleMobile: {
    color: color.silver,
    fontFamily: font.demi,
    fontSize: 20,
    lineHeight: 25,
  },
  sectionTitleTv: {
    color: color.silver,
    fontFamily: font.demi,
    fontSize: 29,
    lineHeight: 36,
  },
  facetGroup: {marginBottom: 28},
  facetGroupTv: {marginBottom: 42},
  facetRow: {gap: 8, paddingRight: 16, paddingTop: 10},
  facetRowTv: {gap: 16, paddingRight: 72, paddingTop: 16},
  facetCard: {
    backgroundColor: color.recess,
    borderColor: color.lineSoft,
    borderRadius: 8,
    borderWidth: 2,
    minHeight: 108,
    padding: 14,
    width: 168,
  },
  facetCardTv: {borderRadius: 10, minHeight: 150, padding: 20, width: 250},
  specialCardFocused: {
    backgroundColor: color.raisedSlate,
    borderColor: color.focus,
  },
  specialCardPressed: {backgroundColor: color.brightSlate},
  specialTitleMobile: {
    color: color.silver,
    fontFamily: font.demi,
    fontSize: 16,
    lineHeight: 20,
  },
  specialTitleTv: {
    color: color.silver,
    fontFamily: font.demi,
    fontSize: 24,
    lineHeight: 30,
  },
  specialMetaMobile: {
    color: color.dimSilver,
    fontFamily: font.medium,
    fontSize: 12,
    lineHeight: 17,
    marginTop: 5,
  },
  specialMetaTv: {
    color: color.dimSilver,
    fontFamily: font.medium,
    fontSize: 18,
    lineHeight: 24,
    marginTop: 7,
  },
  specialSummaryMobile: {
    color: color.softSilver,
    fontFamily: font.regular,
    fontSize: 13,
    lineHeight: 18,
    marginTop: 7,
  },
  specialSummaryTv: {
    color: color.softSilver,
    fontFamily: font.regular,
    fontSize: 18,
    lineHeight: 26,
    marginTop: 9,
  },
  resourceGridTv: {gap: 18},
  resourceCard: {
    backgroundColor: color.recess,
    borderColor: color.lineSoft,
    borderRadius: 8,
    borderWidth: 2,
    minHeight: 140,
    padding: 16,
    width: '48%',
  },
  resourceCardTv: {borderRadius: 10, minHeight: 190, padding: 22, width: '31%'},
  scheduleSeparatorTv: {height: 12},
  pagination: {alignItems: 'flex-start', gap: 10, marginTop: 20},
  paginationTv: {gap: 14, marginTop: 30},
  scheduleRow: {
    alignItems: 'center',
    backgroundColor: color.recess,
    borderBottomColor: color.lineSoft,
    borderBottomWidth: 1,
    flexDirection: 'row',
    gap: 12,
    minHeight: 106,
    padding: 14,
  },
  scheduleRowTv: {gap: 20, minHeight: 148, padding: 20},
  scheduleCopy: {flex: 1},
  scheduleStatusMobile: {
    color: color.screenBlueStrong,
    fontFamily: font.demi,
    fontSize: 12,
    textTransform: 'capitalize',
  },
  scheduleStatusTv: {
    color: color.screenBlueStrong,
    fontFamily: font.demi,
    fontSize: 18,
    textTransform: 'capitalize',
  },
  scheduleFailed: {color: color.record},
});
