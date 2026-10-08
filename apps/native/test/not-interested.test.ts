import test from 'node:test';
import assert from 'node:assert/strict';
import {forgetNotInterested, markNotInterested, notInterestedFor, notInterestedSnapshot, withoutNotInterested, type NotInterestedToast} from '../src/app/not-interested.ts';
import {continueScope} from '../src/app/continue-watching.ts';

const scope = continueScope('server-1', 'account', 'profile');
const t = (key: string, values?: {title: string}) => key + (values ? ':' + values.title : '');
let n = 0;
const operationId = () => 'op-' + ++n;
const turnedDown = () => notInterestedFor(notInterestedSnapshot(), scope);
function api(answer: (body: any) => unknown) {
  const bodies: any[] = [];
  return {bodies, async request<T>(_path: string, _method?: string, body?: unknown): Promise<T> { bodies.push(body); return answer(body) as T; }};
}
const ok = (body: any) => ({serverId: 'server-1', viewerFence: 'f', operationId: body.operationId, updated: 1, failed: 0, results: [{itemId: body.items[0].itemId, ok: true, personal: {revision: 2}}]});
const refused = () => { throw Object.assign(new Error('no'), {code: 'forbidden'}); };

test('P5: a turned-down title leaves recommendation rows only, and their counts', () => {
  const rec = {id: 'recommended', kind: 'recommendation', entries: [{id: 'a'}, {id: 'b'}], total: 10};
  const recent = {id: 'recent_lib', kind: 'recent', entries: [{id: 'a'}], total: 1};
  const out = withoutNotInterested(rec, new Set(['a']));
  assert.deepEqual(out.entries, [{id: 'b'}]);
  assert.equal(out.total, 9);
  assert.equal(withoutNotInterested(recent, new Set(['a'])), recent, 'Recently added keeps it');
  // A title page's rows are all recommendations: the caller says so.
  const related = {id: 'more_like', entries: [{id: 'a'}], totalCount: 1};
  assert.deepEqual(withoutNotInterested(related, new Set(['a']), true).entries, []);
});

test('Not interested hides the card at once, names the show’s own id, and Undo sends false', async () => {
  const toasts: NotInterestedToast[] = [];
  let release!: () => void;
  const gate = new Promise<void>(r => { release = r; });
  const server = api(async body => { await gate; return ok(body); });
  const pending = markNotInterested({api: server, scope, serverId: 'server-1', entry: {id: 'card', title: 'Series', kind: 'show', navigation: {entityId: 'show-1'}}, operationId, toast: x => toasts.push(x), t: t as any});
  assert.ok(turnedDown().has('card'), 'optimistic: gone before the server answers');
  release();
  assert.equal(await pending, true);
  assert.deepEqual(server.bodies[0].items, [{itemId: 'show-1', notInterested: true}]);
  assert.equal(toasts.at(-1)!.message, 'entry.notInterestedDone:Series');
  assert.equal(toasts.at(-1)!.action!.label, 'action.undo');
  toasts.at(-1)!.action!.onPress();
  assert.ok(!turnedDown().has('card'), 'Undo brings the card back at once');
  await new Promise(r => setTimeout(r, 0));
  assert.deepEqual(server.bodies[1].items, [{itemId: 'show-1', notInterested: false}]);
  assert.notEqual(server.bodies[0].operationId, server.bodies[1].operationId);
});

test('a refused request puts the card back and says so; Reset forgets what was hidden', async () => {
  const toasts: NotInterestedToast[] = [];
  assert.equal(await markNotInterested({api: api(refused), scope, serverId: 'server-1', entry: {id: 'm2', title: 'Film', kind: 'movie'}, operationId, toast: x => toasts.push(x), t: t as any}), false);
  assert.ok(!turnedDown().has('m2'));
  assert.equal(toasts.at(-1)!.message, 'entry.notInterestedFailed:Film');
  await markNotInterested({api: api(ok), scope, serverId: 'server-1', entry: {id: 'm3', title: 'Other', kind: 'movie'}, operationId, toast: () => {}, t: t as any});
  assert.ok(turnedDown().has('m3'));
  forgetNotInterested(scope);
  assert.equal(turnedDown().size, 0);
});
