import React, {useCallback, useEffect, useRef, useState, useSyncExternalStore} from 'react';
import {View, useWindowDimensions} from 'react-native';
import Animated, {useAnimatedStyle, useSharedValue, withTiming} from 'react-native-reanimated';
import {useSafeAreaInsets} from 'react-native-safe-area-context';
import {OverlaysProvider} from '../kit/overlays';
import {AccountMenu} from '../kit/shell';
import {LibraryMenu, LibrarySwitcher, StickyBrowseHeader} from '../kit/browse';
import {useTheme} from '../kit/theme';
import {useMotion} from '../kit/useMotion';
import {HomeScreen} from '../screens/home/HomeScreen';
import {authorityKey, librariesDestination, phoneBarHeight, sameAuthority, selectedTab, shellLayout, type ShellDestination, type ShellTab} from './model';
import type {NativeShellRuntime, NativeShellSnapshot} from './runtime';
import {PhoneTabBar} from './PhoneTabBar';
import {PhoneHomeHeader} from './PhoneHomeHeader';
import {TVRail} from './TVRail';
import {NativePlaybackLayer} from './NativePlaybackLayer';
import {DesktopHeader} from './DesktopHeader';

export function NativeShell({runtime}: {runtime: NativeShellRuntime}) {
  const snapshot = useSyncExternalStore(runtime.subscribe, runtime.getSnapshot);
  // Permission/profile/server changes cannot reuse component state, focus, selections or images.
  return <OverlaysProvider><ShellSession key={authorityKey(snapshot.authority)} runtime={runtime} snapshot={snapshot}/></OverlaysProvider>;
}

function ShellSession({runtime, snapshot}: {runtime: NativeShellRuntime; snapshot: NativeShellSnapshot}) {
  const theme = useTheme(), motion = useMotion(), dimensions = useWindowDimensions(), insets = useSafeAreaInsets();
  const layout = shellLayout(dimensions.width, dimensions.height, theme.isTV);
  const destination = snapshot.destination;
  const [remembered, setRemembered] = useState<string>(), [memoryReady, setMemoryReady] = useState(false);
  const [accountOpen, setAccountOpen] = useState(false), [railExpanded, setRailExpanded] = useState(false);
  const [homeScrolled, setHomeScrolled] = useState(false);
  const avatarRef = useRef<View>(null), opening = useRef(0), alive = useRef<{runtime: NativeShellRuntime} | undefined>(undefined);
  const shift = useSharedValue(0), dim = useSharedValue(0), pageOpacity = useSharedValue(1);
  const current = useCallback(() => alive.current?.runtime === runtime && sameAuthority(snapshot.authority, runtime.getSnapshot().authority), [runtime, snapshot.authority]);
  useEffect(() => {
    const lifetime = alive, pending = opening, session = {runtime};
    lifetime.current = session;
    return () => {
      if (lifetime.current !== session) return;
      lifetime.current = undefined;
      pending.current++;
    };
  }, [runtime]);
  useEffect(() => {
    let pending = true;
    void runtime.memory.read(snapshot.authority).then(id => {if (pending && current()) {setRemembered(id); setMemoryReady(true);}}, error => {if (pending && current()) {setMemoryReady(true); runtime.reportError(error);}});
    return () => {pending = false;};
  }, [current, runtime, snapshot.authority]);
  useEffect(() => {
    if (destination.kind === 'library' && !snapshot.libraries.some(library => library.id === destination.libraryId)) runtime.onDestination({kind: 'libraries'});
    if (destination.kind === 'live' && !snapshot.hasLiveTV) runtime.onDestination({kind: 'home'});
  }, [destination, runtime, snapshot.hasLiveTV, snapshot.libraries]);
  const navigate = (next: ShellDestination) => {
    if (!current()) return;
    setAccountOpen(false); opening.current++;
    runtime.onDestination(next);
    pageOpacity.value = 0;
    pageOpacity.value = withTiming(1, motion.timing('quick'));
  };
  const openLibrary = (id: string) => {
    if (!current() || !snapshot.libraries.some(library => library.id === id && (!theme.isTV || library.kind !== 'books'))) return;
    setRemembered(id);
    void runtime.memory.remember(snapshot.authority, id).catch(runtime.reportError);
    navigate({kind: 'library', libraryId: id});
  };
  const selectTab = async (tab: ShellTab['id']) => {
    if (!current()) return;
    if (selectedTab(destination) === tab) {runtime.scrollToTop(destination); return;}
    if (tab !== 'libraries') {navigate({kind: tab}); return;}
    const mine = ++opening.current;
    const id = memoryReady ? remembered : await runtime.memory.read(snapshot.authority).catch(error => {runtime.reportError(error); return undefined;});
    if (!current() || mine !== opening.current) return;
    navigate(librariesDestination(id, runtime.getSnapshot().libraries));
  };
  const expanded = (value: boolean) => {
    setRailExpanded(value);
    // tv.html f2 moves the copy's left edge from200 to470. The frame wins the stale220 token.
    shift.value = withTiming(value ? 270 : 0, motion.timing('standard'));
    dim.value = withTiming(value ? .42 : 0, motion.timing('standard'));
  };
  const pageStyle = useAnimatedStyle(() => ({opacity: pageOpacity.value, transform: [{translateX: motion.transforms ? shift.value : 0}]}));
  const dimStyle = useAnimatedStyle(() => ({opacity: dim.value}));
  const library = destination.kind === 'library' ? snapshot.libraries.find(item => item.id === destination.libraryId) : undefined;
  const barHeight = layout.tabs ? phoneBarHeight(insets.bottom) : 0;
  const content = <>
    <Animated.View style={[{flex: 1}, pageStyle]}>
      {destination.kind === 'home' ? <HomeScreen runtime={runtime} authority={snapshot.authority} active={!snapshot.mediaExpanded && snapshot.homeVisible} heroObscured={snapshot.homeObscured} railExpanded={railExpanded} bottomInset={barHeight} onScrolledChange={setHomeScrolled}/>
        : <View style={{flex: 1, paddingBottom: barHeight}}>
          {!theme.isTV && library && <StickyBrowseHeader name={library.name} onLibraries={() => navigate({kind: 'libraries'})}
            switcher={<LibrarySwitcher libraries={snapshot.libraries} value={library.id} onValueChange={openLibrary}/>}
            menu={<LibraryMenu {...runtime.libraryMenu(library)}/>}/>} 
          {runtime.renderDestination(destination, openLibrary)}
        </View>}
    </Animated.View>
    {theme.isTV && <Animated.View pointerEvents="none" style={[{position: 'absolute', inset: 0, backgroundColor: theme.colors.ink, zIndex: theme.layers.navigation - 1}, dimStyle]}/>}
    {!snapshot.selectionActive && (theme.isTV ? <TVRail libraries={snapshot.libraries} hasLiveTV={snapshot.hasLiveTV} destination={destination} profile={snapshot.profile} onNavigate={next => next.kind === 'library' ? openLibrary(next.libraryId) : navigate(next)}
      onProfile={() => setAccountOpen(true)} profileRef={avatarRef} onExpandedChange={expanded}/>
      : <>
        {layout.kind === 'desktop' ? <DesktopHeader snapshot={snapshot} avatarRef={avatarRef} scrolled={homeScrolled} onNavigate={next => next.kind === 'library' ? openLibrary(next.libraryId) : navigate(next)} onProfile={() => setAccountOpen(true)} activity={runtime.desktopActivity}/>
          : destination.kind === 'home' && <PhoneHomeHeader profile={snapshot.profile} unread={snapshot.unreadNotifications} avatarRef={avatarRef} onProfile={() => setAccountOpen(true)} castControl={runtime.castControl} scrolled={homeScrolled}/>}
        {layout.tabs && <PhoneTabBar destination={destination} hasLiveTV={snapshot.hasLiveTV} onSelect={tab => {void selectTab(tab).catch(runtime.reportError);}}/>}
      </>)}
    <AccountMenu {...snapshot.account} profile={snapshot.profile} open={accountOpen} onOpenChange={setAccountOpen} anchorRef={avatarRef} returnFocusRef={avatarRef}/>
  </>;
  return <View testID="native-shell" style={{flex: 1, backgroundColor: theme.colors.ink, overflow: 'hidden'}}>
    {theme.isTV ? <View style={{position: 'absolute', left: layout.left, top: layout.top, width: layout.width, height: layout.height, transformOrigin: 'top left', transform: [{scale: layout.scale}]}}>{content}</View> : content}
    {runtime.playback && <NativePlaybackLayer adapter={runtime.playback} runtime={runtime} authority={snapshot.authority}/>}
    {runtime.renderRoutes()}
    {runtime.renderSelection()}
  </View>;
}
