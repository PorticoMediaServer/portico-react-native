/**
 * A library's presets through the real hook (`useLibraryPresets`, the hook driver): one service per
 * viewer, library and pivot, so switching between two libraries of the same pivot reads the new
 * one's and a late answer for the old never shows; a save with no answer is sent again as itself.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import {createHookHost} from './hook-driver.ts';
import {useLibraryPresets} from '../src/app/library-presets.ts';

const scope = {serverId: 'server', viewerId: '["local","account","profile"]'};
const settle = async () => { for (let i = 0; i < 6; i++) await new Promise(setImmediate); };
const definition = (libraryId: string) => ({libraryId, pivot: 'shows', query: null, sort: [{field: 'title', direction: 'asc'}], presentation: 'grid'});
const view = (id: string, libraryId: string) => ({serverId: 'server', viewerFence: 'fence', id, kind: 'view', name: id, summary: '', visibility: 'private', revision: 1, role: 'owner', entryCount: 0, actions: ['pin', 'update', 'delete'], status: 'ready', invalidComponents: [], pinned: false, pinRevision: 0, shares: [], definition: definition(libraryId)});
const page = (resources: unknown[]) => ({serverId: 'server', viewerFence: 'fence', revision: 1, resources, nextCursor: ''});

test('two libraries of the same pivot: switching reads the new library\'s with a service of its own; a late answer for the old never shows', async () => {
  const waiting = new Map<string, (v: unknown) => void>();
  const paths: string[] = [];
  const api = {request: (path: string) => { paths.push(path); return new Promise(resolve => { waiting.set(new URL('http://x' + path).searchParams.get('libraryId')!, resolve); }); }};
  let n = 0;
  const requestId = async () => `00000000-0000-4000-8000-${String(++n).padStart(12, '0')}`;
  const now = {libraryId: 'anime'};
  let out!: ReturnType<typeof useLibraryPresets>;
  const host = createHookHost(() => { out = useLibraryPresets({api: api as never, scope, requestId, libraryId: now.libraryId, pivot: 'shows', enabled: true}); });
  host.mount();
  await settle();
  const first = out.service;
  now.libraryId = 'tv';
  host.rerender();
  await settle();
  assert.notEqual(out.service, first, 'a service of its own');
  assert.ok(paths.some(p => p.includes('libraryId=tv')), 'the new library\'s presets asked for');
  waiting.get('tv')!(page([view('tv-1', 'tv')]));
  await settle();
  waiting.get('anime')!(page([view('anime-1', 'anime')]));
  await settle();
  host.rerender();
  assert.deepEqual(out.snapshot?.resources.map(r => r.id), ['tv-1']);
  host.unmount();
});

test('a save with no answer is offered again as it was sent, as the same operation; setting it aside allows a new one', async () => {
  const bodies: {operationId: string; name: string}[] = [];
  let answer: 'none' | 'ok' = 'none';
  const api = {request: async (path: string, method = 'GET', body?: {operationId: string; name: string}) => {
    if (method === 'GET') return page([]);
    bodies.push(body!);
    if (answer === 'none') throw Object.assign(new Error('The server took too long.'), {code: 'timeout'});
    return {serverId: 'server', viewerFence: 'fence', receipt: {operationId: body!.operationId, resourceId: 'new', revision: 1, deleted: false}};
  }};
  let n = 0;
  let out!: ReturnType<typeof useLibraryPresets>;
  const host = createHookHost(() => { out = useLibraryPresets({api: api as never, scope, requestId: async () => `00000000-0000-4000-8000-${String(++n).padStart(12, '0')}`, libraryId: 'tv', pivot: 'shows', enabled: true}); });
  host.mount();
  await settle();
  await assert.rejects(() => out.save('Nineties', definition('tv') as never), /too long/);
  host.rerender();
  assert.equal(out.unconfirmed?.intent.action === 'create' && out.unconfirmed.intent.name, 'Nineties', 'the form holds the name it was sent with');
  answer = 'ok';
  await out.save('Nineties', definition('tv') as never);
  assert.equal(bodies[1]!.operationId, bodies[0]!.operationId, 'the same operation: made once');
  host.rerender();
  assert.equal(out.unconfirmed, undefined);
  // Unanswered again, then set aside (the form closed): the next save is a new operation.
  answer = 'none';
  await assert.rejects(() => out.save('Eighties', definition('tv') as never));
  host.rerender();
  await assert.rejects(() => out.save('Changed', definition('tv') as never), (e: {code?: string}) => e.code === 'unconfirmed', 'not replaced by another');
  out.discard();
  await settle();
  host.rerender();
  assert.equal(out.unconfirmed, undefined);
  answer = 'ok';
  await out.save('Changed', definition('tv') as never);
  assert.notEqual(bodies.at(-1)!.operationId, bodies.at(-2)!.operationId);
  assert.equal(bodies.at(-1)!.name, 'Changed');
  host.unmount();
});

test('a picker that read none shows a view another device saved once it is opened again (read quietly, in place)', async () => {
  let rows: unknown[] = [];
  const api = {request: async () => page(rows)};
  let out!: ReturnType<typeof useLibraryPresets>;
  const host = createHookHost(() => { out = useLibraryPresets({api: api as never, scope, requestId: async () => '00000000-0000-4000-8000-000000000001', libraryId: 'tv', pivot: 'shows', enabled: true}); });
  host.mount();
  await settle();
  host.rerender();
  assert.equal(out.snapshot?.resources.length, 0);
  // Saved on the phone.
  rows = [view('from-phone', 'tv')];
  await out.refresh();
  host.rerender();
  assert.deepEqual(out.snapshot?.resources.map(r => r.id), ['from-phone']);
  assert.equal(out.snapshot?.loading, false, 'no loading state for a quiet read');
  host.unmount();
});
