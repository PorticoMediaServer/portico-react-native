import React, {useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore} from 'react';
import {BackHandler, TVEventControl, View} from 'react-native';
import {isTablet} from '../bridge/device-platform';
import {CommonActions, DarkTheme, StackActions, TabActions, NavigationContainer, type NavigationContainerRef, type NavigationState} from '@react-navigation/native';
import Animated, {useAnimatedStyle, useSharedValue} from 'react-native-reanimated';
import {createNativeStackNavigator} from '@react-navigation/native-stack';
import {useLibraryMemory} from '../app/library-memory';
import {useLibraries} from '../app/libraries';
import {onPinsChanged, usePinnedResources} from '../app/pins';
import {viewerScope} from '../app/content';
import {viewerKey} from '../app/viewer-scope';
import {useScanningLibraries} from '../app/library-scan';
import {LibrariesContext} from '../app/libraries-context';
import type {ContentStackParams} from '../app/routes';
import {hasRealOrigin, useSession} from '../app/session';
import {Gallery} from '../screens/Gallery';
import {HomeScreen} from '../screens/Home';
import {LibraryScreen} from '../screens/Library';
import {ChannelsScreen} from '../screens/channels/ChannelsScreen';
import {ChannelReminderHost} from '../screens/channels/Reminders';
import {useHasChannels} from '../app/channels';
import {SavedScreen} from '../screens/Saved';
import {PlaylistScreen, SavedResourceScreen} from '../screens/title/SavedPages';
import {HomeRowScreen} from '../screens/HomeRow';
import {SearchScreen} from '../screens/Search';
import {PersonScreen} from '../screens/Person';
import {DetailScreen} from '../screens/Detail';
import {EntityScreen} from '../screens/Entity';
import {ShowScreen} from '../screens/Show';
import {AboutScreen, AccountScreen, SettingsPageScreen, SettingsScreen} from '../screens/Settings';
import {LicenceScreen, LicencesScreen} from '../screens/Licences';
import {ServersScreen} from '../screens/SettingsPages';
import {NotificationsScreen} from '../screens/Notifications';
import {DownloadsScreen} from '../screens/Downloads';
import {TogetherScreen} from '../screens/Together';
import {InboxProvider} from '../app/inbox';
import {DownloadsProvider} from '../app/downloads';
import {DeviceApprovalCover} from '../app/device';
import {offlineDownloads} from '../bridge/offline-downloads';
import {DownloadsGate} from './DownloadsGate';
import {linkIntents} from './link-intents';
import {LinkFence, alreadyShowing, linkViewerKey} from './pending-link';
import {routeForEntry, routeForLinkedTitle} from '../app/open';
import type {ContentEntry} from '../../../../packages/client-core/src/library-content';
import {AppearanceProvider, Atmosphere, cardScaleFor, showToast, useTheme} from '../ui';
import {BottomBar, type TabKey} from './BottomBar';
import {Rail, railLibraryIcon, type RailKey} from './Rail';
import {PlayerHost} from '../player/PlayerHost';
import type {PlayerActions} from '../app/player-actions';
import {usePlayerVisible} from '../app/player-actions';
import {ServerPreferencesProvider, useServerPreferences} from '../app/server-preferences';
import {usePreferences} from '../app/preferences';
import {ConnectionStatusStore} from '../app/connection-status';
import {ConnectionStatusProvider} from '../app/connection-context';
import {CustodyPrompt} from './CustodyPrompt';
import {guarded} from './ScreenBoundary';
import {AwayNotice} from './AwayNotice';
import {CertificateNotice} from './CertificateNotice';
import {FreshnessRuntime, useFreshness, useInputPulse} from '../app/freshness';
import {dependsOn} from '../../../../packages/client-core/src/freshness-hub';
import {MetadataEditorProvider} from '../app/metadata-editor';
import {MetadataEditorSheet} from '../screens/MetadataEditor';
import {beginArtworkScreen} from '../ui/ArtworkPipeline';
import {topShelfChanged} from '../app/top-shelf';
import {useOffline} from '../app/downloads';
import {InvitationScreen} from '../screens/Invitation';
import {holdJoinLink, isLegacyInvite, releaseJoinLink} from '../app/join-link';
import {RecordingsScreen} from '../screens/Recordings';
import {CastProvider} from '../app/cast';
import {PlayOnProvider} from '../app/play-on';
import {PlayOnBar} from './PlayOnBar';
import {createRootsNavigator} from './Roots';
import {activeI18n} from '../app/errors';
import {announceFinishedDownloads} from '../app/download-toasts';

const Stack = createNativeStackNavigator<ContentStackParams>();

/**
 * Rail focus and stack depth decide only whether the television Menu key may
 * leave the app. They change on every focus move, so they live in this tiny
 * store rather than in Shell state, which would re-render every screen.
 */
class ExitGate {
  private value = {depth: 1, railFocused: false};
  private listeners = new Set<() => void>();
  get = () => this.value;
  patch = (next: Partial<{depth: number; railFocused: boolean}>) => {
    const merged = {...this.value, ...next};
    if (merged.depth === this.value.depth && merged.railFocused === this.value.railFocused) return;
    this.value = merged;
    for (const listener of this.listeners) listener();
  };
  subscribe = (listener: () => void) => {
    this.listeners.add(listener);
    return () => { this.listeners.delete(listener); };
  };
}

function TVMenuGate({gate}: {gate: ExitGate}) {
  const {depth, railFocused} = useSyncExternalStore(gate.subscribe, gate.get);
  return <TVMenuKey allowExit={depth <= 1 && railFocused} />;
}

// Each destination renders inside its own boundary so one screen's failure
// never takes the tab bar, rail or stack with it.
const screens = {
  Home: guarded(HomeScreen), HomeRow: guarded(HomeRowScreen), Library: guarded(LibraryScreen), Entity: guarded(EntityScreen), Detail: guarded(DetailScreen), Show: guarded(ShowScreen), Search: guarded(SearchScreen), Person: guarded(PersonScreen), Saved: guarded(SavedScreen), Channels: guarded(ChannelsScreen), Settings: guarded(SettingsScreen), SettingsPage: guarded(SettingsPageScreen), Account: guarded(AccountScreen), Servers: guarded(ServersScreen), About: guarded(AboutScreen), Licences: guarded(LicencesScreen), Licence: guarded(LicenceScreen), Notifications: guarded(NotificationsScreen), Downloads: guarded(DownloadsScreen), Together: guarded(TogetherScreen), Playlist: guarded(PlaylistScreen), SavedResource: guarded(SavedResourceScreen), Gallery: guarded(Gallery), Invitation: guarded(InvitationScreen), Recordings: guarded(RecordingsScreen),
} as const;

/*
 * APL-SHELL-08: each destination the rail or tab bar offers is a kept-alive root with its own
 * stack (`Roots`), so returning to one shows it exactly as it was left. Every stack can show every
 * page; they differ only in where they start.
 */
type RootName = 'HomeRoot' | 'LibraryRoot' | 'SavedRoot' | 'ChannelsRoot' | 'DownloadsRoot' | 'SearchRoot' | 'SettingsRoot';
const rootFor: Record<Exclude<RailKey, `library:${string}` | `pin:${string}`>, RootName> = {Home: 'HomeRoot', Saved: 'SavedRoot', Channels: 'ChannelsRoot', Downloads: 'DownloadsRoot', Search: 'SearchRoot', Settings: 'SettingsRoot'};
const firstScreen: Record<RootName, keyof ContentStackParams> = {HomeRoot: 'Home', LibraryRoot: 'Library', SavedRoot: 'Saved', ChannelsRoot: 'Channels', DownloadsRoot: 'Downloads', SearchRoot: 'Search', SettingsRoot: 'Settings'};
const Roots = createRootsNavigator();
const contentScreens = (Object.keys(screens) as (keyof typeof screens)[]).map(name => <Stack.Screen key={name} name={name} component={screens[name] as React.ComponentType} />);
function useStackOptions() {
  const {isTV, motion} = useTheme();
  return useMemo(() => ({headerShown: false, freezeOnBlur: true, contentStyle: {backgroundColor: 'transparent'}, animation: (motion.reduce ? 'none' : isTV ? 'fade' : 'default') as 'none' | 'fade' | 'default', animationDuration: motion.standard, gestureEnabled: !isTV, fullScreenGestureEnabled: !isTV}), [motion.reduce, motion.standard, isTV]);
}
const stackStartingAt = (first: keyof ContentStackParams) => function RootStack() {
  const options = useStackOptions();
  return <Stack.Navigator initialRouteName={first} screenOptions={options}>{contentScreens}</Stack.Navigator>;
};
const rootStacks = {} as Record<RootName, React.ComponentType>;
for (const name of Object.keys(firstScreen) as RootName[]) rootStacks[name] = stackStartingAt(firstScreen[name]);
const rootScreens = (Object.keys(firstScreen) as RootName[]).map(name => <Roots.Screen key={name} name={name} component={rootStacks[name]} />);

/**
 * The authenticated frame: atmosphere, the persistent rail, and the content
 * roots. Each destination keeps its own stack, so Back always walks within a
 * section, like a media app rather than a browser.
 */
export function Shell() {
  const session = useSession();
  const {colors, isTV, window, metrics} = useTheme();
  // IOS-SHELL-02: an iPhone keeps its tab bar in landscape; only an iPad (wide) uses the rail.
  const handheld = !isTV && (!isTablet || window.width < 700);
  // Channels (Live TV, Library Channels, Recordings) is offered once the server has a source.
  const hasChannels = useHasChannels();
  const offline = useOffline();
  const [lastLibrary, setLastLibrary] = useState<string>();
  // Keyed on who is signed in, not on the access token: a renewed sign-in does not read the list again.
  const libraries = useLibraries(session.api, viewerKey(session.session, session.api) || undefined);
  // Read this profile's remembered library choices now, so a library opens on them without a wait.
  useLibraryMemory();
  // ONB-04: a dot on each rail entry whose library is scanning (viewer-safe status, polled).
  const serverId = useMemo(() => viewerScope(session.session, session.api).serverId, [session.session, session.api]);
  const libraryIds = useMemo(() => libraries.items.map(l => l.id), [libraries.items]);
  const scanning = useScanningLibraries(session.api, serverId, libraryIds);
  // Pinned collections, saved views and playlists sit in the rail; a pin changed anywhere reorders the libraries too.
  const pins = usePinnedResources(session.api, serverId, viewerKey(session.session, session.api) || undefined);
  const reloadForPins = libraries.reload;
  useEffect(() => { if (pins.ready) reloadForPins(); }, [pins.revision, pins.ready, reloadForPins]);
  useEffect(() => onPinsChanged(reloadForPins), [reloadForPins]);
  const navigator = useRef<NavigationContainerRef<ContentStackParams>>(null);
  // MU1: the shell's failure mode for a server it can't use (web parity). One store, fed from
  // the remembered server and the route's own subscription; guarded screens swap their content
  // for the centered status while it shows. No polling is added.
  const connectionStore = useMemo(() => new ConnectionStatusStore(), []);
  useEffect(() => () => connectionStore.dispose(), [connectionStore]);
  const retryConnection = useCallback(() => {
    if (session.saved) session.saved.retry();
    // Outside the account's hours the server is reachable; it is the renewal that is asked for again.
    else if (session.outsideHours) session.outsideHours.retry();
    else void session.api.recoverRoute().catch(() => {});
  }, [session.saved, session.outsideHours, session.api]);
  const useAnotherServer = useCallback(() => {
    if (session.saved) session.saved.useAnother();
    else navigator.current?.dispatch(StackActions.push('Servers'));
  }, [session.saved]);
  const [selected, setSelected] = useState<RailKey>('Home');
  const pinsRef = useRef(pins.order);
  pinsRef.current = pins.order;
  const rail = useRef<{focus: () => void; isFocused: () => boolean}>(null);
  const gate = useRef(new ExitGate()).current;
  const railExpansion = useSharedValue(0);
  const push = metrics.railWidthExpanded - metrics.railWidth;
  const pushed = useAnimatedStyle(() => ({transform: [{translateX: railExpansion.value * push}]}));
  const onRailFocusChange = useCallback((focused: boolean) => gate.patch({railFocused: focused}), [gate]);
  // Television Menu / Android back: pop the stack; at a section root move focus
  // to the rail; only when the rail itself is focused does Menu leave the app.
  useEffect(() => {
    const sub = BackHandler.addEventListener('hardwareBackPress', () => {
      const nav = navigator.current;
      if (nav?.canGoBack()) {
        nav.goBack();
        return true;
      }
      if (isTV && rail.current && !rail.current.isFocused()) {
        rail.current.focus();
        return true;
      }
      return false;
    });
    return () => sub.remove();
  }, [isTV]);
  // APL-SHELL-08: choosing a destination shows it as it was left; choosing the one already showing
  // goes back to its top; choosing another library shows that library in the Library root.
  const select = useCallback(
    (key: RailKey) => {
      const nav = navigator.current;
      if (key.startsWith('pin:')) {
        // A pinned collection, saved view or playlist opens in Saved, on top of what Saved showed.
        const [, kind, ...rest] = key.split(':');
        const id = rest.join(':');
        const entry = pinsRef.current.find(p => p.kind === kind && p.id === id);
        setSelected('Saved');
        if (!nav || !id) return;
        nav.dispatch(CommonActions.navigate({name: 'SavedRoot', params: kind === 'playlist' ? {screen: 'Playlist', params: {playlistId: id, title: entry?.name}, initial: false} : {screen: 'SavedResource', params: {resourceId: id, title: entry?.name}, initial: false}}));
        return;
      }
      setSelected(key);
      if (!nav) return;
      const libraryId = key.startsWith('library:') ? key.slice('library:'.length) : undefined;
      const target: RootName = libraryId ? 'LibraryRoot' : rootFor[key as Exclude<RailKey, `library:${string}` | `pin:${string}`>];
      const roots = nav.getRootState() as NavigationState | undefined;
      const shown = roots?.routes[roots.index];
      const stack = roots?.routes.find(r => r.name === target)?.state as NavigationState | undefined;
      if (libraryId && (stack?.routes[0]?.params as {libraryId?: string} | undefined)?.libraryId !== libraryId) {
        nav.dispatch(CommonActions.navigate({name: target, params: {screen: 'Library', params: {libraryId}, pop: true}}));
        return;
      }
      if (shown?.name === target) {
        if ((stack?.routes.length ?? 1) > 1) nav.dispatch(StackActions.popToTop());
        return;
      }
      nav.dispatch(TabActions.jumpTo(target));
    },
    [],
  );
  const tab: TabKey = selected === 'Home' ? 'Home' : selected === 'Downloads' ? 'Downloads' : selected === 'Saved' ? 'Saved' : selected === 'Channels' ? 'Channels' : 'Library';
  const currentLibrary = selected.startsWith('library:') ? libraries.items.find(l => l.id === selected.slice('library:'.length)) : undefined;
  // The Library tab opens the library the viewer used last (or the first one);
  // switching libraries happens from the library's own title dropdown.
  const selectTab = useCallback(
    (key: TabKey) => {
      if (key !== 'Library') {
        select(key);
        return;
      }
      const target = lastLibrary && libraries.items.some(l => l.id === lastLibrary) ? lastLibrary : libraries.items[0]?.id;
      if (target) select(`library:${target}`);
    },
    [select, libraries.items, lastLibrary],
  );
  const theme = useMemo(() => ({...DarkTheme, colors: {...DarkTheme.colors, background: 'transparent', card: 'transparent', primary: colors.accent, text: colors.text, border: colors.line}}), [colors]);
  const onStateChange = useCallback((state: Parameters<NonNullable<React.ComponentProps<typeof NavigationContainer>['onStateChange']>>[0]) => {
    const shown = state?.routes[state.index];
    if (!shown) return;
    // PERF-03: each screen's artwork is timed and ordered from here.
    const top = navigator.current?.getCurrentRoute();
    if (top) beginArtworkScreen(top.name);
    const stack = shown.state as NavigationState | undefined;
    gate.patch({depth: stack?.routes.length ?? 1});
    const first = stack?.routes[0];
    const name = first?.name ?? firstScreen[shown.name as RootName];
    if (name === 'Library') {
      const libraryId = ((first?.params ?? (shown.params as {params?: object} | undefined)?.params) as {libraryId?: string} | undefined)?.libraryId;
      if (libraryId) { setSelected(`library:${libraryId}`); setLastLibrary(libraryId); }
    } else if (name) setSelected(name as RailKey);
  }, [gate]);
  // The navigator subtree is identity-stable across shell renders (rail focus,
  // library list, tab selection), so a shell render never re-renders the
  // mounted screens.
  const navigatorTree = useMemo(() => (
    <NavigationContainer
      ref={navigator}
      theme={theme}
      onStateChange={onStateChange}>
      <Roots.Navigator initialRouteName="HomeRoot">
        {rootScreens}
      </Roots.Navigator>
    </NavigationContainer>
  ), [theme, onStateChange]);
  const openEntry = useCallback((entry: ContentEntry) => {
    const route = routeForEntry(entry);
    if (route) navigator.current?.dispatch(StackActions.push(route.name, route.params));
  }, []);
  // App links (Spec — Link Contract): the universal links arrive as portico:// URLs.
  //   portico://item/<id>, portico://play/<id>     a title (Top Shelf, Handoff)
  //   portico://device                             approve a TV sign-in ("Link a TV")
  //   portico://account                            the Portico Account page
  //   portico://together/join/<code>               Watch Together invite
  //   portico://invite#invite=<t>                  server or account invitation
  // Secrets ride in the fragment and are never logged.
  const playerIntents = useRef<PlayerActions | null>(null);
  const linked = useRef<(url: string | null) => void>(() => {});
  // A link's lookups answer later. What they do then is fenced: only for the viewer the link was
  // opened for, in this shell, and only while no newer link has been opened.
  const linkFence = useRef<LinkFence | null>(null);
  linkFence.current ??= new LinkFence();
  linked.current = url => {
    if (!url || !hasRealOrigin(session.api)) return;
    const nav = navigator.current;
    const current = linkFence.current!.begin();
    // A link to the page already on top changes nothing: the same link twice is one request.
    const push = (name: string, params?: object) => { if (nav && !alreadyShowing(nav.getCurrentRoute(), name, params)) nav.dispatch(StackActions.push(name, params)); };
    const title = /^portico:\/\/(item|play)\/([A-Za-z0-9_-]{1,128})$/.exec(url);
    if (title) {
      const [, action, itemId] = title;
      // APL-SHELL-03: say why nothing opened, and let the Top Shelf catch up.
      const refused = () => { if (!current()) return; showToast({message: activeI18n().t('shell.titleNotOnProfile'), icon: 'warning'}); topShelfChanged(); };
      if (action === 'play') void session.api.item(itemId).then(item => { if (current()) playerIntents.current?.play(itemId, item.progressSeconds ?? 0); }, refused);
      // B16: a link may name a show, album, book or artist as well as a playable title.
      else void routeForLinkedTitle(session.api, itemId).then(route => { if (!current()) return; if (route) push(route.name, route.params); else refused(); }, refused);
      return;
    }
    if (/^portico:\/\/device\/?(?:[?#].*)?$/.test(url)) {
      if (!isTV) push('Settings', {linkTV: true});
      return;
    }
    // The Account page has no tabs (Hosted profiles and invitations are gone), so any old
    // `?tab=` is ignored.
    if (/^portico:\/\/account\/?(?:[?#].*)?$/.test(url)) {
      push('Account');
      return;
    }
    const together = /^portico:\/\/together\/join\/([A-Za-z0-9-]{4,16})\/?$/.exec(url);
    if (together) {
      push('Together', {code: together[1].replace(/-/g, '')});
      return;
    }
    // A server's invitation (Spec — Hosted at Scale); an old account invitation opens the same
    // screen, which says to ask for a new one.
    if (holdJoinLink(url) || isLegacyInvite(url)) {
      if (isLegacyInvite(url)) releaseJoinLink();
      push('Invitation');
    }
  };
  // Links arrive through their one owner (link-intents), which holds a link until this shell can
  // open it: its server confirmed, for the viewer the link arrived under, once. Opening waits a
  // tick so the navigator this shell has just mounted is ready for the route.
  const linkViewer = hasRealOrigin(session.api) ? linkViewerKey(session.session?.viewer) : null;
  useEffect(() => {
    const fence = linkFence.current!;
    fence.setViewer(linkViewer);
    if (!linkViewer) return;
    let live = true;
    // The link stays the owner's until this shell acts on it: a shell replaced within that tick
    // leaves it for the next one instead of losing it.
    const detach = linkIntents.attach(linkViewer, (url, taken) => { setTimeout(() => { if (live && taken()) linked.current(url); }, 0); });
    return () => { live = false; detach(); fence.setViewer(null); };
  }, [linkViewer]);
  const viewTogether = useCallback(() => navigator.current?.dispatch(StackActions.push('Together')), []);
  const viewDownloads = useCallback(() => navigator.current?.dispatch(StackActions.push('Downloads')), []);
  const pulse = useInputPulse();
  // A library added, removed or renamed anywhere reaches the rail and the tab bar by itself: the
  // list is read again behind the one on screen.
  const {hub: freshnessHub} = useFreshness();
  const reloadLibraries = libraries.reload;
  useEffect(() => freshnessHub.watch([dependsOn.libraries], reloadLibraries), [freshnessHub, reloadLibraries]);
  // Library pins changed on another device arrive with this profile's personal changes.
  useEffect(() => freshnessHub.watch([dependsOn.personal()], reloadLibraries), [freshnessHub, reloadLibraries]);
  // What is on the device is read at launch, so it is there to offer if the server is not.
  useEffect(() => { void offlineDownloads.open(); announceFinishedDownloads(); }, []);
  useEffect(() => beginArtworkScreen('Home'), []);
  const profileName = session.hosted?.profiles.find(p => p.id === session.session?.viewer.profileId)?.name ?? session.hosted?.account.displayName;
  return (
    <LibrariesContext.Provider value={libraries}>
    <ServerPreferencesProvider deviceClass={isTV ? 'television' : 'mobile'}>
    <Appearance>
    <InboxProvider>
    <MetadataEditorProvider>
    <DownloadsProvider onViewDownloads={viewDownloads}>
    <CastProvider>
    <PlayOnProvider>
      {/* A touch anywhere tells the freshness hub the person is busy: lists are not rearranged under a finger. */}
      <View style={{flex: 1, backgroundColor: colors.ink}} onTouchStart={pulse} onTouchMove={pulse}>
        <Atmosphere />
        {/* A sign-in the server stops renewing for the time of day, while the app is open, shows as it does at launch, and clears by itself when the hours return. */}
        <ConnectionFeed store={connectionStore} api={session.api} saved={session.saved?.state ?? (session.outsideHours ? 'outsideHours' : undefined)} />
        <FreshnessRuntime />
        <AwayNotice />
        <CertificateNotice />
        <ConnectionStatusProvider store={connectionStore} retry={retryConnection} useAnother={useAnotherServer}>
        <PlayerHost intents={playerIntents} onOpen={openEntry} onTogether={viewTogether} bottom={<><PlayOnBar />{handheld ? <DownloadsGate showing={tab === 'Downloads'} onHidden={selectTab}>{offered => <BottomBar selected={tab} onSelect={selectTab} showChannels={hasChannels} showDownloads={offered} downloadsActive={offline.entries.some(e => e.state === 'downloading')} libraryIcon={currentLibrary ? railLibraryIcon(currentLibrary.kind) : undefined} />}</DownloadsGate> : null}</>}>
          <TVMenuGate gate={gate} />
          <View style={{flex: 1, flexDirection: handheld ? 'column' : 'row'}}>
            {handheld ? null : (
              // One guide per side: the rail remembers its destination, each destination its card (`Roots`).
              // A focus guide shrink-wraps its child unless told otherwise, which is what cut the rail short.
              // The rail is its own focus guide: entry from the content lands on the current destination.
              <View style={{alignSelf: 'stretch', zIndex: 20}}>
                <RailAfterPlayer>
                  {generation => isTV
                    ? <Rail key={generation} ref={rail} onFocusChange={onRailFocusChange} showChannels={hasChannels} libraries={libraries.items} pinned={pins.order} selected={selected} onSelect={select} profileName={profileName} serverName={session.system?.name} expansion={railExpansion} scanning={scanning} />
                    // A wide tablet: Downloads keeps its place among the destinations, by the tab bar's rule.
                    : <DownloadsGate showing={selected === 'Downloads'} onHidden={select}>{offered => <Rail key={generation} ref={rail} onFocusChange={onRailFocusChange} showChannels={hasChannels} showDownloads={offered} libraries={libraries.items} pinned={pins.order} selected={selected} onSelect={select} profileName={profileName} serverName={session.system?.name} expansion={railExpansion} scanning={scanning} />}</DownloadsGate>}
                </RailAfterPlayer>
              </View>
            )}
            {/* APL-SHELL-07: while the rail is open the content slides aside by a transform, so it is
                pushed rather than covered, and nothing re-measures while the focus engine is moving. */}
            <Animated.View style={[{flex: 1}, pushed]}>
              {/* Each destination remembers its own last control (`Roots`): one memory for all of
                  them sent focus back into a destination no longer showing. */}
              <View style={{flex: 1}}>
                {/* INT M6: a new Portico owner accepts the server's registration here. */}
                <CustodyPrompt />
                {navigatorTree}
                <MetadataEditorSheet />
              </View>
            </Animated.View>
          </View>
        </PlayerHost>
        </ConnectionStatusProvider>
        <ChannelReminderHost onOpenChannels={() => select('Channels')} />
        <DeviceApprovalCover />
      </View>
    </PlayOnProvider>
    </CastProvider>
    </DownloadsProvider>
    </MetadataEditorProvider>
    </InboxProvider>
    </Appearance>
    </ServerPreferencesProvider>
    </LibrariesContext.Provider>
  );
}

/**
 * MU1: feeds the connection-status store from the remembered server and the route's own
 * subscription. A leaf, so a route change re-renders only this, never the shell.
 */
function ConnectionFeed({store, api, saved}: {store: ConnectionStatusStore; api: {subscribeRoute: (l: () => void) => () => void; getRouteSnapshot: () => {phase: string} | null | undefined}; saved?: 'checking' | 'offline' | 'replaced' | 'outsideHours'}) {
  const route = useSyncExternalStore(api.subscribeRoute, api.getRouteSnapshot);
  const phase = route?.phase;
  useEffect(() => { store.update({saved, routePhase: phase}); }, [store, saved, phase]);
  return null;
}

/**
 * Apple TV's Menu button leaves the app unless React Native is told to keep
 * it. Keep it whenever there is somewhere to go back to: a pushed screen, an
 * open player, or content focus that should return to the rail first.
 */
function TVMenuKey({allowExit}: {allowExit: boolean}) {
  const playerVisible = usePlayerVisible();
  const {isTV} = useTheme();
  useEffect(() => {
    if (!isTV) return;
    if (playerVisible || !allowExit) TVEventControl.enableTVMenuKey();
    else TVEventControl.disableTVMenuKey();
    return () => TVEventControl.disableTVMenuKey();
  }, [isTV, playerVisible, allowExit]);
  return null;
}

/**
 * The TV rail is a focus guide whose destination is the selected item. While the full player is
 * up, the shell under it is hidden (PlayerHost), and a guide that has been hidden comes back
 * holding a stale destination: it then took focus itself and led nowhere. A fresh rail each time
 * the player closes keeps its guide current.
 */
/**
 * The profile's Appearance settings for this kind of device (Settings › Appearance): the card
 * size and whether backdrops are shown. The server keeps them; until it has answered, the values
 * it gave last time on this device are used, so the app opens at the size it will have.
 */
function Appearance({children}: {children: React.ReactNode}) {
  const server = useServerPreferences();
  const {preferences, update, loaded} = usePreferences();
  const known = !!server.snapshot;
  const cardScale = known ? cardScaleFor(server.value<number>('appearance.cardSizePercent', 100)) : preferences.cardScale;
  const backdrops = known ? server.value<boolean>('appearance.showBackdrops', true) !== false : preferences.showBackdrops;
  useEffect(() => {
    if (known && loaded && (preferences.cardScale !== cardScale || preferences.showBackdrops !== backdrops)) update({cardScale, showBackdrops: backdrops});
  }, [known, loaded, cardScale, backdrops, preferences.cardScale, preferences.showBackdrops, update]);
  return <AppearanceProvider cardScale={cardScale} backdrops={backdrops}>{children}</AppearanceProvider>;
}

function RailAfterPlayer({children}: {children: (generation: number) => React.ReactNode}) {
  const playerVisible = usePlayerVisible();
  const [generation, setGeneration] = useState(0);
  const was = useRef(playerVisible);
  useEffect(() => {
    if (was.current && !playerVisible) setGeneration(g => g + 1);
    was.current = playerVisible;
  }, [playerVisible]);
  return <>{children(generation)}</>;
}
