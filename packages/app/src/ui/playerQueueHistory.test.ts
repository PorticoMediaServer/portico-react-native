import {PlayerQueueHistory, queueAfterReturningToPrevious} from './playerQueueHistory';

test('previous item is disabled until a completed forward handoff is recorded', () => {
  const history = new PlayerQueueHistory();
  expect(history.canPrevious).toBe(false);
  history.push({mediaId: 'episode-a', title: 'A'});
  expect(history.canPrevious).toBe(true);
  expect(history.peek()).toEqual({mediaId: 'episode-a', title: 'A'});
});

test('previous commits only the expected history head and rebuilds the forward queue', () => {
  const history = new PlayerQueueHistory();
  history.push({mediaId: 'episode-a', title: 'A'});
  expect(history.commitPrevious('wrong')).toBeUndefined();
  expect(history.commitPrevious('episode-a')?.mediaId).toBe('episode-a');
  expect(queueAfterReturningToPrevious('episode-b', ['episode-c', 'episode-b'])).toEqual(['episode-b', 'episode-c']);
});
