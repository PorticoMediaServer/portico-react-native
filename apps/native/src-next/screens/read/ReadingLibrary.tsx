import React, {useEffect, useMemo, useRef, useState, useSyncExternalStore, type ReactNode} from 'react';
import {ScrollView, Text, View, useWindowDimensions} from 'react-native';
import {useSafeAreaInsets} from 'react-native-safe-area-context';
import {generatedCoverTint} from '@portico/design';
import {defaultI18n} from '../../../../../packages/i18n/src';
import type {ReadingItem} from '../../../../../packages/client-core/src';
import {libraryTabs, type LibraryTabId} from '../../../../../packages/client-core/src/presentation/library-tabs';
import {GeneratedCover} from '../../kit/artwork';
import {ReadResumeCard, SeriesTile} from '../../kit/cards';
import {Focusable} from '../../kit/controls';
import {Icon} from '../../kit/Icon';
import {Menu, type MenuEntry} from '../../kit/overlays';
import {StateView} from '../../kit/states';
import {browseType} from '../../kit/browse/presentation';
import {useTheme} from '../../kit/theme';
import type {NativeShellBootstrapContext} from '../../shell/bootstrap';
import type {NativeShellRuntime} from '../../shell/runtime';
import {LibraryCompactHeader, LibraryTabs} from '../library/LibraryScreen';
import {isReadingLibraryKind} from './platform';
import {NativeReadingDiscovery, type NativeReadingSeriesSummary} from './reading-discovery';
import {NativeReadingLibrary} from './reading-library';

export type NativeReadingLibraryScreenProps = Readonly<{
  context: NativeShellBootstrapContext;
  runtime: NativeShellRuntime;
  libraryId: string;
  title: string;
  onBack: () => void;
}>;

const initial = (title: string): string => title.trim().slice(0, 1).toUpperCase() || '·';
const tint = (title: string) => generatedCoverTint(title);
const cover = (item: ReadingItem, width: number, height: number) => <GeneratedCover title={item.title}
  author={item.author?.value} glyph={initial(item.title)} tint={tint(item.title)} width={width} height={height}/>;
const authorPart = (item: ReadingItem) => item.author ? [{id: 'author', text: item.author.value, role: 'identity' as const}] : [];

/** phone-read frames 1 and 2: Discover (real Continue reading, Recently added
 * and opt-in series rows) and Books/Volumes (the bounded Reading list). The
 * other drawn rows need producers that are not consumed yet, so they are
 * omitted rather than faked; the series row uses the server's real summary and
 * opens the signed series page, and no generic content browse, word-count
 * estimate or per-volume state is invented. An item opens its own book page,
 * whose series link reaches the same signed series page. */
export function NativeReadingLibraryScreen(props: NativeReadingLibraryScreenProps) {
  const {context, runtime, libraryId, title, onBack} = props, theme = useTheme(), insets = useSafeAreaInsets(), dimensions = useWindowDimensions();
  const library = context.libraries().find(value => value.id === libraryId);
  const kind = library?.kind === 'comic' ? 'comic' : 'book';
  const name = library?.name ?? title, tabs = libraryTabs(kind);
  const [tab, setTab] = useState<LibraryTabId>('discover'), [switcherOpen, setSwitcherOpen] = useState(false), fellBack = useRef(false);
  const discovery = useMemo(() => new NativeReadingDiscovery(context, libraryId), [context, libraryId]);
  const books = useMemo(() => new NativeReadingLibrary(context, libraryId), [context, libraryId]);
  useEffect(() => () => {discovery.dispose(); books.dispose();}, [discovery, books]);
  const discoveryState = useSyncExternalStore(discovery.subscribe, discovery.getSnapshot);
  const booksState = useSyncExternalStore(books.subscribe, books.getSnapshot);
  useEffect(() => {
    if (tab === 'discover') void discovery.load().catch(runtime.reportError);
    else void books.load().catch(runtime.reportError);
  }, [tab, discovery, books, runtime]);
  // A ready Discover with neither real row has nothing to show; the library's
  // own Books/Volumes grid is the honest destination, never a false empty copy.
  useEffect(() => {
    if (tab === 'discover' && !fellBack.current && discoveryState.phase === 'ready' && !discoveryState.continueItems.length && !discoveryState.recent.length && !discoveryState.series.length) {fellBack.current = true; setTab('browse');}
  }, [tab, discoveryState]);
  const readingLibraries = context.libraries().filter(value => isReadingLibraryKind(value.kind));
  const switcherItems: MenuEntry[] = readingLibraries.map(value => ({id: value.id, label: value.name, selected: value.id === libraryId,
    onSelect: () => {setSwitcherOpen(false); if (value.id !== libraryId) runtime.onDestination({kind: 'library', libraryId: value.id});}}));
  const switcher = <Focusable accessibilityRole="button" focusKind="row" accessibilityLabel={defaultI18n.t('next.browse.native.switchLibraryNamed', {name})}
    disabled={readingLibraries.length < 2} onPress={() => setSwitcherOpen(true)} style={{flexDirection: 'row', alignItems: 'center', gap: 4}}>
    <Text numberOfLines={1} style={[browseType(theme, 17, 700), {color: theme.colors.text, maxWidth: 170}]}>{name}</Text>
    {readingLibraries.length > 1 ? <Icon name="i-down" size={14} color={theme.colors.textSecondary}/> : null}
  </Focusable>;
  const openDiscover = (item: ReadingItem) => {void discovery.open(item).catch(runtime.reportError);};
  const openSeries = (summary: NativeReadingSeriesSummary) => {void discovery.openSeries(summary).catch(runtime.reportError);};
  const openBooks = (item: ReadingItem) => {void books.open(item).catch(runtime.reportError);};
  const retryDiscover = () => {void discovery.retry().catch(runtime.reportError);};
  const retryBooks = () => {void books.retry().catch(runtime.reportError);};
  const retry = <StateView testID="reading-library-error" variant="inline" {...runtime.error(tab === 'discover' ? discoveryState.error : booksState.error, tab === 'discover' ? retryDiscover : retryBooks, 'library')}/>;
  const empty = <StateView testID="reading-library-empty" variant="inline" title={defaultI18n.t('library.emptyLibrary')} body={defaultI18n.t('library.emptyLibraryBody')}/>;
  const loading = <Text style={[browseType(theme, 14, 500), {color: theme.colors.textTertiary, padding: 20}]}>{defaultI18n.t('status.loading')}</Text>;
  const columns = 3, gap = 16, width = Math.max(96, (dimensions.width - theme.gutter * 2 - gap * (columns - 1)) / columns);
  const discover = <ScrollView testID="reading-discover" contentContainerStyle={{paddingBottom: insets.bottom + 40}}>
    {discoveryState.phase === 'error' ? retry : null}
    {discoveryState.phase === 'loading' && !discoveryState.continueItems.length && !discoveryState.recent.length && !discoveryState.series.length ? loading : null}
    {discoveryState.continueItems.length ? <DiscoveryRow first title={defaultI18n.t('next.cards.read')}>
      {discoveryState.continueItems.map(row => <ReadResumeCard key={row.item.id} testID={`reading-continue-${row.item.id}`} width={296}
        title={row.item.title} caption={authorPart(row.item)} detail={row.progress.location.section ? [{id: 'section', text: row.progress.location.section, role: 'context'}] : []}
        progress={Math.min(0.999, Math.max(0, row.progress.location.progression))} palette={tint(row.item.title)}
        artworkFallback={<View accessible={false} importantForAccessibility="no-hide-descendants">{cover(row.item, 81, 122)}</View>}
        onNavigate={() => openDiscover(row.item)}/>)}
    </DiscoveryRow> : null}
    {discoveryState.recent.length ? <DiscoveryRow title={defaultI18n.t('home.row.recentlyAdded')} first={!discoveryState.continueItems.length} onSeeAll={() => setTab('browse')}>
      {discoveryState.recent.map(item => <DiscoveryCoverCard key={item.id} item={item} width={116} onOpen={openDiscover}/>)}
    </DiscoveryRow> : null}
    {discoveryState.series.length ? <DiscoveryRow title={defaultI18n.t('library.tab.series')} first={!discoveryState.continueItems.length && !discoveryState.recent.length}>
      {discoveryState.series.map(summary => <SeriesTile key={summary.id} testID={`reading-series-${summary.id}`} title={summary.name}
        caption={[{id: 'read', text: defaultI18n.t('next.reader.seriesReadCount', {read: defaultI18n.number(summary.readCount), count: defaultI18n.number(summary.count)}), role: 'identity'}]}
        covers={[]} segments={[]} visible
        renderCoverFallback={index => summary.preview[index] ? cover(summary.preview[index], 50, 67) : null}
        onNavigate={() => openSeries(summary)}/>)}
    </DiscoveryRow> : null}
  </ScrollView>;
  const booksGrid = <ScrollView testID="reading-books" contentContainerStyle={{padding: theme.gutter, paddingBottom: insets.bottom + 40}}
    onScroll={event => {const {contentOffset, contentSize, layoutMeasurement} = event.nativeEvent;
      if (contentSize.height - contentOffset.y - layoutMeasurement.height < layoutMeasurement.height) void books.more().catch(runtime.reportError);}} scrollEventThrottle={64}>
    {booksState.phase === 'error' ? retry : null}
    {booksState.phase === 'loading' && !booksState.items.length ? loading : null}
    {booksState.phase === 'ready' && !booksState.items.length ? empty : null}
    {booksState.items.length ? <View style={{flexDirection: 'row', flexWrap: 'wrap', gap}}>
      {booksState.items.map(item => <DiscoveryCoverCard key={item.id} item={item} width={width} onOpen={openBooks}/>)}
    </View> : null}
  </ScrollView>;
  return <View testID={`native-reading-library-${libraryId}`} style={{flex: 1, backgroundColor: theme.colors.ink}}>
    <LibraryCompactHeader switcher={switcher} onLibraries={onBack} testID="native-reading-library-header">
      <LibraryTabs items={tabs} selected={tab} enabled phone={theme.platform === 'phone'} regionId={`reading-tabs-${libraryId}`}
        leftEdge="reading-tabs-edge" onSelect={id => setTab(id)}/>
    </LibraryCompactHeader>
    {tab === 'discover' ? discover : booksGrid}
    <Menu open={switcherOpen} onOpenChange={setSwitcherOpen} title={defaultI18n.t('next.browse.native.switchLibrary')} items={switcherItems}/>
  </View>;
}

/** The drawn Read row heading and its horizontal track (phone-read frames 1-3). */
function DiscoveryRow({title, first = false, onSeeAll, children}: {title: string; first?: boolean; onSeeAll?: () => void; children?: ReactNode}) {
  const theme = useTheme();
  return <View style={{marginTop: first ? 14 : 44}}>
    <View style={{flexDirection: 'row', alignItems: 'baseline', gap: 14, paddingHorizontal: theme.gutter, marginBottom: 14}}>
      <Text accessibilityRole="header" style={[browseType(theme, 22, 700, -.015), {color: theme.colors.text}]}>{title}</Text>
      {onSeeAll ? <Focusable accessibilityRole="button" accessibilityLabel={title} focusKind="row" onPress={onSeeAll}
        style={{width: 44, height: 44, marginLeft: -8, alignItems: 'flex-start', justifyContent: 'center'}}>
        <Icon name="i-right" size={18} color={theme.colors.textTertiary}/>
      </Focusable> : null}
    </View>
    <ScrollView horizontal showsHorizontalScrollIndicator={false}
      contentContainerStyle={{gap: 16, paddingHorizontal: theme.gutter, paddingTop: 10, paddingBottom: 14}}>{children}</ScrollView>
  </View>;
}

/** One sparse-metadata cover: the drawn 116-wide 3:4 art with the title and
 * author under it, using the catalogue's canonical generated cover. */
function DiscoveryCoverCard({item, width, onOpen}: {item: ReadingItem; width: number; onOpen: (item: ReadingItem) => void}) {
  const theme = useTheme(), height = width * 4 / 3;
  return <Focusable testID={`reading-item-${item.id}`} accessibilityRole="button" accessibilityLabel={item.title} focusKind="row"
    onPress={() => onOpen(item)} style={{width}}>
    <View accessible={false} importantForAccessibility="no-hide-descendants" style={{width, height, borderRadius: 10, overflow: 'hidden'}}>{cover(item, width, height)}</View>
    <Text numberOfLines={1} style={[browseType(theme, 12.5, 600), {color: theme.colors.text, marginTop: 7}]}>{item.title}</Text>
    {item.author ? <Text numberOfLines={1} style={[browseType(theme, 11.5, 500), {color: theme.colors.textTertiary, marginTop: 2}]}>{item.author.value}</Text> : null}
  </Focusable>;
}
