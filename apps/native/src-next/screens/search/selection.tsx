import React, {useState, useSyncExternalStore} from 'react';
import {View} from 'react-native';
import {useSafeAreaInsets} from 'react-native-safe-area-context';
import {defaultI18n} from '../../../../../packages/i18n/src';
import type {ContentEntry} from '../../../../../packages/client-core/src/library-content';
import type {SearchEntry, SearchGroup, SearchSnapshot} from '../../../../../packages/client-core/src/search';
import {SelectionModel, selectionKey, readCatalogueSelectionItem, playCatalogueSelection, enqueueCatalogueSelection,
  type SelectionContext, type SelectionItem} from '../../../../../packages/client-core/src/selection-model';
import type {NativeShellBootstrapContext} from '../../shell/bootstrap';
import {selectedItemsLabel} from '../../shell/selection-display';
import {SelectionBar, SelectionPhoneActionBar, type SelectionActionOffer, type SelectionBarProps} from '../../kit/selection';
import {useTheme} from '../../kit/theme';
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
  const listeners = new Set<() => void>(), windows = new Map<string, {key: string; item: SelectionItem}>();
  let model: SelectionModel | undefined, stopModel: (() => void) | undefined, token = '', revision = 0, disposed = false;
  let pending: AbortController | undefined;
  const emit = () => {revision++; for (const listener of [...listeners]) listener();};
  const keyFor = (snapshot: SearchSnapshot) => snapshot.phase === 'ready' && snapshot.data
    ? JSON.stringify([snapshot.generation, snapshot.data.scope.viewerFence, snapshot.data.revision, snapshot.data.query]) : '';
  const visible = () => !disposed && authority.current() && activation.getSnapshot().visible;
  const queueControl = () => {
    const role = context.playback.getSnapshot().session?.role;
    return role === undefined || role === 'local';
  };
  const reset = () => {
    pending?.abort(); pending = undefined; stopModel?.(); stopModel = undefined;
    model?.dispose(); model = undefined; windows.clear(); token = ''; emit();
  };
  const reconcile = () => {
    const snapshot = source.getSnapshot().search, next = visible() ? keyFor(snapshot) : '';
    if (next === token) return;
    reset();
    if (!next || !snapshot.data) return;
    const viewer = context.session()?.viewer;
    if (!viewer || viewer.authority !== 'local' && viewer.authority !== 'hosted') return;
    const captured: SelectionContext = {scope: {serverId: viewer.serverId, authority: viewer.authority,
      accountId: viewer.accountId, profileId: viewer.profileId, viewId: JSON.stringify(['native-search', snapshot.generation, snapshot.data.query]),
      privacyFence: snapshot.data.scope.viewerFence}, revision: {catalogRevision: String(snapshot.data.revision.catalog), viewerRevision: String(snapshot.data.revision.viewer)}};
    model = new SelectionModel(captured, {maxWindows: 256, maxRegisteredItems: 256}); token = next;
    stopModel = model.subscribe(emit); emit();
  };
  const contains = (group: SearchGroup, entry: SearchEntry) => visible() && source.getSnapshot().groups.some(result =>
    result.id === group && result.status === 'success' && result.items.includes(entry));
  const pick = async (group: SearchGroup, entry: SearchEntry) => {
    reconcile();
    const currentModel = model;
    if (!currentModel || pending || !leaf(entry) || !contains(group, entry)) return;
    const id = nativeSearchEntryKey(group, entry), registered = windows.get(id);
    if (registered) {currentModel.toggle(id, registered.key); return;}
    if (windows.size >= 256) {feedback.reportError(unavailable(), 'search'); return;}
    const controller = new AbortController(), captured = token, route = context.navigation.getSnapshot().revision;
    pending = controller; emit();
    const current = () => !controller.signal.aborted && visible() && model === currentModel && token === captured
      && keyFor(source.getSnapshot().search) === captured && context.navigation.getSnapshot().revision === route && contains(group, entry);
    try {
      const port = context.playback.cataloguePlayback();
      const item = await readCatalogueSelectionItem({api: context.api, scope: authority.scope, requestId: feedback.requestId,
        signal: controller.signal, isCurrent: current}, entry, {play: !!port, queue: !!port && queueControl()});
      if (!current()) throw cancelled();
      const groups = source.getSnapshot().groups, sectionOrder = groups.findIndex(result => result.id === group);
      const start = groups[sectionOrder].items.indexOf(entry);
      const registration = currentModel.registerWindow(currentModel.captureContext(), {id, sectionId: group, sectionOrder,
        start, items: [item]});
      if (!registration.ok) throw unavailable();
      const key = selectionKey(currentModel.getSnapshot().context.scope, item);
      windows.set(id, {key, item});
      const selected = currentModel.toggle(id, key);
      if (!selected.ok) throw unavailable();
    } catch (error) {if (current()) feedback.reportError(error, 'search');}
    finally {if (pending === controller) {pending = undefined; emit();}}
  };
  const selectLoaded = async () => {
    reconcile();
    if (pending || !model || !visible()) return;
    const captured = token;
    const rows = source.getSnapshot().groups.filter(group => group.status === 'success').flatMap(group =>
      group.items.filter(leaf).map(entry => ({group: group.id, entry})));
    const unique = [...new Map(rows.map(row => [JSON.stringify([row.entry.libraryId, row.entry.kind, row.entry.id]), row])).values()];
    if (unique.length > 256) {feedback.reportError(unavailable(), 'search'); return;}
    for (const row of unique) {
      if (!visible() || token !== captured) return;
      const registered = windows.get(nativeSearchEntryKey(row.group, row.entry));
      if (registered && model?.getSnapshot().selectedKeys.includes(registered.key)) continue;
      await pick(row.group, row.entry);
    }
  };
  const execute = async (action: 'play' | 'playNext' | 'playLater') => {
    reconcile();
    const currentModel = model, operation = currentModel?.captureOperation();
    if (!currentModel || !operation || operation.target.mode !== 'explicit' || pending || !visible()) return;
    const controller = new AbortController(), captured = token, route = context.navigation.getSnapshot().revision;
    const queue = action !== 'play';
    const current = () => !controller.signal.aborted && visible() && model === currentModel && token === captured
      && keyFor(source.getSnapshot().search) === captured && context.navigation.getSnapshot().revision === route
      && currentModel.isOperationCurrent(operation) && (!queue || queueControl());
    pending = controller; emit();
    try {
      const port = context.playback.cataloguePlayback();
      if (!port || !current()) throw unavailable();
      const target = operation.target;
      const items = (queue ? target.items : target.displayItems).map(value => value.item);
      if (queue) await enqueueCatalogueSelection(port, items, action === 'playNext' ? 'next' : 'end', {signal: controller.signal, isCurrent: current});
      else await playCatalogueSelection(port, items, {signal: controller.signal, isCurrent: current});
      if (current()) currentModel.clear();
    } catch (error) {if (current()) feedback.reportError(error, 'search');}
    finally {if (pending === controller) {pending = undefined; emit();}}
  };
  const off = [source.subscribe(reconcile), activation.subscribe(reconcile), context.subscribeAuthority(reconcile),
    context.navigation.subscribe(() => {pending?.abort(); reconcile();}), context.playback.subscribe(emit)];
  reconcile();
  const store = {subscribe: (listener: () => void) => {listeners.add(listener); return () => {listeners.delete(listener);};},
    getSnapshot: () => revision, snapshot: () => model?.getSnapshot(), busy: () => !!pending, queueControl,
    clear: () => {pending?.abort(); model?.clear();}, selectLoaded, execute};
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
  busy(): boolean; queueControl(): boolean; clear(): void; selectLoaded(): Promise<void>; execute(action: 'play' | 'playNext' | 'playLater'): Promise<void>};
function SearchSelectionBars({store}: {store: Store}) {
  useSyncExternalStore(store.subscribe, store.getSnapshot);
  const theme = useTheme(), insets = useSafeAreaInsets(), [menu, setMenu] = useState<SelectionBarProps['menu']>(null);
  const state = store.snapshot();
  if (!state?.active) return null;
  const actions: SelectionActionOffer[] = [];
  if (state.summary.every.play) actions.push({id: 'play', disabled: store.busy()});
  if (state.summary.every.queue && store.queueControl()) actions.push({id: 'queue', disabled: store.busy()},
    {id: 'playNext', disabled: store.busy()}, {id: 'playLater', disabled: store.busy()});
  const props: SelectionBarProps = {count: state.summary.count, selectionLabel: selectedItemsLabel(state.summary),
    selectAllLabel: defaultI18n.t('next.selection.native.selectAll'), onSelectAll: () => {void store.selectLoaded();}, onCancel: () => {setMenu(null); store.clear();},
    actions, menu, onMenuChange: setMenu, topInset: insets.top,
    onAction: action => {if (action === 'play' || action === 'playNext' || action === 'playLater') {setMenu(null); void store.execute(action);}}};
  return <View pointerEvents="box-none" style={{position: 'absolute', inset: 0, zIndex: theme.layers.navigation + 1}}>
    <View style={theme.isTV ? {position: 'absolute', left: 200, right: 96, top: 58} : undefined}><SelectionBar {...props}/></View>
    {!theme.isTV && <View style={{position: 'absolute', left: 0, right: 0, bottom: 0}}><SelectionPhoneActionBar {...props} bottomInset={Math.max(34, insets.bottom)}/></View>}
  </View>;
}
