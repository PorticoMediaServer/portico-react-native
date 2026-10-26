import React from 'react';
import {ScrollView, Text, View} from 'react-native';
import {defaultI18n} from '../../../../../packages/i18n/src';
import type {Library} from '../../../../../packages/client-core/src/index';
import type {PersonalResource} from '../../../../../packages/client-core/src/personal-saved';
import type {PlaylistCard, PlaylistListFilter} from '../../../../../packages/client-core/src/saved';
import {Focusable} from '../../kit/controls';
import {AmbientArt, CoverMosaic, MediaArt} from '../../kit/artwork';
import {CardFrame} from '../../kit/cards/primitives';
import {FocusItem, FocusRegion, type FocusEdges} from '../../kit/focus';
import {Icon} from '../../kit/Icon';
import {StateView} from '../../kit/states';
import {alpha, browseType} from '../../kit/browse/presentation';
import {useTheme} from '../../kit/theme';
import type {NativeShellRuntime} from '../../shell/runtime';
import type {NativeSavedViewDestination} from './view-model';
import {PlaylistToolbar} from './PlaylistToolbar';
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
  edges?: FocusEdges;
  select: (route: Readonly<{view: NativeSavedTVDirectoryView; sort?: string; direction?: 'asc' | 'desc'; filter?: PlaylistListFilter}>) => void;
  openPlaylist: (card: PlaylistCard) => void;
  openResource: (resource: PersonalResource) => void;
}>;

export function SavedTVDirectory({view, destination, runtime, libraries, enabled, regionId, edges, select, openPlaylist, openResource}: NativeSavedTVDirectoryProps) {
  const theme = useTheme();
  const snapshot = React.useSyncExternalStore(destination.subscribe, destination.getSnapshot);
  const saved = snapshot.saved, personal = snapshot.personal;
  const playlists = view === 'playlists' ? (saved?.projection?.sections ?? []).flatMap(section => section.entries.filter((entry): entry is PlaylistCard => entry.kind === 'playlist')) : [];
  const resources = view === 'playlists' ? [] : personal?.resources ?? [];
  const filters = view === 'playlists' ? saved?.projection?.filters ?? [] : [];
  const sorts = view === 'playlists' ? saved?.projection?.sorts ?? [] : [];
  const error = snapshot.error ?? saved?.error ?? personal?.error, loading = snapshot.phase === 'loading' && !saved?.projection && !personal?.resources.length;
  const count = view === 'playlists' ? (saved?.projection?.sections[0]?.totalCount ?? playlists.length) : resources.length;
  const countText = view === 'playlists' ? t('next.saved.playlistCount', {count}) : view === 'collections' ? savedCollectionCount(count) : savedViewCount(count);
  // collections.html 15-17: the page starts at 200 and ends 96 from the right, so six 236 tiles
  // (34 apart) or three 520 saved-view tiles (32 apart) fit the frame's row exactly.
  const columns = view === 'views' ? {columnGap: 32, rowGap: 36} : {columnGap: 34, rowGap: 44};
  // The tiles are fixed width, so the row the frame draws is the measured content width divided
  // by a tile and a gap. Until it has been measured, the authored rows stand: six 236 tiles or
  // three 520 saved-view tiles.
  const tileWidth = view === 'views' ? 520 : 236, gap = view === 'views' ? 32 : 34;
  const [rowWidth, setRowWidth] = React.useState(0);
  const columnCount = rowWidth > 0 ? Math.max(1, Math.floor((rowWidth + gap) / (tileWidth + gap))) : view === 'views' ? 3 : 6;
  const drawn = view === 'playlists' ? playlists.length : resources.length;
  return <FocusRegion id={regionId} orientation="vertical" enabled={enabled} edges={edges}
    grid={{columns: columnCount, count: drawn}} style={{flex: 1}}>
    <View style={{height: 76, flexDirection: 'row', alignItems: 'center', gap: 14, paddingLeft: theme.gutter, paddingRight: theme.layout.gutter.tvRight}}>
      {view === 'playlists' && !!sorts.length && <PlaylistToolbar sorts={sorts} filters={filters} enabled={enabled}
        value={{sort: saved?.projection?.query.sort ?? sorts[0]?.id ?? '',
          direction: saved?.projection?.query.direction === 'asc' ? 'asc' : 'desc',
          filter: (saved?.projection?.query.category ?? 'all') as PlaylistListFilter}}
        onSelect={next => select({view: 'playlists', ...(next.sort !== undefined ? {sort: next.sort} : {}),
          ...(next.direction !== undefined ? {direction: next.direction} : {}), ...(next.filter !== undefined ? {filter: next.filter} : {})})}/>}
      <Text style={[browseType(theme, 22), {color: theme.colors.textTertiary, marginLeft: 'auto'}]}>{countText}</Text>
    </View>
    {error && !loading ? <StateView variant="panel" {...runtime.error(error, () => {void destination.retry().catch(runtime.reportError);})}/>
      : loading ? <Text style={[browseType(theme, 24), {color: theme.colors.textTertiary, textAlign: 'center', paddingTop: 40}]}>{t('saved.loading')}</Text>
      : !count ? <StateView variant="panel" icon={view === 'playlists' ? 'i-queue' : view === 'collections' ? 'i-stack' : 'i-filter'}
        title={t(view === 'playlists' ? 'web.saved.empty.playlists' : view === 'collections' ? 'web.saved.empty.collections' : 'web.saved.empty.views')}
        body={t(view === 'playlists' ? 'web.saved.empty.playlistsBody' : view === 'collections' ? 'web.saved.empty.collectionsBody' : 'web.saved.empty.viewsBody')}/>
      : <ScrollView contentContainerStyle={{paddingLeft: theme.gutter, paddingRight: theme.layout.gutter.tvRight, paddingBottom: 40}}>
        <View style={{flexDirection: 'row', flexWrap: 'wrap', ...columns}}
          onLayout={event => {const next = Math.round(event.nativeEvent.layout.width); setRowWidth(current => current === next ? current : next);}}>
          {view === 'playlists' ? playlists.map((card, index) => <FocusItem key={card.id} focusId={tileId(view, card.id)} cell={{index}}>
            <SavedTVPlaylistTile card={card} runtime={runtime} onOpen={() => openPlaylist(card)}/></FocusItem>)
            : view === 'collections' ? resources.map((resource, index) => <FocusItem key={resource.id} focusId={tileId(view, resource.id)} cell={{index}}>
              <SavedTVCollectionTile resource={resource} runtime={runtime} onOpen={() => openResource(resource)}/></FocusItem>)
              : resources.map((resource, index) => <FocusItem key={resource.id} focusId={tileId(view, resource.id)} cell={{index}}>
                <SavedTVViewTile resource={resource} libraries={libraries} runtime={runtime} onOpen={() => openResource(resource)}/></FocusItem>)}
        </View>
        {!!(view === 'playlists' ? saved?.pagination.next.length : personal?.nextCursor) && <View style={{alignItems: 'center', paddingTop: 20}}>
          <Focusable accessibilityRole="button" focusId="tv-saved-more" disabled={!enabled} onPress={() => {void destination.next(view === 'playlists' ? saved?.pagination.next[0]?.sectionId : undefined).catch(runtime.reportError);}}
            style={{height: 64, paddingHorizontal: 26, borderRadius: 14, backgroundColor: theme.colors.raised, justifyContent: 'center'}}>
            <Text style={[browseType(theme, 22, 700), {color: theme.colors.text}]}>{t('action.showMore')}</Text>
          </Focusable>
        </View>}
      </ScrollView>}
  </FocusRegion>;
}

function tileId(view: NativeSavedTVDirectoryView, id: string) {return `saved-tv-${view}-${id}`;}

/** collections.html 15 puts a pinned playlist's bookmark on its mosaic and the day it changed
 * beside its count; a server that sends neither draws neither. */
function changedDay(value: string | undefined): string | undefined {
  if (!value) return undefined;
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) return undefined;
  const now = new Date(), at = new Date(date.getFullYear(), date.getMonth(), date.getDate()), today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const days = Math.round((today.getTime() - at.getTime()) / 86400000);
  if (days === 0) return t('saved.today');
  if (days === 1) return t('relative.yesterday');
  return defaultI18n.date(date, 'dayMonth');
}

function SavedTVPlaylistTile({card, runtime, onOpen}: {card: PlaylistCard; runtime: NativeShellRuntime; onOpen: () => void}) {
  const theme = useTheme(), covers = (card.artworkPaths ?? []).map(path => runtime.artwork(path)).filter((source): source is NonNullable<typeof source> => !!source), day = changedDay(card.lastChanged);
  return <CardFrame testID={tileId('playlists', card.id)} focusId={tileId('playlists', card.id)} title={card.title} width={236} onNavigate={onOpen}>
    {() => <View style={{width: 236}}>
      <View style={{width: 236, height: 236, borderRadius: 14, overflow: 'hidden', backgroundColor: theme.colors.raised}}>
        <CoverMosaic covers={covers} shape="square" width={236} height={236} visible/>
        {card.pinned === true && <View pointerEvents="none" accessibilityElementsHidden importantForAccessibility="no-hide-descendants" style={{position: 'absolute', left: 12, top: 12, width: 40, height: 40, borderRadius: 20,
          alignItems: 'center', justifyContent: 'center', backgroundColor: 'rgba(7,16,24,.8)'}}>
          <Icon name="i-bookmark-f" size={20} color={theme.colors.accentStrong}/>
        </View>}
      </View>
      <Text numberOfLines={1} style={[browseType(theme, 24, 700), {color: theme.colors.textSecondary, marginTop: 14}]}>{card.title}</Text>
      <View style={{flexDirection: 'row', alignItems: 'center', gap: 8, marginTop: 3}}>
        {!!savedItemCount(card.count) && <Text numberOfLines={1} style={[browseType(theme, 20), {color: theme.colors.textTertiary}]}>{savedItemCount(card.count)}</Text>}
        {!!day && <><View style={{width: 4, height: 4, borderRadius: 2, backgroundColor: theme.colors.textTertiary}}/><Text numberOfLines={1} style={[browseType(theme, 20), {color: theme.colors.textTertiary}]}>{day}</Text></>}
      </View>
      {!!card.subtitle && <Text numberOfLines={1} style={[browseType(theme, 20), {color: theme.colors.textTertiary, marginTop: 3}]}>{card.subtitle}</Text>}
    </View>}
  </CardFrame>;
}

function SavedTVCollectionTile({resource, runtime, onOpen}: {resource: PersonalResource; runtime: NativeShellRuntime; onOpen: () => void}) {
  const theme = useTheme(), covers = (resource.artworkPaths ?? []).map(path => runtime.artwork(path)).filter((source): source is NonNullable<typeof source> => !!source),
    visibility = savedVisibility(resource, true),
    // collections.html 16's tile says the shorter line; the page (20) keeps the fuller one.
    visibilityText = visibility.id === 'server' ? t('next.saved.visibleToEveryone') : visibility.text;
  return <CardFrame testID={tileId('collections', resource.id)} focusId={tileId('collections', resource.id)} title={resource.name} width={236} onNavigate={onOpen}>
    {() => <View style={{width: 236}}>
      <View style={{width: 236, height: 236, borderRadius: 14, overflow: 'hidden'}}>
        <CoverMosaic covers={covers} shape="square" width={236} height={236} visible/>
      </View>
      <Text numberOfLines={1} style={[browseType(theme, 24, 700), {color: theme.colors.textSecondary, marginTop: 14}]}>{resource.name}</Text>
      {!!savedTitleCount(resource.entryCount) && <Text numberOfLines={1} style={[browseType(theme, 20), {color: theme.colors.textTertiary, marginTop: 3}]}>{savedTitleCount(resource.entryCount)}</Text>}
      <View style={{flexDirection: 'row', alignItems: 'center', gap: 8, marginTop: 3}}>
        <Icon name={visibility.icon} size={18} color={visibility.strong ? theme.colors.accentStrong : theme.colors.textTertiary}/>
        <Text numberOfLines={2} style={[browseType(theme, 20, visibility.strong ? 700 : 600), {color: visibility.strong ? theme.colors.accentStrong : theme.colors.textTertiary, flexShrink: 1}]}>{visibilityText}</Text>
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
          {/* collections.html 17 draws the On Home mark beside the library the view reads. */}
          {resource.onHome === true && <View style={{paddingVertical: 3, paddingHorizontal: 12, borderRadius: 8, borderWidth: 1.5, borderColor: alpha(theme.colors.text, .28)}}>
            <Text style={[browseType(theme, 20, 600), {color: theme.colors.text}]}>{t('next.saved.onHome')}</Text>
          </View>}
        </View>
        {!!resource.summary && <Text numberOfLines={2} style={[browseType(theme, 22, 400, 0, 30.8), {color: theme.colors.textSecondary, marginTop: 6}]}>{resource.summary}</Text>}
        <View style={{flexDirection: 'row', alignItems: 'flex-end', gap: 8, marginTop: 'auto'}}>
          {samples.map((entry, index) => <MediaArt key={entry.id} kind={square ? 'square' : 'poster'} source={runtime.artwork(entry.posterUrl)} width={square ? 84 : 56} height={square ? 84 : 84}
            style={{borderRadius: square ? 6 : 6}} visible priority={index === 0}/>)}
          <View style={{marginLeft: 'auto', flexDirection: 'row', alignItems: 'baseline', gap: 6}}>
            <Text style={[browseType(theme, 22, 700), {color: theme.colors.text}]}>{savedTitleCount(resource.entryCount)}</Text>
            {!!savedTitleCount(resource.entryCount) && <Text style={[browseType(theme, 20, 500), {color: theme.colors.textTertiary}]}>{t('next.saved.rightNow')}</Text>}
          </View>
        </View>
      </View>
    </View>}
  </CardFrame>;
}

