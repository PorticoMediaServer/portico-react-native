/** A group's sorted and filtered titles inside a page: first page, Show more, quiet refresh. */
import test from 'node:test';
import assert from 'node:assert/strict';
import {BrowsePages} from '../src/app/browse-pages.ts';

const entry = (id: string) => ({id, libraryId: 'lib', kind: 'movie', title: id});
function server(titles: string[], o: {stale?: () => boolean} = {}) {
  const calls: {path: string; body: any}[] = [];
  let hold: Promise<void> | undefined;
  return {
    calls,
    titles,
    holdNext(p: Promise<void>) { hold = p; },
    api: {request: async <T,>(path: string, _method?: string, body?: any): Promise<T> => {
      calls.push({path, body});
      const wait = hold; hold = undefined; if (wait) await wait;
      if (body.cursor && o.stale?.()) throw Object.assign(new Error('stale'), {code: 'stale_continuation', status: 409});
      const start = body.cursor ? Number(body.cursor) : 0;
      const page = titles.slice(start, start + body.limit);
      const next = start + page.length;
      return {pivot: body.pivot, applied: {query: body.query ?? null, sort: body.sort ?? [], seek: null}, entries: page.map(entry), pageInfo: {start, total: titles.length, revision: '1', hasMore: next < titles.length, nextCursor: next < titles.length ? String(next) : ''}, positionIndex: []} as T;
    }},
  };
}
const settle = () => new Promise(resolve => setTimeout(resolve, 0));
const base = {field: 'collection', operator: 'equals', value: 'c1'} as const;
const unwatched = {field: 'playState', operator: 'equals', value: 'unwatched'} as const;
const ids = (pages: BrowsePages) => pages.getSnapshot().entries.map(e => e.id);

test('the group’s own condition and the viewer’s filters go to the server as one conjunction, with the chosen sort', async () => {
  const s = server(['a', 'b', 'c']);
  const pages = new BrowsePages(s.api, 'lib 1', 2);
  pages.select({pivot: 'movies', predicates: [base, unwatched], sort: {field: 'year', direction: 'desc'}});
  await settle();
  assert.equal(s.calls[0]!.path, '/v1/libraries/lib%201/browse');
  assert.deepEqual(s.calls[0]!.body, {pivot: 'movies', query: {all: [base, unwatched]}, sort: [{field: 'year', direction: 'desc'}], limit: 2});
  assert.deepEqual(ids(pages), ['a', 'b']);
  assert.equal(pages.getSnapshot().total, 3);
  assert.equal(pages.getSnapshot().hasMore, true);
  // With no filter of the viewer's the group's condition is sent alone: the list never leaves the group.
  pages.select({pivot: 'movies', predicates: [base]});
  await settle();
  assert.deepEqual(s.calls.at(-1)!.body, {pivot: 'movies', query: base, limit: 2});
});

test('Show more appends the next page; nothing is read that was not asked for', async () => {
  const s = server(['a', 'b', 'c', 'd', 'e']);
  const pages = new BrowsePages(s.api, 'lib', 2);
  pages.select({pivot: 'movies', predicates: [base]});
  await settle();
  assert.equal(s.calls.length, 1);
  await pages.more();
  assert.deepEqual(ids(pages), ['a', 'b', 'c', 'd']);
  await pages.more();
  assert.deepEqual(ids(pages), ['a', 'b', 'c', 'd', 'e']);
  assert.equal(pages.getSnapshot().hasMore, false);
  await pages.more();
  assert.equal(s.calls.length, 3, 'nothing more to read');
});

test('a new sort keeps the titles on screen until its first page has arrived', async () => {
  const s = server(['a', 'b']);
  const pages = new BrowsePages(s.api, 'lib', 2);
  pages.select({pivot: 'movies', predicates: [base]});
  await settle();
  let release!: () => void;
  s.holdNext(new Promise<void>(resolve => { release = resolve; }));
  s.titles.splice(0, 2, 'z', 'y');
  pages.select({pivot: 'movies', predicates: [base], sort: {field: 'title', direction: 'desc'}});
  assert.equal(pages.getSnapshot().status, 'loading');
  assert.deepEqual(ids(pages), ['a', 'b'], 'not blanked while the new order is on its way');
  release();
  await settle();
  assert.deepEqual(ids(pages), ['z', 'y']);
  assert.equal(pages.getSnapshot().status, 'ready');
});

test('an answer for a sort the viewer has already left is dropped', async () => {
  const s = server(['a', 'b']);
  const pages = new BrowsePages(s.api, 'lib', 2);
  let release!: () => void;
  s.holdNext(new Promise<void>(resolve => { release = resolve; }));
  pages.select({pivot: 'movies', predicates: [base], sort: {field: 'year', direction: 'asc'}});
  pages.select({pivot: 'movies', predicates: [base], sort: {field: 'title', direction: 'asc'}});
  await settle();
  const settled = pages.getSnapshot();
  release();
  await settle();
  assert.equal(pages.getSnapshot(), settled);
});

test('a quiet refresh reads what is listed again and swaps it in whole; a failed one says nothing', async () => {
  const s = server(['a', 'b', 'c', 'd']);
  const pages = new BrowsePages(s.api, 'lib', 2);
  pages.select({pivot: 'movies', predicates: [base]});
  await settle();
  await pages.more();
  s.titles.splice(1, 1); // "b" was removed on the server
  await pages.refresh();
  assert.deepEqual(ids(pages), ['a', 'c', 'd']);
  assert.equal(pages.getSnapshot().total, 3);
  const before = pages.getSnapshot();
  const failing = {request: async () => { throw new Error('offline'); }};
  (pages as unknown as {api: unknown}).api = failing;
  await pages.refresh();
  assert.equal(pages.getSnapshot(), before);
});

test('a continuation the server no longer honours is read again from the start, without an error', async () => {
  let stale = true;
  const s = server(['a', 'b', 'c', 'd', 'e'], {stale: () => { const now = stale; stale = false; return now; }});
  const pages = new BrowsePages(s.api, 'lib', 2);
  pages.select({pivot: 'movies', predicates: [base]});
  await settle();
  await pages.more();
  assert.equal(pages.getSnapshot().error, undefined);
  assert.deepEqual(ids(pages), ['a', 'b', 'c', 'd']);
});

test('a first read that fails says so and can be tried again; clearing the query clears the list', async () => {
  let fail = true;
  const s = server(['a']);
  const api = {request: async <T,>(path: string, method?: string, body?: unknown): Promise<T> => { if (fail) throw Object.assign(new Error('no'), {code: 'internal'}); return s.api.request<T>(path, method, body); }};
  const pages = new BrowsePages(api, 'lib', 2);
  pages.select({pivot: 'movies', predicates: [base]});
  await settle();
  assert.equal(pages.getSnapshot().status, 'error');
  fail = false;
  pages.retry();
  await settle();
  assert.deepEqual(ids(pages), ['a']);
  pages.select(null);
  assert.equal(pages.getSnapshot().status, 'idle');
  assert.deepEqual(ids(pages), []);
});
