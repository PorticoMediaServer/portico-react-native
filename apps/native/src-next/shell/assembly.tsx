import React from 'react';
import {BackHandler, Platform, View} from 'react-native';
import {defaultI18n} from '../../../../packages/i18n/src';
import {HomeSelectionController, homeSelectionContext} from '../../../../packages/client-core/src/home-selection/index';
import {homeChannelSelection, homeCollectionSelection, homeEntryCapabilities, homeEntrySelection} from '../../../../packages/client-core/src/home-selection';
import type {HomeRow, HomeSpotlight} from '../../../../packages/client-core/src/home';
import type {ContentEntry} from '../../../../packages/client-core/src/library-content';
import type {SelectionContext} from '../../../../packages/client-core/src/selection-model/index';
import {LibraryManagementService} from '../../../../packages/client-core/src/library-management';
import {homeSpotlightModels} from '../../../../packages/client-core/src/presentation/home-spotlight';
import {selectionHaptic} from '../platform/haptics';
import {homeActionDiagnostics} from '../platform/home-action-diagnostics';
import {nativeScreenServices, NativeScreenFeedbackHost} from '../screens/native-screen-services';
import {StateView} from '../kit/states';
import {OwnerTag} from '../kit/shell';
import {HomeSelectionBars} from './HomeSelectionBars';
import {HomeSelectionOverlays} from './HomeSelectionOverlays';
import {nativeAccountMenu} from './account';
import {nativeHomeSelectionScope} from './selection-scope';
import {nativeRailDestination, titleRoute, type NativeShellRoute} from './routes';
import {nativeShellRoutes} from './route-registry';
import {homePlayTarget} from '../screens/home/model';
import {planHomeWindows} from './home-windows';
import {isReadingLibraryKind} from '../screens/read/platform';
import type {NativeShellBindings, NativeShellBootstrapContext} from './bootstrap';
import type {NativeShellRuntime} from './runtime';

const t = defaultI18n.t;
const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);
const failure = (code: string) => Object.assign(new Error(code), {code});
type Registration = {row: HomeRow; order: number; context: string; coordinate: number; first: number; last: number};
type Window = {registration?: Registration; row: HomeRow; order: number; first: number; last: number; cleanup?: () => void; keys: Map<string, string>; memberWindows: Map<string, string>; physicalIds?: readonly string[]; retainedIds?: readonly string[]; visible: boolean; visibleIds?: readonly string[]};

/** Genuine default assembly. The controller and playback runtime retain all business state. */
export function createNativeShellBindings(context: NativeShellBootstrapContext): NativeShellBindings {
  const initial = context.home.getSnapshot().document, session = context.session();
  if (!initial || !session || !context.current()) throw failure('native_home_authority_required');
  const routes = nativeShellRoutes.bind(context);
  const feedback = nativeScreenServices(context);
  const scope = nativeHomeSelectionScope(session.viewer);
  let alive = true, runtime: NativeShellRuntime | undefined;
  let tvPageBack: (() => boolean) | undefined, tvRailBack: (() => boolean) | undefined;
  const listeners = new Set<() => void>(), windows = new Map<string, Window>(), spotlights = new Map<ContentEntry, {id: string; key: string; cleanup: () => void; spotlight: HomeSpotlight; index: number; context: string}>(), scroll = new Map<string, () => void>();
  const operations = new Set<AbortController>();
  const publish = () => {if (alive) for (const listener of [...listeners]) listener();};
  const currentHome = () => alive && context.current() && context.navigation.getSnapshot().route.kind === 'shell' && context.navigation.getSnapshot().destination.kind === 'home';
  const isCurrent = (candidate: SelectionContext) => {
    const document = context.home.getSnapshot().document;
    return currentHome() && !!document && same(candidate, homeSelectionContext(scope, document));
  };
  const reportError = (error: unknown, origin: 'assembly-error' | 'home-registration' | 'artwork-error' = 'assembly-error') => {
    homeActionDiagnostics.error(origin, error);
    if (!alive || !context.current()) return;
    feedback.reportError(error, 'home');
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
    requestId: feedback.requestId, playback, reportError,
    routes: {openEntry: entry => open(titleRoute(entry)), openCollection: collection => open({kind: 'home-see-all', destination: {type: 'collection', resourceId: collection.collection.id, libraryId: collection.collection.libraryId}}),
      openDestination: destination => open({kind: 'saved-destination', destination})}});
  const windowId = (rowId: string) => `home-row:${rowId}`;
  const members = new Map<string, Registration & {cleanup: () => void}>();
  let coordinateDocument = initial;
  const coordinates = new Map<HomeRow, number>();
  const registrationContext = () => {
    const document = context.home.getSnapshot().document!;
    if (coordinateDocument !== document || !coordinates.size) {
      coordinateDocument = document; coordinates.clear();
      const visit = (row: HomeRow) => {coordinates.set(row, coordinates.size); for (const child of row.children ?? []) visit(child);};
      for (const row of document.rows) visit(row);
    }
    return JSON.stringify(homeSelectionContext(scope, document));
  };
  const sameRegistration = (before: Registration | undefined, next: Registration) => !!before && before.row === next.row && before.order === next.order
    && before.context === next.context && before.coordinate === next.coordinate && before.first === next.first && before.last === next.last;
  const register = (window: Window, ids?: readonly string[]) => {
    const row = window.row, stamp = registrationContext(), coordinate = coordinates.get(row) ?? -1;
    const count = row.live?.channels.length ?? row.entries.length;
    const first = Math.min(Math.max(0, window.first - 2), Math.max(0, count - 1)), last = Math.min(Math.max(first, window.last + 2), Math.max(0, count - 1));
    const registration = {row, order: window.order, context: stamp, coordinate, first, last};
    if (!Platform.isTV || row.collection) {if (window.cleanup && sameRegistration(window.registration, registration)) return;}
    window.keys.clear(); window.memberWindows.clear();
    // TV presentation may keep a different order while focused. Admission always
    // uses genuine latest document objects in bounded, contiguous one-item windows.
    if (Platform.isTV && window.physicalIds && !row.collection) {
      for (const id of ids ?? []) {
        const index = row.live ? row.live.channels.findIndex(value => JSON.stringify([value.channel.sourceId, value.channel.id]) === id)
          : row.entries.findIndex(value => value.id === id);
        if (index < 0) continue;
        const memberWindow = `home-row-item:${JSON.stringify([row.id, id])}`;
        const entry = row.entries[index], channel = row.live?.channels[index];
        const memberRegistration = {...registration, first: index, last: index};
        const previous = members.get(memberWindow);
        const result = previous && sameRegistration(previous, memberRegistration) ? {ok: true as const, unregister: previous.cleanup} : controller.registerWindow({id: memberWindow, row, sectionOrder: window.order, start: row.start + index,
          ...(channel ? {channels: [channel]} : {entries: [entry]})});
        if (!result.ok) throw failure(result.reason);
        members.set(memberWindow, {...memberRegistration, cleanup: result.unregister});
        const identity = channel ? homeChannelSelection(channel, platform) : homeEntrySelection(entry, platform);
        if (identity) {window.keys.set(id, controller.key(identity)); window.memberWindows.set(id, memberWindow);}
      }
      return;
    }
    const entries = row.entries.slice(first, last + 1), channels = row.live?.channels.slice(first, last + 1);
    const result = controller.registerWindow({id: windowId(row.id), row, sectionOrder: window.order, start: row.start + first,
      ...(channels ? {channels} : row.collection ? {} : {entries})});
    if (!result.ok) throw failure(result.reason);
    const previousCleanup = window.cleanup; window.cleanup = result.unregister; window.registration = registration; previousCleanup?.();
    for (const entry of entries) {const identity = homeEntrySelection(entry, platform); if (identity) window.keys.set(entry.id, controller.key(identity));}
    for (const channel of channels ?? []) window.keys.set(JSON.stringify([channel.channel.sourceId, channel.channel.id]), controller.key(homeChannelSelection(channel, platform)));
    if (row.collection) window.keys.set(row.collection.collection.id, controller.key(homeCollectionSelection(row.collection, platform)));
    for (const id of window.keys.keys()) window.memberWindows.set(id, windowId(row.id));
  };
  const reconcileWindows = (spotlightCount = spotlights.size) => {
    if (!Platform.isTV) {for (const window of windows.values()) register(window); return;}
    const populations = [...windows.values()].map(window => ({id: window.row.id, visible: window.visible, first: window.first, last: window.last,
      physicalIds: window.row.collection ? [window.row.collection.collection.id] : window.physicalIds ?? [], retainedIds: window.retainedIds, visibleIds: window.visibleIds}));
    const plan = planHomeWindows(populations, spotlightCount);
    const desired = new Set<string>();
    for (const window of windows.values()) {
      if (window.row.collection) continue;
      for (const id of plan.get(window.row.id) ?? []) desired.add(`home-row-item:${JSON.stringify([window.row.id, id])}`);
    }
    for (const [id, member] of members) if (!desired.has(id)) {member.cleanup(); members.delete(id);}
    for (const window of windows.values()) {
      if (window.row.collection && !(plan.get(window.row.id)?.length)) {window.cleanup?.(); window.cleanup = undefined; window.keys.clear(); window.memberWindows.clear();}
      else register(window, plan.get(window.row.id));
    }
  };
  const registerSpotlights = (values: readonly HomeSpotlight[]) => {
    const before = new Map([...spotlights.values()].map(value => [value.id, value]));
    spotlights.clear();
    const offeredIds = new Set(values.map(value => {const identity = homeEntrySelection(value.entry, platform);
      return identity ? `home-spotlight:${JSON.stringify([identity.kind, 'libraryId' in identity ? identity.libraryId : '', 'id' in identity ? identity.id : ''])}` : undefined;}));
    for (const [id, value] of before) if (!offeredIds.has(id)) {value.cleanup(); before.delete(id);}
    reconcileWindows(values.length);
    for (const [index, spotlight] of values.entries()) {
      const identity = homeEntrySelection(spotlight.entry, platform); if (!identity) continue;
      const id = `home-spotlight:${JSON.stringify([identity.kind, 'libraryId' in identity ? identity.libraryId : '', 'id' in identity ? identity.id : ''])}`;
      const previous = before.get(id), stamp = registrationContext();
      if (previous?.spotlight === spotlight && previous.index === index && previous.context === stamp) {spotlights.set(spotlight.entry, previous); before.delete(id); continue;}
      const result = controller.registerSpotlight({id, spotlight});
      if (!result.ok) throw failure(result.reason);
      spotlights.set(spotlight.entry, {id, key: controller.key(identity), cleanup: result.unregister, spotlight, index, context: stamp});
      before.get(id)?.cleanup(); before.delete(id);
    }
    for (const value of before.values()) value.cleanup();
  };
  registerSpotlights(initial.spotlight);
  const find = (entry: ContentEntry, rowId?: string) => {
    const spotlight = spotlights.get(entry) ?? [...spotlights].find(([value]) => value.id === entry.id && value.libraryId === entry.libraryId && value.kind === entry.kind)?.[1]; if (!rowId && spotlight) return spotlight;
    const window = rowId ? windows.get(rowId) : [...windows.values()].find(value => value.row.entries.includes(entry));
    const key = window?.keys.get(entry.id); if (!window || !key) throw failure('unregistered_home_entry');
    return {id: window.memberWindows.get(entry.id)!, key};
  };
  const menu = (entry: ContentEntry, rowId?: string) => {homeActionDiagnostics.action('home-assembly', 'menu'); if (!currentHome()) return; const member = find(entry, rowId); controller.openMenu(member.id, member.key);};
  const onDocument = () => {
    if (!alive || !context.current()) return;
    const document = context.home.getSnapshot().document;
    if (!document || document.serverId !== scope.serverId || document.viewerFence !== context.authority().viewerFence) return;
    const next = homeSelectionContext(scope, document);
    if (!same(next, controller.getSnapshot().context)) {controller.setContext(next, environment());}
    if (!currentHome()) return;
    for (const [id, window] of windows) {
      const row = document.rows.find(value => value.id === id);
      if (!row) {window.cleanup?.(); windows.delete(id);} else window.row = row;
    }
    registerSpotlights(document.spotlight); reconcileWindows(); publish();
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
      if (routes.back()) return true;
      if (context.playback.getSnapshot().dock.local?.expanded) return false;
      // Menus/selection own Back first, then the player, then the page.
      if (Platform.isTV && tvRailBack?.()) return true;
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
  const render = (route: NativeShellRoute) => runtime && context.current() ? routes.render(route, runtime) : null;
  const ownerTag = <OwnerTag audience="owner" variant="badge"/>;
  return {get account() {return nativeAccountMenu(context.account, open, Platform.isTV);}, attach: value => {runtime = value;},
    getState: () => {const state = controller.getSnapshot(), navigation = context.navigation.getSnapshot(); return {destination: navigation.destination,
      railDestination: nativeRailDestination(navigation, context.libraries()), contentVisible: navigation.route.kind === 'shell', selectionActive: state.selection.active,
      homeVisible: currentHome(), homeObscured: !!(state.menu || state.picker || state.editor || state.deletion || state.rating || state.mixedEdit)};},
    subscribe: listener => {listeners.add(listener); return () => {listeners.delete(listener);};},
    actions: {
      navigate: entry => {if (currentHome()) open(titleRoute(entry));},
      play: (entry, target) => {
        homeActionDiagnostics.action('home-assembly', 'primary-play');
        if (!currentHome() || !homeEntryCapabilities(entry, platform).playable) {homeActionDiagnostics.action('home-assembly', 'primary-play', 'guard-refused'); return;}
        const document = context.home.getSnapshot().document!;
        const offered = homeSpotlightModels(document).some(value => value.entry === entry && same(value.primary?.entry.playback, target)) || document.rows.some(row => row.entries.includes(entry) && same(homePlayTarget(row, entry)?.playback, target));
        if (!offered) {homeActionDiagnostics.action('home-assembly', 'primary-play', 'unoffered'); reportError(failure('unoffered_home_playback')); return;}
        homeActionDiagnostics.action('home-assembly', 'primary-play', 'dispatch');
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
        controller.openMenu(window.memberWindows.get(JSON.stringify([channel.channel.sourceId, channel.channel.id]))!, key);
      },
      collectionMore: (collection, rowId) => {const window = windows.get(rowId), key = window?.keys.get(collection.collection.id); if (window && key && currentHome()) controller.openMenu(window.memberWindows.get(collection.collection.id)!, key);},
      seeAll: destination => open({kind: 'home-see-all', destination}), customize: () => open({kind: 'home-customize'}),
    },
    selection: rowId => ({active: controller.getSnapshot().selection.active,
      isSelected: id => {const key = windows.get(rowId)?.keys.get(id); return !!key && controller.selection.isSelected(key);},
      onToggle: id => {const key = windows.get(rowId)?.keys.get(id); if (key && currentHome()) controller.toggle(windows.get(rowId)!.memberWindows.get(id)!, key);},
      onEnter: id => {
        const key = windows.get(rowId)?.keys.get(id); if (!key || !currentHome()) return;
        const before = controller.getSnapshot().selection.active, changed = controller.toggle(windows.get(rowId)!.memberWindows.get(id)!, key);
        if (changed.ok && !before && controller.getSnapshot().selection.active) void selectionHaptic().catch(reportError);
      }}),
    setHomeWindow: (row, order, first, last, visible, physicalIds, retainedIds, visibleIds) => {
      const before = windows.get(row.id);
      if ((!visible && !retainedIds?.length) || !currentHome()) {if (!before) return; before.cleanup?.(); windows.delete(row.id); reconcileWindows(); return;}
      const latest = context.home.getSnapshot().document?.rows.find(value => value.id === row.id);
      if (!latest) return;
      if (before?.row === latest && before.order === order && before.first === first && before.last === last && before.visible === visible && same(before.physicalIds, physicalIds) && same(before.retainedIds, retainedIds) && same(before.visibleIds, visibleIds)) return;
      const window = before ?? {row: latest, order, first, last, visible, keys: new Map(), memberWindows: new Map()};
      Object.assign(window, {row: latest, order, first, last, visible, physicalIds, retainedIds, visibleIds}); windows.set(row.id, window);
      try {reconcileWindows();} catch (error) {reportError(error, 'home-registration');}
    },
    homeMenuRow: id => [...windows.values()].find(window => [...window.memberWindows.values()].includes(id))?.row,
    renderSelection: () => <><HomeSelectionBars runtime={runtime} controller={controller} ownerTag={ownerTag} reportError={reportError}/><HomeSelectionOverlays controller={controller} runtime={runtime} ownerTag={ownerTag} reportError={reportError}/><NativeScreenFeedbackHost service={feedback} bottomOffset={84}/></>,
    renderRoutes: () => {
      const route = context.navigation.getSnapshot().route;
      // Instantiate the current module before asking it for retained native views.
      const active = route.kind === 'shell' ? null : render(route);
      return runtime && context.current() ? <View pointerEvents="box-none" style={{position: 'absolute', inset: 0}}>{routes.renderRetained(runtime)}{active}{routes.renderOverlays(runtime)}</View> : null;
    },
    renderDestination: destination => render({kind: 'shell', destination}),
    renderWatch: () => runtime ? routes.renderWatch(runtime) : null,
    renderHomeEmpty: () => <StateView variant="centered" title={t('web.empty.homeTitle')} body={t(context.account.account.role === 'owner' ? 'web.empty.homeOwnerBody' : 'web.empty.homeMemberBody')}/>,
    libraryMenu: library => {
      const common = {read: isReadingLibraryKind(library.kind), onSaveView: () => open({kind: 'library-save-view', libraryId: library.id}),
        onMarkAll: () => open({kind: 'library-mark-all', libraryId: library.id}), onEditPins: () => open({kind: 'library-edit-pins', libraryId: library.id})};
      return management ? {...common, owner: true as const, ownerTag, onLibrarySettings: () => open({kind: 'library-settings', libraryId: library.id}), onScan: () => run(async () => {
        if (!context.current()) return; await management.selectLibrary(library.id);
        if (!context.current()) return;
        if (management.getSnapshot().selected.data?.scope.viewerFence !== context.authority().viewerFence) throw failure('viewer_scope_changed');
        await management.scan(); const result = management.getSnapshot().mutation;
        if (result.error) throw failure(result.error.code);
      })} : {...common, owner: false as const};
    },
    error: (error, retry) => feedback.error(error, retry, 'home'),
    reportError, onDestination: destination => open({kind: 'shell', destination}),
    scrollToTop: destination => {if (context.current()) {const handler = scroll.get(JSON.stringify(destination)); if (handler) handler(); else {const route = context.navigation.getSnapshot().route; routes.scrollToTop(route);}}},
    registerScrollToTop: (destination, handler) => {const key = JSON.stringify(destination); scroll.set(key, handler); return () => {if (scroll.get(key) === handler) scroll.delete(key);};},
    registerTVRailBack: handler => {tvRailBack = handler; return () => {if (tvRailBack === handler) tvRailBack = undefined;};},
    registerTVPageBack: handler => {tvPageBack = handler; return () => {if (tvPageBack === handler) tvPageBack = undefined;};},
    onArtworkError: error => reportError(error, 'artwork-error'),
    dispose: () => {if (!alive) return; alive = false; routes.dispose(); for (const operation of operations) operation.abort(); operations.clear(); for (const cleanup of cleanups) cleanup(); for (const member of members.values()) member.cleanup(); members.clear(); for (const window of windows.values()) window.cleanup?.(); for (const spotlight of spotlights.values()) spotlight.cleanup(); windows.clear(); spotlights.clear(); controller.dispose(); management?.dispose(); scroll.clear(); runtime = undefined; listeners.clear();},
  };
}
