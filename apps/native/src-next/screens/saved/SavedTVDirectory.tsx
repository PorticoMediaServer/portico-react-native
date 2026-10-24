import React from 'react';
import {ScrollView, Text, View} from 'react-native';
import {defaultI18n} from '../../../../../packages/i18n/src';
import type {Library} from '../../../../../packages/client-core/src/index';
import type {PersonalResource} from '../../../../../packages/client-core/src/personal-saved';
import type {PlaylistCard, PlaylistListFilter} from '../../../../../packages/client-core/src/saved';
import {Chip, Focusable} from '../../kit/controls';
import {AmbientArt, CoverMosaic, MediaArt} from '../../kit/artwork';
import {CardFrame} from '../../kit/cards/primitives';
import {FocusRegion} from '../../kit/focus';
import {Icon} from '../../kit/Icon';
import {StateView} from '../../kit/states';
import {alpha, browseType} from '../../kit/browse/presentation';
import {useTheme} from '../../kit/theme';
import type {NativeShellRuntime} from '../../shell/runtime';
import type {NativeSavedViewDestination} from './view-model';
import {savedCollectionCount, savedItemCount, savedLibraryName, savedTitleCount, savedViewCount, savedVisibility} from './presentation';

const t = defaultI18n.t;

export type NativeSavedTVDirectoryView = 'playlists' | 'collections' | 'views';

/** The TV landing's three directory bodies (collections.html 15–17). The TV
 * landing owner renders SavedTVTabs above this; it registers no route and owns
 * no destination. */
export type NativeSavedTVDirectoryProps = Readonly<{
  view: NativeSavedTVDirectoryView;
  destination: NativeSavedViewDestination;
  runtime: NativeShellRuntime;
  libraries: readonly Library[];
  enabled: boolean;
  regionId: string;
  select: (route: Readonly<{view: NativeSavedTVDirectoryView; sort?: string; direction?: 'asc' | 'desc'; filter?: PlaylistListFilter}>) => void;
  openPlaylist: (card: PlaylistCard) => void;
  openResource: (resource: PersonalResource) => void;
}>;

export function SavedTVDirectory({view, destination, runtime, libraries, enabled, regionId, select, openPlaylist, openResource}: NativeSavedTVDirectoryProps) {
  const theme = useTheme();
  const snapshot = React.useSyncExternalStore(destination.subscribe, destination.getSnapshot);
  const saved = snapshot.saved, personal = snapshot.personal;
  const playlists = view === 'playlists' ? (saved?.projection?.sections ?? []).flatMap(section => section.entries.filter((entry): entry is PlaylistCard => entry.kind === 'playlist')) : [];
  const resources = view === 'playlists' ? [] : personal?.resources ?? [];
  const filters = view === 'playlists' ? saved?.projection?.filters ?? [] : [];
  const sorts = view === 'playlists' ? saved?.projection?.sorts ?? [] : [];
  const error = snapshot.error ?? saved?.error ?? personal?.error, loading = snapshot.phase === 'loading' && !saved?.projection && !personal?.resources.length;
  const count = view === 'playlists' ? (saved?.projection?.sections[0]?.totalCount ?? playlists.length) : resources.length;
  const countText = view === 'playlists' ? savedItemCount(count) : view === 'collections' ? savedCollectionCount(count) : savedViewCount(count);
  const first = view === 'playlists' ? playlists[0]?.id : resources[0]?.id;
  const selectFilter = (filter: PlaylistListFilter) => select({view: 'playlists', filter, ...(saved?.projection?.query.sort ? {sort: saved.projection.query.sort, direction: saved.projection.query.direction as 'asc' | 'desc'} : {})});
  return <View style={{flex: 1}}>
    <View style={{height: 76, flexDirection: 'row', alignItems: 'center', gap: 14, paddingHorizontal: theme.gutter}}>
      {view === 'playlists' && <>
        {!!sorts.length && <Chip focusId="tv-saved-sort" icon="i-sort" trailingIcon="i-down" disabled={!enabled} onPress={() => {
          const current = sorts.find(sort => sort.id === saved?.projection?.query.sort) ?? sorts[0];
          if (current) select({view: 'playlists', sort: current.id, direction: saved?.projection?.query.direction === 'asc' ? 'desc' : 'asc'});
        }}>{saved?.projection?.query.sort === 'title' ? t('web.saved.sort.title') : saved?.projection?.query.sort === 'created' ? t('playlists.sort', {field: 'created'}) : t('web.saved.sort.other')}</Chip>}
        {filters.flatMap(filter => filter.options.map(option => <Chip key={`${filter.id}:${option.id}`} focusId={`tv-saved-filter-${option.id}`} disabled={!enabled} count={option.count}
          selected={(saved?.projection?.query.category ?? 'all') === option.id} onPress={() => selectFilter(option.id as PlaylistListFilter)}>{option.label}</Chip>))}
      </>}
      <Text style={[browseType(theme, 22), {color: theme.colors.textTertiary, marginLeft: 'auto'}]}>{countText}</Text>
    </View>
    {error && !loading ? <StateView variant="panel" {...runtime.error(error, () => {void destination.retry().catch(runtime.reportError);})}/>
      : loading ? <Text style={[browseType(theme, 24), {color: theme.colors.textTertiary, textAlign: 'center', paddingTop: 40}]}>{t('saved.loading')}</Text>
      : !count ? <StateView variant="panel" icon={view === 'playlists' ? 'i-queue' : view === 'collections' ? 'i-stack' : 'i-filter'}
        title={t(view === 'playlists' ? 'web.saved.empty.playlists' : view === 'collections' ? 'web.saved.empty.collections' : 'web.saved.empty.views')}
        body={t(view === 'playlists' ? 'web.saved.empty.playlistsBody' : view === 'collections' ? 'web.saved.empty.collectionsBody' : 'web.saved.empty.viewsBody')}/>
      : <ScrollView contentContainerStyle={{paddingHorizontal: theme.gutter, paddingBottom: 40}}>
        <FocusRegion id={regionId} entry={first ? tileId(view, first) : undefined} orientation="vertical" enabled={enabled}
          style={{flexDirection: 'row', flexWrap: 'wrap', gap: 34}}>
          {view === 'playlists' ? playlists.map(card => <SavedTVPlaylistTile key={card.id} card={card} runtime={runtime} onOpen={() => openPlaylist(card)}/>)
            : view === 'collections' ? resources.map(resource => <SavedTVCollectionTile key={resource.id} resource={resource} runtime={runtime} onOpen={() => openResource(resource)}/>)
              : resources.map(resource => <SavedTVViewTile key={resource.id} resource={resource} libraries={libraries} runtime={runtime} onOpen={() => openResource(resource)}/>)}
        </FocusRegion>
        {!!(view === 'playlists' ? saved?.pagination.next.length : personal?.nextCursor) && <View style={{alignItems: 'center', paddingTop: 20}}>
          <Focusable accessibilityRole="button" focusId="tv-saved-more" disabled={!enabled} onPress={() => {void destination.next(view === 'playlists' ? saved?.pagination.next[0]?.sectionId : undefined).catch(runtime.reportError);}}
            style={{height: 64, paddingHorizontal: 26, borderRadius: 14, backgroundColor: theme.colors.raised, justifyContent: 'center'}}>
            <Text style={[browseType(theme, 22, 700), {color: theme.colors.text}]}>{t('action.showMore')}</Text>
          </Focusable>
        </View>}
      </ScrollView>}
  </View>;
}

function tileId(view: NativeSavedTVDirectoryView, id: string) {return `saved-tv-${view}-${id}`;}

function SavedTVPlaylistTile({card, runtime, onOpen}: {card: PlaylistCard; runtime: NativeShellRuntime; onOpen: () => void}) {
  const theme = useTheme(), covers = (card.artworkPaths ?? []).map(path => runtime.artwork(path)).filter((source): source is NonNullable<typeof source> => !!source);
  return <CardFrame testID={tileId('playlists', card.id)} focusId={tileId('playlists', card.id)} title={card.title} width={236} onNavigate={onOpen}>
    {() => <View style={{width: 236}}>
      <View style={{width: 236, height: 236, borderRadius: 14, overflow: 'hidden'}}>
        <CoverMosaic covers={covers} shape="square" width={236} height={236} visible/>
      </View>
      <Text numberOfLines={1} style={[browseType(theme, 24, 700), {color: theme.colors.textSecondary, marginTop: 14}]}>{card.title}</Text>
      <View style={{flexDirection: 'row', gap: 8, marginTop: 3}}>
        {!!savedItemCount(card.count) && <Text numberOfLines={1} style={[browseType(theme, 20), {color: theme.colors.textTertiary}]}>{savedItemCount(card.count)}</Text>}
        {!!card.subtitle && <Text numberOfLines={1} style={[browseType(theme, 20), {color: theme.colors.textTertiary}]}>{card.subtitle}</Text>}
      </View>
    </View>}
  </CardFrame>;
}

function SavedTVCollectionTile({resource, runtime, onOpen}: {resource: PersonalResource; runtime: NativeShellRuntime; onOpen: () => void}) {
  const theme = useTheme(), covers = (resource.artworkPaths ?? []).map(path => runtime.artwork(path)).filter((source): source is NonNullable<typeof source> => !!source), visibility = savedVisibility(resource);
  return <CardFrame testID={tileId('collections', resource.id)} focusId={tileId('collections', resource.id)} title={resource.name} width={236} onNavigate={onOpen}>
    {() => <View style={{width: 236}}>
      <View style={{width: 236, height: 236, borderRadius: 14, overflow: 'hidden'}}>
        <CoverMosaic covers={covers} shape="square" width={236} height={236} visible/>
      </View>
      <Text numberOfLines={1} style={[browseType(theme, 24, 700), {color: theme.colors.textSecondary, marginTop: 14}]}>{resource.name}</Text>
      {!!savedTitleCount(resource.entryCount) && <Text numberOfLines={1} style={[browseType(theme, 20), {color: theme.colors.textTertiary, marginTop: 3}]}>{savedTitleCount(resource.entryCount)}</Text>}
      <View style={{flexDirection: 'row', alignItems: 'center', gap: 8, marginTop: 3}}>
        <Icon name={visibility.icon} size={18} color={visibility.strong ? theme.colors.accentStrong : theme.colors.textTertiary}/>
        <Text numberOfLines={2} style={[browseType(theme, 20, visibility.strong ? 700 : 600), {color: visibility.strong ? theme.colors.accentStrong : theme.colors.textTertiary, flexShrink: 1}]}>{visibility.text}</Text>
      </View>
    </View>}
  </CardFrame>;
}

function SavedTVViewTile({resource, libraries, runtime, onOpen}: {resource: PersonalResource; libraries: readonly Library[]; runtime: NativeShellRuntime; onOpen: () => void}) {
  const theme = useTheme(), library = savedLibraryName(libraries, resource.definition?.libraryId), samples = (resource.samples ?? []).slice(0, 4),
    square = samples.length > 0 && ['album', 'song', 'book', 'audiobook_file'].includes(samples[0]!.kind);
  return <CardFrame testID={tileId('views', resource.id)} focusId={tileId('views', resource.id)} title={resource.name} width={520} onNavigate={onOpen}>
    {() => <View style={{width: 520, height: 300, borderRadius: 16, overflow: 'hidden', backgroundColor: theme.colors.raised}}>
      {!!samples[0] && <View pointerEvents="none" style={{position: 'absolute', inset: 0, opacity: .32}}><AmbientArt source={runtime.ambient(samples[0]!.backdropUrl ?? samples[0]!.posterUrl)} treatment="library"/></View>}
      <View style={{flex: 1, paddingHorizontal: 28, paddingVertical: 26}}>
        <View style={{flexDirection: 'row', alignItems: 'center', gap: 14}}>
          <View style={{width: 52, height: 52, borderRadius: 13, backgroundColor: alpha(theme.colors.text, .1), alignItems: 'center', justifyContent: 'center'}}>
            <Icon name="i-filter" size={28} color={theme.colors.text}/>
          </View>
          <Text numberOfLines={2} style={[browseType(theme, 32, 800, -.025, 35.2), {color: theme.colors.text, flex: 1}]}>{resource.name}</Text>
        </View>
        <View style={{flexDirection: 'row', alignItems: 'center', gap: 12, marginTop: 16}}>
          {!!library && <Text style={[browseType(theme, 20, 700), {color: theme.colors.accentStrong}]}>{library}</Text>}
        </View>
        {!!resource.summary && <Text numberOfLines={2} style={[browseType(theme, 22, 400, 0, 30.8), {color: theme.colors.textSecondary, marginTop: 6}]}>{resource.summary}</Text>}
        <View style={{flexDirection: 'row', alignItems: 'flex-end', gap: 8, marginTop: 'auto'}}>
          {samples.map((entry, index) => <MediaArt key={entry.id} kind={square ? 'square' : 'poster'} source={runtime.artwork(entry.posterUrl)} width={square ? 84 : 56} height={square ? 84 : 84}
            style={{borderRadius: square ? 6 : 6}} visible priority={index === 0}/>)}
          <View style={{marginLeft: 'auto', flexDirection: 'row', alignItems: 'baseline', gap: 6}}>
            <Text style={[browseType(theme, 22, 700), {color: theme.colors.text}]}>{savedTitleCount(resource.entryCount)}</Text>
          </View>
        </View>
      </View>
    </View>}
  </CardFrame>;
}

