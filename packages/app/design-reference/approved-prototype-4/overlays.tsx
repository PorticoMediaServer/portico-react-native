import React, {useState} from 'react';
import {Modal, Pressable, ScrollView, StyleSheet, Text, TextInput, TVFocusGuideView, View} from 'react-native';
import {useSafeAreaInsets} from 'react-native-safe-area-context';
import {
  Airplay,
  Cast,
  Check,
  ChevronRight,
  CircleUserRound,
  Grid3X3,
  List,
  MonitorSmartphone,
  Server,
  ShieldCheck,
  Settings,
  SlidersHorizontal,
  Tv,
  Wifi,
  X,
} from 'lucide-react-native';
import type {PrototypePlatform, ScenarioId} from '@portico-prototypes/contract';
import {libraries, scenarios} from '@portico-prototypes/fixtures';
import {usePrototype} from '@portico-prototypes/runtime';
import {color, font, mobileType, radius, tvType} from './tokens';
import {ControlButton, Focusable, IconButton} from './primitives';
import {usePrototypeUi, type OverlayId} from './uiState';
import {usePorticoNavigation} from './navigation';

export function PrototypeOverlay({platform}: {platform: PrototypePlatform}) {
  const {overlay, setOverlay} = usePrototypeUi();
  const insets = useSafeAreaInsets();
  if (!overlay) {
    return null;
  }
  if (platform === 'tv' && overlay === 'cast') {
    return null;
  }
  return (
    <Modal animationType="fade" onRequestClose={() => setOverlay(null)} transparent visible>
      <View style={styles.layer} testID={`portico-four-overlay-${overlay}`}>
        <Pressable accessible={false} focusable={false} onPress={() => setOverlay(null)} style={styles.scrim} />
        <OverlayPanel bottomInset={insets.bottom} overlay={overlay} platform={platform} />
      </View>
    </Modal>
  );
}

function OverlayPanel({bottomInset, overlay, platform}: {bottomInset: number; overlay: Exclude<OverlayId, null>; platform: PrototypePlatform}) {
  const television = platform === 'tv';
  const {setOverlay} = usePrototypeUi();
  const title = overlayTitle(overlay);
  const contents = (
    <>
      <View style={[styles.panelHeader, television && styles.panelHeaderTv]}>
        <Text style={[television ? tvType.section : mobileType.section, styles.panelTitle]}>{title}</Text>
        <IconButton icon={X} label="Close" onPress={() => setOverlay(null)} platform={platform} />
      </View>
      <View style={styles.rule} />
      <View style={!television && bottomInset ? {paddingBottom: bottomInset} : undefined}>
        <OverlayContent overlay={overlay} platform={platform} />
      </View>
    </>
  );
  return television ? (
    <TVFocusGuideView autoFocus key={overlay} trapFocusDown trapFocusLeft trapFocusRight trapFocusUp style={[styles.panel, styles.panelTv]}>{contents}</TVFocusGuideView>
  ) : (
    <View accessibilityViewIsModal style={[styles.panel, styles.panelMobile]}>{contents}</View>
  );
}

function OverlayContent({overlay, platform}: {overlay: Exclude<OverlayId, null>; platform: PrototypePlatform}) {
  switch (overlay) {
    case 'library':
      return <LibraryOptions platform={platform} />;
    case 'filters':
      return <FilterOptions platform={platform} />;
    case 'sort':
      return <SortOptions platform={platform} />;
    case 'view':
      return <ViewOptions platform={platform} />;
    case 'profile':
      return <ProfileOptions platform={platform} />;
    case 'scenario':
      return <ScenarioOptions platform={platform} />;
    case 'cast':
      return <CastOptions platform={platform} />;
    case 'tv-pairing':
      return <TvPairing platform={platform} />;
    default:
      return null;
  }
}

function LibraryOptions({platform}: {platform: PrototypePlatform}) {
  const {selectedLibraryId, setLibraryTab, setOverlay, setSelectedLibraryId} = usePrototypeUi();
  return (
    <ScrollView contentContainerStyle={styles.options} showsVerticalScrollIndicator={false}>
      {libraries.map(library => (
        <OptionRow
          description={library.description}
          icon={library.id === 'recorded' ? Tv : library.id === 'music' ? MonitorSmartphone : Grid3X3}
          key={library.id}
          label={library.name}
          onPress={() => {
            setSelectedLibraryId(library.id);
            setLibraryTab(library.tabs[0] ?? 'Discover');
            setOverlay(null);
          }}
          platform={platform}
          selected={library.id === selectedLibraryId}
        />
      ))}
    </ScrollView>
  );
}

function FilterOptions({platform}: {platform: PrototypePlatform}) {
  const {filtersEnabled, setFiltersEnabled, setOverlay} = usePrototypeUi();
  return (
    <View style={styles.options}>
      <Text style={platform === 'tv' ? styles.helperTv : styles.helperMobile}>Filters combine without changing the active library, tab, sort, or view.</Text>
      <OptionRow description="Released in 2010 or later" icon={SlidersHorizontal} label="Recent releases" onPress={() => setFiltersEnabled(!filtersEnabled)} platform={platform} selected={filtersEnabled} />
      <View style={styles.optionActions}>
        <ControlButton label="Clear" onPress={() => setFiltersEnabled(false)} platform={platform} />
        <ControlButton label="Apply" onPress={() => setOverlay(null)} platform={platform} primary />
      </View>
    </View>
  );
}

function SortOptions({platform}: {platform: PrototypePlatform}) {
  const {setOverlay, setSort, sort} = usePrototypeUi();
  return (
    <View style={styles.options}>
      {['Title', 'Year'].map(value => (
        <OptionRow icon={List} key={value} label={value} onPress={() => {setSort(value); setOverlay(null);}} platform={platform} selected={value === sort} />
      ))}
    </View>
  );
}

function ViewOptions({platform}: {platform: PrototypePlatform}) {
  const {setOverlay, setViewMode, viewMode} = usePrototypeUi();
  return (
    <View style={styles.options}>
      <OptionRow icon={Grid3X3} label="Grid" onPress={() => {setViewMode('grid'); setOverlay(null);}} platform={platform} selected={viewMode === 'grid'} />
      <OptionRow icon={List} label="List" onPress={() => {setViewMode('list'); setOverlay(null);}} platform={platform} selected={viewMode === 'list'} />
    </View>
  );
}

function ProfileOptions({platform}: {platform: PrototypePlatform}) {
  const {setOverlay} = usePrototypeUi();
  const {openRecoveryGallery, openSettings, openSignIn} = usePorticoNavigation();
  return (
    <View style={styles.options}>
      <View style={styles.profileSummary}>
        <View style={styles.avatar}><Text style={styles.avatarText}>JE</Text></View>
        <View style={styles.profileCopy}>
          <Text style={platform === 'tv' ? styles.profileNameTv : styles.profileNameMobile}>Justin</Text>
          <Text style={platform === 'tv' ? styles.profileServerTv : styles.profileServerMobile}>Portico Home Server · Direct connection</Text>
        </View>
      </View>
      <OptionRow icon={CircleUserRound} label="Sign in and profiles" onPress={() => {setOverlay(null); openSignIn();}} platform={platform} />
      <OptionRow icon={Server} label="Switch server" onPress={() => {setOverlay(null); openSignIn();}} platform={platform} />
      <OptionRow icon={Settings} label="Settings" onPress={() => {setOverlay(null); openSettings();}} platform={platform} />
      <OptionRow icon={ShieldCheck} label="Recovery states" onPress={() => {setOverlay(null); openRecoveryGallery();}} platform={platform} />
      <OptionRow icon={SlidersHorizontal} label="Prototype scenarios" onPress={() => setOverlay('scenario')} platform={platform} />
    </View>
  );
}

function ScenarioOptions({platform}: {platform: PrototypePlatform}) {
  const {setOverlay} = usePrototypeUi();
  const {setScenario, state} = usePrototype();
  return (
    <ScrollView contentContainerStyle={styles.options} showsVerticalScrollIndicator={false}>
      {scenarios.map(scenario => (
        <OptionRow
          description={scenario.description}
          icon={SlidersHorizontal}
          key={scenario.id}
          label={scenario.label}
          onPress={() => {
            setScenario(scenario.id as ScenarioId);
            setOverlay(null);
          }}
          platform={platform}
          selected={scenario.id === state.scenario}
        />
      ))}
    </ScrollView>
  );
}

function CastOptions({platform}: {platform: PrototypePlatform}) {
  const {setOverlay} = usePrototypeUi();
  return (
    <View style={styles.options}>
      <Text style={platform === 'tv' ? styles.helperTv : styles.helperMobile}>Choose where Portico should play. Devices remain grouped by connection type.</Text>
      <OptionRow description="Living Room Chromecast · Ready" icon={Cast} label="Google Cast" onPress={() => setOverlay(null)} platform={platform} />
      <OptionRow description="Apple TV — Den · Same network" icon={Airplay} label="AirPlay" onPress={() => setOverlay(null)} platform={platform} />
      <OptionRow description={platform === 'tv' ? 'Show a six-digit code for another Portico client' : 'Enter the six-digit code shown by Portico on Apple TV'} icon={Tv} label="Connect tvOS with a code" onPress={() => setOverlay('tv-pairing')} platform={platform} />
    </View>
  );
}

function TvPairing({platform}: {platform: PrototypePlatform}) {
  const television = platform === 'tv';
  const {setOverlay} = usePrototypeUi();
  const [code, setCode] = useState('');
  if (!television) {
    return (
      <View style={styles.pairing}>
        <Tv color={color.screenBlue} size={34} strokeWidth={1.7} />
        <Text style={styles.pairingTitleMobile}>Enter the code shown on Apple TV</Text>
        <TextInput
          accessibilityLabel="Six digit Apple TV code"
          keyboardType="number-pad"
          maxLength={6}
          onChangeText={value => setCode(value.replace(/[^0-9]/g, ''))}
          placeholder="000000"
          placeholderTextColor={color.mutedSilver}
          selectionColor={color.screenBlue}
          style={styles.codeInput}
          value={code}
        />
        <ControlButton disabled={code.length !== 6} label="Connect" onPress={() => setOverlay(null)} platform={platform} primary />
        <ControlButton label="Back to destinations" onPress={() => setOverlay('cast')} platform={platform} />
      </View>
    );
  }
  return (
    <View style={[styles.pairing, television && styles.pairingTv]}>
      <Tv color={color.screenBlue} size={52} strokeWidth={1.7} />
      <Text style={styles.pairingTitleTv}>Enter this code in Portico on your phone</Text>
      <View style={[styles.code, television && styles.codeTv]}>
        {['4', '8', '2', '7', '1', '6'].map((digit, index) => <Text key={`${digit}-${index}`} style={television ? styles.digitTv : styles.digitMobile}>{digit}</Text>)}
      </View>
      <View style={styles.pairingStatus}>
        <Wifi color={color.healthy} size={television ? 26 : 18} strokeWidth={2} />
        <Text style={television ? styles.pairingStatusTv : styles.pairingStatusMobile}>Waiting securely · Expires in 4:52</Text>
      </View>
      <ControlButton label="Done" onPress={() => setOverlay(null)} platform={platform} />
    </View>
  );
}

function OptionRow({
  description,
  icon: Icon,
  label,
  onPress,
  platform,
  selected,
}: {
  description?: string;
  icon: typeof Grid3X3;
  label: string;
  onPress(): void;
  platform: PrototypePlatform;
  selected?: boolean;
}) {
  const television = platform === 'tv';
  return (
    <Focusable
      accessibilityLabel={`${label}${description ? `. ${description}` : ''}`}
      accessibilityRole="button"
      accessibilityState={{selected}}
      onPress={onPress}
      platform={platform}
      style={[styles.option, television && styles.optionTv, selected && styles.optionSelected]}
      focusedStyle={styles.optionFocused}
      pressedStyle={styles.optionPressed}>
      <Icon color={selected ? color.screenBlueStrong : color.softSilver} size={television ? 29 : 20} strokeWidth={2} />
      <View style={styles.optionCopy}>
        <Text style={[television ? styles.optionLabelTv : styles.optionLabelMobile, selected && styles.optionLabelSelected]}>{label}</Text>
        {description ? <Text style={television ? styles.optionDescriptionTv : styles.optionDescriptionMobile}>{description}</Text> : null}
      </View>
      {selected ? <Check color={color.screenBlueStrong} size={television ? 28 : 20} strokeWidth={2.3} /> : <ChevronRight color={color.mutedSilver} size={television ? 28 : 20} strokeWidth={2} />}
    </Focusable>
  );
}

function overlayTitle(overlay: Exclude<OverlayId, null>): string {
  switch (overlay) {
    case 'library': return 'Choose library';
    case 'filters': return 'Filter';
    case 'sort': return 'Sort';
    case 'view': return 'View';
    case 'profile': return 'Profile and server';
    case 'scenario': return 'Prototype scenarios';
    case 'cast': return 'Playback destination';
    case 'tv-pairing': return 'Connect a tvOS device';
  }
}

const styles = StyleSheet.create({
  layer: {bottom: 0, left: 0, position: 'absolute', right: 0, top: 0, zIndex: 800},
  scrim: {backgroundColor: 'rgba(0,0,0,0.72)', bottom: 0, left: 0, position: 'absolute', right: 0, top: 0},
  panel: {backgroundColor: color.slate, borderColor: color.line, borderWidth: 1, overflow: 'hidden', position: 'absolute'},
  panelMobile: {borderTopLeftRadius: radius.overlay, borderTopRightRadius: radius.overlay, bottom: 0, left: 0, maxHeight: '78%', right: 0},
  panelTv: {borderRadius: radius.overlay, maxHeight: '82%', right: 90, top: 90, width: 720},
  panelHeader: {alignItems: 'center', flexDirection: 'row', justifyContent: 'space-between', minHeight: 68, paddingHorizontal: 16},
  panelHeaderTv: {minHeight: 86, paddingHorizontal: 22},
  panelTitle: {color: color.silver},
  rule: {backgroundColor: color.line, height: 1},
  options: {padding: 10},
  helperMobile: {color: color.dimSilver, fontFamily: font.regular, fontSize: 13, lineHeight: 19, padding: 8},
  helperTv: {color: color.dimSilver, fontFamily: font.regular, fontSize: 19, lineHeight: 27, padding: 12},
  option: {alignItems: 'center', borderColor: color.transparent, borderRadius: 8, borderWidth: 3, flexDirection: 'row', gap: 12, minHeight: 58, paddingHorizontal: 12, paddingVertical: 8},
  optionTv: {gap: 18, minHeight: 82, paddingHorizontal: 16, paddingVertical: 10},
  optionSelected: {backgroundColor: color.raisedSlate},
  optionFocused: {backgroundColor: color.brightSlate, borderColor: color.focus},
  optionPressed: {backgroundColor: color.recess},
  optionCopy: {flex: 1},
  optionLabelMobile: {color: color.silver, fontFamily: font.demi, fontSize: 15, lineHeight: 20},
  optionLabelTv: {color: color.silver, fontFamily: font.demi, fontSize: 22, lineHeight: 28},
  optionLabelSelected: {color: color.screenBlueStrong},
  optionDescriptionMobile: {color: color.dimSilver, fontFamily: font.regular, fontSize: 12, lineHeight: 17, marginTop: 2},
  optionDescriptionTv: {color: color.dimSilver, fontFamily: font.regular, fontSize: 17, lineHeight: 23, marginTop: 3},
  optionActions: {alignItems: 'center', flexDirection: 'row', gap: 8, justifyContent: 'flex-end', padding: 10},
  profileSummary: {alignItems: 'center', borderBottomColor: color.lineSoft, borderBottomWidth: 1, flexDirection: 'row', gap: 14, marginBottom: 8, padding: 12},
  avatar: {alignItems: 'center', backgroundColor: color.screenBlueDeep, borderRadius: 999, height: 52, justifyContent: 'center', width: 52},
  avatarText: {color: color.silver, fontFamily: font.bold, fontSize: 17},
  profileCopy: {flex: 1},
  profileNameMobile: {color: color.silver, fontFamily: font.demi, fontSize: 17},
  profileNameTv: {color: color.silver, fontFamily: font.demi, fontSize: 25},
  profileServerMobile: {color: color.dimSilver, fontFamily: font.regular, fontSize: 12, marginTop: 3},
  profileServerTv: {color: color.dimSilver, fontFamily: font.regular, fontSize: 18, marginTop: 4},
  pairing: {alignItems: 'center', padding: 26},
  pairingTv: {padding: 40},
  pairingTitleMobile: {color: color.silver, fontFamily: font.demi, fontSize: 17, marginTop: 14, textAlign: 'center'},
  pairingTitleTv: {color: color.silver, fontFamily: font.demi, fontSize: 25, marginTop: 20, textAlign: 'center'},
  code: {flexDirection: 'row', gap: 6, marginVertical: 24},
  codeTv: {gap: 10, marginVertical: 32},
  digitMobile: {backgroundColor: color.recess, borderColor: color.line, borderRadius: 8, borderWidth: 1, color: color.silver, fontFamily: font.bold, fontSize: 28, lineHeight: 38, paddingHorizontal: 11, paddingVertical: 7},
  digitTv: {backgroundColor: color.recess, borderColor: color.line, borderRadius: 8, borderWidth: 1, color: color.silver, fontFamily: font.bold, fontSize: 42, lineHeight: 52, paddingHorizontal: 16, paddingVertical: 10},
  pairingStatus: {alignItems: 'center', flexDirection: 'row', gap: 8, marginBottom: 24},
  pairingStatusMobile: {color: color.softSilver, fontFamily: font.medium, fontSize: 13},
  pairingStatusTv: {color: color.softSilver, fontFamily: font.medium, fontSize: 19},
  codeInput: {backgroundColor: color.recess, borderColor: color.line, borderRadius: 8, borderWidth: 1, color: color.silver, fontFamily: font.bold, fontSize: 34, letterSpacing: 12, marginVertical: 24, paddingHorizontal: 18, paddingVertical: 12, textAlign: 'center', width: 250},
});
