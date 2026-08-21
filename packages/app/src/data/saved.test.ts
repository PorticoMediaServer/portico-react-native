import type {CursorListResponse, MediaItem} from '@portico/client-core';
import {normalizeSavedTab, savedMediaViewModels} from './saved';

const media = {
  id: 'fargo',
  type: 'movie',
  title: 'Fargo',
  genres: [],
  images: {poster: '/poster'},
  actions: [],
  state: {favorite: false, watched: false, watchlisted: true, progressSeconds: 0},
} as unknown as MediaItem;

test('only server-backed Saved tabs are accepted', () => {
  expect(normalizeSavedTab('Favorites')).toBe('Favorites');
  expect(normalizeSavedTab('Playlists')).toBe('Playlists');
  expect(normalizeSavedTab('Anything else')).toBe('Watchlist');
});

test('saved responses are adapted without fixture membership', () => {
  const response = {items: [media], pageInfo: {hasMore: false, nextCursor: null}} as unknown as CursorListResponse<MediaItem>;
  const result = savedMediaViewModels(response, {imageResourceUrl: path => `https://server.test${path}`});
  expect(result).toHaveLength(1);
  expect(result[0]).toMatchObject({id: 'fargo', title: 'Fargo', poster: 'https://server.test/poster'});
});
