import React, {useState} from 'react';
import {ImageBackground, ScrollView, StyleSheet, Text, View} from 'react-native';
import {Circle, Play, Radio, Video} from 'lucide-react-native';
import type {GuideProgram, LiveChannel, PrototypePlatform} from '@portico-prototypes/contract';
import {guidePrograms, liveChannels, mediaById} from '@portico-prototypes/fixtures';
import {usePrototype} from '@portico-prototypes/runtime';
import {color, font, mobileType, tvType} from '../tokens';
import {
  ArtworkScrim,
  ControlButton,
  EmptyState,
  Focusable,
  InlineNotice,
  UnderlineTabs,
} from '../primitives';
import {HeaderUtilities, MediaGrid} from '../sharedComponents';
import {usePrototypeUi} from '../uiState';
import {usePorticoNavigation} from '../navigation';

export function ChannelsScreen({platform}: {platform: PrototypePlatform}) {
  const television = platform === 'tv';
  const {openDetail, openPlayer, openSearch} = usePorticoNavigation();
  const {state} = usePrototype();
  const {liveTab, setLiveTab} = usePrototypeUi();
  const [selectedProgramId, setSelectedProgramId] = useState(guidePrograms[0]?.id ?? '');
  const selectedProgram = guidePrograms.find(program => program.id === selectedProgramId) ?? guidePrograms[0];
  if (state.scenario === 'no-live-source') {
    return (
      <EmptyState
        message="No enabled tuner or channel source is available for this profile. Configure Live TV on the server, then return here."
        platform={platform}
        title="Channels are not configured"
      />
    );
  }

  return (
    <ScrollView
      contentContainerStyle={[styles.page, television && styles.pageTv]}
      showsVerticalScrollIndicator={false}
      testID={`portico-four-channels-${platform}`}>
      <HeaderUtilities flush onSearch={openSearch} platform={platform} title="Channels" />
      <UnderlineTabs active={liveTab} onChange={setLiveTab} platform={platform} tabs={['Guide', 'Channels', 'DVR']} />
      {liveTab === 'Guide' ? (
        <GuideSurface
          onPlay={() => openPlayer('saturday-cinema', true)}
          onSelect={setSelectedProgramId}
          platform={platform}
          selectedProgram={selectedProgram}
          selectedProgramId={selectedProgramId}
        />
      ) : liveTab === 'Channels' ? (
        <ChannelSurface onPlay={() => openPlayer('saturday-cinema', true)} platform={platform} />
      ) : (
        <DvrSurface onOpen={openDetail} platform={platform} />
      )}
      {state.scenario === 'tuner-busy' ? (
        <View style={styles.floatingNotice}>
          <InlineNotice kind="error" message="All tuners are currently in use. Recording remains scheduled; watching live is unavailable." platform={platform} />
        </View>
      ) : null}
    </ScrollView>
  );
}

function GuideSurface({
  onPlay,
  onSelect,
  platform,
  selectedProgram,
  selectedProgramId,
}: {
  onPlay(): void;
  onSelect(id: string): void;
  platform: PrototypePlatform;
  selectedProgram?: GuideProgram;
  selectedProgramId: string;
}) {
  const television = platform === 'tv';
  const {state} = usePrototype();
  const hero = mediaById.get('saturday-cinema');
  return (
    <View>
      {hero && selectedProgram ? (
        <ImageBackground resizeMode="cover" source={{uri: hero.backdrop}} style={[styles.guideHero, television && styles.guideHeroTv]}>
          <ArtworkScrim platform={platform} strong />
          <View style={[styles.guideHeroCopy, television && styles.guideHeroCopyTv]}>
            <View style={styles.liveLabel}>
              <Circle color={color.record} fill={color.record} size={television ? 12 : 8} strokeWidth={0} />
              <Text style={television ? styles.liveLabelTextTv : styles.liveLabelTextMobile}>LIVE NOW</Text>
            </View>
            <Text numberOfLines={1} style={[television ? tvType.title : mobileType.title, styles.guideHeroTitle]}>{selectedProgram.title}</Text>
            <Text style={television ? styles.guideHeroMetaTv : styles.guideHeroMetaMobile}>{selectedProgram.subtitle ?? 'Live programming'}  ·  {channelName(selectedProgram.channelId)}</Text>
            <View style={styles.guideHeroActions}>
              <ControlButton icon={Play} label="Watch live" onPress={onPlay} platform={platform} primary />
              <ControlButton icon={Radio} label={selectedProgram.recording ? 'Recording' : 'Record'} onPress={() => undefined} platform={platform} selected={selectedProgram.recording} />
            </View>
          </View>
        </ImageBackground>
      ) : null}

      <View style={[styles.guideToolbar, television && styles.guideToolbarTv]}>
        <ControlButton label="Today" onPress={() => undefined} platform={platform} />
        <Text style={television ? styles.guideTimeTv : styles.guideTimeMobile}>Now</Text>
        <Text style={television ? styles.guideTimeTv : styles.guideTimeMobile}>+ 1 hour</Text>
        <Text style={television ? styles.guideTimeTv : styles.guideTimeMobile}>+ 2 hours</Text>
      </View>

      {state.scenario === 'guide-unavailable' ? (
        <InlineNotice actionLabel="Retry guide" kind="error" message="Channels are available, but programme guide data could not be refreshed." onAction={() => undefined} platform={platform} />
      ) : (
        <View style={[styles.guide, television && styles.guideTv]}>
          <View pointerEvents="none" style={[styles.nowMarker, television && styles.nowMarkerTv]} />
          {liveChannels.map(channel => (
            <GuideChannelRow
              channel={channel}
              key={channel.id}
              onSelect={onSelect}
              platform={platform}
              programs={guidePrograms.filter(program => program.channelId === channel.id)}
              selectedProgramId={selectedProgramId}
            />
          ))}
        </View>
      )}
    </View>
  );
}

function GuideChannelRow({
  channel,
  onSelect,
  platform,
  programs,
  selectedProgramId,
}: {
  channel: LiveChannel;
  onSelect(id: string): void;
  platform: PrototypePlatform;
  programs: GuideProgram[];
  selectedProgramId: string;
}) {
  const television = platform === 'tv';
  return (
    <View style={[styles.guideRow, television && styles.guideRowTv]}>
      <View style={[styles.channelIdentity, television && styles.channelIdentityTv]}>
        <View style={[styles.channelLogo, television && styles.channelLogoTv, {backgroundColor: channel.color}]}>
          <Text style={television ? styles.channelLogoTextTv : styles.channelLogoTextMobile}>{channel.logoText}</Text>
        </View>
        <View style={styles.channelCopy}>
          <Text style={television ? styles.channelNameTv : styles.channelNameMobile}>{channel.name}</Text>
          <Text style={television ? styles.channelNumberTv : styles.channelNumberMobile}>{channel.number}</Text>
        </View>
      </View>
      <ScrollView contentContainerStyle={styles.programs} horizontal showsHorizontalScrollIndicator={false}>
        {programs.map((program, index) => {
          const selected = program.id === selectedProgramId;
          return (
            <Focusable
              accessibilityLabel={`${program.title}. ${program.subtitle ?? ''}`}
              accessibilityRole="button"
              key={program.id}
              onFocus={() => onSelect(program.id)}
              onPress={() => onSelect(program.id)}
              platform={platform}
              style={[
                styles.program,
                television ? styles.programTv : styles.programMobile,
                index === 0 && styles.programNow,
                selected && styles.programSelected,
              ]}
              focusedStyle={styles.programFocused}
              pressedStyle={styles.programPressed}>
              <Text numberOfLines={1} style={television ? styles.programTitleTv : styles.programTitleMobile}>{program.title}</Text>
              <Text numberOfLines={1} style={television ? styles.programMetaTv : styles.programMetaMobile}>{program.subtitle ?? (index === 0 ? 'Live now' : 'Up next')}</Text>
            </Focusable>
          );
        })}
      </ScrollView>
    </View>
  );
}

function ChannelSurface({onPlay, platform}: {onPlay(): void; platform: PrototypePlatform}) {
  const television = platform === 'tv';
  return (
    <View style={[styles.channelGrid, television && styles.channelGridTv]}>
      {liveChannels.map(channel => {
        const now = guidePrograms.find(program => program.channelId === channel.id && program.live);
        return (
          <Focusable
            accessibilityLabel={`${channel.name}. ${now?.title ?? 'No current programme'}`}
            accessibilityRole="button"
            key={channel.id}
            onPress={onPlay}
            platform={platform}
            style={[styles.channelCard, television && styles.channelCardTv]}
            focusedStyle={styles.channelCardFocused}
            pressedStyle={styles.channelCardPressed}>
            <View style={[styles.channelCardLogo, television && styles.channelCardLogoTv, {backgroundColor: channel.color}]}>
              <Text style={television ? styles.channelCardLogoTextTv : styles.channelCardLogoTextMobile}>{channel.logoText}</Text>
            </View>
            <View style={styles.channelCardCopy}>
              <Text style={television ? styles.channelCardTitleTv : styles.channelCardTitleMobile}>{channel.name}</Text>
              <Text numberOfLines={1} style={television ? styles.channelCardNowTv : styles.channelCardNowMobile}>{now?.title ?? 'No guide data'}</Text>
            </View>
            <Play color={color.silver} size={television ? 30 : 20} strokeWidth={2} />
          </Focusable>
        );
      })}
    </View>
  );
}

function DvrSurface({onOpen, platform}: {onOpen(id: string): void; platform: PrototypePlatform}) {
  const television = platform === 'tv';
  const recording = mediaById.get('saturday-cinema');
  return (
    <View style={[styles.dvr, television && styles.dvrTv]}>
      <View style={[styles.dvrSummary, television && styles.dvrSummaryTv]}>
        <Video color={color.screenBlue} size={television ? 38 : 24} strokeWidth={1.8} />
        <View style={styles.dvrSummaryCopy}>
          <Text style={television ? styles.dvrSummaryTitleTv : styles.dvrSummaryTitleMobile}>DVR storage</Text>
          <Text style={television ? styles.dvrSummaryMetaTv : styles.dvrSummaryMetaMobile}>186 GB available · 14 scheduled recordings</Text>
        </View>
      </View>
      {recording ? <MediaGrid items={[recording]} onOpen={item => onOpen(item.id)} platform={platform} /> : null}
    </View>
  );
}

function channelName(id: string): string {
  return liveChannels.find(channel => channel.id === id)?.name ?? 'Channel';
}

const styles = StyleSheet.create({
  page: {backgroundColor: color.projector, minHeight: '100%', paddingHorizontal: 16, paddingTop: 8},
  pageTv: {paddingLeft: 0, paddingRight: 72, paddingTop: 10},
  guideHero: {height: 240, marginTop: 16, overflow: 'hidden'},
  guideHeroTv: {height: 330, marginTop: 22},
  guideHeroCopy: {marginTop: 'auto', maxWidth: 630, padding: 20},
  guideHeroCopyTv: {maxWidth: 820, padding: 32},
  liveLabel: {alignItems: 'center', flexDirection: 'row', gap: 7},
  liveLabelTextMobile: {color: color.softSilver, fontFamily: font.demi, fontSize: 11, letterSpacing: 0.7},
  liveLabelTextTv: {color: color.softSilver, fontFamily: font.demi, fontSize: 16, letterSpacing: 1},
  guideHeroTitle: {color: color.silver, marginTop: 5},
  guideHeroMetaMobile: {color: color.softSilver, fontFamily: font.medium, fontSize: 13, lineHeight: 18, marginTop: 2},
  guideHeroMetaTv: {color: color.softSilver, fontFamily: font.medium, fontSize: 20, lineHeight: 27, marginTop: 4},
  guideHeroActions: {flexDirection: 'row', gap: 8, marginTop: 14},
  guideToolbar: {alignItems: 'center', borderBottomColor: color.line, borderBottomWidth: 1, flexDirection: 'row', gap: 20, marginTop: 12, paddingBottom: 10},
  guideToolbarTv: {gap: 54, marginTop: 18, paddingBottom: 14},
  guideTimeMobile: {color: color.dimSilver, fontFamily: font.medium, fontSize: 12},
  guideTimeTv: {color: color.dimSilver, fontFamily: font.medium, fontSize: 18},
  guide: {marginBottom: 100, marginTop: 8, position: 'relative'},
  guideTv: {marginBottom: 80, marginTop: 12},
  nowMarker: {backgroundColor: color.tunerAmber, bottom: 0, left: 132, position: 'absolute', top: 0, width: 2, zIndex: 4},
  nowMarkerTv: {left: 254, width: 3},
  guideRow: {alignItems: 'stretch', borderBottomColor: color.lineSoft, borderBottomWidth: 1, flexDirection: 'row', minHeight: 76},
  guideRowTv: {minHeight: 112},
  channelIdentity: {alignItems: 'center', backgroundColor: color.recess, flexDirection: 'row', gap: 8, paddingHorizontal: 6, width: 112},
  channelIdentityTv: {gap: 12, paddingHorizontal: 10, width: 222},
  channelLogo: {alignItems: 'center', height: 42, justifyContent: 'center', width: 42},
  channelLogoTv: {height: 62, width: 62},
  channelLogoTextMobile: {color: color.silver, fontFamily: font.bold, fontSize: 12},
  channelLogoTextTv: {color: color.silver, fontFamily: font.bold, fontSize: 17},
  channelCopy: {flex: 1},
  channelNameMobile: {color: color.silver, fontFamily: font.demi, fontSize: 11, lineHeight: 14},
  channelNameTv: {color: color.silver, fontFamily: font.demi, fontSize: 17, lineHeight: 22},
  channelNumberMobile: {color: color.dimSilver, fontFamily: font.medium, fontSize: 10, marginTop: 2},
  channelNumberTv: {color: color.dimSilver, fontFamily: font.medium, fontSize: 15, marginTop: 3},
  programs: {alignItems: 'stretch'},
  program: {borderColor: color.transparent, borderWidth: 3, justifyContent: 'center'},
  programMobile: {minWidth: 185, paddingHorizontal: 12},
  programTv: {minWidth: 330, paddingHorizontal: 18},
  programNow: {backgroundColor: color.slate},
  programSelected: {backgroundColor: color.raisedSlate},
  programFocused: {borderColor: color.focus},
  programPressed: {backgroundColor: color.brightSlate},
  programTitleMobile: {color: color.silver, fontFamily: font.demi, fontSize: 13, lineHeight: 17},
  programTitleTv: {color: color.silver, fontFamily: font.demi, fontSize: 20, lineHeight: 26},
  programMetaMobile: {color: color.dimSilver, fontFamily: font.regular, fontSize: 11, lineHeight: 15, marginTop: 2},
  programMetaTv: {color: color.dimSilver, fontFamily: font.regular, fontSize: 17, lineHeight: 23, marginTop: 3},
  channelGrid: {gap: 8, marginTop: 18, paddingBottom: 100},
  channelGridTv: {columnGap: 14, flexDirection: 'row', flexWrap: 'wrap', marginTop: 26, rowGap: 14},
  channelCard: {alignItems: 'center', backgroundColor: color.recess, borderColor: color.lineSoft, borderRadius: 8, borderWidth: 3, flexDirection: 'row', gap: 12, minHeight: 82, padding: 10},
  channelCardTv: {gap: 18, minHeight: 118, padding: 14, width: '48.8%'},
  channelCardFocused: {backgroundColor: color.raisedSlate, borderColor: color.focus},
  channelCardPressed: {backgroundColor: color.brightSlate},
  channelCardLogo: {alignItems: 'center', height: 56, justifyContent: 'center', width: 56},
  channelCardLogoTv: {height: 82, width: 82},
  channelCardLogoTextMobile: {color: color.silver, fontFamily: font.bold, fontSize: 15},
  channelCardLogoTextTv: {color: color.silver, fontFamily: font.bold, fontSize: 22},
  channelCardCopy: {flex: 1},
  channelCardTitleMobile: {color: color.silver, fontFamily: font.demi, fontSize: 16, lineHeight: 21},
  channelCardTitleTv: {color: color.silver, fontFamily: font.demi, fontSize: 24, lineHeight: 30},
  channelCardNowMobile: {color: color.dimSilver, fontFamily: font.regular, fontSize: 12, lineHeight: 17, marginTop: 3},
  channelCardNowTv: {color: color.dimSilver, fontFamily: font.regular, fontSize: 18, lineHeight: 24, marginTop: 4},
  dvr: {marginTop: 18},
  dvrTv: {marginTop: 26},
  dvrSummary: {alignItems: 'center', backgroundColor: color.recess, borderColor: color.lineSoft, borderWidth: 1, flexDirection: 'row', gap: 12, marginBottom: 20, padding: 16},
  dvrSummaryTv: {gap: 18, marginBottom: 28, padding: 22},
  dvrSummaryCopy: {flex: 1},
  dvrSummaryTitleMobile: {color: color.silver, fontFamily: font.demi, fontSize: 16},
  dvrSummaryTitleTv: {color: color.silver, fontFamily: font.demi, fontSize: 24},
  dvrSummaryMetaMobile: {color: color.dimSilver, fontFamily: font.regular, fontSize: 12, marginTop: 3},
  dvrSummaryMetaTv: {color: color.dimSilver, fontFamily: font.regular, fontSize: 18, marginTop: 4},
  floatingNotice: {marginBottom: 90, marginTop: 16},
});
