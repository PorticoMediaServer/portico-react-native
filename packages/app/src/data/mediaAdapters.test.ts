import type {HomeResponse, MediaCard, MediaItem} from '@portico/client-core';
import {formatDuration, homeViewModel, mediaCardViewModel, mediaViewModel} from './mediaAdapters';

const client = {
  imageResourceUrl: (path: string, options?: {width?: number}) => `https://server.test${path}?width=${options?.width}`,
};

function media(overrides: Partial<MediaItem> = {}): MediaItem {
  return {
    actions: ['play', 'watchlist.remove', 'favorite.remove'],
    addedAt: '2026-07-01T00:00:00Z',
    genres: ['Crime drama'],
    id: 'episode-9',
    images: {poster: '/api/images/poster', backdrop: '/api/images/backdrop', thumb: '/api/images/thumb'},
    labels: [],
    sortTitle: 'Castle, The',
    state: {favorite: true, progressSeconds: 1440, rating: 0, watched: false, watchlisted: true},
    tags: [],
    title: 'The Castle',
    type: 'episode',
    durationSeconds: 2880,
    episodeNumber: 9,
    seasonNumber: 2,
    grandparentTitle: 'Fargo',
    ...overrides,
  } as MediaItem;
}

describe('Prototype 4 live media adapters', () => {
  test('maps server media to the approved presentation contract', () => {
    const value = mediaViewModel(media(), client);

    expect(value).toMatchObject({
      id: 'episode-9',
      kind: 'episode',
      title: 'The Castle',
      subtitle: 'S2 E9',
      duration: '48m',
      genre: 'Crime drama',
      poster: 'https://server.test/api/images/poster?width=780',
      backdrop: 'https://server.test/api/images/backdrop?width=1920',
      progress: 50,
      actions: ['resume', 'watchlist.remove', 'favorite.remove'],
      playbackMediaId: 'episode-9',
    });
  });

  test('uses Continue Watching as the only hero source while preserving authoritative row order', () => {
    const response: HomeResponse = {
      pivots: ['home'],
      rows: [
        {id: 'recent', title: 'Recently Added', type: 'poster', defaultVisible: true, hideable: true, reorderable: true, required: false, items: [media({id: 'movie', title: 'Movie', type: 'movie'})]},
        {id: 'continue', title: 'Continue Watching', type: 'continue', defaultVisible: true, critical: true, hideable: false, reorderable: false, required: true, items: [media()]},
        {id: 'hidden', title: 'Hidden', type: 'poster', defaultVisible: false, hideable: true, reorderable: true, required: false, items: [media()]},
      ],
    };

    const value = homeViewModel(response, client);

    expect(value.rows.map(row => row.id)).toEqual(['recent', 'continue']);
    expect(value.initialHero).toMatchObject({id: 'episode-9', title: 'Fargo', subtitle: 'The Castle'});
    expect(value.continueWatchingRow?.shape).toBe('poster');
  });

  test('does not invent a hero when Continue Watching is absent', () => {
    const response: HomeResponse = {
      pivots: [],
      rows: [{id: 'recent', title: 'Recently Added', type: 'poster', defaultVisible: true, hideable: true, reorderable: true, required: false, items: [media()]}],
    };

    expect(homeViewModel(response, client).initialHero).toBeUndefined();
  });

  test('applies profile-scoped Home order and visibility without hiding required rows', () => {
    const response: HomeResponse = {
      pivots: [],
      rows: [
        {id: 'continue', title: 'Continue Watching', type: 'continue', defaultVisible: true, hideable: false, reorderable: false, required: true, items: [media()]},
        {id: 'recent', title: 'Recently Added', type: 'poster', defaultVisible: true, hideable: true, reorderable: true, required: false, items: [media({id: 'recent-item'})]},
        {id: 'suggested', title: 'Suggested', type: 'poster', defaultVisible: false, hideable: true, reorderable: true, required: false, items: [media({id: 'suggested-item'})]},
      ],
    };
    const value = homeViewModel(response, client, {rowOrder: ['suggested', 'continue', 'recent'], hiddenRowIds: ['continue', 'recent']});
    expect(value.rows.map(row => row.id)).toEqual(['suggested', 'continue']);
    expect(value.continueWatchingRow?.id).toBe('continue');
  });

  test('retains empty advertised rows so their positions can be reserved while they resolve', () => {
    const response: HomeResponse = {
      pivots: [],
      rows: [
        {id: 'continue', title: 'Continue Watching', type: 'continue', defaultVisible: true, hideable: false, reorderable: false, required: true, items: []},
        {id: 'recent', title: 'Recently Added', type: 'poster', defaultVisible: true, hideable: true, reorderable: true, required: false, items: [media()]},
      ],
    };
    const value = homeViewModel(response, client);
    expect(value.rows.map(row => row.id)).toEqual(['continue', 'recent']);
    expect(value.rows[0]?.items).toEqual([]);
    expect(value.initialHero).toBeUndefined();
  });

  test('only exposes Home pagination when the server supplies an opaque cursor', () => {
    const rows = (nextCursor?: string): HomeResponse => ({
      pivots: [],
      rows: [{id: 'recent', title: 'Recently Added', type: 'poster', defaultVisible: true, hideable: true, reorderable: true, required: false, hasMore: true, nextCursor, items: [media()]}],
    });
    expect(homeViewModel(rows(), client).rows[0]?.hasMore).toBe(false);
    expect(homeViewModel(rows('page-two'), client).rows[0]).toMatchObject({hasMore: true, nextCursor: 'page-two'});
  });

  test('retains missing artwork as an honest empty source for existing fallback UI', () => {
    const value = mediaViewModel(media({images: {poster: '', backdrop: '', thumb: ''}}), client);
    expect(value.poster).toBe('');
    expect(value.backdrop).toBe('');
  });

  test('uses another server artwork role when a dedicated backdrop is absent', () => {
    const value = mediaViewModel(media({images: {poster: '/api/images/poster', backdrop: '', thumb: ''}}), client);

    expect(value.backdrop).toBe('https://server.test/api/images/poster?width=1920');
  });

  test('maps paginated production cards without a Prototype fixture cast', () => {
    const card: MediaCard = {
      actions: ['play'],
      artwork: {poster: '/poster', backdrop: '/landscape', thumb: '/thumb'},
      availability: {status: 'available', fileCount: 1, missingFileCount: 0},
      durationSeconds: 2700,
      entityKind: 'episode',
      id: 'episode-250',
      libraryId: 'tv',
      summary: 'A paginated episode summary.',
      title: 'The Long Way Home',
      userState: {favorite: false, progressSeconds: 0, watched: false, watchlisted: false},
    };

    expect(mediaCardViewModel(card, client)).toMatchObject({
      id: 'episode-250',
      kind: 'episode',
      summary: 'A paginated episode summary.',
      poster: 'https://server.test/poster?width=780',
      backdrop: 'https://server.test/landscape?width=1920',
      playbackMediaId: 'episode-250',
    });
  });

  test('formats durations without fixture-specific strings', () => {
    expect(formatDuration(47 * 60)).toBe('47m');
    expect(formatDuration((2 * 60 + 11) * 60)).toBe('2h 11m');
    expect(formatDuration(undefined)).toBeUndefined();
  });
});
