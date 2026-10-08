import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {screenModule} from './helpers/screen-harness.mjs';

const load = () => screenModule(new URL('../src/screens/MetadataEditor.tsx', import.meta.url), {
  react: {default: {}, useEffect: () => {}, useMemo: (f: () => unknown) => f(), useState: (v: unknown) => [v, () => {}]},
  'react-native': {},
  '../../../../packages/client-core/src/metadata-repair': {},
  '../../../../packages/client-core/src/metadata-bulk': {bulkTargetLimit: 200, validateBulkReceipt: () => {throw new Error('unused');}},
  '../../../../packages/client-core/src/bulk-jobs': {groupMetadataTargets: () => [], runBulkRequests: async () => ({ok: 0, failed: [], jobs: 0})},
  '../app/content': {}, '../app/metadata-editor': {}, '../app/session': {}, '../app/i18n': {},
  '../ui': {}, '../app/errors': {},
}) as Promise<any>;

const int = {field: 'year', type: 'integer', min: 1900, max: 2100};
const text = {field: 'tagline', type: 'text', maxLength: 128};
const date = {field: 'released', type: 'date'};

test('CD-46: integers are canonical decimals within min/max', async () => {
  const {repairFieldProblem} = await load();
  assert.equal(repairFieldProblem(int, '2001', 'item'), undefined);
  assert.equal(repairFieldProblem(int, '1900', 'item'), undefined);
  assert.equal(repairFieldProblem(int, '2100', 'item'), undefined);
  assert.deepEqual(repairFieldProblem(int, '1899', 'item'), {code: 'too-small', min: 1900});
  assert.deepEqual(repairFieldProblem(int, '2101', 'item'), {code: 'too-large', max: 2100});
  // Leading zeros, signs, fractions and exponents are not canonical.
  for (const bad of ['007', ' 007', '+12', '-12', '12.0', '12,5', '1e3', '12a', '  ']) {
    assert.deepEqual(repairFieldProblem(int, bad, 'item'), {code: 'not-canonical'}, bad);
  }
  assert.equal(repairFieldProblem({field: 'plays', type: 'number'}, '0', 'item'), undefined);
});

test('CD-46: dates must really exist', async () => {
  const {repairFieldProblem} = await load();
  assert.equal(repairFieldProblem(date, '2024-05-17', 'item'), undefined);
  assert.equal(repairFieldProblem(date, '2024-02-29', 'item'), undefined, 'leap day exists in 2024');
  for (const bad of ['2023-02-29', '2024-13-01', '2024-00-10', '2024-04-31', '24-05-17', '2024-5-7', '2024/05/17', 'May 17 2024', '']) {
    if (bad === '') continue;
    assert.deepEqual(repairFieldProblem(date, bad, 'item'), {code: 'bad-date'}, bad);
  }
});

test('CD-46: text honours maxLength in code points; empty clears except the required title', async () => {
  const {repairFieldProblem} = await load();
  assert.equal(repairFieldProblem(text, 'A quiet film.', 'item'), undefined);
  assert.equal(repairFieldProblem({...text, maxLength: 3}, '日日日', 'item'), undefined);
  assert.deepEqual(repairFieldProblem({...text, maxLength: 3}, '日日日日', 'item'), {code: 'too-long', max: 3});
  assert.deepEqual(repairFieldProblem({...text, maxLength: 2}, '😀😀😀', 'item'), {code: 'too-long', max: 2});
  const title = {field: 'title', type: 'text', maxLength: 512};
  assert.deepEqual(repairFieldProblem(title, '', 'item'), {code: 'title-required'});
  assert.deepEqual(repairFieldProblem(title, '   ', 'item'), {code: 'title-required'});
  assert.equal(repairFieldProblem(title, '', 'season'), undefined, 'a season title may clear');
  assert.equal(repairFieldProblem(text, '', 'item'), undefined, 'empty clears any other field');
  assert.equal(repairFieldProblem(title, 'Dune', 'show'), undefined);
});

test('CD-48: only the screen engine sends query; MusicBrainz omits it', async () => {
  const {matchingSearchCommand} = await load();
  const screen = {provider: 'tmdb', id: '12', engine: 'screen'} as any;
  assert.deepEqual(matchingSearchCommand(screen, '  Dune  '), {action: 'search', query: 'Dune'});
  assert.deepEqual(matchingSearchCommand(screen, '   '), {action: 'search'});
  const music = {provider: 'musicbrainz', id: 'abc'} as any;
  assert.deepEqual(matchingSearchCommand(music, 'Dune'), {action: 'search'});
  assert.deepEqual(matchingSearchCommand(undefined, 'Dune'), {action: 'search'});
});

test('M25-1b: every identity status maps to catalogue copy with a generic fallback', async () => {
  const {matchingStatusKey, isTransientMatchingStatus} = await load();
  assert.equal(matchingStatusKey('searching'), 'web.metadata.matchStatus.searching');
  assert.equal(matchingStatusKey('needs_selection'), 'web.metadata.matchStatus.needsSelection');
  assert.equal(matchingStatusKey('unmatched'), 'web.metadata.matchStatus.unmatched');
  assert.equal(matchingStatusKey('bogus_future_status'), 'web.metadata.matchStatus.unknown');
  assert.equal(matchingStatusKey(undefined), 'web.metadata.matchStatus.unknown');
  for (const s of ['searching', 'pending', 'pending_search', 'pending_episodes', 'pending_children', 'pending_apply']) assert.equal(isTransientMatchingStatus(s), true, s);
  for (const s of ['matched', 'needs_selection', 'unmatched', undefined, '', 'bogus']) assert.equal(isTransientMatchingStatus(s), false, String(s));
});

test('M25-4: Apple bulk editor submits metadata-edit jobs grouped by selector', async () => {
  const src = readFileSync(new URL('../src/screens/MetadataEditor.tsx', import.meta.url), 'utf8');
  assert.match(src, /groupMetadataTargets.*from.*bulk-jobs/);
  assert.match(src, /runBulkRequests\(api, 'metadata-edit'/);
  assert.match(src, /failedById/);
  assert.doesNotMatch(src, /\/v1\/metadata\/bulk/);
  assert.doesNotMatch(src, /expectedRevision: raw\.revision/);
});

test('CD-44: 201 targets split 200+1 with exact identities', async () => {
  const {chunkBulkTargets} = await load();
  const targets = Array.from({length: 201}, (_, i) => ({kind: 'item', id: `id-${i}`}));
  const chunks = chunkBulkTargets(targets);
  assert.equal(chunks.length, 2);
  assert.equal(chunks[0].length, 200);
  assert.equal(chunks[1].length, 1);
  assert.equal(chunks[0][0].id, 'id-0');
  assert.equal(chunks[1][0].id, 'id-200');
});
