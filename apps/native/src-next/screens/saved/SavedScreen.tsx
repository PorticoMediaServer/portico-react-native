import React, {useCallback, useEffect, useRef, useSyncExternalStore, type RefObject} from 'react';
import {ScrollView, Text, View} from 'react-native';
import {useSafeAreaInsets} from 'react-native-safe-area-context';
import {defaultI18n, type MessageId} from '../../../../../packages/i18n/src';
import type {ContentEntry} from '../../../../../packages/client-core/src/library-content';
import type {PinnedResource} from '../../../../../packages/client-core/src/library-pins';
import type {SavedEntry, SavedRoute, SavedSnapshot} from '../../../../../packages/client-core/src/saved';
import {PosterCard, SquareCard, type CardSelection} from '../../kit/cards';
import {Focusable} from '../../kit/controls';
import {StateView} from '../../kit/states';
import {Icon, type IconName} from '../../kit/Icon';
import {browseType, alpha} from '../../kit/browse/presentation';
import {useTheme} from '../../kit/theme';
import {groupOfflineEntries, type NativeOfflineDownloadsAdapter} from '../../platform/offline-downloads';
import type {NativeShellRuntime} from '../../shell/runtime';
import {homeCardText} from '../home/model';
import {NativeSavedDestination} from './model';
import {SavedDownloadCard, type NativeSavedDownloadsCopy} from './SavedDownloadCard';
import type {NativeDestinationActivationPort} from '../destinations/focus';

const t = defaultI18n.t;
const content = (entry: SavedEntry): entry is ContentEntry => entry.kind !== 'playlist' && entry.kind !== 'playlist_entry';
export type NativeSavedActions = Readonly<{
  openView: (view: SavedRoute) => void; openEntry: (entry: ContentEntry) => void; menuEntry: (entry: ContentEntry, anchorRef?: RefObject<View | null>) => void;
  isMenuOpen?: (entry: ContentEntry) => boolean;
  openDownloads: () => void; openPin: (pin: PinnedResource) => void; editPins: () => void;
}>;
export type NativeSavedSelectionPort = Readonly<{
  register: (snapshot: SavedSnapshot) => () => void;
  item: (entry: ContentEntry) => CardSelection;
  render: () => React.ReactNode;
}>;
export type NativeSavedScreenProps = Readonly<{
  destination: NativeSavedDestination; runtime: NativeShellRuntime; device: NativeOfflineDownloadsAdapter;
  actions: NativeSavedActions; selection?: NativeSavedSelectionPort; onThisPhone: MessageId;
  downloadsCopy: NativeSavedDownloadsCopy;
  activation: NativeDestinationActivationPort;
}>;

/** phone-app9: Saved is the genuine hub, with My List and actual device downloads.
 * Every other row opens its existing SavedRoute; pins keep the producer's order. */
export function SavedScreen({destination, runtime, device, actions, selection, onThisPhone, downloadsCopy, activation}: NativeSavedScreenProps) {
  const theme = useTheme(), insets = useSafeAreaInsets(), scroll = useRef<ScrollView>(null);
  const snapshot = useSyncExternalStore(destination.subscribe, destination.getSnapshot);
  const downloads = useSyncExternalStore(device.subscribe, device.getSnapshot);
  const active = useSyncExternalStore(activation.subscribe, activation.getSnapshot);
  const report = useCallback((error: unknown) => runtime.reportError(error), [runtime]);
  useEffect(() => {void destination.load().catch(report); void device.open().catch(report);}, [destination, device, report]);
  useEffect(() => selection?.register(snapshot.myList), [selection, snapshot.myList]);
  useEffect(() => runtime.registerScrollToTop({kind: 'saved'}, () => scroll.current?.scrollTo({y: 0, animated: !theme.reduceMotion})), [runtime, theme.reduceMotion]);
  // The actual server shape window supplies the drawn poster preview. Filtering
  // one mixed page locally could hide later posters and misstate its count.
  const items = snapshot.myList.projection?.sections.flatMap(section => section.entries.filter(content)) ?? [];
  const localGroups = groupOfflineEntries(downloads.entries);
  const summary = snapshot.summary;
  const rows: readonly {id: string; label: MessageId; icon: IconName; count?: number; view: SavedRoute}[] = [
    {id: 'favorites', label: 'saved.tab.favorites', icon: 'i-heart', count: summary && summary.favorites.posters + summary.favorites.squares, view: {view: 'favorites'}},
    {id: 'playlists', label: 'saved.tab.playlists', icon: 'i-queue', count: summary?.playlists, view: {view: 'playlists'}},
    {id: 'collections', label: 'saved.tab.collections', icon: 'i-stack', count: summary?.collections, view: {view: 'collections'}},
    {id: 'views', label: 'saved.tab.savedViews', icon: 'i-filter', count: summary?.savedViews, view: {view: 'views'}},
    {id: 'history', label: 'saved.tab.history', icon: 'i-clock', view: {view: 'history'}},
  ];
  return <View testID="native-saved-screen" pointerEvents={active.visible ? 'auto' : 'none'} accessibilityElementsHidden={!active.visible}
    importantForAccessibility={active.visible ? 'auto' : 'no-hide-descendants'} style={{flex: 1, backgroundColor: theme.colors.ink}}>
    <ScrollView ref={scroll} contentContainerStyle={{paddingTop: Math.max(58, insets.top), paddingBottom: 28}}>
      <Text accessibilityRole="header" style={[browseType(theme, 36, 800, -.035, 39), {color: theme.colors.text, marginHorizontal: 20, marginBottom: 18}]}>{t('saved.title')}</Text>
      {snapshot.phase === 'error' && <StateView {...runtime.error(snapshot.error, () => {void destination.load().catch(report);})}/>}
      <SavedRowHeading testID="saved-my-list" title={t('saved.tab.watchlist')} detail={summary ? t('next.selection.titles', {count: summary.myList.posters + summary.myList.squares}) : undefined} onPress={() => actions.openView({view: 'watchlist'})}/>
      {!!items.length && <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{paddingHorizontal: 16, gap: 10}}>
        {items.map(entry => <SavedMyListCard key={entry.id} entry={entry} runtime={runtime} actions={actions} selection={selection?.item(entry)}/>)}
      </ScrollView>}
      {downloads.supported && <>
        <SavedRowHeading testID="saved-downloads" title={t('downloads.title')} detail={t(onThisPhone, {size: defaultI18n.bytes(downloads.usedBytes)})} onPress={actions.openDownloads}/>
        {!!localGroups.length && <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{paddingHorizontal: 16, gap: 10}}>
          {localGroups.map(group => <SavedDownloadCard key={group.key} group={group} device={device} copy={downloadsCopy} onOpen={actions.openDownloads}/>)}
        </ScrollView>}
      </>}
      <View style={{marginHorizontal: 16, marginTop: 24, borderRadius: 14, backgroundColor: theme.colors.raised, overflow: 'hidden'}}>
        {rows.map((row, index) => <SavedLink key={row.id} testID={`saved-view-${row.id}`} label={t(row.label)} icon={row.icon} value={row.count === undefined ? undefined : defaultI18n.number(row.count)} separator={index > 0} onPress={() => actions.openView(row.view)}/>)}
      </View>
      <View style={{flexDirection: 'row', alignItems: 'baseline', justifyContent: 'space-between', marginTop: 24, marginHorizontal: 20, marginBottom: 6}}>
        <Text accessibilityRole="header" style={[browseType(theme, 19, 700, -.015), {color: theme.colors.text}]}>{t('pins.heading')}</Text>
        <Focusable testID="saved-edit-pins" accessibilityLabel={t('pins.edit')} onPress={actions.editPins} hitSlop={12}><Text style={[browseType(theme, 14, 600), {color: theme.colors.textTertiary}]}>{t('pins.edit')}</Text></Focusable>
      </View>
      <View style={{marginHorizontal: 16, borderRadius: 14, backgroundColor: theme.colors.raised, overflow: 'hidden'}}>
        {snapshot.pins.map((pin, index) => <SavedLink key={JSON.stringify([pin.kind, pin.id])} testID={`saved-pin-${pin.kind}-${encodeURIComponent(pin.id)}`} label={pin.name}
          icon={pin.kind === 'playlist' ? 'i-queue' : pin.kind === 'collection' ? 'i-stack' : 'i-filter'} separator={index > 0} onPress={() => actions.openPin(pin)}/>)}
      </View>
    </ScrollView>
    {selection?.render()}
  </View>;
}

function SavedMyListCard({entry, runtime, actions, selection}: {entry: ContentEntry; runtime: NativeShellRuntime; actions: NativeSavedActions; selection?: CardSelection}) {
  const menuAnchorRef = useRef<View>(null), text = homeCardText(entry, false, runtime.text);
  const props = {testID: `saved-my-list-${encodeURIComponent(entry.id)}`, title: entry.displayTitle || entry.title, caption: text.caption, width: 112,
    artwork: runtime.artwork(entry.posterUrl), onNavigate: () => actions.openEntry(entry), onMore: () => actions.menuEntry(entry, menuAnchorRef), selection,
    menuAnchorRef, moreExpanded: actions.isMenuOpen?.(entry)};
  return entry.kind === 'song' || entry.kind === 'album' || entry.kind === 'book' || entry.kind === 'audiobook_file' ? <SquareCard {...props}/> : <PosterCard {...props}/>;
}

function SavedRowHeading({title, detail, onPress, testID}: {title: string; detail?: string; onPress: () => void; testID: string}) {
  const theme = useTheme();
  return <Focusable testID={testID} accessibilityLabel={title} onPress={onPress} style={{flexDirection: 'row', alignItems: 'baseline', justifyContent: 'space-between', gap: 12, marginHorizontal: 20, marginTop: 2, marginBottom: 12}}>
    <View style={{flexDirection: 'row', alignItems: 'center'}}><Text accessibilityRole="header" style={[browseType(theme, 19, 700, -.015), {color: theme.colors.text}]}>{title}</Text><Icon name="i-right" size={18} color={theme.colors.textTertiary}/></View>
    {detail && <Text style={[browseType(theme, 13, 600), {color: theme.colors.textTertiary}]}>{detail}</Text>}
  </Focusable>;
}

function SavedLink({label, icon, value, separator, onPress, testID}: {label: string; icon: IconName; value?: string; separator: boolean; onPress: () => void; testID: string}) {
  const theme = useTheme();
  return <Focusable testID={testID} accessibilityLabel={label} onPress={onPress} style={{position: 'relative', flexDirection: 'row', alignItems: 'center', minHeight: 48, paddingVertical: 8, paddingHorizontal: 14, gap: 12}}>
    {separator && <View style={{position: 'absolute', left: 56, right: 0, top: 0, height: 1, backgroundColor: alpha(theme.colors.lineStrong, .45)}}/>}
    <View style={{width: 30, height: 30, borderRadius: 8, alignItems: 'center', justifyContent: 'center', backgroundColor: theme.colors.raisedBright}}><Icon name={icon} size={18} color={theme.colors.textSecondary}/></View>
    <Text numberOfLines={1} style={[browseType(theme, 15.5, 600), {color: theme.colors.text, flex: 1}]}>{label}</Text>
    {value !== undefined && <Text style={[browseType(theme, 14.5, 600), {color: theme.colors.textTertiary}]}>{value}</Text>}
    <Icon name="i-right" size={18} color={theme.colors.lineStrong}/>
  </Focusable>;
}
