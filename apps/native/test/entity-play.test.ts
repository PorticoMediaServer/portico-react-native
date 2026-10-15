/**
 * PERF-S06 page wiring (Apple): the album, artist and disc pages send one v1 container selector
 * for Play, Shuffle and play-from-a-track — never a client-shuffled page — and the playlist,
 * collection and saved view pages do the same with theirs; a sorted or filtered list sends its
 * query.
 * Popular tracks (a top-5 list) play their own five as an item list. The player turns a
 * container into exactly one `playSelector` request (`player/usePlayer.ts`: container →
 * `v1.playSelector`, anchored at the pressed entry for Play, `shuffle: true` for Shuffle).
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';

const src = (p: string) => readFileSync(new URL('../src/' + p, import.meta.url), 'utf8');

test('the entity page plays and shuffles through the container helper', () => {
  const entity = src('screens/Entity.tsx');
  assert.match(entity, /player\.playSequence\(playable, 0, 0, sequenceContainer\(kind, entity\?\.id\)\);/);
  assert.match(entity, /player\.playSequence\(queue\.filter\(e => e\.playback\), 0, 0, sequenceContainer\(kind, entity\?\.id, \{shuffle: true\}\)\);/);
});

test('the entity page never shuffles the loaded entries on the client', () => {
  const entity = src('screens/Entity.tsx');
  assert.doesNotMatch(entity, /shuffled\(/);
  assert.doesNotMatch(entity, /Math\.random/);
});

test('popular tracks play their own five as an item list, not the artist container', () => {
  const entity = src('screens/Entity.tsx');
  assert.match(entity, /player\.playSequence\(playable, 0, 0\);/);
});

test('a sorted or filtered song list plays the whole list from the server, from the song pressed', () => {
  const entity = src('screens/Entity.tsx');
  assert.match(entity, /player\.playSequence\(\[pressed\], 0, 0, groupSequence\(group\)\)/);
});

test('saved pages play and shuffle on the server: the playlist, the saved view or collection by its id, or the sorted list', () => {
  const pages = src('screens/title/SavedPages.tsx');
  assert.match(pages, /groupSequence\(group, \{shuffle\}\) \?\? sequenceContainer\('playlist', playlistId, \{shuffle\}\)/);
  assert.match(pages, /groupSequence\(group, \{shuffle\}\) \?\? savedSequence\(resourceId, \{shuffle\}\)/);
  assert.doesNotMatch(pages, /shuffled\(|Math\.random|gatherView/);
});

test('a playlist row plays its own occurrence, and a removal offers the server\'s Undo', () => {
  const pages = src('screens/title/SavedPages.tsx');
  assert.match(pages, /occurrenceSequence\(playlistId, occurrence\.id\)/);
  assert.match(pages, /mutate\(\{action: 'restore', undoToken\}\)/);
});
