import React, {useEffect, useState} from 'react';
import {ScrollView, Text, View, useWindowDimensions} from 'react-native';
import type {ContentEntry} from '../../../../../packages/client-core/src/library-content';
import {defaultI18n} from '../../../../../packages/i18n/src';
import {AmbientArt, Artwork} from '../../kit/artwork';
import {PosterCard} from '../../kit/cards';
import {Button, Chip, Focusable} from '../../kit/controls';
import {Icon} from '../../kit/Icon';
import {Menu, type MenuEntry} from '../../kit/overlays';
import {StateView} from '../../kit/states';
import {browseType} from '../../kit/browse/presentation';
import {useTheme} from '../../kit/theme';
import type {NativeShellRuntime} from '../../shell/runtime';
import type {NativeCollectionSort, NativeCollectionState} from './controller';

export type NativeCollectionScreenProps = Readonly<{
  focusScope: string; state: NativeCollectionState;
  runtime: NativeShellRuntime;
  onPlay: () => void;
  onShuffle: () => void;
  onSort: (sort: string, direction: 'asc' | 'desc') => void;
  onOpen: (entry: ContentEntry) => void;
  onBack: () => void;
  onRetry: () => void;
  onMore: () => void;
}>;

const sortLabel = (sort: NativeCollectionSort) => defaultI18n.has(sort.labelKey) ? defaultI18n.t(sort.labelKey as never) : sort.id;
const years = (state: NativeCollectionState) => {
  if (!state.totalCount || state.entries.length < state.totalCount) return undefined;
  const values = state.entries.map(entry => entry.year).filter((year): year is number => Number.isFinite(year));
  if (!values.length) return undefined;
  const min = Math.min(...values), max = Math.max(...values);
  return min === max ? String(min) : `${min} – ${max}`;
};

/** tv-detail#11 / phone-detail#8: a real catalogue collection page. The server's
 * collection order, member watched state and queue selector are the source. */
export function NativeCollectionScreen(props: NativeCollectionScreenProps) {
  const {state, runtime, onBack} = props, theme = useTheme(), t = defaultI18n.t, dimensions = useWindowDimensions();
  const tv = theme.isTV, [sortOpen, setSortOpen] = useState(false);
  useEffect(() => {
    if (!tv) return;
    return runtime.registerTVPageBack?.(() => {onBack(); return true;});
  }, [onBack, runtime, tv]);
  const entries = state.entries, first = entries[0], backdrop = first?.backdropUrl;
  const ambient = runtime.ambient(backdrop), foreground = runtime.artwork(backdrop);
  const fact = [t('next.browse.filmCount', {count: state.totalCount}), years(state)].filter(Boolean).join(' · ');
  const sort = state.sorts.find(value => value.id === state.sort);
  const sortItems: MenuEntry[] = state.sorts.map(value => ({id: value.id, label: sortLabel(value), selected: value.id === state.sort,
    onSelect: () => props.onSort(value.id, value.directions[0] ?? 'asc')}));
  const cardWidth = tv ? 214 : Math.max(120, (dimensions.width - 50) / 2);
  const error = state.error;
  const content = <View style={{flex: 1, backgroundColor: theme.colors.ink}} testID="native-collection">
    {!tv && <Focusable testID="collection-back" accessibilityLabel={t('action.back')} onPress={props.onBack} focusRadius={20}
      style={{position: 'absolute', left: 10, top: 50, width: 40, height: 40, alignItems: 'center', justifyContent: 'center', zIndex: 5}}>
      <Icon name="i-left" size={22} color={theme.colors.text}/></Focusable>}
    <ScrollView onScroll={event => {const {contentOffset, contentSize, layoutMeasurement} = event.nativeEvent;
      if (state.phase === 'ready' && contentSize.height - contentOffset.y - layoutMeasurement.height < layoutMeasurement.height) props.onMore();}} scrollEventThrottle={64}>
      <View style={{height: tv ? 620 : 360}}>
        <AmbientArt source={ambient} foreground={foreground} treatment="title" height={tv ? 760 : 460}/>
        <View style={{position: 'absolute', left: tv ? 200 : 20, right: tv ? 200 : 20, bottom: tv ? 70 : 26}}>
          <Text style={[browseType(theme, tv ? 24 : 12, 700), {color: theme.colors.accentStrong}]}>{t('next.home.collection')}</Text>
          <Text accessibilityRole="header" numberOfLines={2} style={[browseType(theme, tv ? 76 : 40, 800, -.035), {color: theme.colors.text, marginTop: tv ? 6 : 4}]}>{state.title}</Text>
          {fact ? <Text style={[browseType(theme, tv ? 24 : 13, 500), {color: theme.colors.textSecondary, marginTop: tv ? 12 : 6}]}>{fact}</Text> : null}
          <View style={{flexDirection: 'row', alignItems: 'center', gap: tv ? 18 : 10, marginTop: tv ? 30 : 16}}>
            <Button testID="collection-play-all" focusId="collection-play-all" hasTVPreferredFocus={tv} icon="i-play" onPress={props.onPlay} size={tv ? 'hero' : undefined}>{t('next.cards.playAll')}</Button>
            <Button testID="collection-shuffle" focusId="collection-shuffle" variant="glass" icon="i-shuffle" onPress={props.onShuffle} size={tv ? 'hero' : undefined}>{t('title.shuffle')}</Button>
          </View>
        </View>
      </View>
      <View style={{paddingLeft: tv ? 200 : 20, paddingRight: tv ? 96 : 20, paddingTop: tv ? 34 : 18, paddingBottom: 80}}>
        <View style={{flexDirection: 'row', alignItems: 'center', gap: 14, marginBottom: tv ? 28 : 14}}>
          {state.sorts.length > 1 && <Chip testID="collection-sort" onPress={() => setSortOpen(true)}>{sort ? sortLabel(sort) : defaultI18n.t('web.filters.sortBy')}</Chip>}
          <View style={{flex: 1}}/>
          {state.phase === 'loading' && entries.length === 0 ? <Text style={[browseType(theme, tv ? 22 : 13, 500), {color: theme.colors.textTertiary}]}>{t('status.loading')}</Text> : null}
        </View>
        {error && entries.length === 0 ? <StateView variant="inline" {...runtime.error(error, props.onRetry)}/> : null}
        {!error && state.phase === 'ready' && entries.length === 0 ? <StateView variant="inline" title={t('next.collection.empty')} body=""/> : null}
        {entries.length > 0 && (tv ? <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{gap: 28, paddingRight: 24}}>
          {entries.map(entry => <CollectionCard key={`${entry.kind}:${entry.id}`} entry={entry} width={214} runtime={runtime} onOpen={props.onOpen}/>)}
        </ScrollView> : <View style={{flexDirection: 'row', flexWrap: 'wrap', columnGap: 10, rowGap: 18}}>
          {entries.map(entry => <CollectionCard key={`${entry.kind}:${entry.id}`} entry={entry} width={cardWidth} runtime={runtime} onOpen={props.onOpen}/>)}
        </View>)}
      </View>
    </ScrollView>
    <Menu testID={`${props.focusScope}.sort-menu`} open={sortOpen} onOpenChange={setSortOpen} title={defaultI18n.t('web.filters.sortBy')} items={sortItems}/>
  </View>;
  return content;
}

export function CollectionCard({entry, width, runtime, onOpen}: {entry: ContentEntry; width: number; runtime: NativeShellRuntime; onOpen: (entry: ContentEntry) => void}) {
  return <PosterCard testID={`collection-item-${entry.id}`} title={entry.displayTitle || entry.title} width={width}
    artwork={runtime.artwork(entry.posterUrl)} watched={entry.watched} isNew={entry.new}
    progress={entry.duration && entry.progressSeconds ? Math.min(1, entry.progressSeconds / entry.duration) : undefined}
    caption={entry.year === undefined ? [] : [{id: 'year', text: String(entry.year), role: 'context'}]}
    onNavigate={() => onOpen(entry)}/>;
}
