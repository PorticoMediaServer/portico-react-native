import {mediaOccurrenceFocusId} from './sharedComponents';
import {pinnedTVLibraryDestinations} from './tvNavigationFrame';

test('keeps pinned library shortcuts while exposing every larger catalog', () => {
  const libraries = ['one', 'two', 'three', 'four', 'five', 'six'];
  expect(pinnedTVLibraryDestinations(libraries)).toEqual({
    pinned: ['one', 'two', 'three', 'four'],
    showAll: true,
  });
});

test('focus identity distinguishes duplicate media occurrences by section row and index', () => {
  expect(mediaOccurrenceFocusId('row:Continue', 0, 'same')).not.toBe(
    mediaOccurrenceFocusId('row:Continue', 1, 'same'),
  );
  expect(mediaOccurrenceFocusId('row:Continue', 0, 'same')).not.toBe(
    mediaOccurrenceFocusId('row:Recommended', 0, 'same'),
  );
});
