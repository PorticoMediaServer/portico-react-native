import React, {useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, useSyncExternalStore} from 'react';
import {View, useWindowDimensions} from 'react-native';
import Animated, {useAnimatedStyle, useSharedValue, withTiming} from 'react-native-reanimated';
import {useSafeAreaInsets} from 'react-native-safe-area-context';
import {OverlaysProvider} from '../kit/overlays';
import {PlayerMorphProvider} from '../kit/dock/PlayerMorphBridge';
import {DockClearanceProvider} from '../kit/dock/DockClearance';
import {AccountMenu} from '../kit/shell';
import {useTheme} from '../kit/theme';
import {useMotion} from '../kit/useMotion';
import {useTVMenuCapture} from '../platform/tv-menu';
import {useFocusRegistry, type FocusSnapshot} from '../kit/focus';
import {tvFocusIds, sameDestination} from './tv-focus';
import {HomeScreen} from '../screens/home/HomeScreen';
import {authorityKey, canOpenLibrary, librariesDestination, mediumRailMetrics, phoneBarHeight, sameAuthority, selectedTab, shellLayout, type ShellDestination, type ShellTab} from './model';
import {nativeScreenChromeHidden, subscribeNativeScreenChrome} from './chrome';
import type {NativeShellRuntime, NativeShellSnapshot} from './runtime';
import {PhoneTabBar} from './PhoneTabBar';
import {PhoneHomeHeader} from './PhoneHomeHeader';
import {MediumRail} from './MediumRail';
import {TVRail} from './TVRail';
import {TVProfileMenu} from './TVProfileMenu';
import {NativePlaybackLayer} from './NativePlaybackLayer';

export function NativeShell({runtime}: {runtime: NativeShellRuntime}) {
  const snapshot = useSyncExternalStore(runtime.subscribe, runtime.getSnapshot);
  // Permission/profile/server changes cannot reuse component state, focus, selections or images.
  return <OverlaysProvider key={authorityKey(snapshot.authority)}><PlayerMorphProvider><DockClearanceProvider><ShellSession key={authorityKey(snapshot.authority)} runtime={runtime} snapshot={snapshot}/></DockClearanceProvider></PlayerMorphProvider></OverlaysProvider>;
}

function ShellSession({runtime, snapshot}: {runtime: NativeShellRuntime; snapshot: NativeShellSnapshot}) {
  const theme = useTheme(), motion = useMotion(), dimensions = useWindowDimensions(), insets = useSafeAreaInsets();
  const chromeHidden = useSyncExternalStore(subscribeNativeScreenChrome, nativeScreenChromeHidden);
  const layout = shellLayout(dimensions.width, dimensions.height, theme.isTV);
  /** phone-guide 2 draws the compact row bar on a landscape phone. */
  const landscapePhone = layout.kind === 'phone' && dimensions.width > dimensions.height;
  /** The sidebar's own breakpoint, captured so the hook reads a plain value. */
  const wideSidebar = dimensions.width >= 1024;
  const destination = snapshot.destination, registry = useFocusRegistry(), ids = useMemo(() => tvFocusIds(snapshot.authority), [snapshot.authority]);
  useSyncExternalStore(registry.subscribe, registry.getSnapshot, registry.getSnapshot);
  const pageFocus = useRef<FocusSnapshot | undefined>(undefined), railRelease = useRef<(() => void) | undefined>(undefined);
  useEffect(() => {const remember = () => {const saved = registry.capture();
    if (saved && (saved.regionId !== ids.rail && registry.config(saved.regionId)?.hold !== true)) pageFocus.current = saved;
  }; remember(); return registry.subscribe(remember);}, [ids, registry]);
  const pageHold = snapshot.mediaExpanded || destination.kind === 'home' && !snapshot.homeVisible;
  const heldPage = useRef<{opener: FocusSnapshot; release: () => void} | undefined>(undefined);
  useEffect(() => () => {railRelease.current?.(); heldPage.current?.release();}, []);
  const [remembered, setRemembered] = useState<string>(), [memoryReady, setMemoryReady] = useState(false);
  const lastOpenedLibrary = useRef<string | undefined>(undefined);
  const [accountOpen, setAccountOpen] = useState(false), [railExpanded, setRailExpanded] = useState(false);
  // A mounted page state may dim the rail while its own copy is the only thing to read. The
  // lease is the caller's own object, so a stale release can never clear a successor's lease.
  const [railDim, setRailDim] = useState<Readonly<{retired: boolean}>>();
  const holdRailDim = useCallback((lease: Readonly<{retired: boolean}>) => setRailDim(lease), []);
  const releaseRailDim = useCallback((lease: Readonly<{retired: boolean}>) => setRailDim(current => current === lease ? undefined : current), []);
  const [homeScrolled, setHomeScrolled] = useState(false);
  const focused = registry.capture();
  const homeStart = destination.kind === 'home' && snapshot.homeVisible && !snapshot.homeObscured
    && !snapshot.mediaExpanded && !homeScrolled && !accountOpen && !chromeHidden && snapshot.contentVisible !== false
    && focused?.regionId === ids.spotlight && focused.childId === 'play';
  useTVMenuCapture(theme.isTV && !homeStart);
  const [sidebarExpanded, setSidebarExpanded] = useState(true);
  const sidebarRevision = useRef(0);
  const sidebarLifetime = useRef<object | undefined>(undefined);
  const avatarRef = useRef<View>(null), opening = useRef(0), alive = useRef<{runtime: NativeShellRuntime} | undefined>(undefined);
  const shift = useSharedValue(0), dim = useSharedValue(0), pageOpacity = useSharedValue(1);
  const current = useCallback(() => alive.current?.runtime === runtime && sameAuthority(snapshot.authority, runtime.getSnapshot().authority), [runtime, snapshot.authority]);
  useLayoutEffect(() => {
    if (!theme.isTV) return;
    if (pageHold && !heldPage.current && pageFocus.current) heldPage.current = {opener: pageFocus.current, release: registry.retain(pageFocus.current)};
    if (pageHold || !heldPage.current) return;
    const held = heldPage.current; heldPage.current = undefined; held.release();
    const frame = requestAnimationFrame(() => {
      if (!current()) return;
      const now = runtime.getSnapshot();
      if (now.homeVisible && !now.homeObscured && !now.mediaExpanded) registry.restore(held.opener);
    });
    return () => cancelAnimationFrame(frame);
  }, [current, pageHold, registry, runtime, theme.isTV]);
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
    if (theme.isTV || !wideSidebar) return;
    const lifetime = {}, authority = {...snapshot.authority}, revision = sidebarRevision.current;
    sidebarLifetime.current = lifetime;
    const valid = () => sidebarLifetime.current === lifetime && current() && sameAuthority(authority, runtime.getSnapshot().authority);
    void runtime.memory.readSidebar(authority, valid).then(value => {
      if (valid() && revision === sidebarRevision.current) setSidebarExpanded(value);
    }, error => {if (valid()) runtime.reportError(error);});
    return () => {if (sidebarLifetime.current === lifetime) sidebarLifetime.current = undefined;};
  }, [current, runtime, snapshot.authority, theme.isTV, wideSidebar]);
  const toggleSidebar = () => {
    const lifetime = sidebarLifetime.current, authority = {...snapshot.authority};
    const valid = () => !!lifetime && sidebarLifetime.current === lifetime && current() && sameAuthority(authority, runtime.getSnapshot().authority);
    if (!valid()) return;
    sidebarRevision.current++;
    const value = !sidebarExpanded; setSidebarExpanded(value);
    void runtime.memory.rememberSidebar(authority, value, valid).catch(error => {if (valid()) runtime.reportError(error);});
  };
  useEffect(() => {
    let pending = true;
    void runtime.memory.read(snapshot.authority).then(id => {if (pending && current()) {setRemembered(lastOpenedLibrary.current ?? id); setMemoryReady(true);}}, error => {if (pending && current()) {setMemoryReady(true); runtime.reportError(error);}});
    return () => {pending = false;};
  }, [current, runtime, snapshot.authority]);
  useEffect(() => {
    if (!current() || snapshot.contentVisible === false || destination.kind !== 'library'
      || !canOpenLibrary(snapshot.libraries, destination.libraryId, theme.isTV) || lastOpenedLibrary.current === destination.libraryId) return;
    const id = destination.libraryId;
    lastOpenedLibrary.current = id; opening.current++; setRemembered(id); setMemoryReady(true);
    void runtime.memory.remember(snapshot.authority, id).catch(runtime.reportError);
  }, [current, destination, runtime, snapshot.authority, snapshot.contentVisible, snapshot.libraries, theme.isTV]);
  useEffect(() => {
    const retained = snapshot.destination;
    if (destination.kind === 'library' && !canOpenLibrary(snapshot.libraries, destination.libraryId, theme.isTV)
      || theme.isTV && retained.kind === 'library' && !canOpenLibrary(snapshot.libraries, retained.libraryId, true)) runtime.onDestination({kind: 'libraries'});
    if (destination.kind === 'live' && !snapshot.hasLiveTV) runtime.onDestination({kind: 'home'});
  }, [destination, runtime, snapshot.destination, snapshot.hasLiveTV, snapshot.libraries, theme.isTV]);
  const navigate = (next: ShellDestination) => {
    if (!current()) return;
    setAccountOpen(false); opening.current++;
    runtime.onDestination(next);
    pageOpacity.value = 0;
    pageOpacity.value = withTiming(1, motion.timing('quick'));
  };
  const openLibrary = (id: string) => {
    if (!current() || !canOpenLibrary(snapshot.libraries, id, theme.isTV)) return;
    navigate({kind: 'library', libraryId: id});
  };
  const selectTab = async (tab: ShellTab['id']) => {
    if (!current()) return;
    if (selectedTab(destination) === tab) {runtime.scrollToTop(destination); return;}
    if (tab !== 'libraries') {
      if (tab === 'search') navigate({kind: 'search'}); else navigate({kind: tab});
      return;
    }
    const mine = ++opening.current, from = runtime.getSnapshot().destination;
    const id = memoryReady ? remembered : await runtime.memory.read(snapshot.authority).catch(error => {runtime.reportError(error); return undefined;});
    if (!current() || mine !== opening.current || runtime.getSnapshot().contentVisible === false || !sameDestination(from, runtime.getSnapshot().destination)) return;
    navigate(librariesDestination(id, runtime.getSnapshot().libraries, theme.isTV));
  };
  const expanded = useCallback((value: boolean) => {
    setRailExpanded(value);
    if (value && !railRelease.current && pageFocus.current) railRelease.current = registry.retain(pageFocus.current);
    if (!value) {railRelease.current?.(); railRelease.current = undefined;}
    // tv.html f2 moves the copy's left edge from200 to470. The frame wins the stale220 token.
    shift.value = motion.transforms ? withTiming(value ? 270 : 0, motion.timing('standard')) : value ? 270 : 0;
    dim.value = withTiming(value ? .42 : 0, motion.timing('standard'));
  }, [dim, motion, registry, shift]);
  useEffect(() => {
    if (!theme.isTV) return;
    return runtime.registerTVRailBack?.(() => {
      if (registry.capture()?.regionId !== ids.rail) return false;
      const saved = pageFocus.current;
      expanded(false);
      if (!registry.restore(saved)) registry.focus(ids.start);
      return true;
    });
  }, [runtime, registry, ids, theme.isTV, expanded]);
  useEffect(() => {if (!motion.transforms) shift.value = railExpanded ? 270 : 0;}, [motion.transforms, railExpanded, shift]);
  const pageStyle = useAnimatedStyle(() => ({opacity: pageOpacity.value, transform: [{translateX: shift.value}]}));
  const dimStyle = useAnimatedStyle(() => ({opacity: dim.value}));
  const barHeight = layout.tabs && !chromeHidden ? phoneBarHeight(insets.bottom, landscapePhone) : 0;
  // foldable3e/3f: the phone bar leaves only on medium; the dock floats at the foot.
  const sideNavigation = layout.rail || layout.kind === 'desktop';
  const sideWidth = layout.kind === 'desktop' && sidebarExpanded ? 248 : mediumRailMetrics.width;
  const homeBottom = sideNavigation ? 92 : barHeight, pageBottom = sideNavigation ? 16 : barHeight;
  const railDestination = snapshot.railDestination ?? destination;
  const notifications = snapshot.account.actions.find(action => action.id === 'notifications');
  const content = <>
    <Animated.View style={[{flex: 1}, sideNavigation ? {paddingLeft: sideWidth} : null, pageStyle]}>
      {destination.kind === 'home' ? <HomeScreen runtime={runtime} authority={snapshot.authority} active={!snapshot.mediaExpanded && snapshot.homeVisible} heroObscured={snapshot.homeObscured} railExpanded={railExpanded} bottomInset={homeBottom} onScrolledChange={setHomeScrolled} holdRailDim={holdRailDim} releaseRailDim={releaseRailDim}/>
        : <View style={{flex: 1, paddingBottom: pageBottom}}>
          {runtime.renderDestination(destination, openLibrary)}
        </View>}
    </Animated.View>
    {theme.isTV && <Animated.View pointerEvents="none" style={[{position: 'absolute', inset: 0, backgroundColor: theme.colors.ink, zIndex: theme.layers.navigation - 1}, dimStyle]}/>}
    {!snapshot.selectionActive && snapshot.contentVisible !== false && !chromeHidden && (theme.isTV ? <TVRail authority={snapshot.authority} returnTo={pageFocus.current} libraries={snapshot.libraries} hasLiveTV={snapshot.hasLiveTV} destination={snapshot.railDestination ?? destination} profile={snapshot.profile} unread={snapshot.unreadNotifications} dimmed={destination.kind === 'home' && snapshot.homeVisible && !snapshot.mediaExpanded && !!railDim && !railDim.retired} onNavigate={next => {if (snapshot.contentVisible !== false && sameDestination(next, destination)) {expanded(false); runtime.scrollToTop(destination);} else if (next.kind === 'library') openLibrary(next.libraryId); else navigate(next);}}
      onProfile={() => setAccountOpen(true)} profileRef={avatarRef} onExpandedChange={expanded}/>
      : <>
        {sideNavigation && <MediumRail expanded={layout.kind === 'desktop' && sidebarExpanded} onToggle={layout.kind === 'desktop' ? toggleSidebar : undefined} serverName={snapshot.serverName} libraries={snapshot.libraries} hasLiveTV={snapshot.hasLiveTV} destination={railDestination} profile={snapshot.profile} unread={snapshot.unreadNotifications}
          serverAction={snapshot.account.serverAction && {id: snapshot.account.serverAction.id, label: snapshot.account.serverAction.label, onPress: snapshot.account.serverAction.onPress}}
          notificationAction={notifications && {label: notifications.label, onPress: notifications.onPress}}
          profileRef={avatarRef} short={dimensions.height - insets.top - insets.bottom < 800}
          onNavigate={next => {if (snapshot.contentVisible !== false && sameDestination(next, destination)) runtime.scrollToTop(destination); else if (next.kind === 'library') openLibrary(next.libraryId); else navigate(next);}}
          onProfile={() => setAccountOpen(true)}/>}
        {destination.kind === 'home' && layout.kind === 'phone' && <PhoneHomeHeader profile={snapshot.profile} unread={snapshot.unreadNotifications} avatarRef={avatarRef} onProfile={() => navigate({kind: 'settings'})} viewerRole={snapshot.account.viewerRole} serverAction={snapshot.account.serverAction} castControl={runtime.castControl} scrolled={homeScrolled}/>}
        {layout.tabs && <PhoneTabBar landscape={landscapePhone} destination={destination} hasLiveTV={snapshot.hasLiveTV} onSelect={tab => {void selectTab(tab).catch(runtime.reportError);}}/>}
      </>)}
    {theme.isTV ? <TVProfileMenu snapshot={snapshot} open={accountOpen} onOpenChange={setAccountOpen} returnFocusRef={avatarRef}/>
      : <AccountMenu {...snapshot.account} profile={snapshot.profile} open={accountOpen} onOpenChange={setAccountOpen} anchorRef={avatarRef} returnFocusRef={avatarRef}/>}
  </>;
  return <View testID="native-shell" style={{flex: 1, backgroundColor: theme.colors.ink, overflow: 'hidden'}}>
    {theme.isTV ? <View style={{position: 'absolute', left: layout.left, top: layout.top, width: layout.width, height: layout.height, transformOrigin: 'top left', transform: [{scale: layout.scale}]}}>{content}</View> : content}
    {runtime.playback && <NativePlaybackLayer adapter={runtime.playback} runtime={runtime} authority={snapshot.authority} contentInset={sideWidth}/>}
    {runtime.renderWatch && <View pointerEvents="box-none" style={{position: 'absolute', inset: 0, zIndex: theme.layers.player + 1}}>{runtime.renderWatch()}</View>}
    {runtime.renderRoutes()}
    {runtime.renderSelection()}
    {runtime.renderDownloads?.()}
  </View>;
}
