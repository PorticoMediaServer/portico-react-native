import React, {useState, useSyncExternalStore} from 'react';
import {Text, View} from 'react-native';
import {useSafeAreaInsets} from 'react-native-safe-area-context';
import {defaultI18n} from '../../../../../packages/i18n/src';
import type {ContentEntry} from '../../../../../packages/client-core/src/library-content';
import type {SavedEntry, SavedProjection, SavedRoute} from '../../../../../packages/client-core/src/saved';
import {SelectionModel, selectionKey, selectionFourthAction, readCatalogueSelectionItem, playCatalogueSelection, enqueueCatalogueSelection, createCataloguePersonalSelection,
  type SelectionContext, type SelectionItem} from '../../../../../packages/client-core/src/selection-model';
import {mediaSelectionKey} from '../../../../../packages/client-core/src/media-selection';
import type {BulkMetadataPreview} from '../../../../../packages/client-core/src/home-selection/metadata-preview';
import {presentError} from '../../../../../packages/client-core/src/presentation/errors';
import type {NativeShellBootstrapContext} from '../../shell/bootstrap';
import {selectedItemsLabel} from '../../shell/selection-display';
import {BulkEditor, DeleteMediaDialog, SelectionBar, SelectionPhoneActionBar, type SelectionActionOffer, type SelectionBarProps} from '../../kit/selection';
import {useTheme} from '../../kit/theme';
import {Dialog} from '../../kit/overlays';
import {Button} from '../../kit/controls';
import {nativeDestinationLifetime} from '../destinations/lifetime';
import type {NativeDestinationActivationPort} from '../destinations/focus';
import {nativeScreenServices} from '../native-screen-services';
import {NativeLoadedDestinations} from '../search/loaded-destinations';
import {NativeDestinationPicker} from '../destinations/DestinationPicker';
import {NativeBulkMedia} from '../destinations/bulk-media';


/** The two authorized Saved projections and their change signal: everything this selection
 * reads from a destination. The phone hub is one source; the TV Saved destination is adapted
 * into the same shape, so both screens share one selection owner with no second store.
 * The projections are the canonical Saved mirror's own; this owner copies neither their
 * sections nor their entry union, so the parser stays the one authority for both screens. */
export type NativeSavedSelectionSource = Readonly<{
  getSnapshot: () => Readonly<{phase: string;
    myList: Readonly<{projection?: SavedProjection | null; route?: SavedRoute | null}>;
    favorites: Readonly<{projection?: SavedProjection | null; route?: SavedRoute | null}>;
    myListSquares?: Readonly<{projection?: SavedProjection | null; route?: SavedRoute | null}>}>;
  subscribe: (listener: () => void) => () => void;
}>;
export type NativeCatalogueSelectionSnapshot = Readonly<{
  /** Exact source/query identity. Appending a page does not change the query. */
  key: string;
  witness?: unknown;
  context: SelectionContext | null;
  sections: readonly Readonly<{id: string; entries: readonly ContentEntry[]; start?: number}>[];
}>;
export type NativeCatalogueSelectionSource = Readonly<{
  getSnapshot: () => NativeCatalogueSelectionSnapshot;
  subscribe: (listener: () => void) => () => void;
}>;
import type {NativeSavedSelectionPort} from './SavedScreen';

/** Exactly the AV leaves this owner may select, edit or delete. The Saved mirror's
 * entries also carry playlists and Reading group cards; this partition excludes
 * every other shape instead of casting one of them to a ContentEntry. */
const leaf = (entry: SavedEntry): boolean => entry.kind === 'movie' || entry.kind === 'episode'
  || entry.kind === 'song' || entry.kind === 'audiobook_file';
const selectable = (entry: ContentEntry): boolean => leaf(entry) || ['show', 'season', 'album', 'artist', 'book', 'collection'].includes(entry.kind);
const unavailable = () => Object.assign(new Error('catalogue-selection-unavailable'), {code: 'catalogue-selection-unavailable'});

/** Adapt only arrived Saved projections, including the separately paged square
 * shelf. No fetched page is promoted to whole-query membership. */
export function createNativeSavedSelection(context: NativeShellBootstrapContext, destination: NativeSavedSelectionSource,
  activation: NativeDestinationActivationPort): NativeSavedSelectionPort & {dispose: () => void} {
  const source: NativeCatalogueSelectionSource = {
    subscribe: destination.subscribe,
    getSnapshot: (): NativeCatalogueSelectionSnapshot => {
      const snapshot = destination.getSnapshot(), viewer = context.session()?.viewer, authority = viewer?.authority;
      const lists = [snapshot.myList, snapshot.myListSquares, snapshot.favorites].flatMap((list, index) => list?.projection
        ? [{id: String(index), list, projection: list.projection}] : []);
      const first = lists[0]?.projection;
      const key = JSON.stringify(lists.map(({id, list, projection}) => [id, list.route, projection.scope.viewerFence, projection.revision, projection.query]));
      const admitted = snapshot.phase === 'ready' && first && viewer && (authority === 'local' || authority === 'hosted');
      return {key, witness: snapshot.myList, context: admitted ? {
        scope: {serverId: viewer.serverId, authority, accountId: viewer.accountId, profileId: viewer.profileId,
          viewId: JSON.stringify(['native-saved', snapshot.myList.route, first.scope.entityId]), privacyFence: first.scope.viewerFence},
        revision: {catalogRevision: String(first.revision.catalog), viewerRevision: String(first.revision.viewer)},
      } : null, sections: lists.flatMap(({id, projection}) => projection.sections.map(section => ({id: `${id}:${section.id}`,
        entries: section.entries.filter((entry): entry is ContentEntry => entry.kind !== 'playlist' && entry.kind !== 'playlist_entry' && entry.kind !== 'reading_group')})))};
    },
  };
  return createNativeCatalogueSelection(context, source, activation);
}

/** Pushed and inline Saved pages keep the canonical source's own revision domain.
 * PersonalSaved's server resource/history revisions are not compared with
 * Detail/catalogue revisions. Appending a page in that revision keeps selection. */
export function createNativeSavedViewSelection(context: NativeShellBootstrapContext,
  destination: import('./view-model').NativeSavedViewDestination, activation: NativeDestinationActivationPort) {
  return createNativeCatalogueSelection(context, {
    subscribe: destination.subscribe,
    getSnapshot: (): NativeCatalogueSelectionSnapshot => {
      const snapshot = destination.getSnapshot(), viewer = context.session()?.viewer;
      const projection = snapshot.saved?.projection, personal = snapshot.personal;
      const fence = projection?.scope.viewerFence ?? personal?.viewerFence;
      const admitted = !snapshot.error && !snapshot.saved?.error && !personal?.error && !!fence
        && (snapshot.phase === 'ready' || snapshot.phase === 'loading' && !!(projection || personal?.resource || personal?.entries.length));
      const revision = projection ? {catalogRevision: String(projection.revision.catalog), viewerRevision: String(projection.revision.viewer)}
        : {catalogRevision: JSON.stringify(['saved-resource', personal?.resource?.revision ?? personal?.revision]), viewerRevision: JSON.stringify(['saved', personal?.revision])};
      const entries = (projection?.sections ?? []).map(section => ({id: section.id, entries: section.entries.flatMap(entry =>
        entry.kind === 'playlist_entry' ? entry.hidden ? [] : [entry.media]
          : entry.kind === 'playlist' || entry.kind === 'reading_group' ? [] : [entry])}));
      if (personal) entries.push({id: 'personal', entries: personal.entries.flatMap(entry => !entry.hidden && entry.media ? [entry.media] : [])});
      return {key: JSON.stringify(['native-saved-view', snapshot.route, projection?.query]), witness: snapshot.saved ?? personal,
        context: admitted && viewer && (viewer.authority === 'local' || viewer.authority === 'hosted') ? {
          scope: {serverId: viewer.serverId, authority: viewer.authority, accountId: viewer.accountId, profileId: viewer.profileId,
            viewId: JSON.stringify(['native-saved-view', snapshot.route]), privacyFence: fence!}, revision,
        } : null, sections: entries};
    },
  }, activation);
}

/** A page's actual catalogue fence, query and loaded objects own selection. The
 * same controls serve Saved, music, Person and collection pages without borrowing
 * a Home/Search scope or deriving grants from an item's shape. */
export function createNativeCatalogueSelection(context: NativeShellBootstrapContext, destination: NativeCatalogueSelectionSource,
  activation: NativeDestinationActivationPort): NativeSavedSelectionPort & {dispose: () => void} {
  const authority = nativeDestinationLifetime(context), feedback = nativeScreenServices(context);
  const listeners = new Set<() => void>(), windows = new Map<string, {key: string; windowId: string; item: SelectionItem; entry: ContentEntry; sectionId: string; order: number}>();
  let model: SelectionModel | undefined, stopModel: (() => void) | undefined, token = '', revision = 0, disposed = false, started = false;
  let pending: AbortController | undefined, batchGeneration = 0;
  let personal: ReturnType<typeof createCataloguePersonalSelection> | undefined, stopPersonal: (() => void) | undefined;
  let personalController: AbortController | undefined, personalCurrent: (() => boolean) | undefined;
  let destinations: NativeLoadedDestinations | undefined, destinationKind: 'playlist' | 'collection' | undefined;
  let destinationController: AbortController | undefined, stopDestinations: (() => void) | undefined;
  let bulk: NativeBulkMedia | undefined, bulkController: AbortController | undefined, stopBulk: (() => void) | undefined;
  const emit = () => {revision++; for (const listener of [...listeners]) listener();};
  const visible = () => !disposed && authority.current() && activation.getSnapshot().visible;
  const keyFor = (snapshot: NativeCatalogueSelectionSnapshot) => snapshot.context
    ? JSON.stringify([snapshot.key, snapshot.context]) : '';
  const closePersonal = () => {personalController?.abort(); personalController = undefined; stopPersonal?.(); stopPersonal = undefined; personal?.dispose(); personal = undefined; personalCurrent = undefined;};
  const closeDestinations = () => {destinationController?.abort(); destinationController = undefined; stopDestinations?.(); stopDestinations = undefined;
    destinations?.dispose(); destinations = undefined; destinationKind = undefined;};
  /** The same identity rule as the picker: only the dialog that still owns the
   * surface closes; reset may force-close. */
  const closeBulk = (expected?: NativeBulkMedia) => {
    if (expected && bulk !== expected) return;
    bulkController?.abort(); bulkController = undefined; stopBulk?.(); stopBulk = undefined;
    bulk?.dispose(); bulk = undefined;};
  const reset = () => {
    batchGeneration++; closePersonal(); closeDestinations(); closeBulk();
    pending?.abort(); pending = undefined; stopModel?.(); stopModel = undefined;
    model?.dispose(); model = undefined; windows.clear(); token = ''; started = false; emit();
  };
  const contains = (entry: ContentEntry) => visible() && destination.getSnapshot().sections.some(section => section.entries.includes(entry));
  const reconcile = () => {
    const snapshot = destination.getSnapshot(), next = visible() ? keyFor(snapshot) : '';
    if (next === token && [...windows.values()].every(window => contains(window.entry))) return;
    reset();
    if (!next || !snapshot.context) return;
    const viewer = context.session()?.viewer, captured = snapshot.context, scope = captured.scope;
    if (!viewer || viewer.authority !== scope.authority || viewer.serverId !== scope.serverId
      || viewer.accountId !== scope.accountId || viewer.profileId !== scope.profileId || scope.viewId.length > 4096) return;
    model = new SelectionModel(captured, {maxWindows: 256, maxRegisteredItems: 256}); token = next;
    stopModel = model.subscribe(emit); emit();
  };
  const start = (rendered?: unknown) => {
    if (!visible() || rendered !== undefined && destination.getSnapshot().witness !== rendered) return;
    reconcile();
    if (!model) return;
    started = true; emit();
  };
  const pick = async (entry: ContentEntry, batch?: number) => {
    if (batch === undefined) batchGeneration++;
    else if (batch !== batchGeneration) return;
    reconcile();
    const currentModel = model;
    if (!currentModel || pending || personal || destinations || bulk || !selectable(entry) || !contains(entry)) return;
    const id = JSON.stringify([entry.libraryId, entry.kind, entry.id]), registered = windows.get(id);
    if (registered) {currentModel.toggle(registered.windowId, registered.key); return;}
    if (windows.size >= 256) {feedback.reportError(unavailable(), 'saved'); return;}
    const controller = new AbortController(), captured = token, route = context.navigation.getSnapshot().revision;
    pending = controller; emit();
    const current = () => !controller.signal.aborted && visible() && model === currentModel && token === captured
      && keyFor(destination.getSnapshot()) === captured && context.navigation.getSnapshot().revision === route && contains(entry);
    try {
      const port = context.playback.cataloguePlayback?.();
      const item = await readCatalogueSelectionItem({api: context.api, scope: authority.scope, requestId: feedback.requestId,
        signal: controller.signal, isCurrent: current}, entry, {play: !!port, queue: !!port && queueControl(),
          myList: leaf(entry), favorite: leaf(entry), watched: leaf(entry), edit: leaf(entry), delete: leaf(entry), playlist: leaf(entry), collection: leaf(entry)});
      if (!current()) throw Object.assign(new Error('cancelled'), {name: 'AbortError'});
      const sections = destination.getSnapshot().sections, sectionOrder = sections.findIndex(value => value.entries.includes(entry));
      const section = sections[sectionOrder];
      if (!section) throw unavailable();
      const windowId = `saved-${windows.size}`;
      const registration = currentModel.registerWindow(currentModel.captureContext(), {id: windowId, sectionId: section.id, sectionOrder,
        start: (section.start ?? 0) + section.entries.indexOf(entry), items: [item]});
      if (!registration.ok) throw unavailable();
      const key = selectionKey(currentModel.getSnapshot().context.scope, item);
      windows.set(id, {key, windowId, item, entry, sectionId: section.id, order: windows.size});
      const selected = currentModel.toggle(windowId, key);
      if (!selected.ok) throw unavailable();
    } catch (error) {if (current()) feedback.reportError(error, 'saved');}
    finally {if (pending === controller) {pending = undefined; emit();}}
  };
  const queueControl = () => {
    const role = context.playback.getSnapshot().session?.role;
    return role === undefined || role === 'local';
  };
  const loaded = () => {
    return destination.getSnapshot().sections.flatMap(section => section.entries.filter(selectable));
  };
  const selectLoaded = async (rendered?: ReturnType<SelectionModel['getSnapshot']>) => {
    if (personal || destinations || bulk || !rendered || model?.getSnapshot() !== rendered || !visible()) return;
    const batch = ++batchGeneration;
    pending?.abort(); pending = undefined;
    if (!model || !visible()) return;
    const unique = [...new Map(loaded().map(entry => [JSON.stringify([entry.libraryId, entry.kind, entry.id]), entry])).values()];
    for (const entry of unique) {if (batchGeneration !== batch) return; await pick(entry, batch);}
  };
  const execute = async (action: 'play' | 'playNext' | 'playLater') => {
    batchGeneration++;
    reconcile();
    const currentModel = model, operation = currentModel?.captureOperation();
    if (!currentModel || !operation || operation.target.mode !== 'explicit' || pending || personal || bulk || !visible()) return;
    const controller = new AbortController(), captured = token, route = context.navigation.getSnapshot().revision, queue = action !== 'play';
    const current = () => !controller.signal.aborted && visible() && model === currentModel && token === captured
      && keyFor(destination.getSnapshot()) === captured && context.navigation.getSnapshot().revision === route
      && currentModel.isOperationCurrent(operation) && operation.target.mode === 'explicit'
      && (!queue || queueControl());
    pending = controller; emit();
    try {
      const port = context.playback.cataloguePlayback?.();
      if (!port || !current()) throw unavailable();
      const target = operation.target, items = (queue ? target.items : target.displayItems).map(value => value.item);
      if (queue) await enqueueCatalogueSelection(port, items, action === 'playNext' ? 'next' : 'end', {signal: controller.signal, isCurrent: current});
      else await playCatalogueSelection(port, items, {signal: controller.signal, isCurrent: current});
      if (current()) currentModel.clear();
    } catch (error) {if (current()) feedback.reportError(error, 'saved');}
    finally {if (pending === controller) {pending = undefined; emit();}}
  };
  const applyPersonal = async (action: 'myList' | 'removeMyList' | 'favorite' | 'watched' | 'unwatched') => {
    batchGeneration++; reconcile();
    const currentModel = model, operation = currentModel?.captureOperation();
    if (!currentModel || !operation || operation.target.mode !== 'explicit' || pending || personal || bulk || !visible()) return;
    const capability = action === 'myList' || action === 'removeMyList' ? 'myList' : action === 'favorite' ? 'favorite' : 'watched';
    if (!operation.target.items.every(pick => pick.item.capabilities[capability])) return;
    const captured = token, route = context.navigation.getSnapshot().revision, controller = new AbortController();
    const current = () => !controller.signal.aborted && visible() && model === currentModel && token === captured
      && keyFor(destination.getSnapshot()) === captured && context.navigation.getSnapshot().revision === route && currentModel.isOperationCurrent(operation);
    const entries = operation.target.items.flatMap(pick => {
      const window = [...windows.values()].find(value => value.key === pick.key);
      return window && leaf(window.entry) ? [window.entry] : [];
    });
    if (entries.length !== operation.target.items.length || !current()) return;
    personalController = controller; personalCurrent = current;
    personal = createCataloguePersonalSelection({api: context.api, scope: authority.scope, requestId: feedback.requestId, signal: controller.signal, isCurrent: current});
    stopPersonal = personal.service.subscribe(emit);
    personal.service.setEntries(entries); personal.service.begin();
    for (const entry of entries) personal.service.toggle(mediaSelectionKey(entry));
    emit();
    try {await personal.service.apply(capability === 'myList' ? 'watchlist' : capability, action !== 'removeMyList' && action !== 'unwatched');}
    catch (error) {if (current()) feedback.reportError(error, 'saved');}
    finally {emit();}
  };
  const retryPersonal = async () => {
    if (!personal || !personalCurrent?.() || personal.service.getSnapshot().busy) return;
    try {await personal.service.retry();} catch (error) {if (personalCurrent?.()) feedback.reportError(error, 'saved');}
  };
  const openDestination = (kind: 'playlist' | 'collection') => {
    if (!model || !visible() || pending || personal || destinations || bulk) return;
    const state = model.getSnapshot();
    if (!state.active || !state.selectedKeys.length) return;
    const selected = [...windows.values()].filter(window => state.selectedKeys.includes(window.key)).flatMap(window => leaf(window.entry) ? [window.entry] : []);
    if (selected.length !== state.selectedKeys.length) return;
    const captured = token, currentModel = model, route = context.navigation.getSnapshot().revision, controller = new AbortController();
    const current = () => !controller.signal.aborted && visible() && model === currentModel && token === captured
      && context.navigation.getSnapshot().revision === route && currentModel.getSnapshot().active;
    destinationController = controller;
    destinations = new NativeLoadedDestinations({api: context.api, scope: authority.scope, requestId: feedback.requestId, signal: controller.signal, isCurrent: current,
      viewerFence: context.authority().viewerFence}, selected);
    destinationKind = kind;
    stopDestinations = destinations.subscribe(emit);
    void destinations.load(kind).catch(error => {if (current()) feedback.reportError(error, 'saved');});
    emit();
  };
  /** The exact leaves behind the selected model keys, in model selection order. */
  const selectedEntries = (state: ReturnType<SelectionModel['getSnapshot']>) => {
    const byKey = new Map([...windows.values()].map(window => [window.key, window.entry] as const));
    return state.selectedKeys.flatMap(key => {const entry = byKey.get(key); return entry && leaf(entry) ? [entry] : [];});
  };
  // select 21/22: the owner's real bulk editor and delete dialog, over exactly the
  // selected AV leaves the canonical Detail read granted edit/delete. The bar only
  // offers these actions when every selected item carries the grant; this owner
  // rechecks the captured explicit operation and its selected entries.
  const openAdmin = (kind: 'edit' | 'delete', view: ReturnType<SelectionModel['getSnapshot']>) => {
    if (view !== model?.getSnapshot()) return;
    const currentModel = model;
    if (!currentModel || !visible() || pending || personal || destinations || bulk) return;
    const state = currentModel.getSnapshot();
    if (!state.active || !state.selectedKeys.length || !state.summary.every[kind]) return;
    const operation = currentModel.captureOperation();
    if (!operation || operation.target.mode !== 'explicit') return;
    const selected = selectedEntries(state);
    if (selected.length !== state.selectedKeys.length) return;
    const captured = token, route = context.navigation.getSnapshot().revision, controller = new AbortController();
    const current = () => !controller.signal.aborted && visible() && model === currentModel && token === captured
      && context.navigation.getSnapshot().revision === route && currentModel.isOperationCurrent(operation);
    bulkController = controller;
    bulk = new NativeBulkMedia({api: context.api, scope: authority.scope, requestId: feedback.requestId, signal: controller.signal, isCurrent: current}, selected);
    stopBulk = bulk.subscribe(emit);
    void (kind === 'edit' ? bulk.openEditor() : bulk.openDelete()).catch(error => {if (current()) feedback.reportError(error, 'saved');});
    emit();
  };
  const off = [destination.subscribe(reconcile), activation.subscribe(reconcile), context.subscribeAuthority(reconcile),
    context.navigation.subscribe(() => {batchGeneration++; pending?.abort(); reconcile();})];
  reconcile();
  const store = {subscribe: (listener: () => void) => {listeners.add(listener); return () => {listeners.delete(listener);};},
    getSnapshot: () => revision, loadedCount: () => loaded().length, snapshot: () => model?.getSnapshot(), personal: () => personal?.service.getSnapshot(),
    busy: () => !!pending || !!personal?.service.getSnapshot().busy || !!destinations?.snapshot().busy || !!bulk, queueControl, started: () => started,
    clear: () => {if (personal?.service.getSnapshot().busy || destinations?.snapshot().busy || bulk) return; batchGeneration++; pending?.abort(); closePersonal(); closeDestinations(); closeBulk(); model?.clear(); started = false; emit();},
    selectLoaded, execute, applyPersonal, retryPersonal, openDestination, closeDestinations, destination: () => destinations, destinationKind: () => destinationKind,
    // An open bulk dialog owns the current operation: the bar must not offer another.
    bulk: () => bulk, openAdmin, closeBulk,
    entries: () => {const state = model?.getSnapshot(); return state ? selectedEntries(state) : [];}};
  const port: NativeSavedSelectionPort = {
    subscribe: store.subscribe, getSnapshot: store.getSnapshot, start,
    register: () => {reconcile(); return () => {};},
    item: entry => !selectable(entry) ? undefined : ({active: (started && visible()) || (model?.getSnapshot().active ?? false),
      selected: windows.has(JSON.stringify([entry.libraryId, entry.kind, entry.id])) && !!model?.getSnapshot().selectedKeys.includes(windows.get(JSON.stringify([entry.libraryId, entry.kind, entry.id]))!.key),
      onEnter: () => {void pick(entry);}, onToggle: () => {void pick(entry);}}),
    render: artwork => (started || model?.getSnapshot().active) && visible() ? <SavedSelectionBars store={store} artwork={artwork ?? (() => null)}/> : null,
  };
  return Object.freeze({...port, dispose: () => {if (disposed) return; disposed = true; off.forEach(stop => stop()); reset(); listeners.clear();}});
}

type Store = {subscribe(listener: () => void): () => void; getSnapshot(): number; snapshot(): ReturnType<SelectionModel['getSnapshot']> | undefined;
  personal(): ReturnType<ReturnType<typeof createCataloguePersonalSelection>['service']['getSnapshot']> | undefined;
  applyPersonal(action: 'myList' | 'removeMyList' | 'favorite' | 'watched' | 'unwatched'): Promise<void>; retryPersonal(): Promise<void>;
  loadedCount(): number; busy(): boolean; queueControl(): boolean; started(): boolean; clear(): void; selectLoaded(state?: ReturnType<SelectionModel['getSnapshot']>): Promise<void>; execute(action: 'play' | 'playNext' | 'playLater'): Promise<void>;
  openDestination(kind: 'playlist' | 'collection'): void; closeDestinations(): void; destination(): NativeLoadedDestinations | undefined; destinationKind(): 'playlist' | 'collection' | undefined;
  bulk(): NativeBulkMedia | undefined; openAdmin(kind: 'edit' | 'delete', view: ReturnType<SelectionModel['getSnapshot']>): void; closeBulk(expected?: NativeBulkMedia): void;
  entries(): readonly ContentEntry[]};

function SavedSelectionBars({store, artwork}: {store: Store; artwork: (path?: string) => React.ReactNode}) {
  useSyncExternalStore(store.subscribe, store.getSnapshot);
  const theme = useTheme(), insets = useSafeAreaInsets(), [menu, setMenu] = useState<SelectionBarProps['menu']>(null);
  const state = store.snapshot();
  if (!state || (!state.active && !store.started())) return null;
  const actions: SelectionActionOffer[] = [];
  if (state.summary.count > 0) {
    if (state.summary.every.play) actions.push({id: 'play', disabled: store.busy()});
    if (state.summary.every.queue && store.queueControl()) actions.push({id: 'queue', disabled: store.busy()}, {id: 'playNext', disabled: store.busy()}, {id: 'playLater', disabled: store.busy()});
    if (state.summary.every.myList) actions.push({id: 'myList', disabled: store.busy()}, {id: 'removeMyList', disabled: store.busy()});
    if (state.summary.every.favorite) actions.push({id: 'favorite', disabled: store.busy()});
    if (state.summary.every.watched) actions.push({id: 'watched', disabled: store.busy()}, {id: 'unwatched', disabled: store.busy()});
    if (state.summary.every.edit) actions.push({id: 'edit', disabled: store.busy()});
    if (state.summary.every.delete) actions.push({id: 'delete', disabled: store.busy()});
    if (state.summary.every.playlist) actions.push({id: 'playlist', disabled: store.busy()});
    if (state.summary.every.collection) actions.push({id: 'collection', disabled: store.busy()});
    if (actions.some(action => ['removeMyList', 'favorite', 'watched', 'unwatched', 'edit', 'delete'].includes(action.id))) actions.push({id: 'more', disabled: store.busy()});
  }
  const personal = store.personal(), destination = store.destination(), destinationKind = store.destinationKind();
  const bulk = store.bulk(), bulkState = bulk?.getSnapshot(), preview: BulkMetadataPreview | undefined = bulkState?.preview;
  const bulkSummary: readonly {id: string; text: string}[] = bulkState ? Object.entries(bulkState.changes).flatMap(([field, change]) => {
    const spec = preview?.schema.find(candidate => candidate.field === field);
    if (!spec) return [];
    if ('value' in change) return [{id: field, text: `${spec.label}: ${change.value || defaultI18n.t('next.selection.native.notSet')}`}];
    const parts: string[] = [];
    if (change.add.length) parts.push(`+${defaultI18n.list(change.add)}`);
    if (change.remove.length) parts.push(`−${defaultI18n.list(change.remove)}`);
    return parts.length ? [{id: field, text: `${spec.label}: ${parts.join('; ')}`}] : [];
  }) : [];
  // A bounded loaded window in the new empty mode is not the whole query, and the
  // own shapes are not all in this selection owner; omit Select all unless the target
  // is a proven whole-query one. No latest-selection mutation from a stale bar.
  const wholeQuery = state.target?.mode === 'query';
  const props: SelectionBarProps = {count: state.summary.count, selectionLabel: selectedItemsLabel(state.summary),
    ...(wholeQuery ? {selectAllLabel: defaultI18n.t('next.selection.selectAll', {count: store.loadedCount()}), onSelectAll: () => {void store.selectLoaded(state);}} : {}),
    onCancel: () => {setMenu(null); store.clear();},
    actions, menu, onMenuChange: setMenu, topInset: insets.top, fourthSlot: selectionFourthAction(state.summary) === 'mark-watched' ? 'watched' : 'myList',
    onAction: action => {if (action === 'play' || action === 'playNext' || action === 'playLater') {setMenu(null); void store.execute(action);}
      else if (action === 'myList' || action === 'removeMyList' || action === 'favorite' || action === 'watched' || action === 'unwatched') {setMenu(null); void store.applyPersonal(action);}
      else if (action === 'playlist' || action === 'collection') {setMenu(null); store.openDestination(action);}
      else if (action === 'edit' || action === 'delete') {setMenu(null); store.openAdmin(action, state);}}};
  return <><View pointerEvents="box-none" style={{position: 'absolute', inset: 0, zIndex: theme.layers.navigation + 1}}>
    <View style={theme.isTV ? {position: 'absolute', left: 200, right: 96, top: 58} : undefined}><SelectionBar {...props}/></View>
    {!theme.isTV && <View style={{position: 'absolute', left: 0, right: 0, bottom: 0}}><SelectionPhoneActionBar {...props} bottomInset={Math.max(34, insets.bottom)}/></View>}
  </View>
    {personal && <Dialog testID="saved-personal-results" open title={defaultI18n.t('next.selection.selectedItems', {items: selectedItemsLabel(state.summary)})}
      onOpenChange={open => {if (!open && !personal.busy) store.clear();}}
      footer={<><Button focusId="done" disabled={personal.busy} onPress={store.clear}>{defaultI18n.t('next.selection.done')}</Button>
        {personal.results.some(result => result.status === 'failed') && <Button focusId="retry" disabled={personal.busy} onPress={() => {void store.retryPersonal();}}>{defaultI18n.t('next.selection.retry')}</Button>}</>}>
      {personal.results.map(result => <View key={result.key} style={{gap: 4, marginBottom: 12}}>
        <Text style={[theme.type.bodyStrong, {color: theme.colors.text}]}>{result.title}</Text>
        <Text style={[theme.type.body, {color: theme.colors.textSecondary}]}>{result.status === 'saved' ? defaultI18n.t('next.selection.saved') : presentError({code: 'unavailable'}, 'detail', {operation: 'action'}).body}</Text>
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
          onOpenChange={open => {if (!open) store.closeBulk(bulk);}} testID="saved-delete-media"/>
      : <BulkEditor open title={defaultI18n.t('next.selection.native.action.edit')} count={state.summary.count} saveLabel={defaultI18n.t('action.save')}
          schema={preview?.schema ?? []} values={bulkState.values} changes={bulkState.changes} onChangesChange={bulk.setChanges}
          lockEdited={bulkState.lockEdited} onLockEditedChange={bulk.setLockEdited} onSave={() => {void bulk.save();}}
          pending={bulkState.phase === 'saving'} error={bulkState.error} result={bulkState.result}
          resultEntries={store.entries().map(entry => ({id: entry.id, title: entry.displayTitle ?? entry.title, artwork: artwork(entry.posterUrl)}))}
          onRetry={ids => {void bulk.retry(ids);}} singleItemFields={bulkState.singleItemFields}
          fieldLabel={field => field.label} summary={bulkSummary}
          ownerHeader={<Text style={[theme.type.caption, {color: theme.colors.textTertiary}]}>{selectedItemsLabel(state.summary)}</Text>}
          onOpenChange={open => {if (!open) store.closeBulk(bulk);}} testID="saved-bulk-editor"/>)}
  </>;
}
