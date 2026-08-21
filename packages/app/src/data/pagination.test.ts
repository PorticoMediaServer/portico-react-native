import {cursorPageState, mergeUniqueById} from './pagination';

describe('cursor pagination', () => {
  it('deduplicates stable IDs without changing the first-seen order', () => {
    expect(mergeUniqueById(
      [{id: 'one', title: 'First'}, {id: 'two', title: 'Second'}],
      [{id: 'two', title: 'Changed upstream'}, {id: 'three', title: 'Third'}],
    )).toEqual([
      {id: 'one', title: 'First'},
      {id: 'two', title: 'Second'},
      {id: 'three', title: 'Third'},
    ]);
  });

  it('never advertises another page without an opaque continuation', () => {
    expect(cursorPageState({hasMore: true, nextCursor: null})).toEqual({hasMore: false, nextCursor: undefined});
    expect(cursorPageState({hasMore: true, nextCursor: 'opaque'})).toEqual({hasMore: true, nextCursor: 'opaque'});
  });
});
