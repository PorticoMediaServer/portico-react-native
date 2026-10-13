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

test('an override is a setting the server plans from: changing one asks for a new publication', async () => {
  store.settled(store.version());
  const before = store.version();
  let told = 0;
  const off = store.subscribe(() => { told++; });
  store.setOverrides({forceStereo: true});
  assert.equal(store.version(), before + 1);
  assert.equal(told, 1);
  assert.deepEqual(store.overrides(), {forceStereo: true, disablePassthrough: false, disableHdr: false});
  store.setOverrides({forceStereo: true});
  assert.equal(told, 1, 'the same values are not a change');
  let finished = false;
  const waiting = store.whenCurrentSettled(1000).then(() => { finished = true; });
  await Promise.resolve();
  assert.equal(finished, false, 'not yet published');
  store.settled(store.version());
  await waiting;
  assert.equal(finished, true);
  off();
  store.setOverrides({});
});

test('what the probe found of the device is told to whoever draws Settings', () => {
  let told = 0;
  const off = store.subscribeProbed(() => { told++; });
  store.setProbed({audioPassthrough: true, hdr: false});
  store.setProbed({audioPassthrough: true, hdr: false});
  assert.equal(told, 1);
  assert.deepEqual(store.probed(), {audioPassthrough: true, hdr: false});
  off();
});
