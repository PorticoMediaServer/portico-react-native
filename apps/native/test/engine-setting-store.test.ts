import test from 'node:test';
import assert from 'node:assert/strict';
import {engineSettingStore as store} from '../src/player/engine-setting-store.ts';

test('an older publication cannot wake the current engine re-plan', async () => {
  store.set('native');
  const old = store.version();
  store.set('mpv');
  let finished = false;
  const waiting = store.whenSettled(1000, 'mpv').then(() => { finished = true; });
  store.settled(old);
  await Promise.resolve();
  assert.equal(finished, false);
  store.settled(store.version());
  await waiting;
  assert.equal(finished, true);
});

test('a player effect may wait before the preferences provider mirrors its new value', async () => {
  store.set('automatic');
  store.settled(store.version());
  let finished = false;
  const waiting = store.whenSettled(1000, 'native').then(() => { finished = true; });
  await Promise.resolve();
  assert.equal(finished, false);
  store.set('native');
  store.settled(store.version());
  await waiting;
  assert.equal(finished, true);
});

test('a published setting resolves immediately; an unsent setting has a bounded wait', async () => {
  store.settled(store.version());
  let finished = false;
  const ready = store.whenSettled(1000).then(() => { finished = true; });
  await Promise.resolve();
  assert.equal(finished, true);
  await ready;
  store.set('automatic');
  await store.whenSettled(5);
});
