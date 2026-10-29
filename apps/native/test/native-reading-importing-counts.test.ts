import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';

const source = (path: string) => readFileSync(new URL(`../src-next/${path}`, import.meta.url), 'utf8');

test('P2-59: an importing Reading library has no A–Z rail without anchors, never an empty one', () => {
  assert.match(source('screens/library/LibraryScreen.tsx'), /const alphabet = jumpLetters\.length > 0 &&/);
  assert.match(source('screens/read/ReadingBooks.tsx'), /const alphabet = !!page\?\.positionIndex && Object\.keys\(page\.positionIndex\)\.length > 0 &&/);
});

test('P2-59: an importing Reading library counts nothing: toolbar, header, switcher and filters', () => {
  const library = source('screens/library/LibraryScreen.tsx');
  assert.match(library, /const count = state\.total === undefined \|\| countsNothing \? undefined/);
  assert.match(library, /\(count \|\| countsNothing\) && theme\.platform === 'phone' && <LibraryResultCount/, 'the phone view toggle stays without a count');
  assert.match(library, /library\.id === state\.library\.id && importingReading\(state\) !== undefined \? undefined/);
  const books = source('screens/read/ReadingBooks.tsx');
  assert.match(books, /const resultCount = total === undefined \|\| importing \? ''/);
  assert.match(source('screens/read/ReadingLibrary.tsx'), /!capability\?\.data\?\.importing \? summary\?\.value\?\.counts/);
  const filters = source('screens/library/LibraryFilters.tsx');
  assert.match(filters, /const results = result && !importing &&/);
  assert.match(filters, /importing \? defaultI18n\.t\('next\.controls\.done'\)/, 'Show reads Done, never a count');
  assert.match(filters, /const showing = live && !importing &&/);
});
