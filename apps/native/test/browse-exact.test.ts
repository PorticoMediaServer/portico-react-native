import test from 'node:test';
import assert from 'node:assert/strict';
import {browsePageSource as appleBrowsePageSource} from '../src/app/browse-page-source.ts';
import {sectionSource, SECTION_PAGE} from '../src/app/section-source.ts';

const entry = (id: string, extra: Record<string, unknown> = {}) => ({id, kind: 'movie', title: `Title ${id}`, ...extra});
const signal = new AbortController().signal;

function browsePage(opts: {start: number; total: number; hasMore: boolean; nextCursor?: string; revision?: string; positionIndex?: Array<{key: string; index: number}>; entries?: Array<{id: string; [k: string]: unknown}>}): any {
  const count = opts.entries?.length ?? 60;
  return {
    pivot: 'movies',
    applied: {query: {field: 'genre', operator: 'contains', value: 'Action'}, sort: [{field: 'title', direction: 'asc'}], seek: null},
    entries: opts.entries ?? Array.from({length: count}, (_, i) => entry(`e${opts.start + i}`)),
    pageInfo: {
      start: opts.start, total: opts.total, revision: opts.revision ?? 'rev',
      hasMore: opts.hasMore, nextCursor: opts.nextCursor ?? (opts.hasMore ? 'cursor-next' : ''),
    },
    positionIndex: opts.positionIndex ?? [],
  };
}

test('Apple: an ad hoc query pages by range above 10,000 with an exact total', async () => {
  const seen: Array<{start?: number; cursor?: string}> = [];
  const api = {
    request: async (_path: string, _method?: string, body?: unknown) => {
      const b = body as {range?: {start?: number}; cursor?: string};
      seen.push({start: b.range?.start, cursor: b.cursor});
      const start = b.range?.start ?? 0;
      return browsePage({start, total: 10140, hasMore: start + 60 < 10140, nextCursor: start + 60 < 10140 ? `cursor-${start + 60}` : ''});
    },
  };
  const source = appleBrowsePageSource(api, {libraryId: 'lib', pivot: 'movies', predicates: [{field: 'genre', operator: 'contains', value: 'Action'}], sort: {field: 'title', direction: 'asc'}});
  const first = await source(0, 60, signal);
  assert.equal(first.total, 10140);
  await source(9960, 60, signal);
  const pastCap = await source(10020, 60, signal);
  assert.equal(pastCap.items[0]!.id, 'e10020');
  assert.equal(pastCap.total, 10140);
  assert.ok(seen.some(s => s.start === 10020));
  assert.ok(seen.every(s => s.cursor === undefined));
});

test('Discover See all sends an albums pivot with the complete published expression and sort', async () => {
  const query = {any: [{field: 'genre', operator: 'equals', value: 'Jazz'}, {not: {field: 'year', operator: 'less-than', value: 1980}}]} as const;
  const sort = [{field: 'forYou', direction: 'desc'}] as const;
  let body: any;
  const api = {request: async (_path: string, _method?: string, value?: unknown) => {
    body = value;
    return {...browsePage({start: 0, total: 0, hasMore: false, entries: []}), pivot: 'albums', applied: {query, sort, seek: null}};
  }};
  await appleBrowsePageSource(api, {libraryId: 'music', pivot: 'albums', predicates: [], query, sorts: sort})(0, 60, signal);
  assert.equal(body.pivot, 'albums');
  assert.deepEqual(body.query, query);
  assert.deepEqual(body.sort, sort);
});

test('a published unfiltered See all does not inherit the previous browse tab filter', async () => {
  let body: any;
  const api = {request: async (_path: string, _method?: string, value?: unknown) => {
    body = value;
    return browsePage({start: 0, total: 0, hasMore: false, entries: []});
  }};
  await appleBrowsePageSource(api, {libraryId: 'movies', pivot: 'movies', predicates: [{field: 'genre', operator: 'equals', value: 'Old'}], sorts: [{field: 'forYou', direction: 'desc'}]})(0, 60, signal);
  assert.equal(body.query, undefined);
  assert.deepEqual(body.sort, [{field: 'forYou', direction: 'desc'}]);
});

test('W1 Apple: a stale non-title sort re-navigates through the buckets', async () => {
  const calls: Array<{start?: number}> = [];
  const api = {
    request: async (_path: string, _method?: string, body?: unknown) => {
      const b = body as {range?: {start?: number; revision?: string}};
      const start = b.range?.start ?? 0;
      calls.push({start});
      assert.ok(!('anchorId' in (b.range ?? {})));
      if (b.range?.revision === 'rev-one' && start !== 0) throw Object.assign(new Error('expired'), {code: 'stale_continuation', status: 409});
      if (start === 0 && b.range?.revision === undefined && calls.length > 2) {
        return browsePage({start: 0, total: 1000, hasMore: true, revision: 'rev-two', positionIndex: [{key: '1995', index: 500}], entries: Array.from({length: 60}, (_, i) => entry(`n${i}`))});
      }
      if (start === 0) return browsePage({start: 0, total: 1000, hasMore: true, revision: 'rev-one', positionIndex: [{key: '1995', index: 480}]});
      if (start === 480) return browsePage({start: 480, total: 1000, hasMore: true, revision: 'rev-one', entries: Array.from({length: 60}, (_, i) => entry(`e${480 + i}`, {year: 1995}))});
      if (start === 500) return browsePage({start: 500, total: 1000, hasMore: true, revision: 'rev-two', entries: Array.from({length: 60}, (_, i) => entry(`n${500 + i}`, {year: 1995}))});
      return browsePage({start, total: 1000, hasMore: start + 60 < 1000, revision: 'rev-two'});
    },
  };
  const source = appleBrowsePageSource(api, {libraryId: 'lib', pivot: 'movies', predicates: [], sort: {field: 'year', direction: 'desc'}});
  await source(0, 60, signal);
  await source(480, 60, signal);
  const after = await source(480, 60, signal);
  assert.equal(after.items[0]!.id, 'n500');
  assert.ok(calls.some(c => c.start === 500));
});

test('Apple: a content section keeps exact totals through cursor paging', async () => {
  const scope = {viewerId: 'viewer', serverId: 'server'};
  const route: any = {libraryId: 'lib', view: 'browse'};
  const seed: any = {id: 's', entries: Array.from({length: SECTION_PAGE}, (_, i) => entry(`e${i}`)), nextCursor: 'c1', totalCount: 10040};
  let pages = 0;
  const api = {
    request: async () => {
      pages++;
      return {
        heading: {key: 'h', fallback: 'H'},
        scope: {serverId: 'server', libraryId: 'lib', libraryKind: 'movie', view: 'browse', entityId: '', viewerFence: 'f'},
        revision: {catalog: 1, viewer: 1},
        query: {sort: 'title', direction: 'asc', category: '', q: '', limit: SECTION_PAGE, searchMode: 'title_prefix'},
        navigation: [], sorts: [], filters: [],
        sections: [{id: 's', type: 'grid', heading: {key: 'h', fallback: 'H'}, entries: Array.from({length: SECTION_PAGE}, (_, i) => entry(`p${pages}-${i}`)), totalCount: 10040, nextCursor: `c${pages + 1}`}],
      };
    },
  };
  const source = sectionSource(api as any, scope as any, route, seed);
  const first = await source(0, SECTION_PAGE, signal);
  assert.equal(first.total, 10040);
  assert.equal(first.items.length, SECTION_PAGE);
  const second = await source(SECTION_PAGE, SECTION_PAGE, signal);
  assert.equal(second.total, 10040);
  assert.equal(second.items.length, SECTION_PAGE);
});
