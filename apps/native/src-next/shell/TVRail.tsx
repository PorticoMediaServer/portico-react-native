import React, {useRef} from 'react';
import {Image, ScrollView, Text, View} from 'react-native';
import Svg, {Defs, LinearGradient, Rect, Stop, SvgXml} from 'react-native-svg';
import Animated, {useAnimatedStyle, useSharedValue, withDelay, withTiming} from 'react-native-reanimated';
import {defaultI18n} from '../../../../packages/i18n/src';
import type {Library} from '../../../../packages/client-core/src';
import {brandSymbol} from '../../assets/brandSymbol';
import {Focusable} from '../kit/controls';
import {ProfileFace, type ProfileOption} from '../kit/artwork';
import {Icon, type IconName} from '../kit/Icon';
import {useTheme} from '../kit/theme';
import {useMotion} from '../kit/useMotion';
import {libraryIcon, visibleLibraries, type ShellDestination} from './model';

type RailEntry = {key: string; label: string; icon: IconName; destination: ShellDestination};
export function TVRail({libraries, hasLiveTV, destination, profile, onNavigate, onProfile, profileRef, onExpandedChange}: {
  libraries: readonly Library[]; hasLiveTV: boolean; destination: ShellDestination; profile: ProfileOption;
  onNavigate: (destination: ShellDestination) => void; onProfile: () => void;
  profileRef: React.RefObject<View | null>; onExpandedChange: (expanded: boolean) => void;
}) {
  const theme = useTheme(), motion = useMotion(), spec = theme.spec.navigation.tv;
  const expanded = useSharedValue(0), labelOpacity = useSharedValue(0), [open, setOpen] = React.useState(false);
  const pendingBlur = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const change = (value: boolean) => {
    if (pendingBlur.current) clearTimeout(pendingBlur.current);
    setOpen(value); onExpandedChange(value);
    expanded.value = withTiming(value ? 1 : 0, motion.timing('standard'));
    labelOpacity.value = value ? withDelay(motion.transforms ? 60 : 0, withTiming(1, motion.timing('standard'))) : withTiming(0, motion.timing('quick'));
  };
  React.useEffect(() => () => {if (pendingBlur.current) clearTimeout(pendingBlur.current);}, []);
  const panel = useAnimatedStyle(() => ({transform: [{translateX: motion.transforms ? (expanded.value - 1) * (spec.openWidth - spec.width) : 0}]}));
  const counter = useAnimatedStyle(() => ({transform: [{translateX: motion.transforms ? (1 - expanded.value) * (spec.openWidth - spec.width) : 0}]}));
  const labels = useAnimatedStyle(() => ({opacity: labelOpacity.value}));
  const entries: RailEntry[] = [
    {key: 'search', icon: 'i-search', label: defaultI18n.t('web.shell.search'), destination: {kind: 'search'}},
    {key: 'home', icon: 'i-home', label: defaultI18n.t('web.shell.home'), destination: {kind: 'home'}},
    ...visibleLibraries(libraries, true).map(library => ({key: 'library:' + library.id, label: library.name, icon: libraryIcon(library.kind), destination: {kind: 'library' as const, libraryId: library.id}})),
    ...(hasLiveTV ? [{key: 'live', icon: 'i-live' as const, label: defaultI18n.t('search.chip.liveTV'), destination: {kind: 'live' as const}}] : []),
    {key: 'saved', icon: 'i-bookmark', label: defaultI18n.t('saved.title'), destination: {kind: 'saved'}},
  ];
  const item = (entry: RailEntry) => {
    const selected = entry.destination.kind === destination.kind && (entry.destination.kind !== 'library' || destination.kind === 'library' && entry.destination.libraryId === destination.libraryId);
    return <Focusable key={entry.key} testID={`tv-rail-${entry.key}`} accessibilityRole="button" accessibilityLabel={entry.label} accessibilityState={{selected}} onPress={() => onNavigate(entry.destination)} focusRadius={spec.itemRadius} focusKind="button"
      style={({focused}) => ({height: spec.itemSize, width: spec.openItemWidth, paddingHorizontal: 17, flexDirection: 'row', alignItems: 'center', gap: spec.labelGap, borderRadius: spec.itemRadius, backgroundColor: focused ? `${theme.colors.text}0F` : undefined})}>
      {({focused}) => <>{selected && <View pointerEvents="none" style={{position: 'absolute', left: -16, top: 18, bottom: 18, width: 4, borderRadius: 2, backgroundColor: theme.colors.accent}}/>}
        <Icon name={entry.icon} size={30} color={selected || focused ? theme.colors.text : theme.colors.textTertiary}/>
        <Animated.Text numberOfLines={1} style={[theme.type.bodyStrong, {color: selected || focused ? theme.colors.text : theme.colors.textTertiary, flexShrink: 1}, labels]}>{entry.label}</Animated.Text></>}
    </Focusable>;
  };
  return <View pointerEvents="box-none" style={{position: 'absolute', left: 0, top: 0, bottom: 0, width: open ? spec.openWidth : spec.width, zIndex: theme.layers.navigation}}>
    <Animated.View pointerEvents="none" style={[{position: 'absolute', inset: 0, width: spec.openWidth}, panel]}>
      <Svg width="100%" height="100%"><Defs><LinearGradient id="native-rail" x1="0" y1="0" x2="1" y2="0"><Stop offset="0" stopColor={theme.colors.ink} stopOpacity={open ? .99 : .78}/><Stop offset={open ? .66 : .45} stopColor={theme.colors.ink} stopOpacity={open ? .96 : .42}/><Stop offset="1" stopColor={theme.colors.ink} stopOpacity={0}/></LinearGradient></Defs><Rect width="100%" height="100%" fill="url(#native-rail)"/></Svg>
    </Animated.View>
    <Animated.View accessibilityLabel={defaultI18n.t('next.home.native.mainNavigation')} onFocus={() => change(true)} onBlur={() => {pendingBlur.current = setTimeout(() => change(false), 0);}}
      style={[{flex: 1, width: spec.openWidth, paddingLeft: spec.insetLeft, paddingTop: spec.paddingTop, paddingBottom: spec.paddingBottom}, panel]}>
      <Animated.View style={[{flex: 1}, counter]}>
        <View accessible={false} style={{height: 40, marginLeft: 16, marginBottom: 64}}>
          {open ? <Image source={require('../../assets/wordmark.png')} resizeMode="contain" style={{width: 130, height: 30, marginTop: 5}}/> : <SvgXml xml={brandSymbol} width={28} height={40}/>}
        </View>
        <ScrollView style={{flex: 1}} contentContainerStyle={{gap: spec.itemGap, paddingVertical: 10}} showsVerticalScrollIndicator={false}>{entries.map(item)}</ScrollView>
        <View style={{gap: spec.itemGap, paddingTop: 8}}>
          {item({key: 'settings', label: defaultI18n.t('settings.title'), icon: 'i-settings', destination: {kind: 'settings'}})}
          <Focusable ref={profileRef} testID="tv-rail-profile" accessibilityRole="button" accessibilityLabel={defaultI18n.t('next.home.native.profileAndServer')} onPress={onProfile} focusRadius={14}
            style={{height: 76, width: spec.openItemWidth, paddingHorizontal: 12, flexDirection: 'row', alignItems: 'center', gap: 22}}>
            <ProfileFace {...profile} size={40} scaleOnFocus={false}/><Animated.View style={[{flex: 1}, labels]}><Text numberOfLines={1} style={[theme.type.bodyStrong, {color: theme.colors.text}]}>{profile.name}</Text><Text style={[theme.type.caption, {color: theme.colors.textTertiary, marginTop: 2}]}>{defaultI18n.t('next.home.native.profileAndServer')}</Text></Animated.View>
          </Focusable>
        </View>
      </Animated.View>
    </Animated.View>
  </View>;
}
