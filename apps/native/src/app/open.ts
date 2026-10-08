import {getContainerState, type ContainerStateApi} from '../../../../packages/client-core/src/container-state';
import {useNavigation} from '@react-navigation/native';
import type {NativeStackNavigationProp} from '@react-navigation/native-stack';
import {useCallback} from 'react';
import type {ContentEntry} from '../../../../packages/client-core/src/library-content';
import type {ContentStackParams} from './routes';
import {usePlayerActions, type EntryOrigin} from './player-actions';

export type OpenIntent = 'open' | 'play' | 'more';

export type EntryRoute = {[K in keyof ContentStackParams]: {name: K; params: ContentStackParams[K]}}[keyof ContentStackParams];

/** The screen an entry's server-given destination opens, or nothing when it only plays. */
export function routeForEntry(entry: ContentEntry, libraryId?: string): EntryRoute | null {
  const library = entry.libraryId ?? libraryId ?? '';
  const target = entry.navigation;
  if (!target) return null;
  // Spec — Title Pages §3: an episode opens on its show's page, with that episode's panel open.
  if (target.view === 'item' && entry.kind === 'episode') return {name: 'Show', params: {libraryId: library, episodeId: target.entityId ?? entry.id, title: entry.title}};
  if (target.view === 'item') return {name: 'Detail', params: {libraryId: library, itemId: target.entityId ?? entry.id}};
  if (target.view === 'show') return {name: 'Show', params: {libraryId: library, showId: target.entityId ?? entry.id, title: entry.title}};
  if (target.view === 'season') return {name: 'Show', params: {libraryId: library, seasonId: target.entityId ?? entry.id, title: entry.title}};
  if (target.category !== undefined || target.view === 'browse' || target.view === 'discover' || target.view === 'collections' || target.view === 'categories') {
    return {name: 'Library', params: {libraryId: library, tab: target.view === 'discover' || target.view === 'collections' ? target.view : 'browse', category: target.category}};
  }
  return {name: 'Entity', params: {libraryId: library, view: target.view, entityId: target.entityId ?? entry.id, title: entry.title}};
}

/**
 * Where a linked title id (`portico://item/<id>`, a Top Shelf card) opens. A link carries only the
 * id: a playable title answers as an item; a show, album, book or artist is asked for by kind,
 * and the answer names its library. Null when this profile cannot see the title.
 */
export async function routeForLinkedTitle(api: {item(id: string): Promise<{libraryId: string}>} & ContainerStateApi, id: string): Promise<EntryRoute | null> {
  try {
    const item = await api.item(id);
    return {name: 'Detail', params: {libraryId: item.libraryId, itemId: id}};
  } catch { /* not a playable title: a container, or not visible */ }
  for (const kind of ['show', 'album', 'book', 'artist'] as const) {
    try {
      const state = await getContainerState(api, kind, id);
      if (!state.libraryId) continue;
      return kind === 'show' ? {name: 'Show', params: {libraryId: state.libraryId, showId: id}} : {name: 'Entity', params: {libraryId: state.libraryId, view: kind, entityId: id}};
    } catch { /* not this kind */ }
  }
  return null;
}

/**
 * Resolves what tapping an entry means. The server tells us the destination
 * (`navigation`) and whether it is directly playable (`playback`); we only
 * translate that to a route or a player intent.
 */
export function useOpenEntry() {
  const navigation = useNavigation<NativeStackNavigationProp<ContentStackParams>>();
  const player = usePlayerActions();
  return useCallback(
    (entry: ContentEntry, intent: OpenIntent = 'open', libraryId?: string, origin?: EntryOrigin) => {
      if (intent === 'play' && entry.playback) {
        player.play(entry.playback.itemId, entry.playback.startSeconds ?? entry.progressSeconds ?? 0, entry);
        return;
      }
      if (intent === 'more') {
        player.more(entry, origin);
        return;
      }
      const route = routeForEntry(entry, libraryId);
      if (!route) {
        if (entry.playback) player.play(entry.playback.itemId, entry.playback.startSeconds ?? 0, entry);
        return;
      }
      (navigation.push as (name: string, params: unknown) => void)(route.name, route.params);
    },
    [navigation, player],
  );
}
