import React, {useEffect, useMemo, useRef, useState, useSyncExternalStore, type RefObject} from 'react';
import {ScrollView, Text, View, useWindowDimensions} from 'react-native';
import {useSafeAreaInsets} from 'react-native-safe-area-context';
import {defaultI18n, type MessageId} from '../../../../../packages/i18n/src';
import type {Library} from '../../../../../packages/client-core/src/index';
import type {ContentEntry} from '../../../../../packages/client-core/src/library-content';
import type {PersonalResource} from '../../../../../packages/client-core/src/personal-saved';
import type {PlaylistCard, PlaylistListFilter, SavedRoute} from '../../../../../packages/client-core/src/saved';
import {Button, Chip, Focusable} from '../../kit/controls';
import {Artwork, type ArtworkSource} from '../../kit/artwork';

import {Icon, type IconName} from '../../kit/Icon';
import {Banner} from '../../kit/overlays';
import {StateView} from '../../kit/states';
import {browseType, alpha} from '../../kit/browse/presentation';
import {useTheme} from '../../kit/theme';
import type {NativeShellRuntime} from '../../shell/runtime';
import type {NativeEntryMenuState} from '../destinations/entry-actions';
import type {NativeDestinationActivationPort} from '../destinations/focus';
import type {NativeSavedViewDestination} from './view-model';
import {SavedNameSheet} from './SavedForms';
import {savedItemCount, savedLibraryName, savedTitleCount, savedViewCount, savedVisibility} from './presentation';

const t = defaultI18n.t;

type DirectoryView = 'playlists' | 'collections' | 'views';
export type NativeSavedDirectoryRoute = Readonly<{view: DirectoryView; sort?: string; direction?: 'asc' | 'desc'; filter?: PlaylistListFilter; shape?: 'posters' | 'squares'}>;

export type NativeSavedDirectoryProps = Readonly<{
  route: NativeSavedDirectoryRoute;
  destination: NativeSavedViewDestination;
  activation: NativeDestinationActivationPort;
  runtime: NativeShellRuntime;
  actions: Readonly<{menuState?: NativeEntryMenuState}>;
  libraries: readonly Library[];
  back: () => void;
  open: (route: SavedRoute) => void;
}>;

/** collections.html 10a–10c. Each directory is the server's own bounded page;
 * the + sends the real create command and the rows open the pushed pages. */
export function SavedDirectoryScreen({route, destination, activation, runtime, libraries, back, open}: NativeSavedDirectoryProps) {
  const theme = useTheme(), insets = useSafeAreaInsets(), dimensions = useWindowDimensions();
  const active = useSyncExternalStore(activation.subscribe, activation.getSnapshot);
  const snapshot = useSyncExternalStore(destination.subscribe, destination.getSnapshot);
  const [creating, setCreating] = useState(false), [busy, setBusy] = useState(false), [problem, setProblem] = useState<string>();
  useEffect(() => {void destination.select(route).catch(runtime.reportError);}, [destination, route, runtime]);
  const saved = snapshot.saved, personal = snapshot.personal;
  const error = snapshot.error ?? saved?.error ?? personal?.error;
  const loading = snapshot.phase === 'loading' && !saved?.projection && !personal?.resources.length;
  const playlists = route.view === 'playlists' ? (saved?.projection?.sections ?? []).flatMap(section => section.entries.filter((entry): entry is PlaylistCard => entry.kind === 'playlist')) : [];
  const resources = route.view === 'playlists' ? [] : personal?.resources ?? [];
  const title = t(route.view === 'playlists' ? 'saved.tab.playlists' : route.view === 'collections' ? 'saved.tab.collections' : 'saved.tab.savedViews');
  const createEnabled = route.view === 'playlists' ? saved?.projection?.actions?.includes('create_playlist') === true : route.view === 'collections';
  const filters = route.view === 'playlists' ? saved?.projection?.filters ?? [] : [];
  const sorts = route.view === 'playlists' ? saved?.projection?.sorts ?? [] : [];
  const width = dimensions.width - theme.gutter * 2;
  const create = (input: {name: string; summary: string; visibility: 'private' | 'server'}) => {
    if (busy) return;
    setBusy(true); setProblem('');
    const task = route.view === 'playlists'
      ? destination.mutateSaved({action: 'create', name: input.name, ...(input.summary ? {summary: input.summary} : {})})
      : destination.mutatePersonal({action: 'create', kind: 'collection', name: input.name, summary: input.summary, visibility: input.visibility});
    void Promise.resolve(task).then(result => {if (result === false) throw new Error(t('error.unavailable')); setCreating(false);})
      .catch((failure: unknown) => setProblem(failure instanceof Error ? failure.message : t('error.unavailable')))
      .finally(() => setBusy(false));
  };
  const retry = () => {void destination.retry().catch(runtime.reportError);};
  const empty = (id: MessageId, body: MessageId) => <StateView variant="inline" title={t(id)} body={t(body)}/>;
  return <View testID={`native-saved-directory-${route.view}`} pointerEvents={active.visible ? 'auto' : 'none'} accessibilityElementsHidden={!active.visible}
    importantForAccessibility={active.visible ? 'auto' : 'no-hide-descendants'} style={{flex: 1, backgroundColor: theme.colors.ink}}>
    <View style={{paddingTop: insets.top, backgroundColor: alpha(theme.colors.ink, .94), borderBottomColor: alpha(theme.colors.text, .07), borderBottomWidth: 1}}>
      <View style={{height: 44, paddingLeft: 12, paddingRight: 10, flexDirection: 'row', alignItems: 'center'}}>
        <Focusable testID="saved-directory-back" accessibilityRole="button" onPress={back} accessibilityLabel={t('saved.title')} style={{height: 38, marginLeft: -4, paddingRight: 6, justifyContent: 'center'}}>
          <View style={{flexDirection: 'row', alignItems: 'center'}}><Icon name="i-left" size={22} color={theme.colors.textSecondary}/>
            <Text style={[browseType(theme, 16, 600), {color: theme.colors.textSecondary}]}>{t('saved.title')}</Text></View>
        </Focusable>
        <View pointerEvents="none" style={{position: 'absolute', left: 118, right: 118, top: 0, height: 44, alignItems: 'center', justifyContent: 'center'}}>
          <Text numberOfLines={1} style={[browseType(theme, 17, 700), {color: theme.colors.text}]}>{title}</Text>
        </View>
        {createEnabled && <View style={{marginLeft: 'auto'}}>
          <Focusable testID={`saved-new-${route.view}`} accessibilityRole="button" accessibilityLabel={t(route.view === 'playlists' ? 'web.saved.newPlaylist' : 'web.saved.newCollection')}
            onPress={() => setCreating(true)} style={{width: 38, height: 38, alignItems: 'center', justifyContent: 'center'}}>
            <Icon name="i-plus" size={24} color={theme.colors.text}/>
          </Focusable>
        </View>}
      </View>
    </View>
    <ScrollView contentContainerStyle={{paddingBottom: 28 + insets.bottom}}>
      {route.view === 'playlists' && !!filters.length && <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{paddingHorizontal: theme.gutter, paddingTop: 10, paddingBottom: 10, gap: 8}}>
        {!!sorts.length && <Chip focusId="dir-sort" icon="i-sort" trailingIcon="i-down" onPress={() => {
          const current = sorts.find(sort => sort.id === (saved?.projection?.query.sort ?? sorts[0]?.id)) ?? sorts[0]!;
          const direction = saved?.projection?.query.direction === 'asc' ? 'desc' : 'asc';
          void destination.select({view: 'playlists', sort: current.id, direction, ...(route.filter ? {filter: route.filter} : {})}).catch(runtime.reportError);
        }}>{playlistSortLabel(saved?.projection?.query.sort)}</Chip>}
        {filters.map(filter => filter.options.map(option => <Chip key={`${filter.id}:${option.id}`} focusId={`dir-filter-${option.id}`}
          selected={(route.filter ?? 'all') === option.id} count={option.count} onPress={() => {void destination.select({view: 'playlists', filter: option.id as PlaylistListFilter,
            ...(saved?.projection?.query.sort ? {sort: saved.projection.query.sort, direction: saved.projection.query.direction as 'asc' | 'desc'} : {})}).catch(runtime.reportError);}}>
          {option.label}</Chip>))}
      </ScrollView>}
      {route.view === 'views' && <Text style={[browseType(theme, 13, 400, 0, 19.5), {color: theme.colors.textTertiary, marginHorizontal: theme.gutter, marginTop: 12, marginBottom: 4}]}>{t('next.saved.viewsHelp')}</Text>}
      {problem !== '' && <View style={{paddingHorizontal: theme.gutter, paddingTop: 10}}><Banner variant="notice" tone="error" placement="inline" message={problem} action={{label: t('action.dismiss'), onPress: () => setProblem('')}}/></View>}
      {error && !loading ? <StateView variant="inline" {...runtime.error(error, retry)}/> : loading ? <View style={{paddingVertical: 32}}><Text style={[theme.type.body, {color: theme.colors.textTertiary, textAlign: 'center'}]}>{t('saved.loading')}</Text></View>
        : route.view === 'playlists' ? (playlists.length ? <View style={{marginTop: 6}}>{playlists.map(playlist => <SavedDirectoryRow key={playlist.id} id={`playlist-${playlist.id}`}
          title={playlist.title} caption={[savedItemCount(playlist.count), playlist.subtitle].filter(Boolean)} mosaic={(playlist.artworkPaths ?? []).map(path => runtime.artwork(path))}
          pinned={false} onPress={() => open({view: 'playlist', playlistId: playlist.id})}/>)}</View>
          : empty('web.saved.empty.playlists', 'web.saved.empty.playlistsBody'))
        : resources.length ? <View style={{marginTop: 6}}>{resources.map(resource => <SavedDirectoryRow key={resource.id} id={`resource-${resource.id}`} title={resource.name}
          caption={route.view === 'collections' ? [savedTitleCount(resource.entryCount)] : [resource.definition ? savedLibraryName(libraries, resource.definition.libraryId) : undefined,
            savedViewCount(resource.entryCount)]} note={route.view === 'collections' ? savedVisibility(resource) : undefined} summary={route.view === 'views' ? resource.summary : undefined} filterTile={route.view === 'views'} pinned={resource.pinned}
          mosaic={(resource.artworkPaths ?? []).map(path => runtime.artwork(path))} onPress={() => open({view: 'resource', resourceId: resource.id})}/>)}</View>
          : empty(route.view === 'collections' ? 'web.saved.empty.collections' : 'web.saved.empty.views', route.view === 'collections' ? 'web.saved.empty.collectionsBody' : 'web.saved.empty.viewsBody')}
      {!!(route.view === 'playlists' ? saved?.pagination.next.length : personal?.nextCursor) && <View style={{alignItems: 'center', paddingVertical: 16}}>
        <Button variant="glass" size="compact" onPress={() => {void destination.next(route.view === 'playlists' ? saved?.pagination.next[0]?.sectionId : undefined).catch(runtime.reportError);}}>{t('action.showMore')}</Button>
      </View>}
    </ScrollView>
    <SavedNameSheet open={creating} title={t(route.view === 'playlists' ? 'web.saved.newPlaylist' : 'web.saved.newCollection')} action={t('web.saved.create')}
      withSummary withVisibility={route.view === 'collections'} busy={busy} error={problem || undefined} testID="saved-create" onClose={() => setCreating(false)} onSave={create}/>
  </View>;
}

function playlistSortLabel(sort: string | undefined): string {
  if (sort === 'title') return t('web.saved.sort.title');
  if (sort === 'created') return t('playlists.sort', {field: 'created'});
  if (sort === 'updated' || sort === 'added') return t('web.saved.sort.added');
  if (sort === 'count') return t('playlists.sort', {field: 'count'});
  return t('web.saved.sort.other');
}

function SavedDirectoryRow({id, title, caption, note, summary, mosaic, filterTile, pinned, onPress}: {
  id: string; title: string; caption: readonly (string | undefined)[]; note?: Readonly<{text: string; icon: IconName; strong: boolean}>; summary?: string; mosaic: readonly (ArtworkSource | undefined)[]; filterTile?: boolean; pinned?: boolean; onPress: () => void;
}) {
  const theme = useTheme(), paths = mosaic.filter((source): source is NonNullable<typeof source> => !!source).slice(0, 4);
  return <Focusable testID={`saved-directory-${encodeURIComponent(id)}`} focusId={`saved-directory-${id}`} accessibilityRole="button" accessibilityLabel={title} onPress={onPress}
    focusKind="row" style={{flexDirection: 'row', alignItems: 'center', gap: 14, paddingVertical: 8, paddingLeft: theme.gutter, paddingRight: 18, minHeight: 80}}>
      {filterTile ? <View style={{width: 56, height: 56, borderRadius: 12, backgroundColor: theme.colors.raisedBright, alignItems: 'center', justifyContent: 'center'}}>
        <Icon name="i-filter" size={24} color={theme.colors.text}/></View>
        : <View style={{width: 64, height: 64, borderRadius: 10, overflow: 'hidden', backgroundColor: theme.colors.ink, flexDirection: 'row', flexWrap: 'wrap', gap: 1}}>
          {paths.map((source, index) => <Artwork key={`${source.cacheKey}:${index}`} source={source} width={31.5} height={31.5} visible priority={index === 0} style={{borderRadius: 0}}/>)}
        </View>}
      <View style={{flex: 1, minWidth: 0, gap: 3}}>
        <Text numberOfLines={1} style={[browseType(theme, 16, 700, -.01), {color: theme.colors.text}]}>{title}</Text>
        {!!caption.filter(Boolean).length && <View style={{flexDirection: 'row', flexWrap: 'wrap', gap: 8}}>{caption.filter((part): part is string => !!part).map(part =>
          <Text key={part} numberOfLines={1} style={[browseType(theme, 13, 400), {color: theme.colors.textTertiary}]}>{part}</Text>)}</View>}
        {note && <View style={{flexDirection: 'row', alignItems: 'center', gap: 5, marginTop: 1}}><Icon name={note.icon} size={13} color={note.strong ? theme.colors.accentStrong : theme.colors.textTertiary}/>
          <Text numberOfLines={2} style={[browseType(theme, 13, note.strong ? 700 : 600), {color: note.strong ? theme.colors.accentStrong : theme.colors.textTertiary, flexShrink: 1}]}>{note.text}</Text></View>}
        {!!summary && <Text numberOfLines={2} style={[browseType(theme, 12.5, 400, 0, 17.5), {color: theme.colors.textSecondary}]}>{summary}</Text>}
      </View>
      {pinned && <Icon name="i-bookmark-f" size={16} color={theme.colors.accentStrong}/>}
      <Icon name="i-right" size={18} color={theme.colors.lineStrong}/>
    <View pointerEvents="none" style={{position: 'absolute', left: 98, right: 0, bottom: 0, height: 1, backgroundColor: alpha(theme.colors.lineStrong, .35)}}/>
  </Focusable>;
}
