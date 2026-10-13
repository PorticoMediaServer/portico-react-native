import test from 'node:test';
import assert from 'node:assert/strict';
import {announceContainerMark, containerUndoReceipt, undoContainerMark, type MarkToast} from '../src/app/container-undo.ts';

const marked = (over: Record<string, unknown> = {}) => ({revision: 7, watched: true, watermark: 'w', watchlisted: false, favorite: false, undoToken: 'tok_1', undoUntil: new Date(30_000).toISOString(), ...over}) as never;

function api(answer: (path: string, method: string, body: unknown) => unknown) {
  const calls: {path: string; method?: string; body?: unknown}[] = [];
  return {calls, request: async <T,>(path: string, method?: string, body?: unknown): Promise<T> => { calls.push({path, method, body}); return answer(path, method ?? 'GET', body) as T; }};
}
const restored = {revision: 8, watched: false, watermark: 'w0', watchlisted: false, favorite: false};

test('a mark’s answer carries a receipt only while its window is open', () => {
  assert.deepEqual(containerUndoReceipt('season', 's1', marked(), 1_000), {kind: 'season', id: 's1', revision: 7, token: 'tok_1', until: 30_000});
  assert.equal(containerUndoReceipt('season', 's1', marked(), 30_000), undefined);
  assert.equal(containerUndoReceipt('season', 's1', marked({undoToken: undefined, undoUntil: undefined}), 1_000), undefined);
  assert.equal(containerUndoReceipt('season', 's1', marked({undoUntil: 'not a time'}), 1_000), undefined);
});

test('Undo sends the receipt to the undo route, never a mark the other way', async () => {
  const server = api(() => restored);
  const receipt = containerUndoReceipt('show', 'show 1', marked(), 1_000)!;
  const state = await undoContainerMark(server, receipt, 2_000);
  assert.equal(state.watched, false);
  assert.equal(server.calls.length, 1);
  assert.equal(server.calls[0]!.method, 'POST');
  assert.match(server.calls[0]!.path, /\/v1\/containers\/show\/show%201\/personal-state\/undo$/);
  assert.deepEqual(server.calls[0]!.body, {expectedRevision: 7, undoToken: 'tok_1'});
});

test('a receipt past its time is refused without a request', async () => {
  const server = api(() => restored);
  const receipt = containerUndoReceipt('book', 'b1', marked(), 1_000)!;
  await assert.rejects(undoContainerMark(server, receipt, 30_001), (e: {code?: string}) => e.code === 'operation_expired');
  assert.equal(server.calls.length, 0);
});

test('the toast offers Undo once, and reads the title again when it is done', async () => {
  const server = api(() => restored);
  const toasts: MarkToast[] = [];
  let undone = 0;
  announceContainerMark({api: server, kind: 'album', id: 'a1', marked: marked(), message: 'Kind of Blue marked as watched', undoLabel: 'Undo', describeFailure: () => 'no', toast: t => toasts.push(t), onUndone: () => { undone++; }, now: () => 1_000});
  assert.equal(toasts.length, 1);
  assert.equal(toasts[0]!.message, 'Kind of Blue marked as watched');
  assert.equal(toasts[0]!.action?.label, 'Undo');
  toasts[0]!.action!.onPress();
  toasts[0]!.action!.onPress();
  await new Promise(resolve => setTimeout(resolve, 0));
  assert.equal(server.calls.length, 1, 'one receipt, one request');
  assert.equal(undone, 1);
  assert.equal(toasts.length, 1, 'a successful undo says nothing more');
});

test('no receipt, no Undo', () => {
  const toasts: MarkToast[] = [];
  announceContainerMark({api: api(() => restored), kind: 'season', id: 's1', marked: marked({undoToken: undefined, undoUntil: undefined}), message: 'Season 1 marked as watched', undoLabel: 'Undo', describeFailure: () => 'no', toast: t => toasts.push(t), now: () => 1_000});
  assert.equal(toasts[0]!.action, undefined);
});

test('a refused Undo says why and changes nothing', async () => {
  const refuse = (code: string) => api(() => { throw Object.assign(new Error('refused'), {code, status: code === 'operation_expired' ? 410 : 412}); });
  for (const [code, expected] of [['operation_expired', 'expired'], ['revision_mismatch', 'changed']] as const) {
    const toasts: MarkToast[] = [];
    let undone = 0;
    announceContainerMark({api: refuse(code), kind: 'show', id: 's', marked: marked(), message: 'm', undoLabel: 'Undo', describeFailure: (_e, expired) => (expired ? 'expired' : 'changed'), toast: t => toasts.push(t), onUndone: () => { undone++; }, now: () => 1_000});
    toasts[0]!.action!.onPress();
    await new Promise(resolve => setTimeout(resolve, 0));
    assert.equal(undone, 0);
    assert.deepEqual(toasts[1], {message: expected, icon: 'warning'});
  }
});
