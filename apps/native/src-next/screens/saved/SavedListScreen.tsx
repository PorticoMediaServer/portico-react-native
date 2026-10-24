import React, {useEffect, useMemo, useSyncExternalStore} from 'react';
import {ScrollView, Text, View, useWindowDimensions} from 'react-native';
import {useSafeAreaInsets} from 'react-native-safe-area-context';
import {defaultI18n, type MessageId} from '../../../../../packages/i18n/src';
import type {ContentEntry} from '../../../../../packages/client-core/src/library-content';
import type {SavedListFilter} from '../../../../../packages/client-core/src/saved';
import {Button, Chip, Focusable} from '../../kit/controls';
import {PosterCard, SquareCard} from '../../kit/cards';
import {Icon} from '../../kit/Icon';
import {StateView} from '../../kit/states';
import {browseType, alpha} from '../../kit/browse/presentation';
import {useTheme} from '../../kit/theme';
import type {NativeShellRuntime} from '../../shell/runtime';
import type {NativeEntryMenuState} from '../destinations/entry-actions';
import type {NativeDestinationActivationPort} from '../destinations/focus';
import type {NativeSavedViewDestination} from './view-model';
import {homeCardText} from '../home/model';
import {savedTitleCount} from './presentation';

const t = defaultI18n.t;

type ListView = 'watchlist' | 'favorites' | 'history';
export type NativeSavedListRoute = Readonly<{view: ListView; sort?: string; direction?: 'asc' | 'desc'; filter?: SavedListFilter; period?: '24h' | '7d' | '30d' | '90d' | 'all'; shape?: 'posters' | 'squares'}>;

export type NativeSavedListProps = Readonly<{
  route: NativeSavedListRoute;
  destination: NativeSavedViewDestination;
  activation: NativeDestinationActivationPort;
  runtime: NativeShellRuntime;
  actions: Readonly<{menuState?: NativeEntryMenuState; open: (entry: ContentEntry) => void; play: (entry: ContentEntry) => void;
    menu: (entry: ContentEntry) => void; isMenuOpen?: (entry: ContentEntry) => boolean}>;
  back: () => void;
  changed?: () => void;
}>;

const emptyCopy: Readonly<Record<ListView, Readonly<{title: MessageId; body: MessageId}>>> = Object.freeze({
  watchlist: {title: 'web.saved.empty.watchlist', body: 'web.saved.empty.watchlistBody'},
  favorites: {title: 'web.saved.empty.favorites', body: 'web.saved.empty.favoritesBody'},
  history: {title: 'web.saved.empty.history', body: 'web.saved.empty.historyBody'},
});

/** My List, Favorites and History: the server's saved list with its own sort and
 * filter vocabulary. History is the personal history page and shares the grid. */
export function SavedListScreen({route, destination, activation, runtime, actions, back}: NativeSavedListProps) {
  const theme = useTheme(), insets = useSafeAreaInsets(), dimensions = useWindowDimensions();
  const active = useSyncExternalStore(activation.subscribe, activation.getSnapshot);
  const snapshot = useSyncExternalStore(destination.subscribe, destination.getSnapshot);
  useEffect(() => {void destination.select(route).catch(runtime.reportError);}, [destination, route, runtime]);
  const personal = snapshot.personal, saved = snapshot.saved;
  const projection = saved?.projection, entries: readonly ContentEntry[] = route.view === 'history'
    ? (personal?.entries ?? []).flatMap(entry => !entry.hidden && entry.media ? [entry.media] : [])
    : (projection?.sections ?? []).flatMap(section => section.entries.flatMap(entry => entry.kind === 'playlist' || entry.kind === 'playlist_entry' ? [] : [entry]));
  const error = snapshot.error ?? saved?.error ?? personal?.error;
  const loading = snapshot.phase === 'loading' && !projection && !personal?.entries.length;
  const sorts = projection?.sorts ?? [], filters = projection?.filters ?? [];
  const title = t(route.view === 'watchlist' ? 'saved.tab.watchlist' : route.view === 'favorites' ? 'saved.tab.favorites' : 'saved.tab.history');
  const columns = theme.isTV ? 7 : 3, gap = theme.isTV ? 26 : 10, gutter = theme.isTV ? 100 : theme.gutter;
  const width = ((theme.isTV ? 1920 : dimensions.width) - gutter * 2 - gap * (columns - 1)) / columns;
  const count = route.view === 'history' ? personal?.entries.length : (projection?.sections[0]?.totalCount ?? entries.length);
  const retry = () => {void destination.retry().catch(runtime.reportError);};
  const chooseFilter = (filter: SavedListFilter) => {void destination.select({view: route.view as 'watchlist' | 'favorites', filter,
    ...(projection?.query.sort ? {sort: projection.query.sort, direction: projection.query.direction as 'asc' | 'desc'} : {})}).catch(runtime.reportError);};
  const chooseSort = () => {
    const current = sorts.find(sort => sort.id === projection?.query.sort) ?? sorts[0];
    if (!current) return;
    const direction = projection?.query.direction === 'asc' ? 'desc' : 'asc';
    void destination.select({view: route.view as 'watchlist' | 'favorites', sort: current.id, direction, ...(projection?.query.category ? {filter: projection.query.category as SavedListFilter} : {})}).catch(runtime.reportError);
  };
  const sortLabel = useMemo(() => {
    const field = projection?.query.sort;
    if (!field) return t('web.saved.sort.other');
    const known = sorts.find(sort => sort.id === field)?.labelKey;
    if (known && defaultI18n.has(known as MessageId)) return t(known as MessageId);
    return t(sortFieldId(field));
  }, [projection?.query.sort, sorts]);
  return <View testID={`native-saved-list-${route.view}`} pointerEvents={active.visible ? 'auto' : 'none'} accessibilityElementsHidden={!active.visible}
    importantForAccessibility={active.visible ? 'auto' : 'no-hide-descendants'} style={{flex: 1, backgroundColor: theme.colors.ink}}>
    <View style={{paddingTop: insets.top, backgroundColor: alpha(theme.colors.ink, .94), borderBottomColor: alpha(theme.colors.text, .07), borderBottomWidth: 1}}>
      <View style={{height: 44, paddingLeft: 12, paddingRight: 10, flexDirection: 'row', alignItems: 'center'}}>
        <Focusable testID="saved-list-back" accessibilityRole="button" onPress={back} accessibilityLabel={t('saved.title')} style={{height: 38, marginLeft: -4, paddingRight: 6, justifyContent: 'center'}}>
          <View style={{flexDirection: 'row', alignItems: 'center'}}><Icon name="i-left" size={22} color={theme.colors.textSecondary}/>
            <Text style={[browseType(theme, 16, 600), {color: theme.colors.textSecondary}]}>{t('saved.title')}</Text></View>
        </Focusable>
        <View pointerEvents="none" style={{position: 'absolute', left: 118, right: 118, top: 0, height: 44, alignItems: 'center', justifyContent: 'center'}}>
          <Text numberOfLines={1} style={[browseType(theme, 17, 700), {color: theme.colors.text}]}>{title}</Text>
        </View>
      </View>
    </View>
    <ScrollView contentContainerStyle={{paddingBottom: 28 + insets.bottom}}>
      {route.view !== 'history' && (!!sorts.length || !!filters.length) && <ScrollView horizontal showsHorizontalScrollIndicator={false}
        contentContainerStyle={{paddingHorizontal: gutter, paddingTop: 10, paddingBottom: 8, gap: 8}}>
        {!!sorts.length && <Chip focusId="list-sort" icon="i-sort" trailingIcon="i-down" onPress={chooseSort} accessibilityLabel={t('next.browse.native.sort')}>{sortLabel}</Chip>}
        {filters.flatMap(filter => filter.options.map(option => <Chip key={`${filter.id}:${option.id}`} focusId={`list-filter-${option.id}`} count={option.count}
          selected={(projection?.query.category ?? 'all') === option.id} onPress={() => chooseFilter(option.id as SavedListFilter)}>{option.label}</Chip>))}
      </ScrollView>}
      <Text style={[browseType(theme, 13, 600), {color: theme.colors.textTertiary, marginHorizontal: gutter, marginTop: 10, marginBottom: 12}]}>{savedTitleCount(count)}</Text>
      {error && !loading ? <StateView variant="inline" {...runtime.error(error, retry)}/>
        : loading ? <View style={{paddingVertical: 32}}><Text style={[theme.type.body, {color: theme.colors.textTertiary, textAlign: 'center'}]}>{t('saved.loading')}</Text></View>
        : !entries.length ? <StateView variant="inline" title={t(emptyCopy[route.view].title)} body={t(emptyCopy[route.view].body)}/>
        : <View style={{flexDirection: 'row', flexWrap: 'wrap', gap, paddingHorizontal: gutter}}>
          {entries.map(entry => <SavedListCard key={entry.id} entry={entry} width={width} runtime={runtime} actions={actions}/>)}
        </View>}
      {!!(route.view === 'history' ? personal?.nextCursor : projection?.sections.some(section => section.nextCursor)) && <View style={{alignItems: 'center', paddingVertical: 16}}>
        <Button variant="glass" size="compact" onPress={() => {void destination.next(projection?.sections.find(section => section.nextCursor)?.id).catch(runtime.reportError);}}>{t('action.showMore')}</Button>
      </View>}
    </ScrollView>
  </View>;
}

function SavedListCard({entry, width, runtime, actions}: {entry: ContentEntry; width: number; runtime: NativeShellRuntime; actions: NativeListActions}) {
  const text = homeCardText(entry, false, runtime.text), square = ['album', 'song', 'book', 'audiobook_file'].includes(entry.kind);
  const progress = entry.duration && entry.progressSeconds ? Math.min(1, entry.progressSeconds / entry.duration) : undefined;
  const props = {testID: `saved-list-${encodeURIComponent(entry.id)}`, focusId: `saved-list-${entry.id}`, title: entry.displayTitle || entry.title, caption: text.caption,
    artwork: runtime.artwork(entry.posterUrl), progress, watched: entry.watched, width, onNavigate: () => actions.open(entry),
    onPlay: entry.playback ? () => actions.play(entry) : undefined, onMore: () => actions.menu(entry), moreExpanded: actions.isMenuOpen?.(entry)};
  return square ? <SquareCard {...props}/> : <PosterCard {...props}/>;
}

type NativeListActions = Readonly<{open: (entry: ContentEntry) => void; play: (entry: ContentEntry) => void; menu: (entry: ContentEntry) => void; isMenuOpen?: (entry: ContentEntry) => boolean}>;

function sortFieldId(field: string): MessageId {
  if (field === 'title' || field === 'sort_title') return 'web.saved.sort.title';
  if (field === 'added' || field === 'added_at') return 'web.saved.sort.added';
  if (field === 'last_played' || field === 'recent') return 'web.saved.sort.recent';
  if (field === 'year') return 'web.saved.sort.year';
  if (field === 'duration') return 'web.saved.sort.duration';
  if (field === 'progress') return 'web.saved.sort.progress';
  return 'web.saved.sort.other';
}
