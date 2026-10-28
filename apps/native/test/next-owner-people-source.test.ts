import test from 'node:test';
import assert from 'node:assert/strict';
import {screenModule} from './helpers/screen-harness.mjs';

const deferred = () => {let resolve!: (value: any) => void; const promise = new Promise<any>(next => {resolve = next;}); return {promise, resolve};};
const row = {accountId: 'member-fixture', username: 'member', role: 'member', revision: 2, limitsRevision: 3};
const person = {...row, disabled: false, notes: '', limits: {allowRemote: true}};
const page = (items = [row]) => ({items, totalCount: items.length, matchedCount: items.length, nextCursor: '', limit: 40});
const tick = async () => {await Promise.resolve(); await Promise.resolve();};
async function fixture(deferPerson = false) {
  const reads: any[] = [], details: any[] = [], writes: any[] = [], reported: unknown[] = [];
  let active = true, failNotes = false;
  const preview = {accountId: row.accountId, username: row.username, revision: 4, role: 'member', profiles: 2, devices: 1, savedResources: 3};
  const module = await screenModule(new URL('../src-next/screens/settings-live/server/people-source.ts', import.meta.url), {
    react: {default: {}},
    '../../../../../../packages/client-core/src/settings-people': {SettingsPeopleClient: class {
      read(query: any, cursor: any, signal: any) {const next = deferred(); reads.push({query, cursor, signal, ...next}); return next.promise;}
      person(accountId: string, signal: AbortSignal) {
        if (!deferPerson) return Promise.resolve(person);
        const next = deferred(); details.push({accountId, signal, ...next}); return next.promise;
      }
      async notes(captured: any, notes: any) {writes.push({kind: 'notes', captured, notes}); if (failNotes) throw new Error('fixture_write_failed');}
      async role(captured: any, role: any) {writes.push({kind: 'role', captured, role});}
      async limits(captured: any, limits: any) {writes.push({kind: 'limits', captured, limits});}
      async bulk(rows: any, action: any, _: any, operationId: any) {writes.push({kind: 'bulk', rows, action, operationId});}
      dispose() {}
    }},
    '../../../../../../packages/client-core/src/direct-account': {PeopleInvitationsClient: class {}, privatePersonNotes: (value: string) => value.trim() || null},
    '../../../../../../packages/client-core/src/server-administration': {
      previewMemberDeletion: async () => preview,
      deleteMember: async (_: any, captured: any) => {writes.push({kind: 'delete', captured});},
    },
    '../lifetime': {NativeScreenLifetime: class {live = true; current = () => active && this.live; dispose = () => {this.live = false;};}, screenScopeEnded: () => new Error('ended')},
    './storage/space-source': {nativeStorageOwner: () => active},
  });
  const context = {account: {account: {id: 'owner-fixture'}, capabilities: {managePeople: true}}};
  const source = new module.NativePeopleSource(context, () => 'operation-fixture', (error: unknown) => reported.push(error));
  const load = async () => {const pending = source.load(); reads.at(-1).resolve(page()); await pending;};
  return {source, reads, details, writes, reported, preview, load, retire: () => {active = false;}, failNotes: () => {failNotes = true;}};
}

test('People search retires the previous page and cursor before a late answer can publish', async () => {
  const f = await fixture(); const first = f.source.load('old-cursor');
  f.source.select('people', {...f.source.getSnapshot().query, search: 'new query'});
  assert.equal(f.reads[0].signal.aborted, true);
  assert.equal(f.reads[1].cursor, '');
  const newer = page([{...row, username: 'new result'}]); f.reads[1].resolve(newer); await tick();
  f.reads[0].resolve(page()); await first;
  assert.equal(f.source.getSnapshot().people, newer);
  assert.equal(f.source.getSnapshot().query.search, 'new query');
  f.source.dispose();
});

test('refresh retires pending person details and a stale finally cannot clear the next opening', async () => {
  const f = await fixture(true); await f.load();
  const first = f.source.open(row);
  assert.equal(f.source.getSnapshot().opening, true);
  const refresh = f.source.load();
  assert.equal(f.details[0].signal.aborted, true);
  assert.equal(f.source.getSnapshot().opening, false);
  assert.equal(f.source.getSnapshot().selected, undefined, 'the unfinished sheet closes rather than becoming empty');
  const refreshedRow = {...row, revision: 5};
  f.reads.at(-1).resolve(page([refreshedRow])); await refresh;
  const next = f.source.open(refreshedRow);
  f.details[0].resolve(person); await first;
  assert.equal(f.source.getSnapshot().opening, true);
  assert.equal(f.source.getSnapshot().selected, refreshedRow);
  assert.equal(f.source.getSnapshot().person, undefined);
  const freshPerson = {...person, revision: 5};
  f.details[1].resolve(freshPerson); await next;
  assert.equal(f.source.getSnapshot().opening, false);
  assert.equal(f.source.getSnapshot().person, freshPerson);
  f.source.dispose();
});

test('People mutations require the current selected person and preserve the authoritative revisions', async () => {
  const f = await fixture(); await f.load(); await f.source.open(row);
  assert.equal(await f.source.enabled({...person}, false), false, 'an equal-looking object is not the selected revision');
  assert.deepEqual(f.writes, []);
  await f.source.enabled(person, false);
  assert.equal(f.writes.length, 1);
  assert.equal(f.writes[0].rows[0].revision, person.revision);
  assert.equal(f.writes[0].rows[0].limitsRevision, person.limitsRevision);
  assert.equal(f.writes[0].action, 'disable');
  assert.equal(f.writes[0].operationId, 'operation-fixture');
  f.source.dispose(); await f.source.enabled(person, true); assert.equal(f.writes.length, 1);
});

test('deleting a person needs the exact fresh preview and never reuses it', async () => {
  const f = await fixture(); await f.load(); await f.source.open(row);
  const preview = await f.source.previewDeletion(person);
  assert.equal(preview, f.preview);
  assert.equal(await f.source.remove(person, {...preview}), false);
  assert.equal(await f.source.remove(person, preview), true);
  assert.equal(f.writes[0].captured, preview);
  assert.equal(await f.source.remove(person, preview), false);
  assert.equal(f.writes.length, 1); f.source.dispose();
});

test('a failed People mutation remains visible, is not retried, and retired handlers cannot write', async () => {
  const f = await fixture(); await f.load(); await f.source.open(row); f.failNotes();
  assert.equal(await f.source.notes(person, ' private note '), false);
  assert.equal(f.writes.length, 1); assert.equal(f.writes[0].notes, 'private note');
  assert.equal(f.source.getSnapshot().error.message, 'fixture_write_failed');
  assert.equal(f.reads.length, 1, 'failure cannot be erased by an automatic refresh');
  f.retire(); await f.source.notes(person, 'later'); assert.equal(f.writes.length, 1); f.source.dispose();
});
