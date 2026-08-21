import type {MediaItem, SearchResponse} from '@porticomediaserver/client-core';
import {hasSearchResults, searchGroupViewModels} from './search';

const media = {
  id: 'fargo',
  type: 'movie',
  title: 'Fargo',
  genres: [],
  images: {poster: '/poster'},
  actions: [],
  state: {favorite: false, watched: false, watchlisted: false, progressSeconds: 0},
} as unknown as MediaItem;

test('search preserves non-empty server groups and their ordering', () => {
  const response = {
    query: 'fargo',
    sort: 'relevance',
    direction: 'desc',
    groups: [
      {id: 'movies', title: 'Movies', entityKind: 'movie', items: [media], hasMore: true, nextCursor: 'movies-2'},
      {id: 'shows', title: 'Shows', entityKind: 'show', items: [], hasMore: false},
    ],
  } as SearchResponse;
  const groups = searchGroupViewModels(response, {imageResourceUrl: path => `https://server.test${path}`});
  expect(groups.map(group => group.title)).toEqual(['Movies']);
  expect(groups[0].items[0].title).toBe('Fargo');
  expect(groups[0]).toMatchObject({hasMore: true, nextCursor: 'movies-2'});
  expect(hasSearchResults(groups)).toBe(true);
});
