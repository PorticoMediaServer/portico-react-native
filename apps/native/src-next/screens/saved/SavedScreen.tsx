import React, {useCallback, useEffect, useRef, useState, useSyncExternalStore, type RefObject} from 'react';
import {BackHandler, ScrollView, Text, View} from 'react-native';
import {useSafeAreaInsets} from 'react-native-safe-area-context';
import {defaultI18n, type MessageId} from '../../../../../packages/i18n/src';
import type {ContentEntry} from '../../../../../packages/client-core/src/library-content';
import type {PinnedResource} from '../../../../../packages/client-core/src/library-pins';
import type {SavedEntry, SavedRoute, SavedSnapshot} from '../../../../../packages/client-core/src/saved';
import {presentError} from '../../../../../packages/client-core/src/presentation/errors';
import {PosterCard, SquareCard, type CardSelection} from '../../kit/cards';
import {Focusable, Tabs} from '../../kit/controls';
import {StateView} from '../../kit/states';
import {Icon, type IconName} from '../../kit/Icon';
import {browseType, alpha} from '../../kit/browse/presentation';
import {useTheme} from '../../kit/theme';
import {groupOfflineEntries, type NativeOfflineDownloadsDevice} from '../../platform/offline-downloads';
import type {NativeShellRuntime} from '../../shell/runtime';
import {homeCardText} from '../home/model';
import {NativeSavedDestination} from './model';
import {SavedDownloadCard, type NativeSavedDownloadsCopy} from './SavedDownloadCard';
import {openNativeSavedDownload} from '../downloads/playback';
import type {NativeDestinationActivationPort} from '../destinations/focus';
import type {NativeEntryMenuState} from '../destinations/entry-actions';

const t = defaultI18n.t;
const content = (entry: SavedEntry): entry is ContentEntry => entry.kind !== 'playlist' && entry.kind !== 'playlist_entry';
export type NativeSavedActions = Readonly<{
  menuState?: NativeEntryMenuState;
  openView: (view: SavedRoute) => void; openEntry: (entry: ContentEntry) => void; menuEntry: (entry: ContentEntry, anchorRef?: RefObject<View | null>) => void;
  isMenuOpen?: (entry: ContentEntry) => boolean;
  openDownloads: () => void; openPin: (pin: PinnedResource) => void; editPins: () => void;
  /** The wider My List grid re-reads the real watchlist by server sort/filter/shape. */
  selectMyList?: (route: SavedRoute) => Promise<void>;
  nextMyList?: (shape: 'posters' | 'squares', sectionId: string) => Promise<void>;
}>;
export type NativeSavedSelectionPort = Readonly<{
  register: (snapshot: SavedSnapshot) => () => void;
  item: (entry: ContentEntry) => CardSelection;
  render: (artwork?: (path?: string) => React.ReactNode) => React.ReactNode;
}>;
export type NativeSavedScreenProps = Readonly<{
  destination: NativeSavedDestination; runtime: NativeShellRuntime; device: NativeOfflineDownloadsDevice;
  actions: NativeSavedActions; selection?: NativeSavedSelectionPort; onThisPhone: MessageId;
  downloadsCopy: NativeSavedDownloadsCopy;
  activation: NativeDestinationActivationPort;
  /** Saved's own Downloads tab body. Present on handhelds that draw the wider Saved chrome. */
  downloads?: (runtime: NativeShellRuntime) => React.ReactNode;
}>;

/** phone-app9: Saved is the genuine hub, with My List and actual device downloads.
 * Every other row opens its existing SavedRoute; pins keep the producer's order. */
export function SavedScreen({destination, runtime, device, actions, selection, onThisPhone, downloadsCopy, activation, downloads}: NativeSavedScreenProps) {
  useSyncExternalStore(actions.menuState?.subscribe ?? (() => () => {}), actions.menuState?.getSnapshot ?? (() => 0));
  const theme = useTheme(), insets = useSafeAreaInsets(), scroll = useRef<ScrollView>(null);
  const snapshot = useSyncExternalStore(destination.subscribe, destination.getSnapshot);
  const deviceState = useSyncExternalStore(device.subscribe, device.getSnapshot);
  const active = useSyncExternalStore(activation.subscribe, activation.getSnapshot);
  const report = useCallback((error: unknown) => runtime.reportError(error), [runtime]);
  useEffect(() => {void destination.load().catch(report); void device.open().catch(report);}, [destination, device, report]);
  useEffect(() => selection?.register(snapshot.myList), [selection, snapshot.myList]);
  useEffect(() => runtime.registerScrollToTop({kind: 'saved'}, () => scroll.current?.scrollTo({y: 0, animated: !theme.reduceMotion})), [runtime, theme.reduceMotion]);
  // tablet11/11b/12: the wider Saved page keeps its real title and seven tabs around
  // the same routes. Downloads is the last tab and draws inside this page, so the shell
  // sidebar and this chrome stay in place; phone keeps the pushed page.
  const tablet = !theme.isTV && theme.platform !== 'phone';
  const [savedTab, setSavedTab] = useState<'watchlist' | 'downloads'>('watchlist');
  // A retained but hidden Saved page must never change its local tab or open a
  // downloadable view; the same current activation gates the existing actions.
  const visible = () => activation.getSnapshot().visible;
  const showDownloads = useCallback(() => {
    if (!visible()) return;
    if (tablet) {setSavedTab('downloads'); return;}
    actions.openDownloads();
  }, [activation, actions, tablet]);
  const chooseTab = (value: string) => {
    if (!visible()) return;
    if (value === 'downloads') {setSavedTab('downloads'); return;}
    setSavedTab('watchlist');
    if (value === 'watchlist') return;
    actions.openView({view: value as 'favorites' | 'playlists' | 'collections' | 'views' | 'history'});
  };
  const downloadsOpen = tablet && !!downloads && savedTab === 'downloads';
  useEffect(() => {
    if (!downloadsOpen || !active.visible) return;
    const subscription = BackHandler.addEventListener('hardwareBackPress', () => {if (!visible()) return false; setSavedTab('watchlist'); return true;});
    return () => subscription.remove();
  }, [active.visible, activation, downloadsOpen]);
  const tabItems = [
    {value: 'watchlist', label: t('saved.tab.watchlist')}, {value: 'favorites', label: t('saved.tab.favorites')},
    {value: 'playlists', label: t('saved.tab.playlists')}, {value: 'collections', label: t('saved.tab.collections')},
    {value: 'views', label: t('saved.tab.savedViews')}, {value: 'history', label: t('saved.tab.history')},
    {value: 'downloads', label: t('downloads.title')},
  ] as const;
  // The actual server shape window supplies the drawn poster preview. Filtering
  // one mixed page locally could hide later posters and misstate its count.
  const items = snapshot.myList.projection?.sections.flatMap(section => section.entries.filter(content)) ?? [];
  const localGroups = groupOfflineEntries(deviceState.entries);
  const summary = snapshot.summary;
  const rows: readonly {id: string; label: MessageId; icon: IconName; count?: number; view: SavedRoute}[] = [
    {id: 'favorites', label: 'saved.tab.favorites', icon: 'i-heart', count: summary && summary.favorites.posters + summary.favorites.squares, view: {view: 'favorites'}},
    {id: 'playlists', label: 'saved.tab.playlists', icon: 'i-queue', count: summary?.playlists, view: {view: 'playlists'}},
    {id: 'collections', label: 'saved.tab.collections', icon: 'i-stack', count: summary?.collections, view: {view: 'collections'}},
    {id: 'views', label: 'saved.tab.savedViews', icon: 'i-filter', count: summary?.savedViews, view: {view: 'views'}},
    {id: 'history', label: 'saved.tab.history', icon: 'i-clock', view: {view: 'history'}},
  ];
  // phone-app9 draws each shelf as the phone row: a 19 heading with its arrow,
  // the count beside it, and a 12-gap track inset by the 20 gutter.
  const track = {paddingHorizontal: theme.gutter, paddingTop: theme.spec.shelf.phonePaddingTop, paddingBottom: theme.spec.shelf.phonePaddingBottom, gap: theme.spec.shelf.gap[theme.platform]};
  const pinKind = (kind: PinnedResource['kind']) => kind === 'view' ? t('title.savedView') : t('title.kind', {kind});
  return <View testID="native-saved-screen" pointerEvents={active.visible ? 'auto' : 'none'} accessibilityElementsHidden={!active.visible}
    importantForAccessibility={active.visible ? 'auto' : 'no-hide-descendants'} style={{flex: 1, backgroundColor: theme.colors.ink}}>
    {tablet && <View style={{paddingTop: Math.max(insets.top, 10)}}>
      <Text accessibilityRole="header" style={[browseType(theme, 32, 800, -.035, 36.8), {color: theme.colors.text, marginHorizontal: theme.gutter}]}>{t('saved.title')}</Text>
      <Tabs items={tabItems} value={downloadsOpen ? 'downloads' : 'watchlist'} onValueChange={chooseTab} accessibilityLabel={t('saved.title')} testID="saved-tablet-tabs" style={{marginTop: 8}}/>
    </View>}
    {downloadsOpen ? <View style={{flex: 1}}>{downloads(runtime)}</View>
      : <ScrollView ref={scroll} contentContainerStyle={{paddingTop: tablet ? 8 : Math.max(58, insets.top), paddingBottom: 28}}>
      {!tablet && <View style={{paddingHorizontal: theme.gutter, paddingBottom: 12}}>
        <Text accessibilityRole="header" style={[browseType(theme, 32, 800, -.035, 36.8), {color: theme.colors.text}]}>{t('saved.title')}</Text>
      </View>}
      {snapshot.phase === 'error' && <StateView variant="inline" title={t('saved.loadFailed')} body={presentError(snapshot.error, 'saved', {operation: 'load'}).body}
        primaryAction={{id: 'retry', label: t('saved.retry'), onPress: () => {void destination.load().catch(report);}}}/>}
      <SavedSection first>
        <SavedRowHeading testID="saved-my-list" title={t('saved.tab.watchlist')} detail={summary ? t('next.selection.titles', {count: summary.myList.posters + summary.myList.squares}) : undefined} onPress={() => actions.openView({view: 'watchlist'})}/>
        {!!items.length && <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={track}>
          {items.map(entry => <SavedMyListCard key={entry.id} entry={entry} runtime={runtime} actions={actions} selection={selection?.item(entry)}/>)}
        </ScrollView>}
      </SavedSection>
      {!tablet && deviceState.supported && <SavedSection>
        <SavedRowHeading testID="saved-downloads" title={t('downloads.title')} detail={t(onThisPhone, {size: defaultI18n.bytes(deviceState.usedBytes)})} onPress={showDownloads}/>
        {!!localGroups.length && <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={track}>
          {localGroups.map(group => <SavedDownloadCard key={group.key} group={group} device={device} copy={downloadsCopy} onOpen={() => openNativeSavedDownload(device, group, showDownloads, report)}/>)}
        </ScrollView>}
      </SavedSection>}
      {!tablet && <View style={{marginHorizontal: 16, marginTop: 24, borderRadius: 14, backgroundColor: theme.colors.raised, overflow: 'hidden'}}>
        {rows.map((row, index) => <SavedLink key={row.id} testID={`saved-view-${row.id}`} label={t(row.label)} icon={row.icon} value={row.count === undefined ? undefined : defaultI18n.number(row.count)} separator={index > 0} onPress={() => actions.openView(row.view)}/>)}
      </View>}
      <View style={{flexDirection: 'row', alignItems: 'baseline', justifyContent: 'space-between', marginTop: 24, marginHorizontal: theme.gutter, marginBottom: 6}}>
        <Text accessibilityRole="header" style={[theme.type.rowHeading, {color: theme.colors.text}]}>{t('pins.heading')}</Text>
        <Focusable testID="saved-edit-pins" accessibilityLabel={t('pins.edit')} onPress={actions.editPins} hitSlop={12}><Text style={[browseType(theme, 14, 600), {color: theme.colors.textTertiary}]}>{t('pins.edit')}</Text></Focusable>
      </View>
      {!!snapshot.pins.length && <View style={{marginHorizontal: 16, borderRadius: 14, backgroundColor: theme.colors.raised, overflow: 'hidden'}}>
        {snapshot.pins.map((pin, index) => <SavedLink key={JSON.stringify([pin.kind, pin.id])} testID={`saved-pin-${pin.kind}-${encodeURIComponent(pin.id)}`} label={pin.name} caption={pinKind(pin.kind)}
          icon={pin.kind === 'playlist' ? 'i-queue' : pin.kind === 'collection' ? 'i-stack' : 'i-filter'} separator={index > 0} onPress={() => actions.openPin(pin)}/>)}
      </View>}
    </ScrollView>}
    {!downloadsOpen && selection?.render()}
  </View>;
}

/** The phone row opens its full view and keeps the drawn 28 shelf rhythm; the
 * first row sits 2 below the large title's 12 bottom padding. */
function SavedSection({first = false, children}: {first?: boolean; children: React.ReactNode}) {
  const theme = useTheme();
  return <View style={{marginTop: first ? 2 : theme.spec.shelf.marginTop[theme.platform]}}>{children}</View>;
}

function SavedMyListCard({entry, runtime, actions, selection}: {entry: ContentEntry; runtime: NativeShellRuntime; actions: NativeSavedActions; selection?: CardSelection}) {
  const menuAnchorRef = useRef<View>(null), text = homeCardText(entry, false, runtime.text);
  const props = {testID: `saved-my-list-${encodeURIComponent(entry.id)}`, title: entry.displayTitle || entry.title, caption: text.caption,
    artwork: runtime.artwork(entry.posterUrl), onNavigate: () => actions.openEntry(entry), onMore: () => actions.menuEntry(entry, menuAnchorRef), selection,
    menuAnchorRef, moreExpanded: actions.isMenuOpen?.(entry)};
  return entry.kind === 'song' || entry.kind === 'album' || entry.kind === 'book' || entry.kind === 'audiobook_file' ? <SquareCard {...props}/> : <PosterCard {...props}/>;
}

function SavedRowHeading({title, detail, onPress, testID}: {title: string; detail?: string; onPress: () => void; testID: string}) {
  const theme = useTheme();
  return <View style={{flexDirection: 'row', alignItems: 'baseline', gap: theme.spec.shelf.headingGap[theme.platform], marginHorizontal: theme.gutter,
    marginBottom: theme.spec.shelf.headingMargin[theme.platform]}}>
    <Focusable testID={testID} accessibilityRole="button" accessibilityLabel={title} onPress={onPress} focusRadius={8}
      style={{flexDirection: 'row', alignItems: 'center', gap: 1, flexShrink: 1}}>
      <Text accessibilityRole="header" numberOfLines={1} style={[theme.type.rowHeading, {color: theme.colors.text}]}>{title}</Text>
      <Icon name="i-right" size={18} color={theme.colors.textTertiary}/>
    </Focusable>
    {detail && <Text numberOfLines={1} style={[browseType(theme, 13, 400), {color: theme.colors.textTertiary}]}>{detail}</Text>}
  </View>;
}

function SavedLink({label, caption, icon, value, separator, onPress, testID}: {label: string; caption?: string; icon: IconName; value?: string; separator: boolean; onPress: () => void; testID: string}) {
  const theme = useTheme();
  return <Focusable testID={testID} accessibilityLabel={label} onPress={onPress} style={{position: 'relative', flexDirection: 'row', alignItems: 'center', minHeight: 48, paddingVertical: 8, paddingHorizontal: 14, gap: 12}}>
    {separator && <View style={{position: 'absolute', left: 56, right: 0, top: 0, height: 1, backgroundColor: alpha(theme.colors.lineStrong, .45)}}/>}
    <View style={{width: 30, height: 30, borderRadius: 8, alignItems: 'center', justifyContent: 'center', backgroundColor: theme.colors.raisedBright}}><Icon name={icon} size={18} color={theme.colors.textSecondary}/></View>
    <View style={{flex: 1, minWidth: 0}}>
      <Text numberOfLines={1} style={[browseType(theme, 15.5, 600), {color: theme.colors.text}]}>{label}</Text>
      {caption && <Text numberOfLines={1} style={[browseType(theme, 12.5, 500, 0, 17.5), {color: theme.colors.textTertiary, marginTop: 2}]}>{caption}</Text>}
    </View>
    {value !== undefined && <Text style={[browseType(theme, 14.5, 600), {color: theme.colors.textTertiary}]}>{value}</Text>}
    <Icon name="i-right" size={18} color={theme.colors.lineStrong}/>
  </Focusable>;
}
