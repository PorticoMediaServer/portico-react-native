import React, {useMemo} from 'react';
import {ScrollView, StyleSheet, Text, View} from 'react-native';
import {
  ArrowDownAZ,
  ChevronDown,
  Grid3X3,
  List,
  SlidersHorizontal,
} from 'lucide-react-native';
import type {PrototypePlatform} from '@portico-prototypes/contract';
import {itemsForIds, libraries} from '@portico-prototypes/fixtures';
import {usePrototype} from '@portico-prototypes/runtime';
import {color, font} from '../tokens';
import {
  ControlButton,
  EmptyState,
  Focusable,
  InlineNotice,
  PosterSkeletonGrid,
  UnderlineTabs,
} from '../primitives';
import {HeaderUtilities, MediaGrid} from '../sharedComponents';
import {usePrototypeUi} from '../uiState';
import {usePorticoNavigation} from '../navigation';

export function LibraryScreen({platform}: {platform: PrototypePlatform}) {
  const television = platform === 'tv';
  const {openDetail, openSearch} = usePorticoNavigation();
  const {state} = usePrototype();
  const {
    filtersEnabled,
    libraryTab,
    selectedLibraryId,
    setLibraryTab,
    setOverlay,
    sort,
    viewMode,
  } = usePrototypeUi();
  const library = libraries.find(candidate => candidate.id === selectedLibraryId) ?? libraries[0];
  const items = useMemo(() => {
    if (!library) {
      return [];
    }
    const source = itemsForIds(library.itemIds);
    const filtered = filtersEnabled ? source.filter(item => item.year && item.year >= 2010) : source;
    return [...filtered].sort((left, right) => sort === 'Year' ? (right.year ?? 0) - (left.year ?? 0) : left.title.localeCompare(right.title));
  }, [filtersEnabled, library, sort]);

  if (!library) {
    return null;
  }
  if (state.scenario === 'first-load') {
    return (
      <ScrollView contentContainerStyle={[styles.page, television && styles.pageTv]}>
        <LibraryHeading libraryName={library.name} platform={platform} />
        <PosterSkeletonGrid platform={platform} />
      </ScrollView>
    );
  }

  const listHeader = (
    <View>
      <LibraryHeading libraryName={library.name} onSearch={openSearch} platform={platform} />
      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        style={television ? styles.tabsViewportTv : styles.tabsViewportMobile}>
        <UnderlineTabs active={libraryTab} onChange={setLibraryTab} platform={platform} tabs={library.tabs} />
      </ScrollView>
      <View style={[styles.toolbar, television && styles.toolbarTv]}>
        <ScrollView contentContainerStyle={[styles.toolbarScroll, television && styles.toolbarScrollTv]} horizontal showsHorizontalScrollIndicator={false}>
          <ControlButton
            icon={SlidersHorizontal}
            label={filtersEnabled ? 'Filter (1)' : 'Filter'}
            onPress={() => setOverlay('filters')}
            platform={platform}
            selected={filtersEnabled}
          />
          <ControlButton icon={ArrowDownAZ} label={`Sort: ${sort}`} onPress={() => setOverlay('sort')} platform={platform} />
          <ControlButton
            icon={viewMode === 'grid' ? Grid3X3 : List}
            label={viewMode === 'grid' ? 'Grid' : 'List'}
            onPress={() => setOverlay('view')}
            platform={platform}
          />
        </ScrollView>
        <Text style={television ? styles.resultCountTv : styles.resultCountMobile}>{items.length} results</Text>
      </View>

      {state.scenario === 'stale-offline' ? (
        <InlineNotice kind="warning" message="Showing the last cached library results while this server is offline." platform={platform} />
      ) : null}
    </View>
  );

  if (state.scenario === 'filtered-empty' || items.length === 0) {
    return (
      <ScrollView
        contentContainerStyle={[styles.page, television && styles.pageTv]}
        showsVerticalScrollIndicator={false}
        testID={`portico-four-library-${platform}`}>
        {listHeader}
        {state.scenario === 'filtered-empty' ? (
        <EmptyState
          actionLabel="Clear filters"
          message="Nothing in this library matches the active filters. Your library and sorting choices are unchanged."
          onAction={() => setOverlay('filters')}
          platform={platform}
          title="No matching media"
        />
        ) : (
        <EmptyState
          message="This library does not contain any visible media yet."
          platform={platform}
          title={`${library.name} is empty`}
        />
        )}
      </ScrollView>
    );
  }

  return (
    <MediaGrid
      contentContainerStyle={[styles.page, television && styles.pageTv]}
      items={items}
      listHeader={listHeader}
      onOpen={item => openDetail(item.id)}
      platform={platform}
      testID={`portico-four-library-${platform}`}
      viewMode={viewMode}
    />
  );
}

function LibraryHeading({libraryName, onSearch, platform}: {libraryName: string; onSearch?(): void; platform: PrototypePlatform}) {
  const television = platform === 'tv';
  const {setOverlay} = usePrototypeUi();
  const leftContent = (
    <View style={styles.headingCopy}>
        {television ? (
          <Text ellipsizeMode="tail" numberOfLines={1} style={[styles.libraryTitleTv, styles.title]}>{libraryName}</Text>
        ) : (
          <Focusable
            accessibilityLabel={`Current library: ${libraryName}. Choose another library.`}
            accessibilityRole="button"
            onPress={() => setOverlay('library')}
            platform={platform}
            style={styles.librarySelector}
            focusedStyle={styles.librarySelectorFocused}
            pressedStyle={styles.librarySelectorPressed}>
            <Text ellipsizeMode="tail" numberOfLines={1} style={[styles.libraryTitleMobile, styles.title]}>{libraryName}</Text>
            <ChevronDown color={color.dimSilver} size={22} strokeWidth={2} />
          </Focusable>
        )}
        <Text style={television ? styles.serverLabelTv : styles.serverLabelMobile}>Portico Home Server</Text>
    </View>
  );
  return <HeaderUtilities flush leftContent={leftContent} onSearch={onSearch} platform={platform} />;
}

const styles = StyleSheet.create({
  page: {backgroundColor: color.projector, minHeight: '100%', paddingHorizontal: 16, paddingTop: 8},
  pageTv: {paddingLeft: 0, paddingRight: 72, paddingTop: 10},
  headingCopy: {flex: 1},
  librarySelector: {alignItems: 'center', alignSelf: 'flex-start', borderColor: color.transparent, borderRadius: 8, borderWidth: 2, flexDirection: 'row', gap: 5, marginLeft: -6, maxWidth: 240, paddingHorizontal: 6, paddingVertical: 1},
  librarySelectorFocused: {backgroundColor: color.raisedSlate, borderColor: color.focus},
  librarySelectorPressed: {backgroundColor: color.brightSlate},
  title: {color: color.silver},
  libraryTitleMobile: {fontFamily: font.bold, fontSize: 22, letterSpacing: -0.45, lineHeight: 26, maxWidth: 202},
  libraryTitleTv: {fontFamily: font.bold, fontSize: 36, letterSpacing: -0.8, lineHeight: 41, maxWidth: 720},
  serverLabelMobile: {color: color.dimSilver, fontFamily: font.medium, fontSize: 12, lineHeight: 14, marginTop: -3},
  serverLabelTv: {color: color.dimSilver, fontFamily: font.medium, fontSize: 18, lineHeight: 21, marginTop: -2},
  tabsViewportMobile: {flexGrow: 0, height: 49},
  tabsViewportTv: {flexGrow: 0, height: 68},
  toolbar: {alignItems: 'center', flexDirection: 'row', justifyContent: 'space-between', marginBottom: 18, marginTop: 16},
  toolbarTv: {marginBottom: 26, marginTop: 22},
  toolbarScroll: {gap: 8, paddingRight: 12},
  toolbarScrollTv: {gap: 12, paddingRight: 18},
  resultCountMobile: {color: color.dimSilver, fontFamily: font.medium, fontSize: 12, lineHeight: 16},
  resultCountTv: {color: color.dimSilver, fontFamily: font.medium, fontSize: 18, lineHeight: 24},
});
