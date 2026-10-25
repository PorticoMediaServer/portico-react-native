import React, {useState, useSyncExternalStore} from 'react';
import {Text, View} from 'react-native';
import {useSafeAreaInsets} from 'react-native-safe-area-context';
import {defaultI18n} from '../../../../../packages/i18n/src';
import type {ContentEntry} from '../../../../../packages/client-core/src/library-content';
import {SelectionModel, selectionKey, selectionFourthAction, readCatalogueSelectionItem, playCatalogueSelection, enqueueCatalogueSelection, createCataloguePersonalSelection,
  type SelectionContext, type SelectionItem} from '../../../../../packages/client-core/src/selection-model';
import {mediaSelectionKey} from '../../../../../packages/client-core/src/media-selection';
import {presentError} from '../../../../../packages/client-core/src/presentation/errors';
import type {NativeShellBootstrapContext} from '../../shell/bootstrap';
import type {NativeShellRuntime} from '../../shell/runtime';
import {selectedItemsLabel} from '../../shell/selection-display';
import {SelectionBar, SelectionPhoneActionBar, type SelectionActionOffer, type SelectionBarProps} from '../../kit/selection';
import {useTheme} from '../../kit/theme';
import {Dialog} from '../../kit/overlays';
import {Button} from '../../kit/controls';
import {nativeDestinationLifetime} from '../destinations/lifetime';
import type {NativeDestinationActivationPort} from '../destinations/focus';
import {nativeScreenServices} from '../native-screen-services';
import {NativeLoadedDestinations} from '../search/loaded-destinations';
import {NativeDestinationPicker} from '../destinations/DestinationPicker';
import type {SavedProjection} from '../../../../../packages/client-core/src/saved';

/** The two authorized Saved projections and their change signal: everything this selection
 * reads from a destination. The phone hub is one source; the TV Saved destination is adapted
 * into the same shape, so both screens share one selection owner with no second store. */
export type NativeSavedSelectionSource = Readonly<{
  getSnapshot: () => Readonly<{phase: string;
    myList: Readonly<{projection?: SavedProjection; route?: Readonly<{view?: string}>}>;
    favorites: Readonly<{projection?: SavedProjection; route?: Readonly<{view?: string}>}>}>;
  subscribe: (listener: () => void) => () => void;
  snapshot: () => Readonly<{busy: boolean}>;
}>;
type SelectionSnapshot = ReturnType<NativeSavedSelectionSource['getSnapshot']>;
import type {NativeSavedSelectionPort} from './SavedScreen';

const leaf = (entry: ContentEntry): entry is ContentEntry => ['movie', 'episode', 'song', 'audiobook_file'].includes(entry.kind);
const unavailable = () => Object.assign(new Error('catalogue-selection-unavailable'), {code: 'catalogue-selection-unavailable'});

/** Selection on the Saved hub, over the canonical myList/favorites projections the
 * hub already read. Detail supplies each explicitly picked leaf's grants; Saved keeps
 * its own viewer fence and revision, never a Home or Search one. */
export function createNativeSavedSelection(context: NativeShellBootstrapContext, destination: NativeSavedSelectionSource,
  activation: NativeDestinationActivationPort): NativeSavedSelectionPort & {dispose: () => void} {
  const authority = nativeDestinationLifetime(context), feedback = nativeScreenServices(context);
  const listeners = new Set<() => void>(), windows = new Map<string, {key: string; windowId: string; item: SelectionItem; entry: ContentEntry; sectionId: string; order: number}>();
  let model: SelectionModel | undefined, stopModel: (() => void) | undefined, token = '', revision = 0, disposed = false;
  let pending: AbortController | undefined, batchGeneration = 0;
  let personal: ReturnType<typeof createCataloguePersonalSelection> | undefined, stopPersonal: (() => void) | undefined;
  let personalController: AbortController | undefined, personalCurrent: (() => boolean) | undefined;
  let destinations: NativeLoadedDestinations | undefined, destinationKind: 'playlist' | 'collection' | undefined;
  let destinationController: AbortController | undefined, stopDestinations: (() => void) | undefined;
  const emit = () => {revision++; for (const listener of [...listeners]) listener();};
  const visible = () => !disposed && authority.current() && activation.getSnapshot().visible;
  const lists = (snapshot: SelectionSnapshot) => [snapshot.myList, snapshot.favorites].flatMap((list, index) => list.projection
    ? [{id: index === 0 ? 'myList' : 'favorites', list}] : []);
  const keyFor = (snapshot: SelectionSnapshot) => snapshot.phase === 'ready'
    ? JSON.stringify(lists(snapshot).map(({id, list}) => [id, list.projection?.scope.viewerFence, list.projection?.revision.catalog, list.projection?.revision.viewer,
      list.projection?.sections.map(section => [section.id, section.entries.length])])) : '';
  const closePersonal = () => {personalController?.abort(); personalController = undefined; stopPersonal?.(); stopPersonal = undefined; personal?.dispose(); personal = undefined; personalCurrent = undefined;};
  const closeDestinations = () => {destinationController?.abort(); destinationController = undefined; stopDestinations?.(); stopDestinations = undefined;
    destinations?.dispose(); destinations = undefined; destinationKind = undefined;};
  const reset = () => {
    batchGeneration++; closePersonal(); closeDestinations();
    pending?.abort(); pending = undefined; stopModel?.(); stopModel = undefined;
    model?.dispose(); model = undefined; windows.clear(); token = ''; emit();
  };
  const contains = (entry: ContentEntry) => visible() && lists(destination.getSnapshot()).some(({list}) =>
    list.projection?.sections.some(section => section.entries.some(value => value === entry)) === true);
  const reconcile = () => {
    const snapshot = destination.getSnapshot(), next = visible() ? keyFor(snapshot) : '';
    if (next === token && [...windows.values()].every(window => contains(window.entry))) return;
    reset();
    if (!next) return;
    const viewer = context.session()?.viewer, first = lists(snapshot)[0];
    if (!viewer || !first?.list.projection || viewer.authority !== 'local' && viewer.authority !== 'hosted') return;
    const viewId = JSON.stringify(['native-saved', first.id, snapshot.myList.route?.view ?? '', first.list.projection.scope.entityId]);
    if (viewId.length > 4096) return;
    const captured: SelectionContext = {scope: {serverId: viewer.serverId, authority: viewer.authority, accountId: viewer.accountId, profileId: viewer.profileId,
      viewId, privacyFence: first.list.projection.scope.viewerFence}, revision: {catalogRevision: String(first.list.projection.revision.catalog),
      viewerRevision: String(first.list.projection.revision.viewer)}};
    model = new SelectionModel(captured, {maxWindows: 256, maxRegisteredItems: 256}); token = next;
    stopModel = model.subscribe(emit); emit();
  };
  const pick = async (entry: ContentEntry, batch?: number) => {
    if (batch === undefined) batchGeneration++;
    else if (batch !== batchGeneration) return;
    reconcile();
    const currentModel = model;
    if (!currentModel || pending || personal || destinations || !leaf(entry) || !contains(entry)) return;
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
        signal: controller.signal, isCurrent: current}, entry, {play: !!port, queue: !!port && queueControl(), myList: true, favorite: true, watched: true});
      if (!current()) throw Object.assign(new Error('cancelled'), {name: 'AbortError'});
      const listsNow = lists(destination.getSnapshot()), list = listsNow.find(value => value.list.projection?.sections.some(section => section.entries.some(entry2 => entry2 === entry)));
      const section = list?.list.projection?.sections.find(value => value.entries.some(entry2 => entry2 === entry));
      if (!section) throw unavailable();
      const windowId = `saved-${windows.size}`;
      const registration = currentModel.registerWindow(currentModel.captureContext(), {id: windowId, sectionId: `${list!.id}:${section.id}`, sectionOrder: 0,
        start: section.entries.indexOf(entry), items: [item]});
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
    const snapshot = destination.getSnapshot();
    return lists(snapshot).flatMap(({list}) => (list.projection?.sections ?? []).flatMap(section => section.entries.filter((entry): entry is ContentEntry => 'kind' in entry && leaf(entry as ContentEntry))));
  };
  const selectLoaded = async () => {
    if (personal || destinations) return;
    reconcile();
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
    if (!currentModel || !operation || operation.target.mode !== 'explicit' || pending || personal || !visible()) return;
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
    if (!currentModel || !operation || operation.target.mode !== 'explicit' || pending || personal || !visible()) return;
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
    if (!model || !visible() || pending || personal || destinations) return;
    const state = model.getSnapshot();
    if (!state.active || !state.selectedKeys.length) return;
    const selected = [...windows.values()].filter(window => state.selectedKeys.includes(window.key)).flatMap(window => leaf(window.entry) ? [window.entry] : []);
    if (selected.length !== state.selectedKeys.length) return;
    const captured = token, currentModel = model, route = context.navigation.getSnapshot().revision, controller = new AbortController();
    const current = () => !controller.signal.aborted && visible() && model === currentModel && token === captured
      && context.navigation.getSnapshot().revision === route && currentModel.getSnapshot().active;
    destinationController = controller;
    destinations = new NativeLoadedDestinations({api: context.api, scope: authority.scope, requestId: feedback.requestId, signal: controller.signal, isCurrent: current}, selected);
    destinationKind = kind;
    stopDestinations = destinations.subscribe(emit);
    void destinations.load(kind).catch(error => {if (current()) feedback.reportError(error, 'saved');});
    emit();
  };
  const off = [destination.subscribe(reconcile), activation.subscribe(reconcile), context.subscribeAuthority(reconcile),
    context.navigation.subscribe(() => {batchGeneration++; pending?.abort(); reconcile();})];
  reconcile();
  const store = {subscribe: (listener: () => void) => {listeners.add(listener); return () => {listeners.delete(listener);};},
    getSnapshot: () => revision, loadedCount: () => loaded().length, snapshot: () => model?.getSnapshot(), personal: () => personal?.service.getSnapshot(),
    busy: () => !!pending || !!personal?.service.getSnapshot().busy || !!destinations?.snapshot().busy, queueControl,
    clear: () => {if (personal?.service.getSnapshot().busy || destinations?.snapshot().busy) return; batchGeneration++; pending?.abort(); closePersonal(); closeDestinations(); model?.clear(); emit();},
    selectLoaded, execute, applyPersonal, retryPersonal, openDestination, closeDestinations, destination: () => destinations, destinationKind: () => destinationKind};
  const port: NativeSavedSelectionPort = {
    register: () => {reconcile(); return () => {};},
    item: entry => ({active: model?.getSnapshot().active ?? false,
      selected: windows.has(JSON.stringify([entry.libraryId, entry.kind, entry.id])) && !!model?.getSnapshot().selectedKeys.includes(windows.get(JSON.stringify([entry.libraryId, entry.kind, entry.id]))!.key),
      onEnter: () => {void pick(entry);}, onToggle: () => {void pick(entry);}}),
    render: () => <SavedSelectionBars store={store}/>,
  };
  return Object.freeze({...port, dispose: () => {if (disposed) return; disposed = true; off.forEach(stop => stop()); reset(); listeners.clear();}});
}

type Store = {subscribe(listener: () => void): () => void; getSnapshot(): number; snapshot(): ReturnType<SelectionModel['getSnapshot']> | undefined;
  personal(): ReturnType<ReturnType<typeof createCataloguePersonalSelection>['service']['getSnapshot']> | undefined;
  applyPersonal(action: 'myList' | 'removeMyList' | 'favorite' | 'watched' | 'unwatched'): Promise<void>; retryPersonal(): Promise<void>;
  loadedCount(): number; busy(): boolean; queueControl(): boolean; clear(): void; selectLoaded(): Promise<void>; execute(action: 'play' | 'playNext' | 'playLater'): Promise<void>;
  openDestination(kind: 'playlist' | 'collection'): void; closeDestinations(): void; destination(): NativeLoadedDestinations | undefined; destinationKind(): 'playlist' | 'collection' | undefined};

function SavedSelectionBars({store, artwork}: {store: Store; artwork?: (path?: string) => React.ReactNode}) {
  useSyncExternalStore(store.subscribe, store.getSnapshot);
  const theme = useTheme(), insets = useSafeAreaInsets(), [menu, setMenu] = useState<SelectionBarProps['menu']>(null);
  const state = store.snapshot();
  if (!state?.active) return null;
  const actions: SelectionActionOffer[] = [];
  if (state.summary.every.play) actions.push({id: 'play', disabled: store.busy()});
  if (state.summary.every.queue && store.queueControl()) actions.push({id: 'queue', disabled: store.busy()}, {id: 'playNext', disabled: store.busy()}, {id: 'playLater', disabled: store.busy()});
  if (state.summary.every.myList) actions.push({id: 'myList', disabled: store.busy()}, {id: 'removeMyList', disabled: store.busy()});
  if (state.summary.every.favorite) actions.push({id: 'favorite', disabled: store.busy()});
  if (state.summary.every.watched) actions.push({id: 'watched', disabled: store.busy()}, {id: 'unwatched', disabled: store.busy()});
  if (state.summary.count > 0) actions.push({id: 'playlist', disabled: store.busy()}, {id: 'collection', disabled: store.busy()});
  if (actions.some(action => ['removeMyList', 'favorite', 'watched', 'unwatched'].includes(action.id))) actions.push({id: 'more', disabled: store.busy()});
  const personal = store.personal(), destination = store.destination(), destinationKind = store.destinationKind();
  const props: SelectionBarProps = {count: state.summary.count, selectionLabel: selectedItemsLabel(state.summary),
    selectAllLabel: defaultI18n.t('next.selection.selectAll', {count: store.loadedCount()}), onSelectAll: () => {void store.selectLoaded();}, onCancel: () => {setMenu(null); store.clear();},
    actions, menu, onMenuChange: setMenu, topInset: insets.top, fourthSlot: selectionFourthAction(state.summary) === 'mark-watched' ? 'watched' : 'myList',
    onAction: action => {if (action === 'play' || action === 'playNext' || action === 'playLater') {setMenu(null); void store.execute(action);}
      else if (action === 'myList' || action === 'removeMyList' || action === 'favorite' || action === 'watched' || action === 'unwatched') {setMenu(null); void store.applyPersonal(action);}
      else if (action === 'playlist' || action === 'collection') {setMenu(null); store.openDestination(action);}}};
  return <><View pointerEvents="box-none" style={{position: 'absolute', inset: 0, zIndex: theme.layers.navigation + 1}}>
    <View style={theme.isTV ? {position: 'absolute', left: 200, right: 96, top: 58} : undefined}><SelectionBar {...props}/></View>
    {!theme.isTV && <View style={{position: 'absolute', left: 0, right: 0, bottom: 0}}><SelectionPhoneActionBar {...props} bottomInset={Math.max(34, insets.bottom)}/></View>}
  </View>
    {personal && <Dialog open title={defaultI18n.t('next.selection.selectedItems', {items: selectedItemsLabel(state.summary)})}
      onOpenChange={open => {if (!open && !personal.busy) store.clear();}}
      footer={<><Button disabled={personal.busy} onPress={store.clear}>{defaultI18n.t('next.selection.done')}</Button>
        {personal.results.some(result => result.status === 'failed') && <Button disabled={personal.busy} onPress={() => {void store.retryPersonal();}}>{defaultI18n.t('next.selection.retry')}</Button>}</>}>
      {personal.results.map(result => <View key={result.key} style={{gap: 4, marginBottom: 12}}>
        <Text style={[theme.type.bodyStrong, {color: theme.colors.text}]}>{result.title}</Text>
        <Text style={[theme.type.body, {color: theme.colors.textSecondary}]}>{result.status === 'saved' ? defaultI18n.t('next.selection.saved') : presentError({code: 'unavailable'}, 'detail', {operation: 'action'}).body}</Text>
      </View>)}
    </Dialog>}
    {destination && destinationKind && <NativeDestinationPicker controller={destination} kind={destinationKind} open
      selectionLabel={selectedItemsLabel(state.summary)} count={state.summary.count} artwork={artwork}
      onOpenChange={open => {if (!open && !destination.snapshot().busy) store.closeDestinations();}}/>}
  </>;
}
