import React, {useEffect, useMemo, useRef, useState} from 'react';
import {
  ActivityIndicator,
  FlatList,
  Image,
  ScrollView,
  SectionList,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import {PorticoIcon} from '@portico-react-native/icons';
import {useQuery} from '@tanstack/react-query';
import {
  productErrorMessageId,
  serverImageSource,
  usePorticoAuth,
} from '@portico-react-native/infrastructure';
import type {SearchRequest} from '@portico/client-core';
import type {PrototypePlatform} from '../../ui-compat/contract';
import {
  hasSearchResults,
  personMediaViewModels,
  searchGroupViewModels,
  type MediaViewModel,
  type SearchGroupViewModel,
} from '../../data';
import {color, font, mobileType, tvType} from '../tokens';
import {
  ControlButton,
  EmptyState,
  Focusable,
  IconButton,
  InlineNotice,
  ProductEmptyState,
  useContentFocus,
} from '../primitives';
import {HeaderUtilities} from '../sharedComponents';
import {usePrototypeUi} from '../uiState';
import {usePorticoNavigationActions} from '../navigation';
import {
  MobileChromeScaffold,
  mobileChromeScope,
  useMobileChromeScroll,
} from '../shells';
import {productText, productTitle} from '../productCopy';
import {useSearchRouteQuery} from './searchRouteQuery';

export function SearchScreen({
  initialQuery,
  platform,
}: {
  initialQuery?: string;
  platform: PrototypePlatform;
}) {
  const television = platform === 'tv';
  const {openMediaDetail, openPerson, replaceSearchQuery} =
    usePorticoNavigationActions();
  const auth = usePorticoAuth();
  const client = auth.session!.client;
  const {searchQuery, setSearchQuery} = usePrototypeUi();
  const onContentFocus = useContentFocus();
  const [searchFocused, setSearchFocused] = useState(false);
  const [debouncedQuery, setDebouncedQuery] = useState(searchQuery.trim());
  const [visibleGroups, setVisibleGroups] = useState<SearchGroupViewModel[]>(
    [],
  );
  const [loadingGroup, setLoadingGroup] = useState<string>();
  const [moreError, setMoreError] = useState<{
    groupId: string;
    message: string;
  }>();
  const [selectedGroup, setSelectedGroup] = useState<SearchRequest['group']>();
  const [sort, setSort] =
    useState<NonNullable<SearchRequest['sort']>>('relevance');
  const [submittedQuery, setSubmittedQuery] = useState('');
  const paginationRequest = useRef<
    {abort: AbortController; generation: number} | undefined
  >(undefined);
  const searchInputRef = useRef<TextInput>(null);
  const searchGeneration = useRef(0);
  const {onScroll, scrollY} = useMobileChromeScroll(
    mobileChromeScope(
      'search',
      auth.session?.serverId,
      auth.session?.viewerScope.profileId,
      {
        pivot: selectedGroup,
        query: debouncedQuery,
        sort,
        submittedQuery,
      },
    ),
  );
  useEffect(() => {
    const timer = setTimeout(() => setDebouncedQuery(searchQuery.trim()), 300);
    return () => clearTimeout(timer);
  }, [searchQuery]);
  useSearchRouteQuery(initialQuery, {
    setSearchQuery,
    setDebouncedQuery,
    setSubmittedQuery,
  });
  const query = useQuery({
    queryKey: ['search', debouncedQuery, selectedGroup, sort, submittedQuery],
    enabled: debouncedQuery.length >= 2,
    queryFn: ({signal}) =>
      client.search(
        {
          query: debouncedQuery,
          group: selectedGroup,
          sort,
          limit: 12,
          recordHistory: submittedQuery === debouncedQuery,
        },
        {signal},
      ),
  });
  const history = useQuery({
    queryKey: ['search-history'],
    queryFn: ({signal}) => client.searchHistory({signal}),
  });
  const groups = useMemo(
    () => (query.data ? searchGroupViewModels(query.data, client) : []),
    [client, query.data],
  );
  const waitingForDebounce = searchQuery.trim() !== debouncedQuery;
  const showResults =
    !waitingForDebounce &&
    !query.isLoading &&
    !query.error &&
    hasSearchResults(visibleGroups);
  useEffect(() => {
    searchGeneration.current += 1;
    paginationRequest.current?.abort.abort();
    paginationRequest.current = undefined;
    setLoadingGroup(undefined);
    setMoreError(undefined);
    return () => paginationRequest.current?.abort.abort();
  }, [debouncedQuery, selectedGroup, sort, submittedQuery]);
  useEffect(() => {
    setVisibleGroups(groups);
    setMoreError(undefined);
  }, [groups]);
  const loadMore = async (resultGroup: SearchGroupViewModel) => {
    if (!resultGroup.nextCursor || loadingGroup) return;
    const generation = searchGeneration.current;
    const abort = new AbortController();
    paginationRequest.current?.abort.abort();
    paginationRequest.current = {abort, generation};
    setLoadingGroup(resultGroup.id);
    setMoreError(undefined);
    try {
      const response = await client.search(
        {
          query: debouncedQuery,
          group: resultGroup.id as NonNullable<SearchRequest['group']>,
          sort,
          cursor: resultGroup.nextCursor,
          limit: 12,
        },
        {signal: abort.signal},
      );
      if (abort.signal.aborted || generation !== searchGeneration.current)
        return;
      const next = searchGroupViewModels(response, client).find(
        candidate => candidate.id === resultGroup.id,
      );
      setVisibleGroups(current =>
        current.map(candidate => {
          if (candidate.id !== resultGroup.id) return candidate;
          if (!next)
            return {...candidate, hasMore: false, nextCursor: undefined};
          const known = new Set(candidate.items.map(item => item.id));
          return {
            ...next,
            items: [
              ...candidate.items,
              ...next.items.filter(item => !known.has(item.id)),
            ],
          };
        }),
      );
    } catch (cause) {
      if (abort.signal.aborted || generation !== searchGeneration.current)
        return;
      setMoreError({
        groupId: resultGroup.id,
        message: productErrorMessageId(cause, 'search.more-failed'),
      });
    } finally {
      if (paginationRequest.current?.abort === abort)
        paginationRequest.current = undefined;
      if (generation === searchGeneration.current) setLoadingGroup(undefined);
    }
  };
  const openResult = (item: MediaViewModel) =>
    item.kind === 'person' ? openPerson(item.id) : openMediaDetail(item);
  const clearHistory = async (value?: string) => {
    await client.clearSearchHistory(value);
    await history.refetch();
  };

  const searchField = (
    <View
      style={[
        styles.searchField,
        television && styles.searchFieldTv,
        searchFocused && styles.searchFieldFocused,
      ]}
    >
      <PorticoIcon color={color.dimSilver} id="navigation.search" size={television ? 30 : 21} />
      <TextInput
        accessibilityLabel="Search all media"
        autoCapitalize="none"
        autoCorrect={false}
        onChangeText={setSearchQuery}
        onBlur={() => setSearchFocused(false)}
        onFocus={() => {
          setSearchFocused(true);
          if (television) onContentFocus();
        }}
        placeholder="Movies, shows, people, music, and channels"
        placeholderTextColor={color.mutedSilver}
        ref={searchInputRef}
        returnKeyType="search"
        onSubmitEditing={() => {
          const value = searchQuery.trim();
          setSubmittedQuery(value);
          setDebouncedQuery(value);
          if (!television) replaceSearchQuery(value || undefined);
        }}
        selectionColor={color.screenBlue}
        style={television ? styles.searchInputTv : styles.searchInputMobile}
        value={searchQuery}
      />
      {searchQuery ? (
        <IconButton
          icon="action.clear"
          label={productText('action.clear-search')}
          onPress={() => {
            setSearchQuery('');
            if (!television) replaceSearchQuery(undefined);
          }}
          platform={platform}
        />
      ) : null}
    </View>
  );
  const searchFilters = (
    <ScrollView
      contentContainerStyle={styles.filterRow}
      horizontal
      showsHorizontalScrollIndicator={false}
    >
      {SEARCH_GROUPS.map(option => (
        <ControlButton
          compact={television}
          dense={!television}
          key={option.label}
          label={option.label}
          onPress={() => setSelectedGroup(option.value)}
          platform={platform}
          selected={selectedGroup === option.value}
        />
      ))}
      {!television ? <View style={styles.filterDivider} /> : null}
      {!television
        ? SEARCH_SORTS.map(option => (
            <ControlButton
              dense
              key={option.value}
              label={`Sort: ${option.label}`}
              onPress={() => setSort(option.value)}
              platform={platform}
              selected={sort === option.value}
            />
          ))
        : null}
    </ScrollView>
  );
  const body = (
    <>
      {television ? (
        <HeaderUtilities
          flush
          leftContent={
            <View style={styles.headingLeft}>
              <Text style={[tvType.title, styles.title]}>
                {productTitle('search.page')}
              </Text>
            </View>
          }
          platform={platform}
        />
      ) : null}
      {searchQuery.trim().length < 2 ? (
        history.data?.items.length ? (
          <View style={styles.historySection}>
            <View style={styles.historyHeading}>
              <Text
                style={[
                  television ? tvType.section : mobileType.section,
                  styles.groupTitle,
                ]}
              >
                {productText('preferences.recent-searches-title')}
              </Text>
              <ControlButton
                compact
                icon="action.delete"
                label={productText('action.clear-history')}
                onPress={() => void clearHistory()}
                platform={platform}
              />
            </View>
            {history.data.items.map(item => (
              <View key={item.query} style={styles.historyRow}>
                <ControlButton
                  icon="metadata.time"
                  label={item.query}
                  onPress={() => {
                    setSearchQuery(item.query);
                    setSubmittedQuery(item.query);
                  }}
                  platform={platform}
                />
                <IconButton
                  icon="action.remove"
                  label={`Remove ${item.query}`}
                  onPress={() => void clearHistory(item.query)}
                  platform={platform}
                />
              </View>
            ))}
          </View>
        ) : (
          <EmptyState
            message="Enter at least two characters to search movies, shows, episodes, people, music, audiobooks, and live TV on this server."
            platform={platform}
            title="Search your media"
          />
        )
      ) : waitingForDebounce || query.isLoading ? (
        <ProductEmptyState id="search.loading" platform={platform} />
      ) : query.error ? (
        <ProductEmptyState
          id="search.load-failed"
          onAction={() => void query.refetch()}
          platform={platform}
        />
      ) : showResults ? (
        <View>
          <Text
            style={[
              television ? tvType.section : mobileType.section,
              styles.resultsTitle,
            ]}
          >
            Results for “{debouncedQuery}”
          </Text>
          {visibleGroups.map(group => (
            <View key={group.id} style={styles.resultGroup}>
              <Text
                style={[
                  television ? tvType.section : mobileType.section,
                  styles.groupTitle,
                ]}
              >
                {group.title}
              </Text>
              <View style={[styles.results, television && styles.resultsTv]}>
                {group.items.map(item => (
                  <SearchResult
                    item={item}
                    key={item.id}
                    onPress={() => openResult(item)}
                    platform={platform}
                  />
                ))}
              </View>
              {moreError?.groupId === group.id ? (
                <InlineNotice
                  actionLabel={productText('action.retry')}
                  kind="error"
                  message={moreError.message}
                  onAction={() => void loadMore(group)}
                  platform={platform}
                />
              ) : null}
              {group.hasMore && group.nextCursor ? (
                <View style={styles.moreResults}>
                  <ControlButton
                    compact
                    label={
                      loadingGroup === group.id
                        ? 'Loading…'
                        : productText('action.load-more-group', {
                            group: group.title.toLowerCase(),
                          })
                    }
                    onPress={() => void loadMore(group)}
                    platform={platform}
                  />
                </View>
              ) : null}
            </View>
          ))}
        </View>
      ) : (
        <ProductEmptyState id="search.no-results" platform={platform} />
      )}
    </>
  );
  const mobileSections: Array<{
    data: MediaViewModel[];
    group: SearchGroupViewModel;
    title: string;
  }> = showResults
    ? visibleGroups.map(group => ({
        data: group.items,
        group,
        title: group.title,
      }))
    : [];
  const mobileSearchHeader =
    searchQuery.trim().length < 2 ? (
      history.data?.items.length ? (
        <View style={styles.historySection}>
          <View style={styles.historyHeading}>
            <Text style={[mobileType.section, styles.groupTitle]}>
              {productText('preferences.recent-searches-title')}
            </Text>
            <ControlButton
              compact
              icon="action.delete"
              label={productText('action.clear-history')}
              onPress={() => void clearHistory()}
              platform="mobile"
            />
          </View>
          {history.data.items.map(item => (
            <View key={item.query} style={styles.historyRow}>
              <ControlButton
                icon="metadata.time"
                label={item.query}
                onPress={() => {
                  setSearchQuery(item.query);
                  setSubmittedQuery(item.query);
                }}
                platform="mobile"
              />
              <IconButton
                icon="action.remove"
                label={`Remove ${item.query}`}
                onPress={() => void clearHistory(item.query)}
                platform="mobile"
              />
            </View>
          ))}
        </View>
      ) : (
        <EmptyState
          message="Enter at least two characters to search movies, shows, episodes, people, music, audiobooks, and live TV on this server."
          platform="mobile"
          title="Search your media"
        />
      )
    ) : waitingForDebounce || query.isLoading ? (
      <ProductEmptyState id="search.loading" platform="mobile" />
    ) : query.error ? (
      <ProductEmptyState
        id="search.load-failed"
        onAction={() => void query.refetch()}
        platform="mobile"
      />
    ) : !hasSearchResults(visibleGroups) ? (
      <ProductEmptyState id="search.no-results" platform="mobile" />
    ) : null;
  const mobile = (
    <MobileChromeScaffold
      controlRows={2}
      controls={
        <>
          {searchField}
          {searchFilters}
        </>
      }
      header={
        <HeaderUtilities
          flush
          onSearch={() => searchInputRef.current?.focus()}
          platform="mobile"
          showProfile
          title="Search"
        />
      }
      scrollY={scrollY}
      testID="portico-mobile-search-chrome"
    >
      <SectionList
        automaticallyAdjustKeyboardInsets
        contentContainerStyle={styles.page}
        keyboardDismissMode="interactive"
        keyboardShouldPersistTaps="handled"
        keyExtractor={item => item.id}
        ListHeaderComponent={
          showResults ? (
            <Text style={[mobileType.section, styles.resultsTitle]}>
              Results for “{debouncedQuery}”
            </Text>
          ) : (
            mobileSearchHeader
          )
        }
        onScroll={onScroll}
        renderItem={({item}) => (
          <SearchResult
            item={item}
            onPress={() => openResult(item)}
            platform="mobile"
          />
        )}
        renderSectionFooter={({section}) => (
          <>
            {moreError?.groupId === section.group.id ? (
              <InlineNotice
                actionLabel={productText('action.retry')}
                kind="error"
                message={moreError.message}
                onAction={() => void loadMore(section.group)}
                platform="mobile"
              />
            ) : null}
            {section.group.hasMore && section.group.nextCursor ? (
              <View style={styles.moreResults}>
                <ControlButton
                  compact
                  label={
                    loadingGroup === section.group.id
                      ? 'Loading…'
                      : productText('action.load-more-group', {
                          group: section.group.title.toLowerCase(),
                        })
                  }
                  onPress={() => void loadMore(section.group)}
                  platform="mobile"
                />
              </View>
            ) : null}
          </>
        )}
        renderSectionHeader={({section}) => (
          <Text style={[mobileType.section, styles.groupTitle]}>
            {section.title}
          </Text>
        )}
        sections={mobileSections}
        showsVerticalScrollIndicator={false}
        stickySectionHeadersEnabled={false}
        testID="portico-four-search-mobile"
      />
    </MobileChromeScaffold>
  );
  return television ? (
    <ScrollView
      contentContainerStyle={[styles.page, styles.pageTv]}
      keyboardShouldPersistTaps="handled"
      showsVerticalScrollIndicator={false}
      testID="portico-four-search-tv"
    >
      {searchField}
      {searchFilters}
      {body}
    </ScrollView>
  ) : (
    mobile
  );
}

const SEARCH_GROUPS: Array<{label: string; value: SearchRequest['group']}> = [
  {label: productText('library.filter-match-all'), value: undefined},
  {label: productText('destination.movies'), value: 'movies'},
  {label: 'Shows', value: 'shows'},
  {label: productText('media.episodes-title'), value: 'episodes'},
  {label: 'People', value: 'people'},
  {label: productText('destination.music'), value: 'music'},
  {label: productText('destination.audiobooks'), value: 'audiobooks'},
  {label: productText('destination.live-tv'), value: 'live-tv'},
];
const SEARCH_SORTS: Array<{
  label: string;
  value: NonNullable<SearchRequest['sort']>;
}> = [
  {label: 'Relevant', value: 'relevance'},
  {label: productText('library.column-title'), value: 'title'},
  {label: 'Release year', value: 'releaseYear'},
  {label: 'Date added', value: 'dateAdded'},
];

export function PersonScreen({
  personId,
  platform,
}: {
  personId: string;
  platform: PrototypePlatform;
}) {
  const television = platform === 'tv';
  const auth = usePorticoAuth();
  const client = auth.session!.client;
  const {back, openMediaDetail} = usePorticoNavigationActions();
  const {onScroll, scrollY} = useMobileChromeScroll(
    mobileChromeScope(
      'person',
      auth.session?.serverId,
      auth.session?.viewerScope.profileId,
      personId,
    ),
  );
  const query = useQuery({
    queryKey: ['person', personId],
    queryFn: ({signal}) => client.person(personId, {limit: 50}, {signal}),
  });
  const mobileChrome = query.data ? (
    <HeaderUtilities
      flush
      leftContent={
        <View style={styles.headingLeft}>
          <IconButton
            icon="navigation.back"
            label={productText('action.back')}
            onPress={back}
            platform="mobile"
          />
          <View>
            <Text numberOfLines={1} style={[mobileType.title, styles.title]}>
              {query.data.person.name}
            </Text>
            <Text numberOfLines={1} style={styles.personRolesMobile}>
              {query.data.person.roles.join(' · ')}
            </Text>
          </View>
        </View>
      }
      platform="mobile"
      showProfile={false}
    />
  ) : (
    <HeaderUtilities
      flush
      leftContent={
        <View style={styles.headingLeft}>
          <IconButton
            icon="navigation.back"
            label={productText('action.back')}
            onPress={back}
            platform="mobile"
          />
          <Text style={[mobileType.title, styles.title]}>Person</Text>
        </View>
      }
      platform="mobile"
      showProfile={false}
    />
  );
  if (query.isLoading)
    return television ? (
      <View style={styles.personLoading}>
        <ActivityIndicator color={color.screenBlueStrong} size="large" />
      </View>
    ) : (
      <MobileChromeScaffold
        header={mobileChrome}
        scrollY={scrollY}
        testID="portico-mobile-person-chrome"
      >
        <ScrollView
          contentContainerStyle={styles.page}
          onScroll={onScroll}
          scrollEventThrottle={16}
          showsVerticalScrollIndicator={false}
        >
          <View style={styles.personLoading}>
            <ActivityIndicator color={color.screenBlueStrong} size="large" />
          </View>
        </ScrollView>
      </MobileChromeScaffold>
    );
  if (!query.data) {
    const error = (
      <EmptyState
        actionLabel={productText('action.retry')}
        message={productErrorMessageId(query.error, 'search.load-failed')}
        onAction={() => void query.refetch()}
        platform={platform}
        title="Person couldn’t load"
      />
    );
    return television ? (
      error
    ) : (
      <MobileChromeScaffold
        header={mobileChrome}
        scrollY={scrollY}
        testID="portico-mobile-person-chrome"
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
  const items = personMediaViewModels(query.data.credits, client);
  const content = (
    <>
      {television ? (
        <HeaderUtilities
          flush
          leftContent={
            <View style={styles.headingLeft}>
              <View>
                <Text style={[tvType.title, styles.title]}>
                  {query.data.person.name}
                </Text>
                <Text style={styles.personRolesTv}>
                  {query.data.person.roles.join(' · ')}
                </Text>
              </View>
            </View>
          }
          platform={platform}
        />
      ) : null}
      {items.length ? (
        <View style={[styles.results, television && styles.resultsTv]}>
          {items.map(item => (
            <SearchResult
              item={item}
              key={item.id}
              onPress={() => openMediaDetail(item)}
              platform={platform}
            />
          ))}
        </View>
      ) : (
        <EmptyState
          message="No accessible titles were found for this person."
          platform={platform}
          title="No titles found"
        />
      )}
    </>
  );
  if (television)
    return (
      <ScrollView
        contentContainerStyle={[styles.page, styles.pageTv]}
        showsVerticalScrollIndicator={false}
        testID={`portico-person-${personId}`}
      >
        {content}
      </ScrollView>
    );
  return (
    <MobileChromeScaffold
      header={mobileChrome}
      scrollY={scrollY}
      testID="portico-mobile-person-chrome"
    >
      <FlatList
        contentContainerStyle={styles.page}
        data={items}
        keyExtractor={item => item.id}
        ListEmptyComponent={
          <EmptyState
            message="No accessible titles were found for this person."
            platform="mobile"
            title="No titles found"
          />
        }
        onScroll={onScroll}
        renderItem={({item}) => (
          <SearchResult
            item={item}
            onPress={() => openMediaDetail(item)}
            platform="mobile"
          />
        )}
        scrollEventThrottle={16}
        showsVerticalScrollIndicator={false}
        testID={`portico-person-${personId}`}
      />
    </MobileChromeScaffold>
  );
}

function SearchResult({
  item,
  onPress,
  platform,
}: {
  item: MediaViewModel;
  onPress(): void;
  platform: PrototypePlatform;
}) {
  const television = platform === 'tv';
  return (
    <Focusable
      accessibilityLabel={`${item.title}. ${item.kind}.`}
      accessibilityRole="button"
      onPress={onPress}
      platform={platform}
      style={[styles.result, television && styles.resultTv]}
      focusedStyle={styles.resultFocused}
      pressedStyle={styles.resultPressed}
    >
      <Image
        resizeMode="cover"
        source={serverImageSource(item.poster)}
        style={television ? styles.resultImageTv : styles.resultImageMobile}
      />
      <View style={styles.resultCopy}>
        <Text
          numberOfLines={1}
          style={television ? styles.resultTitleTv : styles.resultTitleMobile}
        >
          {item.title}
        </Text>
        <Text
          numberOfLines={1}
          style={television ? styles.resultMetaTv : styles.resultMetaMobile}
        >
          {[item.year, item.kind, item.duration, item.parentTitle]
            .filter(Boolean)
            .join('  ·  ')}
        </Text>
        {item.summary ? (
          <Text
            numberOfLines={television ? 2 : 3}
            style={
              television ? styles.resultSummaryTv : styles.resultSummaryMobile
            }
          >
            {item.summary}
          </Text>
        ) : null}
      </View>
    </Focusable>
  );
}

const styles = StyleSheet.create({
  page: {
    backgroundColor: color.projector,
    minHeight: '100%',
    paddingBottom: 100,
    paddingHorizontal: 16,
    paddingTop: 10,
  },
  pageTv: {paddingBottom: 80, paddingLeft: 0, paddingRight: 72, paddingTop: 12},
  headingLeft: {alignItems: 'center', flex: 1, flexDirection: 'row', gap: 12},
  title: {color: color.silver},
  searchField: {
    alignItems: 'center',
    backgroundColor: color.slate,
    borderColor: color.line,
    borderRadius: 8,
    borderWidth: 2,
    flexDirection: 'row',
    gap: 8,
    minHeight: 44,
    paddingLeft: 12,
    paddingRight: 2,
  },
  searchFieldTv: {gap: 14, minHeight: 68, maxWidth: 1200, paddingLeft: 20},
  searchFieldFocused: {borderColor: color.focus, borderWidth: 2},
  searchInputMobile: {
    color: color.silver,
    flex: 1,
    fontFamily: font.regular,
    fontSize: 15,
    height: 42,
    paddingVertical: 0,
  },
  searchInputTv: {
    color: color.silver,
    flex: 1,
    fontFamily: font.regular,
    fontSize: 24,
    height: 66,
    paddingVertical: 0,
  },
  resultsTitle: {color: color.silver, marginBottom: 14, marginTop: 28},
  filterRow: {alignItems: 'center', gap: 6, paddingRight: 12, paddingTop: 7},
  filterDivider: {
    backgroundColor: color.lineStrong,
    height: 22,
    marginHorizontal: 2,
    width: 1,
  },
  historySection: {marginTop: 28},
  historyHeading: {
    alignItems: 'center',
    flexDirection: 'row',
    justifyContent: 'space-between',
  },
  historyRow: {
    alignItems: 'center',
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginBottom: 5,
  },
  personLoading: {
    alignItems: 'center',
    backgroundColor: color.projector,
    flex: 1,
    justifyContent: 'center',
  },
  personMobileHeading: {marginBottom: 18},
  personRolesMobile: {
    color: color.dimSilver,
    fontFamily: font.medium,
    fontSize: 13,
    marginTop: 3,
  },
  personRolesTv: {
    color: color.dimSilver,
    fontFamily: font.medium,
    fontSize: 19,
    marginTop: 5,
  },
  resultGroup: {marginBottom: 28},
  moreResults: {alignSelf: 'flex-start', marginTop: 12},
  groupTitle: {color: color.silver, marginBottom: 14},
  results: {gap: 6},
  resultsTv: {
    columnGap: 12,
    flexDirection: 'row',
    flexWrap: 'wrap',
    rowGap: 12,
  },
  result: {
    alignItems: 'center',
    backgroundColor: color.recess,
    borderColor: color.transparent,
    borderRadius: 8,
    borderWidth: 3,
    flexDirection: 'row',
    gap: 12,
    minHeight: 126,
    padding: 8,
  },
  resultTv: {gap: 18, minHeight: 174, padding: 10, width: '49.4%'},
  resultFocused: {backgroundColor: color.raisedSlate, borderColor: color.focus},
  resultPressed: {backgroundColor: color.brightSlate},
  resultImageMobile: {borderRadius: 5, height: 106, width: 71},
  resultImageTv: {borderRadius: 6, height: 150, width: 100},
  resultCopy: {flex: 1},
  resultTitleMobile: {
    color: color.silver,
    fontFamily: font.demi,
    fontSize: 16,
    lineHeight: 21,
  },
  resultTitleTv: {
    color: color.silver,
    fontFamily: font.demi,
    fontSize: 24,
    lineHeight: 30,
  },
  resultMetaMobile: {
    color: color.screenBlue,
    fontFamily: font.medium,
    fontSize: 12,
    lineHeight: 17,
    marginTop: 2,
  },
  resultMetaTv: {
    color: color.screenBlue,
    fontFamily: font.medium,
    fontSize: 18,
    lineHeight: 24,
    marginTop: 3,
  },
  resultSummaryMobile: {
    color: color.dimSilver,
    fontFamily: font.regular,
    fontSize: 13,
    lineHeight: 18,
    marginTop: 5,
  },
  resultSummaryTv: {
    color: color.dimSilver,
    fontFamily: font.regular,
    fontSize: 19,
    lineHeight: 26,
    marginTop: 7,
  },
});
