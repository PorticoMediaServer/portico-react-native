import {AppState, Dimensions, Platform} from 'react-native';
import {defaultI18n} from '../../../../packages/i18n/src';
import {routePath, type RouteResponse} from '../../../../packages/contracts/src/routes';
import {HomeService} from '../../../../packages/client-core/src/home-service';
import type {DirectSnapshot} from '../../../../packages/client-core/src/profile-management';
import {IdentityClient} from '../../../../packages/client-core/src/identity-client';
import type {PreferenceSnapshot} from '../../../../packages/client-core/src/preferences';
import {parseLibraryList} from '../../../../packages/client-core/src/library-list';
import {LocalSessionRefresher} from '../../../../packages/client-core/src/session-refresh';
import {EventsClient} from '../../../../packages/client-core/src/playback-v1/events';
import {localV1Http} from '../../../../packages/client-core/src/playback-v1/local-http';
import {runEventFeed} from '../../../../packages/client-core/src/event-feed';
import {ambientArtworkSource} from '../../../../packages/client-core/src/artwork';
import type {HttpLocalApi, LocalSession, Library} from '../../../../packages/client-core/src';
import {restoreNativeConnection, readNativeSelectedViewer, trackNativeConnection} from '../platform/session';
import {beginNativeInstallation} from '../platform/installation';
import {NativeQueueStore} from '../platform/queue-storage';
import {rememberNativeServerDisplay} from '../platform/server-display';
import {readNativeServerDisplays} from '../platform/server-display';
import {nativeAppSessions} from '../platform/app-session-storage';
import {nativeAccounts} from '../platform/accounts';
import {hostedUrl} from '../platform/account-authority';
import {nativeIdentityFailure, nativeRouteIdentityFailure, type NativeIdentityFailure, type NativeIdentityServer} from '../platform/identity-failure';
import {profilePictureSource} from '../platform/profile-avatars';
import {nativeAmbientSource, type ProfileOption} from '../kit/artwork';
import {LastLibraryMemory} from './library-memory';
import {createNativeShellPlaybackAdapter} from '../platform/playback';
import {nativePlaybackSettings} from './playback-settings';
import {authorityKey, type ShellAuthority} from './model';
import type {NativeShellRuntime, NativeShellSnapshot} from './runtime';
import type {NativeShellPlaybackAdapter} from './playback';
import {NativeShellNavigation} from './routes';
import {NativeWatchOutlet} from './watch-outlet';
import {NativeShellBootstrapServices, nativeShellDirectViewer, nativeShellPermissionDenied} from './bootstrap-services';

export type NativeShellBootstrapContext = Readonly<{
  api: HttpLocalApi;
  home: HomeService;
  events: EventsClient;
  session: () => LocalSession | undefined;
  authority: () => ShellAuthority;
  subscribeAuthority: (listener: () => void) => () => void;
  preferences: () => PreferenceSnapshot;
  subscribePreferences: (listener: () => void) => () => void;
  appVersion: string;
  serverName: string;
  current: () => boolean;
  playback: ReturnType<typeof createNativeShellPlaybackAdapter>;
  watch: NativeWatchOutlet;
  account: DirectSnapshot;
  libraries: () => readonly Library[];
  navigation: NativeShellNavigation;
}>;
/** Only the integrated family/action owners supply these implementations; never fallback no-ops. */
export type NativeShellBindings = Pick<NativeShellRuntime, 'actions' | 'selection' | 'setHomeWindow' | 'homeMenuRow' | 'renderSelection' | 'renderRoutes' | 'renderCanvasRoutes' | 'renderWatch' | 'libraryMenu' | 'renderDestination' | 'renderHomeEmpty' | 'error' | 'reportError' | 'onDestination' | 'scrollToTop' | 'registerScrollToTop' | 'registerTVPageBack' | 'registerTVRailBack' | 'onArtworkError' | 'castControl'> & {
  account: NativeShellSnapshot['account'];
  getState: () => Pick<NativeShellSnapshot, 'destination' | 'railDestination' | 'contentVisible' | 'selectionActive' | 'homeObscured' | 'homeVisible'>;
  attach: (runtime: NativeShellRuntime) => void;
  subscribe: (listener: () => void) => () => void;
  dispose: () => void;
};
export type NativeShellBindingsFactory = (context: NativeShellBootstrapContext) => Promise<NativeShellBindings> | NativeShellBindings;
export type RestoredNativeShellRuntime = NativeShellRuntime & {dispose: () => void; refresh: () => Promise<void>};

function cancelled(): Error {return Object.assign(new Error('native_shell_cancelled'), {name: 'AbortError'});}
const sameViewer = (a: LocalSession, b: LocalSession): boolean => a.sessionFamilyId === b.sessionFamilyId && (['serverId', 'accountId', 'profileId', 'authority', 'role'] as const).every(key => a.viewer[key] === b.viewer[key]);

/** Uses the existing encrypted native sign-in, signed routes and current membership verification.
 * It registers the persisted installation before restoring credentials; it creates no sign-in UI. */
export async function restoreNativeShellRuntime(makeBindings: NativeShellBindingsFactory, options: {signal?: AbortSignal; onAuthorityEnded: (error?: NativeIdentityFailure) => void}): Promise<RestoredNativeShellRuntime | undefined> {
  const installation = beginNativeInstallation(options.signal);
  let alive = true, ready = false, api: HttpLocalApi | undefined, home: HomeService | undefined;
  let refresher: LocalSessionRefresher | undefined, bindings: NativeShellBindings | undefined;
  let playback: ReturnType<typeof createNativeShellPlaybackAdapter> | undefined;
  let navigation: NativeShellNavigation | undefined;
  let watch: NativeWatchOutlet | undefined;
  let session: LocalSession | undefined;
  let services: NativeShellBootstrapServices | undefined;
  let snapshot: NativeShellSnapshot | undefined, preferences: PreferenceSnapshot | undefined, account: DirectSnapshot | undefined;
  let avatars: Awaited<ReturnType<IdentityClient['avatars']>> = [], libraries: readonly Library[] = [];
  let installationSettings: unknown;
  let identityServer: NativeIdentityServer | undefined;
  const cleanups: (() => void)[] = [], authorityListeners = new Set<() => void>(), preferenceListeners = new Set<() => void>(), listeners = new Set<() => void>();
  const signal = new AbortController();
  const dispose = () => {
    alive = false; installation.dispose(); signal.abort(); refresher?.stop(); services?.dispose(); home?.dispose();
    watch?.dispose(); playback?.dispose(); bindings?.dispose(); navigation?.dispose();
    for (const cleanup of cleanups.splice(0)) cleanup();
    api?.getRouteConnection()?.dispose(); api?.setAccessToken(''); session = undefined;
    snapshot = undefined; preferences = undefined; account = undefined; avatars = []; libraries = []; installationSettings = undefined;
    for (const listener of [...authorityListeners]) listener();
    authorityListeners.clear(); preferenceListeners.clear(); listeners.clear();
  };
  const end = (error?: NativeIdentityFailure) => {if (alive) {dispose(); options.onAuthorityEnded(error);}};
  const abort = () => dispose();
  options.signal?.addEventListener('abort', abort, {once: true});
  cleanups.push(() => options.signal?.removeEventListener('abort', abort));
  const assertCurrent = () => {if (!alive || !installation.current() || options.signal?.aborted || signal.signal.aborted) {dispose(); throw cancelled();}};
  const currentPreferences = () => {assertCurrent(); if (!preferences) throw cancelled(); return preferences;};
  const currentAccount = () => {assertCurrent(); if (!account) throw cancelled(); return account;};
  try {
    assertCurrent();
    const {saved, connection, env, identity: installed} = await installation.prepare(); assertCurrent();
    if (!saved.viewer) {dispose(); return undefined;}
    const original = saved.viewer;
    nativeShellDirectViewer(original.session.viewer);
    const selected = await nativeAppSessions.selected(); assertCurrent();
    if (!selected || !sameViewer(original.session, selected.connection.session) || selected.connection.logicalOrigin !== original.serverUrl) throw cancelled();
    const [display] = await readNativeServerDisplays([selected]); assertCurrent();
    identityServer = Object.freeze({serverId: selected.connection.pin.serverId, familyId: selected.connection.session.sessionFamilyId,
      fingerprint: selected.connection.pin.fingerprint, signIn: selected.signIn, name: display.name});
    // A server-local session renews locally even while Portico Services is unreachable.
    const hostedCredentials = connection?.hosted?.origin === hostedUrl ? () => nativeAccounts.accountCredentials() : undefined;
    const restored = await restoreNativeConnection(connection?.hosted?.origin ?? original.serverUrl, hostedCredentials, original.session, env);
    api = restored?.api; assertCurrent();
    if (!restored || !sameViewer(original.session, restored.session)) throw Object.assign(new Error('native_viewer_changed'), {code: 'identity_mismatch'});
    const reread = await readNativeSelectedViewer(); assertCurrent();
    if (!reread || reread.serverUrl !== original.serverUrl || !sameViewer(reread.session, restored.session)) throw cancelled();
    api = restored.api;
    api.setDeviceClass(Platform.isTV ? 'television' : 'mobile');
    const local = api;
    trackNativeConnection(local);
    session = restored.session;
    services = new NativeShellBootstrapServices(local, {viewer: session.viewer, deviceClass: Platform.isTV ? 'television' : 'mobile',
      signal: signal.signal, current: () => alive && installation.current(), onAuthorityEnded: end});
    const readers = services;
    home = readers.home;
    const documentService = home;
    const identities = new IdentityClient(readers);
    const [librariesResult, initialAccount, initialAvatars, initialFacts, server] = await Promise.all([
      readers.request(routePath('get_libraries'), 'GET', undefined, signal.signal).then(parseLibraryList),
      readers.readAccount(),
      identities.avatars(signal.signal),
      readers.read(),
      rememberNativeServerDisplay(local, {serverId: session.viewer.serverId,
        signal: signal.signal, isCurrent: () => alive && installation.current()}),
      documentService.load(),
    ]);
    assertCurrent();
    const document = documentService.getSnapshot().document;
    if (!document) throw documentService.getSnapshot().error ?? Object.assign(new Error('invalid_home'), {code: 'invalid_home'});
    if (document.serverId !== session.viewer.serverId) throw Object.assign(new Error('identity_mismatch'), {code: 'identity_mismatch'});
    account = initialAccount;
    avatars = initialAvatars;
    const profile = account.profiles.find(value => value.id === session!.viewer.profileId);
    if (!profile) throw Object.assign(new Error('profile_unavailable'), {code: 'access_refused'});
    preferences = initialFacts.preferences;
    const records = new NativeQueueStore();
    installationSettings = await records.change('preferences:v1', raw => ({record: raw, value: raw}));
    assertCurrent();
    let unread = initialFacts.unread;
    const authority: ShellAuthority = Object.freeze({serverId: session.viewer.serverId, accountId: session.viewer.accountId, profileId: session.viewer.profileId,
      epoch: JSON.stringify([session.sessionFamilyId, session.authorizationHorizon, profile.revision, profile.pinRevision]), viewerFence: document.viewerFence});
    const scopeIdentity = authorityKey(authority);
    const current = () => {
      const valid = alive && installation.current() && !!session && session.viewer.serverId === authority.serverId && session.viewer.accountId === authority.accountId && session.viewer.profileId === authority.profileId;
      if (!valid && alive) end();
      return valid;
    };
    const profileOption: ProfileOption = Object.freeze({id: profile.id, name: profile.name, initial: [...profile.name.trim()][0] ?? '', color: profile.art, primary: profile.primary, pinRequired: profile.pinRequired});
    libraries = Object.freeze(librariesResult.items);
    let hasLiveTV = initialFacts.hasLiveTV;
    const events = new EventsClient({http: localV1Http(local)});
    navigation = new NativeShellNavigation(authority, () => authority);
    const contextBase: Omit<NativeShellBootstrapContext, 'playback' | 'watch'> = {api: local, home: documentService, events, session: () => current() ? session : undefined, authority: () => authority,
      subscribeAuthority: listener => {authorityListeners.add(listener); return () => {authorityListeners.delete(listener);};},
      preferences: currentPreferences, subscribePreferences: listener => {preferenceListeners.add(listener); return () => {preferenceListeners.delete(listener);};},
      appVersion: installed.appVersion, serverName: server.name, current,
      get account() {return currentAccount();}, libraries: () => current() ? libraries : [], navigation};
    playback = createNativeShellPlaybackAdapter({api: local, authority: contextBase.authority, session: contextBase.session, subscribeAuthority: contextBase.subscribeAuthority, events,
      settings: () => nativePlaybackSettings(currentPreferences().effective, installationSettings), subscribeSettings: contextBase.subscribePreferences, appVersion: contextBase.appVersion});
    watch = new NativeWatchOutlet(() => current() ? {authority, fence: playback!.getSnapshot().fence, window: Dimensions.get('window')} : undefined);
    cleanups.push(playback.subscribe(watch.invalidate));
    const windowSubscription = Dimensions.addEventListener('change', watch.invalidate);
    cleanups.push(() => windowSubscription.remove());
    const context: NativeShellBootstrapContext = {...contextBase, playback, watch, get account() {return currentAccount();}};
    bindings = await makeBindings(context); assertCurrent();
    const selectedBeforePublish = await readNativeSelectedViewer(); assertCurrent();
    if (!selectedBeforePublish || !sameViewer(selectedBeforePublish.session, session) || selectedBeforePublish.serverUrl !== original.serverUrl) throw cancelled();
    const bound = bindings;
    const publish = () => {
      if (!current()) return;
      const avatar = avatars.find(value => value.profileId === profile.id), picture = profilePictureSource(local, session!.accessToken, avatar, Platform.isTV ? 80 : 90);
      snapshot = Object.freeze({authority, ...bound.getState(), mediaExpanded: playback!.getSnapshot().dock.local?.expanded === true, libraries, hasLiveTV, serverName: server.name, unreadNotificationCount: unread,
        profile: {...profileOption, ...(picture && typeof picture === 'object' && 'uri' in picture && picture.uri ? {source: {uri: picture.uri, headers: picture.headers, cacheKey: JSON.stringify([scopeIdentity, avatar?.version, picture.uri])}} : {})}, unreadNotifications: unread > 0, account: bound.account});
      for (const listener of [...listeners]) listener();
    };
    publish();
    refresher = new LocalSessionRefresher({env, api: local, session, onRotated: renewed => {
      if (!current() || !sameViewer(session!, renewed) || renewed.authorizationHorizon !== session!.authorizationHorizon) {end(); return;}
      // The refresher atomically owns the protected rotating credential. A second blind write
      // to selected-viewer storage could overwrite a newer profile while awaiting the bridge.
      session = renewed; publish();
    }, onSignedOut: () => end()});
    let refreshing: Promise<void> | undefined;
    const refresh = () => refreshing ??= (async () => {
      assertCurrent();
      const round = new AbortController(), abortRound = () => round.abort();
      signal.signal.addEventListener('abort', abortRound, {once: true});
      try {
        const [selection, me, nextLibraries, nextFacts, nextInstallation, nextAccount, nextAvatars] = await Promise.all([
          readNativeSelectedViewer(), readers.request<RouteResponse<'get_me'>>(routePath('get_me'), 'GET', undefined, round.signal),
          readers.request(routePath('get_libraries'), 'GET', undefined, round.signal).then(parseLibraryList), readers.read(round.signal),
          records.change('preferences:v1', raw => ({record: raw, value: raw})), readers.readAccount(round.signal), identities.avatars(round.signal),
        ]);
        assertCurrent();
        const nextProfile = nextAccount.profiles.find(value => value.id === authority.profileId);
        if (!selection || selection.serverUrl !== original.serverUrl || !sameViewer(selection.session, session!)
          || (['accountId', 'profileId', 'serverId', 'authority', 'role'] as const).some(key => me.viewer[key] !== session!.viewer[key])
          || !nextProfile || nextProfile.revision !== profile.revision || nextProfile.pinRevision !== profile.pinRevision
          || nextAccount.account.role !== currentAccount().account.role) {end(); return;}
        // Revalidate Home before committing the other private facts. Same-scope read failures
        // retain the entire published body; a changed Home fence retires it in the transport.
        await documentService.revalidate({signal: round.signal}); assertCurrent();
        const selectedBeforeRefreshPublish = await readNativeSelectedViewer(); assertCurrent();
        if (!selectedBeforeRefreshPublish || selectedBeforeRefreshPublish.serverUrl !== original.serverUrl || !sameViewer(selectedBeforeRefreshPublish.session, session!)) {end(); return;}
        preferences = nextFacts.preferences; installationSettings = nextInstallation; libraries = Object.freeze(nextLibraries.items);
        account = nextAccount; avatars = nextAvatars; unread = nextFacts.unread; hasLiveTV = nextFacts.hasLiveTV;
        for (const listener of [...preferenceListeners]) listener();
        publish();
      } catch (error) {
        if (nativeShellPermissionDenied(error)) end();
        throw error;
      } finally {round.abort(); signal.signal.removeEventListener('abort', abortRound);}
    })().finally(() => {refreshing = undefined;});
    const routeChanged = () => {
      if (!alive) return;
      const route = local.getRouteConnection()?.getSnapshot();
      const failure = route && identityServer ? nativeRouteIdentityFailure(route, identityServer) : undefined;
      if (failure) {end(failure); return;}
      publish();
    };
    cleanups.push(bound.subscribe(publish), local.subscribeRoute(routeChanged), documentService.subscribe(() => {
      const next = documentService.getSnapshot().document;
      if (ready && current() && next && (next.serverId !== authority.serverId || next.viewerFence !== authority.viewerFence)) end();
    }));
    let expanded = playback.getSnapshot().dock.local?.expanded === true;
    cleanups.push(playback.subscribe(() => {const next = playback!.getSnapshot().dock.local?.expanded === true; if (next !== expanded) {expanded = next; publish();}}));
    const refreshQuietly = () => {if (current()) void refresh().catch(error => {if (current()) bound.reportError(error);});};
    cleanups.push(events.onResync(refreshQuietly), events.on('library.', refreshQuietly), events.on('personal.', refreshQuietly), events.on('preferences.', refreshQuietly), events.on('notification.changed', refreshQuietly));
    const app = AppState.addEventListener('change', value => {if (value === 'active') {refresher?.wake(); refreshQuietly();}});
    cleanups.push(() => app.remove(), runEventFeed(events, undefined, {visible: () => AppState.currentState === 'active', onVisibility: listener => {const subscription = AppState.addEventListener('change', listener); return () => subscription.remove();},
      busy: () => !!playback?.getSnapshot().dock.local, onBusy: playback.subscribe}));
    ready = true;
    const resolve = (path: string) => current() ? local.mediaUrl(path) : undefined;
    const skipBackMs = currentPreferences().effective['playback.skipBackMs'];
    if (typeof skipBackMs !== 'number' || !Number.isFinite(skipBackMs) || skipBackMs < 0) throw Object.assign(new Error('invalid_playback_preference'), {code: 'invalid_response'});
    const runtime: RestoredNativeShellRuntime = {...bound, playback, watch, get skipBackSeconds() {const value = currentPreferences().effective['playback.skipBackMs']; if (typeof value !== 'number' || !Number.isFinite(value) || value < 0) throw new Error('invalid_playback_preference'); return value / 1000;}, home: documentService, memory: new LastLibraryMemory(records), text: {t: defaultI18n.t, locale: 'en-US'},
      subscribe: listener => {assertCurrent(); listeners.add(listener); return () => {listeners.delete(listener);};}, getSnapshot: () => {assertCurrent(); if (!snapshot) throw cancelled(); return snapshot;},
      artwork: path => {
        if (!path || !current()) return undefined;
        const uri = resolve(path);
        return uri ? {uri, cacheKey: JSON.stringify([scopeIdentity, uri]), headers: {Authorization: `Bearer ${session!.accessToken}`}} : undefined;
      }, ambient: path => current() ? nativeAmbientSource(ambientArtworkSource(path, {serverId: authority.serverId, viewerId: authority.profileId, authorityKey: scopeIdentity}), resolve, {Authorization: `Bearer ${session!.accessToken}`}) : undefined,
      dispose, refresh};
    // Spreading the bindings evaluates their account getter. Keep that private menu
    // behind the live authority too, instead of retaining the copied menu on retirement.
    Object.defineProperty(runtime, 'account', {get: () => {assertCurrent(); return bound.account;}});
    bound.attach(runtime);
    return runtime;
  } catch (error) {dispose(); throw nativeIdentityFailure(error, identityServer) ?? error;}
}
