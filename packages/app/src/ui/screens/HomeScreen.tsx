import React, {useCallback, useEffect, useMemo, useRef, useState} from 'react';
import {
  ImageBackground,
  Modal,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import {
  reserveOrderedSurfaceSlots,
  resolveReservedSurfaceSlot,
  type PorticoClient,
} from '@portico/client-core';
import {
  useMutation,
  useQueries,
  useQuery,
  useQueryClient,
} from '@tanstack/react-query';
import {
  productErrorMessageId,
  serverImageSource,
  updatePorticoTopShelf,
  usePorticoAuth,
  usePorticoViewerPreferences,
  useViewerRuntime,
} from '@portico-react-native/infrastructure';
import type {PrototypePlatform} from '../../ui-compat/contract';
import {
  homeRowViewModel,
  homeViewModel,
  mergeUniqueById,
  type HomeRowViewModel,
  type MediaViewModel,
} from '../../data';
import {color, font} from '../tokens';
import {
  AmbientArtworkGlow,
  ArtworkScrim,
  EmptyState,
  HeroPlayButton,
  IconButton,
  InlineNotice,
  ProductEmptyState,
  ControlButton,
  Skeleton,
  TVModalFocusTrap,
  useTVModalFocusRestoration,
} from '../primitives';
import {MediaRow} from '../sharedComponents';
import {usePrototypeUi} from '../uiState';
import {usePorticoNavigationActions} from '../navigation';
import {productText} from '../productCopy';
import {
  TvSafeContent,
  mobileScrollOffset,
  useMobileHomeScroll,
} from '../shells';
import {useMobileChromeMetrics} from '../mobileChromeMetrics';
import {useModalAnimationType} from '../useReducedMotion';
import {useRevisionFencedMutation} from '../useRevisionFencedMutation';

type HeroMutation =
  | {kind: 'favorite'; item: MediaViewModel}
  | {kind: 'watchlist'; item: MediaViewModel};

export function HomeScreen({platform}: {platform: PrototypePlatform}) {
  const television = platform === 'tv';
  const {openMediaDetail, openPlayableMedia} = usePorticoNavigationActions();
  const client = usePorticoAuth().session!.client;
  const viewerRuntime = useViewerRuntime();
  const viewerPreferences = usePorticoViewerPreferences();
  const queryClient = useQueryClient();
  const {heroIndex, setHeroIndex} = usePrototypeUi();
  const [focusedTVHero, setFocusedTVHero] = useState<MediaViewModel>();
  const [mutationError, setMutationError] = useState<string>();
  const [customizing, setCustomizing] = useState(false);
  const openCustomization = useCallback(() => setCustomizing(true), []);
  const {onScroll, scrollY} = useMobileHomeScroll();
  const {primaryHeaderBottom} = useMobileChromeMetrics();
  // The approved tvOS interaction contract gives Home one intentional initial
  // focus target. Clear the preference as soon as the player action receives
  // focus so returning to this persistent route never snaps focus back to it.
  const [requestInitialTVFocus, setRequestInitialTVFocus] =
    useState(television);
  const query = useQuery({
    queryKey: ['home'],
    queryFn: ({signal}) => client.home({signal}),
  });
  const advertisedHome = query.data
    ? homeViewModel(query.data, client, {
        rowOrder: viewerPreferences.values.homeRowOrder ?? [],
        hiddenRowIds: viewerPreferences.values.hiddenHomeRowIds ?? [],
      })
    : undefined;
  const advertisedRows = advertisedHome?.rows ?? [];
  const rowQueries = useQueries({
    queries: advertisedRows.map(row => ({
      enabled: row.items.length === 0 && Boolean(row.endpoint),
      queryKey: ['home-row', row.id],
      queryFn: ({signal}: {signal: AbortSignal}) =>
        client.homeRow(row.id, {limit: 24}, {signal}),
      staleTime: 30_000,
    })),
  });
  let homeSlots = reserveOrderedSurfaceSlots<
    HomeRowViewModel,
    HomeRowViewModel
  >(advertisedRows, row => row.id);
  for (let index = 0; index < homeSlots.length; index += 1) {
    const row = advertisedRows[index]!;
    const rowQuery = rowQueries[index];
    if (row.items.length > 0) {
      homeSlots = resolveReservedSurfaceSlot(homeSlots, row.id, 'ready', row);
      continue;
    }
    if (rowQuery?.data) {
      const resolved = homeRowViewModel(rowQuery.data, client);
      homeSlots = resolveReservedSurfaceSlot(
        homeSlots,
        row.id,
        resolved.items.length > 0 ? 'ready' : 'empty',
        resolved.items.length > 0 ? resolved : undefined,
      );
      continue;
    }
    if (rowQuery?.isError) {
      homeSlots = resolveReservedSurfaceSlot(homeSlots, row.id, 'failed');
      continue;
    }
    if (!row.endpoint) {
      homeSlots = resolveReservedSurfaceSlot(homeSlots, row.id, 'empty');
    }
  }
  const resolvedRows = homeSlots.flatMap(slot =>
    slot.resolution === 'ready' && slot.data ? [slot.data] : [],
  );
  const resolvedContinueWatchingRow = resolvedRows.find(
    row =>
      row.id === 'continue' ||
      row.kind === 'continue' ||
      row.kind === 'continue-watching' ||
      row.policyState === 'continue',
  );
  const mutation = useMutation({
    mutationFn: ({kind, item}: HeroMutation) =>
      viewerRuntime.runRequest(signal =>
        kind === 'watchlist'
          ? client.setWatchlist(item.id, !item.state.watchlisted, {signal})
          : client.setFavorite(item.id, !item.state.favorite, {signal}),
      ),
    onMutate: () => setMutationError(undefined),
    onSuccess: async (_result, variables) => {
      await Promise.all([
        queryClient.invalidateQueries({queryKey: ['home']}),
        queryClient.invalidateQueries({queryKey: ['home-row']}),
        queryClient.invalidateQueries({
          queryKey: [
            variables.kind === 'watchlist' ? 'watchlist' : 'favorites',
          ],
        }),
        queryClient.invalidateQueries({queryKey: ['media', variables.item.id]}),
      ]);
    },
    onError: cause =>
      setMutationError(
        productErrorMessageId(cause, 'catalog.action-failed', {
          actionName: 'save that change',
        }),
      ),
  });

  if (query.isLoading) {
    return <HomeLoading platform={platform} />;
  }
  if (!query.data) {
    return (
      <ProductEmptyState
        id="media.load-failed"
        onAction={() => void query.refetch()}
        platform={platform}
        variables={{featureName: 'Home'}}
      />
    );
  }

  const home = advertisedHome!;
  const selectedHeroIndex = television ? heroIndex : 0;
  const continueWatchingItems = resolvedContinueWatchingRow?.items ?? [];
  const hero = television
    ? (focusedTVHero ??
      continueWatchingItems[selectedHeroIndex] ??
      resolvedContinueWatchingRow?.items[0])
    : resolvedContinueWatchingRow?.items[0];

  if (home.rows.length === 0) {
    return (
      <EmptyState
        actionLabel="Refresh Home"
        message={productText('home.no-shared-libraries')}
        onAction={() => void query.refetch()}
        platform={platform}
        title={productText('home.building-title')}
      />
    );
  }

  const open = (item: MediaViewModel) => openMediaDetail(item);
  return (
    <ScrollView
      contentContainerStyle={styles.page}
      contentOffset={
        scrollY ? {x: 0, y: mobileScrollOffset(scrollY)} : undefined
      }
      onScroll={television ? undefined : onScroll}
      scrollEventThrottle={16}
      showsVerticalScrollIndicator={false}
      testID={`portico-four-home-${platform}`}
    >
      {television ? <TopShelfSync items={continueWatchingItems} /> : null}
      {hero ? (
        <View
          style={[styles.hero, television ? styles.heroTv : styles.heroMobile]}
        >
          <AmbientArtworkGlow platform={platform} />
          <ImageBackground
            resizeMode="cover"
            source={serverImageSource(hero.backdrop)}
            style={styles.heroArtwork}
          >
            <ArtworkScrim platform={platform} />
            <View
              style={[
                styles.heroInner,
                television ? styles.heroInnerTv : styles.heroInnerMobile,
              ]}
            >
              <TvSafeContent
                enabled={television}
                style={[
                  styles.heroCopy,
                  television ? styles.heroCopyTv : styles.heroCopyMobile,
                ]}
              >
                <Text
                  numberOfLines={2}
                  style={[
                    television ? styles.heroTitleTv : styles.heroTitleMobile,
                    styles.heroTitle,
                  ]}
                >
                  {hero.title}
                </Text>
                <Text
                  style={television ? styles.heroMetaTv : styles.heroMetaMobile}
                >
                  {[
                    canonicalMediaKindLabel(hero.kind),
                    hero.year,
                    hero.contentRating,
                    hero.duration,
                  ]
                    .filter(Boolean)
                    .join('  ·  ')}
                </Text>
                <Text
                  numberOfLines={television ? 2 : 3}
                  style={
                    television ? styles.heroSummaryTv : styles.heroSummaryMobile
                  }
                >
                  {hero.summary}
                </Text>
                <View
                  style={[
                    styles.heroActions,
                    television && styles.heroActionsTv,
                  ]}
                >
                  {hero.actions.includes('play') ||
                  hero.actions.includes('resume') ? (
                    <HeroPlayButton
                      label={
                        hero.actions.includes('resume') ? 'Resume' : 'Play'
                      }
                      onFocusChange={focused => {
                        if (focused && requestInitialTVFocus) {
                          setRequestInitialTVFocus(false);
                        }
                      }}
                      onPress={() => openPlayableMedia(hero)}
                      platform={platform}
                      requestInitialTVFocus={requestInitialTVFocus}
                      testID="portico-home-initial-focus"
                    />
                  ) : null}
                  {canChangeWatchlist(hero) ? (
                    <IconButton
                      icon="action.watchlist"
                      label={
                        hero.state.watchlisted
                          ? 'Remove from Saved'
                          : 'Add to Saved'
                      }
                      onPress={() => {
                        if (!mutation.isPending)
                          mutation.mutate({kind: 'watchlist', item: hero});
                      }}
                      platform={platform}
                      selected={hero.state.watchlisted}
                    />
                  ) : null}
                  <IconButton
                    icon="metadata.info"
                    label="Details"
                    onPress={() => openMediaDetail(hero)}
                    platform={platform}
                  />
                  {canChangeFavorite(hero) ? (
                    <IconButton
                      icon="action.favorite"
                      label={
                        hero.state.favorite ? 'Remove favorite' : 'Favorite'
                      }
                      onPress={() => {
                        if (!mutation.isPending)
                          mutation.mutate({kind: 'favorite', item: hero});
                      }}
                      platform={platform}
                      selected={hero.state.favorite}
                    />
                  ) : null}
                  {television ? (
                    <IconButton
                      icon="action.customize"
                      label={productText('home.customize-title')}
                      onPress={openCustomization}
                      platform={platform}
                    />
                  ) : null}
                </View>
              </TvSafeContent>
            </View>
          </ImageBackground>
        </View>
      ) : television ? (
        <View style={[styles.hero, styles.heroTv]}>
          <AmbientArtworkGlow platform={platform} />
          <TvSafeContent style={styles.heroEmptyCopyTv}>
            <Text style={styles.heroEmptyMessageTv}>
              You haven’t watched anything yet. What will you watch first?
            </Text>
          </TvSafeContent>
        </View>
      ) : null}

      <TvSafeContent
        enabled={television}
        style={
          !television && !hero
            ? {paddingTop: primaryHeaderBottom + 10}
            : undefined
        }
      >
        {mutationError ? (
          <View style={television ? styles.noticeTv : styles.noticeMobile}>
            <InlineNotice
              kind="error"
              message={mutationError}
              platform={platform}
            />
          </View>
        ) : null}

        {homeSlots.map((slot, index) =>
          slot.resolution === 'ready' && slot.data ? (
            <PagedHomeRow
              client={client}
              initialRow={slot.data}
              key={slot.id}
              onItemFocus={
                television && slot.id === resolvedContinueWatchingRow?.id
                  ? (item, focusedIndex) => {
                      setHeroIndex(focusedIndex);
                      setFocusedTVHero(item);
                    }
                  : undefined
              }
              onOpen={open}
              platform={platform}
            />
          ) : slot.resolution === 'failed' ? (
            <HomeRowState
              key={slot.id}
              message="This row could not be loaded."
              onRetry={() => void rowQueries[index]?.refetch()}
              platform={platform}
              title={advertisedRows[index]?.title ?? 'Home row'}
            />
          ) : null,
        )}
      </TvSafeContent>
      <HomeCustomizationSheet
        onClose={() => setCustomizing(false)}
        platform={platform}
        rows={query.data.rows}
        visible={customizing}
      />
    </ScrollView>
  );
}

function HomeRowState({
  message,
  onRetry,
  platform,
  title,
}: {
  message: string;
  onRetry?(): void;
  platform: PrototypePlatform;
  title: string;
}) {
  return (
    <View
      accessibilityRole={onRetry ? 'alert' : 'summary'}
      style={
        platform === 'tv' ? styles.homeRowStateTv : styles.homeRowStateMobile
      }
    >
      <Text
        style={
          platform === 'tv'
            ? styles.homeRowStateTitleTv
            : styles.homeRowStateTitleMobile
        }
      >
        {title}
      </Text>
      <Text
        style={
          platform === 'tv'
            ? styles.homeRowStateMessageTv
            : styles.homeRowStateMessageMobile
        }
      >
        {message}
      </Text>
      {onRetry ? (
        <ControlButton
          compact
          label="Retry"
          onPress={onRetry}
          platform={platform}
        />
      ) : null}
    </View>
  );
}

export function canonicalMediaKindLabel(kind: string): string {
  const normalized = kind.trim().toLocaleLowerCase().replaceAll('_', '-');
  return (
    (
      {
        movie: 'Movie',
        show: 'TV Show',
        season: 'Season',
        episode: 'Episode',
        special: 'Special',
        artist: 'Artist',
        album: 'Album',
        track: 'Track',
        author: 'Author',
        book: 'Audiobook',
        audiobook: 'Audiobook',
        'audiobook-series': 'Audiobook series',
        chapter: 'Chapter',
        'live-channel': 'Live channel',
        'live-program': 'Live programme',
        recording: 'DVR recording',
        collection: 'Collection',
        playlist: 'Playlist',
        person: 'Person',
      } as Record<string, string>
    )[normalized] ?? 'Media'
  );
}

function TopShelfSync({items}: {items: readonly MediaViewModel[]}) {
  const snapshotJSON = JSON.stringify(
    items.slice(0, 12).map(item => ({
      id: item.id,
      title: item.title,
      artwork: item.poster || item.backdrop,
      durationSeconds: item.durationSeconds,
      progressSeconds: item.state.progressSeconds,
    })),
  );
  useEffect(() => {
    const snapshot = (
      JSON.parse(snapshotJSON) as Array<{
        id: string;
        title: string;
        artwork?: string;
        durationSeconds?: number;
        progressSeconds: number;
      }>
    ).map(item => {
      const image = serverImageSource(item.artwork);
      return {
        id: item.id,
        title: item.title,
        imageURL: image?.uri,
        imageHeaders: image?.headers,
        progress:
          item.durationSeconds && item.progressSeconds > 0
            ? Math.min(1, item.progressSeconds / item.durationSeconds)
            : undefined,
      };
    });
    void updatePorticoTopShelf(snapshot);
  }, [snapshotJSON]);
  return null;
}

function HomeCustomizationSheet({
  onClose,
  platform,
  rows,
  visible,
}: {
  onClose(): void;
  platform: PrototypePlatform;
  rows: import('@portico/client-core').HomeRow[];
  visible: boolean;
}) {
  const television = platform === 'tv';
  const animationType = useModalAnimationType();
  const modalFocus = useTVModalFocusRestoration(television && visible);
  const preferences = usePorticoViewerPreferences();
  const serverOrder = useMemo(() => rows.map(row => row.id), [rows]);
  const savedOrder = preferences.values.homeRowOrder ?? [];
  const currentOrder = savedOrder.length
    ? [...savedOrder, ...serverOrder.filter(id => !savedOrder.includes(id))]
    : serverOrder;
  const hidden = new Set(preferences.values.hiddenHomeRowIds ?? []);
  const orderedRows = currentOrder
    .map(id => rows.find(row => row.id === id))
    .filter((row): row is import('@portico/client-core').HomeRow =>
      Boolean(row),
    );
  const saveMutation = useRevisionFencedMutation(
    (value: {rowOrder: string[]; hiddenHomeRowIds: string[]}) =>
      preferences.update({
        homeRowOrder: value.rowOrder,
        hiddenHomeRowIds: value.hiddenHomeRowIds,
      }),
  );
  const error = saveMutation.error
    ? productErrorMessageId(saveMutation.error, 'home.preferences-save-failed')
    : undefined;
  const save = (rowOrder: string[], hiddenHomeRowIds: string[]) =>
    saveMutation.mutate({rowOrder, hiddenHomeRowIds});
  const move = (id: string, offset: -1 | 1) => {
    const index = currentOrder.indexOf(id);
    const destination = index + offset;
    if (index < 0 || destination < 0 || destination >= currentOrder.length)
      return;
    const destinationRow = rows.find(
      row => row.id === currentOrder[destination],
    );
    if (!destinationRow?.reorderable) return;
    const next = [...currentOrder];
    [next[index], next[destination]] = [next[destination]!, next[index]!];
    void save(next, [...hidden]);
  };
  const toggle = (id: string) => {
    const next = new Set(hidden);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    void save(currentOrder, [...next]);
  };
  return (
    <Modal
      animationType={animationType}
      onDismiss={modalFocus.onDismiss}
      onRequestClose={onClose}
      transparent
      visible={visible}
    >
      <View style={styles.customizeLayer}>
        <Pressable
          accessible={false}
          focusable={false}
          onPress={onClose}
          style={StyleSheet.absoluteFill}
        />
        <TVModalFocusTrap
          platform={platform}
          style={[styles.customizeSheet, television && styles.customizeSheetTv]}
        >
          <View style={styles.customizeHeader}>
            <View>
              <Text
                style={
                  television
                    ? styles.customizeTitleTv
                    : styles.customizeTitleMobile
                }
              >
                {productText('home.customize-title')}
              </Text>
              <Text
                style={
                  television
                    ? styles.customizeBodyTv
                    : styles.customizeBodyMobile
                }
              >
                {productText('home.customize-body')}
              </Text>
            </View>
            <IconButton
              icon="action.close"
              label={productText('action.close-home-customization')}
              onPress={onClose}
              platform={platform}
            />
          </View>
          {error ? (
            <InlineNotice kind="error" message={error} platform={platform} />
          ) : saveMutation.pending ? (
            <InlineNotice
              kind="info"
              message="Saving layout…"
              platform={platform}
            />
          ) : null}
          <ScrollView contentContainerStyle={styles.customizeRows}>
            {orderedRows.map((row, index) => {
              const rowHidden = hidden.has(row.id);
              const canMoveUp =
                row.reorderable &&
                index > 0 &&
                orderedRows[index - 1]?.reorderable;
              const canMoveDown =
                row.reorderable &&
                index < orderedRows.length - 1 &&
                orderedRows[index + 1]?.reorderable;
              return (
                <View
                  key={row.id}
                  style={[
                    styles.customizeRow,
                    television && styles.customizeRowTv,
                  ]}
                >
                  <View style={styles.customizeRowCopy}>
                    <Text
                      style={
                        television
                          ? styles.customizeRowTitleTv
                          : styles.customizeRowTitleMobile
                      }
                    >
                      {row.title}
                    </Text>
                    <Text
                      style={
                        television
                          ? styles.customizeRowStateTv
                          : styles.customizeRowStateMobile
                      }
                    >
                      {productText(
                        row.required
                          ? 'home.row-always-shown'
                          : rowHidden
                            ? 'home.row-hidden'
                            : 'home.row-shown',
                      )}
                    </Text>
                  </View>
                  {row.hideable && !row.required ? (
                    <IconButton
                      disabled={saveMutation.pending}
                      icon={rowHidden ? 'account.visibility.show' : 'account.visibility.hide'}
                      label={
                        rowHidden ? `Show ${row.title}` : `Hide ${row.title}`
                      }
                      onPress={() => toggle(row.id)}
                      platform={platform}
                    />
                  ) : null}
                  {canMoveUp ? (
                    <IconButton
                      disabled={saveMutation.pending}
                      icon="navigation.move-up"
                      label={productText('action.move-row-up', {
                        title: row.title,
                      })}
                      onPress={() => move(row.id, -1)}
                      platform={platform}
                    />
                  ) : null}
                  {canMoveDown ? (
                    <IconButton
                      disabled={saveMutation.pending}
                      icon="navigation.move-down"
                      label={productText('action.move-row-down', {
                        title: row.title,
                      })}
                      onPress={() => move(row.id, 1)}
                      platform={platform}
                    />
                  ) : null}
                </View>
              );
            })}
          </ScrollView>
          <View style={styles.customizeFooter}>
            <ControlButton
              disabled={saveMutation.pending}
              icon="action.reset"
              label={productText('action.reset-layout')}
              onPress={() => void save([], [])}
              platform={platform}
            />
            <ControlButton
              disabled={saveMutation.pending}
              label={productText('action.done')}
              onPress={onClose}
              platform={platform}
              primary
            />
          </View>
        </TVModalFocusTrap>
      </View>
    </Modal>
  );
}

function PagedHomeRow({
  client,
  initialRow,
  onItemFocus,
  onOpen,
  platform,
}: {
  client: PorticoClient;
  initialRow: HomeRowViewModel;
  onItemFocus?(item: MediaViewModel, index: number): void;
  onOpen(item: MediaViewModel): void;
  platform: PrototypePlatform;
}) {
  const resetKey = `${initialRow.id}:${initialRow.nextCursor ?? ''}:${initialRow.items.map(item => `${item.id}:${item.state.favorite}:${item.state.watchlisted}:${item.state.watched}:${item.state.progressSeconds}`).join(',')}`;
  const [rowState, setRowState] = useState({key: resetKey, row: initialRow});
  const incomingRowRef = useRef(initialRow);
  incomingRowRef.current = initialRow;
  const latestResetKeyRef = useRef(resetKey);
  latestResetKeyRef.current = resetKey;
  const generationRef = useRef(0);
  const loadingRef = useRef(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string>();

  const row = rowState.key === resetKey ? rowState.row : initialRow;
  useEffect(() => {
    generationRef.current += 1;
    setRowState({key: resetKey, row: incomingRowRef.current});
    loadingRef.current = false;
    setLoading(false);
    setError(undefined);
  }, [resetKey]);

  const loadMore = async () => {
    if (loadingRef.current || !row.hasMore || !row.nextCursor) return;
    const generation = generationRef.current;
    const requestResetKey = resetKey;
    const rowId = row.id;
    const cursor = row.nextCursor;
    loadingRef.current = true;
    setLoading(true);
    setError(undefined);
    try {
      const next = homeRowViewModel(
        await client.homeRow(rowId, {cursor, limit: 24}),
        client,
      );
      if (
        generation !== generationRef.current ||
        latestResetKeyRef.current !== requestResetKey
      )
        return;
      setRowState(current => {
        if (current.key !== resetKey || current.row.id !== rowId)
          return current;
        return {
          key: current.key,
          row: {
            ...current.row,
            items: mergeUniqueById(current.row.items, next.items),
            hasMore:
              next.hasMore &&
              Boolean(next.nextCursor) &&
              next.nextCursor !== current.row.nextCursor,
            nextCursor: next.nextCursor,
          },
        };
      });
    } catch (cause) {
      if (
        generation !== generationRef.current ||
        latestResetKeyRef.current !== requestResetKey
      )
        return;
      setError(productErrorMessageId(cause, 'search.more-failed'));
    } finally {
      if (
        generation === generationRef.current &&
        latestResetKeyRef.current === requestResetKey
      ) {
        loadingRef.current = false;
        setLoading(false);
      }
    }
  };

  return (
    <View>
      <MediaRow
        continuationError={error}
        items={row.items}
        loadingMore={loading}
        onEndReached={() => void loadMore()}
        onItemFocus={
          onItemFocus
            ? (_item, focusedIndex) =>
                onItemFocus(row.items[focusedIndex]!, focusedIndex)
            : undefined
        }
        onOpen={item => {
          const selected = row.items.find(
            candidate => candidate.id === item.id,
          );
          if (selected) onOpen(selected);
        }}
        onRetryContinuation={() => void loadMore()}
        platform={platform}
        shape="poster"
        title={row.title}
      />
    </View>
  );
}

function canChangeWatchlist(item: MediaViewModel): boolean {
  return (
    item.actions.includes('watchlist.add') ||
    item.actions.includes('watchlist.remove')
  );
}

function canChangeFavorite(item: MediaViewModel): boolean {
  return (
    item.actions.includes('favorite.add') ||
    item.actions.includes('favorite.remove')
  );
}

function HomeLoading({platform}: {platform: PrototypePlatform}) {
  const television = platform === 'tv';
  return (
    <ScrollView
      contentContainerStyle={styles.page}
      showsVerticalScrollIndicator={false}
    >
      <View
        style={[
          styles.loadingHero,
          television ? styles.heroTv : styles.heroMobile,
        ]}
      >
        <View
          style={[
            styles.loadingHeroCopy,
            television && styles.loadingHeroCopyTv,
          ]}
        >
          <Skeleton
            height={television ? 64 : 42}
            width={television ? 470 : 270}
          />
          <Skeleton
            height={television ? 24 : 15}
            style={styles.loadingMeta}
            width={television ? 320 : 190}
          />
          <Skeleton
            height={television ? 66 : 54}
            style={styles.loadingSummary}
            width={television ? 690 : '92%'}
          />
          <Skeleton
            height={television ? 60 : 46}
            style={styles.loadingAction}
            width={television ? 220 : 150}
          />
        </View>
      </View>
      {[0, 1].map(index => (
        <View
          key={index}
          style={television ? styles.loadingRowTv : styles.loadingRowMobile}
        >
          <Skeleton
            height={television ? 30 : 21}
            width={television ? 260 : 190}
          />
          <View style={styles.loadingCards}>
            {Array.from({length: television ? 5 : 3}, (_, card) => (
              <Skeleton
                height={television ? 170 : 112}
                key={card}
                width={television ? 300 : 198}
              />
            ))}
          </View>
        </View>
      ))}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  page: {backgroundColor: color.projector, paddingBottom: 30},
  hero: {backgroundColor: color.recess, overflow: 'hidden', width: '100%'},
  heroMobile: {height: 410},
  heroTv: {height: 430},
  heroEmptyCopyTv: {
    flex: 1,
    justifyContent: 'flex-end',
    paddingBottom: 62,
    paddingRight: 72,
  },
  heroEmptyMessageTv: {
    color: color.softSilver,
    fontFamily: font.demi,
    fontSize: 34,
    letterSpacing: -0.6,
    lineHeight: 43,
    maxWidth: 760,
  },
  heroArtwork: {height: '100%', width: '100%'},
  heroInner: {flex: 1},
  heroInnerMobile: {paddingTop: 2},
  heroInnerTv: {paddingRight: 72, paddingTop: 2},
  heroCopy: {marginTop: 'auto'},
  heroCopyMobile: {maxWidth: 520, paddingBottom: 40, paddingHorizontal: 20},
  heroCopyTv: {maxWidth: 910, paddingBottom: 50},
  heroTitle: {
    color: color.silver,
    textShadowColor: 'rgba(0,0,0,0.45)',
    textShadowOffset: {height: 1, width: 0},
    textShadowRadius: 8,
  },
  heroTitleMobile: {
    fontFamily: font.bold,
    fontSize: 42,
    letterSpacing: -1.4,
    lineHeight: 44,
  },
  heroTitleTv: {
    fontFamily: font.bold,
    fontSize: 66,
    letterSpacing: -2.1,
    lineHeight: 69,
  },
  heroMetaMobile: {
    color: color.softSilver,
    fontFamily: font.demi,
    fontSize: 14,
    lineHeight: 19,
    marginTop: 8,
  },
  heroMetaTv: {
    color: color.softSilver,
    fontFamily: font.demi,
    fontSize: 22,
    lineHeight: 29,
    marginTop: 10,
  },
  heroSummaryMobile: {
    color: color.softSilver,
    fontFamily: font.regular,
    fontSize: 15,
    lineHeight: 21,
    marginTop: 10,
  },
  heroSummaryTv: {
    color: color.softSilver,
    fontFamily: font.regular,
    fontSize: 23,
    lineHeight: 32,
    marginTop: 12,
    maxWidth: 820,
  },
  heroActions: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: 8,
    marginTop: 18,
  },
  heroActionsTv: {gap: 12, marginTop: 24},
  noticeMobile: {marginBottom: 22, marginHorizontal: 16, marginTop: -4},
  noticeTv: {marginBottom: 30, marginTop: 2},
  homeRowStateMobile: {
    alignItems: 'flex-start',
    gap: 6,
    minHeight: 112,
    paddingHorizontal: 20,
    paddingVertical: 16,
  },
  homeRowStateTv: {
    alignItems: 'flex-start',
    gap: 10,
    minHeight: 170,
    paddingHorizontal: 72,
    paddingVertical: 24,
  },
  homeRowStateTitleMobile: {
    color: color.silver,
    fontFamily: font.demi,
    fontSize: 17,
    lineHeight: 23,
  },
  homeRowStateTitleTv: {
    color: color.silver,
    fontFamily: font.demi,
    fontSize: 27,
    lineHeight: 34,
  },
  homeRowStateMessageMobile: {
    color: color.dimSilver,
    fontFamily: font.regular,
    fontSize: 14,
    lineHeight: 20,
  },
  homeRowStateMessageTv: {
    color: color.dimSilver,
    fontFamily: font.regular,
    fontSize: 20,
    lineHeight: 28,
  },
  rowFailureMobile: {marginBottom: 24, marginHorizontal: 16},
  rowFailureTv: {marginBottom: 34, marginRight: 72},
  loadingHero: {backgroundColor: color.recess, paddingHorizontal: 16},
  loadingHeroCopy: {marginTop: 'auto', paddingBottom: 54},
  loadingHeroCopyTv: {paddingBottom: 64},
  loadingMeta: {marginTop: 16},
  loadingSummary: {marginTop: 18},
  loadingAction: {marginTop: 20},
  loadingRowMobile: {marginTop: 28, paddingHorizontal: 16},
  loadingRowTv: {marginTop: 38},
  loadingCards: {
    flexDirection: 'row',
    gap: 12,
    marginTop: 14,
    overflow: 'hidden',
  },
  customizeLayer: {
    backgroundColor: 'rgba(0,0,0,0.72)',
    flex: 1,
    justifyContent: 'flex-end',
  },
  customizeSheet: {
    backgroundColor: color.raisedSlate,
    maxHeight: '84%',
    padding: 18,
  },
  customizeSheetTv: {
    alignSelf: 'center',
    borderColor: color.line,
    borderWidth: 1,
    marginBottom: 48,
    maxHeight: '82%',
    padding: 28,
    width: 840,
  },
  customizeHeader: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: 16,
    justifyContent: 'space-between',
  },
  customizeTitleMobile: {
    color: color.silver,
    fontFamily: font.bold,
    fontSize: 22,
  },
  customizeTitleTv: {color: color.silver, fontFamily: font.bold, fontSize: 34},
  customizeBodyMobile: {
    color: color.dimSilver,
    fontFamily: font.regular,
    fontSize: 13,
    marginTop: 3,
  },
  customizeBodyTv: {
    color: color.dimSilver,
    fontFamily: font.regular,
    fontSize: 19,
    marginTop: 5,
  },
  customizeRows: {gap: 1, paddingVertical: 16},
  customizeRow: {
    alignItems: 'center',
    backgroundColor: color.recess,
    flexDirection: 'row',
    gap: 7,
    minHeight: 68,
    padding: 10,
  },
  customizeRowTv: {minHeight: 88, paddingHorizontal: 16},
  customizeRowCopy: {flex: 1},
  customizeRowTitleMobile: {
    color: color.silver,
    fontFamily: font.demi,
    fontSize: 15,
  },
  customizeRowTitleTv: {
    color: color.silver,
    fontFamily: font.demi,
    fontSize: 22,
  },
  customizeRowStateMobile: {
    color: color.dimSilver,
    fontFamily: font.regular,
    fontSize: 12,
    marginTop: 3,
  },
  customizeRowStateTv: {
    color: color.dimSilver,
    fontFamily: font.regular,
    fontSize: 17,
    marginTop: 4,
  },
  customizeFooter: {flexDirection: 'row', gap: 8, justifyContent: 'flex-end'},
  customizeEntryTv: {alignItems: 'flex-start', marginBottom: 18},
});
