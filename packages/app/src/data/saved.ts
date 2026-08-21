import type {CursorListResponse, MediaCard, MediaItem, PorticoClient} from '@porticomediaserver/client-core';
import type {MediaViewModel} from './contracts';
import {mediaCardViewModel, mediaViewModel} from './mediaAdapters';

export const savedTabs = ['Watchlist', 'Favorites', 'Playlists', 'Collections', 'Saved views'] as const;
export type SavedTab = (typeof savedTabs)[number];

type ImageClient = Pick<PorticoClient, 'imageResourceUrl'>;

export function normalizeSavedTab(value: string): SavedTab {
  return savedTabs.includes(value as SavedTab) ? value as SavedTab : 'Watchlist';
}

export interface SavedResourceViewModel {
  id: string;
  title: string;
  summary?: string;
  itemCount?: number;
  visibility?: string;
}

export function savedResourceViewModels(items: Array<{id: string; title: string; summary?: string; itemCount?: number; visibility?: string}>): SavedResourceViewModel[] {
  return items.map(item => ({...item}));
}

export function savedMediaCardViewModels(items: MediaCard[], client: ImageClient): MediaViewModel[] {
  return items.map(item => mediaCardViewModel(item, client));
}

export function savedMediaViewModels(
  response: CursorListResponse<MediaItem>,
  client: ImageClient,
): MediaViewModel[] {
  return response.items.map(item => mediaViewModel(item, client));
}
