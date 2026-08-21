import React, {useCallback, useLayoutEffect, useRef, useState} from 'react';
import {Animated, Image, StyleSheet, Text, TVFocusGuideView, View, useTVEventHandler} from 'react-native';
import {
  Bookmark,
  Download,
  Film,
  Headphones,
  Home,
  Library,
  Mic2,
  Radio,
  Search,
  Settings,
  SlidersHorizontal,
  Tv,
  UserRound,
} from 'lucide-react-native';
import {SafeAreaView, useSafeAreaInsets} from 'react-native-safe-area-context';
import type {PrototypePlatform} from '@portico-prototypes/contract';
import {libraries} from '@portico-prototypes/fixtures';
import {color, font} from './tokens';
import {ContentFocusProvider, Focusable} from './primitives';
import {PorticoWordmark} from './sharedComponents';
import {usePrototypeUi} from './uiState';
import {type PrimaryDestination, usePorticoNavigation} from './navigation';
import {useReducedMotion} from './useReducedMotion';
import {porticoSymbolSource} from './brandAssets';

const primaryItems: ReadonlyArray<{
  id: PrimaryDestination;
  label: string;
  icon: typeof Home;
}> = [
  {id: 'home', label: 'Home', icon: Home},
  {id: 'library', label: 'Library', icon: Library},
  {id: 'channels', label: 'Channels', icon: Radio},
  {id: 'saved', label: 'Saved', icon: Bookmark},
  {id: 'downloads', label: 'Downloads', icon: Download},
];

const tvPrimaryItems = primaryItems.filter(item => item.id !== 'downloads');

export function AppleShell({children, platform}: {children: React.ReactNode; platform: PrototypePlatform}) {
  return platform === 'tv' ? <TvShell>{children}</TvShell> : <MobileShell>{children}</MobileShell>;
}

function MobileShell({children}: {children: React.ReactNode}) {
  const {route, selectPrimary} = usePorticoNavigation();
  const insets = useSafeAreaInsets();
  const primary = isPrimary(route.name);
  const artworkRoute = route.name === 'home' || route.name === 'detail' || route.name === 'player';
  return (
    <View style={styles.root}>
      <SafeAreaView edges={artworkRoute ? ['left', 'right'] : ['top', 'left', 'right']} style={styles.mobileContent}>{children}</SafeAreaView>
      {primary ? (
        <View style={[styles.bottomNav, {height: 64 + insets.bottom, paddingBottom: insets.bottom}]} testID="portico-four-mobile-navigation">
          {primaryItems.map(item => {
            const Icon = item.icon;
            const selected = route.name === item.id;
            return (
              <Focusable
                accessibilityLabel={item.label}
                accessibilityRole="tab"
                accessibilityState={{selected}}
                key={item.id}
                onPress={() => selectPrimary(item.id)}
                platform="mobile"
                style={styles.bottomNavItem}
                focusedStyle={styles.bottomNavItemFocused}
                pressedStyle={styles.bottomNavItemPressed}>
                <Icon color={selected ? color.screenBlueStrong : color.dimSilver} fill={selected && item.id === 'home' ? color.screenBlueStrong : 'none'} size={23} strokeWidth={2} />
                <Text style={[styles.bottomNavLabel, selected && styles.bottomNavLabelSelected]}>{item.label}</Text>
                <View style={[styles.bottomNavRule, selected && styles.bottomNavRuleSelected]} />
              </Focusable>
            );
          })}
        </View>
      ) : null}
    </View>
  );
}

function TvShell({children}: {children: React.ReactNode}) {
  const {openSearch, openSettings, route, selectPrimary, stack} = usePorticoNavigation();
  const {railExpanded: expanded, selectedLibraryId, setLibraryTab, setOverlay, setRailExpanded: setExpanded, setSelectedLibraryId} = usePrototypeUi();
  const reducedMotion = useReducedMotion();
  const railFocused = useRef(false);
  const [handoffLocked, setHandoffLocked] = useState(false);
  const width = useRef(new Animated.Value(80)).current;
  const labelOpacity = useRef(new Animated.Value(0)).current;
  const animatedExpanded = useRef(expanded);
  const contentShift = width.interpolate({
    inputRange: [80, 280],
    outputRange: [0, 200],
  });
  const activePrimary = isPrimary(stack[0]?.name) ? stack[0]?.name : 'home';

  useTVEventHandler(event => {
    if (expanded && railFocused.current && event.eventType === 'right') {
      setHandoffLocked(true);
      setExpanded(false);
    }
  });

  useLayoutEffect(() => {
    if (animatedExpanded.current === expanded) {
      width.setValue(expanded ? 280 : 80);
      labelOpacity.setValue(expanded ? 1 : 0);
      setHandoffLocked(false);
      return;
    }
    animatedExpanded.current = expanded;
    if (expanded) {
      setHandoffLocked(false);
    } else {
      setHandoffLocked(true);
    }
    Animated.parallel([
      Animated.timing(width, {duration: reducedMotion ? 0 : 160, toValue: expanded ? 280 : 80, useNativeDriver: false}),
      Animated.timing(labelOpacity, {duration: reducedMotion ? 0 : 130, toValue: expanded ? 1 : 0, useNativeDriver: false}),
    ]).start(({finished}) => {
      if (finished && !expanded) {
        setHandoffLocked(false);
      }
    });
  }, [expanded, labelOpacity, reducedMotion, width]);

  const collapseRail = useCallback(() => {
    if (expanded) {
      setHandoffLocked(true);
    }
    setExpanded(false);
  }, [expanded, setExpanded]);

  const railFocus = () => {
    railFocused.current = true;
    setExpanded(true);
  };
  const railBlur = () => {
    railFocused.current = false;
    setTimeout(() => {
      if (!railFocused.current) {
        collapseRail();
      }
    }, 70);
  };
  const runRailAction = (action: () => void) => {
    action();
    collapseRail();
  };

  if (route.name === 'player') {
    return <View style={styles.root}>{children}</View>;
  }

  if (route.name === 'sign-in') {
    return <SafeAreaView edges={['top', 'left', 'right', 'bottom']} style={styles.root}>{children}</SafeAreaView>;
  }

  return (
    <View style={styles.root}>
      <ContentFocusProvider onContentFocus={collapseRail}>
        <Animated.View style={[styles.tvContent, {transform: [{translateX: contentShift}]}]}>{children}</Animated.View>
      </ContentFocusProvider>
      <Animated.View style={[styles.rail, {width}]} testID="portico-four-tv-navigation">
        <View style={styles.railBrand}>
          {expanded ? <PorticoWordmark platform="tv" /> : <View style={styles.collapsedMark}><Image resizeMode="contain" source={porticoSymbolSource} style={styles.collapsedMarkImage} /></View>}
        </View>
        <TVFocusGuideView trapFocusLeft trapFocusRight={expanded || handoffLocked} style={styles.railFocusGuide}>
        <View style={styles.railItems}>
          {tvPrimaryItems.slice(0, 1).map(item => (
            <RailItem
              expanded={expanded}
              icon={item.icon}
              key={item.id}
              label={item.label}
              labelOpacity={labelOpacity}
              onBlur={railBlur}
              onFocus={railFocus}
              onPress={() => runRailAction(() => selectPrimary(item.id))}
              selected={activePrimary === item.id}
            />
          ))}
          <RailItem
            expanded={expanded}
            icon={Search}
            label="Search"
            labelOpacity={labelOpacity}
            onBlur={railBlur}
            onFocus={railFocus}
            onPress={() => runRailAction(openSearch)}
            selected={route.name === 'search'}
          />
          {tvPrimaryItems.slice(1).map(item => (
            <RailItem
              expanded={expanded}
              icon={item.icon}
              key={item.id}
              label={item.label}
              labelOpacity={labelOpacity}
              onBlur={railBlur}
              onFocus={railFocus}
              onPress={() => runRailAction(() => selectPrimary(item.id))}
              selected={activePrimary === item.id}
            />
          ))}
        </View>
        <View style={styles.railDivider} />
        <View style={styles.railLibraries}>
          {libraries.slice(0, 4).map(library => (
            <RailItem
              expanded={expanded}
              icon={libraryIcon(library.id)}
              key={library.id}
              label={library.name}
              labelOpacity={labelOpacity}
              onBlur={railBlur}
              onFocus={railFocus}
              onPress={() => runRailAction(() => {
                setSelectedLibraryId(library.id);
                setLibraryTab(library.tabs[0] ?? 'Discover');
                selectPrimary('library');
              })}
              selected={activePrimary === 'library' && selectedLibraryId === library.id}
            />
          ))}
        </View>
        <View style={styles.railBottom}>
          <RailItem expanded={expanded} icon={UserRound} label="Profile" labelOpacity={labelOpacity} onBlur={railBlur} onFocus={railFocus} onPress={() => runRailAction(() => setOverlay('profile'))} selected={false} />
          <RailItem expanded={expanded} icon={Settings} label="Settings" labelOpacity={labelOpacity} onBlur={railBlur} onFocus={railFocus} onPress={() => runRailAction(openSettings)} selected={route.name === 'settings'} />
          <RailItem expanded={expanded} icon={SlidersHorizontal} label="Scenarios" labelOpacity={labelOpacity} onBlur={railBlur} onFocus={railFocus} onPress={() => runRailAction(() => setOverlay('scenario'))} selected={false} />
        </View>
        </TVFocusGuideView>
      </Animated.View>
    </View>
  );
}

function RailItem({
  expanded,
  icon: Icon,
  label,
  labelOpacity,
  onBlur,
  onFocus,
  onPress,
  selected,
}: {
  expanded: boolean;
  icon: typeof Home;
  label: string;
  labelOpacity: Animated.Value;
  onBlur(): void;
  onFocus(): void;
  onPress(): void;
  selected: boolean;
}) {
  return (
    <Focusable
      accessibilityLabel={label}
      accessibilityRole="button"
      onBlur={onBlur}
      onFocus={onFocus}
      onPress={onPress}
      platform="tv"
      style={[styles.railItem, expanded && styles.railItemExpanded, selected && styles.railItemSelected]}
      focusedStyle={styles.railItemFocused}
      pressedStyle={styles.railItemPressed}>
      <View style={styles.railIconFrame}>
        <Icon color={selected ? color.screenBlueStrong : color.softSilver} fill={selected && label === 'Home' ? color.screenBlueStrong : 'none'} size={28} strokeWidth={2} />
      </View>
      <Animated.Text numberOfLines={1} style={[styles.railLabel, {opacity: labelOpacity}]}>{label}</Animated.Text>
      {selected ? <View style={styles.railSelection} /> : null}
    </Focusable>
  );
}

function isPrimary(value: string | undefined): value is PrimaryDestination {
  return value === 'home' || value === 'library' || value === 'channels' || value === 'saved' || value === 'downloads';
}

function libraryIcon(id: string): typeof Home {
  switch (id) {
    case 'movies': return Film;
    case 'television': return Tv;
    case 'music': return Mic2;
    case 'audiobooks': return Headphones;
    default: return Library;
  }
}

const styles = StyleSheet.create({
  root: {backgroundColor: color.projector, flex: 1},
  mobileContent: {flex: 1},
  bottomNav: {backgroundColor: color.projector, borderTopColor: color.line, borderTopWidth: 1, flexDirection: 'row', height: 64, zIndex: 60},
  bottomNavItem: {alignItems: 'center', borderColor: color.transparent, borderTopWidth: 2, flex: 1, justifyContent: 'center', paddingTop: 5},
  bottomNavItemFocused: {backgroundColor: color.recess},
  bottomNavItemPressed: {backgroundColor: color.raisedSlate},
  bottomNavLabel: {color: color.dimSilver, fontFamily: font.medium, fontSize: 10, lineHeight: 14, marginTop: 3},
  bottomNavLabelSelected: {color: color.screenBlueStrong},
  bottomNavRule: {backgroundColor: color.transparent, bottom: 0, height: 2, position: 'absolute', width: 28},
  bottomNavRuleSelected: {backgroundColor: color.screenBlue},
  tvContent: {flex: 1, paddingLeft: 136},
  rail: {backgroundColor: color.projector, borderRightColor: color.line, borderRightWidth: 1, bottom: 24, left: 24, overflow: 'hidden', paddingBottom: 16, paddingHorizontal: 8, paddingTop: 16, position: 'absolute', top: 24, zIndex: 70},
  railBrand: {alignItems: 'flex-start', height: 58, justifyContent: 'center', paddingHorizontal: 11},
  collapsedMark: {alignItems: 'center', backgroundColor: color.screenBlueDeep, borderRadius: 8, height: 38, justifyContent: 'center', width: 38},
  collapsedMarkImage: {height: 28, width: 28},
  railFocusGuide: {flex: 1},
  railItems: {gap: 4},
  railDivider: {backgroundColor: color.line, height: 1, marginHorizontal: 10, marginVertical: 10},
  railLibraries: {gap: 2},
  railBottom: {gap: 2, marginTop: 'auto'},
  railItem: {alignItems: 'center', borderColor: color.transparent, borderRadius: 8, borderWidth: 3, flexDirection: 'row', height: 64, overflow: 'hidden', paddingHorizontal: 8, position: 'relative'},
  railItemExpanded: {paddingRight: 14},
  railItemSelected: {backgroundColor: color.raisedSlate},
  railItemFocused: {backgroundColor: color.brightSlate, borderColor: color.focus},
  railItemPressed: {backgroundColor: color.recess},
  railIconFrame: {alignItems: 'center', height: 38, justifyContent: 'center', width: 42},
  railLabel: {color: color.silver, fontFamily: font.demi, fontSize: 21, lineHeight: 27, marginLeft: 12, width: 174},
  railSelection: {backgroundColor: color.screenBlue, bottom: 8, left: 0, position: 'absolute', top: 8, width: 3},
});
