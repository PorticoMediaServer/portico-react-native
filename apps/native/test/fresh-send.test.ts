import test from 'node:test';
import assert from 'node:assert/strict';
import {findInPages, saveRebased, sendFresh, untilDone} from '../src/app/fresh-send.ts';

const stale = () => Object.assign(new Error('moved'), {code: 'revision_mismatch', status: 412});
const refused = () => Object.assign(new Error('no'), {code: 'validation_failed', status: 422});

test('a change that goes through is sent once', async () => {
  let sends = 0;
  assert.equal(await sendFresh({revision: 1}, async r => { sends++; return r.revision; }, async () => { assert.fail('not read again'); }), 1);
  assert.equal(sends, 1);
});

test('a record that moved is read again and the change is sent again, without a word', async () => {
  const seen: number[] = [];
  const out = await sendFresh({revision: 1}, async r => { seen.push(r.revision); if (r.revision === 1) throw stale(); return 'saved'; }, async () => ({revision: 2}));
  assert.equal(out, 'saved');
  assert.deepEqual(seen, [1, 2]);
});

test('when the record already is what was asked for, nothing more is sent', async () => {
  let sends = 0;
  const out = await sendFresh({enabled: false, revision: 1}, async () => { sends++; throw stale(); }, async () => ({enabled: true, revision: 2}), now => (now.enabled ? 'done' : true));
  assert.equal(out, undefined);
  assert.equal(sends, 1);
});

test('a record that is gone, or a change that no longer applies, ends with the server’s first answer', async () => {
  const first = stale();
  await assert.rejects(sendFresh({revision: 1}, async () => { throw first; }, async () => undefined), e => e === first);
  await assert.rejects(sendFresh({role: 'member'}, async () => { throw first; }, async () => ({role: 'owner'}), now => now.role !== 'owner'), e => e === first);
});

test('a refusal that is not about being out of date is shown as it is, and nothing is read again', async () => {
  const no = refused();
  await assert.rejects(sendFresh({revision: 1}, async () => { throw no; }, async () => { assert.fail('not read again'); }), e => e === no);
});

test('one record is found across pages, and a cursor that does not move ends the search', async () => {
  const pages: Record<string, {items: string[]; nextCursor: string}> = {'': {items: ['a', 'b'], nextCursor: 'p2'}, p2: {items: ['c'], nextCursor: 'p3'}, p3: {items: ['d'], nextCursor: ''}};
  let reads = 0;
  const page = async (cursor: string) => { reads++; return pages[cursor]!; };
  assert.equal(await findInPages(page, x => x === 'c'), 'c');
  assert.equal(await findInPages(page, x => x === 'z'), undefined);
  assert.equal(await findInPages(page, x => x === 'd', 2), undefined);
  reads = 0;
  assert.equal(await findInPages(async () => { reads++; return {items: [], nextCursor: 'same'}; }, () => false), undefined);
  assert.equal(reads, 2);
});

type Limits = {maxStreams: number; rating: string; schedule: {windows: number[]}};
const base: Limits = {maxStreams: 2, rating: 'PG', schedule: {windows: []}};

test('a draft is saved once when the document has not moved', async () => {
  const puts: [number, Limits][] = [];
  await saveRebased({base, revision: 3, draft: {...base, maxStreams: 4}, put: async (revision, value) => { puts.push([revision, value]); }, reread: async () => { assert.fail('not read again'); }});
  assert.deepEqual(puts, [[3, {...base, maxStreams: 4}]]);
});

test('a document that moved: the owner’s edits are carried onto it and saved again, silently', async () => {
  const puts: [number, Limits][] = [];
  let rebased: {fresh: Limits; merged: Limits; revision: number} | undefined;
  await saveRebased({
    base, revision: 3, draft: {...base, schedule: {windows: [1]}},
    put: async (revision, value) => { puts.push([revision, value]); if (revision === 3) throw stale(); },
    reread: async () => ({revision: 5, value: {...base, rating: 'R'}}),
    onRebased: (fresh, merged, revision) => { rebased = {fresh, merged, revision}; },
  });
  // What was not touched (the rating) takes the server's value; what was changed (the hours) keeps the owner's.
  assert.deepEqual(puts[1], [5, {maxStreams: 2, rating: 'R', schedule: {windows: [1]}}]);
  assert.deepEqual(rebased, {fresh: {...base, rating: 'R'}, merged: {maxStreams: 2, rating: 'R', schedule: {windows: [1]}}, revision: 5});
});

test('the same setting changed here and there is the one conflict: nothing more is sent, and the screen is told what the server has', async () => {
  const first = stale();
  let puts = 0, told = false;
  await assert.rejects(saveRebased({
    base, revision: 3, draft: {...base, maxStreams: 4},
    put: async () => { puts++; throw first; },
    reread: async () => ({revision: 5, value: {...base, maxStreams: 1}}),
    onRebased: (fresh, merged) => { told = true; assert.equal(fresh.maxStreams, 1); assert.equal(merged.maxStreams, 4); },
  }), e => e === first);
  assert.equal(puts, 1);
  assert.equal(told, true);
});

test('a re-read that fails leaves the first answer; any other refusal is shown as it is', async () => {
  const first = stale(), no = refused();
  await assert.rejects(saveRebased({base, revision: 3, draft: {...base, maxStreams: 4}, put: async () => { throw first; }, reread: async () => { throw new Error('offline'); }}), e => e === first);
  await assert.rejects(saveRebased({base, revision: 3, draft: {...base, maxStreams: 4}, put: async () => { throw no; }, reread: async () => { assert.fail('not read again'); }}), e => e === no);
});

test('an action that works in passes is repeated until nothing is left, within a bound', async () => {
  let left = 3;
  assert.equal(await untilDone(async () => ({more: --left > 0})), true);
  assert.equal(left, 0);
  let passes = 0;
  assert.equal(await untilDone(async () => { passes++; return {more: true}; }, 5), false);
  assert.equal(passes, 5);
});
