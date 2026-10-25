import React, {useState} from 'react';
import {ScrollView, Text, View} from 'react-native';
import {useSafeAreaInsets} from 'react-native-safe-area-context';
import Svg, {Defs, LinearGradient, Rect, Stop} from 'react-native-svg';
import {defaultI18n} from '../../../../packages/i18n/src';
import type {Library} from '../../../../packages/client-core/src';
import {Focusable} from '../kit/controls';
import {Icon, type IconName} from '../kit/Icon';
import {ProfileFace, type ProfileOption} from '../kit/artwork';
import {useTheme} from '../kit/theme';
import {BlurView} from '../platform/native-blur';
import {mediumLibraryIcon, mediumRailMetrics, mediumRailPadding, visibleLibraries, type ShellDestination} from './model';
import {sameDestination} from './tv-focus';

type RailEntry = Readonly<{key: string; label: string; icon: IconName; destination: ShellDestination}>;

/** foldable1/tablet: the 84 pt medium rail replaces the phone tab bar. Search,
 * Home, Live TV, Saved, Settings and Profile stay put; only the libraries scroll. */
export function MediumRail({libraries, hasLiveTV, destination, profile, unread, serverAction, onNavigate, onProfile, profileRef, short}: {
  libraries: readonly Library[]; hasLiveTV: boolean; destination: ShellDestination; profile: ProfileOption; unread: boolean;
  /** Owner/administrator-only Server activity, icon-only as tablet 2/3 draw it. */
  serverAction?: Readonly<{id: string; label: string; onPress: () => void}>;
  onNavigate: (destination: ShellDestination) => void; onProfile: () => void; profileRef: React.RefObject<View | null>; short: boolean;
}) {
  const theme = useTheme(), insets = useSafeAreaInsets(), padding = mediumRailPadding(insets.top, insets.bottom);
  const [libraryViewport, setLibraryViewport] = useState(0), [libraryContent, setLibraryContent] = useState(0);
  const overflow = libraryContent > libraryViewport + 1;
  const top: RailEntry[] = [
    {key: 'search', icon: 'i-search', label: defaultI18n.t('web.shell.search'), destination: {kind: 'search'}},
    {key: 'home', icon: 'i-home', label: defaultI18n.t('web.shell.home'), destination: {kind: 'home'}},
  ];
  const libraryEntries: RailEntry[] = visibleLibraries(libraries, false).map(library => ({key: 'library:' + library.id, label: library.name,
    icon: mediumLibraryIcon(library.kind), destination: {kind: 'library' as const, libraryId: library.id}}));
  const below: RailEntry[] = [
    ...(hasLiveTV ? [{key: 'live', icon: 'i-tv' as const, label: defaultI18n.t('search.chip.liveTV'), destination: {kind: 'live' as const}}] : []),
    {key: 'saved', icon: 'i-bookmark', label: defaultI18n.t('saved.title'), destination: {kind: 'saved'}},
  ];
  const item = (entry: RailEntry) => {
    const selected = sameDestination(entry.destination, destination);
    return <Focusable key={entry.key} testID={`medium-rail-${entry.key}`} accessibilityRole="button" accessibilityLabel={entry.label}
      accessibilityState={{selected}} onPress={() => onNavigate(entry.destination)} focusRadius={mediumRailMetrics.itemRadius}
      style={{width: mediumRailMetrics.itemWidth, minHeight: 48, paddingTop: 8, paddingBottom: 6, borderRadius: mediumRailMetrics.itemRadius,
        alignItems: 'center', justifyContent: 'center', gap: 4, backgroundColor: selected ? `${theme.colors.text}1A` : undefined}}>
      <Icon name={entry.icon} size={mediumRailMetrics.iconSize} color={selected ? theme.colors.text : theme.colors.textTertiary}/>
      <Text numberOfLines={1} style={[theme.type.captionStrong, {fontSize: 10.5, lineHeight: 13.5, color: selected ? theme.colors.text : theme.colors.textTertiary, maxWidth: mediumRailMetrics.itemWidth, textAlign: 'center'}]}>{entry.label}</Text>
    </Focusable>;
  };
  const hairline = <View accessible={false} style={{width: 40, height: 1, backgroundColor: theme.colors.line, marginVertical: 6}}/>;
  return <View testID="medium-rail" accessibilityLabel={defaultI18n.t('next.home.native.mainNavigation')}
    style={{position: 'absolute', left: 0, top: 0, bottom: 0, width: mediumRailMetrics.width, zIndex: theme.layers.navigation, overflow: 'hidden',
      borderRightWidth: 1, borderRightColor: theme.colors.line}}>
    <BlurView pointerEvents="none" style={{position: 'absolute', inset: 0}} blurType="dark" blurAmount={18} reducedTransparencyFallbackColor={theme.colors.raised}/>
    <View pointerEvents="none" style={{position: 'absolute', inset: 0, backgroundColor: theme.colors.ink, opacity: .72}}/>
    <View style={{flex: 1, alignItems: 'center', paddingTop: padding.top, paddingBottom: padding.bottom}}>
      {top.map(item)}
      <View style={{flexGrow: 0, flexShrink: 1, minHeight: 0, width: '100%', marginTop: short ? 2 : 0, gap: short ? 2 : 0}}>
        <ScrollView style={{flexGrow: 0, flexShrink: 1, width: '100%'}} contentContainerStyle={{alignItems: 'center', gap: short ? 2 : mediumRailMetrics.gap}}
          showsVerticalScrollIndicator={false} onLayout={event => setLibraryViewport(event.nativeEvent.layout.height)}
          onContentSizeChange={(_width, height) => setLibraryContent(height)}>
          {libraryEntries.map(item)}
        </ScrollView>
        {overflow && <View pointerEvents="none" accessible={false} style={{position: 'absolute', left: 0, right: 0, bottom: -1, height: mediumRailMetrics.fadeHeight}}>
          <Svg width="100%" height="100%"><Defs><LinearGradient id="medium-rail-fade" x1="0" y1="0" x2="0" y2="1"><Stop offset="0" stopColor={theme.colors.ink} stopOpacity={0}/><Stop offset="1" stopColor={theme.colors.ink} stopOpacity={.92}/></LinearGradient></Defs>
            <Rect width="100%" height="100%" fill="url(#medium-rail-fade)"/></Svg>
        </View>}
      </View>
      {hairline}
      {below.map(item)}
      {hairline}
      {serverAction && <Focusable testID="medium-rail-server" accessibilityRole="button" accessibilityLabel={serverAction.label} onPress={serverAction.onPress} focusRadius={mediumRailMetrics.itemRadius}
        style={{width: mediumRailMetrics.itemWidth, minHeight: 48, paddingTop: 8, paddingBottom: 6, borderRadius: mediumRailMetrics.itemRadius, alignItems: 'center', justifyContent: 'center'}}>
        <Icon name="i-activity" size={mediumRailMetrics.iconSize} color={theme.colors.textTertiary}/>
      </Focusable>}
      <View style={{marginTop: 'auto', alignItems: 'center'}}>
        {item({key: 'settings', icon: 'i-settings', label: defaultI18n.t('settings.title'), destination: {kind: 'settings'}})}
        <Focusable testID="medium-rail-profile" accessibilityRole="button" accessibilityLabel={defaultI18n.t('next.home.native.profileAndServer')} onPress={onProfile} focusRadius={mediumRailMetrics.itemRadius}
          style={{width: mediumRailMetrics.itemWidth, minHeight: 48, paddingTop: 8, paddingBottom: 6, borderRadius: mediumRailMetrics.itemRadius, alignItems: 'center', justifyContent: 'center', gap: 4}}>
          <View ref={profileRef} collapsable={false} style={{width: 30, height: 30}}><ProfileFace {...profile} size={30} locked={profile.pinRequired} scaleOnFocus={false}/>
            {unread && <View pointerEvents="none" style={{position: 'absolute', top: 0, right: 0, width: 7, height: 7, borderRadius: 4, backgroundColor: theme.colors.accentStrong, borderWidth: 2, borderColor: theme.colors.ink}}/>}</View>
          <Text numberOfLines={1} style={[theme.type.captionStrong, {fontSize: 10.5, lineHeight: 13.5, color: theme.colors.textTertiary}]}>{defaultI18n.t('web.shell.profile')}</Text>
        </Focusable>
      </View>
    </View>
  </View>;
}
