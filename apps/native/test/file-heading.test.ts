/** A title is not one file: its Files list names versions, parts and editions, and a single file says none of it. */
import test from 'node:test';
import assert from 'node:assert/strict';
import {fileHeadings} from '../src/screens/title/file-heading.ts';

test('a title that is one file says neither version nor part', () => {
  assert.deepEqual(fileHeadings([{}]), [{}]);
  assert.deepEqual(fileHeadings([]), []);
});

test('several versions of one title are numbered in the order the server lists them, best first', () => {
  assert.deepEqual(fileHeadings([{}, {}, {}]), [{version: 1}, {version: 2}, {version: 3}]);
});

test('an edition is named beside its version', () => {
  assert.deepEqual(fileHeadings([{edition: 'Director’s Cut'}, {}]), [{version: 1, edition: 'Director’s Cut'}, {version: 2}]);
  assert.deepEqual(fileHeadings([{edition: 'Extended'}]), [{edition: 'Extended'}]);
});

test('a title split across files names its parts, and numbers versions within each part', () => {
  assert.deepEqual(fileHeadings([{partIndex: 1}, {partIndex: 2}]), [{part: 1}, {part: 2}]);
  assert.deepEqual(fileHeadings([{partIndex: 1}, {partIndex: 1}, {partIndex: 2}]), [{part: 1, version: 1}, {part: 1, version: 2}, {part: 2}]);
});
