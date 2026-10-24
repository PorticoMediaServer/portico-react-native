import test from 'node:test';
import assert from 'node:assert/strict';
import type {LibraryContentApi} from '../../../packages/client-core/src/library-content.ts';
import {NativeSearchExplore} from '../src-next/screens/search/explore.ts';
import {nativeSearchGenreTiles} from '../src-next/screens/search/genre-tiles.ts';

const art = (id: string, slot = 'poster') => ({kind: 'item', id,
  path: `/v1/metadata/item/${id}/art/${slot}?v=${'a'.repeat(64)}&w=${slot === 'poster' ? 400 : 1920}`});
const genre = (value: string, count: number) => ({value, label: `Metadata ${value}`, count,
  covers: [art(`${value}_a`), art(`${value}_b`)], backdrop: art(`${value}_wide`, 'backdrop')});

test('Explore preserves canonical page order, missing-art counts and title art while filling only the drawn prefixes', async () => {
  const first = [genre('z', 30), genre('a', 20)], rest = ['b', 'c', 'd', 'e'].map((id, index) => genre(id, 19 - index));
  const noArt = {value: 'no-art', label: 'Actual artless genre', count: 40, covers: []};
  const paths: string[] = [], opened: unknown[] = [];
  const api: LibraryContentApi = {request: async <T>(path: string): Promise<T> => {
    paths.push(path); const cursor = new URL(path, 'https://fixture.invalid').searchParams.get('cursor');
    return (cursor === 'tile-next' ? {revision: 'opaque-revision', genres: rest, nextCursor: 'all-next'}
      : cursor === 'all-next' ? {revision: 'opaque-revision', genres: [{...noArt, value: 'another-artless'}]}
      : {revision: 'opaque-revision', genres: [noArt, ...first], nextCursor: 'tile-next'}) as T;
  }};
  const controller = new NativeSearchExplore({api, current: () => true, surface: 'phone', openGenre: value => opened.push(value)});
  try {
    assert.equal(paths.length, 0, 'constructing a renderer performs no I/O');
    const load = controller.load(); assert.equal(controller.load(), load); await load;
    const state = controller.getSnapshot();
    assert.equal(state.phase, 'ready'); assert.equal(state.revision, 'opaque-revision'); assert.equal(state.nextCursor, 'all-next');
    assert.deepEqual(state.genres.map(value => value.id), ['no-art', 'z', 'a', 'b', 'c', 'd', 'e']);
    assert.equal(state.genres[0].count, 40, 'All genres retains real artless counts');
    assert.deepEqual(nativeSearchGenreTiles(state.genres, 'phone').map(value => value.id), ['z', 'a', 'b', 'c', 'd', 'e']);
    assert.deepEqual(nativeSearchGenreTiles(state.genres, 'phone-empty').map(value => value.id), ['z', 'a', 'b', 'c']);
    assert.deepEqual(state.genres[1].coverPaths, first[0].covers.map(value => value.path));
    assert.equal(paths.length, 2, 'the loader stops once the two authored prefixes are complete');
    controller.openGenre({...state.genres[1]}); assert.deepEqual(opened, []);
    controller.openGenre(state.genres[1]); assert.deepEqual(opened, [state.genres[1]]);
    await controller.next();
    assert.equal(controller.getSnapshot().genres.at(-1)?.id, 'another-artless');
    assert.equal(controller.getSnapshot().nextCursor, undefined);
    assert.ok(paths.every(path => new URL(path, 'https://fixture.invalid').searchParams.get('limit') === '50'));
    assert.equal(controller.getSnapshot().initialHeading, 'next.search.browseByGenre');
    assert.equal(controller.getSnapshot().emptyHeading, 'next.search.browseInstead');
  } finally {controller.dispose();}
});

test('a changed opaque revision or a cursor cycle is refused instead of mixing or ranking local pages', async () => {
  let calls = 0;
  const api: LibraryContentApi = {request: async <T>(): Promise<T> => (++calls === 1
    ? {revision: 'original', genres: [genre('a', 1)], nextCursor: 'next'}
    : {revision: 'changed', genres: [genre('b', 2)]}) as T};
  const controller = new NativeSearchExplore({api, current: () => true, surface: 'tv', openGenre() {}});
  await controller.load(); assert.equal(controller.getSnapshot().phase, 'error');
  assert.deepEqual(controller.getSnapshot().genres.map(value => value.id), ['a']); controller.dispose();
  let reads = 0;
  const cyclic = new NativeSearchExplore({current: () => true, surface: 'phone', openGenre() {}, api: {request: async <T>(): Promise<T> => {
    reads++; return {revision: 'same', genres: [], nextCursor: reads === 2 ? 'b' : 'a'} as T;
  }}});
  await cyclic.load(); assert.equal(reads, 3); assert.equal(cyclic.getSnapshot().phase, 'error'); cyclic.dispose();
});

test('retired viewer transport and old genre actions cannot revive a private Explore response', async () => {
  let current = true, signal: AbortSignal | undefined, finish!: (value: unknown) => void, started!: () => void, opens = 0;
  const entered = new Promise<void>(resolve => {started = resolve;});
  const api: LibraryContentApi = {request: <T>(_path: string, _method?: string, _body?: unknown, actualSignal?: AbortSignal) => {
    signal = actualSignal; started(); return new Promise<T>(resolve => {finish = value => resolve(value as T);});
  }};
  const controller = new NativeSearchExplore({api, current: () => current, surface: 'phone', openGenre: () => {opens++;}});
  const loading = controller.load(); await entered; current = false;
  const retired = controller.getSnapshot(); assert.ok(signal?.aborted);
  finish({revision: 'late', genres: [genre('a', 1)]}); await loading;
  assert.equal(controller.getSnapshot(), retired); assert.deepEqual(retired.genres, []); assert.equal(opens, 0);
});
