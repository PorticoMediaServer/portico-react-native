import {
  porticoRouteForMobileScreen,
  porticoRouteFromMobileState,
} from './mobileNavigation';

describe('React Navigation route state translation', () => {
  it('preserves a deep-linked library and pivot', () => {
    expect(porticoRouteForMobileScreen('Library', {
      libraryId: 'library-movies',
      pivot: 'Collections',
    })).toEqual({
      name: 'library',
      libraryId: 'library-movies',
      pivot: 'Collections',
    });
  });

  it.each([
    ['Channels', 'Library Channels', 'channels'],
    ['Saved', 'Collections', 'saved'],
  ])('preserves the replace-state %s tab', (screen, tab, name) => {
    expect(porticoRouteForMobileScreen(screen, {tab})).toEqual({name, tab});
  });

  it('rejects malformed persisted and external search query parameters', () => {
    expect(porticoRouteForMobileScreen('Search', {query: {legacy: 'rookie'}})).toEqual({
      name: 'search',
      query: undefined,
    });
    expect(porticoRouteForMobileScreen('Search', {query: 'rookie'})).toEqual({
      name: 'search',
      query: 'rookie',
    });
  });

  it('derives only the active nested route and does not model a second stack', () => {
    expect(porticoRouteFromMobileState({
      stale: false,
      type: 'stack',
      key: 'root',
      routeNames: ['Product'],
      index: 0,
      routes: [{
        key: 'product',
        name: 'Product',
        state: {
          stale: false,
          type: 'tab',
          key: 'tabs',
          routeNames: ['Home', 'Library'],
          index: 1,
          routes: [
            {key: 'home', name: 'Home'},
            {key: 'library', name: 'Library', params: {libraryId: 'library-tv', pivot: 'Episodes'}},
          ],
        },
      }],
    })).toEqual({name: 'library', libraryId: 'library-tv', pivot: 'Episodes'});
  });
});
