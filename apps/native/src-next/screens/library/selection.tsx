import React, {useState, useSyncExternalStore} from 'react';
import {Text, View} from 'react-native';
import {useSafeAreaInsets} from 'react-native-safe-area-context';
import {defaultI18n} from '../../../../../packages/i18n/src';
import {presentError} from '../../../../../packages/client-core/src/presentation/errors';
import type {ContentEntry} from '../../../../../packages/client-core/src/library-content';
import {createCataloguePersonalSelection, enqueueCatalogueSelection, selectionFourthAction,
  type BrowseSelectionContext, type SelectionSnapshot} from '../../../../../packages/client-core/src/selection-model';
import {mediaSelectionKey} from '../../../../../packages/client-core/src/media-selection';
import type {NativeShellBootstrapContext} from '../../shell/bootstrap';
import {selectedItemsLabel} from '../../shell/selection-display';
import {SelectionBar, SelectionPhoneActionBar, type SelectionActionOffer, type SelectionBarProps} from '../../kit/selection';
import type {LayoutSelection} from '../../kit/layout';
import {useTheme} from '../../kit/theme';
import {Dialog} from '../../kit/overlays';
import {Button} from '../../kit/controls';
import {nativeDestinationLifetime} from '../destinations/lifetime';
import type {NativeDestinationActivationPort} from '../destinations/focus';
import {nativeScreenServices} from '../native-screen-services';
import {nativeLibraryEntryKey, type NativeLibraryDestination} from './model';
import type {NativeLibrarySelectionPort} from './LibraryScreen';
import {createNativeLibraryPlaySelection} from './play-selection';

type Producer = ReturnType<typeof createNativeLibraryPlaySelection>;
type RegisteredWindow = Readonly<{id: string; first: number; entries: readonly ContentEntry[]; keys: ReadonlyMap<ContentEntry, string>; toggle: (entry: ContentEntry) => void; dispose: () => void}>;

/** Real selection over the library's own applied Browse view.
 *
 * Toggling works on the genuine entries the grid registers, and every action the
 * bar offers is one the canonical Detail projection enables for *every* pick:
 * Play, Add to queue, My List, Favorites and Watched. Edit, delete, download and
 * the playlist/collection pickers have no executor on this surface, so their
 * capabilities stay false and the bar never draws them.
 *
 * Select all is deliberately absent. It means the whole result (select.html #5),
 * which needs the whole-query membership descriptor; this view is windowed, so a
 * loaded window is never presented as all of it. */
export function createNativeLibrarySelection(context: NativeShellBootstrapContext, source: NativeLibraryDestination, activation: NativeDestinationActivationPort) {
  const lifetime = nativeDestinationLifetime(context), services = nativeScreenServices(context);
  const listeners = new Set<() => void>(), windows = new Map<string, RegisteredWindow>();
  const pendingWindows = new Map<string, {first: number; entries: readonly ContentEntry[]; gone: boolean; reading: boolean; window?: RegisteredWindow}>();
  let disposed = false, revision = 0, entering = false, token = '';
  let producer: Producer | undefined, stopModel: (() => void) | undefined;
  let pending: AbortController | undefined, personalController: AbortController | undefined, queued: string | undefined;
  let personal: ReturnType<typeof createCataloguePersonalSelection> | undefined, personalCurrent: (() => boolean) | undefined;
  const emit = () => {revision++; for (const listener of [...listeners]) listener();};
  const visible = () => !disposed && lifetime.current() && activation.getSnapshot().visible;
  const model = () => producer?.model;
  const snapshot = (): SelectionSnapshot<BrowseSelectionContext> | undefined => model()?.getSnapshot();
  const sourceToken = () => {
    const now = source.getSnapshot();
    return now.phase === 'ready' && now.collection ? JSON.stringify([now.library.id, now.tab.id, now.revision, now.queryRevision]) : '';
  };
  const reset = () => {
    pending?.abort(); pending = undefined; queued = undefined;
    personalController?.abort(); personalController = undefined; personalCurrent = undefined;
    if (personal) {personal.dispose(); personal = undefined;}
    stopModel?.(); stopModel = undefined;
    producer?.dispose(); producer = undefined;
    // Every read still in flight is told so before anything is cleared, so its
    // completion can never install a window into the next query.
    for (const entry of pendingWindows.values()) entry.gone = true;
    pendingWindows.clear();
    for (const window of windows.values()) window.dispose();
    windows.clear(); token = ''; entering = false;
  };
  // The producer disposes itself when the applied view changes; rebuild it there
  // so every registration belongs to exactly one real query.
  const ensure = (): Producer | undefined => {
    const next = sourceToken();
    if (!next || !visible()) {if (token) reset(); return undefined;}
    if (producer && next === token) return producer;
    reset();
    try {
      producer = createNativeLibraryPlaySelection(context, source);
      stopModel = producer.model.subscribe(() => {if (producer?.model.getSnapshot().active) entering = false; emit();});
      token = next; emit();
      return producer;
    } catch {return undefined;}
  };
  // The grid addresses entries by its own stable key; the selection model has its
  // own key per entry. Every lookup here translates between the two.
  const keyOf = (entry: ContentEntry) => [...windows.values()].find(window => window.keys.has(entry))?.keys.get(entry);
  const windowForEntry = (entry: ContentEntry) => [...windows.values()].find(window => window.keys.has(entry));
  const entryForKey = (key: string) => {
    for (const window of windows.values()) for (const entry of window.keys.keys()) if (nativeLibraryEntryKey(entry) === key) return entry;
    for (const pending of pendingWindows.values()) {
      const entry = pending.entries.find(value => nativeLibraryEntryKey(value) === key);
      if (entry) return entry;
    }
    return undefined;
  };
  // A window is only read when selection actually starts: registering every
  // visible range would otherwise fetch a Detail page per card on plain scrolling.
  const prepare = (id: string) => {
    const current = ensure(), entry = pendingWindows.get(id);
    if (!current || !entry || entry.gone || pendingWindows.get(id) !== entry || windows.has(id) || entry.reading) return;
    const readToken = token;
    entry.reading = true;
    void current.prepareWindow(id, entry.first, entry.entries).then(window => {
      // The completion belongs only to this producer, token, pending record and
      // query; a reset, Back or newer query discards it instead of installing it.
      const stillCurrent = !entry.gone && visible() && producer === current && token === readToken
        && pendingWindows.get(id) === entry && !!sourceToken() && sourceToken() === token;
      if (!stillCurrent) {window.dispose(); return;}
      const next: RegisteredWindow = {id, first: entry.first, entries: entry.entries, keys: window.keys, toggle: window.toggle, dispose: window.dispose};
      entry.window = next; windows.set(id, next);
      if (current.model.getSnapshot().active) entering = false;
      emit();
      // The pick that asked for this window is applied once, now that the model
      // holds its real registered key.
      if (queued) {const key = queued; queued = undefined; toggle(key);}
    }).catch(() => {}).finally(() => {entry.reading = false;});
  };
  const prepareAll = () => {for (const id of pendingWindows.keys()) prepare(id);};
  const entriesFor = (keys: readonly string[]) => {
    const picked: ContentEntry[] = [];
    for (const window of windows.values()) for (const [entry, key] of window.keys) if (keys.includes(key)) picked.push(entry);
    return picked;
  };
  const selectedKeys = () => snapshot()?.selectedKeys ?? [];
  const toggle = (key: string) => {
    const entry = entryForKey(key);
    if (!entry) return;
    const window = windowForEntry(entry);
    if (!window) {
      // The first pick reads its own visible window, then applies the pick to the
      // real model; nothing is marked selected before the model accepts it.
      const holder = [...pendingWindows.entries()].find(([, pending]) => pending.entries.includes(entry));
      entering = true; queued = key; emit();
      if (holder) prepare(holder[0]);
      return;
    }
    try {window.toggle(entry); entering = true; emit();} catch (error) {if (visible()) services.reportError(error, 'library');}
  };
  const clear = () => {entering = false; model()?.clear(); emit();};
  const loaded = (): ContentEntry[] => [...windows.values()].flatMap(window => [...window.entries]);
  const queueControl = () => {
    const role = context.playback.getSnapshot().session?.role;
    return role === undefined || role === 'local';
  };
  const execute = async (action: 'play' | 'playNext' | 'playLater', view: SelectionSnapshot<BrowseSelectionContext>) => {
    // A retained menu acts on the selection it was drawn for, never on a successor.
    if (view !== snapshot()) return;
    const current = producer, op = current?.model.captureOperation();
    if (!current || !op || op.target.mode !== 'explicit' || !visible() || pending || personal?.service.getSnapshot().busy) return;
    const controller = new AbortController(), live = () => !controller.signal.aborted && visible() && producer === current && current.model.isOperationCurrent(op);
    pending = controller; emit();
    try {
      if (action === 'play') await current.play();
      else {
        const port = context.playback.cataloguePlayback?.();
        if (!port || !queueControl()) throw Object.assign(new Error('native_library_queue_unavailable'), {code: 'unavailable'});
        await enqueueCatalogueSelection(port, op.target.items.map(value => value.item), action === 'playNext' ? 'next' : 'end', {signal: controller.signal, isCurrent: live});
      }
      if (live()) clear();
    } catch (error) {if (visible()) services.reportError(error, 'library');}
    finally {if (pending === controller) {pending = undefined; emit();}}
  };
  const applyPersonal = async (action: 'myList' | 'removeMyList' | 'favorite' | 'watched' | 'unwatched', view: SelectionSnapshot<BrowseSelectionContext>) => {
    // The same identity rule as Play: the rendered snapshot must still be the
    // live one before any operation or transport is captured.
    if (view !== snapshot()) return;
    const current = producer, op = current?.model.captureOperation();
    if (!current || !op || op.target.mode !== 'explicit' || !visible() || pending || personal?.service.getSnapshot().busy) return;
    const capability = action === 'myList' || action === 'removeMyList' ? 'myList' : action === 'favorite' ? 'favorite' : 'watched';
    if (!view.summary.every[capability] || !op.target.items.every(value => value.item.capabilities[capability])) return;
    const entries = entriesFor(op.target.items.map(value => value.key));
    if (entries.length !== op.target.items.length) return;
    const controller = new AbortController(), live = () => !controller.signal.aborted && visible() && producer === current && current.model.isOperationCurrent(op);
    personalController = controller; personalCurrent = live;
    personal = createCataloguePersonalSelection({api: context.api, scope: lifetime.scope, requestId: services.requestId, signal: controller.signal, isCurrent: live});
    personal.service.setEntries(entries); personal.service.begin();
    for (const entry of entries) personal.service.toggle(mediaSelectionKey(entry));
    emit();
    try {await personal.service.apply(capability === 'myList' ? 'watchlist' : capability, action !== 'removeMyList' && action !== 'unwatched');}
    catch (error) {if (live()) services.reportError(error, 'library');}
    finally {if (personalController === controller) personalController = undefined; emit();}
  };
  const retryPersonal = async () => {
    if (!personal || !personalCurrent?.() || personal.service.getSnapshot().busy) return;
    try {await personal.service.retry();} catch (error) {if (personalCurrent?.()) services.reportError(error, 'library');}
  };
  const store = {subscribe: (listener: () => void) => {listeners.add(listener); return () => {listeners.delete(listener);};},
    getSnapshot: () => revision, snapshot, loadedCount: () => loaded().length, personal: () => personal?.service.getSnapshot(),
    busy: () => !!pending || !!personal?.service.getSnapshot().busy, active: () => entering || !!snapshot()?.active, queueControl, clear, execute, applyPersonal, retryPersonal};
  // useSyncExternalStore compares snapshots by identity: one layout object per
  // revision, never a fresh object on every read.
  let layoutVersion = -1, layoutSnapshot: LayoutSelection | undefined;
  const layout = (): LayoutSelection => {
    if (layoutSnapshot && layoutVersion === revision) return layoutSnapshot;
    layoutVersion = revision;
    // Both callbacks belong to the producer and query token this snapshot was
    // drawn from; a successor view never receives a stale key press.
    const owner = producer, ownerToken = token, live = () => owner === producer && ownerToken === token && !!owner;
    layoutSnapshot = Object.freeze({active: entering || !!snapshot()?.active,
      isSelected: (key: string) => live() && !!entryForKey(key) && selectedKeys().includes(keyOf(entryForKey(key)!) ?? ''),
      onToggle: (key: string) => {if (live()) toggle(key);}, onEnter: (key: string) => {if (live()) toggle(key);}});
    return layoutSnapshot;
  };
  const port: NativeLibrarySelectionPort = {
    start: () => {ensure(); entering = true; emit(); prepareAll();},
    subscribe: store.subscribe,
    getSnapshot: layout,
    register: (_source, entries, first) => {
      const current = ensure();
      if (!current || !entries.length) return () => {};
      const id = `library-window-${first}-${entries.length}`;
      const entry = {first, entries, gone: false, reading: false} as {first: number; entries: readonly ContentEntry[]; gone: boolean; reading: boolean; window?: RegisteredWindow};
      pendingWindows.set(id, entry);
      if (entering || current.model.getSnapshot().active) prepare(id);
      return () => {
        entry.gone = true;
        // Only the exact record and window this registration created may be
        // removed; a later registration can reuse the same first/length id.
        if (pendingWindows.get(id) === entry) pendingWindows.delete(id);
        const held = windows.get(id);
        if (held && entry.window === held) {windows.delete(id); held.dispose(); emit();}
      };
    },
    item: entry => {
      const owner = producer, ownerToken = token, key = nativeLibraryEntryKey(entry), live = () => owner === producer && ownerToken === token && !!owner;
      return {active: entering || !!snapshot()?.active,
        selected: live() && !!keyOf(entry) && selectedKeys().includes(keyOf(entry)!),
        onToggle: () => {if (live()) toggle(key);}, onEnter: () => {if (live()) toggle(key);}};
    },
    render: () => <LibrarySelectionBars store={store}/>,
  };
  const off = [activation.subscribe(() => {if (!visible()) reset(); emit();}), context.subscribeAuthority(() => {reset(); emit();})];
  return Object.freeze({...port, dispose: () => {if (disposed) return; disposed = true; off.forEach(stop => stop()); reset(); listeners.clear();}});
}

type Store = {subscribe(listener: () => void): () => void; getSnapshot(): number; snapshot(): SelectionSnapshot<BrowseSelectionContext> | undefined;
  personal(): ReturnType<ReturnType<typeof createCataloguePersonalSelection>['service']['getSnapshot']> | undefined;
  applyPersonal(action: 'myList' | 'removeMyList' | 'favorite' | 'watched' | 'unwatched', view: SelectionSnapshot<BrowseSelectionContext>): Promise<void>; retryPersonal(): Promise<void>;
  loadedCount(): number; busy(): boolean; active(): boolean; queueControl(): boolean; clear(): void;
  execute(action: 'play' | 'playNext' | 'playLater', view: SelectionSnapshot<BrowseSelectionContext>): Promise<void>};

function LibrarySelectionBars({store}: {store: Store}) {
  useSyncExternalStore(store.subscribe, store.getSnapshot);
  const theme = useTheme(), insets = useSafeAreaInsets(), [menu, setMenu] = useState<SelectionBarProps['menu']>(null);
  const state = store.snapshot();
  if (!store.active()) return null;
  const summary = state?.summary;
  const actions: SelectionActionOffer[] = [];
  if (summary?.every.play) actions.push({id: 'play', disabled: store.busy()});
  if (summary?.every.queue && store.queueControl()) actions.push({id: 'queue', disabled: store.busy()}, {id: 'playNext', disabled: store.busy()}, {id: 'playLater', disabled: store.busy()});
  if (summary?.every.myList) actions.push({id: 'myList', disabled: store.busy()}, {id: 'removeMyList', disabled: store.busy()});
  if (summary?.every.favorite) actions.push({id: 'favorite', disabled: store.busy()});
  if (summary?.every.watched) actions.push({id: 'watched', disabled: store.busy()}, {id: 'unwatched', disabled: store.busy()});
  if (actions.some(action => ['removeMyList', 'favorite', 'watched', 'unwatched'].includes(action.id))) actions.push({id: 'more', disabled: store.busy()});
  const personal = store.personal();
  const props: SelectionBarProps = {count: summary?.count ?? 0, selectionLabel: summary ? selectedItemsLabel(summary) : undefined,
    onCancel: () => {setMenu(null); store.clear();}, actions, menu, onMenuChange: setMenu,
    fourthSlot: summary && selectionFourthAction(summary) === 'mark-watched' ? 'watched' : 'myList',
    onAction: action => {
      if (action === 'play' || action === 'playNext' || action === 'playLater') {setMenu(null); void store.execute(action, state!);}
      else if (action === 'myList' || action === 'removeMyList' || action === 'favorite' || action === 'watched' || action === 'unwatched') {setMenu(null); void store.applyPersonal(action, state!);}
    }};
  return <>
    <View pointerEvents="box-none" style={{position: 'absolute', inset: 0, zIndex: theme.layers.navigation + 1}}>
      {!theme.isTV && <View style={{position: 'absolute', left: 0, right: 0, bottom: 0}}><SelectionPhoneActionBar {...props} bottomInset={Math.max(34, insets.bottom)}/></View>}
    </View>
    <SelectionBar {...props}/>
    {personal && summary && <Dialog open title={defaultI18n.t('next.selection.selectedItems', {items: selectedItemsLabel(summary)})}
      onOpenChange={open => {if (!open && !personal.busy) store.clear();}}
      footer={<><Button disabled={personal.busy} onPress={store.clear}>{defaultI18n.t('next.selection.done')}</Button>
        {personal.results.some(result => result.status === 'failed') && <Button disabled={personal.busy} onPress={() => {void store.retryPersonal();}}>{defaultI18n.t('next.selection.retry')}</Button>}</>}>
      {personal.results.map(result => <View key={result.key} style={{gap: 4, marginBottom: 12}}>
        <Text style={[theme.type.bodyStrong, {color: theme.colors.text}]}>{result.title}</Text>
        <Text style={[theme.type.body, {color: theme.colors.textSecondary}]}>{result.status === 'saved' ? defaultI18n.t('next.selection.saved') : presentError({code: 'unavailable'}, 'detail', {operation: 'action'}).body}</Text>
      </View>)}
    </Dialog>}
  </>;
}
