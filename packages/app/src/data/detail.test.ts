import type {MediaItem} from '@portico/client-core';
import {
  detailViewModel,
  initialTVSeasonId,
  shouldContinueToDeepLinkedEpisode,
} from './detail';

const client = {imageResourceUrl: (path: string) => `https://server.test${path}`};

function media(overrides: Partial<MediaItem> = {}): MediaItem {
  return {
    actions: ['play', 'watchlist.add', 'metadata.edit'],
    addedAt: '2026-01-01T00:00:00Z',
    genres: ['Drama'],
    id: 'movie',
    images: {poster: '/poster.jpg', backdrop: '/backdrop.jpg', thumb: ''},
    labels: [],
    metadataEtag: 'fixture-media-revision-1',
    metadataRevision: 1,
    sortTitle: 'Movie',
    state: {favorite: false, progressSeconds: 0, rating: 0, watched: false, watchlisted: false},
    tags: [],
    title: 'Movie',
    type: 'movie',
    ...overrides,
  };
}

test('builds live detail sections in the required order and filters server actions', () => {
  const result = detailViewModel(media({
    people: [{id: 'person_jane', name: 'Jane Actor', role: 'Actor', character: 'Lead', imageUrl: '/jane.jpg'}],
    extras: [{label: 'Trailers & Extras', type: 'trailer', items: [media({id: 'trailer', title: 'Trailer'})]}],
    recommendationRows: [{id: 'related', title: 'Related Media', type: 'poster', items: [media({id: 'related', title: 'Related'})]}],
    streams: [{id: 'video-1', kind: 'video', codec: 'hevc', displayTitle: '4K HEVC', width: 3840, height: 2160}],
  }), client, 'mobile');

  expect(result.actions).toEqual(['play', 'watchlist.add']);
  expect(result.people[0]).toMatchObject({name: 'Jane Actor', character: 'Lead', imageUrl: 'https://server.test/jane.jpg'});
  expect(result.extras[0]?.items[0]?.id).toBe('trailer');
  expect(result.recommendations[0]?.items[0]?.id).toBe('related');
  expect(result.facts).toContainEqual({label: 'Video', value: 'HEVC · 3840 × 2160'});
});

test('preserves canonical person identity across namesakes and credit reorder', () => {
  const first = detailViewModel(media({
    people: [
      {id: 'person_alex_1', name: 'Alex Smith', role: 'Actor', character: 'Lead'},
      {id: 'person_alex_2', name: 'Alex Smith', role: 'Director'},
    ],
  }), client, 'mobile');
  const reordered = detailViewModel(media({
    people: [
      {id: 'person_alex_2', name: 'Alex Smith', role: 'Director'},
      {id: 'person_alex_1', name: 'Alex Smith', role: 'Actor', character: 'Lead'},
    ],
  }), client, 'mobile');

  expect(first.people.map(person => person.id)).toEqual(['person_alex_1', 'person_alex_2']);
  expect(reordered.people.map(person => person.id)).toEqual(['person_alex_2', 'person_alex_1']);
  expect(new Set(first.people.map(person => person.id)).size).toBe(2);
});

test('selects an explicit or playback-target season without flattening inline episodes', () => {
  const seasonOne = media({id: 'season-1', parentId: 'show-1', type: 'season', title: 'Season 1'});
  const seasonTwo = media({id: 'season-2', parentId: 'show-1', type: 'season', title: 'Season 2'});
  const show = media({
    id: 'show-1',
    type: 'show',
    children: [seasonOne, seasonTwo],
    playbackTarget: media({id: 'episode-22', parentId: 'season-2', type: 'episode'}),
  });

  expect(initialTVSeasonId(show, 'season-1')).toBe('season-1');
  expect(initialTVSeasonId(show)).toBe('season-2');
  expect(initialTVSeasonId(show, 'missing-season')).toBe('season-2');
});

test('continues deep-linked episode pagination only while another healthy page exists', () => {
  expect(shouldContinueToDeepLinkedEpisode('episode-250', ['episode-1'], true, false)).toBe(true);
  expect(shouldContinueToDeepLinkedEpisode('episode-250', ['episode-250'], true, false)).toBe(false);
  expect(shouldContinueToDeepLinkedEpisode('episode-250', ['episode-1'], true, true)).toBe(false);
  expect(shouldContinueToDeepLinkedEpisode('episode-250', ['episode-1'], false, false)).toBe(false);
});

test('tvOS excludes download while retaining consumer media actions', () => {
  const result = detailViewModel(media({actions: ['download', 'favorite.add', 'media.delete']}), client, 'tv');
  expect(result.actions).toEqual(['favorite.add']);
});
