import React, {useEffect, useRef, useState} from 'react';
import {
  ActivityIndicator,
  Image,
  FlatList,
  StyleSheet,
  Text,
  View,
  useWindowDimensions,
  type StyleProp,
  type NativeScrollEvent,
  type NativeSyntheticEvent,
  type ViewStyle,
} from 'react-native';
import {
  PorticoBrand,
  PorticoIcon,
  type PorticoIconId,
} from '@portico-react-native/icons';
import type {MediaItem, PrototypePlatform} from '../ui-compat/contract';
import type {MediaCardRenderItem} from '../data/contracts';
import {color, font, mobileType, tvType} from './tokens';
import {
  Focusable,
  IconButton,
  MediaCard,
  SectionHeading,
  type MediaCardShape,
} from './primitives';
import {usePrototypeUi} from './uiState';
import {useSafeAreaInsets} from 'react-native-safe-area-context';
import {serverImageSource} from '@portico-react-native/infrastructure';
import {useEngagement} from './engagement';
import {productText} from './productCopy';
import {registerTVFocusVirtualizer} from './tvNavigationFocus';
import type {TVFocusDirection} from '@portico-react-native/tv-focus';

export function mediaOccurrenceFocusId(
  section: string,
  index: number,
  mediaId: string,
): string {
  return `${section}:occurrence:${index}:media:${mediaId}`;
}

export function PorticoWordmark({platform}: {platform: PrototypePlatform}) {
  const television = platform === 'tv';
  return (
    <PorticoBrand
      height={television ? 34 : 24}
      id="brand.wordmark.mono-white"
      width={television ? 154 : 108}
    />
  );
}

export function HeaderUtilities({
  artworkHeader = false,
  flush = false,
  leftContent,
  onSearch,
  platform,
  showProfile = true,
  title,
}: {
  artworkHeader?: boolean;
  flush?: boolean;
  leftContent?: React.ReactNode;
  onSearch?(): void;
  platform: PrototypePlatform;
  showProfile?: boolean;
  title?: string;
}) {
  const television = platform === 'tv';
  const insets = useSafeAreaInsets();
  const {setOverlay} = usePrototypeUi();
  const engagement = useEngagement();
  return (
    <View
      style={[
        styles.headerUtilities,
        television && styles.headerUtilitiesTv,
        flush && styles.headerUtilitiesFlush,
        artworkHeader &&
          !television && {
            minHeight: 58 + insets.top,
            paddingTop: insets.top + 4,
          },
      ]}
    >
      <View style={styles.headerIdentity}>
        {leftContent ??
          (title ? (
            <Text
              style={
                television ? styles.headerTitleTv : styles.headerTitleMobile
              }
            >
              {title}
            </Text>
          ) : (
            <PorticoWordmark platform={platform} />
          ))}
      </View>
      {!television ? (
        <View style={styles.headerActions}>
          {onSearch ? (
            <HeaderAction
              icon="navigation.search"
              label={productText('navigation.search')}
              onPress={onSearch}
              platform={platform}
              transparent
            />
          ) : null}
          <HeaderAction
            icon="playback.route.cast"
            label="Playback destination"
            onPress={() => setOverlay('cast')}
            platform={platform}
            transparent
          />
          {showProfile ? (
            <View style={styles.profileAction}>
              <HeaderAction
                icon="account.user"
                label={
                  engagement.unreadCount
                    ? `${productText('profiles.label.profile')}. ${productText('notification.unread-label', {count: engagement.unreadCount})}`
                    : productText('profiles.label.profile')
                }
                onPress={() => setOverlay('profile')}
                platform={platform}
              />
              {engagement.unreadCount > 0 ? (
                <View
                  pointerEvents="none"
                  style={styles.profileNotificationBadge}
                >
                  <Text style={styles.profileNotificationBadgeText}>
                    {Math.min(99, engagement.unreadCount)}
                  </Text>
                </View>
              ) : null}
            </View>
          ) : null}
        </View>
      ) : null}
    </View>
  );
}

function HeaderAction({
  icon,
  label,
  onPress,
  platform,
  transparent,
}: {
  icon: PorticoIconId;
  label: string;
  onPress(): void;
  platform: PrototypePlatform;
  transparent?: boolean;
}) {
  const television = platform === 'tv';
  return (
    <Focusable
      accessibilityLabel={label}
      accessibilityRole="button"
      onPress={onPress}
      platform={platform}
      style={[
        styles.headerAction,
        television ? styles.headerActionTv : styles.headerActionMobile,
        transparent && styles.headerActionTransparent,
      ]}
      focusedStyle={styles.headerActionFocused}
      pressedStyle={styles.headerActionPressed}
    >
      <PorticoIcon color={color.silver} id={icon} size={television ? 25 : 19} />
    </Focusable>
  );
}

export function PageHeader({
  platform,
  subtitle,
  title,
  utilities = true,
}: {
  platform: PrototypePlatform;
  subtitle?: string;
  title: string;
  utilities?: boolean;
}) {
  const television = platform === 'tv';
  const {setOverlay} = usePrototypeUi();
  return (
    <View style={[styles.pageHeader, television && styles.pageHeaderTv]}>
      <View style={styles.pageHeaderCopy}>
        <Text
          style={[
            television ? tvType.title : mobileType.title,
            styles.pageTitle,
          ]}
        >
          {title}
        </Text>
        {subtitle ? (
          <Text
            style={
              television ? styles.pageSubtitleTv : styles.pageSubtitleMobile
            }
          >
            {subtitle}
          </Text>
        ) : null}
      </View>
      {utilities && !television ? (
        <View
          style={[styles.headerActions, television && styles.headerActionsTv]}
        >
          <IconButton
            icon="playback.route.cast"
            label="Playback destination"
            onPress={() => setOverlay('cast')}
            platform={platform}
          />
          <IconButton
            icon="account.user"
            label={productText('profiles.label.profile')}
            onPress={() => setOverlay('profile')}
            platform={platform}
          />
        </View>
      ) : null}
    </View>
  );
}

export function MediaRow({
  continuationError,
  flush = false,
  items,
  loadingMore = false,
  onEndReached,
  onItemFocus,
  onOpen,
  onRetryContinuation,
  platform,
  selectedId,
  shape,
  showHeading = true,
  title,
  tvFocusBoundaryDirections,
}: {
  continuationError?: string;
  flush?: boolean;
  items: MediaCardRenderItem[];
  loadingMore?: boolean;
  onEndReached?(): void;
  onItemFocus?(item: MediaCardRenderItem, index: number): void;
  onOpen(item: MediaCardRenderItem): void;
  onRetryContinuation?(): void;
  platform: PrototypePlatform;
  selectedId?: string;
  shape: MediaCardShape;
  showHeading?: boolean;
  title: string;
  tvFocusBoundaryDirections?: readonly TVFocusDirection[];
}) {
  const television = platform === 'tv';
  const listRef = useRef<FlatList<MediaCardRenderItem>>(null);
  const focusIds = React.useMemo(
    () =>
      items.map((item, index) =>
        mediaOccurrenceFocusId(`row:${title}`, index, item.id),
      ),
    [items, title],
  );
  useEffect(() => {
    if (!television) return undefined;
    return registerTVFocusVirtualizer({
      owns: focusId => focusIds.includes(focusId),
      reveal: focusId => {
        const index = focusIds.indexOf(focusId);
        if (index >= 0)
          listRef.current?.scrollToIndex({
            animated: false,
            index,
            viewPosition: 0.35,
          });
      },
    });
  }, [focusIds, television]);
  return (
    <View
      style={[
        styles.mediaRow,
        television && styles.mediaRowTv,
        flush && styles.mediaRowFlush,
      ]}
    >
      {showHeading ? (
        <SectionHeading platform={platform} title={title} />
      ) : null}
      <FlatList
        contentContainerStyle={[
          styles.mediaRowContent,
          television && styles.mediaRowContentTv,
        ]}
        data={items}
        horizontal
        initialNumToRender={television ? 8 : 4}
        keyExtractor={(item, index) => `${item.id}:${index}`}
        ListFooterComponent={
          loadingMore ? (
            <View
              accessibilityLabel={productText('state.loading-more')}
              accessibilityRole="progressbar"
              style={[
                styles.mediaRowContinuation,
                television && styles.mediaRowContinuationTv,
              ]}
            >
              <ActivityIndicator color={color.screenBlue} size="small" />
            </View>
          ) : continuationError && onRetryContinuation ? (
            <Focusable
              accessibilityHint={continuationError}
              accessibilityLabel={productText('action.retry')}
              accessibilityRole="button"
              onPress={onRetryContinuation}
              platform={platform}
              style={[
                styles.mediaRowContinuation,
                styles.mediaRowContinuationRetry,
                television && styles.mediaRowContinuationTv,
              ]}
              focusedStyle={styles.mediaRowContinuationFocused}
              pressedStyle={styles.mediaRowContinuationPressed}
            >
              <Text
                style={
                  television
                    ? styles.mediaRowContinuationTextTv
                    : styles.mediaRowContinuationText
                }
              >
                {productText('action.retry')}
              </Text>
            </Focusable>
          ) : null
        }
        onScrollToIndexFailed={({averageItemLength, index}) => {
          listRef.current?.scrollToOffset({
            animated: false,
            offset: Math.max(0, averageItemLength * index),
          });
        }}
        onEndReached={onEndReached}
        onEndReachedThreshold={0.5}
        renderItem={({item, index}) => (
          <MediaCard
            item={item}
            onFocus={onItemFocus ? () => onItemFocus(item, index) : undefined}
            onPress={() => onOpen(item)}
            platform={platform}
            selected={item.id === selectedId}
            shape={shape}
            tvFocusBoundaryDirections={tvFocusBoundaryDirections}
            tvFocusId={mediaOccurrenceFocusId(`row:${title}`, index, item.id)}
          />
        )}
        ref={listRef}
        showsHorizontalScrollIndicator={false}
      />
    </View>
  );
}

export function MediaGrid({
  contentOffset,
  contentContainerStyle,
  items,
  listFooter,
  listHeader,
  onScroll,
  onOpen,
  platform,
  stickyHeaderIndices,
  testID,
  viewMode = 'grid',
}: {
  contentOffset?: {x: number; y: number};
  contentContainerStyle?: StyleProp<ViewStyle>;
  items: MediaItem[];
  listFooter?: React.ReactElement | null;
  listHeader?: React.ReactElement;
  onScroll?: (event: NativeSyntheticEvent<NativeScrollEvent>) => void;
  onOpen(item: MediaItem): void;
  platform: PrototypePlatform;
  stickyHeaderIndices?: number[];
  testID?: string;
  viewMode?: 'grid' | 'list';
}) {
  const television = platform === 'tv';
  const {width} = useWindowDimensions();
  const [containerWidth, setContainerWidth] = useState(0);

  if (viewMode === 'list') {
    if (!listHeader) {
      return (
        <View
          style={[
            contentContainerStyle,
            styles.list,
            television && styles.listTv,
          ]}
        >
          {items.map(item => (
            <ListMediaRow
              item={item}
              key={item.id}
              onPress={() => onOpen(item)}
              platform={platform}
            />
          ))}
        </View>
      );
    }
    return (
      <FlatList
        contentContainerStyle={[
          contentContainerStyle,
          styles.list,
          television && styles.listTv,
        ]}
        contentOffset={contentOffset}
        data={items}
        initialNumToRender={television ? 8 : 5}
        key="list"
        keyExtractor={item => item.id}
        ListHeaderComponent={listHeader}
        ListFooterComponent={listFooter}
        onScroll={onScroll}
        scrollEventThrottle={16}
        renderItem={({item}) => (
          <ListMediaRow
            item={item}
            onPress={() => onOpen(item)}
            platform={platform}
          />
        )}
        stickyHeaderIndices={stickyHeaderIndices}
        showsVerticalScrollIndicator={false}
        testID={testID}
      />
    );
  }

  const fallbackWidth = television ? width - 136 - 72 : width - 32;
  const available = containerWidth
    ? containerWidth - (listHeader ? (television ? 72 : 32) : 0)
    : fallbackWidth;
  const gap = television ? 20 : 7;
  const columns = television
    ? Math.max(5, Math.floor((available + gap) / 214))
    : 3;
  const cardWidth = Math.floor((available - gap * (columns - 1)) / columns);
  if (!listHeader) {
    return (
      <View
        onLayout={({nativeEvent}) => {
          const measuredWidth = Math.round(nativeEvent.layout.width);
          if (measuredWidth !== containerWidth) {
            setContainerWidth(measuredWidth);
          }
        }}
        style={[
          contentContainerStyle,
          styles.grid,
          styles.gridStatic,
          {columnGap: gap},
          television && styles.gridTv,
        ]}
      >
        {items.map((item, index) => (
          <MediaCard
            item={item}
            key={`${item.id}:${index}`}
            onPress={() => onOpen(item)}
            platform={platform}
            shape={item.shape ?? 'poster'}
            tvFocusId={mediaOccurrenceFocusId('grid', index, item.id)}
            width={cardWidth}
          />
        ))}
      </View>
    );
  }
  return (
    <FlatList
      columnWrapperStyle={{gap}}
      contentContainerStyle={[
        contentContainerStyle,
        styles.grid,
        television && styles.gridTv,
      ]}
      contentOffset={contentOffset}
      data={items}
      initialNumToRender={television ? columns * 2 : 9}
      key={`grid-${columns}`}
      keyExtractor={(item, index) => `${item.id}:${index}`}
      ListHeaderComponent={listHeader}
      ListFooterComponent={listFooter}
      numColumns={columns}
      onLayout={({nativeEvent}) => {
        const measuredWidth = Math.round(nativeEvent.layout.width);
        if (measuredWidth !== containerWidth) {
          setContainerWidth(measuredWidth);
        }
      }}
      renderItem={({item, index}) => (
        <MediaCard
          item={item}
          onPress={() => onOpen(item)}
          platform={platform}
          shape={item.shape ?? 'poster'}
          tvFocusId={mediaOccurrenceFocusId('grid', index, item.id)}
          width={cardWidth}
        />
      )}
      onScroll={onScroll}
      scrollEventThrottle={16}
      stickyHeaderIndices={stickyHeaderIndices}
      showsVerticalScrollIndicator={false}
      testID={testID}
    />
  );
}

function ListMediaRow({
  item,
  onPress,
  platform,
}: {
  item: MediaItem;
  onPress(): void;
  platform: PrototypePlatform;
}) {
  const television = platform === 'tv';
  return (
    <Focusable
      accessibilityLabel={`${item.title}. ${item.year ?? ''}`}
      accessibilityRole="button"
      onPress={onPress}
      platform={platform}
      style={[styles.listRow, television && styles.listRowTv]}
      focusedStyle={styles.listRowFocused}
      pressedStyle={styles.listRowPressed}
    >
      <Image
        resizeMode="cover"
        source={serverImageSource(item.backdrop)}
        style={television ? styles.listImageTv : styles.listImageMobile}
      />
      <View style={styles.listCopy}>
        <Text
          numberOfLines={1}
          style={television ? styles.listTitleTv : styles.listTitleMobile}
        >
          {item.title}
        </Text>
        <Text style={television ? styles.listMetaTv : styles.listMetaMobile}>
          {[item.year, item.duration, item.genre].filter(Boolean).join('  ·  ')}
        </Text>
        {item.summary ? (
          <Text
            numberOfLines={television ? 2 : 3}
            style={television ? styles.listSummaryTv : styles.listSummaryMobile}
          >
            {item.summary}
          </Text>
        ) : null}
      </View>
    </Focusable>
  );
}

const styles = StyleSheet.create({
  wordmarkMobile: {height: 24, width: 108},
  wordmarkTv: {height: 34, width: 154},
  headerUtilities: {
    alignItems: 'center',
    flexDirection: 'row',
    justifyContent: 'space-between',
    minHeight: 58,
    paddingHorizontal: 16,
    paddingTop: 4,
  },
  headerUtilitiesTv: {minHeight: 102, paddingHorizontal: 0, paddingTop: 28},
  headerUtilitiesFlush: {paddingHorizontal: 0},
  headerIdentity: {flex: 1},
  headerActions: {alignItems: 'center', flexDirection: 'row', gap: 8},
  headerActionsTv: {gap: 12},
  headerAction: {
    alignItems: 'center',
    backgroundColor: color.scrim,
    borderColor: color.lineSoft,
    borderRadius: 999,
    borderWidth: 2,
    justifyContent: 'center',
  },
  headerActionMobile: {height: 44, width: 44},
  headerActionTv: {height: 58, width: 58},
  headerActionTransparent: {
    backgroundColor: color.transparent,
    borderColor: color.transparent,
  },
  headerActionFocused: {
    backgroundColor: color.raisedSlate,
    borderColor: color.focus,
  },
  headerActionPressed: {backgroundColor: color.brightSlate},
  profileAction: {position: 'relative'},
  profileNotificationBadge: {
    alignItems: 'center',
    backgroundColor: color.record,
    borderColor: color.projector,
    borderRadius: 10,
    borderWidth: 2,
    height: 20,
    justifyContent: 'center',
    position: 'absolute',
    right: -3,
    top: -3,
    width: 20,
  },
  profileNotificationBadgeText: {
    color: color.silver,
    fontFamily: font.bold,
    fontSize: 9,
    lineHeight: 11,
    textAlign: 'center',
  },
  headerTitleMobile: {
    color: color.silver,
    fontFamily: font.bold,
    fontSize: 30,
    letterSpacing: -0.8,
  },
  headerTitleTv: {
    color: color.silver,
    fontFamily: font.bold,
    fontSize: 48,
    letterSpacing: -1.4,
  },
  pageHeader: {
    alignItems: 'flex-start',
    flexDirection: 'row',
    justifyContent: 'space-between',
    paddingBottom: 10,
    paddingHorizontal: 16,
    paddingTop: 12,
  },
  pageHeaderTv: {
    alignItems: 'center',
    paddingBottom: 18,
    paddingHorizontal: 0,
    paddingTop: 8,
  },
  pageHeaderCopy: {flex: 1},
  pageTitle: {color: color.silver},
  pageSubtitleMobile: {
    color: color.dimSilver,
    fontFamily: font.regular,
    fontSize: 13,
    lineHeight: 18,
    marginTop: 2,
  },
  pageSubtitleTv: {
    color: color.dimSilver,
    fontFamily: font.regular,
    fontSize: 19,
    lineHeight: 26,
    marginTop: 4,
  },
  mediaRow: {marginBottom: 28, paddingLeft: 16},
  mediaRowTv: {marginBottom: 42, paddingLeft: 0},
  mediaRowFlush: {paddingLeft: 0},
  mediaRowContent: {gap: 7, paddingRight: 16, paddingTop: 10},
  mediaRowContentTv: {gap: 18, paddingRight: 72, paddingTop: 16},
  mediaRowContinuation: {
    alignItems: 'center',
    alignSelf: 'stretch',
    justifyContent: 'center',
    minWidth: 48,
    paddingHorizontal: 12,
  },
  mediaRowContinuationTv: {minWidth: 88, paddingHorizontal: 20},
  mediaRowContinuationRetry: {
    backgroundColor: color.recess,
    borderColor: color.line,
    borderRadius: 10,
    borderWidth: 1,
    marginVertical: 8,
  },
  mediaRowContinuationFocused: {borderColor: color.screenBlue},
  mediaRowContinuationPressed: {opacity: 0.8},
  mediaRowContinuationText: {
    color: color.silver,
    fontFamily: font.demi,
    fontSize: 13,
  },
  mediaRowContinuationTextTv: {
    color: color.silver,
    fontFamily: font.demi,
    fontSize: 20,
  },
  grid: {gap: 18, paddingBottom: 108},
  gridStatic: {flexDirection: 'row', flexWrap: 'wrap'},
  gridTv: {gap: 30, paddingBottom: 90},
  list: {gap: 8, paddingBottom: 108},
  listTv: {gap: 12, paddingBottom: 90},
  listRow: {
    alignItems: 'center',
    backgroundColor: color.recess,
    borderColor: color.transparent,
    borderBottomColor: color.lineSoft,
    borderBottomWidth: 1,
    borderWidth: 3,
    flexDirection: 'row',
    gap: 12,
    minHeight: 118,
    padding: 8,
  },
  listRowTv: {gap: 20, minHeight: 158, padding: 10},
  listRowFocused: {
    backgroundColor: color.raisedSlate,
    borderColor: color.focus,
  },
  listRowPressed: {backgroundColor: color.brightSlate},
  listImageMobile: {borderRadius: 6, height: 88, width: 156},
  listImageTv: {borderRadius: 6, height: 132, width: 235},
  listCopy: {flex: 1},
  listTitleMobile: {
    color: color.silver,
    fontFamily: font.demi,
    fontSize: 17,
    lineHeight: 21,
  },
  listTitleTv: {
    color: color.silver,
    fontFamily: font.demi,
    fontSize: 25,
    lineHeight: 31,
  },
  listMetaMobile: {
    color: color.dimSilver,
    fontFamily: font.medium,
    fontSize: 12,
    lineHeight: 17,
    marginTop: 2,
  },
  listMetaTv: {
    color: color.dimSilver,
    fontFamily: font.medium,
    fontSize: 18,
    lineHeight: 24,
    marginTop: 3,
  },
  listSummaryMobile: {
    color: color.softSilver,
    fontFamily: font.regular,
    fontSize: 13,
    lineHeight: 18,
    marginTop: 5,
  },
  listSummaryTv: {
    color: color.softSilver,
    fontFamily: font.regular,
    fontSize: 19,
    lineHeight: 27,
    marginTop: 7,
  },
});
