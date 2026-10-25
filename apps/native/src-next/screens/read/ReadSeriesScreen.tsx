import React, {useEffect, useSyncExternalStore} from 'react';
import {ScrollView, Text, View, useWindowDimensions} from 'react-native';
import {useSafeAreaInsets} from 'react-native-safe-area-context';
import {generatedCoverTint} from '@portico/design';
import {defaultI18n} from '../../../../../packages/i18n/src';
import {Artwork, GeneratedCover} from '../../kit/artwork';
import {Button, Focusable} from '../../kit/controls';
import {StateView, SkeletonBlock} from '../../kit/states';
import {alpha, browseType} from '../../kit/browse/presentation';
import {useTheme} from '../../kit/theme';
import type {NativeShellRuntime} from '../../shell/runtime';
import type {NativeReadSeries} from './read-series-model';

const {t} = defaultI18n;
const initial = (title: string): string => title.trim().slice(0, 1).toUpperCase() || '·';

/** phone-read 4/4c: the series' signed, ordered volumes. Read count, per-volume
 * finished state, years and Select have no reading producer, so they stay absent;
 * the one real continue row marks only its own progress. */
export function ReadSeriesScreen({controller, comic, runtime, onBack}: {
  controller: NativeReadSeries; comic: boolean; runtime: NativeShellRuntime; onBack: () => void;
}) {
  const state = useSyncExternalStore(controller.subscribe, controller.getSnapshot), theme = useTheme(), insets = useSafeAreaInsets(), dimensions = useWindowDimensions();
  useEffect(() => {void controller.load().catch(() => {});}, [controller]);
  const continued = state.continued?.item, first = continued ?? state.items[0];
  const title = first?.series?.name ?? t('library.tab.series');
  const authors = [...new Set([...(continued?.author ? [continued.author.value] : []), ...state.items.map(item => item.author?.value)])].filter((value): value is string => !!value);
  const exactCount = state.nextCursor === undefined && state.phase === 'ready' ? state.items.length : undefined;
  const cover = runtime.artwork(first?.coverUrl), tint = generatedCoverTint(title);
  const columns = 3, gap = 16, width = Math.max(96, (dimensions.width - theme.gutter * 2 - gap * (columns - 1)) / columns), height = width * 4 / 3;
  const progression = state.continued && state.continued.item.id === continued?.id ? state.continued.progress.location.progression : undefined;
  return <View testID={`native-read-series-${title}`} style={{flex: 1, backgroundColor: theme.colors.ink}}>
    <Button variant="icon" icon="i-left" iconOnly accessibilityLabel={t('action.back')} onPress={onBack}
      style={{position: 'absolute', top: insets.top + 6, left: 10, zIndex: 10, height: 44, width: 44}}/>
    <ScrollView contentContainerStyle={{paddingTop: Math.max(96, insets.top + 56), paddingBottom: insets.bottom + 48}}
      onScroll={event => {const {contentOffset, contentSize, layoutMeasurement} = event.nativeEvent;
        if (contentSize.height - contentOffset.y - layoutMeasurement.height < layoutMeasurement.height) void controller.more().catch(() => {});}} scrollEventThrottle={64}>
      {state.phase === 'error' ? <StateView {...runtime.error(state.error, () => {void controller.retry().catch(() => {});}, 'library')}/> : null}
      {state.phase !== 'ready' && state.phase !== 'error' ? <SkeletonBlock width="100%" height={360}/> : null}
      {state.phase === 'ready' ? <View style={{paddingHorizontal: theme.gutter}}>
        <View style={{flexDirection: 'row', alignItems: 'flex-end', gap: 18}}>
          <View style={{width: 112, height: 168, borderRadius: 10, overflow: 'hidden', backgroundColor: theme.colors.raised}}>
            {cover ? <Artwork source={cover} width={112} height={168} priority/> : <GeneratedCover title={title} author={authors[0]} tint={tint} glyph={initial(title)}/>}
          </View>
          <View style={{flex: 1, minWidth: 0}}>
            <Text style={[browseType(theme, 12.5, 700), {color: theme.colors.textSecondary}]}>{t('library.tab.series')}</Text>
            <Text accessibilityRole="header" numberOfLines={2} style={[browseType(theme, 26, 800, -.02), {color: theme.colors.text, marginTop: 4}]}>{title}</Text>
            {authors.length ? <Text numberOfLines={2} style={[browseType(theme, 13.5, 600), {color: theme.colors.textSecondary, marginTop: 6}]}>{defaultI18n.list(authors)}</Text> : null}
            {!comic && exactCount !== undefined ? <Text style={[browseType(theme, 13, 600), {color: theme.colors.textTertiary, marginTop: 4}]}>{t('next.kit.books', {count: exactCount})}</Text> : null}
          </View>
        </View>
        <Button icon="i-book" onPress={() => {void controller.openNext().catch(runtime.reportError);}} style={{marginTop: 18, alignSelf: 'stretch'}}>
          {t(state.continued ? 'next.cards.read' : 'next.reader.read')}
        </Button>
        {progression !== undefined ? <View style={{height: 4, borderRadius: 2, marginTop: 10, backgroundColor: alpha(theme.colors.text, .18)}}>
          <View style={{width: `${Math.max(0, Math.min(1, progression)) * 100}%`, height: 4, borderRadius: 2, backgroundColor: theme.colors.accentStrong}}/>
        </View> : null}
        <View style={{flexDirection: 'row', alignItems: 'baseline', gap: 10, marginTop: 24, marginBottom: 10}}>
          <Text style={[browseType(theme, 20, 700), {color: theme.colors.text}]}>{t('next.kit.booksInSeries')}</Text>
          {exactCount !== undefined ? <Text style={[browseType(theme, 13.5, 600), {color: theme.colors.textTertiary}]}>{defaultI18n.number(exactCount)}</Text> : null}
        </View>
        <View style={{flexDirection: 'row', flexWrap: 'wrap', gap}}>
          {state.items.map(item => <Focusable key={item.id} accessibilityRole="button" accessibilityLabel={item.title} focusKind="row" focusRadius={10}
            onPress={() => {void controller.open(item).catch(runtime.reportError);}} style={{width}}>
            <View style={{width, height, borderRadius: 10, overflow: 'hidden', backgroundColor: theme.colors.raised}}>
              {runtime.artwork(item.coverUrl) ? <Artwork source={runtime.artwork(item.coverUrl)} width={width} height={height}/>
                : <GeneratedCover title={item.title} author={item.author?.value} tint={generatedCoverTint(item.title)} glyph={initial(item.title)}/>}
              {state.continued?.item.id === item.id ? <View style={{position: 'absolute', left: 0, right: 0, bottom: 0, height: 3, backgroundColor: alpha(theme.colors.text, .2)}}>
                <View style={{width: `${Math.max(0, Math.min(1, state.continued.progress.location.progression)) * 100}%`, height: 3, backgroundColor: theme.colors.accentStrong}}/>
              </View> : null}
            </View>
            {item.series?.number !== undefined ? <Text numberOfLines={1} style={[browseType(theme, 11.5, 600), {color: theme.colors.textTertiary, marginTop: 7}]}>
              {t(comic ? 'next.reader.volumeNumber' : 'next.reader.bookNumber', {number: defaultI18n.number(item.series.number, {maximumFractionDigits: 20})})}
            </Text> : null}
            <Text numberOfLines={2} style={[browseType(theme, 13, 600), {color: theme.colors.text, marginTop: 2}]}>{item.title}</Text>
            {item.author ? <Text numberOfLines={1} style={[browseType(theme, 11.5, 500), {color: theme.colors.textTertiary, marginTop: 2}]}>{item.author.value}</Text> : null}
          </Focusable>)}
        </View>
      </View> : null}
    </ScrollView>
  </View>;
}
