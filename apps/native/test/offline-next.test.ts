import test from 'node:test';
import assert from 'node:assert/strict';
import {nextDownloadedEpisode} from '../src/app/offline-next.ts';
import type {OfflineEntry} from '../src/bridge/offline-downloads.ts';

const episode = (itemId: string, season: number | null, number: number | null, o: {show?: string; state?: OfflineEntry['state']; kind?: string} = {}): OfflineEntry => ({
  id: 'd-' + itemId, itemId, title: itemId, subtitle: '', quality: 'original', artworkUrl: '', state: o.state ?? 'ready', error: '', waiting: 'none' as never, held: false,
  bytes: 1, bytesDone: 1, addedAt: 0, kind: o.kind ?? 'episode', onServer: true, changedOnServer: false,
  info: {kind: o.kind ?? 'episode', title: itemId, year: 2020, durationSeconds: 1500, parentId: o.show ?? 'show1', parentTitle: 'Show', groupId: '', groupTitle: '', groupNumber: season, number, artist: '', onServer: true},
});

test('the next downloaded episode of the same show, by season and episode', () => {
  const s1e1 = episode('e1', 1, 1), s1e3 = episode('e3', 1, 3), s2e1 = episode('e21', 2, 1), other = episode('x', 1, 2, {show: 'show2'});
  assert.equal(nextDownloadedEpisode([s2e1, s1e3, other, s1e1], s1e1)?.itemId, 'e3');
  assert.equal(nextDownloadedEpisode([s2e1, s1e3, other, s1e1], s1e3)?.itemId, 'e21');
  assert.equal(nextDownloadedEpisode([s2e1, s1e3, other, s1e1], s2e1), undefined);
});

test('only finished downloads continue; one still arriving or failed is passed over', () => {
  const s1e1 = episode('e1', 1, 1);
  assert.equal(nextDownloadedEpisode([s1e1, episode('e2', 1, 2, {state: 'downloading'}), episode('e3', 1, 3, {state: 'failed'}), episode('e4', 1, 4)], s1e1)?.itemId, 'e4');
});

test('specials are left out unless a special has just ended', () => {
  const special = episode('sp', 0, 1), s1e1 = episode('e1', 1, 1), s1e2 = episode('e2', 1, 2);
  assert.equal(nextDownloadedEpisode([special, s1e1, s1e2], s1e1)?.itemId, 'e2');
  assert.equal(nextDownloadedEpisode([special, episode('sp2', 0, 2), s1e1], special)?.itemId, 'sp2');
  assert.equal(nextDownloadedEpisode([special, s1e1], special)?.itemId, 'e1');
});

test('a film, a song or an episode without a show has no next episode', () => {
  const film = episode('m', null, null, {kind: 'movie'});
  assert.equal(nextDownloadedEpisode([film, episode('e1', 1, 1)], film), undefined);
  assert.equal(nextDownloadedEpisode([episode('e1', 1, 1)], undefined), undefined);
  assert.equal(nextDownloadedEpisode([episode('a', 1, 1, {show: ''}), episode('b', 1, 2, {show: ''})], episode('a', 1, 1, {show: ''})), undefined);
});
