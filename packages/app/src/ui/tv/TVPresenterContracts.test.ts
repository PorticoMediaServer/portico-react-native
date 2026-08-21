import {createTVDetailFocusContainers} from './TVDetailPresenter';
import {tvSettingsInitialSection} from './TVSettingsPresenter';
import {tvNowPlayingIsEligible, tvPlayerHostPresentation} from './playerHostPolicy';

test('detail focus containers preserve semantic vertical order while skipping absent sections', () => {
  const containers = createTVDetailFocusContainers({cast: false, episodes: true, extras: true, facts: true, hero: true, recommendations: false});
  expect(containers.map(container => container.id)).toEqual(['detail:hero', 'detail:episodes', 'detail:extras', 'detail:facts']);
  expect(containers[1]?.neighbours).toEqual({up: 'detail:hero', down: 'detail:extras'});
});

test('TV player host retains background audio and exposes Now Playing only on eligible product routes', () => {
  const audio = {active: true, isPlaying: true, mediaFamily: 'audio' as const, mediaId: 'album', platform: 'tv' as const, presentation: 'background' as const, title: 'Album'};
  expect(tvPlayerHostPresentation('home', audio)).toBe('background-audio');
  expect(tvPlayerHostPresentation('player', audio)).toBe('fullscreen');
  expect(tvNowPlayingIsEligible({accountHubOpen: false, phase: 'Product', routeName: 'home'})).toBe(true);
  expect(tvNowPlayingIsEligible({accountHubOpen: false, phase: 'Profile', routeName: 'home'})).toBe(false);
  expect(tvNowPlayingIsEligible({accountHubOpen: true, phase: 'Product', routeName: 'home'})).toBe(false);
  expect(tvNowPlayingIsEligible({accountHubOpen: false, phase: 'Product', routeName: 'player'})).toBe(false);
});

test('TV settings route selects deterministic native entry sections', () => {
  expect(tvSettingsInitialSection('profile')).toBe('profile');
  expect(tvSettingsInitialSection('accessibility')).toBe('accessibility');
  expect(tvSettingsInitialSection('unknown')).toBe('playback');
});
