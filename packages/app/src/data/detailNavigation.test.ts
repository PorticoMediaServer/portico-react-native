import {detailRouteForMedia} from './detailNavigation';

test('deep-links an episode through its canonical show and season hierarchy', () => {
  expect(detailRouteForMedia({
    id: 'episode-250',
    kind: 'episode',
    parentId: 'season-3',
    grandparentId: 'show-9',
  })).toEqual({
    name: 'detail',
    mediaId: 'show-9',
    seasonId: 'season-3',
    episodeId: 'episode-250',
  });
});

test('does not derive a route identity from mutable title metadata', () => {
  const first = detailRouteForMedia({id: 'person-credit-1', kind: 'movie'});
  const renamed = detailRouteForMedia({id: 'person-credit-1', kind: 'movie'});
  expect(renamed).toEqual(first);
  expect(first.mediaId).toBe('person-credit-1');
});
