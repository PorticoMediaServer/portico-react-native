import React from 'react';
import {BackHandler, NativeModules, Platform, View} from 'react-native';
import {defaultI18n} from '../../../../packages/i18n/src';
import {HomeSelectionController, homeSelectionContext} from '../../../../packages/client-core/src/home-selection/index';
import {homeChannelSelection, homeCollectionSelection, homeEntryCapabilities, homeEntrySelection} from '../../../../packages/client-core/src/home-selection';
import type {HomeRow, HomeSpotlight} from '../../../../packages/client-core/src/home';
import type {ContentEntry} from '../../../../packages/client-core/src/library-content';
import type {SelectionContext} from '../../../../packages/client-core/src/selection-model/index';
import {presentError} from '../../../../packages/client-core/src/presentation/errors';
import {LibraryManagementService} from '../../../../packages/client-core/src/library-management';
import {homeSpotlightModels} from '../../../../packages/client-core/src/presentation/home-spotlight';
import {selectionHaptic} from '../platform/haptics';
import {ToastHost, type ToastMessage} from '../kit/overlays';
import {StateView} from '../kit/states';
import {OwnerTag} from '../kit/shell';
import {HomeSelectionBars} from './HomeSelectionBars';
import {HomeSelectionOverlays} from './HomeSelectionOverlays';
import {nativeAccountMenu} from './account';
import {nativeHomeSelectionScope} from './selection-scope';
import {titleRoute, type NativeShellRoute} from './routes';
import {nativeShellRoutes} from './route-registry';
import {homePlayTarget} from '../screens/home/model';
import type {NativeShellBindings, NativeShellBootstrapContext} from './bootstrap';
import type {NativeShellRuntime} from './runtime';

const t = defaultI18n.t;
const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);
const failure = (code: string) => Object.assign(new Error(code), {code});
type Window = {row: HomeRow; order: number; first: number; last: number; cleanup?: () => void; keys: Map<string, string>};

/** Genuine default assembly. The controller and playback runtime retain all business state. */
export function createNativeShellBindings(context: NativeShellBootstrapContext): NativeShellBindings {
  const initial = context.home.getSnapshot().document, session = context.session();
  if (!initial || !session || !context.current()) throw failure('native_home_authority_required');
  const scope = nativeHomeSelectionScope(session.viewer);
  let alive = true, runtime: NativeShellRuntime | undefined, toast: ToastMessage | null = null, toastSequence = 0;
  let tvPageBack: (() => boolean) | undefined;
  const listeners = new Set<() => void>(), windows = new Map<string, Window>(), spotlights = new Map<ContentEntry, {id: string; key: string; cleanup: () => void}>(), scroll = new Map<string, () => void>();
  const operations = new Set<AbortController>();
  const publish = () => {if (alive) for (const listener of [...listeners]) listener();};
  const currentHome = () => alive && context.current() && context.navigation.getSnapshot().route.kind === 'shell' && context.navigation.getSnapshot().destination.kind === 'home';
  const isCurrent = (candidate: SelectionContext) => {
    const document = context.home.getSnapshot().document;
    return currentHome() && !!document && same(candidate, homeSelectionContext(scope, document));
  };
  const reportError = (error: unknown) => {
    if (!alive || !context.current()) return;
    const message = presentError(error, 'home', {operation: 'action'});
    if (message.silent) return;
    toast = {id: `native-home-error-${++toastSequence}`, message: message.body}; publish();
  };
  const open = (route: NativeShellRoute) => {if (alive && context.current()) context.navigation.open(route, context.authority());};
  const platform = {platform: Platform.isTV ? 'tv' as const : 'phone-app' as const, playbackAvailable: true, queueAvailable: true};
  const environment = () => {
    const document = context.home.getSnapshot().document;
    const canEditMetadata = document?.spotlight.some(value => value.entry.homeActions?.editMetadata || value.entry.homeActions?.selection.edit)
      || document?.rows.some(row => row.entries.some(entry => entry.homeActions?.editMetadata || entry.homeActions?.selection.edit)
        || row.collection?.actions?.editMetadata || row.collection?.actions?.selection.edit);
    return {platform: Platform.isTV ? 'tv' as const : 'phone-app' as const, isOwner: context.account.account.role === 'owner', canEditMetadata: canEditMetadata === true};
  };
  const playback = context.playback.selectionPlayback(isCurrent);
  const controller = new HomeSelectionController({api: context.api, events: context.events, home: context.home, context: homeSelectionContext(scope, initial), environment: environment(), isCurrent,
    requestId: async () => NativeModules.PorticoRuntime.newRequestId(), playback, reportError,
    routes: {openEntry: entry => open(titleRoute(entry)), openCollection: collection => open({kind: 'home-see-all', destination: {type: 'collection', resourceId: collection.collection.id, libraryId: collection.collection.libraryId}}),
      openDestination: destination => open({kind: 'saved-destination', destination})}});
  const windowId = (rowId: string) => `home-row:${rowId}`;
  const register = (window: Window) => {
    window.cleanup?.(); window.keys.clear();
    const row = window.row, first = Math.max(0, window.first - 2), last = Math.max(first, window.last + 2);
    const entries = row.entries.slice(first, last + 1), channels = row.live?.channels.slice(first, last + 1);
    const result = controller.registerWindow({id: windowId(row.id), row, sectionOrder: window.order, start: row.start + first,
      ...(channels ? {channels} : row.collection ? {} : {entries})});
    if (!result.ok) throw failure(result.reason);
    window.cleanup = result.unregister;
    for (const entry of entries) {const identity = homeEntrySelection(entry, platform); if (identity) window.keys.set(entry.id, controller.key(identity));}
    for (const channel of channels ?? []) window.keys.set(JSON.stringify([channel.channel.sourceId, channel.channel.id]), controller.key(homeChannelSelection(channel, platform)));
    if (row.collection) window.keys.set(row.collection.collection.id, controller.key(homeCollectionSelection(row.collection, platform)));
  };
  const registerSpotlights = (values: readonly HomeSpotlight[]) => {
    for (const value of spotlights.values()) value.cleanup(); spotlights.clear();
    for (const spotlight of values) {
      const identity = homeEntrySelection(spotlight.entry, platform); if (!identity) continue;
      const id = `home-spotlight:${JSON.stringify([identity.kind, 'libraryId' in identity ? identity.libraryId : '', 'id' in identity ? identity.id : ''])}`;
      const result = controller.registerSpotlight({id, spotlight});
      if (!result.ok) throw failure(result.reason);
      spotlights.set(spotlight.entry, {id, key: controller.key(identity), cleanup: result.unregister});
    }
  };
  registerSpotlights(initial.spotlight);
  const find = (entry: ContentEntry, rowId?: string) => {
    const spotlight = spotlights.get(entry); if (!rowId && spotlight) return spotlight;
    const window = rowId ? windows.get(rowId) : [...windows.values()].find(value => value.row.entries.includes(entry));
    const key = window?.keys.get(entry.id); if (!window || !key) throw failure('unregistered_home_entry');
    return {id: windowId(window.row.id), key};
  };
  const menu = (entry: ContentEntry, rowId?: string) => {if (!currentHome()) return; const member = find(entry, rowId); controller.openMenu(member.id, member.key);};
  const onDocument = () => {
    if (!alive || !context.current()) return;
    const document = context.home.getSnapshot().document;
    if (!document || document.serverId !== scope.serverId || document.viewerFence !== context.authority().viewerFence) return;
    const next = homeSelectionContext(scope, document);
    if (!same(next, controller.getSnapshot().context)) controller.setContext(next, environment());
    if (!currentHome()) return;
    registerSpotlights(document.spotlight);
    for (const [id, window] of windows) {
      const row = document.rows.find(value => value.id === id);
      if (!row) {window.cleanup?.(); windows.delete(id);} else {window.row = row; register(window);}
    }
    publish();
  };
  const scopeForServices = {serverId: scope.serverId, viewerId: JSON.stringify([scope.authority, scope.accountId, scope.profileId])};
  const management = context.account.account.role === 'owner' ? new LibraryManagementService({api: context.api, scope: scopeForServices}) : undefined;
  const cleanups = [context.home.subscribe(onDocument), controller.subscribe(publish), context.navigation.subscribe(() => {
    controller.clear();
    if (currentHome()) onDocument();
    publish();
  }), nativeShellRoutes.subscribe(publish)];
  const back = BackHandler.addEventListener('hardwareBackPress', () => {
    if (!alive || !context.current()) return false;
    const state = controller.getSnapshot();
    if (state.rating) controller.closeRating();
    else if (state.deletion) controller.closeDelete();
    else if (state.editor || state.mixedEdit) controller.closeEditor();
    else if (state.picker) controller.closePicker();
    else if (state.menu) controller.closeMenu();
    else if (state.selection.active) controller.clear();
    else {
      if (context.playback.getSnapshot().dock.local?.expanded) return false;
      // Menus/selection own Back first, then the player, then the page.
      if (Platform.isTV && currentHome() && tvPageBack) return tvPageBack();
      return context.navigation.back(context.authority());
    }
    return true;
  });
  cleanups.push(() => back.remove());
  const run = (work: (signal: AbortSignal) => Promise<void>) => {
    const operation = new AbortController(); operations.add(operation);
    void work(operation.signal).catch(reportError).finally(() => operations.delete(operation));
  };
  const render = (route: NativeShellRoute) => runtime && context.current() ? nativeShellRoutes.get(route.kind)?.render(route, runtime) : null;
  const ownerTag = <OwnerTag audience="owner" variant="badge"/>;
  return {get account() {return nativeAccountMenu(context.account, open, Platform.isTV);}, attach: value => {runtime = value;},
    getState: () => {const state = controller.getSnapshot(); return {destination: context.navigation.getSnapshot().destination, selectionActive: state.selection.active,
      homeVisible: currentHome(), homeObscured: !!(state.menu || state.picker || state.editor || state.deletion || state.rating || state.mixedEdit)};},
    subscribe: listener => {listeners.add(listener); return () => {listeners.delete(listener);};},
    actions: {
      navigate: entry => {if (currentHome()) open(titleRoute(entry));},
      play: (entry, target) => {
        if (!currentHome() || !homeEntryCapabilities(entry, platform).playable) return;
        const document = context.home.getSnapshot().document!;
        const offered = homeSpotlightModels(document).some(value => value.entry === entry && same(value.primary?.entry.playback, target)) || document.rows.some(row => row.entries.includes(entry) && same(homePlayTarget(row, entry)?.playback, target));
        if (!offered) {reportError(failure('unoffered_home_playback')); return;}
        void context.playback.start({entry, target}).catch(reportError);
      },
      more: menu,
      myList: async (entry, selected) => {
        if (!currentHome()) throw failure('stale_home_context');
        const offered = homeEntryCapabilities(entry, platform);
        if (offered.watchlisted === undefined) throw failure('action_not_offered');
        if (offered.watchlisted === selected) return;
        const member = find(entry); controller.openMenu(member.id, member.key);
        await controller.executeMenu('watchlist');
        const action = controller.getSnapshot().action;
        if (action.error) throw failure(action.error.code);
      },
      channel: channel => run(async signal => {if (currentHome()) await playback.playChannel(channel, controller.getSnapshot().context, signal);}),
      channelMore: channel => {
        const window = [...windows.values()].find(value => value.row.live?.channels.includes(channel));
        const key = window?.keys.get(JSON.stringify([channel.channel.sourceId, channel.channel.id]));
        if (!window || !key || !currentHome()) return;
        controller.openMenu(windowId(window.row.id), key);
      },
      collectionMore: (collection, rowId) => {const key = windows.get(rowId)?.keys.get(collection.collection.id); if (key && currentHome()) controller.openMenu(windowId(rowId), key);},
      seeAll: destination => open({kind: 'home-see-all', destination}), customize: () => open({kind: 'home-customize'}),
    },
    selection: rowId => ({active: controller.getSnapshot().selection.active,
      isSelected: id => {const key = windows.get(rowId)?.keys.get(id); return !!key && controller.selection.isSelected(key);},
      onToggle: id => {const key = windows.get(rowId)?.keys.get(id); if (key && currentHome()) controller.toggle(windowId(rowId), key);},
      onEnter: id => {
        const key = windows.get(rowId)?.keys.get(id); if (!key || !currentHome()) return;
        const before = controller.getSnapshot().selection.active, changed = controller.toggle(windowId(rowId), key);
        if (changed.ok && !before && controller.getSnapshot().selection.active) void selectionHaptic().catch(reportError);
      }}),
    setHomeWindow: (row, order, first, last, visible) => {
      const before = windows.get(row.id);
      if (!visible || !currentHome()) {before?.cleanup?.(); windows.delete(row.id); return;}
      if (before?.row === row && before.first === first && before.last === last) return;
      const window = before ?? {row, order, first, last, keys: new Map()};
      Object.assign(window, {row, order, first, last}); windows.set(row.id, window);
      try {register(window);} catch (error) {reportError(error);}
    },
    renderSelection: () => <><HomeSelectionBars controller={controller} ownerTag={ownerTag} reportError={reportError}/><HomeSelectionOverlays controller={controller} runtime={runtime} ownerTag={ownerTag} reportError={reportError}/><ToastHost toast={toast} onDismiss={() => {toast = null; publish();}} bottomOffset={84}/></>,
    renderRoutes: () => {const route = context.navigation.getSnapshot().route; return route.kind === 'shell' ? null : <View pointerEvents="box-none" style={{position: 'absolute', inset: 0}}>{render(route)}</View>;},
    renderDestination: destination => render({kind: 'shell', destination}),
    renderHomeEmpty: () => <StateView variant="centered" title={t('web.empty.homeTitle')} body={t(context.account.account.role === 'owner' ? 'web.empty.homeOwnerBody' : 'web.empty.homeMemberBody')}/>,
    libraryMenu: library => {
      const common = {read: library.kind === 'books', onSaveView: () => open({kind: 'library-save-view', libraryId: library.id}),
        onMarkAll: () => open({kind: 'library-mark-all', libraryId: library.id}), onEditPins: () => open({kind: 'library-edit-pins', libraryId: library.id})};
      return management ? {...common, owner: true as const, ownerTag, onLibrarySettings: () => open({kind: 'library-settings', libraryId: library.id}), onScan: () => run(async () => {
        if (!context.current()) return; await management.selectLibrary(library.id);
        if (!context.current()) return;
        if (management.getSnapshot().selected.data?.scope.viewerFence !== context.authority().viewerFence) throw failure('viewer_scope_changed');
        await management.scan(); const result = management.getSnapshot().mutation;
        if (result.error) throw failure(result.error.code);
      })} : {...common, owner: false as const};
    },
    error: (error, retry) => {const presented = presentError(error, 'home'); return {title: presented.title, body: presented.body, tone: 'error', ...(presented.action === 'try-again' || presented.action === 'refresh' ? {primaryAction: {id: 'retry', label: presented.actionLabel, onPress: retry}} : {})};},
    reportError, onDestination: destination => open({kind: 'shell', destination}),
    scrollToTop: destination => {if (context.current()) {const handler = scroll.get(JSON.stringify(destination)); if (handler) handler(); else {const route = context.navigation.getSnapshot().route; nativeShellRoutes.get(route.kind)?.scrollToTop?.(route);}}},
    registerScrollToTop: (destination, handler) => {const key = JSON.stringify(destination); scroll.set(key, handler); return () => {if (scroll.get(key) === handler) scroll.delete(key);};},
    registerTVPageBack: handler => {tvPageBack = handler; return () => {if (tvPageBack === handler) tvPageBack = undefined;};},
    onArtworkError: error => reportError(error),
    dispose: () => {if (!alive) return; alive = false; for (const operation of operations) operation.abort(); operations.clear(); for (const cleanup of cleanups) cleanup(); for (const window of windows.values()) window.cleanup?.(); for (const spotlight of spotlights.values()) spotlight.cleanup(); windows.clear(); spotlights.clear(); controller.dispose(); management?.dispose(); scroll.clear(); toast = null; runtime = undefined; listeners.clear();},
  };
}
