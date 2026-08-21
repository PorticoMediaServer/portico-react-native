import {
  activeTVSectionStackKey,
  porticoRouteFromTVState,
  tvSecondaryRouteShouldReplace,
  tvTargetForPorticoRoute,
  targetActiveTVSectionAction,
  type TVNavigationState,
} from './tvNavigationState';

describe('tvOS React Navigation policy', () => {
  it('targets the exact active nested section stack below the root phase and tab router', () => {
    const state = {
      index: 0,
      key: 'root',
      routeNames: ['Product'],
      routes: [{
        key: 'product',
        name: 'Product',
        state: {
          index: 1,
          key: 'tabs',
          routeNames: ['Home', 'Library'],
          routes: [
            {key: 'home-tab', name: 'Home', state: {index: 0, key: 'home-stack', routeNames: ['HomeRoot'], routes: [{key: 'home', name: 'HomeRoot'}], stale: false, type: 'stack'}},
            {key: 'library-tab', name: 'Library', state: {index: 0, key: 'library-stack', routeNames: ['LibraryRoot'], routes: [{key: 'library', name: 'LibraryRoot'}], stale: false, type: 'stack'}},
          ],
          stale: false,
          type: 'tab',
        },
      }],
      stale: false,
      type: 'stack',
    } as unknown as TVNavigationState;
    expect(activeTVSectionStackKey(state)).toBe('library-stack');
    expect(targetActiveTVSectionAction(state, {type: 'PUSH', payload: {name: 'Detail'}})).toEqual({
      type: 'PUSH',
      payload: {name: 'Detail'},
      target: 'library-stack',
    });
    expect(porticoRouteFromTVState(state)).toEqual({name: 'library', libraryId: undefined, pivot: undefined});
  });

  it('does not expose Downloads as a television target', () => {
    expect(tvTargetForPorticoRoute({name: 'downloads'})).toBeUndefined();
  });

  it('replaces singleton and repeated semantic destinations', () => {
    expect(tvSecondaryRouteShouldReplace(
      {name: 'search', query: 'first'},
      {name: 'search', query: 'second'},
    )).toBe(true);
    expect(tvSecondaryRouteShouldReplace(
      {name: 'settings', section: 'playback'},
      {name: 'settings', section: 'account'},
    )).toBe(true);
    expect(tvSecondaryRouteShouldReplace(
      {name: 'person', personId: 'person-1'},
      {name: 'person', personId: 'person-1'},
    )).toBe(true);
    expect(tvSecondaryRouteShouldReplace(
      {name: 'detail', mediaId: 'show-1', seasonId: 'season-1', episodeId: 'episode-1'},
      {name: 'detail', mediaId: 'show-1', seasonId: 'season-2', episodeId: 'episode-9'},
    )).toBe(true);
    expect(tvSecondaryRouteShouldReplace(
      {name: 'player', mediaId: 'movie-1'},
      {name: 'player', mediaId: 'movie-1'},
    )).toBe(true);
  });

  it('preserves genuine history between different media and people', () => {
    expect(tvSecondaryRouteShouldReplace(
      {name: 'detail', mediaId: 'movie-1'},
      {name: 'detail', mediaId: 'movie-2'},
    )).toBe(false);
    expect(tvSecondaryRouteShouldReplace(
      {name: 'person', personId: 'person-1'},
      {name: 'person', personId: 'person-2'},
    )).toBe(false);
  });
});
