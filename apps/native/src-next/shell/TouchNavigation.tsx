import React from 'react';
import {ScrollView, Text, View} from 'react-native';
import {useSafeAreaInsets} from 'react-native-safe-area-context';
import type {Library} from '../../../../packages/client-core/src';
import {defaultI18n} from '../../../../packages/i18n/src';
import {Focusable} from '../kit/controls';
import {ProfileFace, type ProfileOption} from '../kit/artwork';
import {Icon, type IconName} from '../kit/Icon';
import {useTheme, type SizeClass} from '../kit/theme';
import {BlurView} from '../platform/native-blur';
import {libraryIcon, touchNavigationWidth, type ShellDestination} from './model';
import {sameDestination} from './tv-focus';

type Entry = {key: string; icon: IconName; label: string; destination: ShellDestination};

/** Touch navigation follows TV ordering, while retaining Read and using touch targets. */
export function TouchNavigation({sizeClass, collapsed, onCollapsedChange, libraries, hasLiveTV, destination, profile, profileRef, onNavigate, onProfile}: {
  sizeClass: Exclude<SizeClass, 'compact'>; collapsed: boolean; onCollapsedChange: (collapsed: boolean) => void;
  libraries: readonly Library[]; hasLiveTV: boolean; destination: ShellDestination; profile: ProfileOption;
  profileRef: React.RefObject<View | null>; onNavigate: (destination: ShellDestination) => void; onProfile: () => void;
}) {
  const theme = useTheme(), insets = useSafeAreaInsets();
  const sidebar = sizeClass === 'expanded' && !collapsed;
  const entries: Entry[] = [
    {key: 'search', icon: 'i-search', label: defaultI18n.t('web.shell.search'), destination: {kind: 'search'}},
    {key: 'home', icon: 'i-home', label: defaultI18n.t('web.shell.home'), destination: {kind: 'home'}},
    ...libraries.map(library => ({key: 'library:' + library.id, icon: libraryIcon(library.kind), label: library.name, destination: {kind: 'library' as const, libraryId: library.id}})),
    ...(hasLiveTV ? [{key: 'live', icon: 'i-live' as const, label: defaultI18n.t('search.chip.liveTV'), destination: {kind: 'live' as const}}] : []),
    {key: 'saved', icon: 'i-bookmark', label: defaultI18n.t('saved.title'), destination: {kind: 'saved'}},
  ];
  const rowStyle = {minHeight: 44, width: sidebar ? '100%' as const : 64, paddingHorizontal: sidebar ? 12 : 0,
    paddingVertical: sidebar ? 0 : 8, flexDirection: sidebar ? 'row' as const : 'column' as const,
    alignItems: 'center' as const, justifyContent: sidebar ? 'flex-start' as const : 'center' as const,
    gap: sidebar ? 12 : 4, borderRadius: sidebar ? 12 : 14};
  const item = (entry: Entry) => {
    const selected = sameDestination(destination, entry.destination);
    const color = selected ? theme.colors.text : theme.colors.textSecondary;
    return <Focusable key={entry.key} testID={`touch-nav-${entry.key}`} accessibilityRole="button" accessibilityLabel={entry.label}
      accessibilityState={{selected}} onPress={() => onNavigate(entry.destination)} focusRadius={sidebar ? 12 : 14}
      style={[rowStyle, {backgroundColor: selected ? `${theme.colors.text}1A` : 'transparent'}]}>
      <Icon name={entry.icon} size={sidebar ? 20 : 22} color={color}/>
      <Text numberOfLines={1} style={[sidebar ? theme.type.nav : theme.type.tabBar, {color, flexShrink: 1, maxWidth: '100%'}]}>{entry.label}</Text>
    </Focusable>;
  };
  const toggleLabel = defaultI18n.t(sidebar ? 'web.shell.collapse' : 'web.shell.expand');
  return <View testID={sidebar ? 'touch-sidebar' : 'touch-rail'} accessibilityLabel={defaultI18n.t('next.home.native.mainNavigation')}
    style={{position: 'absolute', left: 0, top: 0, bottom: 0, width: touchNavigationWidth(sizeClass, collapsed) + insets.left,
      paddingLeft: (sidebar ? 14 : 10) + insets.left, paddingRight: sidebar ? 14 : 10,
      paddingTop: Math.max(sidebar ? 44 : 40, insets.top), paddingBottom: Math.max(16, insets.bottom),
      gap: sidebar ? 2 : 6, zIndex: theme.layers.navigation, borderRightWidth: 1, borderRightColor: theme.colors.line, overflow: 'hidden'}}>
    <BlurView pointerEvents="none" style={{position: 'absolute', inset: 0}} blurType="dark" blurAmount={18} reducedTransparencyFallbackColor={theme.colors.ink}/>
    <View pointerEvents="none" style={{position: 'absolute', inset: 0, backgroundColor: theme.colors.ink, opacity: .72}}/>
    {sizeClass === 'expanded' && <Focusable testID="touch-nav-toggle" accessibilityRole="button" accessibilityLabel={toggleLabel}
      accessibilityState={{expanded: sidebar}} onPress={() => onCollapsedChange(!collapsed)} style={rowStyle}>
      <Icon name="i-panels" size={22}/>{sidebar && <Text numberOfLines={1} style={[theme.type.nav, {color: theme.colors.text, flexShrink: 1}]}>{toggleLabel}</Text>}
    </Focusable>}
    <ScrollView testID="touch-nav-destinations" style={{flex: 1}} contentContainerStyle={{gap: sidebar ? 2 : 6, alignItems: 'center'}} showsVerticalScrollIndicator={false}>
      {entries.map(item)}
    </ScrollView>
    {item({key: 'settings', icon: 'i-settings', label: defaultI18n.t('settings.title'), destination: {kind: 'settings'}})}
    <Focusable ref={profileRef} testID="touch-nav-profile" accessibilityRole="button" accessibilityLabel={defaultI18n.t('next.home.native.profileAndServer')}
      onPress={onProfile} style={rowStyle}>
      <ProfileFace {...profile} size={sidebar ? 32 : 28} scaleOnFocus={false}/>
      <Text numberOfLines={1} style={[sidebar ? theme.type.nav : theme.type.tabBar, {color: theme.colors.text, flexShrink: 1, maxWidth: '100%'}]}>{profile.name}</Text>
    </Focusable>
  </View>;
}
