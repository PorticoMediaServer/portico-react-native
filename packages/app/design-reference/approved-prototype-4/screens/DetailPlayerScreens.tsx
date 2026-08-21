import React from 'react';
import {ImageBackground, ScrollView, StyleSheet, Text, View} from 'react-native';
import {useSafeAreaInsets} from 'react-native-safe-area-context';
import {
  ArrowLeft,
  Check,
  Heart,
  List,
  ListPlus,
  Pause,
  Play,
  RotateCcw,
  RotateCw,
  Settings,
  SkipBack,
  SkipForward,
  Subtitles,
  Users,
  X,
  type LucideIcon,
} from 'lucide-react-native';
import type {MediaItem, PrototypePlatform} from '@portico-prototypes/contract';
import {mediaById, mediaItems} from '@portico-prototypes/fixtures';
import {usePrototype} from '@portico-prototypes/runtime';
import {color, font, mobileType, tvType} from '../tokens';
import {
  ArtworkScrim,
  EmptyState,
  HeroPlayButton,
  Focusable,
  IconButton,
  InlineNotice,
  MediaCard,
  SectionHeading,
  UnderlineTabs,
} from '../primitives';
import {HeaderUtilities, MediaRow} from '../sharedComponents';
import {usePorticoNavigation} from '../navigation';
import {usePrototypeUi} from '../uiState';

export function DetailScreen({mediaId, platform}: {mediaId: string; platform: PrototypePlatform}) {
  const television = platform === 'tv';
  const item = mediaById.get(mediaId);
  const {back, openDetail, openPlayer} = usePorticoNavigation();
  const {play, state, toggleFavorite, toggleWatchlist} = usePrototype();

  if (!item) {
    return <EmptyState actionLabel="Go back" message="This item may have been removed or is no longer shared with this profile." onAction={back} platform={platform} title="Media not found" />;
  }

  const unavailable = state.scenario === 'media-unavailable';
  const related = mediaItems.filter(candidate => candidate.id !== item.id && (candidate.genre === item.genre || candidate.kind === item.kind)).slice(0, 6);
  const series = item.kind === 'show' || item.kind === 'season';
  const actionPlay = () => {
    if (unavailable) {
      return;
    }
    play(item.id);
    openPlayer(item.id);
  };

  return (
    <ScrollView
      contentContainerStyle={styles.page}
      showsVerticalScrollIndicator={false}
      testID={`portico-four-detail-${platform}`}>
      <ImageBackground
        resizeMode="cover"
        source={state.scenario === 'artwork-failure' ? undefined : {uri: item.backdrop}}
        style={[styles.hero, television ? styles.heroTv : styles.heroMobile]}>
        <ArtworkScrim platform={platform} strong />
        {!television ? (
          <HeaderUtilities
            artworkHeader
            leftContent={<IconButton icon={ArrowLeft} label="Back" onPress={back} platform={platform} />}
            onMore={() => undefined}
            platform={platform}
            showProfile={false}
          />
        ) : null}
        <View style={[styles.heroCopy, television ? styles.heroCopyTv : styles.heroCopyMobile]}>
          {item.parentTitle ? <Text style={television ? styles.parentTv : styles.parentMobile}>{item.parentTitle}</Text> : null}
          <Text numberOfLines={2} style={[television ? styles.detailTitleTv : styles.detailTitleMobile, styles.title]}>{item.title}</Text>
          <Text style={television ? styles.metaTv : styles.metaMobile}>
            {[item.subtitle, item.year, item.contentRating, item.duration, item.genre].filter(Boolean).join('  ·  ')}
          </Text>
          <Text numberOfLines={television ? 2 : 3} style={television ? styles.summaryTv : styles.summaryMobile}>{item.summary}</Text>
          {typeof item.progress === 'number' ? (
            <View style={[styles.resumeProgress, television && styles.resumeProgressTv]}>
              <View style={[styles.resumeProgressValue, {width: `${item.progress}%`}]} />
            </View>
          ) : null}
          <View style={[styles.actions, television && styles.actionsTv]}>
            <HeroPlayButton
              label={unavailable ? 'Unavailable' : typeof item.progress === 'number' ? 'Resume' : 'Play'}
              onPress={actionPlay}
              platform={platform}
            />
            <IconButton
              icon={state.watchlist.includes(item.id) ? Check : ListPlus}
              label={state.watchlist.includes(item.id) ? 'Remove from Saved' : 'Add to Saved'}
              onPress={() => toggleWatchlist(item.id)}
              platform={platform}
              selected={state.watchlist.includes(item.id)}
            />
            <IconButton
              icon={Heart}
              label={state.favorites.includes(item.id) ? 'Remove favorite' : 'Favorite'}
              onPress={() => toggleFavorite(item.id)}
              platform={platform}
              selected={state.favorites.includes(item.id)}
            />
          </View>
        </View>
      </ImageBackground>

      <View style={[styles.detailBody, television && styles.detailBodyTv]}>
        {unavailable ? (
          <InlineNotice kind="error" message="Metadata is available, but this server cannot prepare a playable source for this device." platform={platform} />
        ) : null}
        {series ? (
          <SeriesBody item={item} onOpen={openDetail} onPlay={openPlayer} platform={platform} />
        ) : (
          <MovieBody item={item} platform={platform} />
        )}
        {related.length ? <MediaRow flush items={related} onOpen={candidate => openDetail(candidate.id)} platform={platform} shape="poster" title="More like this" /> : null}
      </View>
    </ScrollView>
  );
}

function MovieBody({item, platform}: {item: MediaItem; platform: PrototypePlatform}) {
  const television = platform === 'tv';
  return (
    <View style={[styles.movieBody, television && styles.movieBodyTv]}>
      <Text style={[television ? tvType.section : mobileType.section, styles.bodyHeading]}>Details</Text>
      <View style={[styles.factGrid, television && styles.factGridTv]}>
        <Fact label="Video" platform={platform} value="4K · HEVC Main 10" />
        <Fact label="Audio" platform={platform} value="English · 5.1" />
        <Fact label="Subtitles" platform={platform} value="English (SDH)" />
        <Fact label="Source" platform={platform} value="Portico Home Server" />
      </View>
      <Text style={[television ? tvType.section : mobileType.section, styles.bodyHeading, styles.secondaryHeading]}>About</Text>
      <Text style={television ? styles.aboutTv : styles.aboutMobile}>{item.summary}</Text>
    </View>
  );
}

function Fact({label, platform, value}: {label: string; platform: PrototypePlatform; value: string}) {
  const television = platform === 'tv';
  return (
    <View style={styles.fact}>
      <Text style={television ? styles.factLabelTv : styles.factLabelMobile}>{label}</Text>
      <Text style={television ? styles.factValueTv : styles.factValueMobile}>{value}</Text>
    </View>
  );
}

function SeriesBody({
  item,
  onOpen,
  onPlay,
  platform,
}: {
  item: MediaItem;
  onOpen(id: string): void;
  onPlay(id: string): void;
  platform: PrototypePlatform;
}) {
  const television = platform === 'tv';
  const episode = mediaById.get('fargo-castle');
  const episodes = episode ? [
    {...episode, id: `${item.id}-episode-1`, subtitle: 'S2 E8', title: 'Loplop', progress: undefined},
    episode,
    {...episode, id: `${item.id}-episode-3`, subtitle: 'S2 E10', title: 'Palindrome', progress: undefined},
  ] : [];
  return (
    <View style={styles.seriesBody}>
      <SectionHeading platform={platform} title="Episodes" />
      <ScrollView horizontal showsHorizontalScrollIndicator={false}>
        <UnderlineTabs active="Season 2" onChange={() => undefined} platform={platform} tabs={['Season 1', 'Season 2', 'Season 3']} />
      </ScrollView>
      <ScrollView contentContainerStyle={[styles.episodes, television && styles.episodesTv]} horizontal showsHorizontalScrollIndicator={false}>
        {episodes.map((candidate, index) => (
          <View key={candidate.id} style={styles.episodeWrapper}>
            <MediaCard item={candidate} onPress={() => index === 1 ? onOpen('fargo-castle') : onPlay(item.id)} platform={platform} shape="landscape" width={television ? 360 : 250} />
          </View>
        ))}
      </ScrollView>
    </View>
  );
}

export function PlayerScreen({mediaId, platform}: {mediaId: string; platform: PrototypePlatform}) {
  const television = platform === 'tv';
  const item = mediaById.get(mediaId) ?? mediaById.get('saturday-cinema');
  const {back} = usePorticoNavigation();
  const {play, seek, state, togglePlaying} = usePrototype();
  const {playerPanel: panel, setPlayerPanel: setPanel} = usePrototypeUi();
  const insets = useSafeAreaInsets();

  if (!item) {
    return null;
  }
  if (state.scenario === 'playback-fatal') {
    return (
      <View style={styles.playerFailure}>
        <EmptyState actionLabel="Back to details" message="No compatible source could be prepared. Your playback position is safe." onAction={back} platform={platform} title="Playback could not start" />
      </View>
    );
  }

  const playing = state.playingId === item.id ? state.playing : true;
  const currentProgress = state.progress || item.progress || 34;
  return (
    <ImageBackground
      resizeMode="cover"
      source={{uri: item.backdrop}}
      style={styles.player}
      testID={`portico-four-player-${platform}`}>
      <View style={styles.playerScrim} />
      {!television ? (
        <View style={[styles.playerTop, {paddingTop: insets.top + 8}]}>
          <IconButton icon={X} label="Close player" onPress={() => {setPanel(null); back();}} platform={platform} />
        </View>
      ) : null}
      <View style={[styles.playerIdentity, television ? styles.playerIdentityTv : {top: insets.top + 78}]}>
        <Text style={television ? styles.playerTitleTv : styles.playerTitleMobile}>{item.title}</Text>
        <Text style={television ? styles.playerMetaTv : styles.playerMetaMobile}>{item.parentTitle ? `${item.parentTitle}  ·  ${item.subtitle ?? ''}  ·  ${item.duration ?? ''}` : item.subtitle ?? [item.year, item.duration].filter(Boolean).join('  ·  ')}</Text>
      </View>
      {state.scenario === 'playback-buffering' ? (
        <View style={styles.buffering}>
          <Text style={television ? styles.bufferingTextTv : styles.bufferingTextMobile}>Reconnecting… playback will resume at 42:18</Text>
        </View>
      ) : <View style={styles.playerSpacer} />}
      <View style={[styles.playerBottom, television && styles.playerBottomTv]}>
        <View style={styles.playerTimes}>
          <Text style={television ? styles.playerTimeTv : styles.playerTimeMobile}>42:18</Text>
          <Text style={television ? styles.playerTimeTv : styles.playerTimeMobile}>1:59:02</Text>
        </View>
        <View style={[styles.playerProgress, television && styles.playerProgressTv]}>
          <View style={[styles.playerProgressValue, {width: `${currentProgress}%`}]} />
        </View>
        <View style={[styles.transportDock, television && styles.transportDockTv]}>
          <PlayerTransportButton icon={SkipBack} label="Previous" onPress={() => seek(0)} platform={platform} />
          <PlayerTransportButton icon={RotateCcw} label="Back 10 seconds" onPress={() => seek(currentProgress - 5)} platform={platform} />
          <PlayerTransportButton
            icon={playing ? Pause : Play}
            label={playing ? 'Pause' : 'Play'}
            main
            onPress={() => {
              if (!state.playingId) {
                play(item.id);
              } else {
                togglePlaying();
              }
            }}
            platform={platform}
          />
          <PlayerTransportButton icon={RotateCw} label="Forward 10 seconds" onPress={() => seek(currentProgress + 5)} platform={platform} />
          <PlayerTransportButton icon={SkipForward} label="Next" onPress={() => seek(100)} platform={platform} />
        </View>
      </View>
      <PlayerUtilityDock panel={panel} platform={platform} setPanel={setPanel} />
      {panel ? <PlayerUtilityPanel panel={panel} platform={platform} /> : null}
    </ImageBackground>
  );
}

function PlayerUtilityDock({panel, platform, setPanel}: {panel: string | null; platform: PrototypePlatform; setPanel(value: 'settings' | 'subtitles' | 'chapters' | 'friends' | 'queue' | null): void}) {
  const television = platform === 'tv';
  const actions: Array<{id: 'settings' | 'subtitles' | 'chapters' | 'friends' | 'queue'; icon: LucideIcon; label: string}> = [
    {id: 'settings', icon: Settings, label: 'Playback settings'},
    {id: 'subtitles', icon: Subtitles, label: 'Audio and subtitles'},
    {id: 'chapters', icon: List, label: 'Chapters'},
    {id: 'friends', icon: Users, label: 'Watch together'},
    {id: 'queue', icon: ListPlus, label: 'Queue'},
  ];
  return (
    <View style={[styles.utilityDock, television && styles.utilityDockTv]}>
      {actions.map(action => (
        <PlayerDockButton icon={action.icon} key={action.id} label={action.label} onPress={() => setPanel(panel === action.id ? null : action.id)} platform={platform} selected={panel === action.id} />
      ))}
    </View>
  );
}

function PlayerDockButton({icon: Icon, label, onPress, platform, selected}: {icon: LucideIcon; label: string; onPress(): void; platform: PrototypePlatform; selected: boolean}) {
  const television = platform === 'tv';
  return (
    <Focusable accessibilityLabel={label} accessibilityRole="button" onPress={onPress} platform={platform} style={[styles.dockButton, television && styles.dockButtonTv, selected && styles.dockButtonSelected]} focusedStyle={styles.dockButtonFocused} pressedStyle={styles.dockButtonPressed}>
      <Icon color={selected ? color.screenBlueStrong : color.silver} size={television ? 25 : 20} strokeWidth={2} />
    </Focusable>
  );
}

function PlayerUtilityPanel({panel, platform}: {panel: 'settings' | 'subtitles' | 'chapters' | 'friends' | 'queue'; platform: PrototypePlatform}) {
  const television = platform === 'tv';
  const content = {
    settings: ['Quality · Original', 'Playback speed · 1×', 'Direct play · Automatic'],
    subtitles: ['Audio · English 5.1', 'Subtitles · Off', 'Subtitle appearance'],
    chapters: ['1 · The Castle', '2 · The hotel', '3 · Sioux Falls'],
    friends: ['Start a watch-together room', 'Invite from this server'],
    queue: ['Up next · Palindrome', 'Then · Waiting for Dutch'],
  }[panel];
  return (
    <View style={[styles.utilityPanel, television && styles.utilityPanelTv]}>
      <Text style={television ? styles.utilityPanelTitleTv : styles.utilityPanelTitleMobile}>{panel === 'friends' ? 'Watch together' : panel[0]?.toUpperCase() + panel.slice(1)}</Text>
      {content.map(line => <Text key={line} style={television ? styles.utilityPanelRowTv : styles.utilityPanelRowMobile}>{line}</Text>)}
    </View>
  );
}

function PlayerTransportButton({icon: Icon, label, main, onPress, platform}: {icon: LucideIcon; label: string; main?: boolean; onPress(): void; platform: PrototypePlatform}) {
  const television = platform === 'tv';
  return (
    <Focusable accessibilityLabel={label} accessibilityRole="button" onPress={onPress} platform={platform} style={[styles.transportButton, television && styles.transportButtonTv, main && styles.transportButtonMain, main && television && styles.transportButtonMainTv]} focusedStyle={styles.transportButtonFocused} pressedStyle={styles.transportButtonPressed}>
      <Icon color={color.silver} fill={main && Icon === Play ? color.silver : 'none'} size={main ? (television ? 38 : 30) : (television ? 30 : 23)} strokeWidth={2} />
    </Focusable>
  );
}

const styles = StyleSheet.create({
  page: {backgroundColor: color.projector, paddingBottom: 60},
  hero: {backgroundColor: color.recess, width: '100%'},
  heroMobile: {height: 540},
  heroTv: {height: 570},
  topActions: {alignItems: 'center', flexDirection: 'row', gap: 8},
  heroCopy: {marginTop: 'auto'},
  heroCopyMobile: {paddingBottom: 42, paddingHorizontal: 20},
  heroCopyTv: {maxWidth: 1002, paddingBottom: 66, paddingRight: 72},
  parentMobile: {color: color.screenBlueStrong, fontFamily: font.demi, fontSize: 14, lineHeight: 19, marginBottom: 5},
  parentTv: {color: color.screenBlueStrong, fontFamily: font.demi, fontSize: 21, lineHeight: 28, marginBottom: 8},
  title: {color: color.silver},
  detailTitleMobile: {fontFamily: font.bold, fontSize: 40, letterSpacing: -1.1, lineHeight: 44},
  detailTitleTv: {fontFamily: font.bold, fontSize: 52, letterSpacing: -1.5, lineHeight: 58},
  metaMobile: {color: color.softSilver, fontFamily: font.demi, fontSize: 14, lineHeight: 20, marginTop: 8},
  metaTv: {color: color.softSilver, fontFamily: font.demi, fontSize: 22, lineHeight: 29, marginTop: 11},
  summaryMobile: {color: color.softSilver, fontFamily: font.regular, fontSize: 15, lineHeight: 21, marginTop: 10},
  summaryTv: {color: color.softSilver, fontFamily: font.regular, fontSize: 23, lineHeight: 32, marginTop: 13, maxWidth: 900},
  resumeProgress: {backgroundColor: 'rgba(244,247,250,0.24)', height: 4, marginTop: 14, maxWidth: 520},
  resumeProgressTv: {height: 6, marginTop: 18, maxWidth: 700},
  resumeProgressValue: {backgroundColor: color.screenBlueStrong, height: '100%'},
  actions: {flexDirection: 'row', gap: 8, marginTop: 18},
  actionsTv: {gap: 12, marginTop: 24},
  detailBody: {gap: 26, paddingHorizontal: 16, paddingTop: 22},
  detailBodyTv: {gap: 36, paddingLeft: 0, paddingRight: 72, paddingTop: 30},
  movieBody: {gap: 12},
  movieBodyTv: {gap: 16},
  bodyHeading: {color: color.silver},
  secondaryHeading: {marginTop: 20},
  factGrid: {backgroundColor: color.recess, borderColor: color.lineSoft, borderWidth: 1, paddingHorizontal: 14},
  factGridTv: {flexDirection: 'row', paddingHorizontal: 20},
  fact: {borderBottomColor: color.lineSoft, borderBottomWidth: 1, flex: 1, paddingVertical: 12},
  factLabelMobile: {color: color.dimSilver, fontFamily: font.medium, fontSize: 12, lineHeight: 16},
  factLabelTv: {color: color.dimSilver, fontFamily: font.medium, fontSize: 17, lineHeight: 23},
  factValueMobile: {color: color.silver, fontFamily: font.regular, fontSize: 15, lineHeight: 20, marginTop: 2},
  factValueTv: {color: color.silver, fontFamily: font.regular, fontSize: 21, lineHeight: 28, marginTop: 3},
  aboutMobile: {color: color.softSilver, fontFamily: font.regular, fontSize: 16, lineHeight: 24},
  aboutTv: {color: color.softSilver, fontFamily: font.regular, fontSize: 23, lineHeight: 34, maxWidth: 1200},
  seriesBody: {gap: 12},
  episodes: {gap: 8, paddingBottom: 8, paddingTop: 14},
  episodesTv: {gap: 18, paddingBottom: 12, paddingTop: 20},
  episodeWrapper: {paddingBottom: 4},
  player: {flex: 1},
  playerScrim: {backgroundColor: 'rgba(0,0,0,0.34)', bottom: 0, left: 0, position: 'absolute', right: 0, top: 0},
  playerTop: {alignItems: 'center', flexDirection: 'row', justifyContent: 'space-between', paddingHorizontal: 16, paddingTop: 12, zIndex: 4},
  playerTopTv: {paddingHorizontal: 72, paddingTop: 48},
  playerIdentity: {left: 20, maxWidth: '72%', position: 'absolute', zIndex: 3},
  playerIdentityTv: {left: 72, maxWidth: 850, top: 58},
  utilityDock: {alignItems: 'center', backgroundColor: 'rgba(7,11,16,0.78)', borderColor: color.line, borderRadius: 32, borderWidth: 1, flexDirection: 'row', gap: 2, padding: 4, position: 'absolute', right: 16, top: 58, zIndex: 5},
  utilityDockTv: {bottom: 42, right: 72, top: undefined},
  dockButton: {alignItems: 'center', borderColor: color.transparent, borderRadius: 999, borderWidth: 2, height: 40, justifyContent: 'center', width: 40},
  dockButtonTv: {height: 52, width: 52},
  dockButtonSelected: {backgroundColor: color.raisedSlate},
  dockButtonFocused: {backgroundColor: color.brightSlate, borderColor: color.focus},
  dockButtonPressed: {backgroundColor: color.recess},
  utilityPanel: {backgroundColor: 'rgba(10,16,23,0.96)', borderColor: color.line, borderRadius: 10, borderWidth: 1, padding: 14, position: 'absolute', right: 16, top: 108, width: 270, zIndex: 5},
  utilityPanelTv: {bottom: 106, right: 72, top: undefined, width: 420},
  utilityPanelTitleMobile: {color: color.silver, fontFamily: font.demi, fontSize: 16, marginBottom: 8},
  utilityPanelTitleTv: {color: color.silver, fontFamily: font.demi, fontSize: 23, marginBottom: 12},
  utilityPanelRowMobile: {borderTopColor: color.lineSoft, borderTopWidth: 1, color: color.softSilver, fontFamily: font.regular, fontSize: 13, lineHeight: 18, paddingVertical: 8},
  utilityPanelRowTv: {borderTopColor: color.lineSoft, borderTopWidth: 1, color: color.softSilver, fontFamily: font.regular, fontSize: 18, lineHeight: 25, paddingVertical: 11},
  buffering: {alignItems: 'center', flex: 1, justifyContent: 'center'},
  bufferingTextMobile: {color: color.silver, fontFamily: font.demi, fontSize: 17},
  bufferingTextTv: {color: color.silver, fontFamily: font.demi, fontSize: 26},
  playerSpacer: {flex: 1},
  playerBottom: {backgroundColor: 'rgba(7,11,16,0.52)', marginTop: 'auto', paddingBottom: 24, paddingHorizontal: 20, paddingTop: 16},
  playerBottomTv: {paddingBottom: 36, paddingHorizontal: 72, paddingTop: 20},
  playerTitleMobile: {color: color.silver, fontFamily: font.demi, fontSize: 18, lineHeight: 23},
  playerTitleTv: {color: color.silver, fontFamily: font.demi, fontSize: 28, lineHeight: 35},
  playerMetaMobile: {color: color.dimSilver, fontFamily: font.regular, fontSize: 13, lineHeight: 18, marginTop: 2},
  playerMetaTv: {color: color.dimSilver, fontFamily: font.regular, fontSize: 19, lineHeight: 26, marginTop: 3},
  playerTimes: {flexDirection: 'row', justifyContent: 'space-between'},
  playerProgress: {backgroundColor: 'rgba(244,247,250,0.28)', height: 5, marginTop: 8},
  playerProgressTv: {height: 6, marginTop: 10},
  playerProgressValue: {backgroundColor: color.screenBlueStrong, height: '100%'},
  transportDock: {alignItems: 'center', alignSelf: 'center', backgroundColor: 'rgba(7,11,16,0.72)', borderColor: color.line, borderRadius: 38, borderWidth: 1, flexDirection: 'row', gap: 3, marginTop: 14, padding: 4},
  transportDockTv: {borderRadius: 44, gap: 6, marginTop: 16, padding: 5},
  transportButton: {alignItems: 'center', borderColor: color.transparent, borderRadius: 999, borderWidth: 2, height: 48, justifyContent: 'center', width: 48},
  transportButtonTv: {height: 60, width: 60},
  transportButtonMain: {backgroundColor: 'rgba(244,247,250,0.22)', height: 66, width: 66},
  transportButtonMainTv: {height: 78, width: 78},
  transportButtonFocused: {backgroundColor: 'rgba(244,247,250,0.3)', borderColor: color.focus},
  transportButtonPressed: {backgroundColor: color.brightSlate},
  playerTimeMobile: {color: color.softSilver, fontFamily: font.medium, fontSize: 12},
  playerTimeTv: {color: color.softSilver, fontFamily: font.medium, fontSize: 18},
  playerFailure: {backgroundColor: color.projector, flex: 1},
});
