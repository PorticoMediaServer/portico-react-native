/**
 * Browse totals are exact up to 10,000 and "10,000+" beyond (Justin, 14 October). A broad filter's
 * pages say the total is a lower bound; the grid's total then only grows as pages arrive and
 * settles on the page that knows the end. Phone, tablet, television and Vega share these sources.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import {browsePageSource} from '../src/app/browse-page-source.ts';
import {BrowsePages} from '../src/app/browse-pages.ts';
import {browseCountLabel, songCountLabel, titleCountLabel} from '../src/app/browse-count.ts';
import {createWindowedCollection} from '../../../packages/client-core/src/collections/index.ts';
import {cardCaption} from '../../../packages/client-core/src/presentation/card-caption.ts';
import {createI18n} from '../../../packages/i18n/src/index.ts';

const CAP = 10000;
const signal = new AbortController().signal;
const settle = () => new Promise(resolve => setTimeout(resolve, 0));
const entry = (id: string, extra: Record<string, unknown> = {}) => ({id, kind: 'movie', title: `Title ${id}`, ...extra});

/** A server whose filter matches `actual` titles and counts only up to 10,000. */
function cappedServer(actual: number, o: {revision?: () => string; stale?: (start: number, revision?: string) => boolean} = {}) {
  const calls: Array<{start: number; cursor?: string; revision?: string}> = [];
  const api = {
    request: async <T,>(_path: string, _method?: string, body?: unknown): Promise<T> => {
      const b = body as {limit: number; cursor?: string; range?: {start?: number; revision?: string}};
      const start = b.cursor ? Number(b.cursor) : b.range?.start ?? 0;
      calls.push({start, cursor: b.cursor, revision: b.range?.revision});
      if (o.stale?.(start, b.range?.revision)) throw Object.assign(new Error('expired'), {code: 'stale_continuation', status: 409});
      const revision = o.revision?.() ?? 'rev';
      const n = Math.max(0, Math.min(b.limit, actual - start));
      const next = start + n;
      const capped = actual > CAP;
      return {
        pivot: 'movies',
        applied: {query: null, sort: [], seek: null},
        entries: Array.from({length: n}, (_, i) => entry(`${revision}-${start + i}`, {year: 1990})),
        pageInfo: {start, total: capped ? CAP : actual, totalIsLowerBound: capped, revision, hasMore: next < actual, nextCursor: next < actual ? String(next) : ''},
        positionIndex: [],
      } as T;
    },
  };
  return {api, calls};
}

const broad = {field: 'title', operator: 'contains', value: 'a'} as const;

test('a broad filter past 10,000: the grid total grows as pages arrive, never shrinks, and settles at the end', async () => {
  const s = cappedServer(12345);
  const list = createWindowedCollection({fetchPage: browsePageSource(s.api, {libraryId: 'lib', pivot: 'movies', predicates: [broad]}), pageSize: 60, maxResidentPages: 8, keyOf: (e: {id: string}) => e.id});
  list.ensureRange(0, 59);
  await settle();
  assert.equal(list.getSnapshot().total, CAP);
  assert.equal(list.getSnapshot().totalIsLowerBound, true);
  // Scrolling (or a letter jump on television) past the threshold reads by range and keeps going.
  list.ensureRange(11000, 11059);
  await settle();
  const grown = list.getSnapshot().total!;
  assert.ok(grown >= 11060, `grew past the deepest page read (${grown})`);
  assert.equal(list.getSnapshot().totalIsLowerBound, true);
  list.ensureRange(0, 59);
  await settle();
  assert.equal(list.getSnapshot().total, grown, 'an earlier page does not shrink it back');
  list.ensureRange(12300, 12344);
  await settle();
  assert.equal(list.getSnapshot().total, 12345, 'the last page knows the end');
  assert.equal(list.getSnapshot().totalIsLowerBound, false);
  assert.ok(s.calls.some(c => c.start === Math.floor(11000 / 60) * 60 && c.cursor === undefined), 'read by range past the threshold');
  list.dispose();
});

test('an exact total stays exact: below the threshold nothing is a lower bound', async () => {
  const s = cappedServer(240);
  const page = await browsePageSource(s.api, {libraryId: 'lib', pivot: 'movies', predicates: [broad]})(0, 60, signal);
  assert.equal(page.total, 240);
  assert.equal(page.totalIsLowerBound, false);
});

test('read again past 10,000 with no matching bucket: the list stays where it was instead of jumping back to 9,999', async () => {
  let revision = 'one';
  const s = cappedServer(20000, {revision: () => revision, stale: (start, rev) => rev === 'one' && revision === 'two' && start !== 0});
  const source = browsePageSource(s.api, {libraryId: 'lib', pivot: 'movies', predicates: [broad], sort: {field: 'year', direction: 'desc'}});
  await source(0, 60, signal);
  const deep = await source(15000, 60, signal);
  assert.equal(deep.items[0]!.id, 'one-15000');
  revision = 'two';
  const again = await source(15000, 60, signal);
  assert.equal(again.items[0]!.id, 'two-15000');
});

test('a group\'s pages inside a screen carry the lower bound, and lose it at the end', async () => {
  const s = cappedServer(10050);
  const pages = new BrowsePages(s.api, 'lib', 60);
  pages.select({pivot: 'movies', predicates: [broad]});
  await settle();
  assert.equal(pages.getSnapshot().totalIsLowerBound, true);
  assert.equal(pages.getSnapshot().hasMore, true);
  const small = new BrowsePages(cappedServer(30).api, 'lib', 60);
  small.select({pivot: 'movies', predicates: [broad]});
  await settle();
  assert.equal(small.getSnapshot().totalIsLowerBound, false);
  assert.equal(small.getSnapshot().total, 30);
  pages.dispose();
  small.dispose();
});

test('counts read "10,000+" for a lower bound and stay exact otherwise', () => {
  const {t} = createI18n();
  assert.equal(browseCountLabel(t, 10000, 'movies', true), '10,000+ movies');
  assert.equal(browseCountLabel(t, 10000, 'songs', true), '10,000+ songs');
  assert.equal(browseCountLabel(t, 1204, 'movies'), '1,204 movies');
  assert.equal(browseCountLabel(t, 1, 'shows'), '1 show');
  assert.equal(titleCountLabel(t, 10000, true), '10,000+ titles');
  assert.equal(titleCountLabel(t, 12), t('count.titles', {count: 12}));
  assert.equal(songCountLabel(t, 10000, true), '10,000+ songs');
  assert.equal(songCountLabel(t, 3), '3 songs');
  // A grouping tile (a category, a decade) counted only up to the threshold.
  assert.equal(cardCaption({kind: 'category', count: 10000, countIsLowerBound: true}, t), '10,000+ titles');
  assert.equal(cardCaption({kind: 'category', count: 10000}, t), t('title.itemCount', {count: 10000}));
});
