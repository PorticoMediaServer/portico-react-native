/**
 * PERF-S06 page wiring (Apple): the album, artist and disc pages send one v1 container selector
 * for Play, Shuffle and play-from-a-track — never a client-shuffled page — and the playlist and
 * collection pages do the same with their containers (a saved view keeps the loaded entries).
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

test('saved pages shuffle on the server when a container names the set', () => {
  const pages = src('screens/title/SavedPages.tsx');
  assert.match(pages, /const resolved = sequenceContainer\(container\?\.kind, container\?\.id, \{shuffle\}\);/);
  assert.match(pages, /player\.playSequence\(shuffle && !resolved \? shuffled\(playable\) : playable, 0, 0, resolved\);/);
});
