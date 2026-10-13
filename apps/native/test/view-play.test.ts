/**
 * Play and Shuffle on a saved view cover the view, not only the pages on screen: the rest is
 * read first, up to what one play request holds, and a longer view says it was cut short.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import {gatherView, VIEW_PLAY_LIMIT} from '../src/app/view-play.ts';

type Entry = {id: string; playable: boolean};
const entry = (i: number, playable = true): Entry => ({id: `e${i}`, playable});
const o = {keyOf: (e: Entry) => e.id, playable: (e: Entry) => e.playable};

/** A view of `total` titles, 40 to a page; cursors are page numbers. */
function view(total: number, playableAt: (i: number) => boolean = () => true) {
  const reads: string[] = [];
  const page = (n: number) => ({entries: Array.from({length: Math.max(0, Math.min(40, total - n * 40))}, (_, k) => entry(n * 40 + k, playableAt(n * 40 + k))), nextCursor: (n + 1) * 40 < total ? String(n + 1) : ''});
  return {reads, first: page(0), read: async (cursor: string) => { reads.push(cursor); return page(Number(cursor)); }};
}

test('a view that is already whole is played as it is', async () => {
  const v = view(30);
  const got = await gatherView(v.first.entries, v.first.nextCursor, v.read, o);
  assert.equal(got.entries.length, 30);
  assert.equal(got.complete, true);
  assert.deepEqual(v.reads, []);
});

test('the pages after the ones on screen are read before playing', async () => {
  const v = view(130);
  const got = await gatherView(v.first.entries, v.first.nextCursor, v.read, o);
  assert.deepEqual(got.entries.map(e => e.id), Array.from({length: 130}, (_, i) => `e${i}`));
  assert.equal(got.complete, true);
  assert.deepEqual(v.reads, ['1', '2', '3']);
});

test('a view longer than one request stops at the limit and says so', async () => {
  const v = view(2000);
  const got = await gatherView(v.first.entries, v.first.nextCursor, v.read, o);
  assert.equal(got.entries.length, VIEW_PLAY_LIMIT);
  assert.equal(got.complete, false);
  // 500 titles are 12.5 pages; reading stops there, not at the end of the view.
  assert.equal(v.reads.length, 12);
});

test('a view of exactly the limit is complete', async () => {
  const v = view(VIEW_PLAY_LIMIT);
  const got = await gatherView(v.first.entries, v.first.nextCursor, v.read, o);
  assert.equal(got.entries.length, VIEW_PLAY_LIMIT);
  assert.equal(got.complete, true);
});

test('titles that cannot be played do not use up the limit', async () => {
  const v = view(80, i => i % 2 === 0);
  const got = await gatherView(v.first.entries, v.first.nextCursor, v.read, {...o, limit: 30});
  assert.equal(got.entries.filter(e => e.playable).length, 30);
  assert.equal(got.complete, false);
});

test('a title listed on two pages is played once', async () => {
  const pages: Record<string, {entries: Entry[]; nextCursor: string}> = {a: {entries: [entry(1), entry(2)], nextCursor: 'b'}, b: {entries: [entry(3)], nextCursor: ''}};
  const got = await gatherView([entry(0), entry(1)], 'a', async c => pages[c]!, o);
  assert.deepEqual(got.entries.map(e => e.id), ['e0', 'e1', 'e2', 'e3']);
  assert.equal(got.complete, true);
});

test('a page that cannot be read fails the whole gather', async () => {
  await assert.rejects(gatherView([entry(0)], 'x', async () => { throw new Error('offline'); }, o), /offline/);
});

test('a cursor that does not move ends the read', async () => {
  let reads = 0;
  const got = await gatherView([entry(0)], 'same', async () => { reads++; return {entries: [entry(reads)], nextCursor: 'same'}; }, o);
  assert.equal(reads, 1);
  assert.equal(got.complete, true);
});

test('a cancelled gather stops before the next page', async () => {
  const controller = new AbortController();
  controller.abort();
  await assert.rejects(gatherView([entry(0)], '1', async () => ({entries: [], nextCursor: ''}), {...o, signal: controller.signal}), {name: 'AbortError'});
});
