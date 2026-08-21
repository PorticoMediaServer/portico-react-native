import {
  promoteQueueItem,
  promoteWatchGroupItemAfterCurrent,
  queueOccurrenceKey,
  watchGroupUpcomingItems,
} from './queueNavigation';

describe('player queue navigation', () => {
  const queue = [{id: 'one'}, {id: 'two'}, {id: 'three'}];

  test('promotes any selected upcoming item without dropping the others', () => {
    expect(promoteQueueItem(queue, 2)).toEqual(['three', 'one', 'two']);
    expect(promoteQueueItem(queue, 0)).toEqual(['one', 'two', 'three']);
  });

  test('orders Watch With Friends choices from the current title', () => {
    const group = [
      {mediaId: 'one'},
      {mediaId: 'two'},
      {mediaId: 'three'},
    ];
    expect(watchGroupUpcomingItems(group, 'two', 'none')).toEqual([
      {mediaId: 'three'},
    ]);
    expect(watchGroupUpcomingItems(group, 'two', 'all')).toEqual([
      {mediaId: 'three'},
      {mediaId: 'one'},
    ]);
    expect(watchGroupUpcomingItems(group, 'two', 'one')).toEqual([]);
  });

  test('moves the selected group title immediately after the current title', () => {
    const group = [
      {mediaId: 'one'},
      {mediaId: 'two'},
      {mediaId: 'three'},
      {mediaId: 'four'},
    ];
    expect(
      promoteWatchGroupItemAfterCurrent(group, 'two', 'four'),
    ).toEqual(['one', 'two', 'four', 'three']);
  });

  test('gives repeated queue entries occurrence-stable render identities', () => {
    expect([
      queueOccurrenceKey('queue', 0, 'same'),
      queueOccurrenceKey('queue', 1, 'same'),
    ]).toEqual(['queue-0-same', 'queue-1-same']);
  });
});
