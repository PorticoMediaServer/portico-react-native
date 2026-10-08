/**
 * PERF-S03: an entity's list section (an artist's 5,000 songs, 750k songs, a book's chapters) is a
 * windowed collection: any row can be reached, only the pages near the viewport are read and kept,
 * and the page's own first page costs no extra request.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import {createWindowedCollection} from '../../../packages/client-core/src/collections/index.ts';
import {SECTION_PAGE, sectionSource} from '../src/app/section-source.ts';

const scope = {viewerId: JSON.stringify(['hosted', 'account', 'profile']), serverId: 'server'};
const route = {libraryId: 'music', view: 'artist' as const, entityId: 'artist-1'};
const TOTAL = 5000;
const song = (i: number) => ({id: `song-${i}`, kind: 'song', title: `Song ${i}`, navigation: {view: 'item', entityId: `song-${i}`}});
const pageAt = (page: number) => Array.from({length: Math.min(SECTION_PAGE, TOTAL - page * SECTION_PAGE)}, (_, k) => song(page * SECTION_PAGE + k));
const cursorOf = (page: number) => ((page + 1) * SECTION_PAGE < TOTAL ? `c${page + 1}` : '');

/** The content API for the artist's songs section: a section cursor answers exactly that section. */
function api() {
  const requests: string[] = [];
  return {
    requests,
    request: async <T,>(path: string): Promise<T> => {
      requests.push(path);
      const u = new URL(path, 'https://server.test');
      const page = Number((u.searchParams.get('cursor') ?? 'c0').slice(1));
      return {
        heading: {key: 'artist', fallback: 'Artist'},
        scope: {serverId: 'server', libraryId: 'music', libraryKind: 'music', view: 'artist', entityId: 'artist-1', viewerFence: 'fence'},
        revision: {catalog: 1, viewer: 1},
        query: {sort: 'title', direction: 'asc', category: '', q: '', limit: Number(u.searchParams.get('limit')), searchMode: 'title_prefix'},
        navigation: [], sorts: [], filters: [],
        sections: [{id: 'songs', type: 'list', heading: {key: 'songs', fallback: 'Songs'}, entries: pageAt(page), totalCount: TOTAL, nextCursor: cursorOf(page)}],
      } as T;
    },
  };
}
const seed = {id: 'songs', entries: pageAt(0) as never, nextCursor: 'c1', totalCount: TOTAL};
const settle = async () => { for (let i = 0; i < 50; i++) await new Promise(setImmediate); };

test('the first page is the entity page\'s own (no request); the next page follows its cursor', async () => {
  const a = api();
  const fetch = sectionSource(a, scope, route, seed);
  const first = await fetch(0, SECTION_PAGE, new AbortController().signal);
  assert.equal(first.items.length, SECTION_PAGE);
  assert.equal(first.total, TOTAL);
  assert.equal(a.requests.length, 0);
  const second = await fetch(SECTION_PAGE, SECTION_PAGE, new AbortController().signal);
  assert.equal((second.items[0] as {id: string}).id, `song-${SECTION_PAGE}`);
  assert.equal(a.requests.length, 1);
  assert.match(a.requests[0]!, /view=artist.*entityId=artist-1.*cursor=c1/);
});

test('song 4,999 is reachable; the window stays bounded however far the list is scrolled', async () => {
  const a = api();
  const list = createWindowedCollection({fetchPage: sectionSource(a, scope, route, seed), pageSize: SECTION_PAGE, maxResidentPages: 5, keyOf: (e: {id: string}) => e.id});
  // Scroll through the whole list a screen at a time.
  for (let i = 0; i < TOTAL; i += 12) { list.ensureRange(i, Math.min(TOTAL - 1, i + 11)); await settle(); }
  const last = list.slotAt(TOTAL - 1);
  assert.equal(last.kind, 'item');
  assert.equal((last as {item: {id: string}}).item.id, `song-${TOTAL - 1}`);
  // O(visible): at most maxResidentPages pages (plus what's on screen) stay in memory.
  let resident = 0;
  for (let i = 0; i < TOTAL; i++) if (list.slotAt(i).kind === 'item') resident++;
  assert.ok(resident <= 6 * SECTION_PAGE, `${resident} resident`);
  // Each page is read once on the way down (the first came with the entity page).
  assert.equal(a.requests.length, Math.ceil(TOTAL / SECTION_PAGE) - 1);
  list.dispose();
});

test('a jump deep into the list walks the cursors it needs, once', async () => {
  const a = api();
  const list = createWindowedCollection({fetchPage: sectionSource(a, scope, route, seed), pageSize: SECTION_PAGE, maxResidentPages: 5, keyOf: (e: {id: string}) => e.id});
  list.ensureRange(2000, 2011);
  await settle();
  assert.equal(list.slotAt(2000).kind, 'item');
  const walked = a.requests.length;
  list.ensureRange(2040, 2051);
  await settle();
  assert.equal(list.slotAt(2040).kind, 'item');
  assert.ok(a.requests.length - walked <= 2, 'the next page after a jump is one or two requests, not another walk');
  list.dispose();
});
