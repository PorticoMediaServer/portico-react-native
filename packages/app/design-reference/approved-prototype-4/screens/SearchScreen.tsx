import React, {useMemo, useState} from 'react';
import {Image, ScrollView, StyleSheet, Text, TextInput, View} from 'react-native';
import {ArrowLeft, Search, X} from 'lucide-react-native';
import type {MediaItem, PrototypePlatform} from '@portico-prototypes/contract';
import {mediaItems} from '@portico-prototypes/fixtures';
import {color, font, mobileType, tvType} from '../tokens';
import {EmptyState, Focusable, IconButton, useContentFocus} from '../primitives';
import {HeaderUtilities} from '../sharedComponents';
import {usePrototypeUi} from '../uiState';
import {usePorticoNavigation} from '../navigation';

export function SearchScreen({platform}: {platform: PrototypePlatform}) {
  const television = platform === 'tv';
  const {back, openDetail} = usePorticoNavigation();
  const {searchQuery, setSearchQuery} = usePrototypeUi();
  const onContentFocus = useContentFocus();
  const [searchFocused, setSearchFocused] = useState(false);
  const results = useMemo(() => {
    const query = searchQuery.trim().toLowerCase();
    if (!query) {
      return mediaItems.slice(0, 6);
    }
    return mediaItems.filter(item => [item.title, item.subtitle, item.genre, item.parentTitle].filter(Boolean).join(' ').toLowerCase().includes(query)).slice(0, 12);
  }, [searchQuery]);

  return (
    <ScrollView
      contentContainerStyle={[styles.page, television && styles.pageTv]}
      keyboardShouldPersistTaps="handled"
      showsVerticalScrollIndicator={false}
      testID={`portico-four-search-${platform}`}>
      <HeaderUtilities
        flush
        leftContent={<View style={styles.headingLeft}>
          {!television ? <IconButton icon={ArrowLeft} label="Back" onPress={back} platform={platform} /> : null}
          <Text style={[television ? tvType.title : mobileType.title, styles.title]}>Search</Text>
        </View>}
        platform={platform}
      />
      <View style={[styles.searchField, television && styles.searchFieldTv, searchFocused && styles.searchFieldFocused]}>
        <Search color={color.dimSilver} size={television ? 30 : 21} strokeWidth={2} />
        <TextInput
          accessibilityLabel="Search all media"
          autoCapitalize="none"
          autoCorrect={false}
          onChangeText={setSearchQuery}
          onBlur={() => setSearchFocused(false)}
          onFocus={() => {
            setSearchFocused(true);
            if (television) {
              onContentFocus();
            }
          }}
          placeholder="Movies, shows, people, music, and channels"
          placeholderTextColor={color.mutedSilver}
          returnKeyType="search"
          selectionColor={color.screenBlue}
          style={television ? styles.searchInputTv : styles.searchInputMobile}
          value={searchQuery}
        />
        {searchQuery ? <IconButton icon={X} label="Clear search" onPress={() => setSearchQuery('')} platform={platform} /> : null}
      </View>

      {!searchQuery ? (
        <View style={[styles.recent, television && styles.recentTv]}>
          <Text style={television ? styles.recentLabelTv : styles.recentLabelMobile}>Recent searches</Text>
          <View style={styles.recentQueries}>
            {['Fargo', 'Science fiction', 'Bonobo'].map(query => (
              <Focusable
                accessibilityRole="button"
                key={query}
                onPress={() => setSearchQuery(query)}
                platform={platform}
                style={[styles.recentQuery, television && styles.recentQueryTv]}
                focusedStyle={styles.recentQueryFocused}
                pressedStyle={styles.recentQueryPressed}>
                <Text style={television ? styles.recentQueryTextTv : styles.recentQueryTextMobile}>{query}</Text>
              </Focusable>
            ))}
          </View>
        </View>
      ) : null}

      <Text style={[television ? tvType.section : mobileType.section, styles.resultsTitle]}>{searchQuery ? `Results for “${searchQuery}”` : 'Suggested for you'}</Text>
      {results.length ? (
        <View style={[styles.results, television && styles.resultsTv]}>
          {results.map(item => <SearchResult item={item} key={item.id} onPress={() => openDetail(item.id)} platform={platform} />)}
        </View>
      ) : (
        <EmptyState message="Try another title, creator, channel, or category." platform={platform} title="No results found" />
      )}
    </ScrollView>
  );
}

function SearchResult({item, onPress, platform}: {item: MediaItem; onPress(): void; platform: PrototypePlatform}) {
  const television = platform === 'tv';
  return (
    <Focusable
      accessibilityLabel={`${item.title}. ${item.kind}.`}
      accessibilityRole="button"
      onPress={onPress}
      platform={platform}
      style={[styles.result, television && styles.resultTv]}
      focusedStyle={styles.resultFocused}
      pressedStyle={styles.resultPressed}>
      <Image resizeMode="cover" source={{uri: item.poster}} style={television ? styles.resultImageTv : styles.resultImageMobile} />
      <View style={styles.resultCopy}>
        <Text numberOfLines={1} style={television ? styles.resultTitleTv : styles.resultTitleMobile}>{item.title}</Text>
        <Text numberOfLines={1} style={television ? styles.resultMetaTv : styles.resultMetaMobile}>{[item.year, item.kind, item.duration, item.parentTitle].filter(Boolean).join('  ·  ')}</Text>
        {item.summary ? <Text numberOfLines={television ? 2 : 3} style={television ? styles.resultSummaryTv : styles.resultSummaryMobile}>{item.summary}</Text> : null}
      </View>
    </Focusable>
  );
}

const styles = StyleSheet.create({
  page: {backgroundColor: color.projector, minHeight: '100%', paddingBottom: 100, paddingHorizontal: 16, paddingTop: 10},
  pageTv: {paddingBottom: 80, paddingLeft: 0, paddingRight: 72, paddingTop: 12},
  headingLeft: {alignItems: 'center', flex: 1, flexDirection: 'row', gap: 12},
  title: {color: color.silver},
  searchField: {alignItems: 'center', backgroundColor: color.slate, borderColor: color.line, borderRadius: 8, borderWidth: 3, flexDirection: 'row', gap: 10, minHeight: 52, paddingLeft: 14, paddingRight: 4},
  searchFieldTv: {gap: 14, minHeight: 68, maxWidth: 1200, paddingLeft: 20},
  searchFieldFocused: {borderColor: color.focus, borderWidth: 3},
  searchInputMobile: {color: color.silver, flex: 1, fontFamily: font.regular, fontSize: 16, height: 50, paddingVertical: 0},
  searchInputTv: {color: color.silver, flex: 1, fontFamily: font.regular, fontSize: 24, height: 66, paddingVertical: 0},
  recent: {marginTop: 18},
  recentTv: {marginTop: 24},
  recentLabelMobile: {color: color.dimSilver, fontFamily: font.medium, fontSize: 12},
  recentLabelTv: {color: color.dimSilver, fontFamily: font.medium, fontSize: 18},
  recentQueries: {flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginTop: 8},
  recentQuery: {backgroundColor: color.recess, borderColor: color.line, borderRadius: 8, borderWidth: 2, minHeight: 40, paddingHorizontal: 14, paddingVertical: 9},
  recentQueryTv: {minHeight: 54, paddingHorizontal: 20, paddingVertical: 12},
  recentQueryFocused: {backgroundColor: color.raisedSlate, borderColor: color.focus},
  recentQueryPressed: {backgroundColor: color.brightSlate},
  recentQueryTextMobile: {color: color.softSilver, fontFamily: font.medium, fontSize: 13},
  recentQueryTextTv: {color: color.softSilver, fontFamily: font.medium, fontSize: 19},
  resultsTitle: {color: color.silver, marginBottom: 14, marginTop: 28},
  results: {gap: 6},
  resultsTv: {columnGap: 12, flexDirection: 'row', flexWrap: 'wrap', rowGap: 12},
  result: {alignItems: 'center', backgroundColor: color.recess, borderColor: color.transparent, borderRadius: 8, borderWidth: 3, flexDirection: 'row', gap: 12, minHeight: 126, padding: 8},
  resultTv: {gap: 18, minHeight: 174, padding: 10, width: '49.4%'},
  resultFocused: {backgroundColor: color.raisedSlate, borderColor: color.focus},
  resultPressed: {backgroundColor: color.brightSlate},
  resultImageMobile: {borderRadius: 5, height: 106, width: 71},
  resultImageTv: {borderRadius: 6, height: 150, width: 100},
  resultCopy: {flex: 1},
  resultTitleMobile: {color: color.silver, fontFamily: font.demi, fontSize: 16, lineHeight: 21},
  resultTitleTv: {color: color.silver, fontFamily: font.demi, fontSize: 24, lineHeight: 30},
  resultMetaMobile: {color: color.screenBlue, fontFamily: font.medium, fontSize: 12, lineHeight: 17, marginTop: 2},
  resultMetaTv: {color: color.screenBlue, fontFamily: font.medium, fontSize: 18, lineHeight: 24, marginTop: 3},
  resultSummaryMobile: {color: color.dimSilver, fontFamily: font.regular, fontSize: 13, lineHeight: 18, marginTop: 5},
  resultSummaryTv: {color: color.dimSilver, fontFamily: font.regular, fontSize: 19, lineHeight: 26, marginTop: 7},
});
