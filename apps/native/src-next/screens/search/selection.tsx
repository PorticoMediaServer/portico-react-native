import React, {useState, useSyncExternalStore} from 'react';
import {Text, View} from 'react-native';
import {useSafeAreaInsets} from 'react-native-safe-area-context';
import {defaultI18n} from '../../../../../packages/i18n/src';
import type {ContentEntry} from '../../../../../packages/client-core/src/library-content';
import type {SearchEntry, SearchGroup, SearchSnapshot} from '../../../../../packages/client-core/src/search';
import {SelectionModel, selectionKey, selectionFourthAction, readCatalogueSelectionItem, playCatalogueSelection, enqueueCatalogueSelection, createCataloguePersonalSelection,
  type SelectionContext, type SelectionItem} from '../../../../../packages/client-core/src/selection-model';
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
import {nativeSearchEntryKey, type NativeSearchDestination} from './model';
import type {NativeSearchSelectionPort} from './types';

const leaf = (entry: SearchEntry): entry is ContentEntry => ['movie', 'episode', 'song', 'audiobook_file'].includes(entry.kind);
const cancelled = () => Object.assign(new Error('cancelled'), {name: 'AbortError', code: 'cancelled'});
const unavailable = () => Object.assign(new Error('catalogue-selection-unavailable'), {code: 'catalogue-selection-unavailable'});

/** Search owns its fence and generation. Detail supplies only each explicitly
 * picked leaf's grants; it never replaces Search's membership or context. */
export function createNativeSearchSelection(context: NativeShellBootstrapContext, source: NativeSearchDestination,
  activation: NativeDestinationActivationPort) {
  const authority = nativeDestinationLifetime(context), feedback = nativeScreenServices(context);
  const listeners = new Set<() => void>(), windows = new Map<string, {key: string; windowId: string; item: SelectionItem; entry: SearchEntry; group: SearchGroup}>();
  let model: SelectionModel | undefined, stopModel: (() => void) | undefined, token = '', revision = 0, disposed = false;
  let pending: AbortController | undefined, batchGeneration = 0;
  let stopPlayback: (() => void) | undefined;
  let personal: ReturnType<typeof createCataloguePersonalSelection> | undefined, stopPersonal: (() => void) | undefined;
  let personalController: AbortController | undefined, personalCurrent: (() => boolean) | undefined;
  const closePersonal = () => {personalController?.abort(); personalController = undefined; stopPersonal?.(); stopPersonal = undefined; personal?.dispose(); personal = undefined; personalCurrent = undefined;};
  const emit = () => {revision++; for (const listener of [...listeners]) listener();};
  const keyFor = (snapshot: SearchSnapshot) => snapshot.phase === 'ready' && snapshot.data
    ? JSON.stringify([snapshot.generation, snapshot.data.scope.viewerFence, snapshot.data.revision, snapshot.data.query]) : '';
  const visible = () => !disposed && authority.current() && activation.getSnapshot().visible;
  const queueControl = () => {
    const role = context.playback.getSnapshot().session?.role;
    return role === undefined || role === 'local';
  };
  const reset = () => {
    batchGeneration++; closePersonal();
    stopPlayback?.(); stopPlayback = undefined;
    pending?.abort(); pending = undefined; stopModel?.(); stopModel = undefined;
    model?.dispose(); model = undefined; windows.clear(); token = ''; emit();
  };
  const reconcile = () => {
    const snapshot = source.getSnapshot().search, next = visible() ? keyFor(snapshot) : '';
    if (next === token && [...windows.values()].every(window => source.getSnapshot().groups.some(group =>
      group.id === window.group && group.status === 'success' && group.items.includes(window.entry)))) return;
    reset();
    if (!next || !snapshot.data) return;
    const viewer = context.session()?.viewer;
    if (!viewer || viewer.authority !== 'local' && viewer.authority !== 'hosted') return;
    const viewId = JSON.stringify(['native-search', snapshot.generation, snapshot.data.query]);
    if (viewId.length > 4096) return;
    const captured: SelectionContext = {scope: {serverId: viewer.serverId, authority: viewer.authority,
      accountId: viewer.accountId, profileId: viewer.profileId, viewId,
      privacyFence: snapshot.data.scope.viewerFence}, revision: {catalogRevision: String(snapshot.data.revision.catalog), viewerRevision: String(snapshot.data.revision.viewer)}};
    model = new SelectionModel(captured, {maxWindows: 256, maxRegisteredItems: 256}); token = next;
    stopModel = model.subscribe(emit); emit();
  };
  const contains = (group: SearchGroup, entry: SearchEntry) => visible() && source.getSnapshot().groups.some(result =>
    result.id === group && result.status === 'success' && result.items.includes(entry));
  const pick = async (group: SearchGroup, entry: SearchEntry, batch?: number) => {
    if (batch === undefined) batchGeneration++;
    else if (batch !== batchGeneration) return;
    reconcile();
    const currentModel = model;
    if (!currentModel || pending || personal || !leaf(entry) || !contains(group, entry)) return;
    const id = nativeSearchEntryKey(group, entry), registered = windows.get(id);
    if (registered) {currentModel.toggle(registered.windowId, registered.key); return;}
    if (windows.size >= 256) {feedback.reportError(unavailable(), 'search'); return;}
    const controller = new AbortController(), captured = token, route = context.navigation.getSnapshot().revision;
    pending = controller; emit();
    const current = () => !controller.signal.aborted && visible() && model === currentModel && token === captured
      && keyFor(source.getSnapshot().search) === captured && context.navigation.getSnapshot().revision === route && contains(group, entry);
    try {
      observePlayback();
      const port = context.playback.cataloguePlayback?.();
      const item = await readCatalogueSelectionItem({api: context.api, scope: authority.scope, requestId: feedback.requestId,
        signal: controller.signal, isCurrent: current}, entry, {play: !!port, queue: !!port && queueControl(), myList: true, favorite: true, watched: true});
      if (!current()) throw cancelled();
      const groups = source.getSnapshot().groups, sectionOrder = groups.findIndex(result => result.id === group);
      const start = groups[sectionOrder].items.indexOf(entry);
      const windowId = `search-${windows.size}`;
      const registration = currentModel.registerWindow(currentModel.captureContext(), {id: windowId, sectionId: group, sectionOrder,
        start, items: [item]});
      if (!registration.ok) throw unavailable();
      const key = selectionKey(currentModel.getSnapshot().context.scope, item);
      windows.set(id, {key, windowId, item, entry, group});
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
      && context.navigation.getSnapshot().revision === route && keyFor(source.getSnapshot().search) === captured;
    const unique = distinctLeaves();
    if (unique.length > 256) {feedback.reportError(unavailable(), 'search'); return;}
    for (const row of unique) {
      if (!current()) return;
      const registered = windows.get(nativeSearchEntryKey(row.group, row.entry));
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
      && keyFor(source.getSnapshot().search) === captured && context.navigation.getSnapshot().revision === route
      && currentModel.isOperationCurrent(operation) && operation.target.mode === 'explicit'
      && operation.target.items.every(pick => [...windows.values()].some(window => window.key === pick.key && contains(window.group, window.entry)))
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
      && keyFor(source.getSnapshot().search) === captured && context.navigation.getSnapshot().revision === route
      && currentModel.isOperationCurrent(operation) && operation.target.mode === 'explicit'
      && operation.target.items.every(pick => [...windows.values()].some(window => window.key === pick.key && contains(window.group, window.entry)));
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
  const off = [source.subscribe(reconcile), activation.subscribe(reconcile), context.subscribeAuthority(reconcile),
    context.navigation.subscribe(() => {batchGeneration++; pending?.abort(); reconcile();})];
  reconcile();
  const store = {subscribe: (listener: () => void) => {listeners.add(listener); return () => {listeners.delete(listener);};},
    getSnapshot: () => revision, loadedCount: () => distinctLeaves().length, snapshot: () => model?.getSnapshot(), personal: () => personal?.service.getSnapshot(), busy: () => !!pending || !!personal?.service.getSnapshot().busy, queueControl,
    clear: () => {if (personal?.service.getSnapshot().busy) return; batchGeneration++; pending?.abort(); closePersonal(); model?.clear(); emit();}, selectLoaded, execute, applyPersonal, retryPersonal};
  const port: NativeSearchSelectionPort = {
    register: () => {reconcile(); return () => {};},
    item: (group, entry) => {
      if (!leaf(entry) || !contains(group, entry)) return undefined;
      const snapshot = model?.getSnapshot(), registered = windows.get(nativeSearchEntryKey(group, entry));
      return {active: snapshot?.active ?? false, selected: !!registered && !!snapshot?.selectedKeys.includes(registered.key),
        onEnter: () => {void pick(group, entry);}, onToggle: () => {void pick(group, entry);}};
    },
    render: () => <SearchSelectionBars store={store}/>,
  };
  return Object.freeze({...port, subscribe: store.subscribe, getSnapshot: store.getSnapshot,
    dispose: () => {if (disposed) return; disposed = true; off.forEach(stop => stop()); reset(); listeners.clear();}});
}

type Store = {subscribe(listener: () => void): () => void; getSnapshot(): number; snapshot(): ReturnType<SelectionModel['getSnapshot']> | undefined;
  personal(): ReturnType<ReturnType<typeof createCataloguePersonalSelection>['service']['getSnapshot']> | undefined;
  applyPersonal(action: 'myList' | 'removeMyList' | 'favorite' | 'watched' | 'unwatched'): Promise<void>; retryPersonal(): Promise<void>;
  loadedCount(): number; busy(): boolean; queueControl(): boolean; clear(): void; selectLoaded(): Promise<void>; execute(action: 'play' | 'playNext' | 'playLater'): Promise<void>};
function SearchSelectionBars({store}: {store: Store}) {
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
  if (state.summary.every.watched) actions.push({id: 'watched', disabled: store.busy()}, {id: 'unwatched', disabled: store.busy()});
  if (actions.some(action => ['removeMyList', 'favorite', 'watched', 'unwatched'].includes(action.id))) actions.push({id: 'more', disabled: store.busy()});
  const personal = store.personal();
  const props: SelectionBarProps = {count: state.summary.count, selectionLabel: selectedItemsLabel(state.summary),
    selectAllLabel: defaultI18n.t('next.selection.selectAll', {count: store.loadedCount()}), onSelectAll: () => {void store.selectLoaded();}, onCancel: () => {setMenu(null); store.clear();},
    actions, menu, onMenuChange: setMenu, topInset: insets.top, fourthSlot: selectionFourthAction(state.summary) === 'mark-watched' ? 'watched' : 'myList',
    onAction: action => {if (action === 'play' || action === 'playNext' || action === 'playLater') {setMenu(null); void store.execute(action);}
      else if (action === 'myList' || action === 'removeMyList' || action === 'favorite' || action === 'watched' || action === 'unwatched') {setMenu(null); void store.applyPersonal(action);}}};
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
        <Text style={[theme.type.body, {color: theme.colors.textSecondary}]}>{result.status === 'saved' ? defaultI18n.t('next.selection.saved')
          : result.status === 'waiting' || result.status === 'working' ? defaultI18n.t('next.states.loading')
            : presentError({code: result.status === 'conflict' ? 'metadata_conflict' : result.status === 'unavailable' ? 'access_refused' : 'unavailable'}, 'detail', {operation: 'action'}).body}</Text>
      </View>)}
    </Dialog>}
  </>;
}
