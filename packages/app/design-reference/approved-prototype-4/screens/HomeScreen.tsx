import React, {useState} from 'react';
import {ImageBackground, ScrollView, StyleSheet, Text, View} from 'react-native';
import {Heart, Info, Plus} from 'lucide-react-native';
import type {PrototypePlatform} from '@portico-prototypes/contract';
import {homeRows, itemsForIds, mediaById} from '@portico-prototypes/fixtures';
import {usePrototype} from '@portico-prototypes/runtime';
import {color, font} from '../tokens';
import {
  ArtworkScrim,
  EmptyState,
  HeroPlayButton,
  IconButton,
  InlineNotice,
  Skeleton,
} from '../primitives';
import {HeaderUtilities, MediaRow} from '../sharedComponents';
import {usePrototypeUi} from '../uiState';
import {usePorticoNavigation} from '../navigation';

const continueWatchingRow = homeRows.find(row => row.id === 'continue') ?? homeRows[0];
const continueWatchingIds = continueWatchingRow?.itemIds ?? [];

export function HomeScreen({platform}: {platform: PrototypePlatform}) {
  const television = platform === 'tv';
  const {openDetail, openPlayer, openSearch} = usePorticoNavigation();
  const {state, toggleFavorite, toggleWatchlist} = usePrototype();
  const {heroIndex, setHeroIndex} = usePrototypeUi();
  const [requestInitialTVFocus, setRequestInitialTVFocus] = useState(television);
  const selectedHeroIndex = television ? heroIndex : 0;
  const heroId = continueWatchingIds[selectedHeroIndex] ?? continueWatchingIds[0];
  const hero = heroId ? mediaById.get(heroId) : undefined;

  if (!hero) {
    return null;
  }
  if (state.scenario === 'empty-server') {
    return (
      <EmptyState
        actionLabel="Refresh libraries"
        message="This server has no visible media yet. Add or share a library, then refresh Home."
        onAction={() => undefined}
        platform={platform}
        title="Nothing to watch yet"
      />
    );
  }
  if (state.scenario === 'first-load') {
    return <HomeLoading platform={platform} />;
  }

  const open = (id: string) => openDetail(id);
  return (
    <ScrollView
      contentContainerStyle={styles.page}
      showsVerticalScrollIndicator={false}
      testID={`portico-four-home-${platform}`}>
      <View style={[styles.hero, television ? styles.heroTv : styles.heroMobile]}>
        <ImageBackground
          resizeMode="cover"
          source={state.scenario === 'artwork-failure' ? undefined : {uri: hero.backdrop}}
          style={styles.heroArtwork}>
          <ArtworkScrim platform={platform} />
          <View style={[styles.heroInner, television ? styles.heroInnerTv : styles.heroInnerMobile]}>
            <HeaderUtilities artworkHeader onSearch={openSearch} platform={platform} />
            <View style={[styles.heroCopy, television ? styles.heroCopyTv : styles.heroCopyMobile]}>
              <Text numberOfLines={2} style={[television ? styles.heroTitleTv : styles.heroTitleMobile, styles.heroTitle]}>{hero.title}</Text>
              <Text style={television ? styles.heroMetaTv : styles.heroMetaMobile}>
                {[hero.kind === 'show' ? 'TV Show' : 'Movie', hero.year, hero.contentRating, hero.duration].filter(Boolean).join('  ·  ')}
              </Text>
              <Text numberOfLines={television ? 2 : 3} style={television ? styles.heroSummaryTv : styles.heroSummaryMobile}>{hero.summary}</Text>
              <View style={[styles.heroActions, television && styles.heroActionsTv]}>
                <HeroPlayButton
                  label={typeof hero.progress === 'number' ? 'Resume' : 'Play'}
                  onFocusChange={focused => {
                    if (focused && requestInitialTVFocus) {
                      setRequestInitialTVFocus(false);
                    }
                  }}
                  onPress={() => openPlayer(hero.id)}
                  platform={platform}
                  requestInitialTVFocus={requestInitialTVFocus}
                  testID="portico-home-initial-focus"
                />
                <IconButton
                  icon={state.watchlist.includes(hero.id) ? Heart : Plus}
                  label={state.watchlist.includes(hero.id) ? 'Remove from Saved' : 'Add to Saved'}
                  onPress={() => toggleWatchlist(hero.id)}
                  platform={platform}
                  selected={state.watchlist.includes(hero.id)}
                />
                <IconButton icon={Info} label="Details" onPress={() => openDetail(hero.id)} platform={platform} />
                <IconButton
                  icon={Heart}
                  label={state.favorites.includes(hero.id) ? 'Remove favorite' : 'Favorite'}
                  onPress={() => toggleFavorite(hero.id)}
                  platform={platform}
                  selected={state.favorites.includes(hero.id)}
                />
              </View>
            </View>
          </View>
        </ImageBackground>
      </View>

      {state.scenario === 'stale-offline' ? (
        <View style={television ? styles.noticeTv : styles.noticeMobile}>
          <InlineNotice kind="warning" message="Offline — showing media cached from 12 minutes ago." platform={platform} />
        </View>
      ) : null}

      {homeRows.map((row, index) => {
        if (state.scenario === 'partial-row-failure' && index === 2) {
          return (
            <View key={row.id} style={television ? styles.rowFailureTv : styles.rowFailureMobile}>
              <InlineNotice
                actionLabel="Retry row"
                kind="error"
                message={`${row.title} could not be loaded. Other Home rows are still available.`}
                onAction={() => undefined}
                platform={platform}
              />
            </View>
          );
        }
        return (
          <MediaRow
            items={itemsForIds(row.itemIds)}
            key={row.id}
            onItemFocus={television && row.id === 'continue' ? (_item, focusedIndex) => setHeroIndex(focusedIndex) : undefined}
            onOpen={item => open(item.id)}
            platform={platform}
            shape="poster"
            title={row.title}
          />
        );
      })}
    </ScrollView>
  );
}

function HomeLoading({platform}: {platform: PrototypePlatform}) {
  const television = platform === 'tv';
  return (
    <ScrollView contentContainerStyle={styles.page} showsVerticalScrollIndicator={false}>
      <View style={[styles.loadingHero, television ? styles.heroTv : styles.heroMobile]}>
        <HeaderUtilities platform={platform} />
        <View style={[styles.loadingHeroCopy, television && styles.loadingHeroCopyTv]}>
          <Skeleton height={television ? 64 : 42} width={television ? 470 : 270} />
          <Skeleton height={television ? 24 : 15} style={styles.loadingMeta} width={television ? 320 : 190} />
          <Skeleton height={television ? 66 : 54} style={styles.loadingSummary} width={television ? 690 : '92%'} />
          <Skeleton height={television ? 60 : 46} style={styles.loadingAction} width={television ? 220 : 150} />
        </View>
      </View>
      {[0, 1].map(index => (
        <View key={index} style={television ? styles.loadingRowTv : styles.loadingRowMobile}>
          <Skeleton height={television ? 30 : 21} width={television ? 260 : 190} />
          <View style={styles.loadingCards}>
            {Array.from({length: television ? 5 : 3}, (_, card) => (
              <Skeleton height={television ? 170 : 112} key={card} width={television ? 300 : 198} />
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
  heroArtwork: {height: '100%', width: '100%'},
  heroInner: {flex: 1},
  heroInnerMobile: {paddingTop: 2},
  heroInnerTv: {paddingRight: 72, paddingTop: 2},
  heroCopy: {marginTop: 'auto'},
  heroCopyMobile: {maxWidth: 520, paddingBottom: 40, paddingHorizontal: 20},
  heroCopyTv: {maxWidth: 910, paddingBottom: 50},
  heroTitle: {color: color.silver, textShadowColor: 'rgba(0,0,0,0.45)', textShadowOffset: {height: 1, width: 0}, textShadowRadius: 8},
  heroTitleMobile: {fontFamily: font.bold, fontSize: 42, letterSpacing: -1.4, lineHeight: 44},
  heroTitleTv: {fontFamily: font.bold, fontSize: 66, letterSpacing: -2.1, lineHeight: 69},
  heroMetaMobile: {color: color.softSilver, fontFamily: font.demi, fontSize: 14, lineHeight: 19, marginTop: 8},
  heroMetaTv: {color: color.softSilver, fontFamily: font.demi, fontSize: 22, lineHeight: 29, marginTop: 10},
  heroSummaryMobile: {color: color.softSilver, fontFamily: font.regular, fontSize: 15, lineHeight: 21, marginTop: 10},
  heroSummaryTv: {color: color.softSilver, fontFamily: font.regular, fontSize: 23, lineHeight: 32, marginTop: 12, maxWidth: 820},
  heroActions: {alignItems: 'center', flexDirection: 'row', gap: 8, marginTop: 18},
  heroActionsTv: {gap: 12, marginTop: 24},
  noticeMobile: {marginBottom: 22, marginHorizontal: 16, marginTop: -4},
  noticeTv: {marginBottom: 30, marginTop: 2},
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
  loadingCards: {flexDirection: 'row', gap: 12, marginTop: 14, overflow: 'hidden'},
});
