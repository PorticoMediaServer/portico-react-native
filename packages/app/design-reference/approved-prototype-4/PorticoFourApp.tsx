import React, {useEffect} from 'react';
import {BackHandler, Keyboard, StatusBar, StyleSheet, TVFocusGuideView, View} from 'react-native';
import {SafeAreaProvider} from 'react-native-safe-area-context';
import type {ConceptAppProps, PrototypePlatform} from '@portico-prototypes/contract';
import {PrototypeProvider, usePrototype} from '@portico-prototypes/runtime';
import {color} from './tokens';
import {PageTransition, EmptyState} from './primitives';
import {PrototypeUiProvider, usePrototypeUi} from './uiState';
import {PorticoNavigationProvider, usePorticoNavigation, type PorticoRoute, type PrimaryDestination} from './navigation';
import {AppleShell} from './shells';
import {PrototypeOverlay} from './overlays';
import {HomeScreen} from './screens/HomeScreen';
import {LibraryScreen} from './screens/LibraryScreen';
import {ChannelsScreen} from './screens/ChannelsScreen';
import {SavedScreen, DownloadsScreen} from './screens/SavedDownloadsScreens';
import {SearchScreen} from './screens/SearchScreen';
import {DetailScreen, PlayerScreen} from './screens/DetailPlayerScreens';
import {RecoveryGalleryScreen, SettingsScreen, SignInScreen} from './screens/SettingsEntryScreens';

export function PorticoFourApp({initialScenario = 'healthy', platform}: ConceptAppProps) {
  return (
    <SafeAreaProvider>
      <PrototypeProvider initialScenario={initialScenario}>
        <PrototypeUiProvider platform={platform}>
          <PorticoNavigationProvider>
            <PorticoFourRoot platform={platform} />
          </PorticoNavigationProvider>
        </PrototypeUiProvider>
      </PrototypeProvider>
    </SafeAreaProvider>
  );
}

function PorticoFourRoot({platform}: {platform: PrototypePlatform}) {
  const {back, stack} = usePorticoNavigation();
  const {overlay, playerPanel, railExpanded, setOverlay, setPlayerPanel, setRailExpanded} = usePrototypeUi();
  useEffect(() => {
    const subscription = BackHandler.addEventListener('hardwareBackPress', () => {
      if (overlay) {
        setOverlay(null);
        return true;
      }
      if (platform === 'tv' && Keyboard.isVisible()) {
        Keyboard.dismiss();
        return true;
      }
      if (playerPanel) {
        setPlayerPanel(null);
        return true;
      }
      if (stack.length > 1) {
        back();
        return true;
      }
      if (platform === 'tv' && railExpanded) {
        setRailExpanded(false);
        return true;
      }
      return false;
    });
    return () => subscription.remove();
  }, [back, overlay, platform, playerPanel, railExpanded, setOverlay, setPlayerPanel, setRailExpanded, stack.length]);
  return (
    <View style={styles.root}>
      <StatusBar backgroundColor="transparent" barStyle="light-content" hidden={platform === 'tv'} translucent />
      <AppleShell platform={platform}>
        <PersistentRouteHost platform={platform} />
      </AppleShell>
      <PrototypeOverlay platform={platform} />
    </View>
  );
}

const primaryDestinations: PrimaryDestination[] = ['home', 'library', 'channels', 'saved', 'downloads'];

function PersistentRouteHost({platform}: {platform: PrototypePlatform}) {
  const {stack} = usePorticoNavigation();
  const activeRoute = stack[stack.length - 1] ?? {name: 'home'};
  const rootRoute = stack[0] ?? {name: 'home'};
  const destinations = platform === 'tv' ? primaryDestinations.filter(name => name !== 'downloads') : primaryDestinations;
  return (
    <View style={styles.routeHost}>
      {destinations.map(name => {
        const route: PorticoRoute = {name};
        const active = stack.length === 1 && rootRoute.name === name;
        return <PersistentRouteLayer active={active} key={`primary-${name}`} platform={platform} route={route} />;
      })}
      {stack.slice(1).map((route, index) => {
        const active = route === activeRoute;
        const mediaKey = 'mediaId' in route ? `-${route.mediaId}` : '';
        return <PersistentRouteLayer active={active} key={`pushed-${index}-${route.name}${mediaKey}`} platform={platform} route={route} />;
      })}
    </View>
  );
}

function PersistentRouteLayer({active, platform, route}: {active: boolean; platform: PrototypePlatform; route: PorticoRoute}) {
  const mediaKey = 'mediaId' in route ? `-${route.mediaId}` : '';
  const contents = (
    <PageTransition transitionKey={`${route.name}${mediaKey}-${active ? 'active' : 'hidden'}`}>
      <GlobalStateGate platform={platform}>
        <RouteSurface platform={platform} route={route} />
      </GlobalStateGate>
    </PageTransition>
  );
  const sharedProps = {
    accessibilityElementsHidden: !active,
    importantForAccessibility: active ? 'auto' as const : 'no-hide-descendants' as const,
    pointerEvents: active ? 'auto' as const : 'none' as const,
    style: [styles.routeLayer, !active && styles.routeLayerHidden],
    testID: `portico-route-${route.name}`,
  };
  return platform === 'tv' ? (
    <View {...sharedProps}>
      <TVFocusGuideView autoFocus style={styles.routeLayer}>{contents}</TVFocusGuideView>
    </View>
  ) : (
    <View {...sharedProps}>{contents}</View>
  );
}

function RouteSurface({platform, route}: {platform: PrototypePlatform; route: PorticoRoute}) {
  switch (route.name) {
    case 'home': return <HomeScreen platform={platform} />;
    case 'library': return <LibraryScreen platform={platform} />;
    case 'channels': return <ChannelsScreen platform={platform} />;
    case 'saved': return <SavedScreen platform={platform} />;
    case 'downloads': return <DownloadsScreen platform={platform} />;
    case 'search': return <SearchScreen platform={platform} />;
    case 'settings': return <SettingsScreen platform={platform} />;
    case 'sign-in': return <SignInScreen platform={platform} />;
    case 'recovery-gallery': return <RecoveryGalleryScreen platform={platform} />;
    case 'detail': return <DetailScreen mediaId={route.mediaId} platform={platform} />;
    case 'player': return <PlayerScreen mediaId={route.mediaId} platform={platform} />;
    default: return null;
  }
}

function GlobalStateGate({children, platform}: {children: React.ReactNode; platform: PrototypePlatform}) {
  const {state} = usePrototype();
  const {setOverlay} = usePrototypeUi();
  if (state.scenario === 'session-expired') {
    return <EmptyState actionLabel="Sign in again" message="Your place is saved. Sign in again to continue from this screen." onAction={() => setOverlay('profile')} platform={platform} title="Session expired" />;
  }
  if (state.scenario === 'permission-denied') {
    return <EmptyState actionLabel="Switch profile" message="This profile cannot access the selected library or media. Nothing has been changed." onAction={() => setOverlay('profile')} platform={platform} title="Access not available" />;
  }
  if (state.scenario === 'server-unreachable') {
    return <EmptyState actionLabel="Choose server" message={platform === 'tv' ? 'Portico cannot establish a verified direct connection to this server. Your account remains available.' : 'Portico cannot establish a verified direct connection to this server. Your account and cached downloads remain available.'} onAction={() => setOverlay('profile')} platform={platform} title="Server unavailable" />;
  }
  return <>{children}</>;
}

const styles = StyleSheet.create({
  root: {backgroundColor: color.projector, flex: 1},
  routeHost: {flex: 1},
  routeLayer: {flex: 1},
  routeLayerHidden: {display: 'none'},
});
