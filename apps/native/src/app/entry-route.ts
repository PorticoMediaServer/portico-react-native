import type {ContentEntry} from '../../../../packages/client-core/src/library-content';
import {continueTitle} from '../../../../packages/client-core/src/presentation/index';
import type {ContentStackParams} from './routes';

export type EntryRoute = {[K in keyof ContentStackParams]: {name: K; params: ContentStackParams[K]}}[keyof ContentStackParams];

/** The screen an entry's server-given destination opens, or nothing when it only plays. */
export function routeForEntry(entry: ContentEntry, libraryId?: string): EntryRoute | null {
  const library = entry.libraryId ?? libraryId ?? '';
  const target = entry.navigation;
  if (!target) return null;
  // Spec — Title Pages §3: an episode opens its show's page at the episode's season, with the
  // episode brought into view and marked a moment, nothing opened. The show's name stands in
  // for the page's title until it loads.
  if (target.view === 'item' && entry.kind === 'episode') return {name: 'Show', params: {libraryId: library, episodeId: target.entityId ?? entry.id, title: continueTitle(entry)}};
  if (target.view === 'item') return {name: 'Detail', params: {libraryId: library, itemId: target.entityId ?? entry.id}};
  if (target.view === 'show') return {name: 'Show', params: {libraryId: library, showId: target.entityId ?? entry.id, title: entry.title}};
  if (target.view === 'season') return {name: 'Show', params: {libraryId: library, seasonId: target.entityId ?? entry.id, title: entry.title}};
  if (target.category !== undefined || target.view === 'browse' || target.view === 'discover' || target.view === 'collections' || target.view === 'categories') {
    return {name: 'Library', params: {libraryId: library, tab: target.view === 'discover' || target.view === 'collections' ? target.view : 'browse', category: target.category}};
  }
  return {name: 'Entity', params: {libraryId: library, view: target.view, entityId: target.entityId ?? entry.id, title: entry.title}};
}
