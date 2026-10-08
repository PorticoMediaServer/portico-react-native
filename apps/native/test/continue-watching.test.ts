import test from 'node:test';
import assert from 'node:assert/strict';
import {continueHiddenSnapshot, continueScope, hiddenFor, isContinueRow, onContinueChanged, removeFromContinueWatching, settleContinueHidden, withoutRemoved, type ContinueToast} from '../src/app/continue-watching.ts';

const scope = continueScope('server-1', 'account', 'profile');
const entry = (id: string) => ({id}) as any;
const row = (id: string, kind: string, ids: string[]) => ({id, kind, entries: ids.map(entry), total: ids.length}) as any;
const t = (key: string, values?: {title: string}) => key + (values ? ':' + values.title : '');
let n = 0;
const operationId = () => 'op-' + ++n;
const hidden = () => hiddenFor(continueHiddenSnapshot(), scope);
function api(answer: (body: any) => unknown) {
  const bodies: any[] = [];
  return {bodies, async request<T>(_path: string, _method?: string, body?: unknown): Promise<T> { bodies.push(body); return answer(body) as T; }};
}
const refused = () => { throw Object.assign(new Error('no'), {code: 'forbidden'}); };

test('the Continue Watching row is the rows API’s `continue` ID (not Continue Listening) or the older kind', () => {
  assert.ok(isContinueRow({id: 'continue', kind: 'continue'}));
  assert.ok(!isContinueRow({id: 'continue_listening', kind: 'continue'}));
  assert.ok(isContinueRow({id: 'x', kind: 'continue_watching'}));
  assert.ok(!isContinueRow({id: 'recent', kind: 'recently_added'}));
});

test('removed titles leave only Continue Watching, and its count', () => {
  const rows = [row('continue', 'continue', ['a', 'b']), row('recent', 'recently_added', ['a'])];
  const out = withoutRemoved(rows, new Set(['a']));
  assert.deepEqual(out[0].entries.map((e: any) => e.id), ['b']);
  assert.equal(out[0].total, 1);
  assert.equal(out[1], rows[1], 'the same title elsewhere on Home stays');
  assert.equal(withoutRemoved(rows, new Set()), rows);
});

test('removal hides the card at once, dismisses on the server, and offers Undo', async () => {
  const toasts: ContinueToast[] = [];
  const changes: string[] = [];
  const stop = onContinueChanged(s => changes.push(s));
  let release!: () => void;
  const gate = new Promise<void>(r => { release = r; });
  const server = api(async body => { await gate; return {personal: {revision: body.expectedRevision + 1}}; });
  const pending = removeFromContinueWatching({api: server, scope, itemId: 'm1', title: 'Film', revision: 4, operationId, toast: x => toasts.push(x), t: t as any});
  assert.ok(hidden().has('m1'), 'optimistic: gone before the server answers');
  release();
  assert.equal(await pending, true);
  assert.deepEqual(server.bodies[0], {operationId: server.bodies[0].operationId, expectedRevision: 4, continueDismissed: true});
  assert.deepEqual(changes, [scope], 'Home reloads once the server agrees');
  assert.equal(toasts.at(-1)!.message, 'entry.continueRemoved:Film');
  assert.equal(toasts.at(-1)!.action!.label, 'action.undo');

  // A Home still listing it (composed before the dismissal) keeps it hidden…
  settleContinueHidden(scope, [row('continue', 'continue', ['m1'])]);
  assert.ok(hidden().has('m1'));
  // …Undo puts it back at once and restores it on the server, against the dismissal's revision.
  toasts.at(-1)!.action!.onPress();
  assert.ok(!hidden().has('m1'));
  await new Promise(r => setImmediate(r));
  assert.deepEqual({...server.bodies[1], operationId: undefined}, {operationId: undefined, expectedRevision: 5, continueDismissed: false});
  assert.deepEqual(changes, [scope, scope]);
  stop();
});

test('a Home without the title hands it to the server; a refused removal puts the card back', async () => {
  const toasts: ContinueToast[] = [];
  await removeFromContinueWatching({api: api(() => ({personal: {revision: 2}})), scope, itemId: 'm2', title: 'Two', revision: 1, operationId, toast: x => toasts.push(x), t: t as any});
  assert.ok(hidden().has('m2'));
  settleContinueHidden(continueScope('other'), [row('continue', 'continue', [])]);
  assert.ok(hidden().has('m2'), 'another viewer’s Home settles nothing here');
  settleContinueHidden(scope, [row('continue', 'continue', ['b'])]);
  assert.ok(!hidden().has('m2'), 'so a later playback can bring it back');

  assert.equal(await removeFromContinueWatching({api: api(refused), scope, itemId: 'm3', title: 'Three', revision: 1, operationId, toast: x => toasts.push(x), t: t as any}), false);
  assert.ok(!hidden().has('m3'));
  assert.equal(toasts.at(-1)!.message, 'entry.continueRemoveFailed:Three');
  assert.equal(toasts.at(-1)!.action, undefined);
});

test('a refused Undo leaves the title removed and says so', async () => {
  const toasts: ContinueToast[] = [];
  let calls = 0;
  const server = api(body => { if (++calls > 1) refused(); return {personal: {revision: body.expectedRevision + 1}}; });
  await removeFromContinueWatching({api: server, scope, itemId: 'm4', title: 'Four', revision: 0, operationId, toast: x => toasts.push(x), t: t as any});
  toasts.at(-1)!.action!.onPress();
  await new Promise(r => setImmediate(r));
  assert.ok(hidden().has('m4'));
  assert.equal(toasts.at(-1)!.message, 'entry.continueRestoreFailed:Four');
});
