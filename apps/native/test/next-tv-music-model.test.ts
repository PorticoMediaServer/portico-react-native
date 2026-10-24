import test from 'node:test';
import assert from 'node:assert/strict';
import {screenModule} from './helpers/screen-harness.mjs';

const song = (id, track, duration, title) => ({id, libraryId: 'music', kind: 'song', title, duration, trackNumber: track, artist: {id: 'artist-1', name: 'Kendrick Lamar'}, album: {id: 'album-1', name: 'DAMN.'}});
const albumEntry = {id: 'album-1', libraryId: 'music', kind: 'album', title: 'DAMN.', artist: {id: 'artist-1', name: 'Kendrick Lamar'}, year: 2017, posterUrl: '/v1/items/a/art/poster'};
const artistEntry = {id: 'artist-1', libraryId: 'music', kind: 'artist', title: 'Kendrick Lamar', country: 'US', activeBeginYear: 2004, genres: ['Hip-Hop']};

class Builder {
  constructor() { this.body = {}; }
  where(field, operator, value) { this.body.query = {field, operator, value}; return this; }
  sort(field, direction) { this.body.sort = [{field, direction}]; return this; }
  limit(value) { this.body.limit = value; return this; }
  build() { return this.body; }
}

async function controller(entry, {songs = [], total = songs.length, similar = [], albums = []} = {}) {
  const calls = [];
  const playback = {cataloguePlayback: () => ({playSegments: (segments, options) => {calls.push({segments, options}); return Promise.resolve({id: 'queue'});}})};
  const api = {request: async path => {
    if (String(path).startsWith('cap:')) return {pivots: [{id: 'songs'}], fields: [{id: 'memberOf'}], sorts: [{id: 'groupOrder'}], queryLimits: {maximumLimit: 200}};
    if (String(path).startsWith('browse:')) return {pivot: 'songs', applied: {query: null, sort: []}, pageInfo: {start: 0, total, revision: 'r', hasMore: false, nextCursor: ''}, entries: songs};
    if (String(path).includes('/albums')) return {albums, nextCursor: ''};
    if (String(path).includes('/similar')) return {data: {entries: similar}};
    if (String(path).includes('/personal-state')) return {favorite: true};
    throw new Error(`unexpected ${path}`);
  }};
  const {NativeTVMusicController} = await screenModule(new URL('../src-next/screens/destinations/music/model.ts', import.meta.url), {
    './lifetime': {nativeDestinationLifetime: () => ({scope: {serverId: 'server', viewerId: 'viewer'}, current: () => true})},
    '../../../../../../packages/client-core/src/library-content': {validateContentEntry: value => value},
    '../../../../../../packages/client-core/src/browse': {BrowseQueryBuilder: Builder, browseCapabilitiesPath: (library, pivot) => `cap:${library}:${pivot}`, browsePath: library => `browse:${library}`,
      parseBrowseCapabilities: value => value, parseBrowseResult: value => value},
    '../../../../../../packages/client-core/src/container-state': {getContainerState: async () => ({favorite: true}), setContainerFlag: async () => ({favorite: false})},
    '../../../../../../packages/contracts/src/routes': {encodedRoutePath: (id, values) => `/v1/${id}/${values.id}`},
    '../../../../../../packages/client-core/src/server-messages': {unreadableServerResponse: 'unreadable'},
  });
  const value = new NativeTVMusicController({api, entry, lifetime: {scope: {}, current: () => true}, playback});
  return {value, calls};
}

test('album page reads its own songs, total, duration and similar albums', async () => {
  const {value} = await controller(albumEntry, {songs: [song('song-1', 1, 180, 'BLOOD.'), song('song-2', 2, 185, 'DNA.')],
    similar: [{kind: 'album', id: 'album-2', libraryId: 'music', title: 'Rumours'}, {kind: 'song', id: 'song-9', libraryId: 'music', title: 'Dreams'}]});
  await value.load();
  const state = value.getSnapshot();
  assert.equal(state.phase, 'ready');
  assert.equal(state.songs.length, 2);
  assert.equal(state.songTotal, 2);
  assert.equal(state.songDurationSeconds, 365);
  assert.deepEqual(state.similar.map(entry => entry.id), ['album-2']);
  assert.equal(state.favorite, true);
  value.dispose();
});

test('artist page reads albums, top songs and similar artists from the server', async () => {
  const {value} = await controller(artistEntry, {songs: [song('song-1', 1, 180, 'DNA.')], total: 4,
    albums: [{id: 'album-1', libraryId: 'music', title: 'Abbey Road', albumArtistId: 'artist-1', albumArtist: 'Kendrick Lamar', year: 2017, posterUrl: '/x'}],
    similar: [{kind: 'artist', id: 'artist-2', libraryId: 'music', title: 'J. Cole'}]});
  await value.load();
  const state = value.getSnapshot();
  assert.equal(state.phase, 'ready');
  assert.equal(state.songTotal, 4);
  assert.equal(state.albums.length, 1);
  assert.equal(state.albums[0]?.artist?.name, 'Kendrick Lamar');
  assert.deepEqual(state.similar.map(entry => entry.id), ['artist-2']);
  value.dispose();
});

test('play starts the album or artist container through the shared queue player', async () => {
  const {value, calls} = await controller(albumEntry, {songs: [song('song-1', 1, 180, 'BLOOD.')]});
  await value.load();
  await value.play('song-1');
  await value.play(undefined, true);
  assert.equal(calls.length, 2);
  assert.deepEqual(calls[0].segments[0].source, {container: {kind: 'album', id: 'album-1'}});
  assert.deepEqual(calls[0].segments[0].anchor, {itemId: 'song-1'});
  assert.deepEqual(calls[1].segments[0].order, {mode: 'shuffle'});
  assert.equal(typeof calls[0].options.isCurrent, 'function');
  assert.ok(calls[0].options.signal instanceof AbortSignal);
  value.dispose();
});
