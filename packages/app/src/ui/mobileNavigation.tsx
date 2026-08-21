import React, {useCallback, useEffect, useMemo, useState} from 'react';
import {
  Keyboard,
  StatusBar,
  StyleSheet,
  View,
} from 'react-native';
import {
  CommonActions,
  NavigationContainer,
  StackActions,
  useNavigationContainerRef,
  type NavigatorScreenParams,
  type NavigationState,
  type PartialState,
} from '@react-navigation/native';
import {
  createBottomTabNavigator,
  type BottomTabBarProps,
} from '@react-navigation/bottom-tabs';
import {
  createNativeStackNavigator,
  type NativeStackScreenProps,
} from '@react-navigation/native-stack';
import {useSafeAreaInsets} from 'react-native-safe-area-context';
import {HomeScreen} from './screens/HomeScreen';
import {LibraryScreen} from './screens/LibraryScreen';
import {ChannelsScreen} from './screens/ChannelsScreen';
import {SavedScreen, DownloadsScreen} from './screens/SavedDownloadsScreens';
import {PersonScreen, SearchScreen} from './screens/SearchScreen';
import {
  DetailScreen,
  LiveChannelDetailScreen,
} from './screens/DetailPlayerScreens';
import {PlayerScreen} from './player/PlayerScreen';
import {SettingsScreen} from './screens/SettingsEntryScreens';
import {PersistentOfflinePlayerScreen} from './downloads';
import {
  PorticoNavigationActionProvider,
  type PorticoNavigatorCommands,
  type PorticoRoute,
  type PrimaryDestination,
  shouldRetainPlayerOnBack,
  usePorticoNavigationActions,
} from './navigation';
import {
  MobileShell,
  MobileChromeScaffold,
  MobilePrimaryBar,
  mobileChromeScope,
  useMobileChromeScroll,
} from './shells';
import {PrototypeOverlay} from './overlays';
import {usePrototypeUi} from './uiState';
import {PorticoEngagementProvider, useEngagement} from './engagement';
import {usePersistentPlayback} from './playbackSession';
import {MobileAudioPresenter} from './playerPresenters';
import {HeaderUtilities} from './sharedComponents';
import {productText} from './productCopy';
import {color, font} from './tokens';
import {
  porticoNavigationRestoration,
  porticoDownloads,
  registerNavigationRestorationViewerFence,
  usePorticoAuth,
  usePorticoViewerPreferences,
  useViewerRuntime,
  useViewerRuntimeSnapshot,
} from '@portico-react-native/infrastructure';
import {
  PORTICO_NAVIGATION_CONTRACT_REVISION,
  porticoDestinationCapabilityRevision,
  porticoProductContractRevision,
  type PorticoDestinationCapabilities,
  type PorticoDestination,
} from '@porticomediaserver/client-core';
import {
  authorizePorticoDestination,
  createPorticoReactNavigationLinking,
  dispatchPorticoDestination,
  porticoNavigationIntents,
  registerNavigationIntentViewerFence,
} from './navigationIntent';
import type {ApplicationRootPhase} from './applicationRootPhase';
import {useMobileNavigationBack} from './mobileNavigationBack';
import {usePorticoNavigationLifecycle} from './navigationLifecycle';
import {runBoundedNavigationActivation} from './navigationContractActivation';

export type MobileTabParamList = {
  Home: undefined;
  Library: {libraryId?: string; pivot?: string} | undefined;
  Channels: {tab?: string} | undefined;
  Saved: {tab?: string} | undefined;
  Downloads: undefined;
};

export type MobileRootStackParamList = {
  Account: undefined;
  Profile: undefined;
  FailClosed: undefined;
  Product: NavigatorScreenParams<MobileTabParamList> | undefined;
  Search: {query?: string} | undefined;
  Settings: {section?: string} | undefined;
  Person: {personId: string};
  Detail: Extract<PorticoRoute, {name: 'detail'}>;
  Player: Extract<PorticoRoute, {name: 'player'}>;
};

export type {ApplicationRootPhase} from './applicationRootPhase';

type MobileNavigationState = NavigationState | PartialState<NavigationState>;
type MobileRouteState = {
  name: string;
  params?: unknown;
  state?: MobileNavigationState;
};

const RootStack = createNativeStackNavigator<MobileRootStackParamList>();
const ProductTabs = createBottomTabNavigator<MobileTabParamList>();
const mobileLinking =
  createPorticoReactNavigationLinking<MobileRootStackParamList>();

const primaryToScreen: Record<PrimaryDestination, keyof MobileTabParamList> = {
  home: 'Home',
  library: 'Library',
  channels: 'Channels',
  saved: 'Saved',
  downloads: 'Downloads',
};

const screenToPrimary: Record<keyof MobileTabParamList, PrimaryDestination> = {
  Home: 'home',
  Library: 'library',
  Channels: 'channels',
  Saved: 'saved',
  Downloads: 'downloads',
};

/** Framework-neutral route conversion kept small enough for deterministic tests. */
export function porticoRouteForMobileScreen(
  name: string,
  params?: unknown,
): PorticoRoute | undefined {
  const values =
    params && typeof params === 'object'
      ? (params as Record<string, unknown>)
      : {};
  if (name === 'Home') return {name: 'home'};
  if (name === 'Library')
    return {
      name: 'library',
      libraryId: optionalString(values.libraryId),
      pivot: optionalString(values.pivot),
    };
  if (name === 'Channels')
    return {name: 'channels', tab: optionalString(values.tab)};
  if (name === 'Saved') return {name: 'saved', tab: optionalString(values.tab)};
  if (name === 'Downloads') return {name: 'downloads'};
  if (name === 'Search')
    return {name: 'search', query: optionalString(values.query)};
  if (name === 'Settings')
    return {name: 'settings', section: optionalString(values.section)};
  if (
    name === 'Person' &&
    params &&
    typeof params === 'object' &&
    'personId' in params
  ) {
    return {
      name: 'person',
      personId: String((params as {personId: unknown}).personId),
    };
  }
  if (name === 'Detail' && params && typeof params === 'object') {
    return params as Extract<PorticoRoute, {name: 'detail'}>;
  }
  if (name === 'Player' && params && typeof params === 'object') {
    return params as Extract<PorticoRoute, {name: 'player'}>;
  }
  return undefined;
}

function optionalString(value: unknown): string | undefined {
  return typeof value === 'string' && value.length > 0 ? value : undefined;
}

/** Returns only the active route; React Navigation remains the sole history owner. */
export function porticoRouteFromMobileState(
  state: MobileNavigationState | undefined,
): PorticoRoute {
  if (!state?.routes.length) return {name: 'home'};
  const routes = state.routes as readonly MobileRouteState[];
  const product = routes.find(route => route.name === 'Product');
  const tabState = product?.state;
  const activeTab = tabState?.routes[tabState.index ?? 0] as
    | MobileRouteState
    | undefined;
  const activeRoot = routes[state.index ?? 0];
  if (activeRoot?.name === 'Product') {
    return (
      porticoRouteForMobileScreen(
        activeTab?.name ?? 'Home',
        activeTab?.params,
      ) ?? {name: 'home'}
    );
  }
  return (
    porticoRouteForMobileScreen(
      activeRoot?.name ?? 'Home',
      activeRoot?.params,
    ) ?? {name: 'home'}
  );
}

export function MobileNavigationApplication({
  connected = true,
  connectionSurface,
  phase = 'Product',
  phaseSurface,
}: {
  connected?: boolean;
  connectionSurface?: React.ReactNode;
  phase?: ApplicationRootPhase;
  phaseSurface?: React.ReactNode;
}) {
  const navigationRef = useNavigationContainerRef<MobileRootStackParamList>();
  const [route, setRoute] = useState<PorticoRoute>({name: 'home'});
  const [navigationReady, setNavigationReady] = useState(false);
  const syncState = useCallback(() => {
    const state = navigationRef.getRootState() as
      | MobileNavigationState
      | undefined;
    setRoute(porticoRouteFromMobileState(state));
  }, [navigationRef]);
  const syncPhase = useCallback(() => {
    if (!navigationRef.isReady()) return;
    const current = navigationRef.getCurrentRoute()?.name;
    const productRoute =
      current === 'Home' ||
      current === 'Library' ||
      current === 'Channels' ||
      current === 'Saved' ||
      current === 'Downloads' ||
      current === 'Search' ||
      current === 'Settings' ||
      current === 'Person' ||
      current === 'Detail' ||
      current === 'Player';
    if ((phase === 'Product' && productRoute) || current === phase) return;
    navigationRef.dispatch(
      CommonActions.reset({index: 0, routes: [{name: phase}]}),
    );
  }, [navigationRef, phase]);
  const resetProductNavigation = useCallback(() => {
    if (!navigationRef.isReady()) return;
    navigationRef.dispatch(
      CommonActions.reset({
        index: 0,
        routes: [{name: 'Product', params: {screen: 'Home'}}],
      }),
    );
    setRoute({name: 'home'});
  }, [navigationRef]);
  const preloadCommonRoutes = useCallback(() => {
    if (!navigationRef.isReady()) return;
    // Search is a safe, commonly used secondary destination. React
    // Navigation can prepare it after the viewer/server contract is verified
    // without adding it to history or changing the visible Portico frame.
    navigationRef.preload('Search', undefined);
  }, [navigationRef]);
  useEffect(syncPhase, [syncPhase]);
  usePorticoNavigationLifecycle(route, 'handheld', phase === 'Product');
  const commands = useMemo<PorticoNavigatorCommands>(
    () => ({
      back: () => navigationRef.canGoBack() && navigationRef.goBack(),
      open: route => {
        const target = mobileTargetForPorticoRoute(route);
        if (target)
          navigationRef.dispatch(StackActions.push(target.name, target.params));
      },
      replace: route => {
        const target = mobileTargetForPorticoRoute(route);
        if (!target) return;
        if (target.name === 'Product') {
          navigationRef.dispatch(
            CommonActions.navigate({name: target.name, params: target.params}),
          );
        } else {
          navigationRef.dispatch(
            StackActions.replace(target.name, target.params),
          );
        }
      },
      restorePlayer: route =>
        navigationRef.dispatch(StackActions.push('Player', route)),
      selectPrimary: destination =>
        navigationRef.dispatch(
          CommonActions.navigate({
            name: 'Product',
            params: {screen: primaryToScreen[destination]},
          }),
        ),
    }),
    [navigationRef],
  );

  return (
    <PorticoNavigationActionProvider commands={commands} route={route}>
      <PorticoEngagementProvider platform="mobile">
        <View style={styles.root}>
          <StatusBar
            backgroundColor="transparent"
            barStyle="light-content"
            translucent
          />
          <MobileShell
            ownsPrimaryNavigation={false}
            showProductChrome={phase === 'Product'}
          >
            <View style={styles.root}>
              <MobileNavigationContinuityBridge
                navigationReady={navigationReady}
                preloadCommonRoutes={preloadCommonRoutes}
                resetProductNavigation={resetProductNavigation}
              />
              <NavigationContainer
                linking={mobileLinking}
                onReady={() => {
                  setNavigationReady(true);
                  syncState();
                  syncPhase();
                }}
                onStateChange={() => {
                  syncState();
                  syncPhase();
                }}
                ref={navigationRef}
                theme={navigationTheme}
              >
                <RootStack.Navigator
                  initialRouteName={phase}
                  screenOptions={{
                    animation: 'default',
                    contentStyle: styles.navigatorContent,
                    gestureEnabled: true,
                    headerShown: false,
                  }}
                >
                  <RootStack.Screen
                    name="Account"
                    options={{animation: 'none', gestureEnabled: false}}
                  >
                    {() => <>{phaseSurface}</>}
                  </RootStack.Screen>
                  <RootStack.Screen
                    name="Profile"
                    options={{animation: 'fade', gestureEnabled: false}}
                  >
                    {() => <>{phaseSurface}</>}
                  </RootStack.Screen>
                  <RootStack.Screen
                    name="FailClosed"
                    options={{animation: 'fade', gestureEnabled: false}}
                  >
                    {() => <>{phaseSurface}</>}
                  </RootStack.Screen>
                  <RootStack.Screen name="Product">
                    {() => (
                      <MobileProductTabs
                        connected={connected}
                        connectionSurface={connectionSurface}
                      />
                    )}
                  </RootStack.Screen>
                  <RootStack.Screen name="Search">
                    {({route}) => (
                      <MobileRoute
                        route={{
                          name: 'search',
                          query: optionalString(route.params?.query),
                        }}
                        connected={connected}
                        connectionSurface={connectionSurface}
                      />
                    )}
                  </RootStack.Screen>
                  <RootStack.Screen name="Settings">
                    {({route}) => (
                      <MobileRoute
                        route={{
                          name: 'settings',
                          section: route.params?.section,
                        }}
                        connected={connected}
                        connectionSurface={connectionSurface}
                      />
                    )}
                  </RootStack.Screen>
                  <RootStack.Screen name="Person">
                    {({route}) => (
                      <MobileRoute
                        route={{
                          name: 'person',
                          personId: route.params.personId,
                        }}
                        connected={connected}
                        connectionSurface={connectionSurface}
                      />
                    )}
                  </RootStack.Screen>
                  <RootStack.Screen name="Detail">
                    {({route}) => (
                      <MobileRoute
                        route={route.params}
                        connected={connected}
                        connectionSurface={connectionSurface}
                      />
                    )}
                  </RootStack.Screen>
                  <RootStack.Screen
                    component={PlayerPresentationAnchor}
                    name="Player"
                    // The player owns horizontal scrub gestures. Ordinary
                    // secondary screens retain native iOS edge-swipe Back.
                    options={{animation: 'fade', gestureEnabled: false}}
                  />
                </RootStack.Navigator>
              </NavigationContainer>
              <MobileBackController />
              <PersistentMobilePlayerHost />
            </View>
          </MobileShell>
          <PrototypeOverlay platform="mobile" />
        </View>
      </PorticoEngagementProvider>
    </PorticoNavigationActionProvider>
  );
}

function MobileBackController() {
  const {overlay, playerPanel, setOverlay, setPlayerPanel} = usePrototypeUi();
  const transientOpen = Boolean(overlay || playerPanel || Keyboard.isVisible());
  const closeTransient = useCallback(() => {
    if (overlay) setOverlay(null);
    else if (Keyboard.isVisible()) Keyboard.dismiss();
    else if (playerPanel) setPlayerPanel(null);
  }, [overlay, playerPanel, setOverlay, setPlayerPanel]);
  useMobileNavigationBack({closeTransient, transientOpen});
  return null;
}

/**
 * External URLs remain pending until the hosted/local auth runtime publishes a
 * verified account/profile/server viewer fence. Notifications intentionally
 * open the existing engagement sheet instead of introducing a fake screen.
 */
function MobileNavigationContinuityBridge({
  navigationReady,
  preloadCommonRoutes,
  resetProductNavigation,
}: {
  navigationReady: boolean;
  preloadCommonRoutes(): void;
  resetProductNavigation(): void;
}) {
  const auth = usePorticoAuth();
  const runtime = useViewerRuntime();
  const runtimeSnapshot = useViewerRuntimeSnapshot();
  const navigation = usePorticoNavigationActions();
  const engagement = useEngagement();
  const prototypeUi = usePrototypeUi();
  const navigationRef = React.useRef(navigation);
  const engagementRef = React.useRef(engagement);
  navigationRef.current = navigation;
  engagementRef.current = engagement;
  const scope = auth.session?.viewerScope;
  const activeFence = React.useRef('');
  const presentedScope = React.useRef('');
  const scopeIdentity = scope
    ? [
        scope.authority,
        scope.accountId,
        scope.serverId,
        scope.profileId,
        scope.authorizationRevision,
      ].join(':')
    : '';

  useEffect(() => {
    if (presentedScope.current === scopeIdentity) return;
    presentedScope.current = scopeIdentity;
    prototypeUi.resetTransientState();
    navigation.closeMinimizedPlayer();
  }, [navigation, prototypeUi, scopeIdentity]);

  useEffect(() => {
    const unregisterRestoration =
      registerNavigationRestorationViewerFence(runtime);
    const unregisterIntents = registerNavigationIntentViewerFence(runtime);
    return () => {
      unregisterIntents();
      unregisterRestoration();
    };
  }, [runtime]);

  useEffect(
    () =>
      runtime.register('overlays', () => {
        // This hook runs inside the staged viewer transition, before the next
        // viewer scope can be published. Never leave the previous viewer's
        // overlays, search/filter state, or player presentation visible while
        // credentials and scoped caches are being replaced.
        prototypeUi.resetTransientState();
        navigationRef.current.closeMinimizedPlayer();
      }),
    [prototypeUi, runtime],
  );

  useEffect(
    () =>
      runtime.register('local-state', () => {
        // Old detail/search/settings history must not survive a profile, account,
        // authorization, or server transition. Dispatch occurs inside the staged
        // runtime fence before the replacement viewer is published.
        resetProductNavigation();
      }),
    [resetProductNavigation, runtime],
  );

  useEffect(() => {
    if (!scope) {
      activeFence.current = '';
      navigationRef.current.closeMinimizedPlayer();
      porticoNavigationIntents.suspend();
      return;
    }
    if (!runtimeSnapshot.foreground || !runtimeSnapshot.online) {
      activeFence.current = '';
      porticoNavigationIntents.suspend();
      return;
    }
    let cancelled = false;
    const activation = new AbortController();
    void runBoundedNavigationActivation(
      async () => {
        const productContract = await auth.session!.client.productContract();
        if (cancelled || !navigationReady) return;
        const capabilities = navigationCapabilities(
          productContract.serverCapabilities,
        );
        const fence = {
          ...scope,
          productContractRevision:
            porticoProductContractRevision(productContract),
          routeContractRevision: PORTICO_NAVIGATION_CONTRACT_REVISION,
          platform: 'handheld' as const,
          capabilityRevision: porticoDestinationCapabilityRevision(
            'handheld',
            capabilities,
          ),
        };
        const identity = JSON.stringify(fence);
        const restored = await porticoNavigationRestoration.activateScope(
          fence,
          {capabilities},
        );
        if (cancelled) return;
        activeFence.current = identity;
        porticoNavigationIntents.activate({
          viewerScope: scope,
          platform: 'handheld',
          capabilities,
          authorize: destination =>
            authorizePorticoDestination(
              auth.session!.client,
              destination,
              'handheld',
              capabilities,
              {
                authorizeOffline: async offline => {
                  if (!offline.localDownloadId) return false;
                  const downloads = await porticoDownloads.list();
                  return downloads.some(
                    download =>
                      download.id === offline.localDownloadId &&
                      download.mediaId === offline.mediaId &&
                      download.state === 'completed' &&
                      Boolean(download.localURL),
                  );
                },
              },
            ),
          dispatch: destination => {
            if (
              destination.destination === 'media-detail' &&
              destination.mediaKind
            ) {
              navigationRef.current.openDetail(
                destination.mediaId,
                destination,
              );
              return;
            }
            dispatchPorticoDestination(navigationRef.current, destination, {
              openNotifications: engagementRef.current.openNotifications,
              openWatchWithFriends: groupId => {
                if (!groupId) return;
                void auth
                  .session!.client.watchWithFriendsGroup(groupId)
                  .then(group => {
                    if (cancelled) return;
                    navigationRef.current.openWatchWithFriendsPlayer(
                      group.mediaId,
                      group.id,
                    );
                  })
                  .catch(() => undefined);
              },
            });
          },
        });
        preloadCommonRoutes();
        if (restored && navigationRef.current.route.name === 'home') {
          dispatchPorticoDestination(navigationRef.current, restored);
        }
      },
      {signal: activation.signal},
    ).catch(() => {
      // Contract/capability unavailability is fail-closed for restoration and
      // external dispatch, never an application loading/error surface.
      // An older scope request may settle after a replacement viewer has
      // already activated. It must not revoke that newer viewer's authority.
      if (!cancelled) porticoNavigationIntents.suspend();
    });
    return () => {
      cancelled = true;
      activation.abort();
      activeFence.current = '';
      porticoNavigationIntents.suspend();
    };
  }, [
    auth.session,
    navigationReady,
    preloadCommonRoutes,
    runtimeSnapshot.foreground,
    runtimeSnapshot.generation,
    runtimeSnapshot.online,
    scope,
  ]);

  useEffect(() => {
    if (!activeFence.current) return;
    const destination = primaryDestinationForRoute(navigation.route);
    if (destination)
      void porticoNavigationRestoration
        .save(destination)
        .catch(() => undefined);
  }, [navigation]);
  return null;
}

function navigationCapabilities(
  features: readonly string[],
): PorticoDestinationCapabilities {
  const enabledFeatures = new Set(features);
  const enabled = (...names: string[]) =>
    names.some(name => enabledFeatures.has(name));
  return {
    downloads: enabled('downloads', 'offline-downloads'),
    liveTV: enabled('live-tv', 'liveTV', 'dvr'),
    notifications: enabled('notifications', 'viewer-notifications'),
    watchWithFriends: enabled('watch-with-friends', 'watchWithFriends'),
  };
}

function primaryDestinationForRoute(
  route: PorticoRoute,
): Extract<PorticoDestination, {destination: PrimaryDestination}> | undefined {
  if (route.name === 'home' || route.name === 'downloads')
    return {destination: route.name};
  if (route.name === 'library')
    return {
      destination: 'library',
      libraryId: route.libraryId,
      pivot: route.pivot,
    };
  if (route.name === 'channels' || route.name === 'saved')
    return {destination: route.name, tab: route.tab};
  return undefined;
}

function mobileTargetForPorticoRoute(
  route: PorticoRoute,
): {name: keyof MobileRootStackParamList; params?: object} | undefined {
  switch (route.name) {
    case 'home':
    case 'library':
    case 'channels':
    case 'saved':
    case 'downloads':
      return {
        name: 'Product',
        params: {
          screen: primaryToScreen[route.name],
          params: primaryParams(route),
        },
      };
    case 'search':
      return {name: 'Search', params: {query: route.query}};
    case 'settings':
      return {name: 'Settings', params: {section: route.section}};
    case 'person':
      return {name: 'Person', params: {personId: route.personId}};
    case 'detail':
      return {name: 'Detail', params: route};
    case 'player':
      return {name: 'Player', params: route};
  }
}

function primaryParams(
  route: Extract<PorticoRoute, {name: PrimaryDestination}>,
): object | undefined {
  if (route.name === 'library')
    return {libraryId: route.libraryId, pivot: route.pivot};
  if (route.name === 'channels' || route.name === 'saved')
    return {tab: route.tab};
  return undefined;
}

function MobileProductTabs({
  connected,
  connectionSurface,
}: {
  connected: boolean;
  connectionSurface?: React.ReactNode;
}) {
  return (
    <ProductTabs.Navigator
      backBehavior="none"
      initialRouteName="Home"
      screenOptions={{
        headerShown: false,
        lazy: true,
        sceneStyle: styles.navigatorContent,
      }}
      tabBar={PorticoMobileTabBar}
    >
      <ProductTabs.Screen name="Home">
        {() => (
          <MobileRoute
            route={{name: 'home'}}
            connected={connected}
            connectionSurface={connectionSurface}
          />
        )}
      </ProductTabs.Screen>
      <ProductTabs.Screen name="Library">
        {({route}) => (
          <MobileRoute
            route={{
              name: 'library',
              libraryId: route.params?.libraryId,
              pivot: route.params?.pivot,
            }}
            connected={connected}
            connectionSurface={connectionSurface}
          />
        )}
      </ProductTabs.Screen>
      <ProductTabs.Screen name="Channels">
        {({route}) => (
          <MobileRoute
            route={{name: 'channels', tab: route.params?.tab}}
            connected={connected}
            connectionSurface={connectionSurface}
          />
        )}
      </ProductTabs.Screen>
      <ProductTabs.Screen name="Saved">
        {({route}) => (
          <MobileRoute
            route={{name: 'saved', tab: route.params?.tab}}
            connected={connected}
            connectionSurface={connectionSurface}
          />
        )}
      </ProductTabs.Screen>
      <ProductTabs.Screen name="Downloads">
        {() => (
          <MobileRoute
            route={{name: 'downloads'}}
            connected={connected}
            connectionSurface={connectionSurface}
          />
        )}
      </ProductTabs.Screen>
    </ProductTabs.Navigator>
  );
}

export function PorticoMobileTabBar({navigation, state}: BottomTabBarProps) {
  const selected =
    screenToPrimary[
      state.routes[state.index]!.name as keyof MobileTabParamList
    ];
  return (
    <MobilePrimaryBar
      selected={selected}
      onSelect={destination => {
        const name = primaryToScreen[destination];
        const route = state.routes.find(candidate => candidate.name === name);
        if (!route) return;
        const event = navigation.emit({
          type: 'tabPress',
          target: route.key,
          canPreventDefault: true,
        });
        if (!event.defaultPrevented) navigation.navigate(name);
      }}
    />
  );
}

function MobileRoute({
  connected,
  connectionSurface,
  route,
}: {
  connected: boolean;
  connectionSurface?: React.ReactNode;
  route: Exclude<PorticoRoute, {name: 'player'}>;
}) {
  const {onScroll, scrollY} = useMobileChromeScroll(
    mobileChromeScope('disconnected', route.name),
  );
  if (connected) return <MobileRouteSurface route={route} />;
  if (route.name === 'downloads') return <DownloadsScreen platform="mobile" />;
  const contents = connectionSurface ?? null;
  if (route.name === 'home') return <View style={styles.root}>{contents}</View>;
  const title =
    route.name === 'library'
      ? 'Library'
      : route.name === 'channels'
        ? 'Channels'
        : route.name === 'saved'
          ? productText('navigation.saved')
          : route.name === 'settings'
            ? productText('settings.title')
            : route.name === 'search'
              ? productText('navigation.search')
              : 'Portico';
  const scrollSurface = React.isValidElement(contents) ? (
    React.cloneElement(contents as React.ReactElement<any>, {
      onScroll,
      scrollEventThrottle: 16,
    })
  ) : (
    <View style={styles.root}>{contents}</View>
  );
  return (
    <MobileChromeScaffold
      header={
        <HeaderUtilities flush platform="mobile" showProfile title={title} />
      }
      scrollY={scrollY}
      testID={`portico-mobile-${route.name}-disconnected-chrome`}
    >
      {scrollSurface}
    </MobileChromeScaffold>
  );
}

function MobileRouteSurface({
  route,
}: {
  route: Exclude<PorticoRoute, {name: 'player'}>;
}) {
  switch (route.name) {
    case 'home':
      return <HomeScreen platform="mobile" />;
    case 'library':
      return <LibraryScreen platform="mobile" />;
    case 'channels':
      return <ChannelsScreen platform="mobile" />;
    case 'saved':
      return <SavedScreen platform="mobile" />;
    case 'downloads':
      return <DownloadsScreen platform="mobile" />;
    case 'search':
      return <SearchScreen initialQuery={route.query} platform="mobile" />;
    case 'person':
      return <PersonScreen personId={route.personId} platform="mobile" />;
    case 'settings':
      return (
        <SettingsScreen initialSection={route.section} platform="mobile" />
      );
    case 'detail':
      return route.mediaKind === 'live-channel' ||
        route.mediaKind === 'live-program' ? (
        <LiveChannelDetailScreen mediaId={route.mediaId} platform="mobile" />
      ) : (
        <DetailScreen
          episodeId={route.episodeId}
          mediaId={route.mediaId}
          platform="mobile"
          seasonId={route.seasonId}
        />
      );
  }
}

function PlayerPresentationAnchor({
  navigation,
  route,
}: NativeStackScreenProps<MobileRootStackParamList, 'Player'>) {
  const {minimizePlayer} = usePorticoNavigationActions();
  React.useEffect(
    () =>
      navigation.addListener('transitionEnd', event => {
        // transitionEnd with closing=false is also emitted for a cancelled edge
        // gesture. Only a completed pop is allowed to change player presentation.
        if (event.data.closing && shouldRetainPlayerOnBack(route.params)) {
          minimizePlayer(route.params);
        }
      }),
    [minimizePlayer, navigation, route.params],
  );
  return (
    <View
      accessibilityElementsHidden
      importantForAccessibility="no-hide-descendants"
      style={styles.playerAnchor}
    />
  );
}

/**
 * The mounted player is a sibling of NavigationContainer, never a native-stack
 * screen. Player routes only select whether this stable instance is full or
 * minimized, so full -> mini -> full cannot recreate the native player.
 */
function PersistentMobilePlayerHost() {
  const {
    minimizedPlayer,
    persistentPlayer: player,
    route,
  } = usePorticoNavigationActions();
  if (!player) return null;
  // Presentation state—not transient navigator state—owns visibility. This
  // keeps the same player visible throughout a completed stack transition.
  const active = !minimizedPlayer;
  const key = [
    'persistent-player',
    player.mediaId,
    player.watchWithFriendsGroupId,
    player.localDownloadId,
  ]
    .filter(Boolean)
    .join(':');
  return (
    <>
      <View
        accessibilityElementsHidden={!active}
        importantForAccessibility={active ? 'auto' : 'no-hide-descendants'}
        pointerEvents={active ? 'auto' : 'none'}
        style={[styles.persistentPlayer, !active && styles.retainedPlayer]}
        testID="portico-mobile-persistent-player"
      >
        <View key={key} style={styles.root}>
          {player.localDownloadId ? (
            <PersistentOfflinePlayerScreen
              downloadId={player.localDownloadId}
            />
          ) : (
            <PlayerScreen
              dvr={player.dvr}
              intentRevision={player.playbackIntentRevision}
              libraryChannel={player.libraryChannel}
              live={player.live}
              mediaId={player.mediaId}
              platform="mobile"
              watchWithFriendsGroupId={player.watchWithFriendsGroupId}
            />
          )}
        </View>
      </View>
      {minimizedPlayer ? (
        <MobileMiniPlayer aboveTabs={isPrimaryRoute(route)} />
      ) : null}
    </>
  );
}

function isPrimaryRoute(route: PorticoRoute): boolean {
  return (
    route.name === 'home' ||
    route.name === 'library' ||
    route.name === 'channels' ||
    route.name === 'saved' ||
    route.name === 'downloads'
  );
}

function MobileMiniPlayer({aboveTabs}: {aboveTabs: boolean}) {
  const {restoreMinimizedPlayer} = usePorticoNavigationActions();
  const {session, snapshot} = usePersistentPlayback();
  const {values: preferences} = usePorticoViewerPreferences();
  const insets = useSafeAreaInsets();
  if (!snapshot?.active) return null;
  const bottom = aboveTabs ? 64 + insets.bottom + 12 : insets.bottom + 12;
  return (
    <MobileAudioPresenter
      artwork={snapshot.artwork}
      bottom={bottom}
      canNext={snapshot.canNext}
      canPrevious={snapshot.canPrevious}
      canSeek={snapshot.canSeek}
      expanded={false}
      isPlaying={snapshot.isPlaying}
      onExpand={restoreMinimizedPlayer}
      onNext={() => session.next()}
      onPlayPause={() => snapshot.isPlaying ? session.pause() : session.play()}
      onPrevious={() => session.previous()}
      onSeekBack={() => session.seekBy(-preferences.seekIntervalSeconds)}
      onSeekForward={() => session.seekBy(preferences.seekIntervalSeconds)}
      subtitle={snapshot.subtitle}
      testID="portico-mobile-mini-player"
      title={snapshot.title}
    />
  );
}

const navigationTheme = {
  dark: true,
  colors: {
    primary: color.screenBlueStrong,
    background: color.projector,
    card: color.projector,
    text: color.silver,
    border: color.line,
    notification: color.screenBlueStrong,
  },
  fonts: {
    regular: {fontFamily: font.regular, fontWeight: '400' as const},
    medium: {fontFamily: font.medium, fontWeight: '500' as const},
    bold: {fontFamily: font.demi, fontWeight: '700' as const},
    heavy: {fontFamily: font.demi, fontWeight: '700' as const},
  },
};

const styles = StyleSheet.create({
  root: {backgroundColor: color.projector, flex: 1},
  navigatorContent: {backgroundColor: color.projector},
  playerAnchor: {backgroundColor: color.projector, flex: 1},
  persistentPlayer: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: color.projector,
    zIndex: 100,
  },
  retainedPlayer: {opacity: 0, pointerEvents: 'none'},
});
