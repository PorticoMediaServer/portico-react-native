import test from 'node:test';
import assert from 'node:assert/strict';
import {screenModule} from './helpers/screen-harness.mjs';
import {presentError} from '../../../packages/client-core/src/presentation/errors.ts';

const song = (id: string, track: number, duration: number, title: string) => ({id, libraryId: 'music', kind: 'song', title, duration, trackNumber: track, artist: {id: 'artist-1', name: 'Kendrick Lamar'}, album: {id: 'album-1', name: 'DAMN.'}});
const albumEntry = {id: 'album-1', libraryId: 'music', kind: 'album', title: 'DAMN.', artist: {id: 'artist-1', name: 'Kendrick Lamar'}, year: 2017, posterUrl: '/v1/items/a/art/poster'};
const artistEntry = {id: 'artist-1', libraryId: 'music', kind: 'artist', title: 'Kendrick Lamar', country: 'US', activeBeginYear: 2004, genres: ['Hip-Hop']};

class Builder {
  body: any;
  constructor() { this.body = {}; }
  where(field: string, operator: string, value: string) { this.body.query = {field, operator, value}; return this; }
  sort(field: string, direction: string) { this.body.sort = [{field, direction}]; return this; }
  cursor(value: string) { this.body.cursor = value; return this; }
  limit(value: number) { this.body.limit = value; return this; }
  build() { return {pivot: 'songs', ...this.body}; }
}

type Fixture = {songs?: readonly any[]; total?: number; similar?: readonly any[]; albums?: readonly any[]; maximumLimit?: number; pageSize?: number; current?: () => boolean; onPage?: (start: number) => void; revision?: (start: number) => string; lowerBound?: boolean; browseError?: () => Error | undefined; similarError?: () => Error | undefined; capabilitiesError?: () => Error | undefined};
async function controller(entry: any, options: Fixture = {}) {
  const songs = options.songs ?? [], total = options.total ?? songs.length, similar = options.similar ?? [], albums = options.albums ?? [];
  const calls: any[] = [], browseBodies: any[] = [];
  const playback = {cataloguePlayback: () => ({playSegments: (segments: any, start: any) => {calls.push({segments, options: start}); return Promise.resolve({id: 'queue'});}})};
  const api = {request: async (path: any, _method?: any, body?: any) => {
    if (String(path).startsWith('cap:')) {
      const failure = options.capabilitiesError?.();
      if (failure) throw failure;
      return {pivots: [{id: 'songs'}], fields: [{id: 'memberOf'}], sorts: [{id: 'groupOrder'}], queryLimits: {maximumLimit: options.maximumLimit ?? 200}};
    }
    if (String(path).startsWith('browse:')) {
      const failure = options.browseError?.();
      if (failure) throw failure;
      browseBodies.push(JSON.parse(JSON.stringify(body)));
      const pageSize = options.pageSize ?? songs.length;
      const start = body?.cursor ? Number(body.cursor) : 0;
      const rows = songs.slice(start, start + pageSize);
      const nextCursor = start + pageSize < total ? String(start + pageSize) : '';
      options.onPage?.(start);
      return {pivot: 'songs', applied: {query: null, sort: []}, pageInfo: {start, total, revision: options.revision?.(start) ?? 'r', hasMore: nextCursor !== '', nextCursor, ...(options.lowerBound ? {totalIsLowerBound: true} : {})}, entries: rows};
    }
    if (String(path).includes('albums')) return {albums, nextCursor: ''};
    if (String(path).includes('similar')) {
      const failure = options.similarError?.();
      if (failure) throw failure;
      return {data: {entries: similar}};
    }
    if (String(path).includes('/personal-state')) return {favorite: true};
    throw new Error(`unexpected ${path}`);
  }};
  const {NativeTVMusicController} = await screenModule(new URL('../src-next/screens/destinations/music/model.ts', import.meta.url), {
    react: {default: {}},
    '../../../shell/bootstrap': {default: {}},
    '../../../shell/playback': {default: {}},
    './lifetime': {default: {}, nativeDestinationLifetime: () => ({scope: {serverId: 'server', viewerId: 'viewer'}, current: () => true})},
    '../../../../../../packages/client-core/src/library-content': {default: {}, validateContentEntry: (value: any) => value},
    '../../../../../../packages/client-core/src/browse': {default: {}, BrowseQueryBuilder: Builder, browseCapabilitiesPath: (library: string, pivot: string) => `cap:${library}:${pivot}`, browsePath: (library: string) => `browse:${library}`,
      parseBrowseCapabilities: (value: any) => value, parseBrowseResult: (value: any) => value},
    '../../../../../../packages/client-core/src/container-state': {default: {}, getContainerState: async (_api: any, _kind: any, _id: any) => ({favorite: true}), setContainerFlag: async () => ({favorite: false})},
    '../../../../../../packages/contracts/src/routes': {default: {}, encodedRoutePath: (id: string, values: {id: string}) => `/v1/${id}/${values.id}`},
    '../../../../../../packages/client-core/src/server-messages': {default: {}, unreadableServerResponse: 'unreadable'},
  });
  const value = new NativeTVMusicController({api, entry, lifetime: {scope: {}, current: () => options.current?.() ?? true}, playback});
  return {value, calls, browseBodies};
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
  assert.deepEqual(state.similar.map((entry: any) => entry.id), ['album-2']);
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
  assert.deepEqual(state.similar.map((entry: any) => entry.id), ['artist-2']);
  value.dispose();
});

test('album songs respect the server page cap and continue with the cursor', async () => {
  const many = Array.from({length: 150}, (_, index) => song(`song-${index}`, index + 1, 180, `Track ${index + 1}`));
  const {value, browseBodies} = await controller(albumEntry, {songs: many, total: 150, maximumLimit: 100, pageSize: 100});
  await value.load();
  const state = value.getSnapshot();
  assert.equal(state.phase, 'ready');
  assert.equal(state.songs.length, 150);
  assert.equal(state.songTotal, 150);
  assert.equal(state.songDurationSeconds, 27000);
  assert.deepEqual(browseBodies.map(body => body.limit), [100, 100]);
  assert.deepEqual(browseBodies.map(body => body.cursor ?? null), [null, '100']);
  assert.deepEqual(browseBodies[0], {pivot: 'songs', query: {field: 'memberOf', operator: 'equals', value: 'album-1'},
    sort: [{field: 'groupOrder', direction: 'asc'}], limit: 100});
  value.dispose();
});

test('a plain songs failure publishes a safe code and retries the same page', async () => {
  let fail = true;
  const {value} = await controller(albumEntry, {songs: [song('song-1', 1, 180, 'Come Together')],
    browseError: () => fail ? new Error('transport') : undefined});
  await value.load();
  assert.equal(value.getSnapshot().phase, 'error');
  assert.equal((value.getSnapshot().error as any).code, 'music_album_songs_unavailable');
  fail = false;
  await value.load();
  assert.equal(value.getSnapshot().phase, 'ready');
  assert.equal(value.getSnapshot().songs.length, 1);
  value.dispose();
});

test('a failed More like this read keeps its own stage code', async () => {
  const {value} = await controller(albumEntry, {songs: [song('song-1', 1, 180, 'Come Together')],
    similarError: () => new Error('rail failed')});
  await value.load();
  assert.equal(value.getSnapshot().phase, 'error');
  assert.equal((value.getSnapshot().error as any).code, 'music_album_similar_unavailable');
  value.dispose();
});

test('a failed capability read keeps its own stage code', async () => {
  const {value} = await controller(albumEntry, {songs: [song('song-1', 1, 180, 'Come Together')],
    capabilitiesError: () => new Error('capabilities failed')});
  await value.load();
  assert.equal(value.getSnapshot().phase, 'error');
  assert.equal((value.getSnapshot().error as any).code, 'music_album_capabilities_unavailable');
  value.dispose();
});

test('the music failure copy names the title and offers a real retry, never Home', () => {
  const presented = presentError(Object.assign(new Error('x'), {code: 'music_album_songs_unavailable'}), 'detail');
  assert.equal(presented.title, 'This title couldn’t load');
  assert.equal(presented.action, 'try-again');
  assert.notEqual(presented.body, 'Something went wrong. Try again.');
});

test('a retired album lifetime sends no second cursor page', async () => {
  const many = Array.from({length: 150}, (_, index) => song(`song-${index}`, index + 1, 180, `Track ${index + 1}`));
  let live = true;
  const {value, browseBodies} = await controller(albumEntry, {songs: many, total: 150, maximumLimit: 100, pageSize: 100,
    current: () => live, onPage: start => {if (start === 0) live = false;}});
  await value.load();
  assert.equal(browseBodies.length, 1);
  assert.notEqual(value.getSnapshot().phase, 'ready');
  value.dispose();
});

test('album membership follows every server page in canonical order', async () => {
  const many = [song('song-a', 1, 180, 'Disc one'), song('song-b', 2, 181, 'Disc one, two'), song('song-c', 1, 182, 'Disc two'), song('song-d', 2, 183, 'Disc two, two'), song('song-e', 3, 184, 'Disc two, three')];
  const {value, browseBodies} = await controller(albumEntry, {songs: many, total: 5, pageSize: 2, maximumLimit: 2});
  const ids = await value.albumMembership();
  assert.deepEqual(ids, ['song-a', 'song-b', 'song-c', 'song-d', 'song-e']);
  assert.deepEqual(browseBodies.map(body => body.cursor ?? null), [null, '2', '4']);
  assert.deepEqual(browseBodies.map(body => body.limit), [2, 2, 2]);
  assert.deepEqual(browseBodies[0].query, {field: 'memberOf', operator: 'equals', value: 'album-1'});
  assert.deepEqual(browseBodies[0].sort, [{field: 'groupOrder', direction: 'asc'}]);
  value.dispose();
});

test('album membership refuses a source that changes between pages instead of returning a subset', async () => {
  const many = Array.from({length: 4}, (_, index) => song(`song-${index}`, index + 1, 180, `Track ${index + 1}`));
  const {value} = await controller(albumEntry, {songs: many, total: 4, pageSize: 2, maximumLimit: 2, revision: start => start === 0 ? 'r1' : 'r2'});
  await assert.rejects(value.albumMembership(), (error: any) => error.code === 'album_membership_changed');
  value.dispose();
});

test('album membership refuses a lower bound or a short server page', async () => {
  const many = [song('song-0', 1, 180, 'A'), song('song-1', 2, 181, 'B')];
  const bounded = await controller(albumEntry, {songs: many, total: 9, pageSize: 2, maximumLimit: 2, lowerBound: true});
  await assert.rejects(bounded.value.albumMembership(), (error: any) => error.code === 'album_membership_incomplete');
  bounded.value.dispose();
  const short = await controller(albumEntry, {songs: many, total: 3, pageSize: 2, maximumLimit: 2});
  await assert.rejects(short.value.albumMembership(), (error: any) => error.code === 'album_membership_incomplete');
  short.value.dispose();
});

test('album membership refuses a non-song or duplicate member instead of a leaf subset', async () => {
  const mixed = await controller(albumEntry, {songs: [song('song-0', 1, 180, 'A'), {...song('movie-1', 2, 181, 'B'), kind: 'movie'}], total: 2});
  await assert.rejects(mixed.value.albumMembership(), (error: any) => error.code === 'album_membership_incomplete');
  mixed.value.dispose();
  const duplicate = await controller(albumEntry, {songs: [song('song-0', 1, 180, 'A'), song('song-0', 2, 181, 'A again')], total: 2});
  await assert.rejects(duplicate.value.albumMembership(), (error: any) => error.code === 'album_membership_incomplete');
  duplicate.value.dispose();
});

test('album membership stops sending when the destination retires', async () => {
  const many = Array.from({length: 4}, (_, index) => song(`song-${index}`, index + 1, 180, `Track ${index + 1}`));
  let live = true;
  const {value, browseBodies} = await controller(albumEntry, {songs: many, total: 4, pageSize: 2, maximumLimit: 2, current: () => live,
    onPage: start => {if (start === 0) live = false;}});
  await assert.rejects(value.albumMembership(), (error: any) => error.name === 'AbortError');
  assert.equal(browseBodies.length, 1);
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
