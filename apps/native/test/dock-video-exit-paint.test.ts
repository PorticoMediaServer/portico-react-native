/** Authored UNRUN UI-resource vectors. No native capture, transfer or decoder is
 * executed; no original-frame, native-file or playback acceptance is claimed. */
import test from 'node:test';
import assert from 'node:assert/strict';
import {DockVideoExitImages} from '../src-next/kit/dock/video-exit-paint.ts';
import type {PlaybackFence} from '../../../packages/player-core/src/index.ts';
const fence = {kind: 'local', playId: 'original', sessionId: 'session', itemId: 'item', generation: 1} as PlaybackFence;
const bounds = {x: 24, y: 700, width: 80, height: 45};
function rig() {
  let view = {width: 390, height: 844}, original = true, paint = true, releases = 0, claims = 0;
  const life = new AbortController(), listeners = new Set<() => void>(), image = {uri: 'file:///captured-original', width: 1920, height: 1080};
  const grant = {fence, image, signal: life.signal, paintCurrent: () => paint && !life.signal.aborted,
    subscribe: (listener: () => void) => {listeners.add(listener); return () => {listeners.delete(listener);};},
    release: async () => {releases++;}};
  let finish!: (value: typeof grant | undefined) => void;
  const captured = {fence, image, retainForExit: () => {claims++; return new Promise<typeof grant | undefined>(resolve => {finish = resolve;});}};
  const errors: unknown[] = [], store = new DockVideoExitImages(() => view, error => errors.push(error));
  return {store, grant, captured, errors, get claims() {return claims;}, get releases() {return releases;},
    offer: (decoded = true) => store.offer(captured, decoded, bounds, () => original), finish: () => finish(grant),
    replace: () => {original = false;}, resize: () => {view = {width: 844, height: 390};},
    retire: () => {paint = false; life.abort(); for (const notify of [...listeners]) notify();}};
}

test('only an already-decoded original can begin one pre-retirement claim', async () => {
  const r = rig();
  await r.offer(false); assert.equal(r.claims, 0);
  const pending = r.offer(); assert.equal(r.claims, 1);
  await r.offer(); assert.equal(r.claims, 1);
  r.finish(); await pending;
  assert.equal(r.store.take({...fence, generation: 2}, bounds), undefined);
  assert.equal(r.store.take(fence, {...bounds, x: 25}), undefined);
  const original = r.store.take(fence, bounds); assert.ok(original);
  assert.equal(r.store.take(fence, bounds), undefined);
  await original.release(); await original.release();
  assert.equal(r.releases, 1);
});

test('a grant completed after replacement is released and never offered', async () => {
  const r = rig(), pending = r.offer(); r.replace(); r.finish(); await pending;
  await Promise.resolve();
  assert.equal(r.store.take(fence, bounds), undefined);
  assert.equal(r.releases, 1);
});

test('a completed grant survives only playback replacement, not original paint retirement', async () => {
  const r = rig(), pending = r.offer(); r.finish(); await pending;
  r.replace();
  const original = r.store.take(fence, bounds); assert.ok(original);
  assert.equal(original.paintCurrent(), true);
  r.retire(); await Promise.resolve(); await Promise.resolve();
  assert.equal(original.paintCurrent(), false);
  assert.equal(r.releases, 1);
});

test('resized geometry and disposal reject original pixels without retargeting their rectangle', async () => {
  const r = rig(), pending = r.offer(); r.finish(); await pending; r.resize();
  assert.equal(r.store.take(fence, bounds), undefined);
  r.store.dispose(); await Promise.resolve(); await Promise.resolve();
  assert.equal(r.releases, 1);
});
