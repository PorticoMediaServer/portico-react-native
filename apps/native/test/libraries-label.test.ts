import test from 'node:test';
import assert from 'node:assert/strict';
import {libraryKindLabel} from '../src/app/libraries.ts';

test('every known kind has a US-English plural label; the unknown stays generic', () => {
  assert.equal(libraryKindLabel('movie'), 'Movies');
  assert.equal(libraryKindLabel('tv'), 'TV Shows');
  assert.equal(libraryKindLabel('anime'), 'Anime');
  assert.equal(libraryKindLabel('music'), 'Music');
  assert.equal(libraryKindLabel('audiobook'), 'Audiobooks');
  assert.equal(libraryKindLabel(''), 'Library');
  assert.equal(libraryKindLabel('m3u'), 'Library', 'never a source-type name');
  assert.equal(libraryKindLabel('Movie'), 'Library', 'case-sensitive');
  assert.equal(libraryKindLabel('favorites'), 'Library', 'US spelling lives in the catalogue, not here');
});
