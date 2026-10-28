import React, {useState, useSyncExternalStore} from 'react';
import {Text, View} from 'react-native';
import {useSafeAreaInsets} from 'react-native-safe-area-context';
import {defaultI18n} from '../../../../../packages/i18n/src';
import type {ContentEntry} from '../../../../../packages/client-core/src/library-content';
import type {SearchEntry} from '../../../../../packages/client-core/src/search';
import {SelectionModel, BrowseSelectionModel, selectionKey, browseSelectionKey, selectionFourthAction, readCatalogueSelectionItem, playCatalogueSelection, enqueueCatalogueSelection, createCataloguePersonalSelection,
  type SelectionContext, type BrowseSelectionContext, type SelectionSnapshot, type SelectionWindow, type SelectionItem} from '../../../../../packages/client-core/src/selection-model';
import type {NativeShellBootstrapContext} from '../../shell/bootstrap';
import {selectedItemsLabel} from '../../shell/selection-display';
import {SelectionBar, SelectionPhoneActionBar, type SelectionActionOffer, type SelectionBarProps} from '../../kit/selection';
import {useTheme} from '../../kit/theme';
import {Dialog} from '../../kit/overlays';
import {Button} from '../../kit/controls';
import {presentError} from '../../../../../packages/client-core/src/presentation/errors';
import {mediaSelectionKey} from '../../../../../packages/client-core/src/media-selection';
import {nativeDestinationLifetime} from '../destinations/lifetime';
import type {NativeDestinationActivationPort} from '../destinations/focus';
import {nativeScreenServices} from '../native-screen-services';
import type {NativeSearchDestination} from './model';
import type {NativeSearchSelectionPort} from './types';
import {NativeLoadedDestinations} from './loaded-destinations';
import {NativeDestinationPicker} from '../destinations/DestinationPicker';
import {NativeBulkMedia} from '../destinations/bulk-media';
import {BulkEditor, DeleteMediaDialog} from '../../kit/selection';

const leaf = (entry: SearchEntry): entry is ContentEntry => ['movie', 'episode', 'song', 'audiobook_file'].includes(entry.kind);
const cancelled = () => Object.assign(new Error('cancelled'), {name: 'AbortError', code: 'cancelled'});
const unavailable = () => Object.assign(new Error('catalogue-selection-unavailable'), {code: 'catalogue-selection-unavailable'});

/** A route supplies its actual producer context and loaded membership. Detail supplies
 * grants for explicit leaves; it never substitutes a different screen's source fence. */
export type NativePageSelectionSource = Readonly<{
  subscribe: (listener: () => void) => () => void;
  current: () => boolean;
  getSnapshot: () => Readonly<{context?: SelectionContext | BrowseSelectionContext; groups: readonly Readonly<{id: string; status: 'success' | 'error'; offset?: number; positions?: readonly number[]; items: readonly SearchEntry[]}>[]}>;
}>;
export type NativePageSelection = ReturnType<typeof createNativePageSelection>;
/** Preserve each producer's context domain; Browse revisions have no privacy fence. */
function pageSelectionModel(context: SelectionContext | BrowseSelectionContext) {
  const model = 'privacyFence' in context.scope
    ? new SelectionModel(context as SelectionContext, {maxWindows: 256, maxRegisteredItems: 256})
    : new BrowseSelectionModel(context as BrowseSelectionContext, {maxWindows: 256, maxRegisteredItems: 256});
  return {
    subscribe: (listener: () => void) => model.subscribe(listener), getSnapshot: () => model.getSnapshot(),
    registerWindow: (window: SelectionWindow) => model instanceof BrowseSelectionModel
      ? model.registerWindow(model.captureContext(), window) : model.registerWindow(model.captureContext(), window),
    key: (item: SelectionItem) => model instanceof BrowseSelectionModel
      ? browseSelectionKey(model.getSnapshot().context.scope, item) : selectionKey(model.getSnapshot().context.scope, item),
    toggle: (window: string, key: string) => model.toggle(window, key), clear: () => model.clear(), dispose: () => model.dispose(),
    captureOperation: () => {
      if (model instanceof BrowseSelectionModel) {const operation = model.captureOperation(); return operation && {target: operation.target, current: () => model.isOperationCurrent(operation)};}
      const operation = model.captureOperation(); return operation && {target: operation.target, current: () => model.isOperationCurrent(operation)};
    },
  };
}

const entryKey = (group: string, entry: SearchEntry) => JSON.stringify([group, entry.kind, 'libraryId' in entry ? entry.libraryId : '', entry.id]);

/** Search keeps its own query/generation context and existing explicit-selection UX. */
export function createNativeSearchSelection(context: NativeShellBootstrapContext, source: NativeSearchDestination,
  activation: NativeDestinationActivationPort) {
  return createNativePageSelection(context, {
    subscribe: listener => {const stops = [source.subscribe(listener), activation.subscribe(listener)]; return () => stops.forEach(stop => stop());},
    current: () => activation.getSnapshot().visible,
    getSnapshot: () => {
      const snapshot = source.getSnapshot(), page = snapshot.search.data, viewer = context.session()?.viewer;
      const viewId = JSON.stringify(['native-search', snapshot.search.generation, page?.query]);
      const captured: SelectionContext | undefined = snapshot.search.phase === 'ready' && page && viewer &&
        (viewer.authority === 'local' || viewer.authority === 'hosted') && viewId.length <= 4096
        ? {scope: {serverId: viewer.serverId, authority: viewer.authority, accountId: viewer.accountId, profileId: viewer.profileId,
          viewId, privacyFence: page.scope.viewerFence}, revision: {catalogRevision: String(page.revision.catalog), viewerRevision: String(page.revision.viewer)}} : undefined;
      return {context: captured, groups: snapshot.groups};
    },
  }, {selectAll: true});
}

export function createNativePageSelection(context: NativeShellBootstrapContext, source: NativePageSelectionSource,
  options: Readonly<{selectAll?: boolean; aggregates?: boolean; preserveEvicted?: boolean}> = {}) {
  const authority = nativeDestinationLifetime(context), feedback = nativeScreenServices(context);
  const listeners = new Set<() => void>(), windows = new Map<string, {key: string; windowId: string; item: SelectionItem; entry: SearchEntry; group: string; unregister: () => void}>();
  let model: ReturnType<typeof pageSelectionModel> | undefined, stopModel: (() => void) | undefined, token = '', revision = 0, windowSequence = 0, disposed = false;
  let pending: AbortController | undefined, batchGeneration = 0;
  let stopPlayback: (() => void) | undefined;
  let personal: ReturnType<typeof createCataloguePersonalSelection> | undefined, stopPersonal: (() => void) | undefined;
  let personalController: AbortController | undefined, personalCurrent: (() => boolean) | undefined;
  let destinations: NativeLoadedDestinations | undefined, destinationKind: 'playlist' | 'collection' | undefined;
  let destinationController: AbortController | undefined, stopDestinations: (() => void) | undefined;
  let bulk: NativeBulkMedia | undefined, bulkController: AbortController | undefined, stopBulk: (() => void) | undefined;
  const closePersonal = () => {personalController?.abort(); personalController = undefined; stopPersonal?.(); stopPersonal = undefined; personal?.dispose(); personal = undefined; personalCurrent = undefined;};
  const closeBulk = () => {bulkController?.abort(); bulkController = undefined; stopBulk?.(); stopBulk = undefined; bulk?.dispose(); bulk = undefined;};
  const closeDestinations = () => {destinationController?.abort(); destinationController = undefined; stopDestinations?.(); stopDestinations = undefined;
    destinations?.dispose(); destinations = undefined; destinationKind = undefined;};
  const emit = () => {revision++; for (const listener of [...listeners]) listener();};
  const keyFor = (snapshot: ReturnType<NativePageSelectionSource['getSnapshot']>) => snapshot.context ? JSON.stringify(snapshot.context) : '';
  const visible = () => !disposed && authority.current() && source.current();
  const selectable = (entry: SearchEntry): entry is ContentEntry => leaf(entry) || options.aggregates === true && 'libraryId' in entry &&
    !!entry.libraryId && ['show', 'season', 'album', 'artist', 'book', 'collection'].includes(entry.kind);
  const queueControl = () => {
    const role = context.playback.getSnapshot().session?.role;
    return role === undefined || role === 'local';
  };
  const reset = () => {
    batchGeneration++; closePersonal(); closeDestinations(); closeBulk();
    stopPlayback?.(); stopPlayback = undefined;
    pending?.abort(); pending = undefined; stopModel?.(); stopModel = undefined;
    model?.dispose(); model = undefined; windows.clear(); token = ''; emit();
  };
  const reconcile = () => {
    const snapshot = source.getSnapshot(), next = visible() ? keyFor(snapshot) : '';
    if (next === token) {
      const missing = [...windows].filter(([, window]) => !snapshot.groups.some(group =>
        group.id === window.group && group.status === 'success' && group.items.includes(window.entry)));
      if (!missing.length || options.preserveEvicted) {
        // Only declared bounded producers retain explicit picks across ordinary
        // window eviction. Search still retires selection on membership loss.
        const selected = model?.getSnapshot().selectedKeys ?? [];
        for (const [id, window] of missing) if (!selected.includes(window.key)) {
          window.unregister(); windows.delete(id);
        }
        return;
      }
    }
    reset();
    if (!next || !snapshot.context) return;
    const viewer = context.session()?.viewer;
    if (!viewer || viewer.authority !== 'local' && viewer.authority !== 'hosted') return;
    const captured = snapshot.context;
    if (captured.scope.serverId !== viewer.serverId || captured.scope.authority !== viewer.authority || captured.scope.accountId !== viewer.accountId
      || captured.scope.profileId !== viewer.profileId || captured.scope.viewId.length > 4096) return;
    model = pageSelectionModel(captured); token = next;
    stopModel = model.subscribe(emit); emit();
  };
  const contains = (group: string, entry: SearchEntry) => visible() && source.getSnapshot().groups.some(result =>
    result.id === group && result.status === 'success' && result.items.includes(entry));
  const registeredFor = (group: string, entry: SearchEntry) => windows.get(entryKey(group, entry)) ?? [...windows.values()].find(window =>
    window.entry.id === entry.id && window.entry.kind === entry.kind && 'libraryId' in window.entry && 'libraryId' in entry && window.entry.libraryId === entry.libraryId);
  const selectedLeaves = (keys: readonly string[]) => keys.flatMap(key => {
    const window = [...windows.values()].find(value => value.key === key);
    return window && leaf(window.entry) ? [window.entry] : [];
  });
  const pick = async (group: string, entry: SearchEntry, batch?: number) => {
    if (batch === undefined) batchGeneration++;
    else if (batch !== batchGeneration) return;
    reconcile();
    const currentModel = model;
    if (!currentModel || pending || personal || !selectable(entry) || !contains(group, entry)) return;
    const id = entryKey(group, entry), registered = registeredFor(group, entry);
    if (registered) {currentModel.toggle(registered.windowId, registered.key); return;}
    if (windows.size >= 256) {feedback.reportError(unavailable(), 'search'); return;}
    const controller = new AbortController(), captured = token, route = context.navigation.getSnapshot().revision;
    pending = controller; emit();
    const current = () => !controller.signal.aborted && visible() && model === currentModel && token === captured
      && keyFor(source.getSnapshot()) === captured && context.navigation.getSnapshot().revision === route && contains(group, entry);
    try {
      observePlayback();
      const port = context.playback.cataloguePlayback?.();
      const item = await readCatalogueSelectionItem({api: context.api, scope: authority.scope, requestId: feedback.requestId,
        signal: controller.signal, isCurrent: current}, entry, {play: !!port, queue: !!port && queueControl(),
          ...(leaf(entry) ? {myList: true, favorite: true, watched: true, edit: true, delete: true} : {})});
      if (!current()) throw cancelled();
      const groups = source.getSnapshot().groups, sectionOrder = groups.findIndex(result => result.id === group);
      const section = groups[sectionOrder], index = section.items.indexOf(entry);
      const start = section.positions ? section.positions[index] : (section.offset ?? 0) + index;
      if (typeof start !== 'number' || !Number.isSafeInteger(start) || start < 0) throw unavailable();
      const windowId = `search-${++windowSequence}`;
      const registration = currentModel.registerWindow({id: windowId, sectionId: group, sectionOrder,
        start, items: [item]});
      if (!registration.ok) throw unavailable();
      const key = currentModel.key(item);
      windows.set(id, {key, windowId, item, entry, group, unregister: registration.unregister});
      const selected = currentModel.toggle(windowId, key);
      if (!selected.ok) throw unavailable();
    } catch (error) {if (current()) feedback.reportError(error, 'search');}
    finally {if (pending === controller) {pending = undefined; emit();}}
  };
  const distinctLeaves = () => {
    const rows = source.getSnapshot().groups.filter(group => group.status === 'success').flatMap(group =>
      group.items.filter(leaf).map(entry => ({group: group.id, entry})));
    return [...new Map(rows.map(row => [JSON.stringify([row.entry.libraryId, row.entry.kind, row.entry.id]), row])).values()];
  };
  const selectLoaded = async () => {
    if (personal) return;
    reconcile();
    const batch = ++batchGeneration;
    pending?.abort(); pending = undefined;
    if (!model || !visible()) return;
    const captured = token, currentModel = model, route = context.navigation.getSnapshot().revision;
    const current = () => batchGeneration === batch && visible() && token === captured && model === currentModel
      && context.navigation.getSnapshot().revision === route && keyFor(source.getSnapshot()) === captured;
    const unique = distinctLeaves();
    if (unique.length > 256) {feedback.reportError(unavailable(), 'search'); return;}
    for (const row of unique) {
      if (!current()) return;
      const registered = registeredFor(row.group, row.entry);
      if (registered && currentModel.getSnapshot().selectedKeys.includes(registered.key)) continue;
      await pick(row.group, row.entry, batch);
      if (!current()) return;
    }
  };
  const execute = async (action: 'play' | 'playNext' | 'playLater') => {
    batchGeneration++;
    reconcile();
    const currentModel = model, operation = currentModel?.captureOperation();
    if (!currentModel || !operation || operation.target.mode !== 'explicit' || pending || personal || !visible()) return;
    const controller = new AbortController(), captured = token, route = context.navigation.getSnapshot().revision;
    const queue = action !== 'play';
    const current = () => !controller.signal.aborted && visible() && model === currentModel && token === captured
      && keyFor(source.getSnapshot()) === captured && context.navigation.getSnapshot().revision === route
      && operation.current() && operation.target.mode === 'explicit'
      && operation.target.items.every(pick => [...windows.values()].some(window => window.key === pick.key))
      && (!queue || queueControl());
    pending = controller; emit();
    try {
      const port = context.playback.cataloguePlayback?.();
      if (!port || !current()) throw unavailable();
      const target = operation.target;
      const items = (queue ? target.items : target.displayItems).map(value => value.item);
      if (queue) await enqueueCatalogueSelection(port, items, action === 'playNext' ? 'next' : 'end', {signal: controller.signal, isCurrent: current});
      else await playCatalogueSelection(port, items, {signal: controller.signal, isCurrent: current});
      if (current()) currentModel.clear();
    } catch (error) {if (current()) feedback.reportError(error, 'search');}
    finally {if (pending === controller) {pending = undefined; emit();}}
  };
  const applyPersonal = async (action: 'myList' | 'removeMyList' | 'favorite' | 'watched' | 'unwatched') => {
    batchGeneration++; reconcile();
    const currentModel = model, operation = currentModel?.captureOperation();
    if (!currentModel || !operation || operation.target.mode !== 'explicit' || pending || personal || !visible()) return;
    const capability = action === 'myList' || action === 'removeMyList' ? 'myList' : action === 'favorite' ? 'favorite' : 'watched';
    if (!operation.target.items.every(pick => pick.item.capabilities[capability])) return;
    const captured = token, route = context.navigation.getSnapshot().revision, controller = new AbortController();
    const current = () => !controller.signal.aborted && visible() && model === currentModel && token === captured
      && keyFor(source.getSnapshot()) === captured && context.navigation.getSnapshot().revision === route
      && operation.current() && operation.target.mode === 'explicit'
      && operation.target.items.every(pick => [...windows.values()].some(window => window.key === pick.key));
    const entries = operation.target.items.flatMap(pick => {
      const window = [...windows.values()].find(value => value.key === pick.key);
      return window && leaf(window.entry) ? [window.entry] : [];
    });
    if (entries.length !== operation.target.items.length || !current()) return;
    personalController = controller; personalCurrent = current;
    personal = createCataloguePersonalSelection({api: context.api, scope: authority.scope, requestId: feedback.requestId,
      signal: controller.signal, isCurrent: current});
    stopPersonal = personal.service.subscribe(emit);
    personal.service.setEntries(entries); personal.service.begin();
    for (const entry of entries) personal.service.toggle(mediaSelectionKey(entry));
    emit();
    try {await personal.service.apply(capability === 'myList' ? 'watchlist' : capability, action !== 'removeMyList' && action !== 'unwatched');}
    catch (error) {if (current()) feedback.reportError(error, 'search');}
    finally {emit();}
  };
  const retryPersonal = async () => {
    if (!personal || !personalCurrent?.() || personal.service.getSnapshot().busy) return;
    try {await personal.service.retry();}
    catch (error) {if (personalCurrent?.()) feedback.reportError(error, 'search');}
  };
  /** The bounded direct Saved destination picker for exactly the selected leaves. */
  const openDestination = (kind: 'playlist' | 'collection') => {
    if (!model || !visible() || pending || personal || destinations) return;
    const state = model.getSnapshot();
    if (!state.active || !state.selectedKeys.length) return;
    const selected = selectedLeaves(state.selectedKeys);
    if (selected.length !== state.selectedKeys.length) return;
    const captured = token, currentModel = model, route = context.navigation.getSnapshot().revision;
    const controller = new AbortController();
    const current = () => !controller.signal.aborted && visible() && model === currentModel && token === captured
      && context.navigation.getSnapshot().revision === route && keyFor(source.getSnapshot()) === captured
      && currentModel.getSnapshot().active;
    destinationController = controller;
    destinations = new NativeLoadedDestinations({api: context.api, scope: authority.scope, requestId: feedback.requestId, viewerFence: context.authority().viewerFence,
      signal: controller.signal, isCurrent: current}, selected);
    destinationKind = kind;
    stopDestinations = destinations.subscribe(emit);
    void destinations.load(kind).catch(error => {if (current()) feedback.reportError(error, 'search');});
    emit();
  };
  /** One admin dialog at a time, over exactly the selected leaves and the captured view fence. */
  const openAdmin = (kind: 'edit' | 'delete') => {
    if (!model || !visible() || pending || personal || destinations || bulk) return;
    const state = model.getSnapshot();
    if (!state.active || !state.selectedKeys.length) return;
    const selected = selectedLeaves(state.selectedKeys);
    if (selected.length !== state.selectedKeys.length) return;
    const captured = token, currentModel = model, route = context.navigation.getSnapshot().revision;
    const controller = new AbortController();
    const current = () => !controller.signal.aborted && visible() && model === currentModel && token === captured
      && context.navigation.getSnapshot().revision === route && currentModel.getSnapshot().active;
    bulkController = controller;
    bulk = new NativeBulkMedia({api: context.api, scope: authority.scope, requestId: feedback.requestId, signal: controller.signal, isCurrent: current}, selected);
    stopBulk = bulk.subscribe(emit);
    void (kind === 'edit' ? bulk.openEditor() : bulk.openDelete()).catch(error => {if (current()) feedback.reportError(error, 'detail');});
    emit();
  };
  let lastQueueControl: boolean | undefined;
  const queueChanged = () => {
    const next = queueControl();
    if (next === lastQueueControl) return;
    lastQueueControl = next;
    pending?.abort(); emit();
  };
  const observePlayback = () => {
    if (stopPlayback) return;
    lastQueueControl = queueControl();
    stopPlayback = context.playback.subscribe(queueChanged);
  };
  const off = [source.subscribe(reconcile), context.subscribeAuthority(reconcile),
    context.navigation.subscribe(() => {batchGeneration++; pending?.abort(); reconcile();})];
  reconcile();
  const store = {selectAll: options.selectAll === true, leavesOnly: () => !!model && [...windows.values()].filter(window => model!.getSnapshot().selectedKeys.includes(window.key)).every(window => leaf(window.entry)),
    subscribe: (listener: () => void) => {listeners.add(listener); return () => {listeners.delete(listener);};},
    getSnapshot: () => revision, loadedCount: () => distinctLeaves().length, snapshot: () => model?.getSnapshot(), personal: () => personal?.service.getSnapshot(), busy: () => !!pending || !!personal?.service.getSnapshot().busy, queueControl,
    clear: () => {if (personal?.service.getSnapshot().busy || destinations?.snapshot().busy || bulk?.getSnapshot().phase === 'saving') return false; batchGeneration++; pending?.abort(); closePersonal(); closeDestinations(); model?.clear(); emit(); return true;}, selectLoaded, execute, applyPersonal, retryPersonal,
    openDestination, closeDestinations, destination: () => destinations, destinationKind: () => destinationKind, openAdmin, closeBulk, bulk: () => bulk,
    entries: () => [...windows.values()].flatMap(window => leaf(window.entry) ? [window.entry] : [])};
  const port: Omit<NativeSearchSelectionPort, 'item'> & {item: (group: string, entry: SearchEntry) => ReturnType<NativeSearchSelectionPort['item']>} = {
    register: () => {reconcile(); return () => {};},
    item: (group, entry) => {
      if (!model || !selectable(entry) || !contains(group, entry)) return undefined;
      const drawnModel = model, drawnToken = token, snapshot = model.getSnapshot(), registered = registeredFor(group, entry);
      const toggle = () => {if (model === drawnModel && token === drawnToken && keyFor(source.getSnapshot()) === drawnToken && contains(group, entry)) void pick(group, entry);};
      return {active: snapshot.active, selected: !!registered && snapshot.selectedKeys.includes(registered.key), onEnter: toggle, onToggle: toggle};
    },
    render: artwork => <SearchSelectionBars store={store} artwork={artwork}/>,
  };
  return Object.freeze({...port, subscribe: store.subscribe, getSnapshot: store.getSnapshot, clear: store.clear,
    dispose: () => {if (disposed) return; disposed = true; off.forEach(stop => stop()); reset(); listeners.clear();}});
}

type Store = {selectAll: boolean; leavesOnly(): boolean; subscribe(listener: () => void): () => void; getSnapshot(): number; snapshot(): SelectionSnapshot<SelectionContext | BrowseSelectionContext> | undefined;
  personal(): ReturnType<ReturnType<typeof createCataloguePersonalSelection>['service']['getSnapshot']> | undefined;
  applyPersonal(action: 'myList' | 'removeMyList' | 'favorite' | 'watched' | 'unwatched'): Promise<void>; retryPersonal(): Promise<void>;
  loadedCount(): number; busy(): boolean; queueControl(): boolean; clear(): void; selectLoaded(): Promise<void>; execute(action: 'play' | 'playNext' | 'playLater'): Promise<void>;
  openDestination(kind: 'playlist' | 'collection'): void; closeDestinations(): void; destination(): NativeLoadedDestinations | undefined; destinationKind(): 'playlist' | 'collection' | undefined;
  openAdmin(kind: 'edit' | 'delete'): void; closeBulk(): void; bulk(): NativeBulkMedia | undefined; entries(): readonly ContentEntry[]};
function SearchSelectionBars({store, artwork}: {store: Store; artwork: (path?: string) => React.ReactNode}) {
  useSyncExternalStore(store.subscribe, store.getSnapshot);
  const theme = useTheme(), insets = useSafeAreaInsets(), [menu, setMenu] = useState<SelectionBarProps['menu']>(null);
  const state = store.snapshot();
  if (!state?.active) return null;
  const actions: SelectionActionOffer[] = [];
  if (state.summary.every.play) actions.push({id: 'play', disabled: store.busy()});
  if (state.summary.every.queue && store.queueControl()) actions.push({id: 'queue', disabled: store.busy()},
    {id: 'playNext', disabled: store.busy()}, {id: 'playLater', disabled: store.busy()});
  if (state.summary.every.myList) actions.push({id: 'myList', disabled: store.busy()}, {id: 'removeMyList', disabled: store.busy()});
  if (state.summary.every.favorite) actions.push({id: 'favorite', disabled: store.busy()});
  // The bounded direct Saved pickers are offered for an explicit leaf selection; the
  // controller re-reads every leaf's own Detail grant before it writes anything.
  if (state.summary.count > 0 && store.leavesOnly()) actions.push({id: 'playlist', disabled: store.busy()}, {id: 'collection', disabled: store.busy()});
  if (state.summary.every.edit) actions.push({id: 'edit', disabled: store.busy()});
  if (state.summary.every.delete) actions.push({id: 'delete', disabled: store.busy()});
  if (state.summary.every.watched) actions.push({id: 'watched', disabled: store.busy()}, {id: 'unwatched', disabled: store.busy()});
  if (actions.some(action => ['removeMyList', 'favorite', 'watched', 'unwatched', 'edit', 'delete'].includes(action.id))) actions.push({id: 'more', disabled: store.busy()});
  const personal = store.personal();
  const props: SelectionBarProps = {count: state.summary.count, selectionLabel: selectedItemsLabel(state.summary),
    ...(store.selectAll ? {selectAllLabel: defaultI18n.t('next.selection.selectAll', {count: store.loadedCount()}), onSelectAll: () => {void store.selectLoaded();}} : {}), onCancel: () => {setMenu(null); store.clear();},
    actions, menu, onMenuChange: setMenu, topInset: insets.top, fourthSlot: selectionFourthAction(state.summary) === 'mark-watched' ? 'watched' : 'myList',
    onAction: action => {if (action === 'play' || action === 'playNext' || action === 'playLater') {setMenu(null); void store.execute(action);}
      else if (action === 'myList' || action === 'removeMyList' || action === 'favorite' || action === 'watched' || action === 'unwatched') {setMenu(null); void store.applyPersonal(action);}
      else if (action === 'playlist' || action === 'collection') {setMenu(null); store.openDestination(action);}
      else if (action === 'edit' || action === 'delete') {setMenu(null); store.openAdmin(action);}}};
  const destination = store.destination(), destinationKind = store.destinationKind();
  const bulk = store.bulk(), bulkState = bulk?.getSnapshot();
  const bulkSummary: readonly {id: string; text: string}[] = bulkState ? Object.entries(bulkState.changes).flatMap(([field, change]) => {
    const spec = bulkState.preview?.schema.find(candidate => candidate.field === field);
    if (!spec) return [];
    if ('value' in change) return [{id: field, text: `${spec.label}: ${change.value || defaultI18n.t('next.selection.native.notSet')}`}];
    const parts: string[] = [];
    if (change.add.length) parts.push(`+${defaultI18n.list(change.add)}`);
    if (change.remove.length) parts.push(`−${defaultI18n.list(change.remove)}`);
    return parts.length ? [{id: field, text: `${spec.label}: ${parts.join(' · ')}`}] : [];
  }) : [];
  return <><View pointerEvents="box-none" style={{position: 'absolute', inset: 0, zIndex: theme.layers.navigation + 1}}>
    <View style={theme.isTV ? {position: 'absolute', left: 200, right: 96, top: 58} : undefined}><SelectionBar {...props}/></View>
    {!theme.isTV && <View style={{position: 'absolute', left: 0, right: 0, bottom: 0}}><SelectionPhoneActionBar {...props} bottomInset={Math.max(34, insets.bottom)}/></View>}
  </View>
    {personal && <Dialog testID="search-personal-results" open title={defaultI18n.t('next.selection.selectedItems', {items: selectedItemsLabel(state.summary)})}
      onOpenChange={open => {if (!open && !personal.busy) store.clear();}}
      footer={<><Button focusId="done" disabled={personal.busy} onPress={store.clear}>{defaultI18n.t('next.selection.done')}</Button>
        {personal.results.some(result => result.status === 'failed') && <Button focusId="retry" disabled={personal.busy} onPress={() => {void store.retryPersonal();}}>{defaultI18n.t('next.selection.retry')}</Button>}</>}>
      {personal.results.map(result => <View key={result.key} style={{gap: 4, marginBottom: 12}}>
        <Text style={[theme.type.bodyStrong, {color: theme.colors.text}]}>{result.title}</Text>
        <Text style={[theme.type.body, {color: theme.colors.textSecondary}]}>{result.status === 'saved' ? defaultI18n.t('next.selection.saved')
          : result.status === 'waiting' || result.status === 'working' ? defaultI18n.t('next.states.loading')
            : presentError({code: result.status === 'conflict' ? 'metadata_conflict' : result.status === 'unavailable' ? 'access_refused' : 'unavailable'}, 'detail', {operation: 'action'}).body}</Text>
      </View>)}
    </Dialog>}
    {destination && destinationKind && <NativeDestinationPicker controller={destination} kind={destinationKind} open
      selectionLabel={selectedItemsLabel(state.summary)} count={state.summary.count} artwork={artwork}
      onOpenChange={open => {if (!open && !destination.snapshot().busy) store.closeDestinations();}}/>}
    {bulk && bulkState && (bulkState.deletion
      ? <DeleteMediaDialog open owner ownerHeader={<Text style={[theme.type.caption, {color: theme.colors.textTertiary}]}>{selectedItemsLabel(state.summary)}</Text>}
          selectionCount={state.summary.count} preview={bulkState.deletion.preview ?? null} loading={bulkState.deletion.phase === 'loading'} error={bulkState.deletion.error}
          result={bulkState.deletion.result} confirmation={bulkState.deletion.confirmation} onConfirmationChange={value => bulk.setDeletion({confirmation: value})}
          removeFiles={bulkState.deletion.removeFiles} onRemoveFilesChange={value => bulk.setDeletion({removeFiles: value})}
          onDelete={() => {void bulk.deleteNow();}} pending={bulkState.deletion.phase === 'saving'} renderArtwork={() => undefined}
          onOpenChange={open => {if (!open) store.closeBulk();}} testID="search-delete-media"/>
      : <BulkEditor open title={defaultI18n.t('next.selection.native.action.edit')} count={state.summary.count} saveLabel={defaultI18n.t('action.save')}
          schema={bulkState.preview?.schema ?? []} values={bulkState.values} changes={bulkState.changes} onChangesChange={bulk.setChanges}
          lockEdited={bulkState.lockEdited} onLockEditedChange={bulk.setLockEdited} onSave={() => {void bulk.save();}}
          pending={bulkState.phase === 'saving'} error={bulkState.error} result={bulkState.result}
          resultEntries={store.entries().map(entry => ({id: entry.id, title: entry.displayTitle ?? entry.title, artwork: artwork(entry.posterUrl)}))}
          onRetry={ids => {void bulk.retry(ids);}} singleItemFields={bulkState.singleItemFields}
          fieldLabel={field => field.label} summary={bulkSummary}
          ownerHeader={<Text style={[theme.type.caption, {color: theme.colors.textTertiary}]}>{selectedItemsLabel(state.summary)}</Text>}
          onOpenChange={open => {if (!open) store.closeBulk();}} testID="search-bulk-editor"/>)}
  </>;
}
