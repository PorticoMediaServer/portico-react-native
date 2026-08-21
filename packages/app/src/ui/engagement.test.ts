import {parsePorticoLink, porticoLinkIsAvailable} from './engagement';

test.each([
  ['portico://media/movie-1', {destination: 'media-detail', mediaId: 'movie-1'}],
  ['portico://play/movie-1', {destination: 'player', mediaId: 'movie-1'}],
  ['https://app.getportico.tv/media/episode%201', {destination: 'media-detail', mediaId: 'episode 1'}],
  ['portico://notifications', {destination: 'notifications'}],
  ['https://app.getportico.tv/settings/account', {destination: 'settings', section: 'account'}],
])('routes supported Portico links', (url, expected) => {
  expect(parsePorticoLink(url)).toEqual(expected);
});

test('rejects unrelated and malformed links', () => {
  expect(parsePorticoLink('https://example.test/elsewhere')).toBeUndefined();
  expect(parsePorticoLink('https://example.test/media/media-one')).toBeUndefined();
  expect(parsePorticoLink('not a link')).toBeUndefined();
});

test('does not route tvOS into the omitted Downloads destination', () => {
  const downloads = parsePorticoLink('portico://downloads');
  expect(porticoLinkIsAvailable(downloads, 'mobile')).toBe(true);
  expect(porticoLinkIsAvailable(downloads, 'tv')).toBe(false);
});
