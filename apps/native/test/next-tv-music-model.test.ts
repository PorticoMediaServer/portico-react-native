import test from 'node:test';
import assert from 'node:assert/strict';
import {screenModule} from './helpers/screen-harness.mjs';
import {readListeningSimilar} from '../../../packages/client-core/src/library-content.ts';
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

type Fixture = {songs?: readonly any[]; total?: number; similar?: readonly any[]; albums?: readonly any[]; maximumLimit?: number; pageSize?: number; current?: () => boolean; onPage?: (start: number) => void; revision?: (start: number) => string; lowerBound?: boolean; browseError?: () => Error | undefined; similarError?: () => Error | undefined; capabilitiesError?: () => Error | undefined; artistDetails?:any;bySound?:boolean;similarResponse?:unknown;waitSimilar?:Promise<void>;onSimilar?:()=>void;entityMissing?:boolean;entityRevision?:{catalog:number;viewer:number}};
async function controller(entry: any, options: Fixture = {}) {
  const songs = options.songs ?? [], total = options.total ?? songs.length, similar = options.similar ?? [], albums = options.albums ?? [];
  const calls:any[]=[],browseBodies:any[]=[],reads:string[]=[];
  const similarScope={serverId:'server',authority:'local' as const,accountId:'account',profileId:'profile',controllerId:'v1',controllerEpoch:'v1',commandLaneId:'v1'};
  const revision=options.entityRevision??{catalog:7,viewer:3};
  const services:FakeLibraryContentService[]=[];
  class FakeLibraryContentService {
    projection:any;disposed=false;
    constructor(){this.projection=options.entityMissing?null:{entity:options.artistDetails??entry,scope:{serverId:'server',libraryId:'music',libraryKind:'music',view:entry.kind,entityId:entry.id,viewerFence:'real-projection-viewer'},revision};services.push(this);}
    select=async()=>{};
    getSnapshot=()=>({phase:this.disposed?'error':'ready',projection:this.projection});
    dispose=()=>{this.disposed=true;};
  }
  const playback = {cataloguePlayback: () => ({playSegments: (segments: any, start: any) => {calls.push({segments, options: start}); return Promise.resolve({id: 'queue'});}})};
  const api = {request: async (path:any,_method?:any,body?:any)=>{
    reads.push(String(path));
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
      options.onSimilar?.();await options.waitSimilar;
      const failure = options.similarError?.();
      if (failure) throw failure;
      return options.similarResponse??{scope:{serverId:'server',authority:'local',accountId:'account',profileId:'profile'},data:{itemId:entry.id,libraryId:'music',revision,bySound:options.bySound??true,entries:similar}};
    }
    if (String(path).includes('/personal-state')) return {favorite: true};
    throw new Error(`unexpected ${path}`);
  }};
  const {NativeTVMusicController} = await screenModule(new URL('../src-next/screens/destinations/music/model.ts', import.meta.url), {
    react: {default: {}},
    '../../../shell/bootstrap': {default: {}},
    '../../../shell/playback': {default: {}},
    './lifetime': {default: {}, nativeDestinationLifetime: () => ({scope: {serverId: 'server', viewerId: 'viewer'}, current: () => true})},
    '../../../../../../packages/client-core/src/library-content': {default: {}, readListeningSimilar,validateContentEntry:(value:any)=>value,LibraryContentService: FakeLibraryContentService},
    '../../../../../../packages/client-core/src/browse': {default: {}, BrowseQueryBuilder: Builder, browseCapabilitiesPath: (library: string, pivot: string) => `cap:${library}:${pivot}`, browsePath: (library: string) => `browse:${library}`,
      parseBrowseCapabilities: (value: any) => value, parseBrowseResult: (value: any) => value},
    '../../../../../../packages/client-core/src/container-state': {default: {}, getContainerState: async (_api: any, _kind: any, _id: any) => ({favorite: true}), setContainerFlag: async () => ({favorite: false})},
    '../../../../../../packages/contracts/src/routes': {default: {}, encodedRoutePath: (id: string, values: {id: string}) => `/v1/${id}/${values.id}`},
    '../../../../../../packages/client-core/src/server-messages': {default: {}, unreadableServerResponse: 'unreadable'},
  });
  const value = new NativeTVMusicController({api, entry,similarScope,lifetime:{scope:{serverId:'server',viewerId:'opaque-content-scope'},current: () => options.current?.() ?? true}, playback});
  return {value,calls,browseBodies,reads,replaceProjection:()=>{const service=services.at(-1)!;service.projection={...service.projection,revision:{catalog:8,viewer:3}};}};
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

test('artist page reads its real entity details for the Details block', async () => {
  const details = {...artistEntry, country: 'US', activeBeginYear: 2004, activeEndYear: 2017, artistType: 'Group',
    overview: 'An American rapper.', overviewSource: 'Wikipedia'};
  const {value} = await controller(artistEntry, {songs: [song('song-1', 1, 180, 'DNA.')], artistDetails: details});
  await value.load();
  await new Promise(resolve => setTimeout(resolve, 0));
  assert.equal(value.getSnapshot().phase, 'ready');
  assert.equal(value.getSnapshot().artistDetails?.artistType, 'Group');
  assert.equal(value.getSnapshot().artistDetails?.overview, 'An American rapper.');
  assert.equal(value.getSnapshot().artistDetails?.country, 'US');
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
  assert.equal((value.getSnapshot().error as any).musicRead.read, 'songs');
  assert.equal((value.getSnapshot().error as any).musicRead.method, 'POST');
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
  assert.equal(value.getSnapshot().phase,'ready');
  assert.equal(value.getSnapshot().songs.length,1);
  assert.equal((value.getSnapshot().similarError as any).code,'music_album_similar_unavailable');
  assert.equal((value.getSnapshot().similarError as any).musicRead.read,'similar');
  assert.equal((value.getSnapshot().similarError as any).musicRead.method,'GET');
  value.dispose();
});

test('a failed capability read keeps its own stage code', async () => {
  const {value} = await controller(albumEntry, {songs: [song('song-1', 1, 180, 'Come Together')],
    capabilitiesError: () => new Error('capabilities failed')});
  await value.load();
  assert.equal(value.getSnapshot().phase, 'error');
  assert.equal((value.getSnapshot().error as any).code, 'music_album_capabilities_unavailable');
  assert.equal((value.getSnapshot().error as any).musicRead.read, 'capabilities');
  assert.equal((value.getSnapshot().error as any).musicRead.method, 'GET');
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

test('artist All songs follows the artist filter to completion in server order', async () => {
  const many = [song('song-a', 1, 180, 'A'), song('song-b', 2, 181, 'B'), song('song-c', 3, 182, 'C')];
  const {value, browseBodies} = await controller(artistEntry, {songs: many, total: 3, pageSize: 2, maximumLimit: 2});
  await value.loadAllSongs();
  assert.equal(value.getSnapshot().allSongs.phase, 'ready');
  assert.deepEqual(value.getSnapshot().allSongs.songs.map((entry: any) => entry.id), ['song-a', 'song-b', 'song-c']);
  assert.equal(value.getSnapshot().allSongs.total, 3);
  assert.deepEqual(browseBodies[0].query, {field: 'artist', operator: 'equals', value: 'Kendrick Lamar'});
  assert.deepEqual(browseBodies[0].sort, [{field: 'title', direction: 'asc'}]);
  assert.deepEqual(browseBodies.map(body => body.cursor ?? null), [null, '2']);
  value.dispose();
});

test('artist All songs refuses a short page instead of calling it all', async () => {
  const many = [song('song-a', 1, 180, 'A'), song('song-b', 2, 181, 'B')];
  const {value} = await controller(artistEntry, {songs: many, total: 3, pageSize: 2, maximumLimit: 2});
  await value.loadAllSongs();
  assert.equal(value.getSnapshot().allSongs.phase, 'error');
  assert.equal((value.getSnapshot().allSongs.error as any).code, 'music_all_songs_unavailable');
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


test('Sonic Similar requests sound explicitly and preserves the server fallback flag under the real entity revision',async()=>{
 for(const bySound of [true,false]){
  const f=await controller(albumEntry,{songs:[song('song-1',1,180,'Track')],similar:[{kind:'album',id:'other',libraryId:'music',title:'Other'}],bySound,revision:()=> 'opaque-browse-revision'});
  await f.value.load();assert.equal(f.value.getSnapshot().phase,'ready');assert.equal(f.value.getSnapshot().similarBySound,bySound);
  assert(f.reads.some(path=>path.includes('/similar?')&&new URL(path,'https://server.test').searchParams.get('by')==='sound'));
  assert.deepEqual(f.value.getSnapshot().similarProjection.revision,{catalog:7,viewer:3});f.value.dispose();
 }
});
test('wrong original scope, item, library or accepted entity revision cannot publish recommendations or block own songs',async()=>{
 const scope={serverId:'server',authority:'local',accountId:'account',profileId:'profile'},data={itemId:'album-1',libraryId:'music',revision:{catalog:7,viewer:3},bySound:true,entries:[{kind:'album',id:'other',libraryId:'music',title:'Other'}]};
 for(const response of [{scope:{...scope,profileId:'other'},data},{scope:{...scope,serverId:'other'},data},{scope,data:{...data,itemId:'other'}},{scope,data:{...data,libraryId:'other'}},{scope,data:{...data,revision:{catalog:8,viewer:3}}},{scope,data:{...data,revision:{catalog:7,viewer:4}}}]){
  const f=await controller(albumEntry,{songs:[song('song-1',1,180,'Track')],similarResponse:response});await f.value.load();
  assert.equal(f.value.getSnapshot().phase,'ready');assert.equal(f.value.getSnapshot().songs.length,1);assert.deepEqual(f.value.getSnapshot().similar,[]);assert.ok(f.value.getSnapshot().similarError);f.value.dispose();
 }
});
test('a missing entity projection withholds Similar instead of manufacturing a revision from browse',async()=>{
 const f=await controller(albumEntry,{songs:[song('song-1',1,180,'Track')],entityMissing:true});await f.value.load();
 assert.equal(f.reads.some(path=>path.includes('similar')),false);assert.equal(f.value.getSnapshot().phase,'ready');assert.equal(f.value.getSnapshot().songs.length,1);assert.ok(f.value.getSnapshot().similarError);f.value.dispose();
});
test('retained same-ID recommendation actions retire with their original projection and destination',async()=>{
 let current=true;const f=await controller(albumEntry,{similar:[{kind:'album',id:'other',libraryId:'music',title:'Other'}],current:()=>current});await f.value.load();
 const first=f.value.getSnapshot(),entry=first.similar[0];assert.equal(f.value.similarCurrent(first,entry),true);assert.equal(f.value.contains(entry),true);
 f.replaceProjection();assert.equal(f.value.similarCurrent(first,entry),false);assert.equal(f.value.contains(entry),false);
 await f.value.load();assert.equal(f.value.similarCurrent(first,entry),false);assert.equal(f.value.contains(entry),false);
 const next=f.value.getSnapshot();assert.equal(f.value.similarCurrent(next,next.similar[0]),true);current=false;assert.equal(f.value.similarCurrent(next,next.similar[0]),false);f.value.dispose();
});
test('held Similar responses cannot cross destination or entity-projection retirement',async()=>{
 for(const retireProjection of [false,true]){
  let release!:()=>void,started!:()=>void,current=true;const held=new Promise<void>(resolve=>{release=resolve;}),entered=new Promise<void>(resolve=>{started=resolve;});
  const f=await controller(artistEntry,{waitSimilar:held,onSimilar:started,current:()=>current,similar:[{kind:'artist',id:'other',libraryId:'music',title:'Other'}]});
  const loading=f.value.load();await entered;if(retireProjection)f.replaceProjection();else current=false;release();await loading;
  assert.deepEqual(f.value.getSnapshot().similar,[]);f.value.dispose();
 }
});
