import React, {useState} from 'react';
import {
  Image,
  FlatList,
  StyleSheet,
  Text,
  View,
  useWindowDimensions,
  type StyleProp,
  type ViewStyle,
} from 'react-native';
import {
  Cast,
  MoreHorizontal,
  Search,
  UserRound,
  type LucideIcon,
} from 'lucide-react-native';
import type {MediaItem, PrototypePlatform} from '@portico-prototypes/contract';
import {usePrototype} from '@portico-prototypes/runtime';
import {color, font, mobileType, tvType} from './tokens';
import {Focusable, IconButton, MediaCard, SectionHeading, type MediaCardShape} from './primitives';
import {usePrototypeUi} from './uiState';
import {useSafeAreaInsets} from 'react-native-safe-area-context';
import {porticoWordmarkSource} from './brandAssets';

export function PorticoWordmark({platform}: {platform: PrototypePlatform}) {
  const television = platform === 'tv';
  return <Image resizeMode="contain" source={porticoWordmarkSource} style={television ? styles.wordmarkTv : styles.wordmarkMobile} />;
}

export function HeaderUtilities({
  artworkHeader = false,
  flush = false,
  leftContent,
  onMore,
  onSearch,
  platform,
  showProfile = true,
  title,
}: {
  artworkHeader?: boolean;
  flush?: boolean;
  leftContent?: React.ReactNode;
  onMore?(): void;
  onSearch?(): void;
  platform: PrototypePlatform;
  showProfile?: boolean;
  title?: string;
}) {
  const television = platform === 'tv';
  const insets = useSafeAreaInsets();
  const {setOverlay} = usePrototypeUi();
  return (
    <View style={[
      styles.headerUtilities,
      television && styles.headerUtilitiesTv,
      flush && styles.headerUtilitiesFlush,
      artworkHeader && !television && {minHeight: 58 + insets.top, paddingTop: insets.top + 4},
    ]}>
      <View style={styles.headerIdentity}>
        {leftContent ?? (title ? <Text style={television ? styles.headerTitleTv : styles.headerTitleMobile}>{title}</Text> : <PorticoWordmark platform={platform} />)}
      </View>
      {!television ? <View style={styles.headerActions}>
        {onSearch ? <HeaderAction icon={Search} label="Search" onPress={onSearch} platform={platform} transparent /> : null}
        <HeaderAction icon={Cast} label="Playback destination" onPress={() => setOverlay('cast')} platform={platform} transparent />
        {onMore ? <HeaderAction icon={MoreHorizontal} label="More actions" onPress={onMore} platform={platform} transparent /> : null}
        {showProfile ? <HeaderAction icon={UserRound} label="Profile" onPress={() => setOverlay('profile')} platform={platform} /> : null}
      </View> : null}
    </View>
  );
}

function HeaderAction({icon: Icon, label, onPress, platform, transparent}: {icon: LucideIcon; label: string; onPress(): void; platform: PrototypePlatform; transparent?: boolean}) {
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
      pressedStyle={styles.headerActionPressed}>
      <Icon color={color.silver} size={television ? 25 : 19} strokeWidth={2} />
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
        <Text style={[television ? tvType.title : mobileType.title, styles.pageTitle]}>{title}</Text>
        {subtitle ? <Text style={television ? styles.pageSubtitleTv : styles.pageSubtitleMobile}>{subtitle}</Text> : null}
      </View>
      {utilities && !television ? (
        <View style={[styles.headerActions, television && styles.headerActionsTv]}>
          <IconButton icon={Cast} label="Playback destination" onPress={() => setOverlay('cast')} platform={platform} />
          <IconButton icon={UserRound} label="Profile" onPress={() => setOverlay('profile')} platform={platform} />
        </View>
      ) : null}
    </View>
  );
}

export function MediaRow({
  flush = false,
  items,
  onItemFocus,
  onOpen,
  platform,
  shape,
  title,
}: {
  flush?: boolean;
  items: MediaItem[];
  onItemFocus?(item: MediaItem, index: number): void;
  onOpen(item: MediaItem): void;
  platform: PrototypePlatform;
  shape: MediaCardShape;
  title: string;
}) {
  const television = platform === 'tv';
  const {state} = usePrototype();
  return (
    <View style={[styles.mediaRow, television && styles.mediaRowTv, flush && styles.mediaRowFlush]}>
      <SectionHeading platform={platform} title={title} />
      <FlatList
        contentContainerStyle={[styles.mediaRowContent, television && styles.mediaRowContentTv]}
        data={items}
        horizontal
        initialNumToRender={television ? 8 : 4}
        keyExtractor={item => item.id}
        renderItem={({item, index}) => (
          <MediaCard
            artworkFailure={state.scenario === 'artwork-failure'}
            item={item}
            onFocus={onItemFocus ? () => onItemFocus(item, index) : undefined}
            onPress={() => onOpen(item)}
            platform={platform}
            shape={shape}
          />
        )}
        showsHorizontalScrollIndicator={false}
      />
    </View>
  );
}

export function MediaGrid({
  contentContainerStyle,
  items,
  listHeader,
  onOpen,
  platform,
  testID,
  viewMode = 'grid',
}: {
  contentContainerStyle?: StyleProp<ViewStyle>;
  items: MediaItem[];
  listHeader?: React.ReactElement;
  onOpen(item: MediaItem): void;
  platform: PrototypePlatform;
  testID?: string;
  viewMode?: 'grid' | 'list';
}) {
  const television = platform === 'tv';
  const {width} = useWindowDimensions();
  const [containerWidth, setContainerWidth] = useState(0);
  const {state} = usePrototype();

  if (viewMode === 'list') {
    if (!listHeader) {
      return (
        <View style={[contentContainerStyle, styles.list, television && styles.listTv]}>
          {items.map(item => <ListMediaRow item={item} key={item.id} onPress={() => onOpen(item)} platform={platform} />)}
        </View>
      );
    }
    return (
      <FlatList
        contentContainerStyle={[contentContainerStyle, styles.list, television && styles.listTv]}
        data={items}
        initialNumToRender={television ? 8 : 5}
        key="list"
        keyExtractor={item => item.id}
        ListHeaderComponent={listHeader}
        renderItem={({item}) => <ListMediaRow item={item} onPress={() => onOpen(item)} platform={platform} />}
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
  const columns = television ? Math.max(5, Math.floor((available + gap) / 214)) : 3;
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
        style={[contentContainerStyle, styles.grid, styles.gridStatic, {columnGap: gap}, television && styles.gridTv]}>
        {items.map(item => (
          <MediaCard
            artworkFailure={state.scenario === 'artwork-failure'}
            item={item}
            key={item.id}
            onPress={() => onOpen(item)}
            platform={platform}
            shape={item.shape ?? 'poster'}
            width={cardWidth}
          />
        ))}
      </View>
    );
  }
  return (
    <FlatList
      columnWrapperStyle={{gap}}
      contentContainerStyle={[contentContainerStyle, styles.grid, television && styles.gridTv]}
      data={items}
      initialNumToRender={television ? columns * 2 : 9}
      key={`grid-${columns}`}
      keyExtractor={item => item.id}
      ListHeaderComponent={listHeader}
      numColumns={columns}
      onLayout={({nativeEvent}) => {
        const measuredWidth = Math.round(nativeEvent.layout.width);
        if (measuredWidth !== containerWidth) {
          setContainerWidth(measuredWidth);
        }
      }}
      renderItem={({item}) => (
        <MediaCard
          artworkFailure={state.scenario === 'artwork-failure'}
          item={item}
          onPress={() => onOpen(item)}
          platform={platform}
          shape={item.shape ?? 'poster'}
          width={cardWidth}
        />
      )}
      showsVerticalScrollIndicator={false}
      testID={testID}
    />
  );
}

function ListMediaRow({item, onPress, platform}: {item: MediaItem; onPress(): void; platform: PrototypePlatform}) {
  const television = platform === 'tv';
  return (
    <Focusable
      accessibilityLabel={`${item.title}. ${item.year ?? ''}`}
      accessibilityRole="button"
      onPress={onPress}
      platform={platform}
      style={[styles.listRow, television && styles.listRowTv]}
      focusedStyle={styles.listRowFocused}
      pressedStyle={styles.listRowPressed}>
      <Image resizeMode="cover" source={{uri: item.backdrop}} style={television ? styles.listImageTv : styles.listImageMobile} />
      <View style={styles.listCopy}>
        <Text numberOfLines={1} style={television ? styles.listTitleTv : styles.listTitleMobile}>{item.title}</Text>
        <Text style={television ? styles.listMetaTv : styles.listMetaMobile}>{[item.year, item.duration, item.genre].filter(Boolean).join('  ·  ')}</Text>
        {item.summary ? <Text numberOfLines={television ? 2 : 3} style={television ? styles.listSummaryTv : styles.listSummaryMobile}>{item.summary}</Text> : null}
      </View>
    </Focusable>
  );
}

const styles = StyleSheet.create({
  wordmarkMobile: {height: 24, width: 108},
  wordmarkTv: {height: 34, width: 154},
  headerUtilities: {alignItems: 'center', flexDirection: 'row', justifyContent: 'space-between', minHeight: 58, paddingHorizontal: 16, paddingTop: 4},
  headerUtilitiesTv: {minHeight: 102, paddingHorizontal: 0, paddingTop: 28},
  headerUtilitiesFlush: {paddingHorizontal: 0},
  headerIdentity: {flex: 1},
  headerActions: {alignItems: 'center', flexDirection: 'row', gap: 8},
  headerActionsTv: {gap: 12},
  headerAction: {alignItems: 'center', backgroundColor: color.scrim, borderColor: color.lineSoft, borderRadius: 999, borderWidth: 2, justifyContent: 'center'},
  headerActionMobile: {height: 44, width: 44},
  headerActionTv: {height: 58, width: 58},
  headerActionTransparent: {backgroundColor: color.transparent, borderColor: color.transparent},
  headerActionFocused: {backgroundColor: color.raisedSlate, borderColor: color.focus},
  headerActionPressed: {backgroundColor: color.brightSlate},
  headerTitleMobile: {color: color.silver, fontFamily: font.bold, fontSize: 30, letterSpacing: -0.8},
  headerTitleTv: {color: color.silver, fontFamily: font.bold, fontSize: 48, letterSpacing: -1.4},
  pageHeader: {alignItems: 'flex-start', flexDirection: 'row', justifyContent: 'space-between', paddingBottom: 10, paddingHorizontal: 16, paddingTop: 12},
  pageHeaderTv: {alignItems: 'center', paddingBottom: 18, paddingHorizontal: 0, paddingTop: 8},
  pageHeaderCopy: {flex: 1},
  pageTitle: {color: color.silver},
  pageSubtitleMobile: {color: color.dimSilver, fontFamily: font.regular, fontSize: 13, lineHeight: 18, marginTop: 2},
  pageSubtitleTv: {color: color.dimSilver, fontFamily: font.regular, fontSize: 19, lineHeight: 26, marginTop: 4},
  mediaRow: {marginBottom: 28, paddingLeft: 16},
  mediaRowTv: {marginBottom: 42, paddingLeft: 0},
  mediaRowFlush: {paddingLeft: 0},
  mediaRowContent: {gap: 7, paddingRight: 16, paddingTop: 10},
  mediaRowContentTv: {gap: 18, paddingRight: 72, paddingTop: 16},
  grid: {gap: 18, paddingBottom: 108},
  gridStatic: {flexDirection: 'row', flexWrap: 'wrap'},
  gridTv: {gap: 30, paddingBottom: 90},
  list: {gap: 8, paddingBottom: 108},
  listTv: {gap: 12, paddingBottom: 90},
  listRow: {alignItems: 'center', backgroundColor: color.recess, borderColor: color.transparent, borderBottomColor: color.lineSoft, borderBottomWidth: 1, borderWidth: 3, flexDirection: 'row', gap: 12, minHeight: 118, padding: 8},
  listRowTv: {gap: 20, minHeight: 158, padding: 10},
  listRowFocused: {backgroundColor: color.raisedSlate, borderColor: color.focus},
  listRowPressed: {backgroundColor: color.brightSlate},
  listImageMobile: {borderRadius: 6, height: 88, width: 156},
  listImageTv: {borderRadius: 6, height: 132, width: 235},
  listCopy: {flex: 1},
  listTitleMobile: {color: color.silver, fontFamily: font.demi, fontSize: 17, lineHeight: 21},
  listTitleTv: {color: color.silver, fontFamily: font.demi, fontSize: 25, lineHeight: 31},
  listMetaMobile: {color: color.dimSilver, fontFamily: font.medium, fontSize: 12, lineHeight: 17, marginTop: 2},
  listMetaTv: {color: color.dimSilver, fontFamily: font.medium, fontSize: 18, lineHeight: 24, marginTop: 3},
  listSummaryMobile: {color: color.softSilver, fontFamily: font.regular, fontSize: 13, lineHeight: 18, marginTop: 5},
  listSummaryTv: {color: color.softSilver, fontFamily: font.regular, fontSize: 19, lineHeight: 27, marginTop: 7},
});
