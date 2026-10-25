import React, {useLayoutEffect, useRef, useState, useSyncExternalStore} from 'react';
import {ScrollView, Text, View, useWindowDimensions} from 'react-native';
import {useSafeAreaInsets} from 'react-native-safe-area-context';
import {generatedCoverTint} from '@portico/design';
import {defaultI18n} from '../../../../../packages/i18n/src';
import type {ReadingListMembership, ReadingManifest, ReadingReadMark} from '../../../../../packages/client-core/src';
import {Artwork, AmbientArt, GeneratedCover} from '../../kit/artwork';
import {Button, Focusable, Tabs} from '../../kit/controls';
import {Icon, type IconName} from '../../kit/Icon';
import {Menu, type MenuEntry} from '../../kit/overlays';
import {StateView, SkeletonBlock} from '../../kit/states';
import {alpha, browseType} from '../../kit/browse/presentation';
import {useTheme} from '../../kit/theme';
import {shellLayout} from '../../shell/model';
import {nativePublicationReadsAvailable} from '../../../platform/offline-reading';
import type {NativeShellRoute} from '../../shell/routes';
import type {NativeShellRuntime} from '../../shell/runtime';
import type {NativeReadBook} from './read-book-model';
import type {NativeReadVersion} from './read-book-model';

const {t} = defaultI18n;
const initials = (author: string): string => author.trim().split(/\s+/).slice(0, 2).map(part => part.slice(0, 1).toUpperCase()).join('') || '·';
const seriesNumber = (number: number, comic: boolean): string =>
  t(comic ? 'next.reader.volumeNumber' : 'next.reader.bookNumber', {number: defaultI18n.number(number, {maximumFractionDigits: 20})});
const ROW = {borderTopWidth: 1} as const;

type BookRoute = Extract<NativeShellRoute, {kind: 'read-book'}>;
type SeriesLink = Readonly<{id: string; name: string; number?: number}>;

/** phone-read 3/3c and tablet-read 2/2b/2c: the book's own page before the
 * reader. Real versions, manifest, saved position, declared contents and
 * descriptive facts only; choosing another real available version reloads this
 * page's projection for that source. The Read action is the one openNativeRead
 * door with the exact manifest it drew. */
export function ReadBookScreen({controller, route, comic, runtime, onBack, onOpenSettings}: {
  controller: NativeReadBook; route: BookRoute; comic: boolean; runtime: NativeShellRuntime; onBack: () => void; onOpenSettings: () => void;
}) {
  const state = useSyncExternalStore(controller.subscribe, controller.getSnapshot), theme = useTheme(), insets = useSafeAreaInsets(), dimensions = useWindowDimensions();
  // tablet-read 2/2b draw one reading column and one 380 pt contents column side by side;
  // 2c keeps the single column. The shell's own classification decides: a landscape phone
  // (wide but short, e.g. 914x411) stays a phone page, and portrait keeps one column.
  const layout = shellLayout(dimensions.width, dimensions.height, theme.isTV);
  const wide = dimensions.width > dimensions.height && layout.kind !== 'phone', rowHero = layout.kind !== 'phone';
  const [more, setMore] = useState(false), [tab, setTab] = useState('contents'), [heroHeight, setHeroHeight] = useState(0), [collapsed, setCollapsed] = useState(false);
  useLayoutEffect(() => {
    if (!controller.arm()) return;
    void controller.load().catch(() => {});
    return () => controller.release();
  }, [controller, route]);
  const manifest = state.manifest, title = manifest?.metadata.title ?? controller.item.title;
  const series = controller.series(), saved = manifest ? controller.savedProgression(manifest) : undefined;
  const savedProgress = state.progress?.progress;
  const currentSection = savedProgress && !savedProgress.stale ? savedProgress.location.section : undefined;
  const contents = manifest?.format === 'epub' ? manifest.contents ?? [] : [];
  const menu: readonly MenuEntry[] = [
    ...(state.read ? [{id: 'read-mark', label: t(state.read.read ? 'next.reader.markUnread' : 'next.reader.markRead'), icon: 'i-check' as IconName,
      onSelect: () => {setMore(false); toggleRead(state.read!);}}] : []),
    ...(contents.length ? [{id: 'details', label: t('next.reader.details'), selected: tab === 'details', onSelect: () => {setTab('details'); setMore(false);}}] : []),
    {id: 'settings', label: t('next.reader.openSettings'), onSelect: () => {setMore(false); onOpenSettings();}},
  ];
  const read = (target: ReadingManifest, index?: number) => {
    void controller.read(target, index).then(ok => {if (!ok) return;}).catch(runtime.reportError);
  };
  const toggleList = (membership: ReadingListMembership) => {
    void controller.toggleList(membership).then(ok => {if (!ok) return;}).catch(runtime.reportError);
  };
  const toggleRead = (mark: ReadingReadMark) => {
    void controller.toggleRead(mark).then(ok => {if (!ok) return;}).catch(runtime.reportError);
  };
  const downloadAnchor = useRef<View | null>(null);
  const canDownload = nativePublicationReadsAvailable();
  const download = (manifest: ReadingManifest) => {controller.download(manifest, downloadAnchor);};
  const openSeries = (target: SeriesLink, manifest: ReadingManifest) => {
    void controller.openSeries(target, manifest).then(ok => {if (!ok) return;}).catch(runtime.reportError);
  };
  const selectVersion = (manifest: ReadingManifest, versions: readonly NativeReadVersion[], sourceId: string) => {
    void controller.selectVersion(manifest, versions, sourceId).catch(runtime.reportError);
  };
  const body = state.phase === 'error'
    ? <StateView {...runtime.error(state.error, () => {void controller.retry().catch(runtime.reportError);}, 'detail')}/>
    : !manifest || state.phase !== 'ready'
      ? <SkeletonBlock width="100%" height={520}/>
      : <ReadBookBody controller={controller} manifest={manifest} series={series} comic={comic} runtime={runtime} wide={wide} rowHero={rowHero}
        saved={saved} currentSection={currentSection} tab={tab} onTab={setTab} onRead={read} onSeries={openSeries}
        versions={state.versions} sourceId={state.sourceId} onVersion={selectVersion}
        listed={state.listed} onList={toggleList} canDownload={canDownload} onDownload={download} downloadRef={downloadAnchor} onHeroHeight={setHeroHeight}/>;
  return <View testID={`native-read-book-${controller.item.id}`} style={{flex: 1, backgroundColor: theme.colors.ink}}>
    <View pointerEvents="none" style={{position: 'absolute', top: 0, left: 0, right: 0, height: 560, overflow: 'hidden'}}>
      {runtime.ambient(controller.item.coverUrl ?? manifest?.metadata.coverUrl) ? <AmbientArt source={runtime.ambient(controller.item.coverUrl ?? manifest?.metadata.coverUrl)} treatment="title" style={{position: 'absolute', top: 0, left: 0, right: 0, bottom: 0}}/> : null}
      <View style={{position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, backgroundColor: theme.colors.ink, opacity: .5}}/>
    </View>
    {rowHero ? <>
      <Button variant="icon" icon="i-left" iconOnly accessibilityLabel={t('action.back')} onPress={onBack}
        style={{position: 'absolute', top: insets.top + 6, left: 10, zIndex: 10, height: 44, width: 44}}/>
      <Button variant="icon" icon="i-more" iconOnly accessibilityLabel={t('next.controls.more')} onPress={() => setMore(true)}
        style={{position: 'absolute', top: insets.top + 6, right: 10, zIndex: 10, height: 44, width: 44}}/>
    </> : <>
      {/* phone-read 3/3c: past the hero the page pins its bar and the Contents/Details
          tabs, keeping the same back and More actions in place. */}
      <View pointerEvents={collapsed ? 'auto' : 'box-none'} style={{position: 'absolute', top: 0, left: 0, right: 0, zIndex: 10,
        paddingTop: insets.top + 6, height: insets.top + 50 + (collapsed && contents.length ? 42 : 0),
        backgroundColor: collapsed ? theme.colors.ink : 'transparent', borderBottomWidth: collapsed ? 1 : 0, borderBottomColor: theme.colors.line}}>
        <View pointerEvents="box-none" style={{height: 44, paddingHorizontal: 10, justifyContent: 'center'}}>
          <Button variant="icon" icon="i-left" iconOnly accessibilityLabel={t('action.back')} onPress={onBack} style={{height: 44, width: 44}}/>
          {collapsed ? <View pointerEvents="none" style={{position: 'absolute', left: 64, right: 64, height: 44, justifyContent: 'center'}}>
            <Text numberOfLines={1} style={[browseType(theme, 17, 700), {textAlign: 'center', color: theme.colors.text}]}>{title}</Text>
          </View> : null}
        </View>
        {collapsed && contents.length ? <Tabs testID="native-read-book-pin-tabs" value={tab} onValueChange={setTab} style={{height: 42}}
          items={[{value: 'contents', label: t('next.reader.contents')}, {value: 'details', label: t('next.reader.details')}]}/> : null}
      </View>
      <Button variant="icon" icon="i-more" iconOnly accessibilityLabel={t('next.controls.more')} onPress={() => setMore(true)}
        style={{position: 'absolute', top: insets.top + 6, right: 10, zIndex: 11, height: 44, width: 44}}/>
    </>}
    <ScrollView contentContainerStyle={{paddingTop: Math.max(96, insets.top + 56), paddingBottom: insets.bottom + 48}} showsVerticalScrollIndicator={false}
      scrollEventThrottle={64}
      onScroll={event => {const y = event.nativeEvent.contentOffset.y;
        setCollapsed(current => {const next = !rowHero && heroHeight > 0 && y > heroHeight - 50; return next === current ? current : next;});}}>
      {body}
    </ScrollView>
    <Menu open={more} onOpenChange={setMore} title={title} items={menu}/>
  </View>;
}

function ReadBookBody({controller, manifest, series, comic, runtime, wide, rowHero, saved, currentSection, tab, onTab, onRead, onSeries, versions, sourceId, onVersion, listed, onList, canDownload, onDownload, downloadRef, onHeroHeight}: {
  controller: NativeReadBook; manifest: ReadingManifest; series?: SeriesLink; comic: boolean; runtime: NativeShellRuntime; wide: boolean; rowHero: boolean;
  saved?: number; currentSection?: string; tab: string; onTab: (value: string) => void; onRead: (manifest: ReadingManifest, index?: number) => void;
  onSeries: (series: SeriesLink, manifest: ReadingManifest) => void;
  versions: readonly NativeReadVersion[]; sourceId?: string;
  onVersion: (manifest: ReadingManifest, versions: readonly NativeReadVersion[], sourceId: string) => void;
  listed?: ReadingListMembership; onList: (membership: ReadingListMembership) => void;
  canDownload: boolean; onDownload: (manifest: ReadingManifest) => void; downloadRef: React.RefObject<View | null>; onHeroHeight: (height: number) => void;
}) {
  const theme = useTheme(), [versionsOpen, setVersionsOpen] = useState(false);
  const selectedVersion = versions.find(version => version.sourceId === sourceId);
  const title = manifest.metadata.title || controller.item.title, author = manifest.metadata.author || controller.item.author?.value;
  const cover = runtime.artwork(controller.item.coverUrl ?? manifest.metadata.coverUrl), tint = generatedCoverTint(title);
  // tablet-read 2/2b draw the hero as a row (cover beside the copy) with an 84 pt
  // title and a 206 pt cover; 2c uses the med row (66/176); phone keeps the stack.
  // The shell's own classification decides, so a landscape phone is never a row.
  const coverWidth = rowHero ? (wide ? 206 : 176) : 168, coverHeight = coverWidth * 3 / 2;
  const titleSize = rowHero ? (wide ? 84 : 66) : 40;
  const duration = manifest.metadata.estimatedSeconds !== undefined ? defaultI18n.duration(manifest.metadata.estimatedSeconds) : '';
  const pages = manifest.metadata.pageCount ?? manifest.pageNames?.length;
  const contents = manifest.format === 'epub' ? manifest.contents ?? [] : [];
  const facts = [
    ...(manifest.metadata.wordCount !== undefined ? [t('next.reader.wordCount', {count: manifest.metadata.wordCount})] : []),
    ...(duration ? [duration] : []),
    ...(pages !== undefined ? [t('next.reader.pageCount', {count: pages})] : []),
    ...(contents.length ? [t('next.kit.chapters', {count: contents.length})] : []),
  ];
  const detailFacts = [
    ...(author ? [{label: t('filter.field.author'), value: author}] : []),
    {label: t('next.reader.format'), value: manifest.format.toUpperCase()},
    {label: t('next.reader.fileSize'), value: defaultI18n.bytes(manifest.size)},
    ...(manifest.metadata.language ? [{label: t('next.selection.language'), value: manifest.metadata.language}] : []),
    ...(pages !== undefined ? [{label: t('next.reader.pagesStrip'), value: defaultI18n.number(pages)}] : []),
    ...(contents.length ? [{label: t('next.reader.contents'), value: defaultI18n.number(contents.length)}] : []),
  ];
  const coverArt = <View style={{width: coverWidth, height: coverHeight, borderRadius: 7, overflow: 'hidden', backgroundColor: theme.colors.raised,
    shadowColor: theme.colors.shadow, shadowOpacity: .55, shadowRadius: 30, shadowOffset: {width: 0, height: 18}, elevation: 12}}>
    {cover ? <Artwork source={cover} width={coverWidth} height={coverHeight} priority/>
      : <GeneratedCover title={title} author={author} tint={tint} glyph={title.slice(0, 1).toUpperCase()}/>}
  </View>;
  const copy = <>
    {series ? <Focusable accessibilityRole="link" accessibilityLabel={series.name}
      onPress={() => onSeries(series, manifest)} style={{marginTop: rowHero ? 0 : 14, paddingVertical: 4, maxWidth: '100%'}}>
      <Text numberOfLines={2} style={[browseType(theme, 13.5, 600), {color: theme.colors.accentStrong, textAlign: rowHero ? 'left' : 'center'}]}>
        {series.name}{series.number !== undefined ? ` · ${seriesNumber(series.number, comic)}` : ''}
      </Text>
    </Focusable> : null}
    <Text accessibilityRole="header" numberOfLines={3} style={[browseType(theme, titleSize, 800, -.03), {color: theme.colors.text, textAlign: rowHero ? 'left' : 'center', marginTop: 6}]}>{title}</Text>
    {author ? <View style={{flexDirection: 'row', alignItems: 'center', gap: 7, marginTop: 8}}>
      <View style={{width: 22, height: 22, borderRadius: 11, alignItems: 'center', justifyContent: 'center', backgroundColor: theme.colors.raisedHigh}}>
        <Text style={[browseType(theme, 9.5, 800), {color: theme.colors.text}]}>{initials(author)}</Text>
      </View>
      <Text numberOfLines={1} style={[browseType(theme, 13, 700), {color: theme.colors.text, flexShrink: 1}]}>{author}</Text>
    </View> : null}
    {facts.length ? <View style={{flexDirection: 'row', flexWrap: 'wrap', justifyContent: rowHero ? 'flex-start' : 'center', columnGap: 12, rowGap: 6, marginTop: 8}}>
      {facts.map((fact, index) => <Text key={`${fact}-${index}`} style={[browseType(theme, 13, index === 0 ? 700 : 600), {color: index === 0 ? theme.colors.text : theme.colors.textSecondary}]}>{fact}</Text>)}
    </View> : null}
  </>;
  const actions = <View style={{paddingHorizontal: rowHero ? 0 : 20, marginTop: 18}}>
    <View style={{flexDirection: 'row', alignItems: 'center', gap: 10}}>
      <Button icon="i-book" progress={saved} onPress={() => onRead(manifest)} style={{flex: 1}}>
        {t(saved !== undefined ? 'next.cards.read' : 'next.reader.read')}
      </Button>
      <Button variant="icon" icon={listed?.listed ? 'i-check' : 'i-plus'} iconOnly disabled={!listed}
        accessibilityLabel={t(listed?.listed ? 'next.home.removeMyList' : 'next.home.addMyList')}
        onPress={() => {if (listed) onList(listed);}} style={{height: 48, width: 48}}/>
      <Button ref={downloadRef} variant="icon" icon="i-dl" iconOnly disabled={!canDownload}
        accessibilityLabel={t('action.download')} onPress={() => onDownload(manifest)} style={{height: 48, width: 48}}/>
    </View>
    {versions.length > 1 ? <Focusable accessibilityRole="button" accessibilityLabel={t('next.reader.version')} focusKind="row"
      onPress={() => setVersionsOpen(true)} style={{marginTop: 12, alignSelf: rowHero ? 'flex-start' : 'center', flexDirection: 'row', alignItems: 'center', gap: 6, paddingVertical: 6, paddingHorizontal: 10}}>
      <Text style={[browseType(theme, 13, 600), {color: theme.colors.textSecondary}]}>{t('next.reader.version')}</Text>
      <Text style={[browseType(theme, 13, 700), {color: theme.colors.text}]}>{selectedVersion?.format.toUpperCase() ?? ''}</Text>
      <Icon name="i-down" size={14} color={theme.colors.textTertiary}/>
    </Focusable> : null}
  </View>;
  const hero = rowHero
    ? <View style={{flexDirection: 'row', alignItems: 'flex-end', gap: wide ? 36 : 28, paddingHorizontal: wide ? 32 : 28}}>
      {coverArt}
      <View style={{flex: 1, minWidth: 0}}>{copy}{actions}</View>
    </View>
    : <><View style={{alignItems: 'center', paddingHorizontal: 20}} onLayout={event => {
      const next = Math.round(event.nativeEvent.layout.height);
      if (next > 0) onHeroHeight(next);
    }}>{coverArt}{copy}</View>{actions}</>;
  const opening = manifest.metadata.openingLines ? <View style={{marginHorizontal: rowHero ? (wide ? 32 : 28) : 20, marginTop: 18}}>
    <Text style={[browseType(theme, 13, 700), {color: theme.colors.textTertiary}]}>{t('next.reader.openingLines')}</Text>
    <Text numberOfLines={4} style={[browseType(theme, 14.5, 400), {color: theme.colors.textSecondary, lineHeight: 23, marginTop: 6, paddingLeft: 14,
      borderLeftWidth: 2, borderLeftColor: alpha(theme.colors.text, .2)}]}>{manifest.metadata.openingLines}</Text>
  </View> : null;
  const panel = contents.length ? <View style={{marginTop: 14}}>
    <Tabs testID="native-read-book-tabs" value={tab} onValueChange={onTab} items={[
      {value: 'contents', label: t('next.reader.contents'), panel: <ContentsList entries={contents} currentSection={currentSection} onOpen={index => onRead(manifest, index)}/>},
      {value: 'details', label: t('next.reader.details'), panel: <DetailsList manifest={manifest} rows={detailFacts} series={series} comic={comic} onSeries={onSeries}/>},
    ]}/>
  </View> : <View style={{marginTop: 24, paddingHorizontal: 20}}>
    <Text style={[browseType(theme, 20, 700), {color: theme.colors.text, marginBottom: 6}]}>{t('next.reader.details')}</Text>
    <DetailsList manifest={manifest} rows={detailFacts} series={series} comic={comic} onSeries={onSeries}/>
  </View>;
  const widePanel = contents.length ? <View style={{flexDirection: 'row', alignItems: 'flex-start', gap: 36, paddingHorizontal: 32, marginTop: 38}}>
    <View style={{flex: 1, minWidth: 0}}>
      <Text style={[browseType(theme, 20, 700, -.015), {color: theme.colors.text, marginBottom: 10}]}>{t('next.reader.contents')}</Text>
      <ContentsList entries={contents} currentSection={currentSection} onOpen={index => onRead(manifest, index)}/>
    </View>
    <View style={{width: 292, minWidth: 0}}>
      <Text style={[browseType(theme, 20, 700, -.015), {color: theme.colors.text, marginBottom: 10}]}>{t('next.reader.details')}</Text>
      <DetailsList manifest={manifest} rows={detailFacts} series={series} comic={comic} onSeries={onSeries}/>
    </View>
  </View> : <View style={{paddingHorizontal: 32, marginTop: 38}}>
    <Text style={[browseType(theme, 20, 700), {color: theme.colors.text, marginBottom: 6}]}>{t('next.reader.details')}</Text>
    <DetailsList manifest={manifest} rows={detailFacts} series={series} comic={comic} onSeries={onSeries}/>
  </View>;
  const versionsMenu = <Menu open={versionsOpen} onOpenChange={setVersionsOpen} title={t('next.reader.version')} items={versions.map(version => ({
    id: version.sourceId, label: `${version.format.toUpperCase()} · ${defaultI18n.bytes(version.size)}`,
    selected: version.sourceId === sourceId, disabled: !version.inventoryAvailable,
    onSelect: () => {setVersionsOpen(false); if (version.inventoryAvailable && version.sourceId !== sourceId) onVersion(manifest, versions, version.sourceId);},
  }))}/>;
  if (!wide) return <View style={{width: '100%', maxWidth: rowHero ? 820 : 640, alignSelf: 'center'}}>{hero}{opening}{panel}{versionsMenu}</View>;
  return <View testID="native-read-book-split" style={{width: '100%', maxWidth: 1180, alignSelf: 'center'}}>
    {hero}{opening}{widePanel}{versionsMenu}
  </View>;
}

function ContentsList({entries, currentSection, onOpen}: {
  entries: NonNullable<ReadingManifest['contents']>; currentSection?: string; onOpen: (index: number) => void;
}) {
  const theme = useTheme();
  return <View testID="native-read-book-contents" style={{marginTop: 4, marginHorizontal: 20}}>
    {entries.map((entry, index) => {
      const current = currentSection !== undefined && entry.section === currentSection;
      return <Focusable key={`${index}-${entry.section}`} accessibilityRole="button" accessibilityLabel={entry.title}
        onPress={() => onOpen(index)} focusKind="row" focusRadius={8}
        style={{minHeight: 50, paddingVertical: 8, paddingLeft: 4 + Math.max(0, entry.depth) * 16, paddingRight: 4, justifyContent: 'center', ...ROW, borderTopColor: alpha(theme.colors.line, .7)}}>
        <View style={{flexDirection: 'row', alignItems: 'center', gap: 12}}>
          <Text style={[browseType(theme, 13, 700), {color: current ? theme.colors.accentStrong : theme.colors.textTertiary, width: 20, textAlign: 'center'}]}>{index + 1}</Text>
          <Text numberOfLines={2} style={[browseType(theme, 15, 600), {color: current ? theme.colors.text : theme.colors.textSecondary, flex: 1}]}>{entry.title}</Text>
        </View>
      </Focusable>;
    })}
  </View>;
}

function DetailsList({manifest, rows, series, comic, onSeries}: {
  manifest: ReadingManifest; rows: readonly Readonly<{label: string; value: string}>[];
  series?: SeriesLink; comic: boolean; onSeries: (series: SeriesLink, manifest: ReadingManifest) => void;
}) {
  const theme = useTheme();
  return <View testID="native-read-book-details">
    {series ? <Focusable accessibilityRole="link" accessibilityLabel={series.name} onPress={() => onSeries(series, manifest)} focusKind="row" focusRadius={8}
      style={{paddingVertical: 10, ...ROW, borderTopColor: alpha(theme.colors.line, .7)}}>
      <Text style={[browseType(theme, 13.5, 600), {color: theme.colors.text}]}>{t('library.tab.series')}</Text>
      <Text style={[browseType(theme, 13.5, 400), {color: theme.colors.accentStrong, marginTop: 2}]}>
        {series.name}{series.number !== undefined ? ` · ${seriesNumber(series.number, comic)}` : ''}
      </Text>
    </Focusable> : null}
    {rows.map(row => <View key={row.label + row.value} style={{paddingVertical: 9, ...ROW, borderTopColor: alpha(theme.colors.line, .7)}}>
      <Text style={[browseType(theme, 13.5, 600), {color: theme.colors.text}]}>{row.label}</Text>
      <Text style={[browseType(theme, 13, 400), {color: theme.colors.textSecondary, marginTop: 2}]}>{row.value}</Text>
    </View>)}
  </View>;
}
