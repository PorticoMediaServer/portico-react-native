import {
  isTVPrimaryRoute,
  tvNavigationFocusScope,
  tvRouteIdentity,
  tvRouteShowsRail,
  tvTabNavigatorPolicy,
} from './tvNavigationPolicy';

describe('tvRouteIdentity', () => {
  it('uses stable detail selection ids without accepting arbitrary params', () => {
    expect(tvRouteIdentity('Detail', {
      bearerToken: 'secret',
      episodeId: 'episode-2',
      mediaId: 'show-1',
      seasonId: 'season-1',
      title: 'private title',
    })).toEqual({name: 'Detail', semanticId: 'show-1/season-1/episode-2'});
  });

  it('distinguishes player contexts using stable ids only', () => {
    expect(tvRouteIdentity('Player', {
      localDownloadId: 'download-1',
      localSourceURL: 'file:///private/path',
      mediaId: 'media-1',
    })).toEqual({name: 'Player', semanticId: 'download/media-1/download-1'});
    expect(tvRouteIdentity('Player', {live: true, mediaId: 'channel-1'}))
      .toEqual({name: 'Player', semanticId: 'live/channel-1'});
  });

  it('uses library and pivot identity for route-local focus memory', () => {
    expect(tvRouteIdentity('Library', {libraryId: 'music', pivot: 'albums'}))
      .toEqual({name: 'Library', semanticId: 'music/albums'});
  });
});

test('TV focus scopes change with the verified viewer fence', () => {
  const route = {mediaId: 'media-1'};
  expect(tvNavigationFocusScope({profileId: 'one'}, 'Detail', route))
    .not.toBe(tvNavigationFocusScope({profileId: 'two'}, 'Detail', route));
});

test('television primary routes omit mobile-only Downloads', () => {
  expect(['Home', 'Library', 'Channels', 'Saved'].every(isTVPrimaryRoute)).toBe(true);
  expect(isTVPrimaryRoute('Downloads')).toBe(false);
  expect(tvTabNavigatorPolicy.initialRouteName).toBe('Home');
  expect(tvTabNavigatorPolicy.backBehavior).toBe('none');
});

test('the persistent rail is hidden only for full player presentation', () => {
  expect(tvRouteShowsRail('Home')).toBe(true);
  expect(tvRouteShowsRail('Detail')).toBe(true);
  expect(tvRouteShowsRail('Player')).toBe(false);
});
