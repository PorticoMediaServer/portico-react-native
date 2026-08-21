import type {
  LibraryBrowseCapabilities,
  MediaCard,
  MediaItem,
  PorticoClient,
} from '@porticomediaserver/client-core';
import {
  combineBrowseExpressions,
  facetPredicate,
  loadLibraryCatalog,
  loadLibraryPage,
  mergeLibraryPages,
  supportsAlphabetSeek,
  type ConnectedLibrary,
  type LibraryPage,
} from './library';

describe('canonical Apple browse controls', () => {
  test('combines independently drafted controls into the server all-expression', () => {
    expect(combineBrowseExpressions([
      {field: 'playState', operator: 'equals', value: 'unplayed'},
      {field: 'genre', operator: 'equals', value: 'Drama'},
    ])).toEqual({all: [
      {field: 'playState', operator: 'equals', value: 'unplayed'},
      {field: 'genre', operator: 'equals', value: 'Drama'},
    ]});
  });

  test('advertises alphabet seek only for ascending title-family sorts', () => {
    const library = libraryFixture();
    const tab = library.tabs.find(candidate => candidate.browseSupported)!;
    expect(supportsAlphabetSeek(library, tab, 'Title', 'asc')).toBe(true);
    expect(supportsAlphabetSeek(library, tab, 'Title', 'desc')).toBe(false);
  });
});

const movieCapabilities: LibraryBrowseCapabilities = {
  actions: ['browse'],
  fields: [
    {
      id: 'playState',
      label: 'Play state',
      operators: ['equals'],
      valueType: 'enum',
      allowedValues: ['unplayed', 'played'],
      complexity: 'quick',
      controlHint: 'select',
      cost: 'indexed',
    },
  ],
  library: {id: 'lib-movies', kind: 'movies', name: 'Feature Films'},
  pivots: [
    {
      browseSupported: true,
      defaultSort: [{field: 'title', direction: 'asc'}],
      defaultView: 'grid',
      endpointTemplate: '/api/libraries/{libraryId}/browse',
      entityKinds: ['movie'],
      id: 'movies',
      label: 'Movies',
      presentationFields: [],
      supportedViews: ['grid', 'list'],
    },
  ],
  presentationFields: [],
  queryLimits: {
    cursorTtlSeconds: 300,
    defaultLimit: 50,
    maximumBytes: 16_384,
    maximumClauses: 10,
    maximumDepth: 4,
    maximumLimit: 200,
  },
  apiVersion: 'v1',
  sorts: [
    {
      id: 'title',
      label: 'Title',
      defaultDirection: 'asc',
      directions: ['asc', 'desc'],
      expensive: false,
    },
  ],
};

describe('live library adapters', () => {
  it('builds the chooser and tabs from server contracts', async () => {
    const client = {
      libraries: jest
        .fn()
        .mockResolvedValue({
          items: [
            {
              id: 'lib-movies',
              name: 'Feature Films',
              count: 12,
              paths: [],
              settings: {},
              sortOrder: 1,
              type: 'movie',
            },
          ],
          total: 1,
        }),
      productContract: jest
        .fn()
        .mockResolvedValue({
          libraryKinds: [
            {id: 'movies', description: 'The server description.'},
          ],
        }),
      libraryBrowseCapabilities: jest.fn().mockResolvedValue(movieCapabilities),
    } as unknown as PorticoClient;

    const catalog = await loadLibraryCatalog(client, 'Living Room Server');

    expect(catalog.serverName).toBe('Living Room Server');
    expect(catalog.libraries[0]).toMatchObject({
      id: 'lib-movies',
      name: 'Feature Films',
      description: 'The server description.',
    });
    expect(catalog.libraries[0]?.tabs.map(tab => tab.label)).toEqual([
      'Movies',
    ]);
  });

  it('sends the selected server sort and honest unwatched filter to canonical browse', async () => {
    const card: MediaCard = {
      actions: ['play'],
      artwork: {poster: '/poster', backdrop: '/backdrop', thumb: ''},
      availability: {fileCount: 1, missingFileCount: 0, status: 'available'},
      durationSeconds: 7200,
      entityKind: 'movie',
      fields: {genre: 'Drama', contentRating: 'PG-13'},
      id: 'movie-1',
      libraryId: 'lib-movies',
      title: 'Arrival',
      userState: {
        favorite: false,
        progressSeconds: 0,
        watched: false,
        watchlisted: false,
      },
      year: 2016,
    };
    const browseLibrary = jest.fn().mockResolvedValue({
      applied: {
        pivot: 'movies',
        presentationFields: [],
        sort: [{field: 'title', direction: 'asc'}],
      },
      items: [card],
      pageInfo: {hasMore: false, total: 1},
    });
    const client = {
      browseLibrary,
      imageResourceUrl: (path: string) => `https://server.test${path}`,
    } as unknown as PorticoClient;
    const library: ConnectedLibrary = {
      id: 'lib-movies',
      name: 'Feature Films',
      description: '',
      kind: 'movies',
      count: 1,
      tabs: movieCapabilities.pivots,
      fields: movieCapabilities.fields,
      sorts: movieCapabilities.sorts,
    };

    const page = await loadLibraryPage(client, library, library.tabs[0]!, {
      filtered: true,
      sortLabel: 'Title',
    });

    expect(browseLibrary).toHaveBeenCalledWith(
      'lib-movies',
      expect.objectContaining({
        pivot: 'movies',
        query: {field: 'playState', operator: 'equals', value: 'unplayed'},
        sort: [{field: 'title', direction: 'asc'}],
      }),
      {signal: undefined},
    );
    expect(page).toMatchObject({presentation: 'media', total: 1});
    expect(page.items[0]).toMatchObject({
      id: 'movie-1',
      title: 'Arrival',
      poster: 'https://server.test/poster',
      genre: 'Drama',
    });
  });

  it('preserves server-defined Discover shelves and their headings', async () => {
    const discoverTab: ConnectedLibrary['tabs'][number] = {
      ...movieCapabilities.pivots[0]!,
      browseSupported: false,
      defaultView: 'shelves',
      id: 'discover',
      label: 'Discover',
      supportedViews: ['shelves'],
    };
    const library: ConnectedLibrary = {
      id: 'lib-movies',
      name: 'Feature Films',
      description: '',
      kind: 'movies',
      count: 2,
      tabs: [discoverTab],
      fields: movieCapabilities.fields,
      sorts: movieCapabilities.sorts,
    };
    const media = (id: string, title: string): MediaItem =>
      ({
        actions: ['play'],
        addedAt: '2026-07-01T00:00:00Z',
        genres: ['Drama'],
        id,
        images: {
          poster: `/${id}/poster`,
          backdrop: `/${id}/backdrop`,
          thumb: '',
        },
        labels: [],
        metadataEtag: `fixture-${id}-revision-1`,
        metadataRevision: 1,
        sortTitle: title,
        state: {
          favorite: false,
          progressSeconds: 0,
          rating: 0,
          watched: false,
          watchlisted: false,
        },
        tags: [],
        title,
        type: 'movie',
      }) as MediaItem;
    const libraryDiscover = jest.fn().mockResolvedValue({
      generatedAt: '2026-07-12T12:00:00Z',
      items: [],
      rows: [
        {
          id: 'library-continue',
          title: 'Continue Watching',
          type: 'poster',
          items: [media('movie-1', 'Arrival')],
        },
        {
          id: 'library-recent',
          title: 'Recently Added',
          type: 'poster',
          items: [media('movie-2', 'Moonlight')],
        },
      ],
      total: 2,
    });
    const client = {
      libraryDiscover,
      imageResourceUrl: (path: string) => `https://server.test${path}`,
    } as unknown as PorticoClient;

    const page = await loadLibraryPage(client, library, discoverTab, {
      filtered: false,
      sortLabel: 'Title',
    });

    expect(libraryDiscover).toHaveBeenCalledWith(
      'lib-movies',
      {limit: 200},
      {signal: undefined},
    );
    expect(
      page.rows.map(row => ({
        id: row.id,
        title: row.title,
        items: row.items.map(item => item.id),
      })),
    ).toEqual([
      {id: 'library-continue', title: 'Continue Watching', items: ['movie-1']},
      {id: 'library-recent', title: 'Recently Added', items: ['movie-2']},
    ]);
    expect(page.items.map(item => item.id)).toEqual(['movie-1', 'movie-2']);
  });

  it('loads category facets and translates their filter tokens into canonical browse expressions', async () => {
    const categoriesTab: ConnectedLibrary['tabs'][number] = {
      ...movieCapabilities.pivots[0]!,
      browseSupported: false,
      defaultView: 'facets',
      id: 'categories',
      label: 'Categories',
      entityKinds: ['category'],
      supportedViews: ['facets'],
    };
    const library: ConnectedLibrary = {
      ...libraryFixture(),
      tabs: [movieCapabilities.pivots[0]!, categoriesTab],
    };
    const client = {
      libraryCategories: jest.fn().mockResolvedValue({
        items: [
          {
            id: 'drama',
            name: 'Drama',
            group: 'genre',
            filter: 'genre:Drama',
            count: 8,
          },
          {
            id: 'year',
            name: '2026',
            group: 'year',
            filter: 'year:2026',
            count: 3,
          },
        ],
      }),
    } as unknown as PorticoClient;

    const facets = await loadLibraryPage(client, library, categoriesTab, {
      filtered: false,
      sortLabel: 'Title',
    });
    expect(facets.presentation).toBe('facets');
    expect(facets.facets.map(group => group.title)).toEqual([
      'Genres',
      'Years',
    ]);
    expect(facetPredicate('genre:Drama', 'genre')).toEqual({
      field: 'genre',
      operator: 'contains',
      value: 'Drama',
    });
    expect(facetPredicate('year:2026', 'year')).toEqual({
      field: 'year',
      operator: 'equals',
      value: 2026,
    });
  });

  it('drills a selected category into the library browse pivot', async () => {
    const categoriesTab: ConnectedLibrary['tabs'][number] = {
      ...movieCapabilities.pivots[0]!,
      browseSupported: false,
      defaultView: 'facets',
      id: 'categories',
      label: 'Categories',
      entityKinds: ['category'],
      supportedViews: ['facets'],
    };
    const library: ConnectedLibrary = {
      ...libraryFixture(),
      tabs: [movieCapabilities.pivots[0]!, categoriesTab],
    };
    const browseLibrary = jest
      .fn()
      .mockResolvedValue({items: [], pageInfo: {hasMore: false, total: 0}});
    const client = {browseLibrary} as unknown as PorticoClient;
    const query = {
      field: 'genre',
      operator: 'contains',
      value: 'Drama',
    } as const;

    const results = await loadLibraryPage(client, library, categoriesTab, {
      filtered: false,
      sortLabel: 'Title',
      facetQuery: query,
    });
    expect(results.presentation).toBe('media');
    expect(browseLibrary).toHaveBeenCalledWith(
      'lib-movies',
      expect.objectContaining({pivot: 'movies', query}),
      {signal: undefined},
    );
  });

  it('loads library-scoped resources and their real media entries', async () => {
    const collectionsTab: ConnectedLibrary['tabs'][number] = {
      ...movieCapabilities.pivots[0]!,
      browseSupported: false,
      defaultView: 'grid',
      id: 'collections',
      label: 'Collections',
      entityKinds: ['collection'],
      supportedViews: ['grid'],
    };
    const library: ConnectedLibrary = {
      ...libraryFixture(),
      tabs: [collectionsTab],
    };
    const client = {
      collections: jest
        .fn()
        .mockResolvedValue({
          items: [{id: 'collection-1', title: 'Noir', itemCount: 2}],
          pageInfo: {hasMore: false, total: 1},
        }),
      collectionItems: jest
        .fn()
        .mockResolvedValue({items: [], pageInfo: {hasMore: false, total: 0}}),
    } as unknown as PorticoClient;

    const resources = await loadLibraryPage(client, library, collectionsTab, {
      filtered: false,
      sortLabel: 'Title',
    });
    expect(resources).toMatchObject({
      presentation: 'resources',
      resources: [
        {id: 'collection-1', title: 'Noir', itemCount: 2, kind: 'collection'},
      ],
    });
    await loadLibraryPage(client, library, collectionsTab, {
      filtered: false,
      sortLabel: 'Title',
      resourceId: 'collection-1',
    });
    expect(client.collectionItems).toHaveBeenCalledWith(
      'collection-1',
      {cursor: undefined, limit: 50},
      {signal: undefined},
    );
  });

  it('loads the canonical DVR schedule as a timeline', async () => {
    const scheduleTab: ConnectedLibrary['tabs'][number] = {
      ...movieCapabilities.pivots[0]!,
      browseSupported: false,
      defaultView: 'timeline',
      id: 'schedule',
      label: 'Schedule',
      entityKinds: ['recording'],
      supportedViews: ['timeline'],
    };
    const library: ConnectedLibrary = {
      ...libraryFixture(),
      kind: 'recorded-tv',
      tabs: [scheduleTab],
    };
    const client = {
      dvrSchedule: jest.fn().mockResolvedValue({
        items: [
          {
            id: 'recording-1',
            title: 'Evening News',
            startsAt: '2026-07-12T22:00:00Z',
            endsAt: '2026-07-12T23:00:00Z',
            status: 'scheduled',
          },
        ],
        pageInfo: {hasMore: false, total: 1},
      }),
    } as unknown as PorticoClient;
    const schedule = await loadLibraryPage(client, library, scheduleTab, {
      filtered: false,
      sortLabel: 'Title',
    });
    expect(schedule.presentation).toBe('schedule');
    expect(schedule.schedule[0]).toMatchObject({
      id: 'recording-1',
      title: 'Evening News',
      status: 'scheduled',
      statusMessageId: 'media.kind.recording',
    });
  });

  it('merges cursor pages without duplicating media or resources', () => {
    const page = (
      id: string,
      title: string,
      hasMore: boolean,
      nextCursor?: string,
    ): LibraryPage => ({
      facets: [],
      hasMore,
      items: [
        {id, title, kind: 'movie', poster: '', backdrop: '', actions: []},
      ],
      nextCursor,
      presentation: 'media',
      resources: [],
      rows: [],
      schedule: [],
      total: 3,
    });
    const merged = mergeLibraryPages([
      page('one', 'One', true, 'page-two'),
      {
        ...page('two', 'Two', false),
        items: [
          page('one', 'Duplicate', false).items[0]!,
          page('two', 'Two', false).items[0]!,
        ],
      },
    ]);
    expect(merged?.items.map(item => item.id)).toEqual(['one', 'two']);
    expect(merged).toMatchObject({
      hasMore: false,
      nextCursor: undefined,
      total: 3,
    });
  });
});

function libraryFixture(): ConnectedLibrary {
  return {
    id: 'lib-movies',
    name: 'Feature Films',
    description: '',
    kind: 'movies',
    count: 1,
    tabs: movieCapabilities.pivots,
    fields: movieCapabilities.fields,
    sorts: movieCapabilities.sorts,
  };
}
