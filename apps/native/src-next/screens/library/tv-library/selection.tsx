import React, {useState, useSyncExternalStore} from 'react';
import {View} from 'react-native';
import {defaultI18n} from '../../../../../../packages/i18n/src';
import type {ContentEntry} from '../../../../../../packages/client-core/src/library-content';
import type {BrowseSelectionContext, SelectionSnapshot} from '../../../../../../packages/client-core/src/selection-model';
import type {CardSelection} from '../../kit/cards';
import type {LayoutSelection} from '../../kit/layout';
import {SelectionBar, type SelectionActionOffer, type SelectionBarProps} from '../../kit/selection';
import {useTheme} from '../../kit/theme';
import type {NativeShellBootstrapContext} from '../../shell/bootstrap';
import type {NativeLibrarySelectionPort} from '../LibraryScreen';
import {nativeLibraryEntryKey, type NativeLibraryDestination, type NativeLibrarySnapshot} from '../model';
import {createNativeLibraryPlaySelection} from '../play-selection';

type Snapshot = SelectionSnapshot<BrowseSelectionContext>;
type LoadedWindow = Readonly<{entries: readonly ContentEntry[]; toggle: (entry: ContentEntry, range?: boolean) => unknown; dispose: () => void}>;
type Store = Readonly<{
  subscribe: (listener: () => void) => () => void;
  getSnapshot: () => number;
  snapshot: () => Snapshot;
  loadedCount: () => number;
  play: () => Promise<void>;
  queue: (placement: 'next' | 'end') => Promise<void>;
  selectLoaded: () => void;
  clear: () => void;
}>;

/** tv select 23 is the drawn state: selection begins by picking the held title
 * in the hold-OK menu, so the port never enters an empty selection of its own.
 * Every control offered here has a real executor behind it; My List, Watched
 * and the picker join only once their own executor is wired. */
export function createNativeTVLibrarySelection(context: NativeShellBootstrapContext, source: NativeLibraryDestination): NativeLibrarySelectionPort {
  const selection = createNativeLibraryPlaySelection(context, source);
  const model = selection.model, listeners = new Set<() => void>(), picked = new Set<string>();
  let disposed = false, revision = 0, window: LoadedWindow | undefined, layout: LayoutSelection | undefined, layoutRevision = -1;
  const snapshot = (): Snapshot => model.getSnapshot();
  const emit = () => {revision++; for (const listener of [...listeners]) listener();};
  const entryFor = (key: string) => window?.entries.find(entry => nativeLibraryEntryKey(entry) === key);
  const toggle = (entry: ContentEntry) => {
    if (disposed || !window) return;
    const key = nativeLibraryEntryKey(entry);
    try {
      const change = window.toggle(entry) as {ok?: boolean};
      if (change?.ok === false) return;
      if (picked.has(key)) picked.delete(key); else picked.add(key);
      emit();
    } catch { /* A retired window or destination owns no selection. */ }
  };
  const clearPicked = () => {if (picked.size) picked.clear();};
  model.subscribe(() => {if (!snapshot().active) clearPicked(); emit();});
  // LayoutSelection identity changes only with the real selection revision.
  const layoutSnapshot = (): LayoutSelection => {
    if (layout && layoutRevision === revision) return layout;
    layoutRevision = revision;
    layout = Object.freeze({active: snapshot().active, isSelected: (key: string) => picked.has(key),
      onToggle: (key: string) => {const entry = entryFor(key); if (entry) toggle(entry);},
      onEnter: (key: string) => {const entry = entryFor(key); if (entry) toggle(entry);}});
    return layout;
  };
  const store: Store = {
    subscribe: listener => {listeners.add(listener); return () => {listeners.delete(listener);};},
    getSnapshot: () => revision,
    snapshot,
    loadedCount: () => window?.entries.length ?? 0,
    play: async () => {if (disposed || !snapshot().active) return; await selection.play(); if (!disposed) store.clear();},
    queue: async placement => {if (disposed || !snapshot().active) return; await selection.queue(placement); if (!disposed) store.clear();},
    selectLoaded: () => {for (const entry of window?.entries ?? []) if (!picked.has(nativeLibraryEntryKey(entry))) toggle(entry);},
    clear: () => {if (disposed) return; model.clear(); clearPicked(); emit();},
  };
  return Object.freeze({
    /** The drawn entry is a pick from the hold-OK menu, not an empty selection. */
    start: () => {},
    subscribe: store.subscribe,
    getSnapshot: layoutSnapshot,
    register: (_source: NativeLibrarySnapshot, entries: readonly ContentEntry[], first: number) => {
      if (disposed) return () => {};
      let live = true;
      void selection.prepareWindow(`tv-library:${first}:${entries.length}`, first, entries).then(result => {
        if (!live || disposed) {result.dispose(); return;}
        window?.dispose();
        window = {entries, toggle: result.toggle, dispose: result.dispose};
        emit();
      }).catch(() => { /* prepareWindow retires with its destination; a stale range owns nothing. */ });
      return () => {live = false; if (window && window.entries === entries) {window.dispose(); window = undefined;}};
    },
    item: (entry: ContentEntry): CardSelection => ({active: snapshot().active, selected: picked.has(nativeLibraryEntryKey(entry)),
      onToggle: () => toggle(entry), onEnter: () => toggle(entry)}),
    render: () => <TVLibrarySelectionBars store={store}/>,
  });
}

function TVLibrarySelectionBars({store}: {store: Store}) {
  useSyncExternalStore(store.subscribe, store.getSnapshot);
  const theme = useTheme(), [menu, setMenu] = useState<SelectionBarProps['menu']>(null);
  const state = store.snapshot();
  if (!state.active) return null;
  const actions: SelectionActionOffer[] = [];
  if (state.summary.every.play) actions.push({id: 'play'});
  if (state.summary.every.queue) actions.push({id: 'queue'}, {id: 'playNext'}, {id: 'playLater'});
  const props: SelectionBarProps = {testID: 'tv-library-selection', count: state.summary.count,
    selectionLabel: defaultI18n.t('next.selection.native.titles', {count: state.summary.count}),
    selectAllLabel: defaultI18n.t('next.selection.selectAll', {count: store.loadedCount()}), onSelectAll: store.selectLoaded,
    onCancel: () => {setMenu(null); store.clear();}, actions, menu, onMenuChange: setMenu,
    onAction: action => {
      if (action === 'play') {setMenu(null); void store.play();}
      else if (action === 'playNext') {setMenu(null); void store.queue('next');}
      else if (action === 'playLater') {setMenu(null); void store.queue('end');}
    }};
  return <View pointerEvents="box-none" style={{position: 'absolute', inset: 0, zIndex: theme.layers.navigation + 1}}>
    <View style={{position: 'absolute', left: 200, right: 96, top: 58}}><SelectionBar {...props}/></View>
  </View>;
}
