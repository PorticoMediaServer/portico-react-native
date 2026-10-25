import React, {useEffect, useState, useSyncExternalStore} from 'react';
import {ScrollView, Text, View} from 'react-native';
import {useSafeAreaInsets} from 'react-native-safe-area-context';
import {generatedCoverTint} from '@portico/design';
import {defaultI18n} from '../../../../../packages/i18n/src';
import {Artwork, AmbientArt, GeneratedCover} from '../../kit/artwork';
import {Button, Focusable} from '../../kit/controls';
import {Icon} from '../../kit/Icon';
import {Menu, type MenuEntry} from '../../kit/overlays';
import {StateView, SkeletonBlock} from '../../kit/states';
import {alpha, browseType} from '../../kit/browse/presentation';
import {useTheme} from '../../kit/theme';
import type {NativeShellRuntime} from '../../shell/runtime';
import type {NativeReadBook} from './read-book-model';

const {t} = defaultI18n;
const initial = (title: string): string => title.trim().slice(0, 1).toUpperCase() || '·';

/** phone-read 3/3c: the phone's book destination before the reader. Real manifest,
 * versions, saved position and declared contents only; choosing another real
 * available version reloads the same page projection, and the Read action is the
 * same one library door (openNativeRead), never a second host or session owner. */
export function ReadBookScreen({controller, runtime, onBack, onOpenSettings}: {
  controller: NativeReadBook; runtime: NativeShellRuntime; onBack: () => void; onOpenSettings: () => void;
}) {
  const state = useSyncExternalStore(controller.subscribe, controller.getSnapshot), theme = useTheme(), insets = useSafeAreaInsets();
  const [more, setMore] = useState(false), [details, setDetails] = useState(true), [versionsOpen, setVersionsOpen] = useState(false);
  useEffect(() => {void controller.load().catch(() => {});}, [controller]);
  const manifest = state.manifest, title = manifest?.metadata.title ?? controller.item.title;
  const author = manifest?.metadata.author ?? controller.item.author?.value;
  const series = controller.item.series, cover = runtime.artwork(controller.item.coverUrl ?? manifest?.metadata.coverUrl);
  const tint = generatedCoverTint(title), saved = controller.savedProgression();
  const facts = manifest ? [
    manifest.format.toUpperCase(),
    defaultI18n.bytes(manifest.size),
    ...(manifest.metadata.language ? [manifest.metadata.language] : []),
    ...(manifest.pageNames?.length ? [`${t('next.reader.pagesStrip')} ${defaultI18n.number(manifest.pageNames.length)}`] : []),
    ...(manifest.contents?.length && manifest.format === 'epub' ? [t('next.kit.chapters', {count: manifest.contents.length})] : []),
  ] : [];
  const menu: readonly MenuEntry[] = [
    {id: 'details', label: t('next.reader.details'), selected: details, onSelect: () => {setDetails(value => !value); setMore(false);}},
    {id: 'settings', label: t('next.reader.openSettings'), onSelect: () => {setMore(false); onOpenSettings();}},
  ];
  const selectedVersion = state.versions.find(version => version.sourceId === state.sourceId);
  const versions: readonly MenuEntry[] = state.versions.map(version => ({
    id: version.sourceId, label: `${version.format.toUpperCase()} · ${defaultI18n.bytes(version.size)}`,
    selected: version.sourceId === state.sourceId, disabled: !version.inventoryAvailable,
    onSelect: () => {setVersionsOpen(false); void controller.selectVersion(version.sourceId).catch(runtime.reportError);},
  }));
  return <View testID={`native-read-book-${controller.item.id}`} style={{flex: 1, backgroundColor: theme.colors.ink}}>
    <View pointerEvents="none" style={{position: 'absolute', inset: 0, overflow: 'hidden'}}>
      {runtime.ambient(controller.item.coverUrl ?? manifest?.metadata.coverUrl) ? <AmbientArt source={runtime.ambient(controller.item.coverUrl ?? manifest?.metadata.coverUrl)} treatment="title" style={{position: 'absolute', inset: 0}}/> : null}
      <View style={{position: 'absolute', inset: 0, backgroundColor: theme.colors.ink, opacity: .5}}/>
    </View>
    <Button variant="icon" icon="i-left" iconOnly accessibilityLabel={t('action.back')} onPress={onBack}
      style={{position: 'absolute', top: insets.top + 6, left: 10, zIndex: 10, height: 44, width: 44}}/>
    <Button variant="icon" icon="i-more" iconOnly accessibilityLabel={t('next.controls.more')} onPress={() => setMore(true)}
      style={{position: 'absolute', top: insets.top + 6, right: 10, zIndex: 10, height: 44, width: 44}}/>
    <ScrollView contentContainerStyle={{paddingTop: Math.max(96, insets.top + 56), paddingBottom: insets.bottom + 48}} showsVerticalScrollIndicator={false}>
      {state.phase === 'error' ? <StateView {...runtime.error(state.error, () => {void controller.retry().catch(() => {});}, 'detail')}/> : state.phase !== 'ready' || !manifest
        ? <SkeletonBlock width="100%" height={520}/>
        : <View style={{alignItems: 'center', paddingHorizontal: 20}}>
          <View style={{width: 196, height: 294, borderRadius: 12, overflow: 'hidden', backgroundColor: theme.colors.raised}}>
            {cover ? <Artwork source={cover} width={196} height={294} priority/> : <GeneratedCover title={title} author={author} tint={tint} glyph={initial(title)}/>}
          </View>
          {series ? <Focusable accessibilityRole="link" accessibilityLabel={series.name} onPress={() => {void controller.openSeries().catch(runtime.reportError);}} style={{marginTop: 14, paddingVertical: 3}}>
            <Text style={[browseType(theme, 13.5, 600), {color: theme.colors.accentStrong}]}>{series.name}{series.number !== undefined ? ` · ${t(controller.item.format === 'cbz' ? 'next.reader.volumeNumber' : 'next.reader.bookNumber', {number: defaultI18n.number(series.number)})}` : ''}</Text>
          </Focusable> : null}
          <Text accessibilityRole="header" numberOfLines={3} style={[browseType(theme, 30, 800, -.03), {color: theme.colors.text, textAlign: 'center', marginTop: 6}]}>{title}</Text>
          {author ? <Text style={[browseType(theme, 16, 700), {color: theme.colors.textSecondary, marginTop: 8}]}>{author}</Text> : null}
          {facts.length ? <View style={{flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'center', columnGap: 14, rowGap: 6, marginTop: 10}}>
            {facts.map((fact, index) => <Text key={`${fact}-${index}`} style={[browseType(theme, 13, index === 0 ? 700 : 400), {color: index === 0 ? theme.colors.text : theme.colors.textSecondary}]}>{fact}</Text>)}
          </View> : null}
          {saved !== undefined ? <View style={{width: '100%', maxWidth: 420, marginTop: 16}}>
            <View style={{height: 4, borderRadius: 2, backgroundColor: alpha(theme.colors.text, .18)}}><View style={{width: `${saved * 100}%`, height: 4, borderRadius: 2, backgroundColor: theme.colors.accentStrong}}/></View>
          </View> : null}
          <Button icon="i-book" onPress={() => {void controller.read().catch(runtime.reportError);}} style={{marginTop: 16, minWidth: 280}}>
            {t(saved !== undefined ? 'next.cards.read' : 'next.reader.read')}
          </Button>
          {state.versions.length > 1 ? <Focusable accessibilityRole="button" accessibilityLabel={t('next.reader.version')}
            onPress={() => setVersionsOpen(true)} focusKind="row"
            style={{marginTop: 12, flexDirection: 'row', alignItems: 'center', gap: 6, paddingVertical: 6, paddingHorizontal: 10}}>
            <Text style={[browseType(theme, 13, 600), {color: theme.colors.textSecondary}]}>{t('next.reader.version')}</Text>
            <Text style={[browseType(theme, 13, 700), {color: theme.colors.text}]}>{selectedVersion?.format.toUpperCase() ?? ''}</Text>
            <Icon name="i-down" size={14} color={theme.colors.textTertiary}/>
          </Focusable> : null}
          {manifest.format === 'epub' && manifest.contents?.length ? <View style={{width: '100%', marginTop: 28}}>
            <Text style={[browseType(theme, 20, 700), {color: theme.colors.text, marginBottom: 6}]}>{t('next.reader.contents')}</Text>
            {manifest.contents.map((entry, index) => <Focusable key={`${index}-${entry.section}`} accessibilityRole="button" accessibilityLabel={entry.title}
              onPress={() => {void controller.read(index).catch(runtime.reportError);}} focusKind="row" focusRadius={8}
              style={{minHeight: 46, paddingVertical: 8, paddingLeft: 4 + Math.max(0, entry.depth) * 16, paddingRight: 4, justifyContent: 'center', borderTopWidth: 1, borderTopColor: alpha(theme.colors.line, .7)}}>
              <Text numberOfLines={2} style={[browseType(theme, 14.5, 600), {color: theme.colors.textSecondary}]}>{entry.title}</Text>
            </Focusable>)}
          </View> : null}
          {details ? <View style={{width: '100%', marginTop: 26}}>
            <Text style={[browseType(theme, 20, 700), {color: theme.colors.text, marginBottom: 6}]}>{t('next.reader.details')}</Text>
            {[
              ...(author ? [{label: t('filter.field.author'), value: author}] : []),
              {label: t('next.reader.format'), value: manifest.format.toUpperCase()},
              {label: t('next.reader.fileSize'), value: defaultI18n.bytes(manifest.size)},
              ...(manifest.pageNames?.length ? [{label: t('next.reader.pagesStrip'), value: defaultI18n.number(manifest.pageNames.length)}] : []),
              ...(manifest.metadata.language ? [{label: t('next.selection.language'), value: manifest.metadata.language}] : []),
            ].map(row => <View key={row.label} style={{paddingVertical: 9, borderTopWidth: 1, borderTopColor: alpha(theme.colors.line, .7)}}>
              <Text style={[browseType(theme, 13.5, 600), {color: theme.colors.text}]}>{row.label}</Text>
              <Text style={[browseType(theme, 13, 400), {color: theme.colors.textSecondary, marginTop: 2}]}>{row.value}</Text>
            </View>)}
          </View> : null}
        </View>}
    </ScrollView>
    <Menu open={more} onOpenChange={setMore} title={title} items={menu}/>
    <Menu open={versionsOpen} onOpenChange={setVersionsOpen} title={t('next.reader.version')} items={versions}/>
  </View>;
}
