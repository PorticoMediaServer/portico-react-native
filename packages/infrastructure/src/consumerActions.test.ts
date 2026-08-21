import {consumerMediaActions} from './consumerActions';

test('consumer actions fail closed for server administration and unknown actions', () => {
  expect(consumerMediaActions([
    'play', 'download', 'metadata.edit', 'metadata.refresh', 'media.delete',
    'library.scan', 'server.settings', 'future.unclassified', 'watchlist.add', 'dvr.play',
  ], 'ios')).toEqual(['play', 'download', 'watchlist.add', 'dvr.play']);
});

test('tvOS never receives download even when the server advertises it', () => {
  expect(consumerMediaActions(['play', 'download', 'favorite.add'], 'tvos'))
    .toEqual(['play', 'favorite.add']);
});

test('consumer detail capabilities preserve every standard server-published action', () => {
  const actions = [
    'play.from-beginning',
    'feedback.report-problem',
    'feedback.request-higher-quality',
    'watch-with-friends.start',
  ];

  expect(consumerMediaActions(actions, 'ios')).toEqual(actions);
  expect(consumerMediaActions(actions, 'tvos')).toEqual(actions);
});
