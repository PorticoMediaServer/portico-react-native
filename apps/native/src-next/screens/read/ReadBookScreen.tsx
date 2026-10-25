import React, {useLayoutEffect, useState, useSyncExternalStore} from 'react';
import {ScrollView, Text, View} from 'react-native';
import {useSafeAreaInsets} from 'react-native-safe-area-context';
import {generatedCoverTint} from '@portico/design';
import {defaultI18n} from '../../../../../packages/i18n/src';
import type {ReadingManifest} from '../../../../../packages/client-core/src';
import {Artwork, AmbientArt, GeneratedCover} from '../../kit/artwork';
import {Button, Focusable, Tabs} from '../../kit/controls';
import {Menu, type MenuEntry} from '../../kit/overlays';
import {StateView, SkeletonBlock} from '../../kit/states';
import {alpha, browseType} from '../../kit/browse/presentation';
import {useTheme} from '../../kit/theme';
import type {NativeShellRoute} from '../../shell/routes';
import type {NativeShellRuntime} from '../../shell/runtime';
import type {NativeReadBook} from './read-book-model';

const {t} = defaultI18n;
const initials = (author: string): string => author.trim().split(/\s+/).slice(0, 2).map(part => part.slice(0, 1).toUpperCase()).join('') || '·';
const seriesNumber = (number: number, comic: boolean): string =>
  t(comic ? 'next.reader.volumeNumber' : 'next.reader.bookNumber', {number: defaultI18n.number(number, {maximumFractionDigits: 20})});
const ROW = {borderTopWidth: 1} as const;

type BookRoute = Extract<NativeShellRoute, {kind: 'read-book'}>;
type SeriesLink = Readonly<{id: string; name: string; number?: number}>;

/** phone-read 3/3c and tablet-read 2/2b/2c: the book's own page before the
 * reader. Real manifest, saved position, declared contents and descriptive
 * facts only; word counts, reading time and opening lines appear only when the
 * server publishes them. The Read action is the one openNativeRead door. */
export function ReadBookScreen({controller, route, comic, runtime, onBack, onOpenSettings}: {
  controller: NativeReadBook; route: BookRoute; comic: boolean; runtime: NativeShellRuntime; onBack: () => void; onOpenSettings: () => void;
}) {
  const state = useSyncExternalStore(controller.subscribe, controller.getSnapshot), theme = useTheme(), insets = useSafeAreaInsets();
  const [more, setMore] = useState(false), [tab, setTab] = useState('contents');
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
    ...(contents.length ? [{id: 'details', label: t('next.reader.details'), selected: tab === 'details', onSelect: () => {setTab('details'); setMore(false);}}] : []),
    {id: 'settings', label: t('next.reader.openSettings'), onSelect: () => {setMore(false); onOpenSettings();}},
  ];
  const read = (target: ReadingManifest, index?: number) => {
    void controller.read(target, index).then(ok => {if (!ok) return;}).catch(runtime.reportError);
  };
  const openSeries = (target: SeriesLink, manifest: ReadingManifest) => {
    void controller.openSeries(target, manifest).then(ok => {if (!ok) return;}).catch(runtime.reportError);
  };
  const body = state.phase === 'error'
    ? <StateView {...runtime.error(state.error, () => {void controller.retry().catch(runtime.reportError);}, 'detail')}/>
    : !manifest || state.phase !== 'ready'
      ? <SkeletonBlock width="100%" height={520}/>
      : <ReadBookBody controller={controller} manifest={manifest} series={series} comic={comic} runtime={runtime}
        saved={saved} currentSection={currentSection} tab={tab} onTab={setTab} onRead={read} onSeries={openSeries}/>;
  return <View testID={`native-read-book-${controller.item.id}`} style={{flex: 1, backgroundColor: theme.colors.ink}}>
    <View pointerEvents="none" style={{position: 'absolute', top: 0, left: 0, right: 0, height: 560, overflow: 'hidden'}}>
      {runtime.ambient(controller.item.coverUrl ?? manifest?.metadata.coverUrl) ? <AmbientArt source={runtime.ambient(controller.item.coverUrl ?? manifest?.metadata.coverUrl)} treatment="title" style={{position: 'absolute', top: 0, left: 0, right: 0, bottom: 0}}/> : null}
      <View style={{position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, backgroundColor: theme.colors.ink, opacity: .5}}/>
    </View>
    <Button variant="icon" icon="i-left" iconOnly accessibilityLabel={t('action.back')} onPress={onBack}
      style={{position: 'absolute', top: insets.top + 6, left: 10, zIndex: 10, height: 44, width: 44}}/>
    <Button variant="icon" icon="i-more" iconOnly accessibilityLabel={t('next.controls.more')} onPress={() => setMore(true)}
      style={{position: 'absolute', top: insets.top + 6, right: 10, zIndex: 10, height: 44, width: 44}}/>
    <ScrollView contentContainerStyle={{paddingTop: Math.max(96, insets.top + 56), paddingBottom: insets.bottom + 48}} showsVerticalScrollIndicator={false}>
      {body}
    </ScrollView>
    <Menu open={more} onOpenChange={setMore} title={title} items={menu}/>
  </View>;
}

function ReadBookBody({controller, manifest, series, comic, runtime, saved, currentSection, tab, onTab, onRead, onSeries}: {
  controller: NativeReadBook; manifest: ReadingManifest; series?: SeriesLink; comic: boolean; runtime: NativeShellRuntime;
  saved?: number; currentSection?: string; tab: string; onTab: (value: string) => void; onRead: (manifest: ReadingManifest, index?: number) => void;
  onSeries: (series: SeriesLink, manifest: ReadingManifest) => void;
}) {
  const theme = useTheme();
  const title = manifest.metadata.title || controller.item.title, author = manifest.metadata.author || controller.item.author?.value;
  const cover = runtime.artwork(controller.item.coverUrl ?? manifest.metadata.coverUrl), tint = generatedCoverTint(title);
  const coverWidth = theme.platform === 'phone' ? 168 : 190, coverHeight = coverWidth * 3 / 2;
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
  return <View style={{width: '100%', maxWidth: 640, alignSelf: 'center'}}>
    <View style={{alignItems: 'center', paddingHorizontal: 20}}>
      <View style={{width: coverWidth, height: coverHeight, borderRadius: 7, overflow: 'hidden', backgroundColor: theme.colors.raised,
        shadowColor: theme.colors.shadow, shadowOpacity: .55, shadowRadius: 30, shadowOffset: {width: 0, height: 18}, elevation: 12}}>
        {cover ? <Artwork source={cover} width={coverWidth} height={coverHeight} priority/>
          : <GeneratedCover title={title} author={author} tint={tint} glyph={title.slice(0, 1).toUpperCase()}/>}
      </View>
      {series ? <Focusable accessibilityRole="link" accessibilityLabel={series.name}
        onPress={() => onSeries(series, manifest)} style={{marginTop: 14, paddingVertical: 4, maxWidth: '100%'}}>
        <Text numberOfLines={2} style={[browseType(theme, 13.5, 600), {color: theme.colors.accentStrong, textAlign: 'center'}]}>
          {series.name}{series.number !== undefined ? ` · ${seriesNumber(series.number, comic)}` : ''}
        </Text>
      </Focusable> : null}
      <Text accessibilityRole="header" numberOfLines={3} style={[browseType(theme, theme.platform === 'phone' ? 40 : 46, 800, -.03), {color: theme.colors.text, textAlign: 'center', marginTop: 6}]}>{title}</Text>
      {author ? <View style={{flexDirection: 'row', alignItems: 'center', gap: 7, marginTop: 8}}>
        <View style={{width: 22, height: 22, borderRadius: 11, alignItems: 'center', justifyContent: 'center', backgroundColor: theme.colors.raisedHigh}}>
          <Text style={[browseType(theme, 9.5, 800), {color: theme.colors.text}]}>{initials(author)}</Text>
        </View>
        <Text numberOfLines={1} style={[browseType(theme, 13, 700), {color: theme.colors.text, flexShrink: 1}]}>{author}</Text>
      </View> : null}
      {facts.length ? <View style={{flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'center', columnGap: 12, rowGap: 6, marginTop: 8}}>
        {facts.map((fact, index) => <Text key={`${fact}-${index}`} style={[browseType(theme, 13, index === 0 ? 700 : 600), {color: index === 0 ? theme.colors.text : theme.colors.textSecondary}]}>{fact}</Text>)}
      </View> : null}
    </View>
    <View style={{paddingHorizontal: 20, marginTop: 18}}>
      <Button icon="i-book" progress={saved} onPress={() => onRead(manifest)} style={{alignSelf: 'stretch'}}>
        {t(saved !== undefined ? 'next.cards.read' : 'next.reader.read')}
      </Button>
    </View>
    {manifest.metadata.openingLines ? <View style={{marginHorizontal: 20, marginTop: 18}}>
      <Text style={[browseType(theme, 13, 700), {color: theme.colors.textTertiary}]}>{t('next.reader.openingLines')}</Text>
      <Text numberOfLines={4} style={[browseType(theme, 14.5, 400), {color: theme.colors.textSecondary, lineHeight: 23, marginTop: 6, paddingLeft: 14,
        borderLeftWidth: 2, borderLeftColor: alpha(theme.colors.text, .2)}]}>{manifest.metadata.openingLines}</Text>
    </View> : null}
    {contents.length ? <View style={{marginTop: 14}}>
      <Tabs testID="native-read-book-tabs" value={tab} onValueChange={onTab} items={[
        {value: 'contents', label: t('next.reader.contents'), panel: <ContentsList entries={contents} currentSection={currentSection} onOpen={index => onRead(manifest, index)}/>},
        {value: 'details', label: t('next.reader.details'), panel: <DetailsList manifest={manifest} rows={detailFacts} series={series} comic={comic} onSeries={onSeries}/>},
      ]}/>
    </View> : <View style={{marginTop: 24, paddingHorizontal: 20}}>
      <Text style={[browseType(theme, 20, 700), {color: theme.colors.text, marginBottom: 6}]}>{t('next.reader.details')}</Text>
      <DetailsList manifest={manifest} rows={detailFacts} series={series} comic={comic} onSeries={onSeries}/>
    </View>}
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
