import React, {useId, useState} from 'react';
import {Image, ScrollView, Text, View} from 'react-native';
import Svg, {Defs, LinearGradient, Rect, Stop, SvgXml} from 'react-native-svg';
import {useSafeAreaInsets} from 'react-native-safe-area-context';
import {libraryNavigationIcon, type Library} from '../../../../packages/client-core/src';
import {defaultI18n} from '../../../../packages/i18n/src';
import {brandSymbol} from '../../assets/brandSymbol';
import {Focusable} from '../kit/controls';
import {ProfileFace, type ProfileOption} from '../kit/artwork';
import {Icon, type IconName} from '../kit/Icon';
import {fontFamilies, useTheme, type SizeClass} from '../kit/theme';
import {BlurView} from '../platform/native-blur';
import {touchNavigationWidth, type ShellDestination} from './model';
import type {NavigationTool, NavigationTools} from './navigation-tools';
import {sameDestination} from './tv-focus';

type Entry = {key: string; icon: IconName; label: string; destination: ShellDestination};

/** Only libraries yield their height. Destinations and account controls stay reachable. */
export function TouchNavigation({sizeClass, collapsed, onCollapsedChange, libraries, hasLiveTV, destination, profile, username, serverName, tools, profileRef, onNavigate, onProfile}: {
  sizeClass: Exclude<SizeClass, 'compact'>; collapsed: boolean; onCollapsedChange: (collapsed: boolean) => void;
  libraries: readonly Library[]; hasLiveTV: boolean; destination: ShellDestination; profile: ProfileOption;
  username: string; serverName?: string; tools: NavigationTools;
  profileRef: React.RefObject<View | null>; onNavigate: (destination: ShellDestination) => void; onProfile: () => void;
}) {
  const theme = useTheme(), insets = useSafeAreaInsets(), gradientId = useId();
  const sidebar = sizeClass === 'expanded' && !collapsed;
  const [viewport, setViewport] = useState(0), [contentHeight, setContentHeight] = useState(0), [offset, setOffset] = useState(0);
  const rowStyle = {minHeight: 44, width: sidebar ? '100%' as const : 72, flexShrink: 0,
    paddingHorizontal: sidebar ? 12 : 0, paddingTop: sidebar ? 0 : 6, paddingBottom: sidebar ? 0 : 5,
    flexDirection: sidebar ? 'row' as const : 'column' as const, alignItems: 'center' as const,
    justifyContent: sidebar ? 'flex-start' as const : 'center' as const, gap: sidebar ? 12 : 3, borderRadius: sidebar ? 12 : 14};
  const labelStyle = {fontFamily: fontFamilies[600], fontSize: sidebar ? 15 : 10.5, letterSpacing: sidebar ? -.15 : -.0525, color: theme.colors.textSecondary, flexShrink: 1, maxWidth: '100%' as const};
  const item = (entry: Entry) => {
    const selected = sameDestination(destination, entry.destination);
    const color = selected ? theme.colors.text : theme.colors.textSecondary;
    return <Focusable key={entry.key} testID={`touch-nav-${entry.key}`} accessibilityRole="button" accessibilityLabel={entry.label}
      accessibilityState={{selected}} onPress={() => onNavigate(entry.destination)} focusRadius={sidebar ? 12 : 14}
      style={[rowStyle, {backgroundColor: selected ? `${theme.colors.text}1A` : 'transparent'}, !sidebar && entry.key === 'settings' && {height: 44, paddingVertical: 0}]}>
      <Icon name={entry.icon} size={sidebar ? 20 : 22} color={color}/>
      {(sidebar || entry.key !== 'settings') && <Text numberOfLines={1} style={[labelStyle, {color}]}>{entry.label}</Text>}
    </Focusable>;
  };
  const divider = (key: string) => <View key={key} testID={`touch-nav-divider-${key}`} style={{height: 1, flexShrink: 0,
    width: sidebar ? undefined : 36, alignSelf: sidebar ? 'stretch' : 'center', marginHorizontal: sidebar ? 12 : 0,
    marginVertical: sidebar ? 9 : 5, backgroundColor: `${theme.colors.text}14`}}/>;
  const tool = (key: string, icon: IconName, label: string, value: NavigationTool | undefined) => value && <Focusable key={key}
    testID={`touch-nav-${key}`} accessibilityRole="button" accessibilityLabel={label}
    accessibilityValue={value.count !== undefined ? {now: value.count, min: 0} : undefined} onPress={value.onPress}
    style={[rowStyle, {height: 44, paddingVertical: 0, flexDirection: 'row', position: 'relative'}]}>
    <Icon name={icon} size={sidebar ? 20 : 22} color={theme.colors.textSecondary}/>
    {sidebar && <Text numberOfLines={1} style={[labelStyle, {flex: 1}]}>{label}</Text>}
    {value.count !== undefined && (key === 'activity' || value.count > 0) && <View testID={`touch-nav-${key}-count`}
      pointerEvents="none" style={[{height: sidebar ? 22 : 18, minWidth: sidebar ? 22 : 18, paddingHorizontal: sidebar ? 7 : 5,
        alignItems: 'center', justifyContent: 'center', borderRadius: 999, backgroundColor: key === 'notifications' ? theme.colors.accentStrong : `${theme.colors.accent}24`},
        !sidebar && {position: 'absolute', top: 3, right: 8, borderWidth: 2, borderColor: theme.colors.ink}]}>
      <Text style={{fontFamily: fontFamilies[800], fontSize: sidebar ? 12 : 11, color: key === 'notifications' ? theme.colors.actionInk : theme.colors.textSecondary}}>{value.count}</Text>
    </View>}
  </Focusable>;
  const toggleLabel = defaultI18n.t(sidebar ? 'web.shell.collapse' : 'web.shell.expand');
  const maxOffset = Math.max(0, contentHeight - viewport), actualOffset = Math.max(0, Math.min(offset, maxOffset));
  const fade = (edge: 'top' | 'bottom') => <View testID={`touch-nav-library-fade-${edge}`} pointerEvents="none"
    style={{position: 'absolute', left: 0, right: 0, [edge]: 0, height: 20}}>
    <Svg width="100%" height="100%"><Defs><LinearGradient id={`${gradientId}-${edge}`} x1="0" y1="0" x2="0" y2="1">
      <Stop offset="0" stopColor={theme.colors.ink} stopOpacity={edge === 'top' ? 1 : 0}/><Stop offset="1" stopColor={theme.colors.ink} stopOpacity={edge === 'top' ? 0 : 1}/>
    </LinearGradient></Defs><Rect width="100%" height="100%" fill={`url(#${gradientId}-${edge})`}/></Svg>
  </View>;
  return <View testID={sidebar ? 'touch-sidebar' : 'touch-rail'} accessibilityLabel={defaultI18n.t('next.home.native.mainNavigation')}
    style={{position: 'absolute', left: 0, top: 0, bottom: 0, width: touchNavigationWidth(sizeClass, collapsed) + insets.left,
      paddingLeft: (sidebar ? 12 : 6) + insets.left, paddingRight: sidebar ? 12 : 6,
      paddingTop: Math.max(sidebar ? 44 : 42, insets.top), paddingBottom: Math.max(sidebar ? 14 : 12, insets.bottom),
      gap: sidebar ? 1 : 2, zIndex: theme.layers.navigation, borderRightWidth: 1, borderRightColor: theme.colors.line, overflow: 'hidden'}}>
    <BlurView pointerEvents="none" style={{position: 'absolute', inset: 0}} blurType="dark" blurAmount={18} reducedTransparencyFallbackColor={theme.colors.ink}/>
    <View pointerEvents="none" style={{position: 'absolute', inset: 0, backgroundColor: theme.colors.ink, opacity: .72}}/>
    {sizeClass === 'expanded' && <View testID="touch-nav-brand" style={{height: sidebar ? 48 : 88, flexShrink: 0, paddingLeft: sidebar ? 12 : 0,
      flexDirection: sidebar ? 'row' : 'column', alignItems: 'center', justifyContent: 'center'}}>
      {sidebar ? <Image source={require('../../assets/wordmark.png')} resizeMode="contain" style={{width: 74, height: 17}} accessible={false}/>
        : <SvgXml xml={brandSymbol} width={19} height={28} style={{marginVertical: 8}} accessible={false}/>}
      <Focusable testID="touch-nav-toggle" accessibilityRole="button" accessibilityLabel={toggleLabel} accessibilityState={{expanded: sidebar}}
        onPress={() => onCollapsedChange(!collapsed)} style={{minWidth: 44, minHeight: 44, width: 44, height: 44, marginLeft: sidebar ? 'auto' : 0,
          borderRadius: 12, alignItems: 'center', justifyContent: 'center'}}><Icon name="i-panels" size={22}/></Focusable>
    </View>}
    <View testID="touch-nav-primary" style={{flexShrink: 0, gap: sidebar ? 1 : 2, alignItems: 'center'}}>
      {item({key: 'search', icon: 'i-search', label: defaultI18n.t('web.shell.search'), destination: {kind: 'search'}})}
      {item({key: 'home', icon: 'i-home', label: defaultI18n.t('web.shell.home'), destination: {kind: 'home'}})}
    </View>
    {sidebar ? <Text testID="touch-nav-library-heading" style={{fontFamily: fontFamilies[600], fontSize: 12, color: theme.colors.textTertiary,
      marginTop: 14, marginHorizontal: 12, marginBottom: 4}}>{defaultI18n.t('web.shell.libraries')}</Text> : divider('libraries')}
    <View testID="touch-nav-library-viewport" style={{flexShrink: 1, height: contentHeight || undefined, minHeight: 0, overflow: 'hidden'}} onLayout={event => setViewport(event.nativeEvent.layout.height)}>
      <ScrollView testID="touch-nav-libraries" style={{flexGrow: 0, flexShrink: 1, minHeight: 0}} contentContainerStyle={{gap: sidebar ? 1 : 2, alignItems: 'center'}}
        showsVerticalScrollIndicator={false} scrollEventThrottle={16} onContentSizeChange={(_, height) => setContentHeight(height)}
        onScroll={event => setOffset(event.nativeEvent.contentOffset.y)}>
        {libraries.map(library => item({key: `library:${library.id}`, icon: libraryNavigationIcon(library.kind, 'touch'), label: library.name, destination: {kind: 'library', libraryId: library.id}}))}
      </ScrollView>
      {viewport > 0 && actualOffset > 1 && fade('top')}
      {viewport > 0 && actualOffset + 1 < maxOffset && fade('bottom')}
    </View>
    {divider('destinations')}
    <View testID="touch-nav-secondary" style={{flexShrink: 0, gap: sidebar ? 1 : 2, alignItems: 'center'}}>
      {hasLiveTV && item({key: 'live', icon: 'i-live', label: defaultI18n.t('search.chip.liveTV'), destination: {kind: 'live'}})}
      {item({key: 'saved', icon: 'i-bookmark', label: defaultI18n.t('saved.title'), destination: {kind: 'saved'}})}
    </View>
    <View testID="touch-nav-footer-spacer" style={{flex: 1, minHeight: 0}}/>
    {divider('footer')}
    <View testID="touch-nav-footer" style={{flexShrink: 0, gap: sidebar ? 1 : 2, alignItems: 'center'}}>
      {tool('notifications', 'i-bell', defaultI18n.t('notifications.title'), tools.notifications)}
      {tool('activity', 'i-act', defaultI18n.t('next.shell.activity'), tools.activity)}
      {item({key: 'settings', icon: 'i-settings', label: defaultI18n.t('settings.title'), destination: {kind: 'settings'}})}
      <Focusable ref={profileRef} testID="touch-nav-profile" accessibilityRole="button" accessibilityLabel={defaultI18n.t('next.home.native.profileAndServer')}
        onPress={onProfile} style={{minHeight: 44, height: sidebar ? 60 : 44, width: sidebar ? '100%' : 72, flexShrink: 0, marginTop: sidebar ? 6 : 4,
          paddingLeft: sidebar ? 10 : 0, paddingRight: sidebar ? 12 : 0, gap: 12, flexDirection: 'row', alignItems: 'center', justifyContent: sidebar ? 'flex-start' : 'center',
          borderRadius: 14, backgroundColor: sidebar ? `${theme.colors.text}0F` : 'transparent'}}>
        <ProfileFace {...profile} size={sidebar ? 38 : 40} scaleOnFocus={false}/>
        {sidebar && <><View style={{flex: 1, minWidth: 0}}><Text testID="touch-nav-username" numberOfLines={1}
          style={{fontFamily: fontFamilies[700], fontSize: 14, color: theme.colors.text}}>{username}</Text>
          {serverName && <Text testID="touch-nav-server" numberOfLines={1} style={{fontFamily: fontFamilies[400], fontSize: 12, color: theme.colors.textTertiary, marginTop: 1}}>{serverName}</Text>}
        </View><Icon name="i-down" size={16} color={theme.colors.textTertiary}/></>}
      </Focusable>
    </View>
  </View>;
}
