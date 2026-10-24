import test from 'node:test';
import assert from 'node:assert/strict';
import {createDeviceEqualizer, type DeviceEqualizer} from '../platform/equalizer-store.ts';
import type {DeviceEqualizerSnapshot} from '../src-next/platform/playback/equalizer.ts';
import {nativeSettingsEqualizerFacts} from '../src-next/screens/settings/device-equalizer-facts.ts';

const flat = (on = false): DeviceEqualizer => ({on, preamp: 0, gains: Array(10).fill(0)});

function fixture() {
  const calls = {read: 0, write: 0, reset: 0};
  let held = flat(), gate: Promise<void> | undefined, acknowledge: ((asked: DeviceEqualizer) => Promise<DeviceEqualizer>) | undefined;
  const port = {
    read: async () => {calls.read++; if (gate) await gate; return held;},
    write: async (asked: DeviceEqualizer) => {calls.write++; return acknowledge ? acknowledge(asked) : (held = asked);},
    reset: async () => {calls.reset++; return held = flat(held.on);},
  };
  return {
    store: createDeviceEqualizer(port), calls,
    holdRead: () => {let release!: () => void; gate = new Promise<void>(resolve => {release = resolve;}); return release;},
    answerWith: (next: (asked: DeviceEqualizer) => Promise<DeviceEqualizer>) => {acknowledge = next;},
    get held() {return held;},
  };
}

function confirmed(snapshot: DeviceEqualizerSnapshot) {
  const facts = nativeSettingsEqualizerFacts(snapshot);
  assert.equal(facts.state, 'confirmed');
  if (facts.state !== 'confirmed') assert.fail('expected a confirmed fact');
  return facts;
}

test('absent native support reports only the unsupported fact, never a default or held record', async () => {
  const store = createDeviceEqualizer();
  assert.deepEqual(nativeSettingsEqualizerFacts(store.getSnapshot()), {state: 'unsupported'});
  await assert.rejects(store.refresh(), /audio_eq_unavailable/);
  const facts = nativeSettingsEqualizerFacts(store.getSnapshot());
  assert.deepEqual(facts, {state: 'unsupported'});
  assert.deepEqual(Object.keys(facts), ['state']);
  assert.deepEqual(nativeSettingsEqualizerFacts({supported: false, ready: true, pending: true, value: flat(true)}), {state: 'unsupported'});
});

test('an unready snapshot is unconfirmed and never exposes a held value or composes a default', () => {
  const held = flat(true);
  const snapshots: DeviceEqualizerSnapshot[] = [
    {supported: true, ready: false, pending: false, value: held},
    {supported: true, ready: false, pending: true, value: held},
    {supported: true, ready: true, pending: false},
  ];
  for (const snapshot of snapshots) {
    const facts = nativeSettingsEqualizerFacts(snapshot);
    assert.deepEqual(facts, {state: 'unconfirmed', pending: snapshot.pending});
    assert.deepEqual(Object.keys(facts), ['pending', 'state']);
    assert.equal('value' in facts, false);
  }
});

test('the fact is unconfirmed before and during refresh, then exposes the exact confirmed receipt', async () => {
  const f = fixture();
  assert.deepEqual(nativeSettingsEqualizerFacts(f.store.getSnapshot()), {state: 'unconfirmed', pending: false});
  const release = f.holdRead(), refreshing = f.store.refresh();
  await new Promise(resolve => setImmediate(resolve));
  assert.deepEqual(nativeSettingsEqualizerFacts(f.store.getSnapshot()), {state: 'unconfirmed', pending: true});
  assert.equal('value' in nativeSettingsEqualizerFacts(f.store.getSnapshot()), false);
  release(); await refreshing;
  const receipt = f.store.getSnapshot().value!;
  const facts = confirmed(f.store.getSnapshot());
  assert.equal(facts.pending, false);
  assert.equal(facts.value, receipt);
  assert.equal(facts.value, f.store.getSnapshot().value);
  assert.deepEqual(facts.value, flat());
});

test('a pending update keeps the last confirmed value by identity until the native acknowledgement', async () => {
  const f = fixture();
  await f.store.refresh();
  const last = f.store.getSnapshot().value!;
  let acknowledge!: (next: DeviceEqualizer) => void;
  f.answerWith(() => new Promise<DeviceEqualizer>(resolve => {acknowledge = resolve;}));
  const writing = f.store.update({on: true, preamp: -3});
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(f.store.getSnapshot().pending, true);
  const during = confirmed(f.store.getSnapshot());
  assert.equal(during.pending, true);
  assert.equal(during.value, last);
  assert.equal(during.value.on, false);
  acknowledge({on: true, preamp: -3, gains: Array(10).fill(0)});
  const acknowledged = await writing;
  const after = confirmed(f.store.getSnapshot());
  assert.equal(after.pending, false);
  assert.equal(after.value, acknowledged);
  assert.equal(after.value.on, true);
});

test('a rejected or contradictory native acknowledgement retains the last confirmed value', async () => {
  const f = fixture();
  await f.store.refresh();
  const last = f.store.getSnapshot().value!;
  f.answerWith(async () => {throw new Error('audio_eq_invalid');});
  await assert.rejects(f.store.update({on: true}), /audio_eq_invalid/);
  let facts = confirmed(f.store.getSnapshot());
  assert.equal(facts.pending, false);
  assert.equal(facts.value, last);
  f.answerWith(async () => flat());
  await assert.rejects(f.store.update({on: true}), /audio_eq_invalid/);
  facts = confirmed(f.store.getSnapshot());
  assert.equal(facts.pending, false);
  assert.equal(facts.value, last);
  assert.equal(facts.value.on, false);
});

test('the projection makes no port call and never mutates the store snapshot', async () => {
  const f = fixture();
  assert.deepEqual(nativeSettingsEqualizerFacts(f.store.getSnapshot()), {state: 'unconfirmed', pending: false});
  assert.deepEqual(f.calls, {read: 0, write: 0, reset: 0});
  await f.store.refresh();
  const snapshot = f.store.getSnapshot(), calls = {...f.calls}, before = JSON.stringify(snapshot);
  assert.ok(Object.isFrozen(snapshot) && Object.isFrozen(snapshot.value!.gains));
  for (let index = 0; index < 5; index++) confirmed(snapshot);
  assert.deepEqual(f.calls, calls);
  assert.equal(JSON.stringify(snapshot), before);
  assert.equal(confirmed(snapshot).value, f.store.getSnapshot().value);
});
