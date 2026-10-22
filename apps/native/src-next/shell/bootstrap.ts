import {AppState, Platform} from 'react-native';
import {defaultI18n} from '../../../../packages/i18n/src';
import {routePath, type RouteResponse} from '../../../../packages/contracts/src/routes';
import {HomeService} from '../../../../packages/client-core/src/home-service';
import {parseDirectSnapshot, type DirectSnapshot} from '../../../../packages/client-core/src/profile-management';
import {IdentityClient} from '../../../../packages/client-core/src/identity-client';
import {parsePreferenceSnapshot, type PreferenceSnapshot} from '../../../../packages/client-core/src/preferences';
import {LocalSessionRefresher} from '../../../../packages/client-core/src/session-refresh';
import {EventsClient} from '../../../../packages/client-core/src/playback-v1/events';
import {localV1Http} from '../../../../packages/client-core/src/playback-v1/local-http';
import {runEventFeed} from '../../../../packages/client-core/src/event-feed';
import {ambientArtworkSource} from '../../../../packages/client-core/src/artwork';
import {parseNotificationSummary} from '../../../../packages/client-core/src/notifications';
import type {HttpLocalApi, LocalSession, Library, CredentialSessionService} from '../../../../packages/client-core/src';
import {restoreNativeConnection, createCredentials, nativeViewerStorage, nativeConnectionEnvironment, trackNativeConnection} from '../platform/session';
import {beginNativeInstallation} from '../platform/installation';
import {NativeQueueStore} from '../platform/queue-storage';
import {profilePictureSource} from '../platform/profile-avatars';
import {nativeAmbientSource, type ProfileOption} from '../kit/artwork';
import {LastLibraryMemory} from './library-memory';
import {createNativeShellPlaybackAdapter} from '../platform/playback';
import {nativePlaybackSettings} from './playback-settings';
import {authorityKey, type ShellAuthority} from './model';
import type {NativeShellRuntime, NativeShellSnapshot} from './runtime';
import type {NativeShellPlaybackAdapter} from './playback';
import {NativeShellNavigation} from './routes';

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
  current: () => boolean;
  playback: NativeShellPlaybackAdapter;
  account: DirectSnapshot;
  libraries: () => readonly Library[];
  navigation: NativeShellNavigation;
}>;
/** Only the integrated family/action owners supply these implementations; never fallback no-ops. */
export type NativeShellBindings = Pick<NativeShellRuntime, 'actions' | 'selection' | 'setHomeWindow' | 'renderSelection' | 'renderRoutes' | 'libraryMenu' | 'renderDestination' | 'renderHomeEmpty' | 'error' | 'reportError' | 'onDestination' | 'scrollToTop' | 'registerScrollToTop' | 'onArtworkError' | 'castControl'> & {
  account: NativeShellSnapshot['account'];
  getState: () => Pick<NativeShellSnapshot, 'destination' | 'selectionActive' | 'homeObscured' | 'homeVisible'>;
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
export async function restoreNativeShellRuntime(makeBindings: NativeShellBindingsFactory, options: {signal?: AbortSignal; onAuthorityEnded: () => void}): Promise<RestoredNativeShellRuntime | undefined> {
  const installation = beginNativeInstallation(options.signal);
  let alive = true, ready = false, api: HttpLocalApi | undefined, home: HomeService | undefined;
  let refresher: LocalSessionRefresher | undefined, bindings: NativeShellBindings | undefined;
  let playback: ReturnType<typeof createNativeShellPlaybackAdapter> | undefined;
  let navigation: NativeShellNavigation | undefined;
  let session: LocalSession | undefined;
  const cleanups: (() => void)[] = [], authorityListeners = new Set<() => void>(), preferenceListeners = new Set<() => void>(), listeners = new Set<() => void>();
  const signal = new AbortController();
  const dispose = () => {
    alive = false; installation.dispose(); signal.abort(); refresher?.stop(); home?.dispose();
    playback?.dispose(); bindings?.dispose(); navigation?.dispose();
    for (const cleanup of cleanups.splice(0)) cleanup();
    api?.getRouteConnection()?.dispose(); api?.setAccessToken(''); session = undefined;
    for (const listener of [...authorityListeners]) listener();
    authorityListeners.clear(); preferenceListeners.clear(); listeners.clear();
  };
  const end = () => {if (alive) {dispose(); options.onAuthorityEnded();}};
  const abort = () => dispose();
  options.signal?.addEventListener('abort', abort, {once: true});
  cleanups.push(() => options.signal?.removeEventListener('abort', abort));
  const assertCurrent = () => {if (!alive || !installation.current() || options.signal?.aborted || signal.signal.aborted) throw cancelled();};
  try {
    assertCurrent();
    const {saved, connection, identity: installed} = await installation.prepare(); assertCurrent();
    if (!saved.viewer) {dispose(); return undefined;}
    const original = saved.viewer;
    let credentials: CredentialSessionService | undefined;
    if (connection?.hosted) {credentials = createCredentials(connection.hosted.origin); await credentials.synchronize(); assertCurrent();}
    const restored = await restoreNativeConnection(connection?.hosted?.origin ?? original.serverUrl, credentials, original.session); assertCurrent();
    if (!restored || !sameViewer(original.session, restored.session)) throw Object.assign(new Error('native_viewer_changed'), {code: 'identity_mismatch'});
    const reread = await nativeViewerStorage.read(); assertCurrent();
    if (!reread || reread.serverUrl !== original.serverUrl || !sameViewer(reread.session, restored.session)) throw cancelled();
    api = restored.api;
    api.setDeviceClass(Platform.isTV ? 'television' : 'mobile');
    const local = api;
    trackNativeConnection(local);
    session = restored.session;
    home = new HomeService(local);
    const documentService = home;
    const identities = new IdentityClient(local);
    const [librariesResult, accountRaw, initialAvatars, preferencesRaw, notificationsRaw] = await Promise.all([
      local.libraries(),
      local.request<RouteResponse<'get_direct_account'>>(routePath('get_direct_account'), 'GET', undefined, signal.signal),
      identities.avatars(signal.signal),
      local.request<RouteResponse<'get_preferences'>>(routePath('get_preferences'), 'GET', undefined, signal.signal),
      local.request<RouteResponse<'get_notifications_unread_count'>>(routePath('get_notifications_unread_count'), 'GET', undefined, signal.signal),
      documentService.load(),
    ]);
    assertCurrent();
    const document = documentService.getSnapshot().document;
    if (!document) throw documentService.getSnapshot().error ?? Object.assign(new Error('invalid_home'), {code: 'invalid_home'});
    if (document.serverId !== session.viewer.serverId) throw Object.assign(new Error('identity_mismatch'), {code: 'identity_mismatch'});
    let account = parseDirectSnapshot(accountRaw, {authority: 'local', serverId: session.viewer.serverId, accountId: session.viewer.accountId}, true);
    let avatars = initialAvatars;
    const profile = account.profiles.find(value => value.id === session!.viewer.profileId);
    if (!profile) throw Object.assign(new Error('profile_unavailable'), {code: 'access_refused'});
    let preferences = parsePreferenceSnapshot(preferencesRaw);
    const records = new NativeQueueStore();
    let installationSettings = await records.change('preferences:v1', raw => ({record: raw, value: raw}));
    assertCurrent();
    if (preferencesRaw.scope.serverId !== document.serverId || preferencesRaw.scope.viewerFence !== document.viewerFence || notificationsRaw.scope.serverId !== document.serverId || notificationsRaw.scope.viewerFence !== document.viewerFence) throw Object.assign(new Error('viewer_scope_changed'), {code: 'access_refused'});
    let notifications = parseNotificationSummary(notificationsRaw.data);
    const authority: ShellAuthority = Object.freeze({serverId: session.viewer.serverId, accountId: session.viewer.accountId, profileId: session.viewer.profileId,
      epoch: JSON.stringify([session.sessionFamilyId, session.authorizationHorizon, profile.revision, profile.pinRevision]), viewerFence: document.viewerFence});
    const scopeIdentity = authorityKey(authority);
    const current = () => alive && installation.current() && !!session && session.viewer.serverId === authority.serverId && session.viewer.accountId === authority.accountId && session.viewer.profileId === authority.profileId;
    const profileOption: ProfileOption = Object.freeze({id: profile.id, name: profile.name, initial: [...profile.name.trim()][0] ?? '', color: profile.art, primary: profile.primary, pinRequired: profile.pinRequired});
    let libraries: readonly Library[] = Object.freeze(librariesResult.items);
    // The source directory checks the current profile permission; no admin/source lookup and no
    // client scan of every channel. A denied source directory never leaks names into navigation.
    const readSources = () => local.request<RouteResponse<'get_guide_sources'>>(routePath('get_guide_sources'), 'GET', undefined, signal.signal).catch(error => {
      if ((error as {status?: unknown})?.status === 403) return undefined;
      throw error;
    });
    const sourceDirectory = await readSources();
    assertCurrent();
    if (sourceDirectory && (sourceDirectory.serverId !== authority.serverId || sourceDirectory.viewerFence !== authority.viewerFence)) throw Object.assign(new Error('viewer_scope_changed'), {code: 'access_refused'});
    let hasLiveTV = !!sourceDirectory?.sources.length;
    const events = new EventsClient({http: localV1Http(local)});
    navigation = new NativeShellNavigation(authority, () => authority);
    const contextBase: Omit<NativeShellBootstrapContext, 'playback'> = {api: local, home: documentService, events, session: () => current() ? session : undefined, authority: () => authority,
      subscribeAuthority: listener => {authorityListeners.add(listener); return () => {authorityListeners.delete(listener);};},
      preferences: () => preferences, subscribePreferences: listener => {preferenceListeners.add(listener); return () => {preferenceListeners.delete(listener);};},
      appVersion: installed.appVersion, current,
      get account() {return account;}, libraries: () => libraries, navigation};
    playback = createNativeShellPlaybackAdapter({api: local, authority: contextBase.authority, session: contextBase.session, subscribeAuthority: contextBase.subscribeAuthority, events,
      settings: () => nativePlaybackSettings(preferences.effective, installationSettings), subscribeSettings: contextBase.subscribePreferences, appVersion: contextBase.appVersion});
    const context: NativeShellBootstrapContext = {...contextBase, playback, get account() {return account;}};
    bindings = await makeBindings(context); assertCurrent();
    const selectedBeforePublish = await nativeViewerStorage.read(); assertCurrent();
    if (!selectedBeforePublish || !sameViewer(selectedBeforePublish.session, session) || selectedBeforePublish.serverUrl !== original.serverUrl) throw cancelled();
    const bound = bindings;
    let snapshot: NativeShellSnapshot;
    const publish = () => {
      if (!current()) return;
      const avatar = avatars.find(value => value.profileId === profile.id), picture = profilePictureSource(local, session!.accessToken, avatar, Platform.isTV ? 80 : 90);
      snapshot = Object.freeze({authority, ...bound.getState(), mediaExpanded: playback!.getSnapshot().dock.local?.expanded === true, libraries, hasLiveTV, profile: {...profileOption, ...(picture && typeof picture === 'object' && 'uri' in picture && picture.uri ? {source: {uri: picture.uri, headers: picture.headers, cacheKey: JSON.stringify([scopeIdentity, avatar?.version, picture.uri])}} : {})}, unreadNotifications: notifications.counts.unread > 0, account: bound.account});
      for (const listener of [...listeners]) listener();
    };
    publish();
    refresher = new LocalSessionRefresher({env: nativeConnectionEnvironment, api: local, session, onRotated: renewed => {
      if (!current() || !sameViewer(session!, renewed) || renewed.authorizationHorizon !== session!.authorizationHorizon) {end(); return;}
      // The refresher atomically owns the protected rotating credential. A second blind write
      // to selected-viewer storage could overwrite a newer profile while awaiting the bridge.
      session = renewed; publish();
    }, onSignedOut: end});
    let refreshing: Promise<void> | undefined;
    const refresh = () => refreshing ??= (async () => {
      const [selection, me, nextLibraries, nextPreferences, nextInstallation, nextAccountRaw, nextAvatars, nextNotificationsRaw, nextSources] = await Promise.all([
        nativeViewerStorage.read(), local.me(), local.libraries(), local.request<RouteResponse<'get_preferences'>>(routePath('get_preferences'), 'GET', undefined, signal.signal),
        records.change('preferences:v1', raw => ({record: raw, value: raw})),
        local.request<RouteResponse<'get_direct_account'>>(routePath('get_direct_account'), 'GET', undefined, signal.signal), identities.avatars(signal.signal),
        local.request<RouteResponse<'get_notifications_unread_count'>>(routePath('get_notifications_unread_count'), 'GET', undefined, signal.signal), readSources(),
      ]);
      if (!current()) return;
      const nextAccount = parseDirectSnapshot(nextAccountRaw, {authority: 'local', serverId: authority.serverId, accountId: authority.accountId}, true);
      const nextProfile = nextAccount.profiles.find(value => value.id === authority.profileId);
      if (!selection || !sameViewer(selection.session, session!) || (['accountId', 'profileId', 'serverId', 'authority', 'role'] as const).some(key => me.viewer[key] !== session!.viewer[key])
        || !nextProfile || nextProfile.revision !== profile.revision || nextProfile.pinRevision !== profile.pinRevision || nextAccount.account.role !== account.account.role
        || nextPreferences.scope.serverId !== authority.serverId || nextPreferences.scope.viewerFence !== authority.viewerFence
        || nextNotificationsRaw.scope.serverId !== authority.serverId || nextNotificationsRaw.scope.viewerFence !== authority.viewerFence
        || nextSources && (nextSources.serverId !== authority.serverId || nextSources.viewerFence !== authority.viewerFence)) {end(); return;}
      preferences = parsePreferenceSnapshot(nextPreferences); installationSettings = nextInstallation; libraries = Object.freeze(nextLibraries.items);
      account = nextAccount; avatars = nextAvatars; notifications = parseNotificationSummary(nextNotificationsRaw.data); hasLiveTV = !!nextSources?.sources.length;
      for (const listener of [...preferenceListeners]) listener();
      await documentService.revalidate();
      if (!current()) return;
      const fresh = documentService.getSnapshot().document;
      if (fresh && fresh.viewerFence !== authority.viewerFence) {end(); return;}
      publish();
    })().finally(() => {refreshing = undefined;});
    cleanups.push(bound.subscribe(publish), local.subscribeRoute(publish), documentService.subscribe(() => {
      const next = documentService.getSnapshot().document;
      if (ready && current() && next && (next.serverId !== authority.serverId || next.viewerFence !== authority.viewerFence)) end();
    }));
    let expanded = playback.getSnapshot().dock.local?.expanded === true;
    cleanups.push(playback.subscribe(() => {const next = playback!.getSnapshot().dock.local?.expanded === true; if (next !== expanded) {expanded = next; publish();}}));
    const refreshQuietly = () => {if (current()) void refresh().catch(bound.reportError);};
    cleanups.push(events.onResync(refreshQuietly), events.on('library.', refreshQuietly), events.on('personal.', refreshQuietly), events.on('preferences.', refreshQuietly), events.on('notification.changed', refreshQuietly));
    const app = AppState.addEventListener('change', value => {if (value === 'active') {refresher?.wake(); refreshQuietly();}});
    cleanups.push(() => app.remove(), runEventFeed(events, undefined, {visible: () => AppState.currentState === 'active', onVisibility: listener => {const subscription = AppState.addEventListener('change', listener); return () => subscription.remove();},
      busy: () => !!playback?.getSnapshot().dock.local, onBusy: playback.subscribe}));
    ready = true;
    const resolve = (path: string) => current() ? local.mediaUrl(path) : undefined;
    const skipBackMs = preferences.effective['playback.skipBackMs'];
    if (typeof skipBackMs !== 'number' || !Number.isFinite(skipBackMs) || skipBackMs < 0) throw Object.assign(new Error('invalid_playback_preference'), {code: 'invalid_response'});
    const runtime: RestoredNativeShellRuntime = {...bound, playback, get skipBackSeconds() {const value = preferences.effective['playback.skipBackMs']; if (typeof value !== 'number' || !Number.isFinite(value) || value < 0) throw new Error('invalid_playback_preference'); return value / 1000;}, home: documentService, memory: new LastLibraryMemory(records), text: {t: defaultI18n.t, locale: 'en-US'},
      subscribe: listener => {listeners.add(listener); return () => {listeners.delete(listener);};}, getSnapshot: () => snapshot,
      artwork: path => {
        if (!path || !current()) return undefined;
        const uri = resolve(path);
        return uri ? {uri, cacheKey: JSON.stringify([scopeIdentity, uri]), headers: {Authorization: `Bearer ${session!.accessToken}`}} : undefined;
      }, ambient: path => current() ? nativeAmbientSource(ambientArtworkSource(path, {serverId: authority.serverId, viewerId: authority.profileId, authorityKey: scopeIdentity}), resolve, {Authorization: `Bearer ${session!.accessToken}`}) : undefined,
      dispose, refresh};
    bound.attach(runtime);
    return runtime;
  } catch (error) {dispose(); throw error;}
}
