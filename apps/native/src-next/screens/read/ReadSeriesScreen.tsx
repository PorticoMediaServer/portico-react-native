import React, {useLayoutEffect, useSyncExternalStore} from 'react';
import {ScrollView, Text, View, useWindowDimensions} from 'react-native';
import {useSafeAreaInsets} from 'react-native-safe-area-context';
import {generatedCoverTint} from '@portico/design';
import {defaultI18n} from '../../../../../packages/i18n/src';
import type {ReadingItem} from '../../../../../packages/client-core/src';
import {Artwork, AmbientArt, GeneratedCover} from '../../kit/artwork';
import {Button, Focusable} from '../../kit/controls';
import {StateView, SkeletonBlock} from '../../kit/states';
import {alpha, browseType} from '../../kit/browse/presentation';
import {useTheme} from '../../kit/theme';
import type {NativeShellRoute} from '../../shell/routes';
import type {NativeShellRuntime} from '../../shell/runtime';
import type {NativeReadSeries} from './read-series-model';

const {t} = defaultI18n;
const initial = (title: string): string => title.trim().slice(0, 1).toUpperCase() || '·';
type SeriesRoute = Extract<NativeShellRoute, {kind: 'read-series'}>;

/** phone-read 4/4c: the series' signed, ordered volumes. The hero shows the
 * signed summary when the server publishes one; per-volume finished state,
 * dates, page counts and Select have no reading producer, so they stay absent.
 * The one real continue row marks only its own progress. */
export function ReadSeriesScreen({controller, route, comic, runtime, onBack}: {
  controller: NativeReadSeries; route: SeriesRoute; comic: boolean; runtime: NativeShellRuntime; onBack: () => void;
}) {
  const state = useSyncExternalStore(controller.subscribe, controller.getSnapshot), theme = useTheme(), insets = useSafeAreaInsets(), dimensions = useWindowDimensions();
  useLayoutEffect(() => {
    if (!controller.arm()) return;
    void controller.load().catch(() => {});
    return () => controller.release();
  }, [controller, route]);
  const continuedRow = state.continued, continued = continuedRow?.item, first = continued ?? state.items[0];
  const title = state.overview?.title ?? first?.series?.name ?? t('library.tab.series');
  const overview = state.overview;
  const authors = [...new Set([...(overview?.author ? [overview.author.value] : []), ...state.items.map(item => item.author?.value)])]
    .filter((value): value is string => !!value);
  const exactCount = !overview && state.phase === 'ready' && state.nextCursor === undefined ? state.items.length : undefined;
  const total = overview?.total ?? exactCount;
  const cover = runtime.artwork(first?.coverUrl), tint = generatedCoverTint(title);
  const columns = theme.platform === 'phone' ? 3 : 5, gap = 16;
  const width = Math.max(96, Math.min(220, (dimensions.width - theme.gutter * 2 - gap * (columns - 1)) / columns));
  const height = width * 4 / 3;
  const progression = continuedRow ? Math.max(0, Math.min(1, continuedRow.progress.location.progression)) : undefined;
  const readLabel = continued ? t('next.cards.read')
    : comic && first?.series?.number !== undefined ? t('next.reader.readVolume', {number: defaultI18n.number(first.series.number, {maximumFractionDigits: 20})})
      : t('next.reader.read');
  const stack = state.items.slice(0, 3);
  return <View testID={`native-read-series-${route.seriesId}`} style={{flex: 1, backgroundColor: theme.colors.ink}}>
    <View pointerEvents="none" style={{position: 'absolute', top: 0, left: 0, right: 0, height: 560, overflow: 'hidden'}}>
      {runtime.ambient(first?.coverUrl) ? <AmbientArt source={runtime.ambient(first?.coverUrl)} treatment="title" style={{position: 'absolute', top: 0, left: 0, right: 0, bottom: 0}}/> : null}
      <View style={{position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, backgroundColor: theme.colors.ink, opacity: .5}}/>
    </View>
    <Button variant="icon" icon="i-left" iconOnly accessibilityLabel={t('action.back')} onPress={onBack}
      style={{position: 'absolute', top: insets.top + 6, left: 10, zIndex: 10, height: 44, width: 44}}/>
    <ScrollView contentContainerStyle={{paddingTop: Math.max(96, insets.top + 56), paddingBottom: insets.bottom + 48}}
      onScroll={event => {const {contentOffset, contentSize, layoutMeasurement} = event.nativeEvent;
        if (contentSize.height - contentOffset.y - layoutMeasurement.height < layoutMeasurement.height) void controller.more().catch(() => {});}}
      scrollEventThrottle={64} showsVerticalScrollIndicator={false}>
      {state.phase === 'error' ? <StateView {...runtime.error(state.error, () => {void controller.retry().catch(runtime.reportError);}, 'library')}/> : null}
      {state.phase !== 'ready' && state.phase !== 'error' ? <SkeletonBlock width="100%" height={360}/> : null}
      {state.phase === 'ready' ? <View style={{width: '100%', maxWidth: 900, alignSelf: 'center'}}>
        <View style={{alignItems: 'center', paddingHorizontal: 20}}>
          <View style={{width: 280, height: 214}}>
            {stack.length ? stack.map((item, index) => {
              const left = stack.length === 1 ? 76 : stack.length === 2 ? 36 + index * 80 : [4, 72, 146][index]!;
              const top = stack.length === 3 ? [18, 6, 14][index]! : 12;
              const rotate = stack.length === 1 ? '0deg' : stack.length === 2 ? (index ? '5deg' : '-5deg') : ['-9deg', '-2deg', '7deg'][index]!;
              return <View key={item.id} style={{position: 'absolute', left, top, width: 128, height: 192, borderRadius: 7, overflow: 'hidden',
                transform: [{rotate}], backgroundColor: theme.colors.raised, shadowColor: theme.colors.shadow, shadowOpacity: .6, shadowRadius: 24, shadowOffset: {width: 0, height: 14}, elevation: index + 4}}>
                {runtime.artwork(item.coverUrl) ? <Artwork source={runtime.artwork(item.coverUrl)} width={128} height={192}/>
                  : <GeneratedCover title={item.title} author={item.author?.value} tint={generatedCoverTint(item.title)} glyph={initial(item.title)} width={128} height={192}/>}
              </View>;
            }) : <View style={{position: 'absolute', left: 76, top: 12, width: 128, height: 192, borderRadius: 7, overflow: 'hidden', backgroundColor: theme.colors.raised}}>
              {cover ? <Artwork source={cover} width={128} height={192} priority/> : <GeneratedCover title={title} author={authors[0]} tint={tint} glyph={initial(title)} width={128} height={192}/>}
            </View>}
          </View>
          <Text accessibilityRole="header" numberOfLines={2} style={[browseType(theme, 34, 800, -.02), {color: theme.colors.text, textAlign: 'center', marginTop: 14}]}>{title}</Text>
          {authors.length || total !== undefined ? <View style={{flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'center', columnGap: 12, rowGap: 4, marginTop: 10}}>
            {authors.length ? <Text numberOfLines={2} style={[browseType(theme, 13, 700), {color: theme.colors.text, textAlign: 'center'}]}>{defaultI18n.list(authors)}</Text> : null}
            {total !== undefined ? <Text style={[browseType(theme, 13, 600), {color: theme.colors.textSecondary}]}>{t(comic ? 'next.reader.volumeCount' : 'next.kit.books', {count: total})}</Text> : null}
          </View> : null}
        </View>
        <View style={{paddingHorizontal: 20, marginTop: 18}}>
          <Button icon="i-book" onPress={() => {void controller.openNext().catch(runtime.reportError);}} style={{alignSelf: 'stretch'}}>
            {readLabel}
          </Button>
        </View>
        {progression !== undefined ? <View style={{height: 4, borderRadius: 2, marginHorizontal: 20, marginTop: 10, backgroundColor: alpha(theme.colors.text, .18)}}>
          <View style={{width: `${progression * 100}%`, height: 4, borderRadius: 2, backgroundColor: theme.colors.accentStrong}}/>
        </View> : null}
        <View style={{flexDirection: 'row', alignItems: 'baseline', gap: 10, marginTop: 24, marginBottom: 10, paddingHorizontal: 20}}>
          <Text style={[browseType(theme, 19, 700, -.015), {color: theme.colors.text}]}>{t(comic ? 'next.reader.volumes' : 'next.kit.booksInSeries')}</Text>
          {overview ? <Text style={[browseType(theme, 13, 600), {color: theme.colors.textTertiary}]}>{t('next.reader.seriesReadCount', {read: defaultI18n.number(overview.completed), count: defaultI18n.number(overview.total)})}</Text>
            : exactCount !== undefined ? <Text style={[browseType(theme, 13, 600), {color: theme.colors.textTertiary}]}>{defaultI18n.number(exactCount)}</Text> : null}
        </View>
        <View style={{flexDirection: 'row', flexWrap: 'wrap', gap, paddingHorizontal: 20, paddingTop: 2}}>
          {state.items.map(item => <VolumeCard key={item.id} item={item} width={width} height={height} comic={comic} theme={theme} runtime={runtime}
            progression={continuedRow?.item.id === item.id ? progression : undefined}
            onOpen={() => {void controller.open(item).catch(runtime.reportError);}}/>)}
        </View>
        {state.items.length === 0 ? <StateView testID="native-read-series-empty" variant="inline" title={t('library.emptySeries')} body={t('library.emptySeriesBody')}/> : null}
        {state.moreError ? <StateView {...runtime.error(state.moreError, () => {void controller.more().catch(runtime.reportError);}, 'library')}/> : null}
      </View> : null}
    </ScrollView>
  </View>;
}

function VolumeCard({item, width, height, comic, theme, runtime, progression, onOpen}: {
  item: ReadingItem; width: number; height: number; comic: boolean; theme: ReturnType<typeof useTheme>;
  runtime: NativeShellRuntime; progression?: number; onOpen: () => void;
}) {
  const number = item.series?.number;
  return <Focusable accessibilityRole="button" accessibilityLabel={item.title} focusKind="row" focusRadius={10} onPress={onOpen} style={{width}}>
    <View style={{width, height, borderRadius: 10, overflow: 'hidden', backgroundColor: theme.colors.raised}}>
      {runtime.artwork(item.coverUrl) ? <Artwork source={runtime.artwork(item.coverUrl)} width={width} height={height}/>
        : <GeneratedCover title={item.title} author={item.author?.value} tint={generatedCoverTint(item.title)} glyph={initial(item.title)} width={width} height={height}/>}
      {progression !== undefined ? <View style={{position: 'absolute', left: 0, right: 0, bottom: 0, height: 3, backgroundColor: alpha(theme.colors.text, .2)}}>
        <View style={{width: `${progression * 100}%`, height: 3, backgroundColor: theme.colors.accentStrong}}/>
      </View> : null}
    </View>
    {number !== undefined ? <Text numberOfLines={1} style={[browseType(theme, 11.5, 600), {color: theme.colors.textTertiary, marginTop: 7}]}>
      {t(comic ? 'next.reader.volumeNumber' : 'next.reader.bookNumber', {number: defaultI18n.number(number, {maximumFractionDigits: 20})})}
    </Text> : null}
    <Text numberOfLines={2} style={[browseType(theme, 13, 600), {color: theme.colors.text, marginTop: number !== undefined ? 2 : 7}]}>{item.title}</Text>
    {item.author ? <Text numberOfLines={1} style={[browseType(theme, 11.5, 500), {color: theme.colors.textTertiary, marginTop: 2}]}>{item.author.value}</Text> : null}
  </Focusable>;
}
