import React, {useState} from 'react';
import {Image, ScrollView, StyleSheet, Text, View} from 'react-native';
import {
  Airplay,
  ArrowLeft,
  Bell,
  ChevronRight,
  Download,
  Eye,
  HardDrive,
  KeyRound,
  LockKeyhole,
  Monitor,
  Moon,
  Network,
  Play,
  Server,
  ShieldCheck,
  SlidersHorizontal,
  UserRound,
  Wifi,
} from 'lucide-react-native';
import type {PrototypePlatform} from '@portico-prototypes/contract';
import {color, font, mobileType, tvType} from '../tokens';
import {ControlButton, Focusable, IconButton, InlineNotice} from '../primitives';
import {usePorticoNavigation} from '../navigation';
import {usePrototypeUi} from '../uiState';
import {HeaderUtilities} from '../sharedComponents';
import {porticoWordmarkSource} from '../brandAssets';

export function SettingsScreen({platform}: {platform: PrototypePlatform}) {
  const television = platform === 'tv';
  const {back, openRecoveryGallery, openSearch} = usePorticoNavigation();
  const {setOverlay} = usePrototypeUi();
  const [autoPlay, setAutoPlay] = useState(true);
  const [downloadWifi, setDownloadWifi] = useState(true);
  const [reducedMotion, setReducedMotion] = useState(false);
  return (
    <ScrollView contentContainerStyle={[styles.page, television && styles.pageTv]} showsVerticalScrollIndicator={false} testID={`portico-four-settings-${platform}`}>
      <ScreenHeading back={back} onSearch={openSearch} platform={platform} title="Settings" />
      <Text style={television ? styles.accountLabelTv : styles.accountLabelMobile}>Justin · Portico Home Server</Text>

      <SettingsGroup platform={platform} title="Playback">
        <SettingsRow description="Automatically begin the next episode" icon={Play} label="Auto-play next episode" onPress={() => setAutoPlay(value => !value)} platform={platform} toggle={autoPlay} />
        <SettingsRow description="Automatic · Original quality on this network" icon={Monitor} label="Video quality" onPress={() => undefined} platform={platform} value="Automatic" />
        <SettingsRow description="English (Original)" icon={Airplay} label="Audio and subtitles" onPress={() => undefined} platform={platform} value="English" />
      </SettingsGroup>

      {!television ? <SettingsGroup platform={platform} title="Downloads">
        <SettingsRow description="Prevents downloads over cellular data" icon={Wifi} label="Download on Wi-Fi only" onPress={() => setDownloadWifi(value => !value)} platform={platform} toggle={downloadWifi} />
        <SettingsRow description="18.6 GB used · 46.3 GB available" icon={HardDrive} label="Storage" onPress={() => undefined} platform={platform} value="18.6 GB" />
        <SettingsRow description="Choose quality and automatic download rules" icon={Download} label="Download quality" onPress={() => undefined} platform={platform} value="Automatic" />
      </SettingsGroup> : null}

      <SettingsGroup platform={platform} title="Appearance and accessibility">
        <SettingsRow description="Use Portico's projector-black appearance" icon={Moon} label="Appearance" onPress={() => undefined} platform={platform} value="Dark" />
        <SettingsRow description="Remove nonessential movement and crossfades" icon={Eye} label="Reduce motion" onPress={() => setReducedMotion(value => !value)} platform={platform} toggle={reducedMotion} />
      </SettingsGroup>

      <SettingsGroup platform={platform} title="Account and connections">
        <SettingsRow description="Portico Home Server · Direct and verified" icon={Server} label="Server" onPress={() => setOverlay('profile')} platform={platform} value="Connected" />
        {television ? (
          <SettingsRow description="Show a six-digit code to connect an iPhone or iPad" icon={Network} label="Pair a mobile device" onPress={() => setOverlay('tv-pairing')} platform={platform} />
        ) : (
          <SettingsRow description="Google Cast, AirPlay, and tvOS pairing" icon={Network} label="Playback destinations" onPress={() => setOverlay('cast')} platform={platform} />
        )}
        <SettingsRow description="Profile, account security, and sign out" icon={UserRound} label="Account" onPress={() => setOverlay('profile')} platform={platform} />
      </SettingsGroup>

      <SettingsGroup platform={platform} title="Prototype review">
        <SettingsRow description="Review page, session, permission, offline, and playback failures" icon={ShieldCheck} label="Recovery and failure states" onPress={openRecoveryGallery} platform={platform} />
        <SettingsRow description="Select a deterministic fixture condition" icon={SlidersHorizontal} label="Scenario lab" onPress={() => setOverlay('scenario')} platform={platform} />
      </SettingsGroup>
    </ScrollView>
  );
}

export function SignInScreen({platform}: {platform: PrototypePlatform}) {
  const television = platform === 'tv';
  const {back} = usePorticoNavigation();
  return (
    <View style={[styles.signIn, television && styles.signInTv]} testID={`portico-four-sign-in-${platform}`}>
      {!television ? <View style={styles.signInBack}><IconButton icon={ArrowLeft} label="Back" onPress={back} platform={platform} /></View> : null}
      <View style={[styles.signInBody, television && styles.signInBodyTv]}>
        <Image resizeMode="contain" source={porticoWordmarkSource} style={television ? styles.signInWordmarkTv : styles.signInWordmarkMobile} />
        <Text style={[television ? tvType.title : mobileType.title, styles.signInTitle]}>Your media, wherever you watch.</Text>
        <Text style={television ? styles.signInCopyTv : styles.signInCopyMobile}>Sign in to your Portico Account, find a server on this network, or connect directly to a server you already trust.</Text>
        <View style={[styles.entryActions, television && styles.entryActionsTv]}>
          <ControlButton icon={KeyRound} label="Sign in to Portico Account" onPress={() => undefined} platform={platform} primary />
          <ControlButton icon={Wifi} label="Find a server nearby" onPress={() => undefined} platform={platform} />
          <ControlButton icon={Server} label="Enter server address" onPress={() => undefined} platform={platform} />
        </View>
        <View style={[styles.securityNote, television && styles.securityNoteTv]}>
          <LockKeyhole color={color.healthy} size={television ? 28 : 19} strokeWidth={1.9} />
          <Text style={television ? styles.securityTextTv : styles.securityTextMobile}>Credentials are stored in the device keychain. Portico verifies server identity before opening a session.</Text>
        </View>
      </View>
    </View>
  );
}

export function RecoveryGalleryScreen({platform}: {platform: PrototypePlatform}) {
  const television = platform === 'tv';
  const {back, openSearch} = usePorticoNavigation();
  const examples = [
    {title: 'Page could not load', message: 'The library request failed. Existing downloads and the rest of Portico remain available.', action: 'Try again', kind: 'error' as const},
    {title: 'Offline with cached media', message: 'Showing media saved from 12 minutes ago. Actions that require the server will wait.', action: 'View downloads', kind: 'warning' as const},
    {title: 'No matching media', message: 'Nothing matches the active filters. The library, tab, sort, and view are unchanged.', action: 'Clear filters', kind: 'info' as const},
    {title: 'Playback unavailable', message: 'Details are still available, but the server cannot prepare a compatible source for this device.', action: 'Playback details', kind: 'error' as const},
  ];
  return (
    <ScrollView contentContainerStyle={[styles.page, television && styles.pageTv]} showsVerticalScrollIndicator={false} testID={`portico-four-recovery-${platform}`}>
      <ScreenHeading back={back} onSearch={openSearch} platform={platform} title="Recovery states" />
      <Text style={television ? styles.recoveryIntroTv : styles.recoveryIntroMobile}>Failures preserve context, say what remains safe, and offer one relevant next action. They do not replace the entire application unless authentication or server identity is lost.</Text>
      <View style={[styles.recoveryExamples, television && styles.recoveryExamplesTv]}>
        {examples.map(example => (
          <View key={example.title} style={[styles.recoveryExample, television && styles.recoveryExampleTv]}>
            <Text style={television ? styles.recoveryTitleTv : styles.recoveryTitleMobile}>{example.title}</Text>
            <Text style={television ? styles.recoveryMessageTv : styles.recoveryMessageMobile}>{example.message}</Text>
            <InlineNotice actionLabel={example.action} kind={example.kind} message={example.message} onAction={() => undefined} platform={platform} />
          </View>
        ))}
      </View>
    </ScrollView>
  );
}

function ScreenHeading({back, onSearch, platform, title}: {back(): void; onSearch(): void; platform: PrototypePlatform; title: string}) {
  const television = platform === 'tv';
  return <HeaderUtilities flush leftContent={<View style={styles.screenHeading}>
      {!television ? <IconButton icon={ArrowLeft} label="Back" onPress={back} platform={platform} /> : null}
      <Text style={[television ? tvType.title : mobileType.title, styles.screenTitle]}>{title}</Text>
    </View>} onSearch={onSearch} platform={platform} />;
}

function SettingsGroup({children, platform, title}: {children: React.ReactNode; platform: PrototypePlatform; title: string}) {
  const television = platform === 'tv';
  return (
    <View style={[styles.settingsGroup, television && styles.settingsGroupTv]}>
      <Text style={television ? styles.groupTitleTv : styles.groupTitleMobile}>{title}</Text>
      <View style={styles.groupRows}>{children}</View>
    </View>
  );
}

function SettingsRow({description, icon: Icon, label, onPress, platform, toggle, value}: {description: string; icon: typeof Bell; label: string; onPress(): void; platform: PrototypePlatform; toggle?: boolean; value?: string}) {
  const television = platform === 'tv';
  const hasToggle = typeof toggle === 'boolean';
  return (
    <Focusable
      accessibilityLabel={`${label}. ${description}`}
      accessibilityRole={hasToggle ? 'switch' : 'button'}
      accessibilityState={hasToggle ? {checked: toggle} : undefined}
      onPress={onPress}
      platform={platform}
      style={[styles.settingsRow, television && styles.settingsRowTv]}
      focusedStyle={styles.settingsRowFocused}
      pressedStyle={styles.settingsRowPressed}>
      <Icon color={color.softSilver} size={television ? 28 : 20} strokeWidth={1.9} />
      <View style={styles.settingsCopy}>
        <Text style={television ? styles.settingsLabelTv : styles.settingsLabelMobile}>{label}</Text>
        <Text style={television ? styles.settingsDescriptionTv : styles.settingsDescriptionMobile}>{description}</Text>
      </View>
      {hasToggle ? (
        <View style={[styles.toggle, television && styles.toggleTv, toggle && styles.toggleOn]}><View style={[styles.toggleThumb, television && styles.toggleThumbTv, toggle && styles.toggleThumbOn]} /></View>
      ) : (
        <View style={styles.settingsValue}>
          {value ? <Text style={television ? styles.valueTv : styles.valueMobile}>{value}</Text> : null}
          <ChevronRight color={color.mutedSilver} size={television ? 27 : 19} strokeWidth={2} />
        </View>
      )}
    </Focusable>
  );
}

const styles = StyleSheet.create({
  page: {backgroundColor: color.projector, minHeight: '100%', paddingBottom: 80, paddingHorizontal: 16},
  pageTv: {paddingBottom: 70, paddingLeft: 0, paddingRight: 72},
  screenHeading: {alignItems: 'center', flexDirection: 'row', gap: 12},
  screenTitle: {color: color.silver},
  accountLabelMobile: {color: color.dimSilver, fontFamily: font.medium, fontSize: 13, marginBottom: 18},
  accountLabelTv: {color: color.dimSilver, fontFamily: font.medium, fontSize: 19, marginBottom: 26},
  settingsGroup: {marginBottom: 28},
  settingsGroupTv: {marginBottom: 38},
  groupTitleMobile: {color: color.dimSilver, fontFamily: font.demi, fontSize: 13, marginBottom: 8},
  groupTitleTv: {color: color.dimSilver, fontFamily: font.demi, fontSize: 19, marginBottom: 12},
  groupRows: {backgroundColor: color.recess, borderColor: color.lineSoft, borderWidth: 1},
  settingsRow: {alignItems: 'center', borderBottomColor: color.lineSoft, borderColor: color.transparent, borderBottomWidth: 1, borderWidth: 3, flexDirection: 'row', gap: 12, minHeight: 70, paddingHorizontal: 12, paddingVertical: 8},
  settingsRowTv: {gap: 18, minHeight: 94, paddingHorizontal: 18, paddingVertical: 12},
  settingsRowFocused: {backgroundColor: color.raisedSlate, borderColor: color.focus},
  settingsRowPressed: {backgroundColor: color.brightSlate},
  settingsCopy: {flex: 1},
  settingsLabelMobile: {color: color.silver, fontFamily: font.demi, fontSize: 15, lineHeight: 20},
  settingsLabelTv: {color: color.silver, fontFamily: font.demi, fontSize: 22, lineHeight: 28},
  settingsDescriptionMobile: {color: color.dimSilver, fontFamily: font.regular, fontSize: 12, lineHeight: 17, marginTop: 2},
  settingsDescriptionTv: {color: color.dimSilver, fontFamily: font.regular, fontSize: 17, lineHeight: 23, marginTop: 3},
  settingsValue: {alignItems: 'center', flexDirection: 'row', gap: 8},
  valueMobile: {color: color.softSilver, fontFamily: font.medium, fontSize: 13},
  valueTv: {color: color.softSilver, fontFamily: font.medium, fontSize: 19},
  toggle: {backgroundColor: color.brightSlate, borderRadius: 999, height: 28, padding: 3, width: 48},
  toggleTv: {height: 36, padding: 4, width: 62},
  toggleOn: {backgroundColor: color.screenBlueDeep},
  toggleThumb: {backgroundColor: color.softSilver, borderRadius: 999, height: 22, width: 22},
  toggleThumbTv: {height: 28, width: 28},
  toggleThumbOn: {alignSelf: 'flex-end', backgroundColor: color.silver},
  signIn: {backgroundColor: color.projector, flex: 1},
  signInTv: {paddingHorizontal: 72},
  signInBack: {left: 16, position: 'absolute', top: 12, zIndex: 2},
  signInBody: {alignItems: 'center', flex: 1, justifyContent: 'center', paddingHorizontal: 24},
  signInBodyTv: {paddingHorizontal: 120},
  signInWordmarkMobile: {height: 38, width: 168},
  signInWordmarkTv: {height: 58, width: 256},
  signInTitle: {color: color.silver, marginTop: 30, maxWidth: 760, textAlign: 'center'},
  signInCopyMobile: {color: color.dimSilver, fontFamily: font.regular, fontSize: 15, lineHeight: 22, marginTop: 12, maxWidth: 520, textAlign: 'center'},
  signInCopyTv: {color: color.dimSilver, fontFamily: font.regular, fontSize: 22, lineHeight: 32, marginTop: 16, maxWidth: 820, textAlign: 'center'},
  entryActions: {gap: 8, marginTop: 30, width: '100%'},
  entryActionsTv: {gap: 12, marginTop: 38, maxWidth: 620},
  securityNote: {alignItems: 'flex-start', flexDirection: 'row', gap: 9, marginTop: 24, maxWidth: 560},
  securityNoteTv: {gap: 12, marginTop: 30, maxWidth: 760},
  securityTextMobile: {color: color.dimSilver, flex: 1, fontFamily: font.regular, fontSize: 12, lineHeight: 18},
  securityTextTv: {color: color.dimSilver, flex: 1, fontFamily: font.regular, fontSize: 18, lineHeight: 26},
  recoveryIntroMobile: {color: color.dimSilver, fontFamily: font.regular, fontSize: 15, lineHeight: 22, marginBottom: 22, maxWidth: 760},
  recoveryIntroTv: {color: color.dimSilver, fontFamily: font.regular, fontSize: 21, lineHeight: 31, marginBottom: 30, maxWidth: 1050},
  recoveryExamples: {gap: 12},
  recoveryExamplesTv: {columnGap: 16, flexDirection: 'row', flexWrap: 'wrap', rowGap: 16},
  recoveryExample: {backgroundColor: color.recess, borderColor: color.lineSoft, borderWidth: 1, gap: 10, padding: 14},
  recoveryExampleTv: {gap: 14, minHeight: 230, padding: 20, width: '49%'},
  recoveryTitleMobile: {color: color.silver, fontFamily: font.demi, fontSize: 17, lineHeight: 22},
  recoveryTitleTv: {color: color.silver, fontFamily: font.demi, fontSize: 25, lineHeight: 31},
  recoveryMessageMobile: {color: color.dimSilver, fontFamily: font.regular, fontSize: 13, lineHeight: 19},
  recoveryMessageTv: {color: color.dimSilver, fontFamily: font.regular, fontSize: 18, lineHeight: 26},
});
