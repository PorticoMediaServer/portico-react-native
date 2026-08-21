import React, {useCallback, useEffect, useMemo, useState} from 'react';
import {Keyboard, StatusBar, StyleSheet, View} from 'react-native';
import {
  CommonActions,
  NavigationContainer,
  StackActions,
  useIsFocused,
  useNavigationContainerRef,
  type NavigationState,
  type NavigationAction,
  type NavigatorScreenParams,
} from '@react-navigation/native';
import {
  createBottomTabNavigator,
  type BottomTabBarProps,
} from '@react-navigation/bottom-tabs';
import {createStackNavigator} from '@react-navigation/stack';
import {
  porticoNavigationRestoration,
  registerNavigationRestorationViewerFence,
  usePorticoAuth,
  useViewerRuntime,
  useViewerRuntimeSnapshot,
} from '@portico-react-native/infrastructure';
import {
  PORTICO_NAVIGATION_CONTRACT_REVISION,
  porticoDestinationCapabilityRevision,
  porticoProductContractRevision,
  type PorticoDestination,
  type PorticoDestinationCapabilities,
} from '@porticomediaserver/client-core';
import type {
  TVFocusFence,
  TVLogicalFocusContainer,
} from '@portico-react-native/tv-focus';
import {
  PorticoNavigationActionProvider,
  type PorticoNavigatorCommands,
  type PorticoRoute,
  type PrimaryDestination,
  usePorticoNavigationActions,
} from './navigation';
import {HomeScreen} from './screens/HomeScreen';
import {LibraryScreen} from './screens/LibraryScreen';
import {ChannelsScreen} from './screens/ChannelsScreen';
import {SavedScreen} from './screens/SavedDownloadsScreens';
import {PersonScreen, SearchScreen} from './screens/SearchScreen';
import {PlayerScreen} from './player/PlayerScreen';
import {TVSettingsPresenter} from './tv/TVSettingsPresenter';
import {PrototypeOverlay} from './overlays';
import {PorticoEngagementProvider, useEngagement} from './engagement';
import {usePersistentPlayback} from './playbackSession';
import {usePrototypeUi} from './uiState';
import {color} from './tokens';
import {useTVNavigationBack} from './tvNavigationBack';
import {
  clearTVNavigationFocusMemory,
  TVNavigationFocusBoundary,
} from './tvNavigationFocus';
import {createTVPlayerFocusContainers} from './playerFocusTopology';
import {
  PorticoTVTabBar,
  TVNavigationFrameProvider,
  TVNavigationSceneLayout,
  TVRailNavigationProvider,
  useTVNavigationFrameActions,
  useTVNavigationSceneFocus,
} from './tvNavigationFrame';
import {
  tvNavigationFocusScope,
  tvStackNavigatorPolicy,
  tvTabNavigatorPolicy,
  type TVPrimaryRouteName,
  type TVProductRouteName,
} from './tvNavigationPolicy';
import {
  authorizePorticoDestination,
  createPorticoReactNavigationLinking,
  dispatchPorticoDestination,
  porticoNavigationIntents,
  registerNavigationIntentViewerFence,
} from './navigationIntent';
import type {ApplicationRootPhase} from './applicationRootPhase';
import {usePorticoNavigationLifecycle} from './navigationLifecycle';
import {runBoundedNavigationActivation} from './navigationContractActivation';
import {
  porticoRouteForTVScreen,
  tvSecondaryRouteShouldReplace,
  tvTargetForPorticoRoute,
  targetActiveTVSectionAction,
  type TVNavigationState,
} from './tvNavigationState';
import {
  TVNavigationActivationTransactions,
  resolveTVCurrentDestination,
} from './tv/currentDestination';
import {TVAccountHub} from './tv/TVAccountHub';
import {
  createTVDetailFocusContainers,
  TVDetailPresenter,
  TVLiveChannelDetailPresenter,
} from './tv/TVDetailPresenter';
import {NowPlayingFocusContainer} from './playerPresenters';
import {TVLogicalFocusContainerBoundary} from './primitives';
import {
  tvNowPlayingIsEligible,
  tvPlayerHostPresentation,
} from './tv/playerHostPolicy';
import {
  tvBrowseSurfaceFocusContainer,
  tvBrowseSurfaceFocusContainers,
  type TVBrowseFocusSurface,
} from './tv/surfaceFocusTopology';

export {
  activeTVSectionStackKey,
  porticoRouteForTVScreen,
  tvSecondaryRouteShouldReplace,
  tvTargetForPorticoRoute,
  targetActiveTVSectionAction,
} from './tvNavigationState';

export type TVSectionStackParamList = {
  HomeRoot: undefined;
  LibraryRoot: {libraryId?: string; pivot?: string} | undefined;
  ChannelsRoot: {tab?: string} | undefined;
  SavedRoot: {tab?: string} | undefined;
  Search: {query?: string} | undefined;
  Settings: {section?: string} | undefined;
  Person: {personId: string};
  Detail: Extract<PorticoRoute, {name: 'detail'}>;
  Player: Extract<PorticoRoute, {name: 'player'}>;
};

export type TVTabParamList = {
  Home: NavigatorScreenParams<TVSectionStackParamList> | undefined;
  Library: NavigatorScreenParams<TVSectionStackParamList> | undefined;
  Channels: NavigatorScreenParams<TVSectionStackParamList> | undefined;
  Saved: NavigatorScreenParams<TVSectionStackParamList> | undefined;
};

export type TVRootStackParamList = {
  Account: undefined;
  Profile: undefined;
  FailClosed: undefined;
  Product: NavigatorScreenParams<TVTabParamList> | undefined;
};

type TVNavigationRef = {
  canGoBack(): boolean;
  dispatch(action: NavigationAction): void;
  getRootState(): NavigationState;
  goBack(): void;
};

const ProductTabs = createBottomTabNavigator<TVTabParamList>();
const RootStack = createStackNavigator<TVRootStackParamList>();
const SectionStack = createStackNavigator<TVSectionStackParamList>();
const tvLinking = createPorticoReactNavigationLinking<TVRootStackParamList>();

const primaryToTab: Record<
  Exclude<PrimaryDestination, 'downloads'>,
  TVPrimaryRouteName
> = {
  home: 'Home',
  library: 'Library',
  channels: 'Channels',
  saved: 'Saved',
};

const tabToPrimary: Record<
  TVPrimaryRouteName,
  Exclude<PrimaryDestination, 'downloads'>
> = {
  Home: 'home',
  Library: 'library',
  Channels: 'channels',
  Saved: 'saved',
};

const tabToRoot: Record<TVPrimaryRouteName, keyof TVSectionStackParamList> = {
  Home: 'HomeRoot',
  Library: 'LibraryRoot',
  Channels: 'ChannelsRoot',
  Saved: 'SavedRoot',
};

const navigationTheme = {
  dark: true,
  colors: {
    primary: color.screenBlueStrong,
    background: color.projector,
    card: color.projector,
    text: color.silver,
    border: color.line,
    notification: color.record,
  },
  fonts: {
    regular: {fontFamily: 'Manrope-Regular', fontWeight: '400' as const},
    medium: {fontFamily: 'Manrope-Medium', fontWeight: '500' as const},
    bold: {fontFamily: 'Manrope-SemiBold', fontWeight: '600' as const},
    heavy: {fontFamily: 'Manrope-Bold', fontWeight: '700' as const},
  },
};

function dispatchToActiveTVSection(
  navigationRef: TVNavigationRef,
  action: NavigationAction,
): void {
  const targetedAction = targetActiveTVSectionAction(
    navigationRef.getRootState() as TVNavigationState | undefined,
    action,
  );
  if (!targetedAction) return;
  // Stack actions do not travel downward from a tab router. Targeting the
  // active child makes push/replace deterministic and independently testable.
  navigationRef.dispatch(targetedAction);
}

export function TVNavigationApplication({
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
  const auth = usePorticoAuth();
  const navigationRef = useNavigationContainerRef<TVRootStackParamList>();
  const [navigatorReady, setNavigatorReady] = useState(false);
  const [route, setRoute] = useState<PorticoRoute>({name: 'home'});
  const primaryActivations = React.useRef(
    new TVNavigationActivationTransactions<
      Exclude<PrimaryDestination, 'downloads'>
    >(),
  ).current;
  const fence = useMemo<TVFocusFence>(
    () => ({
      accountId: auth.session?.viewerScope.accountId ?? auth.account?.id,
      authorizationGeneration: auth.session?.viewerScope.authorizationRevision,
      contractRevision: 'portico-react-navigation-tv-v1',
      profileId: auth.session?.viewerScope.profileId,
      serverId: auth.session?.viewerScope.serverId ?? auth.selectedServer?.id,
    }),
    [auth.account?.id, auth.selectedServer?.id, auth.session?.viewerScope],
  );
  const focusScope = tvNavigationFocusScope(
    fence,
    routeNameForPorticoRoute(route),
    route as unknown as Readonly<Record<string, unknown>>,
  );

  const syncState = useCallback(() => {
    setRoute(
      resolveTVCurrentDestination(
        navigationRef.getRootState() as TVNavigationState | undefined,
      ).route,
    );
  }, [navigationRef]);
  const syncPhase = useCallback(() => {
    if (!navigationRef.isReady()) return;
    const current = navigationRef.getCurrentRoute()?.name;
    const productRoute =
      current !== undefined &&
      current !== 'Account' &&
      current !== 'Profile' &&
      current !== 'FailClosed';
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
  useEffect(syncPhase, [syncPhase]);
  usePorticoNavigationLifecycle(route, 'television', phase === 'Product');

  const commands = useMemo<PorticoNavigatorCommands>(
    () => ({
      back: () => {
        if (navigationRef.canGoBack()) navigationRef.goBack();
      },
      open: next => {
        const target = tvTargetForPorticoRoute(next);
        if (!target) return;
        if (target.tab) {
          navigationRef.dispatch(
            CommonActions.navigate({
              name: 'Product',
              params: {screen: target.tab, params: target.params},
            }),
          );
          return;
        }
        const current = resolveTVCurrentDestination(
          navigationRef.getRootState() as TVNavigationState | undefined,
        ).route;
        const action = tvSecondaryRouteShouldReplace(current, next)
          ? StackActions.replace(target.name, target.params)
          : StackActions.push(target.name, target.params);
        dispatchToActiveTVSection(navigationRef, action);
      },
      replace: next => {
        const target = tvTargetForPorticoRoute(next);
        if (!target) return;
        if (target.tab) {
          navigationRef.dispatch(
            CommonActions.navigate({
              name: 'Product',
              params: {screen: target.tab, params: target.params},
            }),
          );
          return;
        }
        dispatchToActiveTVSection(
          navigationRef,
          StackActions.replace(target.name, target.params),
        );
      },
      restorePlayer: player =>
        dispatchToActiveTVSection(
          navigationRef,
          StackActions.replace('Player', player),
        ),
      selectPrimary: destination => {
        if (destination === 'downloads') return;
        const source = resolveTVCurrentDestination(
          navigationRef.getRootState() as TVNavigationState | undefined,
        );
        const activation = primaryActivations.begin(
          source,
          destination,
          `primary:${destination}`,
        );
        const committed = primaryActivations.commit(activation, source);
        if (!committed) return;
        const tab = primaryToTab[committed];
        navigationRef.dispatch(
          CommonActions.navigate({
            name: 'Product',
            params: {screen: tab, params: {screen: tabToRoot[tab]}},
          }),
        );
      },
    }),
    [navigationRef, primaryActivations],
  );

  const railNavigation = useMemo(
    () => ({
      openLibrary: () => commands.selectPrimary('library'),
      openSearch: () => commands.open({name: 'search'}),
      openSettings: () => commands.open({name: 'settings'}),
      routeName: routeNameForPorticoRoute(route),
    }),
    [commands, route],
  );

  return (
    <PorticoNavigationActionProvider
      commands={commands}
      playerPersistence="minimize-on-exit"
      route={route}
    >
      <PorticoEngagementProvider platform="tv">
        <View style={styles.root}>
          <StatusBar hidden />
          <TVNavigationIntentBridge
            commands={commands}
            navigatorReady={navigatorReady}
            resetProductNavigation={resetProductNavigation}
          />
          <NavigationContainer
            linking={tvLinking}
            onReady={() => {
              setNavigatorReady(true);
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
            <>
              <RootStack.Navigator
                initialRouteName={phase}
                screenOptions={tvStackNavigatorPolicy.screenOptions}
              >
                <RootStack.Screen name="Account">
                  {() => <>{phaseSurface}</>}
                </RootStack.Screen>
                <RootStack.Screen name="Profile">
                  {() => (
                    <TVNavigationFocusBoundary
                      containers={tvBrowseSurfaceFocusContainers(
                        'profile-selection',
                      )}
                      fence={fence}
                      routeName="ProfileSelection"
                    >
                      {phaseSurface}
                    </TVNavigationFocusBoundary>
                  )}
                </RootStack.Screen>
                <RootStack.Screen name="FailClosed">
                  {() => <>{phaseSurface}</>}
                </RootStack.Screen>
                <RootStack.Screen name="Product">
                  {() => (
                    <TVNavigationFrameProvider activeScope={focusScope}>
                      <TVRailNavigationProvider value={railNavigation}>
                        <TVBackController navigationRef={navigationRef} />
                        <ProductTabs.Navigator
                          backBehavior={tvTabNavigatorPolicy.backBehavior}
                          detachInactiveScreens={
                            tvTabNavigatorPolicy.detachInactiveScreens
                          }
                          initialRouteName={
                            tvTabNavigatorPolicy.initialRouteName
                          }
                          screenOptions={tvTabNavigatorPolicy.screenOptions}
                          tabBar={renderPorticoTVTabBar}
                        >
                          <ProductTabs.Screen name="Home">
                            {() => (
                              <TVSectionNavigator
                                connected={connected}
                                connectionSurface={connectionSurface}
                                primary="Home"
                              />
                            )}
                          </ProductTabs.Screen>
                          <ProductTabs.Screen name="Library">
                            {() => (
                              <TVSectionNavigator
                                connected={connected}
                                connectionSurface={connectionSurface}
                                primary="Library"
                              />
                            )}
                          </ProductTabs.Screen>
                          <ProductTabs.Screen name="Channels">
                            {() => (
                              <TVSectionNavigator
                                connected={connected}
                                connectionSurface={connectionSurface}
                                primary="Channels"
                              />
                            )}
                          </ProductTabs.Screen>
                          <ProductTabs.Screen name="Saved">
                            {() => (
                              <TVSectionNavigator
                                connected={connected}
                                connectionSurface={connectionSurface}
                                primary="Saved"
                              />
                            )}
                          </ProductTabs.Screen>
                        </ProductTabs.Navigator>
                      </TVRailNavigationProvider>
                    </TVNavigationFrameProvider>
                  )}
                </RootStack.Screen>
              </RootStack.Navigator>
              <PersistentTVPlayerHost fence={fence} />
              <TVNowPlayingHost phase={phase} />
            </>
          </NavigationContainer>
        </View>
      </PorticoEngagementProvider>
    </PorticoNavigationActionProvider>
  );
}

/**
 * Publishes external-intent and bounded-restoration authority only for the
 * final server-authenticated account/profile/server authorization revision.
 */
function TVNavigationIntentBridge({
  commands,
  navigatorReady,
  resetProductNavigation,
}: {
  commands: PorticoNavigatorCommands;
  navigatorReady: boolean;
  resetProductNavigation(): void;
}) {
  const auth = usePorticoAuth();
  const engagement = useEngagement();
  const navigation = usePorticoNavigationActions();
  const runtime = useViewerRuntime();
  const runtimeSnapshot = useViewerRuntimeSnapshot();
  const prototypeUi = usePrototypeUi();
  const navigationRef = React.useRef(navigation);
  const notificationRef = React.useRef(engagement.openNotifications);
  navigationRef.current = navigation;
  notificationRef.current = engagement.openNotifications;
  const scope = auth.session?.viewerScope;
  const activeFence = React.useRef('');

  useEffect(() => {
    const unregisterRestoration =
      registerNavigationRestorationViewerFence(runtime);
    const unregisterIntents = registerNavigationIntentViewerFence(runtime);
    const unregisterOverlays = runtime.register(
      'overlays',
      prototypeUi.resetTransientState,
    );
    const unregisterFocus = runtime.register(
      'focus',
      clearTVNavigationFocusMemory,
    );
    const unregisterNavigation = runtime.register(
      'local-state',
      resetProductNavigation,
    );
    return () => {
      unregisterNavigation();
      unregisterFocus();
      unregisterOverlays();
      unregisterIntents();
      unregisterRestoration();
    };
  }, [prototypeUi.resetTransientState, resetProductNavigation, runtime]);

  useEffect(() => {
    if (
      !scope ||
      !navigatorReady ||
      !runtimeSnapshot.foreground ||
      !runtimeSnapshot.online
    ) {
      activeFence.current = '';
      porticoNavigationIntents.suspend();
      return;
    }
    let cancelled = false;
    const activation = new AbortController();
    void runBoundedNavigationActivation(
      async () => {
        const productContract = await auth.session!.client.productContract();
        if (cancelled) return;
        const capabilities = tvNavigationCapabilities(
          productContract.serverCapabilities,
        );
        const fence = {
          ...scope,
          productContractRevision:
            porticoProductContractRevision(productContract),
          routeContractRevision: PORTICO_NAVIGATION_CONTRACT_REVISION,
          platform: 'television' as const,
          capabilityRevision: porticoDestinationCapabilityRevision(
            'television',
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
          platform: 'television',
          capabilities,
          authorize: destination =>
            authorizePorticoDestination(
              auth.session!.client,
              destination,
              'television',
              capabilities,
            ),
          dispatch: destination => {
            if (
              destination.destination === 'media-detail' &&
              destination.mediaKind
            ) {
              commands.open({
                name: 'detail',
                mediaId: destination.mediaId,
                seasonId: destination.seasonId,
                episodeId: destination.episodeId,
                mediaKind: destination.mediaKind,
              });
              return;
            }
            dispatchPorticoDestination(navigationRef.current, destination, {
              openNotifications: () => notificationRef.current(),
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
        if (restored && navigationRef.current.route.name === 'home') {
          dispatchPorticoDestination(navigationRef.current, restored);
        }
      },
      {signal: activation.signal},
    ).catch(() => {
      // Contract/capability unavailability silently disables restoration and
      // external dispatch rather than weakening their authorization fence.
      // A stale request from the previous viewer must never suspend the
      // replacement viewer after its verified fence has activated.
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
    auth.status,
    commands,
    navigatorReady,
    runtimeSnapshot.foreground,
    runtimeSnapshot.generation,
    runtimeSnapshot.online,
    scope,
  ]);

  useEffect(() => {
    if (!activeFence.current) return;
    const destination = tvPrimaryDestinationForRoute(navigation.route);
    if (destination) {
      porticoNavigationRestoration.save(destination).catch(() => undefined);
    }
  }, [navigation.route]);
  return null;
}

function tvNavigationCapabilities(
  features: readonly string[],
): PorticoDestinationCapabilities {
  const enabledFeatures = new Set(features);
  const enabled = (...names: string[]) =>
    names.some(name => enabledFeatures.has(name));
  return {
    downloads: false,
    liveTV: enabled('live-tv', 'liveTV', 'dvr'),
    // tvOS surfaces only urgent notices; it has no general notification sheet.
    notifications: false,
    watchWithFriends: enabled('watch-with-friends', 'watchWithFriends'),
  };
}

function tvPrimaryDestinationForRoute(
  route: PorticoRoute,
):
  | Extract<
      PorticoDestination,
      {destination: 'home' | 'library' | 'channels' | 'saved'}
    >
  | undefined {
  if (route.name === 'home') return {destination: 'home'};
  if (route.name === 'library') {
    return {
      destination: 'library',
      libraryId: route.libraryId,
      pivot: route.pivot,
    };
  }
  if (route.name === 'channels' || route.name === 'saved') {
    return {destination: route.name, tab: route.tab};
  }
  return undefined;
}

function TVBackController({navigationRef}: {navigationRef: TVNavigationRef}) {
  const {
    overlay,
    playerPanel,
    setOverlay,
    setPlayerPanel,
    setTVAccountHubOpen,
    tvAccountHubOpen,
  } = usePrototypeUi();
  const {closeRailAndRestore, railState, requestRailFocus} =
    useTVNavigationFrameActions();
  const closeTransient = useCallback(() => {
    if (tvAccountHubOpen) setTVAccountHubOpen(false);
    else if (overlay) setOverlay(null);
    else if (Keyboard.isVisible()) Keyboard.dismiss();
    else if (playerPanel) setPlayerPanel(null);
  }, [
    overlay,
    playerPanel,
    setOverlay,
    setPlayerPanel,
    setTVAccountHubOpen,
    tvAccountHubOpen,
  ]);
  const canGoBack = useCallback(
    () => navigationRef.canGoBack(),
    [navigationRef],
  );
  const goBack = useCallback(() => navigationRef.goBack(), [navigationRef]);
  const isAtPrimaryRoot = useCallback(
    () =>
      resolveTVCurrentDestination(
        navigationRef.getRootState() as TVNavigationState | undefined,
      ).atPrimaryRoot,
    [navigationRef],
  );
  useTVNavigationBack({
    canGoBack,
    closeRail: closeRailAndRestore,
    closeTransient,
    goBack,
    isAtPrimaryRoot,
    openRail: () => requestRailFocus('back-root'),
    railState,
    transientOpen: Boolean(
      tvAccountHubOpen || overlay || playerPanel || Keyboard.isVisible(),
    ),
  });
  return null;
}

function TVSectionNavigator({
  connected,
  connectionSurface,
  primary,
}: {
  connected: boolean;
  connectionSurface?: React.ReactNode;
  primary: TVPrimaryRouteName;
}) {
  const root = tabToRoot[primary];
  return (
    <SectionStack.Navigator
      detachInactiveScreens={tvStackNavigatorPolicy.detachInactiveScreens}
      initialRouteName={root}
      screenOptions={tvStackNavigatorPolicy.screenOptions}
    >
      <SectionStack.Screen name={root}>
        {({route}) => (
          <TVRouteScene
            connected={connected}
            connectionSurface={connectionSurface}
            route={
              porticoRouteForTVScreen(root, route.params) ?? {
                name: tabToPrimary[primary],
              }
            }
          />
        )}
      </SectionStack.Screen>
      <SectionStack.Screen name="Search">
        {({route}) => (
          <TVRouteScene
            connected={connected}
            connectionSurface={connectionSurface}
            route={{name: 'search', query: route.params?.query}}
          />
        )}
      </SectionStack.Screen>
      <SectionStack.Screen name="Settings">
        {({route}) => (
          <TVRouteScene
            connected={connected}
            connectionSurface={connectionSurface}
            route={{name: 'settings', section: route.params?.section}}
          />
        )}
      </SectionStack.Screen>
      <SectionStack.Screen name="Person">
        {({route}) => (
          <TVRouteScene
            connected={connected}
            connectionSurface={connectionSurface}
            route={{name: 'person', personId: route.params.personId}}
          />
        )}
      </SectionStack.Screen>
      <SectionStack.Screen name="Detail">
        {({route}) => (
          <TVRouteScene
            connected={connected}
            connectionSurface={connectionSurface}
            route={route.params}
          />
        )}
      </SectionStack.Screen>
      <SectionStack.Screen name="Player" options={{animation: 'none'}}>
        {({route}) => (
          <TVRouteScene
            connected={connected}
            connectionSurface={connectionSurface}
            route={route.params}
          />
        )}
      </SectionStack.Screen>
    </SectionStack.Navigator>
  );
}

function TVRouteScene({
  connected,
  connectionSurface,
  route,
}: {
  connected: boolean;
  connectionSurface?: React.ReactNode;
  route: PorticoRoute;
}) {
  const auth = usePorticoAuth();
  const routeName = routeNameForPorticoRoute(route);
  const fence = useMemo<TVFocusFence>(
    () => ({
      accountId: auth.session?.viewerScope.accountId ?? auth.account?.id,
      authorizationGeneration: auth.session?.viewerScope.authorizationRevision,
      contractRevision: 'portico-react-navigation-tv-v1',
      profileId: auth.session?.viewerScope.profileId,
      serverId: auth.session?.viewerScope.serverId ?? auth.selectedServer?.id,
    }),
    [auth.account?.id, auth.selectedServer?.id, auth.session?.viewerScope],
  );
  const params = route as unknown as Readonly<Record<string, unknown>>;
  const scope = tvNavigationFocusScope(fence, routeName, params);
  const focus = useTVNavigationSceneFocus(scope);
  const logicalContainers = useMemo(
    () => tvLogicalContainersForRoute(route),
    [route],
  );
  const fullBleed =
    route.name === 'home' || route.name === 'detail' || route.name === 'player';
  return (
    <TVNavigationFocusBoundary
      fence={fence}
      containers={logicalContainers}
      onContentFocus={focus.onContentFocus}
      onContentMount={focus.onContentMount}
      onContentUnmount={focus.onContentUnmount}
      params={params}
      routeName={routeName}
    >
      <TVNavigationSceneLayout fullBleed={fullBleed}>
        {connected ? (
          <TVBrowseRouteFocusBoundary route={route}>
            <TVRouteSurface route={route} />
          </TVBrowseRouteFocusBoundary>
        ) : (
          <View style={styles.root}>{connectionSurface ?? null}</View>
        )}
      </TVNavigationSceneLayout>
      <TVActiveRouteOverlays />
    </TVNavigationFocusBoundary>
  );
}

function tvLogicalContainersForRoute(
  route: PorticoRoute,
): readonly TVLogicalFocusContainer[] {
  const transient: TVLogicalFocusContainer[] = [
    {id: 'account:main', movement: 'native'},
  ];
  if (route.name === 'detail')
    return [...transient, ...createTVDetailFocusContainers({})];
  if (route.name === 'settings')
    return [
      ...transient,
      {id: 'settings:main', movement: 'native'},
      {id: 'settings:choice', movement: 'native'},
    ];
  if (isTVBrowseFocusSurface(route.name))
    return [...transient, ...tvBrowseSurfaceFocusContainers(route.name)];
  return transient;
}

function isTVBrowseFocusSurface(value: string): value is TVBrowseFocusSurface {
  return (
    value === 'channels' ||
    value === 'home' ||
    value === 'library' ||
    value === 'saved' ||
    value === 'search'
  );
}

function TVBrowseRouteFocusBoundary({
  children,
  route,
}: {
  children: React.ReactNode;
  route: PorticoRoute;
}) {
  return isTVBrowseFocusSurface(route.name) ? (
    <TVLogicalFocusContainerBoundary
      container={tvBrowseSurfaceFocusContainer(route.name)}
    >
      {children}
    </TVLogicalFocusContainerBoundary>
  ) : (
    <>{children}</>
  );
}

function TVActiveRouteOverlays() {
  const focused = useIsFocused();
  return focused ? (
    <>
      <PrototypeOverlay platform="tv" />
      <TVAccountHub />
    </>
  ) : null;
}

function TVRouteSurface({route}: {route: PorticoRoute}) {
  switch (route.name) {
    case 'home':
      return <HomeScreen platform="tv" />;
    case 'library':
      return <LibraryScreen platform="tv" />;
    case 'channels':
      return <ChannelsScreen platform="tv" />;
    case 'saved':
      return <SavedScreen platform="tv" />;
    case 'search':
      return <SearchScreen initialQuery={route.query} platform="tv" />;
    case 'settings':
      return <TVSettingsPresenter initialSection={route.section} />;
    case 'person':
      return <PersonScreen personId={route.personId} platform="tv" />;
    case 'detail':
      return route.mediaKind === 'live-channel' ||
        route.mediaKind === 'live-program' ? (
        <TVLiveChannelDetailPresenter mediaId={route.mediaId} />
      ) : (
        <TVDetailPresenter
          episodeId={route.episodeId}
          mediaId={route.mediaId}
          seasonId={route.seasonId}
        />
      );
    case 'player':
      return <TVPlayerPresentationAnchor />;
    case 'downloads':
      return null;
  }
}

function routeNameForPorticoRoute(route: PorticoRoute): TVProductRouteName {
  switch (route.name) {
    case 'home':
      return 'Home';
    case 'library':
      return 'Library';
    case 'channels':
      return 'Channels';
    case 'saved':
      return 'Saved';
    case 'search':
      return 'Search';
    case 'settings':
      return 'Settings';
    case 'person':
      return 'Person';
    case 'detail':
      return 'Detail';
    case 'player':
      return 'Player';
    case 'downloads':
      return 'Home';
  }
}

const styles = StyleSheet.create({
  backgroundAudioHost: {height: 1, opacity: 0, overflow: 'hidden', width: 1},
  root: {backgroundColor: color.projector, flex: 1},
  persistentPlayer: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: color.projector,
    zIndex: 40,
  },
});

function TVPlayerPresentationAnchor() {
  return (
    <View
      accessibilityElementsHidden
      importantForAccessibility="no-hide-descendants"
      style={styles.root}
    />
  );
}

/**
 * tvOS deliberately exits playback on Back, but the native player still lives
 * above disposable route scenes. The Player route is only a presentation
 * anchor, so nested-stack resets cannot accidentally recreate playback.
 */
function PersistentTVPlayerHost({fence}: {fence: TVFocusFence}) {
  const {persistentPlayer: player, route} = usePorticoNavigationActions();
  const {snapshot} = usePersistentPlayback();
  const {playerPanel} = usePrototypeUi();
  const playerFocusContainers = useMemo(
    () => createTVPlayerFocusContainers(Boolean(playerPanel)),
    [playerPanel],
  );
  const presentation = tvPlayerHostPresentation(route.name, snapshot);
  const fullscreen = presentation === 'fullscreen';
  if (!player || presentation === 'hidden') return null;
  const key = [
    'persistent-tv-player',
    player.mediaId,
    player.live ? 'live' : '',
    player.dvr ? 'dvr' : '',
    player.libraryChannel ? 'library-channel' : '',
    player.watchWithFriendsGroupId,
  ]
    .filter(Boolean)
    .join(':');
  return (
    <TVNavigationFocusBoundary
      containers={playerFocusContainers}
      fence={fence}
      params={player as unknown as Readonly<Record<string, unknown>>}
      routeName="Player"
    >
      <View
        accessibilityElementsHidden={!fullscreen}
        accessibilityLabel={snapshot?.title}
        importantForAccessibility={fullscreen ? 'auto' : 'no-hide-descendants'}
        key={key}
        pointerEvents={fullscreen ? 'auto' : 'none'}
        style={[
          styles.persistentPlayer,
          !fullscreen && styles.backgroundAudioHost,
        ]}
        testID="portico-tv-persistent-player"
      >
        <PlayerScreen
          dvr={player.dvr}
          intentRevision={player.playbackIntentRevision}
          libraryChannel={player.libraryChannel}
          live={player.live}
          mediaId={player.mediaId}
          platform="tv"
          watchWithFriendsGroupId={player.watchWithFriendsGroupId}
        />
      </View>
    </TVNavigationFocusBoundary>
  );
}

function TVNowPlayingHost({phase}: {phase: ApplicationRootPhase}) {
  const navigation = usePorticoNavigationActions();
  const {session, snapshot} = usePersistentPlayback();
  const {tvAccountHubOpen} = usePrototypeUi();
  const visible = tvNowPlayingIsEligible({
    accountHubOpen: tvAccountHubOpen,
    phase,
    routeName: navigation.route.name,
  });
  return (
    <NowPlayingFocusContainer
      onOpen={() => {
        if (!snapshot?.mediaId) return;
        session.handle({presentation: 'fullscreen', type: 'present'});
        navigation.openPlayer(snapshot.mediaId);
      }}
      snapshot={snapshot}
      visible={visible}
    />
  );
}

function renderPorticoTVTabBar(props: BottomTabBarProps) {
  return <PorticoTVTabBar {...props} />;
}
